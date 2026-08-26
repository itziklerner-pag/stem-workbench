# The conformance report

`group('host')` from the vendored `test.js`, pointed at **this** Host's two hole
modules, run to completion, and every assertion it does not pass justified in
writing.

**Gated by:** `node tools/verify.mjs --only conformance` — `tools/suites/conformance.mjs`.
**Pinned by:** [`vendor/.conformance.json`](../vendor/.conformance.json), which is the
machine-readable half of this document and is compared against the run **both
ways** on every gate.
**Tag:** `stem-splitter-live` `v0.2.0`.

---

## 1. What was measured, in order

`docs/VENDORING.md` §"`test.js`'s `group('host')` stays inside step `unit`"
offers three responses to the 122 conformance assertions in that group.
This repository takes **option 3 — point them at our files** — and this document
is what came of it. Option 1, the intermediate green, is recorded first because
it is the thing that says the copy arrived intact.

| | what was run | result |
|---|---|---|
| **BEFORE** — option 1 | `node tools/verify.mjs --unit --no-reap` in the vendored copy, with the **extension's** two hole modules in place | `GREEN (partial — the vendored unit's suites only; 12 of 23 steps)`, 12 of 12 PASS, **1156 assertions**. `vendor/.pin` pins those two numbers. Recorded in the vendoring commit `b8e476a`. |
| **AFTER the swap** — bare | the same command, with **this Host's** hole modules at the two paths | **RED, and worse than red: `test.js` CRASHES.** `TypeError: listeners[0] is not a function` at `test.js:5833`. 11 of 12 suites PASS; step `unit` reports `CRASHED after start`. **50** of `group('host')`'s 122 assertions run, 17 of them red; `group('verifyModel')` and `group('backend')` — **31 further assertions about the unit itself** — never start. 612 → 509 reported, **103 lost**. |
| **AFTER the swap** — option 3 | `node --import tools/conformance-platform.mjs test.js` in the vendored copy | **Complete. 612 assertions, 593 passed, 19 failed.** Every assertion in the file runs. Nothing under `vendor/` is edited; `vendor-intact` gates that byte for byte and runs first. |

**One red was fixed rather than justified.** `group('verifyModel')`'s scan —
*"NO FILE UNDER `extension/` NAMES THE MODEL'S UPSTREAM HOST EXCEPT
`extension/offscreen/host-pin.js` — that move is what took the network path out
of the unit"* — was red because a **comment** in our own
`extension/offscreen/host.js` mentioned the upstream host by name. The scan does
not strip comments, deliberately. The paragraph now describes the pin instead of
spelling it, and the assertion is green. It is a real result: the string is
absent from this Host because this Host has no download, which is the same
sentence P1′ makes.

## 2. Why the crash is not fixed here

`test.js`'s deck half installs a Chrome platform, calls `deckHost.onMessage(fn)`,
asserts `listeners.length === 1`, **correctly reports it RED** — and then calls
`listeners[0](...)` on the next line. Our DeckHost registered its inbox with an
Electron preload bridge that is not present in plain Node, so the array is empty
and the dereference throws.

**No Host that is not a Chrome extension can get past that line**, because the
only thing that fills the array is `chrome.runtime.onMessage.addListener`. It is
not a defect in this Host and it is not fixable from this side.

It is **not patched in the vendored copy** — `CONTRIBUTING.md` rule V1, and
`vendor-intact` would go red the moment it were. It is a **finding for the other
repository**, behind a later tag:

- **`stem-splitter-live#30`** (filed): a hole that throws while being *imported*
  should become a named red rather than an unhandled rejection.
- **A sibling of it, recorded here:** an INSTRUMENT CHECK that reports an absence
  and then dereferences the thing it just proved absent. `AGENTS.md`'s own
  vocabulary covers it — the check could not lose *and could not survive its own
  verdict*. `test.js:5828-5836`. The same shape appears again at
  `feedListeners[0]` in the storage section, guarded there by `if (feed)`, which
  is what the deck half's message section wants.

## 3. What gets past it, and what that costs

