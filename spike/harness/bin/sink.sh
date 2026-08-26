#!/usr/bin/env bash
# Create / destroy / inspect the isolated virtual sink.
#
# The sink is a PipeWire `support.null-audio-sink` adapter: it has playback
# ports (apps write to it) and monitor ports (we read what they wrote), and it
# is connected to no hardware whatsoever, so nothing an app plays into it can
# reach a speaker. `object.linger=true` keeps the node alive after the pw-cli
# that created it exits.
#
# Usage: sink.sh create|destroy|status|id|env
#
# `create` and `destroy` take the sink lock (env.sh) before touching anything:
# PipeWire nodes are machine-global, so destroying a name another run is using
# would silently ruin its measurement.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

sink_id() { "$HARNESS_DIR/bin/pwnode.py" "$SINK_NAME" --quiet 2>/dev/null || true; }

case "${1:-status}" in
  create)
    harness_lock
    existing="$(sink_id)"
    if [ -n "$existing" ]; then
      echo "harness: destroying existing $SINK_NAME (id $existing)"
      pw-cli destroy "$existing" >/dev/null 2>&1 || true
      sleep 0.5
    fi
    pw-cli create-node adapter "{
        factory.name       = support.null-audio-sink
        node.name          = $SINK_NAME
        node.description   = \"$SINK_DESC\"
        media.class        = Audio/Sink
        object.linger      = true
        audio.position     = [FL,FR]
        audio.rate         = $RATE
        monitor.channel-volumes = false
      }" >/dev/null
    sleep 1
    id="$(sink_id)"
    [ -n "$id" ] || die "sink $SINK_NAME was not created"
    # A sink with no monitor ports cannot be measured; refuse to report success.
    pw-link -o 2>/dev/null | grep -q "^${SINK_NAME}:monitor_" \
      || die "sink $SINK_NAME has no monitor ports — nothing to measure"
    echo "harness: $SINK_NAME up, node id $id, monitor ports present"
    ;;
  destroy)
    harness_lock
    id="$(sink_id)"
    [ -n "$id" ] || { echo "harness: $SINK_NAME not present"; exit 0; }
    pw-cli destroy "$id" >/dev/null
    echo "harness: destroyed $SINK_NAME (id $id)"
    ;;
  id)
    id="$(sink_id)"; [ -n "$id" ] || die "sink $SINK_NAME not present"; echo "$id"
    ;;
  env)
    # Point a child process's audio output at the sink and nothing else.
    echo "PULSE_SINK=$SINK_NAME"
    echo "PIPEWIRE_NODE=$SINK_NAME"
    ;;
  status)
    id="$(sink_id)"
    if [ -z "$id" ]; then echo "harness: $SINK_NAME ABSENT"; exit 1; fi
    echo "harness: $SINK_NAME present, node id $id"
    echo "-- playback ports (apps write here) --"; pw-link -i 2>/dev/null | grep "^${SINK_NAME}:" || true
    echo "-- monitor ports (we read here) --";     pw-link -o 2>/dev/null | grep "^${SINK_NAME}:" || true
    ;;
  *) die "usage: sink.sh create|destroy|status|id|env" ;;
esac
