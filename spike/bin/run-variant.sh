#!/usr/bin/env bash
# ONE run of ONE variant, with BOTH meters watching the SAME seconds.
#
#   capture side  — the RMS of the getDisplayMedia MediaStream, measured inside
#                   the renderer (spike/host.html)
#   speaker side  — the RMS of what the app wrote to its output device, measured
#                   OUTSIDE the app off the monitor of an isolated PipeWire null
#                   sink that is wired to no hardware (audio-harness/bin)
#
# The app touches a ready-file at the instant its own window opens and the
# external recorder starts THEN, so the two windows overlap instead of being
# lined up with a guessed sleep.
#
# Usage: run-variant.sh PAGE VARIANT RUN [SECONDS] [NAV]
#   PAGE     local | youtube
#   VARIANT  a | b | c | d | nocapture | silent      (see spike/main.js)
#   RUN      run number, used only to name the result file
#   NAV      none | spa | reload    (adds a SECOND window after navigating)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPIKE="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$SPIKE/.." && pwd)"
HARNESS="${AUDIO_HARNESS:-/tmp/claude-1000/-home-claudia-dev-claudia-stem-stem-splitter-live/8ad91f84-871f-4e69-be73-c4704b074b63/scratchpad/audio-harness}"
SINK="${SINK_NAME:-harness_sink}"
APP_SINK="${APP_SINK:-$SINK}"          # settable ONLY so the control can lose

die() { echo "spike: $*" >&2; exit 1; }
[ -d "$HARNESS/bin" ] || die "audio harness not found at $HARNESS — set AUDIO_HARNESS"
[ -x "$REPO/node_modules/.bin/electron" ] || die "electron missing — npm i -D electron"
[ -f "$SPIKE/fixture/tone.wav" ] || die "fixture tone missing — run spike/bin/make-fixture.sh"

PAGE="${1:-local}"; VARIANT="${2:-a}"; RUN="${3:-1}"; SECS="${4:-4}"; NAV="${5:-none}"
tag="$PAGE-$VARIANT${NAV:+$([ "$NAV" = none ] || echo "-$NAV")}-run$RUN"
out="$SPIKE/results"; mkdir -p "$out"
ready="$out/.$tag.ready"; probe="$out/$tag.probe.json"; merged="$out/$tag.json"
rm -f "$ready" "$ready.2" "$probe" "$merged" "$out/$tag.sink"*.json

"$HARNESS/bin/sink.sh" id >/dev/null 2>&1 || "$HARNESS/bin/sink.sh" create >/dev/null

# PULSE_SINK/PIPEWIRE_NODE send the app's output to the isolated sink and
# nowhere else. On a machine WITH speakers this is what keeps the audio away
# from them; audio-harness/bin/prove-routing.sh is what proves it is load-bearing.
xvfb-run -a -s "-screen 0 1280x1024x24" \
  env PULSE_SINK="$APP_SINK" PIPEWIRE_NODE="$APP_SINK" \
  "$REPO/node_modules/.bin/electron" --no-sandbox "$SPIKE/main.js" \
    --page="$PAGE" --variant="$VARIANT" --seconds="$SECS" --nav="$NAV" --ctx-rate="${CTX_RATE:-0}" \
    --ready-file="$ready" --out="$probe" >"$out/$tag.electron.log" 2>&1 &
pid=$!

wait_ready() {   # $1 = path, $2 = timeout in tenths
  for _ in $(seq 1 "$2"); do
    [ -f "$1" ] && return 0
    kill -0 "$pid" 2>/dev/null || return 1
    sleep 0.1
  done
  return 1
}

if ! wait_ready "$ready" 1500; then
  kill "$pid" 2>/dev/null || true
  die "$tag: the app never opened window 1 — see $out/$tag.electron.log"
fi
"$HARNESS/bin/measure.sh" "$SECS" "$out/$tag.sink1.wav" --json > "$out/$tag.sink1.json"

if [ "$NAV" != "none" ]; then
  if ! wait_ready "$ready.2" 1500; then
    kill "$pid" 2>/dev/null || true
    die "$tag: the app never opened window 2 — see $out/$tag.electron.log"
  fi
  "$HARNESS/bin/measure.sh" "$SECS" "$out/$tag.sink2.wav" --json > "$out/$tag.sink2.json"
fi

wait "$pid" || true
[ -f "$probe" ] || die "$tag: the app wrote no result — see $out/$tag.electron.log"

python3 "$HERE/merge.py" "$tag" "$probe" "$out/$tag.sink1.json" \
  $([ "$NAV" != none ] && echo "$out/$tag.sink2.json" || true) > "$merged"
cat "$merged"
