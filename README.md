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

## Layout

```
docs/spike-capture-mute.md   step 1's findings, limitations, and the gate spec
spike/                       the throwaway Electron app + every recorded run
spike/harness/               the external speaker meter it is measured with
NOTICE.md                    the non-commercial statement and attribution
```

The plan itself (`desktop-app-plan.md`) still lives in the `stem-splitter-live`
working tree and migrates here once step 2 lands.

## Issues

Desktop work goes on **this** tracker; the extension's stays on
`stem-splitter-live`'s. The two are deliberately separate (ADR 0001).
