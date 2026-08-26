/**
 * The capture grant — the one capability this whole product exists to broker.
 *
 * `setDisplayMediaRequestHandler` is answered in MAIN with the source view's
 * `mainFrame`, for both audio and video. That shape is not a guess: the spike
 * measured it end to end (docs/spike-capture-mute.md, variant b) and P3 measured
 * that it crosses the session boundary — a renderer on the DEFAULT session
 * capturing a frame owned by a view on `persist:youtube`, `deviceId
 * web-contents-media-stream://5:1?local_echo=false`, stereo, 44100, all three
 * processing flags false.
 *
 * WHAT MAIN DOES NOT DO: it does not pick the constraints. The renderer must ask
 * for `{ audio: { autoGainControl: false, echoCancellation: false,
 * noiseSuppression: false }, video: true }` and stop the video track itself —
 * the spec forbids an audio-only `getDisplayMedia`, and a naive
 * `getDisplayMedia({audio: true})` yields MONO 48 kHz with AGC that decays the
 * level 17x over 8 s and still looks fine to a careless gate
 * (spike-capture-mute.md Limitation 6). That belongs to the engine's hole
 * module, `offscreen/host.js`, in the next wave.
 */
import { webContents } from 'electron';

/**
 * TWO GATES, ON PURPOSE, AND THE OUTER ONE IS THE POLITE ONE.
 *
 * `display-capture` is refused at the PERMISSION layer for every renderer on
 * this session that is not the engine, so a deck that asked gets a clean
 * `NotAllowedError` and never reaches the request handler. The handler's own
 * `isCaptor` check stays as the inner gate: permission handlers are one
 * `setPermissionRequestHandler` call away from being replaced by a later wave,
 * and the grant itself is the thing that must not be reachable.
 *
 * THE PERMISSION POLICY ON THIS SESSION IS DEFAULT-DENY. Our three renderers
 * are the only pages on it, they are all ours, and none of them needs the
 * camera, the microphone, geolocation, notifications, midi or the clipboard.
 * OPFS, WebGPU and AudioWorklet do not go through this handler at all, so the
 * engine loses nothing. A later wave that needs one of these must add it HERE,
 * by name, rather than by widening the default.
 *
 * @param {Electron.Session} ses            the session the CAPTOR renderer lives in
 * @param {() => Electron.WebFrameMain|null} resolveSourceFrame  read at call time
 * @param {(wc: Electron.WebContents) => boolean} isCaptor
 */
export function installCapturePolicy(ses, resolveSourceFrame, isCaptor) {
  const stats = {
    requests: 0, granted: 0, refused: 0,
    permissionAsks: 0, permissionDenied: 0,
    lastRefusal: null, lastPermissionDenied: null, lastGrantedFrame: null,
  };

  const mayCapture = (wc) => !!wc && isCaptor(wc);

  /**
   * WHAT `getDisplayMedia` LOOKS LIKE AT THE PERMISSION LAYER, MEASURED.
   *
   * Electron 44 / Chromium 152 asks this handler for `permission === 'media'`
   * with `details.mediaTypes === []` — an EMPTY array. A camera or microphone
   * request through `getUserMedia` arrives as the same `'media'` permission with
   * `mediaTypes` naming `'audio'` and/or `'video'`. That empty array is the only
   * thing separating "capture a frame we own" from "turn on the microphone", so
   * it is what the split is made on, and the measurement is recorded here
   * because it is not in Electron's documentation.
   *
   * `'display-capture'` is accepted too: it is the name Electron's own docs use
   * and a version that switches to it must not silently start denying the
   * engine.
   *
   * IF A FUTURE ELECTRON POPULATES `mediaTypes` FOR DISPLAY CAPTURE, this goes
   * DENY, the engine's first capture fails loudly with `NotAllowedError`, and
   * the gate's `capture.fromEngine.ok` assertion goes red. That is the right
   * direction to fail in.
   */
  const isDisplayCaptureAsk = (permission, details) => permission === 'display-capture'
    || (permission === 'media' && Array.isArray(details && details.mediaTypes) && details.mediaTypes.length === 0);

  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    stats.permissionAsks++;
    const ok = isDisplayCaptureAsk(permission, details) && mayCapture(wc);
    if (!ok) {
      stats.permissionDenied++;
      stats.lastPermissionDenied = `${permission} from ${wc ? wc.getURL() : '(no webContents)'}`;
    }
    callback(ok);
  });
  ses.setPermissionCheckHandler((wc, permission) => (permission === 'media' || permission === 'display-capture') && mayCapture(wc));

  ses.setDisplayMediaRequestHandler((request, callback) => {
    stats.requests++;

    // ONLY THE ENGINE MAY CAPTURE. Every renderer on this session shares one
    // handler, and the deck is on it too; a deck that could open a capture would
    // be a second, unowned pipeline on the same source. Cancelling is
    // `callback({})` — an empty grant, which the renderer sees as a rejected
    // promise.
    const asker = frameOwner(request.frame);
    if (!asker || !isCaptor(asker)) {
      stats.refused++;
      stats.lastRefusal = `not the engine: ${request.frame ? request.frame.url : '(no frame)'}`;
      return callback({});
    }

    const frame = resolveSourceFrame();
    if (!frame) {
      stats.refused++;
      stats.lastRefusal = 'no source view';
      return callback({});
    }

    stats.granted++;
    // The id the renderer will see inside `track.getSettings().deviceId`, as
    // `web-contents-media-stream://<id>:<frame>`. Recorded so a gate can prove
    // the grant named the SOURCE view and not some other frame — a handler that
    // answered with the wrong frame captures silence and looks like a bug in the
    // engine.
    stats.lastGrantedFrame = { processId: frame.processId, routingId: frame.routingId };
    callback({ video: frame, audio: frame });
  });

  return { stats };
}

/**
 * `WebFrameMain` -> the `WebContents` that owns it. `webContents.fromFrame` is
 * the documented mapping; `WebFrameMain` itself has no `webContents` property,
 * and reaching for one is a `TypeError` inside a handler whose only failure mode
 * would otherwise be a silent refusal.
 */
function frameOwner(frame) {
  try { return frame ? webContents.fromFrame(frame) : null; } catch { return null; }
}
