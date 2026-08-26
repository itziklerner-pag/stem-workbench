#!/usr/bin/env node
/**
 * capture-mute — THE PERMANENT GATE. The one property this whole product rests
 * on: *the app can hear the view while the user cannot.*
 *
 * `docs/TESTING.md` §8 is the specification and this file implements it
 * assertion for assertion. `docs/spike-capture-mute.md` is the measurement it
 * came from, and its "The permanent gate" section carries the CORRECTED list.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR-ASSERTION GATE THE SPIKE FIRST PROPOSED IS NOT THIS GATE
 * ---------------------------------------------------------------------------
 * Review built a run that satisfied all four of them while producing a stream
 * that is useless for stem separation — MONO, 48 kHz, with automatic gain
 * control decaying the level 17x over 8 s — and it read 10.8x above the naive
 * floor (`spike-capture-mute.md` Limitation 6). Every difference below is there
 * because something got past the old one:
 *
 *   a captured-level BAND, not a floor        the AGC-crushed stream sits at
 *                                             0.108, above any floor and below
 *                                             the fixture's analytic 0.353553
 *   the five track settings, separately       so a red names which one moved
 *   a QUANTA count, not wall seconds          `capturedSeconds` jitters
 *                                             3.979-4.011 s and a literal
 *                                             `>= 4 s` goes red on ~10 % of
 *                                             unmodified runs. A gate whose
 *                                             verdict changes on code that did
 *                                             not change is measuring the machine
 *   the app's WHOLE LIFETIME on the speaker   a capture-window-scoped meter is
 *   side                                      structurally unable to see the
 *                                             1.90 s of full-level audio at peak
 *                                             0.499893 that variant (a) leaks
 *                                             BEFORE the capture opens. That one
 *                                             change turned (a) from a reported
 *                                             PASS into a FAIL
 *   a PER-RUN node witness                    the spike's control asserted a
 *                                             property of the SINK, and a
 *                                             reviewer greened the entire matrix
 *                                             with the app routed to a decoy and
 *                                             an unrelated tone played into the
 *                                             measured sink
 *   an exclusive LOCK on the sink             `run-variant.sh` took none, and a
 *                                             second agent's Electron was
 *                                             observed writing into the measured
 *                                             sink mid-run
 *
 * NOT ASSERTED, DELIBERATELY: `isCurrentlyAudible() === false`. It stayed TRUE
 * in every muted run ever recorded here — it reports that the page is producing
 * audio, not that anything can hear it. It is REPORTED by the probe and asserted
 * on by nothing. Do not add it.
 *
 * ---------------------------------------------------------------------------
 * WHAT RUNS, AND IN WHAT ORDER
 * ---------------------------------------------------------------------------
 *   0. preflight. A box with no PipeWire SKIPS, loudly, and a skip is not a pass.
 *   1. the static seam scan (assertion 9) — no launch, no sink.
 *   2. the sink lock, then the browser mutex, then our OWN null sink.
 *   3. THE CONTROL, FIRST: a variant (d) process — `spike/main.js`, the same
 *      code that produced the reference numbers — `enableLocalEcho: true`, the
 *      view NOT muted, the capture RUNNING, on the same sink inside the same
 *      lock. It must be HEARD. If it is not, the meter is deaf and the silence
 *      readings that follow carry no verdict: they are printed VOID, not green.
 *   4. THE APP, under `xvfb-run`, with the sink's monitor recorded from BEFORE
 *      the launch to AFTER the exit, and the sink's link graph sampled from
 *      outside three times inside the measurement window.
 *   5. score, destroy the sink, release the locks.
 *
 * ---------------------------------------------------------------------------
 * IT WILL NOT RUN IN GITHUB CI, AND IT SAYS SO
 * ---------------------------------------------------------------------------
 * A GitHub runner has no PipeWire daemon, no audio device and no sink. This
 * suite SKIPS there — `docs/TESTING.md` §3 rule 8, a property of the machine —
 * and the runner prints it under "WHAT DID NOT RUN" and downgrades the whole run
 * to `GREEN (partial)`. It can never be mistaken for a pass, because
 * `tools/verify.mjs`'s `verdict()` refuses an unqualified GREEN over a plan with
 * a SKIP in it. The consequence, named rather than implied: NOTHING IN CI EVER
 * CHECKS THIS PROPERTY. It is checked on a Linux box with PipeWire, by hand or
 * by a self-hosted runner, and on macOS it is checked by nobody at all yet
 * (`docs/TESTING.md` §11). `.github/workflows/gate.yml` therefore does not list
 * this step at all and says why in the file, rather than listing it and letting
 * a SKIP stand in for an answer — and every step it DOES list carries
 * `--strict`, so a skip there fails the job.
 *
 * ---------------------------------------------------------------------------
 * WATCHED RED BY MUTATION — `tools/suites/capture-mute-mutations.sh`
 * ---------------------------------------------------------------------------
 * Every assertion below, with the edit that broke it. The right column is what
 * ACTUALLY went red, not what was expected to. Run 2026-08-26, Electron 44.0.0 /
 * Chromium 152.0.7977.54 on Linux; a clean baseline reads `capturedRms 0.350831`
 * over 1496 quanta with the device at bit-exact 0.0. The prose for each row is in
 * `docs/TESTING.md` §8.
 *
 *   1   src/main/youtube.js: remove setAudioMuted(true) -> muted, silent-lifetime
 *       VARIANT (a), the case this whole gate was rewritten for. Only the
 *       whole-lifetime recording sees the leak.
 *   2   vendor/…/host.js: ask for `audio: true`, guard neutered
 *       -> the band, and ALL FIVE settings. Limitation 6, reproduced to three
 *       decimal places: rms 0.106369, mono, 48000, all three flags true.
 *   3b  vendor/…/host.js: ask for echoCancellation + noiseSuppression
 *       -> the band, stereo, 44100, EC, NS
 *   4   this file: route the app to a DECOY sink       -> the node witness, ALONE.
 *       The silence assertion stays GREEN at 0.000000 — a pass for the wrong
 *       reason, and the exact way a reviewer greened the spike's whole matrix.
 *   5   a PATH shim truncating only the app's recording to 0.2 s
 *       -> silent-lifetime (MEASUREMENT FAILED), coverage
 *   6   this file: run the control with the mute ON    -> the control, and the two
 *       silence assertions print VOID rather than green
 *   7   src/main/main.js: serve /gate/ unconditionally -> the seam scan, ALONE
 *   8   tools/gate/capture-mute.mjs: write no report   -> the launch assertion, and
 *       the suite stops at 1 passed, 1 failed rather than exiting 0
 *   9   tools/fixture/rms-worklet.js: stop counting quanta
 *       -> quanta, the band, coverage. 0 quanta is an ERROR, not a silence.
 *  10   tools/gate/capture-mute.mjs: window 4 s -> 1 s -> quanta, coverage — and
 *       the BAND STAYS GREEN, which is what "grounded on the count" means
 *  11   an unrelated process plays 700 Hz into the measured sink
 *       -> exclusivity, and silent-lifetime
 *  12   this file: point the lock witness at a lock nobody holds -> exclusivity,
 *       ALONE. "Kill the holder" was tried and CANNOT work: an flock lock lives on
 *       the open file description and every descendant inherits it.
 *  13   src/main/main.js: delete `app.isPackaged` from the definition of GATE
 *       -> the seam scan, ALONE — and its OTHER half stays green at 2/2 guarded
 *       mentions, because the guard is still there. It is only out of a user's
 *       reach while that conjunction holds.
 *
 * `tools/suites/coverage.py` over the whole battery: 13 of 13 mutations caught,
 * 15 of 15 assertions watched red.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { BROWSER_LOCK, BROWSER_LOCK_HELD_BY_CALLER, announceLock, sinkLock as sinkLockPath } from '../lib/locks.mjs';
import { refuseIfCompromised } from '../lib/tree-guard.mjs';

const ID = 'capture-mute';
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
const OUT = path.join(ROOT, 'out', ID);
const HARNESS = path.join(ROOT, 'spike', 'harness');

// ---------------------------------------------------------------- thresholds
/**
 * OUR OWN SINK NAME, and neither of the two that already exist on this box.
 * `harness_sink` is the machine's session default and is shared with whatever
 * else decides to play; `stem_workbench_spike` belongs to the spike's matrix.
 * Measuring either would be measuring somebody else's audio.
 */
