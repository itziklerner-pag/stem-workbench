#!/usr/bin/env node
/**
 * stem-workbench's gate. One command, one verdict.
 *
 *   node tools/verify.mjs                # every step that is built and does not need a
 *                                        #   window or the audio daemon, plus the vendored
 *                                        #   unit's own gate
 *   node tools/verify.mjs --quick        # ...minus anything that opens a window or takes
 *                                        #   the PipeWire sink
 *   node tools/verify.mjs --only <id>    # exactly one step, by name
 *   node tools/verify.mjs --manual       # ONLY the manual steps (the real-YouTube smoke).
 *                                        #   Never on any default plan; see step `youtube`.
 *   node tools/verify.mjs --self-check   # test this file's own classifier. Spawns nothing.
 *   node tools/verify.mjs --list         # print the steps table and exit
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS FOR, AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 *
 * The plan's seed §17 decided option T2: **the vendored unit carries its own
 * gates**, and this repository adds HOST-specific suites only. So there are two
 * runners on this machine and exactly one of them is ours:
 *
 *   vendor/stem-splitter-live/tools/verify.mjs --unit    the unit's 12 suites,
 *       written against the exact code we vendored, run IN the vendored copy.
 *       We do not own it, do not edit it, and do not reimplement it. It is one
 *       STEP here (`vendor-unit`), so a pin bump is verified by the tests that
 *       travelled with the pin.
 *
 *   tools/verify.mjs (this file)                          the Host's suites.
 *
 * T1 — copy the extension's `tools/verify.mjs` and grow a second set of
 * conventions — was explicitly REJECTED: two runners, drifting where it is most
 * expensive. This file is therefore written in the SPIRIT of that one and is
 * deliberately much smaller. What it keeps, and what it leaves behind, is below.
 *
 * ---------------------------------------------------------------------------
 * THE VOID RULE — the one property that is not negotiable
 * ---------------------------------------------------------------------------
 *
 * A step that exits 0 having asserted NOTHING is a HARD FAILURE, not a pass.
 * (`stem-splitter-live/tools/verify.mjs:421-425`, and the `ASSERTED` convention
 * at :222-230.) Silence and success are indistinguishable from an exit code, so
 * this runner demands EVIDENCE — a summary line with a count of at least one —
 * and refuses to read its absence as green.
 *
 * Every count in `ASSERTED` is `[1-9]\d*`, never `\d+`. "0 passed, 0 failed" is
 * the VOID case wearing a summary line: a suite that walked its whole file and
 * asserted nothing prints exactly that and exits 0.
 *
 * `tools/suites/void-canary.mjs` is the step that proves this rule is wired, and
 * it can be watched going red on demand:
 *
 *   VOID_CANARY=silent node tools/verify.mjs --only void-canary   # -> VOID, RED
 *   VOID_CANARY=zero   node tools/verify.mjs --only void-canary   # -> VOID, RED
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS DELIBERATELY NOT COPIED FROM THE EXTENSION'S RUNNER
 * ---------------------------------------------------------------------------
 *
 * Stated as decisions with triggers, because an unlisted omission is
 * indistinguishable from an omission nobody noticed — which is the subject of
 * the standing rule at the top of the file this one is modelled on.
 *
 *   THE `FLAKY` CARVE-OUT (its :281-320). It is a list of assertions that may
 *       go red without turning the run red. This repository has no measured
 *       flake yet, and `AGENTS.md` is explicit that an assertion parked on an
 *       expected-red list stops being read at all. Shipping the mechanism
 *       before there is evidence for an entry is an invitation to use it.
 *       TRIGGER to add it: a documented, reproduced, distribution-measured
 *       flake — with an expiry condition, per `AGENTS.md`.
 *
 *   COVERAGE DRIFT (its :330-400). A real instrument, and it needs a baseline
 *       of assertion NAMES from a previous run to say anything. Four of this
 *       repository's five suites are not built yet, so there is nothing to
 *       diff. TRIGGER: the first time two of the host suites are green on the
 *       same tree. The pinned-count check on `vendor-unit` below is the cheap
 *       half of the same idea, and it is here today.
 *
 *   `reapOrphanBrowsers()` (its :880-930). It runs `pkill -f
 *       ms-playwright/chromium`, which on this machine kills a SIBLING AGENT's
 *       browser. The contention problem it solves is real; the answer here is
 *       the shared `flock` mutex the suites take, not a pkill.
 *
 *   THE MODEL-SEED PREFLIGHT and `--live-fixture` / `--soak-fixture` /
 *       `--audible` / `--strict`. Seed §15 bundles the weights in the
 *       installer, so "where the model is" becomes a Host duty and a packaging
 *       question, not a flag on the gate. TRIGGER: the first host suite that
 *       needs the weights (`smoke-live`, not yet written) brings a `heavy` flag
 *       and its own preflight with it.
 *
 *   THE `--unit` PLAN DERIVED FROM `extension/unit.json`. That manifest
 *       describes the unit, and the unit's own runner already builds its plan
 *       from it and already asserts the two agree, in both directions. Doing it
 *       again from outside would be a second copy of a list.
 *
 *   THE e2e SECTION PARSER (its `failuresWithSections`). It recovers bold
 *       section headers from a specific harness's transcript. Our suites print
 *       flat, by the convention in `docs/TESTING.md`, so a failing assertion is
 *       one line and needs no section to be read next to.
 *
 * What IS kept: the steps table, the VOID rule, `--quick` / `--only` /
 * `--self-check`, the per-step log tee, one summary at the end, and the rule
 * that the runner says out loud what did NOT run.
 *
 * ---------------------------------------------------------------------------
 * HONESTY ABOUT THE PLAN
 * ---------------------------------------------------------------------------
 *
 * This runner never prints an unqualified GREEN over a partial plan. A step
 * that was skipped, a step that is declared and not built (`todo`), a manual
 * step, and a filtered-out step are each named in the verdict. `verdict()`
 * below is a pure function so `--self-check` can assert exactly that.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out', 'verify');
/** The previous run's assertion names, per step. Under `out/`, so it is per-checkout and gitignored. */
const COVERAGE = path.join(OUT, 'coverage.json');
const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', b: '\x1b[1m', d: '\x1b[2m', x: '\x1b[0m' };
export const strip = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

// ---------------------------------------------------------------- the VOID rule
/**
 * Proof that a step actually ran assertions.
 *
 * The first shape is THIS repository's convention, fixed once in
 * `docs/TESTING.md` ("How a suite prints"): `<suite-id>: N passed, M failed` as
 * the last line. The rest are the shapes the VENDORED unit's suites print, and
 * they are here because `vendor-unit` streams that runner's whole transcript
 * through this classifier — a shape it does not recognise would report the
 * unit's green as VOID.
 *
 * EVERY COUNT IS `[1-9]\d*`, NEVER `\d+`. A count of nothing is still nothing.
 * Line-anchored, so a number sitting in the middle of an assertion's PROSE
 * cannot vouch for a run.
 */
const SUM = String.raw`^\s*(?:[\w-]+:\s*)?(?:all\s+)?`;
export const ASSERTED = new RegExp([
  SUM + String.raw`[1-9]\d*\s+passed,\s+\d+\s+failed`,   // ours, and test.js / run-ext.mjs
  SUM + String.raw`[1-9]\d*\s*/\s*\d+\s+passed`,          // embed-smoke
  SUM + String.raw`[1-9]\d*\s+(?:[\w-]+\s+)?checks?\s+passed`,
  String.raw`all checks passed`,
  String.raw`^\s*(?:PASS|ok)\s`,
].join('|'), 'm');

/**
 * The number in a suite's own summary line — `p1: 24 passed, 0 failed`.
 *
 * The LAST such line, not the first: a suite may quote a count in its prose (and
 * `void-canary` prints four of them on purpose, as classifier fixtures), and the
 * summary is by construction the last thing printed. `null` when there is none,
 * which is a different answer from zero and is reported as one.
 *
 * @param {string} out  the transcript, already colour-stripped
 * @returns {number|null}
 */
export function countOf(out) {
  const all = [...String(out).matchAll(/^\s*(?:[\w-]+:\s*)?(?:all\s+)?(\d+)\s+passed,\s+\d+\s+failed\s*$/gm)];
  return all.length ? Number(all[all.length - 1][1]) : null;
}

// ------------------------------------------------------------------- the steps
/**
 * THE STEPS TABLE IS THE PLAN, AND A SUITE THAT IS NOT IN IT DOES NOT EXIST.
 *
 * The extension's runner carries a long standing note about suites that were
 * written, were green when run by hand, and were invisible to the gate for
 * hours or for a whole branch. Four of the five host suites below are NOT BUILT
 * YET, and they are declared here anyway, marked `todo`, for exactly that
 * reason: a suite that is not in the table is indistinguishable from a suite
 * nobody thought of. `todo` steps never run, are printed in the verdict every
 * time, and make an unqualified GREEN impossible.
 *
 * `assertions: N` — THE EXACT COUNT THE SUITE MUST PRINT, and it is checked.
 * `vendor/.pin` pins the vendored plan's 544 both ways and
 * `vendor/.conformance.json` pins 612/593/19 both ways, for a reason `vendor-unit`
 * states out loud: *"the count of SUITES cannot see a suite that ran and asserted
 * less than it used to."* This repository's own twelve suites had no such pin,
 * and an audit showed the cost — `deck-seam` with its `ok()` silently dropping a
 * class of assertion names printed `32 passed, 0 failed` instead of 49, and the
 * runner called it PASS. `classify()` now refuses that, exactly, and
 * `tools/suites/void-canary.mjs` holds these numbers against the count column in
 * `docs/TESTING.md`, so neither can be moved quietly on its own.
 *
 * `vendor-unit` HAS NONE, deliberately: its count is somebody else's runner's and
 * is pinned in `vendor/.pin` in both directions, over a report the count check
 * below never reaches (it exits 1 as pinned).
 *
 * Flags:
 *   window  needs an X display and launches Electron. `--quick` drops it. The
 *           suite is responsible for `xvfb-run -a` and for the shared browser
 *           mutex — see `docs/TESTING.md`, "Running a windowed suite".
 *   sink    additionally needs PipeWire and an exclusive null sink. `--quick`
 *           drops it.
 *   manual  never on any default plan, at all. `--manual`, or `--only <id>`.
 *   todo    declared, not built. Never runs; always named in the verdict.
 */
export const STEPS = [
  {
    id: 'void-canary',
    assertions: 50,
    title: 'node tools/suites/void-canary.mjs — the steps table agrees with docs/TESTING.md, and the VOID rule is wired',
    cmd: ['node', 'tools/suites/void-canary.mjs'],
  },
  {
    id: 'vendor-intact',
    assertions: 6,
    title: 'bash tools/vendor-unit.sh --check — nothing under vendor/ was edited, added or removed behind the pin',
    cmd: ['bash', 'tools/vendor-unit.sh', '--check'],
    /**
     * BEFORE `vendor-unit`, ON PURPOSE. That step runs the unit's own suites,
     * and they are perfectly capable of passing over a tree somebody has
     * edited — most of the 50 copied files are not what any one of them
     * asserts about, and `unit.sha256` is not consulted by any of them. So the
     * cheap question goes first, because its answer changes how the next
     * step's green is read: 12 green suites over an edited copy is a fork
     * reporting that it still works.
     *
     * Offline and ~0.1 s: it hashes what is on disk against `vendor/.pin`,
     * `vendor/upstream.sha256` and the vendored `extension/unit.sha256`. The
     * network belongs to `tools/vendor-unit.sh` with no flag, which re-vendors.
     */
  },
  {
    id: 'vendor-unit',
    title: "node tools/verify.mjs --unit, IN the vendored copy — the unit's own 12 suites over the exact code we pinned",
    cwd: 'vendor/stem-splitter-live',
    cmd: ['node', 'tools/verify.mjs', '--unit', '--no-reap'],
    /**
     * `--no-reap` IS LOAD-BEARING AND IS NOT A STYLE CHOICE. Without it that
     * runner opens with `pkill -f ms-playwright/chromium`, which kills every
     * Playwright Chromium on the machine — including a sibling agent's, and
     * including our own `smoke` step if the two ever overlap. `--unit` launches
     * no browser, so it has nothing to protect from contention anyway.
     */
    precheck: vendorPrecheck,
    /**
     * ============================================================================
     * THIS STEP EXPECTS A NON-ZERO EXIT, AND PINS THE WHOLE REPORT BOTH WAYS.
     * READ `vendor/.pin`'s `hostSuite` BLOCK BEFORE CHANGING ANYTHING HERE.
     * ============================================================================
     * `--unit` runs twelve suites. Eleven are ordinary and pass. The twelfth,
     * `unit`, runs the vendored `test.js` — which is BOTH the unit's largest
     * suite AND a conformance suite over the two hole modules a Host supplies —
     * and with THIS Host's holes in place it does not fail, it CRASHES:
     *
     *     TypeError: listeners[0] is not a function   at test.js:5833
     *
     * so the vendored runner exits 1 on every run, for ever. That is an upstream
     * design gap with a ticket (`stem-splitter-live#30`), unfixable from this
     * side and unpatchable here (rule V1, and `vendor-intact` runs first).
     *
     * A STEP THAT CAN NEVER BE GREEN IS THE SHAPE PEOPLE LEARN TO IGNORE, which
     * is exactly what AGENTS.md says a red must never become. So this step stops
     * demanding a green line that cannot happen and pins the report it really
     * gets — in BOTH directions:
     *
     *   (i)  the ELEVEN other suites must all PASS and must sum to
     *        `vendor/.pin`'s `assertions` (544). A shorter plan, a suite that
     *        stopped running, or a suite that went red is a FAIL. This is the
     *        half that keeps the step worth running.
     *   (ii) `unit` must be the ONLY non-PASS row — so a GREEN `unit` is ALSO a
     *        FAIL. Post-swap a green `unit` cannot mean the unit got better; it
     *        means the two files in `ours` are not this Host's any more.
     *
     * WATCHED RED BOTH WAYS, ON REAL RUNS, by
     * `tools/suites/vendor-unit-mutations.sh` — which fetches the v0.2.0 archive
     * and checks its SHA-256 against this pin before it uses a byte of it:
     *
     *   A  `BPM_MIN_CONFIDENCE` 0.25 -> 0.99 in `extension/engine/bpmtap.js`
     *      -> `bpmtap` FAIL -> step FAIL: "10 suites passed, vendor/.pin pins
     *      11; the passing suites assert 498, vendor/.pin (v0.2.0) pins 544".
     *   B  the EXTENSION's own `ui/host.js` and `offscreen/host.js` put back
     *      -> `unit` PASSES, 612 green, the whole vendored plan 12 of 12 and
     *      EXIT 0 -> step FAIL: "exit 0, but … `unit` PASSED — … the two files
     *      `vendor/.pin` names in `ours` are not this Host's hole modules any
     *      more … never appeared".
     *
     * B ARRIVES BY THE EXIT-0 DOOR AND NOT THROUGH `pin` AT ALL, which is why
     * `why` below carries that whole finding: a green `unit` takes the vendored
     * plan to exit 0, and the branch that knows what `hostSuite` is only opens
     * at the pinned non-zero code. `pin`'s own EVERY-suite-passed message covers
     * the same claim from the other side and is asserted in `--self-check`.
     *
     * A CRASH IS NOT LAUNDERED INTO AN EXPECTED FAILURE. `unit` must still be a
     * CRASH, carrying `crashMessage` at `crashAt`. A `unit` that asserts and
     * fails cleanly, or one that crashes elsewhere, is different IN KIND from
     * what is pinned and fails the step rather than being absorbed by it.
     *
     * THREE THINGS WERE TRIED AND REJECTED, so that nobody re-derives them:
     *
     *   · PATCH `test.js`. Rule V1, and `vendor-intact` runs first and says so.
     *   · RUN `--unit` MINUS THE `unit` STEP. The vendored runner asserts, both
     *     ways, that `--unit`'s plan IS the suite list `unit.json` declares
     *     (its `tools/verify.mjs:835`). There is no subset to ask for, and
     *     building one here is the second runner T1 rejected.
     *   · PUT `tools/conformance-platform.mjs` ON `NODE_OPTIONS` FOR THIS STEP.
     *     It would stop the crash — and it would also hand a `window` global to
     *     the eleven other suites, which is a change to what they measure. A
     *     gate that alters its subject to keep itself green is worse than a red.
     *
     * THE VERDICT FOR `test.js` IS THE `conformance` STEP, which runs the same
     * file, unedited, to completion under this Host's own platform: 612
     * assertions, 593 passed, 19 failed, every red pinned by name in
     * `vendor/.conformance.json` and argued in `docs/CONFORMANCE.md`. Nothing is
     * lost here that is not measured there.
     */
    expect: {
      /**
       * THE EXIT CODE IS DECLARED, and declaring it is what opens the one branch
       * in `classify()` that reads `expect` on a non-zero exit. No other step
       * declares it, and `--self-check` asserts that.
       */
      code: 1,
      re: /RED — (\d+) failing assertions/,
      /**
       * THIS SENTENCE IS THE RED A REAL GREEN RUN GETS, so it leads with the
       * diagnosis rather than with the regex. `classify()` prints it as
       * "exit 0, but <why> never appeared" — and exit 0 is the ONE outcome the
       * pin below can never explain, because a green `unit` takes the whole
       * vendored plan to exit 0 and the branch that knows about `hostSuite` is
       * only reached at the pinned non-zero code. Measured exactly that way:
       * `tools/suites/vendor-unit-mutations.sh B` puts the extension's own hole
       * modules back, the vendored plan prints `12 of 12 PASS` and exits 0, and
       * this is the text that has to carry the whole finding.
       */
      why: 'the vendored runner\'s own RED banner. A run that EXITS 0 and prints its GREEN line instead '
        + 'means `unit` PASSED — which post-swap cannot mean the unit got better. It means the two files '
        + '`vendor/.pin` names in `ours` are not this Host\'s hole modules any more; check those against '
        + '`git status` before anything else. While ours are in place test.js does not fail, it CRASHES at '
        + ':5833 (vendor/.pin `hostSuite`, upstream stem-splitter-live#30), so this step pins the report it '
        + 'really gets instead of a green that cannot happen. The verdict for test.js itself is the '
        + '`conformance` step',
      /**
       * `pin` TAKES THE PIN AS AN ARGUMENT so `--self-check` can drive it over a
       * pin this repository does not have on disk — in particular one with no
       * `hostSuite` block at all, which is what `tools/vendor-unit.sh` would
       * leave behind if it ever stopped carrying the block across a re-vendor.
       * That case must be a FAIL and not a quiet pass.
       */
      pin: (m, t, p = readPin()) => {
        if (!p) return 'vendor/.pin is missing or unreadable — this step pins its whole report against it';
        const h = p.hostSuite;
        if (!h) {
          return 'vendor/.pin has no `hostSuite` block, so there is nothing to hold this run to. '
            + '`tools/vendor-unit.sh` rewrites the pin on a re-vendor and must carry that block across; '
            + 'if it did not, restore it from git rather than deleting this check';
        }
        const bad = [];
        const rows = vendorRows(t);
        const passing = rows.filter((r) => r.verdict === 'PASS');
        const other = rows.filter((r) => r.verdict !== 'PASS');

        // ---- the plan, then the eleven that must still work.
        if (typeof p.steps === 'number' && rows.length !== p.steps) {
          bad.push(`the run reported ${rows.length} suites, vendor/.pin (${p.tag}) pins ${p.steps}`
            + ` [${rows.map((r) => `${r.id} ${r.verdict}`).join(' ')}]`);
        }
        if (passing.length !== h.passingSuites) {
          bad.push(`${passing.length} suites passed, vendor/.pin pins ${h.passingSuites}`
            + ` [${rows.map((r) => `${r.id} ${r.verdict}`).join(' ')}]`);
        }
        const total = passing.reduce((n, r) => n + r.count, 0);
        if (typeof p.assertions === 'number' && total !== p.assertions) {
          bad.push(`the passing suites assert ${total}, vendor/.pin (${p.tag}) pins ${p.assertions}`
            + ` [${passing.map((r) => `${r.id} ${r.count}`).join(' ')}]`);
        }

        // ---- THE OTHER DIRECTION, and it is the one an ignore-list never has.
        if (other.length !== 1 || other[0].id !== h.id) {
          bad.push(other.length === 0
            ? `EVERY suite passed, including \`${h.id}\` — post-swap that cannot mean the unit got better. `
              + `It means ${(p.ours || []).map((o) => `vendor/stem-splitter-live/${o}`).join(' and ')} `
              + 'are not this Host\'s hole modules any more. Check them before anything else'
            : `expected exactly one non-PASS row (\`${h.id}\`), got `
              + `[${other.map((r) => `${r.id} ${r.verdict}`).join(' ')}]`);
        }

        // ---- A CRASH MUST NOT BE LAUNDERED INTO AN EXPECTED FAILURE.
        const unit = rows.find((r) => r.id === h.id);
        if (unit && unit.verdict !== 'PASS') {
          const d = unit.detail || '';
          if (!/CRASHED/.test(d)) {
            bad.push(`\`${h.id}\` failed WITHOUT crashing (${d}) — vendor/.pin pins a crash at ${h.crashAt}. `
              + 'Asserting and failing is different IN KIND from dying, and probably good news: read '
              + 'vendor/.pin `hostSuite` and re-pin deliberately');
          } else if (h.crashMessage && !d.includes(h.crashMessage)) {
            bad.push(`\`${h.id}\` crashed with something else: ${d} — vendor/.pin pins `
              + `"${h.crashMessage}" at ${h.crashAt}`);
          }
        }
        return bad.length ? bad.join('; ') : null;
      },
      /**
       * THE CRASH STAYS ON THE SUMMARY LINE. `summarise()` would read the first
       * `N passed, M failed` in the transcript — which is some inner suite's —
       * and print a green-looking number beside a step whose whole point is that
       * one suite is dying. This says what actually happened, on the one line
       * most people read.
       */
      detail: (m, t) => {
        const rows = vendorRows(t);
        const passing = rows.filter((r) => r.verdict === 'PASS');
        const h = (readPin() || {}).hostSuite || {};
        return `${passing.length} suites PASS, ${passing.reduce((n, r) => n + r.count, 0)} assertions; `
          + `\`${h.id || 'unit'}\` CRASHED at ${h.crashAt || '?'} as pinned (${m[1]} reds before it died, `
          + 'upstream stem-splitter-live#30)';
      },
    },
  },
  {
    id: 'deck-seam',
    assertions: 53,
    title: 'node tools/suites/deck-seam.mjs — the DeckHost conformance suite: the shipped hole module over a stubbed preload bridge',
    cmd: ['node', 'tools/suites/deck-seam.mjs'],
    /**
     * NO WINDOW, NO DISPLAY, NO MUTEX, ~0.4 s — and that is the point of it
     * rather than a convenience. `docs/VENDORING.md` offers three things to do
     * about `group('host')`'s 122 conformance assertions and this repository
     * takes option 3, but half of option 3 is not available: that group installs
     * a CHROME platform, and our `ui/host.js` reaches for an Electron preload
     * bridge, so its deck half reports on a platform that is not there. This
     * step is the same claims — the seven rules `shared/host.js` declares — made
     * against the shipped hole module over a stub of OUR platform.
     *
     * It runs BEFORE `shell` deliberately: it is the cheapest thing on the plan
     * and the two things a broken Host breaks silently (late binding and the
     * envelope) are both in it, so a red here changes how a windowed green is
     * read.
     */
  },
  {
    id: 'backend',
    assertions: 55,
    title: 'node tools/suites/backend.mjs — WHICH inference backend, and the wire to seed §16\'s second one, over a fake engine',
    cmd: ['node', 'tools/suites/backend.mjs'],
    /**
     * NO WINDOW, NO DISPLAY, NO MUTEX, ~0.3 s — and, like `deck-seam`, that is
     * the point rather than a convenience. Three things are gated here and all
     * three are true on a machine that cannot run the backend they are about:
     *
     *   · THE SELECTION TABLE. `chooseBackend()` is pure — a platform, an arch,
     *     a probe result and a preference in, a decision out — so all twenty
     *     rows are drivable anywhere. One row per assertion, so an inverted row
     *     produces exactly one red that names itself.
     *   · THE WIRE, over a `node:worker_threads` `MessageChannel` and a FAKE
     *     engine: the frozen `(k*2 + ch) * SEGMENT + i` layout survives the hop,
     *     both caller buffers come back as themselves and neither is detached,
     *     and `dispose()` settles a genuinely in-flight call BY NAME.
     *   · THE NEGATIVE CONTROL, which is the one that matters most: on this
     *     platform the native backend is unavailable, the shipped hole builds
     *     the unit's own `WorkerBackend`, and it does so even with a native
     *     factory sitting right beside it.
     *
     * WHAT IT IS NOT. It is not evidence about CoreML — see `backend-coreml`,
     * which is the step that asks that question and skips here with a machine
     * reason. A green here over unbuilt code would be the exact failure this
     * project keeps finding, so the suite says so in its own summary line.
     */
  },
  {
    id: 'shell',
    assertions: 41,
    title: 'node tools/suites/shell.mjs — one real launch of `electron .`: the window, isolation, the capture grant, the mute, the allowlist, the sign-in user-agent',
    cmd: ['node', 'tools/suites/shell.mjs'],
    window: true,
  },
  {
    id: 'engine-host',
    assertions: 37,
    title: 'node tools/suites/engine-host.mjs — the ENGINE half of the seam over one real launch: the nine duties, the model, a real capture',
    cmd: ['node', 'tools/suites/engine-host.mjs'],
    window: true,
    /**
     * AFTER `shell`, ON PURPOSE, AND MUCH SLOWER THAN IT. `shell` asks whether
     * the app skeleton is the shape it says it is and answers in ~2 s without
     * ever loading the unit. This one boots the vendored engine, reads 109 MB of
     * weights through the Host, builds an ONNX session (~8 s of compile and
     * warm-up on wasm) and arms two real captures. Its cost is the model's, not
     * the suite's, and `--quick` drops it with every other windowed step.
     *
     * IT SKIPS, RATHER THAN FAILS, WITHOUT `models/htdemucs_6s.onnx`. The
     * weights are 109 MB, are not in git, and are seeded by
     * `bash tools/vendor-unit.sh --model`. A skip is named in the verdict; a red
     * for a file that was never meant to be committed would be a red people
     * learn to ignore.
     *
     * WHAT FALSIFIES IT — `tools/suites/engine-host-mutations.sh`, 29 named
     * cases, each declaring the assertion names it must turn red, with
     * `tools/suites/coverage.py` over the whole battery refusing an assertion
     * that has never been seen on a FAIL line. Reading the battery is how you
     * find out which of this step's claims are load-bearing:
     *
     *   the nine duties     cases 1-11, 20-22 and 29 edit the shipped hole module
     *                       `vendor/…/offscreen/host.js` one duty at a time —
     *                       delete a duty, tidy assetUrl's trailing slash away,
     *                       drop the M1 containment guard, hand modelBytes a
     *                       VIEW instead of the buffer, memoise it, mislabel its
     *                       phase, skip the capture claim, defer the teardown
     *                       callback, drop createBackend's hooks, guard
     *                       onMessage on the wrong address, leave the video
     *                       track on the stream the engine is handed.
     *   the platform        cases 12, 23, 24 and 26 edit `src/main/` — COOP and
     *                       COEP off every `app://` response, the `/model/` root
     *                       off the protocol handler, the grant pointed at the
     *                       wrong frame, the engine never put on its address.
     *   the three messages  cases 13, 14, 15 and 25 edit
     *                       `src/main/engine-messages.js` — a `tabId` put back
     *                       on CAPTURE_START.source, `deck` sent for the default
     *                       deck, CAPTURE_STOP without revoking, nothing
     *                       originated at all.
     *   the capture claim   cases 16-19 and 28 edit `src/main/claims.js` — spend
     *                       twice, spend a token nobody minted, ignore the
     *                       deadline, leave the claim pending, keep the live
     *                       claims through a revoke.
     *   THE INSTRUMENT      case 27 points the probe's report somewhere nobody
     *                       looks. Everything else in this suite reads a file
     *                       the probe wrote, so a suite that cannot tell a
     *                       missing report from a passing run reports green on
     *                       an app that never launched — the VOID case, one
     *                       level in.
     *
     * FOUR OF THIS STEP'S ASSERTIONS EXIST BECAUSE THE BATTERY FALSIFIED THEIR
     * FIRST DRAFT rather than the code: the capture-settings check measured the
     * probe's own copy of the constraints (case 8), the revoke check ran over an
     * empty claim registry (15), the frame count was green over silence (22),
     * and one assertion crashed the process instead of reporting red (25).
     */
  },
  {
    id: 'transport',
    assertions: 64,
    title: 'node tools/suites/transport.mjs — the source view\'s transport: L1, the closed write set, the jump rule, speed, autoplay-next, the keys',
    cmd: ['node', 'tools/suites/transport.mjs'],
    window: true,
  },
  {
    id: 'deck-host',
    assertions: 29,
    title: "node tools/suites/deck-host.mjs — the DECK half of the seam: fourteen members over a stub AND one real launch, the three messages the Host originates, and the autoplay-next wire",
    cmd: ['node', 'tools/suites/deck-host.mjs'],
    window: true,
    /**
     * IT IS A `window` STEP AND HALF OF IT IS NOT. §1 — 38 assertions driving
     * the shipped hole module over a stub bridge in plain node — needs no
     * display at all, and `--quick` therefore drops assertions it did not have
     * to. That is deliberate rather than an oversight: splitting it into two
     * steps would let the conformance half go green over an app that does not
     * boot, which is the pairing this suite exists to prevent. The cost is
     * named in `docs/TESTING.md`, and `DECK_HOST_ONLY=conformance` is how the
     * mutation battery pays only the second's worth.
     */
  },
  {
    id: 'p1',
    assertions: 24,
    title: "node tools/suites/p1.mjs — P1': every session the app creates reaches the update host and nothing else",
    cmd: ['node', 'tools/suites/p1.mjs'],
    window: true,
    /**
     * IT NEEDS `openssl` AS WELL AS A DISPLAY, and it skips rather than fails
     * without it: the suite stands up a real TLS server wearing `UPDATE_HOST`'s
     * certificate and points Chromium's resolver at it, because the app's check
     * goes through Chromium's own network stack and there is no route to fulfil.
     *
     * THE ASSERTION THIS STEP EXISTS FOR CANNOT BE MADE BY THE INSTRUMENT ALONE.
     * "The app's own sessions reached exactly one host" is silence-shaped: an
     * app that made no requests and an observer that was never installed produce
     * the same transcript. So the fake host's own hit counter — another process,
     * on the other side of the wire — is half of two of the assertions, and
     * `instrument silent + host hit` is a RED rather than a green.
     *
     * WHAT FALSIFIES IT — `tools/suites/p1-mutations.sh`, 19 named cases, one
     * per assertion, with `tools/suites/coverage.py` refusing an assertion that
     * has never been seen on a FAIL line. Two of them are worth knowing about
     * without reading the file: case 14 stops the observer recording https while
     * leaving the wire alone (the blind-observer shape), and case 17 records the
     * cancellation and then does not apply it — the log still says
     * `cancelled: true` and only the fake host's counter disagrees.
     */
  },
  {
    id: 'conformance',
    assertions: 11,
    title: "node tools/suites/conformance.mjs — the unit's own group('host'), pointed at THIS Host's hole modules, run to completion",
    cmd: ['node', 'tools/suites/conformance.mjs'],
    /**
     * VENDORING.md OPTION 3, ACTUALLY DELIVERED — and it is a step of OURS
     * rather than part of `vendor-unit` because the two ask opposite questions:
     * `vendor-unit` asks whether the UNIT still works; this asks whether our
     * HOST still satisfies the unit's own description of one. A red there is a
     * broken copy. A red here is a broken Host. One step could not mean both.
     *
     * IT RUNS THE VENDORED `test.js` UNEDITED, with `tools/conformance-platform.mjs`
     * installed under it by `--import`. Without that platform the file does not
     * fail, it CRASHES — `TypeError: listeners[0] is not a function` at
     * `test.js:5833` — and takes 103 assertions with it, including
     * `group('verifyModel')` and `group('backend')`, which are about the unit
     * and not about us. That is an upstream defect and a sibling of
     * `stem-splitter-live#30`; it is NOT patched here (rule V1, and
     * `vendor-intact` runs first and would say so), and `docs/CONFORMANCE.md`
     * records both the measurement and the finding.
     *
     * THE RED SET IS PINNED IN `vendor/.conformance.json` AND COMPARED BOTH
     * WAYS. It is deliberately not an expected-red list — `AGENTS.md`: an
     * assertion parked on one stops being read at all. A red that VANISHES fails
     * this step too, because a red that stops being reported is usually an
     * assertion that stopped running, which is exactly how the crash hid 103 of
     * them while the transcript still looked busy.
     *
     * NO WINDOW, NO DISPLAY, NO MUTEX, ~65 s: it is plain Node over the vendored
     * suite, so it runs on the `--quick` plan with the other cheap steps.
     */
  },
  {
    id: 'updates',
    assertions: 36,
    title: "node tools/suites/updates.mjs — the update check's host and channel, the toggle's lifetime, and the three platform blocks",
    cmd: ['node', 'tools/suites/updates.mjs'],
    /**
     * NO WINDOW, NO DISPLAY, NO MUTEX, ~0.2 s — and it is on the `--quick` plan
     * for the reason `deck-seam` is: everything it asserts is a pure function, a
     * JSON file or a `createStorage()` over a temp directory, and the channel
     * decision has eight edge cases that no launch can reach.
     *
     * IT IS NOT `p1`, AND THE SPLIT IS DELIBERATE. `p1` launches the app, points
     * the check at a fake host wearing `UPDATE_HOST`'s certificate and reads the
     * hit off a server in another process — that is the claim that the request
     * really goes to one host. This step is the claim that the CHANNEL, the
     * TOGGLE'S LIFETIME and the three `build` blocks are what they say they are.
     * One step could not mean both, and the second half must not cost a display.
     *
     * THE TOGGLE'S RESTART IS MEASURED, NOT READ: two `createStorage()` calls
     * over one directory, which is a relaunch minus the Electron process, plus
     * the CONTROL that the same value in `session` does NOT survive. Storing the
     * preference in `session` turns both rows red.
     */
  },
  {
    id: 'smoke',
    assertions: 21,
    title: 'node tools/suites/smoke.mjs — Playwright-for-Electron against the LOCAL fake player: boot, seam, transport, deck',
    cmd: ['node', 'tools/suites/smoke.mjs'],
    window: true,
    /**
     * THE ONLY STEP THAT STANDS OUTSIDE THE APP. Every other windowed suite
     * here drives the product from inside its own main process — `--gate=DIR`
     * imports a probe, hands it the live handles, and the suite judges the JSON
     * it wrote. That is what makes them cheap and exact, and it is also why not
     * one of them can press a menu item or read the deck's painted surface. This
     * one drives `electron .` over CDP through Playwright's `_electron` API, so
     * the arm gesture it exercises is the application menu's own item and the
     * answer it reads is the deck's DOM.
     *
     * IT TAKES ITS OWN LOCKS, like every windowed step, but differently: it does
     * not spawn `electron` (Playwright does), so it re-execs ITSELF once under
     * `flock` + `xvfb-run -a` and the inner run does the work. `--quick` drops
     * it with every other windowed step.
     *
     * WHAT FALSIFIES IT — `tools/suites/smoke-mutations.sh`, 19 named cases,
     * each declaring the assertion names it must turn red, with
     * `tools/suites/coverage.py` over the whole battery refusing an assertion
     * that has never been seen on a FAIL line.
     */
  },
  {
    id: 'export',
    assertions: 23,
    title: 'node tools/suites/export.mjs — file intake: the allowlist, the title, the one-shot path token, and the export folder asked exactly once over two real launches',
    cmd: ['node', 'tools/suites/export.mjs'],
    window: true,
    /**
     * THE ONLY STEP THAT ANSWERS A NATIVE OPERATING-SYSTEM DIALOG, and the only
     * one that needs `xdotool`.
     *
     * The plan's G3 says the folder is asked exactly once and says HOW it must be
     * measured: *"the dialog count MUST be instrumented by counting invocations
     * in the main process... it must NOT be measured by replacing, stubbing, or
     * monkey-patching `dialog.showOpenDialog`"*. So this suite launches the app
     * twice over ONE profile, lets it open the real GTK chooser, answers it with
     * a real pointer and real keystrokes, and reads the count off the counter
     * `src/main/files.js` keeps beside its own call. Its first launched assertion
     * is the instrument check that the intake is holding electron's own module —
     * every count after it is worthless without that one.
     *
     * IT SKIPS, RATHER THAN FAILS, WITHOUT `xdotool`, for the same reason the
     * other windowed steps skip without `xvfb-run`: a native chooser that cannot
     * be answered is a property of the box (`docs/TESTING.md` §3 rule 8), and it
     * is the thing under test, so there is nothing to fall back to.
     *
     * IT LAUNCHES WITH `DBUS_SESSION_BUS_ADDRESS=disabled:`. On a box with a
     * session bus and no `xdg-desktop-portal` — which is this one — Chromium asks
     * the portal for a file dialog and never falls back to GTK: nothing maps and
     * the promise never settles. Removing the bus is what makes the in-process
     * GTK chooser appear, so it is done for the launch rather than left to the
     * machine. The suite's header carries the measurement and what it costs.
     *
     * HALF OF IT NEEDS NO DISPLAY. Nine assertions drive the allowlist, the title
     * derivation and the path tokens in plain node, and `--quick` therefore drops
     * fourteen assertions it did not have to — the same trade `deck-host` makes and for the
     * same reason: splitting them would let the pure half go green over an app
     * that cannot ask for a folder at all.
     *
     * THE COUNT MOVES WHEN THE EXPORT WRITER LANDS. G1, G2a and G2b-path — the
     * bit-exact 32-bit-float headers, six planes written unaltered in `STEMS`
     * order, and a title that cannot escape the folder ON DISK — belong to this
     * step and are not built yet. The suite's header says so in as many words.
     */
  },
  {
    id: 'capture-mute',
    assertions: 15,
    title: 'node tools/suites/capture-mute.mjs — the permanent gate: the view is captured at full level while the device stays silent',
    cmd: ['node', 'tools/suites/capture-mute.mjs'],
    window: true,
    sink: true,
    /**
     * THE ONLY STEP ON THIS PLAN THAT MEASURES THE PRODUCT'S PREMISE — *the app
     * can hear the view while the user cannot* — and the only one that needs a
     * running PipeWire daemon and an audio device it can own.
     *
     * IT WILL NEVER RUN IN GITHUB CI, AND THAT IS NAMED RATHER THAN DISCOVERED.
     * A hosted runner has no PipeWire, no sink and no soundcard, so the suite
     * SKIPS there — a property of the machine, `docs/TESTING.md` §3 rule 8 — and
     * a SKIP is not a pass anywhere in this file: `classify()` reports it as
     * SKIP, `verdict()` puts it under "WHAT DID NOT RUN" and refuses an
     * unqualified GREEN over the plan that contained it. The suite also prints
     * three lines under its own SKIPPED line saying, in words, that nothing
     * checked the property.
     *
     * THE CONSEQUENCE, STATED: no automated check anywhere will catch a
     * regression in the mute or in the capture-side silencing until somebody
     * runs this on a Linux box with PipeWire — and on macOS, nobody has run it
     * at all (`docs/TESTING.md` §11).
     *
     * IT COSTS ~45 s and takes TWO exclusive locks (the PipeWire sink lock
     * first, then the shared browser mutex) for two real launches: the app, and
     * a variant (d) CONTROL process that must be HEARD on the same sink or the
     * silence readings are printed VOID rather than green.
     *
     * WHAT FALSIFIES IT — `tools/suites/capture-mute-mutations.sh`, whose first
     * case removes `setAudioMuted(true)` and reproduces the leak this whole gate
     * was rewritten to catch.
     */
  },
  {
    id: 'dist-linux',
    assertions: 10,
    title: 'node tools/suites/dist-linux.mjs — the ONLY step that builds an installer and runs it: AppImage + deb, the feed inside the bundle, and the packaged app to its own ready signal',
    cmd: ['node', 'tools/suites/dist-linux.mjs'],
    window: true,
    /**
     * THE ONLY STEP ANYWHERE THAT RUNS SOMETHING A USER WOULD DOWNLOAD. Every
     * other windowed suite launches `electron .` over the CHECKOUT, and the
     * three differences that separates it from an installer are exactly the ones
     * that break silently: `app.isPackaged` flips and the weights move to
     * `process.resourcesPath`; the app is read out of an asar, so anything the
     * `files` glob forgot is simply absent; and `app-update.yml` — the
     * electron-updater feed, and therefore the RELEASE CHANNEL — exists only
     * inside a built artifact. `updates` asserts the channel in `package.json`
     * and in the code; this asserts it in the thing that would be shipped.
     *
     * IT IS THE LINUX HALF OF THE STANDING RULING being a measurement rather
     * than a claim: Linux is the verification platform, macOS and Windows are
     * configuration. Nothing here has ever built or signed either of those.
     *
     * IT COSTS ~2 min and takes the shared browser mutex once. The build is the
     * expensive half; a FIRST build on a cold box also downloads the Electron
     * zip, `appimagetool` and `fpm`, which is the one non-preflight SKIP the
     * suite has and it is narrow — nothing produced AND a resolver error in the
     * transcript. A build that RAN and rejected our configuration is a FAIL: the
     * first Linux build on this box failed that way, with the AppImage already
     * written and the deb missing, so assertion 1 is a SET over both targets.
     *
     * IT SKIPS, RATHER THAN FAILS, without electron-builder, the 109 MB of
     * weights, the ONNX Runtime drop, `xvfb-run` or `flock`. Each is named in
     * the SKIPPED line, and `--strict` turns every one of them into exit 2.
     */
  },
  {
    id: 'youtube',
    assertions: 26,
    title: 'node tools/suites/youtube.mjs — the same claims against real youtube.com, and the six stems. MANUAL / nightly only.',
    cmd: ['node', 'tools/suites/youtube.mjs'],
    window: true,
    manual: true,
    /**
     * THE ONLY STEP ANYWHERE THAT PROVES SIX STEMS COME OUT OF THE ENGINE INSIDE
     * THIS APP, and it is deliberately not on any default plan.
     *
     * `smoke`'s header names that hole in the default plan by name — "NOTHING IN
     * THE DEFAULT PLAN PROVES THE VENDORED ENGINE PRODUCES AUDIO INSIDE THIS
     * APP" — and this step is what closes it, at the cost of needing the
     * network, the 109 MB weights, and a site nobody here controls. It runs
     * `youtube.com` in the source view, presses play with a real input event,
     * waits out the pre-roll ad, clicks `Source -> Arm this Source` on the
     * application menu, and then makes TWO different measurements, because they
     * are two different claims:
     *
     *   THE LIVE PIPELINE, for twenty seconds of the engine's own `METERS` —
     *       six names in `STEMS` order, the deck's rack painted in `ui/embed.js`
     *       order, a master above the presence floor, and the scheduler's
     *       `chunks / drops / p95ChunkMs`. Whether it KEPT UP is RECORDED, not
     *       asserted: live mode needs ~4x real time and that is a property of
     *       the machine (docs/TESTING.md §3 rule 8).
     *   THE SEPARATOR, with the clock taken away — one 7.8 s SEGMENT of the
     *       captured audio through `host.createBackend()` and `host.modelBytes()`
     *       with no deadline. Six plane pairs, six distinct levels, and the SUM
     *       test: the six add back to the mix (0.97x here) where six COPIES of
     *       it would sum to six times it. That is the phase's headline claim and
     *       the one arithmetic settles rather than a level.
     *
     * IT IS MANUAL BECAUSE THE SITE IS NOT OURS. A red here is a realism finding
     * — the site changed, or the app stopped working on it — and it never blocks
     * a build, because it is never on a build's plan. `docs/TESTING.md` §7 also
     * forbids it a level BAND: one recorded spike run was measuring a pre-roll
     * ad, so every level claim in it is presence/absence against one floor.
     *
     * WHAT FALSIFIES IT — `tools/suites/youtube-mutations.mjs`: 43 rows that
     * doctor a RECORDED report one field at a time and re-judge it without
     * launching anything (coverage 26/26), plus three `--live` rows that edit
     * `src/` for real and re-run against the site. The two halves prove
     * different things and the file says which.
     */
  },
  {
    id: 'backend-coreml',
    title: 'node tools/suites/backend-coreml.mjs — the CoreML backend against real Apple Silicon. MANUAL, and it has never run.',
    cmd: ['node', 'tools/suites/backend-coreml.mjs'],
    manual: true,
    /**
     * THE STEP THAT NAMES WHAT NOBODY HAS ANSWERED.
     *
     * Seed §16's CoreML backend is written and SHIPS UNVERIFIED: the CEO ruled
     * step 7 in scope on a machine that is Linux, has no Apple hardware and does
     * not have `onnxruntime-node` installed. The runner's own standing note says
     * a suite that is not in this table "is indistinguishable from a suite
     * nobody thought of", and that is exactly the risk an unverified backend
     * carries — so the question is declared here, by name, and skips with a
     * MACHINE reason (`docs/TESTING.md` §3 rule 8) rather than being absent.
     *
     * `manual`, NOT A PERMANENT SKIP ON THE DEFAULT PLAN. `--strict` exists to
     * refuse a SKIP, and a step that can only ever skip on every machine this
     * project has would train people to ignore that signal. `youtube` is manual
     * for the same shape of reason. On a Mac with the module installed this runs
     * and answers.
     *
     * NO `assertions` PIN, and the absence is deliberate: this suite has never
     * printed a count anywhere, and a pin nobody has ever observed is a number
     * invented to look rigorous. `vendor-unit` is unpinned here for the adjacent
     * reason. `docs/TESTING.md`'s count column says so in words.
     */
  },
];

// ------------------------------------------------------------------- the pin
/**
 * THE VENDORED RUNNER'S SUMMARY TABLE, parsed out of its transcript.
 *
 * `  PASS  unit         11.0s    612 passed, 0 failed` — two spaces, the verdict
 * word, TWO more spaces, the padded step id, the seconds column, then that
 * step's own one-line detail. The seconds column is what separates these rows
 * from the individual `  PASS name  detail` assertion lines the same transcript
 * is full of; the two-space gap after the verdict alone is not enough, because
 * an assertion name may begin with a space-padded anything.
 *
 * The shape is not guessed. It was read off an actual
 * `node tools/verify.mjs --unit --no-reap` run in `stem-splitter-live` at
 * v0.2.0 (tree byte-identical to the tag: `git diff --name-only v0.2.0..HEAD`
 * is empty), which printed 12 rows summing to 1156 — the number
 * `docs/VENDORING.md` §7 independently pins for a copy with the EXTENSION's hole
 * modules in it.
 *
 * `vendor/.pin` PINS 544 AND NOT THAT 1156, because this repository's copy does
 * not have the extension's holes in it: `test.js` crashes with ours, so its 612
 * are pinned by the `conformance` step instead and what is pinned here is the
 * ELEVEN suites that still pass. `hostSuite` in the pin is the prose; the step
 * above is the check, and it is a SET EQUALITY over the rows this function
 * returns rather than a floor under them.
 *
 * WHY SUM THEM AT ALL, when the step count is already pinned: the count of
 * SUITES cannot see a suite that ran and asserted less than it used to. That is
 * the ABSENT-assertion failure the extension's coverage-drift instrument exists
 * for, and a pinned total is its cheap half — exact here, because `--unit` is
 * plain node and deterministic, and because a tag is immutable.
 *
 * IF IT EVER PROVES UNSTABLE: drop `assertions` from `vendor/.pin` rather than
 * widening it to a range. A range on a deterministic number is a gate that has
 * stopped measuring anything. The suite-set check keeps working without it.
 */
export function vendorRows(out) {
  return strip(out).split('\n')
    .map((l) => l.match(/^ {2}(PASS|FAIL|SKIP|FLAKY|VOID) {2}(\S+)\s+\d+\.\d+s\s+(.*)$/))
    .filter(Boolean)
    .map((m) => ({ verdict: m[1], id: m[2], detail: m[3].trim(), count: Number((m[3].match(/^(\d+)/) || [, 0])[1]) }));
}

/** `vendor/.pin` — what tag is vendored and what its gate is expected to run. */
export function readPin(root = ROOT) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'vendor', '.pin'), 'utf8')); }
  catch { return null; }
}

