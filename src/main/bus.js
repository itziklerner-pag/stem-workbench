/**
 * The bus router. One router in `main`, over `ipcMain`/`ipcRenderer`, one
 * channel name (`'bus'`). NOT `MessageChannelMain` — docs/HOST-DESIGN.md §4.1
 * carries the four reasons, three of which are the unit's rather than
 * Electron's.
 *
 * WHAT THIS FILE IS IN THIS WAVE. The transport, and nothing that is a duty.
 * `hostInbox` — the six `SW_*` messages the deck sends to `BUS.host` and boots
 * by polling for (HOST-DESIGN.md §5.3, finding F1) — is a counter and a warning
 * here. A deck pointed at this build will poll and never be answered; that is
 * the next wave's work and it is stated rather than left to be discovered.
 */
import { ipcMain } from 'electron';

/**
 * The three addresses, from the unit's `shared/host.js:181-188`.
 *
 * COPIED, NOT IMPORTED, AND THAT IS TEMPORARY. `vendor/stem-splitter-live/` does
 * not exist on this tree yet, so there is nothing to import from. The moment the
 * copy lands, this object must become
 *   `import { BUS } from '../../vendor/stem-splitter-live/extension/shared/host.js'`
 * and this comment must go. A second copy of a constant is a constant that
 * drifts, and this one drifts into "the deck is blank" — the quietest failure on
 * the whole seam.
 */
export const BUS = Object.freeze({ engine: 'off', deck: 'ui', host: 'sw' });

export const BUS_CHANNEL = 'bus';

/**
 * @returns the router, plus the counters that make its silences legible.
 *
 * Five properties, each a rule from `shared/host.js` made mechanical:
 *
 *  - `main` READS `to`, and `v` only to refuse a protocol it does not know.
 *    Nothing in the envelope is rewritten, reordered, normalised, or logged by
 *    value. `tools/suites/shell.mjs` asserts a routed message arrives
 *    deep-equal to what was sent, because "the Host stamped one extra field"
 *    is a failure that shows up as a receiver quietly ignoring traffic.
 *  - ADDRESSES ARE ASSIGNED BY `main`, never claimed by a renderer.
 *    `register()` is called where a URL is loaded into a view, so a compromised
 *    renderer cannot start receiving the engine's traffic by asking to.
 *  - FAN-OUT: an address may have more than one listener (two decks, one
 *    engine).
 *  - A MESSAGE WITH NO LISTENER IS DROPPED AND COUNTED, never retried. That is
 *    the extension's behaviour and the deck's boot poll is written for it. The
 *    counter exists so that "the deck is blank" has a number attached to it.
 *  - THE SENDER MUST ALREADY BE ON AN ADDRESS. Defence in depth, and it is
 *    NOT gated today: no renderer we ship has both a `'bus'` channel and no
 *    address, so there is nothing to send the message that would prove it. It
 *    is listed in the suite's "not gated here" so the absence is on the record.
 */
export function createBus() {
  /** @type {Map<string, Set<Electron.WebContents>>} */
  const REG = new Map();
  const stats = {
    received: 0, delivered: 0, host: 0,
    dropped: { malformed: 0, 'no-listener': 0, 'unknown-sender': 0 },
  };
  /** @type {Set<(msg: object, sender: Electron.WebContents) => void>} */
  const hostListeners = new Set();

  const knows = (wc) => [...REG.values()].some((set) => set.has(wc));
  const drop = (why) => { stats.dropped[why] = (stats.dropped[why] || 0) + 1; };

  ipcMain.on(BUS_CHANNEL, (event, msg) => {
    stats.received++;
    if (!msg || msg.v !== 1 || typeof msg.to !== 'string') return void drop('malformed');
    if (!knows(event.sender)) return void drop('unknown-sender');
    if (msg.to === BUS.host) {
      stats.host++;
      if (!hostListeners.size) {
        // Loud, once per message, and on purpose: this is finding F1 arriving.
        console.warn(`[bus] no host inbox — ${String(msg.type)} from ${String(msg.from)} went unanswered`);
      }
      for (const fn of hostListeners) fn(msg, event.sender);
      return;
    }
    const targets = REG.get(msg.to);
    if (!targets || !targets.size) return void drop('no-listener');
    for (const wc of targets) {
      if (wc.isDestroyed()) continue;
      wc.send(BUS_CHANNEL, msg);     // the SAME object. Not a copy with a field added.
      stats.delivered++;
    }
  });

  return {
    BUS,
    stats,
    /** Put a renderer on an address. Called by `main` when it loads that view. */
    register(address, wc) {
      if (!REG.has(address)) REG.set(address, new Set());
      REG.get(address).add(wc);
      wc.once('destroyed', () => REG.get(address)?.delete(wc));
      return () => REG.get(address)?.delete(wc);
    },
    addresses: () => [...REG.entries()].map(([a, s]) => [a, s.size]),
    /**
     * A message `main` ORIGINATES. It is the only stamper of `from: BUS.host`
     * — freeze item 5 gives the engine and the deck one stamper each and three
     * would be one too many.
     */
    originate(to, msg) {
      const envelope = { v: 1, to, from: BUS.host, ...msg };
      const targets = REG.get(to);
      if (!targets || !targets.size) { drop('no-listener'); return false; }
      for (const wc of targets) if (!wc.isDestroyed()) { wc.send(BUS_CHANNEL, envelope); stats.delivered++; }
      return true;
    },
    onHostMessage(fn) { hostListeners.add(fn); return () => hostListeners.delete(fn); },
  };
}
