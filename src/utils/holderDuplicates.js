// ─── Duplicate holders — find them, and merge without rewriting anything ────
//
// THE WORKFLOW THIS SERVES: most of the library was put together in a hurry.
// The plan is to match the existing holders to the tool library first, then
// refine the holders — so everything already out there inherits the better
// data. Refining often means building a corrected holder in Fusion alongside
// the old one, which lands here as a near-duplicate.
//
// MATCHED ON DESCRIPTION + SPECS + GAUGE LENGTH, NEVER SEGMENT-BY-SEGMENT —
// the same priority the audit uses. Two records of one physical assembly agree
// about what they are and how long they are; if they also happened to disagree
// about a segment, that's the thing you're merging to fix, not a reason to miss
// the match.
//
// ⚠️ THE MERGE DOESN'T REWRITE ANYTHING THAT POINTS AT THE OLD HOLDER.
// A tool references a holder by the Fusion guid absorbed into it. So instead of
// rewriting every tool, the SURVIVING record ADOPTS the loser's guid as an
// alias (`legacy_fusion_guids`). Every tool that referenced the old holder then
// resolves to the survivor — with zero writes to the tool library, and it works
// for tools that aren't even loaded. Same "derive, don't rewrite" shape as the
// rest of the app.

import { holderOptionLabel, taperBase } from '../schema/holderOptions.js';
import { deriveGaugeLength, holderLenIn } from './holderGeometry.js';
import { HOLDER_GAUGE_TOL_IN } from './holderAudit.js';

// Every Fusion guid that should resolve to this record: its own, plus the guids
// of holders merged into it.
export function holderGuidsOf(record) {
  const out = [];
  if (record?.fusion_guid) out.push(record.fusion_guid);
  for (const g of record?.legacy_fusion_guids || []) if (g) out.push(g);
  return out;
}

export const holderOwnsGuid = (record, guid) =>
  !!guid && holderGuidsOf(record).includes(guid);

// The record a Fusion guid resolves to, following merges.
export const holderForGuid = (records, guid) =>
  (records || []).find(h => holderOwnsGuid(h, guid)) || null;

// ─── Detection ──────────────────────────────────────────────────────────────

const gaugeIn = (h) => holderLenIn(deriveGaugeLength(h?.segments), h?.unit);

// Normalized description tokens, for the case where classification is still
// blank (a hastily-entered holder that hasn't been healed yet).
const descTokens = (s) =>
  new Set(String(s || '').toUpperCase().replace(/[^A-Z0-9.]+/g, ' ').trim().split(/\s+/).filter(Boolean));

function descSimilarity(a, b) {
  const A = descTokens(a); const B = descTokens(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared / Math.max(A.size, B.size);
}

// Compare one classified field. Returns 'agree' | 'conflict' | 'unknown' —
// `unknown` when either side hasn't been classified yet, which is NOT a
// disagreement (most of the library starts unclassified).
function cmp(a, b) {
  const blank = (v) => v == null || v === '';
  if (blank(a) && blank(b)) return 'agree';
  if (blank(a) || blank(b)) return 'unknown';
  return String(a) === String(b) ? 'agree' : 'conflict';
}

// Score a pair. Returns null when they clearly aren't the same holder.
export function compareHolders(a, b, config, tol = HOLDER_GAUGE_TOL_IN) {
  if (!a || !b || a.id === b.id) return null;

  const ga = gaugeIn(a); const gb = gaugeIn(b);
  const gaugeDelta = (ga != null && gb != null) ? ga - gb : null;
  const gaugeAgrees = gaugeDelta != null && Math.abs(gaugeDelta) <= tol;

  const fields = [
    { name: 'Taper', v: cmp(taperBase(holderOptionLabel(config, 'tapers', a.taper_id)),
      taperBase(holderOptionLabel(config, 'tapers', b.taper_id))) },
    { name: 'Type', v: cmp(a.type_id, b.type_id) },
    { name: 'Collet', v: cmp(a.collet_size_id, b.collet_size_id) },
    { name: 'Length', v: cmp(a.length, b.length) },
    { name: 'Extension', v: cmp(!!a.has_extension, !!b.has_extension) },
    { name: 'Ext collet', v: cmp(a.extension?.collet_size_id, b.extension?.collet_size_id) },
  ];
  const conflicts = fields.filter(f => f.v === 'conflict');
  const agreements = fields.filter(f => f.v === 'agree');
  const sim = descSimilarity(a.description, b.description);

  // Gauge length is the deciding signal — it's the one number both records
  // state about the same physical thing. Without it agreeing, this isn't a
  // duplicate; it's two different setups (a different stickout, usually).
  if (!gaugeAgrees) return null;

  // A hard classification conflict means they say they're different holders
  // that merely happen to be the same length. Report it, but as a weaker
  // "possible" — worth a human look, not an obvious merge.
  const verdict = conflicts.length ? 'possible' : 'duplicate';

  const reasons = [];
  reasons.push(gaugeDelta === 0
    ? 'Identical gauge length'
    : `Gauge length within ${tol}" (Δ ${gaugeDelta.toFixed(4)}")`);
  if (agreements.length) reasons.push(`Same ${agreements.map(f => f.name.toLowerCase()).join(', ')}`);
  if (sim >= 0.5) reasons.push(`Descriptions ${Math.round(sim * 100)}% alike`);
  for (const c of conflicts) reasons.push(`⚠ ${c.name} differs`);

  return {
    a, b, verdict, reasons, conflicts: conflicts.map(c => c.name),
    gaugeDelta, descSimilarity: sim,
    // Confidence is only used for ordering the list, never to auto-merge.
    score: agreements.length + sim - conflicts.length * 2,
  };
}

// Every duplicate candidate in the library, best first. Pairs only — a
// three-way pile-up shows as three pairs, and merging one re-runs the rest.
export function findHolderDuplicates(records, config, tol = HOLDER_GAUGE_TOL_IN) {
  const list = records || [];
  const out = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const m = compareHolders(list[i], list[j], config, tol);
      if (m) out.push(m);
    }
  }
  return out.sort((x, y) => y.score - x.score);
}

