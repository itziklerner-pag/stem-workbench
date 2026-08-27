#!/usr/bin/env node
/**
 * export — file intake, and the folder the user chooses ONCE.
 *
 * WHAT IT GATES, TODAY. The File source's intake: which files it admits and what
 * MIME each is served as; that a title derived from a file name can never be a
 * path; that a path token is one-shot and expires; and — over TWO REAL LAUNCHES
 * of `electron .` sharing one profile — that the export folder is asked for
 * exactly once, that the second export writes into the remembered folder, and
 * that the memory survives a restart.
 *
 * WHERE THE PROBE ENTERS, AND THE LIMITATION THAT COMES WITH IT. Nothing a user
 * can press reaches the intake yet — the chrome bar's File controls and the
 * export writer are both later slices — so `tools/gate/export.mjs` calls
 * `ensureExportFolder()` and `chooseSourceFile()` directly, from inside main,
 * which is where the counter lives. That is the entry point BOTH of those slices
 * will use, and every assertion below names it (`docs/TESTING.md` §3 rule 5).
 * It is nevertheless one step short of `docs/TESTING.md` §5c's standard — "it
 * drives the real interface, not a private door" — and the step that closes the
 * gap is the export COMMAND, once there is one. **When the writer lands, this
 * suite should drive the export rather than the intake.** The dialog it counts
 * is already the real one; what is not yet driven is the gesture in front of it.
 *
 * WHAT IT WILL GATE AND DOES NOT YET, named rather than left to be discovered:
 * THE WRITER. Six 32-bit-float / 44.1 kHz / stereo WAVs in `STEMS` order at
 * unity, bit-exact headers, and a title that cannot escape the chosen folder ON
 * DISK — the plan's G1, G2a and G2b-path. That is the export-writer slice, it
 * lands in this step, and **the pinned count below moves when it does**. Nothing
 * here writes or reads a WAV.
 *
 * ---------------------------------------------------------------------------
 * THE DIALOG IS NEVER STUBBED. THIS SUITE DRIVES THE REAL NATIVE CHOOSER.
 * ---------------------------------------------------------------------------
 * The count of "how many times did this app ask for a folder" is read off a
 * counter `src/main/files.js` increments beside its own
 * `dialog.showOpenDialog` call, out of a launch that opened the REAL GTK file
 * chooser — which `tools/gate/export.mjs` then answers the way a person does,
 * with `xdotool`: Ctrl+L, type the path, click **Open**.
 *
 * Nothing anywhere replaces, stubs or monkey-patches `dialog.showOpenDialog`,
 * and the first launched assertion below is the instrument check that says so:
 * the intake the running app is holding compares equal to `electron`'s own
 * `dialog`. A gate that substitutes its own dialog would be asserting a fact
 * about the substitute — the real picker could then be opened twice, never, or
 * with `openFile` instead of `openDirectory`, and the count would stay green.
 * `docs/TESTING.md` §3 rule 7 is the same rule from the other side, and
 * `tools/suites/transport.mjs` already takes this position for the preload
 * (§5c, *"It drives the real interface, not a private door"*).
 *
 * ---------------------------------------------------------------------------
 * THE MACHINE FACT THIS SUITE HAS TO KNOW, AND WHY THE LAUNCH IS NOT PLAIN
 * ---------------------------------------------------------------------------
 * `DBUS_SESSION_BUS_ADDRESS` IS SET TO `disabled:` FOR THE LAUNCH, DELIBERATELY.
 *
 * On a box with a D-Bus session bus but no `xdg-desktop-portal` — which is this
 * one — Chromium's file dialog asks the portal and **never falls back to GTK**. Measured: no window maps at all, and
 * `showOpenDialog`'s promise never settles. The Chromium log says
 * *"Failed to register with org.freedesktop.host.portal.Registry"*. With the bus
 * out of the way the in-process GTK chooser maps in under a second and can be
 * driven. This is a property of the box, like `$DISPLAY`, and it is set here
 * rather than in `src/` so the app under test is the shipping app.
 *
 * WHAT THAT COSTS, STATED: on a desktop that DOES have a portal, this suite is
 * exercising the GTK chooser rather than the portal one. The app's code path is
 * identical — one `dialog.showOpenDialog` call with one set of options — but
 * "the portal chooser appears and behaves" is NOT gated anywhere, by this or
 * anything else, and cannot be until a box with a portal runs it. `README.md`'s
 * verified/configured split is where that belongs.
 *
 * ---------------------------------------------------------------------------
 * WATCHED RED BY MUTATION — every assertion below, with the edit that broke it
 * ---------------------------------------------------------------------------
 * Reproduce with `tools/suites/export-mutations.sh`. Run on 2026-08-26 against
 * Electron 44.0.0 / Chromium 152.0.7977.54 on Linux. The right column is what
 * ACTUALLY went red, not what was expected to.
 *
 * Two lanes. Cases 1-11 run `EXPORT_ONLY=pure` and take under a second each;
 * cases 12-22 are the whole suite, which is two real launches with a real native
 * chooser answered in each. `tools/suites/coverage.py` over the whole battery
 * refuses an assertion that has never appeared on a FAIL line.
 *
 *   1  files.js extOf: drop .toLowerCase()             -> every extension is admitted, either case
 *   2  files.js isAllowedSourceFile: `true ||`         -> ...and everything else is refused
 *   3  files.js SOURCE_FILTERS: extensions -> ['wav']  -> every admitted extension has a MIME
 *   4  files.js mimeForSourceFile: always 'audio/x'    -> every admitted extension has a MIME
 *   5  files.js deriveTitle: keep the extension        -> a title is the file's own name
 *   6  files.js sanitiseTitle: drop the separator strip-> a title can never BE a path, AND
 *                                                        joining stays inside the folder
 *   7  files.js sanitiseTitle: drop the trailing strip -> a title can never BE a path
 *   8  files.js sanitiseTitle: drop the leading strip  -> a title can never BE a path
 *   9  files.js spend(): never delete the entry        -> a path token is ONE SHOT
 *  10  files.js spend(): ignore expiresAt              -> ...and one spent after its TTL is EXPIRED
 *  11  files.js revokeAll(): clear nothing             -> ...and revokeAll drops every live token
 *  12  files.js ensureExportFolder: delete the         -> the folder is asked EXACTLY ONCE
 *      remembered-folder read  (the plan's G3)            (**2**, not 1), AND export #2 resolved to
 *                                                        the remembered folder, AND the restart
 *  13  files.js EXPORT_FOLDER_AREA -> 'session'        -> the remembered folder survives a RESTART
 *      (the plan's G4)                                    (**1** ask, not 0), AND it is the SAME
 *                                                        folder (local=null, session=the folder)
 *  14  files.js ensureExportFolder: drop the pending   -> a second export while the chooser is up
 *      join                                               joins that ask (2 pickers, not 1)
 *  15  files.js askForFolder: FILE_DIALOG's options    -> ...and the options are a FOLDER picker
 *  16  main.js: build the intake over a WRAPPER that   -> INSTRUMENT CHECK: the intake holds
 *      still opens the real dialog                        electron's own dialog — **and nothing
 *                                                        else**: 21 passed, 1 failed
 *  17  files.js chooseSourceFile: title = basename()   -> the file picker derives its title
 *  18  files.js chooseSourceFile: drop the allowlist   -> ...and a file it does not admit is
 *      check                                              REFUSED BY NAME
 *  19  files.js chooseSourceFile: mint from a FRESH    -> ...and that token resolves over the
 *      registry                                           running app's own registry
 *  20  gate/export.mjs: write no report                -> both launches wrote a report — and the
 *                                                        suite stops there: 9 passed, 1 failed
 *  21  gate/export.mjs: read asksAtBoot AFTER export#1 -> a launch on its own asks for nothing
 *  22  files.js askForFolder: answer without ever      -> the first export opens the REAL native
 *      calling the dialog                                 chooser (the count alone stays at 1)
 *  23  files.js rememberedFolder: drop the statSync     -> ...and a remembered folder that has
 *      directory check (issue #6's branch)                been DELETED is not used
 *
 * CASES 16 AND 22 ARE THE PAIR THAT KEEPS THE OTHERS HONEST, and they fail in
 * opposite directions on purpose. 16 leaves every count correct — the wrapper
 * still opens the real dialog — and only the INSTRUMENT notices, which is what
 * proves the instrument is load-bearing rather than decorative. 22 leaves the
 * instrument correct and takes the dialog away, and the COUNT alone stays at 1:
 * an assertion that only counted asks would be green over an app that never
 * opened a picker at all. Neither one on its own would have found the other.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  SOURCE_TYPES, SOURCE_FILTERS, isAllowedSourceFile, mimeForSourceFile,
  deriveTitle, sanitiseTitle, MAX_TITLE, FALLBACK_TITLE,
  createPathTokens, PATH_TOKEN_TTL_MS, FOLDER_DIALOG, FILE_DIALOG,
} from '../../src/main/files.js';
import { BROWSER_LOCK, announceLock } from '../lib/locks.mjs';
import { refuseIfCompromised } from '../lib/tree-guard.mjs';

const ID = 'export';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** See `tools/suites/shell.mjs` — a stranded mutation must not be measured past. */
refuseIfCompromised(ID, ROOT);
const OUT = path.join(ROOT, 'out', ID);

