/**
 * The gate's SECOND look at the same profile — and it is the only thing in this
 * repository that can answer "does the sign-in survive a restart?".
 *
 * `desktop-app-plan.md` seed §9 decides that the YouTube session persists across
 * restarts, and stem-workbench#8's acceptance criterion is deliberately
 * unforgiving about how that may be shown: *"Cookies set in the partition
 * survive an app restart — asserted by READING THEM BACK, not by asserting the
 * partition string."* The string `persist:youtube` is a claim about intent.
 * Chromium reading a cookie back out of a profile a previous process wrote is a
 * claim about the product.
 *
 * So `tools/suites/shell.mjs` launches the app TWICE with the same
 * `--user-data`: the first launch runs `probe.mjs`, which seeds one marker
 * cookie into the partition on its way out, and the second runs THIS, which
 * reports the jar it found before anything in the app had touched it.
 *
 * IT IS ITS OWN PROBE RATHER THAN A FLAG ON THE OTHER ONE, for the reason
 * `src/main/main.js` gives at `--gate-probe`: one module per QUESTION, because a
 * probe that both measured the window and answered a restart would have failures
 * nobody could tell apart. This one asks two things and both are about the jar.
 *
 * NAMES AND DOMAINS, NEVER A VALUE — the same rule as `src/main/signin.js`, and
 * for the same reason: the value of a session cookie is not a fact about the
 * session, it is the session. A gate report is written to disk and read by
 * people; there is no version of this that should carry one.
 */
import fs from 'node:fs';
import path from 'node:path';

export async function runGate({ state, outDir }) {
  fs.mkdirSync(outDir, { recursive: true });

  const ses = state.sessions.get('youtube');
  let jar = null;
  let threw = null;
  try { jar = await ses.cookies.get({}); }
  catch (err) { threw = String((err && err.message) || err); }

  const R = {
    gate: 1,
    probe: 'restart',
    when: new Date().toISOString(),
    versions: { electron: process.versions.electron, chrome: process.versions.chrome },
    /** What was on disk when this process started. Names and domains only. */
    cookiesAtStart: jar ? jar.map((c) => ({ name: c.name, domain: c.domain })) : null,
    cookiesThrew: threw,
    /**
     * WHAT THE APP ITSELF MADE OF THAT JAR, and it was computed in `boot()`
     * before this file was imported — so it is the product's own verdict over a
     * restored profile, not this probe's second opinion of one.
     */
    account: state.account ? JSON.parse(JSON.stringify(state.account)) : null,
    /** The disguise is configuration and is re-applied every boot; read back to say so. */
    sourceUserAgent: state.source.webContents.session.getUserAgent(),
  };

  fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(R, null, 2)}\n`);
  console.log(`[gate] wrote ${path.join(outDir, 'report.json')}`);
  return 0;
}