/**
 * THE ABSENT-VENDOR CASE, AND WHY IT IS NOT A PERMANENT EXCUSE.
 *
 * Before the vendor drop lands there is nothing at `vendor/stem-splitter-live`
 * and this step cannot run. Reporting that as a pass is the VOID rule's failure
 * one level up, so it is a SKIP — which is NOT green here, is printed in the
 * verdict, and downgrades the run to `GREEN (partial)`.
 *
 * The moment `vendor/.pin` exists the repository is CLAIMING to have vendored a
 * tag, and a missing tree is then a hard FAIL, not a skip. That is the line that
 * stops "skip because it is not there" from becoming permanent: it expires by
 * itself, on the same commit that creates the pin.
 */
function vendorPrecheck(step, root = ROOT) {
  const entry = path.join(root, step.cwd, 'tools', 'verify.mjs');
  if (fs.existsSync(entry)) return null;
  const pin = readPin(root);
  if (pin) {
    return { verdict: 'FAIL', detail: `vendor/.pin names ${pin.tag} but ${step.cwd}/tools/verify.mjs is absent`,
             hard: [`the pin claims ${pin.tag} is vendored and the tree is not there — re-run the vendor script`] };
  }
  return { verdict: 'SKIP', detail: `${step.cwd} is not present — nothing is vendored yet (no vendor/.pin)` };
}

