/**
 * THE MUTATION GUARD FOR JAVASCRIPT BATTERIES — the twin of
 * `tools/lib/mutation-guard.sh`, and the same obligation in the other language
 * two of the twelve batteries happen to be written in.
 *
 * WHY IT EXISTS is written at length in `tools/lib/tree-guard.mjs`: a battery
 * that dies without restoring leaves its edit standing on a shipped file, and
 * the next gate run measures the mutated tree and reports a red that is not in
 * the code (stem-workbench#22). Traps are the BELT and they close `timeout` and
 * Ctrl-C; the SENTINEL is the BRACES, for `kill -9`, a crashed host and a full
 * disk, where no handler runs at all.
 *
 * ---------------------------------------------------------------------------
 * WHY A JS BATTERY NEEDED ITS OWN, AND WHY EXEMPTING THEM WAS NOT AN OPTION
 * ---------------------------------------------------------------------------
 * `void-canary` asserted the trap and the sentinel over
 * `tools/suites/*-mutations.sh` and nothing else, so the two `.mjs` batteries
 * were outside the rule entirely. `youtube-mutations.mjs` had no signal handling
 * at all — three product rows that edit `src/` and a bare `finally`, which is
 * exactly the shape #22 was — and `deck-host-mutations.mjs` had a hand-rolled
 * handler and NO sentinel, so a `kill -9` mid-row stranded its edit silently.
 *
 * A bash `trap` cannot be written in JavaScript, so the check could not be
 * copied across verbatim. The property it is really about can: **a SIGTERM
 * arriving while an edit is standing puts the file back.** That is what this
 * module provides, and `void-canary` now asserts it two ways — that every JS
 * battery installs this, and, on a throwaway battery in a temp tree, that a real
 * SIGTERM really does restore.
 *
 * ---------------------------------------------------------------------------
 * IT WRITES THE BACKUP, unlike `mg_claim`
 * ---------------------------------------------------------------------------
 * The bash half takes `rel=bak` pairs whose backups the battery has already
 * written, because that is how those batteries were built. This one takes the
 * paths and writes the backups itself, for one reason: a JS battery that holds
 * its original in a `const` has nothing on disk for `restore-all` to copy back,
 * and both of them did. A backup that only exists in the memory of the process
 * that was killed is not a backup.
 *
 * ---------------------------------------------------------------------------
 * USING IT
 * ---------------------------------------------------------------------------
 *     const guard = mutationGuard({ battery: 'deck-host-mutations', root: ROOT });
 *     …
 *     guard.claim(m.id, ['src/main/deck-host.js']);   // BEFORE the first edit
 *     try { …edit, measure… }
 *     finally { guard.restore(); guard.release(m.id); }
 *
 * `release()` verifies the restored bytes against the backup and THROWS if they
 * differ, so the sentinel outlives a restore that did not work — which is the
 * direction that fails safe: the next suite refuses to measure and says why.
 */
import fs from 'node:fs';
import path from 'node:path';
import { claimMutation, releaseMutation, restoreStanding, sentinelPath } from './tree-guard.mjs';

/** What `trap … INT TERM HUP` names in the bash half. Exported so the canary can send one. */
export const GUARD_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/**
 * @param {object} o
 * @param {string} o.battery  the battery id, e.g. 'deck-host-mutations'
 * @param {string} o.root     the repository root
 * @param {(() => void)|null} [o.also]  the battery's own handler, run AFTER the
 *   restore — the equivalent of `MG_ALSO`. The two are not alternatives.
 */
export function mutationGuard({ battery, root, also = null }) {
  const outDir = path.join(root, 'out', battery);
  /** @type {{kase: string, files: {rel: string, bak: string}[]}|null} */
  let open = null;

  /**
   * Copy each file to a backup, then write the sentinel. IN THAT ORDER: a
   * sentinel naming a backup that does not exist yet is a sentinel that cannot
   * undo the thing it is claiming.
   */
  function claim(kase, rels) {
    fs.mkdirSync(outDir, { recursive: true });
    const files = rels.map((rel) => {
      const bak = path.join(outDir, `${kase}.${path.basename(rel)}.bak`);
      fs.copyFileSync(path.join(root, rel), bak);
      return { rel, bak };
    });
    claimMutation(root, battery, kase, files, process.pid);
    open = { kase: String(kase), files };
    return files;
  }

  /** Put the tree back from the SENTINEL, the same way `restore-all` does. */
  function restore() {
    if (!open) return { restored: [], failed: [] };
    return restoreStanding(root, battery);
  }

  /**
   * AFTER A VERIFIED RESTORE. The verification is the point: `mg_release`'s bash
   * callers check the bytes themselves and every one of them had to remember to,
   * so here it is not optional.
   */
  function release(kase = open && open.kase) {
    if (open) {
      const wrong = open.files.filter((f) => {
        try { return !fs.readFileSync(path.join(root, f.rel)).equals(fs.readFileSync(f.bak)); }
        catch { return true; }
      });
      if (wrong.length) {
        // The sentinel STAYS. The next suite refuses to measure and names the file.
        throw new Error(`${battery} case ${kase}: not restored — ${wrong.map((f) => f.rel).join(', ')} `
          + `still differs from its backup. The sentinel at ${sentinelPath(root, battery, kase)} is left standing on purpose.`);
      }
    }
    releaseMutation(root, battery, kase);
    open = null;
  }

  /**
   * EXIT 130, and the restore happens BEFORE anything is printed so a second
   * signal arriving during the report cannot cost the tree. A battery that was
   * interrupted has not produced a verdict and must not look like one that did.
   */
  function onSignal(sig) {
    const { restored, failed } = restore();
    process.stderr.write(`\n${sig} — putting ${battery}'s tree back before exiting.\n`);
    for (const f of restored) process.stderr.write(`  restored ${f.rel}\n`);
    for (const f of failed) process.stderr.write(`  COULD NOT RESTORE ${f.rel} from ${f.bak}: ${f.why}\n`);
    if (!restored.length && !failed.length) process.stderr.write('  nothing was standing\n');
    open = null;
    try { if (also) also(); } catch { /* the restore already happened, which is the part that matters */ }
    process.exit(130);
  }

  for (const sig of GUARD_SIGNALS) process.on(sig, () => onSignal(sig));

  return { claim, restore, release, standing: () => open };
}
