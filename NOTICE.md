# Notices, attribution, and the non-commercial statement

This file exists in the **first commit** of this repository, before any product
code, because the constraint it states is not a licensing footnote — it decides
what this product is allowed to be. (`desktop-app-plan.md` seed §5: *"`NOTICE`
says so from the first commit."*)

---

## stem-workbench is non-commercial, permanently

**The distributed application may not be sold, licensed, monetised, or bundled
into anything commercial. Not now, not later.**

- **Donations are fine.**
- **Paid tiers are not.** No licence keys, no pro edition, no donation-gated
  features.
- **Bundling is not.** It may not be shipped inside, alongside, or as an
  inducement to buy any commercial product or service.

This is a property of the *shipped artifact*, and it is enforced by the model
weights below, not by a preference. It also travels to forks: our MIT grant
covers our code and nothing else.

### Why — and why it is stricter here than in the extension

[`stem-splitter-live`](https://github.com/itziklerner-pag/stem-splitter-live)
does **not** redistribute the weights; it downloads them at runtime and
hash-verifies them, so its `NOTICE.md` can say *"we do not redistribute the
weights"*.

**stem-workbench will redistribute them.** The plan's model-delivery decision
(seed §15, option M2) packages the ONNX **inside the installer**, unpacked from
asar so ONNX Runtime can read it by path. That removes a first-run download and
a third-party single point of failure — and in exchange, this project becomes a
**distributor** of CC BY-NC 4.0 material. The extension's
"we-do-not-redistribute" position does not carry over, so the non-commercial
term binds the artifact directly.

The six-stem contract is model-specific. A commercial door would mean different
weights, a different contract, and no shared engine — a different product.

---

## The model weights — Demucs `htdemucs_6s`

| | |
|---|---|
| what | Hybrid Transformer Demucs v4, six-source variant (27.4 M parameters) |
| origin | [facebookresearch/demucs](https://github.com/facebookresearch/demucs) — Meta Platforms, Inc. |
| code licence | MIT |
| **weights licence** | **CC BY-NC 4.0 — non-commercial** |
| attribution | Meta Platforms, Inc. / the Demucs authors |
| **redistributed here?** | **Not yet, and by design it will be: bundled in the installer** (seed §15, option M2). **There is no installer today** — `package.json`'s `build` key declares the `extraResources` entry that will carry the file, `*.onnx` is in `.gitignore`, and this repository therefore redistributes nothing at the time of writing. `models/htdemucs_6s.onnx` is a development-only file the vendoring script fetches. The non-commercial term below binds anyway, because it binds the artifact this project intends to ship and there is no version of it that does not carry these weights |
| source | a third-party ONNX **re-export** on Hugging Face, pinned by commit SHA |
| pin | SHA-256 and byte count in the vendored unit's `shared/config.js` (`MODEL`); the **URL** is in `extension/offscreen/host-pin.js`, which `config.js` :297-305 documents as a deliberate split. Both files are vendored, byte-identical to the tag, and gated by `vendor/upstream.sha256`. *(An earlier version of this row sent readers to `config.js` for the URL, which is not there.)* |
| the URL, in full | `https://huggingface.co/arjune123/demucs-onnx/resolve/0168b73c5fbf38462be79c051b003844a4820e7a/htdemucs_6s.onnx` — pinned by a 40-hex commit, so the bytes cannot move under the pin. **stem-workbench never resolves it**: the app serves the file over its own `app://` origin, and rule P1′ binds this app's own code to exactly one host, which is not this one |
| size | 114,559,139 bytes (109 MiB) |
| integrity | the SHA-256 check runs on **every load**, in the vendored unit, over whatever the Host hands it — measured, not described: flipping one byte at offset 50,000,000 (byte count unchanged, so only the hash can catch it) makes the engine refuse with the computed digest. The Host cannot skip it: `modelBytes()` in our hole module verifies nothing, and the verification lives in `shared/modelcache.js`, which is vendored and gated |

> The Demucs **code** is MIT. The **pretrained weights** are not. Meta's
> position is that the weights are released under CC BY-NC 4.0 and provided for
> scientific purposes; they were trained partly on a proprietary dataset.
> **Nobody can relicense them, including us.**

**Known limitation, stated rather than buried:** the pinned artifact is a
third-party ONNX re-export, **not an official Meta release, and it carries no
model card of its own.** Attribution above is to Demucs/Meta as the origin of
the weights; the re-export's own provenance is thinner than we would like. If
you are the author of that re-export and would like different attribution, or
would like us to point somewhere else, please open an issue.

---

## This repository's own code — MIT

[`LICENSE`](LICENSE). MIT, matching the vendored unit so the two can share code
without a licence seam.

**The MIT grant covers our code only.** It grants you nothing about the weights.
If you want to ship something commercial, you need weights you are allowed to
use commercially — train your own, or use a permissively-licensed separator.

## The vendored unit — engine and deck

The audio engine and the mixing deck are vendored from `stem-splitter-live` by
pinned tag + SHA-256, behind a Host seam (ADR 0001 in that repository). MIT,
same holder.

## ONNX Runtime Web

| | |
|---|---|
| what | [ONNX Runtime Web](https://onnxruntime.ai/), WebGPU + threaded-WASM build, at **1.27.0** |
| origin | Microsoft |
| licence | MIT |
| how | fetched from npm at vendor time by the unit's own `tools/fetch-vendor.sh`, into a gitignored directory (~27 MB of wasm plus ~928 KB of glue) |
| pinned by whom | **the unit pins two of the four artefacts and copies the other two with no hash at all** — `ort.all.bundle.min.mjs` and `ort-wasm-simd-threaded.jsep.wasm` have `verify` lines in that script; `ort-wasm-simd-threaded.mjs` and `ort-wasm-simd-threaded.jsep.mjs` do not, and the script's own comment records that the glue `.mjs` is loaded and run. That is an upstream gap and rule V1 forbids fixing it inside `vendor/`. **This repository pins all five files itself**, in `vendor/.pin`'s `ort` block, and `bash tools/vendor-unit.sh --check` re-hashes every one of them offline on every gate run |

## Electron and Chromium

Electron is MIT; Chromium and its dependencies carry their own licences, which
Electron's `LICENSES.chromium.html` reproduces and which ship inside the app.

## Trademarks

YouTube is a trademark of Google LLC. This project is not affiliated with,
endorsed by, or sponsored by Google or Meta.
