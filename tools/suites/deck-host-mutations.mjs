#!/usr/bin/env node
/**
 * THE MUTATION BATTERY FOR `deck-host` — every assertion watched RED.
 *
 * `AGENTS.md`: *"Every assertion you add must be WATCHED RED BY MUTATION. Break
 * the code, show it fails, restore. Name the mutation. An assertion you did not
 * watch fail is not evidence."*
 *
 * This file is that, executed rather than remembered. Each row below is one
 * edit to one shipped file, the assertions it MUST turn red, and a sentence
 * saying what the defect would look like in the product. It applies the edit,
 * runs `tools/suites/deck-host.mjs`, records which assertion names appeared on a
 * `FAIL` line, and puts the file back — with the restore in a `finally`, so an
 * interrupted run does not leave a mutation on the tree.
 *
 *   node tools/suites/deck-host-mutations.mjs             # the whole battery
 *   node tools/suites/deck-host-mutations.mjs --only M12  # one row
 *   node tools/suites/deck-host-mutations.mjs --fast      # the node-half rows only
 *
 * TWO WAYS IT FAILS, and the second is the one worth having:
 *
 *   1. A MUTATION THAT PRODUCED NO RED. The suite is blind to a real defect.
 *   2. AN ASSERTION NO MUTATION EVER TURNED RED — the coverage report at the
 *      end. That is invisible from inside a green run, and it is how a suite
 *      ends up with an assertion that cannot fail. `tools/suites/coverage.py`
 *      does the same job for `shell`; this is the same idea, in-process.
 *
 * WHY SOME ROWS BATCH SEVERAL EDITS. A launch costs ~45 s and the battery has
 * more rows than that budget allows one at a time. Rows marked `batch` apply
 * two or three edits whose assertions are disjoint, and the row FAILS unless
 * EXACTLY the expected set went red — so an interaction between them shows up
 * as an unexpected red rather than being hidden by one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOST = 'vendor/stem-splitter-live/extension/ui/host.js';
const DECKHOST = 'src/main/deck-host.js';
const STORAGE = 'src/main/storage.js';
const KEYS = 'src/main/keys.js';
const ASSETS = 'src/main/assets.js';

/** @type {{id: string, why: string, fast?: boolean, edits: [string, string, string][], expect: string[]}[]} */
const MUTATIONS = [
  // ------------------------------------------------ the hole module, §1 only
  {
    id: 'M1',
    why: 'a Host short one duty — the failure assertHost exists to move to boot',
    fast: true,
    edits: [[HOST, '  armShortcut: async () => {', '  armShortcutX: async () => {']],
    expect: ['assertHost accepts the SHIPPED'],
  },
  {
    id: 'M2',
    why: 'a `page` namespace short `close` — the deck could never take itself off the page',
    fast: true,
    edits: [[HOST, '    close: () => { bridge().pageSend({ c: \'close\' }); },', '']],
    expect: ['...and `page`, against'],
  },
  {
    id: 'M3',
    why: 'a `transport` short `release` — a muted 1.02x video the user cannot undo',
    fast: true,
    edits: [[HOST, '    release: () => { bridge().pageSend({ c: \'release\' }); },', '']],
    expect: ['...and `transport` is SPELLED', '...and a Host that COULD NOT ASK'],
  },
  {
    id: 'M4',
    why: 'a duty that needs its `this` — the Electron bridge mistake shared/host.js names',
    fast: true,
    edits: [[HOST, '  send: (msg) => { bridge().send(msg); },',
      '  send(msg) { this.__nothing.here; bridge().send(msg); },']],
    expect: ['every duty works UNBOUND'],
  },
  {
    id: 'M5',
    why: 'a transport that is OMITTED rather than spelled null — read as "no player", which starts a capture on boot',
    fast: true,
    edits: [[HOST, '  transport: HOSTED === false ? null : {', '  transportX: HOSTED === false ? null : {']],
    expect: ['...and `transport` is SPELLED', 'a Host with no player spells', '...and a Host that COULD NOT ASK',
      '...and a bridge that answered the hosted question', '...and it says so ONCE', 'every duty works UNBOUND'],
  },
  {
    id: 'M6',
    why: 'coercing the hosted answer — "I could not ask" collapses into "there is no player", which is what starts a capture on boot',
    fast: true,
    edits: [[HOST, "  return typeof b.hosted === 'boolean' ? b.hosted : null;", '  return b.hosted === true;']],
    expect: ['...and a bridge that answered the hosted question'],
  },
  {
    id: 'M7',
    why: 'a missing bridge answered with a bare object instead of the inert one — the duties throw again, and a throw crashes the vendored group rather than appearing in it',
    fast: true,
    edits: [[HOST, '  return (w && w[BRIDGE]) || INERT;', '  return (w && w[BRIDGE]) || {};']],
    expect: ['...and a Host that COULD NOT ASK', '...and it says so ONCE'],
  },
  {
    id: 'M8',
    why: 'a Host that stamps the deck\'s envelope — rule 1, and it breaks receivers quietly',
    fast: true,
    edits: [[HOST, '  send: (msg) => { bridge().send(msg); },',
      "  send: (msg) => { bridge().send({ ...msg, hostSaw: true }); },"]],
    expect: ['send carries the FINISHED envelope'],
  },
  {
    id: 'M9',
    why: 'a `send` that returns something — a call site could start awaiting delivery',
    fast: true,
    edits: [[HOST, '  send: (msg) => { bridge().send(msg); },',
      '  send: (msg) => { bridge().send(msg); return true; },']],
    expect: ['...and returns nothing, so no call site'],
  },
  {
    id: 'M10',
    why: 'the transport captured at IMPORT — rule 2, and the reason a recorder stays empty while everything reports green',
    fast: true,
    edits: [
      [HOST, '/** @type {import(\'../shared/host.js\').DeckHost} */',
        'const BOUND_SEND = bridge().send;\n/** @type {import(\'../shared/host.js\').DeckHost} */'],
      [HOST, '  send: (msg) => { bridge().send(msg); },', '  send: (msg) => { BOUND_SEND(msg); },'],
    ],
    expect: ['send resolves the transport at CALL time'],
  },
  {
    id: 'M11',
    why: 'an onMessage that registers nothing — the deck simply never paints, with nothing in the console',
    fast: true,
    edits: [[HOST, '    bridge().onMessage((m) => { if (m && m.to === ME) fn(m); });', '    /* registered nothing */']],
    expect: ['INSTRUMENT CHECK: onMessage registered exactly one'],
  },
  {
    id: 'M12',
    why: 'no address guard — the deck is handed the engine\'s and the Host\'s traffic too',
    fast: true,
    edits: [[HOST, '    bridge().onMessage((m) => { if (m && m.to === ME) fn(m); });', '    bridge().onMessage((m) => { if (m) fn(m); });']],
    expect: ['onMessage delivers ONLY what is addressed', '...and hands the deck the SAME message'],
  },
  {
    id: 'M13',
    why: 'a Host that re-wraps the envelope on the way in',
    fast: true,
    edits: [[HOST, '    bridge().onMessage((m) => { if (m && m.to === ME) fn(m); });',
      '    bridge().onMessage((m) => { if (m && m.to === ME) fn({ ...m }); });']],
    expect: ['...and hands the deck the SAME message'],
  },
  {
    id: 'M14',
    why: 'a Host that forwards what the deck returned — MV3 holds a response channel open for exactly this',
    fast: true,
    edits: [[HOST, '    bridge().onMessage((m) => { if (m && m.to === ME) fn(m); });',
      '    return bridge().onMessage((m) => { if (m && m.to === ME) return fn(m); });']],
    expect: ['...and drops what the deck returns'],
  },
  {
    id: 'M15',
    why: 'a Host that takes the area and ignores it — the arm refusal then outlives the restart',
    fast: true,
    edits: [[HOST, '    const r = await bridge().storageGet(area, key);', "    const r = await bridge().storageGet('local', key);"]],
    expect: ['storageGet READS THE AREA IT WAS GIVEN', '...while a read that FAILED rejects'],
  },
  {
    id: 'M16',
    why: 'an absent key answered with undefined — the deck cannot tell it from a stored undefined',
    fast: true,
    edits: [[HOST, '    return r.value === undefined ? null : r.value;', '    return r.value;']],
    expect: ['...and an absent key RESOLVES null'],
  },
  {
    id: 'M17',
    why: 'unreadable folded into absent — the deck applies its defaults most confidently on the run it could not read',
    fast: true,
    edits: [[HOST, '    if (!r || r.ok !== true) {', '    if (false) {']],
    expect: ['...while a read that FAILED rejects'],
  },
  {
    id: 'M18',
    why: 'a storageSet that accepts any area — chrome.storage.sync is a network write and P1 forbids it',
    fast: true,
    edits: [[HOST, '  storageSet: (area, key, value) => {\n    assertArea(area);', '  storageSet: (area, key, value) => {']],
    expect: ['an area outside {local, session} is REFUSED', 'storageSet returns undefined'],
  },
  {
    id: 'M19',
    why: 'a storageSet that returns the transport\'s value',
    fast: true,
    edits: [[HOST, '    bridge().storageSet(area, key, value);', '    return bridge().storageSet(area, key, value) || 1;']],
    expect: ['storageSet returns undefined'],
  },
  {
    id: 'M20',
    why: 'a change feed with no area filter — the deck applies another lifetime\'s value to its preferences',
    fast: true,
    edits: [[HOST, '      if (!ch || ch.area !== area || ch.key !== key) return;', '      if (!ch || ch.key !== key) return;']],
    expect: ['onStorageChanged filters by BOTH area and key'],
  },
  {
    id: 'M21',
    why: "Electron's own accelerator grammar — the deck draws the word CommandOrControl on a key cap, and nothing goes red",
    fast: true,
    edits: [[KEYS, "export const ARM_ACCEL = process.platform === 'darwin' ? 'Command+Shift+A' : 'Ctrl+Shift+A';",
      "export const ARM_ACCEL = 'CommandOrControl+Shift+A';"]],
    expect: ['armShortcut answers RAW', '...and the unit can spell every token'],
  },
  {
    id: 'M22',
    why: 'an empty accelerator passed through as a chord — the deck draws an empty key cap instead of the other sentence',
    fast: true,
    edits: [[HOST, "    return typeof accel === 'string' && accel !== '' ? accel : null;", '    return accel;']],
    expect: ['...and an accelerator the menu could not take answers'],
  },
  {
    id: 'M23',
    why: "drive spreading the caller's patch — ADR 0001 decision 4's write set becomes whatever a call site passes",
    fast: true,
    edits: [[HOST, "      const cmd = { c: 'drive' };", "      const cmd = { c: 'drive', ...p };"]],
    expect: ['drive writes muted, playbackRate and currentTime', '...and a value of the wrong type is dropped'],
  },
  {
    id: 'M24',
    why: 'no type guards on the three fields — NaN reaches playbackRate, which throws in Blink',
    fast: true,
    edits: [
      [HOST, "      if (typeof p.muted === 'boolean') cmd.muted = p.muted;", '      cmd.muted = p.muted;'],
      [HOST, "      if (typeof p.playbackRate === 'number' && Number.isFinite(p.playbackRate)) cmd.playbackRate = p.playbackRate;",
        '      cmd.playbackRate = p.playbackRate;'],
      [HOST, "      if (typeof p.currentTime === 'number' && Number.isFinite(p.currentTime)) cmd.currentTime = p.currentTime;",
        '      cmd.currentTime = p.currentTime;'],
    ],
    expect: ['...and a value of the wrong type is dropped'],
  },
  {
    id: 'M25',
    why: 'a second clamp on the speed claim — a refusal becomes a silent drop, and the deck greys nothing',
    fast: true,
    edits: [[HOST, "    requestSpeed: (rate) => { bridge().pageSend({ c: 'requestSpeed', rate }); },",
      "    requestSpeed: (rate) => { bridge().pageSend({ c: 'requestSpeed', rate: Math.min(2, rate) }); },"]],
    expect: ['requestSpeed is NOT filtered'],
  },
  {
    id: 'M26',
    why: 'a page command that drops its payload — the Host sizes the deck to zero',
    fast: true,
    edits: [[HOST, "    setHeight: (px) => { bridge().pageSend({ c: 'height', px }); },",
      "    setHeight: () => { bridge().pageSend({ c: 'height' }); },"]],
    expect: ['the six page duties and release'],
  },
  {
    id: 'M27',
    why: 'one page listener per registration — five copies of every inbound message',
    fast: true,
    edits: [[HOST, '  if (pageWired) return;\n  pageWired = true;', '  if (false) return;']],
    expect: ['INSTRUMENT CHECK: the five inbound duties registered exactly one'],
  },
  {
    id: 'M28',
    why: 'inbound routing that ignores the type — every handler sees every message',
    fast: true,
    edits: [[HOST, '    const h = inbound.get(msg.t);\n    if (h) h(msg);', '    for (const h of inbound.values()) h(msg);']],
    expect: ['...and each inbound type reaches its own handler'],
  },

  {
    id: 'M38',
    why: 'a module-scope statement that touches the bridge — a throw there does not produce a red in the vendored group, it CRASHES it',
    fast: true,
    edits: [[HOST, 'const HOSTED = (() => {', 'const HOSTED = (() => {\n  globalThis.window.__wbDeck.hosted;']],
    expect: ['importing the hole module is INERT', '...and a Host that COULD NOT ASK', '...and it says so ONCE'],
  },

  // ---------------------------------------------------------- storage.js, §1b
  {
    id: 'M29',
    why: 'an absent key answered with undefined in main',
    fast: true,
    edits: [[STORAGE, '      return m.has(key) ? m.get(key) : null;', '      return m.get(key);']],
    expect: ['a fresh profile answers `null`', '`local` OUTLIVES THE RUN and `session` does not'],
  },
  {
    id: 'M30',
    why: 'a Host that persists the SESSION area — a 60-second arm refusal painting as current after a reboot',
    fast: true,
    edits: [[STORAGE, "      if (area === 'local') {", '      if (true) {'],
      [STORAGE, '  const mem = { local: new Map(), session: new Map() };',
        '  const mem = { local: new Map(), session: new Map() };\n  // MUTATION: one file for both lifetimes'],
      [STORAGE, '    fs.writeFileSync(tmp, `${JSON.stringify(Object.fromEntries(mem.local), null, 2)}\\n`);',
        '    fs.writeFileSync(tmp, `${JSON.stringify({ ...Object.fromEntries(mem.local), ...Object.fromEntries(mem.session) }, null, 2)}\\n`);'],
      [STORAGE, '      for (const [k, v] of Object.entries(parsed)) mem.local.set(k, v);',
        '      for (const [k, v] of Object.entries(parsed)) { mem.local.set(k, v); mem.session.set(k, v); }'],
    ],
    expect: ['`local` OUTLIVES THE RUN and `session` does not'],
  },
  {
    id: 'M31b',
    why: 'a read failure treated as an empty store',
    fast: true,
    edits: [[STORAGE, "      if (area === 'local' && localUnreadable) throw localUnreadable;", '      /* unreadable is absent */']],
    expect: ['...and a local store that is PRESENT and cannot be read throws'],
  },
  {
    id: 'M32',
    why: 'an unreadable flag that outlives the file that caused it — one bad write and the deck can never read a preference again',
    fast: true,
    edits: [[STORAGE, '        localUnreadable = null;', '        /* the flag stands */']],
    expect: ['...and a write REPLACES the file'],
  },
  {
    id: 'M33',
    why: 'main accepting a lifetime the unit has no word for',
    fast: true,
    edits: [[STORAGE, '  if (!AREAS.includes(area)) {', '  if (false) {']],
    expect: ['...and every area outside the two lifetimes is refused'],
  },
  {
    id: 'M34',
    why: 'a change feed that fires for every key',
    fast: true,
    edits: [[STORAGE, '      const set = feeds.get(feedKey(area, key));\n      if (set) for (const fn of [...set]) { stats.changes++; fn(value); }',
      '      for (const set of feeds.values()) for (const fn of [...set]) { stats.changes++; fn(value); }']],
    expect: ['the change feed fires for the key it was given'],
  },

  // --------------------------------------------------------------- keys.js, §1c
  {
    id: 'M35',
    why: 'a key router that never takes a key — the deck\'s shortcuts do nothing from the view the user is looking at',
    fast: true,
    edits: [[KEYS, "  return keys.includes(input.code) || input.key === '?';", '  return false;']],
    expect: ['a claimed key with a deck armed', '`?` is matched by CHARACTER'],
  },
  {
    id: 'M36',
    why: 'a router that ignores `armed` — with no deck armed, 1-6 stop seeking on somebody else\'s page',
    fast: true,
    edits: [[KEYS, '  if (!claim || claim.armed !== true) return false;', '  if (!claim) return false;']],
    expect: ['...and every other case is left to the page'],
  },
  {
    id: 'M37',
    why: "`?` matched by position — the shortcut overlay stops opening on every non-US layout",
    fast: true,
    edits: [[KEYS, "  return keys.includes(input.code) || input.key === '?';", '  return keys.includes(input.code);']],
    expect: ['`?` is matched by CHARACTER'],
  },

  // ------------------------------------------------------- the launch half, §2
  {
    id: 'L1',
    why: 'THE DECK DOES NOT BOOT: a Host short one duty throws at ui/embed.js module scope',
    edits: [[HOST, '  storageGet: async (area, key) => {', '  storageGetX: async (area, key) => {']],
    expect: ['assertHost accepts the SHIPPED', 'THE VENDORED DECK BOOTS UNDER THIS HOST',
      '...and the module it imported is OURS', 'storageGet READS THE AREA IT WAS GIVEN',
      'over the real ipc, one key held in BOTH areas', '...and the area refusals keep their two shapes',
      '...and a change made by MAIN reaches', '...and an absent key RESOLVES null',
      '...while a read that FAILED rejects', 'an area outside {local, session} is REFUSED'],
  },
  {
    id: 'L2',
    why: 'main reading one area whatever the deck asked for, over the real ipc',
    edits: [[DECKHOST, '      return { ok: true, value: storage.get(area, key) };', "      return { ok: true, value: storage.get('local', key) };"]],
    expect: ['over the real ipc, one key held in BOTH areas'],
  },
  {
    id: 'L3',
    why: 'main never pushing a storage change — the deck disagrees with the behaviour the user is watching',
    edits: [[DECKHOST, '        if (wc && !wc.isDestroyed()) wc.send(CH.changed, { area, key, value });', '        /* nothing is pushed */']],
    expect: ['...and a change made by MAIN reaches'],
  },
  {
    id: 'L4',
    why: 'no application menu — armShortcut then reports a chord nothing is bound to, or none at all',
    edits: [[DECKHOST, '  if (installMenu) buildMenu();', '  if (false) buildMenu();']],
    expect: ['armShortcut reports the accelerator the application menu REALLY took'],
  },
  {
    id: 'L5',
    why: 'a SESSION record that omits `armed` — the deck projects it as disarmed and the hint never leaves',
    edits: [[DECKHOST, '      armed: armed(),', '      // armed is omitted']],
    expect: ['SESSION: an unarmed Host paints the not-armed hint'],
  },
  {
    id: 'L6',
    why: 'ARM_ERROR persisted but never SENT — the refusal is invisible until something reloads the deck',
    edits: [[DECKHOST, "    bus.originate(BUS.deck, { type: 'ARM_ERROR', code: rec.code, message: rec.message, seq: rec.seq });", '    /* nothing is sent */']],
    expect: ['ARM_ERROR: pressing Start with nothing armed', '...and because the code is one the deck knows'],
  },
  {
    id: 'L7',
    why: "a refusal code the deck's ARM_CODES does not contain — an undismissable banner with a Restart that cannot help",
    edits: [
      [DECKHOST, '  if (!DECK_ARM_CODES.has(r.code)) {', '  if (false) {'],
      [DECKHOST, "  NOT_ARMED: { code: 'NOT_ARMED',", "  NOT_ARMED: { code: 'NO_SOURCE',"],
    ],
    expect: ['ARM_ERROR: pressing Start with nothing armed', '...and because the code is one the deck knows'],
  },
  {
    id: 'L8',
    why: 'a durable arm refusal with no epoch clock — armErrorFresh() rejects it and the deck paints nothing after a reload',
    edits: [[DECKHOST, '      at: Date.now(),', '      // at is omitted']],
    expect: ['...and the refusal is PERSISTED in the `session` area'],
  },
  {
    id: 'L9',
    why: 'no ARM_ERROR_CLEARED — a stale banner stands until its TTL',
    edits: [[DECKHOST, "    bus.originate(BUS.deck, { type: 'ARM_ERROR_CLEARED' });", '    /* nothing retires the refusal */']],
    expect: ['...and ARM_ERROR_CLEARED, with the seq the deck was showing'],
  },
  {
    id: 'L10',
    why: 'a Host that does not keep the deck\'s key claim — the chrome bar swallows the digits',
    edits: [[DECKHOST, "        claim = { armed: msg.armed === true, keys: Array.isArray(msg.keys) ? msg.keys : [] };", '        claim = { armed: false, keys: [] };']],
    expect: ['page.claimKeys arrives with the list the UNIT decides'],
  },
  {
    id: 'L11',
    why: 'setHeight taken as a command rather than as advice, and never laid out',
    edits: [[DECKHOST, '        onHeight(clampDeckHeight(msg.px));', '        /* the deck is left at its guess */']],
    expect: ['page.setHeight is ADVICE the Host clamps'],
  },
  {
    id: 'L12',
    why: 'page.ready ignored — a deck mounted onto an already-playing video stays blank until something moves',
    edits: [[DECKHOST, '        if (transport) transport.resend();', '        /* no re-send */']],
    expect: ['page.ready reached the Host'],
  },
  {
    id: 'L13',
    why: 'drive dropped in main — the cached deck\'s clock lock never reaches the element',
    edits: [[DECKHOST, "      case 'drive': if (transport) transport.drive(msg); break;", "      case 'drive': break;"]],
    expect: ['transport.drive lands on a REAL <video>'],
  },
  {
    id: 'L14',
    why: 'release dropped — a muted 1.25x video left behind that the user cannot explain',
    edits: [[DECKHOST, "      case 'release': if (transport) transport.release(); break;", "      case 'release': break;"]],
    expect: ['transport.release hands the player back'],
  },
  {
    id: 'L15',
    why: 'requestSpeed dropped — the control looks fine and does nothing',
    edits: [[DECKHOST, "      case 'requestSpeed': if (transport) transport.requestSpeed(msg.rate); break;", "      case 'requestSpeed': break;"]],
    expect: ['transport.requestSpeed is refused-and-reported'],
  },
  {
    id: 'L16',
    why: 'THE RELAY OVERWRITES THE TYPE IT IS RELAYING UNDER — measured on this Host\'s first launch: the deck never moves',
    edits: [[DECKHOST, "    offTransport.push(transport.onState((s) => toDeck({ ...s, t: 'video' })));",
      "    offTransport.push(transport.onState((s) => toDeck({ t: 'video', ...s })));"]],
    expect: ['onState really reaches the deck', 'page.ready reached the Host'],
  },
  {
    id: 'L17',
    why: 'the autoplay-next wire cut — VENDORING.md\'s dead checkbox, exactly',
    edits: [[DECKHOST, "  const offPrefs = storage.onChanged('local', PREFS_KEY, () => pushPrefs());", '  const offPrefs = () => {};']],
    expect: ['THE AUTOPLAY-NEXT CHECKBOX IS NOT DEAD', '...and the transport really moved on it'],
  },
  {
    id: 'L18',
    why: 'prefs read but never handed to the transport — the report half without the instruction half',
    edits: [[DECKHOST, '    transport.setPrefs(prefs);', '    /* the transport is never told */']],
    expect: ['...and the transport really moved on it'],
  },
  {
    id: 'L19',
    why: 'a `local` area that never reaches the disk — the preference does not survive a restart',
    edits: [[STORAGE, '        persist();', '        /* nothing is written */']],
    expect: ['...and `local` really is on disk', '`local` OUTLIVES THE RUN and `session` does not',
      '...and a local store that is PRESENT and cannot be read throws', '...and a write REPLACES the file'],
  },
  {
    id: 'L20',
    why: 'page.close ignored — the × does nothing',
    edits: [[DECKHOST, '        onClose();', '        /* the deck stays */']],
    expect: ['page.close takes the deck off the page'],
  },
  {
    id: 'L21',
    why: 'the deck served without its stylesheet — a page that loads, asserts green everywhere, and is unreadable',
    edits: [[ASSETS, "  '.css': 'text/css; charset=utf-8',", "  '.css': 'text/plain; charset=utf-8',"]],
    expect: ['...and the deck PAINTED before it went'],
  },
];

// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7)
  || (args.includes('--only') ? args[args.indexOf('--only') + 1] : '');
const fastOnly = args.includes('--fast');

const rows = MUTATIONS.filter((m) => !m.skip)
  .filter((m) => (only ? m.id === only : true))
  .filter((m) => (fastOnly ? m.fast : true));

const OUTDIR = path.join(ROOT, 'out', 'deck-host-mutations');
fs.mkdirSync(OUTDIR, { recursive: true });

/** Every assertion name the clean suite prints, so coverage can be counted. */
function assertionNames(out) {
  return out.split('\n').filter((l) => /^(ok  |FAIL)/.test(l))
    .map((l) => l.slice(6).split('  ')[0].trim());
}
const failedNames = (out) => out.split('\n').filter((l) => l.startsWith('FAIL')).map((l) => l.slice(6).split('  ')[0].trim());

function runSuite(fast) {
  const env = { ...process.env };
  if (fast) env.DECK_HOST_ONLY = 'conformance';
  else delete env.DECK_HOST_ONLY;
  const r = spawnSync('node', ['tools/suites/deck-host.mjs'], { cwd: ROOT, env, encoding: 'utf8', timeout: 300000 });
  return `${r.stdout || ''}${r.stderr || ''}`;
}

console.log(`deck-host-mutations: ${rows.length} rows\n`);

