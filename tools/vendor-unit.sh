#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# VENDOR THE UNIT — the upstream procedure, executed instead of read.
# ---------------------------------------------------------------------------
#
#   bash tools/vendor-unit.sh                 # re-vendor the pinned tag, fetch ORT, run the gate
#   bash tools/vendor-unit.sh --model         # ...and seed models/htdemucs_6s.onnx (109 MB)
#   bash tools/vendor-unit.sh --check         # offline: is vendor/ still what the pin says?
#   bash tools/vendor-unit.sh --model-only    # only the weights; do not touch vendor/
#   bash tools/vendor-unit.sh --tag v0.3.0 --steps 13 --assertions 1204
#
# This is `stem-splitter-live/docs/VENDORING.md` §1-§7 with nothing added to the
# mechanism and three things added around it — the sums file for the fifteen
# copied paths that `unit.sha256` does not cover, the `ours` manifest, and the
# final call into this repository's own gate. Each section below prints the §
# it is executing so the transcript can be read next to the document:
#
#   §1 fetch the TAG's archive          §5 verify the copy
#   §2 verify it before copying         §6 fetch ONNX Runtime at its pin
#   §3 derive the copy list             §7 run the unit's own gate
#   §4 copy, layout preserved
#
# WHY A SCRIPT AND NOT A CHECKLIST. A pin bump is one command, and the numbers
# it is pinned to are in one place (`vendor/.pin`) rather than in a paragraph
# somebody has to notice.
#
# ---------------------------------------------------------------------------
# WHAT IS GATED, AND WHAT IS ONLY RECORDED
# ---------------------------------------------------------------------------
#
# GATED — `extension/unit.sha256`, 35 files, checked TWICE: once inside the
#   downloaded archive before anything is copied out of it, and once against the
#   copy on disk. They fail for different reasons, which is why the document
#   asks for both.
#
# GATED — `vendor/upstream.sha256`, all 50 copied paths. `unit.sha256` covers 35
#   of them; the other fifteen are the reference Host and the harness, which
#   travel and are ours to re-aim. Nothing upstream hashes those, so this
#   repository does: the file is written once, in the vendoring commit, where the
#   50 files are visible in the same diff, and it is a gate on every run after
#   that. It is the check that answers "did somebody edit a file under vendor/
#   that is not in unit.sha256".
#
# NOT GATED — the archive's own SHA-256. It is recorded in `vendor/.pin` as
#   provenance and compared on every run, but a mismatch is a NOTE and not a
#   failure, because GitHub generates those tarballs on demand and has changed
#   their gzip framing before. It cannot carry the claim: 50 content hashes over
#   the same bytes can, they are immune to how the bytes were packed, and they
#   run five lines later. A gate that fails for a reason outside the claim is a
#   gate that gets switched off.
#
# ---------------------------------------------------------------------------
# `ours` — THE THREE FILES INSIDE vendor/ THAT ARE NOT VENDORED
# ---------------------------------------------------------------------------
#
# `extension/offscreen/host.js` and `extension/ui/host.js` are HOLES: the unit
# imports them and does not supply them, and this Host's own modules live at
# those paths, inside `vendor/`, on purpose. `extension/offscreen/host-pin.js`
# is ours for a blunter reason — the vendored runner imports four names from it
# at module scope. None of the three is in `unit.sha256` and none ever was.
#
# `vendor/.pin`'s `ours` array names them. This script BACKS THEM UP before it
# wipes the tree, RESTORES them after the copy, and EXCLUDES them from
# `upstream.sha256` — so a pin bump does not silently overwrite this Host with
# the extension's reference implementation, and so "did somebody edit the unit"
# and "did somebody edit our Host" stay two separately answerable questions.
#
# IT IS EMPTY TODAY, and that is the honest value: this Host has not written its
# hole modules yet, so all 50 files are upstream's and all 50 are gated. The
# commit that writes the first hole adds its path here, in the same commit.
#
# Two guard rails on the array, because a typo in it protects nothing and says
# nothing: every entry must be one of the 50 copied paths, and no entry may be a
# path in `unit.sha256`. The second is CONTRIBUTING.md rule V1 in executable
# form — declaring a unit file "ours" is exactly the fork this arrangement
# exists to prevent, and it would be invisible from the outside.
#
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ------------------------------------------------------------------- the pin
# Bumping the tag means bumping all four together, from the new tag's
# VENDORING.md §7. --tag alone is refused for that reason.
DEF_TAG='v0.2.0'
DEF_STEPS=12
DEF_ASSERTIONS=1156
# Observed 2026-08-26 on the tarball GitHub served for v0.2.0. Provenance, not a
# gate — see the header.
DEF_ARCHIVE_SHA='f22ef12bf29f1c46061def6905095361712ec83cb693a232da2f9bc2cbc3962b'

