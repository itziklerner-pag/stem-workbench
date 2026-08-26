#!/usr/bin/env node
/**
 * youtube — the whole product, once, against the real site. MANUAL.
 *
 *     node tools/verify.mjs --only youtube          (~5 min, one real launch)
 *     node tools/verify.mjs --manual
 *     STEM_WORKBENCH_YT_URL='https://www.youtube.com/watch?v=…' node tools/suites/youtube.mjs
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS MANUAL, AND WHY IT EXISTS ANYWAY
 * ---------------------------------------------------------------------------
 * `docs/TESTING.md` §7. Every other windowed suite here drives a LOCAL fake
 * player, on purpose: CI must never depend on YouTube's DOM and must never hit a
 * bot wall. The cost of that rule is Limitation 14 of the spike —
 *
 *   > Nothing in CI will ever catch a YouTube-side regression — DRM/EME content
 *   > returning silence, a player change, an autoplay-muted default.
 *
 * — and this suite is the answer to it: the same boot / seam / transport claims
 * as `smoke`, made against `youtube.com` itself, plus the two things no fixture
 * can carry (a real page reload under a live capture) and the one thing nothing
 * else in this repository asserts at all:
 *
 *   **SIX STEMS ACTUALLY COME OUT OF THE ENGINE, IN THIS APP, WITH THE REAL
 *   WEIGHTS.** `smoke`'s own header names that as its largest coverage hole
 *   ("NOTHING IN THE DEFAULT PLAN PROVES THE VENDORED ENGINE PRODUCES AUDIO
 *   INSIDE THIS APP"). `vendor-unit` proves the engine is correct; `engine-host`
 *   proves this Host wires it and that a capture carries audio; the seam between
 *   those two claims — a real song going in and six named stems coming out — is
 *   here and nowhere else.
 *
 * It is never on a default plan, so a red here NEVER blocks a build. It is a
 * realism finding: either the site changed, or this app stopped working on it.
 *
 * ---------------------------------------------------------------------------
 * IT MUST NOT ASSERT A LEVEL BAND — §7, and the run that taught it
 * ---------------------------------------------------------------------------
 * The source level is unknown and uncontrolled. One recorded YouTube run in the
 * spike was measuring a PRE-ROLL AD, at `duration 60.101` where every other run
 * read `213.061`, with a capture series dipping to `0.00428` — within 2.3x of a
 * floor somebody was about to call safe. So every level claim below is
 * PRESENCE/ABSENCE against one floor, `RMS_FLOOR` = 0.01, which is 26 dB above
 * the silence ceiling `capture-mute` measures, and the run RECORDS what it was
 * measuring: the video id, the duration, the ad flag, the element's volume.
 *
 * ---------------------------------------------------------------------------
 * TWO CLAIMS, TWO MEASUREMENTS, AND ONLY ONE OF THEM IS ABOUT THE PRODUCT
 * ---------------------------------------------------------------------------
 * SEPARATING SIX STEMS and KEEPING UP WITH PLAYBACK are different claims, and a
 * machine can fail the second while the first is perfect. `offscreen/live.js`
 * runs one 7.8 s SEGMENT every 1.95 s HOP, so live mode needs about 4x real
 * time; with a WebGPU adapter the engine has it, and on CPU-only wasm it does
 * not. A deck that cannot keep up does exactly what it is designed to do — drops
 * the chunk, plays the PASSTHROUGH mix, and reports it — and then the per-stem
 * meters read zero while the master reads the music. None of that is a statement
 * about the separator.
 *
 * So the run measures both, and this suite judges them differently:
 *
 *   THE LIVE PIPELINE — RECORDED, NOT ASSERTED. Twenty seconds of `METERS`
 *       (`offscreen/live.js`:1527 — one entry per `STEMS` name plus `master`,
 *       post-stem-fader, pre-crossfader, ~30 Hz), plus the scheduler's own
 *       `chunks / drops / p95ChunkMs / hopSeconds` read back with
 *       `DEV_LIVE_STATS`. Whether the box kept up is printed as a NOTE with the
 *       numbers behind it: it is a property of the machine (docs/TESTING.md §3
 *       rule 8), and a red for "this box has no GPU" is a red people learn to
 *       ignore. What IS asserted from it: the six names in the payload, the
 *       deck's rack, and a master above the presence floor.
 *
 *   THE SEPARATOR — ASSERTED, with the clock taken away. One SEGMENT of the
 *       captured audio through `host.createBackend()` and `host.modelBytes()`,
 *       with no deadline: `shared/host.js` says a backend either separates or
 *       throws, and `Deck.infer`'s `budgetMs = Infinity` default is the unit's
 *       name for this case. Six plane pairs at `(k*2+ch)*SEGMENT`, six distinct
 *       levels, none of them digital silence — and the SUM.
 *
 * THE SUM IS THE ONE THAT CANNOT BE FAKED BY A METER. `htdemucs` is a masking
 * separator: its six stems add back to the input, so `rms(mix - Σstems)` is a
 * fraction of the mix. SIX COPIES of the mix would sum to SIX TIMES it. That is
 * the difference between a separator and a fan-out, and it is arithmetic rather
 * than a level.
 *
 * TWO LISTS, AND CONFLATING THEM IS AN ASSERTION THAT GOES RED ON CORRECT CODE:
 * `shared/config.js`'s `STEMS` is `drums, bass, other, vocals, guitar, piano` —
 * the model's plane order, what `METERS` is keyed by, and the order the
 * separator's planes come back in. `ui/embed.js`:78's `STEM_ORDER` is
 * `vocals, drums, bass, other, guitar, piano` — the order the six strips are
 * PAINTED in. The rack assertion reads the second, out of `ui/embed.js` as text,
 * so there is no third copy here to drift.
 *
 * None of this is a stopwatch and none of it is a threshold on content: this
 * suite cannot and must not claim the vocals sound like vocals.
 *
 * ---------------------------------------------------------------------------
 * WATCHED RED — `tools/suites/youtube-mutations.mjs`
 * ---------------------------------------------------------------------------
 * See that file's header for the battery and its numbers. Two kinds of case, and
 * the difference is stated rather than blurred:
 *
 *   THE PRODUCT   a handful of real edits to `src/` and to the hole modules,
 *                 each re-run against the real site. Expensive (minutes each,
 *                 and the site is not ours), so the battery keeps them few and
 *                 names them.
 *   THE REPORT    every assertion here is a pure function of `report.json`, and
 *                 `YOUTUBE_REPORT=<file>` makes the suite judge one without
 *                 launching anything. The battery doctors a recorded report one
 *                 field at a time — the cheap, deterministic, complete half.
 *                 It proves the ASSERTION can fail and name the right thing; it
 *                 does not prove the PRODUCT would produce that report. Both
 *                 halves are needed and neither is presented as the other.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { STEMS, MODEL } from '../../vendor/stem-splitter-live/extension/shared/config.js';
import { BUS } from '../../vendor/stem-splitter-live/extension/shared/host.js';
import { BROWSER_LOCK, announceLock } from '../lib/locks.mjs';
import { refuseIfCompromised } from '../lib/tree-guard.mjs';

const ID = 'youtube';
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
const MODEL_FILE = path.join(ROOT, 'models', 'htdemucs_6s.onnx');

/**
 * THE VIDEO. Overridable, because the point of this suite is to be pointed at
 * whatever is worth re-checking — but it has a default so that "run the manual
 * step" is one command and not a decision.
 */
