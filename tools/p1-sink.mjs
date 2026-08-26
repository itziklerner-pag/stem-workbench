/**
 * A PLAIN HTTP SINK ON 127.0.0.1, for the half of P1' that Chromium cannot
 * answer.
 *
 * `tools/p1-host.mjs` is the OTHER witness — a TLS server wearing the update
 * host's certificate, reached through `--host-resolver-rules`, which is a
 * Chromium switch and therefore invisible to anything that leaves Chromium.
 * That is precisely the traffic this file is here to catch: a `fetch()` or a
 * `node:https.request()` from the MAIN PROCESS resolves through the OS and
 * would sail past both the resolver rule and `session.webRequest`.
 *
 * So this one is dumb on purpose: a real TCP listener on a real loopback port,
 * with NO name-resolution trick in front of it. Anything in the app that can
 * open a socket can reach it, which is what makes "it recorded nothing" a fact
 * about the app rather than about a certificate or a hosts file.
 *
 * ---------------------------------------------------------------------------
 * IT COUNTS CONNECTIONS AS WELL AS REQUESTS, AND THAT IS NOT BELT-AND-BRACES
 * ---------------------------------------------------------------------------
 * The probe attempts `net.connect` and `tls.connect` as well as the HTTP
 * transports. A raw socket that opened and sent nothing would leave an HTTP
 * server with no request to log and a silent transcript — the same transcript
 * as a socket that was refused. `connections` is what tells those apart.
 */
import http from 'node:http';

/**
 * @returns {Promise<{port: number, connections: object[], requests: string[], close(): void}>}
 */
export async function startP1Sink() {
  /** every TCP connection that was accepted, whether or not it spoke HTTP */
  const connections = [];
  /** every HTTP request line that arrived, `METHOD /path` */
  const requests = [];

  const server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.writeHead(200, { 'content-type': 'text/plain', 'content-length': '2' });
    res.end('ok');
  });
  server.on('connection', (socket) => {
    connections.push({ at: Date.now(), remotePort: socket.remotePort });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  return {
    port,
    url: (route = '/') => `http://127.0.0.1:${port}${route}`,
    connections,
    requests,
    close() { server.close(); server.closeAllConnections?.(); },
  };
}
