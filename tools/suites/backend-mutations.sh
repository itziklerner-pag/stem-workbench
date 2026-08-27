#!/usr/bin/env bash
# Watch every assertion in `tools/suites/backend.mjs` go RED, one mutation at a
# time. AGENTS.md: "An assertion you did not watch fail is not evidence."
#
# Same shape as `deck-seam-mutations.sh`, and for the same reason: a non-zero
# exit proves that SOMETHING went red, not that the intended thing did. So each
# case declares the assertion NAMES it must turn red, and this script
#
#   1. runs the suite UNMUTATED FIRST and requires GREEN;
#   2. refuses to continue if an edit did not apply (the anchor text moved);
#   3. requires every expected name to appear on a FAIL line;
#   4. requires the run to be red at all;
#   5. restores the file and verifies the restored bytes against the backup.
#
# `tools/suites/coverage.py` runs at the end of a FULL battery and is the claim
# worth making: not "n mutations were caught" but "no assertion has gone
# unbroken".
#
#   tools/suites/backend-mutations.sh           # every case
#   tools/suites/backend-mutations.sh 3 11 22   # only these
#
# ---------------------------------------------------------------------------
# ONE CASE EDITS A FILE UNDER vendor/, AND IT IS ALLOWED
# ---------------------------------------------------------------------------
# Cases 22-24 edit `vendor/…/offscreen/host.js`, which is a HOLE — one of the
# exactly two paths `vendor/.pin`'s `ours` array declares as this repository's
# rather than the unit's. Rule V1 is about UNIT files; `vendor-intact` asserts
# that distinction on every run and stays green across these cases. No case here
# touches a unit file, so there is no `ALLOW_UNIT_EDITS` gate.
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
OUT="$ROOT/out/backend-mutations"
cd "$ROOT"
MG_BATTERY='backend-mutations'; MG_ROOT="$ROOT"
. "$ROOT/tools/lib/mutation-guard.sh"
trap mg_on_signal INT TERM HUP

mg_begin
rm -rf "$OUT"; mkdir -p "$OUT"   # AFTER the marker: a run refused here has wiped nothing
C_R=$'\033[31m'; C_G=$'\033[32m'; C_D=$'\033[2m'; C_X=$'\033[0m'
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

run_suite() { timeout 120 node tools/suites/backend.mjs >"$1" 2>&1; }
fails_of() { grep -E '^FAIL' "$1" || true; }

ONLY=("$@")

M() {
  local n="$1" label="$2" file="$3" old="$4" new="$5" expect="$6"
  if [ "${#ONLY[@]}" -gt 0 ] && [[ ! " ${ONLY[*]} " =~ " $n " ]]; then return 0; fi
  echo
  echo "${C_D}=== mutation $n — $label${C_X}"
  ran=$((ran + 1))
  local bak="$OUT/$n.$(basename "$file").bak"
  cp "$ROOT/$file" "$bak"
  mg_claim "$n" "$file=$bak"
  if ! edit "$ROOT/$file" "$old" "$new"; then
    echo "  ${C_R}DID NOT APPLY${C_X} — the anchor in $file has moved. Fix this script."
    cp "$bak" "$ROOT/$file"; mg_release "$n"; missed=$((missed + 1)); return 0
  fi
  local log="$OUT/$n.log"
  run_suite "$log"; local code=$?
  cp "$bak" "$ROOT/$file"
  if ! cmp -s "$ROOT/$file" "$bak"; then
    echo "  ${C_R}RESTORE FAILED for $file${C_X}"; missed=$((missed + 1)); return 0
  fi
  mg_release "$n"
  local ok=1 w
  local IFS='|'; local -a wants=($expect); unset IFS
  for w in "${wants[@]}"; do
    if fails_of "$log" | grep -qF -- "$w"; then echo "  ${C_G}red${C_X}    $w"
    else echo "  ${C_R}MISS${C_X}   $w  ${C_D}— expected this assertion to fail and it did not${C_X}"; ok=0; fi
  done
  [ "$code" -eq 0 ] && { echo "  ${C_R}MISS${C_X}   the suite exited 0 under the mutation"; ok=0; }
  echo "  ${C_D}$(fails_of "$log" | wc -l | tr -d ' ') assertion(s) red in total · $(tail -1 "$log")${C_X}"
  if [ "$ok" -eq 1 ]; then caught=$((caught + 1)); else missed=$((missed + 1)); fi
}

