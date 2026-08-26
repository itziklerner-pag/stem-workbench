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
that group. This repository intended **option 3 — point them at our files** —
and what it actually does is worth stating precisely, because half of option 3
turned out not to be available and a plan that is not the practice is worse than
either.

**Option 1 is the intermediate green, and it was recorded.** `--unit` run
*before* the holes were swapped: `GREEN (partial — the vendored unit's suites
only; 12 of 23 steps)`, 12 of 12 PASS, **1156 assertions**, in the vendoring
commit. It says the copy arrived intact and it is what `vendor/.pin` pins.

**Option 3 is not available as written, and the reason is in the group itself.**
`group('host')` installs a CHROME platform — `globalThis.chrome`, the Cache API
keyed on the extension's own huggingface pin, `getUserMedia` with
`chromeMediaSource` constraints — and then drives the hole modules over it. Ours
reach for an Electron preload bridge, an `app://` origin and a bundled file, so
those assertions do not become claims about our Host by being pointed at our
files: they become claims about a platform that is not there. Repointing them
means rewriting them, and a mechanical rewrite of the unit's largest suite is
not a thing to do inside a vendored copy that `vendor-intact` gates byte for
byte.

**So we take option 2 and then re-make the claims on our own platform.** The
reds are read as the conformance report `VENDORING.md` says they are, and every
rule behind them is asserted again against the shipped hole modules over a stub
of OUR platform:

| | where the unit's claim is re-made |
|---|---|
| the ENGINE half | `engine-host` (§5b) — over one real launch, plus the module driven directly inside the engine renderer |
| the DECK half | `deck-seam` — the seven rules `shared/host.js` declares, over a stubbed preload bridge, in ~0.4 s |

**Measured, so the report is a number and not an impression.** With our
`offscreen/host.js` in place, the engine half of `group('host')` is **23 PASS /
14 FAIL**, and every one of the fourteen is an assertion whose *stub* is Chrome:
`chrome.runtime.sendMessage`'s envelope and its swallowed rejection, the
`chrome.runtime.onMessage` listener, `getUserMedia`'s proprietary constraints,
and the six model duties keyed on the Cache API and the huggingface pin. Every
assertion in that group whose subject is the CONTRACT rather than the platform is
green: `send()` returns undefined, `assetUrl` is synchronous and keeps a trailing
slash, `captureStream` rejects rather than resolving null, `onTeardown` registers
the engine's own callback unwrapped, `modelCached` answers `false` when it cannot
look, `createBackend` returns a fresh three-duty backend per call with the hooks
forwarded and the resolver un-overridable, and `assertHost` accepts the module
and refuses every short one.

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
| `deck-seam` | `tools/suites/deck-seam.mjs` | — | **the DECK half of the Host seam** — the shipped `ui/host.js` driven over a stubbed preload bridge: the boot check, the envelope, late binding, the two storage lifetimes, the arm chord's vocabulary, and the closed write set |
| `shell` | `tools/suites/shell.mjs` | window | **the app skeleton** — one real launch: the window and its three views, every renderer's isolation, `app://` + COOP/COEP, the capture grant, the mute, the allowlist |
| `engine-host` | `tools/suites/engine-host.mjs` | window | **the ENGINE half of the Host seam** — the vendored engine boots under our `EngineHost`, all nine duties, the bundled weights end to end, and a real capture |
| `transport` | `tools/suites/transport.mjs` | window | **the source view's transport** — L1 over the shipped preload, the closed write set, a content jump vs a corrective seek, the speed clamp executed out of the vendored `speed.js`, autoplay-next, and the keyboard claim |
| `deck-host` | `tools/suites/deck-host.mjs` | window | **the deck half, over one real launch** — the vendored deck really boots under our Host and paints; SESSION and ARM_ERROR reach the surface; `drive` lands on a real `<video>`; the autoplay-next checkbox moves a stored preference through main into the transport. The CONTRACT is `deck-seam`, and this suite deliberately does not repeat it |
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

**`todo`.** Two of the twelve steps above — `p1` and `youtube` — are specified
and **not built**. They are in the steps table anyway, marked `todo`. A suite
that is not in the table is indistinguishable from a suite nobody thought of —
that is the standing rule at the top of the extension's runner, and it cost that
repository three separate incidents. A `todo` step never runs, is printed under
**WHAT DID NOT RUN** every time, and makes an unqualified `GREEN` impossible
until it is built.

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

## 5b. `engine-host` — the engine half of the seam, over one real launch

**File:** `tools/suites/engine-host.mjs`. **Probe:** `tools/gate/engine-host.mjs`.
**Flags:** `window`. **Cost:** ~60 s, almost all of it ONNX Runtime compiling and
warming a 109 MB model on wasm.

`shell` asks whether the app skeleton is the shape it says it is, and never loads
the unit. This one asks the next question: **does the vendored engine run inside
it?** Same launch mechanism (`electron . --gate=DIR`), different probe, chosen
with `--gate-probe=engine-host` — one probe per question, because a probe that
both checks a window and arms a capture has failures nobody can tell apart.

### What it drives, and through what

The nine `EngineHost` duties are reached **two ways, and both are the shipping
`vendor/…/offscreen/host.js`** — never a copy, never a stub:

- **Through the unit.** `send`, `onMessage`, `createBackend`, `captureStream`,
  `modelBytes`, `modelCached` and `assetUrl` are all exercised by the vendored
  `offscreen/engine.js` answering real messages. This is the half that matters:
  a duty that works when called directly and not when the engine calls it is a
  duty that does not work.
- **Directly.** The same module is `import()`ed inside the engine renderer — the
  module registry returns the instance the engine is holding — so `assetUrl`'s
  trailing slash, its **detached** call, `modelBytes`'s whole-buffer rule and
  `clearModel`'s honesty can be read as values instead of inferred from a green.

Plus `main`'s own half: the three messages it must **originate**, which
`assertHost` structurally cannot check because it cannot check for a message
nobody sent.

### The one that carries the most

**`HELLO`.** `engine.js` runs `assertHost(host, ENGINE_HOST_DUTIES)` at module
scope, line 96, and sends `HELLO` on its last line, 1712. A Host short a duty —
or one that threw anywhere on the way past — produces no `HELLO` at all, and
nothing in the unit exports a flag saying "I booted". The probe **reloads the
engine** to watch a real second boot rather than reading a stale value: a fresh
module evaluation, a fresh `assertHost`, a fresh `WorkerBackend`, over the same
Host.

### What it asserts

| # | assertion | detail must carry |
|---|---|---|
| 1–5 | `claims.js` as a pure function: one shot, consumed by the grant, expiry against an **injected clock**, revocation, an unminted token | the code of each refusal |
| 6–7 | the frozen payloads: `CAPTURE_START {sourceToken, source:{title,url}}` with no `tabId`, and `deck?` **omitted** for the default deck | the key lists |
| 8 | the app launches and the probe writes a report | electron/chromium versions |
| 9 | **the vendored engine boots under this Host** — `HELLO` on the bus after a reload | the envelope's `from`/`to` |
| 10 | the module declares all nine duties, against `ENGINE_HOST_DUTIES` itself | the nine names |
| 11–14 | `assetUrl`: inside the unit bundle, **trailing slash intact**, fetchable with a readable `.ok`, and an escape refused (M1) | the URLs, the `HEAD` status |
| 15–17 | `modelBytes`: 114,559,139 bytes owning their whole buffer, a **fresh buffer per call**, phase `'cache'` announced at 0 bytes | offsets, lengths, the phase |
| 18 | `modelCached` + `clearModel` as **one decision** — a no-op paired with `fromCache: false` | all four values |
| 19–20 | the engine answers `STATUS` (its model status leaves `'unknown'`), and its page is cross-origin isolated | the transition, `boot.sab`/`boot.coi` |
| 21 | `createBackend` **forwarded the unit's hooks** — `onReady({threads, adapter})` arrived at all | the thread count and adapter |
| 22–23 | `DECK_PREPARE` builds the ORT session and the **unit's** SHA-256 over our bytes passes | `ms`, `ep`, `model.status` |
| 24 | a forged token buys nothing, and `captureStream` **rejects** rather than resolving null | the refusal's own sentence |
| 25–27 | the stream the Host hands back is stereo/44100/AGC-EC-NS off, carries **one audio track and no video track**, and **carries sound** — a peak of 0.5000, the fixture's own amplitude, while the view is muted | all five fields, the track counts, the peak |
| 28–30 | the grant named the **source view's frame**; `CAPTURE_START` arms a real capture; the ring is fed at the context's rate with nothing dropped | the `deviceId`, the frame count |
| 31 | `CAPTURE_STOP` stops it and revokes a claim that was **minted and never spent** | the registry before and after |
| 32 | the `AudioContext` is at 44100 | `boot.sampleRate` |
| 33 | `onTeardown` registers the caller's own function on `pagehide` and it runs **synchronously** | whether it had run when `dispatchEvent` returned |
| 34–37 | the three originated messages, by name, with their frozen key sets — payload keys included — all delivered | the key lists and the counts |

**Two of those are counts and one is a level, and each replaces a claim that
cannot be made another way.** The **byte count** (114,559,139, exactly
`MODEL.bytes`) says the whole file arrived. The **frame count** says the ring is
being fed at the context's rate. And the **peak** says the capture carries
audio — which the frame count cannot: stopping the audio track inside
`captureStream` leaves the engine counting 73,728 frames of silence, measured,
and that mutation is in the battery.

### Two things measurement corrected in the design

Both were written here as expectations and are now facts, because a mutation
made them testable.

