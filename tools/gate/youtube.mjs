/**
 * The gate's eyes on the WHOLE PRODUCT, over one real launch, against real
 * youtube.com — the run that answers the question step 3 of the plan is judged
 * on: *does a YouTube page, armed by hand, come out of this app as six live
 * stems?*
 *
 * `src/main/main.js --gate=DIR --gate-probe=youtube --source-url=<watch url>`
 * imports this file — dynamically, and only when those flags are present —
 * hands it the live handles, and exits with what it returns.
 * `tools/suites/youtube.mjs` spawns that launch and asserts over
 * `DIR/report.json`. It is MANUAL: it needs the network, it needs the 109 MB
 * weights, and its subject is a site nobody here controls.
 *
 * ---------------------------------------------------------------------------
 * WHY A THIRD PROBE
 * ---------------------------------------------------------------------------
 * One probe per QUESTION, the rule `tools/gate/engine-host.mjs` states.
 *
 *   `probe.mjs`        is the app the shape it says it is?   ~2 s, no unit.
 *   `engine-host.mjs`  does the ENGINE half of the seam hold? It arms a real
 *                      capture over a LOCAL fixture and never presses play on
 *                      anything a human would recognise.
 *   this file          does the PRODUCT work end to end on the real site? It
 *                      presses play on YouTube's own player, arms from the
 *                      application menu, and reads the six stems back off the
 *                      engine's own METERS.
 *
 * ---------------------------------------------------------------------------
 * IT NEVER ASSERTS, AND IT NEVER TOUCHES THE MEDIA
 * ---------------------------------------------------------------------------
 * Every number below is READ OUT of the running app and judged in a separate
 * process — a probe that decided its own verdict would be a suite that exits 0
 * having asserted nothing.
 *
 * L1 applies to the gate too. This file reads `paused`, `currentTime`,
 * `duration`, `volume`, `muted`, `readyState` and a bounding rect off the
 * page's `<video>`, and the ad class off `#movie_player`. It never reads `src`,
 * `currentSrc`, `buffered` or `srcObject`, never calls `captureStream()`, and
 * never resolves, fetches or parses a media URL. `R.sourceRequests` records
 * every URL the source session asked for while we drove it, so the claim is
 * measured rather than promised.
 *
 * ---------------------------------------------------------------------------
 * PLAY IS A REAL INPUT EVENT, NOT `video.play()`
 * ---------------------------------------------------------------------------
 * `el.play()` does not appear in this file and must not: the product's whole
 * position is that it captures what the USER'S OWN PLAYER renders, and the
 * shipped preload has no `play()` in it at all (`src/main/transport.js`: "there
 * is no command that can call `pause()`", and there is none that can call
 * `play()` either). So the gesture here is `webContents.sendInputEvent` — a
 * left click at the centre of the `<video>`, which is what a user does, and
 * which YouTube's own player handles with its own code. If the click lands on
 * an overlay instead (a consent wall, a sign-in gate), the video stays paused
 * and that is a RED with a screenshot next to it, which is the honest outcome.
 *
 * The click is CONDITIONAL on `paused`, because the same gesture pauses a
 * playing video: the probe reads the player's state first, clicks only if it is
 * paused, and records every attempt in `R.play.attempts`.
 */
import { app, Menu } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

import { STEMS } from '../../vendor/stem-splitter-live/extension/shared/config.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * WHERE THE OFFLINE SEGMENT IS TAKEN FROM, in seconds into the CONTENT.
 * Far enough in that a pop song is in its body — drums, bass, a vocal and
 * whatever else — rather than in an intro, and early enough that a short video
 * still has it. It is a position, not a level: nothing here asserts what is at
 * that timestamp, and the report records where the playhead actually landed.
 */
const OFFLINE_SEEK_SEC = 48;
/** A value read out of a live page is not a promise — see `evalIn`. */
const O = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** `executeJavaScript` in the main world, with the throw kept as data. */
async function evalIn(wc, code, userGesture = false) {
  try { return await wc.executeJavaScript(code, userGesture); }
  catch (err) { return { THREW: String((err && err.message) || err) }; }
}

/**
 * How many distinct pixels a view actually drew — `tools/gate/probe.mjs`'s
 * instrument, and the reason is the same one: a blank page and a painted page
 * both produce a PNG, and a byte count cannot tell them apart. Sampled every
 * 97th pixel (a prime, so the stride cannot land on a repeating column and see
 * one colour for ever).
 */
function paintedColours(image) {
  const { width, height } = image.getSize();
  const bmp = image.toBitmap();
  const seen = new Set();
  for (let p = 0; p * 4 + 3 < bmp.length; p += 97) {
    const o = p * 4;
    seen.add((bmp[o] << 24) | (bmp[o + 1] << 16) | (bmp[o + 2] << 8) | bmp[o + 3]);
  }
  return { width, height, colours: seen.size };
}

async function capture(wc, file) {
  try {
    const image = await wc.capturePage();
    if (image.isEmpty()) return { ok: false, why: 'capturePage returned an empty image' };
    fs.writeFileSync(file, image.toPNG());
    return { ok: true, file: path.basename(file), bytes: fs.statSync(file).size, ...paintedColours(image) };
  } catch (err) {
    return { ok: false, why: String((err && err.message) || err) };
  }
}

/**
 * THE WHOLE WINDOW, as the compositor drew it, off the X display this run owns.
 *
 * `capturePage()` is per-`WebContents`: it can photograph the deck and it can
 * photograph the source view, and it cannot photograph the three of them
 * together in one window because no `WebContents` contains the others. The
 * owner asked for "the running app with the deck painted and the stems live",
 * which is a picture of the WINDOW — so the window is grabbed from outside, off
 * `$DISPLAY`, with ImageMagick's `import`. It is best-effort: no `import(1)`, no
 * `$DISPLAY`, no picture, and the per-view captures still stand.
 */
