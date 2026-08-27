#!/usr/bin/env node
/**
 * backend — WHICH inference backend, and the wire to the second one. Plain node.
 *
 * ===========================================================================
 * WHAT THIS SUITE CAN HONESTLY SAY, AND WHAT IT CANNOT
 * ===========================================================================
 * Seed §16's native backend is CoreML on Apple Silicon. THIS MACHINE IS LINUX.
 * No CoreML session has ever been created by this project, no segment has ever
 * been separated by one, and no timing has ever been measured. Everything below
 * is chosen so that it is TRUE ON THIS BOX and would be true on any box:
 *
 *   · §1 THE SELECTION TABLE — `chooseBackend()` is pure. Given a platform, an
 *     arch, a probe result and a preference it returns a decision, and every
 *     combination is driven here. No clock, no filesystem, no process.
 *   · §2 THE WIRE — `createNativeBackend` talking to `serveInference` over a
 *     real `node:worker_threads` `MessageChannel`, with a FAKE engine that
 *     writes a known pattern. That proves the protocol, the frozen buffer
 *     layout and `dispose()`'s settlement. It proves NOTHING about CoreML.
 *   · §3 THE NEGATIVE CONTROL, which is the assertion that matters most here:
 *     on this platform the native backend is unavailable, the worker is chosen,
 *     and the deck gets a working backend anyway.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED, so the absence is on the record:
 *   · THAT CoreML WORKS, or is faster, or is selected correctly on real
 *     hardware. `backend-coreml` is the step for that and it SKIPs here with a
 *     machine reason. A green tick over unbuilt code is the failure this
 *     project keeps finding.
 *   · THAT THE UTILITY PROCESS SPAWNS. `utilityProcess.fork` is Electron's and
 *     needs a running app; `installBackend()` is driven here over an injected
 *     `fork` spy, and whether Electron really forks is a claim about a launch.
 *   · THAT THE APP STILL SEPARATES. That is `engine-host`'s, over a real
 *     launch, and this suite does not repeat it.
 *
 * ===========================================================================
 * THE CONSTRAINT THE WHOLE DESIGN TURNS ON, RECORDED WHERE IT WILL BE FOUND
 * ===========================================================================
 * THERE IS NO FALLBACK AFTER `createBackend` RETURNS. It is not a preference,
 * it is forced by two clauses one file apart:
 *   · `shared/host.js`'s `Backend.load` — "IT TAKES OWNERSHIP OF `bytes` and may
 *     transfer it" — so a failed native load may leave the 109 MB DETACHED;
 *   · `shared/modelcache.js::loadModel` is a two-ask ceiling, "the loop cannot
 *     reach a third pass", so no second buffer is coming.
 * A backend that turns out not to work is therefore a dead deck, not a backend
 * to swap. That is why `probeNative()` builds a real engine rather than reading
 * `process.platform`, and why the platform gate sits ABOVE the probe in
 * `chooseBackend()` — an `ok` probe on Linux is an inconsistent input and the
 * safe reading of one is the conservative one.
 *
 * ===========================================================================
 * WATCHED RED BY MUTATION — `tools/suites/backend-mutations.sh`
 * ===========================================================================
 * Every assertion below has been watched failing against a deliberate edit of
 * the file it names. The battery declares, per case, the assertion NAMES it must
 * turn red, because a non-zero exit proves something went red and not that the
 * intended thing did. The table lives in `docs/TESTING.md` §5f.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { refuseIfCompromised } from '../lib/tree-guard.mjs';

const ID = 'backend';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
refuseIfCompromised(ID, ROOT);

// ------------------------------------------------------------------ harness
let pass = 0; let fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (cond) pass++; else fail++;
};
const done = () => {
  console.log(`\n${ID}: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};
/** What a promise did, as data, so a rejection is an assertion and not a crash. */
const settle = async (p) => {
  try { return { ok: true, value: await p }; }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
};
/** Did a synchronous call throw, and with what. */
const threw = (fn) => { try { fn(); return null; } catch (err) { return err; } };

