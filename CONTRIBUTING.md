# Contributing to stem-workbench

Thanks for looking. This file is the short version of how the project is built
and what gets a pull request merged or rejected.

**Read [`CONTEXT.md`](CONTEXT.md) first.** Most of the words in this repository
are defined in another one, and using them loosely is the cheapest way to make
a mess here.

> **State of the repository.** There is no application yet. What exists is one
> throwaway spike, its write-up, and these documents. Sections below that
> describe commands you cannot run yet say so.

---

## The four rules that override everything

A pull request that crosses one of these is rejected regardless of how well it
works. Three are inherited from `stem-splitter-live`; the fourth is this
repository's own, and it is the one most likely to be crossed by accident with
the best of intentions.

### L1 — Capture only what the user's own player renders

Audio comes from capturing a player this app embeds, and from files the user
handed us. **Never resolve, fetch, or parse a media stream URL.** No yt-dlp, no
innertube, no `/videoplayback`, no player-response scraping, no "just this once
to get the title".

The boundary is stated in terms of what the code does, because a preload script
in a YouTube page is exactly where a ripper would live:

- The YouTube view's preload reads `paused`, `currentTime`, `duration`, `ended`
  and `playbackRate`, with `seeking` arriving as an event. It writes `muted`,
  `currentTime` and `playbackRate` — **those three and nothing else**, filtered
  at the Host end and named at the unit's call site, at both ends deliberately.
- It never reads `src`, `currentSrc`, `buffered` or `srcObject`. It never calls
  `captureStream()`. It never touches a byte of media.
- The capture itself is `getDisplayMedia`, answered by the main process with the
  view's own frame. That is the same class of thing a screen recorder does.

**This product exports audio and the extension does not.** L1 is what keeps that
difference to *"it can write what it heard"* instead of *"it can fetch what you
were sent"*. The two are not the same and the code must not blur them.

### P1′ — The app's own code talks to exactly one host

GitHub Releases, for the update check. **Nothing else.** No telemetry, no
analytics, no crash reporting, no fonts, no CDN, no model download — the model
ships in the installer.

The YouTube view's traffic is the user's own browsing, on its own persistent
partition, and it is excluded from the rule *by name* rather than by silence.
[`PRIVACY.md`](PRIVACY.md) states both halves in the user's words.

**What this rule refuses, so nobody has to rediscover it.** The runtime
auto-updater is deliberately not armed. The app performs the update CHECK on this
one host and does not download or install anything, because electron-updater's
own code — read at 6.8.9, not assumed — needs `github.com` for its feed
(`out/providers/GitHubProvider.js:32`, NOT the `api.github.com` this rule names)
and `objects.githubusercontent.com` for the asset it redirects to, and it makes
its own `session.fromPartition("electron-updater")`
(`out/electronHttpExecutor.js:7`) — a session outside `src/main/sessions.js` and
therefore outside the observer, which the `src/`-only scan below would not catch
either. **Arming it means permitting those two hosts AND bringing that session
under the factory**, and both are the owner's decision, not a refactor.
`docs/ARCHITECTURE.md` §6 and [`docs/UPDATES.md`](docs/UPDATES.md) §2 carry the
full cost. There is deliberately no wired-and-cancelled path: dead code that
looks alive is worse than an absence somebody documented.

**It is an acceptance test, not a rule enforced by review**, ported from the
extension's P1 test: `node tools/verify.mjs --only p1` boots the real app behind
a local TLS server wearing the update host's certificate, drives a full session —
the vendored deck and engine, the source view playing, the transport, the 109 MB
model read through the Host — and asserts that the set of network origins the
app's own sessions reached is exactly `{ https://api.github.com }`.

Three things about it are worth knowing before you change anything near a session
or reach for a network call:

- **Every session the app creates goes through one factory**,
  `src/main/sessions.js`, and the suite scans every file under `src/` — comments
  stripped, all of them named — for a `session.fromPartition(` or a
  `session.defaultSession` anywhere else. Electron cannot enumerate its own
  sessions, so a session nobody observed reads exactly like a session that made
  no requests, and this is what stops those being the same picture.
- **`webRequest.onBeforeRequest` takes one listener per session and replaces it
  silently.** Subscribe through the factory; do not register a second one. That
  is not a style rule — it is how the instrument goes blind with no symptom.
