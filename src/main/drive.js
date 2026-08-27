/**
 * THE DECISIONS ON THE TRANSPORT CHANNEL THAT ARE WORTH ASSERTING WITHOUT A
 * LAUNCH: what may be written to somebody else's `<video>`, what an event means
 * for the user's speed claim, and — S7a — what ends a live export's ONE
 * CONTIGUOUS PASS.
 *
 * NO `electron` IMPORT IN THIS FILE, ON PURPOSE — the same reason
 * `navigation.js`, `assets.js` and `claims.js` have none. `src/main/transport.js`
 * is the electron half and imports these; here they are plain node, so
 * `tools/suites/transport.mjs` can drive every branch with no display, no mutex
 * and no 12-second launch. The branches that matter are the refusals, and a
 * refusal that needs a window to exercise is a refusal nobody exercises.
 *
 * `node:fs` IS NOT AN EXCEPTION TO THAT RULE, IT IS THE POINT OF IT. The pass
 * below writes what it captured to a real file as it arrives, and the gate reads
 * that file back. A contiguity claim asserted on an internal flag is a claim
 * about bookkeeping; asserted on the bytes, it is a claim about the recording.
 * `fs` runs in plain node, so the whole of it is still drivable without a
 * window — which is the property this file exists to keep.
 */
import fs from 'node:fs';

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

// ===========================================================================
// THE CONTIGUOUS PASS — S7a, the host half of the live-export contiguity rule
// ===========================================================================
/**
 * `CONTEXT.md:311-314`, verbatim:
 *
 *   "the live one carries a contiguity rule the file one does not — one
 *    contiguous pass from where you started, a seek ends it, and autoplay-next
 *    has to be suspended while it runs or the next video records into the same
 *    file."
 *
 * RULING 29 adds the second boundary: A DROP ALSO ENDS THE PASS, exactly as a
 * seek does. Not a tolerance and not a threshold — a BOUNDARY. So no delivered
 * file ever contains a gap, because the pass ended at the drop; the file is
 * shorter AND correct rather than full-length and quietly wrong in the middle,
 * which is the failure nothing downstream can detect.
 *
 * ---------------------------------------------------------------------------
 * THE BOUNDARY WITH THE UNIT: IT OWNS THE VOCABULARY AND NEVER THE DETECTION
 * ---------------------------------------------------------------------------
 * `shared/stemcache.js` upstream owns four things this file must never grow a
 * second copy of:
 *
 *   `PASS_END`           the four members and WHAT EACH ONE SAYS to a user
 *   `recordingRefusal()` whether a pass may be delivered
 *   `passEndNote()`      the one sentence a user is told about a short pass
 *
 * and it says so out loud: *"THE UNIT DOES NOT KNOW WHAT A SEEK IS. `seek` is a
 * reason a Host reports; this module owns the vocabulary and what each member
 * means for delivery, never the detection."*
 *
 * SO THIS FILE OWNS THE DETECTION AND NOTHING ELSE. It decides WHEN a recording
 * stops being contiguous — the page's seek, our own corrective seek, a source
 * boundary, the source ending, the user's stop, a drop the engine reports — and
 * it NAMES the member. It builds no sentence, it renders no refusal, and it
 * never decides what a member means. What it hands on is the record
 * `{frames, drops, endedBy}`, which is the exact shape both of those pure
 * functions take.
 *
 * NAMING THE MEMBER IS UNAVOIDABLE AND IS NOT A REIMPLEMENTATION: the Host is
 * the only thing in the system that knows a seek happened, so it must be able to
 * say the word. `PASS_END_NAMES` below is that word list and NOTHING else — no
 * wording, no meaning, no delivery rule. `tools/suites/transport.mjs` §4b pins
 * it against the vendored unit and scans `src/` to prove no sentence of ours
 * exists anywhere; the same shape `PREFS_KEY` already has one file over.
 *
 * AND THE UNIT REFUSES A REASON IT HAS NO WORDING FOR — `recordingRefusal()`
 * answers *"the recording ended for a reason this unit has no wording for"* —
 * so a Host that invented a fifth member is caught at delivery by the side that
 * owns the vocabulary, rather than by this side asserting about itself.
 */

