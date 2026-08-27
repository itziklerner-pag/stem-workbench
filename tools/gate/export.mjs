/**
 * The `export` probe — driven INSIDE the app by `--gate=DIR --gate-probe=export`.
 *
 * IT ANSWERS THE REAL NATIVE FILE CHOOSER. That is the whole reason this file is
 * shaped the way it is, and it is worth stating before anything else, because
 * the obvious alternative is forbidden:
 *
 *   THE DIALOG IS NEVER STUBBED, REPLACED OR MONKEY-PATCHED. Nothing here
 *   assigns to `dialog.showOpenDialog`. The app opens the real GTK chooser
 *   through electron's own module, and this probe answers it the way a person
 *   does — Ctrl+L, type the path, click **Open** — using `xdotool` against the
 *   X display the suite launched under. The count of asks is read off the
 *   counter `src/main/files.js` increments beside the real call.
 *
 *   WHY IT MATTERS: a gate that substitutes its own `dialog` asserts a fact
 *   about the stub's call count, not about the app. The real picker could then
 *   be opened twice, never, or with `openFile` instead of `openDirectory`, and
 *   the gate would stay green. `docs/TESTING.md` §3 rule 7 — a suite that cannot
 *   look FAILS — is the same rule from the other side.
 *
 * ---------------------------------------------------------------------------
 * THE ONE MACHINE FACT THIS COST AN AFTERNOON TO FIND, RECORDED SO NOBODY PAYS
 * FOR IT TWICE
 * ---------------------------------------------------------------------------
 * On a box with a D-Bus session bus but NO `xdg-desktop-portal`, Chromium's file
 * dialog asks the portal and **never falls back to GTK**. Measured here: no
 * window ever maps, `xwininfo -root -tree` shows only the app's own windows, and
 * `showOpenDialog`'s promise never settles — for as long as you care to wait.
 * The log line is `Failed to register with org.freedesktop.host.portal.Registry`.
 *
 * With `DBUS_SESSION_BUS_ADDRESS` out of the environment the in-process GTK
 * chooser maps immediately and can be driven. `tools/suites/export.mjs` therefore
 * launches this app with that variable removed, and says so in its header. It is
 * a property of the box, exactly like "no `$DISPLAY`".
 *
 * TWO THINGS ABOUT `xdotool` THAT ARE NOT OPTIONAL:
 *   · THE CLICK MUST BE XTEST, NOT `--window`. `xdotool click --window <id>`
 *     sends the button event with `XSendEvent`, which GTK ignores
 *     (`send_event=True`). Measured: the pointer was over the Open button, the
 *     click was delivered, and the dialog did not move. `mousemove` to absolute
 *     coordinates followed by a bare `click` uses XTEST and works.
 *   · RETURN IN THE LOCATION BAR CANCELS. With the path typed and visible in the
 *     entry, `xdotool key Return` closed the chooser with
 *     `{canceled: true, filePaths: []}` on every attempt. The Open button is
 *     what accepts. Both were measured, twice.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { dialog } from 'electron';

import { FOLDER_DIALOG, FILE_DIALOG, EXPORT_FOLDER_KEY } from '../../src/main/files.js';
import { STEMS } from '../../vendor/stem-splitter-live/extension/shared/config.js';

/**
 * The names a FOLDER ask can wear. The healthy app always asks with
 * `FOLDER_DIALOG.title`; the battery's case-15 mutation copies FILE_DIALOG
 * wholesale — TITLE included — so the ask can arrive named "Choose an audio
 * file". The answerers must reach the picker under EITHER name, or a mutated
 * ask hangs every drive until the suite's stopwatch kills the launch.
 */
const FOLDER_ASK_TITLES = [FOLDER_DIALOG.title, FILE_DIALOG.title];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * WHERE THE OPEN BUTTON IS, as an offset from the chooser's bottom-right corner.
 *
 * Measured on this box at 1124x822: the button's centre is (1075, 797), i.e.
 * (49, 25) in from the corner. GTK packs the action area against that corner, so
 * the offset does not move with the dialog's SIZE — but it does depend on the
 * theme's padding, so two more are tried before giving up, and a click that did
 * not close the chooser is reported as a failure to answer rather than as a
 * cancelled pick. A silent "the user cancelled" is the one outcome that would
 * look like the app's fault.
 */
