/**
 * THE TRANSPORTS THE OBSERVER CANNOT SEE, TAKEN AWAY FROM THE MAIN PROCESS.
 *
 * `src/main/sessions.js` installs ONE `webRequest.onBeforeRequest` per session
 * and that instrument answers the whole of P1'. It has a hole, and the hole was
 * named in prose in two files for a whole phase without anything acting on it:
 *
 *   `src/main/sessions.js`  — *"node:https from the main process would leave
 *                              Chromium's network stack entirely … A request the
 *                              observer cannot see is the failure mode P1'
 *                              exists to make impossible."*
 *   `src/main/update.js`    — the update check is issued through `Session.fetch`
 *                              *"for its observability rather than for its
 *                              convenience"*.
 *
 * Both sentences are true and NEITHER OF THEM WAS ENFORCED. Two independent
 * audits proved it the same way, in a private copy of this tree: one line —
 * `await fetch('http://127.0.0.1:38517/telemetry-from-main')` in `main.js`, or
 * `fetch('https://example.com/audit-beacon')` — put a real request on a real
 * wire to a second host, the sink logged it, and BOTH `p1` (19 passed, 0 failed)
 * and `smoke` (18 passed, 0 failed) stayed green over it. `CONTRIBUTING.md`
 * states P1' as *"an acceptance test, not a rule enforced by review"*, so review
 * was not the backstop either.
 *
 * ---------------------------------------------------------------------------
 * WHY A GUARD AND NOT ONLY A SCAN
 * ---------------------------------------------------------------------------
 * `tools/suites/p1.mjs` gained the scan both auditors asked for — no
 * `node:http`/`https`/`net`/`tls`/`dgram`/`http2` under `src/`, no bare `fetch(`
 * or `net.request(` under `src/main/`. A scan is the cheap half and it is a
 * claim about SOURCE. This file is the other half and it is a claim about the
 * RUNNING PROCESS: the functions are gone, so the mutation that defeated the
 * gate now throws at the line that wrote it instead of shipping telemetry.
 *
 * Neither half subsumes the other. A scan sees code that is never reached; a
 * guard sees a reach the scan's regex missed (a computed `globalThis['fetch']`,
 * a transitive helper). They fail differently and they are asserted separately.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS TAKEN, AND WHAT IS DELIBERATELY LEFT
 * ---------------------------------------------------------------------------
 * TAKEN — everything in the main process that can OPEN an outbound connection
 * without Chromium: the globals `fetch`, `WebSocket`, `EventSource` and
 * `XMLHttpRequest`; `http.request`/`get` and `https.request`/`get`;
 * `http2.connect`; `net.connect` and `net.createConnection`; `tls.connect`; and
 * `dgram.createSocket`. Each is replaced by a function that throws a named
 * error, and every attempt is COUNTED — `report()` is what `tools/gate/p1.mjs`
 * reads, so "the guard is installed" is a measurement and not a comment.
 *
 * LEFT — `net.Socket.prototype.connect` ON A PIPE. Node's own child-process IPC
 * and every unix-socket consumer go through that method, and a blanket refusal
 * there would break machinery that never touches a network. The wrapper refuses
 * exactly the TCP forms (`connect(port…)`, `connect({port}…)`) and passes a
 * path/fd straight through. `flock`, `xvfb-run` and PipeWire are all in this
 * process tree during a gate run; none of them is a network.
 *
 * LEFT — Chromium. `Session.fetch`, `WebContents` traffic and Electron's own
 * `net` module all enter the stack the observer is installed on, which is the
 * whole point of choosing them. `net.request(` is nevertheless refused BY THE
 * SCAN rather than here: it is observable, so this file has no business
 * breaking it, but "the app has exactly one network transport, spelled in one
 * file" is a smaller thing to keep true than "the app has two".
 *
 * ---------------------------------------------------------------------------
 * IT INSTALLS ON IMPORT, AND IT IS main.js's FIRST IMPORT
 * ---------------------------------------------------------------------------
 * A guard that has to be CALLED is a guard somebody forgets to call, and the
 * window between `import { app } from 'electron'` and a call at the bottom of
 * the import block is a window in which the hazard is back. ESM evaluates a
 * module's dependencies in the order they are declared, so putting this first
 * means it has run before any other module of ours has a body. That ordering is
 * asserted from the source in `tools/suites/p1.mjs`, because it is invisible at
 * runtime once everything is up.
 */
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);

