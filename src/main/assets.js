/**
 * What `app://workbench/<path>` means on disk, and the headers every response
 * carries.
 *
 * NO `electron` IMPORT IN THIS FILE, ON PURPOSE — same reason as
 * `navigation.js`: path containment is a table plus one comparison, it is the
 * other place where a mistake is an arbitrary-file-read, and it is worth
 * asserting in plain node. `src/main/protocol.js` is the electron half.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ROOTS ARE A LIST AND NOT ONE DIRECTORY
 * ---------------------------------------------------------------------------
 * docs/HOST-DESIGN.md §12 puts our pages in `src/renderer/` and the vendored
 * unit in `vendor/`, and §1.1 gives them ONE origin: the engine page is
 * `app://workbench/engine.html` and the deck is
 * `app://workbench/vendor/stem-splitter-live/extension/ui/embed.html`. One
 * origin over two directories is what a prefix table is for. The alternative —
 * serving the repository root — would put `package.json`, `.git` and every
 * measurement in `spike/results` behind a `fetch()` from a renderer.
 */
import path from 'node:path';

/** The origin. `standard: true` in the scheme registration is what makes it one. */
export const APP_SCHEME = 'app';
export const APP_HOST = 'workbench';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/**
 * Content types by extension.
 *
 * `.wasm` -> `application/wasm` is NOT cosmetic: ORT streams its wasm with
 * `WebAssembly.instantiateStreaming`, which REFUSES any other type, and the
 * throw surfaces several layers from the mistake. `.js`/`.mjs` ->
 * `text/javascript` for the same class of reason: a module script served as
 * `application/octet-stream` is blocked before it runs.
 */
export const TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.onnx': 'application/octet-stream',
});

export const contentType = (file) => TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';

/**
 * The headers on EVERY response, and the two that carry the whole of §2.
 *
 * COOP `same-origin` + COEP `require-corp` are what make the document
 * cross-origin isolated, which is what makes `SharedArrayBuffer` exist, which is
 * what the engine's capture ring and ORT's threaded wasm are built on. Measured
 * both ways in HOST-DESIGN.md §0 P2: with them, `crossOriginIsolated === true`
 * and a module worker can `Atomics.store` into a posted SAB; without them,
 * `SharedArrayBuffer is not defined` — in the document AND in the worker.
 *
 * CORP `same-origin` is the third: under `require-corp` every subresource must
 * opt in, and we serve all of them, so the opt-in is unconditional here.
 *
 * COEP DOES NOT REACH youtube.com. The source view is a sibling
 * `WebContentsView` with its own top-level document in its own session — not a
 * subresource and not an iframe of ours — so `require-corp` has no opinion about
 * it. That is the strongest practical argument for a view over an iframe, and it
 * is written here because the opposite choice fails in a way that looks like
 * YouTube's fault.
 */
export const ISOLATION_HEADERS = Object.freeze({
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
  'cross-origin-resource-policy': 'same-origin',
});

/**
 * `'wasm-unsafe-eval'` is REQUIRED for ORT to compile its wasm under a
 * restrictive `script-src`; without it the compile throws and the message is
 * about CSP rather than about wasm. Flagged `[unknown]` in HOST-DESIGN.md §9 R4
 * — it is reasoned from the CSP spec and has not been run against ORT on this
 * box, because ORT is not vendored yet.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * A HANDLE ROOT — the second kind of root, and the whole of the `/file/` slice.
 *
 * ---------------------------------------------------------------------------
 * WHY A LOCAL FILE IS NOT A DIRECTORY ROOT
 * ---------------------------------------------------------------------------
 * Every root above maps a URL prefix onto ONE directory and contains the tail
 * inside it. A file the user picked is not in any such directory: it is at an
 * arbitrary absolute path anywhere on the machine, and there is no directory to
 * be contained in. So `/file/` carries a RESOLVER instead of a `dir`, and the
 * tail of the URL is not a path at all — it is an opaque one-shot handle that
 * `src/main/files.js` minted for exactly one file (`createPathTokens()`).
 *
 * THE CONTAINMENT PROPERTY IS THEREFORE A DIFFERENT ONE, and it is stronger
 * rather than weaker: **no path is ever derived from the URL.** A renderer
 * asking for `/file/../../../etc/passwd` is asking for a handle nobody minted,
 * and a `Map` lookup answers it — there is no `path.resolve` on the request side
 * to get wrong. That is why the refusal below is `unknown-token` and not
 * `escapes`: the string never became a path.
 *
 * RESOLVING A HANDLE SPENDS IT. `resolveAppPath` is otherwise pure, and this
 * root makes it not — deliberately, because the one-shot property has to be
 * enforced at the moment the bytes are about to be served rather than a layer
 * away where a retry could slip between the two. So `src/main/protocol.js` calls
 * this EXACTLY ONCE PER REQUEST, and one handle buys one response of any method:
 * a `HEAD` spends it too, because a `HEAD` is a response. Nothing should probe a
 * `/file/` handle — the response carries `content-length`, which is what a probe
 * would have been for.
 *
 * @param {{prefix: string, resolve: (handle: string) => object}} hit
 * @param {string} tail  everything after the prefix, already decoded
 * @param {string} rel   the whole decoded path, for the refusal message
 * @returns {{file: string, mime: string, root: string} | {status: number, why: string}}
 *
 * THE FOUR REFUSALS:
 *
 *  1. A TAIL THAT IS NOT ONE COMPONENT — empty, or carrying a `/`. Refused
 *     WITHOUT CONSULTING THE RESOLVER, so a shape that is trying to be a path
 *     never reaches the token store at all.
 *  2. A HANDLE THE RESOLVER REFUSES — never minted, already spent, or expired.
 *     All of them answer 404 and carry the resolver's own code, because a
 *     replay and a forgery are the same event to anyone outside and telling
 *     them apart would say whether a handle had ever existed.
 *  3. A RESOLVED PATH THAT IS NOT ABSOLUTE. There is no root to contain it in,
 *     so "absolute" is the only shape this can insist on, and insisting is
 *     cheaper than discovering later what a relative path resolved against.
 *  4. A FILE WHOSE TYPE THE RESOLVER CANNOT NAME. `src/main/files.js` answers
 *     `mime: null` for anything outside the File source's allowlist, and its
 *     header says why there is no default: *"a byte stream served as
 *     `application/octet-stream` is a byte stream the renderer has to sniff, and
 *     an admitted file whose type we cannot name is a hole in the allowlist
 *     rather than a file to guess about."* 403 rather than 404 — the handle was
 *     real, the file is not one this Source takes.
 */
