/**
 * The engine page's own boot, in the wave before there is an engine.
 *
 * Its whole job is to prove that the page the unit will be loaded into is the
 * page the unit needs: cross-origin isolated, with a working SharedArrayBuffer
 * in the document AND in a module worker. When
 * `vendor/…/offscreen/engine.js` joins this page, it will publish the same two
 * facts itself as `STATE.boot.{sab,coi}` (`engine.js:115`) and this file's
 * report becomes the thing that says WHY they are true.
 */
import { probeIsolation } from './isolation.js';

const ready = (async () => {
  const report = await probeIsolation();

  // A line in the terminal, because `main` forwards this renderer's console.
  // "It started and loaded" is a claim that should not need a debugger.
  console.log(`isolation coi=${report.coi} sab=${report.sab} secureContext=${report.secureContext} `
    + `worker=${JSON.stringify(report.worker)}`);

  const el = document.getElementById('probe');
  if (el) el.textContent = JSON.stringify(report, null, 2);
  return report;
})();

/** The gate reads this. `executeJavaScript` resolves the promise it returns. */
window.__wbProbe = () => ready;