// ---------------------------------------------------------------------- runner
function run(step) {
  return new Promise((resolve) => {
    const started = Date.now();
    fs.mkdirSync(OUT, { recursive: true });
    const logPath = path.join(OUT, `${step.id}.log`);
    const log = fs.createWriteStream(logPath);
    const cwd = step.cwd ? path.join(ROOT, step.cwd) : ROOT;
    let buf = '';
    console.log(`\n${C.b}=== ${step.id} ===${C.x} ${C.d}${step.cmd.join(' ')}${step.cwd ? `  (in ${step.cwd})` : ''}${C.x}`);
    const [bin, ...args] = step.cmd;
    const child = spawn(bin === 'node' ? process.execPath : bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const sink = (chunk) => { const s = chunk.toString(); buf += s; log.write(s); process.stdout.write(s); };
    child.stdout.on('data', sink);
    child.stderr.on('data', sink);
    child.on('error', (e) => {
      buf += `\nspawn error: ${e.message}\n`;
      resolve({ ...step, code: 127, out: buf, ms: Date.now() - started, logPath });
    });
    child.on('close', (code) => { log.end(); resolve({ ...step, code, out: buf, ms: Date.now() - started, logPath }); });
  });
}

const lastLines = (s, n) => strip(s).trimEnd().split('\n').slice(-n).join(' / ');

/** Best effort in both directions: a missing or unreadable baseline is a FIRST RUN, never an error. */
function readCoverage() {
  try { return JSON.parse(fs.readFileSync(COVERAGE, 'utf8')); } catch { return {}; }
}
function writeCoverage(all) {
  try { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(COVERAGE, `${JSON.stringify(all, null, 1)}\n`); }
  catch { /* the gate's verdict does not depend on this file existing */ }
}

/** Assertion lines, by the convention in docs/TESTING.md: `ok`/`PASS`/`FAIL` then the name then two spaces. */
export function assertionLines(out) {
  return strip(out).split('\n')
    .map((l) => l.match(/^\s{0,3}(ok|PASS|FAIL)\s+(.*)$/))
    .filter(Boolean)
    .map((m) => ({ pass: m[1] !== 'FAIL', name: m[2].split('  ')[0].trim(), line: m[0].trim() }))
    .filter((a) => a.name);
}

// ------------------------------------------------ coverage drift, BY NAME
/**
 * ===========================================================================
 * AN ABSENT ASSERTION READS AS GREEN, AND A COUNT CANNOT SAY WHICH ONE WENT.
 * ===========================================================================
 * `docs/TESTING.md` §2 listed assertion-name diffing as deliberately not copied
 * from the extension's runner, conditioned on *"the first time two host suites
 * are green on one tree"*. All twelve are built and green, so the condition this
 * repository set for itself has been met and the omission expires here.
 *
 * WHAT IT ADDS OVER THE PIN, which already exists and is not replaced. The
 * exact `assertions` pin in `STEPS` catches a shortfall and NAMES A NUMBER;
 * this names the assertions. They divide the work:
 *
 *     the pin      turns a shortfall RED, on an exit-0 run
 *     this         says WHICH assertions stopped running, on ANY run
 *
 * It is deliberately a WARNING and not a verdict. A legitimate suite change
 * moves names on purpose, and a fresh worktree has no baseline at all, so a
 * red here would fire on correct work and be routed around within a week. The
 * pin is what reds a shortfall; this is what lets you diagnose one.
 *
 * ---------------------------------------------------------------------------
 * THREE THINGS IT DOES DIFFERENTLY FROM THE EXTENSION'S, EACH FROM A MEASURED
 * HOLE RATHER THAN A PREFERENCE
 * ---------------------------------------------------------------------------
 * 1. IT DOES NOT GATE ON THE COUNT. The extension's returns early unless the
 *    total moved (`verify.mjs:399`, `if (!prev || prev.n === names.length)`),
 *    which reintroduces the blindness its own comment names two paragraphs
 *    earlier: *"two blocks that swap cancel out in a count."* The diff is over
 *    NAMES here, so a swap is reported.
 *
 * 2. HARNESS ROWS ARE NOT COVERAGE. A suite's block guard
 *    (`docs/TESTING.md` §5c) prints a row about ITSELF when the run stops
 *    early, and that row would otherwise fill the slot of the assertion that
 *    never ran: `transport` guarded reports `63 passed, 1 failed`, which totals
 *    64 and, on a count, looks complete. Measured on the watched-red run. Any
 *    row whose name starts with `HARNESS_PREFIX` is excluded, which is exactly
 *    what stops a guard from hiding what it was installed to reveal.
 *
 * 3. A RUN THAT DID NOT FINISH DOES NOT BECOME THE BASELINE. The extension's
 *    writes the baseline unconditionally, so a truncated run silently becomes
 *    the new normal and the drift it should have reported for ever is reported
 *    ONCE and then goes quiet — the second run compares truncated against
 *    truncated and agrees. An instrument that stops reporting a live regression
 *    after one run is the failure this whole phase has been about. The baseline
 *    is written only when the suite printed the summary line `docs/TESTING.md`
 *    §3 rule 6 requires, so the comparison keeps firing until it is fixed.
 *
 * NOT COPIED, and named so an unlisted omission is not mistaken for an
 * oversight: the extension's `FLAKY` carve-out and its model-seed preflight,
 * both of which `docs/TESTING.md` §2 records as deliberately absent here and
 * neither of which this brings in by the back door.
 *
 * WHAT IT STILL CANNOT SEE, kept from the extension's own honesty block because
 * it is true of any denominator: a VACUOUS assertion — one that ran and checked
 * nothing — moves neither the count nor the names. That is caught by reading the
 * assertion and by the rule that an assertion must FAIL when it cannot look, not
 * by this. And an ALTERNATING NAME — one check that spells itself two ways by
 * branch — reports gone-and-replaced for ever, on correct code. §3 rule 4 is the
 * fix for that, on the assertion side: one check, one name, branch in the detail.
 */

/**
 * A row a suite prints ABOUT ITSELF rather than about the product. One prefix,
 * defined once, so a block guard's red cannot be counted as coverage.
 */
export const HARNESS_PREFIX = 'HARNESS: ';

/** What this run actually checked about the product. */
export function coveredNames(out) {
  return assertionLines(out).map((a) => a.name).filter((n) => !n.startsWith(HARNESS_PREFIX));
}

/**
 * Did the suite run to its end? The summary line is the suite's own statement
 * that it did (§3 rule 6), and `countOf` already decides what counts as one — a
 * second copy of that formula is a copy that drifts.
 */
export const completedRun = (out) => countOf(out) !== null;

/**
 * WHAT THE VERDICT LINE HAS TO CARRY, so a coverage warning cannot be lost in a
 * wall of green.
 *
 * The drift and BASELINE NOT UPDATED sections print above the verdict, and the
 * verdict is the line a human reads and CI greps. A warning nobody reads is the
 * same failure as an instrument that never fires, one step slower — so the
 * verdict line names both, every time, on GREEN and on RED alike.
 *
 * `BASELINE NOT UPDATED` matters most and is the reason this is not optional: it
 * is the difference between "this instrument is working" and "this instrument
 * has quietly stopped comparing", and a reader who sees only the last line would
 * otherwise never learn which.
 *
 * Returns '' when there is nothing to say, so a clean run's verdict is unchanged.
 */
export function coverageCaveat(driftedIds, staleIds) {
  const parts = [];
  if (driftedIds.length) parts.push(`COVERAGE DRIFT on ${driftedIds.join(', ')}`);
  if (staleIds.length) parts.push(`BASELINE NOT UPDATED for ${staleIds.join(', ')}`);
  if (!parts.length) return '';
  return `${parts.join(' · ')} — see above. `
    + (staleIds.length
      ? 'The coverage baseline still holds the last COMPLETE run, so this verdict is about the assertions that RAN.'
      : 'This run did not check the same things as the last one.');
}

/**
 * The diff, pure so `tools/suites/void-canary.mjs` can drive it over transcripts
 * instead of over a previous run of the gate. Multiplicity is preserved: a
 * name that ran three times and now runs twice is `gone`, because a block that
 * lost an iteration is the failure this exists for.
 */
export function coverageDrift(names, prev) {
  if (!prev || !Array.isArray(prev.names)) return null;
  const tally = (a) => a.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});
  const now = tally(names), was = tally(prev.names);
  const gone = Object.keys(was).filter((k) => (now[k] || 0) < was[k]).sort();
  const added = Object.keys(now).filter((k) => (was[k] || 0) < now[k]).sort();
  if (!gone.length && !added.length) return null;
  return { from: prev.names.length, to: names.length, gone, added, when: prev.when };
}

