// ─── Vendor registry — unified manufacturer/vendor entity list ───────────────
//
// The registry is now data-driven: the live list of entities comes from
// vendor_registry.json on Google Drive (loaded at startup, editable later).
// Each entity can be a manufacturer, a vendor, or both — role is determined by
// the `is_manufacturer` / `is_vendor` flags, not by separate arrays.
//
// This module holds:
//   • DEFAULT_VENDOR_REGISTRY — the seed used to create the Drive file on first
//     run (assembled from the data that used to be hardcoded here + in
//     urlGenerators.js, so no entries are lost in the migration).
//   • an "active registry" — set by AppContext after the Drive file loads — so
//     the pure helper functions below (and urlGenerators.js) resolve against the
//     live data even when called from non-React modules.
//
// Entity shape:
//   { id, name, aliases[], is_manufacturer, is_vendor, has_own_catalog_number,
//     edp_url_pattern, vendor_num_url_pattern, proshop_id, material_code_system, order }
//
// `material_code_system` (manufacturers only) names which material-classification
// standard that manufacturer publishes — an id from MATERIAL_CODE_SYSTEMS
// (sharedDefaults.js): 'iso_513' | 'kennametal' | 'vdi_3323' | null. It lets the
// manufacturer's catalog material codes cross-reference our CAM presets, which
// carry the equivalent code in each standard.
//
// `name` is the preferred/canonical name — the only one shown on tools and
// exported. `aliases[]` are alternate spellings ("GARR" for "GARR Tool",
// "Helical" for "Helical Solutions", misspellings, etc.) used ONLY to match
// inconsistent free-text entries from ProShop import and AI extraction back to
// the canonical entity. Aliases are never shown or exported.

function rid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ── Seed inputs (migrated — no longer the public API) ────────────────────────

const SEED_MANUFACTURERS = [
  'Accupro', 'Cleveland', 'Emuge', 'GARR Tool', 'HAIMER', 'Harvey Tool', 'Helical Solutions',
  'Hertel', 'Ingersoll Cutting Tools', 'Internal Tool', 'Iscar', 'Kennametal',
  'Keo', 'LMT', 'M.A. Ford', 'Melin Tool', 'Micro 100', 'Mitsubishi', 'OSG',
  'RobbJack', 'SGS', 'Sandvik Coromant', 'Seco', 'Titan USA', 'Tungaloy',
  'Value Collection', 'Widia', 'YG-1', 'Guhring',
  'Fraisa USA', 'Haas Automation', 'Lakeshore Carbide', 'Liberty Tool Co',
];

// Alternate names for the canonical entity above. ProShop's free-text Brand
// field has no consistency (we'd type "GARR" or "Helical" instead of the full
// name), so these let import/extraction map the variants back to one entity.
const SEED_ALIASES = {
  'GARR Tool': ['GARR'],
  'Helical Solutions': ['Helical'],
};

const SEED_VENDORS = [
  'Adion Systems', 'ALMCO', 'B&B Dynamic Machining', 'Boedeker Plastics, Inc.',
  'Butler Bros Supply Division', 'Camden Tool Inc', 'Castle Metals', 'CMW Tech',
  'Copper and Brass Sales', 'Evans Heat Treating', 'Finishing Innovations LLC',
  'Haas Automation', 'Hadco Metal Trading', 'Hard Chrome Specialists, Inc.',
  'Hillock Anodizing', 'Industraplate', 'Jones Kinden', 'K&L Plating Company',
  'Laser Source', 'Liberty Manufacturing',
  'McMaster-Carr', 'Metropolitan Flag & Banner Co', 'MSC Industrial', 'NexGenSolutions',
  'Online Metals', 'Orange Vise Company LLC', 'Penn Stainless Products',
  'Pennsylvania Steel Company', 'Pierson Workholding', 'Precision Finishing',
  'PTSolutions', 'SK Industrial', 'Vibrant Finish LLC', 'Yamazen Inc', 'Yarde Metals',
  // Vendors that assign their own catalog numbers (from the old VENDORS_WITH_OWN set)
  'Grainger', 'Zoro Tools', 'Travers Tool', 'Fastenal',
];

const SEED_OWN_NUMBER_VENDORS = new Set([
  'MSC Industrial', 'Grainger', 'McMaster-Carr', 'Zoro Tools', 'Travers Tool', 'Fastenal',
]);

