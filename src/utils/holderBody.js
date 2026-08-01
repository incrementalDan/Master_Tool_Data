// ─── Shared holder bodies — "the same part, modelled twice" ─────────────────
//
// THE PHYSICAL FACT this exists for: a BT-taper holder and an extension are TWO
// SEPARATE PARTS, and the shop assembles them at more than one stickout. So the
// library legitimately holds several records that are the SAME SK collet holder
// and the SAME ER extension, differing only in extension OOH.
//
// Which means the base BODY is duplicated across those records — and duplicated
// data drifts. When two records of one physical holder disagree about its body,
// at least one of them is wrong, and there is no way to tell which from the
// numbers alone. So this reports the disagreement and never picks a winner.
//
// (Modelling the body and the extension as separate records with a pairing —
// the way insert tools do holder body + insert — would remove the duplication
// at the source. That's a real change to the data model, not something to do
// silently; until then this is the guard.)
//
// Checked against the real library: of the four base holders that have more
// than one record, THREE disagree about their own body.

import { holderOptionLabel, taperBase } from '../schema/holderOptions.js';
import { convertLength } from './units.js';
import { segHeight, segUpper, segLower } from './holderGeometry.js';

// The base body = every segment that isn't part of the extension.
// Returns null when the answer isn't knowable yet: the record says it has an
// extension but no segments are flagged, so the body can't be separated from
// it. Null is "unresolved", never "no extension".
export function bodySegments(holder) {
  const segs = holder?.segments;
  if (!Array.isArray(segs) || !segs.length) return null;
  if (!holder.has_extension) return segs;
  const ext = segs.filter(s => s?.ext);
  if (!ext.length) return null;
  return segs.filter(s => !s?.ext);
}

// A comparable fingerprint of the body, normalized to millimetres so an
// inch-native and an mm-native record of the same part still compare. 3
// decimals of mm is finer than anything the source data carries.
export function bodySignature(holder) {
  const segs = bodySegments(holder);
  if (!segs) return null;
  const mm = (v) => convertLength(v, holder.unit, 'millimeters').toFixed(3);
  return segs.map(s => `${mm(segHeight(s))}/${mm(segUpper(s))}/${mm(segLower(s))}`).join(' ');
}

// Which physical base holder a record is built on: taper (normalized, so
// NBT30 / BBT30 / "BT30 Dual Contact" are one taper) + collet size + the
// engraved nominal length. Returns null when any of those is missing — an
// unclassified record can't be grouped, and guessing would create false pairs.
export function baseHolderKey(holder, config) {
  const taper = taperBase(holderOptionLabel(config, 'tapers', holder?.taper_id));
  const collet = holderOptionLabel(config, 'collet_sizes', holder?.collet_size_id);
  const length = holder?.length;
  if (!taper || !collet || length == null || length === '') return null;
  return `${taper}|${collet}|${length}`;
}

// Group records by base holder. Only groups with 2+ records are returned —
// a single record can't disagree with anything.
export function groupByBaseHolder(records, config) {
  const groups = new Map();
  for (const h of records || []) {
    const key = baseHolderKey(h, config);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { key, records: [] });
    groups.get(key).records.push(h);
  }
  return [...groups.values()].filter(g => g.records.length > 1);
}

// Per base holder: the distinct body variants found among its records.
// `variants` has one entry per distinct signature; `unresolved` holds the
// records whose extension segments aren't flagged yet, so they couldn't be
// compared at all (reported separately — absence of evidence, not agreement).
// `divergent` is true only when two records genuinely disagree.
export function findBodyDivergence(records, config) {
  const out = [];
  for (const group of groupByBaseHolder(records, config)) {
    const bySig = new Map();
    const unresolved = [];
    for (const h of group.records) {
      const sig = bodySignature(h);
      if (sig == null) { unresolved.push(h); continue; }
      if (!bySig.has(sig)) bySig.set(sig, []);
      bySig.get(sig).push(h);
    }
    const variants = [...bySig.entries()].map(([signature, recs]) => ({ signature, records: recs }));
    // The majority variant is a display convenience only — it is NOT a verdict.
    // Two records disagreeing about one physical part means at least one is
    // wrong, and nothing here can tell which.
    variants.sort((a, b) => b.records.length - a.records.length);
    out.push({
      key: group.key,
      records: group.records,
      variants,
      unresolved,
      divergent: variants.length > 1,
    });
  }
  return out;
}

// The divergence affecting ONE record, or null. Used by the detail page to say
// "this body disagrees with these siblings" — naming them, because the useful
// question is always "which of these two is right".
export function bodyDivergenceFor(holder, records, config) {
  if (!holder) return null;
  const key = baseHolderKey(holder, config);
  if (!key) return null;
  const group = findBodyDivergence(records, config).find(g => g.key === key);
  if (!group || !group.divergent) return null;
  const mine = bodySignature(holder);
  if (mine == null) return null;
  const others = group.variants.filter(v => v.signature !== mine);
  if (!others.length) return null;
  return {
    key,
    mineCount: group.variants.find(v => v.signature === mine)?.records.length || 1,
    others: others.map(v => ({ count: v.records.length, records: v.records })),
  };
}

// Every record that is part of a divergent group (for the list-page filter).
export function recordsWithBodyDivergence(records, config) {
  const ids = new Set();
  for (const g of findBodyDivergence(records, config)) {
    if (!g.divergent) continue;
    for (const h of g.records) if (bodySignature(h) != null) ids.add(h.id);
  }
  return ids;
}
