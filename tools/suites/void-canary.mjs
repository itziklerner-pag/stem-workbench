#!/usr/bin/env node
/**
 * void-canary — the runner's own gate, and the proof that the VOID rule is wired.
 *
 * TWO JOBS, and neither of them is a placeholder for the other.
 *
 * 1. IT IS THE STEP THAT CAN BE WATCHED GOING RED. `tools/verify.mjs` refuses
 *    to read an exit-0 step that asserted nothing as a pass. That refusal is a
 *    regex and a branch, and a regex nobody has watched fail is a regex you are
 *    assuming works. So this suite carries its own mutation, named and
 *    reproducible, instead of asking someone to break the runner by hand:
 *
 *      VOID_CANARY=silent node tools/verify.mjs --only void-canary   -> VOID, RED
 *      VOID_CANARY=zero   node tools/verify.mjs --only void-canary   -> VOID, RED
 *
 *    `silent` exits 0 having printed nothing but chatter. `zero` exits 0 having
 *    printed `void-canary: 0 passed, 0 failed` — the VOID case wearing a summary
 *    line, which is the half a `\d+` regex cannot see. Both must be RED.
 *
 *    THE MUTATION IS IN THE SUITE, NOT IN THE RUNNER, on purpose: a mutation
 *    that lives in the thing being asserted about would be a mutation the
 *    assertion could be written around.
 *
 * 2. IT ASSERTS THE STEPS TABLE AGAINST `docs/TESTING.md`. Four of this
 *    repository's five host suites are specified and not built. A specification
 *    with no step, and a step with no specification, are the same failure in two
 *    directions — a suite nobody runs — and both of them read as green from the
 *    outside. The two lists cannot part company without this going red.
 *
 * Assertions here name the entry point they are about, because `STEPS`,
 * `classify` and `verdict` are imported from the REAL runner rather than
 * re-declared. A second copy of that list is a list that drifts silently.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { STEPS, classify, verdict } from '../verify.mjs';
import { LOCK_MARKERS, sinkLock, strayLockPaths } from '../lib/locks.mjs';
import { standingMutations } from '../lib/tree-guard.mjs';
import { refuseIfCompromised } from '../lib/tree-guard.mjs';

/** Any name at all; the two formulas must agree on all of them, so one is enough. */
const SINK_PROBE = 'stem_workbench_gate';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ID = 'void-canary';

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
const DOC = path.join(ROOT, 'docs', 'TESTING.md');

// ------------------------------------------------------------ the mutation
const MUT = process.env.VOID_CANARY || '';
if (MUT && MUT !== 'silent' && MUT !== 'zero') {
  console.error(`${ID}: VOID_CANARY=${MUT} is not a mode. Use 'silent' or 'zero'.`);
  process.exit(2);
}
if (MUT === 'silent') {
  // Chatter, no assertion, exit 0. The runner must NOT read this as a pass —
  // and it must not be rescued by the fact that there is output.
  console.log(`${ID}: VOID_CANARY=silent — asserting nothing on purpose, and exiting 0.`);
  console.log(`${ID}: if tools/verify.mjs reports this as PASS, its VOID rule is broken.`);
  process.exit(0);
}
if (MUT === 'zero') {
  console.log(`${ID}: VOID_CANARY=zero — a summary line over a count of nothing, and exiting 0.`);
  console.log(`\n${ID}: 0 passed, 0 failed`);
  process.exit(0);
}

// --------------------------------------------------------------- the harness
// docs/TESTING.md, "How a suite prints". `ok` / `FAIL`, the name, TWO spaces,
// then the detail. Measured numbers live in the detail; the name is stable text.
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  cond ? pass++ : fail++;
};

// ------------------------------------------------- 1. the doc and the table
/**
 * The suite table in `docs/TESTING.md` sits between two markers so this can read
 * it without parsing markdown. Ids are the backticked value in the first column.
 */
function docRows() {
  const md = fs.readFileSync(DOC, 'utf8');
  const block = md.split('<!-- suites:begin -->')[1];
  if (block === undefined) throw new Error(`${DOC} has no <!-- suites:begin --> marker`);
  const body = block.split('<!-- suites:end -->')[0];
  if (body === block) throw new Error(`${DOC} has no <!-- suites:end --> marker`);
  return body.split('\n')
    .map((l) => {
      // `| \`id\` | file | flags | assertions | what it gates |`
      const m = l.match(/^\s*\|\s*`([\w-]+)`\s*\|[^|]*\|[^|]*\|([^|]*)\|/);
      if (!m) return null;
      const n = m[2].trim().match(/^(\d+)$/);
      return { id: m[1], assertions: n ? Number(n[1]) : null, raw: m[2].trim() };
    })
    .filter(Boolean);
}

