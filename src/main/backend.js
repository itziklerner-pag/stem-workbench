/**
 * WHICH INFERENCE BACKEND THIS LAUNCH WILL USE — the decision, the probe that
 * informs it, and the supervisor that owns the utility process.
 *
 * ===========================================================================
 * WHAT THIS IS, AGAINST THE SEAM IT PLUGS INTO
 * ===========================================================================
 * `shared/host.js`'s `EngineHost.createBackend` builds ONE inference backend —
 * "the thing that turns 7.8 s of stereo mix into six stereo stems" — behind
 * three duties: `load(bytes)`, `separate(mix, out)`, `dispose()`. Today's ORT
 * worker (`workers/workerbackend.js`) is backend #1. This module is what
 * decides whether a SECOND implementation is used instead, and seed §16 names
 * it: CoreML, in an Electron utility process, on Apple Silicon.
 *
 * The seam does not change shape. Nothing here is a new Host duty; this is the
 * Host making its own choice behind `createBackend`, which is what the hole
 * module's own comment says that line is for.
 *
 * ===========================================================================
 * NOTHING HERE HAS EVER RUN AGAINST CoreML
 * ===========================================================================
 * This repository has no macOS machine and no Apple hardware. The CoreML path
 * is WRITTEN AND UNVERIFIED, and every gate that could only pass on Apple
 * Silicon SKIPs with a machine reason rather than pretending. What IS verified
 * on this box, and what `tools/suites/backend.mjs` gates, is:
 *   · the selection table below, every row, as a pure function;
 *   · the utility-process wire, over a FAKE native module;
 *   · and the negative control that matters most here — on Linux the native
 *     backend is unavailable, the worker is chosen, and the app works.
 * A green tick over unbuilt code is the failure this project keeps finding.
 *
 * ===========================================================================
 * THE CONSTRAINT THAT SHAPES THE WHOLE DESIGN: THERE IS NO FALLBACK LATER
 * ===========================================================================
 * The obvious design — try native, fall back inside `load()` — CANNOT WORK
 * against the frozen contract, and it took reading two files to see why:
 *
 *   · `shared/host.js`'s `Backend.load` says "IT TAKES OWNERSHIP OF `bytes` and
 *     may transfer it", so after a failed native load the 109 MB buffer may be
 *     DETACHED. There is nothing left to hand a worker.
 *   · `shared/modelcache.js::loadModel` is a TWO-ASK CEILING — "the loop cannot
 *     reach a third pass" — so the unit will not fetch a second buffer to
 *     replace it.
 *
 * So a backend that turns out not to work is not a backend that can be swapped;
 * it is a dead deck. THE PROBE THEREFORE HAS TO PROVE THE BACKEND CAN RUN
 * BEFORE IT IS SELECTED, rather than sniff the platform and hope: fork the
 * utility process, resolve the native module, ask ORT whether the CoreML EP is
 * really there. That is `probeNative()` below, and it is why it is async and
 * cached while `chooseBackend()` is pure and synchronous.
 *
 * `createBackend` is SYNCHRONOUS (`shared/host.js`: "it returns the Backend
 * rather than a promise to one … called from `Deck.ensureBackend()`, which runs
 * at engine module scope"), which is the other half of the same constraint: the
 * answer has to be in the renderer before the unit's first line runs. It
 * crosses on a `sendSync`, exactly as `deck:profile` does and for the same
 * stated reason.
 */
import path from 'node:path';

/** The two implementations. `worker` is the unit's own; `native` is seed §16's. */
export const KINDS = Object.freeze({ worker: 'worker', native: 'native' });

/**
 * What a user may ask for. `auto` is the default and the only one that consults
 * the probe; the other two are instructions.
 */
export const PREFERENCES = Object.freeze(['auto', 'native', 'worker']);

/**
 * What `probeNative()` can answer. Every one of these is a REASON, and the
 * reason travels with the decision — a deck that fell back should be able to
 * say why without anyone reading a log.
 *
 * `unsupported-platform` is answered WITHOUT FORKING ANYTHING. On Linux there
 * is nothing to ask and no process worth paying for.
 */
export const PROBES = Object.freeze([
  'ok',                     // the utility process resolved the module AND ORT reports the EP
  'no-module',              // onnxruntime-node is not installed (it is not a dependency — see below)
  'no-ep',                  // the module is there, ORT does not offer CoreML
  'crashed',                // the probe process died, or did not answer in time
  'unsupported-platform',   // not darwin/arm64 — never forked
  'not-probed',             // nobody has asked yet. NEVER treated as available
]);