[`tools/conformance-platform.mjs`](../tools/conformance-platform.mjs) is a Node
`--import` hook that installs **this Host's own platform** under the group:
`window.__wbDeck`, `__wbEngine`, and a `location.origin` of `app://workbench`,
each backed by whatever `globalThis.chrome` the harness has installed at **call**
time. It is the same arrangement `tools/suites/deck-seam.mjs` already uses — "the
shipped hole module over a stubbed preload bridge" — with the far end pointed at
the harness instead of at a recorder of ours.

**The subject is the hole module. The double stands in for everything below it.**
So an assertion in this group whose subject is *below* the bridge is an assertion
about the double, and a green there is a property of the apparatus rather than of
this Host. Those are listed in `vendor/.conformance.json` under `apparatus`, the
suite asserts that each one is present and green so the list cannot rot, and each
is one of:

- `storageGet-UNWRAPS-THE-BAG`
- `armShortcut-returns-the-ACCELERATOR-VERBATIM`
- `armShortcut-answers-NULL-for-a-command-with-no-chord-bound`
- `send-resolves-the-transport-at-CALL-time`
- `...and the listener returns falsy, so MV3 does not hold the message channel open`
- `send-swallows-a-delivery-failure`
- `storageSet-swallows-a-failed-write`
- `INSTRUMENT CHECK: onMessage registered exactly one listener on the bus`
- `INSTRUMENT CHECK: onStorageChanged registered exactly one listener on the platform feed`

The rule used to decide each: does the behaviour the assertion measures live in
`extension/{ui,offscreen}/host.js`, or below it? `storageGet` unwrapping
`{ok, value}`, refusing `sync`, rejecting rather than throwing, filtering the
change feed by area and key, stamping the engine's envelope, guarding the inbox
by address — all of those are IN the hole module and are real results. Finding
`arm-tab` in a command table, or turning a `{[key]: value}` bag into a value, is
below it and is the double's doing.

## 4. The eleven that had to pass

`docs/VENDORING.md` names three of these by hand as *"where `assetUrl`'s trailing
slash, `send`'s `undefined` return and `storageGet`'s absent-versus-unreadable
split are checked against a real implementation rather than a stub"*. They are
green, along with eight more, and they are spelled out in
`vendor/.conformance.json`'s `mustPass` so that "we justified it" can never
become the answer for one of them:

- `AND A PATH ENDING IN `/` COMES BACK AS A DIRECTORY URL, trailing slash intact`
- `send() RETURNS UNDEFINED, NEVER A PROMISE`
- `send-returns-nothing, so no call site can start awaiting delivery`
- `storageGet-REJECTS-a-read-that-FAILED rather than reporting it as a key that was not there`
- `storageGet-answers-NULL-for-a-key-that-is-not-there`
- `storageGet-READS-THE-AREA-IT-WAS-GIVEN`
- `NO DUTY WILL TOUCH AN AREA THE UNIT NEVER NAMED`
- `onStorageChanged-delivers-only-MY-key-in-MY-area`
- `createBackend() HANDS BACK A BACKEND THAT OWES EVERY DECLARED DUTY`
- `THE SHIPPING EngineHost SATISFIES EVERY DECLARED DUTY`
- `assertHost-passes-the-SHIPPED-ui/host.js`

The suite asserts `mustPass` and `apparatus` are **disjoint**: an assertion
cannot be both this Host's evidence and the apparatus's.

## 5. The pinned red set is compared BOTH WAYS

`AGENTS.md` is blunt about expected-red lists — an assertion parked on one stops
being read at all. This is not one. It is a **set equality**:

- a red that is **not** in the pin → the step FAILS. Something about this Host changed.
- a pinned red that **did not appear** → the step FAILS too. Either it was fixed,
  and the pin owes an update, or the assertion **stopped running** — which is
  precisely how the crash hid 103 assertions while the transcript still looked busy.

Every entry carries a `class` from a closed vocabulary, a reason long enough to
be an argument rather than a label, and the place the claim is re-made. All four
are asserted.

---

## 6. The 19 unfixed reds, one by one

