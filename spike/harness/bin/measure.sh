#!/usr/bin/env bash
# Record N seconds off the sink's MONITOR and print the RMS of what was there.
#
# Usage: measure.sh SECONDS [OUT.wav] [--json]
#
# Exit 0 = a real measurement was taken (the number on stdout is meaningful).
# Exit 3 = the measurement could NOT be taken (empty or short capture). That is
#          an error, never a silence reading: an empty capture and a silent
#          capture both have RMS 0, so reporting 0 for the first would be a
#          number that cannot fail. (AGENTS.md: an assertion must fail when it
#          cannot look.)
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

[ $# -ge 1 ] || die "usage: measure.sh SECONDS [OUT.wav] [--json]"
secs="$1"; shift
wav="$OUT_DIR/measure.wav"
if [ $# -ge 1 ] && [ "${1#--}" = "$1" ]; then wav="$1"; shift; fi

"$HARNESS_DIR/bin/pwnode.py" "$SINK_NAME" >/dev/null \
  || die "sink '$SINK_NAME' is not present — run bin/sink.sh create"

rm -f "$wav"
# `stream.capture.sink=true` makes pw-record attach to the target's MONITOR
# ports rather than treating the target as a source. pw-record fixes the WAV
# header up when it exits, so SIGINT (not SIGKILL) is what leaves a readable
# file behind.
timeout -s INT "$secs" pw-record \
  --rate "$RATE" --channels "$CHANNELS" --format f32 \
  --target "$SINK_NAME" -P '{ stream.capture.sink=true }' "$wav" || true

# Floor at 60% of the requested window: a capture that stopped early was not
# watching the sink for the time we are about to claim it was.
floor="$(python3 -c "print($secs*0.6)")"
"$HARNESS_DIR/bin/rms.py" "$wav" --min-seconds "$floor" ${1+"$@"}
