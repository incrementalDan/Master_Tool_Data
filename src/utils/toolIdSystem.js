// Tool ID system — generates a tool's human-readable ID from the shop-wide
// scheme configured in shop_settings.tool_id_system. The generated value is
// stored in ONE place: Fusion's native `product-id` field (our internal
// `tool_id`). The active mode only controls how that value is produced, how
// it's labelled in the UI, and whether the ProShop URL link is shown.
//
// Modes:
//   location      — the composed physical-location string from the Location
//                   System (tool.location, pre-resolved by AppContext) e.g. "LC-1405"
//   sequential    — {number}                        e.g. "1042"
//   type_prefix   — {typecode}{sep}{number}         e.g. "EM-1042"
//   size_first    — {dia}{sep}{typecode}{sep}{number} e.g. "0500-EM-1042"
//   machine_linked— "T{machine_tool_number}"        e.g. "T42"
//   proshop       — value comes from ProShop (unchanged); generator passes
//                   through the existing tool_id
//   other_erp     — placeholder for a future ERP; not selectable yet

// Short code per tool_type, used in type_prefix / size_first IDs. Kept here
// (not in fieldRegistry) because it's specific to ID composition.
export const TYPE_CODES = {
  'flat end mill': 'EM',
  'ball end mill': 'BEM',
  'bull nose end mill': 'BR',
  'radius mill': 'RM',
  'tapered mill': 'TPM',
  'chamfer mill': 'CHM',
  'lollipop mill': 'LOL',
  'dovetail': 'DVT',
  'slot/key cutter': 'SLT',
  'form mill': 'FRM',
  'thread mill': 'THM',
  'circle segment barrel': 'CSB',
  'circle segment lens': 'CSL',
  'circle segment oval': 'CSO',
  'circle segment taper': 'CST',
  'drill': 'DR',
  'center drill': 'CDR',
  'spot drill': 'SDR',
  'reamer': 'RMR',
  'counter bore': 'CB',
  'counter sink': 'CSK',
  'tap': 'TAP',
  'boring head': 'BH',
  'turning general': 'TRN',
  'face mill': 'FM',
};

export function typeCode(toolType) {
  return TYPE_CODES[toolType] || 'TL';
}

// The sequence number inside a shop Tool ID, for "newest first" ordering.
//
// The PREFIX is the tool-group letter (A = end mills, D = drills, R = taps …)
// but the NUMBER is a single shop-wide counter, so a higher number means a more
// recently added tool regardless of group — verified against the real library,
// where the newest tools run A-265, R-266, L-267, J-268, D-269, A-270.
//
// Takes the FIRST digit run, which is what makes the messy real cases land
// right: a combined insert-tool id ("I-167/ G-168") resolves to its holder
// component, and a parenthetical suffix ("R-70 (CG)", "TC52 (142174)") is
// ignored rather than swallowing the vendor number. Returns -1 when there is no
// number at all, so unnumbered tools sort last instead of jumping to the top.
export function toolIdSequence(toolId) {
  const m = String(toolId ?? '').match(/\d+/);
  return m ? Number(m[0]) : -1;
}

// Zero-pad a number to `digits` wide. Non-numeric input passes through as-is.
export function padNumber(n, digits = 4) {
  const num = parseInt(n, 10);
  if (isNaN(num)) return String(n ?? '');
  return String(num).padStart(digits, '0');
}

// Diameter → a 4-digit token: dia × 1000, rounded, zero-padded.
//   0.375 → "0375", 0.5 → "0500", 0.125 → "0125"
// (Assumes inch tools — the shop default. mm tools produce a larger number;
// the prefix still disambiguates by type so collisions are unlikely.)
export function padDiameter(dia) {
  const n = parseFloat(dia);
  if (isNaN(n)) return '0000';
  return String(Math.round(n * 1000)).padStart(4, '0');
}

// The label shown next to the ID field/badge for a given mode.
export function toolIdLabel(mode) {
  return mode === 'proshop' ? 'ProShop ID' : 'Tool ID';
}

// Whether the ProShop tool-page URL link should be shown/active for this mode.
export function showsProShopUrl(mode) {
  return mode === 'proshop';
}

// Compose a single tool's ID string. `seqNumber` is the pre-computed sequential
// number for counter-based modes (location/sequential/type_prefix/size_first).
// Returns '' when the mode can't produce a value for this tool (e.g.
// machine_linked with no machine number).
export function composeToolId(config, tool, seqNumber) {
  const { mode = 'proshop', separator = '-', digits = 4 } = config || {};
  const sep = separator;
  const join = (parts) => parts.filter(p => p !== '' && p != null).join(sep);

  switch (mode) {
    case 'location':
      // The ID *is* the composed physical-location string from the Location
      // System. AppContext resolves tool.location from the structured
      // tool_location + location_config before this runs. Empty → no ID yet.
      return (tool.location || '').trim();
    case 'sequential':
      return padNumber(seqNumber, digits);
    case 'type_prefix':
      return join([typeCode(tool.tool_type), padNumber(seqNumber, digits)]);
    case 'size_first':
      return join([padDiameter(tool.diameter), typeCode(tool.tool_type), padNumber(seqNumber, digits)]);
    case 'machine_linked': {
      const m = tool.machine_tool_number;
      return (m === null || m === undefined || m === '') ? '' : `T${m}`;
    }
    case 'proshop':
    case 'other_erp':
    default:
      return tool.tool_id || '';
  }
}

// Next sequential number ≥ start that is neither in `skip` nor already `used`.
// Mirrors getNextMachineNumber's skip/used logic (toolSchema.js).
export function nextSequential(start, skip = [], used = new Set()) {
  const skipSet = new Set((skip || []).map(Number));
  let n = Number(start) || 1;
  while (skipSet.has(n) || used.has(n)) n++;
  return n;
}

// Modes whose IDs are produced from a running counter (need start/skip/digits).
// `location` is NOT a counter mode — its number is the bin, owned by the
// Location System, not a Tool-ID-system sequential counter.
export function isCounterMode(mode) {
  return mode === 'sequential'
    || mode === 'type_prefix' || mode === 'size_first';
}

// A live preview string for the Settings editor, using sample values.
export function previewToolId(config) {
  const sample = {
    tool_type: 'flat end mill',
    diameter: 0.5,
    location: 'LC-1405',
    machine_tool_number: 42,
    tool_id: 'A-3',
  };
  return composeToolId(config, sample, Number(config?.start) || 1000);
}