- **THE MAIN PROCESS HAS NO NETWORK OF ITS OWN, and that is now enforced rather
  than requested.** `session.webRequest` is a property of a CHROMIUM session, so
  a `fetch()` or a `node:https.request()` in the main process is not merely
  unobserved — it is *unobservable*. Two independent audits proved it by adding
  one line to `src/main/main.js` and watching a real request reach a real host
  while `p1` printed `19 passed, 0 failed`. Three things closed it:

  1. `src/main/netguard.js` — imported FIRST by `main.js`, it removes `fetch`,
     `WebSocket`, `EventSource`, `XMLHttpRequest` and the `http`/`https`/`http2`/
     `net`/`tls`/`dgram` entry points from this process. A bare `fetch()` in main
     now THROWS at the line that wrote it. (A `net.Socket` to a PIPE still works;
     Node's own child-process IPC needs it, and the guard is asserted not to
     break it.)
  2. A source scan in `tools/suites/p1.mjs`: no `node:http`/`https`/`net`/`tls`/
     `dgram`/`http2` import anywhere under `src/`, and no bare `fetch(` or
     `net.request(` under `src/main/`. The app has exactly ONE network transport
     — `Session.fetch`, in `src/main/update.js` — and it is chosen for its
     observability, not its convenience.
  3. A dynamic control: the suite stands up a real HTTP sink on 127.0.0.1, hands
     the port to the launch, has the probe attempt eleven transports at it, and
     asserts that **the sink recorded exactly one connection and it was the
     suite's own**. Mutation 21 in `tools/suites/p1-mutations.sh` neuters the
     guard and the sink logs `GET /telemetry-from-main`, so the control can lose.

  **If you need to talk to a host, you do not.** If you genuinely do, it is a
  change to `PRIVACY.md`, to this rule, and to the assertion — in that order.

`docs/TESTING.md` §9 is the specification, the five controls and the 24
mutations.

### M1 — No remote code

ONNX Runtime and the model weights are bundled and hash-verified as **data**.
Never inject a script tag pointing at a CDN, never `eval` a downloaded payload,
never load a WASM binary from the network.

The model's SHA-256 and byte count live in the **unit**, and the unit checks
them on every load over whatever this Host hands it. A Host that verified would
be a Host that could decline to — so do not move that check to this side of the
seam, however convenient it looks.

### V1 — The vendored copy is not edited. Ever.

`vendor/stem-splitter-live/` is a copy of 35 unit files taken at a pinned tag
and verified against `extension/unit.sha256`. It is not a starting point, it is
not "ours now", and it is not a place to put a one-line fix.

**If the unit is wrong, that is a finding, not a patch:**

1. Open an issue **here** describing what the unit does wrong and what this Host
   needed instead.
