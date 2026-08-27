/**
 * A throwaway TLS host that answers AS the update host — and as one host this
 * app must never talk to.
 *
 * The vendored `tools/host.mjs` does the same trick for the weights, and the
 * mechanism is borrowed verbatim: a self-signed certificate carrying the names,
 * plus `--host-resolver-rules=MAP <name> 127.0.0.1:<port>` so Chromium resolves
 * the real name at this server. What is different is WHY.
 *
 * ---------------------------------------------------------------------------
 * IT EXISTS TO BE EVIDENCE THE INSTRUMENT DID NOT PRODUCE
 * ---------------------------------------------------------------------------
 * `tools/suites/p1.mjs` asserts that the app's own sessions reached exactly one
 * host. The observer that answers that question lives INSIDE the app, so a
 * broken observer and a silent app are the same transcript. `hits` below is the
 * second witness, and it is on the other side of the wire and in another
 * process:
 *
 *   instrument silent + host hit      -> the observer is blind. RED.
 *   instrument saw it + host hit      -> the request really went out.
 *   instrument saw it + host NOT hit  -> the policy really cancelled it.
 *
 * The third line is why the same server answers to a name the app is forbidden
 * to reach: the exclusion and the policy are then measured with the SAME URL
 * through two sessions, and the control can lose.
 *
 * REAL TLS RATHER THAN AN INTERCEPT: the app issues its check through
 * `Session.fetch`, i.e. Chromium's own network stack. There is no Playwright
 * route to fulfil here and no CDP channel to fake one on — the request is real,
 * so the server has to be.
 */
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * @param {string[]} names  hostnames this server answers to. `names[0]` is the
 *                          certificate's CN; every name is a SAN, because
 *                          Chromium has ignored CN-only certificates for years
 *                          and the failure ("ERR_CERT_COMMON_NAME_INVALID") looks
 *                          exactly like a host that was never reached.
 * @param {object|Array} [body]   the JSON every route answers with — an ARRAY for the
 *                              releases LIST endpoint `src/main/update.js` asks for
 */
export async function startP1Host(names, body = { tag_name: 'v0.0.0-fake' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-cert-'));
  const key = path.join(dir, 'k.pem');
  const cert = path.join(dir, 'c.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', cert, '-days', '1', '-subj', `/CN=${names[0]}`,
    '-addext', `subjectAltName=${names.map((n) => `DNS:${n}`).join(',')}`], { stdio: 'ignore' });

  /** every request that actually arrived, `host + path`, in order */
  const hits = [];
  const payload = Buffer.from(JSON.stringify(body));
  const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
    hits.push(`${req.headers.host}${req.url}`);
    res.writeHead(200, {
      'content-type': 'application/json',
      'content-length': String(payload.length),
      // The source view's page is a `file://` origin, so its fetch is
      // cross-origin. Without this the request still LEAVES (which is what the
      // instrument is asked about) but the page never sees the answer, and a
      // reader would spend an hour on a CORS error that is not the subject.
      'access-control-allow-origin': '*',
    });
    res.end(payload);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  return {
    port,
    hits,
    /** how many times `host` was actually reached */
    hitsFor: (host) => hits.filter((h) => h.startsWith(`${host}/`) || h === host).length,
    url: (host, route = '/') => `https://${host}${route}`,
    /**
     * Chromium switches, to be passed on the ELECTRON COMMAND LINE. They are
     * Chromium's, not ours: nothing in `src/` knows this server exists, which is
     * what keeps the app under test the shipping app.
     */
    chromiumArgs: [
      `--host-resolver-rules=${names.map((n) => `MAP ${n} 127.0.0.1:${port}`).join(',')}`,
      '--ignore-certificate-errors',
    ],
    close() { server.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}
