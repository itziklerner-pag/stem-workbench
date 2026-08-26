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
 *     session nobody watched reads exactly like a session that made no requests.
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
 * against Electron 44.0.0 on Linux: 19 of 19 mutations caught, 19 of 19
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
 *
 * TWO OF THEM ARE THE POINT OF THE WHOLE FILE. Case 14 leaves the wire alone and
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
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { UPDATE_HOST, UPDATE_URL } from '../../src/main/update.js';
import { mayRequest, violations, SESSION_OWNERS, NETWORK_SCHEMES } from '../../src/main/p1.js';
import { startP1Host } from '../p1-host.mjs';

const ID = 'p1';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'out', ID);

/**
 * The host the app must NEVER reach, which this suite makes reachable anyway.
 * It is a `.invalid` TLD (RFC 2606) so that a resolver rule going missing fails
 * as "no such host" rather than as somebody's real server.
 */
const BAD_HOST = 'telemetry.invalid';
const BAD_URL = `https://${BAD_HOST}/both-sessions`;

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
const host = await startP1Host([UPDATE_HOST, BAD_HOST], { tag_name: FAKE_TAG });
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
  lock = await takeLock(LOCK);
  launch = await run(
    'bash', ['-c',
      `xvfb-run -a -s '-screen 0 1280x1024x24' ${sh(electron)} . `
      + `--gate=${sh(OUT)} --gate-probe=p1 --update-check `
      + `--source-url=${sh(fixture)} --user-data=${sh(userData)} `
      + host.chromiumArgs.map(sh).join(' ')],
    { cwd: ROOT, timeoutMs: Number(process.env.STEM_WORKBENCH_LAUNCH_TIMEOUT_MS || 180000) });
} finally {
  if (lock) lock.release();
  // The counters are read AFTER the app is gone, so nothing can still be in
  // flight when they are compared.
  host.close();
}
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

console.log(`\n${ID}: launch log ${path.relative(ROOT, path.join(OUT, 'launch.log'))} · `
  + `report ${path.relative(ROOT, reportPath)} · fake-host hits ${path.relative(ROOT, path.join(OUT, 'host-hits.json'))}`);
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
