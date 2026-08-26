#!/usr/bin/env bash
# Watch every assertion in `tools/suites/p1.mjs` go RED, one mutation at a
# time. AGENTS.md: "An assertion you did not watch fail is not evidence."
#
# WHAT THIS SCRIPT ASSERTS, AND WHY IT IS NOT JUST `! node shell.mjs`.
# A non-zero exit proves *something* went red, not that the intended thing did.
# The spike's own mutation runner shipped that bug and it was caught in review.
# So each case declares the assertion NAMES it must turn red, and this script:
#
#   1. runs the suite UNMUTATED FIRST and requires GREEN — a mutation runner that
#      is red before it mutates has proved nothing;
#   2. refuses to continue if the edit did not apply (the anchor text moved);
#   3. requires every expected name to appear on a FAIL line;
#   4. requires the run to be red at all (exit non-zero);
#   5. restores the file and verifies the restored bytes hash to the original.
#
# It also PRINTS every other assertion that went red in the same run, without
# failing on it: a mutation with wide blast radius is information, and hiding it
# would make the table above read narrower than the truth.
#
#   tools/suites/p1-mutations.sh            # all of them
#   tools/suites/p1-mutations.sh 4 7 11     # only these cases
#
# Each case costs one real Electron launch. THE LOCK QUEUE IS NOT IN THE
# STOPWATCH: `p1.mjs` takes the shared browser mutex in a child that holds it
# until its stdin closes and times only the launch, so a sibling agent's suite
# holding the lock for four minutes does not turn into "the app did not start".
#
# RECORDED RUN — 2026-08-26, Electron 44.0.0 / Linux, in a worktree of its own:
# 19 of 19 caught, and `coverage.py` reports all 19 assertions watched red.
# The per-case blast radius is in the table at the top of `tools/suites/p1.mjs`.
#
# ---------------------------------------------------------------------------
# THREE THINGS THIS SCRIPT DOES BECAUSE THE HOST WAVE LOST WORK WITHOUT THEM
# ---------------------------------------------------------------------------
#   1. BACKUPS LIVE UNDER `out/p1-mutations/`, never a shared path. Two batteries
#      writing `out/<n>.<file>.bak` clobbered each other's backups in the Host
#      wave and one case died on `cp: cannot stat` because a backup had vanished
#      mid-case.
#   2. IT HOLDS THE SHARED BROWSER MUTEX FOR THE WHOLE RUN and tells the suite so
#      (`STEM_WORKBENCH_LOCK_HELD=1`), because `flock` is not reentrant: a
#      battery that took the lock and then ran a suite that takes it again waits
#      for itself for ever. Twenty launches inside one hold, rather than twenty
#      acquisitions interleaved with somebody else's.
#   3. IT RESTORES ON SIGINT AND SIGTERM. A battery killed mid-case skips its
#      cleanup and leaves a MUTATION STANDING ON A SHIPPED FILE — which is a
#      broken app that nothing reports, until somebody commits it. The trap
#      restores every backup in `$OUT` and exits 130.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$ROOT/out/p1-mutations"

# ---------------------------------------------------------------- the mutex
# Re-exec once, holding the lock, so every launch below is inside one hold.
# THE PATH IS ASKED FOR, NOT RE-DERIVED. `tools/lib/locks.mjs` is the one place
# in `tools/` allowed to name a lock; a bash copy of the formula is the second
# literal that let two lines of work queue on two different files and then race
# each other on `xvfb-run -a`. `void-canary` goes red if this comes back.
LOCK="$(node "$ROOT/tools/lib/locks.mjs" browser)"
if [ "${STEM_WORKBENCH_LOCK_HELD:-}" != "1" ]; then
  echo "taking the shared browser mutex ($LOCK) for the whole battery..."
  exec env STEM_WORKBENCH_LOCK_HELD=1 flock "$LOCK" "$0" "$@"
fi

