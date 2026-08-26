#!/usr/bin/env bash
# Watch every assertion in `tools/suites/smoke.mjs` go RED, one mutation at a
# time. AGENTS.md: "An assertion you did not watch fail is not evidence."
#
# WHAT THIS SCRIPT ASSERTS, AND WHY IT IS NOT JUST `! node smoke.mjs`.
# A non-zero exit proves *something* went red, not that the intended thing did.
# The spike's own mutation runner shipped that bug and it was caught in review.
# So each case declares the assertion NAMES it must turn red, and this script:
#
#   1. runs the suite UNMUTATED FIRST and requires GREEN — a mutation runner that
#      is red before it mutates has proved nothing;
#   2. refuses to continue if the edit did not apply (the anchor text moved);
#   3. requires every expected name to appear on a FAIL line;
#   4. requires the run to be red at all (exit non-zero);
#   5. restores the file and verifies the restored bytes match the original.
#
# It also PRINTS how many other assertions went red in the same run without
# failing on it: a mutation with wide blast radius is information, and hiding it
# would make the table in `smoke.mjs`'s header read narrower than the truth.
#
#   tools/suites/smoke-mutations.sh            # all of them
#   tools/suites/smoke-mutations.sh 4 7 11     # only these cases
#
# EACH CASE COSTS ONE REAL ELECTRON LAUNCH (~40 s). The whole battery is ~13
# minutes and it takes the shared browser mutex ONCE, for all of it, on fd 9 —
# not once per case. Three agents share this box; twenty separate acquisitions
# would interleave with a sibling's own battery and turn 13 minutes into an hour.
# The suite is told the lock is already held (`STEM_WORKBENCH_BROWSER_LOCK_HELD`)
# so it does not deadlock trying to take it again from inside.
#
# RUN IT IN A SCRATCH GIT WORKTREE, not in a tree somebody else is working in: it
# edits `src/`, `vendor/` and the suite itself.
#
#   git worktree add --detach "$WT" HEAD
#   ln -s "$PWD/node_modules" "$WT/node_modules"; ln -s "$PWD/models" "$WT/models"
#
# BACKUPS LIVE UNDER `out/smoke-mutations/`, THIS BATTERY'S OWN DIRECTORY, and
# never a shared path — two concurrent batteries writing `out/mutations/16.bak`
# is how the Host wave lost a case to `cp: cannot stat`.
#
# A KILLED BATTERY RESTORES WHAT IT HAD BROKEN. `trap` on INT, TERM and HUP puts
# the current case's files back and exits 130. Without it, Ctrl-C between the
# edit and the restore leaves a mutation standing on a shipped file — which the
# Host wave also paid for.
#
# FOUR CASES EDIT `vendor/`, WHICH IS NOT A LICENCE TO PATCH IT. ADR 0001: the
# unit is vendored, not forked. A mutation is applied, measured and restored
# within one case, and step 5 above is what makes "restored" a checked fact
# rather than an intention.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$ROOT/out/smoke-mutations"
mkdir -p "$OUT"
cd "$ROOT"

C_R=$'\033[31m'; C_G=$'\033[32m'; C_Y=$'\033[33m'; C_D=$'\033[2m'; C_X=$'\033[0m'
caught=0; missed=0; ran=0

# ------------------------------------------------- the mutex, for the whole run
LOCK="${STEM_WORKBENCH_BROWSER_LOCK:-${TMPDIR:-/tmp}/stem-workbench-browser-$(id -u).lock}"
exec 9>"$LOCK"
echo "${C_D}waiting for the shared browser mutex ($LOCK)…${C_X}"
if ! flock 9; then echo "${C_R}could not take $LOCK${C_X}"; exit 2; fi
echo "${C_D}mutex held for the whole battery; it is released when this script exits${C_X}"
export STEM_WORKBENCH_BROWSER_LOCK_HELD=1

