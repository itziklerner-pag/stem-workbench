#!/usr/bin/env bash
# Watch every assertion about THE TREE GUARD go red, one mutation at a time, and
# then reproduce the defect itself end to end. AGENTS.md: "An assertion you did
# not watch fail is not evidence."
#
# THE DEFECT (stem-workbench#22). A mutation battery edits a shipped file, runs a
# suite, and restores — on its own EXIT. `timeout` sends SIGTERM, so the way a
# long battery is most likely to die was the one way it did not clean up. Twice
# in one afternoon a battery was killed and left its edit standing (`tabId` back
# on `src/main/engine-messages.js`; `--variant=b` in a suite), and the next gate
# run measured the mutated tree and reported a red that was not in the code.
#
# A false red costs exactly as much investigation as a real defect and teaches
# everyone to distrust reds. This one is also CONTAGIOUS: it outlives the run
# that caused it and lands on whoever measures next.
#
# CASE 4 IS THE WHOLE POINT OF THIS FILE. Cases 1-3 break the assertions; case 4
# breaks the WORLD — it starts a real battery, `kill -9`s it the instant its
# mutation is standing (so no trap can possibly run), and then requires a real
# suite to REFUSE rather than report a number. Case 5 does the same for an
# uncommitted `src/` with no sentinel at all.
#
# NO DISPLAY, NO BROWSER, NO MUTEX. `void-canary` and `deck-seam` are both plain
# node and instant, which is why this can run beside a windowed battery.
#
# THE NAME IS NARROWER THAN THE FILE. Twelve of its fourteen cases mutate
# something and require a named row of `void-canary` to go red, so this is in
# practice THE `void-canary` BATTERY; only cases 4 and 5 are about the tree guard
# specifically. It is not renamed because `docs/TESTING.md`, the battery list in
# `void-canary` itself and every reference to case 4 name it as it is, and a
# rename would be churn with no assertion behind it.
#
#   tools/suites/tree-guard-mutations.sh          # all of them
#   tools/suites/tree-guard-mutations.sh 4        # only that one
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
OUT="$ROOT/out/tree-guard-mutations"
rm -rf "$OUT"; mkdir -p "$OUT"
cd "$ROOT"

MG_BATTERY='tree-guard-mutations'; MG_ROOT="$ROOT"
. "$ROOT/tools/lib/mutation-guard.sh"
trap mg_on_signal INT TERM HUP

C_R=$'\033[31m'; C_G=$'\033[32m'; C_D=$'\033[2m'; C_X=$'\033[0m'
caught=0; missed=0; ran=0
ONLY=("$@")
wanted() { [ "${#ONLY[@]}" -eq 0 ] || [[ " ${ONLY[*]} " =~ " $1 " ]]; }

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

check() {   # <case> <ok?> <what>
  if [ "$2" = 1 ]; then echo "  ${C_G}saw${C_X}    $3"; else echo "  ${C_R}MISS${C_X}   $3"; fi
  [ "$2" = 1 ] || return 1
}

# `canary_case N "label" FILE OLD NEW "expected substring"` — mutate, run
# void-canary, require the named row to be red, restore, verify the bytes.
canary_case() {
  local n="$1" label="$2" file="$3" old="$4" new="$5" want="$6"
  wanted "$n" || return 0
  echo; echo "${C_D}=== mutation $n — $label${C_X}  $(date +%H:%M:%S)"
  ran=$((ran + 1))
  local bak="$OUT/$n.$(basename "$file").bak"
  cp "$ROOT/$file" "$bak"
  mg_claim "$n" "$file=$bak"
  if ! edit "$ROOT/$file" "$old" "$new"; then
    echo "  ${C_R}DID NOT APPLY${C_X} — the anchor in $file has moved. Fix this script."
    cp "$bak" "$ROOT/$file"; mg_release "$n"; missed=$((missed + 1)); return 0
  fi
  local log="$OUT/$n.log"; local code=0
  node tools/suites/void-canary.mjs > "$log" 2>&1 || code=$?
  cp "$bak" "$ROOT/$file"
  if ! cmp -s "$ROOT/$file" "$bak"; then
    echo "  ${C_R}RESTORE FAILED for $file${C_X}"; missed=$((missed + 1)); return 0
  fi
  mg_release "$n"
  local ok=1
  grep -E '^FAIL' "$log" | grep -qF -- "$want" || ok=0
  check "$n" "$ok" "$want" || true
  [ "$code" -ne 0 ] || { echo "  ${C_R}MISS${C_X}   void-canary exited 0 under the mutation"; ok=0; }
  echo "  ${C_D}exit $code · $(tail -1 "$log") · log out/tree-guard-mutations/$n.log${C_X}"
  if [ "$ok" = 1 ]; then caught=$((caught + 1)); else missed=$((missed + 1)); fi
}