/**
 * SEED §16 SCOPES THIS TO APPLE SILICON, IN ITS OWN WORDS: "CoreML first (macOS
 * first, §14; Apple Silicon), then DirectML (Windows), then CUDA." An Intel Mac
 * has no Neural Engine and CoreML there is CPU/GPU — a different claim, on
 * hardware nobody here can measure either. It gets the worker, and says so.
 */
export const nativeIsPossible = (platform, arch) => platform === 'darwin' && arch === 'arm64';

const worker = (why) => Object.freeze({ kind: KINDS.worker, ep: null, why });

/** One sentence per probe answer, written for the person reading the deck. */
const PROBE_WHY = Object.freeze({
  'no-module': 'the native inference module is not installed in this build',
  'no-ep': 'ONNX Runtime on this machine does not offer the CoreML execution provider',
  crashed: 'the native backend probe did not survive being asked',
  'not-probed': 'the native backend has not been probed, and an unprobed backend is never assumed to work',
  'unsupported-platform': 'the native backend was never probed on this platform',
});

/**
 * THE SELECTION TABLE, AS A FUNCTION. Pure: no clock, no filesystem, no
 * process. Everything it needs is an argument, which is what lets
 * `tools/suites/backend.mjs` drive every row of it on a machine where the
 * answer is always the same one.
 *
 * THE ORDER OF THE FOUR GATES IS THE POLICY, and each one is a decision the CEO
 * ratified rather than a default that fell out:
 *
 *   1. `preference: 'worker'` ALWAYS WINS. A user who asked for the worker gets
 *      the worker, whatever the hardware says.
 *   2. THE PLATFORM GATE IS ABSOLUTE, and it is above the probe on purpose: a
 *      probe result that says `ok` on Linux is an inconsistent input, and the
 *      safe reading of an inconsistent input is the conservative one. This is
 *      also the line `tools/suites/backend-mutations.sh` removes to watch the
 *      negative control go red.
 *   3. `degraded` — a native backend already failed THIS SESSION — demotes
 *      every LATER `createBackend`, and never re-selects under a live deck.
 *      Re-selecting mid-session would make `STATE.boot.ep` a lie about the
 *      session in flight, and `ep` is the only thing the deck has to report a
 *      backend with.
 *   4. Only then does the probe decide.
 *
 * AND `preference: 'native'` NEVER HARD-FAILS. An explicit ask cannot conjure
 * hardware; a startup that refuses to run is worse than one that runs on the
 * worker and says why. So every unavailable path below returns the worker with
 * a reason, and none of them throws.
 *
 * @param {{platform: string, arch: string, probe: string, preference: string,
 *          degraded?: boolean}} facts
 * @returns {{kind: 'worker'|'native', ep: string|null, why: string}}
 */
export function chooseBackend(facts) {
  const f = facts || {};
  /**
   * A GARBAGE INPUT IS A DEFECT, NOT A MACHINE PROPERTY, so it throws rather
   * than quietly becoming the worker. `normalisePreference()` is the boundary
   * that turns a user's typo into a valid value; by the time it reaches here an
   * unknown string means a caller is wrong, and swallowing that would make the
   * table below unfalsifiable — everything would "work" and one branch would
   * silently never be reached.
   */
  if (!PREFERENCES.includes(f.preference)) {
    throw new TypeError(`chooseBackend: preference must be one of ${PREFERENCES.join('|')} (got ${JSON.stringify(f.preference)})`);
  }
  if (!PROBES.includes(f.probe)) {
    throw new TypeError(`chooseBackend: probe must be one of ${PROBES.join('|')} (got ${JSON.stringify(f.probe)})`);
  }

  if (f.preference === 'worker') return worker('the ORT worker backend was asked for');

  if (!nativeIsPossible(f.platform, f.arch)) {
    return worker(`the native backend is macOS on Apple Silicon only — this is ${f.platform}/${f.arch}`);
  }

  if (f.degraded) {
    return worker('a native backend already failed in this session, so it is not selected again until restart');
  }

  if (f.probe !== 'ok') {
    return worker(PROBE_WHY[f.probe] || `the native backend probe answered ${f.probe}`);
  }

  return Object.freeze({
    kind: KINDS.native,
    /**
     * THE REQUESTED EP, AND IT IS NOT WHAT THE DECK REPORTS. `shared/host.js`
     * says `load()`'s resolution "carries which EP actually took the model", and
     * ORT falls back per node without saying so — so the string the deck shows
     * comes back from the SESSION, not from here. This field is the ask.
     */
    ep: 'coreml',
    why: 'CoreML was probed on this machine and answered',
  });
}