rm -rf "$OUT"; mkdir -p "$OUT"
cd "$ROOT"
# THE MUTATION GUARD. Traps are the belt: this battery restores on INT, TERM and
# HUP, and `timeout` sends TERM — which is how a long battery is most likely to
# die and was the one way it did not clean up (stem-workbench#22). The SENTINEL
# is the braces, for `kill -9`, a crashed host and a full disk, where no trap
# runs at all: while a mutation is standing there is a file under
# `out/.mutating/` naming it, and every suite refuses to start while one is
# there. `tools/lib/tree-guard.mjs` is the long form.
MG_BATTERY='p1-mutations'; MG_ROOT="$ROOT"
. "$ROOT/tools/lib/mutation-guard.sh"
trap mg_on_signal INT TERM HUP   # on_signal() below is chained in via MG_ALSO

# ------------------------------------------------------- restore on a kill
# `$OUT/<n>.<basename>.bak` is the only backup convention here, so the trap can
# restore without knowing which case was running. It restores the MOST RECENT
# backup for each basename, which is the one the interrupted case took.
# EVERY CASE WRITES `$OUT/<n>.paths` BEFORE IT EDITS ANYTHING — the exact
# repo-relative paths it is about to mutate, so the trap restores by PATH and
# never has to guess one from a basename. Two files called `p1.mjs` live in this
# tree (`tools/gate/` and `tools/suites/`) and a trap that matched on basename
# would have restored the wrong one.
restore_all() {
  local paths n base
  for paths in $(ls -t "$OUT"/*.paths 2>/dev/null); do
    n="$(basename "$paths" .paths)"
    while read -r f; do
      [ -z "$f" ] && continue
      base="$(basename "$f")"
      [ -f "$OUT/$n.$base.bak" ] && cp "$OUT/$n.$base.bak" "$ROOT/$f"
    done < "$paths"
  done
}
on_signal() {
  echo
  echo "INTERRUPTED — restoring every mutated file from $OUT before exiting."
  restore_all
  git -C "$ROOT" status --short -- src tools vendor || true
  exit 130
}
MG_ALSO=on_signal

C_R=$'\033[31m'; C_G=$'\033[32m'; C_Y=$'\033[33m'; C_D=$'\033[2m'; C_X=$'\033[0m'
caught=0; missed=0; ran=0

# ---------------------------------------------------------------- the edits
# `edit FILE OLD NEW` — exact, first occurrence, and a HARD ERROR if the anchor
# is not there. A mutation that silently did not apply is a green nobody earned.
edit() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path).read()
if old not in s:
    sys.stderr.write("ANCHOR NOT FOUND in %s:\n%s\n" % (path, old[:200]))
    sys.exit(3)
open(path, 'w').write(s.replace(old, new, 1))
PY
}

run_suite() {   # -> writes $1, returns the suite's exit code
    node tools/suites/p1.mjs >"$1" 2>&1
}

fails_of() { grep -E '^FAIL' "$1" || true; }

# `case N "label" "file[,file...]" "expect1|expect2" -- edits...`
# Edits are triples passed through `edit`; several may be given.
mutate_case() {
  local n="$1" label="$2" files="$3" expect="$4"; shift 4
  [ "$#" -ge 1 ] && [ "$1" = "--" ] && shift
  if [ "${#ONLY[@]}" -gt 0 ] && [[ ! " ${ONLY[*]} " =~ " $n " ]]; then return 0; fi

  echo
  echo "${C_D}=== mutation $n — $label${C_X}"
  ran=$((ran + 1))

  local IFS=','; local -a flist=($files); unset IFS
  local f
  printf '%s\n' "${flist[@]}" > "$OUT/$n.paths"
  local -a mg_pairs=()
  for f in "${flist[@]}"; do cp "$ROOT/$f" "$OUT/$n.$(basename "$f").bak"; mg_pairs+=("$f=$OUT/$n.$(basename "$f").bak"); done
  # THE SENTINEL GOES DOWN BEFORE THE FIRST EDIT AND COMES UP ONLY ONCE THE
  # RESTORE HAS BEEN BYTE-VERIFIED. A `kill -9` here leaves it standing, and
  # every suite then REFUSES TO RUN rather than measuring the mutation — which
  # is stem-workbench#22, the false red that outlives the run that caused it.
  mg_claim "$n" "${mg_pairs[@]}"

  while [ "$#" -ge 3 ]; do
    if ! edit "$ROOT/$1" "$2" "$3"; then
      echo "${C_R}MUTATION $n DID NOT APPLY${C_X} — the anchor text in $1 has moved. Fix this script."
      for f in "${flist[@]}"; do cp "$OUT/$n.$(basename "$f").bak" "$ROOT/$f"; done
      mg_release "$n"; missed=$((missed + 1)); return 0
    fi
    shift 3
  done

  local log="$OUT/$n.log"
  run_suite "$log"; local code=$?

  for f in "${flist[@]}"; do cp "$OUT/$n.$(basename "$f").bak" "$ROOT/$f"; done
  for f in "${flist[@]}"; do
    if ! cmp -s "$ROOT/$f" "$OUT/$n.$(basename "$f").bak"; then
      echo "${C_R}RESTORE FAILED for $f${C_X}"; missed=$((missed + 1)); return 0
    fi
  done
  # RESTORED AND BYTE-VERIFIED, so the sentinel comes up. A restore that FAILED
  # returns above without releasing, on purpose: the mutation really is still
  # standing then, and the next suite must refuse rather than measure it.
  mg_release "$n"

  rm -f "$OUT/$n.paths"          # restored and verified: nothing left for the trap to undo

  local ok=1
  local IFS='|'; local -a wants=($expect); unset IFS
  local w
  for w in "${wants[@]}"; do
    if fails_of "$log" | grep -qF -- "$w"; then
      echo "  ${C_G}red${C_X}    $w"
    else
      echo "  ${C_R}MISS${C_X}   $w  ${C_D}— expected this assertion to fail and it did not${C_X}"
      ok=0
    fi
  done
  if [ "$code" -eq 0 ]; then
    echo "  ${C_R}MISS${C_X}   the suite exited 0 under the mutation"
    ok=0
  fi

  local extra
  extra="$(fails_of "$log" | sed -E 's/^FAIL +//; s/  .*//' | while read -r line; do
    printf '%s\n' "$line"
  done)"
  local n_fail; n_fail="$(fails_of "$log" | wc -l | tr -d ' ')"
  echo "  ${C_D}$n_fail assertion(s) red in total · $(tail -1 "$log") · log out/p1-mutations/$n.log${C_X}"

  if [ "$ok" -eq 1 ]; then caught=$((caught + 1)); else missed=$((missed + 1)); fi
}

