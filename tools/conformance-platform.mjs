/**
 * THIS HOST'S PLATFORM, INSTALLED UNDER THE VENDORED `test.js`'s `group('host')`.
 *
 * `node --import <this file> test.js host`, run from inside `vendor/stem-splitter-live`.
 * It edits NOTHING. It is loaded before `test.js` and puts our own bridges on
 * `globalThis`, so the two hole modules find the platform they were written for
 * instead of finding nothing.
 *
 * ===========================================================================
 * WHY IT EXISTS: `group('host')` CANNOT COMPLETE A RUN WITHOUT IT
 * ===========================================================================
 * `docs/VENDORING.md` offers three things to do about that group's 122
 * conformance assertions, and this repository takes **option 3 — point them at
 * our files**. The hole modules already sit at the two paths the group reads, so
 * option 3 looked done. It was not, and the reason is measured rather than
 * argued:
 *
 *   node test.js                     -> TypeError: listeners[0] is not a function
 *                                       at test.js:5833
 *
 * The deck half of the group installs a Chrome platform, calls
 * `deckHost.onMessage(fn)`, correctly asserts `listeners.length === 1` and
 * reports it RED — and then calls `listeners[0](...)` anyway. Our DeckHost
 * registered its inbox with an Electron preload bridge that is not there, so the
 * array is empty and the dereference throws. Measured on a clean tree at
 * `stem-splitter-live` v0.2.0: **50 of the group's 122 assertions run, and the
 * crash takes `group('verifyModel')` and `group('backend')` — 31 further
 * assertions about the unit itself — down with it.**
 *
 * THAT IS AN UPSTREAM DEFECT AND IT IS NOT PATCHED HERE (rule V1: the vendored
 * copy is not edited, and `vendor-intact` gates it byte for byte). It is a
 * sibling of `stem-splitter-live#30` and not the same bug: #30 is a hole that
 * throws while being IMPORTED; this is an instrument check that reports the
 * absence and then dereferences it. Both are recorded in `docs/CONFORMANCE.md`.
 *
 * A crash is strictly worse than a red: it hides the reds worth reading. So this
 * file supplies the platform, the group completes, and there is a verdict.
 *
 * ===========================================================================
 * WHAT IT IS A DOUBLE OF, AND WHERE THE LINE IS
 * ===========================================================================
 * **The SUBJECT is the hole module.** This file stands in for everything BELOW
 * it: `src/preload/deck.cjs`, `src/preload/engine.cjs`, and the main-process
 * halves they reach (`src/main/deck-host.js`, `src/main/storage.js`,
 * `src/main/bus.js`). It is the same arrangement `tools/suites/deck-seam.mjs`
 * already uses — "the shipped hole module over a stubbed preload bridge" — with
 * one difference: the far end of the stub is the harness's own `chrome` platform
 * rather than a recorder of ours, because that is what `group('host')`'s
 * assertions read.
 *
 * **THEREFORE, AND THIS IS THE PART THAT MUST NOT BE FORGOTTEN: an assertion in
 * that group whose subject is below the bridge is an assertion about THIS FILE,
 * not about the Host.** A green there is a property of the apparatus. Every one
 * of them is named in `docs/CONFORMANCE.md` under "green, but not evidence about
 * this Host", and that list is asserted against by `tools/suites/conformance.mjs`
 * so it cannot quietly grow.
 *
 * The rule used to decide each one: does the behaviour the assertion measures
 * live in `extension/{ui,offscreen}/host.js`, or below it? `storageGet` unwrapping
 * `{ok, value}`, refusing `sync`, rejecting rather than throwing, filtering the
 * change feed by area and key, stamping the engine's envelope, guarding the
 * inbox by address — all of those are IN the hole module and are real results.
 * Finding `arm-tab` in a command table, or turning a `{[key]: value}` bag into a
 * value, is below it and is this file's doing.
 *
 * ===========================================================================
 * EVERYTHING IS RESOLVED PER CALL
 * ===========================================================================
 * `test.js` replaces `globalThis.chrome` wholesale between blocks — a fresh
 * `runtime` for the outgoing wire, another for the inbox, a `storage` with two
 * areas, a `commands`. Nothing below captures any of it at install time, which
 * is also what the real preloads do with `ipcRenderer` at the one level that
 * matters: `bridge()` in `ui/host.js` is resolved per call and this must not be
 * the thing that hides a Host which is not.
 */

