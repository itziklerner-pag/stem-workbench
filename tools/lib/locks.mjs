/**
 * THE MACHINE-GLOBAL LOCKS, DEFINED ONCE. THIS FILE IS THE ONLY PLACE IN
 * `tools/` THAT MAY SPELL A LOCK PATH, AND `void-canary` ASSERTS THAT.
 *
 * ---------------------------------------------------------------------------
 * WHY ONE FILE AND NOT A CONVENTION
 * ---------------------------------------------------------------------------
 * These paths used to be copy-pasted into eleven files — seven suites and four
 * mutation batteries — each re-deriving the same formula, each free to drift.
 * Nothing drifted in the source. What drifted was the RUNS: two lines of work
 * pointed `STEM_WORKBENCH_BROWSER_LOCK` at different files, both believed they
 * held "the" mutex, and then raced each other on `xvfb-run -a`, which picks a
 * display by scanning for a free number and is a race two launches can both
 * win. Batteries were lost to it for hours, and one wedged run sat on a mutex
 * nobody else could take for fifty-two minutes.
 *
 * A convention that eleven files restate is eleven chances to restate it
 * differently. So there is one definition, every suite and battery imports it,
 * and a scan refuses a second literal.
 *
 * ---------------------------------------------------------------------------
 * THE OVERRIDE STAYS, AND IT ANNOUNCES ITSELF
 * ---------------------------------------------------------------------------
 * `STEM_WORKBENCH_BROWSER_LOCK` still names a different file, because an
 * operator sharing a box sometimes genuinely needs to stand outside the queue —
 * with a fixed display, not `-a`, or the race comes straight back. What it must
 * never be again is INVISIBLE: divergence is what cost the hours, and from the
 * outside a run holding the wrong lock looks exactly like a run making
 * progress. So the override is read HERE, in one place, and every suite that
 * takes the lock prints `announceLock()` first — one line naming both paths
 * when they differ, and nothing when they agree.
 *
 * `STEM_WORKBENCH_BROWSER_LOCK_HELD=1` is a DIFFERENT thing and is not a path:
 * it says an ancestor already holds the lock, because `flock` is not reentrant
 * across processes and a battery that took the mutex and then ran a suite that
 * takes it again would wait for itself.
 *
 * ---------------------------------------------------------------------------
 * THE ORDER IS PART OF THE CONTRACT
 * ---------------------------------------------------------------------------
 * The SINK lock is taken FIRST and the BROWSER mutex SECOND, everywhere
 * (`docs/TESTING.md` §4). Inverting it in one caller is a deadlock, and it has
 * cost a run: a battery holding the browser mutex outermost while a leftover
 * suite held the sink lock and waited for the browser mutex sat there until
 * both were killed. `LOCK_ORDER` is that sentence in a form a suite can print.
 *
 * SHELL CALLERS ASK THIS FILE TOO, rather than re-deriving in bash:
 *
 *     LOCK="$(node "$ROOT/tools/lib/locks.mjs" browser)"
 *     SINK_LOCK="$(node "$ROOT/tools/lib/locks.mjs" sink stem_workbench_gate)"
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Per-user, because two users on one box are two independent queues. */
const uid = () => (process.getuid ? process.getuid() : 'x');

/**
 * THE canonical shared browser mutex, ignoring any override. Everything that
 * launches Electron, a browser or an X server queues on this one file.
 */
export const CANONICAL_BROWSER_LOCK = path.join(os.tmpdir(), `stem-workbench-browser-${uid()}.lock`);

/** What this process will actually take. Equal to the canonical path unless overridden. */
export const BROWSER_LOCK = process.env.STEM_WORKBENCH_BROWSER_LOCK || CANONICAL_BROWSER_LOCK;

/** True when this run has stepped out of the shared queue. See the header. */
export const BROWSER_LOCK_OVERRIDDEN = BROWSER_LOCK !== CANONICAL_BROWSER_LOCK;

/** An ancestor already holds the browser mutex; `flock` is not reentrant. */
export const BROWSER_LOCK_HELD_BY_CALLER = process.env.STEM_WORKBENCH_BROWSER_LOCK_HELD === '1';

/**
 * The per-sink exclusive lock. `XDG_RUNTIME_DIR` first, because that is where
 * the PipeWire session already lives; `spike/harness/bin/env.sh` computes the
 * same path in shell and `void-canary` asserts the two agree, exactly.
 */