const SINK = 'stem_workbench_gate';
const SINK_RATE = 48000;
const SINK_CHANNELS = 2;

/**
 * BOTH PATHS COME FROM `tools/lib/locks.mjs` AND ARE NOT SPELLED HERE. That file
 * is the one place in `tools/` allowed to name a lock and `void-canary` goes red
 * if a second file names one — including this one, which used to carry two.
 * `spike/harness/bin/env.sh` computes the sink path in shell; the two must agree
 * exactly, and `void-canary` asserts that by running both.
 *
 * The browser mutex is held across BOTH launches, so the recorder is never left
 * running through somebody else's wait.
 */
/**
 * 900 s, and TUNABLE FOR ONE REASON: the contention path above is a branch, and
 * a branch nobody has watched is a branch you are assuming works. Waiting a
 * quarter of an hour to exercise it is not a test anyone runs, so
 * `tools/suites/locks-mutations.sh` sets this to a few seconds, takes the lock
 * from outside, and requires a SKIP. Same shape and same reason as
 * `CAPTURE_MUTE_WATCHDOG_MS` above. Nothing on any plan sets it.
 */
const LOCK_WAIT_S = Number(process.env.CAPTURE_MUTE_LOCK_WAIT_S || 900);

/**
 * IT IS DECLARED HERE AND NOT BESIDE `holdLock()`. The first acquisition is a
 * TOP-LEVEL `await` in section 2, which runs before the helper section is
 * evaluated, so a `const` down there is a temporal dead zone and the suite dies
 * with `Cannot access 'LOCK_WAIT_S' before initialization` the moment anything
 * makes it wait. Caught by `locks-mutations.sh` case 4 on its first run — which
 * is the entire argument for having watched the contention branch at all.
 */
const SINK_LOCK = sinkLockPath(SINK);
// One line, and only when this run has stepped out of the shared queue.
announceLock();

/**
 * THE CAPTURED-LEVEL BAND. `tools/fixture/player.html` generates a 440 Hz stereo
 * sine at amplitude 0.5 in-page, so its level is ANALYTIC: 0.5/sqrt(2) =
 * 0.353553. Observed variant (b) runs sit at 0.3498-0.3514.
 *
 * A FLOOR ALONE PASSES THE RUINED CAPTURE. That is the whole reason this is a
 * band: the AGC-crushed stream reads 0.108, which clears any floor a working
 * capture also clears.
 */
const CAPTURE_MIN = 0.30;
const CAPTURE_MAX = 0.40;
const CAPTURE_ANALYTIC = 0.5 / Math.SQRT2;

/**
 * -66 dBFS. STATED WEAKNESS: never exercised. Every silent reading ever taken
 * here is bit-exactly 0.0 with peak 0.0, so this could be any positive number
 * and nothing would change. It is the discrimination between 0 and 0.35 — 26 dB
 * — that carries the claim, not the threshold. `speakerPeak` is recorded next to
 * it so the day a reading is merely small rather than zero is visible.
 */
const SILENCE_CEILING = 0.0005;

/** -40 dBFS, 20x the ceiling. The control's observed readings are 0.344-0.348. */
const CONTROL_FLOOR = 0.01;

/**
 * 4 s at 48000 Hz is 1500 render quanta of 128 frames; 1450 is 96.7 % of it.
 * Grounded on the COUNT and not on wall seconds — see the header.
 */
const WINDOW_SECONDS = 4;
const MIN_QUANTA = 1450;

/** The recording must cover at least this much of the app's life (assertion 6). */
const COVERAGE = 0.9;

// ------------------------------------------------------------- the harness
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  cond ? pass++ : fail++;
};
const skip = (why) => {
  console.log(`SKIPPED — ${why}`);
  console.log(`\n${ID}: this box cannot answer the question. A SKIP IS NOT A PASS: nothing here`);
  console.log(`${ID}: checked that the view is silent while it is captured. tools/verify.mjs prints`);
  console.log(`${ID}: it under "WHAT DID NOT RUN" and refuses an unqualified GREEN over the plan.`);
  process.exit(0);
};
let cleanup = () => {};
/**
 * THIS SUITE HOLDS TWO MACHINE-GLOBAL LOCKS, so it is the one suite here that
 * must never hang: a sibling agent queued on the browser mutex waits exactly as
 * long as we do. Every subprocess already has its own timeout; this is the last
 * one, and it exits RED rather than quietly.
 */
/**
 * ARMED ONLY ONCE BOTH LOCKS ARE HELD, and that is the whole subtlety. Waiting
 * in a queue and taking a measurement are two different waits: on a shared box a
 * sibling can hold the browser mutex for minutes, and a deadline that started
 * before the queue would report "this suite hung" about a suite that had not yet
 * begun. `AGENTS.md`: a gate whose verdict changes on code that did not change is
 * measuring the machine.
 */
const WATCHDOG_MS = Number(process.env.CAPTURE_MUTE_WATCHDOG_MS || 600000);
const armWatchdog = () => setTimeout(() => {
  console.log(`FAIL  the suite finishes inside its own deadline  ${WATCHDOG_MS} ms after both locks were `
    + `taken, with ${pass + fail} assertion(s) reported — killing it rather than holding the sink and browser locks`);
  fail++;
  cleanup();
  console.log(`\n${ID}: ${pass} passed, ${fail} failed`);
  process.exit(1);
}, WATCHDOG_MS).unref();

