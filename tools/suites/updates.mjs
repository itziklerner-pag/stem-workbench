#!/usr/bin/env node
/**
 * updates — the update check's HOST and CHANNEL, the toggle's LIFETIME, and the
 * three platform blocks that are configured here and built somewhere else.
 *
 * ===========================================================================
 * WHY IT IS PLAIN NODE
 * ===========================================================================
 * No window, no display, no mutex, ~0.2 s. Every claim below is about a pure
 * function, a JSON file, or a `createStorage()` over a temp directory, and
 * `src/main/p1.js`'s header states the reason this repository keeps splitting
 * things that way: *"a policy that can only be exercised by starting an app is a
 * policy whose edge cases are never exercised at all."* The channel decision has
 * eight edge cases and none of them is reachable from a launch.
 *
 * WHAT IT THEREFORE DOES NOT PROVE, said out loud rather than merely true:
 *   · THAT THE REQUEST GOES ANYWHERE. `p1` is the suite that launches the app,
 *     points the check at a fake host wearing `UPDATE_HOST`'s certificate, and
 *     reads the hit off a server in another process. This one reads constants.
 *   · THAT THE BAR PAINTS THE TOGGLE. `shell` and `smoke` are the windowed
 *     suites; §3 here asserts the wiring from the SOURCE of the three files it
 *     names, which is a claim about code and not about a rendered checkbox.
 *   · THAT ANY INSTALLER WORKS. §4 asserts that the macOS and Windows blocks
 *     are present and well-formed. Nothing here has ever built or signed one,
 *     and `dist-linux` is the only step anywhere that builds an artifact.
 *
 * ===========================================================================
 * WATCHED RED BY MUTATION — every row, and the exact edit
 * ===========================================================================
 * Every row below was watched failing against a deliberate edit, and the battery
 * that reproduces it is `tools/suites/updates-mutations.sh` — 33 cases, and its
 * final line is `coverage: all 35 assertions in the suite have been watched red`.
 * The `case` column is that script's own numbering, so a row and its mutation
 * can be run on their own.
 *
 * |  # | assertion                                        | case | the edit that turns it red                                   |
 * |----|--------------------------------------------------|------|--------------------------------------------------------------|
 * |  1 | one host, and the URL is built from the constant  |  1   | `UPDATE_URL` -> `https://github.com${UPDATE_PATH}`           |
 * |  2 | ...and the policy admits exactly that URL        |  2   | `mayRequest` -> `return u.protocol === 'https:'`             |
 * |  3 | ...and the feed's provider host is NOT ours      |  3   | `UPDATER_FEED.provider` -> `'generic'`                       |
 * |  4 | ...and the host is the one the USER is promised  | 34   | `UPDATE_HOST = 'api.example.com'` — the one `p1` CANNOT see  |
 * |  5 | ...and the endpoint is the LIST                  |  4   | `UPDATE_PATH` -> `/releases/latest`                          |
 * |  6 | the channel is `prerelease`                      |  5   | `UPDATE_CHANNEL = 'stable'`                                  |
 * |  7 | ...and package.json says the same word           |  6   | `build.publish.releaseType` -> `'release'`                   |
 * |  8 | ...and the feed matches package.json both ways   |  7   | add a key to `UPDATER_FEED` and not to `build.publish`       |
 * |  9 | a draft is never offered, on either channel      |  8   | drop `r.draft !== true` from `pickRelease`                   |
 * | 10 | `prerelease` offers the newest pre-release       |  9   | the channel guard -> `r.prerelease !== true`                 |
 * | 11 | ...and a STABLE release when that is newer       | 10   | the channel guard -> `r.prerelease === true`                 |
 * | 12 | `stable` skips a newer pre-release               | 10   | the same edit, from the other side                           |
 * | 13 | newest by `published_at`, not by array order     | 12   | delete `usable.sort(...)`                                    |
 * | 14 | an unknown channel THROWS                        | 13   | drop the `UPDATE_CHANNELS.includes` guard                    |
 * | 15 | empty, absent and single-object answers are null | 14   | `if (!Array.isArray(list)) return null` -> `list = [list]`    |
 * | 16 | the toggle DEFAULTS ON when absent               | 15   | `AUTO_UPDATE_DEFAULT = false`                                |
 * | 17 | ...and only an explicit `false` turns it off     | 16   | `autoUpdateFrom` -> `return stored === true`                 |
 * | 18 | ...and it lives in the `local` area              | 17   | `AUTO_UPDATE_AREA = 'session'`                               |
 * | 19 | THE TOGGLE SURVIVES A RESTART                    | 17   | the same edit — this is the row that MEASURES it             |
 * | 20 | ...and the CONTROL: `session` would not survive  | 19   | make `storage.js`'s two Maps one Map                         |
 * | 21 | `setEnabled()` moves the wire, and is counted    | 20   | `setEnabled` -> count the move without making it             |
 * | 22 | ...and a check while off DECLINES                | 21   | `if (!on)` -> `if (false)`                                   |
 * | 23 | main creates the STORE before the check          | 22   | move `createStorage` back below `createUpdateCheck`          |
 * | 24 | ...and ANDs the preference with the flag         | 23   | `UPDATE_CHECK && autoUpdate` -> `autoUpdate`                 |
 * | 25 | OFF MEANS OFF — one call site, no timer          | 35   | add an hourly `setInterval(... .check())` in main.js         |
 * | 26 | the toggle is wired across the three files       | 24   | delete `setAutoUpdate` from src/preload/chrome.cjs           |
 * | 27 | ...and it is a real input, not a menu item       | 25   | `<input type="checkbox">` -> `<span>`                        |
 * | 28 | mac: hardened runtime, entitlements, notarize    | 26   | `build.mac.notarize` -> `false`                              |
 * | 29 | ...and the entitlements file is a real plist     | 27   | rename `allow-jit` in build/entitlements.mac.plist           |
 * | 30 | win: nsis, and UNSIGNED during beta              | 28   | put `azureSignOptions` into `build.win`                      |
 * | 31 | ...and Azure Trusted Signing IS configured       | 29   | drop `-c.win.azureSignOptions.endpoint=` from the script     |
 * | 32 | linux: AppImage and deb, with a maintainer       | 30   | delete `build.linux.maintainer`                              |
 * | 33 | `--publish never` on EVERY dist script           | 31   | drop it from `dist:linux`                                    |
 * | 34 | ...and `build.publish` NAMES the feed            | 32   | `build.publish.provider` -> `null`                           |
 * | 35 | ...and CI creates no Release                     | 33   | add a `gh release create` step to package.yml                |
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { refuseIfCompromised } from '../lib/tree-guard.mjs';

import {
  UPDATE_HOST, UPDATE_PATH, UPDATE_URL, UPDATE_CHANNEL, UPDATE_CHANNELS,
  UPDATER_FEED, AUTO_UPDATE_AREA, AUTO_UPDATE_KEY, AUTO_UPDATE_DEFAULT,
  autoUpdateFrom, pickRelease, createUpdateCheck,
} from '../../src/main/update.js';
import { mayRequest } from '../../src/main/p1.js';
import { createStorage } from '../../src/main/storage.js';

const ID = 'updates';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** See `deck-seam.mjs`: a stranded mutation must not be measured past. */
refuseIfCompromised(ID, ROOT);

