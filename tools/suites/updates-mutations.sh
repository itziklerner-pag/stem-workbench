#!/usr/bin/env bash
# Watch every assertion in `tools/suites/updates.mjs` go RED, one mutation at a
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
# worth making: not "31 mutations were caught" but "no assertion has gone
# unbroken".
#
#   tools/suites/updates-mutations.sh            # every case (~15 s)
#   tools/suites/updates-mutations.sh 17 19      # only these
#
# ---------------------------------------------------------------------------
# WHAT IS NOT HERE, AND WHERE IT IS INSTEAD
# ---------------------------------------------------------------------------
# RE-POINTING `UPDATE_HOST` AT A SECOND HOST. That mutation must be watched on
# `p1`, not here, and the difference is the whole point of the split: `p1.mjs`,
# `sessions.js` and `smoke.mjs` all IMPORT the constant, so moving it moves the
# policy and the assertion together — which is deliberate, and is what makes the
# gate measure "one host" rather than "this host". What catches an unmeant
# re-point is `p1` standing up a fake TLS host whose CERTIFICATE carries
# `UPDATE_HOST`'s name: the re-pointed run fails to resolve and the suite goes
# red over a real launch. Case 1 below is the complement — a URL that stops
# agreeing with the constant it is supposed to be built from.
#
# NO CASE EDITS ANYTHING UNDER `vendor/`. Rule V1; there is nothing vendored in
# this suite's closure except `shared/config.js`, which it does not read.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$ROOT/out/updates-mutations"
rm -rf "$OUT"; mkdir -p "$OUT"
cd "$ROOT"
# THE MUTATION GUARD. Traps are the belt: this battery restores on INT, TERM and
# HUP, and `timeout` sends TERM. The SENTINEL is the braces, for `kill -9`:
# while a mutation is standing there is a file under `out/.mutating/` naming it,
# and every suite refuses to start while one is there (stem-workbench#22).
MG_BATTERY='updates-mutations'; MG_ROOT="$ROOT"
. "$ROOT/tools/lib/mutation-guard.sh"
trap mg_on_signal INT TERM HUP

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

run_suite() { node tools/suites/updates.mjs >"$1" 2>&1; }
fails_of() { grep -E '^FAIL' "$1" || true; }

ONLY=("$@")

