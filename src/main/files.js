/**
 * FILE INTAKE — how a local file becomes a Source, and where its stems land.
 *
 * NO `electron` IMPORT IN THIS FILE, ON PURPOSE — the same reason
 * `src/main/claims.js`, `navigation.js` and `assets.js` have none. Three of the
 * four things below are an allowlist, a string transform and a token minter
 * with a clock, and those are worth asserting in plain node rather than only
 * through a launch. The fourth — the native picker — is the one thing that
 * genuinely needs Electron, so `dialog` is handed to `createFileIntake()` by
 * `src/main/main.js` rather than imported here.
 *
 * THAT INJECTION IS NOT A TEST SEAM, AND THE GATE PROVES IT IS NOT. The app
 * builds exactly one intake, in `boot()`, over `electron`'s own `dialog`, and
 * `tools/suites/export.mjs` asserts that the intake the running app is holding
 * is that module (`usesDialog()`), then drives the REAL native chooser with a
 * real pointer and real keystrokes. The dialog count is read off the counter
 * this file increments at the call site. Nothing anywhere replaces, stubs or
 * monkey-patches `dialog.showOpenDialog` — a gate that replaces the thing under
 * test proves nothing, and a stubbed picker would keep the count green while the
 * real one was called twice, never, or with the wrong options.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR THINGS
 * ---------------------------------------------------------------------------
 *   THE ALLOWLIST     which files the File source will take, by extension, with
 *                     the MIME type that extension is served as. Both halves
 *                     matter: the extension decides admission, and the MIME is
 *                     what the `/file/` ROOT will answer with so a byte stream
 *                     is never sniffed.
 *   THE TITLE         one file name in, one safe title out. It is the name of a
 *                     DIRECTORY and of six FILES at export
 *                     (`<title>/<title> - <stem>.wav`), so a title that can be
 *                     a path is a write outside the folder the user chose.
 *   THE PATH TOKEN    a one-shot, expiring handle on an absolute path, so the
 *                     engine renderer can fetch the bytes over `app://` without
 *                     the renderer ever naming a path. It mirrors
 *                     `src/main/claims.js` exactly, including its refusal codes.
 *   THE INTAKE        the two native pickers, and the ASK-ONCE rule that makes
 *                     the export folder a thing the user chooses once.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NOT HERE
 * ---------------------------------------------------------------------------
 * THE EXPORT WRITER. Six 32-bit-float WAVs in `STEMS` order, at unity, through
 * the vendored `shared/wav.js` encoder — that is a separate slice, and it
 * consumes `ensureExportFolder()` and `deriveTitle()` from here. Nothing in this
 * file writes audio.
 *
 * THE `/file/` ROOT. `createPathTokens()` is the half that decides whether a
 * token names anything; putting a `/file/` prefix on the protocol handler and
 * answering with the bytes is the next slice's, and it is why `spend()` returns
 * the MIME type alongside the path.
 *
 * A USER SURFACE. Nothing the user can press reaches `chooseSourceFile()` yet —
 * the chrome bar's File controls are their own slice. That absence is named
 * here rather than left to be discovered, because this repository has shipped
 * the opposite mistake: an Arm button that was `disabled` for a whole wave after
 * arming worked, found only when an auditor clicked it (`src/renderer/chrome.js`
 * header). A control that produces no visible outcome is worse than no control;
 * an intake with no control yet is merely incomplete, and this says so.
 */
import fs from 'node:fs';
import path from 'node:path';

// ============================================================================
// 1. THE ALLOWLIST
// ============================================================================
/**
 * WHAT THE FILE SOURCE TAKES, and every entry is here because Chromium's own
 * `decodeAudioData` can decode it in the engine renderer — the decode is the
 * engine's, so this list is a statement about the decoder we ship with, not a
 * preference. Extension -> the MIME the `/file/` ROOT will serve it as.
 *
 * `.webm` and `.weba` are here because a Matroska container holding Opus or
 * Vorbis is what a browser-recorded file usually is, and refusing one would send
 * the user off to convert a file this engine can already read.
 *
 * WHAT IS DELIBERATELY ABSENT: `.wma`, `.ape`, `.wv`, `.dsf` and every other
 * format Chromium cannot decode. An entry here that the engine then refuses is
 * a refusal the user meets AFTER choosing, which is the worst moment for it.
 */
