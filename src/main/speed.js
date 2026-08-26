/**
 * THE PAGE'S PLAYBACK RATE — the decision half, and it is NOT A PORT.
 *
 * This module does not reimplement `extension/speed.js`. It EXECUTES the
 * vendored file, in a `node:vm` context, and re-exports what that file declares.
 * `SPEED_MIN`, `SPEED_MAX`, `SPEED_EPS`, `SPEED_KEY_LOCK`, `AD_SHOWING_SEL`,
 * `resolveSpeed` and `speedPlan` below are the unit repository's own, byte for
 * byte, gated by `vendor/upstream.sha256`.
 *
 * ---------------------------------------------------------------------------
 * WHY, AND IT IS THE WHOLE REASON THIS FILE IS SHAPED LIKE THIS
 * ---------------------------------------------------------------------------
 * `extension/ui/embed-state.js` — a UNIT file, which we vendor and must not
 * touch — reads `../speed.js` AS TEXT and pins the deck's 29-rung speed ladder
 * against that file's clamp. `extension/unit.json`'s `hostReads` declares the
 * read and says what it is for:
 *
 *   "the ladder decides what the user can ASK for, speed.js's clamp decides what
 *    the element can BE GIVEN, and a disagreement is a button that visibly moves
 *    the readout to a rate the page refuses."
 *
 * A second Host that writes its own `SPEED_MIN = 0.5` has not copied a constant;
 * it has made that pin a LIE. The deck would go on checking its ladder against a
 * file that is no longer the clamp in force, would go on passing, and the two
 * numbers would be free to part company in exactly the silence the pin exists to
 * prevent.
 *
 * So: ONE FILE, ONE CLAMP, TWO READERS. `ui/embed-state.js` reads it as text;
 * this Host executes it. They resolve to the same absolute path, and
 * `tools/suites/transport.mjs` asserts that they do — an assertion which is red
 * the moment somebody re-types a range into this repository.
 *
 * `speed.js` is classified `host` in `unit.json`, so it travels by accident
 * rather than by right: the copy list carries it because `embed-state.js` and
 * `qa/speed-pitch.mjs` read it, not because a Host is owed it. That is stated
 * because it is the thing that could go away under a future tag, and if it does,
 * the pin goes with it. See `docs/HOST-DESIGN.md` §11 finding F3.
 *
 * ---------------------------------------------------------------------------
 * WHY `vm` AND NOT `import`
 * ---------------------------------------------------------------------------
 * `speed.js` is a CLASSIC SCRIPT. Its declarations are `var` at top level, which
 * is how a content script publishes them into the isolated world `content.js`
 * shares with it. Under Node ESM those same `var`s are module-scoped and the
 * file exports nothing at all, so `import` gets an empty namespace. A `vm`
 * context reproduces the extension's arrangement exactly — classic-script
 * semantics, `var`s landing on the context's global — which is why this is a
 * faithful execution rather than a trick.
 *
 * The file's own self-check does not run: `demo()` is guarded on
 * `typeof process !== 'undefined'`, and a bare `vm.createContext({})` has no
 * `process`. Verified, because a `demo()` that DID run would call
 * `process.exitCode` in our main process.
 *
 * IT THROWS AT IMPORT IF THE FILE IS NOT THERE, and that is the design. A Host
 * that cannot find the unit's clamp must not invent one; `shared/host.js`'s
 * posture on every optional-looking absence is the same — the loudest error, not
 * the quietest fallback.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * THE ONE PATH. `ui/embed-state.js` resolves `new URL('../speed.js',
 * import.meta.url)` from `vendor/stem-splitter-live/extension/ui/`, which is
 * this same file. The suite asserts the two resolve identically rather than
 * trusting this comment.
 */
export const SPEED_JS = path.resolve(HERE, '..', '..', 'vendor', 'stem-splitter-live', 'extension', 'speed.js');

