/**
 * EVERY SESSION THIS APP CREATES, AND THE ONE INSTRUMENT THAT WATCHES THEM ALL.
 *
 * This is the electron half; the rule itself — who owns what, and what may go on
 * the wire — is `src/main/p1.js`, which imports nothing and is asserted
 * directly. Same split, and same reason, as `assets.js` / `protocol.js`.
 *
 * ---------------------------------------------------------------------------
 * WHY A FACTORY, WHEN TWO `session.` CALLS IN `main.js` WOULD HAVE DONE
 * ---------------------------------------------------------------------------
 * P1' is a claim about a SET — *the app's own code talks to exactly one host* —
 * and a set is only as honest as its enumeration. **Electron has no API that
 * lists the sessions a process has made.** So an observer that watches the
 * sessions it happens to know about is blind to the next partition somebody
 * adds, and a session nobody observed reads EXACTLY like a session that made no
 * requests. Those two must never produce the same picture, because one of them
 * is the failure this whole file exists to make impossible.
 *
 * The enumeration is therefore closed at the source rather than reconstructed
 * afterwards, in three parts, and none of them works alone:
 *
 *   1. this file is the only place in `src/` that may name a session;
 *   2. `makeSession()` installs the observer BEFORE IT RETURNS, so there is no
 *      instant in which a session of ours exists unwatched;
 *   3. `tools/suites/p1.mjs` scans the app's own source — comments stripped,
 *      every file it opened NAMED in the assertion's detail — for a
 *      `session.fromPartition(` or a `session.defaultSession` anywhere else.
 *
 * (3) is the assertion. (1) and (2) are what make it possible to pass, and (3)
 * is what stops (1) from quietly becoming untrue.
 *
 * ---------------------------------------------------------------------------
 * `onBeforeRequest` TAKES ONE LISTENER PER SESSION. THAT IS WHY THIS FANS OUT.
 * ---------------------------------------------------------------------------
 * `Session.webRequest.onBeforeRequest(filter, listener)` REPLACES whatever was
 * registered before it, and says nothing about it. A second module registering
 * its own — which `src/main/transport.js` did, for L1's runtime witness, before
 * this file existed — does not add a second observer: it silently unhooks the
 * first. **That is an instrument going blind with no symptom at all**, on the one
 * seam whose entire job is to notice silence.
 *
 * So there is exactly ONE registration per session, it is here, and everything
 * that wants to see requests subscribes through `onRequest(label, fn)`.
 * `transport.js` is now one of those subscribers rather than a second owner.
 */
import { session as electronSession } from 'electron';

import { SESSION_OWNERS, mayRequest, originOf } from './p1.js';
import { userAgentFor } from './useragent.js';

/**
 * How many `user` rows to keep. `app` rows are the SUBJECT of P1' and are never
 * dropped — there should be almost none, and a cap that silently discarded one
 * would be a cap that discards the evidence. YouTube makes thousands of
 * requests in a session and they are context, not subject.
 */
const USER_LOG_CAP = 4000;

/**
 * What `src/main/useragent.js` builds its string from — the Chromium this
 * process really is, on the platform it really is. Read once, here, because a
 * pure function that reached for `process` would not be one.
 */
const UA_ENV = { chromeVersion: process.versions.chrome, platform: process.platform };

/**
 * @returns {{
 *   makeSession(label: string, partition: string|null): Electron.Session,
 *   get(label: string): Electron.Session|null,
 *   onRequest(label: string, fn: (row: object) => void): void,
 *   log(): object[],
 *   stats(): object,
 * }}
 */
