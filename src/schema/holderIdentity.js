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
import { HOLDER_REF_RE } from './holderRecord.js';

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

// ⚠️ ARCHIVED RECORDS ARE INVISIBLE TO EVERY MATCHER. An archived holder was
// merged away or removed — the shop has decided it is not a holder anything
// should be on. Matching a tool (or a Fusion entry) back onto one would undo
// that decision silently, which is the whole reason the archive exists rather
// than a delete. Applied HERE, at the two primitives every match runs through,
// so a new call site can't forget it.
const active = (records) => (records || []).filter(r => r && r.archived !== true);

// The record whose holder_ref the Fusion entry is carrying. legacy_ids are
// searched too, so a ref retired by a merge still lands on the survivor.
export function recordForRef(records, ref) {
  const key = String(ref ?? '').trim();
  if (!key) return null;
  return active(records).find(r =>
    r?.holder_ref === key || (r?.legacy_ids || []).includes(key)) || null;
}

// Every record whose segments match the entry's. More than one means the app's
// own library holds two records of the same shape — a duplicate to merge, and
// never something to pick between automatically.
export function recordsForGeometry(records, entry, tolIn = SEGMENT_MATCH_TOL_IN) {
  return active(records).filter(r =>
    segmentsMatch(r?.segments, r?.unit, entry?.segments, entry?.unit, tolIn));
}

// Is this Fusion entry the shape we last handed it for this record? That is the
// question `ref-only` turns on: same as last push means the app moved, anything
// else means Fusion did.
export function matchesLastPush(entry, record, tolIn = SEGMENT_MATCH_TOL_IN) {
  const lp = record?.last_pushed;
  if (!lp || !Array.isArray(lp.segments) || !lp.segments.length) return false;
  return segmentsMatch(entry?.segments, entry?.unit, lp.segments, lp.unit, tolIn);
}