// -------------------------------------------------------------- the modules
const B = await import(pathToFileURL(path.join(ROOT, 'src', 'main', 'backend.js')).href);
const { createNativeBackend } = await import(pathToFileURL(path.join(ROOT, 'src', 'renderer', 'native-backend.js')).href);
const { serveInference } = await import(pathToFileURL(path.join(ROOT, 'src', 'utility', 'inference-core.js')).href);
const UNIT = path.join(ROOT, 'vendor', 'stem-splitter-live', 'extension');
const { BACKEND_DUTIES, assertHost, serialiseBackend } = await import(pathToFileURL(path.join(UNIT, 'shared', 'host.js')).href);
const { SEGMENT, STEMS } = await import(pathToFileURL(path.join(UNIT, 'shared', 'config.js')).href);

/* ==========================================================================
 * §1 THE SELECTION TABLE
 * ========================================================================== */
/**
 * ONE ASSERTION PER ROW, on purpose: inverting a single row in
 * `chooseBackend()` must produce exactly one red, so the battery can name which.
 * A table driven by a loop over a fixture would go red in a block and say less.
 */
const pick = (platform, arch, probe, preference, degraded = false) =>
  B.chooseBackend({ platform, arch, probe, preference, degraded });

const row = (n, facts, want, note) => {
  const r = pick(...facts);
  ok(`selection row ${n}: ${facts[0]}/${facts[1]} probe=${facts[2]} pref=${facts[3]}${facts[4] ? ' degraded' : ''} -> ${want}`
    + `  [entry point: chooseBackend() in src/main/backend.js]`,
  r.kind === want, `${r.kind}${r.ep ? `/${r.ep}` : ''} — ${r.why}${note ? ` · ${note}` : ''}`);
};

row(1, ['darwin', 'arm64', 'ok', 'auto'], 'native');
row(2, ['darwin', 'arm64', 'ok', 'native'], 'native');
row(3, ['darwin', 'arm64', 'ok', 'worker'], 'worker', 'an explicit ask for the worker outranks available hardware');
row(4, ['darwin', 'arm64', 'no-module', 'auto'], 'worker');
row(5, ['darwin', 'arm64', 'no-module', 'native'], 'worker', 'an explicit ask cannot conjure a module');
row(6, ['darwin', 'arm64', 'no-ep', 'auto'], 'worker');
row(7, ['darwin', 'arm64', 'no-ep', 'native'], 'worker');
row(8, ['darwin', 'arm64', 'crashed', 'auto'], 'worker');
row(9, ['darwin', 'arm64', 'crashed', 'native'], 'worker');
row(10, ['darwin', 'arm64', 'not-probed', 'auto'], 'worker', 'unprobed is never assumed to work');
row(11, ['darwin', 'arm64', 'not-probed', 'native'], 'worker');
row(12, ['darwin', 'arm64', 'ok', 'auto', true], 'worker', 'sticky for the session');
row(13, ['darwin', 'arm64', 'ok', 'native', true], 'worker', 'never re-selected under a live deck');
row(14, ['darwin', 'x64', 'unsupported-platform', 'auto'], 'worker', 'Apple Silicon only, seed §16');
row(15, ['darwin', 'x64', 'unsupported-platform', 'native'], 'worker');
row(16, ['linux', 'x64', 'unsupported-platform', 'auto'], 'worker', 'THE NEGATIVE CONTROL');
row(17, ['linux', 'x64', 'unsupported-platform', 'native'], 'worker', 'even an explicit ask falls back');
row(18, ['linux', 'arm64', 'unsupported-platform', 'auto'], 'worker', 'the platform, not the arch');
row(19, ['win32', 'x64', 'unsupported-platform', 'auto'], 'worker', 'DirectML is later, not this');
row(20, ['win32', 'x64', 'unsupported-platform', 'native'], 'worker');

/**
 * AND THE PLATFORM GATE OUTRANKS AN INCONSISTENT PROBE. This is the row a
 * reader would not think to write and the one the negative control rests on: a
 * probe that answered `ok` on Linux is a probe that is wrong, and the decision
 * must not follow it. `backend-mutations.sh` case 2 removes exactly this gate.
 */
