# stem-workbench

The language of one product: a non-commercial Electron desktop app that takes
two **Sources** — a YouTube page it embeds and plays itself, and a file off your
disk — separates either into six stems on-device, mixes them back through a
**deck**, and writes the stems to disk. Single context — one `CONTEXT.md`, one
`docs/adr/`, both at the root.

**It does not work yet.** Nothing below describes shipped behaviour; it fixes
the words the design, the issues and the code are written in. Where a term names
something that exists today, this file says so.

## Where these words come from

Most of them are not ours. The engine and the deck are **vendored** out of
[`stem-splitter-live`](https://github.com/itziklerner-pag/stem-splitter-live) at
a pinned tag, and that repository's `CONTEXT.md` is where their vocabulary is
defined. **A glossary that disagrees with it is worse than no glossary**, so the
carried-over terms below are quoted verbatim, in blockquotes, with the source
named. Where this product's instance of a term differs from the extension's, the
difference is stated *after* the quote and the quote is left alone.

Two terms are ours alone — **Export** and **Bounce** — because the extension
deliberately has neither.

## Language

### Sources

**Source**:

> Where the audio the engine separates comes from.
> _Avoid_: input, feed, media, origin, stream (a `MediaStream` is a conduit, not a Source)
>
> — `stem-splitter-live/CONTEXT.md`, verbatim

**Live source**:

> A **Source** captured, as it plays, from a player the app does not own the
> bytes of — today a YouTube tab, through `chrome.tabCapture`.
> _Avoid_: tab source, capture source, stream source, YouTube source (YouTube is
> today's instance, not the kind)
>
> — `stem-splitter-live/CONTEXT.md`, verbatim

Everything before the em-dash is the definition and it is unedited. The clause
after it names the *other* product's only instance. **This product's instance is
the YouTube `WebContentsView`**, captured through `getDisplayMedia` answered by
`session.setDisplayMediaRequestHandler`, with `setAudioMuted(true)` on the view
(ADR 0001 decision 2; `docs/spike-capture-mute.md`). The kind is identical: a
player the app does not own the bytes of, captured as it plays.

**File source**:

> A **Source** the user handed the app as a file, so the whole signal exists
> before separation starts.
> _Avoid_: local source, offline source, upload, import
>
> — `stem-splitter-live/CONTEXT.md`, verbatim

The extension implements none. This product implements one — it is half of why
this product exists — and it is not built yet.

### Hosts

**Host**:

> The part of a product that wraps the **engine** and the **deck** and supplies
> what they cannot obtain themselves — a **Source**'s stream, a transport (play,
> pause, seek and rate on the player), storage, messaging, the shortcut, asset
> URLs, the model's bytes, and an inference **backend**.
> _Avoid_: platform, shell, wrapper, container, app
>
> — `stem-splitter-live/CONTEXT.md`, verbatim

**This repository is a Host and almost nothing else.** Everything in it that is
not the vendored copy, the harness or these documents is the desktop Host: the
Electron main process, the preloads, the window that draws the deck, and the two
**hole** modules.

**Unit**:

> The **engine** and the **deck** together, as the thing a second product copies:
> what `extension/unit.json` declares, `extension/unit.sha256` fixes byte for
> byte, and `node tools/verify.mjs --unit` runs. Not a synonym for the engine —
> the deck's markup and stylesheets are in it, and the two **Host** modules are
> not.
> _Avoid_: core, library, package, SDK, module (it is not published and is not
> one file)
>
> — `stem-splitter-live/CONTEXT.md`, verbatim

**"The second product" is this one.** Here the unit is 35 files copied at tag
`v0.2.0` and verified against `extension/unit.sha256`, and **it is never
edited** — ADR 0001 decision 4 in `stem-splitter-live` exists to prevent exactly
that, and `CONTRIBUTING.md` here states it as a rule with a check behind it. A
unit file that differs from its recorded SHA-256 is a fork, whatever the commit
message says.

**Hole**:

> A module the **unit** imports and a **Host** supplies —
> `extension/offscreen/host.js` for the `EngineHost`, `extension/ui/host.js` for
> the `DeckHost`. Exactly one per context, because `embed.html`'s
> `script-src 'self'` forbids an inline `boot(host)` and the deck's markup is part
> of the unit, so a static `import` from a sibling module is the only route a Host
> object has.
> _Avoid_: adapter, shim, plugin, injection point
>
> — `stem-splitter-live/CONTEXT.md`, verbatim

The two paths are the same here, because the layout is part of the contract
(`docs/VENDORING.md` §4). What sits at them is this Host's code, not the
extension's — that is the whole of what "vendoring" costs and buys.

**Duty**:

> One thing a **Host** owes the **unit**, named for what it is FOR rather than for
> its type. The duty tables in `extension/shared/host.js` are the list, the
> sentence beside each one is what `assertHost()` puts in the refusal, and a
> **Host** short a duty is refused at boot rather than at the user's gesture.
> _Avoid_: method, API, capability, hook (`hooks` is a different thing on
> `createBackend`, and it belongs to the unit)
>
> — `stem-splitter-live/CONTEXT.md`, verbatim

The five frozen tables name **thirty** duties — nine `EngineHost`, six
`DeckHost`, six `DeckPage`, six `DeckTransport`, three `Backend`. `DeckHost`
also has to answer for `page` and `transport` as **keys**, present even when the
value is `null`, which makes thirty-two things this Host has to say something
about. `transport: null` is a sentence somebody has to write; an absent key is
refused by `assertHostOption`, because a Host that meant to supply a transport
and misspelled the key would be read as a Host with no player at all.

**Backend**:

> What separates one segment of mix into six **stems** — waveforms in, waveforms
> out, with the STFT and the model graph inside it. A **duty** the **Host**
> supplies (`createBackend`); today the only implementation is the unit's own
> `extension/workers/workerbackend.js`, driving ONNX Runtime in a Worker.
> _Avoid_: model, engine (the **engine** is the whole pipeline), inference server,
> runtime
>
> — `stem-splitter-live/CONTEXT.md`, verbatim

The native backend this seam exists for — CoreML in an Electron utility process
— is not v1 and is not started (seed §16).

### This product's own two

**Export**:
The six untouched model outputs — drums, bass, other, vocals, guitar, piano, in
`STEMS` order — written to disk as 32-bit-float, 44.1 kHz, stereo WAV. What the
model produced, at unity, with nothing the **deck** did applied to it. Available
from every **Source** (seed §3 option C, §13 option E1; `docs/AUDIO.md` §4.5).
Not built yet.
_Avoid_: download, save, render, bounce (a **Bounce** is a different deliverable),
"the mix" (raw stems are never the mix), rip

**Bounce**:
What the deck is playing, rendered offline — faders, mute and solo, transpose
and speed baked in. **Not v1**: it needs an `OfflineAudioContext` path through
the playback worklet's DSP, which today runs only in real time (seed §13).
_Avoid_: export (they are different deliverables with different consumers),
mixdown, master, "the export with the faders on"

They are two words because they are two things with two consumers: a DAW wants
the raw stems at unity, a listener wants what they heard. Naming one after the
other is the mistake this pair exists to prevent.

**Arm**:
To point the one **deck** at a **Source** and open its capture, so that what the
Source plays reaches the **engine**. It is a gesture *and* a state: the state is
what `SESSION { session: { armed, title, url, armedAt } }` carries, and the
**Host** originates that message — the unit cannot.
_Avoid_: connect, start, enable, activate, "turn on", "load a track"

Arming is the same idea here and a different mechanism. In the extension only a
browser-level invocation on the tab can mint a `tabCapture` grant, so arming is
a toolbar click or `Ctrl+Shift+9` and the deck reads that chord from
`armShortcut()`. This Host has no command table and no per-tab grant: it answers
its own display-media request, and `armShortcut()` returning `null` is the
honest answer. **The consequence is a string in the unit** — `ui/embed.js`
prints *"Click the Stem Splitter Live toolbar icon on this tab to arm it"* when
nothing is armed — which is true of a browser extension and of nothing else.
`docs/VENDORING.md` names it as one a copy patches; **this product does not
patch it**, because `ui/embed.js` is a unit file and is in `unit.sha256`, so
patching it would turn our own vendor-integrity check red and the fix for a red
gate is never to stop running it. v0 ships the sentence, half true — the Host
answers `armShortcut()` with a real menu chord, so the deck prints the chord
beside the toolbar sentence and the half the user can act on is the half that is
true (`docs/HOST-DESIGN.md` §8.3).

**The two gestures a user of THIS product has** are `Source → Arm this Source`
with `Ctrl+Shift+A` (`Command+Shift+A` on macOS), and the **Arm button in the
chrome bar** — `HOST-DESIGN.md` §6.4's "first thing the owner touches", because
a desktop app has no toolbar icon to click. That button shipped `disabled` for a
wave after arming worked, with `shell` asserting the attribute that made it dead;
both gestures are live and both are gated by `smoke` now.

**Capture claim**:
What a **`sourceToken`** IS in this product: a one-shot, expiring permission to
open exactly one capture, minted by `main` in the **arm** path and spent by the
**engine** before it asks the platform for anything. `shared/host.js` says the
token is opaque to the **unit** — the Host mints it and the engine only carries
it back — and this is what fills that hole. It exists because the extension gets
the property for free and this Host does not: there
`chrome.tabCapture.getMediaStreamId` returns something `getUserMedia` consumes
directly, so the Host *cannot* capture anything the grant does not name, while
`getDisplayMedia` carries no token at all and the grant is a decision `main`
makes at request time. The claim is that correlation, and the correlation is the
security property: **the engine cannot capture anything `main` did not arm.**
A claim is refused when it was never minted, when it has already been spent,
when it is older than its ten seconds, or when the gesture it belonged to has
ended — `CAPTURE_STOP` revokes every live claim for that last reason.
_Avoid_: token (alone — say *capture claim* or `sourceToken`), stream id, grant
(the **grant** is what `setDisplayMediaRequestHandler` answers with; the claim is
what permits it to answer at all), permission (that is Chromium's own layer, and
it is a separate, earlier refusal)

**The view**:
The `WebContentsView` that loads youtube.com. It is where the **Live source**
plays, it is muted, and it is the thing the capture handler is pointed at.
_Avoid_: the tab (there are none), the iframe (it is not one), the webview
(`<webview>` is a different Electron mechanism the docs discourage), the browser

**The player window**:
The whole host window — a `BaseWindow` holding three child views with disjoint
bounds: the **chrome view** (the arm control and the source bar), **the view**,
and the **deck** beneath it. No address bar and no tabs. It is a shape decision
(ADR 0001 decision 3), not a layout preference, and *beneath* is layout rather
than z-order.
_Avoid_: the main window (`main` names an Electron **process**, not a window),
the shell, the browser window (`BrowserWindow` is a different Electron class,
and the one this deliberately is not)

### Fixed elsewhere

Where those documents define a term, their definition wins; this file points and
does not restate. They live in `stem-splitter-live` **at the tag this product
vendors, `v0.2.0`** — not on its `main`, which moves.

- **Stem** — the six-stem set, its wire order (`STEMS`) and its display order:
  `docs/SIX-STEM-CONTRACT.md`.
- **Engine**, **deck**, **passthrough**, the capture ring: `docs/ARCHITECTURE.md`
  §0–§1, §3, §5. **Engine** is that document's whole offscreen audio pipeline;
  the files in `extension/engine/` are its DSP modules — "engine modules", §6.
  See *Flagged ambiguities* for what "offscreen" means under a Host with no
  offscreen document.
- **Hop** (`H`), left/right context, crossfade, the live presets, **lane**, the
  latency budget: `docs/AUDIO.md` §2.2–§2.3, §1.6, §7.
- **L1**, **M1**: `CONTRIBUTING.md` here restates both, unchanged in what they
  forbid. **P1** does not carry over as written; its successor is **P1′**, and
  `CONTRIBUTING.md` and `PRIVACY.md` here are where it is stated.

## Relationships

- A **Source** is exactly one of **Live source** or **File source**.
- The **engine** is **Source**-agnostic: a Source decides *when* audio arrives,
  never what the engine does with it. That sentence is the reason one engine can
  serve both of this product's Sources and the extension's one.
- A **Live source** arrives in real time, as the player plays. The **deck**
  therefore runs behind the picture — about 3.4 s at the default **hop**.
- Anything derived from a **Live source** — a stem, a cache, an **Export** — is
  bound by real time: the player has to play through. **A live Export is a
  recording**, with a contiguity rule attached (seed §13).
- A **File source** is available whole, up front, so separation runs at engine
  speed rather than playback speed, and seeking is free.
- **L1 admits one Source per product and this product's is not the extension's.**
  What L1 forbids is unchanged — never resolve, fetch or parse a media stream
  URL — and the instance is different: capture is `getDisplayMedia`, answered by
  this Host, on a view this app embeds. The view's preload reads
  `paused` / `currentTime` / `duration` and writes `muted` / `currentTime` /
  `playbackRate`, and that is the whole of what it may touch.
- **This product Exports and the extension does not.** That single difference is
  why it is a separate product with its own repository, its own documents and its
  own risk (`stem-splitter-live/docs/adr/0001`).
- There is exactly one **Host** per product: the extension host there, the
  desktop Host here. The **engine** and the **deck** must not know which one they
  run under, and neither of them has a branch that asks.
- A **Source** is always obtained through the **Host**.
- The **unit** reaches its Host only through the two **holes**, and asks of it
  only what a **duty** names.
- **Not everything a Host owes is a duty**, and the four that are not are the
  four easiest to miss: the messages the Host must ORIGINATE (`CAPTURE_START`,
  `CAPTURE_STOP`, `DECK_PREPARE` to the engine; `SESSION`, and `ARM_ERROR` /
  `ARM_ERROR_CLEARED` if the product can refuse to arm, to the deck); the
  `prefs.autoplayNext` key the Host must watch, or the deck ships a dead
  checkbox; the one English sentence in `ui/embed.js` a copy has to patch; and
  cross-origin isolation, because the engine builds `SharedArrayBuffer`s
  directly and asserts on the constructor. `assertHost()` cannot check any of
  them. `docs/VENDORING.md` lists them; `docs/ARCHITECTURE.md` here says how this
  Host discharges each.
- **The model's identity belongs to the unit; its bytes belong to the Host.**
  The SHA-256 and the byte count are in the unit's `shared/config.js` and are
  checked on every load over whatever the Host hands over. This Host hands over a
  file bundled in the installer (ADR 0001 decision 5). A Host that verified would
  be a Host that could decline to.

## Example dialogue

> **Dev:** "Can I add an *Export* button to the deck for the YouTube source and
> have it run at engine speed like the file one?"
> **Domain expert:** "No — and the two halves of that fail differently. YouTube
> is a **Live source**, so anything derived from it is bound by real time: the
> player has to play through. A live **Export** is a *recording*, not a render.
> The **File source** is the one that runs at engine speed, because the whole
> signal is on disk before separation starts."
> **Dev:** "Fine — then it records. Same button?"
> **Domain expert:** "Same word, yes: **Export** is the six raw model outputs at
> unity, 32-bit float, from every Source. But the live one carries a contiguity
> rule the file one does not — one contiguous pass from where you started, a
> seek ends it, and autoplay-next has to be suspended while it runs or the next
> video records into the same file."
> **Dev:** "And if I want it to sound like what I hear — vocals down, +2
> semitones?"
> **Domain expert:** "That is a **Bounce**, and it is not v1. Never call it an
> Export, and never call raw stems the mix. They go to different people."

## Flagged ambiguities

- **"Offscreen" names a Chrome thing this product does not have.** The vendored
  `docs/ARCHITECTURE.md` labels the whole pipeline "THE ENGINE" and puts it in an
  MV3 *offscreen document*; the unit's own directory is still
  `extension/offscreen/`. There is no offscreen document in Electron and no
  `chrome.offscreen`. **Resolved:** "engine" keeps its meaning — the whole audio
  pipeline — and its container here is **the engine renderer**, a hidden window
  (`docs/HOST-DESIGN.md` §1.3), never "the offscreen document". The directory
  name is part of the vendored layout and is not ours to change
  (`docs/VENDORING.md` §4).
- **"Host" is now three words in one.** (1) The capital-H **Host** of this
  glossary — this product's half of the seam. (2) `DeckHost.page`, which is the
  *page the deck is drawn into*, and the bus address `BUS.host` (`'sw'`), which
  is *the Host's own privileged context* — under the extension the service
  worker, here the main process. (3) Electron's own "host", as in the host
  `BrowserWindow` versus the embedded view. **Resolved:** capital-H **Host** for
  the product's half; **the player window** or **the deck window** where an
  Electron window is meant; **the page** where `DeckHost.page` is meant.
- **`'export'` is already a mode in the vendored engine, and it is not
  Export.** `extension/offscreen/deck.js` documents `'export'` as the mode that
  *drains the ring destructively*, as against `'live'`, which reads it by
  absolute frame; it is the default `attach()` mode and `startLive()` flips it.
  That is a ring-reading discipline, not a deliverable. **Resolved:** capital-E
  **Export** is the product's deliverable; when the engine's mode is meant, say
  `'export'` mode, in code font, and mean the ring.
- **"Source" vs Demucs' "sources".** Carried over unchanged: Demucs calls the
  separated signals *sources* (`model.sources`, "six-source variant" in
  `NOTICE.md`). Here a **Source** is where audio comes *from*, and the separated
  signals are **stems**. Use "sources" only when quoting model metadata.
- **`source` in code** is the attached Live source's `{title, url}` — *which*
  Source is attached, not which *kind*. It lost its `tabId` at the Host interface
  v1 freeze precisely because a Host with no tabs had to invent one.
- **"Arm" has no chord here, and the deck says it does.** See **Arm** above: the
  not-armed hint in `ui/embed.js` is the extension's sentence, and this Host's
  honest `armShortcut() → null` does not stop the deck printing it. It is a known
  v1 limitation of the seam, named in `extension/shared/host.js` item 9, and it
  is cosmetic and visible on the first screenshot rather than silent.
- **"Beta", "pre-release" and "release" are not interchangeable, and nothing has
  been any of them.** Nothing is built, signed, notarized or published. See
  ADR 0001 decision 6 for what the words are reserved to mean and
  `docs/ARCHITECTURE.md` for what has actually been verified. **"Configured" is
  now a third word and it is not a fourth kind of build**: `package.json`'s
  `build` key and `.github/workflows/package.yml` exist and have never been run.
- **"It works" and "it keeps up" are two claims, and only the first is
  measured.** Six stems really do come out of the separator in this app; **six
  stems moving LIVE, while the video plays, has never been observed by anybody**
  — every machine this has run on drops every chunk. Do not let the two share a
  sentence. `docs/evidence/step3-youtube/README.md` §3.
