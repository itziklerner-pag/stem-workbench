#!/usr/bin/env node
/**
 * THE MUTATION BATTERY FOR `deck-host` — every assertion in the launch suite,
 * watched RED.
 *
 * `AGENTS.md`: *"Every assertion you add must be WATCHED RED BY MUTATION. Break
 * the code, show it fails, restore. Name the mutation. An assertion you did not
 * watch fail is not evidence."*
 *
 * Each row is one edit to one shipped file, the assertions it MUST turn red, and
 * a sentence saying what the defect would look like in the product. It applies
 * the edit, runs `tools/suites/deck-host.mjs`, records which assertion names
 * appeared on a `FAIL` line, and puts the file back — with the restore in a
 * `finally`, so an interrupted run does not leave a mutation on the tree.
 *
 *   node tools/suites/deck-host-mutations.mjs             # the whole battery
 *   node tools/suites/deck-host-mutations.mjs --only L12  # one row
 *
 * EVERY ROW COSTS A LAUNCH — about 45 s — because every assertion in this suite
 * is about a real one. The conformance half and its cheap battery are
 * `deck-seam.mjs` / `deck-seam-mutations.sh`; this file deliberately has no
 * plain-node rows, for the same reason the suite has no plain-node assertions.
 *
 * TWO WAYS IT FAILS, and the second is the one worth having:
 *
 *   1. A MUTATION THAT PRODUCED NO RED. The suite is blind to a real defect.
 *   2. AN ASSERTION NO MUTATION EVER TURNED RED — the coverage report at the
 *      end. That is invisible from inside a green run, and it is how a suite
 *      ends up with an assertion that cannot fail.
 *
 * TWO ASSERTIONS ARE COVERED DELIBERATELY WEAKLY, and both say so at their site
 * rather than being quietly dropped from the report:
 *   · "NOTHING ELSE did: volume and evil" — `drive`'s write set is filtered at
 *     three layers, so breaking one does not change what reaches the element.
 *     `deck-seam-mutations.sh` watches the seam's layer; `transport`'s battery
 *     watches its own.
 *   · "the preload bridge cannot be rewritten from inside the deck page" — that
 *     is a property of `contextBridge`, not of our code, so there is nothing of
 *     ours to break. It is recorded because it is what makes the launch half
 *     unable to test late binding at all.
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

/** @type {{id: string, why: string, shared?: boolean, atLeast?: boolean, edits: [string, string, string][], expect: string[]}[]} */
const MUTATIONS = [
  {
    id: 'L1',
    why: 'THE DECK DOES NOT BOOT: a Host short one duty throws at ui/embed.js module scope',
    /**
     * The Host-side assertions stay GREEN under this one, and that is not a
     * miss: the probe drives the hole module directly, and a module short one
     * duty still answers the other thirteen. What goes red is everything the
     * DECK was supposed to do with them — which is the difference this suite
     * exists to measure.
     */
    atLeast: true,
    edits: [[HOST, '  storageGet: async (area, key) => {', '  storageGetX: async (area, key) => {']],
    expect: ['THE VENDORED DECK BOOTS UNDER THIS HOST', '...and the module it imported is OURS',
      'over the real ipc, one key held in BOTH areas'],
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
    expect: ['ARM_ERROR: pressing Start with nothing armed', '...and because the code is one the deck knows',
      '...and ARM_ERROR_CLEARED, with the seq the deck was showing'],
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
    expect: ['...and `local` really is on disk'],
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
    /**
     * OPT-IN, because `src/main/assets.js` is not this slice's file: `shell`
     * gates its content types too, and a sibling suite that launched during this
     * row's 45-second window would go red for a mutation it knows nothing about.
     * The same reason `deck-seam-mutations.sh` puts its three unit edits behind
     * `ALLOW_UNIT_EDITS`.
     *
     *   ALLOW_SHARED_EDITS=1 node tools/suites/deck-host-mutations.mjs --only L21
     *
     * L22 covers the same assertion's HEIGHT half from a file this slice owns, so
     * the default battery is not blind to it — only to the colour half, which is
     * what an unstyled page loses.
     */
    shared: true,
    edits: [[ASSETS, "  '.css': 'text/css; charset=utf-8',", "  '.css': 'text/plain; charset=utf-8',"]],
    expect: ['...and the deck PAINTED before it went'],
  },
  {
    id: 'L22',
    why: 'the deck sized to the clamp ceiling whatever it measured — the surface is 900 px of mostly nothing, and "it drew something" cannot tell',
    edits: [['src/main/deck-host.js',
      'export const clampDeckHeight = (px) => Math.max(DECK_MIN_H, Math.min(DECK_MAX_H, Math.round(Number(px) || 0)));',
      'export const clampDeckHeight = () => DECK_MAX_H;']],
    expect: ['page.setHeight is ADVICE the Host clamps', '...and the deck PAINTED before it went'],
  },
  {
    id: 'L23',
    why: 'main stops putting the source kind on the profile — the deck boots knowing what it is hosted BY but not what it is bound TO',
    /**
     * `deck-seam` cannot make this one. It drives `ui/host.js` over a STUBBED
     * bridge, so a mutation in `src/main/deck-host.js` is a file that battery
     * never reaches; its case 51 breaks the same claim one layer down, at the
     * hole module. This is the layer only a launch can see: main decides, the
     * `sendSync` carries, the preload exposes, and all three have to agree.
     */
    edits: [[DECKHOST,
      'event.returnValue = { hosted: transport !== null, sourceKind };',
      'event.returnValue = { hosted: transport !== null };']],
    expect: ['the deck profile carries the SOURCE KIND across the real ipc',
      '...and it is carried BESIDE `hosted`'],
  },
  {
    id: 'L24',
    why: 'the hole module stops exposing the source kind — the bridge carries it and nothing reads it, which is the shape a surface silently loses a fact in',
    /**
     * THE PROPERTY IS REMOVED, NOT SET TO `undefined`, and the difference is the
     * point of two assertions rather than one. `sourceKind: undefined` keeps the
     * KEY, so `Object.keys(host)` is unchanged and the shape assertion stays
     * green while the value one goes red — measured. Deleting it moves both, and
     * that is what a Host which never learned to carry the fact looks like.
     */
    edits: [[HOST, '  sourceKind: SOURCE_KIND,', '  /* the Host never learned to carry it */']],
    expect: ['...and the module it imported is OURS',
      'the deck profile carries the SOURCE KIND across the real ipc'],
  },
];

// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7)
  || (args.includes('--only') ? args[args.indexOf('--only') + 1] : '');

/**
 * A row marked `shared` edits a file this slice does not own, so it is off the
 * default battery: a sibling suite launching inside its window would go red for
 * a mutation it knows nothing about. `--only` still runs it, and so does
 * ALLOW_SHARED_EDITS=1 — deliberately, and on a quiet machine.
 */
const allowShared = process.env.ALLOW_SHARED_EDITS === '1';
const rows = MUTATIONS.filter((m) => !m.skip)
  .filter((m) => (only ? m.id === only : true))
  .filter((m) => (only || allowShared ? true : !m.shared));

const OUTDIR = path.join(ROOT, 'out', 'deck-host-mutations');
fs.mkdirSync(OUTDIR, { recursive: true });

/** Every assertion name the clean suite prints, so coverage can be counted. */
function assertionNames(out) {
  return out.split('\n').filter((l) => /^(ok  |FAIL)/.test(l))
    .map((l) => l.slice(6).split('  ')[0].trim());
}
const failedNames = (out) => out.split('\n').filter((l) => l.startsWith('FAIL')).map((l) => l.slice(6).split('  ')[0].trim());

/**
 * THE TREE GUARD HAS TO BE TOLD, AND UNTIL IT WAS THIS BATTERY CAUGHT NOTHING.
 *
 * `tools/lib/tree-guard.mjs` refuses to run a suite while `src/` has uncommitted
 * changes — which is the correct default, and which a mutation battery violates
 * ON PURPOSE on every single row. Without the flag below the suite printed
 * `REFUSING TO RUN` instead of measuring, `failedNames()` found no `FAIL` lines
 * in the refusal, and every row reported the same thing:
 *
 *     0 reds: (none — the suite is blind to this)
 *
 * A battery that cannot see is strictly worse than no battery: it reports the
 * shape of a clean sweep. Measured on a row nobody had touched (`--only L2`,
 * `main` reading one storage area whatever the deck asked for) — an edit that
 * unquestionably breaks a shipped assertion — and it came back with 0 reds.
 *
 * `void-canary` does not cover this: its battery check globs
 * `tools/suites/*-mutations.sh`, and this battery is `.mjs`. That gap is the
 * reason this went unseen, and it is worth closing separately.
 *
 * The flag is honest rather than a bypass: the suite still prints every dirty
 * path it was asked to measure over, into this battery's own per-row log.
 */
