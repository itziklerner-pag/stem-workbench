#!/usr/bin/env bash
# s2-file-bytes — the STRICT battery for the `/file/` ROOT (slice S2).
#
# ---------------------------------------------------------------------------
# WHY THIS EXISTS BESIDE `shell-mutations.sh` RATHER THAN INSTEAD OF IT
# ---------------------------------------------------------------------------
# `shell-mutations.sh` owns the EDITS. It has to: its `coverage.py` pass reads
# the assertion names out of its own baseline log and refuses any that never
# appeared on a FAIL line, so an S2 case living anywhere else would make that
# battery report five assertions as never watched red. One set of anchors, one
# place, no second copy to decay independently (INTEGRATION.md §18).
#
# What `shell-mutations.sh` does NOT do is fail a case whose red set is WRONG in
# the harmless-looking direction. It requires every expected name to be red and
# then PRINTS the rest without failing on them. That is exactly the instrument
# INTEGRATION.md §25 measured going blind: an aggregate is a claim about the
# UNION of all mutations, so coverage MIGRATING from one mutation to another
# leaves it unchanged, and a real loss reads as a green.
#
# So this file declares, PER CASE, the exact set of assertion names that
# mutation must turn red — and fails the case if the set differs IN EITHER
# DIRECTION. An assertion going red under an unexpected mutation is as much a
# finding as one going red under none.
#
# ---------------------------------------------------------------------------
# IT REPORTS TWO DIFFERENT THINGS PER ANCHOR, because they need opposite
# responses (INTEGRATION.md §24):
#
#   ANCHOR   did the edit still APPLY? `shell-mutations.sh` hard-errors with
#            "MUTATION n DID NOT APPLY" when the text has moved, and this
#            reports that as a DECAYED INSTRUMENT — re-cut it.
#   RED      did the mutation still produce EXACTLY the declared set? A set
#            that shrank is either decay or a real coverage loss, and a set
#            that GREW means an assertion is answering a question nobody
#            declared it was answering. Both are investigated, not re-cut.
#
# ---------------------------------------------------------------------------
# PROVENANCE — the revision these anchors were cut against
# ---------------------------------------------------------------------------
# Two of the seven patch code that was already on `main`; five patch code this
# slice writes, so there is no landed commit that contains them yet and the
# stamp says so rather than naming a SHA nobody can resolve (INTEGRATION.md
# §22):
#
#   case 42        src/main/files.js          cut against 6c35580 (LANDED)
#   cases 43,44    src/main/assets.js         cut against d14909d (this slice, rebased)
#   cases 45,48    src/main/protocol.js       cut against d14909d (this slice, rebased)
#   case 46        src/main/main.js           cut against d14909d (this slice, rebased)
#   case 47        tools/gate/probe.mjs       cut against d14909d (this slice, rebased)
#
# FULL RUN 2026-08-27 (integration), bare: the battery's own verdict — all
# seven cases produced EXACTLY their declared red set, both ways, every anchor
# still matching, exit 0. That is the §18 re-verification of these anchors
# against the tree they ship in, and the five that patch this slice's code are
# stamped with the commit they land as.
#
# THE FIRST STAMP OF THIS BATTERY DID NOT EARN ITS CLAIM — its baseline gate
# grepped the child's ANSI-coloured transcript for `^  green`, which can never
# match (`  <ESC>[32mgreen…`), so no run had ever reached the per-case loop.
# The gate now reads the plain verdict line of the baseline log — the same
# artifact the child's own `run_suite` gate reads. The run this paragraph is
# attached to is the first full run this battery has ever completed.
#
#   tools/suites/s2-file-bytes-mutations.sh          # all seven
#   tools/suites/s2-file-bytes-mutations.sh 42 46    # only these
#
# It has no edits of its own, so there is nothing for it to leave standing — but
# it still carries the guard and the trap, because it is `shell-mutations.sh`'s
# edits that are standing while it waits, and a signal here must put them back.
set -uo pipefail

# THE ID VALIDATOR, BEFORE anything costs anything — the child battery's
# launch, the baseline, the `rm -rf "$OUT"`. A typo must not drive the child
# through its lock queue and a windowed launch to print nothing (the incident
# is measured in `shell-mutations.sh`'s header and pinned by void-canary's
# positional check). THE KNOWN SET IS READ OUT OF THIS FILE'S `ALL=(...)`
# LINE, so it cannot go stale as cases are added, and it makes NO ASSUMPTION
# ABOUT THE SHAPE OF AN ID. `-*` is skipped so flags pass through to the
# parsing below untouched.
_CASE_KNOWN=$(grep -oE '^ALL=\([0-9 ]*\)' "$0" | tr -cd '0-9 ')
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
cd "$ROOT"
MG_BATTERY='s2-file-bytes-mutations'; MG_ROOT="$ROOT"
. "$ROOT/tools/lib/mutation-guard.sh"
trap mg_on_signal INT TERM HUP

