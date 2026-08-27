#!/usr/bin/env bash
# S7a — watch every assertion the live-export contiguity slice added to
# `tools/suites/transport.mjs` go RED, one mutation at a time.
#
# PROVENANCE. The anchors below were cut against `6c35580` — the landed tip this
# branch was taken from — plus this branch's own `feat(transport): decide when a
# live export stops being contiguous`, which is where every `src/main/drive.js`
# anchor lives. INTEGRATION.md §22: a stamp must name a commit anybody can
# resolve, so the base is named rather than a SHA that may be rewritten before it
# lands. §18: ANY later slice that rewrites these files invalidates these anchors
# and nothing announces it — re-run this battery against final `main` before a
# tag, and RE-DERIVE THE TABLE, not just the result (§26).
#
# WHY THIS IS NOT `tools/suites/transport-mutations.sh` WITH MORE CASES.
# That battery checks that the DECLARED assertions went red and PRINTS the
# others without failing. INTEGRATION.md §25 measured what that misses: coverage
# MIGRATING from one mutation to another leaves the union unchanged, so an
# aggregate cannot see it, and a real coverage loss read as "all watched red".
# So this battery declares, per case, the EXACT set of assertions the mutation
# must turn red, and FAILS THE CASE IF THE SET DIFFERS IN EITHER DIRECTION:
#
#   - an expected assertion that did NOT go red is a MISS, as usual;
#   - an assertion that went red and was NOT declared is a MISS TOO. An
#     unexpected red is as much a finding as a missing one — it is either a
#     blast radius nobody wrote down or an assertion measuring something other
#     than what its name says.
#
# It also:
#   1. runs the suite UNMUTATED FIRST and requires GREEN — a mutation runner
#      that is red before it mutates has proved nothing;
#   2. refuses to continue if the edit did not apply (the anchor moved);
#   3. requires the run to be red at all (exit non-zero);
#   4. restores the file and verifies the restored bytes match;
#   5. reports, PER ANCHOR, whether it still MATCHES the source and whether it
#      still REDS — INTEGRATION.md §24, because those two findings need
#      opposite responses.
#
#   tools/suites/transport-s7a-mutations.sh            # all of them
#   tools/suites/transport-s7a-mutations.sh S1 S7      # only these cases (a subset)
#   tools/suites/transport-s7a-mutations.sh --static   # only the cases that need no launch
#
# A STATIC CASE COSTS ~0.5 s AND A LIVE CASE ~90 s, because a live case is a real
# Electron launch under the machine-global browser mutex.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$ROOT/out/transport-s7a-mutations"
rm -rf "$OUT"; mkdir -p "$OUT"
cd "$ROOT"
# THE MUTATION GUARD. The trap is the belt — `timeout` sends TERM, which is how a
# long battery is most likely to die and was the one way it did not clean up
# (stem-workbench#22). The SENTINEL under `out/.mutating/` is the braces, for
# `kill -9`: while a mutation is standing, every suite refuses to start.
MG_BATTERY='transport-s7a-mutations'; MG_ROOT="$ROOT"
. "$ROOT/tools/lib/mutation-guard.sh"
trap mg_on_signal INT TERM HUP

C_R=$'\033[31m'; C_G=$'\033[32m'; C_Y=$'\033[33m'; C_D=$'\033[2m'; C_X=$'\033[0m'
caught=0; missed=0; ran=0
ONLY=(); STATIC_ONLY=0
for a in "$@"; do
  if [ "$a" = "--static" ]; then STATIC_ONLY=1; else ONLY+=("$a"); fi
done

# ---------------------------------------------------------------- the rows
# The nineteen assertions this slice added, by a fragment of the NAME that is
# unique across the whole suite. A fragment, not the whole name: the name is
# stable text and the detail is not (docs/TESTING.md §3 rule 3).
declare -A ROW=(
  [1]="observations that END a contiguous pass"
  [2]="a reason the unit has no wording for is REFUSED"
  [3]="members are REACHABLE from this Host"
  [4]="exports NO pass-end vocabulary yet"
  [5]="spells a pass-end SENTENCE of its own"
  [6]="a SEEK ends the contiguous pass"
  [7]="what was captured stays EXPORTABLE"
  [8]="no delivered file contains a GAP"
  [9]="the reason is FIRST-WRITER-WINS"
  [10]="stay DISTINGUISHABLE through the one shared end()"
  [11]="buffers RETAINED after 60 s"
  [12]="refuse produces a NAMED code and a count"
  [13]="a write that THROWS aborts the pass"
  [14]="HELD for the length of a recording"
  [15]="an ABORTED recording releases the hold too"
  [16]="SUSPENDS the page's own autoplay-next control"
  [17]="puts it back to the USER'S value"
  [18]="a seek the PAGE made ends the real recording"
  [19]="OUR OWN corrective seek ends it too"
)
ALL_ROWS=(1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19)
declare -A SEEN_RED=()

