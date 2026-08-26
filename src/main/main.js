/**
 * stem-workbench — the main process.
 *
 * The Host's privileged half: the MV3 service worker's job, minus the 30 s idle
 * death, so unlike the service worker it may hold state in module scope — and it
 * does. docs/HOST-DESIGN.md is the design; docs/ARCHITECTURE.md §1 is the map.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS WAVE BUILDS, AND WHAT IT DOES NOT
 * ---------------------------------------------------------------------------
 * BUILT: the window and its three views, the `app://` origin with COOP/COEP on
 * every response, the two sessions, the four preloads, the navigation
 * allowlist, the capture grant, and the mute that lands before the source view
 * loads anything.
 *
 * NOT BUILT, and every one of them is named here rather than left to be
 * discovered:
 *   · THE 32 DUTIES. `vendor/…/offscreen/host.js` and `vendor/…/ui/host.js` do
 *     not exist. The preloads carry the bus and nothing else.
 *   · THE SIX MESSAGES THE HOST ORIGINATES, and the six it must ANSWER
 *     (`SW_*` — HOST-DESIGN.md §5.3, finding F1). `bus.js` warns on each one it
 *     drops, loudly, once per message.
 *   · THE ARM GESTURE (§6). The chrome bar's Arm button is present and
 *     disabled; there is no menu accelerator yet.
 *   · THE MODEL (§7). No `/model/` root on the protocol handler.
 *   · THE UNIT ITSELF. Until `vendor/stem-splitter-live/` lands, the deck slot
 *     shows our own placeholder and says so.
 *
 * ---------------------------------------------------------------------------
 * ARGUMENTS — three, all for development and the gate
 * ---------------------------------------------------------------------------
 *   --source-url=URL   what the source view loads (default: youtube.com). The
 *                      gate points it at a LOCAL fixture, because CI must never
 *                      depend on YouTube's DOM or its bot walls.
 *   --user-data=DIR    a profile of its own, so one run cannot inherit state
 *                      from an unrelated one.
 *   --gate=DIR         write a machine-readable report of what this launch
 *                      actually did into DIR and exit. See tools/gate/probe.mjs;
 *                      it is imported ONLY when this flag is present, so the
 *                      product's module graph does not contain its own gate.
 */
import { app, BaseWindow, BrowserWindow, WebContentsView, ipcMain, Menu, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { registerAppSchemeAsPrivileged, installAppProtocol, appUrl } from './protocol.js';
import { createSourceView } from './youtube.js';
import { installCapturePolicy } from './capture.js';
import { createBus, BUS } from './bus.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = path.resolve(HERE, '..', '..');

// THE ONLY ORDERING CONSTRAINT IN THIS FILE: before `app.whenReady()`.
registerAppSchemeAsPrivileged();

// The belt to `backgroundThrottling: false`'s braces (HOST-DESIGN.md §1.3). The
// engine window is hidden for its whole life, and Chromium coalesces a hidden
// renderer's timers to ~1 Hz — which does not stop the audio, it starves the
// 10 Hz heartbeat and the live pump that FEED it. NOT GATED YET: the assertion
// is a count of heartbeats over 20 s (A6) and there is no engine to count.
app.commandLine.appendSwitch('disable-renderer-backgrounding');

// ------------------------------------------------------------------ arguments
const argv = process.argv.slice(2);
const val = (k, d) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit === undefined ? d : hit.slice(k.length + 3);
};
const SOURCE_URL = val('source-url', 'https://www.youtube.com/');
const GATE = val('gate', '');
const USER_DATA = val('user-data', '');

// A run's profile never lands in ~/.config/Electron during development: the
// `out/` tree is gitignored and a gate run gets its own directory entirely.
if (USER_DATA) app.setPath('userData', path.resolve(USER_DATA));
else if (!app.isPackaged) app.setPath('userData', path.join(APP_ROOT, 'out', 'userdata'));

// ------------------------------------------------------------------- layout
/** HOST-DESIGN.md §1.2: three child views with DISJOINT bounds. */
const CHROME_H = 44;
const DECK_H = 260;                       // §3.3 clamps a deck-requested height to 120..900
const clampDeck = (h) => Math.max(120, Math.min(900, h));

// ------------------------------------------------------------- what is vendored
const DECK_ENTRY = 'vendor/stem-splitter-live/extension/ui/embed.html';
const deckVendored = () => fs.existsSync(path.join(APP_ROOT, DECK_ENTRY));

