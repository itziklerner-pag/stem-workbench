#!/usr/bin/env node
/**
 * transport — the YouTube view's preload and the two decisions behind it, over
 * ONE real launch against the LOCAL fake player.
 *
 * WHAT IT GATES. That the source view's preload reads the five transport values
 * and writes the three (plus the key-lock policy) and NOTHING ELSE; that a
 * content jump is the page's event and never our own correction; that the user's
 * speed claim goes through the VENDORED `speed.js` rather than a range re-typed
 * into this repository; that the page's own speed menu is yielded to rather than
 * fought; that an ad neutralises the rate and the ad-end edge puts it back; that
 * the keys the deck claims are taken and every other key is left to the page,
 * including inside a text field; that the page's autoplay-next toggle is taken,
 * put back, and REPORTED with a name when it cannot be; and that a single-page
 * navigation is noticed with the site's announcement and without it.
 *
 * WHAT IT DOES NOT GATE, stated so the absence is on the record:
 *   · REAL YOUTUBE. The fixture is ours and its markup is a reproduction, so
 *     nothing here can catch a YouTube-side change. That is the `youtube` step
 *     (docs/TESTING.md §7), manual only, and its absence is printed on every
 *     default run.
 *   · THE DECK. `src/main/deck-host.js` is what turns this transport into the
 *     six `DeckTransport` duties; this suite drives the transport directly, so a
 *     deck host that subscribed to nothing would still be green here. That is
 *     `engine-host`/`deck-host`'s job.
 *   · A SENDER THAT IS NOT THE SOURCE VIEW. `transport.js` drops a `'yt'`
 *     message from any other `WebContents` and counts it. No renderer we ship
 *     can put a message on that channel at all — none of the three preloads
 *     exposes it — so there is nothing to send the message that would prove the
 *     drop. `stats.strangers` is reported and asserted to be 0, which is the
 *     half that CAN be checked: nothing unexpected spoke.
 *   · THE AUDIO. This suite proves the transport drives an element. Whether the
 *     capture is audible and the speakers are silent is `capture-mute` (§8), and
 *     THIS SUITE CANNOT REPLACE IT.
 *
 * ---------------------------------------------------------------------------
 * HOW L1 IS PROVED — four instruments, none of them sufficient alone
 * ---------------------------------------------------------------------------
 * 1. THE WRITE SET IS ENUMERATED, not filtered. With comments and string
 *    literals stripped, the COMPLETE set of member assignments in
 *    `src/preload/youtube.cjs` is compared against the closed write set. A
 *    forbidden-token blacklist answers "is this one bad thing absent"; this
 *    answers "is anything else present", which is the question.
 * 2. THE READ SET IS AN ALLOW-LIST. Every property the file touches is compared
 *    against an enumerated list. `el.videoWidth` is red until somebody widens
 *    that list on purpose.
 * 3. IT ASKED FOR NOTHING. `main` records every request the source view's
 *    session made across the whole exercise; the fixture's media is a `blob:`
 *    built in the page, so a non-`file:`/`blob:` request is one this Host caused.
 * 4. THERE IS NO COMPUTED MEMBER ACCESS IN THE FILE AT ALL — no `x[…]`.
 *
 * (1) and (2) are static and see code that never ran. (3) is dynamic and sees
 * code no scanner could read — a `new Function` or a property name assembled at
 * run time. Neither half is the claim.
 *
 * (4) EXISTS BECAUSE AN AUDITOR WALKED PAST THE OTHER THREE AT ONCE. Two lines
 * in a private tree — `const leakUrl = () => (el ? el['currentSrc'] : null);`
 * and the same for `buffered` — and this suite printed `63 passed, 0 failed`
 * with the allow-list row reporting "44 distinct properties, all listed". (2)
 * needs a literal dot and a bracket has none; the blacklist runs AFTER string
 * literals have been blanked to `''`, so the name it hunts is gone; and (3)
 * watches the network, while reading a property is the FIRST step of a ripper
 * rather than the last. Three instruments, three different reasons, one blind
 * spot. The rule is "no computed access", not "no forbidden name inside one":
 * a blacklist inside the brackets loses to `el[['current','Src'].join('')]`.
 *
 * ---------------------------------------------------------------------------
 * S7a — THE LIVE EXPORT'S CONTIGUITY, HOST HALF (§4b and §11)
 * ---------------------------------------------------------------------------
 * A live export is ONE CONTIGUOUS REAL-TIME PASS from where it started
 * (`CONTEXT.md:311-314`); a seek ends it; RULING 29 makes a DROP end it the same
 * way; and autoplay-next is suspended for its duration or the next video records
 * into the same file.
 *
 * THE UNIT OWNS THE VOCABULARY AND NEVER THE DETECTION. `shared/stemcache.js`
 * upstream holds `PASS_END`, `recordingRefusal()` and `passEndNote()` — the four
 * members, what each SAYS to a user, and whether a pass may be delivered. This
 * Host owns WHEN a recording stops being contiguous, and nothing else. §4b is
 * where that boundary is asserted rather than described: the member names are
 * pinned against the vendored unit in both directions, and `src/` is scanned to
 * prove no sentence of ours exists anywhere.
 *
 * §4b ASSERTS ON THE FILE, NOT ON A FLAG. `pass.endedBy === 'seek'` is
 * bookkeeping about bookkeeping; what a user is left holding is the bytes, so
 * the seek and drop rows read a real file off disk and compare its CONTENT
 * against the frames that were fed before the boundary. Dropping the seek edge
 * has to show the file running past the seek, and it does.
 *
 * §11 IS THE SAME RULE OVER THE REAL PAGE, and it is there because issue #7 says
 * so in as many words: *"Assert the state the preload is actually in, both
 * times. A Host that writes the preference and never drives the view passes a
 * weaker assertion and ships the bug."* The pure rows cannot see a preference
 * that was recorded and never applied; the page's own `aria-checked` can.
 *
 * ---------------------------------------------------------------------------
 * WATCHED RED BY MUTATION — `tools/suites/transport-mutations.sh` (1-25),
 * `tools/suites/transport-s7a-mutations.sh` (S1-S19)
 * ---------------------------------------------------------------------------
 * Every row is in one of those scripts with the edit that produced it. Both run
 * the suite UNMUTATED FIRST and require green, refuse to continue if an anchor
 * moved, and require the named assertions on `FAIL` lines — a non-zero exit
 * proves something went red, not that the intended thing did. The S7a battery
 * additionally FAILS A CASE WHOSE RED SET DIFFERS IN EITHER DIRECTION: an
 * assertion going red under an unexpected mutation is as much a finding as one
 * going red under none, and an aggregate cannot see coverage migrating between
 * two mutations (INTEGRATION.md §25).
 *
 * S7a's table — the mutation, the file:line it was applied to, and the reds it
 * produced. MEASURED, not predicted: the sets below are what the battery
 * printed, and the battery FAILS a case whose set differs in either direction,
 * so a stale row here cannot survive a run. Anchors cut against this branch's
 * `feat(transport): decide when a live export stops being contiguous`, over
 * base `6c35580`. INTEGRATION.md §18/§26: re-run the battery and RE-DERIVE THIS
 * TABLE before any tag — the coordinates decay silently, and the red counts
 * decay with them.
 *
 *   case  where                        mutation                                    reds (§4b/n, §5.10/n)
 *   S1    drive.js:188                 a seek stops being a boundary               1, 3, 6, 7, 10
 *   S2    drive.js:185                 `emptied` stops being one                   1
 *   S3    drive.js:185                 the source ending is recorded as a seek     1, 3
 *   S4    drive.js:155                 a fifth member this Host made up            2, 3, 4
 *   S5    drive.js:374                 end() stops checking the name               2
 *   S6    drive.js:155                 `drop` is not a member at all               4, 8, 9, 10
 *   S7    drive.js:155                 a PASS_END sentence written into this Host  5
 *   S8    drive.js:359                 observe() no longer ends the pass           3, 6, 7, 10
 *   S9    drive.js:378                 end() does not close the sink               7
 *   S10   drive.js:348                 a drop does not end the pass                3, 8, 9, 10
 *   S11   drive.js:373                 endPass is LAST-writer-wins                 9
 *   S12   drive.js:348                 a drop is recorded as a seek                3, 8, 9, 10
 *   S13   drive.js:327                 the chunk is written but not let go         11
 *   S14   drive.js:280                 a refusal is returned but not recorded      12
 *   S15   drive.js:334                 a throwing write is swallowed               13
 *   S16   autonav.js:252   (live)      the recording's hold is ignored             14, 5.10/1, 5.10/2
 *   S17   drive.js:402     (live)      the hold is not released on abort           13, 15, 5.10/2
 *   S18   transport.js:216 (live)      the boundary never reaches the pass         5.10/3
 *   S19   transport.js:306 (live)      our own seek stops ending the pass          5.10/3, 5.10/4
 *
 * S1 IS THE ONE THE SLICE BRIEF NAMES, and its red is the file rather than a
 * flag: §4b/6 prints *"66150 frames of 44100 fed before the seek, values
 * [0.25,0.5,0.75]"* — the recording running past the seek, in the bytes.
 * S12 is the other: a drop worded like a seek, which is where two different
 * facts collapse into one sentence on a shared code path.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  filterDrive, DRIVE_FIELDS, speedReasonFor,
  PASS_END_NAMES, passEndFor, createPass, createPassSink,
} from '../../src/main/drive.js';
import { autonavPlan, resolveSuppress, PREFS_KEY, AUTONAV_TOGGLE_SEL, createAutonav } from '../../src/main/autonav.js';
import { SPEED_JS, SPEED_MIN, SPEED_MAX, SPEED_KEY_LOCK, resolveSpeed, speedPlan } from '../../src/main/speed.js';
import { BROWSER_LOCK, announceLock } from '../lib/locks.mjs';
import { refuseIfCompromised } from '../lib/tree-guard.mjs';

/**
 * `--static` RUNS SECTIONS 1-4 AND STOPS. Twenty-one of these assertions are
 * pure — a text read and a pure function — and cost 0.3 s; the rest need a
 * 70-second launch. `tools/suites/transport-mutations.sh` uses the flag for the
 * mutations whose red is static, which is what makes a battery of two dozen
 * cases finish in minutes rather than in half an hour.
 *
 * It is NOT a plan the runner ever uses. `tools/verify.mjs` runs this file with
 * no flag, so nothing in the gate is ever satisfied by the cheap half.
 */