function grabDisplay(file) {
  return new Promise((resolve) => {
    if (!process.env.DISPLAY) return resolve({ ok: false, why: 'no DISPLAY on this process' });
    execFile('import', ['-display', process.env.DISPLAY, '-window', 'root', file], { timeout: 30_000 }, (err) => {
      if (err) return resolve({ ok: false, why: String(err.message || err).slice(0, 200) });
      try { resolve({ ok: true, file: path.basename(file), bytes: fs.statSync(file).size }); }
      catch (e) { resolve({ ok: false, why: String(e.message || e) }); }
    });
  });
}

/**
 * THE BUS TAP — the same instrument `engine-host.mjs` uses, with one addition:
 * `METERS` arrives at ~30 Hz and its payload is the evidence, so those are kept
 * by VALUE while everything else keeps its shape only.
 *
 * `sourceToken` is redacted to its length. It is a live capability for ten
 * seconds and a report file is not the place for one.
 */
function trace() {
  const out = {};
  const rows = [];
  const meters = [];
  const liveStates = [];
  let lastState = null;
  const record = (msg, verdict) => {
    if (!msg || typeof msg !== 'object') { rows.push({ verdict, malformed: true }); return; }
    const at = Date.now();
    if (msg.type === 'STATE') lastState = msg.state;
    if (msg.type === 'METERS') meters.push({ at, deck: msg.deck, rms: msg.rms, peak: msg.peak, clip: !!msg.clip });
    if (msg.type === 'LIVE_STATS') out.liveStatsPayload = JSON.parse(JSON.stringify(msg));
    if (msg.type === 'DIAG_REPORT') out.diagPayload = JSON.parse(JSON.stringify(msg.diag || msg));
    if (msg.type === 'LIVE_STATE' || msg.type === 'LIVE_ERROR') {
      liveStates.push({ at, type: msg.type, ...JSON.parse(JSON.stringify(msg)) });
    }
    rows.push({
      verdict, to: msg.to, from: msg.from, type: msg.type,
      keys: Object.keys(msg).sort(),
      deck: msg.deck === undefined ? null : msg.deck,
      // L1 AND THE FROZEN SHAPE: `CAPTURE_START.source` is `{title, url}` and
      // must never grow a `tabId` or anything about a stream.
      sourceKeys: msg.source && typeof msg.source === 'object' ? Object.keys(msg.source).sort() : null,
      tokenLength: typeof msg.sourceToken === 'string' ? msg.sourceToken.length : null,
      at,
    });
  };
  return {
    record, rows, meters, liveStates,
    get liveStatsPayload() { return out.liveStatsPayload || null; },
    get diagPayload() { return out.diagPayload || null; },
    state: () => lastState,
    async until(pred, ms, poll = 50) {
      const deadline = Date.now() + ms;
      for (;;) {
        const hit = rows.find(pred);
        if (hit) return hit;
        if (Date.now() > deadline) return null;
        await wait(poll);
      }
    },
    async stateUntil(pred, ms, poll = 100) {
      const deadline = Date.now() + ms;
      for (;;) {
        if (lastState && pred(lastState)) return lastState;
        if (Date.now() > deadline) return null;
        await wait(poll);
      }
    },
  };
}

/**
 * WHAT THE PAGE'S PLAYER IS DOING — five fields and a rectangle, and not one of
 * them is a media source. `readyState` is the element's own readiness enum, not
 * a URL; `volume` and `muted` are what the ad-vs-content and mute claims are
 * read from.
 */
const PLAYER = `(() => {
  const v = document.querySelector('video');
  const mp = document.querySelector('#movie_player');
  const r = v ? v.getBoundingClientRect() : null;
  return {
    hasVideo: !!v,
    paused: v ? v.paused : null,
    ended: v ? v.ended : null,
    currentTime: v ? v.currentTime : null,
    duration: v && Number.isFinite(v.duration) ? v.duration : null,
    volume: v ? v.volume : null,
    muted: v ? v.muted : null,
    readyState: v ? v.readyState : null,
    rect: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
    adShowing: mp ? mp.classList.contains('ad-showing') : null,
    playerClasses: mp ? String(mp.className).slice(0, 200) : null,
    title: document.title,
    href: location.href,
    bodyText: document.body ? document.body.innerText.slice(0, 400) : null,
  };
})()`;

/**
 * THE AD, AND WHY THE RUN WAITS FOR IT TO END.
 *
 * `docs/TESTING.md` §7 carries the run that made this necessary: one recorded
 * spike measurement was taken over a PRE-ROLL AD — `duration 60.101` where every
 * other run read `213.061` — and nothing in the report said so. An uncontrolled
 * measurement that does not say what it measured is not evidence, and one that
 * measured a different piece of audio than the reader assumes is worse than none.
 *
 * So the probe waits for `#movie_player` to drop `ad-showing` before it arms,
 * and it presses SKIP when YouTube offers one — a real click on YouTube's own
 * button, the same gesture and the same L1 position as pressing play. What it
 * measured either way is recorded in `R.ad`.
 */
const SKIP = `(() => {
  const sel = '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, button.ytp-ad-skip-button-modern';
  const b = document.querySelector(sel);
  if (!b) return { found: false };
  const r = b.getBoundingClientRect();
  return { found: true, visible: r.width > 4 && r.height > 4, rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
})()`;

