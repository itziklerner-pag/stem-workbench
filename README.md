# stem-workbench

**Pre-alpha. There is nothing to install** — no installer, no signed build, no
release. There IS an application, and it works end to end: `npm start` opens a
window with `youtube.com` in it, you press play, you arm it from the menu, and
the app captures the page — muted, so you hear nothing of it — and separates
what it captured into **six stems with the real 109 MB weights**. That whole
chain is verified on Linux by one manual gate, `node tools/verify.mjs --only
youtube`: **25 assertions, 0 failed.**

**One step of it this machine could not show:** live separation needs about 4x
real time and this box has no reachable GPU, so the six faders do not move here —
the deck plays the passthrough mix and says *Starving*, which is what it is
designed to do. The separator itself was measured with the clock taken away and
returns six real stems. [Run it on this machine](#run-it-on-this-machine) has
both halves, with numbers.

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
| step 1 — the capture/mute spike | **done on Linux**; macOS is [#2](https://github.com/itziklerner-pag/stem-workbench/issues/2), blocked on hardware |
| step 2 — the Host seam in `stem-splitter-live` | **done** — Host interface v1, frozen at `v0.2.0` |
| step 3 — desktop host v0, the YouTube Live source | **it runs end to end on Linux.** A real `youtube.com` watch page in the window, armed from the application menu, captured while the view is muted, and **six stems out of the engine with the real 109 MB weights**. `node tools/verify.mjs --only youtube` — **25 assertions, 0 failed** |
| step 3, the vendored unit | **landed** — 50 files at `v0.2.0`, byte-verified twice, plus ONNX Runtime at its pin |
| step 3, what is NOT done | the File source, stem export, packaging/installers, and macOS — none of them started |

## Run it on this machine

**You will be the first person to see this run with a screen and speakers.**
Everything below was verified on a headless Linux box under `xvfb`, by an agent
with no display and no soundcard, so the pictures are `capturePage()` output and
the silence is a number off a PipeWire monitor. What it looks and sounds like on
a real desktop is not yet known to anybody.

```bash
npm install
bash tools/vendor-unit.sh --model    # 109 MB of weights — CC BY-NC 4.0, dev only, not in git
npm start
```

**On a Linux development tree**, Chromium's setuid sandbox helper ships without
its permissions and Electron refuses to start rather than run unsandboxed:

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

That is a property of `node_modules`, not of the app; a packaged build installs
it correctly. `ELECTRON_DISABLE_SANDBOX=1` also starts it, with the sandbox off,
which is worth knowing and not worth doing.

### What you should see, in order

1. **A 1280x860 window** — a 44 px bar of ours at the top, `youtube.com` filling
   the middle, and the deck across the bottom: six strips, in the deck's own rack
   order — **Vocals, Drums, Bass, Other, Guitar, Piano** — each with a fader, M
   and S, and a meter, plus a master fader, KEY, BPM, TRANSPOSE, SPEED, and a
   *Stop at the end of the video* checkbox.
2. **Find a video and press play**, in YouTube's own player, the way you always
   do. The app never presses play for you: there is no `play()` anywhere in
   `src/`, by rule (L1).
3. **You will hear nothing.** The view is muted before it loads anything and
   stays muted for its whole life. That is the product, not a bug — the app
   hears the page and you do not, so that what you hear later is the stems.
4. **Arm it: `Source -> Arm this Source`, or `Ctrl+Shift+A`** (`Cmd+Shift+A` on
   a Mac). The deck's badge moves off *idle*, the app opens a capture on the
   view, and the engine starts separating.
5. **On a machine with a working WebGPU adapter**, the six meters should start
   moving and the faders should be live — pull *Vocals* down and the vocal goes
   away. **Nobody has watched this happen yet**; see the section below.

**If your deck says *Starving* too**, the engine did not get a GPU adapter, and
it says so in one line of its own log, which `npm start` prints to the terminal:

```
deck A webgpu unavailable (…) — falling back to wasm
```

That line, plus `engine coi=true sab=true` in our bar and the drop count next to
the badge, is the whole diagnosis.

### Step 5 is the one this box could not show you

Live separation needs about **4x real time**: `offscreen/live.js` runs one 7.8 s
segment of audio every 1.95 s. With a WebGPU adapter the engine has that; on
CPU-only wasm it does not, and the deck does exactly what it is designed to do —
drops the chunk, plays the **passthrough** mix, and shows **Starving** with a
drop count. The six stem meters then read zero because there are no stems, only
the mix.

That is what happened here, and the numbers are recorded rather than described:
**11 of 11 chunks missed the 1950 ms hop deadline, p95 5676.8 ms, `ep: wasm`,
4 threads, `adapter: null`.**

**It is not "this box has no GPU" — it is that a headless X server gives
Chromium no GPU at all**, which is the more useful sentence if you are about to
run this in CI. The box has an Intel iGPU on `/dev/dri`; under `Xvfb` the chain
is, measured in that order:

```
WARNING:ui/gfx/linux/gbm_support_x11.cc:48] dri3 extension not supported.
app.getGPUFeatureStatus() -> webgpu "disabled_off", vulkan "disabled_off", webgl "disabled_off"
app.getGPUInfo('basic')   -> throws "GPU access not allowed. Reason: GPU access is
                              disabled due to frequent crashes."
navigator.gpu             -> undefined, in every renderer
```

With no `navigator.gpu` there is no WebGPU execution provider for ONNX Runtime to
pick, so it falls back to wasm — and the unit pins that at 4 threads
(`min(4, hardwareConcurrency >> 1)`, measured upstream; 8 was a regression on a
12-core machine). **Device permissions are not the problem**: granting this user
the render node changed nothing, because the GPU process never comes up on a
display without DRI3.

**If your machine has a real display and a GPU, step 5 is the one that works and
none of us has watched it.**

**The separator itself was measured with the clock taken away**, which is the
part that IS verified: one 7.8 s segment of the audio this app captured from the
real YouTube page, through the Host's own `createBackend()` and `modelBytes()`,
with no deadline — six stems came back.

### What the run proved, with numbers

Every number below is from **one launch**, recorded in
[`docs/evidence/step3-youtube/`](docs/evidence/step3-youtube/) — the report, the
engine's own log, the meters, the pictures, and the 25-assertion transcript. That
directory also carries the `capture-mute` run that measured the other half of the
premise: the app captured the view at **rms 0.351 / peak 0.500** while the audio
device read **bit-exact zero** for the app's whole lifetime, with a control
process on the same sink proving the meter could hear something.

Re-judge the recorded run without launching anything:

```bash
YOUTUBE_REPORT=docs/evidence/step3-youtube/report.json node tools/suites/youtube.mjs
```

| | |
|---|---|
| the page | `https://www.youtube.com/watch?v=dQw4w9WgXcQ`, duration **213.061 s**. No pre-roll before arming; the page **reload** later brought one, and the run pressed YouTube's own **Skip** once and waited 1.1 s before measuring anything. The playhead was then moved to 48 s through the deck's own `drive` — it landed at **50.39 s**, `adShowing: false` — so the segment is the song's chorus and not an advertisement |
| the capture | `channelCount: 2`, `sampleRate: 44100`, `autoGainControl / echoCancellation / noiseSuppression` all **false**, `local_echo=false`; the segment's own rms **L 0.1636 / R 0.1651**, and the deck's ring at **1,425,408 frames / 32.3 s**, peak **[0.608, 0.594]**, 0 dropped — while the view is muted |
| the weights | **114,559,139 bytes** — every one of them — through `modelBytes()` in **580 ms**, hash-verified by the unit, ORT session built |
| the separator | `separate()` **5485 ms** for a 7.8 s segment on `ep: wasm`, 4 threads (prep 92 · infer 4870 · post 522) |
| **the six stems** | rms per stem, in the model's own `STEMS` order — see below |
| the sum | mix **0.164336**, Σstems **0.159585** (**0.971x**), residual **0.017901** (**0.109x**) |
| the live pipeline | 11 chunks, **11 drops**, p95 **5676.8 ms** against a 1950 ms hop — **did not keep up on this box** |

```
drums    L 0.066890   R 0.058397   peak 0.566612
bass     L 0.037113   R 0.026569   peak 0.167636
other    L 0.030644   R 0.036382   peak 0.211143
vocals   L 0.122456   R 0.126314   peak 0.622599
guitar   L 0.002328   R 0.002366   peak 0.019544
piano    L 0.000175   R 0.000187   peak 0.001546
```

Read them as a human would: 50 s into that song is a full chorus, so **vocals
loudest**, drums right behind, bass and the residual "other" present, guitar
barely there, and **piano essentially silent — because that song has no piano.**
Six distinct signals, 56.9 dB from the loudest to the quietest.

**The sum is the line that cannot be faked by a meter.** `htdemucs` is a masking
separator: its six stems add back to the input. They do — Σstems is 0.971x the
mix and the residual is 0.109x of it. Six *copies* of one mix would sum to six
times it. That single row is what separates "six stems" from "one mix fanned out
into six planes", which is exactly what the passthrough path publishes and what
a careless level check calls a pass.

### What does not work yet

- **Real-time live separation without a GPU.** Above, in full.
- **The File source.** Not started. The deck has no way to open a file yet.
- **Stem export.** Not started, and it is the line this product exists to cross.
- **Packaging.** There is no `electron-builder` configuration and no installer:
  `npm start` from a checkout is the only way to run this today. The CI and the
  signing story for macOS and Windows are **not written**, and nothing here has
  been built or signed on either.
- **The deck still speaks the extension's language in one sentence.** With
  nothing armed it prints *"Click the Stem Splitter Live toolbar icon on this
  tab to arm it, or press Ctrl+Shift+A"*. There is no toolbar icon and there are
  no tabs. `docs/VENDORING.md` names this as the one string a second Host must
  patch; the accelerator half is already ours.
- **Turning YouTube's autoplay-next off does not take.** The Host finds the
  toggle and clicks it and the control does not change, so the next video may
  still start; the deck raises *"Couldn't turn off YouTube's autoplay — their
  control didn't respond"* rather than failing quietly. The selector was measured
  against the site on 2026-08-15 and the page has moved since. It is a YouTube-side
  drift, which is the class of thing the manual `youtube` step exists to catch —
  the `transport` suite is green about a local fixture whose toggle does respond.
- **`vendor-unit` is RED, on purpose.** The vendored `test.js` is both the
  unit's largest suite and a conformance suite over the two hole modules, and
  with a non-Chrome Host in them it crashes at `:5833` instead of failing. The
  verdict for that file is the `conformance` step — 612 assertions, 593 passed,
  19 failed, every red pinned by name — and the rest is an upstream fix.
  [`docs/CONFORMANCE.md`](docs/CONFORMANCE.md) is the long form.

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
docs/TESTING.md              how this repo is gated, suite by suite
docs/CONFORMANCE.md          the unit's own group('host') over this Host's holes
docs/evidence/               what a real run produced — pictures and numbers
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
tools/suites/                the host suites — all built, plus their mutation
                             batteries. `youtube.mjs` is the manual one that
                             drives the real site and measures the six stems
tools/gate/                  one probe per QUESTION, imported only under
                             `--gate` — `probe` (the shell), `engine-host`,
                             `deck-host`, `transport`, `capture-mute`, `p1`,
                             and `youtube` (the whole product, on the real site)
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
node tools/verify.mjs                  # the gate — every step that is built and automatic
node tools/verify.mjs --quick          # ...minus anything that opens a window or takes the sink
node tools/verify.mjs --self-check     # the runner's own classifier, ~0 s
node tools/verify.mjs --only shell     # one real launch of `electron .`, ~2 s
node tools/verify.mjs --only youtube   # MANUAL: the real site, end to end, ~5 min
tools/suites/shell-mutations.sh        # watch all 34 of its assertions go red
node tools/suites/youtube-mutations.mjs        # 41 rows over a recorded run, ~10 s
node tools/suites/youtube-mutations.mjs --live # ...and three real edits to src/, one launch each
```

**`youtube` is never on a default plan**, and the runner names it under *WHAT DID
NOT RUN* on every run that leaves it out. It needs the network, the 109 MB
weights and a site nobody here controls — and it is the only step anywhere that
proves six stems come out of the engine inside this app.

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
