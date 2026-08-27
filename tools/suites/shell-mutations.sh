#!/usr/bin/env bash
# Watch every assertion in `tools/suites/shell.mjs` go RED, one mutation at a
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
#   tools/suites/shell-mutations.sh            # all of them
#   tools/suites/shell-mutations.sh 4 7 11     # only these cases
#
# Each case costs one real Electron launch (~12 s). The whole run is ~4 minutes.
#
# IT RESTORES ON SIGINT, SIGTERM AND SIGHUP, and that is not tidiness. This
# battery was killed mid-case once and left `contextIsolation: false` standing in
# `src/main/main.js` — case 28's edit, on a SHIPPED file, with nothing reporting
# it. The happy path and the anchor-not-found path already restore; a signal did
# not. `$OUT/<n>.paths` records the exact relative paths a case is about to
# touch, so the trap restores BY PATH and never guesses one back from a
# basename; the file is removed the moment the case has restored and verified,
# which is what keeps the trap from undoing an already-good tree.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$ROOT/out/shell-mutations"
rm -rf "$OUT"; mkdir -p "$OUT"
cd "$ROOT"
# THE MUTATION GUARD. Traps are the belt: this battery restores on INT, TERM and
# HUP, and `timeout` sends TERM — which is how a long battery is most likely to
# die and was the one way it did not clean up (stem-workbench#22). The SENTINEL
# is the braces, for `kill -9`, a crashed host and a full disk, where no trap
# runs at all: while a mutation is standing there is a file under
# `out/.mutating/` naming it, and every suite refuses to start while one is
# there. `tools/lib/tree-guard.mjs` is the long form.
MG_BATTERY='shell-mutations'; MG_ROOT="$ROOT"
. "$ROOT/tools/lib/mutation-guard.sh"
trap mg_on_signal INT TERM HUP   # on_signal() below is chained in via MG_ALSO

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

# The backup file for (case, path). THE WHOLE PATH GOES IN THE NAME, not the
# basename: `vendor/.../ui/host.js` and `vendor/.../offscreen/host.js` are both
# `host.js`, and a basename-keyed backup silently overwrote one with the other —
# measured, on the first real run of case B, which then restored the OFFSCREEN
# hole module over the DECK's and left the vendored tree broken for the next run.
bak_of() { printf '%s/%s.%s.bak' "$OUT" "$1" "$(printf '%s' "$2" | tr '/' '_')"; }

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
    node tools/suites/shell.mjs >"$1" 2>&1
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
  for f in "${flist[@]}"; do cp "$ROOT/$f" "$(bak_of "$n" "$f")"; mg_pairs+=("$f=$(bak_of "$n" "$f")"); done
  # THE SENTINEL GOES DOWN BEFORE THE FIRST EDIT AND COMES UP ONLY ONCE THE
  # RESTORE HAS BEEN BYTE-VERIFIED. A `kill -9` here leaves it standing, and
  # every suite then REFUSES TO RUN rather than measuring the mutation — which
  # is stem-workbench#22, the false red that outlives the run that caused it.
  mg_claim "$n" "${mg_pairs[@]}"

  while [ "$#" -ge 3 ]; do
    if ! edit "$ROOT/$1" "$2" "$3"; then
      echo "${C_R}MUTATION $n DID NOT APPLY${C_X} — the anchor text in $1 has moved. Fix this script."
      for f in "${flist[@]}"; do cp "$(bak_of "$n" "$f")" "$ROOT/$f"; done
      rm -f "$OUT/$n.paths"
      mg_release "$n"; missed=$((missed + 1)); return 0
    fi
    shift 3
  done

  local log="$OUT/$n.log"
  run_suite "$log"; local code=$?

  for f in "${flist[@]}"; do cp "$(bak_of "$n" "$f")" "$ROOT/$f"; done
  for f in "${flist[@]}"; do
    if ! cmp -s "$ROOT/$f" "$(bak_of "$n" "$f")"; then
      echo "${C_R}RESTORE FAILED for $f${C_X}"; missed=$((missed + 1)); return 0
    fi
  done
  # RESTORED AND BYTE-VERIFIED, so the sentinel comes up. A restore that FAILED
  # returns above without releasing, on purpose: the mutation really is still
  # standing then, and the next suite must refuse rather than measure it.
  mg_release "$n"
  rm -f "$OUT/$n.paths"        # restored AND verified — nothing left for the trap

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
  echo "  ${C_D}$n_fail assertion(s) red in total · $(tail -1 "$log") · log out/shell-mutations/$n.log${C_X}"

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
mutate_case 1 "drop COOP + COEP from every app:// response" \
  "src/main/assets.js" \
  "the engine document is cross-origin isolated|...and SharedArrayBuffer constructs there|...and a module worker inherits it|...and the deck slot is isolated too|every app:// response carries COOP, COEP and CORP" \
  -- src/main/assets.js \