const URL = process.env.STEM_WORKBENCH_YT_URL || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

/** §7: presence/absence, never a band. 26 dB above `capture-mute`'s silence ceiling. */
const RMS_FLOOR = 0.01;
/**
 * THE SUM TEST'S TWO NUMBERS, and where they come from.
 *
 * `htdemucs` is a masking separator — its six stems sum back to the input — so
 * `rms(mix - Σstems)` is a small fraction of `rms(mix)`, and `rms(Σstems)` sits
 * close to `rms(mix)`. The failure this discriminates is SIX COPIES of the mix,
 * which sums to 6x and leaves a residual of 5x. The thresholds are therefore set
 * an order of magnitude away from the defect rather than tight around the
 * measurement: anything under 1.0 rules out a fan-out, and the measured value is
 * printed on the line so drift is visible without being fatal.
 */
const SUM_RESIDUAL_MAX = 0.5;
const SUM_TOLERANCE = 1.5;

/** The shared browser mutex — one path, `tools/lib/locks.mjs`, never spelled here. */
const LOCK = BROWSER_LOCK;
// One line, and only when this run has stepped out of the shared queue — a run
// holding the wrong mutex looks exactly like a run making progress. See tools/lib/locks.mjs.
announceLock();

// ------------------------------------------------------------- the harness
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

/** A value read out of a report is not a promise. */
const O = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const A = (v) => (Array.isArray(v) ? v : []);
const n = (v) => (Number.isFinite(v) ? v : null);
const f6 = (v) => (Number.isFinite(v) ? v.toFixed(6) : String(v));

// =========================================================================
// 0. THE LAUNCH — unless a recorded report was handed to us
// =========================================================================
/**
 * `YOUTUBE_REPORT=<file>` judges a report that already exists. It is how the
 * mutation battery watches every assertion below go red without spending a
 * minute and somebody else's bandwidth per case, and it is how a run recorded
 * on a machine with a display can be judged on one without.
 */
const given = process.env.YOUTUBE_REPORT;
let R = null;
let launch = { code: 0, out: '(not launched — YOUTUBE_REPORT)' };

