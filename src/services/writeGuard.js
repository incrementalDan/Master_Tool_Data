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

// ⚠️ A LOAD AND A WRITE ARE NOT THE SAME KIND OF EVIDENCE, and treating them
// alike is how the guard disarms itself.
//
// A write is an assertion: someone asked for this size, so believe it, including
// a deliberate shrink to nothing. That is what stops the guard becoming a
// ratchet that eventually blocks ordinary saves.
//
// A load is an observation, and the whole premise here is that a load can come
// back wrong. Recording an empty read as "this dataset is now 0" set the
// baseline below MIN_MEANINGFUL, which short-circuits the check — so the bad
// read switched off the alarm built to catch it, and the 268 -> 3 write sailed
// through. Only a drop to EXACTLY ZERO is refused, and only when the previous
// mark was meaningful: a real partial shrink (tools deleted one at a time, which
// deleteById never records) is believed, so the guard still rebaselines.
//
// Zero is singled out because it is the one value a failed read produces —
// loadMetadata turns a 404 or an empty file into `[]`, and JSON is all-or-
// nothing, so a corrupt read cannot come back merely short.

// After a successful WRITE. Always believed.
export function recordSizeFromWrite(key, content) {
  const n = sizeOf(content);
  if (n != null) write(key, n);
}

// After a successful LOAD. Believed except for an unexplained collapse to zero.
export function recordSizeFromLoad(key, content) {
  const n = sizeOf(content);
  if (n == null) return;
  if (n === 0) {
    const prev = read(key);
    if (prev != null && prev >= MIN_MEANINGFUL) return; // keep the baseline
  }
  write(key, n);
}

// Deprecated alias — kept so no caller silently records the wrong KIND of
// evidence by picking the old name out of habit.
export const recordSize = recordSizeFromWrite;

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
