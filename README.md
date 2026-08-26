# stem-workbench

**Pre-alpha. There is nothing to install.** There is now an application, and it
starts: a window, youtube.com inside it, a cross-origin-isolated origin for the
engine and the deck, and the capture grant. The engine and the deck are now
**vendored into the tree** at `stem-splitter-live` `v0.2.0`, and their own 12
suites — 1156 assertions — run green here. **It does not split anything yet**:
the Host's 32 duties are not written, so nothing joins the two halves.
`npm start` shows you a shell.

---

A desktop app that splits what you are listening to into six stems — drums,
bass, other, vocals, guitar, piano — live, on your own machine, with a fader
for each one.

It is the Electron sibling of
[stem-splitter-live](https://github.com/itziklerner-pag/stem-splitter-live), the
Chrome extension that does this inside a YouTube page. Same engine, same deck,
different host — and two things the extension cannot do: install without
Developer mode, and open a file off your disk.

## What it is, precisely

- **A separate product, not a port with a new name.** Its own repository, its
  own `NOTICE` / `FAQ` / `PRIVACY`, its own release. The reasoning is recorded
  as ADR 0001 in `stem-splitter-live`.
- **It vendors the engine and the deck** — the offscreen audio pipeline, the
  DSP modules, the inference worker, and `ui/embed*` — from
  `stem-splitter-live` by **pinned tag + SHA-256**, behind a **Host seam**. The
  Host is the one thing each product writes for itself: the capture grant,
  storage, messaging, asset URLs, the transport, and later an inference
  backend. There is exactly one Host per product, and no second copy of the
  audio graph.
- **Two Sources in v1.**
  - **YouTube — a *Live* source.** youtube.com runs in a `WebContentsView`;
    the deck lives in the host window. The view is muted and its audio is
    captured, so you hear the stems and not the original.
  - **File — a *File* source.** A local audio file, separated ahead of time
    into a cache tier; here the deck itself is the transport master.
- **It exports stems**, from every Source. That is the line the extension
  deliberately does not cross, and the reason this is a separate product with
  its own risk.
- **Native inference is a seam in v1, not a feature of v1.** The Host exposes
  `separate()` at the audio level; today's WebGPU/WASM ONNX Runtime worker is
  the first backend behind it.

## Non-commercial, permanently

The `htdemucs_6s` weights are **CC BY-NC 4.0**, and unlike the extension, this
product **ships them inside its installer**. The distributed application is
therefore non-commercial and stays so: donations are fine, paid tiers and
bundling are not.

**Read [`NOTICE.md`](NOTICE.md).** It is not boilerplate — it is the constraint
that decides what this product may become. The code itself is
[MIT](LICENSE), matching the vendored unit.

## Status

| | |
|---|---|
| step 1 — the capture/mute spike | **done on Linux; macOS is [#2](https://github.com/itziklerner-pag/stem-workbench/issues/2), blocked on hardware** |
| step 2 — the Host seam in `stem-splitter-live` | not started; **authorised** on the Linux evidence, by decision |
| step 3 — desktop host v0 | **the shell runs on Linux** (`npm start`): the window, the three views, `app://` with `crossOriginIsolated === true`, the muted source view, the capture grant. 34 assertions, every one watched red by mutation |
| step 3, the vendored unit | **landed** — 50 files at `v0.2.0`, byte-verified twice, `12 of 12 PASS, 1156 assertions` from the unit's own gate, plus ONNX Runtime at its pin |
| step 3, the rest | the 32 duties, the arm gesture, the model — **not started** |

### What actually runs today

```bash
npm start                     # a window: our 44 px bar, youtube.com, the deck slot
node tools/verify.mjs         # the gate — GREEN (partial), because four suites are unbuilt
```

The shell that starts is: one `BaseWindow` with three `WebContentsView`s (our
chrome bar, youtube.com on its own `persist:youtube` session, the deck slot) and
a hidden `BrowserWindow` for the engine. Everything of ours is served from
`app://workbench` with COOP/COEP, so `crossOriginIsolated === true` and
`SharedArrayBuffer` constructs — in the document **and** inside a module worker,
which is the half ORT's threaded wasm needs. The source view is muted before it
loads anything. Navigation is allow-listed to youtube.com and the four sign-in
hosts; `window.open` is denied; every permission is denied; downloads are
refused. `getDisplayMedia` from the engine returns one stereo 44 100 Hz track
naming that view's frame — and the same call from the deck, or from a page
inside the view, is refused.

What is **not** there: the 32 Host duties, the arm gesture, the model, and any
audio at all. The deck slot now loads the **real** vendored `ui/embed.html`
rather than the placeholder — which is how it should be, and which currently
costs three of `shell`'s 34 assertions: its two deck-view probes live in
`src/renderer/deck-placeholder.js`, and that file is no longer the page in that
slot. **`shell` is RED for that reason** — a measurement that lost its carrier,
not a product regression. The probes belong in `src/preload/deck.cjs`, which is
exempt from the deck's `script-src 'self'` and works for both pages.

**On a Linux development tree** Chromium's setuid sandbox helper ships without
its permissions, and Electron refuses to start rather than run unsandboxed:

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

That is a property of `node_modules`, not of the app; a packaged build installs
it correctly. `ELECTRON_DISABLE_SANDBOX=1` also starts it, with the sandbox off,
which is worth knowing and not worth doing.

### The spike

**[`docs/spike-capture-mute.md`](docs/spike-capture-mute.md)** — issue
[#1](https://github.com/itziklerner-pag/stem-workbench/issues/1).

The whole plan rests on one property: *the app can hear the YouTube view while
the user cannot.* On Linux / Electron 44 / Chromium 152 that property holds —
`setAudioMuted(true)` on the view gives a full-level captured stream at 44.1 kHz
stereo while the audio device the app is routed to reads bit-exact zero for the
app's entire lifetime.

**It is not settled.** The plan writes its kill criterion against **macOS**,
which has not been run — there is no Mac and no audio hardware on the machine
that produced this evidence — and the write-up's Limitations section is longer
than its results: three adversarial audits corrected one of the three variants
from PASS to FAIL and rewrote the mechanism. The plan proceeds on a **decision**
that the Linux result is enough to justify the seam refactor, not on the
criterion having been met. macOS is
[#2](https://github.com/itziklerner-pag/stem-workbench/issues/2); the permanent
gate, specified to fail loudly on a platform where the property does not hold,
is [#3](https://github.com/itziklerner-pag/stem-workbench/issues/3). Read the
Limitations section before citing any number from the write-up.

`spike/` holds the throwaway app that produced the evidence. It is kept rather
than deleted because the permanent capture-mute gate is built **on** it — it is
**not** the product, and nothing else should be built on top of it.

**The permanent gate exists now**: `tools/suites/capture-mute.mjs`, the
`capture-mute` step of `tools/verify.mjs`, specified in
[`docs/TESTING.md`](docs/TESTING.md) §8. It measures the PRODUCT's capture path,
not the spike's — but it reuses two pieces of the spike, and only two: the
vendored PipeWire harness in `spike/harness/` (the sink, the RMS reader, the link
witness) and `spike/main.js --variant=d` as the control process that must be able
to hear itself. **It will not run in GitHub CI** — no PipeWire, no audio device —
so it skips there, loudly, and the runner refuses an unqualified GREEN over a
plan it skipped in. Nothing in CI checks this property; see `docs/TESTING.md` §11.

## The documents

They are written for a product that **does not work yet**, and each of them says
so where it matters. That is deliberate: it is easier to keep a document honest
than to make one honest afterwards.

| | |
|---|---|
| [`CONTEXT.md`](CONTEXT.md) | the domain model and the glossary. Most of the words are defined in `stem-splitter-live`, and are quoted verbatim here rather than paraphrased — a glossary that disagrees with that one is worse than no glossary |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | the process topology, the Host seam and its thirty-two duties, the capture path — and §7, which defines the difference between *verified*, *configured but never built*, and *written down only* |
| [`docs/HOST-DESIGN.md`](docs/HOST-DESIGN.md) | the Electron Host in full — the topology, the 32 duties one by one, the bus, the arm gesture, the model. Every decision tagged `[decided]`, `[measured]` or `[unknown]` |
| [`docs/adr/0001-…`](docs/adr/0001-the-shape-of-the-desktop-product.md) | the decisions this product had already taken and had nowhere to record: Electron, the capture path, the player window, non-commercial, the bundled model, and the release story |
| [`docs/TESTING.md`](docs/TESTING.md) | how this repository is gated, and the VOID rule |
| [`PRIVACY.md`](PRIVACY.md) | one host for the app's own code; the YouTube view's traffic is your own browsing; what is stored on disk and where |
| [`FAQ.md`](FAQ.md) | including the three disclosures — the Chrome user-agent, the export, and why this is non-commercial permanently |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | L1, P1′, M1 — and V1, the rule that the vendored copy is never edited |
| [`NOTICE.md`](NOTICE.md) | the non-commercial statement and the attribution |

## Layout

```
docs/ARCHITECTURE.md         the map: how the product is put together
docs/HOST-DESIGN.md          the design: the Electron Host, duty by duty
docs/adr/                    the decisions, with their alternatives
docs/spike-capture-mute.md   step 1's findings, limitations, and the gate spec
docs/TESTING.md              how this repo is gated, and the five host suites
src/main/                    the main process: the window, app://, the bus, the
                             capture grant, the source view's short list
src/preload/                 four preloads: engine, deck, chrome — and youtube,
                             which exposes nothing on `window`, by design
src/renderer/                our own pages: the chrome bar, the engine's page
vendor/stem-splitter-live/   the vendored unit at v0.2.0 — 50 files, NEVER edited
vendor/.pin                  the pin: tag, expected counts, `ours`
vendor/upstream.sha256       what the 50 copied files were at the tag
tools/vendor-unit.sh         vendors it, and `--check`s it. One command
tools/verify.mjs             the gate. `node tools/verify.mjs`
tools/suites/                the host suites (two built, four specified)
tools/gate/probe.mjs         what `--gate` reads out of a real launch — a flag
                             read only when `!app.isPackaged`, so a shipped
                             binary has no such door. It never asserts; the
                             suite does
tools/fixture/player.html    the local source page every automated suite uses
spike/                       the throwaway Electron app + every recorded run
spike/harness/               the external speaker meter it is measured with
CONTEXT.md                   the glossary
NOTICE.md                    the non-commercial statement and attribution
```

## Testing

```bash
node tools/verify.mjs                # the gate
node tools/verify.mjs --self-check   # the runner's own classifier, ~0 s
node tools/verify.mjs --only shell   # one real launch of `electron .`, ~2 s
tools/suites/shell-mutations.sh      # watch all 34 of its assertions go red
```

The engine and the deck are gated by **their own** suites, which travel with the
vendored copy (`node tools/verify.mjs --unit --no-reap` inside `vendor/`, and
step `vendor-unit` here); this repository
adds host-specific suites only. A step that exits 0 having asserted nothing is a
**hard failure**, and the runner never prints an unqualified `GREEN` over a
partial plan. See [`docs/TESTING.md`](docs/TESTING.md).

The plan itself (`desktop-app-plan.md`) still lives in the `stem-splitter-live`
working tree and migrates here once step 2 lands.

## Issues

Desktop work goes on **this** tracker; the extension's stays on
`stem-splitter-live`'s. The two are deliberately separate (ADR 0001).