if (given) {
  try { R = JSON.parse(fs.readFileSync(given, 'utf8')); }
  catch (e) { ok(`the recorded report named by YOUTUBE_REPORT could be read  [entry point: ${given}]`, false, String(e.message)); done(); }
} else {
  const electron = path.join(ROOT, 'node_modules', '.bin', 'electron');
  if (!fs.existsSync(electron)) skip('electron is not installed — npm i');
  /**
   * A CALLER THAT ALREADY HAS A DISPLAY KEEPS IT.
   *
   * `xvfb-run -a` is how the windowed suites run on this tty box, and it is not
   * the only way this suite is ever run: on the owner's machine there is a real
   * window server and no `xvfb-run` at all, and skipping there — on the one
   * suite whose whole point is to be run by a human against the real site —
   * would be the wrong answer to the right question. So the wrapper is chosen,
   * and the choice is REPORTED on assertion 1's line rather than inferred.
   *
   * `STEM_WORKBENCH_XVFB=1` forces the wrapper even under a display.
   */
  const forceXvfb = process.env.STEM_WORKBENCH_XVFB === '1';
  const haveDisplay = !!process.env.DISPLAY || process.platform === 'darwin' || process.platform === 'win32';
  const useXvfb = forceXvfb || (!haveDisplay && hasBin('xvfb-run'));
  if (!useXvfb && !haveDisplay) skip('this box has no DISPLAY and xvfb-run is not on PATH');
  if (!hasBin('flock')) skip('flock is not on PATH — the shared browser mutex cannot be taken');
  if (!fs.existsSync(MODEL_FILE)) {
    skip(`${path.relative(ROOT, MODEL_FILE)} is not here — run \`bash tools/vendor-unit.sh --model\` (109 MB, CC BY-NC 4.0)`);
  }
  if (!(await reachable('https://www.youtube.com/'))) {
    // A property of the box, not of the code under test — docs/TESTING.md §3
    // rule 8. This suite has no meaning without the site.
    skip('youtube.com is not reachable from this machine');
  }

  /**
   * IT DOES NOT `rm -rf` ITS OWN OUTPUT DIRECTORY, and that is deliberate
   * rather than lax: `out/` is shared — by the other suites, and on this box by
   * other agents — and a suite that deletes a directory it does not own can
   * take a sibling's evidence with it. Only the files THIS suite writes are
   * cleared, by name, so a stale picture from a previous run cannot be read as
   * this one's.
   */
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.existsSync(OUT) ? fs.readdirSync(OUT) : []) {
    if (/^(report\.json|meters\.json|engine\.log|launch\.log|\d\d-.*\.png)$/.test(f)) {
      fs.rmSync(path.join(OUT, f), { force: true });
    }
  }
  const userData = path.join(OUT, 'userdata');
  const cmd = `${sh(electron)} . --gate=${sh(OUT)} --gate-probe=youtube `
    + `--source-url=${sh(URL)} --user-data=${sh(userData)}`;
  launch = await run('flock', [LOCK, '-c', useXvfb ? `xvfb-run -a -s '-screen 0 1280x1024x24' ${cmd}` : cmd],
    { cwd: ROOT, timeoutMs: 1_800_000 });
  launch.how = useXvfb ? 'under xvfb-run -a' : `on DISPLAY=${process.env.DISPLAY || '(native)'}`;
  fs.writeFileSync(path.join(OUT, 'launch.log'), launch.out);
  try { R = JSON.parse(fs.readFileSync(path.join(OUT, 'report.json'), 'utf8')); } catch { /* asserted below */ }
}

// =========================================================================
// 1. THE INSTRUMENT
// =========================================================================
/**
 * EVERYTHING BELOW READS A FILE THIS PROBE WROTE, so a suite that could not tell
 * a missing report from a passing run would report green over an app that never
 * launched — the VOID case, one level in. `engine-host`'s mutation 27 is the
 * same assertion and it was found the same way.
 */
ok('the app launches from its real entry point and the youtube probe writes a report  '
  + '[entry point: `electron .` -> src/main/main.js -> tools/gate/youtube.mjs]',
  R !== null && R.gate === 1 && R.probe === ID,
  R ? `exit ${launch.code} ${launch.how || ''}, electron ${O(R.versions).electron} / chromium ${O(R.versions).chrome}, phases `
      + A(R.phases).map((p) => p.name).join('>')
    : `exit ${launch.code}, no report.json — last line: ${lastLine(launch.out)}`);
if (!R) done();

// =========================================================================
// 2. THE PAGE — what the real site actually gave us
// =========================================================================
const page = O(R.page);
ok('the source view is on the REAL youtube.com, over https, with the page\'s own <video> in it  '
  + '[entry point: src/main/youtube.js createSourceView().load()]',
  String(R.sourceUrlLoaded || '').startsWith('https://www.youtube.com/watch')
  && page.hasVideo === true && n(page.duration) !== null && page.duration > 0,
  `${R.sourceUrlLoaded} · "${R.sourceTitle}" · duration ${page.duration} s · readyState ${page.readyState}`
  + ` · ad ${page.adShowing} · element volume ${page.volume} muted ${page.muted}`);

/**
 * WHAT WAS MEASURED, RECORDED. §7: "an uncontrolled measurement that does not
 * say what it measured is not evidence." This is not a pass/fail on the content
 * — it is the assertion that the report CARRIES the four facts, so a later
 * reader can tell an ad from a song.
 */
ok('...and the run records what it was measuring — id, duration, ad flag, element volume',
  typeof R.sourceUrlLoaded === 'string' && n(page.duration) !== null
  && page.adShowing !== undefined && n(page.volume) !== null,
  `id ${(String(R.sourceUrlLoaded).match(/[?&]v=([\w-]+)/) || [, '(none)'])[1]}`
  + ` · duration ${page.duration} · adShowing ${page.adShowing} · volume ${page.volume}`);

const mute = O(R.mute);
const witness = O(mute.witness);
ok('THE VIEW IS MUTED FOR ITS WHOLE LIFE — before the first load, and across every navigation it made  '
  + '[entry point: src/main/youtube.js, `setAudioMuted(true)` as the first statement after construction]',
  mute.isAudioMuted === true && A(witness.mutedBeforeLoad).length > 0
  && A(witness.mutedBeforeLoad).every((m) => m === true)
  && witness.mutedAtCreate === true && witness.unmutedNavigations === 0,
  `muted now ${mute.isAudioMuted}, at create ${witness.mutedAtCreate}, before each load `
  + `${JSON.stringify(witness.mutedBeforeLoad)}, ${witness.navigations} navigations, `
  + `${witness.unmutedNavigations} of them unmuted`);

