# Common settings, sourced by every harness script.
#
# VENDORED. This tree used to live only in a session scratchpad under /tmp while
# spike/bin/run-variant.sh hardcoded that path as its default (write-up
# Limitation 7). It is here so the committed evidence can be re-derived from
# this repository alone.
_env_self="${BASH_SOURCE[0]:-${(%):-%x}}"
HARNESS_DIR="${HARNESS_DIR:-$(cd "$(dirname "$_env_self")/.." && pwd)}"

# The measured sink. NOT `harness_sink`: that name is the machine's default sink
# for this user session and is shared with anything else on the box, which is
# exactly the contamination the write-up's Limitation 10 names. This one belongs
# to this repository, and bin/sink.sh will not create it without holding the
# lock below.
SINK_NAME="${SINK_NAME:-stem_workbench_spike}"
SINK_DESC="${SINK_DESC:-stem-workbench spike sink}"
RATE="${RATE:-48000}"
CHANNELS="${CHANNELS:-2}"
OUT_DIR="${OUT_DIR:-$HARNESS_DIR/out}"
APP_DIR="${APP_DIR:-$HARNESS_DIR/app}"

# PipeWire sinks are machine-global and any process may link to any of them, so
# "exclusive" can only mean: cooperating runs serialise, and a run records who
# else was linked while it measured. This is the lock half; bin/pwlinks.py is
# the record half. Neither can stop a non-cooperating process from writing into
# the sink — see the harness README.
SINK_LOCK="${SINK_LOCK:-${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/stem-workbench-sink-$SINK_NAME.lock}"
SINK_LOCK_WAIT="${SINK_LOCK_WAIT:-900}"

# Which sink the APP is pointed at, as opposed to which sink we MEASURE. They
# are the same thing in every real run, and are separately settable for exactly
# one reason: it is the only way to check that the speaker-side control can
# lose. Point the app somewhere else and the "speaker meter can see this app"
# control must go red. See spike/bin/mutations.sh.
APP_SINK="${APP_SINK:-$SINK_NAME}"
mkdir -p "$OUT_DIR"

# The tone the harness plays as its positive control.
#  - ffmpeg's `sine` source peaks at 0.125, NOT 1.0.
#  - mono->stereo via `-ac 2`/`aformat` costs a further -3.01 dB (1/sqrt2).
# Both were measured here, so the tone is built with an explicit `pan` (unity,
# no rematrix) and an explicit `volume`, and the expected RMS is analytic:
#   stereo sine of amplitude A  =>  RMS = A / sqrt(2)
TONE_HZ="${TONE_HZ:-440}"
TONE_AMPLITUDE="${TONE_AMPLITUDE:-0.5}"          # peak, full scale = 1.0
TONE_VOLUME_GAIN="$(python3 -c "print($TONE_AMPLITUDE/0.125)")"
TONE_EXPECTED_RMS="$(python3 -c "import math;print($TONE_AMPLITUDE/math.sqrt(2))")"

die() { echo "harness: $*" >&2; exit 1; }

# Take the sink lock on fd 9 for the rest of the calling shell's life. Callers
# that already hold it set SINK_LOCK_HELD=1 so a nested script does not
# deadlock on itself.
harness_lock() {
  [ "${SINK_LOCK_HELD:-0}" = 1 ] && return 0
  command -v flock >/dev/null 2>&1 || die "flock not found — cannot take the sink lock"
  exec 9>"$SINK_LOCK" || die "cannot open lock file $SINK_LOCK"
  flock -w "$SINK_LOCK_WAIT" 9 \
    || die "another run has held $SINK_NAME for ${SINK_LOCK_WAIT}s — refusing to measure a sink someone else is using"
  export SINK_LOCK_HELD=1
}