### 1. `and OWNERSHIP TRANSFERS: the stream arrives exactly as the platform made it`

**Class:** `platform` — The assertion's subject is a Chrome API this Host does not have and must not pretend to. Named here, re-made against our own platform in the suite the row points at.

The extension's sourceToken IS the grant: chrome.tabCapture.getMediaStreamId returns something getUserMedia consumes directly, so the token reaches the platform untouched and the stream comes back whole. Here the token is a one-shot capture claim spent against main (src/main/claims.js) and the platform call is getDisplayMedia, which the spec forbids to be audio-only — so this Host necessarily stops and removes a video track before the engine sees the stream. There is no getDisplayMedia in this harness and no claim registry to spend against; both are exercised for real by engine-host.

**Where the claim is re-made:** engine-host (docs/TESTING.md §5b), over a real launch and a real capture

### 2. `modelCached() ANSWERS WITHOUT READING THE BYTES, AND ASKS THE PINNED KEY IN THE PINNED BUCKET`

**Class:** `policy` — This Host answers differently ON PURPOSE, and shared/host.js or ADR 0001 blesses the difference. The row says which sentence.

The pinned key and the pinned bucket are the extension's Cache API store keyed on its upstream weights URL. This Host has no store and no download: the model ships inside the installer (ADR 0001 decision 5, seed §15) and modelCached() answers with a HEAD over app://workbench/model/. 'Which bucket did it open' has no answer here because there is no bucket.

**Where the claim is re-made:** engine-host (§5b), which reads the real 114,559,139-byte file through the real protocol handler

### 3. `modelBytes() SERVES A STORED COPY WITHOUT TOUCHING THE NETWORK`

**Class:** `policy` — This Host answers differently ON PURPOSE, and shared/host.js or ADR 0001 blesses the difference. The row says which sentence.

The claim is that a warm store is served without a fetch. This Host is never warm and never cold: there is one immutable file on local disk behind app://, read fresh on every call because the unit detaches what it is handed. What the assertion is protecting — P1, no network on the model path — is held here by construction and is measured directly by the p1 step.

**Where the claim is re-made:** engine-host (§5b); and P1' itself, tools/suites/p1.mjs, which observes that the model read puts nothing on any network

### 4. `and on a MISS it fetches the PINNED url exactly once, and stores what it fetched`

**Class:** `policy` — This Host answers differently ON PURPOSE, and shared/host.js or ADR 0001 blesses the difference. The row says which sentence.

Same reason: no store, therefore no read key and no write key to agree. The failure this assertion exists to prevent — a write key that is not the read key, and so a fresh 109 MB on every load for ever — cannot occur where nothing is written.

**Where the claim is re-made:** engine-host (§5b)

### 5. `and it ANNOUNCES ITS PHASE BEFORE ANY BYTES MOVE`

**Class:** `policy` — This Host answers differently ON PURPOSE, and shared/host.js or ADR 0001 blesses the difference. The row says which sentence.

The assertion wants 'cache' on a store hit and 'download' on a cold fetch. This Host reports 'cache' ALWAYS and says so at the duty: the bytes shipped in the installer, so no byte of the user's data is being spent and 'downloading' would be a lie about a local file. The phase pairs with fromCache:false, which shared/host.js requires of a Host whose bytes are immutable so the unit stops after one ask. The two are one decision.

**Where the claim is re-made:** not re-made. Stated here as the one place this Host answers a phase the extension would call wrong.

### 6. `THE HOST HANDS OVER WHATEVER IT HAS AND NEVER JUDGES IT`

**Class:** `policy` — This Host answers differently ON PURPOSE, and shared/host.js or ADR 0001 blesses the difference. The row says which sentence.

The property under test — the Host does not verify, so it cannot decline to — IS held here, and the file says so. The red is about the fixture: the assertion primes the extension's store with eight zero bytes and expects those eight bytes back. This Host has no store to prime, so it reads the real file and hands back the real length. What is asserted is the store, not the judgement.

**Where the claim is re-made:** engine-host (§5b) asserts the same property the other way round: the SHA-256 refusal comes from the unit, over bytes this Host handed over unjudged

