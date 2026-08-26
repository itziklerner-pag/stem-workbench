#!/usr/bin/env python3
"""
Did every assertion in `shell.mjs` go red at least once?

"28 mutations were caught" is not the claim worth making. THE claim is that no
assertion has gone unbroken: one that no mutation has ever turned red is an
assumption wearing an `ok`, and it is invisible from inside a green run. This is
the cheap half of the coverage-drift instrument `tools/verify.mjs` documents as
deliberately not copied yet — it needs no baseline file, because the baseline is
one of the logs.

Called by `shell-mutations.sh` after a FULL battery. A subset cannot make the
claim, so it is not run for one.
"""
import glob
import os
import re
import sys

OUT = sys.argv[1]
G, R, X = "\033[32m", "\033[31m", "\033[0m"


def names(path):
    """`ok  <name>  <detail>` / `FAIL  <name>  <detail>` — docs/TESTING.md §3."""
    rows = []
    for line in open(path, errors="replace"):
        m = re.match(r"^(ok  |FAIL)  (.*)$", line.rstrip("\n"))
        if m:
            rows.append((m.group(1).strip(), m.group(2).split("  ")[0].strip()))
    return rows


base_log = os.path.join(OUT, "baseline.log")
if not os.path.exists(base_log):
    sys.exit(f"{R}no baseline log at {base_log}{X}")

baseline = [n for _, n in names(base_log)]
if not baseline:
    sys.exit(f"{R}the baseline log has no assertions in it — nothing to be covered{X}")

red = {
    n
    for f in glob.glob(os.path.join(OUT, "*.log"))
    if not f.endswith("baseline.log")
    for k, n in names(f)
    if k == "FAIL"
}

gap = [n for n in baseline if n not in red]
if gap:
    print(f"{R}{len(gap)} of {len(baseline)} assertions have NEVER been seen red{X}:")
    for n in gap:
        print(f"  - {n}")
    sys.exit(1)

print(f"{G}coverage: all {len(baseline)} assertions in the suite have been watched red{X}")
