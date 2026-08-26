/**
 * The keys the deck claims, and the chord that arms it. Two tables and one
 * decision, all pure — no `electron` import, so they can be asserted directly in
 * plain node without a display, a launch or the shared mutex.
 *
 * `src/main/deck-host.js` is the half that wires them to `before-input-event`
 * and to the application menu.
 *
 * ---------------------------------------------------------------------------
 * WHY MAIN ROUTES KEYS AT ALL
 * ---------------------------------------------------------------------------
 * In the extension the deck is a cross-origin iframe on somebody's watch page,
 * and a key event never crosses that boundary: `content.js` takes the keys out
 * of the page's hands in the capture phase and posts them in. `DeckPage.onKey`
 * is that arrangement written down — "a key the HOST took out of its own page's
 * hands and gave to the deck".
 *
 * Here the deck is a `WebContentsView` in our own window, and the gesture the
 * feature exists for is unchanged: the user clicks the YouTube view's play
 * button and then reaches for a digit. Focus is on the YouTube view, so a
 * listener inside the deck alone is a feature that works only after you have
 * clicked the deck — which is not a feature. `before-input-event` on the views
 * we own is the same take-and-forward, one process out.
 *
 * ---------------------------------------------------------------------------
 * THE PRODUCT RULING SURVIVES THE PORT: ONLY WHILE A DECK IS ARMED
 * ---------------------------------------------------------------------------
 * With no deck armed, `1`-`6` must reach YouTube and seek to 10-60 % exactly as
 * they do with this app not running. We are a guest in that view. `claimKeys`
 * carries BOTH facts — `{armed, keys}` — and this file holds no opinion about
 * either: the unit is what knows which keys this build has, which is why the
 * list is sent rather than duplicated here.
 */

/**
 * The arm chord, in the UNIT'S token vocabulary — HOST-DESIGN.md §6.3.
 *
 * ONE TABLE, TWO CONSUMERS, and they must not drift: the application menu binds
 * it, and `armShortcut()` reports it. A chord reported but not bound is worse
 * than no chord at all, so the reporting side reads the INSTALLED menu back
 * rather than this constant (see `deck-host.js`), and this constant is only what
 * the menu is built from.
 *
 * `Command+…` / `Ctrl+…` AND NEVER `CommandOrControl+…`. Electron's accelerator
 * grammar accepts all three; `chordLabel()` in the unit understands the first
 * two and draws anything else on the key cap VERBATIM. So a Host that answered
 * with Electron's portable spelling would put the word "CommandOrControl" in
 * front of the user, on a surface where nothing goes red because it renders
 * perfectly. `shared/host.js` writes the vocabulary down for exactly this
 * reason: `MacCtrl`, `Ctrl`, `Command`, `Alt`, `Shift`, plus the four glyphs
 * Chrome hands back already drawn on macOS.
 *
 * NOT `globalShortcut`, which steals the chord from every other application
 * whether or not we are focused and needs an accessibility grant on macOS that
 * a music toy has no business asking for. A menu accelerator fires whenever our
 * window is focused — which is whenever the user is looking at the deck or the
 * source, since both are inside it.
 */
export const ARM_ACCEL = process.platform === 'darwin' ? 'Command+Shift+A' : 'Ctrl+Shift+A';

/**
 * Tokens `chordLabel()` (`ui/embed-state.js`) can spell. Anything outside this
 * set is drawn verbatim on a key cap, which is the silent cosmetic failure the
 * accelerator above is written to avoid — so it is asserted rather than trusted.
 */
export const CHORD_VOCABULARY = Object.freeze(['MacCtrl', 'Ctrl', 'Command', 'Alt', 'Shift']);

/**
 * Is every modifier token in `accel` one the unit can spell?
 *
 * The FINAL token is the key itself (`A`, `9`, `F5`) and is drawn verbatim on
 * purpose — that is what a key cap is. Only the modifiers are checked.
 *
 * @param {string} accel
 * @returns {boolean}
 */
export function chordIsSpellable(accel) {
  if (typeof accel !== 'string' || accel.trim() === '') return false;
  const parts = accel.trim().split('+');
  return parts.slice(0, -1).every((p) => CHORD_VOCABULARY.includes(p))
    && parts[parts.length - 1].length > 0;
}

/**
 * Does this input event belong to the deck rather than to the page under it?
 *
 * The shape is deliberately `armed !== true` and `claim.keys` read as a list,
 * not `!claim || (real check)`: an absent claim, a claim with no keys and a
 * claim that says disarmed must all mean "leave the key alone", and folding
 * them into one truthiness test is how the permissive branch ends up being the
 * one taken when there was nothing to look at.
 *
 * `typing` IS THE HOST'S ANSWER AND NOT THE DECK'S. `DeckPage.onKey`'s typedef
 * says so: "`typing` is deliberately not carried: the host checked its own
 * document, which is the only one that had a focus target". Here the source
 * view's preload reports whether its own focus is in an editable, and this
 * function is handed that answer.
 *
 * @param {object} o
 * @param {{armed: boolean, keys: string[]}|null} o.claim  what the deck last claimed
 * @param {{type: string, code: string, key: string, control: boolean, meta: boolean}} o.input
 * @param {boolean} o.typing  is the focus of the view this arrived from an editable
 * @returns {boolean}
 */
export function deckTakesKey({ claim, input, typing }) {
  if (!input || input.type !== 'keyDown') return false;
  if (typing === true) return false;
  // A chord is somebody else's: Ctrl+C, Cmd+R and every menu accelerator,
  // including the arm chord itself, which must reach the menu and not the deck.
  if (input.control === true || input.meta === true) return false;
  if (!claim || claim.armed !== true) return false;
  const keys = Array.isArray(claim.keys) ? claim.keys : [];
  // `?` is the one key matched by CHARACTER rather than by position: which
  // physical key produces it differs by layout, and the deck's shortcut overlay
  // is bound to the character. Every other key is matched by `code`, because
  // Shift+1 is "!" on a US layout and something else again elsewhere.
  return keys.includes(input.code) || input.key === '?';
}

/**
 * Every tag whose focus makes a digit part of what somebody is writing.
 * Coarser than the deck's own rule on purpose, exactly as `content.js` is: the
 * cost of being wrong in the source view is a digit stolen out of a half-written
 * comment.
 */
export const TYPING_TAGS = Object.freeze(['INPUT', 'TEXTAREA', 'SELECT']);