/** The shared browser mutex. The path is `tools/lib/locks.mjs`'s and is not spelled here. */
const LOCK = BROWSER_LOCK;
announceLock();
const LOCK_MARK = '__WB_LOCKED__';

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

/** A report field is not a promise — see `tools/suites/shell.mjs`. */
const O = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

// ==========================================================================
// 1. THE INTAKE AS PURE FUNCTIONS — no launch, no display, no mutex
// ==========================================================================
{
  // THE TABLE IS BUILT FROM THE DECLARATION, so an extension added to
  // SOURCE_TYPES is covered the day it is added rather than the day somebody
  // remembers to extend a list here. The UPPER-CASE half is the real case: a
  // file called `TRACK.WAV` off a camera is the ordinary way this arrives.
  const declared = Object.keys(SOURCE_TYPES);
  const admit = [...declared.map((e) => `/music/a${e}`), ...declared.map((e) => `/music/a${e.toUpperCase()}`)];
  const admitted = admit.filter(isAllowedSourceFile);
  ok('every extension the File source declares is admitted, in either case  '
    + '[entry point: src/main/files.js isAllowedSourceFile()]',
    declared.length > 0 && admitted.length === admit.length,
    `${admitted.length}/${admit.length} over ${declared.length} declared: ${declared.join(' ')}`
    + `${admitted.length === admit.length ? '' : ` — REFUSED ${admit.filter((p) => !isAllowedSourceFile(p)).join(' ')}`}`);

  const refuse = [
    '/music/a.txt', '/music/a.pdf', '/music/a.mp4',              // not audio at all
    '/music/track.wav.txt',                                       // the LAST extension decides
    '/music/awav', '/music/track',                                // no extension
    '/music/.wav',                                                // a file literally named `.wav`
    '/music/a.wma', '/music/a.ape',                               // audio Chromium cannot decode
    '/music/a.',                                                  // a bare trailing dot
    '/music/a.exe',
  ];
  const held = refuse.filter((p) => !isAllowedSourceFile(p));
  ok('...and everything else is refused, including `track.wav.txt` and a file named `.wav`  '
    + '[entry point: isAllowedSourceFile()]',
    held.length === refuse.length,
    `${held.length}/${refuse.length}${held.length === refuse.length ? '' : ` — ADMITTED ${refuse.filter(isAllowedSourceFile).join(' ')}`}`);

  // The MIME is what the `/file/` ROOT will answer with, so an admitted file
  // whose type we cannot NAME is a hole in the allowlist, not a file to guess at.
  const typed = declared.filter((e) => /^[a-z]+\/[a-z0-9.+-]+$/.test(String(mimeForSourceFile(`/m/a${e}`))));
  const filtered = SOURCE_FILTERS[0].extensions;
  ok('every admitted extension has a MIME of its own, and the picker\'s filter names exactly the same set  '
    + '[entry point: mimeForSourceFile() and SOURCE_FILTERS]',
    typed.length === declared.length && mimeForSourceFile('/m/a.txt') === null
    && filtered.length === declared.length && declared.every((e) => filtered.includes(e.slice(1))),
    `${typed.length}/${declared.length} typed, filter names ${filtered.length}, `
    + `.txt -> ${JSON.stringify(mimeForSourceFile('/m/a.txt'))}`);

  const titles = [
    ['/music/Artist/Deep Cuts - Track 01.wav', 'Deep Cuts - Track 01'],
    ['/music/song', 'song'],                       // no extension: the whole name is the title
    ['/music/.flac', 'flac'],                      // all extension: `extname` says '', the strip says `flac`
    ['/music/a.tar.gz', 'a.tar'],                  // the LAST extension only
  ];
  const derived = titles.filter(([p, want]) => deriveTitle(p) === want);
  ok('a title is the file\'s own name without its directory or its last extension  '
    + '[entry point: deriveTitle()]',
    derived.length === titles.length,
    `${derived.length}/${titles.length}: ${titles.map(([p]) => `${JSON.stringify(path.basename(p))} -> ${JSON.stringify(deriveTitle(p))}`).join(', ')}`);

  /**
   * THE ADVERSARIAL TABLE, AND IT IS THE POINT OF THE WHOLE SECTION. The title
   * is a DIRECTORY name and part of six FILE names at export
   * (`<title>/<title> - <stem>.wav`), so a title that can be a path is a write
   * outside the folder the user chose.
   */
  const nasty = ['../../etc/passwd', 'a/b', 'C:\\Windows\\system32', '..', '.', './.', '.hidden',
    'trailing.', 'trailing ', 'CON', 'com1', 'nul.wav', 'x\u0000y', 'bell\u0007', '   ', '.....',
    '///', 'a'.repeat(300), 'a:b*c?d"e<f>g|h', '', null, undefined];
  const safe = (t) => {
    const s = sanitiseTitle(t);
    return s.length > 0 && s.length <= MAX_TITLE
      && !/[/\\]/.test(s) && !/[\u0000-\u001f\u007f]/.test(s)
      && s !== '.' && s !== '..' && !/^[.\s]/.test(s) && !/[.\s]$/.test(s)
      && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i.test(s);
  };
  const clean = nasty.filter(safe);
  ok('...and a title can never BE a path: no separator, no traversal, no control byte, no reserved '
    + 'device name and no trailing dot survives  [entry point: sanitiseTitle()]',
    clean.length === nasty.length,
    `${clean.length}/${nasty.length}${clean.length === nasty.length
      ? ` (\`..\` -> ${JSON.stringify(sanitiseTitle('..'))}, fallback ${JSON.stringify(FALLBACK_TITLE)})`
      : ` — LET THROUGH ${nasty.filter((t) => !safe(t)).map((t) => `${JSON.stringify(t)} -> ${JSON.stringify(sanitiseTitle(t))}`).join(', ')}`}`);

  // The property the one above exists FOR, stated as the thing the writer will
  // actually do: resolve the title against the chosen folder and stay in it.
  const CHOSEN = '/tmp/chosen-export-folder';
  const escaped = nasty.filter((t) => path.dirname(path.resolve(CHOSEN, sanitiseTitle(t))) !== CHOSEN);
  ok('...and joining any of them to the chosen folder resolves to a child of that folder, never outside it  '
    + '[entry point: sanitiseTitle()]',
    escaped.length === 0,
    escaped.length ? `ESCAPED: ${escaped.map((t) => `${JSON.stringify(t)} -> ${path.resolve(CHOSEN, sanitiseTitle(t))}`).join(', ')}`
      : `${nasty.length} titles, all under ${CHOSEN}/`);

  // ------------------------------------------------------------ path tokens
  // A CLOCK THE SUITE MOVES, not a `sleep`: AGENTS.md, "if a count can carry the
  // claim, do not carry it with a stopwatch" — and expiry is the same idea.
  let clock = 1_000_000;
  const tokens = createPathTokens({ now: () => clock });
  const t1 = tokens.mint('/music/one.wav');
  const first = tokens.spend(t1);
  const second = tokens.spend(t1);
  ok('a path token is ONE SHOT — the second spend is refused as unknown, which is also what a replay is  '
    + '[entry point: createPathTokens() spend()]',
    first.ok === true && first.file === '/music/one.wav' && first.mime === 'audio/wav'
    && second.ok === false && second.code === 'unknown-token',
    `first ${JSON.stringify(first)} · second ${JSON.stringify(second)}`);

  const t2 = tokens.mint('/music/two.flac');
  clock += PATH_TOKEN_TTL_MS + 1;
  const late = tokens.spend(t2);
  const never = tokens.spend('a-token-nobody-minted');
  ok('...and one spent after its TTL is refused as EXPIRED, which is a different answer from unknown  '
    + '[entry point: spend()]',
    late.ok === false && late.code === 'expired' && never.code === 'unknown-token'
    && late.code !== never.code,
    `after ${PATH_TOKEN_TTL_MS + 1} ms on the injected clock -> ${late.code}; never minted -> ${never.code}`);

  const t3 = tokens.mint('/music/three.mp3');
  const t4 = tokens.mint('/music/four.ogg');
  const dropped = tokens.revokeAll('the gesture ended');
  const afterRevoke = tokens.spend(t3);
  ok('...and revokeAll drops every live token, so a path cannot outlive the gesture that named it  '
    + '[entry point: revokeAll()]',
    dropped === 2 && tokens.inspect().live === 0 && afterRevoke.code === 'unknown-token'
    && t3 !== t4 && /^[0-9a-f-]{36}$/.test(t3),
    `revoked ${dropped}, ${tokens.inspect().live} live after; a revoked token reads as ${afterRevoke.code}; `
    + 'tokens are randomUUIDs, not a counter something could ask for the next of');
}

/**
 * THE BATTERY'S FAST LANE. `EXPORT_ONLY=pure` stops here, having asserted
 * everything that needs no display, and `tools/suites/export-mutations.sh` runs
 * its eleven pure cases that way — seconds each instead of two real launches.
 *
 * THE RUNNER NEVER USES IT, and cannot: the count it prints is not the pinned
 * one, so `classify()` reports a FAIL. That is the right relationship. It is the
 * same trade `deck-host` makes with `DECK_HOST_ONLY=conformance`, and it is a
 * lane for a battery rather than a way to get a cheap green.
 */
if (process.env.EXPORT_ONLY === 'pure') {
  console.log(`${ID}: EXPORT_ONLY=pure — the launched half did not run, so this count is NOT the pinned one`);
  done();
}

// ==========================================================================
// 2. TWO REAL LAUNCHES, ONE PROFILE
// ==========================================================================
const electron = path.join(ROOT, 'node_modules', '.bin', 'electron');
if (!fs.existsSync(electron)) skip('electron is not installed — npm i');
if (!hasBin('xvfb-run')) skip('xvfb-run is not on PATH and this box has no DISPLAY');
if (!hasBin('flock')) skip('flock is not on PATH — the shared browser mutex cannot be taken');
// A MACHINE PROPERTY, LIKE THE OTHER THREE. Without `xdotool` there is no way to
// answer a native chooser, and a native chooser is the thing under test — so
// this cannot be worked around, only skipped honestly. `docs/TESTING.md` §3
// rule 8: SKIPPED is for the machine.
if (!hasBin('xdotool')) skip('xdotool is not on PATH — the real native chooser cannot be answered');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const userData = path.join(OUT, 'userdata');
const chosen = path.join(OUT, 'chosen stems');        // a space, because a real one has one
fs.mkdirSync(chosen, { recursive: true });
const library = path.join(OUT, 'library');
fs.mkdirSync(library, { recursive: true });
const fixtureFile = path.join(library, 'Deep Cuts - Track 01.wav');
fs.writeFileSync(fixtureFile, minimalWav());
const player = pathToFileURL(path.join(ROOT, 'tools', 'fixture', 'player.html')).href;

const launches = {};
for (const phase of ['first', 'again']) {
  const dir = path.join(OUT, phase);
  const r = await run('flock', [LOCK, '-c',
    `echo ${LOCK_MARK}; exec xvfb-run -a -s '-screen 0 1280x1024x24' ${sh(electron)} . `
    + `--gate=${sh(dir)} --gate-probe=export --source-url=${sh(player)} --user-data=${sh(userData)}`],
  {
    cwd: ROOT,
    timeoutMs: 180000,
    queueMs: 900000,
    startOn: LOCK_MARK,
    env: {
      ...process.env,
      // See the header. Without this the portal is asked, nothing maps, and the
      // dialog's promise never settles.
      DBUS_SESSION_BUS_ADDRESS: 'disabled:',
      WB_EXPORT_PHASE: phase,
      WB_EXPORT_TARGET: chosen,
      WB_EXPORT_FIXTURE: phase === 'first' ? fixtureFile : '',
    },
  });
  fs.writeFileSync(path.join(OUT, `${phase}.log`), r.out);
  let report = null;
  try { report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8')); } catch { /* asserted */ }
  launches[phase] = { run: r, report };
}

const A1 = launches.first.report;
const A2 = launches.again.report;

// A SUITE THAT CANNOT LOOK FAILS. Two launches that wrote nothing is the failure,
// not a reason to stop asserting.
ok('both launches ran from the real entry point and wrote a gate report  '
  + '[entry point: `electron . --gate-probe=export` -> src/main/main.js]',
  !!A1 && A1.gate === 1 && A1.phase === 'first' && !!A2 && A2.gate === 1 && A2.phase === 'again',
  [['first', A1, launches.first], ['again', A2, launches.again]].map(([n, R, l]) =>
    `${n}: ${R ? `ok, electron ${R.versions.electron}` : `NO REPORT (exit ${l.run.code} — ${lastLine(l.run.out)})`}`).join(' · '));
if (!A1 || !A2) done();

/**
 * THE INSTRUMENT, AND IT COMES BEFORE EVERY COUNT BELOW IT.
 *
 * Everything after this is "how many times did the app ask for a folder", read
 * off a counter in `src/main/files.js`. That number is a fact about THIS APP
 * only while the thing being counted is the operating system's own picker. A
 * build whose intake held a stub would produce identical counts over a dialog
 * that never opened, so this is a separate claim with its own name, in the shape
 * `shell`'s bus recorder and `p1`'s hit counter already use.
 */
ok('INSTRUMENT CHECK: the intake in the running app holds electron\'s own `dialog` — nothing was stubbed  '
  + '[entry point: createFileIntake() in src/main/files.js, built in boot() in src/main/main.js]',
  A1.dialogIsElectron === true && A2.dialogIsElectron === true,
  `first ${A1.dialogIsElectron}, again ${A2.dialogIsElectron}; `
  + `the chooser is driven with xdotool on ${A1.display} (DBUS=${A1.dbus})`);

ok('a launch on its own asks for nothing — the export folder is asked for by an EXPORT, never by starting up',
  A1.asksAtBoot === 0 && A2.asksAtBoot === 0,
  `first launch ${A1.asksAtBoot} ask(s) at boot, relaunch ${A2.asksAtBoot} — the control the counts below rest on`);

// --------------------------------------------------------- the first export
ok('the first export opens the REAL native folder chooser, and it was answered with a chosen folder  '
  + '[entry point: ensureExportFolder() in src/main/files.js]',
  A1.chooserMapped === true && O(A1.answered).answered === true
  && O(A1.export1).ok === true && O(A1.export1).dir === A1.target && O(A1.export1).asked === true,
  `a window named ${JSON.stringify(A1.folderDialogTitle)} mapped, answered in ${O(A1.answered).waitedMs} ms `
  + `at corner offset ${JSON.stringify(O(A1.answered).at)} -> ${JSON.stringify(O(A1.export1).dir || A1.export1)}`);

// The options are a separate claim from the count: a picker opened with
// `openFile` would be opened exactly once too, and would hand back a file.
const opts = O(A1.optionsUsed);
ok('...and the options it was opened with are a FOLDER picker that may create one, not a file picker  '
  + '[entry point: FOLDER_DIALOG in src/main/files.js]',
  Array.isArray(opts.properties) && opts.properties.length === 2
  && opts.properties.includes('openDirectory') && opts.properties.includes('createDirectory')
  && !opts.properties.includes('openFile') && !opts.filters && opts.title === FOLDER_DIALOG.title,
  `properties ${JSON.stringify(opts.properties)} title ${JSON.stringify(opts.title)} filters ${JSON.stringify(opts.filters)}`);

ok('a second export requested while the chooser is UP joins that ask — one picker, never two stacked modals  '
  + '[entry point: ensureExportFolder()]',
  A1.asksWhileChooserUp === 1 && A1.joinedPending === 1
  && O(A1.export1dup).ok === true && O(A1.export1dup).dir === O(A1.export1).dir,
  `${A1.asksWhileChooserUp} ask(s) with the chooser up, ${A1.joinedPending} request joined it; `
  + `both resolved to ${JSON.stringify(O(A1.export1dup).dir)}`);

// ---------------------------------------------------------------------- G3
ok('the folder is asked EXACTLY ONCE across two consecutive exports  [entry point: ensureExportFolder()]',
  A1.asksAfterSecond === 1,
  `${A1.asksAfterSecond} real invocation(s) of dialog.showOpenDialog across export #1 and export #2 `
  + `(${A1.asksAfterFirst} after the first); a chooser during export #2: ${JSON.stringify(O(A1.secondChooser).appeared)}`);

ok('...and export #2 resolved to the REMEMBERED folder without a chooser at all  [entry point: ensureExportFolder()]',
  O(A1.export2).ok === true && O(A1.export2).dir === A1.target && O(A1.export2).asked === false
  && O(A1.secondChooser).appeared === false && O(A1.stats).folderFromMemory === 1,
  `export #2 -> ${JSON.stringify(O(A1.export2).dir || A1.export2)} asked=${O(A1.export2).asked}, `
  + `${O(A1.stats).folderFromMemory} export(s) served from memory`);

// ---------------------------------------------------------------------- G4
ok('the remembered folder survives a RESTART — a second launch on the same profile asks zero times  '
  + '[entry point: ensureExportFolder()]',
  A2.asksAfterRestart === 0 && O(A2.restartChooser).appeared === false && O(A2.export3).ok === true
  && O(A2.export3).asked === false,
  `${A2.asksAfterRestart} ask(s) in a new process over ${path.relative(ROOT, userData)}; `
  + `export -> ${JSON.stringify(O(A2.export3).dir || A2.export3)} asked=${O(A2.export3).asked}`);

ok('...and it is the SAME folder, read back out of the `local` area rather than a lifetime that dies with the process  '
  + '[entry point: EXPORT_FOLDER_AREA in src/main/files.js]',
  O(A2.export3).dir === A1.target && O(A2.stored).local === A1.target && O(A2.stored).session === null,
  `local=${JSON.stringify(O(A2.stored).local)} session=${JSON.stringify(O(A2.stored).session)} `
  + `chosen in launch 1: ${JSON.stringify(A1.target)}`);

/**
 * AND THE FOLDER THE USER DELETED — issue #6's case, and a branch of
 * `rememberedFolder()` that nothing else here reaches.
 *
 * A remembered path is a claim about a filesystem nobody told us had changed.
 * Discovering it is gone while writing the fourth of six stems is a failure at
 * the END of a long operation, with half a track on disk. TWO facts, because a
 * build that asked again and then kept the dead path would satisfy the first on
 * its own: it asked, AND it took the new answer.
 */
ok('...and a remembered folder that has been DELETED is not used — the app asks again, and takes the new answer  '
  + '[entry point: ensureExportFolder()]',
  A2.goneChooserMapped === true && O(A2.goneAnswered).answered === true
  && A2.asksAfterRestart === 0 && A2.asksAfterGone === 1 && A2.askReason === 'gone'
  && O(A2.export4).ok === true && O(A2.export4).dir === A2.moved
  && O(A2.storedAfterGone).local === A2.moved && O(A2.stats).folderGone === 1,
  `${A2.asksAfterRestart} ask(s) while it existed, ${A2.asksAfterGone} after it was removed `
  + `(reason ${JSON.stringify(A2.askReason)}); ${JSON.stringify(path.basename(String(A2.moved)))} `
  + `replaced it in \`local\``);

// ------------------------------------------------------------ the file picker
const picked = O(A1.picked);
ok('the file picker admits a real audio file, derives its title and mints a one-shot path token  '
  + '[entry point: chooseSourceFile() in src/main/files.js]',
  A1.fileChooserMapped === true && O(A1.fileAnswered).answered === true
  && picked.ok === true && picked.file === A1.fixture
  && picked.title === deriveTitle(A1.fixture) && picked.mime === 'audio/wav' && typeof picked.token === 'string',
  picked.ok
    ? `${JSON.stringify(path.basename(picked.file))} -> title ${JSON.stringify(picked.title)} mime ${picked.mime} `
      + `ttl ${picked.ttlMs} ms, over the real ${JSON.stringify(A1.fileDialogTitle)} chooser`
    : `chooser mapped=${A1.fileChooserMapped} answered=${JSON.stringify(A1.fileAnswered)} picked=${JSON.stringify(A1.picked)}`);

ok('...and that token resolves to that file exactly once, over the running app\'s own registry  '
  + '[entry point: createPathTokens() spend(), through src/main/main.js state.pathTokens]',
  O(A1.tokenFirst).ok === true && O(A1.tokenFirst).file === A1.fixture
  && O(A1.tokenFirst).mime === 'audio/wav' && O(A1.tokenSecond).ok === false
  && O(A1.tokenSecond).code === 'unknown-token',
  `first spend ${JSON.stringify(A1.tokenFirst)} · second ${JSON.stringify(A1.tokenSecond)}`);

/**
 * THE REFUSAL, DRIVEN FOR REAL OVER THE SAME CHOOSER.
 *
 * `filters` is a browsing convenience and decides nothing — Ctrl+L takes any
 * path at all, which is exactly how this suite answers its own picker. So the
 * allowlist's call site inside `chooseSourceFile()` is the thing that has to
 * refuse, and it has to refuse BY NAME: a picker that closes and produces no
 * outcome is the defect `src/renderer/chrome.js` was rewritten to fix.
 */
const refusedPick = O(A1.refusedPick);
ok('...and a file the allowlist does not admit is REFUSED BY NAME over that same chooser, never silently dropped  '
  + '[entry point: chooseSourceFile()]',
  A1.refusedChooserMapped === true && O(A1.refusedAnswered).answered === true && A1.fileAsks === 2
  && refusedPick.ok === false && refusedPick.code === 'not-audio'
  && typeof refusedPick.message === 'string' && refusedPick.message.includes('sleeve-notes.txt')
  && O(A1.stats).refused === 1,
  `${A1.fileAsks} real file pickers; ${JSON.stringify(path.basename(String(A1.notAudio)))} -> `
  + `${JSON.stringify(refusedPick.code)}: ${String(refusedPick.message).slice(0, 90)}`);

console.log(`\n${ID}: launch logs ${path.relative(ROOT, OUT)}/{first,again}.log · `
  + `reports ${path.relative(ROOT, OUT)}/{first,again}/report.json`);
done();

// ------------------------------------------------------------------ helpers
function sh(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }
function lastLine(s) { const l = String(s).trimEnd().split('\n'); return l[l.length - 1] || '(no output)'; }
function hasBin(name) {
  for (const dir of (process.env.PATH || '').split(':')) {
    try { fs.accessSync(path.join(dir, name), fs.constants.X_OK); return true; } catch { /* next */ }
  }
  return false;
}

/**
 * A REAL 16-bit PCM WAV, 1024 frames of silence — small, and a file rather than
 * a lie. Nothing in this suite decodes it: it exists so the native chooser has
 * something to be answered WITH, and so `deriveTitle` is derived from a name
 * that is really on a disk. The export writer's own 32-bit-float headers are
 * `shared/wav.js`'s and are that slice's to gate.
 */
function minimalWav(frames = 1024) {
  const data = frames * 4;                                  // stereo, 16-bit
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(44100, 24); b.writeUInt32LE(44100 * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(data, 40);
  return b;
}

/** `tools/suites/shell.mjs`'s launcher, with an `env` — see the DBUS note in the header. */
function run(bin, args, { cwd, timeoutMs, queueMs = 0, startOn = null, env = process.env }) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let out = '';
    let waiting = startOn;
    let timer = null;
    const stop = () => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
    };
    const arm = (ms, why) => { clearTimeout(timer); timer = setTimeout(() => { out += `\n[suite] ${why}\n`; stop(); }, ms); };
    arm(waiting ? queueMs : timeoutMs, waiting
      ? `NEVER TOOK THE SHARED BROWSER MUTEX after ${queueMs} ms — killing. Somebody else is holding ${LOCK}`
      : `TIMEOUT after ${timeoutMs} ms — killing`);
    const grab = (c) => {
      out += c.toString();
      if (waiting && out.includes(waiting)) { waiting = null; arm(timeoutMs, `TIMEOUT after ${timeoutMs} ms — killing`); }
    };
    child.stdout.on('data', grab);
    child.stderr.on('data', grab);
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
    child.on('error', (e) => finish({ code: 127, out: `${out}\nspawn error: ${e.message}` }));
    child.on('close', (code) => finish({ code, out }));
  });
}
