/**
 * The SOURCE view's preload — the transport's page end.
 *
 * This is what `content.js`, `autonav.js` and `speed.js` are to the extension,
 * split the way an Electron Host has to split them: `content.js`'s DOM half is
 * here; `speed.js`'s and `autonav.js`'s DECISION halves are in `main`
 * (`src/main/speed.js`, `src/main/autonav.js`). Nothing below decides anything.
 * It LOOKS, it REPORTS, and it APPLIES what it is told.
 *
 * IT EXPOSES NOTHING ON `window`, BY DESIGN. `contextIsolation: true` plus no
 * `contextBridge.exposeInMainWorld` means the page cannot see or call any of it
 * — the same posture `content.js` has in an isolated world. `tools/suites/
 * shell.mjs` asserts the page sees no bridge of ours, and that assertion is
 * watched red by adding an `exposeInMainWorld` here.
 *
 * ===========================================================================
 * L1 — CAPTURE ONLY WHAT THE USER'S OWN PLAYER RENDERS
 * ===========================================================================
 * A script running inside somebody else's video page is exactly where a ripper
 * would live, so the boundary is stated in terms of what this file DOES, not as
 * a slogan — `CONTRIBUTING.md` L1's own wording, one Host over.
 *
 * IT READS FIVE VALUES off the page's `<video>`: `paused`, `currentTime`,
 * `duration`, `ended` and `playbackRate`, plus `seeking` as an EVENT rather
 * than a poll. **That is transport state, not media.**
 *
 * IT WRITES FOUR: `muted`, `currentTime`, `playbackRate` — the closed write set
 * `shared/host.js` freezes on `DeckTransport.drive` — and `preservesPitch`,
 * which is the key-lock policy that must land on the same write as the rate and
 * is `speed.js`'s constant, never a number decided here.
 *
 * IT NEVER reads `src`, `currentSrc`, `buffered` or `srcObject`; never calls
 * `captureStream()`, `getDisplayMedia()` or `getUserMedia()`; never constructs a
 * `Blob`, a `MediaSource`, a `URL` or a `fetch`; never touches a byte of audio
 * or video; and never runs in the page's JavaScript world.
 *
 * HOW THAT IS PROVED, mechanically, rather than asserted in prose —
 * `tools/suites/transport.mjs`, three independent instruments:
 *
 *   1. THE WRITE SET IS ENUMERATED. With comments and string literals stripped,
 *      the ONLY member assignments in this whole file are `el.muted`,
 *      `el.currentTime`, `el.playbackRate` and `el.preservesPitch`. Not "no
 *      forbidden write" — the complete set, compared against the closed one.
 *   2. THE READ SET IS AN ALLOW-LIST. Every property this file touches is
 *      compared against an enumerated list. A new `el.videoWidth` is red until
 *      somebody deliberately widens that list, which is the point.
 *   3. IT ASKED FOR NOTHING. `main` records every network request the source
 *      view makes across the whole transport exercise. Against the local
 *      fixture — whose media is a `blob:` generated in-page — the count of
 *      non-`file:`/`blob:`/`data:` requests must be zero.
 *
 * (1) and (2) are static and see code that never ran; (3) is dynamic and sees
 * code no scanner could read. Neither alone is the claim.
 *
 * ===========================================================================
 * WHY THE DECISIONS ARE NOT HERE
 * ===========================================================================
 * A sandboxed preload cannot `require` a relative file. So this file could not
 * reach `vendor/…/extension/speed.js` even if it wanted to, and anything it
 * decided about a playback rate would be decided against a range re-typed into
 * it. `ui/embed-state.js` pins the deck's speed ladder against that exact
 * vendored file (`unit.json` `hostReads`), so a second range in here would make
 * that pin a lie — see `src/main/speed.js`'s header for the whole argument.
 * Every constant below that could have been a number arrives in `{c:'config'}`.
 *
 * The one exception is the two EVENT LISTS, which are event names rather than
 * policy — and they are pinned against `content.js`'s own arrays by the suite,
 * so they cannot drift either.
 */
const { ipcRenderer } = require('electron');

