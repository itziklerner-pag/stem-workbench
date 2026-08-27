/**
 * THE DECK HOST'S EYES INSIDE A REAL LAUNCH.
 *
 * `src/main/main.js --gate=DIR --gate-probe=deck-host` imports this file —
 * dynamically, and only when those flags are present — hands it the live
 * handles, and exits with what it returns. `tools/suites/deck-host.mjs` spawns
 * that launch and asserts over `DIR/report.json`.
 *
 * ---------------------------------------------------------------------------
 * IT DRIVES THE SHIPPED HOLE MODULE, NOT A COPY OF IT
 * ---------------------------------------------------------------------------
 * The one thing this probe does that the others do not: it reaches into the
 * DECK RENDERER and pulls out the very `host` object `ui/embed.js` imported —
 *
 *     import('./host.js').then((m) => { window.__wbHost = m.host; })
 *
 * — which is the module instance already in that page's graph, because ES
 * modules are cached per URL. Every duty exercised below is therefore the
 * shipped `vendor/…/extension/ui/host.js`, in the real renderer, over the real
 * preload, against the real main process. Nothing here reimplements a duty; a
 * check that reimplemented the module it is guarding would be a second copy of
 * the bug.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it never asserts. A probe that decided its
 * own verdict would be a suite that exits 0 having asserted nothing — the VOID
 * case, one level in. Everything below is recorded, including every throw, and
 * the judgement is in the suite, which is a separate process that can be run
 * against a report from a mutated build and watched going red.
 */
import fs from 'node:fs';
import path from 'node:path';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** `executeJavaScript` in the main world, with the throw kept AS DATA. */
async function evalIn(wc, code) {
  try { return await wc.executeJavaScript(code, true); }
  catch (err) { return { THREW: String((err && err.message) || err) }; }
}

/**
 * Poll until `code` is truthy, or give up and say so. Used instead of a flat
 * sleep wherever the thing being waited for has an observable: a stopwatch that
 * happened to be long enough is a gate that goes red on a slower machine.
 */
async function until(wc, code, ms = 8000, step = 100) {
  const t0 = Date.now();
  for (;;) {
    const got = await evalIn(wc, code);
    if (got && got.THREW === undefined && got !== false) return { ok: true, waitedMs: Date.now() - t0, got };
    if (Date.now() - t0 > ms) return { ok: false, waitedMs: Date.now() - t0, got };
    await wait(step);
  }
}

/** How many distinct pixels a view drew. A blank page and a painted one are both a PNG. */
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

async function capture(view, file) {
  try {
    const image = await view.webContents.capturePage();
    if (image.isEmpty()) return { ok: false, why: 'capturePage returned an empty image' };
    fs.writeFileSync(file, image.toPNG());
    return { ok: true, file: path.basename(file), bytes: fs.statSync(file).size, ...paintedColours(image) };
  } catch (err) {
    return { ok: false, why: String((err && err.message) || err) };
  }
}