const OPEN_BUTTON_OFFSETS = [[49, 25], [49, 32], [62, 25]];

function xdo(args) {
  const r = spawnSync('xdotool', args, { encoding: 'utf8' });
  return { code: r.status, out: String(r.stdout || '').trim(), err: String(r.error || r.stderr || '').trim() };
}

const haveXdotool = () => xdo(['getactivewindow']).code !== null;

/**
 * Every window whose name is exactly one of `titleOrTitles` (a string or an
 * array), newest last. The battery's case 15 renames the folder ask to the
 * file picker's title, so a FOLDER ask can wear either name.
 */
function chooserIds(titleOrTitles) {
  const titles = Array.isArray(titleOrTitles) ? titleOrTitles : [titleOrTitles];
  for (const t of titles) {
    const r = xdo(['search', '--name', `^${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`]);
    if (r.code === 0 && r.out.trim()) return r.out.split('\n').filter(Boolean);
  }
  return [];
}

async function waitForChooser(titleOrTitles, budgetMs) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const ids = chooserIds(titleOrTitles);
    if (ids.length) return ids[ids.length - 1];
    await sleep(200);
  }
  return null;
}

function geometryOf(id) {
  const g = {};
  for (const line of xdo(['getwindowgeometry', '--shell', id]).out.split('\n')) {
    const [k, v] = line.split('=');
    if (k) g[k] = Number(v);
  }
  return g;
}

/**
 * Answer a native chooser with `target`, the way a person does.
 *
 * @returns {{answered: boolean, why?: string, at?: number[], waitedMs: number}}
 */
async function answerChooser(titleOrTitles, target, budgetMs) {
  const began = Date.now();
  if (!haveXdotool()) return { answered: false, why: 'xdotool is not on PATH', waitedMs: 0 };
  const id = await waitForChooser(titleOrTitles, budgetMs);
  if (!id) return { answered: false, why: `no window named "${String(titleOrTitles)}" mapped`, waitedMs: Date.now() - began };

  xdo(['windowactivate', '--sync', id]);
  xdo(['windowfocus', '--sync', id]);
  await sleep(400);
  xdo(['key', '--clearmodifiers', 'ctrl+l']);      // the location entry
  await sleep(500);
  xdo(['type', '--delay', '15', target]);
  await sleep(600);

  const g = geometryOf(id);
  for (const [dx, dy] of OPEN_BUTTON_OFFSETS) {
    xdo(['mousemove', String((g.X || 0) + g.WIDTH - dx), String((g.Y || 0) + g.HEIGHT - dy)]);
    await sleep(250);
    xdo(['click', '1']);                            // XTEST — see the header
    await sleep(900);
    if (!chooserIds(titleOrTitles).includes(id)) return { answered: true, at: [dx, dy], waitedMs: Date.now() - began };
  }
  // The Open click did not close it. In a healthy build that never happens —
  // the measured answerer closes the real chooser on the first click. It only
  // fires when the picker CANNOT be answered, which is the battery's case 15:
  // the folder ask opened with a FILE picker's options — title included, so
  // the answerer reaches it by matching either name — accepts no folder at
  // all, and a drive sitting on the ask would time out the whole launch
  // instead of reporting the refusal. Escape is how a person gives up; the ask
  // then resolves as a refusal, and the suite reads it as data — a red that
  // names the count, never a TIMEOUT that drowns it.
  xdo(['key', '--clearmodifiers', 'Escape']);
  await sleep(900);
  if (!chooserIds(titleOrTitles).includes(id)) return { answered: false, cancelled: true, why: 'the Open button did not close it — cancelled with Escape', waitedMs: Date.now() - began };
  return { answered: false, why: 'the Open button did not respond to a click', waitedMs: Date.now() - began };
}

/**
 * Answer a chooser ONLY IF ONE APPEARS, within a short budget.
 *
 * This is what keeps a MUTATED build honest instead of hung. The mutation that
 * deletes the persisted-folder read makes the second export open a picker that
 * nobody would otherwise answer — the probe would sit on it until the suite's
 * stopwatch killed the launch, and the red would read "TIMEOUT" rather than
 * "asked twice". Answering it produces the count that names the defect.
 */