ok('a probe that claims `ok` on a platform that cannot run it is still refused  '
  + '[entry point: chooseBackend() — the platform gate sits ABOVE the probe]',
pick('linux', 'x64', 'ok', 'native').kind === 'worker',
`${pick('linux', 'x64', 'ok', 'native').kind} — ${pick('linux', 'x64', 'ok', 'native').why}`);

ok('an unknown preference THROWS rather than quietly becoming the worker  [entry point: chooseBackend()]',
  !!threw(() => B.chooseBackend({ platform: 'linux', arch: 'x64', probe: 'ok', preference: 'coreml-please' })),
  String((threw(() => B.chooseBackend({ platform: 'linux', arch: 'x64', probe: 'ok', preference: 'x' })) || {}).message || '').slice(0, 72));
ok('...and so does an unknown probe result, so a typo cannot silently disable the native path',
  !!threw(() => B.chooseBackend({ platform: 'darwin', arch: 'arm64', probe: 'fine', preference: 'auto' })));

{
  const junk = B.normalisePreference('CoreMLPlease');
  ok('a junk preference at the BOUNDARY becomes auto AND SAYS SO — a silently ignored flag is one the user believes is in effect  '
    + '[entry point: normalisePreference() in src/main/backend.js]',
  junk.preference === 'auto' && typeof junk.note === 'string' && junk.note.includes('CoreMLPlease'), junk.note || '(no note)');
  ok('...and a valid one passes through with no note', B.normalisePreference('NATIVE').preference === 'native'
    && B.normalisePreference('native').note === null);
  ok('the command line outranks the environment  [entry point: preferenceFromArgv()]',
    B.preferenceFromArgv(['--backend=worker'], { STEM_WORKBENCH_BACKEND: 'native' }).preference === 'worker'
    && B.preferenceFromArgv([], { STEM_WORKBENCH_BACKEND: 'native' }).preference === 'native'
    && B.preferenceFromArgv([], {}).preference === 'auto');
}

/**
 * THE PROBE COSTS NOTHING ON A PLATFORM THAT CANNOT RUN IT, and that is a spy
 * rather than a comment: forking a process per launch to be told "you are on
 * Linux" is exactly the thing `createBackend`'s duty warns a Host not to make a
 * user pay for.
 */
{
  let forks = 0;
  const result = await B.probeNative({
    platform: 'linux', arch: 'x64', utilityEntry: '/nonexistent',
    fork: () => { forks++; throw new Error('the probe must not have forked'); },
    makeChannel: () => { throw new Error('the probe must not have opened a channel'); },
  });
  ok('the probe forks NOTHING off Apple Silicon — it answers unsupported-platform before it reaches `fork`  '
    + '[entry point: probeNative() in src/main/backend.js]',
  result === 'unsupported-platform' && forks === 0, `${result}, ${forks} fork(s)`);
}
{
  // ...AND IT CAN LOSE: on a platform that COULD run it, the same spy is called.
  let forks = 0;
  const result = await B.probeNative({
    platform: 'darwin', arch: 'arm64', utilityEntry: '/nonexistent',
    fork: () => { forks++; throw new Error('no Electron here'); },
    makeChannel: () => ({}), timeoutMs: 200,
  });
  ok('INSTRUMENT CHECK: on darwin/arm64 the same probe DOES reach `fork`, and a fork that throws is `crashed`, not `ok`',
    forks === 1 && result === 'crashed', `${result}, ${forks} fork(s)`);
}

/**
 * THE FACT ABOUT THIS BOX, asserted rather than assumed. If this ever goes red
 * the machine changed, and every "unverified" claim in this suite's header and
 * in docs/TESTING.md has to be re-read rather than trusted.
 */
ok(`this machine cannot run the native backend — ${process.platform}/${process.arch} — which is WHY the CoreML path is unverified  `
  + '[entry point: nativeIsPossible() in src/main/backend.js]',
B.nativeIsPossible(process.platform, process.arch) === false,
`nativeIsPossible(${process.platform}, ${process.arch}) === false`);

