// ─── Which holder does a tool write get its geometry from? ──────────────────
//
// THE THING THIS FIXES. Fusion ABSORBS holder geometry into each cutting tool,
// so a tool carries its own frozen copy. The app already rebuilds that copy from
// scratch on every tool write (splitToFusionInstances → buildHolderObject) —
// that write is the ONLY channel by which a corrected holder ever reaches an
// existing tool. Until now it read from the read-only Fusion holder library, so
// corrections made in this app could never get there.
//
// Resolution order, and both steps matter:
//   1. THE APP-OWNED RECORD, followed through merge aliases. A tool still
//      carrying a merged-away holder's guid resolves to the surviving record,
//      which is what makes a merge actually deliver.
//   2. The Fusion holder library entry. The fallback is NOT optional: a holder
//      that hasn't been imported into the app yet has no record, and without
//      this the tool's holder would vanish on its next save.
//
// Nothing here writes. It answers "what geometry should this tool be carrying",
// and the caller decides when to act on it.

import { holderRecordToFusion } from './holderRecord.js';
import { holderForGuid } from '../utils/holderDuplicates.js';

// Returns { entry, record, source, guidChanged } or null when the guid resolves
// to nothing at all.
//   entry        — a Fusion-shaped holder object, ready for buildHolderObject
//   record       — the app record it came from (null when it came from Fusion)
//   source       — 'app' | 'fusion'
//   guidChanged  — the resolved holder's guid differs from the one asked for,
//                  i.e. this tool is pointing at a holder that was merged away
export function resolveHolderForWrite(guid, { records, fusionHolders } = {}) {
  if (!guid) return null;

  const record = holderForGuid(records, guid);
  if (record) {
    const entry = holderRecordToFusion(record);
    return { entry, record, source: 'app', guidChanged: entry.guid !== guid };
  }

  const entry = (fusionHolders || []).find(h => h?.guid === guid);
  return entry ? { entry, record: null, source: 'fusion', guidChanged: false } : null;
}

// Is this tool carrying holder geometry that no longer matches the holder it
// resolves to? Read-only — this is what the re-stamp preview counts, and what
// tells the user a tool is stale before anything is written.
export function toolHolderIsStale(assembly, rawInstance, ctx) {
  const resolved = resolveHolderForWrite(assembly?.holder_guid, ctx);
  if (!resolved) return false;
  if (resolved.guidChanged) return true;             // points at a merged-away holder
  const current = rawInstance?.holder;
  if (!current) return true;                          // no holder baked in yet
  const want = resolved.entry;
  const sameLength = Array.isArray(current.segments) && Array.isArray(want.segments)
    && current.segments.length === want.segments.length;
  if (!sameLength) return true;
  const round = (v) => Number(v ?? 0).toFixed(4);
  for (let i = 0; i < want.segments.length; i++) {
    const a = current.segments[i] || {};
    const b = want.segments[i] || {};
    if (round(a.height) !== round(b.height)
      || round(a['upper-diameter']) !== round(b['upper-diameter'])
      || round(a['lower-diameter']) !== round(b['lower-diameter'])) return true;
  }
  return current.unit !== want.unit;
}
