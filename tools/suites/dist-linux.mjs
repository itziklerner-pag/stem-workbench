#!/usr/bin/env node
/**
 * dist-linux — the ONE step anywhere that BUILDS AN INSTALLER AND RUNS IT.
 *
 * ===========================================================================
 * WHY THIS EXISTS
 * ===========================================================================
 * Every other windowed suite here launches `electron .` over the CHECKOUT.
 * That is not the thing a user gets, and the differences are exactly the ones
 * that break silently:
 *
 *   · `app.isPackaged` flips, and with it `MODEL_DIR` — the weights move from
 *     `models/` in the repo to `process.resourcesPath/model/`, a path no other
 *     suite ever exercises.
 *   · the app is read out of an ASAR, so anything the `files` glob forgot is
 *     simply not there. `tools/` is not in the bundle, which is what makes the
 *     `--gate` seam unreachable in a shipped binary.
 *   · `app-update.yml` — the electron-updater feed, and therefore THE RELEASE
 *     CHANNEL — exists only inside a built artifact. `updates` asserts the
 *     channel in `package.json` and in `src/main/update.js`; this asserts it in
 *     the thing that would actually be shipped.
 *
 * The standing ruling is that Linux is the verification platform and macOS and
 * Windows are configuration. This suite is the Linux half of that sentence
 * being true rather than asserted.
 *
 * ===========================================================================
 * IT SKIPS ON A MACHINE, AND FAILS ON A DEFECT — THE DIFFERENCE IS THE DESIGN
 * ===========================================================================
 * `docs/TESTING.md` §3 rule 8. A SKIP is the machine declining: no
 * electron-builder, no 109 MB of weights, no ONNX Runtime drop, no `xvfb-run`,
 * no `flock`, or a first build that cannot reach the network for the Electron
 * zip. Each of those is named in the SKIPPED line so the reason is machine-
 * readable, and `--strict` turns every one of them into exit 2 rather than
 * letting it read as success.
 *
 * A BUILD THAT RUNS AND FAILS IS A FAIL, because the configuration is ours. The
 * first Linux build on this box failed exactly that way — `Please specify author
 * 'email'`, `FpmTarget.ts:126` — with the AppImage already written, so the
 * directory looked like a successful build and the deb was simply missing.
 * Assertion 1 is a SET over both targets for that reason.
 *
 * "THE APP DID NOT EXPOSE THE HOOK" IS A FAIL, NOT A SKIP. The ready signal
 * below is the app's own `[main] ready` line, printed by `src/main/main.js`
 * after the window, the deck and the engine are all up. If it never arrives,
 * this suite goes red.
 *
 * ===========================================================================
 * COUNTS, NEVER A STOPWATCH
 * ===========================================================================
 * The launch does not sleep and does not measure how long anything took. It
 * waits for a MARKER — one line, matched by a regex, COUNTED — and kills the
 * process group the moment it arrives. The two bounds that exist are a queue
 * bound on the shared mutex and a kill-it-anyway bound on the launch, and
 * neither is ever asserted on: they only decide when to stop waiting.
 *
 * WHAT IT DOES NOT PROVE, stated rather than left to be discovered:
 *   · THE SANDBOX. The launch passes `--no-sandbox`, because `chrome-sandbox`
 *     inside a freshly built tree is not setuid root (it cannot be — nothing
 *     here runs as root) and Electron refuses to start without either. `shell`
 *     is where renderer isolation is asserted, over a checkout.
 *   · ANY AUDIO. No capture is armed and no stem is produced. `capture-mute`
 *     and `youtube` are those claims.
 *   · macOS AND WINDOWS. Nothing here has ever built or signed either. That is
 *     `updates` §4, and it is a claim about configuration.
 *
 * ===========================================================================
 * WATCHED RED BY MUTATION
 * ===========================================================================
 * | # | assertion                                  | mutation that turns it red                                     |
 * |---|--------------------------------------------|----------------------------------------------------------------|
 * | 1 | both targets built                         | delete the `deb` entry from `build.linux.target`               |
 * | 2 | the feed is INSIDE the artifact            | `build.publish` -> `null` (no app-update.yml is written at all) |
 * | 3 | ...on the prerelease channel               | `build.publish.releaseType` -> `'release'`                     |
 * | 4 | latest-linux.yml describes what was built  | edit a `size:` in the yml after the build                      |
 * | 5 | the weights are in the installer, exact    | drop `build.extraResources`                                    |
 * | 6 | `tools/` is not in the asar                | add a `tools/` glob to `build.files`                               |
 * | 7 | THE PACKAGED APP LAUNCHES                  | `build.files` -> drop the `src/` glob                               |
 * | 8 | ...and the vendored deck is in the bundle  | drop the vendored `extension/` glob from `files`   |
 * | 9 | ...and the bundled weights hash-verified   | truncate `models/htdemucs_6s.onnx` before the build (rule M1)  |
 * |10 | ...and `--gate=DIR` did nothing            | drop `app.isPackaged ?` from `const GATE` in src/main/main.js  |
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { refuseIfCompromised } from '../lib/tree-guard.mjs';
import { BROWSER_LOCK, announceLock } from '../lib/locks.mjs';
import { UPDATER_FEED } from '../../src/main/update.js';
import { MODEL } from '../../vendor/stem-splitter-live/extension/shared/config.js';

const ID = 'dist-linux';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** See `deck-seam.mjs`: a stranded mutation must not be measured past. */
refuseIfCompromised(ID, ROOT);

