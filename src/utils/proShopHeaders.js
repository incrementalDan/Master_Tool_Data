// ProShop CSV header normalization — accept BOTH header conventions.
//
// The app can produce/consume a ProShop CSV under two different header
// vocabularies, and they barely overlap:
//
//   • "proshop"  — a real ProShop UI export. Headers are the display names
//                  (e.g. "Tool #", "No.ofFlutes", "Length Below Holder - MIN OOH").
//                  This is what the importer was originally written to read.
//   • "tooldex"  — what THIS app exports (tool-extractor `PS_MAIN_COLS` /
//                  proShopExport.js). Headers are ProShop's API attribute ids
//                  (e.g. "toolNumber", "numberOfFlutes", "lengthBelowShankDiameter").
//                  ProShop's own importer matches on these, but our importer
//                  didn't — so re-importing our own export used to no-op.
//
// This module maps either vocabulary onto the single set of canonical keys the
// importer already reads (the display names), so both formats import identically
// and the format auto-detects. Unknown headers pass through unchanged (extra
// columns are harmless, exactly as before).

// canonical display header → every accepted alias (display name + API id + a few
// obvious spacing/case variants). The canonical is the exact key ImportFlow's
// matchProShopToTools / psRowToTool / buildPurchasingFromGroup read.
const HEADER_ALIASES = [
  ['Tool #', ['toolNumber']],
  ['Description', ['description']],
  ['Cut Dia', ['cutDiameter', 'Cut Diameter']],
  ['LOC', ['lengthOfCut', 'Length of Cut']],
  ['Overall Length', ['overallLength']],
  ['No.ofFlutes', ['numberOfFlutes', 'Number of Flutes']],
  ['Shank Diameter', ['shankDiameter']],
  ['CornerRad', ['cornerRadius', 'Corner Radius']],
  ['Tip Angle', ['tipAngle']],
  ['HelixAngle', ['helixAngle', 'Helix Angle']],
  ['Coating', ['coating']],
  ['Tool Material', ['toolMaterial']],
  ['Recommended Workpiece Material', ['recommendedWorkpieceMaterial']],
  ['Through Coolant', ['throughCoolant']],
  ['Custom Grind', ['customgrindtool', 'customGrind']],
  ['Tool Group', ['toolGroupLetter', 'Tool Group Letter']],
  ['Pitch', ['pitch']],
  ['Length Below Holder - MIN OOH', ['lengthBelowShankDiameter', 'Length Below Holder']],
  ['Tap class', ['tapClass']],
  ['Thread', ['thread']],
  ['Full Profile', ['fullProfile']],
  ['(S)tub / (J)obber', ['stubJobber', 'Stub Jobber']],
  ['Backside Capable', ['backsideCapable']],
  ['Double Ended', ['doubleEnded']],
  ['Taper', ['taper']],
  ['Tip Diameter', ['tipDiameter']],
  ['Tip to 1st Full Thread', ['tipTo1stFullThread', 'Tip to 1st Thread']],
  ['Location', ['location']],
  ['Point Type', ['pointType']],
  // Purchasing / Approved-Brand sub-table columns
  ['Approved Brand', ['approvedBrand']],
  ['Vendor', ['vendor']],
  ['EDP#', ['vendorToolId', 'EDP', 'edp']],
  ['Cost', ['cost']],
  ['Lead time', ['leadTime', 'Lead Time']],
];

// Normalize a header for matching: case- and punctuation/space-insensitive.
const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

// normalized token → canonical display header
const LOOKUP = new Map();
for (const [canonical, aliases] of HEADER_ALIASES) {
  LOOKUP.set(norm(canonical), canonical);
  for (const a of aliases) LOOKUP.set(norm(a), canonical);
}

// Map one raw CSV header to the canonical display-name key the importer reads.
// Unknown headers are returned trimmed but otherwise unchanged.
export function canonicalProShopHeader(h) {
  return LOOKUP.get(norm(h)) || String(h == null ? '' : h).trim();
}

// Turn parsed CSV rows (string[][], first row = header) into row objects keyed by
// canonical headers — the single seam both the bulk and single-tool importers use.
export function proShopRowsToObjects(rows) {
  if (!rows || rows.length < 1) return [];
  const header = rows[0].map(canonicalProShopHeader);
  return rows.slice(1).map((row) => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = (row[i] || '').trim(); });
    return obj;
  });
}

// Distinctive tokens unique to each vocabulary — used only for the friendly
// "detected format" note (matching itself never needs this; the alias map
// handles both regardless).
const TOOLDEX_TOKENS = ['toolnumber', 'numberofflutes', 'lengthbelowshankdiameter', 'cutdiameter', 'tipto1stfullthread'];
const PROSHOP_TOKENS = ['tool', 'noofflutes', 'lengthbelowholderminooh', 'cutdia'];

// 'tooldex' (this app's export) | 'proshop' (real ProShop export) | 'unknown'.
export function detectProShopFormat(headerRow) {
  if (!headerRow || !headerRow.length) return 'unknown';
  const set = new Set(headerRow.map(norm));
  if (TOOLDEX_TOKENS.some((t) => set.has(t))) return 'tooldex';
  if (PROSHOP_TOKENS.some((t) => set.has(t))) return 'proshop';
  return 'unknown';
}

// Human-readable label for a detected format.
export function proShopFormatLabel(format) {
  if (format === 'tooldex') return 'ToolDex export format';
  if (format === 'proshop') return 'ProShop export format';
  return 'Unrecognized format';
}
