#!/usr/bin/env bash
# Watch every assertion in `export` go red, one mutation at a time.
# AGENTS.md: "An assertion you did not watch fail is not evidence."
#
# TWO LANES, AND THE SPLIT IS ABOUT COST RATHER THAN TIDINESS.
#
#   THE PURE LANE (cases 1-11) runs `EXPORT_ONLY=pure node tools/suites/export.mjs`
#   — the allowlist, the title derivation and the path tokens, in plain node, in
#   under a second each. No display, no Electron, no mutex.
#
#   THE LAUNCHED LANE (cases 12-22) runs the whole suite, which is TWO REAL
#   LAUNCHES of the app sharing one profile, each opening the real GTK file
#   chooser and having it answered with `xdotool`. That is about two minutes a
#   case, and it queues on the shared browser mutex behind every other windowed
#   run on this box. Budget for it.
#
# WHY THE LAUNCHED LANE CANNOT BE AVOIDED: the plan's G3 says the dialog count
# must be instrumented by counting invocations IN MAIN and must NOT be measured
# by replacing, stubbing or monkey-patching `dialog.showOpenDialog`. So there is
# no cheap in-process stand-in for these eleven — the thing under test is a
# native operating-system dialog, and the only honest way to count it is to open
# one.
#
#   tools/suites/export-mutations.sh            # all of them
#   tools/suites/export-mutations.sh 12 13      # only these
#   tools/suites/export-mutations.sh 1 2 3 4 5 6 7 8 9 10 11    # the pure lane
#
# IT RESTORES ON SIGINT, SIGTERM AND SIGHUP, and its backups are keyed by the
# WHOLE PATH rather than the basename — `tools/suites/export.mjs` and
# `tools/gate/export.mjs` are both `export.mjs`, and a basename-keyed backup
# would silently restore one over the other. That is not hypothetical: an
# earlier battery in this repository did exactly that with `ui/host.js` and
# `offscreen/host.js`.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$ROOT/out/export-mutations"
rm -rf "$OUT"; mkdir -p "$OUT"
cd "$ROOT"
# THE MUTATION GUARD. Traps are the belt: this battery restores on INT, TERM and
# HUP, and `timeout` sends TERM — the way a long battery is most likely to die,
# and the one way it did not clean up (stem-workbench#22). The SENTINEL is the
# braces, for `kill -9`, a crashed host and a full disk, where no trap runs.
MG_BATTERY='export-mutations'; MG_ROOT="$ROOT"
. "$ROOT/tools/lib/mutation-guard.sh"
trap mg_on_signal INT TERM HUP   # on_signal() below is chained in via MG_ALSO

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

# --------------------------------------------- 0. green before mutating
echo "${C_D}=== baseline — the pure lane must be GREEN before anything is broken${C_X}  $(date +%H:%M:%S)"
if ! eval "$PURE" > "$OUT/baseline.log" 2>&1; then
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
"      const dir = rememberedFolder();" \
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
"      if (pending) { stats.joinedPending++; return pending; }" \
"      if (false) { stats.joinedPending++; return pending; }"

mutate_case 15 "the folder is asked for with a FILE picker's options" \
  "$S" "$FULL" \
  "FAIL  ...and the options it was opened with are a FOLDER picker" \
  -- "$S" \
"    stats.lastFolderOptions = { ...FOLDER_DIALOG, properties: [...FOLDER_DIALOG.properties] };" \
"    stats.lastFolderOptions = { ...FILE_DIALOG, properties: [...FILE_DIALOG.properties] };"

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

# ==========================================================================
echo
echo "========================================================================"
if [ "$missed" -eq 0 ] && [ "$ran" -gt 0 ]; then
  echo "${C_G}all $caught of $ran mutations were caught${C_X} — the intake, the title, the token, and the folder asked once."
  exit 0
fi
echo "${C_R}$missed of $ran mutations were NOT caught${C_X} (caught $caught). Logs in out/export-mutations/."
exit 1
