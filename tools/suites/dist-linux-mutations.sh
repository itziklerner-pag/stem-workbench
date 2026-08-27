#!/usr/bin/env bash
# Watch every assertion in `tools/suites/dist-linux.mjs` go RED, one mutation at
# a time. AGENTS.md: "An assertion you did not watch fail is not evidence."
#
#   tools/suites/dist-linux-mutations.sh          # every case
#   tools/suites/dist-linux-mutations.sh 7 9      # only these
#
# ---------------------------------------------------------------------------
# IT IS THE MOST EXPENSIVE BATTERY HERE, AND SIX OF TEN CASES AVOID THE QUEUE
# ---------------------------------------------------------------------------
# Every case rebuilds an installer, because that is the thing being asserted
# about — ~90 s each with electron-builder's toolchain already cached. Cases
# 1-6 are about what the build PRODUCED, so they run with
# `DIST_LINUX_ONLY=build` and never take the machine-global browser mutex; four
# agents were observed queued on that one lock at once, and a battery that pays
# for a display it does not need is a battery nobody runs. Cases 7-10 are about
# the packaged app RUNNING and take it once each.
#
# `deck-host-mutations.mjs`'s `DECK_HOST_ONLY=conformance` is the precedent.
# `tools/verify.mjs` never sets either variable, and a run with it set prints a
# banner and a different closing line, so a partial transcript cannot be
# mistaken for the step.
#
# NO CASE EDITS ANYTHING UNDER `vendor/` — rule V1. Case 9 truncates
# `models/htdemucs_6s.onnx`, which is GITIGNORED and 109 MB: it is moved aside
# and moved back rather than copied, and the sentinel names it so a `kill -9`
# leaves a refusal rather than a repository with no weights in it.
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
OUT="$ROOT/out/dist-linux-mutations"
cd "$ROOT"
MG_BATTERY='dist-linux-mutations'; MG_ROOT="$ROOT"
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

# `$1` = log, `$2` = 'build' for the no-mutex mode, '' for the full run
run_suite() {
  if [ "${2:-}" = 'build' ]; then
    DIST_LINUX_ONLY=build node tools/suites/dist-linux.mjs >"$1" 2>&1
  else
    node tools/suites/dist-linux.mjs >"$1" 2>&1
  fi
}
fails_of() { grep -E '^FAIL' "$1" || true; }

ONLY_CASES=("$@")

# `M <n> <mode> <label> <file> <old> <new> <expect1|expect2…>`
M() {
  local n="$1" mode="$2" label="$3" file="$4" old="$5" new="$6" expect="$7"
  if [ "${#ONLY_CASES[@]}" -gt 0 ] && [[ ! " ${ONLY_CASES[*]} " =~ " $n " ]]; then return 0; fi

  echo
  echo "${C_D}=== mutation $n [$mode] — $label${C_X}"
  ran=$((ran + 1))
  local bak="$OUT/$n.$(basename "$file").bak"
  cp "$ROOT/$file" "$bak"
  mg_claim "$n" "$file=$bak"

  if ! edit "$ROOT/$file" "$old" "$new"; then
    echo "  ${C_R}DID NOT APPLY${C_X} — the anchor in $file has moved. Fix this script."
    cp "$bak" "$ROOT/$file"; mg_release "$n"; missed=$((missed + 1)); return 0
  fi

  local log="$OUT/$n.log"
  run_suite "$log" "$mode"; local code=$?
  cp "$bak" "$ROOT/$file"
  if ! cmp -s "$ROOT/$file" "$bak"; then
    echo "  ${C_R}RESTORE FAILED for $file${C_X}"; missed=$((missed + 1)); return 0
  fi
  mg_release "$n"

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

# THE 109 MB OF WEIGHTS ARE MOVED, NEVER COPIED — case 9. Gitignored, and in a
# worktree usually a symlink into the canonical checkout, so a `cp` would either
# cost 109 MB or dereference into somebody else's file. `mv` of the link itself
# is atomic and reversible, and the sentinel names it.
MODEL_CASE() {
  local n=9
  if [ "${#ONLY_CASES[@]}" -gt 0 ] && [[ ! " ${ONLY_CASES[*]} " =~ " $n " ]]; then return 0; fi
  echo
  echo "${C_D}=== mutation $n [launch] — the bundled weights are truncated, so rule M1 must refuse them${C_X}"
  ran=$((ran + 1))
  local m="$ROOT/models/htdemucs_6s.onnx"
  local aside="$OUT/htdemucs_6s.onnx.aside"
  mv "$m" "$aside"
  mg_claim "$n" "models/htdemucs_6s.onnx=$aside"
  head -c 4096 /dev/zero > "$m"

  local log="$OUT/$n.log"
  run_suite "$log"; local code=$?
  rm -f "$m"; mv "$aside" "$m"
  if [ ! -e "$m" ]; then
    echo "  ${C_R}RESTORE FAILED — models/htdemucs_6s.onnx is gone${C_X}"; missed=$((missed + 1)); return 0
  fi
  mg_release "$n"

  local ok=1
  for w in 'the 109 MB of weights are on disk INSIDE the installer' \
           '...and the BUNDLED weights were read through `process.resourcesPath`'; do
    if fails_of "$log" | grep -qF -- "$w"; then echo "  ${C_G}red${C_X}    $w"
    else echo "  ${C_R}MISS${C_X}   $w"; ok=0; fi
  done
  [ "$code" -eq 0 ] && { echo "  ${C_R}MISS${C_X}   the suite exited 0 under the mutation"; ok=0; }
  echo "  ${C_D}$(fails_of "$log" | wc -l | tr -d ' ') assertion(s) red in total · $(tail -1 "$log")${C_X}"
  if [ "$ok" -eq 1 ]; then caught=$((caught + 1)); else missed=$((missed + 1)); fi
}

PKG='package.json'
MAIN='src/main/main.js'

# THE BASELINE COSTS WHAT THE CASES COST. A subset of build-only cases must not
# have to queue on the browser mutex just to establish that the tree is green
# before it is broken; a FULL battery always runs the real thing.
BASE_MODE=''
if [ "${#ONLY_CASES[@]}" -gt 0 ]; then
  BASE_MODE='build'
  for c in "${ONLY_CASES[@]}"; do case "$c" in 7|8|9|10) BASE_MODE='' ;; esac; done