/** The one-line detail beside the verdict. A shape it does not know reads `exit N`, which is a shrug. */
export function summarise(res) {
  const t = strip(res.out);
  const m = t.match(new RegExp(SUM + String.raw`(\d+)\s+passed,\s+(\d+)\s+failed`, 'm'));
  if (m) return `${m[1]} passed, ${m[2]} failed`;
  const slash = t.match(new RegExp(SUM + String.raw`(\d+)\s*/\s*(\d+)\s+passed`, 'm'));
  if (slash) return `${slash[1]}/${slash[2]} passed`;
  const counted = t.match(new RegExp(SUM + String.raw`(\d+)\s+(?:[\w-]+\s+)?checks?\s+passed`, 'm'));
  if (counted) return `${counted[1]} checks passed`;
  if (/all checks passed/.test(t)) return `${(t.match(/^\s{0,3}ok\s/gm) || []).length} checks passed`;
  const thrown = t.split('\n').find((l) => /^(\w*Error|Uncaught|node:internal)/.test(l.trim()));
  if (thrown) return thrown.trim().slice(0, 140);
  return `exit ${res.code}`;
}

/**
 * PASS / FAIL / VOID / SKIP, in that order of suspicion.
 *
 * The order matters. SKIP is checked before VOID because a suite that declines
 * to run prints no assertions BY DESIGN and must not be reported as a broken
 * one. `expect` is checked after the VOID rule and before PASS, so a step that
 * printed assertions but not its own verdict line is a FAIL that names what was
 * missing rather than a green.
 */
