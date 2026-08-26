/**
 * The gate's eyes INSIDE the app for the permanent capture-mute gate.
 *
 * `src/main/main.js --gate=DIR --gate-probe=capture-mute` imports this file —
 * DYNAMICALLY, and only when those flags are present — hands it the live
 * handles, and exits with what it returns. `tools/suites/capture-mute.mjs` spawns
 * that launch with a PipeWire null sink under it, records the sink's monitor for
 * the app's WHOLE LIFETIME from outside the process, and scores both halves.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it never asserts. Every number below is read
 * out of the running app and judged in a separate process — a probe that decided
 * its own verdict would be a suite that exits 0 having asserted nothing.
 *
 * ---------------------------------------------------------------------------
 * IT DRIVES THE PRODUCT'S CAPTURE PATH, NOT A COPY OF IT
 * ---------------------------------------------------------------------------
 * The capture is opened by `vendor/…/offscreen/host.js`'s SHIPPING
 * `captureStream(token)`, over a claim minted the way `engineMessages.captureStart()`
 * mints one, answered by the real `setDisplayMediaRequestHandler` in
 * `src/main/capture.js`, against the real source view. Nothing here calls
 * `getDisplayMedia` itself.
 *
 * That distinction cost the engine-host battery a case (its 8): an earlier probe
 * called `getDisplayMedia` with a COPY of the Host's constraints, so breaking the
 * constraints inside `host.js` left the gate green. The whole value of this file
 * is that a Host which asked for `{audio: true}` fails here the way it would fail
 * a user — mono, 48 kHz, AGC decaying the level 17x over 8 s
 * (`docs/spike-capture-mute.md` Limitation 6).
 *
 * THE ENGINE NEVER SEES THIS STREAM, so this probe stops it. R5 ownership is not
 * being transferred; the tracks are this file's for the length of one window.
 *
 * ---------------------------------------------------------------------------
 * THE ORDER OF EVENTS IS THE MEASUREMENT, AND IT IS NOT AN IMPLEMENTATION DETAIL
 * ---------------------------------------------------------------------------
 *   1. the app boots, muted (`createSourceView` mutes before the first load)
 *   2. THE SOURCE STARTS PLAYING, and the capture is NOT open yet
 *   3. `PRE_CAPTURE_MS` of that state
 *   4. the capture opens
 *   5. the 4 s measurement window
 *
 * Step 3 is variant (a)'s leak window, deliberately reproduced. `setAudioMuted`
 * removed, the spike measured 1.90 s of full-level audio at peak 0.499893
 * reaching the device between +0.60 s and +2.50 s, with the capture opening at
 * +2.48 s — and a capture-window-scoped meter read 0.0 for it in three recorded
 * runs. That is why the speaker side of this gate records the app's whole
 * lifetime and why this probe plays the source BEFORE it captures: an app that
 * armed first would never produce the leak the gate exists to catch.
 */
import fs from 'node:fs';
import path from 'node:path';

/** The measurement window. `docs/TESTING.md` §8: 4 s, and its weakness is stated there. */
const WINDOW_SECONDS = 4;

/**
 * The measuring AudioContext's rate, PINNED rather than defaulted.
 *
 * Assertion 3 is grounded on a render-quanta count (`>= 1450` over 4 s), and a
 * quantum is 128 frames of the CONTEXT's rate — so the threshold is arithmetic
 * on this number: 4 s x 48000 / 128 = 1500, and 1450 is 96.7 % of it. Letting the
 * platform choose would make the same assertion mean 1378 quanta on a box whose
 * default context opens at 44100, i.e. a gate that goes red on the machine
 * rather than on the code. The spike's own 1500-quanta windows were taken at
 * this rate.
 *
 * It is NOT the engine's rate. `docs/AUDIO.md` §1.2 runs the product at 44100
 * with no JS resampling; this context is a meter, it is fed by a
 * `MediaStreamSource` and its output reaches `destination` through a gain of
 * exactly 0, so what it resamples is a number, not the product's audio.
 */
const CTX_RATE = 48000;