// The clean run is the reference: every assertion that exists, and the proof
// that the tree is green BEFORE anything is broken.
const cleanFast = runSuite(true);
const cleanFull = fastOnly ? cleanFast : runSuite(false);
fs.writeFileSync(path.join(OUTDIR, 'clean.log'), `${cleanFast}\n${cleanFull}`);
const allNames = new Set([...assertionNames(cleanFast), ...assertionNames(cleanFull)]);
const cleanReds = [...failedNames(cleanFast), ...failedNames(cleanFull)];
if (cleanReds.length) {
  console.error(`the tree is NOT GREEN before mutating: ${cleanReds.join(' | ')}`);
  process.exit(2);
}
console.log(`clean: ${allNames.size} assertions, 0 failed\n`);

const covered = new Set();
let bad = 0;

for (const m of rows) {
  const originals = m.edits.map(([file]) => [file, fs.readFileSync(path.join(ROOT, file), 'utf8')]);
  let applied = 0;
  try {
    for (const [file, from, to] of m.edits) {
      const p = path.join(ROOT, file);
      const src = fs.readFileSync(p, 'utf8');
      if (!src.includes(from)) throw new Error(`${m.id}: the text to mutate is not in ${file}: ${JSON.stringify(from.slice(0, 60))}`);
      fs.writeFileSync(p, src.replace(from, to));
      applied++;
    }
    const out = runSuite(m.fast);
    fs.writeFileSync(path.join(OUTDIR, `${m.id}.log`), out);
    const reds = failedNames(out);
    for (const r of reds) covered.add(r);

    const missing = m.expect.filter((want) => !reds.some((r) => r.startsWith(want)));
    const unexpected = reds.filter((r) => !m.expect.some((want) => r.startsWith(want)));
    const verdict = reds.length === 0 ? 'NO RED' : (missing.length || unexpected.length ? 'WRONG SET' : 'red');
    if (verdict !== 'red') bad++;
    console.log(`${verdict === 'red' ? 'ok  ' : 'FAIL'}  ${m.id}  ${m.why}`);
    console.log(`        ${reds.length} red${reds.length === 1 ? '' : 's'}: ${reds.join(' | ') || '(none — the suite is blind to this)'}`);
    if (missing.length) console.log(`        EXPECTED AND STILL GREEN: ${missing.join(' | ')}`);
    if (unexpected.length) console.log(`        UNEXPECTED: ${unexpected.join(' | ')}`);
  } catch (err) {
    bad++;
    console.log(`FAIL  ${m.id}  could not be applied: ${err.message}`);
  } finally {
    // ALWAYS, even on a throw: a mutation left on the tree is a defect that
    // outlives the run that made it.
    for (const [file, src] of originals) fs.writeFileSync(path.join(ROOT, file), src);
    if (applied !== m.edits.length && applied !== 0) console.log(`        (restored after ${applied}/${m.edits.length} edits)`);
  }
}

// ---------------------------------------------------------------------------
// THE COVERAGE REPORT — the half that is invisible from inside a green run.
const uncovered = [...allNames].filter((n) => !covered.has(n));
console.log(`\ncoverage: ${covered.size}/${allNames.size} assertions were turned red by some mutation`);
if (uncovered.length) {
  console.log('NO MUTATION EVER TURNED THESE RED:');
  for (const n of uncovered) console.log(`  - ${n}`);
}

console.log(`\ndeck-host-mutations: ${rows.length - bad} passed, ${bad} failed`);
process.exit(bad || (uncovered.length && !only) ? 1 : 0);
