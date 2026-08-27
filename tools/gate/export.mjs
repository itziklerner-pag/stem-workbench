/**
 * The `export` probe — driven INSIDE the app by `--gate=DIR --gate-probe=export`.
 *
 * IT PRESSES THE APP'S OWN CONTROLS AND ANSWERS THE REAL NATIVE FILE CHOOSER.
 * Both halves of that sentence are the reason this file is shaped the way it is,
 * and both obvious alternatives are forbidden:
 *
 *   THE DIALOG IS NEVER STUBBED, REPLACED OR MONKEY-PATCHED. Nothing here
 *   assigns to `dialog.showOpenDialog`. The app opens the real GTK chooser
 *   through electron's own module, and this probe answers it the way a person
 *   does — Ctrl+L, type the path, click **Open** — using `xdotool` against the
 *   X display the suite launched under. The count of asks is read off the
 *   counter `src/main/files.js` increments beside the real call.
 *
 *   AND THE GESTURE IS NOT CALLED, IT IS PRESSED — AND THE WRITER IS STILL
 *   DRIVEN. Two generations stand in one gate, because the merged product needs
 *   both, and the header says so in order:
 *
 *   1. THE FOLDER IS SETTLED BY A PRESS. The probe clicks `#source-file` and
 *      `#export` in the real chrome renderer, which go through the real preload
 *      bridge (`src/preload/chrome.cjs`) and the real `ipcMain.handle`s, and it
 *      reads the answer where the USER reads it — off the bar. It never calls
 *      `ensureExportFolder()` or `chooseSourceFile()`.
 *
 *   2. THE STEMS ARE WRITTEN BY THE WRITER. The bar's export control REFUSES by
 *      design — the file has not been separated yet, so `chrome:export` answers
 *      `no-stems` and there is no writer behind it. The writer (`exportStems()`)
 *      is the previous slice's gesture and this probe still drives it directly,
 *      into the folder the press settled. A probe that only pressed could not
 *      see a broken writer; one that only called the writer could not see a
 *      broken control. Each writer drive arms its own chooser answerer, so a
 *      mutation that empties the remembered folder makes the COUNT name the
 *      defect instead of hanging the launch on an unanswered picker.
 *
 * WHY THE FIRST HALF WAS WORTH REWIRING FOR. It used to call the two intake
 * functions directly from inside main, and said so: *"nothing a user can press
 * reaches the intake yet... it is one step short of `docs/TESTING.md` §5c's
 * standard — it drives the real interface, not a private door."* This repository
 * has already paid for that distinction once. The chrome bar's Arm button
 * shipped `disabled`, with a "not built yet" tooltip, for a whole wave AFTER
 * arming worked — every gate stayed green, because every gate called the
 * FUNCTION the button would have called. An auditor found it by clicking.
 * A probe that calls `ensureExportFolder()` cannot tell a working export control
 * from one that is not wired, is `disabled`, or does not exist.
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
 *
 * A THIRD, ABOUT THE BAR'S CLICKS: a native chooser is MODAL to the window, and
 * that grabs INPUT — it does not stop a renderer running script. `b.click()` in
 * the chrome renderer therefore lands while a chooser is up, which is what makes
 * the "a second export joins the first ask" case drivable through the control
 * rather than through the function behind it.
 *
 * ---------------------------------------------------------------------------
 * COUNTS AND POLLS, NEVER SLEEPS
 * ---------------------------------------------------------------------------
 * A press is a round trip — renderer, ipc, main, and back — so every step below
 * WAITS FOR A COUNT to move rather than for a duration to pass: the intake's own
 * `folderAsks` / `fileAsks` / `joinedPending`, or a `data-outcome` the bar sets
 * from what `main` answered. A budget exists only so a broken build fails
 * instead of hanging, and every one of them is reported.
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

/**
 * POLL A COUNT, AND SAY WHAT IT WAS WHEN THE BUDGET RAN OUT.
 *
 * `{ok:false, waitedMs, saw}` rather than a throw or a bare `false`: a step that
 * did not happen has to be reportable, because the assertion above it is the one
 * that names what went wrong and it can only do that from the report.
 */
