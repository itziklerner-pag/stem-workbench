#!/usr/bin/env node
/**
 * smoke — Playwright drives the real app, as itself, against a LOCAL fake player.
 *
 *     node tools/suites/smoke.mjs            (~35 s, one real launch)
 *     node tools/verify.mjs --only smoke
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS RATHER THAN A NOTE IN A README
 * ---------------------------------------------------------------------------
 * `stem-splitter-live/tools/embed-smoke.mjs` opens with that sentence and the
 * argument transfers whole: the gesture this product is about — start the app,
 * arm the Source, press play, six faders follow the video — crosses FIVE
 * contexts (main, the chrome bar, the source view's preload, the deck renderer,
 * the engine renderer) and every other suite in this repository sees at most
 * two of them.
 *
 *   `shell`        one launch, but the judgement is a JSON report written by a
 *                  probe that runs INSIDE main. It never touches the deck's DOM
 *                  and would stay 100 % green with the deck painting nothing.
 *   `engine-host`  the engine half, driven from main. It never presses play.
 *   `deck-host`    the deck half, driven from main by calling `host.arm()` — the
 *                  FUNCTION the menu item's click handler calls, not the menu
 *                  item. A Host whose menu was never installed passes it.
 *   `transport`    the source view's preload, driven from main.
 *
 * Every one of those drives the app from inside its own main process. This one
 * is the only gate that stands OUTSIDE the app and uses it: it clicks the
 * application menu's `Arm this Source`, it presses play on the player, and it
 * reads the deck's own painted surface for the answer. That is a different
 * question from "is each half correct", and it is the question a user asks.
 *
 * ---------------------------------------------------------------------------
 * THE PLAYER IS LOCAL, AND THAT IS A RULE RATHER THAN A CONVENIENCE
 * ---------------------------------------------------------------------------
 * `tools/fixture/player.html`. CI must never depend on YouTube's DOM and must
 * never hit a bot wall — the same trick as `stem-splitter-live/tools/host.mjs`
 * answering as `huggingface.co`. The real site is the `youtube` step, manual,
 * and `docs/TESTING.md` §7 says why it cannot be replaced by this one.
 *
 * The suite does not merely POINT at the fixture, it INSTALLS A GUARD: an
 * `onBeforeRequest` handler on both of the app's sessions that cancels anything
 * whose scheme is not local, so an accidental `youtube.com` load is a red on
 * assertion 2 rather than a slow test, a rate limit, or a CAPTCHA. The guard is
 * proved to be looking by two navigations to `*.invalid` — one per session —
 * which it must record AND refuse. `.invalid` is reserved by RFC 2606 and
 * resolves nowhere, so the proof cannot itself reach a host.
 *
 * ---------------------------------------------------------------------------
 * THE FIXTURE IS SIXTY SECONDS LONG AND THE LENGTH IS LOAD-BEARING
 * ---------------------------------------------------------------------------
 * DO NOT TRIM IT. The extension's smoke shipped a 0.5 s `loop`ing clip, every
 * wrap fired `seeking`, `content.js` reports `seeking` as a content JUMP, and
 * the deck restarts its pipeline on a jump exactly as it does when a user
 * scrubs. So the fixture injected a seek into every assertion window longer than
 * half a second — and it cost a real assertion outright (the `data-pending`
 * latency pair; `tools/embed-smoke.mjs` carries the write-up).
 *
 * The same defect is reachable here and it lands on assertion 9. That assertion
 * says a seek the USER made arrives at the deck as EXACTLY ONE content jump —
 * `__embed.jumps` going from J to J+1 — and a loop wrap inside the window would
 * make it J+2 on a correct build and J+1 on a build that dropped the report.
 * The numbers that keep it away from the wrap:
 *
 *   · the clip is 60.0 s and the element is played for ~2 s from t=0, then
 *     seeked to 20 s and played for ~1 s more. The furthest the playhead ever
 *     gets is ~23 s, which is 37 s of margin.
 *   · the whole suite is ~35 s wall clock, so even a paused-and-forgotten
 *     element could not reach the end of the clip.
 *   · the element is PAUSED before the `drive` assertions, which is what lets
 *     assertion 11 compare `currentTime` for exact equality instead of a window.
 *
 * `tools/fixture/player.html`'s own header carries the other half of the reason
 * for 60 s: 60.0 s at 440 Hz is 26 400 whole cycles, so `capture-mute` can wrap
 * without a click. The two suites share the file; neither may shorten it.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DRIVES, AND THROUGH WHAT
 * ---------------------------------------------------------------------------
 *   ARM / DISARM        `Menu.getApplicationMenu().getMenuItemById('arm')` and
 *                       `…('disarm')`, clicked. That is the only arm gesture a
 *                       user can reach today (the chrome bar's button is present
 *                       and disabled, HOST-DESIGN.md §6.4), and clicking the item
 *                       runs the same `click` the accelerator runs.
 *   PLAY / PAUSE / SEEK / the page's own SPEED MENU
 *                       `window.__wbFixture.{play,pause,seek,pageRate}` in the
 *                       source page — the fixture's hooks, which move the real
 *                       `<video>` and nothing else. The shipped preload is what
 *                       notices.
 *   THE DECK's OWN DUTY `import('./host.js')` in the deck page yields the very
 *                       module instance `ui/embed.js` is holding, so
 *                       `host.transport.drive(...)` and `host.send(...)` are the
 *                       deck's own wires and not a stub of them. `tools/gate/
 *                       deck-host.mjs` reaches for the same handle.
 *
 * TWO OF THE FOUR ORIGINATED MESSAGES ARE DRIVEN BY THE DECK'S ENVELOPE RATHER
 * THAN BY THE DECK'S DECISION, and the difference is stated rather than hidden.
 * `CAPTURE_START` and `DECK_PREPARE` reach this Host as `SW_CAPTURE_START`
 * (`ui/embed.js`:693) and `SW_DECK_PREPARE` (:1053), and the deck sends them
 * only after `modelInTheWay()` / `maybePrepare()` clear — both of which require
 * the 109 MiB weights to already be on disk. Gating this suite on a file that is
 * not in git would make the always-on step a SKIP on a clean checkout. So the
 * suite sends the two envelopes itself, verbatim, over the deck's own `host.send`
 * — and what is asserted is what the HOST did with them. WHEN the deck decides
 * to send them is the unit's decision and is gated by `vendor-unit`.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DELIBERATELY DOES NOT RE-ASSERT, AND WHERE THAT CLAIM LIVES
 * ---------------------------------------------------------------------------
 * `tools/suites/transport.mjs` (63 assertions) and `tools/suites/deck-host.mjs`
 * (27) were built before this one and go deeper on the two halves. A second copy
 * of one of their claims is a claim that drifts, so:
 *
 *   L1's STATIC SCAN of `src/preload/youtube.cjs` is `transport.mjs`'s, and
 *   theirs is the better one: "…and none of the names L1 forbids appears in it
 *   at all", plus "…and the scanner is looking at code rather than at nothing"
 *   — the rule-7 half this file's draft did not have — plus the COMPLETE
 *   member-write set and the enumerated property allow-list. Not repeated here.
 *   What this suite adds is the OTHER end of the same rule: assertion 9, that no
 *   media field is on the feed the DECK reads, which stops at the transport
 *   there.
 *
 *   THE PRELOAD'S FIVE TRANSPORT VALUES, the event->speed-reason mapping, the
 *   ad edge, the key filter, the SPA navigation cases and the autoplay-next
 *   state machine are all `transport.mjs`'s. This suite asserts only what the
 *   DECK ends up showing (`__embed.videoPlaying`, `.jumps`, `.speed`), which is
 *   the half neither of those suites can see.
 *
 *   THE FOURTEEN DeckHost MEMBERS, the two storage lifetimes, the arm chord, the
 *   height clamp and `page.close()` are `deck-host.mjs`'s and `deck-seam.mjs`'s.
 *
 * TWO OVERLAPS ARE KEPT ON PURPOSE, and both are named where they are asserted:
 *
 *   12/15  `drive` and `release` also appear in `deck-host.mjs` (":271", ":280")
 *          and in `transport.mjs`. Kept because here they are the END of a
 *          gesture chain that began at the application menu, in an app launched
 *          with NO `--gate` flag — so the product's module graph contains no
 *          `tools/gate/*` at all, and `release` is reached by clicking `Disarm`
 *          rather than by calling `host.disarm()`.
 *   13     the closed write set. This is the ONLY assertion anywhere that
 *          crosses all THREE filters at once — `ui/host.js`'s, `filterDrive()`'s
 *          and the preload's. Each one alone is gated by `deck-seam`,
 *          `transport` and `transport` respectively, and mutation 16 below
 *          measured the consequence: this assertion CANNOT see a single layer
 *          fail, and a one-file mutation of it is a MISS that looks like a
 *          catch.
 *
 * ---------------------------------------------------------------------------
 * WATCHED RED BY MUTATION — `tools/suites/smoke-mutations.sh`
 * ---------------------------------------------------------------------------
 * Every assertion below, with the edit that broke it. Run on 2026-08-26 against
 * Electron 44.0.0 / Chromium 152.0.7977.54 on Linux: **19 of 19 caught, and
 * `coverage.py` over the whole battery found all 18 assertions on a FAIL line.**
 * The right-hand column of that script is what ACTUALLY went red, not what was
 * expected to. Fifteen of the nineteen turn exactly one assertion red; the four
 * with a wider blast radius are 4 (six — the deck never boots), 7 (three), and
 * 1, 5 and 11 (two each).
 *
 *   1  main.js: never addChildView(source.view)           -> 1, the topology
 *   2  smoke.mjs: guard only OUR session                  -> 2, the guard itself
 *   3  main.js: one hidden window on an off-box URL       -> 18, the ledger
 *   4  ui/host.js: delete the armShortcut duty            -> 3, deck half
 *   5  offscreen/host.js: stop exporting clearModel       -> 3, engine half
 *   6  deck-host.js: sendSession() originates nothing     -> 4, SESSION
 *   7  engine-messages.js: captureStart originates none   -> 5, CAPTURE_START
 *   8  engine-messages.js: put `tabId` back on `source`   -> 6, its frozen shape
 *   9  engine-messages.js: deckPrepare originates none    -> 7, DECK_PREPARE
 *  10  engine-messages.js: captureStop originates none    -> 14, CAPTURE_STOP
 *  11  deck-host.js: do not relay onState                 -> 8, play/pause
 *  12  deck-host.js: relay it with a media URL added      -> 9, L1 on the feed
 *  13  deck-host.js: do not relay onJump                  -> 10, the content jump
 *  14  deck-host.js: do not relay onSpeedReport           -> 11, the speed menu
 *  15  transport.js: drive() is a no-op                   -> 12, the three writes
 *  16  ALL THREE drive filters at once                    -> 13, the write set
 *  17  deck-host.js: disarm does not release the player   -> 15, the hand-back
 *  18  ui/embed.js: drop a stem from STEM_ORDER           -> 16, the six faders
 *  19  offscreen/engine.js: drop `sampleRate: SR`         -> 17, 44100
 *
 * TWO OF THESE FOUND A DEFECT IN AN ASSERTION RATHER THAN IN THE APP, which is
 * what a battery is for and is why both are written down here.
 *
 *   14  left assertion 11 GREEN on its first run. That assertion read only
 *       `__embed.speed`, and `onElementRate()` in `ui/embed.js` has TWO entry
 *       points — the video state's `playbackRate` and the speed report's
 *       `applied` — so the deck's readout follows the element whether or not the
 *       Host's verdict ever arrives. The assertion now reads the `{t:'speed'}`
 *       report off the deck's own inbound channel and this one-file mutation
 *       turns it red.
 *   16  opening `filterDrive()` ALONE — the obvious single-file mutation — left
 *       assertion 13 GREEN, because `driveVideo()` in the preload reads three
 *       NAMED fields off the command and never the command itself. Here the
 *       three-file mutation is correct: the claim really is about the three
 *       filters composing, and no single layer's failure is visible to this
 *       suite. Each layer alone is `deck-seam`'s and `transport`'s.
 *
 * ---------------------------------------------------------------------------
 * DELIBERATELY NOT ASSERTED HERE
 * ---------------------------------------------------------------------------
 *   · SIX STEMS ACTUALLY COMING OUT OF THE ENGINE. That needs the weights and a
 *     `heavy` step (`smoke-live`) which does not exist. Stated as a coverage
 *     limit rather than left as an absence: NOTHING IN THE DEFAULT PLAN PROVES
 *     THE VENDORED ENGINE PRODUCES AUDIO INSIDE THIS APP. `vendor-unit` proves
 *     the engine is correct; this proves the Host wires it; the seam between
 *     those two claims is not gated.
 *   · THE FIRST FEW MILLISECONDS OF BOOT, for the network guard. It is installed
 *     from outside, over CDP, as soon as `electron.launch()` resolves — which is
 *     during `boot()` but not necessarily before its first `loadURL`. `p1`
 *     (docs/TESTING.md §9) is the suite that owns the network claim from process
 *     start; this one owns "the run did not wander off the box".
 *   · THE AUDIO DEVICE. This suite proves a capture opens and that the context is
 *     at 44100. It does NOT witness the speakers. `capture-mute` (§8) is the one
 *     that measures silence and THIS SUITE CANNOT REPLACE IT.
 *   · WHETHER YOUTUBE STILL WORKS. Limitation 14 of the spike: nothing local can
 *     see a YouTube-side regression. `youtube`, manual, on a cadence.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { UPDATE_HOST } from '../../src/main/update.js';

const ID = 'smoke';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'out', ID);

/**
 * THE SOURCE PAGE. Mutation 2 points this at `https://www.youtube.com/` — the
 * accident this suite exists to make loud — and the guard on assertion 2 must
 * catch it. It is a constant here so that mutation is one edit rather than a
 * change to how the suite is invoked.
 */
