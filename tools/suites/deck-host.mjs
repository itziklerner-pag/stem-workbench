#!/usr/bin/env node
/**
 * deck-host — the DeckHost over ONE REAL LAUNCH: does the vendored deck actually
 * boot under this Host, and does what the Host owes it reach the surface.
 *
 * ===========================================================================
 * WHY THIS IS THE LAUNCH HALF AND NOTHING ELSE
 * ===========================================================================
 * `tools/suites/deck-seam.mjs` gates the CONTRACT — the fourteen members driven
 * over a stub bridge in plain node, with the unit's own `assertHost`,
 * `assertHostOption`, `chordLabel` and `ARM_CODES`, in 0.3 s and on every
 * commit. This suite deliberately does not repeat any of it. Two suites over one
 * seam is two places to edit and one to forget, and this repository already
 * rejected that shape once for the runner itself ("T1 — two runners, drifting
 * where it is most expensive").
 *
 * What is left is everything a stub cannot answer, and the reason it cannot is
 * always the same: a stub agrees with whatever the Host tells it. Only a real
 * launch can say whether the DECK agreed.
 *
 *   · the vendored `ui/embed.js` really boots — every `assertHost` at its module
 *     scope passed, in the renderer, against our preload
 *   · SESSION and ARM_ERROR reach the SURFACE: the not-armed hint, the banner,
 *     its dismiss button, the Restart it withholds, and the durable record
 *   · `drive` lands on a REAL `<video>` — and `volume` and `evil`, riding in the
 *     same patch, do not
 *   · `requestSpeed(3)` is clamped to 2 by the vendored `speed.js` and the deck's
 *     readout FOLLOWS THE ELEMENT
 *   · the autoplay-next checkbox moves a stored preference through main into the
 *     transport, and the report comes back
 *   · the deck PAINTS, and `out/deck-host/deck.png` is the screenshot
 *
 * ===========================================================================
 * THE BUG THIS SUITE FOUND, WHICH IS ITS WHOLE ARGUMENT IN ONE PARAGRAPH
 * ===========================================================================
 * BEFORE YOU DELETE THIS SUITE because it looks like a slow `deck-seam`, read
 * this.
 *
 * `src/main/deck-host.js` relays the transport's reports to the deck. It was
 * written `toDeck({ t: 'video', ...s })` — and the transport's payloads carry
 * their own `{t: 'state'}`, so the spread OVERWROTE the type. Every state
 * arrived typed `'state'`, the deck's inbound map had no handler for that, and
 * `onState` — the duty the whole deck follows — never fired. Measured on this
 * Host's first launch: `toDeck.state: 48, toDeck.video: 0`. The deck painted
 * perfectly and showed a player that never moved. Nothing anywhere went red.
 *
 * A STUB BRIDGE CANNOT SEE THAT, and the reason generalises to everything in
 * this file: a stub records what the Host sent and agrees with it. What went
 * wrong was what the DECK did with what the Host sent — and only the deck can
 * answer that. The same goes for `requestSpeed(3)`: a stub asserts the 3 went
 * on the wire; only a launch shows it clamped to 2 on a real element with the
 * deck's readout following the ELEMENT rather than the request, which is three
 * processes and the vendored `speed.js` agreeing.
 *
 * ===========================================================================
 *
 * `tools/gate/deck-host.mjs` is the probe inside that launch. It reaches into the
 * deck renderer and pulls out the very `host` object `ui/embed.js` imported
 * (`import('./host.js')` returns the cached instance), so every duty exercised
 * here is the shipped module in the real renderer over the real ipc.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT GATE, stated so the absence is on the record
 * ---------------------------------------------------------------------------
 *   · THE CONTRACT ITSELF — `deck-seam`, above.
 *   · THE ENGINE HALF of the seam — `engine-host`.
 *   · THE SOURCE VIEW'S OWN BEHAVIOUR: L1 in the preload, a YouTube `<video>`,
 *     the autoplay toggle really being found and clicked — `transport`. What is
 *     asserted here is that the deck's members REACH it and that what comes back
 *     reaches the deck.
 *   · SIX STEMS. Nothing here proves the engine produces audio inside this app.
 *   · THE WRITE SET AT MORE THAN ONE LAYER. `drive` is filtered at the seam,
 *     again in `transport.js` and again in the preload; breaking one alone does
 *     not change what reaches the element. That is what defence in depth means
 *     and it is also the limit of what one suite can watch. `deck-seam` watches
 *     the seam's layer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ARM_CODES as DECK_ARM_CODES } from '../../vendor/stem-splitter-live/extension/ui/audio-math.js';
import { ARM_ACCEL } from '../../src/main/keys.js';
import { BROWSER_LOCK, announceLock } from '../lib/locks.mjs';
import { refuseIfCompromised } from '../lib/tree-guard.mjs';

const ID = 'deck-host';
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
const OUT = path.join(ROOT, 'out', ID);
const DECK_ENTRY = 'vendor/stem-splitter-live/extension/ui/embed.html';

/** The shared browser mutex — one path, `tools/lib/locks.mjs`, never spelled here. */
const LOCK = BROWSER_LOCK;
// One line, and only when this run has stepped out of the shared queue — a run
// holding the wrong mutex looks exactly like a run making progress. See tools/lib/locks.mjs.
announceLock();

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


