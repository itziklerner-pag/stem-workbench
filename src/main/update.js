/**
 * THE ONE HOST THIS APP'S OWN CODE TALKS TO — rule P1', in one file — AND THE
 * CHANNEL IT FOLLOWS.
 *
 * `CONTRIBUTING.md` P1': *the app's own code talks to exactly one named host,
 * GitHub Releases, for the update check, and nothing else.* `PRIVACY.md` says
 * the same thing in the user's words, and names what the request carries (an IP
 * address and a user agent, because that is what an HTTP request is) and what it
 * does not (no installation id, no machine id, no counter, no opt-out token).
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS AN UPDATE CHECK AT ALL, WHEN THE EXTENSION HAS NONE
 * ---------------------------------------------------------------------------
 * This app ships its own Chromium and loads youtube.com in it, so it owns
 * Chromium's security patches — Electron ships them roughly every two weeks. An
 * app that cannot tell the user it is out of date has a WORSE posture than the
 * extension, where Google did this for us. That argument beat the purity
 * argument on the record: `docs/adr/0001-the-shape-of-the-desktop-product.md`.
 * It is also why the preference DEFAULTS ON (`AUTO_UPDATE_DEFAULT` below), and
 * why the toggle is nevertheless visible: a check the user cannot see and cannot
 * stop is the thing `PRIVACY.md` promises this app does not have.
 *
 * ---------------------------------------------------------------------------
 * THE HOST IS SPELLED ONCE, HERE, AND NOWHERE ELSE
 * ---------------------------------------------------------------------------
 * `src/main/sessions.js` imports `UPDATE_HOST` to decide what its policy lets
 * through, `tools/suites/p1.mjs` imports it to decide what it is allowed to
 * observe, and `tools/suites/smoke.mjs` imports it to keep this ONE host — and
 * only this one — out of the off-box ledger it keeps over both sessions. None of
 * the three re-types it. That is deliberate and it is the difference
 * between a gate and a tautology in ONE direction only: re-pointing this
 * constant moves the policy and the assertion WITH it, so the gate keeps
 * measuring "one host" rather than "this host".
 *
 * THE OTHER DIRECTION USED TO BE CLAIMED HERE AND WAS NOT TRUE. This comment
 * said `tools/suites/p1.mjs` *"closes the other direction by standing up a fake
 * host whose CERTIFICATE carries this name, so a re-point that nobody meant
 * fails to resolve."* It does not: that suite generates the certificate FROM
 * this constant at run time, so the fake host is renamed along with the app.
 * Measured — `UPDATE_HOST = 'api.example.com'` through a full windowed `p1` run
 * came back **24 passed, 0 failed**.
 *
 * What DOES close it is `tools/suites/updates.mjs`, against the two documents
 * that promise the host to the reader — `PRIVACY.md` and `CONTRIBUTING.md`.
 * Re-pointing this constant makes both of them lie, and that is a claim about
 * files this one does not control. What `p1` catches, and catches hard, is a
 * SECOND host: adding `github.com` to `check()` — precisely what arming
 * electron-updater would add — turns it RED with
 * `GOT ["https://api.github.com","https://github.com"]`.
 *
 * ---------------------------------------------------------------------------
 * `/releases/latest` COULD NEVER FOLLOW THE PRE-RELEASE CHANNEL. IT IS GONE.
 * ---------------------------------------------------------------------------
 * This file used to ask `GET /repos/{owner}/{repo}/releases/latest`, and seed
 * §14 requires the check to follow the PRE-RELEASE channel during beta. GitHub
 * defines that endpoint as *"the most recent non-prerelease, non-draft
 * release"* — so on a repository whose only releases are pre-releases it answers
 * 404 for ever, and on one that has both it answers the STABLE tag and silently
 * skips every beta. Either way the channel was not a decision the code was
 * making; it was a decision the endpoint had already made, in the wrong
 * direction, invisibly.
 *
 * So the check reads the LIST endpoint and `pickRelease()` makes the channel
 * decision here, where it can be driven over a table in plain Node with no
 * launch and no network — the same reason `src/main/p1.js` is a file of pure
 * functions. `tools/suites/updates.mjs` is that table.
 *
 * ---------------------------------------------------------------------------
 * WHAT electron-updater IS FOR HERE, AND WHY IT IS NOT ON THE WIRE
 * ---------------------------------------------------------------------------
 * `UPDATER_FEED` is the electron-builder `publish` block, which is the ONLY
 * thing electron-updater actually needs from this repository: electron-builder
 * writes it into `app-update.yml` inside the installer, and `autoUpdater` reads
 * it from there. It is pinned against `package.json` in BOTH directions by
 * `tools/suites/updates.mjs`, so the channel cannot be changed in one place.
 *
 * THE DELIVERY HALF IS CONFIGURED AND NOT ARMED, and the reason is measured
 * rather than assumed. Read against `electron-updater@6.8.9`:
 *
 *   · `out/electronHttpExecutor.js:7` — every request it makes goes through
 *     `session.fromPartition("electron-updater", {cache: false})`. That is a
 *     session created OUTSIDE `src/main/sessions.js`, and an unobserved session
 *     is indistinguishable from one that made no requests. `sessions.js` exists
 *     to make that impossible.
 *   · `out/providers/GitHubProvider.js:32,43` — the public provider's host is
 *     `github.com` (the `.atom` feed and the channel `.yml` under
 *     `/releases/download/`), NOT `api.github.com`. `api.github.com` is the
 *     PRIVATE provider's host. So `mayRequest()` cancels every request it makes.
 *   · a release asset redirects to `objects.githubusercontent.com`, so the
 *     download path is at minimum two hosts and cannot be reduced to one.
 *
 * P1' names ONE host. Arming electron-updater would name three and would add an
 * unobserved session, in exchange for a download that cannot happen anyway —
 * this project never creates a GitHub Release. So the check below is the whole
 * of what runs, `UPDATER_FEED` is the whole of what is configured, and
 * `docs/UPDATES.md` states exactly what would have to change first.
 *
 * @see PRIVACY.md "Two kinds of traffic"
 * @see docs/UPDATES.md
 */