// A throw here would exit non-zero with no FAIL line, which the runner reports
// as a hard failure — correct, but it names the exit code rather than the file.
// Catch it and make it an assertion, so the red says which marker is missing.
let rows = null, docErr = null;
try { rows = docRows(); } catch (e) { docErr = e.message; }
const ids = rows ? rows.map((r) => r.id) : null;
ok('docs/TESTING.md carries a machine-readable suite table  [entry point: docRows(), the <!-- suites:begin --> block]',
  ids !== null && ids.length > 0, docErr || `${ids ? ids.length : 0} ids: ${(ids || []).join(', ')}`);

const stepIds = STEPS.map((s) => s.id);
const missing = (ids || []).filter((i) => !stepIds.includes(i));
const undocumented = stepIds.filter((i) => !(ids || []).includes(i));
ok('every suite docs/TESTING.md specifies has a step in the runner  [entry point: STEPS in tools/verify.mjs]',
  ids !== null && missing.length === 0,
  missing.length ? `SPECIFIED WITH NO STEP: ${missing.join(', ')}` : `${(ids || []).length} ids`);
ok('...and every step the runner has is specified in docs/TESTING.md',
  ids !== null && undocumented.length === 0,
  undocumented.length ? `STEP WITH NO SPEC: ${undocumented.join(', ')}` : `${stepIds.length} steps`);

/**
 * THE COUNT COLUMN, AGAINST THE STEPS TABLE. Two lists in two files that must
 * not part company — the same shape as the id check above, one column across.
 *
 * `classify()` compares a step's `assertions` to what the suite actually
 * printed, so this row is what stops the pin being moved in ONE place: an author
 * who changes a suite and updates the runner but not the document leaves the
 * document lying, and an author who updates neither is caught by `classify()`.
 * `vendor-unit` is the one row with no number here and none in `STEPS`; its
 * count is the vendored runner's and `vendor/.pin` pins it both ways instead.
 */
const docCounts = new Map((rows || []).map((r) => [r.id, r.assertions]));
const mismatched = STEPS
  .map((st) => ({ id: st.id, step: typeof st.assertions === 'number' ? st.assertions : null, doc: docCounts.has(st.id) ? docCounts.get(st.id) : undefined }))
  .filter((r) => r.doc !== undefined && r.step !== r.doc);
ok('...and every step\'s pinned assertion count is the one docs/TESTING.md prints  '
  + '[entry point: STEPS[].assertions in tools/verify.mjs, and the count column in the suite table]',
  rows !== null && mismatched.length === 0,
  mismatched.length
    ? `DISAGREE: ${mismatched.map((r) => `${r.id} steps=${r.step} doc=${r.doc}`).join(', ')}`
    : `${STEPS.filter((st) => typeof st.assertions === 'number').length} of ${STEPS.length} steps carry a count, and the doc agrees with every one `
      + `(vendor-unit has none here: its count is the vendored runner's, pinned in vendor/.pin)`);

const pinned = STEPS.filter((st) => typeof st.assertions === 'number' && st.assertions > 0);
ok('...and the counts are POSITIVE integers, so a pin of 0 cannot make the VOID rule unreachable  [entry point: STEPS]',
  pinned.length === STEPS.filter((st) => 'assertions' in st).length
  && pinned.every((st) => Number.isInteger(st.assertions)),
  `${pinned.length} pinned: ${pinned.map((st) => `${st.id}=${st.assertions}`).join(' ')}`);

