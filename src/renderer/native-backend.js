/**
 * BACKEND #2 — seed §16's native backend, as the engine renderer sees it.
 *
 * A second implementation of `shared/host.js`'s three-duty `Backend`
 * interface — `load`, `separate`, `dispose` — talking to an Electron utility
 * process over one `MessagePort`. Backend #1 (`workers/workerbackend.js`) is
 * untouched and is still what every machine except Apple Silicon gets.
 * `src/main/backend.js` decides which; this file is only ever built when that
 * decision said native.
 *
 * ===========================================================================
 * NOT ONE LINE OF THIS HAS RUN AGAINST CoreML
 * ===========================================================================
 * There is no macOS on this box. What has run, and what
 * `tools/suites/backend.mjs` gates in plain node over a `worker_threads`
 * `MessageChannel`, is the WIRE: the buffer layout survives the hop, both
 * caller buffers come back as themselves, and `dispose()` settles every
 * outstanding call by name. That proves the protocol and proves nothing at all
 * about CoreML, which is exactly how it is reported.
 *
 * ===========================================================================
 * THE ZERO-COPY CONTRACT, AND THE HONEST THING TO CALL WHAT HAPPENS HERE
 * ===========================================================================
 * Seed §16 says the per-segment IPC is "≈ 2.7 MB in / ≈ 16.5 MB out as
 * TRANSFERABLES". It is not, and that is a correction to the plan rather than a
 * shortcut here: Electron types the transfer list of BOTH
 * `UtilityProcess.postMessage` and `MessagePortMain.postMessage` as
 * `MessagePortMain[]`. An ArrayBuffer is not in it, so the segment round trip
 * is a structured clone in each direction — see `docs/ARCHITECTURE.md` for the
 * measured figure beside the seed's claim.
 *
 * SO THIS SIDE NEVER DETACHES THE CALLER'S BUFFERS, and that turns the
 * limitation into the safe reading of the contract rather than a compromise
 * with it. `shared/host.js` requires that `mix` and `out` "BOTH COME BACK in the
 * resolution — `mix` as the same buffer, `stems` as the buffer `out` became",
 * because `LivePipeline` allocates them ONCE PER SESSION and re-adopts them at
 * `offscreen/live.js:1000-1001`. Here:
 *
 *   · `mix` is COPIED onto the wire and resolved back as itself, never transferred;
 *   · `out` NEVER GOES ON THE WIRE AT ALL — sending 16.5 MB of zeroes each hop
 *     would be pure cost — and the returned floats are written into it, so
 *     `stems` is `out`, unmoved;
 *   · neither is ever detached, so a failure path cannot leave the caller
 *     holding a dead buffer.
 *
 * `load()`'s 109 MB IS transferred, because its typedef explicitly permits it
 * ("IT TAKES OWNERSHIP OF `bytes` and may transfer it") and the alternative is
 * duplicating the model at the peak-memory moment.
 *
 * THE COST, STATED RATHER THAN BURIED: one process boundary means ~19.2 MB of
 * structured clone per hop (2.7 out + 16.5 back), about 10 MB/s at hop 1.95 s,
 * and the inbound 16.5 MB is per-hop garbage on the engine renderer. That is
 * what a process boundary costs; cross-process zero copy would need shared
 * memory, which Electron does not expose and which a `SharedArrayBuffer` cannot
 * cross a process to provide. Whether it is worth paying is a question only
 * hardware that can run CoreML can answer, and it has not been answered.
 *
 * ===========================================================================
 * THIS MODULE MUST IMPORT CLEANLY IN PLAIN NODE
 * ===========================================================================
 * Same requirement, and same reason, as the hole module that reaches it: a
 * module-scope `window` read here would take the whole `unit` step out AT
 * IMPORT. Nothing below touches a global until it is CALLED, and the transport
 * arrives as an argument rather than being reached for.
 */

/** The unit's own answer for a backend that has neither. `shared/host.js` freeze item 6. */
const NATIVE_HARDWARE_REPORT = Object.freeze({ threads: null, adapter: null });

