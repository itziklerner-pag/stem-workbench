/**
 * THE TRANSPORT, IN THE MIDDLE — the half of `content.js` that is not DOM.
 *
 * `src/preload/youtube.cjs` looks at the page and applies what it is told.
 * `src/main/speed.js` and `src/main/autonav.js` hold the two decisions. This
 * file is the wire between them and whoever is hosting a deck, and it owns the
 * three things that are neither a DOM read nor a pure function:
 *
 *   · WHICH EVENT MEANS WHAT. `speed.js`'s whole design is that the REASON
 *     decides, not the value — `loadedmetadata` re-asserts the user's rate and
 *     `ratechange` yields to whoever else wrote it, on the SAME want and the
 *     SAME current. That mapping lives here because here is where the event
 *     name and the claim are both in scope.
 *   · THE SECOND ALLOW-LIST ON `drive`. The deck filters, this filters again,
 *     the preload filters a third time. Three layers on purpose: `shared/host.js`
 *     freezes the write set at `muted`, `playbackRate`, `currentTime`, L1 is a
 *     security property, and this channel reaches a `<video>` on somebody
 *     else's page.
 *   · WHO MAY SPEAK. The source view's preload is the only sender allowed on
 *     `'yt'`. Addresses are assigned by `main` and never claimed by a renderer —
 *     the rule `bus.js` already follows, one channel over.
 *
 * ---------------------------------------------------------------------------
 * IT IS AN EVENT SOURCE IN `main`, NOT A WIRE TO THE DECK RENDERER
 * ---------------------------------------------------------------------------
 * `src/main/deck-host.js` takes one of these as an INJECTED DEPENDENCY and is
 * what turns it into the six `DeckTransport` duties the deck sees; a Host with
 * no player spells `transport: null` and never constructs this. So the five
 * report channels below are `on…(fn)` registrations returning an unsubscribe,
 * with fan-out — not `webContents.send`.
 *
 * TWO REASONS, and the second is the one that matters. First, the deck wire is
 * one file's job and that file is not this one. Second: these payloads MUST NOT
 * ride the `'bus'` channel. `'bus'` carries the UNIT's protocol — envelopes with
 * `{v,to,from,type}` that `ui/host.js`'s `onMessage` hands to the deck's own
 * message handler after a `to === 'ui'` guard — and a `VIDEO` or `SPEED` message
 * on it would reach a handler with no case for it. In the extension these never
 * touched `chrome.runtime` at all: they are `window.postMessage` from
 * `content.js`, a separate wire. Keeping them off the bus is what stops Host
 * traffic appearing inside the unit's namespace.
 *
 * ---------------------------------------------------------------------------
 * L1's THIRD INSTRUMENT LIVES HERE
 * ---------------------------------------------------------------------------
 * `requests()` records every URL the source view's session asks for while the
 * transport is driving it. Against the local fixture — whose media is a `blob:`
 * built in the page — anything that is not the fixture itself is a request this
 * Host caused, and a preload that resolved a media URL would show up as one. A
 * static scan cannot see code that is generated; this can.
 */
import { ipcMain } from 'electron';

import { createSpeedClaim, SPEED_EPS, SPEED_KEY_LOCK, AD_SHOWING_SEL, SPEED_JS } from './speed.js';
import { createAutonav, AUTONAV_TOGGLE_SEL, AUTONAV_CANCEL_SEL, PREFS_KEY } from './autonav.js';
// The two decisions that are worth asserting without a launch live in a file
// with no `electron` import, so `tools/suites/transport.mjs` can drive every
// branch of them in plain node. Re-exported here so the wire has one import site.
import { DRIVE_FIELDS, filterDrive, speedReasonFor } from './drive.js';

export { DRIVE_FIELDS, filterDrive, speedReasonFor };

/** preload -> main, and main -> preload. The source view is on no bus address. */
export const YT_UP = 'yt';
export const YT_DOWN = 'yt:cmd';

/** One fan-out channel. Returns an unsubscribe, like every listener in this tree. */
function channel(name, stats) {
  const fns = new Set();
  return {
    on(fn) {
      if (typeof fn !== 'function') throw new TypeError(`${name}(fn): fn must be a function`);
      fns.add(fn);
      return () => fns.delete(fn);
    },
    emit(payload) {
      stats.emitted[name] = (stats.emitted[name] || 0) + 1;
      for (const fn of [...fns]) {
        try { fn(payload); } catch (err) { console.error(`[transport] ${name} listener threw`, err); }
      }
    },
    size: () => fns.size,
  };
}

/**
 * @param {object} o
 * @param {() => Electron.WebContents|null} o.source  the source view's webContents
 * @param {(fn: (row: {url: string, resourceType: string}) => void) => void} [o.sourceRequests]
 *        subscribe to the source view's session log. NOT a session: `src/main/sessions.js`
 *        owns the one `onBeforeRequest` registration that partition is allowed to have.
 */
