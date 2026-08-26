#!/usr/bin/env node
/**
 * engine-host — the ENGINE half of the Host seam, over ONE real launch.
 *
 * WHAT IT GATES. That the vendored `offscreen/engine.js` BOOTS under our
 * `EngineHost` — `assertHost` accepted it, the module evaluated to its last
 * line, and it said so on the bus; that all nine duties do what
 * `vendor/…/shared/host.js` declares, driven both directly and THROUGH the unit;
 * that the 109 MB of bundled weights reach the engine whole and are verified by
 * the unit over what this Host handed it; that ONNX Runtime really got shared
 * memory (a THREAD COUNT, not a stopwatch); that a real capture opens, is
 * stereo/44100/unprocessed, names the source view's frame and feeds the engine's
 * ring; and that the three messages the Host must ORIGINATE went out with the
 * shapes Host interface v1 froze.
 *
 * WHAT IT DOES NOT GATE, stated so the absence is on the record:
 *   · THE DECK HALF. `DeckHost`, `DeckPage` and `DeckTransport` are 23 of the 32
 *     duties and none of them is here. This suite never looks at the deck view.
 *   · THE SIX `SW_*` MESSAGES the deck sends to `BUS.host` and boots by polling
 *     for (HOST-DESIGN.md §5.3, finding F1). `main` still answers none of them.
 *   · THE PERMANENT CAPTURE-MUTE GATE. This suite proves a capture OPENS and is
 *     usable; it does NOT witness the audio device. `capture-mute`
 *     (docs/TESTING.md §8) is the one that measures the speaker, and this suite
 *     cannot replace it.
 *   · SIX STEMS. `DECK_PREPARE` builds the ORT session over the real weights and
 *     runs one warm-up inference, which is the whole model path — but nothing
 *     here asserts what came OUT of it. `vendor-unit` gates the separation; the
 *     seam between "the Host wires it" and "the audio is right" is `smoke-live`,
 *     which does not exist.
 *   · WEBGPU. There is no GPU adapter on this box (`No available adapters.`), so
 *     `ep` is `wasm` here and `boot.ep === 'webgpu'` has never been observed.
 *
 * ---------------------------------------------------------------------------
 * WATCHED RED BY MUTATION — every assertion, and the edit that broke it
 * ---------------------------------------------------------------------------
 * `tools/suites/engine-host-mutations.sh` is 29 named cases, each declaring the
 * assertion NAMES it must turn red: a non-zero exit proves *something* went red,
 * not that the intended thing did. `tools/suites/coverage.py` then refuses a
 * battery in which any assertion has never appeared on a FAIL line.
 *
 * Run on 2026-08-26, Electron 44.0.0 / Chromium 152.0.7977.54 / Linux 6.17,
 * `xvfb-run`. Baseline 37 passed, 0 failed. **coverage: all 37 assertions in
 * this suite have been watched red.** The right-hand number is how many
 * assertions the case turned red IN TOTAL, because a mutation with a wide blast
 * radius is information and hiding it would make this table read narrower than
 * the truth — case 1 is wide on purpose: a Host that cannot boot cannot answer
 * anything, and that IS the claim.
 *
 *   #   the edit                                                          reds
 *   1   host.js: delete `export const captureStream`                        15
 *   2   host.js assetUrl: `.replace(/\/+$/, '')` — what path.join() does     3
 *   3   host.js assetUrl: drop the M1 containment guard                      1
 *   4   host.js modelBytes: hand over a VIEW, not the whole buffer           3
 *   5   host.js modelBytes: memoise the bytes                                1
 *   6   host.js modelBytes: announce 'download'                              1
 *   7   host.js modelBytes: `fromCache: true` beside the no-op clearModel    2
 *   8   host.js captureStream: ask for `audio: true` (Limitation 6)          7
 *   9   host.js captureStream: skip the claim                                8
 *  10   host.js onTeardown: defer the callback by a microtask                1
 *  11   host.js createBackend: drop the unit's hooks                         1
 *  12   assets.js: drop COOP + COEP from every response                      4
 *  13   engine-messages: put a `tabId` back on `source`                      2
 *  14   engine-messages: always send `deck`, even for the default            5
 *  15   engine-messages: CAPTURE_STOP without revoking the claims            1
 *  16   claims.spend(): do not consume the entry                             2
 *  17   claims.spend(): ignore the deadline                                  4
 *  18   claims.takePending(): leave the claim pending                        6
 *  19   claims.revokeAll(): keep the live claims                             3
 *  20   host.js: resolve assets one directory above the unit                 7
 *  21   host.js onMessage: guard on the wrong address                        6
 *  22   host.js captureStream: stop the audio track on the way out           1
 *  23   main.js: no `/model/` root on the protocol handler                   7
 *  24   main.js: grant the CHROME view's frame, not the source's             2
 *  25   engine-messages: originate nothing at all                           10
 *  26   main.js: never put the engine on its address                        11
 *  27   the probe writes its report somewhere nobody looks                   1
 *  28   claims.spend(): accept a token that was never minted                 5
 *  29   host.js captureStream: leave the video track on the stream           1
 *
 * FOUR OF THESE FOUND THE SUITE RATHER THAN THE CODE, which is the whole reason
 * AGENTS.md asks for a battery instead of a green:
 *
 *   · case 8 — THE FIVE SETTINGS WERE MEASURED OFF THE PROBE'S OWN CONSTRAINTS.
 *     It called `getDisplayMedia` with a COPY of the Host's constraint object, so
 *     breaking them inside `host.js` left it green. It drives
 *     `host.captureStream` now, refusal included.
 *   · case 22 — A FRAME COUNT CANNOT TELL AUDIO FROM SILENCE. Stopping the audio
 *     track left the engine counting 73,728 frames. So did leaving the fixture
 *     PAUSED, which is how it loads. Hence the LEVEL assertion, measured off the
 *     stream the Host hands back.
 *   · case 15 — "CAPTURE_STOP REVOKES EVERY CLAIM" WAS GREEN OVER AN EMPTY
 *     REGISTRY. Every token the run spends is consumed by a grant. The probe now
 *     mints one it never spends and tries to spend it after the stop, by name.
 *   · case 25 — A SUITE THAT CANNOT LOOK MUST FAIL, NOT CRASH. `O(start.source)`
 *     read `.source` off `start` before the guard ran, and the suite died with 29
 *     assertions still to go.
 *
 * AND ONE FOUND THE DESIGN. Case 12 deletes COOP and COEP: the engine reports
 * `sab=false coi=false` and ORT still reports `threads: 4`, because
 * `workers/inference.worker.js:45-49` PINS `ort.env.wasm.numThreads` and
 * `onReady` echoes the pin. `docs/HOST-DESIGN.md` §2.4 assertion 4 and §10 A5
 * read that number as proof of shared memory; it is not, and both are corrected
 * in place. The count keeps its place here for the claim it does carry.
 *
 * THE COUNTS AND THE LEVEL, and why none of them is a stopwatch: the BYTE count
 * (114,559,139, exactly `MODEL.bytes`) says the whole file arrived; the FRAME
 * count says the ring is fed at the context's rate; and the PEAK (0.5000, the
 * fixture's own amplitude, while the view is muted) says the capture carries
 * audio, which the frame count provably cannot.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createCaptureClaims } from '../../src/main/claims.js';
import { createEngineMessages } from '../../src/main/engine-messages.js';
import { ENGINE_HOST_DUTIES, BUS } from '../../vendor/stem-splitter-live/extension/shared/host.js';
import { MODEL, SR } from '../../vendor/stem-splitter-live/extension/shared/config.js';

const ID = 'engine-host';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'out', ID);
const MODEL_FILE = path.join(ROOT, 'models', 'htdemucs_6s.onnx');

/** The shared browser mutex — sibling agents run browsers on this machine. */
const LOCK = process.env.STEM_WORKBENCH_BROWSER_LOCK
  || path.join(os.tmpdir(), `stem-workbench-browser-${process.getuid ? process.getuid() : 'x'}.lock`);