**The thread count does not prove shared memory** (`docs/HOST-DESIGN.md` §2.4
assertion 4, §10 A5). Delete COOP and COEP from every `app://` response and the
engine reports `sab=false coi=false` — **and ORT still reports `threads: 4`**,
because `workers/inference.worker.js:45-49` *pins* `ort.env.wasm.numThreads` and
`onReady` echoes the pin rather than measuring the runtime. The isolation claim
is carried by `boot.sab` and `boot.coi`, which that mutation does turn red. The
thread count still earns its place: it is the only evidence that
`createBackend` forwarded the unit's hooks, and dropping the `...hooks` spread
leaves it `null`.

**A frame count cannot tell audio from silence.** `STATE.capture.frames` counts
what the capture worklet was pulled for, and a `MediaStreamAudioSourceNode` over
an ended track still pulls silence. The first version of this suite asserted
"the audio really reaches the engine's ring" over that number and was green with
the track stopped — and green again with the fixture *paused*, which is how it
loads. The level assertion is what closes both.

### Deliberately not asserted here

- **The deck half.** `DeckHost`, `DeckPage` and `DeckTransport` are 23 of the 32
  duties and this suite never looks at the deck view.
- **The six `SW_*` messages** the deck sends to `BUS.host` (§5.3 of
  HOST-DESIGN.md, finding F1). `main` still answers none of them.
- **The speaker.** This suite proves a capture opens and is usable; it does not
  witness the audio device. `capture-mute` (§8) is that claim and **this suite
  cannot replace it**.
- **Six stems.** `DECK_PREPARE` runs the whole model path including one warm-up
  inference, but nothing here asserts what came out of it.
- **WebGPU.** There is no adapter on this box, so `ep` is `wasm` and
  `boot.ep === 'webgpu'` has never been observed here.

### It skips rather than fails without the weights

`models/htdemucs_6s.onnx` is 109 MB, is not in git, and is seeded by
`bash tools/vendor-unit.sh --model`. A machine without it cannot answer the model
half of this suite at all — so it **skips**, and the runner names the skip in the
verdict. A red for a file that was never meant to be committed is a red people
learn to ignore.

### Watched red

`tools/suites/engine-host-mutations.sh` — 29 named cases, each declaring the
assertion **names** it must turn red, with `tools/suites/coverage.py` over the
whole battery refusing any assertion that has never been seen on a `FAIL` line.
The table is in the suite's own header, with what actually went red rather than
what was expected to. `tools/verify.mjs`'s `engine-host` step names which cases
falsify which claims.

**Four of the assertions here exist in their present form because the battery
falsified their first draft rather than the code.** They are worth reading as a
list of the ways a windowed suite lies:

| the draft | what the mutation showed | what it asserts now |
|---|---|---|
| the capture is stereo/44100/unprocessed | the probe called `getDisplayMedia` with its **own copy** of the constraints, so breaking them inside `host.js` left it green (case 8) | it drives the shipping `captureStream` and reads the settings off what **it** hands back, including its refusal |
| `CAPTURE_STOP` revokes every live claim | every token in the run had already been consumed by a grant, so `live === 0` held whether or not anything revoked it — an estimator saturated before the claim range began (case 15) | the probe mints one claim it never spends, and the assertion checks that setup happened |
| the audio really reaches the ring | a **stopped** track still clocks buffers into the ring, so the frame count was green over silence (case 22) | a peak measured off the stream, near the fixture's own 0.5 |
| `CAPTURE_START` carries exactly `{sourceToken, source}` | one assertion read `start.source` unguarded and **crashed the process** instead of reporting red, taking the whole suite with it (case 25) | guarded, so a missing message is a red and not a stack trace |

The battery itself gained a pre-flight from the same run: **an expected name that
matches no assertion in the green baseline aborts the case.** Four misses in the
first full battery were a reworded assertion or a backtick the shell had eaten
before `grep -F` ever saw it — a misspelled question that MISSES exactly like a
hole in the suite.

---

## 5c. `transport` — the source view's transport, over one real launch

**File:** `tools/suites/transport.mjs`. **Gate probe:** `tools/gate/transport.mjs`.
**Flags:** `window`. **Cost target:** < 120 s. **63 assertions**, 22 of which need
no launch at all.

The suite that runs `src/preload/youtube.cjs` — the file that touches somebody
else's `<video>` — against the local fake player, and the two decisions behind
it: `src/main/speed.js` (which EXECUTES the vendored `extension/speed.js`) and
`src/main/autonav.js` (which PORTS a Host file that does not travel).

```bash
node tools/suites/transport.mjs             # the whole thing, one launch
node tools/suites/transport.mjs --static    # sections 1-4 only, 0.3 s, no display
```

`--static` is not a plan the runner ever uses; `tools/verify.mjs` runs the file
with no flag. It exists because 22 of these assertions are a text read and a pure
function, and a mutation battery that had to launch Electron 25 times would be a
battery nobody runs.

### It drives the real interface, not a private door

Every command the gate issues goes through `state.transport`'s public members —
the same ones `src/main/deck-host.js` injects into the `DeckTransport` the deck
sees. Nothing reaches past the transport into the preload, because a gate that
used a private door would be gating a door nothing else opens.

The probe **never asserts**. It drives, it records what arrived on the five
report channels in arrival order, and it writes `report.json`. Every judgement is
in the suite, which is a separate process and can be run against a report from a
mutated build.

### How L1 is proved — three instruments, none sufficient alone

| # | instrument | what it can see | what it cannot |
|---|---|---|---|
| 1 | **the write set, ENUMERATED** — with comments and string literals stripped, the *complete* set of member assignments in the preload is compared against the closed write set | any new write, including one nobody thought to forbid | a write built at run time |
| 2 | **the read set, ALLOW-LISTED** — every property the file touches at all, against an enumerated list | a new `el.videoWidth`; it is red until somebody widens the list on purpose | the same |
| 3 | **it asked for nothing** — `main` records every request the source view's session made across the whole exercise | code no scanner could read: a `new Function`, a property name assembled from pieces | anything that resolves a URL without fetching it |

A forbidden-token blacklist answers *"is this one bad thing absent"*. (1) answers
*"is anything else present"*, which is the question. The blacklist is kept anyway,
because it is what a reviewer reads and it names the failure in `CONTRIBUTING.md`
L1's own words — and because it covers **bare identifiers**, which a member scan
cannot see: `fetch(...)` and `new Blob(...)` have no dot in front of them.

**The scanner carries its own could-it-look guard.** A stripper that ate the file
would report zero of everything and every assertion above would be vacuously
green — the exact shape `AGENTS.md` is a record of. So the stripped text must
still be over 3 000 bytes, must still contain `driveRate`, and must NOT contain
the header's own prose (which says `src`, `currentSrc` and `captureStream` out
loud).

Measured: **6 164 bytes** of code after stripping, **4** distinct member
assignments — `muted`, `currentTime`, `playbackRate`, `preservesPitch` — and
**2 requests** over the whole run, both the fixture document itself, both
`mainFrame`, zero off-scheme.

### The pin, and why this Host executes `speed.js` instead of porting it

`extension/ui/embed-state.js` is a **unit** file that reads `../speed.js` **as
text** and pins the deck's 29-rung speed ladder against that file's clamp
(`unit.json` `hostReads`). A Host that declared `SPEED_MIN = 0.5` of its own
would not have copied a constant — it would have made that pin a **lie**: the
deck would go on checking its ladder against a file that is no longer the clamp
in force, go on passing, and the two numbers would be free to part company in
exactly the silence the pin exists to prevent.

So `src/main/speed.js` runs the vendored file in a `node:vm` context and
re-exports what it declares. `speed.js` is a **classic script** — its `var`s are
how a content script publishes them into the isolated world `content.js` shares
with it — so `import` gets an empty namespace and `vm` reproduces the extension's
arrangement exactly. The file's own `demo()` does not run: it is guarded on
`typeof process !== 'undefined'`, and a bare `vm.createContext({})` has none.

Three assertions hold it: the path this Host executes **is** `ui/../speed.js`;
the range and the key-lock in force **are** that file's own declarations; and no
file under `src/` declares a speed range of its own.

### `autonav.js` is a port, and that is a finding rather than a choice

`extension/autonav.js` **is not on this tree.** `tools/vendor-unit.sh` §3 derives
the copy list from `unit.json` — unit files, holes, `hostReads`, and everything
the declared suites and runners read — and nothing reads `autonav.js`. It is
classified `host` with no reader, so it does not travel. `speed.js` is classified
`host` too and travels only because two suites read it.

`src/main/autonav.js` is therefore a port of a Host-side decision, which is not a
fork — a fork is an edited copy of a *unit* file. What it costs is stated where
it lives: the two copies of `autonavPlan` can drift and nothing on either machine
goes red. **One thing can be pinned and is**: `PREFS_KEY`, against
`shared/config.js`'s export, because a Host reading a different key is autoplay
suppression that silently never applies.

### What it asserts