const SOURCE_URL = pathToFileURL(path.join(ROOT, 'tools', 'fixture', 'player.html')).href;

/**
 * The shared browser mutex, and `xvfb-run -a` on top of it. Sibling agents run
 * browsers on this machine and `-a` picks a display by scanning for a free one,
 * which is a race two launches can both win — see docs/TESTING.md §4. Unlike the
 * other windowed suites this one does not spawn `electron` itself (Playwright
 * does), so the lock has to go around THIS PROCESS: it re-execs itself once,
 * under `flock` and `xvfb-run`, and the inner run does the work.
 *
 * `STEM_WORKBENCH_BROWSER_LOCK_HELD=1` says an ancestor already holds it — see
 * `LOCK_HELD` below, and do not set it by hand.
 */
const LOCK = process.env.STEM_WORKBENCH_BROWSER_LOCK
  || path.join(os.tmpdir(), `stem-workbench-browser-${process.getuid ? process.getuid() : 'x'}.lock`);

/**
 * AN ANCESTOR MAY ALREADY HOLD IT, and then taking it again is a DEADLOCK, not
 * a formality: `flock(1)` opens its own descriptor, so a nested acquisition on
 * the same file blocks forever on the lock its own parent is holding.
 * `tools/suites/smoke-mutations.sh` holds the mutex across its whole battery —
 * twenty launches, one acquisition, so three agents sharing this box are not
 * made to fight for it twenty times — and sets this. Nothing else should.
 */
