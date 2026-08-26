# The Electron Host

How `stem-workbench` supplies what the vendored unit — the engine and the deck
from `stem-splitter-live` — cannot obtain for itself. This is the design every
implementer in step 3 builds from.

**Status: design.** No product code exists yet. Everything below is either
(a) **measured on this machine** and cited with its number, (b) **read out of the
unit** and cited by file and line, or (c) **decided**, with the alternative
rejected in writing. Where it is none of those it says *unknown* and is in
[§9 What could go wrong](#9-what-could-go-wrong). The distinction is not
decoration: `docs/spike-capture-mute.md` had to retract a PASS, and the reason it
could be retracted at all is that it said which of the three each claim was.

**Platform honesty, standing.** The verification platform for this whole phase
is **Linux**. `desktop-app-plan.md` §14 puts macOS first and its pass condition
is a notarized macOS pre-release; there is no Mac and no Apple credential on this
box, so the substitute pass condition is a runnable Linux app proven by an
automated smoke, plus electron-builder configuration and CI for macOS and Windows
that is **written and never built or signed here**. Every claim below is marked
`[measured]`, `[read]`, `[decided]` or `[unknown]`, and no macOS claim is any of
the first three.

## What this document decides

| § | question | one-line answer |
|---|---|---|
| 1 | process and renderer topology | one `BaseWindow`, three `WebContentsView`s (chrome, YouTube, deck), one hidden `BrowserWindow` (engine), two sessions |
| 2 | cross-origin isolation | `app://` privileged scheme + COOP/COEP on every response — **measured `crossOriginIsolated === true`**, and measured red without the headers |
| 3 | the 32 duties | table, one row each, with the process each runs in and how it crosses |
| 4 | the bus | one router in `main` over `ipcMain`/`ipcRenderer`. **Not** `MessageChannelMain`, and the reason is the unit's, not Electron's |
| 5 | the six originated messages | `main` sends all six; a `sourceToken` is a one-shot capture claim minted by `main` |
| 6 | the arm gesture | a button in our chrome + a **menu accelerator**; `armShortcut()` answers in the unit's token vocabulary, never Electron's |
| 7 | the model | a file on disk, served over `app://`, `fetch`ed by the engine renderer. **Measured: 114,559,139 bytes in 179 ms, zero structured clones** |
| 8 | the four non-duties | autoplay-next wired through `PREFS_KEY`; the toolbar sentence **taken, not patched**, and filed upstream; isolation done; weights bundled |
| 9 | risks | ranked, with the two that are genuinely unmeasured named first |

---

## 0. The measurements this design rests on

Four unknowns were settled before the design was written, with a throwaway probe
under Electron 44.0.0 / Chromium 152.0.7977.54 / Linux 6.17, `xvfb-run`. The
probe's full source is in [Appendix A](#appendix-a--the-design-probe-verbatim) so
the numbers can be re-derived from this document alone — `docs/spike-capture-mute.md`
Limitation 7 is what that appendix exists to avoid repeating.

| # | question | result | how it was falsified |
|---|---|---|---|
| **P1** | Does `getDisplayMedia` need transient user activation in an Electron renderer with a `setDisplayMediaRequestHandler` installed? | **No.** `[measured]` Called from a script run with `executeJavaScript(code)` — **no `userGesture` flag, no input event, no activation of any kind** — it resolved: 1 audio track, `channelCount 2`, `sampleRate 44100`, `autoGainControl/echoCancellation/noiseSuppression` all `false`. | The same call was then repeated in a second pass with `executeJavaScript(code, /* userGesture */ true)` and behaved identically, so the flag is not what made it work. The spike passes `true` at `spike/main.js:204`; that was not load-bearing. |
| **P2** | Does COOP/COEP over a privileged custom scheme actually cross-origin-isolate the document? | **Yes.** `[measured]` `crossOriginIsolated === true`, `new SharedArrayBuffer(1024)` constructs, a `type: 'module'` Worker inherits it (`coi: true` inside the worker, a SAB posted in and `Atomics.store`d), `audioWorklet.addModule()` over the scheme resolves at `sampleRate 44100`, OPFS `getDirectory()` writes, `fetch(..., {method:'HEAD'})` returns 200. | **Watched red by mutation:** the same run with the two headers removed reports `crossOriginIsolated: false` and `SharedArrayBuffer is not defined` — *in the document and in the worker*. The headers are the mechanism, not decoration. |
| **P3** | Can a renderer in one session capture a frame belonging to a `WebContents` in a **different** session/partition? | **Yes.** `[measured]` Engine renderer on the default session captured a view on `persist:youtube`: `deviceId web-contents-media-stream://5:1?local_echo=false`, stereo, 44100, all three processing flags false. | Without this the partition plan in §1 collapses; it was run before §1 was written, not after. |
| **P4** | How do 109 MB of model weights reach the engine renderer? | **`fetch` over `app://`.** `[measured]` 114,559,139 bytes — the exact `MODEL.bytes` — streamed in **1383 chunks**, first byte at 5 ms, whole stream in **179 ms**, assembled into a contiguous `Uint8Array` in 39 ms, `byteOffset === 0 && byteLength === buffer.byteLength` **true**, `crossOriginIsolated` still true. A `HEAD` returns `Content-Length` without reading a byte. | The alternative — reading in `main` and `webContents.send`ing the bytes — is one 109 MB structured clone per load, twice per session (two decks). This measurement is why that alternative is rejected rather than merely disliked. |

Two things these numbers are **not**. They are not macOS: every one says `linux`.
And P1 is not a promise about a future Chromium — the activation requirement is
in the spec for `getDisplayMedia`, and Electron's answer-in-main path currently
bypasses it. §9 R6 carries that as a risk with a named fallback.

---

## 1. Process and renderer topology

### 1.1 The map, against the extension it replaces

| unit needs | extension | stem-workbench | why |
|---|---|---|---|
| the Host's privileged half | MV3 service worker (`sw/service-worker.js`) | **`main`** | The only context that can mint a capture grant, own a window, read the filesystem and outlive every renderer. It is the service worker's job, minus the 30 s idle death — so unlike the service worker it may hold state in module scope. |
| the **engine** (`offscreen/engine.js`) | offscreen document (`chrome.offscreen`) | **a hidden `BrowserWindow`**, `show: false`, loading `app://workbench/engine.html` | Needs `SharedArrayBuffer`, WebGPU, `AudioWorklet`, OPFS, and the captured `MediaStream`. §2 gives it isolation. |
| the **deck** (`ui/embed.html`) | an `<iframe>` injected into youtube.com by `content.js` | **a `WebContentsView`**, loading `app://workbench/vendor/stem-splitter-live/extension/ui/embed.html` | Drawn in **our** window, beneath the YouTube view. Never injected into YouTube's DOM — `docs/ARCHITECTURE.md` §1's reason (YouTube's origin, YouTube's CSP, one stylesheet change from breaking) is the same here and the seed §8 decision is explicit. |
| the **player** | the watch page's `<video>`, driven by `content.js` / `speed.js` / `autonav.js` | **a `WebContentsView`** on `persist:youtube` with our transport preload | Seed §8. Same boundary as the content script: transport state, never media (L1). Electron's `autoplayPolicy` already defaults to `no-user-gesture-required`, which is why the spike's YouTube page played on its own. |
| the Host's own surface | the toolbar icon, `ui/welcome*` | **a `WebContentsView`** loading `app://workbench/chrome.html` | The arm control and the source bar. There is no toolbar to click and `BaseWindow` has no page of its own; something has to hold the first thing the owner touches (§6). |

Five contexts, four renderers. The extension has the same five; only two of them
were pages there.

### 1.2 `BaseWindow`, not `BrowserWindow` `[decided]`

The window is a `BaseWindow` and every visible surface is a `WebContentsView`
added to `win.contentView`:

```
BaseWindow
└── contentView
    ├── chromeView  (WebContentsView)  y=0    h=44    app://workbench/chrome.html
    ├── ytView      (WebContentsView)  y=44   h=rest  persist:youtube, youtube.com
    └── deckView    (WebContentsView)  y=…    h=clamp(setHeight, 120..900)  app://…/ui/embed.html
```

A `BrowserWindow` would give the window a top-level `WebContents` of its own,
which we would then have nothing to put in — and whose z-order and focus
relationship to three attached child views is implicit rather than stated. The
spike used `BrowserWindow` because it needed a host page to *make* the
`getDisplayMedia` call; in the product that call is the engine's, so the page is
not needed. `BaseWindow` makes the composition explicit and removes a renderer
nobody would own.

**"Beneath" is layout, not z-order.** The three views have disjoint bounds, so
there is no stacking question to get wrong; `addChildView` order is nevertheless
fixed as above so that a future overlay lands somewhere stated.

### 1.3 The engine is a hidden window, and `backgroundThrottling: false` is not optional `[decided]`

```js
new BrowserWindow({
  show: false, skipTaskbar: true,
  webPreferences: {
    preload: ENGINE_PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false,
    backgroundThrottling: false,          // ← the load-bearing line
  },
});
```

The engine's real-time work is on the audio thread and is not throttled, but the
orchestration around it is not: `offscreen/engine.js` runs a 10 Hz status
heartbeat and the live pump on ordinary timers. A hidden or occluded renderer has
its timers coalesced to ~1 Hz by Chromium, which does not stop the audio — it
starves the thing that *feeds* the audio. `backgroundThrottling: false` is the
switch; `app.commandLine.appendSwitch('disable-renderer-backgrounding')` is the
belt to its braces. §10 makes this an assertion with a count, not a stopwatch.

**Never `destroy()` the engine window — `close()` it.** `onTeardown` is
`pagehide` (§3), and `pagehide` is what stops the capture tracks. `destroy()`
skips it. This is R5 (`docs/ARCHITECTURE.md` §5) arriving in a different shape:
here a leaked track does not mute a tab, it leaks a capture and a ~1.7 GB wasm
heap. `main` closes the engine window on `before-quit` and waits for the
`destroyed` event before letting the quit proceed.

### 1.4 Sessions `[decided]`, with P3 behind it

Two sessions, and the split is a privacy boundary rather than a convenience:

- **default session** — `chrome`, `deck`, `engine`. Our origin, our OPFS, our
  storage. This is the session the `app://` protocol handler is registered on and
  the session `setDisplayMediaRequestHandler` is installed on (the *requesting*
  renderer's session is the one that matters).
- **`persist:youtube`** — the YouTube view only. Cookies, sign-in state (seed §9,
  step 5) and every byte YouTube stores live here and are reachable from nothing
  else. `PRIVACY` can then say something true and narrow: the app's own code
  talks to GitHub Releases and nothing else (P1′); the YouTube view's traffic is
  the user's browsing, in its own jar.

P3 measured that the capture crosses that boundary: the engine (default session)
captured a frame owned by a view on `persist:youtube`. Without that measurement
the two-session design would have been a guess.

### 1.5 Preloads

| renderer | preload | `sandbox` | exposes |
|---|---|---|---|
| engine | `preload/engine.cjs` | `true` | `window.__wbEngine` — bus send/onMessage, capture claim, model stat, storage-free |
| deck | `preload/deck.cjs` | `true` | `window.__wbDeck` — bus, storage, armShortcut, page, transport |
| chrome | `preload/chrome.cjs` | `true` | `window.__wbChrome` — arm/disarm, source state |
| YouTube | `preload/youtube.cjs` | `true` | **nothing on `window`.** It talks to `main` over its own ipc channels and touches the page's `<video>` directly |

All four are sandboxed and CommonJS (a sandboxed preload cannot be ESM). A
sandboxed preload still has `ipcRenderer` and `contextBridge`, which is all any
of them needs.

**The YouTube preload exposes nothing to the page.** `contextIsolation: true`
plus no `exposeInMainWorld` means youtube.com cannot see or call any of it — the
same posture `content.js` has in an isolated world today.

### 1.6 The YouTube view is a guest we hold to a short list `[decided]`

Seed §8 allow-lists navigation; this is that list plus the three other things a
window pointed at somebody else's site owes.

| control | rule |
|---|---|
| navigation | `will-navigate` and `will-redirect` cancel anything whose host is not `youtube.com`, `www.youtube.com`, `m.youtube.com`, `accounts.google.com`, `accounts.youtube.com`, `consent.youtube.com`, `myaccount.google.com` (suffix match on the registrable domain, never `includes()`) |
| new windows | `setWindowOpenHandler(() => ({ action: 'deny' }))`. There are no tabs and no popups; a sign-in flow that needs one is a refusal the user can see, not a window we cannot manage |
| permissions | `session.setPermissionRequestHandler` and `setPermissionCheckHandler` on `persist:youtube` **deny everything** except what a video page needs. Camera, microphone, geolocation, notifications, midi, clipboard-read and display-capture are all denied — the last one by name, because a page that could call `getDisplayMedia` itself would be the whole product's undoing |
| audio | `setAudioMuted(true)` before the first load and re-asserted on `did-start-navigation` (§6.4) |
| downloads | `session.on('will-download', (e) => e.preventDefault())` |
| L1 | the preload reads `paused`, `currentTime`, `duration`, `ended`, `playbackRate`, `seeking` and writes `muted`, `currentTime`, `playbackRate`. It never reads `src`, `currentSrc`, `buffered` or `srcObject`, never calls `captureStream()`, and never touches a byte of media. The same `qa/speed-pitch.mjs`-shaped text scan that gates `content.js` today should be re-aimed at this file |

The allowlist is a **refusal**, not a redirect: a blocked navigation raises a
visible message in the chrome view. A silent cancel is how a sign-in flow becomes
"the button does nothing".

---

## 2. Cross-origin isolation

### 2.1 What needs it, exactly

`offscreen/engine.js:112` sets `SAB_OK = typeof SharedArrayBuffer === 'function'`
and `:917` throws `SharedArrayBuffer unavailable — the capture ring cannot be
built`. It asserts on the **constructor**, never on `crossOriginIsolated`
(`:111` says so), because on an extension page `crossOriginIsolated` is false and
SAB is available anyway. A second Host gets no such gift.

Two consumers, and they fail differently:

1. **The capture ring.** `new SharedArrayBuffer(ringByteLength(RING_FRAMES))` at
   `engine.js:956` and `:991`, shared with the capture worklet. No SAB, no live
   mode at all — a loud throw at the first arm.
2. **ORT's threaded wasm.** `workers/inference.worker.js:45-49` pins
   `ort.env.wasm.numThreads` explicitly *because* ORT contains a
   `!crossOriginIsolated -> 1` branch it does not want taken. Pinning the number
   does not conjure the memory: wasm threads need a growable
   `SharedArrayBuffer` **inside the worker**. Without it ORT falls back to one
   thread and the fallback is silent — the deck reports `threads: 1` and the user
   reports "it's slow".

### 2.2 The scheme `[decided]`, and the headers `[measured]`

```js
// BEFORE app.whenReady() — this is the only ordering constraint in the file
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);
```

- `standard: true` gives `app://workbench/…` a real origin (`app://workbench`),
  which is what makes storage, workers and module resolution behave.
- `secure: true` makes it a secure context — required for `AudioWorklet`, OPFS,
  WebGPU and `getDisplayMedia`.
- `supportFetchAPI: true` is named in `shared/host.js`'s `assetUrl` obligation 2
  verbatim: `workers/workerbackend.js:214` probes the ORT bundle with
  `fetch(url, {method:'HEAD'})`, and a scheme `fetch` refuses turns that
  diagnosis into a false report about a file that is present.
- `stream: true` is what P4 leans on for the 109 MB body.

Then, in `main`, on **every** response `protocol.handle('app', …)` produces:

| header | value | why |
|---|---|---|
| `Cross-Origin-Opener-Policy` | `same-origin` | half of isolation |
| `Cross-Origin-Embedder-Policy` | `require-corp` | the other half |
| `Cross-Origin-Resource-Policy` | `same-origin` | under `require-corp` every subresource must opt in, and we serve all of them |
| `Content-Type` | by extension; `.js`/`.mjs` → `text/javascript`, `.wasm` → `application/wasm` | ORT streams its wasm; a wrong type breaks `instantiateStreaming` several layers from the mistake |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'` | `'wasm-unsafe-eval'` is **required** for ORT to compile wasm under a restrictive `script-src`. See §9 R4 — this is `[unknown]`, not measured. |

**COEP never touches youtube.com.** The YouTube view is a sibling `WebContentsView`
with its own top-level document in its own session — not a subresource and not an
iframe of ours — so `require-corp` has no opinion about it. This is the strongest
practical argument for `WebContentsView` over an `<iframe>` and it is worth
stating because the opposite choice fails in a way that looks like YouTube's
fault.

**Workers and worklets inherit.** `[measured]` The module worker created by
`workers/workerbackend.js:188` with `new URL('./inference.worker.js',
import.meta.url)` is same-origin, so it inherits the embedder policy; the probe
saw `crossOriginIsolated: true` and a working `Atomics.store` inside it.
`audioWorklet.addModule()` over the scheme resolved. Nothing extra is needed for
either.

### 2.3 The fallback, and why it is second `[measured]`

`app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer')` also
works: the probe recorded `sabCtor: true` and a working SAB in the worker with
**`crossOriginIsolated: false`**. That is exactly the extension's shape and the
unit is written for it (`boot.sab` and `boot.coi` are separate fields at
`engine.js:115`).

It is the fallback and not the plan because it is a process-wide switch that
turns SAB on for *every* renderer including youtube.com's, and because
`crossOriginIsolated: false` leaves ORT's own branch one edit away from mattering.
If the headers path ever fails on a platform we cannot test here, this is the
recorded escape hatch and the deck will show `coi false / sab true`, which is a
visible, honest degradation rather than a silent one.

### 2.4 How it is proven, and how the proof is falsified

The engine already publishes the answer: `STATE.boot = {sab, coi, sampleRate, ep,
adapter, threads}` (`engine.js:115`). The boot smoke (§10) asserts, over one real
launch:

1. `boot.sab === true`
2. `boot.coi === true`
3. `boot.sampleRate === 44100`
4. `onReady({threads})` reports `threads >= 2` — a **count**, which is the thing
   that proves threaded wasm really got shared memory, rather than a timing claim
   about it being fast.

> **Assertion 4 is wrong and was corrected by measurement `[measured]`.** It does
> not prove what this paragraph says it proves. Run the mutation below — COOP and
> COEP deleted — and the engine reports `sab=false coi=false` **while ORT still
> reports `threads: 4`**, because `workers/inference.worker.js:45-49` *pins*
> `ort.env.wasm.numThreads` and `onReady` echoes the pin rather than measuring
> the runtime. Assertions 1 and 2 carry the isolation claim on their own and do
> go red. The thread count keeps its place in `tools/suites/engine-host.mjs` for
> a different reason that IS true: `onReady` arrives outside any call the unit
> made, so it is the only evidence that `createBackend` forwarded the unit's
> hooks — dropping the `...hooks` spread leaves it `null` and nothing else in the
> tree notices. See `docs/TESTING.md` §5b, "Two things measurement corrected in
> the design", and finding F5 in §11.

**The mutation, already watched red:** delete the COOP and COEP lines from the
protocol handler. Measured result — `crossOriginIsolated: false` and
`SharedArrayBuffer is not defined`, in the document *and* in the module worker.
Assertions 1, 2 and 4 all go red and 4 goes red for the reason that matters.

---

## 3. The 32 duties, one by one

`shared/host.js` declares **30 callable duties** across five tables plus **two
namespaces** (`page`, `transport`) that are deliberately not callable — 32
members, checked by `assertHost` (callable ones) and `assertHostOption`
(`transport`, which may be `null` but must be *spelled*).

Legend for **crossing**: `—` none, the duty is entirely inside one renderer;
`ipc→` renderer to main; `ipc↔` round trip; `bus` the routed message bus (§4);
`app://` a fetch over our scheme.

### 3.1 `EngineHost` — 9 duties, all in the **engine** renderer

| duty | extension | stem-workbench | crossing | differs in kind? |
|---|---|---|---|---|
| `send` | `chrome.runtime.sendMessage({v:1,to:'ui',from:'off',...msg}).catch(()=>{})` — a broadcast | stamp the same envelope in the renderer, hand it to `ipcRenderer.send('bus', env)`. Returns `undefined`. Delivery failure is impossible to observe and is therefore already swallowed | `ipc→` then `bus` | no |
| `onMessage` | `chrome.runtime.onMessage` + `m.to !== ME` guard, `return false` | `ipcRenderer.on('bus', (_e, m) => { if (m && m.to === BUS.engine) fn(m); })`. Raw envelope, return value dropped. The `return false` has no analogue — Electron has no "I'll respond later" channel to hold open | `bus` | no |
| `captureStream` | `getUserMedia({audio:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:token}}})` | `claim(token)` over ipc, then `getDisplayMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}, video:true})`, stop the video track, **verify the audio track's settings**, resolve the stream | `ipc↔` + a media pipe | **YES — see 3.6** |
| `assetUrl` | `chrome.runtime.getURL(rel)` | `new URL(rel, UNIT_BASE).href` where `UNIT_BASE = 'app://workbench/vendor/stem-splitter-live/extension/'`. Synchronous, **keeps a trailing slash** (`new URL('vendor/ort/', base)` does; `path.join` and `pathToFileURL` do not — the duty says so and R0 measured what it costs) | — | no |
| `onTeardown` | `addEventListener('pagehide', fn)` | `addEventListener('pagehide', fn)` — **the identical line**. §1.3 is what makes it fire | — | no |
| `modelBytes` | `caches.match` else `fetch(MODEL_URL)`, drained through a reader with progress | `fetch('app://workbench/model/htdemucs_6s.onnx')`, drained through the same reader shape with progress. Phase is `'cache'` and is announced **before any bytes move** | `app://` | no (mechanism), **yes (semantics)** — see §7 |
| `modelCached` | `!!(await cache.match(MODEL_URL))`, `false` on any throw | `ipcRenderer.invoke('model:stat')` → exists && size > 0. Never rejects; `false` on anything unexpected | `ipc↔` | no |
| `clearModel` | `caches.delete(bucket)` | **an honest no-op that resolves.** The bytes are immutable and shipped in the installer; `shared/host.js` blesses exactly this shape and pairs it with `fromCache: false` | — | **YES — see §7** |
| `createBackend` | `new WorkerBackend({ ...hooks, assetUrl })` | `new WorkerBackend({ ...hooks, assetUrl })` — **the identical line**. Fresh instance per call, hooks forwarded whole, `...hooks` first so the unit cannot overwrite the resolver | — | no |

### 3.2 `Backend` — 3 duties, in the **engine** renderer + its worker

Unchanged: backend #1 is the unit's own `workers/workerbackend.js`, driving
`workers/inference.worker.js`. `load`, `separate` and `dispose` are the unit's
code and this Host does not reimplement them. Seed §16's native backend in a
utility process is step 7; when it lands, `dispose`'s "settle every call still
outstanding" is the clause that will bite, and `shared/host.js` already names
this Host as the one it was written against.

### 3.3 `DeckHost` — 6 duties + 2 namespaces, in the **deck** renderer

| duty | extension | stem-workbench | crossing | differs in kind? |
|---|---|---|---|---|
| `send` | `chrome.runtime.sendMessage(msg)` — a **finished** envelope, carried verbatim | `ipcRenderer.send('bus', msg)` — carried verbatim. `main` reads `msg.to` and nothing else | `ipc→` + `bus` | no |
| `onMessage` | broadcast + `m.to === 'ui'` guard | `ipcRenderer.on('bus', …)` + the same guard | `bus` | no |
| `storageGet` | `chrome.storage[area].get(key)`, unwrapped, `null` when absent, **rejects** when unreadable, **rejects** on an area outside `{local,session}` | `invoke('storage:get', area, key)`; `main` answers `{ok,value}` or `{ok:false,error}` and the host module rejects on the latter. `assertArea` inside an `async` function so a bad area **rejects**, never throws | `ipc↔` | no |
| `storageSet` | `chrome.storage[area].set(...).catch(()=>{})`; **throws** at the call site on a bad area | `send('storage:set', …)`, returns `undefined`, failure swallowed; `assertArea` **throws** synchronously | `ipc→` | no |
| `onStorageChanged` | `chrome.storage.onChanged` + area/key filter; `assertArea` up front | `ipcRenderer.on('storage:changed', …)` + the same filter; `assertArea` up front, because a listener that can never fire is a subscription covering nothing | `bus`-like | no |
| `armShortcut` | `chrome.commands.getAll()` → the raw accelerator, `null` if unbound, **rejects** if the API is absent | `invoke('host:armShortcut')` → the menu accelerator **in the unit's token vocabulary**, or `null` if the accelerator could not be taken. §6 | `ipc↔` | **YES — see §6** |
| `page` | always present; `postMessage` to `content.js` across the iframe | always present; ipc to `main`, which owns the layout | — | no |
| `transport` | `FRAMED ? {...} : null` | `sourceKind === 'live' ? {...} : null` — spelled, never omitted. A File source (step 4) makes the deck the transport master and this becomes `null` | — | no |

### 3.4 `DeckPage` — 6 duties, deck renderer ↔ `main`

| duty | extension | stem-workbench | crossing |
|---|---|---|---|
| `onKey` | `content.js` `keydown` capture on the watch page, filtered by `deckKeys`/`deckArmed`/typing target, posted to the iframe | `main` installs `before-input-event` on **every** `WebContents` in the window (chrome, YouTube, deck). A `keyDown` whose `code` the deck has claimed, while a deck is armed, is `preventDefault()`ed and forwarded | `bus` |
| `onAutonav` | `content.js` reports on the watch page's autoplay-next toggle | the YouTube preload runs the same `resolveSuppress` logic against the same control; `main` forwards the report. States the deck paints as failures: `missing`, `stuck`, `lost` | `bus` |
| `claimKeys` | `postMessage({type:'DECK', armed, keys})` → `content.js` keeps the set | `send('page:claimKeys', {armed, keys})` → `main` keeps the set and uses it in the `before-input-event` router | `ipc→` |
| `setHeight` | posts `HEIGHT`; `content.js` clamps 120..900 onto the iframe | `send('page:height', px)`; `main` clamps 120..900 and lays out `deckView` and `ytView` | `ipc→` |
| `ready` | posts `READY`; `content.js` re-sends video state, last autonav, last speed | `send('page:ready')`; `main` re-sends the same three, from the last values it holds | `ipc→` |
| `close` | posts `CLOSE`; `content.js` unmounts the iframe | `send('page:close')`; `main` calls `deckView.setVisible(false)` and relays out the window | `ipc→` |

`close` is where this Host is *stronger* than the extension: "the audio does not
stop" is a promise the extension keeps by convention (the offscreen document
happens to be a different context) and that we keep structurally (it is a
different **process**, and hiding a view cannot reach it).

### 3.5 `DeckTransport` — 6 duties, deck ↔ `main` ↔ the YouTube preload

| duty | extension | stem-workbench | crossing |
|---|---|---|---|
| `onState` | `content.js` on every media event + a ~4 Hz tick: `{playing, currentTime, duration, ended, playbackRate, hasMedia, adShowing, seeking}` | the YouTube preload, same events, same eight fields, same ~4 Hz tick. **Push, never poll** | `bus` |
| `onJump` | `seeked` / `emptied` / `loadstart` / `yt-navigate-finish` | the same events in the preload, plus `did-navigate-in-page` seen by `main` | `bus` |
| `onSpeedReport` | `speed.js`'s `resolveSpeed` → `{state, why, applied}`; `state` must be the literal `'ok'` to ungrey | a port of the same function, in `main`, over the preload's reports. `'ok' \| 'ad' \| 'looking' \| 'missing' \| 'unknown'` | `bus` |
| `drive` | filters to `muted`, `playbackRate`, `currentTime`(→`seekTo`) and posts | filters to the same three, `ipc→` `main`, which **allowlists them again**, then the preload writes them. Three layers, on purpose: L1 is a security property and this channel reaches a `<video>` on somebody else's page | `ipc→` |
| `release` | `restoreVideo` — unmuted, rate 1, key lock on | the preload restores the same three to as-found | `ipc→` |
| `requestSpeed` | posts the raw rate; refusal is reported, never silently dropped | the same; `main`'s speed logic refuses and reports | `ipc→` |

**The element mute and the WebContents mute are different things and both exist.**
`webContents.setAudioMuted(true)` on the YouTube view is the product's silence
guarantee and holds for the view's whole life (§6.4). `drive({muted})` is the
unit's clock-lock on the element, for the cached deck. Implementing one is not
implementing the other, and `release()` must restore only the second.

### 3.5b Three rows above are **out of date**, and here is what shipped

Recorded here rather than edited into the tables, because the tables are the
design as it was reasoned and these are the three places building it changed the
answer. `tools/suites/transport.mjs` gates all three.

1. **`onKey` on the SOURCE view is the preload's, not `before-input-event`.**
   §3.4 says `main` installs `before-input-event` on every `WebContents`. That
   handler cannot see what has focus, and `content.js`'s `isTypingTarget` filter
   is the load-bearing half: the cost of getting it wrong is a digit stolen out
   of a half-written comment on somebody else's site. So the source view's keys
   are taken in `src/preload/youtube.cjs`, in the capture phase, exactly as the
   content script takes them — `preventDefault()` + `stopPropagation()`, filtered
   by `deckArmed`, the claimed code list, and the typing target. `main` keeps
   `before-input-event` for the views we own (`src/main/keys.js`), where there is
   no guest page to protect. The fixture's own `keydown` counter is the witness
   that an unclaimed key still reaches the page.

2. **`onSpeedReport` is not "a port of the same function".** It EXECUTES the
   vendored `extension/speed.js` in a `node:vm` context
   (`src/main/speed.js`). `ui/embed-state.js` pins the deck's 29-rung ladder
   against that exact file, so a Host that re-typed `SPEED_MIN = 0.5` would not
   have copied a constant — it would have made that pin a lie, silently. One
   file, one clamp, two readers. `extension/autonav.js` gets the opposite
   treatment for a reason that is a fact about the copy rather than a choice: it
   does not travel (finding F4).

3. **None of these ride the `'bus'` channel**, which §3.4 and §3.5 both say they
   do. `'bus'` carries the UNIT's protocol — `{v,to,from,type}` envelopes that
   `ui/host.js`'s `onMessage` hands to the deck's own message handler after a
   `to === 'ui'` guard — and a `VIDEO` or `SPEED` message on it would arrive at a
   handler with no case for it. In the extension these never touch
   `chrome.runtime` at all: they are `window.postMessage` from `content.js`, a
   separate wire. `src/main/transport.js` is an event source in `main` and
   `src/main/deck-host.js` owns the deck's wire, which keeps Host traffic out of
   the unit's namespace.

### 3.6 The duties whose honest answer differs **in kind**

Four. Everything else is the same idea over a different pipe.

1. **`captureStream`** — in the extension the token *is* the grant:
   `getMediaStreamId` returns something `getUserMedia` consumes directly, and the
   Host cannot capture anything the grant does not name. Here the grant is a
   **decision made in `main` at request time** by
   `setDisplayMediaRequestHandler`, and `getDisplayMedia` carries no token. The
   token therefore has to be correlated out of band (§5.2), and the correlation
   is the security property: *the engine cannot capture anything `main` did not
   arm.* Also, and unlike the extension, the Host must **inspect what it got**:
   `spike-capture-mute.md` Limitation 6 measured a naive `getDisplayMedia({audio:
   true})` producing mono/48 kHz/AGC-crushed audio that decayed 17× over 8 s and
   satisfied a four-assertion gate. This Host rejects such a stream rather than
   handing it to a stem separator.
2. **`clearModel`** — "throw away the stored weights" has no referent for bytes
   that shipped in the installer. `shared/host.js` anticipates exactly this Host
   and blesses the no-op **on condition** that `modelBytes` reports
   `fromCache: false`, so the unit stops after one ask instead of looping. The
   pair is the contract; implementing one without the other is the defect.
3. **`armShortcut`** — the extension reads a binding the *user* controls at
   `chrome://extensions/shortcuts` and answers in Chrome's spelling. We own the
   binding, so the honest answer is our own accelerator — but expressed in the
   unit's token vocabulary, not Electron's (§6.3). "Reading a platform's answer"
   becomes "answering for a platform we are".
4. **`session.armed`** — not a duty, but the field the whole arm gesture reduces
   to. `sessionForDeck()` derives it from a tab id; there are no tabs. §6.2.

And one that differs in **degree** and is worth flagging anyway:
**`EngineHost.send` is documented as a fan-out**, and `ui/welcome.js:92` already
relies on it — a second listener on `to: 'ui'` paints model-download progress off
the same `STATE` messages. Our router therefore delivers `to: BUS.deck` to
**every** renderer registered on that address, not to the deck. Today that set has
one member; the day a first-run screen exists it will have two, and the transport
will not need changing.

---

## 4. The bus

### 4.1 The decision `[decided]`

**One router in `main`, over `ipcMain` / `ipcRenderer`, with one channel name
(`'bus'`). Not `MessageChannelMain`.**

Four reasons, in order of weight, and the first three are the unit's rather than
Electron's:

1. **The unit's bus is an addressed broadcast, not a link.** `EngineHost.send` is
   documented as a fan-out and something already depends on it (§3.6). A direct
   engine↔deck `MessagePort` makes the second listener unimplementable without
   replacing the transport.
2. **The deck has two correspondents** (`BUS.engine` and `BUS.host`) and one of
   them **is** `main`. Main is in the graph no matter what, so ports would be an
   addition to the router rather than a replacement for it.
3. **Renderers come and go.** `page.close()` hides the deck; a crash recreates it;
   the YouTube view navigates. A router keyed by address, re-registered when a
   renderer loads, survives that. A port handed out once and dropped is a bus that
   is silently dead — and the failure looks exactly like "the deck stopped
   painting", which `shared/host.js` names as the quietest failure on this seam.
4. **There is no hot path on this bus.** This is the measurement that makes the
   cost argument moot: every large object in this product travels somewhere else.
   The model goes over `app://` (§7, P4). The mix and stems are transferables
   between the engine renderer and its own worker, in-process. The captured audio
   is a media pipe. What is left on the bus is a 10 Hz status heartbeat and user
   gestures — small JSON, two hops, no measurable cost.

`MessageChannelMain` stays on the table for exactly one future case: a native
inference backend in a utility process (seed §16), where per-segment traffic is
≈ 2.7 MB in / ≈ 16.5 MB out per 7.8 s. That is a *backend* transport, not this
bus, and it is step 7.

### 4.2 The router

```js
// main — the whole of it, in shape
const REG = new Map();            // address -> Set<WebContents>
ipcMain.on('bus', (event, msg) => {
  if (!msg || msg.v !== 1 || typeof msg.to !== 'string') return void drop('malformed', msg);
  if (msg.to === BUS.host) return void hostInbox(msg, event.sender);   // §5.3
  const targets = REG.get(msg.to);
  if (!targets || !targets.size) return void drop('no-listener', msg); // normal, and counted
  for (const wc of targets) if (!wc.isDestroyed()) wc.send('bus', msg);
});
```

Five properties, each of which is a rule from `shared/host.js` made mechanical:

- **`main` reads `to`, and `v` only to refuse a protocol it does not know.**
  Rule 1 says the envelope is the unit's protocol and a Host that stamps,
  rewrites, normalises or filters it breaks receivers quietly. `shared/host.js`
  says outright that `to` is *"the one field a transport is allowed to read"* on
  a point-to-point transport, and ours is one. The `v !== 1` guard is a refusal,
  not routing — it drops a message rather than interpreting one — and if that
  reading is judged too generous the guard comes out and nothing else changes.
  **Nothing** in the envelope is rewritten, reordered, normalised, or logged by
  value.
- **Addresses are assigned by `main`, never claimed by a renderer.** `main`
  created every window and knows which is which; registration happens when
  `main` loads a URL into a view, not when a renderer announces itself. A
  compromised renderer cannot start receiving the engine's traffic by asking to.
  The YouTube view is on **no** address and its preload does not use the `'bus'`
  channel at all.
- **Fan-out on `BUS.deck`.** §3.6.
- **A message with no listener is dropped and counted, never retried.** That is
  the extension's behaviour (`sendMessage` rejecting into a `.catch`) and the
  deck's boot poll is written for it (`embed.js:2470-2474`: 20 tries at 400 ms of
  `SW_ENSURE_OFFSCREEN` + `STATUS`). The counter exists so "the deck is blank" has
  a number attached to it.