const STATIC_ONLY = process.argv.includes('--static');

const ID = 'transport';
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
const PRELOAD = path.join(ROOT, 'src', 'preload', 'youtube.cjs');
const VENDOR = path.join(ROOT, 'vendor', 'stem-splitter-live', 'extension');

/** The shared browser mutex — one path, `tools/lib/locks.mjs`, never spelled here. */
const LOCK = BROWSER_LOCK;
/**
 * WHEN THE QUEUE ENDED AND THE LAUNCH BEGAN. Echoed inside the `flock`, so the
 * launch budget starts when the mutex is TAKEN rather than when the process is
 * spawned. `shell.mjs:209` and `dist-linux.mjs` already do this, and this suite
 * did not: its one 240 s budget covered the queue and the launch together, so on
 * a busy box it expired while WAITING and reported
 * `the app launches and the transport gate writes a report` as a FAILED
 * ASSERTION. Measured 2026-08-27 behind four other agents' windowed suites.
 *
 * That is the shape `docs/TESTING.md` §4 forbids in as many words —
 * *"contention is a SKIP, never a failed assertion"* — and it is worse than a
 * skip, because a red that depends on how many siblings are running is a red
 * nobody can reproduce. Two budgets: a long one for the queue, the real one for
 * the launch.
 */
const LOCK_MARK = '__WB_LOCKED__';
// One line, and only when this run has stepped out of the shared queue — a run
// holding the wrong mutex looks exactly like a run making progress. See tools/lib/locks.mjs.
announceLock();

// ------------------------------------------------------------- the harness
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

/** A REPORT FIELD IS NOT A PROMISE — `shell.mjs`'s rule, and its case 27. */
const A = (v) => (Array.isArray(v) ? v : []);
const O = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const N = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ==========================================================================
// 1. THE PIN — the clamp in force is the file the deck's ladder is pinned to
// ==========================================================================
/**
 * `extension/ui/embed-state.js` reads `new URL('../speed.js', import.meta.url)`
 * AS TEXT and asserts the deck's 29-rung ladder against that file's clamp
 * (`unit.json` `hostReads`). If this Host declared a range of its own, that pin
 * would go on passing about a file that is no longer the clamp — the ladder and
 * the guard rail free to part company in exactly the silence the pin exists to
 * prevent. So the claim is an IDENTITY claim, not a value comparison: the two
 * are the same file on disk, and the functions in force are that file's own.
 */
{
  const pinned = path.resolve(VENDOR, 'ui', '..', 'speed.js');
  ok('the clamp this Host executes IS the file the deck\'s ladder is pinned against  [entry point: src/main/speed.js SPEED_JS]',
    SPEED_JS === pinned && fs.existsSync(SPEED_JS),
    `${path.relative(ROOT, SPEED_JS)} === ui/../speed.js -> ${SPEED_JS === pinned}`);

  const text = fs.existsSync(SPEED_JS) ? fs.readFileSync(SPEED_JS, 'utf8') : '';
  /**
   * READ THE LITERAL, DO NOT MATCH THE VALUE'S SPELLING. `var SPEED_MAX = 2.0;`
   * and `String(2)` are the same number written two ways, and a regex built out
   * of the second cannot find the first — which is a red about nothing, in the
   * assertion whose whole job is to say the two are one file.
   */
  const declared = (k) => {
    const m = text.match(new RegExp(`var\\s+${k}\\s*=\\s*([^;]+);`));
    if (!m) return `unreadable: speed.js declares no ${k}`;
    const raw = m[1].trim();
    if (raw === 'true' || raw === 'false') return raw === 'true';
    return Number(raw);
  };
  const same = [['SPEED_MIN', SPEED_MIN], ['SPEED_MAX', SPEED_MAX], ['SPEED_KEY_LOCK', SPEED_KEY_LOCK]]
    .filter(([k, v]) => declared(k) === v);
  ok('...and the range and the key-lock in force are that file\'s own declarations, not a second copy  [entry point: speed.js]',
    same.length === 3 && SPEED_MIN === 0.5 && SPEED_MAX === 2 && SPEED_KEY_LOCK === true,
    `[${SPEED_MIN}, ${SPEED_MAX}] keyLock=${SPEED_KEY_LOCK} — speed.js declares `
    + `[${declared('SPEED_MIN')}, ${declared('SPEED_MAX')}] keyLock=${declared('SPEED_KEY_LOCK')}`);

  /**
   * AND NOBODY RE-TYPED IT. A `SPEED_MIN = 0.4` anywhere under `src/` is the
   * defect this whole arrangement exists to prevent, and it would be invisible
   * from a green run — the deck would still ungrey, the page would still take a
   * rate, and only the two ends of the ladder would disagree.
   */
  const ours = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|cjs|mjs)$/.test(e.name)) ours.push(p);
    }
  };
  walk(path.join(ROOT, 'src'));
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  // `\b` at BOTH ends: `SPEED_MIN_LOCAL = 0.5` is not a re-declaration of
  // `SPEED_MIN`, and a scan that called it one would be red about nothing.
  const redeclarers = ours.filter((f) => /\b(SPEED_MIN|SPEED_MAX|SPEED_EPS|SPEED_KEY_LOCK)\b\s*=[^=]/.test(strip(fs.readFileSync(f, 'utf8'))));
  ok('...and no file under src/ declares a speed range of its own  [entry point: the src/ tree]',
    redeclarers.length === 0,
    redeclarers.length ? `RE-DECLARED IN ${redeclarers.map((f) => path.relative(ROOT, f)).join(', ')}` : `${ours.length} files scanned, 0 re-declare`);

  /** `PREFS_KEY` is the one thing the autonav PORT can be pinned on. */
  const cfg = path.join(VENDOR, 'shared', 'config.js');
  const exported = fs.existsSync(cfg)
    ? ((fs.readFileSync(cfg, 'utf8').match(/export const PREFS_KEY\s*=\s*'([^']+)'/) || [])[1] ?? `unreadable: no PREFS_KEY in ${cfg}`)
    : `unreadable: ${cfg} is not there`;
  ok('the preferences key is ONE key: our literal is the one shared/config.js exports  [entry point: src/main/autonav.js PREFS_KEY]',
    PREFS_KEY === exported,
    `ours ${JSON.stringify(PREFS_KEY)} vs the unit's ${JSON.stringify(exported)}`);
}

// ==========================================================================
// 2. THE EVENT LISTS — pinned against content.js, not copied from it
// ==========================================================================
/**
 * The preload's `VIDEO_EVENTS` and `JUMP_EVENTS` are the ONE thing in it that
 * could be a hand-maintained copy of the reference Host's, and a Host following
 * a shorter list keeps following an element the page has already thrown away.
 * `content.js` travels with the vendored copy, so the two can be compared.
 *
 * A FILE THAT CANNOT BE READ IS A FAILED COMPARISON AND NEVER AN ABSENCE —
 * `autonav.js`'s own shape for its `PREFS_KEY` pin: the catch produces a value
 * that cannot equal a list, so a missing `content.js` is red here rather than
 * quietly skipped.
 */
{
  const arrayOf = (text, name) => {
    const m = text.match(new RegExp(`const ${name}\\s*=\\s*\\[([^\\]]*)\\]`));
    return m ? m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : [`unreadable: no ${name}`];
  };
  const cj = path.join(VENDOR, 'content.js');
  const theirs = fs.existsSync(cj) ? fs.readFileSync(cj, 'utf8') : `unreadable: ${cj} is not there`;
  const mine = fs.readFileSync(PRELOAD, 'utf8');
  for (const name of ['VIDEO_EVENTS', 'JUMP_EVENTS']) {
    const a = arrayOf(theirs, name); const b = arrayOf(mine, name);
    ok(`the preload follows the same ${name} the reference Host does  [entry point: src/preload/youtube.cjs]`,
      a.length > 1 && eq(a, b), `content.js ${JSON.stringify(a)} vs preload ${JSON.stringify(b)}`);
  }
  ok('...and `ratechange` is in one list and not the other — a rate change is not a content jump  [entry point: content.js JUMP_EVENTS]',
    arrayOf(theirs, 'VIDEO_EVENTS').includes('ratechange') && !arrayOf(theirs, 'JUMP_EVENTS').includes('ratechange')
    && arrayOf(mine, 'VIDEO_EVENTS').includes('ratechange') && !arrayOf(mine, 'JUMP_EVENTS').includes('ratechange'));
}

// ==========================================================================
// 3. L1, STATICALLY — the write set enumerated, the read set allow-listed
// ==========================================================================
/**
 * Comments and string literals are stripped first, because both are places a
 * forbidden name legitimately appears — this file's own header says `src`,
 * `currentSrc` and `captureStream` out loud, and a scan that could not tell a
 * sentence from a member access would be a scan nobody could keep green.
 */
