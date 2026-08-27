/**
 * THE DECK'S HOST, AS AN ELECTRON DESKTOP APP — `stem-workbench`'s answer to the
 * hole `ui/embed.js` imports.
 *
 * THIS FILE IS NOT THE UNIT. It sits at a unit path because the unit imports it
 * by path (`import { host } from './host.js'`), and `extension/unit.json`
 * declares it a HOLE for exactly that reason: it is not in `unit.sha256`, it
 * never was, and `vendor/.pin`'s `ours` array names it so that "did somebody
 * edit the unit" and "did somebody edit our Host" stay two separately answerable
 * questions. The reference implementation this replaces — the Chrome extension's
 * — is at `extension/ui/host.js` in `stem-splitter-live` at v0.2.0, and reading
 * the two side by side is the fastest way to see what a Host is.
 *
 * The duties, and the rules they have to hold, are `../shared/host.js`. That
 * file is the unit's and is byte-identical to the tag; every sentence quoted
 * below is from it.
 *
 * ===========================================================================
 * THREE WIRES LEAVE THROUGH HERE, AND THEY ARE NOT THE SAME WIRE
 * ===========================================================================
 *
 *  1. `send` / `onMessage` ride the UNIT'S BUS — one router in the main process
 *     over `ipcMain`/`ipcRenderer` (`src/main/bus.js`, HOST-DESIGN.md §4). The
 *     envelope on it is the UNIT's (`{ v, to, from }`) and this file carries it
 *     verbatim, in both directions. Nothing here stamps, rewrites, normalises or
 *     filters it — rule 1, and the deck's two correspondents (`BUS.engine` and
 *     `BUS.host`) are addresses on that bus rather than two transports.
 *
 *  2. `page` / `transport` ride the HOST'S OWN deck<->main channel (`'page'`,
 *     `src/main/transport.js`), which reaches the source view's preload one hop
 *     further on. That protocol is entirely the Host's, so this file is free to
 *     name its own fields and does: `{c: …}` out, `{t: …}` in.
 *
 *  3. `storageGet` / `storageSet` / `onStorageChanged` / `armShortcut` are not a
 *     wire to another context at all. They read and write state that main OWNS —
 *     two storage areas with two lifetimes (`src/main/storage.js`) and the
 *     application menu's accelerator — and have no other end to talk to.
 *
 * ===========================================================================
 * EVERY DUTY IS A PLAIN FUNCTION THAT RESOLVES THE BRIDGE WHEN IT IS CALLED
 * ===========================================================================
 *
 * Two rules of the seam meet in that sentence, and `shared/host.js` names this
 * Host as the one both were written against.
 *
 * A DUTY MAY BE CALLED UNBOUND, and one already is: `offscreen/engine.js` hands
 * `host.assetUrl` ITSELF to `MasterBus` and to every deck. The deck's half has
 * no such site today, but the refusal in `assertHost` is one check for both
 * lists, and the failure it describes is precisely ours — *"an Electron preload
 * bridge wrapped one level too deep hands over `{ send: fn }`"*, and *"a duty
 * implemented as a method that needs its `this` — an Electron preload bridge —
 * passes this check … and fails only at the first worklet load"*. So: every
 * duty below is an ARROW FUNCTION that closes over module scope and reads no
 * `this`, and this module never re-exports the preload bridge object.
 *
 * THE TRANSPORT IS RESOLVED AT CALL TIME, NEVER AT IMPORT — rule 2. `bridge()`
 * runs inside each duty. Under the extension that rule exists because
 * `tools/embed-smoke.mjs` replaces `chrome.runtime.sendMessage` after boot and
 * that patch is its only window onto the outgoing wire; here it is what lets
 * `tools/suites/deck-host.mjs` swap `window.__wbDeck.send` after the deck has
 * booted and actually see traffic. Write `const send = window.__wbDeck.send`
 * here and that recorder stays empty for the rest of the run, taking every
 * assertion over it green-on-nothing.
 *
 * ===========================================================================
 * WHAT THIS HOST ANSWERS DIFFERENTLY FROM THE EXTENSION, AND WHY
 * ===========================================================================
 *
 * `armShortcut()` — the extension READS a binding the user controls at
 *   chrome://extensions/shortcuts. We OWN the binding, so the honest answer is
 *   our own menu accelerator; it is read back out of the INSTALLED menu at call
 *   time rather than from the constant it was built from, because a chord
 *   reported and not bound is worse than no chord at all. HOST-DESIGN.md §6.3.
 *
 * `transport` — the extension asks `window.parent !== window`, which is a fact
 *   about FRAMES. Here the deck is a top-level document and is still hosted, so
 *   the question is asked of the Host instead: main answers `hosted` when the
 *   preload starts, and it is a boolean or this module refuses to load. A Host
 *   that guessed would be guessing about the branch `follow()` reads as licence
 *   to START THE PIPELINE ON BOOT.
 *
 * ===========================================================================
 * L1 — CAPTURE ONLY WHAT THE USER'S OWN PLAYER RENDERS
 * ===========================================================================
 * This file names `muted`, `currentTime` and `playbackRate` and no other
 * property of any media element, reads no URL, and touches no byte of media.
 * `drive`'s write set is closed HERE as well as in `src/main/transport.js` and
 * again in the source view's preload — three layers, deliberately, because L1 is
 * a security property and this channel reaches a `<video>` on somebody else's
 * page.
 */