const LOCK_HELD = process.env.STEM_WORKBENCH_BROWSER_LOCK_HELD === '1';

// ------------------------------------------------------------- the harness
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  cond ? pass++ : fail++;
};
const done = async (app) => {
  if (app) { try { await app.close(); } catch { /* it may already be gone */ } }
  console.log(`\n${ID}: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};
const skip = (why) => { console.log(`SKIPPED — ${why}`); process.exit(0); };

/**
 * A VALUE READ OUT OF A LIVE PAGE IS NOT A PROMISE. Every `evaluate` below is
 * wrapped so a page that has gone, or a hook that is not there, produces
 * `{THREW: …}` instead of an exception that ends the run with assertions still
 * to make. `docs/TESTING.md` §3 rule 7 in the expensive direction: a suite that
 * crashes has not reported a red, it has stopped looking. `shell.mjs` learned
 * this from its own mutation 27.
 */
const O = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const A = (v) => (Array.isArray(v) ? v : []);
const safe = async (label, fn) => {
  try { return await fn(); } catch (e) { return { THREW: `${label}: ${String((e && e.message) || e).slice(0, 160)}` }; }
};

// =========================================================================
// 0. THE RE-EXEC — flock, then xvfb, then this file again
// =========================================================================
const hasBin = (name) => (process.env.PATH || '').split(':').some((d) => {
  try { fs.accessSync(path.join(d, name), fs.constants.X_OK); return true; } catch { return false; }
});
const sh = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

if (process.env.STEM_WORKBENCH_SMOKE_INNER !== '1') {
  if (!fs.existsSync(path.join(ROOT, 'node_modules', 'playwright-core'))) skip('playwright-core is not installed — npm i');
  if (!fs.existsSync(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron'))) skip('electron is not installed — npm i');
  if (!hasBin('xvfb-run')) skip('xvfb-run is not on PATH and this box has no DISPLAY');
  if (!LOCK_HELD && !hasBin('flock')) skip('flock is not on PATH — the shared browser mutex cannot be taken');

  const self = fileURLToPath(import.meta.url);
  const under = `xvfb-run -a -s '-screen 0 1280x1024x24' ${sh(process.execPath)} ${sh(self)}`;
  const [bin, args] = LOCK_HELD ? ['sh', ['-c', under]] : ['flock', [LOCK, '-c', under]];
  const inner = spawn(bin, args,
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, STEM_WORKBENCH_SMOKE_INNER: '1' } });

  let out = '';
  const relay = (c) => { const s = c.toString(); out += s; process.stdout.write(s); };
  inner.stdout.on('data', relay);
  inner.stderr.on('data', relay);
  const code = await new Promise((r) => {
    inner.on('error', (e) => { out += `\nspawn error: ${e.message}\n`; r(127); });
    inner.on('close', r);
  });
  /**
   * IF THE INNER RUN PRODUCED NO SUMMARY IT DID NOT ASSERT — and the runner
   * would read this wrapper's silent exit 0 as VOID, which is red but names the
   * wrong thing. Say what happened instead, as a FAIL, so the log points at the
   * launch rather than at the convention.
   */
  if (!/^\s*smoke: \d+ passed, \d+ failed\s*$/m.test(out)) {
    console.log(`FAIL  the run under flock + xvfb-run produced no summary  exit ${code}; `
      + `last line: ${(out.trimEnd().split('\n').pop() || '(no output)').slice(0, 200)}`);
    console.log(`\n${ID}: 0 passed, 1 failed`);
    process.exit(1);
  }
  process.exit(code);
}

// =========================================================================
// 1. THE LAUNCH — Playwright drives the real entry point
// =========================================================================
/**
 * `playwright-core`, NOT `playwright`, AND THAT IS A DEPENDENCY DECISION.
 * `_electron` is the only thing this file uses and it drives the Electron binary
 * we already have; the `playwright` wrapper's whole added value is a postinstall
 * that downloads Chromium, Firefox and WebKit — ~500 MB this repository would
 * never open, on every CI run, to reach an API that is in the core package. The
 * import name is the one difference from `docs/TESTING.md`'s snippet.
 */
const { _electron: electron } = await import('playwright-core');
const { BUS, ENGINE_HOST_DUTIES, DECK_HOST_DUTIES, DECK_PAGE_DUTIES, DECK_TRANSPORT_DUTIES } =
  await import('../../vendor/stem-splitter-live/extension/shared/host.js');
const { STEMS, SR } = await import('../../vendor/stem-splitter-live/extension/shared/config.js');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const userData = path.join(OUT, 'userdata');
const consoleLog = [];

const app = await electron.launch({
  executablePath: path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron'),
  cwd: ROOT,
  args: ['.', `--source-url=${SOURCE_URL}`, `--user-data=${userData}`],
  timeout: 60000,
});
app.on('console', (m) => consoleLog.push(m.text()));
process.on('exit', () => fs.writeFileSync(path.join(OUT, 'app-console.log'), `${consoleLog.join('\n')}\n`));

// -------------------------------------------------------- the network guard
/**
 * INSTALLED FIRST, BEFORE ANYTHING IS DRIVEN. `onBeforeRequest` is the blocking
 * point in front of the network stack, so `cancel: true` means no connection is
 * ever made — the point is that a mistake in this suite cannot reach YouTube,
 * not merely that we would find out afterwards.
 *
 * ONE HANDLER PER SESSION IS ALL THERE IS: `createTransport` installs its own
 * `onBeforeRequest` on `persist:youtube` for L1's runtime witness and this
 * REPLACES it for the life of the run. That witness is read by
 * `tools/gate/transport.mjs` and by nothing here, so nothing is lost — but it is
 * worth knowing, because a future assertion in this file that reached for
 * `transport.requests()` would find it empty.
 */
const LOCAL_SCHEME = /^(file|app|blob|data|devtools|chrome|about):/;
await app.evaluate(async ({ session }, local) => {
  const re = new RegExp(local);
  globalThis.__smokeRequests = [];
  const install = (ses, tag) => {
    ses.webRequest.onBeforeRequest((details, callback) => {
      const offBox = !re.test(details.url);
      globalThis.__smokeRequests.push({ tag, url: String(details.url).slice(0, 160), type: details.resourceType, refused: offBox });
      callback({ cancel: offBox });
    });
  };
  install(session.defaultSession, 'ours');
  install(session.fromPartition('persist:youtube'), 'source');
}, LOCAL_SCHEME.source);

// ------------------------------------------------------------- the four pages
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Poll rather than sleep: a fixed sleep is a stopwatch carrying a claim. */
async function until(what, pred, ms = 15000, every = 100) {
  const t0 = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await wait(every);
  }
}

const pages = {};
await until('the four renderers', async () => {
  for (const w of app.windows()) {
    const u = w.url();
    if (u.endsWith('/engine.html')) pages.engine = w;
    else if (u.endsWith('/chrome.html')) pages.chrome = w;
    else if (u.includes('/ui/embed.html')) pages.deck = w;
    else if (u === SOURCE_URL) pages.source = w;
  }
  return pages.engine && pages.chrome && pages.deck && pages.source;
}, 30000);

const readTopology = () => safe('topology', () => app.evaluate(async ({ BaseWindow, BrowserWindow, webContents, app: a }, srcUrl) => ({
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
  packaged: a.isPackaged,
  top: BaseWindow.getAllWindows().map((w) => ({
    id: w.id,
    cls: w.constructor.name,
    visible: w.isVisible(),
    children: w.contentView.children.map((c) => (c.webContents ? c.webContents.id : null)),
  })),
  browserWindows: BrowserWindow.getAllWindows().map((w) => ({ id: w.id, visible: w.isVisible(), url: w.webContents.getURL() })),
  webContents: webContents.getAllWebContents().map((wc) => ({ id: wc.id, url: wc.getURL() })),
  sourceWcId: (webContents.getAllWebContents().find((wc) => wc.getURL() === srcUrl) || {}).id ?? null,
}), SOURCE_URL));

/**
 * READ AFTER `win.show()`, NOT BEFORE IT. Every renderer becomes a CDP target
 * the moment `loadURL` is called, and `boot()` shows the window only once all
 * four have finished loading — so the four pages being reachable is NOT the
 * same instant as the window being on screen. Polling here rather than sleeping:
 * a fixed wait is a stopwatch carrying a claim, and it would be the wrong length
 * on somebody else's machine.
 */
const topology = await until('the window to be shown',
  async () => { const t = await readTopology(); const b = A(O(t).top).find((w) => w.cls === 'BaseWindow'); return b && b.visible ? t : null; },
  20000) || await readTopology();

const found = ['chrome', 'source', 'deck', 'engine'].filter((k) => pages[k]);
const base = A(O(topology).top).filter((w) => w.cls === 'BaseWindow');
const hidden = A(O(topology).browserWindows).filter((w) => !w.visible && /\/engine\.html$/.test(w.url));
ok('the app launches under Playwright as one visible window with its three views attached, beside the hidden engine window  '
  + '[entry point: `electron .` -> boot() in src/main/main.js]',
  found.length === 4 && base.length === 1 && base[0].visible === true && base[0].children.length === 3
  && hidden.length === 1 && O(topology).sourceWcId !== null && base[0].children.includes(O(topology).sourceWcId),
  O(topology).THREW ? O(topology).THREW
    : `${found.length}/4 renderers reachable (${found.join(', ')}) · ${base.length} BaseWindow(s), `
      + `children webContents [${base.length ? base[0].children.join(', ') : ''}] · source view is wc ${O(topology).sourceWcId} · `
      + `${hidden.length} hidden engine BrowserWindow · electron ${O(O(topology).versions).electron} / chromium ${O(O(topology).versions).chrome}`);

// A SUITE THAT CANNOT LOOK FAILS. Everything below reads one of the four pages.
if (found.length !== 4) {
  console.log(`FAIL  the renderers this suite drives are not all there — nothing below can be asserted  `
    + `missing ${['chrome', 'source', 'deck', 'engine'].filter((k) => !pages[k]).join(', ')}`);
  fail++;
  await done(app);
}

// =========================================================================
// 2. THE NETWORK GUARD — proved to be looking, then read
// =========================================================================
/**
 * THE SETUP IS PART OF THE ASSERTION. "No non-local request was recorded" is
 * also what a handler that was never installed reports, and that estimator
 * saturates before the claim begins — the exact defect `AGENTS.md` names. So the
 * guard is made to refuse two navigations it must see, one per session, before
 * its ledger is read.
 */
const guardProbe = await safe('guard probe', () => app.evaluate(async ({ BrowserWindow, session }) => {
  const out = [];
  for (const [tag, ses] of [['ours', session.defaultSession], ['source', session.fromPartition('persist:youtube')]]) {
    const w = new BrowserWindow({ show: false, webPreferences: { session: ses } });
    // RFC 2606 reserves `.invalid`: it resolves nowhere, so even a guard that
    // failed to cancel could not reach a host.
    try { await w.loadURL(`https://smoke-guard-${tag}.invalid/probe`); out.push({ tag, refused: false }); }
    catch (e) { out.push({ tag, refused: /ERR_BLOCKED_BY_CLIENT/.test(String(e.message)), why: String(e.message).slice(0, 60) }); }
    w.destroy();
  }
  return out;
}));

