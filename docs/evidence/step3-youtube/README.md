# Step 3, the YouTube Live source — what one real run produced

**Everything in this directory came out of a single launch of the real app**, on
2026-08-26 (`22:22:52Z`), Electron 44.0.0 / Chromium 152.0.7977.54, Linux,
headless under `Xvfb`. Reproduce it with:

```bash
node tools/verify.mjs --only youtube      # ~6 min; needs the network and the weights
```

and judge this recorded run again, without launching anything, with:

```bash
YOUTUBE_REPORT=docs/evidence/step3-youtube/report.json node tools/suites/youtube.mjs
```

**Result: 26 assertions, 0 failed** — [`youtube-suite.log`](youtube-suite.log) is
the transcript, line for line.

> **READ §3 BEFORE §2.** Six stems really do come out of the separator inside
> this app, and §2 is the arithmetic. The product's HEADLINE BEHAVIOUR — six
> stems moving live while the video plays — **has never been observed working, by
> anybody, on any machine.** §3 is that, with numbers.

| file | what it is |
|---|---|
| [`window.png`](window.png) | **the whole application**, off the X display: our 44 px bar, `youtube.com` playing, the deck across the bottom with its six strips |
| [`deck.png`](deck.png) | the deck view alone, `capturePage()` |
| [`source.png`](source.png) | the source view alone, `capturePage()` |
| [`npm-start.png`](npm-start.png) | a separate, plain `npm start` — no gate flag at all — 45 s after launch (§6) |
| [`report.json`](report.json) | everything the probe read out of the running app — the seam trace, the capture, the model, the meters, the separator |
| [`engine.log`](engine.log) | the engine's own log, in its own words, from boot to teardown |
| [`meters-sample.json`](meters-sample.json) | the `METERS` series the deck received, decimated 16:1 (67 of 1,060) |
| [`youtube-suite.log`](youtube-suite.log) | the 26 assertions, with their measured details |
| [`capture-mute-report.json`](capture-mute-report.json), [`capture-mute-suite.log`](capture-mute-suite.log) | the permanent gate's own run: the view captured at full level while the audio device reads bit-exact zero |
| [`mutations-report-rows.log`](mutations-report-rows.log) | the mutation battery over **this** report — 43 rows, 43 caught, **coverage 26/26** |
| [`mutations-L1.log`](mutations-L1.log), [`mutations-L2.log`](mutations-L2.log), [`mutations-L3.log`](mutations-L3.log) | the three PRODUCT mutations: a real edit to `src/`, a real launch against the real site, each one caught. **These three files are from the run BEFORE the repair**, against the 25-assertion suite. All three were re-run live on the repaired tree afterwards and all three were caught again — §5 has what they produced, including the one that found a defect in a NEW assertion |

---

## 1. The gesture, in order

`youtube.com/watch?v=dQw4w9WgXcQ` — *Rick Astley — Never Gonna Give You Up (4K
Remaster)*, 213.061 s.

1. The app loaded the page into its source view, **muted before the first load
   and across every navigation it made** — `mutedAtCreate: true`,
   `mutedBeforeLoad: [true]`, `unmutedNavigations: 0` after 6 navigations.
2. **YouTube autoplayed it**, into a pre-roll. The probe read the player first
   and found `paused: false`, so its click was not needed this run;
   `video.play()` appears nowhere in `src/` or in the probe, by rule L1. When the
   page arrives paused, the probe sends a real left click at the centre of
   YouTube's own `<video>`.
3. **A pre-roll ad was waited out** before anything was measured — the probe
   presses YouTube's own **Skip** when it appears and re-reads `adShowing`
   afterwards. Every measurement below carries `adShowing: false` beside it, and
   a doctored report that says otherwise is mutation row `R7b`.
4. **`Source → Arm this Source`** was clicked on the application menu —
   accelerator `Ctrl+Shift+A`. That is the same click a user makes. (The chrome
   bar's **Arm** button is the other one, and it is `smoke`'s.)
5. `SESSION` reached the deck; the **deck** asked for the capture
   (`SW_CAPTURE_START`); the **Host** originated `CAPTURE_START` with six
   envelope keys — `from, source, sourceToken, to, type, v` — carrying a 36-char
   token and a `source` of exactly `{title, url}`. No `tabId`, no `streamId`:
   this product has no tabs.
