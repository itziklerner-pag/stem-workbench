---
status: accepted
date: 2026-08-26
---

# The shape of the desktop product: Electron, a player window, and a bundled model

Six decisions were taken for this product before this repository had anywhere to
record them. They live in a design-session seed and a plan file that sit in the
**other** repository's working tree, and one of them was corrected by a spike
that is written up here. This ADR moves them into this repository, where the
product they govern lives, so that a reader of *this* tree can find out why it is
shaped the way it is without being handed a link to a plan for a different
codebase.

**Nothing here is a new decision except decision 6**, which substitutes a pass
condition the original could not be discharged against. Every other decision is
recorded with the section that took it. Where building the thing corrected a
decision — decision 2 was corrected by measurement — the correction is in the
decision, not in a footnote.

## Context

- The product is a non-commercial Electron desktop app that vendors
  `stem-splitter-live`'s engine and deck behind a Host seam, takes two
  **Sources** — YouTube as a **Live source**, files as a **File source** — and
  exports stems from both. That much is already recorded, in the *other*
  repository, as
  [ADR 0001 `the desktop app is a separate product that vendors the engine`](https://github.com/itziklerner-pag/stem-splitter-live/blob/main/docs/adr/0001-desktop-app-is-a-separate-product.md).
  **That ADR is not restated here and is not superseded by this one.** It owns
  the separate-product decision, the vendoring discipline, the Host seam, the
  one-tag-series rule, and export-from-every-Source. This ADR owns the shape of
  the desktop artifact.
- The decisions below were taken in a design session on 2026-08-24 and written
  up as a seed, then folded into `desktop-app-plan.md` (approved 2026-08-25) as
  Appendix A. **Both files live in `stem-splitter-live`'s working tree and are
  git-excluded there**, which is precisely why this ADR exists: a decision whose
  only record is an untracked file in another repository is a decision that will
  be re-litigated. Citations below are to the seed's section numbers, which the
  plan preserves.
- One of those decisions — the capture path — was flagged in the plan as the
  **#1 risk and the kill criterion for the whole program**: an Electron
  maintainer comment on issue 32788 (Nov 2025) says `tabCapture`'s "silence the
  tab locally while captured" behaviour is not replicable, even with
  `enableLocalEcho`. A spike was built to answer it before anything else was
  touched. It answered it on Linux, and the write-up
  ([`docs/spike-capture-mute.md`](../spike-capture-mute.md)) carries the result,
  fifteen numbered limitations, and a **correction**: the variant originally
  recorded as passing was shown to leak 1.90 s of full-level audio, and was
  re-recorded as failing.
- The machine this product is being built on runs Linux, has no Mac, no Apple
  Developer credentials and **no audio hardware at all** (`aplay -l`: no
  soundcards found). That fact is what decision 6 is about, and it is a fact
  about the builder, not about the product.

## Decision

### 1. Electron, not Tauri, and not a Chromium fork — seed §6

Chromium ≥ 128 is the engine's floor, so **Electron ≥ 32**; the spike ran
Electron 44.0.0 / Chromium 152.0.7977.54.

The three things Tauri lacks are the three things the engine needs, and they are
not negotiable one at a time:

- **capture of an embedded frame's audio** — no Tauri webview engine can do it;
- **`SharedArrayBuffer`** — flaky on WKWebView and WebKitGTK, and the engine
  constructs SABs directly and asserts on the constructor;
- **WebGPU** — absent on WebKit engines, and the fallback is threaded WASM,
  which is the slow path we would then be permanently on.

A Chromium or CEF fork was rejected as a maintenance burden with no offsetting
capability.

**A consequence taken deliberately rather than discovered:** this app now ships
its own Chromium and loads youtube.com in it, so it owns Chromium's security
patches, which Electron ships roughly every two weeks. That is the argument that
decides auto-update in decision 6 — an app that cannot update itself has a worse
security posture than the extension, where Google did this.

**Note.** Electron's extension shim has no `chrome.tabCapture` and no
`chrome.offscreen`. This is a port of the extension's engine behind a seam, not
a load of the extension.

### 2. The capture path: `getDisplayMedia`, answered with the view's frame, and the view muted before it plays — seed §7, corrected by the spike

There is no `chrome.tabCapture` in Electron. The supported way to capture one
`WebContents`' audio is a renderer calling `getDisplayMedia` and the main
process answering it:

```js
// main
session.setDisplayMediaRequestHandler((req, cb) => cb({
  video: ytView.webContents.mainFrame,
  audio: ytView.webContents.mainFrame,
}));
ytView.webContents.setAudioMuted(true);          // BEFORE the view plays

// renderer
navigator.mediaDevices.getDisplayMedia({
  video: true,                                    // the spec forbids audio-only
  audio: { autoGainControl: false, echoCancellation: false, noiseSuppression: false },
}).then(s => { s.getVideoTracks()[0].stop(); /* … */ });
```

**Three things in that snippet are load-bearing and were established by
measurement, not by reading documentation:**

- **`setAudioMuted(true)` must land before the view plays.** The variant without
  it was originally recorded as a PASS. A stronger instrument — one that recorded
  the app's whole lifetime rather than only the capture window — caught **1.90 s
  of full-level audio reaching the speakers** between the view starting to play
  and `getDisplayMedia` being called. **That variant is FAIL.** A user must not
  hear a 1.9-second burst of the original every time they arm the deck. This is
  the single correction the spike made to the plan.
- **The three processing constraints are not optional.** A naive
  `getDisplayMedia({ audio: true })` returns **mono, 48 kHz, AGC on**, and the
  captured level decayed **17× over 8 seconds**. That stream is a dead product
  for stem separation and it looks fine to a gate that checks only a floor.
- **`enableLocalEcho` is left at its Electron default** and nothing rests on it.
  The variant that also sets it passes identically; it is not preferred, because
  its default may differ per platform and the explicit mute is the thing we want
  to be depending on.

**What was proven, and where.** On Linux, the captured stream is full-level and
usable — `channelCount: 2`, `sampleRate: 44100`, all three processing flags
`false` — while the audio device the app is routed to reads **bit-exact zero for
the app's entire lifetime**, on a local fixture and on a real watch page. The
capture is frame-scoped, so **the deck can play stems at full level while the
view is captured without feeding back into it** — measured separately, and the
product does not exist without it. Capture survives a full page reload and a
YouTube SPA navigation, because the grant follows the `WebContents` rather than
the document.

**What was not proven: macOS.** The plan writes its kill criterion against
macOS and marks Linux explicitly non-blocking. Every recorded run says
`platform: linux`. **The program proceeds on a ruling, not on the criterion
having been met** — the criterion was never dischargeable on this hardware, so
it is hardware-blocked rather than unanswered, and it is tracked as
[#2](https://github.com/itziklerner-pag/stem-workbench/issues/2). The permanent
gate ([#3](https://github.com/itziklerner-pag/stem-workbench/issues/3)) is
specified to **fail loudly** on a platform where the property does not hold,
rather than to skip.

### 3. The shape is a player window — seed §8

- **youtube.com in an embedded `WebContentsView`**, not a `<webview>`, which
  Electron's own documentation discourages.
- **No address bar and no tabs.** Navigation is allow-listed to youtube.com plus
  the Google sign-in hosts (accounts.google.com, accounts.youtube.com,
  consent.youtube.com, myaccount.google.com).
- **The deck is drawn in the host window, beneath the view** — not injected into
  YouTube's DOM. Same reason the extension uses an iframe rather than injected
  DOM: injected markup runs at YouTube's origin, inherits YouTube's CSP, and is
  one stylesheet change away from breaking.
- **A preload in the view is the transport**, doing what `content.js`,
  `autonav.js` and `speed.js` do today: read `paused` / `currentTime` /
  `duration` (and `ended`, `playbackRate`, `seeking`), write `muted` /
  `currentTime` / `playbackRate`, suppress autoplay-next. **Those three writes
  and nothing else** — the write set is closed and enforced at both ends, because
  L1 is a security property and this channel reaches a `<video>` on somebody
  else's page.

A general browser with tabs was rejected: it is a different product, and a tab
picker cannot exist here for the same reason it cannot exist in the extension —
one deck, one armed Source.

### 4. Non-commercial, permanently — seed §5

The distributed application may not be sold, licensed, monetised or bundled into
anything commercial. Donations are fine; paid tiers and bundling are not. Not
now, not later.

The `htdemucs_6s` weights are **CC BY-NC 4.0**, and decision 5 makes this
product a **distributor** of them rather than a downloader. The extension's
position — *"we do not redistribute the weights"* — does not carry over, so the
non-commercial term binds the artifact directly.

The six-stem contract is model-specific: a commercial door would mean different
weights, a different stem contract and no shared engine — a different product,
not a version of this one. [`NOTICE.md`](../../NOTICE.md) has said so since the
first commit of this repository, on purpose.

### 5. The model ships inside the installer — seed §15, option M2

The 109 MiB `htdemucs_6s` ONNX (114,559,139 bytes, pinned by commit and
SHA-256) is packaged in the app so ONNX Runtime can read it as a plain file on
disk rather than out of the asar. ONNX Runtime itself stays vendored at build time by the unit's own
`tools/fetch-vendor.sh`, at a pinned version with recorded hashes.

- No first-run download; it works offline from first launch.
- The third-party Hugging Face single point of failure is gone for this product.
- The unit's SHA-256 and byte-count check **still runs on every load**, against
  the bundled file. Integrity and M1 are preserved: where the bytes come from is
  a Host duty, whether the bytes are the model is the unit's decision.
- Installers land around 300 MB. Windows NSIS and macOS zip updates are
  differential; a Linux AppImage update re-ships the whole artifact.

**Amendment, from the Host design.** Seed §15 words the mechanism as
`asarUnpack`; the design takes **`extraResources`** instead. Both put a plain
file on disk and the decision — *the model ships in the installer* — is
unchanged. The difference is how the file is located: `asarUnpack` leaves it
under `…/app.asar.unpacked/…`, a path derived by string surgery on
`app.getAppPath()` that stays correct only until somebody renames the asar,
while `extraResources` gives `path.join(process.resourcesPath, …)` — a
documented location with the same shape on all three platforms. Differential
updates are unaffected. Recorded here rather than left as a silent divergence
from the seed.

**M3 — a first-run download from a self-controlled GitHub Release asset — was
the recommended option and was overruled by the product owner** in favour of
offline-from-first-launch simplicity. It is recorded that way rather than
tidied, because the tradeoff is real: M2 costs 300 MB installers and buys a
product that never needs the network to work.

### 6. macOS-first release, verified on Linux — seed §14, and the substitution this ADR makes

**The plan's decisions, unchanged:** all three platforms built from day one in
CI with electron-builder; release priority macOS, then Windows, then Linux; the
first release is a **pre-release channel, not a launch** — GitHub pre-releases,
no announcement, no website; macOS betas signed and notarized from the first
beta; Windows betas unsigned during beta with Azure Trusted Signing before the
official release; Linux AppImage/deb unsigned; auto-update **on by default** with
a visible toggle, via electron-updater against GitHub Releases, following the
pre-release channel during beta.

macOS is first because **notarization is the one gate a tester cannot click
through**: an un-notarized beta is the one thing a tester on current macOS
cannot open at all. SmartScreen can be clicked past; Gatekeeper cannot.

**The substitution, and it is a new decision.** The plan's pass condition for
this phase is *"a notarized macOS pre-release a tester can open and arm"*. That
cannot be discharged on the machine this is being built on: no Mac, no Apple
credentials, no audio hardware. Rather than leave the phase permanently
unfinished or quietly redefine the words, the pass condition is replaced:

| | |
|---|---|
| **the pass condition becomes** | a **runnable Linux app** the owner can start and arm on this machine, proven by an automated smoke — **plus** electron-builder configuration and CI for macOS and Windows that is **written and never built or signed here** |
| **what is not claimed** | that the app runs on macOS or Windows; that any artifact was compiled, signed or notarized; that CI passed a build. A green configuration file is not a green build |
| **the cost, stated** | the platform the plan calls the priority is the platform with zero evidence. The first Mac to run this will be doing so for the first time, and decision 2's capture property is unproven there |
| **the obligation this creates** | **every document in this repository says which of "verified", "configured but never built" and "written down only" a claim is.** [`docs/ARCHITECTURE.md` §7](../ARCHITECTURE.md) defines the three and [`CONTRIBUTING.md`](../../CONTRIBUTING.md) makes a sentence that omits it a bug in the document |

**ADDENDUM, 2026-08-26 — one clause of this decision was implemented differently,
and it is the words "via electron-updater".** Everything else in decision 6 is
delivered: auto-update is on by default, the toggle is visible in the app's own
bar and survives a restart, and the pre-release channel is set — in
`src/main/update.js`, in `package.json`'s `build.publish`, and inside a built
installer's own `app-update.yml`, which the `dist-linux` gate reads back out of
the artifact.

electron-updater itself is **configured and not a dependency of this app**, and
the reason is this decision's own network rule, one paragraph below. Read at
6.8.9 rather than assumed: it creates its own
`session.fromPartition("electron-updater")`, which is a session outside
`src/main/sessions.js` and therefore outside the P1′ observer; its public GitHub
provider talks to `github.com`, not the `api.github.com` that P1′ names, so the
policy cancels every request it makes; and a release asset redirects to
`objects.githubusercontent.com`. The download path is **irreducibly two hosts**
and P1′ names one — and this project never creates a GitHub Release, so there is
nothing to download in any case. The delivery half therefore stays configured and
unarmed. [`docs/UPDATES.md`](../UPDATES.md) §2 lists, in order, what an owner
would have to decide before that changes; **widening P1′ is an owner's call and
has not been asked for.**

**P1′ — the network rule** — is part of this decision and not a separate one:
successor to the extension's P1 (*"no network after the model download"*), it
says the app's own code talks to **exactly one named host, GitHub Releases, for
the update check, and nothing else**. No telemetry, no crash reporting. The
YouTube view's traffic is the user's browsing and [`PRIVACY.md`](../../PRIVACY.md)
says so. It was drafted as *two* hosts — model plus updates — before decision 5
removed the model download.

## Consequences

**Positive**

- The capture property the whole product rests on was tested **before** anything
  was refactored upstream, which is what the plan's spike-first sequencing was
  for — and the test found a real defect (the 1.90 s leak) in a variant that had
  already been written down as passing.
- The product works offline from first launch and depends on no third party for
  the model.
- The window shape keeps this app out of YouTube's DOM entirely, so a YouTube
  redesign cannot break the deck — only the transport preload, which reads five
  numbers.
- The non-commercial constraint is a property of the artifact, stated in the
  first commit, so no feature can be built that quietly assumes otherwise.

**Negative**

- **The release priority and the verification platform are different platforms.**
  Everything about macOS in this repository is design, and the one measured
  property may not hold there. This is the largest known risk in the program and
  it is not reducible from here.
- Installers around 300 MB, and Linux updates re-download all of it.
- An update check exists at all, which the extension does not have. It is one
  host, it is toggleable, and it was still a real concession made on a security
  argument.
- Shipping the weights makes this project a redistributor of non-commercial
  material, which closes a door permanently for a benefit measured in one
  first-run download.
- Electron means a Chromium to keep patched, forever, on three platforms.

## Considered Options

- **Tauri.** Smaller binaries, no bundled Chromium. Rejected: no capture of an
  embedded frame's audio, flaky `SharedArrayBuffer`, no WebGPU. Each one alone
  would be fatal to this engine.
- **A Chromium / CEF fork.** Rejected: all of Electron's costs and none of its
  ecosystem.
- **Capture variant (a) — no explicit mute, relying on the capture to silence
  the frame.** Rejected on measurement: 1.90 s of full-level leak before the
  capture opens. It had been recorded as a PASS by an instrument that could not
  see it, which is the reason the permanent gate measures the app's whole
  lifetime.
- **Capture variant (c) — explicit mute *and* `enableLocalEcho: true`.** Passes
  identically. Not preferred: it rests on a flag whose default may differ per
  platform, and the explicit mute is the thing we want the product depending on.
- **A general browser with tabs**, or **a deck injected into YouTube's DOM.**
  Rejected — a different product, and YouTube's CSP respectively.
- **A commercial tier, now or later.** Rejected; see decision 4. It is not ours
  to grant.
- **M1 — first-run download from Hugging Face, as the extension does.**
  Rejected: it keeps a third-party single point of failure, now for installers
  in the wild.
- **M3 — first-run download from a self-controlled GitHub Release asset, Hugging
  Face as fallback.** Smaller installers, cheap Linux updates. **Recommended and
  overruled by the product owner** in favour of offline-from-first-launch.
- **Release ordering by gatekeeper cost (Linux first).** Rejected: notarization
  is the gate that cannot be clicked through, and the Apple account already
  exists.
- **Updates off by default, for P1 purity.** Rejected: this app owns a Chromium
  that loads youtube.com, and the security-patch argument beats the purity
  argument.
- **Declaring this phase blocked until a Mac exists.** Rejected: it stops all
  work on a product whose remaining risk is not concentrated on macOS, and it
  would leave the Linux evidence unrecorded. Decision 6 substitutes a pass
  condition instead, and says loudly what it does not cover.
