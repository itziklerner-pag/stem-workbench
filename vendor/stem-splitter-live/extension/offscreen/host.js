/**
 * OURS — the ELECTRON EngineHost. This file is a HOLE, not vendored code.
 *
 * `extension/unit.json` declares two holes; this is one of them. The unit's
 * `offscreen/engine.js` does `import * as host from './host.js'` and then
 * `assertHost(host, ENGINE_HOST_DUTIES)` at module scope, so this module is what
 * makes the vendored engine run inside stem-workbench instead of inside a Chrome
 * extension. The duties, and WHY each is shaped the way it is, are declared once
 * in `../shared/host.js` (`EngineHost`) — read them there. What follows is only
 * what is peculiar to THIS Host. `vendor/.pin`'s `ours` array names this path so
 * that "did somebody edit the unit" and "did somebody edit our Host" stay two
 * separately answerable questions (CONTRIBUTING.md rule V1).
 *
 * The reference implementation this replaces is the extension's own
 * `offscreen/host.js` at `stem-splitter-live` v0.2.0. Where a duty is the SAME
 * IDEA over a different pipe it is written the same way on purpose, and where it
 * differs IN KIND it says so and says why (docs/HOST-DESIGN.md §3.6 names four;
 * three of them are on this interface).
 *
 * ---------------------------------------------------------------------------
 * THE SHAPE RULE, AND THE ONE MISTAKE `shared/host.js` NAMES AS ELECTRON'S
 * ---------------------------------------------------------------------------
 * *"An Electron preload bridge wrapped one level too deep hands over
 * `{ send: fn }`"*, and *"a duty implemented as a method that needs its `this` …
 * passes this check, works for the four duties the engine calls through the
 * namespace, and fails only at the first worklet load"* — because `engine.js`
 * hands `host.assetUrl` ITSELF to `MasterBus` and to every deck, unbound, and
 * copies it onto the `shared` bundle every Deck, LivePipeline and CachedDeck
 * reads.
 *
 * So: EVERY EXPORT BELOW IS A PLAIN FUNCTION THAT CLOSES OVER WHAT IT NEEDS AND
 * NEVER READS `this`. The preload bridge (`window.__wbEngine`) is never
 * re-exported and is never captured at import — it is looked up per call, which
 * is also what lets a gate replace the outgoing wire after boot and actually see
 * traffic.
 *
 * ---------------------------------------------------------------------------
 * THIS MODULE MUST IMPORT CLEANLY IN PLAIN NODE, AND THAT IS A REQUIREMENT
 * ---------------------------------------------------------------------------
 * The vendored `test.js`'s `group('host')` imports this file from Node and drives
 * every duty with the platform stubbed underneath it. A module-scope `window`,
 * `location` or `navigator` read here does not turn one assertion red — it takes
 * the whole `unit` step out AT IMPORT, and 612 assertions with it. Nothing below
 * touches a global until it is CALLED.
 */

import { MODEL } from '../shared/config.js';
import { BUS } from '../shared/host.js';
import { WorkerBackend } from '../workers/workerbackend.js';

/** This context's address on the unit's bus, read out of the seam's own declaration. */
const ME = BUS.engine;

/**
 * WHERE THE MODEL BYTES COME FROM UNDER THIS HOST — one path, on our own origin.
 *
 * `desktop-app-plan.md` §15 bundles the 109 MB of weights in the installer, so
 * there is no download and no store: `src/main/protocol.js` streams the file
 * from `extraResources` (packaged) or `models/` (development) at this path, and
 * `src/main/assets.js` puts COOP/COEP/CORP on it like every other response.
 * docs/HOST-DESIGN.md §7 measured the whole path: 114,559,139 bytes in 1383
 * chunks, 179 ms, zero structured clones.
 *
 * THE ORIGIN IS READ OFF THE DOCUMENT rather than spelled here, so this file
 * carries no second copy of `app://workbench` to drift from `assets.js`. Read
 * LAZILY — see the module header: `location` does not exist in Node and a
 * module-scope read would take the vendored `test.js` out at import.
 *
 * `offscreen/host-pin.js` IS DELIBERATELY LEFT AS THE EXTENSION'S. It is not one
 * of `unit.json`'s two holes; it is the extension's own pin (an upstream weights
 * URL and a Cache API bucket), the vendored `test.js` reads it to assert claims
 * about THAT origin policy, and `tools/host.mjs` imports it. Those are claims
 * about the extension, not about us, and repointing them belongs with the
 * `group('host')` repointing (docs/TESTING.md §1) rather than here. Nothing in
 * this file imports it.
 *
 * THE UPSTREAM HOST'S NAME IS NOT SPELLED IN THIS FILE, and it is not a stylistic
 * choice: `test.js`'s `group('verifyModel')` greps every `.js` under `extension/`
 * for it and requires `offscreen/host-pin.js` to be the only file that carries
 * it — "that move is what took the network path out of the unit". The grep does
 * not strip comments, so a prose mention here is a real red in the unit's own
 * conformance report, and it was one until this paragraph replaced the name with
 * a description. That the string is absent is what P1' says about this Host
 * anyway: the weights ship in the installer and nothing here resolves a
 * hostname.
 */
