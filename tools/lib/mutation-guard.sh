# The mutation guard, for bash batteries. Sourced, never executed.
#
# WHAT IT IS FOR is written at length in `tools/lib/tree-guard.mjs`: a battery
# that dies without restoring leaves its edit standing on a shipped file, and the
# next gate run measures the mutated tree and reports a red that is not in the
# code (stem-workbench#22). Traps close `timeout` and Ctrl-C; the SENTINEL closes
# `kill -9`, a crashed host and a full disk, because no trap runs for those.
#
# A battery sets MG_BATTERY and MG_ROOT, sources this, and installs the trap:
#
#   MG_BATTERY='shell-mutations'; MG_ROOT="$ROOT"
#   . "$ROOT/tools/lib/mutation-guard.sh"
#   trap mg_on_signal INT TERM HUP
#
# then, inside its own case, AFTER the backups exist and BEFORE the first edit:
#
#   mg_claim "$n" "src/main/main.js=$OUT/8.main.js.bak"
#
# and after the restore has been byte-verified:
#
#   mg_release "$n"
#
# The sentinel carries the (file, backup) pairs, so `mg_restore` puts the tree
# back from the sentinel itself rather than from a naming convention each battery
# reinvents. That is also what a human runs after a `kill -9`:
#
#   node tools/lib/tree-guard.mjs restore-all
mg_guard() { node "$MG_ROOT/tools/lib/tree-guard.mjs" "$@"; }
mg_claim() { local n="$1"; shift; mg_guard claim "$MG_BATTERY" "$n" "$@"; }
mg_release() { mg_guard release "$MG_BATTERY" "$1"; }
mg_restore() { mg_guard restore "$MG_BATTERY"; }

# EXIT 130, and the restore happens BEFORE anything else so a second signal
# arriving during the report cannot cost the tree.
mg_on_signal() {
  echo
  echo "INTERRUPTED — putting $MG_BATTERY's tree back before exiting."
  # THE SENTINEL RESTORE FIRST, then whatever else this battery had to undo —
  # a shared sink, a foreign writer, its own `.paths` bookkeeping. MG_ALSO names
  # the battery's own handler where it had one; the two are not alternatives.
  mg_restore
  [ -n "${MG_ALSO:-}" ] && "$MG_ALSO"
  git -C "$MG_ROOT" status --short -- src tools vendor spike || true
  exit 130
}
