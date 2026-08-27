#!/usr/bin/env bash
# Watch every assertion in `tools/suites/capture-mute.mjs` go RED, one mutation
# at a time. AGENTS.md: "An assertion you did not watch fail is not evidence."
#
# WHAT THIS SCRIPT ASSERTS, AND WHY IT IS NOT JUST `! node capture-mute.mjs`.
# A non-zero exit proves *something* went red, not that the intended thing did.
# The spike's own mutation runner shipped exactly that bug and review caught it.
# So each case declares the assertion NAMES it must turn red, and this script:
#
#   1. runs the suite UNMUTATED FIRST and requires GREEN — a mutation runner that
#      is red before it mutates has proved nothing;
#   2. refuses to continue if the edit did not apply (the anchor text moved);
#   3. requires every expected name to appear on a FAIL line;
#   4. requires the run to be red at all (exit non-zero);
#   5. restores the file and verifies the restored bytes match the original;
#   6. runs `tools/suites/coverage.py` over the whole battery, which refuses an
#      assertion that has never once been seen on a FAIL line.
#
# It also PRINTS every other assertion that went red in the same run without
# failing on it: a mutation with a wide blast radius is information, and hiding
# it would make the table read narrower than the truth.
#
#   tools/suites/capture-mute-mutations.sh          # all of them, ~10 minutes
#   tools/suites/capture-mute-mutations.sh 1 4 11   # only these cases
#
# ---------------------------------------------------------------------------
# THREE OF THESE CASES ARE NOT AN `edit`, AND THEY ARE THE INTERESTING ONES
# ---------------------------------------------------------------------------
# The gate's speaker side is measured by processes OUTSIDE the app, so three of
# its assertions cannot be falsified by editing a source file at all:
#
#   5   a PATH shim in front of `pw-record` that truncates ONLY the app's
#       recording to 0.2 s — "a short or empty recording is an error, never a 0"
#   11  an unrelated process writing a tone into the measured sink while the
#       window is open — the contamination `pwlinks.py --pid` exists to catch,
#       and the exact scenario a reviewer used to green the spike's whole matrix
#   12  pointing the lock witness at a file nobody holds — the lock half of
#       assertion 8, which nothing else can reach (and see the note above case 12
#       for why "kill the holder" cannot work: an `flock` lock is inherited by
#       every descendant of the process that took it)
#
# Each case costs one full suite run (two Electron launches, ~45 s).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$ROOT/out/capture-mute-mutations"
SINK="stem_workbench_gate"
DECOY="stem_workbench_gate_decoy"
cd "$ROOT"
# THE MUTATION GUARD. Traps are the belt: this battery restores on INT, TERM and
# HUP, and `timeout` sends TERM — which is how a long battery is most likely to
# die and was the one way it did not clean up (stem-workbench#22). The SENTINEL
# is the braces, for `kill -9`, a crashed host and a full disk, where no trap
# runs at all: while a mutation is standing there is a file under
# `out/.mutating/` naming it, and every suite refuses to start while one is
# there. `tools/lib/tree-guard.mjs` is the long form.
MG_BATTERY='capture-mute-mutations'; MG_ROOT="$ROOT"
. "$ROOT/tools/lib/mutation-guard.sh"
trap mg_on_signal INT TERM HUP   # on_signal() below is chained in via MG_ALSO
C_R=$'\033[31m'; C_G=$'\033[32m'; C_Y=$'\033[33m'; C_D=$'\033[2m'; C_X=$'\033[0m'