/**
 * ...AND THE CHECK CAN LOSE. `classify()` is the real function; these four
 * transcripts are the shapes it will see. A count pin that only ever agreed with
 * itself would be the tautology this whole file exists to refuse.
 */
{
  const line = (n) => `ok  a thing  d\n\ndeck-seam: ${n} passed, 0 failed\n`;
  const cl = (out, assertions) => classify({ id: 'deck-seam', code: 0, out, assertions }).verdict;
  ok('the runner FAILS a suite that printed fewer assertions than its pin — the ABSENT-assertion failure  '
    + '[entry point: classify() + countOf() in tools/verify.mjs]',
    cl(line(32), 49) === 'FAIL' && cl(line(49), 49) === 'PASS',
    `49 pinned: 32 -> ${cl(line(32), 49)}, 49 -> ${cl(line(49), 49)}`);
  ok('...and MORE is a fail too, because a pin is not a floor', cl(line(50), 49) === 'FAIL', cl(line(50), 49));
  ok('...and a step with no pin is judged exactly as it was before', cl(line(32), undefined) === 'PASS');
  ok('...and a pinned step that printed no summary line at all is a FAIL, not a pass',
    cl('ok  a thing  d\n', 49) === 'FAIL', cl('ok  a thing  d\n', 49));
}

// ------------------------------------------- 2. todo means NOT BUILT, exactly
/**
 * THE FAILURE THIS CATCHES IS A GREEN ONE, and it is the reason the extension's
 * runner carries a standing note about it: a suite gets written, its author runs
 * it by hand and it is green, and the gate goes on not running it. Here that
 * shows up as a step still marked `todo` while its file exists — the runner
 * skips it, prints it under NOT BUILT, and everything stays green.
 *
 * The other direction is the plain kind of broken: a step with no `todo` whose
 * command names a file that is not there.
 */
for (const s of STEPS) {
  const file = s.cwd ? null : path.join(ROOT, s.cmd[1] || '');
  if (!file) continue;                                    // vendor-unit runs someone else's runner
  const there = fs.existsSync(file);
  if (s.todo) {
    ok(`step '${s.id}' is marked todo and its suite really is absent  [entry point: STEPS in tools/verify.mjs]`,
      !there, there ? `${path.relative(ROOT, file)} EXISTS — a built suite left marked todo is a suite nothing runs` : 'not built');
  } else {
    ok(`step '${s.id}' names a suite that exists`, there, path.relative(ROOT, file));
  }
}

// ------------------------------------------------- 2b. ONE lock, one place
/**
 * THE SECOND LOCK PATH IS THE BUG THIS GATES.
 *
 * Every windowed suite and every mutation battery on this box takes a shared
 * mutex before it launches anything, because `xvfb-run -a` picks a display by
 * scanning for a free number and that is a race two launches can both win. The
 * path used to be copy-pasted into eleven files. Nothing drifted in the SOURCE —
 * what drifted was the RUNS: two lines of work pointed the override at different
 * files, each believed it held "the" mutex, and they raced each other for hours.
 * One wedged run then sat on a mutex nobody else could take for fifty-two
 * minutes, and from the outside that is indistinguishable from progress.
 *
 * `tools/lib/locks.mjs` is now the only file under `tools/` allowed to name a
 * lock. THE SCAN LIVES THERE RATHER THAN HERE, and that is not tidiness: the
 * first version of it lived in this file and failed on ITSELF, because a scanner
 * that spells the marker in order to search for it has just added the twelfth
 * copy. Exempting the scanner would have put a hole in the rule that exists
 * because of a hole.
 */
const planted = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-canary-'));
fs.writeFileSync(path.join(planted, 'innocent.mjs'), 'export const x = 1;\n');
fs.writeFileSync(path.join(planted, 'guilty.mjs'),
  `const LOCK = '/tmp/${LOCK_MARKERS[0]}-1000.lock';\nexport default LOCK;\n`);
const control = strayLockPaths(planted, 'nothing-is-exempt-here', planted);
fs.rmSync(planted, { recursive: true, force: true });
// A CONTROL THAT CAN LOSE: two files, one of them carrying a lock path, and the
// scan must name exactly the guilty one. A scan that returned [] for everything
// would pass the row below over a tree full of copies.
ok('INSTRUMENT CHECK: the lock scan finds a planted second lock path, and does not accuse the innocent file  '
  + '[entry point: strayLockPaths() in tools/lib/locks.mjs]',
  control.length === 1 && control[0].startsWith('guilty.mjs'),
  `${control.length} hit(s): ${control.join(' · ') || '(none — the scan cannot see a lock path at all)'}`);

const strays = strayLockPaths(path.join(ROOT, 'tools'), path.join('tools', 'lib', 'locks.mjs'), ROOT);
ok('...and NO file under tools/ except that module names a lock path — one mutex, one definition, '
  + 'or agents queue on different files and race on `xvfb-run -a`',
  strays.length === 0,
  strays.length ? `A SECOND LOCK PATH: ${strays.join(' · ')}` : `scanned tools/**: only tools/lib/locks.mjs names one`);