function loadVendoredSpeed() {
  let src;
  try {
    src = fs.readFileSync(SPEED_JS, 'utf8');
  } catch (err) {
    throw new Error(`the vendored speed.js is not readable at ${SPEED_JS} (${(err && err.message) || err}). `
      + 'This Host executes the unit repository\'s clamp rather than declaring one of its own, because '
      + 'ui/embed-state.js pins the deck\'s speed ladder against that exact file. Re-vendor '
      + '(`bash tools/vendor-unit.sh`) rather than typing a range in here — a second clamp makes that pin a lie.');
  }
  const ctx = vm.createContext({});
  vm.runInContext(src, ctx, { filename: SPEED_JS });
  const owed = ['SPEED_MIN', 'SPEED_MAX', 'SPEED_EPS', 'SPEED_KEY_LOCK', 'AD_SHOWING_SEL', 'resolveSpeed', 'speedPlan'];
  const absent = owed.filter((k) => ctx[k] === undefined);
  if (absent.length) {
    throw new Error(`${SPEED_JS} ran but declared none of: ${absent.join(', ')}. `
      + 'It is a classic script and these are its top-level `var`s; if the file has been rewritten as a module '
      + 'they are no longer reachable and this Host has no clamp.');
  }
  return ctx;
}

/** The vendored file's own globals. Nothing below is re-typed. */
export const SPEED = loadVendoredSpeed();

export const { SPEED_MIN, SPEED_MAX, SPEED_EPS, SPEED_KEY_LOCK, AD_SHOWING_SEL, resolveSpeed, speedPlan } = SPEED;

/**
 * THE USER'S SPEED CLAIM, over one source view. This is `content.js`'s speed
 * section with the DOM taken out of it: `userRate`, the find window, the poll,
 * and the ONE caller of `speedPlan`.
 *
 * WHY IT IS HERE AND NOT IN THE PRELOAD. The preload is a sandboxed CommonJS
 * script that cannot `require` a relative file, so it cannot reach `speed.js`
 * at all — anything it decided would be decided against a constant re-typed into
 * it, which is the failure the header above is about. The preload therefore
 * OBSERVES and APPLIES; every decision is made here, against the vendored file.
 *
 * The cost, named: each media event is a round trip (preload -> main -> preload)
 * where `content.js` was synchronous. That is sub-millisecond on an Electron ipc
 * hop and the cadence is media events plus 4 Hz, so it does not compete with
 * anything. What it buys is that there is exactly one clamp on this machine.
 *
 * @param {object} o
 * @param {(cmd: object) => void} o.drive     send a `{c:'drive'|'relook'}` to the preload
 * @param {(payload: object) => void} o.report  the deck's `onSpeedReport` payload
 * @param {() => object} o.look               the last state the preload pushed
 */