6. The engine recorded **540,672 frames / 12.26 s** at peak
   **[0.506, 0.482]** in the window the suite asserts over — real audio at full
   level, while the view was muted and the audio device stayed silent (§4). By
   the end of the run the same counter read **1,413,120 frames / 32.0 s** at peak
   [0.409, 0.392]; **that second figure is in the report and no assertion reads
   it.** The asserted one is `deckSummary.A.capture`, and this paragraph names
   which is which because an earlier version of this file quoted the unasserted
   number in a section headed "with numbers".
7. The **109 MB of weights** went through the Host — all **114,559,139 bytes**,
   in 517 ms — the unit verified their SHA-256, and ORT built a session
   (`ep: wasm`, 4 threads, `adapter: null`), `createMs` 737 + `warmupMs` 5670.

   > **`engine.log` says `weights downloaded + hash verified`, and NOTHING WAS
   > DOWNLOADED.** The file is `models/htdemucs_6s.onnx` on local disk, read over
   > this app's own `app://` origin; that time is a disk read, and P1′ means this
   > product asks exactly one host for anything and it is not this. The word is
   > the unit's: a bundled-model Host answers `fromCache: false` — correctly,
   > because asking again cannot improve an immutable file that shipped with the
   > app — and `offscreen/engine.js` prints "downloaded" for that answer.
   > Upstream **stem-splitter-live#28**.
8. A **full page reload** did not take the capture with it: `recording` before
   and after, frame counter 1,437,696 → 1,929,216, still muted. The grant is
   bound to the `WebContents`, not to the document.

## 2. The six stems

One 7.8 s `SEGMENT` of the captured audio, through the Host's own
`createBackend()` and `modelBytes()`, **with no deadline**. The playhead was
moved to **48 s** first — through `DeckTransport.drive`, the deck's own verb and
its closed write set — and landed at **50.403 s**, in the body of the song rather
than its intro; `adShowing: false`, `duration: 213.061`, so this is the song and
not an advertisement. The audio was read off the track with
`MediaStreamTrackProcessor`: **343,980 of 343,980 frames** at 44 100 Hz.
`load()` took **6752 ms** (create 737 · warmup 5670) and `separate()` took
**5560 ms** (prep 93 · infer 4929 · post 537).

| stem | rms L | rms R | peak | centroid | < 120 Hz | < 500 Hz |
|---|---|---|---|---|---|---|
| drums | 0.066817 | 0.058511 | 0.568174 | 1795 Hz | 19.1 % | 64.3 % |
| bass | 0.037203 | 0.026606 | 0.161932 | **102 Hz** | **76.4 %** | **99.9 %** |
| other | 0.027363 | 0.032976 | 0.205921 | 1345 Hz | 0.1 % | 38.3 % |
| vocals | 0.122347 | 0.126175 | 0.620616 | 1723 Hz | **0.01 %** | 18.9 % |
| guitar | 0.004745 | 0.004980 | 0.050094 | 447 Hz | 0.1 % | 52.4 % |
| piano | 0.000184 | 0.000200 | 0.001550 | 4265 Hz | 0.8 % | 31.1 % |
| *(the mix)* | 0.163564 | 0.165112 | — | 1493 Hz | 7.6 % | 33.9 % |

In the model's own `STEMS` order — `drums, bass, other, vocals, guitar, piano` —
which is **not** the order the deck paints them in (`ui/embed.js`'s rack is
`vocals, drums, bass, other, guitar, piano`). Both are asserted, separately.

**The three columns on the right are what makes the labels checkable at all.**
Nothing in the returned buffer carries a name: `shared/host.js` freezes the
LAYOUT — `(k*2+ch)*SEGMENT`, stem-major — and the meaning of `k` is convention.
The suite used to "check" the order with `perStem[i].stem === STEMS[i]`, which
the probe had written itself three lines earlier, so a backend returning six
planes in another order would have passed. It now asserts four **ordinal** facts
out of the audio: the `bass` plane has the strictly lowest centroid and the
strictly highest energy under 500 Hz and under 120 Hz, and the `vocals` plane has
the strictly lowest energy under 120 Hz. A rotated buffer fails them
(`youtube-mutations.mjs` row `R22c`).