function strippedPreload() {
  let s = fs.readFileSync(PRELOAD, 'utf8');
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ');
  s = s.replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1 ');
  s = s.replace(/'(?:[^'\\\n]|\\.)*'/g, "''").replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
  s = s.replace(/`(?:[^`\\]|\\.)*`/g, '``');
  return s;
}

{
  const src = strippedPreload();

  /**
   * EVERY MEMBER ASSIGNMENT IN THE FILE. `x.prop =`, `x.prop +=`, `x.prop++`.
   * Not "no forbidden write" — the COMPLETE set, compared with the closed one.
   */
  const written = new Set();
  for (const m of src.matchAll(/\.\s*([A-Za-z_$][\w$]*)\s*(?:=[^=>]|\+=|-=|\*=|\/=|\+\+|--)/g)) written.add(m[1]);
  const allowedWrites = new Set([...DRIVE_FIELDS, 'preservesPitch']);
  const extraWrites = [...written].filter((k) => !allowedWrites.has(k));
  ok('the preload\'s COMPLETE member-write set is the closed write set plus the key-lock policy  [entry point: src/preload/youtube.cjs]',
    extraWrites.length === 0 && written.size > 0,
    extraWrites.length ? `WRITES ${extraWrites.join(', ')} — outside {${[...allowedWrites].join(', ')}}`
      : `writes {${[...written].sort().join(', ')}}`);

  ok('...and it really does write all four, so the set above is not empty by accident',
    [...allowedWrites].every((k) => written.has(k)),
    `${[...allowedWrites].filter((k) => written.has(k)).length}/${allowedWrites.size}`);

  /**
   * EVERY PROPERTY THE FILE TOUCHES, against an enumerated list. This is the
   * assertion that is meant to be annoying: a new member access is red until
   * somebody adds it here on purpose, which is the only mechanism that makes
   * "it reads five values off the element" a claim rather than a comment.
   */
  const ALLOWED_READS = new Set([
    // the element — five transport reads, one policy property, three methods
    'paused', 'ended', 'currentTime', 'duration', 'playbackRate', 'preservesPitch', 'muted',
    'pause', 'addEventListener', 'removeEventListener',
    // the page furniture the Host is allowed to reach for
    'querySelector', 'getAttribute', 'click', 'tagName', 'isContentEditable',
    // the event
    'type', 'target', 'code', 'key', 'shiftKey', 'altKey', 'metaKey', 'ctrlKey', 'repeat',
    'preventDefault', 'stopPropagation',
    // our own objects: the config from main, the command from main, the key set
    'adSel', 'autonavSel', 'cancelSel', 'speedEps', 'keyLock',
    'c', 'act', 'on', 'armed', 'keys', 'seekTo', 'has',
    // plain JS
    'now', 'abs', 'isFinite', 'isArray', 'send', 'warn', 'message',
  ]);
  const touched = new Set();
  // `(?<!\.)` so `...extra` is a SPREAD and not a member access. Without it the
  // allow-list would have to carry the name of every object this file spreads,
  // which is a list about syntax rather than about what the page is touched with.
  for (const m of src.matchAll(/(?<!\.)\.\s*([A-Za-z_$][\w$]*)/g)) touched.add(m[1]);
  const strangers = [...touched].filter((k) => !ALLOWED_READS.has(k) && !allowedWrites.has(k));
  ok('...and every property it touches at all is on the enumerated allow-list  [entry point: src/preload/youtube.cjs]',
    strangers.length === 0,
    strangers.length ? `NOT ALLOW-LISTED: ${strangers.join(', ')}` : `${touched.size} distinct properties, all listed`);

  /**
   * THE BLACKLIST TOO, and it is not redundant with the allow-list above: it is
   * what a reviewer reads, and it names the failure in the words `CONTRIBUTING.md`
   * L1 uses. It also covers BARE identifiers, which a member scan cannot see —
   * `fetch(...)` and `new Blob(...)` have no dot in front of them.
   */
  const FORBIDDEN = ['src', 'currentSrc', 'buffered', 'srcObject', 'captureStream', 'mozCaptureStream',
    'getDisplayMedia', 'getUserMedia', 'mediaDevices', 'MediaSource', 'Blob', 'createObjectURL',
    'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'navigator',
    'eval', 'Function', 'import', 'videoplayback', 'ytInitialPlayerResponse', 'getVideoData'];
  const found = FORBIDDEN.filter((k) => new RegExp(`\\b${k}\\b`).test(src));
  ok('...and none of the names L1 forbids appears in it at all  [entry point: CONTRIBUTING.md L1]',
    found.length === 0,
    found.length ? `FOUND ${found.join(', ')}` : `${FORBIDDEN.length} forbidden names, ${src.length} bytes scanned (comments and string literals stripped)`);

  /**
   * THE SCANNER CAN LOSE. A stripper that ate the whole file would report zero
   * of everything and every assertion above would be vacuously green — the exact
   * shape `AGENTS.md` is a record of. So: the stripped text must still contain
   * the code, and it must NOT contain the header's own prose.
   */
  ok('...and the scanner is looking at code rather than at nothing  [entry point: strippedPreload()]',
    src.length > 3000 && /driveRate/.test(src) && !/ripper/.test(src) && !/CONTRIBUTING/.test(src),
    `${src.length} bytes after stripping, driveRate present, the header's prose gone`);

  ok('`play()` never appears in the preload — starting is the user\'s, always  [entry point: src/preload/youtube.cjs]',
    !/\.\s*play\s*\(/.test(src) && /\.\s*pause\s*\(/.test(src),
    'pause() on `ended` under suppression is the only transport call it makes');

  /**
   * =======================================================================
   * ...AND NOT ONE OF THE THREE INSTRUMENTS ABOVE COULD SEE `el['currentSrc']`
   * =======================================================================
   * An auditor put two lines into this file in a private tree —
   * `const leakUrl = () => (el ? el['currentSrc'] : null);` and the same for
   * `buffered` — and watched `transport: 63 passed, 0 failed`, with the
   * allow-list row cheerfully reporting *"44 distinct properties, all listed"*.
   *
   * ALL THREE INSTRUMENTS MISS IT, for three different reasons, and that is
   * why a fourth is needed rather than a wider regex on one of them:
   *   · the ALLOW-LIST scans for a literal dot, and a computed read has none;
   *   · the BLACKLIST runs after `strippedPreload()` has replaced every string
   *     literal with `''`, so the name it is looking for is gone;
   *   · the RUNTIME witness watches the network, and reading a property makes
   *     no request — it is the FIRST step of a ripper, not the last.
   *
   * This is the file that runs inside youtube.com's page. `CONTRIBUTING.md` L1
   * is about what it may touch, and `AGENTS.md` forbids an estimator that
   * saturates before the claim range begins.
   *
   * THE RULE IS "NO COMPUTED MEMBER ACCESS AT ALL", not "no forbidden name in
   * one". A blacklist inside brackets would be the same losing shape one level
   * in: `el[['current', 'Src'].join('')]` defeats it, and the preload has no
   * legitimate use for the syntax — it is 528 lines with array literals and no
   * indexing. So the syntax is refused outright and a future need for it is a
   * conversation, which is the cost this assertion is meant to have.
   */
  const KEYWORDS = new Set(['of', 'in', 'return', 'typeof', 'new', 'case', 'do', 'else', 'yield',
    'await', 'delete', 'void', 'instanceof', 'throw']);
  const computed = [];
  for (const m of src.matchAll(/(?:([A-Za-z_$][\w$]*)|(\))|(\]))\s*\[/g)) {
    if (m[1] && KEYWORDS.has(m[1])) continue;            // `of [0, 300, 900]` is an array literal
    computed.push(`${(m[1] || m[2] || m[3])}[ …`);
  }
  ok('...and it contains NO COMPUTED MEMBER ACCESS at all, so the allow-list above cannot be walked around with a string  '
    + '[entry point: src/preload/youtube.cjs, the same stripped source]',
    computed.length === 0,
    computed.length ? `FOUND ${computed.length}: ${computed.slice(0, 6).join(' ')}`
      : `0 of the form \`x[…]\`, \`)[…]\` or \`][…]\` — the three dot-blind instruments above are not the only ones now`);
}

// ==========================================================================
// 4. THE PURE DECISIONS — no launch, no display, no mutex
// ==========================================================================
{
  ok('drive filters to the closed write set and drops everything else  [entry point: src/main/drive.js filterDrive()]',
    eq(filterDrive({ muted: true, playbackRate: 1.5, currentTime: 12, src: 'https://x/videoplayback', srcObject: {}, volume: 0.1, loop: false }),
      { muted: true, playbackRate: 1.5, seekTo: 12 }),
    JSON.stringify(filterDrive({ muted: true, playbackRate: 1.5, currentTime: 12, src: 'x', volume: 0.1 })));

  ok('...and a field of the wrong type is DROPPED, never coerced  [entry point: filterDrive()]',
    eq(filterDrive({ muted: 'true', playbackRate: '1.5', currentTime: NaN }), {})
    && eq(filterDrive({ playbackRate: Infinity }), {}) && eq(filterDrive(null), {}) && eq(filterDrive(undefined), {}),
    'strings, NaN, Infinity, null and undefined all produce {}');

  ok('the event -> speed reason mapping is speed.js\'s entry-point rule  [entry point: src/main/drive.js speedReasonFor()]',
    speedReasonFor('loadedmetadata') === 'remount' && speedReasonFor('ratechange') === 'ratechange'
    && speedReasonFor('emptied') === 'poll' && speedReasonFor('timeupdate') === 'poll' && speedReasonFor(undefined) === 'poll',
    'loadedmetadata->remount, ratechange->ratechange, emptied->poll');

  /**
   * THE RE-ASSERT AND ITS NEGATIVE CONTROL, over the VENDORED `speedPlan`: the
   * SAME want and the SAME current produce a write or a yield depending only on
   * which event woke us. If the two ever agree, the entry-point rule has
   * collapsed and no assertion on a single reason can see it.
   */
  const P = (o) => speedPlan({ want: null, current: 1, hasMedia: true, adShowing: false, finding: false, reason: 'poll', ...o });
  ok('the same want and current WRITE on a remount and YIELD on a ratechange  [entry point: the vendored speed.js speedPlan()]',
    P({ want: 1.5, current: 1, reason: 'remount' }).act === 'write' && P({ want: 1.5, current: 1, reason: 'ratechange' }).act === 'yield'
    && speedReasonFor('loadedmetadata') === 'remount' && speedReasonFor('ratechange') === 'ratechange',
    'write vs yield, decided by the reason our mapping produces');

  ok('a rate above the vendored ceiling is clamped and the clamp is reported  [entry point: the vendored speed.js resolveSpeed()]',
    eq(resolveSpeed(3), { ok: true, rate: SPEED_MAX, why: 'clamped-high' })
    && eq(resolveSpeed('1.5'), { ok: false, rate: null, why: 'unreadable' })
    && eq(resolveSpeed(null), { ok: true, rate: null, why: 'release' })
    && eq(resolveSpeed(undefined), { ok: false, rate: null, why: 'unreadable' }),
    'a MISSING rate is refused, not read as a release');

  ok('autoplay-next: absent means SUPPRESS, and only the literal true hands it back  [entry point: src/main/autonav.js resolveSuppress()]',
    resolveSuppress(undefined) === true && resolveSuppress({}) === true && resolveSuppress(null) === true
    && resolveSuppress({ autoplayNext: false }) === true && resolveSuppress({ autoplayNext: 'true' }) === true
    && resolveSuppress({ autoplayNext: true }) === false);

  ok('...and every way the toggle can fail produces a NAMED state, never silence  [entry point: src/main/autonav.js autonavPlan()]',
    autonavPlan({ suppress: true, engaged: true, found: false, checked: null, original: null }).state === 'missing'
    && autonavPlan({ suppress: true, engaged: true, found: true, checked: null, original: null }).state === 'missing'
    && autonavPlan({ suppress: false, engaged: false, found: false, checked: null, original: true }).state === 'lost'
    && autonavPlan({ suppress: false, engaged: false, found: false, checked: null, original: true }).forget === false
    && autonavPlan(undefined).state === 'idle',
    'missing / unreadable-is-missing / lost keeps the record / no state at all is idle');

  ok('...and the original is recorded ONCE, so a re-render cannot save OUR value as theirs  [entry point: autonavPlan()]',
    autonavPlan({ suppress: true, engaged: true, found: true, checked: true, original: null }).remember === true
    && autonavPlan({ suppress: true, engaged: true, found: true, checked: true, original: true }).remember === false);

  ok('the toggle selector matches on the ARIA contract, not on the class alone  [entry point: src/main/autonav.js AUTONAV_TOGGLE_SEL]',
    AUTONAV_TOGGLE_SEL.includes('[aria-checked]') && AUTONAV_TOGGLE_SEL.includes('autonav-toggle')
    && !/button\.ytp-autonav-toggle-button/.test(AUTONAV_TOGGLE_SEL),
    'the element carrying the state is a <div> inside the button — measured 2026-08-15');
}

