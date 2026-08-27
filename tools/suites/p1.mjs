#!/usr/bin/env node
/**
 * p1 — RULE P1', over one real launch: the app's own code talks to exactly one
 * named host, GitHub Releases, for the update check, and nothing else.
 *
 * The extension's `CONTRIBUTING.md` states P1 as *"an acceptance test, not an
 * aspiration"* and this is the desktop successor of it. What changed is the
 * shape of the claim, not its strength: the extension had ONE session and one
 * network path (the weights). This app has TWO sessions, and the second one is
 * a browser that loads youtube.com — so the rule had to name what it excludes,
 * and the exclusion had to become testable, or "one host" would quietly mean
 * "one host plus whatever the view did".
 *
 * ---------------------------------------------------------------------------
 * WHAT MAKES THIS DIFFERENT FROM A TEST THAT PASSES BY NOT LOOKING
 * ---------------------------------------------------------------------------
 * "No request except X" over an app that made no requests is green. So is the
 * same assertion over an observer that was never installed. **Those two and a
 * genuine pass are the same transcript**, and every structural decision below is
 * about telling them apart:
 *
 *   · the observation set must be NON-EMPTY (assertion 2) — the same `[1-9]`
 *     rule the runner's own VOID regex encodes, one level in;
 *   · the update request must have reached a FAKE HOST IN ANOTHER PROCESS
 *     (assertion 4), which is evidence the instrument did not produce. Host hit
 *     + instrument silent is a RED, and it is the only shape that catches an
 *     observer that has stopped being installed;
 *   · the exclusion is exercised with THE SAME URL through both sessions
 *     (assertion 6), so the control can lose: written as a URL substring instead
 *     of a session label, the youtube half still passes and the app half stops
 *     failing;
 *   · every session the app makes is COUNTED against the listeners installed
 *     (assertion 10), because Electron cannot enumerate its own sessions and a
 *     session nobody watched reads exactly like a session that made no requests;
 *   · ...AND THE OBSERVER'S OWN BLIND SPOT IS MEASURED (§3.7). `session.webRequest`
 *     is a property of a CHROMIUM session; a `fetch()` in the main process is
 *     undici, in this process, and never enters it. Two independent audits
 *     defeated this file with ONE LINE in `src/main/main.js` and watched a real
 *     request reach a real host while it printed `19 passed, 0 failed`. The
 *     answer is `src/main/netguard.js`, a scan, and a REAL LOOPBACK SINK in this
 *     suite's own process that must record exactly one connection — ours.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT GATE, stated so the absence is on the record
 * ---------------------------------------------------------------------------
 *   · THE REAL GITHUB. The check is pointed at a local TLS server wearing
 *     `UPDATE_HOST`'s certificate, by `--host-resolver-rules`. Nothing here
 *     proves GitHub answers, and nothing should: a gate that needs the internet
 *     is a gate that goes red for somebody else's reasons.
 *   · THE UPDATE DOWNLOAD. There is no downloader yet. PRIVACY.md says the
 *     download follows GitHub's redirect to its asset host; when that lands it
 *     is a second origin and this suite has to grow an assertion, not a
 *     tolerance.
 *   · REAL YOUTUBE TRAFFIC. The source view loads the local fixture. The
 *     `youtube`-labelled control below is synthetic on purpose — the claim is
 *     about the LABEL, and a claim about the label needs no YouTube at all.
 *   · WHAT THE UPDATE REQUEST CARRIES. That it sends no installation identifier
 *     is a property of two lines in `src/main/update.js` and is asserted by
 *     reading them (assertion 9), not by parsing what Chromium put on the wire.
 *
 * ---------------------------------------------------------------------------
 * WATCHED RED BY MUTATION — every assertion below, with the edit that broke it
 * ---------------------------------------------------------------------------
 * Reproduce all of them with `tools/suites/p1-mutations.sh`. Run on 2026-08-26
 * against Electron 44.0.0 on Linux: 24 of 24 mutations caught, 24 of 24
 * assertions watched red, `tools/suites/coverage.py` clean.
 *
 *   1  p1.js: allow http instead of https                -> the one host is admitted (+3)
 *   2  p1.js: hostname.includes(UPDATE_HOST)             -> the two host-match traps
 *   3  p1.js: bind every scheme, not just network ones   -> local schemes (+ the app cannot boot)
 *   4  p1.js: bind the user's session too                -> nothing is refused on a user session (+2)
 *   5  main.js: session.fromPartition, not the factory   -> the source scan (+ the boot throws)
 *   6  sessions.js: re-type 'api.github.com'             -> spelled in exactly one file
 *   7  main.js: crashReporter.start(...)                 -> no crash reporter
 *   8  update.js: an x-install header                    -> no identifier on the request
 *   9  chrome.html: a Google Fonts <link>                -> our pages name no external origin
 *  10  gate/p1.mjs: write no report                      -> the suite FAILS, not exits 0
 *  11  sessions.js: observe the app session only         -> sessions == listeners (+2)
 *  12  main.js: fetch a webfont at boot                  -> the set of hosts
 *  13  main.js: stub the update check out                -> the set is NON-EMPTY (+3)
 *  14  sessions.js: stop recording https                 -> THE COULD-IT-LOOK GUARD (+3)
 *  15  update.js: stop reading the body                  -> the check really completed
 *  16  p1.js: exclusion by URL substring, not by owner   -> the two-session pair (+2)
 *  17  sessions.js: record the cancel, do not apply it   -> the fake host was reached once
 *  18  sessions.js: filter the listener down to https:   -> the observer covers renderers
 *  19  assets.js: connect-src 'self' https:              -> the CSP is the layer that answered
 *  20  main.js: a bare fetch() to a second host          -> the bare-transport scan (+ the boot throws)
 *  21  netguard.js: take() installs nothing, + case 20   -> the guard, its refusals, AND THE SINK (+1)
 *  22  storage.js: import https from 'node:https'        -> the node-network-module scan
 *  23  storage.js: a bare fetch(), never called          -> the bare-transport scan
 *  24  netguard.js: refuse a pipe as well as a port      -> the guard is too wide
 *
 * CASE 21 IS THE AUDIT, RE-RUN AS A GATE. Two independent reviewers defeated
 * this suite with ONE LINE in `src/main/main.js` — `fetch('http://127.0.0.1:…
 * /telemetry-from-main')`, and `fetch('https://example.com/audit-beacon')` — and
 * both watched a real request reach a real host while this file printed
 * `19 passed, 0 failed`. Everything §1-§3.6 observes rides
 * `session.webRequest`, which is a property of a CHROMIUM session; undici in the
 * main process never enters it. §3.7 and `src/main/netguard.js` are the answer,
 * and case 21 is the proof they can lose: with the guard neutered the sink in
 * the SUITE's process logs `GET /telemetry-from-main` and three assertions go
 * red over it.
 *
 * TWO MORE OF THEM ARE THE POINT OF THE WHOLE FILE. Case 14 leaves the wire alone and
 * stops the OBSERVER seeing https: the fake host is still hit, the app still
 * behaves, and the only thing that changes is that the instrument has gone
 * blind — which is the failure every "no request except X" test has by default.
 * Case 17 is its mirror: the log still reads `cancelled: true` and only the fake
 * host's counter disagrees, so the assertion that survives it is the one that
 * asked something outside the app.
 *
 * CASES 3 AND 5 TAKE THE APP DOWN, and that is reported rather than tidied
 * away: with `app://` cancelled the app has no pages, and with the youtube
 * session taken outside the factory `sessions.onRequest('youtube')` throws at
 * boot. Both are the right shape of failure — loud, at the line that caused it —
 * and the suite reports "the app launches and writes a report" red alongside the
 * assertion the case was written for.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { UPDATE_HOST, UPDATE_URL } from '../../src/main/update.js';
import { mayRequest, violations, SESSION_OWNERS, NETWORK_SCHEMES } from '../../src/main/p1.js';
import { startP1Host } from '../p1-host.mjs';
import { startP1Sink } from '../p1-sink.mjs';
import { BROWSER_LOCK, announceLock } from '../lib/locks.mjs';
import { refuseIfCompromised } from '../lib/tree-guard.mjs';

const ID = 'p1';
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

/**
 * The host the app must NEVER reach, which this suite makes reachable anyway.
 * It is a `.invalid` TLD (RFC 2606) so that a resolver rule going missing fails
 * as "no such host" rather than as somebody's real server.
 */