/** preload -> main. The source view is on NO bus address; this is its own wire. */
const UP = 'yt';
/** main -> preload. */
const DOWN = 'yt:cmd';

/**
 * `play` and `pause` are what the deck follows. The others are not padding, and
 * the reasons are `content.js`'s: `ended` leaves `paused` true but fires nothing
 * else on some paths, `emptied` fires when the page swaps the source between
 * videos, `loadedmetadata` is where a freshly-swapped element settles,
 * `timeupdate` IS THE SYNC CLOCK (~4 Hz of `currentTime` volunteered at the
 * moment it becomes true), `seeked` releases `selfSeeking`, and `ratechange` is
 * how somebody else's speed menu moving the rate on a PAUSED video becomes
 * visible at all.
 *
 * PINNED, NOT COPIED: `tools/suites/transport.mjs` parses these two arrays out
 * of the vendored `extension/content.js` and compares them with these. A second
 * hand-maintained list of "which events matter" is how a Host ends up following
 * an element the page has already thrown away.
 */
const VIDEO_EVENTS = ['play', 'pause', 'ended', 'emptied', 'loadedmetadata', 'timeupdate', 'seeked', 'ratechange'];

/**
 * The events that mean THE AUDIO ALREADY BUFFERED IS THE WRONG AUDIO.
 * `seeking` fires the moment the user grabs the scrubber, ~2.4 s earlier than
 * `seeked`. `ratechange` is deliberately NOT here: the element emits 44 100
 * samples per second at any rate, so the ring keeps filling and a restart would
 * cost a re-prime for nothing.
 */
const JUMP_EVENTS = ['seeking', 'emptied'];

/**
 * OUR OWN SEEK, in flight. Writing `currentTime` fires `seeking`, which this
 * file reports as a content jump — so a corrective seek would tell the deck the
 * user had scrubbed, and the deck would re-seek in response. That is a feedback
 * loop that converges on nothing.
 *
 * Cleared on the matching `seeked`, and on a timer, because a seek to a position
 * the element is already at fires neither event and would latch the flag on.
 */
const SELF_SEEK_TTL_MS = 2000;

/** The state push cadence when no media event is firing — a PAUSED page moves nothing. */
const TICK_MS = 250;

/** Everything that could have been a number, arriving from `main`. Null until it does. */
let cfg = null;
/** The watched media element. THE ONE BINDING THROUGH WHICH THE PAGE IS TOUCHED. */
let el = null;
let selfSeeking = 0;
let deckArmed = false;
let deckKeys = new Set();
/**
 * `main`'s word on whether autoplay-next is being suppressed right now. It is
 * read by ONE thing — the `ended` handler — which is the only place in this file
 * that can call `pause()`. Structurally, not by convention: there is no command
 * that pauses, so nothing can ask for a pause at a moment of its choosing.
 */
let suppressing = false;

// Counters, so a claim about this file can be carried by a number instead of a
// stopwatch. Bare `let`s and not an object, because an object would put a member
// assignment in a file whose complete member-assignment set is the L1 claim.
let nEvents = 0;
let nJumps = 0;
let nSelfSeeks = 0;
let nWrites = 0;
let nSwaps = 0;
let nKeys = 0;
let nClicks = 0;
let nTicks = 0;

function up(msg) {
  try {
    ipcRenderer.send(UP, msg);
  } catch (err) {
    // NOT A SILENT CATCH. The view is torn down mid-tick often enough that a
    // throw here is noise, but a wire that stopped working must still say so.
    console.warn(`[wb-source] could not report to main: ${(err && err.message) || err}`);
  }
}

// ------------------------------------------------------------- the element
/**
 * THE ONE PLACE THE PAGE'S MEDIA ELEMENT IS FOUND. `#movie_player video` first,
 * because on a watch page that is the player and a bare `video` can be a
 * preview, an ad slot or a thumbnail animation.
 */
const findVideo = () => document.querySelector('#movie_player video') || document.querySelector('video');

/** The element's own `playbackRate`, or null when there is nothing to read. */
const elementRate = () => (el && Number.isFinite(el.playbackRate) && el.playbackRate > 0 ? el.playbackRate : null);

