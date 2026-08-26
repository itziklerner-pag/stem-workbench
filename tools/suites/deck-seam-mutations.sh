#!/usr/bin/env bash
# Watch every assertion in `tools/suites/deck-seam.mjs` go RED, one mutation at a
# time. AGENTS.md: "An assertion you did not watch fail is not evidence."
#
# Same shape as `shell-mutations.sh`, and for the same reason: a non-zero exit
# proves that SOMETHING went red, not that the intended thing did — the spike's
# own mutation runner shipped exactly that bug and review caught it. So each case
# declares the assertion NAMES it must turn red, and this script
#
#   1. runs the suite UNMUTATED FIRST and requires GREEN;
#   2. refuses to continue if an edit did not apply (the anchor text moved);
#   3. requires every expected name to appear on a FAIL line;
#   4. requires the run to be red at all;
#   5. restores the file and verifies the restored bytes against the backup.
#
# `tools/suites/coverage.py` is run at the end of a FULL battery and is the claim
# worth making: not "45 mutations were caught" but "no assertion has gone
# unbroken". An assertion no mutation has ever turned red is an assumption
# wearing an `ok`, and it is invisible from inside a green run.
#
#   tools/suites/deck-seam-mutations.sh              # every case (~30 s)
#   tools/suites/deck-seam-mutations.sh 9 11 28      # only these
#   ALLOW_UNIT_EDITS=1 tools/suites/deck-seam-mutations.sh 27 33 38
#
# ---------------------------------------------------------------------------
# THREE CASES EDIT A VENDORED UNIT FILE, AND THEY ARE OPT-IN
# ---------------------------------------------------------------------------
# Cases 27, 33 and 38 are the suite's INSTRUMENT CHECKS: they assert that the
# unit still behaves the way the assertions above them depend on — `chordLabel()`
# draws a chord, `speedGate()` ungreys on the literal `'ok'`, `NAV_MSG` paints
# for exactly three words. The only thing that can make one of those false is a
# change to the unit, which is what happens at a TAG BUMP — so the only honest
# way to watch them red is to edit a vendored file, briefly, and put it back.
#
# They are behind `ALLOW_UNIT_EDITS=1` because rule V1 is that the unit is never
# edited, `vendor-intact` is the gate that says so, and a script that edits the
# unit by default on a machine where other work is running is a red somebody else
# has to debug. Each case restores within the same second and verifies the bytes;
# run `bash tools/vendor-unit.sh --check` afterwards, which this script does for
# you when it has touched one.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$ROOT/out/deck-seam-mutations"
UNIT="$ROOT/vendor/stem-splitter-live/extension"
rm -rf "$OUT"; mkdir -p "$OUT"
cd "$ROOT"

C_R=$'\033[31m'; C_G=$'\033[32m'; C_D=$'\033[2m'; C_X=$'\033[0m'
caught=0; missed=0; ran=0; touched_unit=0
ALLOW_UNIT_EDITS="${ALLOW_UNIT_EDITS:-0}"

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

run_suite() { node tools/suites/deck-seam.mjs >"$1" 2>&1; }
fails_of() { grep -E '^FAIL' "$1" || true; }

ONLY=("$@")