/* ==========================================================================
 * §2 THE WIRE, OVER A FAKE ENGINE
 * ========================================================================== */
/**
 * A SMALL SEGMENT, AND THE REASON IS NOT SPEED ALONE. The layout under test is
 * `(k*2 + ch) * SEGMENT + i`, which is a formula rather than a size — driving it
 * at 343,980 would allocate 82 MB per call to assert the same arithmetic.
 * §2's last assertion is what pins the PRODUCTION numbers to the unit's own
 * constants, so a small fixture here cannot hide a wrong one there.
 */
const SEG = 64;
const PLANES = STEMS.length * 2;

/** A fake native module: the three duties, deterministic buffers, no ORT. */
function fakeEngine(opts = {}) {
  return {
    loads: 0, segs: 0,
    async load() {
      this.loads++;
      if (opts.loadThrows) throw new Error(opts.loadThrows);
      return { ep: opts.ep || 'fake-coreml', createMs: 11, warmupMs: 22 };
    },
    async runSegment(l, r, out) {
      this.segs++;
      if (opts.hangs) return new Promise(() => {});
      // One marker per PLANE, at the first sample of each plane. If the layout
      // is wrong these land in the wrong place and the assertion below says so.
      for (let p = 0; p < PLANES; p++) out[p * SEG] = p + 1;
      // ...and prove the MIX really crossed, rather than only the shape.
      out[0] = l[0] + r[0];
      return { prepMs: 1, inferMs: 2, postMs: 3 };
    },
  };
}

/** One wired pair: a backend in "the renderer", a server in "the utility process". */
function wire(opts = {}) {
  const { port1, port2 } = new MessageChannel();
  const engine = fakeEngine(opts);
  const seen = [];
  const spy = {
    postMessage: (m, t) => { seen.push(m); return port2.postMessage(m, t); },
    on: (...a) => port2.on(...a), start: () => port2.start(), close: () => port2.close(),
  };
  serveInference({ port: spy, makeEngine: async () => engine, segmentFloats: SEG, stemPlanes: PLANES });
  const events = [];
  const backend = createNativeBackend({
    hooks: {
      name: opts.name || 'deck A',
      onReady: (i) => events.push({ t: 'ready', i }),
      onFail: (e) => events.push({ t: 'fail', m: e.message }),
    },
    openPort: async () => port1, segmentFloats: SEG, stemPlanes: PLANES,
  });
  // What the CHILD received, for the assertion that `out` never travels.
  const inbound = [];
  port2.on('message', (m) => inbound.push(m && m.data ? m.data : m));
  return { backend, engine, events, inbound, sent: seen, close: () => { port1.close(); port2.close(); } };
}

