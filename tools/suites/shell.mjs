#!/usr/bin/env node
/**
 * shell — the app skeleton, over ONE real launch of the real entry point.
 *
 * WHAT IT GATES. That `electron .` starts; that the window is one `BaseWindow`
 * with the three views in the stated order; that our four renderers are locked
 * down and the source view's page can see nothing of ours; that the `app://`
 * origin is cross-origin isolated in the DOCUMENT and inside a MODULE WORKER,
 * which is the half ORT's threaded wasm actually needs; that the capture grant
 * answers the engine with the SOURCE view's frame and refuses everybody else;
 * that the source view is muted BEFORE it loads anything; and that a navigation
 * off the allowlist is refused rather than silently cancelled.
 *
 * WHAT IT DOES NOT GATE, stated so the absence is on the record rather than
 * merely true:
 *   · THE UNIT. `vendor/stem-splitter-live/` is not on this tree. Nothing here
 *     proves the vendored engine or deck loads, runs, or produces audio. The
 *     deck-slot assertion below reads the placeholder branch today and the
 *     vendored branch the day the copy lands — same assertion, both ways.
 *   · THE 32 DUTIES. There is no Host yet; `assertHost` has nothing to check.
 *     That is `group('host')` in the vendored `test.js`, next wave.
 *   · THE PERMANENT CAPTURE-MUTE GATE. This suite proves the view is MUTED and
 *     that a capture opens; it does NOT witness the audio device. A muted view
 *     and a silent speaker are two claims and `capture-mute` (docs/TESTING.md
 *     §7) is the one that measures the second. THIS SUITE CANNOT REPLACE IT.
 *   · THE BUS ROUTER'S SENDER CHECK. `bus.js` drops a `'bus'` message from a
 *     renderer that is on no address. No renderer we ship has both that channel
 *     and no address, so there is nothing to send the message that would prove
 *     it.
 *   · THE MUTE'S RE-ASSERT ON NAVIGATION. Chromium preserves the mute flag
 *     across a navigation in the same `WebContents`, so removing the re-assert
 *     changes no observable — the belt is gated, the braces are not.
 *   · P1'. Which host the app talks to is `p1`'s job (§8), not this one's.
 *
 * ---------------------------------------------------------------------------
 * WATCHED RED BY MUTATION — every assertion below, with the edit that broke it
 * ---------------------------------------------------------------------------
 * Reproduce all of them with `tools/suites/shell-mutations.sh`. Each row is the
 * mutation, the file it was applied to, and the assertions that went red.
 *
 * Run on 2026-08-26 against Electron 44.0.0 / Chromium 152.0.7977.54 on Linux.
 * The right column is what ACTUALLY went red, not what was expected to.
 *
 *   1  assets.js ISOLATION_HEADERS: drop COOP + COEP        -> isolation x4, headers, the bar
 *   2  assets.js resolveAppPath: drop the containment test  -> traversal (pure + live)
 *   3  navigation.js: suffix match -> `host.includes(...)`  -> allowlist refuses
 *   4  youtube.js: setAudioMuted AFTER the first load       -> muted before load
 *   5  youtube.js: delete the will-navigate guard           -> navigation refused
 *   6  youtube.js: window open handler -> `{action:'allow'}`-> popups denied
 *   7  main.js: grant the CHROME frame, not the source's    -> grant names the source frame
 *   8  main.js: do not addChildView(deck)                   -> three views attached, all three drew
 *   9  bus.js: stamp `hostSaw: true` onto a routed envelope -> envelope arrives as sent
 *  10  bus.js: delete the `v !== 1` guard                   -> malformed dropped
 *  11  capture.js: mayCapture -> `(wc) => !!wc || …`        -> deck may not capture
 *  12  main.js: nodeIntegration: true                       -> renderers locked down (the PREFS half)
 *  13  chrome.html: delete the Arm button                   -> chrome bar painted
 *  14  probe.mjs: do not write report.json                  -> the suite FAILS, not exits 0
 *  15  probe.mjs GDM call -> `{audio: true}`                -> the track is stereo 44100
 *  16  main.js: noteRefusal stops calling pushStatus()      -> the refusal is visible in the bar
 *  17  navigation.js: drop the *.youtube.com suffix         -> allowlist admits
 *  18  navigation.js: stop requiring https                  -> schemes refused
 *  19  assets.js: match the SHORTEST root prefix            -> the path table maps
 *  20  assets.js: serve any app:// host                     -> unknown host refused
 *  21  main.js: show the engine window                      -> the engine is hidden
 *  22  youtube.cjs: exposeInMainWorld                       -> the page sees no bridge
 *  23  main.js: source view on OUR session                  -> alone on persist:youtube
 *  24  main.js: never register BUS.deck                     -> detached send arrives (+3)
 *  25  bus.js: no-listener counted as malformed             -> no-listener dropped (+1)
 *  26  youtube.js: grant the view every permission          -> the page may not capture
 *  27  main.js: deck slot points at the wrong page          -> the deck slot loads (+3)
 *  28  main.js: contextIsolation/sandbox off, node on       -> no renderer sees require (+7)
 *
 * CASES 17-28 CAME FROM A COVERAGE AUDIT, not from a hunch: the first sixteen
 * left ELEVEN of these 34 assertions with no mutation of their own, which is
 * invisible from inside a green run. `tools/suites/coverage.py` makes it
 * mechanical — after a full battery it names any assertion that has never
 * appeared on a FAIL line, and exits non-zero. 28 of 28 caught, 34 of 34 red.
 *
 * MUTATION 15 IS THE LIMITATION-6 RUN, and it is why that assertion lists every
 * field rather than checking that a track exists. Measured under it:
 * `ch=1 sr=48000 agc=true ec=true ns=true` — mono, 48 kHz, with automatic gain
 * control whose level decays 17x over 8 s. The spike's original four-assertion
 * gate called that a PASS. The constraints are the ENGINE's to pass, not main's,
 * so today they live in `tools/gate/probe.mjs`; when `offscreen/host.js` lands
 * they move there and this assertion moves with them.
 *
 * CASE 27 FOUND A DEFECT IN THIS FILE RATHER THAN IN THE APP. With the deck slot
 * pointed elsewhere, `window.__wbBusLog` stopped existing, the probe returned
 * `{THREW: …}` where an array was expected, and this suite died on
 * `.filter is not a function` with eleven assertions still to run — including
 * the one that mutation was written to turn red. A suite that crashes has not
 * reported a red; it has stopped looking. Hence `A()` and `O()` below, on every
 * read of the report.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isAllowedNavigation, NAV_ALLOW } from '../../src/main/navigation.js';
import { resolveAppPath } from '../../src/main/assets.js';

const ID = 'shell';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'out', ID);
const DECK_ENTRY = 'vendor/stem-splitter-live/extension/ui/embed.html';

/**
 * The shared browser mutex. Sibling agents run browsers on this machine and
 * `xvfb-run -a` picks a display number by scanning for a free one, which is a
 * race two launches can both win. `STEM_WORKBENCH_BROWSER_LOCK` names the lock
 * to take; the default is per-user and per-machine.
 */