/** The harness's platform, at CALL time, never at install time. */
const chrome = () => globalThis.chrome || {};

/** `ipcRenderer.send` is fire-and-forget and returns undefined; so is this. */
function fireAndForget(p) {
  // The real transport hands back nothing, so there is no promise for a caller to
  // await and none for Node to report as unhandled. Swallowing here is what makes
  // this double faithful to `ipcRenderer.send` rather than lenient.
  if (p && typeof p.catch === 'function') p.catch(() => {});
}

// ---------------------------------------------------------------- the deck
/**
 * `src/preload/deck.cjs`'s `window.__wbDeck`, plus the main-process half it
 * invokes. `ui/host.js` reads `globalThis.window[BRIDGE]`, so there has to be a
 * `window` here — the deck renderer has one.
 */
const wbDeck = {
  /** `main` answers this synchronously at preload time. A boolean, or the module refuses to load. */
  hosted: true,

  send: (msg) => { fireAndForget(chrome().runtime && chrome().runtime.sendMessage(msg)); },

  onMessage: (cb) => {
    const listener = (m) => { cb(m); return false; };
    chrome().runtime.onMessage.addListener(listener);
    return () => {};
  },

  /**
   * `{ok, value}` / `{ok:false, error}`, never a bare value — `src/main/storage.js`
   * answers in that shape because an ipc rejection flattens into something the
   * caller cannot tell from an absent key. THE UNWRAP OF THE PLATFORM'S BAG IS
   * MAIN'S, so it is here: `storageGet-UNWRAPS-THE-BAG` is therefore an
   * assertion about this file. What is NOT here, and is the hole module's, is
   * turning `{ok:false}` into a rejection and `undefined` into `null`.
   */
  storageGet: async (area, key) => {
    const areas = chrome().storage || {};
    if (!areas[area] || typeof areas[area].get !== 'function') {
      return { ok: false, error: `no storage area '${area}'` };
    }
    try {
      const bag = await areas[area].get(key);
      const has = bag && Object.prototype.hasOwnProperty.call(bag, key);
      return { ok: true, value: has ? bag[key] : null };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  },

  storageSet: (area, key, value) => {
    const areas = chrome().storage || {};
    if (!areas[area] || typeof areas[area].set !== 'function') return;
    fireAndForget(areas[area].set({ [key]: value }));
  },

  /** `main` keeps the (area, key) subscription list. Nothing to do in a double. */
  storageWatch: () => {},

  /**
   * `main` delivers `{area, key, value}` per changed key; the platform's feed is
   * `(changes, areaName)`. A REMOVAL arrives with an `oldValue` and no
   * `newValue`, and `value: undefined` is the right reading of it — the hole
   * module's filter is what decides whether the deck ever sees it.
   */
  onStorageChanged: (cb) => {
    const onChanged = chrome().storage && chrome().storage.onChanged;
    if (!onChanged) return () => {};
    onChanged.addListener((changes, areaName) => {
      for (const key of Object.keys(changes || {})) {
        cb({ area: areaName, key, value: changes[key] ? changes[key].newValue : undefined });
      }
    });
    return () => {};
  },

  /**
   * `src/main/deck-host.js` reads the INSTALLED application menu back and answers
   * with the accelerator it really took, or `null`. Here the installed menu is
   * the harness's command table. **Which entry is the arm gesture is decided in
   * this file**, so the three `armShortcut-*` assertions report on it and not on
   * the hole module; they are listed as such in `docs/CONFORMANCE.md`.
   */
  armShortcut: async () => {
    const commands = chrome().commands;
    if (!commands || typeof commands.getAll !== 'function') return null;
    const table = await commands.getAll();
    const hit = (table || []).find((c) => c && c.name === 'arm-tab');
    return hit && hit.shortcut ? hit.shortcut : null;
  },

  pageSend: () => {},
  onPageEvent: () => () => {},
};

// -------------------------------------------------------------- the engine
/** `src/preload/engine.cjs`'s `window.__wbEngine` — the bus wire and the claim. */
const wbEngine = {
  send: (env) => { fireAndForget(chrome().runtime && chrome().runtime.sendMessage(env)); },
  onMessage: (cb) => {
    chrome().runtime.onMessage.addListener((m) => { cb(m); return false; });
  },
  /**
   * `main` mints a one-shot capture claim in the arm path and this spends it.
   * A double cannot mint one, so it answers as a claim that was minted and is
   * being spent for the first time. THE CLAIM'S OWN RULES — spent twice, past
   * its deadline, never minted, revoked by CAPTURE_STOP — are `src/main/claims.js`
   * and are gated by `engine-host` over a real launch, not here.
   */
  claimCapture: async () => ({ ok: true }),
};

// ------------------------------------------------------------- the document
/**
 * THE ENGINE RENDERER HAS A DOCUMENT, AND `modelBytes` READS ITS ORIGIN.
 *
 * `offscreen/host.js` derives the weights' URL from `location.origin` because
 * they are served from this Host's own `app://` origin by `src/main/protocol.js`
 * — there is no download and no store (the model ships in the installer). In
 * plain Node there is no document, so the duty refuses, and SIX model assertions
 * report that refusal instead of reporting on the code they are about.
 *
 * Supplying the origin is the same act as supplying the bridge: it is the
 * platform the module was written for. What it does NOT supply is a store — so
 * the three assertions that are about the extension's Cache API pin stay red,
 * correctly, and are justified in `docs/CONFORMANCE.md` rather than shimmed away.
 */
const APP_ORIGIN = 'app://workbench';

/**
 * `__wbDeck` IS RE-EXPOSED ON EVERY `window` THE HARNESS INSTALLS, and that is a
 * faithful model of `contextBridge.exposeInMainWorld` rather than a trick.
 *
 * MEASURED, not guessed: `test.js:5576` and `:7070` assign `globalThis.window`
 * wholesale — the group drives the extension's `window.parent !== window` frame
 * question by swapping in a framed window and then a lone one. A single
 * assignment of `window.__wbDeck` at install time is wiped by the first of them,
 * and the deck half then reports on an absent bridge for the rest of the run
 * (the first attempt did exactly that: "window.__wbDeck is absent").
 *
 * The real preload puts the bridge on whatever window the renderer has. So does
 * this: the setter re-exposes it, the getter hands back whatever the harness
 * last assigned, and `test.js:7394` restores the original descriptor at the end
 * because this one is `configurable`.
 */
let currentWindow = globalThis.window || globalThis;
const expose = (w) => { if (w && typeof w === 'object') w.__wbDeck = wbDeck; return w; };
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  enumerable: true,
  get: () => currentWindow,
  set: (w) => { currentWindow = expose(w); },
});
expose(currentWindow);
globalThis.__wbEngine = wbEngine;
if (!globalThis.location) {
  globalThis.location = { origin: APP_ORIGIN, href: `${APP_ORIGIN}/engine.html` };
}

/**
 * A MARKER THE SUITE CAN SEE. `tools/suites/conformance.mjs` asserts the group
 * really ran under this platform: a run that silently loaded without it would
 * produce the crash again, and a suite that could not tell the two apart would
 * report the crash as a conformance result.
 */
globalThis.__wbConformancePlatform = { installed: true, deck: true, engine: true, origin: APP_ORIGIN };
console.log('[conformance-platform] installed: window.__wbDeck, __wbEngine, location.origin='
  + `${APP_ORIGIN} — the hole modules' own platform, doubled. See tools/conformance-platform.mjs.`);