### 7. `clearModel() REALLY DROPS THE STORE`

**Class:** `policy` — This Host answers differently ON PURPOSE, and shared/host.js or ADR 0001 blesses the difference. The row says which sentence.

shared/host.js scopes its MUST precisely so this Host does not have to satisfy the duty by lying: 'A HOST THAT EVER REPORTS fromCache: true MUST REALLY DROP THAT STORE'. This one never reports true. The bytes are a read-only file inside the installed app and throwing it away is not something this Host can do or should — the named consequence is that a corrupt bundled model is fixed by reinstalling, which is the right outcome for a file that shipped in the installer.

**Where the claim is re-made:** not re-made; it is a no-op with nothing to observe

### 8. `THE DECK NAMES NO PLATFORM: zero executable `chrome.` in extension/ui/embed.js`

**Class:** `upstream-vacuous` — test.js's own control reports that it can no longer lose under a non-Chrome Host. The red is the unit correctly refusing to claim something it cannot check — not a defect in this Host.

The claim is that the deck names no platform while the Host it imports is made of platform calls. Under this Host BOTH sides are zero — extension/ui/host.js reaches an Electron preload bridge and contains no `chrome.` at all — so the assertion has nothing to contrast with. test.js detects this itself and prints 'THE CONTROL CANNOT LOSE, so this assertion is reading nothing'. That is the unit refusing to claim something it can no longer check, which is correct behaviour and is why this red is not a defect.

**Where the claim is re-made:** vendor-intact (rule V1) and the p1 source scans, which are the same shape of claim about this Host's own platform words

### 9. `INSTRUMENT CHECK: the scan can still SEE a chrome. call`

**Class:** `upstream-vacuous` — test.js's own control reports that it can no longer lose under a non-Chrome Host. The red is the unit correctly refusing to claim something it cannot check — not a defect in this Host.

The control for the assertion above: it requires offscreen/host.js to contain at least one `chrome.` so that the scan is known to be able to see one. This Host's offscreen/host.js contains none, by construction. The control losing its ability to lose is exactly what it is for, and it reported it.

**Where the claim is re-made:** n/a — it is the control for the row above

### 10. `HOSTED IS A FACT ABOUT THE HOST, NOT ABOUT FRAMES`

**Class:** `platform` — The assertion's subject is a Chrome API this Host does not have and must not pretend to. Named here, re-made against our own platform in the suite the row points at.

The assertion imports ui/host.js twice, under a framed window and a lone one, and expects a transport in one and not the other — because the extension decides it with `window.parent !== window`. This Host's deck IS a top-level document and is still hosted, so the question is asked of main instead: the preload answers `hosted` synchronously and the module refuses anything that is not a boolean. The name of the assertion is this Host's own design, and the fixture is the extension's.

**Where the claim is re-made:** deck-seam (§5d), which drives `hosted` over a real preload answer including a non-boolean

### 11. `and the PAGE survives either way`

**Class:** `platform` — The assertion's subject is a Chrome API this Host does not have and must not pretend to. Named here, re-made against our own platform in the suite the row points at.

The other half of the framed/lone pair above: with the extension's frame test, a lone window means no transport but the page duties must survive anyway, because a deck with no player still has to size itself and take its keys. Under this Host both imports report hosted, because under this Host they are — `hosted` comes from main through the preload, not from `window.parent`, so there is no lone case for the fixture to construct. That the page and transport namespaces are separable at all IS asserted here, over a real preload answer including a non-boolean one, which the module refuses rather than coerces.

**Where the claim is re-made:** deck-seam (§5d)

### 12. `and the frame test is the HOST's, where it is true: ui/host.js is the one file that asks it`

**Class:** `platform` — The assertion's subject is a Chrome API this Host does not have and must not pretend to. Named here, re-made against our own platform in the suite the row points at.

It requires `window.parent !== window` to appear in ui/host.js. This Host deliberately does not ask that question anywhere — the answer comes from main — so the string is absent. The assertion's own detail names the risk it is guarding against ('a build that simply stopped asking'), and the guard against that here is that `hosted` must be a boolean from the preload or the module refuses to load.