const BAD_HOST = 'telemetry.invalid';
const BAD_URL = `https://${BAD_HOST}/both-sessions`;

/** The shared browser mutex — one path, `tools/lib/locks.mjs`, never spelled here. */
const LOCK = BROWSER_LOCK;
// One line, and only when this run has stepped out of the shared queue — a run
// holding the wrong mutex looks exactly like a run making progress. See tools/lib/locks.mjs.
announceLock();

/**
 * SET BY `tools/suites/p1-mutations.sh`, WHICH HOLDS THE LOCK FOR ITS WHOLE RUN.
 *
 * `flock` is not reentrant across processes: a battery that took the mutex and
 * then ran a suite that takes it again would wait for itself, for ever. The
 * holder says so and the suite runs bare — twenty launches inside one lock hold
 * rather than twenty separate acquisitions, which is also the neighbourly
 * arrangement on a shared box.
 */
const LOCK_HELD = process.env.STEM_WORKBENCH_LOCK_HELD === '1';

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

/** A report field is not a promise — see `tools/suites/shell.mjs`, case 27. */
const A = (v) => (Array.isArray(v) ? v : []);
const O = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const uniq = (a) => [...new Set(a)].sort();

/**
 * Comments stripped, so a source scan cannot be satisfied or defeated by prose.
 * The same shape the vendored `tools/unit-check.mjs` uses for its "no bare
 * `chrome.*`" scan, and for the same reason: every file below is full of
 * paragraphs that name the very strings being searched for.
 */
