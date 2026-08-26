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
import { spawnSync } from 'node:child_process';

/** Under `out/`, which is gitignored and per-checkout — the contagion is per-checkout too. */
export const sentinelDir = (root) => path.join(root, 'out', '.mutating');

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

// ------------------------------------------------------------------ the CLI
// Bash cannot import an ES module, so the batteries drive it from here.
//
//   claim <battery> <case> <rel>=<bak> [<rel>=<bak> …]   before the first edit
//   release <battery> <case>                             after a VERIFIED restore
//   restore <battery>                                    the trap: undo and drop
//   restore-all                                          a human, after a kill -9
//   check <suite-id>                                     what a suite calls
function cli(argv) {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  const [what, a, b, ...rest] = argv;
  const nameOf = (battery, kase) => path.join(sentinelDir(root), `${battery}.${kase}.json`);

  if (what === 'claim') {
    if (!a || b === undefined) { process.stderr.write('usage: claim <battery> <case> <rel>=<bak> …\n'); return 2; }
    fs.mkdirSync(sentinelDir(root), { recursive: true });
    const files = rest.map((p) => { const i = p.indexOf('='); return { rel: p.slice(0, i), bak: p.slice(i + 1) }; });
    // THE OWNER IS OUR PARENT, which is the battery — not this short-lived
    // process, which is gone by the time anything reads the sentinel.
    fs.writeFileSync(nameOf(a, b), `${JSON.stringify({
      battery: a, case: b, pid: process.ppid, started: ISO(), files,
    }, null, 2)}\n`);
    return 0;
  }

  if (what === 'release') {
    try { fs.unlinkSync(nameOf(a, b)); } catch { /* already gone is the desired state */ }
    return 0;
  }

  if (what === 'restore' || what === 'restore-all') {
    const want = what === 'restore' ? a : null;
    let n = 0;
    for (const s of standingMutations(root)) {
      if (want && s.battery !== want) continue;
      for (const f of s.files || []) {
        try {
          fs.copyFileSync(f.bak, path.join(root, f.rel));
          process.stdout.write(`restored ${s.battery} case ${s.case}: ${f.rel}\n`);
          n++;
        } catch (err) {
          process.stdout.write(`COULD NOT RESTORE ${f.rel} from ${f.bak}: ${String((err && err.message) || err)}\n`);
          return 1;
        }
      }
      try { fs.unlinkSync(s.sentinel); } catch { /* nothing left to drop */ }
    }
    if (!n) process.stdout.write('nothing was standing\n');
    return 0;
  }

  if (what === 'check') { refuseIfCompromised(a || 'tree-guard', root); process.stdout.write('clean\n'); return 0; }

  process.stderr.write('usage: node tools/lib/tree-guard.mjs claim|release|restore|restore-all|check …\n');
  return 2;
}

if (process.argv[1] && process.argv[1].endsWith('tree-guard.mjs')) process.exit(cli(process.argv.slice(2)));
