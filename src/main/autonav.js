/**
 * SHOULD THE SOURCE PAGE AUTOPLAY THE NEXT VIDEO, and what has to happen to its
 * own toggle for the answer to be the one the user asked for?
 *
 * ---------------------------------------------------------------------------
 * THIS ONE IS A PORT, AND `src/main/speed.js` IS NOT. THE DIFFERENCE IS A FACT
 * ABOUT THE VENDORED COPY, NOT A TASTE.
 * ---------------------------------------------------------------------------
 * `extension/autonav.js` IS NOT ON THIS TREE. `tools/vendor-unit.sh` §3 derives
 * the copy list from `extension/unit.json` — the unit's files, the holes, the
 * `hostReads`, and everything the declared suites and runners read — and nothing
 * in any of those lists reads `autonav.js`. It is classified `host` there, with
 * no reader, so it does not travel. `speed.js` is classified `host` too and
 * travels only because `ui/embed-state.js` and `qa/speed-pitch.mjs` read it.
 *
 * So there is nothing here to execute and nothing to diff against. This file is
 * a PORT of a Host-side decision — which is what `unit.json` says `autonav.js`
 * is — and porting it is not a fork: a fork is an edited copy of a UNIT file,
 * and this is the extension's Host doing its own job in its own repository
 * while we do ours in ours.
 *
 * WHAT THAT COSTS, SAID PLAINLY RATHER THAN LEFT TO BE DISCOVERED: the two
 * copies of `autonavPlan` can drift, and nothing on either machine would go red.
 * The state vocabulary below is load-bearing in the OTHER direction too — the
 * deck's banner keys off the literals `missing`, `stuck` and `lost` — so a drift
 * here shows up as a banner that never lights. `docs/HOST-DESIGN.md` §11 carries
 * it as a finding, and the upgrade path is one line in the OTHER repository:
 * give `autonav.js` a reader `unit.json`'s derivation can see, behind a new tag,
 * and this file becomes a `speed.js`-shaped execution instead.
 *
 * WHAT IS PINNED, because one thing can be: `PREFS_KEY`. The vendored
 * `shared/config.js` exports it, the deck writes the prefs object under it
 * through `storageSet('local', PREFS_KEY, …)`, and a Host reading a different
 * key is autoplay suppression that silently never applies — the exact failure
 * `extension/autonav.js`'s own self-check exists to catch. The suite pins the
 * literal below against that export.
 *
 * ---------------------------------------------------------------------------
 * L1. Nothing here touches media. It decides whether to press a button the user
 * can press. `restoreVideo`'s argument applies one control over: the value we
 * overwrite is an account-level preference, so it is recorded and put back.
 */

/**
 * The page's own autoplay-next control. Ported from `extension/autonav.js` at
 * v0.2.0, including the measurement in its header: the class did not move but
 * the ELEMENT under it did — it is a `<div>` inside the button now, not the
 * button — so the selector matches on the ARIA contract,
 * `[class*="autonav-toggle"][aria-checked]`, scoped to the player controls.
 * `aria-checked` outlives the markup because a11y tooling depends on it and the
 * site's own CSS does not.
 */
export const AUTONAV_TOGGLE_SEL = '.ytp-right-controls [class*="autonav-toggle"][aria-checked],'
  + ' [class*="ytp-autonav-toggle"][aria-checked]';

/**
 * The late fallback, and only a fallback: once the end screen is up, this is the
 * button that cancels the countdown the site has already started. It exists for
 * exactly the window in which the toggle route has already failed, so reaching
 * for it is not evidence that anything is well.
 */
export const AUTONAV_CANCEL_SEL = '.ytp-autonav-endscreen-upnext-cancel-button';

/**
 * The storage key holding this build's user preferences. A SECOND COPY of
 * `shared/config.js`'s export — pinned against it by the suite, because the
 * failure it guards is mute: the deck writes `prefs`, this Host reads something
 * else, suppression never applies, and nothing anywhere goes red.
 */
export const PREFS_KEY = 'prefs';