const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

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
/** Order-insensitive deep equality, so "same keys, different order" is not a red. */
const norm = (v) => (v === null || typeof v !== 'object' ? v
  : Array.isArray(v) ? v.map(norm)
    : Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])])));
const eq = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
const threw = (fn) => { try { fn(); return null; } catch (err) { return err; } };
/**
 * `pickRelease()` answers `null` for "nothing on this channel", and every row
 * below reads `.tag` off it. A SUITE THAT CRASHES HAS NOT REPORTED A RED; IT HAS
 * STOPPED LOOKING — and the mutations that make a channel offer nothing are
 * precisely the ones these rows exist to catch, so reading through this instead
 * of through `.tag` is what keeps them reds rather than a stack trace with every
 * later assertion never running. `deck-seam.mjs` pays for the same lesson in its
 * `val()` helper.
 */
const tagOf = (r) => (r && typeof r === 'object' && typeof r.tag === 'string' ? r.tag : null);
/** Comments out, so an assertion about code cannot be satisfied by prose about it. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const src = (rel) => strip(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

// =========================================================================
// 1. ONE HOST, AND A PATH THAT CAN CARRY A CHANNEL
// =========================================================================
{
  const u = new URL(UPDATE_URL);
  ok(`the update check resolves exactly one host, and it is the one \`src/main/p1.js\` binds  `
    + '[entry point: UPDATE_URL in src/main/update.js]',
    u.protocol === 'https:' && u.hostname === UPDATE_HOST && UPDATE_URL === `https://${UPDATE_HOST}${UPDATE_PATH}`,
    `${UPDATE_URL} -> ${u.protocol}//${u.hostname}`);

  /**
   * A CONTROL THAT CAN LOSE. Four URLs that are NOT this host, including the two
   * electron-updater would use if it were armed. `mayRequest` written as
   * `protocol === 'https:'` passes the row above and fails here.
   */
  const refused = ['https://github.com/itziklerner-pag/stem-workbench/releases.atom',
    'https://objects.githubusercontent.com/x',
    `https://evil.${UPDATE_HOST}/`,
    `http://${UPDATE_HOST}/`]
    .filter((url) => mayRequest('app', url) === false);
  ok('...and the app-owned policy admits that URL and refuses every other network host, including the two '
    + 'electron-updater would need  [entry point: mayRequest() in src/main/p1.js]',
    mayRequest('app', UPDATE_URL) === true && refused.length === 4,
    `${UPDATE_URL} admitted; ${refused.length}/4 refused (github.com, objects.githubusercontent.com, `
    + 'a suffix trap, and the http downgrade)');

  ok('...and the electron-updater FEED names a provider whose host is not ours — which is why it is '
    + 'configured and not armed  [entry point: UPDATER_FEED in src/main/update.js, docs/UPDATES.md]',
    UPDATER_FEED.provider === 'github' && mayRequest('app', 'https://github.com/x') === false,
    `provider=${UPDATER_FEED.provider}; the public GitHubProvider's host is github.com `
    + `(electron-updater@6.8.9 out/providers/GitHubProvider.js:32), and P1' names ${UPDATE_HOST}`);

  /**
   * THE PIN THAT `p1` CANNOT MAKE, AND THIS WAS MEASURED RATHER THAN REASONED.
   *
   * `src/main/update.js` used to claim that `tools/suites/p1.mjs` *"closes the
   * other direction by standing up a fake host whose CERTIFICATE carries this
   * name, so a re-point that nobody meant fails to resolve."* IT DOES NOT. The
   * suite generates that certificate FROM `UPDATE_HOST` at run time, so the fake
   * host is renamed along with the app: `UPDATE_HOST = 'api.example.com'` was
   * watched through a full windowed `p1` run and came back **24 passed, 0
   * failed**. Every gate in this repository imports the constant, which is what
   * makes them measure "one host" rather than "this host" — and it is exactly
   * why nothing could see the one being moved.
   *
   * What CAN see it is the promise. `PRIVACY.md` and `CONTRIBUTING.md` both
   * spell the host to the reader, and one of them is the sentence the user is
   * asked to believe. Re-pointing the constant makes both documents lie, and
   * that is a claim about two files rather than a restatement of one.
   *
   * `p1` still owns the other half, and it is the half that matters more: a
   * SECOND host was added to `check()` — `github.com`, which is precisely what
   * arming electron-updater would add — and `p1` went RED with
   * `GOT ["https://api.github.com","https://github.com"]`.
   */
  const promises = ['PRIVACY.md', 'CONTRIBUTING.md'].map((f) => {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const claimed = [...text.matchAll(/\{\s*https:\/\/([a-z0-9.-]+)\s*\}/g)].map((mm) => mm[1]);
    return { f, claimed, namesIt: text.includes(UPDATE_HOST) };
  });
  ok('...and the host is the one the USER is promised, by name, in both documents that make the promise  '
    + '[entry point: PRIVACY.md and CONTRIBUTING.md vs UPDATE_HOST — the re-point p1 cannot see, because it '
    + 'builds its fake certificate FROM the constant]',
    promises.every((x) => x.namesIt && x.claimed.length > 0 && x.claimed.every((h) => h === UPDATE_HOST)),
    promises.map((x) => `${x.f}: names it ${x.namesIt}, claims {${x.claimed.join(', ') || 'nothing'}}`).join(' · '));

  /**
   * `/releases/latest` IS DEFINED AS "the most recent NON-PRERELEASE, non-draft
   * release", so a check on that endpoint cannot follow the pre-release channel
   * at all — it 404s on a repository that has only pre-releases and silently
   * answers the stable tag on one that has both. This row is why the endpoint
   * changed, and it is the row a well-meaning simplification would trip.
   */
  ok('...and the endpoint is the LIST, not `/releases/latest`, which by definition never returns a '
    + 'pre-release  [entry point: UPDATE_PATH in src/main/update.js]',
    /\/releases(\?|$)/.test(UPDATE_PATH) && !/\/releases\/latest/.test(UPDATE_PATH)
    && /per_page=\d+/.test(UPDATE_PATH),
    UPDATE_PATH);
}

