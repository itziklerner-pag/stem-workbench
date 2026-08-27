#!/usr/bin/env node
/**
 * backend-coreml — the CoreML claim itself. MANUAL, and it has never run.
 *
 * ===========================================================================
 * WHY THIS STEP EXISTS WHEN IT CANNOT PASS HERE
 * ===========================================================================
 * `tools/verify.mjs` carries a standing note that a suite which is not in the
 * steps table "is indistinguishable from a suite nobody thought of". Seed §16's
 * CoreML backend is written and shipped UNVERIFIED — the CEO ruled step 7 in
 * scope on a machine that cannot build or run it — and the difference between
 * that being a sentence in a document and being a fact the gate reports is this
 * file. Every run of `--manual` on this box prints, by name, the question
 * nobody has answered.
 *
 * IT IS `manual`, NOT A PERMANENT SKIP ON THE DEFAULT PLAN. `--strict` exists to
 * refuse a SKIP, because "a SKIP is the MACHINE declining a question that WAS
 * asked" — and a step that can only ever skip on every machine this project has
 * would train people to ignore exactly that signal. `youtube` is manual for the
 * same shape of reason: it needs something this box does not have. On a Mac with
 * `onnxruntime-node` installed this runs and answers.
 *
 * ===========================================================================
 * WHAT IT WOULD ASSERT, AND WHY EACH ONE
 * ===========================================================================
 * Not "did a session open" — `docs/TESTING.md` §3 rule 7 and the four
 * assertions AGENTS.md exists because of. It separates a real segment with the
 * real weights and looks at what came out:
 *   · the CoreML EP really took the model, and `load()` reports what the SESSION
 *     said rather than what was asked for;
 *   · six DISTINCT stems come out, in `STEMS` order — the pairwise-correlation
 *     test, because six copies of one thing satisfies a shape check;
 *   · the layout is the frozen one, at the REAL `SEGMENT`;
 *   · and the whole thing agrees with the ORT worker on the same input, which is
 *     the only assertion that can catch a native backend that runs fast and
 *     wrong.
 *
 * NO TIMING ASSERTION. Whether CoreML is FASTER is the question the seed asks
 * and it is a claim about hardware; a stopwatch here would be a number from one
 * machine pretending to be a property of the backend. It is reported, never
 * asserted.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { refuseIfCompromised } from '../lib/tree-guard.mjs';

const ID = 'backend-coreml';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
refuseIfCompromised(ID, ROOT);

/**
 * THE SKIP IS ABOUT THE MACHINE AND NOTHING ELSE — `docs/TESTING.md` §3 rule 8.
 * "This box is not Apple Silicon" and "the native module is not installed" are
 * properties of the box. "The backend did not expose `separate`" would be a
 * property of the code and is a FAIL; `backend` is the suite that asks that,
 * and it asks it here, every run, on every platform.
 */
const skip = (why) => {
  console.log(`\n${ID}: \x1b[33mSKIPPED\x1b[0m — ${why}`);
  console.log(`${ID}: the CoreML backend is WRITTEN AND UNVERIFIED. No CoreML session has been`);
  console.log(`${ID}: created by this project, no segment has been separated by one, and nothing`);
  console.log(`${ID}: has been timed. tools/suites/backend.mjs gates the selection, the wire and`);
  console.log(`${ID}: the layout on this machine; none of that is evidence about CoreML.`);
  process.exit(0);
};

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  skip(`this box is ${process.platform}/${process.arch} and CoreML needs macOS on Apple Silicon (seed §16)`);
}
let ort = null;
try { ort = (await import('onnxruntime-node')).default || (await import('onnxruntime-node')); }
catch { skip('onnxruntime-node is not installed — it is not a dependency of this project'); }

const MODEL = path.join(ROOT, 'models', 'htdemucs_6s.onnx');
if (!fs.existsSync(MODEL)) skip(`the weights are not on this machine (${path.relative(ROOT, MODEL)})`);

// --------------------------------------------------------------- the harness
let pass = 0; let fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (cond) pass++; else fail++;
};

const UNIT = path.join(ROOT, 'vendor', 'stem-splitter-live', 'extension');
const { DemucsEngine } = await import(pathToFileURL(path.join(UNIT, 'engine', 'demucs.js')).href);
const { SEGMENT, STEMS } = await import(pathToFileURL(path.join(UNIT, 'shared', 'config.js')).href);
const { verifyModel } = await import(pathToFileURL(path.join(UNIT, 'shared', 'modelcache.js')).href);

const bytes = fs.readFileSync(MODEL);
const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

// The unit's own identity check, over the bytes this suite is about to run.
let verified = null;
try { await verifyModel(new Uint8Array(buf)); verified = true; } catch (e) { verified = String(e.message); }
ok('the weights this suite runs are the pinned ones — the unit\'s own verifyModel over shared/config.js\'s pin  '
  + '[entry point: shared/modelcache.js::verifyModel]', verified === true, verified === true ? 'sha256 + byte count' : verified);