const MODEL_PATH = '/model/htdemucs_6s.onnx';
const modelUrl = () => {
  const loc = globalThis.location;
  if (!loc || !loc.origin || loc.origin === 'null') {
    throw new Error('EngineHost.modelBytes: the weights are served from this Host\'s own origin '
      + `and there is no document here to read it from (location=${String(loc && loc.origin)})`);
  }
  return new URL(MODEL_PATH, loc.origin).href;
};

/**
 * THE PRELOAD BRIDGE, LOOKED UP PER CALL.
 *
 * `src/preload/engine.cjs` exposes `window.__wbEngine` — the bus wire and the
 * capture claim, and nothing else. It is not captured at import for two
 * reasons: a gate that replaces the wire after boot must be able to observe
 * traffic, and this module is imported from Node by `test.js` where there is no
 * `window` at all.
 */
const wire = () => globalThis.__wbEngine || null;

/**
 * THE HOST'S OWN COUNTERS, and they are READABLE FROM OUTSIDE — see
 * `__hostStats` at the foot of this file.
 *
 * A draft of this file deleted them on the theory that an ES module's exports
 * are not on `window` and `executeJavaScript` therefore could not reach them.
 * THAT IS WRONG, and it is written down here because it is the kind of wrong
 * that gets re-derived: a gate evaluates
 * `import('./vendor/…/offscreen/host.js').then((host) => …)` IN the renderer and
 * gets the live module namespace — the same instance the engine imported, not a
 * second copy. `tools/gate/engine-host.mjs` drives half the duties that way.
 *
 * What they buy is the difference between "the engine sent nothing" and "the
 * wire dropped it", which is otherwise two indistinguishable silences.
 */
const stats = {
  sent: 0, dropped: 0, received: 0, notMine: 0,
  // THE EXPORT SINK (v1.1 ADDITIVE — `ENGINE_HOST_DUTIES` gains it at the pin
  // bump; until then this export is inert to `assertHost`). Counts, never
  // stopwatches: each is a number the export gate can watch red for the thing
  // it names.
  exportSinks: 0,        // deliverable gestures opened
  exportBytes: 0,        // chunks that crossed the bridge into main
  exportClosed: 0,       // streams closed cleanly
  exportAborted: 0,      // streams aborted (main unlinked the file)
};
let announcedMissingBridge = false;
function noBridge(duty) {
  if (announcedMissingBridge) return;
  announcedMissingBridge = true;
  console.error(`[wb host] window.__wbEngine is absent, so ${duty}() has nowhere to go. `
    + 'The engine renderer was created without src/preload/engine.cjs, or the preload threw. '
    + 'Nothing downstream retries and no gate would notice the loss.');
}

/**
 * @type {import('../shared/host.js').EngineHost['send']}
 *
 * RETURNS UNDEFINED, NEVER A PROMISE. Twenty-two call sites in `engine.js` end a
 * `case` with `return send({...})` inside an `async` function; a promise here
 * would be awaited by every one of them.
 *
 * IT IS A FAN-OUT, NOT A POINT-TO-POINT LINK, and that survives the change of
 * transport: `ipcRenderer.send('bus', env)` reaches `src/main/bus.js`, which
 * delivers to EVERY renderer registered on `to`. Today that set has one member;
 * the day a first-run screen exists it will have two and nothing here changes.
 * The extension relies on the same property already — `ui/welcome.js` paints the
 * model-download progress off the engine's `STATE` messages.
 *
 * THE ENVELOPE IS STAMPED HERE, and only here. Freeze item 5: the engine's
 * `send` stamps and the deck's does not, `main` stamps only what IT originates,
 * and three stampers would be one too many.
 *
 * DELIVERY FAILURE IS SWALLOWED, on purpose and for the extension's reason: with
 * no surface open there is no listener, that is entirely normal, and one report
 * per 10 Hz heartbeat is a console nobody can read. `ipcRenderer.send` is
 * fire-and-forget, so there is not even a promise to swallow — the drop happens
 * one process away, in the router, where it is COUNTED (`bus.stats.dropped`).
 */
export const send = (msg) => {
  const w = wire();
  if (!w) { stats.dropped++; noBridge('send'); return; }
  stats.sent++;
  w.send({ v: 1, to: BUS.deck, from: ME, ...msg });
};

/**
 * @type {import('../shared/host.js').EngineHost['onMessage']}
 *
 * THE ROUTING GUARD IS THE HOST'S. `main`'s router already delivers by address,
 * so this second check is belt to its braces — and it is the one the unit's
 * interface actually asks for, so it is spelled here rather than assumed of a
 * transport that could be replaced.
 *
 * `fn` IS HANDED THE RAW ENVELOPE — the same object, not a copy, not the
 * payload, not normalised. `shared/host.js`: re-wrapping or filtering it breaks
 * receivers quietly.
 *
 * THE RETURN VALUE IS DROPPED. The extension returns `false` because MV3 reads a
 * truthy return as "I will call `sendResponse` asynchronously" and would hold the
 * message channel open; Electron has no such channel, so there is nothing to
 * hold open and nothing to return.
 *
 * IT THROWS WHEN THERE IS NO BRIDGE, unlike `send`, and the asymmetry is
 * deliberate: this is called ONCE, from `engine.js` module scope, and an engine
 * with no inbox is an engine that will never answer `STATUS` — a deck that
 * simply never paints, with nothing in the console at all, which `shared/host.js`
 * names as the quietest failure on this seam. A throw here stops the boot at the
 * line that caused it.
 */
