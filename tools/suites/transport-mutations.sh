#!/usr/bin/env bash
# Watch every assertion in `tools/suites/transport.mjs` go RED, one mutation at a
# time. AGENTS.md: "An assertion you did not watch fail is not evidence."
#
# WHAT THIS SCRIPT ASSERTS, AND WHY IT IS NOT JUST `! node transport.mjs`.
# A non-zero exit proves *something* went red, not that the intended thing did.
# The spike's own mutation runner shipped that bug and it was caught in review.
# So each case declares the assertion FRAGMENTS it must turn red, and this
# script:
#
#   1. runs the suite UNMUTATED FIRST and requires GREEN — a mutation runner that
#      is red before it mutates has proved nothing;
#   2. refuses to continue if the edit did not apply (the anchor text moved);
#   3. requires every expected fragment to appear on a FAIL line;
#   4. requires the run to be red at all (exit non-zero);
#   5. restores the file and verifies the restored bytes match.
#
# It also PRINTS every other assertion that went red in the same run without
# failing on it: a mutation with wide blast radius is information, and hiding it
# would make the table read narrower than the truth.
#
#   tools/suites/transport-mutations.sh              # all of them
#   tools/suites/transport-mutations.sh 4 7 11       # only these cases
#   tools/suites/transport-mutations.sh --static     # only the cases that need no launch
#
# STATIC CASES COST 0.3 s AND LIVE CASES COST ~70 s, because a live case is a
# real Electron launch under the shared browser mutex. A case declares which it
# is, and `--static` runs the cheap half — which is most of the L1 evidence.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$ROOT/out/transport-mutations"
rm -rf "$OUT"; mkdir -p "$OUT"
cd "$ROOT"
# THE MUTATION GUARD. Traps are the belt: this battery restores on INT, TERM and
# HUP, and `timeout` sends TERM — which is how a long battery is most likely to
# die and was the one way it did not clean up (stem-workbench#22). The SENTINEL
# is the braces, for `kill -9`, a crashed host and a full disk, where no trap
# runs at all: while a mutation is standing there is a file under
# `out/.mutating/` naming it, and every suite refuses to start while one is
# there. `tools/lib/tree-guard.mjs` is the long form.
MG_BATTERY='transport-mutations'; MG_ROOT="$ROOT"
. "$ROOT/tools/lib/mutation-guard.sh"
trap mg_on_signal INT TERM HUP

C_R=$'\033[31m'; C_G=$'\033[32m'; C_D=$'\033[2m'; C_X=$'\033[0m'
caught=0; missed=0; ran=0
ONLY=(); STATIC_ONLY=0
for a in "$@"; do
  if [ "$a" = "--static" ]; then STATIC_ONLY=1; else ONLY+=("$a"); fi
done

# `edit FILE OLD NEW` — exact, first occurrence, and a HARD ERROR if the anchor
# is not there. A mutation that silently did not apply is a green nobody earned.
edit() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path).read()
if old not in s:
    sys.stderr.write("ANCHOR NOT FOUND in %s:\n%s\n" % (path, old[:240]))
    sys.exit(3)
open(path, 'w').write(s.replace(old, new, 1))
PY
}

run_suite() {   # $1 = log path, $2 = 'static'|'live'
  if [ "$2" = static ]; then
    node tools/suites/transport.mjs --static >"$1" 2>&1
  else
    node tools/suites/transport.mjs >"$1" 2>&1
  fi
}

fails_of() { grep -E '^FAIL' "$1" || true; }