/**
 * BATTERY-ONLY, AND IT ANNOUNCES ITSELF. `DIST_LINUX_ONLY=build` runs §1–§3 and
 * skips the launch, so the six assertions about what electron-builder PRODUCED
 * can be watched red without taking the machine-global browser mutex. Six of
 * ten cases in `tools/suites/dist-linux-mutations.sh` therefore cost a build
 * and no queue, on a box where four agents were observed queued on that one
 * lock at once.
 *
 * `deck-host.mjs`'s `DECK_HOST_ONLY=conformance` is the precedent and the
 * reason: a mutation battery paying for a display it does not need is a battery
 * that stops being run. `tools/verify.mjs` never sets this, and a run with it
 * set prints a banner and a DIFFERENT closing line, so a partial transcript can
 * never be mistaken for the step.
 */
const ONLY = process.env.DIST_LINUX_ONLY || '';
if (ONLY && ONLY !== 'build') {
  console.error(`${ID}: DIST_LINUX_ONLY=${ONLY} is not a mode. The only value is 'build'.`);
  process.exit(2);
}
if (ONLY) {
  console.log(`${ID}: DIST_LINUX_ONLY=build — §4 (the launch) is NOT RUN. This is the mutation battery's`);
  console.log(`${ID}: mode and never the step's; nothing below says the packaged app starts.`);
}

const DIST = path.join(ROOT, 'dist');
const UNPACKED = path.join(DIST, 'linux-unpacked');
const OUT = path.join(ROOT, 'out', ID);
const LOCK = BROWSER_LOCK;
announceLock();
/** Echoed by the shell the instant `flock` hands over the mutex. See `run()`. */
const LOCK_MARK = '__WB_LOCKED__';
/**
 * THE READY SIGNAL, AND IT IS THE APP'S OWN. `src/main/main.js` prints this
 * after the window is shown, the deck and engine renderers have loaded and the
 * engine's boot probe has answered. It is not a marker added for this suite —
 * it is the line the product already logs, which is what makes it a signal
 * rather than an instrument the app was modified to satisfy.
 */