// =========================================================================
// 3. PLAY — the user's own player, started by a real input event
// =========================================================================
const playing = O(R.playing);
ok('the page\'s own player is PLAYING, started by a real input event and not by `video.play()`  '
  + '[entry point: tools/gate/youtube.mjs sendInputEvent — there is no play() anywhere in src/]',
  playing.paused === false && n(playing.currentTime) > 0,
  `${A(O(R.play).attempts).length} attempt(s) ${JSON.stringify(A(O(R.play).attempts).map((a) => a.how || a.skipped))}`
  + ` -> paused ${playing.paused} at t=${playing.currentTime}`);

/**
 * WHAT IT MEASURED — the content, or an ad.
 *
 * §7's warning, made into an assertion rather than a note, because the run that
 * prompted it looked exactly like a good one: a 15 s pre-roll instead of a 213 s
 * song, six real stems separated out of a car commercial, and nothing in the
 * transcript saying so. The probe waits `#movie_player` out of `ad-showing` and
 * presses YouTube's own Skip when there is one; this reads back what was on
 * screen at the moment the separator was fed.
 */
const content = O(R.content);
const atOffline = O(R.offlinePlayer);
ok('...and what it measured is the CONTENT, not a pre-roll ad — the ad was waited out or skipped  '
  + '[entry point: #movie_player.ad-showing, read before arming and again at the measurement]',
  content.adShowing === false && atOffline.adShowing === false
  && n(content.duration) !== null && n(atOffline.duration) !== null,
  `saw an ad: ${O(R.ad).sawAd}, skip pressed ${O(R.ad).skipPresses}x, waited ${O(R.ad).waitedMs} ms`
  + `${O(R.ad).timedOut ? ' (TIMED OUT — the measurement is over an ad)' : ''}; `
  + `duration ${O(R.ad).durationBefore} -> ${content.duration} s; at the measurement `
  + `adShowing ${atOffline.adShowing} duration ${atOffline.duration} t=${atOffline.currentTime}`);

const tState = O(R.transportAfterPlay);
ok('...and the SHIPPED preload reported it — the Host learns the player moved from its own transport  '
  + '[entry point: src/preload/youtube.cjs sendState() -> src/main/transport.js]',
  tState.playing === true && tState.hasMedia === true && n(tState.duration) > 0,
  `playing ${tState.playing}, hasMedia ${tState.hasMedia}, duration ${tState.duration}, `
  + `adShowing ${tState.adShowing}, counts ${JSON.stringify(O(tState.counts))}`);

// =========================================================================
// 4. ARM — the application menu's own item
// =========================================================================
const menu = O(R.menu);
ok('the arm gesture is REACHABLE: the application menu carries `Arm this Source` with an accelerator  '
  + '[entry point: src/main/deck-host.js buildMenu()]',
  menu.installed === true && typeof menu.armLabel === 'string' && menu.armLabel.length > 0
  && typeof menu.armAccelerator === 'string' && menu.armAccelerator.length > 0,
  `items ${JSON.stringify(menu.ids)} · "${menu.armLabel}" · ${menu.armAccelerator}`);

const seam = O(R.seam);
ok('...and clicking it armed the deck: SESSION reached the deck\'s address  '
  + '[entry point: src/main/deck-host.js arm() -> sendSession()]',
  O(seam.session).to === BUS.deck && O(seam.session).from === BUS.host,
  seam.session ? `SESSION ${O(seam.session).from} -> ${O(seam.session).to} ${JSON.stringify(O(seam.session).keys)}`
    : 'no SESSION reached the deck after the menu item was clicked');

ok('...and the DECK asked for the capture itself, over its own envelope  '
  + '[entry point: vendor/…/ui/embed.js startLive() -> SW_CAPTURE_START]',
  O(seam.swCaptureStart).to === BUS.host && O(seam.swCaptureStart).from === BUS.deck,
  seam.swCaptureStart ? `SW_CAPTURE_START ${O(seam.swCaptureStart).from} -> ${O(seam.swCaptureStart).to}`
    : 'the deck never asked — it did not reach `start` in follow()');

/**
 * THE KEYS ARE THE WHOLE ENVELOPE, not the message. The probe taps the bus
 * ROUTER, which sees `{v, to, from, ...msg}` — so the frozen shape
 * `CAPTURE_START {sourceToken, source}` appears here as six keys, and the three
 * routing ones are named rather than filtered out: a Host that added a field
 * would show up as a seventh, and `engine-host` asserts the message half from
 * `engineMessages.sent` where the envelope is not yet on it.
 */
const CAPTURE_START_KEYS = ['from', 'source', 'sourceToken', 'to', 'type', 'v'];
ok('...and the HOST originated CAPTURE_START to the engine, carrying a minted token and nothing about a tab  '
  + '[entry point: src/main/engine-messages.js captureStart(), seen at the router in src/main/bus.js]',
  O(seam.captureStart).to === BUS.engine && O(seam.captureStart).from === BUS.host
  && n(O(seam.captureStart).tokenLength) > 0
  && JSON.stringify(A(O(seam.captureStart).keys)) === JSON.stringify(CAPTURE_START_KEYS),
  seam.captureStart ? `CAPTURE_START ${JSON.stringify(A(O(seam.captureStart).keys))} — no tabId, no streamId; `
      + `token ${O(seam.captureStart).tokenLength} chars`
    : 'the Host originated no CAPTURE_START');

