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
import { holderForGuid, holderOwnsGuid } from '../utils/holderDuplicates.js';
import { recordsForGeometry } from './holderIdentity.js';
import { convertLength } from '../utils/units.js';

// ⚠️ A record with NO SEGMENTS is not a geometry source. A holder created in
// the app but not yet drawn would otherwise blank out the geometry a tool
// already carries — a silent data loss on an ordinary save, which the gauge
// backstop below only *warns* about. Better to leave the tool's baked holder
// alone until the record has real geometry.
const hasGeometry = (r) => Array.isArray(r?.segments) && r.segments.length > 0;

// Returns { entry, record, recordId, source, guidChanged, idChanged } or null
// when nothing resolves at all.
//   entry        — a Fusion-shaped holder object, ready for buildHolderObject
//   record       — the app record it came from (null when it came from Fusion)
//   recordId     — that record's app UUID: the FK the caller stamps back onto
//                  the assembly (holder_id)
//   source       — 'app' | 'fusion'
//   guidChanged  — the resolved holder's guid differs from the one asked for
//   idChanged    — the resolved record differs from the stored FK, so the
//                  assembly's holder_id is stale and should be re-stamped
//
// ⚠️ ORDER: holder_id FIRST. Fusion's holder guid is NOT a stable identity —
// it churns for reasons that aren't ours to model (see holderIdentity.js), so
// it can never outrank the app's own foreign key. It is a HINT: useful for an
// assembly that predates the FK, and for a holder the app hasn't imported yet.
//
// This is why re-establishing the Fusion link is a separate, strict job
// (holder_ref + a segment match, both required — holderIdentity.js) rather than
// something the write path infers from a guid it happened to find.
export function resolveHolderForWrite(guid, { records, fusionHolders, holderId } = {}) {
  const byId = holderId ? (records || []).find(h => h?.id === holderId) : null;

  const record = byId || (guid ? holderForGuid(records, guid) : null);
  if (record && hasGeometry(record)) {
    const entry = holderRecordToFusion(record);
    return {
      entry, record, recordId: record.id, source: 'app',
      guidChanged: !!guid && entry.guid !== guid,
      idChanged: record.id !== (holderId || null),
    };
  }

  const entry = guid ? (fusionHolders || []).find(h => h?.guid === guid) : null;
  if (entry) {
    return {
      entry, record: null, recordId: record?.id ?? null, source: 'fusion',
      guidChanged: false, idChanged: false,
    };
  }
  return null;
}

// Is this tool carrying holder geometry that no longer matches the holder it
// resolves to? Read-only — this is what the re-stamp preview counts, and what
// tells the user a tool is stale before anything is written.
export function toolHolderIsStale(assembly, rawInstance, ctx) {
  const resolved = resolveHolderForWrite(assembly?.holder_guid,
    { ...ctx, holderId: assembly?.holder_id });
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
// The tolerance — a noise floor, ~1mm. This is the standing threshold and it
// is NEVER stored on a holder.
//
// ⚠️ IT WAS, BRIEFLY, AND THAT WAS BACKWARDS. Raising the tolerance is a
// judgement about ONE bulk correction: "I know this holder's old data was bad,
// so of course these forty tools all move." That judgement expires the moment
// the correction lands — the re-stamped tools now match the holder, so they
// move by nothing and warn about nothing on their own. The only tools a stored
// tolerance would still be silencing are the STRAGGLERS: one deselected here, or
// one that arrives later from Fusion still carrying the old holder. Those are
// exactly the ones worth flagging, and there are few enough to fix by hand.
// So the tolerance lives for the length of the re-stamp dialog and is then
// forgotten.
export const ASSEMBLY_GAUGE_WARN_IN = 0.04;   // ≈1mm

// ⚠️ THE CEILING, AND IT IS NOT ADJUSTABLE.
// A gauge change beyond ~10mm is not a "big correction", it's a sign something
// is wrong — a holder swapped for the wrong one, a body missing segments, a
// unit mix-up. The shop's own judgement: more than 10mm would be very odd.
//
// This exists because a freely-raisable tolerance defeats its own purpose. The
// real failure this backstop was built for — the two NBT30-SK20C-60 records
// disagreeing by 30.155mm — is exactly what someone would silence by dragging
// the number up to "make the warnings stop". So the per-holder tolerance is
// CLAMPED to this, and anything past it stays flagged no matter what: it can
// still be written, but only by ticking that specific tool by hand.
export const ASSEMBLY_GAUGE_IMPLAUSIBLE_MM = 10;
export const ASSEMBLY_GAUGE_IMPLAUSIBLE_IN = ASSEMBLY_GAUGE_IMPLAUSIBLE_MM / 25.4;

// Normalize a tolerance a caller supplied for ONE grading pass (the re-stamp
// dialog's slider), falling back to the standing default.
// ⚠️ ONE rule, in one place, because the obvious test is wrong twice over:
// Number(null) and Number('') are both 0, and Number.isFinite(0) is true — so
// a coercion-only check reads "no tolerance given" as "tolerate nothing" and
// flags every tool on every holder over floating-point noise.
export function gaugeToleranceIn(value, fallback = ASSEMBLY_GAUGE_WARN_IN) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  // Clamped — a tolerance can quiet the expected, never the implausible.
  return Math.min(Math.max(0, n), ASSEMBLY_GAUGE_IMPLAUSIBLE_IN);
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

  const mm = deltaIn == null ? null : deltaIn * 25.4;
  const implausible = deltaIn != null && Math.abs(deltaIn) > ASSEMBLY_GAUGE_IMPLAUSIBLE_IN;

  let level = 'ok';
  let reason = null;
  if (!Number.isFinite(a)) {
    level = 'error';
    reason = 'The new assembly gauge length did not compute — refusing to write it.';
  } else if (a <= 0) {
    level = 'warn';
    reason = 'The new assembly gauge length is zero or negative — the holder may have no usable geometry.';
  } else if (implausible) {
    // Past the ceiling: reported regardless of the tolerance, because this is
    // the shape of a mistake, not of a correction.
    level = 'warn';
    reason = `Assembly gauge length moves ${mm > 0 ? '+' : ''}${mm.toFixed(2)}mm — more than ${ASSEMBLY_GAUGE_IMPLAUSIBLE_MM}mm is very odd for a holder correction. Check this is the right holder.`;
  } else if (deltaIn != null && Math.abs(deltaIn) > tolIn) {
    level = 'warn';
    reason = `Assembly gauge length moves ${mm > 0 ? '+' : ''}${mm.toFixed(2)}mm — check the holder is the right one.`;
  }
  return {
    assemblyId, holderDescription, before: known ? b : null, after: a,
    deltaIn, deltaMm: mm, level, reason, tolIn, implausible,
  };
}