# `mutate_case N kind "label" "file[,file...]" "frag1|frag2" -- FILE OLD NEW [FILE OLD NEW ...]`
mutate_case() {
  local n="$1" kind="$2" label="$3" files="$4" expect="$5"; shift 5
  [ "$#" -ge 1 ] && [ "$1" = "--" ] && shift
  if [ "${#ONLY[@]}" -gt 0 ] && [[ ! " ${ONLY[*]} " =~ " $n " ]]; then return 0; fi
  if [ "$STATIC_ONLY" = 1 ] && [ "$kind" != static ]; then return 0; fi

  echo
  echo "${C_D}=== mutation $n ($kind) — $label${C_X}"
  ran=$((ran + 1))

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
  run_suite "$log" "$kind"; local code=$?

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
  echo "  ${C_D}$n_fail assertion(s) red in total · $(tail -1 "$log") · log out/transport-mutations/$n.log${C_X}"

  if [ "$ok" -eq 1 ]; then caught=$((caught + 1)); else missed=$((missed + 1)); fi
}

# ------------------------------------------------- 0. green before mutating
echo "${C_D}=== baseline — the suite must be GREEN before anything is broken${C_X}"
if [ "$STATIC_ONLY" = 1 ]; then run_suite "$OUT/baseline.log" static; else run_suite "$OUT/baseline.log" live; fi
bcode=$?
echo "  $(tail -1 "$OUT/baseline.log")"
if [ "$bcode" -ne 0 ]; then
  echo "${C_R}BASELINE IS RED${C_X} — fix that first. A mutation runner that is red before it mutates has proved nothing."
  fails_of "$OUT/baseline.log"; exit 2
fi

P=src/preload/youtube.cjs
D=src/main/drive.js
A=src/main/autonav.js
S=src/main/speed.js
T=src/main/transport.js
G=tools/gate/transport.mjs

# =========================================================================
# L1 — the four instruments
# =========================================================================
mutate_case 1 static "the preload reads currentSrc" "$P" \
  "every property it touches at all is on the enumerated allow-list|none of the names L1 forbids" -- \
  "$P" "const isSelfSeek = ()" "const _l1 = () => el && el.currentSrc;
const isSelfSeek = ()"

# THE AUDITOR'S OWN MUTATION, verbatim. Two lines, and before this repair every
# one of the three L1 instruments reported green over them: `transport: 63
# passed, 0 failed`, with the allow-list row saying "44 distinct properties, all
# listed". A member scan that requires a literal dot cannot see a bracket, the
# blacklist runs after string literals have been blanked, and reading a property
# makes no request for the runtime witness to see.
mutate_case 1b static "the preload reads currentSrc and buffered THROUGH A STRING KEY" "$P" \
  "it contains NO COMPUTED MEMBER ACCESS at all" -- \
  "$P" "const isSelfSeek = ()" "const leakUrl = () => (el ? el['currentSrc'] : null);
const leakBuffered = () => (el ? el['buffered'] : null);
const isSelfSeek = ()"

mutate_case 2 static "the preload writes a fourth property" "$P" \
  "COMPLETE member-write set is the closed write set" -- \
  "$P" "  if (el.muted) el.muted = false;" "  if (el.muted) el.muted = false;
  el.volume = 1;"

# ONLY THE LIVE HALF, and the reason is worth a line. The static enumeration
# asks which properties the FILE writes anywhere, and `restoreVideo()` writes
# `preservesPitch` too — legitimately, to put the page back at Chrome's default.
# So deleting `driveRate`'s key-lock write leaves the static set complete and
# only the element can tell. Expecting the static assertion here was recorded
# MISSED on the first battery; it was the expectation that was wrong.
mutate_case 3 live "the key-lock write is deleted" "$P" \
  "the key-lock policy lands with the rate" -- \
  "$P" "  if (el.preservesPitch !== cfg.keyLock) el.preservesPitch = cfg.keyLock;" "  // mutation: the key-lock write is gone"

mutate_case 4 static "play() appears in the preload" "$P" \
  "never appears in the preload" -- \
  "$P" "    if (el && !el.paused) el.pause();" "    if (el && !el.paused) el.play();"

# =========================================================================
# The event lists, pinned against the reference Host
# =========================================================================
mutate_case 5 live "seeking is dropped from JUMP_EVENTS" "$P" \
  "the same JUMP_EVENTS the reference Host does|a seek the PAGE made IS one" -- \
  "$P" "const JUMP_EVENTS = ['seeking', 'emptied'];" "const JUMP_EVENTS = ['emptied'];"

