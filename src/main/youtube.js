/**
 * The source view — the one pointed at youtube.com — and the four things a
 * window pointed at somebody else's site owes.
 *
 * docs/HOST-DESIGN.md §1.6 is the table this file implements: navigation
 * allow-listed, window.open denied, every permission denied, downloads refused,
 * and the view MUTED FOR ITS WHOLE LIFE.
 *
 * ---------------------------------------------------------------------------
 * THE MUTE IS THE PRODUCT, NOT A TUNING KNOB
 * ---------------------------------------------------------------------------
 * `webContents.setAudioMuted(true)` is applied to this view BEFORE IT LOADS
 * ANYTHING and re-asserted on every navigation. The spike measured why: variant
 * (a) — relying on Chromium's capture-scoped local-echo silencing instead —
 * leaked **1.90 s at peak 0.499893** between the view starting to play and
 * `getDisplayMedia` being called (docs/spike-capture-mute.md). There is no state
 * of this product in which the user should hear the raw view, so the mute has no
 * reason to be conditional, and a conditional mute has a window.
 *
 * `witness` is how the gate can tell the difference. `mutedBeforeLoad` is
 * sampled in `load()`, one statement before `loadURL` and in a different
 * function from the `setAudioMuted` call, so moving that call after the load —
 * the mutation — turns it `false` rather than merely rearranging two adjacent
 * lines.
 */
import { WebContentsView } from 'electron';
// Imported, never re-exported: two import paths for one constant is one path
// too many, and the suite asserts against `navigation.js` directly.
import { isAllowedNavigation } from './navigation.js';

/**
 * Everything a page in this view may ask for. A video page needs `fullscreen`
 * and nothing else.
 *
 * `display-capture` IS DENIED BY NAME. A page in this view that could call
 * `getDisplayMedia` itself would be the whole product's undoing: it is the one
 * capability the Host exists to broker. `media` (camera and microphone),
 * `geolocation`, `notifications`, `midi*`, `clipboard-read`, `idle-detection`,
 * `hid`, `serial`, `usb`, `window-management` and everything unlisted fall to
 * the same default-deny.
 */
export const SOURCE_PERMISSIONS_ALLOWED = Object.freeze(['fullscreen']);

/**
 * @param {object} o
 * @param {Electron.Session} o.session        `persist:youtube`, and nothing else lives there
 * @param {string} o.preload                  absolute path to `preload/youtube.cjs`
 * @param {(r: {url: string, why: string}) => void} [o.onRefusal]
 */
export function createSourceView({ session: ses, preload, onRefusal = () => {} }) {
  const view = new WebContentsView({
    webPreferences: {
      session: ses,
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      // The transport preload reads and writes the page's `<video>`; nothing in
      // this view ever needs to reach our origin.
      allowRunningInsecureContent: false,
    },
  });
  const wc = view.webContents;

  // ---------------------------------------------------------------- THE MUTE
  // FIRST STATEMENT AFTER CONSTRUCTION. Before the bounds, before the load,
  // before this function returns.
  wc.setAudioMuted(true);

  const witness = {
    mutedAtCreate: wc.isAudioMuted(),
    /** one entry per `load()`, sampled immediately before `loadURL` */
    mutedBeforeLoad: [],
    navigations: 0,
    /** navigations that STARTED while the view was not muted. Must stay 0. */
    unmutedNavigations: 0,
  };
  const stats = { refusedNavigations: [], deniedWindowOpens: [], refusedDownloads: 0 };

  // ------------------------------------------------------------- NAVIGATION
  // `will-navigate` and `will-redirect` are renderer-initiated navigations —
  // a link, a script assignment, a redirect. A main-process `loadURL()` raises
  // NEITHER, which is why the gate's local fixture is not an exception to the
  // allowlist: it is not a navigation the guard ever sees.
  const guard = (e, url) => {
    if (isAllowedNavigation(url)) return;
    e.preventDefault();
    const r = { url, why: 'not on the navigation allowlist' };
    stats.refusedNavigations.push(r);
    onRefusal(r);                    // a REFUSAL the user can see, never a silent cancel
  };
  wc.on('will-navigate', guard);
  wc.on('will-redirect', guard);

  /**
   * `did-start-navigation` IS NOT A WITNESS THAT THIS GUARD LET GO. Measured on
   * Electron 44.0.0: it fires for a navigation the handler above has already
   * `preventDefault()`ed — `https://accounts.google.com.evil.test/` was refused
   * and raised it anyway. So it cannot be used to tell an admitted navigation
   * from a cancelled one, and `tools/suites/shell.mjs` asks the session's
   * request log instead, which only ever sees a navigation that really reached
   * the network stack. It is recorded here so that nobody re-derives it.
   *
   * The same finding, with the reasoning about why a NEGATIVE witness will not
   * do either, is `docs/HOST-DESIGN.md` §1.6 — where somebody writing the next
   * navigation gate will look, rather than in the file it happened to bite.
   */
  wc.on('did-start-navigation', () => {
    witness.navigations++;
    if (!wc.isAudioMuted()) witness.unmutedNavigations++;
    wc.setAudioMuted(true);          // re-assert AFTER the sample, never before
  });

  // ------------------------------------------------------------ NEW WINDOWS
  // There are no tabs and no popups. A sign-in flow that needs one is a refusal
  // the user can see, not a window we cannot manage.
  wc.setWindowOpenHandler(({ url }) => {
    stats.deniedWindowOpens.push(url);
    onRefusal({ url, why: 'this window has no tabs and no popups' });
    return { action: 'deny' };
  });

  // ------------------------------------------------------------ PERMISSIONS
  const allowed = new Set(SOURCE_PERMISSIONS_ALLOWED);
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  // ------------------------------------------------------------- DOWNLOADS
  ses.on('will-download', (e) => { e.preventDefault(); stats.refusedDownloads++; });

  return {
    view,
    webContents: wc,
    witness,
    stats,
    /** The only way this view is ever pointed anywhere. */
    async load(url) {
      witness.mutedBeforeLoad.push(wc.isAudioMuted());
      await wc.loadURL(url);
      return url;
    },
  };
}