# ---------------------------------------------------------------------------
# THE WHOLE BATTERY RUNS UNDER THE SHARED BROWSER MUTEX, AND IT RE-EXECS ITSELF
# TO GET IT.
# ---------------------------------------------------------------------------
# Three agents share this checkout and all three launch Electron. `xvfb-run -a`
# picks a display by scanning for a free number, which is a race two launches can
# both win, and this battery holds a mutation on a SHIPPED FILE for the length of
# a run — so a sibling launching into the middle of one would be testing mutated
# product code and would never know.
#
# `flock` is not reentrant across processes, so the suite must be told the lock
# is already held or it would deadlock on itself. That is what
# `STEM_WORKBENCH_BROWSER_LOCK_HELD` is for, and it is the only place it is ever
# set.
#
# THE COST IS NAMED: this holds the mutex for the whole ~10 minutes. Siblings
# queue behind it. Running one case (`… 4`) is the polite way to iterate.
# THE ORDER IS SINK FIRST, BROWSER SECOND — `docs/TESTING.md` §4. Taking them the
# other way round deadlocks against any suite that takes them the documented way,
# which is not hypothetical: it cost a run on this machine, with a battery holding
# the browser mutex outermost and a leftover suite holding the sink lock and
# waiting for the browser mutex. Both had to be killed.
# THE PATH IS ASKED FOR, NOT RE-DERIVED. `tools/lib/locks.mjs` is the one place
# in `tools/` allowed to name a lock; a bash copy of the formula is the second
# literal that let two lines of work queue on two different files and then race
# each other on `xvfb-run -a`. `void-canary` goes red if this comes back.
BROWSER_LOCK="$(node "$ROOT/tools/lib/locks.mjs" browser)"
SINK_LOCK="$(node "$ROOT/tools/lib/locks.mjs" sink "$SINK")"
if [ "${CAPTURE_MUTE_BATTERY_LOCKED:-0}" != 1 ]; then
  export CAPTURE_MUTE_BATTERY_LOCKED=1
  echo "capture-mute-mutations: taking the sink lock then the shared browser mutex for the whole battery…"
  exec flock -w 3600 "$SINK_LOCK" flock -w 3600 "$BROWSER_LOCK" "$0" "$@"
fi
export STEM_WORKBENCH_BROWSER_LOCK_HELD=1
export STEM_WORKBENCH_SINK_LOCK_HELD=1

