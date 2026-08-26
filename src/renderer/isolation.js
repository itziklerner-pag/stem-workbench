/**
 * The cross-origin-isolation probe, shared by every page we serve over `app://`.
 *
 * WHY IT IS A MODULE AND NOT A LINE IN ONE PAGE: the claim being made is about
 * the SCHEME, not about one document. `tools/suites/shell.mjs` runs it in the
 * engine renderer AND in the deck view, because a handler that put the headers
 * on one response and not another would be green on a single-page check.
 *
 * WHAT EACH FIELD IS FOR:
 *   coi          `self.crossOriginIsolated`. ORT's threaded wasm has a
 *                `!crossOriginIsolated -> 1 thread` branch, and the fallback is
 *                SILENT — the deck reports `threads: 1` and the user reports
 *                "it's slow".
 *   sab          the CONSTRUCTOR, which is what `offscreen/engine.js:112`
 *                actually asserts on (`SAB_OK = typeof SharedArrayBuffer ===
 *                'function'`), because on an extension page SAB exists with
 *                `crossOriginIsolated === false`. The two are separate fields in
 *                the unit's `boot` record (`engine.js:115`) and they are separate
 *                here.
 *   worker       the one that decides whether ORT gets threads at all: wasm
 *                threads need a growable SharedArrayBuffer INSIDE the worker.
 *                Measured red by mutation with the headers removed —
 *                `SharedArrayBuffer is not defined`, in the document and in the
 *                worker (HOST-DESIGN.md §0 P2).
 */

export async function probeIsolation() {
  const report = {
    href: location.href,
    origin: location.origin,
    coi: self.crossOriginIsolated === true,
    secureContext: self.isSecureContext === true,
    sab: null,
    worker: null,
  };

  try {
    report.sab = new SharedArrayBuffer(1024).byteLength === 1024;
  } catch (err) {
    report.sab = `THREW ${String((err && err.message) || err)}`;
  }

  report.worker = await moduleWorkerProbe().catch((err) => `THREW ${String((err && err.message) || err)}`);
  return report;
}

/**
 * A `type: 'module'` worker, same-origin, which therefore INHERITS the embedder
 * policy. `workers/workerbackend.js:188` creates its inference worker exactly
 * this way (`new URL('./inference.worker.js', import.meta.url)`), so this is the
 * same construction and not an approximation of it.
 */
function moduleWorkerProbe() {
  return new Promise((resolve, reject) => {
    let w;
    try {
      w = new Worker(new URL('./isolation.worker.js', import.meta.url), { type: 'module' });
    } catch (err) { return reject(err); }
    const done = (fn) => (arg) => { clearTimeout(timer); w.terminate(); fn(arg); };
    const timer = setTimeout(() => done(reject)(new Error('worker timeout after 5000 ms')), 5000);
    w.onerror = (e) => done(reject)(new Error(`worker onerror: ${e.message || '(empty)'}`));
    w.onmessage = (e) => done(resolve)(e.data);
    // A SAB can only be POSTED if it exists here, so this line is also the
    // document-side assertion arriving a second time, from the other direction.
    try { w.postMessage({ sab: new SharedArrayBuffer(8) }); }
    catch (err) { done(reject)(err); }
  });
}