/** GitHub's API host. The ONLY name this app's own code may resolve. */
export const UPDATE_HOST = 'api.github.com';

/** The repository the releases belong to. Spelled once; `UPDATER_FEED` reuses it. */
export const UPDATE_OWNER = 'itziklerner-pag';
export const UPDATE_REPO = 'stem-workbench';

/**
 * THE CHANNEL, seed §14: *"The first release is a pre-release channel, not a
 * launch"*. `'prerelease'` means a pre-release is offered; `'stable'` means only
 * a full release is. It is a value rather than a boolean so the transcript of a
 * failing check says which channel it was on, and so `UPDATER_FEED`'s
 * `releaseType` can be checked against the same word.
 */
export const UPDATE_CHANNELS = Object.freeze(['prerelease', 'stable']);
export const UPDATE_CHANNEL = 'prerelease';

/**
 * THE LIST ENDPOINT, NOT `/releases/latest` — see the header. `per_page` is
 * bounded because the channel decision only ever needs the newest page, and an
 * unbounded list is a request whose size somebody else controls.
 */
export const UPDATE_PATH = `/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases?per_page=20`;

/** `https://api.github.com/repos/itziklerner-pag/stem-workbench/releases?per_page=20` */
export const UPDATE_URL = `https://${UPDATE_HOST}${UPDATE_PATH}`;

/**
 * THE electron-updater FEED, WHICH IS `package.json`'s `build.publish`.
 *
 * electron-builder writes this into `app-update.yml` in the installer and
 * `autoUpdater` reads it from there; it is what "electron-updater against GitHub
 * Releases, following the pre-release channel" MEANS as configuration.
 * `tools/suites/updates.mjs` compares this object to `package.json` both ways,
 * so neither can be moved on its own — the same pin discipline the assertion
 * counts get in `docs/TESTING.md`.
 *
 * `releaseType: 'prerelease'` is electron-builder's spelling of `UPDATE_CHANNEL`
 * and the suite asserts the two agree rather than trusting the reader to notice.
 */
export const UPDATER_FEED = Object.freeze({
  provider: 'github',
  owner: UPDATE_OWNER,
  repo: UPDATE_REPO,
  releaseType: 'prerelease',
  vPrefixedTagName: true,
});