export const SOURCE_TYPES = Object.freeze({
  '.aac': 'audio/aac',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.oga': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.weba': 'audio/webm',
  '.webm': 'audio/webm',
});

/** The same list, in the shape `dialog.showOpenDialog`'s `filters` wants. */
export const SOURCE_FILTERS = Object.freeze([
  Object.freeze({ name: 'Audio', extensions: Object.freeze(Object.keys(SOURCE_TYPES).map((e) => e.slice(1))) }),
]);

/** The extension of `p`, lower-cased, or `''`. `.tar.gz` is `.gz`: the LAST one decides. */
const extOf = (p) => path.extname(String(p ?? '')).toLowerCase();

/**
 * @param {string} p  an absolute path, as the picker answers with
 * @returns {boolean}
 *
 * THE PICKER'S `filters` ARE NOT THIS CHECK, AND CANNOT BE. A native file
 * chooser's filter is a convenience for browsing: on GTK the user presses
 * Ctrl+L and types any path at all, and the dialog answers with it. (That is not
 * hypothetical — it is exactly how `tools/gate/export.mjs` drives this app's own
 * picker.) So the filter narrows what is easy to find and this function decides
 * what is admitted, and the second one is the one that has to be right.
 */
export function isAllowedSourceFile(p) {
  return Object.hasOwn(SOURCE_TYPES, extOf(p));
}

/**
 * @param {string} p
 * @returns {string|null} the MIME to serve those bytes as, or null if the file
 *   is not one this Source takes. NEVER a default — a byte stream served as
 *   `application/octet-stream` is a byte stream the renderer has to sniff, and
 *   an admitted file whose type we cannot name is a hole in the allowlist
 *   rather than a file to guess about.
 */
export function mimeForSourceFile(p) {
  return Object.hasOwn(SOURCE_TYPES, extOf(p)) ? SOURCE_TYPES[extOf(p)] : null;
}

// ============================================================================
// 2. THE TITLE
// ============================================================================
/**
 * The title when the file name has nothing left in it. Not `''`: an empty title
 * makes `<title>/<title> - drums.wav` into `/ - drums.wav`, which is a write at
 * the root of the chosen folder under a name nobody can find again.
 */
export const FALLBACK_TITLE = 'Untitled';

/**
 * A title is a directory name and part of six file names. 100 leaves room for
 * `<title> - vocals.wav` inside the 255-byte limit every filesystem this ships
 * to imposes on ONE component, with the whole of a UTF-8 multi-byte title's
 * worst case still fitting.
 */
export const MAX_TITLE = 100;

