// Fusion "Stock Material" JSON export.
//
// Fusion 360's stock-material library wants ONE JSON file per material, shaped
// like the reference exports in `Material REF Docs/`. Fusion doesn't support the
// shop's CAM-preset grouping yet, so we generate one of these files per CAM
// preset (`materials.json` presets[]) and the user imports them into Fusion.
//
//   • filename / description → the CAM preset name (Fusion's "Name" field)
//   • category               → Fusion's "Type" (Metal / Plastic / …) — Metal default
//   • uuid                   → left blank; Fusion assigns one on import
//   • designators            → Fusion's "Keywords" search list (see buildDesignators)
//   • physicalMaterials      → Fusion-internal render materials — always blank here
//
// Framework-free (the DOM download helpers at the bottom mirror fusionExport.js).

// Dedupe a list of strings, drop blanks, keep first-seen casing/order.
function uniqNonEmpty(arr) {
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    const s = (v == null ? '' : String(v)).trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Remove any alloy name/alias already listed as its own designator from the
// prose description, so alloys aren't repeated ("the description minus the
// alloys listed again"). Leftover connective punctuation/words are trimmed.
function descriptionWithoutAlloys(description, alloyTokens) {
  let desc = description || '';
  if (!desc) return '';
  for (const tok of alloyTokens) {
    if (!tok) continue;
    desc = desc.replace(new RegExp(`\\b${escapeRegExp(tok)}\\b`, 'gi'), ' ');
  }
  // Collapse the debris left behind (stray "and", dangling dashes, double spaces).
  desc = desc
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*[—–-]\s*(?=$|[—–-])/g, ' ')
    .replace(/\b(and|through|to)\b\s*(?=$)/gi, ' ')
    .replace(/^[\s,;—–-]+|[\s,;—–-]+$/g, '')
    .trim();
  return desc;
}

// Build the Fusion "Keywords" list for a CAM preset: every alloy label + alias,
// the three standard codes (ISO 513 / Kennametal / VDI 3323) + the group/preset
// short codes, the ISO group name + id, and the leftover app description.
export function buildDesignators(preset, materials = [], groups = []) {
  const alloys = materials.filter((m) => m.preset_id === preset.id);
  const group = groups.find((g) => g.id === preset.group_id);

  const alloyTokens = alloys.flatMap((a) => [a.label, ...(a.aliases || [])]);
  const codes = [preset.iso_513, preset.kennametal, preset.vdi_3323, preset.code, group?.code];
  const groupTokens = [group?.label, group?.id];
  const leftoverDesc = descriptionWithoutAlloys(preset.description, alloyTokens);

  return uniqNonEmpty([...alloyTokens, ...codes, ...groupTokens, leftoverDesc]);
}

// Build the full Fusion stock-material object for one CAM preset.
export function buildFusionStockMaterial(preset, materials = [], groups = [], { category = 'Metal' } = {}) {
  return {
    description: preset.name || '',
    category,
    uuid: '',
    designators: buildDesignators(preset, materials, groups),
    physicalMaterials: [],
    version: 1,
  };
}

// Safe-for-disk filename from the preset name (Fusion tolerates spaces — the
// reference files are literally "AL 6061.json").
export function stockMaterialFilename(preset) {
  const base = (preset.name || 'material').replace(/[\\/:*?"<>|]/g, '-').trim() || 'material';
  return `${base}.json`;
}

// ── DOM download helpers ─────────────────────────────────────────────────────

function downloadJSON(content, filename) {
  const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Download a single CAM preset's Fusion stock-material file.
export function exportStockMaterial(preset, materials, groups, opts) {
  downloadJSON(buildFusionStockMaterial(preset, materials, groups, opts), stockMaterialFilename(preset));
}

// Download one file per preset. Browsers process a burst of downloads better
// with a small gap between each (and may ask once to "allow multiple files").
export async function exportStockMaterials(presets, materials, groups, opts) {
  for (const preset of presets) {
    exportStockMaterial(preset, materials, groups, opts);
    await new Promise((r) => setTimeout(r, 150));
  }
  return presets.length;
}
