/**
 * The chrome bar.
 *
 * It renders what `main` pushes, and it carries the gestures a desktop app has
 * nowhere else to put: Arm, Open file, Export stems, and the auto-update toggle.
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
 *
 * ---------------------------------------------------------------------------
 * THE TWO FILE GESTURES, AND WHY NEITHER OF THEM SHIPS `disabled`
 * ---------------------------------------------------------------------------
 * `Open file…` opens the operating system's own chooser through
 * `src/main/files.js`'s intake; `Export stems…` settles the folder stems go to
 * and then asks for the write. Neither is complete in this build — the bytes
 * path and the separation runner are upstream — and the temptation is to ship
 * them `disabled` until they are. **That is the exact defect above.** A control
 * that is present and dead teaches the user that the app is broken; a control
 * that REFUSES, by name, on the line beside it, teaches them what is missing.
 * So every gesture here is live and every answer is drawn, including the
 * unhappy ones.
 *
 * `Export stems…` DOES NOT DISABLE ITSELF IN FLIGHT, AND `Arm` DOES. That looks
 * inconsistent and is not. Arming is a TOGGLE: a second click while the first is
 * in flight means the OPPOSITE gesture, so the bar has to hold one gesture at a
 * time or it cannot know which way it went. A second Export is the SAME gesture,
 * and `ensureExportFolder()` in `src/main/files.js` already de-duplicates it —
 * *"a second request that arrives while a picker is already up JOINS it rather
 * than opening a second one"*. Disabling the button here would move that rule
 * into the renderer, where the picker is not, and would leave the rule in
 * `files.js` reachable by nothing a user can press.
 *
 * ---------------------------------------------------------------------------
 * THE REFUSAL LINE HAS TWO WRITERS, AND THE NEWER ONE WINS
 * ---------------------------------------------------------------------------
 * `main` pushes navigation refusals; the gestures here write their own answers.
 * Before, every push overwrote whatever a gesture had just drawn, so a refusal
 * the user caused could be erased by an unrelated status push a moment later —
 * a refusal drawn for 40 ms is a refusal nobody read. The line now keeps the
 * MOST RECENT of the two: a push wins only when it carries a refusal this bar
 * has not drawn yet, which is what `refusalCount` (a monotone count from `main`,
 * not the capped `refusals` array) is for.
 */
const $ = (id) => document.getElementById(id);

const short = (url) => {
  if (!url) return '—';
  try { const u = new URL(url); return u.hostname + (u.pathname === '/' ? '' : u.pathname); }
  catch { return String(url); }
};

/**
 * A FOLDER, FOR A 44 px BAR. The last two components, because the last one alone
 * is very often `stems` or `Music` and says nothing about WHICH one. The whole
 * path is on the `title`, where a person can read it without it costing the bar
 * a line it does not have.
 */
const shortDir = (dir) => {
  if (!dir) return '—';
  const parts = String(dir).split(/[/\\]/).filter(Boolean);
  return parts.length > 1 ? `…/${parts.slice(-2).join('/')}` : String(dir);
};

const MB = (n) => `${(Number(n) / 1e6).toFixed(0)} MB`;

/**
 * WHAT THE ENGINE SAID, IN ONE LINE — and every branch of it is the engine's own
 * report rather than this bar's guess. The fields are `offscreen/engine.js`'s
 * `state.job` (`:136`) and `state.model` (`:116`), relayed by `main`'s read-only
 * tap on the bus and pushed here; nothing in this file computes a percentage.
 *
 * `null` IS "NOTHING HAS BEEN REPORTED YET" AND IS DRAWN AS `—`, NOT AS "idle".
 * They are the same picture to a user and completely different facts: `idle` is
 * a statement the engine made, and `—` is this bar saying it has not been told.
 * Collapsing them is how a relay that stopped running reads as an engine with
 * nothing to do — the same three-state argument as the sign-in indicator below.
 *
 * THE ORDER IS A PRIORITY, and it is stated because two of these can be true at
 * once: an error outranks progress, a running job outranks a model load (the
 * weights are loaded ON THE WAY to a job), and a model load outranks the live
 * pipeline's own status. A readout that showed the least interesting true thing
 * would be worse than none.
 */
