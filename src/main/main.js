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
 * SINCE THEN: the unit is vendored, the ENGINE half of the Host seam is
 * implemented (`vendor/…/offscreen/host.js` — ours, nine duties), the engine
 * page loads the unit's own entry, the model has a root on the protocol handler
 * (§7), and `main` originates the three messages the engine is owed and mints
 * the one-shot capture claims they carry (§5).
 *
 * AND SINCE THEN: the DECK half is in too (`vendor/…/ui/host.js` — ours,
 * fourteen members), the six `SW_*` the deck boots by polling for are answered
 * (`src/main/deck-host.js`, HOST-DESIGN.md §5.3 finding F1), and THE ARM
 * GESTURE (§6) is reachable by two real gestures a user can make: `Source ->
 * Arm this Source` with its accelerator, and the chrome bar's Arm button —
 * which shipped `disabled` for a wave AFTER arming started working, while the
 * product's own refusal text told the user to press it, and is live now
 * (`ipcMain.handle('chrome:arm')` below). Both call the same `deckHost.arm()`.
 *
 * STILL NOT BUILT, and named here rather than left to be discovered:
 *   · PACKAGING IS CONFIGURED AND HAS NEVER BEEN BUILT. `package.json`'s
 *     `build` key and `.github/workflows/package.yml` exist; no installer has
 *     been produced on this box and nothing has been signed or notarized.
 *     README.md "What was verified, and what was only configured" is the list.
 *   · THE LIVE SCHEDULER HAS NEVER KEPT UP ANYWHERE THIS HAS RUN. Six stems
 *     come out of the separator in this app — `youtube` proves it — but on a
 *     box with no WebGPU every chunk misses its 1.95 s hop. Nobody has yet seen
 *     six live stems move. docs/evidence/step3-youtube/README.md §3.
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
 *                      IT IS ALSO THE ONE FLAG THAT WIDENS THE `app://` ORIGIN:
 *                      `/gate/` maps `tools/fixture/` only while it is set, so
 *                      `capture-mute`'s RMS worklet can be fetched under this
 *                      origin's `script-src 'self'`. See the ROOTS table.
 *   --gate-probe=NAME  which probe under tools/gate/ that flag runs. Default
 *                      `probe` (the app skeleton, for `shell`); `engine-host`
 *                      drives the engine seam. One flag per QUESTION rather than
 *                      one launch that answers everything: a probe that both
 *                      arms a capture and asserts the window is a probe whose
 *                      failures cannot be told apart.
 *   --update-check     put the update check on the wire during a `--gate` run.
 *   --no-update-check  keep it off during an ordinary run.
 *
 * THE UPDATE CHECK IS OFF BY DEFAULT UNDER `--gate` AND ON OTHERWISE, and the
 * asymmetry is one line with a reason: a gate launch is an automated launch and
 * the five windowed suites must not need a network to be green, while a user's
 * launch is the one PRIVACY.md describes ("on by default, with a visible
 * toggle"). `tools/suites/p1.mjs` is the one gate that opts back IN, and it
 * points the check at a fake host wearing `UPDATE_HOST`'s certificate rather
 * than at a different URL — so the URL under test is the shipping constant.
 */
/**
 * FIRST, AND THE ORDER IS THE POINT — rule P1'. `src/main/netguard.js` installs
 * on import and takes the main process's unobservable transports away (`fetch`,
 * `node:http`/`https`/`net`/`tls`/`dgram`/`http2`), so a request that would
 * bypass the observer in `src/main/sessions.js` throws at the line that wrote
 * it. ESM evaluates a module's dependencies in declaration order, so this line
 * being first is what makes "before any of our code has a body" true.
 * `tools/suites/p1.mjs` asserts the position from the source, and drives a real
 * launch at a real local sink to prove the guard bites.
 */
import './netguard.js';

import { app, BaseWindow, BrowserWindow, WebContentsView, dialog, ipcMain, Menu } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { registerAppSchemeAsPrivileged, installAppProtocol, appUrl } from './protocol.js';
import { createSourceView } from './youtube.js';
import { installCapturePolicy } from './capture.js';
import { createCaptureClaims } from './claims.js';
import { createBus, BUS } from './bus.js';
import { createTransport } from './transport.js';
import { createEngineMessages } from './engine-messages.js';
import { createStorage } from './storage.js';
import { createFileIntake, createPathTokens } from './files.js';
import { installDeckHost, clampDeckHeight } from './deck-host.js';
import { createSessions } from './sessions.js';
import { createUpdateCheck } from './update.js';
import { report as netGuardReport } from './netguard.js';

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
/**
 * THE GATE FLAG IS UNREACHABLE IN A SHIPPED BINARY, not merely unpassed by one.
 *
 * `--gate=DIR` opens the two seams below: the `app://` root that serves
 * `tools/fixture/`, and the dynamic `import()` of `tools/gate/<name>.mjs` where
 * the NAME is `--gate-probe`. `path.basename()` stops traversal there, so the
 * module has to be on disk already — but *"a shipped app that executes a module
 * named on its command line"* is a sentence nobody should be able to write about
 * a product whose whole claim is one named host and no remote code (P1-prime,
 * M1). And once packaging lands, `tools/` is not in the bundle, so the branch
 * would fail confusingly rather than honestly.
 *
 * So the guard is a CONJUNCTION and it is taken ONCE, here: the flag is read
 * only when `!app.isPackaged`. Both seams below stay `if (GATE)` and both are
 * dead in a packaged build — as is any third one somebody adds later, which is
 * why this sits at the definition rather than being repeated at each site.
 *
 * `capture-mute`'s assertion 9 does not match this line as TEXT. It lifts it out
 * of this file and EVALUATES it twice — `app.isPackaged` true, then false — and
 * requires `''` and then the flag's value. Deleting `app.isPackaged` from it is
 * mutation case 13.
 */
const GATE = app.isPackaged ? '' : val('gate', '');
const GATE_PROBE = val('gate-probe', 'probe');
const USER_DATA = val('user-data', '');
/**
 * See the header. `--gate` implies off, because five windowed suites launch this
 * app and none of them should depend on GitHub being reachable; `--update-check`
 * opts back in and is what `tools/suites/p1.mjs` passes.
 */
const UPDATE_CHECK = argv.includes('--update-check')
  || (!GATE && !argv.includes('--no-update-check'));

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

/**
 * WHERE THE 109 MB OF WEIGHTS ARE, and the two branches are never conflated.
 *
 * HOST-DESIGN.md §7.1 chose electron-builder's `extraResources` over
 * `asarUnpack`: both put a plain file on disk, but `asarUnpack` leaves it under
 * `…/app.asar.unpacked/…`, a path derived by string surgery on
 * `app.getAppPath()` that is correct until somebody renames the asar.
 * `process.resourcesPath` is a documented location and the same shape on all
 * three platforms — and it is read ONLY when `app.isPackaged`, because in
 * development it points inside `node_modules/electron/dist`, where the file is
 * never there.
 *
 * In development the file is fetched by `bash tools/vendor-unit.sh --model` and
 * is NOT in git (`.gitignore` excludes `*.onnx`): 114,559,139 bytes at
 * CC BY-NC 4.0, which is the licence that makes this whole product
 * non-commercial (NOTICE.md).
 */
const MODEL_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'model')
  : path.join(APP_ROOT, 'models');

