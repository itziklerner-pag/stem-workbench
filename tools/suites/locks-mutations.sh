#!/usr/bin/env bash
# Watch every assertion about THE LOCKS go red, one mutation at a time.
# AGENTS.md: "An assertion you did not watch fail is not evidence."
#
# TWO DEFECTS ARE GATED HERE AND BOTH CAME OUT OF THE SAME AFTERNOON.
#
#   ONE LOCK PATH (cases 1-3, over `void-canary`). The shared browser mutex was
#   copy-pasted into eleven files. Nothing drifted in the source; what drifted
#   was the RUNS — two lines of work pointed the override at different files,
#   each believed it held "the" mutex, and they raced each other on `xvfb-run
#   -a`, which picks a display by scanning for a free number. Batteries were lost
#   to it for hours and one wedged run sat on a mutex nobody else could take for
#   fifty-two minutes. `tools/lib/locks.mjs` is now the only file under `tools/`
#   allowed to name a lock and `strayLockPaths()` refuses a second one.
#
#   CONTENTION IS A SKIP (cases 4-5, over `capture-mute`). Failing to acquire a
#   lock inside 900 s used to be a FAILED ASSERTION: "the run takes the shared
#   browser mutex — <path> was held for 900 s". That is not a fact about this
#   product, it is a fact about what else was running on the box, and it went red
#   on a tree nobody had touched. A gate that cannot get the resources to measure
#   has not measured; it has not failed.
#
# NO DISPLAY, NO BROWSER, NO ELECTRON, NO MUTEX HELD ACROSS THE RUN. Cases 1-3
# are `node tools/suites/void-canary.mjs`, which is instant. Cases 4-5 run
# `capture-mute` with `CAPTURE_MUTE_LOCK_WAIT_S` cut to a few seconds and the
# sink lock deliberately held from OUTSIDE, so they exit on the contention branch
# in seconds without ever creating a sink or launching anything. The whole file
# is a few seconds. That is why it can run beside a windowed battery.
#
#   tools/suites/locks-mutations.sh          # all of them
#   tools/suites/locks-mutations.sh 2 4      # only these
#
# IT RESTORES ON SIGINT, SIGTERM AND SIGHUP, and its backups are keyed by the
# WHOLE PATH rather than the basename — `ui/host.js` and `offscreen/host.js` are
# both `host.js`, and a basename-keyed backup silently restored one over the
# other in an earlier battery here.
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
OUT="$ROOT/out/locks-mutations"
cd "$ROOT"
# THE MUTATION GUARD. Traps are the belt: this battery restores on INT, TERM and
# HUP, and `timeout` sends TERM — which is how a long battery is most likely to
# die and was the one way it did not clean up (stem-workbench#22). The SENTINEL
# is the braces, for `kill -9`, a crashed host and a full disk, where no trap
# runs at all: while a mutation is standing there is a file under
# `out/.mutating/` naming it, and every suite refuses to start while one is
# there. `tools/lib/tree-guard.mjs` is the long form.
MG_BATTERY='locks-mutations'; MG_ROOT="$ROOT"
. "$ROOT/tools/lib/mutation-guard.sh"
trap mg_on_signal INT TERM HUP   # on_signal() below is chained in via MG_ALSO

mg_begin
rm -rf "$OUT"; mkdir -p "$OUT"   # AFTER the marker: a run refused here has wiped nothing
C_R=$'\033[31m'; C_G=$'\033[32m'; C_D=$'\033[2m'; C_X=$'\033[0m'
caught=0; missed=0; ran=0

bak_of() { printf '%s/%s.%s.bak' "$OUT" "$1" "$(printf '%s' "$2" | tr '/' '_')"; }

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
  release_sink_lock
  git -C "$ROOT" status --short -- tools spike || true
  exit 130
}
MG_ALSO=on_signal

# `edit FILE OLD NEW` — exact, first occurrence, HARD ERROR if the anchor moved.
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

