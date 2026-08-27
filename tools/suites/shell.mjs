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
 * that the source view is muted BEFORE it loads anything; that a navigation off
 * the allowlist is refused rather than silently cancelled; and that seed §9's
 * SIGN-IN DISGUISE is on exactly one session — `persist:youtube` presents a
 * stock Chrome user-agent, nothing of ours does, and the four hosts Google's
 * sign-in is redirected through can really be navigated to.
 *
 * WHAT IT DOES NOT GATE, stated so the absence is on the record rather than
 * merely true:
 *   · THE UNIT. The copy IS on this tree now and the deck slot loads its real
 *     `ui/embed.html` — the deck-slot assertion below reads that branch, and
 *     still reads the placeholder branch when nothing is vendored. What it does
 *     NOT prove is that the vendored engine or deck RUNS, or produces audio.
 *   · THE 32 DUTIES. `deck-seam` and `conformance` are where `assertHost` and
 *     the vendored `group('host')` are answered. Nothing here checks a duty.
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
 * Run on 2026-08-26 against Electron 44.0.0 / Chromium 152.0.7977.54 on Linux,
 * with the unit vendored and the deck slot loading its real `ui/embed.html`.
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
 *  24  main.js: never register BUS.deck                     -> detached send arrives (+2)
 *  25  bus.js: no-listener counted as malformed             -> no-listener dropped (+1)
 *  26  youtube.js: grant the view every permission          -> the page may not capture
 *  27  main.js: deck slot points at the wrong page          -> the deck slot loads
 *  28  main.js: contextIsolation/sandbox off, node on       -> the app launches, and nothing after it
 *  29  deck.cjs: no `onMessage` on the deck's bridge        -> the recorder installed (+2)
 *  30  probe.mjs: read the placeholder's __wbBusLog()       -> detached send arrives (+1)
 *  31  probe.mjs: ask the deck for __wbProbe()              -> the deck slot is isolated
 *  32  youtube.js: the SOURCE view's isolation off          -> renderers locked down (+1)
 *  33  sessions.js: never call setUserAgent                 -> the source partition presents stock Chrome
 *  34  main.js: app.userAgentFallback = the stock UA        -> NOTHING of ours wears it
 *  35  navigation.js: drop accounts.google.com              -> the four sign-in hosts BY NAME, and the live navigation
 *  36  useragent.js: Chrome/<full version> not <major>.0.0.0 -> the disguise's shape, and the live one
 *  37  useragent.js: UA_SESSIONS gains 'app'                -> only USER-owned sessions (+ the app cannot boot)
 *
 * CASES 17-28 CAME FROM A COVERAGE AUDIT, not from a hunch: the first sixteen
 * left ELEVEN of the assertions (34 of them then) with no mutation of their own,
 * which is invisible from inside a green run. `tools/suites/coverage.py` makes it
 * mechanical — after a full battery it names any assertion that has never
 * appeared on a FAIL line, and exits non-zero.
 *
 * CASES 29-32 CAME FROM THAT SAME INSTRUMENT SAYING SO AGAIN, after the deck slot
 * started loading the vendored `ui/embed.html`. 29-31 are the deck probes below;
 * 32 exists because case 28 stopped being able to START THE APP: with
 * `contextIsolation` off, `contextBridge` throws in all three of our preloads and
 * the vendored engine and deck then die, so every assertion after the launch is
 * unreachable under it. That left `...and no renderer can see require` with no
 * live mutation, coverage.py named it, and 32 turns it red on a RUNNING app.
 * 32 of 32 caught, 35 of 35 red.
 *
 * CASES 33-37 ARE SEED §9, and two of them are the pair that matters: 33 removes
 * the disguise (Google refuses sign-in, and the feature is simply gone) and 34
 * puts it on EVERYTHING (the update check starts lying to a host we have no
 * reason to lie to, which is the dangerous direction). They are two assertions
 * because they are two failures, and 34 is the one a gate written only against
 * the source view's user-agent is GREEN over: `app.userAgentFallback` is one
 * line and it moves every session in the app at once.
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
 *
 * CASES 29-31 ARE THE SAME MISTAKE ARRIVING FOR REAL, and not through a
 * mutation. `window.__wbProbe` and `window.__wbBusLog` are
 * `src/renderer/deck-placeholder.js`'s globals, and that file stopped being the
 * page in the deck slot the day the unit was vendored. Three assertions here —
 * the deck's isolation and both bus rows — then reported `coi=undefined` and
 * `0 of 1 arrived` about a scheme and a bus that were both working, while
 * `deck-host` and `deck-seam` stayed green throughout. `tools/gate/probe.mjs`
 * now imports `src/renderer/isolation.js` INTO whatever page is in the slot and
 * records the deck's inbox through `__wbDeck.onMessage`, so it needs nothing
 * from the page; 29-31 are what stop that going stale in silence again.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isAllowedNavigation, NAV_ALLOW } from '../../src/main/navigation.js';