// ==========================================================================
// 4b. THE CONTIGUOUS PASS — S7a. No launch, and the claims are on a REAL FILE
// ==========================================================================
{
  const PASSDIR = path.join(ROOT, 'out', 'transport-pass');
  fs.rmSync(PASSDIR, { recursive: true, force: true });
  fs.mkdirSync(PASSDIR, { recursive: true });
  const SR = 44100;
  /** One chunk of interleaved stereo 32f, every sample the same value, so the FILE says which chunk. */
  const chunk = (v, secs = 1) => {
    const frames = Math.round(SR * secs);
    return { samples: new Float32Array(frames * 2).fill(v), frames };
  };
  /** Every distinct value in a pass file, in first-seen order, and its frame count. */
  const readPass = (file) => {
    if (!fs.existsSync(file)) return { there: false, frames: 0, values: [] };
    const b = fs.readFileSync(file);
    const f = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
    const values = [];
    for (const x of f) if (!values.includes(x)) values.push(x);
    return { there: true, frames: f.length / 2, bytes: b.byteLength, values };
  };
  const newPass = (name, hold) => {
    const file = path.join(PASSDIR, `${name}.f32`);
    return { file, pass: createPass({ sink: createPassSink({ path: file }), hold }) };
  };

  // ---------------------------------------------------------- the boundary
  ok('the observations that END a contiguous pass are the unit\'s members, and nothing else is a boundary  '
    + '[entry point: src/main/drive.js passEndFor()]',
    passEndFor({ seeking: true }) === 'seek' && passEndFor({ event: 'emptied' }) === 'seek'
    && passEndFor({ event: 'ended' }) === 'ended'
    && ['play', 'pause', 'timeupdate', 'ratechange', 'loadedmetadata', 'tick', 'seeked', 'drive']
      .every((e) => passEndFor({ event: e }) === null)
    // A member name off `Object.prototype` is a reason the unit has no wording
    // for, arriving from the one direction nobody tests.
    && passEndFor({ event: 'constructor' }) === null && passEndFor({ event: 'toString' }) === null
    && passEndFor(null) === null && passEndFor(undefined) === null && passEndFor({}) === null,
    'seeking->seek, emptied->seek, ended->ended; 8 other events, a prototype key, and no state at all -> null');

  ok('...and a reason the unit has no wording for is REFUSED, so a fifth member cannot be recorded  '
    + '[entry point: src/main/drive.js createPass().end()]',
    (() => {
      const { pass } = newPass('unnamed');
      pass.start();
      const bad = ['boredom', 'Stopped', 'STOP', '', null, undefined, 0, {}]
        .map((r) => pass.end(r));
      return bad.every((r) => r === 'unnamed-reason') && pass.recording() === true
        && pass.record().endedBy === null && pass.end('stopped') === null;
    })(),
    '8 invented reasons refused with `unnamed-reason`, the pass still open, and `stopped` then accepted');

  ok('...and all four of the unit\'s members are REACHABLE from this Host, so the list has no dead entry  '
    + '[entry point: src/main/drive.js PASS_END_NAMES]',
    (() => {
      const reached = new Set();
      for (const [name, drive] of [
        ['seek', (p) => p.observe({ seeking: true })],
        ['ended', (p) => p.observe({ event: 'ended' })],
        ['drop', (p) => p.drop(1)],
        ['stopped', (p) => p.end('stopped')],
      ]) {
        const { pass } = newPass(`reach-${name}`);
        pass.start(); pass.chunk(chunk(0.1, 0.05)); drive(pass);
        if (pass.record().endedBy === name) reached.add(name);
      }
      return reached.size === PASS_END_NAMES.length
        && PASS_END_NAMES.every((n) => reached.has(n));
    })(),
    `${PASS_END_NAMES.join(', ')} — each driven to, and each recorded`);

  /**
   * THE PIN, AND IT IS TWO-WAY. `PASS_END` is upstream's and arrives with the
   * tag that carries U7; the pinned tag has no pass-end vocabulary at all. So
   * this row asserts the ABSENCE — and goes RED the day the pin bumps, which is
   * the day these four names must become an equality pin against the unit's own
   * keys instead of a list this Host wrote down. A copy nobody re-checks is what
   * `PREFS_KEY` one file over exists to prevent, and the same trap is here.
   */
  {
    const cache = path.join(VENDOR, 'shared', 'stemcache.js');
    const text = fs.existsSync(cache) ? fs.readFileSync(cache, 'utf8') : `unreadable: ${cache} is not there`;
    const exported = /export const PASS_END\s*=/.test(text);
    ok('the pinned unit exports NO pass-end vocabulary yet, so this Host\'s four member names are UNPINNED and say so  '
      + '[entry point: vendor/.../shared/stemcache.js vs src/main/drive.js PASS_END_NAMES]',
      exported === false && text.length > 1000
      && PASS_END_NAMES.length === 4 && Object.isFrozen(PASS_END_NAMES),
      exported
        ? 'PASS_END IS NOW VENDORED — replace this row with `PASS_END_NAMES equals Object.keys(PASS_END)`, both ways'
        : `${path.relative(ROOT, cache)} (${text.length} bytes) exports no PASS_END at the pinned tag; `
          + `ours: ${PASS_END_NAMES.join(', ')} — upstream phase4/u7-live-recording`);
  }

  /**
   * AND NOBODY WROTE THE WORDS DOWN HERE. `PASS_END`'s values are what a user is
   * TOLD, and `passEndNote()` is the one place a sentence is built. A second copy
   * under `src/` is a Host that decides what a seek means, which is exactly the
   * half the unit reserved — and it would be invisible from a green run.
   */
  {
    const ours = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const q = path.join(dir, e.name);
        if (e.isDirectory()) walk(q);
        else if (/\.(js|cjs|mjs)$/.test(e.name)) ours.push(q);
      }
    };
    walk(path.join(ROOT, 'src'));
    const strip = (x) => x.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    const PHRASES = ['you stopped the recording', 'the source reached its end',
      'the playhead moved', 'could not keep up', 'dropped chunk', 's recorded'];
    const guilty = ours
      .map((f) => [f, strip(fs.readFileSync(f, 'utf8'))])
      .filter(([, x]) => PHRASES.some((ph) => x.includes(ph)))
      .map(([f]) => path.relative(ROOT, f));
    ok('...and no file under src/ spells a pass-end SENTENCE of its own — the wording is the unit\'s  '
      + '[entry point: the src/ tree, comments stripped]',
      guilty.length === 0,
      guilty.length ? `A SECOND WORDING IN ${guilty.join(', ')}`
        : `${ours.length} files scanned for ${PHRASES.length} phrases, 0 hits — passEndNote() builds the sentence`);
  }

  // ------------------------------------------------- the seek, ON THE FILE
  /**
   * THE HEADLINE, AND IT IS ASSERTED ON THE BYTES. Two chunks go in before the
   * seek and one is offered after it. A flag saying `endedBy: 'seek'` would be
   * satisfied by a machine that recorded the boundary and went on writing; the
   * FILE cannot be.
   */
  {
    const { file, pass } = newPass('seek');
    pass.start();
    pass.chunk(chunk(0.25, 0.5));
    pass.chunk(chunk(0.5, 0.5));
    const ended = pass.observe({ seeking: true });
    const after = pass.chunk(chunk(0.75, 0.5));
    const f = readPass(file);
    ok('a SEEK ends the contiguous pass, and the file stops where the seek did  '
      + '[entry point: src/main/drive.js createPass().observe()]',
      ended === 'seek' && after === 'not-recording'
      && f.there && f.frames === SR && eq(f.values, [0.25, 0.5]),
      `${f.frames} frames of ${SR} fed before the seek, values ${JSON.stringify(f.values)} — `
      + `the 0.75 chunk offered after it was ${JSON.stringify(after)}`);

    ok('...and what was captured stays EXPORTABLE — the file is closed, complete, and byte-identical to what was fed  '
      + '[entry point: createPass().end() -> createPassSink().close()]',
      pass.record().endedBy === 'seek' && pass.record().frames === SR && pass.record().drops === 0
      && O(pass.file()).written === true && N(O(pass.file()).bytes) === SR * 2 * 4
      && f.bytes === SR * 2 * 4,
      `record ${JSON.stringify(pass.record())}, sink closed at ${N(O(pass.file()).bytes)} bytes, `
      + `file ${f.bytes} bytes = ${SR} frames x 2ch x 4B — ending is not discarding`);
  }

  // ------------------------------------------------- the drop, RULING 29
  {
    const { file, pass } = newPass('drop');
    pass.start();
    pass.chunk(chunk(0.25, 0.5));
    const ended = pass.drop(2);
    const after = pass.chunk(chunk(0.75, 0.5));
    const f = readPass(file);
    ok('a DROP ends the pass exactly as a seek does, so no delivered file contains a GAP  '
      + '[entry point: src/main/drive.js createPass().drop(), RULING 29]',
      ended === null && after === 'not-recording'
      && pass.record().endedBy === 'drop' && pass.record().drops === 2
      && f.there && f.frames === SR / 2 && eq(f.values, [0.25]),
      `${f.frames} frames, values ${JSON.stringify(f.values)}, drops ${pass.record().drops} — `
      + 'a boundary, not a tolerance: the file is shorter AND correct');

    ok('...and the reason is FIRST-WRITER-WINS, so the stop() that follows a drop does not overwrite it  '
      + '[entry point: createPass().end()]',
      pass.end('stopped') === 'already-ended' && pass.record().endedBy === 'drop'
      && pass.record().drops === 2 && readPass(file).frames === SR / 2,
      'stop() after drop -> `already-ended`, endedBy stays `drop`, and the file is untouched');
  }

  ok('a seek and a drop stay DISTINGUISHABLE through the one shared end() — they are different facts to a user  '
    + '[entry point: createPass().end()]',
    (() => {
      const a = newPass('distinct-seek'); a.pass.start(); a.pass.chunk(chunk(0.1, 0.05));
      a.pass.observe({ seeking: true });
      const b = newPass('distinct-drop'); b.pass.start(); b.pass.chunk(chunk(0.1, 0.05));
      b.pass.drop(3);
      const ra = a.pass.record(); const rb = b.pass.record();
      // Same path, same frames, same file length. ONLY the member may differ,
      // and it must — a shared code path is where the difference gets lost.
      return ra.endedBy === 'seek' && rb.endedBy === 'drop' && ra.endedBy !== rb.endedBy
        && ra.frames === rb.frames && ra.drops === 0 && rb.drops === 3
        && new Set(PASS_END_NAMES).size === PASS_END_NAMES.length;
    })(),
    'two passes, identical in every field the unit reads except the one that says what happened');

  /**
   * RAM DOES NOT GROW WITH DURATION, CARRIED BY A COUNT. Issue #7: assert the
   * NUMBER OF BUFFERS RETAINED at 10 s and at 60 s and require it constant, and
   * never assert a memory reading — a memory reading measures the machine.
   */
  {
    const { file, pass } = newPass('ram');
    pass.start();
    let at10 = null; let at60 = null;
    for (let sec = 1; sec <= 60; sec++) {
      pass.chunk(chunk(0.01 * sec, 1));
      if (sec === 10) at10 = pass.retained();
      if (sec === 60) at60 = pass.retained();
    }
    pass.end('stopped');
    const f = readPass(file);
    ok('the buffers RETAINED after 60 s of recording is the number retained after 10 s  '
      + '[entry point: src/main/drive.js createPass().retained()]',
      at10 === at60 && at10 === 0 && pass.chunks() === 60 && pass.record().frames === SR * 60
      && f.frames === SR * 60,
      `retained ${at10} at 10 s and ${at60} at 60 s over ${pass.chunks()} chunks, `
      + `while the file grew to ${f.frames} frames (${f.bytes} bytes) — the count is the claim, never a memory reading`);
  }

  ok('every way a recording can refuse produces a NAMED code and a count, never a silent early return  '
    + '[entry point: src/main/drive.js createPass().start()/chunk()]',
    (() => {
      const { pass } = newPass('refusals');
      const seen = [];
      seen.push(pass.chunk(chunk(0.1, 0.05)));             // not started yet
      seen.push(pass.start());                             // null — it opened
      seen.push(pass.start());                             // already recording
      seen.push(pass.chunk({ samples: [1, 2], frames: 4 })); // not a Float32Array
      seen.push(pass.chunk({ samples: new Float32Array(2), frames: 0 }));
      seen.push(pass.end('stopped'));                      // null — it ended
      seen.push(pass.start());                             // a pass ends once
      const noSink = createPass({});
      seen.push(noSink.start());
      return eq(seen, ['not-recording', null, 'already-recording', 'unreadable-chunk',
        'unreadable-chunk', null, 'pass-already-ended', 'no-sink'])
        && pass.refusals() === 5 && eq(pass.stats.refusals,
          ['not-recording', 'already-recording', 'unreadable-chunk', 'unreadable-chunk', 'pass-already-ended']);
    })(),
    'not-recording / already-recording / unreadable-chunk x2 / pass-already-ended / no-sink, all counted');

  /**
   * THE FAILING PATH, and issue #7 asks for it by name: a write that throws
   * halfway must not leave half a recording that reads like a whole one.
   */
  ok('a write that THROWS aborts the pass and removes the partial file — half a recording is not a short one  '
    + '[entry point: createPass().chunk() -> createPassSink().abort()]',
    (() => {
      const file = path.join(PASSDIR, 'thrower.f32');
      let n = 0;
      const sink = {
        write() { n++; if (n === 2) throw new Error('disk full'); fs.appendFileSync(file, 'x'); },
        close() { return { file, bytes: 1, written: true }; },
        abort() { fs.rmSync(file, { force: true }); return { file, bytes: 0, written: false }; },
      };
      const holds = [];
      const pass = createPass({ sink, hold: (on) => holds.push(on) });
      pass.start();
      const first = pass.chunk(chunk(0.1, 0.05));
      const boom = pass.chunk(chunk(0.2, 0.05));
      return first === null && boom === 'write-failed' && !fs.existsSync(file)
        && pass.recording() === false && pass.record().endedBy === null
        && eq(holds, [true, false]);
    })(),
    'the throw aborts, the file is unlinked, `endedBy` stays null so nothing claims a reason, and the hold is released');

  // -------------------------------------------------- autoplay-next, held
  /**
   * THE SUSPENSION IS LAYERED OVER THE USER'S PREFERENCE, NEVER WRITTEN INTO IT.
   * The control is the second half: the user turns autoplay ON mid-recording, and
   * what comes back at the end must be THEIR value, not the one we captured when
   * the recording started.
   */
  ok('autoplay-next is HELD for the length of a recording, and the USER\'S own value is what comes back  '
    + '[entry point: src/main/autonav.js holdSuppress()]',
    (() => {
      const asked = [];
      const nav = createAutonav({ ask: (c) => asked.push(c.act), report: () => {} });
      nav.reassert(true, { look: false });
      nav.setPrefs({ autoplayNext: true });                 // the user wants autoplay ON
      const before = [nav.suppressed(), nav.suppressing(), nav.heldNow()];
      nav.holdSuppress(true);
      const during = [nav.suppressed(), nav.suppressing(), nav.heldNow()];
      nav.setPrefs({ autoplayNext: false });                // they change their mind mid-recording
      const midway = [nav.suppressed(), nav.suppressing()];
      nav.holdSuppress(false);
      const after = [nav.suppressed(), nav.suppressing(), nav.heldNow()];
      return eq(before, [false, false, false]) && eq(during, [false, true, true])
        && eq(midway, [true, true]) && eq(after, [true, true, false]);
    })(),
    'user ON -> not suppressed; recording -> suppressed with the preference untouched; '
    + 'user changes to OFF mid-recording -> that is what is in force when the hold lifts');

  ok('...and an ABORTED recording releases the hold too — the path this obligation is normally shipped dead on  '
    + '[entry point: src/main/drive.js createPass().abort()]',
    (() => {
      const holds = [];
      const { file, pass } = newPass('abort', (on) => holds.push(on));
      pass.start();
      pass.chunk(chunk(0.4, 0.25));
      const during = pass.holding();
      pass.abort('gate');
      return during === true && pass.holding() === false && eq(holds, [true, false])
        && !fs.existsSync(file) && pass.recording() === false && pass.stats.aborts === 1;
    })(),
    'hold true -> abort -> hold false, and the partial file is gone with it');
}