export function classify(res) {
  const t = strip(res.out);
  if (res.code === 0 && /\bSKIPPED\b/.test(t)) {
    const why = (t.match(/SKIPPED\s*[—-]\s*([^\n]*)/) || [, ''])[1];
    return { verdict: 'SKIP', detail: why.trim() || '(no reason given)', hard: [] };
  }
  if (res.code === 0 && !ASSERTED.test(t)) {
    return {
      verdict: 'VOID',
      detail: 'exited 0 but asserted nothing — silence is not a pass',
      hard: [`${res.id}: no assertions produced. ${lastLines(res.out, 2) || '(no output at all)'}`],
    };
  }
  if (res.code === 0 && res.expect) {
    const m = t.match(res.expect.re);
    if (!m) {
      return { verdict: 'FAIL', detail: `exit 0, but ${res.expect.why} never appeared`,
               hard: [`${res.id}: expected ${res.expect.re} — ${res.expect.why}`] };
    }
    const bad = res.expect.pin ? res.expect.pin(m, t) : null;
    if (bad) return { verdict: 'FAIL', detail: bad, hard: [`${res.id}: ${bad}`] };
  }
  if (res.code === 0) {
    /**
     * ---------------------------------------------------------------------
     * THE ABSENT-ASSERTION FAILURE, one level up from the vendored runner.
     * ---------------------------------------------------------------------
     * `vendor/.pin` pins the vendored plan's 544 both ways and
     * `vendor/.conformance.json` pins 612/593/19 both ways, for a reason
     * `vendor-unit`'s own comment states: *"the count of SUITES cannot see a
     * suite that ran and asserted less than it used to."* This repository's own
     * twelve suites had no such pin, and an audit showed what that costs — a
     * `deck-seam` whose `ok()` silently dropped a class of assertion names
     * printed `32 passed, 0 failed` instead of 49 and the runner called it PASS.
     *
     * So a step may declare `assertions: N` and it is checked EXACTLY, not as a
     * floor. `docs/TESTING.md`'s suite table carries the same number in its own
     * column and `tools/suites/void-canary.mjs` holds the two lists together, so
     * the pin cannot be moved quietly in one place.
     *
     * IT IS EXACT ON PURPOSE. A range on a deterministic number is a gate that
     * has stopped measuring; every suite here emits its assertions from literal
     * lists or from `STEPS` itself, so the count is a property of the code. A
     * suite whose count really is machine-dependent must SKIP rather than assert
     * fewer things — that is `docs/TESTING.md` §3 rule 8 — and it declares no
     * `assertions` here, with the reason written beside it.
     */
    if (typeof res.assertions === 'number') {
      const got = countOf(t);
      if (got === null) {
        return { verdict: 'FAIL', detail: `exit 0 with no readable "N passed, M failed" line to count`,
                 hard: [`${res.id}: expected ${res.assertions} assertions and could not find a summary line at all`] };
      }
      if (got !== res.assertions) {
        const how = got < res.assertions ? 'FEWER' : 'more';
        return {
          verdict: 'FAIL',
          detail: `${got} assertions, and docs/TESTING.md pins ${res.assertions}`,
          hard: [`${res.id}: ran ${got} assertions, ${how} than the ${res.assertions} pinned in STEPS and in `
            + "docs/TESTING.md's suite table. A suite that asserts less than it used to is green from the "
            + 'outside; that is what this pin exists to see. Move BOTH numbers, in the commit that changes the suite.'],
        };
      }
    }
    return { verdict: 'PASS', detail: summarise(res), hard: [] };
  }

  /**
   * ------------------------------------------------------------------------
   * THE ONE BRANCH THAT CONSULTS `expect` ON A NON-ZERO EXIT. IT IS OPT-IN PER
   * STEP, BY DECLARING THE EXACT CODE, AND EXACTLY ONE STEP DECLARES IT.
   * ------------------------------------------------------------------------
   * `vendor-unit` runs a runner we do not own over a `test.js` that is BOTH the
   * unit's largest suite and a conformance suite over the two hole modules this
   * Host supplies. With our holes in place that file CRASHES — an upstream
   * design gap with a ticket (`stem-splitter-live#30`), unfixable from this side
   * and unpatchable here (rule V1, and `vendor-intact` runs first) — so the
   * vendored runner exits 1 on every run, for ever, and that step could only
   * ever be red. AGENTS.md: a red is either investigated or the assertion is
   * corrected, and a red nobody can ever clear is the one nobody investigates.
   *
   * So that step pins the WHOLE report instead (`vendor/.pin`'s `hostSuite`),
   * and the pin is a SET EQUALITY rather than a tolerance: a GREEN `unit` fails
   * it too. That is what keeps this from being an ignore-list.
   *
   * WHAT IS NOT RELAXED, and must never be:
   *   · THE VOID RULE. A step that exits with its pinned code having asserted
   *     nothing is still VOID. Silence is not a pass at any exit code.
   *   · SKIP, and the `code === 0` paths above, are untouched.
   *   · A step without `expect.code` cannot reach this branch at all, and a
   *     step WITH it cannot reach it on any other code.
   */
  if (res.expect && res.expect.code === res.code) {
    if (!ASSERTED.test(t)) {
      return {
        verdict: 'VOID',
        detail: `exited ${res.code} as pinned, but asserted nothing — silence is not a pass at any exit code`,
        hard: [`${res.id}: no assertions produced. ${lastLines(res.out, 2) || '(no output at all)'}`],
      };
    }
    const m = t.match(res.expect.re);
    if (!m) {
      return { verdict: 'FAIL', detail: `exit ${res.code} as pinned, but ${res.expect.why} never appeared`,
               hard: [`${res.id}: expected ${res.expect.re} — ${res.expect.why}`] };
    }
    const bad = res.expect.pin ? res.expect.pin(m, t) : null;
    if (bad) return { verdict: 'FAIL', detail: bad, hard: [`${res.id}: ${bad}`] };
    return { verdict: 'PASS', detail: res.expect.detail ? res.expect.detail(m, t) : summarise(res), hard: [] };
  }

  const fails = assertionLines(res.out).filter((a) => !a.pass).map((a) => `${res.id}: ${a.line}`);
  if (!fails.length) fails.push(`${res.id}: exited ${res.code} with no FAIL line — ${lastLines(res.out, 3)}`);
  return { verdict: 'FAIL', detail: summarise(res), hard: fails };
}