# THE GUARD IS NOT DECORATION HERE EITHER. This battery claims and releases a
# sentinel of its own around the child battery's whole run, so a `kill -9` of
# THIS process leaves something on disk naming the run that was in flight — and
# `tools/lib/tree-guard.mjs restore-all` is still the one command that puts the
# tree back, whichever of the two batteries was holding the edit.
C_R=$'\033[31m'; C_G=$'\033[32m'; C_Y=$'\033[33m'; C_D=$'\033[2m'; C_X=$'\033[0m'

CHILD_OUT="$ROOT/out/shell-mutations"
OUT="$ROOT/out/s2-file-bytes-mutations"
rm -rf "$OUT"; mkdir -p "$OUT"

ALL=(42 43 44 45 46 47 48)
CASES=("$@")
[ "${#CASES[@]}" -eq 0 ] && CASES=("${ALL[@]}")

# ==========================================================================
# THE DECLARATION. One line per (case, assertion) — the EXACT set, both ways.
#
# The names are the assertion names as `shell.mjs` prints them, truncated at the
# two-space detail separator, which is what `docs/TESTING.md` §3 makes stable:
# a measured number goes in the DETAIL, never in the name, so these do not move
# run to run.
# ==========================================================================
A_PURE_RESOLVE="a \`/file/\` handle resolves to its absolute path and the ALLOWLIST's MIME, and ONE handle buys ONE resolution"
A_PURE_REFUSE="...and a \`/file/\` request is refused unless it is ONE live handle naming a file the allowlist admits"
A_LIVE_BYTES="a one-shot handle serves its file's EXACT bytes over app://, with the allowlist's MIME and this origin's isolation headers"
A_LIVE_SECOND="...and the SECOND fetch of that same handle is refused BY NAME, carrying the reason instead of the file — one handle, one response, and a replay is word for word what a handle nobody minted gets"
A_LIVE_WIRE="...and over the wire a handle for a file the allowlist does not admit is refused 403, while a \`/file/\` URL that is not one handle never becomes a path"

expected_for() {
  case "$1" in
    42) printf '%s\n' "$A_PURE_RESOLVE" "$A_PURE_REFUSE" "$A_LIVE_SECOND" ;;
    43) printf '%s\n' "$A_PURE_REFUSE" "$A_LIVE_WIRE" ;;
    44) printf '%s\n' "$A_PURE_REFUSE" "$A_LIVE_WIRE" ;;
    45) printf '%s\n' "$A_LIVE_BYTES" ;;
    46) printf '%s\n' "$A_LIVE_BYTES" "$A_LIVE_SECOND" "$A_LIVE_WIRE" ;;
    47) printf '%s\n' "$A_LIVE_BYTES" "$A_LIVE_SECOND" "$A_LIVE_WIRE" ;;
    48) printf '%s\n' "$A_LIVE_BYTES" ;;
    *)  return 1 ;;
  esac
}

label_for() {
  case "$1" in
    42) echo "a spent handle stays spendable — the second fetch gets the file again" ;;
    43) echo "a \`/file/\` tail may contain a separator again" ;;
    44) echo "the allowlist rule goes — an untypeable file is served anyway" ;;
    45) echo "a picked file is typed by the EXTENSION table" ;;
    46) echo "a SECOND token registry in boot()" ;;
    47) echo "the probe is handed no fixture — the suite must FAIL, not pass" ;;
    48) echo "the served file is truncated to 1000 bytes" ;;
  esac
}

# THE ACTUAL RED SET, read out of the case log the child battery wrote.
# `FAIL  <name>  <detail>` — two spaces after the verdict, two before the detail.
actual_for() {
  local log="$1"
  [ -f "$log" ] || return 1
  sed -n 's/^FAIL  \(.*\)$/\1/p' "$log" | sed 's/  .*//' | sort -u
}

# ==========================================================================
mg_claim run "shell-mutations-in-flight=$CHILD_OUT"
echo "${C_D}=== driving tools/suites/shell-mutations.sh for cases ${CASES[*]}${C_X}"
child_code=0
bash "$HERE/shell-mutations.sh" "${CASES[@]}" > "$OUT/child.log" 2>&1 || child_code=$?
mg_release run
echo "  ${C_D}child battery exit $child_code · full transcript out/s2-file-bytes-mutations/child.log${C_X}"