export const onMessage = (fn) => {
  const w = wire();
  if (!w) {
    noBridge('onMessage');
    throw new Error('EngineHost.onMessage: window.__wbEngine is absent, so the engine would have no inbox '
      + '— it would boot, send HELLO, and never answer STATUS again.');
  }
  w.onMessage((m) => {
    stats.received++;
    if (!m || m.to !== ME) { stats.notMine++; return; }
    fn(m);
  });
};

/**
 * The five settings a capture must come back with, and the ONE reason this Host
 * inspects a stream the extension never had to.
 *
 * In the extension the token IS the grant: `chrome.tabCapture.getMediaStreamId`
 * returns something `getUserMedia` consumes directly with proprietary
 * constraints, and what comes back is a tab's audio at the tab's rate. Here the
 * grant is a decision made in `main` at request time and the renderer asks with
 * ordinary `getDisplayMedia` constraints — which are REQUESTS, not guarantees.
 *
 * `docs/spike-capture-mute.md` Limitation 6 is the whole argument, and it is
 * measured rather than feared: a naive `getDisplayMedia({audio: true})` on this
 * box yields MONO, 48 kHz, with automatic gain control that decays the level 17x
 * over 8 seconds — and it reads 10.8x above a naive floor, so a gate that only
 * checks "is there sound" calls it a PASS. That is a dead product for stem
 * separation. The unit cannot see this: it is handed a `MediaStream` and trusts
 * it. This is the one place the Host can, so this is where it happens.
 *
 * ALL FIVE MUST BE REPORTED AND RIGHT. "Absent" is not "fine" — a settings
 * object that does not say whether AGC is on is one this Host cannot clear, and
 * an estimator that saturates before the claim begins is the failure AGENTS.md
 * bans by name.
 */
const CAPTURE_MUST_BE = Object.freeze({
  channelCount: 2,
  sampleRate: 44100,
  autoGainControl: false,
  echoCancellation: false,
  noiseSuppression: false,
});

/**
 * @type {import('../shared/host.js').EngineHost['captureStream']}
 *
 * THE TOKEN IS OPAQUE TO THE UNIT and it is a ONE-SHOT CAPTURE CLAIM here:
 * `main` mints it in the arm path, bound to the source view and to a deadline,
 * and hands it to the engine on `CAPTURE_START`. This function spends it before
 * it asks for anything (`src/main/capture.js`), and `main`'s
 * `setDisplayMediaRequestHandler` will only answer a request that has a claim
 * pending. The correlation IS the security property: the engine cannot capture
 * anything `main` did not arm. `docs/ARCHITECTURE.md` §5 R4's mechanism (a
 * browser-level grant) does not exist here; its consequence is kept deliberately.
 *
 * `video: true` IS NOT A MISTAKE. The spec forbids an audio-only
 * `getDisplayMedia`, so a video track is always created and is stopped and
 * removed below before the stream reaches the engine.
 *
 * REJECTS RATHER THAN RESOLVING NULL — every caller is `.catch`-wrapped and a
 * null would travel on as a capture with no track.
 *
 * OWNERSHIP TRANSFERS to the engine, which stops the tracks (R5). This function
 * holds nothing and stops nothing it hands over — but it DOES stop everything on
 * every failing path after the stream exists, because a track opened and then
 * abandoned is a live capture indicator over silence with no affordance to fix
 * it.
 */
export const captureStream = async (sourceToken) => {
  const w = wire();
  if (!w) {
    noBridge('captureStream');
    throw new Error('EngineHost.captureStream: window.__wbEngine is absent — there is no way to spend the claim.');
  }

  // SPEND THE CLAIM FIRST, BEFORE ANY TRACK EXISTS. A refusal here costs
  // nothing; a refusal after `getDisplayMedia` would have to be unwound.
  const claim = await w.claimCapture(sourceToken);
  if (!claim || claim.ok !== true) {
    throw new Error(`capture refused: ${(claim && (claim.message || claim.code)) || 'the Host answered nothing'}`);
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    audio: {
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
    },
    video: true,
  });

  try {
    for (const t of stream.getVideoTracks()) { t.stop(); stream.removeTrack(t); }

    const audio = stream.getAudioTracks();
    if (audio.length !== 1) {
      throw new Error(`capture came back with ${audio.length} audio tracks, expected exactly 1`);
    }
    const got = audio[0].getSettings ? audio[0].getSettings() : null;
    if (!got) throw new Error('the capture track will not report its settings, so this Host cannot tell a usable capture from a ruined one');
    const wrong = Object.entries(CAPTURE_MUST_BE)
      .filter(([k, want]) => got[k] !== want)
      .map(([k, want]) => `${k}=${JSON.stringify(got[k])} (wanted ${JSON.stringify(want)})`);
    if (wrong.length) {
      throw new Error(`the capture is not usable for stem separation: ${wrong.join(', ')}. `
        + 'A mono, 48 kHz or gain-controlled capture looks fine to a level meter and is not the signal the model was trained on.');
    }
  } catch (err) {
    // R5, on the one path where it is not the engine's yet.
    for (const t of stream.getTracks()) t.stop();
    throw err;
  }

  return stream;
};