2. Fix it in [`stem-splitter-live`](https://github.com/itziklerner-pag/stem-splitter-live),
   behind its own gates.
3. Cut a tag there, re-vendor here, and bump the pin.

A patched vendored copy is the failure mode the whole arrangement exists to
prevent: the moment one file diverges, an upstream fix stops arriving, and
nobody finds out until the two products behave differently in a way no test
covers.

**The check that says whether the rule held:**

```bash
bash tools/vendor-unit.sh --check      # step `vendor-intact`; offline, ~0.1 s
```

35 unit files byte-identical to the tag, plus the 15 other copied paths that
`unit.sha256` has never covered, plus a set comparison that sees a file somebody
**added** — which no checksum list can. **Any red means somebody edited the
copy** — or it is corrupt, and those two are worth telling apart before anything
else happens. It is a step on the default plan; `docs/TESTING.md` §10 has the
five assertions and the mutation that was watched red for each.

**The two exceptions, and they are not edits:**

- `extension/offscreen/host.js` and `extension/ui/host.js` are **holes**. They
  are supposed to be replaced wholesale with this Host's own modules; they are
  not in `unit.sha256` and never were.
- The reference-Host and harness files that travel alongside the unit
  (`content.js`, `speed.js`, `offscreen/host-pin.js`, the suites) are yours to
  re-aim, once you have read the upstream `docs/VENDORING.md` §6 and know what
  each read is for. Re-aiming a suite at your files is the intended move.
  Deleting a suite because it went red is not.

---

## Assertion discipline

**This is not optional, and it is not a style preference.**

- **Every assertion you add must be watched red by mutation.** Break the code,
  see the assertion fail, restore it, and **name the mutation** in the pull
  request. An assertion you did not watch fail is not evidence that anything
  works — it is evidence that something ran.
- **A suite that exits 0 while asserting nothing is a hard failure, not a pass.**
  The upstream runner enforces this and the local harness must too. The spike in
  this repository shipped that exact bug once and review caught it.
- **If a count can carry the claim, do not carry it with a stopwatch.** A gate
  whose verdict changes on code that did not change is measuring the machine.
- **An assertion about a function with more than one caller must name the entry
  point** it is asserting through.
- **Never write an assertion whose estimator saturates before the claim range
  begins.** The worked example is in this repository: the capture gate's first
  four assertions were individually satisfiable by a mono, AGC-crushed capture
  that was useless for stem separation, and the gate called it PASS.
  [`docs/spike-capture-mute.md`](docs/spike-capture-mute.md), Limitation 6.

The full rules, and a catalogue of the ways this project has already got them
wrong at real cost, are in **`AGENTS.md` in `stem-splitter-live`**:
<https://github.com/itziklerner-pag/stem-splitter-live/blob/v0.3.1/AGENTS.md>

**It applies here unchanged, and it is deliberately not copied into this
repository.** A copy would drift, and a drifted copy of a rulebook is worse than
a link — the link is pinned to the tag this product vendors, so it names a fixed
text rather than a moving one. Bump it when you bump the pin.

---

## Getting set up

```bash
git clone https://github.com/itziklerner-pag/stem-workbench
cd stem-workbench
npm install                 # Electron
npm start                   # the app shell — a window, and not much else yet
```

**On Linux, `npm start` will refuse to run before you do one thing.** Chromium's
setuid sandbox helper ships in `node_modules` without its permissions, and
Electron aborts rather than run unsandboxed:

```
FATAL:sandbox/linux/suid/client/setuid_sandbox_host.cc:166] The SUID sandbox
helper binary was found, but is not configured correctly.

sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

It is a property of an unpackaged `node_modules` tree, not of the app — a
packaged build installs the helper correctly. `ELECTRON_DISABLE_SANDBOX=1`
starts it too, **with the sandbox off**, which is the wrong trade for an app
whose whole job is to put somebody else's website in a window. `npm install`
replaces the file, so the two lines are needed again after one.

**Vendoring is one command**, and re-vendoring is the same one:

```bash
bash tools/vendor-unit.sh              # re-vendor the pinned tag, fetch ORT, run the unit's gate
bash tools/vendor-unit.sh --model      # ...and seed models/htdemucs_6s.onnx (109 MB, dev only)
bash tools/vendor-unit.sh --check      # offline: is vendor/ still what the pin says it is?
```

`vendor/.pin` is the pin — tag, expected step and assertion counts, the archive's
digest, and the `ours` manifest. Bumping the tag means passing `--tag` with
`--steps` and `--assertions` from that tag's own `VENDORING.md` §7; the script
refuses `--tag` alone, because deriving those numbers from the run it is about
to make would be the gate checking its own homework.

The procedure the script automates is the upstream one in
[`docs/VENDORING.md`](https://github.com/itziklerner-pag/stem-splitter-live/blob/v0.3.1/docs/VENDORING.md),
and its shape is fixed: fetch **the tag's** archive (never a branch — a copy
taken off `main` is a copy whose verification step is theatre), verify it
against `extension/unit.sha256`, derive the copy list from `extension/unit.json`
rather than from a list in a document, copy with the repo-relative layout
**preserved**, verify the copy, run `tools/fetch-vendor.sh` for ONNX Runtime,
then run the unit's own gate.

The layout is part of the contract, not a preference: `workerbackend.js` reaches
the inference worker with `new URL('./inference.worker.js', import.meta.url)`,
the suites import `../extension/...`, and `assetUrl('vendor/ort/')` resolves a
directory. A copy that flattens or renames a directory does not run, and most of
the ways it fails are late and quiet.

## Running the gates

**[`docs/TESTING.md`](docs/TESTING.md) is the authority** — the runner, the steps
table, what each suite asserts, which flags drop which steps, and the printing
convention every suite obeys. Read it before you write a suite. This section is
only the part that is a *contributing rule* rather than a testing detail.

```bash
node tools/verify.mjs                 # everything that needs no window
node tools/verify.mjs --quick         # ...minus anything that opens a window or takes the sink
node tools/verify.mjs --only <id>     # exactly one step
```

Two things about that run that are rules rather than conveniences:

**1. The vendored gate is a step of ours, never a second runner.** The step is
`vendor-unit`, and it runs the unit's own 12 suites over the exact tag we
pinned. Copying the upstream runner into this repository was the rejected
option: two runners drift where it is most expensive.

Before the holes are swapped, running it directly is worth doing once and
recording:

```bash
cd vendor/stem-splitter-live && node tools/verify.mjs --unit --no-reap
# GREEN (partial — the vendored unit's suites only; 12 of 23 steps)
# 12 of 12 PASS, 1327 assertions, ~71 s, Node 22+.
# No npm install, no browser, no GPU, no weights.
```

**`--no-reap` is not optional on a shared machine.** Upstream's `VENDORING.md`
§7 prints that command without it, and without it the runner opens by `pkill`ing
every Playwright Chromium on the box — a colleague's, and our own `shell` step
if they overlap. `--unit` launches no browser and has nothing to gain from it.

That green is a real result: it says the copy arrived intact and runs. Put it in
the vendoring commit.

**2. `group('host')` IS this Host's conformance suite, and the reds are the
work.** `test.js` is both the unit's largest DSP suite *and* a conformance suite:
122 of its assertions install a Chrome platform and check that the two hole
modules behave the way `shared/host.js` declares. Swap the holes for this Host's
modules — which you must; they are holes — and those 122 assertions become claims
about a platform that is not there.

Upstream offers three responses. **This product takes option 3: point the group
at our files** — step `conformance`, `node tools/verify.mjs --only conformance`.
They are where `assetUrl`'s trailing slash, `send`'s `undefined` return and
`storageGet`'s absent-versus-unreadable split get checked against a real
implementation instead of a stub, and all three are green.

**Pointed at our files, the group runs to its end and fails cleanly — **766
assertions, 747 passed, 19 failed** — every red named in `vendor/.conformance.json`
with the reason it does not apply to a desktop Host, and the set compared BOTH
ways: a red that vanishes fails the step as loudly as a red that appears, because
a red that stops being reported is usually an assertion that stopped running.
`docs/CONFORMANCE.md` is the argument, one red at a time.

The platform under the group — `tools/conformance-platform.mjs`, a Node
`--import` hook, and **not one vendored byte edited** — is what lets `test.js`
run at all under plain Node: it is the Host surface the assertions drive, not a
workaround. (It started as one: at v0.2.0 the group CRASHED without it,
`TypeError: listeners[0] is not a function`, an upstream defect that took 103
assertions with it. That is the sibling instrument check that shipped with
`stem-splitter-live#30`'s fix (v0.3.0) — a report that crashes is not one, so
the dereference is a named red — and this Host carries no copy of it.)