import { UA_SESSIONS, userAgentFor, stockChromeUA, PLATFORM_TOKENS } from '../../src/main/useragent.js';
import { SESSION_OWNERS } from '../../src/main/p1.js';
import { resolveAppPath } from '../../src/main/assets.js';
import { BROWSER_LOCK, announceLock } from '../lib/locks.mjs';
import { refuseIfCompromised } from '../lib/tree-guard.mjs';

const ID = 'shell';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * BEFORE ANYTHING IS MEASURED: is this the tree somebody committed?
 *
 * A mutation battery that died without restoring leaves its edit standing on a
 * shipped file, and a run that starts afterwards reports a red that is not in
 * the code — stem-workbench#22, which happened twice in one afternoon. This
 * REFUSES rather than measures, and a refusal is an ERROR: it exits non-zero
 * with no `SKIPPED` and no assertion line, so `tools/verify.mjs` reports it as a
 * FAIL and the plan is RED. "I declined to measure" must not read as green any
 * more than silence may (the VOID rule, one level out).
 *
 * It costs one `readdir` of a directory that is almost always absent, plus one
 * `git status` — at startup, never per assertion.
 */
refuseIfCompromised(ID, ROOT);
const OUT = path.join(ROOT, 'out', ID);
const DECK_ENTRY = 'vendor/stem-splitter-live/extension/ui/embed.html';

/**
 * The shared browser mutex. Sibling agents run browsers on this machine and
 * `xvfb-run -a` picks a display number by scanning for a free one, which is a
 * race two launches can both win. THE PATH IS NOT SPELLED HERE — it is
 * `tools/lib/locks.mjs`, the one place in `tools/` allowed to name a lock, and
 * `void-canary` goes red if a second file names one.
 */