const ROOTS = [
  // Longest prefix wins in `resolveAppPath`, so `/model/` is reachable even
  // though `/` maps the renderer directory.
  { prefix: '/model/', dir: MODEL_DIR },
  { prefix: '/vendor/', dir: path.join(APP_ROOT, 'vendor') },
  { prefix: '/', dir: path.join(APP_ROOT, 'src', 'renderer') },
];

/**
 * THE ONE SEAM THIS PRODUCT OPENS FOR ITS OWN GATE, AND IT IS ASSERTED SHUT.
 *
 * `capture-mute` measures the captured stream with an `AudioWorkletProcessor`
 * (`tools/fixture/rms-worklet.js`) — TEST CODE, which must not be in
 * `src/renderer/` and must not be added to the vendored tree. A worklet module
 * is fetched under `script-src`, and this origin's CSP is `script-src 'self'
 * 'wasm-unsafe-eval'` (`src/main/assets.js`), so a `blob:` module is refused —
 * measured, not assumed: *"Loading the script 'blob:app://workbench/…' violates
 * … script-src 'self' 'wasm-unsafe-eval'"*. `Page.setBypassCSP` over the
 * debugger was tried and does not reach an already-committed document. The
 * remaining honest option is a root that only exists when the gate is running.
 *
 * SO: `/gate/` is added ONLY when `--gate=DIR` is on the command line, which is
 * the same flag that decides whether `tools/gate/<probe>.mjs` is imported at
 * all — and that flag is READ ONLY WHEN `!app.isPackaged` (see `const GATE`
 * above), so a shipped binary cannot be talked into this line by anyone holding
 * a command line. `tools/` is not packaged either, and
 * `tools/suites/capture-mute.mjs`'s assertion 9 scans this file — comments
 * stripped — for exactly two mentions of `tools`, fails if either one is
 * outside an `if (GATE)`, and separately evaluates the `const GATE` line to
 * prove the packaged case is dead.
 *
 * IF THE GUARD IS EVER REMOVED, the product serves its own test fixtures on its
 * own origin. That is why the assertion exists and why it names this line.
 */
