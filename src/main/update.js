/**
 * THE ONE HOST THIS APP'S OWN CODE TALKS TO — rule P1', in one file.
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
 * measuring "one host" rather than "this host" — and `tools/suites/p1.mjs`
 * closes the other direction by standing up a fake host whose CERTIFICATE
 * carries this name, so a re-point that nobody meant fails to resolve.
 *
 * @see PRIVACY.md "Two kinds of traffic"
 */

/** GitHub's API host. The ONLY name this app's own code may resolve. */
export const UPDATE_HOST = 'api.github.com';

/** The releases endpoint for THIS repository. */
export const UPDATE_PATH = '/repos/itziklerner-pag/stem-workbench/releases/latest';

/** `https://api.github.com/repos/itziklerner-pag/stem-workbench/releases/latest` */
export const UPDATE_URL = `https://${UPDATE_HOST}${UPDATE_PATH}`;

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
 * rather than for its convenience.
 *
 * @param {object} o
 * @param {Electron.Session} o.session  the app's own session (`sessions.js`, label `app`)
 * @param {boolean} [o.enabled]         whether `check()` may put a request on the wire
 */
export function createUpdateCheck({ session: ses, enabled = true }) {
  const stats = { checks: 0, ok: 0, failed: 0, declined: 0, lastStatus: null, lastError: null, latest: null };

  /**
   * Ask once. RESOLVES ON FAILURE rather than rejecting: an update check is the
   * least important thing this app does and a network that is off — which
   * PRIVACY.md invites the user to try — must not be an error the user sees.
   *
   * @returns {Promise<{asked: boolean, ok: boolean, status: number|null, tag: string|null}>}
   */
  async function check() {
    if (!enabled) { stats.declined++; return { asked: false, ok: false, status: null, tag: null }; }
    stats.checks++;
    try {
      const res = await ses.fetch(UPDATE_URL, { method: 'GET', headers: UPDATE_HEADERS });
      stats.lastStatus = res.status;
      if (!res.ok) { stats.failed++; return { asked: true, ok: false, status: res.status, tag: null }; }
      const body = await res.json().catch(() => null);
      const tag = body && typeof body.tag_name === 'string' ? body.tag_name : null;
      stats.ok++;
      stats.latest = tag;
      return { asked: true, ok: true, status: res.status, tag };
    } catch (err) {
      stats.failed++;
      stats.lastError = String((err && err.message) || err);
      return { asked: true, ok: false, status: null, tag: null };
    }
  }

  return { check, stats: () => ({ ...stats }), enabled, url: UPDATE_URL, host: UPDATE_HOST };
}