const LOCK = BROWSER_LOCK;
// One line, and only when this run has stepped out of the shared queue — a run
// holding the wrong mutex looks exactly like a run making progress. See tools/lib/locks.mjs.
announceLock();
/** Printed by the shell `flock` runs, the instant it has the lock. See the launch. */
const LOCK_MARK = '__WB_LOCKED__';

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

  /**
   * THE FOUR HOSTS A GOOGLE SIGN-IN GOES THROUGH, SPELLED HERE AS LITERALS.
   *
   * The assertion above iterates `NAV_ALLOW` itself, so it is green over any
   * allowlist at all — including one somebody has just deleted a host from. That
   * is fine for what it claims (nothing on the list is refused) and useless for
   * what seed §9 needs, which is that these four SPECIFIC hosts are on it: the
   * sign-in flow leaves youtube.com for `accounts.google.com`, may bounce
   * through `accounts.youtube.com` and `consent.youtube.com`, and lands on
   * `myaccount.google.com` for an account challenge. A user-agent that gets the
   * user past Google's *"this browser may not be secure"* page is worth nothing
   * if the allowlist then cancels the redirect chain.
   *
   * So they are typed out HERE and not imported. `docs/TESTING.md` §3: an
   * assertion that reads its expectation out of the code it is checking follows
   * that code wherever it goes.
   */
  const SIGN_IN_HOSTS = ['accounts.google.com', 'accounts.youtube.com', 'consent.youtube.com', 'myaccount.google.com'];
  const signInOk = SIGN_IN_HOSTS.filter((h) => isAllowedNavigation(`https://${h}/ServiceLogin?x=1`));
  ok('the four hosts a Google sign-in goes through are on the allowlist BY NAME — named here, not read out of NAV_ALLOW  '
    + '[entry point: src/main/navigation.js isAllowedNavigation()]',
    signInOk.length === SIGN_IN_HOSTS.length,
    `${signInOk.length}/${SIGN_IN_HOSTS.length}`
    + `${signInOk.length === SIGN_IN_HOSTS.length ? ' (seed §9: sign-in is why they are there)'
      : ` — REFUSED ${SIGN_IN_HOSTS.filter((h) => !signInOk.includes(h)).join(' ')}`}`);

  /**
   * THE DISGUISE'S SHAPE, over all three platforms rather than this one.
   *
   * Chrome's reduced user-agent is three frozen platform tokens, `537.36` twice
   * and `Chrome/<major>.0.0.0`; the MAJOR is the only field read off the
   * runtime, so an Electron upgrade moves the claim with it instead of leaving a
   * literal to rot. The regex is written out here rather than imported for the
   * same reason as the hosts above.
   */
  const UA_SHAPE = /^Mozilla\/5\.0 \(([^)]+)\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/(\d+)\.0\.0\.0 Safari\/537\.36$/;
  const built = ['darwin', 'win32', 'linux', 'freebsd'].map((platform) => ({
    platform, ua: stockChromeUA({ chromeVersion: '152.0.7977.54', platform }),
  }));
  const shaped = built.filter(({ platform, ua }) => {
    const m = UA_SHAPE.exec(ua);
    if (!m || m[2] !== '152') return false;
    if (/Electron|stem-workbench|Chromium/.test(ua)) return false;
    // An unknown platform gets the X11 token — a token nobody ships is MORE
    // conspicuous than the common one, which is the opposite of the point.
    return m[1] === (PLATFORM_TOKENS[platform] || PLATFORM_TOKENS.linux);
  });
  let threw = null;
  try { stockChromeUA({ chromeVersion: 'not-a-version', platform: 'linux' }); }
  catch (err) { threw = String((err && err.message) || err); }
  ok('the stock Chrome user-agent is Chrome-shaped on every platform, carries the real Chromium major and names neither '
    + 'Electron nor this app — and a version it cannot read THROWS rather than inventing one  '
    + '[entry point: src/main/useragent.js stockChromeUA()]',
    shaped.length === built.length && threw !== null,
    `${shaped.length}/${built.length}: ${built.map(({ platform, ua }) => `${platform}=${ua.slice(0, 44)}…`).join(' · ')}`
    + ` · unreadable version -> ${threw ? 'throws' : 'RETURNED A STRING'}`);

  /**
   * ...AND IT IS THE USER'S SESSION THAT WEARS IT, NOBODY ELSE'S.
   *
   * This is the pure half of the claim the launch below makes for real. The two
   * tables are `UA_SESSIONS` (who presents a disguise) and `SESSION_OWNERS` (whose
   * traffic each session is), and the property that binds them is that no
   * `app`-owned label is in the first: the one request P1' permits is the update
   * check, and it must reach GitHub as what it is.
   */
  const uaLabels = [...UA_SESSIONS];
  const appLabels = Object.keys(SESSION_OWNERS).filter((k) => SESSION_OWNERS[k] === 'app');
  const userLabels = Object.keys(SESSION_OWNERS).filter((k) => SESSION_OWNERS[k] === 'user');
  const env = { chromeVersion: '152.0.7977.54', platform: 'linux' };
  ok("only USER-owned sessions present the disguise: every label in UA_SESSIONS is a session PRIVACY.md excludes by name, "
    + "and every app-owned label gets Electron's own  [entry point: src/main/useragent.js userAgentFor()]",
    uaLabels.length > 0
    && uaLabels.every((l) => userLabels.includes(l))
    && appLabels.length > 0 && appLabels.every((l) => userAgentFor(l, env) === null),
    `UA_SESSIONS ${JSON.stringify(uaLabels)}; owners ${JSON.stringify(SESSION_OWNERS)}; `
    + `app-owned labels get ${JSON.stringify(appLabels.map((l) => userAgentFor(l, env)))}`);

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