// =========================================================================
// 5. THE CAPTURE — a real one, off the real page
// =========================================================================
/**
 * THE PER-DECK CAPTURE IS THE ONE THAT MOVES. `STATE.capture` is the engine's
 * top-level mirror and its frame counter reads 0 in a snapshot; `STATE.decks.A.capture`
 * is deck A's own, and it carries the frames, the seconds and the PEAK. The peak
 * is the half a frame count cannot carry: a ring fed with silence counts frames
 * just as fast as one fed with music, which `engine-host`'s battery (case 22)
 * measured the hard way.
 */
const cap = O(O(O(R.deckSummary).A).capture);
ok('the engine is RECORDING the source view, and the ring is being fed REAL AUDIO — frames AND level  '
  + '[entry point: vendor/…/offscreen/host.js captureStream(), granted by src/main/capture.js]',
  O(R.capture).status === 'recording' && R.captureFed === true
  && n(cap.frames) > 0 && Math.max(...A(cap.peak).map((x) => Number(x) || 0)) >= RMS_FLOOR,
  `status ${O(R.capture).status}, deck A ${cap.frames} frames / ${cap.seconds} s, peak `
  + `${JSON.stringify(A(cap.peak))} while the view is muted, ${cap.dropped} dropped; `
  + `grant ${JSON.stringify(O(R.captureStats))}, claims ${JSON.stringify(O(R.claimStats))}`);

/**
 * THE WEIGHTS, AND WHY THE PROOF IS NOT `DECK_PREPARED`.
 *
 * The deck sends `SW_DECK_PREPARE` from its FIRST `STATE`, which lands while
 * the app is still booting — before this probe has a tap on the bus, and long
 * before the page has a player to click. So `DECK_PREPARED` is RECORDED (it may
 * or may not be inside the tapped window; on this box it is not) and the claim
 * is made on the state it left behind, which is the same evidence one message
 * later:
 *
 *   `model.status: 'ready'`   the unit's own verdict after `verifyModel()` —
 *       the SHA-256 and the byte count checked over whatever this Host handed
 *       it (M1). `'error'` is what a wrong file produces.
 *   `model.got === MODEL.bytes`   all 114,559,139 of them crossed the seam.
 *   `decks.A.session: 'ready'`   ORT really built a session from those bytes;
 *       `boot.ep` says on which execution provider.
 */
const model = O(R.model);
const deckA = O(O(R.deckSummary).A);
ok('THE REAL WEIGHTS WENT THROUGH THIS HOST AND A SESSION WAS BUILT FROM THEM  '
  + '[entry point: vendor/…/offscreen/host.js modelBytes() -> the unit\'s verifyModel() -> Deck.ensureSession()]',
  model.status === 'ready' && model.error === null && n(model.got) === MODEL.bytes
  && deckA.session === 'ready' && typeof O(R.boot).ep === 'string',
  `model.status ${model.status}, ${model.got} of ${MODEL.bytes} bytes in ${model.ms} ms, fromCache ${model.fromCache}; `
  + `deck A session ${deckA.session}${deckA.sessionError ? ` (${deckA.sessionError})` : ''}; `
  + `backend ${JSON.stringify(O(R.boot))}; DECK_PREPARED inside the tapped window: ${R.deckPrepared}`);

// =========================================================================
// 6. SIX STEMS
// =========================================================================
/**
 * TWO CLAIMS, AND THIS MACHINE CAN ONLY MAKE ONE OF THEM — said here rather than
 * discovered in the numbers.
 *
 *   DOES THE SEPARATOR PRODUCE SIX STEMS from this app's own capture of a real
 *       YouTube page? That is the phase's headline claim and it is asserted
 *       below, off `R.offline` — one segment, the Host's own backend, the real
 *       weights, no clock.
 *   DOES THE LIVE PIPELINE KEEP UP with playback? That is a HARDWARE question.
 *       `offscreen/live.js` runs one 7.8 s segment every 1.95 s hop, so it needs
 *       ~4x real time. With a WebGPU adapter it has it; on wasm it does not, and
 *       the deck does exactly what it is designed to do — drops the chunk and
 *       plays PASSTHROUGH, which is why the per-stem meters read zero while the
 *       master reads the music.
 *
 * The live half is therefore RECORDED, with the scheduler's own numbers, and
 * this suite asserts that the recording HAPPENED rather than what it says. A
 * red for "this box has no GPU" would be a red people learn to ignore; a
 * measurement nobody wrote down is worse.
 */
const st = O(R.stems);
const series = O(st.series);
const ls = O(O(R.liveStats).stats);
ok('THE LIVE PIPELINE RAN, and the run records whether it KEPT UP on this machine — the p95, the deadline and the drops  '
  + '[entry point: vendor/…/offscreen/live.js, read back with DEV_LIVE_STATS]',
  R.liveRunning === true && n(st.meterFrames) > 0 && O(R.liveStats).type === 'LIVE_STATS' && n(ls.chunks) !== null,
  `live running ${R.liveRunning}, ${st.meterFrames} METERS frames in ${st.windowMs} ms `
  + `(${R.meterCount} in the run); scheduler chunks ${ls.chunks} drops ${ls.drops} demotions ${ls.demotions} p95 ${ls.p95ChunkMs} ms hop ${ls.hopSeconds} s status ${ls.status}; ep ${O(R.boot).ep} adapter ${JSON.stringify(O(R.boot).adapter)} threads ${O(R.boot).threads}`);