/**
 * Build one native backend.
 *
 * SYNCHRONOUS, AND IT RETURNS THE BACKEND RATHER THAN A PROMISE TO ONE, because
 * `Deck.ensureBackend()` calls it at engine module scope. `shared/host.js` says
 * what that means for a backend that needs a process: "a backend that needs to
 * spawn a process starts it here and lets `load()` be where the waiting
 * happens." So `openPort()` is called now and awaited in `load()`.
 *
 * @param {{hooks?: object, openPort: (id: string) => Promise<any>,
 *          segmentFloats: number, stemPlanes: number, id?: string}} o
 */
export function createNativeBackend(o) {
  const {
    openPort,
    segmentFloats,
    stemPlanes,
    id = `native-${Math.random().toString(36).slice(2, 10)}`,
  } = o;
  const hooks = o.hooks || {};
  const name = hooks.name || 'the native inference backend';
  const onReady = hooks.onReady || (() => {});
  const onFail = hooks.onFail || (() => {});

  /** Every call this backend still owes an answer for, by wire id. */
  const pending = new Map();
  let seq = 0;
  let port = null;
  let disposed = false;
  let deadReason = null;

  /**
   * THE PROCESS IS STARTED HERE, NOT IN `load()`. A rejected port is remembered
   * rather than thrown now: throwing at construction would take out
   * `engine.js`'s module scope, and the deck would never paint to say why.
   */
  const portReady = Promise.resolve()
    .then(() => openPort(id))
    .then((p) => {
      if (disposed) { closePort(p); throw new Error(deadReason); }
      port = p;
      attach(p);
      /**
       * TWO NULLS ARE THE ANSWER, NOT A DEGRADED ONE. `shared/host.js`:
       * "A native backend — CoreML, DirectML, CUDA — has neither and answers
       * `{threads: null, adapter: null}`, which is a legitimate answer rather
       * than a degraded one… A Host must not invent numbers here." The freeze
       * block added no neutral field for this on purpose, so `onReady` is NOT
       * where the backend is named — `load()`'s `ep` is.
       */
      onReady({ ...NATIVE_HARDWARE_REPORT });
      return p;
    });
  // A port that never opens must not become an unhandled rejection before
  // `load()` gets to await it; the rejection is still delivered to `load()`.
  portReady.catch(() => {});

  function closePort(p) { try { if (p && typeof p.close === 'function') p.close(); } catch { /* already gone */ } }

  function attach(p) {
    const receive = (arg) => {
      const m = (arg && typeof arg === 'object' && typeof arg.t === 'string') ? arg : (arg && arg.data);
      if (!m) return;
      const g = pending.get(m.id);
      if (!g) return;
      pending.delete(m.id);
      if (m.ok === false) { g.rej(new Error(`${name}: ${m.error}`)); return; }
      g.res(m);
    };
    if (typeof p.on === 'function') p.on('message', receive);
    else p.onmessage = receive;
    if (typeof p.start === 'function') p.start();
    /**
     * THE PROCESS DYING WITH NOTHING IN FLIGHT IS WHAT `onFail` IS FOR, and
     * without it "that death is silent until the next arm, and the deck goes on
     * reporting a session it no longer has."
     */
    if (typeof p.on === 'function') {
      p.on('close', () => {
        if (disposed) return;
        const err = new Error(`${name}: the native inference process closed its port`);
        for (const [, g] of pending) g.rej(err);
        pending.clear();
        onFail(err);
      });
    }
  }

  /** One request, one answer, correlated by id — the shape `WorkerBackend` uses. */
  function call(msg, transfer) {
    if (disposed) return Promise.reject(new Error(deadReason));
    return portReady.then((p) => new Promise((res, rej) => {
      if (disposed) { rej(new Error(deadReason)); return; }
      const wireId = `${id}:${++seq}`;
      pending.set(wireId, { res, rej });
      try { p.postMessage({ ...msg, id: wireId }, transfer || []); }
      catch (err) {
        // The transfer list was refused. Retry as a copy rather than leaving the
        // caller holding a promise nothing will settle.
        try { p.postMessage({ ...msg, id: wireId }); }
        catch (err2) { pending.delete(wireId); rej(new Error(`${name}: ${(err2 && err2.message) || err2}`)); }
      }
    }));
  }

  return {
    /**
     * @type {import('../../vendor/stem-splitter-live/extension/shared/host.js').Backend['load']}
     *
     * THE BYTES ARE THE UNIT'S VERIFIED ONES AND THEY ARRIVE THE SAME WAY (M1).
     * `shared/modelcache.js::loadModel` has already checked the SHA-256 and the
     * byte count against `shared/config.js`'s pin, on this load, before this is
     * called. Nothing downstream reads a model file from disk.
     */
    async load(bytes, onProgress) {
      if (disposed) throw new Error(deadReason);
      if (onProgress) onProgress('session');
      const r = await call({ t: 'load', bytes, ep: o.ep || 'coreml' }, [bytes]);
      if (onProgress) onProgress('warmup');
      /**
       * `ep` IS THE SESSION'S ANSWER, NOT THE REQUEST. It is the one channel
       * `shared/host.js` provides for saying which backend is live — "the
       * resolution carries which EP actually took the model, so the deck can say
       * `webgpu` or `wasm`" — and it flows to `STATE.boot.ep` and onto the deck.
       * Reporting the ask instead would make that display a lie.
       */
      return { ep: r.ep, createMs: r.createMs, warmupMs: r.warmupMs };
    },

    /**
     * @type {import('../../vendor/stem-splitter-live/extension/shared/host.js').Backend['separate']}
     *
     * BORROW AND RETURN, WITHOUT EVER DETACHING EITHER — see the header. `out`
     * does not travel; the stems are written into it and it is resolved as
     * `stems`, which is what "the buffer `out` became" means for a backend that
     * did not take it away.
     */
    async separate(mix, out) {
      if (disposed) throw new Error(deadReason);
      /**
       * A COPY OF `mix` GOES ON THE WIRE. `mix.slice(0)` rather than `mix`
       * itself, because a structured clone of the caller's buffer is a clone
       * either way and a TRANSFER of it would detach a buffer `LivePipeline`
       * lends for the next segment. This is the line that keeps the caller's
       * two buffers alive across a failure, and it is deliberate cost.
       */
      const r = await call({ t: 'separate', mix: mix.slice(0) });
      const stems = new Float32Array(out);
      const got = new Float32Array(r.stems);
      if (got.length !== stemPlanes * segmentFloats) {
        throw new Error(`${name}: the native backend returned ${got.length} floats, expected `
          + `${stemPlanes * segmentFloats} (${stemPlanes} planes of ${segmentFloats})`);
      }
      stems.set(got);
      return { mix, stems: out, prepMs: r.prepMs, inferMs: r.inferMs, postMs: r.postMs };
    },

    /**
     * @type {import('../../vendor/stem-splitter-live/extension/shared/host.js').Backend['dispose']}
     *
     * MUST START ITS TEARDOWN SYNCHRONOUSLY — the last caller is the engine's
     * `onTeardown`, which does not await — AND MUST SETTLE WHAT IT TAKES AWAY,
     * BY NAME. Killing the process settles nothing on this side of the pipe:
     * `LivePipeline.runChunk` awaits with no timeout and no cancel path, so a
     * promise left open at teardown is a deck that goes silent with nothing
     * reported. Both halves are below, and the name is in both messages because
     * two decks own one backend each and fail independently.
     */
    async dispose() {
      const p = port;
      disposed = true;
      port = null;
      deadReason = `${name}: the native inference backend was disposed — a backend given back does not come back`;
      const gone = new Error(`${name}: the native inference backend was disposed with a call still in flight — `
        + 'its utility process is being killed, so nothing will ever answer it');
      for (const [, g] of pending) g.rej(gone);
      pending.clear();
      if (p) { try { p.postMessage({ t: 'dispose', id: `${id}:dispose` }); } catch { /* already gone */ } }
      closePort(p);
      if (typeof o.onDispose === 'function') { try { o.onDispose(id); } catch { /* the kill is best effort */ } }
    },
  };
}
