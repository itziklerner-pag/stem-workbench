#!/usr/bin/env node
/**
 * deck-seam — the DeckHost's conformance suite, in plain node.
 *
 * ===========================================================================
 * WHY THIS SUITE EXISTS AT ALL
 * ===========================================================================
 * `docs/VENDORING.md` gives a second Host three things to do about the 122
 * conformance assertions in `group('host')` in the vendored `test.js`, and this
 * repository takes option 3 — point them at our files. Half of that is free: the
 * group reads the two holes BY PATH, and our implementations are at those paths,
 * so it is already our modules it imports.
 *
 * The other half is not free, and this file is it. That group installs a CHROME
 * PLATFORM (`globalThis.chrome = { runtime: … , storage: … , commands: … }`) and
 * drives the shipped module against it. Our `ui/host.js` does not know what
 * `chrome` is — it reaches for an Electron preload bridge — so those assertions
 * cannot report on it: they would fail for the platform rather than for the
 * contract, which is a red that says nothing. `vendor-intact` and `vendor-unit`
 * keep proving that the UNIT is the tag; this suite proves that OUR DeckHost
 * holds the seven rules `shared/host.js` declares, using the same technique the
 * unit uses on its own Host and asserting the same claims.
 *
 * THE PLATFORM IS STUBBED, NEVER THE HOST. Every assertion below drives the
 * SHIPPED `vendor/stem-splitter-live/extension/ui/host.js` and the SHIPPED
 * `assertHost` / `assertHostOption` / `chordLabel` / `ARM_CODES` out of the
 * vendored unit. Nothing here reimplements either side. A check that
 * reimplemented the module it is guarding would be a second copy of the bug.
 *
 * ===========================================================================
 * WHY IT IS PLAIN NODE, AND WHAT THAT COSTS
 * ===========================================================================
 * No window, no display, no `flock`, ~0.3 s. That matters for one reason and it
 * is the reason the unit's own equivalents are written the same way: the two
 * things a broken Host breaks SILENTLY are late binding and the envelope, and a
 * browser gate cannot run on every commit.
 *
 * WHAT IT THEREFORE DOES NOT PROVE, stated so the absence is on the record
 * rather than merely true:
 *   · THAT THE DECK PAINTS. This drives the Host, not the deck. The deck really
 *     loading `embed.html` over `app://` under this Host is a windowed claim.
 *   · THAT MAIN ANSWERS. Every duty here is asserted up to the bridge and no
 *     further; whether `src/main/deck-host.js` is on the other end of those
 *     channels is a claim about a running app.
 *   · THE TRANSPORT'S OTHER END. `drive` is asserted to put three fields and no
 *     others on the wire. Whether they reach a `<video>` is
 *     `src/main/transport.js`'s to prove.
 *   · THE ARM GESTURE. Assertion 45 reads the CODES this Host can raise out of
 *     `src/main/deck-host.js` as text; it does not run the gesture.
 *
 * ===========================================================================
 * WATCHED RED BY MUTATION — `tools/suites/deck-seam-mutations.sh`
 * ===========================================================================
 * Every assertion here has been watched failing against a deliberate edit of the
 * file it names. An assertion nobody has seen fail is an assumption.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { refuseIfCompromised } from '../lib/tree-guard.mjs';

const ID = 'deck-seam';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * BEFORE ANYTHING IS MEASURED: is this the tree somebody committed?
 *
 * A mutation battery that died without restoring leaves its edit standing on a
 * shipped file, and a run that starts afterwards reports a red that is not in
 * the code — stem-workbench#22, which happened twice in one afternoon. This
 * REFUSES rather than measures, and a refusal is an ERROR: it exits non-zero
 * with no `SKIPPED` and no assertion line, so `tools/verify.mjs` reports it as a
 * FAIL and the plan is RED. "I declined to measure" must not read as green any
 * more than silence may (the VOID rule, one level out).
 *
 * It costs one `readdir` of a directory that is almost always absent, plus one
 * `git status` — at startup, never per assertion.
 */
refuseIfCompromised(ID, ROOT);
const UNIT = path.join(ROOT, 'vendor', 'stem-splitter-live', 'extension');
const HOLE = path.join(UNIT, 'ui', 'host.js');
const OUT = path.join(ROOT, 'out', ID);