"  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
  'cross-origin-resource-policy': 'same-origin'," \
"  'cross-origin-resource-policy': 'same-origin',"

mutate_case 2 "drop the path containment test" \
  "src/main/assets.js" \
  "...and refuses a traversal, a NUL byte and a sibling directory|...and the live handler refuses a percent-encoded traversal" \
  -- src/main/assets.js \
"  if (file !== dir && !file.startsWith(dir + path.sep)) {" \
"  if (false) {"

mutate_case 3 "suffix match becomes host.includes('youtube.com')" \
  "src/main/navigation.js" \
  "...and every off-list host is refused, including the \`includes()\` trap" \
  -- src/main/navigation.js \
"  return NAV_ALLOW.includes(host) || host.endsWith(NAV_ALLOW_SUFFIX);" \
"  return host.includes('youtube.com') || NAV_ALLOW.includes(host);"

mutate_case 4 "mute the source view AFTER its first load, not before" \
  "src/main/youtube.js" \
  "the source view is muted BEFORE it loads anything" \
  -- src/main/youtube.js \
"  wc.setAudioMuted(true);

  const witness = {" \
"  const witness = {" \
  src/main/youtube.js \
"      await wc.loadURL(url);" \
"      await wc.loadURL(url);
      wc.setAudioMuted(true);"

# NOT assertion 31: the window.open denial ALSO writes the refusal line, so the
# bar stays populated with the guard gone. Case 16 is the one that empties it.
mutate_case 5 "delete the will-navigate / will-redirect guard" \
  "src/main/youtube.js" \
  "a renderer-initiated navigation off the allowlist is refused" \
  -- src/main/youtube.js \
"  wc.on('will-navigate', guard);
  wc.on('will-redirect', guard);" \
"  void guard;"

mutate_case 6 "let window.open through" \
  "src/main/youtube.js" \
  "...and window.open is denied" \
  -- src/main/youtube.js \
"    return { action: 'deny' };" \
"    return { action: 'allow' };"

mutate_case 7 "grant the CHROME frame instead of the source view's" \
  "src/main/main.js" \
  "the capture grant answers the engine with the SOURCE view's frame" \
  -- src/main/main.js \
"    () => (state.source && !state.source.webContents.isDestroyed() ? state.source.webContents.mainFrame : null)," \
"    () => state.chrome.webContents.mainFrame,"

mutate_case 8 "do not attach the deck view to the window" \
  "src/main/main.js" \
  "the window is one BaseWindow with the three views attached" \
  -- src/main/main.js \
"  state.win.contentView.addChildView(state.deck);" \
"  void state.deck;"

mutate_case 9 "stamp an extra field onto every routed envelope" \
  "src/main/bus.js" \
  "...and the envelope arrives exactly as sent" \
  -- src/main/bus.js \
"      wc.send(BUS_CHANNEL, msg);     // the SAME object. Not a copy with a field added." \
"      wc.send(BUS_CHANNEL, { ...msg, hostSaw: true });"

mutate_case 10 "delete the protocol-version guard" \
  "src/main/bus.js" \
  "...and a message whose protocol version is not 1 is dropped as malformed" \
  -- src/main/bus.js \
"    if (!msg || msg.v !== 1 || typeof msg.to !== 'string') { drop('malformed'); return void observe(msg, 'malformed'); }" \
"    if (!msg || typeof msg.to !== 'string') { drop('malformed'); return void observe(msg, 'malformed'); }"

mutate_case 11 "let any renderer ask for a display capture" \
  "src/main/capture.js" \
  "the deck may not open a capture" \
  -- src/main/capture.js \
"  const mayCapture = (wc) => !!wc && isCaptor(wc);" \
"  const mayCapture = (wc) => !!wc || isCaptor(wc);"

mutate_case 12 "turn nodeIntegration on for our renderers" \
  "src/main/main.js" \
  "every renderer runs with contextIsolation on, sandbox on and nodeIntegration off" \
  -- src/main/main.js \
"const OUR_WEB_PREFERENCES = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false," \
"const OUR_WEB_PREFERENCES = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: true,"

mutate_case 13 "delete the Arm control from the chrome bar" \
  "src/renderer/chrome.html" \
  "the chrome bar painted, with its Arm control present, ENABLED and wired to a bridge" \
  -- src/renderer/chrome.html \
'  <button id="arm" title="Arm this Source — the same gesture as Source → Arm this Source">Arm</button>
' \
""

# THE DEFECT THIS ASSERTION USED TO PIN IN PLACE. The button shipped `disabled`
# for a wave after arming worked, and the old assertion REQUIRED that. Putting
# the attribute back must now be red.
mutate_case 13b "put the Arm control back to `disabled`" \
  "src/renderer/chrome.html" \
  "the chrome bar painted, with its Arm control present, ENABLED and wired to a bridge" \
  -- src/renderer/chrome.html \
'<button id="arm" title=' \
'<button id="arm" disabled title='

mutate_case 14 "do not write the gate report" \
  "tools/gate/probe.mjs" \
  "the app launches from its real entry point and writes a gate report" \
  -- tools/gate/probe.mjs \
"  fs.writeFileSync(path.join(outDir, 'report.json'), \`\${JSON.stringify(R, null, 2)}\n\`);
  console.log(\`[gate] wrote \${path.join(outDir, 'report.json')}\`);" \
"  /* MUTATION: the report is not written */"

mutate_case 15 "ask for getDisplayMedia({audio: true}) — the Limitation-6 run" \
  "tools/gate/probe.mjs" \
  "...and the track is one stereo 44100 audio track" \
  -- tools/gate/probe.mjs \
"      audio: { autoGainControl: false, echoCancellation: false, noiseSuppression: false },
      video: true," \
"      audio: true,
      video: true,"

mutate_case 16 "note the refusal in main and never tell the chrome bar" \
  "src/main/main.js" \
  "...and the refusal is visible in the chrome bar" \
  -- src/main/main.js \
"  console.warn(\`[source] refused \${r.url} — \${r.why}\`);
  pushStatus();" \
"  console.warn(\`[source] refused \${r.url} — \${r.why}\`);"


# --------------------------------------------------------------------------
# Cases 17-28 exist because of a COVERAGE AUDIT, not because of a hunch: the
# first sixteen left eleven of the suite's assertions (34 of them at the time)
# with no mutation of their own, and an assertion nothing has ever broken is an
# assumption wearing an `ok`. Each of these turns one of those eleven red.
# --------------------------------------------------------------------------

mutate_case 17 "allow only the exact hosts, dropping the *.youtube.com suffix" \
  "src/main/navigation.js" \
  "every host on the navigation allowlist is admitted" \
  -- src/main/navigation.js \
"  return NAV_ALLOW.includes(host) || host.endsWith(NAV_ALLOW_SUFFIX);" \
"  return NAV_ALLOW.includes(host);"

mutate_case 18 "stop requiring https" \
  "src/main/navigation.js" \
  "...and so is every scheme that is not https" \
  -- src/main/navigation.js \
"  if (u.protocol !== 'https:') return false;" \
"  if (u.protocol === 'never-this:') return false;"

mutate_case 19 "match the SHORTEST root prefix instead of the longest" \
  "src/main/assets.js" \
  "the app:// path table maps our pages and the vendored tree" \
  -- src/main/assets.js \
"  const hit = [...roots].sort((a, b) => b.prefix.length - a.prefix.length)" \
"  const hit = [...roots].sort((a, b) => a.prefix.length - b.prefix.length)"

mutate_case 20 "serve any app:// host, not only \`workbench\`" \
  "src/main/assets.js" \
  "...and a host that is not \`workbench\` is not served at all" \
  -- src/main/assets.js \
"  if (urlHost !== APP_HOST) return" \
"  if (urlHost === 'never-this') return"

mutate_case 21 "show the engine window" \
  "src/main/main.js" \
  "...and the engine is a hidden BrowserWindow of its own" \
  -- src/main/main.js \
"    show: false, skipTaskbar: true, width: 900, height: 600," \
"    show: true, skipTaskbar: true, width: 900, height: 600,"

mutate_case 22 "expose a bridge to the page inside the source view" \
  "src/preload/youtube.cjs" \
  "the source view's page sees no bridge of ours" \
  -- src/preload/youtube.cjs \
"up({ t: 'hello', have: !!el });" \
"up({ t: 'hello', have: !!el });
require('electron').contextBridge.exposeInMainWorld('__wbYouTube', { hello: () => 'leaked' });"

mutate_case 23 "put the source view on OUR session instead of persist:youtube" \
  "src/main/main.js" \
  "the source view is alone on persist:youtube" \
  -- src/main/main.js \
"  state.source = createSourceView({ session: theirs," \
"  state.source = createSourceView({ session: ours,"

mutate_case 24 "never register the deck on its address" \
  "src/main/bus.js,src/main/main.js" \
  "a DETACHED send() from the engine reaches the deck's address" \
  -- src/main/main.js \
"  state.bus.register(BUS.deck, state.deck.webContents);" \
"  void state.deck;"

mutate_case 25 "count a no-listener drop as a malformed one" \
  "src/main/bus.js" \
  "...and a message to an address nobody listens on is dropped and counted" \
  -- src/main/bus.js \
"    if (!targets || !targets.size) { drop('no-listener'); return void observe(msg, 'no-listener'); }" \
"    if (!targets || !targets.size) { drop('malformed'); return void observe(msg, 'no-listener'); }"

mutate_case 26 "let the source view have every permission it asks for" \
  "src/main/youtube.js" \
  "...and neither may a page inside the source view" \
  -- src/main/youtube.js \
"  const allowed = new Set(SOURCE_PERMISSIONS_ALLOWED);" \
"  const allowed = new Set(['fullscreen', 'media', 'display-capture']);"

mutate_case 27 "point the deck slot at the wrong page" \
  "src/main/main.js" \
  "the deck slot loads the vendored deck when it is present" \
  -- src/main/main.js \
"  const deckUrl = deckVendored() ? appUrl(DECK_ENTRY) : appUrl('deck-placeholder.html');" \
"  const deckUrl = appUrl('chrome.html');"

# WHAT THIS CASE TURNS RED CHANGED WHEN THE UNIT LANDED, AND THE ROW FOLLOWED
# THE MEASUREMENT RATHER THAN THE OTHER WAY ROUND. It used to name "no renderer
# can see require" and seven more. It cannot any more: with `contextIsolation`
# off, `contextBridge` THROWS in all three of our preloads ("contextBridge API
# can only be used when contextIsolation is enabled"), the vendored `engine.js`
# and `embed.js` then die on `Failed to fetch dynamically imported module:
# node:url`, both render processes go, and the gate never writes a report. So
# the honest red is the LAUNCH — measured, in out/shell-mutations/28.log — and
# every assertion after it is unreachable under this mutation because there is
# no running app to ask. Case 32 is what covers the `require` assertion now.
mutate_case 28 "turn OFF contextIsolation and the sandbox, and node integration ON" \
  "src/main/main.js" \
  "the app launches from its real entry point and writes a gate report" \
  -- src/main/main.js \
"const OUR_WEB_PREFERENCES = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false," \
"const OUR_WEB_PREFERENCES = {
  contextIsolation: false,
  sandbox: false,
  nodeIntegration: true,"

# ==========================================================================
# 29-31  THE PROBE'S OWN EYES ON THE DECK SLOT
#
# All three were added when the deck slot stopped being our placeholder and
# started being the vendored `ui/embed.html`. The probe had been reading
# `window.__wbProbe()` and `window.__wbBusLog()` — two globals that only
# `src/renderer/deck-placeholder.js` defines — so it was reporting on a page
# that had stopped existing: `coi=undefined sab=undefined`, and `0 of 1 arrived`
# about a bus that was working, while `deck-host` and `deck-seam` stayed green
# throughout. These three are what stops that happening again in silence.
# ==========================================================================
mutate_case 29 "expose no inbox from the deck's preload — the deck has nowhere to receive" \
  "src/preload/deck.cjs" \
  "INSTRUMENT CHECK: the gate's bus recorder installed on the deck|a DETACHED send() from the engine reaches the deck's address|...and the envelope arrives exactly as sent" \
  -- src/preload/deck.cjs \
"  /** @returns an unsubscribe function. The address guard is the hole module's. */
  onMessage: onBus," \
"  /** @returns an unsubscribe function. The address guard is the hole module's. */"

# THE INSTRUMENT CHECK AND THE CLAIM ARE TWO ASSERTIONS, and this is the case
# that proves it: the recorder installs perfectly and reads the WRONG LIST — the
# placeholder's, which is the exact failure that stood for a whole wave. The
# instrument check stays green here, on purpose. If it went red too it would be
# a second copy of the row below rather than a separate claim.
mutate_case 30 "the probe reads the placeholder's old bus log instead of its own recorder" \
  "tools/gate/probe.mjs" \
  "a DETACHED send() from the engine reaches the deck's address|...and the envelope arrives exactly as sent" \
  -- tools/gate/probe.mjs \
"    deckReceived: await evalIn(deckWc, 'window.__wbGateBus')," \
"    deckReceived: await evalIn(deckWc, 'window.__wbBusLog()'),"

# AND THE ISOLATION HALF OF THE SAME MISTAKE. `window.__wbProbe` is the
# placeholder's; asking the vendored deck page for it is how this assertion came
# to report `coi=undefined` about a page that is isolated.
mutate_case 31 "the probe asks the deck page for the placeholder's isolation global" \
  "tools/gate/probe.mjs" \
  "...and the deck slot is isolated too" \
  -- tools/gate/probe.mjs \
"    deck: await evalIn(deckWc, \"import(location.origin + '/isolation.js').then((m) => m.probeIsolation())\")," \
"    deck: await evalIn(deckWc, 'window.__wbProbe()'),"

# ==========================================================================
# 32  THE SOURCE VIEW'S OWN ISOLATION, WHICH IS THE ONE THAT FACES A HOSTILE PAGE
#
# THE ASSERTION THIS COVERS HAD NO LIVE MUTATION LEFT once case 28 stopped being
# able to start the app, and `tools/suites/coverage.py` said so. Two candidates
# were measured before this one:
#
#   · `sandbox: false, nodeIntegration: true` with `contextIsolation` left ON in
#     OUR_WEB_PREFERENCES. The app starts, but "no renderer can see require"
#     stays GREEN — with context isolation on, node's globals go into the
#     preload's isolated world and never into the page's. Only the prefs row
#     goes red, which case 12 already covers.
#   · case 28's own edit. The app does not start at all; see above.
#
# So the mutation is on the SOURCE view's webPreferences, which are its own in
# `src/main/youtube.js` and not `OUR_WEB_PREFERENCES`. Its preload holds no
# `contextBridge` call, so it survives isolation being off — the app stays up,
# the page gets `require`, and the assertion goes red at 3/4. That view is also
# the only one that ever loads a page we did not write, so this is the direction
# the claim actually matters in.
# ==========================================================================
mutate_case 32 "turn OFF the SOURCE view's own isolation, sandbox and node guard" \
  "src/main/youtube.js" \
  "every renderer runs with contextIsolation on, sandbox on and nodeIntegration off|...and no renderer can see \`require\`, \`process\` or \`module\`" \
  -- src/main/youtube.js \
"      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false," \
"      contextIsolation: false,
      sandbox: false,
      nodeIntegration: true,
      webviewTag: false,"

# ==========================================================================
# 33-37  SEED §9 — THE SIGN-IN DISGUISE
#
# Google refuses sign-in from an embedded framework by user-agent, so the
# partition youtube.com runs on presents a stock Chrome one. Two directions of
# failure, and only one of them is dangerous: 33 takes the disguise away (the
# feature is gone, and the user meets "this browser or app may not be secure");
# 34 puts it on EVERY session at once, which is one line and would have the
# update check lying to a host this app has no reason to lie to. A gate written
# only against the source view's UA is GREEN over 34, which is why the second
# assertion reads OUR session, OUR renderers and `app.userAgentFallback`.
# ==========================================================================
mutate_case 33 "never set the user-agent on the partition — the app is Electron to Google again" \
  "src/main/sessions.js" \
  "the source partition presents a STOCK CHROME user-agent" \
  -- src/main/sessions.js \
"        ses.setUserAgent(ua);" \
"        void ua;"

# THE DANGEROUS DIRECTION. `app.userAgentFallback` is the global default for
# every session that has not overridden it, so this leaves the source view's
# explicit UA exactly as it was and disguises OURS — the update check included.
# It is the mutation the first assertion cannot see.
mutate_case 34 "disguise EVERY session with app.userAgentFallback, the update check included" \
  "src/main/main.js" \
  "...and NOTHING of ours wears it" \
  -- src/main/main.js \
"app.commandLine.appendSwitch('disable-renderer-backgrounding');" \
"app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.userAgentFallback = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';"

# THE HOST THE FLOW STARTS AT. Removing it from the allowlist leaves the OLD
# allowlist assertion green — it iterates NAV_ALLOW, so a shorter list is a
# shorter loop — and turns red the two written for seed §9: the pure one that
# names the four hosts as literals, and the live one that watches the request
# reach the wire.
mutate_case 35 "drop accounts.google.com from the navigation allowlist" \
  "src/main/navigation.js" \
  "the four hosts a Google sign-in goes through are on the allowlist BY NAME|every host a Google sign-in is redirected through really goes ON THE WIRE" \
  -- src/main/navigation.js \
"  'accounts.google.com',
  'accounts.youtube.com'," \
"  'accounts.youtube.com',"

# A UA THAT IS NOT A STOCK CHROME UA. Real Chrome has reported
# `<major>.0.0.0` since its UA reduction; the full build number is the shape an
# embedded framework has, which is the thing being avoided.
mutate_case 36 "report the full Chromium build number, which no stock Chrome does" \
  "src/main/useragent.js" \
  "the stock Chrome user-agent is Chrome-shaped on every platform|the source partition presents a STOCK CHROME user-agent" \
  -- src/main/useragent.js \
"Chrome/\${major}.0.0.0 Safari/537.36\`;" \
"Chrome/\${String(chromeVersion)} Safari/537.36\`;"

# THE TABLE, WIDENED TO OUR OWN SESSION. `makeSession()` refuses this outright
# rather than applying it, so the app does not boot — which is the right shape
# of failure and is reported alongside the pure assertion the case is for.
mutate_case 37 "declare the app's own session as one that presents the disguise" \
  "src/main/useragent.js" \
  "only USER-owned sessions present the disguise" \
  -- src/main/useragent.js \
"export const UA_SESSIONS = Object.freeze(['youtube']);" \
"export const UA_SESSIONS = Object.freeze(['youtube', 'app']);"

# ==========================================================================
# THE COVERAGE CHECK, and it is the point of the whole file.
#
# "32 mutations were caught" is not the claim worth making. The claim is that
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
[ "$missed" -gt 0 ] && echo "${C_R}$missed of $ran mutations were NOT caught${C_X} (caught $caught). Logs in out/shell-mutations/."
[ "$cover" -ne 0 ] && echo "${C_R}an assertion in the suite has no mutation${C_X} — see the coverage list above."
exit 1