const strip = (src) => String(src)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

/** Every `.js`/`.cjs` under `src/`, sorted, repo-relative. The scan names them. */
function appSources() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (/\.(js|cjs|mjs)$/.test(e.name)) out.push(path.relative(ROOT, abs));
    }
  };
  walk(path.join(ROOT, 'src'));
  return out;
}

// ==========================================================================
// 1. THE POLICY, AS A PURE FUNCTION — no launch, no display, no mutex
// ==========================================================================
{
  const allowed = [UPDATE_URL, `https://${UPDATE_HOST}/`, `https://${UPDATE_HOST}/anything?q=1`];
  const admitted = allowed.filter((u) => mayRequest('app', u));
  ok(`the one host P1' allows is admitted on an app-owned session  [entry point: src/main/p1.js mayRequest()]`,
    admitted.length === allowed.length, `${admitted.length}/${allowed.length} — ${UPDATE_HOST}`);

  const refused = [
    BAD_URL,
    'https://fonts.googleapis.com/css',
    'https://sentry.io/api/1/store/',
    `http://${UPDATE_HOST}/`,                      // a downgrade is not this app's one host
    `https://${UPDATE_HOST}.evil.test/`,           // the `endsWith` trap
    `https://evil${UPDATE_HOST}/`,                 // the `includes` trap
    `https://${UPDATE_HOST}@evil.test/`,           // userinfo: the hostname is `evil.test`
    `wss://${UPDATE_HOST}/socket`,                 // a WebSocket is how telemetry actually arrives
    'ws://telemetry.invalid/socket',
  ];
  const held = refused.filter((u) => !mayRequest('app', u));
  ok('...and every other network URL is refused, including the two host-match traps and a WebSocket  [entry point: mayRequest()]',
    held.length === refused.length,
    `${held.length}/${refused.length}${held.length === refused.length ? '' : ` — ADMITTED ${refused.filter((u) => mayRequest('app', u)).join(' ')}`}`);

  const local = ['app://workbench/engine.html', 'blob:app://workbench/x', 'data:text/plain,x',
    'devtools://devtools/bundled/x.js', 'file:///tmp/x', 'not a url at all'];
  const passed = local.filter((u) => mayRequest('app', u));
  ok("...and a scheme that never leaves the machine is not P1's business, so the app is not broken to protect nothing",
    passed.length === local.length, `${passed.length}/${local.length}: ${NETWORK_SCHEMES.join(' ')} are the schemes it binds`);

  const userAll = [...refused, ...allowed].filter((u) => mayRequest('user', u));
  ok("...and NOTHING is refused on a user-owned session — the YouTube partition is excluded by OWNER, not by URL  [entry point: SESSION_OWNERS]",
    userAll.length === refused.length + allowed.length,
    `${userAll.length}/${refused.length + allowed.length}; owners ${JSON.stringify(SESSION_OWNERS)}`);
}