{
  const w = wire();
  ok('the native backend satisfies the unit\'s own BACKEND_DUTIES  '
    + '[entry point: assertHost(backend, BACKEND_DUTIES) out of the vendored shared/host.js]',
  threw(() => assertHost(w.backend, BACKEND_DUTIES, 'the native backend')) === null);

  const loaded = await settle(w.backend.load(new ArrayBuffer(16)));
  ok('load() resolves the SESSION\'s ep, not the one that was requested — the deck\'s only channel for saying which backend is live  '
    + '[entry point: createNativeBackend().load in src/renderer/native-backend.js]',
  loaded.ok && loaded.value.ep === 'fake-coreml' && loaded.value.createMs === 11 && loaded.value.warmupMs === 22,
  loaded.ok ? JSON.stringify(loaded.value) : loaded.error);

  ok('onReady answered {threads: null, adapter: null} — the freeze block\'s legitimate answer for a native backend, not an invented number  '
    + '[entry point: shared/host.js createBackend, freeze item 6]',
  w.events.length === 1 && w.events[0].t === 'ready'
    && w.events[0].i.threads === null && w.events[0].i.adapter === null,
  JSON.stringify(w.events));

  const mix = new ArrayBuffer(2 * SEG * 4);
  const out = new ArrayBuffer(PLANES * SEG * 4);
  new Float32Array(mix)[0] = 20;
  new Float32Array(mix)[SEG] = 22;
  const sep = await settle(w.backend.separate(mix, out));
  const f = new Float32Array(out);

  ok('the MIX really crossed the wire — the child read both channels of it, not just its length',
    sep.ok && f[0] === 42, sep.ok ? `out[0] = ${f[0]} (20 + 22)` : sep.error);

  const planesRight = [];
  for (let p = 1; p < PLANES; p++) if (f[p * SEG] !== p + 1) planesRight.push(p);
  ok(`the frozen layout survived the hop — all ${PLANES} planes at (k*2 + ch) * SEGMENT + i, stem-major, left before right  `
    + '[entry point: separate() — the layout shared/host.js froze and the plan says not to change]',
  sep.ok && planesRight.length === 0,
  planesRight.length ? `planes in the wrong place: ${planesRight.join(', ')}` : `${PLANES} planes, each marked at its own offset`);

  ok('`mix` comes back as THE SAME BUFFER — borrow and return, so LivePipeline can lend it again next segment',
    sep.ok && sep.value.mix === mix);
  ok('...and `stems` IS `out`, the caller\'s own buffer, written into rather than replaced',
    sep.ok && sep.value.stems === out);
  ok('...and NEITHER IS EVER DETACHED, so a failure path cannot leave the caller holding a dead buffer  '
    + '[entry point: separate() — this Host never transfers the per-segment buffers; see the header]',
  mix.byteLength !== 0 && out.byteLength !== 0, `mix ${mix.byteLength} B, out ${out.byteLength} B`);

  const outboundKeys = w.inbound.filter((m) => m && m.t === 'separate').map((m) => Object.keys(m).sort().join(','));
  ok('`out` NEVER GOES ON THE WIRE — sending 16.5 MB of zeroes each hop would be pure cost, so only `mix` travels',
    outboundKeys.length === 1 && !outboundKeys[0].includes('out'), `separate carried: ${outboundKeys.join(' | ')}`);

  ok('the timings come back from the child rather than being invented on this side',
    sep.ok && sep.value.prepMs === 1 && sep.value.inferMs === 2 && sep.value.postMs === 3,
    sep.ok ? `prep ${sep.value.prepMs} infer ${sep.value.inferMs} post ${sep.value.postMs}` : sep.error);
  w.close();
}

/**
 * DISPOSE, OVER A BACKEND THAT HAS STOPPED ANSWERING — the only kind teardown
 * has to worry about. `shared/host.js`: "a promise left open at teardown is
 * `LivePipeline.runChunk` awaiting an answer that can never come … and the deck
 * goes silent with nothing reported."
 */
{
  const w = wire({ hangs: true, name: 'deck B' });
  await w.backend.load(new ArrayBuffer(16));
  const inflight = w.backend.separate(new ArrayBuffer(2 * SEG * 4), new ArrayBuffer(PLANES * SEG * 4));
  await new Promise((r) => setTimeout(r, 25));   // let it really reach the child and sit there
  await w.backend.dispose();
  const settled = await settle(inflight);
  ok('dispose() SETTLES a call that is genuinely inside the backend — and NAMES the backend, because two decks fail independently  '
    + '[entry point: createNativeBackend().dispose]',
  settled.ok === false && settled.error.startsWith('deck B:'), settled.error || '(it resolved!)');

  const after = await settle(w.backend.separate(new ArrayBuffer(2 * SEG * 4), new ArrayBuffer(PLANES * SEG * 4)));
  ok('...and a call that arrives AFTERWARDS is refused rather than left hanging, by name',
    after.ok === false && after.error.startsWith('deck B:'), after.error || '(it resolved!)');
  w.close();
}

