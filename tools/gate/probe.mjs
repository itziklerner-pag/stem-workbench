/**
 * The gate's eyes inside a real launch.
 *
 * `src/main/main.js --gate=DIR` imports this file — DYNAMICALLY, and only when
 * that flag is present — hands it the live handles, and exits with what it
 * returns. `tools/suites/shell.mjs` spawns that launch and asserts over
 * `DIR/report.json`.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PROBE IS INSIDE THE APP AND THE ASSERTIONS ARE OUTSIDE IT
 * ---------------------------------------------------------------------------
 * The thing under test is the REAL entry point — `electron .`, the real
 * `package.json` `main`, the real protocol handler, the real windows. A second
 * main process that imported the same modules would be a second app, and the
 * two would agree right up until the day the real one changed. So the launch is
 * real and this file only OBSERVES it: it adds no capability, changes no
 * webPreferences, and installs no handler. Everything it reports is read back
 * out of the running app.
 *
 * The judgement is entirely in the suite, which is a separate process that can
 * be run against a report from a mutated build and watched going red.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it never asserts. A probe that decided its
 * own verdict would be a suite that exits 0 having asserted nothing — the VOID
 * case, one level in.
 */
import { session as electronSession } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** `executeJavaScript` in the main world, with the throw kept as data. */
async function evalIn(wc, code, userGesture = false) {
  try { return await wc.executeJavaScript(code, userGesture); }
  catch (err) { return { THREW: String((err && err.message) || err) }; }
}

/**
 * How many distinct pixels a view actually drew.
 *
 * A blank page and a painted page both produce a PNG, and a byte count cannot
 * tell them apart — a solid-colour 1280x600 PNG compresses to a few hundred
 * bytes and so does a broken one. The distinct-colour COUNT can: it is 1 for
 * anything uniform, including the window's own background, and more for
 * anything with text on it. Sampled every 97th pixel (a prime, so the stride
 * cannot land on a repeating column and see one colour forever).
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

/** The three webPreferences that are the whole of "our renderers are locked down". */
const prefsOf = (wc) => {
  try {
    const p = wc.getLastWebPreferences() || {};
    return { contextIsolation: p.contextIsolation !== false, sandbox: p.sandbox === true, nodeIntegration: p.nodeIntegration === true };
  } catch (err) { return { THREW: String((err && err.message) || err) }; }
};

/** What a renderer can see of Node. All three must be `'undefined'`. */
const NODE_REACH = `({ require: typeof require, process: typeof process, module: typeof module,
   bridges: Object.getOwnPropertyNames(window).filter((k) => k.startsWith('__wb')) })`;

const GDM = `(async () => {
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({
      audio: { autoGainControl: false, echoCancellation: false, noiseSuppression: false },
      video: true,
    });
    const a = s.getAudioTracks()[0];
    const out = { ok: true, audioTracks: s.getAudioTracks().length, videoTracks: s.getVideoTracks().length,
                  settings: a ? a.getSettings() : null };
    for (const t of s.getTracks()) t.stop();
    return out;
  } catch (e) { return { ok: false, name: e.name, message: String(e.message || e) }; }
})()`;

