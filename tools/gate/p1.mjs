/**
 * The P1' probe — one real launch, one full session, four controls.
 *
 * `src/main/main.js --gate=DIR --gate-probe=p1` imports this file, hands it the
 * live handles, and exits with what it returns. `tools/suites/p1.mjs` spawns
 * that launch behind a fake TLS host and asserts over `DIR/report.json`.
 *
 * IT NEVER ASSERTS. Every number here is an observation; the judgement is in the
 * suite, in another process, so it can be run against a report from a mutated
 * build and watched going red. A probe that decided its own verdict would be a
 * suite that exits 0 having asserted nothing.
 *
 * ---------------------------------------------------------------------------
 * THE FIVE CONTROLS, AND WHY FIVE
 * ---------------------------------------------------------------------------
 * "No request except X" is the archetypal assertion that passes by not looking.
 * Silence from a working observer and silence from an observer that was never
 * installed are the same transcript, so this probe deliberately CAUSES four
 * requests whose fate is known in advance and different in each case:
 *
 *   A  the real update check, from the app's own code, to the app's own one
 *      host. MUST be observed, MUST be allowed, and MUST reach the fake host —
 *      the last of those is evidence from outside the instrument entirely.
 *   B  a SYNTHETIC request into the `persist:youtube` partition, to a host the
 *      app is forbidden to reach. MUST be observed under the `youtube` label,
 *      MUST NOT be cancelled, and MUST reach the fake host. It is the exclusion
 *      doing its job.
 *   C  THE SAME URL, on the app's own session. MUST be observed under the `app`
 *      label, MUST be cancelled, and MUST NOT reach the fake host. This is the
 *      control that can LOSE: an exclusion written as a URL substring instead of
 *      a session owner passes B and stops failing here.
 *   D  a renderer of ours fetching an off-origin URL at all. It is refused by
 *      the CONTENT SECURITY POLICY before it reaches the network stack, so the
 *      instrument correctly sees NOTHING — and this control exists to say WHICH
 *      layer stopped it, because "the observer saw nothing" and "there was
 *      nothing to see" have to be told apart by something. It is therefore
 *      reported as a `securitypolicyviolation` EVENT, with the directive that
 *      refused it, and not as a rejected promise: every failed fetch in Chromium
 *      says `TypeError: Failed to fetch`, so the message alone cannot tell a CSP
 *      refusal from a DNS failure.
 *
 *   E  THE MAIN PROCESS'S OWN TRANSPORTS, at a real HTTP sink on 127.0.0.1 —
 *      `fetch`, `node:https`, `node:http`, `node:http2`, `node:net`,
 *      `node:tls`, `node:dgram` and `net.Socket.prototype.connect`. Every one
 *      of them MUST throw, and the sink in the suite's process MUST have
 *      recorded no connection at all. This is the control that was MISSING and
 *      that two audits exploited: A-D all ride Chromium, and `session.webRequest`
 *      is the observer for all of them, so a request that never enters Chromium
 *      is invisible to every one of them. Both auditors put one line of
 *      `fetch()` into `main.js`, watched it reach a real host, and watched this
 *      suite report 19 passed / 0 failed over it. `src/main/netguard.js` is the
 *      answer and this is how it is measured.
 *
 *      THE SINK IS NOT REACHED THROUGH A RESOLVER RULE. `--host-resolver-rules`
 *      is a Chromium switch; a `node:https` call resolves through the OS and
 *      would ignore it, so a `.invalid` host would fail with a DNS error and the
 *      control would pass by not looking. A loopback port cannot fail that way.
 *
 * B and C are the same URL through two sessions with opposite verdicts. That
 * pairing is the whole of what makes the `persist:youtube` exclusion testable
 * without YouTube.
 *
 * WHY B IS SYNTHETIC RATHER THAN ISSUED FROM THE VIEW'S PAGE: the local fixture
 * carries `default-src 'none'` in its own markup, deliberately — "the fixture
 * cannot reach the network even by accident" is what makes `transport`'s L1
 * request witness mean anything. So a `fetch()` from that page never reaches the
 * network stack and the instrument correctly sees nothing, which is the one
 * outcome this control must not have. The claim under test is about the session's
 * OWNER, and `Session.fetch` on that partition tests exactly that. That the
 * observer covers renderer-initiated traffic is asserted separately, off the
 * rows Chromium attributes to a `webContents`.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** `executeJavaScript` in the main world, with the throw kept as data. */
async function evalIn(wc, code) {
  try { return await wc.executeJavaScript(code, false); }
  catch (err) { return { THREW: String((err && err.message) || err) }; }
}

/** Fetch from a page and report what happened, never throwing out of it. */
const FETCH_IN_PAGE = (url) => `(async () => {
  try {
    const res = await fetch(${JSON.stringify(url)}, { cache: 'no-store' });
    return { ok: true, status: res.status, type: res.type };
  } catch (e) { return { ok: false, name: e.name, message: String(e.message || e) }; }
})()`;