mutate_case 6 static "ratechange is added to JUMP_EVENTS" "$P" \
  "the same JUMP_EVENTS the reference Host does|a rate change is not a content jump" -- \
  "$P" "const JUMP_EVENTS = ['seeking', 'emptied'];" "const JUMP_EVENTS = ['seeking', 'emptied', 'ratechange'];"

# =========================================================================
# The jump rule — the page's event, never the user's consent
# =========================================================================
mutate_case 7 live "our own corrective seek is reported as a content jump" "$P" \
  "our own corrective seek is NOT a content jump" -- \
  "$P" "const isSelfSeek = () => selfSeeking !== 0 && Date.now() - selfSeeking < SELF_SEEK_TTL_MS;" \
       "const isSelfSeek = () => false;"

# =========================================================================
# The closed write set, at the main-process layer
# =========================================================================
mutate_case 8 static "filterDrive spreads the patch instead of naming three fields" "$D" \
  "drive filters to the closed write set|a field of the wrong type is DROPPED" -- \
  "$D" "  const out = {};" "  const out = { ...p };"

# BOTH LAYERS, AND THAT IS THE POINT. Case 8 spreads the patch in `filterDrive`
# and the element is UNMARKED, because the preload names its three fields too —
# so the live assertion stayed green and this case was recorded MISSED on the
# first battery. It was the EXPECTATION that was wrong, not the assertion: the
# live claim is about defence in depth, and a claim about three layers cannot be
# falsified by breaking one. Breaking two is what it takes, and the two edits
# below are exactly the pair a "tidy up the duplication" change would make.
mutate_case 9 live "both filters spread the caller's patch, so \`src\` reaches the element" "$D,$P" \
  "the four fields outside the closed write set left no trace" -- \
  "$D" "  if (typeof p.muted === 'boolean') out.muted = p.muted;" \
       "  Object.assign(out, p);
  if (typeof p.muted === 'boolean') out.muted = p.muted;" \
  "$P" "  if (typeof cmd.muted === 'boolean' && el.muted !== cmd.muted) { el.muted = cmd.muted; nWrites++; }" \
       "  Object.assign(el, cmd);
  if (typeof cmd.muted === 'boolean' && el.muted !== cmd.muted) { el.muted = cmd.muted; nWrites++; }"

# =========================================================================
# The entry-point rule — the reason decides, not the value
# =========================================================================
mutate_case 10 static "every event becomes a poll" "$D" \
  "event -> speed reason mapping is speed.js's entry-point rule|WRITE on a remount and YIELD on a ratechange" -- \
  "$D" "  if (event === 'loadedmetadata') return 'remount';" "  if (event === 'loadedmetadata') return 'poll';"

mutate_case 11 live "a ratechange re-asserts instead of yielding" "$D" \
  "the page's OWN speed menu is yielded to, not fought" -- \
  "$D" "  if (event === 'ratechange') return 'ratechange';" "  if (event === 'ratechange') return 'remount';"

# =========================================================================
# The clamp, and the pin that keeps it one clamp
# =========================================================================
# The realistic shape of this defect is not a stray local — it is a Host that
# stopped executing the vendored file and re-typed its numbers, which is exactly
# what makes ui/embed-state.js's ladder pin a lie.
mutate_case 12 static "the Host re-types the vendored range instead of executing it" "$S" \
  "no file under src/ declares a speed range of its own" -- \
  "$S" "export const { SPEED_MIN, SPEED_MAX, SPEED_EPS, SPEED_KEY_LOCK, AD_SHOWING_SEL, resolveSpeed, speedPlan } = SPEED;" \
       "export const SPEED_MIN = 0.5;
export const SPEED_MAX = 2.0;
export const { SPEED_EPS, SPEED_KEY_LOCK, AD_SHOWING_SEL, resolveSpeed, speedPlan } = SPEED;"