/**
 * THE FOUR MEMBER NAMES, and this is the ONE place they are written down.
 *
 * Source: `shared/stemcache.js`'s `PASS_END`, upstream. NOT vendored at the
 * pinned tag (v0.2.0) — it arrives with the tag that carries U7. §4b of the
 * suite pins that absence in BOTH directions, so this list becomes a real
 * equality pin on the day the pin bumps rather than staying a copy nobody
 * re-checked.
 */
export const PASS_END_NAMES = Object.freeze(['stopped', 'ended', 'seek', 'drop']);

/**
 * WHICH TRANSPORT OBSERVATION ENDS A CONTIGUOUS PASS, and under which member.
 * The sibling of `speedReasonFor` above, and for the same reason: the mapping
 * lives where the event name and the claim are both in scope, and ONE place
 * decides so a caller cannot get it wrong on the path nobody was thinking about.
 *
 * A `Map` RATHER THAN AN OBJECT LITERAL, deliberately. An object lookup answers
 * `'seek'` for nothing and a function for `'constructor'`; a member name that
 * came off `Object.prototype` is a reason the unit has no wording for, arriving
 * from the one direction nobody tests.
 *
 *   `seeking: true`   the page moved the playhead        -> seek
 *   `emptied`         the element's source went away     -> seek
 *   `ended`           the source reached its end         -> ended
 *
 * `emptied` IS A SEEK AND NOT AN END, and the reference Host already groups it
 * that way: `content.js`'s `JUMP_EVENTS` is `['seeking', 'emptied']` — one
 * class, "what is in the ring is now audio from somewhere else". `ended` is the
 * only observation that means the source ran out, which is the most complete
 * pass there is and reads differently to whoever is holding the file.
 *
 * `timeupdate`, `play`, `pause`, `ratechange`, `loadedmetadata` and the tick are
 * NOT boundaries. A pause is not a discontinuity: the playhead is exactly where
 * it was, so the next frame joins the last one.
 *
 * @param {{event?: string, seeking?: boolean}|null|undefined} state
 * @returns {'seek'|'ended'|null}
 */
const PASS_END_EVENTS = new Map([['emptied', 'seek'], ['ended', 'ended']]);
export function passEndFor(state) {
  const s = state && typeof state === 'object' ? state : {};
  if (s.seeking === true) return 'seek';
  return (typeof s.event === 'string' ? PASS_END_EVENTS.get(s.event) : undefined) ?? null;
}

/**
 * THE FILE THE PASS IS WRITTEN INTO, WHILE IT IS BEING CAPTURED.
 *
 * Raw interleaved 32-bit float frames, appended as they arrive. NO HEADER: the
 * WAV header is `shared/wav.js`'s `encodeWav` and the Export writer's
 * (`PHASE4-HOST-PLAN.md` G1), and a second encoder here would be a second
 * encoder to keep in agreement. What this owns is the STREAM — that the bytes
 * reach the disk as they arrive and are not held.
 *
 * IT OPENS ON THE FIRST WRITE. A pass that ended before a frame of separated
 * audio existed leaves NO FILE, rather than an empty one somebody has to decide
 * about later — the same case `recordingRefusal()` answers with *"nothing was
 * recorded before it ended"*.
 *
 * `abort()` UNLINKS. A pass that failed mid-write must not leave a plausible
 * shorter recording behind: `close()` is what says "this is what was captured",
 * and the two must not be told apart by luck.
 *
 * @param {{path: string}} o
 */