# ==========================================================================
# 1-3  THE ASSERTIONS THEMSELVES
# ==========================================================================
canary_case 1 "a bash battery loses its INT/TERM/HUP trap" \
  "tools/suites/deck-seam-mutations.sh" \
  "trap mg_on_signal INT TERM HUP" \
  "true # trap removed" \
  "every BASH mutation battery installs the guard and traps INT, TERM and HUP"

canary_case 2 "a bash battery stops claiming a sentinel before it edits" \
  "tools/suites/transport-mutations.sh" \
  '  mg_claim "$n" "${mg_pairs[@]}"' \
  '  : # claim removed' \
  "...and every one of them claims a sentinel before it edits and releases it after the restore"

# THE READER ITSELF CAN LOSE. Blinded, it reports a clean tree whatever is on it
# — which is what every version of this check looks like from the outside when it
# is broken, and is why the instrument check plants a sentinel of its own.
canary_case 3 "blind the sentinel reader, so it reports a clean tree whatever is standing" \
  "tools/lib/tree-guard.mjs" \
  "  return names.filter((n) => n.endsWith('.json')).sort().map((n) => {" \
  "  return [].map((n) => {" \
  "INSTRUMENT CHECK: a planted sentinel is seen, and a tree without one is not accused"

# ==========================================================================
# 6-9  THE SAME FOUR THINGS FOR THE JAVASCRIPT BATTERIES
#
# Cases 1 and 2 glob `*-mutations.sh`, and so did the assertions they watch —
# which is how two `.mjs` batteries came to be outside the rule entirely and both
# arrived broken. A `.mjs` file cannot carry a bash `trap`, so what is watched
# here is the property the trap is FOR: a SIGTERM arriving while an edit is
# standing puts the file back. Case 9 is the one that would have caught the blind
# spot itself rather than its consequences.
# ==========================================================================
canary_case 6 "a JS battery stops installing the guard, so nothing handles its signals" \
  "tools/suites/deck-host-mutations.mjs" \
  "const guard = mutationGuard({ battery: ID, root: ROOT });" \
  "const guard = { claim() {}, restore() {}, release() {} };   // guard removed" \
  "every JS mutation battery installs the guard, which is where its INT, TERM and HUP handlers come from"

canary_case 7 "a JS battery stops claiming a sentinel before it edits" \
  "tools/suites/deck-host-mutations.mjs" \
  "  guard.claim(m.id, files);" \
  "  /* claim removed */" \
  "...and every one of THEM claims a sentinel before it edits and releases it after the restore"

# THE GUARD ITSELF, NOT A GREP FOR IT. Cases 6 and 7 are text searches, and a
# text search is an assumption with a regex in front of it: a battery can import
# the module, call every method, and still strand its edit if the module stopped
# listening. This breaks the module and requires the temp-tree kill to notice.
canary_case 8 "the guard stops registering its handlers, so a SIGTERM strands the edit" \
  "tools/lib/mutation-guard.mjs" \
  "  for (const sig of GUARD_SIGNALS) process.on(sig, () => onSignal(sig));" \
  "  void GUARD_SIGNALS; void onSignal;   // nothing is registered" \
  "INSTRUMENT CHECK: a SIGTERM delivered while a JS battery's edit is standing puts the file back"