- **`send` resolves the transport at call time.** Rule 2. Our host modules call
  `window.__wbEngine.send(...)` per message; nothing is captured at import. This
  is not superstition inherited from the extension — it is what lets a smoke
  replace the outgoing wire after boot and actually see traffic.

### 4.3 The envelope asymmetry, handled where it belongs

`shared/host.js` freeze item 5: `EngineHost.send` **stamps** `{v:1, to:'ui',
from:'off'}` and `DeckHost.send` carries a **finished** envelope. One Host, two
functions:

```js
// vendor/…/extension/offscreen/host.js   (our EngineHost — a hole)
export const send = (msg) => { bridge().send({ v: 1, to: BUS.deck, from: BUS.engine, ...msg }); };

// vendor/…/extension/ui/host.js          (our DeckHost — a hole)
send(msg) { bridge().send(msg); }
```

`main` stamps only what **it** originates (`from: BUS.host`). Three stampers would
be one too many; two is what the interface froze.

### 4.4 The one shape `assertHost` will catch if we get it wrong

`shared/host.js` names it as *the* Electron mistake: *"an Electron preload bridge
wrapped one level too deep hands over `{ send: fn }`"*, and *"a duty implemented
as a method that needs its `this` — an Electron preload bridge — passes this
check, works for the four duties the engine calls through the namespace, and
fails only at the first worklet load"*, because `engine.js` hands
`host.assetUrl` **itself** to `MasterBus` and to every deck, unbound.

