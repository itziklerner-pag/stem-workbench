/**
 * The ENGINE renderer's bridge. `contextIsolation: true`, `sandbox: true`,
 * `nodeIntegration: false`.
 *
 * WHAT IS HERE IN THIS WAVE: the bus, and nothing else. The nine `EngineHost`
 * duties (`assetUrl`, `modelBytes`, `storageGet`, …) are the next wave's, and
 * they land in the HOLE module `vendor/…/offscreen/host.js`, not here — this
 * file's whole job is to be the narrow thing that module closes over.
 *
 * ---------------------------------------------------------------------------
 * THE SHAPE RULE, AND THE MISTAKE IT AVOIDS
 * ---------------------------------------------------------------------------
 * `shared/host.js` names the Electron mistake by name: *"an Electron preload
 * bridge wrapped one level too deep hands over `{ send: fn }`"*, and *"a duty
 * implemented as a method that needs its `this` … passes `assertHost`, works
 * for the four duties the engine calls through the namespace, and fails only at
 * the first worklet load"* — because `engine.js` hands `host.assetUrl` ITSELF
 * to `MasterBus` and to every deck, unbound.
 *
 * So: **every member exposed here is an arrow function that closes over what it
 * needs and never reads `this`.** `tools/suites/shell.mjs` calls a DETACHED
 * `send` (`const f = window.__wbEngine.send; f(msg)`) for exactly that reason.
 * The hole module has the same obligation one level up.
 *
 * A sandboxed preload cannot `require` a relative file, so the six lines of bus
 * bridge below are duplicated in `deck.cjs` rather than shared. That is
 * Electron's constraint, not a preference.
 */
const { contextBridge, ipcRenderer } = require('electron');

const CHANNEL = 'bus';
const listeners = new Set();

ipcRenderer.on(CHANNEL, (_event, msg) => {
  // `_event` NEVER crosses the bridge. Handing a renderer the ipc event object
  // hands it `sender`, and through it the whole main-process surface.
  for (const fn of [...listeners]) {
    try { fn(msg); } catch (err) { console.error('[wb] bus listener threw', err); }
  }
});

contextBridge.exposeInMainWorld('__wbEngine', {
  /** Fire-and-forget, addressed by `msg.to`. The envelope is the caller's. */
  send: (msg) => ipcRenderer.send(CHANNEL, msg),
  /** @returns an unsubscribe function. */
  onMessage: (fn) => {
    if (typeof fn !== 'function') throw new TypeError('onMessage(fn): fn must be a function');
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
});
