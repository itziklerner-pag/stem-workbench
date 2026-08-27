/**
 * The CHROME view's bridge — our own 44 px bar, the first thing the owner
 * touches. `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
 *
 * It is NOT on the bus. The chrome view is the Host's own surface, not one of
 * the unit's three addresses, and putting it on the bus would give a renderer
 * with no duties a seat at the engine's traffic.
 *
 * WHAT IS HERE: a one-way status feed pushed by `main`, and the ARM GESTURE
 * (HOST-DESIGN.md §6.4 — this is the surface that carries it). The gesture is
 * `invoke`, not `send`, because the bar has to draw the ANSWER: `arm()` refuses
 * when there is no page in the source view, and a button that swallowed that
 * refusal would be the dead control this one replaced.
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
});
