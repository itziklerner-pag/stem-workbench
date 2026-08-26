# Spike: capture the view's audio while the speakers stay silent

Step 1 of `desktop-app-plan.md` (§3), issue
[#1](https://github.com/itziklerner-pag/stem-workbench/issues/1).

> ### Verdict
>
> **The mechanism is proven on Linux, for variants (b) and (c) only.** An
> embedded `WebContentsView` can be captured through
> `setDisplayMediaRequestHandler` at full level while the audio device the app
> is routed to reads **bit-exact zero for the app's entire lifetime** — on a
> local fixture *and* on a real `youtube.com` watch page. Electron 44.0.0 /
> Chromium 152.0.7977.54 / Linux 6.17.
>
> **Variant (a) is corrected to FAIL.** It was originally recorded as PASS. A
> stronger instrument (below) caught **1.90 s of full-level audio reaching the
> sink before the capture started**, in the gap between the view beginning to
> play and `getDisplayMedia` being called. The spike's own meter could not see
> it, because that meter only opens when the capture opens.
>
> **The plan's kill criterion is NOT discharged.** `desktop-app-plan.md:129-135`
> writes it against **macOS**, and marks Windows/Linux results explicitly
> *"not blocking"*. Every run here reports `platform: linux`. This spike
> produced a result on the axis the plan calls non-blocking and **zero evidence
> on the axis that decides the program.**
>
> **The plan proceeds anyway — by decision, not by evidence.** There is no Mac
> and no audio hardware on this machine (`aplay -l`: *no soundcards found*), so
> the criterion as worded was never *dischargeable* here: it is
> hardware-blocked, not unanswered. The CEO ruled that the mechanism question is
> answered on the only platform available and that step 2 — the seam refactor in
> `stem-splitter-live` — is worth doing under either macOS outcome, so it is
> authorised on that ruling. macOS is now a separate, hardware-blocked task
> ([#2](https://github.com/itziklerner-pag/stem-workbench/issues/2)) rather than
> a gate, and the permanent capture-mute gate
> ([#3](https://github.com/itziklerner-pag/stem-workbench/issues/3)) is
> specified to **fail loudly on macOS** if the property does not hold there.
> Issue #1 is closed on that basis. **Nothing below is macOS evidence.**

Everything below is what was measured, followed by what three adversarial
audits did to it. Read [Limitations](#limitations) before citing any of it.

---

## Recommended permanent gate: **variant (b)**

`ytView.webContents.setAudioMuted(true)`, `enableLocalEcho` left at its default,
run against the **local fixture**, never `youtube.com` (seed §17 item 1).

Seed §17 item 3 wants a gate asserting *the view reports muted* **and** *the
captured stream is non-silent*. Only (b) and (c) make `isAudioMuted()` return
`true`. (b) is preferred over (c) because it does not rest on `enableLocalEcho`,
whose default is what silences the frame here and which may differ per platform.

(b) is preferred over (a) for a second, stronger reason discovered in review:
**(a)'s silence only begins when the capture begins.** `setAudioMuted(true)` is
applied to the view before it loads, so there is no window in which the original
is audible. That is the property the product needs — a user must not hear a
1.9 s burst of the original every time they arm the deck.

The full assertion list the gate must carry is in
[The permanent gate](#the-permanent-gate), and is tracked as
[#3](https://github.com/itziklerner-pag/stem-workbench/issues/3). It is **not**
the four assertions this spike originally proposed; those four are individually
satisfiable by a capture that is useless for stem separation (Limitation 6).

---

## The instrument

Two independent meters over the same seconds, never by ear:

| side | measures | where |
|---|---|---|
| capture | RMS of the `getDisplayMedia` `MediaStream` | **inside** the renderer, every sample of every 128-frame quantum, `spike/host.html` |
| speaker | RMS of what the app wrote to its output device | **outside** the app, off the monitor of an isolated PipeWire null sink wired to no hardware, `spike/harness/bin` |

The app touches a ready-file at the instant its measurement window opens and the
external recorder starts then, so the two windows overlap rather than being
lined up with a guessed `sleep`.

**The host page never routes the captured audio to its own output.** The
question is whether the *original* leaks; the speaker meter cannot tell an
original from a replay, so a replay would make every reading worthless. The
worklet reaches `ctx.destination` through a gain of **exactly 0** — connected
(Chromium only pulls nodes that reach the destination; an unconnected worklet
reports 0 forever, a zero meaning "not measured") and inaudible.

### The defect in this instrument, and the stronger one that replaced it

The speaker recorder starts **at the ready-file, i.e. at capture start**. It is
therefore structurally incapable of seeing a leak that happens *before* the
capture. Review re-ran the matrix on a fresh isolated sink with the monitor
recorded **continuously for the app's whole lifetime** instead:

| variant | continuous recording | non-zero samples | capture over the same run |
|---|---|---|---|
| **b** | 45.0 s, 2,161,152 frames | **0** | 0.350507 over 1500 quanta, `isAudioMuted()` true |
| **c** | 30 s | **0** | non-silent |
| **a** | full lifetime | **1.90 s at peak 0.499893, rms 0.349**, from +0.60 s to +2.50 s | window opened at +2.48 s |

The PipeWire timeline explains it: the view's own output node is `state=running`
with `active` links from the moment playback starts, and flips to `idle` /
`paused` **at the instant `getDisplayMedia` starts**. Chromium's default
local-echo silencing begins *when the capture begins*, not when the view loads.

In one of the review runs the spike's own meter caught 0.02 s of the tail and
read **0.0199 — 39× over its own 0.0005 ceiling**. In the three recorded runs,
`pw-record`'s spawn latency put the window start slightly later and it read
exactly 0.0. **The three `0.0` values in the (a) row are the instrument missing a
real, full-level leak.**

### Thresholds

| | value | why |
|---|---|---|
| `CAPTURE_FLOOR` | 0.01 (−40 dBFS) | 20× the silence ceiling, so one run cannot clear both by accident — they are 26 dB apart. 31 dB below the fixture's analytic 0.353553. |
| `SILENCE_CEILING` | 0.0005 (−66 dBFS) | An idle isolated null sink measures exactly 0.0 over 4 s here; the ceiling is headroom for dither this sink does not produce. **Never exercised** — every silent reading is bit-exactly 0.0 with peak 0.0, so the ceiling could be any positive number (Limitation 12). |

---

## The variant table

Three runs per cell, 4-second windows, **every run reported**. `capturedRms` and
`speakerRms` are min..max across the three. The `speakerRms` column is what the
capture-window-scoped meter read; the **verdict** column applies the correction
above.

### P1 — local fixture

`spike/fixture/player.html`, an `<audio>` playing a 60 s 440 Hz tone at peak 0.5,
analytic RMS 0.353553.

| variant | `enableLocalEcho` | `setAudioMuted` | runs | capturedRms | speakerRms (capture window) | `isAudioMuted()` | `isCurrentlyAudible()` | verdict |
|---|---|---|---|---|---|---|---|---|
| **a** | unset (default false) | false | 3 | 0.349778 / 0.349739 / 0.350350 | 0.0 / 0.0 / 0.0 | false | true | **FAIL** — 1.90 s full-level leak *before* the window (see above) |
| **b** | unset (default false) | **true** | 3 | 0.350677 / 0.351382 / 0.349763 | 0.0 / 0.0 / 0.0 | **true** | true | **PASS** — corroborated by 45 s continuous, 0 non-zero samples |
| **c** | **true** | **true** | 3 | 0.351862 / 0.351027 / 0.350522 | 0.0 / 0.0 / 0.0 | **true** | true | **PASS** — corroborated by 30 s continuous |
| *d (control)* | **true** | false | 3 | 0.350307 / 0.351061 / 0.350549 | **0.344373 / 0.348256 / 0.346315** | false | true | *leaks by design — this is the control* |

An extra 8 s (b) window read 0.352744.

### P2 — real `youtube.com/watch?v=dQw4w9WgXcQ` (213 s, autoplayed, page volume 0.89)

| variant | `enableLocalEcho` | `setAudioMuted` | runs | capturedRms | speakerRms (capture window) | `isAudioMuted()` | `isCurrentlyAudible()` | verdict |
|---|---|---|---|---|---|---|---|---|
| **a** | unset (default false) | false | 3 | 0.110399 / 0.110398 / 0.110737 | 0.0 / 0.0 / 0.0 | false | true | **UNSOUND** — same pre-window gap, never re-measured continuously |
| **b** | unset (default false) | **true** | 3 | 0.111298 / 0.112141 / 0.110703 | 0.0 / 0.0 / 0.0 | **true** | true | PASS (capture-window instrument only) |
| **c** | **true** | **true** | 3 | 0.111694 / 0.110956 / 0.111808 | 0.0 / 0.0 / 0.0 | **true** | true | PASS (capture-window instrument only) |
| *d (control)* | **true** | false | 3 | 0.108583 / 0.108569 / 0.109022 | **0.110178 / 0.111183 / 0.110946** | false | true | *leaks by design* |

**Only the local rows were re-measured with the whole-lifetime instrument.** The
YouTube rows rest on the capture-window meter alone, so the YouTube (a) row
carries the same defect as the local one, and the YouTube (b)/(c) rows are not
corroborated by the stronger instrument. See Limitation 2.

**Reading of variant (c).** The plan lists *"(c) both"*. The two knobs are the
handler's `enableLocalEcho` and `webContents.setAudioMuted`, so (c) moves both.
**`setAudioMuted(true)` wins over `enableLocalEcho: true`**: (c) is silent where
(d) — the same flag without the mute — is not. (d) is a fourth cell beyond the
three the plan names; it completes the 2×2 so no cell is left to inference, and
it is the control that can lose.

### Every run, one line each

```
tag                          echo  mute     capRms     spkRms  isMuted audible  trackSR  deviceId
local-a-run1                 F     F      0.349778   0.000000  F       T        44100    web-contents-media-stream://5:1?local_echo=false
local-a-run2                 F     F      0.349739   0.000000  F       T        44100    ...?local_echo=false
local-a-run3                 F     F      0.350350   0.000000  F       T        44100    ...?local_echo=false
local-b-run1                 F     T      0.350677   0.000000  T       T        44100    ...?local_echo=false
local-b-run2                 F     T      0.351382   0.000000  T       T        44100    ...?local_echo=false
local-b-run3                 F     T      0.349763   0.000000  T       T        44100    ...?local_echo=false
local-c-run1                 T     T      0.351862   0.000000  T       T        44100    web-contents-media-stream://5:1
local-c-run2                 T     T      0.351027   0.000000  T       T        44100    web-contents-media-stream://5:1
local-c-run3                 T     T      0.350522   0.000000  T       T        44100    web-contents-media-stream://5:1
local-d-run1                 T     F      0.350307   0.344373  F       T        44100    <- LEAK, by design
local-d-run2                 T     F      0.351061   0.348256  F       T        44100    <- LEAK, by design
local-d-run3                 T     F      0.350549   0.346315  F       T        44100    <- LEAK, by design
local-nocapture-run1         F     F             -   0.352526  F       T        -        (getDisplayMedia never called)
local-nocapture-run2         F     F             -   0.352541  F       T        -        (getDisplayMedia never called)
local-nocapture-run3         F     F             -   0.352531  F       T        -        (getDisplayMedia never called)
local-silent-run1..3         F     F      0.000000   0.000000  F       F        44100    (source told not to play)
local-b-reload-run1/w1       F     T      0.350511   0.000000  T       T        44100
local-b-reload-run1/w2       F     T      0.353480   0.000000  T       T        44100    <- after a full reload
local-b-run44k1              F     T      0.349734   0.000000  T       T        44100    ctx forced to 44100
youtube-a-run1               F     F      0.110399   0.000000  F       T        44100    web-contents-media-stream://6:4?local_echo=false
youtube-a-run2               F     F      0.110398   0.000000  F       T        44100    ...?local_echo=false
youtube-a-run3               F     F      0.110737   0.000000  F       T        44100    ...?local_echo=false
youtube-b-run1               F     T      0.111298   0.000000  T       T        44100    ...?local_echo=false
youtube-b-run2               F     T      0.112141   0.000000  T       T        44100    ...?local_echo=false
youtube-b-run3               F     T      0.110703   0.000000  T       T        44100    ...?local_echo=false
youtube-c-run1               T     T      0.111694   0.000000  T       T        44100    web-contents-media-stream://6:4
youtube-c-run2               T     T      0.110956   0.000000  T       T        44100    web-contents-media-stream://6:4
youtube-c-run3               T     T      0.111808   0.000000  T       T        44100    web-contents-media-stream://6:4
youtube-d-run1               T     F      0.108583   0.110178  F       T        44100    <- LEAK, by design
youtube-d-run2               T     F      0.108569   0.111183  F       T        44100    <- LEAK, by design
youtube-d-run3               T     F      0.109022   0.110946  F       T        44100    <- LEAK, by design
youtube-nocapture-run1       F     F             -   0.055665  F       T        -        (quiet passage; still 5.6x the floor)
youtube-nocapture-run2       F     F             -   0.112184  F       T        -
youtube-nocapture-run3       F     F             -   0.112330  F       T        -
youtube-b-reload-run1/w1     F     T      0.112063   0.000000  T       T        44100
youtube-b-reload-run1/w2     F     T      0.111137   0.000000  T       T        44100    <- after a full reload
youtube-b-spa-run1/w1        F     T      0.111552   0.000000  T       T        44100
youtube-b-spa-run1/w2        F     T      0.048187   0.000000  T       T        44100    <- after SPA nav to v=MnErAA7R0Ak
youtube-b-run44k1            F     T      0.083674   0.000000  T       T        44100    ctx forced to 44100
```

Raw per-run JSON: `spike/results/*.json`.

---

## The controls — and what review did to them

| control | what it was meant to rule out | local | youtube |
|---|---|---|---|
| **nocapture** — view plays, `getDisplayMedia` NEVER called | "the app was never connected to the sink at all", which also reads 0.0 | speakerRms **0.352526 – 0.352541** | speakerRms **0.055665 – 0.112330** |
| **local-echo (d)** — `enableLocalEcho: true`, view NOT muted, capture **running** | "starting a capture tears the app's output stream down", which also reads 0.0 | captured 0.350307 – 0.351061, speaker **0.344373 – 0.348256** | captured 0.108569 – 0.109022, speaker **0.110178 – 0.111183** |
| **silent source** — page loads, plays nothing, capture on | "the capture meter is stuck high" | capturedRms **0.0** (3 runs, 1500 quanta each) | — |

**(d) is the load-bearing one.** With the *same* capture running and only that
one flag flipped, the speaker meter reads the tone at full level. That is what
rules out "the capture tore the output down", and it is what makes the (b) and
(c) zeros a finding rather than an artefact.

### Three things the control argument claimed that are not true

**1. The controls assert a property of the SINK, not of the APP.** Review ran
the spike's own matrix with `APP_SINK=harness_decoy` for **every** run — so the
app never wrote one sample to the measured sink — and played an unrelated 440 Hz
tone into the measured sink during the two control runs only. The spike's own
scorer printed:

```
  PASS control local/nocapture  speaker meter can hear this app
  PASS control local/local-echo  speaker meter can hear the view DURING a capture
  PASS local/a
  PASS local/b
  PASS local/c
spike: 5 passed, 0 failed          exit 0
```

The exact hypothesis the VOID rule exists to exclude is fully green. **One
transient noise source on the sink defeats the mandatory control.** This is not
theoretical: during review, a *second* agent's Electron (pid 606979,
`--variant=b --host-tone=700`) was observed writing into `harness_sink`
concurrently, and `spike/bin/run-variant.sh` takes **no lock**.

**2. The two controls are not "two independent forms".** Both are readings of
the same instrument on the same sink — the spike's own wording gives it away
("both on the same isolated sink"). They vary what happens *inside the app*;
they do not vary what could fool the *meter*. One shared confounder turns both
green at once, as above.

**3. The PipeWire corroboration cited the wrong node, and the stated mechanism
is wrong.** The original claim was: *"a mid-window dump shows
`Electron:output_FL -> harness_sink:playback_FL`, node `state=running`,
`target=harness_sink`, so the 0.0 is Chromium writing zeros into a live
connection."* Two reviewers independently found there are **two**
`Stream/Output/Audio` nodes named `Electron` in the same pid during a capture
run, and ordered them by `object.serial`:

| run | earlier node (the view's `<audio>`) | later node (host page's AudioContext, gain 0) |
|---|---|---|
| `nocapture` | running + active *(only one node exists)* | — |
| `silent` | idle | running |
| **d** (leaking) | **running** | running |
| **b** (muted) | **suspended**, links `paused`, then **destroyed mid-window** (present at +2.56 s, gone by +5.71 s of a 2.50–6.50 s window) | running |

The `state=running` node that was cited is the **harness's own zero-gain monitor
path** — `host.html` routes the analyser to `ctx.destination` through a gain of
exactly 0, so it writes digital silence by construction.

> **The mechanism, restated correctly:** on a muted, captured run **the view's
> own output stream goes idle/suspended and is then torn down.** Chromium does
> not keep it running and write zeros into it. Same outcome for the user; a
> different mechanism, and the earlier sentence should not be cited.

That dump therefore cannot close "the app was never connected". What *does*
close it is `target.object == <measured sink>` on **the view's own node**, which
review measured and the spike does not record.

### Watched failing

`spike/bin/mutations.sh` scores the committed local records **unmutated first**
— which must go green, or nothing after it means anything — then routes the app
to a decoy sink while the meter stays on the real one and scores them again. The
`nocapture` control goes red, a/b/c print `VOID`, the other two controls stay
green, and the exit code is 1:

```
  FAIL control local/nocapture  speaker meter can hear this app
  PASS control local/local-echo  speaker meter can hear the view DURING a capture
  FAIL local/a  VOID — no verdict, the controls did not hold
  FAIL local/b  VOID — no verdict, the controls did not hold
  FAIL local/c  VOID — no verdict, the controls did not hold
  PASS control local/silent-source  ...
  PASS control sink-exclusivity  1 run(s) witnessed mid-window, no foreign writer
  spike: 3 passed, 4 failed          exit 1
```

Each of those lines is **asserted**, not printed. An exit code alone was the
whole of the old assertion, and Limitation 9 shows a mutation that defeats it.

One control also caught a real defect unprompted: the `silent` negative control
read **0.350295** instead of 0 on its first outing, because
`fixture/player.html` autoplayed regardless of the flag — it was only honoured
in `main.js`. That control earning its keep on its first run is the argument for
keeping it.

`mutations.sh` used to assert only that exit code. Limitation 9 has what was
wrong with that, the two mutations it is now watched failing against, and what
it asserts instead.

---

## Electron issue 32788 — the maintainer comment, addressed

The comment cited in `desktop-app-plan.md` §3/§7 says `tabCapture`'s *"silence
the tab locally while captured"* behaviour is **not replicable in Electron, even
with `enableLocalEcho`**.

**On Electron 44 / Chromium 152 / Linux, that is not what happens — but the
comment is closer to right than the first draft of this document allowed.**

What contradicts it:

- `enableLocalEcho` is documented as *"local playback of audio will **not** be
  muted"*, **default `false`**. The default *is* the silencing, and it is
  Electron/Chromium doing it, not something the app arranges.
- The knob is observable on the track itself: `getSettings().deviceId` reads
  `web-contents-media-stream://5:1?local_echo=false` in variants a/b, and
  `web-contents-media-stream://5:1` (no query) in c/d.
- Variant **d** — `enableLocalEcho: true`, not muted — leaks at full level on
  both pages. The flag is live, not ignored.

What **confirms** the spirit of it, and was missed originally:

- The silencing is **scoped to the capture**, not to the view. Variant (a) is
  audible for the entire 1.90 s between the view starting to play and
  `getDisplayMedia` being called. "Silence the tab locally while captured" is
  exactly and only what Chromium does — the *while captured* is load-bearing,
  and an app that wants the original inaudible must mute it itself.
- The mechanism is not the one `tabCapture` uses. The view's output stream is
  **suspended and torn down**, not muted-in-place.

**Conclusion: it does not describe Electron 44 on Linux for the property the
plan needs, and the plan is not blocked by it here — but the gate must not rest
on the default.** Hence variant (b): `setAudioMuted(true)` is explicit, is
applied before the view plays, and can be asserted. It also holds on a platform
where the `enableLocalEcho` default flips. **Whether the comment describes macOS
is the single most important thing the Mac re-run has to settle.**

---

## Sample rate

`getSettings()` on the captured track: **`sampleRate` 44100, `channelCount` 2,
`sampleSize` 16** — identical on both pages, every run. That matches §3's note
that Chrome resamples 48 k → 44.1 k natively in the extension today.

A **default** host `AudioContext` opens at **48000**, so the default path
inserts a resampler in the renderer. Forcing the host context to 44100
(`--ctx-rate=44100`) works, and the whole path then runs at one rate with **no
resampler anywhere**:

| page | track | context | worklet | capturedRms | speakerRms |
|---|---|---|---|---|---|
| local | 44100 | 44100 | 44100 | 0.349734 | 0.0 |
| youtube | 44100 | 44100 | 44100 | 0.083674 | 0.0 |

`CONTRIBUTING.md`'s settled decision — one `AudioContext` at 44 100 Hz, the
model's native rate, no JS resampling on the live path — **survives intact into
the desktop host.** The host must open its context at 44100 explicitly; the
default does not.

---

## Navigation and reload

Both measured as a second window, after the navigation, on the **same**
`MediaStream` that was opened before it. The stream was never reopened.

| event | page | capturedRms before | after | speakerRms after | track `readyState` |
|---|---|---|---|---|---|
| full page reload | local | 0.350511 | 0.353480 | 0.0 | `live` |
| full page reload | youtube | 0.112063 | 0.111137 | 0.0 | `live` |
| SPA nav (clicked a related video) | youtube | 0.111552 | **0.048187** | 0.0 | `live` |

**Capture survives both.** The SPA navigation landed on
`watch?v=MnErAA7R0Ak&list=RD…` — a different video — and the stream followed it.
0.048 is that video's own level, not a decay; it is 4.8× the floor. The grant is
bound to the **WebContents**, not to the document: the handler answers with
`view.webContents.mainFrame` read at call time.

The click was a real click in the page. No URL was resolved or parsed by us
(rule L1).

---

## Versions

| | |
|---|---|
| Electron | 44.0.0 (plan requires ≥ 32, seed §6) |
| Chromium | 152.0.7977.54 (extension floor is 128) |
| Node (in Electron) | 24.18.1 (host shell: v22.23.1) |
| V8 | 15.2.124.13-electron.0 |
| OS | Linux 6.17.0-41-generic, x64 |
| Display | Xvfb, headed (`xvfb-run -a -s "-screen 0 1280x1024x24"`) |
| Audio | PipeWire `support.null-audio-sink`, routed via `PULSE_SINK` / `PIPEWIRE_NODE` |
| Hardware audio | **none** — `aplay -l`: no soundcards found |

---

## The permanent gate

> **BUILT.** `tools/suites/capture-mute.mjs`, registered in `tools/verify.mjs` as
> the `capture-mute` step (`window`, `sink`), specified in `docs/TESTING.md` §8
> and falsified by `tools/suites/capture-mute-mutations.sh`. Everything below is
> the specification it implements; the differences that emerged while building it
> are recorded in `docs/TESTING.md` §8, not here. Two are worth naming from this
> side:
>
> - **The measured level came out where this document says it should.** A clean
>   run reads `capturedRms 0.350831` over `1496` quanta with the device at
>   bit-exact `0.0`, and the mutation that asks for `audio: true` reproduces
>   Limitation 6 to three decimal places: `rms 0.106369`, `channelCount 1`,
>   `sampleRate 48000`, all three processing flags `true`, and a per-quantum
>   series decaying `0.266 -> 0.184` inside one 4 s window.
> - **`autoGainControl: true` alone is ignored** by Chromium for a web-contents
>   capture — asked for on its own, the track still comes back stereo/44100 with
>   AGC off. It takes `echoCancellation` or `noiseSuppression` to move the capture
>   onto the processed path, and that path turns everything on at once. So there
>   is no isolated mutation for the AGC assertion; its red comes from the
>   Limitation-6 run.

Variant (b), against the local fixture. The four assertions this spike first
proposed are **not sufficient** — review built a run that satisfies all four
while producing a stream that is useless for stem separation (Limitation 6). The
gate must assert all of:

**Muted, and the capture is real**

1. `ytView.webContents.isAudioMuted() === true`.
2. `capturedRms` inside a **band**, not above a floor: the fixture's level is
   analytic (0.353553), so assert `0.30 <= capturedRms <= 0.40`. A floor alone
   passes an AGC-crushed stream at 0.108.
3. The window reports the **render-quanta count** it actually saw, and the
   assertion is grounded on that count (`>= 1450`), **not on wall seconds**.
   `capturedSeconds` jitters 3.979–4.011 s around 4.0; a literal `>= 4 s`
   assertion goes red on ~10 % of unmodified runs (`AGENTS.md`: a gate whose
   verdict changes on code that did not change is measuring the machine).
   0 quanta must be an error, never "silence".

**The capture is usable** — none of this is optional for a stem separator

4. `track.getSettings()` reports `channelCount === 2`, `sampleRate === 44100`,
   and `autoGainControl === false`, `echoCancellation === false`,
   `noiseSuppression === false`.

**Silent, and the silence means something**

5. `speakerRms <= 0.0005` measured **outside** the process, over **the app's
   whole lifetime** — from before the source starts playing, not from capture
   start. This is the assertion that converts (a) from PASS to FAIL, and it is
   the single change that makes the gate mean what it says.
6. The speaker side carries its own **could-it-look** guard: a zero-length or
   short recording is an error (`rms.py` exit 3 / `--min-seconds`), never a 0.
7. **Per-run, in-window:** the app-under-test's own `Stream/Output/Audio` node
   exists, names this pid, and carries `target.object == <measured sink>`. This
   — not a sink-level control — is what closes "the app was never connected",
   and a third party's audio cannot satisfy it.
8. No node other than this pid's is linked to the measured sink during the
   window, and the run holds a **lock** on the sink.

**Not asserted, deliberately**

- `isCurrentlyAudible() === false`. It stayed **true** in every muted run, in
  the original matrix and in all three audits. It reports that the page is
  producing audio, not that anything can hear it. Asserting it false is a gate
  that can never pass.
- "the `nocapture` control reads `>= 0.01` **in the same run**", as originally
  written. `nocapture` requires `getDisplayMedia` never to be called, so it
  cannot share a process with a capture run. Either drop *"in the same run"* or
  redesign it as a two-window run: window 1 unmuted-with-echo as the live
  control, window 2 muted as the measurement.

A **cheap bonus assertion**: the track's `getSettings().deviceId` carries
`?local_echo=false` when the flag is unset and drops the query when it is true,
so the knob is directly observable. It catches none of 4, so it is a bonus and
not a substitute.

---

## Limitations

This section is the part to read. It folds in three adversarial audits — the
measurement-integrity audit (which **refuted** part of the original claim), the
reproducibility audit, and the product audit. Findings that do not change the
verdict are here too.

### 1. macOS has not been run — the kill criterion is not discharged

`desktop-app-plan.md:129-135`, verbatim: *"On macOS (the priority platform) at
least one variant yields captured RMS above threshold while the speakers are
silent. **This is the KILL CRITERION for the whole plan**"* and, separately,
*"Results for Windows and Linux recorded if machines are available (**not
blocking**)."*

Every run here reports `platform: linux`. **The spike produced a result on the
axis the plan explicitly designated non-blocking, and zero evidence on the axis
that decides the program.** Reading this document as authorising step 2 is
precisely the mistake the plan's spike-first sequencing exists to prevent.

**What a Mac run has to show**, in priority order:

1. **That the capture carries audio at all.** The leg most likely to break on
   macOS is *"the app can hear it"*, not *"the user cannot"*. `host.html`'s
   guard — *"the display-media grant carried NO audio track"* — has never fired
   and has never been watched failing on the platform that matters. macOS
   `getDisplayMedia` audio has historically been the weakest of the three
   platforms.
2. **Whether Electron issue 32788's maintainer comment describes macOS.** If
   the `enableLocalEcho` default does not silence there, variant (b)'s explicit
   `setAudioMuted(true)` is the only thing standing between the user and the
   original — which is exactly why (b) and not (a) is the recommended gate.
3. **The speaker side on real hardware or a real loopback device**
   (BlackHole / Loopback / a Core Audio aggregate device), measured
   **continuously across the app's whole lifetime**, not across the capture
   window.
4. **`getSettings()`**: `channelCount`, `sampleRate`, and the three processing
   flags. A mono or 48 kHz capture on macOS changes the engine's plumbing.
5. Windows likewise, and likewise non-blocking.

Tracked as [#2](https://github.com/itziklerner-pag/stem-workbench/issues/2),
carrying this list. It is blocked on hardware, and it is **not** a blocker for
step 2 — see the ruling in the Verdict above.

### 2. Only the local variants were re-measured with the corrected instrument

The whole-lifetime continuous recording was run for local (a), (b), (c), (d),
`nocapture` and `silent`. **The YouTube rows were never re-measured that way.**
YouTube (a) carries the same pre-capture-window defect as local (a); YouTube (b)
and (c) rest on the capture-window meter alone.

### 3. There are no real speakers on this box, and "silence" was never heard

`aplay -l` returns *"no soundcards found"*. The only PipeWire sinks are the
harness's own null sinks. **"The user does not hear the original" has never been
observed on any hardware output path** — only as zero-valued PCM frames in a
virtual sink. The plan's own step-1 text asks for the speakers to be checked
*"by ear; by OS loopback if available"*; the by-ear half was never physically
possible here.

Related: the meter watches exactly one node, and nothing asserts that node is
the only place the app's audio could have gone. That is true here only by
accident, because only null sinks exist.

### 4. The spike never tested the product's other half — the deck playing stems

`spike/host.html` sets `const MONITOR_GAIN = 0`, so in all ~40 recorded runs the
host window emits no sound. **The recorded evidence is therefore equally
consistent with "`getDisplayMedia` silences the entire app while capturing"** —
under which the deck could never play stems and the product does not exist.

Review tested it and it holds. With the host page playing 700 Hz at peak 0.5
while the view played the 440 Hz fixture muted and captured, a Goertzel analyser
at exact integer bins read the sink as **700 Hz at 0.494564 and 440 Hz at
0.000144**; **97 of 99 consecutive 50 ms blocks read exactly 0.000000 at 440
while 700 read exactly 0.500000** (the two non-zero 440 blocks are the
recorder's own partial first and last blocks, where 700 also reads 0.394 /
0.068).

**The product shape works — but this spike did not establish it, and its
write-up must not be read as having done so.**

### 5. No capture feedback loop — also good news the spike did not claim

In the same host-tone runs, `capturedRms` stayed at the **440-only** level
(0.351283 and 0.351825 across two runs; analytic 0.353553), **not** the ~0.5 a
440 + 700 mix would produce. The capture is frame-scoped, so the deck's own stem
playback does not re-enter the capture — despite `restrictOwnAudio: false`
appearing in the track settings. For a live stem splitter, feedback here would
be a product-killer. It was never tested by the spike. It is now.

### 6. The originally-proposed four-assertion gate cannot tell a working capture from a ruined one

This is the sharpest product gap. Review ran variant (b) with the naive call
`getDisplayMedia({ audio: true })` — an implementer who omits the three
processing constraints. Result: `getSettings()` = `{ autoGainControl: true,
echoCancellation: true, noiseSuppression: true, channelCount: 1, sampleRate:
48000 }`, and the captured level **decayed 0.599857 → 0.035697 over 8 s** — a
17× AGC collapse.

That run satisfies **all four** originally-proposed assertions:
`isAudioMuted() === true`; `capturedRms = 0.10826`, **10.8× the 0.01 floor**,
over an 8 s window reporting 3000 quanta; `speakerRms = 0.0`; `nocapture`
control green.

**A mono, 48 kHz, noise-suppressed, AGC-crushed stream is a dead product for
stem separation, and the gate as originally specified calls it PASS.** Hence
assertions 2 and 4 in [The permanent gate](#the-permanent-gate).

More generally: level claims are only trustworthy with Chromium's audio
processing off. Every run recorded here passes `echoCancellation`,
`noiseSuppression` and `autoGainControl` as `false`. Presence/absence survives
AGC; any level claim does not.

### 7. Half the instrument was not in this repository — **fixed**

As originally written: `sink.sh`, `measure.sh`, `rms.py`, `pwnode.py` and
`env.sh` — the entire external speaker meter — lived only in a session
scratchpad under `/tmp`, and `spike/bin/run-variant.sh` **hardcoded that path as
its `AUDIO_HARNESS` default**. The reproducibility audit reproduced only because
that `/tmp` tree still happened to exist. Once it was gone the committed
evidence could not have been re-derived from this repository at all.

**Fixed.** All five files are vendored at
[`spike/harness/bin/`](../spike/harness/), every `spike/bin/*` script defaults to
them, and no `/tmp` path survives anywhere in `spike/` or `docs/`.
`AUDIO_HARNESS=` still overrides, so the original tree can be used if it happens
to exist; nothing requires it to.

**Watched, not assumed.** The `/tmp` tree was renamed aside and variant (b) was
re-run end to end twice from the repository alone — see
[Re-running](#re-running). Both runs reproduced the finding
(`capturedRms` 0.349998 and 0.350573; `speakerRms` and `speakerPeak` bit-exactly
0.0; `isAudioMuted()` true), and the `/tmp` tree was then restored. The check
is that it *works without the scratchpad*, not that it works.

### 8. `16 passed, 0 failed` was a property of a directory, not of a run — **fixed, with a residue**

The reproducibility audit ran only `run-all.sh local 4 3` — `youtube.com` was
never contacted — and the summary still printed all seven YouTube rows as PASS
and reported `spike: 16 passed, 0 failed`, scored from committed JSON lying in
the tree (file mtimes prove it). Worse:

- `PASS local/native-44100` is scored from `local-b-run44k1.json`, a file the
  documented re-run procedure **cannot produce** — `run-all.sh` never sets
  `CTX_RATE`.
- `silent-source` was scored over 3 runs where `run-all.sh` produces only 2.
- `merge.py` writes **no timestamp, no commit id and no run id**, so stale and
  fresh records are indistinguishable, and a re-run **silently overwrites the
  committed record in place** (one review run rewrote `local-b-run1.json` from
  0.350677 to 0.350522 with no signal at all).

**Fixed, with one residue.** `merge.py` now writes a `provenance` block into
every record — `runId`, `producedAt`, the `commit` and whether the tree was
dirty, the host, the **measured** sink and the sink the app was **routed to**,
the harness directory, and the mid-window sink witness (Limitation 10).
`run-all.sh` stamps one run id across the whole matrix; a standalone
`run-variant.sh` stamps its own. `summarise.py` then:

- **lists every record it is about to score** — tag, run id, when it was
  produced, at which commit, on which sink, and the file's mtime — before it
  scores anything;
- **refuses a directory holding records from more than one run**, printing
  `spike: VOID — N different runs in one directory` and exiting **2**. The
  reproducibility audit's exact scenario — `run-all.sh local` re-measuring the
  local rows while the youtube rows sit there from an older run — is now VOID
  instead of `16 passed, 0 failed`. `--allow-mixed-runs` overrides it, loudly,
  and `mutations.sh` is the one caller that needs it;
- **says so, every time, when records carry no stamp at all.**

`run-variant.sh` also announces an overwrite instead of performing it silently:
it prints which run produced the record it is about to replace and when.
`RESULTS_DIR=` re-runs into a clean directory and leaves the committed evidence
alone.

**The residue:** the 38 committed records in `spike/results/` were produced
before any of this existed and are **not** stamped. They have not been
back-filled — inventing a run id for records nobody can attribute would be worse
than admitting they have none. `summarise.py spike/results` therefore still
prints `16 passed, 0 failed` and exits 0, now preceded by an inventory and a
five-line warning that nothing ties those numbers to a run that actually
happened. It becomes VOID the moment anything is re-measured into that
directory, which is the correct behaviour and also the reason the two
post-vendoring re-runs were written to a scratch `RESULTS_DIR` instead.

Watched failing: with one freshly stamped record dropped into a copy of
`spike/results/`, `summarise.py` prints the VOID banner and exits 2; the same
directory with `--allow-mixed-runs` scores and exits 0.

### 9. The scorer's own VOID gap, and `mutations.sh` asserting only an exit code — **both fixed**

`python3 spike/bin/summarise.py <empty dir>` printed `spike: 0 passed, 0 failed`
and exited **0**. `BRIEF.md` §6.3 rule 3 names exactly that shape as VOID (*"a
suite whose filters exclude everything is VOID, not green"*), and the file's own
docstring says it is meant to be wired as a `verify.mjs` step. **Fixed in this
commit**: it now prints `spike: VOID — scored nothing` and exits 2. Watched
going red on the pre-fix bytes; `summarise.py spike/results` still prints
`16 passed, 0 failed`, exit 0, unchanged.

**`mutations.sh` asserted only an exit code — fixed.** Its whole assertion was
`if python3 summarise.py "$tmp"; then MUTATION NOT CAUGHT`, and its
`cp … 2>/dev/null || true` swallowed a failed copy. Run against a directory
holding only the M1 `nocapture` record, `summarise.py` exits 1 with
`0 passed, 2 failed` and **no a/b/c rows whatsoever** — and `mutations.sh` would
still have printed `M1 asserted RED: 1 mutation caught`. The documented red it
claims to assert was never checked. `AGENTS.md` rule 7: make it fail when it
cannot look.

It now asserts the **shape**, on both sides of the mutation:

1. every input record is copied with the copy **checked**, and the fixture
   directory is counted — a missing input aborts rather than producing a red of
   the wrong shape;
2. the **unmutated** directory is scored first and must be **green**; a mutation
   runner that is already red before it mutates has proved nothing;
3. the mutated record must itself show the mutation took — `provenance.appSink`
   is the decoy, `provenance.measuredSink` is the real sink, and the measured
   sink read ≤ the silence ceiling;
4. the mutated summary must print exactly the documented red — `FAIL control
   local/nocapture`, `FAIL local/a|b|c  VOID — no verdict`, the `local-echo` and
   `silent` controls **still PASS** (so the mutation is targeted rather than
   general breakage), `4 failed`, no `PASS local/a|b|c` row anywhere, and exit
   **1** rather than **2** (2 would be "VOID — scored nothing", a different red).

Watched failing, twice:

- against a directory holding only a `nocapture` record — the Limitation-9
  scenario verbatim — it now aborts with `spike: missing input …local-a-run1.json`
  instead of claiming a catch;
- with `summarise.py`'s VOID rule deleted, `summarise.py` still exits non-zero
  (the `nocapture` control is red), so the **old** assertion would still have
  printed `M1 asserted RED`. The new one reports
  `MUTATION NOT ASSERTED: 5 shape check(s) failed` and names each: a/b/c printed
  PASS instead of VOID, the failure count was not 4, and a `PASS local/a` row was
  present.

The counts in the block above are the pre-fix ones. The current shape adds a
`PASS control sink-exclusivity` row (Limitation 10), so M1 now reads
`3 passed, 4 failed`; the assertion is written against the **rows**, and the only
count it pins is `4 failed`.

### 10. The measured sink was the machine's default sink, and was not exclusive — **mostly fixed**

As originally written: `default.audio.sink` is `harness_sink` for the whole user
session, and `harness_decoy` from `mutations.sh` lingers
(`object.linger=true`). `run-variant.sh` took **no lock**, and runs from other
sessions were observed on the same daemon during review. Contamination direction
is usually toward a false FAIL, so it did not threaten the (b) result — but
nothing asserted the app under test was the only writer, and if the decoy ever
became the default, a run where `PULSE_SINK` was ignored would read 0.0 and pass
for the wrong reason.

**Three of the four are fixed:**

- **Its own sink.** The default measured sink is now `stem_workbench_spike`, not
  `harness_sink`. The old name is the machine's session default and is shared
  with whatever else the box decided to play.
- **A lock.** `spike/harness/bin/env.sh:harness_lock` takes an `flock` for the
  life of the run, and `sink.sh create|destroy` takes it before touching a node
  — so one run of this repo cannot destroy a sink another run is measuring.
- **A witness.** `spike/harness/bin/pwlinks.py` is sampled **inside** the
  measurement window and records every node linked into the sink's playback
  ports, with pid, target and link state. It lands in the record as
  `provenance.sinkWitness` / `foreignWriters` / `sinkExclusive`, and
  `summarise.py` **fails** a run whose window had a foreign writer. That is the
  second half of the gate's assertion 8.
- **`mutations.sh` cleans up after itself.** Its decoy is now
  `stem_workbench_spike_decoy` and it is destroyed on exit rather than left
  lingering on the daemon.

The witness also corroborates the corrected mechanism from an angle the spike
did not have. In a post-vendoring variant (b) run it caught **exactly the two
`Stream/Output/Audio` nodes** the mechanism section describes, both in the
Electron pid: one `state=suspended` with its link `paused` (the view's own
output), one `state=running` with its link `active` (the host page's zero-gain
monitor path) — and no third-party writer.

**What is NOT fixed, and cannot be by a lock:** a lock binds only runs that
cooperate. Nothing stops an unrelated process from linking to the sink; the
witness *records* that rather than preventing it. And the app's own node is
still only recorded, never asserted — gate assertion 7 (*the app's own
`Stream/Output/Audio` node exists, names this pid, and targets the measured
sink*) is what actually closes "the app was never connected", and it is tracked
in [#3](https://github.com/itziklerner-pag/stem-workbench/issues/3), not built
here.

**Built there, and watched losing.** `tools/suites/capture-mute.mjs` asserts it
per run, and `capture-mute-mutations.sh` case 4 is the review scenario verbatim:
the app is routed to `stem_workbench_gate_decoy` while the meter stays on
`stem_workbench_gate`, the silence assertion goes **green — for the wrong
reason**, and the node witness is the only thing that goes red
(`0/3 in-window samples carried it`). That is the assertion earning its keep.

Forced routing itself is *not* in the causal chain: review ran (b) with neither
`PULSE_SINK` nor `PIPEWIRE_NODE` set, so the app used the system default device,
and measured that device — 700 Hz 0.494788, 440 Hz 0.000168, `capturedRms`
0.351825, stereo / 44100 / AGC off. A simultaneous recording of the *other* sink
read 0.0 at both frequencies, so there is no unmeasured output path.

### 11. The three "runs" are deterministic replays, not independent samples

The fixture is a 60 s tone restarted from t=0 every run, so each run re-measures
the same signal. A fresh reload window landed at 0.353480465 against the
committed 0.353480463 — identical to eight decimal places. **The 0.3497–0.3515
spread is window placement, not measurement noise.** Fine for a
presence/absence claim; n=3 buys almost nothing beyond it.

The reproducibility audit did find the result robust to everything it tried:
a cold first-ever run with `out/userdata` wiped (cap 0.350522, spk exactly 0.0),
seven further b runs (0.350132 – 0.351531, speaker exactly 0.0 every time), and
a deliberate cross-run leak probe (d → b → nocapture → b → d → b, putting
full-level audio into the same sink immediately before every b run) — every b
window still bit-exactly 0.0 on both rms and peak.

### 12. `SILENCE_CEILING` is never exercised, and the silence side has no duration floor

Every silent reading is bit-exactly 0.0 with peak 0.0, so the 0.0005 ceiling
could be any positive number and the result would be identical. **It is the
discrimination between 0 and 0.35 that carries the claim, not the threshold.**

Separately, `speakerSeconds` was under 4 s in 39 of 41 committed windows
(3.957–4.0), `measure.sh` accepts anything ≥ 60 % of the requested window
(2.4 s at `SECS=4`), and `summarise.py` **never reads `speakerSeconds` or
`capturedSeconds` at all**. As originally specified, "the speakers were silent"
could be certified over 2.4 s and nothing in the scored record would notice.
Hence assertions 5 and 6 in [The permanent gate](#the-permanent-gate).

### 13. The capture-side instrument is sound — this one survived attack

Worth recording, because the rest of this section is corrections. Fitting
`local-b-run1`'s per-quantum RMS series to a pure sine gives **f = 440.00 Hz,
A = 0.5, mean |err| = 0.000407** over 37 points; the observed 11.9 % ripple is
exactly what a 440 Hz sine yields when RMS'd over a 128-frame quantum (1.17
cycles) and sampled every 40th quantum. A DC offset gives zero ripple; noise
does not fit a sine; the reported `peak = 0.49996` matches the fixture's 0.5.
Self-feedback is impossible — the worklet never writes its output, and the
monitor gain is 0 and is recorded per-run as `monitorGain: 0`. The `silent`
control reads exactly 0.0 over 1500 quanta, and the `quanta == 0` /
`quantaWithChannels == 0` guards make a broken window an error rather than a
zero.

The speaker side's **zeros are real zeros**, too: every "silent" WAV in
`spike/results/` is bit-exact — 0 non-zero samples out of ~383,000, with
190,976–192,000 frames at 48 kHz. A suspended sink or a dead recorder would have
produced short or empty files, which `rms.py` turns into exit 3 rather than a 0.
The tone WAVs are genuinely 440.0 Hz with 99.99 % of energy in the peak bin.

### 14. YouTube is a realism check, not a repeatable gate — and one YouTube run measured an ad

The YouTube run needed no sign-in and hit no bot wall from this IP, **once**, on
2026-08-25. YouTube's DOM, bot walls and ad insertion can all change under it.

The evidence is also uncontrolled: `youtube-b-run44k1.probe.json` records
`duration 60.101` and `volume 0.568`, where every other YouTube run records
`duration 213.061` and `volume 0.893`. **That run was measuring a different
item, almost certainly a pre-roll ad**, and its capture series dips to 0.00428 —
within 2.3× of the proposed 0.01 floor.

Keeping the permanent gate on the local fixture is the right call (CI must not
depend on YouTube's DOM). **The accepted risk, named rather than implied:
nothing in CI will ever catch a YouTube-side regression** — DRM/EME-protected
content returning silence, a player change, an autoplay-muted default. That
needs a manual re-check on a cadence, not a green local gate implying YouTube
still works.

### 15. The measurement window is 4 s

A leak shorter than that would be averaged down. Nothing here rules out a
transient click at a navigation boundary — though the 1.90 s pre-capture leak in
variant (a) is precisely a "short" leak that the whole-lifetime instrument did
catch, and it is the reason assertion 5 exists.

---

## Re-running

Everything needed is in this repository. Requires Linux + PipeWire
(`pw-cli`, `pw-link`, `pw-record`, `pw-dump`), `python3` with `numpy`, `flock`,
`ffmpeg`, and `xvfb-run`.

```bash
npm i -D electron
spike/bin/make-fixture.sh              # 60 s tone, ffmpeg; md5 15c893ddfc606f988ae0b0659abcb5c1
spike/bin/run-all.sh both 4 3          # the whole matrix -> "spike: 16 passed, 0 failed"
spike/bin/mutations.sh                 # assert the controls can lose, in the documented SHAPE
python3 spike/bin/summarise.py spike/results
```

`spike/harness/` is the external speaker meter and is the default;
`AUDIO_HARNESS=` overrides it. `run-all.sh` wraps every Electron run in
`xvfb-run -a -s "-screen 0 1280x1024x24"` and serialises them — every run writes
into the same isolated sink, so two at once measure each other — and
`run-variant.sh` holds an `flock` on the sink for the life of each run.

**A re-run overwrites the committed records** (Limitation 8) — loudly now,
naming the run it is replacing, but it still overwrites. Use a scratch
directory if the committed numbers matter to you:

```bash
RESULTS_DIR=/tmp/spike-rerun spike/bin/run-all.sh local 4 3
```

Re-measuring only part of the matrix into `spike/results/` leaves records from
two different runs in one directory, and `summarise.py` will VOID rather than
score them. That is deliberate.

### Re-derived from this repository alone

The vendoring was checked the only way it can be: the `/tmp` scratchpad the old
default pointed at was **renamed aside**, variant (b) was run end to end twice,
and the scratchpad was then restored. Both runs, Electron 44.0.0 / Chromium
152.0.7977.54, fixture analytic RMS 0.353553:

| run | capturedRms | quanta | speakerRms | speakerPeak | `isAudioMuted()` | sink exclusive |
|---|---|---|---|---|---|---|
| 1 | 0.349998481 | 1500 | **0.0** | **0.0** | true | yes |
| 2 | 0.350572714 | 1500 | **0.0** | **0.0** | true | yes |

Both fall inside the committed (b) spread (0.349763–0.351382). The track read
`sampleRate 44100`, `channelCount 2`, `readyState live`. `isCurrentlyAudible()`
was **true** in both, as in every muted run ever recorded here — which is why
the gate must not assert it false.

These two runs were written to a scratch `RESULTS_DIR` and are **not** committed:
dropping them into `spike/results/` would have mixed two runs in one directory,
which is exactly what `summarise.py` now refuses.

Raw per-run JSON: `spike/results/*.json` — one file per run. `*.probe.json` is
the app's own output, `*.sink1.json` / `*.sink2.json` the external meter's,
`*.prov.json` the provenance stamp and `*.links*.json` the sink witness; all of
those are gitignored, and the merged record carries what matters from them.
