#!/usr/bin/env node
/**
 * shell — the app skeleton, over ONE real launch of the real entry point.
 *
 * WHAT IT GATES. That `electron .` starts; that the window is one `BaseWindow`
 * with the three views in the stated order; that our four renderers are locked
 * down and the source view's page can see nothing of ours; that the `app://`
 * origin is cross-origin isolated in the DOCUMENT and inside a MODULE WORKER,
 * which is the half ORT's threaded wasm actually needs; that the `/file/` ROOT
 * hands the engine renderer a picked file's EXACT bytes over `app://` and refuses
 * the second fetch of a one-shot handle; that the capture grant
 * answers the engine with the SOURCE view's frame and refuses everybody else;
 * that the source view is muted BEFORE it loads anything; that a navigation off
 * the allowlist is refused rather than silently cancelled; and that seed §9's
 * SIGN-IN DISGUISE is on exactly one session — `persist:youtube` presents a
 * stock Chrome user-agent, nothing of ours does, and the four hosts Google's
 * sign-in is redirected through can really be navigated to. It then launches the
 * app A SECOND TIME on the same profile, because "the session persists across
 * restarts" is the one claim in seed §9 that a single launch cannot make at
 * all.
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
 *  33  sessions.js: never call setUserAgent                 -> the source partition presents stock Chrome (only)
 *  34  main.js: app.userAgentFallback = the stock UA        -> NOTHING of ours wears it
 *  35  navigation.js: drop accounts.google.com              -> the four sign-in hosts BY NAME, and the live navigation
 *  36  useragent.js: Chrome/<full version> not <major>.0.0.0 -> the disguise's shape, and the live one
 *  37  useragent.js: UA_SESSIONS gains 'app'                -> only USER-owned sessions (+ the app cannot boot)
 *  38  main.js: the partition is 'youtube', not 'persist:…'  -> the cookie survives a restart (+2)
 *  39  signin.js: drop __Secure-3PSID from SESSION_COOKIES  -> ...and the second boot reads SIGNED IN
 *  40  signin.js: the domain test becomes d.includes(base)  -> the sign-in verdict reads a Google session cookie
 *  41  signin.js: report the matched cookies, not their names -> ...and its answer never carries a VALUE
 *  42  files.js spend(): do not delete the spent entry        -> ONE handle buys ONE resolution (pure) AND
 *                                                                the SECOND fetch (live) — a second 200
 *  43  assets.js resolveHandle: drop the `tail.includes('/')` -> a `/file/` request is refused unless (pure)
 *  44  assets.js resolveHandle: drop the `if (!r.mime)`       -> refused unless (pure) + 403 over the wire (live)
 *  45  protocol.js: `contentType(hit.file)`, not `hit.mime`   -> the EXACT bytes (live) — served as octet-stream
 *  46  main.js: a SECOND createPathTokens() in boot()         -> the EXACT bytes, the SECOND fetch, and 403 (live)
 *
 * CASES 42-46 ARE THE `/file/` ROOT (slice S2), and 42 is the one the slice was
 * gated on: it makes a spent handle spendable again, and what goes red is a
 * SECOND `fetch()` COMING BACK 200 WITH THE FILE IN IT — not a flag reading
 * differently. 46 is the mistake this root is easiest to make: two token
 * registries, one minting and one spending, so every handle the intake ever
 * mints is unknown to the scheme.
 *
 * CASE 16 WENT FROM CAUGHT TO A MISS WHEN THE SIGN-IN SECTION LANDED, and the
 * battery is what said so — 0 reds over `shell: 45 passed, 0 failed`, on an
 * assertion the same case turns red on the tree without that section. The bar's
 * refusal row is satisfied by ANY `pushStatus()`, and `src/main/main.js` now
 * pushes on every `did-navigate` as well; the sign-in section drives four
 * ALLOWED navigations, so with `noteRefusal`'s push deleted the bar was painted
 * anyway, by a different caller, from the same `state.refusals`. The fix is in
 * `tools/gate/probe.mjs`: the chrome-bar read happens BEFORE that section, at
 * the only moment when `noteRefusal` is the only thing that could have painted
 * it. An assertion with two ways to be satisfied has to be asked at the moment
 * only one of them has happened.
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
 * 33 IS ALSO WHY THE SECOND ROW READS THE WAY IT DOES. Its first draft carried
 * `appSession !== sourceSession` and "the factory set one on exactly
 * ['youtube']", and 33 — which REMOVES the disguise — turned it red at the
 * moment its own claim, that our traffic is not disguised, was most true. Those
 * two conjuncts are on the first row now. An assertion that goes red while what
 * it says is true is an assertion nobody can act on, and the battery is what
 * found it.
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
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isAllowedNavigation, NAV_ALLOW } from '../../src/main/navigation.js';
import { UA_SESSIONS, userAgentFor, stockChromeUA, PLATFORM_TOKENS } from '../../src/main/useragent.js';
import { accountFromCookies } from '../../src/main/signin.js';
import { SESSION_OWNERS } from '../../src/main/p1.js';
import { resolveAppPath } from '../../src/main/assets.js';
import { createPathTokens } from '../../src/main/files.js';
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
/** ...and between the two launches, so a transcript says which one a line belongs to. */
const RESTART_MARK = '__WB_RELAUNCH__';

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

  /**
   * THE SIGN-IN VERDICT, AS A PURE FUNCTION — including the `includes()` trap,
   * which is the same trap the navigation allowlist has and lands in a different
   * place. `SID` on `google.com.evil.test` is somebody else's host with a Google
   * domain as a prefix; a domain test written as `d.includes('google.com')`
   * would read it as a signed-in Google session, and the app would then tell the
   * user it is signed in because a hostile page set one cookie.
   *
   * The anonymous row is the OTHER half and is not padding: `YSC`, `PREF` and
   * `VISITOR_INFO1_LIVE` are what anonymous YouTube sets on every visitor, so a
   * cookie list that included them would report everybody as signed in — an
   * estimator that saturates before the claim begins.
   */
  const JARS = [
    ['a real Google session cookie on youtube.com', [{ name: '__Secure-3PSID', domain: '.youtube.com' }], true],
    ['...and one on google.com', [{ name: 'SID', domain: '.google.com' }], true],
    ["anonymous YouTube's own cookies", [{ name: 'YSC', domain: '.youtube.com' },
      { name: 'PREF', domain: '.youtube.com' }, { name: 'VISITOR_INFO1_LIVE', domain: '.youtube.com' }], false],
    ['THE `includes()` TRAP', [{ name: 'SID', domain: 'google.com.evil.test' }], false],
    ['...and its dotted form', [{ name: 'SID', domain: '.youtube.com.evil.test' }], false],
    ['somebody else entirely', [{ name: 'SID', domain: '.example.com' }], false],
    ['an empty jar', [], false],
  ];
  const verdicts = JARS.filter(([, jar, want]) => accountFromCookies(jar).signedIn === want);
  ok('the sign-in verdict reads a Google session cookie on a Google domain, and NOTHING else — anonymous YouTube\'s own '
    + 'cookies, somebody else\'s host, and the `includes()` trap all read signed OUT  '
    + '[entry point: src/main/signin.js accountFromCookies()]',
    verdicts.length === JARS.length,
    `${verdicts.length}/${JARS.length}`
    + `${verdicts.length === JARS.length ? '' : ` — WRONG: ${JARS.filter((j) => !verdicts.includes(j)).map((j) => j[0]).join(', ')}`}`);

  /**
   * ...AND THE ANSWER CANNOT CARRY A CREDENTIAL. `PRIVACY.md` says this app never
   * reads the VALUE of a cookie, and the value of a Google session cookie is not
   * a fact about the session — it IS the session. `readAccount()` projects to
   * `{name, domain}` at the one place the jar is obtained so that this function
   * never has a value in scope; this drives it with one anyway, and looks for the
   * string anywhere in what comes back.
   */
  const CREDENTIAL = 'this-string-is-the-credential';
  const withValue = accountFromCookies([{ name: '__Secure-3PSID', domain: '.youtube.com', value: CREDENTIAL }]);
  ok("...and its answer never carries a cookie VALUE — PRIVACY.md's promise, driven with one and searched for  "
    + '[entry point: accountFromCookies()]',
    withValue.signedIn === true && !JSON.stringify(withValue).includes(CREDENTIAL),
    `fed a jar carrying ${JSON.stringify(CREDENTIAL)}; got back ${JSON.stringify(withValue)}`);

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

  /**
   * THE `/file/` ROOT AS A PURE FUNCTION — the second KIND of root, and the one
   * that has no directory at all.
   *
   * The store is the SHIPPED `createPathTokens()` out of `src/main/files.js`,
   * over a clock this suite holds, so what is driven here is the real minter and
   * the real one-shot rule rather than a stand-in for them. The three directory
   * roots are the same ones above, because `/file/` has to WIN the longest-prefix
   * comparison against `/` — a `/file/` root that lost it would quietly resolve
   * every handle into `src/renderer/` and 404 at `stat` time, which reads as a
   * missing file rather than as a broken table.
   */
  const store = createPathTokens({ now: () => 5_000_000 });
  const froots = [{ prefix: '/file/', resolve: (h) => store.spend(h) }, ...roots];
  const PICKED = '/music/Deep Cuts - Track 01.flac';
  const handle = store.mint(PICKED);
  const firstResolve = resolveAppPath('workbench', `/file/${handle}`, froots);
  const secondResolve = resolveAppPath('workbench', `/file/${handle}`, froots);
  ok('a `/file/` handle resolves to its absolute path and the ALLOWLIST\'s MIME, and ONE handle buys ONE resolution  '
    + '[entry point: src/main/assets.js resolveAppPath()]',
    firstResolve.file === PICKED && firstResolve.mime === 'audio/flac' && firstResolve.root === '/file/'
    && secondResolve.file === undefined && secondResolve.status === 404
    && String(secondResolve.why).startsWith('unknown-token:'),
    `first ${JSON.stringify(firstResolve)} · second ${JSON.stringify(secondResolve)}`);

  /**
   * THE SHAPES THAT NEVER REACH THE STORE, AND THE ONES THAT DO AND ARE REFUSED.
   *
   * The first three are refused on SHAPE — a tail that is empty or carries a `/`
   * is not one handle — and the counter check is the point of the assertion: a
   * traversal must not even be OFFERED to the token store, because "no path is
   * ever derived from the URL" is the containment property this root has instead
   * of a directory to be contained in.
   *
   * The last two do reach it. A handle nobody minted is 404 and reads EXACTLY
   * like a replay, which is deliberate; a handle whose file the File source's
   * allowlist cannot type is 403, because the handle was real and the file is
   * not one this Source takes.
   */
  const shapes = [
    ['a percent-encoded traversal', '/file/%2e%2e%2f%2e%2e%2fpackage.json'],
    ['a path rather than one handle', '/file/a/b'],
    ['an empty handle', '/file/'],
  ];
  const consultedBefore = { spent: store.stats.spent, refused: store.stats.refused };
  const shapeRefusals = shapes.map(([, p]) => resolveAppPath('workbench', p, froots));
  const consultedAfter = { spent: store.stats.spent, refused: store.stats.refused };
  const neverMinted = resolveAppPath('workbench', '/file/00000000-0000-4000-8000-000000000000', froots);
  const notAudio = resolveAppPath('workbench', `/file/${store.mint('/music/sleeve-notes.txt')}`, froots);
  ok('...and a `/file/` request is refused unless it is ONE live handle naming a file the allowlist admits  '
    + '[entry point: resolveAppPath()]',
    shapeRefusals.every((r) => r.status === 404 && r.file === undefined && /is not one/.test(String(r.why)))
    && eq(consultedBefore, consultedAfter)
    && neverMinted.status === 404 && String(neverMinted.why).startsWith('unknown-token:')
    && String(neverMinted.why) === String(secondResolve.why)
    && notAudio.status === 403 && notAudio.file === undefined && /cannot name/.test(String(notAudio.why)),
    `${shapes.map(([w], i) => `${w} -> ${shapeRefusals[i].status}`).join(', ')}; `
    + `the store was not consulted for any of them (spent ${consultedAfter.spent}, refused ${consultedAfter.refused}, `
    + 'unchanged); never-minted -> 404 word for word the same as a replay; '
    + `a .txt handle -> ${notAudio.status}`);
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
 * THE FILE THE `/file/` ROOT WILL BE ASKED FOR, AND THIS SUITE WRITES IT.
 *
 * The probe inside the launch mints a handle for this path over the app's own
 * registry and has the ENGINE RENDERER fetch it; what comes back is hashed
 * there. The comparison is only worth something because the bytes were written
 * HERE, in a different process, and are hashed HERE too — a probe that wrote the
 * file and then checked what came back would be one instrument agreeing with
 * itself.
 *
 * THREE MEGABYTES, NOT THREE HUNDRED. `Readable.toWeb(createReadStream())` in
 * `src/main/protocol.js` hands the body over in ~64 KiB chunks, so a file that
 * fits in one chunk would prove nothing about the streamed path — this one is
 * about fifty of them. It is a REAL 16-bit PCM WAV, header and all, because the
 * root's job is to serve a file the File source admits and `.wav` has to mean
 * `.wav`; the samples themselves are a deterministic LCG, which is what makes
 * the hash a fact about transport rather than about a random number generator.
 *
 * AND A SECOND FILE THE ALLOWLIST DOES NOT ADMIT. `src/main/files.js` answers
 * `mime: null` for a `.txt`, and a root that served it anyway would be handing
 * the renderer a byte stream to sniff.
 */