// ==========================================================================
// 5. ONE REAL LAUNCH
// ==========================================================================
if (STATIC_ONLY) { console.log('(--static: sections 1-4 only; the launch was skipped)'); done(); }

const electron = path.join(ROOT, 'node_modules', '.bin', 'electron');
if (!fs.existsSync(electron)) skip('electron is not installed — npm i');
if (!hasBin('xvfb-run')) skip('xvfb-run is not on PATH and this box has no DISPLAY');
if (!hasBin('flock')) skip('flock is not on PATH — the shared browser mutex cannot be taken');

/**
 * ===========================================================================
 * THE BLOCK GUARD — a throw anywhere below is a NAMED RED, not a dead suite.
 * ===========================================================================
 * Fixing one reference is not the same as fixing the class. The `lastLine`
 * temporal dead zone at the top of this section is repaired at its declaration,
 * and that repairs THAT reference; it does nothing about the next unguarded one
 * on a failure path. And this section's failure paths are demonstrably
 * reachable — a transient launch failure has already turned a real red here into
 * a `ReferenceError` during a full-gate run.
 *
 * Everything below reads fields off a report a CHILD PROCESS wrote. A shape
 * nobody anticipated throws on first use, and one throw at top level in an ES
 * module takes the whole file's verdict with it: no `FAIL` line, no summary
 * line, and a transcript that simply stops. That is strictly less informative
 * than the assertion it replaced.
 *
 * WHAT THIS BUYS, AND WHAT IT DOES NOT. It converts a crash into a named red
 * with a cause. **It does not recover the assertions after the throw** — the run
 * still stops there, and this suite still reports fewer than its 64. Do not read
 * a guarded suite as fully covered.
 *
 * The run is RED either way; what changes is that the CAUSE is named. What does
 * NOT happen is the count being checked — measured, not assumed: the runner's
 * exact `assertions` pin is consulted only on `code === 0`, so a guarded throw
 * takes `classify()`'s FAIL branch first and 64 is never compared to anything.
 * And the guard's own red OCCUPIES A SLOT, so the watched-red run printed
 * `transport: 63 passed, 1 failed` — which totals 64 and looks complete while one
 * assertion never ran. Read a guarded red as "the suite stopped here", never as a
 * count. docs/TESTING.md §5c carries the same warning where a reader will meet
 * it.
 *
 * NOTHING IS RESTORED IN A `finally` HERE, deliberately, and that is worth
 * saying rather than leaving as an absence: this section installs nothing on the
 * tree and holds no lock of its own — `run()` awaits the child to close, and the
 * mutex is inside the `flock` this section spawns, so it is released by that
 * process exiting. A guard that pretended to restore something would be an
 * assertion about state nobody is keeping.
 */
