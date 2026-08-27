/**
 * The DECK renderer's bridge. `contextIsolation: true`, `sandbox: true`,
 * `nodeIntegration: false`.
 *
 * IT IS THE NARROW THING THE HOLE MODULE CLOSES OVER, and nothing more. The
 * fourteen members of `DeckHost` — six duties, six `DeckPage` duties and six
 * `DeckTransport` duties across two namespaces — are implemented in
 * `vendor/stem-splitter-live/extension/ui/host.js`, which is OURS and lives at a
 * unit path because the unit imports it by path. This file carries the wires
 * that module needs and holds no policy: no area check, no write-set filter, no
 * address guard. Each of those lives once, in the hole module, where the rule it
 * implements is written down next to it.
 *
 * ---------------------------------------------------------------------------
 * THE SHAPE RULE, AND THE MISTAKE IT AVOIDS
 * ---------------------------------------------------------------------------
 * `shared/host.js` names the Electron mistake by name: *"an Electron preload
 * bridge wrapped one level too deep hands over `{ send: fn }`"*, and *"a duty
 * implemented as a method that needs its `this` … passes this check, works for
 * the four duties the engine calls through the namespace, and fails only at the
 * first worklet load"*.
 *
 * So every member below is an ARROW FUNCTION that closes over what it needs and
 * reads no `this`, and the hole module never re-exports this object — it calls
 * through it. `tools/suites/deck-host.mjs` calls a DETACHED duty
 * (`const f = host.storageGet; await f('local', 'prefs')`) for exactly that
 * reason.
 *
 * ---------------------------------------------------------------------------
 * FOUR CHANNELS, AND ONE OF THEM IS SOMEBODY ELSE'S
 * ---------------------------------------------------------------------------
 *   'bus'              the UNIT's bus, routed by `src/main/bus.js`. The envelope
 *                      on it is the unit's protocol and this file carries it
 *                      verbatim in both directions.
 *   'page'             deck <-> main for `page` and `transport`, owned by
 *                      `src/main/transport.js` — `{c: …}` up, `{t: …}` down.
 *                      That module already speaks this protocol to the source
 *                      view's preload, so the deck host adopts its spelling
 *                      rather than inventing a second one.
 *   'deck:storage:*'   the two storage areas, owned by `src/main/storage.js`
 *                      through `src/main/deck-host.js`.
 *   'deck:armShortcut' the accelerator the application menu actually took.
 *
 * `deck:profile` IS SYNCHRONOUS, AND IT IS THE ONLY ONE. `ui/embed.js` reads
 * `host.transport != null` at MODULE SCOPE, so "is there a player above me" has
 * to be answerable before the deck's first line runs; there is no promise the
 * unit would await. `sendSync` blocks this renderer once, at preload time,
 * before any document exists. The alternative — defaulting to "no player" until
 * an async answer arrives — is the branch `follow()` reads as licence to start a
 * capture on boot, so it is not a default this Host is allowed to have.
 *
 * A sandboxed preload cannot `require` a relative file, so the bus bridge below
 * is duplicated from `engine.cjs` rather than shared. That is Electron's
 * constraint, not a preference.
 */
const { contextBridge, ipcRenderer } = require('electron');

const BUS_CHANNEL = 'bus';
const PAGE_CHANNEL = 'page';
const STORAGE_GET = 'deck:storage:get';
const STORAGE_SET = 'deck:storage:set';
const STORAGE_WATCH = 'deck:storage:watch';
const STORAGE_CHANGED = 'deck:storage:changed';
const ARM_SHORTCUT = 'deck:armShortcut';
const PROFILE = 'deck:profile';

/**
 * One ipc listener per channel, fanned out to however many handlers the hole
 * module registered. `_event` NEVER crosses the bridge: handing a renderer the
 * ipc event object hands it `sender`, and through it the whole main-process
 * surface.
 *
 * A HANDLER THAT THROWS DOES NOT STOP THE OTHERS, and it is reported rather than
 * swallowed. The deck registers one handler per message type and a throw inside
 * one of them is a defect in the deck, not a transport failure — the console is
 * where it belongs, and taking the rest of the feed down with it would turn one
 * broken painter into a deck that stops updating at all.
 */