const FILE_FRAMES = 400_000;                       // 400k frames x 2ch x 2 bytes = 1.6 MB of samples
function fixtureWav(frames) {
  const data = Buffer.alloc(frames * 4);
  let x = 0x2f6e2b1;                               // a fixed seed: the same bytes on every run
  for (let i = 0; i < frames; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    data.writeInt16LE(((x >>> 16) & 0xffff) - 0x8000, i * 4);
    data.writeInt16LE(((x >>> 8) & 0xffff) - 0x8000, i * 4 + 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
  head.writeUInt16LE(2, 22); head.writeUInt32LE(44100, 24); head.writeUInt32LE(44100 * 4, 28);
  head.writeUInt16LE(4, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
const fileDir = path.join(OUT, 'library');
fs.mkdirSync(fileDir, { recursive: true });
const fileFixture = path.join(fileDir, 'Deep Cuts - Track 01.wav');
const fileNotAudio = path.join(fileDir, 'sleeve-notes.txt');
const fileBytes = fixtureWav(FILE_FRAMES);
fs.writeFileSync(fileFixture, fileBytes);
fs.writeFileSync(fileNotAudio, 'liner notes, not audio\n');
const fileSha = crypto.createHash('sha256').update(fileBytes).digest('hex');
// Inherited by the launch below — `run()` spawns without an `env` of its own.
process.env.WB_SHELL_FILE_FIXTURE = fileFixture;
process.env.WB_SHELL_FILE_NOTAUDIO = fileNotAudio;

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

/**
 * TWO LAUNCHES, ONE LOCK, AND THE SECOND ONE IS WHY THIS IS NOT TWO `run()`s.
 *
 * The restart claim (§3) needs a second launch over the same `--user-data`.
 * Written as a second `flock … -c` it would take the machine-global browser
 * mutex TWICE, and this was measured costing exactly what it looks like it
 * costs: on a box with six agents queueing, one run's second acquisition sat
 * behind a sibling's wedged Electron for the full 900 s bound and reported
 * `NEVER TOOK THE SHARED BROWSER MUTEX` — a red about the machine, on an
 * assertion about a cookie (stem-workbench#21 is the wedge; this is what a
 * second acquisition does to your exposure to it).
 *
 * So the shell runs both launches inside ONE hold: queue once, launch, launch,
 * release. The whole hold is the two launches back to back (~20 s), which is
 * strictly less lock-time than two acquisitions and half the chances of losing
 * the queue. `;` and not `&&` between them, deliberately: if the first launch
 * dies the second must still run, because "no report from launch 1" and "no
 * report from launch 2" are different assertions and both should be able to
 * say what they saw.
 */
const OUT2 = path.join(OUT, 'restart');
const launch = await run(
  'flock', [LOCK, '-c',
    `echo ${LOCK_MARK}; `
    + `xvfb-run -a -s '-screen 0 1280x1024x24' ${sh(electron)} . `
    + `--gate=${sh(OUT)} --source-url=${sh(fixture)} --user-data=${sh(userData)} `
    + `--host-resolver-rules=${sh(SIGN_IN_MAP)}; `
    + `echo ${RESTART_MARK}; `
    + `exec xvfb-run -a -s '-screen 0 1280x1024x24' ${sh(electron)} . `
    + `--gate=${sh(OUT2)} --gate-probe=restart --source-url=${sh(fixture)} --user-data=${sh(userData)}`],
  { cwd: ROOT, timeoutMs: 240000, queueMs: 900000, startOn: LOCK_MARK });
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
  && O(UA.navigator).source === UA.sourceSession
  && O(UA.factory).youtube === UA.sourceSession,
  `session "${UA.sourceSession}" · webContents ${UA.sourceWebContents === UA.sourceSession ? 'same' : `DIFFERS: ${UA.sourceWebContents}`}`
  + ` · navigator ${O(UA.navigator).source === UA.sourceSession ? 'same' : `DIFFERS: ${JSON.stringify(O(UA.navigator).source)}`}`
  + ` · the factory recorded ${JSON.stringify(O(UA.factory))}`
  + ` · running Chromium ${O(UA.runtime).chrome} · client hints (recorded, not asserted) ${JSON.stringify(O(UA.clientHints).source)}`);

/**
 * ITS CONJUNCTS ARE ALL ABOUT OURS, AND THAT IS A CORRECTION.
 *
 * This row first carried `appSession !== sourceSession` and "the factory set one
 * on exactly ['youtube']". Both went red under mutation 33 — which REMOVES the
 * disguise — at which point this assertion's own claim, that our traffic is not
 * disguised, was more true than ever. An assertion that goes red while what it
 * says is true is an assertion nobody can act on; the battery found it, and the
 * two conjuncts moved to the row above, where they are about the disguise being
 * present rather than about it being confined.
 */
ok("...and NOTHING of ours wears it: the app's own session, its renderers and app.userAgentFallback all still say Electron  "
  + '[entry point: the app-owned refusal in makeSession()]',
  /Electron\//.test(String(UA.appSession)) && !CHROME_UA_SHAPE.test(String(UA.appSession))
  && /Electron\//.test(String(UA.appFallback)) && !CHROME_UA_SHAPE.test(String(UA.appFallback))
  && /Electron\//.test(String(O(UA.navigator).deck))
  && !('app' in O(UA.factory)),
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

// ------------------------------------------------------------ the /file/ ROOT
/**
 * FILE BYTES REACH THE ENGINE RENDERER OVER `app://`, AND THE HASH IS THE CLAIM.
 *
 * The three assertions below are the live half of the two pure ones in §1: the
 * real protocol handler, the real registry, a real `fetch()` from the real
 * engine page — over a file THIS PROCESS wrote and hashed before the app
 * existed. `bytes` and `sha256` come back from `crypto.subtle` in the renderer,
 * so a truncated stream, a re-encoded one and an empty one are three different
 * numbers rather than three ways of getting `200`.
 *
 * THE LENGTH CONJUNCT IS THE DYNAMIC-RANGE GUARD. Two hashes of nothing are
 * equal, so the assertion also requires the fixture to be over a megabyte — the
 * claim is about a streamed body, and a fixture that fitted in one chunk would
 * be an assertion whose estimator saturates before the claim range begins.
 */
const FR = O(R.fileRoot);
const FF = O(FR.fetches);
const fileFirst = O(FF.first);
ok('a one-shot handle serves its file\'s EXACT bytes over app://, with the allowlist\'s MIME and this origin\'s '
  + 'isolation headers  [entry point: installAppProtocol() in src/main/protocol.js, over the `/file/` ROOT]',
  fileFirst.status === 200 && fileFirst.bytes === fileBytes.length && fileFirst.sha256 === fileSha
  && Number(fileFirst.len) === fileBytes.length && fileFirst.type === 'audio/wav'
  && fileFirst.coop === 'same-origin' && fileFirst.coep === 'require-corp' && fileFirst.corp === 'same-origin'
  && fileBytes.length > 1_000_000,
  `${fileFirst.status} ${fileFirst.type} ${fileFirst.bytes} of ${fileBytes.length} bytes `
  + `(content-length ${fileFirst.len}), sha256 ${String(fileFirst.sha256).slice(0, 16)}… `
  + `${fileFirst.sha256 === fileSha ? 'matches' : `!= ${fileSha.slice(0, 16)}…`} the ${fileBytes.length}-byte WAV `
  + `this suite wrote; coop=${fileFirst.coop} coep=${fileFirst.coep} corp=${fileFirst.corp}`);

/**
 * A REFUSAL HAS A BODY, AND ASSERTING `bytes === 0` WOULD BE ASSERTING THE WRONG
 * THING. `src/main/protocol.js` answers every refusal with the reason as
 * `text/plain`, so the second fetch comes back with ~74 bytes of sentence. What
 * has to be true is that those bytes are the REFUSAL AND NOT THE FILE, which is
 * three facts: the status, the content type, and a hash that is not the first
 * response's. Under the mutation that makes a handle reusable all three flip at
 * once, because what comes back is the file.
 */
const fileSecond = O(FF.second);
const fileNever = O(FF.neverMinted);
const isRefusal = (r) => /^text\/plain/.test(String(r.type)) && r.sha256 !== fileFirst.sha256;
ok('...and the SECOND fetch of that same handle is refused BY NAME, carrying the reason instead of the file — one '
  + 'handle, one response, and a replay is word for word what a handle nobody minted gets  '
  + '[entry point: createPathTokens() spend()]',
  fileSecond.status === 404 && isRefusal(fileSecond)
  && String(fileSecond.body).startsWith('unknown-token:')
  && fileNever.status === 404 && isRefusal(fileNever)
  && String(fileNever.body) === String(fileSecond.body)
  && O(FR.liveAfter).live === 0,
  `first ${fileFirst.status} ${fileFirst.type} ${fileFirst.bytes} bytes, then ${fileSecond.status} `
  + `${fileSecond.type} ${fileSecond.bytes} bytes: ${JSON.stringify(String(fileSecond.body).slice(0, 80))}; `
  + `a handle nobody minted -> ${fileNever.status} ${JSON.stringify(String(fileNever.body).slice(0, 40))}; `
  + `${O(FR.liveAfter).live} handles still live`);

const fileNotAudioR = O(FF.notAudio);
const fileNotHandle = O(FF.notAHandle);
ok('...and over the wire a handle for a file the allowlist does not admit is refused 403, while a `/file/` URL that '
  + 'is not one handle never becomes a path  [entry point: resolveAppPath() -> resolveHandle()]',
  fileNotAudioR.status === 403 && isRefusal(fileNotAudioR) && /cannot name/.test(String(fileNotAudioR.body))
  && fileNotHandle.status === 404 && isRefusal(fileNotHandle) && /is not one/.test(String(fileNotHandle.body))
  && FR.fixture === fileFixture && FR.notAudio === fileNotAudio,
  `${path.basename(fileNotAudio)} -> ${fileNotAudioR.status} ${fileNotAudioR.type} `
  + `${JSON.stringify(String(fileNotAudioR.body).slice(0, 60))}; `
  + `/file/%2e%2e%2f%2e%2e%2fpackage.json -> ${fileNotHandle.status} ${fileNotHandle.type} `
  + `${JSON.stringify(String(fileNotHandle.body).slice(0, 60))}; `
  + `tokens ${JSON.stringify(O(FR.statsAfter))}`);

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
 * THE WITNESS IS THE WIRE, and the obvious one was wrong. `did-start-navigation`
 * was tried first and it fires for a navigation `will-navigate` has already
 * cancelled (measured, Electron 44.0.0 — `src/main/youtube.js` records it), so
 * admitted and refused look identical through it. A ROW IN THE SESSION'S REQUEST
 * LOG cannot: a cancelled navigation never becomes a request, so a row is the
 * navigation having really reached Chromium's network stack.
 *
 * NO PACKET LEAVES THE BOX. The four are mapped to a closed loopback port by
 * `--host-resolver-rules` at the launch above, and `onBeforeRequest` fires
 * before the connection — so the verdict is unchanged and this gate does not
 * depend on Google being up, or on being online at all.
 */
const SI = O(R.signin);
const attempted = A(SI.attempted);
const onWire = A(SI.onTheWire).map((r) => O(r).url);
const reached = attempted.filter((u) => onWire.includes(u));
const refusedTrap = A(SI.refused).filter((r) => O(r).url === SI.offList);
ok('every host a Google sign-in is redirected through really goes ON THE WIRE from the source view, and the `includes()` '
  + 'trap never does  [entry point: the will-navigate guard in createSourceView(), src/main/youtube.js]',
  attempted.length === 4 && reached.length === 4
  && refusedTrap.length === 1 && A(SI.refused).length === 1 && !onWire.includes(SI.offList),
  `${reached.length}/${attempted.length} requested: ${attempted.map((u) => `${new URL(u).hostname}${reached.includes(u) ? '' : ' NEVER-REQUESTED'}`).join(' ')}`
  + ` · ${SI.offList} -> ${refusedTrap.length === 1 && !onWire.includes(SI.offList) ? 'refused, and nothing was requested'
    : `ADMITTED (${A(SI.refused).length} refusal(s), on the wire ${onWire.includes(SI.offList)})`}`);

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

// ==========================================================================
// 3. A SECOND LAUNCH, ON THE SAME PROFILE — does the sign-in survive a restart?
// ==========================================================================
/**
 * SEED §9 SAYS THE YOUTUBE SESSION PERSISTS ACROSS RESTARTS, and
 * stem-workbench#8 is deliberately unforgiving about how that may be shown:
 * *"Cookies set in the partition survive an app restart — asserted by READING
 * THEM BACK, not by asserting the partition string."* Nothing in a single launch
 * can say it. `persist:youtube` appearing in `main.js` is a claim about
 * INTENT — an in-memory partition is one word away and behaves identically for
 * the whole of the first run.
 *
 * So: the first launch seeded one marker cookie on its way out
 * (`tools/gate/probe.mjs`), and a SECOND launch over the same `--user-data`
 * reported the jar it found before the app had touched anything
 * (`tools/gate/restart.mjs`). Both ran inside ONE hold of the shared mutex — see
 * the launch above for why that is not two `run()` calls.
 *
 * IT IS ALSO THE ONLY PLACE ANY GATE REACHES `accountFromCookies`'s SIGNED-IN
 * BRANCH. No suite anywhere can sign in to Google — that test needs somebody's
 * real credentials — so without this second boot the app's signed-in path would
 * ship having never run. The marker is a real Google session cookie name on a
 * real Google domain, so the second launch's `state.account` is the product's
 * own verdict over a restored profile.
 */
let R2 = null;
try { R2 = JSON.parse(fs.readFileSync(path.join(OUT2, 'report.json'), 'utf8')); } catch { /* asserted below */ }

const seed = O(R.cookieSeed);
const backAgain = A(O(R2).cookiesAtStart).filter((c) => O(c).name === seed.name && O(c).domain === seed.domain);
ok('a cookie written into persist:youtube is STILL THERE after the app has quit and started again — read back by name '
  + 'and domain over a second launch, never inferred from the partition string  '
  + '[entry point: makeSession(\'youtube\', \'persist:youtube\') in boot(), over two launches sharing one --user-data]',
  seed.ok === true && R2 !== null && backAgain.length === 1,
  seed.ok !== true ? `THE SEED ITSELF FAILED, so nothing was asked of the restart: ${JSON.stringify(seed)}`
    : R2 === null ? `exit ${launch.code}, no ${path.relative(ROOT, path.join(OUT2, 'report.json'))}`
      + ` — did the second launch even start? ${launch.out.includes(RESTART_MARK) ? 'yes' : 'NO'};`
      + ` last line: ${lastLine(launch.out)}`
      : `seeded ${seed.name} on ${seed.domain}; the second launch found `
        + `${A(O(R2).cookiesAtStart).length} cookie(s) ${JSON.stringify(A(O(R2).cookiesAtStart))}`
        + ` (a cookie with no expirationDate would be a SESSION cookie and would not survive at all)`);

ok('...and the app makes the right thing of it on that second boot: the jar that read ANONYMOUS the first time reads '
  + 'SIGNED IN the second, and names the cookie it found — the only path anywhere that reaches the signed-in branch  '
  + '[entry point: readAccount() in src/main/signin.js]',
  O(O(R).account).signedIn === false && O(O(R2).account).signedIn === true
  && A(O(O(R2).account).session).includes(seed.name),
  `first launch ${JSON.stringify(O(R).account)} · second launch ${JSON.stringify(O(R2).account)}`);

console.log(`\n${ID}: launch log ${path.relative(ROOT, path.join(OUT, 'launch.log'))} · `
  + `report ${path.relative(ROOT, reportPath)} · screenshots ${path.relative(ROOT, OUT)}/{chrome,source,deck}.png · `
  + `restart report ${path.relative(ROOT, path.join(OUT2, 'report.json'))} (both launches are in the one launch log)`);
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
