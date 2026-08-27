#!/usr/bin/env bash
# Watch every assertion in `export` go red, one mutation at a time.
# AGENTS.md: "An assertion you did not watch fail is not evidence."
#
# TWO LANES, AND THE SPLIT IS ABOUT COST RATHER THAN TIDINESS.
#
#   THE PURE LANE (cases 1-11 and 34 and 36 — thirteen cases) runs
#   `EXPORT_ONLY=pure node tools/suites/export.mjs` — the allowlist, the title
#   derivation, the path tokens, the writer's own bytes and the sink session,
#   in plain node, in under a second each. No display, no Electron, no mutex.
#   Case 35 is NOT here: the refused-open throw lives in the vendored hole's
#   DUTY, and the duty is driven through the whole app because the refusal
#   happens at a real cancelled chooser.
#
#   THE LAUNCHED LANE (cases 12-33 and 35 — twenty-three cases) runs the whole suite, which is TWO
#   REAL LAUNCHES of the app sharing one profile, each opening the real GTK file
#   chooser and having it answered with `xdotool`. That is about two minutes a
#   case, and it queues on the shared browser mutex behind every other windowed
#   run on this box. Budget for it. Cases 24-27 are here ON PURPOSE: the plan's
#   G1/G2a/G2b-path mutations also have to redden the IN-THE-APP assertions,
#   not just the pure ones — an in-app writer assertion with no launched watcher
#   is the exact gap `coverage.py` measured, and the flipped cases close it.
#
# WHY THE LAUNCHED LANE CANNOT BE AVOIDED: the plan's G3 says the dialog count
# must be instrumented by counting invocations IN MAIN and must NOT be measured
# by replacing, stubbing or monkey-patching `dialog.showOpenDialog`. So there is
# no cheap in-process stand-in for these — the thing under test is a native
# operating-system dialog, and the only honest way to count it is to open one.
# The launched half of the WRITER and the SINK rides the same two launches: the
# bytes are proven in the pure lane, and the app's own drives — the escape
# attempt, the cancelled picker, the refused names — are the launched cases.
#
#   tools/suites/export-mutations.sh            # all of them
#   tools/suites/export-mutations.sh 12 13      # only these
#   tools/suites/export-mutations.sh 1 2 3 4 5 6 7 8 9 10 11 34 36    # the pure lane
#
# IT RESTORES ON SIGINT, SIGTERM AND SIGHUP, and its backups are keyed by the
# WHOLE PATH rather than the basename — `tools/suites/export.mjs` and
# `tools/gate/export.mjs` are both `export.mjs`, and a basename-keyed backup
# would silently restore one over the other. That is not hypothetical: an
# earlier battery in this repository did exactly that with `ui/host.js` and
# `offscreen/host.js`.
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
OUT="$ROOT/out/export-mutations"
cd "$ROOT"
# THE MUTATION GUARD. Traps are the belt: this battery restores on INT, TERM and
# HUP, and `timeout` sends TERM — the way a long battery is most likely to die,
# and the one way it did not clean up (stem-workbench#22). The SENTINEL is the
# braces, for `kill -9`, a crashed host and a full disk, where no trap runs.
MG_BATTERY='export-mutations'; MG_ROOT="$ROOT"
. "$ROOT/tools/lib/mutation-guard.sh"
trap mg_on_signal INT TERM HUP   # on_signal() below is chained in via MG_ALSO

mg_begin
rm -rf "$OUT"; mkdir -p "$OUT"   # AFTER the marker: a run refused here has wiped nothing
C_R=$'\033[31m'; C_G=$'\033[32m'; C_D=$'\033[2m'; C_X=$'\033[0m'
caught=0; missed=0; ran=0

bak_of() { printf '%s/%s.%s.bak' "$OUT" "$1" "$(printf '%s' "$2" | tr '/' '_')"; }