// ------------------------------------------------------------------ harness
let pass = 0; let fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (cond) pass++; else fail++;
};
const done = () => {
  console.log(`\n${ID}: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

/** Order-insensitive deep equality, so "same keys, different order" is not a red. */
const norm = (v) => (v === null || typeof v !== 'object' ? v
  : Array.isArray(v) ? v.map(norm)
    : Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])])));
const eq = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

/** What a promise did, as data, so a rejection is an assertion and not a crash. */
const settle = async (p) => {
  try { return { ok: true, value: await p }; }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
};
/** The same for a synchronous call: did it throw, and with what. */
const threw = (fn) => { try { fn(); return null; } catch (err) { return err; } };
/**
 * Run a check that may THROW, as data.
 *
 * A SUITE THAT CRASHES HAS NOT REPORTED A RED; IT HAS STOPPED LOOKING — and
 * `assertHost` is designed to throw, so a mutation that removes a duty would
 * otherwise take this whole file down at the first section with every assertion
 * after it never running. `tools/suites/shell.mjs` pays for the same lesson in
 * its `A()`/`O()` helpers, learned from a mutation that killed the suite eleven
 * assertions before the one it was written to turn red.
 */
const val = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };

// --------------------------------------------------------------- the unit
const {
  assertHost, assertHostOption, BUS,
  DECK_HOST_DUTIES, DECK_PAGE_DUTIES, DECK_TRANSPORT_DUTIES,
} = await import(pathToFileURL(path.join(UNIT, 'shared', 'host.js')).href);
const { chordLabel, hostKeys } = await import(pathToFileURL(path.join(UNIT, 'ui', 'embed-state.js')).href);
const { ARM_CODES: UNIT_ARM_CODES } = await import(pathToFileURL(path.join(UNIT, 'ui', 'audio-math.js')).href);
const { PREFS_KEY, ARM_ERROR_KEY } = await import(pathToFileURL(path.join(UNIT, 'shared', 'config.js')).href);

// ------------------------------------------------------------ the platform
/**
 * THE PRELOAD BRIDGE, STUBBED — `src/preload/deck.cjs`'s ten members and nothing
 * else. It records instead of sending, which is the only difference between it
 * and the real one, and every list it keeps is something an assertion below
 * counts.
 *
 * IT IS A STUB OF THE PLATFORM, NOT OF THE HOST. `window.__wbDeck` is what
 * Electron puts on the deck's window; the module under test is the shipped one.
 */
function makeBridge(opts = {}) {
  const {
    hosted = true,
    store = { local: {}, session: {} },
    unreadable = null,
    chord = 'Ctrl+Shift+A',
  } = opts;
  const b = {
    hosted,
    sent: [], page: [], sets: [], watches: [], gets: [], chordAsks: 0,
    busFns: [], pageFns: [], storageFns: [],
    send(msg) { b.sent.push(msg); },
    onMessage(fn) { b.busFns.push(fn); return () => {}; },
    storageGet(area, key) {
      b.gets.push({ area, key });
      if (unreadable === area) {
        return Promise.resolve({ ok: false, error: `${area} could not be read` });
      }
      const bag = store[area] || {};
      return Promise.resolve({
        ok: true,
        value: Object.prototype.hasOwnProperty.call(bag, key) ? bag[key] : null,
      });
    },
    storageSet(area, key, value) { b.sets.push({ area, key, value }); },
    storageWatch(area, key) { b.watches.push({ area, key }); },
    onStorageChanged(fn) { b.storageFns.push(fn); return () => {}; },
    armShortcut() { b.chordAsks++; return Promise.resolve(chord); },
    pageSend(msg) { b.page.push(msg); },
    onPageEvent(fn) { b.pageFns.push(fn); return () => {}; },
  };
  return b;
}

/**
 * Import the SHIPPED hole module over a given platform.
 *
 * The query string busts the ES module cache, which is what lets each section
 * drive a module whose own state (its inbound handler map, and the `hosted`
 * answer it reads ONCE at import) is fresh. That the answer is read once is
 * itself the contract: `ui/embed.js` asks `host.transport != null` at module
 * scope, so a Host that resolved it later would be answering after the deck had
 * already decided how to boot.
 */
let caseNo = 0;
/**
 * Point the module's late binding at one bridge.
 *
 * `bridge()` reads `globalThis.window` when a duty is CALLED, not when the
 * module was imported — rule 2, and the property section 3 asserts. One
 * consequence has to be respected by this file: two hosts loaded over two
 * bridges both call through whichever window was installed LAST, so a section
 * that loads a second host has to say which one it is talking to again.
 */
const use = (bridge) => { globalThis.window = { __wbDeck: bridge }; };
async function loadHost(bridge) {
  caseNo += 1;
  globalThis.window = bridge === null ? undefined : { __wbDeck: bridge };
  const mod = await import(`${pathToFileURL(HOLE).href}?case=${caseNo}`);
  return mod.host;
}

// ==========================================================================
// 1. IMPORTING THE MODULE IS INERT — ONLY CALLING A DUTY CAN FAIL
// ==========================================================================
/**
 * THE BLOCKER THIS SECTION IS THE REGRESSION TEST FOR. An earlier version of the
 * hole threw at module scope when there was no bridge. Under a browser that is a
 * loud, correct failure; under `test.js`'s `group('host')`, which imports this
 * module in plain Node to REPORT on it, it is a crash — measured by the engine
 * slice at `test.js:5577`, 482 assertions in, with every assertion after it
 * never executed. A crash is strictly worse than a failure: it hides the reds
 * that are the point of running the conformance group at all, and it reads as a
 * broken vendored copy rather than as an unimplemented duty.
 *
 * So the rule, and both holes hold it: NOTHING AT MODULE SCOPE TOUCHES A
 * BROWSER-ONLY GLOBAL IN A WAY THAT CAN THROW.
 */
{
  const bare = await settle(loadHost(null));
  ok('importing the Host is INERT — no browser global at module scope, so the unit\'s own group("host") '
    + 'can import it in Node and REPORT rather than crash  [entry point: vendor/…/extension/ui/host.js module scope]',
    bare.ok === true && bare.value && typeof bare.value.send === 'function',
    bare.ok ? 'imported with no window at all' : `THREW AT IMPORT: ${bare.error}`);

  /**
   * ...AND "I COULD NOT ASK" IS NOT `null`. `transport: null` is a claim about
   * the world that the deck ACTS on: with no transport it concludes nobody will
   * ever tell it whether the video is playing, and `follow()` reads that as
   * licence to start a capture — and behind it a 109 MB model download — on a
   * page nobody pressed play on. A Host that could not reach its own bridge must
   * not make that claim.
   */
  const lost = bare.ok ? bare.value : null;

  /**
   * ...AND "I COULD NOT ASK" IS NOT `null`. `transport: null` is a claim about
   * the world that the deck ACTS on: with no transport it concludes nobody will
   * ever tell it whether the video is playing, and `follow()` reads that as
   * licence to start a capture — and behind it a 109 MB model download — on a
   * page nobody pressed play on. A Host that could not reach its own bridge must
   * not make that claim, so the namespace exists and every duty in it is inert.
   */
  ok('...and with no bridge to ask, `transport` is still a NAMESPACE — never `null`, which is the answer '
    + 'that starts a capture on boot  [entry point: HOSTED in ui/host.js; `follow()` in ui/embed.js is the reader]',
    lost !== null && lost.transport != null && typeof lost.transport === 'object'
    && val(() => typeof lost.transport.drive) === 'function',
    `transport = ${lost && lost.transport === null ? 'null — COERCED to "this Host has no player"' : 'a namespace'}`);

  /**
   * AND A DUTY WITH NOWHERE TO GO SAYS SO ONCE, ON THE CONSOLE, AND DOES NOTHING.
   *
   * The instinct is to throw at the call, and it is wrong for one measured
   * reason: `test.js`'s `group('host')` calls `deckHost.send(…)`,
   * `deckHost.page.close()` and `await deckHost.storageGet(…)` as BARE
   * STATEMENTS, so a throw does not produce a red — it CRASHES the conformance
   * group and every assertion after it never runs. `offscreen/host.js` settled
   * on the same shape for the engine's `send`, and the console line is what
   * stops it being the silent failure `shared/host.js` warns about.
   */
  const said = [];
  const realError = console.error;
  console.error = (...a) => { said.push(a.join(' ')); };
  let threwFromDuty = null;
  // GUARDED, because a mutation that stops the module importing at all leaves
  // `lost` null — and a suite that crashes there has stopped looking rather than
  // reported a red, which is the failure this whole section is about.
  try {
    lost.send({ v: 1, to: BUS.engine, from: BUS.deck, type: 'STATUS' });
    lost.page.close();
    lost.transport.drive({ muted: true });
    lost.storageSet('local', 'k', 1);
  } catch (err) { threwFromDuty = err; }
  const inertGet = lost ? await settle(lost.storageGet('local', PREFS_KEY)) : { ok: false, error: 'no module' };
  const inertChord = lost ? await settle(lost.armShortcut()) : { ok: false, error: 'no module' };
  console.error = realError;
  ok('...and a duty with nowhere to go ANNOUNCES ITSELF ONCE on the console and does nothing — it does not '
    + 'throw, because a throw at a bare call site crashes the unit\'s conformance group instead of failing it',
    threwFromDuty === null && said.length === 1 && /deck\.cjs/.test(said[0]) && /send\(\)/.test(said[0])
    && inertGet.ok === true && inertGet.value === null && inertChord.ok === true && inertChord.value === null,
    threwFromDuty ? `THREW: ${threwFromDuty.message}`
      : `${said.length} console line(s) for five undeliverable duties: ${(said[0] || '').slice(0, 90)}`);

  /**
   * A bridge that answers with something that is not a boolean is the same state
   * as no bridge: we could not ask. It must land in the refusing branch and not
   * in either of the two that are claims about the world.
   */
  const vague = await settle(loadHost(makeBridge({ hosted: 'yes' })));
  const vagueT = vague.ok ? vague.value.transport : null;
  ok('...and a `hosted` that is not a boolean reads as "could not ask", never as `false`  '
    + '[the answer decides how the deck boots, and the unknown one must not be the permissive one]',
    vague.ok === true && vagueT != null && val(() => typeof vagueT.drive) === 'function',
    vague.ok ? `transport = ${vagueT === null ? 'null — COERCED to "no player"' : 'a namespace'}`
      : `THREW AT IMPORT: ${vague.error}`);
}

// ==========================================================================
// 2. THE BOOT CHECK — the three the deck really runs, with the unit's own lists
// ==========================================================================
/**
 * ENTRY POINT: `ui/embed.js` module scope, which runs exactly these three lines
 * before it paints anything. They name the deck's lists, not "a host": AGENTS.md
 * counts five defects that were a value being right at one call site and wrong
 * at another, and `assertHost` has two callers.
 */
{
  const b = makeBridge();
  const host = await loadHost(b);

  const booted = threw(() => assertHost(host, DECK_HOST_DUTIES, 'DeckHost'));
  ok('assertHost accepts the SHIPPED ui/host.js and returns it — this is the gate on its export list  '
    + '[entry point: assertHost(host, DECK_HOST_DUTIES) at ui/embed.js:119]',
    booted === null && val(() => assertHost(host, DECK_HOST_DUTIES, 'DeckHost')) === host,
    booted === null ? Object.keys(DECK_HOST_DUTIES).join(', ') : booted.message);

  const pageBooted = threw(() => assertHost(host.page, DECK_PAGE_DUTIES, 'DeckHost.page'));
  ok('...and on host.page, against the unit\'s own DECK_PAGE_DUTIES  '
    + '[entry point: assertHost(host.page, DECK_PAGE_DUTIES) at ui/embed.js:120]',
    pageBooted === null,
    pageBooted === null ? Object.keys(DECK_PAGE_DUTIES).join(', ') : pageBooted.message);

  const tErr = threw(() => assertHostOption(host, 'transport', DECK_TRANSPORT_DUTIES, 'DeckHost'));
  const t = val(() => assertHostOption(host, 'transport', DECK_TRANSPORT_DUTIES, 'DeckHost'));
  ok('...and host.transport satisfies all six DECK_TRANSPORT_DUTIES when a player is bound  '
    + '[entry point: assertHostOption(host, "transport", …) at ui/embed.js:130]',
    tErr === null && t !== null && t === host.transport,
    tErr ? tErr.message : `${Object.keys(DECK_TRANSPORT_DUTIES).join(', ')} — ${t === null ? 'GOT NULL' : 'present'}`);

  /**
   * A Host with no player must SPELL the absence. `assertHostOption` exists for
   * this one distinction: an absent property and a deliberate absence read the
   * same from the inside, and here they must not.
   */
  const lone = await loadHost(makeBridge({ hosted: false }));
  const spelled = 'transport' in lone && lone.transport === null;
  ok('a Host with no player SPELLS `transport: null` rather than omitting the key  '
    + '[entry point: assertHostOption(), which refuses the omission]',
    spelled && val(() => assertHostOption(lone, 'transport', DECK_TRANSPORT_DUTIES, 'DeckHost'), 'threw') === null,
    `'transport' in host = ${'transport' in lone}, value = ${JSON.stringify(lone.transport)}`);

  /**
   * A DUTY MAY BE CALLED UNBOUND, and `shared/host.js` names the Electron shape
   * that gets this wrong: "a duty implemented as a method that needs its `this`
   * — an Electron preload bridge — passes this check … and fails only at the
   * first worklet load". The engine's `assetUrl` is the duty that already
   * travels detached; the deck's have no such site today, so this is the
   * assertion that keeps the module from growing one.
   */
  const detachedGet = host.storageGet;
  const detachedSet = host.storageSet;
  const detachedSend = host.send;
  const r = await settle(detachedGet('local', 'nothing-here'));
  const setThrew = threw(() => detachedSet('local', 'k', 1));
  const sendThrew = threw(() => detachedSend({ v: 1, to: BUS.engine, from: BUS.deck, type: 'STATUS' }));
  ok('every duty survives being called UNBOUND — no member reads `this`  '
    + '[entry point: `const f = host.storageGet; f("local", …)`]',
    r.ok === true && r.value === null && setThrew === null && sendThrew === null,
    `storageGet -> ${JSON.stringify(r)}, storageSet -> ${setThrew ? setThrew.message : 'ok'}, `
    + `send -> ${sendThrew ? sendThrew.message : 'ok'}`);

  const members = [
    ...Object.keys(DECK_HOST_DUTIES).map((k) => [k, host[k]]),
    ...Object.keys(DECK_PAGE_DUTIES).map((k) => [`page.${k}`, val(() => host.page[k])]),
    ...Object.keys(DECK_TRANSPORT_DUTIES).map((k) => [`transport.${k}`, val(() => host.transport[k])]),
  ];
  const callable = members.filter(([, fn]) => typeof fn === 'function');
  ok('all fourteen members of the DeckHost are callable functions, counted against the unit\'s three lists',
    members.length === 18 && callable.length === 18,
    `${callable.length}/${members.length} (6 duties + 6 page + 6 transport)`);
}

// ==========================================================================
// 3. THE OUTGOING WIRE — rules 1, 2 and 3
// ==========================================================================
{
  const b = makeBridge();
  const host = await loadHost(b);

  /**
   * RULE 1: `send` TAKES A FINISHED MESSAGE. The `{v, to, from, …}` envelope is
   * the UNIT's protocol and the Host is only the transport. A Host that stamps,
   * rewrites, normalises or filters it breaks receivers QUIETLY — a `LIVE_STATE`
   * that never arrives leaves the previous value on screen.
   */
  const msg = { v: 1, to: BUS.engine, from: BUS.deck, type: 'PITCH', deck: 'A', semitones: 2 };
  const ret = host.send(msg);
  const got = b.sent[0] || null;
  ok('send carries the envelope VERBATIM — no field added, renamed or dropped  '
    + '[entry point: ui/host.js send(), reached from toOff()/toSw() in ui/embed.js]',
    got !== null && eq(got, msg) && Object.keys(got).sort().join(',') === 'deck,from,semitones,to,type,v',
    got ? Object.keys(got).sort().join(',') : 'nothing reached the transport at all');

  ok('...and returns undefined, so no call site can start awaiting delivery  [rule 3]',
    ret === undefined, `returned ${JSON.stringify(ret)}`);

  /**
   * RULE 2: THE TRANSPORT IS RESOLVED AT CALL TIME, NEVER AT IMPORT. Under the
   * extension this rule exists because `tools/embed-smoke.mjs` replaces
   * `chrome.runtime.sendMessage` after boot and that patch is its only window
   * onto the outgoing wire; a bound transport leaves the recorder empty and
   * `[].every()` reports green over nothing. The same thing is done here to the
   * bridge, one platform over.
   */
  const before = b.sent.length;
  /**
   * BOTH SWAPS, because there are two ways to bind early and only one of them is
   * the extension's. `const send = bridge().send` is caught by replacing the
   * MEMBER; `const b = bridge()` at module scope — the shape an Electron Host
   * reaches for, since the bridge is one object on `window` — is caught only by
   * replacing the WHOLE BRIDGE. A test that swapped the member alone reports
   * green over a module that resolved the object once at import.
   */
  const afterMember = [];
  b.send = (m) => { afterMember.push(m); };
  host.send({ v: 1, to: BUS.host, from: BUS.deck, type: 'SW_STATUS' });

  const fresh = makeBridge();
  use(fresh);
  host.send({ v: 1, to: BUS.engine, from: BUS.deck, type: 'MODEL_LOAD' });
  use(b);
  ok('send RESOLVES THE BRIDGE AT CALL TIME — both the member and the whole bridge, swapped after import  '
    + '[rule 2; a module-scope `const b = bridge()` is the Electron shape, and only the second swap sees it]',
    before === 1 && afterMember.length === 1 && afterMember[0].type === 'SW_STATUS'
    && fresh.sent.length === 1 && fresh.sent[0].type === 'MODEL_LOAD',
    `${before} before · ${afterMember.length} to the swapped member · ${fresh.sent.length} to the swapped bridge`);
}

// ==========================================================================
// 4. THE INCOMING WIRE — rule 4
// ==========================================================================
{
  const b = makeBridge();
  const host = await loadHost(b);
  const seen = [];
  host.onMessage((m) => { seen.push(m); return true; });

  // INSTRUMENT CHECK: everything below reads `b.busFns[0]`, so an `onMessage`
  // that registered nothing would leave every one of them inspecting a stub of
  // this file's own making.
  ok('INSTRUMENT CHECK: onMessage registered exactly one listener on the bridge',
    b.busFns.length === 1, `${b.busFns.length} registered`);

  const mine = { v: 1, to: BUS.deck, from: BUS.engine, type: 'LIVE_STATE', status: 'running', latencySec: 1.5 };
  const rets = [
    b.busFns[0]({ v: 1, to: BUS.host, from: BUS.deck, type: 'SW_STATUS' }),
    b.busFns[0]({ v: 1, to: BUS.engine, from: BUS.deck, type: 'STATUS' }),
    b.busFns[0]({ v: 1, to: 'tab', from: BUS.host, type: 'STEM_SPLITTER_LIVE_EMBED' }),
    b.busFns[0](null),
    b.busFns[0](mine),
  ];

  ok('onMessage delivers ONLY what is addressed to this context — 1 of 5 on a broadcast  '
    + '[rule 4; entry point: ui/host.js onMessage(), the `m.to === BUS.deck` guard]',
    seen.length === 1 && seen[0].type === 'LIVE_STATE',
    `${seen.length} delivered of 5 (to: sw, off, tab, null, ui)`);

  ok('...and hands the deck the SAME object, envelope and all — nothing re-wrapped',
    seen.length === 1 && seen[0] === mine && seen[0].v === 1 && seen[0].from === BUS.engine,
    seen.length === 1 ? 'identity preserved' : 'nothing arrived');

  /**
   * The handler above returns `true` on purpose: the control has to be able to
   * lose. MV3 reads a truthy return as "I will call sendResponse later"; there
   * is no such channel here, and the duty must still drop the value so that a
   * deck's return value cannot start meaning something the day one appears.
   */
  ok('...and what the deck returns is DROPPED, not forwarded to the transport',
    rets.every((v) => v === undefined),
    rets.map((v) => String(v)).join(' '));
}

// ==========================================================================
// 5. STORAGE — rules 5 and 6
// ==========================================================================
{
  /**
   * A Host that took the area and then ignored it is invisible to any check that
   * uses one area, so the stub holds THE SAME KEY in BOTH areas with DIFFERENT
   * values. That is the one arrangement in which "it read the area it was given"
   * and "it always reads local" give different answers.
   */
  const store = { local: { [PREFS_KEY]: { autoplayNext: true } }, session: { [PREFS_KEY]: { autoplayNext: false } } };
  const b = makeBridge({ store });
  const host = await loadHost(b);

  const fromLocal = await host.storageGet('local', PREFS_KEY);
  const fromSession = await host.storageGet('session', PREFS_KEY);
  ok('storageGet READS THE AREA IT WAS GIVEN: one key held in both areas comes back as the two values  '
    + '[rule 5; entry point: ui/host.js storageGet(), reached from embed.js for local/prefs and session/armError]',
    fromLocal && fromSession && fromLocal.autoplayNext === true && fromSession.autoplayNext === false,
    `local ${JSON.stringify(fromLocal)}, session ${JSON.stringify(fromSession)} — a Host that hard-coded one area returns the same object twice`);

  const absent = await settle(host.storageGet('local', 'never-written'));
  ok('...and ABSENT RESOLVES null — a fresh profile holds no preferences, which is the ordinary case  [rule 6]',
    absent.ok === true && absent.value === null, JSON.stringify(absent));

  /**
   * THE HALF THAT MUST NOT BE FOLDED INTO THE OTHER. Storage that could not be
   * READ is a fault, and a Host that answered `null` for it would tell the deck
   * "the user has no preferences" on precisely the run where it could not tell —
   * and a preference silently reset to default is indistinguishable from one the
   * user chose.
   */
  const bad = makeBridge({ store, unreadable: 'local' });
  const host2 = await loadHost(bad);
  const unread = await settle(host2.storageGet('local', PREFS_KEY));
  ok('...while an UNREADABLE store REJECTS, and the reason survives the hop  [rule 6]',
    unread.ok === false && /could not be read/.test(unread.error),
    unread.ok ? `RESOLVED ${JSON.stringify(unread.value)} — absent and unreadable have been folded together`
      : unread.error);
  // Back to the readable platform: `host` and `host2` are two modules over one
  // global, and every duty resolves the bridge when it is called.
  use(b);

  /**
   * RULE 5's SECOND HALF: an area outside the two the unit names is REFUSED, and
   * the two refusals differ in SHAPE on purpose. `storageGet` must REJECT,
   * because the deck's preferences read is a module-scope `.then().catch()` that
   * a synchronous throw would jump straight past — taking the rest of boot with
   * it. The other two must THROW at the call site.
   */
  const syncThrow = threw(() => host.storageGet('sync', PREFS_KEY));
  const rejected = await settle(host.storageGet('sync', PREFS_KEY));
  ok('storageGet REJECTS a third storage area rather than throwing at the call site  '
    + '[rule 5; the deck\'s read is a module-scope .then().catch() a throw would jump past]',
    syncThrow === null && rejected.ok === false && /storage area/.test(rejected.error),
    `threw synchronously: ${syncThrow ? syncThrow.message : 'no'}; rejected: ${rejected.ok ? 'NO' : rejected.error}`);

  const setThrew = threw(() => host.storageSet('sync', PREFS_KEY, { x: 1 }));
  const watchThrew = threw(() => host.onStorageChanged('sync', PREFS_KEY, () => {}));
  ok('...while storageSet and onStorageChanged THROW at the call site, and nothing reaches the wire  '
    + '[rule 5; a wrong area there is the deck being wrong about a value it wrote itself]',
    setThrew !== null && watchThrew !== null
    && !b.sets.some((s) => s.area === 'sync') && !b.watches.some((w) => w.area === 'sync'),
    `set: ${setThrew ? 'threw' : 'DID NOT THROW'}, onChanged: ${watchThrew ? 'threw' : 'DID NOT THROW'}, `
    + `writes to sync: ${b.sets.filter((s) => s.area === 'sync').length}`);

  host.storageSet('local', PREFS_KEY, { autoplayNext: false, instrument: 'alto' });
  const wrote = b.sets[b.sets.length - 1] || {};
  ok('storageSet puts the area, the key and the value on the wire, and returns undefined  '
    + '[entry point: ui/host.js storageSet(), reached from embed.js writePrefs()]',
    wrote.area === 'local' && wrote.key === PREFS_KEY
    && val(() => wrote.value.instrument) === 'alto'
    && host.storageSet('local', 'x', 1) === undefined,
    JSON.stringify(wrote));

  /**
   * `onStorageChanged` IS NOT SUGAR OVER `storageGet`: the deck is not the only
   * writer of what it reads — the Host watches the same `PREFS_KEY` to drive the
   * source view's autoplay-next — so a deck that read only at boot would sit
   * there disagreeing with the behaviour the user is watching.
   */
  const heard = [];
  host.onStorageChanged('local', PREFS_KEY, (v) => heard.push(v));
  const watch = b.watches[b.watches.length - 1];
  ok('onStorageChanged ASKS THE HOST TO WATCH that one area and key  '
    + '[without it main sends nothing and the subscription covers nothing — the change-feed spelling of green-on-nothing]',
    watch && watch.area === 'local' && watch.key === PREFS_KEY,
    JSON.stringify(watch));

  const fn = b.storageFns[b.storageFns.length - 1];
  fn({ area: 'local', key: PREFS_KEY, value: { autoplayNext: true } });
  fn({ area: 'session', key: PREFS_KEY, value: { autoplayNext: false } });   // wrong area
  fn({ area: 'local', key: ARM_ERROR_KEY, value: { code: 'x' } });           // wrong key
  fn({ area: 'local', key: PREFS_KEY, value: undefined });                   // a REMOVAL
  ok('...and the AREA AND KEY FILTER IS THE HOST\'S: 2 of 4 changes reach the deck, and a removal arrives as undefined',
    heard.length === 2 && heard[0] && heard[0].autoplayNext === true && heard[1] === undefined,
    `${heard.length} of 4: ${heard.map((h) => JSON.stringify(h)).join(', ')}`);
}

// ==========================================================================
// 6. THE ARM CHORD — rule 7, and the vocabulary that is gated nowhere upstream
// ==========================================================================
{
  const b = makeBridge({ chord: 'Ctrl+Shift+A' });
  const host = await loadHost(b);
  const accel = await host.armShortcut();
  ok('armShortcut answers with the accelerator RAW, exactly as the platform spells it  '
    + '[rule 7; entry point: ui/host.js armShortcut(), reached from embed.js boot]',
    accel === 'Ctrl+Shift+A' && b.chordAsks === 1,
    `${JSON.stringify(accel)} after ${b.chordAsks} ask(s)`);

  /**
   * RAW IS NOT ARBITRARY. `chordLabel()`'s vocabulary is `MacCtrl`, `Ctrl`,
   * `Command`, `Alt`, `Shift` plus the four glyphs; ANYTHING ELSE IS DRAWN ON
   * THE KEY CAP VERBATIM. A Host answering in Electron's own portable grammar
   * puts the word "CommandOrControl" in front of the user — it renders, so
   * nothing goes red. `shared/host.js` writes the token set down precisely
   * because no gate upstream holds a Host to it (finding F3).
   */
  const drawnPc = chordLabel(accel, false);
  const { ARM_ACCEL, chordIsSpellable } = await import(pathToFileURL(path.join(ROOT, 'src', 'main', 'keys.js')).href);
  const drawnMac = chordLabel(ARM_ACCEL, true);
  const drawnWin = chordLabel(ARM_ACCEL, false);
  ok('...and the chord this Host binds is inside chordLabel()\'s vocabulary, on both letterings  '
    + '[entry point: src/main/keys.js ARM_ACCEL, drawn by the unit\'s own chordLabel()]',
    chordIsSpellable(ARM_ACCEL)
    && !/CommandOrControl/.test(`${drawnMac.text}${drawnMac.say}${drawnWin.text}${drawnWin.say}`)
    && drawnMac.text.length <= 4 && /A$/.test(drawnWin.text),
    `${ARM_ACCEL} -> mac ${JSON.stringify(drawnMac)} · pc ${JSON.stringify(drawnWin)} · this run drew ${JSON.stringify(drawnPc)}`);

  /**
   * `null` RATHER THAN `''`, because "no chord is bound" is a different sentence
   * for the deck to print, not an empty key cap. It RESOLVES rather than
   * rejecting: the extension's rejection means "there is no command table on
   * this platform", which cannot be true of a Host that owns its own menu.
   */
  const none = await settle((await loadHost(makeBridge({ chord: '' }))).armShortcut());
  const junk = await settle((await loadHost(makeBridge({ chord: 42 }))).armShortcut());
  ok('...and an unbound chord RESOLVES null rather than rejecting or answering an empty string',
    none.ok === true && none.value === null && junk.ok === true && junk.value === null,
    `'' -> ${JSON.stringify(none)}, 42 -> ${JSON.stringify(junk)}`);

  ok('INSTRUMENT CHECK: chordLabel() really does draw a chord this suite would notice losing',
    chordLabel('Ctrl+Shift+A', false).text === 'Ctrl+Shift+A' && chordLabel(null, false) === null,
    'a Host answering null prints the sentence without a key cap');
}

// ==========================================================================
// 7. THE TRANSPORT — the closed write set, and the two verbs that are not it
// ==========================================================================
{
  const b = makeBridge();
  const host = await loadHost(b);
  const t = host.transport;

  /**
   * ADR 0001 decision 4 fixes the write side at `muted`, `currentTime` and
   * `playbackRate`; L1 is what makes that a rule rather than a preference,
   * because the same channel reaches a `<video>` on somebody else's page and
   * SECURITY.md promotes L1 to a security property. `Object.assign(el, patch)`
   * is the one-liner that makes the write set whatever a call site passed.
   */
  t.drive({
    muted: true, playbackRate: 1.25, currentTime: 12.5,
    src: 'https://example.test/x.mp4', volume: 0, srcObject: {}, loop: true,
  });
  const cmd = b.page[0] || {};
  const extra = Object.keys(cmd).filter((k) => !['c', 'muted', 'playbackRate', 'currentTime'].includes(k));
  ok('drive\'s WRITE SET IS CLOSED at the seam: three fields named, and four smuggled ones dropped  '
    + '[entry point: ui/host.js transport.drive(), ADR 0001 decision 4 + L1]',
    cmd.c === 'drive' && cmd.muted === true && cmd.playbackRate === 1.25 && cmd.currentTime === 12.5
    && extra.length === 0,
    `on the wire: ${JSON.stringify(cmd)}${extra.length ? ` — LEAKED ${extra.join(', ')}` : ''}`);

  b.page.length = 0;
  t.drive({ muted: 'yes', playbackRate: 'fast', currentTime: NaN });
  const junkCmd = b.page[0] || {};
  ok('...and a value of the wrong type is dropped rather than coerced — a NaN rate throws in Blink',
    eq(junkCmd, { c: 'drive' }),
    JSON.stringify(junkCmd));

  b.page.length = 0;
  t.release();
  ok('release asks for the player back the way it was found  '
    + '[a muted 1.02x video left behind is a bug the user cannot explain and cannot undo]',
    eq(b.page[0], { c: 'release' }), JSON.stringify(b.page[0]));

  /**
   * `requestSpeed` IS NOT FILTERED, unlike `drive`. A rate the Host cannot apply
   * is refused and REPORTED through `onSpeedReport`; a silent drop here would
   * replace an explained lockout with a control that looks fine and does
   * nothing. `resolveSpeed` in the vendored `speed.js` is the one clamp.
   */
  b.page.length = 0;
  t.requestSpeed(9);
  t.requestSpeed(undefined);
  ok('requestSpeed carries the USER\'s value UNFILTERED, including one the Host will refuse  '
    + '[the refusal is reported through onSpeedReport, never dropped here]',
    b.page.length === 2 && b.page[0].c === 'requestSpeed' && b.page[0].rate === 9
    && b.page[1].rate === undefined,
    b.page.map((p) => JSON.stringify(p)).join(' '));

  /**
   * PUSH, NEVER POLL — a contract, not a taste: the deck follows transitions and
   * a poll misses every one that opens and closes between two samples. And each
   * report reaches its OWN handler: a Host that fanned every event to every
   * handler would have the deck treat a speed report as a player state.
   */
  const states = []; const jumps = []; const speeds = [];
  t.onState((s) => states.push(s));
  t.onJump(() => jumps.push(1));
  t.onSpeedReport((r) => speeds.push(r));
  const deliver = b.pageFns[0];
  deliver({ t: 'video', playing: true, currentTime: 3, duration: 60, ended: false, playbackRate: 1 });
  deliver({ t: 'jump' });
  deliver({ t: 'speed', state: 'ok', why: null, applied: 1 });
  deliver({ t: 'nothing-registered-this' });
  ok('onState / onJump / onSpeedReport are PUSH registrations, and each type reaches only its own handler',
    states.length === 1 && jumps.length === 1 && speeds.length === 1
    && states[0].currentTime === 3 && speeds[0].state === 'ok',
    `state ${states.length}, jump ${jumps.length}, speed ${speeds.length}, and an unregistered type was dropped`);

  /**
   * `state: 'ok'` IS THE LITERAL THE DECK UNGREYS ON — every other value locks
   * the speed control and shows the state name to the user. A Host that reported
   * `'playing'` would ship a control that is permanently greyed with no error
   * anywhere, which is why the value is asserted here rather than assumed.
   */
  const { speedGate } = await import(pathToFileURL(path.join(UNIT, 'ui', 'embed-state.js')).href);
  const ungreys = speedGate({ source: 'live', state: 'ok' });
  const locks = speedGate({ source: 'live', state: 'playing' });
  ok('INSTRUMENT CHECK: the unit ungreys the speed control on the LITERAL "ok" and locks on anything else, '
    + 'showing the state name to the user  [entry point: speedGate() in vendor/…/ui/embed-state.js]',
    ungreys.ok === true && locks.ok === false && /playing/.test(locks.text),
    `ok -> ${JSON.stringify(ungreys)} · playing -> ${JSON.stringify(locks)} — a transport reporting its own word `
    + 'for "fine" ships a control that is permanently greyed with no error anywhere');
}

// ==========================================================================
// 8. THE PAGE — six duties, and the two facts claimKeys carries
// ==========================================================================
{
  const b = makeBridge();
  const host = await loadHost(b);

  host.page.claimKeys({ armed: true, keys: hostKeys({ anySolo: false, overlayOpen: false }) });
  const claim = b.page[0] || {};
  ok('claimKeys sends BOTH facts the host page needs — is a deck armed, and which codes are its  '
    + '[entry point: ui/host.js page.claimKeys(), reached from postDeck() in ui/embed.js]',
    claim.c === 'claimKeys' && claim.armed === true && Array.isArray(claim.keys)
    && claim.keys.includes('Digit1') && claim.keys.length === 14,
    `${claim.keys ? claim.keys.length : 0} codes, armed=${claim.armed}`);

  b.page.length = 0;
  host.page.claimKeys({ armed: 'yes', keys: 'Digit1' });
  host.page.claimKeys(null);
  ok('...and a malformed claim degrades to DISARMED WITH NO KEYS, never to "armed with everything"  '
    + '[with no deck armed those keys belong to the page — we are a guest there]',
    b.page.length === 2 && b.page.every((p) => p.armed === false && Array.isArray(p.keys) && p.keys.length === 0),
    b.page.map((p) => JSON.stringify(p)).join(' '));

  b.page.length = 0;
  host.page.setHeight(309);
  host.page.ready();
  host.page.close();
  ok('setHeight, ready and close each put exactly one message on the wire  '
    + '[entry point: ui/host.js page.setHeight()/ready()/close()]',
    b.page.length === 3 && b.page[0].c === 'height' && b.page[0].px === 309
    && b.page[1].c === 'ready' && b.page[2].c === 'close',
    b.page.map((p) => JSON.stringify(p)).join(' '));

  const keys = []; const navs = [];
  host.page.onKey((d) => keys.push(d));
  host.page.onAutonav((d) => navs.push(d));
  const deliver = b.pageFns[0];
  deliver({ t: 'key', code: 'Digit3', key: '3', shift: false, alt: false, repeat: false });
  deliver({ t: 'autonav', state: 'missing' });
  ok('onKey and onAutonav receive the host\'s reports, with `typing` deliberately not carried  '
    + '[the view that had the focus target is the one that checked it]',
    keys.length === 1 && keys[0].code === 'Digit3' && !('typing' in keys[0])
    && navs.length === 1 && navs[0].state === 'missing',
    `key ${JSON.stringify(keys[0])} · autonav ${JSON.stringify(navs[0])}`);

  /**
   * THE DECK'S BANNER KEYS OFF THREE LITERALS. `ui/embed.js`'s `NAV_MSG` paints
   * for exactly `missing`, `stuck` and `lost` and treats every other state as
   * healthy, so a Host that invented its own word for a failure would ship a
   * silent one. Asserted against the deck's own module rather than against a
   * list in this file.
   */
  const embedSrc = fs.readFileSync(path.join(UNIT, 'ui', 'embed.js'), 'utf8');
  const navMsg = embedSrc.slice(embedSrc.indexOf('const NAV_MSG'), embedSrc.indexOf('function onAutonav'));
  const words = ['missing', 'stuck', 'lost'].filter((w) => new RegExp(`\\b${w}:`).test(navMsg));
  ok('INSTRUMENT CHECK: the deck paints a banner for exactly missing / stuck / lost, and clears on anything else  '
    + '[entry point: NAV_MSG in vendor/…/ui/embed.js]',
    words.length === 3 && navMsg.length > 0,
    `${words.join(', ')} — a Host reporting any other word is reporting success`);
}

// ==========================================================================
// 9. THE HOST'S OWN STATE — the two lifetimes, the keys, and the refusal codes
// ==========================================================================
{
  const { createStorage } = await import(pathToFileURL(path.join(ROOT, 'src', 'main', 'storage.js')).href);
  const { deckTakesKey } = await import(pathToFileURL(path.join(ROOT, 'src', 'main', 'keys.js')).href);

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  /**
   * THE LIFETIMES, PROVEN BY CONSTRUCTION AND NOT BY A CLOCK. Two stores over
   * one directory are this process's stand-in for two runs of the app: whatever
   * the second one can still read is what survives a restart.
   *
   * This is the assertion the whole two-area design exists for. `shared/host.js`
   * rule 5: a preference must survive a restart and a refusal to arm must not,
   * "and a Host that guessed would be guessing about which of those two mistakes
   * to make".
   */
  const first = createStorage({ dir: OUT });

  /**
   * A FRESH PROFILE ANSWERS `null`, IN BOTH AREAS — the ordinary case, asserted
   * BEFORE anything is written, because it is the only moment it can be.
   *
   * It is the same claim rule 6 makes at the seam, one level in, and it needs its
   * own line for the reason the seam's does: the deck's `applyPrefs(null)` DRAWS
   * its defaults, so a store that threw or answered `undefined` for a key nobody
   * had written would turn every first run into either a broken boot or a
   * preference that reads as deliberately unset.
   *
   * (Moved here from `deck-host.mjs` §1b when that suite was cut down to its
   * launch half; nothing else asserted it.)
   */
  ok('a FRESH profile answers null in both areas, and does not throw — absent is the ordinary case, not a fault  '
    + '[entry point: createStorage() get(), before anything has been written]',
    threw(() => first.get('local', PREFS_KEY)) === null
    && first.get('local', PREFS_KEY) === null && first.get('session', ARM_ERROR_KEY) === null,
    `local -> ${JSON.stringify(first.get('local', PREFS_KEY))} · session -> ${JSON.stringify(first.get('session', ARM_ERROR_KEY))}`);

  first.set('local', PREFS_KEY, { autoplayNext: false, instrument: 'alto' });
  first.set('session', ARM_ERROR_KEY, { code: 'ARM_FAILED', at: Date.now(), seq: 1 });
  const second = createStorage({ dir: OUT });
  const survived = second.get('local', PREFS_KEY);
  const gone = second.get('session', ARM_ERROR_KEY);
  /**
   * THE FILE IS THE WITNESS, and it is why this assertion reads the disk as well
   * as the second store. "Session state does not come back" can be true because
   * nothing persisted it OR because the reader looks in the right map and the
   * writer put it in the wrong one — and only the first is the lifetime this
   * duty promises. A refusal sitting in the file that outlives the app is a
   * stale banner waiting for the next run to paint it.
   */
  const onDisk = JSON.parse(fs.readFileSync(first.localFile, 'utf8'));
  const keysOnDisk = Object.keys(onDisk).sort();
  ok('the LOCAL area outlives the process and the SESSION area does not — and the session key never '
    + 'reaches the file  [rule 5; entry point: createStorage() in src/main/storage.js]',
    val(() => survived.instrument) === 'alto' && gone === null
    && keysOnDisk.join(',') === PREFS_KEY && !keysOnDisk.includes(ARM_ERROR_KEY),
    `local -> ${JSON.stringify(survived)} · session -> ${JSON.stringify(gone)} · on disk: ${keysOnDisk.join(', ')} `
    + '(a persisted refusal would paint as current after a restart)');

  /**
   * ABSENT AND UNREADABLE, one level in from the seam. A missing file is an
   * empty store; a file that is present and cannot be parsed is a FAULT, and a
   * `get` on it must throw rather than answer "nothing is stored there".
   */
  const brokenDir = path.join(OUT, 'broken');
  fs.mkdirSync(brokenDir, { recursive: true });
  fs.writeFileSync(path.join(brokenDir, 'deck-storage-local.json'), '{ this is not json');
  const broken = createStorage({ dir: brokenDir });
  const readThrew = threw(() => broken.get('local', PREFS_KEY));
  const sessionStillFine = broken.get('session', 'anything') === null;
  broken.set('local', PREFS_KEY, { autoplayNext: true });
  const afterWrite = threw(() => broken.get('local', PREFS_KEY));
  ok('...and a local file that is PRESENT AND UNREADABLE throws on read until a write replaces it  '
    + '[rule 6, one level in; entry point: createStorage() load]',
    readThrew !== null && /could not be read/.test(readThrew.message) && sessionStillFine && afterWrite === null,
    `${readThrew ? readThrew.message.slice(0, 90) : 'IT ANSWERED null — a corrupt store read as "no preferences"'}`);

  /**
   * MAIN'S OWN CHANGE FEED FILTERS BY AREA AND KEY, and that is a different
   * filter from the seam's.
   *
   * The seam's (`onStorageChanged` in the hole) unpicks what main PUSHES. This
   * one decides what main pushes at all — and main is itself a writer of
   * `PREFS_KEY`, through the autoplay-next wire, so a feed that fired for every
   * key would have the deck applying another key's value to its preferences and
   * would put the Host in a loop with itself.
   *
   * (Moved here from `deck-host.mjs` §1b; nothing else asserted it.)
   */
  const feedSaw = [];
  const feedStore = createStorage({ dir: path.join(OUT, 'feed') });
  feedStore.onChanged('local', PREFS_KEY, (v) => feedSaw.push(v));
  feedStore.set('local', PREFS_KEY, { autoplayNext: false });
  feedStore.set('local', 'somethingElse', 1);
  feedStore.set('session', PREFS_KEY, 'the other lifetime');
  ok('main\'s change feed fires for the area and key it was given, and for no other  '
    + '[entry point: createStorage() onChanged(), which the autoplay-next wire subscribes to]',
    feedSaw.length === 1 && JSON.stringify(feedSaw[0]) === JSON.stringify({ autoplayNext: false }),
    `${feedSaw.length} of 3 writes reported: ${JSON.stringify(feedSaw)}`);

  const areaThrows = ['get', 'set', 'onChanged'].filter((m) => threw(() => (
    m === 'get' ? first.get('sync', 'k') : m === 'set' ? first.set('sync', 'k', 1) : first.onChanged('sync', 'k', () => {})
  )) !== null);
  ok('...and main\'s store refuses a third area on all three entry points  '
    + '[chrome.storage.sync is a network write, and P1 forbids the network after the model download]',
    areaThrows.length === 3, `${areaThrows.join(', ')} refused`);

  /**
   * THE PRODUCT RULING, AS A TABLE. With no deck armed, `1`-`6` must reach the
   * page exactly as they do with this app not running.
   */
  const armedClaim = { armed: true, keys: hostKeys({ anySolo: false, overlayOpen: false }) };
  const down = (over) => ({ type: 'keyDown', code: 'Digit1', key: '1', control: false, meta: false, ...over });
  const cases = [
    ['an armed deck takes a claimed key', { claim: armedClaim, input: down(), typing: false }, true],
    ['...and `?` by CHARACTER, whatever key produced it', { claim: armedClaim, input: down({ code: 'Slash', key: '?' }), typing: false }, true],
    ['a keyUp is not a press', { claim: armedClaim, input: down({ type: 'keyUp' }), typing: false }, false],
    ['a key inside a text box belongs to whoever is typing', { claim: armedClaim, input: down(), typing: true }, false],
    ['Ctrl and Cmd chords belong to the menu', { claim: armedClaim, input: down({ control: true }), typing: false }, false],
    ['a code the deck did not claim belongs to the page', { claim: armedClaim, input: down({ code: 'KeyJ' }), typing: false }, false],
    ['NOTHING is taken while no deck is armed', { claim: { armed: false, keys: armedClaim.keys }, input: down(), typing: false }, false],
    ['...and nothing when there is no claim at all', { claim: null, input: down(), typing: false }, false],
  ];
  const wrong = cases.filter(([, arg, want]) => deckTakesKey(arg) !== want).map(([why]) => why);
  ok('the key router takes a key only while a deck is armed, only the codes it claimed, and never while typing  '
    + '[entry point: deckTakesKey() in src/main/keys.js]',
    wrong.length === 0, wrong.length ? `WRONG: ${wrong.join('; ')}` : `${cases.length}/${cases.length} cases`);

  /**
   * THE FINDING THIS SUITE WAS WRITTEN TO CATCH, and it is the one thing here
   * that is about the Host's VOCABULARY rather than its shape.
   *
   * `ui/audio-math.js` exports `ARM_CODES` as a CLOSED SET, and three deck
   * behaviours key off membership in it: `ARM_ERROR_CLEARED` clears the banner
   * only for a code in the set (`ui/embed.js:2131`), the dismiss button is shown
   * only for one (`:1224`), and `errorAction()` withholds the Restart button —
   * which cannot fix an arm failure — only for one. A Host that raises a code
   * outside the set ships a banner the user can neither dismiss nor clear, with
   * a button guaranteed to fail, and NOTHING ANYWHERE GOES RED.
   *
   * Read as TEXT, because `src/main/deck-host.js` imports `electron` and cannot
   * be loaded outside it. A suite that cannot look FAILS: if the declaration
   * cannot be found at all, that is a red rather than a skip.
   */
  const hostSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'deck-host.js'), 'utf8');
  /**
   * Every literal that can reach the `code` field of an `ARM_ERROR`, resolved
   * through the file's own constants. An identifier this cannot resolve is a red
   * rather than a pass: an assertion that cannot look must fail.
   */
  /**
   * THE REFUSAL TABLE, and only it. Every `code` this Host can put on an
   * `ARM_ERROR` is declared in one frozen object; identifiers are resolved
   * through the file's own constants, and an identifier this cannot resolve is a
   * RED rather than a pass — an assertion that cannot look must fail.
   */
  const table = (hostSrc.match(/ARM_REFUSALS\s*=\s*Object\.freeze\(\{([\s\S]*?)\n\}\)/) || [])[1] || '';
  const resolved = [...table.matchAll(/\bcode:\s*(?:'([^']+)'|([A-Za-z_$][\w$]*))/g)].map(([, lit, ident]) => {
    if (lit !== undefined) return { from: `'${lit}'`, code: lit };
    const decl = hostSrc.match(new RegExp(`\\b${ident}\\s*=\\s*'([^']+)'`));
    return { from: ident, code: decl ? decl[1] : null };
  });
  const unresolved = resolved.filter((r) => r.code === null).map((r) => r.from);
  const outside = resolved.filter((r) => r.code !== null && !UNIT_ARM_CODES.has(r.code));
  const kinds = [...table.matchAll(/^\s*([A-Z_]+)\s*:/gm)].map((m) => m[1]);
  ok('every code this Host can put on an ARM_ERROR is a member of the unit\'s CLOSED ARM_CODES set  '
    + '[entry point: ARM_REFUSALS in src/main/deck-host.js, against ARM_CODES in vendor/…/ui/audio-math.js]',
    resolved.length > 0 && unresolved.length === 0 && outside.length === 0,
    resolved.length === 0
      ? 'the ARM_REFUSALS table could not be found in src/main/deck-host.js — this assertion could not look'
      : unresolved.length
        ? `could not resolve ${unresolved.join(', ')} — this assertion could not look`
        : `${kinds.length} refusal(s) (${kinds.join(', ')}) -> ${[...new Set(resolved.map((r) => r.code))].join(', ')}`
          + `${outside.length ? ` — OUTSIDE THE SET: ${outside.map((r) => r.code).join(', ')} (the deck can neither dismiss nor clear these)` : ''}`);

  /**
   * ...and the product asks that question ITSELF, rather than leaving it to this
   * suite. `ARM_ERROR_CLEARED` clears the deck's banner only for a code in the
   * set (`ui/embed.js:2131`), the dismiss button appears only for one (`:1224`),
   * and `errorAction()` withholds a Restart button that cannot fix an arm failure
   * only for one. A code outside the set is a banner the user can neither dismiss
   * nor clear — and nothing anywhere goes red, which is why the check belongs in
   * the Host and not only here.
   */
  ok('...and the Host imports that set and refuses a code outside it at its own refusal path',
    /ARM_CODES[\s\S]{0,80}vendor\/stem-splitter-live\/extension\/ui\/audio-math\.js/.test(hostSrc)
    && /\.has\(/.test(hostSrc),
    /audio-math\.js/.test(hostSrc)
      ? 'src/main/deck-host.js imports the unit\'s ARM_CODES and checks membership'
      : 'the Host does not consult the unit\'s ARM_CODES at all — the vocabulary is only checked here');

  /**
   * THE ADDRESSES. `src/main/bus.js` carries its own copy of `BUS` with a
   * standing note that it must become an import the moment the vendored tree
   * lands. It has landed; until the copy goes, the drift is what this holds —
   * and the drift's symptom is "the deck is blank", the quietest failure on the
   * seam.
   */
  const busSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'bus.js'), 'utf8');
  const imports = /from\s+'\.\.\/\.\.\/vendor\/stem-splitter-live\/extension\/shared\/host\.js'/.test(busSrc)
    && /\bBUS\b/.test(busSrc);
  const copies = [...busSrc.matchAll(/engine:\s*'([a-z]+)'/g)].map((m) => m[1]);
  ok('main routes on the unit\'s OWN addresses — imported from the vendored seam, not copied into this repo  '
    + '[entry point: BUS in src/main/bus.js; a second copy of a constant drifts into "the deck is blank"]',
    imports && copies.length === 0 && BUS.deck === 'ui' && BUS.engine === 'off' && BUS.host === 'sw',
    imports
      ? `imported; ${copies.length} local copy(ies) of the address table remain`
      : 'src/main/bus.js does not import BUS from the vendored shared/host.js');
}

console.log(`\n${ID}: drove the shipped ${path.relative(ROOT, HOLE)} over a stubbed preload bridge; `
  + `no window, no display, no mutex`);
done();