# `edit FILE OLD NEW` — exact, first occurrence, and a HARD ERROR if the anchor
# is not there. A mutation that silently did not apply is a green nobody earned.
edit() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path).read()
if old not in s:
    sys.stderr.write("ANCHOR NOT FOUND in %s:\n%s\n" % (path, old[:240]))
    sys.exit(3)
open(path, 'w').write(s.replace(old, new, 1))
PY
}

run_suite() {   # $1 = log path, $2 = 'static'|'live'
  if [ "$2" = static ]; then
    node tools/suites/transport.mjs --static >"$1" 2>&1
  else
    node tools/suites/transport.mjs >"$1" 2>&1
  fi
}

fails_of() { grep -E '^FAIL' "$1" || true; }

# `mutate_case ID kind "label" "file[,file...]" "rowA rowB ..." -- FILE OLD NEW [...]`
mutate_case() {
  local n="$1" kind="$2" label="$3" files="$4" expect="$5"; shift 5
  [ "$#" -ge 1 ] && [ "$1" = "--" ] && shift
  if [ "${#ONLY[@]}" -gt 0 ] && [[ ! " ${ONLY[*]} " =~ " $n " ]]; then return 0; fi
  if [ "$STATIC_ONLY" = 1 ] && [ "$kind" != static ]; then return 0; fi

  echo
  echo "${C_D}=== mutation $n ($kind) — $label${C_X}"
  ran=$((ran + 1))

  local IFS=','; local -a flist=($files); unset IFS
  local f
  local -a mg_pairs=()
  for f in "${flist[@]}"; do cp "$ROOT/$f" "$OUT/$n.$(basename "$f").bak"; mg_pairs+=("$f=$OUT/$n.$(basename "$f").bak"); done
  mg_claim "$n" "${mg_pairs[@]}"

  local anchor_ok=1
  while [ "$#" -ge 3 ]; do
    if ! edit "$ROOT/$1" "$2" "$3"; then
      anchor_ok=0
      echo "  ${C_R}ANCHOR NO LONGER MATCHES${C_X} $1 ${C_D}— a decayed instrument (INTEGRATION.md §24): re-cut it${C_X}"
      break
    fi
    shift 3
  done
  if [ "$anchor_ok" = 0 ]; then
    for f in "${flist[@]}"; do cp "$OUT/$n.$(basename "$f").bak" "$ROOT/$f"; done
    mg_release "$n"; missed=$((missed + 1)); return 0
  fi

  local log="$OUT/$n.log"
  run_suite "$log" "$kind"; local code=$?

  for f in "${flist[@]}"; do cp "$OUT/$n.$(basename "$f").bak" "$ROOT/$f"; done
  for f in "${flist[@]}"; do
    if ! cmp -s "$ROOT/$f" "$OUT/$n.$(basename "$f").bak"; then
      echo "${C_R}RESTORE FAILED for $f${C_X}"; missed=$((missed + 1)); return 0
    fi
  done
  # RESTORED AND BYTE-VERIFIED, so the sentinel comes up. A restore that FAILED
  # returns above without releasing, on purpose: the mutation really is still
  # standing then, and the next suite must refuse rather than measure it.
  mg_release "$n"

  local ok=1
  local -a wants=($expect)
  local w r
  # ---- direction 1: every declared assertion must be red
  for w in "${wants[@]}"; do
    if fails_of "$log" | grep -qF -- "${ROW[$w]}"; then
      echo "  ${C_G}red${C_X}    §$w  ${ROW[$w]}"
      SEEN_RED[$w]=1
    else
      echo "  ${C_R}MISS${C_X}   §$w  ${ROW[$w]}  ${C_D}— declared, and it did not go red${C_X}"
      ok=0
    fi
  done
  # ---- direction 2: nothing ELSE may be red. §25 — coverage migrating between
  # mutations leaves the union unchanged, so only a per-case set can see it.
  local unexpected=0
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    local matched=0
    for w in "${wants[@]}"; do
      case "$line" in *"${ROW[$w]}"*) matched=1; break;; esac
    done
    if [ "$matched" = 0 ]; then
      echo "  ${C_Y}EXTRA${C_X}  ${line:0:150}"
      unexpected=$((unexpected + 1))
    fi
  done < <(fails_of "$log")
  if [ "$unexpected" -gt 0 ]; then
    echo "  ${C_R}MISS${C_X}   $unexpected UNDECLARED red(s) ${C_D}— a blast radius nobody wrote down is a finding too${C_X}"
    ok=0
  fi
  if [ "$code" -eq 0 ]; then
    echo "  ${C_R}MISS${C_X}   the suite exited 0 under the mutation"
    ok=0
  fi
  echo "  ${C_D}$(fails_of "$log" | wc -l | tr -d ' ') red in total · $(tail -1 "$log") · log out/transport-s7a-mutations/$n.log${C_X}"

  if [ "$ok" -eq 1 ]; then caught=$((caught + 1)); else missed=$((missed + 1)); fi
}

