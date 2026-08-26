#!/usr/bin/env bash
# ONE run of ONE variant, with BOTH meters watching the SAME seconds.
#
#   capture side  — the RMS of the getDisplayMedia MediaStream, measured inside
#                   the renderer (spike/host.html)
#   speaker side  — the RMS of what the app wrote to its output device, measured
#                   OUTSIDE the app off the monitor of an isolated PipeWire null
#                   sink that is wired to no hardware (spike/harness/bin)
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
#
# Environment:
#   AUDIO_HARNESS  the external meter. Defaults to spike/harness IN THIS REPO.
#   RESULTS_DIR    where the run record lands. Defaults to spike/results.
#                  Point it elsewhere to re-run without overwriting the
#                  committed evidence (write-up Limitation 8).
#   SPIKE_RUN_ID   stamped into the record. run-all.sh sets one for the whole
#                  matrix; a standalone run gets its own.
#   SINK_NAME      the measured sink. APP_SINK is settable separately ONLY so
#                  the speaker-side control can be watched losing (mutations.sh).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPIKE="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$SPIKE/.." && pwd)"
HARNESS="${AUDIO_HARNESS:-$SPIKE/harness}"

die() { echo "spike: $*" >&2; exit 1; }
[ -d "$HARNESS/bin" ] || die "audio harness not found at $HARNESS — set AUDIO_HARNESS"
[ -x "$REPO/node_modules/.bin/electron" ] || die "electron missing — npm i -D electron"
[ -f "$SPIKE/fixture/tone.wav" ] || die "fixture tone missing — run spike/bin/make-fixture.sh"

# env.sh brings SINK_NAME, APP_SINK, SINK_LOCK and harness_lock, so this script
# and the meter it calls cannot disagree about which sink is being measured.
# shellcheck source=../harness/bin/env.sh
source "$HARNESS/bin/env.sh"
die() { echo "spike: $*" >&2; exit 1; }
SINK="$SINK_NAME"

# PipeWire sinks are machine-global. Hold the lock for the whole run: two runs
# measuring one sink at once each measure the other (write-up Limitation 10).
harness_lock

PAGE="${1:-local}"; VARIANT="${2:-a}"; RUN="${3:-1}"; SECS="${4:-4}"; NAV="${5:-none}"
tag="$PAGE-$VARIANT${NAV:+$([ "$NAV" = none ] || echo "-$NAV")}-run$RUN"
out="${RESULTS_DIR:-$SPIKE/results}"; mkdir -p "$out"
RUN_ID="${SPIKE_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$-$RANDOM}"
ready="$out/.$tag.ready"; probe="$out/$tag.probe.json"; merged="$out/$tag.json"

# A re-run used to overwrite a committed record in place with no signal at all
# (write-up Limitation 8: one review run rewrote local-b-run1.json from 0.350677
# to 0.350522 unnoticed). It still overwrites — but never quietly.
if [ -f "$merged" ]; then
  python3 - "$merged" "$RUN_ID" <<'PY' >&2
import json, sys, os, time
path, run_id = sys.argv[1], sys.argv[2]
try:
    prov = (json.load(open(path)) or {}).get('provenance') or {}
except Exception:
    prov = {}
old = prov.get('runId') or '(unstamped — produced before provenance stamping)'
when = prov.get('producedAt') or time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(os.path.getmtime(path)))
if old != run_id:
    print(f'spike: OVERWRITING {path}')
    print(f'spike:   was run {old}, produced {when}')
    print(f'spike:   now run {run_id}. The previous numbers are gone; git has them.')
PY
fi

rm -f "$ready" "$ready.2" "$probe" "$merged" "$out/$tag.sink"*.json \
      "$out/$tag.links"*.json "$out/$tag.prov.json"

"$HARNESS/bin/sink.sh" id >/dev/null 2>&1 || "$HARNESS/bin/sink.sh" create >/dev/null

# PULSE_SINK/PIPEWIRE_NODE send the app's output to the isolated sink and
# nowhere else. On a machine WITH speakers this is what keeps the audio away
# from them; review re-ran variant (b) with BOTH unset and measured the system
# default device instead, so forced routing is not in the causal chain.
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

# Chromium runs audio output in its own utility process, so "the app" is a tree
# of pids, not one. Collected once the window is open, when the tree is settled.
tree_pids() {
  local seen="$1" kids
  echo "$seen"
  kids="$(ps -o pid= --ppid "$seen" 2>/dev/null || true)"
  for k in $kids; do tree_pids "$k"; done
}