if (GATE) ROOTS.push({ prefix: '/gate/', dir: path.join(APP_ROOT, 'tools', 'fixture') });

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
  claims: null,          // the one-shot capture claims (src/main/claims.js)
  transport: null,       // the source view's transport (src/main/transport.js)
  engineMessages: null,  // the three messages the Host owes the engine (§5)
  storage: null,         // the deck's two storage areas (src/main/storage.js)
  pathTokens: null,      // one-shot handles on absolute paths (src/main/files.js)
  files: null,           // the File source's intake: the two pickers, the ask-once folder
  deckHost: null,        // the deck's Host, main-process half (src/main/deck-host.js)
  deckH: DECK_H,         // what the deck last measured itself to be, already clamped
  deckClosed: false,     // `page.close()` — the surface goes, the audio does not
  refusals: [],
  engineBoot: null,      // filled from the engine's own probe, for the chrome bar
  sessions: null,        // the ONE session factory (src/main/sessions.js) — rule P1'
  update: null,          // the one host this app's own code talks to (src/main/update.js)
  /**
   * WHAT `src/main/netguard.js` TOOK, and every refusal it has issued. Read by
   * `tools/gate/p1.mjs`; it is a function rather than a snapshot so the probe
   * reads the ledger AFTER its own control attempts rather than before them.
   */
  netGuard: netGuardReport,
  updateCheck: null,     // the in-flight promise for the boot check, or null
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
    /**
     * WHOSE ANSWER IT IS MATTERS. `deckHost` holds the arm epoch, so the bar
     * follows the SESSION rather than its own last click — a bar that painted
     * "Disarm" over an arm the Host refused would be lying about the one thing
     * this control exists to say. It is read at push time and defaults to false
     * before `installDeckHost()` has run.
     */
    armed: !!(state.deckHost && state.deckHost.armed()),
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
  // `page.close()` takes the deck OFF THE PAGE and the audio does not stop —
  // the engine is a different process and hiding a view cannot reach it. The
  // slot goes to the source view rather than being left as a gap.
  const deckH = state.deckClosed ? 0 : clampDeck(state.deckH);
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
  //
  // EVERY SESSION THIS APP CREATES COMES THROUGH ONE FACTORY, AND THE FACTORY
  // INSTALLS THE P1' OBSERVER AS IT CREATES. `src/main/sessions.js` says why the
  // enumeration has to be closed here rather than reconstructed later: Electron
  // cannot list its own sessions, so a session nobody observed reads exactly
  // like a session that made no requests. `tools/suites/p1.mjs` asserts that no
  // other file in `src/` names a session at all.
  state.sessions = createSessions();
  const ours = state.sessions.makeSession('app', null);
  const theirs = state.sessions.makeSession('youtube', 'persist:youtube');
  state.protocol = installAppProtocol(ours, ROOTS);

  /**
   * THE ONE HOST THIS APP'S OWN CODE TALKS TO. It is built here, on the `app`
   * session, so it goes through Chromium's network stack and therefore past the
   * observer installed above — a check issued with `node:https` would leave the
   * stack entirely and be invisible to the instrument that exists to see it
   * (`src/main/update.js` says so at the call site).
   */
  state.update = createUpdateCheck({ session: ours, enabled: UPDATE_CHECK });

  state.bus = createBus();

  // No address bar and no tabs. The menu is not empty any more: `installDeckHost`
  // below builds ONE that matters — Source -> Arm, whose accelerator is what
  // `armShortcut()` answers with (§6.3) — and it is built there rather than here
  // because the item's `click` is the arm gesture and the chord is read back off
  // the installed item. Until then there is nothing to show.
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

  /**
   * THE TRANSPORT, constructed with the source view and BEFORE anything is
   * loaded into it. The preload announces itself with `{t:'hello'}` at document
   * end, and a listener installed after `load()` would miss the announcement and
   * then poll for a state nobody was going to send.
   *
   * It is an event source in `main`, not a wire to the deck renderer:
   * `src/main/deck-host.js` takes it as an injected dependency and turns it into
   * the `DeckTransport` the deck sees. A Host with no player injects nothing and
   * spells `transport: null`.
   */
  state.transport = createTransport({
    source: () => (state.source && !state.source.webContents.isDestroyed() ? state.source.webContents : null),
    // L1'S RUNTIME WITNESS IS A SUBSCRIPTION NOW, NOT A SECOND LISTENER.
    // `onBeforeRequest` takes ONE listener per session and replaces it silently,
    // so a transport that registered its own would unhook the P1' observer on
    // the partition it shares with it — an instrument going blind with no
    // symptom. The factory owns the registration and fans out.
    sourceRequests: (fn) => state.sessions.onRequest('youtube', fn),
  });
  // A DOCUMENT SETTLED. `hello` already does this from the preload's side; this
  // is the half that survives a preload that failed to run at all, and it is
  // where a re-navigated view gets its config back.
  state.source.webContents.on('did-finish-load', () => state.transport.attach());
  // The same-document half of a single-page app. `main` sees it; the preload
  // cannot, because nothing in the page announces it to an isolated world.
  // It asks for a re-look and does NOT declare a jump: only the preload can tell
  // a replaced element from a re-pointed one, and a jump the page did not make
  // is a model download the user declined.
  state.source.webContents.on('did-navigate-in-page', () => state.transport.relook());

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
  //
  // THREE GATES NOW, NOT TWO. The permission layer refuses everything that is
  // not the engine; the request handler refuses it again; and the CLAIM refuses
  // a request the arm path did not ask for. The third is the one the extension
  // got for free, because there the token WAS the grant — see src/main/claims.js.
  state.claims = createCaptureClaims();
  state.capture = installCapturePolicy(
    ours,
    () => (state.source && !state.source.webContents.isDestroyed() ? state.source.webContents.mainFrame : null),
    (wc) => !!state.engineWin && !state.engineWin.isDestroyed() && wc === state.engineWin.webContents,
    state.claims,
  );

  /**
   * SPENDING A CLAIM — the one ipc channel the engine's Host module needs that
   * is not the bus.
   *
   * ONLY THE ENGINE MAY CALL IT, and the check is on `event.sender` rather than
   * on anything in the message: a channel is reachable from every renderer with
   * a preload that names it, and ours is exposed to the engine alone — which is
   * a fact about a file, not a guarantee. A `code` comes back rather than a
   * throw, so the engine's own `captureStream` produces the sentence the user
   * sees (`shared/host.js`: it must REJECT, never resolve null).
   */
  ipcMain.handle('capture:claim', (event, token) => {
    if (!state.engineWin || state.engineWin.isDestroyed() || event.sender !== state.engineWin.webContents) {
      return { ok: false, code: 'not-the-engine', message: 'only the engine renderer may spend a capture claim' };
    }
    if (typeof token !== 'string' || !token) {
      return { ok: false, code: 'no-token', message: 'a capture claim is a string minted by the arm path' };
    }
    return state.claims.spend(token);
  });

  /**
   * THE THREE MESSAGES THE HOST ORIGINATES TO THE ENGINE. `source` is read at
   * CALL time — a captured `WebContents` would be a stale one the first time the
   * view is recreated.
   */
  state.engineMessages = createEngineMessages({
    bus: state.bus,
    claims: state.claims,
    source: () => (state.source && !state.source.webContents.isDestroyed() ? state.source.webContents : null),
  });

  // ------------------------------------------------------------- addresses
  // Assigned by main, never claimed by a renderer.
  state.bus.register(BUS.engine, state.engineWin.webContents);
  state.bus.register(BUS.deck, state.deck.webContents);

  /**
   * THE DECK'S HOST, main-process half. It owes the deck fourteen members
   * through `vendor/…/ui/host.js`, three messages nothing can check for it
   * (SESSION, ARM_ERROR, ARM_ERROR_CLEARED), an answer to each of the six
   * `SW_*` the deck boots by polling for, and the autoplay-next wire that a
   * Host which implements every duty still ships dead.
   *
   * INSTALLED BEFORE THE DECK IS LOADED, and that ordering is not cosmetic: the
   * deck's preload asks `deck:profile` SYNCHRONOUSLY for whether there is a
   * player above it, and `ui/embed.js` reads the answer at module scope. A
   * handler registered after `loadURL` would leave that `sendSync` unanswered.
   *
   * THE TRANSPORT IS PASSED, NEVER IMPORTED. `src/main/transport.js` owns the
   * source view; this is where its five reports and six verbs become the six
   * `DeckTransport` duties and the two `DeckPage` duties a player is the source
   * of. A Host with no player passes `transport: null` — spelled, never omitted.
   */
  state.storage = createStorage({ dir: app.getPath('userData') });
  state.deckHost = installDeckHost({
    storage: state.storage,
    bus: state.bus,
    deck: () => (state.deck && !state.deck.webContents.isDestroyed() ? state.deck.webContents : null),
    chrome: () => (state.chrome && !state.chrome.webContents.isDestroyed() ? state.chrome.webContents : null),
    source: () => (state.source && !state.source.webContents.isDestroyed() ? state.source.webContents : null),
    transport: state.transport,
    /**
     * THE ONE SOURCE KIND THIS BUILD HAS. Spelled rather than defaulted, because
     * `installDeckHost` refuses an unspelled one: the deck asks once at boot and
     * a kind nobody decided is a kind it has no branch for. A File source makes
     * this `'file'`, and that is a DIFFERENT question from `transport` — a File
     * source is not hosted by somebody else's player and still has a transport
     * of its own (docs/HOST-DESIGN.md §3.3b).
     */
    sourceKind: 'live',
    engine: state.engineMessages,
    /**
     * The engine window is created in `boot()` and nothing in this wave tears it
     * down, so "ensure" is already true — but it THROWS rather than resolving if
     * the window has gone, because the deck's boot poll asks twenty times and a
     * silent `undefined` would make an engine that died look like one that was
     * never asked for. Recreating it is the engine slice's, not this line's.
     */
    ensureEngine: () => {
      if (state.engineWin && !state.engineWin.isDestroyed()) return;
      throw new Error('the engine window is gone, and this wave cannot recreate it');
    },
    onHeight: (px) => { state.deckH = clampDeckHeight(px); layout(); },
    onClose: () => {
      state.deckClosed = true;
      state.deck.setVisible(false);
      layout();
      pushStatus();
    },
  });

  /**
   * THE FILE INTAKE, and `dialog` is handed to it rather than imported by it.
   *
   * `src/main/files.js` keeps no `electron` import for `claims.js`'s reason —
   * its allowlist, its title derivation and its path tokens are worth asserting
   * in plain node. THIS IS THE ONE PLACE AN INTAKE IS BUILT, and it is built
   * over electron's own `dialog`: `tools/suites/export.mjs` asserts exactly that
   * (`files.usesDialog()`) before it counts anything, because a dialog count is
   * only a fact about this app if the picker it counts is the real one.
   *
   * THE STORAGE IS PASSED, NEVER IMPORTED, like the transport above it: the
   * export folder is a preference and lives in the `local` area, which is the
   * half of `src/main/storage.js` that survives a restart.
   *
   * NOTHING A USER CAN PRESS REACHES IT YET. The chrome bar's File controls and
   * the export writer are both later slices. That absence is named here rather
   * than left to be discovered, because this file has shipped the opposite
   * mistake — an Arm button that was `disabled` for a whole wave after arming
   * worked (`src/renderer/chrome.js`'s header). An intake with no control is
   * incomplete; a control with no outcome is a defect.
   */
  state.pathTokens = createPathTokens();
  state.files = createFileIntake({
    dialog,
    window: () => state.win,
    storage: state.storage,
    tokens: state.pathTokens,
  });

  // Only the chrome view may ask for a status push. Nothing else has the
  // channel, and an address is not something a renderer gets to claim.
  ipcMain.on('chrome:ready', (event) => {
    if (state.chrome && event.sender === state.chrome.webContents) pushStatus();
  });

  /**
   * THE ARM GESTURE FROM OUR OWN BAR — HOST-DESIGN.md §6.4's primary surface.
   *
   * IT IS THE SAME FUNCTION THE MENU ITEM CALLS, not a second path to the same
   * idea: `deckHost.arm()` mints the epoch, clears a stale refusal and sends
   * SESSION, and a bar that re-implemented any of that would be a second arm
   * gesture with its own bugs. `smoke` clicks BOTH and asserts they land on the
   * same epoch.
   *
   * THE SENDER IS CHECKED, like every other channel in this file: a channel is
   * reachable from any renderer whose preload names it, and arming decides that
   * this app may open a capture on the source view.
   */
  ipcMain.handle('chrome:arm', (event, on) => {
    if (!state.chrome || event.sender !== state.chrome.webContents) {
      return { ok: false, armed: !!(state.deckHost && state.deckHost.armed()), kind: 'not-the-bar',
        message: 'only the chrome bar may send the arm gesture' };
    }
    if (!state.deckHost) {
      return { ok: false, armed: false, kind: 'no-host', message: 'the deck Host is not installed yet' };
    }
    const r = on === true ? state.deckHost.arm() : state.deckHost.disarm();
    return { ...r, armed: state.deckHost.armed() };
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

  /**
   * AFTER THE WINDOW IS UP AND NOT AWAITED. The update check is the least
   * important thing this app does; it must never be on the path between a
   * double click and a window, and it must never be able to fail a boot. It
   * resolves on failure rather than rejecting (see `createUpdateCheck`), so the
   * `.catch` here is belt to that.
   */
  state.updateCheck = UPDATE_CHECK ? state.update.check().catch(() => null) : null;

  console.log(`[main] ready · source=${state.source.webContents.getURL()} · deck=${deckUrl} `
    + `· engine coi=${state.engineBoot && state.engineBoot.coi} sab=${state.engineBoot && state.engineBoot.sab}`);

  return state;
}

// ---------------------------------------------------------------- lifecycle
app.whenReady().then(async () => {
  await boot();

  if (GATE) {
    // Imported ONLY here. The product's module graph does not contain its own
    // gate, `tools/` is not packaged, and GATE is '' in a packaged build, so the
    // user-supplied NAME below is unreachable in a shipped binary — the point of
    // the `app.isPackaged` conjunction at `const GATE`. `path.basename()` stops
    // traversal on top of that. WHICH probe is `--gate-probe`: one
    // module per QUESTION, because a probe that both measured the window and
    // armed a capture would have failures nobody could tell apart.
    const file = path.join(APP_ROOT, 'tools', 'gate', `${path.basename(GATE_PROBE)}.mjs`);
    const probe = await import(pathToFileURL(file).href);
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