const LOCK = process.env.STEM_WORKBENCH_BROWSER_LOCK
  || path.join(os.tmpdir(), `stem-workbench-browser-${process.getuid ? process.getuid() : 'x'}.lock`);

// ------------------------------------------------------------- the harness
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  cond ? pass++ : fail++;
};
const done = () => {
  console.log(`\n${ID}: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};
const skip = (why) => { console.log(`SKIPPED — ${why}`); process.exit(0); };

/**
 * A REPORT FIELD IS NOT A PROMISE. Every probe in `tools/gate/probe.mjs` returns
 * `{ THREW: '...' }` where it could not look, and a mutated build produces
 * exactly that. Reading `.filter` off one of those crashes the suite with a
 * stack trace instead of printing a red — which is `docs/TESTING.md` §3 rule 7
 * ("a suite that cannot look FAILS") broken in the most expensive direction,
 * because the assertions AFTER the crash never run at all.
 *
 * This was not a precaution. Mutation 27 pointed the deck slot at the wrong page,
 * `window.__wbBusLog` stopped existing, and the suite died at the bus section
 * with eleven assertions still to go — including the one that mutation was
 * written to turn red.
 */
const A = (v) => (Array.isArray(v) ? v : []);
const O = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** Order-insensitive deep equality, so "same keys, different order" is not a red. */
const norm = (v) => (v === null || typeof v !== 'object' ? v
  : Array.isArray(v) ? v.map(norm)
    : Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])])));
const eq = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

// ==========================================================================
// 1. THE TWO TABLES, AS PURE FUNCTIONS — no launch, no display, no mutex
// ==========================================================================
{
  const allowed = [
    ...NAV_ALLOW.map((h) => `https://${h}/watch?v=x`),
    'https://music.youtube.com/',        // the suffix, not the list
    'https://WWW.YOUTUBE.COM/',          // case
    'https://www.youtube.com./',         // a trailing-dot FQDN is the same host
  ];
  const admitted = allowed.filter(isAllowedNavigation);
  ok('every host on the navigation allowlist is admitted  [entry point: src/main/navigation.js isAllowedNavigation()]',
    admitted.length === allowed.length,
    `${admitted.length}/${allowed.length}${admitted.length === allowed.length ? '' : ` — refused ${allowed.filter((u) => !isAllowedNavigation(u)).join(' ')}`}`);

  const refused = [
    'https://example.com/',
    'https://youtube.com.evil.test/',    // THE `includes()` TRAP
    'https://evilyoutube.com/',
    'https://notyoutube.com/',
    'https://google.com/',               // the four Google hosts are named, the domain is not
    'https://mail.google.com/',
    'https://youtube.com.br/',
    'https://xn--youtube-1234.com/',
  ];
  const held = refused.filter((u) => !isAllowedNavigation(u));
  ok('...and every off-list host is refused, including the `includes()` trap  [entry point: isAllowedNavigation()]',
    held.length === refused.length,
    `${held.length}/${refused.length}${held.length === refused.length ? ' (youtube.com.evil.test held)' : ` — ADMITTED ${refused.filter(isAllowedNavigation).join(' ')}`}`);

  const schemes = ['http://www.youtube.com/', 'file:///etc/passwd', 'data:text/html,x',
    'javascript:alert(1)', 'about:blank', 'ftp://www.youtube.com/', 'not a url at all'];
  const heldSchemes = schemes.filter((u) => !isAllowedNavigation(u));
  ok('...and so is every scheme that is not https, on an allow-listed host or not  [entry point: isAllowedNavigation()]',
    heldSchemes.length === schemes.length,
    `${heldSchemes.length}/${schemes.length}`);

  const roots = [{ prefix: '/vendor/', dir: '/app/vendor' }, { prefix: '/', dir: '/app/src/renderer' }];
  const maps = [
    ['/engine.html', '/app/src/renderer/engine.html'],
    ['/', '/app/src/renderer/index.html'],
    ['/vendor/stem-splitter-live/extension/ui/embed.html', '/app/vendor/stem-splitter-live/extension/ui/embed.html'],
  ];
  const mapped = maps.filter(([p, want]) => resolveAppPath('workbench', p, roots).file === want);
  ok('the app:// path table maps our pages and the vendored tree to their two roots  [entry point: src/main/assets.js resolveAppPath()]',
    mapped.length === maps.length, `${mapped.length}/${maps.length}`);

  const bad = [
    ['a percent-encoded traversal', '/%2e%2e%2f%2e%2e%2fpackage.json'],
    ['a traversal out of /vendor/', '/vendor/%2e%2e%2f%2e%2e%2f.git/config'],
    ['a NUL byte', '/engine.html%00.png'],
    // `/app/vendor-evil` STARTS WITH `/app/vendor`. This is the case a
    // containment test written as `file.startsWith(dir)` lets through, and the
    // separator is the whole difference.
    ["a sibling directory that merely shares the root's prefix", '/vendor/%2e%2e%2fvendor-evil%2fx'],
  ];
  const refusedPaths = bad.filter(([, p]) => resolveAppPath('workbench', p, roots).status !== undefined);
  ok('...and refuses a traversal, a NUL byte and a sibling directory that shares a root\'s prefix  [entry point: resolveAppPath()]',
    refusedPaths.length === bad.length,
    `${refusedPaths.length}/${bad.length}${refusedPaths.length === bad.length ? '' : ` — LET THROUGH ${bad.filter((b) => !refusedPaths.includes(b)).map((b) => `${b[0]} -> ${resolveAppPath('workbench', b[1], roots).file}`).join(', ')}`}`);

  ok('...and a host that is not `workbench` is not served at all  [entry point: resolveAppPath()]',
    resolveAppPath('not-workbench', '/engine.html', roots).status === 404,
    JSON.stringify(resolveAppPath('not-workbench', '/engine.html', roots)));
}

