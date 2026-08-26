#!/usr/bin/env python3
"""Aggregate spike/results/*.json into the variant table, and apply the VOID rule.

  summarise.py RESULTS_DIR

THE VOID RULE (audio-harness/README.md, tools/verify.mjs:421-425 one level down):
a "the speakers were silent" result is a finding only if the speaker meter has
been shown able to hear this app. Two controls per page must hold:

  nocapture  the view plays, getDisplayMedia is NEVER called -> speakerRms HIGH.
             Without it, "silent speakers" is indistinguishable from "the app was
             never connected to the sink at all".
  d          enableLocalEcho:true, view NOT muted, capture RUNNING -> speakerRms
             HIGH. Electron documents enableLocalEcho as "local playback will not
             be muted", so this is the control that can LOSE: it proves the meter
             still hears the view DURING an active capture, which nocapture alone
             does not.

If either control fails for a page, that page's a/b/c rows print VOID and carry
no verdict.

Prints one `PASS`/`FAIL`/`VOID` line per row and a `N passed, M failed` summary,
so it can be wired as a verify.mjs step later (BRIEF.md 6.3).
"""
import json, glob, os, sys, statistics

CAPTURE_FLOOR = 0.01
SILENCE_CEILING = 0.0005


def load(d):
    out = []
    for p in sorted(glob.glob(os.path.join(d, '*.json'))):
        if p.endswith('.probe.json') or p.endswith('.sink1.json') or p.endswith('.sink2.json'):
            continue
        try:
            out.append(json.load(open(p)))
        except Exception as e:
            print(f'  FAIL unreadable result  {p}: {e}')
    return out


def fmt(v):
    return '—' if v is None else f'{v:.6f}'