**The loud four replicate; the quiet two do not.** Across four runs of this same
seek into this same video — the committed evidence at three different landing
points, plus an independent auditor's raw-PCM probe — `drums` held
0.0668/0.0669/0.0674/0.0674 and `vocals` 0.1223/0.1225/0.1179/0.1223, while
`guitar` moved 0.00233 / 0.00475 / 0.00984 / 0.02710 — a **12x spread**, because
`drive({currentTime: 48})` lands within a few hundred milliseconds of a different
place each time and a 7.8 s window either does or does not contain the guitar
figure. `piano` is the exception among the quiet ones: 0.00017-0.00018 every
time. **A reader who re-runs this gate should expect the quiet stems to move and
the loud ones not to** — which is why the suite asserts no level band on any of
them (`docs/TESTING.md` §7) and why the sentence "that song has no piano" has
been taken out of this file. It is a reading of one window, not a fact about the
song.

**The sum is one of two rows that cannot be faked by a meter.**

| | |
|---|---|
| rms(mix) | 0.164340 |
| rms(Σ stems) | 0.158697 — **0.966x** the mix |
| rms(mix − Σ stems) | 0.019203 — **0.117x** the mix |

`htdemucs` is a masking separator: its six stems add back to the input, and they
do. **Six copies of one mix would sum to six times it**, leaving a residual of
5x — which is exactly what a stalled pipeline publishes when it fans the
passthrough out across six planes.

**...and the sum alone was not enough, which an audit proved on paper.** For
`stems_k = a_k · mix` with the `a_k` summing to 1, the residual is exactly 0, the
sum ratio is exactly 1.0, and the six levels are all different — a fan-out of one
mix that passed the sum test, the "six distinct levels" test and the meters at
once. So the second row is **PEARSON r BETWEEN EVERY PAIR OF PLANES**: six scaled
copies of one signal correlate at 1.000, and this run's fifteen pairs run
**0.004 to 0.433** (the largest is `other`/`guitar`, which share spectrum and
should). The correlator's own control, `r(x, x)`, is exactly **1** — a correlator
returning small numbers because it was broken would otherwise pass by being wrong
in the safe direction. Row `R24c` in the mutation battery is that counterexample,
constructed and caught.

The capture the model was fed: `channelCount: 2`, `sampleRate: 44100`,
`autoGainControl / echoCancellation / noiseSuppression` all **false**,
`local_echo=false`; the segment's own rms **L 0.1636 / R 0.1651**.

## 3. What this machine could NOT show

**NOBODY HAS EVER SEEN THE LIVE PATH WORK.** Not the author, and not the
independent auditor who repeated this by hand — who armed the app with a real
`xdotool key ctrl+shift+a` keystroke on a real launch, watched the deck go
straight to *"Starving · buffer empty · 8 dropped"* with all six meters at
PK −∞, and then re-ran the gate and measured **11 of 11 chunks missing the
1950 ms hop at p95 6040.8 ms**. This run measured the same thing:

| | |
|---|---|
| chunks | 11 |
| drops | **11** |
| p95 per chunk | **5666.8 ms** |
| median per chunk | 5652.6 ms |
| sustained RTF | **2.89** (the deck's own figure) |
| hop deadline | 1950 ms |
| worst margin | **−3716.8 ms** |
| execution provider | `wasm`, 4 threads, `adapter: null` |

`offscreen/live.js` runs one 7.8 s segment every 1.95 s hop, so live mode needs
about **4x real time**; this box does one segment in ~5.6-6.0 s, which is about
**3x short**.

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
`min(4, hardwareConcurrency >> 1)` — **and that cap is the unit's own measured
choice, not an untried knob.** `workers/inference.worker.js` carries a comment
recording a regression at 8 threads on a 12-core machine, which the auditor
checked rather than took. Widening threads is not the fix nobody thought of.
**Anyone putting this in CI should expect the same**: a hosted runner with a
virtual display has no GPU process, whatever the host hardware is.

So every chunk missed its deadline, and the deck did what it is designed to do:
dropped it, played the **passthrough** mix from the capture ring's own history,
and showed **Starving** with a drop count. The six per-stem meters read
`0.000000` for all 575 frames of the measuring window while the master read
**0.1163** — the user hears the song, unseparated, and the faders do nothing.

That is why the six stems above are measured **without the clock**: separating
six stems and keeping up with playback are two different claims, and only the
first one is about the product. The unit's hop ladder tops out at 3.9 s and the
embedded deck exposes no hop control, so nothing in the product closes a 3x gap
on this hardware.

**`deck.png` and `window.png` show the Starving badge.** They are the honest
picture of this box. **They are not a picture of the product working on a machine
with a GPU, because no such picture exists.** "It keeps up on a real desktop" is
a prediction from an arithmetic — 4x real time needed, ~1.4x delivered here — and
**the first person to find out will be the owner, on a Mac.** Nothing in this
repository should be read as evidence for it.

## 4. The other half of the premise — the speakers stayed silent

From the permanent gate (`capture-mute`, same day, same tree —
[`capture-mute-suite.log`](capture-mute-suite.log), **15 assertions, 0 failed**):

| | |
|---|---|
| what the app captured | rms **0.350941** in the fixture's analytic band [0.3, 0.4], peak **0.500004**, stereo, 44 100 Hz, AGC/echo/noise off |
| what the audio device heard | rms **0.000000** (≤ 0.0005), peak **0.000000**, over **7.296 s / 350,208 frames** of the sink's monitor, measured **outside the process** |
| the control | a variant (d) process with one flag flipped, on the same sink inside the same lock, **was heard**: rms 0.255343 |

The control is what makes the silence readable: the meter can hear something, and
it heard nothing from the app.

That gate runs against the LOCAL fixture, not against YouTube, because it needs a
PipeWire sink it owns and a control it can flip. What this YouTube run adds to it
is the same property on the real site, one level up: `isAudioMuted` true for the
view's whole life, `unmutedNavigations: 0`, and a capture at peak 0.51 taken off
it anyway.

## 5. Every assertion here was watched red

`AGENTS.md`: *an assertion you did not watch fail is not evidence.*

| | |
|---|---|
| **43 report rows** | one field of this recorded report doctored at a time, re-judged with `YOUTUBE_REPORT=<file>`. 43 caught, **coverage 26/26** — every assertion was turned red by some row, and every row turned red exactly the set it declared |
| **3 product rows** | a real edit to `src/`, a real launch against the real site. `L1` deletes the mute → 1 red, the mute assertion. `L2` removes the arm accelerator → 1 red, the arm assertion. `L3` makes the Host originate no `CAPTURE_START` → **8 reds**, every one downstream of that message |

The two halves prove different things and neither stands in for the other: the
report rows prove the **assertions** can fail and name the right thing; the
product rows prove the **probe measures the product**.

Two of the 43 rows exist because an audit found the assertions above them weaker
than their own headlines: `R24c` builds the six-scaled-copies counterexample that
the sum test and the level test both call a pass, and `R22c` rotates the audio
under the six names while leaving the names in place — the permutation the old
"in the unit's own order" check could not see, because the probe wrote those
names itself.

### ...and the three PRODUCT rows were re-run on the repaired tree

Three more launches against the real site, one per row. The three `.log` files
above are the pre-repair set and are left as they are; this is what the re-run
produced, and the third line is the one worth reading:

| row | result | reds |
|---|---|---|
| `L1` — the mute is deleted | caught | **1** — *THE VIEW IS MUTED FOR ITS WHOLE LIFE*, as before |
| `L2` — the arm item loses its accelerator | caught | **2** — the arm assertion, **and the new spectral one** |
| `L3` — the Host originates no `CAPTURE_START` | caught | **7** — everything downstream of that message |

**`L2`'s SECOND RED WAS A DEFECT IN THE NEW ASSERTION, NOT IN THE PRODUCT, AND A
LIVE RUN IS THE ONLY THING THAT COULD HAVE FOUND IT.** A live row is a fresh
launch, so the separator ran over a DIFFERENT 7.8 s window — and in that window
`vocals` and `guitar` both read `0.0001` below 120 Hz, because the probe rounds
these fractions to four decimals and two planes that both have essentially
nothing down there are indistinguishable at that precision. The assertion's
"`vocals` has strictly the least below 120 Hz" was therefore a claim about a
fourth decimal rather than about the music, and it went red for a reason that was
not about the product — the flake `AGENTS.md` forbids.

The vocals half is a RATIO now: *at most a twentieth of the MIX's fraction below
120 Hz*, with its mirror on the other side — *`bass` holds at least twice the
mix's*. Both windows satisfy it with room to spare (this run: bass 10.0x, vocals
1/762nd; `L2`'s window: 6.1x and 1/1353rd), the fan-out row `R24c` still fails it
because six copies of the mix all sit AT the mix's fraction, and the rotation row
`R22c` still fails on the three `bass` rank facts, which are strict and whose
margins are large. What it no longer claims is a `vocals`/`guitar` distinction —
no spectral measure this cheap separates two mid-band planes that both have
nothing below 120 Hz, and the assertion says so.

## 6. `npm start` on its own, with no gate flag at all

[`npm-start.png`](npm-start.png) is a second, much smaller run: `npm start`, no
`--gate`, no `--source-url`, nothing — the product's own entry point, left alone
for 45 s and photographed off the X display. It is here because every other
picture in this directory came out of a launch the gate had a flag in, and "the
app starts by itself" is a claim worth one photograph.

It shows the window, our bar reading `stem-workbench · Arm · source
www.youtube.com · deck vendored · engine coi=true sab=true`, youtube.com's own
home page, and the deck painted with its six strips and a **Not armed** badge.

**The Arm chip in that bar is live.** It shipped `disabled`, with the tooltip
*"not built yet"*, for a whole wave after arming started working — while the
product's own refusal text told the user *"Arm this Source first, from the Source
menu or the Arm button"* and `HOST-DESIGN.md` §6.4 called it the first thing the
owner touches. An auditor clicked it on a real launch, got nothing, and read the
markup. `shell` used to ASSERT the `disabled` attribute; it now asserts the
opposite, and `smoke` clicks the real element and requires the deck to see a
`SESSION`.

One rough edge is still visible in that photograph, and it is honest rather than
hidden:

- **The deck still speaks the extension's language.** *"Click the Stem Splitter
  Live toolbar icon on this tab to arm it, or press Ctrl+Shift+A"* — there is no
  toolbar icon and there are no tabs. `docs/VENDORING.md` names this as the one
  English sentence a second Host has to patch, and the accelerator half of it is
  already ours. It is VENDORED text, so rule V1 forbids editing it here: it is a
  finding for `stem-splitter-live` behind a later tag, recorded in
  `docs/CONFORMANCE.md`.

**What is no longer there: the autoplay banner.** Earlier photographs of this
same cold start carried *"Couldn't turn off YouTube's autoplay — their control
didn't respond"*, and it was not intermittent — the default source URL is
youtube.com's home page, which has no player, so the Host hunted for a
`ytp-autonav-toggle` that page never has and raised the advisory every time. The
first thing every new user saw was a failure about a page they had not asked to
do anything with. `src/main/transport.js` now engages autoplay suppression on a
document with **no `<video>`** without opening a find window; the window opens by
itself on `play`, `loadedmetadata` and an element change, so a watch page is
unaffected.

## 7. What a reader should not take from this

- **It is one run, on one machine, on one video.** `docs/TESTING.md` §7 forbids
  this suite a level *band* for exactly that reason; every level claim in it is
  presence/absence against one floor, and §2 above records which stems replicate
  run to run and which do not.
- **Nothing here was heard by a human.** There is no soundcard on this box. The
  silence is a number off a null sink's monitor and the stems are arithmetic over
  a buffer.
- **THE LIVE PATH HAS NEVER BEEN SEEN WORKING BY ANYONE.** It is wired, it runs,
  and on this hardware it drops every chunk — the author's run and an independent
  auditor's both. Nobody has yet run this on a machine whose GPU Chromium will
  talk to, so *"it keeps up on a real desktop"* is a prediction, not a
  measurement, and the first person to test it will be the owner.
- **macOS has never run any of it, and no installer has ever been built.** The
  plan's kill criterion is written against macOS; this is Linux, by ruling, and
  the substitution is stated in `docs/TESTING.md` §11. `package.json`'s `build`
  key and `.github/workflows/package.yml` are **configuration, not evidence** —
  see README.md "What was verified, and what was only configured".