# THE WIPE IS AFTER THE LOCK, AND THAT ORDERING IS A BUG FIX RATHER THAN TIDINESS.
# It used to be the third line of this file, before `flock` — so a second battery
# QUEUEING for the mutex deleted the running one's backups from under it, and the
# running one then failed to restore a mutated `vendor/` file with
# `cp: cannot stat …/4.host.js.bak`. Measured, on the run that produced the table
# in `smoke.mjs`'s header. Nothing under `$OUT` is touched until this process owns
# the box.
rm -rf "$OUT"; mkdir -p "$OUT"

# ------------------------------------------------- restore on the way out
# `CUR_FILES` is the case in flight. A battery killed between the edit and the
# restore is how a mutation ends up standing on a shipped file.
CUR_N=""; CUR_FILES=""
restore_current() {
  [ -z "$CUR_FILES" ] && return 0
  local IFS=','; local -a fl=($CUR_FILES); unset IFS
  local f
  for f in "${fl[@]}"; do
    [ -f "$OUT/$CUR_N.$(basename "$f").bak" ] && cp "$OUT/$CUR_N.$(basename "$f").bak" "$ROOT/$f"
  done
  echo "${C_Y}restored case $CUR_N: $CUR_FILES${C_X}" >&2
}
on_signal() { restore_current; exit 130; }
trap on_signal INT TERM HUP
trap restore_current EXIT

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
  STEM_WORKBENCH_BROWSER_LOCK="${STEM_WORKBENCH_BROWSER_LOCK:-}" \
    node tools/suites/smoke.mjs >"$1" 2>&1
}

fails_of() { grep -E '^FAIL' "$1" || true; }

# `case N "label" "file[,file...]" "expect1|expect2" -- edits...`
mutate_case() {
  local n="$1" label="$2" files="$3" expect="$4"; shift 4
  [ "$#" -ge 1 ] && [ "$1" = "--" ] && shift
  if [ "${#ONLY[@]}" -gt 0 ] && [[ ! " ${ONLY[*]} " =~ " $n " ]]; then return 0; fi

  echo
  echo "${C_D}=== mutation $n — $label${C_X}"
  ran=$((ran + 1))

  local IFS=','; local -a flist=($files); unset IFS
  local f
  for f in "${flist[@]}"; do cp "$ROOT/$f" "$OUT/$n.$(basename "$f").bak"; done
  CUR_N="$n"; CUR_FILES="$files"

  while [ "$#" -ge 3 ]; do
    if ! edit "$ROOT/$1" "$2" "$3"; then
      echo "${C_R}MUTATION $n DID NOT APPLY${C_X} — the anchor text in $1 has moved. Fix this script."
      for f in "${flist[@]}"; do cp "$OUT/$n.$(basename "$f").bak" "$ROOT/$f"; done
      missed=$((missed + 1)); return 0
    fi
    shift 3
  done

  local log="$OUT/$n.log"
  run_suite "$log"; local code=$?

  for f in "${flist[@]}"; do cp "$OUT/$n.$(basename "$f").bak" "$ROOT/$f"; done
  CUR_N=""; CUR_FILES=""
  for f in "${flist[@]}"; do
    if ! cmp -s "$ROOT/$f" "$OUT/$n.$(basename "$f").bak"; then
      echo "${C_R}RESTORE FAILED for $f${C_X}"; missed=$((missed + 1)); return 0
    fi
  done

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

  local n_fail; n_fail="$(fails_of "$log" | wc -l | tr -d ' ')"
  echo "  ${C_D}$n_fail assertion(s) red in total · $(tail -1 "$log") · log out/smoke-mutations/$n.log${C_X}"

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
# THE TOPOLOGY
# ==========================================================================
mutate_case 1 "never attach the source view to the window" \
  "src/main/main.js" \
  "the app launches under Playwright as one visible window" \
  -- src/main/main.js \
"  state.win.contentView.addChildView(state.source.view);" \
"  void state.source.view;"

# ==========================================================================
# THE NETWORK GUARD, AND THE LEDGER IT KEEPS
# ==========================================================================
# THE INSTRUMENT'S OWN MUTATION. Everything assertion 18 says rests on the guard
# being attached to BOTH sessions; a guard on one of them reports a clean run for
# the other and there is nothing in a green log to say so.
mutate_case 2 "guard only OUR session, and leave the source view's unwatched" \
  "tools/suites/smoke.mjs" \
  "the network guard is live on BOTH sessions" \
  -- tools/suites/smoke.mjs \
"  install(session.fromPartition('persist:youtube'), 'source');" \
"  void 'persist:youtube is left unguarded';"

# A HOST THAT PHONES HOME — P1' in one line, which is the failure assertion 18
# exists for. It ADDS a window rather than repointing one, so no page this suite
# drives goes missing and the red is the ledger's alone.
mutate_case 3 "open one hidden window on an off-box URL after boot" \
  "src/main/main.js" \
  "the whole run stayed on the box" \
  -- src/main/main.js \
"  state.win.show();
  pushStatus();" \
"  state.win.show();
  new BrowserWindow({ show: false }).loadURL('https://telemetry.smoke-mutation.invalid/ping').catch(() => {});
  pushStatus();"

# ==========================================================================
# THE SEAM — assertHost, both halves
# ==========================================================================
mutate_case 4 "delete the armShortcut duty from the DECK's Host" \
  "vendor/stem-splitter-live/extension/ui/host.js" \
  "assertHost accepted both halves of the Host" \
  -- vendor/stem-splitter-live/extension/ui/host.js \
"  armShortcut: async () => {
    const accel = await bridge().armShortcut();
    return typeof accel === 'string' && accel !== '' ? accel : null;
  }," \
"" 