/**
 * OPEN ONE WRITABLE DESTINATION PER FILE OF A DELIVERABLE, WHEREVER THIS HOST
 * PUTS ONE — `EngineHost.exportSink` in the v1.1 ADDITIVE duty table (the
 * shared table gains it when the pin is bumped; this export is inert to
 * `assertHost` until then, exactly like every other extra export).
 *
 * The unit has separated a track into six planar stems and names them
 * `{title, files}`; this Host's place for them is a folder the user chose —
 * `<folder>/<title>/` — and `main` owns that directory, the ask-once dialog
 * and any collision policy (`src/main/files.js` §5). The engine renderer
 * cannot write that folder; the intake in main can, and these streams are the
 * wire between: each chunk crosses the preload bridge as bytes and lands on
 * the file descriptor main opened for its name.
 *
 * ALL SIX (OR WHATEVER THE PLAN SAYS) AT ONCE, BEHIND ONE GESTURE. `main`'s
 * `openExportSink` opens every file of the plan in one call, behind the SAME
 * ask-once folder rule the E1 writer uses — the folder is asked for exactly
 * once across the writer and this duty, and a re-export replaces.
 *
 * A REFUSAL IS A THROW, AND THIS IS THE ONE SHAPE THAT CANNOT BE RETURNED: an
 * empty map. The user cancelling the folder picker is the ordinary refusal
 * and it is an ERROR — the unit must hear "this deliverable did not happen",
 * never "exported zero files", which is what a `{}` or a map missing a stem
 * would mean. So the open is awaited and converted to a thrown Error BEFORE
 * any stream is handed out.
 *
 * THE STREAMS ARE REAL `WritableStream`s, BECAUSE THE PAYLOAD IS REAL: six
 * 32f stems of a four-minute track are ~508 MB, and "the sink accepted
 * nothing" must not look like "the sink wrote the file". APPEND-ONLY IS
 * ENOUGH and is what the streams enforce: the frame count is known before the
 * first chunk — the unit separated a finite track — so the WAV header main
 * wrote on open is correct forever and never patched, and there is no seekable
 * handle anywhere in the path.
 *
 * `WritableStream` is used only at CALL time, never at import, so this module
 * still imports cleanly in plain Node for the vendored `test.js` (module
 * header).
 *
 * @param {{title: string, files: string[]}} plan  `files` are BASE NAMES — the
 *   names the unit chose for its own files, and the names the returned map is
 *   keyed by.
 * @returns {Promise<Record<string, WritableStream>>} one stream per `plan.files`
 *   name, keyed by that same name, each stream routing `write`/`close`/`abort`
 *   to `main`'s session.
 * @throws {Error} when the plan is refused — most ordinarily because the user
 *   cancelled the folder picker — or when the wire is absent.
 */
export const exportSink = async (plan) => {
  const w = wire();
  if (!w) {
    noBridge('exportSink');
    throw new Error('EngineHost.exportSink: window.__wbEngine is absent — there is no way to open the export sink.');
  }
  if (!plan || typeof plan !== 'object' || typeof plan.title !== 'string'
      || !Array.isArray(plan.files) || plan.files.length === 0
      || plan.files.some((f) => typeof f !== 'string' || !f)) {
    throw new Error('EngineHost.exportSink: export refused — an export plan is a title and at least one file name');
  }
  // THE REFUSAL NAMES THE DUTY. The vendored unit's own group('host') drives
  // both new duties and requires `settled.resolved === false && msg.includes(duty)`
  // — a rejection whose message does not say which duty refused it is a refusal
  // that cannot be blamed, and `w.openExportSink is not a function` is exactly
  // that: it names a method, not the duty. The bridge is also the one surface
  // a pre-export preload can lack, so the guard is measured, not assumed.
  if (typeof w.openExportSink !== 'function') {
    throw new Error('EngineHost.exportSink: export refused — the bridge has no openExportSink, so nothing was opened');
  }
  const opened = await w.openExportSink({ title: plan.title, files: plan.files });
  if (!opened || opened.ok !== true) {
    throw new Error(`EngineHost.exportSink: export refused: ${(opened && (opened.message || opened.code)) || 'the Host answered nothing'}`
      + ` — nothing was opened, so nothing was exported`);
  }
  stats.exportSinks++;

  const asBytes = (chunk) => {
    if (chunk instanceof Uint8Array) return chunk;
    if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
    if (ArrayBuffer.isView(chunk)) return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    throw new TypeError('an export sink accepts bytes — a WritableStream write of anything else is a plan bug');
  };

  const makeStream = (name) => {
    let finished = false;
    return new WritableStream({
      write: async (chunk) => {
        if (finished) throw new Error(`export refused: ${name} is already closed`);
        const r = await w.writeExportSink(name, asBytes(chunk));
        if (!r || r.ok !== true) {
          throw new Error(`export refused: ${(r && (r.message || r.code)) || 'the Host answered nothing'}`
            + ` — ${name} accepted nothing`);
        }
        stats.exportBytes += (typeof r.bytes === 'number' ? r.bytes : 0);
      },
      close: async () => {
        if (finished) return;
        finished = true;
        const r = await w.closeExportSink(name);
        if (!r || r.ok !== true) {
          throw new Error(`export refused: ${(r && (r.message || r.code)) || 'the Host answered nothing'}`
            + ` — ${name} did not close`);
        }
        stats.exportClosed++;
      },
      abort: async () => {
        // Abort is a best-effort unlink and is usually reached while unwinding
        // an error; a refusal here (the name is already closed) is counted,
        // not thrown over the very error the caller is unwinding.
        if (finished) return;
        finished = true;
        const r = await w.abortExportSink(name);
        if (r && r.ok === true) stats.exportAborted++;
      },
    });
  };

  return Object.fromEntries(plan.files.map((name) => [name, makeStream(name)]));
};

