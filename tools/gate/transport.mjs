/**
 * The transport gate's eyes inside a real launch.
 *
 *   electron . --gate=DIR --gate-probe=transport --source-url=<the local fixture>
 *
 * `src/main/main.js` imports this only when `--gate` is present, hands it the
 * live handles, and exits with what `runGate` returns. `tools/suites/
 * transport.mjs` spawns that launch and asserts over `DIR/report.json`.
 *
 * ---------------------------------------------------------------------------
 * IT NEVER ASSERTS. A probe that decided its own verdict would be a suite that
 * exits 0 having asserted nothing — the VOID case, one level in. Everything
 * below RECORDS: what the transport emitted, in order, and what the page looked
 * like at each step. The judgement is in the suite, which is a separate process
 * and can be run against a report from a mutated build.
 *
 * IT ADDS NO CAPABILITY. It subscribes to the five report channels
 * `src/main/deck-host.js` will subscribe to, and it calls the same eight
 * entry points that file will call — `drive`, `release`, `requestSpeed`,
 * `claimKeys`, `resend`, `setPrefs`, `setAutonav`, `attach`. Nothing here
 * reaches around the transport to touch the preload directly, because a gate
 * that used a private door would be gating a door nothing else opens.
 *
 * ---------------------------------------------------------------------------
 * WHY IT DRIVES THE PAGE WITH `executeJavaScript` AND NOT WITH FIXTURE HOOKS
 * ---------------------------------------------------------------------------
 * Four of the states under test are things the page does TO us — its own speed
 * menu writing `playbackRate`, a key arriving at the document, a toggle that
 * ignores its click, a media URL somebody tried to smuggle in. Each is two or
 * three lines of DOM in the page's own world, and putting them in
 * `tools/fixture/player.html` would grow a file three suites share for the sake
 * of one. `executeJavaScript` runs in that world and is where they belong.
 *
 * The fixture keeps the hooks that are PAGE STATE — `spaNavigate`, `ad`,
 * `autonavPresent`, `pageKeys` — because those have to survive the element being
 * replaced, and a snapshot function is the honest place for that.
 */
import fs from 'node:fs';
import path from 'node:path';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** `executeJavaScript` with the throw kept as data, so one bad step is one bad row. */
async function evalIn(wc, code) {
  try { return await wc.executeJavaScript(code, false); }
  catch (err) { return { THREW: String((err && err.message) || err) }; }
}

/**
 * Everything the transport emitted, in arrival order. `seq` is a single counter
 * across all five channels, so "the speed report that followed that jump" is a
 * comparison of two integers rather than of two clocks — `AGENTS.md`: if a count
 * can carry the claim, do not carry it with a stopwatch.
 */
const log = {
  seq: 0,
  states: [], jumps: [], speeds: [], keys: [], autonavs: [],
  marks: [],
  /** true once the tap actually got hold of the transport. */
  subscribed: false,
  subscribeMs: null,
  how: null,
};

/**
 * THE TAP — the five channels `src/main/deck-host.js` subscribes to, and the
 * only way anything in this file learns what the transport did.
 *
 * IT IS INSTALLED AT THE TOP OF `runGate` AND THE VIEW IS THEN RELOADED, rather
 * than being installed before the first load. `main.js` imports a probe AFTER
 * `boot()` has finished, so by the time this file exists the source view has a
 * document and its preload has already said `hello`. Reloading replays the whole
 * document boot — preload up, `hello`, config down, the first state push, the
 * first autonav impose — with the tap already listening, which is the sequence
 * that matters and the one a probe attached late would have to assert around its
 * own blind spot.
 *
 * `main.js` also supports an optional `beforeLoad(state)` hook, and this file
 * implements it, so if that hook is ever wired again the tap simply goes on
 * earlier and the reload below becomes a second observation rather than the
 * first. `tap.how` records which of the two actually happened, because a report
 * that does not say when it started looking is a report with a blind spot it
 * cannot name.
 */
/** The five unsubscribes, kept so the gate can hand them back and be seen to. */
const released = [];

function subscribe(state, how) {
  if (log.subscribed || !state.transport) return false;
  const t = state.transport;
  log.subscribed = true;
  log.how = how;
  released.push(t.onState((s) => log.states.push({ seq: log.seq++, ...s })));
  released.push(t.onJump(() => log.jumps.push({ seq: log.seq++ })));
  released.push(t.onSpeedReport((s) => log.speeds.push({ seq: log.seq++, ...s })));
  released.push(t.onKey((k) => log.keys.push({ seq: log.seq++, ...k })));
  released.push(t.onAutonav((a) => log.autonavs.push({ seq: log.seq++, ...a })));
  return true;
}

