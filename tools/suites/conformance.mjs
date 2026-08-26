#!/usr/bin/env node
/**
 * conformance — `group('host')` from the vendored `test.js`, pointed at THIS
 * Host's files, run to completion, and compared against a pinned report.
 *
 * `docs/VENDORING.md` offers three things to do about those 122 assertions and
 * this repository takes **option 3**. The hole modules already sit at the two
 * paths the group reads; what was missing was a platform under them, and
 * `tools/conformance-platform.mjs` is it. Nothing under `vendor/` is edited —
 * `vendor-intact` gates that byte for byte on every run, and it runs first.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS STEP IS FOR, AND WHY IT IS NOT `vendor-unit`
 * ---------------------------------------------------------------------------
 * `vendor-unit` asks "does the unit still work". THIS asks "does our Host still
 * satisfy the unit's own description of a Host", and the two must not be one
 * step, because their failures mean opposite things: a red there is a broken
 * copy, a red here is a broken Host.
 *
 * They also run the same file for different reasons, so both numbers are pinned:
 * `vendor/.pin` pins the unit's plan, `vendor/.conformance.json` pins this
 * report — the total, the pass count, and **every failing assertion by name,
 * with the reason it does not apply to a desktop Host.**
 *
 * ---------------------------------------------------------------------------
 * THE PINNED RED SET IS COMPARED BOTH WAYS, AND THAT IS THE WHOLE DESIGN
 * ---------------------------------------------------------------------------
 * `AGENTS.md` is blunt about expected-red lists: an assertion parked on one
 * stops being read at all. So this is not one. The comparison is a SET EQUALITY:
 *
 *   a red that is not in the pin        -> FAIL. Something about this Host changed.
 *   a pinned red that did not appear    -> FAIL. Either it was fixed, and the pin
 *                                          owes an update, or the assertion stopped
 *                                          RUNNING — which is the failure the whole
 *                                          crash story below is about.
 *
 * Every entry carries a `class` from a closed vocabulary and a `why` long enough
 * to be an argument rather than a label, and both are asserted. "It is about
 * Chrome" is only a reason when the assertion is genuinely about Chrome, so the
 * suite also requires each entry to name where the claim is RE-MADE, if it is.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PLATFORM DOUBLE HAS TO BE THERE, MEASURED
 * ---------------------------------------------------------------------------
 * Without `tools/conformance-platform.mjs`, `node test.js` does not fail — it
 * CRASHES:
 *
 *   TypeError: listeners[0] is not a function   at test.js:5833
 *
 * The deck half installs a Chrome platform, calls `deckHost.onMessage(fn)`,
 * correctly reports `listeners.length === 1` RED, and then dereferences
 * `listeners[0]` anyway. Measured on a clean tree at v0.2.0: **50 of the group's
 * 122 assertions run, and `group('verifyModel')` and `group('backend')` — 31
 * further assertions about the unit itself — never run at all.** A crash is
 * strictly worse than a red: it hides the reds worth reading, and it looks like
 * a broken vendored copy rather than an unimplemented duty.
 *
 * That is an upstream defect, it is NOT patched here (rule V1), and it is a
 * sibling of `stem-splitter-live#30` rather than the same bug — #30 is a hole
 * that throws while being IMPORTED; this is an instrument check that reports an
 * absence and then dereferences it. `docs/CONFORMANCE.md` records both.
 *
 * ---------------------------------------------------------------------------
 * THE PART THAT MUST NOT BE FORGOTTEN
 * ---------------------------------------------------------------------------
 * The double stands in for everything BELOW the hole module. **An assertion in
 * this group whose subject is below the bridge is an assertion about the double,
 * not about this Host** — a green there is a property of the apparatus. Those
 * are listed in `vendor/.conformance.json` under `apparatus`, this suite asserts
 * that every one of them is in fact green (so the list cannot rot into a list of
 * things that quietly went red), and `docs/CONFORMANCE.md` says for each one
 * where the real claim is made instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { refuseIfCompromised } from '../lib/tree-guard.mjs';

const ID = 'conformance';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * BEFORE ANYTHING IS MEASURED: is this the tree somebody committed?
 *
 * A mutation battery that died without restoring leaves its edit standing on a
 * shipped file, and a run that starts afterwards reports a red that is not in
 * the code — stem-workbench#22, which happened twice in one afternoon. This
 * REFUSES rather than measures, and a refusal is an ERROR: it exits non-zero
 * with no `SKIPPED` and no assertion line, so `tools/verify.mjs` reports it as a
 * FAIL and the plan is RED. "I declined to measure" must not read as green any
 * more than silence may (the VOID rule, one level out).
 *
 * It costs one `readdir` of a directory that is almost always absent, plus one
 * `git status` — at startup, never per assertion.
 */
refuseIfCompromised(ID, ROOT);
const VENDOR = path.join(ROOT, 'vendor', 'stem-splitter-live');
const PLATFORM = path.join(ROOT, 'tools', 'conformance-platform.mjs');
const PIN = path.join(ROOT, 'vendor', '.conformance.json');
const DOC = path.join(ROOT, 'docs', 'CONFORMANCE.md');
const OUT = path.join(ROOT, 'out', ID);

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