// URL patterns (migrated from urlGenerators.js). Tokens: {edp}, {edp_lower}, {vendor_num}.
const SEED_EDP_PATTERNS = {
  'Harvey Tool': 'https://www.harveytool.com/products/tool-details-{edp_lower}',
  'Helical Solutions': 'https://www.helicaltool.com/products/tool-details-{edp}',
  'Micro 100': 'https://www.micro100.com/products/tool-details-{edp_lower}',
  'GARR Tool': 'https://www.garrtool.com/product-details/?EDP={edp}',
  'OSG': 'https://osgtool.com/{edp_lower}/',
  'Haas Automation': 'https://www.haastooling.com/p/{edp}',
};
const SEED_VENDOR_NUM_PATTERNS = {
  'MSC Industrial': 'https://www.mscdirect.com/product/details/{vendor_num}',
  'McMaster-Carr': 'https://www.mcmaster.com/{vendor_num}/',
  'Haas Automation': 'https://www.haastooling.com/p/{vendor_num}',
};

// ProShop "Approved Brand"/"Vendor" cells export the contact's Unique Id (e.g.
// "MSC1"), not the company name. proshop_id on each entity preserves that map so
// resolveVendorName() still works after the migration.
const SEED_PROSHOP_IDS = {
  ADI1: 'Adion Systems', ALM1: 'ALMCO', BBD1: 'B&B Dynamic Machining', BOE1: 'Boedeker Plastics, Inc.',
  BUT1: 'Butler Bros Supply Division', CAM1: 'Camden Tool Inc', CAS1: 'Castle Metals', CMW1: 'CMW Tech',
  COP1: 'Copper and Brass Sales', EVA1: 'Evans Heat Treating', FIN1: 'Finishing Innovations LLC',
  FRA1: 'Fraisa USA', HAA1: 'Haas Automation', HAD2: 'Hadco Metal Trading', HAR1: 'Hard Chrome Specialists, Inc.',
  HIL1: 'Hillock Anodizing', IND1: 'Industraplate', JON1: 'Jones Kinden', KLP1: 'K&L Plating Company',
  LAK1: 'Lakeshore Carbide', LAS1: 'Laser Source', LIB1: 'Liberty Tool Co', LIB2: 'Liberty Manufacturing',
  MCM1: 'McMaster-Carr', MET1: 'Metropolitan Flag & Banner Co', MSC1: 'MSC Industrial', NEX1: 'NexGenSolutions',
  ONL1: 'Online Metals', ORA1: 'Orange Vise Company LLC', PEN2: 'Penn Stainless Products',
  PEN3: 'Pennsylvania Steel Company', PIE1: 'Pierson Workholding', PRE1: 'Precision Finishing',
  PTS1: 'PTSolutions', SKI1: 'SK Industrial', VIB1: 'Vibrant Finish LLC', YAM1: 'Yamazen Inc', YAR1: 'Yarde Metals',
};

function buildDefaultEntities() {
  const byName = new Map();
  const ensure = (name) => {
    if (!byName.has(name)) {
      byName.set(name, {
        id: rid(), name, aliases: [], is_manufacturer: false, is_vendor: false,
        has_own_catalog_number: false, edp_url_pattern: null, vendor_num_url_pattern: null,
        proshop_id: null, material_code_system: null, order: 0,
      });
    }
    return byName.get(name);
  };
  for (const name of SEED_MANUFACTURERS) {
    const e = ensure(name);
    e.is_manufacturer = true;
    if (SEED_EDP_PATTERNS[name]) e.edp_url_pattern = SEED_EDP_PATTERNS[name];
  }
  for (const name of SEED_VENDORS) {
    const e = ensure(name);
    e.is_vendor = true;
    if (SEED_OWN_NUMBER_VENDORS.has(name)) e.has_own_catalog_number = true;
    if (SEED_VENDOR_NUM_PATTERNS[name]) e.vendor_num_url_pattern = SEED_VENDOR_NUM_PATTERNS[name];
  }
  for (const [pid, name] of Object.entries(SEED_PROSHOP_IDS)) {
    const e = byName.get(name);
    if (e) e.proshop_id = pid;
  }
  for (const [name, aliases] of Object.entries(SEED_ALIASES)) {
    const e = byName.get(name);
    if (e) e.aliases = [...aliases];
  }
  const entities = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  entities.forEach((e, i) => { e.order = i; });
  return entities;
}

export const DEFAULT_VENDOR_REGISTRY = { version: 1, entities: buildDefaultEntities() };

// ── Active registry (live data; set by AppContext after the Drive file loads) ─

let _active = DEFAULT_VENDOR_REGISTRY;
export function setActiveVendorRegistry(reg) {
  if (reg && Array.isArray(reg.entities)) _active = reg;
}
export function getActiveVendorRegistry() { return _active; }

function entitiesOf(reg) { return (reg || _active)?.entities || []; }

// ── Public API (reads the active registry, or an explicitly-passed one) ──────

export function getManufacturerNames(reg) {
  return entitiesOf(reg).filter(e => e.is_manufacturer).map(e => e.name).sort((a, b) => a.localeCompare(b));
}

