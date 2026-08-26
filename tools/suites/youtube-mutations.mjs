#!/usr/bin/env node
/**
 * THE MUTATION BATTERY FOR `youtube` — every assertion in the manual suite,
 * watched RED.
 *
 * `AGENTS.md`: *"Every assertion you add must be WATCHED RED BY MUTATION. Break
 * the code, show it fails, restore. Name the mutation. An assertion you did not
 * watch fail is not evidence."*
 *
 *   node tools/suites/youtube-mutations.mjs                 # the report battery
 *   node tools/suites/youtube-mutations.mjs --only R7       # one row
 *   node tools/suites/youtube-mutations.mjs --live          # ...and the product rows
 *
 * ---------------------------------------------------------------------------
 * TWO KINDS OF ROW, AND THE DIFFERENCE IS NOT BLURRED
 * ---------------------------------------------------------------------------
 * `tools/suites/youtube.mjs` judges ONE file: the `report.json` a launch wrote.
 * That makes two different mutations possible, and they prove different things:
 *
 *   REPORT ROWS (`R*`, the default battery). One field of a RECORDED report is
 *       doctored and the suite is re-run over it with `YOUTUBE_REPORT=<file>`,
 *       launching nothing. ~0.2 s each, deterministic, and they cover every
 *       assertion. WHAT THEY PROVE: the assertion can fail, names the right
 *       thing, and is reading the field it claims to read. WHAT THEY DO NOT
 *       PROVE: that a broken PRODUCT would produce that field. Stated here
 *       rather than left to be assumed.
 *
 *   PRODUCT ROWS (`L*`, `--live`). A real edit to `src/`, a real launch against
 *       real youtube.com, ~3 minutes each and somebody else's bandwidth. They
 *       are the half that proves the probe MEASURES the product. There are few
 *       of them on purpose, and each names the report field it moves, so a
 *       reader can see which `R*` row it is the expensive twin of.
 *
 * A row that produces NO red means the suite is blind to that defect. An
 * assertion that NO row ever turned red is the failure that is invisible from
 * inside a green run, and the coverage report at the end is the only place it
 * shows up.
 *
 * ---------------------------------------------------------------------------
 * IT NEEDS A RECORDED RUN — AND THE `--live` ROWS OVERWRITE IT
 * ---------------------------------------------------------------------------
 * `out/youtube/report.json`, or `--report <file>`. The battery refuses to start
 * on a report the clean suite does not already pass: doctoring a red report and
 * watching it stay red proves nothing at all.
 *
 * **A `--live` row launches the suite, and the suite writes `out/youtube/`.** So
 * after one live row the default baseline is a MUTATED run's report, and the
 * next invocation refuses to start — correctly, and confusingly. Point `--report`
 * at a preserved good run for live rows:
 *
 *     node tools/suites/youtube-mutations.mjs --live --only L2 \
 *       --report docs/evidence/step3-youtube/report.json
 *
 * That is why a clean run is committed under `docs/evidence/`: it is the
 * baseline this battery is meant to be pointed at, and it cannot be clobbered by
 * a run.
 *
 * ---------------------------------------------------------------------------
 * WATCHED RED — the recorded result
 * ---------------------------------------------------------------------------
 * Run on 2026-08-26, Electron 44.0.0 / Chromium 152.0.7977.54, Linux, against
 * `https://www.youtube.com/watch?v=dQw4w9WgXcQ`:
 *
 *   REPORT ROWS   **43 rows, 43 caught, 0 failed. Coverage 26/26** — every
 *       assertion in the suite was turned red by some row, and every row turned
 *       red exactly the set it declared.
 *   PRODUCT ROWS  three, each a real edit to `src/` and a real launch against
 *       the real site. **All three caught.**
 *       L1  the mute deleted from `src/main/youtube.js`         -> 1 red, exactly
 *           "THE VIEW IS MUTED FOR ITS WHOLE LIFE".
 *       L2  the arm item's accelerator removed (`deck-host.js`) -> 1 red, exactly
 *           "the arm gesture is REACHABLE".
 *       L3  `engine-messages.js` originates nothing             -> 8 reds, every
 *           one downstream of `CAPTURE_START`: the capture, the weights, the
 *           live pipeline, the METERS payload, the master level and the reload.
 *           It is the row that shows how far a single dropped message travels,
 *           and the only one declared `atLeast`.
 *
 *       L3 IS ALSO THE SLOW ONE — about 12 minutes, because an app that never
 *       captures makes the probe wait out every one of its ceilings in turn
 *       (recording 60 s, DECK_PREPARED 180 s, live 180 s...). That cost is the
 *       ceilings', not the battery's, and it is named here so nobody assumes the
 *       run has hung.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUTDIR = path.join(ROOT, 'out', 'youtube-mutations');
const argv = process.argv.slice(2);
const only = (argv.find((a) => a.startsWith('--only')) || '').split('=')[1]
  || (argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null);
const live = argv.includes('--live');
const reportArg = argv.includes('--report') ? argv[argv.indexOf('--report') + 1] : null;
const BASE = reportArg || path.join(ROOT, 'out', 'youtube', 'report.json');

/**
 * @type {{id: string, why: string, edit: (r: any) => void, expect: string[], atLeast?: boolean}[]}
 *
 * `expect` is a list of assertion-name PREFIXES, and the set is EXACT unless the
 * row says `atLeast` — an unexpected red is how an assertion that is not
 * measuring what it says shows up.
 */