async function answerIfItAppears(titleOrTitles, target, budgetMs) {
  if (!chooserIds(titleOrTitles).length && !(await waitForChooser(titleOrTitles, budgetMs))) return { appeared: false };
  const r = await answerChooser(titleOrTitles, target, 1000);
  return { appeared: true, ...r };
}

/** Never let one hung await cost every assertion after it. */
async function within(ms, promise, what) {
  let timer;
  const t = new Promise((res) => { timer = setTimeout(() => res({ TIMED_OUT: `${what} did not settle in ${ms} ms` }), ms); });
  try { return await Promise.race([promise, t]); } finally { clearTimeout(timer); }
}

export async function runGate({ state, outDir }) {
  fs.mkdirSync(outDir, { recursive: true });

  const phase = process.env.WB_EXPORT_PHASE || 'first';
  const target = process.env.WB_EXPORT_TARGET || path.join(outDir, 'stems');
  const fixture = process.env.WB_EXPORT_FIXTURE || '';
  fs.mkdirSync(target, { recursive: true });

  const files = state.files;

  // ---------------------------------------------------------- the writer plan
  // The suite wrote the synthetic planes and passed them here, so there is ONE
  // generator — the suite's — and this probe consumes it. The independence
  // that matters is the other half: NEITHER side of the gate uses the vendored
  // `encodeWav` to derive expected bytes. The encoder is exercised only by the
  // app under test; the expected bytes are a plain Buffer serializer in the
  // suite. A gate that checked the encoder against itself could not tell a
  // wrong header from a changed one.
  const title = process.env.WB_EXPORT_TITLE || 'Gate Song';
  const stems = wbPlanes(process.env.WB_EXPORT_PLANES);

  // A refusal (the cancelled picker) and a crash (a mutated writer) are both
  // THROWS out of the writer, and a probe that died on one would redden every
  // assertion after it instead of the one it names. Every writer drive below
  // goes through this, so a throw lands in the report as `{threw: ...}`.
  const drive = (p) => p.then((r) => r, (e) => ({ threw: String((e && e.message) || e) }));

  const R = {
    gate: 1,
    phase,
    when: new Date().toISOString(),
    versions: process.versions,
    display: process.env.DISPLAY || null,
    dbus: process.env.DBUS_SESSION_BUS_ADDRESS || null,
    target,
    fixture,
    title,
    planesBroken: stems === null,
    planesFrames: stems ? stems[STEMS[0]][0].length : null,
    /**
     * THE INSTRUMENT CHECK, and it is the first thing recorded. Everything below
     * is a count of asks, and a count of asks is a fact about this app only if
     * the picker being counted is electron's own. `usesDialog` compares the
     * module object the app is holding with the one imported here.
     */
    dialogIsElectron: !!(files && files.usesDialog(dialog)),
    folderDialogTitle: FOLDER_DIALOG.title,
    fileDialogTitle: FILE_DIALOG.title,
    /** Before any export. The app must not ask for a folder just because it started. */
    asksAtBoot: files ? files.stats.folderAsks : null,
  };

  if (!files) {
    R.broken = 'state.files is not installed — src/main/main.js did not build the intake';
    fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(R, null, 2)}\n`);
    return 0;
  }

  if (phase === 'first') {
    // ---------------------------------------------------------- export #1
    // THE FIRST EXPORT IS THE WRITER, `exportStems()` — the gesture this step
    // is about. The picker opens for real. While it is up, a SECOND export is
    // requested — that is not padding, it is the within-one-run half of "asked
    // exactly once" and two stacked native modals is a real defect: the user
    // answers the one in front and the export that gets the folder is the
    // other one. Both drives stand behind the same `ensureExportFolder()`, so
    // the dialog, the count and the join all sit exactly where they sat.
    const p1 = files.exportStems({ title, stems });
    const seen = await waitForChooser(FOLDER_ASK_TITLES, 30000);
    R.chooserMapped = !!seen;
    const pDup = files.exportStems({ title, stems });
    R.asksWhileChooserUp = files.stats.folderAsks;
    R.joinedPending = files.stats.joinedPending;

    R.answered = seen ? await answerChooser(FOLDER_ASK_TITLES, target, 5000) : { answered: false, why: 'no chooser to answer' };
    R.export1 = await within(30000, drive(p1), 'the first export');
    R.export1dup = await within(30000, drive(pDup), 'the export that joined the first ask');
    R.asksAfterFirst = files.stats.folderAsks;
    R.optionsUsed = files.stats.lastFolderOptions;

    // ---------------------------------------------------------- export #2
    // The remembered folder must answer this one with no picker at all. If a
    // picker DOES open, it is answered so the count says "twice" instead of the
    // launch hanging. See `answerIfItAppears`.
    const p2 = files.exportStems({ title, stems });
    const watch = answerIfItAppears(FOLDER_ASK_TITLES, target, 6000);
    R.export2 = await within(30000, drive(p2), 'the second export');
    R.secondChooser = await watch;
    R.asksAfterSecond = files.stats.folderAsks;
    R.stored = readStored(state);

    // ------------------------------------------------------- the file picker
    if (fixture) {
      const pf = files.chooseSourceFile();
      const fseen = await waitForChooser(FILE_DIALOG.title, 30000);
      R.fileChooserMapped = !!fseen;
      R.fileAnswered = fseen ? await answerChooser(FILE_DIALOG.title, fixture, 5000) : { answered: false, why: 'no chooser to answer' };
      const picked = await within(30000, pf, 'the file pick');
      R.picked = picked;
      // The token, over the RUNNING app's own registry — spent once, then
      // refused. Nothing else in this app can spend it, which is the property.
      if (picked && picked.ok) {
        R.tokenFirst = state.pathTokens.spend(picked.token);
        R.tokenSecond = state.pathTokens.spend(picked.token);
      }

      // AND A PICK THE ALLOWLIST DOES NOT ADMIT. A native chooser's `filters`
      // narrow what is easy to browse to and decide nothing: Ctrl+L takes any
      // path at all, which is how this probe drives it. So the refusal is driven
      // for real, over the same chooser, with a file that is plainly not audio.
      const notAudio = path.join(path.dirname(fixture), 'sleeve-notes.txt');
      fs.writeFileSync(notAudio, 'not audio\n');
      const pn = files.chooseSourceFile();
      const nseen = await waitForChooser(FILE_DIALOG.title, 30000);
      R.refusedChooserMapped = !!nseen;
      R.refusedAnswered = nseen ? await answerChooser(FILE_DIALOG.title, notAudio, 5000) : { answered: false, why: 'no chooser to answer' };
      R.refusedPick = await within(30000, pn, 'the refused file pick');
      R.notAudio = notAudio;
    }
    R.fileAsks = files.stats.fileAsks;

    // -------------------------------------------- THE TITLE CANNOT ESCAPE
    // G2b-PATH, DRIVEN, NOT MERELY DERIVED. The pure section proves no title
    // can BE a path; this drives the WRITER with two titles that are paths —
    // `../../escape` and a trailing dot — and reads the files BACK off the
    // disk. A title that escaped would be a write outside the folder the user
    // chose; `../../escape` resolving inside it is the whole point of
    // `sanitiseTitle`, asserted where it is used.
    //
    // The folder is remembered by now, so on a healthy build these open no
    // picker and the answerers below see nothing. A MUTATED build with empty
    // memory opens one per drive, and an unanswered picker is a launch that
    // times out instead of a red that names the count — the battery's cases 12
    // and 14 land here. Each drive arms its own answerer, the same way export
    // #2 does: the ask is answered or cancelled for real, and the count says
    // what the defect is.
    const escWatch = answerIfItAppears(FOLDER_ASK_TITLES, target, 6000);
    R.escape = await within(30000, drive(files.exportStems({ title: '../../escape', stems })), 'the escape-attempt export');
    R.escapeChooser = await escWatch;
    const trailWatch = answerIfItAppears(FOLDER_ASK_TITLES, target, 6000);
    R.trailing = await within(30000, drive(files.exportStems({ title: 'trailing.', stems })), 'the trailing-dot export');
    R.trailingChooser = await trailWatch;
    R.asksAfterEscape = files.stats.folderAsks;

    // ---------------------------------------------------- THE EXPORT SINK
    // THE ENGINE-FACING HALF, DRIVEN FROM THE ENGINE RENDERER. The duty in
    // `extension/offscreen/host.js` is imported LIVE in the running engine —
    // the same module instance the vendored engine holds — and driven through
    // the real preload bridge to the real main-process session: streams opened
    // in the renderer, chunks over ipc, bytes on disk. The folder is remembered
    // by now, so the sink's one ask is served from memory and the count stays
    // 1. The payload of each file is its own name padded to 8 bytes; the suite
    // re-derives those bytes itself, from the same rule.
    const sinkTitle = 'sink-probe';
    const sinkFiles = ['a.wav', 'b.wav'];
    const jsSink = `(async () => {
      const host = await import('/vendor/stem-splitter-live/extension/offscreen/host.js');
      const plan = { title: ${JSON.stringify(sinkTitle)}, files: ${JSON.stringify(sinkFiles)} };
      const sinks = await host.exportSink(plan);
      const names = Object.keys(sinks).sort();
      const wrote = {};
      const payload = (name) => { const b = new Uint8Array(8); for (let i = 0; i < 8; i++) b[i] = i < name.length ? name.charCodeAt(i) : 0; return b; };
      for (const name of ${JSON.stringify(sinkFiles)}) {
        const w = sinks[name].getWriter();
        await w.write(payload(name));
        await w.close();
        wrote[name] = 8;
      }
      return { names, wrote, stats: host.__hostStats() };
    })()`;
    const sinkWatch = answerIfItAppears(FOLDER_ASK_TITLES, target, 6000);
    R.sinkDrive = await within(30000,
      state.engineWin.webContents.executeJavaScript(jsSink).then((r) => r, (e) => ({ threw: String((e && e.message) || e) })),
      'the export sink seam');
    R.sinkChooser = await sinkWatch;
    const sinkDir = path.join(target, sinkTitle);
    let sinkOnDisk = null;
    const sinkSizes = {};
    try {
      sinkOnDisk = fs.readdirSync(sinkDir).sort();
      for (const n of sinkOnDisk) sinkSizes[n] = fs.statSync(path.join(sinkDir, n)).size;
    } catch { /* asserted */ }
    R.sinkDir = sinkDir;
    R.sinkOnDisk = sinkOnDisk;
    R.sinkSizes = sinkSizes;
    R.asksAfterSink = files.stats.folderAsks;

    // THE PHASE-1 ARTIFACTS, PRESERVED. The phase-2 launch DELETES `target` —
    // that is G4's scenario — so the suite cannot read the phase-1 files back
    // after both launches. Snapshot the whole target tree here, where it still
    // exists; the suite reads its bytes through this path.
    const snap1 = path.join(outDir, 'phase1-files');
    try {
      fs.cpSync(target, snap1, { recursive: true });
      R.phase1Snapshot = snap1;
    } catch (e) {
      R.phase1Snapshot = null;
      R.phase1SnapshotError = String((e && e.message) || e);
    }
  } else {
    // ------------------------------------------------- the relaunch (phase 2)
    // Same profile, new process. The folder was written to the `local` area last
    // time, so this export — the WRITER again, so G4 is asserted about the
    // gesture that matters — must resolve with no picker. A picker that opens
    // anyway is answered, for the same reason as above.
    const p3 = files.exportStems({ title, stems });
    const watch = answerIfItAppears(FOLDER_ASK_TITLES, target, 6000);
    R.export3 = await within(30000, drive(p3), 'the export after a restart');
    R.restartChooser = await watch;
    R.asksAfterRestart = files.stats.folderAsks;
    R.stored = readStored(state);

    // PRESERVE EXPORT #3'S FILES. The deleted-folder scenario below removes
    // `target` itself; the suite reads these files back after both launches.
    const snapTarget = path.join(outDir, 'phase2-target');
    try {
      fs.cpSync(target, snapTarget, { recursive: true });
      R.phase2Target = snapTarget;
    } catch (e) {
      R.phase2Target = null;
      R.phase2TargetError = String((e && e.message) || e);
    }

    /**
     * AND THEN THE FOLDER IS DELETED BEHIND THE APP'S BACK — issue #6's case.
     *
     * A remembered path is a claim about a filesystem nobody told us had
     * changed. The user deletes the folder, or unmounts the drive it was on, and
     * the next export must ask rather than write six stems into a path that is
     * gone. It runs LAST in this phase, after the assertions above have read
     * their counts, so nothing before it sees a moved folder.
     *
     * The replacement is a DIFFERENT directory, so "it asked again" and "it took
     * the new answer" are two facts rather than one: a build that asked and then
     * kept the dead path would satisfy the first on its own.
     */
    const moved = `${target} (moved)`;
    fs.mkdirSync(moved, { recursive: true });
    fs.rmSync(target, { recursive: true, force: true });
    R.deleted = target;
    R.moved = moved;
    const p4 = files.exportStems({ title, stems });
    const seen4 = await waitForChooser(FOLDER_ASK_TITLES, 30000);
    R.goneChooserMapped = !!seen4;
    R.goneAnswered = seen4 ? await answerChooser(FOLDER_ASK_TITLES,moved, 5000) : { answered: false, why: 'no chooser to answer' };
    R.export4 = await within(30000, drive(p4), 'the export after the folder was deleted');
    R.asksAfterGone = files.stats.folderAsks;
    R.askReason = files.stats.lastAskReason;
    R.storedAfterGone = readStored(state);

    // PRESERVE EXPORT #4'S FILES. The refusal drive below deletes `moved`
    // again — its own scenario — so these would vanish before the suite reads
    // them.
    const snapMoved = path.join(outDir, 'phase2-moved');
    try {
      fs.cpSync(moved, snapMoved, { recursive: true });
      R.phase2Moved = snapMoved;
    } catch (e) {
      R.phase2Moved = null;
      R.phase2MovedError = String((e && e.message) || e);
    }

    // -------------------------------------------- THE REFUSED SINK OPEN
    // The user CANCELS the folder picker mid-gesture — the ordinary refusal,
    // and the one the contract is most explicit about: a refusal is a THROW,
    // never an empty map. The folder is deleted again so the sink's one ask
    // happens for real, and the chooser is answered with Escape, which is how
    // a person cancels. The duty must throw with a sentence; "exported
    // nothing" and "exported zero files" must not be the same answer.
    fs.rmSync(moved, { recursive: true, force: true });

    // THE CANCEL IS ARMED BEFORE THE ASK — a hard-won order. A cancel that
    // runs first and waits for a chooser the ask has not opened yet would
    // burn its budget, leave the picker up, and a later background answerer
    // would pick the folder as if the user had — "cancelled" measured as a
    // real open. Armed together, the ask opens the picker, this answers it
    // with Escape, and the refusal lands as a throw.
    const refusalCancel = cancelChooser(FOLDER_ASK_TITLES, 30000);
    const jsRefused = `(async () => {
      const host = await import('/vendor/stem-splitter-live/extension/offscreen/host.js');
      try {
        const sinks = await host.exportSink({ title: 'refused-probe', files: ['x.wav'] });
        return { threw: null, got: Object.keys(sinks) };
      } catch (e) { return { threw: String((e && e.message) || e) }; }
    })()`;
    R.sinkRefused = await within(30000,
      state.engineWin.webContents.executeJavaScript(jsRefused).then((r) => r, (e) => ({ threw: String((e && e.message) || e) })),
      'the refused sink open');
    R.sinkRefusalChooser = await refusalCancel;
    R.asksAfterRefusal = files.stats.folderAsks;

    // --------------------------------------- THE MAIN GATE, BYPASSED DUTY
    // The duty refuses an empty plan before it reaches main — a compromised
    // renderer could call the preload directly, and main's own gate is what
    // answers that call. The "empty map" defect is refused at the one place
    // that can refuse it.
    R.sinkBadPlan = await within(10000,
      state.engineWin.webContents.executeJavaScript('window.__wbEngine.openExportSink({ title: "x", files: [] })')
        .then((r) => r, (e) => ({ threw: String((e && e.message) || e) })),
      'the bad-plan refusal');

    // -------------------------------- A NAME THAT ESCAPES THE FOLDER
    // The Host owns the directory; a plan naming `../../sink-escape.wav` must
    // be refused BEFORE any file is opened. If a mutated build lets it through,
    // the open would ASK for the (deleted) folder again — so a background
    // answerer stands by and answers with `moved`, and the red lands as a
    // wrong answer or a file outside the folder, never as a hung probe.
    const jsBadName = `(async () => {
      const host = await import('/vendor/stem-splitter-live/extension/offscreen/host.js');
      try {
        const sinks = await host.exportSink({ title: 'x', files: ['../../sink-escape.wav'] });
        for (const name of Object.keys(sinks)) await sinks[name].getWriter().write(new Uint8Array(1));
        return { threw: null, got: Object.keys(sinks) };
      } catch (e) { return { threw: String((e && e.message) || e) }; }
    })()`;
    const escapeWatch = answerIfItAppears(FOLDER_ASK_TITLES, moved, 5000);
    R.sinkBadName = await within(30000,
      state.engineWin.webContents.executeJavaScript(jsBadName).then((r) => r, (e) => ({ threw: String((e && e.message) || e) })),
      'the bad-name refusal');
    R.sinkBadNameChooser = await escapeWatch;
    R.sinkBadNameEscapedFile = fs.existsSync(path.resolve(path.join(moved, 'x'), '../../sink-escape.wav'));
  }

  R.stats = { ...files.stats };
  fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(R, null, 2)}\n`);
  console.log(`[gate] export phase=${phase} wrote ${path.join(outDir, 'report.json')}`);
  return 0;
}

