#!/usr/bin/env node
/**
 * deck-host — the DeckHost seam: fourteen members, three messages nothing can
 * check for us, and the wire that would otherwise leave a checkbox dead.
 *
 * TWO HALVES, AND NEITHER STANDS IN FOR THE OTHER.
 *
 *   §1 THE CONFORMANCE HALF — plain node, no window, no launch, no mutex. It
 *      imports the SHIPPED hole module (`vendor/…/extension/ui/host.js`) over a
 *      stub bridge and drives it with the UNIT'S OWN `assertHost`,
 *      `assertHostOption` and duty tables. This is `docs/VENDORING.md` option 3
 *      — "point the group at your files" — for the deck's half of
 *      `test.js`'s `group('host')`: the same claims, about our implementation,
 *      in a harness that can stub the platform this Host actually has.
 *
 *   §2 THE LAUNCH HALF — one real `electron .`, the real preload, the real ipc,
 *      the real vendored deck. It asserts over `out/deck-host/report.json`,
 *      which `tools/gate/deck-host.mjs` writes from inside that launch.
 *
 * The conformance half can prove things the launch cannot (a bridge that can be
 * swapped after boot; a Host that answers `hosted: undefined`), and the launch
 * half can prove things no stub can (the deck really paints; a `<video>` on
 * another page really moves). A stub that agreed with a broken app, and an app
 * that agreed with a broken stub, are both failures this pair is arranged to
 * catch.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT GATE, stated so the absence is on the record
 * ---------------------------------------------------------------------------
 *   · THE ENGINE HALF OF THE SEAM. `offscreen/host.js`, `captureStream`,
 *     `modelBytes` and the three messages addressed to `BUS.engine` are the
 *     engine slice's (`tools/suites/engine-host.mjs`).
 *   · THE SOURCE VIEW'S OWN BEHAVIOUR. That a `<video>` is driven correctly
 *     through a YouTube page, that L1 holds in the preload, and that the
 *     autoplay toggle is really found and clicked, are `transport`'s
 *     (`tools/suites/transport.mjs`). What is asserted HERE is only that the
 *     deck's fourteen members reach it and that what comes back reaches the
 *     deck.
 *   · SIX STEMS. Nothing here proves the engine produces audio inside this app.
 *   · `test.js`'s `group('host')` ITSELF. Its deck half installs a `chrome`
 *     platform and drives the extension's implementation; against ours it goes
 *     red, because there is no `chrome` here to stub. §1 is the same set of
 *     claims re-aimed, and the vendored group is left alone — see the report in
 *     the commit that introduced this file.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  assertHost, assertHostOption, BUS,
  DECK_HOST_DUTIES, DECK_PAGE_DUTIES, DECK_TRANSPORT_DUTIES,
} from '../../vendor/stem-splitter-live/extension/shared/host.js';
import { chordLabel } from '../../vendor/stem-splitter-live/extension/ui/embed-state.js';
import { ARM_CODES as DECK_ARM_CODES } from '../../vendor/stem-splitter-live/extension/ui/audio-math.js';
import { ARM_ERROR_KEY, PREFS_KEY } from '../../vendor/stem-splitter-live/extension/shared/config.js';
import { createStorage, AREAS } from '../../src/main/storage.js';
import { ARM_ACCEL, chordIsSpellable, deckTakesKey } from '../../src/main/keys.js';

const ID = 'deck-host';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'out', ID);
const HOST_FILE = path.join(ROOT, 'vendor', 'stem-splitter-live', 'extension', 'ui', 'host.js');
const DECK_ENTRY = 'vendor/stem-splitter-live/extension/ui/embed.html';

/** The shared browser mutex — sibling agents run browsers on this machine. */
const LOCK = process.env.STEM_WORKBENCH_BROWSER_LOCK
  || path.join(os.tmpdir(), `stem-workbench-browser-${process.getuid ? process.getuid() : 'x'}.lock`);