const ROOTS = [
  { prefix: '/vendor/', dir: path.join(APP_ROOT, 'vendor') },
  { prefix: '/', dir: path.join(APP_ROOT, 'src', 'renderer') },
];

const PRELOAD = (name) => path.join(APP_ROOT, 'src', 'preload', `${name}.cjs`);

/** Ours, for every renderer we own. `sandbox: true` and `nodeIntegration: false`. */
const OUR_WEB_PREFERENCES = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webviewTag: false,
};

// --------------------------------------------------------------------- state
const state = {
  win: null,
  chrome: null,
  source: null,          // the object createSourceView() returns
  deck: null,
  engineWin: null,
  bus: null,
  protocol: null,
  capture: null,
  refusals: [],
  engineBoot: null,      // filled from the engine's own probe, for the chrome bar
  quitting: false,
};

/**
 * Renderer console -> our stdout. Electron does not forward it, and "the app
 * started and the page loaded" is a claim that should not need a debugger to
 * read. The signature of `console-message` changed to a details object in recent
 * Electron; both shapes are handled because getting it wrong prints
 * `[engine] undefined`, which looks like the page saying nothing.
 */
function forwardConsole(wc, tag) {
  wc.on('console-message', (...args) => {
    const d = args[1];
    const message = d && typeof d === 'object' && 'message' in d ? d.message : args[2];
    console.log(`[${tag}] ${message}`);
  });
  wc.on('render-process-gone', (_e, details) => console.error(`[${tag}] render process gone: ${JSON.stringify(details)}`));
  wc.on('did-fail-load', (_e, code, desc, url) => {
    if (code === -3) return;                       // ERR_ABORTED: our own refusal, already reported
    console.error(`[${tag}] did-fail-load ${code} ${desc} ${url}`);
  });
}

function pushStatus() {
  if (!state.chrome || state.chrome.webContents.isDestroyed()) return;
  state.chrome.webContents.send('chrome:status', {
    sourceUrl: state.source ? state.source.webContents.getURL() : null,
    deckVendored: deckVendored(),
    engine: state.engineBoot,
    refusals: state.refusals.slice(-4),
  });
}

function noteRefusal(r) {
  state.refusals.push(r);
  console.warn(`[source] refused ${r.url} — ${r.why}`);
  pushStatus();
}

function layout() {
  const { width, height } = state.win.getContentBounds();
  const deckH = clampDeck(DECK_H);
  state.chrome.setBounds({ x: 0, y: 0, width, height: CHROME_H });
  state.source.view.setBounds({ x: 0, y: CHROME_H, width, height: Math.max(0, height - CHROME_H - deckH) });
  state.deck.setBounds({ x: 0, y: Math.max(CHROME_H, height - deckH), width, height: deckH });
}