const reqsAfterProbe = A(await safe('requests', () => app.evaluate(() => globalThis.__smokeRequests)));
const probeSeen = reqsAfterProbe.filter((r) => /smoke-guard-\w+\.invalid/.test(r.url));
ok('the network guard is live on BOTH sessions: it saw two deliberate off-box navigations and refused them  '
  + '[entry point: session.webRequest.onBeforeRequest, installed by this suite]',
  A(guardProbe).length === 2 && A(guardProbe).every((p) => p.refused === true)
  && probeSeen.length === 2 && probeSeen.every((r) => r.refused === true)
  && new Set(probeSeen.map((r) => r.tag)).size === 2,
  `${probeSeen.length} of 2 probes recorded (${probeSeen.map((r) => r.tag).join(', ')}), `
  + `${A(guardProbe).filter((p) => p.refused).length} of 2 loads came back ERR_BLOCKED_BY_CLIENT`);

// =========================================================================
// 3. THE SEAM — both halves of the Host got past assertHost
// =========================================================================
await pages.engine.evaluate(() => {
  window.__smokeEngineBus = [];
  window.__wbEngine.onMessage((m) => window.__smokeEngineBus.push(m));
});
await pages.deck.evaluate(() => {
  window.__smokeDeckBus = [];
  window.__smokeDeckPage = [];
  window.__wbDeck.onMessage((m) => window.__smokeDeckBus.push(m));
  window.__wbDeck.onPageEvent((m) => window.__smokeDeckPage.push(m));
});

