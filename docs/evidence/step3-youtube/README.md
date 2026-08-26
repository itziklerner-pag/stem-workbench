# Step 3, the YouTube Live source — what one real run produced

**Everything in this directory came out of a single launch of the real app**, on
2026-08-26 (`19:17:34Z`), Electron 44.0.0 / Chromium 152.0.7977.54, Linux,
headless under `Xvfb`. Reproduce it with:

```bash
node tools/verify.mjs --only youtube      # ~6 min; needs the network and the weights
```

and judge this recorded run again, without launching anything, with:

```bash
YOUTUBE_REPORT=docs/evidence/step3-youtube/report.json node tools/suites/youtube.mjs
```

**Result: 25 assertions, 0 failed** — [`youtube-suite.log`](youtube-suite.log) is
the transcript, line for line.

| file | what it is |
|---|---|
| [`window.png`](window.png) | **the whole application**, off the X display: our 44 px bar, `youtube.com` playing, the deck across the bottom with its six strips |
| [`deck.png`](deck.png) | the deck view alone, `capturePage()` |
| [`source.png`](source.png) | the source view alone, `capturePage()` |
| [`report.json`](report.json) | everything the probe read out of the running app — the seam trace, the capture, the model, the meters, the separator |
| [`engine.log`](engine.log) | the engine's own log, in its own words, from boot to teardown |
| [`meters-sample.json`](meters-sample.json) | the `METERS` series the deck received, decimated 16:1 |
| [`youtube-suite.log`](youtube-suite.log) | the 25 assertions, with their measured details |
| [`capture-mute-report.json`](capture-mute-report.json), [`capture-mute-suite.log`](capture-mute-suite.log) | the permanent gate's own run: the view captured at full level while the audio device reads bit-exact zero |
| [`mutations-report-rows.log`](mutations-report-rows.log) | the mutation battery over **this** report — 41 rows, 41 caught, **coverage 25/25** |
| [`mutations-L1.log`](mutations-L1.log), [`mutations-L2.log`](mutations-L2.log), [`mutations-L3.log`](mutations-L3.log) | the three PRODUCT mutations: a real edit to `src/`, a real launch against the real site, each one caught. Recorded on an earlier run of the same tree |

---

## 1. The gesture, in order

`youtube.com/watch?v=dQw4w9WgXcQ` — *Rick Astley — Never Gonna Give You Up (4K
Remaster)*, 213.061 s.

1. The app loaded the page into its source view, **muted before the first load
   and across every navigation it made** — `mutedAtCreate: true`,
   `mutedBeforeLoad: [true]`, `unmutedNavigations: 0` after 9 navigations.
2. **YouTube autoplayed it.** The probe read the player first and found
   `paused: false` at `t = 1.46 s`, so its click was not needed this run and it
   recorded `["already playing"]` rather than pressing anything. When the page
   arrives paused, the probe sends a real left click at the centre of YouTube's
   own `<video>` — `video.play()` appears nowhere in `src/` or in the probe, by
   rule L1.
3. **No pre-roll before arming** (`adShowing: false`, 69 ms). One appeared later,
   after the page reload in step 8, and the probe pressed YouTube's own **Skip**
   once and waited 1.1 s before measuring anything.
4. **`Source → Arm this Source`** was clicked on the application menu —
   accelerator `Ctrl+Shift+A`. That is the same click a user makes.
5. `SESSION` reached the deck; the **deck** asked for the capture
   (`SW_CAPTURE_START`); the **Host** originated `CAPTURE_START` with six
   envelope keys — `from, source, sourceToken, to, type, v` — carrying a 36-char
   token and a `source` of exactly `{title, url}`. No `tabId`, no `streamId`:
   this product has no tabs.
6. The engine recorded **1,425,408 frames / 32.3 s** at peak
   **[0.608, 0.594]** — real audio at full level, while the view was muted and
   the audio device stayed silent (§4).