# ---------------------------------------------------------------------------
# A PREVIOUS BATTERY MAY HAVE DIED WITH A MUTATION STANDING, AND `rm -rf $OUT`
# WOULD DESTROY THE ONLY COPY OF THE ORIGINAL.
# ---------------------------------------------------------------------------
# This is the second half of the trap below and it is the half that was missing
# the first time it mattered: the trap restores when the battery is SIGNALLED,
# but a SIGKILL, a power cut, or a killed parent leaves the `.bak`/`.from` pair
# sitting in `$OUT` — and the next run's `rm -rf` then deletes the only copy of
# the unmutated file. The mutation is standing on a shipped file at that point
# and nothing on the machine can put it back.
#
# It cost a run on this machine: `--variant=d` was left as `--variant=b` in the
# suite, the next battery's BASELINE ran the control MUTED, read `speakerRms
# 0.000000`, and printed a red that had nothing to do with the code under test.
# So leftovers are replayed FIRST, loudly, and only then is `$OUT` cleared.
if compgen -G "$OUT/*.from" >/dev/null 2>&1; then
  echo "capture-mute-mutations: a previous run left mutations STANDING. Restoring before anything else:"
  for from in "$OUT"/*.from; do
    bak="${from%.from}.bak"; f="$(cat "$from")"
    [ -f "$bak" ] || { echo "  ${C_R}NO BACKUP for $f${C_X} — restore it from git by hand before re-running."; exit 2; }
    cp "$bak" "$ROOT/$f" && echo "  restored $f from $(basename "$bak")"
  done
fi

rm -rf "$OUT"; mkdir -p "$OUT"

# ---------------------------------------------------------------------------
# RESTORE ON SIGNAL. A killed battery that skips its restore leaves a MUTATION
# STANDING ON A SHIPPED FILE, in a checkout two other agents are committing from.
# That has already happened once on this machine, so this is not a precaution.
#
# Every backup this script takes is `$OUT/<case>.<basename>.bak`, and the name of
# the file it came from is recorded next to it in `$OUT/<case>.<basename>.from` —
# a basename alone cannot say whether `host.js` was the vendored one or one of
# ours. The trap replays every pair it finds, so it restores correctly even if it
# fires between two edits of a multi-file case.
# ---------------------------------------------------------------------------
restore_all() {
  local from bak f
  for from in "$OUT"/*.from; do
    [ -e "$from" ] || continue
    bak="${from%.from}.bak"
    f="$(cat "$from")"
    [ -f "$bak" ] || continue
    cp "$bak" "$ROOT/$f" && echo "  restored $f"
  done
}
on_signal() {
  echo
  echo "capture-mute-mutations: signal — restoring every mutated file before exiting."
  restore_all
  [ -n "${BG_PID:-}" ] && kill "$BG_PID" 2>/dev/null
  pkill -f "pw-play --target $SINK" 2>/dev/null
  SINK_NAME="$DECOY" SINK_LOCK_HELD=0 bash spike/harness/bin/sink.sh destroy >/dev/null 2>&1
  exit 130
}
MG_ALSO=on_signal

caught=0; missed=0; ran=0
HOST="vendor/stem-splitter-live/extension/offscreen/host.js"

# ---------------------------------------------------------------- the edits
# `edit FILE OLD NEW` — exact, first occurrence, and a HARD ERROR if the anchor
# is not there. A mutation that silently did not apply is a green nobody earned.
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

run_suite() {   # -> writes $1, returns the suite's exit code
  node tools/suites/capture-mute.mjs >"$1" 2>&1
}

fails_of() { grep -E '^FAIL' "$1" || true; }

# --------------------------------------------------------- the outside cases
# A case may set CASE_SETUP / CASE_TEARDOWN to a function name. They run around
# the suite and are cleared afterwards, so a case that forgets to set them
# cannot inherit the previous one's.
CASE_SETUP=""; CASE_TEARDOWN=""
SHIM="$OUT/shim"; TONE="$OUT/tone.wav"; BG_PID=""

# 5 — truncate ONLY the app's recording. The control's must be left alone: a
# shim that truncated both would turn the CONTROL red, the run would print VOID,
# and the red would be about the control rather than about the guard under test.
setup_truncate() {
  mkdir -p "$SHIM"
  cat > "$SHIM/pw-record" <<'SH'
#!/usr/bin/env bash
real="$(PATH="${PATH#*$SHIM_DIR:}" command -v pw-record)"
for a in "$@"; do case "$a" in *"/app.wav") exec timeout -s INT 0.2 "$real" "$@";; esac; done
exec "$real" "$@"
SH
  chmod +x "$SHIM/pw-record"
  export SHIM_DIR="$SHIM"
  export PATH="$SHIM:$PATH"
}
teardown_truncate() { export PATH="${PATH#"$SHIM":}"; unset SHIM_DIR; }

# 11 — a foreign writer. It waits for the sink the suite creates, then plays a
# tone into it until the run is over. `pwlinks.py --pid` must see a node outside
# this run's process tree and exit 4.
setup_foreign() {
  [ -f "$TONE" ] || ffmpeg -y -v error -f lavfi -i "sine=frequency=700:duration=60:sample_rate=48000" \
    -af "pan=stereo|c0=c0|c1=c0,volume=4" -c:a pcm_s16le "$TONE"
  (
    for _ in $(seq 1 600); do
      python3 spike/harness/bin/pwnode.py "$SINK" --quiet >/dev/null 2>&1 && break
      sleep 0.2
    done
    for _ in $(seq 1 20); do pw-play --target "$SINK" "$TONE" >/dev/null 2>&1; done
  ) &
  BG_PID=$!
}
teardown_foreign() { [ -n "$BG_PID" ] && { pkill -P "$BG_PID" 2>/dev/null; kill "$BG_PID" 2>/dev/null; }; BG_PID=""; pkill -f "pw-play --target $SINK" 2>/dev/null; true; }

# 12 USED TO BE "kill the suite's own lock holder mid-window", AND IT CANNOT WORK.
# Written that way it was watched MISSING, and the reason is worth keeping:
# `flock(2)`'s lock lives on the OPEN FILE DESCRIPTION, not on the process, and
# every descendant inherits that description across `fork`+`exec`. This battery
# takes the sink lock OUTERMOST (`exec flock … flock … "$0"`), so the whole tree
# under it holds the lock, and killing the `flock` process releases nothing — the
# suite's three in-window probes all still read "somebody holds it" and the
# assertion stayed green. It is not a gap in the assertion; it is a fact about
# the primitive, and the same fact is why `holdLock`'s `release()` closes the
# child's stdin FIRST and only then signals it.
#
# What IS falsifiable is the thing the witness is FOR: that it is a live probe of
# a real lock rather than a constant. Case 12 points it at a lock file nobody
# holds. Both halves of assertion 8's lock clause — the per-sample `flock -n` and
# `sinkLock.alive()` — then read false, which is exactly what they would read if
# the lock had been lost.

# 4 — the decoy sink the app is routed to while the meter stays on the real one.
setup_decoy() { SINK_NAME="$DECOY" SINK_LOCK_HELD=0 bash spike/harness/bin/sink.sh create >/dev/null 2>&1; }
teardown_decoy() { SINK_NAME="$DECOY" SINK_LOCK_HELD=0 bash spike/harness/bin/sink.sh destroy >/dev/null 2>&1; }

# `mutate_case N "label" "file[,file...]" "expect1|expect2" -- FILE OLD NEW [FILE OLD NEW ...]`
mutate_case() {
  local n="$1" label="$2" files="$3" expect="$4"; shift 4
  [ "$#" -ge 1 ] && [ "$1" = "--" ] && shift
  if [ "${#ONLY[@]}" -gt 0 ] && [[ ! " ${ONLY[*]} " =~ " $n " ]]; then CASE_SETUP=""; CASE_TEARDOWN=""; return 0; fi

  echo
  echo "${C_D}=== mutation $n — $label${C_X}"
  ran=$((ran + 1))

  local IFS=','; local -a flist=($files); unset IFS
  local f
  local -a mg_pairs=()
  for f in ${flist[@]+"${flist[@]}"}; do
    [ -n "$f" ] || continue
    cp "$ROOT/$f" "$OUT/$n.$(basename "$f").bak"
    printf '%s' "$f" > "$OUT/$n.$(basename "$f").from"
    mg_pairs+=("$f=$OUT/$n.$(basename "$f").bak")
  done
  # THE SENTINEL GOES DOWN BEFORE THE FIRST EDIT AND COMES UP ONLY ONCE THE
  # RESTORE HAS BEEN BYTE-VERIFIED. A `kill -9` here leaves it standing, and
  # every suite then REFUSES TO RUN rather than measuring the mutation — which
  # is stem-workbench#22, the false red that outlives the run that caused it.
  [ "${#mg_pairs[@]}" -gt 0 ] && mg_claim "$n" "${mg_pairs[@]}"

  while [ "$#" -ge 3 ]; do
    if ! edit "$ROOT/$1" "$2" "$3"; then
      echo "${C_R}MUTATION $n DID NOT APPLY${C_X} — the anchor text in $1 has moved. Fix this script."
      for f in ${flist[@]+"${flist[@]}"}; do [ -n "$f" ] && cp "$OUT/$n.$(basename "$f").bak" "$ROOT/$f"; done
      mg_release "$n"; missed=$((missed + 1)); CASE_SETUP=""; CASE_TEARDOWN=""; return 0
    fi
    shift 3
  done

  [ -n "$CASE_SETUP" ] && "$CASE_SETUP"

  local log="$OUT/$n.log"
  run_suite "$log"; local code=$?

  [ -n "$CASE_TEARDOWN" ] && "$CASE_TEARDOWN"
  CASE_SETUP=""; CASE_TEARDOWN=""

  for f in ${flist[@]+"${flist[@]}"}; do [ -n "$f" ] && cp "$OUT/$n.$(basename "$f").bak" "$ROOT/$f"; done
  for f in ${flist[@]+"${flist[@]}"}; do
    [ -z "$f" ] && continue
    if ! cmp -s "$ROOT/$f" "$OUT/$n.$(basename "$f").bak"; then
      echo "${C_R}RESTORE FAILED for $f${C_X}"; missed=$((missed + 1)); return 0
    fi
    rm -f "$OUT/$n.$(basename "$f").from"
  done
  # RESTORED AND BYTE-VERIFIED, so the sentinel comes up. A restore that FAILED
  # returns above without releasing, on purpose: the mutation really is still
  # standing then, and the next suite must refuse rather than measure it.
  mg_release "$n"

  local ok=1
  local IFS='|'; local -a wants=($expect); unset IFS
  local w
  for w in "${wants[@]}"; do
    if fails_of "$log" | grep -qF -- "$w"; then
      echo "  ${C_G}red${C_X}    $w"
    else
      echo "  ${C_R}MISS${C_X}   $w  ${C_D}— expected this assertion to fail and it did not${C_X}"
      ok=0
    fi
  done
  if [ "$code" -eq 0 ]; then
    echo "  ${C_R}MISS${C_X}   the suite exited 0 under the mutation"
    ok=0
  fi
  # A SKIP under a mutation is not a red. It means the box lost its audio daemon
  # mid-battery and every case after this one is meaningless.
  if grep -q '^SKIPPED' "$log"; then
    echo "  ${C_R}MISS${C_X}   the suite SKIPPED — the box stopped being able to answer, this proves nothing"
    ok=0
  fi

  local n_fail; n_fail="$(fails_of "$log" | wc -l | tr -d ' ')"
  echo "  ${C_D}$n_fail assertion(s) red in total · $(tail -1 "$log") · log out/capture-mute-mutations/$n.log${C_X}"
  fails_of "$log" | sed -E 's/^FAIL +//; s/  .*//' | sed "s/^/  ${C_D}·${C_X} /"

  if [ "$ok" -eq 1 ]; then caught=$((caught + 1)); else missed=$((missed + 1)); fi
}