export function beforeLoad(state) {
  const t0 = Date.now();
  const attach = () => {
    if (!state.transport) { setTimeout(attach, 1); return; }
    log.subscribeMs = Date.now() - t0;
    subscribe(state, 'beforeLoad');
  };
  attach();
}

/** Where every counter stood when a phase began. Slicing, not timing. */
function mark(name, extra = {}) {
  const m = {
    name, seq: log.seq,
    states: log.states.length, jumps: log.jumps.length, speeds: log.speeds.length,
    keys: log.keys.length, autonavs: log.autonavs.length, ...extra,
  };
  log.marks.push(m);
  return m;
}

const since = (m) => ({
  states: log.states.slice(m.states), jumps: log.jumps.slice(m.jumps),
  speeds: log.speeds.slice(m.speeds), keys: log.keys.slice(m.keys),
  autonavs: log.autonavs.slice(m.autonavs),
});

/** Wait for `fn()` to be truthy, or give up and say so. Never throws. */
async function until(fn, ms = 4000, step = 50) {
  const deadline = Date.now() + ms;
  for (;;) {
    let got = null;
    try { got = fn(); } catch { got = null; }
    if (got) return { ok: true, waitedMs: ms - (deadline - Date.now()), got };
    if (Date.now() > deadline) return { ok: false, waitedMs: ms, got: null };
    await wait(step);
  }
}

