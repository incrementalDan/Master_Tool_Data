// ─── Holder option lookups — the bin_sizes pattern ──────────────────────────
//
// `type`, `taper`, `collet family` and `collet size` are UUID-referenced SHARED
// lookups, not free strings. A holder record stores the option's id; renaming
// the label once updates everything referencing it, and "add custom" appends a
// real option that shows up everywhere.
//
// Why: the real holder library shows exactly the failure mode free text
// produces — `vendor` is inconsistently a company ("Maritool") or a collet spec
// ("SK13-ER8"), and type/taper/collet exist ONLY inside free-text descriptions.
// UUID refs also match the documented SQLite path.
//
// These live in shop_settings.json under `holder_config`, alongside
// location_config.bin_sizes — same machinery, not a parallel system.

import { generateId } from './identity.js';

export const HOLDER_OPTION_LISTS = ['types', 'tapers', 'collet_families', 'collet_sizes'];

export const newHolderOption = (label, extra = {}, order = 0) =>
  ({ id: generateId(), label, order, ...extra });

// Seeds. Ids are minted at module load exactly like location_config.bin_sizes —
// the seed only applies when shop_settings has no holder_config yet.
function seedHolderConfig() {
  const type = (label) => newHolderOption(label);
  const types = [
    'Collet', 'Shrink Fit', 'End Mill / Side Lock', 'Hydraulic',
    'Drill Chuck', 'Shell Mill', 'Boring Head',
  ].map((l, i) => ({ ...type(l), order: i }));

  // Dual contact is a SEPARATE taper option rather than a modifier flag on a
  // base taper — deliberately redundant because it is simpler than a modifier,
  // and it is how the shop actually names them. `dual_contact` / `nikken` are
  // annotations for the explainer pill, not identity.
  const tapers = [
    { label: 'BT30' },
    { label: 'BT30 Dual Contact', dual_contact: true },
    { label: 'NBT30', dual_contact: true, nikken: true },
    { label: 'BBT30', dual_contact: true },
    { label: 'BT40' },
    { label: 'CAT40' },
    { label: 'CAT40 Dual Contact', dual_contact: true },
    { label: 'HSK-63A' },
    { label: 'HSK-40E' },
  ].map(({ label, ...rest }, i) => newHolderOption(label, rest, i));

  const families = ['SK', 'ER', 'TG'].map((l, i) => newHolderOption(l, {}, i));
  const famId = (l) => families.find(f => f.label === l).id;

  // Collet-size colors are a real column on the shared option record (not a
  // separate override map) — one color per collet SIZE, tinting that size's
  // substring inside every holder description that mentions it.
  const collets = [
    ['SK10', 'SK', '#06b6d4'], ['SK13', 'SK', '#2dd4bf'], ['SK16', 'SK', '#8b5cf6'],
    ['SK20', 'SK', '#eab308'],
    ['ER8', 'ER', '#4fb8d9'], ['ER11', 'ER', '#ec4899'], ['ER16', 'ER', '#65a30d'],
    ['ER20', 'ER', '#d97830'], ['ER25', 'ER', '#ef4444'], ['ER32', 'ER', '#45b36b'],
    ['ER40', 'ER', '#4a8fff'], ['ER50', 'ER', '#a78bfa'],
  ].map(([label, fam, color], i) => newHolderOption(label, { family_id: famId(fam), color }, i));

  return { types, tapers, collet_families: families, collet_sizes: collets };
}

export const DEFAULT_HOLDER_CONFIG = seedHolderConfig();

// ─── Readers ────────────────────────────────────────────────────────────────
// All tolerate a missing config (a shop that predates it) and a dangling id
// (the referenced option was deleted) — same soft-delete tolerance as every
// other FK in the app.

export const holderOptions = (config, list) =>
  (config && Array.isArray(config[list]) ? config[list] : [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

export const holderOption = (config, list, id) =>
  (id ? holderOptions(config, list).find(o => o.id === id) : null) || null;

export const holderOptionLabel = (config, list, id) =>
  holderOption(config, list, id)?.label || null;

// Collet sizes filtered to one family (all of them when no family is set).
export const colletSizesForFamily = (config, familyId) =>
  holderOptions(config, 'collet_sizes').filter(o => !familyId || o.family_id === familyId);

export const colletSizeColor = (config, id) => holderOption(config, 'collet_sizes', id)?.color || null;

// ─── Taper normalization for matching ───────────────────────────────────────
// NBT30 / BBT30 / "BT30 Dual Contact" are all physically a BT30 taper. Matching
// strictly on the name creates false mismatches on naming alone, so the audit
// compares normalized bases. Derived from the label — add a taper to the lookup
// and matching picks it up, no constant to maintain.
export function taperBase(label) {
  return String(label || '')
    .replace(/\s*dual\s*contact/i, '')
    .replace(/^[NB](?=BT\d)/i, '')
    .trim()
    .toUpperCase();
}

// Every taper label in the lookup, longest first so NBT30 wins over BT30 when
// both would match a description.
export function taperLabelsLongestFirst(config) {
  return holderOptions(config, 'tapers')
    .map(t => String(t.label || '').toUpperCase().replace(/\s*DUAL CONTACT/i, '').trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}