So, as a rule with a name: **the two hole modules export plain functions that
close over the bridge. They never re-export the bridge object, and no duty is a
method that needs its `this`.** §10 turns this into an assertion that calls a
detached `assetUrl`.

---

## 5. The six messages the Host must originate

`docs/VENDORING.md` lists them under "What your Host owes the unit" precisely
because `assertHost` cannot check for a message nobody sent.

### 5.1 The table

| message | to | who sends it | when | payload |
|---|---|---|---|---|
| `CAPTURE_START` | `BUS.engine` | `main` | on `SW_CAPTURE_START` from the deck, if armed | `{ sourceToken, source: { title, url }, deck }` |
| `CAPTURE_STOP` | `BUS.engine` | `main` | disarm; YouTube view gone/crashed; source switched to File; quit | `{ deck? }` |
| `DECK_PREPARE` | `BUS.engine` | `main` | on `SW_DECK_PREPARE`, **after** the engine window exists | `{ deck }` |
| `SESSION` | `BUS.deck` | `main` | every session change, and in answer to `SW_STATUS` | `{ session: { armed, title, url, armedAt } }` |
| `ARM_ERROR` | `BUS.deck` | `main` | every arm refusal — **and persisted** | `{ code, message }` |
| `ARM_ERROR_CLEARED` | `BUS.deck` | `main` | successful arm (unconditional); `SW_ARM_ERROR_CLEAR` with a matching `seq` | `{}` |