export const sinkLock = (sink) =>
  path.join(process.env.XDG_RUNTIME_DIR || os.tmpdir(), `stem-workbench-sink-${sink}.lock`);

/** The one sentence every caller must obey. Printed, not merely believed. */
export const LOCK_ORDER = 'the PipeWire sink lock is taken FIRST and the shared browser mutex SECOND '
  + '(docs/TESTING.md §4) — inverting it in one caller is a deadlock';

/**
 * ONE LINE, ONLY WHEN IT MATTERS. Called by every suite before it queues, so a
 * run standing outside the shared queue says so in its own log rather than
 * being worked out afterwards from process listings.
 */
export function announceLock(log = console.log) {
  if (!BROWSER_LOCK_OVERRIDDEN) return false;
  log(`[lock] NOT ON THE SHARED QUEUE: STEM_WORKBENCH_BROWSER_LOCK=${BROWSER_LOCK} `
    + `(canonical: ${CANONICAL_BROWSER_LOCK}). Anything else on this box is queueing somewhere else, `
    + 'so `xvfb-run -a` can hand two runs the same display. Use a fixed display or drop the override.');
  return true;
}

// ------------------------------------------------------------------ the scan
/**
 * THE SCAN LIVES HERE BECAUSE THIS IS THE FILE ALLOWED TO NAME LOCKS.
 *
 * It was written in `void-canary.mjs` first and that version FAILED ON ITSELF —
 * correctly: a scanner that spells `stem-workbench-browser` in order to look for
 * it has just added the twelfth copy. Rather than exempt the scanner (an
 * exemption is a hole, and this rule exists because of a hole), the scan is here
 * and the markers are DERIVED from the paths above, so it can never disagree
 * with what it is guarding and there is no literal to exempt.
 *
 * DELIBERATELY CRUDE: a substring over the raw bytes, comments included, no
 * exemption list. Every subtle version of this has a hole a copy-paste fits
 * through, and prose naming the lock is exactly how the eleventh copy arrived.
 * A mutation battery that needs to break a lock path breaks it one level up,
 * through this module (`capture-mute-mutations.sh` case 12).
 *
 * @param {string} root      the directory to walk — `tools/` in the gate
 * @param {string} selfRel   this file, relative to the repo root; the one exemption
 * @returns {string[]} one line per offending file, empty when the rule holds
 */
export const LOCK_MARKERS = [
  path.basename(CANONICAL_BROWSER_LOCK).replace(/-[^-]*\.lock$/, ''),
  path.basename(sinkLock('probe')).replace(/-probe\.lock$/, ''),
];

/** The path-naming variable. `…_HELD` is a reentrancy flag, not a path, and is allowed anywhere. */
export const LOCK_ENV = 'STEM_WORKBENCH_BROWSER_LOCK';

export function strayLockPaths(root, selfRel = path.join('tools', 'lib', 'locks.mjs'), repoRoot = null) {
  const base = repoRoot || path.dirname(root);
  const envRe = new RegExp(`${LOCK_ENV}(?!_HELD)`);
  const hits = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = path.relative(base, full);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.isFile() || rel === selfRel) continue;
      if (!/\.(mjs|js|cjs|sh|py)$/.test(e.name)) continue;
      let text;
      try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
      const found = LOCK_MARKERS.filter((m) => text.includes(m));
      if (envRe.test(text)) found.push(LOCK_ENV);
      if (found.length) hits.push(`${rel} [${found.join(', ')}]`);
    }
  };
  walk(root);
  return hits.sort();
}

// --------------------------------------------------------------- the shell API
// `node tools/lib/locks.mjs browser` / `... sink <name>`. Bash cannot import an
// ES module, and a battery re-deriving the formula in shell is the second
// literal this file exists to prevent.
if (process.argv[1] && process.argv[1].endsWith('locks.mjs')) {
  const [, , what, arg] = process.argv;
  if (what === 'browser') process.stdout.write(BROWSER_LOCK);
  else if (what === 'sink' && arg) process.stdout.write(sinkLock(arg));
  else {
    process.stderr.write('usage: node tools/lib/locks.mjs browser | sink <sink-name>\n');
    process.exit(2);
  }
}