/**
 * Is an ad playing through the element right now?
 *
 * `null`, NOT `false`, BEFORE THE CONFIG ARRIVES. There is no inference
 * available — the ad plays through the same element — so the selector is the
 * only witness, and until we have one we do not know. `speedPlan` answers
 * `state: 'unknown'` to a non-boolean here and refuses to write, which is the
 * branch that stops a user's 1.4x being applied to an advert. `false` would be
 * the permissive reading of "we could not look", and that is the shape this
 * whole tree is written against.
 */
const adShowing = () => (cfg ? !!document.querySelector(cfg.adSel) : null);

const isSelfSeek = () => selfSeeking !== 0 && Date.now() - selfSeeking < SELF_SEEK_TTL_MS;

/** Transport state, and nothing else. See the L1 block at the top of this file. */
function sendState(extra) {
  up({
    t: 'state',
    playing: !!(el && !el.paused && !el.ended),
    currentTime: el ? el.currentTime : 0,
    // NaN before metadata arrives. Sent as 0 so the deck's "do I know the
    // duration" test is a number test rather than a NaN test that passes.
    duration: el && Number.isFinite(el.duration) ? el.duration : 0,
    ended: !!(el && el.ended),
    playbackRate: elementRate() === null ? 1 : elementRate(),
    // Without it, `playing:false, currentTime:0, duration:0` for "there is no
    // player on this page" is byte-identical to "paused at zero", and the deck
    // cannot grey the control with a reason.
    hasMedia: !!el,
    adShowing: adShowing(),
    counts: { events: nEvents, jumps: nJumps, selfSeeks: nSelfSeeks, writes: nWrites, swaps: nSwaps, keys: nKeys, clicks: nClicks, ticks: nTicks },
    ...extra,
  });
}

/**
 * A CONTENT JUMP — the page's event, NEVER the user's consent.
 *
 * That distinction is load-bearing downstream and it was paid for: the deck's
 * `onContentJump()` reaches `startLive()`, and `startLive()` attaching a capture
 * is what makes the engine fetch the 109 MB weights. A jump reported for
 * something the user did not do is a model download the user declined, started
 * by a scrub (stem-splitter-live #15, `fix(ui): a seek must not start the model
 * download the user declined`). So:
 *
 *   - our own corrective seek is NOT a jump. It reports the new position, which
 *     is the freshest transport state there is, and does not claim the user
 *     moved;
 *   - a rate change is NOT a jump (`ratechange` is not in `JUMP_EVENTS`);
 *   - a `{c:'drive'}` from the deck is not a jump however far it seeks.
 *
 * What IS a jump: `seeking`, `emptied`, and the element being replaced under us.
 */
function sendJump() {
  if (isSelfSeek()) { sendState({ seeking: false }); return; }
  nJumps++;
  up({ t: 'jump' });
  sendState({ seeking: true });
}

/**
 * Undo everything a drive can do. Called before the element is abandoned, and on
 * `{c:'release'}`.
 *
 * `muted` goes to FALSE rather than to a remembered prior value: the only path
 * that mutes it is ours, and remembering across a single-page navigation is a
 * stale-state bug waiting to happen. `preservesPitch` goes to TRUE — Chrome's
 * default — because a page left with key lock disabled after the deck has gone
 * would silently change what the site's own speed menu does for the rest of the
 * session.
 *
 * IT TAKES NO ARGUMENT and runs against `el` before `el` is reassigned. That is
 * not a style choice: every media access in this file is on the single binding
 * `el`, which is what makes the L1 scan a claim about a name rather than a
 * guess about aliases.
 */
function restoreVideo() {
  if (el) {
    if (el.playbackRate !== 1) el.playbackRate = 1;
    if (el.preservesPitch !== true) el.preservesPitch = true;
    if (el.muted) el.muted = false;
  }
  selfSeeking = 0;
}