`source` is exactly `{title, url}` — the freeze removed `tabId` because nothing
read it, and inventing a value for a field with no reader is the purest form of
the lie the freeze looked for. `title` is `ytView.webContents.getTitle()`; `url`
is the **watch page** URL, which the engine parses for a video id
(`videoIdFromUrl`) and uses as a cache key. That is a page URL, never a media
URL: L1 is intact and the extension's session record carried the same field.

**The durable half of `ARM_ERROR` is not optional.** `shared/config.js:362`
`ARM_ERROR_KEY`, area `'session'`, record `{code, message, at: Date.now(), seq}`
with `at` in **epoch** milliseconds (written in one process, read in another;
`performance.now()`'s origin is per-context) and `seq` monotonic (it is the
record's identity on the dismissal path). Every raise and every clear goes through
one promise chain so a clear cannot race a raise — the same `armSerial` shape the
service worker uses, and for the same reason: there is no atomic
read-modify-write.

Our deck exists before the arm gesture rather than being created by it, so the
live `ARM_ERROR` will usually arrive. The persisted copy stays anyway: the deck
view can be reloaded, hidden, or crash-recovered, and `ARM_ERROR_TTL_MS` (60 s)
already decides when a stale refusal stops painting.

### 5.2 What a `sourceToken` is in this product `[decided]`

> Opaque to the unit; the Host mints it and the engine only carries it back.

Here it is a **one-shot capture claim**:

```
crypto.randomUUID()  →  main's Map<token, { kind:'live', sourceWcId, armEpoch, expiresAt }>
```

The flow, in five steps, three of which are refusals:

1. `main` mints a token when it sends `CAPTURE_START`, bound to the current arm
   epoch and to the YouTube view's `WebContents` id, with a short expiry (10 s —
   long enough for the engine to be woken and to load, short enough that a token
   cannot outlive the gesture).
