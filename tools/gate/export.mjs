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

/** Every window whose name is exactly `title`, newest last. */
function chooserIds(title) {
  const r = xdo(['search', '--name', `^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`]);
  return r.code === 0 ? r.out.split('\n').filter(Boolean) : [];
}

async function waitForChooser(title, budgetMs) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const ids = chooserIds(title);
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
async function answerChooser(title, target, budgetMs) {
  const began = Date.now();
  if (!haveXdotool()) return { answered: false, why: 'xdotool is not on PATH', waitedMs: 0 };
  const id = await waitForChooser(title, budgetMs);
  if (!id) return { answered: false, why: `no window named "${title}" mapped`, waitedMs: Date.now() - began };

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
    if (!chooserIds(title).includes(id)) return { answered: true, at: [dx, dy], waitedMs: Date.now() - began };
  }
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
async function answerIfItAppears(title, target, budgetMs) {
  if (!chooserIds(title).length && !(await waitForChooser(title, budgetMs))) return { appeared: false };
  const r = await answerChooser(title, target, 1000);
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
  const R = {
    gate: 1,
    phase,
    when: new Date().toISOString(),
    versions: process.versions,
    display: process.env.DISPLAY || null,
    dbus: process.env.DBUS_SESSION_BUS_ADDRESS || null,
    target,
    fixture,
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
    // The picker opens for real. While it is up, a SECOND export is requested —
    // that is not padding, it is the within-one-run half of "asked exactly once"
    // and two stacked native modals is a real defect: the user answers the one
    // in front and the export that gets the folder is the other one.
    const p1 = files.ensureExportFolder();
    const seen = await waitForChooser(FOLDER_DIALOG.title, 30000);
    R.chooserMapped = !!seen;
    const pDup = files.ensureExportFolder();
    R.asksWhileChooserUp = files.stats.folderAsks;
    R.joinedPending = files.stats.joinedPending;

    R.answered = seen ? await answerChooser(FOLDER_DIALOG.title, target, 5000) : { answered: false, why: 'no chooser to answer' };
    R.export1 = await within(30000, p1, 'the first export');
    R.export1dup = await within(30000, pDup, 'the export that joined the first ask');
    R.asksAfterFirst = files.stats.folderAsks;
    R.optionsUsed = files.stats.lastFolderOptions;

    // ---------------------------------------------------------- export #2
    // The remembered folder must answer this one with no picker at all. If a
    // picker DOES open, it is answered so the count says "twice" instead of the
    // launch hanging. See `answerIfItAppears`.
    const p2 = files.ensureExportFolder();
    const watch = answerIfItAppears(FOLDER_DIALOG.title, target, 6000);
    R.export2 = await within(30000, p2, 'the second export');
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
  } else {
    // ------------------------------------------------- the relaunch (phase 2)
    // Same profile, new process. The folder was written to the `local` area last
    // time, so this export must resolve with no picker. A picker that opens
    // anyway is answered, for the same reason as above.
    const p3 = files.ensureExportFolder();
    const watch = answerIfItAppears(FOLDER_DIALOG.title, target, 6000);
    R.export3 = await within(30000, p3, 'the export after a restart');
    R.restartChooser = await watch;
    R.asksAfterRestart = files.stats.folderAsks;
    R.stored = readStored(state);
  }

  R.stats = { ...files.stats };
  fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(R, null, 2)}\n`);
  console.log(`[gate] export phase=${phase} wrote ${path.join(outDir, 'report.json')}`);
  return 0;
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
