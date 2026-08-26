# stem-workbench

**Pre-alpha. There is nothing to install.** This repository currently holds one
spike and its write-up. No application has been built yet.

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
| steps 3+ — the app itself | not started |

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
than deleted because the permanent capture-mute gate will be built from it — it
is **not** the product, and nothing should be built on top of it.

## The documents

They are written for a product that **does not work yet**, and each of them says
so where it matters. That is deliberate: it is easier to keep a document honest
than to make one honest afterwards.

| | |
|---|---|
| [`CONTEXT.md`](CONTEXT.md) | the domain model and the glossary. Most of the words are defined in `stem-splitter-live`, and are quoted verbatim here rather than paraphrased — a glossary that disagrees with that one is worse than no glossary |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | the process topology, the Host seam and its thirty-two duties, the capture path — and §7, which defines the difference between *verified*, *configured but never built*, and *written down only* |
| [`docs/adr/0001-…`](docs/adr/0001-the-shape-of-the-desktop-product.md) | the decisions this product had already taken and had nowhere to record: Electron, the capture path, the player window, non-commercial, the bundled model, and the release story |
| [`docs/TESTING.md`](docs/TESTING.md) | how this repository is gated, and the VOID rule |
| [`PRIVACY.md`](PRIVACY.md) | one host for the app's own code; the YouTube view's traffic is your own browsing; what is stored on disk and where |
| [`FAQ.md`](FAQ.md) | including the three disclosures — the Chrome user-agent, the export, and why this is non-commercial permanently |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | L1, P1′, M1 — and V1, the rule that the vendored copy is never edited |
| [`NOTICE.md`](NOTICE.md) | the non-commercial statement and the attribution |

## Layout

```
docs/ARCHITECTURE.md         how the product is put together, and what is pending
docs/adr/                    the decisions, with their alternatives
docs/spike-capture-mute.md   step 1's findings, limitations, and the gate spec
docs/TESTING.md              how this repo is gated, and the four host suites
tools/verify.mjs             the gate. `node tools/verify.mjs`
tools/suites/                the host suites (one built, four specified)
spike/                       the throwaway Electron app + every recorded run
spike/harness/               the external speaker meter it is measured with
CONTEXT.md                   the glossary
NOTICE.md                    the non-commercial statement and attribution
```

## Testing

```bash
node tools/verify.mjs                # the gate
node tools/verify.mjs --self-check   # the runner's own classifier, ~0 s
```

The engine and the deck are gated by **their own** suites, which travel with the
vendored copy (`node tools/verify.mjs --unit` inside `vendor/`); this repository
adds host-specific suites only. A step that exits 0 having asserted nothing is a
**hard failure**, and the runner never prints an unqualified `GREEN` over a
partial plan. See [`docs/TESTING.md`](docs/TESTING.md).

The plan itself (`desktop-app-plan.md`) still lives in the `stem-splitter-live`
working tree and migrates here once step 2 lands.

## Issues

Desktop work goes on **this** tracker; the extension's stays on
`stem-splitter-live`'s. The two are deliberately separate (ADR 0001).