2. The engine's `captureStream(token)` **first** does
   `await invoke('capture:claim', token)`. `main` validates: token known, not
   expired, arm epoch current, and the calling frame is the engine's. On failure
   it answers `{ok:false, code}` and `captureStream` **rejects** — never resolves
   null, because a null travels on as a capture with no track.
3. `main` records the claim as *pending* and the engine calls
   `getDisplayMedia({audio: {echoCancellation:false, noiseSuppression:false,
   autoGainControl:false}, video: true})`. `[measured, P1]` No user activation is
   required.
4. `setDisplayMediaRequestHandler` fires in `main`. It checks there is a pending
   claim **and that `request.frame` is the engine's main frame**, consumes the
   claim, and answers `cb({ video: ytView.webContents.mainFrame, audio:
   ytView.webContents.mainFrame })`. Otherwise it answers `cb({})` — a denial —
   and raises an `ARM_ERROR`. A request the app did not initiate is refused by
   construction.
5. The engine stops the video track (the spec forbids audio-only, so one is always
   created), inspects the audio track, and resolves.

**The inspection, and why it is the Host's job.** Before resolving:

```
settings.channelCount === 2 && settings.sampleRate === 44100 &&
settings.autoGainControl === false && settings.echoCancellation === false &&
settings.noiseSuppression === false
```

Anything else and `captureStream` stops the tracks and rejects with a message
naming the offending field. `spike-capture-mute.md` Limitation 6 is the whole
argument: a mono, 48 kHz, AGC-crushed capture is a dead product for stem
separation and it *looks fine* — 10.8× over a naive floor. The unit cannot see
this; it receives a `MediaStream` and trusts it. This is the one place the Host
can, so this is where it happens.

**This replaces R4, it does not inherit it.** `docs/ARCHITECTURE.md` §5 R4 — a
capture grant needs a browser-level invocation, which is why the extension has no
tab picker and cannot have one — is a Chrome constraint that simply does not exist
here. What *does* carry over is its consequence, deliberately: the engine still
cannot capture anything the Host did not arm, because the claim is minted only by
the arm path. We keep the property after losing the mechanism that forced it.

### 5.3 The other half nobody lists: the messages the Host must **answer**

`VENDORING.md` names the six a Host must originate. It does not name the six the
deck **sends to `BUS.host`** and expects a Host to act on. A Host that originates
all six and answers none has a deck that never boots — and nothing in the unit
says so. From `ui/embed.js`:

| the deck sends | `main` must |
|---|---|
| `SW_STATUS` (module scope, `:2456`) | ensure the engine window exists, then reply `SESSION` |
| `SW_ENSURE_OFFSCREEN` (boot poll, `:2472`) | create the engine window if absent |
| `SW_DECK_PREPARE` (`:1053`) | ensure the engine exists, **then** send `DECK_PREPARE` — the delivery guarantee, whose absence shows up as an 8 s stall on the *other* deck two minutes later |
| `SW_CAPTURE_START` (`:693`) | mint the token, send `CAPTURE_START`, or raise `ARM_ERROR` |
| `SW_ARM_ERROR_CLEAR` (`:2297`) | clear the persisted refusal **iff** `seq` matches |
| `SW_DISARM` (`:2312`) | clear the session, send `CAPTURE_STOP`, send `SESSION` |