// ==========================================================================
// 2. THE SOURCE SCANS — no launch needed, and they are what keep §3 honest
// ==========================================================================
const FILES = appSources();
{
  // THE FACTORY IS THE ONLY PLACE A SESSION IS NAMED. Without this, §3's
  // "every session the app creates" is a claim about the sessions somebody
  // remembered to route through the factory.
  const FACTORY = 'src/main/sessions.js';
  const namers = FILES.filter((f) => {
    if (f === FACTORY) return false;
    const src = strip(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    return /session\.fromPartition\s*\(/.test(src) || /session\.defaultSession/.test(src)
      || /\bfromPartition\s*\(/.test(src);
  });
  ok(`no file but ${FACTORY} names a session at all — so "every session the app creates" is a closed set  `
    + '[entry point: a scan of every .js/.cjs under src/, comments stripped]',
    namers.length === 0,
    `${FILES.length} files scanned (${FILES.join(' ')})${namers.length ? ` — NAMED IN ${namers.join(' ')}` : ''}`);

  // THE UPDATE HOST IS SPELLED ONCE. A second literal is how a re-point moves
  // the policy and leaves the assertion pointing at the old name.
  const spellers = FILES.filter((f) => strip(fs.readFileSync(path.join(ROOT, f), 'utf8')).includes(UPDATE_HOST));
  ok(`'${UPDATE_HOST}' is spelled in exactly one file under src/, and this suite imports it rather than re-typing it  `
    + '[entry point: src/main/update.js UPDATE_HOST]',
    spellers.length === 1 && spellers[0] === 'src/main/update.js',
    `spelled in ${spellers.length ? spellers.join(' ') : '(nowhere — the constant is gone)'}`);

  // NO CRASH REPORTER, EVER. It is the one telemetry channel an Electron app
  // gets by writing two words, and it uploads to a host nobody chose.
  const reporters = FILES.filter((f) => {
    const src = strip(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    return /crashReporter/.test(src) || /crashDumps/.test(src) || /setUploadToServer/.test(src);
  });
  ok('crashReporter is never started and crashDumps is never asked for  '
    + '[entry point: the same scan of every .js/.cjs under src/, comments stripped]',
    reporters.length === 0,
    `${FILES.length} files scanned${reporters.length ? ` — FOUND IN ${reporters.join(' ')}` : ''}`);

  // THE UPDATE REQUEST CARRIES NO IDENTIFIER. Read out of the file rather than
  // off the wire: what is not there cannot be observed arriving.
  const upd = strip(fs.readFileSync(path.join(ROOT, 'src', 'main', 'update.js'), 'utf8'));
  const smells = ['machineId', 'getMachineId', 'randomUUID', 'installId', 'userAgent', 'setUserAgent', 'Cookie'];
  const found = smells.filter((k) => upd.includes(k));
  ok('...and the update request is built with one header and no identifier — no machine id, no install id, no UA override  '
    + '[entry point: src/main/update.js, comments stripped]',
    found.length === 0 && /accept:/.test(upd),
    found.length ? `FOUND ${found.join(' ')}` : 'one header: accept');

  // OUR OWN PAGES REFERENCE NO EXTERNAL ORIGIN. The CSP forbids it at runtime;
  // this says nobody wrote one down, which is the half a CSP relaxation would
  // silently un-forbid.
  const pages = fs.readdirSync(path.join(ROOT, 'src', 'renderer'))
    .filter((f) => /\.(html|css)$/.test(f)).sort();
  const external = [];
  for (const f of pages) {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'renderer', f), 'utf8');
    for (const m of src.matchAll(/https?:\/\/[^\s"'<>)]+/g)) external.push(`${f}: ${m[0]}`);
  }
  ok('the app\'s own pages reference no external origin — no font, no CDN, no analytics tag  '
    + '[entry point: a scan of every .html/.css under src/renderer]',
    external.length === 0,
    `${pages.length} files scanned (${pages.join(' ')})${external.length ? ` — FOUND ${external.join(', ')}` : ''}`);

  /**
   * =======================================================================
   * THE TRANSPORT THAT LEAVES CHROMIUM — the hole two audits walked through
   * =======================================================================
   * Everything above and everything in §3 rides `session.webRequest`. That
   * observer is a property of a CHROMIUM SESSION, so a `fetch()` or a
   * `node:https.request()` in the main process is not merely unobserved, it is
   * UNOBSERVABLE — and both auditors proved it rather than arguing it: one line
   * added to `src/main/main.js` reached a real second host, and this suite
   * reported `19 passed, 0 failed` over it while still printing "reached exactly
   * { https://api.github.com }".
   *
   * `src/main/netguard.js` takes those transports away at boot and §3.7 drives
   * every one of them at a real loopback sink. THIS pair is the static half, and
   * it is not redundant with the runtime half: a scan sees the import a guard
   * cannot reach (`import { request } from 'node:https'` is a live binding on
   * this runtime, which was measured — but that is Node's property, not ours),
   * and the guard sees a reach the regex missed.
   */
  const NET_MODULES = /(?:^|[^\w$])(?:require\s*\(\s*['"`]|from\s+['"`]|import\s*\(\s*['"`])(?:node:)?(http|https|net|tls|dgram|http2)['"`]/;
  const netImporters = FILES.filter((f) => NET_MODULES.test(strip(fs.readFileSync(path.join(ROOT, f), 'utf8'))));
  ok('NO file under src/ imports a node network module — http, https, net, tls, dgram or http2  '
    + '[entry point: the same scan of every .js/.cjs/.mjs under src/, comments stripped]',
    netImporters.length === 0,
    `${FILES.length} files scanned${netImporters.length ? ` — IMPORTED IN ${netImporters.join(' ')}` : ''}`
    + ' (a transport that leaves Chromium leaves the instrument)');

  /**
   * `Session.fetch` IS THE ONE TRANSPORT, AND IT IS A MEMBER CALL. The negative
   * lookbehind is what separates `ses.fetch(` — Chromium's stack, observed —
   * from a bare `fetch(`, which is undici in this process and is not.
   */
  const MAIN_FILES = FILES.filter((f) => f.startsWith(`src${path.sep}main${path.sep}`));
  const BARE_FETCH = /(?<![.\w$])fetch\s*\(/;
  const ELECTRON_NET = /(?<![.\w$])net\s*\.\s*(?:request|connect|isOnline)\s*\(/;
  const callers = MAIN_FILES.filter((f) => {
    const src = strip(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    return BARE_FETCH.test(src) || ELECTRON_NET.test(src);
  });
  const sessionFetchers = MAIN_FILES.filter((f) => /\.\s*fetch\s*\(/.test(strip(fs.readFileSync(path.join(ROOT, f), 'utf8'))));
  ok('...and no file under src/main/ calls a bare `fetch(` or Electron\'s `net.request(` — the app has exactly ONE '
    + 'network transport and it is `Session.fetch` in src/main/update.js  [entry point: the same scan, src/main/ only]',
    callers.length === 0 && sessionFetchers.length === 1 && sessionFetchers[0] === 'src/main/update.js',
    `${MAIN_FILES.length} main-process files scanned; \`.fetch(\` in ${sessionFetchers.join(' ') || '(nowhere — the one transport is gone)'}`
    + `${callers.length ? ` — BARE CALL IN ${callers.join(' ')}` : ''}`);
}

// ==========================================================================
// 3. ONE REAL LAUNCH, BEHIND A FAKE HOST WEARING `UPDATE_HOST`'s CERTIFICATE
// ==========================================================================
const electron = path.join(ROOT, 'node_modules', '.bin', 'electron');
if (!fs.existsSync(electron)) skip('electron is not installed — npm i');
if (!hasBin('xvfb-run')) skip('xvfb-run is not on PATH and this box has no DISPLAY');
if (!hasBin('flock')) skip('flock is not on PATH — the shared browser mutex cannot be taken');
if (!hasBin('openssl')) skip('openssl is not on PATH — the fake update host cannot mint a certificate');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const userData = path.join(OUT, 'userdata');
const fixture = pathToFileURL(path.join(ROOT, 'tools', 'fixture', 'player.html')).href;

/**
 * The body the fake host answers with. Named HERE and asserted below, because
 * "the check completed" is a claim about bytes that came back from a server in
 * another process — not about a status code the app could have invented.
 */
const FAKE_TAG = 'v0.0.0-fake-from-the-p1-host';
/**
 * AN ARRAY, because `UPDATE_PATH` is the LIST endpoint. `/releases/latest`
 * answered a single object and could never return a pre-release (GitHub defines
 * it as the newest NON-prerelease), so `src/main/update.js` reads the list and
 * `pickRelease()` makes the channel decision. The fixture is a PRE-RELEASE for
 * that reason: the tag only comes back if the beta channel really offered one,
 * so this transcript is evidence about the channel as well as about the host.
 */
const host = await startP1Host([UPDATE_HOST, BAD_HOST],
  [{ tag_name: FAKE_TAG, draft: false, prerelease: true, published_at: '2026-08-26T00:00:00Z' }]);
/**
 * THE SECOND WITNESS, AND IT IS DELIBERATELY DUMB — `tools/p1-sink.mjs`.
 *
 * The fake TLS host above is reached through `--host-resolver-rules`, a
 * CHROMIUM switch. Everything that leaves Chromium ignores it, which is exactly
 * the traffic §3.7 is about: a `node:https` call from main resolves through the
 * OS, so pointing it at `telemetry.invalid` would fail with a DNS error and the
 * control would pass by not looking. A loopback port cannot fail that way — if
 * the transport is not refused, the connection lands here and is counted.
 */
const sink = await startP1Sink();
let launch;
let lock;
try {
  /**
   * THE QUEUE AND THE MEASUREMENT ARE TWO DIFFERENT WAITS, AND ONLY ONE OF THEM
   * IS THIS SUITE'S BUSINESS.
   *
   * `flock … -c 'xvfb-run … electron …'` under one timeout puts a colleague's
   * suite inside our stopwatch: on a shared box the mutex can be held for
   * minutes, and the suite then reports "the app did not start" about an app it
   * never launched. That is a red that costs an investigation to discover is not
   * a bug — CONTRIBUTING.md's "a gate whose verdict changes on code that did not
   * change is measuring the machine", from the other end.
   *
   * So the lock is taken by a child that holds it until its stdin closes, and
   * THAT wait is unbounded because it is a queue. The launch that follows gets a
   * real timeout, because that one is a measurement.
   */
  lock = LOCK_HELD ? null : await takeLock(LOCK);
  launch = await run(
    'bash', ['-c',
      `xvfb-run -a -s '-screen 0 1280x1024x24' ${sh(electron)} . `
      + `--gate=${sh(OUT)} --gate-probe=p1 --update-check `
      + `--source-url=${sh(fixture)} --user-data=${sh(userData)} `
      + host.chromiumArgs.map(sh).join(' ')],
    {
      cwd: ROOT,
      timeoutMs: Number(process.env.STEM_WORKBENCH_LAUNCH_TIMEOUT_MS || 180000),
      /**
       * THE SINK'S ADDRESS REACHES THE PROBE, NOT THE PRODUCT. Nothing under
       * `src/` reads this variable — `tools/suites/capture-mute.mjs` assertion 9
       * scans for exactly that shape and would go red — and `tools/gate/p1.mjs`
       * is imported only under `--gate`, which is dead in a packaged build.
       */
      env: { ...process.env, STEM_WORKBENCH_P1_SINK: sink.url('/') },
    });
} finally {
  if (lock) lock.release();
  // The counters are read AFTER the app is gone, so nothing can still be in
  // flight when they are compared.
  host.close();
}
/**
 * ...AND THE SINK IS PROVED TO WORK, from this process, AFTER the app is gone.
 * "The sink recorded nothing" and "the sink was never listening" are the same
 * transcript, and this suite exists because two auditors found exactly that
 * shape of blindness one level up. One request of our own, and the assertion
 * below reads BOTH numbers.
 */
let sinkControl = null;
try {
  const res = await fetch(sink.url('/the-suites-own-control'));
  sinkControl = { ok: res.ok, status: res.status };
} catch (err) { sinkControl = { ok: false, error: String((err && err.message) || err) }; }
const sinkRequests = sink.requests.slice();
const sinkConnections = sink.connections.length;
sink.close();
fs.writeFileSync(path.join(OUT, 'launch.log'), launch.out);
fs.writeFileSync(path.join(OUT, 'host-hits.json'), `${JSON.stringify(host.hits, null, 2)}\n`);

const reportPath = path.join(OUT, 'report.json');
let R = null;
try { R = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch { /* asserted below */ }

ok('the app launches from its real entry point and writes a P1 report  [entry point: `electron .` -> src/main/main.js]',
  R !== null && R.gate === 1 && R.probe === 'p1',
  R ? `exit ${launch.code}, ${A(R.log).length} observed requests, ${host.hits.length} reached the fake host`
    : `exit ${launch.code}, no ${path.relative(ROOT, reportPath)} — last line: ${lastLine(launch.out)}`);
if (!R) done();

// --------------------------------------------------- 3.1 the instrument itself
const F = O(R.factory);
ok('every session the app made got a listener, and there are at least two of them  '
  + '[entry point: makeSession() in src/main/sessions.js]',
  F.created >= 2 && F.created === F.listeners && F.twoDistinctSessions === true,
  `${F.created} sessions created, ${F.listeners} listeners installed, labels ${JSON.stringify(F.labels)} `
  + `(app storage ${F.appStoragePath}, youtube storage ${F.ytStoragePath})`);

// --------------------------------------------------- 3.2 THE CLAIM
const sessionRows = A(R.sessionLog);
const appRows = sessionRows.filter((r) => O(r).owner === 'app');
const appOrigins = uniq(appRows.filter((r) => NETWORK_SCHEMES.includes(O(r).scheme)).map((r) => O(r).origin));
const WANT = [`https://${UPDATE_HOST}`];

ok('over a full session — boot, the vendored deck and engine, the source view playing, the transport, the model read — '
  + `the app's own sessions reached exactly { https://${UPDATE_HOST} }  [entry point: the whole app]`,
  appOrigins.length === WANT.length && appOrigins.every((o, i) => o === WANT[i]),
  appOrigins.length === 1 && appOrigins[0] === WANT[0]
    ? `${appRows.length} app-owned requests, ${appOrigins.length} network origin: ${appOrigins.join(' ')} `
      + `(local schemes seen: ${uniq(appRows.map((r) => O(r).scheme).filter((s) => !NETWORK_SCHEMES.includes(s))).join(' ') || 'none'})`
    : `GOT ${JSON.stringify(appOrigins)} — violations: ${JSON.stringify(violations(appRows).map((v) => `${v.url} <- wc#${v.webContentsId} ${v.frame || ''}`))}`);

ok('...and that set is NON-EMPTY: a "no request except X" assertion over zero observations passes by not looking',
  appOrigins.length >= 1 && appRows.filter((r) => NETWORK_SCHEMES.includes(O(r).scheme)).length >= 1,
  `${appRows.filter((r) => NETWORK_SCHEMES.includes(O(r).scheme)).length} network requests observed on app-owned sessions `
  + '(the runner\'s VOID rule, one level in)');

// ---------------------------------- 3.3 COULD IT LOOK? (control A)
const sawUpdate = sessionRows.filter((r) => O(r).url === UPDATE_URL && O(r).owner === 'app' && O(r).cancelled === false);
const hostSawUpdate = host.hits.filter((h) => h.startsWith(UPDATE_HOST)).length;
ok('THE COULD-IT-LOOK GUARD: the instrument saw the update request AND a server in another process recorded the hit  '
  + '[entry point: src/main/update.js check() -> Session.fetch, through sessions.js onBeforeRequest]',
  sawUpdate.length === 1 && hostSawUpdate === 1,
  `instrument ${sawUpdate.length}, fake host ${hostSawUpdate} (${JSON.stringify(host.hits)}) — `
  + `host hit with the instrument silent is the blind observer, and it is a RED`);

ok('...and the check really COMPLETED: the app parsed a body only that server could have sent, off the URL that is the '
  + 'shipping constant  [entry point: src/main/update.js UPDATE_URL, and check()]',
  O(O(R.update).result).ok === true && O(O(R.update).result).tag === FAKE_TAG
  && O(R.update).url === UPDATE_URL && O(O(R.update).stats).checks === 1,
  `${O(R.update).url} -> ${JSON.stringify(O(R.update).result)} · stats ${JSON.stringify(O(R.update).stats)} · `
  + `the tag is the fake host's, so a status code the app invented cannot pass this`);

// -------------------- 3.4 THE EXCLUSION, WITH A CONTROL THAT CAN LOSE
const full = A(R.log);
const onYt = full.filter((r) => O(r).url === BAD_URL && O(r).owner === 'user');
const onApp = full.filter((r) => O(r).url === BAD_URL && O(r).owner === 'app');
const hostSawBad = host.hits.filter((h) => h.startsWith(BAD_HOST)).length;
ok('THE SAME URL THROUGH TWO SESSIONS, OPPOSITE VERDICTS: on `persist:youtube` it is observed and allowed through; '
  + 'on the app\'s own session it is observed and CANCELLED  [entry point: mayRequest() in src/main/p1.js]',
  onYt.length === 1 && onYt[0].cancelled === false
  && onApp.length === 1 && onApp[0].cancelled === true,
  `youtube: ${onYt.length} row(s) cancelled=${onYt.map((r) => r.cancelled).join()} · `
  + `app: ${onApp.length} row(s) cancelled=${onApp.map((r) => r.cancelled).join()} — `
  + 'an exclusion written as a URL substring instead of a session owner passes the first half and stops failing on the second');

ok('...and the fake host was reached exactly once for that URL — so the cancellation is a fact about the wire and not about a log line',
  hostSawBad === 1 && O(R.controlB).ok === true && O(R.controlC).ok !== true,
  `${BAD_HOST} reached ${hostSawBad}x; on persist:youtube ${JSON.stringify(R.controlB)}; `
  + `on the app's own session ${JSON.stringify(R.controlC)}`);

// -------------------------- 3.5 THE OBSERVER COVERS RENDERERS, ON BOTH SESSIONS
// Controls A, B and C are all `Session.fetch` from main. If the listener only
// ever saw main-process traffic, all three would still pass and the deck, the
// engine and the source page could fetch anything they liked.
const byRenderer = (owner) => full.filter((r) => O(r).owner === owner && O(r).webContentsId != null);
ok('the observer covers RENDERER-initiated traffic on both sessions, not just what main asks for  '
  + '[entry point: onBeforeRequest in src/main/sessions.js, over the webContents Chromium attributes]',
  byRenderer('app').length >= 3 && byRenderer('user').length >= 1,
  `${byRenderer('app').length} app rows and ${byRenderer('user').length} youtube row(s) carry a webContents id `
  + `(app renderers seen: ${uniq(byRenderer('app').map((r) => r.webContentsId)).join(' ')}); `
  + `the vendored unit's own assets are in there: ${full.filter((r) => /\/vendor\/stem-splitter-live\//.test(O(r).url)).length} rows`);

// ------------------------------- 3.6 THE OTHER LAYER, NAMED RATHER THAN MERGED
const sawExample = full.filter((r) => /example\.invalid/.test(O(r).url));
const csp = A(O(R.controlD).violations);
ok('a renderer of ours cannot reach an off-origin URL AT ALL — the CSP refuses it before the network stack, so the '
  + 'instrument correctly sees nothing and the page gets a named violation  [entry point: CSP in src/main/assets.js]',
  sawExample.length === 0 && csp.length === 1 && /^connect-src/.test(String(csp[0].violatedDirective))
  && /example\.invalid/.test(String(csp[0].blockedURI)),
  `instrument rows for example.invalid: ${sawExample.length}; the chrome renderer reported `
  + `${JSON.stringify(csp)} and got ${JSON.stringify(O(R.controlD).err)} — every failed fetch says "Failed to fetch", `
  + 'so the DIRECTIVE is what says which layer answered');

// ============ 3.7 THE TRANSPORTS THAT NEVER ENTER CHROMIUM (control E) ======
/**
 * THE ASSERTION THIS SUITE DID NOT HAVE, AND THE ONE BOTH AUDITS BROKE IT WITH.
 *
 * Everything above rides `session.webRequest`. A `fetch()` in the main process
 * does not: it is undici, in this process, and the observer is a property of a
 * Chromium session. So the two audits added one line to `src/main/main.js`,
 * watched a real request reach a real host — `GET /telemetry-from-main` at a
 * local sink, and an HTTP 404 from example.com — and watched this file print
 * `19 passed, 0 failed` while still saying "reached exactly {
 * https://api.github.com }".
 *
 * `src/main/netguard.js` is the fix and these three assertions are how it is
 * held. They are deliberately in THREE pieces, because they fail for different
 * reasons: the guard exists, the guard bit, and nothing arrived anyway.
 */
const G = O(R.netGuard);
const gAfter = O(G.after);
const gAttempts = A(G.attempts);

ok('the main process\'s unobservable transports are POISONED at boot: fetch, http, https, http2, net, tls and dgram '
  + 'are all gone before any of the app\'s own modules have a body  [entry point: src/main/netguard.js, imported first by src/main/main.js]',
  gAfter.installed === true && gAfter.fetchIsOurs === true
  && ['globalThis.fetch()', 'http.request()', 'https.request()', 'http2.connect()', 'net.connect()',
    'tls.connect()', 'dgram.createSocket()'].every((k) => A(gAfter.poisoned).includes(k))
  && firstImportOfMain() === './netguard.js',
  `${A(gAfter.poisoned).length} taken: ${A(gAfter.poisoned).join(' ')}; `
  + `main.js's first import is ${JSON.stringify(firstImportOfMain())}`);

const refused = gAttempts.filter((a) => O(a).threw === true && /P1/.test(String(O(a).name)));
const pipeRow = gAttempts.find((a) => /PIPE/.test(String(O(a).what)));
ok('...and every one of them THROWS when the app calls it — eleven transports attempted at a real loopback port, eleven refused, '
  + 'while a Socket.connect to a PIPE is untouched  [entry point: tools/gate/p1.mjs control E]',
  gAttempts.length === 12 && refused.length === 11
  && !!pipeRow && O(pipeRow).threw === false,
  `${refused.length}/${gAttempts.length - 1} network transports refused `
  + `(${refused.map((a) => O(a).what).join(' ')}); the pipe row threw=${pipeRow ? O(pipeRow).threw : '(absent)'} — `
  + 'a guard that also broke pipes would break child-process IPC, so it is asserted NOT to');

ok('...and the sink in THIS process recorded exactly one connection, ours — so "nothing left the app" is a fact about a '
  + 'listening socket and not about an instrument inside the app  [entry point: tools/p1-sink.mjs, over the whole launch]',
  sinkConnections === 1 && sinkRequests.length === 1
  && sinkRequests[0] === 'GET /the-suites-own-control' && O(sinkControl).ok === true,
  `${sinkConnections} TCP connection(s), ${sinkRequests.length} request(s): ${JSON.stringify(sinkRequests)}; `
  + `the suite's own control got ${JSON.stringify(sinkControl)} — the app had the port for its whole life and `
  + 'used it zero times');

console.log(`\n${ID}: launch log ${path.relative(ROOT, path.join(OUT, 'launch.log'))} · `
  + `report ${path.relative(ROOT, reportPath)} · fake-host hits ${path.relative(ROOT, path.join(OUT, 'host-hits.json'))}`);
done();

/**
 * `src/main/main.js`'s FIRST import specifier, read out of the source.
 *
 * The guard installs on import, so its position in the import block is what
 * makes "before any of our code has a body" true — and that ordering is
 * invisible at runtime once everything is up. Comments are stripped first,
 * because the file's header names the module in prose three lines above it.
 */
function firstImportOfMain() {
  const src = strip(fs.readFileSync(path.join(ROOT, 'src', 'main', 'main.js'), 'utf8'));
  const m = src.match(/^\s*import\s+(?:[^'"]*?from\s*)?['"]([^'"]+)['"]/m);
  return m ? m[1] : null;
}

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
 * Hold `file` until `release()`. `flock -c 'echo …; cat'` keeps the lock for as
 * long as its stdin is open, so closing stdin is the release and the child
 * exiting is the proof it happened.
 */
function takeLock(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('flock', [file, '-c', 'echo __LOCKED__; cat'], { stdio: ['pipe', 'pipe', 'inherit'] });
    let seen = false;
    child.stdout.on('data', (c) => {
      if (seen || !String(c).includes('__LOCKED__')) return;
      seen = true;
      resolve({ release: () => { try { child.stdin.end(); } catch { /* already gone */ } } });
    });
    child.on('error', reject);
    child.on('close', () => { if (!seen) reject(new Error('flock exited without taking the lock')); });
  });
}

function run(bin, args, { cwd, timeoutMs, env }) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, env: env || process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const grab = (c) => { out += c.toString(); };
    child.stdout.on('data', grab);
    child.stderr.on('data', grab);
    const timer = setTimeout(() => { out += `\n[suite] TIMEOUT after ${timeoutMs} ms — killing\n`; child.kill('SIGKILL'); }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: 127, out: `${out}\nspawn error: ${e.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}
