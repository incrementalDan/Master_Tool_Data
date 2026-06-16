// Default content for the shared Drive files, used to create them on first run
// (see driveService.loadOrCreateSharedJson). vendor_registry.json's default
// lives in vendorRegistry.js (it's assembled from the existing registry data).

// materials.json — shop-editable material groups + sub-materials.
// `groups` are the standard ISO turning material groups (P/M/K/N/S/H); the
// `iso` flag marks the standards. `code` is the short token used in preset names
// (e.g. "SS 2.125 30-SK13-60 - Rough") — editable per group/sub-material.
// `materials` (user-defined sub-materials within a group, e.g. "316L Stainless"
// under M, each with its own optional `code`) start empty, added via UI later.
// Colors are the canonical per-group tokens used for preset color coding — there
// was no prior material→color map in the app, so these seed it.
export const DEFAULT_MATERIALS = {
  version: 1,
  groups: [
    { id: 'P', label: 'Steel',            code: 'STEEL', color: '#4A90D9', iso: true, order: 0 },
    { id: 'M', label: 'Stainless Steel',  code: 'SS',    color: '#F5C842', iso: true, order: 1 },
    { id: 'K', label: 'Cast Iron',        code: 'CI',    color: '#E05252', iso: true, order: 2 },
    { id: 'N', label: 'Non-Ferrous',      code: 'AL',    color: '#5BAD6F', iso: true, order: 3 },
    { id: 'S', label: 'High Temp Alloys', code: 'TI',    color: '#C4956A', iso: true, order: 4 },
    { id: 'H', label: 'Hardened Steel',   code: 'HARD',  color: '#888888', iso: true, order: 5 },
  ],
  materials: [], // { id, group_id, label, code, notes, order }
};

// shop_settings.json — shop-wide settings shared by all users via Drive.
// Foundation only: loaded/exposed/saved, but existing behavior (default unit,
// renumber start/skip, APS picker, import-folder memory) is NOT yet wired to it.
export const DEFAULT_SHOP_SETTINGS = {
  version: 1,
  shop_name: '',
  default_units: 'inches',
  machine_number: { start: 30, skip: [98, 99, 100] },
  import: { last_proshop_import: null, last_photo_import_folder_id: null },
  aps: { last_used_hub_id: null, last_used_project_id: null },
};
