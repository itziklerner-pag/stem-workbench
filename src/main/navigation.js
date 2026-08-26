/**
 * The navigation allowlist for the SOURCE view — the one pointed at youtube.com.
 *
 * NO `electron` IMPORT IN THIS FILE, ON PURPOSE. It is the riskiest table in the
 * product (a hole here is an arbitrary web page inside the app's window, with the
 * app's window-open, download and permission handlers as the only thing left) and
 * a table is worth asserting against directly, in plain node, without a display,
 * a launch or a mutex. `src/main/youtube.js` is the electron half that wires it.
 *
 * The rule, from docs/HOST-DESIGN.md §1.6: **suffix match, never `includes()`**.
 * `includes('youtube.com')` accepts `youtube.com.evil.test`, which is somebody
 * else's host with our name in it; `tools/suites/shell.mjs` carries that exact
 * string as an assertion so the mistake cannot be made silently later.
 *
 * The allowlist is a REFUSAL, not a redirect (§1.6): a blocked navigation raises
 * a visible line in the chrome view. A silent cancel is how a sign-in flow
 * becomes "the button does nothing".
 */

/**
 * Exact hosts. `desktop-app-plan.md` seed §8's list, plus the two YouTube hosts
 * the mobile and bare-domain redirects land on.
 *
 * `accounts.google.com`, `accounts.youtube.com`, `consent.youtube.com` and
 * `myaccount.google.com` are here because signing in to YouTube goes through
 * them (seed §9 step 5) — and they are here BY NAME. A `*.google.com` suffix
 * would hand the view every Google property there is.
 */
export const NAV_ALLOW = Object.freeze([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'accounts.google.com',
  'accounts.youtube.com',
  'consent.youtube.com',
  'myaccount.google.com',
]);

/**
 * The one suffix. YouTube's own subdomains (`music.`, `studio.`, the `*.ggpht`
 * image hosts are subresources and never navigations) stay reachable without
 * naming each one; anything that merely CONTAINS the string does not.
 */
export const NAV_ALLOW_SUFFIX = '.youtube.com';

/**
 * @param {string} url  the URL a navigation is heading to
 * @returns {boolean}   true iff the source view may go there
 *
 * https ONLY. `http:` is refused because a downgrade inside the app's own window
 * is not something a sign-in flow needs; `file:`, `data:`, `blob:` and
 * `javascript:` are refused because none of them is a page the user browsed to.
 * A main-process `loadURL()` does not raise `will-navigate` at all, so the
 * fixture the gate loads over `file://` is not an exception to this — it is
 * simply not a navigation the guard ever sees.
 */
export function isAllowedNavigation(url) {
  let u;
  try { u = new URL(String(url)); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  // A trailing dot is the same host to DNS and a different string to `===`.
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  return NAV_ALLOW.includes(host) || host.endsWith(NAV_ALLOW_SUFFIX);
}