export function createSessions() {
  /** label -> { session, owner, subscribers } */
  const made = new Map();
  const rows = [];
  const stats = { created: 0, listeners: 0, observed: 0, cancelled: 0, userDropped: 0, byLabel: {}, userAgents: {} };

  function record(label, owner, details, allowed) {
    const url = String(details.url);
    let scheme;
    try { scheme = new URL(url).protocol; } catch { scheme = '(unparseable)'; }
    const row = {
      label,
      owner,
      url: url.slice(0, 500),
      origin: originOf(url),
      scheme,
      method: details.method || null,
      resourceType: details.resourceType || null,
      /** which renderer asked, when Chromium knows. The "name the initiator" half of P1'. */
      webContentsId: (details.webContents && details.webContents.id) || details.webContentsId || null,
      frame: details.frame ? String(details.frame.url || '').slice(0, 200) : null,
      cancelled: !allowed,
    };
    stats.observed++;
    stats.byLabel[label] = (stats.byLabel[label] || 0) + 1;
    if (!allowed) stats.cancelled++;
    if (owner === 'user' && rows.length >= USER_LOG_CAP) stats.userDropped++;
    else rows.push(row);
    const entry = made.get(label);
    if (entry) {
      // A SUBSCRIBER MUST NOT BE ABLE TO BREAK THE WIRE. `callback()` below has
      // to run or the request hangs for ever, so a throw in somebody's witness
      // is counted and swallowed rather than allowed to take the network down.
      for (const fn of entry.subscribers) { try { fn(row); } catch { /* counted by the caller, never fatal here */ } }
    }
  }

  /**
   * @param {string} label      a key of `SESSION_OWNERS` in `src/main/p1.js`
   * @param {string|null} partition  `null` for the default session
   */
  function makeSession(label, partition) {
    const owner = SESSION_OWNERS[label];
    if (!owner) {
      throw new Error(`sessions.makeSession: no owner is declared for the label '${label}'. `
        + "Add it to SESSION_OWNERS in src/main/p1.js and say whether its traffic is the APP's "
        + "(P1' binds it to one host) or the USER's (PRIVACY.md excludes it by name). "
        + 'A session with no declared owner is a session nobody decided about.');
    }
    if (made.has(label)) return made.get(label).session;

    const ses = partition === null ? electronSession.defaultSession : electronSession.fromPartition(partition);
    made.set(label, { session: ses, owner, subscribers: [] });
    stats.created++;

    /**
     * THE SIGN-IN DISGUISE, AND THE REFUSAL THAT KEEPS IT OFF OUR OWN TRAFFIC.
     *
     * `desktop-app-plan.md` seed §9: the partition youtube.com runs on presents
     * a stock Chrome user-agent, because Google refuses sign-in to an embedded
     * framework by user-agent. `src/main/useragent.js` is the string and the
     * list; this is the one line that applies it.
     *
     * IT IS SET BEFORE THIS FUNCTION RETURNS, and that ordering is load-bearing
     * rather than tidy: `Session.setUserAgent()` does not reach a `WebContents`
     * that already exists, so a UA applied after `createSourceView()` would be
     * an override that the view it exists for never sees. Every session in this
     * app is made here, before anything is put on it, so "before" is structural.
     *
     * AN `app`-OWNED SESSION IS REFUSED OUTRIGHT. The one request P1' allows is
     * the update check, and it must go to GitHub as what it is. Adding a label
     * to `UA_SESSIONS` therefore cannot quietly disguise our own traffic — it
     * stops the app at boot, here, naming the label. `tools/suites/shell.mjs`
     * asserts the same property from the table's side, in plain node.
     */
    const ua = userAgentFor(label, UA_ENV);
    if (ua !== null) {
      if (owner !== 'app') {
        ses.setUserAgent(ua);
        stats.userAgents[label] = ua;
      } else {
        throw new Error(`sessions.makeSession: '${label}' is an app-owned session and UA_SESSIONS in `
          + 'src/main/useragent.js names it. The stock Chrome user-agent exists so that Google will let the '
          + "user sign in to YouTube in the source view; putting it on the app's own session would disguise "
          + 'the one request P1\' allows (the update check) to a host we have no reason to lie to.');
      }
    }

    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      const allowed = mayRequest(owner, details.url);
      record(label, owner, details, allowed);
      callback(allowed ? {} : { cancel: true });
    });
    stats.listeners++;

    return ses;
  }

  return {
    makeSession,
    get: (label) => (made.has(label) ? made.get(label).session : null),
    /** Subscribe to one session's requests. Throws if that session does not exist yet. */
    onRequest(label, fn) {
      const entry = made.get(label);
      if (!entry) {
        throw new Error(`sessions.onRequest: there is no session labelled '${label}' yet — `
          + 'subscribe after makeSession(), not before.');
      }
      entry.subscribers.push(fn);
    },
    log: () => rows.map((r) => ({ ...r })),
    stats: () => ({ ...stats, byLabel: { ...stats.byLabel }, userAgents: { ...stats.userAgents }, labels: [...made.keys()] }),
  };
}
