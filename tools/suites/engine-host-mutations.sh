#!/usr/bin/env bash
# Watch every assertion in `tools/suites/engine-host.mjs` go RED, one mutation at
# a time. AGENTS.md: "An assertion you did not watch fail is not evidence."
#
# Same shape as `shell-mutations.sh` and for the same reasons: a non-zero exit
# proves *something* went red, not that the intended thing did, so every case
# declares the assertion NAMES it must turn red. The script
#
#   1. runs the suite UNMUTATED FIRST and requires GREEN;
#   2. refuses a case whose expected name matches no assertion in that green
#      baseline — a misspelled question MISSES exactly like a hole in the suite;
#   3. refuses to continue if an edit did not apply (the anchor text moved);
#   4. requires every expected name to appear on a FAIL line;
#   5. requires the run to be red at all;
#   6. restores the file and verifies the restored bytes are identical.
#
# It PRINTS the total number of reds per case without failing on it: a mutation
# with a wide blast radius is information, and hiding it would make the table in
# the suite's header read narrower than the truth. Cases 1 and 12 are wide ON
# PURPOSE — a Host that cannot boot cannot answer anything, and that IS the
# claim.
#
#   tools/suites/engine-host-mutations.sh          # all of them
#   tools/suites/engine-host-mutations.sh 4 9      # only these cases
#
# Each launch case costs one real Electron launch plus a 109 MB model load and an
# ONNX session (~55 s). The whole battery is ~20 minutes. `tools/suites/coverage.py`
# is run at the end over a FULL battery only — a subset cannot make the claim.
set -uo pipefail

# ---------------------------------- refuse a case id that does not exist
# FIRST, BEFORE THE MUTEX AND BEFORE THE BASELINE — which is the whole point.
# Every battery here takes the machine-global browser mutex and runs a real
# baseline launch, and the case filter is applied only afterwards. So a typo'd
# id used to queue for the lock, launch Electron, run ZERO cases, and then fall
# through every verdict branch to a SILENT `exit 1`. Measured on this box:
# `shell-mutations.sh 42 43 44 45 46 47 48` on a battery whose ids stop at 41
# spent five minutes of queue and one windowed launch to print nothing, while
# four other agents waited behind it. An instrument that says nothing is bad; one
# that consumes the single scarce resource in order to say nothing is worse.
#
# THE KNOWN SET IS READ OUT OF THIS FILE, so it cannot go stale as cases are
# added, and it makes NO ASSUMPTION ABOUT THE SHAPE OF AN ID. That is not
# caution for its own sake: ids in this repository include `13b`, `39a`, `3b`,
# `1b` and — in `vendor-unit-mutations.sh` — plain `A` and `B`. A pattern like
# `[0-9]+[a-z]*` looks right, matches most of them, and REJECTS A VALID CASE,
# which is worse than no check at all. Field two, verbatim, whatever it is.
#
# `-*` is skipped so flags (`--static`, and anything a battery adds) pass through
# to the parsing below untouched.
_CASE_KNOWN=$(grep -oE '^(mutate_case|canary_case|M) +[^ ]+' "$0" | awk '{print $2}' | tr '\n' ' ')
_CASE_BAD=''
for _c in "$@"; do
  case "$_c" in -*) continue ;; esac
  case " $_CASE_KNOWN " in *" $_c "*) ;; *) _CASE_BAD="$_CASE_BAD $_c" ;; esac
done
if [ -n "$_CASE_BAD" ]; then
  echo "no such case:$_CASE_BAD" >&2
  echo "known cases: $_CASE_KNOWN" >&2
  echo "nothing ran, and the shared browser mutex was not taken." >&2
  exit 2
fi
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$ROOT/out/engine-host-mutations"
HOST="vendor/stem-splitter-live/extension/offscreen/host.js"
mkdir -p "$OUT"
cd "$ROOT"
# THE MUTATION GUARD. Traps are the belt: this battery restores on INT, TERM and
# HUP, and `timeout` sends TERM — which is how a long battery is most likely to
# die and was the one way it did not clean up (stem-workbench#22). The SENTINEL
# is the braces, for `kill -9`, a crashed host and a full disk, where no trap
# runs at all: while a mutation is standing there is a file under
# `out/.mutating/` naming it, and every suite refuses to start while one is
# there. `tools/lib/tree-guard.mjs` is the long form.
MG_BATTERY='engine-host-mutations'; MG_ROOT="$ROOT"
. "$ROOT/tools/lib/mutation-guard.sh"
trap mg_on_signal INT TERM HUP
mg_begin

C_R=$'\033[31m'; C_G=$'\033[32m'; C_Y=$'\033[33m'; C_D=$'\033[2m'; C_X=$'\033[0m'
caught=0; missed=0; ran=0

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