mutate_case 5 "stop exporting clearModel from the ENGINE's Host" \
  "vendor/stem-splitter-live/extension/offscreen/host.js" \
  "assertHost accepted both halves of the Host" \
  -- vendor/stem-splitter-live/extension/offscreen/host.js \
"export const clearModel = async () => {};" \
"const clearModel = async () => {};"

# ==========================================================================
# THE FOUR MESSAGES THE HOST ORIGINATES
# ==========================================================================
mutate_case 6 "sendSession() stops originating SESSION" \
  "src/main/deck-host.js" \
  "SESSION: clicking \`Arm this Source\` in the application menu" \
  -- src/main/deck-host.js \
"    return bus.originate(BUS.deck, { type: 'SESSION', session: sessionForDeck() });" \
"    return true;"

mutate_case 7 "captureStart() mints the token and originates nothing" \
  "src/main/engine-messages.js" \
  "CAPTURE_START: the Host originates it to the engine" \
  -- src/main/engine-messages.js \
"      originate(withDeck({ type: 'CAPTURE_START', sourceToken: token, source: src }, deck));" \
"      void withDeck({ type: 'CAPTURE_START', sourceToken: token, source: src }, deck);"

mutate_case 8 "put a tabId back on CAPTURE_START.source" \
  "src/main/engine-messages.js" \
  "...and its shape is the frozen one" \
  -- src/main/engine-messages.js \
"      const src = { title: wc.getTitle(), url: wc.getURL() };" \
"      const src = { title: wc.getTitle(), url: wc.getURL(), tabId: wc.id };"

mutate_case 9 "deckPrepare() originates nothing" \
  "src/main/engine-messages.js" \
  "DECK_PREPARE: the Host originates it to the engine" \
  -- src/main/engine-messages.js \
"      return originate(withDeck({ type: 'DECK_PREPARE' }, deck));" \
"      return !!withDeck({ type: 'DECK_PREPARE' }, deck);"

mutate_case 10 "captureStop() revokes the claims and originates nothing" \
  "src/main/engine-messages.js" \
  "CAPTURE_STOP: clicking \`Disarm\` originates it to the engine" \
  -- src/main/engine-messages.js \
"      return originate(withDeck({ type: 'CAPTURE_STOP' }, deck));" \
"      return !!withDeck({ type: 'CAPTURE_STOP' }, deck);"