// --------------------------------------------------------------- the toggle
/**
 * THE PREFERENCE, AND ITS LIFETIME.
 *
 * `'local'` — `src/main/storage.js`: *"`'local'` outlives the browser and
 * `'session'` does not"*. A preference stored in `session` is a preference that
 * silently returns to its default on every restart, which for THIS preference
 * means an app the user switched OFF quietly switching itself back ON. That is
 * not a cosmetic difference and it is why the area is a named constant here
 * rather than a string at the call site: `tools/suites/updates.mjs` drives a
 * real `createStorage()` twice over one directory and watches the value survive.
 *
 * DEFAULT ON, deliberately, and the argument is in the header and in ADR 0001:
 * this app owns a Chromium that loads youtube.com, so it owns Chromium's
 * security patches. An absent preference is a user who has not chosen, and the
 * safer default for a user who has not chosen is the one that gets them patched.
 */
export const AUTO_UPDATE_AREA = 'local';
export const AUTO_UPDATE_KEY = 'autoUpdate';
export const AUTO_UPDATE_DEFAULT = true;

/**
 * A STORED VALUE -> THE SETTING. Absent is not `false`.
 *
 * `storage.get()` answers `null` for a key nobody has written (`storage.js`:
 * *"a stored `undefined` and an absent key are different facts, and the seam
 * answers `null` for the second"*). Only an explicit `false` turns the check
 * off; anything that is not a boolean is a value this app did not write, and it
 * reads as the default rather than as "off" — a corrupt preference must not be
 * able to silently disable security updates.
 *
 * @param {unknown} stored
 * @returns {boolean}
 */
export function autoUpdateFrom(stored) {
  return typeof stored === 'boolean' ? stored : AUTO_UPDATE_DEFAULT;
}

// -------------------------------------------------------------- the channel
/**
 * WHICH RELEASE THIS CHANNEL OFFERS. A pure function over GitHub's own release
 * objects, so the channel decision is exercised by a table rather than by a
 * network round trip nobody can reproduce.
 *
 * THE RULES, and each of them is a row in `tools/suites/updates.mjs`:
 *   · A DRAFT IS NEVER OFFERED, on either channel. A draft is unpublished — its
 *     assets are not downloadable and its tag may not exist yet — so offering
 *     one would point the user at a release that is not there.
 *   · `'prerelease'` OFFERS BOTH. The beta channel is not "pre-releases only":
 *     a user on the beta channel who is behind a STABLE release is still behind.
 *     Excluding stable would strand them the moment the first full release ships.
 *   · `'stable'` OFFERS ONLY A FULL RELEASE, which is the whole difference
 *     between the two channels and the reason this is not a boolean.
 *   · NEWEST BY `published_at`, NOT BY THE ORDER GITHUB SENT. The list endpoint
 *     is documented as ordered by CREATION, and a release created early and
 *     published late would otherwise be ranked above a newer one. Ties keep the
 *     order they arrived in, so the function is deterministic over equal dates.
 *
 * @param {Array<{tag_name?: string, draft?: boolean, prerelease?: boolean, published_at?: string}>} list
 * @param {'prerelease'|'stable'} [channel]
 * @returns {{tag: string, prerelease: boolean, publishedAt: string|null}|null}
 */
export function pickRelease(list, channel = UPDATE_CHANNEL) {
  if (!UPDATE_CHANNELS.includes(channel)) {
    throw new Error(`update: ${JSON.stringify(channel)} is not a release channel this app has - `
      + `it names one of ${UPDATE_CHANNELS.join(', ')}.`);
  }
  if (!Array.isArray(list)) return null;
  const usable = list
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r && typeof r.tag_name === 'string' && r.tag_name
      && r.draft !== true
      && (channel === 'prerelease' || r.prerelease !== true));
  if (!usable.length) return null;
  const at = (r) => {
    const t = Date.parse(r.published_at || '');
    return Number.isFinite(t) ? t : -Infinity;
  };
  usable.sort((a, b) => (at(b.r) - at(a.r)) || (a.i - b.i));
  const best = usable[0].r;
  return { tag: best.tag_name, prerelease: best.prerelease === true, publishedAt: best.published_at || null };
}