7. The **109 MB of weights** went through the Host — all **114,559,139 bytes**,
   in 580 ms — the unit verified their SHA-256, and ORT built a session
   (`ep: wasm`, 4 threads, `adapter: null`). No `DECK_PREPARE` was involved: on
   the arm-first path the capture builds the session itself.
8. A **full page reload** did not take the capture with it: `recording` before
   and after, frame counter 1,449,984 → 1,978,368, still muted. The grant is
   bound to the `WebContents`, not to the document.

## 2. The six stems

One 7.8 s `SEGMENT` of the captured audio, through the Host's own
`createBackend()` and `modelBytes()`, **with no deadline**. The playhead was
moved to **48 s** first — through `DeckTransport.drive`, the deck's own verb and
its closed write set — and landed at **50.39 s**, in the body of the song rather
than its intro; `adShowing: false`, `duration: 213.061`, so this is the song and
not an advertisement. The audio was read off the track with
`MediaStreamTrackProcessor`: **343,980 of 343,980 frames** at 44 100 Hz.
`load()` took **6742 ms** (create 724 · warmup 5665) and `separate()` took
**5485 ms** (prep 92 · infer 4870 · post 522).

| stem | rms L | rms R | peak |
|---|---|---|---|
| drums | 0.066890 | 0.058397 | 0.566612 |
| bass | 0.037113 | 0.026569 | 0.167636 |
| other | 0.030644 | 0.036382 | 0.211143 |
| vocals | 0.122456 | 0.126314 | 0.622599 |
| guitar | 0.002328 | 0.002366 | 0.019544 |
| piano | 0.000175 | 0.000187 | 0.001546 |

In the model's own `STEMS` order — `drums, bass, other, vocals, guitar, piano` —
which is **not** the order the deck paints them in (`ui/embed.js`'s rack is
`vocals, drums, bass, other, guitar, piano`). Both are asserted, separately.

Read as a human would: at 50 s that song is a full chorus, so **vocals loudest**,
drums right behind, bass and the residual *other* present, guitar barely there,
and **piano essentially silent — that song has no piano**. Six distinct signals,
**56.9 dB** from the loudest to the quietest.

**The sum is the row that cannot be faked by a meter.**

| | |
|---|---|
| rms(mix) | 0.164336 |
| rms(Σ stems) | 0.159585 — **0.971x** the mix |
| rms(mix − Σ stems) | 0.017901 — **0.109x** the mix |

`htdemucs` is a masking separator: its six stems add back to the input, and they
do. **Six copies of one mix would sum to six times it**, leaving a residual of
5x — which is exactly what a stalled pipeline publishes when it fans the
passthrough out across six planes, and what a level-only check calls a pass.

The capture the model was fed: `channelCount: 2`, `sampleRate: 44100`,
`autoGainControl / echoCancellation / noiseSuppression` all **false**,
`local_echo=false`; the segment's own rms **L 0.1636 / R 0.1651**.

## 3. What this machine could NOT show

**Live separation did not keep up here, and that is a property of the box.**

| | |
|---|---|
| chunks | 11 |
| drops | **11** |
| p95 per chunk | **5676.8 ms** |
| hop deadline | 1950 ms |
| execution provider | `wasm`, 4 threads, `adapter: null` |

`offscreen/live.js` runs one 7.8 s segment every 1.95 s hop, so live mode needs
about **4x real time**; this box does one segment in ~5.5-6.4 s, which is 0.7-0.8x
real time and about **3.3x short**.

**There is no GPU to fall back on, and the reason is the headless X server rather
than the hardware.** The box has an Intel iGPU on `/dev/dri` and this user can
open its render node; under `Xvfb` Chromium still ends up with no GPU at all, and
the chain was measured in this order:

```
WARNING:ui/gfx/linux/gbm_support_x11.cc:48] dri3 extension not supported.
getGPUFeatureStatus() -> webgpu "disabled_off", vulkan "disabled_off", webgl "disabled_off"
getGPUInfo('basic')   -> throws "GPU access not allowed. Reason: GPU access is
                          disabled due to frequent crashes."
navigator.gpu         -> undefined, in every renderer
```