function resolveHandle(hit, tail, rel) {
  if (!tail || tail.includes('/')) {
    return { status: 404, why: `'${rel}' is not one ${hit.prefix} handle` };
  }
  const r = hit.resolve(tail);
  if (!r || r.ok !== true) {
    const code = (r && r.code) || 'refused';
    const why = (r && r.message) || `${hit.prefix} refused that handle`;
    return { status: 404, why: `${code}: ${why}` };
  }
  if (typeof r.file !== 'string' || !path.isAbsolute(r.file)) {
    return { status: 403, why: `${hit.prefix} resolved to something that is not an absolute path` };
  }
  if (!r.mime) {
    return { status: 403, why: `${hit.prefix} will not serve a file whose type it cannot name` };
  }
  return { file: r.file, mime: r.mime, root: hit.prefix };
}

/**
 * Resolve one `app://` request to a file, or to a refusal.
 *
 * @param {string} urlHost   `new URL(req.url).hostname`
 * @param {string} urlPath   `new URL(req.url).pathname` — still percent-encoded
 * @param {({prefix: string, dir: string} | {prefix: string, resolve: Function})[]} roots
 *   longest prefix wins. A root is either a DIRECTORY (`dir`, absolute) or a
 *   HANDLE RESOLVER (`resolve`) — see `resolveHandle` above.
 * @returns {{file: string, root: string, mime?: string} | {status: number, why: string}}
 *
 * THE THREE REFUSALS, and each one is an assertion in `tools/suites/shell.mjs`:
 *
 *  1. A HOST THAT IS NOT `workbench`. `app://anything-else/…` is a different
 *     origin to Chromium and would be a second, unconfigured one of ours.
 *  2. A PATH THAT ESCAPES ITS ROOT. `new URL()` normalises a literal `../`
 *     away for a standard scheme, so the only way one arrives is
 *     percent-encoded (`%2e%2e%2f`) — which is exactly why the check is after
 *     `decodeURIComponent` and is a containment test on the RESOLVED path
 *     rather than a scan of the requested one.
 *  3. A NUL BYTE, which truncates a path in some syscalls and not in the string
 *     that was checked.
 *
 * A HANDLE ROOT HAS FOUR MORE, and they are `resolveHandle`'s.
 */
export function resolveAppPath(urlHost, urlPath, roots) {
  if (urlHost !== APP_HOST) return { status: 404, why: `unknown app host '${urlHost}'` };

  let rel;
  try { rel = decodeURIComponent(urlPath); } catch { return { status: 400, why: 'undecodable path' }; }
  if (rel.includes('\0')) return { status: 400, why: 'NUL in path' };
  if (rel === '/' || rel === '') rel = '/index.html';

  const hit = [...roots].sort((a, b) => b.prefix.length - a.prefix.length)
    .find((r) => rel === r.prefix || rel.startsWith(r.prefix));
  if (!hit) return { status: 404, why: `no root matches '${rel}'` };

  const tail = rel.slice(hit.prefix.length).replace(/^\/+/, '');

  // A ROOT IS A DIRECTORY OR A RESOLVER, never both and never neither. The
  // branch is here rather than in `src/main/protocol.js` so that the whole of
  // "what does this URL mean on disk" stays in one electron-free function that a
  // suite can drive as a pure function — which is how `/model/` and `/vendor/`
  // are gated, and there is no reason for `/file/` to be gated any other way.
  if (typeof hit.resolve === 'function') return resolveHandle(hit, tail, rel);

  const dir = path.resolve(hit.dir);
  const file = path.resolve(dir, tail);
  // `startsWith(dir)` ALONE IS THE BUG: `/a/b-evil` starts with `/a/b`. The
  // separator is the whole check.
  if (file !== dir && !file.startsWith(dir + path.sep)) {
    return { status: 403, why: `'${rel}' escapes ${hit.prefix}` };
  }
  return { file, root: hit.prefix };
}