/**
 * NOT AN ASSERTION — the verdict in words, next to the numbers that decide it,
 * so the transcript says which of the two claims above this machine made.
 */
{
  const rt = keptUp(ls, series);
  console.log(`      NOTE  real-time on this machine: ${rt.verdict}  ${rt.why}`);
}

ok('SIX STEMS COME BACK, BY NAME, IN THE UNIT\'S OWN ORDER — drums, bass, other, vocals, guitar, piano  '
  + '[entry point: shared/config.js STEMS, against the METERS payload]',
  JSON.stringify(A(st.order)) === JSON.stringify(STEMS)
  && JSON.stringify(A(st.keysSeen)) === JSON.stringify([...STEMS, 'master'].sort()),
  `keys ${JSON.stringify(A(st.keysSeen))} · order ${JSON.stringify(A(st.order))}`);

/**
 * THE RACK ORDER IS NOT THE MODEL ORDER, AND CONFLATING THEM IS AN ASSERTION
 * THAT GOES RED ON CORRECT CODE.
 *
 *   `shared/config.js`   STEMS       drums, bass, other, vocals, guitar, piano
 *                        — the model's plane order, and what METERS is keyed by.
 *   `ui/embed.js`:78     STEM_ORDER  vocals, drums, bass, other, guitar, piano
 *                        — the order the six strips are PAINTED in.
 *
 * Two lists, two subjects. The assertion above is about the METERS payload and
 * reads `STEMS`; this one is about the deck's surface and reads the deck's own
 * list — out of `ui/embed.js` rather than from a third copy typed here, because
 * a copy of a list is a list that drifts.
 *
 * IT ASSERTS THREE THINGS AT ONCE and each is a different defect:
 *   the SET      the rack's six are the model's six. A stem added upstream that
 *                the rack never grew a strip for is caught here and nowhere else.
 *   the ORDER    against `STEM_ORDER`. Guitar and piano have no number key, so
 *                DESIGN §2.4 leaves their identity resting partly on fixed
 *                position — a reordered rack is a real defect, not a cosmetic one.
 *   the LABEL    each strip's printed word matches its own `data-stem`. A strip
 *                labelled "Vocals" over `data-stem="drums"` is six correct stems
 *                mislabelled, which is worse than six wrong ones, and neither the
 *                set nor the order can see it.
 */
const rack = deckRackOrder();
const paint = O(R.deckPaint);
const painted = A(paint.stems).map((x) => String(x).trim().toLowerCase());
const labels = A(paint.names).map((x) => String(x).trim().toLowerCase());
ok('...and the DECK painted the six as its own rack — the SET is the model\'s six, the ORDER is `ui/embed.js`\'s, '
  + 'and every label matches its own `data-stem`  '
  + '[entry point: vendor/…/ui/embed.js STEM_ORDER + STEM_LABEL, read off the deck\'s own DOM]',
  painted.length === STEMS.length
  && JSON.stringify([...painted].sort()) === JSON.stringify([...STEMS].sort())
  && JSON.stringify(painted) === JSON.stringify(rack)
  && labels.length === painted.length
  && labels.every((l, i) => l === painted[i]),
  `${paint.strips} strips ${JSON.stringify(painted)} labelled ${JSON.stringify(A(paint.names))}; `
  + `rack order from ui/embed.js ${JSON.stringify(rack)}; model order ${JSON.stringify(STEMS)}`);

ok(`...and what the deck PLAYED is audible — master rms above the ${RMS_FLOOR} floor, presence not level  `
  + '[entry point: METERS.rms.master; §7 forbids a band]',
  n(O(series.master).rmsMean) !== null && O(series.master).rmsMean >= RMS_FLOOR,
  `master rms mean ${f6(O(series.master).rmsMean)} max ${f6(O(series.master).rmsMax)} over `
  + `${O(series.master).frames} frames; per-stem meters ${STEMS.map((x) => f6(O(series[x]).rmsMean)).join(' ')}`);

// =========================================================================
// 6b. THE SEPARATOR — the phase's headline claim, with the clock taken away
// =========================================================================
/**
 * ONE SEGMENT of the audio this app captured from the real YouTube page,
 * through `host.createBackend()` and `host.modelBytes()` — the same two duties
 * `Deck.ensureBackend()` and `Deck.ensureSession()` call — and no deadline.
 * `shared/host.js`: *"A backend either separates or throws"*, and `Deck.infer`'s
 * own `budgetMs = Infinity` default is the unit's name for exactly this case.
 *
 * It is the answer to "do six stems come out of the engine, in this app, with
 * the real weights", separated from "does this box keep up", because they are
 * two questions and only the first one is about the product.
 */
