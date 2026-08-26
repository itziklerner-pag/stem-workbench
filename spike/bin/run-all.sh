#!/usr/bin/env bash
# The whole matrix. Serial on purpose: every run writes into the SAME isolated
# sink, so two runs at once would each measure the other's audio.
#
# Usage: run-all.sh [local|youtube|both] [SECONDS] [RUNS]
#
# Every record produced here carries ONE run id, so the summary at the end is a
# property of THIS run and not of whatever JSON happens to be in the directory
# (write-up Limitation 8). Set RESULTS_DIR to score somewhere other than
# spike/results and leave the committed evidence alone.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPIKE="$(cd "$HERE/.." && pwd)"
WHICH="${1:-both}"; SECS="${2:-4}"; RUNS="${3:-3}"
HARNESS="${AUDIO_HARNESS:-$SPIKE/harness}"
export AUDIO_HARNESS="$HARNESS"
RESULTS="${RESULTS_DIR:-$SPIKE/results}"
export RESULTS_DIR="$RESULTS"
export SPIKE_RUN_ID="${SPIKE_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$-$RANDOM}"

echo "run id: $SPIKE_RUN_ID  ->  $RESULTS"
"$HARNESS/bin/sink.sh" create
"$HERE/make-fixture.sh" >/dev/null

run() { echo "--- $*" >&2; "$HERE/run-variant.sh" "$@" >/dev/null || echo "RUN FAILED: $*" >&2; }

# The order matters only in that the controls come FIRST: if the speaker meter
# cannot hear the app (nocapture) or cannot hear it DURING a capture (d), every
# silence reading below is vacuous and the run should be abandoned, not scored.
for page in local youtube; do
  [ "$WHICH" = both ] || [ "$WHICH" = "$page" ] || continue
  for r in $(seq 1 "$RUNS"); do run "$page" nocapture "$r" "$SECS" none; done
  for r in $(seq 1 "$RUNS"); do run "$page" d "$r" "$SECS" none; done
  for v in a b c; do
    for r in $(seq 1 "$RUNS"); do run "$page" "$v" "$r" "$SECS" none; done
  done
  [ "$page" = local ] && for r in 1 2; do run local silent "$r" "$SECS" none; done
  run "$page" b 1 "$SECS" reload
  [ "$page" = youtube ] && run youtube b 1 "$SECS" spa
done

# A partial matrix (run-all.sh local) leaves the other page's records behind
# from an older run, and summarise.py will now refuse to mix the two rather
# than printing youtube rows nobody measured.
python3 "$HERE/summarise.py" "$RESULTS"