/**
 * The eight names MS-DOS reserved, which Windows still refuses as a file name in
 * any directory, with or without an extension. `CON.wav` is not creatable.
 */
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/**
 * ONE FILE NAME IN, ONE SAFE TITLE OUT — and "safe" here means exactly one
 * thing: **the result cannot be a path**.
 *
 * At export the title is used twice, as `<folder>/<title>/<title> - <stem>.wav`.
 * So a title carrying `..`, a `/`, a `\` or a NUL is not a cosmetic problem, it
 * is a write outside the folder the user chose. The order below is the point:
 *
 *   1. control characters and NUL become spaces FIRST, so a `foo\u0000.wav`
 *      cannot smuggle a truncation past every check after it;
 *   2. BOTH separators go, not just this platform's — the title travels in a
 *      report, and `C:\music\x` arriving on Linux must not become a directory
 *      called `C:` on the machine that reads it;
 *   3. the characters Windows refuses in a name (`: * ? " < > |`) go, so a title
 *      derived on Linux does not produce a file that cannot be written on
 *      Windows — the export must not fail on the sixth stem;
 *   4. LEADING dots and spaces go — `.hidden` becomes `hidden`, `.` and `..`
 *      become nothing at all, and `../../etc/passwd` (whose separators became
 *      spaces at step 2) becomes `etc passwd` rather than a name that still
 *      OPENS with two dots. The strip is `[.\s]+` rather than `\.+` for exactly
 *      that case: one leading dot removed is not the same as no leading dot;
 *   5. TRAILING dots and spaces go, because Windows silently strips them — so
 *      `mix ` and `mix` are the same directory there and two exports would
 *      overwrite each other on one platform and not on the other;
 *   6. a reserved device name is prefixed rather than dropped, so `CON` stays
 *      recognisable to the person looking for it;
 *   7. the length cap is applied LAST and re-trimmed, because a cut can land on
 *      a dot and re-create case 5.
 *
 * @param {unknown} raw
 * @returns {string} a single path component, never empty, never `.` or `..`
 */