fi
echo "${C_D}=== baseline — the suite must be GREEN before anything is broken${C_X}"
if [ -n "$BASE_MODE" ]; then
  echo "${C_D}    (build only — every selected case is a build case, so the mutex is not taken)${C_X}"
else
  echo "${C_D}    (a full run: it builds an installer AND launches it, so it queues on the shared mutex)${C_X}"
fi
if ! run_suite "$OUT/baseline.log" "$BASE_MODE"; then
  echo "${C_R}BASELINE IS RED${C_X} — nothing below would prove anything. Last lines:"
  tail -20 "$OUT/baseline.log"; exit 2
fi
echo "  ${C_G}green${C_X}  $(tail -1 "$OUT/baseline.log")"

# ============================================== 1-6: what the build produced
M 1 build "the deb target is dropped, so the build succeeds with one file missing" "$PKG" \
  '        {
          "target": "AppImage",
          "arch": [
            "x64"
          ]
        },
        {
          "target": "deb",
          "arch": [
            "x64"
          ]
        }
      ]
    }
  }
}' \
  '        {
          "target": "AppImage",
          "arch": [
            "x64"
          ]
        }
      ]
    }
  }
}' \
  '`electron-builder --linux --publish never` builds BOTH targets'

M 2 build "the feed goes back to null, so no app-update.yml is written into the installer at all" "$PKG" \
  '    "publish": {
      "provider": "github",
      "owner": "itziklerner-pag",
      "repo": "stem-workbench",
      "releaseType": "prerelease",
      "vPrefixedTagName": true
    },' \
  '    "publish": null,' \
  'the built installer CARRIES the electron-updater feed|...and it is on the PRE-RELEASE channel|...and `latest-linux.yml` describes exactly the two files that were built'

M 3 build "the shipped installer drops to the stable channel" "$PKG" \
  '"releaseType": "prerelease",' '"releaseType": "release",' \
  '...and it is on the PRE-RELEASE channel'

# THERE IS NO CASE 4. `latest-linux.yml` is written BY electron-builder from the
# same `publish` block and the same target list, so nothing can make it disagree
# with the artifacts on disk without also removing the feed (case 2) or a target
# (case 1) — and case 2's log carries that assertion's red. Inventing a config
# key to break it would have meant naming one electron-builder's schema rejects,
# which is a BUILD failure wearing a coverage row rather than a mutation.

# RE-POINTED, NOT REMOVED. electron-builder validates `build` against a schema
# and refuses unknown properties, so renaming the key would fail the BUILD and
# turn assertion 1 red instead of this one.
M 5 build "the weights are packaged somewhere main.js does not look" "$PKG" \
  '        "to": "model/htdemucs_6s.onnx"' \
  '        "to": "model-somewhere-else/htdemucs_6s.onnx"' \
  'the 109 MB of weights are on disk INSIDE the installer'

M 6 build "the files glob grows tools/, so the module --gate-probe names IS in the bundle" "$PKG" \
  '      "src/**/*",' \
  '      "src/**/*",
      "tools/**/*",' \
  '...and `tools/` is NOT in the asar'

# ============================================ 7-10: the packaged app running
M 7 launch "src/ is dropped from the bundle, so there is no app to start" "$PKG" \
  '      "src/**/*",' '      "srcNotBundled/**/*",' \
  'THE PACKAGED APP LAUNCHES AND REACHES ITS OWN READY SIGNAL'

M 8 launch "the vendored deck is dropped from the bundle" "$PKG" \
  '      "vendor/stem-splitter-live/extension/**/*",' \
  '      "vendor/stem-splitter-live/extension/shared/**/*",' \
  '...and the vendored deck came out of the ASAR over `app://`'

MODEL_CASE

M 10 launch "--gate becomes reachable in a packaged build, the way it is in a checkout" "$MAIN" \
  "const GATE = app.isPackaged ? '' : val('gate', '');" \
  "const GATE = val('gate', '');" \
  '...and `--gate=DIR` was passed to the SHIPPED binary and did nothing'

# ==========================================================================
echo
echo "${C_D}=== restored tree — the suite must be GREEN again${C_X}"
if run_suite "$OUT/restored.log" "$BASE_MODE"; then
  echo "  ${C_G}green${C_X}  $(tail -1 "$OUT/restored.log")"
else
  echo "  ${C_R}THE TREE DID NOT COME BACK${C_X} — a restore failed. See out/dist-linux-mutations/restored.log"
  tail -20 "$OUT/restored.log"; missed=$((missed + 1))
fi

echo
if [ "${#ONLY_CASES[@]}" -eq 0 ]; then
  python3 tools/suites/coverage.py "$OUT" || missed=$((missed + 1))
else
  echo "${C_D}coverage is only claimed after a FULL battery — a subset cannot make it${C_X}"
fi

echo
echo "dist-linux-mutations: $caught caught, $missed missed, of $ran run"
[ "$missed" -eq 0 ]