# THE CHILD'S TRANSCRIPT IS ANSI-COLOURED — its green line is
# `  <ESC>[32mgreen<ESC>[0m  shell: …`, so grepping the transcript for
# `^  green` can never match, and every run of this battery voided itself
# HERE before the per-case loop (measured 2026-08-27: exit 2, seven runs'
# worth of child evidence discarded). Gate on the plain verdict line of the
# baseline log — the same artifact the child's own `run_suite` gate reads
# (`shell: N passed, 0 failed`, tail -1 by the child's own construction).
if ! grep -qE '^shell: [0-9]+ passed, 0 failed$' "$CHILD_OUT/baseline.log"; then
  echo "${C_R}THE BASELINE WAS NOT GREEN${C_X} — nothing below would prove anything."
  tail -20 "$CHILD_OUT/baseline.log"
  exit 2
fi
echo "  ${C_G}baseline green${C_X}  $(tail -1 "$CHILD_OUT/baseline.log")"

ran=0; bad=0
for n in "${CASES[@]}"; do
  echo
  echo "${C_D}=== case $n — $(label_for "$n")${C_X}"
  ran=$((ran + 1))

  # ---- ANCHOR: did the edit still apply? (INTEGRATION.md §24, first half)
  if grep -q "MUTATION $n DID NOT APPLY" "$OUT/child.log"; then
    echo "  ${C_R}ANCHOR  DECAYED${C_X} — the anchor text has moved; this case measured nothing. Re-cut it."
    bad=$((bad + 1)); continue
  fi
  if [ ! -f "$CHILD_OUT/$n.log" ]; then
    echo "  ${C_R}ANCHOR  NO LOG${C_X} — out/shell-mutations/$n.log is absent; the case did not run."
    bad=$((bad + 1)); continue
  fi
  echo "  ${C_G}ANCHOR  matches${C_X} — the edit applied to the source as it stands"

  # ---- RED: is the set EXACTLY what was declared? (INTEGRATION.md §25)
  expected_for "$n" | sort -u > "$OUT/$n.expected"
  actual_for "$CHILD_OUT/$n.log" > "$OUT/$n.actual"
  missing="$(comm -23 "$OUT/$n.expected" "$OUT/$n.actual")"
  extra="$(comm -13 "$OUT/$n.expected" "$OUT/$n.actual")"
  n_exp="$(wc -l < "$OUT/$n.expected" | tr -d ' ')"
  n_act="$(wc -l < "$OUT/$n.actual" | tr -d ' ')"

  if [ -z "$missing" ] && [ -z "$extra" ]; then
    echo "  ${C_G}RED     exactly the $n_exp declared assertion(s)${C_X}"
    while read -r line; do [ -n "$line" ] && echo "  ${C_D}          $line${C_X}"; done < "$OUT/$n.expected"
  else
    bad=$((bad + 1))
    echo "  ${C_R}RED     THE SET DIFFERS${C_X} — declared $n_exp, measured $n_act"
    if [ -n "$missing" ]; then
      echo "  ${C_R}          DECLARED BUT NOT RED${C_X} ${C_D}(decay, or a real coverage loss — investigate)${C_X}"
      printf '%s\n' "$missing" | while read -r l; do [ -n "$l" ] && echo "            - $l"; done
    fi
    if [ -n "$extra" ]; then
      echo "  ${C_Y}          RED BUT NOT DECLARED${C_X} ${C_D}(this mutation reaches further than the table says)${C_X}"
      printf '%s\n' "$extra" | while read -r l; do [ -n "$l" ] && echo "            + $l"; done
    fi
  fi
done

echo
echo "========================================================================"
# NO COVERAGE SENTENCE HERE, EVER — not even for a full run of all seven.
# Coverage over `shell` is a claim about all 50 of its assertions, and this
# battery only drives seven cases; `shell-mutations.sh` run WHOLE is the only
# thing that may make it. A harness printing a coverage line it did not compute
# is the loose instrument INTEGRATION.md §25 names at the end.
if [ "$bad" -eq 0 ] && [ "$ran" -gt 0 ]; then
  echo "${C_G}$ran of $ran cases produced EXACTLY their declared red set${C_X}, and every anchor still matches its source."
  echo "${C_D}This says nothing about the other 45 assertions in \`shell\` — run tools/suites/shell-mutations.sh whole for that.${C_X}"
  exit 0
fi
echo "${C_R}$bad of $ran cases did not${C_X} — see the lines above. Logs in out/s2-file-bytes-mutations/ and out/shell-mutations/."
exit 1