/**
 * A user's answer, cleaned up. An unrecognised value is a typo rather than a
 * decision, so it becomes `auto` AND SAYS SO — a silently ignored flag is a
 * flag the user believes is in effect.
 *
 * @returns {{preference: string, note: string|null}}
 */
export function normalisePreference(raw) {
  if (raw === undefined || raw === null || raw === '') return { preference: 'auto', note: null };
  const v = String(raw).trim().toLowerCase();
  if (PREFERENCES.includes(v)) return { preference: v, note: null };
  return { preference: 'auto', note: `unknown backend preference ${JSON.stringify(String(raw))} — using auto (one of ${PREFERENCES.join('|')})` };
}

/**
 * The preference this launch was given, from the command line or the
 * environment. No stored setting and no UI in step 7: the selection is a
 * function of its arguments, so adding a persisted preference later is a change
 * to this one reader and to nothing else.
 */
export function preferenceFromArgv(argv = [], env = {}) {
  const flag = (argv || []).find((a) => typeof a === 'string' && a.startsWith('--backend='));
  return normalisePreference(flag ? flag.slice('--backend='.length) : env.STEM_WORKBENCH_BACKEND);
}

/** Where the utility process's entry point lives. NOT under `tools/`. */
export const UTILITY_ENTRY = (appRoot) => path.join(appRoot, 'src', 'utility', 'inference.js');

/* -------------------------------------------------------------- the probe */

/** Settle `p` or answer `fallback` after `ms`. No clock is ever asserted on. */
const within = (p, ms, fallback) => new Promise((res) => {
  let done = false;
  const t = setTimeout(() => { if (!done) { done = true; res(fallback); } }, ms);
  p.then((v) => { if (!done) { done = true; clearTimeout(t); res(v); } },
    () => { if (!done) { done = true; clearTimeout(t); res(fallback); } });
});

/**
 * ASK THE UTILITY PROCESS WHETHER IT CAN ACTUALLY DO THE JOB.
 *
 * Not a platform sniff — see this file's header for why it cannot be one. It
 * forks the real entry point, hands it a real port, and asks it to build a real
 * engine. An engine that cannot be built answers `no-module` or `no-ep`, and
 * either way the worker is chosen and the user is told which.
 *
 * IT FORKS NOTHING OFF Apple Silicon. `unsupported-platform` is returned before
 * `fork` is reached, which is a property `tools/suites/backend.mjs` asserts with
 * a spy rather than a comment: on this Linux box the probe must cost nothing.
 *
 * A PROBE THAT DIES OR HANGS IS `crashed`, WHICH IS NOT `ok`. The whole point of
 * probing is that there is no second chance later.
 */
export async function probeNative(o) {
  const { platform, arch, fork, makeChannel, utilityEntry, timeoutMs = 20000, ep = 'coreml' } = o;
  const log = o.log || (() => {});
  if (!nativeIsPossible(platform, arch)) return 'unsupported-platform';

  let child = null;
  try {
    child = fork(utilityEntry);
    const spawned = await within(new Promise((res) => child.once('spawn', () => res(true))), timeoutMs, false);
    if (!spawned) return 'crashed';

    const { port1, port2 } = makeChannel();
    const answered = new Promise((res) => {
      port2.on('message', (e) => { const m = e && e.data; if (m && m.t === 'probed') res(m.result); });
      port2.start();
    });
    child.postMessage({ t: 'port', ep }, [port1]);
    port2.postMessage({ t: 'probe', id: 'probe' });
    const result = await within(answered, timeoutMs, 'crashed');
    return PROBES.includes(result) ? result : 'crashed';
  } catch (err) {
    log(`native backend probe failed: ${(err && err.message) || err}`);
    return 'crashed';
  } finally {
    try { if (child) child.kill(); } catch { /* it may already be gone */ }
  }
}

/* --------------------------------------------------------- the supervisor */

/**
 * OWN THE CHOICE AND THE PROCESSES, AND ANSWER THE ENGINE'S TWO QUESTIONS.
 *
 * `engine:backend` is SYNCHRONOUS and is the whole reason `ready` exists: the
 * engine's preload asks it at preload time, before any document, and `main.js`
 * must therefore await `ready` BEFORE `engineWin.loadURL`. `deck:profile`
 * carries the identical constraint and `main.js` already documents it — "a
 * handler registered after `loadURL` would leave that `sendSync` unanswered".
 *
 * ONE UTILITY PROCESS PER BACKEND, NEVER SHARED. `shared/host.js` is explicit
 * that memoising `createBackend` "re-opens exactly that grenade" — two decks
 * must not share one backend — so each `open` forks its own child and `close`
 * kills that child and no other.
 *
 * THE SENDER IS CHECKED ON BOTH CHANNELS, like every other channel in
 * `main.js`: a channel is reachable from any renderer whose preload names it.
 */
