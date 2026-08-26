/**
 * RULE P1', AS A TABLE AND TWO PURE FUNCTIONS.
 *
 * *The app's own code talks to exactly one named host, GitHub Releases, for the
 * update check, and nothing else.* `CONTRIBUTING.md` states it; `PRIVACY.md`
 * says it in the user's words; `src/main/sessions.js` installs it on every
 * session the app creates; `tools/suites/p1.mjs` measures it over a real launch.
 *
 * THIS FILE IMPORTS NOTHING FROM ELECTRON, and that is the point of it being a
 * file. `src/main/assets.js` and `src/main/protocol.js` are split for the same
 * reason and it is written down there: the decision is a pure function, so the
 * suite drives it over a table in plain Node — no display, no launch, no mutex —
 * and the launch is then only asked whether the app really uses it.
 *
 * A policy that can only be exercised by starting an app is a policy whose
 * edge cases are never exercised at all.
 */
import { UPDATE_HOST } from './update.js';

/**
 * Every session this product has, and WHOSE TRAFFIC IT IS.
 *
 *   `app`      the default session — our three renderers, the `app://` origin,
 *              the vendored unit's assets, and the update check. P1' binds it.
 *   `youtube`  the persistent partition that holds the source view and nothing
 *              else. Every request on it was caused by the user browsing
 *              YouTube. PRIVACY.md excludes it BY NAME rather than by silence.
 *
 * A LABEL THAT IS NOT IN THIS TABLE IS REFUSED BY THE FACTORY. Adding a
 * partition to this product therefore cannot happen without somebody writing
 * down whose traffic it is — which is otherwise the decision that gets made by
 * accident, in a hurry, by whoever needed a second cookie jar.
 */
export const SESSION_OWNERS = Object.freeze({
  app: 'app',
  youtube: 'user',
});

/**
 * The schemes P1' is ABOUT. Everything else — `app:`, `blob:`, `data:`,
 * `devtools:`, `filesystem:` — never leaves the machine, so cancelling one would
 * break the app without protecting anybody.
 *
 * `ws:` and `wss:` are in the set because a WebSocket is exactly the shape a
 * telemetry channel arrives in, and it is the one that would not read as a
 * "fetch" to somebody skimming a diff.
 */
export const NETWORK_SCHEMES = Object.freeze(['http:', 'https:', 'ws:', 'wss:']);

/**
 * May this request go on the wire?
 *
 * @param {string} owner  `'app'` (P1' binds it) or anything else (the user's own)
 * @param {string} url
 * @returns {boolean}
 */
export function mayRequest(owner, url) {
  if (owner !== 'app') return true;
  let u;
  try { u = new URL(String(url)); } catch { return true; }
  // An unparseable or non-network URL is not P1's business, and refusing one
  // would be this rule breaking the app to protect nothing.
  if (!NETWORK_SCHEMES.includes(u.protocol)) return true;
  // `https:` ONLY. `http://api.github.com` is a downgrade somebody would have to
  // have written on purpose, and it is not this app's one host.
  return u.protocol === 'https:' && u.hostname === UPDATE_HOST;
}

/**
 * `https://api.github.com/repos/x` -> `https://api.github.com`. What the
 * assertion compares, because P1' is a claim about HOSTS and a path is noise in
 * it. Anything unparseable comes back whole rather than as `null`, so a URL this
 * function cannot read is visible in the failure rather than absent from it.
 */
export function originOf(url) {
  try { const u = new URL(String(url)); return `${u.protocol}//${u.host}`; }
  catch { return String(url); }
}

/**
 * The `app`-owned rows that P1' forbids, from a session log. One place, so the
 * app's policy and the suite's verdict cannot drift into disagreeing about what
 * a violation IS.
 *
 * @param {{owner: string, url: string}[]} rows
 */
export function violations(rows) {
  return rows.filter((r) => r && r.owner === 'app' && !mayRequest('app', r.url));
}