run_suite() { node tools/suites/engine-host.mjs >"$1" 2>&1; }
fails_of() { grep -E '^FAIL' "$1" || true; }

mutate_case() {
  local n="$1" label="$2" files="$3" expect="$4"; shift 4
  [ "$#" -ge 1 ] && [ "$1" = "--" ] && shift
  if [ "${#ONLY[@]}" -gt 0 ] && [[ ! " ${ONLY[*]} " =~ " $n " ]]; then return 0; fi

  echo
  echo "${C_D}=== mutation $n — $label${C_X}"
  ran=$((ran + 1))

  # EVERY EXPECT NAME MUST NAME A REAL ASSERTION, checked against the GREEN
  # baseline's own output before a byte is mutated.
  #
  # Four cases in the first full battery MISSED for a reason that had nothing to
  # do with the code under test: the assertion had been reworded, or a backtick
  # in its name had been eaten by the shell before `grep -F` ever saw it, so the
  # question being asked was a string this suite never prints. A battery that
  # cannot tell "the code survived the mutation" from "I misspelled the
  # question" is not evidence of anything, and it fails SILENTLY — as a miss
  # that reads exactly like a hole in the suite.
  local IFS='|'; local -a wants0=($expect); unset IFS
  local w0
  for w0 in "${wants0[@]}"; do
    if ! grep -qF -- "$w0" "$OUT/baseline.log"; then
      echo "  ${C_R}BAD CASE${C_X} — no assertion in this suite is named:"
      echo "    $w0"
      echo "  ${C_D}fix this script, not the code under test${C_X}"
      missed=$((missed + 1)); return 0
    fi
  done

  local IFS=','; local -a flist=($files); unset IFS
  local f
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

  local ok=1
  local IFS='|'; local -a wants=($expect); unset IFS
  local w
  for w in "${wants[@]}"; do
    if fails_of "$log" | grep -qF -- "$w"; then echo "  ${C_G}red${C_X}    $w"
    else echo "  ${C_R}MISS${C_X}   $w  ${C_D}— expected this assertion to fail and it did not${C_X}"; ok=0; fi
  done
  [ "$code" -eq 0 ] && { echo "  ${C_R}MISS${C_X}   the suite exited 0 under the mutation"; ok=0; }
  echo "  ${C_D}$(fails_of "$log" | wc -l | tr -d ' ') assertion(s) red in total · $(tail -1 "$log") · log out/engine-host-mutations/$n.log${C_X}"
  if [ "$ok" -eq 1 ]; then caught=$((caught + 1)); else missed=$((missed + 1)); fi
}

ONLY=("$@")

echo "${C_D}=== baseline — the suite must be GREEN before anything is broken${C_X}"
if ! run_suite "$OUT/baseline.log"; then
  echo "${C_R}BASELINE IS RED${C_X} — nothing below would prove anything. Last lines:"
  tail -20 "$OUT/baseline.log"; exit 2
fi
echo "  ${C_G}green${C_X}  $(tail -1 "$OUT/baseline.log")"

# ======================================================== the pure-function cases
mutate_case 16 "claims.spend(): do not consume the entry" \
  "src/main/claims.js" \
  "a capture claim is ONE SHOT" \
  -- src/main/claims.js \
"      live.delete(token);" "" 

mutate_case 28 "claims.spend(): accept a token that was never minted" \
  "src/main/claims.js" \
  "...and a token nobody minted is refused by construction|a capture claim is ONE SHOT" \
  -- src/main/claims.js \
"      if (!rec) return refuse('unknown-token', 'that capture claim was never minted, or has already been spent');" \
"      if (!rec) return { ok: true };" 

mutate_case 17 "claims.spend(): ignore the deadline" \
  "src/main/claims.js" \
  "...and a claim EXPIRES rather than waiting for a gesture that has ended" \
  -- src/main/claims.js \
"      if (rec.expiresAt <= now()) return refuse('expired'," "      if (false) return refuse('expired'," 

mutate_case 18 "claims.takePending(): leave the claim pending" \
  "src/main/claims.js" \
  "...and the pending claim is consumed by the grant" \
  -- src/main/claims.js \
"      const p = pending;
      pending = null;" "      const p = pending;" 

mutate_case 19 "claims.revokeAll(): keep the live claims" \
  "src/main/claims.js" \
  "...and revoking drops every live claim" \
  -- src/main/claims.js \
"      live.clear();
      pending = null;" "      pending = null;" 

mutate_case 13 "engine-messages: put a tabId back on CAPTURE_START.source" \
  "src/main/engine-messages.js" \
  "CAPTURE_START carries EXACTLY|the Host ORIGINATED CAPTURE_START" \
  -- src/main/engine-messages.js \