const fanout = (channel) => {
  const listeners = new Set();
  ipcRenderer.on(channel, (_event, msg) => {
    for (const fn of [...listeners]) {
      try { fn(msg); } catch (err) { console.error(`[wb] ${channel} listener threw`, err); }
    }
  });
  return (fn) => {
    if (typeof fn !== 'function') throw new TypeError(`${channel}: a listener must be a function`);
    listeners.add(fn);
    return () => listeners.delete(fn);
  };
};

const onBus = fanout(BUS_CHANNEL);
const onPage = fanout(PAGE_CHANNEL);
const onStorage = fanout(STORAGE_CHANGED);

/**
 * What main knows about this deck before it has drawn anything. It is an object
 * rather than a bare boolean because the second field — which Source kind this
 * deck is bound to — is a fact of the same shape and must not cost a second
 * synchronous round trip at boot. That reservation is now spent: the profile
 * carries `{ hosted, sourceKind }`.
 *
 * STILL EXACTLY ONE `sendSync`. A second one is a second thing that can hang
 * before the deck has drawn anything, and the deck reads both answers at module
 * scope.
 */
const profile = ipcRenderer.sendSync(PROFILE);

contextBridge.exposeInMainWorld('__wbDeck', {
  /**
   * `DeckHost.send` carries a FINISHED envelope — freeze item 5's asymmetry: the
   * engine's `send` stamps `{v:1, to:'ui', from:'off'}` and the deck's does not.
   * Neither stamper is here. `main` reads `msg.to` to route and reads nothing
   * else; nothing on this path adds, renames or drops a field.
   */
  send: (msg) => ipcRenderer.send(BUS_CHANNEL, msg),
  /** @returns an unsubscribe function. The address guard is the hole module's. */
  onMessage: onBus,

  /**
   * Is there a player above this deck. Read synchronously at preload time — see
   * the header — and handed over as whatever main said, including a wrong type:
   * the hole module refuses anything that is not a boolean rather than coercing
   * it, because the coercion of a missing answer is the dangerous direction.
   */
  hosted: profile && profile.hosted,

  /**
   * Which kind of Source this deck is bound to — `'live'` or `'file'`. Handed
   * over as whatever main said, wrong type included, for the same reason
   * `hosted` is: the hole module refuses what it does not recognise rather than
   * coercing it, and the coercion of a missing answer is the dangerous
   * direction. `main` validates this against a closed set at install
   * (`src/main/deck-host.js` SOURCE_KINDS), so a value arriving here that is not
   * in that set means the bridge, not the decision, is what went wrong.
   */
  sourceKind: profile && profile.sourceKind,

  /**
   * `{ok:true, value}` or `{ok:false, error}`, never a bare value. An ipc
   * rejection flattens into something the caller cannot tell from an absent key,
   * and absent-vs-unreadable is the whole point of this duty (`shared/host.js`
   * rule 6). The envelope is what survives the hop; the hole module unwraps it.
   */
  storageGet: (area, key) => ipcRenderer.invoke(STORAGE_GET, area, key),
  /** Fire and forget: the value is already on screen. */
  storageSet: (area, key, value) => ipcRenderer.send(STORAGE_SET, area, key, value),
  /**
   * Tell main which (area, key) this deck wants to hear about. Separate from
   * `onStorageChanged` because main must not push every change in the app to a
   * renderer that asked about one key — the filter is the Host's, and the cheap
   * half of it belongs on main's side of the hop.
   */
  storageWatch: (area, key) => ipcRenderer.send(STORAGE_WATCH, area, key),
  /** @returns an unsubscribe function. Delivers `{area, key, value}`. */
  onStorageChanged: onStorage,

  /** The accelerator the application menu really took, or null. Read at call time. */
  armShortcut: () => ipcRenderer.invoke(ARM_SHORTCUT),

  /**
   * `page` and `transport`, both directions. The protocol is
   * `src/main/transport.js`'s: `{c: 'drive'|'release'|'requestSpeed'|
   * 'claimKeys'|'height'|'close'|'ready'}` out, `{t: 'video'|'jump'|'speed'|
   * 'key'|'autonav'}` in.
   */
  pageSend: (msg) => ipcRenderer.send(PAGE_CHANNEL, msg),
  /** @returns an unsubscribe function. */
  onPageEvent: onPage,
});
