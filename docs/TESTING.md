# Testing stem-workbench

How this repository is gated, what each suite asserts, and the one printing
convention every suite obeys.

Read [`stem-splitter-live/AGENTS.md`](https://github.com/itziklerner-pag/stem-splitter-live/blob/main/AGENTS.md)
before you write an assertion here. It applies to this repository verbatim, and
it is mostly a record of assertions that **could not fail**. Every rule below
that looks fussy is one of its entries.

---

## 1. Two gates, and only one of them is ours

The plan's seed §17 decided option **T2: the vendored unit carries its own
gates.** The audio graph's suites travel with the audio graph, so a pin bump is
verified by the tests written against that exact code.

| | what it gates | who owns it |
|---|---|---|
| `vendor/stem-splitter-live/tools/verify.mjs --unit` | the engine and the deck — 12 suites, **1156 assertions**, ~74 s, plain Node | `stem-splitter-live`. **We do not edit it and do not reimplement it.** |
| `tools/verify.mjs` (this repo) | the **Host** — everything the desktop product writes for itself | us |

**T1 was rejected:** copying the extension's `tools/verify.mjs` here and growing
a second set of conventions gives two runners that drift where it is most
expensive. Ours runs the vendored gate as one *step* (`vendor-unit`) instead.

> **The unit is vendored, not forked.** A red in `vendor-unit` is never fixed by
> editing a file under `vendor/`. It is a finding, and its fix is a change in the
> other repository behind a new tag. A patched vendored copy is the failure mode
> ADR 0001 exists to prevent.

### `group('host')` in the vendored `test.js`

`VENDORING.md` offers three things to do about the 122 conformance assertions in
that group. **We take option 3: point them at our files.** Those assertions are
a conformance report on the Electron Host in the unit's own words — `assetUrl`'s
trailing slash, `send()`'s `undefined` return, `storageGet`'s absent-vs-unreadable
split — and that is what they are for.

Option 1 (run `--unit` *before* swapping the holes) is the intermediate green
recorded on the way, and it is the green in `VENDORING.md` §7: `GREEN (partial —
the vendored unit's suites only; 12 of 23 steps)`, 12 of 12 PASS, 1156
assertions. Record it in the vendoring commit; it says the copy arrived intact.

---

## 2. The runner

```
node tools/verify.mjs                # everything built that needs no window
node tools/verify.mjs --quick        # ...minus anything that opens a window or takes the sink
node tools/verify.mjs --only <id>    # exactly one step
node tools/verify.mjs --manual       # ONLY the manual steps — never on a default plan
node tools/verify.mjs --self-check   # the classifier and the verdict. Spawns nothing, ~0 s
node tools/verify.mjs --list         # the steps table
```

### The steps table

<!-- suites:begin -->

| step | file | flags | what it gates |
|---|---|---|---|
| `void-canary` | `tools/suites/void-canary.mjs` | — | the runner's own VOID rule, and the steps table against this document |
| `vendor-intact` | `tools/vendor-unit.sh --check` | — | **rule V1** — the 50 copied files are byte-identical to the pinned tag, and nothing was added under `vendor/` behind the sums file |
| `vendor-unit` | *(the vendored runner)* | — | the unit's 12 suites over the exact tag we pinned |
| `shell` | `tools/suites/shell.mjs` | window | **the app skeleton** — one real launch: the window and its three views, every renderer's isolation, `app://` + COOP/COEP, the capture grant, the mute, the allowlist |
| `p1` | `tools/suites/p1.mjs` | window | **P1′** — every session the app creates reaches the update host and nothing else |
| `smoke` | `tools/suites/smoke.mjs` | window | boot, the Host seam, the transport, the deck — against a **local fake player** |
| `capture-mute` | `tools/suites/capture-mute.mjs` | window, sink | **the permanent gate** — the view is captured at full level while the audio device stays silent |
| `youtube` | `tools/suites/youtube.mjs` | window, **manual** | the same claims against real `youtube.com`. Nightly / by hand, never on the default path |

<!-- suites:end -->

`void-canary` asserts this table against `STEPS` in `tools/verify.mjs`, **in both
directions**. A suite specified here with no step, and a step with no
specification here, are the same failure — a suite nobody runs — and both read as
green from the outside.

**Flags.** `window` needs an X display and launches Electron; `--quick` drops it.
`sink` additionally needs PipeWire and an exclusive null sink; `--quick` drops it.
`manual` is never on any default plan at all.

**`todo`.** Four of the six steps above are specified and **not built**. They are
in the steps table anyway, marked `todo`. A suite that is not in the table is
indistinguishable from a suite nobody thought of — that is the standing rule at
the top of the extension's runner, and it cost that repository three separate
incidents. A `todo` step never runs, is printed under **WHAT DID NOT RUN** every
time, and makes an unqualified `GREEN` impossible until it is built.

### The VOID rule

> **A step that exits 0 having asserted nothing is a HARD FAILURE, not a pass.**

Silence and success are identical from an exit code. The runner demands evidence
— a summary line carrying a count of **at least one** — and every count in its
`ASSERTED` regex is `[1-9]\d*`, never `\d+`, because `0 passed, 0 failed` is the
VOID case wearing a summary line.

It is watched, on demand, by the `void-canary` step's own mutation:

```
VOID_CANARY=silent node tools/verify.mjs --only void-canary    # -> VOID, RED
VOID_CANARY=zero   node tools/verify.mjs --only void-canary    # -> VOID, RED
```

`silent` prints chatter and exits 0. `zero` prints `void-canary: 0 passed, 0
failed` and exits 0. Both are red. The mutation lives in the *suite*, not in the
runner, so it cannot be written around by the assertion that checks it.

### The verdicts

| | |
|---|---|
| `PASS` | exit 0, with assertions, and any `expect` clause satisfied |
| `FAIL` | non-zero exit, or exit 0 without the `expect` clause — the failing assertion is named |
| `VOID` | exit 0, no assertions. **Red.** |
| `SKIP` | the suite printed `SKIPPED — <reason>` and exited 0. **Not green** — it is named in the verdict and downgrades the run |

`verdict()` is a pure function so `--self-check` asserts the honesty rule instead
of a human re-reading print statements: **the runner never prints an unqualified
`GREEN` over a partial plan.** A step that was filtered out, declined, manual, or
declared-and-not-built is named under `WHAT DID NOT RUN`.

### What was deliberately not copied from the extension's runner

Stated as decisions with triggers. An unlisted omission is indistinguishable from
one nobody noticed.

| not copied | why | trigger to add it |
|---|---|---|
| the `FLAKY` carve-out | no measured flake here yet, and `AGENTS.md`: an assertion parked on an expected-red list stops being read at all | a reproduced, distribution-measured flake — with an expiry condition |
| coverage drift (assertion-name diffing) | needs a baseline from a previous run; four of five suites do not exist | the first time two host suites are green on one tree. The pinned assertion **total** on `vendor-unit` is the cheap half, and is here today |
| `reapOrphanBrowsers()` | it `pkill`s every Playwright Chromium on the box, including a sibling agent's | never. The shared `flock` mutex is the answer here |
| the model-seed preflight, `--live-fixture`, `--soak-fixture`, `--audible`, `--strict` | seed §15 bundles the weights in the installer: "where the model is" is a Host duty and a packaging question | the first host suite that needs the weights brings a `heavy` flag and its own preflight |
| a plan derived from `extension/unit.json` | the unit's own runner already builds its plan from that manifest and already asserts the two agree, both ways | never — a second copy of a list is a list that drifts |
| the e2e section parser | our suites print flat (§3), so a failing assertion is one line | never |

---

## 3. How a suite prints

**Fixed once, here.** The VOID rule exists because a suite that prints nothing
looks identical to a suite that passed; the convention below is what makes the
difference machine-readable.

```
ok    <name>  <detail>
FAIL  <name>  <detail>

<suite-id>: <N> passed, <M> failed
```

1. **One line per assertion**, at column 0. `ok` for a pass, `FAIL` for a
   failure. Never `PASS` — that word is the runner's, and reserving it keeps a
   suite's own output distinguishable from the runner's summary table when both
   are in one log.
2. **Two spaces separate the name from the detail.** The name is stable text; the
   detail is free-form.
3. **A measured number goes in the DETAIL, never in the name.** A name carrying a
   value ("the frame grows (360 -> 560 px)") is a name that changes run to run,
   and it makes every coverage instrument downstream report the assertion as
   gone-and-replaced. The detail must carry the value that would make the
   assertion red — a red the reader cannot diagnose from one line is a red that
   costs a re-run.
4. **One check, one name.** If an assertion has two branches, put the branch in
   the detail. Two names for one check reports "stopped running / started
   running" forever, on correct code.
5. **Name the entry point** when the assertion is about a function with more than
   one caller: `…  [entry point: host/sessions.js makeSession()]`. Five separate
   defects in the sibling repository came from a value being right at one call
   site and wrong at another.
6. **The summary is the last line**, `<suite-id>: N passed, M failed`. Exit 0 iff
   `M === 0`. `N === 0` is a VOID, so a suite whose filters excluded everything is
   red, not green.
7. **A suite that cannot look FAILS.** Never `!x || (real check)` — that passes
   precisely when it has no coverage. If the thing being inspected is missing,
   that is the failure, not an excuse from it.
8. **`SKIPPED — <reason>` is for the machine, never for the code under test.** No
   PipeWire daemon, no `$DISPLAY`, no Playwright installed: those are properties
   of the box and a skip is honest. "The app did not expose the hook" is a
   property of the system under test and is a `FAIL`.

### Every assertion is watched red by mutation

Not optional, and not satisfied by "it went red once while I was debugging".
For each assertion, in its suite's header block: **the mutation, the file and
line it was applied to, and the red it produced.** An assertion you have not
watched fail is an assertion whose ability to fail is an assumption.

Each suite below carries a **Watched red** table listing the mutation per
assertion group. Filling that table is part of building the suite, not a
follow-up.

---

## 4. Running a windowed suite

This box is a tty session with no `DISPLAY`, no soundcard, and sibling agents
working concurrently. Three rules, and they compose:

```bash
# 1. the browser/Electron mutex — sibling agents share this machine.
#    The suite takes it ITSELF, around the electron spawn; the name comes from
#    $STEM_WORKBENCH_BROWSER_LOCK, defaulting to a per-user file in $TMPDIR.
#    On a shared box, point it at the box's lock:
export STEM_WORKBENCH_BROWSER_LOCK="$SCRATCH/browser.lock"
node tools/suites/shell.mjs

# which spawns, internally:
#   flock "$STEM_WORKBENCH_BROWSER_LOCK" -c '
#     xvfb-run -a -s "-screen 0 1280x1024x24" node_modules/.bin/electron . --gate=…'
```

`xvfb-run -a` picks a display number by scanning for a free one, which is a race
two concurrent launches can both win. That, and not politeness, is why the mutex
is around the spawn.

```bash
# 3. and for `sink` suites, the PipeWire sink lock, ON TOP, taken FIRST
#    (spike/harness/bin/env.sh: harness_lock)
```

- **PipeWire sinks are machine-global.** Create your own uniquely-named sink,
  hold `flock` on `$XDG_RUNTIME_DIR/stem-workbench-sink-<name>.lock` for the life
  of the run, destroy it on exit, and never touch a sink you did not create.
- **A lock only binds runs that cooperate.** It cannot stop an unrelated process
  from linking to the sink. That is why `capture-mute` also *witnesses* the sink
  (assertion 8 below) instead of trusting the lock.
- The suite takes its own locks. The runner does not, because `--only` and a
  nightly must behave the same way.

---

## 5. `shell` — the app skeleton, over one real launch

**File:** `tools/suites/shell.mjs`. **Flags:** `window`. **Cost target:** < 30 s.

The first suite that runs the product. It spawns **the real entry point** —
`electron .`, the real `package.json` `main`, the real protocol handler, the real
windows — under the shared browser mutex and `xvfb-run`, with three development
arguments:

```bash
flock "$STEM_WORKBENCH_BROWSER_LOCK" -c "xvfb-run -a -s '-screen 0 1280x1024x24' \
  node_modules/.bin/electron . --gate=out/shell --user-data=out/shell/userdata \
  --source-url=file://$PWD/tools/fixture/player.html"
```

`--gate=DIR` makes `src/main/main.js` dynamically import `tools/gate/probe.mjs`,
hand it the live handles, write `DIR/report.json` and three `capturePage` PNGs,
and exit. **The probe never asserts** — a probe that decided its own verdict would
be a suite that exits 0 having asserted nothing, which is the VOID case one level
in. Every judgement is in the suite, which is a separate process and can be run
against a report from a mutated build.

### Why the launch is real and the judgement is outside it

A second main process that imported the same modules would be a second app, and
the two would agree right up until the day the real one changed. So the launch is
the product's own, and the probe only **observes**: it adds no capability,
changes no `webPreferences`, and installs no handler.

### The source page is local

`tools/fixture/player.html` — the same fixture `smoke` and `capture-mute` use
(§6). CI must never depend on YouTube's DOM or its bot walls. The real thing is
`youtube` (§7), manual only.

### What it asserts

Six of them are pure functions with no launch at all; the rest read one report.

| # | assertion | detail must carry |
|---|---|---|
| 1–3 | the navigation allowlist admits every listed host, refuses every other one **including `youtube.com.evil.test`**, and refuses every non-`https` scheme | the counts, and any URL that got through |
| 4–6 | the `app://` path table maps our two roots, and refuses a percent-encoded traversal, a NUL byte, a sibling directory sharing a root's prefix, and an unknown host | the counts, and what was let through |
| 7 | the app launches from its real entry point and writes a report | exit code, electron/chromium versions |
| 8–9 | one `BaseWindow`, three child views in the fixed order; the engine is a **hidden `BrowserWindow`** | the class names, the three URLs |
| 10–12 | all four renderers have `contextIsolation` on, `sandbox` on, `nodeIntegration` off; none can see `require`/`process`/`module`; **the source view's page sees no bridge of ours** | the three flags per renderer; what `window` actually carries |
| 13 | the source view is alone on `persist:youtube`; chrome, deck and engine are on the default session | the partition's storage directory |
| 14–17 | the engine document is cross-origin isolated, `SharedArrayBuffer` constructs, **a module worker inherits it and `Atomics` round-trips a posted SAB**, and the deck slot is isolated too | `coi`, `sab`, the worker's reply |
| 18–19 | every `app://` response carries COOP, COEP and CORP; a `HEAD` answers with a `content-length` and no body; the live handler returns 403 for a traversal and 404 for a missing file | the header values, the statuses |
| 20–23 | a **detached** `send()` reaches the deck's address, the envelope arrives deep-equal to what was sent, a wrong `v` is dropped as malformed, an address with no listener is dropped — both counted | the envelopes, the drop counters |
| 24–27 | the capture grant answers the engine with the **source view's frame** (`deviceId` names its `processId:routingId`), one stereo 44 100 track with AGC/EC/NS all `false`; the deck may not capture; a page **inside** the source view may not capture | the `deviceId`, both frames, the settings |
| 28 | the source view is muted **before it loads anything**, and no navigation ever starts unmuted | `mutedAtCreate`, the per-load samples, the unmuted-navigation count |
| 29–31 | a renderer-initiated navigation off the allowlist is refused and the view does not move; `window.open` is denied; **the refusal is visible in the chrome bar** | the refused URLs, the bar's text |
| 32–33 | the chrome bar painted with its Arm control present and disabled; all three views drew more than one distinct colour | the bar's fields; per-view size and colour count |
| 34 | the deck slot loads the vendored deck when it is present and our placeholder when it is not | which branch ran, and the URL |

**Assertion 33 is not decoration.** A blank view and a painted one are both a
PNG, and a byte count cannot tell them apart — a solid-colour 1280×600 PNG
compresses to a few hundred bytes and so does a broken one. The distinct-colour
**count** can: 1 for anything uniform, more for anything with text on it.

**Assertion 26 is the one that would undo the product.** A page inside the source
view that could call `getDisplayMedia` itself would not need us at all. It is
refused twice — at the permission layer on `persist:youtube`, and by the fact
that the display-media handler is installed on our session only.

### Deliberately not asserted here

- **The unit.** `vendor/stem-splitter-live/` is not on this tree. Nothing here
  proves the vendored engine or deck loads, runs, or produces audio. Assertion 34
  reads the placeholder branch today and the vendored branch the day the copy
  lands — the same assertion, both ways.
- **The 32 duties.** There is no Host yet, so `assertHost` has nothing to check.
  That is `group('host')` in the vendored `test.js`, and it is the next wave's.
- **Silence at the audio device.** This suite proves the view is *muted* and that
  a capture opens. A muted view and a silent speaker are two claims, and
  `capture-mute` (§8) is the one that measures the second. **This suite cannot
  replace it.**
- **The bus router's sender check.** `bus.js` drops a `'bus'` message from a
  renderer that is on no address. No renderer we ship has both that channel and
  no address, so there is nothing to send the message that would prove it.
- **The mute's re-assert on navigation.** Chromium preserves the mute flag across
  a navigation in the same `WebContents`, so removing the re-assert changes no
  observable. The belt is gated; the braces are not.
- **P1′.** Which host the app talks to is `p1`'s job (§9).

### Watched red

Reproduce every row with `tools/suites/shell-mutations.sh`, which runs the suite
**unmutated first and requires green** — a mutation runner that is red before it
mutates has proved nothing — then, per case, applies the edit, refuses to
continue if the anchor text has moved, runs the suite, requires the named
assertions on `FAIL` lines, restores the file and checks the restored bytes.

Every row below was **run**, on 2026-08-26, against Electron 44.0.0 / Chromium
152.0.7977.54 on Linux. The "red" column is what actually failed, not what was
expected to.

| # | mutation | file | red |
|---|---|---|---|
| 1 | drop COOP + COEP from `ISOLATION_HEADERS` | `src/main/assets.js` | 14, 15, 16, 17, 18, 32 |
| 2 | drop the containment test from `resolveAppPath` | `src/main/assets.js` | 5, 19 |
| 3 | suffix match → `host.includes('youtube.com')` | `src/main/navigation.js` | 2 |
| 4 | `setAudioMuted(true)` **after** the first load | `src/main/youtube.js` | 28 |
| 5 | delete the `will-navigate` guard | `src/main/youtube.js` | 29 |
| 6 | window-open handler → `{ action: 'allow' }` | `src/main/youtube.js` | 30 |
| 7 | grant the **chrome** frame instead of the source's | `src/main/main.js` | 24 |
| 8 | do not `addChildView(deck)` | `src/main/main.js` | 8, 33 |
| 9 | stamp `hostSaw: true` onto a routed envelope | `src/main/bus.js` | 21 |
| 10 | delete the `v !== 1` guard | `src/main/bus.js` | 22 |
| 11 | `mayCapture` → `(wc) => !!wc \|\| isCaptor(wc)` | `src/main/capture.js` | 26 |
| 12 | `nodeIntegration: true` | `src/main/main.js` | 10 |
| 13 | delete the Arm button | `src/renderer/chrome.html` | 32 |
| 14 | do not write `report.json` | `tools/gate/probe.mjs` | 7 — and the suite **fails** with 6 passed, 1 failed rather than exiting 0 |
| 15 | ask for `getDisplayMedia({ audio: true })` | `tools/gate/probe.mjs` | 25 |
| 16 | `noteRefusal` stops calling `pushStatus()` | `src/main/main.js` | 31 |
| 17 | allow only the exact hosts, dropping `*.youtube.com` | `src/main/navigation.js` | 1 |
| 18 | stop requiring `https:` | `src/main/navigation.js` | 3 |
| 19 | match the **shortest** root prefix, not the longest | `src/main/assets.js` | 4, 19 |
| 20 | serve any `app://` host, not only `workbench` | `src/main/assets.js` | 6 |
| 21 | `show: true` on the engine window | `src/main/main.js` | 9 |
| 22 | `exposeInMainWorld` in the source view's preload | `src/preload/youtube.cjs` | 12 |
| 23 | put the source view on **our** session | `src/main/main.js` | 13 |
| 24 | never `register(BUS.deck, …)` | `src/main/main.js` | 20, 21, 23, 34 |
| 25 | count a no-listener drop as a malformed one | `src/main/bus.js` | 22, 23 |
| 26 | give the source view every permission it asks for | `src/main/youtube.js` | 27 |
| 27 | point the deck slot at the wrong page | `src/main/main.js` | 17, 20, 21, 34 |
| 28 | `contextIsolation: false`, `sandbox: false`, `nodeIntegration: true` | `src/main/main.js` | 10, 11, and six more |

**Cases 17–28 exist because of a coverage audit, not a hunch.** The first sixteen
left eleven of the 34 assertions with no mutation of their own. That is not
visible from inside a green run, so `tools/suites/coverage.py` now makes it
mechanical: after a full battery it compares every assertion name in the baseline
log against every name that ever appeared on a `FAIL` line, and the script exits
non-zero if any assertion has never been seen red. **Current state: 28 of 28
mutations caught, 34 of 34 assertions watched red.**

**Case 27 found a defect in the suite rather than in the app.** Pointing the deck
slot at the wrong page removed `window.__wbBusLog`, the probe returned
`{THREW: …}` where an array was expected, and the suite died on
`.filter is not a function` — with eleven assertions still to run, including the
one that mutation was written to turn red. A suite that crashes has not reported
a red; it has stopped looking. Every read of the report now goes through two
one-line guards, and the crash is the reason they are there.

**Mutation 1 also takes 32** because the chrome bar prints the engine's
`coi`/`sab`, so "the bar painted" and "what it says is true" go red together.
That is information, not a defect in either assertion — and it is why the runner
prints every red, not only the expected one.

**Mutation 5 does NOT take 31.** The `window.open` denial writes the refusal line
too, so the bar stays populated with the navigation guard gone. Mutation 16 is
the one that empties it. Two mutations that look interchangeable and are not is
exactly what a mutation table is for.

**Mutation 12 takes 10 and not 11.** `sandbox: true` keeps `require` out of the
main world even with `nodeIntegration: true`, so the *preference* assertion
catches it and the *reach* assertion is a second layer this mutation cannot
reach. That is what mutation 28 is for: turning all three preferences off at once
puts `require` in the main world and takes assertion 11 with it.

**Mutation 15 is the Limitation-6 run**, and it is the reason assertion 25 lists
every field instead of checking that a track exists. Measured under the
mutation: **`ch=1 sr=48000 agc=true ec=true ns=true`** — mono, 48 kHz, with
automatic gain control whose level decays 17× over 8 s. The spike's original
four-assertion gate called that a PASS. The constraints belong to the *engine*,
not to `main`, so today they live in the gate probe; when `offscreen/host.js`
lands they move there and assertion 25 moves with them.

---

## 6. `smoke` — Playwright-for-Electron against a local fake player

**File:** `tools/suites/smoke.mjs`. **Flags:** `window`. **Cost target:** < 60 s.

Playwright drives Electron through its `_electron` API:

```js
import { _electron as electron } from 'playwright';
const app = await electron.launch({ args: ['.'], env: { ...process.env, STEM_WORKBENCH_GATE: '1' } });
const win = await app.firstWindow();
```

### The fake player, and why there is one

CI must never depend on YouTube's DOM and must never hit a bot wall. Same trick
as `stem-splitter-live/tools/host.mjs` answering as `huggingface.co`: the app is
pointed at a local page instead of the real one.

`tools/fixture/player.html` is a `<video>` the preload drives. **It generates its
own media in-page** — a few lines of JS write a RIFF header and a 440 Hz stereo
sine into a `Blob`, and `URL.createObjectURL()` becomes `video.src`. No binary in
git (`.gitignore` excludes `*.wav`, so the spike's `tone.wav` is not committed
either), no `ffmpeg` at test time, and the level is **analytic**: a stereo sine of
amplitude 0.5 has RMS `0.5/√2 = 0.353553`. `capture-mute` needs that number, so
the fixture is shared between the two suites and lives in one file.

The suite installs a request handler that **fails any request to a non-local
origin**, so an accidental `youtube.com` load is a red rather than a slow test.

### What it asserts

| # | assertion | detail must carry |
|---|---|---|
| 1 | the app opens exactly one `BrowserWindow`, and the YouTube `WebContentsView` is attached to it | the window count, the view's id |
| 2 | `assertHost` accepted the Host — the app got past boot | the duty count it checked |
| 3–6 | **the four messages the Host must ORIGINATE** were really sent: `CAPTURE_START {sourceToken, source:{title,url}}`, `CAPTURE_STOP`, `DECK_PREPARE` to `BUS.engine`; `SESSION {session:{armed,title,url,armedAt}}` to `BUS.deck` | the observed payload keys |
| 7 | the transport WRITES land on the page: `playbackRate`, `currentTime`, `muted` | the value set and the value read back off `<video>` |
| 8 | the transport READS come back: `paused`, `currentTime`, `duration` | the three values |
| 9 | **L1** — the shipped preload never reads `src`, `currentSrc`, `buffered`, `srcObject`, and never calls `captureStream()` | the file scanned, comments stripped, the byte count |
| 10 | the deck renders six stem faders in `STEMS` order | the six labels, in order |
| 11 | the app opens its `AudioContext` at **44100**, not the platform default | `ctx.sampleRate` |

**Assertions 3–6 are the ones `assertHost` structurally cannot make.**
`VENDORING.md`: *"`assertHost` cannot check for a message nobody sent."* A Host
can implement all 32 duties and originate none of these; the deck then sits there
with a dead surface and every existing gate is green. Assert them individually,
by name, so a red says which message went missing.

**Assertion 11 is not cosmetic.** The spike measured it: a *default* host
`AudioContext` opens at 48000 and inserts a resampler in the renderer, while the
captured track is 44100. `CONTRIBUTING.md`'s settled decision — one context at
44100, no JS resampling on the live path — survives into the desktop host **only
if the host opens the context explicitly.**

### Deliberately not asserted here

**Six stems actually coming out of the engine.** That needs the 109 MiB weights
and is a `heavy` step (`smoke-live`) that does not exist yet. Stated as a
coverage limit rather than left as an absence: *nothing in the default plan
proves the vendored engine produces audio inside this app.* `vendor-unit` proves
the engine is correct; `smoke` proves the Host wires it. The seam between those
two claims is not gated until `smoke-live` is written.

### Watched red

| assertion | mutation |
|---|---|
| 3–6 | delete the `CAPTURE_START` send in the Host's arm path |
| 7 | make the transport's `playbackRate` setter a no-op |
| 9 | add `const _ = el.currentSrc;` to the preload |
| 11 | drop the `{ sampleRate: 44100 }` argument to `new AudioContext` |

---

## 7. `youtube` — the real thing, manual only

**File:** `tools/suites/youtube.mjs`. **Flags:** `window`, `manual`.
**Never on a default plan.** `node tools/verify.mjs --only youtube`, or `--manual`.

It exists because of a limitation the local gate cannot close, named in the
spike's write-up (Limitation 14):

> **Nothing in CI will ever catch a YouTube-side regression** — DRM/EME content
> returning silence, a player change, an autoplay-muted default. That needs a
> manual re-check on a cadence, not a green local gate implying YouTube still
> works.

The runner prints it under `WHAT DID NOT RUN` on **every** default run, so its
absence is stated rather than assumed.

### What it asserts, and what it must NOT

Same boot / seam / transport claims as `smoke`, plus the two paths a local
fixture cannot exercise — both measured in the spike:

- **Full page reload**: the capture survives, on the *same* `MediaStream`, and
  `track.readyState === 'live'`. The grant is bound to the `WebContents`, not to
  the document.
- **SPA navigation** (a real click on a related video — no URL is resolved or
  parsed by us, rule L1): the capture follows.

**It must not assert a level band.** The source level is unknown and uncontrolled
— one recorded YouTube run was measuring a **pre-roll ad**, at `duration 60.101`
where every other run read `213.061`, with a capture series dipping to `0.00428`,
within 2.3× of the proposed floor. So the level claim here is
**presence/absence only**: `capturedRms >= 0.01` (the floor, 26 dB above the
silence ceiling). The `getSettings()` constraints (§8 assertion 4) are
level-independent and **are** asserted, unchanged.

Record, in the run's output: the video id, `duration`, `volume`, and whether an
ad was detected. An uncontrolled measurement that does not say what it measured
is not evidence.

**A red here is a realism finding, not a build breakage.** It never blocks a
default run, because it is not on one.

---

## 8. `capture-mute` — the permanent gate

**File:** `tools/suites/capture-mute.mjs`. **Flags:** `window`, `sink`.
**Tracked as [#3](https://github.com/itziklerner-pag/stem-workbench/issues/3).**

The whole product rests on one property: *the app can hear the view while the
user cannot.* This is the gate that fails loudly on a platform where it does not
hold.

> **Use the corrected specification.** The four assertions the spike originally
> proposed are **not sufficient** — review built a run that satisfies all four
> while producing a stream that is useless for stem separation
> ([spike write-up, Limitation 6](spike-capture-mute.md#limitations)). Do not
> reintroduce them.

### The rig

Variant (b), against the **local fake player** from §6 (analytic RMS `0.353553`).
Two independent meters over the same seconds, never by ear.

1. Take the **browser mutex** and the **sink lock**, in that order.
2. Create an isolated `support.null-audio-sink` — **your own name**, e.g.
   `stem_workbench_gate`, never `harness_sink` (the machine's session default)
   and never the spike's `stem_workbench_spike`. Destroy it in a `trap`.
3. **Start `pw-record` on the sink's monitor BEFORE Electron launches, and stop
   it AFTER Electron exits.** This is the single correction that makes the gate
   mean what it says. A capture-window-scoped meter structurally cannot see the
   **1.90 s of full-level audio at peak 0.499893** that variant (a) leaks between
   `+0.60 s` and `+2.50 s`, before the capture opens at `+2.48 s`. The spike's own
   meter read `0.0` for that leak in three recorded runs — and `0.0199`, **39× over
   its own ceiling**, in a fourth where `pw-record` happened to start earlier.
4. Launch the app under `xvfb-run -a`, with `PULSE_SINK` and `PIPEWIRE_NODE`
   pointed at the gate sink.
5. Sample `spike/harness/bin/pwlinks.py <sink> --pid <the Electron process tree> --json`
   **inside** the window, at least twice. Chromium puts audio output in its own
   utility process, so the app is never one pid.
6. Score after the app exits.

### The capture-side instrument is not shipped

The RMS worklet measuring the captured stream is **test code**, not product code.
The app exposes the captured `MediaStream` on `window.__gate` in the host
renderer **only when `process.env.STEM_WORKBENCH_GATE === '1'`**, and the gate
asserts that the packaged build never sets it (see assertion 9). The alternative
— a second `getDisplayMedia()` from the test — perturbs the thing being measured;
the alternative of shipping a meter is worse. The worklet itself is
`tools/fixture/rms-worklet.js`, lifted from `spike/host.html`, and it reaches
`ctx.destination` through a gain of **exactly 0**: connected, because Chromium
only pulls nodes that reach the destination and an unconnected worklet reports 0
forever — a zero meaning "not measured" — and inaudible, because the question is
whether the *original* leaks and the speaker meter cannot tell an original from a
replay.

### The assertions

**Muted, and the capture is real**

1. `ytView.webContents.isAudioMuted() === true`.
2. `0.30 <= capturedRms <= 0.40` — a **band**, not a floor. The fixture's level is
   analytic (`0.353553`); observed (b) runs sit at `0.3498–0.3514`. **A floor
   alone passes an AGC-crushed stream at 0.108** — that is Limitation 6.
3. The window reports the **render-quanta count** it actually saw and the
   assertion is grounded on that count: `quantaWithChannels >= 1450`. **Not on
   wall seconds**: `capturedSeconds` jitters 3.979–4.011 s around 4.0, so a
   literal `>= 4 s` goes red on ~10 % of unmodified runs, and *a gate whose
   verdict changes on code that did not change is measuring the machine*.
   **0 quanta is an ERROR, never "silence"** — as is `quantaWithChannels === 0`
   and `n === 0`.

**The capture is usable** — none of this is optional for a stem separator

4. `track.getSettings()` reports, as **five separate assertions** so a red names
   which one moved: `channelCount === 2`, `sampleRate === 44100`,
   `autoGainControl === false`, `echoCancellation === false`,
   `noiseSuppression === false`. A naive `getDisplayMedia({audio:true})` yields
   **mono 48 kHz with AGC that decays the level 17× over 8 s**, and it looks fine
   to a careless gate.

**Silent, and the silence means something**

5. `speakerRms <= 0.0005`, measured **outside** the process, over **the app's
   whole lifetime**. This is the assertion that converts variant (a) from PASS to
   FAIL, and it is the single change that makes the gate mean what it says.
6. The speaker side carries its own **could-it-look** guard: a zero-length or
   short recording is an **error** (`rms.py` exit 3 / `--min-seconds`), never a
   `0.0`. Require the recording to cover at least 90 % of the app's lifetime.
   Both `speakerSeconds` and `capturedSeconds` are asserted; the spike's scorer
   read neither, so "the speakers were silent" could have been certified over
   2.4 s.
7. **Per-run, in-window:** the app-under-test's own `Stream/Output/Audio` node
   exists, names a pid in **this run's** process tree, and carries
   `target.object == <the measured sink>`. This — not a sink-level control — is
   what closes *"the app was never connected"*, and a third party's audio cannot
   satisfy it.
8. No node other than this run's pids is linked to the measured sink during the
   window (`pwlinks.py --pid` exits 4 if one is), **and** the run held the sink
   lock for its whole life.
9. The packaged build never sets `STEM_WORKBENCH_GATE` — a scan of the
   electron-builder configuration and the app's own source, comments stripped,
   naming the files scanned. The test hook in assertion 1's rig is a seam, and a
   seam that is not asserted shut is a hole.

**The control, which must be able to lose**

10. A **variant (d) control process** — `enableLocalEcho: true`, the view **not**
    muted, the capture running — on the same sink, inside the same lock, reads
    `speakerRms >= 0.01`. If it does not, the meter is deaf and the run is
    **VOID**, not green.

    It is a **second process**, not a second window: `nocapture` requires
    `getDisplayMedia` never to be called, so it cannot share a process with a
    capture run. (d) can, and (d) is the load-bearing control — *the same capture
    running, one flag flipped* — which is what rules out "starting the capture
    tore the app's output stream down". Measured: captured `0.350307–0.351061`,
    speaker `0.344373–0.348256`.

    The gate's discrimination is then `0.35` against `0.0`, 26 dB apart, and it is
    **that discrimination that carries the claim, not the threshold.**

### Not asserted, deliberately

- **`isCurrentlyAudible() === false`.** It stayed **true** in every muted run, in
  the original matrix and in all three audits. It reports that the page is
  producing audio, not that anything can hear it. Asserting it false is a gate
  that can never pass. *Do not add it.*
- **`nocapture` in the same run.** It cannot share a process with a capture; (d)
  above replaces it.

A **cheap bonus, not a substitute:** `getSettings().deviceId` carries
`?local_echo=false` when the flag is unset and drops the query when it is set, so
the knob is directly observable. It catches none of assertion 4.

### Known weaknesses of this gate, stated

- **`SILENCE_CEILING` (0.0005) has never been exercised.** Every silent reading
  ever taken here is bit-exactly `0.0` with peak `0.0`, so the ceiling could be
  any positive number. Record `speakerPeak` alongside the RMS.
- **The window is 4 s.** A leak shorter than that is averaged down. The 1.90 s
  variant-(a) leak is precisely a short leak, and it is caught by assertion 5's
  whole-lifetime recording rather than by the window.
- **No macOS, no audio hardware.** Silence here has never been *heard*. See §11.

### Watched red

| assertion | mutation |
|---|---|
| 1, 5 | remove `setAudioMuted(true)` — variant (a). Must go red on **5**, and *only* the whole-lifetime recording sees it |
| 2 | drop the audio constraints so AGC engages — captured falls to ~0.108, **below the band** |
| 4 | flip `autoGainControl` to `true`; then request mono |
| 5, 7 | point the app at a decoy sink (`APP_SINK`) — **7** must go red naming the wrong `target.object` |
| 6 | truncate the recording to 0.2 s — must be an error, not a `0.0` |
| 10 | run the control with the mute on — the control must **lose** |

---

## 9. `p1` — the P1′ acceptance test

**File:** `tools/suites/p1.mjs`. **Flags:** `window`.

**P1′**, successor to the extension's P1: *the app's own code talks to exactly one
named host — GitHub Releases, for the update check — and nothing else.* No
telemetry, no crash reporting, no fonts, no CDN. **The `persist:youtube`
partition is excluded**: that traffic is the user's browsing, and `PRIVACY` says
so.

### The instrument, and how you prove it is looking

`session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, …)` on **every
session the app creates**, recording `{ label, url, method, resourceType }`.

**The hard part is "every".** Electron has no API that enumerates sessions, so an
observer that lists the sessions it knows about is blind to the next partition
someone adds — and a session nobody observed reads exactly like a session that
made no requests. Close it at the source:

1. The app funnels **every** session it creates through one factory,
   `host/sessions.js: makeSession(label, partition)`, which installs the listener
   as it creates.
2. The suite asserts, by scanning the app's own source with comments stripped and
   **naming every file scanned**, that there is **no** `session.fromPartition(`
   and no `session.defaultSession` reference anywhere outside that factory.
   Same shape as the vendored `tools/unit-check.mjs`'s "no bare `chrome.*`" scan.
3. The suite asserts the factory really installed a listener on each session it
   made — count of sessions created == count of listeners installed, and both
   `>= 2` (default + `persist:youtube`).

**Then prove the instrument sees a request that SHOULD be seen** — two of them,
because one is not a control:

- **A request the app really makes.** Stand up a local TLS server answering as the
  update host (`tools/host.mjs`'s trick: a self-signed cert with that CN, plus
  `--host-resolver-rules=MAP <host> 127.0.0.1:<port>`), trigger the update check,
  and assert **both** that the instrument recorded that URL **and** that the fake
  host's own hit counter incremented. The hit counter is evidence *independent of
  the instrument*: instrument silent + host hit = the observer is blind, and that
  is a **RED**, not a green.
- **A request the app never makes.** From the app's own renderer,
  `fetch('https://example.invalid/x')`. Assert the instrument saw it **and** the
  policy cancelled it. This proves the observer covers the renderer, not just
  main.

### What it asserts

| # | assertion |
|---|---|
| 1 | over a full session — start, arm the local fake player, play, stop, quit — the set of hosts requested from **app-owned** sessions is exactly `{ UPDATE_HOST }` |
| 2 | ...and that set is **non-empty**. A "no request except X" assertion over zero observations passes vacuously; the count must be `>= 1`, the same `[1-9]` rule the runner's VOID regex encodes |
| 3 | `UPDATE_HOST` is read from **one** constant in the app (`host/update.js`), never re-typed here. A re-point moves the assertion with it |
| 4 | the instrument saw the update request **and** the fake host recorded the hit *(the could-it-look guard)* |
| 5 | the instrument saw the `example.invalid` request from the renderer, and the policy cancelled it |
| 6 | **the exclusion is by label, and the control can lose.** A synthetic request into the `persist:youtube` partition is observed, recorded under the youtube label, and correctly ignored — while **the same URL** from the default session is a RED |
| 7 | `crashReporter.start` is never called, and `app.getPath('crashDumps')` is never touched — source scan, comments stripped, files named |
| 8 | the host window's own HTML and CSS reference no external origin — a scan for `https?://` outside the allowlist |

**Assertion 6 is the one that makes the exclusion testable at all**, and it needs
no YouTube: it is the same URL through two sessions, with opposite verdicts. An
exclusion that is never exercised is an exclusion that might be excluding
everything.

### Watched red

| assertion | mutation |
|---|---|
| 1 | add a `fetch('https://fonts.googleapis.com/…')` to the host window |
| 2 | stub the update check out entirely — the observation set empties and must **not** pass |
| 3 | change `UPDATE_HOST` and leave the fake host's CN alone |
| 4 | remove the listener from the factory — host hit, instrument silent, RED |
| 6 | move the youtube exclusion from the label to a URL substring — the default-session control then passes, which it must not |

---

## 10. `vendor-intact`, `vendor-unit` and `vendor/.pin`

Two steps, and the order between them is deliberate: **`vendor-intact` asks
whether the copy is still the copy, `vendor-unit` asks whether it works.** Twelve
green suites over a tree somebody edited is a fork reporting that it still runs,
so the cheap question goes first.

`vendor/.pin` is JSON beside the vendored tree, written by
`tools/vendor-unit.sh`:

```json
{
  "tag": "v0.2.0",
  "steps": 12,
  "assertions": 1156,
  "archive": { "url": "https://github.com/…/v0.2.0.tar.gz", "sha256": "f22ef12b…" },
  "ours": []
}
```

`archive.sha256` is **provenance, not a gate** — GitHub builds those tarballs on
demand and has changed their gzip framing before, and 50 content hashes over the
same bytes carry the claim without that failure mode. A mismatch prints a note
and the run continues into the checks that can actually tell.

`ours` is the manifest of files inside `vendor/` that are **not** vendored — the
two holes and `offscreen/host-pin.js`. It is `[]` today, because this Host has
not written them yet, and the commit that writes the first one adds its path
here in the same commit. `tools/vendor-unit.sh` backs those files up before it
wipes the tree and restores them after the copy, so a pin bump does not silently
replace this Host with the extension's reference implementation.

The step runs `node tools/verify.mjs --unit --no-reap` **inside**
`vendor/stem-splitter-live` and then asserts three things about that run:

1. Its own verdict line appeared: `GREEN (partial — the vendored unit's suites
   only; N of M steps)`. Exit 0 alone is not enough — `--unit` exits 2 on an
   *empty* plan, but an emptied or mistyped `suites` list is not the only way to
   run fewer suites than the pin promises, and every one of those ways prints a
   **smaller, greener** number.
2. `N === .pin.steps`, and every row of its summary table is `PASS`.
3. The row counts sum to `.pin.assertions`. **A count of suites cannot see a
   suite that ran and asserted less than it used to** — that is the ABSENT
   assertion failure, and a pinned total is the cheap half of coverage drift.
   Exact, because `--unit` is plain Node, deterministic, and a tag is immutable.
   *If it ever proves unstable, delete the field rather than widening it to a
   range: a range on a deterministic number is a gate that has stopped measuring.*

`--no-reap` is load-bearing. Without it, that runner opens by `pkill`ing every
Playwright Chromium on the machine — a sibling agent's, and our own `smoke` step
if they overlap. `--unit` launches no browser, so it has nothing to gain from it.

**Before the vendor drop lands** there is no tree and the step is a `SKIP` —
named, and downgrading the run to `GREEN (partial)`. **The moment `vendor/.pin`
exists**, the repository is claiming to have vendored a tag and a missing tree is
a hard `FAIL`. That is what stops "skip because it is not there" from becoming
permanent: it expires by itself, on the commit that creates the pin.

### `vendor-intact` — rule V1, in 0.1 s and offline

`bash tools/vendor-unit.sh --check`. Five assertions, no network:

| # | claim |
|---|---|
| 1 | `vendor/.pin`, `vendor/upstream.sha256` and the tree are all there |
| 2 | the **35** unit files are byte-identical to the pinned tag — *nobody edited the unit* |
| 3 | so are the other **15** copied paths — the reference Host and the harness, which `unit.sha256` has never covered |
| 4 | every path `ours` claims is a hole and **not** a unit file, and is not still gated by `upstream.sha256` |
| 5 | no file was **added to or removed from** `vendor/` behind the sums file |

`vendor/upstream.sha256` is this repository's own record because nothing upstream
hashes those fifteen paths. It is written once, in the vendoring commit, where
all 50 files are in the same diff, and gated on every run after that.

Assertion 5 is a set comparison and not a checksum, and that is the point:
`shasum -c` answers only about the files in its list, so it cannot see a file
somebody **added** — which is the shape a local fix takes when its author knows
they must not edit an existing file.

Assertion 4 is `CONTRIBUTING.md` rule V1 in executable form. Declaring a unit
file `ours` would make a fork legal-looking from the inside, and it is the one
edit to `.pin` that no other check would notice.

**Watched red** — each mutation applied to a green tree, then reverted:

| assertion | mutation |
|---|---|
| 1 | `mv vendor/.pin` aside |
| 2 | `echo '// x' >> vendor/stem-splitter-live/extension/shared/config.js` |
| 3 | the same append to `test.js`, which is copied and is **not** in `unit.sha256` — 2 stays green, 3 goes red |
| 4 | `.ours = ["extension/shared/wav.js"]` |
| 5 | `touch vendor/stem-splitter-live/extension/shared/oops.js` |

---

The row parser and the verdict regex were read off a **real** run — `node
tools/verify.mjs --unit --no-reap` in `stem-splitter-live` at `v0.2.0`
(`git diff --name-only v0.2.0..HEAD` empty), 2026-08-26 — which printed 12 rows
summing to 1156, the number `VENDORING.md` §7 independently pins. It is not a
guess at the shape. `--self-check` keeps that transcript excerpt pinned, so the
vendored runner changing its summary line fails **here**, in 0 s, rather than by
reporting a green step as VOID.

---

## 11. What is verified here, and what is only configured

**Linux is the verification platform for this phase, by ruling.** The plan's pass
condition for step 3 is a notarized macOS pre-release. There is no Mac and no
Apple credential on this machine, so the substitute is:

| | |
|---|---|
| **verified** | a runnable Linux app that starts and arms on this box, proven by `smoke`, `capture-mute` and `p1` under `xvfb-run` |
| **configured, never built or signed here** | the electron-builder configuration and CI for macOS and Windows |

Say that plainly wherever it matters. It is not a caveat to bury.

Two further honesty items, carried from the spike's write-up:

- **macOS capture/mute has never been run.** The kill criterion for the whole
  plan is written against macOS. `capture-mute` is specified to fail loudly on a
  platform where the property does not hold, and until it has run on one, that is
  a claim about the gate and not about macOS.
- **There are no speakers on this box.** `aplay -l` finds no soundcards. Silence
  here is measured off the monitor of a null sink wired to no hardware. It has
  never been *heard*.