# ==========================================================================
# THE PLAYER, BOTH DIRECTIONS
# ==========================================================================
mutate_case 11 "do not relay the player's state to the deck" \
  "src/main/deck-host.js" \
  "the deck follows the player: pressing play and pause" \
  -- src/main/deck-host.js \
"    offTransport.push(transport.onState((s) => toDeck({ ...s, t: 'video' })));" \
"    offTransport.push(transport.onState(() => {}));"

# L1 AT THE OTHER END OF THE WIRE: the preload never reads a media URL, and this
# is the Host putting one on the deck's own feed anyway.
mutate_case 12 "relay the player's state with a media URL added to it" \
  "src/main/deck-host.js" \
  "...and the report the deck reads carries the transport state and NOTHING about the media" \
  -- src/main/deck-host.js \
"    offTransport.push(transport.onState((s) => toDeck({ ...s, t: 'video' })));" \
"    offTransport.push(transport.onState((s) => toDeck({ ...s, t: 'video', src: 'https://media.example/av.mp4' })));"

mutate_case 13 "do not relay the content jump" \
  "src/main/deck-host.js" \
  "a seek the USER made arrives at the deck as exactly one content jump" \
  -- src/main/deck-host.js \
"    offTransport.push(transport.onJump(() => toDeck({ t: 'jump' })));" \
"    offTransport.push(transport.onJump(() => {}));"

# BOTH MESSAGES, BECAUSE THE FIRST DRAFT OF THIS CASE WAS A MISS. It silenced
# `onSpeedReport` alone and the assertion stayed GREEN — `onElementRate()` in
# `ui/embed.js` is one entry point for a fact that arrives on two messages, and
# the rate came in on `VIDEO.playbackRate` instead. A one-channel mutation
# reported as a catch is worse than no mutation at all, so this silences both.
# ONE FILE AGAIN, AND THAT IS THE POINT. This case was briefly written to
# silence BOTH of the deck's rate feeds, because the assertion as first drafted
# read only `__embed.speed` and the video state carries `playbackRate` too. The
# assertion now reads the REPORT off the deck's inbound channel, so deleting the
# relay alone is enough — and a mutation that has to break two things to be seen
# is a mutation telling you the assertion is not about either of them.
mutate_case 14 "do not relay the speed report" \
  "src/main/deck-host.js" \
  "the page's own speed menu reaches the deck" \
  -- src/main/deck-host.js \
"    offTransport.push(transport.onSpeedReport((p) => toDeck({ ...p, t: 'speed' })));" \
"    offTransport.push(transport.onSpeedReport(() => {}));"

mutate_case 15 "transport.drive() becomes a no-op" \
  "src/main/transport.js" \
  "the deck reaches the player: \`transport.drive\` lands" \
  -- src/main/transport.js \
"    drive(patch) { stats.drives++; toPreload({ c: 'drive', ...filterDrive(patch) }); }," \
"    drive(patch) { stats.drives++; void patch; },"

# ALL THREE FILTERS AT ONCE, AND THAT IS THE POINT RATHER THAN A CONVENIENCE.
# The write set is closed in three places — `ui/host.js` on the deck's side,
# `filterDrive()` in main, and `driveVideo()` in the preload — and MEASUREMENT
# said so: opening only `filterDrive` leaves assertion 13 green, because the
# preload reads three named fields off the command and never the command itself.
# A one-file mutation here would have been a MISS reported as a caught one. So
# this case opens all three and the assertion goes red; what it proves is that
# the closure is load-bearing end to end, and what it records is that no SINGLE
# layer's failure is visible to this suite. The layer-by-layer claims are
# `deck-seam`'s and `transport`'s.
mutate_case 16 "open all three drive filters — the deck's, main's and the preload's" \
  "vendor/stem-splitter-live/extension/ui/host.js,src/main/drive.js,src/preload/youtube.cjs" \
  "...and NOTHING else did" \
  -- vendor/stem-splitter-live/extension/ui/host.js \
"      const cmd = { c: 'drive' };" \
"      const cmd = { ...p, c: 'drive' };" \
  src/main/drive.js \