const done = () => {
  cleanup();
  console.log(`\n${ID}: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

/** A report field is not a promise — `docs/TESTING.md` §3 rule 7. */
const A = (v) => (Array.isArray(v) ? v : []);
const O = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const N = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const f6 = (v) => (Number.isFinite(v) ? v.toFixed(6) : String(v));

// ==========================================================================
// 0. PREFLIGHT — machine properties only. Anything about OUR files is a FAIL.
// ==========================================================================
const electron = path.join(ROOT, 'node_modules', '.bin', 'electron');
if (!fs.existsSync(electron)) skip('electron is not installed — npm i');
for (const bin of ['xvfb-run', 'flock', 'pw-cli', 'pw-dump', 'pw-record', 'pw-link', 'python3']) {
  if (!hasBin(bin)) skip(`${bin} is not on PATH — this box has no PipeWire audio harness`);
}
if (spawnSync('python3', ['-c', 'import numpy'], { stdio: 'ignore' }).status !== 0) {
  skip('python3 has no numpy — spike/harness/bin/rms.py cannot measure anything');
}
if (spawnSync('pw-cli', ['info', '0'], { stdio: 'ignore', timeout: 10000 }).status !== 0) {
  skip('no PipeWire daemon answered `pw-cli info 0` — there is no audio device to witness');
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const fixture = pathToFileURL(path.join(ROOT, 'tools', 'fixture', 'player.html')).href;

// ==========================================================================
// 1. THE SEAM (assertion 9) — pure, no launch, no sink
// ==========================================================================
{
  const scan = scanForGateSeam();
  ok('the capture-side instrument is not shipped: no product source names the gate hook or the meter, and the flag that opens the seam is dead in a packaged build  [entry point: src/main/main.js `const GATE` + `if (GATE)`]',
    scan.clean,
    `${scan.files} src file(s) scanned with comments stripped, ${scan.guarded}/2 mentions of tools/ `
    + `under an \`if (GATE)\` in src/main/main.js, electron-builder config ${scan.builder}`
    + (scan.gate.ok
      ? `; \`${scan.gate.one}\` EVALUATED, not matched: app.isPackaged=true -> '' (--gate ignored), =false -> the flag`
      : '')
    + (scan.clean ? '' : ` — LEAKED: ${scan.bad.join('; ')}`));
}

// ==========================================================================
// 2. THE LOCKS, THEN OUR OWN SINK
// ==========================================================================
/**
 * THE SINK LOCK IS TAKEN FIRST AND THE BROWSER MUTEX SECOND, EVERYWHERE, and
 * that order is not a preference — it is `docs/TESTING.md` §4 ("the PipeWire
 * sink lock, ON TOP, taken FIRST"), and inverting it in one caller is a deadlock.
 * It cost a run: a battery holding the browser mutex outermost while a leftover
 * suite held the sink lock and waited for the browser mutex sat there until both
 * were killed. Any wrapper that pre-takes these must take them in THIS order.
 */
/**
 * ---------------------------------------------------------------------------
 * CONTENTION IS NOT A FAILED ASSERTION. IT IS A SKIP.
 * ---------------------------------------------------------------------------
 * These two acquisitions used to end in `ok(…, false)` when `flock -w 900`
 * timed out: *"the run takes the shared browser mutex — <path> was held for
 * 900 s"*. That verdict is not a fact about this product. It is a fact about
 * what ELSE was running on the box, and it went red on a tree nobody had
 * touched — which is precisely what `AGENTS.md` forbids: *"a gate whose verdict
 * changes on code that did not change is measuring the machine."*
 *
 * It was also an assertion that could only ever be FALSE. Nothing ever called
 * either of those two `ok()`s with a true condition, so they were error reports
 * wearing an assertion's clothes, and they inflated no count on a green run.
 *
 * A GATE THAT CANNOT GET THE RESOURCES TO MEASURE HAS NOT MEASURED; IT HAS NOT
 * FAILED. So contention takes the same honest exit this file already uses when
 * `pw-cli` is missing: `SKIPPED`, which `tools/verify.mjs` prints under "WHAT
 * DID NOT RUN" and which makes an unqualified GREEN impossible. The positive
 * claim is not lost — assertion 8 still requires the sink lock to have been
 * HELD THROUGHOUT, measured by a non-blocking `flock` that must be refused.
 *
 * AND THE THIRD CASE IS STILL HARD. `flock` missing from the box is tooling,
 * like `pw-cli`, and skips. Anything else — `flock` present and exiting for a
 * reason that is not the timeout — is a broken harness and exits non-zero
 * naming what happened, because silently skipping on an unknown failure is the
 * green-on-nothing this suite exists to refuse.
 */
const lockSkip = (label, r) => {
  if (r.why === 'contention') {
    skip(`${label} was held by another run for the whole ${r.waitS} s wait (${r.file}). `
      + 'Nothing on this box could have measured anything while somebody else held it — this is '
      + 'contention, not a defect, and a gate that cannot get the resources to measure has not measured.');
  }
  if (r.why === 'missing') {
    skip(`\`flock\` is not on PATH, so ${label} cannot be taken (${r.file}). Same class as a missing pw-cli.`);
  }
  console.log(`FAIL  taking ${label} failed for a reason that is neither contention nor a missing flock  `
    + `${r.why}: ${r.detail} (${r.file})`);
  fail++;
  done();
};

const SINK_HELD_BY_CALLER = process.env.STEM_WORKBENCH_SINK_LOCK_HELD === '1';
const sinkLock = SINK_HELD_BY_CALLER
  ? {
    ok: true,
    release() {},
    /**
     * NOT A CONSTANT `true`. Assertion 8's "held throughout" half is a real
     * question even when somebody else took the lock, so it is answered the same
     * way the per-sample witness answers it: a non-blocking `flock` that must
     * FAIL because someone holds it. A stub returning true would be an assertion
     * that cannot fail, which is the thing this whole file exists to avoid.
     */
    alive: () => spawnSync('flock', ['-n', SINK_LOCK, '-c', 'true'], { timeout: 20000 }).status !== 0,
    label: 'the PipeWire sink lock (held by the caller)',
  }
  : await holdLock(SINK_LOCK, 'the PipeWire sink lock');
if (!sinkLock.ok) lockSkip('the PipeWire sink lock', sinkLock);
/**
 * ...UNLESS THE CALLER ALREADY HOLDS IT. `flock` is not reentrant across
 * processes, so a battery that wraps its WHOLE run in the shared mutex — which is
 * what `tools/suites/capture-mute-mutations.sh` does, because three agents share
 * this checkout — would deadlock against this line. The escape is the same shape
 * as `spike/harness/bin/env.sh`'s `SINK_LOCK_HELD`, and it is a hand-off with no
 * assertion attached on purpose: a suite cannot verify a lock it did not take, so
 * it reports which of the two happened rather than claiming the stronger thing.
 */