# `M <n> <label> <file> <old> <new> <expect1|expect2…> [file2 old2 new2]`
#
# THE SECOND EDIT IS OPTIONAL AND EXISTS FOR ONE CASE. Case 22 asserts an
# ORDER — that `main` creates the store before it builds the update check — and
# an order can only be broken by MOVING something, which is a delete and an
# insert. A single-edit battery would have had to settle for deleting the call,
# which breaks the app rather than reordering it and is a weaker mutation.
M() {
  local n="$1" label="$2" file="$3" old="$4" new="$5" expect="$6"
  local file2="${7:-}" old2="${8:-}" new2="${9:-}"
  if [ "${#ONLY[@]}" -gt 0 ] && [[ ! " ${ONLY[*]} " =~ " $n " ]]; then return 0; fi

  echo
  echo "${C_D}=== mutation $n — $label${C_X}"
  ran=$((ran + 1))
  local bak="$OUT/$n.$(basename "$file").bak"
  cp "$ROOT/$file" "$bak"
  local bak2=""
  if [ -n "$file2" ]; then bak2="$OUT/$n.2.$(basename "$file2").bak"; cp "$ROOT/$file2" "$bak2"; fi
  # THE SENTINEL GOES DOWN BEFORE THE FIRST EDIT AND COMES UP ONLY ONCE THE
  # RESTORE HAS BEEN BYTE-VERIFIED.
  if [ -n "$file2" ]; then mg_claim "$n" "$file=$bak" "$file2=$bak2"; else mg_claim "$n" "$file=$bak"; fi

  local applied=1
  edit "$ROOT/$file" "$old" "$new" || applied=0
  if [ "$applied" = 1 ] && [ -n "$file2" ]; then
    edit "$ROOT/$file2" "$old2" "$new2" || applied=0
  fi
  if [ "$applied" = 0 ]; then
    echo "  ${C_R}DID NOT APPLY${C_X} — an anchor has moved. Fix this script."
    cp "$bak" "$ROOT/$file"; [ -n "$file2" ] && cp "$bak2" "$ROOT/$file2"
    mg_release "$n"; missed=$((missed + 1)); return 0
  fi

  local log="$OUT/$n.log"
  run_suite "$log"; local code=$?
  cp "$bak" "$ROOT/$file"
  [ -n "$file2" ] && cp "$bak2" "$ROOT/$file2"
  if ! cmp -s "$ROOT/$file" "$bak"; then
    echo "  ${C_R}RESTORE FAILED for $file${C_X}"; missed=$((missed + 1)); return 0
  fi
  if [ -n "$file2" ] && ! cmp -s "$ROOT/$file2" "$bak2"; then
    echo "  ${C_R}RESTORE FAILED for $file2${C_X}"; missed=$((missed + 1)); return 0
  fi
  # RESTORED AND BYTE-VERIFIED, so the sentinel comes up. A restore that FAILED
  # returns above without releasing, on purpose.
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

U='src/main/update.js'
P='src/main/p1.js'
S='src/main/storage.js'
MAIN='src/main/main.js'
PL='src/preload/chrome.cjs'
HTML='src/renderer/chrome.html'
PKG='package.json'
PLIST='build/entitlements.mac.plist'
WF='.github/workflows/package.yml'

echo "${C_D}=== baseline — the suite must be GREEN before anything is broken${C_X}"
if ! run_suite "$OUT/baseline.log"; then
  echo "${C_R}BASELINE IS RED${C_X} — nothing below would prove anything. Last lines:"
  tail -20 "$OUT/baseline.log"; exit 2
fi
echo "  ${C_G}green${C_X}  $(tail -1 "$OUT/baseline.log")"

# ====================================================== 1. one host, one path
M 1 "the URL stops being built from the constant it is supposed to name" "$U" \
  'export const UPDATE_URL = `https://${UPDATE_HOST}${UPDATE_PATH}`;' \
  "export const UPDATE_URL = \`https://github.com\${UPDATE_PATH}\`;" \
  'the update check resolves exactly one host|...and the app-owned policy admits that URL'

M 2 "the policy stops looking at the hostname and admits any https" "$P" \
  "  return u.protocol === 'https:' && u.hostname === UPDATE_HOST;" \
  "  return u.protocol === 'https:';" \
  '...and the app-owned policy admits that URL|...and the electron-updater FEED names a provider'

M 3 "the feed claims a provider whose host WOULD be ours" "$U" \
  "  provider: 'github'," "  provider: 'generic'," \
  '...and the electron-updater FEED names a provider|...and `UPDATER_FEED` and `build.publish` are the SAME OBJECT'

M 4 "the endpoint goes back to /releases/latest, which cannot return a pre-release" "$U" \
  'export const UPDATE_PATH = `/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases?per_page=20`;' \
  'export const UPDATE_PATH = `/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases/latest`;' \
  '...and the endpoint is the LIST'

# ========================================================== 2. the channel
M 5 "the code drops to the stable channel" "$U" \
  "export const UPDATE_CHANNEL = 'prerelease';" \
  "export const UPDATE_CHANNEL = 'stable';" \
  'the channel is `prerelease`|...and `package.json`'"'"'s `build.publish.releaseType`'

M 6 "package.json drops to the stable channel and the code does not" "$PKG" \
  '"releaseType": "prerelease",' '"releaseType": "release",' \
  '...and `package.json`'"'"'s `build.publish.releaseType`|...and `UPDATER_FEED` and `build.publish` are the SAME OBJECT'

M 7 "the feed grows a key the installer will never see" "$U" \
  '  vPrefixedTagName: true,
});' \
  '  vPrefixedTagName: true,
  private: false,
});' \
  '...and `UPDATER_FEED` and `build.publish` are the SAME OBJECT'

# ============================================== 2b. pickRelease, rule by rule
M 8 "a draft is offered" "$U" \
  "      && r.draft !== true
" "" \
  'A DRAFT IS NEVER OFFERED'