// =========================================================================
// 2. THE CHANNEL — one word, in three places, and one decision function
// =========================================================================
{
  ok(`the channel is \`prerelease\` — seed §14, the beta channel  [entry point: UPDATE_CHANNEL]`,
    UPDATE_CHANNEL === 'prerelease' && UPDATE_CHANNELS.includes('prerelease') && UPDATE_CHANNELS.includes('stable'),
    `${UPDATE_CHANNEL} of ${UPDATE_CHANNELS.join('/')}`);

  const pub = PKG.build && PKG.build.publish;
  ok("...and `package.json`'s `build.publish.releaseType` is electron-builder's spelling of the SAME word  "
    + '[entry point: build.publish in package.json, UPDATE_CHANNEL in src/main/update.js]',
    !!pub && pub.releaseType === 'prerelease' && pub.releaseType === UPDATE_CHANNEL,
    `build.publish.releaseType=${pub && pub.releaseType} · UPDATE_CHANNEL=${UPDATE_CHANNEL}`);

  /**
   * BOTH WAYS, like every other pin in this repository. `UPDATER_FEED` is what
   * electron-builder writes into `app-update.yml`; a key added to one and not
   * the other is a feed the code and the installer disagree about.
   */
  ok('...and `UPDATER_FEED` and `build.publish` are the SAME OBJECT, compared in both directions  '
    + '[entry point: UPDATER_FEED in src/main/update.js vs build.publish in package.json]',
    eq(UPDATER_FEED, pub),
    `code ${JSON.stringify(UPDATER_FEED)} · package.json ${JSON.stringify(pub)}`);
}