# ------------------------------------------------- 0. green before mutating
echo "${C_D}=== baseline — the suite must be GREEN before anything is broken${C_X}"
if [ "$STATIC_ONLY" = 1 ]; then run_suite "$OUT/baseline.log" static; else run_suite "$OUT/baseline.log" live; fi
bcode=$?
echo "  $(tail -1 "$OUT/baseline.log")"
if [ "$bcode" -ne 0 ]; then
  echo "${C_R}BASELINE IS RED${C_X} — fix that first. A mutation runner that is red before it mutates has proved nothing."
  fails_of "$OUT/baseline.log"; exit 2
fi

D=src/main/drive.js
A=src/main/autonav.js
T=src/main/transport.js

# =========================================================================
# THE BOUNDARY — which observation ends a contiguous pass
# =========================================================================
# THE HEADLINE MUTATION. Dropping the seek edge must show THE FILE RUNNING PAST
# THE SEEK, not a flag differing — §4b/6's detail prints the frame count and the
# distinct values on disk, and under this mutation it prints 1.5 s and three
# values where the pass was fed 1.0 s and two.
mutate_case S1 static "a seek stops being a boundary" "$D" "1 3 6 7 10" -- \
  "$D" "  if (s.seeking === true) return 'seek';" \
       "  if (false && s.seeking === true) return 'seek';"

mutate_case S2 static "\`emptied\` stops being a boundary" "$D" "1" -- \
  "$D" "const PASS_END_EVENTS = new Map([['emptied', 'seek'], ['ended', 'ended']]);" \
       "const PASS_END_EVENTS = new Map([['ended', 'ended']]);"

# THE END OF A SOURCE AND A MOVE OF THE PLAYHEAD READ DIFFERENTLY TO A USER —
# `PASS_END.ended` is "the source reached its end", the most complete pass there
# is, and `PASS_END.seek` is "the playhead moved".
mutate_case S3 static "the source ending is recorded as a seek" "$D" "1 3" -- \
  "$D" "const PASS_END_EVENTS = new Map([['emptied', 'seek'], ['ended', 'ended']]);" \
       "const PASS_END_EVENTS = new Map([['emptied', 'seek'], ['ended', 'seek']]);"

mutate_case S8 static "observe() sees the boundary and does not end the pass" "$D" "3 6 7 10" -- \
  "$D" "      if (reason === null) return null;
      api.end(reason);" \
       "      if (reason === null) return null;
      // mutation: the seek -> stop edge is gone"

# =========================================================================
# THE VOCABULARY — named, never invented, never worded here
# =========================================================================
mutate_case S4 static "a fifth member this Host made up" "$D" "2 3 4" -- \
  "$D" "export const PASS_END_NAMES = Object.freeze(['stopped', 'ended', 'seek', 'drop']);" \
       "export const PASS_END_NAMES = Object.freeze(['stopped', 'ended', 'seek', 'drop', 'boredom']);"

mutate_case S5 static "end() stops checking the name" "$D" "2" -- \
  "$D" "      if (!PASS_END_NAMES.includes(reason)) return refuse('unnamed-reason');" \
       "      if (false) return refuse('unnamed-reason');"

mutate_case S6 static "\`drop\` is not a member at all" "$D" "4 8 9 10" -- \
  "$D" "export const PASS_END_NAMES = Object.freeze(['stopped', 'ended', 'seek', 'drop']);" \
       "export const PASS_END_NAMES = Object.freeze(['stopped', 'ended', 'seek']);"

# THE WORDING IS THE UNIT'S. A second copy under src/ is a Host that decides what
# a seek MEANS, which is the half `shared/stemcache.js` reserved.
mutate_case S7 static "a PASS_END sentence is written into this Host" "$D" "5" -- \
  "$D" "export const PASS_END_NAMES = Object.freeze(['stopped', 'ended', 'seek', 'drop']);" \
       "export const PASS_END_NAMES = Object.freeze(['stopped', 'ended', 'seek', 'drop']);
export const WHY = { seek: 'the playhead moved, which ends a contiguous pass' };"

# =========================================================================
# ENDING IS NOT DISCARDING
# =========================================================================
mutate_case S9 static "end() does not close the sink" "$D" "7" -- \
  "$D" "      closedFile = sink && typeof sink.close === 'function' ? sink.close() : null;" \
       "      closedFile = null;"

