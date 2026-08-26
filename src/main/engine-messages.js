/**
 * THE THREE MESSAGES THIS HOST OWES THE ENGINE — the undeclared half of the
 * seam, and the half `assertHost` structurally cannot check.
 *
 * `stem-splitter-live/docs/VENDORING.md`, "What your Host owes the unit":
 * *"You must ORIGINATE four messages. `assertHost` cannot check for a message
 * nobody sent."* Three of them are addressed to the engine and they are these.
 * (The other three — `SESSION`, `ARM_ERROR`, `ARM_ERROR_CLEARED` — are addressed
 * to the DECK and belong with the deck's half of the Host, docs/HOST-DESIGN.md
 * §5.1.)
 *
 *   CAPTURE_START { sourceToken, source: { title, url }, deck? }
 *   CAPTURE_STOP  { deck? }
 *   DECK_PREPARE  { deck? }
 *
 * FROZEN AT HOST INTERFACE v1, and both of `CAPTURE_START`'s names changed AT
 * the freeze, which is the reason this file spells the shapes instead of letting
 * each call site build an object:
 *
 *   · the wire field was `streamId`, after `chrome.tabCapture.getMediaStreamId`
 *     — a Chrome noun on a wire the unit is forbidden to know the Host of. It is
 *     `sourceToken`, and it is opaque: it goes straight back to
 *     `EngineHost.captureStream` and the engine never looks inside it.
 *   · `source` carried a `tabId` that NOTHING IN THE UNIT EVER READ. A Host with
 *     no tabs had to invent a value for a field with no reader, which the freeze
 *     called the purest form of the lie it was looking for. `source` is EXACTLY
 *     `{title, url}`: what a Source IS, not where this Host keeps it.
 *
 * WHY A MODULE AND NOT THREE `bus.originate` CALLS AT THE ARM SITE. Because the
 * shape is the contract and it has exactly one home: `title` and `url` are read
 * off the source view HERE, `deck` is omitted rather than sent as `null` when it
 * is the default deck, and the counters below are what a gate asserts against —
 * "the Host originated CAPTURE_START with these keys" is a claim that needs a
 * place to be true. Everything else in this file is delegation.
 *
 * `url` IS THE WATCH PAGE'S URL AND NEVER A MEDIA URL. The engine parses it for
 * a video id (`videoIdFromUrl`) and uses it as a cache key; L1 is intact,
 * because a page URL is what the user is looking at and not a stream anybody
 * resolved. The source view's preload never reads `src`, `currentSrc`,
 * `buffered` or `srcObject`, and nothing here asks it to.
 */
import { BUS } from '../../vendor/stem-splitter-live/extension/shared/host.js';

/**
 * `'A'` is the default deck and the unit already knows it: every `case` in
 * `engine.js` reads `m.deck || DECK_DEFAULT`. So the field is OMITTED for the
 * default deck rather than sent — `shared/host.js` spells it `deck?`, and a
 * Host that always sends one is a Host whose gate cannot tell "the default" from
 * "deck A, explicitly", which are different sentences the day deck B exists.
 */
const DECK_DEFAULT = 'A';
const withDeck = (msg, deck) => (deck && deck !== DECK_DEFAULT ? { ...msg, deck } : msg);

/**
 * @param {object} wiring
 * @param {{ originate: (to: string, msg: object) => boolean }} wiring.bus
 * @param {{ mint: (o: object) => string, revokeAll: (why?: string) => number }} wiring.claims
 * @param {() => Electron.WebContents|null} wiring.source  read at CALL time, never captured
 */
export function createEngineMessages({ bus, claims, source }) {
  /**
   * WHAT WAS ACTUALLY SENT, in order, with the payload KEYS but not the token.
   *
   * A gate cannot assert a message nobody recorded, and the alternative —
   * logging the envelope by value — would put a live capture claim in a file.
   * The token's LENGTH is enough to say one was minted and put on the wire; its
   * value is a capability.
   */
  const sent = [];
  const counts = { CAPTURE_START: 0, CAPTURE_STOP: 0, DECK_PREPARE: 0, undelivered: 0 };

  const originate = (msg) => {
    const delivered = bus.originate(BUS.engine, msg);
    counts[msg.type] = (counts[msg.type] || 0) + 1;
    if (!delivered) counts.undelivered++;
    sent.push({
      type: msg.type,
      keys: Object.keys(msg).sort(),
      deck: msg.deck === undefined ? null : msg.deck,
      sourceKeys: msg.source ? Object.keys(msg.source).sort() : null,
      source: msg.source ? { title: msg.source.title, url: msg.source.url } : null,
      tokenLength: typeof msg.sourceToken === 'string' ? msg.sourceToken.length : null,
      delivered,
      at: Date.now(),
    });
    return delivered;
  };

  return {
    sent, counts,

    /**
     * Arm one deck onto the source view: mint a one-shot claim, describe the
     * Source, and tell the engine to open it.
     *
     * THE TOKEN IS MINTED HERE AND NOWHERE ELSE, which is what makes
     * `src/main/claims.js`'s property true: the only way a claim exists is that
     * this function ran. The engine spends it through `capture:claim` and
     * `setDisplayMediaRequestHandler` consumes it — three steps, and the middle
     * one is the only thing a renderer can reach.
     *
     * @returns {{ok: true, token: string, source: {title: string, url: string}}
     *          | {ok: false, code: string, message: string}}
     */
    captureStart({ deck = DECK_DEFAULT } = {}) {
      const wc = source();
      if (!wc || wc.isDestroyed()) {
        return { ok: false, code: 'no-source', message: 'there is no source view to capture' };
      }
      const token = claims.mint({ sourceWcId: wc.id, deck });
      // EXACTLY two fields. No tabId, no id, no webContents — see the header.
      const src = { title: wc.getTitle(), url: wc.getURL() };
      originate(withDeck({ type: 'CAPTURE_START', sourceToken: token, source: src }, deck));
      return { ok: true, token, source: src };
    },

    /**
     * Stop capturing. Sent on disarm, on the source view going away or
     * crashing, on a switch to a File source, and on quit.
     *
     * THE CLAIMS GO WITH IT. A token minted for a gesture that has ended must
     * not still open a capture, and this is the site that makes "a claim cannot
     * outlive its gesture" true rather than merely intended.
     */
    captureStop({ deck = DECK_DEFAULT } = {}) {
      claims.revokeAll('CAPTURE_STOP');
      return originate(withDeck({ type: 'CAPTURE_STOP' }, deck));
    },

    /**
     * Ask the engine to build a deck's inference session before it is needed.
     *
     * SENT ONLY AFTER THE ENGINE EXISTS. The deck's `SW_DECK_PREPARE` is a
     * request to this Host, and answering it before the engine window is there
     * loses the message — `bus.originate` drops and counts it, and the symptom
     * is an 8 s stall on the OTHER deck two minutes later, which is the kind of
     * failure nobody traces back to a dropped message.
     */
    deckPrepare({ deck = DECK_DEFAULT } = {}) {
      return originate(withDeck({ type: 'DECK_PREPARE' }, deck));
    },
  };
}
