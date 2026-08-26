# FAQ

> **There is nothing to install.** No release, no installer, no binary. This
> file exists ahead of the product because three of its answers are disclosures
> the design owes you *before* you would ever be in a position to need them, and
> because writing them down early is what stops them being written to flatter
> later. Answers about behaviour describe the design; where nothing has been
> built or measured, the answer says so.

Jump to the three that matter most:
[you export audio — is this piracy?](#you-export-audio-the-extension-refuses-to-is-this-a-piracy-tool) ·
[why does it pretend to be Chrome?](#why-does-it-tell-google-it-is-chrome) ·
[can I use it commercially?](#can-i-use-this-commercially)

---

## What it is

### What is this, in one sentence?

A desktop app that plays a YouTube page it embeds, or a file off your disk,
splits it into six stems — drums, bass, other, vocals, guitar, piano — live on
your own machine, gives you a fader for each, and writes the stems to disk.

### How is it different from the Chrome extension?

[`stem-splitter-live`](https://github.com/itziklerner-pag/stem-splitter-live) is
a Chrome extension that does the live-splitting part inside a YouTube tab. This
is a separate product that shares its audio engine and its deck — the same code,
copied at a pinned version and verified byte for byte — and adds the two things
an extension cannot do:

- **Install without Developer mode.** The extension's install path is
  `chrome://extensions` → Developer mode → Load unpacked.
- **Open a file off your disk**, and **write stems to disk**.

The second one is not a feature gap. It is a line the extension is deliberately
built not to cross, and crossing it is why this is a different product with a
different name and its own documents. See below.

### Why is it a separate program instead of an option in the extension?

Because the extension's whole trust story is *"it cannot hand you a file"*, and
that claim is enforced rather than promised: its manifest asks for no
`downloads` permission and an automated check asserts the permission's absence
on every commit. An export button would delete that story from a product that a
lot of its documents are written around. It would also mean that any complaint
about *this* app's export landed on *that* app's repository and issue tracker.

The reasoning is recorded as
[ADR 0001 in `stem-splitter-live`](https://github.com/itziklerner-pag/stem-splitter-live/blob/main/docs/adr/0001-desktop-app-is-a-separate-product.md).

---

## The three disclosures

### You export audio. The extension refuses to. Is this a piracy tool?

**The honest answer is that this product takes a risk the extension does not,
and the reason it is a separate product is so that risk lands here alone.**
Here is exactly what it does and does not do, so you can judge it rather than
take a slogan.

**What it does not do — and this part is inherited unchanged:**

- It **never resolves, fetches or parses a media stream URL.** No `yt-dlp`, no
  innertube, no `/videoplayback`, no player-response scraping, no downloader of
  any kind.
- The code that talks to YouTube's player reads five values off the `<video>`
  element — `paused`, `currentTime`, `duration`, `ended` and `playbackRate`, with
  `seeking` arriving as an event rather than a poll — and writes three: `muted`,
  `currentTime`, `playbackRate`. That is transport state, not media. It never reads `src`,
  `currentSrc`, `buffered` or `srcObject`, and never calls `captureStream()`.
- It has no way to obtain the original file. It does not know where it is.

**What it does:** it **captures what the player renders**, the same way a screen
recorder captures a screen — the app answers its own display-media request with
the embedded view's frame — separates the result with a model, and can write the
six separated stems to a folder you pick.

**What that means, said plainly:**

- **A YouTube export is a recording, in real time.** The video has to play all
  the way through, at normal speed, while it records. There is no fast path,
  because there is no file to fetch. A seek ends the recording. This is not a
  UX limitation we intend to fix — it is what capturing a live player *is*.
- **What comes out is not the original.** It is six model outputs derived from
  a lossy stream that was decoded, captured, separated by a neural network and
  re-encoded. It is a tool for practising, learning a line, or building a remix
  stem set. It is a bad way to obtain a song, and a worse way than the ones that
  already exist.
- **YouTube's terms prohibit downloading**, and audio captured from a YouTube
  stream and written to a file is a download under those terms. Tools in this
  category have drawn takedown requests before — youtube-dl, October 2020. That
  exposure is real, it attaches to **this** repository and this artifact, and it
  is the specific thing ADR 0001 exists to keep away from the extension.
- **A File source has none of this attached to it.** Opening a WAV you own and
  splitting it is the ordinary case, it runs at engine speed rather than in real
  time, and it is the case this product is actually best at.

We are not going to tell you that exporting from YouTube is fine. We are telling
you what the code does, where the line was drawn, and which side of it each
Source sits on.

### Why does it tell Google it is Chrome?

**Disclosure, in full, because this one has consequences for your Google
account.**

Google blocks sign-in from embedded browser frameworks by user-agent — the
*"This browser or app may not be secure"* page — and has done since 2019. An
Electron app that reports itself as Electron cannot sign you in. So on the
partition where youtube.com runs, and only there, the app presents a **stock
Chrome user-agent**.

What follows from that, all of it:

- **Google does not endorse this app, has not reviewed it, and is not affiliated
  with it.** Presenting a Chrome user-agent is not a claim of approval by
  anyone. YouTube is a trademark of Google LLC.
- **It may stop working at any time, without notice, and without anything on our
  side changing.** Google can detect embedded frameworks by more than the
  user-agent, and it changes what it checks. This is the least durable thing in
  the product, and it is a third party's decision, not a bug we can fix.
- **Signing in may trigger account challenges.** Expect "verify it's you"
  prompts, unfamiliar-device warnings, and **two-factor flows that behave badly
  or fail outright** in an embedded view. Some 2FA methods — particularly ones
  that want to hand off to another app or a security key — may simply not
  complete here.
- **If you would rather not risk it, don't sign in.** The app is designed to fall
  back to anonymous YouTube. The cost is real and stated: ads get separated too,
  and you are more likely to meet a bot-check wall.
- **Your credentials never touch this app's own code.** You are signing in to
  Google, in a browser, and the cookies land in that view's own storage
  partition on your disk. The app does not read them, does not copy them from
  Chrome, and does not send them anywhere. See [`PRIVACY.md`](PRIVACY.md).

**Status: not built.** Sign-in is step 5 of the plan. Nothing above has been
implemented or tested.

### Can I use this commercially?

**No, and this is not negotiable by us — we do not own the thing that forbids
it.**

The separation model is Demucs `htdemucs_6s`. The Demucs *code* is MIT; the
*pretrained weights* are **CC BY-NC 4.0 — non-commercial**. Meta released them
for scientific purposes and they were trained partly on a proprietary dataset.
**Nobody can relicense them, including us.**

The extension gets to be vaguer about this, because it does not redistribute the
weights — it downloads them at runtime. **This app ships them inside its
installer.** That makes this project a *distributor* of CC BY-NC 4.0 material,
so the non-commercial term binds the artifact directly rather than binding
whoever downloaded it.

Concretely:

- **Donations are fine.**
- **Paid tiers are not.** No licence keys, no pro edition, no donation-gated
  features.
- **Bundling is not.** It may not be shipped inside, alongside, or as an
  inducement to buy any commercial product or service.
- **This is permanent.** A commercial door would mean different weights, which
  would mean a different stem contract and a different engine — a different
  product, not a version of this one.
- **Our own code is MIT**, and that grant covers our code and nothing else. If
  you want to build something commercial, you need weights you are allowed to
  use commercially: train your own, or use a permissively-licensed separator.

[`NOTICE.md`](NOTICE.md) is the full statement, and it is in the first commit of
this repository on purpose.

---

## Using it

### How far behind the video will it be?

About 3.4 seconds, for YouTube. The model needs a chunk of audio before it can
separate it, and a YouTube stream arrives in real time — so the deck runs behind
the picture by roughly one chunk. A **file** you open has none of this: the whole
signal is on your disk before separation starts, so it is separated ahead of
time and plays with free seeking and no lag.

### Will it run on my machine?

Unknown — nothing has been built. What is known:

- It needs a GPU for WebGPU to be worth it. There is a threaded-WASM fallback,
  and it is slower.
- The installer will be around 300 MB, because the model is inside it.
- macOS, Windows and Linux are all intended. **Only Linux has had any code run
  on it at all**, and what ran was a throwaway experiment, not the app.

### Does it phone home?

The app's own code contacts exactly one host — GitHub Releases, to check for a
newer version — and nothing else. No telemetry, no analytics, no crash
reporting, no fonts, no CDN, no model download. The update check has a visible
toggle and is on by default, because this app ships its own Chromium and
therefore owns Chromium's security patches.

The embedded YouTube view's traffic is your own browsing and behaves like
YouTube in any browser. [`PRIVACY.md`](PRIVACY.md) separates the two carefully
and says what is stored on your disk and where.

**That is an automated test, not a promise** — and the test itself had a hole
that two reviewers found and that is now closed. It watched Chromium's network
stack, so it could not have seen a request the app made from its own main
process, outside Chromium. No such request has ever been in this app; the point
is that "we would have noticed" was not true. The app now removes those
transports from its main process at start-up, so a line of code that tried would
throw rather than send, and the test stands up a listening socket on your own
machine and requires that nothing arrives at it.

### What is the difference between Export and Bounce?

- **Export** — the six raw model outputs, at unity, as 32-bit-float WAV. Nothing
  the deck did is applied. This is what a DAW wants. It is v1.
- **Bounce** — what you are actually hearing, with your faders, mutes, solos,
  transpose and speed baked in. **Not v1**: it needs an offline render path
  through the playback DSP, which today runs only in real time.

They are two words because they are two deliverables for two different people.
Raw stems are never "the mix".

### Why YouTube, and not Spotify or Apple Music?

Those are DRM'd. Stock Electron ships no Widevine CDM, and protected output is
capture-blocked anyway. It is not a to-do item; it is a wall.

Capturing your *whole desktop's* audio — any app at all — is a different
question with a different answer: it would need a virtual audio device to keep
the "you hear the stems, not the original" model working. That is a second
product, not a setting.

### Why does it need to mute the YouTube view?

Because the entire point is that you hear the **stems**, not the original. The
app mutes the embedded view and captures it anyway — it can hear what you
cannot. That property is the one thing this whole product rests on, it has been
measured on Linux, and it has **not** been measured on macOS. The write-up,
including the part where a stronger instrument caught a 1.9-second leak in a
variant that had been recorded as passing, is
[`docs/spike-capture-mute.md`](docs/spike-capture-mute.md).

---

## The state of it

### Can I try it?

No. There is no build. The repository currently holds one throwaway experiment,
its write-up, and the documents you are reading.

### When will there be a release?

No date. When there is one it will be a **pre-release** on GitHub, with no
announcement — a thing to be tested, not launched.

### Which platform will work first?

macOS is the release priority, because notarization is the one gate a tester
cannot click through. **But the machine this is being built on has no Mac, no
Apple credentials and no audio hardware**, so what will exist first is a Linux
app that has been proven to start and arm, plus build configuration for macOS
and Windows that has been *written and never run*. Every document here is
expected to keep those two categories apart, and
[`docs/ARCHITECTURE.md` §7](docs/ARCHITECTURE.md) is where the distinction is
defined.

### Is the audio engine here a fork of the extension's?

**No, and that is enforced rather than intended.** It is a *vendored copy*: 35
files taken at a pinned tag, each verified against a recorded SHA-256, and never
edited. If the engine is wrong, the fix is a change in the other repository
behind a new tag — not a patch here. A patched copy is precisely the failure
mode the arrangement exists to prevent, and
[`CONTRIBUTING.md`](CONTRIBUTING.md) states it as a rule with a check behind it.

### Something is broken. What do you need?

Your OS and version, the app version, whether the Source was YouTube or a file,
and what you expected versus what happened. If it is audio, say whether the
YouTube view itself was audible — that one detail distinguishes two completely
different faults.

Issues: <https://github.com/itziklerner-pag/stem-workbench/issues>. Desktop work
goes on that tracker; the extension's stays on its own.

### Can I contribute?

Yes, and read [`CONTRIBUTING.md`](CONTRIBUTING.md) first — particularly the
three rules that override everything, and the assertion discipline. The short
version of the latter: **an assertion you did not watch fail is not evidence**,
and a test suite that exits zero while asserting nothing is a hard failure here,
not a pass.
