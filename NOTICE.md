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
| **redistributed here?** | **Yes — bundled in the installer** (seed §15, option M2) |
| source | a third-party ONNX **re-export** on Hugging Face, pinned by commit SHA |
| pin | URL, SHA-256 and byte count in the vendored unit's `shared/config.js` — the single source of truth every script derives from |
| size | 114,559,139 bytes (109 MiB) |
| integrity | the SHA-256 check runs on every load, against the bundled file |

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
| what | [ONNX Runtime Web](https://onnxruntime.ai/), WebGPU + threaded-WASM build |
| origin | Microsoft |
| licence | MIT |
| how | vendored at build time and hash-verified, as `tools/fetch-vendor.sh` does today |

## Electron and Chromium

Electron is MIT; Chromium and its dependencies carry their own licences, which
Electron's `LICENSES.chromium.html` reproduces and which ship inside the app.

## Trademarks

YouTube is a trademark of Google LLC. This project is not affiliated with,
endorsed by, or sponsored by Google or Meta.