/** How long the source plays with NO capture open. See the header. */
const PRE_CAPTURE_MS = 1500;

/**
 * The meter, on this origin. `/gate/` -> `tools/fixture/`, mounted by
 * `src/main/main.js` only while `--gate=DIR` is set.
 */
const WORKLET_URL = 'app://workbench/gate/rms-worklet.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** `executeJavaScript` in the main world, with the throw kept as data. */
async function evalIn(wc, code) {
  try { return await wc.executeJavaScript(code); }
  catch (err) { return { THREW: String((err && err.message) || err) }; }
}

/** What the source view says about itself, sampled next to a measurement. */
const viewState = (wc) => ({
  isAudioMuted: wc.isAudioMuted(),
  /**
   * REPORTED, NEVER ASSERTED ON. It stayed TRUE in every muted run of the
   * original matrix and of all three audits: it reports that the page is
   * PRODUCING audio, not that anything can hear it. `docs/TESTING.md` §8, "Not
   * asserted, deliberately" — asserting it false is a gate that can never pass.
   */
  isCurrentlyAudible: wc.isCurrentlyAudible(),
  url: wc.getURL(),
});

/**
 * OPEN THE CAPTURE THROUGH THE SHIPPING HOST, and stand the meter up on it.
 *
 * The meter is `tools/fixture/rms-worklet.js`, fetched from `app://workbench/gate/`
 * — a root `src/main/main.js` mounts ONLY while `--gate=DIR` is set. It is not in
 * `src/renderer/` because it is test code, and it is not a `blob:` module because
 * this origin's `script-src 'self' 'wasm-unsafe-eval'` refuses one. That refusal
 * was measured here, not assumed.
 *
 * THE MONITOR GAIN IS EXACTLY 0, and that is two requirements at once. Chromium
 * only pulls graph nodes that reach `ctx.destination`, so an UNCONNECTED worklet
 * reports 0 for ever — a zero meaning "not measured", indistinguishable from
 * silence. And the question this gate asks is whether the ORIGINAL leaks; the
 * speaker meter outside the process cannot tell an original from a replay, so a
 * meter that played what it heard would make every reading worthless. Connected,
 * and inaudible. The value is reported per run and the suite asserts it.
 */
const OPEN_CAPTURE = (token) => `(async () => {
  const out = { ok: false };
  try {
    const host = await import('./vendor/stem-splitter-live/extension/offscreen/host.js');
    const stream = await host.captureStream(${JSON.stringify(token)});
    const audio = stream.getAudioTracks();
    out.audioTracks = audio.length;
    out.videoTracks = stream.getVideoTracks().length;
    const track = audio[0] || null;
    out.settings = track && track.getSettings ? track.getSettings() : null;
    out.track = track ? { readyState: track.readyState, enabled: track.enabled, muted: track.muted } : null;
    if (!track) { out.reason = 'the grant carried no audio track'; return out; }

    const ctx = new AudioContext({ sampleRate: ${CTX_RATE} });
    if (ctx.state !== 'running') await ctx.resume();
    await ctx.audioWorklet.addModule(${JSON.stringify(WORKLET_URL)});

    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'wb-rms', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    const gain = new GainNode(ctx, { gain: 0 });
    src.connect(node).connect(gain).connect(ctx.destination);

    window.__wbGateCapture = { ctx, node, gain, stream, track };
    out.ok = true;
    out.contextSampleRate = ctx.sampleRate;
    out.contextState = ctx.state;
    out.monitorGain = gain.gain.value;
    return out;
  } catch (e) {
    out.name = e && e.name;
    out.reason = String((e && e.message) || e);
    return out;
  }
})()`;

/**
 * THE WINDOW. Returns counters, never a bare number.
 *
 * `quanta === 0` and `quantaWithChannels === 0` and `n === 0` are each turned
 * into a REASON here rather than into an RMS of 0: a worklet that was never
 * pulled and a worklet fed digital silence compute the same 0, and only the
 * counters tell them apart. `docs/TESTING.md` §8 assertion 3.
 */