export function sanitiseTitle(raw) {
  let s = String(raw ?? '');
  // NFC first: two spellings of one accented name are two directories otherwise,
  // and macOS hands out NFD where Linux hands out NFC for the same file.
  try { s = s.normalize('NFC'); } catch { /* an unpaired surrogate: the strips below still apply */ }
  s = s.replace(/[\u0000-\u001f\u007f]/g, ' ');     // 1
  s = s.replace(/[/\\]/g, ' ');                      // 2
  s = s.replace(/[:*?"<>|]/g, ' ');                  // 3
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^[.\s]+/, '');                      // 4
  s = s.replace(/[.\s]+$/, '');                      // 5
  if (RESERVED.test(s)) s = `_${s}`;                 // 6
  if (s.length > MAX_TITLE) s = s.slice(0, MAX_TITLE).replace(/[.\s]+$/, '');   // 7
  return s || FALLBACK_TITLE;
}

/**
 * The title of the file at `p`: its own name, without its directory and without
 * its extension, sanitised.
 *
 * THE EXTENSION IS STRIPPED WHETHER OR NOT IT IS ONE WE ADMIT. `basename` +
 * `extname` is what a person means by "the name of the file", and a title of
 * `Song.mp3` for a file called `Song.mp3` would put the extension in the middle
 * of six WAV file names. A name that is ALL extension (`.flac`) keeps its text:
 * `extname('.flac')` is `''`, which is right — that file's name is `.flac`, and
 * the leading-dot strip in `sanitiseTitle` turns it into `flac`.
 *
 * @param {string} p  an absolute path
 * @returns {string}
 */
export function deriveTitle(p) {
  const base = path.basename(String(p ?? '').replace(/[\\/]+$/, ''));
  const ext = path.extname(base);
  return sanitiseTitle(ext ? base.slice(0, -ext.length) : base);
}

// ============================================================================
// 3. THE PATH TOKEN
// ============================================================================
/**
 * The same allowance as `CLAIM_TTL_MS` in `src/main/claims.js`, for the same
 * reason and with the same shape of round trip: the token is minted when the
 * user picks the file and spent when the engine renderer fetches the bytes,
 * which is one message and one `fetch` away. Ten seconds is the allowance for a
 * cold engine on a loaded machine.
 *
 * TRIGGER TO REVISIT: the slice that puts the `/file/` ROOT on the protocol
 * handler is the first one that can MEASURE that round trip. If it turns out to
 * straddle a 109 MB model load, this number is wrong and the measurement should
 * replace it — not a guess on top of a guess.
 */
export const PATH_TOKEN_TTL_MS = 10_000;

/**
 * A one-shot handle on an absolute path.
 *
 * WHY A TOKEN AT ALL, when the path is already known to `main`: the renderer
 * that fetches the bytes must not be able to name a path. `app://workbench/file/
 * <token>` is a URL a renderer may construct only out of something `main` handed
 * it for one file, once — so a compromised renderer asking for
 * `/file/../../../etc/passwd` is asking for a token that was never minted, and
 * gets the same answer as a replay. This is `src/main/claims.js`'s correlation
 * applied to bytes instead of to a capture, and the refusal codes are
 * deliberately the same two words so a reader who has met one has met both.
 *
 *   unknown-token   never minted, or already spent. A replay is this.
 *   expired         minted more than `ttlMs` ago.
 *
 * ONE SHOT, AND THAT IS A CONSTRAINT ON THE FETCH. One token buys one response,
 * so the `/file/` ROOT cannot answer a range request or a retry with the same
 * token — whichever slice serves those bytes owns that decision and must mint
 * per request or say why it does not.
 *
 * @param {object} [opts]
 * @param {number} [opts.ttlMs]
 * @param {() => string} [opts.mintToken]  injectable so a suite can drive a known
 *   token. The default is `crypto.randomUUID()`, which is unguessable; a counter
 *   would make the next token something a renderer could simply ask for.
 * @param {() => number} [opts.now]  injectable so expiry is asserted with a clock
 *   the suite moves rather than with a `sleep`.
 */
export function createPathTokens({
  ttlMs = PATH_TOKEN_TTL_MS,
  mintToken = () => globalThis.crypto.randomUUID(),
  now = Date.now,
} = {}) {
  /** token -> { file, mime, expiresAt } */
  const live = new Map();
  const stats = { minted: 0, spent: 0, refused: 0, revoked: 0, lastRefusal: null };

  const refuse = (code, message) => {
    stats.refused++;
    stats.lastRefusal = `${code}: ${message}`;
    return { ok: false, code, message };
  };

  return {
    stats,
    ttlMs,

    /**
     * Mint a token for ONE fetch of one file. Called by the intake immediately
     * after the picker answers, and by nothing else.
     * @param {string} file  an absolute path
     */
    mint(file) {
      const token = String(mintToken());
      live.set(token, { file, mime: mimeForSourceFile(file), expiresAt: now() + ttlMs });
      stats.minted++;
      return token;
    },

    /**
     * Spend a token. ONE SHOT: the entry is deleted whether or not the read that
     * follows succeeds, for `claims.js`'s reason — a token that survived a
     * failed fetch is a token something other than the intake can retry.
     */
    spend(token) {
      const rec = live.get(token);
      if (!rec) return refuse('unknown-token', 'that path token was never minted, or has already been spent');
      live.delete(token);
      if (rec.expiresAt <= now()) return refuse('expired', `that path token is older than ${ttlMs} ms`);
      stats.spent++;
      return { ok: true, file: rec.file, mime: rec.mime };
    },

    /**
     * Drop everything. A token must not outlive the gesture that made it, which
     * is `claims.js`'s rule and is the same rule here: choosing a different file,
     * closing the deck and quitting all end the gesture that named this path.
     */
    revokeAll(why = 'revoked') {
      const n = live.size;
      live.clear();
      if (n) { stats.revoked += n; stats.lastRefusal = `revoked ${n}: ${why}`; }
      return n;
    },

    /** For the gate and for a person reading a console. Never a decision. */
    inspect: () => ({ live: live.size }),
  };
}

// ============================================================================
// 4. THE INTAKE
// ============================================================================
/**
 * WHERE THE EXPORT FOLDER IS REMEMBERED, and the area is the whole point.
 *
 * `src/main/storage.js`: *"`'local'` outlives the browser and `'session'` does
 * not... a preference must survive a restart, and a refusal to arm must not."*
 * The export folder is the first kind. A folder kept in `session` would be asked
 * for again on every launch, which is the defect this constant exists to name —
 * and it is the mutation `tools/suites/export.mjs` watches red for it.
 */
export const EXPORT_FOLDER_AREA = 'local';
export const EXPORT_FOLDER_KEY = 'exportFolder';

/**
 * The options the REAL `dialog.showOpenDialog` is opened with, frozen and
 * exported so the gate asserts the app's own constant rather than a copy of it.
 *
 * `createDirectory` is not decoration: the folder a person wants for stems
 * usually does not exist yet, and a picker that cannot make one sends them to a
 * file manager mid-export.
 */
export const FOLDER_DIALOG = Object.freeze({
  title: 'Choose where stems are exported',
  buttonLabel: 'Export here',
  properties: Object.freeze(['openDirectory', 'createDirectory']),
});

/** Likewise for the source picker. `openFile`, singular — one Source at a time. */
export const FILE_DIALOG = Object.freeze({
  title: 'Choose an audio file',
  buttonLabel: 'Open',
  filters: SOURCE_FILTERS,
  properties: Object.freeze(['openFile']),
});

/**
 * @param {object} o
 * @param {typeof import('electron').dialog} o.dialog  electron's own module, handed
 *   in by `src/main/main.js`. See the header: this is not a test seam.
 * @param {() => object|null} o.window  the window a picker belongs to, read at CALL
 *   time — a captured window would be a stale one after the first re-create.
 * @param {ReturnType<import('./storage.js').createStorage>} o.storage
 * @param {ReturnType<createPathTokens>} o.tokens
 */
export function createFileIntake({ dialog, window: windowOf, storage, tokens }) {
  const stats = {
    folderAsks: 0,          // REAL invocations of dialog.showOpenDialog for a folder
    fileAsks: 0,            // ...and for a file
    folderFromMemory: 0,    // exports that needed no picker at all
    remembered: 0,          // successful picks written to the `local` area
    joinedPending: 0,       // requests that joined an ask already in flight
    unreadable: 0,          // the `local` area could not be read (see below)
    refused: 0,
    lastRefusal: null,
    /** The options the last REAL invocation was made with. Read by the gate. */
    lastFolderOptions: null,
  };

  const refuse = (code, message) => {
    stats.refused++;
    stats.lastRefusal = `${code}: ${message}`;
    return { ok: false, code, message };
  };

  /** The one ask that may be in flight. See `ensureExportFolder`. */
  let pending = null;

  /**
   * The remembered folder, or null — and the two ways of having none are told
   * apart rather than conflated.
   *
   * A MISSING KEY is the ordinary case and answers null. A `local` area that
   * could not be READ throws (`storage.js`: *"a preference silently reset to
   * default is indistinguishable from one the user chose"*), and the honest
   * response to "we cannot tell" is to ASK — not to treat an unreadable file as
   * "the user never chose a folder" and not to fail the export. It is counted,
   * so a run that asked for that reason says so in its own numbers.
   *
   * A folder that is no longer THERE also answers null. The user may have
   * deleted or unmounted it since, and writing six stems into a path that no
   * longer exists is a failure at the end of a long operation rather than a
   * question at the start of it.
   */
  function rememberedFolder() {
    let dir = null;
    try {
      dir = storage.get(EXPORT_FOLDER_AREA, EXPORT_FOLDER_KEY);
    } catch (err) {
      stats.unreadable++;
      stats.lastRefusal = `unreadable: ${(err && err.message) || err}`;
      return null;
    }
    if (typeof dir !== 'string' || !dir) return null;
    try { if (!fs.statSync(dir).isDirectory()) return null; } catch { return null; }
    return dir;
  }

  /**
   * THE REAL INVOCATION, AND THE ONLY ONE. The counter is incremented HERE,
   * beside the call, so what the gate reads is a count of times this app asked
   * the operating system for a folder — not a count of times something replaced
   * the picker was called. The options are recorded for the same reason: a
   * picker opened with `openFile` would be asked exactly once too.
   */
  async function askForFolder() {
    stats.folderAsks++;
    stats.lastFolderOptions = { ...FOLDER_DIALOG, properties: [...FOLDER_DIALOG.properties] };
    const parent = windowOf && windowOf();
    const r = parent
      ? await dialog.showOpenDialog(parent, stats.lastFolderOptions)
      : await dialog.showOpenDialog(stats.lastFolderOptions);
    const dir = r && !r.canceled && Array.isArray(r.filePaths) ? r.filePaths[0] : null;
    if (!dir) return refuse('cancelled', 'no folder was chosen, so there is nowhere to export to');
    storage.set(EXPORT_FOLDER_AREA, EXPORT_FOLDER_KEY, dir);
    stats.remembered++;
    return { ok: true, dir, asked: true };
  }

  return {
    stats,

    /**
     * INSTRUMENT, not behaviour. Answers whether this intake is holding the
     * module the caller passes — which is how `tools/suites/export.mjs` proves
     * the app under test is driving electron's own `dialog` and that the count
     * below is therefore a count of real native pickers. It decides nothing.
     */
    usesDialog: (d) => d === dialog,

    /**
     * THE FOLDER IS ASKED FOR EXACTLY ONCE, and "once" has two halves.
     *
     * ACROSS RUNS: the answer is written to the `local` area, so the second
     * export — and every export after a restart — reads it back and opens no
     * picker at all. Deleting the read below is how this becomes "once per
     * export", which is the defect the gate's count catches.
     *
     * WITHIN ONE RUN: a second request that arrives while a picker is already up
     * JOINS it rather than opening a second one. Two stacked native modals is
     * not a cosmetic bug — the second one is answered by a user who thinks they
     * are answering the first, and the export they answered for is not the one
     * that gets the folder.
     *
     * @returns {Promise<{ok: true, dir: string, asked: boolean} | {ok: false, code: string, message: string}>}
     */
    async ensureExportFolder() {
      const dir = rememberedFolder();
      if (dir) { stats.folderFromMemory++; return { ok: true, dir, asked: false }; }
      if (pending) { stats.joinedPending++; return pending; }
      const p = askForFolder();
      // Cleared on BOTH settlements, and by assignment rather than by `finally`,
      // so a refused pick leaves no picker "in flight" for the next export to
      // join — which would be an export that never asks and never resolves.
      pending = p.then(
        (r) => { pending = null; return r; },
        (e) => { pending = null; throw e; },
      );
      return pending;
    },

    /**
     * The File source's own picker.
     *
     * THE ALLOWLIST IS CHECKED AFTER THE PICKER ANSWERS, and that is not
     * belt-and-braces: `filters` narrows what is easy to browse to, and on GTK a
     * user (or this app's own gate) can press Ctrl+L and type any path at all.
     * The refusal is a REFUSAL rather than a silent nothing, because a picker
     * that closes and produces no outcome is the defect `src/renderer/chrome.js`
     * was rewritten to fix.
     */
    async chooseSourceFile() {
      stats.fileAsks++;
      const parent = windowOf && windowOf();
      const opts = { ...FILE_DIALOG, properties: [...FILE_DIALOG.properties] };
      const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
      const file = r && !r.canceled && Array.isArray(r.filePaths) ? r.filePaths[0] : null;
      if (!file) return refuse('cancelled', 'no file was chosen');
      if (!isAllowedSourceFile(file)) {
        return refuse('not-audio', `${path.basename(file)} is not a kind of audio this Source takes `
          + `- it reads ${Object.keys(SOURCE_TYPES).join(' ')}`);
      }
      return {
        ok: true,
        file,
        title: deriveTitle(file),
        mime: mimeForSourceFile(file),
        token: tokens.mint(file),
        ttlMs: tokens.ttlMs,
      };
    },

    /** For the gate and for a person reading a console. Never a decision. */
    inspect: () => ({ remembered: rememberedFolder(), asking: pending !== null, tokens: tokens.inspect() }),
  };
}