// --------------------------------------------------------------------- verdict
/**
 * THE VERDICT IS A PURE FUNCTION so `--self-check` can assert the honesty rule
 * rather than a human re-reading the print statements.
 *
 * RED wins over everything. Otherwise the run is green only if the plan was
 * every step this repository has: any step that was filtered out, declined,
 * declared-and-not-built, or manual makes it `GREEN (partial)` and is NAMED.
 */
/**
 * THE EXIT CODE FOR A VERDICT, as a pure function so `--self-check` can assert it.
 *
 * `GREEN (partial)` USED TO EXIT 0, IDENTICALLY TO A FULL GREEN, and an audit
 * showed what that buys: with `xvfb-run` off PATH,
 * `node tools/verify.mjs --only shell` printed `shell SKIPPED — xvfb-run is not
 * on PATH`, `GREEN (partial — 1 of 13 steps ran)`, and exit 0. The WORDS were
 * honest and the STATUS was not, and a status is what CI reads.
 * `docs/TESTING.md` already stated the principle for the vendored runner —
 * *"Exit 0 alone is not enough"* — and this is the host runner acting on it.
 *
 * ---------------------------------------------------------------------------
 * `--strict` IS ABOUT SKIPS AND TODOs, NOT ABOUT FILTERING, AND THE DIFFERENCE
 * IS THE WHOLE DESIGN
 * ---------------------------------------------------------------------------
 * `--quick` and `--only` are a HUMAN saying which question they are asking, and
 * a runner that called that a failure would be a runner people stop passing
 * `--strict` to. A SKIP is the MACHINE declining to answer a question that WAS
 * asked — no display, no PipeWire, no weights, a busy sink queue — and a `todo`
 * is a suite that is declared and does not exist. Those two are the ones that
 * read as success while measuring nothing, so those two are what `--strict`
 * refuses.
 *
 * So `node tools/verify.mjs --quick --strict` means *"every step I asked for
 * really ran"*, which is a sentence CI can use, and `--only shell --strict`
 * means it for one step.
 *
 * 2 RATHER THAN 1, so a machine can tell "nothing measured" from "something
 * failed". They are different problems and they get different fixes.
 *
 * @param {{colour: string, skipped: object[], todo: object[]}} v  a `verdict()`
 * @param {boolean} strict
 * @returns {0|1|2}
 */
export function exitFor(v, strict = false) {
  if (v.colour === 'RED') return 1;
  if (strict && (v.skipped.length > 0 || v.todo.length > 0)) return 2;
  return 0;
}

export function verdict(results, steps, plan) {
  const hard = results.flatMap((r) => (r.hard || []).map((h) => ({ step: r.id, line: h })));
  /**
   * THE TWO KINDS OF ABSENCE ARE SEPARATED EVEN ON A RED, because `exitFor`
   * reads them and a caller must never get `undefined.length`. On a red the
   * colour decides the code anyway; the lists are still true.
   */
  const skipped = results.filter((r) => r.verdict === 'SKIP').map((r) => ({ id: r.id, why: r.detail }));
  const todo = steps.filter((s) => s.todo).map((s) => ({ id: s.id, why: s.todo }));
  if (hard.length || results.some((r) => r.verdict === 'FAIL' || r.verdict === 'VOID')) {
    return { colour: 'RED', hard, notRun: [], skipped, todo };
  }
  const ran = new Set(plan.map((s) => s.id));
  const notRun = [];
  for (const s of steps) {
    if (s.todo) notRun.push({ id: s.id, why: `NOT BUILT — ${s.todo}` });
    else if (s.manual && !ran.has(s.id)) notRun.push({ id: s.id, why: 'manual only — never on a default plan' });
    else if (!ran.has(s.id)) notRun.push({ id: s.id, why: 'filtered out of this plan' });
  }
  for (const r of results) {
    if (r.verdict === 'SKIP') notRun.push({ id: r.id, why: `SKIPPED — ${r.detail}` });
  }
  return { colour: notRun.length ? 'GREEN-PARTIAL' : 'GREEN', hard, notRun, skipped, todo };
}

// ------------------------------------------------------------------ self-check
/**
 * The classifier and the verdict are the only non-trivial logic in this file,
 * and getting either wrong in the PERMISSIVE direction hides a real regression.
 * Spawns nothing, ~0 s.
 *
 * Where a transcript below is a shape some other file prints, it is the ACTUAL
 * text that file printed, captured from a run — never a guess at it. The
 * extension's runner learned that rule the expensive way: three suites it had
 * added came out VOID on their first run because their real summary lines were
 * not the ones the regex had been reasoned about.
 */