// =========================================================================
// 2b. pickRelease() — the channel as a decision, over a table
// =========================================================================
{
  const R = (tag, o = {}) => ({ tag_name: tag, draft: false, prerelease: false, published_at: '2026-01-01T00:00:00Z', ...o });
  const beta = R('v0.3.0-beta.2', { prerelease: true, published_at: '2026-08-20T00:00:00Z' });
  const stable = R('v0.2.0', { published_at: '2026-08-01T00:00:00Z' });
  const draft = R('v0.9.0', { draft: true, prerelease: true, published_at: '2026-08-25T00:00:00Z' });

  ok('A DRAFT IS NEVER OFFERED, on either channel — its tag may not exist and its assets are not '
    + 'downloadable  [entry point: pickRelease() in src/main/update.js]',
    tagOf(pickRelease([draft, beta], 'prerelease')) === beta.tag_name
    && tagOf(pickRelease([draft, stable], 'stable')) === stable.tag_name
    && pickRelease([draft], 'prerelease') === null,
    `draft ${draft.tag_name} skipped on both channels; [draft] alone -> null`);

  ok("...and the `prerelease` channel OFFERS the newest pre-release  [entry point: pickRelease()]",
    tagOf(pickRelease([stable, beta], 'prerelease')) === beta.tag_name
    && (pickRelease([stable, beta], 'prerelease') || {}).prerelease === true,
    `${JSON.stringify(pickRelease([stable, beta], 'prerelease'))}`);

  /**
   * THE ROW THAT STOPS "prerelease" BECOMING "prereleases only". A beta user who
   * is behind a STABLE release is still behind, and excluding stable would
   * strand every beta tester the day the first full release ships.
   */
  const olderBeta = R('v0.1.0-beta.1', { prerelease: true, published_at: '2026-07-01T00:00:00Z' });
  ok('...and it offers a STABLE release when that is the newest — the beta channel is not prereleases-only  '
    + '[entry point: pickRelease()]',
    tagOf(pickRelease([olderBeta, stable], 'prerelease')) === stable.tag_name,
    `${olderBeta.tag_name} (Jul) vs ${stable.tag_name} (Aug) -> ${tagOf(pickRelease([olderBeta, stable], 'prerelease'))}`);

  ok('...while the `stable` channel SKIPS a newer pre-release, which is the whole difference between them  '
    + '[entry point: pickRelease()]',
    tagOf(pickRelease([beta, stable], 'stable')) === stable.tag_name
    && pickRelease([beta], 'stable') === null,
    `[beta, stable] -> ${tagOf(pickRelease([beta, stable], 'stable'))}; [beta] alone -> null`);

  /**
   * GitHub documents the list endpoint as ordered by CREATION. A release created
   * early and published late outranks a newer one under array order and does not
   * under `published_at`, so the two orderings disagree on this fixture — which
   * is what makes it a control rather than a restatement.
   */
  const createdFirstPublishedLast = R('v0.4.0-beta.1', { prerelease: true, published_at: '2026-08-24T00:00:00Z' });
  ok('...and the newest is by `published_at`, not by the order GitHub sent  [entry point: pickRelease()]',
    tagOf(pickRelease([beta, createdFirstPublishedLast], 'prerelease')) === createdFirstPublishedLast.tag_name,
    `array order would pick ${beta.tag_name} (Aug 20); published_at picks `
    + `${tagOf(pickRelease([beta, createdFirstPublishedLast], 'prerelease'))} (Aug 24)`);

  ok('...and a channel this app does not have THROWS rather than quietly picking one  [entry point: pickRelease()]',
    threw(() => pickRelease([beta], 'nightly')) !== null && threw(() => pickRelease([beta], 'prerelease')) === null,
    String(threw(() => pickRelease([beta], 'nightly')) || '(did not throw)').slice(0, 110));

  ok('...and an empty, absent or malformed answer is `null`, never a tag  [entry point: pickRelease()]',
    pickRelease([], 'prerelease') === null && pickRelease(null, 'prerelease') === null
    && pickRelease({ tag_name: 'v1' }, 'prerelease') === null
    && pickRelease([{ draft: false }, { tag_name: '' }], 'prerelease') === null,
    'the object form is what `/releases/latest` used to answer, and it must not read as a release');
}