/**
 * ===========================================================================
 * 6b. THE SEPARATOR, WITHOUT THE CLOCK — the phase's headline claim
 * ===========================================================================
 *
 * SEPARATING SIX STEMS AND KEEPING UP WITH LIVE PLAYBACK ARE TWO CLAIMS, and
 * this box can only make one of them. The hop deadline belongs to the LIVE
 * path: `offscreen/live.js` runs one 7.8 s SEGMENT every 1.95 s HOP, so it
 * needs 4x real time, and a machine that separates a segment in 6.4 s misses
 * every deadline and falls back to passthrough (see `R.stems` above and
 * `R.liveStats`). None of that is a statement about the SEPARATOR.
 *
 * So this phase asks the separator the question with the clock taken away:
 * ONE segment of the audio this app captured from the real YouTube page,
 * through `host.createBackend()` — the same Host duty `Deck.ensureBackend()`
 * calls — with the real weights `host.modelBytes()` hands over, and no budget.
 * `Backend.separate(mix, out)` has no deadline on its interface: "A backend
 * either separates or throws" (`shared/host.js`), and `Deck.infer`'s own
 * `budgetMs = Infinity` default is the unit's name for this case.
 *
 * WHAT COMES BACK IS THE PROOF, and it is arithmetic rather than a meter:
 *   · SIX PLANE PAIRS, laid out `(k*2 + ch) * SEGMENT + i`, stem-major, left
 *     before right — the layout `shared/host.js` freezes for this interface.
 *     Their per-stem RMS is reported in `STEMS` order: drums, bass, other,
 *     vocals, guitar, piano.
 *   · THE SUM. `htdemucs` is a masking separator: the six stems sum back to
 *     the input. So `rms(mix - sum(stems))` is small, and `rms(sum)` is close
 *     to `rms(mix)`. Six COPIES of the mix would sum to six times it — which is
 *     the one arithmetic that cannot be faked by a plausible-looking meter, and
 *     it is why this is computed here rather than asserted from levels alone.
 *
 * THE CAPTURE IS THE HOST'S OWN DUTY, not a second path: `host.captureStream()`
 * with a claim `main` minted, exactly as the engine gets one. What this phase
 * does NOT use is the engine's ring and scheduler, because those are the two
 * pieces that carry the deadline.
 */
const DRIVE_OFFLINE = (token) => `(async () => {
  const out = { token: ${JSON.stringify(token)}.length };
  try {
    const host = await import('./vendor/stem-splitter-live/extension/offscreen/host.js');
    const cfg = await import('./vendor/stem-splitter-live/extension/shared/config.js');
    const { STEMS, SEGMENT, SR } = cfg;
    out.segment = SEGMENT;
    out.sr = SR;

    // ---------------------------------------------------------- 1. the audio
    const stream = await host.captureStream(${JSON.stringify(token)});
    const track = stream.getAudioTracks()[0];
    out.settings = track ? track.getSettings() : null;
    const L = new Float32Array(SEGMENT);
    const R = new Float32Array(SEGMENT);
    let have = 0;

    // WebCodecs, because it hands over the track's own frames with no audio
    // graph in the middle: no worklet file (the deck's CSP is script-src
    // 'self'), no ScriptProcessorNode, and no resampling. The fallback is the
    // deprecated node, and which one ran is reported rather than assumed.
    if (typeof MediaStreamTrackProcessor === 'function') {
      out.recorder = 'MediaStreamTrackProcessor';
      const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
      const deadline = performance.now() + 30000;
      while (have < SEGMENT && performance.now() < deadline) {
        const { value: frame, done } = await reader.read();
        if (done || !frame) break;
        const n = Math.min(frame.numberOfFrames, SEGMENT - have);
        const tmp = new Float32Array(frame.numberOfFrames);
        frame.copyTo(tmp, { planeIndex: 0, format: 'f32-planar' });
        L.set(tmp.subarray(0, n), have);
        if (frame.numberOfChannels > 1) {
          frame.copyTo(tmp, { planeIndex: 1, format: 'f32-planar' });
          R.set(tmp.subarray(0, n), have);
        } else {
          R.set(tmp.subarray(0, n), have);
        }
        out.frameSampleRate = frame.sampleRate;
        out.frameChannels = frame.numberOfChannels;
        frame.close();
        have += n;
      }
      try { reader.cancel(); } catch (e) { /* the track is about to stop */ }
    } else {
      out.recorder = 'ScriptProcessorNode';
      const ctx = new AudioContext({ sampleRate: SR });
      if (ctx.state !== 'running') await ctx.resume().catch(() => {});
      const src = ctx.createMediaStreamSource(stream);
      const sp = ctx.createScriptProcessor(16384, 2, 2);
      const sink = new GainNode(ctx, { gain: 0 });
      await new Promise((resolve) => {
        sp.onaudioprocess = (e) => {
          if (have >= SEGMENT) return resolve();
          const n = Math.min(e.inputBuffer.length, SEGMENT - have);
          L.set(e.inputBuffer.getChannelData(0).subarray(0, n), have);
          R.set(e.inputBuffer.getChannelData(Math.min(1, e.inputBuffer.numberOfChannels - 1)).subarray(0, n), have);
          have += n;
          if (have >= SEGMENT) resolve();
        };
        src.connect(sp); sp.connect(sink).connect(ctx.destination);
        setTimeout(resolve, 30000);
      });
      out.frameSampleRate = ctx.sampleRate;
      await ctx.close().catch(() => {});
    }
    for (const t of stream.getTracks()) t.stop();
    out.captured = have;

    const rms = (a, from, n) => {
      let s = 0;
      for (let i = 0; i < n; i++) { const v = a[from + i]; s += v * v; }
      return Math.sqrt(s / n);
    };
    out.mixRms = { l: rms(L, 0, have), r: rms(R, 0, have) };
    if (have < SEGMENT) { out.why = 'the capture did not fill a whole segment'; return out; }

    // ------------------------------------------------- 2. the Host's backend
    const t0 = performance.now();
    let ready = null;
    const backend = host.createBackend({
      name: 'the offline probe',
      onReady: (info) => { ready = info; },
      onFail: (err) => { out.backendFail = String((err && err.message) || err); },
    });
    const got = await host.modelBytes();
    out.modelBytes = got.bytes.length;
    out.load = await backend.load(got.bytes.buffer);
    out.ready = ready;
    out.loadMs = Math.round(performance.now() - t0);

    // ------------------------------------------------------ 3. one segment
    const mix = new Float32Array(2 * SEGMENT);
    mix.set(L, 0);
    mix.set(R, SEGMENT);
    const stemsBuf = new Float32Array(STEMS.length * 2 * SEGMENT);
    const t1 = performance.now();
    const res = await backend.separate(mix.buffer, stemsBuf.buffer);
    out.separateMs = Math.round(performance.now() - t1);
    out.timing = { prepMs: res.prepMs, inferMs: res.inferMs, postMs: res.postMs };
    // BORROW AND RETURN: the buffers were transferred and come back in the
    // resolution. Re-adopt them by name, exactly as LivePipeline does.
    const stems = new Float32Array(res.stems);
    const mixBack = new Float32Array(res.mix);
    out.buffersReturned = { mix: res.mix.byteLength, stems: res.stems.byteLength };

    // -------------------------------------------------- 4. what came back
    const sumL = new Float32Array(SEGMENT);
    const sumR = new Float32Array(SEGMENT);
    out.perStem = STEMS.map((name, k) => {
      const lOff = (k * 2 + 0) * SEGMENT;
      const rOff = (k * 2 + 1) * SEGMENT;
      let peak = 0;
      for (let i = 0; i < SEGMENT; i++) {
        sumL[i] += stems[lOff + i];
        sumR[i] += stems[rOff + i];
        const a = Math.abs(stems[lOff + i]); if (a > peak) peak = a;
        const b = Math.abs(stems[rOff + i]); if (b > peak) peak = b;
      }
      return {
        stem: name,
        index: k,
        rmsL: rms(stems, lOff, SEGMENT),
        rmsR: rms(stems, rOff, SEGMENT),
        peak,
      };
    });
    // THE SUM. A masking separator's stems add back to the input; six copies of
    // the mix would add to six times it.
    let resid = 0, sums = 0, mixs = 0;
    for (let i = 0; i < SEGMENT; i++) {
      const dl = mixBack[i] - sumL[i];
      const dr = mixBack[SEGMENT + i] - sumR[i];
      resid += dl * dl + dr * dr;
      sums += sumL[i] * sumL[i] + sumR[i] * sumR[i];
      mixs += mixBack[i] * mixBack[i] + mixBack[SEGMENT + i] * mixBack[SEGMENT + i];
    }
    const nn = SEGMENT * 2;
    out.sum = {
      mixRms: Math.sqrt(mixs / nn),
      sumRms: Math.sqrt(sums / nn),
      residualRms: Math.sqrt(resid / nn),
    };
    await backend.dispose();
  } catch (e) { out.THREW = String((e && e.message) || e); }
  return out;
})()`;

