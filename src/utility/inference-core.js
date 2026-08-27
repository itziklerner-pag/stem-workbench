/**
 * THE UTILITY PROCESS'S HALF OF THE NATIVE BACKEND — the protocol, with the
 * engine injected.
 *
 * ===========================================================================
 * WHY THIS FILE HAS NO `electron` IMPORT AND NO ORT IMPORT
 * ===========================================================================
 * Everything peculiar to Electron lives in `inference.js`, which is nine lines
 * of wiring; everything peculiar to ONNX Runtime arrives as `makeEngine`. What
 * is left is the PROTOCOL — the three duties over a `MessagePort` — and a
 * protocol is the part worth gating on a machine that has neither.
 *
 * That is not a testing convenience, it is the only way this work can be
 * honest: there is no macOS here, so the CoreML path cannot run. What CAN run
 * is this file, over a `node:worker_threads` `MessageChannel`, with a fake
 * engine that writes a known pattern — which proves the wire, the buffer
 * layout, and `dispose()`'s settlement, and proves nothing whatsoever about
 * CoreML. `tools/suites/backend.mjs` says so in those words.
 *
 * ===========================================================================
 * WHAT CROSSES, AND WHAT DELIBERATELY DOES NOT
 * ===========================================================================
 * `out` IS NEVER SENT. `shared/host.js`'s `separate(mix, out)` hands the
 * backend a caller-owned output buffer, and the naive reading — forward both —
 * would put 16.5 MB of zeroes on the wire every hop for nothing. The renderer
 * keeps `out`, sends only `mix` (2.7 MB), gets `stems` back (16.5 MB) and
 * writes them in. The frozen layout — `(k*2 + ch) * SEGMENT + i`, stem-major,
 * left before right — is what makes that a straight copy rather than a
 * rearrangement, and it is not this file's to change.
 *
 * THE MODEL BYTES COME OVER THIS WIRE AND ARE NEVER READ FROM DISK HERE. That
 * is rule M1 and it is structural: `shared/modelcache.js::loadModel` verifies
 * the SHA-256 and the byte count in the renderer, on every load, before the
 * buffer reaches `Backend.load` — so a utility process that opened the file
 * itself would be running weights nothing had checked. `load()`'s typedef
 * permits transferring the 109 MB and this end takes ownership of it.
 */

/**
 * Serve the three duties on one port until `dispose`.
 *
 * @param {{port: {postMessage: Function, on?: Function, start?: Function},
 *          makeEngine: () => Promise<{load: Function, runSegment: Function}>,
 *          segmentFloats: number, stemPlanes: number,
 *          log?: (line: string) => void}} deps
 */