/**
 * The unit's own root, derived from THIS MODULE'S LOCATION.
 *
 * `extension/offscreen/host.js` -> `extension/`. Deriving it rather than
 * spelling `app://workbench/vendor/stem-splitter-live/extension/` is what makes
 * `assetUrl`'s third obligation — THE URL MUST BE LOCAL TO THE UNIT'S OWN
 * BUNDLE (M1: everything this duty resolves EXECUTES — three worklet modules and
 * the ORT wasm runtime) — a property of the code rather than of a string
 * somebody keeps in step. Move the vendored tree and this follows it; change the
 * origin and this follows that too.
 *
 * Computed at module scope on purpose: `import.meta.url` is a module property,
 * not a global, so it is present in Node as well and this cannot be the thing
 * that takes the vendored `test.js` out at import.
 */
const UNIT_BASE = new URL('../', import.meta.url).href;

/**
 * @type {import('../shared/host.js').EngineHost['assetUrl']}
 *
 * SYNCHRONOUS, unit-relative, no leading slash:
 * `assetUrl('offscreen/capture-processor.js')`. Called from constructors that
 * run before there is an AudioContext to await on.
 *
 * A PATH ENDING IN `/` KEEPS ITS TRAILING SLASH. `workers/workerbackend.js`
 * hands `assetUrl('vendor/ort/')` to the inference worker's `INIT` and ONNX
 * Runtime appends its own file names to it. `new URL(rel, base)` preserves it;
 * `path.join()` and `url.pathToFileURL()` — the first two things a Node or
 * Electron Host reaches for — both drop it, and R0 measured what that costs:
 * ORT throws "w is not a function" several layers from the mistake. This is the
 * single most likely way for THIS Host to be wrong and it is one function call.
 *
 * THE RESULT IS FETCHABLE. `app://` is registered with
 * `supportFetchAPI: true` (`src/main/protocol.js`) precisely because
 * `workerbackend.js` probes the ORT bundle with `fetch(url, {method:'HEAD'})`,
 * and a scheme `fetch` refuses turns that diagnosis into a false report about a
 * file that is present.
 *
 * THE GUARD IS NOT DECORATION. `new URL('/etc/passwd', base)` resolves to the
 * ORIGIN root, outside the unit, and this is the one duty on the whole interface
 * that can break M1. Nothing in the unit passes such a path today; the point is
 * that it cannot start to without saying so out loud.
 */
export const assetUrl = (relPath) => {
  const rel = String(relPath);
  const url = new URL(rel, UNIT_BASE).href;
  if (!url.startsWith(UNIT_BASE)) {
    throw new Error(`EngineHost.assetUrl: '${rel}' resolves to ${url}, which is outside the unit's own bundle `
      + `(${UNIT_BASE}). Everything this duty resolves is executed — three worklets and the ORT wasm runtime — `
      + 'so it may only ever answer with a path local to the unit (M1).');
  }
  return url;
};

/**
 * @type {import('../shared/host.js').EngineHost['onTeardown']}
 *
 * THE IDENTICAL LINE THE EXTENSION USES, and that is worth saying rather than
 * hiding: under both Hosts the engine's lifetime is a document's, so the
 * teardown signal is `pagehide`. What makes it FIRE here is a decision in
 * `src/main/main.js`: the engine window is `close()`d on `before-quit` and never
 * `destroy()`ed, because `destroy()` skips `pagehide` and the leak is then a live
 * capture and a ~1.7 GB wasm heap (R5 in a different shape).
 *
 * The engine's callback is registered UNWRAPPED. Teardown does not await, so a
 * wrapper that returned a promise would drop the track stop that is the whole
 * point of the duty.
 */