/**
 * THE ONLY PLACE THAT DRIVES `playbackRate`. Both callers go through it — the
 * deck's sync correction and the user's speed claim — for `content.js`'s reason:
 * `playbackRate` already has two writers (us and the page's own speed menu), and
 * a second writer on OUR side is the entry-point family that has produced five
 * defects in the other repository. The epsilon guard and the key-lock write are
 * each easy to remember on the path you are thinking about and easy to forget on
 * the one you are not.
 *
 * `preservesPitch = cfg.keyLock` ON EVERY WRITE, before the rate, so the element
 * never renders even one quantum under the wrong policy. The VALUE is
 * `speed.js`'s `SPEED_KEY_LOCK`, carried in the config — never a literal here.
 */
function driveRate(rate) {
  if (!el || !cfg || !Number.isFinite(rate) || rate <= 0) return false;
  if (Math.abs(el.playbackRate - rate) <= cfg.speedEps) return false;
  if (el.preservesPitch !== cfg.keyLock) el.preservesPitch = cfg.keyLock;
  el.playbackRate = rate;
  nWrites++;
  return true;
}

/**
 * THE CLOSED WRITE SET, ENFORCED AT THIS END TOO. `shared/host.js` freezes
 * `drive` at `muted`, `playbackRate` and `currentTime` and says a Host
 * "implements the closure — it writes the three it was given and ignores
 * anything else in the patch — so that widening it is an edit to a Host and to
 * this list, and never a field a caller smuggles through". Three named reads off
 * `cmd`, and no spread onto the element: `Object.assign(el, cmd)` would reopen
 * the set with nothing in this tree able to see it.
 *
 * L1 is a security property, and this channel reaches a `<video>` on somebody
 * else's page — so the deck filters, `main` allow-lists again, and this is the
 * third layer.
 */
function driveVideo(cmd) {
  if (!el) return;
  if (typeof cmd.muted === 'boolean' && el.muted !== cmd.muted) { el.muted = cmd.muted; nWrites++; }
  if (Number.isFinite(cmd.playbackRate)) driveRate(cmd.playbackRate);
  // 1e-3 is `content.js`'s own threshold: a 10 Hz sync loop must not re-seek to
  // a position the element is already at.
  if (Number.isFinite(cmd.seekTo) && Math.abs(el.currentTime - cmd.seekTo) > 1e-3) {
    selfSeeking = Date.now();
    nSelfSeeks++;
    el.currentTime = cmd.seekTo;
    nWrites++;
  }
}

const onJumpEvent = () => { nEvents++; sendJump(); };

const onVideoEvent = (ev) => {
  nEvents++;
  if (ev.type === 'seeked') selfSeeking = 0;
  /**
   * BELT AND BRACES on `ended`, AND NOWHERE EARLIER. Pausing at `duration − ε`
   * also stops autoplay and is the route that quietly discards the stem cache's
   * first-play prime: `shared/stemcache.js` refuses to commit unless the page
   * reported `ended`. By the time this fires, that gate is already satisfied.
   *
   * THIS IS THE ONLY `pause()` IN THIS FILE, and `play()` does not appear at
   * all. Starting is the user's, always.
   */
  if (ev.type === 'ended' && suppressing) {
    if (el && !el.paused) el.pause();
    endScreenCancel();
  }
  // `main` decides what each event MEANS for the speed claim — `loadedmetadata`
  // is a fresh source settling and re-asserts, `ratechange` is somebody else
  // writing the property and yields. The reason travels with the event.
  sendState({ event: ev.type });
};

/**
 * The page REPLACES the `<video>` on some navigations rather than re-pointing
 * it, so the listeners have to be re-hung rather than attached once. Cheap and
 * idempotent: called from the tick, from the page's own SPA event, and whenever
 * `main` asks.
 *
 * IT DISTINGUISHES THREE CHANGES, AND ONLY TWO OF THEM ARE JUMPS.
 * `arrived` is the element showing up for the first time — a page that was
 * still building, which is not the content moving under anybody. `swapped` and
 * `gone` are: what is in the deck's ring is now audio from somewhere else.
 * Collapsing the three would report a content jump at boot, on every launch, to
 * a deck whose model prompt the user may have declined — which is the defect
 * `sendJump`'s header names.
 *
 * @returns {''|'arrived'|'swapped'|'gone'}
 */
