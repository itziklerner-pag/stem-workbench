/**
 * The deck's two storage areas, and they are TWO LIFETIMES rather than two
 * key prefixes.
 *
 * `shared/host.js` rule 5: "`'local'` outlives the browser and `'session'` does
 * not, and the deck's two uses are one of each on purpose: a preference must
 * survive a restart, and a refusal to arm must not — a stale refusal painted as
 * current turns a fix for a silent failure into a new false-alarm source."
 *
 * So this file is not a key-value store with an `area` field. It is two stores
 * with different homes:
 *
 *   local    a JSON file under the app's userData directory, written on every
 *            set and read once at construction. It survives quit, crash and
 *            upgrade.
 *   session  a `Map` in this process's memory, created empty by
 *            `createStorage()` and gone when the process is. There is no code
 *            path here that writes it to disk, and that ABSENCE is the duty: a
 *            Host that persisted it would leave a 60-second arm refusal painting
 *            as current on a machine the user rebooted in between.
 *
 * ---------------------------------------------------------------------------
 * ABSENT AND UNREADABLE ARE DIFFERENT ANSWERS, AND THIS FILE IS WHERE THEY PART
 * ---------------------------------------------------------------------------
 * `shared/host.js` rule 6. A fresh profile holds no preferences and that is the
 * ordinary case; storage that could not be READ is a fault. A Host that answered
 * `null` for the second would tell the deck "the user has no preferences" on
 * precisely the run where it could not tell — and a preference silently reset to
 * default is indistinguishable from one the user chose.
 *
 * Concretely: a MISSING local file is an empty store (every `get` answers
 * `null`); a local file that is present and cannot be read or parsed marks the
 * area UNREADABLE, and every `get` on it throws until a `set` replaces the file.
 * The distinction is not theoretical — a half-written JSON file after a power
 * cut is exactly the second case, and it is the one where the deck must not
 * conclude the user never set anything.
 *
 * WHY THE UNREADABLE STATE IS STICKY RATHER THAN RE-READ PER GET. The deck reads
 * `prefs` once at boot and then follows the change feed; re-reading a corrupt
 * file on every call would turn one honest error into a stream of them with no
 * new information in any of them. A `set` is what clears it, because a `set`
 * REPLACES the file — after that, what is on disk is what this process wrote.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NOT HERE
 * ---------------------------------------------------------------------------
 * `chrome.storage.sync`, and nothing standing in for it. The extension's Host
 * guards its area index because `sync` is a network write and P1 forbids the
 * network after the model download. Under this Host there is no third area to
 * reach for at all — but the refusal is kept anyway, because the deck naming an
 * area this Host does not have is the deck being wrong about a value it wrote
 * itself, and the cheapest place to be told is the call that wrote it.
 */
import fs from 'node:fs';
import path from 'node:path';

/** The only two areas the unit has words for. `shared/host.js` rule 5. */
export const AREAS = Object.freeze(['local', 'session']);

/**
 * @param {string} area
 * @returns {string} `area`, so the check reads inline at the index it guards
 * @throws if it is not one of the two lifetimes the unit names
 */
export function assertArea(area) {
  if (!AREAS.includes(area)) {
    throw new Error(`storage: ${JSON.stringify(area)} is not a storage area this unit uses `
      + `- it names one of ${AREAS.join(', ')}, and a lifetime it did not ask for is not the Host's to pick.`);
  }
  return area;
}

/**
 * @param {object} o
 * @param {string} o.dir     where the `local` file lives — the app's userData directory
 * @param {string} [o.file]  its name, so two runs can be pointed at one file deliberately
 * @returns {{
 *   get: (area: string, key: string) => unknown,
 *   set: (area: string, key: string, value: unknown) => void,
 *   onChanged: (area: string, key: string, fn: (value: unknown) => void) => () => void,
 *   localFile: string,
 *   stats: object,
 * }}
 *
 * `get` is SYNCHRONOUS here and asynchronous across the seam. That is not an
 * inconsistency: the ipc round trip is what makes the duty a promise, and this
 * side has a `Map` and a file it has already read. A synchronous core is also
 * what lets a suite drive absent-vs-unreadable without a clock.
 */