export async function runGate({ state, outDir, sourceUrl, appRoot }) {
  fs.mkdirSync(outDir, { recursive: true });

  const engineWc = state.engineWin.webContents;
  const deckWc = state.deck.webContents;
  const chromeWc = state.chrome.webContents;
  const srcWc = state.source.webContents;

  const R = {
    gate: 1,
    when: new Date().toISOString(),
    versions: process.versions,
    platform: process.platform,
    argv: process.argv.slice(1),
    sourceUrl,
  };

  // ---------------------------------------------------------------- topology
  R.window = {
    windowClass: state.win.constructor.name,
    childViews: state.win.contentView.children.length,
    order: state.win.contentView.children.map((v) => {
      try { return v.webContents.getURL().slice(0, 120); } catch { return '(no webContents)'; }
    }),
    bounds: state.win.getContentBounds(),
    visible: state.win.isVisible(),
    engineHidden: !state.engineWin.isVisible(),
    engineIsBrowserWindow: state.engineWin.constructor.name,
  };

  R.renderers = {
    chrome: { url: chromeWc.getURL(), title: chromeWc.getTitle(), prefs: prefsOf(chromeWc), reach: await evalIn(chromeWc, NODE_REACH) },
    deck: { url: deckWc.getURL(), title: deckWc.getTitle(), prefs: prefsOf(deckWc), reach: await evalIn(deckWc, NODE_REACH) },
    engine: { url: engineWc.getURL(), title: engineWc.getTitle(), prefs: prefsOf(engineWc), reach: await evalIn(engineWc, NODE_REACH) },
    source: { url: srcWc.getURL(), title: srcWc.getTitle(), prefs: prefsOf(srcWc), reach: await evalIn(srcWc, NODE_REACH) },
  };

  // ------------------------------------------------------------- the sessions
  // The privacy boundary, read back off the running app rather than off the
  // source that set it up: `persist:youtube` holds the source view and NOTHING
  // else, and our three renderers are all on the default session.
  R.sessions = {
    chromeIsDefault: chromeWc.session === electronSession.defaultSession,
    deckIsDefault: deckWc.session === electronSession.defaultSession,
    engineIsDefault: engineWc.session === electronSession.defaultSession,
    sourceIsDefault: srcWc.session === electronSession.defaultSession,
    sourceStorage: srcWc.session.storagePath ? path.basename(srcWc.session.storagePath) : null,
  };

  // -------------------------------------------------------------- isolation
  R.isolation = {
    engine: await evalIn(engineWc, 'window.__wbProbe()'),
    deck: await evalIn(deckWc, 'window.__wbProbe()'),
  };

  // ------------------------------------------------------- the app:// handler
  R.appScheme = await evalIn(engineWc, `(async () => {
    const probe = async (url, init) => {
      try { const r = await fetch(url, init); return { status: r.status, len: r.headers.get('content-length'),
        type: r.headers.get('content-type'), coop: r.headers.get('cross-origin-opener-policy'),
        coep: r.headers.get('cross-origin-embedder-policy'), corp: r.headers.get('cross-origin-resource-policy') }; }
      catch (e) { return { threw: e.name + ': ' + String(e.message || e) }; }
    };
    return {
      head: await probe('app://workbench/engine.html', { method: 'HEAD' }),
      traversal: await probe('app://workbench/%2e%2e%2f%2e%2e%2fpackage.json'),
      // Refused by OUR OWN CSP (\`connect-src 'self'\`) before it reaches the
      // handler, which is the outer of the two refusals and the one worth
      // having. The handler's own unknown-host branch is asserted directly, as
      // a pure function, in the suite.
      otherHostFetch: await probe('app://not-workbench/engine.html'),
      missing: await probe('app://workbench/nothing-here.html'),
    };
  })()`);
  R.protocolStats = { ...state.protocol.stats };

  // ------------------------------------------------------------------- bus
  const nonce = `gate-${Date.now()}`;
  // DETACHED on purpose: `shared/host.js` names "a duty implemented as a method
  // that needs its `this`" as THE Electron mistake, and the bridge is where it
  // would start.
  await evalIn(engineWc, `(() => { const f = window.__wbEngine.send;
    f({ v: 1, to: 'ui', from: 'off', type: 'GATE_PING', nonce: '${nonce}' }); return 'sent'; })()`);
  await evalIn(engineWc, `(() => { window.__wbEngine.send({ v: 2, to: 'ui', from: 'off', type: 'GATE_WRONG_VERSION' }); return 'sent'; })()`);
  await evalIn(engineWc, `(() => { window.__wbEngine.send({ v: 1, to: 'nobody-listens-here', from: 'off' }); return 'sent'; })()`);
  await wait(250);
  R.bus = {
    deckReceived: await evalIn(deckWc, 'window.__wbBusLog()'),
    expectedPing: { v: 1, to: 'ui', from: 'off', type: 'GATE_PING', nonce },
    stats: JSON.parse(JSON.stringify(state.bus.stats)),
    addresses: state.bus.addresses(),
  };

  // --------------------------------------------------------------- capture
  R.capture = {
    fromEngine: await evalIn(engineWc, GDM),
    fromDeck: await evalIn(deckWc, GDM),
    fromSource: await evalIn(srcWc, GDM),
    // READ OFF THE SOURCE VIEW, not off the capture handler's own bookkeeping:
    // the deviceId a granted track carries is
    // \`web-contents-media-stream://<processId>:<routingId>\`, so these two
    // numbers are what says the grant named the SOURCE frame and not some other
    // one. Taking them from \`stats.lastGrantedFrame\` would be asking the
    // handler to mark its own work.
    sourceWebContentsId: srcWc.id,
    sourceFrame: { processId: srcWc.mainFrame.processId, routingId: srcWc.mainFrame.routingId },
    chromeFrame: { processId: chromeWc.mainFrame.processId, routingId: chromeWc.mainFrame.routingId },
    stats: JSON.parse(JSON.stringify(state.capture.stats)),
  };

  // ------------------------------------------------- the guest's short list
  const before = srcWc.getURL();
  await evalIn(srcWc, `(() => { location.href = 'https://example.com/'; return 'tried'; })()`);
  await wait(400);
  // `userGesture: true` because Chromium's popup blocker refuses a
  // `window.open` with no transient activation BEFORE `setWindowOpenHandler`
  // ever sees it — which would look like our denial and is not.
  const windowOpenResult = await evalIn(srcWc,
    `(() => { const w = window.open('https://example.com/', '_blank'); return String(w); })()`, true);
  await wait(250);
  R.guest = {
    urlBefore: before,
    urlAfter: srcWc.getURL(),
    refusedNavigations: state.source.stats.refusedNavigations,
    deniedWindowOpens: state.source.stats.deniedWindowOpens,
    windowOpenResult,
    refusedDownloads: state.source.stats.refusedDownloads,
    fixture: await evalIn(srcWc, 'window.__wbFixture ? window.__wbFixture() : null'),
  };

  // ------------------------------------------------- what the chrome bar says
  // Read AFTER the guest section, so the refusal line has something to show.
  R.chromeDom = await evalIn(chromeWc, `(() => {
    const t = (id) => { const el = document.getElementById(id); return el ? el.textContent : null; };
    const arm = document.getElementById('arm');
    return { arm: !!arm, armDisabled: !!(arm && arm.disabled), armText: arm ? arm.textContent : null,
             source: t('source'), deck: t('deck'), engine: t('engine'), refusal: t('refusal') };
  })()`);

  // ------------------------------------------------------------ the mute
  R.mute = JSON.parse(JSON.stringify(state.source.witness));
  R.mute.isAudioMutedNow = srcWc.isAudioMuted();

  // ---------------------------------------------------------- what it drew
  R.screenshots = {
    chrome: await capture(state.chrome, path.join(outDir, 'chrome.png')),
    source: await capture(state.source.view, path.join(outDir, 'source.png')),
    deck: await capture(state.deck, path.join(outDir, 'deck.png')),
  };

  // ------------------------------------------------------------ the machine
  R.machine = { chromeSandboxSuid: suidHelper(appRoot), display: process.env.DISPLAY || null };

  fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(R, null, 2)}\n`);
  console.log(`[gate] wrote ${path.join(outDir, 'report.json')}`);
  return 0;
}

/**
 * Whether Chromium's setuid sandbox helper is installed the way Chromium wants
 * it. On this box it is a property of an unpackaged `node_modules` tree, not of
 * the app, so it is REPORTED and never asserted — but a run that had to turn
 * the sandbox off should say so in its own transcript rather than in someone's
 * memory.
 */
function suidHelper(appRoot) {
  try {
    const st = fs.statSync(path.join(appRoot, 'node_modules', 'electron', 'dist', 'chrome-sandbox'));
    return st.uid === 0 && (st.mode & 0o4000) !== 0;
  } catch { return null; }
}
