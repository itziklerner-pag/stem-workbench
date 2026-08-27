# Privacy

**stem-workbench** · written 26 August 2026

> **Nothing has shipped.** There is no installer, no release and no user. This
> document is the design the code is being written against, and it is published
> now so that it can be checked *before* there is anything to check it against —
> and so that a decision that would break it has to break a document first.
> Where a promise here is not yet held by an automated test, it says so.
>
> **Updated 26 August 2026:** the network promise — *one host, and the YouTube
> partition excluded by name* — **is** held by an automated test now
> (`tools/suites/p1.mjs`, `docs/TESTING.md` §9). So is the sign-in promise: that
> the stock Chrome user-agent is on the YouTube partition and on **nothing** of
> ours, so the update check reaches GitHub as what it is
> (`tools/suites/shell.mjs`). Everything else on this page is still design.

## The short version

**stem-workbench collects nothing about you. There is no server to send it to,
and we do not run one.**

The app's own code makes **one kind of network request in its entire lifetime**:
it asks GitHub Releases whether there is a newer version, and downloads one if
you let it. That is all. No telemetry, no analytics, no crash reporting, no
fonts, no CDN, no model download.

Your audio is separated on your own machine and never leaves it. Your stems are
written where you tell them to go and nowhere else.

**One thing this app does that the extension does not, and you should know it
before you install:** it embeds a browser that loads youtube.com. **That traffic
is your own browsing, and it looks like browsing, because it is.** See
[Two kinds of traffic](#two-kinds-of-traffic).

## What we collect

Nothing.

- No personal information, no name, no email address, no account.
- No usage analytics, no telemetry, no event logging, no crash reporting.
- No audio, ever. Not a sample, not a fingerprint, not a hash.
- No browsing history, no page content, no URLs, no titles.
- No cookies, no advertising identifiers, no device fingerprinting. (The app
  does look at the NAMES of the cookies in the YouTube view, to decide whether
  its own bar says `signed in` or `anonymous`. It never opens one, and nothing
  about them leaves your machine. *The YouTube view*, below, is the long form.)
- No "anonymous" or "aggregated" statistics. There is no exception hiding here.
- Nothing is sold, shared or transferred to anyone, because none of it exists.

## Two kinds of traffic

This is the part that is genuinely different from the extension, and it is the
part a privacy page could most easily fudge. It is stated as two separate
things because it is two separate things.

### 1. The app's own code — exactly one host

**Rule P1′:** *the app's own code talks to exactly one named host, GitHub
Releases, for the update check, and nothing else.*

| | |
|---|---|
| **what** | **a check, and only a check.** One `GET` for the list of releases. This app does not download or install an update — see below |
| **where** | `api.github.com`, and nothing else: `GET /repos/itziklerner-pag/stem-workbench/releases`. It follows the **pre-release** channel, because that is what a beta is |
| **what it reveals** | what any HTTP request necessarily reveals to the host it is sent to: your IP address and your user agent. GitHub's privacy statement governs what they log |
| **what it does not carry** | no installation identifier, no machine identifier, no usage counter, no opt-out token. There is nothing in it that distinguishes you from anyone else running the same version |
| **can you turn it off** | yes — a visible checkbox in the app's own bar, marked *auto-update*. It is **on by default**, and the reason is below. Turning it off is remembered across restarts, and the gate measures that rather than asserting it (`docs/TESTING.md` §10b) |

**Why an update check exists at all, when the extension has none.** This app
ships its own Chromium and loads youtube.com in it, so it owns Chromium's
security patches — Electron ships them roughly every two weeks. An app that
cannot update itself has a *worse* security posture than the extension, where
Google did this for us. That argument beat the purity argument, deliberately and
on the record (`docs/adr/0001-the-shape-of-the-desktop-product.md`).

**Nothing is downloaded — not even the update.** The check tells you a newer
pre-release exists; fetching it is something you do yourself, in a browser. That
is not a limitation being dressed up: downloading a release from GitHub means
`github.com` *and* the asset host it redirects to, and rule P1′ names **one**
host. Rather than quietly widen the rule, the delivery half is configured and
left unarmed, and `docs/UPDATES.md` says exactly what would have to change — and
who would have to decide it — before that stops being true.

**The model is not downloaded either.** It ships inside the installer. Unlike
the extension, this app never contacts Hugging Face, or anyone else, for
weights.

### 2. The YouTube view — your browsing, on your own session

The app embeds a browser view and loads youtube.com in it. **Every request that
view makes is a request you caused by browsing YouTube**, and it behaves like
YouTube in any browser: YouTube's own cookies, YouTube's own analytics,
YouTube's own ads, Google's own network calls.

- **We do not read that traffic, log it, proxy it, or send it anywhere.**
- **We never read the VALUE of any of your cookies.** The value is the
  credential — a Google session cookie is not a fact about your session, it *is*
  your session. They live in the view's own storage partition on your disk,
  where the embedded Chromium keeps them, and nothing in this app opens one.
- **We do read cookie NAMES, and here is exactly why, exactly when, and exactly
  how far.** Once at start-up and again after each page you navigate to, the app
  asks Chromium for that partition's cookies — purely to decide whether its own
  bar should say `signed in` or `anonymous`. Chromium hands back whole cookies,
  so **the very line that asks throws the values away** and keeps only the name
  and the domain; nothing downstream of it has ever had a value to leak, and a
  test drives that function with one and searches the answer for it. What
  survives is a word on a toolbar: not stored, not written to disk, not sent
  anywhere. If you would rather it did not happen at all, the code is one file —
  [`src/main/signin.js`](src/main/signin.js) — and deleting it costs the app
  nothing but that word.
- If you sign in, you are signing in to Google, in a browser, exactly as you
  would anywhere else. Your session persists between launches because cookies do
  — and that is measured rather than assumed: a test starts the app, writes a
  cookie into that partition, shuts the app down, starts it again and reads the
  cookie back.
- The app presents a **stock Chrome user-agent** on that partition, so that
  Google's sign-in flow does not refuse it. It is on that partition and on
  nothing else: the app's own update check goes to GitHub as what it is, and an
  automated test fails the build if that stops being true. Disclosed here and
  again, at length, in [`FAQ.md`](FAQ.md) — including that Google does not
  endorse this, that it may stop working, and that account challenges are
  possible.

**The honest summary:** installing this app does not send Google anything it
would not already get if you opened youtube.com in Chrome. It also does not
protect you from anything Google would otherwise do. It is not a privacy tool
and it does not pretend to be one.

## What is stored on your device, and only your device

Everything below is local. None of it is transmitted.

The app's data directory is Electron's standard per-user location. The last path
segment follows the app's product name, which is not final:

| platform | directory |
|---|---|
| Linux | `~/.config/stem-workbench/` |
| macOS | `~/Library/Application Support/stem-workbench/` |
| Windows | `%APPDATA%\stem-workbench\` |

| what | where | why | how long |
|---|---|---|---|
| Your fader, mute, solo, transpose and speed settings | inside the app's data directory | so the deck looks the same next time | until you clear it |
| Which Source is armed, and the last arming error | inside the app's data directory | so the app knows what it is pointed at | the run, or until dismissed |
| **Your YouTube session** — cookies, local storage, everything the view stores | the `persist:youtube` partition, inside the app's data directory | so you do not sign in again every launch | until you sign out or clear it |
| Separated stems for tracks you have played | the origin-private file system (OPFS), inside the app's data directory | so replaying a track does not re-run the model | evicted oldest-first under a cap |
| The folder you chose for exports | inside the app's data directory | so it is asked once, not every time | until you change it |
| **The stems you export** | the folder **you** chose | because you asked for them | until you delete them. They are ordinary files and the app does not track them |
| The model weights | inside the installed application, read-only, beside the app bundle | so it works offline from first launch | it is part of the app |

**The YouTube session is in its own jar, and that is a boundary rather than a
tidiness.** The app runs **two** browser sessions: its own — the deck, the
engine, and the app's own pages — and a separate persistent partition that holds
the YouTube view and nothing else. **Nothing on our side can reach into that
partition**, and the separation is what lets the two claims above be stated
narrowly instead of reassuringly: the app's own code talks to one host; the
YouTube view's traffic and storage are yours.

**No log files.** The app writes no diagnostic log to disk in normal operation.

**One gap, named rather than glossed:** the deck's settings and the armed-Source
record are owned by the app's main process and reach the deck through the Host,
which is decided — but the **file** they are persisted into is not specified yet.
When it is, this table names it. Whatever it turns out to be, it is inside the
directory above and it is not sent anywhere.

**To clear it yourself:** deleting the data directory above removes everything
in the table except the exports you asked for and the model, which is part of
the app. Uninstalling removes the app and the model.

## What this app deliberately does not do

These are architectural rules, not current behaviour that might drift. Two of
them are inherited from the extension unchanged.

- **L1 — it never resolves, fetches or parses a media stream URL.** No
  downloader, no `yt-dlp`, no innertube, no stream-URL scraping. The code that
  talks to YouTube's player reads five values off the `<video>` element —
  `paused`, `currentTime`, `duration`, `ended` and `playbackRate`, with `seeking`
  arriving as an event rather than a poll — and writes three: `muted`, `currentTime`, `playbackRate`. That is
  transport state. It never reads `src`, `currentSrc`, `buffered` or
  `srcObject`, and never calls `captureStream()`.

  **What it does instead is capture what the player renders**, the same way a
  screen recorder captures a screen: the app answers its own display-media
  request with the view's frame. It hears what you would have heard.

- **M1 — it loads no remote code.** ONNX Runtime and the model ship with the
  app and are hash-verified as *data*. Nothing is fetched and executed.

- **P1′ — one host, above.**

**And one thing it does that the extension refuses to:** it writes audio files
to your disk. That is the reason this is a separate product with its own
documents and its own risk, and [`FAQ.md`](FAQ.md) says what it means in the
question *"You export audio. Is this a piracy tool?"*

## Children

The app is not directed at children and collects no data from anyone, including
children. It does embed YouTube, whose own terms and protections apply to what
you do there.

## Changes to this document

If the data practices change, this document changes with it and the change is
noted in the changelog. Given that the current practice is "collect nothing",
any change at all would be a significant one — and the network rule is meant to
be held by a test, so a change would have to break a gate before it could break
a promise.

## Verifying any of this yourself

Do not take our word for it.

1. **Read the source.** The whole app is in this repository, and the audio
   engine is a verifiable copy of `stem-splitter-live` at a pinned tag — one
   SHA-256 per file, checked against the upstream tag.
2. **Watch the network.** Point a proxy or a packet capture at it. The app's own
   sessions should reach GitHub and nothing else; the YouTube view will look like
   YouTube.
3. **Turn the network off and use it.** Everything except the update check works
   offline. The model is already on your disk.

(2) **is an automated acceptance test now**, and it is the one in this list you
do not have to take on trust: `node tools/verify.mjs --only p1` boots the real
app, drives a full session, and asserts that the set of network origins the app's
own sessions reached is exactly `{ https://api.github.com }` — with the YouTube
partition excluded **by name**, and the exclusion exercised with the same URL
through both sessions so that it can be seen to be doing something. The check
itself is pointed at a local server wearing GitHub's certificate, and that
server's own hit counter is half of the assertion: an instrument that sees
nothing while the server is hit is a **failure**, not a pass.
`docs/TESTING.md` §9 is what it asserts and how each assertion was watched fail.

**A gap in that test was found and closed, and it is worth saying plainly what it
was.** The observer watches Chromium's network stack, so it could not have seen a
request the app made from its own main process, outside Chromium — a `fetch()` in
one line of Node. Two independent reviewers proved it: they added that line, a
real request reached a real server, and this test stayed green over it. **No such
request was ever in a shipped or committed version of this app** — it was an
instrument gap, not a leak — but "we would have noticed" was not true, and that
is the claim this page makes. The app now removes those transports from its own
main process at start-up (`src/main/netguard.js`), so such a line throws instead
of sending; a source scan refuses the imports; and the test stands up a real
listening socket on your own machine, has the app try eleven different ways to
reach it, and requires that **nothing arrived**.

What it does **not** prove is stated there too: nothing here tests the real
GitHub, the update download does not exist yet, and the YouTube view loads a
local fixture rather than youtube.com.

Source: <https://github.com/itziklerner-pag/stem-workbench>

## Contact

Open an issue on GitHub. There is no address to write to because there is no
organisation behind this — it is one person's non-commercial project.
