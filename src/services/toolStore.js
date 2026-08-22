// The tool-metadata repository seam.
//
// Every read and write of tool_metadata.json goes through this module. Two
// payoffs:
//   1. ONE swap point for the storage backend. Today it delegates to the Drive
//      JSON layer (driveService); the planned SQLite migration replaces the body
//      of these four functions and nothing else in the app changes. This is the
//      repository boundary PHASE_A_TOOL_RECORD_SCHEMA.md §11 calls for.
//   2. No caller can destroy records it wasn't handed. `upsertMany` MERGES by id
//      into the existing file — it never does a whole-file replace. That is the
//      G1 invariant (a bulk save must preserve no-Fusion tools, conflict tools
//      held back for review, and dormant orphan metadata), enforced in one place
//      instead of trusted at every call site.
//
// Rule: outside this module, do not call driveService.{loadMetadata,
// saveAllMetadata, upsertMetadata, deleteMetadata} directly — use the seam.
// (Deletion is explicit and record-scoped: deleteById. There is deliberately NO
// destructive bulk-replace primitive.)
import * as driveService from './driveService.js';
import { assertNotShrinking, recordSize } from './writeGuard.js';

// One key for the metadata table's high-water mark.
const TOOLS = 'tool_metadata';

// Read the whole metadata table.
export async function loadAll() {
  const list = await driveService.loadMetadata();
  // A successful read is the moment we learn how big this table legitimately is.
  recordSize(TOOLS, list);
  return list;
}

// Merge the given records into the metadata file BY ID and return the full merged
// list. Records not present in `records` are preserved untouched (including any
// added by another device since — the merge re-reads current state first). This
// is the only bulk write; there is no clobbering replace.
export async function upsertMany(records) {
  const existing = await driveService.loadMetadata();
  const byId = new Map((existing || []).map(m => [m.id, m]));
  for (const m of (records || [])) if (m?.id) byId.set(m.id, m);
  const merged = [...byId.values()];
  // ⚠️ The merge is only as good as the read it merged INTO. If loadMetadata
  // came back empty — a zero-byte file, a 404 that forked to a fresh one — then
  // `merged` is just the handful of records this caller happened to be holding,
  // and saving it writes 3 records over 268. The merge cannot detect that
  // itself: an empty base looks exactly like a first run. The high-water mark
  // is the outside reference that can. See writeGuard.js.
  assertNotShrinking(TOOLS, merged);
  await driveService.saveAllMetadata(merged);
  recordSize(TOOLS, merged);
  return merged;
}

// Upsert a single record (read-modify-write of just that id).
export async function upsertOne(record) {
  // Single-record read-modify-write inside driveService; it cannot shrink the
  // table (it only ever adds or replaces one entry), so there is nothing for the
  // tripwire to judge here.
  await driveService.upsertMetadata(record);
}

// Remove a single record by id.
export async function deleteById(id) {
  // Deliberately NOT tripwired: removing one record is exactly what this is for,
  // and the mark follows the table down on the next successful load.
  await driveService.deleteMetadata(id);
}
