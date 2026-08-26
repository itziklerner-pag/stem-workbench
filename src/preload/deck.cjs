/**
 * The DECK renderer's bridge. `contextIsolation: true`, `sandbox: true`,
 * `nodeIntegration: false`.
 *
 * WHAT IS HERE IN THIS WAVE: the bus, and nothing else. `DeckHost`'s six duties
 * plus its two namespaces (`page`, `transport` — fourteen members in all) are
 * the next wave's, and they land in the HOLE module `vendor/…/ui/host.js`.
 *
 * WHAT THE NEXT WAVE ADDS HERE, so the shape is decided once rather than
 * discovered: `storageGet`/`storageSet` (invoke), `armShortcut` (invoke — async
 * and read at call time, so a future rebind is reflected rather than frozen at
 * boot), `page.*` (six), `transport.*` (six, and every one of them a round trip
 * to the source view's preload). All of them arrow functions. See `engine.cjs`
 * for the `this`-free rule and the failure it avoids.
 *
 * A sandboxed preload cannot `require` a relative file, so the bus bridge below
 * is duplicated from `engine.cjs` rather than shared. Electron's constraint.
 */
const { contextBridge, ipcRenderer } = require('electron');

const CHANNEL = 'bus';
const listeners = new Set();

ipcRenderer.on(CHANNEL, (_event, msg) => {
  // `_event` NEVER crosses the bridge.
  for (const fn of [...listeners]) {
    try { fn(msg); } catch (err) { console.error('[wb] bus listener threw', err); }
  }
});

contextBridge.exposeInMainWorld('__wbDeck', {
  /**
   * `DeckHost.send` carries a FINISHED envelope — freeze item 5's asymmetry:
   * the engine's `send` stamps `{v:1, to:'ui', from:'off'}` and the deck's does
   * not. Neither stamper is here; this is the wire.
   */
  send: (msg) => ipcRenderer.send(CHANNEL, msg),
  /** @returns an unsubscribe function. */
  onMessage: (fn) => {
    if (typeof fn !== 'function') throw new TypeError('onMessage(fn): fn must be a function');
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
});
