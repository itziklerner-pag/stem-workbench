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
 * The three addresses, IMPORTED FROM THE UNIT'S OWN DECLARATION rather than
 * copied. `shared/host.js` freezes them next to the duty that consumes them, and
 * it is the one file on the seam with no imports, no `chrome.`, and no DOM — so
 * the main process can read it directly.
 *
 * This was a local copy for one commit, with a note saying to replace it the
 * moment `vendor/stem-splitter-live/` landed. It has landed. A second copy of a
 * constant is a constant that drifts, and this one drifts into "the deck is
 * blank" — the quietest failure on the whole seam.
 */
export { BUS } from '../../vendor/stem-splitter-live/extension/shared/host.js';
import { BUS } from '../../vendor/stem-splitter-live/extension/shared/host.js';

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

  /**
   * READ-ONLY OBSERVERS OF EVERYTHING THE ROUTER CARRIES.
   *
   * A tap cannot inject, cannot address, cannot refuse and cannot change an
   * envelope — it is handed the message after the router has decided what to do
   * with it, and its return value is discarded. It exists because the alternative
   * for `tools/gate/engine-host.mjs` was to put a diagnostic message log inside
   * the shipping preload, where a renderer could read it; this is in `main`,
   * which no renderer can reach.
   *
   * It is deliberately NOT a hook: nothing here awaits, and a tap that throws is
   * swallowed, because an observer that can break delivery is not an observer.
   *
   * A TAP IS TOLD WHO SENT THE MESSAGE, AND THAT IS THE HALF THAT MAKES IT
   * TRUSTWORTHY. `from` is a field in an envelope a renderer wrote, so a tap
   * that believed it would believe the deck when it says it is the engine.
   * `sender` is the `WebContents` the router actually received it on, which no
   * renderer can spell; `null` for a message `main` ORIGINATED, because there is
   * no renderer behind that one. `src/main/main.js`'s progress relay is the
   * consumer: the chrome bar reports what the ENGINE said about a separation,
   * and a STATE from anywhere else is not that.
   */
  const taps = new Set();
  const observe = (msg, verdict, sender = null) => {
    for (const fn of taps) { try { fn(msg, verdict, sender); } catch { /* an observer may not break delivery */ } }
  };

  const knows = (wc) => [...REG.values()].some((set) => set.has(wc));
  const drop = (why) => { stats.dropped[why] = (stats.dropped[why] || 0) + 1; };

  ipcMain.on(BUS_CHANNEL, (event, msg) => {
    stats.received++;
    if (!msg || msg.v !== 1 || typeof msg.to !== 'string') { drop('malformed'); return void observe(msg, 'malformed', event.sender); }
    if (!knows(event.sender)) { drop('unknown-sender'); return void observe(msg, 'unknown-sender', event.sender); }
    if (msg.to === BUS.host) {
      stats.host++;
      if (!hostListeners.size) {
        // Loud, once per message, and on purpose: this is finding F1 arriving.
        console.warn(`[bus] no host inbox — ${String(msg.type)} from ${String(msg.from)} went unanswered`);
      }
      observe(msg, 'host', event.sender);
      for (const fn of hostListeners) fn(msg, event.sender);
      return;
    }
    const targets = REG.get(msg.to);
    if (!targets || !targets.size) { drop('no-listener'); return void observe(msg, 'no-listener', event.sender); }
    observe(msg, 'delivered', event.sender);
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
      if (!targets || !targets.size) { drop('no-listener'); observe(envelope, 'no-listener'); return false; }
      observe(envelope, 'originated');
      for (const wc of targets) if (!wc.isDestroyed()) { wc.send(BUS_CHANNEL, envelope); stats.delivered++; }
      return true;
    },
    onHostMessage(fn) { hostListeners.add(fn); return () => hostListeners.delete(fn); },
    /** @see `taps` above. Returns an unsubscribe function. */
    tap(fn) { taps.add(fn); return () => taps.delete(fn); },
  };
}