"      const src = { title: wc.getTitle(), url: wc.getURL() };" \
"      const src = { title: wc.getTitle(), url: wc.getURL(), tabId: wc.id };" 

mutate_case 14 "engine-messages: always send \`deck\`, even for the default" \
  "src/main/engine-messages.js" \
  "...and \`deck\` is OMITTED for the default deck|the Host ORIGINATED CAPTURE_STOP|the Host ORIGINATED DECK_PREPARE" \
  -- src/main/engine-messages.js \
"const withDeck = (msg, deck) => (deck && deck !== DECK_DEFAULT ? { ...msg, deck } : msg);" \
"const withDeck = (msg, deck) => ({ ...msg, deck: deck || DECK_DEFAULT });" 

mutate_case 15 "engine-messages: CAPTURE_STOP without revoking the claims" \
  "src/main/engine-messages.js" \
  "CAPTURE_STOP stops it, and takes every live claim with it" \
  -- src/main/engine-messages.js \
"      claims.revokeAll('CAPTURE_STOP');" "" 

# ============================================================== the launch cases
mutate_case 1 "host.js: delete a duty — captureStream" \
  "$HOST" \
  "THE VENDORED ENGINE BOOTS UNDER THIS HOST|...and the module it imported declares all nine duties" \
  -- "$HOST" \
"export const captureStream = async (sourceToken) => {" \
"const captureStream = async (sourceToken) => {" 

mutate_case 2 "host.js assetUrl: tidy the trailing slash away, as path.join() would" \
  "$HOST" \
  "...AND A PATH ENDING IN \`/\` KEEPS ITS TRAILING SLASH" \
  -- "$HOST" \
"  const rel = String(relPath);" "  const rel = String(relPath).replace(/\/+$/, '');" 

mutate_case 3 "host.js assetUrl: drop the M1 containment guard" \
  "$HOST" \
  "...and a path that would escape the unit is REFUSED" \
  -- "$HOST" \
"  if (!url.startsWith(UNIT_BASE)) {" "  if (false) {" 

mutate_case 20 "host.js: resolve assets one directory above the unit" \
  "$HOST" \
  "assetUrl() RESOLVES INSIDE THE UNIT'S OWN BUNDLE|...and what it answers is FETCHABLE" \
  -- "$HOST" \
"const UNIT_BASE = new URL('../', import.meta.url).href;" \
"const UNIT_BASE = new URL('../../', import.meta.url).href;" 

mutate_case 4 "host.js modelBytes: hand over a VIEW instead of the whole buffer" \
  "$HOST" \
  "modelBytes() HANDS OVER ALL" \
  -- "$HOST" \
"  return { bytes, fromCache: false };" \
"  return { bytes: new Uint8Array(bytes.buffer, 0, bytes.length - 1), fromCache: false };" 

mutate_case 5 "host.js modelBytes: memoise the bytes" \
  "$HOST" \
  "...and a SECOND call hands over a SECOND buffer" \
  -- "$HOST" \
"export const modelBytes = async (onProgress = () => {}) => {
  const url = modelUrl();" \
"let __memo = null;
export const modelBytes = async (onProgress = () => {}) => {
  if (__memo) return __memo;
  const url = modelUrl();" \
  "$HOST" \
"  return { bytes, fromCache: false };" \
"  __memo = { bytes, fromCache: false };
  return __memo;" 

mutate_case 6 "host.js modelBytes: announce 'download' for a file that shipped in the installer" \
  "$HOST" \
  "...and it ANNOUNCES ITS PHASE BEFORE ANY BYTES MOVE" \
  -- "$HOST" \
"  onProgress('cache', 0, MODEL.bytes);" "  onProgress('download', 0, MODEL.bytes);" 

mutate_case 7 "host.js modelBytes: report fromCache: true beside the no-op clearModel" \
  "$HOST" \
  "modelCached() SAYS YES WITHOUT READING THE BYTES, AND clearModel() IS AN HONEST NO-OP" \
  -- "$HOST" \
"  return { bytes, fromCache: false };" "  return { bytes, fromCache: true };" 

mutate_case 8 "host.js captureStream: ask for \`audio: true\`, the Limitation-6 run" \
  "$HOST" \
  "THE CAPTURE THIS HOST HANDS THE ENGINE IS STEREO, 44100 AND UNPROCESSED" \
  -- "$HOST" \
"    audio: {
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
    }," "    audio: true," 

mutate_case 29 "host.js captureStream: leave the video track on the stream" \
  "$HOST" \
  "...and it carries ONE audio track and NO video track" \
  -- "$HOST" \
"    for (const t of stream.getVideoTracks()) { t.stop(); stream.removeTrack(t); }" \
"    for (const t of stream.getVideoTracks()) { t.stop(); }" 

