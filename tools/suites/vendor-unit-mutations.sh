#!/usr/bin/env bash
# Watch the `vendor-unit` step go RED **both ways**, one mutation at a time.
# AGENTS.md: "An assertion you did not watch fail is not evidence."
#
# WHY THIS STEP NEEDS ITS OWN BATTERY. `vendor-unit` is the only step in
# `tools/verify.mjs` whose expected outcome is a NON-ZERO EXIT: the vendored
# `test.js` fails cleanly with this Host's hole modules in place — 676 passed,
# 18 failed, its own RED banner (the upstream stem-splitter-live#30 fix — a
# report that crashes is not one — makes the old dereference a named red since
# v0.3.0 — see `vendor/.pin`'s `hostSuite` block, which is
# the prose for all of this). A step that expects a red is one keystroke away
# from a step that ignores one, so the pin is a SET EQUALITY over the whole
# report and it has to be watched failing from BOTH sides:
#
#   A  one of the ELEVEN other suites stops passing        -> the step is RED
#   B  `unit` PASSES                                       -> the step is RED
#
# B is the direction an ignore-list could never have. Post-swap a green `unit`
# cannot mean the unit got better — it can only mean the two files in
# `vendor/.pin`'s `ours` are not this Host's hole modules any more. Case B
# reproduces that literally, by putting the EXTENSION's own `ui/host.js` and
# `offscreen/host.js` back from the v0.3.1 archive.
#
# The archive is fetched once, held in `out/vendor-unit-mutations/`, and its
# SHA-256 is checked against `vendor/.pin` before a byte of it is used. There is
# no offline path for case B and it does not pretend to have one: a case that
# cannot run is reported and this script exits non-zero.
#
#   tools/suites/vendor-unit-mutations.sh          # both
#   tools/suites/vendor-unit-mutations.sh B        # only that one
#
# Each case costs one full `--unit` run (~95 s, and ~110 s for B, the only case
# where the whole plan goes green). NO DISPLAY, NO BROWSER, NO MUTEX: `--unit` is
# plain node, which is why this battery can run beside a windowed one.
#
# IT RESTORES ON SIGINT, SIGTERM AND SIGHUP. Every file a case is about to touch
# is copied to `$OUT/<case>.<basename>.bak` and its path is written to
# `$OUT/<case>.paths` first, so the trap restores BY PATH; the paths file is
# removed only once the case has restored and byte-compared. A vendored file
# left mutated would be `vendor-intact` red on somebody else's branch.
set -uo pipefail

# ---------------------------------- refuse a case id that does not exist
# FIRST, BEFORE THE MUTEX AND BEFORE THE BASELINE — which is the whole point.
# Every battery here takes the machine-global browser mutex and runs a real
# baseline launch, and the case filter is applied only afterwards. So a typo'd
# id used to queue for the lock, launch Electron, run ZERO cases, and then fall
# through every verdict branch to a SILENT `exit 1`. Measured on this box:
# `shell-mutations.sh 42 43 44 45 46 47 48` on a battery whose ids stop at 41
# spent five minutes of queue and one windowed launch to print nothing, while
# four other agents waited behind it. An instrument that says nothing is bad; one
# that consumes the single scarce resource in order to say nothing is worse.
#
# THE KNOWN SET IS READ OUT OF THIS FILE, so it cannot go stale as cases are
# added, and it makes NO ASSUMPTION ABOUT THE SHAPE OF AN ID. That is not
# caution for its own sake: ids in this repository include `13b`, `39a`, `3b`,
# `1b` and — in `vendor-unit-mutations.sh` — plain `A` and `B`. A pattern like
# `[0-9]+[a-z]*` looks right, matches most of them, and REJECTS A VALID CASE,
# which is worse than no check at all. Field two, verbatim, whatever it is.
#
# `-*` is skipped so flags (`--static`, and anything a battery adds) pass through
# to the parsing below untouched.
_CASE_KNOWN=$(grep -oE '^(mutate_case|canary_case|M) +[^ ]+' "$0" | awk '{print $2}' | tr '\n' ' ')
_CASE_BAD=''
for _c in "$@"; do
  case "$_c" in -*) continue ;; esac
  case " $_CASE_KNOWN " in *" $_c "*) ;; *) _CASE_BAD="$_CASE_BAD $_c" ;; esac
done
if [ -n "$_CASE_BAD" ]; then
  echo "no such case:$_CASE_BAD" >&2
  echo "known cases: $_CASE_KNOWN" >&2
  echo "nothing ran, and the shared browser mutex was not taken." >&2
  exit 2