function separationLine(p) {
  if (!p) return '—';
  const job = p.job || {};
  const model = p.model || {};
  if (job.status === 'error') return `failed${job.stage ? ` at ${job.stage}` : ''}: ${job.error || 'no reason given'}`;
  if (model.status === 'error') return `weights failed: ${model.error || 'no reason given'}`;
  if (job.status && job.status !== 'idle') {
    const eta = Number.isFinite(job.etaMs) && job.etaMs > 0 ? ` · ~${Math.round(job.etaMs / 1000)}s left` : '';
    return `separating ${job.chunk}/${job.chunks} · ${job.pct}%${eta}`;
  }
  if (model.status === 'loading') {
    const got = Number.isFinite(model.got) && Number.isFinite(model.total) && model.total > 0
      ? ` ${MB(model.got)}/${MB(model.total)}` : '';
    return `weights ${model.phase || 'loading'}${got}`;
  }
  if (p.live && p.live !== 'idle') return `live ${p.live}`;
  return `idle · weights ${model.status || 'unknown'}`;
}

/** The last refusal `main` pushed, so a local one can be drawn over it. */
let lastPushed = '';
/** How many refusals `main` had issued when this bar last drew one of them. */
let drawnRefusals = -1;
/** The last answer a gesture HERE produced. See the header: the newer one wins. */
let localAnswer = '';

/** One writer, so the two above cannot disagree about what is on screen. */
function paintRefusal() { $('refusal').textContent = localAnswer || lastPushed; }

/**
 * An answer from `main`, drawn on the control that produced it AND on the line.
 * `data-outcome` is set from what `main` ANSWERED, never from what was clicked —
 * the same rule as `paintArm` — so a refused gesture cannot look like one that
 * worked, and it survives a status push because `render()` does not touch it.
 */
function paintAnswer(id, r, fallback) {
  // THE CODE ITSELF, not a boolean. `ok`, or the machine name of the refusal —
  // so the control says WHICH refusal, and a stylesheet keys on
  // `:not([data-outcome="ok"])` rather than on a list of codes it has to track.
  $(id).dataset.outcome = r && r.ok === true ? 'ok' : ((r && r.code) || 'refused');
  localAnswer = r && r.ok === true ? '' : `${(r && r.message) || fallback}`;
  paintRefusal();
}

function paintArm(armed) {
  const b = $('arm');
  b.textContent = armed ? 'Disarm' : 'Arm';
  b.dataset.armed = armed ? '1' : '0';
  b.title = armed
    ? 'Disarm — the capture stops and the player is handed back'
    : 'Arm this Source — the same gesture as Source → Arm this Source';
}

/**
 * THE TOGGLE FOLLOWS THE PUSH, NOT THE CLICK — the same rule as `paintArm`.
 *
 * `null` (before `createUpdateCheck()` has run, or when `main` refused the
 * gesture) paints INDETERMINATE rather than unchecked, because unchecked is a
 * statement — "auto-update is off" — and a bar that made that statement while
 * the app had not decided yet would be telling the user their security updates
 * were disabled when they are not.
 */
function paintAutoUpdate(on) {
  const el = $('autoupdate');
  el.indeterminate = on === null || on === undefined;
  el.checked = on === true;
}

