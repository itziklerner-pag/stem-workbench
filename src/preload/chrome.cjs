/**
 * The CHROME view's bridge — our own 44 px bar, the first thing the owner
 * touches. `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
 *
 * It is NOT on the bus. The chrome view is the Host's own surface, not one of
 * the unit's three addresses, and putting it on the bus would give a renderer
 * with no duties a seat at the engine's traffic.
 *
 * WHAT IS HERE IN THIS WAVE: a one-way status feed, pushed by `main`. The arm
 * and disarm gestures (HOST-DESIGN.md §6.4 — this is the surface that carries
 * them) are the next wave's, and they arrive here as two more arrow functions.
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
});
