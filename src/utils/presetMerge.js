// Preset comparison + merge — the single source of the speed/feed significance
// tolerance and the "union two preset lists" logic. Pure (no React), so it's
// shared by the merge UI (DiffStep) AND the load-time / combine code paths
// (buildLogicalTool, mergeLogicalTools) that fold a tool's Fusion instances.
//
// Rules (from the shop): when the same logical tool has several Fusion entries
// (one per assembly), their presets should MERGE into one set — presets that are
// equal within the machining-significance tolerance below collapse to one, and
// same-name presets whose values genuinely differ are BOTH kept, the later one's
// name indexed up (Rough, Rough 2, Rough 3, …).
import { generateId } from '../schema/identity.js';

// ── Significance thresholds ───────────────────────────────────────────────────
// A preset value counts as "changed" only when |a − b| > max(rel × magnitude,
// abs). Differences below this are machining noise (10 RPM, float round-trip
// dust), not knowledge. abs floors are inch units; fields marked `len` scale
// ×25.4 for a millimeters tool. This is the tolerance the Sync-Job diff already
// uses — kept here so every path agrees on "are these two presets the same".
export const PRESET_SIGNIFICANCE = {
  n:              { rel: 0.01, abs: 15 },                   // RPM
  n_ramp:         { rel: 0.01, abs: 15 },
  v_c:            { rel: 0.01, abs: 1 },                    // surface speed
  v_f:            { rel: 0.02, abs: 0.1,     len: true },   // feeds
  v_f_plunge:     { rel: 0.02, abs: 0.1,     len: true },
  v_f_ramp:       { rel: 0.02, abs: 0.1,     len: true },
  v_f_leadIn:     { rel: 0.05, abs: 0.1,     len: true },   // followers of v_f — looser
  v_f_leadOut:    { rel: 0.05, abs: 0.1,     len: true },
  v_f_transition: { rel: 0.05, abs: 0.1,     len: true },
  f_z:            { rel: 0.02, abs: 0.00005, len: true },   // chip load — 0.0001" is real
  f_n:            { rel: 0.02, abs: 0.00005, len: true },
  'ramp-angle':   { rel: 0,    abs: 0.25 },
  stepdown:       { rel: 0.10, abs: 0.005,   len: true },   // DOC reference value — coarse
  stepover:       { rel: 0.02, abs: 0.0005,  len: true },   // WOC — small diffs matter
};

// The speed/feed fields compared between two presets, and which of them are numeric.
export const PRESET_DIFF_FIELDS = [
  'n', 'v_c', 'n_ramp',
  'v_f', 'f_z',
  'v_f_plunge', 'f_n',
  'v_f_leadIn', 'v_f_leadOut', 'v_f_transition',
  'v_f_ramp', 'ramp-angle',
  'use-stepdown', 'stepdown',
  'use-stepover', 'stepover',
  'tool-coolant',
];

export const NUMERIC_PRESET_FIELDS = new Set([
  'n', 'v_c', 'n_ramp',
  'v_f', 'f_z',
  'v_f_plunge', 'f_n',
  'v_f_leadIn', 'v_f_leadOut', 'v_f_transition',
  'v_f_ramp', 'ramp-angle',
  'stepdown', 'stepover',
]);

export function presetTolerance(field, a, b, unit) {
  const sig = PRESET_SIGNIFICANCE[field];
  if (!sig) return 0.0001;
  const mag = Math.max(Math.abs(Number(a)), Math.abs(Number(b)));
  const scale = (sig.len && unit === 'millimeters') ? 25.4 : 1;
  return Math.max(sig.rel * mag, sig.abs * scale);
}

export function valuesEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const isEmpty = v => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
  if (isEmpty(a) && isEmpty(b)) return true;
  const na = Number(a), nb = Number(b);
  // Numbers that round to the same 4-decimal display are equal — anything closer
  // is float round-trip noise from Fusion, not a real difference.
  if (!isNaN(na) && !isNaN(nb) && a !== '' && b !== '') return Math.abs(na - nb) < 5e-5;
  return false;
}

// Are two presets the SAME within the machining-significance tolerance? Compares
// only speed/feed values (NOT the name) — the caller decides name matching.
export function presetValuesEquivalent(a, b, unit = 'inches') {
  for (const f of PRESET_DIFF_FIELDS) {
    if (NUMERIC_PRESET_FIELDS.has(f)) {
      const na = Number(a?.[f]), nb = Number(b?.[f]);
      if (!isNaN(na) && !isNaN(nb)) {
        if (Math.abs(na - nb) > presetTolerance(f, na, nb, unit)) return false;
        continue;
      }
    }
    if (!valuesEqual(a?.[f], b?.[f])) return false;
  }
  return true;
}

const nameKey = (p) => String(p?.name || '').trim().toLowerCase();

// Given a desired name and the set of names already used (lowercased), return the
// name unchanged if free, else "<name> 2", "<name> 3", … until one is free.
function nextIndexedName(name, usedLower) {
  const base = String(name || 'Preset').trim() || 'Preset';
  if (!usedLower.has(base.toLowerCase())) return base;
  let i = 2;
  while (usedLower.has(`${base} ${i}`.toLowerCase())) i++;
  return `${base} ${i}`;
}

// Union `incoming` presets into `base`, per the shop rule:
//   • an incoming preset that value-matches an EXISTING same-name preset within
//     tolerance is dropped (they're the same setting) — collapse to one;
//   • an incoming preset whose name collides but whose values genuinely differ is
//     KEPT with its name indexed up (Rough → Rough 2 → Rough 3 …);
//   • a fresh guid is minted for any kept preset whose guid already exists in the
//     result (Fusion copies keep the source guid — a duplicate guid would corrupt
//     preset_meta / assembly linked_preset_guids), so links stay unambiguous.
// `base` and `incoming` are internal preset objects. Returns a new array; inputs
// are not mutated. When instances are identical (the well-formed case) this is a
// no-op — every incoming preset collapses into its base twin.
export function mergePresetLists(base = [], incoming = [], unit = 'inches') {
  const result = [...(base || [])];
  const usedNames = new Set(result.map(nameKey));
  const usedGuids = new Set(result.map(p => p?.guid).filter(Boolean));

  for (const inc of (incoming || [])) {
    if (!inc) continue;
    const sameName = result.filter(p => nameKey(p) === nameKey(inc));
    if (sameName.some(p => presetValuesEquivalent(p, inc, unit))) continue;  // duplicate → drop

    const name = sameName.length ? nextIndexedName(inc.name, usedNames) : (inc.name || 'Preset');
    let guid = inc.guid;
    if (!guid || usedGuids.has(guid)) guid = generateId();
    const kept = { ...inc, name, guid };
    result.push(kept);
    usedNames.add(nameKey(kept));
    usedGuids.add(guid);
  }
  return result;
}