function watchVideo() {
  const next = findVideo();
  if (next === el) return '';
  const had = !!el;
  if (el) {
    for (const e of VIDEO_EVENTS) el.removeEventListener(e, onVideoEvent);
    for (const e of JUMP_EVENTS) el.removeEventListener(e, onJumpEvent);
    // Hand it back the way we found it, or a muted 1.5x <video> is what the user
    // is left looking at when the deck moves on.
    restoreVideo();
  }
  el = next;
  if (el) {
    for (const e of VIDEO_EVENTS) el.addEventListener(e, onVideoEvent);
    for (const e of JUMP_EVENTS) el.addEventListener(e, onJumpEvent);
  }
  if (had) nSwaps++;
  if (!had) return 'arrived';
  return el ? 'swapped' : 'gone';
}

/**
 * A SOURCE SWAP IS A CONTENT JUMP AND A DROPPED SPEED CLAIM. Whatever is in the
 * deck's ring is the previous video and must not be played over this one; and a
 * speed that survived a video change would play a video the user has not heard
 * yet at somebody else's tempo.
 *
 * ONE PLACE DECIDES WHETHER A CHANGE IS A JUMP, so a caller cannot get it wrong
 * on the path nobody was thinking about.
 */
function afterChange(change, why) {
  if (!change) return false;
  up({ t: 'element', have: !!el, change, why });
  if (change !== 'arrived') {
    nJumps++;
    up({ t: 'jump' });
  }
  sendState({ event: `${change}:${why}` });
  return true;
}

// --------------------------------------------------------------- autonav
/**
 * ONE DOM READ, unforgiving about both halves. Anything other than the two
 * documented `aria-checked` values is UNREADABLE, not false — a toggle we cannot
 * read is one we must not click, and clicking blind lands on the wrong value
 * half the time.
 */
function lookAutonav(afterClick) {
  if (!cfg) { up({ t: 'autonav', found: false, checked: null, afterClick: !!afterClick }); return; }
  const node = document.querySelector(cfg.autonavSel);
  const a = node ? node.getAttribute('aria-checked') : null;
  up({
    t: 'autonav',
    found: !!node,
    checked: a === 'true' ? true : (a === 'false' ? false : null),
    afterClick: !!afterClick,
  });
}

/**
 * The page's own handler, reached the way the user reaches it, then RE-READ
 * rather than assumed. The site's handler is synchronous on click, so this
 * settles in the same tick in the common case — which matters, because the state
 * IS the report and a 400 ms `pending` that was already `off` is a report of a
 * doubt nobody has.
 */
function clickAutonav() {
  if (!cfg) return;
  const node = document.querySelector(cfg.autonavSel);
  if (node) { nClicks++; node.click(); }
  lookAutonav(true);
}

/**
 * The LATE fallback, and only a fallback: once the end screen is up this cancels
 * a countdown that has already started. Its absence is the healthy case and is
 * not reported. Three tries because the end screen animates in.
 */
function endScreenCancel() {
  for (const ms of [0, 300, 900]) {
    setTimeout(() => {
      if (!suppressing || !cfg) return;
      const node = document.querySelector(cfg.cancelSel);
      if (node) { nClicks++; node.click(); }
    }, ms);
  }
}

// -------------------------------------------------------------- keyboard
/**
 * THE SHORTCUTS REACH THE DECK FROM THIS PAGE, which is the only reason this
 * section exists. The deck is a different `WebContents` in a different session;
 * a key event never crosses that, so `1` would reach the deck only after the
 * user had clicked the deck — and the gesture the feature is for is "press play,
 * then reach for a digit", where focus is here.
 *
 * IT ONLY TAKES THEM WHILE A DECK IS ARMED, and the list arrives from the deck
 * (`page.claimKeys`) rather than being written here. With no deck, `1`-`6` must
 * do on this page exactly what they do with this product uninstalled — we are a
 * guest, and a page whose shortcuts stop working because of an app that is doing
 * nothing is a page the user thinks is broken.
 *
 * WHY NOT `before-input-event` IN `main`, which `docs/HOST-DESIGN.md` §3.4
 * originally specified: that handler cannot see the focused element, and
 * `isTypingTarget` is the load-bearing half. The cost of being wrong here is a
 * digit stolen out of a half-written comment on somebody else's site. `main`
 * still owns the chrome and deck views, where there is no guest page to protect.
 */