ONLY=("$@")

# ------------------------------------------------- 0. green before mutating
echo "${C_D}=== baseline — the suite must be GREEN before anything is broken${C_X}"
if ! run_suite "$OUT/baseline.log"; then
  echo "${C_R}BASELINE IS RED${C_X} — nothing below would prove anything. Last lines:"
  tail -20 "$OUT/baseline.log"
  exit 2
fi
echo "  ${C_G}green${C_X}  $(tail -1 "$OUT/baseline.log")"

# ==========================================================================
# ==========================================================================
# 1-4  THE POLICY, as a pure function
# ==========================================================================
mutate_case 1 "the one host is refused: allow http, not https" \
  "src/main/p1.js" \
  "the one host P1' allows is admitted on an app-owned session" \
  -- src/main/p1.js \
"  return u.protocol === 'https:' && u.hostname === UPDATE_HOST;" \
"  return u.protocol === 'http:' && u.hostname === UPDATE_HOST;"

mutate_case 2 "host match becomes hostname.includes(UPDATE_HOST) — the classic trap" \
  "src/main/p1.js" \
  "...and every other network URL is refused, including the two host-match traps and a WebSocket" \
  -- src/main/p1.js \
"  return u.protocol === 'https:' && u.hostname === UPDATE_HOST;" \
"  return u.protocol === 'https:' && u.hostname.includes(UPDATE_HOST);"

mutate_case 3 "bind every scheme, not just the network ones" \
  "src/main/p1.js" \
  "...and a scheme that never leaves the machine is not P1's business" \
  -- src/main/p1.js \
"  if (!NETWORK_SCHEMES.includes(u.protocol)) return true;" \
"  if (false) return true;"

mutate_case 4 "bind the user's own session too" \
  "src/main/p1.js" \
  "...and NOTHING is refused on a user-owned session" \
  -- src/main/p1.js \
"  if (owner !== 'app') return true;" \
"  if (false) return true;"