REPO='itziklerner-pag/stem-splitter-live'
DEST_REL='vendor/stem-splitter-live'
SUMS_REL='vendor/upstream.sha256'
PIN_REL='vendor/.pin'

TAG=''; STEPS=''; ASSERTIONS=''
DO_ORT=1; DO_GATE=1; DO_MODEL=0; DO_VENDOR=1; WRITE_SUMS=0; DO_CHECK=0
while [ $# -gt 0 ]; do
  case "$1" in
    --tag)          TAG="${2:?--tag needs a value}"; shift 2 ;;
    --steps)        STEPS="${2:?--steps needs a value}"; shift 2 ;;
    --assertions)   ASSERTIONS="${2:?--assertions needs a value}"; shift 2 ;;
    --model)        DO_MODEL=1; shift ;;
    --model-only)   DO_MODEL=1; DO_VENDOR=0; DO_ORT=0; DO_GATE=0; shift ;;
    --no-ort)       DO_ORT=0; shift ;;
    --no-gate)      DO_GATE=0; shift ;;
    --write-sums)   WRITE_SUMS=1; shift ;;
    --check)        DO_CHECK=1; shift ;;
    -h|--help)      sed -n '2,80p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *)              echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

TAG="${TAG:-$DEF_TAG}"
if [ "$TAG" = "$DEF_TAG" ]; then
  STEPS="${STEPS:-$DEF_STEPS}"; ASSERTIONS="${ASSERTIONS:-$DEF_ASSERTIONS}"
  ARCHIVE_SHA="$DEF_ARCHIVE_SHA"
else
  ARCHIVE_SHA=''
  if [ -z "$STEPS" ] || [ -z "$ASSERTIONS" ]; then
    cat >&2 <<EOF
FATAL: --tag $TAG needs --steps and --assertions with it.

  They are that tag's claim about its own gate — docs/VENDORING.md §7 in the
  archive you are about to fetch prints both. Deriving them from the run this
  script is about to make would be the gate checking its own homework: any
  shorter plan would re-pin itself and print green.
EOF
    exit 2
  fi
fi

say () { printf '\033[1m%s\033[0m\n' "$*"; }
note () { printf '  %s\n' "$*"; }
die () { printf '\033[31mFATAL: %s\033[0m\n' "$*" >&2; exit 1; }

if command -v sha256sum >/dev/null 2>&1; then
  SHA_C () { sha256sum -c "$@"; }; SHA_SUM () { sha256sum "$@"; }
elif command -v shasum >/dev/null 2>&1; then
  SHA_C () { shasum -a 256 -c "$@"; }; SHA_SUM () { shasum -a 256 "$@"; }
else
  die "neither sha256sum nor shasum is on PATH — there is no point continuing without one"
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
SRC="$WORK/stem-splitter-live-${TAG#v}"

