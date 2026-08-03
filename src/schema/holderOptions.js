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

// User-added options get a real UUID. Seeded ones deliberately do NOT — see
// seedHolderConfig.
export const newHolderOption = (label, extra = {}, order = 0) =>
  ({ id: generateId(), label, order, ...extra });

const seedOption = (id, label, extra = {}, order = 0) => ({ id, label, order, ...extra });

// ⚠️ SEED IDS ARE STABLE SLUGS, NOT UUIDS — on purpose, and it matters.
// The seed is also the in-memory FALLBACK for a shop whose shop_settings.json
// predates holder_config (a default only materializes when the FILE is created,
// so an established shop never receives it until something saves settings). If
// the seed minted UUIDs at module load, those ids would differ on every page
// load, and any holder record referencing one would dangle after a reload.
// Slugs make the fallback stable and idempotent. Same pattern as the materials
// seed ('P', 'pre_M_aus_316'). Options the USER adds still get real UUIDs.
export function seedHolderConfig() {
  const types = [
    ['ht-collet', 'Collet'], ['ht-shrink', 'Shrink Fit'], ['ht-sidelock', 'End Mill / Side Lock'],
    ['ht-hydraulic', 'Hydraulic'], ['ht-drillchuck', 'Drill Chuck'], ['ht-shellmill', 'Shell Mill'],
    ['ht-boring', 'Boring Head'],
  ].map(([id, label], i) => seedOption(id, label, {}, i));

  // Dual contact is a SEPARATE taper option rather than a modifier flag on a
  // base taper — deliberately redundant because it is simpler than a modifier,
  // and it is how the shop actually names them. `dual_contact` / `nikken` are
  // annotations for the explainer pill, not identity.
  const tapers = [
    ['tp-bt30', 'BT30', {}],
    ['tp-bt30dc', 'BT30 Dual Contact', { dual_contact: true }],
    ['tp-nbt30', 'NBT30', { dual_contact: true, nikken: true }],
    ['tp-bbt30', 'BBT30', { dual_contact: true }],
    ['tp-bt40', 'BT40', {}],
    ['tp-cat40', 'CAT40', {}],
    ['tp-cat40dc', 'CAT40 Dual Contact', { dual_contact: true }],
    ['tp-hsk63a', 'HSK-63A', {}],
    ['tp-hsk40e', 'HSK-40E', {}],
  ].map(([id, label, extra], i) => seedOption(id, label, extra, i));

  const families = [['cf-sk', 'SK'], ['cf-er', 'ER'], ['cf-tg', 'TG']]
    .map(([id, label], i) => seedOption(id, label, {}, i));

  // Collet-size colors are a real column on the shared option record (not a
  // separate override map) — one color per collet SIZE, tinting that size's
  // substring inside every holder description that mentions it.
  const collets = [
    ['cs-sk10', 'SK10', 'cf-sk', '#06b6d4'], ['cs-sk13', 'SK13', 'cf-sk', '#2dd4bf'],
    ['cs-sk16', 'SK16', 'cf-sk', '#8b5cf6'], ['cs-sk20', 'SK20', 'cf-sk', '#eab308'],
    ['cs-er8', 'ER8', 'cf-er', '#4fb8d9'], ['cs-er11', 'ER11', 'cf-er', '#ec4899'],
    ['cs-er16', 'ER16', 'cf-er', '#65a30d'], ['cs-er20', 'ER20', 'cf-er', '#d97830'],
    ['cs-er25', 'ER25', 'cf-er', '#ef4444'], ['cs-er32', 'ER32', 'cf-er', '#45b36b'],
    ['cs-er40', 'ER40', 'cf-er', '#4a8fff'], ['cs-er50', 'ER50', 'cf-er', '#a78bfa'],
  ].map(([id, label, family_id, color], i) => seedOption(id, label, { family_id, color }, i));

  return { types, tapers, collet_families: families, collet_sizes: collets };
}

export const DEFAULT_HOLDER_CONFIG = seedHolderConfig();

// Resolve the live config off shop settings, falling back to the seed.
// The fallback is NOT belt-and-braces — a default only materializes when the
// shared FILE is created, so every shop that already has a shop_settings.json
// would otherwise have no holder options at all. Safe to fall back because the
// seed ids are stable slugs (above); it persists on the next settings save.
export const holderConfigOf = (shopSettings) =>
  (shopSettings?.holder_config?.tapers?.length ? shopSettings.holder_config : DEFAULT_HOLDER_CONFIG);

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