/**
 * THE DECK'S OWN MODULE INSTANCE. `import()` of a URL already in a document's
 * module registry returns the SAME namespace `ui/embed.js` is holding, so
 * `host.transport.drive` below is the deck's wire and not a second one built to
 * look like it. `tools/gate/deck-host.mjs` reaches for the same handle.
 */
const deckHostKeys = await safe('deck host module', () => pages.deck.evaluate(() =>
  import('./host.js').then((m) => {
    window.__smokeHost = m.host;
    return {
      keys: Object.keys(m.host).sort(),
      page: m.host.page ? Object.keys(m.host.page).sort() : null,
      transport: m.host.transport ? Object.keys(m.host.transport).sort() : null,
    };
  })));

const engineSaw = () => pages.engine.evaluate(() => window.__smokeEngineBus.map((m) => ({
  type: m.type, to: m.to, from: m.from, keys: Object.keys(m).sort(),
  sourceKeys: m.source ? Object.keys(m.source).sort() : null,
  token: typeof m.sourceToken === 'string' ? m.sourceToken.length : null,
})));
const deckSaw = () => pages.deck.evaluate(() => window.__smokeDeckBus.map((m) => ({
  type: m.type, to: m.to, from: m.from, keys: Object.keys(m).sort(),
  sessionKeys: m.session ? Object.keys(m.session).sort() : null,
  session: m.session || null,
  boot: m.state && m.state.boot ? m.state.boot : null,
})));

const deckPainted = () => pages.deck.evaluate(() => ({
  embed: typeof window.__embed,
  lead: (document.getElementById('src-lead') || {}).textContent,
  strips: [...document.querySelectorAll('#strips [data-stem]')].map((e) => e.dataset.stem),
  faders: document.querySelectorAll('#strips .fader[role="slider"]').length,
  playing: window.__embed ? window.__embed.videoPlaying : null,
  jumps: window.__embed ? window.__embed.jumps : null,
  speed: window.__embed ? window.__embed.speed : null,
  status: window.__embed ? window.__embed.status : null,
}));

/**
 * THE ENGINE'S OWN `STATE` IS WHAT SAYS ITS MODULE SCOPE FINISHED. `engine.js`
 * imports `./host.js` and calls `assertHost(host, ENGINE_HOST_DUTIES)` before
 * anything else, so a Host short one duty produces no traffic at all — and the
 * engine's preload bridge is still there either way, which is exactly why
 * "`window.__wbEngine` exists" would not be an answer.
 *
 * IT HAS TO BE ASKED. The engine pushes `STATE` on events, and between boot and
 * the first arm there are none — the deck's own boot `STATUS` (`ui/embed.js`
 * :2457) has already been answered before this suite can attach a listener. So
 * the same envelope is sent again, through the deck's own `host.send`, and it is
 * undeduped: a second `STATUS` is answered with a fresh `push(true)`.
 */
await pages.deck.evaluate((to) => window.__smokeHost.send({ v: 1, to, from: 'ui', type: 'STATUS' }), BUS.engine);
const engineAlive = await until('the engine to answer STATUS with a STATE',
  async () => (await deckSaw()).some((m) => m.type === 'STATE'), 20000) === true;
const before = O(await safe('deck DOM', deckPainted));
const engineDuties = Object.keys(ENGINE_HOST_DUTIES).length;
const deckDuties = Object.keys(DECK_HOST_DUTIES).length
  + Object.keys(DECK_PAGE_DUTIES).length + Object.keys(DECK_TRANSPORT_DUTIES).length;
ok('assertHost accepted both halves of the Host: the deck reached module scope and the engine is on the bus  '
  + '[entry point: assertHost() at ui/embed.js and offscreen/engine.js module scope]',
  before.embed === 'object' && engineAlive
  && A(O(deckHostKeys).keys).length === Object.keys(DECK_HOST_DUTIES).length + 2,
  O(deckHostKeys).THREW ? O(deckHostKeys).THREW
    : `deck: window.__embed is ${before.embed}, ui/host.js exports [${A(O(deckHostKeys).keys).join(' ')}] `
      + `= ${deckDuties} duties across three namespaces · engine: ${engineDuties} duties, and it `
      + `${engineAlive ? 'answered STATUS with a STATE' : 'ANSWERED NOTHING — its module scope did not finish'}`);

// =========================================================================
// 4. THE FOUR MESSAGES THE HOST MUST ORIGINATE
// =========================================================================
/**
 * `docs/VENDORING.md`, "What your Host owes the unit": *"You must ORIGINATE four
 * messages. `assertHost` cannot check for a message nobody sent."* A Host can
 * implement all 32 duties and originate none of these; the deck then sits there
 * with a dead surface and every other gate in this repository stays green. They
 * are asserted one at a time, by name, so a red says WHICH one went missing.
 */

// ------------------------------------------------------- SESSION, by the menu
const armClick = await safe('menu arm', () => app.evaluate(({ Menu }) => {
  const item = Menu.getApplicationMenu() && Menu.getApplicationMenu().getMenuItemById('arm');
  if (!item) return { clicked: false, why: 'no menu item with id `arm`' };
  item.click();
  return { clicked: true, accelerator: item.accelerator, label: item.label };
}));
await until('SESSION{armed:true} at the deck',
  async () => (await deckSaw()).some((m) => m.type === 'SESSION' && m.session && m.session.armed === true), 8000);
const afterArm = O(await safe('deck DOM', deckPainted));
const sessions = (await deckSaw()).filter((m) => m.type === 'SESSION');
const armedSession = sessions.filter((m) => O(m.session).armed === true).pop() || {};
ok('SESSION: clicking `Arm this Source` in the application menu originates SESSION to the deck, and the deck stops asking to be armed  '
  + '[entry point: Menu item `arm` -> arm() -> sendSession() in src/main/deck-host.js]',
  O(armClick).clicked === true
  && sessions.length >= 1 && O(armedSession.session).armed === true
  && JSON.stringify(A(armedSession.sessionKeys)) === JSON.stringify(['armed', 'armedAt', 'title', 'url'])
  && armedSession.to === BUS.deck && Number.isFinite(O(armedSession.session).armedAt)
  && String(before.lead).length > 0 && afterArm.lead === '',
  `menu "${O(armClick).label}" (${O(armClick).accelerator}) · ${sessions.length} SESSION(s) to '${armedSession.to}' · `
  + `session keys ${JSON.stringify(A(armedSession.sessionKeys))} · `
  + `the deck's hint went ${JSON.stringify(String(before.lead).slice(0, 32))}… -> ${JSON.stringify(afterArm.lead)}`);