mutate_case 9 "host.js captureStream: skip the claim" \
  "$HOST" \
  "A TOKEN NOBODY MINTED BUYS NOTHING" \
  -- "$HOST" \
"  const claim = await w.claimCapture(sourceToken);" \
"  const claim = { ok: true };" 

mutate_case 10 "host.js onTeardown: defer the engine's callback by a microtask" \
  "$HOST" \
  "onTeardown() REGISTERS THE CALLER'S OWN FUNCTION ON \`pagehide\`" \
  -- "$HOST" \
"export const onTeardown = (fn) => { addEventListener('pagehide', fn); };" \
"export const onTeardown = (fn) => { addEventListener('pagehide', () => Promise.resolve().then(fn)); };" 

mutate_case 11 "host.js createBackend: drop the hooks the unit passed" \
  "$HOST" \
  "createBackend FORWARDED THE UNIT'S HOOKS" \
  -- "$HOST" \
"export const createBackend = (hooks) => new WorkerBackend({ ...hooks, assetUrl });" \
"export const createBackend = () => new WorkerBackend({ assetUrl });" 

mutate_case 21 "host.js onMessage: guard on the wrong address" \
  "$HOST" \
  "the engine ANSWERS a message from this Host|DECK_PREPARE builds the ORT session" \
  -- "$HOST" \
"    if (!m || m.to !== ME) { stats.notMine++; return; }" \
"    if (!m || m.to !== BUS.deck) { stats.notMine++; return; }" 

mutate_case 22 "host.js captureStream: stop the audio track on the way out (R5, inverted)" \
  "$HOST" \
  "...and it carries SOUND" \
  -- "$HOST" \
"  return stream;
};" \
"  for (const t of stream.getAudioTracks()) t.stop();
  return stream;
};" 

mutate_case 12 "assets.js: drop COOP + COEP from every app:// response" \
  "src/main/assets.js" \
  "...and the page it answers from is CROSS-ORIGIN ISOLATED" \
  -- src/main/assets.js \
"  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
  'cross-origin-resource-policy': 'same-origin'," \
"  'cross-origin-resource-policy': 'same-origin'," 

mutate_case 23 "main.js: no /model/ root on the protocol handler" \
  "src/main/main.js" \
  "modelCached() SAYS YES WITHOUT READING THE BYTES|modelBytes() HANDS OVER ALL|DECK_PREPARE builds the ORT session" \
  -- src/main/main.js \
"  { prefix: '/model/', dir: MODEL_DIR }," "" 

mutate_case 24 "main.js: grant the CHROME view's frame instead of the source's" \
  "src/main/main.js" \
  "...and the grant named the SOURCE view's frame" \
  -- src/main/main.js \
"    () => (state.source && !state.source.webContents.isDestroyed() ? state.source.webContents.mainFrame : null)," \
"    () => (state.chrome && !state.chrome.webContents.isDestroyed() ? state.chrome.webContents.mainFrame : null)," 

mutate_case 25 "engine-messages: originate nothing at all" \
  "src/main/engine-messages.js" \
  "CAPTURE_START over the REAL path arms a real capture|the Host ORIGINATED CAPTURE_START|the Host ORIGINATED CAPTURE_STOP|the Host ORIGINATED DECK_PREPARE|DECK_PREPARE builds the ORT session|the AudioContext this Host's page opened is at 44100" \
  -- src/main/engine-messages.js \
"    const delivered = bus.originate(BUS.engine, msg);" \
"    const delivered = true;" 

mutate_case 26 "main.js: never put the engine on its address" \
  "src/main/main.js" \
  "...and every one of them was delivered" \
  -- src/main/main.js \
"  state.bus.register(BUS.engine, state.engineWin.webContents);" "" 

mutate_case 27 "the probe writes its report somewhere nobody looks" \
  "tools/gate/engine-host.mjs" \
  "the app launches from its real entry point and the engine probe writes a report" \
  -- tools/gate/engine-host.mjs \
"  fs.mkdirSync(outDir, { recursive: true });" \
"  outDir = outDir + '/nowhere'; fs.mkdirSync(outDir, { recursive: true });" 

# ==========================================================================
echo
if [ "${#ONLY[@]}" -eq 0 ]; then
  python3 "$HERE/coverage.py" "$OUT" || missed=$((missed + 1))
else
  echo "${C_Y}coverage NOT checked — a subset cannot make the claim that every assertion has been watched red${C_X}"
fi
echo
echo "${C_D}engine-host-mutations: ${C_X}${C_G}$caught caught${C_X}, ${C_R}$missed missed${C_X}, $ran run"
[ "$missed" -eq 0 ] || exit 1