mutate_case 13 live "the ad-end edge is never promoted" "$S" \
  "the ad-END edge puts the user's rate back" -- \
  "$S" "    const r = (reason !== 'set' && lastAd === true && ad === false) ? 'ad-end' : reason;" \
       "    const r = reason;"

# =========================================================================
# Autoplay-next
# =========================================================================
mutate_case 14 static "the preferences key drifts from the unit's" "$A" \
  "the preferences key is ONE key" -- \
  "$A" "export const PREFS_KEY = 'prefs';" "export const PREFS_KEY = 'preferences';"

mutate_case 15 live "an absent preference stops meaning suppress" "$A" \
  "absent means SUPPRESS|the page ships autoplay-next ON and the Host takes it" -- \
  "$A" "  return !(prefs && prefs.autoplayNext === true);" "  return !!(prefs && prefs.autoplayNext === false);"

mutate_case 16 live "a control that cannot be read is treated as fine" "$A" \
  "every way the toggle can fail produces a NAMED state|a control that is not there is" -- \
  "$A" "  if (!found || checked === null) {" "  if (false) {"

mutate_case 17 live "the click budget is removed" "$A" \
  "a toggle that ignores its click is reported" -- \
  "$A" "  const MAX_CLICKS = 3;" "  const MAX_CLICKS = 10000;"

mutate_case 18 static "the toggle selector goes back to matching the button" "$A" \
  "matches on the ARIA contract, not on the class alone" -- \
  "$A" "export const AUTONAV_TOGGLE_SEL = '.ytp-right-controls [class*=\"autonav-toggle\"][aria-checked],'
  + ' [class*=\"ytp-autonav-toggle\"][aria-checked]';" \
       "export const AUTONAV_TOGGLE_SEL = 'button.ytp-autonav-toggle-button';"

# =========================================================================
# The keyboard — the product ruling, both directions
# =========================================================================
mutate_case 19 live "the typing filter is removed" "$P" \
  "typed into a TEXT FIELD is the page's" -- \
  "$P" "  if (isTypingTarget(ev.target)) return;" "  // mutation: the typing filter is gone"

mutate_case 20 live "keys are taken whether or not a deck is armed" "$P" \
  "with no deck armed, a claimed digit belongs to the page" -- \
  "$P" "  if (!deckArmed) return;" "  // mutation: the armed gate is gone"

mutate_case 21 live "every key is taken, not only the claimed ones" "$P" \
  "an UNCLAIMED key stays the page's" -- \
  "$P" "  if (!deckKeys.has(ev.code) && ev.key !== '?') return;" "  // mutation: the claim list is ignored"

# =========================================================================
# The single-page navigation, and the tick that carries it
# =========================================================================
mutate_case 22 live "the tick is removed — only the site's own event is left" "$P" \
  "a navigation with NO announcement is noticed anyway" -- \
  "$P" "setInterval(() => {
  nTicks++;" "setInterval(() => {
  if (nTicks >= 0) { nTicks++; return; }
  nTicks++;"

mutate_case 23 live "a source swap keeps the user's speed claim" "$T" \
  "speed claim is RELEASED with the video" -- \
  "$T" "        speed.dropClaim();
        autonav.reassert();" "        autonav.reassert();"

# =========================================================================
# `ready` owes a re-send
# =========================================================================
mutate_case 24 live "resend() stops re-sending the speed and autonav reports" "$T" \
  "puts all three back on the wire" -- \
  "$T" "      speed.resend();
      autonav.resend();" "      // mutation: the re-send is gone"

# =========================================================================
# THE INSTRUMENT ITSELF — "nothing happened" is also what a dead tap looks like
# =========================================================================
mutate_case 25 live "the gate's tap never attaches" "$G" \
  "the gate was actually listening to the transport" -- \
  "$G" "  if (log.subscribed || !state.transport) return false;" "  if (true) return false;"

echo
echo "${C_D}=== ${ran} case(s): ${caught} caught, ${missed} missed${C_X}"
[ "$missed" -eq 0 ] || exit 1