/**
 * The request carries NOTHING THAT DISTINGUISHES ONE INSTALL FROM ANOTHER.
 *
 * One header, and it is a content negotiation. No `User-Agent` override — the
 * one Chromium sends is the one PRIVACY.md discloses, and inventing a product
 * string here would be inventing an identifier. No cookies: `credentials` is
 * left at the fetch default (`same-origin`), so nothing this app stores travels.
 */
const UPDATE_HEADERS = Object.freeze({ accept: 'application/vnd.github+json' });

/**
 * Build the update check.
 *
 * IT IS ISSUED ON THE APP'S OWN SESSION, THROUGH `Session.fetch`, and that is
 * not a style choice. `node:https` from the main process would leave Chromium's
 * network stack entirely — no `webRequest`, no proxy, no policy — and the
 * instrument in `src/main/sessions.js` would be looking at a stack this request
 * never entered. A request the observer cannot see is the failure mode P1'
 * exists to make impossible, so the transport is chosen for its observability
 * rather than for its convenience. `src/main/netguard.js` now enforces that from
 * the other side by taking `node:https` away from this process entirely.
 *
 * @param {object} o
 * @param {Electron.Session} o.session  the app's own session (`sessions.js`, label `app`)
 * @param {boolean} [o.enabled]         whether `check()` may put a request on the wire
 * @param {'prerelease'|'stable'} [o.channel]
 */
export function createUpdateCheck({ session: ses, enabled = true, channel = UPDATE_CHANNEL }) {
  if (!UPDATE_CHANNELS.includes(channel)) {
    throw new Error(`update: ${JSON.stringify(channel)} is not a release channel this app has - `
      + `it names one of ${UPDATE_CHANNELS.join(', ')}.`);
  }
  let on = enabled === true;
  const stats = {
    checks: 0, ok: 0, failed: 0, declined: 0, enabledChanges: 0,
    lastStatus: null, lastError: null, latest: null, latestIsPrerelease: null,
  };

  /**
   * Ask once. RESOLVES ON FAILURE rather than rejecting: an update check is the
   * least important thing this app does and a network that is off — which
   * PRIVACY.md invites the user to try — must not be an error the user sees.
   *
   * @returns {Promise<{asked: boolean, ok: boolean, status: number|null, tag: string|null, prerelease: boolean|null}>}
   */
  async function check() {
    if (!on) { stats.declined++; return { asked: false, ok: false, status: null, tag: null, prerelease: null }; }
    stats.checks++;
    try {
      const res = await ses.fetch(UPDATE_URL, { method: 'GET', headers: UPDATE_HEADERS });
      stats.lastStatus = res.status;
      if (!res.ok) { stats.failed++; return { asked: true, ok: false, status: res.status, tag: null, prerelease: null }; }
      const body = await res.json().catch(() => null);
      const picked = pickRelease(body, channel);
      stats.ok++;
      stats.latest = picked ? picked.tag : null;
      stats.latestIsPrerelease = picked ? picked.prerelease : null;
      return { asked: true, ok: true, status: res.status, tag: stats.latest, prerelease: stats.latestIsPrerelease };
    } catch (err) {
      stats.failed++;
      stats.lastError = String((err && err.message) || err);
      return { asked: true, ok: false, status: null, tag: null, prerelease: null };
    }
  }

  /**
   * THE TOGGLE, AT RUNTIME. The preference is persisted by the caller (main.js
   * owns the storage handle); what this owns is whether the next `check()` may
   * put a request on the wire. Turning it off does not cancel a check already in
   * flight — there is at most one, it is issued once at boot, and cancelling it
   * would need an AbortController whose only effect would be to make a request
   * that has already left look like one that did not.
   *
   * @param {boolean} next
   * @returns {boolean} what it now is
   */
  function setEnabled(next) {
    const want = next === true;
    if (want !== on) { on = want; stats.enabledChanges++; }
    return on;
  }

  return {
    check,
    setEnabled,
    isEnabled: () => on,
    stats: () => ({ ...stats, enabled: on }),
    url: UPDATE_URL,
    host: UPDATE_HOST,
    channel,
  };
}
