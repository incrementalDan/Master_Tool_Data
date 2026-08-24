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
import { recordsForGeometry, recordForRef, segmentsMatch } from './holderIdentity.js';
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
  // ⚠️ Archived records are not a geometry source. A tool must never be written
  // with a holder the shop has retired — the archive exists so that decision
  // sticks, and a stale holder_id pointing at one falls through to the Fusion
  // entry (or to nothing) rather than resurrecting it.
  const live = (records || []).filter(h => h && h.archived !== true);
  const byId = holderId ? live.find(h => h?.id === holderId) : null;

  const record = byId || (guid ? holderForGuid(live, guid) : null);
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
  // ⚠️ guidChanged is deliberately NOT staleness. This asks one question —
  // "is the GEOMETRY this tool carries out of date?" — and a differing baked
  // guid is not an answer to it. Fusion re-issues holder guids constantly (the
  // premise of this whole module), so including it flagged 117 more tools on a
  // clean import with no merges at all. A flag that fires on half the library
  // says nothing. The dangling-guid case still gets corrected by the tool's
  // next ordinary write; it just isn't reported as older geometry.
  const current = rawInstance?.holder;
  if (!current) return true;                          // no holder baked in yet

  // ⚠️ THE SAME RULE IDENTITY USES — segmentsMatch, which is unit-aware and
  // carries the 0.001" rounding tolerance.
  //
  // This compared toFixed(4) strings and compared units separately, i.e. exact
  // equality with no tolerance and no conversion. Measured over the real
  // library that flagged 190 of 212 linked tools as "carrying an older copy of
  // their holder" — when the strict identity matcher said 187 of them were the
  // SAME holder and only 3 had really moved. A banner that fires on 90% of the
  // library is wallpaper, and the number it showed was simply untrue.
  //
  // Two comparison rules for one question is the defect; a value that survives
  // a JSON round-trip comes back as 54.998999999999995, and a mm holder's
  // numbers are 25.4× an inch holder's. One rule, in one place.
  const want = resolved.entry;
  return !segmentsMatch(current.segments, current.unit, want.segments, want.unit);
}