This is [finding F1](#11-findings-for-stem-splitter-live).

---

## 6. The arm gesture

### 6.1 What arming means here `[decided]`

In the extension, arming answers "**which tab**", and it must happen inside a
browser-level invocation. Neither half survives: there is one window, and there is
no permission to broker.

What survives is the *decision*, and it is worth keeping deliberate because it is
the moment three things become true at once:

> **Arming binds the deck to a Source.** It says: this YouTube view is the thing
> the deck listens to; the app may open a capture on it; and the deck's number
> keys stop belonging to whatever has focus.

Everything the extension's arm gesture bought is still bought here — a deliberate
act, an explicit refusal path, a record that says what is armed and since when —
minus a permission that Chrome forced and Electron does not.

### 6.2 What `session.armed` is derived from `[decided]`

```js
const armed = armEpoch !== null;      // and that is the whole derivation
```

`armEpoch` is a monotonically increasing integer in `main`, set by the arm gesture
and cleared by disarm, by the YouTube view going away, by a switch to a File
source, and by quit. The record on the wire:

```js
{ armed, title: ytView.webContents.getTitle(), url: <watch page URL>, armedAt }
```

The deck **projects** this record rather than merging it (freeze change 3), so
omitting `armed` reads as disarmed rather than leaving a stale `true` standing.
That is a property of the deck we get for free and must not accidentally rely on
the other way.

**Refusals, so that the gesture can say no.** Arming is refused, with a code and a
persisted record, when: the YouTube view has no watch page loaded
(`NO_SOURCE`); the view is showing a page outside the allowlist (`SOURCE_UNSUPPORTED`);
the engine window failed to come up (`ENGINE_DOWN`); the model file is missing or
zero-length (`MODEL_MISSING`). The four exist because an arm that silently does
nothing is what `raiseArm` was invented to prevent, and because a product with no
refusal path ships an `ARM_ERROR` implementation nothing ever exercises.

### 6.3 What `armShortcut()` returns `[decided]`

**A menu accelerator, expressed in the unit's token vocabulary. Not
`globalShortcut`, and never Electron's spelling.**

```js
// main — one table, two consumers
const ARM_ACCEL = process.platform === 'darwin' ? 'Command+Shift+A' : 'Ctrl+Shift+A';
// Electron's Menu takes this string as-is on both platforms.
// armShortcut() answers with the same string, or null if the item could not take it.
```

Three decisions in that, each with a named failure it avoids:

- **`globalShortcut` is not used.** It steals the chord from every other
  application whether or not we are focused, and on macOS it needs an
  accessibility grant the user has no reason to give a music toy. A menu
  accelerator fires whenever our window is focused — which is whenever the user is
  looking at the deck or the YouTube view, since both are inside it.
- **The string is the unit's vocabulary, never Electron's.** `shared/host.js` is
  explicit: `chordLabel()` understands `MacCtrl`, `Ctrl`, `Command`, `Alt`,
  `Shift` and the four glyphs, and *"anything else is drawn on the key cap
  verbatim, so a Host answering in its own accelerator grammar — Electron's
  `'CommandOrControl+Shift+9'` — puts the word "CommandOrControl" in front of the
  user. It renders, so nothing goes red."* We happen to be able to use one table
  for both because `Command+…` and `Ctrl+…` are legal in both grammars;
  `CommandOrControl` is legal in exactly one and is therefore banned by name.
  `chordLabel('Command+Shift+A', true)` draws `⌘⇧A` and announces it in words.
- **`null` when the accelerator could not be taken**, which is the honest answer
  and the branch the deck already has. It is not hypothetical: a menu item whose
  accelerator collides is a real outcome, and `null` prints a different sentence
  rather than an empty key cap.

`armShortcut()` is `async` and reads the current value at call time
(`invoke('host:armShortcut')`), so a future rebind is reflected rather than frozen
at boot. It resolves; it does not reject, because we always have a command table —
unlike the extension, where a missing `chrome.commands` is a real fact worth
distinguishing from an unbound chord.

### 6.4 The gestures, concretely

| surface | gesture | notes |
|---|---|---|
| chrome view | the **Arm / Disarm** button | the first thing the owner touches. It is a toggle and it shows the refusal code inline when there is one |
| app menu | **Source → Arm** with `ARM_ACCEL` | the accelerator `armShortcut()` reports |
| automatic | none | arming is never implicit. The deck's `follow()` will start a pipeline on its own if it believes it is armed, and `shared/host.js` records what that cost once already |

**The view is muted for its whole life, not for the duration of a capture.**
`ytView.webContents.setAudioMuted(true)` is applied **before the view loads
anything** and is re-asserted on every `did-start-navigation`. The spike measured
why: variant (a) — relying on Chromium's capture-scoped local echo silencing —
leaked **1.90 s at peak 0.499893** between the view starting to play and
`getDisplayMedia` being called. There is no state of this product in which the
user should hear the raw view, so the mute has no reason to be conditional, and a
conditional mute has a window.

---

## 7. The model

### 7.1 Where the file is `[decided]`

```js
const MODEL_FILE = app.isPackaged
  ? path.join(process.resourcesPath, 'model', 'htdemucs_6s.onnx')   // extraResources
  : path.join(app.getAppPath(), 'models', 'htdemucs_6s.onnx');      // fetched, not in git
```

`electron-builder`'s **`extraResources`** rather than `asarUnpack`. Seed §15 says
"unpacked from asar (`asarUnpack`)" and both put a plain file on disk; the
difference is how you find it. `asarUnpack` leaves it under
`…/app.asar.unpacked/…`, whose path is derived by string surgery on
`app.getAppPath()` — a path that is correct until someone renames the asar.
`extraResources` gives `path.join(process.resourcesPath, …)`, which is a
documented location and the same shape on all three platforms. Differential
updates are unaffected: both are plain files in the app directory, and the model
block is unchanged between releases either way.

`process.resourcesPath` is used **only** when `app.isPackaged`; the two branches
are never conflated, because in development `process.resourcesPath` points inside
`node_modules/electron/dist` and would resolve to a file that is never there.

### 7.2 How it reaches the engine `[measured]`

`app://workbench/model/htdemucs_6s.onnx`, streamed by the protocol handler from
the absolute path above:

```js
if (u.pathname === '/model/htdemucs_6s.onnx') {
  const st = fs.statSync(MODEL_FILE);
  if (req.method === 'HEAD') return new Response(null, { headers: {...H, 'content-length': String(st.size)} });
  return new Response(Readable.toWeb(fs.createReadStream(MODEL_FILE)),
    { headers: { ...H, 'content-type': 'application/octet-stream', 'content-length': String(st.size) } });
}
```

`modelBytes` in the engine renderer is then **the extension's own function with a
different URL** — `fetch`, `res.body.getReader()`, accumulate, assemble. P4
measured the whole path: 114,559,139 bytes, 1383 chunks, first byte at 5 ms, 179 ms
end to end, 39 ms to assemble, `byteOffset === 0 && byteLength ===
buffer.byteLength` true.

**Why not `webContents.send` the bytes:** that is one 109 MB structured clone per
load, and there are two loads per session because there are two decks. The measured
alternative costs 179 ms and zero clones.

**Why not have the engine read the file directly:** it is sandboxed and has no
Node, deliberately. The protocol handler is the one place the filesystem is
touched, and it touches exactly the paths it decides.

The three rules from `shared/host.js` hold as follows:

| rule | how |
|---|---|
| 1. the Host does not verify | the handler streams bytes and computes nothing. The SHA-256 and byte count stay in `shared/config.js` and `modelcache.js::verifyModel` checks them over whatever arrives, every load |
| 2. `bytes` owns its whole buffer, fresh every call | a new `Uint8Array(got)` is allocated per call and filled; nothing is memoised, and `requireWholeBuffer` is what would catch us. **Measured true** in P4 |
| 3. `fromCache` is load-bearing | **always `false`.** The bytes are immutable: asking twice cannot improve them, so the unit must stop after one ask |

### 7.3 `modelCached` and `clearModel` `[decided]`

```js
modelCached: async () => { try { return (await invoke('model:stat')).ok === true; } catch { return false; } }
clearModel:  async () => {}                      // honest, and paired with fromCache:false
```

`model:stat` is `fs.stat` — exists and size > 0. It does **not** compare against
`MODEL.bytes` and does **not** hash: "is the install complete" is the Host's
question; "are these the right bytes" is the unit's, and a Host that verified
would be a Host that could decline to.

`true` here is the honest answer for a bundled file — the deck's question is *may
I spend the user's data*, and the answer is that no data will be spent. A pleasant
consequence: `maybePrepare()` fires at boot, so the ORT session is built before
the first play instead of during it.

`clearModel` resolving without doing anything is blessed by `shared/host.js`
**only** in combination with `fromCache: false`. Implementing the no-op while
reporting `fromCache: true` is the failure it warns about, and it turns one corrupt
file into a permanently dead deck. The two lines are one decision and the code will
carry a comment saying so.

**The consequence, named:** a corrupt bundled model fails the integrity check,
`clearModel` cannot help, and the deck is dead until the app is reinstalled. That
is the right outcome for a file that shipped in the installer, and the chrome view
should eventually say so in a sentence. v0 lets the unit's error stand.

---

## 8. The four things `VENDORING.md` says are not duties

> Read `extension/shared/host.js` for the duties. Four things are *not* duties and
> are easy to miss.

### 8.1 Originate four messages — done, and there are six

§5. The count is four *kinds* the section names inline (`CAPTURE_START`,
`CAPTURE_STOP`, `DECK_PREPARE`, `SESSION`) plus `ARM_ERROR` and
`ARM_ERROR_CLEARED` "if your product can refuse to arm". Ours can (§6.2), so it is
six.

### 8.2 The autoplay-next preference `[decided]`

> A Host that implements all six `DeckPage` duties still ships a dead checkbox.

The wire is a shared storage key, declared rather than closed in v1: the deck
writes the whole prefs object through `storageSet('local', PREFS_KEY, …)` and the
Host is expected to watch that key and act on the `autoplayNext` field.

**What we do:** `main` registers its own change listener on
`('local', PREFS_KEY)` — the same storage `main` implements, so this is a local
subscription, not another wire — reads `autoplayNext`, and asks the YouTube
preload to hold YouTube's autoplay-next toggle in the requested state, reporting
back through `page.onAutonav({state})`. The preload port of `autonav.js` keeps its
state vocabulary, because the deck's banner keys off the literals: `missing`,
`stuck` and `lost` paint a failure; anything else clears it.

It is checked by an assertion, not by a screenshot: flip the checkbox, and assert
that `main` observed the key **and** that the report came back — §10.

### 8.3 The one English sentence `[decided]` — we take it, and we do not patch it

> `ui/embed.js` prints "Click the Stem Splitter Live toolbar icon on this tab to
> arm it" when nothing is armed. That is true of a browser extension and of
> nothing else.

`VENDORING.md` calls it "a string a copy patches". **We will not patch it**, and
the reason is that the two documents disagree and one of them is load-bearing:

- ADR 0001 and the standing ruling for this phase say the unit is **vendored, not
  forked** — a patched vendored copy is the failure mode the ADR exists to prevent.
- `VENDORING.md` itself tells us to run `shasum -a 256 -c extension/unit.sha256`
  against our copy in our own CI, as the check that says whether that rule held.
  `ui/embed.js` is a unit file and is in that sums list. **Patching the string
  makes our own vendor-integrity gate go red**, and the fix for a red gate must
  never be to stop running it.

So v0 ships the sentence. It is cosmetic, it is on the first screenshot, and it is
half true: `armShortcut()` returns a real chord, so the deck prints *"Click the
Stem Splitter Live toolbar icon on this tab to arm it, or press ⌘⇧A"* and the
half the user can act on is the half that is true. It is recorded in
`docs/KNOWN-DEFECTS.md` with a screenshot, and it is
[finding F2](#11-findings-for-stem-splitter-live) against `stem-splitter-live`:
the honest fix is a duty in interface v1.1, which every existing Host then fails
at boot, loudly, by `assertHost` — exactly the upgrade path the freeze designed.

### 8.4 Cross-origin isolation — done and measured

§2. `[measured]` true, and `[measured]` red without the headers.

### 8.5 (the fifth paragraph) The model weights are not in the copy

§7. Bundled, `extraResources`, served over `app://`, verified by the unit on
every load.

---

## 9. What could go wrong

Ranked by *expected cost × probability that this design is wrong about it*. The
capture path is proven; nothing in the top four is.

### R1 — The unit has never run outside a Chrome extension `[unknown]`

Every line of the engine and the deck has only ever been exercised under MV3, on
an extension origin, in an offscreen document. First boot will find things this
document cannot predict: an `assetUrl` that resolves one path wrong, a CSP that
stops ORT, an OPFS call that behaves differently on a custom scheme, a worklet URL
that 404s quietly.

**Mitigation, in the order `VENDORING.md` prescribes:** (1) run
`node tools/verify.mjs --unit` on the fresh copy *before* swapping the holes and
record the green — `GREEN (partial …; 12 of 23 steps)`, 1156 assertions, 12/12
PASS. (2) Swap the holes, expect `unit` red, and **read the reds**: they are a
conformance report on our Host in the unit's own words. (3) Point `group('host')`
at our files (VENDORING option 3, and the standing ruling), so those 122
assertions become the Electron Host's conformance suite — which is what they are
for.

### R2 — Key routing and focus `[unknown]`

The deck's 1–6 must work while the user is clicking around inside the YouTube
view, and must **not** be stolen from YouTube when no deck is armed
(`claimKeys.armed` is exactly that gate; `content.js` treats it as "we are a
guest here"). `before-input-event` in `main` across three `WebContents` is the
design; it is untested, and the failure modes are both bad: swallowed YouTube
shortcuts, or a deck whose keys work only when the deck itself has focus (which is
almost never).

### R3 — Background throttling of a hidden engine `[unknown]`

§1.3. `backgroundThrottling: false` is the documented switch; whether it is
sufficient for a never-shown window on every platform is not something this box
can answer for macOS or Windows. The assertion in §10 is a heartbeat **count**,
which is the shape that catches it.

### R4 — CSP versus ORT's wasm `[unknown]`

Chromium requires `'wasm-unsafe-eval'` in `script-src` to compile WebAssembly when
`script-src` is restricted. §2.2 includes it. If ORT needs more (a `Blob` worker,
`unsafe-eval` for a glue path), the symptom will be a worker that fires `onerror`
with an **empty message** — `workerbackend.js` says so and probes with a HEAD
fetch precisely because of it. Settle it in the first hour of implementation, not
at the first arm.

### R5 — The capture claim's races `[unknown]`

Two arms in flight, a token that expires between claim and request, a denial that
leaves the engine's promise unsettled. The duty is unambiguous — `captureStream`
**must reject**, never resolve null — and `shared/host.js`'s whole `serialiseBackend`
essay is about what an unsettled promise costs (`inFlight` never clears, `pump()`
returns early for ever, the deck goes silent with nothing reported). Every branch
of the claim path must settle.

### R6 — `getDisplayMedia` and transient activation `[measured today, not promised]`

P1 measured that no activation is needed on Electron 44. The spec requires it, and
Electron's answer-in-main path is what currently bypasses the check. A future
Chromium could enforce it. **Named fallback:** grant the engine frame transient
activation from `main` in the same tick as the claim, either with
`webContents.executeJavaScript(';', /* userGesture */ true)` (activation lasts
~5 s) or with a synthetic `sendInputEvent`. Neither is needed today and both are
cheap; the risk is that we would discover the need on an Electron upgrade, so the
smoke should assert the arm→track path on every Electron bump.

### R7 — WebGPU on this box `[expected absent]`

`/dev/dri` exists but the run is under Xvfb; ORT will most likely take the
threaded-wasm fallback (R3 in `docs/ARCHITECTURE.md`: take the fallback, do not
spend a day optimising it). The gate must **accept either** and **assert which**:
`boot.ep` is `'webgpu'` or `'wasm'`, and `threads >= 2` in the wasm case. A gate
that demanded WebGPU would be red on a machine that is fine.

### R8 — Two decks, one engine, ~1.7 GB per ORT session `[read]`

`DECKS = ['A','B']`. v0 arms deck A only; `createBackend` is lazy for exactly this
reason and `offscreen/deck.js:18-25` forbids sharing a backend between decks. Do
not memoise `createBackend`. Do not add deck B in step 3.

### R9 — YouTube is not a gate `[read]`

`spike-capture-mute.md` Limitation 14: one recorded YouTube run measured a pre-roll
ad (`duration 60.101`, capture dipping to 0.00428). The permanent gate stays on
the local fixture. The accepted, named consequence: **nothing in CI will catch a
YouTube-side regression** — a player change, DRM returning silence, an
autoplay-muted default. That needs a manual re-check on a cadence.

### R10 — macOS and Windows are configured, never built `[decided, standing]`

electron-builder targets and CI workflows for all three platforms are written in
this phase; only Linux is built and run. Notarization, Azure Trusted Signing and
`electron-updater` against the pre-release channel are configuration with no
evidence behind them, and every document that mentions them says so in those
words.

### R11 — The preload bridge shape `[read, and cheap to get wrong]`

§4.4. `assertHost` catches a missing duty and cannot catch a duty that needs its
`this`. One assertion, one mutation, one line of prevention.

### R12 — `page.close()` and the deck's lifetime `[decided]`

Hiding the deck must not stop the audio; showing it again must repaint from
current state (`ready()` re-sends). Structurally safer here than in the extension,
but the re-send path is new code and is where "the deck came back blank" lives.

---

## 10. What the implementer must assert, and how each is falsified

`AGENTS.md` applies to this repository: **every assertion is watched red by
mutation**, a suite that exits 0 while asserting nothing is a hard failure, and a
count carries a claim wherever a stopwatch would.

| # | claim | assertion | mutation that must turn it red |
|---|---|---|---|
| A1 | the copy is the tag | `sha256sum -c extension/unit.sha256` in CI, 35 × `: OK` | edit one byte of any unit file |
| A2 | the unit arrived intact | `node tools/verify.mjs --unit` **before** the holes are swapped: 12/12 PASS, 1156 assertions | drop `engine/pitchbank.js` from the copy |
| A3 | our Host conforms | `group('host')` in `test.js`, repointed at our two hole files | remove the trailing slash from `assetUrl('vendor/ort/')` |
| A4 | the engine is isolated | `boot.sab === true` **and** `boot.coi === true` | delete COOP+COEP from the handler — **already watched red**: `SharedArrayBuffer is not defined` |
| A5 | ~~wasm really got threads~~ **`createBackend` forwarded the unit's hooks** | `onReady({threads}) → threads >= 2` | **not** A4 — measured: `threads` stays 4 with COOP/COEP gone, because ORT pins the number. Drop the `...hooks` spread in `createBackend` and it is `null`. See §2.4 |
| A6 | the hidden engine is not throttled | count `STATE` heartbeats received by the deck over 20 s: `>= 150` (10 Hz, 25 % slack) | delete `backgroundThrottling: false` |
| A7 | the capture is usable | on arm: exactly one live audio track, `channelCount 2`, `sampleRate 44100`, three processing flags `false` | call `getDisplayMedia({audio: true})` — the Limitation-6 run, which a floor-only gate calls PASS |
| A8 | the view is silent for its whole life | the permanent capture-mute gate, variant (b), **assertions 1–8** of `spike-capture-mute.md` § *The permanent gate* — never the original four | remove `setAudioMuted(true)`: 1.90 s at peak 0.499893 leaks |
| A9 | a duty may be called unbound | call a **detached** `assetUrl` (`const f = host.assetUrl; f('vendor/ort/')`) | re-export the preload bridge object instead of plain functions |
| A10 | the Host answers the deck | after boot with no engine window, assert the deck receives `SESSION` and `STATE` within the boot poll's 20 tries | delete the `SW_ENSURE_OFFSCREEN` case |
| A11 | the arm chord is in the unit's vocabulary | `chordLabel(await armShortcut(), mac).text` contains no `'CommandOrControl'` and equals `⌘⇧A` on darwin | answer `'CommandOrControl+Shift+A'` |
| A12 | autoplay-next is wired | flip the deck's checkbox → assert `main` observed `PREFS_KEY` **and** an `onAutonav` report arrived | delete `main`'s change listener |
| A13 | the model is whole | `modelBytes()` → `byteOffset === 0 && byteLength === buffer.byteLength`, `fromCache === false`, length `114559139` | return a `subarray` view |
| A14 | the app runs | the Linux smoke: launch, arm, capture opens, six stems present, exit 0 | any of the above |

A6, A5 and A10 are counts. A8 is the corrected gate, and the original
four-assertion form is banned by name because it passed a ruined capture.

---

## 11. Findings for `stem-splitter-live`

Reported, not patched. The unit is vendored, not forked; a change to it is a
change in the other repository behind a new tag.

**F1 — `VENDORING.md` documents the messages a Host must ORIGINATE and not the
ones it must ANSWER.** The deck sends six `SW_*` messages to `BUS.host`
(§5.3) and boots by polling for a reply. A Host that implements all 32 duties and
originates all six messages, but answers no `SW_*`, has a deck that never paints —
and there is nothing in `shared/host.js` or `VENDORING.md` that says so. Suggested
fix: a table in the `DeckHost.onMessage` typedef, beside the "what the Host must
originate" clause that is already there.

**F2 — the not-armed sentence cannot be patched by a copy that runs the
vendor-integrity check.** `VENDORING.md` names it "a string a copy patches", and
`ui/embed.js` is in `unit.sha256`, which the same document tells the copy to check
in its own CI. The two instructions conflict. Suggested fix, and it is the shape
the freeze already designed for: make the not-armed hint a Host-supplied string in
interface v1.1 — a duty added is a MINOR change that every existing Host fails at
boot, loudly, by `assertHost` naming it.

**F4 — `extension/autonav.js` does not travel with the unit, and nothing says
which reference-Host files a copy gets.** `unit.json` classifies `content.js`,
`speed.js` and `autonav.js` all as `host`, but `tools/vendor-unit.sh` §3 derives
the copy list from the unit's own files plus the holes, the `hostReads`, and
everything the declared suites and runners READ. `content.js` and `speed.js` are
read by `qa/speed-pitch.mjs` and `ui/embed-state.js`, so they come over;
`autonav.js` has no reader, so it does not — 50 files arrived and it is not one
of them. The consequence is asymmetric and invisible from either side: this Host
EXECUTES the vendored `speed.js`, so there is exactly one clamp on the machine,
and it had to PORT `autonavPlan`, `resolveSuppress` and the two selectors, which
can now drift from the extension's with nothing anywhere going red. The drift
shows up as a deck banner that never lights, because the deck keys off the
literals `missing`, `stuck` and `lost`. Suggested fix, cheapest first: say in
`VENDORING.md` which reference-Host files a copy actually receives and which it
must write itself — today a reader would reasonably assume all three arrive. The
fuller fix is to give `autonav.js` a reader `unit.json`'s derivation can see, at
which point a second Host executes it the way this one executes `speed.js`.

**F5 — `ARM_ERROR`'s `code` IS THE UNIT'S VOCABULARY, and the seam does not say
so.** `shared/host.js` declares `ARM_ERROR { code, message }` and stops there,
which reads as "any code you like". It is not: `ui/audio-math.js` holds
`ARM_CODES`, a set of eight, and `ui/embed.js` branches on membership at three
sites — `errorAction()` returns `'restart'` for a non-member and puts a Restart
button under a banner that restarting cannot fix (the unit's own comment calls
that the QA-16 footgun); `paintBanner` hides the dismiss × for a non-member; and
`case 'ARM_ERROR_CLEARED'` clears the banner ONLY for a member, so a Host that
invents a code can never retire its own refusal and the banner stands until
`ARM_ERROR_TTL_MS`. All three render perfectly. A second Host spelling the
obvious `code: 'NO_SOURCE'` ships an undismissable banner with a dead button and
nothing anywhere goes red.

Worse for a desktop Host: five of the eight members are TAB NOUNS (`TAB_GONE`,
`TAB_BUSY`, `TAB_UNSUPPORTED`, `NO_ACTIVE_TAB`, and `NEEDS_GESTURE`, which is
Chrome's activation rule), and the deck PRINTS the code in the banner title —
"Separation has no source — TAB_GONE". So the only members a product with no tabs
can use without putting a Chrome noun in front of the user are `NOT_ARMED`,
`ARM_FAILED` and `NOT_CAPTURING`. This Host uses the first two and refuses at
module evaluation if a future tag drops either (`src/main/deck-host.js`,
`ARM_REFUSALS`).

Suggested fix: name the set in the `onMessage` typedef beside the message shape,
the way `armShortcut`'s token vocabulary is named — and, at v2, let the Host
supply the SENTENCE rather than a code the deck decodes, which is the same shape
as finding F2.

**F6 — a hole module that throws at module scope CRASHES `group('host')` instead
of failing it.** `test.js` drives both holes with bare statements —
`deckHost.send(...)`, `await deckHost.storageGet(...)`, `deckHost.page.close()` —
with no `try` around them, and it `import`s them under plain Node. So a Host that
throws where a browser global is missing does not produce a red: it takes the
whole group down. Measured while building this Host: the run died at
`test.js:5577` after 482 assertions, and every assertion after it never ran.

That inverts the incentive the group exists to create. A second Host's most
honest first implementation — "this duty cannot work without its preload, so
say so loudly" — is exactly the one that makes the conformance report
unreadable, and the resulting stack trace looks like a broken vendored copy
rather than an unimplemented duty. Both of this Host's holes therefore hold a
rule the seam never asked for: NOTHING AT MODULE SCOPE TOUCHES A BROWSER-ONLY
GLOBAL IN A WAY THAT CAN THROW, and a missing bridge is one `console.error` plus
an inert answer per duty.

The cost of that workaround is also a finding: `storageGet` must then RESOLVE
where rule 6 says a failed read must REJECT, because a rejection at a bare
`await` is the same crash. This Host keeps rule 6 where it is observable (a real
bridge, `tools/suites/deck-host.mjs`) and breaks it only in the no-bridge case
the unit's own harness creates.

Suggested fix: wrap each duty drive in `group('host')` so a throwing duty is a
red naming that duty, and say in `VENDORING.md` that a hole is imported under
plain Node by the harness.

**F5 — `onReady({threads})` is a pin echoed, not a measurement, and this
document read it as one.** `workers/inference.worker.js:45-49` sets
`ort.env.wasm.numThreads` explicitly — deliberately, to keep ORT off its own
`!crossOriginIsolated -> 1` branch — and `onReady` reports the number that was
set rather than the number of threads the runtime obtained. Measured on Electron
44 / Chromium 152: with COOP and COEP removed from every response,
`crossOriginIsolated === false`, `SharedArrayBuffer` is unavailable in the
document, and `onReady` still says `threads: 4`. Anything downstream that reads
that field as evidence of shared memory — this document's §2.4 assertion 4 and
§10 A5 did — is reading a constant. Suggested fix upstream: report what the
worker can actually observe (`typeof SharedArrayBuffer === 'function'` inside the
worker, or `crossOriginIsolated`) alongside the pin, so a Host has a field whose
value can be false. Reported, not patched — the unit is vendored, not forked.

**F3 — `armShortcut`'s vocabulary is documented in prose and gated nowhere.** A
Host answering `'CommandOrControl+Shift+9'` renders "CommandOrControl" on the key
cap and nothing goes red. `chordLabel()` could refuse a token outside its
vocabulary (or report it), turning a silent cosmetic failure into a visible one.
Low priority, mentioned because this Host is the first that could have made the
mistake.

---

## 12. File layout

```
stem-workbench/
  src/main/          main.js protocol.js bus.js arm.js capture.js model.js
                     storage.js keys.js youtube.js speed.js autonav.js menu.js
  src/preload/       engine.cjs deck.cjs chrome.cjs youtube.cjs
  src/renderer/      engine.html  chrome.html  chrome.js  chrome.css
  vendor/stem-splitter-live/        ← the 50-file copy at v0.2.0, layout preserved
      extension/…                     35 unit files, byte-identical, gated by A1
      extension/offscreen/host.js     ← OURS (a hole)
      extension/ui/host.js            ← OURS (a hole)
      extension/offscreen/host-pin.js ← OURS (required by tools/verify.mjs at module scope)
      extension/vendor/ort/           ← fetched by tools/fetch-vendor.sh, never copied
  models/            htdemucs_6s.onnx   ← dev only, not in git
  tools/             vendor-unit.sh verify.mjs suites/
  docs/              HOST-DESIGN.md  spike-capture-mute.md  KNOWN-DEFECTS.md
```

**Our three files live at the hole paths inside `vendor/`, and that is correct.**
The holes are not unit files and are not in `unit.sha256`, so replacing them leaves
A1 green — which is precisely the check that tells us nobody edited the unit. A
`tools/vendor-unit.sh` manifest (`vendor/.pin`'s `ours`) names the three files
that are ours, so "did someone
edit the unit" and "did someone edit our Host" stay two separately answerable
questions.

The engine's page is **ours**, at `app://workbench/engine.html`, and it loads the
unit's entry by relative URL:

```html
<script type="module" src="./vendor/stem-splitter-live/extension/offscreen/engine.js"></script>
```

ES module specifiers inside `engine.js` resolve against the **module's** URL, not
the document's, so every `../shared/…` and `../workers/…` lands inside the vendored
tree. The deck needs no page of ours at all: `ui/embed.html` is a unit file and the
deck view loads it directly.

---

## Appendix A — the design probe, verbatim

Run under `xvfb-run -a`, Electron 44.0.0, `--no-sandbox` (this box has no
`chrome-sandbox` SUID helper). Four files. The results quoted in §0 come from
`--iso=headers`, `--iso=none`, `--iso=flag`, a variant with the source view moved
to `session.fromPartition('persist:youtube')` (P3), and a second main for P4.

`main.js`:

```js
import { app, protocol, session, BaseWindow, WebContentsView } from 'electron';
import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const ISO = arg('iso', 'headers');                       // headers | none | flag
const OUT = arg('out', path.join(HERE, `result-${ISO}.json`));

protocol.registerSchemesAsPrivileged([{ scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
if (ISO === 'flag') app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer');

const R = { iso: ISO, versions: process.versions };
const finish = (code) => { fs.writeFileSync(OUT, JSON.stringify(R, null, 2)); app.exit(code); };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm' };

app.whenReady().then(async () => {
  protocol.handle('app', async (req) => {
    const u = new URL(req.url);
    const file = path.join(HERE, 'app', u.pathname === '/' ? '/index.html' : u.pathname);
    const headers = { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
                      'cross-origin-resource-policy': 'same-origin' };
    if (ISO === 'headers') {
      headers['cross-origin-opener-policy'] = 'same-origin';
      headers['cross-origin-embedder-policy'] = 'require-corp';
    }
    let body = null;
    try { body = fs.readFileSync(file); } catch { return new Response('not found', { status: 404 }); }
    if (req.method === 'HEAD') return new Response(null, { headers: { ...headers, 'content-length': String(body.length) } });
    return new Response(body, { headers });
  });

  const win = new BaseWindow({ width: 1200, height: 900, show: true });

  const src = new WebContentsView();                     // P3: { webPreferences: { session: session.fromPartition('persist:youtube') } }
  win.contentView.addChildView(src);
  src.setBounds({ x: 0, y: 400, width: 1200, height: 400 });
  await src.webContents.loadURL('data:text/html,<title>src</title>');
  src.webContents.setAudioMuted(true);
  R.viewMuted = src.webContents.isAudioMuted();

  session.defaultSession.setDisplayMediaRequestHandler((request, cb) => {
    R.gdmHandlerCalled = (R.gdmHandlerCalled || 0) + 1;
    cb({ video: src.webContents.mainFrame, audio: src.webContents.mainFrame });
  });

  const eng = new WebContentsView({ webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  win.contentView.addChildView(eng);
  eng.setBounds({ x: 0, y: 0, width: 1200, height: 400 });
  await eng.webContents.loadURL('app://bundle/index.html');

  R.pass1 = await eng.webContents.executeJavaScript('window.probeRun()');          // no user gesture
  R.pass2 = await eng.webContents.executeJavaScript('window.probeGesture()', true); // with one
  finish(0);
}).catch((e) => { R.fatal = String(e && e.stack || e); finish(1); });
```

`app/index.html`:

```html
<!doctype html><meta charset=utf8><title>probe</title>
<script type="module" src="./engine.js"></script>
```

`app/engine.js` (abridged to the five measurements; each records into `R`):

```js
const R = { href: location.href, origin: location.origin };
R.crossOriginIsolated = self.crossOriginIsolated === true;
try { R.sabCtor = new SharedArrayBuffer(1024).byteLength === 1024; }
catch (e) { R.sabCtor = 'THREW ' + String(e.message || e); }

async function gdm(tag) {                       // (1) activation
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: true });
    const a = s.getAudioTracks()[0];
    R[tag] = { ok: true, audioTracks: s.getAudioTracks().length, settings: a ? a.getSettings() : null };
    for (const t of s.getTracks()) t.stop();
  } catch (e) { R[tag] = { ok: false, name: e.name, message: String(e.message || e) }; }
}
async function worker() {                       // (2) module worker + SAB
  const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  R.moduleWorker = await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('worker timeout')), 5000);
    w.onerror = (e) => { clearTimeout(t); rej(new Error('worker onerror: ' + (e.message || '(empty)'))); };
    w.onmessage = (e) => { clearTimeout(t); res(e.data); };
    w.postMessage({ sab: new SharedArrayBuffer(8) });
  }).catch((e) => 'THREW ' + String(e.message || e));
}
async function worklet() {                      // (3) AudioWorklet at 44100
  const ctx = new AudioContext({ sampleRate: 44100, latencyHint: 'playback' });
  await ctx.audioWorklet.addModule(new URL('./worklet.js', import.meta.url).href);
  R.audioWorklet = { ok: true, sampleRate: ctx.sampleRate, node: !!new AudioWorkletNode(ctx, 'probe-proc') };
}
async function opfs() {                         // (4) OPFS on a custom scheme
  const root = await navigator.storage.getDirectory();
  const d = await root.getDirectoryHandle('probe', { create: true });
  const f = await d.getFileHandle('x.bin', { create: true });
  const w = await f.createWritable(); await w.write(new Uint8Array([1, 2, 3])); await w.close();
  R.opfs = { ok: true, size: (await f.getFile()).size };
}
async function fetchProbe() {                   // (5) HEAD, for probeRuntime()
  const h = await fetch(new URL('./worker.js', import.meta.url).href, { method: 'HEAD' });
  R.fetchHEAD = { ok: h.ok, status: h.status, corp: h.headers.get('cross-origin-resource-policy') };
}
window.probeRun = async () => { await gdm('gdmNoGesture'); await worker(); await worklet(); await opfs(); await fetchProbe(); return R; };
window.probeGesture = async () => { await gdm('gdmWithGesture'); return R; };
```

`app/worker.js`:

```js
self.onmessage = (e) => {
  const sab = e.data && e.data.sab;
  let ok = false, len = -1;
  try { const v = new Int32Array(sab); Atomics.store(v, 0, 7); ok = Atomics.load(v, 0) === 7; len = sab.byteLength; }
  catch (err) { ok = String(err); }
  self.postMessage({ sabInWorker: ok, byteLength: len, coi: self.crossOriginIsolated === true });
};
```

`app/worklet.js`:

```js
class ProbeProc extends AudioWorkletProcessor { process() { return true; } }
registerProcessor('probe-proc', ProbeProc);
```

P4's second main serves one path from a 114,559,139-byte file with
`Readable.toWeb(fs.createReadStream(...))` and a `content-length`, and the renderer
drains it with `res.body.getReader()`:

```
{ headOk: true, headLen: 114559139, total: 114559139, got: 114559139, chunks: 1383,
  firstByteMs: 5, streamMs: 179, assembleMs: 39, wholeBuffer: true, coi: true }
```

### Recorded results

| run | `coi` | `sabCtor` | worker | `gdmNoGesture` | worklet | opfs |
|---|---|---|---|---|---|---|
| `--iso=headers` | **true** | true | `{sabInWorker:true, byteLength:8, coi:true}` | **ok**, stereo 44100, AGC/EC/NS false | ok @44100 | ok |
| `--iso=none` | false | **`SharedArrayBuffer is not defined`** | **THREW, same** | ok | ok @44100 | ok |
| `--iso=flag` | false | true | `{sabInWorker:true, coi:false}` | ok | ok @44100 | ok |
| P3 (`persist:youtube` source) | true | true | — | **ok**, `web-contents-media-stream://5:1?local_echo=false` | — | — |

Electron 44.0.0 · Chromium 152.0.7977.54 · Node 24.18.1 · V8 15.2.124.13-electron.0 ·
Linux 6.17.0-41-generic x64 · Xvfb 1280×1024×24 · **no macOS evidence anywhere in this table.**
