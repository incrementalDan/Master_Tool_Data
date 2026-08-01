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
import { convertLength } from '../utils/units.js';

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

// ─── Assembly gauge-length sanity check ─────────────────────────────────────
// A BACKSTOP before a tool's holder is overwritten. The assembly gauge length
// (holder gauge + the tool's OOH) is where the cutting edge actually sits, so
// it is the one number that catches "something went wrong" with a holder swap:
// if the replacement holder's body is wrong, the tool silently moves.
//
// Real example from the shop's own library: the two NBT30-SK20C-60 records
// disagree about the body by 30.155mm. Re-stamping onto the wrong one would
// shift every tool using it by 1.19" with nothing to show for it.
//
// Deliberately NOT a hard gate on size: a corrected holder is SUPPOSED to move
// the number, that's the point. Anything that moves is reported so it can be
// seen before committing; a big move is flagged; only arithmetic that came out
// non-finite is treated as an error, because that is unambiguously broken
// rather than merely surprising.
// The DEFAULT only — the real tolerance is per holder (`restamp_tolerance_in`
// on the record), because how much movement is reasonable depends entirely on
// how wrong the holder was to start with. A holder whose body was 30mm short
// will legitimately move every tool on it by more than an inch when corrected,
// and being asked to confirm that 40 times is noise, not safety. The user sets
// the number once per holder, sees the old and new gauge for every tool, and
// that choice is remembered.
export const ASSEMBLY_GAUGE_WARN_IN = 0.04;   // ≈1mm

// Read a stored per-holder tolerance, falling back to the default.
// ⚠️ ONE rule, in one place, because the obvious test is wrong twice over:
// Number(null) and Number('') are both 0, and Number.isFinite(0) is true — so
// a coercion-only check reads "no tolerance set" as "tolerate nothing" and
// flags every tool on every holder over floating-point noise.
export function holderToleranceIn(value, fallback = ASSEMBLY_GAUGE_WARN_IN) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// `before` / `after` are in the TOOL's unit; the delta is in inches so one
// threshold covers mm- and inch-native tools alike.
export function assemblyGaugeCheck({
  before, after, toolUnit, assemblyId, holderDescription,
  tolIn = ASSEMBLY_GAUGE_WARN_IN,
}) {
  const b = Number(before);
  const a = Number(after);
  const known = Number.isFinite(b);
  const deltaIn = known && Number.isFinite(a)
    ? convertLength(a - b, toolUnit, 'inches')
    : null;

  let level = 'ok';
  let reason = null;
  if (!Number.isFinite(a)) {
    level = 'error';
    reason = 'The new assembly gauge length did not compute — refusing to write it.';
  } else if (a <= 0) {
    level = 'warn';
    reason = 'The new assembly gauge length is zero or negative — the holder may have no usable geometry.';
  } else if (deltaIn != null && Math.abs(deltaIn) > tolIn) {
    level = 'warn';
    reason = `Assembly gauge length moves ${deltaIn > 0 ? '+' : ''}${deltaIn.toFixed(4)}" — check the holder is the right one.`;
  }
  return { assemblyId, holderDescription, before: known ? b : null, after: a, deltaIn, level, reason, tolIn };
}
