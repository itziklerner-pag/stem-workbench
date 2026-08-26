#!/usr/bin/env bash
# AGENTS.md: "An assertion never observed failing is one whose ability to fail is
# an assumption." This deliberately breaks the experiment and asserts the RED.
#
# M1  route the app to a DECOY sink while still measuring the real one. Every
#     speaker reading goes to 0.0 — including the nocapture control's. The
#     summary must then print VOID for a/b/c and exit non-zero, because
#     "the speakers were silent" on a run where the meter has just been shown
#     unable to hear the app is not a finding.
#
# WHAT THIS SCRIPT USED TO ASSERT, AND WHY THAT WAS NOT ENOUGH.
# Its whole assertion was `if python3 summarise.py "$tmp"; then NOT CAUGHT`, and
# it built $tmp with `cp … 2>/dev/null || true`. A failed copy was swallowed, so
# run against a directory holding only the M1 record it would print
# "M1 asserted RED: 1 mutation caught" while summarise.py had in fact printed
# `0 passed, 2 failed` and NO a/b/c rows at all — a red of an entirely different
# shape from the one it claims to watch (write-up Limitation 9). A non-zero exit
# is not evidence that the intended thing went red.
#
# It now asserts the SHAPE, on both sides of the mutation:
#   1. every input copy is checked, and the fixture directory is counted;
#   2. the UNMUTATED directory is scored first and must be GREEN — a mutation
#      runner that is red before it mutates has proved nothing;
#   3. the mutated record must itself show the mutation took (app routed to the
#      decoy, measured sink silent);
#   4. the mutated summary must print exactly the documented red: the nocapture
#      control FAILS, the local-echo and silent controls still PASS, a/b/c each
#      print VOID, the failure count is exactly 4, and the exit code is 1
#      (a run-level failure) and not 2 (VOID — scored nothing).
#
# (M2 is not scripted: it happened for real. The `silent` negative control read
#  0.350295 instead of 0 on its first run, because spike/fixture/player.html
#  autoplayed regardless of the flag. The control caught a defect in the
#  instrument, which is the whole reason it exists.)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPIKE="$(cd "$HERE/.." && pwd)"
HARNESS="${AUDIO_HARNESS:-$SPIKE/harness}"
# shellcheck source=../harness/bin/env.sh
source "$HARNESS/bin/env.sh"
die() { echo "spike: $*" >&2; exit 1; }

DECOY="${DECOY_SINK:-${SINK_NAME}_decoy}"
mut="$SPIKE/mutations"; rm -rf "$mut"; mkdir -p "$mut"
src="${MUTATION_SRC:-$SPIKE/results}"   # overridable so this script can be watched failing
fixture="$mut/fixture"; mutated="$mut/mutated"
mkdir -p "$fixture"

fail=0
want() {   # want FILE 'grep -E pattern' 'what it means'
  if grep -Eq "$2" "$1"; then
    echo "  ok   $3"
  else
    echo "  MISS $3" >&2
    echo "       expected /$2/ in $1" >&2
    fail=$((fail + 1))
  fi
}
reject() {
  if grep -Eq "$2" "$1"; then
    echo "  MISS $3 (found /$2/, which must not be there)" >&2
    fail=$((fail + 1))
  else
    echo "  ok   $3"
  fi
}

# ---------------------------------------------------------------- the fixture
# Copied, not globbed-and-hoped: a missing input has to stop the script, because
# a directory with no a/b/c records produces a red that looks like the one we
# are watching for and means something else entirely.
copied=0
for v in a b c d; do
  for r in 1 2 3; do
    cp "$src/local-$v-run$r.json" "$fixture/" || die "missing input $src/local-$v-run$r.json"
    copied=$((copied + 1))
  done
done
silent=0
for r in 1 2 3; do
  [ -f "$src/local-silent-run$r.json" ] || continue
  cp "$src/local-silent-run$r.json" "$fixture/"
  silent=$((silent + 1)); copied=$((copied + 1))
done
[ "$silent" -ge 2 ] || die "need at least 2 local-silent records, found $silent"
cp "$src/local-nocapture-run1.json" "$fixture/" || die "missing $src/local-nocapture-run1.json"
copied=$((copied + 1))
[ "$copied" -ge 15 ] || die "fixture holds only $copied records — refusing to assert on it"
echo "fixture: $copied committed local records in $fixture"

# --------------------------------------------------------- 0. it starts GREEN
echo
echo "--- baseline: the SAME directory, unmutated (expected: all green, exit 0) ---"
set +e
python3 "$HERE/summarise.py" "$fixture" --allow-mixed-runs > "$mut/baseline.txt" 2>&1
base_rc=$?
set -e
sed -n '/^  \(PASS\|FAIL\)/p' "$mut/baseline.txt"
[ "$base_rc" -eq 0 ] || { cat "$mut/baseline.txt" >&2; die "baseline is not green (exit $base_rc) — nothing this script does afterwards can mean anything"; }
want "$mut/baseline.txt" '^  PASS control local/nocapture'   'baseline: nocapture control holds'
want "$mut/baseline.txt" '^  PASS control local/local-echo'  'baseline: local-echo control holds'
want "$mut/baseline.txt" '^  PASS local/a '                  'baseline: local/a scored PASS'
want "$mut/baseline.txt" '^  PASS local/b '                  'baseline: local/b scored PASS'
want "$mut/baseline.txt" '^  PASS local/c '                  'baseline: local/c scored PASS'
want "$mut/baseline.txt" '^  PASS control local/silent-source' 'baseline: silent control holds'
want "$mut/baseline.txt" '^spike: [0-9]+ passed, 0 failed$'  'baseline: 0 failed'