/**
 * THE SERVER HALF REFUSES TOO. The wrapper settling its callers is one thing;
 * the utility process must not go on answering a backend that was given back.
 */
{
  const { port1, port2 } = new MessageChannel();
  serveInference({ port: port2, makeEngine: async () => fakeEngine(), segmentFloats: SEG, stemPlanes: PLANES });
  const replies = [];
  port1.on('message', (m) => replies.push(m));
  port1.start();
  port1.postMessage({ t: 'dispose', id: 'd' });
  await new Promise((r) => setTimeout(r, 20));
  port1.postMessage({ t: 'separate', id: 's', mix: new ArrayBuffer(2 * SEG * 4) });
  await new Promise((r) => setTimeout(r, 20));
  const refusal = replies.find((m) => m.id === 's');
  ok('the utility process refuses a separate() that arrives after dispose, rather than dropping it  '
    + '[entry point: serveInference() in src/utility/inference-core.js — a dropped call is a promise nothing settles]',
  !!refusal && refusal.ok === false, refusal ? refusal.error : '(no answer at all — the caller would hang)');
  port1.close(); port2.close();
}

/**
 * BOTH PORT FLAVOURS. Node's `worker_threads` `MessagePort` hands `on('message')`
 * THE VALUE; Electron's `MessagePortMain` hands it an EVENT with `.data`. A
 * handler written for one sees `undefined` on the other and simply never
 * answers — which the renderer experiences as a `separate()` that hangs for
 * ever, with nothing red anywhere. Every §2 assertion above runs over the Node
 * flavour, so this is the Electron one.
 */
{
  const replies = [];
  const electronish = { postMessage: (m) => replies.push(m), on() {}, start() {} };
  const srv = serveInference({ port: electronish, makeEngine: async () => fakeEngine(), segmentFloats: SEG, stemPlanes: PLANES });
  srv.receive({ data: { t: 'load', id: 'e1', bytes: new ArrayBuffer(8) } });
  await new Promise((r) => setTimeout(r, 20));
  ok('a MessagePortMain-shaped delivery ({data: msg}) is understood, not silently dropped  '
    + '[entry point: serveInference()\'s unwrap — the two port flavours differ and the failure is a hang]',
  replies.some((m) => m.t === 'loaded' && m.ok === true), JSON.stringify(replies.map((m) => m.t)));
}

/**
 * THE PRODUCTION NUMBERS ARE THE UNIT'S, not this fixture's. §2 runs at
 * SEGMENT=64 so the layout arithmetic is cheap; this is what stops that from
 * hiding a wrong constant in the shipped path.
 */
{
  const boot = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'engine-boot.js'), 'utf8');
  ok('the shipped factory takes SEGMENT and STEMS from the UNIT, not from a copy in this repository  '
    + '[entry point: src/renderer/engine-boot.js — a second copy of a constant drifts silently]',
  /import\s*\{[^}]*\bSEGMENT\b[^}]*\}\s*from\s*'\.\/vendor\/stem-splitter-live\/extension\/shared\/config\.js'/.test(boot)
    && /segmentFloats:\s*SEGMENT/.test(boot) && /stemPlanes:\s*STEMS\.length\s*\*\s*2/.test(boot),
  `SEGMENT=${SEGMENT} planes=${STEMS.length * 2}`);
}

/* ==========================================================================
 * §3 THE NEGATIVE CONTROL, AT THE SEAM
 * ========================================================================== */
/**
 * THE SHIPPED HOLE, DRIVEN OVER A STUBBED GLOBAL. `createBackend` is the one
 * line this whole task changes, and these four cases are the whole of its
 * behaviour. The module is imported fresh per case with a cache-busting query,
 * because it reads the globals lazily and a stale import would answer for the
 * previous case.
 */
const HOLE = path.join(UNIT, 'offscreen', 'host.js');
async function createBackendUnder(globals, hooks = {}) {
  const before = { e: globalThis.__wbEngine, n: globalThis.__wbNativeBackend, w: globalThis.Worker };
  globalThis.__wbEngine = globals.engine;
  globalThis.__wbNativeBackend = globals.native;
  /**
   * `Worker` IS STUBBED, AND ONLY `Worker`. `WorkerBackend`'s constructor
   * spawns one at `workers/workerbackend.js:188` and plain node has no such
   * global, so without this the worker branch CRASHES the suite instead of
   * being measured — and the worker branch is the one every assertion in this
   * section is about. The module under test is the SHIPPED hole; nothing here
   * stubs it, and nothing stubs `WorkerBackend` either, so `constructor.name`
   * below really is the unit's class.
   */
  globalThis.Worker = class Worker {
    constructor(url, o) { this.url = url; this.options = o; }
    postMessage() {} terminate() {}
  };
  try {
    const mod = await import(`${pathToFileURL(HOLE).href}?case=${Math.random()}`);
    return mod.createBackend(hooks);
  } finally {
    globalThis.__wbEngine = before.e;
    globalThis.__wbNativeBackend = before.n;
    globalThis.Worker = before.w;
  }
}
const isWorkerBackend = (b) => !!b && b.constructor && b.constructor.name === 'WorkerBackend';