export async function runGate({ state, outDir, sourceUrl, appRoot }) {
  fs.mkdirSync(outDir, { recursive: true });
  const wc = state.source.webContents;
  const t = state.transport;
  const R = {
    gate: 1, probe: 'transport',
    when: new Date().toISOString(),
    versions: process.versions, platform: process.platform, sourceUrl,
  };
  const page = () => evalIn(wc, 'window.__wbFixture ? window.__wbFixture() : null');
  /** The current element, in the page's own world. Never held across a navigation. */
  const V = "document.querySelector('#movie_player video')";

  // =====================================================================
  // 0. THE TAP, AND THEN THE DOCUMENT FROM THE TOP
  // =====================================================================
  /**
   * WHO WAS ALREADY LISTENING, recorded BEFORE the tap goes on. `main.js`
   * injects this transport into `installDeckHost`, so a non-zero count here is
   * the evidence that the deck host really subscribed — and it is what lets the
   * count at the end be decomposed instead of guessed at.
   */
  R.listenersBeforeTap = t.listeners();
  subscribe(state, 'runGate');
  R.listenersAfterTap = t.listeners();
  R.tap = { subscribed: log.subscribed, how: log.how, subscribeMs: log.subscribeMs };

  /**
   * THE UNSUBSCRIBE CONTRACT, on a throwaway listener of its own so nothing that
   * matters is torn down to prove it. Every `on…(fn)` in this tree returns an
   * unsubscribe; one that returned `undefined` would leave a deck that closed
   * still receiving 4 Hz of state for the life of the process.
   */
  {
    const beforeExtra = t.listeners().onState;
    const drop = t.onState(() => {});
    const withExtra = t.listeners().onState;
    drop();
    R.unsubscribe = { before: beforeExtra, withExtra, after: t.listeners().onState };
  }
  // The reload is what puts the whole document boot inside the tap's window.
  // `main.js` re-arms the transport on `did-finish-load`, and the preload says
  // `hello` from the new document — so config, the first state and the first
  // autonav pass are all observed rather than inferred.
  const reloaded = await (async () => {
    const done = new Promise((r) => wc.once('did-finish-load', () => r(true)));
    wc.reload();
    return Promise.race([done, wait(8000).then(() => false)]);
  })();
  R.reload = { finished: reloaded };

  // =====================================================================
  // 1. THE ELEMENT IS FOUND, AND THE READ SET COMES BACK
  // =====================================================================
  const found = await until(() => log.states.some((s) => s.hasMedia === true), 6000);
  R.attach = {
    foundMedia: found.ok, waitedMs: found.waitedMs,
    firstState: log.states[0] || null,
    // `adShowing: null` is the honest answer before the config arrived — the
    // preload has no selector yet, and `speedPlan` answers `unknown` to that
    // rather than assuming there is no ad.
    adBeforeConfig: (log.states.find((s) => s.adShowing === null) || null),
    stateEvents: log.states.slice(0, 12).map((s) => s.event),
  };

  let m = mark('play');
  R.playResult = await evalIn(wc, 'window.__wbFixture.play()');
  await wait(900);
  const played = since(m);
  R.playing = {
    // PUSH, NEVER POLL. `timeupdate` is the page volunteering a fresh
    // currentTime ~4x a second; if the only events here are our own tick, the
    // media events are not wired.
    statesInWindow: played.states.length,
    events: [...new Set(played.states.map((s) => s.event))],
    mediaEvents: played.states.filter((s) => s.event !== 'tick').length,
    last: played.states[played.states.length - 1] || null,
    page: await page(),
  };

  // =====================================================================
  // 2. THE WRITE SET IS CLOSED — three layers, and the smuggle witness
  // =====================================================================
  m = mark('drive');
  /**
   * SET THE KEY LOCK THE WRONG WAY FIRST, or the assertion after this cannot
   * lose. `preservesPitch` defaults to `true` in Blink and `SPEED_KEY_LOCK` is
   * `true`, so an element nobody ever wrote reads exactly like an element the
   * Host wrote correctly — and deleting `driveRate`'s key-lock line turns
   * NOTHING red. Measured: mutation 3 of `transport-mutations.sh` was green
   * before this line existed. `AGENTS.md`: an estimator that saturates below the
   * claim is not an estimator.
   *
   * From the PAGE's world, so it is the same writer the site's own speed menu
   * would be, and so nothing of ours is asserting about its own bookkeeping.
   */
  R.pitchBefore = await evalIn(wc, `(() => { const v = ${V}; if (!v) return null; v.preservesPitch = false; return v.preservesPitch; })()`);
  t.drive({
    muted: true, playbackRate: 1.25, currentTime: 12,
    // NONE OF THESE MAY REACH THE ELEMENT. `src` is the one that would make this
    // a ripper; `volume` and `loop` are the ordinary shape of a widened write
    // set, which is how the first one gets in.
    src: 'https://example.invalid/videoplayback', volume: 0, loop: false, srcObject: null,
  });
  await wait(500);
  R.drive = {
    page: await page(),
    // Read off the ELEMENT in the page's own world, not off our bookkeeping.
    element: await evalIn(wc, `(() => { const v = ${V}; return v ? {
      muted: v.muted, rate: v.playbackRate, t: v.currentTime, preservesPitch: v.preservesPitch,
      srcScheme: String(v.src || '').split(':')[0], volume: v.volume, loop: v.loop,
      srcObject: v.srcObject === null ? 'null' : typeof v.srcObject } : null; })()`),
    jumps: since(m).jumps.length,
    selfSeeks: (since(m).states[since(m).states.length - 1] || {}).counts || null,
  };

  // =====================================================================
  // 3. THE JUMP RULE — the page's event, never the user's consent
  // =====================================================================
  m = mark('jump:self');
  t.drive({ currentTime: 30 });
  await wait(600);
  const selfSeek = since(m);
  R.jumpSelf = {
    jumps: selfSeek.jumps.length,
    // THE INSTRUMENT CHECK. "No jump" is also what a message that never arrived
    // looks like, so the seek has to be witnessed reaching the element.
    selfSeekCount: (selfSeek.states[selfSeek.states.length - 1] || {}).counts || null,
    elementTime: await evalIn(wc, `(() => { const v = ${V}; return v ? v.currentTime : null; })()`),
  };

  m = mark('jump:user');
  await evalIn(wc, 'window.__wbFixture.seek(45)');
  await wait(700);
  R.jumpUser = {
    jumps: since(m).jumps.length,
    seeking: since(m).states.filter((s) => s.seeking === true).length,
    elementTime: await evalIn(wc, `(() => { const v = ${V}; return v ? v.currentTime : null; })()`),
  };

  m = mark('jump:rate');
  t.drive({ playbackRate: 1.1 });
  await wait(600);
  R.jumpRate = { jumps: since(m).jumps.length, rate: (since(m).states.slice(-1)[0] || {}).playbackRate };

  // =====================================================================
  // 4. SPEED — the clamp, the refusal, the ad, and the entry-point rule
  // =====================================================================
  m = mark('speed:set');
  t.requestSpeed(1.5);
  await wait(600);
  R.speedSet = { report: since(m).speeds.slice(-1)[0] || null, element: await evalIn(wc, `(() => { const v = ${V}; return v ? { rate: v.playbackRate, pitch: v.preservesPitch } : null; })()`) };

  m = mark('speed:clamp');
  t.requestSpeed(3);
  await wait(600);
  R.speedClamp = { report: since(m).speeds.slice(-1)[0] || null, rate: await evalIn(wc, `(() => { const v = ${V}; return v ? v.playbackRate : null; })()`) };

  m = mark('speed:refuse');
  t.requestSpeed('1.5');
  await wait(600);
  R.speedRefuse = {
    reports: since(m).speeds,
    rate: await evalIn(wc, `(() => { const v = ${V}; return v ? v.playbackRate : null; })()`),
  };

  /**
   * THE YIELD, AND ITS NEGATIVE CONTROL. The page's own speed menu writes the
   * same property we write. `speedPlan`'s entry-point rule says a `ratechange`
   * YIELDS — adopt it, never write ours back — and no inspection of the value
   * can tell that from "the user pressed our button". If this ever writes back,
   * the control fights the page's menu.
   */
  m = mark('speed:yield');
  t.requestSpeed(1.5);
  await wait(500);
  await evalIn(wc, `(() => { const v = ${V}; if (v) v.playbackRate = 1.75; return v ? v.playbackRate : null; })()`);
  await wait(900);
  R.speedYield = {
    reports: since(m).speeds,
    yielded: since(m).speeds.filter((s) => s.why === 'yield').map((s) => ({ want: s.want, applied: s.applied })),
    rate: await evalIn(wc, `(() => { const v = ${V}; return v ? v.playbackRate : null; })()`),
  };

  /**
   * THE AD. Neutralise to 1 for its duration, REMEMBER the user's rate, and put
   * it back on the item boundary. `ad-showing` is a class and not an event, so
   * the ad-END edge has to be noticed by whoever looks next — which is the tick.
   */
  t.requestSpeed(1.5);
  await wait(500);
  m = mark('speed:ad');
  await evalIn(wc, 'window.__wbFixture.ad(true)');
  await wait(900);
  const adOn = {
    reports: since(m).speeds,
    rate: await evalIn(wc, `(() => { const v = ${V}; return v ? v.playbackRate : null; })()`),
  };
  const m2 = mark('speed:ad-end');
  await evalIn(wc, 'window.__wbFixture.ad(false)');
  await wait(900);
  R.speedAd = {
    on: adOn,
    end: {
      reports: since(m2).speeds,
      rate: await evalIn(wc, `(() => { const v = ${V}; return v ? v.playbackRate : null; })()`),
    },
  };
  t.requestSpeed(null);
  await wait(400);

  // =====================================================================
  // 5. AUTOPLAY-NEXT — impose, restore, stuck, missing
  // =====================================================================
  R.autonav = {};
  /**
   * THE DEFAULT IS SUPPRESS with no stored preference, so by now the Host has
   * clicked the page's toggle from `true` to `false`.
   *
   * `preloadClicks` IS THE INSTRUMENT AND THE ATTRIBUTE ALONE IS NOT. The reload
   * in phase 0 re-parsed the page, so `aria-checked` started this document at
   * `true`; a `false` now means somebody pressed it since. But "somebody" has to
   * be OUR click rather than a leftover, and the preload's counter resets with
   * the document — so a non-zero count is the half that says it happened HERE.
   *
   * `reports` is expected to be EMPTY, and that is not a defect. The click and
   * its re-read settle in the same tick, so the deck-facing state goes from
   * `off` straight back to `off` and the dedupe drops it. `content.js` says the
   * same thing in its own words: a 400 ms `pending` that was already `off` is a
   * report of a doubt nobody has.
   */
  R.autonav.imposed = {
    page: await page(),
    reports: log.autonavs.slice(0, 8),
    suppressed: t.autonav.suppressed(),
    preloadClicks: ((log.states[log.states.length - 1] || {}).counts || {}).clicks,
  };

  m = mark('autonav:restore');
  t.setPrefs({ autoplayNext: true });
  await wait(1200);
  R.autonav.restored = { page: await page(), reports: since(m).autonavs, moved: true };

  m = mark('autonav:suppress-again');
  t.setPrefs({ autoplayNext: false });
  await wait(1200);
  R.autonav.suppressedAgain = { page: await page(), reports: since(m).autonavs };

  /**
   * A TOGGLE THAT IGNORES ITS CLICK. Replacing the button with a clone of itself
   * drops the page's own listener while leaving the markup — and `aria-checked`
   * — exactly where it was. Three presses and then `stuck`, rather than pressing
   * it until the find window closes and leaving it on whichever value an odd or
   * even count landed on.
   */
  m = mark('autonav:stuck');
  R.autonav.deafened = await evalIn(wc, `(() => {
    const b = document.getElementById('autonav-button');
    if (!b) return 'no button';
    b.replaceWith(b.cloneNode(true));
    const flag = document.querySelector('.ytp-autonav-toggle-button');
    if (flag) flag.setAttribute('aria-checked', 'true');
    return flag ? flag.getAttribute('aria-checked') : 'no flag';
  })()`);
  t.autonav.reassert();
  await wait(2500);
  R.autonav.stuck = {
    page: await page(), reports: since(m).autonavs,
    clicks: JSON.parse(JSON.stringify(t.autonav.stats)),
  };

  /**
   * THE CONTROL IS GONE. Six seconds is the find window — inside it "not there"
   * is a WAIT (`looking`) and outside it is a FACT (`missing`). Both are
   * reported, and the point is that they are different words.
   */
  m = mark('autonav:missing');
  await evalIn(wc, 'window.__wbFixture.autonavPresent(false)');
  t.autonav.reassert();
  await wait(1000);
  const looking = since(m).autonavs.slice();
  await wait(6200);
  R.autonav.missing = { page: await page(), duringWindow: looking, afterWindow: since(m).autonavs };
  await evalIn(wc, 'window.__wbFixture.autonavPresent(true)');

  // =====================================================================
  // 6. THE KEYBOARD — and the page keeps every key we did not claim
  // =====================================================================
  const KEY = (code, key) => `(() => {
    const before = window.__wbFixture.pageKeys.length;
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: ${JSON.stringify(code)}, key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }));
    return { reachedPage: window.__wbFixture.pageKeys.length > before, pageKeys: window.__wbFixture.pageKeys.length };
  })()`;

  R.keys = {};
  m = mark('keys:unarmed');
  t.claimKeys({ armed: false, keys: ['Digit1', 'Digit2', 'Digit3'] });
  await wait(250);
  R.keys.unarmed = { page: await evalIn(wc, KEY('Digit1', '1')), took: since(m).keys.length };

  m = mark('keys:armed');
  t.claimKeys({ armed: true, keys: ['Digit1', 'Digit2', 'Digit3'] });
  await wait(250);
  R.keys.claimed = { page: await evalIn(wc, KEY('Digit1', '1')), took: since(m).keys.length, got: since(m).keys };

  m = mark('keys:unclaimed');
  R.keys.unclaimed = { page: await evalIn(wc, KEY('Digit9', '9')), took: since(m).keys.length };

  /**
   * THE STOLEN DIGIT. `1` pressed inside a half-written comment on somebody
   * else's site must reach the field. This is the one filter only the page's own
   * context can apply, and it is why the key listener is in the preload rather
   * than on `before-input-event` in `main`.
   */
  m = mark('keys:typing');
  await evalIn(wc, 'window.__wbFixture.focusTypeBox()');
  R.keys.typing = {
    focused: await evalIn(wc, 'document.activeElement.id'),
    page: await evalIn(wc, `(() => {
      const box = document.getElementById('typebox');
      const before = window.__wbFixture.pageKeys.length;
      box.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '1', bubbles: true, cancelable: true }));
      return { reachedPage: window.__wbFixture.pageKeys.length > before };
    })()`),
    took: since(m).keys.length,
  };
  await evalIn(wc, 'window.__wbFixture.blurTypeBox()');

  /** `?` is a CHARACTER, not a position — which key produces it differs by layout. */
  m = mark('keys:question');
  R.keys.question = { page: await evalIn(wc, KEY('Slash', '?')), took: since(m).keys.length, got: since(m).keys };
  t.claimKeys({ armed: false, keys: [] });

  // =====================================================================
  // 7. THE SINGLE-PAGE NAVIGATION — announced, and not
  // =====================================================================
  t.requestSpeed(1.5);
  await wait(700);
  m = mark('spa:announced');
  R.spa = { rateBefore: await evalIn(wc, `(() => { const v = ${V}; return v ? v.playbackRate : null; })()`) };
  await evalIn(wc, 'window.__wbFixture.spaNavigate(true)');
  await wait(1200);
  R.spa.announced = {
    jumps: since(m).jumps.length,
    changes: t.stats.changes.slice(),
    page: await page(),
    rate: await evalIn(wc, `(() => { const v = ${V}; return v ? v.playbackRate : null; })()`),
    speeds: since(m).speeds.slice(-3),
    /**
     * EVERY `want` THE SWAP PRODUCED, in order — and this is what carries the
     * dropped-claim assertion rather than the element's rate.
     *
     * The rate alone cannot see it. A fresh `<video>` starts at 1, and the first
     * state after the swap is a POLL, which `speedPlan` answers with a YIELD —
     * so the claim is let go as a side effect whether or not anything dropped
     * it, and the element reads 1 either way. Measured: mutation 23 deleted
     * `speed.dropClaim()` and the assertion stayed green.
     *
     * `want: null` is the discriminating value. Dropping the claim produces one;
     * yielding never does — it ADOPTS the element's rate, so `want` goes
     * 1.5 -> 1 and is never absent. The difference matters because the yield is
     * an ordering accident: a `loadedmetadata` arriving before any poll carries
     * reason `remount`, which WRITES, and a stale claim would then land on a
     * video the user has not heard yet.
     */
    wants: since(m).speeds.map((x) => x.want),
  };

  /**
   * THE SAME THING WITHOUT THE ANNOUNCEMENT. `yt-navigate-finish` is the site's
   * private event name. This is the run that still works the day it is renamed,
   * and it is the only evidence that the tick is load-bearing rather than
   * decorative.
   */
  m = mark('spa:silent');
  await evalIn(wc, 'window.__wbFixture.spaNavigate(false)');
  await wait(1500);
  R.spa.silent = {
    jumps: since(m).jumps.length,
    changes: t.stats.changes.slice(),
    page: await page(),
    states: since(m).states.map((s) => s.event).slice(0, 8),
  };
  /**
   * THE JUMP TOTAL AS THIS SECTION LEAVES IT.
   *
   * The element-change arithmetic below is about the jumps this section and the
   * ones before it produced, and it used to read `R.transportStats.jumps` —
   * captured at the END of the whole run. That was the same number only for as
   * long as nothing after §7 ever caused a jump. §10 now records a live export
   * ending on a seek the PAGE made, which is a jump, so the two parted company.
   * Snapshotting it here says which jumps the claim is about, which is what the
   * claim always meant.
   */
  R.spa.jumpsAtEnd = t.stats.jumps;

  // =====================================================================
  // 8. RELEASE — hand the player back the way it was found
  // =====================================================================
  m = mark('release');
  t.drive({ muted: true, playbackRate: 1.5 });
  await wait(500);
  const beforeRelease = await evalIn(wc, `(() => { const v = ${V}; return v ? { muted: v.muted, rate: v.playbackRate, pitch: v.preservesPitch } : null; })()`);
  t.release();
  await wait(600);
  R.release = {
    before: beforeRelease,
    after: await evalIn(wc, `(() => { const v = ${V}; return v ? { muted: v.muted, rate: v.playbackRate, pitch: v.preservesPitch } : null; })()`),
  };

  // =====================================================================
  // 9. `ready` OWES A RE-SEND
  // =====================================================================
  /**
   * THE CONTROL FIRST, AND IT IS NOT DECORATION. `onSpeedReport` and
   * `onAutonav` fire ON CHANGE. A window in which nothing changed must carry
   * ZERO of each — otherwise "the re-send arrived" is satisfied by traffic that
   * was going to arrive anyway and the assertion could not lose. `onState` is
   * NOT zero here and must not be asserted to be: the preload's 4 Hz tick is a
   * push, so the state channel is never quiet, which is exactly why the state
   * half of the re-send is claimed on `firstState` arriving inside one tick
   * rather than on a count.
   */
  const quiet = mark('resend:control');
  await wait(500);
  R.resendControl = { states: since(quiet).states.length, speeds: since(quiet).speeds.length, autonavs: since(quiet).autonavs.length };

  m = mark('resend');
  t.resend();
  await wait(500);
  R.resend = {
    states: since(m).states.length, speeds: since(m).speeds.length, autonavs: since(m).autonavs.length,
    // Undeduped: a deck that has just mounted has never been told anything, and
    // "nothing changed" is what a dropped re-send looks like.
    firstState: since(m).states[0] || null,
  };

  // =====================================================================
  // 10. L1's RUNTIME WITNESS
  // =====================================================================
  const reqs = t.requests();
  R.l1 = {
    requests: reqs.slice(0, 40),
    total: reqs.length,
    // The fixture is a `file:` page whose media is a `blob:` it built itself.
    // Anything outside these three schemes is a request this Host caused.
    offSchemes: reqs.filter((r) => !/^(file|blob|data|devtools):/.test(r.url)).slice(0, 20),
    preloadFile: 'src/preload/youtube.cjs',
  };

  // =====================================================================
  // 11. THE LIVE EXPORT'S CONTIGUOUS PASS — S7a
  // =====================================================================
  /**
   * LAST, AND THAT IS NOT ARBITRARY. This section ends a recording on a seek the
   * PAGE made, which is a content jump — and §7's element-change arithmetic is
   * about the jumps up to §7. Running here, after `R.spa.jumpsAtEnd` has been
   * taken, keeps this section's traffic out of every window another section is
   * measuring. It makes no request, replaces no element and claims no key.
   *
   * IT DRIVES THE PUBLIC MEMBERS AND NOTHING ELSE — `startRecording`,
   * `recordChunk`, `stopRecording`, `abortRecording`, `drive`, `setPrefs`,
   * `recording()`. `src/main/deck-host.js` is what will call them for a deck; a
   * gate reaching past them into `createPass` would be gating a door nothing
   * else opens.
   *
   * THE PAGE'S OWN TOGGLE HANDLER IS PUT BACK FIRST. §5 deliberately deafened it
   * — `b.replaceWith(b.cloneNode(true))` drops the site's listener while leaving
   * the markup — so that `stuck` was a reachable state. A suspension asserted
   * over a control that cannot move is a suspension asserted over nothing, so
   * the page's handler is re-attached in the page's own world before anything
   * here is measured, and the repair is WITNESSED rather than assumed.
   */
  const SR_FIX = 44100;
  const CHUNK_FRAMES = 4410;                    // 0.1 s, so the files stay small
  const passFile = (n) => path.join(outDir, `pass-${n}.f32`);
  const feed = (v, n = 1) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const samples = new Float32Array(CHUNK_FRAMES * 2).fill(v);
      out.push(t.recordChunk({ samples, frames: CHUNK_FRAMES }));
    }
    return out;
  };

  R.rec = { sr: SR_FIX, chunkFrames: CHUNK_FRAMES };

  // --- the page's own handler back, and witnessed moving
  R.rec.repair = await evalIn(wc, `(() => {
    const b = document.getElementById('autonav-button');
    if (!b) return 'no button';
    const flag = document.querySelector('.ytp-autonav-toggle-button');
    if (!flag) return 'no flag';
    b.addEventListener('click', () => {
      flag.setAttribute('aria-checked', flag.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
    });
    const was = flag.getAttribute('aria-checked');
    b.click();
    const mid = flag.getAttribute('aria-checked');
    b.click();
    return { was, mid, back: flag.getAttribute('aria-checked'), moves: was !== mid };
  })()`);

  /**
   * THE CONTROL, AND WITHOUT IT NONE OF THIS CAN LOSE. Suppression is the
   * DEFAULT (`resolveSuppress(undefined) === true`), so a page whose toggle
   * reads `false` during a recording reads exactly like a page nobody recorded.
   * The user's preference is turned ON first, so `false` for the length of the
   * recording can only have come from the recording.
   */
  t.setPrefs({ autoplayNext: true });
  await wait(1600);
  R.rec.control = { page: await page(), held: t.autonav.heldNow(), suppressed: t.autonav.suppressed() };

  // --- 11a. a recording suspends it for the WHOLE of its duration
  m = mark('rec:hold');
  R.rec.started = t.startRecording({ file: passFile(1) });
  R.rec.afterStart = { held: t.autonav.heldNow(), recording: t.recording() };
  // ONE POLL PERIOD BEFORE THE FIRST SAMPLE. `holdSuppress` asks the preload to
  // look and the page's handler flips the attribute in that round trip; sampling
  // inside it would be measuring the request rather than the state.
  await wait(900);
  const samples = [];
  for (let i = 0; i < 8; i++) {
    await wait(400);
    feed(0.25);
    samples.push((await page()).autonav);
  }
  R.rec.duringHold = {
    samples,
    autonavs: since(m).autonavs.map((a) => a.state),
    recording: t.recording(),
  };

  // --- 11b. OUR OWN corrective seek ends it, though the jump channel hides it
  m = mark('rec:self-seek');
  const beforeSelfSeek = t.recording();
  t.drive({ currentTime: 20 });
  await wait(600);
  R.rec.selfSeek = {
    before: beforeSelfSeek,
    after: t.recording(),
    jumps: since(m).jumps.length,
    afterEndChunk: feed(0.75)[0],
    file: passFile(1),
  };
  await wait(1400);
  R.rec.afterSelfSeek = { held: t.autonav.heldNow(), page: await page() };

  // --- 11c. a seek the PAGE made ends it too
  R.rec.started2 = t.startRecording({ file: passFile(2) });
  feed(0.5, 2);
  m = mark('rec:page-seek');
  await evalIn(wc, 'window.__wbFixture.seek(35)');
  await wait(800);
  R.rec.pageSeek = {
    jumps: since(m).jumps.length,
    after: t.recording(),
    afterEndChunk: feed(0.9)[0],
    file: passFile(2),
  };

  // --- 11d. an ABORTED recording puts the page's toggle back
  R.rec.started3 = t.startRecording({ file: passFile(3) });
  feed(0.3, 2);
  // THE HOLD IS A CLICK ON THE PAGE, NOT A VARIABLE. `holdSuppress` asks the
  // preload to look, main decides, the preload clicks and re-reads — two IPC
  // round trips and the page's own handler. Reading `aria-checked` in the same
  // turn measured the request rather than the state, and the first run of this
  // section was red for exactly that: "held with the page at true".
  await wait(1400);
  R.rec.beforeAbort = { held: t.autonav.heldNow(), page: await page(), recording: t.recording() };
  R.rec.aborted = t.abortRecording('gate');
  await wait(1600);
  R.rec.afterAbort = {
    held: t.autonav.heldNow(),
    page: await page(),
    recording: t.recording(),
    fileGone: !fs.existsSync(passFile(3)),
    suppressed: t.autonav.suppressed(),
  };
  R.rec.log = t.passLog();
  R.rec.names = t.PASS_END_NAMES;
  // Put the preference back the way §5 left it, so nothing after this reads a
  // page this section changed.
  t.setPrefs({ autoplayNext: false });
  await wait(800);

  // ------------------------------------------------------------ the record
  R.log = {
    subscribed: log.subscribed,
    counts: { states: log.states.length, jumps: log.jumps.length, speeds: log.speeds.length, keys: log.keys.length, autonavs: log.autonavs.length },
    marks: log.marks,
    autonavStates: log.autonavs.map((a) => a.state),
    speedStates: log.speeds.map((s) => s.state),
    lastState: log.states[log.states.length - 1] || null,
  };
  R.transportStats = JSON.parse(JSON.stringify(t.stats));
  R.speedStats = JSON.parse(JSON.stringify(t.speed.stats));
  R.autonavStats = JSON.parse(JSON.stringify(t.autonav.stats));
  /**
   * THE UNSUBSCRIBE, WITNESSED. Every `on…()` returns one, and a listener
   * registration that cannot be undone is a leak the day two decks exist.
   *
   * `after` is not expected to be zero and must not be asserted as zero:
   * `src/main/deck-host.js` legitimately holds one on each channel for the whole
   * of the app's life. The claim is the DIFFERENCE — five channels, one fewer
   * listener each — which is a claim about our unsubscribe rather than about how
   * many other subscribers the product happens to have today.
   */
  const before = t.listeners();
  for (const off of released) { try { off(); } catch { /* recorded as a non-drop below */ } }
  R.listeners = { before, after: t.listeners(), released: released.length };
  R.pin = { speedJs: path.relative(appRoot, t.SPEED_JS), prefsKey: t.PREFS_KEY };
  R.finalPage = await page();

  fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(R, null, 2)}\n`);
  console.log(`[gate] wrote ${path.join(outDir, 'report.json')}`);
  return 0;
}
