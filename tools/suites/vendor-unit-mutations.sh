#!/usr/bin/env bash
# Watch the `vendor-unit` step go RED **both ways**, one mutation at a time.
# AGENTS.md: "An assertion you did not watch fail is not evidence."
#
# WHY THIS STEP NEEDS ITS OWN BATTERY. `vendor-unit` is the only step in
# `tools/verify.mjs` whose expected outcome is a NON-ZERO EXIT: the vendored
# `test.js` crashes with this Host's hole modules in place (upstream issue
# stem-splitter-live#30 — see `vendor/.pin`'s `hostSuite` block, which is the
# prose for all of this). A step that expects a red is one keystroke away from a
# step that ignores one, so the pin is a SET EQUALITY over the whole report and
# it has to be watched failing from BOTH sides:
#
#   A  one of the ELEVEN other suites stops passing        -> the step is RED
#   B  `unit` PASSES                                       -> the step is RED
#
# B is the direction an ignore-list could never have. Post-swap a green `unit`
# cannot mean the unit got better — it can only mean the two files in
# `vendor/.pin`'s `ours` are not this Host's hole modules any more. Case B
# reproduces that literally, by putting the EXTENSION's own `ui/host.js` and
# `offscreen/host.js` back from the v0.2.0 archive.
#
# The archive is fetched once, held in `out/vendor-unit-mutations/`, and its
# SHA-256 is checked against `vendor/.pin` before a byte of it is used. There is
# no offline path for case B and it does not pretend to have one: a case that
# cannot run is reported and this script exits non-zero.
#
#   tools/suites/vendor-unit-mutations.sh          # both
#   tools/suites/vendor-unit-mutations.sh B        # only that one
#
# Each case costs one full `--unit` run (~95 s, and ~110 s for B, which is the
# only case where `test.js` runs to the end). NO DISPLAY, NO BROWSER, NO MUTEX:
# `--unit` is plain node, which is why this battery can run beside a windowed
# one.
#
# IT RESTORES ON SIGINT, SIGTERM AND SIGHUP. Every file a case is about to touch
# is copied to `$OUT/<case>.<basename>.bak` and its path is written to
# `$OUT/<case>.paths` first, so the trap restores BY PATH; the paths file is
# removed only once the case has restored and byte-compared. A vendored file
# left mutated would be `vendor-intact` red on somebody else's branch.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$ROOT/out/vendor-unit-mutations"
VEN_REL='vendor/stem-splitter-live'
mkdir -p "$OUT"
cd "$ROOT"

# The backup file for (case, path). THE WHOLE PATH GOES IN THE NAME, not the
# basename: `vendor/.../ui/host.js` and `vendor/.../offscreen/host.js` are both
# `host.js`, and a basename-keyed backup silently overwrote one with the other —
# measured, on the first real run of case B, which then restored the OFFSCREEN
# hole module over the DECK's and left the vendored tree broken for the next run.
bak_of() { printf '%s/%s.%s.bak' "$OUT" "$1" "$(printf '%s' "$2" | tr '/' '_')"; }

C_R=$'\033[31m'; C_G=$'\033[32m'; C_D=$'\033[2m'; C_X=$'\033[0m'
caught=0; missed=0; ran=0