# `M <n> <label> <file> <old> <new> <expect1|expect2…>`
M() {
  local n="$1" label="$2" file="$3" old="$4" new="$5" expect="$6"
  if [ "${#ONLY[@]}" -gt 0 ] && [[ ! " ${ONLY[*]} " =~ " $n " ]]; then return 0; fi
  case "$file" in
    vendor/*)
      if [ "$ALLOW_UNIT_EDITS" != "1" ]; then
        case "$file" in
          */ui/host.js) : ;;   # the HOLE is ours, not the unit — always allowed
          *) echo "${C_D}=== mutation $n — $label${C_X}"
             echo "  ${C_D}skipped: edits a vendored UNIT file; re-run with ALLOW_UNIT_EDITS=1${C_X}"
             return 0 ;;
        esac
      else
        case "$file" in */ui/host.js) : ;; *) touched_unit=1 ;; esac
      fi ;;
  esac

  echo
  echo "${C_D}=== mutation $n — $label${C_X}"
  ran=$((ran + 1))
  local bak="$OUT/$n.$(basename "$file").bak"
  cp "$ROOT/$file" "$bak"

  if ! edit "$ROOT/$file" "$old" "$new"; then
    echo "  ${C_R}DID NOT APPLY${C_X} — the anchor in $file has moved. Fix this script."
    cp "$bak" "$ROOT/$file"; missed=$((missed + 1)); return 0
  fi

  local log="$OUT/$n.log"
  run_suite "$log"; local code=$?
  cp "$bak" "$ROOT/$file"
  if ! cmp -s "$ROOT/$file" "$bak"; then
    echo "  ${C_R}RESTORE FAILED for $file${C_X}"; missed=$((missed + 1)); return 0
  fi

  local ok=1 w
  local IFS='|'; local -a wants=($expect); unset IFS
  for w in "${wants[@]}"; do
    if fails_of "$log" | grep -qF -- "$w"; then
      echo "  ${C_G}red${C_X}    $w"
    else
      echo "  ${C_R}MISS${C_X}   $w  ${C_D}— expected this assertion to fail and it did not${C_X}"
      ok=0
    fi
  done
  [ "$code" -eq 0 ] && { echo "  ${C_R}MISS${C_X}   the suite exited 0 under the mutation"; ok=0; }
  echo "  ${C_D}$(fails_of "$log" | wc -l | tr -d ' ') assertion(s) red in total · $(tail -1 "$log")${C_X}"
  if [ "$ok" -eq 1 ]; then caught=$((caught + 1)); else missed=$((missed + 1)); fi
}

H='vendor/stem-splitter-live/extension/ui/host.js'
S='src/main/storage.js'
K='src/main/keys.js'
D='src/main/deck-host.js'
B='src/main/bus.js'
ES='vendor/stem-splitter-live/extension/ui/embed-state.js'
EJ='vendor/stem-splitter-live/extension/ui/embed.js'

echo "${C_D}=== baseline — the suite must be GREEN before anything is broken${C_X}"
if ! run_suite "$OUT/baseline.log"; then
  echo "${C_R}BASELINE IS RED${C_X} — nothing below would prove anything. Last lines:"
  tail -20 "$OUT/baseline.log"; exit 2
fi
echo "  ${C_G}green${C_X}  $(tail -1 "$OUT/baseline.log")"

# ===================================================== the hole: loading at all
M 1 "the module throws at import again, the way it used to" "$H" \
  "const bridge = () => {
  const w = globalThis.window;
  return (w && w[BRIDGE]) || INERT;
};" \
  "const bridge = () => {
  const w = globalThis.window;
  const b = w && w[BRIDGE];
  if (!b) throw new Error('DeckHost: no preload bridge');
  return b;
};
const AT_IMPORT = bridge();" \
  'importing the Host is INERT'

M 2 '"I could not ask" collapses into "this Host has no player"' "$H" \
  '  transport: HOSTED === false ? null : {' \
  '  transport: HOSTED !== true ? null : {' \
  'transport` is still a NAMESPACE|reads as "could not ask"'

M 46 "a duty with no bridge throws instead of announcing itself" "$H" \
  "  send: () => noBridge('send')," \
  '  send: () => { throw new Error("DeckHost: no bridge"); },' \
  'ANNOUNCES ITSELF ONCE on the console'

M 47 "a duty with no bridge says nothing at all" "$H" \
  '  if (announcedMissingBridge) return undefined;
  announcedMissingBridge = true;' \
  '  if (announcedMissingBridge || true) return undefined;
  announcedMissingBridge = true;' \
  'ANNOUNCES ITSELF ONCE on the console'

M 48 "a `hosted` that is not a boolean is coerced to false" "$H" \
  "  return typeof b.hosted === 'boolean' ? b.hosted : null;" \
  '  return b.hosted === true;' \
  'reads as "could not ask"'

# ============================================================ the export list
M 3 "one flat duty loses its name" "$H" \
  '  onStorageChanged: (area, key, fn) => {' '  onStorageChangd: (area, key, fn) => {' \
  'assertHost accepts the SHIPPED ui/host.js|all fourteen members'

M 4 "page loses close()" "$H" \
  "    close: () => { bridge().pageSend({ c: 'close' }); }," \
  "    closed: () => { bridge().pageSend({ c: 'close' }); }," \
  'on host.page, against'

