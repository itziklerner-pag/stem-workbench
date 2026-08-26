/**
 * The ENGINE renderer's bridge. `contextIsolation: true`, `sandbox: true`,
 * `nodeIntegration: false`.
 *
 * WHAT IS HERE, AND WHY IT IS ONLY TWO THINGS. The nine `EngineHost` duties
 * live in the HOLE module `vendor/…/offscreen/host.js`, never here; this file's
 * whole job is to be the narrow thing that module closes over. It is narrow
 * because seven of the nine duties need NOTHING from the main process:
 *
 *   send / onMessage      the bus wire below
 *   captureStream         `claimCapture` below, then `getDisplayMedia` in the
 *                         renderer — the constraints and the inspection are the
 *                         hole module's, because a stream main never sees is a
 *                         stream main cannot check
 *   assetUrl              pure URL arithmetic against the hole module's own
 *                         `import.meta.url`
 *   onTeardown            `pagehide`, a document event
 *   modelBytes /          `fetch` and `HEAD` over `app://`, which is a protocol
 *   modelCached           handler main already installed. 109 MB over ipc would
 *                         be one structured clone per load, twice per session
 *   clearModel            an honest no-op over an immutable bundled file
 *   createBackend         `new WorkerBackend(...)` — unit code, in this renderer
 *
 * Every channel added here is a channel a compromised renderer can call, so the
 * two that ARE here are the two that could not be anywhere else.
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
  /**
   * SPEND A ONE-SHOT CAPTURE CLAIM. `main` minted the token in the arm path and
   * put it on `CAPTURE_START`; the unit carried it here without looking inside
   * it, and the hole module calls this BEFORE it asks for a stream.
   *
   * It resolves `{ok: true}` or `{ok: false, code, message}` and NEVER rejects
   * on a refusal, so the hole module's own throw is the one the engine reports
   * — `captureStream` must reject with a sentence, not with an ipc error.
   *
   * WHAT IT BUYS, precisely: `setDisplayMediaRequestHandler` in main will only
   * answer a request that has a claim pending, so the engine cannot capture
   * anything main did not arm. In the extension that property was free — the
   * token WAS the grant. Here it has to be built, and this is the wire it is
   * built on (docs/HOST-DESIGN.md §5.2).
   */
  claimCapture: (token) => ipcRenderer.invoke('capture:claim', token),
});