export function createStorage({ dir, file = 'deck-storage-local.json' }) {
  const localFile = path.join(dir, file);
  const mem = { local: new Map(), session: new Map() };
  /** Set when the local file is present and could not be read. See the header. */
  let localUnreadable = null;
  const stats = { loaded: 0, reads: 0, writes: 0, changes: 0, unreadable: 0, refusedAreas: [] };

  // ------------------------------------------------------------------- load
  // MISSING IS EMPTY; PRESENT-AND-BROKEN IS UNREADABLE. `existsSync` first, so
  // the two cases are told apart by what is on disk rather than by which error
  // `readFileSync` happened to throw.
  if (fs.existsSync(localFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(localFile, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('the stored value is not an object');
      }
      for (const [k, v] of Object.entries(parsed)) mem.local.set(k, v);
      stats.loaded = mem.local.size;
    } catch (err) {
      localUnreadable = new Error(`storage: ${localFile} exists and could not be read `
        + `(${(err && err.message) || err}). That is NOT "the user has no preferences".`);
      stats.unreadable++;
    }
  }

  /**
   * Written whole, through a temp file and a rename, because the alternative is
   * the failure this file is most careful about: a truncated write leaves a
   * present-and-broken file, which every later run then has to report as
   * unreadable rather than as absent. `rename` inside one directory is atomic on
   * both platforms this ships to.
   */
  function persist() {
    const tmp = `${localFile}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(localFile), { recursive: true });
    fs.writeFileSync(tmp, `${JSON.stringify(Object.fromEntries(mem.local), null, 2)}\n`);
    fs.renameSync(tmp, localFile);
  }

  /** `area key` -> Set<fn>. The Host owns the area/key filter, not the deck. */
  const feeds = new Map();
  const feedKey = (area, key) => `${area} ${key}`;

  return {
    stats,
    /** The file this store's `local` half lives in, so a report can name it. */
    localFile,

    get(area, key) {
      try { assertArea(area); } catch (e) { stats.refusedAreas.push(String(area)); throw e; }
      stats.reads++;
      if (area === 'local' && localUnreadable) throw localUnreadable;
      const m = mem[area];
      // `has`, not `get() !== undefined`: a stored `undefined` and an absent key
      // are different facts, and the seam answers `null` for the second.
      return m.has(key) ? m.get(key) : null;
    },

    set(area, key, value) {
      try { assertArea(area); } catch (e) { stats.refusedAreas.push(String(area)); throw e; }
      mem[area].set(key, value);
      stats.writes++;
      if (area === 'local') {
        persist();
        // A successful write replaced the file, so what could not be read before
        // is no longer what is on disk. Clearing the flag here is what keeps the
        // unreadable state from outliving the thing that caused it.
        localUnreadable = null;
      }
      const set = feeds.get(feedKey(area, key));
      if (set) for (const fn of [...set]) { stats.changes++; fn(value); }
    },

    /**
     * The area/key filter is the HOST's, for the same reason the address guard
     * on `onMessage` is: unpicking "everything that changed" down to "the one
     * value you asked about" is transport work.
     *
     * `assertArea` up front, and not only inside the filter: a listener
     * registered for an area that can never report is a subscription that
     * silently covers nothing — the change-feed spelling of the green-on-nothing
     * shape rule 6 is about.
     */
    onChanged(area, key, fn) {
      try { assertArea(area); } catch (e) { stats.refusedAreas.push(String(area)); throw e; }
      const k = feedKey(area, key);
      if (!feeds.has(k)) feeds.set(k, new Set());
      feeds.get(k).add(fn);
      return () => feeds.get(k)?.delete(fn);
    },
  };
}
