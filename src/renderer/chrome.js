/**
 * The chrome bar.
 *
 * It renders what `main` pushes and asks for nothing. The Arm button is present
 * and DISABLED on purpose: HOST-DESIGN.md §6.4 makes this surface the primary
 * arm gesture, and a control that is visibly not-yet-wired is a more honest
 * skeleton than an empty bar that will one day grow one.
 *
 * THE REFUSAL LINE IS LOAD-BEARING (§1.6). The navigation allowlist is a
 * refusal, not a redirect: a blocked navigation says so here. A silent cancel is
 * how a sign-in flow becomes "the button does nothing".
 */
const $ = (id) => document.getElementById(id);

const short = (url) => {
  if (!url) return '—';
  try { const u = new URL(url); return u.hostname + (u.pathname === '/' ? '' : u.pathname); }
  catch { return String(url); }
};

function render(s) {
  $('source').textContent = short(s.sourceUrl);
  $('source').title = s.sourceUrl || '';
  $('deck').textContent = s.deckVendored ? 'vendored' : 'placeholder (not vendored yet)';
  $('engine').textContent = s.engine
    ? `coi=${s.engine.coi} sab=${s.engine.sab}`
    : 'starting…';
  const last = s.refusals && s.refusals.length ? s.refusals[s.refusals.length - 1] : null;
  $('refusal').textContent = last ? `refused: ${short(last.url)} — ${last.why}` : '';
}

if (window.__wbChrome) {
  window.__wbChrome.onStatus(render);
} else {
  // A missing bridge is a wiring failure, and it is worth being loud about
  // rather than rendering an empty bar that looks like "no source yet".
  $('refusal').textContent = 'no host bridge — preload/chrome.cjs did not run';
}