const READY = /^\[main\] ready · source=(\S+) · deck=(\S+) · engine coi=(\w+) sab=(\w+)/m;
/** The unit's own line when it has verified the bundled weights. Rule M1. */
const WEIGHTS = /weights downloaded \+ hash verified/;
/**
 * BOTH LINES, AND THE ORDER BETWEEN THEM IS NOT GUARANTEED — which is why this
 * is a predicate over the whole transcript rather than one regex.
 *
 * The first draft killed the process on `[main] ready` alone and the weights row
 * went red on a working app: `main` prints its ready line when the window, the
 * deck and the engine's boot probe are up, and the engine loads the 109 MB
 * asynchronously after that. Once it happened to arrive first (669 ms) and once
 * it did not. A suite that races an event it is asserting about reports the
 * machine, not the code.
 *
 * It is still a COUNT and not a clock: the run ends on the LATER of two matched
 * lines, whichever way round they come, and the only bound is the kill-it-anyway
 * timeout — which is never asserted on. If the weights line never arrives, that
 * timeout fires and assertion 9 is red for the reason it exists to be red for.
 */
const LAUNCH_DONE = (out) => READY.test(out) && WEIGHTS.test(out);

// ------------------------------------------------------------------ harness
let pass = 0; let fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (cond) pass++; else fail++;
};
const done = () => {
  console.log(`\n${ID}: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};
const skip = (why) => { console.log(`SKIPPED — ${why}`); process.exit(0); };
const sizeOf = (p) => { try { return fs.statSync(p).size; } catch { return -1; } };
const MB = (n) => `${(n / 1e6).toFixed(1)} MB`;

// ==========================================================================
// 0. PREFLIGHT — every one of these is a property of the machine, not the code
// ==========================================================================
const builder = path.join(ROOT, 'node_modules', '.bin', 'electron-builder');
if (!fs.existsSync(builder)) {
  skip('electron-builder is not installed in node_modules — it is in devDependencies, so `npm ci` installs it. '
    + 'Nothing can be packaged without it');
}
const model = path.join(ROOT, 'models', 'htdemucs_6s.onnx');
if (!fs.existsSync(model)) {
  skip('models/htdemucs_6s.onnx is absent (109 MB, gitignored, `bash tools/vendor-unit.sh --model`) — '
    + '`build.extraResources` packages it and the build cannot run without it');
}
/**
 * THE FILE NAMED HERE IS THE ONE `vendor/.pin`'s `ort` block HASHES, so the
 * preflight and the pin cannot disagree about what "the drop is present" means.
 * The first draft of this line named `ort.webgpu.bundle.min.mjs`, which does not
 * exist in the 1.27.0 drop at all — the suite SKIPPED on a fully seeded tree and
 * the SKIP read exactly like a machine that was missing something.
 */
const ort = path.join(ROOT, 'vendor', 'stem-splitter-live', 'extension', 'vendor', 'ort');
if (!fs.existsSync(path.join(ort, 'ort.all.bundle.min.mjs'))
  || !fs.existsSync(path.join(ort, 'ort-wasm-simd-threaded.jsep.wasm'))) {
  skip('the ONNX Runtime drop is absent or incomplete (~27 MB, gitignored, '
    + '`bash vendor/stem-splitter-live/tools/fetch-vendor.sh`) — an installer built without it cannot boot its engine');
}
if (!hasBin('xvfb-run')) skip('xvfb-run is not on PATH and this box has no DISPLAY');
if (!hasBin('flock')) skip('flock is not on PATH — the shared browser mutex cannot be taken');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// ==========================================================================
// 1. THE BUILD
// ==========================================================================
/**
 * `--publish never` IS ON THE COMMAND, not merely on the script it mirrors.
 * `updates` asserts that every `dist:*` script carries it; this invocation is
 * not one of those scripts, so it carries it in its own right. The standing
 * ruling is absolute: nothing in this repository ever creates a GitHub Release.
 */
const BUILD_ARGS = ['--linux', '--publish', 'never'];
fs.rmSync(DIST, { recursive: true, force: true });
const build = spawnSync(builder, BUILD_ARGS, {
  cwd: ROOT, encoding: 'utf8', timeout: 1_800_000,
  env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
});
const buildLog = `${build.stdout || ''}\n${build.stderr || ''}`;
fs.writeFileSync(path.join(OUT, 'build.log'), buildLog);

const appImage = fs.existsSync(DIST)
  ? fs.readdirSync(DIST).filter((f) => f.endsWith('.AppImage')).map((f) => path.join(DIST, f)) : [];
const debs = fs.existsSync(DIST)
  ? fs.readdirSync(DIST).filter((f) => f.endsWith('.deb')).map((f) => path.join(DIST, f)) : [];

/**
 * THE ONE SKIP THAT IS NOT A PREFLIGHT, and it is deliberately narrow: a FIRST
 * build downloads the Electron zip, `appimagetool` and `fpm` from the network,
 * and a box with no route out cannot package no matter how good the config is.
 * It is only reached when NOTHING was produced AND the transcript carries a
 * resolver/connect error — a build that ran and rejected our configuration says
 * neither of those and is a FAIL below.
 */
if (!appImage.length && !debs.length && /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|socket hang up/.test(buildLog)) {
  skip('electron-builder could not reach the network to fetch its toolchain (the Electron zip, appimagetool or fpm) '
    + `and produced nothing — see ${path.relative(ROOT, path.join(OUT, 'build.log'))}`);
}

ok('`electron-builder --linux --publish never` builds BOTH targets — the AppImage AND the deb  '
  + '[entry point: build.linux.target in package.json]',
  build.status === 0 && appImage.length === 1 && debs.length === 1,
  `exit ${build.status} · ${appImage.length} AppImage, ${debs.length} deb`
  + (appImage.length ? ` (${path.basename(appImage[0])} ${MB(sizeOf(appImage[0]))})` : '')
  + (debs.length ? ` (${path.basename(debs[0])} ${MB(sizeOf(debs[0]))})` : '')
  + (build.status === 0 ? '' : ` — ${lastLine(buildLog)}`));
// A SUITE THAT CANNOT LOOK FAILS. Without an artifact there is nothing to
// assert about, and the rows below would every one of them be green-on-absence.
if (!appImage.length || !debs.length) done();

// ==========================================================================
// 2. THE FEED IS IN THE ARTIFACT — the channel, where a user would get it
// ==========================================================================
{
  /**
   * `app-update.yml` is written by electron-builder FROM `build.publish`, into
   * the installer's resources, and it is the file `autoUpdater` reads its feed
   * out of at runtime. An installer built with `publish: null` does not contain
   * it at all — which is a product that can never update itself however well the
   * app is written, and is invisible from every other suite in this repository.
   */
  const feedPath = path.join(UNPACKED, 'resources', 'app-update.yml');
  const raw = fs.existsSync(feedPath) ? fs.readFileSync(feedPath, 'utf8') : '';
  const yml = Object.fromEntries([...raw.matchAll(/^([a-zA-Z]+):\s*(.+?)\s*$/gm)]
    .map(([, k, v]) => [k, v === 'true' ? true : v === 'false' ? false : v]));
  ok('the built installer CARRIES the electron-updater feed — `app-update.yml`, from `build.publish`  '
    + '[entry point: resources/app-update.yml in dist/linux-unpacked]',
    raw.length > 0 && yml.provider === UPDATER_FEED.provider
    && yml.owner === UPDATER_FEED.owner && yml.repo === UPDATER_FEED.repo,
    raw ? `provider=${yml.provider} owner=${yml.owner} repo=${yml.repo}`
      : 'NO app-update.yml IN THE BUNDLE — an installer that can never update itself');

  ok('...and it is on the PRE-RELEASE channel, which is the only place that word ends up in a shipped '
    + 'artifact  [entry point: releaseType in resources/app-update.yml, from UPDATER_FEED]',
    yml.releaseType === 'prerelease' && yml.releaseType === UPDATER_FEED.releaseType
    && yml.vPrefixedTagName === UPDATER_FEED.vPrefixedTagName,
    `releaseType=${yml.releaseType} vPrefixedTagName=${yml.vPrefixedTagName} (seed §14)`);

  /**
   * `latest-linux.yml` is the OTHER half of the feed — the metadata a running
   * updater compares itself against. It is asserted against the bytes on disk
   * rather than against itself: a size or a filename that does not match what
   * was actually built is an update that 404s or fails its hash on a user's
   * machine, and nothing else here would ever notice.
   */
  const latest = path.join(DIST, 'latest-linux.yml');
  const lraw = fs.existsSync(latest) ? fs.readFileSync(latest, 'utf8') : '';
  const rows = [...lraw.matchAll(/- url:\s*(\S+)[\s\S]*?size:\s*(\d+)/g)].map((m) => ({ url: m[1], size: Number(m[2]) }));
  const named = rows.filter((r) => sizeOf(path.join(DIST, r.url)) === r.size);
  ok('...and `latest-linux.yml` describes exactly the two files that were built, at their real byte counts  '
    + '[entry point: dist/latest-linux.yml vs the artifacts on disk]',
    rows.length === 2 && named.length === 2
    && rows.some((r) => r.url.endsWith('.AppImage')) && rows.some((r) => r.url.endsWith('.deb'))
    && /sha512:/.test(lraw),
    rows.length ? rows.map((r) => `${r.url}=${r.size}`).join(' · ') : 'no rows in latest-linux.yml');
}

// ==========================================================================
// 3. WHAT IS IN THE INSTALLER, AND WHAT IS DELIBERATELY NOT
// ==========================================================================
{
  /**
   * `extraResources`, not `asarUnpack` — HOST-DESIGN.md §7.1. The byte count is
   * the unit's own pin (`shared/config.js` MODEL.bytes), so this row is the
   * installer's copy being compared against the same number the engine verifies
   * at load. `src/main/main.js`'s MODEL_DIR reads exactly this location when
   * `app.isPackaged`, and §4 below proves the engine really read it.
   */
  const packedModel = path.join(UNPACKED, 'resources', 'model', 'htdemucs_6s.onnx');
  ok('the 109 MB of weights are on disk INSIDE the installer, at the exact byte count the unit pins  '
    + '[entry point: build.extraResources in package.json, MODEL.bytes in the vendored shared/config.js]',
    sizeOf(packedModel) === MODEL.bytes,
    `resources/model/htdemucs_6s.onnx = ${sizeOf(packedModel)}, pin ${MODEL.bytes} (${MODEL.label})`);

  /**
   * THE `--gate` SEAM IS UNREACHABLE IN A SHIPPED BINARY, and this is the half
   * of that claim nothing else can make: `src/main/main.js` already takes
   * `app.isPackaged` into the `GATE` constant (evaluated twice by
   * `capture-mute` assertion 9), and this says the module it would import is not
   * in the bundle either. Two independent reasons, and a `files` glob that
   * quietly grew a `tools/` entry would leave only the first.
   */
  const asar = path.join(UNPACKED, 'resources', 'app.asar');
  const listed = await listAsar(asar);
  const tools = listed.filter((p) => /^[\\/]tools([\\/]|$)/.test(p));
  const deck = listed.filter((p) => p.endsWith('/ui/embed.html'));
  ok('...and `tools/` is NOT in the asar, so the module `--gate-probe` would name is not on disk in a shipped '
    + 'build  [entry point: build.files in package.json]',
    listed.length > 0 && tools.length === 0 && deck.length === 1,
    `${listed.length} entries; ${tools.length} under /tools; the vendored deck entry ${deck[0] || 'IS MISSING'}`);
}

// ==========================================================================
// 4. IT LAUNCHES — one real run of the artifact that was just built
// ==========================================================================
if (ONLY === 'build') {
  console.log(`\n${ID}: built ${path.basename(appImage[0])} and ${path.basename(debs[0])}, and DID NOT LAUNCH `
    + 'either — DIST_LINUX_ONLY=build. The step itself always launches.');
  done();
}

/**
 * THE ARTIFACT, NOT THE UNPACKED TREE. `linux-unpacked/` is an intermediate;
 * the AppImage is the file a user downloads, and running that is what makes
 * "a runnable Linux app" a measurement.
 *
 * `--appimage-extract-and-run` because a container or a box without FUSE cannot
 * mount one, and the fallback is the AppImage's own documented flag rather than
 * something this suite invented. `--no-sandbox` because `chrome-sandbox` in a
 * freshly built tree is not setuid root and cannot be — nothing here runs as
 * root. Both are named in the header under what this does not prove.
 *
 * `--source-url` points at the LOCAL fixture, so a green here never depends on
 * youtube.com; `--no-update-check` keeps the one host off the wire, because this
 * suite is about packaging and `p1` is the suite that measures the network.
 * `--gate=` is passed ON PURPOSE and must do nothing: see the assertion.
 */
const fixture = fileUrl(path.join(ROOT, 'tools', 'fixture', 'player.html'));
const userData = path.join(OUT, 'userdata');
const gateDir = path.join(OUT, 'gate-must-stay-empty');
fs.mkdirSync(gateDir, { recursive: true });

const launch = await run('flock', [LOCK, '-c',
  `echo ${LOCK_MARK}; exec xvfb-run -a -s '-screen 0 1280x1024x24' ${sh(appImage[0])} `
  + `--appimage-extract-and-run --no-sandbox --source-url=${sh(fixture)} --user-data=${sh(userData)} `
  + `--gate=${sh(gateDir)} --no-update-check`],
{ cwd: ROOT, timeoutMs: 180000, queueMs: 900000, startOn: LOCK_MARK, until: LAUNCH_DONE });
fs.writeFileSync(path.join(OUT, 'launch.log'), launch.out);

const readyLines = (launch.out.match(/^\[main\] ready · /gm) || []).length;
const m = launch.out.match(READY);
ok('THE PACKAGED APP LAUNCHES AND REACHES ITS OWN READY SIGNAL — one `[main] ready` line, counted, not waited out  '
  + '[entry point: boot() in src/main/main.js, through the built AppImage]',
  readyLines === 1 && m !== null,
  m ? `${path.basename(appImage[0])} · source=${m[1]} · engine coi=${m[3]} sab=${m[4]}`
    : `NO READY LINE (${readyLines} matches) · killed=${launch.killedBy} · ${lastLine(launch.out)}`);
if (!m) done();

ok('...and the vendored deck came out of the ASAR over `app://`, with the engine cross-origin isolated and '
  + 'SharedArrayBuffer available  [entry point: the same line — deck= and coi/sab]',
  /^app:\/\/workbench\/vendor\/stem-splitter-live\/extension\/ui\/embed\.html$/.test(m[2])
  && m[3] === 'true' && m[4] === 'true',
  `deck=${m[2]} coi=${m[3]} sab=${m[4]}`);

/**
 * RULE M1, OVER THE INSTALLER'S OWN COPY. §3 weighed the file; this is the unit
 * verifying the SHA-256 and the byte count of whatever the Host handed it, at
 * runtime, in a packaged build — where the Host hands it
 * `process.resourcesPath/model/`, a branch no other suite reaches. A truncated
 * or substituted copy is refused at load rather than trusted because it came out
 * of our own installer.
 */
ok('...and the BUNDLED weights were read through `process.resourcesPath` and hash-verified by the unit — rule M1 '
  + 'over the installer\'s own copy  [entry point: modelcache.js in the vendored unit, via MODEL_DIR when app.isPackaged]',
  WEIGHTS.test(launch.out),
  (launch.out.match(/\[engine\].*weights[^\n]*/)
    || [`NO WEIGHTS LINE — killed by ${launch.killedBy}; the run ends on this line AND the ready line, so a `
        + 'timeout here means the unit never verified the installer\'s own copy'])[0].trim().slice(0, 190));

/**
 * `--gate=` WAS PASSED AND DID NOTHING. `GATE` is `app.isPackaged ? '' : …`, so
 * in a shipped build the flag is not read at all — and §3 showed the module it
 * would import is not in the bundle either. The report is checked AFTER the
 * process has closed: a build that honoured the flag writes it during boot, one
 * tick after the ready line this suite waited for.
 */
const wrote = fs.readdirSync(gateDir);
ok('...and `--gate=DIR` was passed to the SHIPPED binary and did nothing — no report, on top of a bundle with no '
  + '`tools/` in it  [entry point: `const GATE = app.isPackaged ? \'\' : val(\'gate\', \'\')` in src/main/main.js]',
  wrote.length === 0,
  wrote.length ? `THE FLAG WAS HONOURED IN A PACKAGED BUILD: ${wrote.join(', ')}` : 'the directory is empty');

console.log(`\n${ID}: built ${path.basename(appImage[0])} (${MB(sizeOf(appImage[0]))}) and `
  + `${path.basename(debs[0])} (${MB(sizeOf(debs[0]))}), and ran the AppImage to its own ready signal. `
  + 'macOS and Windows are configuration and have never been built anywhere.');
done();

// ------------------------------------------------------------------ helpers
function sh(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }
function lastLine(s) { const l = String(s).trimEnd().split('\n'); return l[l.length - 1] || '(no output)'; }
/**
 * NAMED `fileUrl`, NOT `pathToFileURL`. The first draft shadowed node's own name
 * and then called `.href` on its RESULT — which is already a string, so `href`
 * was `undefined` and the app was launched with `--source-url=undefined`. It was
 * caught by reading the process table of a queued run, not by the suite, which
 * would have gone red at the ready line with a confusing reason.
 */
function fileUrl(p) { return new URL(`file://${path.resolve(p)}`).href; }
function hasBin(name) {
  for (const dir of (process.env.PATH || '').split(':')) {
    try { fs.accessSync(path.join(dir, name), fs.constants.X_OK); return true; } catch { /* next */ }
  }
  return false;
}
/**
 * The asar's own reader, which ships with the build toolchain this step already
 * requires. A hand-rolled header parse here would be a second implementation of
 * a format, and a wrong one reads as "nothing in the bundle" — green, for §3's
 * `tools/` row, over a bundle full of it.
 */
async function listAsar(file) {
  try {
    const asar = await import('@electron/asar');
    return (asar.default || asar).listPackage(file);
  } catch { return []; }
}
/**
 * Two waits and one marker, exactly as `tools/suites/shell.mjs` does it — the
 * queue for the shared mutex gets its own generous bound and its own sentence,
 * and the launch's bound starts only when `flock` hands the lock over.
 *
 * `until` IS THE DIFFERENCE FROM shell.mjs's COPY. That suite runs an app that
 * EXITS (`--gate` makes it write a report and quit); this one runs the shipped
 * binary, which by design never exits. So the run ends on COUNTED markers — the
 * app's own ready line AND the unit's own weights line, in whichever order they
 * come — and the group is killed the moment the later one appears. Nothing here
 * sleeps, and no duration is ever asserted on. It is a PREDICATE over the whole
 * transcript rather than a regex for exactly that reason: see `LAUNCH_DONE`.
 */
function run(bin, args, { cwd, timeoutMs, queueMs = 0, startOn = null, until = null }) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let out = '';
    let waiting = startOn;
    let killedBy = null;
    let timer = null;
    // The GROUP: `flock` is the child and the app is its grandchild through the
    // shell. Killing the one leaves the other holding the mutex.
    const stop = (why) => {
      killedBy = killedBy || why;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
    };
    const arm = (ms, why) => {
      clearTimeout(timer);
      timer = setTimeout(() => { out += `\n[suite] ${why}\n`; stop('timeout'); }, ms);
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
      if (!waiting && until && killedBy === null && until(out)) stop('markers');
    };
    child.stdout.on('data', grab);
    child.stderr.on('data', grab);
    // WE DIE, IT DIES — a detached child outlives its parent, and an orphan here
    // holds the shared mutex with nobody watching.
    const onExit = () => stop('parent-exit');
    const onSignal = () => { stop('signal'); process.exit(130); };
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
    child.on('error', (e) => finish({ code: 127, out: `${out}\nspawn error: ${e.message}`, killedBy }));
    child.on('close', (code) => finish({ code, out, killedBy }));
  });
}
