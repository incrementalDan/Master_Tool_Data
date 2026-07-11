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

// Read the whole metadata table.
export async function loadAll() {
  return driveService.loadMetadata();
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
  await driveService.saveAllMetadata(merged);
  return merged;
}

// Upsert a single record (read-modify-write of just that id).
export async function upsertOne(record) {
  await driveService.upsertMetadata(record);
}

// Remove a single record by id.
export async function deleteById(id) {
  await driveService.deleteMetadata(id);
}
