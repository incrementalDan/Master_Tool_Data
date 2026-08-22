// The shrink tripwire.
//
// THE FAILURE IT CATCHES: a write that would replace a full dataset with a
// nearly empty one. That is what a bad update looks like from the storage
// layer — not an exception, just a much shorter list arriving where a long one
// used to be, saved successfully, with nothing on screen to say so.
//
// The concrete path from DATA_LOSS_AUDIT.md: toolStore.upsertMany merges into
// whatever loadAll() returned, so if that read comes back empty (a zero-byte
// file, a 404 that forked to a fresh one) the "merge" has nothing to merge into
// and three records get written over two hundred and sixty-eight.
//
// ⚠️ WHY A HIGH-WATER MARK, NOT A COMPARE-AGAINST-WHAT-WE-JUST-READ. The
// dangerous case is precisely the one where the read came back wrong, so the
// read cannot be the reference — it is the thing under suspicion. The mark is
// recorded on every SUCCESSFUL load and persisted, so it survives the reload
// that a corrupt read would otherwise use to reset the baseline to zero.
//
// ⚠️ IT REFUSES RATHER THAN WARNS. A refused write is recoverable in one
// reload; a completed one is not. This is the same fail-safe reasoning as the
// failed-load block.
//
// ⚠️ IT IS NOT A DELETE GUARD. Deleting records legitimately is a per-record
// operation (toolStore.deleteById), which never comes through here, and the mark
// follows the library down on each successful load. This only ever fires on a
// bulk write that collapses — which no ordinary action produces.

const KEY_PREFIX = 'write_highwater_';

// Below this, percentages are meaningless — 3 records down to 2 is a 33% drop
// and completely normal. A dataset has to be big enough for a collapse to be
// distinguishable from ordinary editing.
export const MIN_MEANINGFUL = 8;

// How much of the previous size must survive. 0.5 is deliberately generous: this
// is a catastrophe detector, not a change detector. Anything subtler than
// "half the data vanished" is a job for the audit log, not a hard block.
export const SHRINK_LIMIT = 0.5;

// How big is this thing? A metadata table is an array of records; a shared file
// is a document whose principal collection is what actually holds the data.
// Falls back to null (= "no opinion") rather than guessing, so an unrecognised
// shape can never trip the guard.
export function sizeOf(content) {
  if (Array.isArray(content)) return content.length;
  if (!content || typeof content !== 'object') return null;
  // The principal collection of each shared file, longest first — one file can
  // carry several arrays (holder_library has holders AND parts) and the primary
  // one is what a collapse would show up in.
  const arrays = Object.values(content).filter(Array.isArray);
  if (!arrays.length) return null;
  return Math.max(...arrays.map(a => a.length));
}

function read(key) {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + key);
    const n = raw == null ? null : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

function write(key, n) {
  try { localStorage.setItem(KEY_PREFIX + key, String(n)); } catch { /* guard degrades to off */ }
}

// Record how big this dataset legitimately is. Call after a successful LOAD and
// after a successful WRITE — a write is a new legitimate size, including a
// deliberate shrink, so the mark follows the data down and the guard does not
// become a ratchet that eventually blocks everything.
export function recordSize(key, content) {
  const n = sizeOf(content);
  if (n != null) write(key, n);
}

// Would this write collapse the dataset? Returns null when fine, or a
// { key, from, to } description of the collapse.
export function shrinkCheck(key, content) {
  const to = sizeOf(content);
  if (to == null) return null;              // unrecognised shape — no opinion
  const from = read(key);
  if (from == null) return null;            // nothing to compare against yet
  if (from < MIN_MEANINGFUL) return null;   // too small for a ratio to mean anything
  if (to >= Math.floor(from * SHRINK_LIMIT)) return null;
  return { key, from, to };
}

export function assertNotShrinking(key, content) {
  const hit = shrinkCheck(key, content);
  if (!hit) return;
  throw Object.assign(
    new Error(
      `Refusing to save ${key}: this would cut it from ${hit.from} entries to ${hit.to}. `
      + `That looks like data loss rather than an edit, so nothing was written. `
      + `Reload and try again — if the shrink is intentional, save it in smaller steps.`
    ),
    { code: 'WRITE_SHRANK', ...hit }
  );
}

// Test/reset hook.
export function clearHighWater(key) {
  try { localStorage.removeItem(KEY_PREFIX + key); } catch { /* nothing to clear */ }
}