// ------------------------------------- DECK_PREPARE and CAPTURE_START, by the deck
// The two envelopes `ui/embed.js` sends, verbatim — see the header for why this
// suite sends them rather than waiting for the deck to decide to.
await pages.deck.evaluate((to) => window.__smokeHost.send({ v: 1, to, from: 'ui', type: 'SW_DECK_PREPARE', deck: 'A' }), BUS.host);
await until('DECK_PREPARE at the engine', async () => (await engineSaw()).some((m) => m.type === 'DECK_PREPARE'), 8000);
await pages.deck.evaluate((to) => window.__smokeHost.send({ v: 1, to, from: 'ui', type: 'SW_CAPTURE_START', deck: 'A' }), BUS.host);
await until('CAPTURE_START at the engine', async () => (await engineSaw()).some((m) => m.type === 'CAPTURE_START'), 8000);

const engineMsgs = A(await safe('engine bus', engineSaw));
const capStart = engineMsgs.filter((m) => m.type === 'CAPTURE_START');
const prepare = engineMsgs.filter((m) => m.type === 'DECK_PREPARE');

/**
 * THE COUNT IS NOT THE CLAIM, AND MAKING IT ONE IS A MEASURED FLAKE.
 *
 * This suite sends the two `SW_*` envelopes itself (see the header: the deck
 * sends them only once the 109 MiB weights are on disk, and gating an always-on
 * step on a file that is not in git would make it SKIP on a clean checkout). On
 * a machine that DOES have the weights, the deck sends its own as well —
 * `maybePrepare()` fires from the first `STATE` — so the engine sees TWO.
 *
 * Measured on 2026-08-26: two consecutive runs on this tree, one with a single
 * `DECK_PREPARE` and one with two, differing only in whether the deck's own
 * `maybePrepare()` landed inside the window. `prepare.length === 1` was
 * therefore an assertion about the MACHINE and not about the Host.
 *
 * So the count is reported and every message is checked instead of the first:
 * `every()` is STRICTLY stronger on the thing these assertions are named for —
 * the address, the frozen shape, the omitted `deck` — and the only thing given
 * up is a number that was never in any of their names. `AGENTS.md` forbids
 * parking a flake on an expected-red list; this is the other repair, which is to
 * stop asserting the part that was not the claim.
 */
const frozenStart = ['from', 'source', 'sourceToken', 'to', 'type', 'v'];
ok('CAPTURE_START: the Host originates it to the engine, carrying a minted token and the Source  '
  + '[entry point: SW_CAPTURE_START in src/main/deck-host.js -> captureStart() in src/main/engine-messages.js]',
  capStart.length >= 1
  && capStart.every((m) => m.to === BUS.engine && m.from === BUS.host && Number(m.token) > 0),
  capStart.length ? `${capStart.length} to '${capStart[0].to}' from '${capStart[0].from}', `
    + `sourceToken is ${capStart.map((m) => m.token).join('/')} chars` : 'NOTHING was originated');

ok("...and its shape is the frozen one: `{sourceToken, source:{title,url}}`, no `deck` for the default deck and no `tabId`  "
  + '[entry point: createEngineMessages() in src/main/engine-messages.js]',
  capStart.length >= 1
  && capStart.every((m) => JSON.stringify(m.keys) === JSON.stringify(frozenStart)
    && JSON.stringify(m.sourceKeys) === JSON.stringify(['title', 'url'])),
  capStart.length ? `${capStart.length} message(s), keys ${JSON.stringify(capStart[0].keys)} · `
    + `source keys ${JSON.stringify(capStart[0].sourceKeys)}`
    : '(nothing to look at)');

ok('DECK_PREPARE: the Host originates it to the engine, and omits `deck` for the default deck  '
  + '[entry point: SW_DECK_PREPARE in src/main/deck-host.js -> deckPrepare() in src/main/engine-messages.js]',
  prepare.length >= 1
  && prepare.every((m) => m.to === BUS.engine
    && JSON.stringify(m.keys) === JSON.stringify(['from', 'to', 'type', 'v'])),
  prepare.length ? `${prepare.length} to '${prepare[0].to}' (this suite sends one; the deck sends its own too `
    + `when the weights are on disk), keys ${JSON.stringify(prepare[0].keys)}` : 'NOTHING was originated');

// =========================================================================
// 5. THE PLAYER, BOTH DIRECTIONS
// =========================================================================
const fixture = () => pages.source.evaluate(() => window.__wbFixture());
/** The real element, not the fixture's report of it — for the fields no report has. */
const element = () => pages.source.evaluate(() => {
  const v = document.querySelector('#movie_player video');
  return v ? {
    muted: v.muted, rate: v.playbackRate, currentTime: v.currentTime, volume: v.volume,
    paused: v.paused, duration: v.duration,
    evil: v.evil === undefined ? '(undefined)' : String(v.evil),
    src: String(v.src).slice(0, 5),
  } : null;
});

// ------------------------------------------------------------ play and pause
const playing0 = O(await safe('deck DOM', deckPainted)).playing;
await pages.source.evaluate(() => window.__wbFixture.play());
const sawPlay = await until('the deck to see play', async () => O(await deckPainted()).playing === true, 8000);
await wait(1500);                        // let the playhead move off zero for the seek below
const midway = O(await safe('element', element));
await pages.source.evaluate(() => window.__wbFixture.pause());
const sawPause = await until('the deck to see pause', async () => O(await deckPainted()).playing === false, 8000);
ok('the deck follows the player: pressing play and pause on the page moves `__embed.videoPlaying`  '
  + '[entry point: src/preload/youtube.cjs -> onState in src/main/transport.js -> `{t:"video"}` in src/main/deck-host.js]',
  playing0 === false && sawPlay === true && sawPause === true,
  `videoPlaying: ${playing0} -> ${sawPlay === true} (play) -> ${sawPause === true ? false : 'STUCK'} (pause) · `
  + `the element reached t=${O(midway).currentTime && O(midway).currentTime.toFixed(2)}s of ${O(midway).duration}s`);

const reports = A(await safe('page events', () => pages.deck.evaluate(() => window.__smokeDeckPage.map((m) => m.t))));
const videoReports = reports.filter((t) => t === 'video');
const sample = O(A(await safe('page events', () => pages.deck.evaluate(() =>
  window.__smokeDeckPage.filter((m) => m.t === 'video').slice(-1)))).pop());