function runSuite() {
  const r = spawnSync('node', ['tools/suites/deck-host.mjs'],
    { cwd: ROOT,
      env: { ...process.env, STEM_WORKBENCH_ALLOW_DIRTY: '1' },
      encoding: 'utf8', timeout: 300000 });
  return `${r.stdout || ''}${r.stderr || ''}`;
}

console.log(`deck-host-mutations: ${rows.length} rows\n`);

// The clean run is the reference: every assertion that exists, and the proof
// that the tree is green BEFORE anything is broken.
const clean = runSuite();
fs.writeFileSync(path.join(OUTDIR, 'clean.log'), clean);
const allNames = new Set(assertionNames(clean));
const cleanReds = failedNames(clean);
if (cleanReds.length) {
  console.error(`the tree is NOT GREEN before mutating: ${cleanReds.join(' | ')}`);
  process.exit(2);
}
console.log(`clean: ${allNames.size} assertions, 0 failed\n`);

const covered = new Set();
let bad = 0;

/**
 * A `finally` DOES NOT RUN ON A SIGNAL, and this battery is long enough that
 * somebody will kill it. Measured the expensive way: a `pkill` mid-row left the
 * relay mutation on `src/main/deck-host.js`, where the next reader would have
 * found a defect this file had written and not put back.
 *
 * So the row in flight is held here and the same restore runs from a handler.
 * `process.exit` afterwards, deliberately: a battery that was interrupted has
 * not produced a verdict and must not look like one that did.
 */
let inFlight = null;
const restoreInFlight = () => {
  if (!inFlight) return;
  for (const [file, src] of inFlight) fs.writeFileSync(path.join(ROOT, file), src);
  inFlight = null;
};
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    restoreInFlight();
    console.error(`\n${sig} — the mutation in flight was put back. No verdict was produced.`);
    process.exit(130);
  });
}

for (const m of rows) {
  const originals = m.edits.map(([file]) => [file, fs.readFileSync(path.join(ROOT, file), 'utf8')]);
  inFlight = originals;
  let applied = 0;
  try {
    for (const [file, from, to] of m.edits) {
      const p = path.join(ROOT, file);
      const src = fs.readFileSync(p, 'utf8');
      if (!src.includes(from)) throw new Error(`${m.id}: the text to mutate is not in ${file}: ${JSON.stringify(from.slice(0, 60))}`);
      fs.writeFileSync(p, src.replace(from, to));
      applied++;
    }
    const out = runSuite();
    fs.writeFileSync(path.join(OUTDIR, `${m.id}.log`), out);
    const reds = failedNames(out);
    for (const r of reds) covered.add(r);

    const missing = m.expect.filter((want) => !reds.some((r) => r.startsWith(want)));
    /**
     * `atLeast` MEANS THE LIST IS A MINIMUM, and exactly one row needs it: a deck
     * that does not boot takes most of the surface with it, so enumerating the
     * sixteen assertions that go red would be a list nobody maintains and every
     * new assertion would "fail" that row. Everywhere else the set is EXACT, on
     * purpose — an unexpected red is how an interaction between two mutations, or
     * an assertion that is not measuring what it says, shows up.
     */
    const unexpected = m.atLeast ? [] : reds.filter((r) => !m.expect.some((want) => r.startsWith(want)));
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
    inFlight = null;
    if (applied !== m.edits.length && applied !== 0) console.log(`        (restored after ${applied}/${m.edits.length} edits)`);
  }
}

// ---------------------------------------------------------------------------
// THE COVERAGE REPORT — the half that is invisible from inside a green run.
const uncovered = [...allNames].filter((n) => !covered.has(n));
console.log(`\ncoverage: ${covered.size}/${allNames.size} assertions were turned red by some mutation`);
const skipped = MUTATIONS.filter((r) => r.shared && !allowShared && !only).map((r) => r.id);
if (skipped.length) {
  console.log(`(not run on the default battery, because they edit a file this slice does not own: ${skipped.join(', ')} `
    + '— ALLOW_SHARED_EDITS=1 runs them)');
}
if (uncovered.length) {
  console.log('NO MUTATION EVER TURNED THESE RED:');
  for (const n of uncovered) console.log(`  - ${n}`);
}

console.log(`\ndeck-host-mutations: ${rows.length - bad} passed, ${bad} failed`);
process.exit(bad || (uncovered.length && !only) ? 1 : 0);