# ------------------------------------------------ the contention apparatus
# The sink lock, HELD BY A CHILD THAT IS NOT THE SUITE, so `capture-mute` meets a
# lock somebody else owns — which is the whole situation being reproduced. The
# path is asked of the canonical module, never re-derived here.
SINK='stem_workbench_gate'
SINK_LOCK="$(node "$ROOT/tools/lib/locks.mjs" sink "$SINK")"
# THE LOCK IS HELD ON AN FD IN THIS SHELL, NOT BY A CHILD PROCESS. The first
# version spawned `flock … -c '<a long-running command>'` and killed it
# afterwards, which kills `flock` and leaves its grandchild through `sh -c`
# standing around holding nothing. An fd cannot be orphaned: it closes when this
# shell exits, however it exits, including a `kill -9`. It is also the shape the
# smoke and p1 batteries already use.
HOLDING=0
take_sink_lock() {
  exec 9>"$SINK_LOCK" || { echo "${C_R}cannot open $SINK_LOCK${C_X}"; return 1; }
  flock -w 10 9 || { echo "${C_R}another run already holds $SINK_LOCK${C_X}"; return 1; }
  HOLDING=1
  return 0
}
release_sink_lock() {
  [ "$HOLDING" = 1 ] || return 0
  exec 9>&-
  HOLDING=0
}

# `mutate_case N "label" "file[,file]" "runner" "expect …" -- edits…`
# `runner` is a shell snippet that writes the transcript to $log and whose exit
# code is the suite's.
mutate_case() {
  local n="$1" label="$2" files="$3" runner="$4" expect="$5"; shift 5
  [ "$#" -ge 1 ] && [ "$1" = "--" ] && shift
  if [ "${#ONLY[@]}" -gt 0 ] && [[ ! " ${ONLY[*]} " =~ " $n " ]]; then return 0; fi

  echo
  echo "${C_D}=== mutation $n — $label${C_X}  $(date +%H:%M:%S)"
  ran=$((ran + 1))

  local -a flist=()
  if [ -n "$files" ]; then local IFS=','; flist=($files); unset IFS; fi
  local f
  if [ "${#flist[@]}" -gt 0 ]; then
    printf '%s\n' "${flist[@]}" > "$OUT/$n.paths"
    local -a mg_pairs=()
    for f in "${flist[@]}"; do cp "$ROOT/$f" "$(bak_of "$n" "$f")"; mg_pairs+=("$f=$(bak_of "$n" "$f")"); done
    # THE SENTINEL GOES DOWN BEFORE THE FIRST EDIT AND COMES UP ONLY ONCE THE
    # RESTORE HAS BEEN BYTE-VERIFIED. A `kill -9` here leaves it standing, and
    # every suite then REFUSES TO RUN rather than measuring the mutation — which
    # is stem-workbench#22, the false red that outlives the run that caused it.
    mg_claim "$n" "${mg_pairs[@]}"
  fi

  while [ "$#" -ge 3 ]; do
    if ! edit "$ROOT/$1" "$2" "$3"; then
      echo "${C_R}MUTATION $n DID NOT APPLY${C_X} — the anchor text in $1 has moved. Fix this script."
      for f in "${flist[@]:-}"; do [ -n "$f" ] && cp "$(bak_of "$n" "$f")" "$ROOT/$f"; done
      rm -f "$OUT/$n.paths"; mg_release "$n"; missed=$((missed + 1)); return 0
    fi
    shift 3
  done

  local log="$OUT/$n.log"
  local code=0
  eval "$runner" > "$log" 2>&1 || code=$?

  for f in "${flist[@]:-}"; do [ -n "$f" ] && cp "$(bak_of "$n" "$f")" "$ROOT/$f"; done
  for f in "${flist[@]:-}"; do
    [ -n "$f" ] || continue
    if ! cmp -s "$ROOT/$f" "$(bak_of "$n" "$f")"; then
      echo "${C_R}RESTORE FAILED for $f${C_X}"; missed=$((missed + 1)); return 0
    fi
  done
  # RESTORED AND BYTE-VERIFIED, so the sentinel comes up. A restore that FAILED
  # returns above without releasing, on purpose: the mutation really is still
  # standing then, and the next suite must refuse rather than measure it.
  mg_release "$n"
  rm -f "$OUT/$n.paths"

  local ok=1
  local IFS='|'; local -a wants=($expect); unset IFS
  local w
  for w in "${wants[@]}"; do
    if grep -qF -- "$w" "$log"; then
      echo "  ${C_G}saw${C_X}    $w"
    else
      echo "  ${C_R}MISS${C_X}   $w  ${C_D}— expected this in the transcript and it was not there${C_X}"
      ok=0
    fi
  done
  echo "  ${C_D}exit $code · $(tail -1 "$log" | cut -c1-120) · log out/locks-mutations/$n.log${C_X}"
  if [ "$ok" -eq 1 ]; then caught=$((caught + 1)); else missed=$((missed + 1)); fi
}