M 5 "transport loses release()" "$H" \
  "    release: () => { bridge().pageSend({ c: 'release' }); }," \
  "    released: () => { bridge().pageSend({ c: 'release' }); }," \
  'host.transport satisfies all six'

M 6 "a Host with no player omits the answer instead of spelling null" "$H" \
  '  transport: HOSTED === false ? null : {' \
  '  transport: HOSTED === false ? undefined : {' \
  'SPELLS `transport: null`'

M 7 "a duty becomes a method that needs its \`this\`" "$H" \
  '  storageSet: (area, key, value) => {
    assertArea(area);' \
  '  storageSet(area, key, value) {
    if (this.nothing) return;
    assertArea(area);' \
  'called UNBOUND'

# ================================================================ the outgoing wire
M 9 "send stamps one extra field onto the envelope" "$H" \
  '  send: (msg) => { bridge().send(msg); },' \
  '  send: (msg) => { bridge().send({ ...msg, hostSaw: true }); },' \
  'send carries the envelope VERBATIM'

M 10 "send starts returning something a call site could await" "$H" \
  '  send: (msg) => { bridge().send(msg); },' \
  '  send: (msg) => { bridge().send(msg); return true; },' \
  'returns undefined, so no call site'

M 11 "send binds the bridge at import instead of at call time" "$H" \
  '  send: (msg) => { bridge().send(msg); },' \
  '  send: ((b) => (msg) => { b.send(msg); })(bridge()),' \
  'RESOLVES THE BRIDGE AT CALL TIME'

# ================================================================ the incoming wire
M 12 "onMessage registers no listener at all" "$H" \
  '    bridge().onMessage((m) => { if (m && m.to === ME) fn(m); });' \
  '    if (fn === undefined) bridge().onMessage((m) => { if (m && m.to === ME) fn(m); });' \
  'INSTRUMENT CHECK: onMessage registered exactly one listener'

M 13 "the address guard goes" "$H" \
  '    bridge().onMessage((m) => { if (m && m.to === ME) fn(m); });' \
  '    bridge().onMessage((m) => { if (m) fn(m); });' \
  'delivers ONLY what is addressed to this context'

M 14 "the envelope is re-wrapped on the way in" "$H" \
  '    bridge().onMessage((m) => { if (m && m.to === ME) fn(m); });' \
  '    bridge().onMessage((m) => { if (m && m.to === ME) fn({ ...m }); });' \
  'hands the deck the SAME object'

M 15 "what the deck returns is forwarded to the transport" "$H" \
  '    bridge().onMessage((m) => { if (m && m.to === ME) fn(m); });' \
  '    bridge().onMessage((m) => (m && m.to === ME ? fn(m) : undefined));' \
  'what the deck returns is DROPPED'

# ==================================================================== storage
M 16 "storageGet hard-codes one area" "$H" \
  '    const r = await bridge().storageGet(area, key);' \
  "    const r = await bridge().storageGet('local', key);" \
  'READS THE AREA IT WAS GIVEN'

M 17 "an absent key stops answering null" "$H" \
  '    return r.value === undefined ? null : r.value;' \
  '    return r.value || {};' \
  'ABSENT RESOLVES null'

M 18 "unreadable is folded into absent" "$H" \
  '    if (!r || r.ok !== true) {' '    if (false) {' \
  'UNREADABLE store REJECTS'

M 19 "storageGet stops refusing a third area" "$H" \
  '  storageGet: async (area, key) => {
    assertArea(area);' \
  '  storageGet: async (area, key) => {' \
  'REJECTS a third storage area'

M 20 "storageSet stops refusing a third area" "$H" \
  '  storageSet: (area, key, value) => {
    assertArea(area);' \
  '  storageSet: (area, key, value) => {' \
  'storageSet and onStorageChanged THROW at the call site'

M 21 "storageSet drops the value on the floor" "$H" \
  '    bridge().storageSet(area, key, value);' \
  '    bridge().storageSet(area, key);' \
  'storageSet puts the area, the key and the value on the wire'

M 22 "onStorageChanged never asks main to watch the key" "$H" \
  '    bridge().storageWatch(area, key);' \
  '    if (area === undefined) bridge().storageWatch(area, key);' \
  'ASKS THE HOST TO WATCH'

M 23 "the area and key filter goes" "$H" \
  '      if (!ch || ch.area !== area || ch.key !== key) return;' \
  '      if (!ch) return;' \
  'AREA AND KEY FILTER IS'

# ====================================================================== chord
M 24 "armShortcut renders the chord instead of answering it raw" "$H" \
  "    return typeof accel === 'string' && accel !== '' ? accel : null;" \
  "    return typeof accel === 'string' && accel !== '' ? accel.replace('Ctrl', '\u2303') : null;" \
  'armShortcut answers with the accelerator RAW'

M 25 "the Host binds Electron's portable spelling" "$K" \
  "export const ARM_ACCEL = process.platform === 'darwin' ? 'Command+Shift+A' : 'Ctrl+Shift+A';" \
  "export const ARM_ACCEL = 'CommandOrControl+Shift+A';" \
  "chord this Host binds is inside chordLabel()'s vocabulary"

M 26 "an unbound chord answers an empty key cap" "$H" \
  "    return typeof accel === 'string' && accel !== '' ? accel : null;" \
  "    return typeof accel === 'string' ? accel : null;" \
  'an unbound chord RESOLVES null'

M 27 "chordLabel stops answering null for no chord (a tag bump)" "$ES" \
  "  if (s === '') return null;" "  if (s === '') return { text: '', say: '' };" \
  'INSTRUMENT CHECK: chordLabel()'

# ================================================================== transport
M 28 "drive spreads the caller's patch instead of naming three fields" "$H" \
  "      const cmd = { c: 'drive' };" \
  "      const cmd = { c: 'drive', ...p };" \
  "drive's WRITE SET IS CLOSED"

M 29 "drive coerces a value of the wrong type instead of dropping it" "$H" \
  "      if (typeof p.playbackRate === 'number' && Number.isFinite(p.playbackRate)) cmd.playbackRate = p.playbackRate;" \
  '      if (p.playbackRate !== undefined) cmd.playbackRate = p.playbackRate;' \
  'a value of the wrong type is dropped rather than coerced'

M 30 "release asks for something the other end does not answer" "$H" \
  "    release: () => { bridge().pageSend({ c: 'release' }); }," \
  "    release: () => { bridge().pageSend({ c: 'restore' }); }," \
  'release asks for the player back'

M 31 "requestSpeed filters the user's value instead of reporting the refusal" "$H" \
  "    requestSpeed: (rate) => { bridge().pageSend({ c: 'requestSpeed', rate }); }," \
  "    requestSpeed: (rate) => { if (Number.isFinite(rate) && rate >= 0.5 && rate <= 2) bridge().pageSend({ c: 'requestSpeed', rate }); }," \
  'requestSpeed carries the USER'

M 32 "every event is fanned to every handler" "$H" \
  '    const h = inbound.get(msg.t);
    if (h) h(msg);' \
  '    for (const h of inbound.values()) h(msg);' \
  'PUSH registrations, and each type reaches only its own handler'

M 33 "speedGate ungreys on a second word (a tag bump)" "$ES" \
  "  if (v.state === 'ok') return { ok: true, why: null, text: '' };" \
  "  if (v.state === 'ok' || v.state === 'playing') return { ok: true, why: null, text: '' };" \
  'INSTRUMENT CHECK: the unit ungreys the speed control'

# ======================================================================= page
M 34 "claimKeys sends the armed flag and forgets the codes" "$H" \
  "      bridge().pageSend({ c: 'claimKeys', armed: c.armed === true, keys: Array.isArray(c.keys) ? c.keys : [] });" \
  "      bridge().pageSend({ c: 'claimKeys', armed: c.armed === true, keys: [] });" \
  'claimKeys sends BOTH facts'

M 35 "a malformed claim is read as armed" "$H" \
  "      bridge().pageSend({ c: 'claimKeys', armed: c.armed === true, keys: Array.isArray(c.keys) ? c.keys : [] });" \
  "      bridge().pageSend({ c: 'claimKeys', armed: !!c.armed, keys: Array.isArray(c.keys) ? c.keys : [] });" \
  'malformed claim degrades to DISARMED'

M 36 "setHeight names a message the other end does not know" "$H" \
  "    setHeight: (px) => { bridge().pageSend({ c: 'height', px }); }," \
  "    setHeight: (px) => { bridge().pageSend({ c: 'setHeight', px }); }," \
  'setHeight, ready and close each put exactly one message'

M 37 "onAutonav listens for a type nothing sends" "$H" \
  "    onAutonav: on('autonav')," "    onAutonav: on('nav')," \
  'onKey and onAutonav receive'

M 38 "the deck renames one of its three failure words (a tag bump)" "$EJ" \
  '  stuck: ' '  wedged: ' \
  'INSTRUMENT CHECK: the deck paints a banner for exactly'

# ======================================================= the Host's own state
M 39 "a session write lands in the map that is persisted" "$S" \
  "      mem[area].set(key, value);
      stats.writes++;
      if (area === 'local') {" \
  "      mem.local.set(key, value);
      stats.writes++;
      if (true) {" \
  'LOCAL area outlives the process and the SESSION area does not'

# The two cases below arrived with the two assertions they watch, when
# `deck-host.mjs` was cut down to its launch half and its main-store claims moved
# here. A claim that moves without its mutation is a claim that stopped being
# evidence.
M 39a "a fresh store answers undefined where it should answer null" "$S" \
  '      return m.has(key) ? m.get(key) : null;' \
  '      return m.get(key);' \
  'FRESH profile answers null in both areas'

M 39b "main's change feed fires for every key it holds" "$S" \
  '      const set = feeds.get(feedKey(area, key));
      if (set) for (const fn of [...set]) { stats.changes++; fn(value); }' \
  '      for (const set of feeds.values()) for (const fn of [...set]) { stats.changes++; fn(value); }' \
  "main's change feed fires for the area and key it was given"

M 40 "an unreadable local file is read as an empty one" "$S" \
  '      localUnreadable = new Error(`storage: ${localFile} exists and could not be read `' \
  '      localUnreadable = null || new Error(`storage: x `' \
  'PRESENT AND UNREADABLE throws on read'

M 41 "main's store stops refusing a third area" "$S" \
  '  if (!AREAS.includes(area)) {' '  if (false) {' \
  "main's store refuses a third area"

M 42 "keys are taken whether or not a deck is armed" "$K" \
  '  if (!claim || claim.armed !== true) return false;' '  if (!claim) return false;' \
  'key router takes a key only while a deck is armed'

M 43 "one refusal raises a code the deck cannot dismiss" "$D" \
  "  NO_SOURCE: { code: ARM_FAILED," "  NO_SOURCE: { code: 'NO_SOURCE'," \
  "member of the unit's CLOSED ARM_CODES set"

M 44 "the Host stops consulting the unit's ARM_CODES" "$D" \
  "import { ARM_CODES as DECK_ARM_CODES } from '../../vendor/stem-splitter-live/extension/ui/audio-math.js';" \
  "const DECK_ARM_CODES = new Set(['ARM_FAILED']);" \
  'the Host imports that set and refuses a code outside it'

M 45 "the addresses become a second copy in this repo" "$B" \
  "export { BUS } from '../../vendor/stem-splitter-live/extension/shared/host.js';" \
  "export const BUS2 = Object.freeze({ engine: 'off', deck: 'ui', host: 'sw' });" \
  "main routes on the unit's OWN addresses"

# ==========================================================================
echo
echo "${C_D}=== restored tree — the suite must be GREEN again${C_X}"
if run_suite "$OUT/restored.log"; then
  echo "  ${C_G}green${C_X}  $(tail -1 "$OUT/restored.log")"
else
  echo "  ${C_R}THE TREE DID NOT COME BACK${C_X} — a restore failed. See out/deck-seam-mutations/restored.log"
  tail -20 "$OUT/restored.log"; missed=$((missed + 1))
fi

if [ "$touched_unit" = 1 ]; then
  echo
  echo "${C_D}=== a vendored unit file was edited and restored — proving it, with the gate that owns the claim${C_X}"
  bash tools/vendor-unit.sh --check || missed=$((missed + 1))
fi

echo
if [ "${#ONLY[@]}" -eq 0 ] && [ "$ALLOW_UNIT_EDITS" = "1" ]; then
  python3 tools/suites/coverage.py "$OUT" || missed=$((missed + 1))
else
  echo "${C_D}coverage is only claimed after a FULL battery (ALLOW_UNIT_EDITS=1, no case list) — a subset cannot make it${C_X}"
fi

echo
echo "deck-seam-mutations: $caught caught, $missed missed, of $ran run"
[ "$missed" -eq 0 ]
