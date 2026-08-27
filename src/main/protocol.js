/**
 * The `app://` scheme: one privileged origin for our pages and the vendored
 * unit, cross-origin isolated on every response.
 *
 * This is the electron half; the table and the containment rule are in
 * `src/main/assets.js`, which imports nothing and is asserted directly.
 *
 * ---------------------------------------------------------------------------
 * WHY A SCHEME AT ALL, AND WHY THESE FOUR PRIVILEGES
 * ---------------------------------------------------------------------------
 * `offscreen/engine.js` builds `SharedArrayBuffer`s and asserts on the
 * CONSTRUCTOR (`:112`), never on `crossOriginIsolated` — because on an
 * extension page SAB exists without isolation. A second Host gets no such gift,
 * so isolation is the Host's job (VENDORING.md, "You must arrange cross-origin
 * isolation"). `file://` cannot be isolated and has no origin worth the name;
 * a localhost server would be a listening socket this product has no reason to
 * open. A privileged custom scheme is the remaining answer, and P2 measured it
 * working.
 *
 *   standard        a real origin (`app://workbench`) — storage, workers and
 *                   module resolution all key off it
 *   secure          a secure context — AudioWorklet, OPFS, WebGPU and
 *                   getDisplayMedia all require one
 *   supportFetchAPI named verbatim in `shared/host.js`'s `assetUrl` obligation
 *                   2: `workers/workerbackend.js:214` probes the ORT bundle
 *                   with `fetch(url, {method:'HEAD'})`, and a scheme `fetch`
 *                   refuses turns that diagnosis into a false report about a
 *                   file that is present
 *   stream          the 109 MB model body (P4: 114,559,139 bytes in 179 ms)
 *   corsEnabled     the unit's workers fetch their own assets same-origin
 */
import { protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

import {
  APP_SCHEME, APP_HOST, APP_ORIGIN, CSP, ISOLATION_HEADERS, contentType, resolveAppPath,
} from './assets.js';

export { APP_SCHEME, APP_HOST, APP_ORIGIN };

/** `app://workbench/<p>`, with `p` used as-is (callers pass already-safe paths). */
export const appUrl = (p = '') => `${APP_ORIGIN}/${String(p).replace(/^\/+/, '')}`;

/**
 * MUST be called at module scope, before `app.whenReady()`. It is the only
 * ordering constraint in the main process and Electron throws if it is late.
 */
export function registerAppSchemeAsPrivileged() {
  protocol.registerSchemesAsPrivileged([{
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  }]);
}

/**
 * Install the handler on ONE session — the default one, which is where the
 * chrome, deck and engine renderers live. `persist:youtube` deliberately does
 * NOT get it: a page from youtube.com that could `fetch('app://workbench/…')`
 * would be able to read the vendored tree and, once §7 lands, the model.
 *
 * @param {Electron.Session} ses
 * @param {{prefix: string, dir: string}[]} roots
 * @returns {{stats: {served: number, refused: number, bytes: number}}}
 */
export function installAppProtocol(ses, roots) {
  const stats = { served: 0, refused: 0, bytes: 0, lastRefusal: null };

  ses.protocol.handle(APP_SCHEME, async (req) => {
    const u = new URL(req.url);
    const hit = resolveAppPath(u.hostname, u.pathname, roots);
    const headers = { ...ISOLATION_HEADERS, 'content-security-policy': CSP };

    if (hit.status) {
      stats.refused++;
      stats.lastRefusal = `${hit.status} ${hit.why}`;
      return new Response(hit.why, { status: hit.status, headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' } });
    }

    let st;
    try { st = await fs.promises.stat(hit.file); } catch {
      stats.refused++;
      stats.lastRefusal = `404 ${u.pathname}`;
      return new Response('not found', { status: 404, headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' } });
    }
    if (!st.isFile()) {
      stats.refused++;
      stats.lastRefusal = `404 not a file: ${u.pathname}`;
      return new Response('not found', { status: 404, headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' } });
    }

    /**
     * THE TYPE COMES FROM THE ROOT WHEN THE ROOT KNOWS IT.
     *
     * `TYPES` in `src/main/assets.js` is keyed by the extensions OUR OWN pages
     * and the vendored tree are made of, and it has no audio in it at all — an
     * `.mp3` through it would be `application/octet-stream`, which is a byte
     * stream the renderer has to sniff. A `/file/` handle resolves with the MIME
     * the File source's allowlist named for that extension
     * (`src/main/files.js` `mimeForSourceFile()`), and `resolveHandle` has
     * already refused the handle if there was none. So the allowlist decides the
     * type for a picked file and the extension table decides it for everything
     * else, and neither one guesses.
     */
    const full = { ...headers, 'content-type': hit.mime || contentType(hit.file), 'content-length': String(st.size) };
    stats.served++;

    // A `HEAD` answers `workerbackend.js:214`'s probe without reading a byte —
    // P4 measured that shape against the 109 MB model. IT IS NOT A FREE LOOK AT A
    // `/file/` HANDLE: the handle was spent by `resolveAppPath` above, so a HEAD
    // buys the one response that handle was worth and the bytes are then gone.
    // Nothing probes a `/file/` handle, and nothing should — `content-length` is
    // on the real response, which is what a probe would have been for.
    if (req.method === 'HEAD') return new Response(null, { headers: full });

    stats.bytes += st.size;
    // Streamed, not `readFileSync`'d: `stream: true` above plus a web stream body
    // is what turns the model into 1383 chunks instead of one 109 MB buffer in
    // the main process. NOTE: no `Range` support — nothing in this product seeks
    // over `app://` yet, and a media element that did would need it.
    //
    // AND FOR A `/file/` HANDLE THAT IS A CONSTRAINT RATHER THAN A GAP. A ranged
    // read is several requests, and a one-shot handle is worth one; so the engine
    // renderer must `fetch()` the bytes whole — which is what it does with the
    // model — and must never point a media element at a `/file/` URL. A Host that
    // wanted the second thing would have to mint per request and say why.
    return new Response(Readable.toWeb(fs.createReadStream(hit.file)), { headers: full });
  });

  return { stats };
}