const REPORT_ROWS = [
  { id: 'R1', why: 'the report is not a report at all — the launch never wrote one',
    edit: (r) => { delete r.probe; },
    expect: ['the app launches from its real entry point'], atLeast: true },

  { id: 'R2', why: 'THE PAGE HAS NO PLAYER: youtube.com loaded and there is no <video> in it',
    edit: (r) => { r.page.hasVideo = false; },
    expect: ['the source view is on the REAL youtube.com'] },

  { id: 'R3', why: 'THE SOURCE IS NOT YOUTUBE: the run was pointed at a local fixture and reported success',
    edit: (r) => { r.sourceUrlLoaded = 'file:///home/x/player.html'; },
    expect: ['the source view is on the REAL youtube.com'] },

  { id: 'R4', why: 'THE RUN DOES NOT SAY WHAT IT MEASURED: no duration, so an ad cannot be told from a song',
    edit: (r) => { r.page.duration = null; },
    expect: ['the source view is on the REAL youtube.com', '...and the run records what it was measuring'] },

  { id: 'R5', why: 'THE VIEW IS NOT MUTED — the user hears the raw page under the stems',
    edit: (r) => { r.mute.isAudioMuted = false; },
    expect: ['THE VIEW IS MUTED FOR ITS WHOLE LIFE'] },

  { id: 'R6', why: 'A NAVIGATION STARTED UNMUTED — the 1.90 s leak the spike measured, one navigation at a time',
    edit: (r) => { r.mute.witness.unmutedNavigations = 1; },
    expect: ['THE VIEW IS MUTED FOR ITS WHOLE LIFE'] },

  { id: 'R7', why: 'THE VIDEO NEVER PLAYED: the click landed on a consent wall and the run measured silence',
    edit: (r) => { r.playing.paused = true; },
    expect: ['the page\'s own player is PLAYING'] },

  { id: 'R7b', why: 'THE MEASUREMENT WAS TAKEN OVER A PRE-ROLL AD — six real stems separated out of a car commercial',
    edit: (r) => { r.offlinePlayer.adShowing = true; },
    expect: ['...and what it measured is the CONTENT'] },

  { id: 'R7c', why: 'THE AD NEVER ENDED and the run went ahead anyway',
    edit: (r) => { r.content.adShowing = true; r.ad.timedOut = true; },
    expect: ['...and what it measured is the CONTENT'] },

  { id: 'R8', why: 'THE SHIPPED PRELOAD DID NOT REPORT IT: the Host cannot see the player move',
    edit: (r) => { r.transportAfterPlay.playing = false; },
    expect: ['...and the SHIPPED preload reported it'] },

  { id: 'R9', why: 'THE ARM GESTURE IS UNREACHABLE: a menu item with no accelerator, which armShortcut() then cannot answer with',
    edit: (r) => { r.menu.armAccelerator = ''; },
    expect: ['the arm gesture is REACHABLE'] },

  { id: 'R10', why: 'SESSION NEVER REACHED THE DECK: the deck stays blank and never learns it is armed',
    edit: (r) => { r.seam.session = null; },
    expect: ['...and clicking it armed the deck'] },

  { id: 'R11', why: 'THE DECK NEVER ASKED FOR THE CAPTURE: follow() never reached `start`',
    edit: (r) => { r.seam.swCaptureStart = null; },
    expect: ['...and the DECK asked for the capture itself'] },

  { id: 'R12', why: 'CAPTURE_START CARRIES A `tabId` — the extension\'s field, on a product with no tabs',
    edit: (r) => { r.seam.captureStart.keys = [...r.seam.captureStart.keys, 'tabId'].sort(); },
    expect: ['...and the HOST originated CAPTURE_START'] },

  { id: 'R13', why: 'THE ENGINE IS NOT RECORDING: the grant was refused and nothing said so',
    edit: (r) => { r.capture.status = 'idle'; },
    expect: ['the engine is RECORDING the source view'] },

  { id: 'R14', why: 'THE RING IS FED SILENCE: frames climb at the same rate whether the tab is playing or muted-at-source',
    edit: (r) => { r.deckSummary.A.capture.peak = [0, 0]; },
    expect: ['the engine is RECORDING the source view'] },

  { id: 'R15', why: 'THE WEIGHTS ARRIVED SHORT: a truncated model file, and the unit\'s verify would have caught it',
    edit: (r) => { r.model.got = 1024; },
    expect: ['THE REAL WEIGHTS WENT THROUGH THIS HOST'] },

  { id: 'R15b', why: 'NO ORT SESSION: the bytes crossed the seam and nothing was built from them',
    edit: (r) => { r.deckSummary.A.session = 'error'; },
    expect: ['THE REAL WEIGHTS WENT THROUGH THIS HOST'] },

  { id: 'R16', why: 'THE LIVE PIPELINE NEVER RAN: the deck primed and stalled',
    edit: (r) => { r.liveRunning = false; },
    expect: ['THE LIVE PIPELINE RAN'] },

  { id: 'R16b', why: 'THE INSTRUMENT DID NOT LOOK: no scheduler numbers, so "it kept up" is an opinion',
    edit: (r) => { r.liveStats = null; },
    expect: ['THE LIVE PIPELINE RAN'] },

  { id: 'R17', why: 'ONE STEM IS MISSING FROM THE METERS: five stems and a master, reported as six',
    edit: (r) => { r.stems.keysSeen = r.stems.keysSeen.filter((k) => k !== 'piano'); },
    expect: ['SIX STEMS COME BACK, BY NAME'] },

  { id: 'R18', why: 'THE DECK PAINTS ITS RACK IN THE WRONG ORDER — guitar and piano have no number key, so position IS part of their identity',
    edit: (r) => { r.deckPaint.stems = [r.deckPaint.stems[1], r.deckPaint.stems[0], ...r.deckPaint.stems.slice(2)]; },
    expect: ['...and the DECK painted the six as its own rack'] },

  { id: 'R18b', why: 'A STRIP IS MISLABELLED: the word over the fader is not the stem the fader moves — six correct stems, wrongly named',
    edit: (r) => { r.deckPaint.names = ['Piano', ...r.deckPaint.names.slice(1)]; },
    expect: ['...and the DECK painted the six as its own rack'] },

  { id: 'R18c', why: 'THE RACK IS NOT THE MODEL\'S SIX: a strip for a stem the separator does not produce',
    edit: (r) => { r.deckPaint.stems = ['strings', ...r.deckPaint.stems.slice(1)];
                   r.deckPaint.names = ['strings', ...r.deckPaint.names.slice(1)]; },
    expect: ['...and the DECK painted the six as its own rack'] },

  { id: 'R19', why: 'THE DECK PLAYED NOTHING AUDIBLE: the master sits under the presence floor and nothing else notices',
    edit: (r) => { r.stems.series.master.rmsMean = 0.0001; },
    expect: ['...and what the deck PLAYED is audible'] },

  { id: 'R20', why: 'THE SEPARATOR THREW instead of separating — the one thing `Backend.separate` is allowed to do besides work',
    edit: (r) => { r.offline = { THREW: 'RuntimeError: memory access out of bounds' }; },
    expect: ['THE SEPARATOR RAN', '...and the audio it separated came off the muted view',
      'SIX STEMS CAME BACK', '...and the LABELS ARE THE SEPARATOR', '...and the six SUM BACK to the mix',
      '...and no two of them are the SAME SIGNAL'] },

  { id: 'R20b', why: 'THE SEGMENT NEVER FILLED: the separator ran over a partly-empty buffer',
    edit: (r) => { r.offline.captured = 1024; },
    expect: ['THE SEPARATOR RAN'] },

  { id: 'R20c', why: 'IT WAS NOT THE REAL WEIGHTS: a different file went into the backend',
    edit: (r) => { r.offline.modelBytes = 4096; },
    expect: ['THE SEPARATOR RAN'] },

  { id: 'R21', why: 'THE CAPTURE IS MONO: half the stereo image gone, and every level still looks plausible',
    edit: (r) => { r.offline.settings.channelCount = 1; },
    expect: ['...and the audio it separated came off the muted view'] },

  { id: 'R21b', why: 'AGC IS ON — the spike\'s Limitation 6: the level decays 17x over 8 s and the gate cannot see it',
    edit: (r) => { r.offline.settings.autoGainControl = true; },
    expect: ['...and the audio it separated came off the muted view'] },

  { id: 'R21c', why: 'THE CAPTURE IS AT 48 kHz: the resampling the whole no-resample design exists to avoid',
    edit: (r) => { r.offline.settings.sampleRate = 48000; },
    expect: ['...and the audio it separated came off the muted view'] },

  { id: 'R21d', why: 'THE SEGMENT IS SILENT: a capture that opened on a muted element and separated nothing',
    edit: (r) => { r.offline.mixRms = { l: 0.00001, r: 0.00001 }; },
    expect: ['...and the audio it separated came off the muted view'] },

  { id: 'R22', why: 'FIVE STEMS CAME BACK, NOT SIX',
    edit: (r) => { r.offline.perStem = r.offline.perStem.slice(0, 5); },
    expect: ['SIX STEMS CAME BACK', '...and the LABELS ARE THE SEPARATOR',
      '...and no two of them are the SAME SIGNAL'] },

  // Swaps two whole ENTRIES, names and all. It is caught TWICE now, and by two
  // different claims: the shape row sees `stem !== STEMS[i]`, and the label row
  // sees that the plane sitting at the `bass` index is a drum kit.
  { id: 'R22b', why: 'THE PLANES ARE IN THE WRONG ORDER: six correct stems, mislabelled at the buffer layout',
    edit: (r) => { const a = r.offline.perStem; r.offline.perStem = [a[1], a[0], ...a.slice(2)]; },
    expect: ['SIX STEMS CAME BACK', '...and the LABELS ARE THE SEPARATOR'] },

  { id: 'R23', why: 'SIX COPIES OF THE MIX: the fan-out a stalled separator publishes — it sums to six times the input',
    edit: (r) => { r.offline.sum.sumRms = r.offline.sum.mixRms * 6;
                   r.offline.sum.residualRms = r.offline.sum.mixRms * 5; },
    expect: ['...and the six SUM BACK to the mix'] },

  { id: 'R23b', why: 'THE STEMS DO NOT ADD BACK: a residual as large as the input, which is not a masking separator at all',
    edit: (r) => { r.offline.sum.residualRms = r.offline.sum.mixRms * 0.9; },
    expect: ['...and the six SUM BACK to the mix'] },

  { id: 'R24', why: 'SIX IDENTICAL STEMS: the same signal six times, which every level check but this one calls a pass',
    edit: (r) => { const v = r.offline.perStem[0]; r.offline.perStem = r.offline.perStem.map((x) => ({ ...x, rmsL: v.rmsL, rmsR: v.rmsR })); },
    expect: ['...and no two of them are the SAME SIGNAL'] },

  { id: 'R24b', why: 'ONE STEM IS DIGITAL SILENCE — a plane the separator never wrote',
    edit: (r) => { r.offline.perStem[4] = { ...r.offline.perStem[4], rmsL: 0, rmsR: 0, peak: 0 }; },
    expect: ['...and no two of them are the SAME SIGNAL'] },

  /**
   * THE AUDIT'S OWN COUNTEREXAMPLE, AS A ROW. `stems_k = a_k * mix` with the
   * `a_k` summing to 1: residual EXACTLY 0, sum ratio EXACTLY 1.0, six DIFFERENT
   * levels, and six planes that are the same signal. Before the correlation
   * assertion this report was green on all three of the tests that were supposed
   * to catch it — which is why this row expects EXACTLY ONE red, and why that
   * one red is the point of the repair.
   */
  { id: 'R24c', why: 'SIX SCALED COPIES OF THE MIX: residual 0, sum ratio 1.0, six distinct levels — and one signal',
    edit: (r) => {
      const a = [0.35, 0.25, 0.18, 0.12, 0.07, 0.03];
      r.offline.sum.residualRms = 0;
      r.offline.sum.sumRms = r.offline.sum.mixRms;
      r.offline.perStem = r.offline.perStem.map((x, k) => ({
        ...x,
        rmsL: r.offline.mixRms.l * a[k],
        rmsR: r.offline.mixRms.r * a[k],
        peak: 0.9 * a[k],
        // ...and every plane keeps the MIX's spectrum, because a scaled copy has it.
        spectrum: { ...r.offline.mixSpectrum },
      }));
      r.offline.pairwise = r.offline.pairwise.map((x) => ({ ...x, r: 1 }));
    },
    expect: ['...and the LABELS ARE THE SEPARATOR', '...and no two of them are the SAME SIGNAL'] },

  /**
   * THE PERMUTATION THE OLD ORDER CHECK COULD NOT SEE. `R22b` swaps whole
   * ENTRIES, names and all, which is a mislabelled REPORT. This one leaves the
   * six names exactly where they are and rotates the NUMBERS under them, which
   * is what a backend writing its planes in another order would produce — and
   * `perStem[i].stem === STEMS[i]` is still true, because the probe wrote those
   * names itself.
   */
  { id: 'R22c', why: 'THE BACKEND WROTE ITS PLANES IN ANOTHER ORDER: the six names stay put and the audio under them rotates',
    edit: (r) => {
      const a = r.offline.perStem;
      const rot = a.map((_, i) => a[(i + 1) % a.length]);
      r.offline.perStem = a.map((x, i) => ({
        ...x, rmsL: rot[i].rmsL, rmsR: rot[i].rmsR, peak: rot[i].peak, spectrum: rot[i].spectrum,
      }));
    },
    expect: ['...and the LABELS ARE THE SEPARATOR'] },

  { id: 'R25', why: 'THE DECK IS BLANK: a photograph of a view that painted one colour',
    edit: (r) => { r.shot.deck.colours = 1; },
    expect: ['the deck is PAINTED while the stems are live'] },

  { id: 'R26', why: 'THE CAPTURE DIED ON RELOAD: the frame counter froze when the document went',
    edit: (r) => { r.reload.climbed = false; },
    expect: ['THE CAPTURE SURVIVES A FULL PAGE RELOAD'] },

  { id: 'R27', why: 'THE BUS DROPPED TRAFFIC FOR WANT OF A LISTENER — the quietest failure on the whole seam',
    edit: (r) => { r.busStats.dropped['no-listener'] = 3; },
    expect: ['nothing on the bus was dropped'] },
];