# ---------------------------------------------------------------------------
# --check — "is vendor/ still what the pin says it is", offline, in 0.1 s.
# ---------------------------------------------------------------------------
#
# `shasum -c` ANSWERS ONLY THE QUESTION IT IS ASKED, and the question it is
# asked is about the files in the list. It cannot see a file that was ADDED
# under vendor/, which is the shape a local fix takes when someone knows they
# must not edit an existing file — so the last assertion below is a set
# comparison and not a checksum.
#
# Prints in this repository's convention (docs/TESTING.md, "How a suite
# prints"), so wiring it into `STEPS` is one row there and one row in the suite
# table. Watched red by mutation:
#
#   echo '// x' >> vendor/stem-splitter-live/extension/shared/config.js   -> assertion 2 RED
#   echo '// x' >> vendor/stem-splitter-live/test.js                      -> assertion 3 RED  (test.js is not in unit.sha256)
#   touch vendor/stem-splitter-live/extension/shared/oops.js              -> assertion 5 RED
#   jq '.ours=["extension/shared/wav.js"]' vendor/.pin                    -> assertion 4 RED
#
if [ "$DO_CHECK" = 1 ]; then
  ID='vendor-intact'
  DEST="$ROOT/$DEST_REL"
  P=0; F=0
  chk () { if [ "$2" = 0 ]; then printf 'ok   %s\n' "$1"; P=$((P+1)); else printf 'FAIL %s\n' "$1"; F=$((F+1)); fi; }

  st=0; [ -f "$ROOT/$PIN_REL" ] && [ -f "$ROOT/$SUMS_REL" ] && [ -d "$DEST" ] || st=1
  chk "the pin, the sums file and the vendored tree are all present  [entry point: $PIN_REL]" $st
  if [ "$st" != 0 ]; then
    printf '\n%s: %s passed, %s failed\n' "$ID" "$P" "$F"; exit 1
  fi
  # JSON.parse, not require(): vendor/.pin has no .json extension, so require()
  # cannot pick a loader for it and throws — which showed up as an empty tag in
  # the assertion name rather than as an error.
  PIN_TAG=$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).tag||""))' "$ROOT/$PIN_REL" 2>/dev/null || true)
  OURS=$(node -e 'console.log((JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).ours||[]).join("\n"))' "$ROOT/$PIN_REL" 2>/dev/null || true)

  st=0; ( cd "$DEST" && SHA_C extension/unit.sha256 ) >"$WORK/c1" 2>&1 || st=1
  [ "$st" = 0 ] || grep -v ': OK$' "$WORK/c1" >&2 || true
  chk "the $(grep -c . "$DEST/extension/unit.sha256") unit files are byte-identical to $PIN_TAG — nobody edited the unit  [entry point: $DEST_REL/extension/unit.sha256]" $st

  st=0; ( cd "$DEST" && SHA_C "$ROOT/$SUMS_REL" ) >"$WORK/c2" 2>&1 || st=1
  [ "$st" = 0 ] || grep -v ': OK$' "$WORK/c2" >&2 || true
  chk "...and so are all $(grep -c . "$ROOT/$SUMS_REL") copied paths, including the $(( $(grep -c . "$ROOT/$SUMS_REL") - $(grep -c . "$DEST/extension/unit.sha256") )) that unit.sha256 does not cover — the reference Host and the harness  [entry point: $SUMS_REL]" $st

  # `ours` is the ONE place a file under vendor/ may legitimately differ from
  # upstream, so it is also the one place a fork could be declared legal. Both
  # halves are checked: an entry that is a unit file is a fork, and an entry
  # that is still gated by upstream.sha256 is an entry that does nothing.
  st=0; BAD=''
  if [ -n "$OURS" ]; then
    while read -r q; do
      [ -n "$q" ] || continue
      [ -f "$DEST/$q" ] || BAD="$BAD\n  $q is declared ours and is not in the tree"
      if grep -qF "  $q" "$DEST/extension/unit.sha256"; then BAD="$BAD\n  $q is declared ours and IS a unit file — that is a fork, not a hole (CONTRIBUTING.md V1)"; fi
      if grep -qF "  $q" "$ROOT/$SUMS_REL"; then BAD="$BAD\n  $q is declared ours and is still gated by $SUMS_REL — one of the two is wrong"; fi
    done <<< "$OURS"
  fi
  [ -z "$BAD" ] || { st=1; printf '%b\n' "$BAD" >&2; }
  chk "every path \`ours\` claims is a hole and not a unit file  [entry point: $PIN_REL .ours = [$(echo "$OURS" | tr '\n' ' ')]]" $st

  # ORT and the runner's own logs are the two things under the tree that are
  # deliberately not recorded: one is fetched by the pin, the other is output.
  find "$DEST" -type f | sed "s|^$DEST/||" | grep -v '^extension/vendor/ort/' | grep -v '^out/' | sort > "$WORK/actual"
  { cut -c67- "$ROOT/$SUMS_REL"; printf '%s\n' "$OURS" | grep . || true; } | sort > "$WORK/recorded"
  st=0; diff "$WORK/recorded" "$WORK/actual" > "$WORK/extra" || st=1
  [ "$st" = 0 ] || { echo "  < recorded   > actually on disk" >&2; cat "$WORK/extra" >&2; }
  chk "no file was added to or removed from $DEST_REL behind the sums file  [entry point: $SUMS_REL + .ours]" $st

  printf '\n%s: %s passed, %s failed\n' "$ID" "$P" "$F"
  [ "$F" = 0 ] || exit 1
  exit 0
