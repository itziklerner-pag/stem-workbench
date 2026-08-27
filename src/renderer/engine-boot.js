/**
 * The engine page's own boot, in the wave before there is an engine.
 *
 * Its whole job is to prove that the page the unit will be loaded into is the
 * page the unit needs: cross-origin isolated, with a working SharedArrayBuffer
 * in the document AND in a module worker. When
 * `vendor/…/offscreen/engine.js` joins this page, it will publish the same two
 * facts itself as `STATE.boot.{sab,coi}` (`engine.js:115`) and this file's
 * report becomes the thing that says WHY they are true.
 */
import { probeIsolation } from './isolation.js';
import { createNativeBackend } from './native-backend.js';
// The unit's own constants, read from the unit rather than retyped here.
import { SEGMENT, STEMS } from './vendor/stem-splitter-live/extension/shared/config.js';

const ready = (async () => {
  const report = await probeIsolation();

  // A line in the terminal, because `main` forwards this renderer's console.
  // "It started and loaded" is a claim that should not need a debugger.
  console.log(`isolation coi=${report.coi} sab=${report.sab} secureContext=${report.secureContext} `
    + `worker=${JSON.stringify(report.worker)}`);

  const el = document.getElementById('probe');
  if (el) el.textContent = JSON.stringify(report, null, 2);
  return report;
})();

/** The gate reads this. `executeJavaScript` resolves the promise it returns. */
window.__wbProbe = () => ready;

/* ------------------------------------------------- backend #2, seed §16 */
/**
 * INSTALL THE NATIVE BACKEND FACTORY, SYNCHRONOUSLY, BEFORE THE UNIT LOADS.
 *
 * `engine.html` runs this module and then `vendor/…/offscreen/engine.js`, and
 * module scripts execute in document order — so this assignment lands before
 * `Deck.ensureBackend()` calls the Host's `createBackend` at the unit's module
 * scope. The hole reads `globalThis.__wbNativeBackend` lazily and falls back to
 * `WorkerBackend` if it is not there, so the ordering is load-bearing for
 * WHETHER the native backend is used and not for whether the app boots.
 *
 * WHY A GLOBAL RATHER THAN AN IMPORT. The hole module lives inside the vendored
 * tree and has to load in two worlds with different roots: over `app://workbench/`
 * the root is `src/renderer/`, and in plain Node — where `test.js`'s
 * `group('host')` and `tools/suites/conformance.mjs` import it — the root is the
 * repository. No single relative specifier is correct in both, so the handoff is
 * a global that only the browser world ever sets.
 *
 * THIS IS UNVERIFIED CODE ON THIS MACHINE, and structurally so: `main` answers
 * `kind: 'worker'` on Linux, so the branch below is installed and never taken
 * here. `tools/suites/backend.mjs` drives `createNativeBackend` directly for
 * that reason.
 */
/**
 * Ask `main` for a utility process and wait for its port to arrive.
 *
 * THE LISTENER IS INSTALLED BEFORE THE ASK, because the port can arrive before
 * `invoke` resolves — `main` posts it during the handler, and a listener added
 * afterwards would miss a message that has already been delivered.
 *
 * `contextBridge` CANNOT CARRY A `MessagePort`, which is why the preload
 * forwards it with `window.postMessage` instead. That is Electron's documented
 * route from a sandboxed, context-isolated preload into the page.
 */
const openPort = (id) => new Promise((resolve, reject) => {
  const bridge = window.__wbEngine;
  if (!bridge || typeof bridge.openNativeBackend !== 'function') {
    reject(new Error('this build has no native backend bridge'));
    return;
  }
  const onMessage = (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.t !== 'wb-backend-port' || d.id !== id) return;
    window.removeEventListener('message', onMessage);
    if (!event.ports || !event.ports[0]) { reject(new Error(`native backend ${id}: main sent no port`)); return; }
    resolve(event.ports[0]);
  };
  window.addEventListener('message', onMessage);
  Promise.resolve(bridge.openNativeBackend(id)).then(
    (r) => {
      if (r && r.ok) return;
      window.removeEventListener('message', onMessage);
      reject(new Error((r && r.error) || `native backend ${id}: main refused to open one`));
    },
    (err) => { window.removeEventListener('message', onMessage); reject(err); },
  );
});

globalThis.__wbNativeBackend = (hooks) => createNativeBackend({
  hooks,
  openPort,
  onDispose: (id) => {
    const bridge = window.__wbEngine;
    if (bridge && typeof bridge.closeNativeBackend === 'function') bridge.closeNativeBackend(id);
  },
  ep: (hooks && hooks.choice && hooks.choice.ep) || 'coreml',
  segmentFloats: SEGMENT,
  stemPlanes: STEMS.length * 2,
});