import { BUS } from '../shared/host.js';

/**
 * This context's address on the bus, READ OUT OF THE SEAM'S OWN DECLARATION
 * rather than typed as `'ui'`. `shared/host.js` put the address set there at
 * interface v1 precisely so a second Host would not have to guess what
 * "addressed to me" means.
 */
const ME = BUS.deck;

/**
 * The preload's bridge (`src/preload/deck.cjs`). One name, spelled once.
 *
 * `globalThis.window` and not a bare `window`, so this module can be driven from
 * Node with a stubbed global — the same discipline the extension's `ui/host.js`
 * applies to `window.parent`, and what makes the conformance suite able to drive
 * the SHIPPED module instead of reimplementing it.
 */
const BRIDGE = '__wbDeck';

/**
 * ANNOUNCED ONCE, AND NEVER THROWN — the shape `offscreen/host.js` settled on
 * for the engine, held here for the same reason and one harder one.
 *
 * A deck renderer created without `src/preload/deck.cjs` is a misconfiguration,
 * not a user error, and every duty this Host owes is undeliverable from that
 * moment. The instinct is to throw at the first call. It is wrong, and the
 * vendored gate is what proves it: `test.js`'s `group('host')` calls
 * `deckHost.send(...)`, `deckHost.page.close()` and `await
 * deckHost.storageGet(...)` as BARE STATEMENTS, with no try around them — so a
 * throw does not produce a red, it CRASHES the group and every assertion after
 * it never runs. The engine slice measured that: 482 assertions in, a stack
 * trace instead of a conformance report.
 *
 * So a missing bridge is: ONE `console.error` naming the file, and then the
 * inert answer for each duty. That is not the silent failure `shared/host.js`
 * warns about — the sentence is on the console, once, at the first duty that
 * needed it — and it is what lets the unit's own conformance group say which
 * duties are wrong instead of dying at the first one.
 */
let announcedMissingBridge = false;
function noBridge(duty) {
  if (announcedMissingBridge) return undefined;
  announcedMissingBridge = true;
  console.error(`[wb deck-host] window.${BRIDGE} is absent, so ${duty}() has nowhere to go. `
    + 'The deck renderer was created without src/preload/deck.cjs, or the preload threw, or '
    + 'src/main/deck-host.js was not installed before the view was loaded. Every duty this Host '
    + 'owes is undeliverable until that is fixed.');
  return undefined;
}

/**
 * The bridge an absent bridge stands in for. Every member answers the way its
 * duty must answer when there is nothing behind it:
 *
 *   storageGet   `{ok: true, value: null}` — which the duty turns into `null`.
 *     RESOLVING RATHER THAN REJECTING IS THE CRASH-VS-RED TRADE ABOVE, and it is
 *     the one place it costs something: rule 6 says a read that FAILED must
 *     reject, and this one cannot without taking the group down at a bare
 *     `await`. The distinction is not lost — it is asserted, with a real bridge,
 *     in `tools/suites/deck-seam.mjs`, which is where the production case lives.
 *   armShortcut  `null` — "nothing is bound", which the deck already prints a
 *     sentence for.
 *   everything else does nothing, having said so.
 */