ONLY=("$@")

# ------------------------------------------------- 0. green before mutating
echo "${C_D}=== baseline — the suite must be GREEN before anything is broken${C_X}"
if ! run_suite "$OUT/baseline.log"; then
  echo "${C_R}BASELINE IS RED${C_X} — nothing below would prove anything. Last lines:"
  tail -20 "$OUT/baseline.log"
  exit 2
fi
if grep -q '^SKIPPED' "$OUT/baseline.log"; then
  echo "${C_R}BASELINE SKIPPED${C_X} — this box has no PipeWire sink, so no mutation here can be watched."
  tail -5 "$OUT/baseline.log"
  exit 2
fi
echo "  ${C_G}green${C_X}  $(tail -1 "$OUT/baseline.log")"

# ==========================================================================
# THE CASE THE WHOLE GATE WAS REWRITTEN FOR. Variant (a): rely on Chromium's
# capture-scoped local-echo silencing instead of muting the view. The spike
# originally recorded this as a PASS; the whole-lifetime recording is what turns
# it into a FAIL, and this is the case that proves the recording is doing it.
mutate_case 1 "remove setAudioMuted(true) — variant (a), the 1.90 s pre-capture leak" \
  "src/main/youtube.js" \
  "the source view reports muted|the audio device stayed silent for the app's WHOLE lifetime" \
  -- src/main/youtube.js \
