/**
 * The chrome bar.
 *
 * It renders what `main` pushes, and it carries ONE gesture: Arm.
 *
 * ---------------------------------------------------------------------------
 * THE BUTTON USED TO SHIP `disabled`, AND THE APP TOLD PEOPLE TO PRESS IT
 * ---------------------------------------------------------------------------
 * `HOST-DESIGN.md` §6.4 makes this surface the primary arm gesture — *"the
 * first thing the owner touches"*, because a desktop app has no toolbar icon —
 * and `src/main/deck-host.js`'s own refusal text says so to the user in as many
 * words: *"Nothing is armed yet. Arm this Source first, from the Source menu or
 * the Arm button."* The button was nevertheless shipped `disabled`, with the
 * tooltip *"not built yet"*, for a whole wave AFTER the Host duties landed and
 * arming started working. An auditor drove the running app with a real pointer
 * click, got nothing, read the markup, and found the attribute.
 *
 * So: the control is live, it is the same `deckHost.arm()` the menu item calls,
 * and the label follows the session rather than the click — `main` owns the arm
 * epoch and answers with what it decided, which is what stops the bar from
 * saying "Disarm" over an arm that was refused.
 *
 * THE REFUSAL LINE IS LOAD-BEARING (§1.6). The navigation allowlist is a
 * refusal, not a redirect: a blocked navigation says so here. A silent cancel is
 * how a sign-in flow becomes "the button does nothing" — and so is a refused
 * arm, which is why `arm()`'s answer is drawn on the same line.
 */
const $ = (id) => document.getElementById(id);

const short = (url) => {
  if (!url) return '—';
  try { const u = new URL(url); return u.hostname + (u.pathname === '/' ? '' : u.pathname); }
  catch { return String(url); }
};

/** The last refusal `main` pushed, so a local one can be drawn over it. */
let lastPushed = '';

function paintArm(armed) {
  const b = $('arm');
  b.textContent = armed ? 'Disarm' : 'Arm';
  b.dataset.armed = armed ? '1' : '0';
  b.title = armed
    ? 'Disarm — the capture stops and the player is handed back'
    : 'Arm this Source — the same gesture as Source → Arm this Source';
}

function render(s) {
  $('source').textContent = short(s.sourceUrl);
  $('source').title = s.sourceUrl || '';
  $('deck').textContent = s.deckVendored ? 'vendored' : 'placeholder (not vendored yet)';
  $('engine').textContent = s.engine
    ? `coi=${s.engine.coi} sab=${s.engine.sab}`
    : 'starting…';
  paintArm(s.armed === true);
  const last = s.refusals && s.refusals.length ? s.refusals[s.refusals.length - 1] : null;
  lastPushed = last ? `refused: ${short(last.url)} — ${last.why}` : '';
  $('refusal').textContent = lastPushed;
}

if (window.__wbChrome) {
  window.__wbChrome.onStatus(render);
  /**
   * THE ANSWER IS DRAWN, INCLUDING THE UNHAPPY ONE. `arm()` refuses when the
   * source view has no page — `ARM_REFUSALS.NO_SOURCE` — and the deck raises its
   * own banner for that. The bar says it too, because the user pressed a control
   * HERE and a gesture that produces no visible outcome is the defect this file
   * was rewritten to fix.
   */
  $('arm').addEventListener('click', async () => {
    const b = $('arm');
    const want = b.dataset.armed !== '1';
    b.disabled = true;                       // one gesture in flight, never two
    try {
      const r = await window.__wbChrome.arm(want);
      paintArm(r && r.armed === true);
      $('refusal').textContent = r && r.ok === false
        ? `${r.message || 'the arm gesture was refused'}`
        : lastPushed;
    } catch (err) {
      $('refusal').textContent = `arm failed: ${(err && err.message) || err}`;
    } finally {
      b.disabled = false;
    }
  });
} else {
  // A missing bridge is a wiring failure, and it is worth being loud about
  // rather than rendering an empty bar that looks like "no source yet".
  $('refusal').textContent = 'no host bridge — preload/chrome.cjs did not run';
  $('arm').disabled = true;
}
