/**
 * The gate's eyes on the ENGINE half of the Host seam, inside a real launch.
 *
 * `src/main/main.js --gate=DIR --gate-probe=engine-host` imports this file —
 * DYNAMICALLY, and only when those flags are present — hands it the live
 * handles, and exits with what it returns. `tools/suites/engine-host.mjs` spawns
 * that launch and asserts over `DIR/report.json`.
 *
 * WHY A SECOND PROBE RATHER THAN MORE OF `probe.mjs`. One probe per QUESTION.
 * `probe.mjs` asks "is the app skeleton the shape it says it is" and answers in
 * ~2 s without ever loading the unit; this one arms a real capture and builds a
 * 109 MB ONNX session, which takes as long as it takes. A single probe that did
 * both would have failures nobody could tell apart and a cost every run pays.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it never asserts. A probe that decided its
 * own verdict would be a suite that exits 0 having asserted nothing — the VOID
 * case, one level in. Every number below is READ OUT of the running app and
 * judged in a separate process.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DRIVEN, AND THROUGH WHAT
 * ---------------------------------------------------------------------------
 * The nine `EngineHost` duties are reached two ways, and both are the SHIPPING
 * module `vendor/…/offscreen/host.js` — never a copy and never a stub:
 *
 *   THROUGH THE UNIT — `send`, `onMessage`, `createBackend`, `captureStream`,
 *     `modelBytes`, `modelCached` and `assetUrl` are all exercised by the
 *     vendored `offscreen/engine.js` answering real messages. This is the half
 *     that matters: a duty that works when called directly and not when the
 *     engine calls it is a duty that does not work.
 *   DIRECTLY — the same module is `import()`ed in the engine renderer (the module
 *     registry hands back the SAME instance the engine holds) so that
 *     `assetUrl`'s trailing slash, its DETACHED call, `modelBytes`'s whole-buffer
 *     rule and `clearModel`'s honesty can be read as values rather than inferred
 *     from a green.
 *
 * And `main`'s own half: the three messages it ORIGINATES (`CAPTURE_START`,
 * `CAPTURE_STOP`, `DECK_PREPARE`), which `assertHost` structurally cannot check
 * because it cannot check for a message nobody sent.
 */
import fs from 'node:fs';
import path from 'node:path';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** `executeJavaScript` in the main world, with the throw kept as data. */
async function evalIn(wc, code) {
  try { return await wc.executeJavaScript(code); }
  catch (err) { return { THREW: String((err && err.message) || err) }; }
}

/**
 * ONE STATE SNAPSHOT IS ~200 LOG LINES AND EVERY DECK'S WHOLE RECORD, and the
 * engine pushes one on every change. Keeping them all would put megabytes of
 * duplicated JSON in the report and bury the six messages that matter, so the
 * trace keeps the SHAPE of everything and the VALUE of the last `STATE` only.
 *
 * `sourceToken` is redacted to its length. It is a live capability for ten
 * seconds and a report file is not the place for one; the length is enough to
 * say a token was minted and put on the wire.
 */