// --------------------------------------------------------------- the harness
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  cond ? pass++ : fail++;
};
const done = () => {
  console.log(`\n${ID}: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};
const skip = (why) => { console.log(`SKIPPED — ${why}`); process.exit(0); };

/** A report field is not a promise: read every one of them defensively. */
const A = (v) => (Array.isArray(v) ? v : []);
const O = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Run a check that is ALLOWED TO THROW and keep the throw as a value.
 *
 * `assertHost` throws by design — that IS its report — and a throw inside an
 * `ok()` argument takes the whole process down with no FAIL line, which is the
 * VOID case wearing a stack trace: the mutation that proves the assertion works
 * produces zero reds and every assertion after it never runs. Measured on this
 * suite: removing one duty from the hole module scored 0 reds until this existed.
 */
const tried = (fn) => { try { return fn(); } catch (e) { return e; } };

// ==========================================================================
// §1  THE CONFORMANCE HALF — the shipped module, a stub platform, no browser
// ==========================================================================

/**
 * The bridge `src/preload/deck.cjs` exposes, as a recorder.
 *
 * IT IS THE PLATFORM THAT IS STUBBED, NEVER THE HOST. Every assertion below
 * drives `vendor/…/ui/host.js` itself; a check that reimplemented the module it
 * is guarding would be a second copy of the bug. Same rule the vendored
 * `test.js` states for the extension's half, and the reason its `chrome` stub
 * exists at all.
 */
function makeBridge({ hosted = true, storage = {}, fail = null } = {}) {
  const b = {
    hosted,
    sent: [], pages: [], sets: [], watches: [],
    busListeners: [], pageListeners: [], storageListeners: [],
    send: (msg) => { b.sent.push(msg); },
    onMessage: (fn) => { b.busListeners.push(fn); return () => {}; },
    storageGet: async (area, key) => {
      if (fail && fail.area === area && fail.key === key) return { ok: false, error: fail.error };
      const bag = storage[area] || {};
      // ABSENT IS SPELLED AS AN ANSWER WITH NO `value` FIELD, which is what an
      // ipc handler that returned nothing for the key really sends. Answering
      // `value: null` here would make the seam's own `undefined -> null` line
      // unreachable — measured: mutating that line away produced no red at all.
      if (!Object.prototype.hasOwnProperty.call(bag, key)) return { ok: true };
      return { ok: true, value: bag[key] };
    },
    storageSet: (area, key, value) => { b.sets.push({ area, key, value }); },
    storageWatch: (area, key) => { b.watches.push({ area, key }); },
    onStorageChanged: (fn) => { b.storageListeners.push(fn); return () => {}; },
    armShortcut: async () => b.chord,
    chord: ARM_ACCEL,
    pageSend: (msg) => { b.pages.push(msg); },
    onPageEvent: (fn) => { b.pageListeners.push(fn); return () => {}; },
  };
  return b;
}

/**
 * Import the shipped module over a fresh stub. The query string busts the ESM
 * cache so `hosted` — which the module reads ONCE, at import, because
 * `ui/embed.js` reads `host.transport != null` at module scope — can be driven
 * both ways in one process.
 */
let importN = 0;
async function loadHost(bridge) {
  globalThis.window = bridge ? { __wbDeck: bridge } : {};
  const mod = await import(`${pathToFileURL(HOST_FILE).href}?n=${++importN}`);
  return mod.host;
}

{
  // ---------------------------------------------------- the boot check
  const bridge = makeBridge();
  const host = await loadHost(bridge);

  ok('assertHost accepts the SHIPPED Electron DeckHost — this is the gate on its export list  '
    + '[entry point: vendor/…/extension/ui/host.js, the module ui/embed.js imports]',
    tried(() => assertHost(host, DECK_HOST_DUTIES, 'DeckHost')) === host,
    String((tried(() => assertHost(host, DECK_HOST_DUTIES, 'DeckHost')) || {}).message || Object.keys(DECK_HOST_DUTIES).join(', ')));

  ok('...and `page`, against the unit\'s own DECK_PAGE_DUTIES  [entry point: assertHost(host.page, …) at ui/embed.js:120]',
    tried(() => assertHost(host.page, DECK_PAGE_DUTIES, 'DeckHost.page')) === host.page,
    String((tried(() => assertHost(host.page, DECK_PAGE_DUTIES, 'DeckHost.page')) || {}).message || Object.keys(DECK_PAGE_DUTIES).join(', ')));

  /**
   * SPELLED, NEVER MERELY PRESENT. `assertHostOption` refuses a Host that never
   * MENTIONED a transport, because the deck reads `host.transport != null` as a
   * fact about the world and boots on it: with no transport, `follow()` treats
   * "nobody will ever tell me whether the video is playing" as licence to start
   * a capture — and behind it a 109 MB model download — on a page nobody
   * pressed play on.
   */
  const t = tried(() => assertHostOption(host, 'transport', DECK_TRANSPORT_DUTIES, 'DeckHost'));
  ok('...and `transport` is SPELLED and satisfies all six DeckTransport duties when this Host is hosted  '
    + '[entry point: assertHostOption at ui/embed.js:130]',
    t !== null && !(t instanceof Error) && Object.keys(DECK_TRANSPORT_DUTIES).every((k) => typeof t[k] === 'function'),
    t instanceof Error ? t.message : (t ? Object.keys(DECK_TRANSPORT_DUTIES).join(', ') : 'transport was null on a hosted deck'));

  /**
   * NO DUTY MAY NEED ITS `this`. `shared/host.js` names this as the Electron
   * mistake — a bridge re-exported one level too deep, or a shorthand method
   * that reads `this` — and it fails LATE, at a user gesture, which is what
   * `assertHost` exists to move to boot. Every duty is called DETACHED here.
   */
  const detached = [];
  {
    const send = host.send, set = host.storageSet, get = host.storageGet;
    const claimKeys = (host.page || {}).claimKeys, drive = (host.transport || {}).drive;
    try { send({ v: 1, to: 'off', from: 'ui', type: 'DETACHED' }); detached.push('send'); } catch { /* recorded by absence */ }
    try { set('local', 'k', 1); detached.push('storageSet'); } catch { /* … */ }
    try { await get('local', 'k'); detached.push('storageGet'); } catch { /* … */ }
    try { claimKeys({ armed: true, keys: ['Digit1'] }); detached.push('page.claimKeys'); } catch { /* recorded by absence */ }
    try { drive({ muted: true }); detached.push('transport.drive'); } catch { /* … */ }
  }
  ok('every duty works UNBOUND — `const f = host.send; f(msg)` — so no member is a method that needs its `this`',
    detached.length === 5, `${detached.length}/5: ${detached.join(', ')}`);
}

{
  // ------------------------------------------------- hosted is a decision
  const host = await loadHost(makeBridge({ hosted: false }));
  ok('a Host with no player spells `transport: null` rather than omitting the key',
    'transport' in host && host.transport === null
    && tried(() => assertHostOption(host, 'transport', DECK_TRANSPORT_DUTIES, 'DeckHost')) === null,
    `'transport' in host = ${'transport' in host}, value = ${String(host.transport)}`);

  /**
   * IMPORTING THE MODULE IS INERT, AND THAT IS LOAD-BEARING RATHER THAN TIDY.
   *
   * An earlier version of this hole THREW at module scope when the bridge was
   * missing. The vendored gate is what proved that wrong: the deck half of
   * `test.js`'s `group('host')` imports both holes under plain Node to report
   * on them, and a module-scope throw does not produce a RED — it CRASHES the
   * suite. Measured by the engine slice: the run died at `test.js:5577` after
   * 482 assertions and every assertion after it never ran. A crash is strictly
   * worse than a failure, because it hides the reds somebody is trying to read.
   *
   * So: nothing at module scope touches a browser-only global in a way that can
   * throw, and this is the assertion that keeps it that way.
   */
  let importThrew = null;
  let hostless = null;
  try { hostless = await loadHost(null); } catch (e) { importThrew = e; }
  ok('importing the hole module is INERT — a deck renderer with no bridge yields a Host, not a crash  '
    + "[entry point: the vendored test.js group('host'), which imports both holes under plain node]",
    importThrew === null && hostless !== null && typeof hostless.send === 'function',
    importThrew ? `THREW at import: ${importThrew.message.slice(0, 90)}`
      : 'a module-scope throw does not produce a red, it crashes the suite that was reading them');

  /**
   * ...AND "I COULD NOT ASK" DOES NOT COLLAPSE INTO "THERE IS NO PLAYER".
   *
   * Three states, and the third is the one that matters. A Host that says
   * `transport: null` is making a CLAIM ABOUT THE WORLD which the deck acts on:
   * it concludes nobody will ever tell it whether the video is playing, and
   * `follow()` treats that as licence to start a capture — and behind it a
   * 109 MB download — on a page nobody pressed play on. "There is no bridge to
   * ask" is not that claim, so it must not be spelled as it.
   *
   * WHAT IT IS SPELLED AS INSTEAD, and why it is not a throw: the vendored
   * group('host') calls these duties as BARE STATEMENTS, so a throw crashes the
   * conformance report rather than appearing in it. So the answer is a namespace
   * whose duties are inert AND ONE console.error NAMING THE FILE — which is the
   * difference between this and the silent failure `shared/host.js` calls the
   * quietest on the seam.
   */
  const said = [];
  const realError = console.error;
  console.error = (...a) => { said.push(a.join(" ")); };
  let threw = null;
  try {
    hostless.transport.drive({ muted: true });   // hostless is null if the import threw — the catch below is the red
    hostless.transport.release();
    hostless.transport.requestSpeed(1.5);
    hostless.page.claimKeys({ armed: true, keys: ['Digit1'] });
  } catch (e) { threw = e; } finally { console.error = realError; }
  ok('...and a Host that COULD NOT ASK answers a namespace rather than a null transport, so the deck does not read it as "start on boot"',
    hostless !== null && hostless.transport !== null && threw === null,
    hostless === null ? 'the module threw at import, so there is nothing to ask'
      : hostless.transport === null ? 'it collapsed into a null transport'
      : `four duties called with no bridge: ${threw ? `THREW ${threw.message.slice(0, 60)}` : "no throw, so the vendored group can still report"}`);

  ok('...and it says so ONCE, on the console, naming the preload — inert is not silent, and a flood is not a sentence',
    said.length === 1 && /__wbDeck/.test(said[0]) && /deck\.cjs/.test(said[0]),
    `${said.length} console.error(s) for four undeliverable duties: ${JSON.stringify(String(said[0] || "").slice(0, 90))}`);

  const notABoolean = await loadHost({ ...makeBridge(), hosted: undefined }).catch(() => null);
  ok('...and a bridge that answered the hosted question with something that is not a boolean is read the same way',
    notABoolean !== null && notABoolean.transport != null,
    !notABoolean || notABoolean.transport === null ? 'a non-boolean answer was taken as "there is no player"'
      : `transport is a ${typeof notABoolean.transport}, not the claim that there is no player`);
}

{
  // ------------------------------------------------------- the outgoing wire
  const bridge = makeBridge();
  const host = await loadHost(bridge);

  const env = { v: 1, to: BUS.engine, from: BUS.deck, type: 'PITCH', deck: 'A', semitones: 2 };
  const ret = host.send(env);
  ok('send carries the FINISHED envelope verbatim — no field added, renamed or dropped  '
    + '[entry point: ui/host.js send(), reached from toOff()/toSw() in ui/embed.js]',
    bridge.sent.length === 1 && eq(bridge.sent[0], env),
    bridge.sent.length ? Object.keys(bridge.sent[0]).sort().join(',') : 'nothing reached the transport');

  ok('...and returns nothing, so no call site can start awaiting delivery',
    ret === undefined, String(ret));

  /**
   * THE LATE-BINDING RULE — `shared/host.js` rule 2, and the reason it is
   * asserted HERE rather than in the launch: `contextBridge` hands the page a
   * deeply immutable object, so the property cannot be swapped from inside the
   * renderer at all (the launch half records that separately). A Host that
   * captured its transport at import — `const send = window.__wbDeck.send` —
   * leaves any recorder empty, and `[].every()` and `![].some()` are both true,
   * so assertions over that wire go GREEN WHILE INSPECTING NOTHING.
   */
  const after = [];
  bridge.send = (m) => { after.push(m); };
  host.send({ v: 1, to: BUS.host, from: BUS.deck, type: 'SW_STATUS' });
  ok('send resolves the transport at CALL time: a bridge member replaced after boot receives the next message  '
    + '[entry point: ui/host.js send()]',
    bridge.sent.length === 1 && after.length === 1 && after[0].type === 'SW_STATUS',
    `${bridge.sent.length} before the swap, ${after.length} after — a bound transport gives 2 and 0`);
}

{
  // ------------------------------------------------------- the incoming wire
  const bridge = makeBridge();
  const host = await loadHost(bridge);
  const seen = [];
  const ret = host.onMessage((m) => { seen.push(m); return true; });

  ok('INSTRUMENT CHECK: onMessage registered exactly one listener on the bus',
    bridge.busListeners.length === 1, `${bridge.busListeners.length} registered`);

  const mine = { v: 1, to: BUS.deck, from: BUS.engine, type: 'LIVE_STATE', status: 'running', latencySec: 1.5 };
  const rets = [
    bridge.busListeners[0]({ v: 1, to: BUS.host, from: BUS.deck, type: 'SW_STATUS' }),
    bridge.busListeners[0]({ v: 1, to: BUS.engine, from: BUS.deck, type: 'STATUS' }),
    bridge.busListeners[0](null),
    bridge.busListeners[0](mine),
  ];
  ok('onMessage delivers ONLY what is addressed to this context — 1 of 4  [entry point: ui/host.js onMessage()]',
    seen.length === 1 && seen[0].type === 'LIVE_STATE',
    `${seen.length} delivered of 4 (to: sw, off, null, ui)`);
  ok('...and hands the deck the SAME message, envelope and all',
    seen.length === 1 && seen[0] === mine && seen[0].v === 1 && seen[0].from === BUS.engine);
  ok('...and drops what the deck returns, so a handler cannot start meaning something to the transport',
    rets.every((r) => r === undefined) && ret === undefined,
    rets.map(String).join(' '));
}

{
  // ------------------------------------------------------------- storage
  const bridge = makeBridge({
    storage: { local: { [PREFS_KEY]: { autoplayNext: true } }, session: { [PREFS_KEY]: { autoplayNext: false } } },
    fail: { area: 'session', key: ARM_ERROR_KEY, error: 'the store could not be read' },
  });
  const host = await loadHost(bridge);

  const fromLocal = await host.storageGet('local', PREFS_KEY);
  const fromSession = await host.storageGet('session', PREFS_KEY);
  ok('storageGet READS THE AREA IT WAS GIVEN: one key held in both areas comes back as two different values  '
    + '[entry point: ui/host.js storageGet(), reached from embed.js for local/prefs and session/armError]',
    fromLocal && fromSession && fromLocal.autoplayNext === true && fromSession.autoplayNext === false,
    `local ${JSON.stringify(fromLocal)}, session ${JSON.stringify(fromSession)} — a Host that hard-coded one area returns the same object twice`);

  ok('...and an absent key RESOLVES null rather than rejecting',
    await host.storageGet('local', 'nothing-is-here') === null);

  const unreadable = await host.storageGet('session', ARM_ERROR_KEY).then(() => null, (e) => e);
  ok('...while a read that FAILED rejects — absent and unreadable are different answers (rule 6)',
    unreadable instanceof Error && /could not be read/.test(unreadable.message),
    unreadable ? unreadable.message.slice(0, 90) : 'an unreadable store resolved as if the key were absent');

  /**
   * THE AREA REFUSALS DIFFER IN SHAPE, and rule 5 says which is which: the
   * preferences read is a module-scope `.then().catch()` that a synchronous
   * throw would jump straight past, taking the rest of the deck's boot with it,
   * so `storageGet` REJECTS; the other two THROW at the call site, because a
   * wrong area there is the deck being wrong about a value it wrote itself.
   */
  const badGet = await host.storageGet('sync', 'x').then(() => null, (e) => e);
  let badSet = null, badWatch = null;
  try { host.storageSet('sync', 'x', 1); } catch (e) { badSet = e; }
  try { host.onStorageChanged('sync', 'x', () => {}); } catch (e) { badWatch = e; }
  ok('an area outside {local, session} is REFUSED — storageGet rejects, storageSet and onStorageChanged throw',
    badGet instanceof Error && badSet instanceof Error && badWatch instanceof Error
    && [badGet, badSet, badWatch].every((e) => /not a storage area/.test(e.message)),
    `get ${badGet ? 'rejected' : 'RESOLVED'}, set ${badSet ? 'threw' : 'RETURNED'}, watch ${badWatch ? 'threw' : 'RETURNED'}; `
    + `areas are ${AREAS.join(', ')} — sync is a network write and P1 forbids it`);

  ok('storageSet returns undefined and does not reach for the bad area\'s store',
    host.storageSet('local', 'k', 2) === undefined && bridge.sets.length === 1
    && eq(bridge.sets[0], { area: 'local', key: 'k', value: 2 }),
    JSON.stringify(bridge.sets));

  /**
   * THE AREA/KEY FILTER IS THE HOST'S — the same reason the address guard on
   * `onMessage` is. Main pushes `{area, key, value}` and this is what unpicks
   * it; a Host that handed every change to the deck would have the deck applying
   * another key's value to its preferences.
   */
  const got = [];
  host.onStorageChanged('local', PREFS_KEY, (v) => got.push(v));
  const feed = bridge.storageListeners[0];
  feed({ area: 'session', key: PREFS_KEY, value: 'wrong area' });
  feed({ area: 'local', key: 'somethingElse', value: 'wrong key' });
  feed({ area: 'local', key: PREFS_KEY, value: { autoplayNext: false } });
  feed({ area: 'local', key: PREFS_KEY, value: undefined });
  ok('onStorageChanged filters by BOTH area and key, and reports a removal as undefined  '
    + '[entry point: ui/host.js onStorageChanged(), reached from embed.js boot for local/prefs]',
    got.length === 2 && eq(got[0], { autoplayNext: false }) && got[1] === undefined
    && eq(bridge.watches[0], { area: 'local', key: PREFS_KEY }),
    `${got.length} of 4 delivered; watch registered ${JSON.stringify(bridge.watches)}`);
}

{
  // ---------------------------------------------------------- the arm chord
  const bridge = makeBridge();
  const host = await loadHost(bridge);
  const raw = await host.armShortcut();

  ok('armShortcut answers RAW, in the tokens chordLabel() can spell — never Electron\'s own grammar  '
    + '[entry point: ui/host.js armShortcut(), reached from embed.js boot]',
    raw === ARM_ACCEL && chordIsSpellable(raw) && !/CommandOrControl/.test(raw),
    `${JSON.stringify(raw)} -> drawn ${JSON.stringify(chordLabel(raw, false).text)} on a PC, `
    + `${JSON.stringify(chordLabel(raw, true).text)} on a Mac`);

  ok('...and the unit can spell every token in it: the key cap says the chord, not a word',
    chordLabel(ARM_ACCEL, false).text === ARM_ACCEL
    && chordLabel(ARM_ACCEL, true).text === (process.platform === 'darwin' ? '⌘⇧A' : '⌃⇧A'),
    `PC ${chordLabel(ARM_ACCEL, false).text} · Mac ${chordLabel(ARM_ACCEL, true).text} · say "${chordLabel(ARM_ACCEL, true).say}"`);

  bridge.chord = '';
  ok('...and an accelerator the menu could not take answers `null`, not an empty key cap',
    await host.armShortcut() === null && chordLabel(null, false) === null);
}

{
  // ------------------------------------------------------ the closed write set
  const bridge = makeBridge();
  const host = await loadHost(bridge);

  host.transport.drive({ muted: true, playbackRate: 1.25, currentTime: 4.5, volume: 0.1, evil: true, src: 'x' });
  const cmd = bridge.pages[0] || {};
  ok('drive writes muted, playbackRate and currentTime — THOSE THREE AND NOTHING ELSE  '
    + '[entry point: ui/host.js transport.drive(), ADR 0001 decision 4]',
    eq(Object.keys(cmd).sort(), ['c', 'currentTime', 'muted', 'playbackRate']),
    `${JSON.stringify(cmd)} — volume, evil and src were dropped at the seam; L1 is a security property `
    + 'and this channel reaches a <video> on somebody else\'s page');

  host.transport.drive({ playbackRate: 'fast', currentTime: NaN, muted: 'yes' });
  ok('...and a value of the wrong type is dropped rather than coerced onto the element',
    eq(bridge.pages[1], { c: 'drive' }), JSON.stringify(bridge.pages[1]));

  host.transport.requestSpeed(3);
  ok('requestSpeed is NOT filtered: an out-of-range rate goes on the wire to be refused and REPORTED  '
    + '[entry point: ui/host.js transport.requestSpeed()]',
    eq(bridge.pages[2], { c: 'requestSpeed', rate: 3 }),
    `${JSON.stringify(bridge.pages[2])} — a silent drop would replace an explained lockout with a control that does nothing`);

  host.transport.release();
  host.page.claimKeys({ armed: true, keys: ['Digit1', 'Escape'] });
  host.page.setHeight(412);
  host.page.ready();
  host.page.close();
  ok('the six page duties and release each put exactly one named command on the wire',
    eq(bridge.pages.slice(3), [
      { c: 'release' },
      { c: 'claimKeys', armed: true, keys: ['Digit1', 'Escape'] },
      { c: 'height', px: 412 },
      { c: 'ready' },
      { c: 'close' },
    ]),
    JSON.stringify(bridge.pages.slice(3)));

  const keys = [], autonav = [], state = [], jumps = [], speeds = [];
  host.page.onKey((d) => keys.push(d));
  host.page.onAutonav((d) => autonav.push(d));
  host.transport.onState((d) => state.push(d));
  host.transport.onJump(() => jumps.push(1));
  host.transport.onSpeedReport((d) => speeds.push(d));
  const feed = bridge.pageListeners[0];
  ok('INSTRUMENT CHECK: the five inbound duties registered exactly one page listener between them',
    bridge.pageListeners.length === 1, `${bridge.pageListeners.length} registered`);
  feed({ t: 'key', code: 'Digit1' });
  feed({ t: 'autonav', state: 'missing' });
  feed({ t: 'video', playing: true, currentTime: 2 });
  feed({ t: 'jump' });
  feed({ t: 'speed', state: 'ok', applied: 1.25 });
  feed({ t: 'nobody-registered-this' });
  ok('...and each inbound type reaches its own handler and no other',
    keys.length === 1 && autonav.length === 1 && state.length === 1 && jumps.length === 1 && speeds.length === 1
    && state[0].playing === true && speeds[0].state === 'ok',
    `key ${keys.length} autonav ${autonav.length} video ${state.length} jump ${jumps.length} speed ${speeds.length}`);
}

// ==========================================================================
// §1b  THE TWO LIFETIMES — src/main/storage.js, without a launch
// ==========================================================================
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-storage-'));
  const s1 = createStorage({ dir });

  ok('a fresh profile answers `null` for a key nobody has written — absent is the ordinary case  '
    + '[entry point: src/main/storage.js get()]',
    s1.get('local', PREFS_KEY) === null && s1.get('session', ARM_ERROR_KEY) === null);

  s1.set('local', PREFS_KEY, { autoplayNext: false, instrument: 'alto' });
  s1.set('session', ARM_ERROR_KEY, { code: 'ARM_FAILED', at: Date.now(), seq: 1 });

  /**
   * THE WHOLE REASON THE DECK NAMES TWO AREAS. A preference must survive a
   * restart and a refusal to arm must NOT — a stale refusal painted as current
   * teaches the user to ignore the banner, which is the more expensive of the
   * two defects. A second store over the SAME directory is what a restart is.
   */
  const s2 = createStorage({ dir });
  ok('`local` OUTLIVES THE RUN and `session` does not — a second store over the same directory sees one and not the other',
    eq(s2.get('local', PREFS_KEY), { autoplayNext: false, instrument: 'alto' })
    && s2.get('session', ARM_ERROR_KEY) === null,
    `local ${JSON.stringify(s2.get('local', PREFS_KEY))} · session ${JSON.stringify(s2.get('session', ARM_ERROR_KEY))} `
    + `· the file is ${path.basename(s2.localFile)}`);

  /**
   * ABSENT AND UNREADABLE ARE DIFFERENT ANSWERS. A half-written JSON file after
   * a power cut is the second case, and it is the one where the deck must not
   * conclude the user never set anything: `applyPrefs(null)` DRAWS the defaults,
   * so folding them would apply defaults most confidently on the run where the
   * user's real choices existed and were unreachable.
   */
  fs.writeFileSync(s2.localFile, '{"prefs": {"autoplayNext": tr');
  const s3 = createStorage({ dir });
  let unreadable = null;
  try { s3.get('local', PREFS_KEY); } catch (e) { unreadable = e; }
  ok('...and a local store that is PRESENT and cannot be read throws, rather than answering `null`',
    unreadable instanceof Error && /could not be read/.test(unreadable.message) && s3.stats.unreadable === 1,
    unreadable ? unreadable.message.slice(0, 110) : 'a corrupt store answered as if the key were absent');

  const afterWrite = (() => {
    try { s3.set('local', PREFS_KEY, { autoplayNext: true }); return { got: s3.get('local', PREFS_KEY) }; }
    catch (e) { return { threw: e.message }; }
  })();
  ok('...and a write REPLACES the file, so the unreadable state does not outlive what caused it',
    eq(afterWrite.got, { autoplayNext: true }),
    afterWrite.threw ? `the store still refuses to be read after a write replaced it: ${String(afterWrite.threw).slice(0, 70)}`
      : JSON.stringify(afterWrite.got));

  const refusals = ['sync', 'managed', '', null].map((area) => {
    let g = null, s = null, w = null;
    try { s3.get(area, 'k'); } catch { g = 1; }
    try { s3.set(area, 'k', 1); } catch { s = 1; }
    try { s3.onChanged(area, 'k', () => {}); } catch { w = 1; }
    return g && s && w;
  });
  ok('...and every area outside the two lifetimes is refused by all three, in main as well as at the seam',
    refusals.every(Boolean), `${refusals.filter(Boolean).length}/4 refused`);

  const feed = [];
  s3.onChanged('local', PREFS_KEY, (v) => feed.push(v));
  s3.set('local', PREFS_KEY, { autoplayNext: false });
  s3.set('local', 'other', 1);
  s3.set('session', PREFS_KEY, 'wrong area');
  ok('the change feed fires for the key it was given and for no other  [entry point: storage.js onChanged()]',
    feed.length === 1 && eq(feed[0], { autoplayNext: false }), `${feed.length} of 3 writes reported`);

  fs.rmSync(dir, { recursive: true, force: true });
}

// ==========================================================================
// §1c  THE KEYS THE DECK CLAIMS — a pure decision
// ==========================================================================
{
  const claim = { armed: true, keys: ['Digit1', 'Digit2', 'Escape'] };
  const down = (code, extra = {}) => ({ type: 'keyDown', code, key: code.replace('Digit', ''), control: false, meta: false, ...extra });

  ok('a claimed key with a deck armed is the deck\'s  [entry point: src/main/keys.js deckTakesKey()]',
    deckTakesKey({ claim, input: down('Digit1'), typing: false }) === true);

  const guests = [
    ['with no deck armed, the page keeps its own shortcuts', { claim: { armed: false, keys: claim.keys }, input: down('Digit1'), typing: false }],
    ['a key the deck never claimed', { claim, input: down('KeyJ'), typing: false }],
    ['a keyUp', { claim, input: down('Digit1', { type: 'keyUp' }), typing: false }],
    ['a digit typed into a text field', { claim, input: down('Digit1'), typing: true }],
    ['Ctrl+1 — a chord belongs to whoever binds it, including our own menu', { claim, input: down('Digit1', { control: true }), typing: false }],
    ['Cmd+1', { claim, input: down('Digit1', { meta: true }), typing: false }],
    ['no claim at all', { claim: null, input: down('Digit1'), typing: false }],
    ['a claim with no keys', { claim: { armed: true, keys: [] }, input: down('Digit1'), typing: false }],
  ];
  const left = guests.filter(([, arg]) => deckTakesKey(arg) === false);
  ok('...and every other case is left to the page — we are a guest there',
    left.length === guests.length,
    `${left.length}/${guests.length}${left.length === guests.length ? '' : ` — TOOK ${guests.filter((g) => !left.includes(g)).map((g) => g[0]).join('; ')}`}`);

  ok('`?` is matched by CHARACTER and not by position, because which key makes it differs by layout',
    deckTakesKey({ claim, input: { type: 'keyDown', code: 'Slash', key: '?', control: false, meta: false }, typing: false }) === true);
}

// ==========================================================================
// §2  THE LAUNCH HALF
// ==========================================================================
/**
 * `DECK_HOST_ONLY=conformance` stops here.
 *
 * IT IS FOR THE MUTATION BATTERY AND FOR NOTHING ELSE. Every mutation that
 * lives in the hole module, in `storage.js` or in `keys.js` is visible in §1,
 * and §1 costs a second where a launch costs forty — so
 * `tools/suites/deck-host-mutations.mjs` runs those in this mode and the rest
 * with a real launch. The runner never sets it, and `docs/TESTING.md` says so:
 * a mode that skipped work on the default plan would be a suite reporting
 * coverage it does not have.
 *
 * IT IS NOT THE VOID CASE. §1 has already printed 29 assertions by here, so the
 * summary line below still carries a real count; a mode that asserted nothing
 * would be caught by the runner's own rule.
 */
if (process.env.DECK_HOST_ONLY === 'conformance') {
  console.log(`\n${ID}: conformance half only (DECK_HOST_ONLY=conformance) — the launch half did not run`);
  done();
}

const electron = path.join(ROOT, 'node_modules', '.bin', 'electron');
if (!fs.existsSync(electron)) skip('electron is not installed — npm i');
if (!hasBin('xvfb-run')) skip('xvfb-run is not on PATH and this box has no DISPLAY');
if (!hasBin('flock')) skip('flock is not on PATH — the shared browser mutex cannot be taken');
if (!fs.existsSync(path.join(ROOT, DECK_ENTRY))) skip(`the unit is not vendored — no ${DECK_ENTRY}`);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const fixture = pathToFileURL(path.join(ROOT, 'tools', 'fixture', 'player.html')).href;

const launch = await run('flock', [LOCK, '-c',
  `xvfb-run -a -s '-screen 0 1280x1024x24' ${sh(electron)} . --gate=${sh(OUT)} --gate-probe=deck-host `
  + `--source-url=${sh(fixture)} --user-data=${sh(path.join(OUT, 'userdata'))}`],
{ cwd: ROOT, timeoutMs: 180000 });
fs.writeFileSync(path.join(OUT, 'launch.log'), launch.out);

let R = null;
try { R = JSON.parse(fs.readFileSync(path.join(OUT, 'report.json'), 'utf8')); } catch { /* asserted below */ }

ok('the app launches from its real entry point and the deck-host probe writes a report  [entry point: `electron .` -> src/main/main.js]',
  R !== null && R.gate === 1 && R.probe === ID,
  R ? `exit ${launch.code}, electron ${R.versions.electron} / chromium ${R.versions.chrome}`
    : `exit ${launch.code}, no report.json — last line: ${lastLine(launch.out)}`);
if (!R) done();

// ------------------------------------------------------------------ boot
const boot = O(R.boot);
ok('THE VENDORED DECK BOOTS UNDER THIS HOST: every assertHost at ui/embed.js module scope passed and the deck defined __embed  '
  + '[entry point: vendor/…/ui/embed.js:119-130]',
  boot.booted === true && /ui\/embed\.html$/.test(String(boot.url)),
  `${boot.url} in ${boot.waitedMs} ms · bridge ${boot.bridge} · a Host short one duty defines no __embed at all`);

ok('...and the module it imported is OURS: six duties, `page` and `transport`, all callable',
  eq(A(boot.duties), ['armShortcut', 'onMessage', 'onStorageChanged', 'page', 'send', 'storageGet', 'storageSet', 'transport']),
  A(boot.duties).join(', '));

const shapes = O(boot.shapes);
ok('...with `transport` SPELLED and non-null over a Live source, and all six DeckTransport members present',
  shapes.transportKey === true && shapes.transport === 'object'
  && eq(A(shapes.transportMembers), ['drive', 'onJump', 'onSpeedReport', 'onState', 'release', 'requestSpeed'])
  && eq(A(shapes.pageMembers), ['claimKeys', 'close', 'onAutonav', 'onKey', 'ready', 'setHeight']),
  `transport ${shapes.transport} [${A(shapes.transportMembers).join(' ')}] · page [${A(shapes.pageMembers).join(' ')}]`);

// --------------------------------------------------------------- storage
const st = O(R.storage);
ok('over the real ipc, one key held in BOTH areas comes back as the two different values it was given',
  eq(st.local, { where: 'local' }) && eq(st.session, { where: 'session' }) && st.absent === null,
  `local ${JSON.stringify(st.local)} · session ${JSON.stringify(st.session)} · absent ${JSON.stringify(st.absent)}`);

ok('...and the area refusals keep their two shapes across the seam: storageGet rejects, storageSet and onStorageChanged throw',
  /^rejected: /.test(String(st.getBadArea)) && /^threw: /.test(String(st.setBadArea)) && /^threw: /.test(String(st.watchBadArea))
  && st.setReturns === 'undefined',
  `get ${String(st.getBadArea).slice(0, 40)}… · set ${String(st.setBadArea).slice(0, 22)}… · watch ${String(st.watchBadArea).slice(0, 22)}…`);

ok('...and a change made by MAIN reaches the deck\'s own listener — the deck is not the only writer of what it reads',
  A(st.feed).length === 1 && eq(A(st.feed)[0], { from: 'main', n: 7 }),
  JSON.stringify(st.feed));

// ----------------------------------------------------------------- chord
const chord = O(R.chord);
ok('armShortcut reports the accelerator the application menu REALLY took, and the deck draws it on a key cap',
  chord.raw === ARM_ACCEL && chord.fromMain === ARM_ACCEL && chord.onScreen === ARM_ACCEL
  && !/CommandOrControl/.test(String(chord.raw)),
  `${JSON.stringify(chord.raw)} · on screen ${JSON.stringify(chord.onScreen)} · Mac ${JSON.stringify(O(chord.drawnMac).text)}`);

// --------------------------------------------------------------- session
const before = O(O(R.session).beforeArm), after = O(O(R.session).afterArm);
ok('SESSION: an unarmed Host paints the not-armed hint, and arming clears it — the deck PROJECTS the record  '
  + '[entry point: src/main/deck-host.js sendSession(), read at ui/embed.js case SESSION]',
  O(before.host).armed === false && String(O(before.deck).lead).length > 0
  && O(after.host).armed === true && O(after.deck).lead === ''
  && Number.isFinite(O(after.host).armedAt),
  `before: armed=${O(before.host).armed} lead=${JSON.stringify(String(O(before.deck).lead).slice(0, 40))}… · `
  + `after: armed=${O(after.host).armed} lead=${JSON.stringify(O(after.deck).lead)}`);

// -------------------------------------------------------------- ARM_ERROR
const ae = O(R.armError), raised = O(ae.raised), persisted = O(ae.persisted);
ok('ARM_ERROR: pressing Start with nothing armed raises a refusal the deck PAINTS, with our message and no invented code  '
  + '[entry point: SW_CAPTURE_START in src/main/deck-host.js]',
  raised.bannerHidden === false && /Nothing is armed yet/.test(String(raised.errBody))
  && DECK_ARM_CODES.has(persisted.code),
  `"${raised.errTitle}" — ${String(raised.errBody).slice(0, 60)}… · code ${persisted.code} `
  + `${DECK_ARM_CODES.has(persisted.code) ? 'is' : 'is NOT'} in the deck's ARM_CODES`);

/**
 * A code outside the deck's set renders perfectly and behaves wrongly in three
 * places at once: the × disappears, a Restart button appears under a banner
 * restarting cannot fix, and ARM_ERROR_CLEARED stops clearing. So the CONSEQUENCE
 * is asserted rather than the table.
 */
ok('...and because the code is one the deck knows, the banner is dismissible and offers no Restart it cannot honour',
  raised.dismissHidden === false && raised.restartHidden === true,
  `dismiss ${raised.dismissHidden ? 'HIDDEN' : 'offered'} · restart ${raised.restartHidden ? 'withheld' : 'OFFERED — the QA-16 footgun'}`);

ok('...and the refusal is PERSISTED in the `session` area with the shape the deck reads: {code, message, at, seq}',
  Number.isFinite(persisted.at) && Number.isFinite(persisted.seq) && typeof persisted.message === 'string'
  && Math.abs(Date.now() - persisted.at) < 10 * 60 * 1000,
  `${JSON.stringify({ ...persisted, message: `${String(persisted.message).slice(0, 24)}…` })} — \`at\` is epoch ms, `
  + `written in one process and read in another`);

ok('...and ARM_ERROR_CLEARED, with the seq the deck was showing, takes the banner down and drops the durable record',
  O(ae.afterClear).bannerHidden === true && ae.persistedAfterClear === null,
  `banner ${O(ae.afterClear).bannerHidden ? 'gone' : 'STILL UP'} · record ${JSON.stringify(ae.persistedAfterClear)}`);

// ------------------------------------------------------------------- page
const page = O(R.page), claim = O(page.claim);
ok('page.claimKeys arrives with the list the UNIT decides, never one copied host-side  '
  + '[entry point: hostKeys() in ui/embed-state.js -> ui/host.js page.claimKeys()]',
  A(claim.keys).includes('Digit1') && A(claim.keys).includes('Digit6') && A(claim.keys).includes('Numpad0')
  && typeof claim.armed === 'boolean',
  `armed=${claim.armed} keys=${A(claim.keys).length}: ${A(claim.keys).join(' ')}`);

ok('page.setHeight is ADVICE the Host clamps, and the deck view really is that tall',
  A(page.heights).length > 0 && A(page.heights).every((h) => h >= 120 && h <= 900)
  && O(page.deckBounds).height === A(page.heights)[A(page.heights).length - 1],
  `reported ${A(page.heights).join(', ')} · view is ${O(page.deckBounds).height} px`);

ok('page.ready reached the Host, and the Host answered it with the re-send it owes',
  O(page.fromDeck).ready >= 1 && O(page.toDeck).video >= 1,
  `ready x${O(page.fromDeck).ready} · the Host has sent ${O(page.toDeck).video} video, `
  + `${O(page.toDeck).speed} speed, ${O(page.toDeck).autonav} autonav`);

// -------------------------------------------------------------- transport
const tr = O(R.transport);
const drove = O(tr.afterDrive), released = O(tr.afterRelease);
ok('transport.drive lands on a REAL <video>: muted, playbackRate and currentTime all moved  '
  + '[entry point: ui/host.js transport.drive() -> src/main/deck-host.js -> transport.js -> the source preload]',
  drove.muted === true && drove.rate === 1.25 && drove.t > 4 && drove.t < 6,
  `muted=${drove.muted} rate=${drove.rate} t=${drove.t}`);

ok('...and NOTHING ELSE did: `volume` and `evil` rode in the same patch and never reached the element',
  drove.volume === 1 && drove.evil === 'absent',
  `volume ${drove.volume} (untouched) · evil ${drove.evil} — the write set is closed at three layers`);

ok('transport.release hands the player back the way it was found: unmuted, rate 1, key lock on',
  released.muted === false && released.rate === 1 && released.preservesPitch === true,
  `muted=${released.muted} rate=${released.rate} preservesPitch=${released.preservesPitch}`);

ok('transport.requestSpeed is refused-and-reported rather than dropped: 3x became the ceiling, and the deck FOLLOWED the element',
  O(O(tr.afterRequestSpeed).video).rate === 2 && O(O(tr.afterRequestSpeed).deck).speed === 2
  && O(O(O(tr.afterRequestSpeed).deck).speedGate).ok === true,
  `element ${O(O(tr.afterRequestSpeed).video).rate}x · deck reads ${O(O(tr.afterRequestSpeed).deck).speed}x · `
  + `speed control ${O(O(O(tr.afterRequestSpeed).deck).speedGate).ok ? 'live' : 'GREYED'}`);

/**
 * `onState` IS THE DUTY THE WHOLE DECK FOLLOWS, and the first launch of this
 * Host got it wrong in a way nothing else could see: the relay spread the
 * transport's payload AFTER its own `t`, so every state arrived typed `'state'`,
 * the deck's inbound map had no handler for it, and the surface simply never
 * moved. The count is the assertion.
 */
ok('onState really reaches the deck — the relay does not overwrite the type it is relaying under',
  O(page.toDeck).video >= 5 && O(page.toDeck).state === undefined,
  `${O(page.toDeck).video} video messages, ${O(page.toDeck).state || 0} mistyped as 'state'`);

// --------------------------------------------------------- autoplay-next
const an = O(R.autoplayNext);
ok('THE AUTOPLAY-NEXT CHECKBOX IS NOT DEAD: the deck\'s click stored the preference and the Host acted on it  '
  + '[entry point: writePrefs() in ui/embed.js -> storageSet(local, prefs) -> the Host\'s own change listener]',
  eq(O(an.prefsAfter), { autoplayNext: true }) && an.prefsBefore === null && an.hostPrefsPushes >= 2,
  `stored ${JSON.stringify(an.prefsAfter)} · the Host pushed prefs to the transport ${an.hostPrefsPushes}x `
  + '(once at boot, once on the change)');

ok('...and the transport really moved on it, and reported back to the deck through page.onAutonav',
  !eq(an.autonavBefore, an.autonavAfter) && O(page.toDeck).autonav >= 1,
  `autonav plans ${O(an.autonavBefore).plans} -> ${O(an.autonavAfter).plans}, `
  + `clicks ${O(an.autonavBefore).clicks} -> ${O(an.autonavAfter).clicks} · `
  + `${O(page.toDeck).autonav} report(s) reached the deck`);

ok('...and `local` really is on disk, written by the process that owns it',
  eq(O(O(an.onDisk).prefs), { autoplayNext: true }),
  `${st.file}: ${JSON.stringify(O(an.onDisk).prefs)}`);

// -------------------------------------------------------------- the bridge
ok('the preload bridge cannot be rewritten from inside the deck page — a compromised deck cannot redirect the Host\'s wire',
  O(R.bridgeImmutable).swapped === false && O(R.bridgeImmutable).returned === 'undefined',
  `swap took: ${O(R.bridgeImmutable).swapped} · threw: ${JSON.stringify(O(R.bridgeImmutable).threw)} `
  + '(contextBridge hands the main world a deeply immutable object; the late-binding claim is §1)');

// ------------------------------------------------------------- page.close
const close = O(R.close);
ok('page.close takes the deck off the page AND THE AUDIO DOES NOT STOP — the engine is a different process',
  close.visibleBefore === true && close.visibleAfter === false && close.deckClosed === true && close.engineAlive === true,
  `visible ${close.visibleBefore} -> ${close.visibleAfter} · engine alive ${close.engineAlive}`);

// ---------------------------------------------------------- what it drew
const shot = O(O(R.screenshots).deck);
ok('...and the deck PAINTED before it went: a blank surface and a working one are both a PNG',
  shot.ok === true && shot.colours > 20,
  shot.ok ? `${shot.width}x${shot.height}, ${shot.colours} distinct colours, ${shot.bytes} bytes -> ${path.relative(ROOT, path.join(OUT, 'deck.png'))}`
    : shot.why);

console.log(`\n${ID}: launch log ${path.relative(ROOT, path.join(OUT, 'launch.log'))} · `
  + `report ${path.relative(ROOT, path.join(OUT, 'report.json'))} · screenshot ${path.relative(ROOT, path.join(OUT, 'deck.png'))}`);
done();

// ------------------------------------------------------------------ helpers
function sh(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }
function lastLine(s) { const l = String(s).trimEnd().split('\n'); return l[l.length - 1] || '(no output)'; }
function hasBin(name) {
  for (const dir of (process.env.PATH || '').split(':')) {
    try { fs.accessSync(path.join(dir, name), fs.constants.X_OK); return true; } catch { /* next */ }
  }
  return false;
}
function run(bin, args, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const grab = (c) => { out += c.toString(); };
    child.stdout.on('data', grab);
    child.stderr.on('data', grab);
    const timer = setTimeout(() => { out += `\n[suite] TIMEOUT after ${timeoutMs} ms — killing\n`; child.kill('SIGKILL'); }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: 127, out: `${out}\nspawn error: ${e.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}