const engine = new DemucsEngine(ort);
let ep = null; let loadErr = null;
try { await engine.load(buf, 'coreml'); ep = engine.ep; } catch (e) { loadErr = String(e.message); }
ok('a CoreML session was created over the hoisted-STFT graph  [entry point: DemucsEngine.load(buffer, \'coreml\')]',
  loadErr === null, loadErr || `ep=${ep}`);
ok('...and the EP the SESSION reports is what load() would hand the deck, not the string that was asked for  '
  + '[entry point: src/renderer/native-backend.js load() -> STATE.boot.ep]',
loadErr === null && typeof ep === 'string' && ep.length > 0, `ep=${ep}`);

if (loadErr) { console.log(`\n${ID}: ${pass} passed, ${fail} failed`); process.exit(1); }

/**
 * A REAL SEGMENT. Six sine partials at different frequencies is not music, but
 * it is not silence either — and a backend that returned six copies of one thing
 * would satisfy every shape check and fail the correlation below.
 */
const segL = new Float32Array(SEGMENT);
const segR = new Float32Array(SEGMENT);
for (let i = 0; i < SEGMENT; i++) {
  const t = i / 44100;
  segL[i] = 0.2 * (Math.sin(2 * Math.PI * 110 * t) + Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 1760 * t)) / 3;
  segR[i] = 0.2 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 880 * t) + Math.sin(2 * Math.PI * 3520 * t)) / 3;
}
const out = new Float32Array(STEMS.length * 2 * SEGMENT);
const t0 = Date.now();
const r = await engine.runSegment(segL, segR, out);
const ms = Date.now() - t0;

ok(`the output is the frozen layout at the real SEGMENT — ${STEMS.length * 2} planes of ${SEGMENT} floats, `
  + '(k*2 + ch) * SEGMENT + i  [entry point: engine/demucs.js postProcess]',
r.stems.length === STEMS.length * 2 * SEGMENT, `${r.stems.length} floats`);

const rms = [];
for (let k = 0; k < STEMS.length; k++) {
  let s = 0;
  for (let i = 0; i < SEGMENT; i++) { const v = out[k * 2 * SEGMENT + i]; s += v * v; }
  rms.push(Math.sqrt(s / SEGMENT));
}
ok('every one of the six stems carries signal — a silent stem is a stem that was never written  '
  + `[entry point: the ${STEMS.length}-plane output of one CoreML segment]`,
rms.every((v) => v > 1e-6), STEMS.map((n, i) => `${n}=${rms[i].toExponential(2)}`).join(' '));

/**
 * SIX DISTINCT STEMS, NOT SIX COPIES. The pairwise correlation is the assertion
 * that a shape check cannot make, and `docs/TESTING.md` records that "six copies
 * of one thing" is the failure a careless gate passes.
 */
const corr = (a, b) => {
  let sa = 0; let sb = 0; let sab = 0;
  for (let i = 0; i < SEGMENT; i += 7) { const x = out[a * 2 * SEGMENT + i]; const y = out[b * 2 * SEGMENT + i]; sa += x * x; sb += y * y; sab += x * y; }
  return sab / (Math.sqrt(sa * sb) || 1);
};
const twins = [];
for (let i = 0; i < STEMS.length; i++) for (let j = i + 1; j < STEMS.length; j++) if (Math.abs(corr(i, j)) > 0.99) twins.push(`${STEMS[i]}~${STEMS[j]}`);
ok('...and they are SIX DISTINCT stems, not six copies of one — pairwise |correlation| < 0.99',
  twins.length === 0, twins.length ? `INDISTINGUISHABLE: ${twins.join(', ')}` : `${(STEMS.length * (STEMS.length - 1)) / 2} pairs, all distinct`);

/**
 * THE ONE ASSERTION THAT CATCHES A BACKEND THAT IS FAST AND WRONG. The same
 * segment through the same graph on CPU must give the same answer; a CoreML
 * partition that quietly changed the maths would pass everything above.
 */
const cpu = new DemucsEngine(ort);
await cpu.load(buf, 'cpu');
const ref = new Float32Array(STEMS.length * 2 * SEGMENT);
await cpu.runSegment(segL, segR, ref);
let worst = 1;
for (let k = 0; k < STEMS.length; k++) {
  let sa = 0; let sb = 0; let sab = 0;
  for (let i = 0; i < SEGMENT; i += 7) { const x = out[k * 2 * SEGMENT + i]; const y = ref[k * 2 * SEGMENT + i]; sa += x * x; sb += y * y; sab += x * y; }
  worst = Math.min(worst, sab / (Math.sqrt(sa * sb) || 1));
}
ok('CoreML and CPU agree on the same segment through the same graph — per-stem correlation >= 0.999  '
  + '[entry point: DemucsEngine over executionProviders coreml vs cpu]',
worst >= 0.999, `worst per-stem correlation ${worst.toFixed(6)}`);

// REPORTED, NEVER ASSERTED — a stopwatch here would be one machine's number
// pretending to be a property of the backend.
console.log(`\n${ID}: one segment on ep=${ep}: prep ${r.prepMs.toFixed(0)} ms · infer ${r.inferMs.toFixed(0)} ms · `
  + `post ${r.postMs.toFixed(0)} ms · wall ${ms} ms (reported, not asserted)`);
console.log(`\n${ID}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