ONLY=("$@")
CANARY='node tools/suites/void-canary.mjs'

# --------------------------------------------- 0. green before mutating
echo "${C_D}=== baseline — void-canary must be GREEN before anything is broken${C_X}  $(date +%H:%M:%S)"
if ! $CANARY > "$OUT/baseline.log" 2>&1; then
  echo "${C_R}BASELINE IS RED${C_X} — nothing below would prove anything. Last lines:"
  tail -20 "$OUT/baseline.log"; exit 2
fi
echo "  ${C_G}green${C_X}  $(tail -1 "$OUT/baseline.log")"

# ==========================================================================
# 1-3  ONE LOCK PATH
# ==========================================================================
# THE DEFECT ITSELF: a twelfth copy of the path, in an ordinary suite, exactly
# the way the eleven arrived. The row must name the file.
#
# THE PLANTED PATH IS ASKED OF THE MODULE, NOT SPELLED HERE, and this script
# failed its own gate until it was — which is the rule working. A battery whose
# job is to plant a lock literal is still a file under `tools/`, so it obeys the
# same discipline as everything else: the path is materialised at RUN time and
# never appears in these bytes.
STRAY="$(node "$ROOT/tools/lib/locks.mjs" browser)"
mutate_case 1 "a second lock path appears in an ordinary suite" \
  "tools/suites/shell.mjs" \
  "$CANARY" \
  "A SECOND LOCK PATH: tools/suites/shell.mjs" \
  -- tools/suites/shell.mjs \
"const LOCK = BROWSER_LOCK;" \
"const LOCK = '$STRAY';"

# AND THE SCAN ITSELF CAN LOSE. Blinded, it reports a clean tree — which is what
# every version of this check looks like from the outside when it is broken, and
# is why the instrument check is a separate assertion with a planted file.
mutate_case 2 "blind the scan, so it reports a clean tree whatever is in it" \
  "tools/lib/locks.mjs" \
  "$CANARY" \
  "INSTRUMENT CHECK: the lock scan finds a planted second lock path" \
  -- tools/lib/locks.mjs \
"  walk(root);
  return hits.sort();" \
"  walk(root);
  return [];"

# THE TWO FORMULAS PARTING COMPANY. `capture-mute.mjs` claimed for months that
# the bash and node sink paths agree; nothing checked it until now.
mutate_case 3 "the shell half computes the sink lock somewhere else" \
  "spike/harness/bin/env.sh" \
  "$CANARY" \
  "...and the shell half computes the SAME sink lock as the module" \
  -- spike/harness/bin/env.sh \
'${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}' \
'${TMPDIR:-/tmp}'

# ==========================================================================
# 4-5  CONTENTION IS A SKIP
# ==========================================================================
# 4 IS THE POSITIVE CONTROL AND IT MUTATES NOTHING: somebody else holds the sink
# lock, so this run cannot measure, and it must SKIP — exit 0, no FAIL line. 5
# puts the old behaviour back and requires that we notice. Without 5 the control
# would pass over any code that happens to exit 0.
CONTENDED="CAPTURE_MUTE_LOCK_WAIT_S=3 node tools/suites/capture-mute.mjs"
if take_sink_lock; then
  mutate_case 4 "somebody else holds the sink lock — the suite must SKIP, not fail" \
    "" \
    "$CONTENDED" \
    "SKIPPED — the PipeWire sink lock was held by another run|A SKIP IS NOT A PASS" \
    --

  mutate_case 5 "put the old behaviour back: contention reported as a failed assertion" \
    "tools/suites/capture-mute.mjs" \
    "$CONTENDED" \
    "FAIL  taking the PipeWire sink lock failed" \
    -- tools/suites/capture-mute.mjs \
"  if (r.why === 'contention') {" \
"  if (false) {"
  release_sink_lock
else
  echo "${C_R}cases 4-5 did NOT run${C_X} — the contention apparatus could not take $SINK_LOCK."
  missed=$((missed + 2))
fi

# ==========================================================================
echo
echo "========================================================================"
if [ "$missed" -eq 0 ] && [ "$ran" -gt 0 ]; then
  echo "${C_G}all $caught of $ran mutations were caught${C_X} — one lock path, and contention is a skip."
  exit 0
fi
echo "${C_R}$missed of $ran mutations were NOT caught${C_X} (caught $caught). Logs in out/locks-mutations/."
exit 1
