# UPDATES.md — the release channel, the update check, and the half that is not armed

Written 2026-08-26, against stem-workbench `7aab436` + this slice, and
`electron-updater@6.8.9` / `electron-builder@26.15.3` read on this box. Every
file, line number and byte count below was observed here. Nothing is inferred.

This document exists because seed §14 asks for one sentence —

> Auto-update: default ON with a visible toggle, via electron-updater against
> GitHub Releases, following the pre-release channel during beta.

— and that sentence turns out to contain two halves with very different
statuses. **The CHECK is built, gated and running. The DELIVERY is configured
and cannot be armed without changing rule P1′.** Which half is which is the
whole point of this file.

---

## 1. What runs

| | |
|---|---|
| host | `api.github.com`, and nothing else. Spelled once, in `src/main/update.js` |
| endpoint | `GET /repos/itziklerner-pag/stem-workbench/releases?per_page=20` |
| transport | `Session.fetch` on the `app` session — the one the P1′ observer is installed on |
| channel | `prerelease` (`UPDATE_CHANNEL`), decided by `pickRelease()` |
| when | once, after the window is up, never awaited, never able to fail a boot |
| default | ON. `AUTO_UPDATE_DEFAULT = true`, `local` storage, key `autoUpdate` |
| toggle | a checkbox in the 44 px chrome bar (`src/renderer/chrome.html` `#autoupdate`) |
| gates | `updates` (36 assertions, no display) and `p1` (24, one real launch) |

### `/releases/latest` could never follow the pre-release channel

This is the defect the slice found in the code it was extending. The check used
to ask `GET /repos/{owner}/{repo}/releases/latest`, and GitHub defines that
endpoint as **"the most recent non-prerelease, non-draft release"**. On a
repository whose only releases are pre-releases it answers 404 for ever; on one
that has both it answers the *stable* tag and silently skips every beta.

So the channel was not a decision the code was making. It was a decision the
endpoint had already made, in the wrong direction, invisibly — and no assertion
anywhere could have seen it, because a 404 and "no update available" look the
same from the outside.

`UPDATE_PATH` is now the list endpoint and `pickRelease(list, channel)` makes
the decision, as a pure function, over a table:

| rule | why |
|---|---|
| a **draft** is never offered, on either channel | it is unpublished: its assets are not downloadable and its tag may not exist |
| `prerelease` offers a pre-release **or a stable release** | a beta user who is behind a stable release is still behind. Prereleases-only strands every tester the day the first full release ships |
| `stable` offers only a full release | that is the entire difference between the two channels, and it is why this is a value and not a boolean |
| newest by `published_at`, not by array order | GitHub documents the list endpoint as ordered by **creation**; a release created early and published late outranks a newer one under array order |

### The toggle

Default ON is deliberate and the argument is on the record in
`docs/adr/0001-the-shape-of-the-desktop-product.md`: **this app ships its own
Chromium and loads youtube.com in it, so it owns Chromium's security patches.**
Electron ships them roughly every two weeks. An app that cannot tell the user it
is out of date has a worse posture than the extension, where Google did this.

It is stored in the `local` area and not `session`, and that is not a detail.
`src/main/storage.js` rule 5: *"`local` outlives the browser and `session` does
not."* A preference stored in `session` silently returns to its default on every
restart — which for THIS preference means an app the user switched off switching
itself back on. `updates` measures the difference rather than asserting the
string: it writes through one `createStorage()`, reads back through a second
over the same directory, and carries a **control** proving the same value in
`session` does *not* survive.

The user's preference is **ANDed** with the command line, never substituted for
it. `--gate` turns the check off for a whole launch and five windowed suites
depend on that; a preference file left behind in a profile must not be able to
put a gate launch on the network.

---

## 2. What is configured and does not run

`package.json`'s `build.publish` is the electron-updater feed:

```json
{ "provider": "github", "owner": "itziklerner-pag", "repo": "stem-workbench",
  "releaseType": "prerelease", "vPrefixedTagName": true }
```

electron-builder writes it into **`app-update.yml` inside the installer**, which
is where `autoUpdater` reads its feed at runtime. That file is produced —
verified by `dist-linux`, which builds an artifact and reads the channel out of
its resources. `publish: null`, the previous value, produced no such file, which
is an installer that can never update itself however well the app is written.

`--publish never` stays on every `dist:*` script and on `dist-linux`'s own
invocation. **`publish` naming a feed and `--publish never` are different
things**, and the standing ruling only forbids the second: this project never
creates a GitHub Release from automation.

### Why `electron-updater` is not a dependency of this app

It was read, not assumed. Three findings, each of which alone would be enough:

| | measured at | consequence |
|---|---|---|
| it makes its **own session** — `session.fromPartition("electron-updater", {cache:false})` | `electron-updater/out/electronHttpExecutor.js:7` | a session created outside `src/main/sessions.js`, therefore outside the P1′ observer. `sessions.js` exists because *"a session nobody observed reads exactly like a session that made no requests"* |
| the public GitHub provider's host is **`github.com`**, not `api.github.com` | `out/providers/GitHubProvider.js:32` (the `.atom` feed at `:43`, the channel `.yml` under `/releases/download/`) | `mayRequest()` **cancels every request it makes**. `api.github.com` is the *private* provider's host |
| a release asset **redirects to `objects.githubusercontent.com`** | GitHub's own asset serving | the download path is irreducibly two hosts |

P1′ names **one** host. Arming electron-updater would name three and add an
unobserved session — in exchange for a download that cannot happen anyway,
because this project never creates a Release. So it is not installed, not
imported, and not in the bundle. An unimported dependency would be exactly the
empty coverage `AGENTS.md` forbids, with an unobserved session attached.

### What would have to change first, in order

1. **A decision to name a second host.** P1′ becomes *"exactly two named hosts,
   `github.com` and `objects.githubusercontent.com`, for the update check and
   the update download"*, in `CONTRIBUTING.md`, `PRIVACY.md` and
   `src/main/p1.js` — the constant, so the gate moves with it.
2. **The updater's session through the factory.** `sessions.js` must create the
   `electron-updater` partition itself, before anything imports the updater, so
   `session.fromPartition` hands back a session the observer is already on; and
   `SESSION_OWNERS` must declare whose traffic it is.
3. **`p1` re-measured**, not re-pinned. Its assertion is a SET over origins; a
   second host is a change to what the app does and the transcript has to say so.
4. **A GitHub Release must exist.** Standing ruling: not from automation, and
   not from here.

Until (1) is an owner decision, this section is the honest status and the app
tells the user a newer pre-release exists rather than fetching it.

### The AppImage update problem, and the decision it forces — issue #12

Issue #12 states it and asks for a decision rather than an absorption:

> Windows NSIS and macOS zip updates are **differential**: the unchanged model
> blocks — around 109 MiB of the ~300 MB artifact — are not re-downloaded. **A
> Linux AppImage update re-ships the whole artifact.** Every update is a full
> 300 MB download for a change of a few kilobytes of JavaScript.

It offers three options: accept it and say so at the point the user is offered
an update; prefer the `.deb` where the user installed one; or do not auto-update
the AppImage at all and notify instead.

**This implementation takes the third, and takes it on every platform.** That is
not a Linux workaround that happened to fit — it falls out of P1' above, which
forbids the second host a download needs on any platform at all. So the question
issue #12 raises does not get a Linux-specific answer here; it gets an answer
that applies everywhere and removes the asymmetry:

| | |
|---|---|
| **what the app does** | tells you a newer pre-release exists |
| **what it does not do** | fetch it, verify it, stage it, or restart into it — on Linux, macOS or Windows |
| **what that costs** | the user does a manual download. On AppImage that is the 300 MB they would have paid anyway; on Windows and macOS it is a differential update they no longer get |
| **when it changes** | when an owner widens P1' to name the hosts a download needs. Section 2's list, in order |

The AppImage's 197 MB and the deb's 158 MB were measured on this box, from the
build `dist-linux` makes. The differential advantage NSIS and zip would have had
is real and is being given up; saying that plainly is the point of this table.

---

## 3. Platforms

The standing ruling is that **Linux is the verification platform**; macOS and
Windows are electron-builder configuration and CI, written here and built
nowhere.

| | status | evidence |
|---|---|---|
| **Linux** — AppImage + deb | **BUILT AND RUN** | `dist-linux`: `electron-builder --linux --publish never` produces both, and the AppImage is launched under `xvfb` to the app's own `[main] ready` line with the bundled weights hash-verified |
| **macOS** — dmg + zip, hardened runtime, notarized | **CONFIGURED, NEVER BUILT** | `build.mac` + `build/entitlements.mac.plist`. No Mac, no Developer ID, no app-specific password. `notarize: true` is left on so a machine that HAS them does the right thing and one that does not fails loudly |
| **Windows** — NSIS, **unsigned during beta** | **CONFIGURED, NEVER BUILT** | `build.win`. Seed §14: testers click through SmartScreen until a certificate exists |
| **Windows** — Azure Trusted Signing | **CONFIGURED, NEVER EXECUTED** | `scripts["dist:win:signed"]` |