const MEASURE = (seconds) => `(async () => {
  const h = window.__wbGateCapture;
  if (!h) return { ok: false, reason: 'the capture was never opened' };
  const r = await new Promise((resolve) => {
    h.node.port.onmessage = (e) => resolve(e.data);
    h.node.port.postMessage('start');
    setTimeout(() => h.node.port.postMessage('stop'), ${seconds} * 1000);
  });
  const base = {
    quanta: r.quanta, quantaWithChannels: r.quantaWithChannels, samples: r.n,
    workletSampleRate: r.sampleRate, peak: r.peak,
    series: (r.series || []).map((v) => Number(v.toFixed(6))),
    monitorGain: h.gain.gain.value,
    contextState: h.ctx.state,
    track: { readyState: h.track.readyState, enabled: h.track.enabled, muted: h.track.muted },
    settingsAtEnd: h.track.getSettings ? h.track.getSettings() : null,
  };
  if (r.quanta === 0) return { ok: false, reason: 'the worklet never ran — 0 render quanta', ...base };
  if (r.quantaWithChannels === 0 || r.n === 0) {
    return { ok: false, reason: 'the worklet ran but received no input channels', ...base };
  }
  return {
    ok: true, rms: Math.sqrt(r.sum / r.n),
    channels: Math.round(r.n / (r.quantaWithChannels * 128)),
    // Wall seconds the worklet ACTUALLY saw, so a short window cannot be
    // reported as a quiet one. Reported next to the quanta count, never
    // substituted for it.
    seconds: r.quantaWithChannels * 128 / r.sampleRate,
    ...base,
  };
})()`;

const STOP = `(async () => {
  const h = window.__wbGateCapture;
  if (!h) return { stopped: false };
  const at = { readyState: h.track.readyState };
  try { for (const t of h.stream.getTracks()) t.stop(); } catch (e) { at.stopThrew = String(e.message || e); }
  try { await h.ctx.close(); } catch (e) { at.closeThrew = String(e.message || e); }
  delete window.__wbGateCapture;
  return { stopped: true, ...at };
})()`;