restore_all() {
  local paths n f
  for paths in "$OUT"/*.paths; do
    [ -e "$paths" ] || continue
    n="$(basename "$paths" .paths)"
    while read -r f; do
      [ -z "$f" ] && continue
      [ -f "$(bak_of "$n" "$f")" ] && cp "$(bak_of "$n" "$f")" "$ROOT/$f"
    done < "$paths"
  done
}
on_signal() {
  echo
  echo "INTERRUPTED — restoring every file this battery had mutated, from $OUT."
  restore_all
  git -C "$ROOT" status --short -- src tools || true
  exit 130
}
MG_ALSO=on_signal

# `edit FILE OLD NEW` — exact, first occurrence, HARD ERROR if the anchor moved.
edit() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path).read()
if old not in s:
    sys.stderr.write("ANCHOR NOT FOUND in %s:\n%s\n" % (path, old[:300]))
    sys.exit(3)
open(path, 'w').write(s.replace(old, new, 1))
PY
}

# `mutate_case N "label" "file[,file]" "runner" "expect …" -- edits…`
mutate_case() {
  local n="$1" label="$2" files="$3" runner="$4" expect="$5"; shift 5
  [ "$#" -ge 1 ] && [ "$1" = "--" ] && shift
  if [ "${#ONLY[@]}" -gt 0 ] && [[ ! " ${ONLY[*]} " =~ " $n " ]]; then return 0; fi

  echo
  echo "${C_D}=== mutation $n — $label${C_X}  $(date +%H:%M:%S)"
  ran=$((ran + 1))

  local -a flist=()
  if [ -n "$files" ]; then local IFS=','; flist=($files); unset IFS; fi
  local f
  if [ "${#flist[@]}" -gt 0 ]; then
    printf '%s\n' "${flist[@]}" > "$OUT/$n.paths"
    local -a mg_pairs=()
    for f in "${flist[@]}"; do cp "$ROOT/$f" "$(bak_of "$n" "$f")"; mg_pairs+=("$f=$(bak_of "$n" "$f")"); done
    # THE SENTINEL GOES DOWN BEFORE THE FIRST EDIT AND COMES UP ONLY ONCE THE
    # RESTORE HAS BEEN BYTE-VERIFIED.
    mg_claim "$n" "${mg_pairs[@]}"
  fi

  while [ "$#" -ge 3 ]; do
    if ! edit "$ROOT/$1" "$2" "$3"; then
      echo "${C_R}MUTATION $n DID NOT APPLY${C_X} — the anchor text in $1 has moved. Fix this script."
      for f in "${flist[@]:-}"; do [ -n "$f" ] && cp "$(bak_of "$n" "$f")" "$ROOT/$f"; done
      rm -f "$OUT/$n.paths"; mg_release "$n"; missed=$((missed + 1)); return 0
    fi
    shift 3
  done

  local log="$OUT/$n.log"
  local code=0
  eval "$runner" > "$log" 2>&1 || code=$?

  for f in "${flist[@]:-}"; do [ -n "$f" ] && cp "$(bak_of "$n" "$f")" "$ROOT/$f"; done
  for f in "${flist[@]:-}"; do
    [ -n "$f" ] || continue
    if ! cmp -s "$ROOT/$f" "$(bak_of "$n" "$f")"; then
      echo "${C_R}RESTORE FAILED for $f${C_X}"; missed=$((missed + 1)); return 0
    fi
  done
  mg_release "$n"
  rm -f "$OUT/$n.paths"

  local ok=1
  local IFS='|'; local -a wants=($expect); unset IFS
  local w
  for w in "${wants[@]}"; do
    if grep -qF -- "$w" "$log"; then
      echo "  ${C_G}saw${C_X}    $w"
    else
      echo "  ${C_R}MISS${C_X}   $w  ${C_D}— expected this in the transcript and it was not there${C_X}"
      ok=0
    fi
  done
  echo "  ${C_D}exit $code · $(tail -1 "$log" | cut -c1-120) · log out/export-mutations/$n.log${C_X}"
  if [ "$ok" -eq 1 ]; then caught=$((caught + 1)); else missed=$((missed + 1)); fi
}

ONLY=("$@")
PURE='EXPORT_ONLY=pure node tools/suites/export.mjs'
FULL='node tools/suites/export.mjs'
S='src/main/files.js'
M='src/main/main.js'
G='tools/gate/export.mjs'
# THE HOLE MODULE — one of the two editable seams under vendor/ (RULE V1). The
# battery edits it for the seam mutations and restores it from the backup, like
# every other file here.
H='vendor/stem-splitter-live/extension/offscreen/host.js'

# --------------------------------------------- 0. green before mutating
# THE BASELINE IS THE FULL SUITE, not the pure lane, and that is what makes the
# coverage check below possible: `coverage.py` takes the list of assertion NAMES
# out of this log, so a baseline missing the launched half would quietly declare
# thirteen assertions out of scope.
echo "${C_D}=== baseline — the whole suite must be GREEN before anything is broken${C_X}  $(date +%H:%M:%S)"
if ! eval "$FULL" > "$OUT/baseline.log" 2>&1; then
  echo "${C_R}BASELINE IS RED${C_X} — nothing below would prove anything. Last lines:"
  tail -20 "$OUT/baseline.log"; exit 2
fi
echo "  ${C_G}green${C_X}  $(tail -1 "$OUT/baseline.log")"

# ==========================================================================
# THE PURE LANE — 1-11
# ==========================================================================
mutate_case 1 "the extension check becomes case-SENSITIVE, so TRACK.WAV is refused" \
  "$S" "$PURE" \
  "FAIL  every extension the File source declares is admitted, in either case" \
  -- "$S" \
"const extOf = (p) => path.extname(String(p ?? '')).toLowerCase();" \
"const extOf = (p) => path.extname(String(p ?? ''));"

mutate_case 2 "the allowlist admits everything — the filter is treated as the check" \
  "$S" "$PURE" \
  "FAIL  ...and everything else is refused" \
  -- "$S" \
"export function isAllowedSourceFile(p) {
  return Object.hasOwn(SOURCE_TYPES, extOf(p));" \
"export function isAllowedSourceFile(p) {
  return true || Object.hasOwn(SOURCE_TYPES, extOf(p));"

mutate_case 3 "the picker's filter and the allowlist part company" \
  "$S" "$PURE" \
  "FAIL  every admitted extension has a MIME of its own" \
  -- "$S" \
"Object.keys(SOURCE_TYPES).map((e) => e.slice(1))" \
"['wav']"

mutate_case 4 "an unadmitted file is given a MIME anyway, so nothing is ever sniffed-or-refused" \
  "$S" "$PURE" \
  "FAIL  every admitted extension has a MIME of its own" \
  -- "$S" \
"  return Object.hasOwn(SOURCE_TYPES, extOf(p)) ? SOURCE_TYPES[extOf(p)] : null;" \
"  return 'audio/x';"

mutate_case 5 "the title keeps the file's extension, so it lands in the middle of six WAV names" \
  "$S" "$PURE" \
  "FAIL  a title is the file's own name without its directory or its last extension" \
  -- "$S" \
"  return sanitiseTitle(ext ? base.slice(0, -ext.length) : base);" \
"  return sanitiseTitle(base);"

# THE ONE THE WHOLE SECTION EXISTS FOR: a title that can be a path is a write
# outside the folder the user chose.
mutate_case 6 "the separator strip goes — a title may contain / and \\ again" \
  "$S" "$PURE" \
  "FAIL  ...and a title can never BE a path|FAIL  ...and joining any of them to the chosen folder" \
  -- "$S" \
"  s = s.replace(/[/\\\\]/g, ' ');                      // 2" \
"  s = String(s);                                     // 2"

mutate_case 7 "the trailing dot/space strip goes — Windows silently makes two titles one" \
  "$S" "$PURE" \
  "FAIL  ...and a title can never BE a path" \
  -- "$S" \
"  s = s.replace(/[.\\s]+\$/, '');                      // 5" \
"  s = String(s);                                     // 5"

mutate_case 8 "the leading dot/space strip goes — \`..\` survives as a title" \
  "$S" "$PURE" \
  "FAIL  ...and a title can never BE a path" \
  -- "$S" \
"  s = s.replace(/^[.\\s]+/, '');                      // 4" \
"  s = String(s);                                     // 4"

mutate_case 9 "a path token survives being spent, so a replay works" \
  "$S" "$PURE" \
  "FAIL  a path token is ONE SHOT" \
  -- "$S" \
"      if (!rec) return refuse('unknown-token', 'that path token was never minted, or has already been spent');
      live.delete(token);" \
"      if (!rec) return refuse('unknown-token', 'that path token was never minted, or has already been spent');"

mutate_case 10 "the TTL is ignored, so a token minted an hour ago still names a path" \
  "$S" "$PURE" \
  "FAIL  ...and one spent after its TTL is refused as EXPIRED" \
  -- "$S" \
"      if (rec.expiresAt <= now()) return refuse('expired'," \
"      if (false) return refuse('expired',"

mutate_case 11 "revokeAll counts what it would drop and drops nothing" \
  "$S" "$PURE" \
  "FAIL  ...and revokeAll drops every live token" \
  -- "$S" \
"      const n = live.size;
      live.clear();" \
"      const n = live.size;"

# ==========================================================================
# THE LAUNCHED LANE — 12-22. Two real launches each; budget two minutes.
# ==========================================================================
# 12 AND 13 ARE THE PLAN'S OWN TWO MUTATIONS, G3 and G4, verbatim.
mutate_case 12 "delete the persisted-folder read — the plan's G3 mutation" \
  "$S" "$FULL" \
  "FAIL  the folder is asked EXACTLY ONCE|FAIL  ...and export #2 resolved to the REMEMBERED folder" \
  -- "$S" \
"    const dir = rememberedFolder();" \
"      const dir = null;"

mutate_case 13 "keep the folder in the \`session\` area instead of \`local\` — the plan's G4 mutation" \
  "$S" "$FULL" \
  "FAIL  the remembered folder survives a RESTART|FAIL  ...and it is the SAME folder" \
  -- "$S" \
"export const EXPORT_FOLDER_AREA = 'local';" \
"export const EXPORT_FOLDER_AREA = 'session';"

mutate_case 14 "a second export opens a SECOND native picker on top of the first" \
  "$S" "$FULL" \
  "FAIL  a second export requested while the chooser is UP joins that ask" \
  -- "$S" \
"    if (pending) { stats.joinedPending++; return pending; }" \
"      if (false) { stats.joinedPending++; return pending; }"

mutate_case 15 "the folder is asked for with a FILE picker's options" \
  "$S" "$FULL" \
  "FAIL  ...and the options it was opened with are a FOLDER picker" \
  -- "$S" \
"    stats.lastFolderOptions = { ...FOLDER_DIALOG, properties: [...FOLDER_DIALOG.properties] };" \
"    stats.lastFolderOptions = { ...FILE_DIALOG, properties: [...FILE_DIALOG.properties] };"
#   A FILE picker accepts no folder: the probe's Ctrl+L + Open answers it by
#   NAVIGATING, so the ask never settles. Measured before the fix: the first
#   launch hung until the suite's 180 s stopwatch killed it, the report never
#   landed, and the launched lane died at assertion 1 with 18 passed, 1 failed.
#   Two things make that impossible now. The mutation copies FILE_DIALOG
#   wholesale — TITLE included — so the ask arrives named "Choose an audio
#   file"; `tools/gate/export.mjs` therefore matches a folder ask by EITHER
#   title. And it falls back to Escape when the Open click does not close the
#   chooser, so the ask resolves as a REFUSAL — the count that names the
#   defect — instead of a timeout that drowns it.

# THE INSTRUMENT ITSELF. Every count in this suite is a fact about the app only
# while the picker being counted is the operating system's. This build's intake
# holds a WRAPPER that still opens the real dialog — so every count stays
# correct and only the instrument check may notice. If it does not, the suite is
# measuring something it cannot vouch for.
mutate_case 16 "the intake is built over a wrapper rather than electron's own dialog" \
  "$M" "$FULL" \
  "FAIL  INSTRUMENT CHECK: the intake in the running app holds electron's own" \
  -- "$M" \
"  state.files = createFileIntake({
    dialog," \
"  state.files = createFileIntake({
    dialog: { showOpenDialog: (...a) => dialog.showOpenDialog(...a) },"

mutate_case 17 "the picked file's title is its raw basename, extension and all" \
  "$S" "$FULL" \
  "FAIL  the file picker admits a real audio file" \
  -- "$S" \
"        title: deriveTitle(file)," \
"        title: path.basename(file),"

mutate_case 18 "the picker's own allowlist check goes — a typed path is taken as given" \
  "$S" "$FULL" \
  "FAIL  ...and a file the allowlist does not admit is REFUSED BY NAME" \
  -- "$S" \
"      if (!isAllowedSourceFile(file)) {" \
"      if (false) {"

mutate_case 19 "the token is minted from a registry nothing else can see" \
  "$S" "$FULL" \
  "FAIL  ...and that token resolves to that file exactly once" \
  -- "$S" \
"        token: tokens.mint(file)," \
"        token: createPathTokens().mint(file),"

# THE INSTRUMENT, ONE LEVEL OUT. Everything after the launch reads a file the
# probe wrote, so a suite that cannot tell a missing report from a passing run
# reports green over an app that never launched — the VOID case, one level in.
mutate_case 20 "the probe writes no report at all" \
  "$G" "$FULL" \
  "FAIL  both launches ran from the real entry point and wrote a gate report" \
  -- "$G" \
"  R.stats = { ...files.stats };
  fs.writeFileSync(path.join(outDir, 'report.json'), \`\${JSON.stringify(R, null, 2)}\n\`);" \
"  R.stats = { ...files.stats };"

mutate_case 21 "the boot count is read AFTER the first export instead of before it" \
  "$G" "$FULL" \
  "FAIL  a launch on its own asks for nothing" \
  -- "$G" \
"    asksAtBoot: files ? files.stats.folderAsks : null," \
"    asksAtBoot: null," \
"$G" \
"    R.asksAfterFirst = files.stats.folderAsks;" \
"    R.asksAfterFirst = files.stats.folderAsks; R.asksAtBoot = files.stats.folderAsks;"

# AND THE COUNT WITHOUT THE DIALOG. `folderAsks` still increments here — what
# goes away is the native picker itself. An assertion that only counted would
# stay green over an app that never opened one.
mutate_case 22 "the folder is answered without a native picker ever opening" \
  "$S" "$FULL" \
  "FAIL  the first export opens the REAL native folder chooser" \
  -- "$S" \
"    const r = parent
      ? await dialog.showOpenDialog(parent, stats.lastFolderOptions)
      : await dialog.showOpenDialog(stats.lastFolderOptions);" \
"    const r = { canceled: false, filePaths: [process.env.WB_EXPORT_TARGET] };"

# ISSUE #6's BRANCH. A remembered path is a claim about a filesystem nobody told
# us had changed; without the directory check the app writes six stems into a
# folder that is gone, and finds out on the fourth one.
mutate_case 23 "a remembered folder that no longer exists is used anyway" \
  "$S" "$FULL" \
  "FAIL  ...and a remembered folder that has been DELETED is not used" \
  -- "$S" \
"      if (!fs.statSync(dir).isDirectory()) { stats.folderGone++; stats.lastAskReason = 'gone'; return null; }" \
"      if (false) { stats.folderGone++; stats.lastAskReason = 'gone'; return null; }"

# ==========================================================================
# THE WRITER AND THE EXPORT SINK — 24-36
# ==========================================================================
# THE WRITER AND THE SINK, PURE AND IN THE APP. Cases 24-27 run the WHOLE
# suite (lane $FULL): their mutations redden the pure G1/G2a/G2b-path claims
# AND the in-the-app assertions, which otherwise would never be watched. The
# pure bytes over a fake dialog are proven in cases 24-27's pure sections too
# — the FULL lane runs the whole suite, pure half first.

# THE PLAN'S G1 MUTATION, AT THE CALL SITE: float requires 32 bits, so this
# build's writer THROWS and there is no file to have a header.
mutate_case 24 "the writer encodes at 16 bits — the encoder refuses, so there is no file at all" \
  "$S" "$FULL" \
  "FAIL  G1: the header is bit-exact" \
  -- "$S" \
  "const wav = encodeWav(chans, { sampleRate: SR, bitDepth: 32, float: true });" \
  "const wav = encodeWav(chans, { sampleRate: SR, bitDepth: 16, float: true });"

# G2a: a gain of 0.9 is not unity — and 0.9 is not dyadic, so even the rounding
# differs. Every file must fail the byte-for-byte comparison.
mutate_case 25 "the writer scales every sample by 0.9 before encoding — no longer byte-identical" \
  "$S" "$FULL" \
  "FAIL  G2a: every WAV is byte-identical" \
  -- "$S" \
  "const wav = encodeWav(chans, { sampleRate: SR, bitDepth: 32, float: true });" \
  "const wav = encodeWav([Float32Array.from(chans[0], (v) => v * 0.9), Float32Array.from(chans[1], (v) => v * 0.9)], { sampleRate: SR, bitDepth: 32, float: true });"

# The names still match — the CONTENT is misassigned, which only the per-file
# byte comparison can see. The anchor is the ENCODING loop, three lines deep:
# `exportStems` has a SECOND identical `for (const stem of STEMS)` loop above
# it — the VALIDATION loop, which checks the pairs before the folder is asked.
# The first occurrence of the two-line text is that loop, and swapping the
# mapping inside it is unobservable — every stem still passes validation, and
# the suite goes fully green. MEASURED on 2026-08-27: the two-line anchor ran
# 18 passed, 0 failed under the mutation. That is the writer-slice trap; the
# third line is what pins the edit to the loop that makes bytes.
mutate_case 26 "the writer writes each stem's planes under the NEXT stem's name" \
  "$S" "$FULL" \
  "FAIL  G2a: every WAV is byte-identical" \
  -- "$S" \
  "    for (const stem of STEMS) {
      const chans = stems[stem];
      const wav = encodeWav(chans, { sampleRate: SR, bitDepth: 32, float: true });" \
  "    for (const [i, stem] of STEMS.entries()) {
      const chans = stems[STEMS[(i + 1) % STEMS.length]];
      const wav = encodeWav(chans, { sampleRate: SR, bitDepth: 32, float: true });"

# G2b-path: without the sanitise, `../../escape` resolves OUTSIDE the chosen
# folder, and the file lands there.
mutate_case 27 "the writer stops sanitising the title — the escape attempt lands outside the chosen folder" \
  "$S" "$FULL" \
  "FAIL  G2b-path:" \
  -- "$S" \
  "    const safeTitle = sanitiseTitle(title);" \
  "    const safeTitle = title;"

# ==========================================================================
# THE LAUNCHED LANE — 28-33. The same two real launches, the same real chooser.
# ==========================================================================

# THE CONTRACT'S SHAPE, WRITER SIDE: the cancelled picker must be an ERROR. A
# build that returns the refusal as a result is a build that exports five of
# six stems and calls it done.
mutate_case 28 "the writer RETURNS the refusal instead of throwing it — an empty result where the contract demands an error" \
  "$S" "$FULL" \
  "FAIL  a cancelled folder picker is a THROWN refusal on the writer path" \
  -- "$S" \
  "    if (!folder.ok) throw new Error(\`export refused: \${folder.code} — \${folder.message}\`);" \
  "    if (!folder.ok) return { ok: false, code: folder.code, message: folder.message };"

# The engine-side counts stay CORRECT here — the probe's report still says 16
# bytes "written". Only the DISK knows. That is the writer-slice trap, named in
# the suite header: 'the sink accepted nothing' must not look like 'wrote the
# file', and the bytes assertion reads the disk.
mutate_case 29 "the sink writes NOTHING — chunks vanish between the bridge and the disk" \
  "$S" "$FULL" \
  "FAIL  ...and the sink's bytes are on disk|FAIL  the EXPORT SINK opens every file of a deliverable at once and streams chunks to disk" \
  -- "$S" \
  "    fs.writeSync(rec.fd, bytes);" \
  "    void bytes;"

# TWO-FILE mutation (see the suite header): the duty's own shape check going
# alone would be shadowed by main's gate, so both halves must move together.
mutate_case 30 "an empty plan is accepted at MAIN's gate AND passes the duty's shape check — the empty deliverable is handed out" \
  "$S,$H" "$FULL" \
  "FAIL  a plan with no files is refused at MAIN's own gate|FAIL  an empty plan and a name that is not a plain file name are refused AT THE SEAM" \
  -- "$S" \
  "        || !Array.isArray(plan.files) || plan.files.length === 0) {" \
  "        || !Array.isArray(plan.files) || false) {" \
  "$H" \
  "      || !Array.isArray(plan.files) || plan.files.length === 0" \
  "      || !Array.isArray(plan.files) || false"

# A name that is not a plain file name would open a file OUTSIDE the folder the
# user chose. The background answerer stands by (see the probe) so the red is a
# wrong answer or a file outside the folder — never a hung probe.
mutate_case 31 "the sink accepts ANY file name — the plan owns the directory after all" \
  "$S" "$FULL" \
  "FAIL  a name that is not a plain file name is refused AT THE SEAM|FAIL  an empty plan and a name that is not a plain" \
  -- "$S" \
  "    if (bad) return sinkRefuse('bad-name', bad);" \
  "    if (false) return sinkRefuse('bad-name', bad);"

# The second open REPLACES the live session, so the first session's stream
# close throws inside the duty. MEASURED on 2026-08-27: before the suite read
# that close as data, this case ran the mutated build to a NODE CRASH at
# host.js:406 ("no open sink file named a.wav") — zero FAIL lines, a MISS that
# said "the assertion is unwatched" when it was only undriveable. The suite now
# catches the close and the combined assertion reddens on both signals.
mutate_case 32 "a second sink session is allowed while one is live — two deliverables at once" \
  "$S" "$FULL" \
  "FAIL  ...a second session cannot open while one is live" \
  -- "$S" \
  "    if (sink.open) {
      return sinkRefuse('already-open', 'one export sink is already open — a deliverable is one gesture, all at once');
    }" \
  "    if (false) {
      return sinkRefuse('already-open', 'one export sink is already open — a deliverable is one gesture, all at once');
    }"

# Five of six would be called done. The engine's own drive writes into every
# stream it was handed, so the missing file's write becomes a refusal-that-is-
# a-throw in the engine, and the seam assertion goes red.
mutate_case 33 "the sink opens only SOME of the plan's files — five of six called done" \
  "$S" "$FULL" \
  "FAIL  THE EXPORT SINK, IN THE ENGINE" \
  -- "$S" \
  "    for (const name of plan.files) {" \
  "    for (const name of plan.files.slice(0, 1)) {"

# ==========================================================================
# BACK TO THE PURE LANE — 34-36. The seam's own gates, cheaply.
# ==========================================================================

# The two claims share ONE assertion — "...a second session cannot open while
# one is live, and a chunk cannot invent a file" — so the refusal's going is
# seen through that line. MEASURED on 2026-08-27: the narrow expect below was
# a MISS even though the suite reddened (17 passed, 1 failed); the failing
# line was the combined assertion, not a chunk-shaped one.
mutate_case 34 "a chunk can invent a file — the unknown-name refusal goes" \
  "$S" "$PURE" \
  "FAIL  ...a second session cannot open while one is live, and a chunk cannot invent a file" \
  -- "$S" \
  "    if (!rec) return sinkRefuse('unknown-file', \`no open sink file named \${JSON.stringify(name)}\`);" \
  "    if (false) return sinkRefuse('unknown-file', \`no open sink file named \${JSON.stringify(name)}\`);"

# The contract's one shape that cannot be returned: on a refused open, the duty
# must THROW. This build skips the throw and hands the streams out anyway.
mutate_case 35 "the duty never throws on a refused open — the streams go out regardless" \
  "$H" "$FULL" \
  "FAIL  A REFUSED SINK OPEN IS A THROW|FAIL  a cancelled folder picker refuses the whole sink at the seam" \
  -- "$H" \
  "  if (!opened || opened.ok !== true) {" \
  "  if (false) {"

# Same two-file mutation as 30, run in the pure lane — the seam's empty-plan
# refusal is the same shape with or without the window.
mutate_case 36 "the seam accepts an empty plan — the duty validates nothing and main's gate opens nothing" \
  "$S,$H" "$PURE" \
  "FAIL  an empty plan and a name that is not a plain file name are refused AT THE SEAM" \
  -- "$S" \
  "        || !Array.isArray(plan.files) || plan.files.length === 0) {" \
  "        || !Array.isArray(plan.files) || false) {" \
  "$H" \
  "      || !Array.isArray(plan.files) || plan.files.length === 0" \
  "      || !Array.isArray(plan.files) || false"

# ==========================================================================
echo
echo "========================================================================"
# COVERAGE ONLY AFTER A FULL BATTERY. "22 of 22 mutations were caught" is not the
# claim worth making — the claim is that no assertion has gone unbroken, and a
# subset cannot make it. `coverage.py` reads the names out of `baseline.log` and
# refuses any that never appeared on a FAIL line in the case logs.
cov=0
if [ "${#ONLY[@]}" -eq 0 ]; then
  python3 "$ROOT/tools/suites/coverage.py" "$OUT" || cov=$?
else
  echo "${C_D}coverage not checked — a subset of cases cannot make that claim${C_X}"
fi

if [ "$missed" -eq 0 ] && [ "$ran" -gt 0 ] && [ "$cov" -eq 0 ]; then
  echo "${C_G}all $caught of $ran mutations were caught${C_X} — the intake, the title, the token, and the folder asked once."
  exit 0
fi
[ "$cov" -eq 0 ] || echo "${C_R}an assertion in this suite has never been watched red${C_X}"

echo "${C_R}$missed of $ran mutations were NOT caught${C_X} (caught $caught). Logs in out/export-mutations/."
exit 1