/**
 * THE EXPENSIVE HALF. Each row is a real edit to a shipped file and a real run
 * against the real site, so each costs ~3 minutes and the browser mutex. They
 * exist to prove the PROBE measures the product — the `R*` rows above prove only
 * that the ASSERTIONS read the report.
 */
const PRODUCT_ROWS = [
  { id: 'L1', why: 'THE MUTE IS GONE — spike variant (a): 1.90 s of full-level audio before the capture opens',
    file: 'src/main/youtube.js',
    from: '  wc.setAudioMuted(true);\n', to: '  // MUTATION L1: the mute is gone\n',
    moves: 'report.mute.isAudioMuted, the R5 field',
    expect: ['THE VIEW IS MUTED FOR ITS WHOLE LIFE'], atLeast: true },

  { id: 'L2', why: 'THE ARM ITEM HAS NO ACCELERATOR — armShortcut() answers null and the deck prints the extension\'s sentence alone',
    file: 'src/main/deck-host.js',
    from: "{ id: 'arm', label: 'Arm this Source', accelerator: ARM_ACCEL, click: () => arm() }",
    to: "{ id: 'arm', label: 'Arm this Source', click: () => arm() }",
    moves: 'report.menu.armAccelerator, the R9 field',
    expect: ['the arm gesture is REACHABLE'], atLeast: true },

  { id: 'L3', why: 'THE HOST ORIGINATES NO CAPTURE_START — the deck asks, nothing answers, and the engine never opens a capture',
    file: 'src/main/engine-messages.js',
    from: '    const delivered = bus.originate(BUS.engine, msg);',
    to: '    const delivered = true; void msg;   // MUTATION L3: originate nothing',
    moves: 'report.seam.captureStart and everything downstream of it',
    expect: ['...and the HOST originated CAPTURE_START'], atLeast: true },
];