// ==========================================================================
// §2  THE LAUNCH HALF
// ==========================================================================
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

/**
 * THE VIEW IS AS TALL AS THE DECK MEASURED ITSELF TO BE, clamped — and the
 * DECK'S OWN NUMBER is what the comparison is against.
 *
 * Comparing main's last report with the view's bounds is not enough: a Host that
 * answered the clamp ceiling for every report is self-consistent, and the view
 * really is 900 px. Measured — that mutation left the assertion green while the
 * deck was measuring 432.
 */
const measured = Number(R.deckMeasured);
const clamped = Math.max(120, Math.min(900, measured));
ok('page.setHeight is ADVICE the Host clamps, and the deck view really is as tall as the DECK measured',
  Number.isFinite(measured) && A(page.heights).length > 0
  && A(page.heights).every((h) => h >= 120 && h <= 900)
  && O(page.deckBounds).height === clamped,
  `the deck measured ${measured} px, the Host was told ${A(page.heights).join(', ')}, the view is `
  + `${O(page.deckBounds).height} px (clamped to ${clamped})`);

/**
 * THE RE-SEND `DeckPage.ready` OWES: "a deck mounted onto an already-playing
 * video is the common case, and 'on change' would leave it blank until something
 * moved."
 *
 * MEASURED AS A DELTA ACROSS ONE `ready`, and on the two channels that do not
 * tick. Counting video messages instead would be an estimator that saturates:
 * the transport pushes state at ~4 Hz regardless, so a Host that answered
 * `ready` with nothing at all still shows plenty of them. Measured — the
 * mutation that ignores `ready` scored no red until this became a delta.
 */
const resend = O(R.resend);
const moved = (k) => Number(O(resend.after)[k] || 0) - Number(O(resend.before)[k] || 0);
ok('page.ready reached the Host, and the Host answered it with the re-send it owes — speed AND autoplay, not just the tick',
  resend.precondition === true && Number(resend.readyFromDeck) >= 1 && moved('speed') >= 1 && moved('autonav') >= 1,
  (resend.precondition === true
    ? `ready x${resend.readyFromDeck} · in the 400 ms after one ready: speed +${moved('speed')}, `
      + `autonav +${moved('autonav')}, video +${moved('video')} — and neither speed nor autonav has a tick of its own`
    : `NEITHER CHANNEL HAD REPORTED in ${resend.waitedMs} ms, so there was nothing to re-send and this delta `
      + `(speed +${moved('speed')}, autonav +${moved('autonav')}) measures nothing`));

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
  + '(contextBridge hands the main world a deeply immutable object, which is why the late-binding claim lives in deck-seam.mjs, where a bridge CAN be swapped)');

// ------------------------------------------------------------- page.close
const close = O(R.close);
ok('page.close takes the deck off the page AND THE AUDIO DOES NOT STOP — the engine is a different process',
  close.visibleBefore === true && close.visibleAfter === false && close.deckClosed === true && close.engineAlive === true,
  `visible ${close.visibleBefore} -> ${close.visibleAfter} · engine alive ${close.engineAlive}`);

// ---------------------------------------------------------- what it drew
const shot = O(O(R.screenshots).deck);
/**
 * A BLANK SURFACE AND A WORKING ONE ARE BOTH A PNG, and so are a STYLED deck and
 * an unstyled one — which is why this reads two numbers rather than "it drew
 * something". Measured on this machine: the deck with its stylesheet is 432 px
 * tall and 241 distinct colours; the same page served with `embed.css` as
 * `text/plain` (the mutation) is 900 px — the clamp ceiling, because nothing
 * sized it — and 100 colours. A threshold of "more than 20" called that a pass.
 */
ok('...and the deck PAINTED before it went: a blank surface and a working one are both a PNG',
  shot.ok === true && shot.colours >= 150 && shot.height <= 600,
  shot.ok ? `${shot.width}x${shot.height}, ${shot.colours} distinct colours, ${shot.bytes} bytes -> ${path.relative(ROOT, path.join(OUT, 'deck.png'))}`
    + ' (unstyled, the same page measured 900x100)'
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