export async function runGate({ state, outDir, sourceUrl, appRoot }) {
  fs.mkdirSync(outDir, { recursive: true });
  const engineWc = state.engineWin.webContents;
  const srcWc = state.source.webContents;
  const t0 = Date.now();
  const since = () => Date.now() - t0;

  const R = {
    gate: 1,
    probe: 'capture-mute',
    when: new Date().toISOString(),
    versions: process.versions,
    platform: process.platform,
    sourceUrl,
    /**
     * THE PIDS THIS RUN OWNS, from inside. The suite walks `/proc` for the whole
     * tree because Chromium puts audio output in its own utility process — but
     * the browser process's own pid comes from here, so a suite that walked the
     * wrong tree cannot silently agree with itself.
     */
    pid: process.pid,
    env: {
      pulseSink: process.env.PULSE_SINK || null,
      pipewireNode: process.env.PIPEWIRE_NODE || null,
      display: process.env.DISPLAY || null,
    },
    window: { seconds: WINDOW_SECONDS, contextRate: CTX_RATE, preCaptureMs: PRE_CAPTURE_MS },
    timeline: {},
  };

  // ------------------------------------------------- 1. muted, before anything
  /**
   * THE WITNESS FROM `createSourceView`, not a re-read. `mutedBeforeLoad` is
   * sampled one statement before `loadURL`, in a different function from the
   * `setAudioMuted` call, so a mute moved AFTER the first load reads `false`
   * here rather than merely looking rearranged.
   */
  R.mute = { witness: JSON.parse(JSON.stringify(state.source.witness)) };
  R.mute.atBoot = viewState(srcWc);

  // ------------------------------------------------------ 2. the source plays
  /**
   * `tools/fixture/player.html` loads PAUSED and exposes `__wbFixture.play()`.
   * Nothing about the Host starts it, and a window measured over a paused player
   * is a silence reading on both meters that looks exactly like a pass.
   */
  R.play = await evalIn(srcWc, `(async () => {
    if (!window.__wbFixture || !window.__wbFixture.play) return { ok: false, reason: 'no fixture on this source' };
    const said = await window.__wbFixture.play();
    for (let i = 0; i < 100; i++) {
      const s = window.__wbFixture();
      if (s && !s.paused && s.currentTime > 0.3) return { ok: true, said, ...s };
      await new Promise((r) => setTimeout(r, 100));
    }
    return { ok: false, reason: 'playback never started', said, ...(window.__wbFixture() || {}) };
  })()`);
  R.timeline.playingAtMs = since();
  R.mute.whilePlaying = viewState(srcWc);

  /**
   * VARIANT (a)'s LEAK WINDOW, on purpose. See the header: the source is playing
   * and no capture is open. Chromium's local-echo silencing begins when the
   * CAPTURE begins, so this is the only interval in which an unmuted view is
   * audible — and the speaker recorder outside the process is running through it.
   */
  await wait(PRE_CAPTURE_MS);
  R.timeline.preCaptureEndedAtMs = since();
  R.mute.beforeCapture = viewState(srcWc);

  // ---------------------------------------------------- 3. the capture, for real
  /**
   * THE METER IS FETCHED, NOT INLINED. `src/main/main.js` maps `/gate/` to
   * `tools/fixture/` only while `--gate=DIR` is set, because a worklet module is
   * fetched under `script-src` and this origin's CSP is `script-src 'self'
   * 'wasm-unsafe-eval'` — a `blob:` module is REFUSED here, measured. The file on
   * disk is `tools/fixture/rms-worklet.js` and it is checked to be reachable
   * before the capture is opened, so "the gate root is not mounted" reads as
   * itself rather than as a capture failure.
   */
  R.worklet = { url: WORKLET_URL, onDisk: fs.existsSync(path.join(appRoot, 'tools', 'fixture', 'rms-worklet.js')) };
  R.worklet.head = await evalIn(engineWc,
    `fetch(${JSON.stringify(WORKLET_URL)}, { method: 'HEAD' }).then((r) => r.status, (e) => String(e))`);
  /**
   * MINTED THE WAY THE ARM PATH MINTS ONE. `src/main/engine-messages.js`
   * `captureStart()` calls `claims.mint({ sourceWcId, deck })` and puts the token
   * on the wire; this does the first half and hands the token straight to the
   * shipping `captureStream`, so the claim, the grant and the constraints are all
   * the product's. What is NOT exercised is the bus hop and the engine's own ring
   * — those are `engine-host`'s, over the model, and this gate must run on a box
   * with no weights.
   */
  const token = state.claims.mint({ sourceWcId: srcWc.id, deck: 'capture-mute-gate' });
  R.capture = await evalIn(engineWc, OPEN_CAPTURE(token));
  R.timeline.captureOpenAtMs = since();
  R.captureStats = JSON.parse(JSON.stringify(state.capture.stats));
  R.sourceFrame = { processId: srcWc.mainFrame.processId, routingId: srcWc.mainFrame.routingId };

  // --------------------------------------------------------- 4. the window
  /**
   * THE READY FILE. The suite is sampling the sink's link graph from outside and
   * has to sample INSIDE this window — a witness taken before the capture opened
   * or after it closed answers a different question. Touched here rather than
   * timed with a `sleep` on the other side.
   */
  const openMark = path.join(outDir, 'window.open');
  fs.writeFileSync(openMark, `${Date.now()}\n`);
  R.timeline.windowOpenAtMs = since();
  R.measured = await evalIn(engineWc, MEASURE(WINDOW_SECONDS));
  R.timeline.windowClosedAtMs = since();
  fs.writeFileSync(path.join(outDir, 'window.close'), `${Date.now()}\n`);

  R.mute.afterCapture = viewState(srcWc);
  R.fixtureAfter = await evalIn(srcWc, 'window.__wbFixture ? window.__wbFixture() : null');
  R.stopped = await evalIn(engineWc, STOP);
  R.claims = state.claims.inspect();
  R.claimStats = JSON.parse(JSON.stringify(state.claims.stats));

  fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(R, null, 2)}\n`);
  console.log(`[gate] wrote ${path.join(outDir, 'report.json')}`);
  return 0;
}