So the engine logged *"deck A webgpu unavailable (Failed to get GPU adapter) —
falling back to wasm"* and ran on 4 threads, which the unit pins at
`min(4, hardwareConcurrency >> 1)`. **Anyone putting this in CI should expect the
same**: a hosted runner with a virtual display has no GPU process, whatever the
host hardware is.

So every chunk missed its deadline, and the deck did what it is designed to do:
dropped it, played the **passthrough** mix from the capture ring's own history,
and showed **Starving** with a drop count. The six per-stem meters read
`0.000000` for all 574 frames of the measuring window while the master read
**0.1166** — the user hears the song, unseparated, and the faders do nothing.

That is why the six stems above are measured **without the clock**: separating
six stems and keeping up with playback are two different claims, and only the
first one is about the product. The unit's hop ladder tops out at 3.9 s and the
embedded deck exposes no hop control, so nothing in the product closes a 3.3x
gap on this hardware.

**`deck.png` and `window.png` show the Starving badge.** They are the honest
picture of this box, not of the product on a machine with a working GPU.

## 4. The other half of the premise — the speakers stayed silent

From the permanent gate (`capture-mute`, same day, same tree —
[`capture-mute-suite.log`](capture-mute-suite.log), **15 assertions, 0 failed**):

| | |
|---|---|
| what the app captured | rms **0.351046**, peak **0.500005**, stereo, 44 100 Hz, AGC/echo/noise off |
| what the audio device heard | rms **0.000000** (≤ 0.0005), peak **0.000000**, over **7.360 s / 353,280 frames** of the sink's monitor, measured **outside the process** |
| the control | a variant (d) process with one flag flipped, on the same sink inside the same lock, **was heard**: rms 0.254986 |

The control is what makes the silence readable: the meter can hear something, and
it heard nothing from the app.

That gate runs against the LOCAL fixture, not against YouTube, because it needs a
PipeWire sink it owns and a control it can flip. What this YouTube run adds to it
is the same property on the real site, one level up: `isAudioMuted` true for the
view's whole life, `unmutedNavigations: 0`, and a capture at peak 0.61 taken off
it anyway.

## 5. Every assertion here was watched red

`AGENTS.md`: *an assertion you did not watch fail is not evidence.*

| | |
|---|---|
| **41 report rows** | one field of this recorded report doctored at a time, re-judged with `YOUTUBE_REPORT=<file>`. 41 caught, **coverage 25/25** — every assertion was turned red by some row, and every row turned red exactly the set it declared |
| **3 product rows** | a real edit to `src/`, a real launch against the real site. `L1` deletes the mute → 1 red, the mute assertion. `L2` removes the arm accelerator → 1 red, the arm assertion. `L3` makes the Host originate no `CAPTURE_START` → **8 reds**, every one downstream of that message |

The two halves prove different things and neither stands in for the other: the
report rows prove the **assertions** can fail and name the right thing; the
product rows prove the **probe measures the product**.

## 6. What a reader should not take from this

- **It is one run, on one machine, on one video.** `docs/TESTING.md` §7 forbids
  this suite a level *band* for exactly that reason; every level claim in it is
  presence/absence against one floor.
- **Nothing here was heard by a human.** There is no soundcard on this box. The
  silence is a number off a null sink's monitor and the stems are arithmetic over
  a buffer.
- **The live path has never been seen working.** It is wired, it runs, and on
  this hardware it drops every chunk. Nobody has yet run this on a machine whose
  GPU Chromium will talk to, so "it keeps up on a real desktop" is a prediction,
  not a measurement.
- **macOS has never run any of it.** The plan's kill criterion is written against
  macOS; this is Linux, by ruling, and the substitution is stated in
  `docs/TESTING.md` §11.
