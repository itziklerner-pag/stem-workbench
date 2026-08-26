#!/usr/bin/env python3
"""Merge one run's two meters into one record, and score it.

  merge.py TAG PROBE.json SINK1.json [SINK2.json] [--provenance PROV.json]

THE THRESHOLDS, and why they are these numbers:

  SILENCE_CEILING = 0.0005  (-66 dBFS)
      "the speakers are silent". Inherited from the audio harness, where an
      idle isolated null sink measures EXACTLY 0.0 over 4 s and a 440 Hz tone
      at peak 0.5 measures 0.3536. 0.0005 is ~57 dB below that tone and leaves
      room for dither that this sink does not in fact produce.

  CAPTURE_FLOOR = 0.01  (-40 dBFS)
      "the captured stream is non-silent". 20x the silence ceiling, so ONE run
      cannot satisfy both by accident: the two thresholds are 26 dB apart. It
      is also 31 dB below the local fixture's analytic 0.353553, so an AGC
      wobble or a partly-warm window cannot drag a real capture under it, and
      far below any real music passage's RMS over a 4 s window.

PROVENANCE. Every record carries who produced it and when. Without it,
`16 passed, 0 failed` was a property of a DIRECTORY rather than of a run: a
stale committed JSON and a freshly measured one were byte-indistinguishable, so
`summarise.py` happily scored seven youtube.com rows as PASS in a session that
never contacted youtube.com (write-up Limitation 8). `summarise.py` now refuses
to score records from more than one run, which it can only do because of this
block.

A window is scored only if BOTH meters actually looked. rms.py exits non-zero
when the recorder captured nothing, and host.html reports `ok:false` when the
worklet never ran — an empty capture and a silent capture both have RMS 0, and
reporting the first as silence is a measurement that cannot fail.
"""
import json, sys

SILENCE_CEILING = 0.0005
CAPTURE_FLOOR = 0.01


def main(argv):
    prov = None
    if '--provenance' in argv:
        i = argv.index('--provenance')
        prov = json.load(open(argv[i + 1]))
        argv = argv[:i] + argv[i + 2:]
    tag, probe_path = argv[1], argv[2]
    sinks = [json.load(open(p)) for p in argv[3:]]
    p = json.load(open(probe_path))

    rec = {
        'tag': tag,
        'provenance': prov,
        'page': p.get('page'),
        'variant': p.get('variant'),
        'knobs': p.get('knobs'),
        'nav': p.get('nav'),
        'ctxRate': p.get('ctxRate'),
        'seconds': p.get('seconds'),
        'url': p.get('url'),
        'probeOk': bool(p.get('ok')),
        'error': p.get('error'),
        'versions': p.get('versions'),
        'env': p.get('env'),
        'handlerAnsweredWith': p.get('handlerAnsweredWith'),
        'thresholds': {'captureFloor': CAPTURE_FLOOR, 'silenceCeiling': SILENCE_CEILING},
        'player': p.get('player'),
        'playerAfterWindow1': p.get('playerAfterWindow1'),
        'navigation': p.get('navigation'),
        'viewAfterLoad': p.get('viewAfterLoad'),
        'viewBeforeWindow1': p.get('viewBeforeWindow1'),
        'viewAfterWindow1': p.get('viewAfterWindow1'),
        'viewBeforeWindow2': p.get('viewBeforeWindow2'),
        'viewAfterWindow2': p.get('viewAfterWindow2'),
        'trackAtEnd': p.get('trackAtEnd'),
    }
    cap = p.get('capture') or {}
    rec['captureStart'] = cap
    rec['captureSampleRate'] = cap.get('captureSampleRate')
    rec['captureChannelCount'] = cap.get('captureChannelCount')
    rec['contextSampleRate'] = cap.get('contextSampleRate')
    rec['monitorGain'] = cap.get('monitorGain')

    windows = []
    for i, s in enumerate(sinks):
        w = (p.get('windows') or [None] * (i + 1))[i] if i < len(p.get('windows') or []) else None
        w = w or {}
        entry = {
            'n': i + 1,
            'capturedOk': bool(w.get('ok')),
            'capturedReason': None if w.get('ok') else w.get('reason'),
            'capturedRms': round(w['rms'], 9) if w.get('ok') else None,
            'capturedPeak': round(w['peak'], 9) if w.get('ok') else None,
            'capturedSeconds': round(w['seconds'], 3) if w.get('ok') else None,
            'capturedQuanta': w.get('quanta'),
            'capturedChannels': w.get('channels'),
            'capturedSeries': w.get('series'),
            'trackAtWindow': w.get('track'),
            'monitorGainAtWindow': w.get('monitorGain'),
            'speakerRms': round(s['rms'], 9),
            'speakerPeak': round(s['peak'], 9),
            'speakerSeconds': round(s['seconds'], 3),
        }
        # A window's verdict, before the cross-run control check that can VOID it.
        if p.get('knobs', {}).get('capture') is False:
            entry['verdict'] = 'CONTROL'                 # nocapture: only the speaker meter matters
        elif not entry['capturedOk']:
            entry['verdict'] = 'BROKEN'                  # could not look — never 'silent'
        else:
            loud = entry['capturedRms'] >= CAPTURE_FLOOR
            quiet = entry['speakerRms'] <= SILENCE_CEILING
            entry['verdict'] = 'PASS' if (loud and quiet) else 'FAIL'
            entry['why'] = ('captured %.6f %s floor %.4f; speaker %.9f %s ceiling %.4f' % (
                entry['capturedRms'], '>=' if loud else '<', CAPTURE_FLOOR,
                entry['speakerRms'], '<=' if quiet else '>', SILENCE_CEILING))
        windows.append(entry)
    rec['windows'] = windows
    print(json.dumps(rec, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