# Sample WHO ELSE is linked to the measured sink, from inside the window. A
# foreign writer does not abort the run — it is recorded, warned about, and is
# what the permanent gate's assertion 8 will assert on.
witness() {   # $1 = out path
  local pids
  pids="$(tree_pids "$pid" | tr '\n' ',' | sed 's/,$//')"
  ( sleep "$(python3 -c "print(max(0.5, $SECS/2.0))")"
    "$HARNESS/bin/pwlinks.py" "$SINK" --pid "$pids" --json > "$1" 2>>"$out/$tag.links.err" || true
  ) &
}

if ! wait_ready "$ready" 1500; then
  kill "$pid" 2>/dev/null || true
  die "$tag: the app never opened window 1 — see $out/$tag.electron.log"
fi
witness "$out/$tag.links1.json"; wpid=$!
"$HARNESS/bin/measure.sh" "$SECS" "$out/$tag.sink1.wav" --json > "$out/$tag.sink1.json"
wait "$wpid" 2>/dev/null || true

if [ "$NAV" != "none" ]; then
  if ! wait_ready "$ready.2" 1500; then
    kill "$pid" 2>/dev/null || true
    die "$tag: the app never opened window 2 — see $out/$tag.electron.log"
  fi
  witness "$out/$tag.links2.json"; wpid=$!
  "$HARNESS/bin/measure.sh" "$SECS" "$out/$tag.sink2.wav" --json > "$out/$tag.sink2.json"
  wait "$wpid" 2>/dev/null || true
fi

wait "$pid" || true
[ -f "$probe" ] || die "$tag: the app wrote no result — see $out/$tag.electron.log"

# Provenance. "16 passed, 0 failed" used to be a property of a DIRECTORY: a
# record carried no run id, no commit and no timestamp, so a stale committed
# JSON and a fresh one were indistinguishable and summarise.py scored both
# (write-up Limitation 8). Every record now says which run made it.
RUN_ID="$RUN_ID" TAG="$tag" SINK="$SINK" APP_SINK="$APP_SINK" \
HARNESS_DIR="$HARNESS" RESULTS="$out" REPO="$REPO" \
python3 - > "$out/$tag.prov.json" <<'PY'
import json, os, subprocess, time, socket, glob

def git(*a):
    try:
        return subprocess.run(['git', '-C', os.environ['REPO'], *a],
                              capture_output=True, text=True, timeout=15).stdout.strip() or None
    except Exception:
        return None

def rel(p):
    """Repo-relative when inside the repo, absolute when not — never ../../../.."""
    try:
        r = os.path.relpath(p, os.environ['REPO'])
        return p if r.startswith('..') else r
    except Exception:
        return p

witnesses = []
for p in sorted(glob.glob(os.path.join(os.environ['RESULTS'], os.environ['TAG'] + '.links*.json'))):
    try:
        witnesses.append(json.load(open(p)))
    except Exception as e:
        witnesses.append({'error': f'{p}: {e}'})

foreign = [w for wit in witnesses for w in (wit.get('foreignWriters') or [])]
exclusive = None
if witnesses and all(w.get('exclusive') is not None for w in witnesses):
    exclusive = all(w['exclusive'] for w in witnesses)

print(json.dumps({
    'runId': os.environ['RUN_ID'],
    'producedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    'producedBy': 'spike/bin/run-variant.sh',
    'commit': git('rev-parse', 'HEAD'),
    'commitDirty': bool(git('status', '--porcelain')),
    'host': socket.gethostname(),
    'measuredSink': os.environ['SINK'],
    'appSink': os.environ['APP_SINK'],
    'harnessDir': rel(os.environ['HARNESS_DIR']),
    'resultsDir': rel(os.environ['RESULTS']),
    'sinkExclusive': exclusive,
    'foreignWriters': foreign,
    'sinkWitness': witnesses,
}, indent=2))
PY

if python3 -c "import json,sys; sys.exit(0 if json.load(open(sys.argv[1]))['foreignWriters'] else 1)" \
     "$out/$tag.prov.json"; then
  echo "spike: WARNING $tag — another process was writing into $SINK during the window;" >&2
  echo "spike:          this run's speaker reading is contaminated. See $out/$tag.prov.json" >&2
fi

python3 "$HERE/merge.py" "$tag" "$probe" "$out/$tag.sink1.json" \
  $([ "$NAV" != none ] && echo "$out/$tag.sink2.json" || true) \
  --provenance "$out/$tag.prov.json" > "$merged"
cat "$merged"