async function until(what, look, budgetMs = 15000, every = 100) {
  const began = Date.now();
  for (;;) {
    let saw = false;
    try { saw = await look(); } catch (e) { saw = `THREW: ${String((e && e.message) || e)}`; }
    if (saw === true) return { ok: true, what, waitedMs: Date.now() - began };
    if (Date.now() - began > budgetMs) return { ok: false, what, waitedMs: Date.now() - began, saw };
    await sleep(every);
  }
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

  const chromeWc = state.chrome && !state.chrome.webContents.isDestroyed() ? state.chrome.webContents : null;

  /**
   * THE BAR, READ AND PRESSED. Both go through `executeJavaScript` on the REAL
   * chrome renderer — the same handle `tools/gate/probe.mjs` reads the bar with.
   *
   * `press()` RECORDS `disabled` BEFORE IT CLICKS, and that is the whole point of
   * pressing rather than calling: `HTMLElement.click()` on a disabled button
   * does nothing at all, so a control that shipped `disabled` produces no ask,
   * and every count below it goes to zero rather than staying green.
   */
  const read = () => chromeWc.executeJavaScript(`(() => {
    const f = (id) => { const e = document.getElementById(id); return e ? {
      text: String(e.textContent).trim(), title: e.title || null,
      outcome: (e.dataset && e.dataset.outcome) || null, disabled: e.disabled === true,
    } : null; };
    return { exportBtn: f('export'), sourceBtn: f('source-file'), file: f('file'),
             dest: f('dest'), progress: f('progress'), refusal: f('refusal'), url: location.href };
  })()`);
  const press = (id) => chromeWc.executeJavaScript(`(() => {
    const b = document.getElementById(${JSON.stringify(id)});
    if (!b) return { pressed: false, why: 'no #${id} in the chrome bar' };
    const was = { disabled: b.disabled === true, outcome: (b.dataset && b.dataset.outcome) || null };
    b.click();
    return { pressed: true, was };
  })()`);

  const R = {
    gate: 2,
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
    /**
     * THE SECOND INSTRUMENT, and it is about the other end of the gesture: the
     * thing being pressed is the app's own chrome renderer, on the app's own
     * origin, and not a page this probe built.
     */
    chromeUrl: chromeWc ? chromeWc.getURL() : null,
    folderDialogTitle: FOLDER_DIALOG.title,
    fileDialogTitle: FILE_DIALOG.title,
    /** Before any export. The app must not ask for a folder just because it started. */
    asksAtBoot: files ? files.stats.folderAsks : null,
  };

  if (!files || !chromeWc) {
    R.broken = !files
      ? 'state.files is not installed — src/main/main.js did not build the intake'
      : 'the chrome view is gone — there is no bar to press';
    fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(R, null, 2)}\n`);
    return 0;
  }

  // WHAT THE BAR SAYS BEFORE ANYTHING IS PRESSED. In the relaunch this is the
  // visible half of "the folder survived a restart": the destination is on the
  // bar before the first export of the run, not after it.
  R.barAtBoot = await read();

  if (phase === 'first') {
    // ------------------------------------------- export with nothing to export
    /**
     * PRESSED FIRST, BECAUSE IT IS THE ONE ORDER THAT PROVES THE REFUSAL ASKS
     * NOTHING. Once a folder has been chosen the count stops moving anyway, so a
     * "did not ask" measured after the first export would be true of a build with
     * no guard at all.
     */
    R.noSourcePress = await press('export');
    R.noSourceSettled = await until('the bar to draw the no-source refusal',
      async () => ((await read()).exportBtn || {}).outcome !== null, 15000);
    R.afterNoSource = { bar: await read(), folderAsks: files.stats.folderAsks, fileAsks: files.stats.fileAsks };

    // ------------------------------------------------------- the source picker
    if (fixture) {
      R.filePress = await press('source-file');
      const fseen = await waitForChooser(FILE_DIALOG.title, 30000);
      R.fileChooserMapped = !!fseen;
      R.fileAnswered = fseen ? await answerChooser(FILE_DIALOG.title, fixture, 5000) : { answered: false, why: 'no chooser to answer' };
      R.fileSettled = await until('the bar to draw the chosen file',
        async () => ((await read()).sourceBtn || {}).outcome !== null, 30000);
      R.afterPick = { bar: await read(), fileAsks: files.stats.fileAsks };
      /**
       * WHAT REACHED THE INTAKE, read out of `main`'s own state rather than off
       * the bar — because the point of the two readings is that they DIFFER:
       * `main` holds the absolute path and the one-shot token, and the bar is
       * handed the title and the MIME and neither of the other two.
       */
      R.chosen = state.file
        ? { title: state.file.title, mime: state.file.mime, file: state.file.file,
            // THE TOKEN'S VALUE, so the suite can require it to be ABSENT from the
            // bar. Half of that assertion's name is about the token, and a claim
            // nobody checks is the kind this repository keeps paying for. It is
            // spent twice a few lines below and dies with this process either
            // way; the report lives in the gitignored `out/` tree.
            token: state.file.token,
            tokenIsString: typeof state.file.token === 'string' && state.file.token.length > 0 }
        : null;
      // The token, over the RUNNING app's own registry — spent once, then
      // refused. Nothing else in this app can spend it, which is the property.
      if (state.file && state.file.token) {
        R.tokenFirst = state.pathTokens.spend(state.file.token);
        R.tokenSecond = state.pathTokens.spend(state.file.token);
      }
    }

    // ---------------------------------------------------------- export #1
    // The picker opens for real, pressed from the bar. While it is up, the bar's
    // export control is pressed AGAIN — that is not padding, it is the
    // within-one-run half of "asked exactly once", and two stacked native modals
    // is a real defect: the user answers the one in front and the export that
    // gets the folder is the other one. It is drivable from the control because
    // `#export` deliberately does NOT disable itself in flight
    // (src/renderer/chrome.js), and the de-duplication lives beside the picker.
    const rememberedBefore = files.stats.remembered;
    R.export1Press = await press('export');
    const seen = await waitForChooser(FOLDER_DIALOG.title, 30000);
    R.chooserMapped = !!seen;
    R.export1DupPress = await press('export');
    R.joined = await until('the second press to join the ask already in flight',
      async () => files.stats.joinedPending >= 1, 15000);
    R.asksWhileChooserUp = files.stats.folderAsks;
    R.joinedPending = files.stats.joinedPending;

    R.answered = seen ? await answerChooser(FOLDER_DIALOG.title, target, 5000) : { answered: false, why: 'no chooser to answer' };
    R.export1Settled = await until('the chosen folder to be remembered',
      async () => files.stats.remembered > rememberedBefore, 30000);
    R.export1Drawn = await until('the bar to draw the destination',
      async () => ((await read()).dest || {}).text !== '\u2014', 15000);
    R.afterFirst = { bar: await read(), folderAsks: files.stats.folderAsks };

    // THEN THE WRITER — the gesture the previous slice landed, driven directly
    // because the bar refuses `no-stems` by design (no separation exists), so
    // nothing a user can press reaches it. The press settled the folder, so on
    // a healthy build this resolves from memory; a MUTATED build with empty
    // memory opens a picker, and the armed answerer keeps that from hanging
    // the launch — the count below names the defect. Same rule as export #2.
    const w1Watch = answerIfItAppears(FOLDER_ASK_TITLES, target, 6000);
    R.export1 = await within(30000, drive(files.exportStems({ title, stems })), 'the first export');
    R.export1Chooser = await w1Watch;
    R.asksAfterFirst = files.stats.folderAsks;
    R.optionsUsed = files.stats.lastFolderOptions;

    // ---------------------------------------------------------- export #2
    // The remembered folder must answer this one with no picker at all. If a
    // picker DOES open, it is answered so the count says "twice" instead of the
    // launch hanging. See `answerIfItAppears`.
    const memoryBefore = files.stats.folderFromMemory;
    R.export2Press = await press('export');
    const watch = answerIfItAppears(FOLDER_DIALOG.title, target, 6000);
    R.export2Settled = await until('the second export to resolve from memory',
      async () => files.stats.folderFromMemory > memoryBefore, 30000);

    // THE WRITER AGAIN — the same remembered folder, resolved with no picker.
    // Its own answerer stands by, for the same reason export #1's does: a
    // mutated build with empty memory opens a picker per drive, and an
    // unanswered picker is a launch that times out instead of a red that names
    // the count.
    const w2Watch = answerIfItAppears(FOLDER_ASK_TITLES, target, 6000);
    R.export2 = await within(30000, drive(files.exportStems({ title, stems })), 'the second export');
    R.export2Chooser = await w2Watch;
    R.secondChooser = await watch;
    R.afterSecond = { bar: await read(), folderAsks: files.stats.folderAsks };
    R.asksAfterSecond = files.stats.folderAsks;
    R.folderFromMemory = files.stats.folderFromMemory;
    R.stored = readStored(state);

    // -------------------------------------------------------- a refused pick
    // AND A PICK THE ALLOWLIST DOES NOT ADMIT. A native chooser's `filters`
    // narrow what is easy to browse to and decide nothing: Ctrl+L takes any path
    // at all, which is how this probe drives it. So the refusal is driven for
    // real, over the same chooser, with a file that is plainly not audio — and
    // it is the BAR that has to say so, because a picker that closes and
    // produces no outcome is the defect `src/renderer/chrome.js` exists about.
    if (fixture) {
      const notAudio = path.join(path.dirname(fixture), 'sleeve-notes.txt');
      fs.writeFileSync(notAudio, 'not audio\n');
      const refusedBefore = files.stats.refused;
      R.refusedPress = await press('source-file');
      const nseen = await waitForChooser(FILE_DIALOG.title, 30000);
      R.refusedChooserMapped = !!nseen;
      R.refusedAnswered = nseen ? await answerChooser(FILE_DIALOG.title, notAudio, 5000) : { answered: false, why: 'no chooser to answer' };
      R.refusedSettled = await until('the intake to refuse the pick',
        async () => files.stats.refused > refusedBefore, 30000);
      R.refusedDrawn = await until('the bar to draw a refusal on the control that produced it',
        async () => ((await read()).sourceBtn || {}).outcome !== 'ok', 15000);
      R.afterRefused = { bar: await read(), fileAsks: files.stats.fileAsks };
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
    // time, so this export must resolve with no picker — but an export needs a
    // Source, and a new process has none, so the file is chosen again through
    // the same control first. That is the product's own order of gestures.
    if (fixture) {
      R.filePress = await press('source-file');
      const fseen = await waitForChooser(FILE_DIALOG.title, 30000);
      R.fileChooserMapped = !!fseen;
      R.fileAnswered = fseen ? await answerChooser(FILE_DIALOG.title, fixture, 5000) : { answered: false, why: 'no chooser to answer' };
      R.fileSettled = await until('the bar to draw the chosen file',
        async () => ((await read()).sourceBtn || {}).outcome !== null, 30000);
    }
    R.asksBeforeExport = files.stats.folderAsks;

    const memoryBefore = files.stats.folderFromMemory;
    R.export3Press = await press('export');
    const watch = answerIfItAppears(FOLDER_DIALOG.title, target, 6000);
    R.export3Settled = await until('the export after a restart to resolve from memory',
      async () => files.stats.folderFromMemory > memoryBefore, 30000);

    // THE WRITER AFTER A RESTART — the same remembered folder, still no picker.
    // Its own answerer stands by, for the same reason export #1's does.
    const w3Watch = answerIfItAppears(FOLDER_ASK_TITLES, target, 6000);
    R.export3 = await within(30000, drive(files.exportStems({ title, stems })), 'the export after a restart');
    R.export3Chooser = await w3Watch;
    R.restartChooser = await watch;
    R.afterRestart = { bar: await read(), folderAsks: files.stats.folderAsks };
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
    // THE FOLDER IS RE-CHOSEN FROM THE BAR, and the new answer is both stored
    // and drawn. The writer then writes into the NEW folder, not the dead one.
    const rememberedBefore = files.stats.remembered;
    R.export4Press = await press('export');
    const seen4 = await waitForChooser(FOLDER_ASK_TITLES, 30000);
    R.goneChooserMapped = !!seen4;
    R.goneAnswered = seen4 ? await answerChooser(FOLDER_ASK_TITLES, moved, 5000) : { answered: false, why: 'no chooser to answer' };
    R.export4Settled = await until('the new folder to be chosen and remembered',
      async () => files.stats.remembered > rememberedBefore, 30000);
    R.export4Drawn = await until('the bar to draw the new destination',
      async () => ((await read()).dest || {}).title === moved, 15000);
    R.afterGone = { bar: await read(), folderAsks: files.stats.folderAsks };
    R.asksAfterGone = files.stats.folderAsks;
    R.askReason = files.stats.lastAskReason;
    R.storedAfterGone = readStored(state);
    R.fileAsks = files.stats.fileAsks;

    // THE WRITER INTO THE NEW FOLDER — the memory now names `moved`, so this
    // resolves with no ask on a healthy build. Its answerer stands by for a
    // build that keeps the dead path; it must run BEFORE the snapshot below,
    // or export #4's files would not be preserved for the suite to read.
    const w4Watch = answerIfItAppears(FOLDER_ASK_TITLES, moved, 6000);
    R.export4 = await within(30000, drive(files.exportStems({ title, stems })), 'the export after the folder was deleted');
    R.export4Chooser = await w4Watch;

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
  R.tokens = state.pathTokens ? state.pathTokens.stats : null;
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