function render(s) {
  $('source').textContent = short(s.sourceUrl);
  $('source').title = s.sourceUrl || '';
  /**
   * THE FILE SOURCE, BY ITS TITLE AND NOTHING ELSE. `main` does not send this
   * renderer the absolute path or the path token, and this is the surface that
   * would leak them if it had them: `src/main/files.js` mints a one-shot token
   * precisely so that *"the renderer that fetches the bytes must not be able to
   * name a path"*, and a bar that printed the path would hand every renderer on
   * this origin the thing the token exists to withhold.
   */
  $('file').textContent = s.file ? s.file.title : '—';
  $('file').title = s.file ? `${s.file.title} — ${s.file.mime}` : 'no file chosen yet';
  $('progress').textContent = separationLine(s.progress);
  $('progress').title = s.progress ? JSON.stringify(s.progress) : 'the engine has not reported yet';
  $('dest').textContent = shortDir(s.exportFolder);
  $('dest').title = s.exportFolder || 'no export folder chosen yet — the first export asks, once';
  $('deck').textContent = s.deckVendored ? 'vendored' : 'placeholder (not vendored yet)';
  $('engine').textContent = s.engine
    ? `coi=${s.engine.coi} sab=${s.engine.sab}`
    : 'starting…';
  /**
   * THE SIGN-IN INDICATOR, AND IT IS THREE STATES RATHER THAN TWO.
   *
   * `null` is "not read yet", and it is drawn differently from "anonymous" on
   * purpose: those are the same picture to a user and completely different
   * facts, and collapsing them is how a sign-in probe that stopped running gets
   * read as a sign-in that did not take. The `reason` rides in the tooltip
   * because it is a sentence, and the bar is 44 px tall.
   */
  $('account').textContent = s.account ? (s.account.signedIn ? 'signed in' : 'anonymous') : 'checking…';
  $('account').title = s.account ? s.account.reason : 'reading the source partition’s cookie jar';
  paintArm(s.armed === true);
  paintAutoUpdate(s.autoUpdate === undefined ? null : s.autoUpdate);
  const last = s.refusals && s.refusals.length ? s.refusals[s.refusals.length - 1] : null;
  lastPushed = last ? `refused: ${short(last.url)} — ${last.why}` : '';
  // A PUSH WINS ONLY WHEN IT BRINGS A REFUSAL THIS BAR HAS NOT DRAWN. See the
  // header: otherwise an unrelated status push erases an answer the user caused.
  const n = Number.isFinite(s.refusalCount) ? s.refusalCount : (last ? drawnRefusals + 1 : drawnRefusals);
  if (n > drawnRefusals) { drawnRefusals = n; localAnswer = ''; }
  paintRefusal();
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
      localAnswer = r && r.ok === false ? `${r.message || 'the arm gesture was refused'}` : '';
      paintRefusal();
    } catch (err) {
      localAnswer = `arm failed: ${(err && err.message) || err}`;
      paintRefusal();
    } finally {
      b.disabled = false;
    }
  });

  /**
   * THE SOURCE PICKER. It opens the operating system's own chooser, through the
   * one intake `src/main/main.js` builds over electron's own `dialog` — there is
   * no second picker and nothing here is stubbed anywhere.
   *
   * WHAT COMES BACK IS A TITLE AND A MIME, NEVER A PATH AND NEVER A TOKEN. See
   * `render()`.
   */
  $('source-file').addEventListener('click', async () => {
    try {
      paintAnswer('source-file', await window.__wbChrome.chooseFile(), 'the file was not taken');
    } catch (err) {
      paintAnswer('source-file', { ok: false, message: `choosing a file failed: ${(err && err.message) || err}` });
    }
  });

  /**
   * THE EXPORT GESTURE. `main` settles the destination — asked once, ever — and
   * then asks for the write. In this build the write refuses, by name, because
   * the separation runner is upstream; that refusal is DRAWN rather than
   * swallowed, which is the whole of this file's argument.
   *
   * NO `disabled` WHILE IT IS IN FLIGHT — see the header. A second press joins
   * the first ask rather than stacking a second native modal, and the rule that
   * makes that true lives beside the picker, in `src/main/files.js`.
   */
  $('export').addEventListener('click', async () => {
    try {
      paintAnswer('export', await window.__wbChrome.exportStems(), 'the export was refused');
    } catch (err) {
      paintAnswer('export', { ok: false, message: `export failed: ${(err && err.message) || err}` });
    }
  });

  /**
   * THE AUTO-UPDATE GESTURE. `change`, not `click`, so the keyboard reaches it.
   *
   * THE ANSWER IS PAINTED, INCLUDING THE ONE THAT DISAGREES WITH THE CLICK.
   * `main` ANDs the stored preference with the command line, so under `--gate`
   * a user who ticks the box gets `autoUpdate: false` back — the preference is
   * recorded and the check still does not run. Painting the click instead of the
   * answer would show a tick over an app that is not checking, which is the
   * dead-control failure this file's header is about.
   */
  $('autoupdate').addEventListener('change', async () => {
    const el = $('autoupdate');
    const want = el.checked;
    el.disabled = true;
    try {
      const r = await window.__wbChrome.setAutoUpdate(want);
      paintAutoUpdate(r && r.ok ? r.autoUpdate : null);
      if (r && r.ok === false) { localAnswer = r.message || 'the auto-update toggle was refused'; paintRefusal(); }
    } catch (err) {
      paintAutoUpdate(null);
      localAnswer = `auto-update failed: ${(err && err.message) || err}`;
      paintRefusal();
    } finally {
      el.disabled = false;
    }
  });
} else {
  // A missing bridge is a wiring failure, and it is worth being loud about
  // rather than rendering an empty bar that looks like "no source yet".
  $('refusal').textContent = 'no host bridge — preload/chrome.cjs did not run';
  for (const id of ['arm', 'source-file', 'export']) $(id).disabled = true;
  $('autoupdate').disabled = true;
}