// ------------------------------------------------------------- the harness
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  cond ? pass++ : fail++;
};
const done = () => {
  console.log(`\n${ID}: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};
const skip = (why) => { console.log(`SKIPPED — ${why}`); process.exit(0); };

/**
 * A REPORT FIELD IS NOT A PROMISE. Every probe in `tools/gate/engine-host.mjs`
 * returns `{THREW: '...'}` where it could not look, and a mutated build produces
 * exactly that. Reading `.length` off one of those crashes the suite with a
 * stack trace instead of printing a red — and the assertions AFTER the crash
 * never run at all, which is the expensive direction to break in.
 * `tools/suites/shell.mjs` learned this the hard way under its mutation 27.
 */
const O = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const A = (v) => (Array.isArray(v) ? v : []);
const eqSet = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// ==========================================================================
// 1. THE TWO PURE PIECES — no launch, no display, no mutex
// ==========================================================================
/**
 * `src/main/claims.js` is what makes "the engine cannot capture anything main
 * did not arm" true, and it is a Map, a clock and a token minter — so it is
 * asserted here, directly, with a clock the suite moves. A `sleep` could carry
 * neither of the two claims below and would make the suite slower for the
 * privilege.
 */
{
  let t = 1_000;
  let n = 0;
  const claims = createCaptureClaims({ ttlMs: 100, now: () => t, mintToken: () => `tok-${++n}` });

  const a = claims.mint({ sourceWcId: 7 });
  const first = claims.spend(a);
  const replay = claims.spend(a);
  ok('a capture claim is ONE SHOT — spending it twice refuses the second  [entry point: src/main/claims.js spend()]',
    first.ok === true && replay.ok === false && replay.code === 'unknown-token',
    `first ${JSON.stringify(first)}, replay ${replay.code || 'ACCEPTED'}`);

  const taken = claims.takePending();
  ok('...and the pending claim is consumed by the grant, so one arm buys exactly one capture  [entry point: takePending()]',
    taken !== null && taken.token === a && claims.takePending() === null,
    taken ? `consumed ${taken.token}, second take -> null` : 'nothing was pending after a successful spend');

  const b = claims.mint({});
  t += 200;                                    // past ttlMs, without a stopwatch
  const stale = claims.spend(b);
  ok('...and a claim EXPIRES rather than waiting for a gesture that has ended  [entry point: spend(), against an injected clock]',
    stale.ok === false && stale.code === 'expired', stale.code || 'ACCEPTED after 200 ms of a 100 ms ttl');

  const c = claims.mint({});
  const revoked = claims.revokeAll('disarm');
  ok('...and revoking drops every live claim, so a token cannot outlive its gesture  [entry point: revokeAll(), called by CAPTURE_STOP]',
    revoked === 1 && claims.spend(c).ok === false && claims.inspect().live === 0,
    `revoked ${revoked}; the survivor was refused; live ${claims.inspect().live}`);

  const unknown = claims.spend('never-minted-at-all');
  ok('...and a token nobody minted is refused by construction — `crypto.randomUUID()` is what a renderer would have to forge',
    unknown.ok === false && unknown.code === 'unknown-token', unknown.code || 'ACCEPTED');
}

/**
 * THE SHAPES HOST INTERFACE v1 FROZE, held against a fake bus. `assertHost`
 * cannot check for a message nobody sent, and it cannot check the shape of one
 * that WAS sent either — so the three payloads are asserted here as pure data
 * and again, over a real launch, in section 2.9.
 */
const originatedShapes = (() => {
  const outbox = [];
  const bus = { originate: (to, msg) => { outbox.push([to, msg]); return true; } };
  const claims = { mint: () => 'tok-1234', revokeAll: () => 0 };
  const em = createEngineMessages({
    bus,
    claims,
    source: () => ({ id: 3, isDestroyed: () => false, getTitle: () => 'Some Track', getURL: () => 'https://www.youtube.com/watch?v=abc' }),
  });
  em.captureStart();
  em.captureStop();
  em.deckPrepare();
  em.deckPrepare({ deck: 'B' });
  return outbox;
})();
{
  const [start, stop, prep, prepB] = originatedShapes.map(([, m]) => m);
  const addressed = originatedShapes.every(([to]) => to === BUS.engine);
  ok('CAPTURE_START carries EXACTLY `{sourceToken, source:{title,url}}` — no `streamId`, no `tabId`  [entry point: src/main/engine-messages.js captureStart()]',
    addressed
    && eqSet(Object.keys(O(start)).sort(), ['source', 'sourceToken', 'type'])
    && eqSet(Object.keys(O(O(start).source)).sort(), ['title', 'url']),
    `${JSON.stringify(Object.keys(O(start)).sort())} source ${JSON.stringify(Object.keys(O(O(start).source)).sort())}`
    + `, all addressed to '${BUS.engine}' ${addressed}`);

  ok('...and `deck` is OMITTED for the default deck and present for the other one — `deck?`, not `deck: null`',
    stop && !('deck' in stop) && prep && !('deck' in prep) && O(prepB).deck === 'B',
    `CAPTURE_STOP ${JSON.stringify(Object.keys(O(stop)))}, DECK_PREPARE ${JSON.stringify(Object.keys(O(prep)))}, `
    + `explicit B -> ${JSON.stringify(O(prepB).deck)}`);
}

// ==========================================================================
// 2. ONE REAL LAUNCH
// ==========================================================================
const electron = path.join(ROOT, 'node_modules', '.bin', 'electron');
if (!fs.existsSync(electron)) skip('electron is not installed — npm i');
if (!hasBin('xvfb-run')) skip('xvfb-run is not on PATH and this box has no DISPLAY');
if (!hasBin('flock')) skip('flock is not on PATH — the shared browser mutex cannot be taken');
if (!fs.existsSync(MODEL_FILE)) {
  // NOT a red: the weights are 109 MB, are not in git, and are seeded by
  // `bash tools/vendor-unit.sh --model`. A machine without them cannot answer
  // the model half of this suite at all, and a suite that pretended otherwise
  // would be reporting coverage it does not have.
  skip(`${path.relative(ROOT, MODEL_FILE)} is not here — run \`bash tools/vendor-unit.sh --model\` (109 MB, CC BY-NC 4.0)`);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const userData = path.join(OUT, 'userdata');
const fixture = pathToFileURL(path.join(ROOT, 'tools', 'fixture', 'player.html')).href;

const launch = await run(
  'flock', [LOCK, '-c',
    `xvfb-run -a -s '-screen 0 1280x1024x24' ${sh(electron)} . `
    + `--gate=${sh(OUT)} --gate-probe=engine-host --source-url=${sh(fixture)} --user-data=${sh(userData)}`],
  { cwd: ROOT, timeoutMs: 900_000 });
fs.writeFileSync(path.join(OUT, 'launch.log'), launch.out);

let R = null;
try { R = JSON.parse(fs.readFileSync(path.join(OUT, 'report.json'), 'utf8')); } catch { /* asserted below */ }
ok('the app launches from its real entry point and the engine probe writes a report  [entry point: `electron .` -> src/main/main.js]',
  R !== null && R.gate === 1 && R.probe === ID,
  R ? `exit ${launch.code}, electron ${R.versions.electron} / chromium ${R.versions.chrome}`
    : `exit ${launch.code}, no report.json — last line: ${lastLine(launch.out)}`);
if (!R) done();

// ------------------------------------------------------------- 2.1 it boots
/**
 * `HELLO` is `engine.js`'s LAST line and `assertHost(host, ENGINE_HOST_DUTIES)`
 * is near its first, so one message carries the whole of "the vendored engine
 * evaluated under this Host". The probe RELOADS the engine to watch a real
 * second boot rather than reading a stale flag.
 */
const hello = O(R.hello);
ok('THE VENDORED ENGINE BOOTS UNDER THIS HOST — `assertHost` accepted it and it said HELLO on the bus  '
  + '[entry point: vendor/…/offscreen/engine.js module scope, over a real reload]',
  hello.seen === true && hello.to === BUS.deck && hello.from === BUS.engine,
  hello.seen ? `HELLO ${hello.from} -> ${hello.to} ${JSON.stringify(hello.keys)}`
    : 'no HELLO after a reload — the engine module did not evaluate to its last line');

const duties = A(O(R.host).duties);
const declared = Object.keys(ENGINE_HOST_DUTIES).sort();
ok('...and the module it imported declares all nine duties, by the unit\'s own list  '
  + '[entry point: vendor/…/offscreen/host.js, against ENGINE_HOST_DUTIES]',
  declared.length === 9 && declared.every((d) => duties.includes(d)),
  O(R.host).THREW ? `the Host module could not be driven at all: ${O(R.host).THREW}`
    : `${duties.length} exported: ${duties.join(', ')}`);

// ------------------------------------------------------------ 2.2 assetUrl
const au = O(O(R.host).assetUrl);
ok('assetUrl() RESOLVES INSIDE THE UNIT\'S OWN BUNDLE, on our own origin — everything it resolves is EXECUTED (M1)  '
  + '[entry point: vendor/…/offscreen/host.js assetUrl(), called DETACHED]',
  typeof au.worklet === 'string' && au.worklet.startsWith('app://workbench/vendor/stem-splitter-live/extension/')
  && au.worklet.endsWith('/offscreen/capture-processor.js'),
  au.worklet || 'assetUrl produced nothing');

ok('...AND A PATH ENDING IN `/` KEEPS ITS TRAILING SLASH — ORT appends its own file names to it, and `path.join()` would not  '
  + '[entry point: assetUrl(), reached from workerbackend.js spawn() as the worker\'s INIT wasmDirUrl]',
  typeof au.ortDir === 'string' && au.ortDir.endsWith('/vendor/ort/'),
  au.ortDir || 'nothing');

ok('...and what it answers is FETCHABLE with a readable `.ok` — the probe workerbackend.js makes before it blames a missing file  '
  + '[entry point: assetUrl() + `fetch(url, {method:"HEAD"})`, workerbackend.js:214]',
  au.headOk === true && au.headStatus === 200, `HEAD ${au.headStatus} ok=${au.headOk} on ${au.ortFile}`);

ok('...and a path that would escape the unit is REFUSED — this is the one duty on the whole interface that can break M1',
  au.escapeRefused === true, au.escapeRefused ? au.escapeWhy : 'assetUrl("/etc/passwd") was answered instead of refused');

// --------------------------------------------------------------- 2.3 model
const mb = O(O(R.host).modelBytes);
ok(`modelBytes() HANDS OVER ALL ${MODEL.bytes.toLocaleString('en-US')} BYTES, AND THEY OWN THEIR WHOLE BUFFER — the unit TRANSFERS `
  + '`bytes.buffer` into the inference worker, so a VIEW would transfer the wrong thing  '
  + '[entry point: vendor/…/offscreen/host.js modelBytes(), reached from shared/modelcache.js loadModel()]',
  mb.length === MODEL.bytes && mb.wholeBuffer === true && mb.byteOffset === 0
  && mb.byteLength === mb.bufferByteLength,
  `${mb.length} B in ${mb.ms} ms, byteOffset ${mb.byteOffset}, ${mb.byteLength} of a ${mb.bufferByteLength} B buffer`);

ok('...and a SECOND call hands over a SECOND buffer — two decks each ask, and a memoised array would be handed over detached',
  mb.freshBufferPerCall === true,
  mb.freshBufferPerCall ? 'two calls, two buffers, same length' : 'the same buffer came back twice — the second deck would get 0 bytes');

ok("...and it ANNOUNCES ITS PHASE BEFORE ANY BYTES MOVE, and the phase is 'cache' because no byte of the user's data is being spent  "
  + '[entry point: modelBytes(onProgress), reached from engine.js loadOnce()]',
  mb.firstPhase === 'cache' && mb.firstBytes === 0 && mb.onePhase === true && mb.lastCount === MODEL.bytes,
  `first ${JSON.stringify([mb.firstPhase, mb.firstBytes])}, ${mb.phases} reports, all '${mb.firstPhase}', last count ${mb.lastCount}`);

ok('modelCached() SAYS YES WITHOUT READING THE BYTES, AND clearModel() IS AN HONEST NO-OP — the pair is ONE decision  '
  + '[entry point: modelCached() + clearModel(); shared/host.js blesses the no-op ONLY with fromCache:false]',
  O(R.host).modelCached === true && O(R.host).clearModel === 'resolved'
  && O(R.host).modelCachedAfterClear === true && mb.fromCache === false,
  `cached=${O(R.host).modelCached}, clearModel ${O(R.host).clearModel}, still cached=${O(R.host).modelCachedAfterClear}, `
  + `fromCache=${mb.fromCache} — a no-op paired with fromCache:true would turn one corrupt file into a permanently dead deck`);

// ------------------------------------------------ 2.4 STATUS, and isolation
const boot = O(R.status.boot);
ok('the engine ANSWERS a message from this Host — `send` out, `onMessage` in, and the routing guard between them  '
  + '[entry point: host.onMessage(handle) at engine.js:1137, driven with a real STATUS]',
  R.status.sent === true && R.status.answered === true && R.status.modelStatusAtAnswer === 'cached',
  R.status.answered ? `STATE came back and the engine's model status went 'unknown' -> `
    + `'${R.status.modelStatusAtAnswer}' — only \`case STATUS\` awaits host.modelCached() and writes that`
    : 'STATUS was sent and nothing came back');

ok('...and the page it answers from is CROSS-ORIGIN ISOLATED, which is this Host\'s job and not the unit\'s  '
  + '[entry point: src/main/assets.js ISOLATION_HEADERS, read back off `STATE.boot`]',
  boot.sab === true && boot.coi === true, `sab=${boot.sab} coi=${boot.coi}`);

/**
 * WHAT THIS COUNT PROVES, AND WHAT IT DOES NOT — corrected by measurement.
 *
 * It proves `createBackend` FORWARDED ITS HOOKS. `onReady({threads, adapter})`
 * arrives outside any call the unit made, so a Host that built
 * `new WorkerBackend({assetUrl})` leaves `boot.threads` null for ever and
 * nothing else in the tree goes red. Mutation 11 is exactly that edit and this
 * is the one assertion it turns red.
 *
 * IT DOES NOT PROVE THAT THREADED WASM GOT SHARED MEMORY, which is what
 * docs/HOST-DESIGN.md §2.4 and §10 A5 expected it to prove. MEASURED HERE, and
 * the design's expectation is wrong on this platform: with COOP and COEP deleted
 * from every `app://` response, the engine reports `sab=false coi=false` — and
 * ORT still reports `threads: 4`, because `workers/inference.worker.js:45-49`
 * PINS `ort.env.wasm.numThreads` and `onReady` echoes the pin rather than
 * measuring the runtime. The isolation claim is carried by `boot.sab` and
 * `boot.coi` above, which that mutation does turn red. This is finding F5.
 */
const backend = O(R.backend);
ok("createBackend FORWARDED THE UNIT'S HOOKS — `onReady({threads, adapter})` arrives outside any call the unit made, and a Host "
  + 'that dropped the spread would owe every declared duty and answer to nobody  '
  + '[entry point: host.createBackend(hooks) -> workers/workerbackend.js onReady]',
  typeof backend.threads === 'number' && backend.threads >= 2,
  `threads=${JSON.stringify(backend.threads)} adapter=${JSON.stringify(backend.adapter)} `
  + '(null threads is what a dropped `...hooks` spread looks like; the number itself is ORT\'s pin, not a measurement)');

// -------------------------------------------------- 2.5 the whole model path
const prep = O(O(R.deckPrepare).reply);
ok('DECK_PREPARE builds the ORT session over the weights THIS HOST supplied, and the unit verifies them on the way  '
  + '[entry point: src/main/engine-messages.js deckPrepare() -> engine.js case DECK_PREPARE]',
  R.deckPrepare.sent === true && prep.ok === true && typeof prep.ep === 'string',
  prep.ok ? `DECK_PREPARED ok in ${prep.ms} ms on '${prep.ep}'` : `DECK_PREPARED ${JSON.stringify(prep)}`);

const model = O(O(R.deckPrepare).model);
ok(`...and the unit's own SHA-256 over ${MODEL.bytes.toLocaleString('en-US')} bytes PASSED — the Host never verified, and never was asked to  `
  + '[entry point: shared/modelcache.js verifyModel(), over whatever host.modelBytes() handed it]',
  model.status === 'ready' && model.error === null && model.got === MODEL.bytes && model.fromCache === false,
  `status=${model.status} error=${JSON.stringify(model.error)} got=${model.got} in ${Math.round(model.ms)} ms, fromCache=${model.fromCache}`);

// ------------------------------------------------------------- 2.6 capture
const forged = O(R.forgedToken);
ok('A TOKEN NOBODY MINTED BUYS NOTHING, and captureStream REJECTS rather than resolving null  '
  + '[entry point: host.captureStream() -> capture:claim -> src/main/claims.js spend()]',
  forged.rejected === true && /never minted|already been spent/.test(String(forged.message)),
  forged.rejected ? String(forged.message) : `it resolved with ${forged.resolvedWith} — every caller is .catch-wrapped, `
    + 'so the engine would report a live capture over a stream with no track');

const gdm = O(R.gdm);
const set = O(gdm.settings);
ok('THE CAPTURE THIS HOST HANDS THE ENGINE IS STEREO, 44100 AND UNPROCESSED — all five fields, because a mono 48 kHz AGC-crushed '
  + 'capture reads 10.8x over a naive floor and is a dead product for stem separation  '
  + '[entry point: host.captureStream(), driven with a real claim; spike-capture-mute.md Limitation 6]',
  gdm.ok === true && set.channelCount === 2 && set.sampleRate === SR
  && set.autoGainControl === false && set.echoCancellation === false && set.noiseSuppression === false,
  gdm.ok ? `ch=${set.channelCount} sr=${set.sampleRate} agc=${set.autoGainControl} ec=${set.echoCancellation} ns=${set.noiseSuppression}`
    : `captureStream() refused it: ${gdm.name || ''} ${gdm.message}`);

ok('...and it carries ONE audio track and NO video track — the spec forbids an audio-only getDisplayMedia, so the Host stops the '
  + 'video track it never wanted and removes it before the engine, which stops what it is given (R5), ever sees it',
  gdm.ok === true && gdm.audioTracks === 1 && gdm.videoTracks === 0,
  gdm.ok ? `${gdm.audioTracks} audio, ${gdm.videoTracks} video` : 'there is no stream to look at');

/**
 * AND IT CARRIES SOUND. The fixture plays a 440 Hz stereo sine at amplitude 0.5
 * from the moment it loads, and the view is muted for its whole life — so a peak
 * near 0.5 measured off the Host's own stream is the product's entire premise in
 * one number: the view is silent and the capture is not.
 *
 * THIS IS THE ASSERTION THE FRAME COUNT CANNOT MAKE. Stopping the audio track
 * inside `captureStream` leaves the engine's frame counter climbing at 73,728
 * and turns this to ~0.
 *
 * It is NOT the permanent capture-mute gate: that one witnesses the audio
 * DEVICE, from outside the app, and `docs/TESTING.md` §8 owns it. This says the
 * stream has signal in it, which is a different and smaller claim.
 */
ok(`...and it carries SOUND — a peak near the fixture's 0.5 over ${O(R.gdm).levelMs} ms, measured off the stream the Host `
  + 'hands back, while the view it came from is muted  [entry point: host.captureStream(); the level the frame count cannot see]',
  gdm.ok === true && typeof gdm.peak === 'number' && gdm.peak >= 0.2
  // THE SETUP IS PART OF THE ASSERTION, again: a silent capture of a PAUSED
  // player says nothing about the Host, and the fixture loads paused.
  && O(R.fixtureBefore).paused === false,
  gdm.ok ? `peak ${Number(gdm.peak).toFixed(4)} over ${gdm.levelSamples} samples, source paused=${O(R.fixtureBefore).paused} `
    + `t=${O(R.fixtureBefore).currentTime} (silence would be ~0; ${JSON.stringify(O(gdm).diag)})`
    : 'there is no stream to listen to');

const wantDevice = `web-contents-media-stream://${O(R.sourceFrame).processId}:${O(R.sourceFrame).routingId}`;
ok('...and the grant named the SOURCE view\'s frame, read off the track rather than off the handler\'s own bookkeeping  '
  + '[entry point: src/main/capture.js setDisplayMediaRequestHandler]',
  typeof set.deviceId === 'string' && set.deviceId.startsWith(wantDevice),
  `${set.deviceId} vs the source view's ${wantDevice}`);

const started = O(R.captureStart);
ok('CAPTURE_START over the REAL path arms a real capture: main mints, the unit carries the token, the Host spends it  '
  + '[entry point: engineMessages.captureStart() -> engine.js captureStart() -> host.captureStream()]',
  started.ok === true && started.tokenLength === 36 && O(R.recording).status === 'recording',
  started.ok ? `a ${started.tokenLength}-character claim; the engine reports '${O(R.recording).status}' on ${JSON.stringify(O(started.source).title)}`
    : `${started.code}: ${started.message}`);

/**
 * A FRAME COUNT, NOT A STOPWATCH — AND A COUNT OF WHAT, EXACTLY.
 *
 * It says the stream really reached `Deck.attach()` and the capture worklet is
 * being pulled at the context's rate: one second at 44100 is 44100 frames, and
 * nothing is dropped. It CANNOT tell audio from silence — measured, not assumed:
 * stopping the audio track on the way out of `captureStream` leaves this at
 * 73,728 frames, because a `MediaStreamAudioSourceNode` over an ended track
 * still pulls silence through the graph. The LEVEL is the assertion above, over
 * the stream the Host itself hands back.
 */
const cap = O(R.captured);
ok('...and the ring is fed at the context\'s rate: at least a second of frames, none dropped  '
  + '[entry point: offscreen/deck.js attach() -> the capture worklet, counted in STATE.capture.frames]',
  R.fedWithin15s === true && cap.frames >= SR && cap.dropped === 0,
  `${cap.frames} frames (${Number(cap.seconds).toFixed(2)} s), ${cap.dropped} dropped `
  + '(a count of frames, not of sound — the level is asserted where the Host hands the stream over)');

ok('CAPTURE_STOP stops it, and takes every live claim with it — a token must not outlive its gesture  '
  + '[entry point: engineMessages.captureStop() -> claims.revokeAll()]',
  O(R.captureStop).sent === true && O(R.captureStop).status !== 'recording'
  // THE SETUP IS PART OF THE ASSERTION. Every token this run spends is consumed
  // by a grant, so "nothing is live afterwards" is true whether or not anything
  // revoked it — an estimator that saturates before the claim begins, which is
  // how the first version of this assertion stayed green with `revokeAll`
  // deleted. The probe mints one claim it never spends and then tries to spend
  // it AFTER the stop: a revoked token is not merely absent from a count, it is
  // refused BY NAME. Asserted that way rather than on the registry's size,
  // because the deck's own arm path mints claims this probe does not control.
  && O(R.claimsBeforeStop).live >= 1
  && O(R.orphanAfterStop).ok === false && O(R.orphanAfterStop).code === 'unknown-token',
  `the engine reports '${O(R.captureStop).status}'; ${O(R.claimsBeforeStop).live} live claim(s) before the stop; `
  + `the one this probe never spent came back '${O(R.orphanAfterStop).code}' after it`);

// ----------------------------------------------------- 2.7 44100, and teardown
const bootLate = O(R.bootAfterCapture);
ok(`the AudioContext this Host's page opened is at ${SR}, not the platform default  `
  + '[entry point: engine.js ensureContext(), read back off STATE.boot after a capture]',
  bootLate.sampleRate === SR,
  `sampleRate=${JSON.stringify(bootLate.sampleRate)} — a default host context opens at 48000 and inserts a resampler `
  + 'in front of a 44100 capture');

const td = O(R.teardownDrive);
ok('onTeardown() REGISTERS THE CALLER\'S OWN FUNCTION ON `pagehide`, AND IT RUNS SYNCHRONOUSLY — teardown does not await, so '
  + 'whatever is not done before it returns is not done at all  [entry point: host.onTeardown(), reached from engine.js module scope]',
  td.firedSynchronously === true,
  td.THREW ? `could not be driven: ${td.THREW}`
    : td.firedSynchronously ? 'the callback had already run when dispatchEvent() returned'
      : 'the callback had NOT run when dispatchEvent() returned — a wrapper that defers drops the track stop');

// ------------------------------------------- 2.8 what the Host ORIGINATED
/**
 * `docs/VENDORING.md`: *"You must ORIGINATE four messages. `assertHost` cannot
 * check for a message nobody sent."* Three of them are the engine's. Asserted
 * individually, by name, so a red says WHICH message went missing.
 */
const originated = A(R.originated);
const byType = (type) => originated.filter((m) => m.type === type);
/**
 * THE ENGINE'S OWN FINGERPRINT FOR EACH MESSAGE, and not `delivered` alone.
 *
 * `R.originated` is `engineMessages.sent` — the HOST'S RECORD OF ITSELF, and a
 * record is not a delivery. Mutation 25 replaces `bus.originate(...)` with
 * `true`: nothing is sent, the record is written anyway, and the shape checks
 * below stayed green over a Host that originated NOTHING. So each of the three
 * is paired with a thing only the engine can do, read out of its own STATE:
 * a capture that opened, a capture that stopped, an ORT session that exists.
 * The shape claim and the arrival claim now go red together.
 */
const arrived = {
  CAPTURE_START: O(R.captured).frames > 0,
  // A TRANSITION, NOT A STATE. "the engine is not recording" is also true of an
  // engine that was never told to start, which is exactly the world mutation 25
  // creates — so the fingerprint is that something WAS recording and then was
  // not.
  CAPTURE_STOP: O(R.captured).frames > 0
    && O(R.captureStop).status != null && O(R.captureStop).status !== 'recording',
  DECK_PREPARE: O(O(R.deckPrepare).reply).ok === true,
};
for (const [type, wantKeys, wantSourceKeys] of [['CAPTURE_START', ['source', 'sourceToken', 'type'], ['title', 'url']],
  ['CAPTURE_STOP', ['type'], null], ['DECK_PREPARE', ['type'], null]]) {
  const rows = byType(type);
  // THE PAYLOAD'S OWN KEYS TOO, not just the envelope's: the freeze removed
  // `source.tabId` because nothing in the unit read it, and a Host that put one
  // back would leave the top-level key set untouched.
  const good = rows.length > 0 && rows.every((m) => eqSet(m.keys, wantKeys) && m.delivered === true
    && (wantSourceKeys === null ? m.sourceKeys === null : eqSet(A(m.sourceKeys), wantSourceKeys)))
    && arrived[type] === true;
  ok(`the Host ORIGINATED ${type} to '${BUS.engine}', with the shape Host interface v1 froze, AND THE ENGINE ACTED ON IT  `
    + '[entry point: src/main/engine-messages.js, read back off the engine\'s own STATE in a real launch]',
    good,
    rows.length === 0 ? `NOTHING of type ${type} was ever sent`
      : `${rows.length}x keys ${JSON.stringify(rows[0].keys)}${type === 'CAPTURE_START'
        ? ` source ${JSON.stringify(rows[0].sourceKeys)} token ${rows[0].tokenLength} chars` : ''}, `
        + `all delivered; the engine acted on it: ${arrived[type]}`);
}

ok('...and every one of them was delivered — a message with no listener is dropped and counted, never retried  '
  + '[entry point: createBus() in src/main/bus.js]',
  O(R.originatedCounts).undelivered === 0 && O(O(R.busStats).dropped)['no-listener'] === 0,
  `${JSON.stringify(R.originatedCounts)}; bus dropped ${JSON.stringify(O(R.busStats).dropped)}`);

console.log(`\n${ID}: launch log ${path.relative(ROOT, path.join(OUT, 'launch.log'))} · report ${path.relative(ROOT, path.join(OUT, 'report.json'))}`);
done();

// ------------------------------------------------------------------ helpers
function hasBin(name) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  return dirs.some((d) => { try { fs.accessSync(path.join(d, name), fs.constants.X_OK); return true; } catch { return false; } });
}
function sh(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }
function lastLine(out) { const l = String(out).trim().split('\n'); return l[l.length - 1] || '(no output)'; }
function run(cmd, args, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, timeoutMs);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}