/**
 * THE SETTING, resolved. Absent means SUPPRESS: a fresh profile with no stored
 * preference and a profile that explicitly chose suppression must resolve
 * identically. Only the literal `true` hands autoplay back — a truthy-but-not-
 * true value means the record is not one we wrote, and the safe reading of a
 * record we do not recognise is the default rather than its opposite.
 *
 * THE POLARITY IS THE TRAP AND IT IS WRITTEN DOWN HERE ONCE. The stored field is
 * `autoplayNext` — "let it autoplay". What every consumer wants is `suppress` —
 * "stop it autoplaying". They are opposites, they are both booleans, and an
 * inversion produces a feature that works perfectly in reverse with nothing to
 * see. So this is the ONE place the flip happens, and `createAutonav` takes the
 * already-resolved `suppress` everywhere below.
 *
 * @param {{autoplayNext?: boolean}|null|undefined} prefs
 * @returns {boolean} true = suppress the page's autoplay-next
 */
export function resolveSuppress(prefs) {
  return !(prefs && prefs.autoplayNext === true);
}

/**
 * THE ONE DECISION. Called from exactly one place — `sync()` below — and every
 * assertion about it names that entry point.
 *
 * @param {object} s
 * @param {boolean} s.suppress  resolved setting: true = suppress autoplay-next
 * @param {boolean} s.engaged   is the deck up on a page we have an opinion about
 * @param {boolean} s.found     was the toggle located in the page
 * @param {boolean|null} s.checked  its `aria-checked`, or null if unreadable
 * @param {boolean|null} s.original the value recorded BEFORE we first touched it
 * @returns {{act:'idle'|'hold'|'click'|'missing'|'lost',
 *            want:boolean|null, remember:boolean, forget:boolean, state:string}}
 */
export function autonavPlan(s) {
  const st = s || {};
  const engaged = st.engaged === true;
  const suppress = st.suppress === true;
  const found = st.found === true;
  const checked = typeof st.checked === 'boolean' ? st.checked : null;
  const original = typeof st.original === 'boolean' ? st.original : null;

  // IMPOSING vs RESTORING, and they are not the same job. Imposing wants one
  // specific value. Restoring wants the value we found, and only exists at all
  // once we have taken one.
  const imposing = engaged && suppress;
  const want = imposing ? false : original;
  const restoring = !imposing && original !== null;

  if (want === null) {
    return { act: 'idle', want: null, remember: false, forget: false, state: 'idle' };
  }

  /**
   * WE HAVE AN OPINION AND CANNOT ACT ON IT. Both branches are failures and both
   * are reported — the shape this deliberately is NOT is `!el || (real check)`,
   * which returns "fine" precisely when there is nothing to look at.
   *
   * `found && checked === null` lands here too, on purpose: an element whose
   * state we cannot read is not a control we may click. Clicking a toggle blind
   * is how you set it to the opposite of what was asked.
   */
  if (!found || checked === null) {
    return restoring
      ? { act: 'lost', want, remember: false, forget: false, state: 'lost' }
      : { act: 'missing', want, remember: false, forget: false, state: 'missing' };
  }

  if (checked === want) {
    // Restored, so the remembered value has done its job. Holding it would make
    // the NEXT video's control get a value read off a page two navigations ago.
    return {
      act: 'hold', want, remember: false, forget: restoring,
      state: imposing ? 'off' : 'restored',
    };
  }

  return {
    act: 'click', want,
    // Record what we are about to overwrite, once, before the first click.
    remember: imposing && original === null,
    forget: false, state: 'pending',
  };
}

/**
 * THE STATE MACHINE — `content.js`'s autonav section with the DOM taken out.
 * The preload LOOKS and CLICKS; every decision about whether to, and what the
 * outcome is called, is made here.
 *
 * SURFACE THE STATE, INCLUDING — ESPECIALLY — THE ONE WHERE WE COULD NOT LOOK.
 * There is no `catch {}` and no silent early return below: an absent control, a
 * control we cannot read and a control that ignores us are all REPORTED with a
 * name, so the deck can paint the banner instead of the feature quietly doing
 * nothing.
 *
 * @param {object} o
 * @param {(cmd: object) => void} o.ask        send `{c:'autonav', act}` to the preload
 * @param {(payload: object) => void} o.report the deck's `page.onAutonav` payload
 */