export const onTeardown = (fn) => { addEventListener('pagehide', fn); };

/**
 * @type {import('../shared/host.js').EngineHost['createBackend']}
 *
 * THE IDENTICAL LINE AGAIN, and for the reason the extension's own comment
 * gives: `WorkerBackend` is UNIT code, not Chrome code — it needs a `Worker`, a
 * `fetch` and somewhere to resolve `vendor/ort/`, and none of those is
 * `chrome.*`. What makes it THIS Host's choice is this line and nothing else,
 * which is what a native backend in a utility process (seed §16, step 7)
 * replaces: one line, against an interface, rather than a fork of the engine.
 *
 * A FRESH INSTANCE EVERY CALL. Memoising is the obvious optimisation and it is
 * the one shape this duty must never take: two decks sharing one worker means
 * two ORT sessions on one wasm instance, and a concurrent `run()` there
 * PERMANENTLY WEDGES both (`offscreen/deck.js:18-25`).
 *
 * THE HOOKS ARE FORWARDED WHOLE — the one part of this duty
 * `assertHost(backend, BACKEND_DUTIES)` structurally cannot check, because a
 * backend built without them owes every declared duty and answers to nobody.
 * `...hooks` FIRST and `assetUrl` LAST, so the unit cannot overwrite the
 * resolver the Host chose.
 *
 * `assetUrl` is passed as this module's own function, UNBOUND, exactly as
 * `engine.js` passes it to `MasterBus` and to the decks. It reads no `this`.
 */
export const createBackend = (hooks) => {
  /**
   * READ LAZILY, NEVER AT IMPORT — the module header's rule, and the reason it
   * exists: `test.js`'s `group('host')` imports this file from plain Node, where
   * a module-scope global read takes the whole `unit` step out AT IMPORT rather
   * than turning one assertion red.
   *
   * TWO THINGS HAVE TO BE TRUE, and either one absent means the worker. The
   * choice comes from `src/main/backend.js` across the preload's `sendSync`
   * (the same synchronous crossing `deck:profile` uses, and for the same
   * stated reason: this duty is SYNCHRONOUS and the unit reads it at module
   * scope). The factory is installed by `src/renderer/engine-boot.js`, which
   * this page runs BEFORE the unit's entry.
   *
   * NEITHER IS A SPECIFIER THIS FILE COULD IMPORT. A relative import out of the
   * vendored tree cannot resolve in both worlds: over `app://workbench/` the
   * root is `src/renderer/`, while in plain Node it is the repository root, so
   * one specifier would be wrong in one of the two places this module has to
   * load. The handoff is therefore a global, looked up per call.
   */
  const g = globalThis;
  const choice = (g.__wbEngine && g.__wbEngine.backend) || null;
  const native = g.__wbNativeBackend || null;
  /**
   * A NATIVE CHOICE WITH NO FACTORY IS STILL THE WORKER. The two halves are
   * installed by different files at different moments, and "the Host said
   * native and nothing can build one" must degrade to a working deck rather
   * than to a `TypeError` at engine module scope.
   */
  if (choice && choice.kind === 'native' && typeof native === 'function') {
    return native({ ...hooks, choice, assetUrl });
  }
  return new WorkerBackend({ ...hooks, assetUrl });
};

/* ------------------------------------------------------------------ the model
 * THE WEIGHTS — and the half of this seam no grep for `chrome.` could ever see.
 *
 * `desktop-app-plan.md` §15: the model ships INSIDE the installer, so this Host
 * has no download, no store, and nothing to clear. `shared/host.js` anticipated
 * exactly this Host and blesses the shape — "a Host whose bytes are immutable —
 * the file vendored next to the binary … has nothing to throw away and would
 * otherwise have to satisfy this duty by lying" — ON CONDITION that
 * `fromCache: false` travels with it, so the unit stops after one ask. The two
 * are ONE DECISION and are written next to each other for that reason.
 *
 * NOTHING BELOW VERIFIES ANYTHING, and that is the design rather than an
 * omission. The SHA-256 and the byte count are the unit's
 * (`../shared/config.js`, checked by `../shared/modelcache.js::verifyModel` over
 * whatever arrives, on EVERY load). A Host that verified would be a Host that
 * could decline to, and M1 is not a property the unit can delegate.
 * -------------------------------------------------------------------------- */

/**
 * Drain a `Response` into ONE CONTIGUOUS `Uint8Array`, reporting progress.
 *
 * `byteOffset === 0 && byteLength === buffer.byteLength` is not an accident of
 * this shape, it is the reason for it: the unit TRANSFERS `bytes.buffer` into
 * the inference worker, so a `Uint8Array` that is a VIEW into something larger
 * would transfer the larger thing and bind a session over the wrong offset —
 * the bytes that passed the check would not be the bytes that ran.
 * `shared/modelcache.js::requireWholeBuffer` enforces it on every load; this is
 * the side that has to be right.
 *
 * `MODEL.bytes` is the fallback total and it is COSMETIC — our protocol handler
 * always sets `Content-Length`. It is imported here for a progress bar and for
 * nothing else; the number that DECIDES anything is the unit's, checked after
 * the last byte lands.
 */