export function createPassSink({ path: file }) {
  let fd = null;
  let bytes = 0;
  let closed = false;
  return {
    file,
    write(samples) {
      if (closed) throw new Error('passSink.write after close');
      if (fd === null) fd = fs.openSync(file, 'w');
      const view = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
      fs.writeSync(fd, view);
      bytes += samples.byteLength;
    },
    close() {
      if (closed) return { file, bytes, written: fd !== null };
      closed = true;
      if (fd !== null) { fs.closeSync(fd); fd = null; }
      return { file, bytes, written: bytes > 0 };
    },
    abort() {
      closed = true;
      if (fd !== null) { fs.closeSync(fd); fd = null; }
      try { fs.rmSync(file, { force: true }); } catch { /* nothing to remove */ }
      return { file, bytes, written: false };
    },
    bytes: () => bytes,
  };
}

/**
 * THE STATE MACHINE. One contiguous pass, from where it started, until something
 * ends it.
 *
 * @param {object} o
 * @param {{write(samples: Float32Array): void, close(): object, abort(): object}} o.sink
 *        where the captured audio goes, as it arrives.
 * @param {(on: boolean) => unknown} [o.hold]
 *        SUSPEND AND RESTORE AUTOPLAY-NEXT. `src/main/autonav.js`'s
 *        `holdSuppress`, which drives the page's own toggle. Called with `true`
 *        exactly once when a pass opens and with `false` exactly once when it
 *        closes — ON EVERY PATH INCLUDING `abort()`, which is the path this
 *        obligation is normally shipped dead on (issue #7).
 * @param {(payload: object) => void} [o.report]
 */
