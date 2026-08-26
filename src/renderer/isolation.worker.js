/**
 * The other half of `isolation.js`. A module worker, same origin, so it inherits
 * the embedder policy the protocol handler set.
 *
 * `Atomics.store` on a POSTED SharedArrayBuffer is the real claim: it proves the
 * buffer crossed the boundary as shared memory rather than as a copy, which is
 * the property wasm threads need and the property that disappears when COOP/COEP
 * are removed.
 */
self.onmessage = (e) => {
  const sab = e.data && e.data.sab;
  let sabInWorker = false;
  let byteLength = -1;
  try {
    const view = new Int32Array(sab);
    Atomics.store(view, 0, 7);
    sabInWorker = Atomics.load(view, 0) === 7;
    byteLength = sab.byteLength;
  } catch (err) {
    sabInWorker = `THREW ${String((err && err.message) || err)}`;
  }
  self.postMessage({ sabInWorker, byteLength, coi: self.crossOriginIsolated === true });
};
