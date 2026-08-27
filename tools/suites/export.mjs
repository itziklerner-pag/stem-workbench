#!/usr/bin/env node
/**
 * export — the export writer, the folder the user chooses ONCE, and the intake
 * that feeds the File source.
 *
 * WHAT IT GATES, TODAY. The File source's intake: which files it admits and what
 * MIME each is served as; that a title derived from a file name can never be a
 * path; that a path token is one-shot and expires; and — over TWO REAL LAUNCHES
 * of `electron .` sharing one profile — that the export folder is asked for
 * exactly once, that the second export writes into the remembered folder, and
 * that the memory survives a restart. And THE WRITER: six 32-bit-float / 44.1
 * kHz / stereo WAVs in `STEMS` order at unity, bit-exact headers (fmt tag 3,
 * `fact` present, data length = frames × 8), byte-identical to the planes it
 * was given, and a title that cannot escape the chosen folder ON DISK — the
 * plan's G1, G2a and G2b-path — plus the engine-facing EXPORT SINK, driven
 * through the real duty, the real preload bridge and the real main-process
 * session, with a refused folder (the user pressing Escape) asserted as a
 * THROW, never an empty map.
 *
 * WHERE THE PROBE ENTERS, AND WHY THE GESTURE IS REAL. The chrome bar's File
 * controls are their own slice, so `tools/gate/export.mjs` calls `exportStems()`
 * and `chooseSourceFile()` directly, from inside main, where the counter lives.
 * What is driven is now the GESTURE, not a private door: every launch asks for
 * the folder through the REAL native chooser, the writer's WAVs are read back
 * off the disk and compared byte-for-byte against planes the suite generated
 * itself, and the expected bytes are built with plain `Buffer` ops — the
 * vendored `encodeWav` is exercised only by the app under test, never by the
 * expected bytes. This is the closure of a promise this header has carried for
 * three releases: *"When the writer lands, this suite should drive the export
 * rather than the intake."* It does — exports #1-#4 are all writer gestures.
 *
 * HOW THE PLANES TRAVEL: the suite generates six synthetic stems (dyadic
 * rationals, exact in Float32) and passes them to the probe as `WB_EXPORT_PLANES`
 * JSON, so there is ONE generator. The suite re-derives the expected bytes from
 * that same generator; the app under test encodes them with `encodeWav`. A gate
 * that derived expected bytes with the encoder would be checking the encoder
 * against itself and could not tell a wrong header from a changed one.
 *
 * WHAT THE WRITER DOES AND HOW CONTIGUITY IS ENFORCED: one gesture,
 * `exportStems({title, stems})`, writes all six files under `<folder>/<title>/`
 * synchronously end to end — the frame count is known before the first byte, so
 * the header is correct on the first write and nothing is ever patched. The
 * sink is the same property over a different pipe: chunks arrive through a
 * `WritableStream` per file and are APPENDED to a descriptor `main` opened at
 * session open; there is no seekable handle anywhere. (`s7a`'s `createPassSink`
 * writes raw interleaved 32f frames with no header; the WAV header is
 * `shared/wav.js`'s `encodeWav` and this slice's — never duplicated.)
 *
 * ---------------------------------------------------------------------------
 * THE DIALOG IS NEVER STUBBED. THIS SUITE DRIVES THE REAL NATIVE CHOOSER.
 * ---------------------------------------------------------------------------
 * The count of "how many times did this app ask for a folder" is read off a
 * counter `src/main/files.js` increments beside its own
 * `dialog.showOpenDialog` call, out of a launch that opened the REAL GTK file
 * chooser — which `tools/gate/export.mjs` then answers the way a person does,
 * with `xdotool`: Ctrl+L, type the path, click **Open**.
 *
 * Nothing anywhere replaces, stubs or monkey-patches `dialog.showOpenDialog`,
 * and the first launched assertion below is the instrument check that says so:
 * the intake the running app is holding compares equal to `electron`'s own
 * `dialog`. A gate that substitutes its own dialog would be asserting a fact
 * about the substitute — the real picker could then be opened twice, never, or
 * with `openFile` instead of `openDirectory`, and the count would stay green.
 * `docs/TESTING.md` §3 rule 7 is the same rule from the other side, and
 * `tools/suites/transport.mjs` already takes this position for the preload
 * (§5c, *"It drives the real interface, not a private door"*).
 *
 * ---------------------------------------------------------------------------
 * THE MACHINE FACT THIS SUITE HAS TO KNOW, AND WHY THE LAUNCH IS NOT PLAIN
 * ---------------------------------------------------------------------------
 * `DBUS_SESSION_BUS_ADDRESS` IS SET TO `disabled:` FOR THE LAUNCH, DELIBERATELY.
 *
 * On a box with a D-Bus session bus but no `xdg-desktop-portal` — which is this
 * one — Chromium's file dialog asks the portal and **never falls back to GTK**. Measured: no window maps at all, and
 * `showOpenDialog`'s promise never settles. The Chromium log says
 * *"Failed to register with org.freedesktop.host.portal.Registry"*. With the bus
 * out of the way the in-process GTK chooser maps in under a second and can be
 * driven. This is a property of the box, like `$DISPLAY`, and it is set here
 * rather than in `src/` so the app under test is the shipping app.
 *
 * WHAT THAT COSTS, STATED: on a desktop that DOES have a portal, this suite is
 * exercising the GTK chooser rather than the portal one. The app's code path is
 * identical — one `dialog.showOpenDialog` call with one set of options — but
 * "the portal chooser appears and behaves" is NOT gated anywhere, by this or
 * anything else, and cannot be until a box with a portal runs it. `README.md`'s
 * verified/configured split is where that belongs.
 *
 * ---------------------------------------------------------------------------
 * WATCHED RED BY MUTATION — every assertion below, with the edit that broke it
 * ---------------------------------------------------------------------------
 * Reproduce with `tools/suites/export-mutations.sh`. Run on 2026-08-26 against
 * Electron 44.0.0 / Chromium 152.0.7977.54 on Linux. The right column is what
 * ACTUALLY went red, not what was expected to.
 *
 * Two lanes. Cases 1-11 and 34 and 36 run `EXPORT_ONLY=pure` and take under a
 * second each; cases 12-33 and 35 are the whole suite, which is two real
 * launches with a real native chooser answered in each. Cases 24-27 run the
 * whole suite ON PURPOSE: their mutations (the plan's G1, G2a and G2b-path)
 * must also redden the IN-THE-APP assertions, not just the pure ones — a
 * launched assertion with no launched watcher is a coverage gap.
 * `tools/suites/coverage.py` over the whole battery refuses an assertion that
 * has never appeared on a FAIL line.
 *
 *   1  files.js extOf: drop .toLowerCase()             -> every extension is admitted, either case
 *   2  files.js isAllowedSourceFile: `true ||`         -> ...and everything else is refused
 *   3  files.js SOURCE_FILTERS: extensions -> ['wav']  -> every admitted extension has a MIME
 *   4  files.js mimeForSourceFile: always 'audio/x'    -> every admitted extension has a MIME
 *   5  files.js deriveTitle: keep the extension        -> a title is the file's own name
 *   6  files.js sanitiseTitle: drop the separator strip-> a title can never BE a path, AND
 *                                                        joining stays inside the folder
 *   7  files.js sanitiseTitle: drop the trailing strip -> a title can never BE a path
 *   8  files.js sanitiseTitle: drop the leading strip  -> a title can never BE a path
 *   9  files.js spend(): never delete the entry        -> a path token is ONE SHOT
 *  10  files.js spend(): ignore expiresAt              -> ...and one spent after its TTL is EXPIRED
 *  11  files.js revokeAll(): clear nothing             -> ...and revokeAll drops every live token
 *  12  files.js ensureExportFolder: delete the         -> the folder is asked EXACTLY ONCE
 *      remembered-folder read  (the plan's G3)            (**2**, not 1), AND export #2 resolved to
 *                                                        the remembered folder, AND the restart
 *  13  files.js EXPORT_FOLDER_AREA -> 'session'        -> the remembered folder survives a RESTART
 *      (the plan's G4)                                    (**1** ask, not 0), AND it is the SAME
 *                                                        folder (local=null, session=the folder)
 *  14  files.js ensureExportFolder: drop the pending   -> a second export while the chooser is up
 *      join                                               joins that ask (2 pickers, not 1)
 *  15  files.js askForFolder: FILE_DIALOG's options    -> ...and the options are a FOLDER picker
 *  16  main.js: build the intake over a WRAPPER that   -> INSTRUMENT CHECK: the intake holds
 *      still opens the real dialog                        electron's own dialog — **and nothing
 *                                                        else**: 21 passed, 1 failed
 *  17  files.js chooseSourceFile: title = basename()   -> the file picker derives its title
 *  18  files.js chooseSourceFile: drop the allowlist   -> ...and a file it does not admit is
 *      check                                              REFUSED BY NAME
 *  19  files.js chooseSourceFile: mint from a FRESH    -> ...and that token resolves over the
 *      registry                                           running app's own registry
 *  20  gate/export.mjs: write no report                -> both launches wrote a report — and the
 *                                                        suite stops there: 9 passed, 1 failed
 *  21  gate/export.mjs: read asksAtBoot AFTER export#1 -> a launch on its own asks for nothing
 *  22  files.js askForFolder: answer without ever      -> the first export opens the REAL native
 *      calling the dialog                                 chooser (the count alone stays at 1)
 *  23  files.js rememberedFolder: drop the statSync     -> ...and a remembered folder that has
 *      directory check (issue #6's branch)                been DELETED is not used
 *  24  files.js encodeWav call: bitDepth 16              -> G1: the header assertion goes red (the
 *      (the plan's G1 mutation, at the call site)          writer refuses, so there is no file)
 *  25  files.js exportStems: multiply by 0.9             -> G2a: the byte-identical assertion
 *  26  files.js exportStems ENCODING loop:              -> G2a: the byte-identical assertion —
 *      write `bass`'s planes under `drums`'s              the file NAMED drums holds bass's
 *      name (the ENCODING loop, three lines deep —         planes, and the names still match
 *      the validation loop above it is NOT the target:
 *      swapping the mapping inside THAT one is
 *      unobservable and was measured green)
 *  27  files.js exportStems: call sanitiseTitle(..)      -> G2b-path: the escape lands OUTSIDE the
 *      removed                                              chosen folder, on disk
 *  28  files.js exportStems: return the refusal          -> the writer's cancelled-picker refusal
 *      instead of throwing                                  must be a THROW, never an empty result
 *  29  files.js writeSink: write nothing                 -> the sink's bytes-on-disk assertions
 *  30  files.js openSink: accept files: [] +             -> ...and an EMPTY plan is refused at the
 *      host.js exportSink: drop the shape check            seam, never an empty map
 *  31  files.js openSink: drop the name validation       -> ...and a name that is not a plain file
 *                                                           name is refused, with no file outside
 *  32  files.js openSink: drop the already-open check    -> a second session cannot open while one
 *                                                           is live (the replaced session's close
 *                                                           throws inside the duty; the suite
 *                                                           reads it as data — measured crash,
 *                                                           2026-08-27)
 *  33  files.js openSink: open only SOME of the files    -> the sink opens EVERY file of the plan
 *                                                           (five of six would be called done)
 *  34  files.js writeSink: drop the unknown-file check   -> the combined second-session-and-
 *                                                           chunk assertion goes red
 *  35  host.js exportSink: never throw on a refused      -> the refused sink open is a THROW, not
 *      open (the throw is skipped, streams go out)         an empty map (the contract's one shape
 *                                                           that cannot be returned)
 *  36  host.js exportSink: validate nothing about the    -> ...and the same at the seam, for an
 *      plan + files.js openSink: accept files: []          empty plan driven through the duty
 *
 * CASES 16 AND 22 ARE THE PAIR THAT KEEPS THE OTHERS HONEST, and they fail in
 * opposite directions on purpose. 16 leaves every count correct — the wrapper
 * still opens the real dialog — and only the INSTRUMENT notices, which is what
 * proves the instrument is load-bearing rather than decorative. 22 leaves the
 * instrument correct and takes the dialog away, and the COUNT alone stays at 1:
 * an assertion that only counted asks would be green over an app that never
 * opened a picker at all. Neither one on its own would have found the other.
 *
 * THE WRITER'S TRAP, NAMED BEFORE IT BITES: "wrote the file", "opened the
 * sink" and "the sink accepted nothing" are three different observations, and
 * a fixture that conflates them is blind. So the suite never trusts a report
 * field for the bytes: it reads the FILES itself, off the disk, and compares
 * them against bytes it derived itself. The probe's report says where the
 * files are; the suite's own `readFileSync` says what they contain.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  SOURCE_TYPES, SOURCE_FILTERS, isAllowedSourceFile, mimeForSourceFile,
  deriveTitle, sanitiseTitle, MAX_TITLE, FALLBACK_TITLE,
  createPathTokens, createFileIntake, PATH_TOKEN_TTL_MS, FOLDER_DIALOG, FILE_DIALOG,
} from '../../src/main/files.js';
import { STEMS } from '../../vendor/stem-splitter-live/extension/shared/config.js';
import { BROWSER_LOCK, announceLock } from '../lib/locks.mjs';
import { refuseIfCompromised } from '../lib/tree-guard.mjs';

const ID = 'export';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** See `tools/suites/shell.mjs` — a stranded mutation must not be measured past. */
refuseIfCompromised(ID, ROOT);
const OUT = path.join(ROOT, 'out', ID);