# ==========================================================================
# 5-9  THE SOURCE SCANS
# ==========================================================================
# THE REALISTIC REGRESSION, not a synthetic one: somebody adds a partition and
# reaches for `session.fromPartition` because it is right there. The blast radius
# is wide on purpose — that is what the factory buys.
mutate_case 5 "take the youtube session directly instead of through the factory" \
  "src/main/main.js" \
  "no file but src/main/sessions.js names a session at all" \
  -- src/main/main.js \
"import { app, BaseWindow, BrowserWindow, WebContentsView, ipcMain, Menu } from 'electron';" \
"import { app, BaseWindow, BrowserWindow, WebContentsView, ipcMain, Menu, session } from 'electron';" \
  src/main/main.js \
"  const theirs = state.sessions.makeSession('youtube', 'persist:youtube');" \
"  const theirs = session.fromPartition('persist:youtube');"

mutate_case 6 "re-type the update host in a second file" \
  "src/main/sessions.js" \
  "is spelled in exactly one file under src/" \
  -- src/main/sessions.js \
"const USER_LOG_CAP = 4000;" \
"const USER_LOG_CAP = 4000;
const RETYPED_HOST = 'api.github.com';
void RETYPED_HOST;"

mutate_case 7 "start a crash reporter" \
  "src/main/main.js" \
  "crashReporter is never started and crashDumps is never asked for" \
  -- src/main/main.js \
"  Menu.setApplicationMenu(null);" \
"  Menu.setApplicationMenu(null);
  if (globalThis.__never_true) crashReporter.start({ submitURL: 'https://crash.example/submit' });"

mutate_case 8 "put an installation identifier on the update request" \
  "src/main/update.js" \
  "...and the update request is built with one header and no identifier" \
  -- src/main/update.js \
"const UPDATE_HEADERS = Object.freeze({ accept: 'application/vnd.github+json' });" \
"const INSTALL_ID = globalThis.crypto.randomUUID();
const UPDATE_HEADERS = Object.freeze({ accept: 'application/vnd.github+json', 'x-install': INSTALL_ID });"

mutate_case 9 "load a webfont into the chrome bar" \
  "src/renderer/chrome.html" \
  "the app's own pages reference no external origin" \
  -- src/renderer/chrome.html \
'<link rel="stylesheet" href="./chrome.css">' \
'<link rel="stylesheet" href="./chrome.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">'

# ==========================================================================
# 10-11  THE INSTRUMENT — the two ways this suite goes blind
# ==========================================================================
# THE VOID CASE, ONE LEVEL IN. Everything after the launch reads a file the probe
# wrote, so a suite that cannot tell a missing report from a passing run reports
# green on an app that never started.
mutate_case 10 "the probe writes no report" \
  "tools/gate/p1.mjs" \
  "the app launches from its real entry point and writes a P1 report" \
  -- tools/gate/p1.mjs \
"  fs.writeFileSync(path.join(outDir, 'report.json'), \`\${JSON.stringify(R, null, 2)}\n\`);" \
"  void R;"

mutate_case 11 "install the observer on the app session only" \
  "src/main/sessions.js" \
  "every session the app made got a listener, and there are at least two of them" \
  -- src/main/sessions.js \
"    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      const allowed = mayRequest(owner, details.url);
      record(label, owner, details, allowed);
      callback(allowed ? {} : { cancel: true });
    });
    stats.listeners++;" \
"    if (owner === 'app') {
      ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
        const allowed = mayRequest(owner, details.url);
        record(label, owner, details, allowed);
        callback(allowed ? {} : { cancel: true });
      });
      stats.listeners++;
    }"

# ==========================================================================
# 12-15  THE CLAIM ITSELF, and the guard that says the instrument was looking
# ==========================================================================
mutate_case 12 "the app fetches a webfont at boot" \
  "src/main/main.js" \
  "the app's own sessions reached exactly" \
  -- src/main/main.js \
"  state.updateCheck = UPDATE_CHECK ? state.update.check().catch(() => null) : null;" \
"  state.updateCheck = UPDATE_CHECK ? state.update.check().catch(() => null) : null;
  await ours.fetch('https://fonts.googleapis.com/css2?family=Inter').catch(() => null);"

mutate_case 13 "stub the update check out entirely — the observation set empties" \
  "src/main/main.js" \
  "...and that set is NON-EMPTY" \
  -- src/main/main.js \