| # | assertion | detail must carry |
|---|---|---|
| 1–4 | the clamp executed **is** the file the ladder is pinned to; its range and key-lock are that file's own; nothing under `src/` re-declares a range; `PREFS_KEY` is the unit's | the two paths, the declared values, the files scanned |
| 5–7 | the preload's `VIDEO_EVENTS` and `JUMP_EVENTS` are the reference Host's, parsed out of the vendored `content.js`; `ratechange` is in one list and not the other | both arrays, from both files |
| 8–13 | **L1, statically**: the complete member-write set is the closed one plus the key-lock policy; it writes all four; every property touched is allow-listed; no forbidden name appears; the scanner is looking at code; `play()` never appears | the write set, the strangers, the bytes scanned |
| 14–21 | the pure decisions: `filterDrive` drops everything outside the set and coerces nothing; the event→reason mapping is `speed.js`'s entry-point rule; the same want and current **write** on a remount and **yield** on a ratechange; the clamp, the refusal, the release; `resolveSuppress`; every autonav failure has a name; the original is recorded once; the selector matches on ARIA | the values, both directions |
| 22 | the app launches and the gate writes a report | exit code, section count |
| 23 | **the gate was actually listening while it drove** | `tap.subscribed`, the emitted counts |
| 24–26 | the five transport values come back; states are **pushed** on media events and a tick with nobody asking; `adShowing` is `null` and not `false` before the Host has named the ad selector | the five values, the event names |
| 27–30 | the three writes land; the key-lock policy lands with the rate; the four fields outside the set leave **no trace on the element**; `release` hands it back | the element read back, `srcScheme`, `volume`, `loop`, `srcObject` |
| 31–33 | **our own corrective seek is not a content jump, and the seek really happened**; a seek the page made **is** one; a rate change is not | jump counts, the self-seek counter, the element's position |
| 34–40 | the user's speed reaches the element and reports the literal `'ok'`; a rate above the ceiling is clamped, applied and reported; an unreadable rate is refused out loud; the page's own speed menu is **yielded** to; an ad neutralises to 1 and remembers the claim; the ad-end edge puts it back; the run wrote the rate a handful of times, not once per tick | every report, the element's rate at each point |
| 41–45 | with no deck armed a claimed digit is the page's; armed, it is taken and the page does **not** see it; an unclaimed key stays the page's; a claimed digit **typed into a text field** is the page's; `?` is taken by character | both ends of every case — the page's own witness and the transport's |
| 46–51 | the page ships autoplay-next **on** and the Host takes it; the value is put back; turning it off re-takes it; a toggle that ignores its click is `stuck` after a bounded number of tries; an absent control is `looking` then `missing`; every state is in the deck's vocabulary | the `aria-checked` at each point, the state names, the click count |
| 52–55 | an announced single-page navigation is one jump and one swap; the speed claim goes with the video; **an unannounced one is noticed anyway**; the element *arriving* is not a jump | the change list, the rate before and after |
| 56–57 | a window in which nothing changed carries **zero** speed and autonav reports (the control); `resend()` puts all three back | both counts |
| 58–63 | L1 at run time; nothing but the source view spoke on the channel; a deck host was already subscribed to all five channels before the gate looked; every `on*()` returns a working unsubscribe | the requests, the listener counts before and after |

**Assertion 23 is not decoration.** The first run of this gate produced a
complete-looking report in which every channel was empty, because `subscribe()`
had never fired — `main.js` had stopped calling `beforeLoad` and the tap's only
other entry was untaken. Every count in the report was zero and every count-based
assertion would have been trivially satisfied. *"Nothing happened" is also what a
dead instrument looks like.*

**Assertions 41–45 are witnessed at both ends.** The page records the keys it
saw; the transport records the keys it took. "The deck got nothing" on its own is
also what a broken wire looks like, and the product ruling is a claim about the
*page* — with no deck armed, `1`–`6` must do on somebody else's site exactly what
they do with this app not running.

**Assertion 54 is the one that matters most.** `yt-navigate-finish` is the site's
**private** event name. A Host that only listened for it would lose the feature
the day it is renamed, with nothing to see. The fixture's `spaNavigate(announce)`
runs the same navigation both ways, and the unannounced one is the only evidence
that the preload's 250 ms tick is load-bearing rather than decorative.

### Deliberately not asserted here

- **Real YouTube.** The fixture's player chrome is a reproduction of markup
  measured on a watch page on 2026-08-15, not the page itself. Nothing here can
  catch a YouTube-side change; that is `youtube` (§7), manual only, and its
  absence is printed under **WHAT DID NOT RUN** on every default run.
- **The deck.** This suite drives the transport directly. A `deck-host.js` that
  subscribed to nothing would still be green here — except for assertion 60,
  which is the one thread between them: it records that *somebody else* was
  already subscribed to all five channels before the gate looked.
- **A sender that is not the source view.** `transport.js` drops a `'yt'` message
  from any other `WebContents` and counts it. No renderer we ship can put a
  message on that channel at all — none of the three preloads exposes it — so
  there is nothing to send the message that would prove the drop. What *is*
  asserted is `strangers === 0`: nothing unexpected spoke.
- **The audio.** This suite proves the transport drives an element. Whether the
  capture is audible and the speakers are silent is `capture-mute` (§8), and
  **this suite cannot replace it.**
- **`lost`, live.** `autonavPlan`'s `lost` branch — the control vanished while we
  still owed a restore — is asserted as a pure function. Reaching it live costs a
  6 s find window on top of the 6 s the `missing` case already spends, and the
  pure assertion covers the decision. The wire it shares with `missing` is
  exercised.

### The fixture is a fake *player*, not just a `<video>`

`tools/fixture/player.html` is shared with `shell` (§5) and `capture-mute` (§8),
so its analytic level is unchanged: a 440 Hz stereo sine at amplitude 0.5, RMS
`0.5/√2 = 0.353553`, 60.0 s = 26 400 whole cycles, generated in-page into a
`blob:`. What this slice added is the page furniture the transport reaches for,
in the markup that was **measured** rather than the markup we wish they shipped:
`#movie_player` carrying `ad-showing` as a class, the `<video>` **inside** it, and
the autoplay toggle whose `aria-checked` lives on a `<div>` inside the `<button>`
— so the flip happens by **bubbling**, which is the half that would break if
somebody "simplified" the selector to match the button.

**One `__wb*` global, and it is `__wbFixture`.** `shell.mjs` asserts the source
view's `window` carries no bridge of ours by listing every `__wb`-prefixed own
property and allowing exactly that one. Every hook hangs off it as a property; a
second global would turn a real assertion about `preload/youtube.cjs` into a red
about the fixture.

### Watched red

`tools/suites/transport-mutations.sh`, which runs the suite **unmutated first and
requires green**, refuses to continue if an anchor has moved, requires the named
assertions on `FAIL` lines, restores the file and checks the restored bytes. A
case declares whether its red is `static` (0.3 s) or `live` (one real launch);
`--static` runs the cheap half.

**Three cases were recorded MISSED on the first battery, and all three were
defects in the EVIDENCE rather than in the code.** They are written up because
the correction is the useful part — each one is an assertion that looked like it
was doing its job and was not.

| case | why it could not lose | what changed |
|---|---|---|
| **3** — delete `driveRate`'s key-lock write | `preservesPitch` defaults to `true` in Blink and `SPEED_KEY_LOCK` is `true`, so "it reads true afterwards" is satisfied by an element **nobody ever wrote**. `AGENTS.md`: an estimator that saturates below the claim is not an estimator | the gate now sets `preservesPitch = false` **from the page's own world** one statement before the drive. The case also expected the *static* write-set assertion to go red, which it cannot — `restoreVideo()` writes the property too, legitimately — so that half was dropped |
| **9** — spread the patch in `filterDrive` | the element was **unmarked**, because the preload names its three fields as well. The live claim is about three layers and one broken layer cannot falsify it | case 9 now spreads **both** `filterDrive` and the preload's `driveVideo` — the pair a "tidy up the duplication" change would make. Single-layer loss is what the *static* enumeration catches, and it did |
| **23** — delete `speed.dropClaim()` on a source swap | a fresh `<video>` starts at rate 1 and the first state after a swap is a poll, which `speedPlan` answers with a **YIELD** — so the claim is let go as a side effect either way and the element reads 1 whichever happened | the assertion now reads the reports, not the element: `want: null` appears only when the claim is **released**, never when it is adopted. Under the mutation the wants go `[1, 1]` and it is red. The distinction is not academic — the yield is an ordering accident, and a `loadedmetadata` arriving first carries reason `remount`, which WRITES a stale claim onto a video nobody has heard |

The battery is **25 cases, 24 of them one-line edits**; nine need no launch.
Reproduce with `tools/suites/transport-mutations.sh` (or `--static` for the cheap
half, 0.3 s).

## 5d. `deck-seam` — the DeckHost's contract, in plain node

**File:** `tools/suites/deck-seam.mjs`. **Flags:** none — no window, no display,
no mutex. **Cost:** ~0.3 s. **Battery:** `tools/suites/deck-seam-mutations.sh`.

`VENDORING.md` gives a second Host three things to do about the 122 conformance
assertions in the vendored `test.js`'s `group('host')`, and this repository takes
option 3 — point them at our files. Half of that is free: the group reads the two
holes BY PATH and our implementations are at those paths. The other half is this
file. That group installs a CHROME platform and drives the module against it; our
`ui/host.js` reaches for an Electron preload bridge instead, so those assertions
would fail for the platform rather than for the contract — a red that says
nothing.

So this suite stubs the PLATFORM and drives the SHIPPED module, with the unit's
own `assertHost`, `assertHostOption`, `chordLabel` and `ARM_CODES` imported out
of the vendored tree. Nothing in it reimplements either side.

