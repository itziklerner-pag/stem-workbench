#!/usr/bin/env python3
"""List every node currently linked into a sink's PLAYBACK ports — i.e. every
process that can put audio into the sink we are about to call silent.

  pwlinks.py SINK_NAME [--pid PID[,PID...]] [--json]

Why this exists. A PipeWire sink is machine-global and any process may link to
it. `spike/bin/run-variant.sh` takes a lock, but a lock only binds runs that
cooperate; it cannot stop an unrelated Electron from writing into the same sink.
The write-up's Limitation 10 names that gap, and the permanent gate's assertion
8 ("no node other than this pid's is linked to the measured sink during the
window") needs this reading to exist at all.

--pid takes the whole process tree under test (Chromium puts audio output in
its own utility process, so the app is never one pid). With it, exit status
carries a verdict:
  0  the only writers are those pids (or nobody is linked at all)
  4  a FOREIGN writer is linked — the run's silence reading is contaminated
Without --pid it always exits 0 and just reports.

It reports, never guesses: a node whose props carry no pid is reported with
pid null and counts as foreign, because "we could not tell" is not "ours".
"""
import json, subprocess, sys


def dump():
    out = subprocess.run(['pw-dump'], capture_output=True, timeout=30).stdout
    return json.loads(out or b'[]')


def collect(objs, sink_name):
    nodes, links, sink_id = {}, [], None
    for o in objs:
        t = o.get('type')
        if t == 'PipeWire:Interface:Node':
            props = o.get('info', {}).get('props', {}) or {}
            nodes[o['id']] = {
                'id': o['id'],
                'name': props.get('node.name'),
                'description': props.get('node.description'),
                'mediaClass': props.get('media.class'),
                'pid': props.get('application.process.id'),
                'app': props.get('application.name'),
                'binary': props.get('application.process.binary'),
                'target': props.get('target.object'),
                'state': o.get('info', {}).get('state'),
            }
            if props.get('node.name') == sink_name:
                sink_id = o['id']
        elif t == 'PipeWire:Interface:Link':
            info = o.get('info', {}) or {}
            links.append({
                'output_node': info.get('output-node-id'),
                'input_node': info.get('input-node-id'),
                'state': info.get('state'),
            })
    return nodes, links, sink_id


def writers(sink_name):
    objs = dump()
    nodes, links, sink_id = collect(objs, sink_name)
    if sink_id is None:
        return None, None, []
    seen, out = set(), []
    for l in links:
        if l['input_node'] != sink_id:
            continue
        n = nodes.get(l['output_node'])
        if n is None or n['id'] in seen:
            continue
        seen.add(n['id'])
        out.append(dict(n, linkState=l['state']))
    return sink_id, nodes.get(sink_id), out


def main(argv):
    if len(argv) < 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    sink_name = argv[1]
    want_pids = None
    if '--pid' in argv:
        want_pids = {int(x) for x in argv[argv.index('--pid') + 1].split(',') if x.strip()}
    as_json = '--json' in argv

    sink_id, sink, ws = writers(sink_name)
    if sink_id is None:
        msg = f'no PipeWire sink named {sink_name!r}'
        if as_json:
            print(json.dumps({'sink': sink_name, 'present': False, 'error': msg}))
        else:
            print(msg, file=sys.stderr)
        return 3

    foreign = [w for w in ws if want_pids is not None and w['pid'] not in want_pids]
    rec = {
        'sink': sink_name,
        'present': True,
        'sinkNodeId': sink_id,
        'sinkState': (sink or {}).get('state'),
        'expectPids': sorted(want_pids) if want_pids is not None else None,
        'writers': ws,
        'foreignWriters': [
            {'id': w['id'], 'name': w['name'], 'pid': w['pid'], 'app': w['app']} for w in foreign
        ],
        'exclusive': (None if want_pids is None else not foreign),
    }
    if as_json:
        print(json.dumps(rec))
    else:
        print(f'sink {sink_name} (node {sink_id}, state {rec["sinkState"]}) '
              f'has {len(ws)} writer(s)')
        for w in ws:
            mark = '  ' if want_pids is None or w['pid'] in want_pids else 'FOREIGN '
            print(f'  {mark}node {w["id"]} {w["name"]!r} pid={w["pid"]} '
                  f'app={w["app"]!r} target={w["target"]!r} link={w["linkState"]}')
    if foreign:
        print(f'CONTAMINATED: {len(foreign)} node(s) outside pids '
              f'{sorted(want_pids)} are linked to {sink_name}', file=sys.stderr)
        return 4
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv))
    except Exception as e:
        print(f'pwlinks FAILED: {e}', file=sys.stderr)
        sys.exit(3)
