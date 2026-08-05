// ─── Which Fusion holder is THIS app holder? (the durable link) ─────────────
//
// ⚠️ FUSION'S HOLDER GUID IS NOT A STABLE IDENTITY. It serves some purpose
// inside Fusion, but it does not match a holder to itself over time — it churns
// for reasons that aren't ours to model. So the app never trusts it as the
// identity of a holder. It is kept only as a hint (the guid a tool happens to
// be carrying right now), never as the answer.
//
// THE REAL LINK IS TWO SIGNALS, AND BOTH MUST AGREE:
//
//   1. holder_ref — the app's own id, stamped into Fusion's free-text
//      `product-id` field on the holder. This is the identity WE control.
//   2. The segments — matched shape-for-shape within a rounding tolerance.
//
// Why both. Neither field is managed by Fusion and either can be broken by an
// ordinary human action:
//   · Someone duplicates a holder in Fusion, edits its segments (and maybe the
//     description) and never touches the product-id. The ref now points at a
//     holder that is no longer the same shape → REF-ONLY.
//   · Someone rebuilds a holder from scratch, or the ref gets cleared. The
//     shape is right but our id is gone → GEOMETRY-ONLY.
// Either alone would silently link the wrong holder, so an automatic match
// requires both. Everything else is FLAGGED for a person to look at — the same
// "informed, not blocked" rule the rest of the app follows.
//
// THIS IS NOT THE MIGRATION MATCHER. Matching the shop's messy legacy library
// to the controlled one is a different job with different rules — description +
// gauge length, a generous tolerance, user-confirmed (see holderAudit.js and
// holderDuplicates.js). That runs once, to get the data under control. THIS
// runs forever after, to keep it there, and is deliberately strict.

import { convertLength } from '../utils/units.js';
import { segHeight, segUpper, segLower } from '../utils/holderGeometry.js';

// Rounding only. Segment values cross unit conversions and JSON round-trips;
// this absorbs that and NOTHING else. A real edit to a holder is orders of
// magnitude bigger than a thousandth of an inch, so anything past this is a
// genuine change and must be flagged rather than matched through.
export const SEGMENT_MATCH_TOL_IN = 0.001;

const near = (a, b, tolIn, unitA, unitB) =>
  Math.abs(convertLength(Number(a) || 0, unitA, 'inches')
    - convertLength(Number(b) || 0, unitB, 'inches')) <= tolIn;

// Shape-for-shape, in order. Segment COUNT must match too — a holder with an
// extra segment is a different holder, however close the rest lines up.
export function segmentsMatch(a, aUnit, b, bUnit, tolIn = SEGMENT_MATCH_TOL_IN) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length || a.length === 0) return false;
  for (let i = 0; i < a.length; i++) {
    if (!near(segHeight(a[i]), segHeight(b[i]), tolIn, aUnit, bUnit)) return false;
    if (!near(segUpper(a[i]), segUpper(b[i]), tolIn, aUnit, bUnit)) return false;
    if (!near(segLower(a[i]), segLower(b[i]), tolIn, aUnit, bUnit)) return false;
  }
  return true;
}

// The record whose holder_ref the Fusion entry is carrying. legacy_ids are
// searched too, so a ref retired by a merge still lands on the survivor.
export function recordForRef(records, ref) {
  const key = String(ref ?? '').trim();
  if (!key) return null;
  return (records || []).find(r =>
    r?.holder_ref === key || (r?.legacy_ids || []).includes(key)) || null;
}

// Every record whose segments match the entry's. More than one means the app's
// own library holds two records of the same shape — a duplicate to merge, and
// never something to pick between automatically.
export function recordsForGeometry(records, entry, tolIn = SEGMENT_MATCH_TOL_IN) {
  return (records || []).filter(r =>
    segmentsMatch(r?.segments, r?.unit, entry?.segments, entry?.unit, tolIn));
}