/**
 * THE QUEUE AND THE MEASUREMENT ARE TWO DIFFERENT WAITS, AND ONE STOPWATCH
 * CANNOT TIME BOTH.
 *
 * `flock LOCK -c '<electron>'` under a single timeout puts a COLLEAGUE'S suite
 * inside this suite's stopwatch. Measured on this box while a sibling agent held
 * the mutex for a long real-YouTube run: `exit null, no out/shell/report.json —
 * TIMEOUT after 120000 ms`, seven assertions in, about an app that was never
 * launched. That red costs an investigation to find out it is not a bug, and it
 * is AGENTS.md's "a gate whose verdict changes on code that did not change is
 * measuring the machine" from the other end.
 *
 * So the shell echoes `__WB_LOCKED__` the instant `flock` hands it the lock and
 * `exec`s the launch. The QUEUE gets its own, generous bound and its own
 * sentence; the LAUNCH's 120 s starts only once that marker arrives, because
 * that is the only part of this that is a measurement.
 *
 * `detached: true` + a process-GROUP kill, because `child.kill()` here kills
 * `flock` and leaves `xvfb-run`, `Xvfb` and the whole Electron tree running —
 * orphans that hold the mutex nobody is waiting on any more. Measured: two stray
 * Electron trees and a nineteen-minute hold, cleared by hand.
 */
/**
 * THIS GATE DOES NOT TOUCH GOOGLE, AND THAT IS A FLAG RATHER THAN A HOPE.
 *
 * The sign-in section of `tools/gate/probe.mjs` drives the source view at the
 * four hosts a Google sign-in goes through, because the only navigation the
 * allowlist ever sees is a renderer-initiated one. Those four are ALLOWED, so
 * without this they would really be dialled — a gate that reaches somebody
 * else's servers on every run, and one that would then be measuring Google's
 * availability as well as our own policy.
 *
 * `--host-resolver-rules` maps them to a closed loopback port instead. Nothing
 * is lost: `will-navigate` decides before the network and `did-start-navigation`
 * fires before DNS, so the guard's verdict — which is the entire claim — is
 * unchanged, and what follows it is an instant ERR_CONNECTION_REFUSED rather
 * than a TLS handshake with a third party. Port 1 is reserved and never
 * listening.
 */
const SIGN_IN_MAP = ['accounts.google.com', 'accounts.youtube.com', 'consent.youtube.com', 'myaccount.google.com']
  .map((h) => `MAP ${h} 127.0.0.1:1`).join(', ');
const launch = await run(
  'flock', [LOCK, '-c',
    `echo ${LOCK_MARK}; exec xvfb-run -a -s '-screen 0 1280x1024x24' ${sh(electron)} . `
    + `--gate=${sh(OUT)} --source-url=${sh(fixture)} --user-data=${sh(userData)} `
    + `--host-resolver-rules=${sh(SIGN_IN_MAP)}`],
  { cwd: ROOT, timeoutMs: 120000, queueMs: 900000, startOn: LOCK_MARK });
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