**Where the claim is re-made:** deck-seam (§5d)

### 13. `THE PAGE AND TRANSPORT DUTIES POST THE DECK'S OWN NAMESPACE`

**Class:** `platform` — The assertion's subject is a Chrome API this Host does not have and must not pretend to. Named here, re-made against our own platform in the suite the row points at.

The extension's DeckPage and DeckTransport ride `window.parent.postMessage` to a content script in the page. This Host's ride the preload's pageSend/onPageEvent over ipc to src/main/transport.js, one process away — a difference IN KIND, and one of the four HOST-DESIGN.md §3.6 names. The conformance platform deliberately does NOT route pageSend to postMessage: a double that implemented the wire would be asserting about itself.

**Where the claim is re-made:** deck-seam (§5d) for the payloads, transport (§5c) for what reaches the player

### 14. `and content.js is told which keys are the deck's, and how tall it is, verbatim`

**Class:** `platform` — The assertion's subject is a Chrome API this Host does not have and must not pretend to. Named here, re-made against our own platform in the suite the row points at.

Same wire as the row above, and red for the same reason: the extension's DeckPage talks to a content script by posting into the page, and this Host has no content script to talk to. The equivalent is src/preload/youtube.cjs, reached from src/main/transport.js one process away. What the assertion protects — that the key claim and the height reach the page verbatim rather than re-interpreted — is asserted at BOTH ends by the transport suite: filtered at the Host in transport.js and named again at the call site in the preload, deliberately twice.

**Where the claim is re-made:** transport (§5c) and deck-host (§5e)

### 15. `to `parent` and to nothing else, and with no origin pinned`

**Class:** `platform` — The assertion's subject is a Chrome API this Host does not have and must not pretend to. Named here, re-made against our own platform in the suite the row points at.

A claim about postMessage's target and targetOrigin. This Host posts nothing: the deck's page and transport duties are ipc invocations addressed by main. The property it protects — the deck cannot know at build time what page it was mounted into — is stronger here, because the deck and the page are in different processes and different sessions.

**Where the claim is re-made:** shell (§5), which asserts the source view's page can see no bridge of ours at all

### 16. `drive() WRITES ONLY THE THREE FIELDS ADR 0001 DECISION 4 NAMES`

**Class:** `platform` — The assertion's subject is a Chrome API this Host does not have and must not pretend to. Named here, re-made against our own platform in the suite the row points at.

The claim is the closed write set, and it is one this Host holds and cares about more than the extension does. The red is the wire: drive() reaches the preload, not a postMessage the harness can read. This is the highest-value assertion in the unfixed set, which is why the transport suite re-makes it twice rather than once.

**Where the claim is re-made:** transport (§5c), where the closed write set is asserted at BOTH ends — filtered at the Host and named at the call site

### 17. `and a mute-only acquire stays mute-only, while the USER's speed is a different message`

**Class:** `platform` — The assertion's subject is a Chrome API this Host does not have and must not pretend to. Named here, re-made against our own platform in the suite the row points at.

Same postMessage wire as `drive()` above. The claim is that acquiring the player for a mute does not smuggle a rate change with it, and that a user-requested speed travels as its own message with its own type — which matters because the two have different refusal behaviour: a rate this Host cannot apply is REPORTED back through onSpeedReport rather than dropped. Both halves are asserted by the transport suite against the real preload, with the clamp executed out of the vendored speed.js rather than ported.

**Where the claim is re-made:** transport (§5c) and speed (src/main/speed.js, executed out of the vendored speed.js)

### 18. `INSTRUMENT CHECK: ui/host.js registered exactly one `message` listener on the window`

**Class:** `platform` — The assertion's subject is a Chrome API this Host does not have and must not pretend to. Named here, re-made against our own platform in the suite the row points at.

The control for the two rows below it, and it is red because it is working. It requires ui/host.js to have registered exactly one `message` listener on the window at module scope, so that the assertions which drive that listener are known to be driving something real. This Host registers none: incoming page events arrive through the preload's onPageEvent over ipc, never through a window message. A control that reports `none` rather than silently inspecting a stub of the harness's own making is the control doing its job.