// ─── The match ──────────────────────────────────────────────────────────────
// Returns { status, record, refRecord, geoRecords, reason }.
//
//   'exact'          — ref and geometry agree on one record. The ONLY status
//                      anything is allowed to act on automatically.
//   'ref-only'       — our id points at a record whose shape has changed.
//                      Someone edited this holder in Fusion.
//   'geometry-only'  — the shape is a record we know, but our id isn't on it.
//                      A Fusion-side duplicate, or the ref was cleared.
//   'conflict'       — the ref says one record and the shape says another.
//   'ambiguous'      — the shape matches more than one of our records.
//   'none'           — not a holder we know.
//
// `record` is populated ONLY for 'exact'. Every other status hands back what it
// found so the flag can say what actually disagrees, and deliberately refuses
// to name a winner.
export function matchFusionHolder(entry, records, tolIn = SEGMENT_MATCH_TOL_IN) {
  const refRecord = recordForRef(records, entry?.['product-id']);
  const geoRecords = recordsForGeometry(records, entry, tolIn);

  if (geoRecords.length > 1) {
    return {
      status: 'ambiguous', record: null, refRecord, geoRecords,
      reason: `${geoRecords.length} holder records have this exact shape — merge them first.`,
    };
  }
  const geoRecord = geoRecords[0] || null;

  if (refRecord && geoRecord && refRecord.id === geoRecord.id) {
    return { status: 'exact', record: refRecord, refRecord, geoRecords, reason: null };
  }
  if (refRecord && geoRecord) {
    return {
      status: 'conflict', record: null, refRecord, geoRecords,
      reason: `The ID on this Fusion holder says "${refRecord.description || refRecord.holder_ref}", but its shape matches "${geoRecord.description || geoRecord.holder_ref}".`,
    };
  }
  if (refRecord) {
    return {
      status: 'ref-only', record: null, refRecord, geoRecords,
      reason: `This Fusion holder carries the ID of "${refRecord.description || refRecord.holder_ref}" but its segments no longer match — it was edited in Fusion.`,
    };
  }
  if (geoRecord) {
    return {
      status: 'geometry-only', record: null, refRecord, geoRecords,
      reason: `The shape matches "${geoRecord.description || geoRecord.holder_ref}", but this Fusion holder isn't carrying its ID — a duplicate, or the ID was cleared.`,
    };
  }
  return { status: 'none', record: null, refRecord: null, geoRecords: [], reason: null };
}

export const isConfidentMatch = (m) => m?.status === 'exact';

// Sweep the whole Fusion holder library. `matched` is safe to act on; every
// other bucket is a worklist for a person.
export function auditFusionHolders(fusionEntries, records, tolIn = SEGMENT_MATCH_TOL_IN) {
  const matched = [];
  const flagged = [];
  const unknown = [];
  for (const entry of fusionEntries || []) {
    const m = matchFusionHolder(entry, records, tolIn);
    if (m.status === 'exact') matched.push({ entry, ...m });
    else if (m.status === 'none') unknown.push({ entry, ...m });
    else flagged.push({ entry, ...m });
  }
  // Records with no confident Fusion counterpart: either never pushed, or the
  // Fusion side drifted away from them.
  const matchedIds = new Set(matched.map(m => m.record.id));
  const unpushed = (records || []).filter(r => !matchedIds.has(r.id));
  return { matched, flagged, unknown, unpushed };
}

// ─── Pushing our records OUT to Fusion ──────────────────────────────────────
// The other half of the link, and the step that actually settles a library:
// until our holder_ref reaches Fusion's product-id, every holder reads
// `geometry-only` and the connection is one signal short.
//
// WHAT IT WILL AND WON'T TOUCH. A Fusion entry is only rewritten when we are
// certain which record it is:
//   · 'exact'                       → UPDATE it.
//   · 'geometry-only', ONE matching record, and Fusion's product-id is EMPTY
//                                   → ADOPT it. Nothing is overwritten — we are
//                                     stamping our id onto a holder whose exact
//                                     shape we already own. This is what
//                                     bootstraps the very first push.
//   · anything else                 → LEFT ALONE and reported. A half-match is
//                                     the shape of a human edit, and writing
//                                     over it would destroy the evidence.
// A record no entry matched at all is appended as a NEW Fusion holder.
//
// `records` should be scoped to one holder library before calling.
// ─── What would a push actually change? ─────────────────────────────────────
// Field-by-field, in the terms a person reads, so "N refreshed" can say WHICH
// holders and WHY instead of asking you to trust it.
//
// ⚠️ NUMBERS ARE COMPARED WITH A TOLERANCE, not by string equality. A value
// that survives a JSON round-trip comes back as 54.998999999999995 instead of
// 54.999 — identical to twelve significant figures. Comparing text called
// those holders stale, so the count was inflated and the words "Fusion is
// holding older values" were simply untrue for them.
const NUM_EPS = 1e-6;
const sameNumber = (a, b) =>
  Math.abs(a - b) <= NUM_EPS * Math.max(1, Math.abs(a), Math.abs(b));