// =========================================================================
// 3. THE TOGGLE — default ON, and it SURVIVES A RESTART
// =========================================================================
{
  ok(`the preference DEFAULTS ON when nobody has chosen — an absent key is not \`false\`  `
    + '[entry point: autoUpdateFrom() + AUTO_UPDATE_DEFAULT in src/main/update.js]',
    AUTO_UPDATE_DEFAULT === true && autoUpdateFrom(null) === true && autoUpdateFrom(undefined) === true,
    `null -> ${autoUpdateFrom(null)}, undefined -> ${autoUpdateFrom(undefined)}`);

  ok('...and ONLY an explicit `false` turns it off, so a corrupt preference cannot silently disable '
    + 'security updates  [entry point: autoUpdateFrom()]',
    autoUpdateFrom(false) === false && autoUpdateFrom(true) === true
    && autoUpdateFrom(0) === true && autoUpdateFrom('off') === true && autoUpdateFrom({}) === true,
    `false -> false; 0/'off'/{} -> ${autoUpdateFrom(0)}/${autoUpdateFrom('off')}/${autoUpdateFrom({})}`);

  ok(`...and it lives in the \`local\` area, which is the one that outlives the process  `
    + '[entry point: AUTO_UPDATE_AREA in src/main/update.js, storage.js rule 5]',
    AUTO_UPDATE_AREA === 'local' && typeof AUTO_UPDATE_KEY === 'string' && AUTO_UPDATE_KEY.length > 0,
    `${AUTO_UPDATE_AREA}.${AUTO_UPDATE_KEY}`);

  /**
   * THE RESTART, FOR REAL. Two `createStorage()` calls over ONE directory: the
   * first writes, the second is a different store object with a different `Map`
   * and reads only what is on disk. That is what a relaunch is, minus the
   * Electron process — and it is why `AUTO_UPDATE_AREA = 'session'` turns this
   * red rather than turning a string comparison red.
   */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-updates-'));
  const first = createStorage({ dir });
  first.set(AUTO_UPDATE_AREA, AUTO_UPDATE_KEY, false);
  const second = createStorage({ dir });
  const afterRestart = second.get(AUTO_UPDATE_AREA, AUTO_UPDATE_KEY);
  ok('THE TOGGLE SURVIVES A RESTART: switched off, then read back by a SECOND store over the same profile  '
    + `[entry point: createStorage() in src/main/storage.js, area '${AUTO_UPDATE_AREA}']`,
    afterRestart === false && autoUpdateFrom(afterRestart) === false,
    `wrote false -> a fresh store reads ${JSON.stringify(afterRestart)} from ${path.basename(second.localFile)}`);

  /**
   * THE CONTROL THAT CAN LOSE. If `session` ALSO survived, the row above would
   * be green over an area that persists nothing and would be measuring the
   * `Map` it happens to share. It does not — and this is where that is proven
   * rather than assumed.
   */
  const third = createStorage({ dir });
  third.set('session', AUTO_UPDATE_KEY, false);
  const fourth = createStorage({ dir });
  ok("...and the CONTROL: the same value written to `session` does NOT survive, so the row above is "
    + 'measuring the lifetime and not the Map  [entry point: createStorage(), area \'session\']',
    third.get('session', AUTO_UPDATE_KEY) === false && fourth.get('session', AUTO_UPDATE_KEY) === null
    && autoUpdateFrom(fourth.get('session', AUTO_UPDATE_KEY)) === true,
    `session in-process ${JSON.stringify(third.get('session', AUTO_UPDATE_KEY))}, `
    + `after a restart ${JSON.stringify(fourth.get('session', AUTO_UPDATE_KEY))} — `
    + 'which autoUpdateFrom() reads as the default, i.e. the app would switch itself back ON');
  fs.rmSync(dir, { recursive: true, force: true });

  /** The runtime half: the toggle has to reach the thing that puts a request on the wire. */
  const chk = createUpdateCheck({ session: { fetch: () => { throw new Error('the suite never lets it fetch'); } }, enabled: true });
  const wasOn = chk.isEnabled();
  chk.setEnabled(false);
  const offNow = chk.isEnabled();
  const s = chk.stats();
  ok('...and `setEnabled()` really moves what `check()` may do, and the move is COUNTED  '
    + '[entry point: createUpdateCheck() in src/main/update.js]',
    wasOn === true && offNow === false && s.enabled === false && s.enabledChanges === 1
    && chk.setEnabled(false) === false && chk.stats().enabledChanges === 1,
    `on -> off, enabledChanges=${s.enabledChanges}; a repeat set does not re-count`);

  const declined = await chk.check();
  ok('...and a check while it is off DECLINES rather than asking — `asked: false`, and the counter says so  '
    + '[entry point: check() in src/main/update.js]',
    declined.asked === false && declined.tag === null && chk.stats().declined === 1 && chk.stats().checks === 0,
    `${JSON.stringify(declined)} · stats ${JSON.stringify({ checks: chk.stats().checks, declined: chk.stats().declined })} `
    + '(the session it was handed THROWS on fetch, so an ask would have been visible)');
}

