/**
 * The SOURCE view's preload — the transport.
 *
 * IT EXPOSES NOTHING ON `window`, BY DESIGN. `contextIsolation: true` plus no
 * `contextBridge.exposeInMainWorld` means youtube.com cannot see or call any of
 * it — the same posture `content.js` has in an isolated world in the extension
 * today. It talks to `main` over its own ipc channels and touches the page's
 * `<video>` directly.
 *
 * ---------------------------------------------------------------------------
 * L1 — THE RULE THIS FILE IS THE TEST OF
 * ---------------------------------------------------------------------------
 * Capture only what the user's own player renders. This file may read
 * `paused`, `currentTime`, `duration`, `ended`, `playbackRate` and `seeking`,
 * and may write `muted`, `currentTime` and `playbackRate`. It must NEVER read
 * `src`, `currentSrc`, `buffered` or `srcObject`, never call `captureStream()`,
 * and never touch a byte of media. The same text scan that gates `content.js`
 * in the extension (`qa/speed-pitch.mjs`-shaped) is to be re-aimed at this file
 * when the transport lands — docs/TESTING.md §5, assertion 9.
 *
 * WHAT IS HERE IN THIS WAVE: nothing. The six `DeckTransport` duties are the
 * next wave's. The file exists, and is wired, so that "the source view runs OUR
 * preload and the page still sees no bridge" is a thing the gate can assert
 * today rather than a thing discovered later.
 */

// Deliberately empty. See above.