{
  const b = await createBackendUnder({ engine: { backend: { kind: 'worker', ep: null, why: 'linux' } }, native: () => ({ tag: 'native' }) });
  ok('THE NEGATIVE CONTROL: told `worker`, the Host builds the unit\'s own WorkerBackend even with a native factory sitting right there  '
    + '[entry point: createBackend in vendor/…/offscreen/host.js]',
  isWorkerBackend(b), b && b.constructor ? b.constructor.name : String(b));
}
{
  const b = await createBackendUnder({ engine: { backend: { kind: 'native', ep: 'coreml', why: 'x' } }, native: undefined });
  ok('...a `native` choice with NO factory installed still degrades to the worker, rather than to a TypeError at engine module scope',
    isWorkerBackend(b), b && b.constructor ? b.constructor.name : String(b));
}
{
  const b = await createBackendUnder({ engine: undefined, native: undefined });
  ok('...and with no Host answer at all, the default is the backend that always exists',
    isWorkerBackend(b), b && b.constructor ? b.constructor.name : String(b));
}
{
  let got = null;
  const b = await createBackendUnder(
    { engine: { backend: { kind: 'native', ep: 'coreml', why: 'x' } }, native: (h) => { got = h; return { tag: 'native', load() {}, separate() {}, dispose() {} }; } },
    { name: 'deck A', onReady: () => {}, onFail: () => {} },
  );
  ok('INSTRUMENT CHECK: told `native` WITH a factory, the Host really does build the native one — so the three rows above can lose',
    !!b && b.tag === 'native', b && b.tag ? b.tag : (b && b.constructor ? b.constructor.name : String(b)));
  ok('...and the unit\'s hooks are FORWARDED WHOLE to it — the one part of this duty assertHost structurally cannot check',
    !!got && got.name === 'deck A' && typeof got.onReady === 'function' && typeof got.onFail === 'function'
    && typeof got.assetUrl === 'function', got ? Object.keys(got).sort().join(',') : '(the factory was never called)');
}

/**
 * AND ON THIS MACHINE, A NATIVE BACKEND FAILS TO SEPARATE — LOUDLY, NOT SILENTLY.
 *
 * THIS IS THE OTHER HALF OF THE NEGATIVE CONTROL, and it is the half that says
 * something a flag comparison cannot. The three rows above prove the worker is
 * CHOSEN here. This proves what would happen if it were not: the port never
 * opens, and `load()` and `separate()` REJECT BY NAME rather than hanging.
 *
 * A hang is the failure that matters. `LivePipeline.runChunk` awaits
 * `separate()` with no timeout and no cancel path, so a native backend that
 * merely never answered would leave `inFlight` set, `pump()` returning early for
 * ever, and the deck silent with nothing reported — the failure `shared/host.js`
 * spends four paragraphs on. The assertion is therefore that these SETTLE, and
 * that they settle with a sentence naming the deck.
 */
{
  const backend = createNativeBackend({
    hooks: { name: 'deck A' },
    // Exactly what `src/renderer/engine-boot.js` does when `main` never
    // installed a native bridge — which is every launch on this platform.
    openPort: async () => { throw new Error('this build has no native backend bridge'); },
    segmentFloats: SEG, stemPlanes: PLANES,
  });
  const raced = (p) => Promise.race([settle(p), new Promise((r) => setTimeout(() => r({ ok: null }), 2000))]);
  const loaded = await raced(backend.load(new ArrayBuffer(16)));
  ok('a native backend whose process cannot be opened REJECTS load() — it does not hang, which is the failure with no symptom  '
    + '[entry point: createNativeBackend().load, over the openPort this platform would give it]',
  loaded.ok === false, loaded.ok === null ? 'IT HUNG — no answer in 2 s' : String(loaded.error).slice(0, 80));
  const sep = await raced(backend.separate(new ArrayBuffer(2 * SEG * 4), new ArrayBuffer(PLANES * SEG * 4)));
  ok('...and so does separate(), so the deck reports a dead session instead of going quiet',
    sep.ok === false, sep.ok === null ? 'IT HUNG — no answer in 2 s' : String(sep.error).slice(0, 80));
}