fi
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$ROOT/out/vendor-unit-mutations"
VEN_REL='vendor/stem-splitter-live'
mkdir -p "$OUT"
cd "$ROOT"
# THE MUTATION GUARD. Traps are the belt: this battery restores on INT, TERM and
# HUP, and `timeout` sends TERM — which is how a long battery is most likely to
# die and was the one way it did not clean up (stem-workbench#22). The SENTINEL
# is the braces, for `kill -9`, a crashed host and a full disk, where no trap
# runs at all: while a mutation is standing there is a file under
# `out/.mutating/` naming it, and every suite refuses to start while one is
# there. `tools/lib/tree-guard.mjs` is the long form.
MG_BATTERY='vendor-unit-mutations'; MG_ROOT="$ROOT"
. "$ROOT/tools/lib/mutation-guard.sh"
trap mg_on_signal INT TERM HUP   # on_signal() below is chained in via MG_ALSO
mg_begin

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
MG_ALSO=on_signal

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

# ------------------------------------------------- the v0.3.1 archive, verified
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
  local -a mg_pairs=()
  for f in "${flist[@]}"; do cp "$ROOT/$f" "$(bak_of "$n" "$f")"; mg_pairs+=("$f=$(bak_of "$n" "$f")"); done
  # THE SENTINEL GOES DOWN BEFORE THE FIRST EDIT AND COMES UP ONLY ONCE THE
  # RESTORE HAS BEEN BYTE-VERIFIED. A `kill -9` here leaves it standing, and
  # every suite then REFUSES TO RUN rather than measuring the mutation — which
  # is stem-workbench#22, the false red that outlives the run that caused it.
  mg_claim "$n" "${mg_pairs[@]}"

  if [ -n "$PREPARE" ]; then
    if ! "$PREPARE"; then
      echo "${C_R}MUTATION $n COULD NOT BE PREPARED${C_X} — $PREPARE failed. This case did NOT run."
      for f in "${flist[@]}"; do cp "$(bak_of "$n" "$f")" "$ROOT/$f"; done
      rm -f "$OUT/$n.paths"; PREPARE=''
      mg_release "$n"; missed=$((missed + 1)); return 0
    fi
    PREPARE=''
  fi

  while [ "$#" -ge 3 ]; do
    if ! edit "$ROOT/$1" "$2" "$3"; then
      echo "${C_R}MUTATION $n DID NOT APPLY${C_X} — the anchor text in $1 has moved. Fix this script."
      for f in "${flist[@]}"; do cp "$(bak_of "$n" "$f")" "$ROOT/$f"; done
      rm -f "$OUT/$n.paths"
      mg_release "$n"; missed=$((missed + 1)); return 0
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
  # RESTORED AND BYTE-VERIFIED, so the sentinel comes up. A restore that FAILED
  # returns above without releasing, on purpose: the mutation really is still
  # standing then, and the next suite must refuse rather than measure it.
  mg_release "$n"
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

# ---------------------- 0a. A LEFTOVER FROM A KILLED RUN IS NOT THIS RUN'S RED
#
# THE TRAP ALONE WAS NOT ENOUGH, and it cost a run: `restore_all` was reachable
# only from the INT/TERM/HUP trap, so a SIGKILL, a `timeout`-killed battery or a
# crashed shell left a MUTATED UNIT FILE on the working tree — case A's
# `bpmtap.js` edit stood there and the next agent found it as a `vendor-intact`
# red they had not caused.
#
# THE SENTINEL IS THE FIX AND IT IS NOT THIS FILE'S: `tools/lib/mutation-guard.sh`
# is sourced above, `mg_claim` writes a file under `out/.mutating/` naming every
# (file, backup) pair BEFORE the first edit, and `mg_release` removes it only
# after the restore has been byte-verified. Every suite refuses to start while
# one of those is on disk (`tools/lib/tree-guard.mjs`), so a stranded mutation
# becomes a NAMED refusal that says how to undo it —
# `node tools/lib/tree-guard.mjs restore-all` — rather than a mystery red three
# steps away. That is strictly better than this battery quietly self-healing,
# because a human gets told.
#
# `$OUT/<case>.paths` is this battery's own older bookkeeping and is kept: it is
# what the trap's `restore_all` reads, and the two are not alternatives.

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
# 561 assertions are still gated over the exact bytes we pinned, and the
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
# `offscreen/host.js` in place, `test.js` is 766 green — the whole plan passes,
# 1327 assertions, exactly as a fresh copy reports. A step that merely tolerated
# a red `unit` would call that a pass and would have stopped noticing that this
# repository's Host had been deleted.
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
  fetch_upstream || { echo "${C_R}could not fetch or verify the v0.3.1 archive — case B has no offline path${C_X}"; return 1; }
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