**Do not "fix" a red under `vendor/` by editing anything under `vendor/`.** See
rule V1. Every time.

---

## Every non-trivial change leaves one runnable check behind

The smallest thing that fails if the logic breaks. No frameworks, no fixtures,
no per-function suites. Host code especially: a duty that is only exercised by
the app being run by hand is a duty that will break silently, because the whole
point of `assertHost()` is that a Host short a duty fails at boot instead of at
the user's gesture.

If the change is in the audio path, it is almost certainly in the unit, and rule
V1 applies.

## Engineering bias

Fewest files, least tooling that works. No abstraction with one implementation.
No config for a value that never changes. Mark a deliberate shortcut with a
comment naming the ceiling and the upgrade path, so that simple reads as intent
rather than as ignorance.

## Documents

Every claim in this repository carries which of these it is, and a sentence that
does not is a bug in the document:

- **verified** — measured, here, with the evidence in the repository
- **configured but never built** — a file exists; nothing was compiled, signed
  or notarized on this machine
- **written down only** — a design, and nothing more

The distinction is defined in [`docs/ARCHITECTURE.md` §7](docs/ARCHITECTURE.md)
and it is the single most important editorial rule here, because this product's
release story spans platforms nobody working on it can test.

## Issues

Desktop work goes on **this** tracker; the extension's stays on its own. They
are deliberately separate — two products with two trust postures.

<https://github.com/itziklerner-pag/stem-workbench/issues>

Triage labels are `needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human` and `wontfix`. They already exist; do not invent near-miss
variants. `ready-for-agent` means fully specified with acceptance criteria — the
standard to match is [#3](https://github.com/itziklerner-pag/stem-workbench/issues/3).

## Commits

Conventional commits, lower-case imperative subject, no trailing period. The
body explains **why** — the diff already shows what.

## Licence

Contributions are MIT, matching the vendored unit so the two can share code
without a licence seam. **The MIT grant covers this repository's code and
nothing else** — in particular it grants nothing about the model weights, which
are CC BY-NC 4.0 and are the reason this product is non-commercial permanently.
Read [`NOTICE.md`](NOTICE.md); it is not boilerplate.
