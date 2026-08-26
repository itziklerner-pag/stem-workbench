/**
 * THE DECK'S HOST, MAIN-PROCESS HALF — everything the hole module
 * (`vendor/…/extension/ui/host.js`) reaches for, and the three messages this
 * Host owes the deck that `assertHost` structurally cannot check.
 *
 * The hole module is the deck's fourteen members. This file is what is on the
 * other end of them, plus the parts of the seam that are not duties at all:
 *
 *   THE DUTIES' OTHER END        storage (two lifetimes), the arm accelerator,
 *                                the `'page'` channel that carries `page` and
 *                                `transport`, and the `hosted` answer the
 *                                preload asks for SYNCHRONOUSLY, before the
 *                                deck's first line runs
 *   MESSAGES WE ORIGINATE        SESSION, ARM_ERROR, ARM_ERROR_CLEARED
 *   MESSAGES WE MUST ANSWER      the deck's six `SW_*`, which nothing in
 *                                `shared/host.js` or `VENDORING.md` lists —
 *                                HOST-DESIGN.md §5.3, finding F1
 *   THE AUTOPLAY-NEXT WIRE       `prefs.autoplayNext`, a shared storage key
 *                                doing the work of a deck -> host instruction
 *                                (freeze item 8)
 *
 * ===========================================================================
 * WHAT A HOST STILL SHIPS DEAD IF IT ONLY IMPLEMENTS THE DUTIES
 * ===========================================================================
 * `docs/VENDORING.md`, "What your Host owes the unit", names four things that
 * are not duties. Two of them are this file's:
 *
 *   "You must ORIGINATE four messages. `assertHost` cannot check for a message
 *    nobody sent." — three of the six are the deck's, below.
 *
 *   "You must wire the autoplay-next preference. The deck writes
 *    `prefs.autoplayNext` through `storageSet('local', PREFS_KEY, …)`; nothing
 *    tells your Host to act on it. A Host that implements all six `DeckPage`
 *    duties still ships a dead checkbox."
 *
 * And a third that is nobody's duty and everybody's problem: the deck's own
 * `SW_*` messages. A Host that implements all 32 duties and originates all six
 * messages, but answers no `SW_*`, has a deck that polls twenty times and never
 * paints — and there is nothing in the unit that says so.
 *
 * ===========================================================================
 * WHERE THE PLAYER IS, AND WHY IT IS INJECTED
 * ===========================================================================
 * `src/main/transport.js` owns the source view: its preload, the speed claim and
 * YouTube's autoplay toggle. It is an EVENT SOURCE in `main` — `onState`,
 * `onJump`, `onSpeedReport`, `onKey`, `onAutonav` registrations, and the verbs
 * `drive`, `release`, `requestSpeed`, `claimKeys`, `setPrefs`, `resend` — and it
 * knows nothing about the deck renderer.
 *
 * This file is what turns that object into the six `DeckTransport` duties and
 * the two `DeckPage` duties a player is the source of. The split is what keeps
 * the two slices from having two opinions about one wire, and it is why
 * `transport` is a parameter here rather than an import.
 */
import { ipcMain, Menu } from 'electron';

import { ARM_ERROR_KEY, PREFS_KEY } from '../../vendor/stem-splitter-live/extension/shared/config.js';
import { ARM_CODES as DECK_ARM_CODES } from '../../vendor/stem-splitter-live/extension/ui/audio-math.js';
import { BUS } from '../../vendor/stem-splitter-live/extension/shared/host.js';
import { ARM_ACCEL, chordIsSpellable, deckTakesKey } from './keys.js';

/**
 * The deck <-> main channel that carries `page` and `transport`.
 *
 * NOT `'bus'`, AND THAT IS LOAD-BEARING. `'bus'` carries the UNIT's protocol —
 * `{v, to, from, type}` envelopes that the hole module's `onMessage` hands to
 * the deck's own message handler after a `to === 'ui'` guard — so a `video` or
 * `speed` payload on it would arrive at a handler with no case for it. In the
 * extension these never touched `chrome.runtime` at all: they are
 * `window.postMessage` between `content.js` and the deck's iframe, a separate
 * wire. Keeping them off the bus is what stops Host traffic appearing inside the
 * unit's namespace.
 */
export const PAGE = 'page';