function trace() {
  const rows = [];
  let lastState = null;
  /**
   * THE FIRST ANSWER TO "IS THE MODEL HERE", CAUGHT AT THE TRANSITION.
   *
   * `engine.js`'s `case 'STATUS'` is the only thing that moves `model.status`
   * off `'unknown'`, and it does so with the value `host.modelCached()` gave it
   * — but the deck's own boot poll can start a load a moment later, and by then
   * the field reads `'loading'` and then `'ready'`. Reading the LAST snapshot
   * would be reading a different question's answer. This latches the first one.
   */
  let firstResolvedModel = null;
  const record = (msg, verdict) => {
    if (!msg || typeof msg !== 'object') { rows.push({ verdict, malformed: true }); return; }
    if (msg.type === 'STATE') {
      lastState = msg.state;
      const st = msg.state && msg.state.model && msg.state.model.status;
      if (firstResolvedModel === null && st && st !== 'unknown') firstResolvedModel = st;
    }
    rows.push({
      verdict,
      to: msg.to,
      from: msg.from,
      type: msg.type,
      keys: Object.keys(msg).sort(),
      deck: msg.deck === undefined ? null : msg.deck,
      sourceKeys: msg.source && typeof msg.source === 'object' ? Object.keys(msg.source).sort() : null,
      tokenLength: typeof msg.sourceToken === 'string' ? msg.sourceToken.length : null,
      // The handful of small replies whose payload IS the evidence.
      payload: msg.type === 'DECK_PREPARED'
        ? { ok: msg.ok, ms: msg.ms, ep: msg.ep, message: msg.message }
        : undefined,
      at: Date.now(),
    });
  };
  return {
    record,
    rows,
    state: () => lastState,
    firstResolvedModel: () => firstResolvedModel,
    /** Wait for the first message satisfying `pred`, or resolve null. */
    async until(pred, ms, poll = 50) {
      const deadline = Date.now() + ms;
      for (;;) {
        const hit = rows.find(pred);   // `pred(row, index)` — Array#find passes both
        if (hit) return hit;
        if (Date.now() > deadline) return null;
        await wait(poll);
      }
    },
    /** Wait until the last STATE satisfies `pred`, or resolve null. */
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
 * DRIVE THE SHIPPING HOLE MODULE DIRECTLY, in the engine renderer.
 *
 * `import()` from the engine document resolves the same specifier the engine
 * itself used, so the module registry returns THE SAME INSTANCE — this is the
 * shipped module answering, not a second copy with the same source.
 *
 * `assetUrl` is called DETACHED (`const f = host.assetUrl; f(...)`) because
 * `shared/host.js` says a duty may be called unbound and `engine.js` really does
 * that: it hands `host.assetUrl` itself to `MasterBus` and to every deck. A duty
 * implemented as a method that needs its `this` passes `assertHost`, works
 * through the namespace, and fails only at the first worklet load.
 */
const DRIVE_HOST = `(async () => {
  const out = {};
  try {
    const host = await import('./vendor/stem-splitter-live/extension/offscreen/host.js');
    out.duties = Object.keys(host).filter((k) => typeof host[k] === 'function').sort();

    const f = host.assetUrl;                       // DETACHED, on purpose
    out.assetUrl = {
      worklet: f('offscreen/capture-processor.js'),
      ortDir: f('vendor/ort/'),
      ortFile: f('vendor/ort/ort.all.bundle.min.mjs'),
      origin: location.origin,
    };
    // Obligation 2: the result must be FETCHABLE, with a readable .ok — this is
    // the probe workerbackend.js makes before it blames a missing file.
    const head = await fetch(f('vendor/ort/ort.all.bundle.min.mjs'), { method: 'HEAD' });
    out.assetUrl.headOk = head.ok;
    out.assetUrl.headStatus = head.status;
    try { f('/etc/passwd'); out.assetUrl.escapeRefused = false; }
    catch (e) { out.assetUrl.escapeRefused = true; out.assetUrl.escapeWhy = String(e.message).slice(0, 80); }

    out.modelCached = await host.modelCached();

    const phases = [];
    const t0 = performance.now();
    const got = await host.modelBytes((phase, n, total) => phases.push([phase, n, total]));
    out.modelBytes = {
      ms: Math.round(performance.now() - t0),
      length: got.bytes.length,
      byteOffset: got.bytes.byteOffset,
      byteLength: got.bytes.byteLength,
      bufferByteLength: got.bytes.buffer.byteLength,
      wholeBuffer: got.bytes.byteOffset === 0 && got.bytes.byteLength === got.bytes.buffer.byteLength,
      fromCache: got.fromCache,
      firstPhase: phases.length ? phases[0][0] : null,
      firstBytes: phases.length ? phases[0][1] : null,
      phases: phases.length,
      onePhase: phases.length > 1 && phases.every((p) => p[0] === phases[0][0]),
      lastCount: phases.length ? phases[phases.length - 1][1] : null,
    };

    // A SECOND CALL MUST HAND OVER A SECOND BUFFER. The unit TRANSFERS
    // bytes.buffer into the inference worker, so a memoising Host would hand the
    // second deck a 0-byte array. Compared by identity, and the first is dropped
    // straight after.
    const again = await host.modelBytes();
    out.modelBytes.freshBufferPerCall = again.bytes.buffer !== got.bytes.buffer
      && again.bytes.length === got.bytes.length;

    out.clearModel = await host.clearModel().then(() => 'resolved', (e) => 'REJECTED ' + e.message);
    out.modelCachedAfterClear = await host.modelCached();

  } catch (e) { out.THREW = String((e && e.message) || e); }
  return out;
})()`;

/**
 * THE SHIPPING `captureStream`, DRIVEN, so the settings can be read as numbers.
 *
 * IT ASKS THE HOLE MODULE AND NOT THE PLATFORM, and the difference is the whole
 * value of this step. An earlier draft called `getDisplayMedia` here with a COPY
 * of the Host's constraints — which measured the probe's own object: breaking
 * the constraints inside `host.js` left this green, and the mutation battery
 * caught it (case 8). What runs now is the Host's own function, including its
 * refusal, so a Host that asked for `{audio: true}` fails here the way it would
 * fail a user.
 *
 * OWNERSHIP: the engine never sees this stream, so the probe stops it. That is
 * the one place in this file that is allowed to — everywhere else the tracks
 * belong to the engine (R5).
 */
const DRIVE_CAPTURE = (token) => `(async () => {
  const host = await import('./vendor/stem-splitter-live/extension/offscreen/host.js');
  try {
    const s = await host.captureStream(${JSON.stringify(token)});
    const a = s.getAudioTracks();
    const out = { ok: true, audioTracks: a.length, videoTracks: s.getVideoTracks().length,
                  settings: a[0] ? a[0].getSettings() : null };
    // THE LEVEL, off this very stream. The engine's frame counter cannot tell
    // audio from silence (measured), so the one moment the probe owns a stream
    // is the moment to listen to it. Its own AudioContext, at the platform
    // default, because nothing here is being fed to the model.
    const ctx = new AudioContext();
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    // A ZERO-GAIN PATH TO destination, because Chromium only PULLS nodes that
    // have one — an analyser hanging off a source with nothing downstream reads
    // 0.0000 for ever, whatever the stream carries. offscreen/deck.js keeps a
    // silent sink for exactly this reason and it cost this probe one run to
    // rediscover. (No backticks in this block: it is inside a template literal.)
    const sink = new GainNode(ctx, { gain: 0 });
    ctx.createMediaStreamSource(s).connect(an);
    an.connect(sink).connect(ctx.destination);
    const buf = new Float32Array(an.fftSize);
    let peak = 0, samples = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 400) {
      an.getFloatTimeDomainData(buf);
      for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > peak) peak = v; }
      samples += buf.length;
      await new Promise((r) => setTimeout(r, 20));
    }
    out.peak = peak;
    out.levelMs = Math.round(performance.now() - t0);
    out.levelSamples = samples;
    // Everything a peak of 0.0000 could mean, so the red says WHICH.
    out.diag = {
      ctxState: ctx.state, ctxSampleRate: ctx.sampleRate,
      trackReadyState: a[0] ? a[0].readyState : null,
      trackMuted: a[0] ? a[0].muted : null,
      trackEnabled: a[0] ? a[0].enabled : null,
    };
    await ctx.close().catch(() => {});
    for (const t of s.getTracks()) t.stop();
    return out;
  } catch (e) { return { ok: false, name: e.name, message: String(e.message || e) }; }
})()`;

export async function runGate({ state, outDir, sourceUrl }) {
  fs.mkdirSync(outDir, { recursive: true });
  const engineWc = state.engineWin.webContents;
  const srcWc = state.source.webContents;
  const BUS = state.bus.BUS;

  const R = {
    gate: 1,
    probe: 'engine-host',
    when: new Date().toISOString(),
    versions: process.versions,
    platform: process.platform,
    sourceUrl,
  };

  const t = trace();
  state.bus.tap(t.record);

  // ------------------------------------------------------------ 1. it booted
  /**
   * `HELLO` IS THE PROOF THAT `assertHost` ACCEPTED THIS HOST, and from outside
   * the renderer it is the only proof there is: `engine.js` runs
   * `assertHost(host, ENGINE_HOST_DUTIES, 'EngineHost')` at module scope, line 96,
   * and sends `HELLO` on its LAST line, 1712. A Host short a duty — or one that
   * threw anywhere on the way past — produces no HELLO at all, and nothing in
   * the unit exports a flag saying "I booted". The message IS the flag.
   *
   * THE ENGINE IS RELOADED TO SEE IT, and that is the whole reason this step
   * exists rather than reading a stale boolean: `boot()` loaded the page long
   * before this probe was imported, so the first HELLO went past with nobody
   * listening. A reload is a REAL second boot — a fresh module evaluation, a
   * fresh `assertHost`, a fresh `WorkerBackend` — over the same Host, and it is
   * observed rather than assumed. `webContents.reload()` keeps the same
   * `WebContents`, so the bus registration made in `boot()` still stands.
   */
  const helloBefore = t.rows.length;
  engineWc.reload();
  const hello = await t.until((r, i) => i >= helloBefore && r.type === 'HELLO' && r.from === BUS.engine, 30000);
  R.hello = { seen: !!hello, to: hello ? hello.to : null, from: hello ? hello.from : null, keys: hello ? hello.keys : null };
  // The reloaded engine rebuilds deck A's backend at module scope; let its ORT
  // probe and worker settle before anything is asked of it.
  await wait(500);

  // ------------------------------------------------ 2. the duties, directly
  R.host = await evalIn(engineWc, DRIVE_HOST);

  // -------------------------------------------- 3. the duties, THROUGH the unit
  /**
   * `STATUS` is what the deck sends at module scope, and answering it makes the
   * engine touch four duties at once: `modelCached()` (awaited FIRST, before
   * `ensureBackend`), `createBackend` through `decks.A.ensureBackend()`,
   * `assetUrl` through the backend's ORT probe, and `send` on the way back out.
   */
  const beforeStatus = t.rows.length;
  const statusSent = state.bus.originate(BUS.engine, { type: 'STATUS' });
  const reply = await t.until((r, i) => i >= beforeStatus && r.type === 'STATE' && r.to === BUS.deck, 15000);
  /**
   * `model.status` LEAVING `'unknown'` IS THE `STATUS` CASE'S OWN FINGERPRINT,
   * and it is what is waited for rather than "a STATE arrived": the reloaded
   * engine pushes STATE on its own when the backend reports ready, so a wait for
   * any snapshot at all would be satisfied by a push this Host did not cause.
   * Only `case 'STATUS'` awaits `host.modelCached()` and writes the answer.
   */
  const firstState = await t.stateUntil((s) => s && s.model && s.model.status !== 'unknown', 15000);
  const seen = firstState || t.state();
  R.status = {
    sent: statusSent,
    answered: !!reply,
    // The answer `modelCached()` gave, latched at the transition — see `trace()`.
    modelStatusAtAnswer: t.firstResolvedModel(),
    boot: seen ? seen.boot : null,
    model: seen ? { status: seen.model.status, fromCache: seen.model.fromCache } : null,
  };

  /**
   * `onReady({threads, adapter})` — the count that says threaded wasm really got
   * SHARED memory. `boot.threads` is where the deck mirrors it, and it arrives
   * outside any call the unit made, so it is also the proof that
   * `createBackend`'s hooks were FORWARDED WHOLE rather than dropped: a Host
   * that built the backend with `new WorkerBackend({ assetUrl })` leaves this
   * null for ever and nothing else goes red.
   */
  const withThreads = await t.stateUntil((s) => s.boot && (s.boot.threads !== null || s.boot.ep !== null), 30000);
  R.backend = withThreads ? { ...withThreads.boot } : null;

  // ------------------------------------- 4. DECK_PREPARE, and the whole model
  /**
   * The heaviest thing this Host does, end to end, in one message: the engine
   * asks `host.modelBytes()`, the UNIT verifies the SHA-256 and the byte count
   * over whatever arrived, transfers the buffer into the inference worker, and
   * ORT builds a session. `DECK_PREPARED {ok, ms, ep}` comes back on the bus.
   *
   * A green here is the strongest statement available about `modelBytes`: the
   * bytes this Host handed over ARE the model, they owned their whole buffer
   * (`requireWholeBuffer` would have thrown), and they survived a transfer.
   */
  const prepareSent = state.engineMessages.deckPrepare();
  /**
   * 180 s, AND THE NUMBER HAS A REASON. Observed on this box: 8.0 s to 11.9 s,
   * almost all of it ORT compiling and warming the graph on wasm — so this is
   * ~15x the slowest run seen, which is headroom for a loaded machine and not an
   * invitation to hang. It was 600 s for one battery and that was the wrong
   * shape: a ceiling is paid in full by every mutation that stops the engine
   * booting, and four of them do, so the battery spent forty minutes waiting for
   * a message it already knew would not come.
   */
  const prepared = await t.until((r) => r.type === 'DECK_PREPARED', 180000);
  R.deckPrepare = {
    sent: prepareSent,
    reply: prepared ? prepared.payload : null,
    model: t.state() ? { ...t.state().model, error: t.state().model.error } : null,
  };

  // -------------------------------------------------- 4b. sourceBytes, directly
  /**
   * THE FILE-BYTES DUTY, DRIVEN OVER THE REAL `/file/` ROOT AND THE REAL TOKEN
   * REGISTRY — the same module the engine holds, asked for the bytes a token
   * names.
   *
   * THE SUITE OWNS THE BYTES, like the shell probe's `/file/` half: it writes
   * the WAV fixture and the zero-byte file BEFORE this app is launched and names
   * them in `WB_ENGINEHOST_FILE_FIXTURE` / `WB_ENGINEHOST_FILE_EMPTY`, so the
   * hashes this file reports back are compared against bytes a SEPARATE PROCESS
   * wrote and hashed. A probe that both wrote the file and checked what came
   * back would be one instrument agreeing with itself.
   *
   * THE HANDLES ARE MINTED OVER `state.pathTokens` — the app's own registry,
   * the same object `src/main/files.js`'s intake mints from when a user picks a
   * file. What is under test is the DUTY — `host.sourceBytes()` — and it sees a
   * token it cannot tell from the intake's, spent by the ROOT it shares with
   * every renderer.
   *
   * WHY DIRECTLY AND NOT THROUGH THE UNIT: the vendored engine has no caller
   * for this duty outside the unit's own duty-refusal probes (the `sourceBytes`
   * caller and `ENGINE_HOST_DUTIES`'s declaration of it arrived together at the
   * v0.3.0 pin; the v0.3.1 pin we are at carries both). The direct drive is the
   * shipping module answering, over the shipping wire — the same shape the
   * other direct drives take.
   *
   * THE FOUR CALLS, AND WHAT EACH IS FOR: `first` and `second` use the SAME
   * handle back to back — one handle buys one response, so the second must
   * REJECT. `forged` is a token nobody minted: the refusal path, which must be
   * a rejection and not a resolution with anything. `empty` is a REAL token
   * naming a REAL zero-byte file: the ROOT serves it happily, so the duty's
   * own zero-byte refusal is the only thing that can answer it, and the suite
   * asserts it does.
   */
  const fileFixture = process.env.WB_ENGINEHOST_FILE_FIXTURE || '';
  const fileEmpty = process.env.WB_ENGINEHOST_FILE_EMPTY || '';
  R.sourceBytes = { fixture: fileFixture, empty: fileEmpty };
  if (!fileFixture || !fileEmpty) {
    R.sourceBytes.why = 'WB_ENGINEHOST_FILE_FIXTURE or WB_ENGINEHOST_FILE_EMPTY was not set — '
      + 'the suite did not write the fixtures to fetch';
  } else {
    const good = state.pathTokens.mint(fileFixture);
    const empty = state.pathTokens.mint(fileEmpty);
    R.sourceBytes.minted = {
      good: typeof good === 'string' && good.length > 0,
      empty: typeof empty === 'string' && empty.length > 0,
    };
    R.sourceBytes.drive = await evalIn(engineWc, `(async () => {
      const host = await import('./vendor/stem-splitter-live/extension/offscreen/host.js');
      const hex = (b) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
      const probe = async (token) => {
        try {
          const ab = await host.sourceBytes(token);
          const r = { rejected: false, isArrayBuffer: ab instanceof ArrayBuffer, byteLength: ab.byteLength };
          if (r.isArrayBuffer && r.byteLength > 0) r.sha256 = await crypto.subtle.digest('SHA-256', ab).then(hex);
          return r;
        } catch (e) { return { rejected: true, message: String((e && e.message) || e) }; }
      };
      return {
        first: await probe(${JSON.stringify(good)}),
        second: await probe(${JSON.stringify(good)}),
        forged: await probe('a-token-nobody-minted'),
        empty: await probe(${JSON.stringify(empty)}),
      };
    })()`);
  }

  // ------------------------------------------------------------ 5. the claim
  /**
   * A TOKEN NOBODY MINTED BUYS NOTHING. Driven through the shipping
   * `captureStream`, so what is being asserted is the Host's own refusal path —
   * and it must REJECT rather than resolve null, because every caller is
   * `.catch`-wrapped and a null travels on as a capture with no track.
   */
  R.forgedToken = await evalIn(engineWc, `(async () => {
    const host = await import('./vendor/stem-splitter-live/extension/offscreen/host.js');
    try { const s = await host.captureStream('a-token-nobody-minted');
          return { rejected: false, resolvedWith: s === null ? 'null' : 'a MediaStream' }; }
    catch (e) { return { rejected: true, message: String(e.message || e) }; }
  })()`);

  /**
   * The five settings, as NUMBERS, over a claim minted the way the arm path
   * mints one. `spike-capture-mute.md` Limitation 6 is why this reads every
   * field rather than checking that a track exists: a mono, 48 kHz,
   * AGC-crushed capture reads 10.8x over a naive floor and is a dead product.
   */
  /**
   * THE SOURCE HAS TO BE PLAYING, and it is not by default.
   *
   * `tools/fixture/player.html` loads paused and exposes `__wbFixture.play()`;
   * nothing about the Host makes it start. This cost one run and it is worth the
   * paragraph: the capture opened, the engine counted 73,728 frames, and every
   * one of them was silence — which is precisely why the level below is asserted
   * off the stream and the frame count is not allowed to stand in for it.
   */
  R.sourcePlay = await evalIn(srcWc, `(async () => {
    if (!window.__wbFixture || !window.__wbFixture.play) return 'no fixture on this source';
    const said = await window.__wbFixture.play();
    for (let i = 0; i < 50 && window.__wbFixture().paused; i++) await new Promise((r) => setTimeout(r, 100));
    return said;
  })()`);

  const settingsToken = state.claims.mint({ sourceWcId: srcWc.id, deck: 'probe' });
  // What the SOURCE was doing while the level was measured — a silent capture of
  // a paused player is a fixture problem, not a Host one, and the two must not
  // be confused in a red.
  R.fixtureBefore = await evalIn(srcWc, 'window.__wbFixture ? window.__wbFixture() : null');
  R.gdm = await evalIn(engineWc, DRIVE_CAPTURE(settingsToken));
  R.fixtureAfter = await evalIn(srcWc, 'window.__wbFixture ? window.__wbFixture() : null');

  // --------------------------------------------------- 6. CAPTURE_START, real
  /**
   * THE REAL ARM PATH, minus the button: `main` mints, `main` originates, the
   * unit carries the token to `host.captureStream`, the Host spends the claim,
   * `setDisplayMediaRequestHandler` consumes it and answers with the SOURCE
   * view's frame. Nothing here reimplements a step of that.
   */
  const started = state.engineMessages.captureStart();
  R.captureStart = { ...started, token: undefined, tokenLength: started.ok ? started.token.length : null };
  const recording = await t.stateUntil((s) => s.capture && s.capture.status === 'recording', 20000);
  R.recording = recording ? { ...recording.capture } : null;

  // Let some audio actually arrive: the fixture plays a 440 Hz stereo sine and
  // FRAMES is the count that says the ring is being fed. A stopwatch would not
  // carry this claim; a frame count does.
  const fed = await t.stateUntil((s) => s.capture && s.capture.frames > 0, 15000);
  await wait(1500);
  const nowState = t.state();
  R.captured = nowState ? { ...nowState.capture, frames: nowState.capture.frames } : null;
  R.fedWithin15s = !!fed;
  R.captureStats = JSON.parse(JSON.stringify(state.capture.stats));
  R.claimStats = JSON.parse(JSON.stringify(state.claims.stats));
  R.sourceFrame = { processId: srcWc.mainFrame.processId, routingId: srcWc.mainFrame.routingId };

  // ------------------------------------------------------- 7. CAPTURE_STOP
  /**
   * A LIVE CLAIM FOR THE STOP TO TAKE WITH IT, minted and deliberately never
   * spent.
   *
   * Without one, "CAPTURE_STOP revokes every live claim" is green over an EMPTY
   * registry — every token minted so far has already been consumed by a grant,
   * so `live === 0` holds whether or not `revokeAll` was ever called. That is an
   * estimator that saturates before the claim range begins, which `AGENTS.md`
   * bans by name, and the mutation battery caught it: deleting
   * `claims.revokeAll('CAPTURE_STOP')` turned NOTHING red.
   */
  const orphan = state.claims.mint({ sourceWcId: srcWc.id, deck: 'never-spent' });
  R.claimsBeforeStop = state.claims.inspect();
  const stopped = state.engineMessages.captureStop();
  /**
   * THE ORPHAN, BY NAME, rather than by a count of the registry. The deck's own
   * arm path mints claims too, so "how many are live" is a number this probe
   * does not control and cannot assert on without flaking. Trying to spend the
   * one token this probe minted is deterministic: after a revocation it is not
   * merely gone from a count, it is refused by name.
   */
  R.orphanAfterStop = state.claims.spend(orphan);
  const idle = await t.stateUntil((s) => s.capture && s.capture.status !== 'recording', 15000);
  R.captureStop = { sent: stopped, status: idle ? idle.capture.status : null };
  R.claimsAfterStop = state.claims.inspect();

  // ---------------------------------------------------------- 8. onTeardown
  /**
   * `pagehide` IS THE TEARDOWN SIGNAL AND IT IS THE HOST'S CHOICE, so it is
   * proven rather than described: arm again, dispatch the event the Host
   * registered on, and read the engine's own log for the track ending. R5 — a
   * capture that outlives its context is a live capture indicator over silence
   * that nothing can reach any more.
   *
   * Dispatched rather than caused by closing the window, because closing it
   * would take the probe's own eyes with it.
   */
  const again = state.engineMessages.captureStart();
  const rearmed = await t.stateUntil((s) => s.capture && s.capture.status === 'recording', 20000);
  await t.stateUntil((s) => s.capture && s.capture.frames > 0, 15000);
  R.rearm = { ok: again.ok, recording: !!rearmed };

  // The AudioContext exists only once something has been captured — the engine
  // creates it in `ensureContext()`, not at boot — so `boot.sampleRate` is
  // readable only from here on. 44100 is the whole no-resampling design
  // (docs/AUDIO.md §1.2); a default context opens at 48000.
  R.bootAfterCapture = t.state() ? { ...t.state().boot } : null;

  const framesBefore = t.state() ? t.state().capture.frames : null;
  /**
   * TWO CLAIMS, AND ONLY THE FIRST IS THIS HOST'S.
   *
   *   `hostRegistered` — the shipping `onTeardown` really registers ITS CALLER'S
   *     OWN FUNCTION on `pagehide`, and it runs SYNCHRONOUSLY during dispatch.
   *     The flag is read on the line after `dispatchEvent` returns, so a wrapper
   *     that deferred or awaited would read `false` — which is the failure the
   *     duty is written against: teardown does not await, so whatever is not
   *     done before it returns is not done at all.
   *   `framesFrozen` — the ENGINE's own teardown stopped the capture tracks
   *     (R5). That half is the unit's code, gated by the unit's own suite; it is
   *     REPORTED here because it is the thing the user would notice, and because
   *     a frame count that keeps climbing after teardown is worth seeing.
   *
   * `track.stop()` deliberately does NOT fire `ended`, so a listener on the
   * track would be an instrument that can never read anything — the frame
   * counter is the observable that exists.
   */
  R.teardownDrive = await evalIn(engineWc, `(async () => {
    const host = await import('./vendor/stem-splitter-live/extension/offscreen/host.js');
    let fired = false, at = null;
    host.onTeardown(() => { fired = true; at = 'sync-or-later'; });
    window.dispatchEvent(new Event('pagehide'));
    return { firedSynchronously: fired, at };
  })()`);
  await wait(2500);
  const after = t.state();
  R.teardown = {
    framesBefore,
    framesAfter: after ? after.capture.frames : null,
    framesFrozen: after != null && framesBefore != null && after.capture.frames === framesBefore,
    logTail: after ? after.log.slice(-14) : null,
  };

  // ----------------------------------------------------------- 9. the trace
  R.originated = JSON.parse(JSON.stringify(state.engineMessages.sent));
  R.originatedCounts = { ...state.engineMessages.counts };
  R.busStats = JSON.parse(JSON.stringify(state.bus.stats));
  R.busAddresses = state.bus.addresses();
  R.trace = t.rows.map(({ payload, ...r }) => (payload ? { ...r, payload } : r));
  R.engineLog = t.state() ? t.state().log : null;

  fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(R, null, 2)}\n`);
  console.log(`[gate] wrote ${path.join(outDir, 'report.json')}`);
  return 0;
}