export function createAutonav({ ask, report }) {
  /**
   * The same shape as the speed find window, for the same reason: the player
   * controls are built asynchronously and rebuilt on navigation, so "not there"
   * and "not there YET" are the same DOM read. Inside the window the state is
   * `looking`; when it expires it becomes `missing` and stays there.
   */
  const FIND_MS = 6000;
  const POLL_MS = 400;
  /**
   * A toggle whose `aria-checked` never follows our click is a toggle we do not
   * understand, and the honest response is to stop pressing it and say so.
   * Without this the poll would click it ~15 times before the window closed and
   * leave it on whichever value an odd or even count landed on.
   */
  const MAX_CLICKS = 3;

  let suppress = resolveSuppress(null);
  /**
   * THE RECORDING'S HOLD, LAYERED OVER THE USER'S PREFERENCE — S7a.
   *
   * `CONTEXT.md:311-314`: autoplay-next has to be SUSPENDED while a live export
   * runs, or the next video records into the same file. That is a suspension,
   * not a preference change: the user's own setting must be exactly what comes
   * back when the recording ends, including when it ends by being ABORTED.
   *
   * SO IT IS A SECOND BOOLEAN, NEVER A WRITE TO `suppress`. Driving the
   * recording through `setSuppress` would work perfectly right up to the moment
   * the user changes the setting mid-recording — and then "restore" would put
   * back the value we captured rather than the value they chose, silently, on
   * the one path nobody drives twice. `suppress` stays the user's answer for the
   * whole of the recording and `held` is ours; the effective value is the OR,
   * computed in one place below.
   *
   * IT IS NOT A SECOND STATE MACHINE. Everything downstream — the find window,
   * the click budget, `missing`/`stuck`/`lost` — is the machine that was already
   * here, so a suspension that could not be applied reports itself in the
   * vocabulary the deck's banner already knows.
   */
  let held = false;
  let engaged = false;
  /** The page's `aria-checked` as we found it, or null if we never clicked. */
  let original = null;
  let clicks = 0;
  let deadline = 0;
  let timer = 0;
  let state = null;
  let last = null;
  const stats = { plans: 0, clicks: 0, reports: 0, states: {} };

  function emit(next, detail) {
    last = { state: next, suppress: effective(), held, ...detail };
    stats.reports++;
    stats.states[next] = (stats.states[next] || 0) + 1;
    if (next === state) return;
    state = next;
    report(last);
    if (next === 'missing') {
      console.warn("[transport] the page's autoplay-next toggle was not found, "
        + 'so the next video may still play automatically. Its markup has probably changed.');
    } else if (next === 'lost') {
      console.warn("[transport] the page's autoplay-next toggle disappeared before it could be put back to "
        + `${original ? 'on' : 'off'}; it will be restored on the next page that has one.`);
    } else if (next === 'stuck') {
      console.warn("[transport] the page's autoplay-next toggle did not respond to being clicked.");
    }
  }

  /**
   * Reconcile the page with the setting, over ONE observation the preload made.
   *
   * @param {{found: boolean, checked: boolean|null, afterClick?: boolean}} obs
   * @returns {boolean} settled — nothing further to do, so the poll may stop.
   */
  /**
   * THE EFFECTIVE SETTING, IN ONE PLACE. The user's answer OR the recording's
   * hold. Two readers — `sync()` and `suppressing()` — and a second formula
   * would be suppression that applies to the page and not to the preload's
   * `ended` handler, or the reverse.
   */
  const effective = () => suppress || held;

  function sync(obs) {
    const o = obs || { found: false, checked: null };
    const plan = autonavPlan({ suppress: effective(), engaged, found: o.found, checked: o.checked, original });
    stats.plans++;

    if (plan.act === 'click') {
      /**
       * ONE CLICK PER PASS. `afterClick` is the preload's re-read, and it must
       * never press anything: a toggle pressed twice in one pass is a toggle
       * back where it started.
       */
      if (o.afterClick) { emit('pending', { checked: o.checked, want: plan.want }); return false; }
      if (clicks >= MAX_CLICKS) { emit('stuck', { checked: o.checked }); return true; }
      if (plan.remember) original = o.checked;
      clicks++;
      stats.clicks++;
      // The page's own handler, reached the way the user reaches it. The preload
      // re-reads in the same tick and answers with `afterClick: true`.
      ask({ c: 'autonav', act: 'click' });
      return false;
    }

    if (plan.forget) { original = null; clicks = 0; }

    if (plan.act === 'missing' || plan.act === 'lost') {
      // Inside the find window this is a WAIT. Outside it, it is a FACT.
      emit(Date.now() <= deadline ? 'looking' : plan.state, { checked: o.checked });
      return Date.now() > deadline;
    }

    emit(plan.state, { checked: o.checked });
    return true;
  }

  function poll() {
    if (timer) return;
    timer = setInterval(() => ask({ c: 'autonav', act: 'look' }), POLL_MS);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  function stopPoll() { if (timer) { clearInterval(timer); timer = 0; } }

  const api = {
    stats,
    AUTONAV_TOGGLE_SEL,
    AUTONAV_CANCEL_SEL,
    PREFS_KEY,
    /** Is suppression in force right now — the flag the preload's `ended` handler needs. */
    suppressing: () => engaged && effective(),
    /** ENTRY POINT: one observation from the preload. */
    observe(obs) { if (sync(obs)) stopPoll(); else poll(); },
    /**
     * The deck went up or came down, the page navigated, or the preference
     * changed. Opens a fresh find window either way: the control we are looking
     * for now is not the element we were looking at before, and a deadline
     * inherited from the last video would expire mid-search.
     */
    /**
     * @param {boolean} [on]  engage or disengage; omitted leaves it as it was
     * @param {{look?: boolean}} [o]  `look: false` engages WITHOUT opening a
     *   find window. It is for a document with NO PLAYER ON IT: there is nothing
     *   to autoplay to next, so hunting for the toggle can only end in
     *   `missing`, which the deck paints as a failure advisory. youtube.com's
     *   home page is the default source URL, so that advisory was the first
     *   thing every cold start put in front of the user. The window opens by
     *   itself on the events that mean a player is really there — `play`,
     *   `loadedmetadata` and an element change — so nothing is lost on a watch
     *   page, and `transport`'s fixture (which HAS a player) is unaffected.
     */
    reassert(on, { look = true } = {}) {
      if (typeof on === 'boolean') engaged = on;
      clicks = 0;
      if (!look) return;
      deadline = Date.now() + FIND_MS;
      ask({ c: 'autonav', act: 'look' });
      poll();
    },
    /**
     * THE RESOLVED PREFERENCE, which is what `DeckHost` hands us. `true` means
     * SUPPRESS — see `resolveSuppress` for why the flip lives in one place.
     *
     * Applies NOW, not on the next video: turning suppression off mid-track puts
     * the page's toggle back immediately, and `autonavPlan` covers both
     * directions.
     *
     * @returns {boolean} did the setting actually move
     */
    setSuppress(next) {
      const want = next === true;
      if (want === suppress) return false;
      suppress = want;
      // REASSERT EVEN WHILE HELD. The effective value has not moved, so nothing
      // will be clicked — but `emit` republishes it, and the deck's checkbox
      // going dead for the length of a recording is the same class of defect as
      // a control that produces no visible outcome.
      api.reassert();
      return true;
    },
    /**
     * SUSPEND AUTOPLAY-NEXT FOR THE LENGTH OF A LIVE EXPORT, and put the user's
     * own setting back afterwards — `src/main/drive.js`'s `createPass({hold})`.
     *
     * IT DRIVES THE PAGE, IT DOES NOT ONLY RECORD A PREFERENCE. `reassert()` is
     * what hunts for the page's own toggle and clicks it, and issue #7 names the
     * failure this exists to avoid in as many words: *"A Host that writes the
     * preference and never drives the view passes a weaker assertion and ships
     * the bug."*
     *
     * @param {boolean} on
     * @returns {boolean} did the effective setting actually move
     */
    holdSuppress(on) {
      const want = on === true;
      if (want === held) return false;
      const was = effective();
      held = want;
      api.reassert();
      return effective() !== was;
    },
    /** Is a recording holding it right now — separate from the user's answer. */
    heldNow: () => held,
    /** The same thing from the raw stored record, so `resolveSuppress` has one caller shape. */
    setPrefs(prefs) { return api.setSuppress(resolveSuppress(prefs)); },
    suppressed: () => suppress,
    engagedNow: () => engaged,
    /** The deck mounted and has never been told anything. Undeduped on purpose. */
    resend() { if (last) report(last); },
    stop() { stopPoll(); state = null; last = null; held = false; },
    peek: () => last,
  };
  return api;
}
