# stem-workbench — architecture

One Electron desktop app. It plays a YouTube page it embeds itself, or a file
off your disk, separates either into six stems on-device, mixes them back
through a deck in its own window, and writes the stems to disk.

> ## Status: this describes a product that does not exist yet
>
> | | |
> |---|---|
> | **Built and measured** | the capture/mute mechanism, on Linux only — `docs/spike-capture-mute.md`. `spike/` is throwaway code, not the product. And the Host's plumbing — cross-origin isolation, the `app://` scheme, the cross-session capture — measured by the design probe recorded in `docs/HOST-DESIGN.md` |
> | **Designed** | the Host: `docs/HOST-DESIGN.md`, which tags every decision `[decided]`, `[measured]` or `[unknown]` |
> | **Vendored** | nothing yet |
> | **Built** | nothing |
>
> Read this as the map of a design, and
> [§7](#7-what-is-verified-what-is-configured-and-what-is-only-written-down)
> for the difference between *verified*, *configured but never built* and
> *written down only*. Sentences about behaviour are in the present tense
> because that is how a design document reads; **not one of them is a report of
> a running application.**
>
> **This page is the map; [`docs/HOST-DESIGN.md`](HOST-DESIGN.md) is the
> design.** Where the two disagree, that one is right and this one is stale.
> [§8](#8-what-is-decided-and-what-is-still-open) is what is still open.

Read `CONTEXT.md` for the words. Read `CONTRIBUTING.md` for the rules that
govern edits — especially the one about not editing the vendored copy. The
engine's own DSP and numbers are documented in `stem-splitter-live` at the tag
this product vendors: `docs/ARCHITECTURE.md`, `docs/AUDIO.md`,
`docs/SIX-STEM-CONTRACT.md`.

---

## 0. The decisions everything else follows from

Recorded, with their alternatives and their sources, in
[`docs/adr/0001-the-shape-of-the-desktop-product.md`](adr/0001-the-shape-of-the-desktop-product.md).

| | decision | consequence |
|---|---|---|
| **1** | **Electron, not Tauri.** Chromium ≥ 128 is the engine's floor, so Electron ≥ 32; the spike ran 44. | The three things Tauri lacks are the three things the engine needs: capture of an embedded frame's audio, `SharedArrayBuffer`, WebGPU. It also means this app owns a Chromium, and therefore owns Chromium's security patches — which is why auto-update is on by default (§6). |
| **2** | **The audio comes from `getDisplayMedia`, answered by the main process with the YouTube view's `mainFrame`, and the view is muted before it plays.** | There is no `chrome.tabCapture` in Electron. The mute is what makes the product possible at all: the app hears the view, the user does not. Measured on Linux; **not** on macOS. §3. |
| **3** | **The shape is a player window: youtube.com in a `WebContentsView`, the deck in the host window beneath it.** | No address bar, no tabs, navigation allow-listed. The deck is *not* injected into YouTube's DOM — same reasoning as the extension's, minus the iframe: YouTube's origin, YouTube's CSP, one stylesheet change from breaking. |
| **4** | **The engine and the deck are VENDORED, not forked.** 35 files copied at tag `v0.2.0` and verified against `extension/unit.sha256`. | This repository writes a **Host** and nothing else that is audio. A unit file that differs from its recorded hash is a fork, and the check that says so is meant to run in CI. §2. |
| **5** | **The model ships inside the installer**, as an extra resource beside the asar. | No first-run download, works offline from first launch — and this product becomes a **distributor** of CC BY-NC 4.0 weights, so it is non-commercial permanently. `NOTICE.md` is the constraint, not a footnote. §5. |
| **6** | **One `AudioContext` at 44 100 Hz and no JS resampling on the live path.** | Inherited from the unit, and it survives into Electron *only if the Host asks for it*: the captured track is already 44 100 / stereo, but a default renderer `AudioContext` opens at 48 000 and inserts a resampler. Measured. §4. |

**The app's own code talks to exactly one host on the network, ever** — GitHub
Releases, for the update check. That is **P1′**, the successor to the
extension's P1, and it is an acceptance test rather than an aspiration.
`PRIVACY.md` states it in the user's words; §6 states it in the code's.

---

## 1. Process topology

**[`docs/HOST-DESIGN.md`](HOST-DESIGN.md) is the design.** It carries the code,
the measurements behind each decision, and a `[decided]` / `[measured]` /
`[unknown]` tag on every one. This section is the map: five contexts, four
renderers, and why each exists. Where the two disagree, HOST-DESIGN.md is right
and this page is stale.

```
┌─ MAIN — Electron, Node, no DOM ──────────────────────────────────────────┐
│ the Host's privileged half: the MV3 service worker's job, minus the 30 s │
│ idle death — so it may hold state in module scope, and it does.          │
│                                                                          │
│ · setDisplayMediaRequestHandler .............. the capture grant         │
│ · ytView.webContents.setAudioMuted(true) ..... BEFORE the first load     │
│ · the app:// protocol handler, and COOP/COEP on every response it makes  │
│ · the bus router · storage · the arm gesture · the key router            │
│ · the navigation allowlist · the model's path · the menu accelerator     │
│ · originates six messages — and ANSWERS six more   (BUS.host = 'sw')     │
└──────────────────────────────────────────────────────────────────────────┘

        │ owns, lays out and routes for everything below
        ▼
┌─ THE PLAYER WINDOW — BaseWindow → contentView ───────────────────────────┐
│ three child views with disjoint bounds; "beneath" is layout, not z-order │
│                                                                          │
│ chromeView  app://workbench/chrome.html ................... OURS         │
│      the arm control and the source bar. There is no toolbar icon here,  │
│      so something has to be the first thing the owner touches.           │
│                                                                          │
│ ytView      persist:youtube · youtube.com ................. THE VIEW     │
│      MUTED, and captured. Default-deny navigation, no popups, no         │
│      downloads, every permission denied — display-capture by name.       │
│      preload/youtube.cjs ................................. THE TRANSPORT │
│           exposes NOTHING on window. Reads paused, currentTime,          │
│           duration, ended, playbackRate, seeking. Writes muted,          │
│           currentTime, playbackRate — those three and nothing else. (L1) │
│                                                                          │
│ deckView    app://workbench/…/ui/embed.html ............... THE DECK     │
│      ui/embed.html · ui/embed.js ......................... UNIT          │
│      ─────────────────────────────────────────                           │
│      ui/host.js .......................................... HOLE          │
│           our DeckHost, and its .page and .transport                     │
└──────────────────────────────────────────────────────────────────────────┘

        │
        ▼
┌─ THE ENGINE — a hidden BrowserWindow, app://workbench/engine.html ───────┐
│ backgroundThrottling: false, and that line is load-bearing               │
│ AudioContext @ 44100 · SharedArrayBuffer · WebGPU · workers · OPFS       │
│ · the captured MediaStream                                               │
│                                                                          │
│ offscreen/engine.js ....................................... UNIT         │
│ ──────────────────────────────────────────                               │
│ offscreen/host.js ......................................... HOLE         │
│      our EngineHost. Calls getDisplayMedia() and stops the video track.  │
└──────────────────────────────────────────────────────────────────────────┘

┌─ A UTILITY PROCESS — a native Backend ───────────────────────────────────┐
│ NOT v1. The seam exists; the process does not. Issue #16.                │
└──────────────────────────────────────────────────────────────────────────┘
```

**Five contexts, four renderers.** The extension has the same five; only two of
them were pages there. The mapping is one-to-one and it is worth reading that
way: `main` is the service worker, the hidden window is the offscreen document,
`deckView` is the injected iframe, `ytView` is the watch page plus `content.js`,
and `chromeView` is `ui/welcome*` — the one that does not travel, because its
whole job is to explain how to arm *that* product in *that* browser.

**`BaseWindow`, not `BrowserWindow`.** A `BrowserWindow` would give the window a
top-level `WebContents` of its own with nothing to put in it, and an implicit
z-order and focus relationship to three attached views. The spike used one
because it needed a host page to *make* the `getDisplayMedia` call; in the
product that call is the engine's.

**Two sessions, and the split is a privacy boundary rather than a convenience.**
The default session holds `chrome`, `deck` and `engine` — our origin, our OPFS,
our storage, and the `app://` handler. `persist:youtube` holds the YouTube view
and nothing else: cookies, sign-in state, and every byte YouTube stores are
reachable from nothing but that view. It is what lets
[`PRIVACY.md`](../PRIVACY.md) say something true *and* narrow instead of
something reassuring.

**The capture crosses that boundary, and that was measured** — the engine, on the
default session, captured a frame owned by a view on `persist:youtube`. Without
that measurement the two-session design would have been a guess.

**Why the engine is a hidden window and not the deck's renderer.** It needs
`SharedArrayBuffer`, WebGPU, `AudioWorklet`, OPFS and the captured stream; the
deck needs none of them. Separating them also makes one of the deck's promises
structural instead of conventional: *closing the deck does not stop the audio* is
something the extension keeps by convention — the offscreen document happens to
be a different context — and that this Host keeps because it is a different
**process**, and hiding a view cannot reach one.

**`backgroundThrottling: false` is not a tuning knob.** The engine's real-time
work is on the audio thread and is not throttled, but the orchestration around it
is: a 10 Hz status heartbeat and the live pump run on ordinary timers, and
Chromium coalesces a hidden renderer's timers to about 1 Hz. That does not stop
the audio — it starves the thing that feeds it.

**Never `destroy()` the engine window; `close()` it.** `onTeardown` is
`pagehide`, and `pagehide` is what stops the capture tracks. `destroy()` skips
it, and the leak here is not a muted tab but a live capture and a ~1.7 GB wasm
heap.

**Why the deck is a view and not an iframe.** The extension needs an iframe
because it is drawing into somebody else's page. This product owns its window, so
the deck is a top-level document — which is exactly the case Host interface v1
fixed with `host.transport != null`: the deck used to ask
`window.parent !== window` to learn whether it was hosted, and under this Host
that answers "no" while the deck plainly *is* hosted, which `follow()` reads as
licence to start a capture and a model load on boot.

There is a second reason, and it is the one that fails confusingly: **COEP never
touches youtube.com.** The YouTube view is a sibling with its own top-level
document in its own session — not a subresource and not an iframe of ours — so
`require-corp` (§2) has no opinion about it. The opposite choice fails in a way
that looks like YouTube's fault.

---

## 2. The seam

### What is vendored

35 files, copied at tag **`v0.2.0`** by the procedure in the upstream
`docs/VENDORING.md`, with the repo-relative layout preserved because the layout
is part of the contract. **Fifty paths in all**, as the upstream document counts
them: 35 unit, 5 reference Host, 14 harness — seven of which are unit files that
are their own suite, and are therefore already counted — plus
`extension/unit.sha256` and `tools/fetch-vendor.sh`. The sums file is what a copy
is verified against, twice: once against the downloaded archive and once against
the copy on disk, because those two fail for different reasons.

`vendor/` also gets ONNX Runtime Web, ~27 MB at `onnxruntime-web@1.27.0`,
fetched by the unit's own `tools/fetch-vendor.sh`. **We run the script; we do not
copy anyone's drop.** That script verifies TWO of the four artefacts against
SHA-256s recorded inside itself and copies the other two — including the
Emscripten glue `.mjs` its own comment says is loaded and run — with no hash at
all. Rule V1 forbids fixing that here (`docs/CONFORMANCE.md` §6b, finding
F-ORT), so this repository pins **all five files** itself in `vendor/.pin`'s
`ort` block, and `bash tools/vendor-unit.sh --check` re-hashes the directory
offline on every `vendor-intact` run — set comparison included, so a file added
to it is red too.

**The vendored copy is not edited. Ever.** If the unit is wrong, that is a
finding to report upstream and a change behind a new tag there — not a patch
here. `CONTRIBUTING.md` states the rule and names the check.

### What this Host writes

Two modules, at the two paths the unit imports:

| path | interface | what it is here |
|---|---|---|
| `extension/offscreen/host.js` | `EngineHost` | the display-media capture, the message bus, asset URLs, the bundled model's bytes, and `createBackend` |
| `extension/ui/host.js` | `DeckHost` | the deck's messaging, storage, the arm chord (`null`), plus `.page` and `.transport` |

Plus everything a Host is that is not a hole: `main`, the four preloads, the
window and its three views, the update check, the export writer, the vendor
script and the gates.

**Our modules live at the hole paths, inside `vendor/`, and that is correct.**
The holes are not unit files and are not in `unit.sha256`, so replacing them
leaves the integrity check green — which is precisely the check that says nobody
edited the unit. A third file, `offscreen/host-pin.js`, is ours for a blunter
reason: the upstream runner imports four names from it at module scope, so the
runner does not load without a file at that path. The vendor script keeps a
manifest of the three files that are ours, so *"did somebody edit the unit"* and
*"did somebody edit our Host"* stay two separately answerable questions.

### The duties

The five frozen duty tables name **thirty**: nine `EngineHost`, six `DeckHost`,
six `DeckPage`, six `DeckTransport`, three `Backend`. `DeckHost` must also
carry `page` and `transport` as **keys** — `transport: null` is a sentence this
Host has to write if it has no player, and an absent key is refused rather than
read as a decision. Thirty-two things to answer for, and `assertHost()` refuses
a Host short any of them at module evaluation rather than at the user's gesture.

### The four things that are not duties

`assertHost()` cannot check for a message nobody sent. These four are the ones
`docs/VENDORING.md` singles out, and they are where a second Host silently ships
a broken product. All four are decided; the detail and the code are in
[`docs/HOST-DESIGN.md`](HOST-DESIGN.md) §8.

| what | how this Host discharges it |
|---|---|
| **Originate messages** — `CAPTURE_START { sourceToken, source: {title, url}, deck? }`, `CAPTURE_STOP`, `DECK_PREPARE` to the engine; `SESSION { session: { armed, title, url, armedAt } }`, `ARM_ERROR` and `ARM_ERROR_CLEARED` to the deck, because this product **can** refuse to arm. | `main` is `BUS.host` — the address the unit spells `'sw'`. **And there is a half nobody lists:** the deck also *sends* to `BUS.host` and expects an answer. A Host that originates all six and answers none is a deck whose arm button does nothing. HOST-DESIGN §5.3. |
| **`sourceToken`** — opaque to the unit, minted by the Host, handed straight back to `captureStream`. | A **one-shot capture claim**: a UUID in `main`'s map, bound to the current arm epoch and to the YouTube view's `WebContents` id, with a 10 s expiry. `captureStream` claims it before calling `getDisplayMedia`, and the display-media handler refuses any request that has no pending claim or whose frame is not the engine's. **A request the app did not initiate is refused by construction** — which keeps the property Chrome's per-tab grant forced on the extension, after losing the mechanism that forced it. |
| **Watch `prefs.autoplayNext`.** The deck writes it through `storageSet('local', PREFS_KEY, …)` and nothing tells the Host to act on it. A Host that implements all six `DeckPage` duties and skips this ships a **dead checkbox**. | `main` implements the storage, so it subscribes to its own `('local', PREFS_KEY)` and asks the YouTube preload to hold YouTube's toggle in the requested state, reporting back through `page.onAutonav`. The preload keeps `autonav.js`'s state vocabulary — `missing`, `stuck`, `lost` — because the deck's banner keys off those literals. It is **also load-bearing for live Export**: autoplay-next has to be suspended while a live export runs, or the next video records into the same file. |
| **The one English sentence.** `ui/embed.js` prints *"Click the Stem Splitter Live toolbar icon on this tab to arm it"* when nothing is armed. `VENDORING.md` calls it "a string a copy patches". | **We do not patch it, and the reason is the vendoring rule.** `ui/embed.js` is a unit file and is in `unit.sha256`; patching it makes our own vendor-integrity gate go red, and the fix for a red gate is never to stop running it. So v0 ships the sentence — half true, because `armShortcut()` returns a real chord and the deck prints *"…, or press ⌘⇧A"* alongside it. It is a recorded known defect, and a **finding against `stem-splitter-live`**: the honest fix is a duty in interface v1.1, which every existing Host then fails at boot, loudly, by `assertHost` — exactly the upgrade path the freeze designed. |
| **Arrange cross-origin isolation.** The engine constructs `SharedArrayBuffer`s directly and asserts on the constructor, not on `crossOriginIsolated`. | A privileged `app://` scheme (`standard`, `secure`, `supportFetchAPI`, `stream`) with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on **every** response. **Measured** true, and measured red without the headers. Workers and worklets inherit: the ORT module worker saw `crossOriginIsolated: true` and a working `Atomics.store`. The process-wide `SharedArrayBuffer` feature switch also works and is the **recorded fallback**, not the plan — it turns SAB on for every renderer including youtube.com's, and leaves `crossOriginIsolated: false`, which the deck would then show as an honest visible degradation rather than a silent one. |

`supportFetchAPI` is on that list because the unit names it: `workerbackend.js`
probes the ORT bundle with `fetch(url, {method:'HEAD'})`, and a scheme that
refuses `fetch` turns that diagnosis into a false report about a file that is
present.

### What the Host does NOT get to do

- **It does not normalise messages.** `onMessage` hands the unit the raw
  envelope. Re-wrapping or filtering breaks receivers quietly.
- **It does not decide whether the model is the model.** The SHA-256 and the
  byte count live in the unit and run on every load over whatever the Host hands
  over. A Host that verified would be a Host that could decline to.
- **It does not widen the transport's write set.** `muted`, `currentTime`,
  `playbackRate` — those three and nothing else, filtered at the Host end *and*
  named at the unit's call site. Belt and braces, because this channel reaches a
  `<video>` on somebody else's page and L1 is a security property.

---

## 3. The capture path

**This is the one mechanism the whole product rests on, and it is the only thing
in this repository that has been measured.** The full write-up, its fifteen
numbered limitations and the corrected gate specification are in
[`docs/spike-capture-mute.md`](spike-capture-mute.md). Read the Limitations
section before citing any number from it.

```
  main:      session.setDisplayMediaRequestHandler((req, cb) => cb({
               video: ytView.webContents.mainFrame,
               audio: ytView.webContents.mainFrame,
             }))
             ytView.webContents.setAudioMuted(true)   ← BEFORE the view plays

  renderer:  navigator.mediaDevices.getDisplayMedia({
               video: true,                            ← the spec forbids audio-only
               audio: { autoGainControl:   false,
                        echoCancellation:  false,
                        noiseSuppression:  false },
             })
             .then(s => { s.getVideoTracks()[0].stop(); … })
```

**The mute must land before the view plays.** The variant without it — capture
only, no mute — leaked **1.90 s of full-level audio** to the speakers between
the view starting to play and `getDisplayMedia` being called. The spike's first
instrument could not see that leak, because it only started measuring when the
capture opened; a stronger instrument that recorded the app's whole lifetime
caught it and turned that variant from PASS into FAIL. **A user must not hear a
1.9 s burst of the original every time they arm the deck.**

**The three processing constraints are not optional.** A naive
`getDisplayMedia({ audio: true })` yields **mono, 48 kHz, AGC on** — and the
level decayed 17× over 8 seconds. That stream is a dead product for stem
separation, and it *looks* fine to a gate that only checks a floor. Hence the
band, and hence the `getSettings()` assertion.

**There is no capture feedback loop.** With the host page playing a 700 Hz tone
at peak 0.5 while the muted view played 440 Hz, the capture stayed at the
440-only level and the sink read 700 Hz at 0.494564 against 440 Hz at 0.000144 —
97 of 99 consecutive 50 ms blocks read exactly zero at 440. The capture is
frame-scoped: **the deck can play stems at full level while the view is
captured, and the capture does not pick them up.** That is what makes this
product possible, and the spike did not set out to prove it — a review did.

**What the permanent gate must assert** — eight assertions, not the four the
spike first proposed, because review built a run that satisfied all four while
producing a ruined stream. The list is in the write-up's *The permanent gate*
section and is tracked as
[#3](https://github.com/itziklerner-pag/stem-workbench/issues/3).

**What has NOT been shown:**

- **macOS.** Every recorded run says `platform: linux`. The plan writes its kill
  criterion against macOS and marks Linux explicitly non-blocking, so this
  program is proceeding on a **decision**, not on the criterion having been met.
  [#2](https://github.com/itziklerner-pag/stem-workbench/issues/2).
- **Real speakers.** `aplay -l` finds no soundcards on the machine that produced
  the evidence. "Silence" is zero-valued PCM in a virtual sink, never a thing
  anybody heard.
- **YouTube as a repeatable gate.** One recorded YouTube run was measuring a
  pre-roll ad. CI stays on a local fixture, and the accepted cost is that
  **nothing in CI will ever catch a YouTube-side regression** — that needs a
  manual re-check on a cadence.

---

## 4. The audio path

Unchanged from the unit — the capture ring, the causal chunk plan, the ONNX
session, the seam crossfade, the stem ring, the optional transpose, the playback
worklet with per-stem gain, mute, solo, master trim, soft clip and meters. It is
documented in the upstream `docs/ARCHITECTURE.md` §3 and `docs/AUDIO.md`, and
this Host has no business in it.

Two things the Host must nonetheless get right:

**One rate, 44 100, and the Host has to ask for it.** The captured track already
reports `sampleRate: 44100, channelCount: 2` — measured, on both a local fixture
and a real watch page, every run. But a **default** renderer `AudioContext`
opens at 48 000, which inserts a resampler in exactly the place the upstream
`CONTRIBUTING.md` forbids one. Opening the context explicitly at 44 100 was
measured end to end with no resampler anywhere on the path.

**A Live source is bound by real time and a File source is not.** The deck runs
about 3.4 s behind the picture at the default hop, because a Live source arrives
as the player plays. A File source is decoded whole and separated ahead of time
at engine speed into a 32-bit-float cache tier, and the deck plays from that
with free seeking and no lag — which is why the deck, not a video element, is
the transport master for a File source. Neither is built:
[#4](https://github.com/itziklerner-pag/stem-workbench/issues/4) is the
ahead-of-time separation and the 32f tier,
[#5](https://github.com/itziklerner-pag/stem-workbench/issues/5) is the
transport.

---

## 5. The model, and ONNX Runtime

| | |
|---|---|
| **what** | Demucs `htdemucs_6s`, ONNX re-export, 114,559,139 bytes |
| **licence** | **CC BY-NC 4.0 — non-commercial.** See `NOTICE.md`; it decides what this product may become |
| **where** | inside the installer, as an **`extraResources`** file at `process.resourcesPath/model/` — served to the engine over `app://`. Seed §15 said `asarUnpack`; both put a plain file on disk and the difference is how you *find* it. `asarUnpack` leaves it under `…/app.asar.unpacked/…`, a path derived by string surgery on `app.getAppPath()` that is correct until somebody renames the asar. Differential updates are unaffected either way |
| **verified** | SHA-256 and byte count, **by the unit, on every load**, over whatever this Host hands it |
| **runtime** | ONNX Runtime Web 1.27.0, WebGPU with the threaded-WASM fallback, fetched at vendor time by the unit's `tools/fetch-vendor.sh` — which pins two of its four artefacts — and hash-verified in full by `vendor/.pin`'s `ort` block on every `vendor-intact` run (§2) |

Bundling is what removes the first-run download and the third-party single point
of failure — and it is also what makes this product a redistributor of
non-commercial weights. The two are the same decision, and `NOTICE.md` carries
it.

Installers land around 300 MB. Windows NSIS and macOS zip updates are
differential, so the unchanged model blocks are not re-downloaded; a Linux
AppImage update re-ships the whole artifact.

---

## 5b. The second inference backend, and the plan's claim it corrects

Seed §16 put the Host's inference behind three duties — `load`, `separate`,
`dispose` — so that a native backend is a second implementation rather than a
fork of the engine. The ORT worker is backend #1. Step 7 adds backend #2:
**CoreML, in an Electron utility process, on Apple Silicon.**

**CONFIGURED AND WRITTEN, NEVER BUILT OR RUN.** There is no macOS here and
`onnxruntime-node` is not a dependency of this project, so **no CoreML session
has ever been created, no segment has ever been separated by one, and nothing
has ever been timed.** `tools/suites/backend-coreml.mjs` is the step that would
answer it and it has never run anywhere; `docs/TESTING.md` §5g. On this platform
the selection's platform gate makes the answer the worker before anything is
forked, and `tools/suites/backend.mjs` is what proves it.

**The same ONNX, the same STFT, a different ORT binding.** Seed §16 left open
"whether the native backend runs the same hoisted-STFT ONNX with a native STFT,
or a different export". It is the same export, and structurally so: §5's pinned
SHA-256 and byte count are verified by the unit over whatever `modelBytes`
returned **before** the buffer reaches `Backend.load`, so a second export could
only arrive by bypassing the handed bytes — the M1 violation the seam exists to
prevent. The STFT stays hoisted for the reason `engine/demucs.js:31` already
records: in-graph STFT/ScatterND makes ORT-Web's WebGPU EP refuse the session,
and CoreML's op coverage is narrower still. `DemucsEngine` already takes the ORT
namespace as a constructor parameter and the EP as a `load()` argument, and it
imports in plain Node with no DOM — so the utility process runs **the unit's own
parity-verified spectral path**, not a port of it. A native (vDSP) STFT is a
later optimisation that changes no interface and is not worth choosing before
somebody can measure the ratio it would improve.

### Seed §16 says "as transferables". It is not, and this is the measured figure

The seed specifies the per-segment IPC as *"≈ 2.7 MB in / ≈ 16.5 MB out as
transferables"*. **Electron has no such transfer list.** Both
`UtilityProcess.postMessage` and `MessagePortMain.postMessage` type theirs as
`MessagePortMain[]`. Measured directly on this box — Electron 44.0.0, Linux
6.17, one renderer↔utility `MessageChannelMain`:

| direction | ArrayBuffer in the transfer list | result |
|---|---|---|
| `main` → utility | yes | **throws** `Port at index 0 is not a valid port` |
| utility → renderer | yes | **throws** the same; the copy path then delivers |
| **renderer → utility** | yes | **does not throw. Detaches the sender's buffer. The message is never delivered.** |
| either | no | delivered intact, sender still attached — a structured clone |

The third row is why nothing on this wire is ever transferred, and it is a
correctness matter rather than a performance one: a `load()` written the obvious
way would destroy the verified weights and then wait for ever for an answer that
was never sent, which is precisely the `LivePipeline.runChunk` hang
`shared/host.js` spends four paragraphs on. A `try`/`catch` cannot help, because
there is nothing to catch.

**So the frozen borrow-and-return contract is honoured by never detaching.**
`mix` is copied onto the wire and resolved back as itself; `out` never travels at
all; the returned floats are written into it. The cost, measured over five
consecutive round trips:

    2,751,840 B up + 16,511,040 B back = 19,262,880 B per segment
    five round trips in 221 ms  ->  ~44 ms each

≈ 19.26 MB of structured clone per hop, ~44 ms of it, against a hop of 1.95 s —
about 2.3% of the budget, plus 16.5 MB of per-hop garbage on the engine
renderer. Cross-process zero copy would need shared memory, which Electron does
not expose and which a `SharedArrayBuffer` cannot cross a process to provide.
**Whether that is worth paying is UNMEASURED**: it buys whatever CoreML is
faster by, and nothing here has ever timed CoreML.

### There is no fallback once a backend is built

The obvious design — try native, fall back inside `load()` — cannot work, and the
reason is two clauses one file apart rather than a preference. `Backend.load`
"TAKES OWNERSHIP OF `bytes` and may transfer it", so a failed native load may
leave the 109 MB detached; and `loadModel` is a two-ask ceiling, so the unit will
not fetch a second buffer to replace it. **A backend that turns out not to work
is a dead deck, not a backend to swap.**

That is why the probe forks the real utility process and asks it to build a real
engine rather than reading `process.platform`, and why the platform gate sits
*above* the probe in `chooseBackend()`. It is also why a native backend that
fails at runtime sets `degraded` for the rest of the session and demotes every
*later* `createBackend`, never re-selecting under a live deck — `STATE.boot.ep`
is a claim about the session that is running, and swapping the backend under it
would make that claim false.

**How the deck says which backend is live: `load()`'s `ep`.** Not `onReady`,
whose two fields the freeze block deliberately left ORT-shaped and nullable — "a
Host must not invent numbers here". `ep` already flows to `STATE.boot.ep` and
onto the deck, and it reports what the **session** answered rather than what was
requested, because ORT falls back per node without saying so.

---

## 6. The network surface

**P1′ — the app's own code talks to exactly one named host, GitHub Releases, for
the update check, and nothing else.** No telemetry. No crash reporting. No
fonts, no CDN, no analytics, no model download.

The predecessor rule, the extension's P1, was "no network after the model
download". It does not carry over verbatim for two reasons, both of which make
this product's rule *stricter* in one direction and looser in another: the model
download is gone entirely (§5), and an update check is added, because this app
owns a Chromium that loads youtube.com and therefore owns Chromium's security
patches. An app that cannot update itself has a worse security posture than the
extension, where Google did this.

**The YouTube view's traffic is the user's own browsing**, on its own persistent
partition, and it is not the app's code talking. `PRIVACY.md` says so in those
words; saying it any other way would be a lie by omission.

**Held by an acceptance test** ported from the extension's P1 test —
`tools/suites/p1.mjs`, step `p1`, 24 assertions over one real launch. It boots
the app behind a local TLS server wearing `api.github.com`'s certificate, drives
a full session (the vendored deck and engine, the source view playing, the
transport, the 109 MB model read through the Host), and asserts the set of
network origins the app's own sessions reached is exactly
`{ https://api.github.com }`. **Measured on 2026-08-26: 49 requests on the app's
own session, 48 of them `app://`, one on the network.**

Three structural things make that a measurement rather than a silence:

- **Every session goes through one factory** (`src/main/sessions.js`), which
  installs the observer as it creates. Electron cannot enumerate its own
  sessions, so a session nobody watched reads exactly like a session that made no
  requests; the suite scans every file under `src/` to prove no other file names
  one.
- **The `persist:youtube` exclusion is exercised with the same URL through both
  sessions**, with opposite verdicts — allowed on the user's partition, cancelled
  on ours. An exclusion that is never exercised might be excluding everything.
- **A server in another process counts the hits.** Instrument silent while the
  server is hit is a RED, and it is the only shape that catches an observer that
  has quietly stopped being installed.

`docs/TESTING.md` §9 is the specification and the 24 mutations.

---

## 7. What is verified, what is configured, and what is only written down

The plan's pass condition for this phase is *"a notarized macOS pre-release a
tester can open and arm"*. **That is not achievable on the machine this is being
built on**: there is no Mac, no Apple Developer credentials on it, and no audio
hardware. Pretending otherwise would put a claim in this repository that nobody
can check.

The substituted pass condition, and the honest labels for it:

| | claim | what backs it |
|---|---|---|
| **VERIFIED** | the capture/mute mechanism | Linux, Electron 44.0.0 / Chromium 152.0.7977.54, an external out-of-process meter, ~40 recorded runs, three adversarial audits, one of which refuted part of the original claim |
| **VERIFIED** | a runnable Linux app the owner can **start** on this box | `tools/suites/shell.mjs` — 35 assertions over one real launch of `electron .`: the window and its three views, every renderer's isolation flags, `crossOriginIsolated === true` with `SharedArrayBuffer` in the document and in a module worker, the capture grant naming the source view's frame, the mute landing before the first load, the allowlist refusing. Every one watched red by a named mutation (`tools/suites/shell-mutations.sh`, 33 cases), and the tables are in `docs/TESTING.md` §5 |
| **VERIFIED** | **P1′ — the app's own code reaches one host and nothing else** | `tools/suites/p1.mjs` — 24 assertions over one real launch behind a local TLS server wearing the update host's certificate: the set of network origins is exactly `{ https://api.github.com }`, the `persist:youtube` exclusion is exercised with the same URL through both sessions with opposite verdicts, and the fake host's own hit counter is half of two assertions so that a blind observer is a red. **Since two audits defeated it with one line of `fetch()` in the main process**, it also covers the transports that never enter Chromium: `src/main/netguard.js` takes them away at boot, a source scan forbids the imports, and a real loopback sink in the suite's own process is the witness the app cannot fake. 24 of 24 watched red by `tools/suites/p1-mutations.sh`; `docs/TESTING.md` §9 |
| **VERIFIED** | ...and **arm** it, by two real gestures | `smoke` clicks the chrome bar's **Arm** button in the real renderer and the menu's **Arm this Source**, and requires the deck to see a `SESSION` for each; `youtube` does it against the real site and gets six stems out of the far end |
| **NEVER OBSERVED** | six stems moving **live**, while the video plays | nothing. Every machine this has run on drops every chunk — it needs ~4x real time and gets ~1.4x without a GPU. `docs/evidence/step3-youtube/README.md` §3. **It is a prediction, and this table exists so that it is never read as anything else.** |
| **VERIFIED** | the inference-backend **selection**, and that this platform gets the ORT worker | `tools/suites/backend.mjs` — 55 assertions with no window and no mutex: all twenty platform/probe/preference rows of `chooseBackend()`, the renderer↔utility protocol over a `worker_threads` `MessageChannel` with a fake engine (the frozen layout, both buffers back undetached, `dispose()` settling by name), and the negative control — the shipped hole builds the unit's own `WorkerBackend` here even with a native factory beside it. 37 mutations, **coverage: all 55 watched red**; `docs/TESTING.md` §5f |
| **NEVER RUN** | **the CoreML backend itself** | nothing. No CoreML session has been created by this project, no segment separated by one, nothing timed. `tools/suites/backend-coreml.mjs` is declared, is `manual`, and SKIPs here with a machine reason. **It is written code, not evidence, and this row exists so it is never read as anything else** |
| **CONFIGURED, NEVER BUILT** | electron-builder and CI for macOS and Windows | `package.json` `build`, `build/entitlements.mac.plist`, `.github/workflows/package.yml` and `.github/workflows/gate.yml`. **Nothing is compiled, signed or notarized here, and neither workflow has ever run.** A green CI file is not a green build |
| **WRITTEN DOWN ONLY** | everything about macOS behaviour | nothing. See §3 and issue #2 |

Every document in this repository is expected to say which of those four a claim
is. A sentence that does not is a bug in the document.

---

## 8. What is decided, and what is still open

`docs/HOST-DESIGN.md` exists, and it tags every decision `[decided]`,
`[measured]` or `[unknown]`. **The six questions this page could not answer
before it was written are all answered**, and they are summarised where they
belong — §1 for the topology and the sessions, §2 for isolation, the
`sourceToken` and the autoplay wire, §5 for the model. This section is what is
*still* open, so that a reader does not have to diff two documents to find out.

**Open, and named by HOST-DESIGN.md as `[unknown]`:**

1. **The unit has never run outside a Chrome extension.** Every measurement so
   far is of the Host's *plumbing* — isolation, the protocol, the capture. The
   engine and the deck booting under it is the first real test, and it is the
   step-3 smoke's job.
2. **Key routing and focus.** Three views in one window, one key router in
   `main`, and a deck that claims key codes. Which view has focus when the user
   presses a claimed key is not a thing that can be reasoned to a conclusion.
3. **Background throttling of a hidden engine.** `backgroundThrottling: false`
   is the switch and `disable-renderer-backgrounding` is the belt to its braces;
   whether the pair is sufficient on all three platforms is unmeasured, and the
   assertion for it must be a **count**, not a stopwatch.
4. **CSP versus ORT's wasm.** `'wasm-unsafe-eval'` is required for ORT to compile
   under a restrictive `script-src`. Believed necessary and sufficient; not
   measured.
5. **The capture claim's races** — a disarm that lands between minting and
   claiming, a view that navigates mid-claim.
6. **WebGPU on this box.** Expected absent; the threaded-WASM fallback is what
   will actually run here, and that is a fact about the verification machine
   rather than about the product.

**Open, and belonging to a later step:**

- **Where the export writer lives**, and how the ask-once folder is remembered
  ([#6](https://github.com/itziklerner-pag/stem-workbench/issues/6)). The seam
  question is that issue's to answer: Export reaches the deck through the Host,
  not through a branch in `embed.js`, because the deck must not know which Host
  it runs under — so it is either a Host-side control outside the deck, or a new
  duty on a frozen interface.
- **What backs storage on disk.** `main` owns both areas and the deck's contract
  is satisfied; the file it lands in is not specified yet, and
  [`PRIVACY.md`](../PRIVACY.md) names that gap rather than glossing it.
- **The first-run surface**, and whether a model download path is kept for a
  future model swap
  ([#18](https://github.com/itziklerner-pag/stem-workbench/issues/18)).

---

## 9. Gates

**[`docs/TESTING.md`](TESTING.md) is the authority on how this repository is
gated** — the runner, the steps table, what each suite asserts, and the printing
convention every suite obeys. This section says only what the *architecture*
implies about testing, so that the two documents cannot drift into disagreeing.

The test strategy is the plan's option T2: **the vendored unit carries its own
gates**, and this repository adds host-specific suites only. That follows
directly from decision 4 in §0 — the suites that guard the audio graph travel
with the audio graph, so a pin bump is verified by the tests written against
that exact code. One runner here, one set of conventions, no framework, and —
inherited unchanged — **a suite that exits 0 while asserting nothing is a hard
failure, not a pass.**

Three consequences of the architecture that a reader of this page should not
have to discover from the runner:

- **The vendored gate runs as one step of ours, not as a second runner.**
  Copying the upstream runner here was the rejected option: two runners drift
  where it is most expensive.
- **`group('host')` in the vendored `test.js` is this Host's conformance
  suite.** Swapping the two holes for this Host's modules takes 122 assertions
  from being claims about a Chrome platform to being claims about ours — and
  they are worth passing, because they are where `assetUrl`'s trailing slash,
  `send`'s `undefined` return and `storageGet`'s absent-versus-unreadable split
  meet a real implementation instead of a stub. Running `--unit` **before** the
  swap is the intermediate green worth recording: it says the copy arrived
  intact and runs.
- **CI never touches youtube.com.** The capture gate and the Electron smoke run
  against a local fake player page. The accepted cost is named rather than
  implied: nothing in CI will ever catch a YouTube-side regression, and that
  needs a manual re-check on a cadence rather than a green local gate implying
  YouTube still works.

**A red under `vendor/` is never fixed under `vendor/`.** It is a finding, and
its fix is a change in the other repository behind a new tag —
[`CONTRIBUTING.md`](../CONTRIBUTING.md) rule V1.

**Assertion discipline applies here unchanged**, and it is not a style
preference: every assertion watched red by mutation, the mutation named. The
rules and the catalogue of ways this project has already got them wrong are in
`AGENTS.md` in `stem-splitter-live`; `CONTRIBUTING.md` says why it is pointed at
rather than copied.