# =========================================================================
# RULING 29 — a drop is a BOUNDARY, and it is not a seek
# =========================================================================
mutate_case S10 static "a drop is counted and does not end the pass" "$D" "3 8 9 10" -- \
  "$D" "      return api.end('drop');" \
       "      return null;"

mutate_case S11 static "endPass is LAST-writer-wins" "$D" "9" -- \
  "$D" "      if (!open) return refuse(endedBy === null ? 'not-recording' : 'already-ended');" \
       "      if (!open && endedBy === null) return refuse('not-recording');"

# THE ONE THE SLICE BRIEF NAMES: "word one like the other". A drop and a seek
# share `end()`, and a shared code path is exactly where "you moved the playhead"
# and "the machine could not keep up" get collapsed into one sentence.
mutate_case S12 static "a drop is recorded as a seek — the two facts collapse" "$D" "3 8 9 10" -- \
  "$D" "      return api.end('drop');" \
       "      return api.end('seek');"

# =========================================================================
# RAM DOES NOT GROW WITH DURATION — a COUNT, never a memory reading
# =========================================================================
mutate_case S13 static "the chunk is written but not let go, so buffers accumulate" "$D" "11" -- \
  "$D" "      const out = holding.shift();" \
       "      const out = holding[holding.length - 1];"

# =========================================================================
# A REFUSAL IS NAMED AND COUNTED
# =========================================================================
mutate_case S14 static "a refusal is returned but not recorded" "$D" "12" -- \
  "$D" "    stats.refusals.push(code);" \
       "    // mutation: the refusal is not recorded"

mutate_case S15 static "a throwing write is swallowed and the half-file kept" "$D" "13" -- \
  "$D" "        api.abort('write-failed');
        return 'write-failed';" \
       "        return null;"

# =========================================================================
# AUTOPLAY-NEXT — suspended for the whole recording, and RESTORED
# =========================================================================
# LIVE, and it has to be. `heldNow()` and `suppressing()` are this Host talking
# about itself; the page's own `aria-checked` is the state issue #7 asks for —
# "a Host that writes the preference and never drives the view passes a weaker
# assertion and ships the bug".
mutate_case S16 live "the recording's hold is ignored" "$A" "14 16 17" -- \
  "$A" "  const effective = () => suppress || held;" \
       "  const effective = () => suppress;"

# THE ABORT PATH IS WHERE THIS BREAKS. §4b/13 goes red with it because the
# throwing-write row asserts the same release on the same path.
mutate_case S17 live "the hold is not released on an ABORTED recording" "$D" "13 15 17" -- \
  "$D" "      closedFile = sink && typeof sink.abort === 'function' ? sink.abort() : null;
      setHold(false);" \
       "      closedFile = sink && typeof sink.abort === 'function' ? sink.abort() : null;
      // mutation: the restore on abort is gone"

# =========================================================================
# THE WIRE — the pure decision is not the same claim as the transport
# =========================================================================
mutate_case S18 live "the transport never tells the pass what it saw" "$T" "18" -- \
  "$T" "      if (pass) pass.observe(lastState);" \
       "      // mutation: the boundary never reaches the pass"

mutate_case S19 live "our own corrective seek stops ending the pass" "$T" "18 19" -- \
  "$T" "      if (pass && cmd.seekTo !== undefined) pass.end('seek');" \
       "      // mutation: the self-seek exemption becomes a hole in the rule"

# ------------------------------------------------------------ the coverage
echo
if [ "${#ONLY[@]}" -gt 0 ] || [ "$STATIC_ONLY" = 1 ]; then
  echo "${C_Y}coverage NOT COMPUTED${C_X} — this was a subset run (${#ONLY[@]} named case(s), --static=$STATIC_ONLY)."
  echo "${C_D}A coverage claim over a case list is a measurement nobody took. Run the battery with no arguments.${C_X}"
else
  uncovered=()
  for r in "${ALL_ROWS[@]}"; do [ -n "${SEEN_RED[$r]:-}" ] || uncovered+=("$r"); done
  if [ "${#uncovered[@]}" -eq 0 ]; then
    echo "${C_G}coverage${C_X} ${#ALL_ROWS[@]}/${#ALL_ROWS[@]} — every assertion this slice added was watched red by at least one mutation."
  else
    echo "${C_R}coverage${C_X} $(( ${#ALL_ROWS[@]} - ${#uncovered[@]} ))/${#ALL_ROWS[@]} — NEVER WATCHED RED: ${uncovered[*]}"
    missed=$((missed + ${#uncovered[@]}))
  fi
fi

echo "${C_D}=== ${ran} case(s): ${caught} caught, ${missed} missed${C_X}"
[ "$missed" -eq 0 ] || exit 1