B='src/main/backend.js'
N='src/renderer/native-backend.js'
C='src/utility/inference-core.js'
U='src/utility/inference.js'
E='src/renderer/engine-boot.js'
H='vendor/stem-splitter-live/extension/offscreen/host.js'

echo "${C_D}=== baseline — the suite must be GREEN before anything is broken${C_X}"
if ! run_suite "$OUT/baseline.log"; then
  echo "${C_R}BASELINE IS RED${C_X} — nothing below would prove anything. Last lines:"
  tail -20 "$OUT/baseline.log"; exit 2
fi
echo "  ${C_G}green${C_X}  $(tail -1 "$OUT/baseline.log")"

# ================================================== §1 the selection table
M 1 "chooseBackend: invert the 'the user asked for the worker' gate" "$B" \
  "  if (f.preference === 'worker') return worker('the ORT worker backend was asked for');" \
  "  if (f.preference !== 'worker') return worker('the ORT worker backend was asked for');" \
  "selection row 1|selection row 2|selection row 3"

M 2 "chooseBackend: delete the platform gate — the negative control's own line" "$B" \
  "  if (!nativeIsPossible(f.platform, f.arch)) {
    return worker(\`the native backend is macOS on Apple Silicon only — this is \${f.platform}/\${f.arch}\`);
  }" \
  "  if (false) {
    return worker(\`the native backend is macOS on Apple Silicon only — this is \${f.platform}/\${f.arch}\`);
  }" \
  "a probe that claims \`ok\` on a platform that cannot run it is still refused"

M 3 "chooseBackend: forget that a failed backend is sticky for the session" "$B" \
  "  if (f.degraded) {" "  if (false && f.degraded) {" \
  "selection row 12|selection row 13"

M 4 "chooseBackend: treat every probe answer as available" "$B" \
  "  if (f.probe !== 'ok') {" "  if (f.probe === 'ok' && false) {" \
  "selection row 4|selection row 5|selection row 6|selection row 7|selection row 8|selection row 9|selection row 10|selection row 11"

M 5 "nativeIsPossible: let any platform through" "$B" \
  "export const nativeIsPossible = (platform, arch) => platform === 'darwin' && arch === 'arm64';" \
  "export const nativeIsPossible = (platform, arch) => platform !== 'zzz' && arch !== 'zzz';" \
  "this machine cannot run the native backend"

M 6 "chooseBackend: accept an unknown preference instead of refusing it" "$B" \
  "  if (!PREFERENCES.includes(f.preference)) {" "  if (false) {" \
  "an unknown preference THROWS rather than quietly becoming the worker"

M 7 "chooseBackend: accept an unknown probe result" "$B" \
  "  if (!PROBES.includes(f.probe)) {" "  if (false) {" \
  "...and so does an unknown probe result"

M 8 "normalisePreference: swallow the typo instead of reporting it" "$B" \
  "  return { preference: 'auto', note: \`unknown backend preference" \
  "  return { preference: 'auto', note: null }; // \`unknown backend preference" \
  "a junk preference at the BOUNDARY becomes auto AND SAYS SO"

M 9 "normalisePreference: lower-casing dropped, so a valid answer is refused" "$B" \
  "  const v = String(raw).trim().toLowerCase();" "  const v = String(raw).trim();" \
  "...and a valid one passes through with no note"

M 10 "preferenceFromArgv: let the environment outrank the command line" "$B" \
  "  return normalisePreference(flag ? flag.slice('--backend='.length) : env.STEM_WORKBENCH_BACKEND);" \
  "  return normalisePreference(env.STEM_WORKBENCH_BACKEND || (flag ? flag.slice('--backend='.length) : undefined));" \
  "the command line outranks the environment"

M 11 "probeNative: fork first and ask what platform this is afterwards" "$B" \
  "  if (!nativeIsPossible(platform, arch)) return 'unsupported-platform';" \
  "  if (false) return 'unsupported-platform';" \
  "the probe forks NOTHING off Apple Silicon"

M 12 "probeNative: report a probe that died as available" "$B" \
  "    log(\`native backend probe failed: \${(err && err.message) || err}\`);
    return 'crashed';" \
  "    log(\`native backend probe failed: \${(err && err.message) || err}\`);
    return 'ok';" \
  "INSTRUMENT CHECK: on darwin/arm64 the same probe DOES reach"

M 13 "NATIVE_MODULE: name a module that IS installed" "$B" \
  "export const NATIVE_MODULE = 'onnxruntime-node';" \
  "export const NATIVE_MODULE = 'node:path';" \
  "is NOT installed here"

# ================================================== §2 the wire
M 14 "load(): report the EP that was ASKED FOR rather than the one the session gave" "$N" \
  "      return { ep: r.ep, createMs: r.createMs, warmupMs: r.warmupMs };" \
  "      return { ep: o.ep || 'coreml', createMs: r.createMs, warmupMs: r.warmupMs };" \
  "load() resolves the SESSION's ep"

M 15 "onReady: invent a thread count and an adapter, which the freeze block forbids" "$N" \
  "      onReady({ ...NATIVE_HARDWARE_REPORT });" \
  "      onReady({ threads: 8, adapter: { vendor: 'apple' } });" \
  "onReady answered {threads: null, adapter: null}"

M 16 "separate(): stop copying the stems into the caller's buffer" "$N" \
  "      stems.set(got);" "      /* stems.set(got); */" \
  "the MIX really crossed the wire|the frozen layout survived the hop"

M 17 "separate(): hand back the wire's buffer instead of the caller's \`mix\`" "$N" \
  "      return { mix, stems: out, prepMs: r.prepMs, inferMs: r.inferMs, postMs: r.postMs };" \
  "      return { mix: r.stems, stems: out, prepMs: r.prepMs, inferMs: r.inferMs, postMs: r.postMs };" \
  "\`mix\` comes back as THE SAME BUFFER"

M 18 "separate(): return a fresh buffer instead of the caller's \`out\`" "$N" \
  "      return { mix, stems: out, prepMs: r.prepMs, inferMs: r.inferMs, postMs: r.postMs };" \
  "      return { mix, stems: got.buffer, prepMs: r.prepMs, inferMs: r.inferMs, postMs: r.postMs };" \
  "...and \`stems\` IS \`out\`, the caller's own buffer"

M 19 "separate(): TRANSFER the caller's mix — the measured, silent, destructive path" "$N" \
  "      const r = await call({ t: 'separate', mix: mix.slice(0) });" \
  "      const r = await call({ t: 'separate', mix: structuredClone(mix, { transfer: [mix] }) });" \
  "...and NEITHER IS EVER DETACHED"

M 20 "separate(): put the caller's 16.5 MB \`out\` on the wire too" "$N" \
  "      const r = await call({ t: 'separate', mix: mix.slice(0) });" \
  "      const r = await call({ t: 'separate', mix: mix.slice(0), out: out.slice(0) });" \
  "\`out\` NEVER GOES ON THE WIRE"

M 21 "separate(): invent the timings on this side instead of reporting the child's" "$N" \
  "      return { mix, stems: out, prepMs: r.prepMs, inferMs: r.inferMs, postMs: r.postMs };" \
  "      return { mix, stems: out, prepMs: 0, inferMs: 0, postMs: 0 };" \
  "the timings come back from the child"

M 22 "dispose(): kill the process and leave the callers waiting — the visible half only" "$N" \
  "      for (const [, g] of pending) g.rej(gone);
      pending.clear();" \
  "      pending.clear();" \
  "dispose() SETTLES a call that is genuinely inside the backend"

M 23 "dispose(): forget the reason, so a later call is not refused by name" "$N" \
  "      deadReason = \`\${name}: the native inference backend was disposed — a backend given back does not come back\`;" \
  "      deadReason = 'disposed';" \
  "...and a call that arrives AFTERWARDS is refused rather than left hanging, by name"

M 24 "the utility process DROPS a call that arrives after dispose — the silence that hangs a caller" "$C" \
  "      return fail(m.t === 'separate' ? 'separated' : 'loaded', m.id," \
  "      return undefined && fail(m.t === 'separate' ? 'separated' : 'loaded', m.id," \
  "the utility process refuses a separate() that arrives after dispose"

M 25 "serveInference: assume one port flavour — the silent-hang bug" "$C" \
  "  const unwrap = (arg) => (arg && typeof arg === 'object' && typeof arg.t === 'string' ? arg : (arg && arg.data));" \
  "  const unwrap = (arg) => arg;" \
  "a MessagePortMain-shaped delivery"

M 26 "the shipped factory carries its own copy of SEGMENT" "$E" \
  "  segmentFloats: SEGMENT," "  segmentFloats: 343980," \
  "the shipped factory takes SEGMENT and STEMS from the UNIT"

M 27 "the native backend is short a duty — assertHost must refuse it" "$N" \
  "    async dispose() {" "    async disposeLater() {" \
  "the native backend satisfies the unit's own BACKEND_DUTIES"

M 28 "a native backend whose port never opens HANGS instead of rejecting" "$N" \
  "  const portReady = Promise.resolve()
    .then(() => openPort(id))" \
  "  const portReady = Promise.resolve()
    .then(() => openPort(id).catch(() => new Promise(() => {})))" \
  "a native backend whose process cannot be opened REJECTS load()|...and so does separate()"

# ================================================== §3 the seam
M 29 "the hole builds the native backend whatever the Host chose" "$H" \
  "  if (choice && choice.kind === 'native' && typeof native === 'function') {" \
  "  if (typeof native === 'function') {" \
  "THE NEGATIVE CONTROL: told \`worker\`"

M 30 "the hole never builds the native backend at all" "$H" \
  "  if (choice && choice.kind === 'native' && typeof native === 'function') {" \
  "  if (false) {" \
  "INSTRUMENT CHECK: told \`native\` WITH a factory|...and the unit's hooks are FORWARDED WHOLE"

M 31 "the hole drops the unit's hooks on the way to the native backend" "$H" \
  "    return native({ ...hooks, choice, assetUrl });" \
  "    return native({ choice, assetUrl });" \
  "...and the unit's hooks are FORWARDED WHOLE"

M 32 "the hole crashes instead of degrading when the factory is missing" "$H" \
  "  const native = g.__wbNativeBackend || null;" \
  "  const native = g.__wbNativeBackend || (() => { throw new TypeError('no factory'); });" \
  "...a \`native\` choice with NO factory installed still degrades to the worker"

M 33 "the hole assumes the bridge is there — the missing-guard bug" "$H" \
  "  const choice = (g.__wbEngine && g.__wbEngine.backend) || null;" \
  "  const choice = g.__wbEngine.backend || null;" \
  "...and with no Host answer at all, the default is the backend that always exists"

M 34 "separate() throws before it reaches the engine — the queue then runs nothing" "$N" \
  "    async separate(mix, out) {
      if (disposed) throw new Error(deadReason);" \
  "    async separate(mix, out) {
      if (true) throw new Error('mutation 34');
      if (disposed) throw new Error(deadReason);" \
  "the unit's serialiseBackend accepts this backend and runs both calls"

M 35 "the utility entry retypes the spectral path instead of importing the unit's" "$U" \
  "import { DemucsEngine } from '../../vendor/stem-splitter-live/extension/engine/demucs.js';" \
  "class DemucsEngine { constructor(o) { this.o = o; } }" \
  "the utility process imports the UNIT's DemucsEngine"

M 36 "the utility entry opens the weights itself, behind the unit's verification" "$U" \
  "const require = createRequire(import.meta.url);" \
  "const require = createRequire(import.meta.url);
const _leak = () => require('node:fs').readFileSync('/dev/null');" \
  "...and it takes the weights from the wire rather than opening a file"

M 37 "chooseBackend: every gate removed, so everything is the native backend" "$B" \
  "  if (!nativeIsPossible(f.platform, f.arch)) {" \
  "  if (f.preference !== 'worker') {
    return Object.freeze({ kind: KINDS.native, ep: 'coreml', why: 'mutation 37 — every gate removed' });
  }
  if (!nativeIsPossible(f.platform, f.arch)) {" \
  "selection row 4|selection row 8|selection row 12|selection row 13|selection row 14|selection row 15|selection row 16|selection row 17|selection row 18|selection row 19|selection row 20|a probe that claims \`ok\` on a platform that cannot run it is still refused"

echo
echo "${C_D}=== vendor-intact — rule V1 still holds after the hole was edited and restored${C_X}"
bash tools/vendor-unit.sh --check >"$OUT/vendor-intact.log" 2>&1 \
  && echo "  ${C_G}green${C_X}  $(tail -1 "$OUT/vendor-intact.log")" \
  || { echo "  ${C_R}RED${C_X} — a mutation did not restore. See $OUT/vendor-intact.log"; missed=$((missed + 1)); }

echo
echo "=== $ran mutation(s): ${C_G}$caught caught${C_X}, ${C_R}$missed missed${C_X}"
if [ "${#ONLY[@]}" -eq 0 ]; then
  echo
  python3 "$ROOT/tools/suites/coverage.py" "$OUT" || missed=$((missed + 1))
else
  echo
  echo "${C_D}coverage is only claimed after a FULL battery — a subset cannot make it${C_X}"
fi
[ "$missed" -eq 0 ]