**It runs on every commit, and that is the point.** The two things a broken Host
breaks silently are late binding and the envelope, and a browser gate cannot run
that often. It also carries the claims about `src/main/storage.js` (the two
lifetimes, absent vs unreadable, the third-area refusal, the change feed) and
`src/main/keys.js` (the key router's eight cases), because those are pure
functions and a launch would tell you nothing extra about them.

**What it cannot say:** whether the deck PAINTS, whether `drive` reaches a real
`<video>`, or what the DECK does with what the Host sent — see §5e, and the
relay bug recorded there, which is the shape of every defect a stub agrees with.

---

## 5e. `deck-host` — the deck half, over one real launch

**File:** `tools/suites/deck-host.mjs`. **Flags:** `window`. **Cost:** ~45 s.
**Probe:** `tools/gate/deck-host.mjs`, run by `--gate --gate-probe=deck-host`.

### Why this suite has no plain-node half

It had one — 40 assertions driving the shipped hole module over a stub bridge —
and they were deleted, because `deck-seam` was already making every one of those
claims by the same technique and in a fifth of a second. Two suites over one seam
is two places to edit and one to forget, and this repository rejected that shape
once already for the runner itself ("T1 — two runners, drifting where it is most
expensive").

**The two claims that had no counterpart MOVED to `deck-seam.mjs` rather than
being dropped** — a fresh profile answering `null` in both areas, and main's own
change feed filtering by area and key — each with its own case in
`deck-seam-mutations.sh` (39a, 39b). A claim that moves without its mutation is a
claim that has stopped being evidence.

### What only a launch can say

Two of these were measured here and could not have been measured anywhere else,
and they are the argument for keeping a 27-assertion suite that costs 45 s:

1. **The relay overwrote the type it was relaying under.** The transport's
   payloads carry their own `{t:'state'}`, and `toDeck({ t: 'video', ...s })` let
   the spread win — so every state arrived typed `'state'`, the deck's inbound
   map had no handler for it, and `onState`, the duty the whole deck follows,
   never fired. Measured as `toDeck.state: 48, toDeck.video: 0`. A stub bridge
   cannot see this: it records what the Host sent and agrees with it. What went
   wrong was what the DECK did with it.
2. **`requestSpeed(3)` is clamped to 2 on a real element, and the deck's readout
   follows the element rather than the request.** That is three processes and the
   vendored `speed.js` agreeing; a stub asserts only that the 3 went on the wire.

### What it asserts

| # | assertion | detail must carry |
|---|---|---|
| 1 | the app launches from its real entry point and the probe writes a report | exit code, electron/chromium versions |
| 2–4 | **the vendored deck BOOTS** — every `assertHost` at `ui/embed.js` module scope passed — its module is ours, and `transport` is spelled and non-null over a Live source | the boot time, the duty list, both namespaces' members |
| 5–7 | over the real ipc: one key in both areas comes back as two values, the area refusals keep their two shapes, and a change made by MAIN reaches the deck's own listener | the two values, which refusal took which shape |
| 8 | `armShortcut` reports the accelerator the application menu REALLY took, and the deck draws it on a key cap | the raw string, what is on screen |
| 9 | SESSION paints the not-armed hint and arming clears it — the deck PROJECTS the record | the hint before and after |
| 10–13 | ARM_ERROR paints, is dismissible, offers no Restart it cannot honour, is persisted as `{code, message, at, seq}`, and ARM_ERROR_CLEARED takes it down and drops the record | the banner title, the record |
| 14–16 | `claimKeys` arrives with the UNIT's list; `setHeight` is clamped and the view really is that tall; `ready` produces the re-send it owes | the key list, the heights, the deltas |
| 17–21 | `drive` lands on a real `<video>` and `volume`/`evil` do not; `release` restores; `requestSpeed(3)` is clamped and REPORTED; `onState` really reaches the deck | the element's values, the message counts |
| 22–24 | the autoplay-next checkbox is not dead: the click stored the preference, main pushed it, the transport moved, and `local` is on disk | the record, the push count, the file |
| 25–27 | the bridge cannot be rewritten from inside the page; `page.close` hides the deck and the ENGINE IS STILL ALIVE; the deck PAINTED | the swap result, the colour count and height |

**Assertion 16 counts a DELTA, not a total.** "`ready` produced a re-send" was
first written as "some video messages have arrived" — and the transport pushes
state at ~4 Hz regardless, so deleting the re-send changed nothing the assertion
could see. It measures `speed` and `autonav` across one `ready` instead: neither
ticks, and `resend()` re-sends the last of each undeduped.

**Assertion 27 reads two numbers.** A blank page and a working one are both a
PNG — and so are a styled deck and an unstyled one. Measured: with its stylesheet
the deck is 432 px and 241 distinct colours; served with `embed.css` as
`text/plain` it is 900 px (the clamp ceiling, because nothing sized it) and 100
colours. The first threshold, "more than 20 colours", called that a pass.

### Deliberately not asserted here

- **The contract** — `deck-seam`.
- **The engine half of the seam** — `engine-host`.
- **The source view's own behaviour**: L1 in the preload, a YouTube `<video>`,
  the autoplay toggle really being found and clicked — `transport`. What is
  asserted here is that the deck's members REACH it and that what comes back
  reaches the deck.
- **Six stems.** Nothing here proves the engine produces audio inside this app.
- **The write set at more than one layer.** `drive` is filtered at the seam,
  again in `transport.js` and again in the preload; breaking one alone does not
  change what reaches the element. `deck-seam` watches the seam's layer.

### Watched red

`node tools/suites/deck-host-mutations.mjs` — one edit to one shipped file per
row, the assertions it must turn red, and a restore in a `finally`. It fails two
ways: a mutation that produced NO red, and any assertion no mutation ever turned
red. Every row costs a launch, because every assertion here is about a real one.

Two assertions are covered deliberately weakly and say so at their site: the
three-layer write set (above), and "the bridge cannot be rewritten from inside
the page", which is a property of `contextBridge` rather than of our code — there
is nothing of ours to break, and it is recorded because it is the reason the
launch half cannot test late binding at all.

---

## 6. `smoke` — Playwright-for-Electron against a local fake player

**File:** `tools/suites/smoke.mjs`. **Flags:** `window`. **Measured:** 18
assertions, ~40 s. **Falsified by:** `tools/suites/smoke-mutations.sh`, 19 cases.

Playwright drives Electron through its `_electron` API:

```js
import { _electron as electron } from 'playwright-core';
const app = await electron.launch({ executablePath: …, cwd: ROOT, args: ['.', `--source-url=${FIXTURE}`, …] });
```

**`playwright-core`, not `playwright`**, and that is a dependency decision rather
than a spelling. `_electron` is the only thing this suite uses and it drives the
Electron binary the repository already has; the `playwright` wrapper's whole
added value is a postinstall that downloads Chromium, Firefox and WebKit — ~500
MB this repository would never open, on every CI run, to reach an API that is in
the core package.

### It is the only suite that stands OUTSIDE the app

Every other windowed step here drives the product from inside its own main
process: `--gate=DIR` makes `src/main/main.js` import a probe, hands it the live
handles, and the suite judges the JSON that probe wrote. That is what makes them
exact — and it is also why not one of them can click a menu item or read the
deck's painted surface.

| | it drives | it cannot |
|---|---|---|
| `shell` | the window, isolation, the grant | see the deck's DOM at all |
| `engine-host` | the nine engine duties, a real capture | press play |
| `deck-host` | the deck half, by calling `host.arm()` | tell a Host whose MENU was never installed from one whose menu works |
| `transport` | the source preload, from main | say whether the deck received any of it |
| **`smoke`** | **the application menu's `Arm this Source`, the player's own play button, and the deck's painted surface** | measure audio |

### Running it — the mutex goes around the SUITE, not around a spawn

The other windowed suites spawn `electron` themselves and wrap that one call in
`flock` + `xvfb-run`. This one does not spawn it — Playwright does — so the suite
**re-execs itself once**, under the lock and under Xvfb, and the inner run does
the work:

```bash
export STEM_WORKBENCH_BROWSER_LOCK="$SCRATCH/browser.lock"
node tools/suites/smoke.mjs
#   -> flock "$LOCK" -c "xvfb-run -a -s '-screen 0 1280x1024x24' node tools/suites/smoke.mjs"
#      with STEM_WORKBENCH_SMOKE_INNER=1
```

The wrapper relays the inner run's output verbatim and exits with its code. If
the inner run produced **no summary line** the wrapper prints a `FAIL` of its own
rather than exiting 0 — an outer process that swallowed a dead launch would be
the VOID case one level up, and the runner would name the convention instead of
the launch.

### The fake player, and why there is one

CI must never depend on YouTube's DOM and must never hit a bot wall. Same trick
as `stem-splitter-live/tools/host.mjs` answering as `huggingface.co`: the app is
pointed at a local page instead of the real one.

`tools/fixture/player.html` is a `<video>` the preload drives. **It generates its
own media in-page** — a few lines of JS write a RIFF header and a 440 Hz stereo
sine into a `Blob`, and `URL.createObjectURL()` becomes `video.src`. No binary in
git (`.gitignore` excludes `*.wav`), no `ffmpeg` at test time, and the level is
**analytic**: a stereo sine of amplitude 0.5 has RMS `0.5/√2 = 0.353553`.
`capture-mute` needs that number, so the fixture is shared between the two suites
and lives in one file.

**Sixty seconds, and the length is load-bearing — do not trim it.** The
extension's smoke shipped a 0.5 s `loop`ing clip; every wrap fired `seeking`,
`content.js` reports `seeking` as a content JUMP, and it cost a real assertion
(`tools/embed-smoke.mjs` carries the write-up). The same defect is reachable here
and lands on **assertion 10**, which says a user's seek arrives as *exactly one*
jump: a wrap inside that window would make it two on a correct build and one on a
broken one. The playhead never gets past ~23 s and the whole suite is ~40 s, so
no wrap can happen. The fixture's own header carries the other half of the
reason: 60.0 s at 440 Hz is 26 400 whole cycles, so `capture-mute` can wrap
without a click.

### The guard, and how it is proved to be looking

The suite installs `onBeforeRequest` on **both** of the app's sessions and
cancels anything whose scheme is not `file:`, `app:`, `blob:`, `data:`,
`devtools:`, `chrome:` or `about:` — so an accidental `youtube.com` load is a red
rather than a slow test, a rate limit or a CAPTCHA.

"No off-box request was recorded" is also what a handler nobody installed
reports, and that estimator saturates before the claim begins. So before the
ledger is read, the guard is made to refuse two navigations it MUST see — one per
session, to `https://smoke-guard-{ours,source}.invalid/probe`. `.invalid` is
reserved by RFC 2606 and resolves nowhere, so the proof cannot itself reach a
host.

**It replaces the transport's own `onBeforeRequest`** on `persist:youtube` for
the life of the run (a session has one handler slot). That witness is read by
`tools/gate/transport.mjs` and by nothing in this suite, so nothing is lost — but
an assertion added here that reached for `transport.requests()` would find it
empty.

### What it asserts

| # | assertion | detail carries |
|---|---|---|
| 1 | the app launches and opens **one visible window with its three views attached**, beside the **hidden engine `BrowserWindow`**, and all four renderers are reachable as Playwright pages | the child `webContents` ids, the source view's id, the Electron/Chromium versions |
| 2 | the network guard is live on **both** sessions — it saw two deliberate off-box navigations and refused them | which probes were recorded, how many came back `ERR_BLOCKED_BY_CLIENT` |
| 3 | `assertHost` accepted **both** halves of the Host: the deck reached module scope (`window.__embed`) and the engine answered `STATUS` with a `STATE` | the members `ui/host.js` exports, the two duty counts |
| 4 | **`SESSION`** — clicking `Arm this Source` in the application menu originates it to `BUS.deck` with `{armed,title,url,armedAt}`, and the deck stops painting its not-armed hint | the menu label and accelerator, the session keys, the hint before and after |
| 5 | **`CAPTURE_START`** is originated to `BUS.engine`, carrying a minted token | the address it went to, the token's length |
| 6 | …and its shape is the frozen one — `{sourceToken, source:{title,url}}`, no `deck` for the default deck and **no `tabId`** | the observed key sets |
| 7 | **`DECK_PREPARE`** is originated to `BUS.engine`, with `deck` omitted for the default deck | the observed keys |
| 8 | the deck follows the player: play and pause on the page move `__embed.videoPlaying` | both transitions, and where the playhead got to |
| 9 | …and the report the deck reads carries the transport state and **nothing about the media** — no `src`, `currentSrc`, `buffered` or `srcObject` | the report count and every field name in the last one |
| 10 | a seek the **user** made arrives at the deck as **exactly one** content jump | `__embed.jumps` before and after |
| 11 | the page's own speed menu reaches the deck: the Host's speed **report** arrives with `applied` 1.5 / `state` `ok` / `want` `null`, the deck's readout follows the element, and nothing writes the rate back | `__embed.speed` before and after, the last report's four fields, the element's rate |
| 12 | the deck reaches the player: `transport.drive` lands `muted`, `playbackRate` and `currentTime` on the real `<video>` | the values sent and the values read back off the element |
| 13 | …and **nothing else did**: `volume` and an `evil` field rode in the same patch and never reached it | `video.volume`, `video.evil` |
| 14 | **`CAPTURE_STOP`** — clicking `Disarm` originates it, with `deck` omitted | the menu label, the observed keys |
| 15 | …and the player is handed back the way it was found: unmuted, rate 1 | what the element reads after the disarm |
| 16 | the deck painted **one fader per stem** — six `[data-stem]` strips, six `role="slider"` faders, each a stem the unit declares | the painted order and `STEMS` |
| 17 | the `AudioContext` the engine opened for the capture is at **44100**, not the platform default | `STATE.boot.sampleRate`, over how many snapshots |
| 18 | the whole run stayed on the box: every request either session made was local | the request count, any off-box URL, the schemes seen |

**Assertions 4–7 and 14 are the ones `assertHost` structurally cannot make.**
`VENDORING.md`: *"`assertHost` cannot check for a message nobody sent."* A Host
can implement all 32 duties and originate none of them; the deck then sits there
with a dead surface and every other gate in this repository stays green. They are
asserted individually, by name, so a red says which message went missing.

**Assertion 17 is not cosmetic.** The spike measured it: a *default* host
`AudioContext` opens at 48000 and inserts a resampler in the renderer, while the
captured track is 44100. `CONTRIBUTING.md`'s settled decision — one context at
44100, no JS resampling on the live path — survives into the desktop host **only
if the context is opened explicitly**. It is read off `STATE.boot`, which
`engine.js` fills in `ensureContext()` and not at boot, so it is only answerable
after a capture has been armed.

### What it does not re-assert, and where that claim lives

`transport.mjs` (63 assertions) and `deck-host.mjs` (27) were built first and go
deeper on the two halves. A second copy of one of their claims is a claim that
drifts.

| not here | it lives in | what this suite adds instead |
|---|---|---|
| **L1's static scan** of `src/preload/youtube.cjs` | `transport.mjs` — *"…and none of the names L1 forbids appears in it at all"*, **plus** *"…and the scanner is looking at code rather than at nothing"*, plus the complete member-write set and the enumerated property allow-list | assertion 9: the other end of the same rule — no media field on the feed the **deck** reads |
| the preload's five transport values, the event→speed-reason mapping, the ad edge, the key filter, the SPA navigation cases, the autoplay-next state machine | `transport.mjs` | only what the deck ends up **showing**: `__embed.videoPlaying`, `.jumps`, `.speed` |
| the fourteen `DeckHost` members, the two storage lifetimes, the arm chord, the height clamp, `page.close()` | `deck-host.mjs` and `deck-seam.mjs` | the arm gesture as a **menu click**, and the deck's painted faders |

**Two overlaps are kept on purpose**, and both are cited where they are asserted.
Assertions **12** and **15** (`drive`, `release`) also appear in
`deck-host.mjs`:271/:280 and in `transport.mjs` — kept because here they are the
end of a gesture chain that began at the application menu, in an app launched
with **no `--gate` flag**, so the product's module graph contains no
`tools/gate/*` at all. Assertion **13** is the only assertion anywhere that
crosses **all three** drive filters at once; each layer alone is gated
elsewhere, and mutation 16 measured what that costs (below).

### Three things measurement corrected in the specification

This section originally listed eleven assertions. Three of them described a
product that is not the one that got built, and they are recorded here rather
than quietly rewritten.

1. **"exactly one `BrowserWindow`"** — the app has a `BaseWindow` with three
   `WebContentsView`s *and* a hidden `BrowserWindow` for the engine
   (HOST-DESIGN.md §1.3). Assertion 1 names both, and the source view is proved
   attached by its `webContents` id appearing in the window's child list.
2. **"six stem faders in `STEMS` order"** — the deck paints them in its own
   `STEM_ORDER` (`vocals, drums, bass, other, guitar, piano`), which is not
   `STEMS` (`drums, bass, other, vocals, guitar, piano`). Assertion 16 therefore
   asserts *one fader per stem the unit declares* and reports the painted order
   in the detail. **Display order is the deck's decision and `vendor-unit` gates
   it**; a Host-side suite asserting it would be a second copy of a list.
3. **"the transport READS come back: `paused`, `currentTime`, `duration`"** — the
   preload's `sendState()` sends `playing`, not `paused`. Assertion 9 asserts the
   fields that exist, and adds the half worth more: that no media field is on
   that feed.

### Two messages are driven by the deck's envelope, not by the deck's decision

`CAPTURE_START` and `DECK_PREPARE` reach this Host as `SW_CAPTURE_START`
(`ui/embed.js`:693) and `SW_DECK_PREPARE` (:1053), and the deck sends them only
after `modelInTheWay()` / `maybePrepare()` clear — both of which require the
109 MiB weights to already be on disk. Gating the always-on step on a file that
is not in git would make it a `SKIP` on a clean checkout, and a `SKIP` is not
green.

So the suite sends those two envelopes itself, verbatim, through the deck page's
own `host.send` — and what is asserted is what the **Host** did with them. *When*
the deck decides to send them is the unit's decision and is gated by
`vendor-unit`. `SESSION` and `CAPTURE_STOP` need no such help: they come from the
menu items, clicked.

### Deliberately not asserted here

**Six stems actually coming out of the engine.** That needs the 109 MiB weights
and is a `heavy` step (`smoke-live`) that does not exist yet. Stated as a
coverage limit rather than left as an absence: *nothing in the default plan
proves the vendored engine produces audio inside this app.* `vendor-unit` proves
the engine is correct; `smoke` proves the Host wires it. The seam between those
two claims is not gated until `smoke-live` is written.

**The first few milliseconds of boot**, for the network guard. It is installed
from outside over CDP, as soon as `electron.launch()` resolves — during `boot()`,
but not provably before its first `loadURL`. `p1` (§9) is the suite that owns the
network claim from process start; this one owns "the run did not wander off the
box".

**The audio device.** This suite proves a capture opens and that the context is
at 44100. It does not witness the speakers. `capture-mute` (§8) is the one that
measures silence and **this suite cannot replace it**.

**Any single drive filter on its own** — see the note on mutation 16 below.

### Watched red

`tools/suites/smoke-mutations.sh`, 19 cases, each declaring the assertion names
it must turn red, with `tools/suites/coverage.py` over the whole battery refusing
an assertion that has never been seen on a FAIL line. **Measured 2026-08-26 on
the commit that introduced the suite: 19 of 19 caught, all 18 assertions seen
red.** Fifteen cases turn exactly one assertion red; the wide ones are 4 (six —
the deck never boots at all), 7 (three) and 1, 5, 11 (two each).

Three things about running it, and each is something a previous wave paid for:

- **A scratch git worktree.** It edits `src/`, `vendor/` and the suite itself,
  and a sibling working in the same tree would see the edits.
  `git worktree add --detach "$WT" HEAD`, then symlink `node_modules` and
  `models` into it.
- **The mutex is taken ONCE, on fd 9, for the whole battery** — not once per
  case. Three agents share this box; nineteen separate acquisitions interleave
  with a sibling's own battery and turn 13 minutes into an hour. The suite is
  told with `STEM_WORKBENCH_BROWSER_LOCK_HELD=1` so it does not deadlock trying
  to take a lock its own parent holds.
- **Backups go under `out/smoke-mutations/`**, this battery's own directory, and
  a `trap` on INT/TERM/HUP restores the case in flight and exits 130. A battery
  killed between the edit and the restore leaves a mutation standing on a
  shipped file.

| # | mutation | file | assertion |
|---|---|---|---|
| 1 | never `addChildView` the source view | `src/main/main.js` | 1 |
| 2 | guard only our session, leave `persist:youtube` unwatched | `tools/suites/smoke.mjs` | 2 |
| 3 | open one hidden window on an off-box URL after boot | `src/main/main.js` | 18 |
| 4 | delete the `armShortcut` duty from the deck's Host | `vendor/…/ui/host.js` | 3 |
| 5 | stop exporting `clearModel` from the engine's Host | `vendor/…/offscreen/host.js` | 3 |
| 6 | `sendSession()` originates nothing | `src/main/deck-host.js` | 4 |
| 7 | `captureStart()` mints the token and originates nothing | `src/main/engine-messages.js` | 5 |
| 8 | put a `tabId` back on `CAPTURE_START.source` | `src/main/engine-messages.js` | 6 |
| 9 | `deckPrepare()` originates nothing | `src/main/engine-messages.js` | 7 |
| 10 | `captureStop()` originates nothing | `src/main/engine-messages.js` | 14 |
| 11 | do not relay the player's state | `src/main/deck-host.js` | 8 |
| 12 | relay it with a media URL added | `src/main/deck-host.js` | 9 |
| 13 | do not relay the content jump | `src/main/deck-host.js` | 10 |
| 14 | do not relay the speed report | `src/main/deck-host.js` | 11 |
| 15 | `transport.drive()` becomes a no-op | `src/main/transport.js` | 12 |
| 16 | open **all three** drive filters at once | `vendor/…/ui/host.js`, `src/main/drive.js`, `src/preload/youtube.cjs` | 13 |
| 17 | disarm stops handing the player back | `src/main/deck-host.js` | 15 |
| 18 | drop a stem from the deck's strip order | `vendor/…/ui/embed.js` | 16 |
| 19 | open the `AudioContext` at the platform default | `vendor/…/offscreen/engine.js` | 17 |

There is **no case for L1's static scan**, and that is not an omission: the scan
is `transport.mjs`'s and is falsified by that suite's battery. Case 12 is what
turns this suite's L1 claim red.

**Two cases found a defect in an assertion rather than in the app**, which is
what a battery is for, and the two were fixed in opposite directions.

**14** left assertion 11 **green** on its first run. That assertion read only
`__embed.speed` — and `onElementRate()` in `ui/embed.js` is *one entry point for
a fact that arrives on two messages*, the video state's `playbackRate` (`:852`)
and the speed report's `applied` (`:1629`), so the deck's readout follows the
element whether or not the Host's verdict ever arrives. An estimator that
saturates before the claim begins. Widening the mutation to silence both feeds
would have hidden that: a mutation that has to break two things to be seen is a
mutation telling you the assertion is about neither. So the **assertion** was
fixed instead — it now reads the `{t:'speed'}` report off the deck's own inbound
channel — and the one-file mutation turns it red. (The *yield* case proper — a
claim held **and** somebody else moving the rate, `speed.js`:280 — is
`transport.mjs`'s and is not repeated here. With no claim held the plan is
`{act:'idle', state:'ok', want:null}`, which is what assertion 11's `want ===
null` conjunct records.)

**16** left assertion 13 **green** when only `filterDrive()` was opened — the
obvious single-file mutation, and the one this section originally specified —
because `driveVideo()` in the preload reads three *named* fields off the command
and never the command itself. Here widening the **mutation** is the right answer,
because the claim really is about the three filters composing: the write set is
closed in three places and this suite can only see it fail when all three open.
The layer-by-layer claims belong to `deck-seam` and `transport`, and that is now
written down rather than assumed.

**Four cases edit `vendor/`, and that is not a licence to patch it.** ADR 0001:
the unit is vendored, not forked. Each mutation is applied, measured and restored
inside one case, and the battery re-compares the restored bytes — so "restored"
is a checked fact rather than an intention.

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

1. Take the **sink lock** (§4: `sink` suites take it first, on top), then the
   **browser mutex**. Both are held by a child sitting on its stdin for the life
   of the suite, because Node has no `flock(2)`; the mutex covers BOTH launches,
   so the recorder is never left running through somebody else's queue.
2. Create an isolated `support.null-audio-sink` — **your own name**,
   `stem_workbench_gate`, never `harness_sink` (the machine's session default)
   and never the spike's `stem_workbench_spike`. Destroy it on the way out.
3. **Run the CONTROL first** (assertion 10). If the meter cannot hear a variant
   (d) process, nothing measured afterwards is evidence of silence, and finding
   that out before spending the app's run is free.
4. **Start `pw-record` on the sink's monitor BEFORE Electron launches, and stop
   it AFTER Electron exits.** This is the single correction that makes the gate
   mean what it says. A capture-window-scoped meter structurally cannot see the
   **1.90 s of full-level audio at peak 0.499893** that variant (a) leaks between
   `+0.60 s` and `+2.50 s`, before the capture opens at `+2.48 s`. The spike's own
   meter read `0.0` for that leak in three recorded runs — and `0.0199`, **39× over
   its own ceiling**, in a fourth where `pw-record` happened to start earlier.
   The recorder is *waited for* rather than slept past, and the lead and tail are
   both reported (observed: up ~50 ms before the launch, stopped ~400 ms after
   the exit).
5. Launch the app under `xvfb-run -a`, with `PULSE_SINK` and `PIPEWIRE_NODE`
   pointed at the gate sink. **The probe plays the source and only then opens the
   capture**, with `PRE_CAPTURE_MS` (1.5 s) in between — variant (a)'s leak
   window, deliberately reproduced, because an app that armed first would never
   produce the thing the gate exists to catch.
6. Sample `spike/harness/bin/pwlinks.py <sink> --pid <the Electron process tree> --json`
   **inside** the window — three times, at +0, +1.3 and +2.6 s of a 4 s window.
   The window announces itself by the probe touching `out/capture-mute/window.open`
   rather than being guessed with a `sleep`. Chromium puts audio output in its own
   utility process, so the app is never one pid: the tree is walked out of `/proc`
   at each sample, and the browser pid the probe reported must be in it.
7. Score after the app exits, then destroy the sink and drop both locks.

**The suite may not hang.** It holds two machine-global locks, so a sibling
queued on the browser mutex waits exactly as long as it does. Every subprocess
has its own timeout and the suite has a last one on top — armed only once BOTH
locks are held, so a long queue is never reported as a hang. That deadline is not
hypothetical: the first mutation run that truncated a recording left `pw-record`
dead before the app exited, the suite waited for a `close` event that had already
fired, and it sat on both locks until it was killed by hand.

### The capture-side instrument is not shipped

The RMS worklet measuring the captured stream is **test code**, not product code.
It is `tools/fixture/rms-worklet.js`, lifted from `spike/host.html`, and it
reaches `ctx.destination` through a gain of **exactly 0**: connected, because
Chromium only pulls nodes that reach the destination and an unconnected worklet
reports 0 forever — a zero meaning "not measured" — and inaudible, because the
question is whether the *original* leaks and the speaker meter cannot tell an
original from a replay.

**The capture it measures is the product's own.** `tools/gate/capture-mute.mjs`
mints a claim the way `engineMessages.captureStart()` mints one and hands it to
the SHIPPING `vendor/…/offscreen/host.js: captureStream(token)` — the real claim,
the real `setDisplayMediaRequestHandler`, the real constraints. It never calls
`getDisplayMedia` itself. That distinction cost the `engine-host` battery a case
(its 8): a probe holding a *copy* of the Host's constraints stayed green while the
Host's own were broken.

What it does **not** exercise is the bus hop and the engine's own ring —
`CAPTURE_START` -> `engine.js` -> the SAB. That is `engine-host`'s, it needs the
109 MB of weights, and this gate must run on a box that has none.

**How the meter is loaded, and the one seam it opens.** A worklet module is
fetched under `script-src`, and this origin's CSP is `script-src 'self'
'wasm-unsafe-eval'` (`src/main/assets.js`), so a `blob:` module is **refused** —
measured, not assumed: *"Loading the script 'blob:app://workbench/…' violates …
script-src 'self' 'wasm-unsafe-eval'"*. `Page.setBypassCSP` over the debugger was
tried and does not reach an already-committed document. So `src/main/main.js`
mounts one extra `app://` root:

```js
if (GATE) ROOTS.push({ prefix: '/gate/', dir: path.join(APP_ROOT, 'tools', 'fixture') });
```

`--gate=DIR` is the same flag that decides whether `tools/gate/<probe>.mjs` is
imported at all, and `tools/` is not packaged. **That line is a seam, and
assertion 9 is what asserts it shut.**

**A guard is not the same claim as "out of reach", and the first version of this
only had the guard.** `GATE` was `val('gate', '')` — a command line and nothing
else — so a *shipped binary* still took both branches for anyone who passed
`--gate=/tmp/x --gate-probe=whatever`. The probe's name is user-supplied;
`path.basename()` stops traversal, so the module must already be on disk, but
*"a shipped app that executes a module named on its command line"* is a sentence
that should not be writable about a product whose whole claim is one named host
and no remote code. And once packaging lands, `tools/` is not in the bundle, so
that branch would fail confusingly rather than honestly.

So the flag is read **only in a development build**, and the conjunction is taken
once, at the definition, rather than repeated at each seam — which also covers
any third seam somebody adds later:

```js
const GATE = app.isPackaged ? '' : val('gate', '');
```

**Assertion 9 does not match that line as text.** `/app\.isPackaged/.test(line)`
would pass on a line that reads it and ignores it. The scan lifts the real
statement out of the real file and **evaluates** it twice — `isPackaged: true`,
requiring `''`; then `false`, requiring the flag's value back. The second half is
not ceremony: `const GATE = ''` would shut the seam by breaking the gate, and the
assertion says so rather than passing. **Mutation case 13** deletes
`app.isPackaged` from the definition and this is the only thing that goes red;
the guard-counting half stays green at 2/2, which is precisely the point.

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
9. **The test seam is shut.** A scan of the app's own source, comments stripped,
   naming the number of files scanned and the electron-builder configuration by
   status. The product opens exactly **two** doors for its own gate and both are
   `--gate=DIR`: the `/gate/` root above, and the dynamic `import()` of the probe.
   So: the string `tools` appears in `src/**` **exactly twice**, both in
   `src/main/main.js`, and **both under an `if (GATE)`** — the first matched by
   shape (`if (GATE) ROOTS.push(`), the second by sitting inside the `if (GATE) {`
   block. Neither `rms-worklet` nor any gate environment variable appears anywhere
   in `src/**`.

   **And the guard is out of a user's reach, not merely present.** The `const
   GATE` statement is lifted out of `src/main/main.js` and **evaluated** — not
   substring-matched — with `app.isPackaged` true and then false, requiring `''`
   (the flag ignored) and then the flag's value. A packaged build therefore
   cannot be talked into either seam by a command line. A definition that names
   anything other than `app` and `val`, or that does not terminate within six
   lines, is a **red naming the throw** rather than a silent pass: a statement
   this scan cannot read is one nobody is checking.

   The scan matches a quoted bare segment (`'tools'`, which is how `path.join`
   spells a path) and the three test directories by name — **not** the word
   `tools` in a sentence. That is not fastidiousness: `src/main/speed.js` tells the
   user to run `bash tools/vendor-unit.sh` in a runtime error message, and the
   first version of this assertion went red on that English. The rule was narrowed;
   the message was not reworded.

   **There is no electron-builder configuration yet.** The scan says so in its
   detail on every run rather than passing silently over an absent file.

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

### What a green run reads

Recorded so a drift is visible as a number rather than as a feeling. Electron
44.0.0 / Chromium 152.0.7977.54, Linux 6.17, `xvfb-run`, sink
`stem_workbench_gate`:

| | |
|---|---|
| `capturedRms` | **0.350831** — band `[0.30, 0.40]`, analytic 0.353553, peak 0.500004 |
| the series | `0.348798, 0.365593, 0.374062, 0.369202, …` — flat, no AGC decay |
| the window | **1496** quanta, 1496 with channels, 382 976 samples, worklet rate 48 000, 3.989 s |
| `getSettings()` | `channelCount 2 · sampleRate 44100 · autoGainControl false · echoCancellation false · noiseSuppression false` |
| `deviceId` | `web-contents-media-stream://5:1?local_echo=false` — the bonus observable, asserted by nothing |
| `speakerRms` | **0.0**, peak **0.0**, over 7.360 s / 353 280 frames — recorder up 49 ms before the launch, stopped 402 ms after the exit |
| the node witness | `stem-workbench#<pid> target=stem_workbench_gate running/active`, in **3/3** in-window samples |
| exclusivity | 0 foreign writers, `pwlinks --pid` exit `0,0,0`; `flock -n` refused for us 3/3 |
| the control (d) | `speakerRms` **0.255229**, peak 0.500004 over 11.189 s; its own capture read 0.350852 |
| `isCurrentlyAudible()` | **true** — reported every run, asserted on by nothing |

The control reads 0.255 rather than the spike's 0.344–0.348 for a stated reason:
it is averaged over the whole process lifetime, boot included, not over a window
placed on the tone. The discrimination that carries the claim is **0.255 against
0.0**, and it is that gap — not the threshold — that is doing the work.

### Known weaknesses of this gate, stated

- **`SILENCE_CEILING` (0.0005) has never been exercised.** Every silent reading
  ever taken here is bit-exactly `0.0` with peak `0.0`, so the ceiling could be
  any positive number. Record `speakerPeak` alongside the RMS.
- **The window is 4 s.** A leak shorter than that is averaged down. The 1.90 s
  variant-(a) leak is precisely a short leak, and it is caught by assertion 5's
  whole-lifetime recording rather than by the window.
- **No macOS, no audio hardware.** Silence here has never been *heard*. See §11.

### Watched red

`tools/suites/capture-mute-mutations.sh`. It runs the suite **unmutated first and
requires green** — a mutation runner that is red before it mutates has proved
nothing — then, per case, applies the edit, refuses to continue if the anchor has
moved, runs the suite, requires the named assertions on `FAIL` lines, restores the
file and checks the restored bytes. It also fails a case whose run **SKIPPED**: a
box that lost its audio daemon mid-battery proves nothing, and a skip is not a red.

It takes the **sink lock and then the browser mutex** for its whole run, by
re-execing itself under both, because it holds a mutation on a shipped file for
the length of a launch and a sibling launching into the middle of one would be
testing mutated product code without knowing it. It restores on `SIGINT`/`SIGTERM`
from a `<case>.bak` + `<case>.from` pair per file — a killed battery once left
`--variant=b` standing in the suite, and the next run's baseline went red for a
reason that had nothing to do with the code.

Every row was **run**, on 2026-08-26, Electron 44.0.0 / Chromium 152.0.7977.54 on
Linux. A clean baseline reads `capturedRms 0.350831` over `1496` quanta with the
device at bit-exact `0.0`. The "red" column is what actually failed.

| # | mutation | file | red |
|---|---|---|---|
| 1 | remove `setAudioMuted(true)` before the first load — **variant (a)** | `src/main/youtube.js` | 1, 5 |
| 2 | **the Limitation-6 run**: ask for `audio: true`, and neuter `CAPTURE_MUST_BE` so the settings themselves are what fails | `vendor/…/offscreen/host.js` | 2, and all five of 4 |
| 3b | ask for echo cancellation and noise suppression, guard neutered | `vendor/…/offscreen/host.js` | 2, and four of 4 |
| 4 | route the app to a **decoy sink** while the meter stays on the real one | `tools/suites/capture-mute.mjs` | **7 only** |
| 5 | a PATH shim truncating **only the app's** recording to 0.2 s | *(no edit)* | 5, 6 |
| 6 | run the control with the mute **on** | `tools/suites/capture-mute.mjs` | 10 — and 5 and 6 print **VOID**, not green |
| 7 | serve `/gate/` unconditionally — the test seam left open | `src/main/main.js` | **9 only** |
| 8 | the probe writes no `report.json` | `tools/gate/capture-mute.mjs` | the launch assertion — and the suite **stops at 1 passed, 1 failed** rather than exiting 0 |
| 9 | the worklet stops counting quanta | `tools/fixture/rms-worklet.js` | 3, 2, 6 |
| 10 | shorten the window to 1 s | `tools/gate/capture-mute.mjs` | 3, 6 (and 7, 8 — the samples fall outside a 1 s window) |
| 11 | an unrelated process plays a 700 Hz tone into the measured sink | *(no edit)* | 8, 5 |
| 12 | point the lock witness at a lock file nobody holds | `tools/suites/capture-mute.mjs` | **8 only** |
| 13 | delete `app.isPackaged` from the definition of `GATE` — the guard stays, its reach does not | `src/main/main.js` | **9 only** — and 9's guard-counting half stays green at 2/2 |

**Case 1 is the case this whole gate was rewritten for.** With the mute gone the
source plays for `PRE_CAPTURE_MS` before the capture opens, the whole-lifetime
recording hears it, and assertion 5 goes red. A capture-window-scoped meter reads
`0.0` for exactly that leak — which is how the spike originally recorded variant
(a) as a PASS.

**Case 2 reproduced Limitation 6 to three decimal places.** Measured under it:
`rms 0.106369` (the write-up says 0.108), `channelCount 1`, `sampleRate 48000`,
all three processing flags `true`, and a per-quantum series decaying
`0.266 → 0.184` inside one 4 s window. A floor-only gate calls that a pass.

**Case 4 is the hypothesis assertion 7 exists to exclude, and its result must be
read carefully:** with the app on a decoy sink, **assertion 5 stays GREEN** —
`rms 0.000000`, a pass for the wrong reason — and the node witness is the only
thing that goes red (`0/3 in-window samples carried it`, `routed to
stem_workbench_gate_decoy, measuring stem_workbench_gate`). That is precisely how a
reviewer greened the spike's entire matrix.

**Case 10 is why assertion 3 is a COUNT.** A 1 s window still reads `0.35`, so the
level assertion stays green and only the count-grounded one goes red.

**There is no isolated mutation for `autoGainControl`, and that is a measured
platform fact rather than a gap.** Asking for `autoGainControl: true` **alone**,
with the Host's guard neutered, was run: the track still came back
`channelCount 2, sampleRate 44100, autoGainControl false`. Chromium ignores it for
a web-contents capture; it takes `echoCancellation` or `noiseSuppression` to move
the capture onto the processed path, and that path turns everything on at once. The
AGC assertion's red therefore comes from case 2, where it reads
`autoGainControl=true` next to mono/48000.

**"Kill the lock holder" is not a mutation that can exist here, and finding that
out was worth the run.** Written that way, case 12 was watched MISSING: an
`flock(2)` lock lives on the OPEN FILE DESCRIPTION and every descendant inherits
it across `fork`+`exec`, so with the battery holding the sink lock outermost the
whole process tree holds it and killing the `flock` process releases nothing —
all three in-window probes still read "somebody holds it". The same fact is why
`holdLock`'s `release()` closes its child's stdin **first** and only then signals
it. What case 12 falsifies instead is that the witness is a live probe of a real
lock rather than a constant: point it at a file nobody holds and both halves —
the per-sample `flock -n` and `sinkLock.alive()` — read false.

**Coverage is mechanical, not claimed by hand.** `tools/suites/coverage.py` runs
after a FULL battery and compares every assertion name in the baseline log against
every name that ever appeared on a `FAIL` line, exiting non-zero if any has never
been seen red. Current state: **13 of 13 mutations caught, 15 of 15 assertions
watched red.** A subset run cannot make that claim and does not try.

---

## 9. `p1` — the P1′ acceptance test

**File:** `tools/suites/p1.mjs`. **Flags:** `window` (and `openssl`; it SKIPs
without either). **19 assertions, 19 mutations, ~30 s plus the lock queue.**

**P1′**, successor to the extension's P1: *the app's own code talks to exactly one
named host — GitHub Releases, for the update check — and nothing else.* No
telemetry, no crash reporting, no fonts, no CDN. **The `persist:youtube`
partition is excluded**: that traffic is the user's browsing, and `PRIVACY.md`
says so.

### The instrument, and how you prove it is looking

`session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, …)` on **every
session the app creates**, recording
`{ label, owner, url, origin, scheme, method, resourceType, webContentsId, cancelled }`.

**The hard part is "every".** Electron has no API that enumerates sessions, so an
observer that lists the sessions it knows about is blind to the next partition
someone adds — and a session nobody observed reads exactly like a session that
made no requests. Closed at the source, in three parts:

1. Every session the app creates goes through one factory,
   `src/main/sessions.js: makeSession(label, partition)`, which installs the
   listener before it returns. The **owner** comes from a frozen table in
   `src/main/p1.js` and **a label that is not in it is refused**, so a new
   partition cannot be added without somebody writing down whose traffic it is.
2. The suite asserts, by scanning every `.js`/`.cjs` under `src/` with comments
   stripped and **naming all 28 files scanned**, that there is **no**
   `session.fromPartition(` and no `session.defaultSession` anywhere outside that
   factory. Same shape as the vendored `tools/unit-check.mjs`'s "no bare
   `chrome.*`" scan.
3. The suite asserts the factory installed a listener for each session it made —
   `created === listeners`, both `>= 2`.

**`onBeforeRequest` takes ONE listener per session, and a second registration
replaces the first silently.** That is not a footnote: `src/main/transport.js`
had its own, for L1's request witness, on the same partition. It now
*subscribes* through the factory. Two owners of that registration is an
instrument going blind with no symptom at all, on the one seam whose job is to
notice silence.

**Then prove the instrument sees a request that SHOULD be seen.** Four controls,
each with a known and different outcome:

| | what | must be observed | must be cancelled | must reach the fake host |
|---|---|---|---|---|
| **A** | the real update check, from the app's own code | yes, under `app` | no | **yes** |
| **B** | `Session.fetch` on `persist:youtube`, to a forbidden host | yes, under `youtube` | no | **yes** |
| **C** | **the same URL**, on the app's own session | yes, under `app` | **yes** | **no** |
| **D** | our own renderer fetching any off-origin URL | **no** — the CSP answers first | n/a | no |

**A local TLS server wearing `UPDATE_HOST`'s certificate** stands behind all of
it (`tools/p1-host.mjs`): a self-signed cert with SANs for both names, plus
`--host-resolver-rules=MAP <name> 127.0.0.1:<port>` and
`--ignore-certificate-errors` on the Electron command line. Nothing in `src/`
knows it exists, and **the URL under test is the shipping constant** — the app
asks for the real `UPDATE_URL` and Chromium routes it locally, so a re-point of
`UPDATE_HOST` moves the certificate with it instead of leaving the assertion
pointing at the old name.

**Its hit counter is the evidence the instrument did not produce.** It is in
another process, on the other side of the wire:

```
instrument silent + host hit      -> the observer is blind.            RED
instrument saw it + host hit      -> the request really went out.
instrument saw it + host NOT hit  -> the policy really cancelled it.
```

**B and C are the same URL through two sessions with opposite verdicts**, and
that pairing is the whole of what makes the exclusion testable without YouTube:
written as a URL substring instead of a session owner, B still passes and C
stops failing.

**Control D is reported as a `securitypolicyviolation` EVENT, not as a rejected
promise.** Chromium says `TypeError: Failed to fetch` for a CSP refusal, a DNS
failure and a cancelled request alike, so the message cannot say which layer
answered. The directive can: `connect-src`.

> **A measurement that changed the design of this suite.** The first draft issued
> control B from the source view's *page*. It never reached the network stack:
> `tools/fixture/player.html` carries `default-src 'none'` in its own markup, on
> purpose — "the fixture cannot reach the network even by accident" is what makes
> `transport`'s L1 request witness mean anything. The instrument correctly saw
> nothing, which is the one outcome a control must not have. `docs/TESTING.md`
> §9's original wording asked for a renderer-issued control; the claim it was
> after — *does the observer cover renderers at all* — is now its own assertion,
> made off the rows Chromium attributes to a `webContents`: **47 of 49 app rows
> and the source view's own navigation**, including 38 rows of the vendored
> unit's assets.

### What it asserts

| # | assertion |
|---|---|
| 1 | `mayRequest('app', …)` admits `UPDATE_HOST` over https — three URLs |
| 2 | ...and refuses every other network URL: nine, including `endsWith`/`includes` host traps, a userinfo `@`, an http downgrade and a `wss:` |
| 3 | ...and does not bind `app:`, `blob:`, `data:`, `devtools:`, `file:` or an unparseable URL — P1′ is about the network, and breaking the app protects nobody |
| 4 | ...and refuses **nothing** on a user-owned session: the exclusion is by OWNER |
| 5 | no file but `src/main/sessions.js` names a session at all — 28 files, comments stripped, every one named in the detail |
| 6 | `api.github.com` is spelled in exactly one file under `src/`, and the suite imports it |
| 7 | `crashReporter` is never started and `crashDumps` never asked for — same scan |
| 8 | the update request carries no identifier: no machine id, no install id, no UA override, one `accept` header |
| 9 | the app's own `.html`/`.css` reference no external origin |
| 10 | the app launches from its real entry point and writes a report |
| 11 | `created === listeners >= 2`, and the two sessions are distinct objects with distinct storage paths |
| 12 | **over a full session** — boot, the vendored deck and engine, the source view playing, the transport driven, the 109 MB model read through the Host — the app's own sessions reached exactly `{ https://api.github.com }`. A cancelled request still counts as the app *asking*, and the failure names each violation with its initiator |
| 13 | ...and that set is **non-empty**. A "no request except X" assertion over zero observations passes by not looking — the runner's `[1-9]` VOID rule, one level in |
| 14 | **the could-it-look guard**: the instrument saw the update request **and** the fake host recorded the hit |
| 15 | ...and the check really completed: the app parsed a `tag_name` only that server could have sent |
| 16 | **the same URL, two sessions, opposite verdicts** (controls B and C) |
| 17 | ...and the fake host was reached exactly once for it — the cancellation is a fact about the wire, not about a log line |
| 18 | the observer covers renderer-initiated traffic on **both** sessions, not just what main asks for |
| 19 | our renderer cannot reach an off-origin URL at all: the instrument sees nothing **and** the page reports a `connect-src` violation |

### Deliberately not asserted here

- **The real GitHub.** The check is pointed at a local server. A gate that needs
  the internet is a gate that goes red for somebody else's reasons.
- **The update download.** There is no downloader. `PRIVACY.md` says the download
  follows GitHub's redirect to its asset host; when that lands it is a second
  origin and this suite grows an assertion, not a tolerance.
- **Real YouTube traffic.** The source view loads the local fixture; the
  `youtube`-labelled control is synthetic on purpose, because the claim is about
  the LABEL.
- **What Chromium put on the wire.** That the request carries no installation
  identifier is asserted by reading the two lines that build it (#8), not by
  parsing bytes: what is not there cannot be observed arriving.

### Watched red

19 cases in `tools/suites/p1-mutations.sh`, one per assertion, with
`tools/suites/coverage.py` refusing any assertion never seen on a `FAIL` line.
Recorded run 2026-08-26, Electron 44.0.0 / Linux: **19 of 19 caught, 19 of 19
watched red.** The full table is at the top of `tools/suites/p1.mjs`; the four
worth knowing here:

| case | mutation | what went red |
|---|---|---|
| 14 | the observer stops recording `https:` — the wire is untouched | **the could-it-look guard**: instrument 0, fake host 1 |
| 17 | the policy is recorded and then not applied — the log still says `cancelled: true` | the fake host was reached twice |
| 16 | the exclusion moves from the session owner to a URL substring | the two-session pair, exactly as §9's original design predicted |
| 5 | `session.fromPartition` in `main.js` instead of the factory | the source scan — **and the boot throws**, because `onRequest('youtube')` has no such session |

### The lock queue is not in the stopwatch

This suite takes the shared browser mutex in a child that holds it until its
stdin closes, and times only the launch. Sibling agents share this machine and
the mutex can be held for minutes; folding that into the launch timeout makes the
suite report *"the app did not start"* about an app it never launched — a red
that costs an investigation to discover is not a bug. `STEM_WORKBENCH_LAUNCH_TIMEOUT_MS`
overrides the launch half.

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
- **`capture-mute` never runs in GitHub CI, so CI never checks the premise.** A
  hosted runner has no PipeWire daemon, no sink and no audio device, so the suite
  SKIPS there — honestly, with three lines under its own `SKIPPED` saying that
  nothing checked the property, and `tools/verify.mjs` refuses an unqualified
  GREEN over a plan containing a SKIP. The consequence is not softened by any of
  that: **a regression in the mute, or in Chromium's capture-scoped silencing,
  will pass CI.** It is caught only when somebody runs this suite on a Linux box
  with PipeWire — and on macOS, by nobody at all yet.