// =========================================================================
// 3b. THE WIRING — main reads the preference, and the bar can move it
// =========================================================================
{
  const main = src('src/main/main.js');
  const iStore = main.indexOf('createStorage(');
  const iUpd = main.indexOf('createUpdateCheck(');
  ok('main creates the STORE before the update check, or the preference cannot be read at boot  '
    + '[entry point: boot() in src/main/main.js]',
    iStore > 0 && iUpd > 0 && iStore < iUpd,
    `createStorage at ${iStore}, createUpdateCheck at ${iUpd} (character offsets, comments stripped)`);

  /**
   * THE CONJUNCTION, NOT A REPLACEMENT. `--gate` turns the check off for the
   * whole launch and five windowed suites depend on that; a preference file left
   * behind in a profile must not be able to put a gate launch on the network.
   */
  ok('...and the user preference is ANDed with the command line rather than replacing it  '
    + '[entry point: UPDATE_CHECK && autoUpdate in src/main/main.js]',
    /enabled:\s*UPDATE_CHECK\s*&&\s*autoUpdate/.test(main)
    && /setEnabled\(UPDATE_CHECK\s*&&\s*want\)/.test(main),
    'both the boot value and the toggle handler take the flag into account');

  const preload = src('src/preload/chrome.cjs');
  const renderer = src('src/renderer/chrome.js');
  const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'chrome.html'), 'utf8');
  ok('the toggle is wired end to end across the three files a chrome-bar control needs  '
    + '[entry point: chrome:autoUpdate — src/main/main.js, src/preload/chrome.cjs, src/renderer/chrome.js]',
    /ipcMain\.handle\('chrome:autoUpdate'/.test(main)
    && /setAutoUpdate:.*invoke\('chrome:autoUpdate'/.test(preload)
    && /__wbChrome\.setAutoUpdate\(/.test(renderer),
    'main handles it, the preload exposes it, the bar calls it');

  /**
   * OFF MEANS OFF — issue #13, in its own words: *"no check at launch, no check
   * on a timer, no 'one last check' on quit."*
   *
   * The runtime half is asserted in §3 (`check()` DECLINES while the toggle is
   * off, and the counter says so). This is the SHAPE half, and it is a
   * different failure: a second call site that nobody wired to the toggle. So
   * the whole of `src/` is scanned, comments stripped, for how many times the
   * check is asked at all, and for the three places a second one would hide —
   * an interval, a timeout, and a quit handler.
   */
  const srcFiles = fs.readdirSync(path.join(ROOT, 'src', 'main')).filter((f) => f.endsWith('.js'))
    .map((f) => path.join('src', 'main', f));
  const callSites = srcFiles.flatMap((rel) => [...src(rel).matchAll(/\.check\(\s*\)/g)].map(() => rel));
  const sneaky = srcFiles.flatMap((rel) => {
    const t = src(rel);
    return [...t.matchAll(/setInterval\(|setTimeout\(|'before-quit'|'will-quit'/g)]
      .filter((mm) => /update|\.check\(/i.test(t.slice(mm.index, mm.index + 400)))
      .map((mm) => `${rel}:${t.slice(mm.index, mm.index + 24).replace(/\s+/g, ' ')}`);
  });
  ok('OFF MEANS OFF: the check is asked EXACTLY ONCE in the whole of `src/main/`, and no timer, timeout or '
    + 'quit handler goes anywhere near it  [entry point: state.update.check() in src/main/main.js — issue #13]',
    callSites.length === 1 && callSites[0] === path.join('src', 'main', 'main.js') && sneaky.length === 0,
    sneaky.length ? `A SECOND PATH: ${sneaky.join(' · ')}`
      : `${callSites.length} call site (${callSites.join(', ') || 'NONE'}); `
        + `${srcFiles.length} files scanned for setInterval/setTimeout/before-quit/will-quit near the check`);

  ok('...and it is a VISIBLE control in the bar — a real checkbox, not a menu item nobody finds  '
    + '[entry point: #autoupdate in src/renderer/chrome.html]',
    /<input[^>]*type="checkbox"[^>]*id="autoupdate"/.test(html)
    && /auto-update/i.test(html)
    && /paintAutoUpdate/.test(renderer),
    'seed §14: "default ON with a visible toggle"');
}

// =========================================================================
// 4. THE THREE PLATFORM BLOCKS — configured here, built somewhere else
// =========================================================================
{
  const b = PKG.build || {};
  const targets = (o) => ((o && o.target) || []).map((t) => (typeof t === 'string' ? t : t.target));

  const mac = b.mac || {};
  ok('macOS is configured for the hardened runtime, WITH entitlements and notarization  '
    + '[entry point: build.mac in package.json — NEVER BUILT OR SIGNED HERE]',
    mac.hardenedRuntime === true && mac.notarize === true
    && mac.entitlements === 'build/entitlements.mac.plist'
    && mac.entitlementsInherit === mac.entitlements
    && targets(mac).includes('dmg') && targets(mac).includes('zip'),
    `targets ${targets(mac).join('+')} · hardenedRuntime=${mac.hardenedRuntime} notarize=${mac.notarize}`);

  const plist = fs.readFileSync(path.join(ROOT, 'build', 'entitlements.mac.plist'), 'utf8');
  const keys = [...plist.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]);
  ok('...and the entitlements file it names is a real plist carrying the four the wasm engine needs  '
    + '[entry point: build/entitlements.mac.plist]',
    /<!DOCTYPE plist/.test(plist) && /<\/plist>/.test(plist)
    && ['allow-jit', 'allow-unsigned-executable-memory', 'allow-dyld-environment-variables', 'disable-library-validation']
      .every((k) => keys.includes(`com.apple.security.cs.${k}`))
    && !keys.some((k) => /device\.audio-input/.test(k)),
    `${keys.length} keys, and no microphone entitlement — this app captures what a view renders`);

  const win = b.win || {};
  /**
   * UNSIGNED DURING BETA IS THE DECISION, so `azureSignOptions` must NOT be in
   * `build.win`: `app-builder-lib/out/winPackager.js:35` switches to the Azure
   * signer the moment that key exists, and its `initialize()` runs PowerShell
   * `Install-Module TrustedSigning` unconditionally. A block sitting there
   * breaks every beta build, which is the "config that cannot run" this
   * repository's `buildNotes` header already refuses.
   */
  ok('Windows builds NSIS and is UNSIGNED during beta — no signer is wired into the default build  '
    + '[entry point: build.win in package.json, seed §14]',
    targets(win).includes('nsis') && win.azureSignOptions === undefined
    && win.certificateFile === undefined && win.signtoolOptions === undefined
    && b.nsis && b.nsis.oneClick === false,
    `targets ${targets(win).join('+')} · no azureSignOptions/certificateFile in build.win`);

  const signed = (PKG.scripts || {})['dist:win:signed'] || '';
  ok('...and Azure Trusted Signing IS configured, on its own script, with all four fields it needs  '
    + '[entry point: scripts["dist:win:signed"] — NEVER EXECUTED HERE]',
    ['publisherName', 'endpoint', 'codeSigningAccountName', 'certificateProfileName']
      .every((k) => signed.includes(`-c.win.azureSignOptions.${k}=`))
    && signed.startsWith('electron-builder --win'),
    signed ? `four fields present in ${signed.length} chars` : 'the script is missing');

  const lin = b.linux || {};
  ok('Linux builds AppImage AND deb, and the deb has the maintainer it cannot be built without  '
    + '[entry point: build.linux in package.json — the one platform that IS built here, by `dist-linux`]',
    targets(lin).includes('AppImage') && targets(lin).includes('deb')
    && typeof lin.maintainer === 'string' && /<[^>]+@[^>]+>/.test(lin.maintainer)
    && lin.syncDesktopName === true && typeof lin.description === 'string' && lin.description.length > 40,
    `targets ${targets(lin).join('+')} · maintainer set · syncDesktopName=${lin.syncDesktopName} `
    + '(without maintainer, FpmTarget fails the deb and the AppImage alone looks like a green build)');
}

// =========================================================================
// 5. THE STANDING RULING — configure the feed, never create a Release
// =========================================================================
{
  const scripts = PKG.scripts || {};
  const dist = Object.keys(scripts).filter((k) => k === 'dist' || k.startsWith('dist:'));
  const unguarded = dist.filter((k) => !/--publish\s+never/.test(scripts[k]));
  ok('EVERY electron-builder script carries `--publish never` — the standing ruling is that this project '
    + 'never creates a GitHub Release from automation  [entry point: scripts in package.json]',
    dist.length >= 6 && unguarded.length === 0,
    unguarded.length ? `WITHOUT IT: ${unguarded.join(', ')}` : `${dist.length} scripts: ${dist.join(', ')}`);

  /**
   * AND THE OTHER HALF, WHICH IS NOT THE SAME THING. `publish: null` was the old
   * value and it does not stop a release — `--publish never` does. What it stops
   * is `app-update.yml` being written into the installer at all, which makes an
   * installer that can never update itself no matter what the app does.
   */
  ok('...and `build.publish` nevertheless NAMES the feed, because that is what electron-builder writes into '
    + "`app-update.yml` — `publish: null` ships an installer that can never update  "
    + '[entry point: build.publish in package.json]',
    !!PKG.build.publish && PKG.build.publish.provider === 'github'
    && PKG.build.publish.owner && PKG.build.publish.repo,
    `${JSON.stringify(PKG.build.publish)} — and --publish never is what keeps a build from creating one`);

  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'package.yml'), 'utf8');
  ok('...and CI uploads ARTIFACTS and creates no release: no `softprops/action-gh-release`, no `gh release`, '
    + 'no `--publish always`  [entry point: .github/workflows/package.yml]',
    /upload-artifact/.test(wf) && !/action-gh-release|gh release create|--publish\s+(always|onTag)/.test(wf),
    'artifacts only');
}

console.log(`\n${ID}: one host (${UPDATE_HOST}), one channel (${UPDATE_CHANNEL}), a toggle that outlives the `
  + 'process, and three platform blocks — two of which have never been built anywhere');
done();
