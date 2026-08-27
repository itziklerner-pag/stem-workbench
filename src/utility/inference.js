/**
 * THE ELECTRON UTILITY PROCESS — seed §16's process placement, and nothing else.
 *
 * "Process placement, desktop host: native backends run in an Electron utility
 * process — crash isolation, and native modules stay out of the sandboxed
 * renderer." That is this file's whole reason to exist, and it is deliberately
 * the thinnest part of the backend: the protocol is `inference-core.js` and the
 * DSP is the UNIT'S OWN, imported unmodified out of the vendored tree.
 *
 * ===========================================================================
 * NOTHING BELOW HAS EVER EXECUTED. THERE IS NO macOS HERE.
 * ===========================================================================
 * `onnxruntime-node` is not a dependency of this project and is not installed
 * on this machine, so `makeEngine()` here has only ever taken its failure path.
 * The CoreML claim is UNVERIFIED, in the strict sense: no CoreML session has
 * been created, no segment has been separated by it, and no timing has been
 * measured. `docs/TESTING.md` records which gates SKIP for that reason.
 *
 * ===========================================================================
 * THE SAME GRAPH, THE SAME STFT, A DIFFERENT ORT BINDING — AND WHY
 * ===========================================================================
 * Seed §16 left open "whether the native backend runs the same hoisted-STFT
 * ONNX with a native STFT, or a different export of the model." It is the same
 * export, and the reason is structural rather than a preference:
 *
 *   `shared/config.js` pins `sha256` and `bytes`, and
 *   `shared/modelcache.js::loadModel` verifies BOTH over whatever `modelBytes`
 *   returned BEFORE the buffer reaches `Backend.load`. A second export could
 *   only reach a backend by bypassing the handed bytes — which is the M1
 *   violation the whole seam exists to prevent — or by moving the pin upstream
 *   behind a new tag.
 *
 * And the STFT stays hoisted for the reason `engine/demucs.js:31` already
 * records: *"STFT is outside the graph on purpose: in-graph STFT/ScatterND
 * makes ORT-Web's WebGPU EP refuse the session."* The CoreML EP's op coverage
 * is narrower still, so an in-graph DFT would partition to CPU and be SLOWER
 * than the hoisted path — while also forking the file away from backend #1.
 *
 * SO THE SPECTRAL PATH HERE IS THE UNIT'S OWN CODE, NOT A PORT.
 * `engine/demucs.js` takes the ORT namespace as a constructor parameter and the
 * EP as a `load()` argument — the seam this task needed was already inside the
 * vendored code — and it imports cleanly in plain Node with no DOM and no
 * fetch. So this process runs the same parity-verified `prepareInput` /
 * `postProcess` / `engine/fft.js` the worker runs, byte for byte, and
 * `tools/model-parity.mjs` goes on holding the STEMS order over the same graph.
 * "DO NOT touch the STFT/iSTFT math or the reflect-pad off-by-one" is honoured
 * by not retyping it.
 *
 * A NATIVE STFT (Accelerate/vDSP) IS A LATER OPTIMISATION AND CHANGES NO
 * INTERFACE. Today the ratio is ~283 ms of JS spectral against ~450 ms steady
 * inference. If CoreML moves inference to ~100 ms the spectral path becomes the
 * bottleneck and a vDSP addon earns its place — but that is a decision for a
 * measurement nobody here can take, and building it now would be optimising a
 * ratio on hardware this project does not have.
 */
import { createRequire } from 'node:module';
import { serveInference } from './inference-core.js';
import { NATIVE_MODULE } from '../main/backend.js';
import { DemucsEngine } from '../../vendor/stem-splitter-live/extension/engine/demucs.js';
import { SEGMENT, STEMS } from '../../vendor/stem-splitter-live/extension/shared/config.js';

const require = createRequire(import.meta.url);

/** One line per event, prefixed so `main`'s forwarded output says who spoke. */
const log = (line) => console.log(`[backend] ${line}`);

/**
 * THE NATIVE MODULE IS RESOLVED LAZILY AND ITS ABSENCE IS A NORMAL ANSWER.
 *
 * `onnxruntime-node` is NOT in `package.json`, on purpose and on the record:
 * adding it is a native dependency and an owner action in the main checkout
 * (every worktree on this box shares one `node_modules`, and `npm install`
 * inside a worktree corrupts it for every other agent — WORKTREES.md §2.4). So
 * the module is required inside a `try` and its absence is reported as
 * `no-module`, which `chooseBackend()` turns into the worker. On this Linux box
 * that is one of TWO independent reasons the answer is already the worker; the
 * platform gate is the other, and it fires first.
 *
 * NO SILENT EP DOWNGRADE. If the CoreML session cannot be created this REJECTS
 * rather than quietly retrying on CPU. A backend that was chosen for CoreML and
 * is secretly running on CPU is slower than the worker it displaced and says
 * nothing — the deck would report a session it does not have the performance
 * of. Failing loudly here is what sets `degraded` and puts the next deck back
 * on the worker.
 *
 * WHAT `ep` CAN HONESTLY MEAN. ORT partitions a graph and falls back per NODE
 * to CPU without telling anyone, and `onnxruntime-node` exposes no API to
 * enumerate that partition. So `'coreml'` here means "the CoreML execution
 * provider was registered and took what it could", NOT "every node ran on the
 * Neural Engine". That distinction is stated rather than implied, because
 * `STATE.boot.ep` is the only thing the deck has to report a backend with.
 */
async function makeEngine(ep) {
  const ort = require(NATIVE_MODULE);
  const engine = new DemucsEngine(ort);
  return {
    async load(bytes, requestedEp) {
      const t0 = Date.now();
      await engine.load(bytes, requestedEp || ep || 'coreml');
      const createMs = Date.now() - t0;
      // The warm-up the worker also pays: the first inference compiles, and a
      // caller that measured the second one would be reporting a number the
      // user never experiences.
      const t1 = Date.now();
      const zeroL = new Float32Array(SEGMENT);
      const zeroR = new Float32Array(SEGMENT);
      await engine.runSegment(zeroL, zeroR, new Float32Array(STEMS.length * 2 * SEGMENT));
      return { ep: engine.ep, createMs, warmupMs: Date.now() - t1 };
    },
    runSegment: (l, r, out) => engine.runSegment(l, r, out),
  };
}

/**
 * `main` sends one message carrying one `MessagePortMain`, and everything after
 * that is on the port. The parent channel is not used for inference traffic:
 * the port goes RENDERER↔HERE, so a segment crosses one process boundary rather
 * than two.
 */
process.parentPort.on('message', (event) => {
  const msg = event && event.data;
  if (!msg || msg.t !== 'port' || !event.ports || !event.ports[0]) return;
  const port = event.ports[0];
  serveInference({
    port,
    makeEngine: () => makeEngine(msg.ep),
    segmentFloats: SEGMENT,
    stemPlanes: STEMS.length * 2,
    log,
  });
  process.parentPort.postMessage({ t: 'port-ready' });
  log(`serving on a port · segment=${SEGMENT} planes=${STEMS.length * 2} ep=${msg.ep || 'coreml'}`);
});