const HELD_BY_CALLER = BROWSER_LOCK_HELD_BY_CALLER;
const browserLock = HELD_BY_CALLER
  ? { ok: true, release() {}, alive: () => true, label: 'the shared browser mutex (held by the caller)' }
  : await holdLock(BROWSER_LOCK, 'the shared browser mutex');
if (!browserLock.ok) { sinkLock.release(); lockSkip('the shared browser mutex', browserLock); }

armWatchdog();
cleanup = () => {
  try { sinkSh('destroy'); } catch { /* reported below */ }
  browserLock.release();
  sinkLock.release();
};
process.on('uncaughtException', (e) => { console.log(`FAIL  ${ID} threw  ${e && e.stack}`); fail++; done(); });
/**
 * A KILLED RUN MUST NOT LEAVE A SINK ON THE DAEMON OR A LOCK HELD. PipeWire nodes
 * are created here with `object.linger=true`, so they outlive the process that
 * made them: a Ctrl-C without this leaves `stem_workbench_gate` standing on a
 * machine three agents share, and the next run silently destroys and recreates
 * whatever it finds under that name. 130 is the shell's own "terminated by
 * SIGINT".
 */
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n${ID}: ${sig} — destroying ${SINK} and releasing the locks before exiting.`);
    cleanup();
    process.exit(130);
  });
}

const created = sinkSh('create');
if (created.code !== 0) {
  ok(`the isolated null sink ${SINK} is created and has monitor ports`, false, lastLine(created.out));
  done();
}

/**
 * WHICH SINK A CHILD IS ROUTED TO, as opposed to which sink we MEASURE. They are
 * the same in every real run and they are separately nameable for exactly one
 * reason, the same one `spike/harness/bin/env.sh` gives for `APP_SINK`: it is the
 * only way to show that the node witness (assertion 7) can LOSE. Point the app
 * somewhere else and the speaker meter still reads 0.0 — a pass for the wrong
 * reason — and assertion 7 is what goes red.
 */
const routedTo = (sink) => ({ ...process.env, PULSE_SINK: sink, PIPEWIRE_NODE: sink });

// ==========================================================================
// 3. THE CONTROL, FIRST — variant (d): the same capture, one flag flipped
// ==========================================================================
/**
 * IT IS A SECOND PROCESS, NOT A SECOND WINDOW, and that is forced rather than
 * chosen: the `nocapture` control the spike used requires `getDisplayMedia` never
 * to be called, so it cannot share a process with a capture run. (d) can, and (d)
 * is the LOAD-BEARING one — the same capture running, `enableLocalEcho` flipped —
 * which is what rules out "starting the capture tore the app's output stream
 * down", the other thing that reads 0.0.
 *
 * `spike/main.js` is that process. It is the code that produced the reference
 * numbers (captured 0.350307-0.351061, speaker 0.344373-0.348256) and reusing it
 * is what stops this file from becoming a third instrument to keep honest. It is
 * pointed at the SAME `tools/fixture/player.html` the app under test uses, so the
 * control's 0.35 and the app's 0.0 are the same signal measured the same way.
 */
const control = await measuredRun('control', [
  '-a', '-s', '-screen 0 1280x1024x24',
  electron, '--no-sandbox', path.join(ROOT, 'spike', 'main.js'),
  '--variant=d', '--page=local', `--url=${fixture}`, `--seconds=${WINDOW_SECONDS}`,
  `--out=${path.join(OUT, 'control.json')}`,
], { sink: SINK });
const controlJson = readJson(path.join(OUT, 'control.json'));
const controlCaptured = N(O(A(O(controlJson).windows)[0]).rms);
const controlHeld = control.rms.ok && N(control.rms.json.rms) >= CONTROL_FLOOR;

// ==========================================================================
// 4. THE APP — one real launch, recorded from before it starts to after it exits
// ==========================================================================
const userData = path.join(OUT, 'userdata');
const app = await measuredRun('app', [
  '-a', '-s', '-screen 0 1280x1024x24',
  electron, '.', `--gate=${OUT}`, '--gate-probe=capture-mute',
  `--source-url=${fixture}`, `--user-data=${userData}`,
], { witness: true, sink: SINK });

const R = readJson(path.join(OUT, 'report.json'));

// ==========================================================================
// 5. SCORE
// ==========================================================================
ok('the app launches from its real entry point and writes a capture-mute report  [entry point: `electron .` -> src/main/main.js]',
  R !== null && O(R).gate === 1 && O(R).probe === 'capture-mute',
  R ? `exit ${app.code}, electron ${O(O(R).versions).electron} / chromium ${O(O(R).versions).chrome}, `
    + `pid ${O(R).pid}, routed to ${JSON.stringify(O(O(R).env).pulseSink)}`
    : `exit ${app.code}, no out/${ID}/report.json — last line: ${lastLine(app.out)}`);
if (!R) done();

const W = O(R.mute).witness;
const measured = O(R.measured);
const settings = O(O(R.capture).settings);

// ------------------------------------------------- MUTED, AND THE CAPTURE IS REAL
ok('the source view reports muted, from before its first load to after the window closes  [entry point: src/main/youtube.js createSourceView()]',
  O(W).mutedAtCreate === true
  && A(O(W).mutedBeforeLoad).length > 0 && A(O(W).mutedBeforeLoad).every((m) => m === true)
  && O(W).unmutedNavigations === 0
  && [O(R.mute).atBoot, O(R.mute).whilePlaying, O(R.mute).beforeCapture, O(R.mute).afterCapture]
    .every((s) => O(s).isAudioMuted === true),
  `atCreate=${O(W).mutedAtCreate} beforeLoad=${JSON.stringify(A(O(W).mutedBeforeLoad))} `
  + `unmutedNavigations=${O(W).unmutedNavigations} `
  + `isAudioMuted boot/playing/preCapture/post = `
  + `${[O(R.mute).atBoot, O(R.mute).whilePlaying, O(R.mute).beforeCapture, O(R.mute).afterCapture].map((s) => O(s).isAudioMuted).join('/')} `
  + `· isCurrentlyAudible ${O(O(R.mute).afterCapture).isCurrentlyAudible} (reported, never asserted on)`);

ok('the captured level sits inside the fixture\'s analytic band, not merely above a floor  [entry point: vendor/…/offscreen/host.js captureStream()]',
  measured.ok === true && N(measured.rms) >= CAPTURE_MIN && N(measured.rms) <= CAPTURE_MAX,
  measured.ok === true
    ? `rms ${f6(N(measured.rms))} in [${CAPTURE_MIN}, ${CAPTURE_MAX}], analytic ${f6(CAPTURE_ANALYTIC)}, `
      + `peak ${f6(N(measured.peak))}, channels ${measured.channels}, `
      + `series ${JSON.stringify(A(measured.series).slice(0, 4))}… `
      + '(a floor alone passes an AGC-crushed 0.108)'
    : `no level: ${measured.reason || O(R.capture).reason || measured.THREW || 'the capture never opened'}`);

ok('...over a window counted in RENDER QUANTA rather than wall seconds, and 0 quanta is an error  [entry point: tools/fixture/rms-worklet.js]',
  measured.ok === true && N(measured.quantaWithChannels) >= MIN_QUANTA
  && N(measured.quanta) >= MIN_QUANTA && N(measured.samples) > 0,
  `${measured.quanta} quanta, ${measured.quantaWithChannels} with channels (>= ${MIN_QUANTA}), `
  + `${measured.samples} samples, worklet rate ${measured.workletSampleRate}, `
  + `${f6(N(measured.seconds))} s of audio — the 4 s threshold jitters 3.979-4.011 and goes red on ~10 % of clean runs`);

// ------------------------------------------------------- THE CAPTURE IS USABLE
/**
 * FIVE SEPARATE ASSERTIONS, so a red names WHICH ONE MOVED. A naive
 * `getDisplayMedia({audio: true})` yields mono 48 kHz with AGC, and it looks fine
 * to a careless gate. `vendor/…/offscreen/host.js` refuses such a stream itself,
 * so the mutation that flips one of these turns the refusal into the red — which
 * is the same assertion failing through the Host's own guard rather than around
 * it. Delete that guard and the setting itself goes red here. Both are watched.
 */
const why = () => (O(R.capture).ok ? '' : ` — captureStream: ${O(R.capture).reason || O(R.capture).THREW}`);
ok('the capture comes back STEREO  [entry point: vendor/…/offscreen/host.js CAPTURE_MUST_BE]',
  settings.channelCount === 2, `channelCount=${JSON.stringify(settings.channelCount)}${why()}`);
ok('...at 44100 Hz, the model\'s rate, so nothing resamples on the live path',
  settings.sampleRate === 44100, `sampleRate=${JSON.stringify(settings.sampleRate)}${why()}`);
ok('...with automatic gain control OFF — AGC decayed a constant tone 17x over 8 s here',
  settings.autoGainControl === false, `autoGainControl=${JSON.stringify(settings.autoGainControl)}${why()}`);
ok('...with echo cancellation OFF',
  settings.echoCancellation === false, `echoCancellation=${JSON.stringify(settings.echoCancellation)}${why()}`);
ok('...with noise suppression OFF',
  settings.noiseSuppression === false, `noiseSuppression=${JSON.stringify(settings.noiseSuppression)}${why()}`);

// ------------------------------------------- SILENT, AND THE SILENCE MEANS SOMETHING
/**
 * VOID, NOT GREEN, when the control did not hold. A silence reading taken by a
 * meter that has not been shown to hear anything is not evidence of silence.
 */
const voidly = (name, cond, detail) => (controlHeld
  ? ok(name, cond, detail)
  : ok(name, false, `VOID — no verdict, the speaker-side control did not hold. (would have read: ${detail})`));

voidly('the audio device stayed silent for the app\'s WHOLE lifetime, measured outside the process',
  app.rms.ok && N(app.rms.json.rms) <= SILENCE_CEILING,
  app.rms.ok
    ? `rms ${f6(N(app.rms.json.rms))} <= ${SILENCE_CEILING}, peak ${f6(N(app.rms.json.peak))}, `
      + `over ${N(app.rms.json.seconds).toFixed(3)} s / ${app.rms.json.frames} frames of ${SINK}'s monitor, `
      + `recorder up ${app.recorderLeadMs} ms before the launch and stopped ${app.recorderTailMs} ms after the exit `
      + '(a window-scoped meter cannot see variant (a)\'s 1.90 s pre-capture leak)'
    : `MEASUREMENT FAILED: ${lastLine(app.rms.err)}`);

