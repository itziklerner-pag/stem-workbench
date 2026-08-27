/**
 * WHETHER THE SOURCE PARTITION IS SIGNED IN — AND THE FALLBACK THAT MAKES THE
 * ANSWER UNABLE TO MATTER.
 *
 * `desktop-app-plan.md` seed §9 decides three things about sign-in: a stock
 * Chrome user-agent on `persist:youtube` (`src/main/useragent.js`), a session
 * that survives a restart (the partition is `persist:`, so cookies are on disk),
 * and a **graceful anonymous fallback if Google refuses**. This file is the
 * third one, and it is the only one of the three that is a piece of behaviour
 * rather than a piece of configuration.
 *
 * ---------------------------------------------------------------------------
 * "GRACEFUL" IS A CLAIM ABOUT WHAT CANNOT HAPPEN, SO IT IS BUILT AS ONE
 * ---------------------------------------------------------------------------
 * The product works signed OUT. Anonymous YouTube costs you separated ads and a
 * better chance of meeting a bot wall (`FAQ.md`), and it costs you nothing else:
 * the capture path, the engine, the deck, the transport and the export do not
 * know this file exists. So the requirement is not "handle the signed-out case",
 * it is **nothing about determining sign-in state may be able to stop the app**
 * — and that includes a bug in the determination itself.
 *
 * Hence the shape below: `readAccount()` wraps BOTH the jar read AND the verdict
 * in one `try`, and every failure of either becomes an anonymous answer carrying
 * the reason. A `catch` around only the IO would leave the verdict able to throw
 * into `boot()`, which is precisely the failure this is supposed to be immune
 * to. `tools/suites/smoke.mjs` watches that: its mutation makes the anonymous
 * verdict throw and the suite goes red on the REASON while the app still boots,
 * arms and plays.
 *
 * IT IS READ, NEVER OBEYED. Nothing in `src/` branches on `signedIn`. It reaches
 * the chrome bar as a line of text and stops there.
 *
 * ---------------------------------------------------------------------------
 * NAMES AND DOMAINS. NEVER A VALUE.
 * ---------------------------------------------------------------------------
 * `PRIVACY.md` says the app does not read your Google credentials, and a cookie
 * VALUE is the credential — `__Secure-3PSID` is not a fact about your session,
 * it IS your session. So the projection to `{name, domain}` happens in
 * `readAccount()`, at the one place the jar is obtained, and the pure function
 * below is typed so that a value is not in scope to leak: it never sees one.
 * The reported shape carries a boolean, a sentence, a COUNT and a list of
 * cookie NAMES.
 */

/**
 * The cookies Google sets only once you are signed in. `VISITOR_INFO1_LIVE`,
 * `YSC`, `PREF` and `CONSENT` are deliberately NOT here: anonymous YouTube sets
 * those, and a list that included them would report every visitor as signed in
 * — an estimator that saturates before the claim begins.
 *
 * `LOGIN_INFO` is YouTube's own and is the one that says "signed in to
 * YouTube" rather than "signed in to something at Google".
 */
export const SESSION_COOKIES = Object.freeze([
  'SID',
  '__Secure-1PSID',
  '__Secure-3PSID',
  'LOGIN_INFO',
]);

/** The hosts a Google sign-in leaves cookies on. Suffix match, never `includes()`. */
export const COOKIE_DOMAINS = Object.freeze(['google.com', 'youtube.com']);

/** The exact sentence an empty jar produces. `tools/suites/smoke.mjs` spells it out. */
export const NO_SESSION_COOKIE = 'no Google session cookie in this partition';
/** ...and the one every failure produces, whatever the failure was. */
export const JAR_UNREADABLE = 'the partition\'s cookie jar could not be read';

/**
 * @param {string} domain  a cookie's domain, with or without the leading dot
 */
function isGoogles(domain) {
  const d = String(domain || '').toLowerCase().replace(/^\./, '').replace(/\.$/, '');
  return COOKIE_DOMAINS.some((base) => d === base || d.endsWith(`.${base}`));
}

/**
 * THE VERDICT, AS A PURE FUNCTION over cookie names and domains.
 *
 * @param {{name: string, domain: string}[]} jar  NO VALUES — see the header
 * @returns {{signedIn: boolean, reason: string, cookies: number, session: string[]}}
 */
export function accountFromCookies(jar) {
  const all = Array.isArray(jar) ? jar : [];
  const session = [...new Set(all
    .filter((c) => c && SESSION_COOKIES.includes(c.name) && isGoogles(c.domain))
    .map((c) => c.name))].sort();
  if (session.length === 0) {
    // ---------------------------------------------------------- THE FALLBACK
    // The whole product works from here. This branch is not an error path and
    // it is not a degraded mode; it is the state the app is in the first time
    // anybody runs it, and the state it stays in for anybody who reads
    // `FAQ.md` and decides not to risk their Google account.
    return { signedIn: false, reason: NO_SESSION_COOKIE, cookies: all.length, session: [] };
  }
  return { signedIn: true, reason: `${session.length} Google session cookie(s) in this partition`, cookies: all.length, session };
}

/**
 * @param {Electron.Session} ses  `persist:youtube`, and nothing else — the app's
 *                                own session has no Google cookies and asking it
 *                                would be asking the wrong jar
 * @returns {Promise<{signedIn: boolean, reason: string, cookies: number|null, session: string[]}>}
 *
 * IT CANNOT REJECT, AND THAT IS THE POINT OF IT. See the header: the verdict is
 * inside the `try` on purpose, so that a bug in `accountFromCookies` becomes an
 * anonymous answer with a different sentence rather than a rejected promise in
 * `boot()`.
 */
export async function readAccount(ses) {
  try {
    const jar = await ses.cookies.get({});
    return accountFromCookies(jar.map((c) => ({ name: c.name, domain: c.domain })));
  } catch (err) {
    return {
      signedIn: false,
      reason: `${JAR_UNREADABLE}: ${(err && err.message) || err}`,
      cookies: null,
      session: [],
    };
  }
}