// ---------------------------------------------------------------------------
fs.mkdirSync(OUTDIR, { recursive: true });
if (!fs.existsSync(BASE)) {
  console.error(`no recorded run at ${path.relative(ROOT, BASE)} — run \`node tools/verify.mjs --only youtube\` first, `
    + 'or point --report at one');
  process.exit(2);
}
const baseline = JSON.parse(fs.readFileSync(BASE, 'utf8'));

const assertionNames = (out) => out.split('\n').filter((l) => /^(ok  |FAIL)/.test(l))
  .map((l) => l.slice(6).split('  ')[0].trim());
const failedNames = (out) => out.split('\n').filter((l) => l.startsWith('FAIL'))
  .map((l) => l.slice(6).split('  ')[0].trim());

function judge(reportFile) {
  const r = spawnSync('node', ['tools/suites/youtube.mjs'],
    { cwd: ROOT, env: { ...process.env, YOUTUBE_REPORT: reportFile }, encoding: 'utf8', timeout: 120_000 });
  return `${r.stdout || ''}${r.stderr || ''}`;
}
function launchAndJudge() {
  const r = spawnSync('node', ['tools/suites/youtube.mjs'],
    { cwd: ROOT, env: { ...process.env }, encoding: 'utf8', timeout: 1_800_000 });
  return `${r.stdout || ''}${r.stderr || ''}`;
}