export async function runGate({ state, outDir, sourceUrl, appRoot }) {
  fs.mkdirSync(outDir, { recursive: true });

  const R = {
    gate: 1,
    probe: 'p1',
    when: new Date().toISOString(),
    versions: process.versions,
    argv: process.argv.slice(1),
    sourceUrl,
  };

  const appSes = state.sessions.get('app');
  const ytSes = state.sessions.get('youtube');
  const chromeWc = state.chrome.webContents;
  const srcWc = state.source.webContents;

  // ------------------------------------------------------ the factory itself
  // Not "which sessions do we know about" — how many did the FACTORY make, and
  // did it install a listener for each one. Those are the two numbers that must
  // agree, and a factory that made a session without installing one is the exact
  // blindness this whole suite is about.
  R.factory = {
    ...state.sessions.stats(),
    twoDistinctSessions: !!appSes && !!ytSes && appSes !== ytSes,
    ytStoragePath: (() => { try { return String(ytSes.storagePath || ''); } catch { return null; } })(),
    appStoragePath: (() => { try { return String(appSes.storagePath || ''); } catch { return null; } })(),
  };

  // ---------------------------------------------------- A. the update check
  // It was fired at the end of `boot()`. Awaiting the promise `main` kept is
  // what makes this deterministic rather than a sleep.
  R.update = { url: state.update.url, host: state.update.host, enabled: state.update.isEnabled() };
  try { R.update.result = await state.updateCheck; } catch (e) { R.update.result = { THREW: String(e && e.message) }; }
  R.update.stats = state.update.stats();

  // --------------------------------------------- a full session, not a boot
  // Everything the app does that could put a byte on a wire: the vendored deck
  // and engine load their own assets over `app://`, the source view plays, the
  // transport drives it, and — when the weights are on disk — the engine's model
  // duties run, which is the one duty on the whole seam that fetches 109 MB.
  R.session = { drove: false, model: null };
  try {
    state.transport.drive({ currentTime: 1 });
    state.transport.drive({ playbackRate: 1 });
    await wait(300);
    state.transport.release();
    R.session.drove = true;
  } catch (err) { R.session.driveError = String((err && err.message) || err); }

  const weights = path.join(appRoot, 'models', 'htdemucs_6s.onnx');
  if (fs.existsSync(weights)) {
    R.session.model = await evalIn(state.engineWin.webContents, `(async () => {
      const h = await import('./vendor/stem-splitter-live/extension/offscreen/host.js');
      const cached = await h.modelCached();
      const t0 = performance.now();
      const got = await h.modelBytes();
      return { cached, bytes: got.bytes.byteLength, fromCache: got.fromCache, ms: Math.round(performance.now() - t0) };
    })()`);
  } else {
    R.session.model = { skipped: 'models/htdemucs_6s.onnx is not on disk' };
  }

  /**
   * THE SNAPSHOT, AND WHY IT IS TAKEN HERE RATHER THAN AT THE END.
   *
   * Everything above is the app doing its job: boot, the vendored deck and
   * engine loading their own assets, the source view playing, the transport
   * driving it, the model read, and the one request P1' permits. Everything
   * below is a control the probe CAUSES on purpose, and one of them is a
   * deliberate violation.
   *
   * Assertion 1 is about the first list and must not have to carve the second
   * out of it by matching a URL — a "set of hosts, minus these three we know
   * about" assertion is one whose exceptions grow quietly. So the clean session
   * is snapshotted before a single control runs, and the controls are asserted
   * over the full log.
   */
  R.sessionLog = state.sessions.log();

  // ------------------------------- B. the YouTube partition, to a bad host
  const BAD = 'https://telemetry.invalid/both-sessions';
  try {
    const res = await ytSes.fetch(BAD, { cache: 'no-store' });
    R.controlB = { ok: true, status: res.status };
  } catch (err) {
    R.controlB = { ok: false, message: String((err && err.message) || err) };
  }

  // ------------------------------------- C. THE SAME URL, our own session
  // Through `Session.fetch`, which is the transport `src/main/update.js` uses,
  // so this is the app's own code asking for a host it is not allowed to have.
  try {
    const res = await appSes.fetch(BAD, { cache: 'no-store' });
    R.controlC = { ok: true, status: res.status };
  } catch (err) {
    R.controlC = { ok: false, message: String((err && err.message) || err) };
  }

  // --------------------------------------- D. our renderer, off origin at all
  // The VIOLATION EVENT, not the rejection: `TypeError: Failed to fetch` is what
  // Chromium says for a CSP refusal, a DNS failure and a cancelled request
  // alike, so a suite reading the message could not tell which layer answered.
  R.controlD = await evalIn(chromeWc, `(async () => {
    const seen = [];
    const on = (e) => seen.push({ blockedURI: e.blockedURI, violatedDirective: e.violatedDirective });
    document.addEventListener('securitypolicyviolation', on);
    let err = null;
    try { await fetch('https://example.invalid/x', { cache: 'no-store' }); }
    catch (e) { err = { name: e.name, message: String(e.message || e) }; }
    await new Promise((r) => setTimeout(r, 50));
    document.removeEventListener('securitypolicyviolation', on);
    return { err, violations: seen };
  })()`);

  // ------------------------- E. the transports that leave Chromium entirely
  /**
   * EVERY ONE OF THESE MUST THROW. The URL is a REAL loopback port owned by
   * `tools/p1-sink.mjs` in the suite's process, so if a transport is not
   * refused the request completes and the sink records it — and the suite reads
   * the sink, not this report, for that half. A probe that graded its own
   * homework would be no better than the prose this replaces.
   *
   * `sinkUrl` is absent on every other launch of the app, and this whole block
   * is `tools/`, which `--gate` gates and packaging never ships.
   */
  const sinkUrl = process.env.STEM_WORKBENCH_P1_SINK || '';
  R.netGuard = { before: state.netGuard(), sinkUrl, attempts: [] };
  if (sinkUrl) {
    const u = new URL(sinkUrl);
    const port = Number(u.port);
    const shot = async (what, fn) => {
      const row = { what, threw: false, name: null, message: null };
      try {
        await fn();
      } catch (err) {
        row.threw = true;
        row.name = String((err && err.name) || '');
        row.message = String((err && err.message) || err).slice(0, 200);
      }
      R.netGuard.attempts.push(row);
    };
    /**
     * EVERY HANDLE IS GIVEN AN `error` LISTENER AND THEN DESTROYED, and that is
     * not tidiness. With the guard in place none of these lines returns at all —
     * the call throws first. With the guard REMOVED (mutation 21) they all
     * return live handles against a plain HTTP sink, and an unhandled `error`
     * on any one of them takes the main process down with it: the app would die
     * before writing a report, and the suite would go red for the WRONG reason,
     * naming "the app launches and writes a report" instead of the three
     * assertions the mutation is meant to break.
     */
    const drop = (h) => { try { h.on('error', () => {}); } catch { /* not an emitter */ } return h; };
    const kill = (h) => { try { (h.destroy || h.close || h.end).call(h); } catch { /* already gone */ } };
    await shot('globalThis.fetch()', () => fetch(`${sinkUrl}from-main-fetch`));
    await shot('https.request()', () => kill(drop(https.request('https://127.0.0.1/from-main-https')).end()));
    await shot('https.get()', () => kill(drop(https.get('https://127.0.0.1/from-main-https-get'))));
    await shot('http.request()', () => kill(drop(http.request(`${sinkUrl}from-main-http`)).end()));
    await shot('http.get()', () => kill(drop(http.get(`${sinkUrl}from-main-http-get`))));
    await shot('http2.connect()', () => kill(drop(http2.connect(sinkUrl))));
    await shot('net.connect()', () => kill(drop(net.connect(port, '127.0.0.1'))));
    await shot('net.createConnection()', () => kill(drop(net.createConnection(port, '127.0.0.1'))));
    await shot('net.Socket.prototype.connect()', () => kill(drop(new net.Socket()).connect(port, '127.0.0.1')));
    await shot('tls.connect()', () => kill(drop(tls.connect(port, '127.0.0.1'))));
    await shot('dgram.createSocket()', () => kill(drop(dgram.createSocket('udp4'))));
    /**
     * ...AND A PIPE IS NOT A NETWORK. The guard wraps
     * `net.Socket.prototype.connect` rather than removing it, because Node's own
     * child-process IPC uses that method on a path. If this row ever starts
     * throwing `P1ViolationError`, the guard has become too wide and something
     * unrelated is about to break in a way nobody will connect to this file.
     */
    await shot('net.Socket.prototype.connect() to a PIPE (must NOT be refused)',
      () => new Promise((resolve, reject) => {
        const s = new net.Socket();
        s.on('error', () => resolve());       // ENOENT: it reached the OS, which is the answer
        s.connect(path.join(outDir, 'there-is-no-socket-here.sock'));
        setTimeout(() => { try { s.destroy(); } catch { /* already gone */ } resolve(); }, 500);
      }));
    await wait(400);          // any request that WAS admitted has time to arrive
  }
  R.netGuard.after = state.netGuard();

  await wait(250);           // let the last onBeforeRequest land

  // ----------------------------------------------------------------- the log
  R.log = state.sessions.log();
  R.stats = state.sessions.stats();

  fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(R, null, 2)}\n`);
  console.log(`[gate] wrote ${path.join(outDir, 'report.json')} — ${R.log.length} observed requests`);
  return 0;
}