export async function runGate({ state, outDir, sourceUrl, appRoot }) {
  const R = { gate: 1, probe: 'deck-host', sourceUrl, versions: { ...process.versions } };
  const deckWc = state.deck.webContents;
  const host = state.deckHost;

  // =======================================================================
  // 1. DID THE DECK BOOT UNDER THIS HOST AT ALL
  // =======================================================================
  /**
   * `window.__embed` is the LAST thing `ui/embed.js` defines. Waiting for it is
   * waiting for the whole module to have run — which means `assertHost(host,
   * DECK_HOST_DUTIES)`, `assertHost(host.page, DECK_PAGE_DUTIES)` and
   * `assertHostOption(host, 'transport', …)` all passed, because every one of
   * them throws at module scope. A Host short one duty produces no `__embed`
   * and this wait times out with the console line in the launch log.
   */
  const booted = await until(deckWc, 'typeof window.__embed === "object" && window.__embed !== null');
  R.boot = {
    booted: booted.ok,
    waitedMs: booted.waitedMs,
    url: deckWc.getURL(),
    bridge: await evalIn(deckWc, 'typeof window.__wbDeck'),
    hostedFlag: await evalIn(deckWc, 'window.__wbDeck && window.__wbDeck.hosted'),
    /**
     * THE PROFILE'S SECOND FIELD, read off the bridge the preload really built.
     * `sendSyncs` counts how many synchronous round trips the preload made at
     * boot: the profile must cost exactly ONE, because a second `sendSync`
     * before the deck has drawn anything is a second thing that can hang.
     */
    sourceKindFlag: await evalIn(deckWc, 'window.__wbDeck && window.__wbDeck.sourceKind'),
  };

  // The shipped module instance, out of the page's own graph.
  R.boot.grabbed = await evalIn(deckWc,
    "import('./host.js').then((m) => { window.__wbHost = m.host; return typeof m.host; })");
  R.boot.duties = await evalIn(deckWc,
    'window.__wbHost ? Object.keys(window.__wbHost).sort() : null');
  // What the SHIPPED hole module made of the bridge's answer, which is not the
  // same question as what the bridge carried: the module refuses a kind outside
  // its closed set rather than passing it through.
  R.boot.sourceKind = await evalIn(deckWc,
    'window.__wbHost ? window.__wbHost.sourceKind : null');
  R.boot.shapes = await evalIn(deckWc, `(() => {
    const h = window.__wbHost;
    if (!h) return null;
    const t = (v) => (v === null ? 'null' : typeof v);
    return {
      send: t(h.send), onMessage: t(h.onMessage), storageGet: t(h.storageGet),
      storageSet: t(h.storageSet), onStorageChanged: t(h.onStorageChanged),
      armShortcut: t(h.armShortcut),
      transportKey: 'transport' in h, transport: t(h.transport),
      transportMembers: h.transport ? Object.keys(h.transport).sort() : null,
      pageMembers: h.page ? Object.keys(h.page).sort() : null,
      // NO DUTY MAY NEED ITS \`this\`: the seam calls them unbound.
      anyMethodNeedsThis: [h.send, h.onMessage, h.storageGet, h.storageSet, h.onStorageChanged, h.armShortcut]
        .some((f) => typeof f !== 'function'),
    };
  })()`);

  // =======================================================================
  // 2. STORAGE — the two lifetimes, absent vs unreadable, and the area refusal
  // =======================================================================
  /**
   * THE SAME KEY IS HELD IN BOTH AREAS WITH DIFFERENT VALUES. That is the one
   * arrangement in which "it read the area it was given" and "it always reads
   * local" give different answers — a Host that took the area and then ignored
   * it is invisible to any check that uses one area.
   *
   * EVERY CALL IS DETACHED (`const g = h.storageGet`), because `assertHost`
   * warns that a duty may be called unbound and that an Electron bridge is the
   * shape that gets it wrong.
   */
  R.storage = await evalIn(deckWc, `(async () => {
    const h = window.__wbHost;
    const g = h.storageGet, s = h.storageSet;
    const out = {};
    out.absent = await g('local', '__probe_absent__');
    s('local', '__probe__', { where: 'local' });
    s('session', '__probe__', { where: 'session' });
    await new Promise((r) => setTimeout(r, 120));
    out.local = await g('local', '__probe__');
    out.session = await g('session', '__probe__');
    out.getBadArea = await g('sync', 'x').then(() => 'RESOLVED', (e) => 'rejected: ' + e.message);
    try { s('sync', 'x', 1); out.setBadArea = 'RETURNED'; } catch (e) { out.setBadArea = 'threw: ' + e.message; }
    try { h.onStorageChanged('sync', 'x', () => {}); out.watchBadArea = 'RETURNED'; }
    catch (e) { out.watchBadArea = 'threw: ' + e.message; }
    out.setReturns = (() => { const r = s('local', '__probe_ret__', 1); return r === undefined ? 'undefined' : typeof r; })();
    return out;
  })()`);

  /**
   * THE CHANGE FEED, driven from the OTHER writer. `onStorageChanged` is not
   * sugar over `storageGet` precisely because the deck is not the only writer:
   * main writes this key too. So the change is made in MAIN and observed in the
   * deck, which is the direction that could not be faked by a local echo.
   */
  await evalIn(deckWc, `(() => {
    window.__probeChanges = [];
    window.__wbHost.onStorageChanged('local', '__probe_feed__', (v) => window.__probeChanges.push(v));
    return true;
  })()`);
  await wait(150);
  state.storage.set('local', '__probe_feed__', { from: 'main', n: 7 });
  await wait(300);
  R.storage.feed = await evalIn(deckWc, 'window.__probeChanges');
  R.storage.mainSees = { local: state.storage.get('local', '__probe__'), session: state.storage.get('session', '__probe__') };
  R.storage.file = path.relative(appRoot, state.storage.localFile);
  R.storage.stats = JSON.parse(JSON.stringify(state.storage.stats));

  // =======================================================================
  // 3. THE ARM CHORD — raw, and spelled by the unit
  // =======================================================================
  /**
   * `chordLabel()` is imported HERE, in the renderer, from the vendored
   * `embed-state.js` — the same function the deck itself used to draw the key
   * cap. Asking the unit to spell our answer is the only way to see what the
   * user sees; a regex in this file would be a second opinion about a rendering
   * this repository has already got wrong once.
   */
  R.chord = await evalIn(deckWc, `(async () => {
    const raw = await window.__wbHost.armShortcut();
    const m = await import('./embed-state.js');
    return {
      raw,
      drawnPc: m.chordLabel(raw, false),
      drawnMac: m.chordLabel(raw, true),
      onScreen: (document.getElementById('src-chord') || {}).textContent,
      lead: (document.getElementById('src-lead') || {}).textContent,
    };
  })()`);
  R.chord.fromMain = host.armAccelerator();

  // =======================================================================
  // 4. SESSION — the record the deck projects, before and after arming
  // =======================================================================
  const deckSees = () => evalIn(deckWc, `(() => {
    const t = (id) => { const el = document.getElementById(id); return el ? el.textContent : null; };
    const banner = document.getElementById('banner');
    return {
      lead: t('src-lead'), chord: t('src-chord'), sub: t('src-sub'),
      bannerHidden: !banner || banner.hidden === true,
      errTitle: t('err-t'), errBody: t('err-p'),
      dismissHidden: (document.getElementById('err-x') || {}).hidden,
      restartHidden: (document.getElementById('err-rx') || {}).hidden,
      autonav: (document.getElementById('autonav-cb') || {}).checked,
      navBannerHidden: (document.getElementById('nav-banner') || {}).hidden,
      status: window.__embed ? window.__embed.status : null,
      halted: window.__embed ? window.__embed.halted : null,
      navErr: window.__embed ? window.__embed.navErr : null,
      speed: window.__embed ? window.__embed.speed : null,
      speedGate: window.__embed ? window.__embed.speedGate : null,
    };
  })()`);

  R.session = { beforeArm: { host: host.sessionForDeck(), deck: await deckSees() } };

  const armed = host.arm();
  await wait(400);
  R.session.arm = armed;
  R.session.afterArm = { host: host.sessionForDeck(), deck: await deckSees() };

  // =======================================================================
  // 5. ARM_ERROR — raised, painted, persisted, and cleared
  // =======================================================================
  /**
   * A REAL REFUSAL, not an injected message: `SW_CAPTURE_START` from a deck that
   * is not armed is a state this product can be in, and it is the one the deck's
   * Start button reaches. So the probe disarms and then sends exactly what the
   * deck sends.
   */
  host.disarm();
  await wait(200);
  await evalIn(deckWc, `(() => { window.__wbHost.send({ v: 1, to: 'sw', from: 'ui', type: 'SW_CAPTURE_START', deck: 'A' }); return true; })()`);
  await wait(400);
  R.armError = {
    raised: await deckSees(),
    persisted: state.storage.get('session', 'armError'),
    stats: { armErrors: host.stats.armErrors, cleared: host.stats.armErrorsCleared },
  };

  // The deck's own dismissal path: it names the `seq` it was showing.
  const seq = R.armError.persisted && R.armError.persisted.seq;
  await evalIn(deckWc, `(() => { window.__wbHost.send({ v: 1, to: 'sw', from: 'ui', type: 'SW_ARM_ERROR_CLEAR', seq: ${JSON.stringify(seq)} }); return true; })()`);
  await wait(400);
  R.armError.afterClear = await deckSees();
  R.armError.persistedAfterClear = state.storage.get('session', 'armError');

  // =======================================================================
  // 6. THE PAGE DUTIES
  // =======================================================================
  /**
   * THE RE-SEND, MEASURED ON ITS OWN, because the obvious estimator saturates.
   *
   * "`ready` produced a re-send" was asserted as "some video messages have
   * arrived", and the transport pushes state on a ~4 Hz tick anyway — so
   * deleting the re-send changed nothing the assertion could see. Measured: the
   * mutation that ignores `ready` scored NO RED.
   *
   * `speed` and `autonav` are the discriminators: neither ticks, both are
   * deduped on the change path, and `resend()` re-sends the last of each
   * UNDEDUPED. So a second `ready` must move both counters within a window
   * shorter than anything else that could move them.
   */
  /**
   * WAIT FOR THE PRECONDITION, AND RECORD WHETHER IT WAS MET.
   *
   * `resend()` re-sends the LAST speed report and the LAST autoplay report — so
   * on a machine slow enough that neither has happened yet, it correctly sends
   * nothing and the delta below is correctly zero. That is a race in the
   * MEASUREMENT, not a defect in the Host, and it flaked exactly once: the first
   * battery run's clean baseline went red here while the same suite passed alone
   * seconds later.
   *
   * So the probe waits for each channel to have said something at all, and
   * reports whether it got there. A suite that could not set up its own
   * precondition must say so rather than assert through it.
   */
  const ready0 = Date.now();
  let pre = false;
  while (Date.now() - ready0 < 8000) {
    if (Number(host.stats.toDeck.speed || 0) >= 1 && Number(host.stats.toDeck.autonav || 0) >= 1) { pre = true; break; }
    await wait(100);
  }
  const countsBefore = { ...host.stats.toDeck };
  await evalIn(deckWc, "(() => { window.__wbDeck.pageSend({ c: 'ready' }); return true; })()");
  await wait(400);
  R.resend = {
    /** Did each channel have a last report to re-send at all. See above. */
    precondition: pre,
    waitedMs: Date.now() - ready0,
    before: countsBefore,
    after: { ...host.stats.toDeck },
    // What the deck asked for, so a red can tell "the deck never asked" from
    // "the Host never answered".
    readyFromDeck: host.stats.fromDeck.ready,
  };

  /**
   * WHAT THE DECK ITSELF MEASURED, read out of the deck's own document.
   *
   * Without it, "the Host clamped what the deck reported" cannot be told from
   * "the Host reports a constant": a Host that answered 900 for everything is
   * self-consistent, and the view really is 900 px, so an assertion that
   * compares main's number with the view's number passes. Measured — the
   * mutation that clamps every height to the ceiling left that assertion green
   * while the deck was measuring 432.
   *
   * `body.scrollHeight` is the same read `reportHeight()` makes in `ui/embed.js`,
   * and it is taken with no dialog open, which is when the deck's own modal floor
   * does not apply.
   */
  R.deckMeasured = await evalIn(deckWc,
    '(() => (document.querySelector("dialog[open]") ? null : Math.ceil(document.body.scrollHeight)))()');

  R.page = {
    claim: host.claim(),
    heights: host.stats.heights.slice(),
    deckBounds: state.deck.getBounds(),
    fromDeck: JSON.parse(JSON.stringify(host.stats.fromDeck)),
    toDeck: JSON.parse(JSON.stringify(host.stats.toDeck)),
  };

  // =======================================================================
  // 7. THE TRANSPORT — the closed write set, end to end onto a real <video>
  // =======================================================================
  /**
   * `evil` and `volume` ride along in the patch. The deck's own call sites never
   * send them; a Host that spread the patch instead of naming three fields would
   * put them on the wire, and the fixture is where that becomes visible.
   */
  const srcWc = state.source.webContents;
  const videoState = () => evalIn(srcWc, `(() => {
    const v = document.querySelector('video');
    if (!v) return null;
    return { muted: v.muted, rate: v.playbackRate, t: Number(v.currentTime.toFixed(2)),
             preservesPitch: v.preservesPitch, volume: v.volume, evil: v.evil === undefined ? 'absent' : 'PRESENT' };
  })()`);

  R.transport = { installed: state.transport !== null, before: await videoState() };
  if (state.transport) {
    await evalIn(srcWc, "(() => { const v = document.querySelector('video'); if (v) v.play(); return true; })()");
    await wait(600);
    R.transport.playing = await videoState();

    await evalIn(deckWc, `(() => {
      window.__wbHost.transport.drive({ muted: true, playbackRate: 1.25, currentTime: 4.5, evil: true, volume: 0.1 });
      return true;
    })()`);
    await wait(500);
    R.transport.afterDrive = await videoState();

    await evalIn(deckWc, '(() => { window.__wbHost.transport.release(); return true; })()');
    await wait(500);
    R.transport.afterRelease = await videoState();

    // UNFILTERED ON PURPOSE: 3x is outside the range and must be REPORTED, not
    // silently dropped. `resolveSpeed` in the vendored speed.js is the one clamp.
    await evalIn(deckWc, '(() => { window.__wbHost.transport.requestSpeed(3); return true; })()');
    await wait(600);
    R.transport.afterRequestSpeed = { video: await videoState(), deck: await deckSees() };
    R.transport.stats = JSON.parse(JSON.stringify(state.transport.stats));
  }

  // =======================================================================
  // 8. THE AUTOPLAY-NEXT WIRE — the checkbox that would otherwise be dead
  // =======================================================================
  /**
   * The gesture, not the storage write: `#autonav-cb` is clicked, which is what
   * a user does, and everything after it is the wire under test — `writePrefs`
   * -> `storageSet('local', PREFS_KEY, …)` -> main's own change listener ->
   * `transport.setPrefs`.
   */
  const prefsBefore = state.storage.get('local', 'prefs');
  // COPIED, NOT REFERENCED. `autonav.stats` is a live object: holding the
  // reference and JSON-copying it later compares the after with itself, which
  // reports "nothing moved" as confidently as it reports the truth. Measured —
  // the first run of this probe did exactly that.
  const suppressBefore = state.transport ? JSON.parse(JSON.stringify(state.transport.autonav.stats)) : null;
  await evalIn(deckWc, "(() => { document.getElementById('autonav-cb').click(); return true; })()");
  await wait(500);
  R.autoplayNext = {
    checkedNow: await evalIn(deckWc, "document.getElementById('autonav-cb').checked"),
    prefsBefore,
    prefsAfter: state.storage.get('local', 'prefs'),
    hostPrefsPushes: host.stats.prefs,
    autonavBefore: suppressBefore,
    autonavAfter: state.transport ? JSON.parse(JSON.stringify(state.transport.autonav.stats)) : null,
    // The file on disk, read back from outside the process that wrote it: this
    // is the half that proves `local` really outlives the run.
    onDisk: (() => {
      try { return JSON.parse(fs.readFileSync(state.storage.localFile, 'utf8')); } catch (e) { return { THREW: String(e.message) }; }
    })(),
  };

  // =======================================================================
  // 9. LATE BINDING — the rule that makes every wire assertion above worth
  //    anything (`shared/host.js` rule 2)
  // =======================================================================
  /**
   * LATE BINDING IS NOT OBSERVABLE FROM IN HERE, AND THE FIRST RUN OF THIS PROBE
   * PROVED IT THE EXPENSIVE WAY.
   *
   * The extension's version of this assertion replaces the PROPERTY
   * `chrome.runtime.sendMessage` after boot and counts what arrives. The
   * equivalent here is `window.__wbDeck.send = recorder` — and it silently does
   * nothing: `contextBridge.exposeInMainWorld` hands the main world a DEEPLY
   * IMMUTABLE object, so the assignment is dropped and the real `send` goes on
   * being called. Measured: `count: 0` with the message nonetheless delivered to
   * the engine, which is the recorder-stays-empty shape the rule warns about
   * wearing the other mask.
   *
   * So this records the immutability itself — which is worth having, because it
   * is what stops a compromised deck page from redirecting the Host's own wire —
   * and the late-binding claim moves to `tools/suites/deck-host.mjs`'s node half,
   * where the module is driven over a stub bridge that CAN be swapped.
   */
  R.bridgeImmutable = await evalIn(deckWc, `(() => {
    const real = window.__wbDeck.send;
    let threw = null;
    try { window.__wbDeck.send = () => {}; } catch (e) { threw = e.message; }
    const swapped = window.__wbDeck.send !== real;
    const ret = window.__wbHost.send({ v: 1, to: 'off', from: 'ui', type: 'PITCH', deck: 'A', semitones: 2 });
    return { swapped, threw, returned: ret === undefined ? 'undefined' : typeof ret };
  })()`);

  // =======================================================================
  // 10. WHAT IT DREW — the screenshot, BEFORE close() takes the deck away
  // =======================================================================
  R.screenshots = {
    deck: await capture(state.deck, path.join(outDir, 'deck.png')),
    window: await (async () => {
      try {
        const img = await state.win.contentView.children[1].webContents.capturePage();
        fs.writeFileSync(path.join(outDir, 'source.png'), img.toPNG());
        return { ok: true, ...paintedColours(img) };
      } catch (err) { return { ok: false, why: String(err.message || err) }; }
    })(),
  };

  // =======================================================================
  // 11. page.close() — LAST, because it takes the surface away
  // =======================================================================
  const visibleBefore = typeof state.deck.getVisible === 'function' ? state.deck.getVisible() : null;
  await evalIn(deckWc, "(() => { document.getElementById('close').click(); return true; })()");
  await wait(400);
  R.close = {
    visibleBefore,
    visibleAfter: typeof state.deck.getVisible === 'function' ? state.deck.getVisible() : null,
    deckClosed: state.deckClosed === true,
    bounds: state.deck.getBounds(),
    // THE AUDIO DOES NOT STOP: the engine is a different process and hiding a
    // view cannot reach it. What we can witness from here is that the engine
    // window is still there and still not destroyed.
    engineAlive: !!state.engineWin && !state.engineWin.isDestroyed(),
  };

  R.hostStats = JSON.parse(JSON.stringify(host.stats));
  R.busStats = JSON.parse(JSON.stringify(state.bus.stats));
  R.busAddresses = state.bus.addresses();

  fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(R, null, 2)}\n`);
  console.log(`[gate] wrote ${path.join(outDir, 'report.json')}`);
  return 0;
}
