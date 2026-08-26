/**
 * THE ONE-SHOT CAPTURE CLAIM — what a `sourceToken` IS in this product.
 *
 * NO `electron` IMPORT IN THIS FILE, ON PURPOSE — the same reason
 * `navigation.js` and `assets.js` have none: this is the correlation the whole
 * capture path's security rests on, it is a Map, a clock and a token minter, and
 * it is worth asserting in plain node rather than only through a launch.
 * `src/main/capture.js` is the electron half and takes one of these as an
 * argument.
 *
 * ---------------------------------------------------------------------------
 * WHY IT EXISTS AT ALL
 * ---------------------------------------------------------------------------
 * `vendor/…/shared/host.js` says the token is opaque to the unit: "the Host
 * mints it and the engine only carries it back". In the extension the token WAS
 * the grant — `chrome.tabCapture.getMediaStreamId` returns something
 * `getUserMedia` consumes directly, and the Host cannot capture anything the
 * grant does not name. Here `getDisplayMedia` carries no token at all: the grant
 * is a decision `main` makes at request time, so the correlation has to be built
 * out of band, and the correlation IS the security property — THE ENGINE CANNOT
 * CAPTURE ANYTHING `main` DID NOT ARM. docs/ARCHITECTURE.md §5 R4's mechanism (a
 * capture needs a browser-level invocation) does not exist here; its consequence
 * is kept deliberately.
 *
 * THE FOUR REFUSALS, each with a code the engine prints in its own error:
 *
 *   unknown-token    never minted, or already spent. A replay is this.
 *   expired          minted more than `ttlMs` ago
 *   already-pending  a second spend while one request is still in flight
 *   (revoked)        the gesture it belonged to ended — the token is simply gone,
 *                    so the engine sees `unknown-token`, which is the truth
 *
 * WHAT THIS IS NOT. It is not a permission check: `installCapturePolicy` refuses
 * every renderer that is not the engine, at the permission layer and again in
 * the request handler. This answers a different question — "did the arm path ask
 * for THIS capture, just now?"
 */

/**
 * How long a minted claim is worth anything.
 *
 * docs/HOST-DESIGN.md §5.2: "long enough for the engine to be woken and to load,
 * short enough that a token cannot outlive the gesture". The engine window is
 * created at boot and stays up, so the real round trip is milliseconds; ten
 * seconds is the allowance for a cold engine on a loaded machine.
 */
export const CLAIM_TTL_MS = 10_000;

/**
 * @param {object} [opts]
 * @param {number} [opts.ttlMs]
 * @param {() => string} [opts.mintToken]  injectable so a suite can drive a known
 *   token. The default is `crypto.randomUUID()` — unguessable, which is what a
 *   renderer would otherwise have to forge.
 * @param {() => number} [opts.now]  injectable so expiry is asserted with a clock
 *   the suite moves, not with a `sleep`. A stopwatch cannot carry this claim.
 */
export function createCaptureClaims({
  ttlMs = CLAIM_TTL_MS,
  mintToken = () => globalThis.crypto.randomUUID(),
  now = Date.now,
} = {}) {
  /** token -> { expiresAt, sourceWcId, deck } */
  const live = new Map();
  /** the one claim a `getDisplayMedia` request may consume, or null. */
  let pending = null;
  const stats = { minted: 0, spent: 0, consumed: 0, refused: 0, revoked: 0, lastRefusal: null };

  const refuse = (code, message) => {
    stats.refused++;
    stats.lastRefusal = `${code}: ${message}`;
    return { ok: false, code, message };
  };

  return {
    stats,

    /**
     * Mint a token for ONE capture, bound to the source view it is about.
     * Called by the arm path, immediately before `CAPTURE_START` goes out.
     */
    mint({ sourceWcId = null, deck = null } = {}) {
      const token = String(mintToken());
      live.set(token, { expiresAt: now() + ttlMs, sourceWcId, deck });
      stats.minted++;
      return token;
    },

    /**
     * Spend a token. ONE SHOT: the entry is deleted whether or not the
     * `getDisplayMedia` that follows succeeds, because a token that survived a
     * failed capture is a token something other than the arm path can retry.
     */
    spend(token) {
      const rec = live.get(token);
      if (!rec) return refuse('unknown-token', 'that capture claim was never minted, or has already been spent');
      live.delete(token);
      if (rec.expiresAt <= now()) return refuse('expired', `that capture claim is older than ${ttlMs} ms`);
      if (pending) return refuse('already-pending', 'a capture request from a previous claim is still in flight');
      pending = { token, ...rec, at: now() };
      stats.spent++;
      return { ok: true };
    },

    /**
     * Consume the pending claim, or null. Called by the display-media request
     * handler and by nothing else — one claim, one grant.
     */
    takePending() {
      if (!pending) return null;
      if (pending.expiresAt <= now()) { pending = null; return null; }
      const p = pending;
      pending = null;
      stats.consumed++;
      return p;
    },

    /**
     * Drop everything. Disarm, a source view that went away, and quit all call
     * this: a claim must not outlive the gesture that made it. That is the
     * property the arm epoch in HOST-DESIGN.md §5.2 was to buy, spelled here as
     * a revocation because there is no arm counter to compare against until the
     * arm gesture (§6) lands — and a counter nobody increments gates nothing.
     */
    revokeAll(why = 'revoked') {
      const n = live.size + (pending ? 1 : 0);
      live.clear();
      pending = null;
      if (n) { stats.revoked += n; stats.lastRefusal = `revoked ${n}: ${why}`; }
      return n;
    },

    /** For the gate and for a person reading a console. Never a decision. */
    inspect: () => ({ live: live.size, pending: pending ? pending.token : null }),
  };
}
