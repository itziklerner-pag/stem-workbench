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
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out', 'verify');
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
    title: 'node tools/suites/void-canary.mjs — the steps table agrees with docs/TESTING.md, and the VOID rule is wired',
    cmd: ['node', 'tools/suites/void-canary.mjs'],
  },
  {
    id: 'vendor-intact',
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
    expect: {
      re: /GREEN \(partial — the vendored unit's suites only; (\d+) of (\d+) steps\)/,
      why: "the vendored runner's own verdict line for a --unit plan",
      /**
       * WHY AN `expect` AND NOT JUST THE EXIT CODE. `--unit` exits 0 on a green
       * plan and 2 on an EMPTY one — but an emptied `suites` list in
       * `extension/unit.json` is not the only way to run fewer suites than the
       * pin promises, and the failure mode of every one of them is a smaller,
       * greener number. VENDORING.md §7 pins the plan at 12 of 12 PASS at
       * v0.2.0; `vendor/.pin` carries that number next to the tag it belongs
       * to, so a pin bump is a deliberate edit of one file rather than a
       * silently shorter run.
       */
      pin: (m, t) => {
        const p = readPin();
        if (!p) return null;
        const bad = [];
        if (typeof p.steps === 'number' && Number(m[1]) !== p.steps) {
          bad.push(`ran ${m[1]} suites, vendor/.pin (${p.tag}) pins ${p.steps}`);
        }
        if (typeof p.assertions === 'number') {
          const rows = vendorRows(t);
          const total = rows.reduce((n, r) => n + r.count, 0);
          const red = rows.filter((r) => r.verdict !== 'PASS').map((r) => `${r.id} ${r.verdict}`);
          if (red.length) bad.push(`not every vendored suite passed: ${red.join(', ')}`);
          if (total !== p.assertions) {
            bad.push(`${total} assertions, vendor/.pin (${p.tag}) pins ${p.assertions}`
              + ` [${rows.map((r) => `${r.id} ${r.count}`).join(' ')}]`);
          }
        }
        return bad.length ? bad.join('; ') : null;
      },
    },
  },
  {
    id: 'deck-seam',
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
    id: 'shell',
    title: 'node tools/suites/shell.mjs — one real launch of `electron .`: the window, isolation, the capture grant, the mute, the allowlist',
    cmd: ['node', 'tools/suites/shell.mjs'],
    window: true,
  },
  {
    id: 'engine-host',
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
     */
  },
  {
    id: 'transport',
    title: 'node tools/suites/transport.mjs — the source view\'s transport: L1, the closed write set, the jump rule, speed, autoplay-next, the keys',
    cmd: ['node', 'tools/suites/transport.mjs'],
    window: true,
  },
  {
    id: 'deck-host',
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
    title: "node tools/suites/p1.mjs — P1': every session the app creates reaches the update host and nothing else",
    cmd: ['node', 'tools/suites/p1.mjs'],
    window: true,
    todo: 'specified in docs/TESTING.md §9; not built',
  },
  {
    id: 'smoke',
    title: 'node tools/suites/smoke.mjs — Playwright-for-Electron against the LOCAL fake player: boot, seam, transport, deck',
    cmd: ['node', 'tools/suites/smoke.mjs'],
    window: true,
    todo: 'specified in docs/TESTING.md §6; not built',
  },
  {
    id: 'capture-mute',
    title: 'node tools/suites/capture-mute.mjs — the permanent gate: the view is captured at full level while the device stays silent',
    cmd: ['node', 'tools/suites/capture-mute.mjs'],
    window: true,
    sink: true,
    todo: 'specified in docs/TESTING.md §8 (the CORRECTED gate); not built',
  },
  {
    id: 'youtube',
    title: 'node tools/suites/youtube.mjs — the same claims against real youtube.com. MANUAL / nightly only.',
    cmd: ['node', 'tools/suites/youtube.mjs'],
    window: true,
    manual: true,
    todo: 'specified in docs/TESTING.md §7; not built',
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
 * `docs/VENDORING.md` §7 independently pins.
 *
 * WHY SUM THEM AT ALL, when the step count is already pinned: the count of
 * SUITES cannot see a suite that ran and asserted less than it used to. That is
 * the ABSENT-assertion failure the extension's coverage-drift instrument exists
 * for, and a pinned total is its cheap half — exact here, because `--unit` is
 * plain node and deterministic, and because a tag is immutable.
 *
 * IF IT EVER PROVES UNSTABLE: drop `assertions` from `vendor/.pin` rather than
 * widening it to a range. A range on a deterministic number is a gate that has
 * stopped measuring anything. The step count keeps working without it.
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

/** Assertion lines, by the convention in docs/TESTING.md: `ok`/`PASS`/`FAIL` then the name then two spaces. */
export function assertionLines(out) {
  return strip(out).split('\n')
    .map((l) => l.match(/^\s{0,3}(ok|PASS|FAIL)\s+(.*)$/))
    .filter(Boolean)
    .map((m) => ({ pass: m[1] !== 'FAIL', name: m[2].split('  ')[0].trim(), line: m[0].trim() }))
    .filter((a) => a.name);
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
  if (res.code === 0) return { verdict: 'PASS', detail: summarise(res), hard: [] };

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
export function verdict(results, steps, plan) {
  const hard = results.flatMap((r) => (r.hard || []).map((h) => ({ step: r.id, line: h })));
  if (hard.length || results.some((r) => r.verdict === 'FAIL' || r.verdict === 'VOID')) {
    return { colour: 'RED', hard, notRun: [] };
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
  return { colour: notRun.length ? 'GREEN-PARTIAL' : 'GREEN', hard, notRun };
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

  // ---- `expect`: the vendored gate must print its OWN verdict line ---------
  const V = "\n\x1b[32m\x1b[1mGREEN\x1b[0m \x1b[33m(partial — the vendored unit's suites only; 12 of 23 steps)\x1b[0m\n";
  const vstep = STEPS.find((s) => s.id === 'vendor-unit');
  check('the vendored gate\'s real verdict line is recognised by the `expect` regex',
    vstep.expect.re.test(strip(V)), strip(V).trim());
  check('...and a transcript full of green assertions WITHOUT it is a FAIL, not a PASS',
    cl('\n612 passed, 0 failed\n', 0, { expect: vstep.expect }).verdict === 'FAIL',
    cl('\n612 passed, 0 failed\n', 0, { expect: vstep.expect }).detail);
  check('...and with it, a PASS',
    cl(`\n612 passed, 0 failed\n${V}`, 0, { expect: { re: vstep.expect.re, why: vstep.expect.why } }).verdict === 'PASS');
  const pinned = { re: vstep.expect.re, why: vstep.expect.why, pin: (m) => (Number(m[1]) === 12 ? null : `ran ${m[1]}, pin says 12`) };
  check('a vendored run over FEWER suites than vendor/.pin promises is RED — a smaller plan prints the same green',
    cl(`\n612 passed, 0 failed\n${V.replace('12 of 23', '8 of 23')}`, 0, { expect: pinned }).verdict === 'FAIL',
    cl(`\n612 passed, 0 failed\n${V.replace('12 of 23', '8 of 23')}`, 0, { expect: pinned }).detail);

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

  console.log(`\n${bad ? `${C.r}${bad} FAILED${C.x}` : `${C.g}self-check green${C.x}`}\n`);
  return bad;
}

// ---------------------------------------------------------------------- main
async function main(argv) {
  const flag = (k) => argv.includes('--' + k);
  const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const QUICK = flag('quick'), ONLY = arg('only', null), MANUAL = flag('manual');

  if (flag('self-check')) return selfCheck() ? 1 : 0;
  if (flag('list')) {
    for (const s of STEPS) {
      const tags = [s.window && 'window', s.sink && 'sink', s.manual && 'manual', s.todo && 'TODO'].filter(Boolean);
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
  for (const step of plan) {
    const pre = step.precheck ? step.precheck(step) : null;
    if (pre) {
      console.log(`\n${C.b}=== ${step.id} ===${C.x} ${C.d}${pre.verdict.toLowerCase()} before launching: ${pre.detail}${C.x}`);
      results.push({ ...step, ms: 0, hard: pre.hard || [], verdict: pre.verdict, detail: pre.detail });
      continue;
    }
    const res = await run(step);
    results.push({ ...res, ...classify(res) });
  }

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
  console.log(`\n${C.d}logs -> ${OUT}${C.x}`);
  if (v.colour === 'RED') {
    console.log(`\n${C.r}${C.b}RED${C.x} — ${v.hard.length} failing assertion${v.hard.length === 1 ? '' : 's'}. Do not commit as green.\n`);
    return 1;
  }
  if (v.colour === 'GREEN-PARTIAL') {
    console.log(`\n${C.g}${C.b}GREEN${C.x} ${C.y}(partial — ${results.length} of ${STEPS.length} steps ran; see WHAT DID NOT RUN above)${C.x}\n`);
    return 0;
  }
  console.log(`\n${C.g}${C.b}GREEN${C.x} — ${results.map((r) => `${r.id} ${r.detail}`).join(' · ')}\n`);
  return 0;
}

// Import-safe on purpose: `tools/suites/void-canary.mjs` imports `STEPS`,
// `classify` and `verdict` from here and asserts against the REAL objects rather
// than against a second copy of them. A second copy of a list is a list that
// drifts, and this one would drift silently.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)));
}