const strip = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

if (!fs.existsSync(path.join(VENDOR, 'test.js'))) skip('the unit is not vendored — bash tools/vendor-unit.sh');

const pin = JSON.parse(fs.readFileSync(PIN, 'utf8'));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// ==========================================================================
// 1. THE RUN — the vendored suite, unedited, under our platform
// ==========================================================================
const run = await spawnRun('node', ['--import', PLATFORM, 'test.js'], { cwd: VENDOR, timeoutMs: 400000 });
const out = strip(run.out);
fs.writeFileSync(path.join(OUT, 'test.log'), out);

const rows = out.split('\n')
  .map((l) => l.match(/^\s+(PASS|FAIL) (.*)$/))
  .filter(Boolean)
  .map((m) => ({ verdict: m[1], line: m[2] }));
const reds = rows.filter((r) => r.verdict === 'FAIL');
const summary = out.match(/^(\d+) passed, (\d+) failed$/m);

// THE ADAPTER HAS TO HAVE BEEN THERE. Without it the run crashes, and a suite
// that could not tell a crash from a conformance result would report the crash
// as one — with a smaller, greener red set, which is the direction that hides.
ok('the run happened UNDER our platform double, not under the bare harness  '
  + '[entry point: tools/conformance-platform.mjs, --import]',
  /\[conformance-platform\] installed:/.test(out),
  /\[conformance-platform\] installed:/.test(out)
    ? 'window.__wbDeck, __wbEngine and location.origin were installed before test.js loaded'
    : 'THE MARKER IS ABSENT — this is the bare harness, and the numbers below are a crash, not a report');

// THE CRASH IS THE THING THIS STEP EXISTS TO GET PAST. Asserting completion by
// COUNT rather than by exit code is deliberate: the run exits non-zero either
// way — 19 reds and a stack trace look the same to `$?`.
ok('...and the vendored suite RAN TO COMPLETION: every assertion in test.js reported, none lost to a crash  '
  + '[entry point: vendor/stem-splitter-live/test.js]',
  summary !== null && rows.length === pin.total && Number(summary[1]) + Number(summary[2]) === pin.total,
  summary
    ? `${rows.length} assertions reported, vendor/.conformance.json pins ${pin.total} `
      + `(${summary[1]} passed, ${summary[2]} failed). Without the platform double: 50 of group('host')'s 122 `
      + "run and group('verifyModel') and group('backend') never start."
    : `NO SUMMARY LINE — ${rows.length} assertions before the transcript stopped. Last line: ${lastLine(out)}`);
if (!summary) done();

ok('...and the pass count is exactly what the pin says  [entry point: vendor/.conformance.json]',
  Number(summary[1]) === pin.passed && Number(summary[2]) === pin.reds.length,
  `${summary[1]} passed / ${summary[2]} failed; pinned ${pin.passed} / ${pin.reds.length}`);

// ==========================================================================
// 2. THE RED SET, BOTH WAYS
// ==========================================================================
const matched = new Map();          // pin key -> [red lines]
const unpinned = [];
for (const r of reds) {
  const hit = pin.reds.filter((p) => r.line.includes(p.key));
  if (hit.length === 1) {
    if (!matched.has(hit[0].key)) matched.set(hit[0].key, []);
    matched.get(hit[0].key).push(r.line);
  } else if (hit.length === 0) unpinned.push(r.line);
  else unpinned.push(`AMBIGUOUS (${hit.length} pin keys match): ${r.line}`);
}
const missing = pin.reds.filter((p) => !matched.has(p.key));

ok('every failing assertion is one the pin names, with a written reason  [entry point: vendor/.conformance.json .reds]',
  unpinned.length === 0,
  unpinned.length === 0
    ? `${reds.length} reds, all pinned`
    : `${unpinned.length} UNPINNED RED(S): ${unpinned.map((l) => l.slice(0, 140)).join(' || ')}`);

// THE OTHER DIRECTION, AND IT IS THE ONE AN EXPECTED-RED LIST NEVER HAS. A
// pinned red that stops appearing is either a fix the pin owes an update, or an
// assertion that stopped RUNNING — and the second is exactly how the crash
// hid 103 assertions while the transcript still looked busy.
ok('...and every red the pin names really appeared: a red that vanishes is a fix the pin owes, or an assertion that stopped running',
  missing.length === 0,
  missing.length === 0
    ? `${pin.reds.length}/${pin.reds.length} accounted for`
    : `${missing.length} PINNED RED(S) DID NOT APPEAR: ${missing.map((p) => p.key).join(' || ')}`);

// ==========================================================================
// 3. THE JUSTIFICATIONS ARE ARGUMENTS, NOT LABELS
// ==========================================================================
const CLASSES = Object.keys(pin.classes);
const badClass = pin.reds.filter((p) => !CLASSES.includes(p.class));
ok(`every unfixed red carries a class from the closed vocabulary {${CLASSES.join(', ')}}  `
  + '[entry point: vendor/.conformance.json .classes]',
  badClass.length === 0,
  badClass.length === 0 ? `${pin.reds.length} rows classified`
    : `UNCLASSIFIED: ${badClass.map((p) => `${p.key} -> ${p.class}`).join(' || ')}`);