// The clean run is the reference: every assertion that exists, and the proof
// that the recorded report is GREEN before anything is doctored.
const clean = judge(BASE);
fs.writeFileSync(path.join(OUTDIR, 'clean.log'), clean);
const allNames = new Set(assertionNames(clean));
const cleanReds = failedNames(clean);
if (cleanReds.length) {
  console.error(`the recorded report is NOT GREEN before doctoring it: ${cleanReds.join(' | ')}`);
  process.exit(2);
}
console.log(`youtube-mutations: baseline ${path.relative(ROOT, BASE)} — ${allNames.size} assertions, 0 failed\n`);

const covered = new Set();
let bad = 0, ran = 0;

const rows = REPORT_ROWS.filter((m) => !only || m.id === only);
for (const m of rows) {
  const doctored = JSON.parse(JSON.stringify(baseline));
  let out;
  try { m.edit(doctored); }
  catch (err) { console.log(`FAIL  ${m.id}  the edit could not be applied to this report: ${err.message}`); bad++; continue; }
  const file = path.join(OUTDIR, `${m.id}.report.json`);
  fs.writeFileSync(file, JSON.stringify(doctored, null, 2));
  out = judge(file);
  fs.writeFileSync(path.join(OUTDIR, `${m.id}.log`), out);
  ran++;
  report(m, out);
}

