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
 * real and this file only OBSERVES it: it adds no capability and changes no
 * webPreferences. Everything it reports is read back out of the running app.
 *
 * ONE HANDLER IS INSTALLED AND IT IS NAMED: a bus recorder, registered on the
 * deck through `window.__wbDeck.onMessage` — the same public bridge member the
 * deck itself uses. It is there because the page in that slot is now the
 * vendored `ui/embed.html`, whose source we do not own and must not edit (rule
 * V1), so an arrival on the deck's address cannot be witnessed any other way.
 * See the `bus` section.
 *
 * The judgement is entirely in the suite, which is a separate process that can
 * be run against a report from a mutated build and watched going red.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it never asserts. A probe that decided its
 * own verdict would be a suite that exits 0 having asserted nothing — the VOID
 * case, one level in.
 */
import { app, session as electronSession } from 'electron';
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

  /**
   * THE SIGN-IN DISGUISE, READ BACK OFF FIVE PLACES RATHER THAN OFF THE CONSTANT.
   *
   * `src/main/useragent.js` decides the string and `src/main/sessions.js` puts it
   * on one session; NEITHER is imported here, because a probe that read the
   * constant would agree with any mutation of it. What is collected instead is
   * what the running app would actually tell a website — the header the network
   * stack would send (`Session.getUserAgent`), what the `WebContents` inherited,
   * and what the DOCUMENT sees (`navigator.userAgent`) — for the source view and
   * for one of ours, so the suite can assert the DIFFERENCE and not just a shape.
   *
   * `app.userAgentFallback` is here because it is the one line that would
   * disguise every session at once, and a report that could not see it would let
   * that mutation through the half of the claim that matters most.
   *
   * `userAgentData` IS RECORDED AND NOT ASSERTED. `setUserAgent` overrides the
   * header and `navigator.userAgent`; it does not rewrite Chromium's client-hint
   * brands. That is a limitation of the disguise, it is stated in
   * `src/main/useragent.js` and in `FAQ.md`, and it belongs in the transcript so
   * that the day it changes is visible — but it is Chromium's behaviour and not
   * this product's, so nothing here holds it in place.
   */
  const UA_DATA = `(() => { const d = navigator.userAgentData;
    return d ? { brands: d.brands, mobile: d.mobile, platform: d.platform } : null; })()`;
  R.userAgent = {
    runtime: { chrome: process.versions.chrome, electron: process.versions.electron, platform: process.platform },
    sourceSession: srcWc.session.getUserAgent(),
    appSession: chromeWc.session.getUserAgent(),
    sourceWebContents: srcWc.getUserAgent(),
    deckWebContents: deckWc.getUserAgent(),
    navigator: {
      source: await evalIn(srcWc, 'navigator.userAgent'),
      deck: await evalIn(deckWc, 'navigator.userAgent'),
    },
    appFallback: app.userAgentFallback,
    factory: JSON.parse(JSON.stringify(state.sessions.stats().userAgents)),
    clientHints: { source: await evalIn(srcWc, UA_DATA), deck: await evalIn(deckWc, UA_DATA) },
  };

  // -------------------------------------------------------------- isolation
  /**
   * ONE INSTRUMENT, BOTH PAGES — AND THE DECK'S HALF IS NO LONGER ASKED OF THE
   * PAGE.
   *
   * `window.__wbProbe()` is defined by `src/renderer/deck-placeholder.js`, and
   * that file stopped being the document in the deck slot the day the unit was
   * vendored: `boot()` loads the real `ui/embed.html` there now, and that page
   * imports nothing of ours and never will. The probe went on asking for the
   * placeholder's global, got `{THREW: …}`, and the suite reported
   * `coi=undefined sab=undefined` about a page that is in fact isolated. A
   * measurement that lost its carrier, not a product regression.
   *
   * WHY THE MODULE AND NOT A COPY INLINED HERE. The claim is about the SCHEME —
   * a handler that put COOP/COEP on one response and not another is green on a
   * single-page check — so the two pages have to be measured BY THE SAME
   * INSTRUMENT or the comparison means nothing. `src/renderer/isolation.js` is
   * that instrument and its own header says why it is a module. A hand-rolled
   * second copy in this file would be two instruments reporting one number.
   *
   * IT NEEDS NOTHING FROM THE PAGE. `executeJavaScript` is exempt from the
   * document's CSP, and what it pulls is same-origin `app://workbench/
   * isolation.js`, which this origin's `script-src 'self'` admits — so it runs
   * on the placeholder, on the vendored deck, and on whatever is in that slot
   * next. `location.origin` rather than a relative specifier: an injected script
   * has no URL of its own to resolve one against.
   *
   * The engine keeps reading `window.__wbProbe()` deliberately. That is
   * `src/renderer/engine-boot.js` running the SAME module at boot, and it is the
   * value `src/main/main.js` puts in the chrome bar — so this line also witnesses
   * that the engine page really ran it, which an injected import would not.
   */
  R.isolation = {
    engine: await evalIn(engineWc, 'window.__wbProbe()'),
    deck: await evalIn(deckWc, "import(location.origin + '/isolation.js').then((m) => m.probeIsolation())"),
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
  /**
   * THE RECORDER IS INSTALLED THROUGH THE DECK'S OWN BRIDGE, AND BEFORE THE
   * SENDS BELOW.
   *
   * It used to be `window.__wbBusLog()` — the placeholder's other global, gone
   * for the same reason as `__wbProbe` — so two assertions about
   * `src/main/bus.js` reported `0 of 1 arrived` about a bus that was working,
   * while `deck-host` and `deck-seam` stayed green throughout. That is what a
   * stale probe looks like from the outside, and it is why the suite now asserts
   * that this recorder installed at all before it reads what it collected.
   *
   * `window.__wbDeck.onMessage` is `src/preload/deck.cjs`'s own fan-out over a
   * `Set`, so this listener is ADDITIONAL to the deck's rather than in place of
   * it, and it observes the real deck's real inbox whatever page is in the slot.
   *
   * THIS IS THE ONE HANDLER THIS FILE INSTALLS, and the header's "installs no
   * handler" is written to admit it: it is registered through the same public
   * bridge member the deck itself uses, adds no capability that was not already
   * exposed to that renderer, and is the only way to witness an arrival on a
   * page whose source we do not own.
   */
  const busRecorder = await evalIn(deckWc, `(() => {
    if (!window.__wbDeck || typeof window.__wbDeck.onMessage !== 'function') {
      return { installed: false,
               why: 'window.__wbDeck.onMessage is absent — src/preload/deck.cjs did not run, or exposes no inbox' };
    }
    window.__wbGateBus = [];
    window.__wbDeck.onMessage((m) => { window.__wbGateBus.push(m); });
    return { installed: true };
  })()`);

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
    deckReceived: await evalIn(deckWc, 'window.__wbGateBus'),
    recorder: busRecorder,
    expectedPing: { v: 1, to: 'ui', from: 'off', type: 'GATE_PING', nonce },
    stats: JSON.parse(JSON.stringify(state.bus.stats)),
    addresses: state.bus.addresses(),
  };

  // --------------------------------------------------------------- capture
  //
  // A CLAIM IS MINTED FIRST, because since the EngineHost landed there are three
  // gates and not two: the permission layer, the request handler's `isCaptor`,
  // and a ONE-SHOT CLAIM that only the arm path mints (src/main/claims.js). The
  // engine's own `captureStream` spends its claim through `capture:claim`; this
  // probe is asking the platform DIRECTLY, below the Host module, so it has to
  // spend one itself or it would be measuring the third gate rather than the
  // grant. `state.claims` is main's registry — the real one, not a stand-in.
  //
  // The deck and the source view get NO claim, deliberately: they are refused at
  // the permission layer, one gate earlier, and that is what those two rows
  // assert.
  const gateToken = state.claims.mint({ sourceWcId: srcWc.id, deck: 'gate' });
  const gateClaim = await evalIn(engineWc, `window.__wbEngine.claimCapture(${JSON.stringify(gateToken)})`);
  R.capture = {
    claim: gateClaim,
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
  // SNAPSHOTS, NOT THE LIVE ARRAYS. `state.source.stats.refusedNavigations` is
  // the guard's own growing list, and this object is serialised at the END of
  // the run — so handing over the reference would let the sign-in section below
  // add rows to a section that has already been measured, and the assertion
  // "exactly one navigation was refused" would then be counting a later probe's
  // work. Two sections, two measurements.
  const refusedAfterGuest = state.source.stats.refusedNavigations.length;
  R.guest = {
    urlBefore: before,
    urlAfter: srcWc.getURL(),
    refusedNavigations: [...state.source.stats.refusedNavigations],
    deniedWindowOpens: [...state.source.stats.deniedWindowOpens],
    windowOpenResult,
    refusedDownloads: state.source.stats.refusedDownloads,
    fixture: await evalIn(srcWc, 'window.__wbFixture ? window.__wbFixture() : null'),
  };

  // ------------------------------------------------------------ 2.x sign-in
  /**
   * CAN A SIGN-IN FLOW ACTUALLY GO WHERE IT NEEDS TO GO?
   *
   * `desktop-app-plan.md` seed §9 puts a stock Chrome user-agent on this
   * partition so that Google will accept the sign-in — and a user-agent that
   * gets you past the *"this browser may not be secure"* page is worth nothing
   * if the allowlist then cancels the redirect chain. Google's flow leaves
   * youtube.com for `accounts.google.com`, may bounce through
   * `accounts.youtube.com` and `consent.youtube.com`, and lands on
   * `myaccount.google.com` for a challenge. Every one of those has to be
   * reachable BY A RENDERER-INITIATED NAVIGATION, which is the only kind the
   * guard ever sees.
   *
   * THE WITNESS IS THE SESSION'S REQUEST LOG, AND THE FIRST ONE TRIED WAS WRONG.
   *
   * "Is not in the refusal ledger" will not do: that is also what a navigation
   * nobody attempted looks like, so an allowlist that admitted NOTHING would
   * pass it. `did-start-navigation` was the obvious positive witness and it is
   * not one — MEASURED on Electron 44.0.0, it fires for a navigation
   * `will-navigate` has already `preventDefault()`ed, so admitted and cancelled
   * produce the same event. `src/main/youtube.js` records that finding.
   *
   * `sessions.log()` cannot be confused that way. A cancelled navigation never
   * becomes a request at all, so a row on the `user`-owned session carrying one
   * of these URLs is the navigation having really reached Chromium's network
   * stack — the wire, not an intention. It is also the instrument P1' already
   * depends on, so it is not a second one nobody watches.
   *
   * THIS RUN STILL DOES NOT TOUCH GOOGLE. The four hosts are mapped to a closed
   * loopback port by `--host-resolver-rules` at the launch in
   * `tools/suites/shell.mjs`; `onBeforeRequest` fires before the connection, so
   * the row is written either way and nothing leaves the box.
   *
   * THE OFF-LIST CONTROL IS THE `includes()` TRAP, LIVE. A guard written as
   * `host.includes('google.com')` admits `accounts.google.com.evil.test`; a
   * pure-function assertion already says it must not, and this is the same claim
   * over the running app, where the answer comes from Chromium rather than from
   * a unit test's idea of a URL.
   */
  const SIGN_IN_PROBES = [
    'https://accounts.google.com/ServiceLogin',
    'https://accounts.youtube.com/accounts/SetSID',
    'https://consent.youtube.com/m',
    'https://myaccount.google.com/security-checkup',
  ];
  const OFF_LIST_PROBE = 'https://accounts.google.com.evil.test/ServiceLogin';
  const logBefore = state.sessions.log().length;
  // BACK TO THE FIXTURE BETWEEN EACH ONE. Four of the five attempts are ALLOWED
  // and then fail to connect, so without this every attempt after the first
  // would be launched from Chromium's error page — a different document, with a
  // different origin, and one whose ability to run `location.href` is
  // Chromium's business rather than ours. Each attempt therefore starts from the
  // same known page, so a red here is about the guard and not about where the
  // previous attempt happened to leave the view.
  for (const url of [...SIGN_IN_PROBES, OFF_LIST_PROBE]) {
    await state.source.load(sourceUrl).catch(() => {});
    await evalIn(srcWc, `(() => { location.href = ${JSON.stringify(url)}; return 'tried'; })()`);
    await wait(300);
  }
  R.signin = {
    attempted: [...SIGN_IN_PROBES],
    offList: OFF_LIST_PROBE,
    /** every request the source partition really issued, since the guest section */
    onTheWire: state.sessions.log().slice(logBefore)
      .filter((r) => r.owner === 'user' && r.cancelled === false)
      .map((r) => ({ url: r.url, resourceType: r.resourceType })),
    /** ...and every navigation the guard stopped, over the same window */
    refused: state.source.stats.refusedNavigations.slice(refusedAfterGuest),
  };
  // BACK TO THE FIXTURE before anything else is measured. Four of those five
  // navigations were ALLOWED and then failed to connect, so the view is sitting
  // on Chromium's error page; the screenshot and the chrome-bar reads below are
  // about this app, not about that page.
  await state.source.load(sourceUrl).catch(() => {});

  // ------------------------------------------------- what the chrome bar says
  // Read AFTER the guest section, so the refusal line has something to show.
  R.chromeDom = await evalIn(chromeWc, `(() => {
    const t = (id) => { const el = document.getElementById(id); return el ? el.textContent : null; };
    const arm = document.getElementById('arm');
    return { arm: !!arm, armDisabled: !!(arm && arm.disabled), armText: arm ? arm.textContent : null,
             armedAttr: arm ? arm.dataset.armed : null, bridgeArm: typeof (window.__wbChrome || {}).arm,
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