// The snapshot stamped onto a record once its write lands.
export const lastPushedFrom = (record) => ({
  segments: (record?.segments || []).map(s => ({ ...s })),
  unit: record?.unit,
  at: new Date().toISOString(),
});

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
  remove: {
    key: 'remove', label: 'Removed from Fusion',
    note: 'Merged away or retired here. The record and its geometry stay in this app’s archive — only Fusion’s copy is deleted, so nothing can be built on it again.',
  },
  create: {
    key: 'create', label: 'Added to Fusion',
    note: 'Not in Fusion at all — appended as a new holder. Check none of these is a holder Fusion already has: a record whose geometry was edited here BEFORE its first push no longer matches its own Fusion entry, and lands here as a duplicate.',
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

// ─── Which Fusion entries should be REMOVED ─────────────────────────────────
// A merge in the app means the two holders are one holder. Retiring the loser
// here and leaving its copy in Fusion is only half the job: the bad geometry
// stays available, people keep picking it, and new tools keep arriving on it.
// So the push removes it.
//
// ⚠️ ONLY EVER ON AN APP-MINTED REF. `legacy_ids` holds two very different
// things: refs WE retired in a merge (HLD-XXXXXX), and the raw `product-id`
// value the entry carried at import — a vendor SKU, or prose like "min OOH".
// The second belongs to the holder itself, and deleting on it would delete the
// live holder. The HLD- shape is the discriminator, and nothing but the app
// ever writes that shape.
function deletionReason(entry, records) {
  const ref = String(entry?.['product-id'] ?? '').trim();
  if (!HOLDER_REF_RE.test(ref)) return null;

  for (const r of records || []) {
    if (!r) continue;
    // Its own ref, and the record has been archived → the holder is retired.
    if (r.holder_ref === ref && r.archived === true) {
      return r.merged_into
        ? { record: r, why: 'merged into another holder here' }
        : { record: r, why: 'removed from the holder library here' };
    }
    // A ref an ACTIVE record retired by absorbing it in a merge.
    if (r.archived !== true && (r.legacy_ids || []).includes(ref)) {
      return { record: r, why: `merged into "${r.description || r.holder_ref}"` };
    }
  }
  return null;
}

// ⚠️ THE NEVER-PUSHED ARCHIVE. The ref-based rule above can only see a holder
// whose id already reached Fusion. Retire one before its first push and its
// Fusion entry carries no ref of ours at all — so nothing identified it, and it
// sat there orphaned and un-removable while the app showed it as retired.
//
// Identified with the SAME certainty required to write: the entry matches no
// LIVE record (the caller has already established that), and exactly one
// ARCHIVED record has its shape. Order matters — live records are always tried
// first, so a merge survivor sharing the loser's shape is never mistaken for
// the thing being deleted.
// ⚠️ THE ONE RULE FOR "this Fusion entry belongs to a holder we retired",
// shared by the push (which removes it) and the import (which must NOT bring it
// back). Splitting it produced exactly the bug it exists to prevent: archived
// records are invisible to matching, so the importer read a retired holder's
// entry as a holder it had never seen and re-created it the moment you clicked
// Import before pushing.
// → { record, why } or null.
export function retiredHolderFor(entry, records, tolIn = SEGMENT_MATCH_TOL_IN) {
  const byRef = deletionReason(entry, records);
  if (byRef) return byRef;
  // Shape is only consulted when no LIVE record claims the entry, so a merge
  // survivor sharing the loser's shape is never mistaken for the retired one.
  if (matchFusionHolder(entry, records, tolIn).status !== 'none') return null;
  return archivedByShape(entry, records, tolIn);
}

function archivedByShape(entry, records, tolIn) {
  const hits = (records || []).filter(r =>
    r?.archived === true
    && segmentsMatch(r.segments, r.unit, entry?.segments, entry?.unit, tolIn));
  if (hits.length !== 1) return null;                     // ambiguous → leave it
  const r = hits[0];
  return {
    record: r,
    why: r.merged_into ? 'merged into another holder here' : 'retired here before it was pushed',
  };
}

export function holderPushPlan(fusionEntries, records, tolIn = SEGMENT_MATCH_TOL_IN, toFusion = null) {
  const updates = [];   // { index, entry, record, kind: 'update' | 'adopt', stale }
  const deletes = [];   // { index, entry, record, why } — removed from Fusion
  const flagged = [];   // { entry, ...match } — untouched
  const spokenFor = new Set();
  // ⚠️ ONE RECORD, ONE FUSION ENTRY. Two entries can legitimately resolve to
  // the same record — most often right after merging duplicates HERE, since
  // the merge retires the loser's ref into legacy_ids and both Fusion entries
  // still have the merged shape. Writing the record to both would stamp one
  // app ID onto two holders, which is a duplicate the library can never tell
  // apart again. The first is written; the rest are flagged for a person,
  // because deleting a holder out of Fusion is not ours to do silently.
  const written = new Set();

  const list = fusionEntries || [];
  for (let index = 0; index < list.length; index++) {
    const entry = list[index];
    if (entry?.type !== 'holder') continue;

    // BEFORE matching. An entry carrying a retired ref still resolves to the
    // surviving record (recordForRef searches legacy_ids), so leaving this
    // until after the match would file it as an update or a duplicate and the
    // merged-away holder would live on.
    const del = retiredHolderFor(entry, records, tolIn);
    if (del) { deletes.push({ index, entry, record: del.record, why: del.why }); continue; }

    const m = matchFusionHolder(entry, records, tolIn);

    // The record this entry WOULD be written from — covers the adopt case too,
    // where the match is `geometry-only` and `m.record` is deliberately null.
    const target = m.record || (m.geoRecords.length === 1 ? m.geoRecords[0] : null);
    if (target && written.has(target.id)) {
      flagged.push({
        ...m, entry, status: 'duplicate-entry', record: null,
        reason: `Fusion has more than one holder matching "${target.description || target.holder_ref}". Only the first is written — delete the extra in Fusion, or merge the records here.`,
      });
      continue;
    }

    if (m.status === 'exact') {
      // `stale` is what the badge counts: an identity match only proves Fusion
      // has the right HOLDER, not the right VALUES.
      const diff = toFusion ? holderPushDiff(entry, toFusion(m.record, entry)) : [];
      updates.push({ index, entry, record: m.record, kind: 'update', diff, stale: diff.length > 0 });
      spokenFor.add(m.record.id);
      written.add(m.record.id);
      continue;
    }
    // ⚠️ THE PRIMARY ONGOING WORKFLOW. `ref-only` means our id is on this entry
    // but the shapes disagree — which is BOTH "the user redrew this holder
    // here" (what they're told to do) and "someone edited it in Fusion" (what
    // the strict rule is for). Treating it as the latter refused to write the
    // user's own correction, blamed Fusion for it, and left the badge at 0 —
    // so the holder library silently went stale and stayed stale.
    // What we last pushed settles it exactly: if Fusion is still holding that,
    // nothing moved on its side and the difference is ours to write.
    if (m.status === 'ref-only' && matchesLastPush(entry, m.refRecord, tolIn)) {
      const rec = m.refRecord;
      updates.push({
        index, entry, record: rec, kind: 'update', stale: true,
        diff: toFusion ? holderPushDiff(entry, toFusion(rec, entry)) : [],
      });
      spokenFor.add(rec.id);
      written.add(rec.id);
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
      spokenFor.add(rec.id);
      written.add(rec.id);
      continue;
    }
    // Not a holder we know at all — nothing to write, nothing to flag. (A
    // retired one was already caught above.)
    if (m.status === 'none') continue;
    {
      flagged.push({ entry, ...m });
      // Every record this entry could plausibly be stays claimed, so it is
      // never ALSO appended as a new holder while the flag is unresolved.
      if (m.refRecord) spokenFor.add(m.refRecord.id);
      for (const r of m.geoRecords) spokenFor.add(r.id);
    }
  }

  // An ARCHIVED record is never created — it is retired, not missing.
  const creates = (records || [])
    .filter(r => r?.id && r.archived !== true && !spokenFor.has(r.id));
  return { updates, creates, deletes, flagged };
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
  const dropped = new Set((plan.deletes || []).map(d => d.index));
  const out = [];
  (list || []).forEach((entry, i) => {
    if (dropped.has(i)) return;                       // merged away / retired
    const record = byIndex.get(i);
    out.push(record ? toFusion(record, entry) : entry);
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
  // Deletes count: a merged-away holder Fusion is still carrying is exactly a
  // thing Fusion does not yet agree with.
  return plan.creates.length + plan.deletes.length
    + plan.updates.filter(u => u.stale).length;
}