const off = O(R.offline);
const perStem = A(off.perStem);
ok('THE SEPARATOR RAN, in this app, over the audio it captured from the page — the Host\'s own backend and the real weights  '
  + '[entry point: vendor/…/offscreen/host.js createBackend() + modelBytes(), driven in the engine renderer]',
  !off.THREW && O(off.load).ok !== false && n(off.modelBytes) === MODEL.bytes
  && n(off.captured) === n(off.segment) && n(off.separateMs) > 0,
  off.THREW ? `it threw: ${off.THREW}`
    : `${off.captured}/${off.segment} frames at ${off.sr} Hz via ${off.recorder}; `
      + `${off.modelBytes} bytes loaded in ${off.loadMs} ms; separate() ${off.separateMs} ms `
      + `(prep ${O(off.timing).prepMs} · infer ${O(off.timing).inferMs} · post ${O(off.timing).postMs}); `
      + `ready ${JSON.stringify(off.ready)}`);

/**
 * THE CAPTURE CONSTRAINTS, ON THE REAL SITE. The spike's Limitation 6: a naive
 * `getDisplayMedia({audio:true})` yields MONO 48 kHz with automatic gain control
 * that decays the level 17x over 8 s — and it looks fine to a careless gate. All
 * three processors off, two channels, and the unit's own rate.
 */
const gs = O(off.settings);
ok('...and the audio it separated came off the muted view at 44 100 Hz, STEREO, with AGC / echo / noise suppression all OFF  '
  + '[entry point: the constraints in vendor/…/offscreen/host.js captureStream()]',
  gs.autoGainControl === false && gs.echoCancellation === false && gs.noiseSuppression === false
  && gs.channelCount === 2 && gs.sampleRate === off.sr
  && n(O(off.mixRms).l) >= RMS_FLOOR && n(O(off.mixRms).r) >= RMS_FLOOR,
  `${JSON.stringify(gs)}; the segment's own rms L ${f6(O(off.mixRms).l)} R ${f6(O(off.mixRms).r)}`);

/**
 * SIX PLANE PAIRS, in the layout `shared/host.js` freezes for this interface:
 * `(k*2 + ch) * SEGMENT + i`, stem-major, left before right, `STEMS` order. The
 * indices are asserted, not just the count, because a backend that returned six
 * planes in another order would be six correct stems mislabelled.
 */
ok('SIX STEMS CAME BACK — six plane pairs, in the unit\'s own order, each with its own level  '
  + '[entry point: Backend.separate()\'s out buffer, laid out (k*2+ch)*SEGMENT]',
  perStem.length === STEMS.length
  && perStem.every((x, i) => O(x).stem === STEMS[i] && O(x).index === i)
  && perStem.every((x) => n(O(x).rmsL) !== null && n(O(x).rmsR) !== null),
  perStem.map((x) => `${O(x).stem} L ${f6(O(x).rmsL)} R ${f6(O(x).rmsR)} pk ${f6(O(x).peak)}`).join(' · '));

/**
 * THE ARITHMETIC THAT CANNOT BE FAKED BY A METER. `htdemucs` is a masking
 * separator: its six stems sum back to the input. So the residual
 * `rms(mix - Σstems)` is a fraction of the mix, and `rms(Σstems)` is close to
 * `rms(mix)`. SIX COPIES of the mix would sum to SIX TIMES it — residual 5x the
 * mix — which is the failure mode "six identical meters" describes and this
 * measures.
 */
const sum = O(off.sum);
ok(`...and the six SUM BACK to the mix — residual under ${SUM_RESIDUAL_MAX}x the input, the sum within `
  + `${SUM_TOLERANCE}x of it, which six copies of one mix could not be  `
  + '[entry point: rms(mix - Σstems) over the returned planes]',
  n(sum.mixRms) > 0 && n(sum.residualRms) / sum.mixRms <= SUM_RESIDUAL_MAX
  && sum.sumRms / sum.mixRms <= SUM_TOLERANCE && sum.sumRms / sum.mixRms >= 1 / SUM_TOLERANCE,
  `mix ${f6(sum.mixRms)} · Σstems ${f6(sum.sumRms)} (${(sum.sumRms / (sum.mixRms || 1)).toFixed(3)}x) · `
  + `residual ${f6(sum.residualRms)} (${(sum.residualRms / (sum.mixRms || 1)).toFixed(3)}x)`);

/**
 * SIX DIFFERENT STEMS, not six copies — the levels themselves, pairwise. A
 * fan-out of one mix gives six IDENTICAL numbers; a separation gives six that
 * differ, and the loudest-to-quietest spread is reported so a human can see how
 * far apart they are.
 */
const distinctRms = new Set(perStem.map((x) => Number(O(x).rmsL).toFixed(9))).size;
const lvls = perStem.map((x) => n(O(x).rmsL) || 0).filter((v) => v > 0);
ok('...and no two of them are the same signal — six distinct levels, and every stem carried SOMETHING',
  distinctRms === STEMS.length && perStem.length === STEMS.length
  && perStem.every((x) => n(O(x).rmsL) > 0 && n(O(x).rmsR) > 0 && n(O(x).peak) > 0),
  `${distinctRms} distinct left-channel rms values of ${perStem.length}; spread `
  + `${lvls.length ? (20 * Math.log10(Math.max(...lvls) / Math.min(...lvls))).toFixed(1) : 'n/a'} dB `
  + `(loudest ${perStem.length ? O(perStem.reduce((a, b) => (O(a).rmsL > O(b).rmsL ? a : b))).stem : '?'}, `
  + `quietest ${perStem.length ? O(perStem.reduce((a, b) => (O(a).rmsL < O(b).rmsL ? a : b))).stem : '?'})`);