try {

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const fixture = pathToFileURL(path.join(ROOT, 'tools', 'fixture', 'player.html')).href;
const launch = await run('flock', [LOCK, '-c',
  `echo ${LOCK_MARK}; `
  + `xvfb-run -a -s '-screen 0 1280x1024x24' ${sh(electron)} . --gate=${sh(OUT)} --gate-probe=transport `
  + `--source-url=${sh(fixture)} --user-data=${sh(path.join(OUT, 'userdata'))}`],
{ cwd: ROOT, timeoutMs: 240000, queueMs: 900000, startOn: LOCK_MARK });
fs.writeFileSync(path.join(OUT, 'launch.log'), launch.out);

let R = null;
try { R = JSON.parse(fs.readFileSync(path.join(OUT, 'report.json'), 'utf8')); } catch { /* asserted below */ }
ok('the app launches and the transport gate writes a report  [entry point: `electron . --gate-probe=transport`]',
  R !== null && R.probe === 'transport',
  R ? `exit ${launch.code}, ${Object.keys(R).length} sections` : `exit ${launch.code} — last line: ${lastLine(launch.out)}`);
if (!R) done();

/**
 * THE INSTRUMENT CHECK, FIRST. "Nothing happened" is also what a tap that never
 * attached looks like, and the first run of this gate produced exactly that: a
 * full report in which every channel was empty because `subscribe()` had never
 * fired. Every count below would have been trivially satisfied.
 */
ok('...and the gate was actually listening to the transport while it drove it  [entry point: tools/gate/transport.mjs subscribe()]',
  O(R.tap).subscribed === true && N(O(R.transportStats).states) > 0,
  `tap=${O(R.tap).subscribed} via ${O(R.tap).how}, ${N(O(R.transportStats).states)} states, `
  + `${JSON.stringify(O(O(R.transportStats).emitted))}`);

// -------------------------------------------------------------- 5.1 reads
{
  const s = O(O(R.playing).last);
  const have = ['playing', 'currentTime', 'duration', 'ended', 'playbackRate', 'hasMedia'].filter((k) => k in s);
  ok('the five transport values come back off the page\'s <video>  [entry point: src/preload/youtube.cjs sendState()]',
    have.length === 6 && s.playing === true && N(s.duration) === 60 && N(s.currentTime) > 0 && s.ended === false && N(s.playbackRate) === 1,
    `playing=${s.playing} t=${N(s.currentTime).toFixed(2)} dur=${s.duration} ended=${s.ended} rate=${s.playbackRate}`);

  ok('...pushed, never polled: states arrive on media events and on a tick, with nobody asking  [entry point: shared/host.js DeckTransport.onState]',
    N(O(R.playing).mediaEvents) > 0 && A(O(R.playing).events).includes('play') && A(O(R.playing).events).includes('tick'),
    `${N(O(R.playing).statesInWindow)} states in the window, events ${JSON.stringify(A(O(R.playing).events))}`);

  ok('...and `adShowing` is null rather than false before the Host has said which selector names an ad  [entry point: adShowing()]',
    O(R.attach).adBeforeConfig === null || O(R.attach).adBeforeConfig === undefined,
    'the permissive reading of "we could not look" is what applies a user\'s 1.4x to an advert');
}

// ------------------------------------------------------------- 5.2 writes
{
  const el = O(O(R.drive).element);
  ok('the three writes land on the element  [entry point: transport.drive() -> preload driveVideo()]',
    el.muted === true && N(el.rate) === 1.25 && Math.abs(N(el.t) - 12) < 3,
    `muted=${el.muted} rate=${el.rate} t=${N(el.t).toFixed(2)}`);

  /**
   * THE CONTROL IS HALF THE CLAIM. `preservesPitch` defaults to `true` and
   * `SPEED_KEY_LOCK` is `true`, so "it reads true afterwards" is satisfied by an
   * element nobody ever wrote. The gate sets it FALSE from the page's own world
   * one statement before the drive; without that this assertion could not lose,
   * and it was measured not losing — `transport-mutations.sh` case 3 deleted
   * `driveRate`'s key-lock write and the whole suite stayed green.
   */
  ok('...and the key-lock policy lands with the rate, from speed.js\'s constant  [entry point: driveRate()]',
    R.pitchBefore === false && el.preservesPitch === SPEED_KEY_LOCK,
    `the page set preservesPitch=${R.pitchBefore} one statement before the drive; after it, ${el.preservesPitch}`);

  /**
   * THE CLOSED WRITE SET, OBSERVED ON THE ELEMENT. The patch carried `src`,
   * `srcObject`, `volume` and `loop`; the element must show no trace of any.
   * This is the runtime half of §3's static enumeration.
   *
   * IT IS A CLAIM ABOUT THREE LAYERS AT ONCE, AND ONLY BREAKING TWO CAN
   * FALSIFY IT. The deck names its fields (`ui/host.js`), `filterDrive` names
   * them again, and the preload writes three properties by name — so spreading
   * the patch in any ONE of them leaves the element unmarked and this assertion
   * green. Measured: `transport-mutations.sh` case 8 spreads `filterDrive` and
   * this stayed green, which is why case 9 now spreads BOTH. That is not a
   * weakness of the assertion; it is what defence in depth means, and the
   * static enumeration in §3 is what catches a single layer going.
   */
  ok('...and the four fields outside the closed write set left no trace on the element  [entry point: src/main/drive.js filterDrive()]',
    el.srcScheme === 'blob' && N(el.volume) === 1 && el.loop === true && el.srcObject === 'null',
    `src is still ${el.srcScheme}:, volume ${el.volume}, loop ${el.loop}, srcObject ${el.srcObject}`);

  const rel = O(R.release);
  ok('release hands the player back the way it was found  [entry point: transport.release() -> preload restoreVideo()]',
    O(rel.before).muted === true && N(O(rel.before).rate) === 1.5
    && O(rel.after).muted === false && N(O(rel.after).rate) === 1 && O(rel.after).pitch === true,
    `${JSON.stringify(rel.before)} -> ${JSON.stringify(rel.after)}`);
}

// -------------------------------------------------------------- 5.3 jumps
/**
 * THE DISTINCTION THAT COST A DEFECT: a jump is the PAGE'S EVENT, not the user's
 * consent. `onContentJump` reaches `startLive`, and attaching a capture is what
 * makes the engine fetch 109 MB of weights — so a jump reported for our own
 * correction is a model download the user declined
 * (stem-splitter-live #15). Three writes to `currentTime`/`playbackRate`, told
 * apart only by who made them.
 */
{
  ok('our own corrective seek is NOT a content jump, and the seek really happened  [entry point: preload sendJump() / isSelfSeek()]',
    N(O(R.jumpSelf).jumps) === 0 && N(O(O(R.jumpSelf).selfSeekCount).selfSeeks) > 0 && N(O(R.jumpSelf).elementTime) > 25,
    `${N(O(R.jumpSelf).jumps)} jumps, ${N(O(O(R.jumpSelf).selfSeekCount).selfSeeks)} self-seeks, element at ${N(O(R.jumpSelf).elementTime).toFixed(1)}s`);

  ok('...and a seek the PAGE made IS one — same property, same element, different writer  [entry point: JUMP_EVENTS `seeking`]',
    N(O(R.jumpUser).jumps) === 1,
    `${N(O(R.jumpUser).jumps)} jump, element at ${N(O(R.jumpUser).elementTime).toFixed(1)}s`);

  ok('...and a rate change is not a jump at all — the element emits 44 100 samples per second at any rate  [entry point: JUMP_EVENTS]',
    N(O(R.jumpRate).jumps) === 0 && N(O(R.jumpRate).rate) !== 1,
    `${N(O(R.jumpRate).jumps)} jumps at rate ${O(R.jumpRate).rate}`);
}

// -------------------------------------------------------------- 5.4 speed
{
  const set = O(O(R.speedSet).report);
  ok('the user\'s speed reaches the element and the report says `ok`  [entry point: transport.requestSpeed()]',
    set.state === 'ok' && set.ok === true && N(set.want) === 1.5 && N(set.applied) === 1.5 && N(O(O(R.speedSet).element).rate) === 1.5,
    `state=${set.state} want=${set.want} applied=${set.applied} element=${O(O(R.speedSet).element).rate}`);
  ok('...and `state` is the LITERAL "ok", which is the only string that ungreys the deck\'s control  [entry point: ui/embed-state.js speedGate]',
    set.state === 'ok', 'a Host that reported "playing" would ship a permanently greyed control with no error anywhere');

  const cl = O(O(R.speedClamp).report);
  ok('a rate above the vendored ceiling is clamped, applied, and the clamp REPORTED  [entry point: the vendored resolveSpeed()]',
    N(cl.requested) === 3 && N(cl.want) === SPEED_MAX && cl.clamped === 'clamped-high' && N(O(R.speedClamp).rate) === SPEED_MAX,
    `requested ${cl.requested} -> want ${cl.want}, clamped=${cl.clamped}, element at ${O(R.speedClamp).rate}`);

  const ref = A(O(R.speedRefuse).reports).find((r) => r.refused);
  ok('an unreadable rate is REFUSED and said out loud, never coerced to a plausible number  [entry point: resolveSpeed()]',
    !!ref && ref.refused === 'unreadable' && ref.requested === '1.5' && N(O(R.speedRefuse).rate) === SPEED_MAX,
    ref ? `requested ${JSON.stringify(ref.requested)} refused=${ref.refused}, the element stayed at ${O(R.speedRefuse).rate}`
      : 'no report carried a refusal');

  const yielded = A(O(R.speedYield).yielded);
  ok('the page\'s OWN speed menu is yielded to, not fought  [entry point: speedPlan() reason `ratechange`]',
    yielded.length > 0 && N(yielded[yielded.length - 1].want) === 1.75 && N(O(R.speedYield).rate) === 1.75,
    `the claim was 1.5, the page wrote 1.75, and the Host adopted ${yielded.length ? yielded[yielded.length - 1].want : 'nothing'}`);

  const adOn = A(O(O(R.speedAd).on).reports);
  const adEnd = A(O(O(R.speedAd).end).reports);
  ok('an ad neutralises the rate to 1 and reports `ad` — the control greys with a reason  [entry point: speedPlan() ad branch]',
    adOn.some((r) => r.state === 'ad') && N(O(O(R.speedAd).on).rate) === 1 && adOn.every((r) => N(r.want) === 1.5),
    `states ${JSON.stringify(adOn.map((r) => r.state))}, element at ${O(O(R.speedAd).on).rate}, want remembered as ${adOn.length ? adOn[0].want : '?'}`);

  ok('...and the ad-END edge puts the user\'s rate back, from a class with no event behind it  [entry point: createSpeedClaim() ad-end promotion]',
    adEnd.some((r) => r.why === 'ad-end') && N(O(O(R.speedAd).end).rate) === 1.5,
    `why=${JSON.stringify(adEnd.map((r) => r.why))}, element back at ${O(O(R.speedAd).end).rate}`);

  ok('...and the whole run wrote the rate a handful of times, not once per tick  [entry point: createSpeedClaim() -> driveRate() epsilon guard]',
    N(O(R.speedStats).writes) > 0 && N(O(R.speedStats).writes) < 40 && N(O(R.speedStats).plans) > 100,
    `${N(O(R.speedStats).plans)} plans produced ${N(O(R.speedStats).writes)} writes and ${N(O(R.speedStats).yields)} yields`);
}

// --------------------------------------------------------------- 5.5 keys
/**
 * THE PRODUCT RULING: with no deck armed, `1`-`6` must reach the page exactly as
 * they do with this app not running. Every row is witnessed at BOTH ends — the
 * page says whether it saw the key, and the transport says whether it took it.
 * "The deck got nothing" on its own is also what a broken wire looks like.
 */
{
  const K = O(R.keys);
  ok('with no deck armed, a claimed digit belongs to the page  [entry point: preload keydown, deckArmed]',
    O(O(K.unarmed).page).reachedPage === true && N(K.unarmed.took) === 0,
    `page saw it=${O(O(K.unarmed).page).reachedPage}, deck took ${N(K.unarmed.took)}`);

  ok('...with a deck armed it is taken, and the page does NOT see it  [entry point: claimKeys()]',
    O(O(K.claimed).page).reachedPage === false && N(K.claimed.took) === 1
    && A(K.claimed.got)[0] && A(K.claimed.got)[0].code === 'Digit1',
    `page saw it=${O(O(K.claimed).page).reachedPage}, deck took ${JSON.stringify(A(K.claimed.got).map((g) => g.code))}`);

  ok('...an UNCLAIMED key stays the page\'s even while a deck is armed  [entry point: deckKeys]',
    O(O(K.unclaimed).page).reachedPage === true && N(K.unclaimed.took) === 0,
    `Digit9: page saw it=${O(O(K.unclaimed).page).reachedPage}, deck took ${N(K.unclaimed.took)}`);

  ok('...and a claimed digit typed into a TEXT FIELD is the page\'s — the stolen-digit rule  [entry point: isTypingTarget()]',
    K.typing && K.typing.focused === 'typebox' && O(O(K.typing).page).reachedPage === true && N(K.typing.took) === 0,
    `focus=${JSON.stringify(O(K.typing).focused)}, page saw it=${O(O(K.typing).page).reachedPage}, deck took ${N(O(K.typing).took)}`);

  ok('`?` is taken by CHARACTER and not by position, because which key makes it differs by layout  [entry point: preload keydown, e.key === "?"]',
    N(O(K.question).took) === 1 && A(O(K.question).got)[0] && A(O(K.question).got)[0].key === '?'
    && A(O(K.question).got)[0].code === 'Slash',
    `took ${JSON.stringify(A(O(K.question).got).map((g) => `${g.code}/${g.key}`))} — Slash was never in the claimed list`);
}

// ------------------------------------------------------------ 5.6 autonav
{
  const AN = O(R.autonav);
  ok('the page ships autoplay-next ON and the Host takes it, because suppression is the default  [entry point: autonavPlan() imposing]',
    O(O(AN.imposed).page).autonav === 'false' && O(AN.imposed).suppressed === true,
    `the fixture's markup is aria-checked="true"; after the Host it reads ${JSON.stringify(O(O(AN.imposed).page).autonav)}`);

  ok('...and the value we overwrote is PUT BACK when the user turns autoplay on again  [entry point: transport.setAutonav()]',
    O(O(AN.restored).page).autonav === 'true' && A(O(AN.restored).reports).some((r) => r.state === 'restored'),
    `back to ${JSON.stringify(O(O(AN.restored).page).autonav)}, reported ${JSON.stringify(A(O(AN.restored).reports).map((r) => r.state))}`);

  ok('...and turning it off again re-takes it — the setting applies now, not on the next video  [entry point: autonavPlan()]',
    O(O(AN.suppressedAgain).page).autonav === 'false'
    && A(O(AN.suppressedAgain).reports).some((r) => r.state === 'off'),
    `${JSON.stringify(O(O(AN.suppressedAgain).page).autonav)}, reported ${JSON.stringify(A(O(AN.suppressedAgain).reports).map((r) => r.state))}`);

  ok('a toggle that ignores its click is reported `stuck` after a bounded number of tries, not clicked forever  [entry point: MAX_CLICKS]',
    A(O(AN.stuck).reports).some((r) => r.state === 'stuck') && N(O(O(AN.stuck).clicks).clicks) < 12,
    `states ${JSON.stringify(A(O(AN.stuck).reports).map((r) => r.state))} after ${N(O(O(AN.stuck).clicks).clicks)} clicks in the whole run`);

  ok('...and a control that is not there is `looking` inside the find window and `missing` after it  [entry point: FIND_MS]',
    A(O(AN.missing).duringWindow).some((r) => r.state === 'looking')
    && A(O(AN.missing).afterWindow).some((r) => r.state === 'missing' || r.state === 'looking'),
    `during ${JSON.stringify(A(O(AN.missing).duringWindow).map((r) => r.state))}, after ${JSON.stringify(A(O(AN.missing).afterWindow).map((r) => r.state))}`);

  ok('...and every state the run produced is in the deck\'s vocabulary  [entry point: shared/host.js DeckPage.onAutonav]',
    Object.keys(O(O(R.autonavStats).states)).every((k) => ['idle', 'off', 'restored', 'pending', 'missing', 'lost', 'stuck', 'looking'].includes(k)),
    JSON.stringify(O(O(R.autonavStats).states)));
}

// ---------------------------------------------------------------- 5.7 SPA
{
  const S = O(R.spa);
  ok('a single-page navigation that the site ANNOUNCES is one jump and one swap  [entry point: yt-navigate-finish]',
    N(O(S.announced).jumps) === 1 && A(O(S.announced).changes).filter((c) => c === 'swapped').length === 1
    && N(O(O(S.announced).page).navigations) === 1,
    `${N(O(S.announced).jumps)} jump, changes ${JSON.stringify(A(O(S.announced).changes))}`);

  /**
   * THE CLAIM IS RELEASED, and `want: null` is the only value that says so.
   * The element's rate cannot: a fresh `<video>` starts at 1 and the first state
   * after a swap is a poll, which YIELDS — so the element reads 1 whether the
   * claim was dropped or merely adopted, and this assertion was measured staying
   * green with `speed.dropClaim()` deleted (mutation 23). The yield is an
   * ordering accident; `loadedmetadata` arriving first carries reason `remount`,
   * which WRITES, and a stale claim would land on a video nobody has heard.
   */
  const wants = A(O(S.announced).wants);
  ok('...and the user\'s speed claim is RELEASED with the video — not merely yielded away  [entry point: transport `element` -> speed.dropClaim()]',
    N(S.rateBefore) === 1.5 && N(O(S.announced).rate) === 1 && wants.includes(null),
    `the claim was ${S.rateBefore}x, the wants after the swap were ${JSON.stringify(wants)}, `
    + `and the element is at ${O(S.announced).rate}x`);

  /**
   * THE ONE THAT MATTERS MOST. `yt-navigate-finish` is the site's PRIVATE event
   * name. A Host that only listened for it would lose this the day it is
   * renamed, with nothing to see — so the tick has to be able to carry it alone.
   */
  ok('...and a navigation with NO announcement is noticed anyway, by the preload\'s own tick  [entry point: the 250 ms tick -> watchVideo()]',
    N(O(S.silent).jumps) === 1 && A(O(S.silent).changes).filter((c) => c === 'swapped').length === 2
    && N(O(O(S.silent).page).navigations) === 2,
    `${N(O(S.silent).jumps)} jump, changes ${JSON.stringify(A(O(S.silent).changes))}, states ${JSON.stringify(A(O(S.silent).states))}`);

  /**
   * THE DENOMINATOR IS THE JUMP TOTAL AS §7 LEFT IT, not as the run ended.
   * This read `R.transportStats.jumps` — captured after everything — which was
   * the same number only while nothing after §7 ever jumped. §11 now ends a live
   * export on a seek the PAGE made, which is one. `R.spa.jumpsAtEnd` is the
   * number this arithmetic was always about; the value is unchanged, and the
   * detail prints both so a divergence is visible rather than inferred.
   */
  ok('...and the element ARRIVING is not a jump — only a replacement is  [entry point: preload watchVideo() -> afterChange()]',
    A(O(S.silent).changes).includes('arrived')
    && N(O(R.spa).jumpsAtEnd) === A(O(S.silent).changes).filter((c) => c !== 'arrived').length + 2,
    `${N(O(R.spa).jumpsAtEnd)} jumps as §7 left it (${N(O(R.transportStats).jumps)} over the whole run) `
    + `vs ${JSON.stringify(A(O(S.silent).changes))} element changes`);
}

// ------------------------------------------------------------- 5.8 resend
/**
 * `DeckPage.ready` OWES A RE-SEND, and the CONTROL is what makes that claim able
 * to lose: `onSpeedReport` and `onAutonav` fire on change, so a quiet window must
 * carry zero of each. Without it, "the re-send arrived" is satisfied by traffic
 * that was going to arrive anyway.
 */
{
  const c = O(R.resendControl); const r = O(R.resend);
  ok('a window in which nothing changed carries no speed report and no autonav report  [entry point: the control]',
    N(c.speeds) === 0 && N(c.autonavs) === 0 && N(c.states) > 0,
    `control: ${N(c.states)} states (the 4 Hz tick), ${N(c.speeds)} speed, ${N(c.autonavs)} autonav`);

  ok('...and `resend()` puts all three back on the wire, undeduped  [entry point: transport.resend()]',
    N(r.speeds) >= 1 && N(r.autonavs) >= 1 && !!r.firstState,
    `resend: ${N(r.states)} states, ${N(r.speeds)} speed, ${N(r.autonavs)} autonav`);
}

// ----------------------------------------------------------------- 5.9 L1
{
  const L = O(R.l1);
  ok('L1, at run time: the source view asked for NOTHING but the page it was pointed at  [entry point: transport.js onBeforeRequest]',
    Array.isArray(L.requests) && A(L.offSchemes).length === 0 && N(L.total) > 0
    && A(L.requests).every((q) => /^file:/.test(q.url)) && A(L.requests).every((q) => q.type === 'mainFrame'),
    `${N(L.total)} request(s), all mainFrame, ${A(L.offSchemes).length} off-scheme — the fixture's media is a blob: built in the page`);

  ok('...and nothing but the source view ever spoke on the transport channel  [entry point: transport.js onUp() sender check]',
    N(O(R.transportStats).strangers) === 0,
    `${N(O(R.transportStats).strangers)} messages from a WebContents that is not the source view`);

  /**
   * THE DECK HOST IS SUBSCRIBED — which is what says `main.js` injected this
   * transport rather than constructing one nobody consumes. Recorded BEFORE the
   * gate's own tap went on, so the number is somebody else's.
   */
  const pre = O(R.listenersBeforeTap); const post = O(R.listenersAfterTap);
  const five = ['onState', 'onJump', 'onSpeedReport', 'onKey', 'onAutonav'];
  ok('...and a deck host was already subscribed to all five report channels before the gate looked  [entry point: main.js installDeckHost({transport})]',
    five.every((k) => N(pre[k]) >= 1) && five.every((k) => N(post[k]) === N(pre[k]) + 1),
    `before the tap ${JSON.stringify(pre)}, after it ${JSON.stringify(post)}`);

  const u = O(R.unsubscribe);
  ok('...and every `on*()` returns an unsubscribe that really removes the listener  [entry point: transport.js channel()]',
    N(u.withExtra) === N(u.before) + 1 && N(u.after) === N(u.before),
    `onState ${u.before} -> ${u.withExtra} -> ${u.after}`);
}

// ------------------------------------- 5.10 the live export's contiguous pass
/**
 * THE SAME RULE, OVER THE REAL PAGE. §4b proves the machine; this proves the
 * WIRE — that a seek on somebody else's `<video>` reaches it, and that the
 * suspension is a click on the page's own control rather than a preference
 * written into a variable. Issue #7: *"A Host that writes the preference and
 * never drives the view passes a weaker assertion and ships the bug."*
 */
{
  const RC = O(R.rec);
  /** Every distinct value in a pass file the probe wrote, and its frame count. */
  const readPass = (file) => {
    if (!file || !fs.existsSync(file)) return { there: false, frames: 0, values: [] };
    const b = fs.readFileSync(file);
    const f = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
    const values = [];
    for (const x of f) if (!values.includes(x)) values.push(x);
    return { there: true, frames: f.length / 2, values };
  };

  const held = A(O(RC.duringHold).samples);
  ok('a live export SUSPENDS the page\'s own autoplay-next control for the whole of its duration  '
    + '[entry point: transport.startRecording() -> autonav.holdSuppress()]',
    // THE CONTROL, and without it this cannot lose: suppression is the DEFAULT,
    // so the user's preference is turned ON first and the page is witnessed at
    // `true` with nothing recording. `false` afterwards can only be the hold.
    O(RC.repair).moves === true
    && O(O(RC.control).page).autonav === 'true' && O(RC.control).held === false
    && RC.started === null && O(RC.afterStart).held === true
    && held.length === 8 && held.every((v) => v === 'false'),
    `the page's own handler moves (${JSON.stringify(O(RC.repair).was)} -> ${JSON.stringify(O(RC.repair).mid)}); `
    + `autoplay ON and nothing recording reads ${JSON.stringify(O(O(RC.control).page).autonav)}; `
    + `${held.filter((v) => v === 'false').length}/${held.length} samples across the recording read `
    + `${JSON.stringify([...new Set(held)])}`);

  const AA = O(RC.afterAbort);
  ok('...and an ABORTED recording puts it back to the USER\'S value — the path this obligation ships dead on  '
    + '[entry point: transport.abortRecording() -> createPass().abort()]',
    O(O(RC.beforeAbort).page).autonav === 'false' && O(RC.beforeAbort).held === true
    && RC.aborted === 'gate' && AA.held === false
    && O(AA.page).autonav === 'true' && AA.suppressed === false && AA.fileGone === true,
    `held with the page at ${JSON.stringify(O(O(RC.beforeAbort).page).autonav)}, aborted, `
    + `and the page is back at ${JSON.stringify(O(AA.page).autonav)} — the user's own setting, `
    + `not the one the recording imposed; the partial file is ${AA.fileGone ? 'gone' : 'STILL THERE'}`);

  const ps = O(RC.pageSeek);
  const psFile = readPass(ps.file);
  ok('a seek the PAGE made ends the real recording, and the file stops where the seek did  '
    + '[entry point: preload sendJump() -> transport `state` -> pass.observe()]',
    RC.started2 === null && N(ps.jumps) === 1
    && O(ps.after).endedBy === 'seek' && O(ps.after).open === false
    && ps.afterEndChunk === 'not-recording'
    && psFile.there && psFile.frames === 2 * N(RC.chunkFrames) && eq(psFile.values, [0.5]),
    `${N(ps.jumps)} jump, endedBy ${JSON.stringify(O(ps.after).endedBy)}, `
    + `${psFile.frames} frames of ${JSON.stringify(psFile.values)} on disk, and the chunk offered after the seek was `
    + `${JSON.stringify(ps.afterEndChunk)}`);

  const ss = O(RC.selfSeek);
  const ssFile = readPass(ss.file);
  ok('...and OUR OWN corrective seek ends it too, though the jump channel deliberately hides it  '
    + '[entry point: transport.drive() -> filterDrive() seekTo]',
    N(ss.jumps) === 0 && O(ss.before).open === true
    && O(ss.after).endedBy === 'seek' && O(ss.after).open === false
    && ss.afterEndChunk === 'not-recording'
    && ssFile.there && ssFile.frames === N(O(ss.after).frames) && eq(ssFile.values, [0.25])
    && O(RC.afterSelfSeek).held === false && O(O(RC.afterSelfSeek).page).autonav === 'true',
    `${N(ss.jumps)} jumps reported for our own seek (stem-splitter-live #15 is about CONSENT, not contiguity); `
    + `endedBy ${JSON.stringify(O(ss.after).endedBy)} over ${ssFile.frames} frames of `
    + `${JSON.stringify(ssFile.values)}, and the hold released with it`);
}

} catch (err) {
  // ONE NAME, so a coverage instrument sees the same assertion every time; the
  // value that would let a reader diagnose it goes in the DETAIL (§3 rule 3).
  // `done()` is below rather than here, so the summary line still prints: the
  // count in it is the count that RAN, and one red already makes the exit
  // non-zero. Nothing compares that count to the pin on a red run (see above).
  // `HARNESS: ` IS LOAD-BEARING, not decoration. This row is about the SUITE,
  // not about the product, and without the marker it would fill the coverage
  // slot of the assertion that never ran — `63 passed, 1 failed` totals 64 and
  // reads as complete. tools/verify.mjs `HARNESS_PREFIX` is the one definition;
  // void-canary compares this literal against it.
  ok('HARNESS: the launch section ran to its end without throwing  [entry point: the block guard above section 5]',
    false,
    `${(err && err.name) || 'Error'}: ${(err && err.message) || String(err)}`
    + ` — ${(String((err && err.stack) || '').split('\n')[1] || '(no frame)').trim()}`);
}