function sameValue(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return sameNumber(a, b);
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) if (!sameValue(a[k], b[k])) return false;
    return true;
  }
  return a === b;
}

// How each changed field is named and shown. Anything not listed is reported
// under its raw key rather than silently dropped.
const FIELD_LABEL = {
  'product-id': 'App ID',
  description: 'Name',
  vendor: 'Vendor',
  gaugeLength: 'Gauge length',
  segments: 'Geometry',
  'product-link': 'Link',
  guid: 'Fusion GUID',
  type: 'Entry type',
};

const show = (v) => {
  if (v === undefined || v === null || v === '') return '(blank)';
  if (Array.isArray(v)) return `${v.length} segments`;
  if (typeof v === 'number') return String(+v.toFixed(4));
  return String(v);
};

// → [{ key, label, from, to }]. `expressions.*` are deliberately excluded:
// Fusion re-derives them from their native field, so listing both would report
// every name change twice.
export function holderPushDiff(entry, next) {
  const out = [];
  const keys = new Set([...Object.keys(entry || {}), ...Object.keys(next || {})]);
  for (const k of keys) {
    if (k === 'expressions') continue;
    if (sameValue(entry?.[k], next?.[k])) continue;
    // A trailing space is invisible in a diff, so a trim reads as "no change"
    // and the row looks like a lie. Say what happened instead.
    const a = entry?.[k]; const b = next?.[k];
    const trimOnly = typeof a === 'string' && typeof b === 'string'
      && a !== b && a.trim() === b.trim();
    out.push({
      key: k, label: FIELD_LABEL[k] || k,
      from: show(a), to: show(b),
      note: trimOnly ? 'extra spaces removed' : null,
    });
  }
  // An expression that moved on its own (its native field didn't) is still a
  // real difference — report it as one line rather than per key.
  if (!sameValue(entry?.expressions, next?.expressions) && !out.length) {
    out.push({ key: 'expressions', label: 'Derived expressions', from: 'older', to: 'rebuilt' });
  }
  return out;
}

// ─── Grouping a change by what KIND it is ───────────────────────────────────
// A list of twenty holders reads as twenty separate decisions. In practice
// they fall into a few kinds, and the kind is what tells you whether to look
// closely: stamping an ID is nothing to think about; geometry moving is.
//
// A holder lands in the group of its MOST significant change, so it appears
// once — geometry beats text beats a bare ID stamp.
export const PUSH_GROUPS = {
  geometry: {
    key: 'geometry', label: 'Geometry',
    note: 'The shape or gauge length Fusion holds differs from the record. Worth a look.',
  },
  text: {
    key: 'text', label: 'Names & text',
    note: 'Description, vendor or link. The holder itself is unchanged.',
  },
  other: {
    key: 'other', label: 'Something else',
    note: 'A field the app doesn’t normally touch. Worth reading before you write it.',
  },
  id: {
    key: 'id', label: 'ID only',
    note: 'Nothing but the app’s ID written into Fusion’s product-id field. The geometry Fusion already holds is identical.',
  },
};

const GEOMETRY_KEYS = new Set(['segments', 'gaugeLength', 'unit']);
const TEXT_KEYS = new Set(['description', 'vendor', 'product-link', 'expressions']);