/**
 * AND THE SHELL HALF AGREES, EXACTLY. `spike/harness/bin/env.sh` computes the
 * sink lock in bash for the harness scripts, and `capture-mute.mjs` has always
 * claimed "both must agree" without ever checking it. An unasserted claim of
 * agreement between two formulas is what this repository keeps finding out about
 * the expensive way, so the two are RUN and compared rather than read.
 */
const envSh = path.join(ROOT, 'spike', 'harness', 'bin', 'env.sh');
let shellSink = null;
if (fs.existsSync(envSh)) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-envsh-'));
  const r = spawnSync('bash', ['-c',
    `SINK_NAME='${SINK_PROBE}' OUT_DIR='${tmp}' . '${envSh}' >/dev/null 2>&1; printf %s "$SINK_LOCK"`],
  { encoding: 'utf8', timeout: 20000 });
  shellSink = (r.stdout || '').trim() || null;
  fs.rmSync(tmp, { recursive: true, force: true });
}
ok('...and the shell half computes the SAME sink lock as the module — two formulas, run and compared, not read  '
  + '[entry point: SINK_LOCK in spike/harness/bin/env.sh vs sinkLock() in tools/lib/locks.mjs]',
  shellSink !== null && shellSink === sinkLock(SINK_PROBE),
  shellSink === null ? 'spike/harness/bin/env.sh did not answer' : `bash ${shellSink} · node ${sinkLock(SINK_PROBE)}`);

// ------------------------------------- 2c. a stranded mutation cannot be measured past
/**
 * THE FALSE RED THAT OUTLIVES THE RUN THAT CAUSED IT (stem-workbench#22).
 *
 * A battery edits a shipped file, runs a suite, restores. It restored on its own
 * EXIT — and `timeout` sends SIGTERM, so the way a long battery is most likely
 * to die was the one way it did not clean up. Twice in one afternoon a battery
 * was killed and left its edit standing, and the next gate run measured the
 * mutated tree and reported a red that was not in the code.
 *
 * Traps are the belt and they are asserted below. The SENTINEL is the braces,
 * for `kill -9`, a crashed host and a full disk, where no trap runs at all.
 */
const plantedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tree-guard-'));
fs.mkdirSync(path.join(plantedRoot, 'out', '.mutating'), { recursive: true });
fs.writeFileSync(path.join(plantedRoot, 'out', '.mutating', 'demo-mutations.8.json'),
  JSON.stringify({ battery: 'demo-mutations', case: '8', pid: 999999, started: '2026-08-26T00:00:00Z',
                   files: [{ rel: 'src/main/engine-messages.js', bak: '/tmp/nowhere.bak' }] }));
const seen = standingMutations(plantedRoot);
const seenEmpty = standingMutations(path.join(plantedRoot, 'out'));   // no sentinel dir under here
fs.rmSync(plantedRoot, { recursive: true, force: true });
// A CONTROL THAT CAN LOSE: one root with a sentinel, one without. A reader that
// answered [] for everything would pass the rows below over a poisoned tree.
ok('INSTRUMENT CHECK: a planted sentinel is seen, and a tree without one is not accused  '
  + '[entry point: standingMutations() in tools/lib/tree-guard.mjs]',
  seen.length === 1 && seen[0].battery === 'demo-mutations' && seen[0].case === '8'
  && seen[0].files[0].rel === 'src/main/engine-messages.js' && seenEmpty.length === 0,
  `planted -> ${seen.length} (${seen.map((x) => `${x.battery} case ${x.case}`).join(', ') || 'nothing'}), clean -> ${seenEmpty.length}`);

/**
 * A REFUSAL IS AN ERROR, NEVER A SKIP AND NEVER A PASS. This drives the REAL
 * classifier over the real refusal transcript, because "it exits 3" is worth
 * nothing unless the runner reads 3 the way this file assumes it does. The three
 * negatives are the point: a refusal that classified as SKIP would sit under
 * WHAT DID NOT RUN and keep the plan green, which is the failure this whole
 * mechanism exists to prevent.
 */