export function getVendorNames(reg) {
  return entitiesOf(reg).filter(e => e.is_vendor).map(e => e.name).sort((a, b) => a.localeCompare(b));
}

// Match a free-text name to an entity by its canonical name OR any of its
// aliases (case-insensitive). This is what makes "GARR" resolve to the "GARR
// Tool" entity for URL generation, has-own-number lookups, etc.
export function entityByName(name, reg) {
  if (!name) return null;
  const n = String(name).toLowerCase().trim();
  return entitiesOf(reg).find(e =>
    e.name.toLowerCase().trim() === n ||
    (e.aliases || []).some(a => a.toLowerCase().trim() === n)
  ) || null;
}

export function vendorHasOwnCatalogNumber(name, reg) {
  return !!entityByName(name, reg)?.has_own_catalog_number;
}

// Resolve a ProShop "Approved Brand"/"Vendor" cell — which may be a Unique Id
// (e.g. "MSC1"), the canonical company name, or an alias/variant ("GARR",
// "Helical") — to the canonical company name. Unknown values pass through
// unchanged so free-text we don't know yet is preserved.
export function resolveVendorName(value, reg) {
  if (!value) return value;
  const trimmed = String(value).trim();
  const up = trimmed.toUpperCase();
  // 1. ProShop unique-id (e.g. "MSC1")
  const byId = entitiesOf(reg).find(e => e.proshop_id && e.proshop_id.toUpperCase() === up);
  if (byId) return byId.name;
  // 2. Canonical name or alias → preferred name
  const byName = entityByName(trimmed, reg);
  if (byName) return byName.name;
  // 3. Unknown — pass through
  return trimmed;
}

// ─── Registry foreign key (store the id, render the name) ────────────────────
// A tool's purchasing manufacturers/vendors link to the shared vendor_registry
// entity by its STABLE id (`registry_id`), not by the mutable display name — so
// renaming an entity in the /vendors editor doesn't orphan the tools pointing at
// it. The name shown/exported is DERIVED from the id against the live registry.
// Mirrors the CAM-preset FK (presetNaming.js) and how everything else stores ids
// and composes labels at read time. Free-text names not in the registry keep
// resolving as before (no id — the stored name is the value).

// Find a registry entity by its stable id (null when absent/dangling).
export function entityById(id, reg) {
  if (!id) return null;
  return entitiesOf(reg).find(e => e.id === id) || null;
}

// The registry entity id a free-text name/alias/ProShop-id refers to, or null
// when it matches no entity (genuinely free text). Mirrors camPresetIdForQuery.
export function registryIdForName(name, reg) {
  if (!name) return null;
  const trimmed = String(name).trim();
  const up = trimmed.toUpperCase();
  const byId = entitiesOf(reg).find(e => e.proshop_id && e.proshop_id.toUpperCase() === up);
  if (byId) return byId.id;
  return entityByName(trimmed, reg)?.id || null;
}

// Refresh one purchasing entry's `name` from its `registry_id` — the id is the
// source of truth, the name is derived live. Also adopts the id from a
// name-matched entry (so existing name-only links become rename-proof), and
// tolerates a dangling id (keeps the stored name). Returns the entry unchanged
// when it has no id AND no name match. Mirrors syncPresetMaterialName.
function syncEntryName(entry, reg) {
  if (!entry) return entry;
  const id = entry.registry_id || registryIdForName(entry.name, reg);
  if (!id) return entry;
  const ent = entityById(id, reg);
  if (!ent) return entry;                       // dangling id — keep stored name
  if (entry.registry_id === id && entry.name === ent.name) return entry; // no change
  return { ...entry, registry_id: id, name: ent.name };
}

// Refresh every manufacturer/vendor name in a purchasing object from its FK id.
// Returns the same object when nothing changed (stable identity for memoization).
export function syncPurchasingNames(purchasing, reg) {
  if (!purchasing) return purchasing;
  let changed = false;
  const mapList = (list) => (list || []).map(e => {
    const ne = syncEntryName(e, reg);
    if (ne !== e) changed = true;
    return ne;
  });
  const manufacturers = mapList(purchasing.manufacturers);
  const vendors = mapList(purchasing.vendors);
  return changed ? { ...purchasing, manufacturers, vendors } : purchasing;
}

// Walk a tool list and sync every purchasing name from its FK id — the load-time
// backfill (mirrors backfillMaterialPresetIds / backfillAsmNumbers; persisted
// lazily on each tool's next save).
export function backfillPurchasingRegistryIds(tools, reg) {
  if (!entitiesOf(reg).length) return tools;
  return (tools || []).map(t => {
    if (!t.purchasing) return t;
    const np = syncPurchasingNames(t.purchasing, reg);
    return np === t.purchasing ? t : { ...t, purchasing: np };
  });
}