voidly('...and both meters covered the time they claim to — a short or empty recording is an error, never a 0',
  app.recDiedEarly !== true
  && app.rms.ok && N(app.rms.json.seconds) >= COVERAGE * (app.lifetimeMs / 1000)
  && measured.ok === true && N(measured.seconds) >= COVERAGE * WINDOW_SECONDS,
  `${app.recDiedEarly ? 'THE RECORDER DIED BEFORE THE APP DID; ' : ''}`
  + `speakerSeconds ${app.rms.ok ? N(app.rms.json.seconds).toFixed(3) : 'n/a'} vs app lifetime `
  + `${(app.lifetimeMs / 1000).toFixed(3)} s (floor ${(COVERAGE * app.lifetimeMs / 1000).toFixed(3)}, `
  + `rms.py --min-seconds enforces it and exits 3); capturedSeconds `
  + `${measured.ok ? N(measured.seconds).toFixed(3) : 'n/a'} of ${WINDOW_SECONDS} s`);

// ------------------------------------------------------------- THE NODE WITNESS
/**
 * ASSERTION 7 IS WHAT CLOSES "the app was never connected at all", and it is a
 * property of THIS RUN'S PROCESS TREE rather than of the sink. The spike's
 * control asserted the latter, and a reviewer greened the whole matrix by
 * routing the app to a decoy and playing an unrelated tone into the measured
 * sink. A third party's audio cannot satisfy this one.
 */
const samples = A(app.witness);
const inWindow = samples.filter((s) => s.inWindow);
const nodeSample = (s) => A(O(s.links).writers).filter((w) => O(w).mediaClass === 'Stream/Output/Audio'
  && A(O(s.links).expectPids).includes(Number(O(w).pid)) && O(w).target === SINK);
const withNode = inWindow.filter((s) => nodeSample(s).length > 0);