done();

// ------------------------------------------------------------------ plumbing
function sh(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }
function hasBin(name) {
  for (const dir of (process.env.PATH || '').split(':')) {
    try { fs.accessSync(path.join(dir, name), fs.constants.X_OK); return true; } catch { /* next */ }
  }
  return false;
}
/**
 * A DECLARATION, NOT A `const` — and that is the whole fix.
 *
 * The only caller is the launch assertion at the top of section 5, in the branch
 * that runs when the launch wrote no report; the declaration sat 300 lines below
 * it, in this plumbing block. `const` is not hoisted, so ANY launch failure —
 * the one case that branch exists for — reached it inside its temporal dead zone
 * and threw `ReferenceError: Cannot access 'lastLine' before initialization`.
 * A named red became an unhandled crash, and it cost one full-gate run to find.
 *
 * The nine other suites that carry a `lastLine` all declare it as a function,
 * which is why this was the only one. Same defect class as upstream #30: a suite
 * that dies instead of reporting.
 */
function lastLine(s) { return String(s).trimEnd().split('\n').pop() || '(no output)'; }
/**
 * TWO BUDGETS, NOT ONE — the same shape as `shell.mjs`'s `run()`, and see
 * `LOCK_MARK` above for what one budget cost. `queueMs` covers waiting for the
 * machine-global mutex, which is other agents' windowed suites and has no
 * bearing on this Host; `timeoutMs` starts when `startOn` appears in the output,
 * which is the first thing echoed inside the `flock`. Whichever expires says
 * WHICH in the transcript, so a red never has to be guessed at.
 */