// ==========================================================================
// 2. ONE REAL LAUNCH
// ==========================================================================
const electron = path.join(ROOT, 'node_modules', '.bin', 'electron');
if (!fs.existsSync(electron)) skip('electron is not installed — npm i');
if (!hasBin('xvfb-run')) skip('xvfb-run is not on PATH and this box has no DISPLAY');
if (!hasBin('flock')) skip('flock is not on PATH — the shared browser mutex cannot be taken');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const userData = path.join(OUT, 'userdata');
const fixture = pathToFileURL(path.join(ROOT, 'tools', 'fixture', 'player.html')).href;

const launch = await run(
  'flock', [LOCK, '-c',
    `xvfb-run -a -s '-screen 0 1280x1024x24' ${sh(electron)} . `
    + `--gate=${sh(OUT)} --source-url=${sh(fixture)} --user-data=${sh(userData)}`],
  { cwd: ROOT, timeoutMs: 120000 });
fs.writeFileSync(path.join(OUT, 'launch.log'), launch.out);

const reportPath = path.join(OUT, 'report.json');
let R = null;
try { R = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch { /* asserted below */ }

// A SUITE THAT CANNOT LOOK FAILS. If the app did not start, or started and wrote
// nothing, that is the failure — not a reason to skip the rest.
ok('the app launches from its real entry point and writes a gate report  [entry point: `electron .` -> src/main/main.js]',
  R !== null && R.gate === 1,
  R ? `exit ${launch.code}, ${Object.keys(R).length} sections, electron ${R.versions.electron} / chromium ${R.versions.chrome}`
    : `exit ${launch.code}, no ${path.relative(ROOT, reportPath)} — last line: ${lastLine(launch.out)}`);
if (!R) done();

// ------------------------------------------------------------- 2.1 topology
ok('the window is one BaseWindow with the three views attached in the fixed order',
  O(R.window).windowClass === 'BaseWindow' && O(R.window).childViews === 3
  && /\/chrome\.html$/.test(A(O(R.window).order)[0] || '') && /^app:\/\/workbench\//.test(A(O(R.window).order)[2] || ''),
  `${O(R.window).windowClass}, ${O(R.window).childViews} views: ${A(O(R.window).order).map((u) => u.replace(/^.*\//, '')).join(' | ')}`);

ok('...and the engine is a hidden BrowserWindow of its own, not a fourth view',
  O(R.window).engineIsBrowserWindow === 'BrowserWindow' && O(R.window).engineHidden === true,
  `${O(R.window).engineIsBrowserWindow} hidden=${O(R.window).engineHidden}`);

const rends = ['chrome', 'deck', 'engine', 'source'];
const locked = rends.filter((k) => {
  const p = O(O(R.renderers)[k]).prefs || {};
  return p.contextIsolation === true && p.sandbox === true && p.nodeIntegration === false;
});
ok('every renderer runs with contextIsolation on, sandbox on and nodeIntegration off  [entry point: OUR_WEB_PREFERENCES in src/main/main.js]',
  locked.length === rends.length,
  `${locked.length}/${rends.length}: ${rends.map((k) => `${k}=${JSON.stringify(O(O(R.renderers)[k]).prefs)}`).join(' ')}`);

const noNode = rends.filter((k) => {
  const r = O(O(O(R.renderers)[k]).reach);
  return r.require === 'undefined' && r.process === 'undefined' && r.module === 'undefined';
});
ok('...and no renderer can see `require`, `process` or `module`',
  noNode.length === rends.length,
  `${noNode.length}/${rends.length}`);

ok('the source view\'s page sees no bridge of ours — preload/youtube.cjs exposes nothing  [entry point: src/preload/youtube.cjs]',
  Array.isArray(O(O(O(R.renderers).source).reach).bridges)
  && A(O(O(O(R.renderers).source).reach).bridges).filter((k) => k !== '__wbFixture').length === 0,
  `window has ${JSON.stringify(O(O(O(R.renderers).source).reach).bridges)} (__wbFixture is the local fixture page's own)`);

ok('the source view is alone on persist:youtube and our three renderers are on the default session',
  O(R.sessions).sourceIsDefault === false && O(R.sessions).sourceStorage === 'youtube'
  && O(R.sessions).chromeIsDefault && O(R.sessions).deckIsDefault && O(R.sessions).engineIsDefault,
  `source -> ${O(R.sessions).sourceStorage}, chrome/deck/engine -> default`);

// ----------------------------------------------------------- 2.2 isolation
ok('the engine document is cross-origin isolated  [entry point: ISOLATION_HEADERS in src/main/assets.js]',
  O(O(R.isolation).engine).coi === true,
  `crossOriginIsolated=${O(O(R.isolation).engine).coi} secureContext=${O(O(R.isolation).engine).secureContext} origin=${O(O(R.isolation).engine).origin}`);

ok('...and SharedArrayBuffer constructs there — the thing offscreen/engine.js:112 asserts on',
  O(O(R.isolation).engine).sab === true, `new SharedArrayBuffer(1024) -> ${O(O(R.isolation).engine).sab}`);

ok('...and a module worker inherits it: a POSTED SAB survives as shared memory',
  O(O(O(R.isolation).engine).worker).coi === true
  && O(O(O(R.isolation).engine).worker).sabInWorker === true && O(O(O(R.isolation).engine).worker).byteLength === 8,
  `${JSON.stringify(O(O(R.isolation).engine).worker)} — this is the half ORT's threaded wasm needs`);

ok('...and the deck slot is isolated too, so the headers are the scheme\'s and not one page\'s',
  O(R.isolation.deck).coi === true && O(R.isolation.deck).sab === true
  && O(O(R.isolation.deck).worker).sabInWorker === true,
  `coi=${O(R.isolation.deck).coi} sab=${O(R.isolation.deck).sab} worker=${JSON.stringify(O(R.isolation).deck)}`);

const head = O(O(R.appScheme).head);
// THE THREE VALUES ARE LITERALS HERE, NOT `ISOLATION_HEADERS`. Importing the
// constant this assertion is about would make it agree with any mutation of it:
// delete the COOP line and both sides become `undefined`, which compares equal.
// An assertion that follows the code it is checking is not an assertion.
ok('every app:// response carries COOP, COEP and CORP, and a HEAD answers without a body  [entry point: installAppProtocol() in src/main/protocol.js]',
  head.status === 200 && head.coop === 'same-origin' && head.coep === 'require-corp'
  && head.corp === 'same-origin' && Number(head.len) > 0,
  `HEAD engine.html -> ${head.status} ${head.type} len=${head.len} coop=${head.coop} coep=${head.coep} corp=${head.corp}`);

ok('...and the live handler refuses a percent-encoded traversal and a missing file',
  O(O(R.appScheme).traversal).status === 403 && O(O(R.appScheme).missing).status === 404,
  `traversal -> ${O(O(R.appScheme).traversal).status}, missing -> ${O(O(R.appScheme).missing).status}, `
  + `cross-origin app:// fetch -> ${JSON.stringify(O(R.appScheme).otherHostFetch)}`);

// ----------------------------------------------------------------- 2.3 bus
const pings = A(O(R.bus).deckReceived).filter((m) => m && m.type === 'GATE_PING');
ok('a DETACHED send() from the engine reaches the deck\'s address  [entry point: createBus() in src/main/bus.js]',
  pings.length === 1,
  `${pings.length} of 1 arrived; addresses ${JSON.stringify(O(R.bus).addresses)}; `
  + 'sent as `const f = window.__wbEngine.send; f(msg)`');

ok('...and the envelope arrives exactly as sent — main rewrites nothing  [entry point: createBus()]',
  pings.length === 1 && eq(pings[0], O(R.bus).expectedPing),
  pings.length === 1 ? `sent ${JSON.stringify(O(R.bus).expectedPing)} got ${JSON.stringify(pings[0])}` : '(nothing arrived)');

ok('...and a message whose protocol version is not 1 is dropped as malformed and counted  [entry point: createBus()]',
  O(O(O(R.bus).stats).dropped).malformed === 1 && O(O(R.bus).stats).delivered === 1,
  `dropped ${JSON.stringify(O(O(R.bus).stats).dropped)} delivered=${O(O(R.bus).stats).delivered} received=${O(O(R.bus).stats).received}`);

ok('...and a message to an address nobody listens on is dropped and counted, never retried  [entry point: createBus()]',
  O(O(O(R.bus).stats).dropped)['no-listener'] === 1,
  `no-listener=${O(O(O(R.bus).stats).dropped)['no-listener']} — the deck's boot poll is written for exactly this`);

// ------------------------------------------------------------- 2.4 capture
const gdm = O(O(R.capture).fromEngine);
const wantDevice = `web-contents-media-stream://${O(O(R.capture).sourceFrame).processId}:${O(O(R.capture).sourceFrame).routingId}`;
ok('the capture grant answers the engine with the SOURCE view\'s frame  [entry point: installCapturePolicy() in src/main/capture.js]',
  gdm.ok === true && typeof gdm.settings.deviceId === 'string' && gdm.settings.deviceId.startsWith(wantDevice),
  `deviceId=${gdm.ok ? gdm.settings.deviceId : JSON.stringify(gdm)} · source frame ${wantDevice} · chrome frame `
  + `web-contents-media-stream://${O(O(R.capture).chromeFrame).processId}:${O(O(R.capture).chromeFrame).routingId}`);

ok('...and the track is one stereo 44100 audio track with AGC, echo cancellation and noise suppression all off',
  gdm.ok === true && gdm.audioTracks === 1 && gdm.settings.channelCount === 2 && gdm.settings.sampleRate === 44100
  && gdm.settings.autoGainControl === false && gdm.settings.echoCancellation === false
  && gdm.settings.noiseSuppression === false,
  gdm.ok ? `${gdm.audioTracks} audio track, ch=${gdm.settings.channelCount} sr=${gdm.settings.sampleRate} `
    + `agc=${gdm.settings.autoGainControl} ec=${gdm.settings.echoCancellation} ns=${gdm.settings.noiseSuppression}`
    : JSON.stringify(gdm));

ok('the deck may not open a capture — only the engine may  [entry point: installCapturePolicy()]',
  O(O(R.capture).fromDeck).ok === false && O(O(R.capture).fromDeck).name === 'NotAllowedError',
  `${O(O(R.capture).fromDeck).name}: ${O(O(R.capture).fromDeck).message} · permission denials ${O(O(R.capture).stats).permissionDenied}`);

ok('...and neither may a page inside the source view, which is the one that would undo the product',
  O(O(R.capture).fromSource).ok === false && O(O(R.capture).fromSource).name === 'NotAllowedError',
  `${O(O(R.capture).fromSource).name}: ${O(O(R.capture).fromSource).message}`);

// ---------------------------------------------------------------- 2.5 mute
ok('the source view is muted BEFORE it loads anything, and no navigation ever starts unmuted  [entry point: createSourceView() in src/main/youtube.js]',
  O(R.mute).mutedAtCreate === true && A(O(R.mute).mutedBeforeLoad).length > 0
  && A(O(R.mute).mutedBeforeLoad).every(Boolean) && O(R.mute).unmutedNavigations === 0 && O(R.mute).isAudioMutedNow === true,
  `atCreate=${O(R.mute).mutedAtCreate} beforeLoad=${JSON.stringify(O(R.mute).mutedBeforeLoad)} `
  + `${O(R.mute).navigations} navigations, ${O(R.mute).unmutedNavigations} of them unmuted `
  + '(variant (a) leaked 1.90 s at peak 0.499893)');

// --------------------------------------------------------------- 2.6 guest
ok('a renderer-initiated navigation off the allowlist is refused, and the view does not move  [entry point: createSourceView()]',
  A(O(R.guest).refusedNavigations).length === 1 && O(R.guest).urlAfter === O(R.guest).urlBefore,
  `refused ${JSON.stringify(A(O(R.guest).refusedNavigations).map((r) => r.url))}, url unchanged (${O(R.guest).urlAfter === O(R.guest).urlBefore})`);

// THE HANDLER RUNNING IS NOT THE SAME CLAIM AS THE POPUP NOT OPENING. The
// counter increments before the verdict is returned, so `{action:'allow'}` would
// leave it at 1. What the PAGE got back is the half that cannot be faked.
ok('...and window.open is denied — this window has no tabs and no popups  [entry point: createSourceView()]',
  A(O(R.guest).deniedWindowOpens).length === 1 && O(R.guest).windowOpenResult === 'null',
  `${A(O(R.guest).deniedWindowOpens).length} denied: ${JSON.stringify(O(R.guest).deniedWindowOpens)}; `
  + `the page got back \`${O(R.guest).windowOpenResult}\``);

ok('...and the refusal is visible in the chrome bar, not silently swallowed  [entry point: src/renderer/chrome.js render()]',
  typeof O(R.chromeDom).refusal === 'string' && /refused/.test(O(R.chromeDom).refusal),
  JSON.stringify(O(R.chromeDom).refusal));

// -------------------------------------------------------- 2.7 what it drew
ok('the chrome bar painted, with its Arm control present and disabled  [entry point: src/renderer/chrome.html]',
  O(R.chromeDom).arm === true && O(R.chromeDom).armDisabled === true && /coi=true/.test(String(O(R.chromeDom).engine)),
  `arm=${O(R.chromeDom).arm} disabled=${O(R.chromeDom).armDisabled} engine="${O(R.chromeDom).engine}" deck="${O(R.chromeDom).deck}"`);

const drew = Object.entries(O(R.screenshots)).filter(([, s]) => O(s).ok && O(s).colours > 1);
ok('...and all three views drew something — a blank view and a painted one are both a PNG',
  drew.length === 3,
  Object.entries(O(R.screenshots)).map(([k, s]) => `${k} ${O(s).ok ? `${s.width}x${s.height} ${s.colours} colours` : O(s).why}`).join(' · '));

// --------------------------------------------------- 2.8 the vendored deck
const vendored = fs.existsSync(path.join(ROOT, DECK_ENTRY));
const wantDeck = vendored ? `app://workbench/${DECK_ENTRY}` : 'app://workbench/deck-placeholder.html';
ok('the deck slot loads the vendored deck when it is present, and says so when it is not  [entry point: boot() in src/main/main.js]',
  O(O(R.renderers).deck).url === wantDeck,
  `${vendored ? 'vendored' : 'NOT VENDORED — placeholder branch'}: ${O(O(R.renderers).deck).url}`);

console.log(`\n${ID}: launch log ${path.relative(ROOT, path.join(OUT, 'launch.log'))} · `
  + `report ${path.relative(ROOT, reportPath)} · screenshots ${path.relative(ROOT, OUT)}/{chrome,source,deck}.png`);
done();

// ------------------------------------------------------------------ helpers
function sh(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }
function lastLine(s) { const l = String(s).trimEnd().split('\n'); return l[l.length - 1] || '(no output)'; }
function hasBin(name) {
  for (const dir of (process.env.PATH || '').split(':')) {
    try { fs.accessSync(path.join(dir, name), fs.constants.X_OK); return true; } catch { /* next */ }
  }
  return false;
}
function run(bin, args, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const grab = (c) => { out += c.toString(); };
    child.stdout.on('data', grab);
    child.stderr.on('data', grab);
    const timer = setTimeout(() => { out += `\n[suite] TIMEOUT after ${timeoutMs} ms — killing\n`; child.kill('SIGKILL'); }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: 127, out: `${out}\nspawn error: ${e.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}