// ------------------------------------------------------- 2.1b the disguise
/**
 * SEED §9, OVER A RUNNING APP. Two assertions, because they fail for two
 * different reasons and only one of them is dangerous.
 *
 * The first is the FEATURE: without a stock Chrome user-agent on this partition
 * Google refuses sign-in outright ("this browser or app may not be secure",
 * policy since 2019) and YouTube Premium is unreachable inside the product.
 *
 * The second is the LIMIT, and it is the one worth having. `app.userAgentFallback`
 * is a single line that would put the same string on EVERY session at once —
 * including the one that carries the update check, the only request P1' permits.
 * A gate that only compared the source view's UA to a pattern would be green
 * over that line. So this reads OUR session and OUR renderers too, and it reads
 * the fallback itself.
 */
const UA = O(R.userAgent);
const uaMajor = String(O(UA.runtime).chrome || '').split('.')[0];
const CHROME_UA_SHAPE = /^Mozilla\/5\.0 \([^)]+\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/(\d+)\.0\.0\.0 Safari\/537\.36$/;
const uaSays = CHROME_UA_SHAPE.exec(String(UA.sourceSession));
ok('the source partition presents a STOCK CHROME user-agent — on the wire, on its WebContents and to the document  '
  + '[entry point: makeSession() in src/main/sessions.js, over src/main/useragent.js]',
  !!uaSays && uaSays[1] === uaMajor
  && !/Electron|stem-workbench/.test(String(UA.sourceSession))
  && UA.sourceWebContents === UA.sourceSession
  && O(UA.navigator).source === UA.sourceSession,
  `session "${UA.sourceSession}" · webContents ${UA.sourceWebContents === UA.sourceSession ? 'same' : `DIFFERS: ${UA.sourceWebContents}`}`
  + ` · navigator ${O(UA.navigator).source === UA.sourceSession ? 'same' : `DIFFERS: ${JSON.stringify(O(UA.navigator).source)}`}`
  + ` · running Chromium ${O(UA.runtime).chrome} · client hints (recorded, not asserted) ${JSON.stringify(O(UA.clientHints).source)}`);

ok("...and NOTHING of ours wears it: the app's own session, its renderers and app.userAgentFallback all still say Electron  "
  + '[entry point: the app-owned refusal in makeSession()]',
  /Electron\//.test(String(UA.appSession)) && !CHROME_UA_SHAPE.test(String(UA.appSession))
  && /Electron\//.test(String(UA.appFallback))
  && /Electron\//.test(String(O(UA.navigator).deck))
  && UA.appSession !== UA.sourceSession
  && eq(Object.keys(O(UA.factory)), ['youtube']),
  `app session "${UA.appSession}" · fallback "${String(UA.appFallback).slice(0, 60)}…" · `
  + `deck navigator "${String(O(UA.navigator).deck).slice(0, 60)}…" · the factory set a UA on ${JSON.stringify(Object.keys(O(UA.factory)))} — `
  + "the update check is this app's own traffic and goes to GitHub as what it is");

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
// THE INSTRUMENT FIRST, AND IT IS A SEPARATE CLAIM FROM THE ONE BELOW.
// Everything after this reads a list the gate's recorder collected on the deck.
// A recorder that never installed makes a WORKING bus report `0 of 1 arrived` —
// which is exactly what the old `window.__wbBusLog()` did for a whole wave,
// while `deck-host` and `deck-seam` were green. Two claims, two assertions: this
// one says the eye was open, the next says what it saw.
ok('INSTRUMENT CHECK: the gate\'s bus recorder installed on the deck, through the deck\'s own bridge  '
  + '[entry point: __wbDeck.onMessage in src/preload/deck.cjs]',
  O(O(R.bus).recorder).installed === true,
  JSON.stringify(O(R.bus).recorder));

const pings = A(O(R.bus).deckReceived).filter((m) => m && m.type === 'GATE_PING');
ok('a DETACHED send() from the engine reaches the deck\'s address  [entry point: createBus() in src/main/bus.js]',
  pings.length === 1,
  `${pings.length} of 1 arrived; addresses ${JSON.stringify(O(R.bus).addresses)}; `
  + 'sent as `const f = window.__wbEngine.send; f(msg)`');

