/**
 * THE ONE PLACE THIS APP TELLS A WEBSITE SOMETHING ABOUT ITSELF THAT IS NOT
 * LITERALLY TRUE — and it is one session wide, one string long, and asserted.
 *
 * Google blocks sign-in from embedded browser frameworks BY USER-AGENT: the
 * *"This browser or app may not be secure"* page, policy since 2019. An Electron
 * app whose UA says `Electron/44.0.0` cannot sign anybody in to YouTube, so
 * `desktop-app-plan.md` seed §9 decides that the partition youtube.com runs on
 * — and nothing else — presents a stock Chrome user-agent. `FAQ.md`'s *"Why does
 * it tell Google it is Chrome?"* is the disclosure that decision owes the user,
 * in full, including that Google does not endorse this and that it may stop
 * working.
 *
 * NO `electron` IMPORT IN THIS FILE, ON PURPOSE — the same split as
 * `p1.js`/`sessions.js` and `navigation.js`/`youtube.js`, and for the same
 * reason. The string and the table are decisions, so they are asserted directly
 * in plain node over a table of platforms, with no display, no launch and no
 * mutex; `src/main/sessions.js` is the electron half that puts the string on a
 * session, and it is the ONLY caller.
 *
 * ---------------------------------------------------------------------------
 * WHY THE VERSION IS READ OFF THE RUNTIME AND NOT TYPED HERE
 * ---------------------------------------------------------------------------
 * `stockChromeUA` takes the Chromium version as an ARGUMENT and its one caller
 * passes `process.versions.chrome`. So the app claims to be the Chromium it
 * really is running, and an Electron upgrade moves the claim with it. A literal
 * would start out true and become a lie on the first `npm update` — one that
 * nothing would notice, because a stale UA does not fail, it just gets more
 * conspicuous to the thing it is trying not to be conspicuous to.
 *
 * The rest of the string is FROZEN TEXT and not a claim about the machine.
 * Chrome's UA reduction (Chrome 101-113) pinned the platform token to one of
 * three literals, the minor/build/patch fields to `0.0.0`, and `AppleWebKit` and
 * `Safari` to `537.36` for ever. Deriving any of them from `os.release()` would
 * produce a string no real Chrome ever sends, which is the opposite of the point.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT DO, stated so the absence is on the record
 * ---------------------------------------------------------------------------
 * `Session.setUserAgent()` overrides the `User-Agent` HEADER and
 * `navigator.userAgent` — both MEASURED (`tools/suites/shell.mjs`). It does NOT
 * rewrite the USER-AGENT CLIENT HINTS (`Sec-CH-UA`, `navigator.userAgentData`),
 * which Chromium derives from its own brand list. A site that reads those sees
 * Chromium's brands, and `FAQ.md` says in as many words that Google can detect
 * embedded frameworks by more than the user-agent and that this may stop working
 * at any time. Nothing here should be read as a promise that it will not.
 */

/**
 * Chrome's three frozen platform tokens, verbatim from a real Chrome on each
 * platform. `10_15_7` and `Windows NT 10.0` are frozen literals in Chrome's own
 * reduced UA, not readings of the machine, and they are not to be "corrected"
 * against the host's real version.
 */
export const PLATFORM_TOKENS = Object.freeze({
  darwin: 'Macintosh; Intel Mac OS X 10_15_7',
  win32: 'Windows NT 10.0; Win64; x64',
  linux: 'X11; Linux x86_64',
});

/**
 * What an unrecognised `process.platform` gets. Every platform Chrome does not
 * have a frozen token for (`freebsd`, `openbsd`, `aix`, …) runs the same X11
 * build, and a token nobody ships is more conspicuous than the common one.
 */
export const FALLBACK_PLATFORM = 'linux';

/**
 * `'152.0.7977.54'` -> `'152'`. Chrome's reduced UA reports the major only, with
 * the remaining three fields zeroed.
 *
 * @param {string} version
 * @returns {string|null} null if there is no leading integer to read
 */
export function chromeMajor(version) {
  const m = /^(\d+)(?:\.|$)/.exec(String(version).trim());
  return m ? m[1] : null;
}

/**
 * @param {object} o
 * @param {string} o.chromeVersion  `process.versions.chrome`
 * @param {string} o.platform       `process.platform`
 * @returns {string} a stock Chrome user-agent for that Chromium on that platform
 *
 * IT THROWS ON A VERSION IT CANNOT READ rather than falling back to a literal.
 * A UA this function cannot build is a sign-in that will silently not work, and
 * a silent not-working is what this whole repository's assertion discipline
 * exists to refuse. `process.versions.chrome` is always present in Electron, so
 * the throw is a programming error arriving loudly at the line that caused it.
 */
export function stockChromeUA({ chromeVersion, platform }) {
  const major = chromeMajor(chromeVersion);
  if (!major) {
    throw new Error(`useragent: cannot build a Chrome user-agent from the Chromium version ${JSON.stringify(chromeVersion)}. `
      + 'Its one caller passes process.versions.chrome, which is always a dotted version in Electron.');
  }
  const token = PLATFORM_TOKENS[platform] || PLATFORM_TOKENS[FALLBACK_PLATFORM];
  return `Mozilla/5.0 (${token}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

/**
 * THE SESSIONS THAT PRESENT THE DISGUISE, BY LABEL, AND IT IS A CLOSED LIST.
 *
 * `youtube` is the partition in `src/main/p1.js`'s `SESSION_OWNERS` whose owner
 * is `user` — a browser the user drives, on somebody else's site. The `app`
 * session is OURS: it carries the `app://` origin, the vendored unit's assets
 * and the ONE request P1' allows (the update check, `src/main/update.js`). That
 * request must go out as what it is. A GitHub API call wearing a Chrome UA would
 * be this app lying to a host it has no reason to lie to, and it would make the
 * one sentence `PRIVACY.md` has to be exactly right about harder to read, not
 * easier.
 *
 * `src/main/sessions.js` REFUSES to apply an entry here to an `app`-owned
 * session, so adding a label to this list cannot quietly disguise our own
 * traffic — it stops the app at boot instead.
 */
export const UA_SESSIONS = Object.freeze(['youtube']);

/**
 * @param {string} label                   a key of `SESSION_OWNERS` in src/main/p1.js
 * @param {{chromeVersion: string, platform: string}} env
 * @returns {string|null} the user-agent that session presents, or null to leave
 *                        Electron's own alone
 */
export function userAgentFor(label, env) {
  return UA_SESSIONS.includes(label) ? stockChromeUA(env) : null;
}
