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
# (M2 is not scripted: it happened for real. The `silent` negative control read
#  0.350295 instead of 0 on its first run, because spike/fixture/player.html
#  autoplayed regardless of the flag. The control caught a defect in the
#  instrument, which is the whole reason it exists.)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPIKE="$(cd "$HERE/.." && pwd)"
HARNESS="${AUDIO_HARNESS:-/tmp/claude-1000/-home-claudia-dev-claudia-stem-stem-splitter-live/8ad91f84-871f-4e69-be73-c4704b074b63/scratchpad/audio-harness}"
DECOY=harness_decoy
mut="$SPIKE/mutations"; mkdir -p "$mut"

"$HARNESS/bin/pwnode.py" "$DECOY" >/dev/null 2>&1 || pw-cli create-node adapter "{
    factory.name=support.null-audio-sink node.name=$DECOY media.class=Audio/Sink
    object.linger=true audio.position=[FL,FR] }" >/dev/null
sleep 1

echo "M1: app routed to $DECOY, meter still on harness_sink"
APP_SINK="$DECOY" "$HERE/run-variant.sh" local nocapture m1 4 none >/dev/null
mv "$SPIKE/results/local-nocapture-runm1.json" "$mut/local-nocapture-runm1.json"
rm -f "$SPIKE/results/local-nocapture-runm1."* "$SPIKE/results/.local-nocapture-runm1.ready"

tmp="$(mktemp -d)"
cp "$SPIKE/results/local-"{a,b,c,d,silent}-run[123].json "$tmp/" 2>/dev/null || true
cp "$mut/local-nocapture-runm1.json" "$tmp/local-nocapture-run1.json"
echo "--- summary under M1 (expected: VOID rows, non-zero exit) ---"
if python3 "$HERE/summarise.py" "$tmp"; then
  echo "MUTATION NOT CAUGHT: the summary went green with the app routed away from the meter" >&2
  rm -rf "$tmp"; exit 1
fi
rm -rf "$tmp"
echo "M1 asserted RED: 1 mutation caught, 0 missed"