fi

# ---------------------------------------------------------------- §1  fetch
say "§1  fetch $REPO $TAG"
curl -fsSL "https://github.com/$REPO/archive/refs/tags/$TAG.tar.gz" -o "$WORK/archive.tar.gz" \
  || die "could not fetch the archive for $TAG. A TAG, never a branch: a copy taken off main is a copy whose verification step is theatre."
GOT_ARCHIVE_SHA="$(SHA_SUM "$WORK/archive.tar.gz" | cut -d' ' -f1)"
note "$(du -h "$WORK/archive.tar.gz" | cut -f1)  sha256 $GOT_ARCHIVE_SHA"
if [ -n "$ARCHIVE_SHA" ] && [ "$GOT_ARCHIVE_SHA" != "$ARCHIVE_SHA" ]; then
  note "NOTE: that differs from the digest recorded in this script ($ARCHIVE_SHA)."
  note "      GitHub builds these tarballs on demand and has changed their gzip framing before,"
  note "      so this is not a failure by itself. The 50 content hashes below are the gate — if"
  note "      the tag really moved, §2 or §5 goes red and names the files."
fi
tar xzf "$WORK/archive.tar.gz" -C "$WORK"
[ -d "$SRC" ] || die "the archive did not unpack to $(basename "$SRC")"

# ------------------------------------------------------- §2  verify the archive
if [ "$DO_VENDOR" = 1 ]; then
say "§2  verify the archive against extension/unit.sha256, before copying out of it"
WANT_UNIT=$(grep -c . "$SRC/extension/unit.sha256")
( cd "$SRC" && SHA_C extension/unit.sha256 >"$WORK/check1.txt" 2>&1 ) \
  || { grep -v ': OK$' "$WORK/check1.txt" >&2 || true
       die "the archive does not match its own sums file. Corrupt download, a rewritten tarball, or an archive that is not the tag it claims to be — and nothing further down is worth doing until you know which."; }
note "$(grep -c ': OK$' "$WORK/check1.txt") of $WANT_UNIT files OK"