// =========================================================================
// 7. THE PICTURE
// =========================================================================
const shotDeck = O(O(R.shot).deck);
ok('the deck is PAINTED while the stems are live — a photograph of the running app, not a blank view  '
  + '[entry point: webContents.capturePage() over the deck view]',
  shotDeck.ok === true && n(shotDeck.colours) > 8,
  shotDeck.ok ? `${shotDeck.file} ${shotDeck.bytes} bytes, ${shotDeck.width}x${shotDeck.height}, ${shotDeck.colours} distinct colours sampled`
    : `no picture: ${shotDeck.why}`);

// =========================================================================
// 8. THE RELOAD — the grant is bound to the WebContents, not the document
// =========================================================================
const rel = O(R.reload);
ok('THE CAPTURE SURVIVES A FULL PAGE RELOAD — the grant is against the view, not the document  '
  + '[entry point: src/main/capture.js setDisplayMediaRequestHandler -> the source view\'s mainFrame]',
  rel.statusBefore === 'recording' && rel.statusAfter === 'recording' && rel.climbed === true,
  `status ${rel.statusBefore} -> ${rel.statusAfter}, frames ${rel.framesBefore} -> ${rel.framesAfter}, `
  + `still muted ${rel.muted}, navigations ${rel.navigations}`);

// =========================================================================
// 9. THE LEDGER
// =========================================================================
ok('nothing on the bus was dropped for want of a listener while all that happened  '
  + '[entry point: src/main/bus.js createBus()]',
  O(O(R.busStats).dropped)['no-listener'] === 0 && O(O(R.busStats).dropped).malformed === 0
  && O(O(R.busStats).dropped)['unknown-sender'] === 0,
  `${JSON.stringify(O(R.busStats))} · addresses ${JSON.stringify(A(R.busAddresses))}`);

console.log(`\n${ID}: report ${path.relative(ROOT, path.join(OUT, 'report.json'))} · `
  + `pictures ${path.relative(ROOT, OUT)}/*.png · meters ${path.relative(ROOT, OUT)}/meters.json`);
done();

// ------------------------------------------------------------------ helpers
/**
 * DID THE LIVE PIPELINE KEEP UP — the verdict in words, from the scheduler's own
 * numbers and the meters together.
 *
 * It is deliberately NOT an assertion: whether a machine has ~4x real time of
 * inference is a property of that machine (docs/TESTING.md §3 rule 8), and this
 * suite's subject is the product. It is printed so the transcript says which of
 * the two claims the run made, and the report carries the numbers behind it.
 */
function keptUp(stats, series) {
  const drops = n(O(stats).drops);
  const chunks = n(O(stats).chunks);
  const p95 = n(O(stats).p95ChunkMs);
  const hop = n(O(stats).hopSeconds);
  const stemsSilent = STEMS.every((x) => !(n(O(series[x]).rmsMean) > 0));
  const rate = chunks ? drops / chunks : null;
  if (rate === null) return { verdict: 'UNKNOWN', why: 'the scheduler reported no chunk count' };
  if (rate === 0 && !stemsSilent) {
    return { verdict: 'YES', why: `${chunks} chunks, 0 dropped, p95 ${p95} ms against a ${hop * 1000} ms hop deadline` };
  }
  return {
    verdict: 'NO',
    why: `${drops} of ${chunks} chunks missed the ${hop * 1000} ms hop deadline (p95 ${p95} ms)`
      + `, so the deck played PASSTHROUGH and the per-stem meters read zero. `
      + `The separator itself is measured below, without the clock.`,
  };
}
/**
 * The deck's rack order, READ OUT OF THE VENDORED SOURCE.
 *
 * `ui/embed.js` is a browser module — it touches `document` at module scope, so
 * it cannot be imported here — and its `STEM_ORDER` is the authority on what the
 * six strips are painted as. Reading it as text is the same instrument
 * `qa/speed-pitch.mjs` uses on `content.js` upstream, and it is deliberately
 * UNGUARDED: a read that silently fell back to a hard-coded list would report
 * coverage it does not have. If the line cannot be found, this THROWS, and the
 * suite's own harness turns that into a red rather than a green.
 */
function deckRackOrder() {
  const src = fs.readFileSync(path.join(ROOT, 'vendor', 'stem-splitter-live', 'extension', 'ui', 'embed.js'), 'utf8');
  const m = src.match(/const STEM_ORDER\s*=\s*\[([^\]]+)\]/);
  if (!m) throw new Error('ui/embed.js has no `const STEM_ORDER = [...]` — the rack order cannot be read, so it cannot be asserted');
  return m[1].split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}
function hasBin(name) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  return dirs.some((d) => { try { fs.accessSync(path.join(d, name), fs.constants.X_OK); return true; } catch { return false; } });
}
function sh(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }
function lastLine(out) { const l = String(out).trim().split('\n'); return l[l.length - 1] || '(no output)'; }
function run(cmd, args, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, timeoutMs);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}
/** Is the site there at all — a property of the box, checked before it is blamed. */
async function reachable(url) {
  try {
    const ctl = AbortSignal.timeout(20_000);
    const res = await fetch(url, { method: 'HEAD', signal: ctl });
    return res.ok || res.status === 405;
  } catch { return false; }
}