const refusal = [
  'shell: REFUSING TO RUN — a mutation battery has an edit standing on this tree.',
  'shell:   smoke-mutations case 8, started 2026-08-26T11:29:29Z',
  'shell:     owner pid 1251414 — GONE (killed, or the host died)',
  'shell:     standing on src/main/engine-messages.js   (backup out/smoke-mutations/8.engine-messages.js.bak)',
  '',
].join('\n');
const refused = classify({ id: 'shell', code: 3, out: refusal });
ok('a suite that REFUSES to run is a FAIL — not a SKIP, not VOID, not a pass  [entry point: classify()]',
  refused.verdict === 'FAIL', `${refused.verdict} · ${refused.detail}`);
ok('...and it turns the whole run RED, so a refusal can never be reported as green  [entry point: verdict()]',
  verdict([{ id: 'shell', verdict: refused.verdict, hard: refused.hard }], STEPS, [STEPS[0]]).colour === 'RED');

/**
 * EVERY BATTERY TRAPS INT AND TERM AND RESTORES. Three of the nine did not when
 * this was written — `deck-seam`, `engine-host` and `transport` — and a battery
 * without the trap is exactly how #22 happened. This is the audit made
 * mechanical, so the tenth battery cannot arrive without one.
 */
const batteries = fs.readdirSync(path.join(ROOT, 'tools', 'suites'))
  .filter((n) => n.endsWith('-mutations.sh')).sort();
const untrapped = batteries.filter((n) => {
  const t = fs.readFileSync(path.join(ROOT, 'tools', 'suites', n), 'utf8');
  return !/^trap mg_on_signal INT TERM HUP/m.test(t) || !/mutation-guard\.sh/.test(t);
});
ok(`every mutation battery installs the guard and traps INT, TERM and HUP  [${batteries.length} batteries]`,
  batteries.length > 0 && untrapped.length === 0,
  untrapped.length ? `NO TRAP: ${untrapped.join(', ')}` : batteries.join(' '));

const unclaimed = batteries.filter((n) => {
  const t = fs.readFileSync(path.join(ROOT, 'tools', 'suites', n), 'utf8');
  return !/mg_claim /.test(t) || !/mg_release /.test(t);
});
ok('...and every one of them claims a sentinel before it edits and releases it after the restore',
  unclaimed.length === 0,
  unclaimed.length ? `NO SENTINEL: ${unclaimed.join(', ')}` : `${batteries.length} claim and release`);

// ---------------------------------------- 3. the VOID rule, against the real classifier
/**
 * These four call the runner's own `classify`, so what is asserted here is what
 * the runner will do to `tools/suites/*.mjs` tomorrow. The two mutation modes at
 * the top of this file exercise the same rule end to end, through a real spawn.
 */
const cl = (out, code = 0) => classify({ id: ID, code, out }).verdict;
ok('the runner calls an exit-0 step with no assertions VOID  [entry point: classify() in tools/verify.mjs]',
  cl('') === 'VOID', cl(''));
ok('...and one that printed only chatter  [entry point: classify()]',
  cl(`${ID}: VOID_CANARY=silent — asserting nothing on purpose, and exiting 0.\n`) === 'VOID');
ok('...and one whose summary line counts nothing  [entry point: classify()]',
  cl(`\n${ID}: 0 passed, 0 failed\n`) === 'VOID', '"0 passed, 0 failed"');
ok('...while a summary with a real count is a PASS  [entry point: classify()]',
  cl(`ok  a thing  d\n\n${ID}: 3 passed, 0 failed\n`) === 'PASS');

// ------------------------------------- 4. a VOID step cannot be green anywhere
const v = verdict([{ id: ID, verdict: 'VOID', hard: [`${ID}: no assertions produced`] }], STEPS, [STEPS[0]]);
ok('a single VOID step turns the whole run RED  [entry point: verdict() in tools/verify.mjs]',
  v.colour === 'RED', v.colour);

// -------------------------------- 5. the plan can never be silently complete
const todos = STEPS.filter((s) => s.todo).map((s) => s.id);
const green = verdict(STEPS.filter((s) => !s.todo).map((s) => ({ id: s.id, verdict: 'PASS', hard: [] })),
  STEPS, STEPS.filter((s) => !s.todo));
ok('while any suite is unbuilt, the runner cannot print an unqualified GREEN  [entry point: verdict()]',
  todos.length === 0 ? green.colour === 'GREEN' : green.colour === 'GREEN-PARTIAL',
  todos.length ? `${todos.length} not built: ${todos.join(', ')}` : 'every suite is built');

console.log(`\n${ID}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