export function createSpeedClaim({ drive, report, look }) {
  /**
   * The same 6 s `content.js` uses, and for the same reason: a player built
   * asynchronously makes "not there" and "not there YET" the same read. Inside
   * the window the state is `looking`; outside it, `missing`.
   */
  const FIND_MS = 6000;
  const POLL_MS = 400;

  /** The rate the user asked for, for THIS element. `null` = we hold no claim. */
  let userRate = null;
  /** Whether `resolveSpeed` had to pull the request into range, for the report. */
  let clampWhy = null;
  /** What the deck last asked for, verbatim, so a refusal can quote it back. */
  let lastRequested = null;
  /** `adShowing` as of the last look — the ad-END edge is an input, not an event. */
  let lastAd = false;
  let deadline = 0;
  let timer = 0;
  /** The last report, so a deck that mounts later can be told what it missed. */
  let last = null;
  let sent = '';

  const stats = { plans: 0, writes: 0, yields: 0, refusals: 0, clamps: 0, reports: 0 };

  function emit(payload) {
    last = payload;
    stats.reports++;
    const k = JSON.stringify(payload);
    if (k === sent) return;
    sent = k;
    report(payload);
  }

  /**
   * THE ONE CALLER OF `speedPlan`, exactly as `applySpeed` is in `content.js`.
   * In `speed.js` the REASON is the decision — no inspection of the value can
   * tell "YouTube reset it" from "the user picked Normal" — so every entry point
   * funnels through here carrying the reason it woke us.
   *
   * @param {'set'|'ad-end'|'remount'|'ratechange'|'poll'} reason
   * @param {string|null} [refused] a request that could not be read, riding out
   *   on this report. One-shot by construction: a parameter, never state.
   * @returns {boolean} settled — nothing further to do, so the poll may stop.
   */
  function apply(reason, refused) {
    const s = look() || {};
    /**
     * THE AD-END EDGE, PROMOTED HERE AND NOWHERE ELSE. `ad-showing` is a class,
     * not an event, so the transition true -> false has to be noticed by
     * whoever looks next. A user press never becomes an ad-end: 'set' during an
     * ad is refused by the plan, and re-labelling it would apply the rate to
     * the advert.
     */
    const ad = s.adShowing;
    const r = (reason !== 'set' && lastAd === true && ad === false) ? 'ad-end' : reason;
    if (typeof ad === 'boolean') lastAd = ad;

    const plan = speedPlan({
      want: userRate,
      current: typeof s.playbackRate === 'number' ? s.playbackRate : null,
      hasMedia: s.hasMedia === true,
      // PASSED THROUGH UNTOUCHED, INCLUDING WHEN IT IS NOT A BOOLEAN. The
      // preload sends `null` until it has been told which selector names an ad,
      // and `speedPlan` answers `unknown` to that rather than assuming there is
      // no ad — which is the branch that would apply a user's 1.4x to an advert.
      adShowing: ad,
      finding: Date.now() <= deadline,
      reason: r,
    });
    stats.plans++;

    // YIELD: somebody else owns this rate now. Adopt it — the deck paints the
    // element, so agreeing with the element is what keeps the readout honest.
    userRate = plan.want;
    if (plan.act === 'yield') { clampWhy = null; lastRequested = null; stats.yields++; }
    if (plan.act === 'write') { stats.writes++; drive({ c: 'drive', playbackRate: plan.rate }); }

    const applied = typeof s.playbackRate === 'number' && s.playbackRate > 0 ? s.playbackRate : null;
    emit({
      state: plan.state,
      // `ok` is "the user's speed is on the element RIGHT NOW", and it is false
      // whenever we could not look. Never derived from what we sent.
      ok: plan.state === 'ok' && applied !== null
        && (userRate === null || Math.abs(applied - userRate) <= SPEED_EPS),
      want: userRate,
      applied,
      requested: lastRequested,
      why: plan.why,
      clamped: clampWhy,
      refused: refused || null,
    });

    // 'ok' and 'ad' are live facts the media events keep refreshing, so the poll
    // has nothing to add. 'looking' is a wait; 'missing' and 'unknown' are facts
    // only once the find window has closed on them.
    return plan.state === 'ok' || plan.state === 'ad' || Date.now() > deadline;
  }

  function poll() {
    if (timer) return;
    timer = setInterval(() => {
      // A LATE ELEMENT IS WHY THIS POLL EXISTS. Ask the preload to look again;
      // its own tick does the same, and both are idempotent.
      drive({ c: 'relook' });
      if (apply('poll')) { clearInterval(timer); timer = 0; }
    }, POLL_MS);
    if (typeof timer.unref === 'function') timer.unref();
  }

  /** A fresh 6 s before "not there yet" is allowed to become "not there". */
  function openWindow(reason) {
    deadline = Date.now() + FIND_MS;
    if (!apply(reason)) poll();
  }

  return {
    stats,
    /** ENTRY POINT: the deck's `requestSpeed`, and the only way `userRate` is set. */
    request(raw) {
      lastRequested = raw === undefined ? null : raw;
      const res = resolveSpeed(raw);
      if (!res.ok) {
        /**
         * REFUSED, AND SAID OUT LOUD. Not coerced to 1 and not swallowed: a rate
         * this Host cannot read means the sender is broken, and substituting a
         * plausible number produces a video playing at a speed nobody asked for
         * with nothing on screen to say the message was rejected.
         */
        stats.refusals++;
        console.warn(`[transport] SPEED refused: ${JSON.stringify(raw)} is not a playback rate; `
          + `staying at ${userRate === null ? "the page's own speed" : userRate}.`);
        apply('poll', res.why);
        return;
      }
      userRate = res.rate;
      clampWhy = res.why === 'release' ? null : res.why;
      if (clampWhy) stats.clamps++;
      openWindow('set');
    },
    /** A media event moved something. `reason` is which one — see `speedPlan`. */
    apply,
    /** A fresh source settled, or the deck went up: look again from zero. */
    openWindow,
    /**
     * THE ELEMENT WAS REPLACED. The claim goes with it: a speed that survived a
     * video change would silently play a video the user has not heard yet at
     * somebody else's tempo. `content.js` gets this for free because
     * `restoreVideo()` drops `userRate` with the rate; we do it explicitly
     * because the two halves are in two processes.
     */
    dropClaim() { userRate = null; clampWhy = null; lastRequested = null; lastAd = false; },
    /** The deck mounted and has never been told anything. Undeduped on purpose. */
    resend() { if (last) report(last); },
    stop() { if (timer) { clearInterval(timer); timer = 0; } last = null; sent = ''; },
    peek: () => last,
  };
}
