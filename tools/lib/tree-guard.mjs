/**
 * THE TREE THIS RUN IS ABOUT TO MEASURE IS THE TREE SOMEBODY COMMITTED — OR THIS
 * RUN DOES NOT HAPPEN.
 *
 * ---------------------------------------------------------------------------
 * THE BUG (stem-workbench#22), AND WHY IT IS THE EXPENSIVE KIND
 * ---------------------------------------------------------------------------
 * A mutation battery edits a shipped file, runs a suite, and restores. It
 * restores on its own EXIT — and `timeout` sends SIGTERM, so the way a long
 * battery is most likely to die was the one way it did not clean up. Twice in
 * one afternoon a battery was killed and left its mutation standing:
 * `tabId` back on `src/main/engine-messages.js`, and `--variant=b` in a suite.
 * The next gate run measured the mutated tree and reported a red that did not
 * exist in the code.
 *
 * A false red costs exactly as much investigation as a real defect and
 * additionally teaches everyone to distrust reds (`AGENTS.md`). This one is also
 * CONTAGIOUS: it outlives the run that caused it and lands on whoever measures
 * next, which in a shared checkout is somebody else.
 *
 * ---------------------------------------------------------------------------
 * TRAPS ARE THE BELT. THIS IS THE BRACES, AND IT IS WHY THE SENTINEL EXISTS.
 * ---------------------------------------------------------------------------
 * Every battery now traps INT, TERM and HUP. That closes `timeout` and Ctrl-C —
 * and it closes NOTHING for `kill -9`, a crashed host, a full disk or a power
 * cut, because no trap runs. So a battery also writes a SENTINEL while a
 * mutation is standing and removes it only after the restore has been
 * byte-verified, and every suite refuses to start while one is present.
 *
 * The sentinel is the same object as the restore record, deliberately: it names
 * the file, the backup, the battery and the case, so the trap restores FROM IT
 * rather than from a naming convention each battery reinvents. One mechanism,
 * two uses, and the thing that refuses the run is the thing that knows how to
 * undo it.
 *
 * ---------------------------------------------------------------------------
 * HOW A BATTERY RUNS ITS OWN SUITE WITHOUT TRIPPING ITS OWN SENTINEL
 * ---------------------------------------------------------------------------
 * NOT with an environment variable. A stale `ALLOW=1` left in one agent's shell
 * would silently disable this everywhere, which is the failure mode of the thing
 * it is guarding against. The sentinel records the battery's PID, and a suite
 * ignores exactly those sentinels whose owner is one of its own ANCESTORS. A
 * battery's child suite is allowed through; anybody else's is not, including a
 * concurrently running battery's — a mutation standing in a shared checkout
 * means nobody else can measure, which is the correct answer and not a
 * limitation.
 *
 * A recycled PID that happens to be an ancestor is the only false negative, and
 * a PID that is dead or unrelated fails CLOSED, which is the safe direction.
 *
 * ---------------------------------------------------------------------------
 * COST
 * ---------------------------------------------------------------------------
 * One `readdir` of a directory that is almost always absent. Nothing else runs
 * unless a sentinel is there. The `git status` below is ONE spawn per suite, at
 * startup, never per assertion.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

/** Under `out/`, which is gitignored and per-checkout — the contagion is per-checkout too. */
export const sentinelDir = (root) => path.join(root, 'out', '.mutating');

/**
 * THE OUT-OF-TREE MARKER, one per root, keyed by a hash of the root path so a
 * path is not content. It lives in os.tmpdir() — NOT under `out/`, because a
 * battery wipes its own `out/<battery>/` on the way in, and the sentinel's
 * backups live there: a second battery of the same name deletes the running
 * one's backups from under it (the incident the shell-mutations.sh header
 * documents from the losing side). The marker carries the owner pid, the
 * started time, the battery name, and the ORIGINAL BYTES of every file a case
 * has claimed — see beginBattery, endBattery and the claimMutation upsert.
 */