# A THIRD KIND OF BATTERY, WHICH IS THE ORIGINAL DEFECT IN ITS PUREST FORM: not a
# battery that is wrong, a battery that nothing looks at. The mutation is a file
# rather than an edit, so it does not go through `canary_case`.
if wanted 9; then
  echo; echo "${C_D}=== mutation 9 — a battery arrives in a third language, which neither check globs${C_X}  $(date +%H:%M:%S)"
  ran=$((ran + 1))
  rogue="$ROOT/tools/suites/rogue-mutations.py"
  printf '# a battery in a language neither row globs\n' > "$rogue"
  code=0; node tools/suites/void-canary.mjs > "$OUT/9.log" 2>&1 || code=$?
  rm -f "$rogue"
  ok9=1
  grep -E '^FAIL' "$OUT/9.log" | grep -qF -- "...and every battery under tools/suites is one of those two kinds" || ok9=0
  check 9 "$ok9" "...and every battery under tools/suites is one of those two kinds" || true
  [ "$code" -ne 0 ] || { echo "  ${C_R}MISS${C_X}   void-canary exited 0 with an unchecked battery on the tree"; ok9=0; }
  [ -e "$rogue" ] && { echo "  ${C_R}THE ROGUE FILE WAS LEFT BEHIND${C_X}"; ok9=0; }
  echo "  ${C_D}exit $code · $(tail -1 "$OUT/9.log") · log out/tree-guard-mutations/9.log${C_X}"
  if [ "$ok9" = 1 ]; then caught=$((caught + 1)); else missed=$((missed + 1)); fi
fi

# ==========================================================================
# 10-14  COVERAGE DRIFT — the instrument that names an assertion which STOPPED
#
# `docs/TESTING.md` §2 conditioned this on "the first time two host suites are
# green on one tree"; all twelve are. Each case below is one of the holes the
# implementation was built around, not a restatement of what it does — and three
# of them are holes the EXTENSION's version has, so "port it" was not the answer.
# ==========================================================================
canary_case 10 "the diff cannot see a loss at all" \
  "tools/verify.mjs" \
  "  if (!gone.length && !added.length) return null;" \
  "  return null;" \
  "an assertion that stopped running is NAMED, and an unchanged run reports nothing"

# THE EXTENSION'S OWN EARLY RETURN, reintroduced. Its comment names the failure
# two paragraphs above the line that causes it: two blocks that swap cancel out
# in a count.
canary_case 11 "gate the diff on the count, the way the extension's does" \
  "tools/verify.mjs" \
  "  const tally = (a) => a.reduce" \
  "  if (prev.names.length === names.length) return null;
  const tally = (a) => a.reduce" \
  "...and a SWAP is reported, though the count did not move"

# A GUARD THAT HIDES WHAT IT WAS INSTALLED TO REVEAL. Measured on the real
# watched-red run: guarded `transport` prints 63 passed, 1 failed — 64 on a count.
canary_case 12 "count a block guard's own red as coverage" \
  "tools/verify.mjs" \
  "  return assertionLines(out).map((a) => a.name).filter((n) => !n.startsWith(HARNESS_PREFIX));" \
  "  return assertionLines(out).map((a) => a.name);" \
  "...and a block guard's own red is NOT counted as coverage"

# THE ONE THAT MAKES THE INSTRUMENT STOP REPORTING AFTER ONE RUN. A truncated run
# becomes the new baseline, the next run agrees with it, and a live regression
# goes quiet.
canary_case 13 "let a run that never finished become the next baseline" \
  "tools/verify.mjs" \
  "export const completedRun = (out) => countOf(out) !== null;" \
  "export const completedRun = () => true;" \
  "a run that printed NO SUMMARY LINE is not recordable as a baseline"

# RULING 27's CONDITION. Drift is a warning rather than a verdict, which is only
# safe if the warning is impossible to miss — a warning nobody reads is an
# instrument that never fired, one step slower.
canary_case 15 "the coverage warning never reaches the verdict line" \
  "tools/verify.mjs" \
  "  if (!parts.length) return '';" \
  "  return '';
  if (!parts.length) return '';" \
  "a coverage warning reaches the VERDICT LINE, naming the steps"

canary_case 16 "...or decorates a clean run with a warning about nothing" \
  "tools/verify.mjs" \
  "  if (!parts.length) return '';" \
  "  if (!parts.length) return 'coverage is fine';" \
  "a coverage warning reaches the VERDICT LINE, naming the steps"

canary_case 14 "the block guard loses the marker that keeps it out of coverage" \
  "tools/suites/transport.mjs" \
  "  ok('HARNESS: the launch section ran to its end without throwing" \
  "  ok('the launch section ran to its end without throwing" \
  "...and the block guard really spells the marker the runner excludes"