const INERT = {
  hosted: null,
  send: () => noBridge('send'),
  onMessage: () => noBridge('onMessage'),
  storageGet: () => { noBridge('storageGet'); return Promise.resolve({ ok: true, value: null }); },
  storageSet: () => noBridge('storageSet'),
  storageWatch: () => noBridge('storageWatch'),
  onStorageChanged: () => noBridge('onStorageChanged'),
  armShortcut: () => { noBridge('armShortcut'); return Promise.resolve(null); },
  pageSend: () => noBridge('pageSend'),
  onPageEvent: () => noBridge('onPageEvent'),
};

const bridge = () => {
  const w = globalThis.window;
  return (w && w[BRIDGE]) || INERT;
};

/**
 * IS THERE A PLAYER ABOVE THIS DECK — asked ONCE, at import, because
 * `ui/embed.js` reads `host.transport != null` at module scope and boots
 * differently on the answer.
 *
 * ===========================================================================
 * IMPORTING THIS MODULE IS INERT. ONLY CALLING A DUTY CAN FAIL.
 * ===========================================================================
 * This constant used to THROW when the bridge was missing, on the argument that
 * a Host with no transport is worse than no Host at all. It is still worse — but
 * throwing HERE is the wrong place to say so, and the vendored gate is what
 * proved it: `test.js`'s `group('host')` imports this module under plain Node to
 * report on it, and a module-scope throw does not produce a red, it CRASHES the
 * suite. Measured by the engine slice: the run died at `test.js:5577` after 482
 * assertions and every assertion after it never executed. A crash is strictly
 * worse than a failure — it hides the reds we want to read, and it looks like a
 * broken vendored copy rather than an unimplemented duty.
 *
 * So the rule this file now holds, and the engine's hole holds the same one:
 * NOTHING AT MODULE SCOPE TOUCHES A BROWSER-ONLY GLOBAL IN A WAY THAT CAN THROW.
 * `bridge()` is called from inside each duty; the only thing read here is
 * whether a bridge happens to be present, and reading it cannot fail.
 *
 * ===========================================================================
 * ...AND "I COULD NOT ASK" IS ITS OWN ANSWER, WHICH IS NOT `null`
 * ===========================================================================
 * Three states, not two, and the third is the one that matters:
 *
 *   true   `main` said a Live source is bound to this deck. `transport` is the
 *          six duties.
 *   false  `main` said there is none — a deck opened with no player above it at
 *          all. `transport` is `null`, which is a sentence the deck acts on.
 *
 *          NOT A FILE SOURCE. An earlier version of this comment listed one
 *          here, and `docs/HOST-DESIGN.md` §3.3 said the same, and both were
 *          wrong — see §3.3b. A File source has a player: the engine's own
 *          playback clock. It gets a REAL six-duty transport over that clock,
 *          and answering `null` for it walks straight into the paragraph
 *          below. `sourceKind` is the question "what kind of thing is
 *          playing"; `hosted` is "is there a player at all". A File source
 *          separates them, which is why they are two fields.
 *   null   THERE WAS NO BRIDGE TO ASK, or it answered with something that is not
 *          a boolean. `transport` is a namespace whose every duty THROWS.
 *
 * The third case must not collapse into the second, and `follow()` is why: with
 * `transport: null` the deck concludes nobody will ever tell it whether the
 * video is playing, and treats that as licence to START THE PIPELINE ON BOOT —
 * a capture, and behind it a 109 MB model download, on a page nobody pressed
 * play on. `shared/host.js` records that this repository has already paid for
 * that outcome once. A refusing transport is the safe direction: the deck waits
 * to be told about a player, is told nothing, does nothing — and the first
 * gesture that reaches for the player fails with a sentence naming the preload
 * instead of failing silently.
 */
const HOSTED = (() => {
  const w = globalThis.window;
  const b = w && w[BRIDGE];
  if (!b) return null;
  return typeof b.hosted === 'boolean' ? b.hosted : null;
})();