ok('...and the envelope arrives exactly as sent — main rewrites nothing  [entry point: createBus()]',
  pings.length === 1 && eq(pings[0], O(R.bus).expectedPing),
  pings.length === 1 ? `sent ${JSON.stringify(O(R.bus).expectedPing)} got ${JSON.stringify(pings[0])}` : '(nothing arrived)');

// `delivered === 1` USED TO BE A CONJUNCT HERE AND IS NOT ANY MORE, and the
// removal is a correction rather than a weakening. It was true only while the
// engine window was INERT: `1` meant "the probe's own ping, and nothing else on
// the bus in this launch". The engine page now loads the vendored
// `offscreen/engine.js`, which broadcasts `HELLO`, `STATE` and `XF_STATE` to
// `to: 'ui'` from module scope, so the total is whatever a live engine happens
// to have said by the time the probe read it — measured at 6 on the run that
// caught this. An exact count over traffic the assertion does not control is a
// number that goes red for a reason outside its own claim, which is a red that
// costs an investigation to discover is not a bug.
//
// NOTHING IS LOST: "the good one got through" is asserted twelve lines above by
// `pings.length === 1`, which counts the PROBE's message and not the bus.
ok('...and a message whose protocol version is not 1 is dropped as malformed and counted  [entry point: createBus()]',
  O(O(O(R.bus).stats).dropped).malformed === 1,
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

/**
 * THE ALLOWLIST'S POSITIVE HALF, WITH A POSITIVE WITNESS.
 *
 * Everything else about this table is a refusal, and a refusal is easy to
 * measure. Seed §9 needs the opposite: that the sign-in flow can actually GO
 * where Google sends it. "Not in the refusal ledger" would not do — that is also
 * what a navigation nobody attempted looks like, and an allowlist that admitted
 * nothing at all would pass it. So the witness is `did-start-navigation`, which
 * fires only once the guard has let go (`src/main/youtube.js`), and the control
 * in the same section is the `includes()` trap driven for real:
 * `accounts.google.com.evil.test` is somebody else's host with our sign-in host
 * as a prefix, and it must be refused by the same guard in the same run.
 *
 * NO PACKET LEAVES THE BOX. The four are mapped to a closed loopback port by
 * `--host-resolver-rules` at the launch above; the guard decides before the
 * network, so the verdict is unchanged and the gate does not depend on Google.
 */
const SI = O(R.signin);
const attempted = A(SI.attempted);
const started = A(SI.started);
const reached = attempted.filter((u) => started.includes(u));
const refusedTrap = A(SI.refused).filter((r) => O(r).url === SI.offList);
ok('every host a Google sign-in is redirected through can be NAVIGATED TO from the source view, and the `includes()` trap '
  + 'cannot  [entry point: the will-navigate guard in createSourceView(), src/main/youtube.js]',
  attempted.length === 4 && reached.length === 4
  && refusedTrap.length === 1 && A(SI.refused).length === 1 && !started.includes(SI.offList),
  `${reached.length}/${attempted.length} started: ${attempted.map((u) => `${new URL(u).hostname}${reached.includes(u) ? '' : ' NOT-STARTED'}`).join(' ')}`
  + ` · ${SI.offList} -> ${refusedTrap.length === 1 ? 'refused' : `ADMITTED (${A(SI.refused).length} refusals in this section)`}`);

// -------------------------------------------------------- 2.7 what it drew
/**
 * THE ARM CONTROL IS LIVE, AND THAT IS A CORRECTION.
 *
 * This assertion used to require `disabled === true`, and it was green for a
 * whole wave after arming started working — while `src/main/deck-host.js`'s own
 * refusal text told the user *"Arm this Source first, from the Source menu or
 * the Arm button"* and `HOST-DESIGN.md` §6.4 called this button the first thing
 * the owner touches. An auditor clicked it on a real launch and nothing
 * happened. A gate that pins a defect in place is worse than no gate: it makes
 * fixing the defect look like a regression.
 *
 * The BEHAVIOUR — that clicking it really arms — is `smoke`'s, over the real
 * ipc path with the real Host. Here it is the markup and the bridge: present,
 * enabled, labelled `Arm`, and with a `__wbChrome.arm` to call.
 */
ok('the chrome bar painted, with its Arm control present, ENABLED and wired to a bridge  '
  + '[entry point: src/renderer/chrome.html + src/preload/chrome.cjs]',
  O(R.chromeDom).arm === true && O(R.chromeDom).armDisabled === false
  && String(O(R.chromeDom).armText).trim() === 'Arm' && O(R.chromeDom).armedAttr === '0'
  && O(R.chromeDom).bridgeArm === 'function' && /coi=true/.test(String(O(R.chromeDom).engine)),
  `arm=${O(R.chromeDom).arm} disabled=${O(R.chromeDom).armDisabled} text="${O(R.chromeDom).armText}" `
  + `data-armed=${O(R.chromeDom).armedAttr} bridge.arm=${O(R.chromeDom).bridgeArm} `
  + `engine="${O(R.chromeDom).engine}" deck="${O(R.chromeDom).deck}"`);

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
/**
 * `startOn` splits one wait into two: until that marker appears on the child's
 * output the clock that is running is `queueMs` and the message names the MUTEX;
 * from the marker on it is `timeoutMs` and the message names the LAUNCH. Callers
 * that pass neither get the old single stopwatch.
 *
 * The kill is a process-GROUP kill for the reason at the launch site above — AND
 * `detached: true` IS WHY THE SIGNAL HANDLERS BELOW ARE NOT OPTIONAL. A detached
 * child outlives its parent, so a `timeout`, a Ctrl-C or a killed harness would
 * leave a `flock` still QUEUED for the shared mutex, which then takes it and
 * launches Electron with nobody watching. Measured: one such orphan, sitting on
 * the queue for seven minutes after the suite that spawned it was gone.
 */
function run(bin, args, { cwd, timeoutMs, queueMs = 0, startOn = null }) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let out = '';
    let waiting = startOn;
    let timer = null;
    const stop = () => {
      // The group, not the process: `flock` is the child and the launch is its
      // grandchild through `sh`. Killing the one leaves the other running.
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
    };
    const arm = (ms, why) => {
      clearTimeout(timer);
      timer = setTimeout(() => { out += `\n[suite] ${why}\n`; stop(); }, ms);
    };
    arm(waiting ? queueMs : timeoutMs, waiting
      ? `NEVER TOOK THE SHARED BROWSER MUTEX after ${queueMs} ms — killing. Somebody else is holding ${LOCK}`
      : `TIMEOUT after ${timeoutMs} ms — killing`);
    const grab = (c) => {
      out += c.toString();
      if (waiting && out.includes(waiting)) {
        waiting = null;
        arm(timeoutMs, `TIMEOUT after ${timeoutMs} ms — killing`);
      }
    };
    child.stdout.on('data', grab);
    child.stderr.on('data', grab);

    // WE DIE, IT DIES. `exit` covers a normal end and an uncaught throw; the two
    // signals cover `timeout`, Ctrl-C and a harness being torn down. Removed on
    // close so a long plan does not accumulate handlers.
    const onExit = () => stop();
    const onSignal = () => { stop(); process.exit(130); };
    process.on('exit', onExit);
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    const finish = (res) => {
      clearTimeout(timer);
      process.off('exit', onExit);
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      resolve(res);
    };
    child.on('error', (e) => finish({ code: 127, out: `${out}\nspawn error: ${e.message}` }));
    child.on('close', (code) => finish({ code, out }));
  });
}