restore_all() {
  local paths n f
  for paths in "$OUT"/*.paths; do
    [ -e "$paths" ] || continue
    n="$(basename "$paths" .paths)"
    while read -r f; do
      [ -z "$f" ] && continue
      [ -f "$(bak_of "$n" "$f")" ] && cp "$(bak_of "$n" "$f")" "$ROOT/$f"
    done < "$paths"
  done
}
on_signal() {
  echo
  echo "INTERRUPTED — restoring every file this battery had mutated, from $OUT."
  restore_all
  git -C "$ROOT" status --short -- "$VEN_REL" || true
  exit 130
}
trap on_signal INT TERM HUP

# `edit FILE OLD NEW` — exact, first occurrence, HARD ERROR if the anchor moved.
# A mutation that silently did not apply is a green nobody earned.
edit() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path).read()
if old not in s:
    sys.stderr.write("ANCHOR NOT FOUND in %s:\n%s\n" % (path, old[:200]))
    sys.exit(3)
open(path, 'w').write(s.replace(old, new, 1))
PY
}

run_step() {   # -> writes $1, returns the runner's exit code
  node tools/verify.mjs --only vendor-unit --no-reap >"$1" 2>&1
}

# ------------------------------------------------- the v0.2.0 archive, verified
PIN="$ROOT/vendor/.pin"
ARCHIVE="$OUT/upstream.tar.gz"
UP="$OUT/upstream"
fetch_upstream() {
  [ -d "$UP" ] && return 0
  local url want got
  url=$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).archive.url))' "$PIN")
  want=$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).archive.sha256))' "$PIN")
  if [ ! -f "$ARCHIVE" ]; then
    echo "${C_D}fetching $url${C_X}"
    curl -sSL --fail -o "$ARCHIVE" "$url" || { rm -f "$ARCHIVE"; return 1; }
  fi
  got=$(sha256sum "$ARCHIVE" | cut -d' ' -f1)
  # NOT a warning. The whole point of case B is that these are the EXTENSION's
  # real files; an archive that is not the pinned one proves nothing about them.
  [ "$got" = "$want" ] || { echo "${C_R}the archive does not match vendor/.pin: $got != $want${C_X}"; rm -f "$ARCHIVE"; return 1; }
  rm -rf "$UP"; mkdir -p "$UP"
  tar -xzf "$ARCHIVE" -C "$UP" --strip-components=1 || return 1
}

# `mutate_case NAME "label" "file[,file...]" "expected substring in the red"`
# then either `-- edit-triples...` or a `prepare` function name in $PREPARE.
PREPARE=''
mutate_case() {
  local n="$1" label="$2" files="$3" expect="$4"; shift 4
  [ "$#" -ge 1 ] && [ "$1" = "--" ] && shift
  if [ "${#ONLY[@]}" -gt 0 ] && [[ ! " ${ONLY[*]} " =~ " $n " ]]; then PREPARE=''; return 0; fi

  echo
  echo "${C_D}=== mutation $n — $label${C_X}"
  ran=$((ran + 1))

  local IFS=','; local -a flist=($files); unset IFS
  local f
  printf '%s\n' "${flist[@]}" > "$OUT/$n.paths"
  for f in "${flist[@]}"; do cp "$ROOT/$f" "$(bak_of "$n" "$f")"; done

  if [ -n "$PREPARE" ]; then
    if ! "$PREPARE"; then
      echo "${C_R}MUTATION $n COULD NOT BE PREPARED${C_X} — $PREPARE failed. This case did NOT run."
      for f in "${flist[@]}"; do cp "$(bak_of "$n" "$f")" "$ROOT/$f"; done
      rm -f "$OUT/$n.paths"; PREPARE=''
      missed=$((missed + 1)); return 0
    fi
    PREPARE=''
  fi

  while [ "$#" -ge 3 ]; do
    if ! edit "$ROOT/$1" "$2" "$3"; then
      echo "${C_R}MUTATION $n DID NOT APPLY${C_X} — the anchor text in $1 has moved. Fix this script."
      for f in "${flist[@]}"; do cp "$(bak_of "$n" "$f")" "$ROOT/$f"; done
      rm -f "$OUT/$n.paths"
      missed=$((missed + 1)); return 0
    fi
    shift 3
  done

  local log="$OUT/$n.log"
  run_step "$log"; local code=$?

  for f in "${flist[@]}"; do cp "$(bak_of "$n" "$f")" "$ROOT/$f"; done
  for f in "${flist[@]}"; do
    if ! cmp -s "$ROOT/$f" "$(bak_of "$n" "$f")"; then
      echo "${C_R}RESTORE FAILED for $f${C_X}"; missed=$((missed + 1)); return 0
    fi
  done
  rm -f "$OUT/$n.paths"        # restored AND verified — nothing left for the trap

  local ok=1
  if [ "$code" -eq 0 ]; then
    echo "  ${C_R}MISS${C_X}   the runner exited 0 under the mutation — the step stayed GREEN"
    ok=0
  fi
  if grep -qF -- "$expect" "$log"; then
    echo "  ${C_G}red${C_X}    $(grep -oF -m1 -- "$expect" "$log")"
    echo "  ${C_D}$(sed 's/\x1b\[[0-9;]*m//g' "$log" | grep -m1 -A2 'FAILED ASSERTIONS' | tail -1 | cut -c1-200)${C_X}"
  else
    echo "  ${C_R}MISS${C_X}   the red did not name: $expect"
    echo "  ${C_D}$(sed 's/\x1b\[[0-9;]*m//g' "$log" | tail -3 | tr '\n' ' ' | cut -c1-200)${C_X}"
    ok=0
  fi
  echo "  ${C_D}log out/vendor-unit-mutations/$n.log${C_X}"

  if [ "$ok" -eq 1 ]; then caught=$((caught + 1)); else missed=$((missed + 1)); fi
}

ONLY=("$@")

# ------------------------------------------------- 0. green before mutating
echo "${C_D}=== baseline — the step must be GREEN before anything is broken${C_X}"
if ! run_step "$OUT/baseline.log"; then
  echo "${C_R}BASELINE IS RED${C_X} — nothing below would prove anything. Last lines:"
  tail -20 "$OUT/baseline.log"
  exit 2
fi
echo "  ${C_G}green${C_X}  $(sed 's/\x1b\[[0-9;]*m//g' "$OUT/baseline.log" | grep -m1 '  PASS  vendor-unit' | sed 's/^ *//')"

# ==========================================================================
# A  ONE OF THE ELEVEN STOPS PASSING
#
# This is the half that keeps the step worth running at all: eleven suites and
# 544 assertions are still gated over the exact bytes we pinned, and the
# expected red on the twelfth does not buy them an exemption. A confidence floor
# nothing can clear takes `bpmtap` down and nothing else with it.
# ==========================================================================
mutate_case A "raise bpmtap's confidence floor so nothing can ever lock" \
  "$VEN_REL/extension/engine/bpmtap.js" \
  "vendor/.pin pins 11" \
  -- "$VEN_REL/extension/engine/bpmtap.js" \
"export const BPM_MIN_CONFIDENCE = 0.25;" \
"export const BPM_MIN_CONFIDENCE = 0.99;"

# ==========================================================================
# B  THE EXTENSION'S OWN HOLE MODULES COME BACK
#
# THE DIRECTION AN IGNORE-LIST NEVER HAS. With the extension's `ui/host.js` and
# `offscreen/host.js` in place, `test.js` does not crash and `unit` is 612 green
# — the whole plan passes, 1156 assertions, exactly as a fresh copy reports. A
# step that merely tolerated a red `unit` would call that a pass and would have
# stopped noticing that this repository's Host had been deleted.
#
# IT ARRIVES BY THE EXIT-0 DOOR, WHICH IS WHY `expect.why` CARRIES THE FINDING.
# Measured, and it corrected the first version of this case: a green `unit`
# takes the whole vendored plan to `12 of 12 PASS` and EXIT 0, so `classify()`
# never reaches the branch that knows what `hostSuite` is — it reaches the
# ordinary exit-0 `expect` check, whose red is "exit 0, but <why> never
# appeared". That sentence therefore has to say what a green run means, and this
# case is what holds it to it. The pin's own EVERY-suite-passed message covers
# the same claim at the pinned exit code and is asserted in `--self-check`.
# ==========================================================================
PREPARE=install_upstream_holes
install_upstream_holes() {
  fetch_upstream || { echo "${C_R}could not fetch or verify the v0.2.0 archive — case B has no offline path${C_X}"; return 1; }
  cp "$UP/extension/ui/host.js" "$ROOT/$VEN_REL/extension/ui/host.js"
  cp "$UP/extension/offscreen/host.js" "$ROOT/$VEN_REL/extension/offscreen/host.js"
}
mutate_case B "put the EXTENSION's own hole modules back, so \`unit\` goes green" \
  "$VEN_REL/extension/ui/host.js,$VEN_REL/extension/offscreen/host.js" \
  "\`unit\` PASSED"

echo
echo "========================================================================"
if [ "$missed" -eq 0 ] && [ "$ran" -gt 0 ]; then
  echo "${C_G}all $caught of $ran mutations were caught${C_X} — the pin fails in both directions."
  exit 0
fi
echo "${C_R}$missed of $ran mutations were NOT caught${C_X} (caught $caught). Logs in out/vendor-unit-mutations/."
exit 1