**Where the claim is re-made:** deck-seam (§5d), whose instrument check is the same claim over the real bridge

### 19. `EACH WIRE TYPE REACHES ITS OWN DUTY, and all five payloads arrive as the host sent them`

**Class:** `platform` — The assertion's subject is a Chrome API this Host does not have and must not pretend to. Named here, re-made against our own platform in the suite the row points at.

The receive half of the postMessage wire, red for exactly the reason its own instrument check reported one line earlier: there is no window message listener to deliver into. The property — five wire types each reaching their own duty, with the payload arriving as the SAME object rather than a copy or a normalised version — is the deck seam's central rule and is asserted by deck-seam over the real preload bridge, where the objects genuinely cross a contextBridge and identity is a claim worth making.

**Where the claim is re-made:** deck-seam (§5d)

---

## 6b. Other findings for `stem-splitter-live`, recorded rather than patched

Rule V1 forbids editing anything under `vendor/stem-splitter-live/` that is not
one of the two holes, and `vendor-intact` goes red the moment anyone tries. These
are therefore findings for the OTHER repository, behind a later tag, and they are
written down here because a finding nobody wrote down is a finding nobody has.

### F-ORT — two of the four ONNX Runtime artefacts are fetched and never hashed

`extension/tools/fetch-vendor.sh` pins `ort.all.bundle.min.mjs` and
`ort-wasm-simd-threaded.jsep.wasm` with `verify` lines. It copies
`ort-wasm-simd-threaded.mjs` (24,180 B) and `ort-wasm-simd-threaded.jsep.mjs`
(46,614 B) with **no hash at all** — and its own comment records that the glue
`.mjs` *"is still fetched dynamically in some paths"*, i.e. it is loaded and run,
inside the cross-origin-isolated `app://` origin that also holds the capture ring
and the verified weights, under a CSP that grants `'wasm-unsafe-eval'`. **M1 is
"no remote code"; this is where the remote code actually is.**

Nothing is wrong with today's drop — every one of the five files has been hashed
by hand and by the gate. What was wrong is that nothing would have noticed if it
were. **Closed locally**: `vendor/.pin` now carries an `ort` block with all five
SHA-256s and the version, `tools/vendor-unit.sh` writes it when §6 fetches, and
`bash tools/vendor-unit.sh --check` re-hashes the whole directory offline on
every `vendor-intact` run — including a set comparison, so a file ADDED to that
directory is red too. Watched red both ways: append one byte to the unpinned
glue, and drop an extra file in.

The upstream fix is two more `verify` lines in that script.

### F-TOOLBAR — the deck tells a desktop user to click a toolbar icon

With nothing armed, `ui/embed.js` prints *"Click the Stem Splitter Live toolbar
icon on this tab to arm it, or press Ctrl+Shift+A"* (`:1142`). There is no
toolbar icon in this product and there are no tabs. `docs/VENDORING.md` already
names this as the one English sentence a second Host must patch, and the
accelerator half of it is answered correctly by `DeckHost.armShortcut()`. It is
visible in [`docs/evidence/step3-youtube/npm-start.png`](evidence/step3-youtube/npm-start.png).

The upstream fix is a Host-supplied noun, the way the chord already is.

## 7. What this step does not say

- **It is not `vendor-unit`.** That step asks whether the unit still works; this
  one asks whether this Host still satisfies the unit's description of a Host.
  A red there is a broken copy; a red here is a broken Host. They must not be one
  step.
- **It is not a substitute for the launch suites.** Every `platform`-class row
  above names where the claim is re-made against this Host's own platform —
  `engine-host`, `deck-seam`, `transport`, `deck-host`, `shell`, `p1`. This step
  is the unit's words; those are the measurements.
- **It proves nothing about the model bytes, the capture, or the audio.** Six of
  the reds are the model duties and one is the capture; all seven are exercised
  for real by `engine-host` over a live launch, the bundled 114,559,139-byte file
  and a real `getDisplayMedia`.