"  wc.setAudioMuted(true);

  const witness = {" \
"  const witness = {" \
  src/main/youtube.js \
"    wc.setAudioMuted(true);          // re-assert AFTER the sample, never before" \
"    void wc;"

# LIMITATION 6, REPRODUCED. `getDisplayMedia({audio: true})` yields mono 48 kHz
# with AGC that decays the level 17x over 8 s, and it reads 10.8x above a naive
# floor. The Host's own CAPTURE_MUST_BE guard refuses such a stream, so the guard
# is neutered too — otherwise the red would be "captureStream threw" rather than
# the five settings themselves, and the point is that a gate reading the SETTINGS
# catches it even when nothing else does.
mutate_case 2 "the Limitation-6 run: ask for \`audio: true\` and stop checking what came back" \
  "$HOST" \
  "the captured level sits inside the fixture's analytic band|the capture comes back STEREO|...at 44100 Hz|...with automatic gain control OFF" \
  -- "$HOST" \
"    audio: {
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
    }," \
"    audio: true," \
  "$HOST" \
"    if (wrong.length) {" \
"    if (false && wrong.length) {"

# THERE IS NO ISOLATED MUTATION FOR `autoGainControl`, AND THAT IS A MEASURED
# PLATFORM FACT RATHER THAN A GAP IN THIS BATTERY. Asking for
# `autoGainControl: true` ALONE, with the Host's guard neutered, was run here and
# the track still came back `channelCount 2, sampleRate 44100, autoGainControl
# false` — Chromium ignores it for a web-contents capture. It takes
# `echoCancellation` or `noiseSuppression` to move the capture onto the processed
# path, and that path turns AGC on with everything else (case 3b, and case 2).
# The AGC assertion's red therefore comes from case 2, where it reads
# `autoGainControl=true` next to mono/48000 — which is Limitation 6 itself.

mutate_case 3b "ask for echo cancellation and noise suppression, and stop checking" \
  "$HOST" \
  "...with echo cancellation OFF|...with noise suppression OFF" \
  -- "$HOST" \
"      echoCancellation: false,
      noiseSuppression: false," \
"      echoCancellation: true,
      noiseSuppression: true," \
  "$HOST" \
"    if (wrong.length) {" \
"    if (false && wrong.length) {"

# THE HYPOTHESIS THE NODE WITNESS EXISTS TO EXCLUDE. Route the app to a decoy and
# the speaker meter reads 0.0 — a PASS for the wrong reason, which is exactly how
# a reviewer greened the spike's entire matrix. Assertion 7 is what must catch it,
# and the silence assertion staying green under this mutation is the point rather
# than an oversight.
CASE_SETUP=setup_decoy; CASE_TEARDOWN=teardown_decoy
mutate_case 4 "route the app to a decoy sink while the meter stays on the real one" \
  "tools/suites/capture-mute.mjs" \
  "the app's OWN audio output node named a pid in this run's tree" \
  -- tools/suites/capture-mute.mjs \
"], { witness: true, sink: SINK });" \
"], { witness: true, sink: \`\${SINK}_decoy\` });"

CASE_SETUP=setup_truncate; CASE_TEARDOWN=teardown_truncate
mutate_case 5 "truncate the app's recording to 0.2 s — an empty window must be an ERROR, not a 0" \
  "" \
  "the audio device stayed silent for the app's WHOLE lifetime|...and both meters covered the time they claim to" \
  --

mutate_case 6 "run the control with the mute ON — the control must LOSE" \
  "tools/suites/capture-mute.mjs" \
  "the control can be heard|the audio device stayed silent for the app's WHOLE lifetime" \
  -- tools/suites/capture-mute.mjs \
"  '--variant=d', '--page=local'," \
"  '--variant=b', '--page=local',"

mutate_case 7 "serve the gate's own root unconditionally — the test seam left open" \
  "src/main/main.js" \
  "the capture-side instrument is not shipped" \
  -- src/main/main.js \
"if (GATE) ROOTS.push({ prefix: '/gate/', dir: path.join(APP_ROOT, 'tools', 'fixture') });" \
"ROOTS.push({ prefix: '/gate/', dir: path.join(APP_ROOT, 'tools', 'fixture') });"

mutate_case 8 "the probe writes no report — a suite that cannot look must FAIL, not exit 0" \
  "tools/gate/capture-mute.mjs" \
  "the app launches from its real entry point and writes a capture-mute report" \
  -- tools/gate/capture-mute.mjs \
"  fs.writeFileSync(path.join(outDir, 'report.json'), \`\${JSON.stringify(R, null, 2)}\n\`);" \
"  void R;"

mutate_case 9 "the worklet stops counting quanta — 0 quanta must be an ERROR, not a silence" \
  "tools/fixture/rms-worklet.js" \
  "...over a window counted in RENDER QUANTA|the captured level sits inside the fixture's analytic band" \
  -- tools/fixture/rms-worklet.js \
"    this.quanta++;" \
"    ;"

# The count and the level are SEPARATE claims. A 1 s window still reads 0.35, so
# the level assertion stays green and only the count-grounded one goes red —
# which is what "grounded on the quanta count" means.
mutate_case 10 "shorten the measurement window to 1 s" \
  "tools/gate/capture-mute.mjs" \
  "...over a window counted in RENDER QUANTA|...and both meters covered the time they claim to" \
  -- tools/gate/capture-mute.mjs \
"const WINDOW_SECONDS = 4;" \
"const WINDOW_SECONDS = 1;"

CASE_SETUP=setup_foreign; CASE_TEARDOWN=teardown_foreign
mutate_case 11 "an unrelated process writes a 700 Hz tone into the measured sink" \
  "" \
  "...and nothing outside that tree wrote to the sink while we measured" \
  --

# THE ANCHOR MOVED AND IT NO LONGER QUOTES A LOCK NAME. The sink path is not
# spelled in this suite any more — `tools/lib/locks.mjs` is the one place in
# `tools/` allowed to name a lock, and `void-canary` refuses a second literal,
# INCLUDING one quoted here as a mutation anchor. So the same mutation is made
# one level up: ask the canonical module for a lock belonging to a sink that does
# not exist. Take and witness both move together, exactly as before.
mutate_case 12 "point the lock witness at a lock file nobody holds" \
  "tools/suites/capture-mute.mjs" \
  "...and nothing outside that tree wrote to the sink while we measured" \
  -- tools/suites/capture-mute.mjs \
"const SINK_LOCK = sinkLockPath(SINK);" \
"const SINK_LOCK = sinkLockPath(SINK + '-nobody-holds-this');"

# THE GUARD MUST BE OUT OF A USER'S REACH, NOT MERELY PRESENT. Case 7 deletes the
# guard; this one leaves both seams reading `if (GATE)` exactly as they are and
# removes only `app.isPackaged` from the definition of GATE. The scan still counts
# 2/2 guarded mentions of tools/ and every other assertion is untouched — the only
# thing that can notice is the half of assertion 9 that EVALUATES the definition
# with `isPackaged` true and false. A substring test for `app.isPackaged` would
# also have passed the variant that reads it and ignores it.
mutate_case 13 "drop the packaged-build guard — a shipped binary would honour --gate" \
  "src/main/main.js" \
  "the capture-side instrument is not shipped" \
  -- src/main/main.js \
"const GATE = app.isPackaged ? '' : val('gate', '');" \
"const GATE = val('gate', '');"

# ==========================================================================
echo
if [ "${#ONLY[@]}" -eq 0 ]; then
  echo "${C_D}=== coverage — did every assertion go red at least once?${C_X}"
  python3 "$HERE/coverage.py" "$OUT" || missed=$((missed + 1))
else
  echo "${C_D}coverage is only claimed after a FULL battery — a subset cannot make it${C_X}"
fi
echo
echo "capture-mute-mutations: $ran run, ${C_G}$caught caught${C_X}, ${C_R}$missed missed${C_X}"
[ "$missed" -eq 0 ] && exit 0 || exit 1