# ==========================================================================
# 4  THE DEFECT ITSELF, END TO END, WITH NO TRAP IN THE WAY
#
# A REAL BATTERY, KILLED WITH SIGKILL THE INSTANT ITS MUTATION IS STANDING. No
# trap runs — that is the point of `kill -9` and it is what a crashed host or a
# full disk look like. Then a REAL suite has to refuse rather than report a
# number, `restore-all` has to put the tree back, and the suite has to come back
# green. If this does not work end to end the fix is not done.
# ==========================================================================
if wanted 4; then
  echo; echo "${C_D}=== mutation 4 — kill -9 a battery mid-case, then require a suite to REFUSE${C_X}  $(date +%H:%M:%S)"
  ran=$((ran + 1))
  ok4=1
  rm -f "$ROOT"/out/.mutating/*.json 2>/dev/null

  # Its own process group, so the kill takes the battery AND the suite it spawned.
  setsid bash tools/suites/deck-seam-mutations.sh 1 > "$OUT/4.battery.log" 2>&1 &
  victim=$!
  # WAIT FOR THE EDIT, NOT MERELY FOR THE SENTINEL. The sentinel goes down BEFORE
  # the first edit — deliberately, or a kill landing between the two would strand
  # a mutation with nothing naming it — so the instant it appears the file on disk
  # is still clean. What this case is about is the window AFTER the edit, so it
  # waits for the file the sentinel names to actually differ.
  sentinel=''; victimfile=''
  for _ in $(seq 1 1200); do
    if [ -z "$sentinel" ]; then
      sentinel="$(ls "$ROOT"/out/.mutating/*.json 2>/dev/null | head -1)"
      [ -n "$sentinel" ] && victimfile="$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(s.files[0].rel)' "$sentinel" 2>/dev/null)"
    fi
    if [ -n "$victimfile" ] && ! git -C "$ROOT" diff --quiet -- "$victimfile"; then break; fi
    # the case may already have finished and restored; the sentinel is then gone
    [ -n "$sentinel" ] && [ ! -e "$sentinel" ] && { sentinel=''; victimfile=''; }
    sleep 0.005
  done
  [ -n "$victimfile" ] && git -C "$ROOT" diff --quiet -- "$victimfile" && sentinel=''
  if [ -z "$sentinel" ]; then
    echo "  ${C_R}MISS${C_X}   never caught deck-seam-mutations with a mutation standing"
    kill -9 -"$victim" 2>/dev/null; wait "$victim" 2>/dev/null
    ok4=0
  else
    kill -9 -"$victim" 2>/dev/null; wait "$victim" 2>/dev/null
    echo "  ${C_D}killed -9 with $(basename "$sentinel") standing on $victimfile${C_X}"

    # (a) the mutation really is on disk — otherwise the rest proves nothing
    if git -C "$ROOT" diff --quiet -- "$victimfile"; then
      echo "  ${C_R}MISS${C_X}   the file is unchanged — nothing was actually left standing"; ok4=0
    else
      check 4 1 "the mutation is standing on $victimfile after a kill no trap can catch" || true
    fi

    # (b) A REAL SUITE REFUSES, and names the file and the case. Each half is
    # reported on its own line: a gate that stops at the first miss hides the
    # rest of the picture from whoever has to read this.
    code=0; node tools/suites/deck-seam.mjs > "$OUT/4.refusal.log" 2>&1 || code=$?
    refok=1
    [ "$code" -eq 3 ] || { echo "  ${C_R}MISS${C_X}   deck-seam exited $code, not 3"; refok=0; }
    for want in "REFUSING TO RUN" "deck-seam-mutations case 1" "$victimfile" "GONE (killed"; do
      grep -qF -- "$want" "$OUT/4.refusal.log" || { echo "  ${C_R}MISS${C_X}   the refusal did not name: $want"; refok=0; }
    done
    if grep -q "SKIPPED" "$OUT/4.refusal.log"; then
      echo "  ${C_R}MISS${C_X}   it printed SKIPPED — a refusal is an ERROR, never a skip"; refok=0
    fi
    if [ "$refok" = 1 ]; then
      check 4 1 "deck-seam REFUSED, exit 3, naming the file and the case" || true
    else
      ok4=0
    fi

    # (c) and the way out puts the tree back
    node tools/lib/tree-guard.mjs restore-all > "$OUT/4.restore.log" 2>&1
    if git -C "$ROOT" diff --quiet -- "$victimfile"; then
      check 4 1 "restore-all put $victimfile back and dropped the sentinel" || true
    else
      echo "  ${C_R}MISS${C_X}   restore-all did not restore $victimfile"; ok4=0
    fi

    # (d) ...and the suite measures again
    code=0; node tools/suites/deck-seam.mjs > "$OUT/4.after.log" 2>&1 || code=$?
    [ "$code" -eq 0 ] || { echo "  ${C_R}MISS${C_X}   deck-seam still does not run: exit $code"; ok4=0; }
    [ "$code" -eq 0 ] && check 4 1 "and deck-seam runs again: $(tail -1 "$OUT/4.after.log")" || true
  fi
  echo "  ${C_D}logs out/tree-guard-mutations/4.*.log${C_X}"
  if [ "$ok4" = 1 ]; then caught=$((caught + 1)); else missed=$((missed + 1)); fi
fi

# ==========================================================================
# 5  A DIRTY src/ WITH NO SENTINEL AT ALL
#
# The belt and the braces both assume a battery was involved. This is the third
# case: somebody's edit, or a battery so old its backups are gone. What a suite
# must not do is measure it and call the number evidence.
# ==========================================================================
if wanted 5; then
  echo; echo "${C_D}=== mutation 5 — uncommitted src/ and no sentinel${C_X}  $(date +%H:%M:%S)"
  ran=$((ran + 1))
  ok5=1
  victim='src/main/bus.js'
  cp "$ROOT/$victim" "$OUT/5.bus.js.bak"
  mg_claim 5 "$victim=$OUT/5.bus.js.bak"
  printf '\n// left behind by a battery that died\n' >> "$ROOT/$victim"
  # The sentinel this battery just claimed would exempt the suite, so it is taken
  # out of the way for the measurement and put back for the restore — the case is
  # about a tree with NO sentinel on it.
  mv "$ROOT/out/.mutating/tree-guard-mutations.5.json" "$OUT/5.sentinel.json"

  code=0; node tools/suites/deck-seam.mjs > "$OUT/5.refusal.log" 2>&1 || code=$?
  [ "$code" -eq 3 ] || { echo "  ${C_R}MISS${C_X}   deck-seam exited $code, not 3"; ok5=0; }
  grep -qF -- "src/main/bus.js" "$OUT/5.refusal.log" || { echo "  ${C_R}MISS${C_X}   the refusal did not name the dirty file"; ok5=0; }
  grep -q "SKIPPED" "$OUT/5.refusal.log" && { echo "  ${C_R}MISS${C_X}   it printed SKIPPED — a refusal is an ERROR"; ok5=0; }
  [ "$ok5" = 1 ] && check 5 1 "deck-seam REFUSED on an uncommitted src/, naming the file" || true

  # ...AND THE ESCAPE ANNOUNCES ITSELF. A run that measured a dirty tree has to
  # say so in its own transcript; a silent escape is the ignore-list this repo
  # keeps having to delete.
  code=0; STEM_WORKBENCH_ALLOW_DIRTY=1 node tools/suites/deck-seam.mjs > "$OUT/5.allowed.log" 2>&1 || code=$?
  grep -qF -- "MEASURING A DIRTY TREE" "$OUT/5.allowed.log" \
    && check 5 1 "...and STEM_WORKBENCH_ALLOW_DIRTY=1 measures anyway, announcing it in the transcript" || {
      echo "  ${C_R}MISS${C_X}   the allowed run did not announce the dirty tree"; ok5=0; }

  mv "$OUT/5.sentinel.json" "$ROOT/out/.mutating/tree-guard-mutations.5.json"
  cp "$OUT/5.bus.js.bak" "$ROOT/$victim"
  cmp -s "$ROOT/$victim" "$OUT/5.bus.js.bak" || { echo "  ${C_R}RESTORE FAILED for $victim${C_X}"; ok5=0; }
  mg_release 5
  echo "  ${C_D}logs out/tree-guard-mutations/5.*.log${C_X}"
  if [ "$ok5" = 1 ]; then caught=$((caught + 1)); else missed=$((missed + 1)); fi
fi

echo
echo "========================================================================"
if [ "$missed" -eq 0 ] && [ "$ran" -gt 0 ]; then
  echo "${C_G}all $caught of $ran mutations were caught${C_X} — a stranded mutation cannot be measured past."
  exit 0
fi
echo "${C_R}$missed of $ran mutations were NOT caught${C_X} (caught $caught). Logs in out/tree-guard-mutations/."
exit 1