/**
 * WHICH KIND OF SOURCE THIS DECK IS BOUND TO — the same three states as
 * `HOSTED`, for the same reason, and the third is again the one that matters:
 *
 *   'live'  the audio arrives in real time and something else owns the clock.
 *   'file'  the whole signal is on disk; the deck owns the clock.
 *   null    THERE WAS NO BRIDGE TO ASK, or it answered with something outside
 *           the closed set. A surface must render this as "not known yet",
 *           never as either kind.
 *
 * REFUSED, NOT COERCED, and not defaulted to `'live'`. A default here would be
 * this module inventing a Source kind on a boot where the preload did not run —
 * and a File source rendered as live is a surface offering engine-speed export
 * for something that cannot do it.
 *
 * `src/main/deck-host.js` refuses a value outside the set too, at install. That
 * is not redundant, and it is the argument the storage areas below already make:
 * this check gives the DECK a defined answer with no ipc round trip, and main's
 * stops any other caller in that process putting an undecided kind on the wire.
 */
const SOURCE_KINDS = ['live', 'file'];
const SOURCE_KIND = (() => {
  const w = globalThis.window;
  const b = w && w[BRIDGE];
  if (!b) return null;
  return SOURCE_KINDS.includes(b.sourceKind) ? b.sourceKind : null;
})();

/**
 * THE ONLY TWO AREAS THIS HOST WILL INDEX, and refusing a third is a rule of the
 * seam rather than type theatre.
 *
 * `shared/host.js` rule 5: the areas are a LIFETIME the deck names and the Host
 * honours, never a default — `'local'` outlives the app and `'session'` does
 * not, and the deck's two uses are one of each on purpose. A Host that
 * substituted an area it did have would be inventing a lifetime the deck never
 * asked for, and picking which of two mistakes to make: a preference that does
 * not survive a restart, or a stale arm refusal painted as current.
 *
 * The refusals differ in SHAPE, and that difference is also the seam's:
 * `storageGet` REJECTS, because the deck's preferences read is a module-scope
 * `.then().catch()` that a synchronous throw would jump straight past, taking
 * the rest of boot with it; `storageSet` and `onStorageChanged` THROW at the
 * call site, because a wrong area there is the deck being wrong about a value it
 * wrote itself and the cheapest place to be told is the line that wrote it.
 *
 * `src/main/storage.js` refuses a third area too. That is not redundant: this
 * check is what gives the DECK a defined answer without an ipc round trip, and
 * main's is what stops any other caller in the main process reaching a lifetime
 * that does not exist.
 */
const AREAS = ['local', 'session'];

const assertArea = (area) => {
  if (!AREAS.includes(area)) {
    throw new Error(`DeckHost: ${JSON.stringify(area)} is not a storage area this unit uses `
      + `- it names one of ${AREAS.join(', ')}, and a lifetime it did not ask for is not the Host's to pick.`);
  }
  return area;
};

/**
 * Register an inbound handler for one `{t: …}` type on the deck<->main channel.
 *
 * ONE HANDLER PER TYPE, exactly as the extension's iframe protocol has: the deck
 * registers each once as it boots, and a type nobody registered is dropped —
 * which is already what happens to anything arriving before the deck's own
 * listeners are up.
 */
const inbound = new Map();
let pageWired = false;

const on = (type) => (fn) => {
  inbound.set(type, fn);
  if (pageWired) return;
  pageWired = true;
  bridge().onPageEvent((msg) => {
    if (!msg || typeof msg.t !== 'string') return;
    const h = inbound.get(msg.t);
    if (h) h(msg);
  });
};