**One thing the macOS and Windows blocks DO have behind them.** electron-builder
validates the WHOLE `build` object against its schema before it packages
anything, and refuses unknown properties — that is how `build.linux.desktopName`
was caught (it is a top-level `package.json` key, not a `build.linux` one). So a
green `dist-linux` is evidence that electron-builder itself ACCEPTS the `mac` and
`win` blocks, not merely that the JSON has plausible keys in it. It is still not
evidence that either builds, signs or runs.

### Why Azure Trusted Signing is on a script and not in `build.win`

`app-builder-lib/out/winPackager.js:35` switches to the Azure signer **the
moment `win.azureSignOptions` exists**, and `WindowsSignAzureManager.initialize()`
then runs PowerShell `Install-Module -Name TrustedSigning` unconditionally. So a
block sitting in `build.win` would break every unsigned beta build — which is
the *"config that cannot run"* `package.json`'s own `buildNotes` header already
refuses.

Putting the four fields on `dist:win:signed` instead leaves `npm run dist:win`
producing the unsigned exe seed §14 asks for, while the configuration is
committed, greppable, and asserted by `updates`:

```
electron-builder --win --publish never \
  -c.win.azureSignOptions.publisherName="stem-workbench" \
  -c.win.azureSignOptions.endpoint="https://weu.codesigning.azure.net" \
  -c.win.azureSignOptions.codeSigningAccountName="stem-workbench" \
  -c.win.azureSignOptions.certificateProfileName="stem-workbench-public-trust"
```

It needs three Microsoft Entra environment variables, which this repository does
not have: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`. The
endpoint region and the two account names are placeholders until somebody buys
the certificate; they are spelled out so the shape is reviewable rather than
discovered by whoever runs it first.

### Known-deferred verification — `dist-linux` SKIPs in the main checkout

**Recorded 2026-08-26. Deferred by ruling, not by oversight.**

`electron-builder` is declared in `devDependencies` and **has never been
installed in the main checkout** — which is why `npm run dist:linux` had never
run on this box at all before this slice. Everything above was measured in a
worktree seeded with an INDEPENDENT copy of `node_modules` rather than the usual
`cp -al` hardlink farm, precisely so an `npm install` there could not corrupt the
main checkout for the other agents working on it.

Installing it in the main checkout means `npm ci`, and `npm ci` **deletes
`node_modules`** — which every concurrent worktree is hardlinked to
(`.handoff/WORKTREES.md` §2.3). Running it while agents are gating would break
their trees mid-flight. So it is scheduled for after the desktop worktrees are
landed and torn down, together with a re-seed sweep.

| | |
|---|---|
| **until then** | `dist-linux` SKIPs, with a machine reason that names `electron-builder` and says `npm ci` in the main checkout is the fix. A SKIP is the correct verdict for *"the toolchain is not installed here"* — `docs/TESTING.md` §3 rule 8 — and `--strict` turns it into exit 2 rather than letting it read as success |
| **what is NOT deferred** | the evidence. The AppImage and the deb were built and the AppImage was launched to the app's own `[main] ready` line, in the worktree, on 2026-08-26. What is deferred is the same run happening from the canonical checkout |
| **who** | the integrator, on the `npm ci` + re-seed sweep |

### The deb needed a maintainer, and the first build proved it

The first Linux build on this box **wrote the AppImage and then failed**:

```
⨯ Please specify author 'email' in the application package.json
  It is required to set Linux .deb package maintainer.
  at FpmTarget.computeFpmMetaInfoOptions (app-builder-lib/src/targets/FpmTarget.ts:126:13)
```

`dist/` looked like a successful build with one file missing. That is why
`dist-linux`'s first assertion is a **set** over both targets rather than a
check that something was produced.

---

## 4. What none of this proves

- **No installer has been signed or notarized anywhere.** Not on this box, not
  in CI. `.github/workflows/package.yml` has never run.
- **No update has ever been downloaded or applied,** on any platform. There is
  no Release to download and the code to apply one is not in the bundle.
- **The AppImage launch runs `--no-sandbox`**, because `chrome-sandbox` in a
  freshly built tree is not setuid root and nothing here runs as root. Renderer
  isolation is `shell`'s claim, over a checkout.
- **The `.deb` is built and never installed.** Issue #12 asks for the bundled
  model to be readable *"inside an AppImage and inside a `.deb` install"*;
  `dist-linux` proves the first — the unit hash-verifies the installer's own copy
  through `process.resourcesPath` at runtime — and the second needs root on this
  box and has not been done. The deb's contents are asserted only as a file that
  exists at the size `latest-linux.yml` claims.
- **macOS has never run this app at all** — `docs/TESTING.md` §11.
