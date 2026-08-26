/**
 * The deck slot, before the deck.
 *
 * TWO THINGS IT PROVES, and neither is cosmetic:
 *
 *  1. THE ISOLATION IS THE SCHEME'S, NOT ONE PAGE'S. A protocol handler that put
 *     COOP/COEP on the engine's response and not on this one would pass a
 *     single-page check and fail at the deck.
 *  2. THE BUS REACHES THIS ADDRESS. `main` registers this renderer on
 *     `BUS.deck` ('ui'); everything received is kept, unmodified, so the gate can
 *     assert that a routed envelope arrives DEEP-EQUAL to the one that was sent.
 *     "The Host stamped one extra field" is a failure whose symptom is a
 *     receiver quietly ignoring traffic.
 */
import { probeIsolation } from './isolation.js';

const received = [];
if (window.__wbDeck) window.__wbDeck.onMessage((msg) => received.push(msg));

const ready = (async () => {
  const report = await probeIsolation();
  console.log(`isolation coi=${report.coi} sab=${report.sab} bridge=${!!window.__wbDeck}`);
  const el = document.getElementById('probe');
  if (el) el.textContent = JSON.stringify(report, null, 2);
  return report;
})();

window.__wbProbe = () => ready;
window.__wbBusLog = () => received;