function run(cmd, args, { cwd, timeoutMs, queueMs = 0, startOn = null }) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let out = '';
    let waiting = startOn;
    let timer = null;
    /**
     * THE GROUP, NOT THE PROCESS. `flock` is the child and the launch is its
     * GRANDCHILD through `sh`; killing the one released the mutex and left the
     * other running — an Electron holding an X display that nobody can see the
     * owner of, on a box where every windowed suite queues on one lock.
     */
    const stop = () => {
      try { process.kill(-p.pid, 'SIGKILL'); } catch { try { p.kill('SIGKILL'); } catch { /* already gone */ } }
    };
    const arm = (ms, why) => { clearTimeout(timer); timer = setTimeout(() => { out += `\n[suite] ${why}\n`; stop(); }, ms); };
    arm(waiting ? queueMs : timeoutMs, waiting
      ? `NEVER TOOK THE SHARED BROWSER MUTEX after ${queueMs} ms — killing. Somebody else is holding ${LOCK}`
      : `TIMEOUT after ${timeoutMs} ms — killing`);
    const grab = (b) => {
      out += b.toString();
      if (waiting && out.includes(waiting)) { waiting = null; arm(timeoutMs, `TIMEOUT after ${timeoutMs} ms — killing`); }
    };
    p.stdout.on('data', grab); p.stderr.on('data', grab);
    // WE DIE, IT DIES. `exit` covers a normal end and an uncaught throw; the two
    // signals cover `timeout` (which sends TERM), Ctrl-C, and a battery being
    // torn down mid-case.
    const onExit = () => stop();
    const onSignal = () => { stop(); process.exit(130); };
    process.on('exit', onExit);
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    const finish = (res) => {
      clearTimeout(timer);
      process.off('exit', onExit); process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
      resolve(res);
    };
    p.on('close', (code) => finish({ code, out }));
    p.on('error', (err) => finish({ code: -1, out: `${out}\n[suite] spawn failed: ${err.message}` }));
  });
}