ok('the app\'s OWN audio output node named a pid in this run\'s tree and targeted the measured sink, in-window',
  inWindow.length >= 2 && withNode.length === inWindow.length
  && app.pids.includes(Number(O(R).pid)),
  `routed to ${app.routedTo}, measuring ${SINK}; `
  + `${withNode.length}/${inWindow.length} in-window samples carried it; browser pid ${O(R).pid} `
  + `${app.pids.includes(Number(O(R).pid)) ? 'is' : 'IS NOT'} in the ${app.pids.length}-pid tree we walked; `
  + `nodes ${JSON.stringify(inWindow.map((s) => nodeSample(s).map((w) => `${w.name}#${w.pid} target=${w.target} ${w.state}/${w.linkState}`)))}`);

ok('...and nothing outside that tree wrote to the sink while we measured, and the run held the sink lock throughout',
  inWindow.length >= 2 && inWindow.every((s) => O(s.links).exclusive === true && s.exit === 0)
  && samples.every((s) => s.lockHeldByUs === true) && sinkLock.alive(),
  `${inWindow.length} in-window witness(es), foreign writers `
  + `${JSON.stringify(inWindow.map((s) => A(O(s.links).foreignWriters).map((w) => `${w.name}#${w.pid}`)))}, `
  + `pwlinks --pid exit ${JSON.stringify(inWindow.map((s) => s.exit))} (4 = contaminated); `
  + `\`flock -n ${path.basename(SINK_LOCK)}\` refused for us ${samples.filter((s) => s.lockHeldByUs).length}/${samples.length} times; `
  + `${sinkLock.label} ${sinkLock.alive() ? 'still held' : 'NO LONGER HELD'}`);

// --------------------------------------------------- THE CONTROL, WHICH MUST LOSE
ok('the control can be heard: a variant (d) process, one flag flipped, on the same sink inside the same lock',
  controlHeld,
  control.rms.ok
    ? `speakerRms ${f6(N(control.rms.json.rms))} >= ${CONTROL_FLOOR} (observed 0.344-0.348), `
      + `peak ${f6(N(control.rms.json.peak))} over ${N(control.rms.json.seconds).toFixed(3)} s; `
      + `its own capture read ${f6(controlCaptured)}; enableLocalEcho=true, view NOT muted, capture RUNNING`
    : `MEASUREMENT FAILED: ${lastLine(control.rms.err)} — spike said ${lastLine(control.out)}`);
if (!controlHeld) {
  console.log(`\n${ID}: VOID — the speaker-side control did not hold, so the silence readings above`);
  console.log(`${ID}: are not evidence of silence. Fix the meter before reading anything else.`);
}

console.log(`\n${ID}: sink ${SINK} · recordings out/${ID}/{control,app}.wav · report out/${ID}/report.json · `
  + `witness out/${ID}/witness.json · launch logs out/${ID}/{control,app}.log`);
done();

// ========================================================================
// helpers
// ========================================================================
function lastLine(s) { const l = String(s || '').trimEnd().split('\n'); return l[l.length - 1] || '(no output)'; }
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function hasBin(name) {
  for (const dir of (process.env.PATH || '').split(':')) {
    try { fs.accessSync(path.join(dir, name), fs.constants.X_OK); return true; } catch { /* next */ }
  }
  return false;
}

/**
 * HOLD AN `flock` FOR THE LIFE OF THIS SUITE. Node has no `flock(2)`, so the
 * lock is held by a child that does nothing but sit on its stdin: `flock` holds
 * the lock for as long as the command it wraps runs, and closing that stdin ends
 * it. `alive()` is what assertion 8's "for its whole life" half reads.
 */
/**
 * IT REPORTS WHY IT COULD NOT TAKE THE LOCK, AND THAT IS THE WHOLE POINT OF THE
 * RETURN SHAPE. It used to answer `null` for every failure, so the one caller
 * had nothing to tell contention from a missing `flock` from a broken one and
 * called all three a failed assertion. Three different things:
 *
 *   contention  `flock -w 900` exits 1 having waited the whole window. Somebody
 *               else holds it. A fact about the box -> SKIP.
 *   missing     `flock` is not on PATH (spawn ENOENT). Tooling -> SKIP.
 *   error       anything else, including any other exit code. A broken harness
 *               -> hard, because skipping on an unknown failure is the
 *               green-on-nothing this file exists to refuse.
 */
function holdLock(file, label) {
  return new Promise((resolve) => {
    const child = spawn('flock', ['-w', String(LOCK_WAIT_S), file, '-c', 'echo HELD; cat > /dev/null'],
      { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    child.stdout.on('data', (c) => {
      out += c.toString();
      if (out.includes('HELD')) {
        finish({
          ok: true,
          release() { try { child.stdin.end(); child.kill('SIGTERM'); } catch { /* gone */ } },
          alive: () => child.exitCode === null && child.signalCode === null,
          label,
        });
      }
    });
    child.stderr.on('data', (c) => { err += c.toString(); });
    // `flock -w` exits 1 on the timeout and only on the timeout; any other code
    // is flock itself failing, which is not contention and must not read as it.
    child.on('close', (code) => finish({
      ok: false,
      why: code === 1 ? 'contention' : 'error',
      detail: `flock exited ${code}${err.trim() ? ` — ${err.trim().slice(0, 160)}` : ''}`,
      file,
      waitS: LOCK_WAIT_S,
      label,
    }));
    child.on('error', (e) => finish({
      ok: false,
      why: e && e.code === 'ENOENT' ? 'missing' : 'error',
      detail: String((e && e.message) || e),
      file,
      waitS: LOCK_WAIT_S,
      label,
    }));
  });
}

/** `spike/harness/bin/sink.sh <verb>` — we already hold the lock, so it must not re-take it. */
function sinkSh(verb) {
  const r = spawnSync('bash', [path.join(HARNESS, 'bin', 'sink.sh'), verb], {
    env: { ...process.env, SINK_NAME: SINK, RATE: String(SINK_RATE), CHANNELS: String(SINK_CHANNELS), SINK_LOCK_HELD: '1' },
    encoding: 'utf8', timeout: 60000,
  });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

/** Every descendant of `root`, plus `root`. Chromium puts audio output in a utility process. */
function tree(root) {
  const kids = new Map();
  for (const e of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(e)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${e}/stat`, 'utf8');
      // `comm` can hold spaces and parentheses; everything after the LAST ')' is
      // the fixed-width part, and ppid is its second field.
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      if (!kids.has(ppid)) kids.set(ppid, []);
      kids.get(ppid).push(Number(e));
    } catch { /* the process went away between readdir and read */ }
  }
  const out = [];
  const queue = [root];
  while (queue.length) {
    const p = queue.shift();
    if (out.includes(p)) continue;
    out.push(p);
    for (const k of kids.get(p) || []) queue.push(k);
  }
  return out;
}

/**
 * ONE RUN, WITH THE SINK'S MONITOR RECORDED AROUND IT.
 *
 * The recorder is started BEFORE the process and stopped AFTER it, and both
 * offsets are reported: this is the single correction that makes the gate mean
 * what it says. `pw-record` fixes the WAV header up when it exits, so SIGINT —
 * never SIGKILL — is what leaves a readable file behind.
 */
async function measuredRun(tag, xvfbArgs, { witness = false, sink = SINK } = {}) {
  const wav = path.join(OUT, `${tag}.wav`);
  const rec = spawn('pw-record', [
    '--rate', String(SINK_RATE), '--channels', String(SINK_CHANNELS), '--format', 'f32',
    '--target', SINK, '-P', '{ stream.capture.sink=true }', wav,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let recOut = '';
  /**
   * THE RECORDER CAN DIE ON ITS OWN, AND WAITING FOR A `close` THAT ALREADY
   * FIRED IS A HANG, NOT A RED. It happened the first time the mutation battery
   * truncated a recording: `pw-record` was gone by the time the app exited, the
   * `close` listener was attached to a dead child, and the suite sat there
   * holding both locks — including the shared browser mutex a sibling agent was
   * queued on. A suite that hangs has not reported anything.
   */
  let recClosed = false;
  rec.on('close', () => { recClosed = true; });
  rec.on('error', () => { recClosed = true; });
  rec.stdout.on('data', (c) => { recOut += c.toString(); });
  rec.stderr.on('data', (c) => { recOut += c.toString(); });

  // Wait for the recorder to actually be on the sink before the app can make a
  // sound. A recording that started late is the exact defect this file exists to
  // fix, so it is waited for rather than slept past.
  const recStarted = Date.now();
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(wav) && fs.statSync(wav).size > 0) break;
    await sleep(50);
  }
  const recorderUpAt = Date.now();

  const openMark = path.join(OUT, 'window.open');
  fs.rmSync(openMark, { force: true });
  fs.rmSync(path.join(OUT, 'window.close'), { force: true });

  const spawnedAt = Date.now();
  const child = spawn('xvfb-run', xvfbArgs, { cwd: ROOT, env: routedTo(sink), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const grab = (c) => { out += c.toString(); };
  child.stdout.on('data', grab);
  child.stderr.on('data', grab);
  const killer = setTimeout(() => { out += `\n[suite] TIMEOUT — killing ${tag}\n`; child.kill('SIGKILL'); }, 240000);

  const samples = [];
  const pids = new Set([child.pid]);
  let sampling = Promise.resolve();
  if (witness) {
    /**
     * SAMPLED INSIDE THE WINDOW, three times, and the window is announced by the
     * probe touching a file rather than guessed with a `sleep`. A witness taken
     * before the capture opened or after it closed answers a different question.
     */
    sampling = (async () => {
      for (let i = 0; i < 1200 && !fs.existsSync(openMark) && child.exitCode === null; i++) await sleep(50);
      for (const at of [0, 1300, 1300]) {
        await sleep(at);
        if (child.exitCode !== null) break;
        const now = tree(child.pid);
        for (const p of now) pids.add(p);
        const r = spawnSync('python3', [path.join(HARNESS, 'bin', 'pwlinks.py'), SINK, '--pid', now.join(','), '--json'],
          { encoding: 'utf8', timeout: 40000 });
        const lock = spawnSync('flock', ['-n', SINK_LOCK, '-c', 'true'], { timeout: 20000 });
        samples.push({
          at: Date.now(),
          inWindow: fs.existsSync(openMark) && !fs.existsSync(path.join(OUT, 'window.close')),
          exit: r.status,
          pidCount: now.length,
          links: (() => { try { return JSON.parse(r.stdout); } catch { return { parseError: (r.stdout || r.stderr || '').slice(0, 200) }; } })(),
          // Non-zero means SOMEBODY holds it, and the only somebody that can is
          // this suite's own holder child.
          lockHeldByUs: lock.status !== 0,
        });
      }
    })();
  }

  const code = await new Promise((resolve) => {
    child.on('error', (e) => { out += `\nspawn error: ${e.message}\n`; resolve(127); });
    child.on('close', (c) => resolve(c));
  });
  clearTimeout(killer);
  await sampling;
  const exitedAt = Date.now();
  const lifetimeMs = exitedAt - spawnedAt;

  // Let anything the app queued reach the sink, then stop the recorder cleanly.
  await sleep(400);
  const recDiedEarly = recClosed;
  if (!recClosed) {
    rec.kill('SIGINT');
    await Promise.race([
      new Promise((resolve) => { rec.on('close', resolve); rec.on('error', resolve); }),
      sleep(10000),
    ]);
  }
  const recStoppedAt = Date.now();

  fs.writeFileSync(path.join(OUT, `${tag}.log`), `${out}\n---- pw-record ----\n${recOut}\n`);
  if (witness) fs.writeFileSync(path.join(OUT, 'witness.json'), `${JSON.stringify(samples, null, 2)}\n`);

  /**
   * `--min-seconds` IS THE could-it-look GUARD. An empty recording and a silent
   * recording both have RMS 0, so `rms.py` exits 3 on the first rather than
   * reporting a 0 that cannot fail.
   */
  const floor = (COVERAGE * lifetimeMs / 1000).toFixed(3);
  const m = spawnSync('python3', [path.join(HARNESS, 'bin', 'rms.py'), wav, '--min-seconds', floor, '--json'],
    { encoding: 'utf8', timeout: 120000 });
  let json = null;
  try { json = JSON.parse(m.stdout); } catch { /* asserted on */ }

  return {
    code, out, pids: [...pids], witness: samples, lifetimeMs, routedTo: sink, recDiedEarly,
    recorderLeadMs: spawnedAt - recStarted,
    recorderTailMs: recStoppedAt - exitedAt,
    recorderUpMs: recorderUpAt - recStarted,
    rms: { ok: m.status === 0 && json !== null, json, err: `${m.stdout || ''}${m.stderr || ''}` },
  };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * ASSERTION 9 — THE TEST HOOK IS A SEAM, AND A SEAM THAT IS NOT ASSERTED SHUT IS
 * A HOLE.
 *
 * This product opens exactly TWO doors for its own gate, and both are the same
 * flag:
 *
 *   `if (GATE) ROOTS.push({ prefix: '/gate/', dir: … 'tools', 'fixture' })`
 *        the RMS worklet is served on the app origin — a worklet module is
 *        fetched under `script-src`, and `script-src 'self' 'wasm-unsafe-eval'`
 *        refuses a `blob:` one (measured).
 *   `if (GATE) { … await import(… 'tools', 'gate', `${GATE_PROBE}.mjs`) … }`
 *        the probe itself, imported dynamically so the product's module graph
 *        does not contain its own gate.
 *
 * So the property is: comments stripped, the string `tools` appears in `src/**`
 * exactly twice, both in `src/main/main.js`, and BOTH under an `if (GATE)`. The
 * first is a one-line guard matched by shape; the second must sit after the
 * `if (GATE) {` block opens. Anything else — a third mention, a mention in
 * another file, either guard removed, or any mention of the meter or of a gate
 * environment variable anywhere — is a leak, named in the detail.
 *
 * COMMENTS ARE STRIPPED FIRST, and crudely: block comments and `//` to end of
 * line, with no string-literal awareness. Stated rather than hidden — it is
 * enough for this question, and it is why `main.js`'s prose about
 * `tools/gate/probe.mjs` does not read as a leak.
 *
 * THE ELECTRON-BUILDER CONFIGURATION IS NAMED WHETHER OR NOT IT EXISTS. There is
 * none yet, and a scan that silently passes over an absent file is an assertion
 * that cannot fail; the detail says which of the two it was, every run.
 */
/**
 * WHAT COUNTS AS REACHING INTO `tools/`, and what is only PROSE.
 *
 * `path.join(APP_ROOT, 'tools', 'gate', …)` is how this product would ever
 * actually reach a test file, so the quoted BARE SEGMENT is the primary match;
 * the three test directories are matched by name for a literal path written in
 * one piece. What is deliberately NOT matched is the word `tools` inside a
 * sentence — `src/main/speed.js` tells the user to run `bash tools/vendor-unit.sh`
 * in a runtime error message, and a scan that called that a leak would be a red
 * on English rather than on the seam. That case is real: it turned this assertion
 * red on its first outing, and the rule was narrowed rather than the message
 * reworded.
 *
 * The two things that are banned OUTRIGHT, anywhere in `src/**`, need no such
 * care because no product sentence has a reason to contain them: the meter's
 * file name, and a gate environment variable.
 */
function reachesIntoTools(line) { return /['"`]tools['"`]|tools\/(gate|fixture|suites)\b/.test(line); }

/**
 * THE OTHER HALF OF ASSERTION 9: THE GUARD IS OUT OF A USER'S REACH, not merely
 * present.
 *
 * The scan above proves both seams sit under an `if (GATE)`. That is a guard,
 * and a guard is not the same claim as "no one can trip it". `GATE` is
 * `--gate=DIR` — a command line — and the second seam imports a module whose
 * NAME is also a command line (`--gate-probe`; `path.basename()` stops
 * traversal, so the file must already exist, but *"a shipped app that executes a
 * module named on its command line"* is still the sentence to make unwritable).
 * So `src/main/main.js` conjoins `!app.isPackaged` at the definition, and this
 * is what holds it there.
 *
 * IT IS NOT A SUBSTRING MATCH. `/app\.isPackaged/.test(line)` would pass on a
 * line that merely mentions it — including one that reads it and ignores it.
 * This lifts the real `const GATE = …;` statement out of the real file and
 * EVALUATES it twice, in a `new Function` whose only free names are `app` and
 * `val`: once with `isPackaged: true`, requiring `''`, and once with `false`,
 * requiring the flag's value back. The second half matters as much as the first
 * — a guard written as `const GATE = ''` would shut the seam by breaking the
 * gate, and this says so instead of passing.
 *
 * The cost of evaluating rather than matching is that a definition referring to
 * anything other than `app` and `val` throws — and a throw is a red naming the
 * message, not a silent pass. Same for one that does not terminate within six
 * lines. Both are the right failure: this file has to be able to read that
 * statement, and a statement it cannot read is one nobody is checking.
 */
function evalGateDefinition(mainCode) {
  const lines = mainCode.split('\n');
  const at = lines.findIndex((l) => /^\s*const GATE\s*=/.test(l));
  if (at < 0) return { ok: false, why: 'src/main/main.js has no `const GATE =` statement' };
  const parts = [];
  for (let i = at; i < Math.min(at + 6, lines.length); i++) {
    parts.push(lines[i]);
    if (/;\s*$/.test(lines[i])) break;
  }
  const src = parts.join('\n');
  const one = src.trim().replace(/\s+/g, ' ');
  if (!/;\s*$/.test(parts[parts.length - 1])) {
    return { ok: false, why: `\`const GATE\` does not terminate within 6 lines: \`${one.slice(0, 90)}\`` };
  }
  const FLAG = '/tmp/stem-workbench-not-a-real-gate-dir';
  const run = (isPackaged) => new Function('app', 'val', `${src}\nreturn GATE;`)(
    { isPackaged }, (k, d) => (k === 'gate' ? FLAG : d),
  );
  let packaged, dev;
  try { packaged = run(true); dev = run(false); }
  catch (err) { return { ok: false, why: `evaluating \`${one.slice(0, 60)}\` threw: ${err.message}` }; }
  if (packaged) {
    return { ok: false, why: `a PACKAGED build would still honour --gate: \`${one}\` -> ${JSON.stringify(packaged)}` };
  }
  if (dev !== FLAG) {
    return { ok: false, why: `a DEVELOPMENT build no longer honours --gate: \`${one}\` -> ${JSON.stringify(dev)}` };
  }
  return { ok: true, one };
}

function scanForGateSeam() {
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|cjs|mjs|html|css|json)$/.test(e.name)) files.push(p);
    }
  })(path.join(ROOT, 'src'));

  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const MAIN = path.join('src', 'main', 'main.js');
  const bad = [];
  let guarded = 0;
  let mainCode = null;
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    const code = strip(fs.readFileSync(f, 'utf8'));
    if (rel === MAIN) mainCode = code;
    if (/STEM_WORKBENCH_GATE/.test(code)) bad.push(`${rel} names a gate environment variable`);
    if (/rms-worklet/.test(code)) bad.push(`${rel} names the meter (rms-worklet)`);
    const lines = code.split('\n');
    const hits = lines.map((l, i) => [l, i]).filter(([l]) => reachesIntoTools(l));
    if (!hits.length) continue;
    if (rel !== MAIN) { bad.push(`${rel} reaches into tools/ (${hits.length} line(s))`); continue; }
    if (hits.length !== 2) { bad.push(`${rel} reaches into tools/ on ${hits.length} lines, expected 2`); continue; }
    const blockAt = lines.findIndex((l) => /^\s*if \(GATE\) \{\s*$/.test(l));
    for (const [line, i] of hits) {
      if (/^\s*if \(GATE\) ROOTS\.push\(/.test(line)) { guarded++; continue; }
      if (blockAt >= 0 && i > blockAt) { guarded++; continue; }
      bad.push(`${rel}:${i + 1} reaches into tools/ OUTSIDE an \`if (GATE)\`: ${line.trim().slice(0, 70)}`);
    }
  }

  const gate = mainCode === null
    ? { ok: false, why: `${MAIN} was not scanned at all` }
    : evalGateDefinition(mainCode);
  if (!gate.ok) bad.push(`the gate flag is not development-only: ${gate.why}`);

  /**
   * THE PACKAGING CONFIG MUST NOT SHIP `tools/`, WHEREVER IT LIVES.
   *
   * The seam this assertion is about — the `app://` root that serves
   * `tools/fixture/` — is dead in a packaged build twice over (`const GATE` is
   * `''` when `app.isPackaged`, and the directory is not in the bundle). The
   * SECOND of those is a property of this configuration, so it is checked
   * rather than assumed, and it is checked over EVERY place electron-builder
   * will look: the `build` key AND a standalone `electron-builder.*`. Reading
   * only `package.json` would mean the check quietly stopped applying the day
   * somebody moved the config out of it.
   */
  const pkg = readJson(path.join(ROOT, 'package.json')) || {};
  const configs = [];
  if (pkg.build) configs.push(['package.json "build"', JSON.stringify(pkg.build)]);
  for (const f of fs.readdirSync(ROOT)) {
    if (!/^electron-builder\.(ya?ml|json|js|cjs|mjs|ts)$/.test(f)) continue;
    configs.push([f, fs.readFileSync(path.join(ROOT, f), 'utf8')]);
  }
  let builder = 'ABSENT — no packaging configuration anywhere (docs/TESTING.md §11)';
  if (configs.length) {
    const packers = configs.filter(([, blob]) => /tools/.test(blob)).map(([name]) => name);
    builder = packers.length
      ? `PACKAGES tools/ (${packers.join(', ')})`
      : `${configs.length} config(s) [${configs.map(([n]) => n).join(', ')}], none packages tools/`;
    for (const name of packers) bad.push(`${name} packages tools/`);
  }
  return { clean: bad.length === 0 && guarded === 2 && gate.ok, bad, files: files.length, guarded, builder, gate };
}