# --------------------------------------------------- §3  derive the copy list
say "§3  derive the copy list from extension/unit.json"
( cd "$SRC" && node -e '
const fs = require("fs"), d = require("./extension/unit.json"), ext = (p) => "extension/" + p;
const unit    = fs.readFileSync("extension/unit.sha256", "utf8").trim().split("\n").map((l) => l.slice(66));
const host    = [...d.holes.map((h) => ext(h.path)),
                 ...d.hostReads.map((r) => ext(r.path)),
                 ...[...d.suites, ...d.runners].flatMap((s) => (s.reads || []).map(ext))];
const harness = [...d.suites, ...d.runners].map((s) => s.path);
console.log([...new Set([...unit, ...host, ...harness,
  "extension/unit.sha256", ...d.external.map((e) => e.fetch)])].sort().join("\n"));
' ) > "$WORK/list.txt" || die "could not derive the copy list from extension/unit.json"
N_LIST=$(grep -c . "$WORK/list.txt")
[ "$N_LIST" -gt 0 ] || die "the derived copy list is empty"
# The document does not check this and it is one line: a declared path that is
# not in the archive is a manifest that has drifted from its own tree, and the
# copy fails LATE and quietly instead — an unresolved import at boot.
MISSING=$(cd "$SRC" && while read -r p; do [ -e "$p" ] || echo "$p"; done < "$WORK/list.txt")
[ -z "$MISSING" ] || die "extension/unit.json names paths that are not in the archive:
$MISSING"
note "$N_LIST paths, all present in the archive"

# ------------------------------------------------------------- §3b  the manifest
OURS=$(node -e '
const fs = require("fs");
try { const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      console.log((p.ours || []).join("\n")); } catch { }
' "$ROOT/$PIN_REL")
if [ -n "$OURS" ]; then
  while read -r p; do
    [ -n "$p" ] || continue
    grep -qxF "$p" "$WORK/list.txt" || die "$PIN_REL lists \"$p\" in \`ours\`, and it is not one of the $N_LIST copied paths. A typo there protects nothing and says nothing."
    if grep -qF "  $p" "$SRC/extension/unit.sha256"; then
      die "$PIN_REL lists \"$p\" in \`ours\`, and it IS a unit file (it is in extension/unit.sha256). That is not a hole, it is a fork — CONTRIBUTING.md rule V1."
    fi
  done <<< "$OURS"
  note "ours: $(echo "$OURS" | tr '\n' ' ')— preserved across the copy, excluded from $SUMS_REL"
else
  note "ours: none yet — all $N_LIST files are upstream's and all $N_LIST are gated"
fi

# --------------------------------------------------------------- §4  copy
say "§4  copy into $DEST_REL, repo-relative layout preserved"
DEST="$ROOT/$DEST_REL"
if [ -n "$OURS" ] && [ -d "$DEST" ]; then
  mkdir -p "$WORK/ours"
  while read -r p; do
    [ -n "$p" ] || continue
    if [ -f "$DEST/$p" ]; then mkdir -p "$WORK/ours/$(dirname "$p")"; cp -p "$DEST/$p" "$WORK/ours/$p"; fi
  done <<< "$OURS"
fi
# Wholesale, so a file that upstream DELETED at the new tag leaves too. ORT is
# not in the copy and is refetched by §6; keeping it would make --no-ort mean
# two different things on a first run and a re-run.
rm -rf "$DEST"
mkdir -p "$DEST"
( cd "$SRC" && tar -cf - -T "$WORK/list.txt" ) | tar -x -C "$DEST"
N_COPIED=$(find "$DEST" -type f | wc -l | tr -d ' ')
[ "$N_COPIED" = "$N_LIST" ] || die "copied $N_COPIED files, the list has $N_LIST"
note "$N_COPIED files"

# ------------------------------------------------------- §5  verify the copy
say "§5  verify the copy"
( cd "$DEST" && SHA_C extension/unit.sha256 >"$WORK/check2.txt" 2>&1 ) \
  || { grep -v ': OK$' "$WORK/check2.txt" >&2 || true; die "the copy does not match extension/unit.sha256"; }
note "$(grep -c ': OK$' "$WORK/check2.txt") of $WANT_UNIT unit files OK"

# ...and the fifteen paths unit.sha256 does not cover.
( cd "$DEST" && SHA_SUM $(tr '\n' ' ' < "$WORK/list.txt") ) | sort -k2 > "$WORK/sums.txt"
cp "$WORK/sums.txt" "$WORK/gated.txt"
if [ -n "$OURS" ]; then
  # `ours` files are this Host's, so their hashes are neither upstream's to
  # promise nor ours to freeze — they change every time we edit our own code.
  while read -r p; do
    [ -n "$p" ] || continue
    grep -v "  $p\$" "$WORK/gated.txt" > "$WORK/g2" || true
    mv "$WORK/g2" "$WORK/gated.txt"
  done <<< "$OURS"
fi
N_GATED=$(grep -c . "$WORK/gated.txt")
if [ -f "$ROOT/$SUMS_REL" ] && [ "$WRITE_SUMS" = 0 ]; then
  ( cd "$DEST" && SHA_C "$ROOT/$SUMS_REL" >"$WORK/check3.txt" 2>&1 ) \
    || { grep -v ': OK$' "$WORK/check3.txt" >&2 || true
         die "the copy does not match $SUMS_REL. Either the tag moved under us, or somebody edited a file under $DEST_REL that is not in unit.sha256 — see CONTRIBUTING.md rule V1. --write-sums re-records it, deliberately."; }
  # A new tag that adds or drops a copied path is a review event, not a diff
  # nobody reads: the recorded path set must be the gated list, exactly.
  if ! diff <(cut -c67- "$WORK/gated.txt" | sort) <(cut -c67- "$ROOT/$SUMS_REL" | sort) > "$WORK/paths.diff"; then
    cat "$WORK/paths.diff" >&2
    die "the copy list at $TAG is not the path set recorded in $SUMS_REL. --write-sums re-records it, deliberately."
  fi
  note "$(grep -c ': OK$' "$WORK/check3.txt") of $N_GATED gated paths match $SUMS_REL"
else
  cp "$WORK/gated.txt" "$ROOT/$SUMS_REL"
  note "wrote $SUMS_REL — $N_GATED of $N_LIST paths at $TAG"
fi

if [ -n "$OURS" ] && [ -d "$WORK/ours" ]; then
  ( cd "$WORK/ours" && find . -type f | sed 's|^\./||' ) | while read -r p; do cp -p "$WORK/ours/$p" "$DEST/$p"; done
  note "restored $( ( cd "$WORK/ours" && find . -type f | wc -l ) | tr -d ' ') file(s) from \`ours\`"
fi

# ------------------------------------------------------------ §6  ONNX Runtime
if [ "$DO_ORT" = 1 ]; then
  say "§6  fetch ONNX Runtime with the unit's own tools/fetch-vendor.sh"
  ( cd "$DEST" && bash tools/fetch-vendor.sh ) || die "tools/fetch-vendor.sh failed"
else
  say "§6  ONNX Runtime — SKIPPED (--no-ort)"
fi

# ------------------------------------------------------------------- the pin
node -e '
const fs = require("fs");
const [file, tag, steps, assertions, archive, url] = process.argv.slice(1);
let ours = [];
try { ours = JSON.parse(fs.readFileSync(file, "utf8")).ours || []; } catch { }
fs.writeFileSync(file, JSON.stringify({
  tag, steps: Number(steps), assertions: Number(assertions),
  archive: { url, sha256: archive },
  ours,
}, null, 2) + "\n");
' "$ROOT/$PIN_REL" "$TAG" "$STEPS" "$ASSERTIONS" "$GOT_ARCHIVE_SHA" \
  "https://github.com/$REPO/archive/refs/tags/$TAG.tar.gz"
say "pin  $PIN_REL -> $TAG, $STEPS steps, $ASSERTIONS assertions"
fi   # DO_VENDOR

# -------------------------------------------------------------- §7  the gate
if [ "$DO_GATE" = 1 ]; then
  say "§7  run the unit's own gate — through this repository's step, not beside it"
  note "node tools/verify.mjs --only vendor-unit"
  # NOT a second copy of the check. `vendor-unit` in tools/verify.mjs already
  # runs `--unit --no-reap` inside the copy and holds the result to vendor/.pin;
  # re-implementing that here is the two-runners-drift mistake one level down.
  ( cd "$ROOT" && node tools/verify.mjs --only vendor-unit ) || die "the vendored unit's gate did not pass. If it is red here, before anything has been changed, the copy is wrong — re-read §4."
fi

# ------------------------------------------------------------- the weights
if [ "$DO_MODEL" = 1 ]; then
  say "model  seed models/htdemucs_6s.onnx with the unit's own tools/fetch-model.sh"
  # RUN FROM THE ARCHIVE, NOT FROM THE COPY, because fetch-model.sh does not
  # travel: it is not in `external` in unit.json (the weights are a Host duty,
  # not a dependency of the unit), so the derived list never names it. The copy
  # has everything the script READS — shared/config.js for what the bytes must
  # be, tools/host.mjs and offscreen/host-pin.js for where they come from — and
  # not the script itself. The archive has all four, so it runs there and the
  # verified file is moved here afterwards.
  ( cd "$SRC" && bash tools/fetch-model.sh ) || die "tools/fetch-model.sh failed"
  REL=$(cd "$SRC" && node -e 'import("./tools/host.mjs").then((m) => process.stdout.write(m.MODEL_SEED_REL))')
  mkdir -p "$ROOT/$(dirname "$REL")"
  mv "$SRC/$REL" "$ROOT/$REL"
  note "$REL  $(du -h "$ROOT/$REL" | cut -f1)  (dev only — not in git; the installer's copy is a later task)"
fi

say "done."