def main(argv):
    d = argv[1] if len(argv) > 1 else 'spike/results'
    recs = [r for r in load(d) if not r['tag'].endswith('run0')]  # run0 = smoke runs
    # The `run44k1` runs force the measuring AudioContext to 44 100 Hz. They are
    # scored on their own row rather than folded into a/b/c, so the a/b/c ranges
    # describe ONE configuration and not a mixture of two.
    rate_runs = [r for r in recs if r['tag'].endswith('run44k1')]
    recs = [r for r in recs if not r['tag'].endswith('run44k1')]
    passed = failed = 0
    lines = []
    for page in ('local', 'youtube'):
        rows = [r for r in recs if r['page'] == page]
        if not rows:
            continue
        ctrl_nc = [r for r in rows if r['variant'] == 'nocapture']
        ctrl_d = [r for r in rows if r['variant'] == 'd']
        nc_ok = bool(ctrl_nc) and all(w['speakerRms'] >= CAPTURE_FLOOR
                                      for r in ctrl_nc for w in r['windows'])
        d_ok = bool(ctrl_d) and all(w['speakerRms'] >= CAPTURE_FLOOR and (w['capturedRms'] or 0) >= CAPTURE_FLOOR
                                    for r in ctrl_d for w in r['windows'])
        for name, ok, why in (('nocapture', nc_ok, 'speaker meter can hear this app'),
                              ('local-echo', d_ok, 'speaker meter can hear the view DURING a capture')):
            tag = 'PASS' if ok else 'FAIL'
            lines.append(f'  {tag} control {page}/{name}  {why}')
            passed, failed = (passed + 1, failed) if ok else (passed, failed + 1)
        controls_hold = nc_ok and d_ok

        for variant in ('a', 'b', 'c'):
            vs = [r for r in rows if r['variant'] == variant and r['nav'] == 'none']
            if not vs:
                continue
            cap = [w['capturedRms'] for r in vs for w in r['windows'] if w['capturedOk']]
            spk = [w['speakerRms'] for r in vs for w in r['windows']]
            broken = [w['capturedReason'] for r in vs for w in r['windows'] if not w['capturedOk']]
            n = len(vs)
            if not controls_hold:
                lines.append(f'  FAIL {page}/{variant}  VOID — no verdict, the controls did not hold')
                failed += 1
                continue
            if broken:
                lines.append(f'  FAIL {page}/{variant}  BROKEN measurement: {broken[0]}')
                failed += 1
                continue
            ok = min(cap) >= CAPTURE_FLOOR and max(spk) <= SILENCE_CEILING
            tag = 'PASS' if ok else 'FAIL'
            lines.append(f'  {tag} {page}/{variant}  runs={n} capturedRms=[{fmt(min(cap))}..{fmt(max(cap))}] '
                         f'speakerRms=[{fmt(min(spk))}..{fmt(max(spk))}] '
                         f'muted={sorted({r["viewBeforeWindow1"]["isAudioMuted"] for r in vs})} '
                         f'audible={sorted({r["viewBeforeWindow1"]["isCurrentlyAudible"] for r in vs})}')
            passed, failed = (passed + 1, failed) if ok else (passed, failed + 1)

        # Negative control: the capture meter must be able to read zero.
        sil = [r for r in rows if r['variant'] == 'silent']
        if sil:
            vals = [w['capturedRms'] for r in sil for w in r['windows'] if w['capturedOk']]
            ok = bool(vals) and max(vals) <= SILENCE_CEILING
            lines.append(f'  {"PASS" if ok else "FAIL"} control {page}/silent-source  '
                         f'capturedRms=[{fmt(min(vals)) if vals else "—"}..{fmt(max(vals)) if vals else "—"}] '
                         f'(the capture meter is not stuck high)')
            passed, failed = (passed + 1, failed) if ok else (passed, failed + 1)

        # The capture path at the model's native rate, with no resampler anywhere.
        for r in [x for x in rate_runs if x['page'] == page]:
            w = r['windows'][0]
            ok = (w['capturedOk'] and w['capturedRms'] >= CAPTURE_FLOOR
                  and w['speakerRms'] <= SILENCE_CEILING
                  and r['contextSampleRate'] == 44100 and r['captureSampleRate'] == 44100)
            lines.append(f'  {"PASS" if ok else "FAIL"} {page}/native-44100  '
                         f'trackSampleRate={r["captureSampleRate"]} ctxSampleRate={r["contextSampleRate"]} '
                         f'capturedRms={fmt(w["capturedRms"])} speakerRms={fmt(w["speakerRms"])}')
            passed, failed = (passed + 1, failed) if ok else (passed, failed + 1)

        # Navigation survival: window 2 is measured AFTER the source navigates.
        for nav in ('reload', 'spa'):
            navs = [r for r in rows if r['nav'] == nav]
            for r in navs:
                if len(r['windows']) < 2:
                    lines.append(f'  FAIL {page}/{nav}  only {len(r["windows"])} window(s) — the second never opened')
                    failed += 1
                    continue
                w1, w2 = r['windows'][0], r['windows'][1]
                ok = (w2['capturedOk'] and w2['capturedRms'] >= CAPTURE_FLOOR
                      and w2['speakerRms'] <= SILENCE_CEILING)
                lines.append(f'  {"PASS" if ok else "FAIL"} {page}/{nav}-survival  '
                             f'before={fmt(w1["capturedRms"])} after={fmt(w2["capturedRms"])} '
                             f'speakerAfter={fmt(w2["speakerRms"])} '
                             f'track={(w2.get("trackAtWindow") or {}).get("readyState")} '
                             f'url={(r.get("navigation") or {}).get("urlAfter","?")[:70]}')
                passed, failed = (passed + 1, failed) if ok else (passed, failed + 1)

    print('\n'.join(lines))
    # The VOID rule applied to the scorer itself (BRIEF.md 6.3 rule 3,
    # tools/verify.mjs:421-425): `0 passed, 0 failed` does not match ASSERTED and
    # a suite whose inputs excluded everything is VOID, not green. Watched going
    # red: before this guard, `summarise.py <empty dir>` printed
    # `spike: 0 passed, 0 failed` and exited 0 — a wrong RESULTS_DIR, or a glob
    # that matched nothing, read as a pass.
    if passed + failed == 0:
        print(f'\nspike: VOID — scored nothing in {d!r}; silence is not a pass')
        return 2
    print(f'\nspike: {passed} passed, {failed} failed')
    return 0 if failed == 0 else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv))
