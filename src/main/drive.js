/**
 * THE TWO DECISIONS ON THE TRANSPORT CHANNEL THAT ARE WORTH ASSERTING WITHOUT A
 * LAUNCH: what may be written to somebody else's `<video>`, and what an event
 * means for the user's speed claim.
 *
 * NO `electron` IMPORT IN THIS FILE, ON PURPOSE — the same reason
 * `navigation.js`, `assets.js` and `claims.js` have none. `src/main/transport.js`
 * is the electron half and imports these; here they are pure, so
 * `tools/suites/transport.mjs` can drive every branch in plain node with no
 * display, no mutex and no 12-second launch. The branches that matter are the
 * refusals, and a refusal that needs a window to exercise is a refusal nobody
 * exercises.
 */

/**
 * THE CLOSED WRITE SET, spelled once. `shared/host.js`'s `DeckTransport.drive`:
 *
 *   "THE WRITE SET IS CLOSED AND IT IS ADR 0001 decision 4's: `muted`,
 *    `playbackRate`, `currentTime`, and nothing else, ever."
 *
 * It is a MECHANISM PER HOST rather than one mechanism for all Hosts, and the
 * interface froze BOTH ends: the deck names its three fields at the call site,
 * and the Host filters what it puts on the wire. This is the Host's end, and it
 * is not redundant — a Host that did the obvious `Object.assign(player, patch)`
 * would reopen the set with nothing in this tree able to see it.
 */
export const DRIVE_FIELDS = Object.freeze(['muted', 'playbackRate', 'currentTime']);

/**
 * NAMED READS, NEVER A SPREAD, and the type test is part of the gate rather than
 * a nicety: `playbackRate: NaN` written to a `<video>` throws in Blink, and
 * `currentTime: '30'` would seek somewhere a string coerced to. A field that
 * cannot be read is DROPPED rather than coerced — the caller is a different
 * document, shipped in the same build today and not necessarily tomorrow.
 *
 * `currentTime` goes out as `seekTo`, which is `content.js`'s own spelling. The
 * payload the preload receives already carries the element's own `currentTime`,
 * and two fields with one name is how "where it is" and "where it should be" get
 * swapped by somebody reading quickly.
 *
 * @param {object} patch  whatever the deck sent
 * @returns {{muted?: boolean, playbackRate?: number, seekTo?: number}}
 */
export function filterDrive(patch) {
  const p = patch && typeof patch === 'object' ? patch : {};
  const out = {};
  if (typeof p.muted === 'boolean') out.muted = p.muted;
  if (typeof p.playbackRate === 'number' && Number.isFinite(p.playbackRate)) out.playbackRate = p.playbackRate;
  if (typeof p.currentTime === 'number' && Number.isFinite(p.currentTime)) out.seekTo = p.currentTime;
  return out;
}

/**
 * WHICH SPEED REASON AN EVENT CARRIES, and this mapping IS `speed.js`'s design
 * rather than a convenience over it. Its `speedPlan` header:
 *
 *   "WHO MOVED THE RATE IS DECIDED BY THE ENTRY POINT, NOT BY THE VALUE …
 *    no inspection of the VALUE can separate them — 1.0 is both 'YouTube reset
 *    it' and 'the user picked Normal'."
 *
 *   'loadedmetadata'  a fresh source settled on this element  -> re-assert
 *   'ratechange'      somebody else wrote the property        -> YIELD
 *   everything else   a poll                                  -> yield
 *
 * `emptied` IS DELIBERATELY A POLL AND THEREFORE YIELDS, exactly as in
 * `content.js`, which carries the ceiling note: it is a source boundary like
 * `loadedmetadata`, so a format switch that resets the rate mid-video drops the
 * user's speed instead of putting it back. That is the SAFE direction —
 * re-asserting on `emptied` would write a stale rate onto whatever loads next,
 * and on a single-page swap that is a video the user has not heard yet.
 *
 * 'set' and 'ad-end' are NOT produced here. 'set' is a user gesture and arrives
 * through `requestSpeed`; 'ad-end' is an EDGE on a class rather than an event,
 * and `createSpeedClaim` promotes it in one place so it cannot be detected on
 * three paths and missed on the fourth.
 *
 * @param {string} event  the media event name the preload reported
 * @returns {'remount'|'ratechange'|'poll'}
 */
export function speedReasonFor(event) {
  if (event === 'loadedmetadata') return 'remount';
  if (event === 'ratechange') return 'ratechange';
  return 'poll';
}