// ─── Does this assembly use this holder? ────────────────────────────────────
// THE one predicate for "which tools use holder X" — re-stamp selection, the
// usage count, the merge-follows count. It must read the FK first: keying these
// on the Fusion guid alone (as they used to) silently skips every tool whose
// baked guid has since churned, so a "push this correction to all its tools"
// action would quietly cover a fraction of them.
export function assemblyUsesHolder(assembly, record) {
  if (!assembly || !record) return false;
  if (assembly.holder_id) return assembly.holder_id === record.id;
  return !!assembly.holder_guid && holderOwnsGuid(record, assembly.holder_guid);
}

export const toolsUsingHolder = (tools, record) =>
  (tools || []).filter(t => (t.assemblies || []).some(a => assemblyUsesHolder(a, record)));

export const assemblyCountUsingHolder = (tools, record) =>
  (tools || []).reduce((n, t) =>
    n + (t.assemblies || []).filter(a => assemblyUsesHolder(a, record)).length, 0);

// ─── holder_id backfill (load-time, in memory) ──────────────────────────────
// Assemblies predating the FK carry only what Fusion baked in. Resolve that
// once at load and stamp the app id, so everything downstream reads a real
// foreign key instead of a foreign system's string. Mirrors backfillAsmNumbers
// / backfillMaterialPresetIds: pure, idempotent, persisted lazily on each
// tool's next save.
//
// TWO WAYS IN, and the second is the one that matters:
//   1. The baked holder GUID → a record that owns it. Works only while Fusion
//      hasn't re-issued that guid since the tool was made.
//   2. The baked holder's SEGMENTS → the one record with that exact shape.
//      This is the same strict identity rule used at the Fusion boundary
//      (holderIdentity.js), applied to the copy Fusion absorbed into the tool.
//
// Why (2) is not optional: measured against the shop's real library, the guid
// links 45% of tools and the shape links 93%. Without it, half the library
// could never be connected to the holders it demonstrably uses. It is only ever
// applied when EXACTLY ONE record has that shape — two would be a duplicate to
// merge, and picking between them is not the backfill's call.
//
// A tool that matches neither is left alone: that's the loose, user-confirmed
// migration matcher's job (holderAudit.js), not a silent guess.
export function backfillHolderIds(tools, holderRecords) {
  const records = holderRecords || [];
  if (!records.length) return tools;
  return (tools || []).map(t => {
    if (!t?.assemblies?.length) return t;
    const bakedByGuid = new Map((t._instancesRaw || [])
      .filter(r => r?.guid && r.holder)
      .map(r => [r.guid, r.holder]));
    let changed = false;
    const assemblies = t.assemblies.map(a => {
      const byId = a.holder_id ? records.find(h => h.id === a.holder_id) : null;
      if (byId) return a;                       // already linked and resolvable
      const byGuid = a.holder_guid ? holderForGuid(records, a.holder_guid) : null;
      let rec = byGuid;
      if (!rec) {
        const baked = bakedByGuid.get(a.instance_guid);
        const shapes = baked ? recordsForGeometry(records, baked) : [];
        if (shapes.length === 1) rec = shapes[0];
      }
      if (!rec || rec.id === a.holder_id) return a;
      changed = true;
      return { ...a, holder_id: rec.id };
    });
    return changed ? { ...t, assemblies } : t;
  });
}