/** The channels this Host's own state travels on. */
export const CH = Object.freeze({
  profile: 'deck:profile',
  get: 'deck:storage:get',
  set: 'deck:storage:set',
  watch: 'deck:storage:watch',
  changed: 'deck:storage:changed',
  armShortcut: 'deck:armShortcut',
});

/** `'A'` is the default deck; the field is omitted rather than sent. */
const DECK_DEFAULT = 'A';
const normalizeDeck = (d) => (typeof d === 'string' && d ? d : DECK_DEFAULT);

/** `DeckPage.setHeight` is ADVICE, and this is the Host clamping it. */
export const DECK_MIN_H = 120;
export const DECK_MAX_H = 900;
export const clampDeckHeight = (px) => Math.max(DECK_MIN_H, Math.min(DECK_MAX_H, Math.round(Number(px) || 0)));

/**
 * THE ARM REFUSALS — the reason `ARM_ERROR` is implemented rather than merely
 * declared.
 *
 * A product with no refusal path ships an `ARM_ERROR` implementation nothing
 * ever exercises, which is the same as not having one: the deck's banner, its
 * dismissal path and the durable record would all be code nobody has seen run.
 * Each entry below is a state this app can really be in.
 *
 * ===========================================================================
 * THE `code` FIELD IS THE UNIT'S VOCABULARY, NOT OURS, AND `shared/host.js`
 * DOES NOT SAY SO
 * ===========================================================================
 * The seam declares `ARM_ERROR { code, message }` and stops there, which reads
 * as "any code you like". It is not: `ui/audio-math.js` holds a SET, and the
 * deck branches on membership at three sites —
 *
 *   · `errorAction(code, false)` returns `'arm'` for a member and `'restart'`
 *     for everything else, and `'restart'` puts a Restart button under a banner
 *     that restarting cannot fix. The unit calls that the QA-16 footgun in its
 *     own comment.
 *   · `paintBanner` hides the dismiss × for a non-member, so the user cannot
 *     put the banner away.
 *   · `case 'ARM_ERROR_CLEARED'` clears the banner ONLY for a member — so a
 *     Host that invents its own code can never retire its own refusal, and the
 *     banner stands until `ARM_ERROR_TTL_MS`.
 *
 * A second Host that spelled `code: 'NO_SOURCE'` would therefore ship an
 * undismissable banner with a button that does nothing, and NOTHING anywhere
 * would go red. So the wire code is drawn from the unit's set, the MESSAGE
 * carries what actually happened, and `assertDeckCode` below refuses at module
 * evaluation if a tag ever drops one of the three we use.
 *
 * WHICH MEMBERS, AND WHY NOT THE OBVIOUS ONES. Five of the eight are tab nouns
 * (`TAB_GONE`, `TAB_BUSY`, `TAB_UNSUPPORTED`, `NO_ACTIVE_TAB`, and
 * `NEEDS_GESTURE` is Chrome's activation rule). The deck PRINTS the code in the
 * banner title — "Separation has no source — TAB_GONE" — so a product with no
 * tabs would be putting a Chrome noun in front of the user to buy behaviour that
 * `ARM_FAILED` buys without one. This is HOST-DESIGN.md finding F4.
 */
const ARM_FAILED = 'ARM_FAILED';

export const ARM_REFUSALS = Object.freeze({
  NO_SOURCE: { code: ARM_FAILED, message: 'There is no page loaded in the source view, so there is nothing to arm.' },
  NOT_ARMED: { code: 'NOT_ARMED', message: 'Nothing is armed yet. Arm this Source first, from the Source menu or the Arm button.' },
  ENGINE_DOWN: { code: ARM_FAILED, message: 'The engine is not running, so a capture could not be opened.' },
});

/**
 * REFUSED AT MODULE EVALUATION, not at the gesture. A code the deck does not
 * know is a banner the user cannot dismiss, and the arm path is the one place a
 * failure must not fail quietly — it is the only thing that tells the user the
 * gesture did not take.
 */
for (const [kind, r] of Object.entries(ARM_REFUSALS)) {
  if (!DECK_ARM_CODES.has(r.code)) {
    throw new Error(`deck-host: the arm refusal ${kind} would be sent as ${r.code}, which is not in the `
      + `deck's ARM_CODES (${[...DECK_ARM_CODES].join(', ')}). The deck would show a banner it cannot `
      + 'dismiss, offer a Restart that cannot help, and ignore ARM_ERROR_CLEARED for it.');
  }
}