async function readAll(res, onProgress = () => {}) {
  const total = Number(res.headers.get('Content-Length')) || MODEL.bytes;
  const reader = res.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onProgress(got, total);
  }
  const buf = new Uint8Array(got);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  return buf;
}

/**
 * @type {import('../shared/host.js').EngineHost['modelBytes']}
 *
 * A FRESH BUFFER EVERY CALL, AND NOTHING IS MEMOISED. Two decks exist and each
 * one asks; the unit detaches what it is given, so a cached `Uint8Array` would
 * hand the second load a 0-byte array. Memoising 109 MB is the obvious
 * optimisation here and it is wrong — the file is on local disk and the measured
 * cost of not doing it is 179 ms.
 *
 * `fromCache: false`, ALWAYS, and it is load-bearing rather than telemetry. The
 * bytes are immutable and shipped in the installer: asking twice cannot improve
 * them, so the unit must stop after one ask. Reporting `true` here — with the
 * no-op `clearModel` below — is the exact failure `shared/host.js` warns about:
 * one corrupt file would become a permanently dead deck that fails identically
 * for ever.
 *
 * THE PHASE IS `'cache'` AND IS ANNOUNCED BEFORE ANY BYTES MOVE. The deck reads
 * the phase to decide what a progress card may say, and "downloading" is a lie
 * about a file that shipped with the app — no byte of the user's data is being
 * spent. `fromCache` in the RESULT is the retry decision and arrives ~2 minutes
 * too late to choose wording; the phase is the authoritative signal and it is
 * authoritative from the instant the answer is known.
 */
export const modelBytes = async (onProgress = () => {}) => {
  const url = modelUrl();
  onProgress('cache', 0, MODEL.bytes);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`model read failed: HTTP ${res.status} for ${url}`);
  const bytes = await readAll(res, (g, t) => onProgress('cache', g, t));
  return { bytes, fromCache: false };
};

/**
 * @type {import('../shared/host.js').EngineHost['modelCached']}
 *
 * "Would `modelBytes()` cost a download?" — no, never, so the honest answer is
 * whether the file is THERE. A `HEAD` over `app://` answers that without reading
 * a byte: `src/main/protocol.js` `stat`s the file and returns the headers, which
 * is the same question `fs.stat` would answer over an ipc round trip and one
 * fewer channel to expose. It does NOT compare against `MODEL.bytes` and does
 * NOT hash — "is the install complete" is the Host's question, "are these the
 * right bytes" is the unit's.
 *
 * RESOLVES, NEVER REJECTS, and this duty is alone among the three in that:
 * `engine.js`'s `STATUS` case awaits it BEFORE `ensureBackend()`, `echoXf()` and
 * `push()`, so a rejection here is not a model error — it is a deck that paints
 * nothing at all, with the reason written to `state.job.error`, a field nothing
 * reads. `false` is also the safe direction: the user is offered a download they
 * may decline rather than having their data spent on a `true` nobody checked.
 *
 * A pleasant consequence of `true` for a bundled file: the deck's
 * `maybePrepare()` fires at boot, so the ORT session is built before the first
 * play instead of during it.
 */
export const modelCached = async () => {
  try {
    const res = await fetch(modelUrl(), { method: 'HEAD' });
    return res.ok === true && Number(res.headers.get('Content-Length')) > 0;
  } catch {
    return false;
  }
};

/**
 * @type {import('../shared/host.js').EngineHost['clearModel']}
 *
 * AN HONEST NO-OP, AND IT IS ONLY HONEST BECAUSE `modelBytes` REPORTS
 * `fromCache: false`. There is no store: the bytes are a read-only file inside
 * the installed app, and throwing it away is not something this Host can do or
 * should. `shared/host.js` scopes its MUST — "A HOST THAT EVER REPORTS
 * `fromCache: true` MUST REALLY DROP THAT STORE" — precisely so that a Host in
 * this position does not have to satisfy the duty by lying.
 *
 * THE CONSEQUENCE, NAMED RATHER THAN DISCOVERED: a corrupt bundled model fails
 * the unit's integrity check, this cannot help, and the deck is dead until the
 * app is reinstalled. That is the right outcome for a file that shipped in the
 * installer — the alternative is a Host that reports a store it does not have
 * and turns one corrupt file into two.
 */
export const clearModel = async () => {};