/**
 * AND THE SEAM'S OWN QUEUE STILL WRAPS IT. `serialiseBackend` is the unit's, it
 * is what keeps one `separate()` in flight per backend, and a second queue in
 * this Host would be the duplicate the plan explicitly forbids. This asserts the
 * native backend goes THROUGH it unchanged rather than around it.
 */
{
  const w = wire({ name: 'deck A' });
  const wrapped = serialiseBackend(w.backend, 'the native backend');
  await wrapped.load(new ArrayBuffer(16));
  const a = wrapped.separate(new ArrayBuffer(2 * SEG * 4), new ArrayBuffer(PLANES * SEG * 4));
  const b = wrapped.separate(new ArrayBuffer(2 * SEG * 4), new ArrayBuffer(PLANES * SEG * 4));
  await Promise.all([settle(a), settle(b)]);
  ok('the unit\'s serialiseBackend accepts this backend and runs both calls — one at a time, with no second queue in this Host  '
    + '[entry point: serialiseBackend() in the vendored shared/host.js]',
  w.engine.segs === 2, `${w.engine.segs} segment(s) reached the engine`);
  w.close();
}

/**
 * THE SHIPPED UTILITY ENTRY RUNS THE UNIT'S OWN DSP, NOT A PORT OF IT. §2 drove
 * a FAKE engine, which proves the protocol and would prove exactly as much over
 * a reimplementation of the spectral path. This is what ties the gated wire to
 * the shipped one.
 */
{
  const src = fs.readFileSync(path.join(ROOT, 'src', 'utility', 'inference.js'), 'utf8');
  ok('the utility process imports the UNIT\'s DemucsEngine out of the vendored tree — the parity-verified STFT/iSTFT, not a retyped one  '
    + '[entry point: src/utility/inference.js]',
  /import\s*\{\s*DemucsEngine\s*\}\s*from\s*'\.\.\/\.\.\/vendor\/stem-splitter-live\/extension\/engine\/demucs\.js'/.test(src)
    && /new DemucsEngine\(ort\)/.test(src), 'DemucsEngine(ort), from vendor/…/engine/demucs.js');
  ok('...and it takes the weights from the wire rather than opening a file, which is what keeps M1 the unit\'s to enforce',
    !/readFile|createReadStream|fetch\(/.test(src), 'no file read and no fetch in the utility entry');
}

/**
 * THE MODULE THAT WOULD MAKE THIS REAL IS NOT HERE, and that is asserted rather
 * than assumed. It is why every CoreML claim in this repository is labelled
 * unverified; if it ever goes red, somebody installed it and those labels have
 * to be re-earned rather than quietly kept.
 */
{
  const present = (() => { try { return !!import.meta.resolve(B.NATIVE_MODULE); } catch { return false; } })();
  ok(`\`${B.NATIVE_MODULE}\` is NOT installed here — the second, independent reason no CoreML claim in this repository `
    + 'has been verified  [entry point: NATIVE_MODULE in src/main/backend.js, the same name src/utility/inference.js requires]',
  present === false, present ? 'IT IS INSTALLED — re-read every "unverified" label' : 'absent, as documented');
}

console.log(`\n${ID}: drove chooseBackend() over ${20} table rows and the native backend over a worker_threads MessageChannel `
  + `with a fake engine; no Electron, no window, no display, no mutex. NOTHING HERE RAN CoreML — see backend-coreml.`);
done();