// ─── Which tools are carrying OUT-OF-DATE holder geometry? ──────────────────
// Fusion absorbs a holder into every tool, so correcting a holder here leaves
// every existing tool still carrying the old copy until it is written. That is
// by design (the write is the only channel) — but it must not be SILENT.
//
// ⚠️ THIS IS THE LEAK THE LINK LIST CANNOT SEE. `buildHolderLinkPlan` skips any
// assembly that is already linked, and a tool arriving from Fusion on a
// merged-away holder's guid is linked automatically to the survivor. So it is
// correctly pointed at the right record while still carrying the wrong shape,
// and nothing anywhere said so. Re-stamp fixes it — you just had to already
// know to go and look.
//
// Read-only. `record` is null for a library-wide sweep, or one holder to scope
// it to that holder's tools.
export function staleHolderTools(tools, { records, fusionHolders, record = null } = {}) {
  const ctx = { records, fusionHolders };
  const out = [];
  for (const t of tools || []) {
    if (t?.no_fusion_link === true) continue;      // nothing in Fusion to correct
    const rawByGuid = new Map((t._instancesRaw || [])
      .filter(r => r?.guid).map(r => [r.guid, r]));
    for (const a of t.assemblies || []) {
      if (record && !assemblyUsesHolder(a, record)) continue;
      const raw = rawByGuid.get(a.instance_guid);
      if (!raw) continue;                          // no Fusion entry to compare
      if (toolHolderIsStale(a, raw, ctx)) { out.push(t); break; }
    }
  }
  return out;
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
// ─── Which record is the holder a tool is CARRYING? ─────────────────────────
//
// The same two signals the Fusion holder library uses (holderIdentity.js), read
// off the frozen copy Fusion baked into the tool:
//
//   REF    our `holder_ref`, in the baked holder's `product-id`. Present on
//          every tool copied from a holder AFTER that holder was pushed — the
//          field is on all 232 baked holders in the reference export, and
//          carries a value wherever Fusion had one.
//   SHAPE  the segments, matched within the 0.001" rounding tolerance.
//
// ⚠️ ONLY BOTH SIGNALS AGREEING IS CERTAIN. Everything else is a best guess and
// is MARKED as one — auto-linked so nothing is left dangling, but surfaced so
// the user sees what the tool carried and can pick a different holder.
//
// The one deliberate exception: SHAPE ALONE, when the baked copy carries no ref
// at all, counts as certain. Every tool copied before the first push is in that
// state, so treating it as uncertain would put the entire pre-existing library
// on a confirmation list — the nag wall that makes a flag worthless. Nothing
// contradicts the match, and shape uniqueness within 0.001" is the same rule
// the Fusion boundary calls a match. As refs start getting baked in, the check
// strengthens by itself.
//
// → { record, via: 'exact'|'shape'|'ref'|'guid'|null, confident }
export function matchBakedHolder(baked, holderGuid, records) {
  const live = (records || []).filter(r => r && r.archived !== true);
  const ref = String(baked?.['product-id'] || '').trim();
  const byRef = ref ? recordForRef(live, ref) : null;
  const allShapes = baked ? recordsForGeometry(live, baked) : [];
  // ⚠️ A RECORD THAT HAS NEVER BEEN IN FUSION CANNOT BE WHAT A TOOL BAKED.
  // The holder copy inside a tool came OUT of Fusion, so a record with no
  // Fusion entry — a holder just created here, most often the tap-collet twin
  // of one that is already out there — is not a candidate however well its
  // shape matches. Without this, creating that twin instantly made the shape
  // ambiguous for every tool on the original and dropped the lot into the
  // "needs a look" list, for a record none of them could possibly have come
  // from. Narrow the field first, then judge.
  const inFusion = allShapes.filter(r => r.fusion_guid || r.last_pushed);
  const shapes = (inFusion.length && inFusion.length < allShapes.length) ? inFusion : allShapes;
  const byShape = shapes.length === 1 ? shapes[0] : null;

  // ⚠️ BOTH SIGNALS ON ONE RECORD — and a sibling that happens to share the
  // shape does not take that away. The shop keeps deliberate same-shape twins
  // (a tap-collet version of a holder is identical geometry with a different
  // description), so requiring the shape to be UNIQUE would have made every
  // one of those tools uncertain. If our ref names a record and that record's
  // shape is what the tool is carrying, the two signals agree — and between
  // records of identical geometry there is nothing to choose anyway. Kept in
  // step with matchFusionHolder, which settles a shared shape the same way.
  if (byRef && shapes.some(r => r.id === byRef.id)) {
    return { record: byRef, via: 'exact', confident: true };
  }
  // ⚠️ SHAPE BEFORE REF when they disagree, and before the guid always.
  // Measured over the shop's real 304-tool library: the shape resolves every
  // case the guid does (133) PLUS 163 more, with zero disagreements. A guid is
  // re-issued by Fusion constantly and a ref survives a duplicate-in-Fusion, so
  // the geometry the tool is actually carrying is the better answer — but a
  // disagreement means one of them is wrong, so it is never certain.
  if (byShape) return { record: byShape, via: 'shape', confident: !byRef };
  if (byRef) return { record: byRef, via: 'ref', confident: false };
  const byGuid = holderGuid ? holderForGuid(live, holderGuid) : null;
  if (byGuid) return { record: byGuid, via: 'guid', confident: false };
  return { record: null, via: null, confident: false };
}

export function backfillHolderIds(tools, holderRecords) {
  // Archived holders are excluded outright — a tool must never be linked to a
  // holder that was merged away or retired.
  const records = (holderRecords || []).filter(r => r && r.archived !== true);
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
      // ⚠️ SHAPE BEFORE GUID. Measured over the shop's real 304-tool library:
      // the shape resolves every case the guid does (133) PLUS 163 more, with
      // ZERO disagreements and ZERO cases the guid alone could answer. So the
      // guid contributes nothing here and can only ever be wrong — and it does
      // go wrong: a record keeps remembering a `fusion_guid` that Fusion has
      // since handed to a DIFFERENT holder (observed live, a -120 record whose
      // guid now belongs to a 145mm test holder). Trying the shape first means
      // a stale guid can't mislink a tool; it stays as the last resort for a
      // baked holder with no usable geometry.
      const baked = bakedByGuid.get(a.instance_guid);
      const { record: rec, via, confident } = matchBakedHolder(baked, a.holder_guid, records);
      if (!rec || rec.id === a.holder_id) return a;
      changed = true;
      // ⚠️ A LESS-THAN-CERTAIN LINK IS STILL MADE — but it is MARKED, so the
      // user is shown what the tool was carrying and can change it. Runtime
      // only (buildMetadataTool copies named fields, so it never persists);
      // once the user confirms, the stored holder_id arrives without the flag
      // on the next load and the row stops appearing.
      return confident
        ? { ...a, holder_id: rec.id }
        : { ...a, holder_id: rec.id, _linkVia: via, _linkGuess: true };
    });
    return changed ? { ...t, assemblies } : t;
  });
}