/** The shared browser mutex. The path is `tools/lib/locks.mjs`'s and is not spelled here. */
const LOCK = BROWSER_LOCK;
announceLock();
const LOCK_MARK = '__WB_LOCKED__';

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

/** A report field is not a promise — see `tools/suites/shell.mjs`. */
const O = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

// ==========================================================================
// 1. THE INTAKE AS PURE FUNCTIONS — no launch, no display, no mutex
// ==========================================================================
{
  // THE TABLE IS BUILT FROM THE DECLARATION, so an extension added to
  // SOURCE_TYPES is covered the day it is added rather than the day somebody
  // remembers to extend a list here. The UPPER-CASE half is the real case: a
  // file called `TRACK.WAV` off a camera is the ordinary way this arrives.
  const declared = Object.keys(SOURCE_TYPES);
  const admit = [...declared.map((e) => `/music/a${e}`), ...declared.map((e) => `/music/a${e.toUpperCase()}`)];
  const admitted = admit.filter(isAllowedSourceFile);
  ok('every extension the File source declares is admitted, in either case  '
    + '[entry point: src/main/files.js isAllowedSourceFile()]',
    declared.length > 0 && admitted.length === admit.length,
    `${admitted.length}/${admit.length} over ${declared.length} declared: ${declared.join(' ')}`
    + `${admitted.length === admit.length ? '' : ` — REFUSED ${admit.filter((p) => !isAllowedSourceFile(p)).join(' ')}`}`);

  const refuse = [
    '/music/a.txt', '/music/a.pdf', '/music/a.mp4',              // not audio at all
    '/music/track.wav.txt',                                       // the LAST extension decides
    '/music/awav', '/music/track',                                // no extension
    '/music/.wav',                                                // a file literally named `.wav`
    '/music/a.wma', '/music/a.ape',                               // audio Chromium cannot decode
    '/music/a.',                                                  // a bare trailing dot
    '/music/a.exe',
  ];
  const held = refuse.filter((p) => !isAllowedSourceFile(p));
  ok('...and everything else is refused, including `track.wav.txt` and a file named `.wav`  '
    + '[entry point: isAllowedSourceFile()]',
    held.length === refuse.length,
    `${held.length}/${refuse.length}${held.length === refuse.length ? '' : ` — ADMITTED ${refuse.filter(isAllowedSourceFile).join(' ')}`}`);

  // The MIME is what the `/file/` ROOT will answer with, so an admitted file
  // whose type we cannot NAME is a hole in the allowlist, not a file to guess at.
  const typed = declared.filter((e) => /^[a-z]+\/[a-z0-9.+-]+$/.test(String(mimeForSourceFile(`/m/a${e}`))));
  const filtered = SOURCE_FILTERS[0].extensions;
  ok('every admitted extension has a MIME of its own, and the picker\'s filter names exactly the same set  '
    + '[entry point: mimeForSourceFile() and SOURCE_FILTERS]',
    typed.length === declared.length && mimeForSourceFile('/m/a.txt') === null
    && filtered.length === declared.length && declared.every((e) => filtered.includes(e.slice(1))),
    `${typed.length}/${declared.length} typed, filter names ${filtered.length}, `
    + `.txt -> ${JSON.stringify(mimeForSourceFile('/m/a.txt'))}`);

  const titles = [
    ['/music/Artist/Deep Cuts - Track 01.wav', 'Deep Cuts - Track 01'],
    ['/music/song', 'song'],                       // no extension: the whole name is the title
    ['/music/.flac', 'flac'],                      // all extension: `extname` says '', the strip says `flac`
    ['/music/a.tar.gz', 'a.tar'],                  // the LAST extension only
  ];
  const derived = titles.filter(([p, want]) => deriveTitle(p) === want);
  ok('a title is the file\'s own name without its directory or its last extension  '
    + '[entry point: deriveTitle()]',
    derived.length === titles.length,
    `${derived.length}/${titles.length}: ${titles.map(([p]) => `${JSON.stringify(path.basename(p))} -> ${JSON.stringify(deriveTitle(p))}`).join(', ')}`);

  /**
   * THE ADVERSARIAL TABLE, AND IT IS THE POINT OF THE WHOLE SECTION. The title
   * is a DIRECTORY name and part of six FILE names at export
   * (`<title>/<title> - <stem>.wav`), so a title that can be a path is a write
   * outside the folder the user chose.
   */
  const nasty = ['../../etc/passwd', 'a/b', 'C:\\Windows\\system32', '..', '.', './.', '.hidden',
    'trailing.', 'trailing ', 'CON', 'com1', 'nul.wav', 'x\u0000y', 'bell\u0007', '   ', '.....',
    '///', 'a'.repeat(300), 'a:b*c?d"e<f>g|h', '', null, undefined];
  const safe = (t) => {
    const s = sanitiseTitle(t);
    return s.length > 0 && s.length <= MAX_TITLE
      && !/[/\\]/.test(s) && !/[\u0000-\u001f\u007f]/.test(s)
      && s !== '.' && s !== '..' && !/^[.\s]/.test(s) && !/[.\s]$/.test(s)
      && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i.test(s);
  };
  const clean = nasty.filter(safe);
  ok('...and a title can never BE a path: no separator, no traversal, no control byte, no reserved '
    + 'device name and no trailing dot survives  [entry point: sanitiseTitle()]',
    clean.length === nasty.length,
    `${clean.length}/${nasty.length}${clean.length === nasty.length
      ? ` (\`..\` -> ${JSON.stringify(sanitiseTitle('..'))}, fallback ${JSON.stringify(FALLBACK_TITLE)})`
      : ` — LET THROUGH ${nasty.filter((t) => !safe(t)).map((t) => `${JSON.stringify(t)} -> ${JSON.stringify(sanitiseTitle(t))}`).join(', ')}`}`);

  // The property the one above exists FOR, stated as the thing the writer will
  // actually do: resolve the title against the chosen folder and stay in it.
  const CHOSEN = '/tmp/chosen-export-folder';
  const escaped = nasty.filter((t) => path.dirname(path.resolve(CHOSEN, sanitiseTitle(t))) !== CHOSEN);
  ok('...and joining any of them to the chosen folder resolves to a child of that folder, never outside it  '
    + '[entry point: sanitiseTitle()]',
    escaped.length === 0,
    escaped.length ? `ESCAPED: ${escaped.map((t) => `${JSON.stringify(t)} -> ${path.resolve(CHOSEN, sanitiseTitle(t))}`).join(', ')}`
      : `${nasty.length} titles, all under ${CHOSEN}/`);

  // ------------------------------------------------------------ path tokens
  // A CLOCK THE SUITE MOVES, not a `sleep`: AGENTS.md, "if a count can carry the
  // claim, do not carry it with a stopwatch" — and expiry is the same idea.
  let clock = 1_000_000;
  const tokens = createPathTokens({ now: () => clock });
  const t1 = tokens.mint('/music/one.wav');
  const first = tokens.spend(t1);
  const second = tokens.spend(t1);
  ok('a path token is ONE SHOT — the second spend is refused as unknown, which is also what a replay is  '
    + '[entry point: createPathTokens() spend()]',
    first.ok === true && first.file === '/music/one.wav' && first.mime === 'audio/wav'
    && second.ok === false && second.code === 'unknown-token',
    `first ${JSON.stringify(first)} · second ${JSON.stringify(second)}`);

  const t2 = tokens.mint('/music/two.flac');
  clock += PATH_TOKEN_TTL_MS + 1;
  const late = tokens.spend(t2);
  const never = tokens.spend('a-token-nobody-minted');
  ok('...and one spent after its TTL is refused as EXPIRED, which is a different answer from unknown  '
    + '[entry point: spend()]',
    late.ok === false && late.code === 'expired' && never.code === 'unknown-token'
    && late.code !== never.code,
    `after ${PATH_TOKEN_TTL_MS + 1} ms on the injected clock -> ${late.code}; never minted -> ${never.code}`);

  const t3 = tokens.mint('/music/three.mp3');
  const t4 = tokens.mint('/music/four.ogg');
  const dropped = tokens.revokeAll('the gesture ended');
  const afterRevoke = tokens.spend(t3);
  ok('...and revokeAll drops every live token, so a path cannot outlive the gesture that named it  '
    + '[entry point: revokeAll()]',
    dropped === 2 && tokens.inspect().live === 0 && afterRevoke.code === 'unknown-token'
    && t3 !== t4 && /^[0-9a-f-]{36}$/.test(t3),
    `revoked ${dropped}, ${tokens.inspect().live} live after; a revoked token reads as ${afterRevoke.code}; `
    + 'tokens are randomUUIDs, not a counter something could ask for the next of');
}

// ------------------------------------------------------------------ helpers
// THE SHARED PLANES, AND THE SUITE'S OWN BYTES FOR THEM. One generator, and a
// plain Buffer serializer: the vendored `encodeWav` is exercised ONLY by the
// app under test, never by this suite, so a gate cannot check the encoder
// against itself. The values are dyadic rationals, EXACT in Float32 — a
// byte-for-byte comparison cannot be thrown off by rounding.
const PLANES_FRAMES = 16;

/** val(i, ch, j) = ±(0.25 + 0.125*i) * (0.5 + 0.0625*(j%8)); L positive, R negative. */
function syntheticPlanes() {
  const out = {};
  for (const [i, stem] of STEMS.entries()) {
    const L = new Float32Array(PLANES_FRAMES);
    const R = new Float32Array(PLANES_FRAMES);
    for (let j = 0; j < PLANES_FRAMES; j++) {
      const v = (0.25 + 0.125 * i) * (0.5 + 0.0625 * (j % 8));
      L[j] = v;
      R[j] = -v;
    }
    out[stem] = [L, R];
  }
  return out;
}

/** The same planes as plain arrays — the JSON that travels to the probe. */
function planeJSON(planes) {
  const out = {};
  for (const stem of STEMS) out[stem] = planes[stem].map((ch) => Array.from(ch));
  return out;
}

/**
 * The whole expected file for one stem, written with plain Buffer ops — the
 * layout the vendored `encodeWav` produces for 32f stereo (read verbatim from
 * vendor/.../extension/shared/wav.js): 58 header bytes, `fact` present, data
 * interleaved L,R Float32LE, RIFF size = 50 + dataSize.
 */
function expectedWav(planes, stem) {
  const [L, R] = planes[stem];
  const dataSize = L.length * 8;
  const b = Buffer.alloc(58 + dataSize);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(50 + dataSize, 4);
  b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii');
  b.writeUInt32LE(18, 16);      // fmtSize, cbSize included
  b.writeUInt16LE(3, 20);       // FMT_IEEE_FLOAT
  b.writeUInt16LE(2, 22);       // channels
  b.writeUInt32LE(44100, 24);   // sample rate
  b.writeUInt32LE(352800, 28);  // byte rate
  b.writeUInt16LE(8, 32);       // block align
  b.writeUInt16LE(32, 34);      // bits per sample
  b.writeUInt16LE(0, 36);       // cbSize
  b.write('fact', 38, 'ascii');
  b.writeUInt32LE(4, 42);       // fact chunk size
  b.writeUInt32LE(L.length, 46); // frames
  b.write('data', 50, 'ascii');
  b.writeUInt32LE(dataSize, 54); // data size
  for (let j = 0; j < L.length; j++) {
    b.writeFloatLE(L[j], 58 + j * 8);
    b.writeFloatLE(R[j], 58 + j * 8 + 4);
  }
  return b;
}

/**
 * The header claims, checked field by field: fmt tag 3, 32 bits, 44100 Hz, 2
 * channels, `fact` present, data size = frames × 8. The full-file equality in
 * G2a carries the samples; this carries the header, so the two gates fail
 * apart.
 */
function headerIsExact(b) {
  if (!Buffer.isBuffer(b) || b.length < 58) return false;
  return b.toString('ascii', 0, 4) === 'RIFF'
    && b.readUInt32LE(4) === 50 + (b.length - 58)
    && b.toString('ascii', 8, 12) === 'WAVE'
    && b.toString('ascii', 12, 16) === 'fmt '
    && b.readUInt32LE(16) === 18
    && b.readUInt16LE(20) === 3
    && b.readUInt16LE(22) === 2
    && b.readUInt32LE(24) === 44100
    && b.readUInt32LE(28) === 352800
    && b.readUInt16LE(32) === 8
    && b.readUInt16LE(34) === 32
    && b.toString('ascii', 38, 42) === 'fact'
    && b.readUInt32LE(42) === 4
    && b.readUInt32LE(46) === (b.length - 58) / 8
    && b.toString('ascii', 50, 54) === 'data'
    && b.readUInt32LE(54) === b.length - 58;
}

/** The sink seam's payload: the file's own name, NUL-padded to 8 bytes. */
function sinkPayload(name) {
  const b = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) b[i] = i < name.length ? name.charCodeAt(i) : 0;
  return b;
}

/**
 * Map a REPORTED file path onto the probe's preserved snapshot. The probe
 * deletes `target` and `moved` inside its own G4 and refusal scenarios, so a
 * file read by the suite after BOTH launches would find nothing. The probe
 * snapshots its artifacts while they still exist (report fields
 * `phase1Snapshot`, `phase2Target`, `phase2Moved`); this maps a path that was
 * under `root` onto its copy. Returns null when any input is missing — a red,
 * never a crash.
 */
function mapped(snap, root, file) {
  try { return snap && root && file ? path.join(snap, path.relative(root, file)) : null; } catch { return null; }
}

/** Read a file through the snapshot, returning null on any failure. */
function readMapped(snap, root, file) {
  const p = mapped(snap, root, file);
  if (!p) return null;
  try { return fs.readFileSync(p); } catch { return null; }
}

// ==========================================================================
// 1b. THE WRITER AND THE EXPORT SINK, AS PURE FUNCTIONS
// ==========================================================================
// A fake dialog and a REAL filesystem: this lane exists to give the battery a
// fast red for the writer's own bytes. The "never stubbed" rule in the header
// is about the LAUNCHED half — the thing whose count must be real — and the
// launched half drives the real chooser; what is faked here is only the answer
// to the picker, never the bytes, never the session, never the duty.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-export-pure-'));
  const chosen = path.join(root, 'chosen');
  fs.mkdirSync(chosen, { recursive: true });
  const mem = new Map();
  const storage = {
    get: (area, key) => mem.get(`${area}:${key}`),
    set: (area, key, value) => mem.set(`${area}:${key}`, value),
  };
  const makeDialog = (answer) => ({ showOpenDialog: async () => answer });
  const intake = createFileIntake({
    dialog: makeDialog({ canceled: false, filePaths: [chosen] }),
    window: () => null,
    storage,
    tokens: createPathTokens(),
  });

  const stems = syntheticPlanes();

  // ------------------------------------------------------------- the writer
  let wrote = null;
  let wroteErr = null;
  try { wrote = await intake.exportStems({ title: 'Pure Song', stems }); } catch (e) { wroteErr = String((e && e.message) || e); }
  const names = (wrote && wrote.files) ? wrote.files.map((f) => f.name) : [];

  ok('THE WRITER: six WAVs in STEMS order, named `<title> - <stem>.wav`, each 58 + frames×8 bytes  '
    + '[entry point: exportStems() in src/main/files.js]',
    !wroteErr && wrote.ok === true && wrote.files.length === STEMS.length
    && names.every((n, i) => n === `${wrote.title} - ${STEMS[i]}.wav`)
    && wrote.files.every((f) => { try { return fs.statSync(f.file).size === 58 + PLANES_FRAMES * 8; } catch { return false; } }),
    wroteErr ? `THREW: ${wroteErr}` : `${names.join(', ')} under ${JSON.stringify(wrote.dir)}`);

  let hdr = null;
  try { hdr = fs.readFileSync(wrote.files[0].file); } catch { /* asserted below */ }
  ok('G1: the header is bit-exact — fmt tag 3, 32 bits, 44100 Hz, 2 channels, `fact` present, data = frames × 8  '
    + '[entry point: encodeWav() in vendor/.../shared/wav.js, called from exportStems()]',
    headerIsExact(hdr),
    hdr ? `RIFF ${hdr.readUInt32LE(4)} · fmt ${hdr.readUInt16LE(20)}/${hdr.readUInt16LE(34)}b · `
      + `${hdr.readUInt32LE(24)} Hz · ${hdr.readUInt16LE(22)} ch · fact ${hdr.readUInt32LE(46)} · data ${hdr.readUInt32LE(54)}`
      : 'no file to read');

  // G2a — BYTE-IDENTICAL. No scaling, no dither, no normalisation: the data
  // section IS the planes, and the whole file is compared, header and all.
  const mismatches = [];
  for (const [i, stem] of STEMS.entries()) {
    const want = expectedWav(stems, stem);
    let got = null;
    try { got = fs.readFileSync(wrote.files[i].file); } catch { /* below */ }
    if (!got || !got.equals(want)) mismatches.push(stem);
  }
  ok('G2a: every WAV is byte-identical to its plane — no scaling, no dither, no normalisation  '
    + '[entry point: exportStems() -> encodeWav()]',
    !!wrote && wrote.files.length === STEMS.length && mismatches.length === 0,
    wrote && !mismatches.length ? `all ${STEMS.length} files equal the recomputed bytes`
      : `wrote=${!!wrote} DIFFER: ${mismatches.join(', ')}`);

  // G2b-PATH — the escape attempt, ON DISK, where the pure title checks above
  // cannot reach. A title that is a path is a write outside the chosen folder.
  let escaped = null;
  let escapedErr = null;
  try { escaped = await intake.exportStems({ title: '../../escape', stems }); } catch (e) { escapedErr = String((e && e.message) || e); }
  const inside = !!escaped && escaped.files.every((f) => path.dirname(f.file) === path.join(chosen, 'escape'));
  ok('G2b-path: a title that is a path resolves to a child of the chosen folder ON DISK, never outside it  '
    + '[entry point: exportStems() -> sanitiseTitle()]',
    !escapedErr && !!escaped && escaped.title === 'escape' && inside,
    escapedErr ? `THREW: ${escapedErr}` : escaped ? `title -> ${JSON.stringify(escaped.title)} dir ${escaped.files[0].file}` : 'no files');

  // A REFUSAL IS A THROW — the cancelled picker, on the writer path. The
  // storage is a FRESH map: if it shared `mem` the folder would be remembered
  // and no picker would ever open. The refusal has to happen for real.
  const cancelling = createFileIntake({
    dialog: makeDialog({ canceled: true, filePaths: [] }),
    window: () => null,
    storage: { get: () => undefined, set: () => {} },
    tokens: createPathTokens(),
  });
  let refused = null;
  try { await cancelling.exportStems({ title: 'Never', stems }); } catch (e) { refused = String((e && e.message) || e); }
  ok('a cancelled folder picker is a THROWN refusal on the writer path, never an empty result  '
    + '[entry point: exportStems() -> ensureExportFolder() -> askForFolder()]',
    typeof refused === 'string' && refused.includes('cancelled'),
    refused ? `threw: ${refused.slice(0, 80)}` : 'NO THROW — the writer resolved with nothing');

  // ------------------------------------------------------------ the sink
  // THE WHOLE SEAM MINUS ELECTRON: the real duty from the hole module, over the
  // real main-process session, with only the wire stubbed to the intake's own
  // four methods.
  const sinkIntake = createFileIntake({
    dialog: makeDialog({ canceled: false, filePaths: [chosen] }),
    window: () => null,
    storage,
    tokens: createPathTokens(),
  });
  globalThis.__wbEngine = {
    openExportSink: (p) => sinkIntake.openSink(p),
    writeExportSink: (n, c) => sinkIntake.writeSink(n, c),
    closeExportSink: (n) => sinkIntake.closeSink(n),
    abortExportSink: (n) => sinkIntake.abortSink(n),
  };
  const host = await import('../../vendor/stem-splitter-live/extension/offscreen/host.js');

  // The OPEN can itself refuse under a mutation — the battery's case 22 makes
  // every ask answer without a picker and hand back no folder, so this throw
  // would drown every assertion after it. Same rule as the unknownWrite and
  // the close below: the seam's refusals are read as data, never as crashes.
  let sinks = null;
  let sinkOpenErr = null;
  try { sinks = await host.exportSink({ title: 'pure-sink', files: ['a.wav', 'b.wav'] }); }
  catch (e) { sinkOpenErr = String((e && e.message) || e); }
  const wa = sinks && sinks['a.wav'] ? sinks['a.wav'].getWriter() : null;
  if (wa) await wa.write(sinkPayload('a.wav'));
  let secondOpen = null;
  try { secondOpen = await sinkIntake.openSink({ title: 'other', files: ['c.wav'] }); }
  catch (e) { secondOpen = { ok: false, code: 'threw', message: String((e && e.message) || e) }; }
  // A mutated writeSink can THROW instead of refusing — the battery's case 34
  // drops the unknown-file check and lands here with a TypeError on a dead fd.
  // The suite reads the refusal as data, not as a crash: either shape must
  // produce a FAIL line, not an uncaught exception that drowns the assertion.
  let unknownWrite;
  try { unknownWrite = sinkIntake.writeSink('never-opened.wav', new Uint8Array(1)); }
  catch (e) { unknownWrite = { ok: false, code: 'threw', message: String((e && e.message) || e) }; }
  // The battery's case 32 drops the already-open check, so the second open
  // SUCCEEDS and replaces the live session — and this stream's close then
  // throws inside the duty ("no open sink file named a.wav"). Without the
  // catch the suite DIES at this line and never reaches the assertion below:
  // measured on 2026-08-27 as a Node crash, not a FAIL line. Same rule as the
  // unknownWrite above — the seam's refusals are read as data.
  let closeErr = null;
  if (wa) { try { await wa.close(); } catch (e) { closeErr = String((e && e.message) || e); } }
  if (sinks && sinks['b.wav']) { try { await sinks['b.wav'].abort(); } catch { /* data */ } }
  const sinkDir = path.join(chosen, 'pure-sink');
  let sinkFiles = null;
  try { sinkFiles = fs.readdirSync(sinkDir).sort(); } catch { /* asserted */ }
  ok('the EXPORT SINK opens every file of a deliverable at once and streams chunks to disk through the duty  '
    + '[entry point: exportSink() in vendor/.../offscreen/host.js -> src/main/files.js §5]',
    !sinkOpenErr && !!sinks && !!sinkFiles && sinkFiles.length === 1 && sinkFiles[0] === 'a.wav'
    && fs.readFileSync(path.join(sinkDir, 'a.wav')).equals(sinkPayload('a.wav'))
    && !fs.existsSync(path.join(sinkDir, 'b.wav')),
    sinkOpenErr ? `open THREW: ${sinkOpenErr.slice(0, 80)}`
      : sinkFiles ? `on disk: ${sinkFiles.join(', ')}` : 'nothing on disk');

  ok('...a second session cannot open while one is live, and a chunk cannot invent a file  '
    + '[entry point: openSink() / writeSink() in src/main/files.js]',
    secondOpen.ok === false && secondOpen.code === 'already-open'
    && unknownWrite.ok === false && unknownWrite.code === 'unknown-file'
    && closeErr === null,
    `second open -> ${JSON.stringify(secondOpen.code)} · unknown name -> ${JSON.stringify(unknownWrite.code)}`
    + ` · close of the first session -> ${closeErr ? 'THREW ' + closeErr.slice(0, 60) : 'ok'}`);

  // The seam's refusals, driven THROUGH the duty: the unit must hear an error,
  // never a map missing a file.
  const refusePlan = async (plan) => {
    try { await host.exportSink(plan); return null; } catch (e) { return String((e && e.message) || e); }
  };
  const emptyPlan = await refusePlan({ title: 'x', files: [] });
  const badName = await refusePlan({ title: 'x', files: ['../../sink-escape.wav'] });
  ok('an empty plan and a name that is not a plain file name are refused AT THE SEAM — a throw, never an empty map  '
    + '[entry point: exportSink() -> openSink()]',
    typeof emptyPlan === 'string' && emptyPlan.includes('export refused')
    && typeof badName === 'string' && badName.includes('is not a plain file name'),
    `empty -> ${JSON.stringify(emptyPlan)} · bad name -> ${JSON.stringify(badName)}`);

  // ...and the cancelled picker, on the sink path: the SAME throw. Fresh
  // storage again — a remembered folder would answer before the picker opens.
  const cancelledSink = createFileIntake({
    dialog: makeDialog({ canceled: true, filePaths: [] }),
    window: () => null,
    storage: { get: () => undefined, set: () => {} },
    tokens: createPathTokens(),
  });
  globalThis.__wbEngine = {
    openExportSink: (p) => cancelledSink.openSink(p),
    writeExportSink: (n, c) => cancelledSink.writeSink(n, c),
    closeExportSink: (n) => cancelledSink.closeSink(n),
    abortExportSink: (n) => cancelledSink.abortSink(n),
  };
  const cancelRefusal = await refusePlan({ title: 'x', files: ['a.wav'] });
  ok('a cancelled folder picker refuses the whole sink at the seam — a THROW, never an empty map  '
    + '[entry point: exportSink() -> openSink() -> ensureExportFolder()]',
    typeof cancelRefusal === 'string' && cancelRefusal.includes('no folder was chosen'),
    cancelRefusal ? `threw: ${cancelRefusal.slice(0, 80)}` : 'NO THROW — an empty map was handed out');

  fs.rmSync(root, { recursive: true, force: true });
}

/**
 * THE BATTERY'S FAST LANE. `EXPORT_ONLY=pure` stops here, having asserted
 * everything that needs no display, and `tools/suites/export-mutations.sh` runs
 * its pure cases that way — seconds each instead of two real launches.
 *
 * THE RUNNER NEVER USES IT, and cannot: the count it prints is not the pinned
 * one, so `classify()` reports a FAIL. That is the right relationship. It is the
 * same trade `deck-host` makes with `DECK_HOST_ONLY=conformance`, and it is a
 * lane for a battery rather than a way to get a cheap green.
 */
if (process.env.EXPORT_ONLY === 'pure') {
  console.log(`${ID}: EXPORT_ONLY=pure — the launched half did not run, so this count is NOT the pinned one`);
  done();
}

// ==========================================================================
// 2. TWO REAL LAUNCHES, ONE PROFILE
// ==========================================================================
const electron = path.join(ROOT, 'node_modules', '.bin', 'electron');
if (!fs.existsSync(electron)) skip('electron is not installed — npm i');
if (!hasBin('xvfb-run')) skip('xvfb-run is not on PATH and this box has no DISPLAY');
if (!hasBin('flock')) skip('flock is not on PATH — the shared browser mutex cannot be taken');
// A MACHINE PROPERTY, LIKE THE OTHER THREE. Without `xdotool` there is no way to
// answer a native chooser, and a native chooser is the thing under test — so
// this cannot be worked around, only skipped honestly. `docs/TESTING.md` §3
// rule 8: SKIPPED is for the machine.
if (!hasBin('xdotool')) skip('xdotool is not on PATH — the real native chooser cannot be answered');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const userData = path.join(OUT, 'userdata');
const chosen = path.join(OUT, 'chosen stems');        // a space, because a real one has one
fs.mkdirSync(chosen, { recursive: true });
const library = path.join(OUT, 'library');
fs.mkdirSync(library, { recursive: true });
const fixtureFile = path.join(library, 'Deep Cuts - Track 01.wav');
fs.writeFileSync(fixtureFile, minimalWav());
const player = pathToFileURL(path.join(ROOT, 'tools', 'fixture', 'player.html')).href;

// THE PLANES TRAVEL WITH THE LAUNCH — see the header. One generator (the
// suite's), consumed by the probe; the expected bytes are re-derived here.
const PLANES = syntheticPlanes();
const PLANES_JSON = JSON.stringify(planeJSON(PLANES));

const launches = {};
for (const phase of ['first', 'again']) {
  const dir = path.join(OUT, phase);
  const r = await run('flock', [LOCK, '-c',
    `echo ${LOCK_MARK}; exec xvfb-run -a -s '-screen 0 1280x1024x24' ${sh(electron)} . `
    + `--gate=${sh(dir)} --gate-probe=export --source-url=${sh(player)} --user-data=${sh(userData)}`],
  {
    cwd: ROOT,
    timeoutMs: 180000,
    queueMs: 900000,
    startOn: LOCK_MARK,
    env: {
      ...process.env,
      // See the header. Without this the portal is asked, nothing maps, and the
      // dialog's promise never settles.
      DBUS_SESSION_BUS_ADDRESS: 'disabled:',
      WB_EXPORT_PHASE: phase,
      WB_EXPORT_TARGET: chosen,
      WB_EXPORT_FIXTURE: phase === 'first' ? fixtureFile : '',
      WB_EXPORT_TITLE: 'Gate Song',
      WB_EXPORT_PLANES: PLANES_JSON,
    },
  });
  fs.writeFileSync(path.join(OUT, `${phase}.log`), r.out);
  let report = null;
  try { report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8')); } catch { /* asserted */ }
  launches[phase] = { run: r, report };
}

const A1 = launches.first.report;
const A2 = launches.again.report;

// A SUITE THAT CANNOT LOOK FAILS. Two launches that wrote nothing is the failure,
// not a reason to stop asserting.
ok('both launches ran from the real entry point and wrote a gate report  '
  + '[entry point: `electron . --gate-probe=export` -> src/main/main.js]',
  !!A1 && A1.gate === 1 && A1.phase === 'first' && !!A2 && A2.gate === 1 && A2.phase === 'again',
  [['first', A1, launches.first], ['again', A2, launches.again]].map(([n, R, l]) =>
    `${n}: ${R ? `ok, electron ${R.versions.electron}` : `NO REPORT (exit ${l.run.code} — ${lastLine(l.run.out)})`}`).join(' · '));
if (!A1 || !A2) done();

/**
 * THE INSTRUMENT, AND IT COMES BEFORE EVERY COUNT BELOW IT.
 *
 * Everything after this is "how many times did the app ask for a folder", read
 * off a counter in `src/main/files.js`. That number is a fact about THIS APP
 * only while the thing being counted is the operating system's own picker. A
 * build whose intake held a stub would produce identical counts over a dialog
 * that never opened, so this is a separate claim with its own name, in the shape
 * `shell`'s bus recorder and `p1`'s hit counter already use.
 */
ok('INSTRUMENT CHECK: the intake in the running app holds electron\'s own `dialog` — nothing was stubbed  '
  + '[entry point: createFileIntake() in src/main/files.js, built in boot() in src/main/main.js]',
  A1.dialogIsElectron === true && A2.dialogIsElectron === true,
  `first ${A1.dialogIsElectron}, again ${A2.dialogIsElectron}; `
  + `the chooser is driven with xdotool on ${A1.display} (DBUS=${A1.dbus})`);

ok('a launch on its own asks for nothing — the export folder is asked for by an EXPORT, never by starting up',
  A1.asksAtBoot === 0 && A2.asksAtBoot === 0,
  `first launch ${A1.asksAtBoot} ask(s) at boot, relaunch ${A2.asksAtBoot} — the control the counts below rest on`);

// --------------------------------------------------------- the first export
ok('the first export opens the REAL native folder chooser, and it was answered with a chosen folder  '
  + '[entry point: exportStems() -> ensureExportFolder() in src/main/files.js]',
  A1.chooserMapped === true && O(A1.answered).answered === true
  && O(A1.export1).ok === true && O(A1.export1).folder === A1.target && O(A1.export1).asked === true,
  `a window named ${JSON.stringify(A1.folderDialogTitle)} mapped, answered in ${O(A1.answered).waitedMs} ms `
  + `at corner offset ${JSON.stringify(O(A1.answered).at)} -> folder ${JSON.stringify(O(A1.export1).folder || A1.export1)}`);

// The options are a separate claim from the count: a picker opened with
// `openFile` would be opened exactly once too, and would hand back a file.
const opts = O(A1.optionsUsed);
ok('...and the options it was opened with are a FOLDER picker that may create one, not a file picker  '
  + '[entry point: FOLDER_DIALOG in src/main/files.js]',
  Array.isArray(opts.properties) && opts.properties.length === 2
  && opts.properties.includes('openDirectory') && opts.properties.includes('createDirectory')
  && !opts.properties.includes('openFile') && !opts.filters && opts.title === FOLDER_DIALOG.title,
  `properties ${JSON.stringify(opts.properties)} title ${JSON.stringify(opts.title)} filters ${JSON.stringify(opts.filters)}`);

ok('a second export requested while the chooser is UP joins that ask — one picker, never two stacked modals  '
  + '[entry point: ensureExportFolder()]',
  A1.asksWhileChooserUp === 1 && A1.joinedPending === 1
  && O(A1.export1dup).ok === true && O(A1.export1dup).folder === O(A1.export1).folder,
  `${A1.asksWhileChooserUp} ask(s) with the chooser up, ${A1.joinedPending} request joined it; `
  + `both resolved to ${JSON.stringify(O(A1.export1dup).folder)}`);

// ---------------------------------------------------------------------- G3
ok('the folder is asked EXACTLY ONCE across two consecutive exports  [entry point: ensureExportFolder()]',
  A1.asksAfterSecond === 1,
  `${A1.asksAfterSecond} real invocation(s) of dialog.showOpenDialog across export #1 and export #2 `
  + `(${A1.asksAfterFirst} after the first); a chooser during export #2: ${JSON.stringify(O(A1.secondChooser).appeared)}`);

ok('...and export #2 resolved to the REMEMBERED folder without a chooser at all  [entry point: ensureExportFolder()]',
  O(A1.export2).ok === true && O(A1.export2).folder === A1.target && O(A1.export2).asked === false
  && O(A1.secondChooser).appeared === false && O(A1.stats).folderFromMemory >= 1,
  `export #2 -> ${JSON.stringify(O(A1.export2).folder || A1.export2)} asked=${O(A1.export2).asked}, `
  + `${O(A1.stats).folderFromMemory} export(s) served from memory`);

// ---------------------------------------------------------------------- G4
ok('the remembered folder survives a RESTART — a second launch on the same profile asks zero times  '
  + '[entry point: ensureExportFolder()]',
  A2.asksAfterRestart === 0 && O(A2.restartChooser).appeared === false && O(A2.export3).ok === true
  && O(A2.export3).asked === false,
  `${A2.asksAfterRestart} ask(s) in a new process over ${path.relative(ROOT, userData)}; `
  + `export -> ${JSON.stringify(O(A2.export3).folder || A2.export3)} asked=${O(A2.export3).asked}`);

ok('...and it is the SAME folder, read back out of the `local` area rather than a lifetime that dies with the process  '
  + '[entry point: EXPORT_FOLDER_AREA in src/main/files.js]',
  O(A2.export3).folder === A1.target && O(A2.stored).local === A1.target && O(A2.stored).session === null,
  `local=${JSON.stringify(O(A2.stored).local)} session=${JSON.stringify(O(A2.stored).session)} `
  + `chosen in launch 1: ${JSON.stringify(A1.target)}`);

/**
 * AND THE FOLDER THE USER DELETED — issue #6's case, and a branch of
 * `rememberedFolder()` that nothing else here reaches.
 *
 * A remembered path is a claim about a filesystem nobody told us had changed.
 * Discovering it is gone while writing the fourth of six stems is a failure at
 * the END of a long operation, with half a track on disk. TWO facts, because a
 * build that asked again and then kept the dead path would satisfy the first on
 * its own: it asked, AND it took the new answer.
 */
ok('...and a remembered folder that has been DELETED is not used — the app asks again, and takes the new answer  '
  + '[entry point: ensureExportFolder()]',
  A2.goneChooserMapped === true && O(A2.goneAnswered).answered === true
  && A2.asksAfterRestart === 0 && A2.asksAfterGone === 1 && A2.askReason === 'gone'
  && O(A2.export4).ok === true && O(A2.export4).folder === A2.moved
  && O(A2.storedAfterGone).local === A2.moved && O(A2.stats).folderGone >= 1,
  `${A2.asksAfterRestart} ask(s) while it existed, ${A2.asksAfterGone} after it was removed `
  + `(reason ${JSON.stringify(A2.askReason)}); ${JSON.stringify(path.basename(String(A2.moved)))} `
  + `replaced it in \`local\``);

// ------------------------------------------------------------ the file picker
const picked = O(A1.picked);
ok('the file picker admits a real audio file, derives its title and mints a one-shot path token  '
  + '[entry point: chooseSourceFile() in src/main/files.js]',
  A1.fileChooserMapped === true && O(A1.fileAnswered).answered === true
  && picked.ok === true && picked.file === A1.fixture
  && picked.title === deriveTitle(A1.fixture) && picked.mime === 'audio/wav' && typeof picked.token === 'string',
  picked.ok
    ? `${JSON.stringify(path.basename(picked.file))} -> title ${JSON.stringify(picked.title)} mime ${picked.mime} `
      + `ttl ${picked.ttlMs} ms, over the real ${JSON.stringify(A1.fileDialogTitle)} chooser`
    : `chooser mapped=${A1.fileChooserMapped} answered=${JSON.stringify(A1.fileAnswered)} picked=${JSON.stringify(A1.picked)}`);

ok('...and that token resolves to that file exactly once, over the running app\'s own registry  '
  + '[entry point: createPathTokens() spend(), through src/main/main.js state.pathTokens]',
  O(A1.tokenFirst).ok === true && O(A1.tokenFirst).file === A1.fixture
  && O(A1.tokenFirst).mime === 'audio/wav' && O(A1.tokenSecond).ok === false
  && O(A1.tokenSecond).code === 'unknown-token',
  `first spend ${JSON.stringify(A1.tokenFirst)} · second ${JSON.stringify(A1.tokenSecond)}`);

/**
 * THE REFUSAL, DRIVEN FOR REAL OVER THE SAME CHOOSER.
 *
 * `filters` is a browsing convenience and decides nothing — Ctrl+L takes any
 * path at all, which is exactly how this suite answers its own picker. So the
 * allowlist's call site inside `chooseSourceFile()` is the thing that has to
 * refuse, and it has to refuse BY NAME: a picker that closes and produces no
 * outcome is the defect `src/renderer/chrome.js` was rewritten to fix.
 */
const refusedPick = O(A1.refusedPick);
ok('...and a file the allowlist does not admit is REFUSED BY NAME over that same chooser, never silently dropped  '
  + '[entry point: chooseSourceFile()]',
  A1.refusedChooserMapped === true && O(A1.refusedAnswered).answered === true && A1.fileAsks === 2
  && refusedPick.ok === false && refusedPick.code === 'not-audio'
  && typeof refusedPick.message === 'string' && refusedPick.message.includes('sleeve-notes.txt')
  && O(A1.stats).refused === 1,
  `${A1.fileAsks} real file pickers; ${JSON.stringify(path.basename(String(A1.notAudio)))} -> `
  + `${JSON.stringify(refusedPick.code)}: ${String(refusedPick.message).slice(0, 90)}`);

// ==========================================================================
// 3. THE WRITER AND THE EXPORT SINK, IN THE RUNNING APP
// ==========================================================================
// The pure section proved the bytes over a fake dialog; this section proves
// them in the app, off the SAME planes, over the REAL chooser, and reads the
// files back off the disk. The expected bytes are re-derived with the same
// plain Buffer ops — the vendored encoder is exercised only by the app under
// test. The suite never trusts a report field for the bytes (the writer's own
// trap, named in the header): it reads the files itself.

ok('G1 IN THE APP: the writer\'s header is bit-exact — fmt tag 3, 32 bits, 44100 Hz, 2 channels, `fact` present, data = frames × 8  '
  + '[entry point: exportStems() -> encodeWav() in vendor/.../shared/wav.js]',
  A1.planesBroken === false && O(A1.export1).ok === true
  && O(A1.export1).files.length === STEMS.length && A1.export1.title === A1.title
  && headerIsExact(readMapped(A1.phase1Snapshot, A1.target, A1.export1.files[0] && A1.export1.files[0].file)),
  `planes ${A1.planesFrames} frames · title ${JSON.stringify(A1.export1.title)} · `
  + `${(A1.export1.files || []).map((f) => path.basename(f.file)).join(', ')}`);

// G2a — BYTE-IDENTICAL. No scaling, no dither, no normalisation: the data
// section IS the planes, compared whole-file against the suite's own bytes.
const diffs = [];
for (const [i, stem] of STEMS.entries()) {
  const f = A1.export1 && A1.export1.files && A1.export1.files[i];
  const got = readMapped(A1.phase1Snapshot, A1.target, f && f.file);
  if (!got || !got.equals(expectedWav(PLANES, stem))) diffs.push(stem);
}
ok('G2a IN THE APP: all six WAVs are byte-identical to the planes — unity gain, no dither, no normalisation  '
  + '[entry point: exportStems()]',
  A1.planesBroken === false && O(A1.export1).ok === true && diffs.length === 0,
  diffs.length ? `DIFFER: ${diffs.join(', ')}` : 'all six files equal the suite\'s recomputed bytes');

// G2b-PATH — the escape attempt, read back OFF THE DISK in the running app.
// The REPORT's paths carry the resolution claim (a title that escaped would
// name a directory outside the chosen folder); the SNAPSHOT's bytes carry the
// "actually wrote it there" half — two observations, never one.
const esc = O(A1.escape);
const escBytes = esc.ok === true && esc.title === 'escape'
  && Array.isArray(esc.files) && esc.files.length === STEMS.length
  && esc.files.every((f, i) => {
    const b = readMapped(A1.phase1Snapshot, A1.target, f.file);
    return b && b.equals(expectedWav(PLANES, STEMS[i]));
  });
ok('G2b-path IN THE APP: a title that is a path cannot escape the chosen folder — the writer\'s files landed under it  '
  + '[entry point: exportStems() -> sanitiseTitle()]',
  esc.ok === true && esc.title === 'escape'
  && Array.isArray(esc.files) && esc.files.length === STEMS.length
  && esc.files.every((f) => path.dirname(f.file) === path.join(A1.target, 'escape'))
  && escBytes
  && O(A1.trailing).title === 'trailing',
  esc.files ? `${esc.files.length} files under ${JSON.stringify(path.join(A1.target, 'escape'))}`
    : `escape -> ${JSON.stringify(esc)}`);

// G3 FOR THE WRITER — the folder is still asked exactly once, with the writer,
// the escape attempts and the sink seam all standing behind the same ask.
ok('G3 FOR THE WRITER: the escape attempts and the sink seam asked for the folder NOTHING new — one ask, still  '
  + '[entry point: ensureExportFolder(), shared by writer and sink]',
  A1.asksAfterEscape === 1 && A1.asksAfterSink === 1,
  `after exports #1-#2 ${A1.asksAfterFirst}, after the escape attempts ${A1.asksAfterEscape}, `
  + `after the sink ${A1.asksAfterSink}`);

// THE SINK — driven from the ENGINE renderer, through the real duty and the
// real preload, into the real main-process session.
const sinkDrive = O(A1.sinkDrive);
ok('THE EXPORT SINK, IN THE ENGINE: one gesture opens every file at once, and chunks stream to main over the real bridge  '
  + '[entry point: exportSink() in vendor/.../offscreen/host.js -> src/preload/engine.cjs -> src/main/main.js]',
  Array.isArray(sinkDrive.names) && sinkDrive.names.join(',') === 'a.wav,b.wav'
  && sinkDrive.wrote && sinkDrive.wrote['a.wav'] === 8 && sinkDrive.wrote['b.wav'] === 8
  && sinkDrive.stats && sinkDrive.stats.exportSinks === 1 && sinkDrive.stats.exportBytes === 16
  && sinkDrive.stats.exportClosed === 2,
  `names ${JSON.stringify(sinkDrive.names)} · wrote ${JSON.stringify(sinkDrive.wrote)} · `
  + `bytes ${sinkDrive.stats && sinkDrive.stats.exportBytes}`);

// ...and the bytes are ON DISK, exactly the suite's own re-derived payload.
const onDisk = Array.isArray(A1.sinkOnDisk);
const aBytes = readMapped(A1.phase1Snapshot, A1.target, A1.sinkDir && path.join(A1.sinkDir, 'a.wav'));
const bBytes = readMapped(A1.phase1Snapshot, A1.target, A1.sinkDir && path.join(A1.sinkDir, 'b.wav'));
ok('...and the sink\'s bytes are on disk, exactly the suite\'s own re-derived payload for each name  '
  + '[entry point: writeSink() in src/main/files.js]',
  onDisk && A1.sinkOnDisk.join(',') === 'a.wav,b.wav'
  && A1.sinkSizes['a.wav'] === 8 && A1.sinkSizes['b.wav'] === 8
  && !!aBytes && aBytes.equals(sinkPayload('a.wav'))
  && !!bBytes && bBytes.equals(sinkPayload('b.wav')),
  onDisk ? `${A1.sinkOnDisk.join(', ')} at ${JSON.stringify(A1.sinkDir)}, sizes ${JSON.stringify(A1.sinkSizes)}`
    : 'nothing on disk');

// A REFUSAL IS A THROW — the user cancelled the REAL chooser mid-gesture.
ok('A REFUSED SINK OPEN IS A THROW — the user cancelled the real chooser, and the unit heard an error, never an empty map  '
  + '[entry point: exportSink() -> openSink() -> askForFolder()]',
  O(A2.sinkRefusalChooser).cancelled === true
  && typeof O(A2.sinkRefused).threw === 'string' && O(A2.sinkRefused).threw.includes('no folder was chosen'),
  `chooser ${JSON.stringify(A2.sinkRefusalChooser)} -> threw ${JSON.stringify(String(O(A2.sinkRefused).threw || '').slice(0, 80))}`);

ok('...and that refusal was its OWN ask — one gesture, one picker, counted beside the real call  '
  + '[entry point: askForFolder() in src/main/files.js]',
  A2.asksAfterRefusal === 2,
  `${A2.asksAfterRefusal} ask(s) in the relaunch: ${A2.asksAfterRestart} before it, `
  + `${A2.asksAfterGone} for the deleted folder, then the refusal\'s own`);

ok('a plan with no files is refused at MAIN\'s own gate — a renderer that bypasses the duty still cannot open an empty deliverable  '
  + '[entry point: openSink() in src/main/files.js, over src/preload/engine.cjs]',
  O(A2.sinkBadPlan).ok === false && O(A2.sinkBadPlan).code === 'bad-plan',
  JSON.stringify(A2.sinkBadPlan));

ok('a name that is not a plain file name is refused AT THE SEAM — and nothing was written outside the folder  '
  + '[entry point: exportSink() -> openSink() name validation in src/main/files.js]',
  typeof O(A2.sinkBadName).threw === 'string' && O(A2.sinkBadName).threw.includes('is not a plain file name')
  && A2.sinkBadNameEscapedFile === false,
  `threw ${JSON.stringify(String(O(A2.sinkBadName).threw || '').slice(0, 80))} · `
  + `escaped file exists: ${A2.sinkBadNameEscapedFile}`);

// G4 FOR THE WRITER — after a restart the writer writes six real WAVs into the
// remembered folder, and after the folder is deleted it writes into the new one.
// The probe's own scenarios delete `target` and `moved` after these writes, so
// the files are read through its preserved snapshots (`phase2Target`,
// `phase2Moved`).
const exp3 = O(A2.export3);
const exp3Files = exp3.ok === true && Array.isArray(exp3.files) && exp3.files.length === STEMS.length
  && exp3.files.every((f) => !!readMapped(A2.phase2Target, A2.target, f.file));
ok('G4 FOR THE WRITER: after a restart the writer wrote six real WAVs into the remembered folder  '
  + '[entry point: exportStems()]',
  exp3.ok === true && exp3Files,
  exp3.files ? `six files under ${JSON.stringify(exp3.dir)}` : JSON.stringify(exp3));

const exp4 = O(A2.export4);
const exp4Files = exp4.ok === true && Array.isArray(exp4.files) && exp4.files.length === STEMS.length
  && exp4.files.every((f) => path.dirname(f.file) === path.join(A2.moved, exp4.title)
    && !!readMapped(A2.phase2Moved, A2.moved, f.file));
ok('...and after the folder was deleted and re-chosen, the writer wrote into the NEW folder, not the dead one  '
  + '[entry point: exportStems()]',
  exp4.ok === true && exp4Files,
  exp4.files ? `six files under ${JSON.stringify(exp4.dir)}` : JSON.stringify(exp4));

console.log(`\n${ID}: launch logs ${path.relative(ROOT, OUT)}/{first,again}.log · `
  + `reports ${path.relative(ROOT, OUT)}/{first,again}/report.json`);
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

/**
 * A REAL 16-bit PCM WAV, 1024 frames of silence — small, and a file rather than
 * a lie. Nothing in this suite decodes it: it exists so the native chooser has
 * something to be answered WITH, and so `deriveTitle` is derived from a name
 * that is really on a disk. The export writer's own 32-bit-float headers are
 * `shared/wav.js`'s and are that slice's to gate.
 */
function minimalWav(frames = 1024) {
  const data = frames * 4;                                  // stereo, 16-bit
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(44100, 24); b.writeUInt32LE(44100 * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(data, 40);
  return b;
}

/** `tools/suites/shell.mjs`'s launcher, with an `env` — see the DBUS note in the header. */
function run(bin, args, { cwd, timeoutMs, queueMs = 0, startOn = null, env = process.env }) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let out = '';
    let waiting = startOn;
    let timer = null;
    const stop = () => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
    };
    const arm = (ms, why) => { clearTimeout(timer); timer = setTimeout(() => { out += `\n[suite] ${why}\n`; stop(); }, ms); };
    arm(waiting ? queueMs : timeoutMs, waiting
      ? `NEVER TOOK THE SHARED BROWSER MUTEX after ${queueMs} ms — killing. Somebody else is holding ${LOCK}`
      : `TIMEOUT after ${timeoutMs} ms — killing`);
    const grab = (c) => {
      out += c.toString();
      if (waiting && out.includes(waiting)) { waiting = null; arm(timeoutMs, `TIMEOUT after ${timeoutMs} ms — killing`); }
    };
    child.stdout.on('data', grab);
    child.stderr.on('data', grab);
    const onExit = () => stop();
    const onSignal = () => { stop(); process.exit(130); };
    process.on('exit', onExit);
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    const finish = (res) => {
      clearTimeout(timer);
      process.off('exit', onExit); process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
      resolve(res);
    };
    child.on('error', (e) => finish({ code: 127, out: `${out}\nspawn error: ${e.message}` }));
    child.on('close', (code) => finish({ code, out }));
  });
}