/** Every refusal, in order, so the guard can be shown to have bitten. */
const attempts = [];
/** The names really replaced on this runtime, for the report. */
const poisoned = [];

/** The one sentence a P1' refusal says, wherever it is thrown from. */
export class P1ViolationError extends Error {
  constructor(what) {
    super(`P1' — ${what} is not available in this process. The app's own code talks to exactly one `
      + 'named host (src/main/update.js), through `Session.fetch` on a session the observer in '
      + 'src/main/sessions.js is installed on. A transport that leaves Chromium leaves the '
      + 'instrument, and a request the observer cannot see is the failure P1\' exists to make '
      + 'impossible. See src/main/netguard.js.');
    this.name = 'P1ViolationError';
    this.what = what;
  }
}

function refuse(what) {
  attempts.push({ what, at: Date.now() });
  throw new P1ViolationError(what);
}

/** Replace one own-property of an object with a refusal, and record that we did. */
function take(holder, key, label) {
  let had;
  try { had = holder[key]; } catch { return false; }
  if (had === undefined) return false;
  const fn = function refused() { return refuse(label); };
  try {
    Object.defineProperty(holder, key, { value: fn, writable: true, configurable: true, enumerable: false });
  } catch { return false; }
  poisoned.push(label);
  return true;
}

// ------------------------------------------------------------------ globals
for (const key of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest']) {
  take(globalThis, key, `globalThis.${key}()`);
}

// -------------------------------------------------------- the node builtins
/**
 * `require('node:https')` and `import https from 'node:https'` hand back the
 * SAME exports object, so replacing a method on it covers the default-import
 * form. MEASURED, NOT ASSUMED, for the named-import form too — on this runtime
 * `import { request } from 'node:https'` is a live binding onto that same
 * object and is refused as well, which was checked rather than reasoned about.
 * It is checked and not RELIED ON: that is a property of Node's builtin ESM
 * bridge and not of anything this repository controls, which is why the scan in
 * `tools/suites/p1.mjs` forbids the import itself. The two halves cover each
 * other and both are watched red.
 */
const BUILTINS = [
  ['node:http', ['request', 'get']],
  ['node:https', ['request', 'get']],
  ['node:http2', ['connect']],
  ['node:net', ['connect', 'createConnection']],
  ['node:tls', ['connect']],
  ['node:dgram', ['createSocket']],
];
for (const [name, keys] of BUILTINS) {
  let mod;
  try { mod = require_(name); } catch { continue; }
  for (const key of keys) take(mod, key, `${name.slice(5)}.${key}()`);
}

/**
 * THE ONE WRAPPER RATHER THAN A REPLACEMENT — see the header. A pipe is not a
 * network and Node's own plumbing uses this method; a TCP port is, and there is
 * no legitimate caller of it in this process.
 */
{
  let net;
  try { net = require_('node:net'); } catch { net = null; }
  const proto = net && net.Socket && net.Socket.prototype;
  if (proto && typeof proto.connect === 'function') {
    const original = proto.connect;
    proto.connect = function connect(...args) {
      const a = args[0];
      const tcp = typeof a === 'number'
        || (typeof a === 'string' && /^\d+$/.test(a))
        || (a && typeof a === 'object' && a.port !== undefined && a.path === undefined);
      if (tcp) return refuse('net.Socket.prototype.connect() to a TCP port');
      return original.apply(this, args);
    };
    poisoned.push('net.Socket.prototype.connect() to a TCP port');
  }
}

/**
 * WHAT THE GUARD DID, for `tools/gate/p1.mjs` to write into its report and for
 * `tools/suites/p1.mjs` to judge in another process. A report the probe could
 * have invented would be worth nothing, so `attempts` is a LEDGER of refusals
 * that really happened rather than a boolean somebody set.
 */
export function report() {
  return {
    installed: poisoned.length > 0,
    poisoned: [...poisoned],
    attempts: attempts.map((a) => ({ ...a })),
    /** `fetch` really is not the platform's any more — read, not remembered. */
    fetchIsOurs: typeof globalThis.fetch === 'function' && globalThis.fetch.name === 'refused',
  };
}