export function holdersInDuplicates(records, config, tol) {
  const ids = new Set();
  for (const m of findHolderDuplicates(records, config, tol)) { ids.add(m.a.id); ids.add(m.b.id); }
  return ids;
}

// ─── Merge ──────────────────────────────────────────────────────────────────

// Fields the survivor will take from the loser ONLY where the survivor is
// blank. The survivor is the record the user judged more correct, so nothing it
// already says is ever overwritten — the merge adds, it doesn't argue.
const FILL_GAP_FIELDS = [
  'manufacturer', 'part_number', 'vendor', 'product_link',
  'location', 'notes', 'color', 'length',
  'type_id', 'taper_id', 'collet_family_id', 'collet_size_id',
  'body_part_id', 'extension_part_id',
];

const isBlank = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);

// Merge `loser` into `survivor`. Returns { record, filled, adoptedGuids } —
// `filled` names every field that was taken from the loser so the preview can
// show it. GEOMETRY IS NEVER TAKEN: the whole point of picking a survivor is
// that its geometry is the one you want.
export function mergeHolderRecords(survivor, loser) {
  if (!survivor || !loser) return null;
  const next = { ...survivor };
  const filled = [];

  for (const key of FILL_GAP_FIELDS) {
    if (isBlank(next[key]) && !isBlank(loser[key])) {
      next[key] = loser[key];
      filled.push(key);
    }
  }
  // Purchasing is an object of two arrays — only adopt it wholesale when the
  // survivor has none, rather than trying to reconcile two lists.
  const hasPurchasing = (p) => !!(p?.manufacturers?.length || p?.vendors?.length);
  if (!hasPurchasing(next.purchasing) && hasPurchasing(loser.purchasing)) {
    next.purchasing = loser.purchasing;
    filled.push('purchasing');
  }
  if (isBlank(next.extension?.collet_size_id) && !isBlank(loser.extension?.collet_size_id)) {
    next.extension = { ...(next.extension || {}), ...loser.extension };
    filled.push('extension');
  }

  // ⚠️ THE POINT OF THE MERGE. Adopting the loser's Fusion guid (and any it had
  // already adopted) means every tool that referenced the old holder resolves
  // to this record from now on — without touching a single tool.
  const adoptedGuids = [...new Set([
    ...(next.legacy_fusion_guids || []),
    ...holderGuidsOf(loser),
  ])].filter(g => g && g !== next.fusion_guid);

  next.legacy_fusion_guids = adoptedGuids;
  // The loser's human-readable reference stays searchable, same as a retired
  // tool ID.
  next.legacy_ids = [...new Set([
    ...(next.legacy_ids || []),
    ...(loser.legacy_ids || []),
    ...(loser.holder_ref ? [loser.holder_ref] : []),
  ])];
  next.updated_at = new Date().toISOString();

  return { record: next, filled, adoptedGuids };
}

// Apply a merge to the whole file: the survivor is replaced with the merged
// record and the loser is removed. Any holder PART the loser was the only user
// of is left alone — parts are shared records and deleting one here would be a
// surprise.
export function applyHolderMerge(file, survivorId, loserId) {
  const holders = file?.holders || [];
  const survivor = holders.find(h => h.id === survivorId);
  const loser = holders.find(h => h.id === loserId);
  if (!survivor || !loser) return file;
  const { record } = mergeHolderRecords(survivor, loser);
  return {
    ...file,
    holders: holders
      .filter(h => h.id !== loserId)
      .map(h => (h.id === survivorId ? record : h)),
  };
}

// How many tool assemblies would follow the merge — i.e. how many currently
// resolve to the loser and will resolve to the survivor afterwards.
// `usesHolder` is injected rather than imported so this module stays free of a
// schema dependency; callers pass assemblyUsesHolder (holderResolve.js).
export function toolsFollowingMerge(loser, tools, usesHolder) {
  const guids = new Set(holderGuidsOf(loser));
  const hit = usesHolder
    ? (a) => usesHolder(a, loser)
    : (a) => !!a.holder_guid && guids.has(a.holder_guid);
  let count = 0;
  for (const t of tools || []) {
    for (const a of t.assemblies || []) if (hit(a)) count++;
  }
  return count;
}