function selfCheck() {
  let bad = 0;
  const check = (name, cond, got) => {
    console.log(`  ${cond ? `${C.g}PASS${C.x}` : `${C.r}FAIL${C.x}`} ${name}${got ? `  ${C.d}${got}${C.x}` : ''}`);
    if (!cond) bad++;
  };
  const cl = (out, code = 0, extra = {}) => classify({ id: 'x', code, out, ...extra });
  console.log(`\n${C.b}verify --self-check${C.x} ${C.d}the classifier and the verdict, against synthetic transcripts${C.x}\n`);

  // ---- the VOID rule ------------------------------------------------------
  check('a step that exits 0 with NO output is VOID, not PASS', cl('').verdict === 'VOID', cl('').verdict);
  check('...and chatter without a single assertion does not rescue it',
    cl('launching electron\nready\n').verdict === 'VOID');
  check('..."0 passed, 0 failed" is VOID — a count of nothing is still nothing',
    cl('\nsmoke: 0 passed, 0 failed\n').verdict === 'VOID');
  check('..."0 checks passed" too', cl('smoke: 0 checks passed\n').verdict === 'VOID');
  check('...and a count buried MID-LINE does not vouch for a run — the shapes are line-anchored',
    cl('the previous run had 12 checks passed, this one did not run\n').verdict === 'VOID');
  check('a real summary in THIS repo\'s convention is a PASS',
    cl('ok  a thing  detail\n\nsmoke: 7 passed, 0 failed\n').verdict === 'PASS',
    cl('ok  a thing  detail\n\nsmoke: 7 passed, 0 failed\n').detail);

  // ---- the vendored unit's shapes, which stream through this classifier ----
  // Verbatim from `node tools/verify.mjs --unit --no-reap` in stem-splitter-live
  // at v0.2.0 — the transcript this step will actually be handed.
  check('the vendored test.js shape is a PASS here', cl('\n\x1b[32m612 passed, 0 failed\x1b[0m\n').verdict === 'PASS');
  check('...and the suite-name-prefixed one', cl('seam-check: 17 passed, 0 failed\n').verdict === 'PASS');
  check('...and "all N <word> checks passed"', cl('all 37 chroma checks passed\n').verdict === 'PASS');
  check('...and a bare "all checks passed" counts its ok lines',
    cl('ok  one\nok  two\n\nall checks passed\n').detail === '2 checks passed',
    cl('ok  one\nok  two\n\nall checks passed\n').detail);

  // ---- SKIP is not a pass, and is checked BEFORE the VOID rule -------------
  const sk = cl('\n\x1b[33mSKIPPED\x1b[0m — PipeWire is not running on this box\n');
  check('a suite that prints SKIPPED and exits 0 is SKIP, not PASS and not VOID',
    sk.verdict === 'SKIP' && /PipeWire/.test(sk.detail), `${sk.verdict} · ${sk.detail}`);

  // ---- failures name the assertion ----------------------------------------
  const f = cl('ok    the app boots\nFAIL  the view is muted  isAudioMuted()=false\n\nsmoke: 1 passed, 1 failed\n', 1);
  check('a red step reports FAIL and names the failing assertion, not just the exit code',
    f.verdict === 'FAIL' && f.hard.length === 1 && /the view is muted/.test(f.hard[0]), f.hard[0]);
  const noline = cl('ok  a thing\n', 1);
  check('...and a non-zero exit with no FAIL line is still a hard failure',
    noline.verdict === 'FAIL' && noline.hard.length === 1, noline.hard[0]);
  const threw = cl('ok  a thing\nTypeError: session.fromPartition is not a function\n    at file:///x.mjs:1\n', 1);
  check('...and a bare node throw names the error rather than the exit code',
    /TypeError: session\.fromPartition/.test(threw.detail), threw.detail);

  // ---- `expect`: the vendored gate, POST-SWAP, in BOTH directions --------
  /**
   * `vendor-unit` is the ONE step whose expected outcome is a non-zero exit: its
   * `test.js` crashes with this Host's hole modules in place, which is an
   * upstream design gap with a ticket (`stem-splitter-live#30`) and unpatchable
   * here (rule V1). `vendor/.pin`'s `hostSuite` block is the prose; everything
   * below drives `classify()` over transcripts of exactly that shape.
   *
   * The last five are the ones that matter, because they are the ways a pinned
   * red turns into an ignore-list: a GREEN `unit` must FAIL, a crash that became
   * a clean red must FAIL, a crash that MOVED must FAIL, a pin with no
   * `hostSuite` block must FAIL, and silence must still be VOID.
   *
   * The rows are the shape `vendorRows()` parses out of a real `--unit`
   * transcript; the numbers are the ones a real run prints, and 544 is their sum.
   */
  const vstep = STEPS.find((s) => s.id === 'vendor-unit');
  const ROW = (v, id, secs, detail) => `  \x1b[32m${v}\x1b[0m  ${id.padEnd(12)} ${secs}s    ${detail}`;
  const ELEVEN = [
    ROW('PASS', 'seam', '0.1', '17 passed, 0 failed'),
    ROW('PASS', 'ui', '0.0', '107 checks passed'),
    ROW('PASS', 'qa-edge', '0.0', '13 passed, 0 failed'),
    ROW('PASS', 'passthrough', '0.1', '16 passed, 0 failed'),
    ROW('PASS', 'pitch', '3.6', '23 passed, 0 failed'),
    ROW('PASS', 'pitchbank', '40.0', '28 checks passed'),
    ROW('PASS', 'chroma', '13.6', '37 checks passed'),
    ROW('PASS', 'keytap', '10.2', '23 checks passed'),
    ROW('PASS', 'bpmtap', '6.8', '46 passed, 0 failed'),
    ROW('PASS', 'speed-pitch', '5.1', '10 passed, 0 failed'),
    ROW('PASS', 'embed-state', '0.1', '224 checks passed'),
  ].join('\n');
  const CRASH = ROW('FAIL', 'unit', '14.4', 'CRASHED after start — TypeError: listeners[0] is not a function / at test.js:5833');
  const BANNER = '\n\x1b[31m\x1b[1mRED\x1b[0m — 17 failing assertions. Do not commit as green.\n';
  const post = (rows) => `${rows}\n${BANNER}`;

  check("the vendored gate's post-swap RED banner is recognised by the `expect` regex",
    vstep.expect.re.test(strip(BANNER)), strip(BANNER).trim());
  check('...and ONE step declares `expect.code`, which is the only key that opens that branch',
    vstep.expect.code === 1 && STEPS.filter((s) => s.expect && s.expect.code !== undefined).length === 1,
    `${STEPS.filter((s) => s.expect && s.expect.code !== undefined).map((s) => s.id).join(',') || '(none)'}`);

  const ok1 = cl(post(`${CRASH}\n${ELEVEN}`), 1, { expect: vstep.expect });
  check('eleven suites passing and `unit` crashing exactly as pinned is a PASS, at exit 1',
    ok1.verdict === 'PASS', `${ok1.verdict} · ${ok1.detail}`);
  check('...and the crash is still on the summary line rather than some inner suite\'s green count',
    /CRASHED at test\.js:5833 as pinned/.test(ok1.detail), ok1.detail);

  // THE SECOND DIRECTION, and it is the whole reason this is not an ignore-list.
  // TWO ASSERTIONS, because a green `unit` arrives at `classify()` by TWO doors
  // and only one of them reaches the pin: a real one exits 0 with the whole
  // vendored plan green, which is the exit-0 branch and `why`'s job.
  const V = "\n\x1b[32m\x1b[1mGREEN\x1b[0m \x1b[33m(partial — the vendored unit's suites only; 12 of 23 steps)\x1b[0m\n";
  const realGreen = cl(`${ROW('PASS', 'unit', '10.9', '612 passed, 0 failed')}\n${ELEVEN}\n${V}`, 0, { expect: vstep.expect });
  check('a vendored plan that goes ENTIRELY GREEN and exits 0 is a FAIL, and the red says what a green `unit` means',
    realGreen.verdict === 'FAIL' && /`unit` PASSED/.test(realGreen.detail)
    && /not this Host's hole modules any more/.test(realGreen.detail), realGreen.detail);

  const unitGreen = cl(post(`${ROW('PASS', 'unit', '14.4', '612 passed, 0 failed')}\n${ELEVEN}`), 1, { expect: vstep.expect });
  check('...and a green `unit` beside the pinned exit code is a FAIL too, naming the two files by path',
    unitGreen.verdict === 'FAIL' && /EVERY suite passed/.test(unitGreen.detail)
    && /extension\/ui\/host\.js/.test(unitGreen.detail), unitGreen.detail);

  // A CRASH MUST NOT BE LAUNDERED INTO AN EXPECTED FAILURE.
  const clean = cl(post(`${ROW('FAIL', 'unit', '14.4', '593 passed, 19 failed')}\n${ELEVEN}`), 1, { expect: vstep.expect });
  check('...and a `unit` that FAILED WITHOUT CRASHING is a FAIL too — asserting and failing is not dying',
    clean.verdict === 'FAIL' && /WITHOUT crashing/.test(clean.detail), clean.detail);

  const moved = cl(post(`${ROW('FAIL', 'unit', '14.4', 'CRASHED after start — TypeError: x is not iterable / at test.js:99')}\n${ELEVEN}`), 1, { expect: vstep.expect });
  check('...and a crash that MOVED is a FAIL — two earlier prose descriptions of this failure were stale when read',
    moved.verdict === 'FAIL' && /crashed with something else/.test(moved.detail), moved.detail);

  const short = cl(post(`${CRASH}\n${ELEVEN.split('\n').slice(0, 8).join('\n')}`), 1, { expect: vstep.expect });
  check('...and FEWER suites than vendor/.pin promises is a FAIL — a smaller plan prints the same banner',
    short.verdict === 'FAIL' && /vendor\/\.pin pins 11/.test(short.detail), short.detail);

  const thin = post(`${CRASH}\n${ELEVEN.replace('224 checks passed', '4 checks passed')}`);
  check('...and eleven PASSING suites that assert FEWER than the pinned total is a FAIL',
    cl(thin, 1, { expect: vstep.expect }).verdict === 'FAIL', cl(thin, 1, { expect: vstep.expect }).detail);

  // THE RE-VENDOR HOLE. `tools/vendor-unit.sh` REWRITES vendor/.pin, carrying
  // only the keys it is told to carry. A pin that came back without `hostSuite`
  // must not leave this step passing on no checks at all.
  const noHost = vstep.expect.pin([, '17'], post(`${CRASH}\n${ELEVEN}`), { tag: 'v0.2.0', steps: 12, assertions: 544 });
  check('...and a vendor/.pin with NO `hostSuite` block fails the step rather than un-checking it',
    typeof noHost === 'string' && /no `hostSuite` block/.test(noHost), String(noHost));

  // THE VOID RULE IS NOT RELAXED BY THE NEW BRANCH.
  const silent = cl(BANNER, 1, { expect: vstep.expect });
  check('...and a transcript with no assertion count at all is VOID at the pinned exit code, not PASS',
    silent.verdict === 'VOID', `${silent.verdict} · ${silent.detail}`);
  const wrongCode = cl(post(`${CRASH}\n${ELEVEN}`), 2, { expect: vstep.expect });
  check('...and a DIFFERENT non-zero exit does not reach that branch at all',
    wrongCode.verdict === 'FAIL' && !/as pinned/.test(wrongCode.detail), `${wrongCode.verdict} · ${wrongCode.detail}`);

  // ---- the vendored summary TABLE, pinned against a real transcript -------
  // Every line below is verbatim from `node tools/verify.mjs --unit --no-reap`
  // run in stem-splitter-live at v0.2.0 on 2026-08-26 (tree byte-identical to
  // the tag). The first two are summary rows; the third is an ASSERTION line
  // from inside test.js, and it is here because it is the thing the row parser
  // must NOT count.
  const REAL = [
    '  \x1b[32mPASS\x1b[0m  unit         11.0s    612 passed, 0 failed',
    '         \x1b[2mnode test.js — DSP, WAV, rings, mixer\x1b[0m',
    '  \x1b[32mPASS\x1b[0m  ui           0.0s     107 checks passed',
    '  \x1b[32mPASS\x1b[0m RIFF/WAVE/fmt  tags',
  ].join('\n');
  const rows = vendorRows(REAL);
  check('the vendored runner\'s summary rows are recovered, with their counts',
    rows.length === 2 && rows[0].count === 612 && rows[1].count === 107,
    rows.map((r) => `${r.id}=${r.count}`).join(' '));
  check('...and an ASSERTION line from inside a vendored suite is not counted as a row',
    !rows.some((r) => /RIFF/.test(r.id)), `${rows.length} rows`);
  check('...and a red vendored suite is visible to the pin as a non-PASS row',
    vendorRows('  \x1b[31mFAIL\x1b[0m  unit         11.0s    610 passed, 2 failed')[0].verdict === 'FAIL');

  // ---- the absent-vendor rule expires on the pin --------------------------
  const noTree = { id: 'vendor-unit', cwd: 'nowhere-at-all' };
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'vp-'));
  check('with nothing vendored and no pin, vendor-unit is a SKIP',
    vendorPrecheck(noTree, tmp).verdict === 'SKIP', vendorPrecheck(noTree, tmp).detail);
  fs.mkdirSync(path.join(tmp, 'vendor'));
  fs.writeFileSync(path.join(tmp, 'vendor', '.pin'), JSON.stringify({ tag: 'v0.2.0', steps: 12 }));
  check('...and the moment vendor/.pin claims a tag, a missing tree is a hard FAIL instead',
    vendorPrecheck(noTree, tmp).verdict === 'FAIL', vendorPrecheck(noTree, tmp).detail);
  fs.rmSync(tmp, { recursive: true, force: true });

  // ---- the honesty rule ---------------------------------------------------
  const built = [{ id: 'a' }, { id: 'b' }];
  const green = verdict([{ id: 'a', verdict: 'PASS', hard: [] }, { id: 'b', verdict: 'PASS', hard: [] }], built, built);
  check('a full plan with every step green is an unqualified GREEN', green.colour === 'GREEN', green.colour);
  const withTodo = [...built, { id: 'c', todo: 'not built' }];
  const part = verdict([{ id: 'a', verdict: 'PASS', hard: [] }, { id: 'b', verdict: 'PASS', hard: [] }], withTodo, built);
  check('a declared-but-not-built step makes an unqualified GREEN impossible, and is NAMED',
    part.colour === 'GREEN-PARTIAL' && part.notRun.some((n) => n.id === 'c'), JSON.stringify(part.notRun));
  const withSkip = verdict([{ id: 'a', verdict: 'PASS', hard: [] }, { id: 'b', verdict: 'SKIP', detail: 'no PipeWire', hard: [] }], built, built);
  check('...and so does a SKIP — a step that declined to run is not a step that passed',
    withSkip.colour === 'GREEN-PARTIAL' && withSkip.notRun.some((n) => n.id === 'b'), JSON.stringify(withSkip.notRun));
  const withManual = verdict([{ id: 'a', verdict: 'PASS', hard: [] }], [...built.slice(0, 1), { id: 'y', manual: true }], built.slice(0, 1));
  check('...and a manual step that was not asked for is named every run, never silently absent',
    withManual.colour === 'GREEN-PARTIAL' && withManual.notRun.some((n) => n.id === 'y'));
  /**
   * THE EXIT CODE, over the same four verdicts. `--strict` refuses a SKIP and a
   * `todo` and is deliberately SILENT about filtering — asserted here rather
   * than described, because getting it the other way round makes `--strict`
   * something people stop passing.
   */
  check('--strict exits 2 over a SKIP: a step the machine declined is a question nobody answered  [entry point: exitFor()]',
    exitFor(withSkip, true) === 2 && exitFor(withSkip, false) === 0, `${exitFor(withSkip, true)} / ${exitFor(withSkip, false)}`);
  check('...and 2 over a step that is declared and NOT BUILT', exitFor(part, true) === 2, String(exitFor(part, true)));
  check('...and 0 over a plan the caller FILTERED — --quick and --only are a question, not a failure',
    exitFor(withManual, true) === 0, String(exitFor(withManual, true)));
  check('...and 1 for a RED whether or not --strict is on, because those are different problems',
    exitFor(verdict([{ id: 'a', verdict: 'VOID', hard: ['x'] }], built, built), true) === 1
    && exitFor(verdict([{ id: 'a', verdict: 'VOID', hard: ['x'] }], built, built), false) === 1);
  check('...and 0 for a full green under --strict', exitFor(green, true) === 0);

  const filtered = verdict([{ id: 'a', verdict: 'PASS', hard: [] }], built, [built[0]]);
  check('...and a step --quick filtered out is named too, not silently absent from the count',
    filtered.colour === 'GREEN-PARTIAL' && filtered.notRun.some((x) => x.id === 'b' && /filtered/.test(x.why)),
    JSON.stringify(filtered.notRun));
  const red = verdict([{ id: 'a', verdict: 'VOID', hard: ['a: no assertions produced'] }], built, built);
  check('one VOID step turns the whole run RED', red.colour === 'RED' && red.hard.length === 1, red.hard[0].line);

  // ---- the table itself ---------------------------------------------------
  check('every step id is unique', new Set(STEPS.map((s) => s.id)).size === STEPS.length);
  check('every step declares a command and a title',
    STEPS.every((s) => Array.isArray(s.cmd) && s.cmd.length && typeof s.title === 'string' && s.title));
  check('every `todo` step carries a reason, so an unbuilt suite cannot hide behind a bare flag',
    STEPS.every((s) => !('todo' in s) || (typeof s.todo === 'string' && s.todo.length > 8)));
  check('`sink` implies `window` — the capture gate cannot measure a headless app',
    STEPS.every((s) => !s.sink || s.window));

  /**
   * EVERY SUITE THIS TABLE NAMES IS TRACKED BY GIT — "works in my tree" is a
   * whole class of green that a fresh clone turns red, and this is the cheap
   * end of it.
   *
   * IT REALLY HAPPENED HERE. The commit that added the `deck-host` step landed
   * with its suite file still untracked: every gate on the machine that wrote it
   * was green (`void-canary` checks the file EXISTS, and it did), and a clone
   * would have failed at the same check. `git ls-files --error-unmatch` is the
   * only question that tells those two apart.
   *
   * NOT AN EXCUSE WHEN GIT IS ABSENT: a tree with no repository at all cannot
   * answer, and answering "fine" would be the green-on-nothing shape this runner
   * is written against — so the check reports what it could not do and the
   * assertion fails.
   */
  // A `todo` step's file is DECLARED absent — `void-canary` asserts it really
  // is — so it is exempt here. Everything else this table names must be in the
  // index, or the step is a command a clone cannot run.
  const stepFiles = STEPS.filter((st) => !st.cwd && !st.todo).map((st) => st.cmd[1])
    .filter((p) => typeof p === 'string' && p.includes('/'));
  const tracked = (rel) => {
    const r = spawnSync('git', ['ls-files', '--error-unmatch', rel], { cwd: ROOT, encoding: 'utf8' });
    return r.status === 0;
  };
  const gitHere = spawnSync('git', ['rev-parse', '--git-dir'], { cwd: ROOT, encoding: 'utf8' }).status === 0;
  const untracked = gitHere ? stepFiles.filter((p) => !tracked(p)) : stepFiles;
  check('every suite the steps table names is TRACKED BY GIT, not just present on this disk',
    gitHere && untracked.length === 0,
    gitHere
      ? (untracked.length ? `UNTRACKED: ${untracked.join(', ')} — green here, red in a fresh clone`
        : `${stepFiles.length} step files, all tracked`)
      : 'there is no git repository here, so this cannot be answered — which is not the same as passing');

  console.log(`\n${bad ? `${C.r}${bad} FAILED${C.x}` : `${C.g}self-check green${C.x}`}\n`);
  return bad;
}