M 9 "the pre-release channel behaves like the stable one" "$U" \
  "      && (channel === 'prerelease' || r.prerelease !== true));" \
  "      && (r.prerelease !== true));" \
  '...and the `prerelease` channel OFFERS the newest pre-release'

M 10 "both channels become prereleases-only" "$U" \
  "      && (channel === 'prerelease' || r.prerelease !== true));" \
  "      && (r.prerelease === true));" \
  '...and it offers a STABLE release when that is the newest|...while the `stable` channel SKIPS a newer pre-release'

M 12 "the newest is whatever GitHub sent first" "$U" \
  '  usable.sort((a, b) => (at(b.r) - at(a.r)) || (a.i - b.i));' \
  '  // usable.sort(...) — array order, which GitHub documents as CREATION order' \
  '...and the newest is by `published_at`'

M 13 "an unknown channel is quietly treated as one we have" "$U" \
  "  if (!UPDATE_CHANNELS.includes(channel)) {
    throw new Error(\`update: \${JSON.stringify(channel)} is not a release channel this app has - \`
      + \`it names one of \${UPDATE_CHANNELS.join(', ')}.\`);
  }
  if (!Array.isArray(list)) return null;" \
  "  if (!Array.isArray(list)) return null;" \
  '...and a channel this app does not have THROWS'

M 14 "a single object reads as a release again, the way /releases/latest answered" "$U" \
  '  if (!Array.isArray(list)) return null;
  const usable = list' \
  '  if (!Array.isArray(list)) list = [list];
  const usable = list' \
  '...and an empty, absent or malformed answer is `null`'

# ============================================================== 3. the toggle
M 15 "the preference defaults OFF" "$U" \
  'export const AUTO_UPDATE_DEFAULT = true;' \
  'export const AUTO_UPDATE_DEFAULT = false;' \
  'the preference DEFAULTS ON|...and ONLY an explicit `false` turns it off|...and the CONTROL: the same value written to `session`'

M 16 "anything that is not literally true reads as off" "$U" \
  "  return typeof stored === 'boolean' ? stored : AUTO_UPDATE_DEFAULT;" \
  '  return stored === true;' \
  'the preference DEFAULTS ON|...and ONLY an explicit `false` turns it off'

M 17 "THE PREFERENCE MOVES TO session — the lifetime bug seed §14 is about" "$U" \
  "export const AUTO_UPDATE_AREA = 'local';" \
  "export const AUTO_UPDATE_AREA = 'session';" \
  '...and it lives in the `local` area|THE TOGGLE SURVIVES A RESTART'

M 19 "session starts persisting, so the restart row would be measuring the Map" "$S" \
  "  const mem = { local: new Map(), session: new Map() };" \
  "  const shared = new Map();
  const mem = { local: shared, session: shared };" \
  '...and the CONTROL: the same value written to `session`'

M 20 "setEnabled reports the move and does not make it" "$U" \
  '    if (want !== on) { on = want; stats.enabledChanges++; }' \
  '    if (want !== on) { stats.enabledChanges++; }' \
  '...and `setEnabled()` really moves what `check()` may do'

M 21 "a check while the toggle is off asks anyway" "$U" \
  "    if (!on) { stats.declined++; return { asked: false, ok: false, status: null, tag: null, prerelease: null }; }" \
  "    if (false) { stats.declined++; return { asked: false, ok: false, status: null, tag: null, prerelease: null }; }" \
  '...and a check while it is off DECLINES rather than asking'

# =========================================== 3b. the wiring main and the bar
M 22 "the store goes back below the update check, so the preference cannot be read at boot" "$MAIN" \
  "  state.storage = createStorage({ dir: app.getPath('userData') });

  /**
   * THE ONE HOST THIS APP'S OWN CODE TALKS TO." \
  "  /**
   * THE ONE HOST THIS APP'S OWN CODE TALKS TO." \
  'main creates the STORE before the update check' \
  "$MAIN" "  state.deckHost = installDeckHost({" \
  "  state.storage = createStorage({ dir: app.getPath('userData') });
  state.deckHost = installDeckHost({"

M 23 "the user preference REPLACES the command line instead of being ANDed with it" "$MAIN" \
  '  state.update = createUpdateCheck({ session: ours, enabled: UPDATE_CHECK && autoUpdate });' \
  '  state.update = createUpdateCheck({ session: ours, enabled: autoUpdate });' \
  '...and the user preference is ANDed with the command line'

M 24 "the bridge stops exposing the gesture, so the bar's control is dead" "$PL" \
  "  setAutoUpdate: (on) => ipcRenderer.invoke('chrome:autoUpdate', on === true)," "" \
  'the toggle is wired end to end across the three files'

M 25 "the visible toggle stops being an input" "$HTML" \
  '<input type="checkbox" id="autoupdate">' \
  '<span id="autoupdate"></span>' \
  '...and it is a VISIBLE control in the bar'

# =============================================== 4. the three platform blocks
M 26 "macOS stops being notarized" "$PKG" '"notarize": true' '"notarize": false' \
  'macOS is configured for the hardened runtime'

M 27 "the entitlement the wasm engine cannot start without goes missing" "$PLIST" \
  '<key>com.apple.security.cs.allow-jit</key>' \
  '<key>com.apple.security.cs.allow-nothing-at-all</key>' \
  '...and the entitlements file it names is a real plist'

M 28 "Azure Trusted Signing is put into build.win, where it breaks every beta build" "$PKG" \
  '    "win": {
      "target": [' \
  '    "win": {
      "azureSignOptions": {
        "publisherName": "stem-workbench",
        "endpoint": "https://weu.codesigning.azure.net",
        "codeSigningAccountName": "stem-workbench",
        "certificateProfileName": "stem-workbench-public-trust"
      },
      "target": [' \
  'Windows builds NSIS and is UNSIGNED during beta'

M 29 "the signed script loses the endpoint, so it could never sign anything" "$PKG" \
  '-c.win.azureSignOptions.endpoint=\"https://weu.codesigning.azure.net\" ' '' \
  '...and Azure Trusted Signing IS configured, on its own script'

M 30 "the deb loses the maintainer it cannot be built without" "$PKG" \
  '      "maintainer": "Claudia Isaacs <claudia@progforce.com>",
' '' \
  'Linux builds AppImage AND deb'

# ======================================= 5. configure the feed, never release
M 31 "a dist script loses --publish never" "$PKG" \
  '"dist:linux": "electron-builder --linux --publish never"' \
  '"dist:linux": "electron-builder --linux"' \
  'EVERY electron-builder script carries `--publish never`'

M 32 "the feed goes back to being unnamed, so the installer can never update" "$PKG" \
  '      "provider": "github",
      "owner": "itziklerner-pag",' \
  '      "provider": null,
      "owner": "itziklerner-pag",' \
  '...and `build.publish` nevertheless NAMES the feed|...and `UPDATER_FEED` and `build.publish` are the SAME OBJECT'

M 33 "CI starts creating a GitHub Release" "$WF" \
  '      - uses: actions/upload-artifact@v4' \
  '      - run: gh release create "v$(node -p "require(\"./package.json\").version")" dist/*
      - uses: actions/upload-artifact@v4' \
  '...and CI uploads ARTIFACTS and creates no release'

# ==========================================================================
echo
echo "${C_D}=== restored tree — the suite must be GREEN again${C_X}"
if run_suite "$OUT/restored.log"; then
  echo "  ${C_G}green${C_X}  $(tail -1 "$OUT/restored.log")"
else
  echo "  ${C_R}THE TREE DID NOT COME BACK${C_X} — a restore failed. See out/updates-mutations/restored.log"
  tail -20 "$OUT/restored.log"; missed=$((missed + 1))
fi

echo
if [ "${#ONLY[@]}" -eq 0 ]; then
  python3 tools/suites/coverage.py "$OUT" || missed=$((missed + 1))
else
  echo "${C_D}coverage is only claimed after a FULL battery — a subset cannot make it${C_X}"
fi

echo
echo "updates-mutations: $caught caught, $missed missed, of $ran run"
[ "$missed" -eq 0 ]