export function serveInference(deps) {
  const { port, makeEngine, segmentFloats, stemPlanes } = deps;
  const log = deps.log || (() => {});

  let engine = null;
  let disposed = false;
  /**
   * ONE OUTPUT BUFFER, REUSED — the same per-session-not-per-hop rule the
   * renderer side lives under, one process over. Nothing here transfers it (see `send`
   * below), so it survives every hop — but the `byteLength` check stays,
   * because a buffer this code did not detach is a weaker guarantee than a
   * buffer this code checked, and being wrong costs one allocation rather than
   * a `TypeError` on a detached buffer at the next segment.
   */
  let stemsBuf = null;

  /**
   * NOTHING IS EVER TRANSFERRED, IN EITHER DIRECTION, AND BOTH HALVES OF THAT
   * WERE MEASURED ON THIS BOX (Electron 44, Linux):
   *
   *   · child -> renderer, ArrayBuffer in the transfer list:
   *       THROWS "Port at index 0 is not a valid port" — loud, recoverable.
   *   · renderer -> child, ArrayBuffer in the transfer list:
   *       does NOT throw, DETACHES the sender's buffer, and the message is
   *       NEVER DELIVERED. Silent, and it destroys the caller's data.
   *
   * The second is why there is no transfer list anywhere on this wire rather
   * than a try/catch around one: there is nothing to catch, and a `separate()`
   * whose message vanished is a promise `LivePipeline.runChunk` waits on for
   * ever. Seed §16's "as transferables" is not available here; the frozen
   * borrow-and-return contract is honoured by never detaching instead.
   */
  const send = (msg) => { port.postMessage(msg); };

  const fail = (t, id, err) => send({ t, id, ok: false, error: String((err && err.message) || err) });

  const onLoad = async (m) => {
    try {
      engine = await makeEngine();
      const info = await engine.load(m.bytes, m.ep);
      send({ t: 'loaded', id: m.id, ok: true, ...info });
    } catch (err) { engine = null; fail('loaded', m.id, err); }
  };

  const onSeparate = async (m) => {
    try {
      if (!engine) throw new Error('the native backend has no session — load() has not succeeded');
      if (!stemsBuf || stemsBuf.byteLength === 0) stemsBuf = new ArrayBuffer(stemPlanes * segmentFloats * 4);
      const mix = new Float32Array(m.mix);
      const segL = mix.subarray(0, segmentFloats);
      const segR = mix.subarray(segmentFloats, 2 * segmentFloats);
      const r = await engine.runSegment(segL, segR, new Float32Array(stemsBuf));
      const stems = stemsBuf;
      send({
        t: 'separated', id: m.id, ok: true, stems,
        prepMs: r.prepMs, inferMs: r.inferMs, postMs: r.postMs,
      });
    } catch (err) { fail('separated', m.id, err); }
  };

  const onProbe = async (m) => {
    /**
     * THE PROBE IS A REAL ATTEMPT, NOT A PLATFORM SNIFF, and `src/main/backend.js`
     * explains at length why it has to be: there is no fallback after
     * `createBackend` returns, because `load()` may already have consumed the
     * only copy of the weights. So this actually builds an engine, and an
     * engine that cannot be built answers `no-module` rather than `ok`.
     */
    try {
      await makeEngine();
      send({ t: 'probed', id: m.id, result: 'ok' });
    } catch (err) {
      const why = /cannot find module|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/i.test(String((err && err.message) || err))
        ? 'no-module' : 'no-ep';
      send({ t: 'probed', id: m.id, result: why, error: String((err && err.message) || err) });
    }
  };

  const handle = (m) => {
    if (!m || typeof m.t !== 'string') return;
    if (disposed && m.t !== 'dispose') {
      // A call that arrives after teardown MUST be refused rather than dropped:
      // a dropped call is a promise the renderer waits on for ever, which is the
      // exact hang `shared/host.js` spends four paragraphs on.
      return fail(m.t === 'separate' ? 'separated' : 'loaded', m.id,
        new Error('the native inference backend was disposed'));
    }
    if (m.t === 'load') return void onLoad(m);
    if (m.t === 'separate') return void onSeparate(m);
    if (m.t === 'probe') return void onProbe(m);
    if (m.t === 'dispose') {
      disposed = true;
      engine = null;
      stemsBuf = null;
      send({ t: 'disposed', id: m.id });
      return;
    }
  };

  /**
   * THE TWO PORT FLAVOURS DELIVER DIFFERENT THINGS, and getting this wrong is
   * silent: Node's `worker_threads` `MessagePort` hands `on('message')` THE
   * VALUE, while Electron's `MessagePortMain` hands it an EVENT with `.data`.
   * A handler written for one sees `undefined` on the other and simply never
   * answers — which the renderer experiences as a `separate()` that hangs for
   * ever, with nothing red anywhere. So the shape is read rather than assumed,
   * and `tools/suites/backend.mjs` drives BOTH shapes through it.
   */
  const unwrap = (arg) => (arg && typeof arg === 'object' && typeof arg.t === 'string' ? arg : (arg && arg.data));
  const receive = (arg) => handle(unwrap(arg));

  if (typeof port.on === 'function') port.on('message', receive);
  else port.onmessage = receive;
  if (typeof port.start === 'function') port.start();

  return { receive, isDisposed: () => disposed };
}