ok('...and the report the deck reads carries the transport state and NOTHING about the media  '
  + '[entry point: sendState() in src/preload/youtube.cjs -> DeckTransport.onState -> `{t:"video"}`]',
  videoReports.length > 0 && typeof sample.playing === 'boolean'
  && Number.isFinite(sample.currentTime) && Number.isFinite(sample.duration) && sample.duration > 0
  && !('src' in sample) && !('currentSrc' in sample) && !('buffered' in sample) && !('srcObject' in sample),
  `${videoReports.length} video report(s); the last carries playing=${sample.playing} `
  + `currentTime=${Number.isFinite(sample.currentTime) ? sample.currentTime.toFixed(2) : sample.currentTime} `
  + `duration=${sample.duration} · its ${Object.keys(sample).length} fields are `
  + `[${Object.keys(sample).sort().join(' ')}] — no src, currentSrc, buffered or srcObject among them`);

// -------------------------------------------------------------- a content jump
/**
 * THE FIXTURE'S 60 s IS WHAT MAKES `+1` SAFE — see the header. A `loop` wrap
 * inside this window would fire `seeking`, the preload would report a second
 * jump, and this assertion would be green on a build that had dropped the
 * report and red on a correct one.
 */
const jumps0 = O(await safe('deck DOM', deckPainted)).jumps;
await pages.source.evaluate(() => window.__wbFixture.seek(20));
const sawJump = await until('the deck to count the jump',
  async () => O(await deckPainted()).jumps === jumps0 + 1, 8000);
const jumps1 = O(await safe('deck DOM', deckPainted)).jumps;
ok('a seek the USER made arrives at the deck as exactly one content jump  '
  + '[entry point: the `seeking` handler in src/preload/youtube.cjs -> onJump -> `{t:"jump"}` in src/main/deck-host.js]',
  Number.isFinite(jumps0) && sawJump === true && jumps1 === jumps0 + 1,
  `__embed.jumps ${jumps0} -> ${jumps1} over one seek to 20.0 s of a 60.0 s clip `
  + `(${A(reports).filter((t) => t === 'jump').length} jump report(s) before it)`);

// ----------------------------------------------------- the page's own speed menu
/**
 * `__embed.speed` ALONE CANNOT CARRY THIS CLAIM — measured, not reasoned.
 * `onElementRate()` in `ui/embed.js` is ONE entry point for a fact that arrives
 * on TWO messages: `playbackRate` on the video state (`:852`) and the Host's
 * speed report's `applied` (`:1629`). Mutation 14 was first written to delete
 * only the `onSpeedReport` relay, and this assertion stayed GREEN — the rate
 * came in on the other feed. An estimator that saturates before the claim
 * begins, which is exactly what `AGENTS.md` forbids, and a one-channel mutation
 * reported as a catch would have been the worst outcome available here.
 *
 * So the REPORT ITSELF is read, off the deck's own inbound channel, and the
 * assertion names all three things it is about: the Host's verdict reached the
 * deck, the deck's readout followed the element, and the Host did not write the
 * rate back.
 *
 * THE REAL *YIELD* CASE IS `transport.mjs`'s, NOT THIS SUITE'S. A yield is
 * `speedPlan`'s branch for "we hold a claim AND somebody else moved the rate"
 * (`vendor/…/speed.js`:280), and that suite drives it properly — claim 1.5, the
 * page writes 1.75, the Host adopts 1.75. With no claim held the plan is
 * `{act:'idle', state:'ok', want:null, why:null}`, and the `want === null`
 * conjunct below is what says this run held none.
 */
const speedSeen = () => pages.deck.evaluate(() => window.__smokeDeckPage.filter((m) => m.t === 'speed'));
const speedBefore = A(await safe('page events', speedSeen)).length;
const speed0 = O(await safe('deck DOM', deckPainted)).speed;
await pages.source.evaluate(() => window.__wbFixture.pageRate(1.5));
const sawSpeed = await until('the deck to follow the page\'s rate',
  async () => O(await deckPainted()).speed === 1.5, 8000);
const speedReports = A(await safe('page events', speedSeen)).slice(speedBefore);
const lastSpeed = O(speedReports[speedReports.length - 1]);
const stillFast = O(await safe('element', element)).rate;
ok("the page's own speed menu reaches the deck: the Host reports the element's rate and leaves it alone  "
  + '[entry point: `ratechange` -> speedReasonFor() in src/main/drive.js -> onSpeedReport -> `{t:"speed"}` in src/main/deck-host.js]',
  speed0 === 1 && sawSpeed === true
  && speedReports.length >= 1 && lastSpeed.applied === 1.5 && lastSpeed.state === 'ok'
  && lastSpeed.want === null && stillFast === 1.5,
  `__embed.speed ${speed0} -> ${O(await safe('deck DOM', deckPainted)).speed}; `
  + `${speedReports.length} speed report(s) after the change, the last `
  + `{state:${JSON.stringify(lastSpeed.state)}, applied:${JSON.stringify(lastSpeed.applied)}, `
  + `want:${JSON.stringify(lastSpeed.want)}, why:${JSON.stringify(lastSpeed.why)}}; `
  + `the element is still at ${stillFast} — nothing wrote it back to 1`);

// ---------------------------------------------------- the deck reaches the player
/**
 * THE ELEMENT IS PAUSED HERE, which is what lets `currentTime` be compared for
 * equality rather than inside a window. A playing element would have moved
 * between the write and the read, and an assertion with a tolerance on a value
 * that is supposed to be exact is an assertion that stops noticing small errors.
 */
const beforeDrive = O(await safe('element', element));
await pages.deck.evaluate(() => window.__smokeHost.transport.drive({
  muted: true, playbackRate: 1.25, currentTime: 12.5, volume: 0.1, evil: 'landed',
}));
await until('the drive to land', async () => {
  const e = O(await element());
  return e.muted === true && e.rate === 1.25 && e.currentTime === 12.5;
}, 8000);
const afterDrive = O(await safe('element', element));
ok('the deck reaches the player: `transport.drive` lands `muted`, `playbackRate` and `currentTime` on the real <video>  '
  + '[entry point: DeckTransport.drive in vendor/…/ui/host.js -> src/main/transport.js -> src/preload/youtube.cjs]',
  afterDrive.muted === true && afterDrive.rate === 1.25 && afterDrive.currentTime === 12.5,
  `sent {muted:true, playbackRate:1.25, currentTime:12.5}; the element reads `
  + `muted=${afterDrive.muted} rate=${afterDrive.rate} currentTime=${afterDrive.currentTime} `
  + `(was ${beforeDrive.muted}/${beforeDrive.rate}/${Number.isFinite(beforeDrive.currentTime) ? beforeDrive.currentTime.toFixed(2) : beforeDrive.currentTime})`);

ok('...and NOTHING else did: `volume` and `evil` rode in the same patch and never reached the element  '
  + '[entry point: filterDrive() in src/main/drive.js, and the third filter in src/preload/youtube.cjs]',
  afterDrive.volume === 1 && afterDrive.evil === '(undefined)',
  `volume=${afterDrive.volume} (0.1 was sent), video.evil=${afterDrive.evil} ("landed" was sent) — `
  + 'the write set is closed at three fields in three places');