/**
 * Every method this Host CALLS on the injected transport, named.
 *
 * REFUSED BY NAME IF ABSENT, AND NEVER DEGRADED TO `transport: null`. Spelling
 * `null` says "this Host has no player", which is a different and load-bearing
 * sentence: the deck reads it as "nobody will ever tell me whether the video is
 * playing", and `follow()` treats that as licence to start a capture — and
 * behind it a 109 MB model download — on a page nobody pressed play on. A
 * half-wired transport is a defect, and the cheapest place to say so is the line
 * that wired it.
 */
export const TRANSPORT_METHODS = Object.freeze([
  'onState', 'onJump', 'onSpeedReport', 'onKey', 'onAutonav',
  'drive', 'release', 'requestSpeed', 'claimKeys', 'setPrefs', 'resend',
]);

/**
 * @param {object} o
 * @param {ReturnType<import('./storage.js').createStorage>} o.storage
 * @param {{originate: Function, onHostMessage: Function}} o.bus
 * @param {() => Electron.WebContents|null} o.deck    read at CALL time, never captured
 * @param {() => Electron.WebContents|null} o.source  the Source the session record describes
 * @param {object|null} o.transport   `src/main/transport.js`'s object, or null for a Host with no player
 * @param {() => Electron.WebContents|null} [o.chrome]  our own bar, for the key relay
 * @param {(px: number) => void} [o.onHeight]  the deck measured itself — already clamped
 * @param {() => void} [o.onClose]             the deck asked to be taken off the page
 * @param {object} [o.engine]  `src/main/engine-messages.js` — captureStart/captureStop/deckPrepare
 * @param {() => Promise<void>|void} [o.ensureEngine]  make the engine window exist
 * @param {boolean} [o.installMenu]  build the application menu (the arm chord lives on it)
 */
