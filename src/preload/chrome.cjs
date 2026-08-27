/**
 * The CHROME view's bridge — our own 44 px bar, the first thing the owner
 * touches. `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
 *
 * It is NOT on the bus. The chrome view is the Host's own surface, not one of
 * the unit's three addresses, and putting it on the bus would give a renderer
 * with no duties a seat at the engine's traffic.
 *
 * WHAT IS HERE: a one-way status feed pushed by `main`, and the FOUR GESTURES a
 * desktop app has nowhere else to put — ARM (HOST-DESIGN.md §6.4 — this is the
 * surface that carries it), the auto-update toggle, the SOURCE PICKER and the
 * EXPORT. Every one of them is `invoke`, not `send`, because the bar has to draw
 * the ANSWER: `arm()` refuses when there is no page in the source view, the
 * picker can be cancelled or answer with a file the allowlist does not admit,
 * and an export refuses when there is nothing yet to export. A button that
 * swallowed any of those would be the dead control this one replaced.
 *
 * IT IS STILL NOT ON THE BUS. `deck:arm` reaches `main`, which calls the same
 * `deckHost.arm()` the menu item calls; nothing here talks to the engine or the
 * deck directly.
 */
const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Set();

ipcRenderer.on('chrome:status', (_event, status) => {
  for (const fn of [...listeners]) {
    try { fn(status); } catch (err) { console.error('[wb] status listener threw', err); }
  }
});

contextBridge.exposeInMainWorld('__wbChrome', {
  /** @returns an unsubscribe function. */
  onStatus: (fn) => {
    if (typeof fn !== 'function') throw new TypeError('onStatus(fn): fn must be a function');
    listeners.add(fn);
    ipcRenderer.send('chrome:ready');     // ask main to push the current status
    return () => listeners.delete(fn);
  },
  /**
   * THE ARM GESTURE. One channel and a direction, because arming and disarming
   * are the same button and the bar must not have to guess which one it is
   * looking at — `main` holds the epoch and answers with the new state.
   *
   * @param {boolean} on  true = arm, false = disarm
   * @returns {Promise<{ok: boolean, armed: boolean, kind?: string, message?: string}>}
   */
  arm: (on) => ipcRenderer.invoke('chrome:arm', on === true),

  /**
   * THE AUTO-UPDATE TOGGLE — seed §14: *"default ON with a visible toggle"*.
   *
   * `invoke`, like `arm`, and for the same reason: the preference is written to
   * disk by `main` and the effective state can differ from what the checkbox was
   * clicked to — under `--gate` the command line keeps the check off whatever
   * the user stored. A control that painted its own click would show the user a
   * setting the app is not honouring.
   *
   * The CURRENT value is not read through here at all: it arrives on the status
   * push, so there is one direction of truth and the bar cannot disagree with
   * itself between a push and a poll.
   *
   * @param {boolean} on
   * @returns {Promise<{ok: boolean, autoUpdate: boolean|null, stored?: boolean, kind?: string, message?: string}>}
   */
  setAutoUpdate: (on) => ipcRenderer.invoke('chrome:autoUpdate', on === true),

  /**
   * THE SOURCE PICKER — the File source's own gesture, and the one control that
   * reaches `src/main/files.js`'s intake.
   *
   * `invoke`, like the two above, and for the third instance of the same reason:
   * the picker can be CANCELLED, and it can answer with a file the allowlist
   * does not admit. Both are refusals with a sentence attached, and a gesture
   * that swallowed either would be the dead control this bridge's own bar was
   * rewritten to fix.
   *
   * WHAT COMES BACK CARRIES NO PATH AND NO TOKEN. `chooseSourceFile()` answers
   * `main` with `{file, title, mime, token, ttlMs}`; `main` keeps the first and
   * the fourth and hands this renderer the title and the MIME. That is not
   * tidiness: the whole point of the one-shot path token in `files.js` is that
   * *"the renderer that fetches the bytes must not be able to name a path"*, and
   * a bridge that returned the record whole would put the path — and a live
   * capability — on the least privileged surface in the app.
   *
   * @returns {Promise<{ok: boolean, title?: string, mime?: string, code?: string, message?: string}>}
   */
  chooseFile: () => ipcRenderer.invoke('chrome:chooseFile'),

  /**
   * THE EXPORT GESTURE — settle where stems go, then write them.
   *
   * ONE CHANNEL FOR THE WHOLE GESTURE, not one for the folder and one for the
   * write. The folder is not a separate thing a user chooses; it is the first
   * question of an export, asked once ever (`src/main/files.js`
   * `ensureExportFolder()`), and splitting it here would give the renderer a way
   * to open a native folder picker that no export was waiting on.
   *
   * NOT `send`. The answer is the point — where the stems went, or why they did
   * not — and it is drawn on the bar.
   *
   * @returns {Promise<{ok: boolean, dir?: string, asked?: boolean, code?: string, message?: string}>}
   */
  exportStems: () => ipcRenderer.invoke('chrome:export'),
});