# ------------------------------------------------------------------ mutate it
echo
echo "M1: app routed to $DECOY, meter still on $SINK_NAME"
"$HARNESS/bin/pwnode.py" "$DECOY" >/dev/null 2>&1 || pw-cli create-node adapter "{
    factory.name=support.null-audio-sink node.name=$DECOY media.class=Audio/Sink
    object.linger=true audio.position=[FL,FR] }" >/dev/null
sleep 1
# The decoy is a machine-global node like any other. Take it away again.
cleanup() {
  id="$("$HARNESS/bin/pwnode.py" "$DECOY" --quiet 2>/dev/null || true)"
  [ -n "$id" ] && pw-cli destroy "$id" >/dev/null 2>&1 || true
}
trap cleanup EXIT

RESULTS_DIR="$mutated" APP_SINK="$DECOY" SPIKE_RUN_ID="m1-$(date -u +%Y%m%dT%H%M%SZ)-$$" \
  "$HERE/run-variant.sh" local nocapture m1 4 none >"$mut/m1-run.log" 2>&1 \
  || { cat "$mut/m1-run.log" >&2; die "the M1 run itself failed"; }
m1="$mutated/local-nocapture-runm1.json"
[ -f "$m1" ] || die "the M1 run produced no record"

echo
echo "--- the mutated record itself ---"
python3 - "$m1" "$DECOY" "$SINK_NAME" <<'PY' || fail=$((fail + 1))
import json, sys
r = json.load(open(sys.argv[1])); decoy, sink = sys.argv[2], sys.argv[3]
p = r.get('provenance') or {}
bad = []
if p.get('appSink') != decoy:
    bad.append(f'the app was routed to {p.get("appSink")!r}, not the decoy {decoy!r} — the mutation did not take')
if p.get('measuredSink') != sink:
    bad.append(f'the meter watched {p.get("measuredSink")!r}, not {sink!r}')
spk = [w['speakerRms'] for w in r['windows']]
if not spk:
    bad.append('the record holds no window')
elif max(spk) > 0.0005:
    bad.append(f'the measured sink still read {max(spk)} — the app was NOT routed away')
for b in bad:
    print(f'  MISS {b}')
if not bad:
    print(f'  ok   app routed to {decoy}, meter on {sink}, measured sink read {max(spk):.9f}')
sys.exit(1 if bad else 0)
PY

cp "$m1" "$fixture/local-nocapture-run1.json"   # the mutated record replaces the control's

echo
echo "--- summary under M1 (expected: nocapture FAIL, a/b/c VOID, exit 1) ---"
set +e
python3 "$HERE/summarise.py" "$fixture" --allow-mixed-runs > "$mut/m1.txt" 2>&1
m1_rc=$?
set -e
sed -n '/^  \(PASS\|FAIL\)/p' "$mut/m1.txt"

[ "$m1_rc" -eq 1 ] || { fail=$((fail + 1)); echo "  MISS exit code is $m1_rc, want 1 (2 would mean VOID — scored nothing, a different red)" >&2; }
want   "$mut/m1.txt" '^  FAIL control local/nocapture'                 'the nocapture control went RED'
want   "$mut/m1.txt" '^  FAIL local/a  VOID — no verdict'              'local/a prints VOID'
want   "$mut/m1.txt" '^  FAIL local/b  VOID — no verdict'              'local/b prints VOID'
want   "$mut/m1.txt" '^  FAIL local/c  VOID — no verdict'              'local/c prints VOID'
want   "$mut/m1.txt" '^  PASS control local/local-echo'                'the local-echo control still PASSES (the mutation is targeted, not general breakage)'
want   "$mut/m1.txt" '^  PASS control local/silent-source'             'the silent control still PASSES'
want   "$mut/m1.txt" '^spike: [0-9]+ passed, 4 failed$'                'exactly 4 rows failed'
reject "$mut/m1.txt" '^  PASS local/(a|b|c) '                          'no a/b/c row was scored PASS'
reject "$mut/m1.txt" '^spike: VOID'                                    'the summary is not VOID-empty'

echo
if [ "$fail" -ne 0 ]; then
  echo "MUTATION NOT ASSERTED: $fail shape check(s) failed. The summary going non-zero" >&2
  echo "is not the point — it has to go red in the documented SHAPE." >&2
  echo "Artefacts: $mut" >&2
  exit 1
fi
echo "M1 asserted RED in the documented shape: 1 mutation caught, 0 missed"
echo "  baseline: $mut/baseline.txt"
echo "  mutated:  $mut/m1.txt"