export function installDeckHost({
  storage, bus, deck, source, transport, chrome = () => null,
  onHeight = () => {}, onClose = () => {},
  engine = null, ensureEngine = null, installMenu = true,
}) {
  /**
   * THE KEY IS REQUIRED AND THE VALUE MAY BE NULL — `assertHostOption`'s rule,
   * one level out. A caller that simply forgot to mention a transport must not
   * read as a Host that deliberately has none.
   */
  if (transport === undefined) {
    throw new Error('installDeckHost: nothing was said about `transport`. A Host that has none must pass '
      + '`transport: null` - an absent property and a deliberate absence read the same, and the deck '
      + 'boots differently on the answer.');
  }
  if (transport !== null) {
    const missing = TRANSPORT_METHODS.filter((k) => typeof transport[k] !== 'function');
    if (missing.length) {
      throw new Error(`installDeckHost: the injected transport is missing ${missing.length} of `
        + `${TRANSPORT_METHODS.length} methods: ${missing.join(', ')}. It is NOT spelled \`null\` instead - `
        + 'a half-wired transport must fail here rather than ship a deck that looks hosted and is not.');
    }
  }

  const stats = {
    sessions: 0, armErrors: 0, armErrorsCleared: 0, arms: 0, disarms: 0,
    sw: {}, prefs: 0, keysRelayed: 0, storageRefusals: 0,
    fromDeck: {}, toDeck: {}, strangers: 0, heights: [],
  };

  const isDeck = (event) => {
    const wc = deck();
    if (!!wc && !wc.isDestroyed() && event.sender === wc) return true;
    stats.strangers++;
    return false;
  };

  // =========================================================================
  // 1. THE PROFILE — answered SYNCHRONOUSLY, because the deck boots on it
  // =========================================================================
  /**
   * `ui/embed.js` reads `host.transport != null` at MODULE SCOPE. There is no
   * promise the unit would await, so the preload asks with `sendSync` and this
   * is what answers: one boolean, derived from a fact this process already
   * knows — is there a source-view transport wired up at all.
   */
  const onProfile = (event) => { event.returnValue = { hosted: transport !== null }; };
  ipcMain.on(CH.profile, onProfile);

  // =========================================================================
  // 2. STORAGE — the two lifetimes, over three channels
  // =========================================================================
  /**
   * `{ok:true, value}` / `{ok:false, error}`, never a bare value and never a
   * rejection: an ipc rejection reaches the renderer as an Error whose message
   * has been through a string, and "the read failed" then looks exactly like
   * "the key was not there" — which is the one distinction this duty exists to
   * keep (`shared/host.js` rule 6).
   */
  const onGet = (event, area, key) => {
    if (!isDeck(event)) return { ok: false, error: 'this renderer is not the deck' };
    try {
      return { ok: true, value: storage.get(area, key) };
    } catch (err) {
      stats.storageRefusals++;
      return { ok: false, error: String((err && err.message) || err) };
    }
  };

  /**
   * A WRITE THAT FAILED IS SWALLOWED — the value is already on screen, and there
   * is nothing a rejection could tell the user that the next read would not tell
   * them better. AN AREA THAT WAS NEVER ASKED FOR is not swallowed anywhere: the
   * hole module throws at the call site before this channel is used, and one
   * that reached here is logged, because that is a caller being wrong rather
   * than the platform having a bad day.
   */
  const onSet = (event, area, key, value) => {
    if (!isDeck(event)) return;
    try { storage.set(area, key, value); }
    catch (err) { stats.storageRefusals++; console.error('[deck-host] storage set refused', err); }
  };

  /** `area key` the deck has asked to hear about, so main pushes nothing else. */
  const watched = new Set();
  const onWatch = (event, area, key) => {
    if (!isDeck(event)) return;
    const id = `${area} ${key}`;
    if (watched.has(id)) return;
    watched.add(id);
    try {
      storage.onChanged(area, key, (value) => {
        const wc = deck();
        if (wc && !wc.isDestroyed()) wc.send(CH.changed, { area, key, value });
      });
    } catch (err) {
      stats.storageRefusals++;
      watched.delete(id);
      console.error('[deck-host] storage watch refused', err);
    }
  };

  ipcMain.handle(CH.get, onGet);
  ipcMain.on(CH.set, onSet);
  ipcMain.on(CH.watch, onWatch);

  // =========================================================================
  // 3. THE ARM CHORD — read back out of the menu that really took it
  // =========================================================================
  /**
   * `armShortcut()` reports "the accelerator this platform has bound to the arm
   * gesture". We ARE the platform, so the honest answer is read from the
   * INSTALLED menu rather than from the constant it was built from: a menu that
   * was never installed, or an item whose accelerator collided, must answer
   * `null` — the branch the deck already has, which prints a different sentence
   * instead of an empty key cap.
   *
   * AND IT IS REFUSED IF IT IS NOT SPELLABLE. `chordLabel()` draws anything
   * outside its vocabulary VERBATIM on the key cap, so answering in Electron's
   * portable grammar would put the word "CommandOrControl" in front of the user
   * with nothing anywhere going red. `null` beats a chord the deck cannot spell.
   */
  const armAccelerator = () => {
    const menu = Menu.getApplicationMenu();
    const item = menu && menu.getMenuItemById('arm');
    if (!item || typeof item.accelerator !== 'string' || item.accelerator === '') return null;
    if (!chordIsSpellable(item.accelerator)) {
      console.warn(`[deck-host] the arm accelerator ${JSON.stringify(item.accelerator)} is not in `
        + "chordLabel()'s vocabulary, so the deck would draw it on the key cap verbatim. Answering null.");
      return null;
    }
    return item.accelerator;
  };
  const onArmShortcut = (event) => (isDeck(event) ? armAccelerator() : null);
  ipcMain.handle(CH.armShortcut, onArmShortcut);

  // =========================================================================
  // 4. THE SESSION — one boolean, derived, and the record the deck PROJECTS
  // =========================================================================
  /**
   * `session.armed` IS A BOOLEAN THE HOST DERIVES (freeze change 3). It used to
   * be `session.tabId`, and the deck read its truthiness at four sites — which
   * made a tab id the unit's own definition of armed. There are no tabs here,
   * and the derivation is one line:
   */
  let armEpoch = null;
  let armedAt = null;
  const armed = () => armEpoch !== null;

  /**
   * THE DECK PROJECTS THIS RECORD RATHER THAN MERGING IT, so an omitted `armed`
   * reads as disarmed instead of leaving the last value standing. That is a
   * property of the deck we get for free — and must not accidentally rely on in
   * the other direction: every field is spelled on every send.
   *
   * `title` and `url` describe the SOURCE. `url` is the page the user is looking
   * at and never a media URL: L1 is intact, and the engine parses it for a video
   * id to use as a cache key.
   */
  function sessionForDeck() {
    const wc = source();
    const live = !!wc && !wc.isDestroyed();
    return {
      armed: armed(),
      title: live ? wc.getTitle() : null,
      url: live ? wc.getURL() : null,
      armedAt,
    };
  }

  function sendSession() {
    stats.sessions++;
    return bus.originate(BUS.deck, { type: 'SESSION', session: sessionForDeck() });
  }

  // =========================================================================
  // 5. ARM_ERROR — sent AND persisted, and the persisted half is load-bearing
  // =========================================================================
  /**
   * `shared/host.js`: "`ARM_ERROR` IS SENT AND PERSISTED, and the persisted half
   * is the one that matters: the deck page is created BY the arm gesture, so on
   * a refusal it is still loading while this message goes to nobody."
   *
   * Our deck exists BEFORE the arm gesture rather than being created by it, so
   * the live message will usually arrive. The durable copy stays anyway, and not
   * out of caution: the deck view can be reloaded, hidden by `page.close()`, or
   * recreated after a renderer crash, and `ARM_ERROR_TTL_MS` already decides
   * when a stale refusal stops painting.
   *
   * THE RECORD'S SHAPE IS THE READER'S. `ui/embed.js` reads `{code, message, at,
   * seq}` plus an optional `deck`, with `at` in EPOCH milliseconds — the record
   * is written in one process and read in another, and `performance.now()`'s
   * origin is per-context.
   *
   * IT LIVES IN THE `'session'` AREA, which under this Host is a Map in this
   * process that is never written to disk. That is the whole reason the deck
   * names two areas: a refusal that survived a restart would paint as current,
   * and a false alarm teaches the user to ignore the banner.
   *
   * THERE IS NO `armSerial` HERE, AND THAT IS NOT AN OMISSION. The service
   * worker needs a promise chain because `chrome.storage` is an asynchronous
   * read-modify-write and a clear can overtake a raise. This store is
   * synchronous and in-process: the order of these calls IS the order of the
   * writes.
   */
  let armSeq = 0;

  function raiseArm(kind, message, deckId = DECK_DEFAULT) {
    stats.armErrors++;
    const r = ARM_REFUSALS[kind] || ARM_REFUSALS.NO_SOURCE;
    const rec = {
      code: r.code,
      message: message || r.message,
      at: Date.now(),
      seq: ++armSeq,
      ...(deckId && deckId !== DECK_DEFAULT ? { deck: deckId } : {}),
    };
    try { storage.set('session', ARM_ERROR_KEY, rec); }
    catch (err) { console.error('[deck-host] the durable arm refusal could not be written', err); }
    bus.originate(BUS.deck, { type: 'ARM_ERROR', code: rec.code, message: rec.message, seq: rec.seq });
    return rec;
  }

  /**
   * RETIRE A REFUSAL THE HOST HAS DECIDED NO LONGER APPLIES. A Host that never
   * sends this leaves a stale banner up until its TTL.
   *
   * `seq` IS THE RECORD'S IDENTITY ON THE DISMISSAL PATH. The deck's × and its
   * eject button both name the `seq` they were SHOWING, so dismissing a refusal
   * you can see never deletes a newer one that landed while you were reaching
   * for the mouse. A clear with no `seq` means "drop whatever is there", and
   * that is reserved for the successful-arm path, which is authoritative — a
   * user's finger is not.
   */
  function clearArm({ seq = null } = {}) {
    let rec = null;
    try { rec = storage.get('session', ARM_ERROR_KEY); } catch { rec = null; }
    if (seq !== null && rec && rec.seq !== seq) return false;
    stats.armErrorsCleared++;
    try { storage.set('session', ARM_ERROR_KEY, null); } catch { /* the message still goes */ }
    bus.originate(BUS.deck, { type: 'ARM_ERROR_CLEARED' });
    return true;
  }

  // =========================================================================
  // 6. THE ARM GESTURE
  // =========================================================================
  /**
   * ARMING BINDS THE DECK TO A SOURCE. In the extension it answered "which tab"
   * and had to happen inside a browser-level invocation; neither half survives
   * here — there is one window and there is no permission to broker. What
   * survives is the DECISION, and it is worth keeping deliberate because it is
   * the moment three things become true at once: this source view is the thing
   * the deck listens to, the app may open a capture on it, and the deck's number
   * keys stop belonging to whatever has focus.
   *
   * ARMING IS NEVER IMPLICIT. The deck's `follow()` will start a pipeline on its
   * own if it believes it is armed, and `shared/host.js` records what that cost
   * once already.
   */
  function arm({ deck: deckId = DECK_DEFAULT } = {}) {
    const wc = source();
    if (!wc || wc.isDestroyed()) return refuse('NO_SOURCE', deckId);
    const url = wc.getURL();
    if (!url || url === 'about:blank') return refuse('NO_SOURCE', deckId);

    armEpoch = (armEpoch === null ? 0 : armEpoch) + 1;
    armedAt = Date.now();
    stats.arms++;
    // UNCONDITIONAL ON A SUCCESSFUL ARM, which is what stops a stale refusal
    // outliving the problem it described.
    clearArm();
    sendSession();
    return { ok: true, armEpoch };
  }

  /**
   * @param {'NO_SOURCE'|'NOT_ARMED'|'ENGINE_DOWN'} kind  what really happened
   * @returns the refusal, carrying BOTH names: `kind` is this Host's and is what
   *   a gate asserts on, `code` is what went on the wire in the deck's own
   *   vocabulary. Collapsing them would make the report either untrue or unusable.
   */
  function refuse(kind, deckId = DECK_DEFAULT, message) {
    const rec = raiseArm(kind, message, deckId);
    return { ok: false, kind, code: rec.code, message: rec.message, seq: rec.seq };
  }

  function disarm({ deck: deckId = DECK_DEFAULT } = {}) {
    const was = armed();
    armEpoch = null;
    armedAt = null;
    if (was) {
      stats.disarms++;
      // THE CAPTURE GOES WITH THE GESTURE. A claim minted for an arm that has
      // ended must not still open one, and the engine must stop the tracks.
      if (engine && typeof engine.captureStop === 'function') engine.captureStop({ deck: deckId });
      // ...and the player is handed back the way it was found. A muted 1.02x
      // video left behind is a bug the user cannot explain and cannot undo.
      if (transport) transport.release();
    }
    sendSession();
    return { ok: true, wasArmed: was };
  }

  // =========================================================================
  // 7. THE SIX `SW_*` THE DECK SENDS AND NOTHING DOCUMENTS — finding F1
  // =========================================================================
  /**
   * `VENDORING.md` names the messages a Host must ORIGINATE. It does not name
   * the ones the deck SENDS to `BUS.host` and boots by polling for. A Host that
   * originates all six and answers none has a deck that never paints — twenty
   * tries at 400 ms, then silence, and nothing in the unit says why.
   *
   * `ui/embed.js`, by line: `SW_STATUS` (:2456), `SW_ENSURE_OFFSCREEN` (:2472),
   * `SW_DECK_PREPARE` (:1053), `SW_CAPTURE_START` (:693),
   * `SW_ARM_ERROR_CLEAR` (:2297), `SW_DISARM` (:2312).
   */
  const offHost = bus.onHostMessage((msg) => {
    if (!msg || typeof msg.type !== 'string') return;
    stats.sw[msg.type] = (stats.sw[msg.type] || 0) + 1;
    const deckId = normalizeDeck(msg.deck);

    switch (msg.type) {
      case 'SW_STATUS':
        // The engine first, then the answer: the deck sends this once at module
        // scope and paints `SESSION` as soon as it lands.
        Promise.resolve(ensureEngine ? ensureEngine() : undefined).catch(() => {}).then(sendSession);
        break;

      case 'SW_ENSURE_OFFSCREEN':
        if (ensureEngine) Promise.resolve(ensureEngine()).catch(() => {});
        break;

      case 'SW_DECK_PREPARE':
        /**
         * THE DELIVERY GUARANTEE IS THE WHOLE DUTY HERE. A `DECK_PREPARE` sent
         * before the engine window exists is dropped by the router and counted,
         * and the symptom is an 8 s stall on the OTHER deck two minutes later —
         * the kind of failure nobody traces back to a dropped message.
         */
        if (!engine) break;
        Promise.resolve(ensureEngine ? ensureEngine() : undefined)
          .then(() => engine.deckPrepare({ deck: deckId }))
          .catch(() => {});
        break;

      case 'SW_CAPTURE_START': {
        /**
         * THE DECK PRESSED START. Arming is never implicit, so an unarmed deck
         * is REFUSED with a code rather than armed on its behalf — and that
         * refusal is the one path that tells the user what to do next.
         */
        if (!armed()) { refuse('NOT_ARMED', deckId); break; }
        if (!engine) { refuse('ENGINE_DOWN', deckId); break; }
        Promise.resolve(ensureEngine ? ensureEngine() : undefined)
          .then(() => {
            const r = engine.captureStart({ deck: deckId });
            if (r && r.ok === false) refuse('ENGINE_DOWN', deckId, r.message);
          })
          .catch((err) => refuse('ENGINE_DOWN', deckId, String((err && err.message) || err)));
        break;
      }

      case 'SW_ARM_ERROR_CLEAR':
        clearArm({ seq: Number.isFinite(msg.seq) ? msg.seq : null });
        break;

      case 'SW_DISARM':
        disarm({ deck: deckId });
        break;

      default:
        // Not ours, and not an error: the host inbox has more than one reader.
    }
  });

  // =========================================================================
  // 8. `page` AND `transport` — the deck's other wire, both directions
  // =========================================================================
  /**
   * `{c: …}` from the deck, `{t: …}` to it. The spelling is this Host's own —
   * the seam names `currentTime` and this wire carries it under the same name,
   * unlike the extension's `seekTo`, because there is no second position field
   * on it to be confused with.
   */
  const toDeck = (msg) => {
    const wc = deck();
    if (!wc || wc.isDestroyed()) return false;
    stats.toDeck[msg.t] = (stats.toDeck[msg.t] || 0) + 1;
    wc.send(PAGE, msg);
    return true;
  };

  /** The deck's key claim, kept for the chrome-view relay below. */
  let claim = null;

  const onPage = (event, msg) => {
    if (!isDeck(event)) return;
    if (!msg || typeof msg.c !== 'string') return;
    stats.fromDeck[msg.c] = (stats.fromDeck[msg.c] || 0) + 1;

    switch (msg.c) {
      /**
       * THE WRITE SET IS CLOSED A SECOND TIME HERE. The hole module names the
       * three fields, this passes what it was given to a transport that filters
       * them a third time, and the preload writes only those three. Three layers
       * on purpose: L1 is a security property and this channel reaches a
       * `<video>` on somebody else's page.
       */
      case 'drive': if (transport) transport.drive(msg); break;
      case 'release': if (transport) transport.release(); break;
      case 'requestSpeed': if (transport) transport.requestSpeed(msg.rate); break;

      case 'claimKeys':
        claim = { armed: msg.armed === true, keys: Array.isArray(msg.keys) ? msg.keys : [] };
        if (transport) transport.claimKeys(claim);
        break;

      case 'height':
        stats.heights.push(clampDeckHeight(msg.px));
        onHeight(clampDeckHeight(msg.px));
        break;

      case 'close':
        // THE AUDIO DOES NOT STOP. Capture and separation live in the engine,
        // which is a different process here, so what the extension keeps by
        // convention this Host keeps structurally: hiding a view cannot reach it.
        onClose();
        break;

      case 'ready':
        /**
         * THE HOST OWES A RE-SEND of everything it reports on change — player
         * state, speed, autoplay — because a deck mounted onto an
         * already-playing video is the common case and "on change" would leave
         * it blank until something moved. All three live in the transport, and
         * none of them is deduped on this path.
         */
        if (transport) transport.resend();
        break;

      default:
    }
  };
  ipcMain.on(PAGE, onPage);

  /**
   * The five things a player is the source of, relayed to the deck.
   *
   * `t` IS SPELLED LAST IN EVERY ONE OF THESE, AND THAT IS A BUG FIX RATHER
   * THAN A STYLE. The transport's payloads come off the source preload's own
   * wire and carry their own `{t: 'state'}`; written `{t: 'video', ...s}` the
   * spread OVERWRITES the type, the deck's inbound map has no handler for
   * `'state'`, and `onState` — the duty the whole deck follows — never fires.
   * Nothing goes red: the deck simply shows a player that never moves.
   * Measured on the first launch of this Host (out/deck-host: `toDeck.state: 48`,
   * `toDeck.video: 0`).
   */
  const offTransport = [];
  if (transport) {
    offTransport.push(transport.onState((s) => toDeck({ ...s, t: 'video' })));
    offTransport.push(transport.onJump(() => toDeck({ t: 'jump' })));
    offTransport.push(transport.onSpeedReport((p) => toDeck({ ...p, t: 'speed' })));
    offTransport.push(transport.onKey((k) => toDeck({ ...k, t: 'key' })));
    offTransport.push(transport.onAutonav((a) => toDeck({ ...a, t: 'autonav' })));
  }

  // =========================================================================
  // 9. THE AUTOPLAY-NEXT WIRE — the checkbox that would otherwise be dead
  // =========================================================================
  /**
   * The deck writes the WHOLE prefs object through `storageSet('local',
   * PREFS_KEY, …)` and nothing tells this Host to act on it. So this Host
   * watches that key with its own change listener — the same storage it
   * implements, so this is a local subscription and not another wire — and hands
   * the record to the transport, which owns YouTube's toggle and reports what
   * happened back to the deck through `page.onAutonav`.
   *
   * THE WHOLE RECORD IS PASSED, NOT THE FIELD. The polarity flip
   * (`autoplayNext` -> `suppress`) is `resolveSuppress` in `src/main/autonav.js`
   * and lives in one place; extracting the field here would be a second reader
   * of the same shape, and the two would eventually disagree about a malformed
   * record.
   *
   * READ ONCE AT BOOT AND THEN FOLLOWED. The deck applies its own defaults from
   * the same key, so a Host that only followed CHANGES would leave the page
   * disagreeing with the checkbox until the user next touched it.
   */
  function pushPrefs() {
    if (!transport) return false;
    stats.prefs++;
    let prefs = null;
    try { prefs = storage.get('local', PREFS_KEY); }
    catch { prefs = null; }   // unreadable storage: the suppress default stands
    transport.setPrefs(prefs);
    return true;
  }
  const offPrefs = storage.onChanged('local', PREFS_KEY, () => pushPrefs());
  pushPrefs();

  // =========================================================================
  // 10. ONE KEY RELAY, FOR OUR OWN BAR
  // =========================================================================
  /**
   * The source view's keys are taken by its own preload, which is the only
   * context that can see which element has focus — `isTypingTarget` is the
   * load-bearing half and `before-input-event` cannot do it. What is left is OUR
   * OWN chrome view: the user clicks Arm and then reaches for a digit, and with
   * nothing here that digit lands on a 44 px bar and does nothing.
   *
   * THE CLAIM IS THE SAME ONE THE TRANSPORT GETS. It arrives once, on `'page'`,
   * and is used twice — relayed to the source preload and kept here — rather
   * than being asked for twice or re-derived.
   *
   * ponytail: ceiling — `typing` is hard-coded `false` for the chrome view,
   * because the bar is buttons and has no text field a digit could be stolen
   * from. TRIGGER to fix: the first `<input>` in `src/renderer/chrome.html`. The
   * fix is the source preload's shape — the bar reports its own focus — and not
   * a guess made in this process.
   */
  const relayKey = (event, input) => {
    if (!deckTakesKey({ claim, input, typing: false })) return;
    if (!toDeck({
      t: 'key',
      code: input.code,
      key: input.key,
      shift: input.shift === true,
      alt: input.alt === true,
      repeat: input.isAutoRepeat === true,
    })) return;
    stats.keysRelayed++;
    event.preventDefault();
  };
  const chromeWc = chrome();
  if (chromeWc && !chromeWc.isDestroyed()) chromeWc.on('before-input-event', relayKey);

  // =========================================================================
  // 11. THE MENU — one item that matters, and the chord it binds
  // =========================================================================
  if (installMenu) buildMenu();

  function buildMenu() {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{
      label: 'Source',
      submenu: [
        { id: 'arm', label: 'Arm this Source', accelerator: ARM_ACCEL, click: () => arm() },
        { id: 'disarm', label: 'Disarm', click: () => disarm() },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }]));
  }

  return {
    stats,
    arm,
    disarm,
    refuse,
    clearArm,
    sendSession,
    armed,
    armAccelerator,
    sessionForDeck,
    pushPrefs,
    /** What the deck last claimed, for a gate to read. */
    claim: () => claim,
    stop() {
      offHost();
      offPrefs();
      for (const off of offTransport) off();
      ipcMain.removeListener(CH.profile, onProfile);
      ipcMain.removeHandler(CH.get);
      ipcMain.removeListener(CH.set, onSet);
      ipcMain.removeListener(CH.watch, onWatch);
      ipcMain.removeHandler(CH.armShortcut);
      ipcMain.removeListener(PAGE, onPage);
    },
  };
}
