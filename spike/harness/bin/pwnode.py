#!/usr/bin/env python3
"""Look a PipeWire node up by node.name. Prints its id, or exits 1 if absent.

`pw-dump | grep` is not reliable (the JSON's whitespace is not a contract), so
every script goes through here instead.

Usage: pwnode.py NAME [--quiet]
"""
import json, subprocess, sys

def node_id(name):
    out = subprocess.run(['pw-dump'], capture_output=True, timeout=30).stdout
    for o in json.loads(out or b'[]'):
        if o.get('type') == 'PipeWire:Interface:Node':
            if o.get('info', {}).get('props', {}).get('node.name') == name:
                return o['id']
    return None

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__.strip(), file=sys.stderr); sys.exit(2)
    i = node_id(sys.argv[1])
    if i is None:
        if '--quiet' not in sys.argv:
            print(f'no PipeWire node named {sys.argv[1]!r}', file=sys.stderr)
        sys.exit(1)
    print(i)