"  const out = {};
  if (typeof p.muted === 'boolean') out.muted = p.muted;" \
"  const out = { ...p };
  if (typeof p.muted === 'boolean') out.muted = p.muted;" \
  src/preload/youtube.cjs \
"function driveVideo(cmd) {
  if (!el) return;" \
"function driveVideo(cmd) {
  if (!el) return;
  for (const [k, v] of Object.entries(cmd)) { if (k !== 'c') { try { el[k] = v; } catch { /* read-only */ } } }"

mutate_case 17 "disarm stops handing the player back" \
  "src/main/deck-host.js" \
  "...and the player is handed back the way it was found" \
  -- src/main/deck-host.js \
"      if (transport) transport.release();
    }
    sendSession();" \
"    }
    sendSession();"

# ==========================================================================
# WHAT THE DECK PAINTED, AND THE CONTEXT IT PLAYS THROUGH
# ==========================================================================
mutate_case 18 "drop a stem from the deck's strip order" \
  "vendor/stem-splitter-live/extension/ui/embed.js" \
  "the deck painted one fader per stem" \
  -- vendor/stem-splitter-live/extension/ui/embed.js \
"const STEM_ORDER = ['vocals', 'drums', 'bass', 'other', 'guitar', 'piano'];" \
"const STEM_ORDER = ['vocals', 'drums', 'bass', 'other', 'guitar'];"

mutate_case 19 "open the AudioContext at the platform default" \
  "vendor/stem-splitter-live/extension/offscreen/engine.js" \
  "the AudioContext the engine opened for the capture is at 44100" \
  -- vendor/stem-splitter-live/extension/offscreen/engine.js \
"  const c = new AudioContext({ sampleRate: SR, latencyHint: 'playback' });" \
"  const c = new AudioContext({ latencyHint: 'playback' });"

# ==========================================================================
# THERE IS NO CASE FOR L1's STATIC SCAN, and that is not an omission: the scan
# is `tools/suites/transport.mjs`'s ("…and none of the names L1 forbids appears
# in it at all", plus "…and the scanner is looking at code rather than at
# nothing"), and it is falsified by that suite's own battery. This suite cites it
# instead of keeping a second copy. Assertion 9 is this file's L1 claim and
# case 12 is what turns it red.

# ==========================================================================
# THE COVERAGE CHECK, and it is the point of the whole file.
#
# "19 mutations were caught" is not the claim worth making. The claim is that NO
# ASSERTION IN THE SUITE HAS GONE UNBROKEN — an assertion no mutation has ever
# turned red is an assumption wearing an `ok`, and it is invisible from inside a
# green run. Runs only for a FULL battery; a subset cannot make the claim.
cover=0
if [ "${#ONLY[@]}" -eq 0 ]; then
  echo
  python3 "$HERE/coverage.py" "$OUT" || cover=1
fi

echo
echo "========================================================================"
if [ "$missed" -eq 0 ] && [ "$ran" -gt 0 ] && [ "$cover" -eq 0 ]; then
  # A SUBSET MAY NOT MAKE THE COVERAGE CLAIM. `coverage.py` only runs for a full
  # battery, so on `smoke-mutations.sh 11 14` the second half of this sentence
  # would be an assertion nobody made — the shape of overclaim this whole file
  # exists to refuse.
  if [ "${#ONLY[@]}" -eq 0 ]; then
    echo "${C_G}all $caught of $ran mutations were caught${C_X}, and every assertion in the suite has been watched red."
  else
    echo "${C_G}all $caught of $ran selected mutations were caught${C_X} — a subset, so nothing is claimed about coverage."
  fi
  exit 0
fi
[ "$missed" -gt 0 ] && echo "${C_R}$missed of $ran mutations were NOT caught${C_X} (caught $caught). Logs in out/smoke-mutations/."
[ "$cover" -ne 0 ] && echo "${C_R}an assertion in the suite has no mutation${C_X} — see the coverage list above."
exit 1
