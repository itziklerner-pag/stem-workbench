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
 * Resolve one `app://` request to a file, or to a refusal.
 *
 * @param {string} urlHost   `new URL(req.url).hostname`
 * @param {string} urlPath   `new URL(req.url).pathname` — still percent-encoded
 * @param {{prefix: string, dir: string}[]} roots  longest prefix wins; `dir` absolute
 * @returns {{file: string, root: string} | {status: number, why: string}}
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
  const dir = path.resolve(hit.dir);
  const file = path.resolve(dir, tail);
  // `startsWith(dir)` ALONE IS THE BUG: `/a/b-evil` starts with `/a/b`. The
  // separator is the whole check.
  if (file !== dir && !file.startsWith(dir + path.sep)) {
    return { status: 403, why: `'${rel}' escapes ${hit.prefix}` };
  }
  return { file, root: hit.prefix };
}
