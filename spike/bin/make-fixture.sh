#!/usr/bin/env bash
# Generate the local fixture's tone. 60 s so no loop wrap can land inside a
# measurement window.
#
# ffmpeg's `sine` source peaks at 0.125, NOT 1.0, and a mono->stereo `-ac 2`
# costs a further -3.01 dB. Both were measured in the audio harness, so the tone
# is built with an explicit unity `pan` plus an explicit `volume`, and the
# expected RMS is ANALYTIC rather than empirical:
#     stereo sine of peak amplitude A  =>  RMS = A / sqrt(2)
#     A = 0.5  =>  0.353553390593
set -euo pipefail
HZ="${TONE_HZ:-440}"; SECS="${TONE_SECONDS:-60}"; AMP="${TONE_AMPLITUDE:-0.5}"; RATE="${RATE:-48000}"
SPIKE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HARNESS="${AUDIO_HARNESS:-$SPIKE/harness}"
out="$SPIKE/fixture/tone.wav"
gain="$(python3 -c "print($AMP/0.125)")"
ffmpeg -y -v error -f lavfi -i "sine=frequency=${HZ}:duration=${SECS}:sample_rate=${RATE}" \
  -af "pan=stereo|c0=c0|c1=c0,volume=${gain}" -c:a pcm_s16le "$out"
echo "fixture: $out"
"$HARNESS/bin/rms.py" "$out"
echo "expected analytic rms: $(python3 -c "import math;print($AMP/math.sqrt(2))")"