/** @type {import('../shared/host.js').DeckHost} */
export const host = {
  /**
   * `'live' | 'file' | null` — what kind of Source is bound to this deck, or
   * `null` for "could not ask". NOT a duty: `DECK_HOST_DUTIES` is frozen at
   * v0.2.0 and this is a fact the Host offers, not a call the unit makes. It is
   * read by the Host's own surfaces today; the deck gains a reader when the
   * File-source transport lands (issue #5).
   */
  sourceKind: SOURCE_KIND,

  /**
   * ONE FINISHED MESSAGE, PUT ON THE BUS UNTOUCHED.
   *
   * Freeze item 5's asymmetry, and it is deliberate rather than an oversight:
   * `EngineHost.send` STAMPS `{v:1, to:'ui', from:'off'}` because the engine has
   * exactly one correspondent and 22 call sites that end `return send({…})`;
   * `DeckHost.send` carries a finished envelope because the deck has TWO
   * correspondents and a stamping deck `send` would need the address passed in —
   * which is the envelope crossing the seam by another route, and would put the
   * Host in a position to normalise what it stamps. One Host, two functions.
   *
   * So this is one line and it must stay one line. `main` reads `msg.to` to
   * route and reads nothing else.
   *
   * RETURNS UNDEFINED, so no call site can start awaiting delivery, and
   * delivery failure is not reported: on this bus there is frequently no
   * listener at all (the deck's own boot poll is written for exactly that), and
   * `src/main/bus.js` drops and COUNTS such a message rather than throwing —
   * which is where "the deck is blank" gets a number attached to it.
   */
  send: (msg) => { bridge().send(msg); },

  /**
   * THE ADDRESS GUARD IS THE HOST'S — rule 4 — and it is here even though
   * `main` already routes by address, because the rule is about what the DECK
   * can rely on and not about what our particular router happens to do. A Host
   * whose transport became a broadcast tomorrow would otherwise start handing
   * the deck the engine's traffic with nothing in this file to stop it.
   *
   * THE RAW ENVELOPE IS HANDED OVER — normalising, re-wrapping or filtering it
   * breaks receivers quietly. And what `fn` returns is DROPPED: MV3's
   * "I will call sendResponse later" has no analogue here, so nothing can hold a
   * channel open by accident, and the deck's return value must not start
   * meaning something the day one appears.
   */
  onMessage: (fn) => {
    bridge().onMessage((m) => { if (m && m.to === ME) fn(m); });
  },

  /**
   * READ ONE VALUE BACK, FROM THE AREA WHOSE LIFETIME THE DECK NAMED.
   *
   * ABSENT RESOLVES `null`; A FAILED READ REJECTS — rule 6, and the two must not
   * be folded together. A fresh profile holds no preferences and that is the
   * ordinary case, not a fault; storage that could not be READ is a fault, and a
   * Host that answered `null` for it would tell the deck "the user has no
   * preferences" on precisely the run where it could not tell. The deck applies
   * its defaults on `null`, so folding them would apply defaults most
   * confidently on the one run where the user's real choices existed and were
   * unreachable.
   *
   * `async`, SO A BAD AREA IS A REJECTION AND NOT A THROW. See the note on
   * `AREAS`: this is the one duty whose refusal must not reach the call site as
   * a throw.
   *
   * THE UNWRAP IS THE DUTY. main answers `{ok, value}` / `{ok:false, error}`
   * rather than a bare value, because "the read failed" has to survive an ipc
   * hop that flattens a rejection into nothing.
   */
  storageGet: async (area, key) => {
    assertArea(area);
    const r = await bridge().storageGet(area, key);
    if (!r || r.ok !== true) {
      throw new Error(`DeckHost: ${area}/${key} could not be read - ${(r && r.error) || 'the Host gave no answer'}`);
    }
    return r.value === undefined ? null : r.value;
  },

  /**
   * FIRE AND FORGET, exactly like `send` and for the same reason: the one caller
   * is a checkbox and a picker whose truth is already on screen, and there is
   * nothing a rejected write could tell the user that the next read would not
   * tell them better. Returns undefined so no call site can start awaiting it.
   *
   * A WRITE THAT FAILED AND AN AREA THAT WAS NEVER ASKED FOR ARE NOT THE SAME
   * THING: the first is the platform having a bad day and is swallowed in main,
   * the second is this call site being wrong about a value it wrote itself and
   * throws here, at the line that wrote it.
   */
  storageSet: (area, key, value) => {
    assertArea(area);
    bridge().storageSet(area, key, value);
  },

  /**
   * IT IS NOT SUGAR OVER `storageGet`. The deck is not the only writer of what
   * it reads: `src/main/deck-host.js` watches the same `PREFS_KEY` to drive
   * YouTube's autoplay-next toggle, and a second deck would be another writer
   * still — so a deck that read only at boot would sit there disagreeing with
   * the behaviour the user is watching.
   *
   * THE AREA AND KEY FILTER IS THE HOST'S, exactly as the address guard on
   * `onMessage` is: main delivers changes in whatever batched shape it likes and
   * unpicking that shape is transport work.
   *
   * `assertArea` UP FRONT, not inside the filter: a listener registered for an
   * area that can never report is a subscription that silently covers nothing —
   * the change-feed spelling of the same green-on-nothing shape rule 6 is about.
   *
   * `fn` IS CALLED WITH THE NEW VALUE, and with `undefined` when the key was
   * removed, which the deck's `applyPrefs` already treats as "no preferences
   * stored".
   */
  onStorageChanged: (area, key, fn) => {
    assertArea(area);
    bridge().storageWatch(area, key);
    bridge().onStorageChanged((ch) => {
      if (!ch || ch.area !== area || ch.key !== key) return;
      fn(ch.value);
    });
  },

  /**
   * THE ARM CHORD, READ FROM THE PLATFORM WE ARE.
   *
   * The extension reads a binding the USER controls and answers in Chrome's
   * spelling. This Host owns the binding, so "reading a platform's answer"
   * becomes "answering for a platform we are" — and the honest version of that
   * is to read the INSTALLED application menu back, at call time, rather than to
   * quote the constant the menu was built from. A menu item whose accelerator
   * could not be taken is a real outcome, and `null` is the branch the deck
   * already has for it: it prints a different sentence instead of an empty key
   * cap.
   *
   * RAW, NOT RENDERED — rule 7. `chordLabel()` in `ui/embed-state.js` turns an
   * accelerator into the pair of strings a surface DRAWS and ANNOUNCES, and that
   * judgement has been wrong here once already: a chord drawn in words was
   * announced as a graphic on every non-Mac machine, suppressing text a screen
   * reader could read. A Host that returned the rendered pair would be a second
   * copy of that judgement per Host, outside the gate that caught it.
   *
   * AND RAW IS NOT ARBITRARY. `chordLabel`'s vocabulary is `MacCtrl`, `Ctrl`,
   * `Command`, `Alt`, `Shift` and the four glyphs; anything else is drawn on the
   * key cap VERBATIM. Electron's own portable spelling would therefore put the
   * word "CommandOrControl" in front of the user, on a surface where nothing
   * goes red because it renders perfectly. `src/main/keys.js` holds the table
   * and `chordIsSpellable()`; main refuses to answer with a token outside it.
   *
   * IT RESOLVES AND DOES NOT REJECT. The extension's rejection means "there is
   * no command table on this platform at all", which is a real fact there and
   * cannot be one here: we always have a menu, so the only two answers are a
   * chord and `null`.
   */
  armShortcut: async () => {
    const accel = await bridge().armShortcut();
    return typeof accel === 'string' && accel !== '' ? accel : null;
  },

  /**
   * THE PLAYER, or `null` when this Host has none — SPELLED, never omitted.
   *
   * `host.transport != null` is the single question that decides whether this
   * deck is hosted, so the key is required and the value may be null:
   * `assertHostOption` refuses a Host that simply never mentioned a transport,
   * because a Host that MEANT to supply one and misspelled the key must not read
   * as a Host that deliberately has none.
   *
   * Under this Host `HOSTED` is a Live source — the YouTube view above the deck.
   * A File source (step 4 of the plan) makes the deck the transport master and
   * this becomes `null` for a different and equally deliberate reason.
   */
  transport: HOSTED === false ? null : {
    /**
     * PUSH, NEVER POLL — a contract, not a taste. The deck follows transitions,
     * and a poll misses every one that opens and closes between two samples.
     * The payload is the source view preload's, relayed by
     * `src/main/transport.js`: `{playing, currentTime, duration, ended,
     * playbackRate, hasMedia, adShowing, seeking}`.
     */
    onState: on('video'),
    onJump: on('jump'),
    onSpeedReport: on('speed'),

    /**
     * THE WRITE SET IS CLOSED HERE, AT THE SEAM, and closing it by NAMING the
     * three fields rather than by spreading the caller's object is the point:
     * spreading would make the write set whatever a call site happened to pass,
     * and widening it would then be invisible in review.
     *
     * ADR 0001 decision 4 fixes it at `muted`, `currentTime`, `playbackRate`.
     * `src/main/transport.js` filters again and the preload writes only those
     * three (plus `preservesPitch`, which is the key-lock policy that must land
     * on the same write as the rate). Three layers is right here: L1 is a
     * security property and this channel reaches a `<video>` on somebody else's
     * page.
     */
    drive: (patch) => {
      const p = patch && typeof patch === 'object' ? patch : {};
      const cmd = { c: 'drive' };
      if (typeof p.muted === 'boolean') cmd.muted = p.muted;
      if (typeof p.playbackRate === 'number' && Number.isFinite(p.playbackRate)) cmd.playbackRate = p.playbackRate;
      if (typeof p.currentTime === 'number' && Number.isFinite(p.currentTime)) cmd.currentTime = p.currentTime;
      bridge().pageSend(cmd);
    },

    /**
     * HAND THE PLAYER BACK THE WAY IT WAS FOUND. A muted 1.02x video left behind
     * is a bug the user cannot explain and cannot undo, so a Host that drives
     * must be able to undo it.
     *
     * NOTE WHICH MUTE THIS IS. `webContents.setAudioMuted(true)` on the source
     * view is the product's silence guarantee and holds for that view's whole
     * life; `drive({muted})` is the unit's clock lock on the ELEMENT, for the
     * cached deck. `release()` restores only the second, and must not touch the
     * first — the user must never hear the raw view.
     */
    release: () => { bridge().pageSend({ c: 'release' }); },

    /**
     * THE USER'S SPEED, which is not `drive({playbackRate})` and must not be
     * folded into it: it is a CLAIM with its own lifetime, re-asserted across an
     * ad and dropped on a source swap, while a drive correction is a single
     * value with its own dedupe against a 4 Hz loop.
     *
     * THE VALUE IS NOT FILTERED HERE, unlike `drive`'s. A rate the Host cannot
     * apply is refused and REPORTED back through `onSpeedReport` — which is
     * strictly better than a silent drop, and is why `resolveSpeed` in the
     * vendored `speed.js` is the one gate on the range.
     */
    requestSpeed: (rate) => { bridge().pageSend({ c: 'requestSpeed', rate }); },
  },

  /**
   * WHERE THE DECK IS DRAWN. Always present, even for a Host with no player at
   * all: a deck still has to size itself and take its keys, which is why `page`
   * and `transport` are two namespaces and not one.
   */
  page: {
    /**
     * A KEY THE HOST TOOK OUT OF ITS OWN PAGE'S HANDS. The source view's preload
     * decides — it is the only context that can see which element has focus, and
     * `typing` is deliberately not carried on this message because the host
     * already checked its own document, which is the only one that had a focus
     * target.
     */
    onKey: on('key'),
    /** The Host's report on suppressing its page's autoplay-next. Advisory. */
    onAutonav: on('autonav'),

    /**
     * WHICH KEY CODES ARE THE DECK'S RIGHT NOW, and whether a deck is armed at
     * all. THE HOST MUST ACT ON IT: with no deck armed, `1`-`6` belong to
     * YouTube and must reach it untouched — we are a guest there. The list is
     * sent rather than duplicated host-side, because it is the unit that knows
     * which keys this build has.
     */
    claimKeys: (claim) => {
      const c = claim && typeof claim === 'object' ? claim : {};
      bridge().pageSend({ c: 'claimKeys', armed: c.armed === true, keys: Array.isArray(c.keys) ? c.keys : [] });
    },

    /** How tall the deck has measured itself to be. Advice: main clamps it. */
    setHeight: (px) => { bridge().pageSend({ c: 'height', px }); },

    /**
     * THE DECK HAS ITS HANDLERS UP, and the Host owes a RE-SEND of everything it
     * reports on change — player state, speed, autoplay — because a deck mounted
     * onto an already-playing video is the common case and "on change" would
     * leave it blank until something moved.
     */
    ready: () => { bridge().pageSend({ c: 'ready' }); },

    /**
     * TAKE THE DECK OFF THE PAGE. THE AUDIO DOES NOT STOP: capture and
     * separation live in the engine, which is a different process here, so what
     * the extension keeps by convention this Host keeps structurally — hiding a
     * view cannot reach it.
     */
    close: () => { bridge().pageSend({ c: 'close' }); },
  },
};