export function createTransport({ source, sourceRequests }) {
  /** The last state the preload pushed. `null` until it pushes one. */
  let lastState = null;
  /** Every URL the source view asked for, so L1 has a runtime witness. */
  const requests = [];
  const stats = {
    fromPreload: 0, toPreload: 0, states: 0, jumps: 0, keys: 0,
    changes: [], drives: 0, releases: 0, strangers: 0, emitted: {},
  };

  const state = channel('onState', stats);
  const jump = channel('onJump', stats);
  const speedReport = channel('onSpeedReport', stats);
  const key = channel('onKey', stats);
  const autonavReport = channel('onAutonav', stats);

  const toPreload = (cmd) => {
    const wc = source();
    if (!wc || wc.isDestroyed()) return false;
    stats.toPreload++;
    wc.send(YT_DOWN, cmd);
    return true;
  };

  const speed = createSpeedClaim({
    drive: toPreload,
    report: (payload) => speedReport.emit(payload),
    look: () => lastState,
  });

  const autonav = createAutonav({
    ask: toPreload,
    report: (payload) => autonavReport.emit(payload),
  });

  /**
   * The preload's `ended` handler is the only thing that can pause the page, and
   * it only does so while this is true. PUSHED on every change rather than asked
   * for, because `ended` has to decide synchronously and a round trip would land
   * after the end screen.
   */
  let pushedSuppress = null;
  function pushSuppress() {
    const on = autonav.suppressing();
    if (on === pushedSuppress) return;
    pushedSuppress = on;
    toPreload({ c: 'suppress', on });
  }

  /** Everything the preload needs that could have been a number, and none of it is. */
  function sendConfig() {
    toPreload({
      c: 'config',
      adSel: AD_SHOWING_SEL,
      autonavSel: AUTONAV_TOGGLE_SEL,
      cancelSel: AUTONAV_CANCEL_SEL,
      speedEps: SPEED_EPS,
      keyLock: SPEED_KEY_LOCK,
    });
    pushSuppress();
  }

  // ------------------------------------------------------ preload -> main
  const onUp = (event, msg) => {
    const wc = source();
    // THE SENDER MUST BE THE SOURCE VIEW. Not defence in depth for its own sake:
    // this channel writes a `<video>` on a page we do not control, and a second
    // renderer that could speak on it could drive that page.
    if (!wc || event.sender !== wc) { stats.strangers++; return; }
    if (!msg || typeof msg.t !== 'string') return;
    stats.fromPreload++;

    if (msg.t === 'hello') {
      // A NEW DOCUMENT. The preload's module state went with the old one, so
      // everything it needs is re-sent rather than assumed, and the claim is
      // dropped: this is a different video.
      lastState = null;
      speed.dropClaim();
      sendConfig();
      // ENGAGE ALWAYS, LOOK ONLY IF THERE IS A PLAYER. See `reassert`'s typedef
      // in src/main/autonav.js: a document with no `<video>` has nothing to
      // autoplay to next, and hunting for the toggle there can only end in the
      // advisory the deck paints on `missing`.
      autonav.reassert(true, { look: msg.have === true });
      speed.openWindow('remount');
      return;
    }

    if (msg.t === 'state') {
      stats.states++;
      // `seeking` NORMALISED TO A BOOLEAN, and only that. The preload sends it
      // on the jump paths and omits it otherwise, exactly as `content.js` does;
      // the contract says the payload carries it, so absent becomes false HERE
      // rather than in every reader.
      lastState = { ...msg, seeking: msg.seeking === true };
      state.emit(lastState);
      // THE REASON IS THE DECISION, and the event is what carries it.
      speed.apply(speedReasonFor(msg.event));
      // The player chrome is rebuilt around a source swap, which can put a
      // freshly-built toggle in front of us with the page's own value on it.
      if (msg.event === 'play' || msg.event === 'loadedmetadata') autonav.reassert();
      return;
    }

    if (msg.t === 'jump') {
      // RELAYED VERBATIM, AND IT MEANS THE PAGE MOVED — never that the user
      // consented to anything. The deck's `onContentJump` reaches `startLive`,
      // and attaching a capture is what makes the engine fetch the weights.
      stats.jumps++;
      jump.emit();
      return;
    }

    if (msg.t === 'element') {
      stats.changes.push(msg.change);
      if (msg.change !== 'arrived') {
        // A different track is a different speed, and it is home.
        speed.dropClaim();
        autonav.reassert();
      }
      speed.openWindow('remount');
      return;
    }

    if (msg.t === 'autonav') {
      autonav.observe(msg);
      pushSuppress();
      return;
    }

    if (msg.t === 'key') {
      stats.keys++;
      key.emit({ code: msg.code, key: msg.key, shift: msg.shift, alt: msg.alt, repeat: msg.repeat });
      return;
    }

    if (msg.t === 'bye') lastState = null;
  };

  ipcMain.on(YT_UP, onUp);

  /**
   * L1's runtime witness. `onBeforeRequest` on the SOURCE view's session, which
   * holds that view and nothing else, so every row here was caused by that page
   * or by us.
   */
  //
  // IT SUBSCRIBES; IT DOES NOT REGISTER. `Session.webRequest.onBeforeRequest`
  // takes ONE listener per session and REPLACES whatever was there without
  // saying so, so a second registration here would silently unhook the P1'
  // observer `src/main/sessions.js` installs on this same partition — an
  // instrument going blind with no symptom, which is the one failure both of
  // these witnesses exist to prevent.
  if (typeof sourceRequests === 'function') {
    sourceRequests((row) => { requests.push({ url: String(row.url).slice(0, 300), type: row.resourceType }); });
  }

  const api = {
    // ---------------------------------------------- the injected interface
    // `src/main/deck-host.js` turns exactly these into the six DeckTransport
    // duties and the two DeckPage duties a player is the source of.
    onState: state.on,
    onJump: jump.on,
    onSpeedReport: speedReport.on,
    onKey: key.on,
    onAutonav: autonavReport.on,

    /** `DeckTransport.drive` — the closed write set, filtered a second time. */
    drive(patch) { stats.drives++; toPreload({ c: 'drive', ...filterDrive(patch) }); },
    /** `DeckTransport.release` — unmuted, rate 1, key lock on. */
    release() { stats.releases++; toPreload({ c: 'release' }); },
    /**
     * `DeckTransport.requestSpeed` — UNFILTERED, on purpose. A rate this Host
     * cannot apply is refused and REPORTED through `onSpeedReport`, which is
     * strictly better than a silent drop; `resolveSpeed` is the one clamp and a
     * second one here would be the entry-point family again.
     */
    requestSpeed(rate) { speed.request(rate); },
    /**
     * `DeckPage.claimKeys` — which codes are the deck's right now, and whether a
     * deck is armed at all. THE HOST MUST ACT ON IT: with no deck armed those
     * keys belong to the page and must reach it untouched.
     */
    claimKeys(claim) {
      const c = claim && typeof claim === 'object' ? claim : {};
      toPreload({ c: 'keys', armed: c.armed === true, keys: Array.isArray(c.keys) ? c.keys : [] });
    },
    /**
     * The autoplay-next preference, ALREADY RESOLVED. `true` = suppress.
     *
     * `shared/host.js` flags this as the one wire a second Host must connect by
     * hand: `onAutonav` is only the REPORT half, and what tells the Host to
     * suppress is the deck writing `prefs.autoplayNext` into storage. The
     * polarity flip (`autoplayNext` -> `suppress`) happens in ONE place,
     * `resolveSuppress` in `src/main/autonav.js`; pass the raw record to
     * `setPrefs` if that is what you hold.
     *
     * @returns {boolean} did the setting actually move
     */
    setAutonav(suppress) { const moved = autonav.setSuppress(suppress); pushSuppress(); return moved; },
    setPrefs(prefs) { const moved = autonav.setPrefs(prefs); pushSuppress(); return moved; },
    /**
     * `DeckPage.ready` owes this. A deck mounted onto an already-playing video
     * is the common case, and "on change" would leave it blank until something
     * moved. All three, and none of them deduped.
     */
    resend() {
      if (lastState) state.emit(lastState);
      speed.resend();
      autonav.resend();
      toPreload({ c: 'relook' });
    },

    // ------------------------------------------------------ the Host's own
    stats,
    speed,
    autonav,
    PREFS_KEY,
    SPEED_JS,
    /**
     * Called by `main` on `did-finish-load`. THE BELT TO `hello`, which is the
     * preload's own announcement and arrives first — so this re-sends the
     * config and engages, and leaves the find window to `hello` (which knows
     * whether the document has a player) and to the `play` / `loadedmetadata` /
     * element-change paths. A preload that never ran sends no autonav
     * observations at all, so opening a window here would poll into silence.
     */
    attach() { sendConfig(); autonav.reassert(true, { look: false }); speed.openWindow('remount'); },
    /** `did-navigate-in-page` — the same-document half of a single-page app. */
    relook() { toPreload({ c: 'relook' }); },
    lastState: () => lastState,
    requests: () => requests.slice(),
    listeners: () => ({
      onState: state.size(), onJump: jump.size(), onSpeedReport: speedReport.size(),
      onKey: key.size(), onAutonav: autonavReport.size(),
    }),
    stop() {
      ipcMain.removeListener(YT_UP, onUp);
      speed.stop();
      autonav.stop();
    },
  };
  return api;
}
