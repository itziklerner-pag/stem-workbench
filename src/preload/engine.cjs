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
 *   createBackend         `new WorkerBackend(...)` — unit code, in this renderer,
 *                         UNLESS `main` chose seed §16's native backend, which
 *                         needs a utility process and therefore needs main. That
 *                         is the one duty in this list whose answer changed, and
 *                         the three members below are why the count is no longer
 *                         two. On Linux the answer is always the worker.
 *
 * Every channel added here is a channel a compromised renderer can call, so the
 * channels that ARE here are the things that could not be anywhere else: the
 * bus, the capture claim, and — since v1.1 — the EXPORT SINK, whose files can
 * only be written in main, over the app's own folder dialog. The duty in the
 * hole module holds the WritableStreams; these four channels are the narrow
 * path their chunks take to the disk (`src/main/files.js` §5).
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

/**
 * WHICH BACKEND THIS LAUNCH IS ON — READ SYNCHRONOUSLY, AND IT IS THE SECOND
 * `sendSync` IN THIS APP FOR THE SAME REASON THE FIRST ONE EXISTS.
 *
 * `EngineHost.createBackend` is SYNCHRONOUS — `shared/host.js`: "it returns the
 * Backend rather than a promise to one … called from `Deck.ensureBackend()`,
 * which runs at engine module scope" — so "which backend" has to be answerable
 * before the unit's first line, and there is no promise the unit would await.
 * `deck:profile` in `deck.cjs` carries the identical constraint and states it at
 * length. `main` must therefore have `installBackend()` ready BEFORE the engine
 * window loads, exactly as it does for the deck's profile.
 *
 * The default here is the WORKER, and defaults matter on this channel: an
 * unanswered ask must degrade to the backend that always exists rather than to
 * one this machine may not have.
 */
const backend = (() => {
  try {
    const b = ipcRenderer.sendSync('engine:backend');
    return b && typeof b.kind === 'string' ? b : { kind: 'worker', ep: null, why: 'main gave no backend answer' };
  } catch (err) {
    return { kind: 'worker', ep: null, why: `the backend question could not be asked (${(err && err.message) || err})` };
  }
})();

/**
 * THE UTILITY PROCESS'S PORT, FORWARDED INTO THE MAIN WORLD.
 *
 * `contextBridge` cannot carry a `MessagePort`, so a port that arrived here
 * would be stranded in the isolated world — and the backend that needs it is
 * `src/renderer/native-backend.js`, in the page. `window.postMessage` with the
 * port in the transfer list is Electron's documented route across that boundary,
 * and it is the only one.
 *
 * THE PORT GOES RENDERER↔UTILITY DIRECTLY. Routing 16.5 MB of stems through
 * `main` would be a second structured clone on every hop, for nothing.
 */
ipcRenderer.on('engine:backend:port', (event, msg) => {
  const port = event.ports && event.ports[0];
  if (!port || !msg || typeof msg.id !== 'string') return;
  window.postMessage({ t: 'wb-backend-port', id: msg.id }, '*', [port]);
});

contextBridge.exposeInMainWorld('__wbEngine', {
  /**
   * `{kind, ep, why}`, decided by `src/main/backend.js` before this window
   * loaded. `why` travels with it so a deck that fell back to the worker can say
   * why without anyone reading a log.
   */
  backend,
  /** Ask `main` to fork one utility process for this backend id. */
  openNativeBackend: (id) => ipcRenderer.invoke('engine:backend:open', id),
  /** Give it back. Fire-and-forget: `dispose()` does not await. */
  closeNativeBackend: (id) => ipcRenderer.send('engine:backend:close', id),
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

  // ------------------------------------------------------------ the export sink
  // THE FOUR CHANNELS THE `exportSink` DUTY IS BUILT ON. Each one resolves
  // `{ok, ...}` or `{ok: false, code, message}` and NEVER rejects on a refusal,
  // so the hole module's throw is the one the engine reports — a refused open
  // must surface as the duty's own Error, not as an ipc error, and a chunk that
  // arrives for a file this session never opened must be refused, not queued.
  //
  // `openExportSink` opens EVERY file of the plan at once, behind the same
  // ask-once folder rule the E1 writer uses (`src/main/files.js` §5): one
  // gesture, one dialog, all files. The other three are addressed by the file's
  // BASE NAME — the names the duty itself handed out, which are the only names
  // this session knows.
  //
  // Bytes only: `writeExportSink` takes an ArrayBuffer or a typed-array view,
  // which is what a WritableStream's `write()` receives from the unit. The
  // renderer-side session is append-only — the frame count is known before the
  // first chunk, so the WAV header the main process wrote on open is never
  // patched and no seekable handle ever exists.
  openExportSink: (plan) => ipcRenderer.invoke('export:sink', plan),
  writeExportSink: (name, chunk) => ipcRenderer.invoke('export:write', name, chunk),
  closeExportSink: (name) => ipcRenderer.invoke('export:close', name),
  abortExportSink: (name) => ipcRenderer.invoke('export:abort', name),
});