export const markerPath = (root) => path.join(
  os.tmpdir(),
  `stem-workbench-mutations-${createHash('sha256').update(String(root)).digest('hex').slice(0, 16)}.json`,
);

const b64 = (b) => Buffer.from(b).toString('base64');
const unb64 = (s) => Buffer.from(s, 'base64');

const ISO = () => new Date().toISOString();

/**
 * The PID chain of this process, innermost first. Linux `/proc`; this repository
 * is Linux-only and says so in `docs/TESTING.md`. Capped, because a `/proc` that
 * answers strangely must not become an infinite loop inside a gate.
 */
export function ancestors(pid = process.pid, limit = 64) {
  const chain = [];
  let cur = pid;
  for (let i = 0; i < limit && cur > 0; i++) {
    chain.push(cur);
    let ppid = 0;
    try {
      const status = fs.readFileSync(`/proc/${cur}/status`, 'utf8');
      ppid = Number((status.match(/^PPid:\s*(\d+)$/m) || [, 0])[1]);
    } catch { break; }
    if (!ppid || ppid === cur) break;
    cur = ppid;
  }
  return chain;
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

/** Every sentinel on disk, parsed. A file we cannot parse is reported, not ignored. */
export function standingMutations(root) {
  const dir = sentinelDir(root);
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((n) => n.endsWith('.json')).sort().map((n) => {
    const file = path.join(dir, n);
    try {
      const s = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { ...s, sentinel: file, ok: true };
    } catch (err) {
      return { sentinel: file, ok: false, battery: '(unparseable)', case: '?', files: [],
               why: String((err && err.message) || err) };
    }
  });
}

/** Where one battery's one case is recorded. The name is the lookup key, so it is derived once. */
export const sentinelPath = (root, battery, kase) => path.join(sentinelDir(root), `${battery}.${kase}.json`);

/**
 * WRITE THE SENTINEL, before the first edit.
 *
 * `pid` is the OWNER — the process whose ancestry a suite is checked against —
 * and it is a parameter rather than `process.pid` because the two callers are
 * different shapes. A bash battery drives the CLI below, which is a short-lived
 * child that is gone by the time anything reads the sentinel, so it passes its
 * PARENT. A JavaScript battery calls this in-process and passes its own pid.
 * Getting that wrong fails CLOSED — an owner that is not one of the suite's
 * ancestors means the battery's own suite refuses to run — which is the safe
 * direction, and is why it is spelled at each call site rather than defaulted.
 */
export function claimMutation(root, battery, kase, files, pid) {
  fs.mkdirSync(sentinelDir(root), { recursive: true });
  const file = sentinelPath(root, battery, kase);
  fs.writeFileSync(file, `${JSON.stringify({
    battery, case: String(kase), pid, started: ISO(), files,
  }, null, 2)}\n`);

  // THE ORIGINAL BYTES GO INTO THE OUT-OF-TREE MARKER TOO, as each case
  // claims: the file set is what cases ACTUALLY claimed, and the bytes
  // survive the `out/` wipe that takes the sentinel's backups with it (the
  // incident the shell-mutations.sh header documents). `bak` holds the
  // PRE-EDIT bytes — claim is called after the backups exist and before the
  // first edit. See beginBattery for the owner semantics: the marker was
  // created by `begin` with the battery's own pid, so the upsert keeps that
  // pid (a JS battery that claims without a `begin` creates the marker here,
  // owned by the pid IT was called with).
  const marker = markerPath(root);
  let m = null;
  try { m = JSON.parse(fs.readFileSync(marker, 'utf8')); } catch { m = null; }
  const filesByRel = { ...((m && m.files) || {}) };
  for (const f of files) {
    try { filesByRel[f.rel] = b64(fs.readFileSync(f.bak)); }
    catch (err) { process.stdout.write(`claim(${battery} ${kase}): no original bytes for ${f.rel} (${f.bak}): ${err.message}\n`); }
  }
  fs.writeFileSync(marker, `${JSON.stringify({
    pid: (m && Number(m.pid)) || pid,
    started: (m && m.started) || ISO(),
    battery: (m && m.battery) || battery,
    root,
    files: filesByRel,
  }, null, 2)}\n`);
  return file;
}

/** Drop it. Already gone is the desired state, so this never throws. */
export function releaseMutation(root, battery, kase) {
  try { fs.unlinkSync(sentinelPath(root, battery, kase)); return true; } catch { return false; }
}

/**
 * PUT THE TREE BACK FROM THE SENTINELS THEMSELVES — never from a naming
 * convention each battery reinvents. One implementation, three callers: a bash
 * battery's trap, a JavaScript battery's signal handler, and the human running
 * `restore-all` after a `kill -9`.
 *
 * The sentinel is dropped only when everything it named came back. A
 * half-restored tree that no longer refuses the next run is the bug wearing a
 * fix.
 *
 * @param {string} root
 * @param {string|null} battery  restore only this battery's, or all of them
 */
export function restoreStanding(root, battery = null) {
  const restored = [], failed = [];
  for (const s of standingMutations(root)) {
    if (battery && s.battery !== battery) continue;
    const before = failed.length;
    for (const f of s.files || []) {
      try { fs.copyFileSync(f.bak, path.join(root, f.rel)); restored.push({ ...f, battery: s.battery, case: s.case }); }
      catch (err) { failed.push({ ...f, why: String((err && err.message) || err) }); }
    }
    if (failed.length === before) { try { fs.unlinkSync(s.sentinel); } catch { /* nothing left to drop */ } }
  }
  return { restored, failed };
}

/** `git status --porcelain -- src`, once. Empty array when clean or when git cannot answer. */
export function dirtySrc(root) {
  const r = spawnSync('git', ['status', '--porcelain', '--', 'src'], { cwd: root, encoding: 'utf8', timeout: 20000 });
  if (r.status !== 0 || typeof r.stdout !== 'string') return [];
  return r.stdout.split('\n').map((l) => l.trimEnd()).filter(Boolean);
}

/**
 * THE ONE CALL EVERY SUITE MAKES, FIRST THING.
 *
 * A REFUSAL IS AN ERROR. Not a SKIP and not a pass: `docs/TESTING.md`'s VOID
 * rule is that silence is not a pass, and "I declined to measure" must not read
 * as green either. It exits 3 with no `SKIPPED` and no assertion line, which
 * `tools/verify.mjs` classifies as FAIL and prints under FAILED ASSERTIONS.
 *
 * @param {string} id    the suite id, for the message
 * @param {string} root  the repository root
 */
export function refuseIfCompromised(id, root) {
  const mine = new Set(ancestors());
  const standing = standingMutations(root);
  const theirs = standing.filter((s) => !(s.ok && mine.has(Number(s.pid))));

  if (theirs.length) {
    console.log(`${id}: REFUSING TO RUN — a mutation battery has an edit standing on this tree.`);
    console.log(`${id}:`);
    for (const s of theirs) {
      const owner = Number(s.pid);
      console.log(`${id}:   ${s.battery} case ${s.case}, started ${s.started || '(unknown)'}`);
      console.log(`${id}:     owner pid ${owner} — ${alive(owner) ? 'STILL RUNNING' : 'GONE (killed, or the host died)'}`);
      for (const f of s.files || []) console.log(`${id}:     standing on ${f.rel}   (backup ${f.bak})`);
      if (!s.ok) console.log(`${id}:     the sentinel itself could not be read: ${s.why}`);
      console.log(`${id}:     sentinel ${s.sentinel}`);
    }
    console.log(`${id}:`);
    console.log(`${id}: Measuring now would report a red that is not in the code — that is stem-workbench#22,`);
    console.log(`${id}: and it is why this is an ERROR rather than a skip. Put the tree back with`);
    console.log(`${id}:     node tools/lib/tree-guard.mjs restore-all`);
    console.log(`${id}: which copies each backup above over each file and drops the sentinel, then run again.`);
    process.exit(3);
  }

  // Inside our own battery `src` is dirty ON PURPOSE — the sentinel above says
  // which files and we just matched it — so the check below is not asked.
  if (standing.length) return;

  const dirty = dirtySrc(root);
  if (!dirty.length) return;

  if (process.env.STEM_WORKBENCH_ALLOW_DIRTY === '1') {
    // ANNOUNCED, ALWAYS. A run that measured a dirty tree says so in its own
    // transcript rather than being worked out afterwards from the timestamps.
    console.log(`${id}: [tree] MEASURING A DIRTY TREE — ${dirty.length} uncommitted change(s) under src/, `
      + 'allowed by STEM_WORKBENCH_ALLOW_DIRTY=1:');
    for (const l of dirty) console.log(`${id}: [tree]   ${l}`);
    return;
  }
  console.log(`${id}: REFUSING TO RUN — src/ has uncommitted changes, so what this would measure is not`);
  console.log(`${id}: what anybody committed. ${dirty.length} change(s):`);
  for (const l of dirty) console.log(`${id}:   ${l}`);
  console.log(`${id}:`);
  console.log(`${id}: If a battery died and left one of these standing, put it back from its backup under`);
  console.log(`${id}: out/<battery>-mutations/. If it is your own work in progress, say so out loud:`);
  console.log(`${id}:     STEM_WORKBENCH_ALLOW_DIRTY=1 node tools/suites/${id}.mjs`);
  console.log(`${id}: which measures anyway and prints every one of these lines in the transcript.`);
  process.exit(3);
}

/**
 * THE CONCURRENCY GUARD, AT BATTERY START, BEFORE ANYTHING COSTS ANYTHING.
 *
 * The sentinel under `out/.mutating/` cannot carry this duty alone: its
 * backups live under `out/<battery>/`, which a second battery of the same
 * name wipes on its way in — and the batteries place this call before that
 * wipe, so a refused run has deleted nothing. The marker is out of the tree
 * entirely. Three branches:
 *
 *   marker, pid ALIVE  -> REFUSE. Never kill the incumbent: two runs rewriting
 *                         the same files measure neither tree (WORKTREES §4.7).
 *   marker, pid DEAD   -> a run was killed mid-mutation (kill -9 runs no trap
 *                         at all, which is the point): RESTORE every file
 *                         from the saved bytes, SAY SO LOUDLY, then refuse —
 *                         a repair nobody is told about is the same silence.
 *   no marker          -> claim it (owner = OUR parent, the battery shell),
 *                         run, and let the battery's EXIT trap release it —
 *                         the bash rendering of "release in `finally`".
 *
 * A refusal exits 4 before the out/ wipe, before the baseline, before the
 * mutex and before any launch.
 *
 * @param {string} battery
 * @param {string} root
 */
export function beginBattery(battery, root) {
  const file = markerPath(root);
  let m = null;
  try { m = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { m = null; }
  if (m !== null) {
    const owner = Number(m.pid);
    if (owner && alive(owner)) {
      process.stdout.write(`\n\x1b[31mREFUSING TO START ${battery}: another battery (${m.battery || 'unknown'}, `
        + `pid ${owner}, started ${m.started || '?'}) is rewriting this checkout right now.\x1b[0m\n`);
      process.stdout.write('  Two runs rewriting the same files measure neither tree. The incumbent is never killed.\n');
      process.stdout.write(`  Marker: ${file}\n`);
      process.exit(4);
    }
    // Dead owner — or a marker that cannot be read: restore from the saved bytes.
    process.stdout.write(`\n\x1b[33mA battery that was KILLED MID-MUTATION left this tree rewritten. `
      + `Restoring it from the marker (${m.battery || 'unknown'}, pid ${owner || '(unreadable)'}, `
      + `started ${m.started || '?'}):\x1b[0m\n`);
    let repaired = 0, already = 0, failed = 0;
    for (const [rel, b64s] of Object.entries((m && m.files) || {})) {
      const p = path.join(root, rel);
      let cur = null;
      try { cur = fs.readFileSync(p); } catch { cur = null; }
      const want = unb64(b64s);
      if (cur !== null && Buffer.compare(cur, want) === 0) { already += 1; process.stdout.write(`  ${rel} — already intact\n`); continue; }
      try {
        fs.writeFileSync(p, want);
        repaired += 1;
        process.stdout.write(`  RESTORED ${rel} (${cur === null ? 'no current copy existed' : cur.length + ' -> ' + want.length + ' bytes'})\n`);
      } catch (err) { failed += 1; process.stdout.write(`  COULD NOT RESTORE ${rel}: ${err.message}\n`); }
    }
    // THE KILLED RUN'S SENTINELS: every file they name was saved into this
    // marker at claim time and the restore above just healed them, so they
    // have served their purpose. Drop them — otherwise the suites refuse the
    // NEXT run for an edit that is no longer standing.
    let dropped = 0;
    for (const s of standingMutations(root)) {
      const allHealed = (s.files || []).every((f) => (m.files || {}).hasOwnProperty(f.rel));
      if (allHealed) {
        try { fs.unlinkSync(s.sentinel); dropped += 1; process.stdout.write(`  dropped stale sentinel ${s.battery} case ${s.case}\n`); }
        catch { /* a drop is best effort — the next suite names it if it survives */ }
      }
    }
    try { fs.unlinkSync(file); } catch { /* already gone */ }
    process.stdout.write(`  ${repaired} restored, ${already} already intact, ${failed} failed, ${dropped} stale sentinel(s) dropped. `
      + 'The marker is cleared. Re-run to measure — THIS run is refused, so the repair is not something '
      + 'you find out about from a table.\n');
    process.exit(4);
  }
  // No marker: claim it. THE OWNER IS OUR PARENT, the battery shell — this
  // process is short-lived, and `end` must recognise the shell's ancestry.
  fs.writeFileSync(file, `${JSON.stringify({ pid: process.ppid, started: ISO(), battery, root, files: {} }, null, 2)}\n`);
  // Say once which tree this run measures, so the table names it.
  const r = spawnSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8', timeout: 20000 });
  const head = spawnSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', timeout: 20000 });
  const dirty = r.status === 0 && typeof r.stdout === 'string' ? r.stdout.split('\n').map((l) => l.trimEnd()).filter(Boolean) : null;
  const h = head.status === 0 && typeof head.stdout === 'string' ? String(head.stdout).trim() : '?';
  if (dirty === null) process.stdout.write(`\x1b[2m${battery}: git is unavailable here; this run cannot say which tree it measures\x1b[0m\n`);
  else if (dirty.length) process.stdout.write(`\x1b[2m${battery}: measuring an UNCOMMITTED tree at ${h} + ${dirty.length} modified file(s): `
    + `${dirty.map((l) => l.slice(3)).join(', ')}\x1b[0m\n`);
  else process.stdout.write(`\x1b[2m${battery}: measuring the tree at ${h}, clean\x1b[0m\n`);
}

/**
 * RELEASE THE MARKER — the battery's `finally`, reached on a normal `exit
 * 0/1`, on a signal's `exit 130` and on any other exit the shell takes, via
 * the EXIT trap mg_begin installs. Restores any file whose bytes differ from
 * what the marker saved (a case whose restore did not run), then clears the
 * marker.
 *
 * Ownership: the marker's pid is the battery shell, which is an ancestor of
 * this process when the end came from our own trap. A marker owned by someone
 * else is left alone — a live owner is another battery still running, and a
 * dead owner is for the next begin() to repair loudly.
 */
export function endBattery(battery, root) {
  const file = markerPath(root);
  let m = null;
  try { m = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { m = null; }
  if (m === null) return { restored: [], cleared: false };
  const owner = Number(m.pid);
  const mine = owner && ancestors().includes(owner);
  if (!mine) {
    if (owner && alive(owner)) process.stdout.write(`end(${battery}): marker owned by LIVE pid ${owner} (${m.battery}) is not ours — leaving it alone\n`);
    else process.stdout.write(`end(${battery}): marker owned by dead pid ${owner} (${m.battery}) is not ours — leaving it for the next begin() to repair loudly\n`);
    return { restored: [], cleared: false };
  }
  const restored = [];
  for (const [rel, b64s] of Object.entries(m.files || {})) {
    const p = path.join(root, rel);
    let cur = null;
    try { cur = fs.readFileSync(p); } catch { cur = null; }
    const want = unb64(b64s);
    if (cur !== null && Buffer.compare(cur, want) === 0) continue;
    try { fs.writeFileSync(p, want); restored.push(rel); }
    catch (err) { process.stdout.write(`end(${battery}): COULD NOT RESTORE ${rel}: ${err.message}\n`); }
  }
  try { fs.unlinkSync(file); } catch { /* already gone */ }
  if (restored.length) process.stdout.write(`end(${battery}): ${restored.length} file(s) had a mutation standing at exit; restored from the marker\n`);
  return { restored, cleared: true };
}

// ------------------------------------------------------------------ the CLI
// Bash cannot import an ES module, so the batteries drive it from here.
//
//   begin <battery>                                     the battery's FIRST act:
//                                                       claim the out-of-tree
//                                                       marker, or refuse (exit
//                                                       4) — see beginBattery
//   end <battery>                                       the battery's `finally`:
//                                                       restore-and-clear, ours
//                                                       only — see endBattery
//   claim <battery> <case> <rel>=<bak> [<rel>=<bak> …]  before the first edit
//   release <battery> <case>                            after a VERIFIED restore
//   restore <battery>                                   the trap: undo and drop
//   restore-all                                         a human, after a kill -9
//   check <suite-id>                                    what a suite calls
function cli(argv) {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  const [what, a, b, ...rest] = argv;

  if (what === 'begin') { beginBattery(a || 'battery', root); return 0; }

  if (what === 'end') { endBattery(a || 'battery', root); return 0; }

  if (what === 'claim') {
    if (!a || b === undefined) { process.stderr.write('usage: claim <battery> <case> <rel>=<bak> …\n'); return 2; }
    const files = rest.map((p) => { const i = p.indexOf('='); return { rel: p.slice(0, i), bak: p.slice(i + 1) }; });
    // THE OWNER IS OUR PARENT, which is the battery — not this short-lived
    // process, which is gone by the time anything reads the sentinel.
    claimMutation(root, a, b, files, process.ppid);
    return 0;
  }

  if (what === 'release') { releaseMutation(root, a, b); return 0; }

  if (what === 'restore' || what === 'restore-all') {
    const { restored, failed } = restoreStanding(root, what === 'restore' ? a : null);
    for (const f of restored) process.stdout.write(`restored ${f.battery} case ${f.case}: ${f.rel}\n`);
    for (const f of failed) process.stdout.write(`COULD NOT RESTORE ${f.rel} from ${f.bak}: ${f.why}\n`);
    if (failed.length) return 1;
    if (!restored.length) process.stdout.write('nothing was standing\n');
    return 0;
  }

  if (what === 'check') { refuseIfCompromised(a || 'tree-guard', root); process.stdout.write('clean\n'); return 0; }

  process.stderr.write('usage: node tools/lib/tree-guard.mjs begin|end|claim|release|restore|restore-all|check …\n');
  return 2;
}

if (process.argv[1] && process.argv[1].endsWith('tree-guard.mjs')) process.exit(cli(process.argv.slice(2)));