export function installBackend(o) {
  const {
    ipcMain, fork, makeChannel, utilityEntry,
    platform = process.platform, arch = process.arch,
    engine = () => null,
  } = o;
  const log = o.log || (() => {});
  const pref = o.preference !== undefined
    ? normalisePreference(o.preference)
    : preferenceFromArgv(o.argv || [], o.env || {});
  if (pref.note) log(pref.note);

  /**
   * SET WHEN A NATIVE BACKEND FAILS, AND NEVER CLEARED WHILE THE APP RUNS. It
   * demotes every LATER `createBackend` and never re-selects under a live deck,
   * because a deck's `STATE.boot.ep` is a claim about the session it is running
   * and swapping the backend under it would make that claim false.
   */
  let degraded = false;
  let choice = chooseBackend({ platform, arch, probe: 'not-probed', preference: pref.preference, degraded });

  const children = new Map();

  const ready = (async () => {
    const probe = await probeNative({ platform, arch, fork, makeChannel, utilityEntry, log });
    choice = chooseBackend({ platform, arch, probe, preference: pref.preference, degraded });
    log(`inference backend: ${choice.kind}${choice.ep ? ` (${choice.ep})` : ''} — ${choice.why}`);
    return choice;
  })();

  const fromEngine = (event) => {
    const wc = engine();
    return !!wc && !wc.isDestroyed() && event.sender === wc;
  };

  ipcMain.on('engine:backend', (event) => {
    /**
     * A PLAIN OBJECT, NOT THE FROZEN ONE. `sendSync`'s return value is
     * structured-cloned across the bridge anyway; spreading it here is what
     * keeps `chooseBackend`'s frozen result from being something a renderer
     * could ever hold a reference to.
     */
    event.returnValue = fromEngine(event)
      ? { ...choice }
      : { kind: KINDS.worker, ep: null, why: 'only the engine renderer may ask which backend is live' };
  });

  ipcMain.handle('engine:backend:open', async (event, id) => {
    if (!fromEngine(event)) return { ok: false, error: 'only the engine renderer may open a native backend' };
    if (typeof id !== 'string' || !id) return { ok: false, error: 'a backend id must be a non-empty string' };
    if (choice.kind !== KINDS.native) return { ok: false, error: `this launch is on the ${choice.kind} backend — ${choice.why}` };
    if (children.has(id)) return { ok: false, error: `backend ${id} is already open` };
    try {
      const child = fork(utilityEntry);
      children.set(id, child);
      /**
       * THE PORT GOES RENDERER↔CHILD, NOT VIA HERE. Routing segments through
       * `main` would put a second structured clone of 16.5 MB on every hop for
       * no benefit; `MessageChannelMain` lets the two ends talk directly and
       * `main` keeps only the right to kill the process.
       */
      const { port1, port2 } = makeChannel();
      child.postMessage({ t: 'port', ep: choice.ep }, [port1]);
      child.once('exit', () => {
        if (children.get(id) === child) children.delete(id);
        // A child that died is a native backend that failed. The next deck goes
        // back to the worker rather than repeating it.
        degraded = true;
        choice = chooseBackend({ platform, arch, probe: 'ok', preference: pref.preference, degraded });
        log(`native backend ${id} exited — later decks fall back: ${choice.why}`);
      });
      const wc = engine();
      wc.postMessage('engine:backend:port', { id }, [port2]);
      return { ok: true };
    } catch (err) {
      children.delete(id);
      degraded = true;
      choice = chooseBackend({ platform, arch, probe: 'ok', preference: pref.preference, degraded });
      return { ok: false, error: String((err && err.message) || err) };
    }
  });

  ipcMain.on('engine:backend:close', (event, id) => {
    if (!fromEngine(event)) return;
    const child = children.get(id);
    if (!child) return;
    children.delete(id);
    try { child.kill(); } catch { /* it may already be gone */ }
  });

  return {
    ready,
    choice: () => ({ ...choice }),
    degraded: () => degraded,
    /** Kill every child. Called from `before-quit`, where nothing awaits. */
    dispose() {
      for (const [, child] of children) { try { child.kill(); } catch { /* already gone */ } }
      children.clear();
    },
  };
}