export function pushChangeGroup(diff) {
  const keys = (diff || []).map(d => d.key);
  if (keys.some(k => GEOMETRY_KEYS.has(k))) return 'geometry';
  if (keys.some(k => TEXT_KEYS.has(k))) return 'text';
  // Only a pure product-id stamp is the quiet group. Anything ELSE that turns
  // up unrecognized is surfaced as "other" rather than filed under the group
  // whose header says "nothing but the app's ID" — that sentence was flatly
  // wrong for a holder whose Fusion GUID was being rewritten, and hid a bug.
  if (keys.every(k => k === 'product-id')) return 'id';
  return 'other';
}

// Would writing this record change the Fusion entry at all?
export function fusionEntryIsStale(entry, record, toFusion) {
  if (!toFusion) return false;
  return holderPushDiff(entry, toFusion(record, entry)).length > 0;
}

export function holderPushPlan(fusionEntries, records, tolIn = SEGMENT_MATCH_TOL_IN, toFusion = null) {
  const updates = [];   // { index, entry, record, kind: 'update' | 'adopt', stale }
  const flagged = [];   // { entry, ...match } — untouched
  const spokenFor = new Set();

  const list = fusionEntries || [];
  for (let index = 0; index < list.length; index++) {
    const entry = list[index];
    if (entry?.type !== 'holder') continue;
    const m = matchFusionHolder(entry, records, tolIn);

    if (m.status === 'exact') {
      // `stale` is what the badge counts: an identity match only proves Fusion
      // has the right HOLDER, not the right VALUES.
      const diff = toFusion ? holderPushDiff(entry, toFusion(m.record, entry)) : [];
      updates.push({ index, entry, record: m.record, kind: 'update', diff, stale: diff.length > 0 });
      spokenFor.add(m.record.id);
      continue;
    }
    // The bootstrap case: our shape, and Fusion has no id of its own on it.
    const blankRef = !String(entry['product-id'] ?? '').trim();
    if (m.status === 'geometry-only' && m.geoRecords.length === 1 && blankRef) {
      const rec = m.geoRecords[0];
      updates.push({
        index, entry, record: rec, kind: 'adopt', stale: true,
        diff: toFusion ? holderPushDiff(entry, toFusion(rec, entry)) : [],
      });
      spokenFor.add(m.geoRecords[0].id);
      continue;
    }
    if (m.status !== 'none') {
      flagged.push({ entry, ...m });
      // Every record this entry could plausibly be stays claimed, so it is
      // never ALSO appended as a new holder while the flag is unresolved.
      if (m.refRecord) spokenFor.add(m.refRecord.id);
      for (const r of m.geoRecords) spokenFor.add(r.id);
    }
  }

  const creates = (records || []).filter(r => r?.id && !spokenFor.has(r.id));
  return { updates, creates, flagged };
}

// Apply a plan to the raw Fusion library list. Entries that are not holders —
// and holders the plan chose not to touch — are returned BYTE-FOR-BYTE as they
// were: the holder library file may hold other entry types, and a write must
// never drop or reshape them.
// ⚠️ Keyed by INDEX, not by object identity. The plan and this call must be
// given the same list, and identity-keying quietly did nothing when a caller
// rebuilt the array in between — the write looked like it ran and changed
// nothing. Index is the honest expression of that contract.
export function applyHolderPushPlan(list, plan, toFusion) {
  const byIndex = new Map(plan.updates.map(u => [u.index, u.record]));
  const out = (list || []).map((entry, i) => {
    const record = byIndex.get(i);
    return record ? toFusion(record, entry) : entry;
  });
  for (const record of plan.creates) out.push(toFusion(record, null));
  return out;
}

// How many holder records Fusion does not yet agree with — never pushed, or
// pushed and since edited here. THE number that answers "if this app went away,
// what would be lost?" (see "If Fusion has a place for it, Fusion must have it"
// in CLAUDE.md), so it is shown on the Holders page rather than left implicit.
export function holdersOutOfSync(fusionEntries, records, toFusion, tolIn = SEGMENT_MATCH_TOL_IN) {
  const plan = holderPushPlan(fusionEntries, records, tolIn, toFusion);
  return plan.creates.length + plan.updates.filter(u => u.stale).length;
}