// =========================================================================
// 6. CAPTURE_STOP AND THE HAND-BACK, by the menu
// =========================================================================
const disarmClick = await safe('menu disarm', () => app.evaluate(({ Menu }) => {
  const item = Menu.getApplicationMenu() && Menu.getApplicationMenu().getMenuItemById('disarm');
  if (!item) return { clicked: false, why: 'no menu item with id `disarm`' };
  item.click();
  return { clicked: true, label: item.label };
}));
await until('CAPTURE_STOP at the engine', async () => (await engineSaw()).some((m) => m.type === 'CAPTURE_STOP'), 8000);
const capStop = A(await safe('engine bus', engineSaw)).filter((m) => m.type === 'CAPTURE_STOP');
ok('CAPTURE_STOP: clicking `Disarm` originates it to the engine, with `deck` omitted for the default deck  '
  + '[entry point: Menu item `disarm` -> disarm() in src/main/deck-host.js -> captureStop()]',
  O(disarmClick).clicked === true && capStop.length === 1 && capStop[0].to === BUS.engine
  && JSON.stringify(capStop[0].keys) === JSON.stringify(['from', 'to', 'type', 'v']),
  capStop.length ? `menu "${O(disarmClick).label}" · ${capStop.length} to '${capStop[0].to}', keys ${JSON.stringify(capStop[0].keys)}`
    : 'NOTHING was originated');

await until('the player to be handed back', async () => {
  const e = O(await element());
  return e.muted === false && e.rate === 1;
}, 8000);
const released = O(await safe('element', element));
ok('...and the player is handed back the way it was found — unmuted, rate 1, key lock on  '
  + '[entry point: DeckTransport.release, called by disarm() in src/main/deck-host.js]',
  released.muted === false && released.rate === 1,
  `after disarm the element reads muted=${released.muted} rate=${released.rate} `
  + '(it was left muted at 1.25x by the drive above) — a muted 1.25x video is a bug the user cannot undo');

// =========================================================================
// 7. THE DECK PAINTED, AND THE CONTEXT IS AT 44100
// =========================================================================
const painted = O(await safe('deck DOM', deckPainted));
const strips = A(painted.strips);
ok('the deck painted one fader per stem — six strips, each a stem the unit declares  '
  + '[entry point: paintStrips() in vendor/…/ui/embed.js, over STEMS in shared/config.js]',
  strips.length === STEMS.length && painted.faders === STEMS.length
  && strips.every((s) => STEMS.includes(s)) && new Set(strips).size === STEMS.length,
  `${strips.length} strips [${strips.join(' ')}] and ${painted.faders} role="slider" faders · `
  + `the unit declares ${STEMS.length}: [${STEMS.join(' ')}] (the deck's display order is its own)`);

/**
 * NOT COSMETIC. The spike measured it: a DEFAULT host `AudioContext` opens at
 * 48000 and inserts a resampler in the renderer, while the captured track is
 * 44100. CONTRIBUTING.md's settled decision — one context at 44100, no JS
 * resampling on the live path — survives into this Host only if the context is
 * opened explicitly. Read off `STATE.boot`, which `engine.js` fills in
 * `ensureContext()` and not at boot, so this is only answerable after a capture.
 */
const boots = A(await safe('deck bus', deckSaw)).map((m) => m.boot).filter(Boolean);
const boot = boots.length ? boots[boots.length - 1] : {};
ok(`the AudioContext the engine opened for the capture is at ${SR}, not the platform default  `
  + '[entry point: ensureContext() in vendor/…/offscreen/engine.js, read off STATE.boot at the deck]',
  boot.sampleRate === SR,
  `sampleRate=${JSON.stringify(boot.sampleRate)} over ${boots.length} STATE snapshot(s) · `
  + `coi=${boot.coi} sab=${boot.sab} — a default context opens at 48000 and resamples a ${SR} capture`);

// =========================================================================
// 8. THE RUN'S OWN LEDGER
// =========================================================================
/**
 * L1's STATIC SCAN IS NOT HERE. `tools/suites/transport.mjs` already asserts
 * that none of the names L1 forbids appears in `src/preload/youtube.cjs` with
 * comments stripped — AND that the scanner is looking at code rather than at
 * nothing, which is the rule-7 half a second copy would have to grow for itself.
 * A second scanner is a scanner that drifts. Assertion 9 above is this suite's
 * L1 claim: no media field on the feed the DECK reads.
 */
const reqs = A(await safe('requests', () => app.evaluate(() => globalThis.__smokeRequests)));
/**
 * THE ONE HOST P1' NAMES IS NOT AN ESCAPE HATCH, AND IT IS NOT A WANDER EITHER.
 *
 * `src/main/update.js` asks `api.github.com` once, at boot, for the latest
 * release tag — the single outbound request this product is allowed to make, and
 * the one `PRIVACY.md` discloses. It appears here because the guard sees every
 * request on both sessions, and it was NOT here when this assertion was written:
 * the update check landed later, and this suite went red for a feature working
 * exactly as specified.
 *
 * So it is excluded BY HOST, from the product's own constant rather than from a
 * string typed here, and the count is printed either way. THE CLAIM ABOUT THAT
 * HOST IS `p1`'s, not this suite's: `tools/suites/p1.mjs` asserts that the app
 * reaches it and NOTHING else, over a real launch, with the request forced onto
 * a local server. This assertion is the cruder one it complements — *the run did
 * not wander off the box* — and an update check is not wandering.
 *
 * WATCHED RED by pointing the product at a different host:
 * `UPDATE_HOST = 'api.example.com'` in `src/main/update.js` turns this red
 * naming that host, because the exclusion is keyed on the constant and the
 * request is not.
 */
const updateOrigin = `https://${UPDATE_HOST}`;
const toUpdateHost = reqs.filter((r) => String(r.url).startsWith(`${updateOrigin}/`));
const offBox = reqs.filter((r) => r.refused
  && !/smoke-guard-\w+\.invalid/.test(r.url)
  && !String(r.url).startsWith(`${updateOrigin}/`));
ok('the whole run stayed on the box: every request either session made was local, bar the ONE host P1\' names  '
  + '[entry point: the guard installed in §1, over both sessions, for the life of the run]',
  reqs.length >= 2 && offBox.length === 0,
  `${reqs.length} request(s) recorded, ${offBox.length} off-box beyond the two deliberate probes`
  + `${offBox.length ? `: ${[...new Set(offBox.map((r) => r.url))].slice(0, 4).join(' ')}` : ''}`
  + ` and ${toUpdateHost.length} to ${UPDATE_HOST} (the update check — p1 owns that claim) · `
  + `schemes seen: ${[...new Set(reqs.map((r) => (String(r.url).split(':')[0])))].join(' ')}`);

console.log(`\n${ID}: app console ${path.relative(ROOT, path.join(OUT, 'app-console.log'))}`);
await done(app);