// "It is about Chrome" is only a reason if the assertion is genuinely about
// Chrome. 240 characters is not a proxy for a good argument, but it is a floor
// that a label cannot clear, and the reviewer reads the rest.
const thin = pin.reds.filter((p) => !p.why || p.why.length < 240 || !p.remade);
ok('...and a reason long enough to be an argument, plus where the claim is re-made  [entry point: .reds[].why and .remade]',
  thin.length === 0,
  thin.length === 0
    ? `shortest reason ${Math.min(...pin.reds.map((p) => p.why.length))} chars, longest ${Math.max(...pin.reds.map((p) => p.why.length))}`
    : `THIN: ${thin.map((p) => p.key).join(' || ')}`);

const doc = fs.existsSync(DOC) ? fs.readFileSync(DOC, 'utf8') : '';
const undocumented = pin.reds.filter((p) => !doc.includes(p.key));
ok('...and docs/CONFORMANCE.md names every one of them, so the argument is in the repository and not only in a JSON field',
  doc.length > 0 && undocumented.length === 0,
  doc.length === 0 ? 'docs/CONFORMANCE.md is missing'
    : undocumented.length === 0 ? `${pin.reds.length} rows documented in ${DOC.replace(ROOT + '/', '')}`
      : `NOT IN THE DOC: ${undocumented.map((p) => p.key).join(' || ')}`);

// ==========================================================================
// 4. THE ONES THAT MUST NOT SLIP INTO THE JUSTIFIED SET
// ==========================================================================
// docs/VENDORING.md names three by hand as worth passing — assetUrl's trailing
// slash, send's undefined return, storageGet's absent-vs-unreadable split. They
// are here with eight more, spelled out, so that "we justified it" can never
// become the answer for one of them.
const greenLines = rows.filter((r) => r.verdict === 'PASS').map((r) => r.line);
const notGreen = pin.mustPass.filter((k) => !greenLines.some((l) => l.includes(k)));
ok('the assertions VENDORING.md names as worth passing are GREEN — assetUrl\'s trailing slash, send\'s undefined '
  + 'return, and storageGet\'s absent-versus-unreadable split, against a real implementation rather than a stub  '
  + '[entry point: vendor/.conformance.json .mustPass]',
  notGreen.length === 0,
  notGreen.length === 0 ? `${pin.mustPass.length}/${pin.mustPass.length} green`
    : `NOT GREEN: ${notGreen.join(' || ')}`);

// ==========================================================================
// 5. THE APPARATUS LIST — a green that is not evidence about this Host
// ==========================================================================
const apparatusMissing = pin.apparatus.filter((k) => !rows.some((r) => r.line.includes(k)));
const apparatusRed = pin.apparatus.filter((k) => reds.some((r) => r.line.includes(k)));
ok('every assertion whose subject is BELOW the bridge is named as apparatus, and is present and green — so the list '
  + 'cannot rot into a list of things that quietly went red  [entry point: vendor/.conformance.json .apparatus]',
  apparatusMissing.length === 0 && apparatusRed.length === 0,
  `${pin.apparatus.length} named${apparatusMissing.length ? `; ABSENT ${apparatusMissing.join(' || ')}` : ''}`
  + `${apparatusRed.length ? `; RED ${apparatusRed.join(' || ')}` : ''} — a green here is a property of `
  + 'tools/conformance-platform.mjs, not of this Host, and docs/CONFORMANCE.md says where the real claim is made');

const overlap = pin.apparatus.filter((k) => pin.mustPass.some((m) => m.includes(k) || k.includes(m)));
ok('...and nothing is on both lists: an assertion cannot be both this Host\'s evidence and the apparatus\'s',
  overlap.length === 0,
  overlap.length === 0 ? 'mustPass and apparatus are disjoint' : `BOTH: ${overlap.join(' || ')}`);

console.log(`\n${ID}: transcript ${path.relative(ROOT, path.join(OUT, 'test.log'))} · `
  + `pin ${path.relative(ROOT, PIN)} · reasons ${path.relative(ROOT, DOC)}`);
done();

// ------------------------------------------------------------------ helpers
function lastLine(s) { const l = String(s).trimEnd().split('\n'); return l[l.length - 1] || '(no output)'; }
function spawnRun(bin, args, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let o = '';
    const grab = (c) => { o += c.toString(); };
    child.stdout.on('data', grab);
    child.stderr.on('data', grab);
    const t = setTimeout(() => { o += `\n[suite] TIMEOUT after ${timeoutMs} ms — killing\n`; child.kill('SIGKILL'); }, timeoutMs);
    child.on('error', (e) => { clearTimeout(t); resolve({ code: 127, out: `${o}\nspawn error: ${e.message}` }); });
    child.on('close', (code) => { clearTimeout(t); resolve({ code, out: o }); });
  });
}