/**
 * ANSWER THE REAL CHOOSER AS A PERSON WHO CANCELS — Escape. GTK's file chooser
 * closes with `{canceled: true}` on Escape, which is the ordinary way a gesture
 * ends. The picker is the real one and this is a real answer to it, exactly as
 * `answerChooser`'s Open click is. Measured, not assumed, the first time the
 * refusal drive runs.
 */
async function cancelChooser(titleOrTitles, budgetMs) {
  const began = Date.now();
  if (!haveXdotool()) return { cancelled: false, why: 'xdotool is not on PATH', waitedMs: 0 };
  const id = await waitForChooser(titleOrTitles, budgetMs);
  if (!id) return { cancelled: false, why: `no window named "${String(titleOrTitles)}" mapped`, waitedMs: Date.now() - began };
  xdo(['windowactivate', '--sync', id]);
  xdo(['windowfocus', '--sync', id]);
  await sleep(400);
  xdo(['key', '--clearmodifiers', 'Escape']);
  await sleep(900);
  if (!chooserIds(titleOrTitles).includes(id)) return { cancelled: true, waitedMs: Date.now() - began };
  return { cancelled: false, why: 'Escape did not close the chooser', waitedMs: Date.now() - began };
}

/**
 * The suite's synthetic planes, rebuilt here from the JSON it passed. Six stems
 * in `STEMS` order, each a stereo Float32Array pair; the values are the dyadic
 * rationals `±(0.25 + 0.125*i) * (0.5 + 0.0625*(j%8))`, which are EXACT in
 * Float32 — so a byte-for-byte comparison against the written WAVs cannot be
 * thrown off by rounding. Returns null when the env is absent or unparsable;
 * the suite asserts `planesBroken` is false, so a bad gate config is a loud
 * red, never a silent skip.
 */
function wbPlanes(json) {
  try {
    const obj = JSON.parse(json);
    const out = {};
    for (const [i, stem] of STEMS.entries()) {
      const pair = obj && obj[stem];
      if (!Array.isArray(pair) || pair.length !== 2) return null;
      const [L, R] = pair;
      if (!Array.isArray(L) || !Array.isArray(R) || L.length === 0 || L.length !== R.length) return null;
      out[stem] = [Float32Array.from(L), Float32Array.from(R)];
    }
    return out;
  } catch { return null; }
}

/**
 * What is in the two storage areas under the export folder's key, read through
 * the app's own store. BOTH are read, not just the one the code should use — a
 * folder that turned up in `session` instead of `local` is the mutation G4
 * exists for, and a report that only looked at `local` would say "absent" for
 * it, which is true but does not name what happened.
 */
function readStored(state) {
  const one = (area) => { try { return state.storage.get(area, EXPORT_FOLDER_KEY); } catch (e) { return `THREW: ${(e && e.message) || e}`; } };
  return { local: one('local'), session: one('session') };
}