// ---------------------------------------------------------------------- boot
async function boot() {
  // The chrome, deck and engine renderers live on the DEFAULT session — our
  // origin, our storage, and the only session the `app://` handler is on.
  // `persist:youtube` holds the source view and nothing else: cookies, sign-in
  // state and every byte YouTube stores are reachable from nothing but it.
  const ours = session.defaultSession;
  const theirs = session.fromPartition('persist:youtube');
  state.protocol = installAppProtocol(ours, ROOTS);
  state.bus = createBus();

  // No address bar, no tabs — and for now no menu either. The menu arrives in
  // the next wave carrying ONE item that matters: Source -> Arm, whose
  // accelerator is what `armShortcut()` answers with (§6.3).
  Menu.setApplicationMenu(null);

  state.win = new BaseWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 560,
    title: 'stem-workbench', backgroundColor: '#10161d', show: false,
  });

  // ------------------------------------------------------------ chrome view
  state.chrome = new WebContentsView({ webPreferences: { ...OUR_WEB_PREFERENCES, preload: PRELOAD('chrome') } });
  forwardConsole(state.chrome.webContents, 'chrome');

  // ------------------------------------------------------------ source view
  // Created BEFORE it is loaded and muted before it is created-and-loaded — the
  // mute is the first statement inside createSourceView().
  state.source = createSourceView({ session: theirs, preload: PRELOAD('youtube'), onRefusal: noteRefusal });
  forwardConsole(state.source.webContents, 'source');
  state.source.webContents.on('page-title-updated', pushStatus);
  state.source.webContents.on('did-navigate', pushStatus);

  // -------------------------------------------------------------- deck view
  state.deck = new WebContentsView({ webPreferences: { ...OUR_WEB_PREFERENCES, preload: PRELOAD('deck') } });
  forwardConsole(state.deck.webContents, 'deck');

  // Fixed order, so that a future overlay lands somewhere stated. The three
  // bounds are disjoint, so "beneath" is layout and not z-order.
  state.win.contentView.addChildView(state.chrome);
  state.win.contentView.addChildView(state.source.view);
  state.win.contentView.addChildView(state.deck);
  layout();
  state.win.on('resize', layout);

  // ------------------------------------------------------------ the engine
  // A hidden window, not a view: it needs SharedArrayBuffer, WebGPU,
  // AudioWorklet, OPFS and the captured MediaStream, and it must keep running
  // when the deck is closed. `backgroundThrottling: false` is the load-bearing
  // line — Chromium coalesces a hidden renderer's timers to ~1 Hz, which does
  // not stop the audio, it starves the thing that feeds it.
  state.engineWin = new BrowserWindow({
    show: false, skipTaskbar: true, width: 900, height: 600,
    webPreferences: { ...OUR_WEB_PREFERENCES, preload: PRELOAD('engine'), backgroundThrottling: false },
  });
  forwardConsole(state.engineWin.webContents, 'engine');

  // ------------------------------------------------------- the capture grant
  // Installed on OUR session, not the source view's: the handler answers the
  // renderer that ASKS, and the only renderer allowed to ask is the engine.
  state.capture = installCapturePolicy(
    ours,
    () => (state.source && !state.source.webContents.isDestroyed() ? state.source.webContents.mainFrame : null),
    (wc) => !!state.engineWin && !state.engineWin.isDestroyed() && wc === state.engineWin.webContents,
  );

  // ------------------------------------------------------------- addresses
  // Assigned by main, never claimed by a renderer.
  state.bus.register(BUS.engine, state.engineWin.webContents);
  state.bus.register(BUS.deck, state.deck.webContents);

  // Only the chrome view may ask for a status push. Nothing else has the
  // channel, and an address is not something a renderer gets to claim.
  ipcMain.on('chrome:ready', (event) => {
    if (state.chrome && event.sender === state.chrome.webContents) pushStatus();
  });

  // ----------------------------------------------------------------- load
  const deckUrl = deckVendored() ? appUrl(DECK_ENTRY) : appUrl('deck-placeholder.html');
  await Promise.all([
    state.chrome.webContents.loadURL(appUrl('chrome.html')),
    state.deck.webContents.loadURL(deckUrl),
    state.engineWin.webContents.loadURL(appUrl('engine.html')),
  ]);
  await state.source.load(SOURCE_URL);

  state.win.show();
  pushStatus();

  // The engine's own answer, for the chrome bar. It is the same probe the gate
  // reads, and it is asked for here so the bar can show `coi`/`sab` without the
  // gate having to be running.
  state.engineBoot = await state.engineWin.webContents.executeJavaScript('window.__wbProbe()').catch(() => null);
  pushStatus();

  console.log(`[main] ready · source=${state.source.webContents.getURL()} · deck=${deckUrl} `
    + `· engine coi=${state.engineBoot && state.engineBoot.coi} sab=${state.engineBoot && state.engineBoot.sab}`);

  return state;
}

// ---------------------------------------------------------------- lifecycle
app.whenReady().then(async () => {
  await boot();

  if (GATE) {
    // Imported ONLY here. The product's module graph does not contain its own
    // gate, and `tools/` is not packaged.
    const probe = await import(pathToFileURL(path.join(APP_ROOT, 'tools', 'gate', 'probe.mjs')).href);
    const code = await probe.runGate({ state, outDir: path.resolve(GATE), sourceUrl: SOURCE_URL, appRoot: APP_ROOT });
    app.exit(code);
  }
}).catch((err) => {
  console.error('[main] boot failed', err && err.stack ? err.stack : err);
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());

/**
 * NEVER `destroy()` THE ENGINE WINDOW — `close()` IT. `onTeardown` is
 * `pagehide`, and `pagehide` is what stops the capture tracks; `destroy()` skips
 * it. The leak here is not a muted tab but a live capture and a ~1.7 GB wasm
 * heap. Quit waits for the engine to actually be gone.
 */
app.on('before-quit', (e) => {
  if (state.quitting) return;
  const eng = state.engineWin;
  if (!eng || eng.isDestroyed()) return;
  state.quitting = true;
  e.preventDefault();
  eng.once('closed', () => app.quit());
  eng.close();
});