export async function runGate({ state, outDir, sourceUrl }) {
  fs.mkdirSync(outDir, { recursive: true });
  const srcWc = state.source.webContents;
  const deckWc = state.deck.webContents;
  const engineWc = state.engineWin.webContents;
  const BUS = state.bus.BUS;

  const R = {
    gate: 1,
    probe: 'youtube',
    when: new Date().toISOString(),
    versions: process.versions,
    platform: process.platform,
    sourceUrl,
    stems: STEMS,
    phases: [],
  };
  const phase = (name, extra = {}) => { R.phases.push({ name, at: Date.now(), ...extra }); };

  const t = trace();
  state.bus.tap(t.record);

  // =====================================================================
  // 1. THE PAGE — what did youtube.com actually give us
  // =====================================================================
  phase('page');
  // The document is already loaded (`boot()` awaited it); this waits for the
  // PLAYER, which YouTube builds afterwards and which the preload announces.
  let player = null;
  for (let i = 0; i < 120; i++) {
    player = await evalIn(srcWc, PLAYER);
    if (player && player.hasVideo && player.readyState >= 1) break;
    await wait(500);
  }
  R.page = player;
  R.transportBeforePlay = state.transport.lastState();
  R.sourceUrlLoaded = srcWc.getURL();
  R.sourceTitle = srcWc.getTitle();
  R.mute = {
    isAudioMuted: srcWc.isAudioMuted(),
    witness: JSON.parse(JSON.stringify(state.source.witness)),
    refusals: JSON.parse(JSON.stringify(state.source.stats)),
  };
  R.shot = {};
  R.shot.beforePlay = await capture(srcWc, path.join(outDir, '10-source-before-play.png'));

  // =====================================================================
  // 2. PLAY — a real click on the user's own player
  // =====================================================================
  phase('play');
  R.play = { attempts: [] };
  for (let attempt = 0; attempt < 4; attempt++) {
    const before = await evalIn(srcWc, PLAYER);
    if (before && before.hasVideo && before.paused === false) {
      R.play.attempts.push({ attempt, skipped: 'already playing', currentTime: before.currentTime });
      break;
    }
    const rect = before && before.rect;
    const how = attempt < 2 ? 'click' : 'key-k';
    if (how === 'click' && rect && rect.w > 20 && rect.h > 20) {
      const x = Math.round(rect.x + rect.w / 2);
      const y = Math.round(rect.y + rect.h / 2);
      srcWc.sendInputEvent({ type: 'mouseMove', x, y });
      await wait(60);
      srcWc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      await wait(40);
      srcWc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
      R.play.attempts.push({ attempt, how, x, y, wasPaused: before.paused });
    } else {
      // YouTube's own shortcut, after the click has given the player focus.
      srcWc.sendInputEvent({ type: 'keyDown', keyCode: 'k' });
      srcWc.sendInputEvent({ type: 'char', keyCode: 'k' });
      srcWc.sendInputEvent({ type: 'keyUp', keyCode: 'k' });
      R.play.attempts.push({ attempt, how, wasPaused: before && before.paused, rect });
    }
    // The element needs a moment, and an ad needs longer than a moment.
    for (let i = 0; i < 20; i++) {
      const now = await evalIn(srcWc, PLAYER);
      if (now && now.paused === false) break;
      await wait(250);
    }
  }
  R.playing = await evalIn(srcWc, PLAYER);
  R.transportAfterPlay = state.transport.lastState();
  R.shot.playing = await capture(srcWc, path.join(outDir, '11-source-playing.png'));

  // =====================================================================
  // 2b. THE AD — wait it out, or press YouTube's own Skip
  // =====================================================================
  /**
   * ONE FUNCTION, CALLED TWICE, BECAUSE THE AD COMES BACK.
   *
   * A pre-roll is not only a boot-time event: the full page RELOAD in phase 7
   * asks YouTube for the watch page again, and YouTube served a 75.1 s
   * advertisement the second time in a recorded run — after which the offline
   * segment in 7b separated the AD instead of the song, and reported it as a
   * result. §7 of docs/TESTING.md names that exact failure ("one recorded
   * YouTube run was measuring a PRE-ROLL AD, at `duration 60.101` where every
   * other run read `213.061`"). So the wait is a function and every phase that
   * measures CONTENT calls it first, and the `adShowing` flag and the duration
   * are recorded next to every measurement so a reader can tell what was
   * measured.
   *
   * The click is YouTube's OWN Skip button, hit with a real input event, which
   * is the same gesture and the same rule as the play click: we drive the
   * user's player, we never touch the media.
   */
  const settleToContent = async (label, deadlineMs = 180_000) => {
    const start = Date.now();
    const rec = { label, sawAd: false, skipPresses: 0, waitedMs: 0, timedOut: false };
    for (;;) {
      const p = await evalIn(srcWc, PLAYER);
      if (!p || p.adShowing !== true) break;
      rec.sawAd = true;
      if (Date.now() - start > deadlineMs) { rec.timedOut = true; break; }
      const skip = await evalIn(srcWc, SKIP);
      if (skip && skip.found && skip.visible && skip.rect) {
        const sx = Math.round(skip.rect.x + skip.rect.w / 2);
        const sy = Math.round(skip.rect.y + skip.rect.h / 2);
        srcWc.sendInputEvent({ type: 'mouseMove', x: sx, y: sy });
        await wait(60);
        srcWc.sendInputEvent({ type: 'mouseDown', x: sx, y: sy, button: 'left', clickCount: 1 });
        await wait(40);
        srcWc.sendInputEvent({ type: 'mouseUp', x: sx, y: sy, button: 'left', clickCount: 1 });
        rec.skipPresses++;
      }
      await wait(1000);
    }
    rec.waitedMs = Date.now() - start;
    let p = await evalIn(srcWc, PLAYER);
    // The content may need the same gesture the ad interrupted.
    if (p && p.hasVideo && p.paused && p.rect) {
      const cx = Math.round(p.rect.x + p.rect.w / 2);
      const cy = Math.round(p.rect.y + p.rect.h / 2);
      srcWc.sendInputEvent({ type: 'mouseMove', x: cx, y: cy });
      await wait(60);
      srcWc.sendInputEvent({ type: 'mouseDown', x: cx, y: cy, button: 'left', clickCount: 1 });
      await wait(40);
      srcWc.sendInputEvent({ type: 'mouseUp', x: cx, y: cy, button: 'left', clickCount: 1 });
      rec.pressedPlay = true;
      await wait(2000);
      p = await evalIn(srcWc, PLAYER);
    }
    rec.after = p;
    return rec;
  };

  phase('ad');
  R.ad = await settleToContent('before arming');
  R.ad.durationBefore = O(R.playing).duration;
  R.content = R.ad.after;

  // =====================================================================
  // 3. ARM — the application menu's own item, clicked
  // =====================================================================
  /**
   * THE GESTURE A USER HAS, and not the function behind it. `deck-host`'s suite
   * calls `host.arm()`; this clicks `Source -> Arm this Source`, so a Host whose
   * menu was never installed fails here and passes there.
   */
  phase('arm');
  const menu = Menu.getApplicationMenu();
  const armItem = menu && menu.getMenuItemById('arm');
  R.menu = {
    installed: !!menu,
    ids: menu ? menu.items.flatMap((m) => (m.submenu ? m.submenu.items.map((i) => i.id || i.label) : [m.id || m.label])) : [],
    armLabel: armItem ? armItem.label : null,
    armAccelerator: armItem ? armItem.accelerator : null,
  };
  const armedAtMs = Date.now();
  if (armItem) armItem.click();
  R.armStats = JSON.parse(JSON.stringify(state.deckHost.stats));

  // =====================================================================
  // 4. THE SEAM — what the arm gesture set in motion
  // =====================================================================
  phase('seam');
  const session = await t.until((r) => r.type === 'SESSION' && r.at >= armedAtMs, 10_000);
  const swCapture = await t.until((r) => r.type === 'SW_CAPTURE_START' && r.at >= armedAtMs, 30_000);
  const captureStart = await t.until((r) => r.type === 'CAPTURE_START' && r.at >= armedAtMs, 30_000);
  R.seam = {
    session: session ? { to: session.to, from: session.from, keys: session.keys } : null,
    swCaptureStart: swCapture ? { to: swCapture.to, from: swCapture.from, keys: swCapture.keys } : null,
    captureStart: captureStart
      ? {
        to: captureStart.to, from: captureStart.from, keys: captureStart.keys,
        sourceKeys: captureStart.sourceKeys, tokenLength: captureStart.tokenLength,
      }
      : null,
  };
  const recording = await t.stateUntil((s) => s.capture && s.capture.status === 'recording', 60_000);
  R.capture = recording ? JSON.parse(JSON.stringify(recording.capture)) : null;
  /**
   * WHEN THE CAPTURE DOES NOT OPEN, ASK THE ENGINE WHY — once, here, rather than
   * leaving a re-run to find out.
   *
   * The failure this exists for was measured: the grant was given
   * (`captureStats.granted 1`) and the engine then logged NOTHING and pushed no
   * `STATE`. `offscreen/engine.js captureStart()` awaits `host.captureStream()`,
   * then `ensureContext()`, then `d.attach()`, and every throw on that path is
   * caught and logged — so silence means one of those awaits never settled, and
   * only the engine can say which. `DIAG` is the unit's own paste-this
   * diagnostic ("deliberately NOT behind ?dev=1: it exists to be run by a user
   * whose deck is silent"), and `ctx` being null in it is the whole answer.
   */
  if (!recording) {
    const beforeDiag = t.rows.length;
    state.bus.originate(BUS.engine, { type: 'DIAG' });
    const diagRow = await t.until((r, i) => i >= beforeDiag && r.type === 'DIAG_REPORT', 15_000);
    R.diag = diagRow ? (t.diagPayload || null) : { note: 'the engine did not answer DIAG either' };
    R.engineAlive = await evalIn(engineWc, `({
      ctx: typeof AudioContext, bridge: !!globalThis.__wbEngine, ready: document.readyState,
      up: Math.round(performance.now()), coi: crossOriginIsolated, probe: typeof window.__wbProbe,
    })`);
  }
  const fed = await t.stateUntil((s) => s.capture && s.capture.frames > 0, 30_000);
  R.captureFed = !!fed;

  // The model, through the Host, with the real weights. `DECK_PREPARE` is sent
  // by the DECK (`SW_DECK_PREPARE`) once `modelCached()` came back true.
  /**
   * TWO ROUTES LOAD THE WEIGHTS AND ONLY ONE OF THEM SENDS A MESSAGE.
   * `ui/embed.js maybePrepare()` sends `SW_DECK_PREPARE` only when
   * `modelCached()` came back `'cached'` — i.e. on disk, session not yet built.
   * Arming first takes the other route: `captureStart -> ensureSession()` builds
   * the session inside the capture path and no `DECK_PREPARE` is ever sent. Both
   * end at the same place, so the report records WHICH, and the suite asserts on
   * the model reaching `ready` with the whole file rather than on the message.
   */
  const loaded = await t.stateUntil((st2) => st2.model && (st2.model.status === 'ready' || st2.model.status === 'error'), 180_000);
  const prepared = t.rows.find((r) => r.type === 'DECK_PREPARED') || null;
  R.deckPrepared = !!prepared;
  R.modelLoaded = !!loaded;
  R.modelRoute = prepared ? 'DECK_PREPARE' : 'the capture path (captureStart -> ensureSession)';
  R.model = t.state() ? JSON.parse(JSON.stringify(t.state().model)) : null;
  R.boot = t.state() ? JSON.parse(JSON.stringify(t.state().boot)) : null;

  // =====================================================================
  // 5. SIX STEMS — the engine's own per-stem meters, at ~30 Hz
  // =====================================================================
  /**
   * `METERS {deck, peak:{…}, rms:{…}, clip}` is `live.js`'s own contract (its
   * :1527) — post-stem-fader, pre-crossfader, one entry per `STEMS` name plus
   * `master`. It is the engine saying what came out of the separator, in the
   * unit's own words, and it is the only per-stem observable that exists while
   * the pipeline is running.
   */
  phase('stems');
  /**
   * `deckSummary()` in `offscreen/engine.js` folds the live pipeline down to ONE
   * STRING — `live: d.live.status`, which is `idle | priming | running | error`.
   * It is not the same field as `LIVE_STATE.status`, which the publisher may
   * downgrade to `starving` when the buffer is under the low-water mark; a
   * starving deck is a RUNNING deck that is behind, so both are recorded and
   * only the snapshot's value is waited on.
   */
  const liveRunning = await t.stateUntil(
    (s) => s.decks && s.decks.A && s.decks.A.live === 'running', 180_000);
  R.liveRunning = !!liveRunning;
  R.deckSummary = t.state() && t.state().decks ? JSON.parse(JSON.stringify(t.state().decks)) : null;
  const firstMeterAt = Date.now();
  // Let the first stems arrive before the measuring window opens: the pipeline
  // primes, and the frames it publishes while priming are the passthrough mix.
  for (let i = 0; i < 480 && !t.meters.length; i++) await wait(250);
  R.firstMeterMs = t.meters.length ? t.meters[0].at - firstMeterAt : null;

  const windowStart = Date.now();
  const WINDOW_MS = 20_000;
  await wait(WINDOW_MS);
  const windowEnd = Date.now();

  const inWindow = t.meters.filter((m) => m.at >= windowStart && m.at <= windowEnd);
  const series = {};
  for (const s of [...STEMS, 'master']) {
    const vals = inWindow.map((m) => (m.rms && Number.isFinite(m.rms[s]) ? m.rms[s] : null)).filter((v) => v !== null);
    const peaks = inWindow.map((m) => (m.peak && Number.isFinite(m.peak[s]) ? m.peak[s] : null)).filter((v) => v !== null);
    series[s] = {
      frames: vals.length,
      rmsMean: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
      rmsMax: vals.length ? Math.max(...vals) : null,
      rmsMin: vals.length ? Math.min(...vals) : null,
      peakMax: peaks.length ? Math.max(...peaks) : null,
      nonZeroFrames: vals.filter((v) => v > 1e-6).length,
    };
  }
  /**
   * SIX COPIES OF ONE THING WOULD BE SIX IDENTICAL SERIES, and that is the
   * failure this counts rather than describes: for every frame, how many of the
   * six stem values are distinct. A passthrough mix fanned out to six planes
   * reads 1 here on every frame; a real separation reads 6 on almost all of
   * them.
   */
  const distinct = inWindow.map((m) => new Set(STEMS.map((s) => (m.rms ? m.rms[s] : null))).size);
  R.stems = {
    windowMs: windowEnd - windowStart,
    meterFrames: inWindow.length,
    keysSeen: inWindow.length ? Object.keys(inWindow[0].rms || {}).sort() : [],
    order: STEMS,
    series,
    distinctPerFrame: {
      min: distinct.length ? Math.min(...distinct) : null,
      max: distinct.length ? Math.max(...distinct) : null,
      framesWithAllSix: distinct.filter((n) => n === 6).length,
      framesWithOne: distinct.filter((n) => n === 1).length,
    },
    // The raw series, decimated to ~4 Hz, so a human can read the shape.
    sample: inWindow.filter((_, i) => i % 8 === 0).map((m) => ({
      t: ((m.at - windowStart) / 1000).toFixed(2),
      rms: Object.fromEntries([...STEMS, 'master'].map((s) => [s, Number((m.rms && m.rms[s] ? m.rms[s] : 0).toFixed(6))])),
    })),
  };
  R.liveStates = t.liveStates.slice(-40);
  /**
   * THE FRAME COUNT AT THE END, not at the beginning. `R.capture` is latched the
   * instant the engine first says `recording`, which is by construction the
   * moment before the ring has been fed anything — reporting that number as "the
   * capture" would be reporting a zero that is always a zero.
   */
  R.captureFinal = t.state() && t.state().capture ? JSON.parse(JSON.stringify(t.state().capture)) : null;

  /**
   * WHY THE STEMS LOOK THE WAY THEY DO, in the engine's own numbers.
   *
   * `DEV_LIVE_STATS` is read-only — it returns `d.live.stats()`, the scheduler's
   * own percentiles and drop counts, plus the adapter. It changes nothing, and
   * it is the difference between "the stems were zero" and "the stems were zero
   * BECAUSE every chunk missed its deadline by 3.3x". A report that cannot tell
   * a wiring failure from a compute shortfall is a report that gets the next
   * three hours spent in the wrong file.
   */
  const beforeStats = t.rows.length;
  state.bus.originate(BUS.engine, { type: 'DEV_LIVE_STATS', deck: 'A' });
  const statsRow = await t.until((r, i) => i >= beforeStats && r.type === 'LIVE_STATS', 8000);
  R.liveStats = statsRow ? (t.liveStatsPayload || null) : null;

  /**
   * THE ADVISORY THE APP ITSELF PUT ON SCREEN. `ui/embed.js` composes it from
   * the engine's own timing report, and on a machine that cannot keep up it is
   * the first thing a user reads. Recording it is how the screenshot and the
   * numbers end up telling the same story.
   */
  R.deckBanner = await evalIn(deckWc, `(() => {
    const b = document.querySelector('.banner, .advisory, #err, .err');
    const all = [...document.querySelectorAll('[class*="banner"], [class*="advis"], [class*="err"]')]
      .map((e) => (e.textContent || '').trim()).filter((x) => x.length > 8);
    return { first: b ? (b.textContent || '').trim() : null, all: all.slice(0, 4) };
  })()`);

  /**
   * WHICH BACKEND THE MODEL ACTUALLY RAN ON, from the browser process rather
   * than from the engine's log line. `wasm` versus `webgpu` is the difference
   * between 0.82x real time per segment and something that might keep up, and
   * on a headless box with no reachable GPU it is the whole explanation.
   */
  R.gpuInfo = await app.getGPUInfo('basic').catch((e) => ({ THREW: String(e && e.message) }));
  /**
   * THE DECK'S OWN SURFACE, read two ways.
   *
   * `data-stem` is the strip's IDENTITY (`ui/embed.js` buildStrips()); the
   * label beside it is what a human reads. Both are recorded, because a rack
   * that painted six strips with the right ids and blank labels is a bug the
   * screenshot would show and a DOM count would not.
   *
   * `__embed` is the unit's own harness hook — the same one
   * `tools/embed-smoke.mjs` reads upstream. It is the DECK saying what IT
   * thinks is happening, which is a different witness from the engine's STATE.
   */
  R.deckPaint = await evalIn(deckWc, `(() => {
    const strips = [...document.querySelectorAll('.strip')];
    const e = globalThis.__embed || null;
    return {
      strips: strips.length,
      stems: strips.map((s) => s.dataset.stem || null),
      names: strips.map((s) => ((s.querySelector('.name') || {}).textContent || '').trim()),
      gains: strips.map((s) => ((s.querySelector('.strip__gain') || {}).textContent || '').trim()),
      peaks: strips.map((s) => ((s.querySelector('.strip__pk') || {}).textContent || '').trim()),
      embed: e ? {
        status: e.status, modelStatus: e.modelStatus, videoPlaying: e.videoPlaying,
        halted: e.halted, jumps: e.jumps, speed: e.speed, key: e.key, bpm: e.bpm,
        source: e.source, logTail: (e.log || []).slice(-8),
      } : null,
      bodyText: document.body ? document.body.innerText.slice(0, 300) : null,
    };
  })()`);

  // =====================================================================
  // 6. THE PICTURES
  // =====================================================================
  phase('shots');
  R.shot.deck = await capture(deckWc, path.join(outDir, '20-deck-live.png'));
  R.shot.source = await capture(srcWc, path.join(outDir, '21-source-live.png'));
  R.shot.chrome = await capture(state.chrome.webContents, path.join(outDir, '22-chrome-live.png'));
  R.shot.window = await grabDisplay(path.join(outDir, '23-window-live.png'));

  // =====================================================================
  // 7. THE RELOAD — the grant is bound to the WebContents, not the document
  // =====================================================================
  /**
   * docs/TESTING.md §7, first of the two paths a local fixture cannot exercise.
   * A full page reload throws the document away; the capture is against the
   * FRAME of a `WebContents` that is still there, so it must survive. The
   * observable is the engine's own frame counter still climbing afterwards.
   */
  phase('reload');
  const framesBefore = t.state() && t.state().capture ? t.state().capture.frames : null;
  const statusBefore = t.state() && t.state().capture ? t.state().capture.status : null;
  srcWc.reload();
  await new Promise((r) => srcWc.once('did-finish-load', r));
  await wait(3000);
  // The reloaded page starts paused; the same gesture starts it again.
  const afterLoad = await evalIn(srcWc, PLAYER);
  if (afterLoad && afterLoad.rect && afterLoad.paused) {
    const x = Math.round(afterLoad.rect.x + afterLoad.rect.w / 2);
    const y = Math.round(afterLoad.rect.y + afterLoad.rect.h / 2);
    srcWc.sendInputEvent({ type: 'mouseMove', x, y });
    await wait(60);
    srcWc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    await wait(40);
    srcWc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  }
  await wait(6000);
  const afterState = t.state();
  R.reload = {
    framesBefore,
    statusBefore,
    statusAfter: afterState && afterState.capture ? afterState.capture.status : null,
    framesAfter: afterState && afterState.capture ? afterState.capture.frames : null,
    climbed: !!(afterState && afterState.capture && framesBefore !== null && afterState.capture.frames > framesBefore),
    player: afterLoad,
    playerAfter: await evalIn(srcWc, PLAYER),
    muted: srcWc.isAudioMuted(),
    navigations: state.source.witness.navigations,
    unmutedNavigations: state.source.witness.unmutedNavigations,
  };

  // =====================================================================
  // 7b. THE SEPARATOR, WITHOUT THE CLOCK
  // =====================================================================
  /**
   * THE LIVE DECK IS STOPPED FIRST, on purpose. It is dropping every chunk on
   * this machine and it holds four wasm threads while it does it; measuring the
   * separator next to it would measure the contention. `CAPTURE_STOP` is the
   * product's own path — the same message `disarm()` sends — and the claim for
   * the offline capture is minted the same way the arm path mints one.
   */
  phase('offline');
  /**
   * THE SEGMENT MUST BE THE CONTENT. The reload above can bring a pre-roll with
   * it, and a segment of somebody's advertisement separated into six stems is a
   * true measurement of the wrong thing — which is the one failure §7 names by
   * example.
   */
  R.adBeforeOffline = await settleToContent('before the offline segment');
  /**
   * AND IT IS SEEKED INTO THE SONG, THROUGH THE PRODUCT'S OWN TRANSPORT.
   *
   * A separator handed 7.8 s of a synth intro returns a near-empty `vocals`
   * plane, and that is a CORRECT answer that makes a poor artefact: the reader
   * cannot tell "this stem is empty because the music is" from "this stem is
   * empty because the separator is broken". So the playhead is moved into the
   * body of the track first, and the seek uses `DeckTransport.drive` —
   * `src/main/transport.js`, whose closed write set is exactly
   * `{muted, playbackRate, currentTime}` and whose `currentTime` goes out as
   * `seekTo`. It is the deck's own verb on the deck's own wire; nothing here
   * touches the element directly, and the position it lands on is recorded.
   */
  if (state.transport) state.transport.drive({ currentTime: OFFLINE_SEEK_SEC });
  await wait(2500);
  R.offlineSeek = { asked: OFFLINE_SEEK_SEC, player: await evalIn(srcWc, PLAYER) };
  state.engineMessages.captureStop();
  await t.stateUntil((st2) => st2.capture && st2.capture.status !== 'recording', 20_000);
  await wait(1500);
  const offlineToken = state.claims.mint({ sourceWcId: srcWc.id, deck: 'offline-probe' });
  R.offline = await evalIn(engineWc, DRIVE_OFFLINE(offlineToken));
  R.offlinePlayer = await evalIn(srcWc, PLAYER);

  // =====================================================================
  // 8. THE LEDGER
  // =====================================================================
  phase('ledger');
  R.engineLog = t.state() ? t.state().log : null;
  R.busStats = JSON.parse(JSON.stringify(state.bus.stats));
  R.busAddresses = state.bus.addresses();
  R.captureStats = JSON.parse(JSON.stringify(state.capture.stats));
  R.claimStats = JSON.parse(JSON.stringify(state.claims.stats));
  R.originatedCounts = { ...state.engineMessages.counts };
  R.transportStats = JSON.parse(JSON.stringify(state.transport.stats));
  R.deckHostStats = JSON.parse(JSON.stringify(state.deckHost.stats));
  /**
   * L1's THIRD INSTRUMENT — every URL the SOURCE session asked for while this
   * probe drove it. A preload that resolved a media URL would show up here as a
   * request nobody else could have caused. It is recorded rather than judged:
   * the suite decides, and youtube.com legitimately asks for hundreds of things.
   */
  const reqs = state.transport.requests();
  R.sourceRequests = { count: reqs.length, hosts: [...new Set(reqs.map((r) => { try { return new URL(r.url).host; } catch { return String(r.url).slice(0, 40); } }))].sort() };
  R.trace = t.rows.filter((r) => r.type !== 'METERS' && r.type !== 'STATE').slice(-120);
  R.meterCount = t.meters.length;

  fs.writeFileSync(path.join(outDir, 'meters.json'), `${JSON.stringify(t.meters, null, 0)}\n`);
  fs.writeFileSync(path.join(outDir, 'engine.log'), `${(R.engineLog || []).join('\n')}\n`);
  fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(R, null, 2)}\n`);
  console.log(`[gate] wrote ${path.join(outDir, 'report.json')}`);
  return 0;
}
