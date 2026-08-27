# stem-workbench

**Pre-alpha. There is nothing to install** — no release, nothing signed, nothing
notarized, and no macOS or Windows build has ever been produced on any machine.
A Linux AppImage and deb now *build*, and the gate step `dist-linux` builds one
and then launches it; that is a fact about this repository's own box and not a
thing anybody can download. There IS an application, and it works
end to end: `npm start` opens a window with `youtube.com` in it, you press play,
you arm it from the bar or the menu, and the app captures the page — muted, so
you hear nothing of it — and separates what it captured into **six stems with
the real 109 MB weights**. That whole chain is verified on Linux by one manual
gate, `node tools/verify.mjs --only youtube`: **26 assertions, 0 failed.**

**THE ONE THING THIS PRODUCT IS FOR HAS NEVER BEEN SEEN WORKING.** Six stems
moving live while the video plays needs about 4x real time; this box has no
reachable GPU and does about 1.4x, so every chunk is dropped, the deck plays the
passthrough mix and says *Starving*, and the six faders sit still. That is true
of every machine this has ever run on — the author's and an independent
auditor's. The SEPARATOR is verified, with the clock taken away, and returns six
real stems; the LIVE SCHEDULER is a prediction.
[Run it on this machine](#run-it-on-this-machine) has both halves, with numbers,
and [What was verified, and what was only
configured](#what-was-verified-and-what-was-only-configured) draws the line.

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
| step 3 — desktop host v0, the YouTube Live source | **it runs end to end on Linux.** A real `youtube.com` watch page in the window, armed from the bar or the application menu, captured while the view is muted, and **six stems out of the engine with the real 109 MB weights**. `node tools/verify.mjs --only youtube` — **26 assertions, 0 failed**. Packaging for macOS and Windows is **written and never built** — see [What was verified, and what was only configured](#what-was-verified-and-what-was-only-configured) |
| step 3, the vendored unit | **landed** — 50 files at `v0.2.0`, byte-verified twice, plus ONNX Runtime at its pin |
| step 3, what is NOT done | the File source and stem export — neither started. **Packaging is configured and has never been built**; **macOS has never run any of it**; **six stems moving live has never been observed on any machine** |

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
| the page | `https://www.youtube.com/watch?v=dQw4w9WgXcQ`, duration **213.061 s**. A pre-roll was waited out before anything was measured. The playhead was then moved to 48 s through the deck's own `drive` — it landed at **50.403 s**, `adShowing: false` — so the segment is the song's chorus and not an advertisement |
| the capture | `channelCount: 2`, `sampleRate: 44100`, `autoGainControl / echoCancellation / noiseSuppression` all **false**, `local_echo=false`; the segment's own rms **L 0.1636 / R 0.1651**, and the deck's ring at **540,672 frames / 12.26 s**, peak **[0.506, 0.482]**, 0 dropped — while the view is muted |
| the weights | **114,559,139 bytes** — every one of them — through `modelBytes()` in **517 ms**, hash-verified by the unit, ORT session built |
| the separator | `separate()` **5560 ms** for a 7.8 s segment on `ep: wasm`, 4 threads (prep 93 · infer 4929 · post 537) |
| **the six stems** | rms and spectrum per stem, in the model's own `STEMS` order — see below |
| the sum | mix **0.164340**, Σstems **0.158697** (**0.966x**), residual **0.019203** (**0.117x**) |
| the correlations | 15 pairs, \|r\| from **0.004 to 0.433**; the correlator's own control r(x,x) = **1** |
| the live pipeline | 11 chunks, **11 drops**, p95 **5666.8 ms** against a 1950 ms hop, sustained RTF **2.89** — **did not keep up on this box, and has not kept up on any box** |

Every figure in that table is one an assertion in `tools/suites/youtube.mjs`
reads. The report also carries a `captureFinal` of 1,413,120 frames / 32.0 s that
**no assertion reads**, and this sentence exists because an earlier version of
this section quoted it here without saying so.

```
             rms L      rms R      peak      centroid   <120Hz   <500Hz
drums      0.066817   0.058511   0.568174     1795 Hz    19.1%    64.3%
bass       0.037203   0.026606   0.161932      102 Hz    76.4%    99.9%
other      0.027363   0.032976   0.205921     1345 Hz     0.1%    38.3%
vocals     0.122347   0.126175   0.620616     1723 Hz    0.01%    18.9%
guitar     0.004745   0.004980   0.050094      447 Hz     0.1%    52.4%
piano      0.000184   0.000200   0.001550     4265 Hz     0.8%    31.1%
(the mix)  0.163564   0.165112       —        1493 Hz     7.6%    33.9%
```

Read them as a human would: 50 s into that song is a full chorus, so **vocals
loudest**, drums right behind, bass and the residual "other" present, guitar and
piano quiet. Six distinct signals, 56.4 dB from the loudest to the quietest.
**The quiet stems do not replicate run to run** — `guitar` has come back anywhere
from 0.0023 to 0.0271 across four runs of the same seek, because a 7.8 s window
either does or does not contain the guitar figure — which is why the suite
asserts no level band on any stem. The loud four are stable to three digits.

**Three rows carry the "six stems" claim, and one of them was not enough.**

- **The sum.** `htdemucs` is a masking separator: its six stems add back to the
  input. They do — Σstems is 0.966x the mix and the residual is 0.117x of it. Six
  *copies* of one mix would sum to six times it.
- **The correlations.** An audit showed the sum alone can be beaten: for
  `stems_k = a_k · mix` with the `a_k` summing to 1, the residual is exactly 0,
  the sum ratio is exactly 1.0, and six differently-scaled copies of one mix pass
  the sum test, the "six distinct levels" test and the meters at once. Pearson r
  between every pair of planes is the row that cannot be beaten that way: six
  scaled copies correlate at 1.000, and this run's fifteen pairs top out at 0.433.
- **The spectra.** Nothing in the returned buffer carries a name — the seam
  freezes the LAYOUT and the meaning of the index is convention — so the suite
  now asserts the ORDER out of the audio: the `bass` plane has the strictly
  lowest centroid and the strictly most energy under 500 Hz and under 120 Hz, and
  the `vocals` plane has the strictly least under 120 Hz. The old check compared
  the labels the probe had itself written, and a permuted buffer passed it.

### What does not work yet

- **Real-time live separation without a GPU.** Above, in full.
- **The File source.** Not started. The deck has no way to open a file yet.
- **Stem export.** Not started, and it is the line this product exists to cross.
- **Packaging: configured, never built.** `package.json`'s `build` key,
  `build/entitlements.mac.plist` and `.github/workflows/package.yml` are written
  — dmg + zip for macOS (hardened runtime, notarization on), NSIS for Windows
  (unsigned; there is no certificate), AppImage + deb for Linux. **No installer
  has ever been produced from any of it, on any machine, and nothing has been
  signed or notarized.** `npm start` from a checkout is still the only way anyone
  has run this. See [What was verified, and what was only
  configured](#what-was-verified-and-what-was-only-configured).
- **The deck still speaks the extension's language in one sentence.** With
  nothing armed it prints *"Click the Stem Splitter Live toolbar icon on this
  tab to arm it, or press Ctrl+Shift+A"*. There is no toolbar icon and there are
  no tabs. `docs/VENDORING.md` names this as the one string a second Host must
  patch; the accelerator half is already ours.
- **Turning YouTube's autoplay-next off does not take, on a watch page.** The
  Host finds the toggle and clicks it and the control does not change, so the
  next video may still start; the deck raises *"Couldn't turn off YouTube's
  autoplay — their control didn't respond"* rather than failing quietly. The
  selector was measured against the site on 2026-08-15 and the page has moved
  since. It is a YouTube-side drift, which is the class of thing the manual
  `youtube` step exists to catch — the `transport` suite is green about a local
  fixture whose toggle does respond. (It no longer fires on the DEFAULT landing
  page: youtube.com's home page has no player, so the Host no longer hunts for a
  control that page never has, and a cold start no longer opens with a failure
  banner about a page nobody asked about.)
- **One suite in the vendored gate CRASHES rather than runs, and the crash is
  pinned rather than hidden.** The vendored `test.js` is both the unit's largest
  suite and a conformance suite over the two hole modules; with a non-Chrome Host
  in them it dies at `:5833` — an instrument check that reports an absence and
  then dereferences the thing it just proved absent. `vendor-unit` therefore
  passes on the eleven suites it can run (544 assertions) and holds the crash
  against a pinned expectation, so the crash CHANGING is as red as a new failure.
  The verdict for `test.js` itself is the `conformance` step — 612 assertions,
  593 passed, 19 failed, every red pinned by name and argued in
  [`docs/CONFORMANCE.md`](docs/CONFORMANCE.md). The fix is upstream
  (`stem-splitter-live#30`), not here: rule V1.

### What was verified, and what was only configured

The standing ruling for this phase is that **Linux is the verification
platform**: the plan asks for a notarized macOS pre-release and there is no Mac
and no Apple credential on this machine, so the substitute pass condition is *a
runnable Linux app the owner can start and arm, proven by an automated smoke,
plus electron-builder configuration and CI for macOS and Windows that is written
but never built or signed here.* This table is that ruling, kept honest.

| | | |
|---|---|---|
| the app starts and arms, on Linux | **VERIFIED** | `npm start` — photographed in [`docs/evidence/step3-youtube/npm-start.png`](docs/evidence/step3-youtube/npm-start.png); `smoke` clicks the bar's **Arm** and the menu's **Arm this Source** and requires the deck to see a `SESSION`; an auditor also armed it with a real `xdotool key ctrl+shift+a` |
| the view is captured while the speakers stay silent | **VERIFIED** | `capture-mute`, on a PipeWire sink this repository owns, with a control process that IS heard |
| six stems out of the real weights, inside this app | **VERIFIED** | `youtube`, against the real site — the sum, fifteen pairwise correlations, and the per-plane spectra |
| **six stems moving LIVE** | **NEVER OBSERVED** | every chunk is dropped on every machine this has run on. It is a prediction from an arithmetic, not a measurement. §*Step 5 is the one this box could not show you* |
| **a Linux installer that builds and runs** | **VERIFIED** | `dist-linux` — `electron-builder --linux --publish never` produces the AppImage **and** the deb, and the AppImage is launched under `xvfb` to the app's own `[main] ready` line, with the bundled 109 MB of weights hash-verified by the unit through `process.resourcesPath` (rule M1) and `tools/` absent from the asar |
| macOS / Windows packaging | **CONFIGURED, NEVER BUILT** | `package.json` `build` (its prose is in a sibling `buildNotes`, because electron-builder rejects unknown properties and a config that cannot run is not a configured one), `build/entitlements.mac.plist`, `.github/workflows/package.yml`. No dmg, zip or exe exists on any machine. Nothing is signed. Nothing is notarized. The workflow has never run |
| Windows Azure Trusted Signing | **CONFIGURED, NEVER EXECUTED** | `scripts["dist:win:signed"]`, and NOT `build.win` — `app-builder-lib/out/winPackager.js:35` switches to the Azure signer the moment that key exists, which would break every unsigned beta build. Seed §14 says Windows betas are unsigned. `docs/UPDATES.md` §3 |
| **the update DELIVERY half** | **CONFIGURED, CANNOT BE ARMED** | `build.publish` puts the electron-updater feed inside the installer on the **pre-release** channel — `dist-linux` reads it back out of a built artifact. electron-updater itself is not a dependency: it makes its own unobserved session and talks to `github.com`, not the one host P1′ names. `docs/UPDATES.md` §2 |
| CI | **WRITTEN, NEVER RUN** | `.github/workflows/gate.yml`. Every step in it carries `--strict`, so a step that SKIPS fails the job — without that, a runner with no display and no PipeWire would have reported success having measured almost nothing |
| the update check reaches exactly one host | **VERIFIED** | `p1`, over a real launch, against a fake TLS host wearing GitHub's name AND a loopback sink that the main process's own transports are refused at |
| the update check follows the **pre-release** channel | **VERIFIED** | `updates` — and it is a change, not a restatement: the check used to ask `/releases/latest`, which GitHub defines as the newest **non**-prerelease, so it could never have returned a beta. `docs/UPDATES.md` §1 |
| auto-update is ON by default, with a visible toggle that survives a restart | **VERIFIED** | `updates` — a checkbox in the chrome bar, stored in the `local` area, measured by writing through one `createStorage()` and reading back through a second, with a CONTROL proving `session` would **not** survive |

Anything not in the left column has not been done. The two "never" rows are the
phase's known gaps and they are the CEO's call, not something this evidence can
settle.

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
src/main/netguard.js         P1' with teeth: main.js's FIRST import, and it
                             removes fetch/http/https/net/tls/dgram/http2 from
                             this process. A transport that leaves Chromium
                             leaves the observer
src/preload/                 four preloads: engine, deck, chrome — and youtube,
                             which exposes nothing on `window`, by design
src/renderer/                our own pages: the chrome bar, the engine's page
vendor/stem-splitter-live/   the vendored unit at v0.2.0 — 50 files, NEVER edited
vendor/.pin                  the pin: tag, expected counts, `ours`, and the
                             SHA-256 of every ONNX Runtime file (the gitignored
                             27 MB nothing else hashes)
vendor/upstream.sha256       what the 48 gated copied files were at the tag
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
.github/workflows/           WRITTEN, NEVER RUN — `package.yml` (installers for
                             three platforms, `--publish never`, no Release ever)
                             and `gate.yml` (every step under `--strict`)
build/entitlements.mac.plist macOS hardened-runtime entitlements. No microphone
                             entitlement: this product never opens an input
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
node tools/verify.mjs --only dist-linux # BUILDS an AppImage + deb and LAUNCHES the AppImage, ~2 min
node tools/verify.mjs --strict         # ...and a step that SKIPPED fails the run (exit 2)
tools/suites/shell-mutations.sh        # watch every one of its assertions go red
node tools/suites/youtube-mutations.mjs        # 43 rows over a recorded run, ~10 s
node tools/suites/youtube-mutations.mjs --live # ...and three real edits to src/, one launch each
```

**`dist-linux` is the only step that builds something a user would download**, and
then runs it: `electron-builder --linux --publish never` produces the AppImage and
the deb, and the AppImage is launched under `xvfb` until the app prints its own
`[main] ready` line. It is where the pre-release channel is read back out of a
built artifact's `app-update.yml` rather than out of `package.json`, and where the
bundled 109 MB is hash-verified through `process.resourcesPath` — a branch no
other suite reaches. It SKIPS, with a machine-readable reason, without
electron-builder, the weights, the ONNX Runtime drop, `xvfb-run` or `flock`.
[`docs/UPDATES.md`](docs/UPDATES.md) is the long form.

**`youtube` is never on a default plan**, and the runner names it under *WHAT DID
NOT RUN* on every run that leaves it out. It needs the network, the 109 MB
weights and a site nobody here controls — and it is the only step anywhere that
proves six stems come out of the engine inside this app.

### Where the gate stands, as of this commit

`node tools/verify.mjs` — one run, on this tree, 2026-08-26:

| step | | |
|---|---|---|
| `void-canary` | PASS | 35 passed, 0 failed |
| `vendor-intact` | PASS | 6 passed, 0 failed |
| `vendor-unit` | PASS | 11 suites PASS, **544 assertions**; `unit` CRASHES at `test.js:5833` **as pinned** — 17 reds before it dies, upstream `stem-splitter-live#30`. The verdict for that file is `conformance` |
| `deck-seam` | PASS | 49 passed, 0 failed |
| `shell` | PASS | 35 passed, 0 failed |
| `engine-host` | PASS | 37 passed, 0 failed |
| `transport` | PASS | 64 passed, 0 failed |
| `deck-host` | PASS | 27 passed, 0 failed |
| `p1` | PASS | 24 passed, 0 failed |
| `conformance` | PASS | 11 passed, 0 failed |
| `smoke` | PASS | 21 passed, 0 failed |
| `capture-mute` | PASS | 15 passed, 0 failed |
| `youtube` | *manual* | **26 passed, 0 failed** — run by hand; never on a default plan |

**`GREEN (partial — 12 of 13 steps ran)`**, and the word *partial* is the point:
the thirteenth step is `youtube`, the only one that proves six stems come out of
the engine, and the runner names it under *WHAT DID NOT RUN* every single time.

The runner never prints an unqualified `GREEN` over a partial plan, and it names
every step that did not run. **Every step also pins its own assertion COUNT**, in
`tools/verify.mjs` and in `docs/TESTING.md`'s suite table, checked exactly and
against each other: a suite that quietly stops running part of itself is red
rather than green. And `--strict` turns a SKIP into **exit 2** — a step the
machine declined is a question nobody answered, which is what CI passes.

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