"const UPDATE_CHECK = argv.includes('--update-check')" \
"const UPDATE_CHECK = false && argv.includes('--update-check')"

# THE COULD-IT-LOOK GUARD'S OWN MUTATION. The wire still carries the request and
# the fake host still records it; only the instrument stops seeing. Instrument
# silent + host hit is the one shape that catches an observer that has quietly
# stopped being installed, and this is it.
mutate_case 14 "the observer stops recording https, and records everything else" \
  "src/main/sessions.js" \
  "THE COULD-IT-LOOK GUARD" \
  -- src/main/sessions.js \
"      const allowed = mayRequest(owner, details.url);
      record(label, owner, details, allowed);" \
"      const allowed = mayRequest(owner, details.url);
      if (!String(details.url).startsWith('https://')) record(label, owner, details, allowed);"

mutate_case 15 "the check stops reading the body it was answered with" \
  "src/main/update.js" \
  "...and the check really COMPLETED" \
  -- src/main/update.js \
"      const tag = body && typeof body.tag_name === 'string' ? body.tag_name : null;" \
"      const tag = null;"

# ==========================================================================
# 16-19  THE EXCLUSION, THE WIRE, THE COVERAGE, THE OTHER LAYER
# ==========================================================================
# docs/TESTING.md §9's own mutation, verbatim: move the exclusion from the
# session's OWNER to a URL substring. The youtube half still passes — and the
# app half stops failing, which is the whole reason the pair exists.
mutate_case 16 "the exclusion moves from the session owner to a URL substring" \
  "src/main/p1.js" \
  "THE SAME URL THROUGH TWO SESSIONS, OPPOSITE VERDICTS" \
  -- src/main/p1.js \
"  if (owner !== 'app') return true;" \
"  if (/youtube|telemetry\.invalid/.test(String(url))) return true;
  if (owner !== 'app') return true;"

# THE LOG STILL SAYS `cancelled: true`. Only the wire disagrees — which is
# exactly why the fake host's counter is part of the assertion.
mutate_case 17 "the policy is recorded and then not applied" \
  "src/main/sessions.js" \
  "...and the fake host was reached exactly once for that URL" \
  -- src/main/sessions.js \
"      callback(allowed ? {} : { cancel: true });" \
"      callback({});"

mutate_case 18 "tidy the listener's filter down to https" \
  "src/main/sessions.js" \
  "the observer covers RENDERER-initiated traffic on both sessions" \
  -- src/main/sessions.js \
"    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {" \
"    ses.webRequest.onBeforeRequest({ urls: ['https://*/*'] }, (details, callback) => {"

mutate_case 19 "relax connect-src to any https origin" \
  "src/main/assets.js" \
  "a renderer of ours cannot reach an off-origin URL AT ALL" \
  -- src/main/assets.js \
"  \"connect-src 'self'\"," \
"  \"connect-src 'self' https:\","

# ==========================================================================
# THE COVERAGE CHECK, and it is the point of the whole file.
#
# "19 mutations were caught" is not the claim worth making. The claim is that
# NO ASSERTION IN THE SUITE HAS GONE UNBROKEN — an assertion no mutation has
# ever turned red is an assumption wearing an `ok`, and it is invisible from
# inside a green run. This compares every assertion name in the baseline against
# every name that appeared on a FAIL line in any mutation log, and names the
# gap. It runs only for a FULL battery; a subset cannot make the claim.
cover=0
if [ "${#ONLY[@]}" -eq 0 ]; then
  echo
  python3 "$HERE/coverage.py" "$OUT" || cover=1
fi

echo
echo "========================================================================"
if [ "$missed" -eq 0 ] && [ "$ran" -gt 0 ] && [ "$cover" -eq 0 ]; then
  echo "${C_G}all $caught of $ran mutations were caught${C_X}, and every assertion in the suite has been watched red."
  exit 0
fi
[ "$missed" -gt 0 ] && echo "${C_R}$missed of $ran mutations were NOT caught${C_X} (caught $caught). Logs in out/p1-mutations/."
[ "$cover" -ne 0 ] && echo "${C_R}an assertion in the suite has no mutation${C_X} — see the coverage list above."
exit 1