if (live) {
  const liveRows = PRODUCT_ROWS.filter((m) => !only || m.id === only);
  for (const m of liveRows) {
    const p = path.join(ROOT, m.file);
    const original = fs.readFileSync(p, 'utf8');
    try {
      if (!original.includes(m.from)) throw new Error(`the text to mutate is not in ${m.file}: ${JSON.stringify(m.from.slice(0, 60))}`);
      fs.writeFileSync(p, original.replace(m.from, m.to));
      const out = launchAndJudge();
      fs.writeFileSync(path.join(OUTDIR, `${m.id}.log`), out);
      ran++;
      report(m, out, ` (moves ${m.moves})`);
    } catch (err) {
      bad++;
      console.log(`FAIL  ${m.id}  could not be applied: ${err.message}`);
    } finally {
      fs.writeFileSync(p, original);
    }
  }
}

// ---------------------------------------------------------------------------
// THE COVERAGE REPORT — the half that is invisible from inside a green run.
const uncovered = [...allNames].filter((nm) => !covered.has(nm));
console.log(`\ncoverage: ${covered.size}/${allNames.size} assertions were turned red by some row`);
if (!live) console.log('(the product rows L1-L3 were NOT run — `--live` runs them, one real launch each)');
if (uncovered.length) {
  console.log('NO ROW EVER TURNED THESE RED:');
  for (const nm of uncovered) console.log(`  - ${nm}`);
}
console.log(`\nyoutube-mutations: ${ran - bad} passed, ${bad + (only ? 0 : uncovered.length ? 1 : 0)} failed`);
process.exit(bad || (uncovered.length && !only) ? 1 : 0);

function report(m, out, extra = '') {
  const reds = failedNames(out);
  for (const r of reds) covered.add(r);
  const missing = m.expect.filter((want) => !reds.some((r) => r.startsWith(want)));
  const unexpected = m.atLeast ? [] : reds.filter((r) => !m.expect.some((want) => r.startsWith(want)));
  const verdict = reds.length === 0 ? 'NO RED' : (missing.length || unexpected.length ? 'WRONG SET' : 'red');
  if (verdict !== 'red') bad++;
  console.log(`${verdict === 'red' ? 'ok  ' : 'FAIL'}  ${m.id}  ${m.why}${extra}`);
  console.log(`        ${reds.length} red${reds.length === 1 ? '' : 's'}: ${reds.join(' | ') || '(none — the suite is blind to this)'}`);
  if (missing.length) console.log(`        EXPECTED AND STILL GREEN: ${missing.join(' | ')}`);
  if (unexpected.length) console.log(`        UNEXPECTED: ${unexpected.join(' | ')}`);
}