export function createPass({ sink, hold, report } = {}) {
  /**
   * THE HAND-OFF QUEUE, AND IT IS NEVER ALLOWED TO GROW. A chunk goes in and
   * comes straight back out into the sink, so `retained()` is 0 between calls
   * however long the recording runs. Issue #7 asks for the number of buffers
   * RETAINED at 10 s and at 60 s and requires it constant — a count, never a
   * memory reading, because a memory reading measures the machine.
   */
  const holding = [];
  let open = false;
  let endedBy = null;
  let frames = 0;
  let drops = 0;
  let chunks = 0;
  let refused = 0;
  let held = false;
  let closedFile = null;
  const stats = { starts: 0, ends: 0, aborts: 0, refusals: [] };

  const say = (payload) => { if (typeof report === 'function') report(payload); };

  /** A REFUSAL IS NAMED AND COUNTED, never a silent early return. */
  function refuse(code) {
    refused++;
    stats.refusals.push(code);
    say({ recording: false, refused: code, endedBy, frames, drops });
    return code;
  }

  function setHold(on) {
    if (on === held || typeof hold !== 'function') { held = on; return; }
    held = on;
    hold(on);
  }

  const api = {
    stats,
    /**
     * ENTRY POINT: the user armed a live export.
     * @returns {null|string} null if the pass opened, a refusal code otherwise
     */
    start() {
      if (open) return refuse('already-recording');
      if (endedBy !== null) return refuse('pass-already-ended');
      if (!sink || typeof sink.write !== 'function') return refuse('no-sink');
      open = true;
      stats.starts++;
      // THE SUSPEND GOES ON BEFORE THE FIRST FRAME, not after it. Autoplay-next
      // firing between "recording" and "suspended" is the next video in this
      // file, which is the whole reason the obligation exists.
      setHold(true);
      say({ recording: true, endedBy: null, frames: 0, drops: 0 });
      return null;
    },
    /**
     * ENTRY POINT: separated audio arrived. Interleaved 32-bit float, and the
     * frame count is the caller's to state — the plane layout is the unit's
     * (`(k*2 + ch) * SEGMENT + i`) and arithmetic over it here would be a second
     * copy of a layout that is not ours.
     *
     * @param {{samples: Float32Array, frames: number}} c
     * @returns {null|string}
     */
    chunk(c) {
      if (!open) return refuse('not-recording');
      const o = c && typeof c === 'object' ? c : {};
      if (!(o.samples instanceof Float32Array) || !(o.frames > 0)) return refuse('unreadable-chunk');
      holding.push(o.samples);
      // STRAIGHT BACK OUT. `shift()` before the write, so a throwing sink cannot
      // leave the buffer in the queue and make `retained()` grow on the failure
      // path — which would report the accumulation this line exists to prevent.
      const out = holding.shift();
      try {
        sink.write(out);
      } catch {
        // A WRITE THAT THREW IS NOT ONE OF THE FOUR MEMBERS. The pass did not
        // end for a reason a user is told about — it failed, and what is on disk
        // is not a shorter recording, it is half of one.
        api.abort('write-failed');
        return 'write-failed';
      }
      frames += o.frames;
      chunks++;
      return null;
    },
    /**
     * ENTRY POINT: the engine could not keep up and a chunk went out
     * unseparated. RULING 29 — a drop is a BOUNDARY, so this ENDS the pass. The
     * count is kept because it is what the unit's note tells the user.
     */
    drop(n = 1) {
      drops += Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
      return api.end('drop');
    },
    /**
     * ENTRY POINT: the transport saw something. `passEndFor` decides whether it
     * is a boundary; a state that is not one is not a call.
     * @returns {null|string} the member that ended the pass, or null
     */
    observe(state) {
      if (!open) return null;
      const reason = passEndFor(state);
      if (reason === null) return null;
      api.end(reason);
      return reason;
    },
    /**
     * THE ONE EXIT. FIRST WRITER WINS — mirroring the unit's `endPass()`, and for
     * the reason it gives: a drop is followed by the stop() that tears the
     * recording down, and a last-writer-wins record would report every drop as
     * the user's own stop. The two are different facts to whoever is holding a
     * file shorter than they expected.
     *
     * @param {'stopped'|'ended'|'seek'|'drop'} reason  a `PASS_END` member
     * @returns {null|string} null when this call was the one that ended it
     */
    end(reason) {
      if (!open) return refuse(endedBy === null ? 'not-recording' : 'already-ended');
      if (!PASS_END_NAMES.includes(reason)) return refuse('unnamed-reason');
      open = false;
      endedBy = reason;
      stats.ends++;
      closedFile = sink && typeof sink.close === 'function' ? sink.close() : null;
      // RESTORED HERE AND IN `abort()`, both. Neither path may leave the page's
      // own preference standing on the value this recording imposed.
      setHold(false);
      say({ recording: false, endedBy, frames, drops, file: closedFile });
      return null;
    },
    /**
     * NOT A PASS END. Nothing here is deliverable and nothing is written: the
     * partial file is removed, so a half-recording can never be mistaken for a
     * short one.
     *
     * IT STILL RESTORES AUTOPLAY-NEXT. This is the path the obligation is
     * shipped dead on — the recording that did not finish is exactly the one
     * whose cleanup nobody drives — and `tools/suites/transport.mjs` §4b and
     * §5.10 both watch it.
     */
    abort(why = 'aborted') {
      // A PASS THAT ALREADY ENDED IS NOT ABORTABLE. `end()` closed the file and
      // said what it was; `abort()` UNLINKS, so letting it run afterwards would
      // delete a delivered recording on the teardown that follows every stop.
      if (!open && endedBy !== null) return refuse('already-ended');
      stats.aborts++;
      open = false;
      closedFile = sink && typeof sink.abort === 'function' ? sink.abort() : null;
      setHold(false);
      say({ recording: false, aborted: why, endedBy, frames, drops });
      return why;
    },
    /** WHAT THE UNIT'S PURE FUNCTIONS TAKE, and the only thing this file hands on. */
    record: () => ({ frames, drops, endedBy }),
    recording: () => open,
    retained: () => holding.length,
    chunks: () => chunks,
    refusals: () => refused,
    holding: () => held,
    file: () => closedFile,
  };
  return api;
}