/* ------------------------------------------------------------- file bytes
 * THE FILE HALF OF `captureStream`, and the extension's own refusal names the
 * rule this side is written against: a Host mints ONE vocabulary of Source
 * tokens and answers WHICHEVER duty the engine asks, so the deck can carry one
 * token and the unit can ask for it as a stream or as bytes without knowing
 * which it is. Under this Host a token is a `createPathTokens()` handle minted
 * in `src/main/files.js` when the user picks a file — the same mint
 * `chooseSourceFile()` uses, spent by the `/file/` ROOT when the fetch below
 * lands. `captureStream` spends a CAPTURE claim and this spends a PATH token;
 * the two registries (`src/main/claims.js`, `src/main/files.js`) are separate,
 * and both are one-shot.
 *
 * THE ONE-SHOT IS NOT A CONVENIENCE OF THE ROOT, IT IS THE CONTRACT. The duty's
 * own declaration says the unit calls it EXACTLY ONCE per Source and holds the
 * decoded result for the life of the run — so a one-shot token is legitimate,
 * and a unit that retried a failed decode or re-read the source for a later
 * export would consume it twice and the second failure would present as a
 * corrupt file. Nothing here works around that; this Host is allowed to mint a
 * handle that buys one response and does.
 * -------------------------------------------------------------------------- */

/**
 * Where the bytes come from under this Host — the ONE `/file/` ROOT, on our own
 * origin, built the same way `modelUrl()` builds `/model/`: the origin is read
 * off the document rather than spelled, so this file carries no second copy of
 * `app://workbench` to drift from `src/main/assets.js`. Read LAZILY — see the
 * module header: `location` does not exist in Node and a module-scope read
 * would take the vendored `test.js` out at import.
 *
 * `encodeURIComponent` is not decoration: the token travels as a URL component
 * and the ROOT's refusal for a shape that is not one handle is `404 not one
 * /file/ handle`. A real token is a `crypto.randomUUID()` — unreserved
 * characters only — so the encoding costs nothing and makes a token that is
 * anything else refuse at the ROOT rather than after a byte has been fetched.
 */
const fileUrl = (sourceToken) => {
  const loc = globalThis.location;
  if (!loc || !loc.origin || loc.origin === 'null') {
    throw new Error('EngineHost.sourceBytes: the Source file is served from this Host\'s own origin '
      + `and there is no document here to read it from (location=${String(loc && loc.origin)})`);
  }
  return new URL('/file/' + encodeURIComponent(String(sourceToken)), loc.origin).href;
};

/**
 * @type {import('../shared/host.js').EngineHost['sourceBytes']}
 *
 * THE ENCODED BYTES OF THE SOURCE A TOKEN NAMES — the file half of
 * `captureStream`, and deliberately NOT DECODED. Handing back planar
 * `Float32Array`s would make this Host own a decoder AND a resampler, and a
 * Host that resampled badly would corrupt the source before the model saw it
 * with nothing to say so. The unit decodes, at the model clock, on the one
 * context it already has; this duty is `read a file and hand it over`, which
 * is the thing an installer-shaped product can do without lying.
 *
 * THE ROOT DOES THE REFUSING, AND THIS DUTY SURFACES THE REFUSAL AS A
 * REJECTION. A token that was never minted, was already spent, expired, or
 * names a file the allowlist does not admit is a `404`/`403` over `app://` with
 * the reason in the body — this duty turns that into a thrown Error, because
 * every caller of a promise-returning duty is `.catch`-wrapped somewhere and a
 * resolution with anything else would travel on as bytes that are not the
 * source. `captureStream` must reject rather than resolve null for the same
 * reason; this is the same rule in the same shape.
 *
 * REJECTS RATHER THAN RETURNS EMPTY, EXPLICITLY — even for a REAL file with
 * ZERO bytes. A zero-length buffer decodes to a zero-length track and caches as
 * a track that is silently not the track: the failure
 * `../shared/stemcache.js`'s header is written against. The ROOT serves a
 * zero-byte file happily (the allowlist admits it and `Content-Length: 0` is
 * honest), so the empty answer can only be refused HERE, at the handover.
 *
 * NO `onProgress`, AND THAT IS THE CONTRACT TOO. The settled signature is
 * `(sourceToken: unknown) => Promise<ArrayBuffer>` — nothing else — and unlike
 * `modelBytes` (whose progress the deck paints) nothing in the unit reads a
 * progress report from this duty. The buffer is read WHOLE into one contiguous
 * `ArrayBuffer`; a 10-minute lossless file is ~100 MB and that is the same
 * envelope `modelBytes` already sets, so it is not a new class of allocation.
 */
export const sourceBytes = async (sourceToken) => {
  const url = fileUrl(sourceToken);
  const res = await fetch(url);
  if (!res.ok) {
    let why = '';
    try { why = ` — ${String(await res.text()).slice(0, 120)}`; } catch { /* the status carries it */ }
    throw new Error(`EngineHost.sourceBytes: file read failed: HTTP ${res.status} for ${url}${why}`);
  }
  const bytes = await readAll(res);
  if (bytes.byteLength === 0) {
    throw new Error('EngineHost.sourceBytes: file read failed: the Source a token named has 0 bytes, and a zero-length buffer '
      + 'decodes to a track that is silently not the track');
  }
  return bytes.buffer;
};

/**
 * NOT A DUTY — this Host's own counters, for the gate and for a person reading a
 * console.
 *
 * `assertHost` only ever asks whether each DECLARED duty is callable, so an
 * extra export is inert to it: it cannot make a short Host look complete. It is
 * a function rather than the object so that a reader cannot mutate the numbers
 * it is reading.
 */
export const __hostStats = () => ({ ...stats });