// ---------------------------------------------------------------------- main
async function main(argv) {
  const flag = (k) => argv.includes('--' + k);
  const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const QUICK = flag('quick'), ONLY = arg('only', null), MANUAL = flag('manual'), STRICT = flag('strict');

  if (flag('self-check')) return selfCheck() ? 1 : 0;
  if (flag('list')) {
    for (const s of STEPS) {
      const tags = [s.window && 'window', s.sink && 'sink', s.manual && 'manual', s.todo && 'TODO',
        typeof s.assertions === 'number' && `${s.assertions} assertions`].filter(Boolean);
      console.log(`  ${s.id.padEnd(14)}${tags.length ? `[${tags.join(' ')}] ` : ''}${s.title}`);
    }
    return 0;
  }

  let plan;
  if (ONLY) {
    const s = STEPS.find((x) => x.id === ONLY);
    if (!s) { console.error(`no step matches --only ${ONLY}. Known: ${STEPS.map((x) => x.id).join(', ')}`); return 2; }
    // A `todo` step under --only is a request for something that does not exist.
    // Running nothing and exiting 0 is the VOID case at the level of the PLAN.
    if (s.todo) { console.error(`step '${s.id}' is declared and NOT BUILT — ${s.todo}`); return 2; }
    plan = [s];
  } else if (MANUAL) {
    plan = STEPS.filter((s) => s.manual && !s.todo);
  } else {
    plan = STEPS.filter((s) => !s.todo && !s.manual && !(QUICK && (s.window || s.sink)));
  }
  if (!plan.length) {
    console.error(MANUAL
      ? 'no manual step is built yet — nothing to run.'
      : 'the plan is empty: every step this runner knows is either manual or not built yet.');
    return 2;
  }

  console.log(`${C.b}verify${C.x} ${C.d}${new Date().toISOString()} · ${plan.map((s) => s.id).join(' -> ')}${C.x}`);
  const results = [];
  const baseline = readCoverage();
  for (const step of plan) {
    const pre = step.precheck ? step.precheck(step) : null;
    if (pre) {
      console.log(`\n${C.b}=== ${step.id} ===${C.x} ${C.d}${pre.verdict.toLowerCase()} before launching: ${pre.detail}${C.x}`);
      results.push({ ...step, ms: 0, hard: pre.hard || [], verdict: pre.verdict, detail: pre.detail });
      continue;
    }
    const res = await run(step);
    /**
     * ON EVERY RUN, WHATEVER THE EXIT CODE. A red run is exactly when knowing
     * which assertions stopped running is worth most — a suite that died
     * halfway is the case this instrument was asked for — so the comparison is
     * NOT behind `code === 0` the way the `assertions` pin is. The RECORD is
     * conditional instead: see `completedRun`.
     */
    const names = coveredNames(res.out);
    const drift = coverageDrift(names, baseline[step.id] || null);
    const finished = completedRun(res.out);
    if (names.length && finished) baseline[step.id] = { names, when: new Date().toISOString() };
    results.push({ ...res, ...classify(res), drift, truncated: !finished && names.length > 0 });
  }
  writeCoverage(baseline);

  const v = verdict(results, STEPS, plan);
  const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length));
  const mark = { PASS: `${C.g}PASS${C.x}`, FAIL: `${C.r}FAIL${C.x}`, SKIP: `${C.y}SKIP${C.x}`, VOID: `${C.r}VOID${C.x}` };
  console.log(`\n${C.b}${'='.repeat(72)}\nverify — summary\n${'='.repeat(72)}${C.x}`);
  for (const r of results) {
    console.log(`  ${mark[r.verdict]}  ${pad(r.id, 14)} ${pad(`${(r.ms / 1000).toFixed(1)}s`, 8)} ${r.detail}`);
    console.log(`         ${C.d}${r.title}${C.x}`);
  }
  if (v.hard.length) {
    console.log(`\n${C.r}${C.b}FAILED ASSERTIONS${C.x}`);
    for (const h of v.hard) console.log(`  ${C.r}x${C.x} ${h.line}`);
  }
  if (v.notRun.length) {
    console.log(`\n${C.y}${C.b}WHAT DID NOT RUN${C.x} ${C.d}— an unlisted absence is indistinguishable from a pass${C.x}`);
    for (const n of v.notRun) console.log(`  ${C.y}-${C.x} ${pad(n.id, 14)} ${n.why}`);
  }
  const drifted = results.filter((r) => r.drift);
  if (drifted.length) {
    console.log(`\n${C.y}${C.b}COVERAGE DRIFT — this run did not check the same things as the last one${C.x}`);
    for (const r of drifted) {
      const d = r.drift;
      console.log(`  ${C.y}~${C.x} ${r.id}: ${d.from} -> ${d.to} assertions (previous run ${String(d.when).slice(0, 19)}Z)`);
      for (const n of d.gone.slice(0, 8)) console.log(`      ${C.r}-${C.x} no longer runs: ${n}`);
      for (const n of d.added.slice(0, 8)) console.log(`      ${C.g}+${C.x} newly runs:     ${n}`);
      if (d.gone.length > 8 || d.added.length > 8) console.log(`      ${C.d}...and more, see ${COVERAGE}${C.x}`);
    }
    console.log(`  ${C.d}An ABSENT assertion reads as green. "N/N" is only comparable between runs when N is.${C.x}`);
    console.log(`  ${C.d}If nothing in the tree changed, a block is silently conditional — that is a harness bug.${C.x}`);
    console.log(`  ${C.d}This is a WARNING, not the verdict: the exact `+ '`assertions`' + ` pin is what turns a shortfall red.${C.x}`);
  }

  /**
   * SAID OUT LOUD, because a baseline that quietly did not move is how this
   * instrument would stop reporting a live regression after one run.
   */
  const truncated = results.filter((r) => r.truncated);
  if (truncated.length) {
    console.log(`\n${C.y}${C.b}BASELINE NOT UPDATED${C.x} ${C.d}— these steps printed assertions but no summary line, so `
      + `they did not run to their end. The coverage baseline still holds the last COMPLETE run, and the drift above `
      + `will keep reporting until one happens.${C.x}`);
    for (const r of truncated) console.log(`  ${C.y}~${C.x} ${r.id}: ${coveredNames(r.out).length} assertions, no summary line`);
  }

  console.log(`\n${C.d}logs -> ${OUT}${C.x}`);
  // ON THE VERDICT LINE, not only in a section above it. Ruling 27: a warning
  // nobody reads is an instrument that never fired, one step slower.
  const caveat = coverageCaveat(drifted.map((r) => r.id), truncated.map((r) => r.id));
  // The caveat already leads with COVERAGE DRIFT / BASELINE NOT UPDATED, so the
  // marker is a marker and not a second label.
  const CAVEAT = caveat ? `\n${C.y}${C.b}!${C.x} ${C.y}${caveat}${C.x}` : '';
  const code = exitFor(v, STRICT);
  if (v.colour === 'RED') {
    console.log(`\n${C.r}${C.b}RED${C.x} — ${v.hard.length} failing assertion${v.hard.length === 1 ? '' : 's'}. Do not commit as green.${CAVEAT}\n`);
    return code;
  }
  if (v.colour === 'GREEN-PARTIAL') {
    console.log(`\n${C.g}${C.b}GREEN${C.x} ${C.y}(partial — ${results.length} of ${STEPS.length} steps ran; see WHAT DID NOT RUN above)${C.x}`
      + `${code === 2
        ? `\n${C.r}${C.b}--strict: EXIT 2${C.x} — ${v.skipped.length} step(s) SKIPPED and ${v.todo.length} `
          + `NOT BUILT (${[...v.skipped, ...v.todo].map((x) => x.id).join(' ')}). A step the machine declined to `
          + 'run is a question nobody answered, and it reads as success from the outside. Filtering with '
          + '--quick or --only is NOT what this refuses.'
        : ''}${CAVEAT}\n`);
    return code;
  }
  console.log(`\n${C.g}${C.b}GREEN${C.x} — ${results.map((r) => `${r.id} ${r.detail}`).join(' · ')}${CAVEAT}\n`);
  return code;
}

// Import-safe on purpose: `tools/suites/void-canary.mjs` imports `STEPS`,
// `classify` and `verdict` from here and asserts against the REAL objects rather
// than against a second copy of them. A second copy of a list is a list that
// drifts, and this one would drift silently.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)));
}