function isTypingTarget(t) {
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'
    || t.tagName === 'SELECT' || t.isContentEditable);
}

addEventListener('keydown', (ev) => {
  if (!deckArmed) return;
  if (ev.metaKey || ev.ctrlKey) return;
  if (isTypingTarget(ev.target)) return;
  // `event.code`, not `event.key`: Shift+1 is "!" on a US layout and something
  // else again elsewhere, so the position is the stable handle. `?` is the one
  // exception and it is the opposite case — it is a CHARACTER, and which key
  // produces it differs by layout.
  if (!deckKeys.has(ev.code) && ev.key !== '?') return;
  ev.preventDefault();
  ev.stopPropagation();
  nKeys++;
  up({ t: 'key', code: ev.code, key: ev.key, shift: ev.shiftKey, alt: ev.altKey, repeat: ev.repeat });
}, { capture: true });

// -------------------------------------------------------- what main says
ipcRenderer.on(DOWN, (_event, cmd) => {
  if (!cmd || typeof cmd.c !== 'string') return;
  if (cmd.c === 'config') {
    cfg = {
      adSel: cmd.adSel, autonavSel: cmd.autonavSel, cancelSel: cmd.cancelSel,
      speedEps: cmd.speedEps, keyLock: cmd.keyLock,
    };
    watchVideo();
    sendState({ event: 'config' });
  } else if (cmd.c === 'drive') {
    driveVideo(cmd);
    sendState({ event: 'drive' });
  } else if (cmd.c === 'release') {
    restoreVideo();
    sendState({ event: 'release' });
  } else if (cmd.c === 'keys') {
    deckArmed = cmd.armed === true;
    deckKeys = new Set(Array.isArray(cmd.keys) ? cmd.keys : []);
  } else if (cmd.c === 'suppress') {
    suppressing = cmd.on === true;
  } else if (cmd.c === 'autonav') {
    if (cmd.act === 'click') clickAutonav();
    else lookAutonav(false);
  } else if (cmd.c === 'relook') {
    if (!afterChange(watchVideo(), 'relook')) sendState({ event: 'relook' });
  }
});

// ------------------------------------------------------------------ boot
/**
 * The page is a single-page app: navigating to another video replaces the
 * element, and on this site it announces itself. We listen for that AND poll,
 * because the event name is the site's private markup and the poll is not — a
 * rename takes the announcement away and leaves the belt.
 */
document.addEventListener('yt-navigate-finish', () => {
  // A navigation that did NOT replace the element still moved the content:
  // `content.js` posts JUMP on this event unconditionally, for the same reason.
  if (!afterChange(watchVideo(), 'yt-navigate-finish')) sendJump();
});

/**
 * THE TICK. One `querySelector` and one state push at 4 Hz.
 *
 * It exists because a PAUSED page moves nothing: `timeupdate` is the sync clock
 * while playing and there is no clock at all while stopped, so `adShowing`
 * turning off, an element arriving late, and an element being swapped without an
 * announcement would each be invisible until the user pressed something.
 * `watchVideo()` is idempotent and returns immediately once it has one.
 */
setInterval(() => {
  nTicks++;
  if (!afterChange(watchVideo(), 'tick')) sendState({ event: 'tick' });
}, TICK_MS);

addEventListener('pagehide', () => { up({ t: 'bye' }); }, { capture: true });

watchVideo();
/**
 * `have` IS PART OF THE ANNOUNCEMENT, and it decides one thing in `main`:
 * whether to start hunting for the page's autoplay-next toggle. youtube.com's
 * HOME PAGE has no player, so the hunt there can only ever end in "not found",
 * which the deck paints as *"Couldn't turn off YouTube's autoplay"* — an
 * advisory about a page the user has not asked to do anything with, on every
 * cold start, because the home page is the default source URL.
 * `watchVideo()` above has already run, so this is an answer and not a guess.
 */
up({ t: 'hello', have: !!el });
