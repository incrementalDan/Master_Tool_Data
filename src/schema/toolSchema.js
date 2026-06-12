import {
  TT, TL, BLANK, FIELD_VISIBILITY, _FV_KEYS,
  MA, CO, WM, MANUFACTURER_LIST, VENDOR_LIST,
  PS_GROUPS, AUTO_GROUP, typeFromProShopGroup, COOLANT_OPTS, THROUGH_COOLANT_VALUES,
  getVisibleFields,
} from '../../tool-extractor.tsx';
import { isMetadataOnly, FIELD_REGISTRY, fieldLabel } from './fieldRegistry.js';
import { parsePresetName, materialCategory, HOLE_MAKING_TYPES, TURNING_TYPES } from '../utils/presetNaming.js';
import { convertLength, unitAbbr, getDefaultUnit } from '../utils/units.js';

export { TT, TL, MA, CO, WM, MANUFACTURER_LIST, VENDOR_LIST, PS_GROUPS, AUTO_GROUP, typeFromProShopGroup, COOLANT_OPTS };

// ─── Icons ─────────────────────────────────────────────────────────────────
// Tool-type icons are rendered by the <ToolTypeIcon> component
// (src/components/icons/ToolTypeIcon.jsx) as hand-crafted SVG silhouettes.

export const TOOL_TYPES = TT;
export const TOOL_TYPE_LABELS = TL;

// ─── Facet fields per tool type (search filter order) ─────────────────────
const COMMON_FACETS = ['diameter', 'number_of_flutes', 'flute_length', 'overall_length', 'material', 'coating', 'vendor', 'tsc_capable', 'flute_design', 'material_suitability', 'tags', 'no_fusion_link'];

export function getFacetFields(toolType) {
  if (!toolType) return COMMON_FACETS;
  const extras = [];
  if (toolType === 'bull nose end mill' || toolType === 'radius mill' || toolType === 'lollipop mill') {
    extras.push('corner_radius');
  }
  if (toolType === 'tap') {
    extras.push('tap_sub_type', 'is_sti', 'pitch', 'tap_thread_unit', 'cutting_direction', 'tap_class', 'class_of_fit');
  } else if (toolType === 'thread mill') {
    extras.push('pitch', 'tap_thread_unit', 'cutting_direction');
  }
  if (toolType === 'drill' || toolType === 'spot drill' || toolType === 'center drill') {
    extras.push('tip_angle');
  }
  return [...COMMON_FACETS, ...extras];
}

// ─── Required fields derived from FIELD_VISIBILITY ─────────────────────────
export function getRequiredFields(toolType) {
  const idx = _FV_KEYS.indexOf(toolType);
  if (idx < 0) return ['tool_type', 'description', 'diameter'];
  return Object.entries(FIELD_VISIBILITY)
    .filter(([, v]) => v[idx] === 1)
    .map(([key]) => extractorKeyToAppKey(key))
    .filter(Boolean);
}

// ─── Key mapping: extractor → our model ────────────────────────────────────
function extractorKeyToAppKey(k) {
  const map = {
    toolType: 'tool_type',
    loc: 'flute_length',
    oal: 'overall_length',
    flutes: 'number_of_flutes',
    shankDia: 'shank_diameter',
    cornerRadius: 'corner_radius',
    approvedBrand: 'vendor',
    productLink: 'product_link',
    presetName: 'preset_name',
    toolNumber: 'machine_tool_number',
    helixAngle: 'helix_angle',
    centerCutting: 'center_cutting',
    fluteType: 'flute_type',
    cuttingDirection: 'cutting_direction',
    tapClass: 'tap_class',
    tapSubType: 'tap_sub_type',
    isSTI: 'is_sti',
    threadUnit: 'tap_thread_unit',
    pointType: 'point_type',
    tpiMin: 'tpi_min',
    tpiMax: 'tpi_max',
    threadProfileAngle: 'thread_profile_angle',
    stubJobber: 'stub_jobber',
    doubleEnded: 'double_ended',
    fullProfile: 'full_profile',
    backsideCapable: 'backside_capable',
    tipAngle: 'tip_angle',
    tipDiameter: 'tip_diameter',
    taperAngle: 'taper_angle',
    lowerRadius: 'lower_radius',
    upperRadius: 'upper_radius',
    profileRadius: 'profile_radius',
    axialDistance: 'axial_distance',
    minThreadPitch: 'min_thread_pitch',
    maxThreadPitch: 'max_thread_pitch',
    psToolId: 'proshot_id',
    workpieceMats: 'material_suitability',
    shoulderLen: 'shoulder_length',
    ooh: 'ooh',
    minOoh: 'min_ooh',
  };
  return map[k] || k;
}

// ─── Build normalized purchasing from the extractor's flat fields ──────────
// The extractor form (AI extraction / AddToolFlow) captures one manufacturer
// (approvedBrand + edpNumber, the manufacturer's own part #) and one vendor
// (vendor + vendorStockNum + cost). The Purchasing section supports adding
// more of each — see `purchasing` in the field registry.
function buildPurchasingFromExtractor(f) {
  const hasMfg = f.approvedBrand || f.edpNumber;
  const hasVendor = f.vendor || f.vendorStockNum || f.cost;
  if (!hasMfg && !hasVendor) return { manufacturers: [], vendors: [] };

  const manufacturers = [];
  let mfgId = null;
  if (hasMfg || hasVendor) {
    mfgId = generateId();
    manufacturers.push({
      id: mfgId,
      name: f.approvedBrand || '',
      edp: f.edpNumber || '',
      edp_url: '',
      mfg_num: '',
      mfg_num_url: '',
      order: 0,
    });
  }

  const vendors = [];
  if (hasVendor) {
    vendors.push({
      id: generateId(),
      manufacturer_id: mfgId,
      name: f.vendor || '',
      vendor_num: f.vendorStockNum || '',
      vendor_num_url: '',
      price: f.cost ? (parseFloat(f.cost) || null) : null,
      order: 0,
    });
  }

  return { manufacturers, vendors };
}

// ─── Convert extractor BLANK format → our internal model ───────────────────
export function extractorToTool(f) {
  return {
    tool_type: f.toolType || 'flat end mill',
    unit: f.unit || getDefaultUnit(),
    description: '',
    diameter: parseFloat(f.diameter) || null,
    flute_length: parseFloat(f.loc) || null,
    overall_length: parseFloat(f.oal) || null,
    number_of_flutes: parseInt(f.flutes) || null,
    shank_diameter: parseFloat(f.shankDia) || null,
    corner_radius: parseFloat(f.cornerRadius) || null,
    tip_angle: parseFloat(f.tipAngle) || null,
    taper_angle: parseFloat(f.taperAngle) || null,
    tip_diameter: parseFloat(f.tipDiameter) || null,
    lower_radius: parseFloat(f.lowerRadius) || null,
    upper_radius: parseFloat(f.upperRadius) || null,
    profile_radius: parseFloat(f.profileRadius) || null,
    axial_distance: parseFloat(f.axialDistance) || null,
    shoulder_length: parseFloat(f.shoulderLen) || null,
    ooh: parseFloat(f.ooh) || null,
    min_ooh: parseFloat(f.minOoh) || null,
    material: f.material || 'carbide',
    coating: f.coating || '',
    material_suitability: f.workpieceMats || [],
    helix_angle: parseFloat(f.helixAngle) || null,
    center_cutting: f.centerCutting || false,
    flute_type: f.fluteType || '',
    flute_design: '',
    tsc_capable: THROUGH_COOLANT_VALUES.has(f.coolant || '') || false,
    cutting_direction: f.cuttingDirection || 'Right Hand',
    pitch: f.pitch || '',
    tap_class: f.tapClass || '',
    tap_sub_type: f.tapSubType || 'cut',
    is_sti: f.isSTI || false,
    tap_thread_unit: f.threadUnit || '',
    min_thread_pitch: parseFloat(f.minThreadPitch) || null,
    max_thread_pitch: parseFloat(f.maxThreadPitch) || null,
    tpi_min: parseInt(f.tpiMin) || null,
    tpi_max: parseInt(f.tpiMax) || null,
    thread_profile_angle: parseFloat(f.threadProfileAngle) || null,
    point_type: f.pointType || '',
    stub_jobber: f.stubJobber || '',
    double_ended: f.doubleEnded || false,
    full_profile: f.fullProfile || false,
    backside_capable: f.backsideCapable || false,
    vendor: f.approvedBrand || '',
    // One manufacturer + one vendor from the extractor's flat purchasing fields,
    // if any were filled in. The Purchasing section supports adding more of each
    // — see `purchasing` in the field registry.
    purchasing: buildPurchasingFromExtractor(f),
    product_link: f.productLink || '',
    preset_name: f.presetName || '',
    machine_tool_number: (f.toolNumber === '' || f.toolNumber == null) ? null : Number(f.toolNumber),
    grouping: f.grouping || '',
    proshot_id: f.psToolId || '',
    location: f.location || '',
  };
}

// ─── Convert our internal model → extractor BLANK format ───────────────────
export function toolToExtractor(tool) {
  return {
    toolType: tool.tool_type || 'flat end mill',
    diameter: String(tool.diameter ?? ''),
    loc: String(tool.flute_length ?? ''),
    oal: String(tool.overall_length ?? ''),
    flutes: String(tool.number_of_flutes ?? ''),
    shankDia: String(tool.shank_diameter ?? tool.diameter ?? ''),
    cornerRadius: String(tool.corner_radius ?? '0'),
    material: tool.material || 'carbide',
    coating: tool.coating || '',
    workpieceMats: tool.material_suitability || [],
    tipAngle: String(tool.tip_angle ?? ''),
    pitch: tool.pitch || '',
    edpNumber: tool.purchasing?.manufacturers?.[0]?.edp || '',
    productLink: tool.product_link || '',
    presetName: tool.preset_name || '',
    toolNumber: tool.machine_tool_number != null ? String(tool.machine_tool_number) : '',
    coolant: tool.tsc_capable ? 'flood tool' : 'flood',
    helixAngle: String(tool.helix_angle ?? ''),
    centerCutting: tool.center_cutting || false,
    fluteType: tool.flute_type || '',
    grouping: tool.grouping || AUTO_GROUP[tool.tool_type] || 'M',
    approvedBrand: tool.vendor || '',
    vendor: tool.purchasing?.vendors?.[0]?.name || '',
    cost: tool.purchasing?.vendors?.[0]?.price != null ? String(tool.purchasing.vendors[0].price) : '',
    vendorStockNum: tool.purchasing?.vendors?.[0]?.vendor_num || '',
    purchasing: tool.purchasing || { manufacturers: [], vendors: [] },
    tapClass: tool.tap_class || '',
    tapSubType: tool.tap_sub_type || '',
    isSTI: tool.is_sti || false,
    threadUnit: tool.tap_thread_unit || '',
    pointType: tool.point_type || '',
    tipToFirstFullThread: String(tool.tip_to_first_thread ?? ''),
    shoulderLen: String(tool.shoulder_length ?? ''),
    ooh: String(tool.ooh ?? ''),
    minOoh: String(tool.min_ooh ?? ''),
    taperAngle: String(tool.taper_angle ?? ''),
    minThreadPitch: String(tool.min_thread_pitch ?? ''),
    maxThreadPitch: String(tool.max_thread_pitch ?? ''),
    tpiMin: String(tool.tpi_min ?? ''),
    tpiMax: String(tool.tpi_max ?? ''),
    threadProfileAngle: String(tool.thread_profile_angle ?? ''),
    fullProfile: tool.full_profile || false,
    stubJobber: tool.stub_jobber || '',
    backsideCapable: tool.backside_capable || false,
    doubleEnded: tool.double_ended || false,
    cuttingDirection: tool.cutting_direction || 'Right Hand',
    tipDiameter: String(tool.tip_diameter ?? ''),
    lowerRadius: String(tool.lower_radius ?? ''),
    upperRadius: String(tool.upper_radius ?? ''),
    profileRadius: String(tool.profile_radius ?? ''),
    axialDistance: String(tool.axial_distance ?? ''),
    psToolId: tool.proshot_id || '',
    location: tool.location || '',
  };
}

// ─── ID generation ─────────────────────────────────────────────────────────
export function generateId() {
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-${(Math.floor(Math.random() * 4) + 8).toString(16)}${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

export const generateAssemblyId = generateId;

// ─── Tracking ID (logical-tool family key) ─────────────────────────────────
// One logical tool maps to N Fusion library instances (one per assembly). All
// instances of a logical tool carry the same tracking ID, written into Fusion's
// native `tool_comment` field so the grouping survives without this app or the
// metadata file. Format: "FTL-" + 6 uppercase hex.
const TRACKING_ID_RE = /^FTL-[0-9A-F]{4,}$/i;

export function generateTrackingId() {
  const hex = Math.floor(Math.random() * 0x1000000).toString(16).toUpperCase().padStart(6, '0');
  return `FTL-${hex}`;
}

// Read a tracking ID from a raw Fusion tool. Only accepts the FTL- pattern so a
// stray legacy value (e.g. an old ProShop RTA#) in tool_comment is ignored.
export function readTrackingId(fTool) {
  // Fusion stores the comment in post-process.comment (plain) and mirrors it in
  // expressions.tool_comment (quoted). Check both.
  const raw = stripQuotes(
    fTool?.['post-process']?.comment ||
    fTool?.expressions?.tool_comment ||
    fTool?.tool_comment ||
    ''
  );
  return TRACKING_ID_RE.test(raw) ? raw.toUpperCase() : null;
}

// Read the OOH (stick-out) from a raw Fusion tool. Source of truth is
// geometry.LB (Body Length / "Length below Holder"), stored in the tool's own
// unit — returned raw in that unit (like all other geometry).
export function readOohFromFusion(fTool) {
  const lb = fTool?.geometry?.LB;
  if (lb === null || lb === undefined || lb === '') return null;
  const v = Number(lb);
  if (isNaN(v)) return null;
  return v;
}

function round4(n) {
  const v = Number(n);
  return isNaN(v) ? 0 : Math.round(v * 10000) / 10000;
}

// Family signature for validating a tracking-ID group and for matching incoming
// job tools: ProShop ID + tool type + cut diameter (4-decimal tolerance).
export function familySignature(tool) {
  const pid = String(tool.proshot_id || tool['product-id'] || '').trim();
  const type = tool.tool_type || tool.type || '';
  const dia = round4(tool.diameter ?? tool.geometry?.DC);
  return `${pid}|${type}|${dia}`;
}

// Group a raw Fusion library array into logical-tool groups keyed by tracking
// ID. Entries without a valid tracking ID are returned separately (each is its
// own single-instance logical tool until normalized).
export function groupByTrackingId(fusionList) {
  const groups = new Map(); // tracking_id -> [rawInstance, ...]
  const untracked = [];     // raw instances with no tracking ID
  for (const f of (fusionList || [])) {
    const tid = readTrackingId(f);
    if (tid) {
      if (!groups.has(tid)) groups.set(tid, []);
      groups.get(tid).push(f);
    } else {
      untracked.push(f);
    }
  }
  return { groups, untracked };
}

// ─── Combine logical tools that share a ProShop number ─────────────────────
// The ProShop number (Fusion's `product-id`, our `proshot_id`) is the
// authoritative identity of a physical tool. Two library entries carrying the
// same ProShop number are the same tool — different holder/OOH setups at most —
// so they are folded into ONE logical tool regardless of any other field
// (type, diameter, description, …). Instances (assemblies), raw Fusion entries,
// presets and merge history are unioned; identical assemblies (same holder +
// OOH) collapse to one. Tools with no ProShop number are left untouched.
//
// Used everywhere new entries appear (load, normalize, import, add) so
// duplicates never split into separate logical tools.
function mergeLogicalTools(group) {
  // Prefer an already-tracked tool as the primary so its tracking ID (and the
  // metadata keyed to it) survives the combine.
  const primary = group.find(t => t.tracking_id) || group[0];
  const ordered = [primary, ...group.filter(t => t !== primary)];

  const assemblies = [];
  const seenAsmSig = new Set();   // collapse identical instances (holder + OOH)
  const raws = [];
  const seenRawGuid = new Set();
  const presets = [];
  const seenPresetName = new Set();
  const mergeHistory = [];
  const registered = [];
  const seenRegGuid = new Set();
  let machine = null;

  for (const t of ordered) {
    for (const ra of (t._registeredAssemblies || [])) {
      if (ra?.instance_guid && seenRegGuid.has(ra.instance_guid)) continue;
      if (ra?.instance_guid) seenRegGuid.add(ra.instance_guid);
      registered.push(ra);
    }
    for (const a of (t.assemblies || [])) {
      const sig = `${a.holder_guid || ''}|${round4(Number(a.ooh) || 0)}`;
      if (seenAsmSig.has(sig)) continue;
      seenAsmSig.add(sig);
      assemblies.push(a);
    }
    for (const r of (t._instancesRaw || [])) {
      if (!r?.guid || seenRawGuid.has(r.guid)) continue;
      seenRawGuid.add(r.guid);
      raws.push(r);
    }
    for (const p of (t.presets || [])) {
      const key = String(p.name || '').trim().toLowerCase();
      if (key && seenPresetName.has(key)) continue;
      if (key) seenPresetName.add(key);
      presets.push(p);
    }
    if (machine == null && t.machine_tool_number != null) machine = t.machine_tool_number;
    if (Array.isArray(t.merge_history)) mergeHistory.push(...t.merge_history);
  }

  return {
    ...primary,
    machine_tool_number: machine,
    assemblies,
    presets,
    merge_history: mergeHistory,
    _instancesRaw: raws,
    _fusionRaw: primary._fusionRaw || raws[0] || null,
    _registeredAssemblies: registered,
  };
}

export function combineToolsByProshopId(tools) {
  const groups = new Map();   // key -> [tool, ...]
  const order = [];           // preserve first-seen order
  let anon = 0;
  for (const tool of (tools || [])) {
    const pid = String(tool.proshot_id || '').trim();
    const key = pid ? `pid:${pid}` : `anon:${anon++}`;
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key).push(tool);
  }
  return order.map(key => {
    const group = groups.get(key);
    return group.length === 1 ? group[0] : mergeLogicalTools(group);
  });
}

// ─── Holder gauge length (expression-derived) ──────────────────────────────
// Fusion numbers holder segments top→bottom starting at 1, but the JSON
// `segments` array stores them in the OPPOSITE order (bottom/collet face first,
// spindle end last): fusionSegmentNumber = S - jsonArrayIndex. The
// `expressions.tool_holderGaugeLength` string sums the segment heights that are
// BELOW the gauge line — segments absent from it are "above the gauge line"
// (inside the spindle) and excluded. See FUSION_SCHEMA.md §1b.

// Sum the heights of the included (below-gauge-line) segments, in the holder's
// OWN unit. Returns null when there is no usable expression so callers can fall
// back to the stored gaugeLength.
function sumGaugeSegments(holder) {
  const segs = holder?.segments;
  if (!Array.isArray(segs) || segs.length === 0) return null;
  const expr = String(holder?.expressions?.tool_holderGaugeLength ?? '');
  const included = [...expr.matchAll(/segment_(\d+)_height/g)].map(m => parseInt(m[1], 10));
  if (included.length === 0) return null;
  const S = segs.length;
  let total = 0;
  for (const fusionNum of included) {
    const jsonIdx = S - fusionNum;   // Fusion UI number → JSON array index
    if (jsonIdx >= 0 && jsonIdx < S) total += Number(segs[jsonIdx]?.height) || 0;
  }
  return total;
}

// Holder gauge length in INCHES, derived from the expression + segments
// (converts from the holder's unit when metric). Falls back to the stored
// gaugeLength when there is no parseable expression.
export function computeGaugeLength(holder) {
  const native = sumGaugeSegments(holder);
  const value = (native != null && native > 0) ? native : Number(holder?.gaugeLength);
  if (value == null || isNaN(value)) return null;
  return holder?.unit === 'millimeters' ? value / 25.4 : value;
}

// Build a holder's tool_holderGaugeLength expression. `aboveGaugeLineCount` is
// the number of spindle-side segments excluded from the gauge length — almost
// always 1; never hardcode a different value without evidence (parse the
// existing expression when correcting one).
export function buildGaugeLengthExpression(totalSegments, aboveGaugeLineCount = 1) {
  const firstIncluded = aboveGaugeLineCount + 1;
  const terms = [];
  for (let n = firstIncluded; n <= totalSegments; n++) terms.push(`segment_${n}_height`);
  return terms.join(' + ');
}

// Build a Fusion holder object from a holder-library entry.
export function buildHolderObject(holderEntry) {
  if (!holderEntry) return null;
  let gaugeLength = holderEntry.gaugeLength;

  // Prefer the gauge length derived from the holder's own
  // tool_holderGaugeLength expression (sum of the below-gauge-line segment
  // heights, in the holder's native unit). This excludes any "above the gauge
  // line" segment and corrects stale/wrong stored values left by older bad
  // writes. Falls back to the stored value when there is no usable expression.
  const nativeSum = sumGaugeSegments(holderEntry);
  if (nativeSum != null && nativeSum > 0) gaugeLength = nativeSum;

  // A holder's gauge length can never physically exceed the total height of its
  // sections. Some holder-library entries store a gauge length rounded a hair
  // larger than the true section sum (e.g. 4.60626 vs 4.606259842519727), which
  // makes Fusion flag "Gauge length exceeds the total height of sections" once
  // the assembly is recomputed. Clamp to the exact section total — this fixes
  // the rounding artifact without touching gauge lengths that are legitimately
  // shorter than the holder (the common case), since min() keeps the smaller.
  if (Array.isArray(holderEntry.segments) && holderEntry.segments.length > 0 && typeof gaugeLength === 'number') {
    const totalHeight = holderEntry.segments.reduce((sum, seg) => sum + (Number(seg?.height) || 0), 0);
    if (totalHeight > 0 && gaugeLength > totalHeight) gaugeLength = totalHeight;
  }

  // Spread the full Fusion-native holder object so no required fields are
  // dropped (e.g. BMC, expressions, or any future Fusion additions), then
  // override only the fields we need to adjust.
  return {
    ...holderEntry,
    gaugeLength,  // clamped value from above; overrides original if it changed
    type: 'holder',  // discriminator — Fusion uses this to recognize the object
  };
}

// ─── Machine tool numbers ─────────────────────────────────────────────────
// The machine tool number is what the CNC machine reads to call a tool
// (`post-process.number` in the Fusion JSON). It is completely separate from
// the internal `id` and the ProShop `product-id`. Numbers start at 30 and skip
// the reserved set below, which is held back for machine-specific use.
export const RESERVED_MACHINE_NUMBERS = [98, 99, 100];
const RESERVED_SET = new Set(RESERVED_MACHINE_NUMBERS);

// Generate a full sequence of machine tool numbers for a renumber/import.
// Starts at 30, increments by 1, skips the reserved numbers entirely.
// e.g. 250 tools → [30, 31, ..., 97, 101, 102, ...]
export function generateMachineNumbers(toolCount) {
  const numbers = [];
  let next = 30;
  while (numbers.length < toolCount) {
    if (!RESERVED_SET.has(next)) numbers.push(next);
    next++;
  }
  return numbers;
}

// Find the next available machine tool number given the numbers already in use.
// Skips both used numbers and the reserved set.
export function getNextMachineNumber(existingNumbers) {
  const used = new Set((existingNumbers || []).map(Number).filter(n => !isNaN(n)));
  let next = 30;
  while (used.has(next) || RESERVED_SET.has(next)) next++;
  return next;
}

// Write a machine tool number into a raw Fusion tool object. Always writes all
// three post-process fields (number / length-offset / diameter-offset) to the
// same value, and always writes the linked expression so Fusion's UI keeps the
// length offset tied to the tool number. Mutates and returns the object.
export function applyMachineNumberToFusion(fTool, number) {
  const n = parseInt(number);
  if (isNaN(n)) return fTool;
  fTool['post-process'] = {
    ...(fTool['post-process'] || {}),
    number: n,
    'length-offset': n,
    'diameter-offset': n,
  };
  fTool.expressions = {
    ...(fTool.expressions || {}),
    tool_number: String(n),
    tool_lengthOffset: 'tool_number',
  };
  return fTool;
}

// ─── Fusion JSON ↔ internal model ─────────────────────────────────────────
const FUSION_TYPE_MAP = {
  'flat end mill': 'flat end mill',
  'ball end mill': 'ball end mill',
  'bull nose end mill': 'bull nose end mill',
  'tapered mill': 'tapered mill',
  'radius mill': 'radius mill',
  'form mill': 'form mill',
  'lollipop mill': 'lollipop mill',
  'slot mill': 'slot/key cutter',
  'dovetail mill': 'dovetail',
  'thread mill': 'thread mill',
  'face mill': 'face mill',
  'chamfer mill': 'chamfer mill',
  'circle segment barrel': 'circle segment barrel',
  'circle segment lens': 'circle segment lens',
  'circle segment oval': 'circle segment oval',
  'circle segment taper': 'circle segment taper',
  'drill': 'drill',
  'center drill': 'center drill',
  'spot drill': 'spot drill',
  'reamer': 'reamer',
  'counter bore': 'counter bore',
  'counter sink': 'counter sink',
  // Both tap hands are confirmed Fusion type strings (Special Cases library verified
  // 'tap left hand'). Both map to the unified internal 'tap' type; cutting_direction
  // is set from the Fusion type string on read (not from geometry.HAND for taps).
  'tap right hand': 'tap',
  'tap left hand': 'tap',
  'boring bar': 'boring head',
  'turning general': 'turning general',
};

function stripQuotes(s) {
  if (!s) return '';
  return s.replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
}

export function fusionToolToInternal(fTool) {
  const geo = fTool.geometry || {};
  const expr = fTool.expressions || {};
  const preset = fTool['start-values']?.presets?.[0] || {};
  const rawType = fTool.type || 'flat end mill';
  const toolType = FUSION_TYPE_MAP[rawType] || rawType;

  return {
    id: fTool.guid,
    tracking_id: readTrackingId(fTool),
    tool_type: toolType,
    unit: fTool.unit || 'inches',
    description: fTool.description || '',
    diameter: geo.DC || null,
    flute_length: geo.LCF || null,
    overall_length: geo.OAL || null,
    number_of_flutes: geo.NOF || null,
    corner_radius: geo.RE || null,
    shank_diameter: geo.SFDM || null,
    taper_angle: geo.TA || null,
    tip_angle: geo.SIG || null,
    thread_pitch: geo.TP || null,
    shoulder_length: geo['shoulder-length'] || null,
    material: fTool.BMC || 'carbide',
    proshot_id: fTool['product-id'] || stripQuotes(expr.tool_productId) || '',
    product_link: fTool['product-link'] || stripQuotes(expr.tool_productLink) || '',
    location: stripQuotes(expr.tool_vendor) || '',
    // Speeds & feeds from presets
    spindle_speed: preset.n || null,
    cutting_feedrate: preset.v_f || null,
    plunge_feedrate: preset.v_f_plunge || null,
    ramp_feedrate: preset.v_f_ramp || null,
    lead_in_feedrate: preset.v_f_leadIn || null,
    lead_out_feedrate: preset.v_f_leadOut || null,
    feed_per_tooth: preset.f_z || null,
    feed_per_rev: preset.f_n || null,
    cutting_speed: preset.v_c || null,
    // Full presets array (Fusion's start-values). Shallow-copied so editing in
    // the app never mutates the cached raw object. The flat speed/feed fields
    // above mirror presets[0] for forms that don't use the preset editor.
    presets: (fTool['start-values']?.presets || []).map(p => ({
      ...p,
      operation_type: p.operation_type ?? parsePresetName(p.name)?.opType ?? null,
    })),
    // Machine tool number — read from post-process.number. The metadata file is
    // the source of truth; this is only a fallback when metadata is missing.
    machine_tool_number: (fTool['post-process']?.number ?? null) === null
      ? null
      : Number(fTool['post-process'].number),
    // Metadata fields default empty — filled from metadata file
    vendor: '',
    coating: '',
    purchasing: { manufacturers: [], vendors: [] },
    tsc_capable: false,
    no_fusion_link: false,
    center_cutting: false,
    flute_design: '',
    // cutting_direction: for taps, derived from the Fusion type string (tap left/right hand)
    // since HAND may not be reliable; for all other tools, from geometry.HAND (true = RH).
    cutting_direction: rawType === 'tap left hand' ? 'Left Hand'
      : (geo.HAND === false ? 'Left Hand' : 'Right Hand'),
    material_suitability: [],
    tags: [],
    notes: '',
    last_used_job: '',
    preferred_machine: '',
    updated_by: '',
    revision_notes: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    _fusionRaw: fTool,
  };
}

// Normalize an internal/Fusion preset object into a complete Fusion start-values
// preset, preserving every field the app doesn't model and filling required
// defaults. tscCapable only seeds the coolant when the preset has none of its own.
// toolType conditions which fields are emitted (milling vs. hole-making vs. turning).
function normalizePreset(p, tscCapable = false, toolType = 'flat end mill') {
  const isTap = toolType === 'tap';
  // Spot drills get their own preset shape: a full milling-style cutting-feed
  // set (cutting/lead-in/lead-out/transition/ramp feed + feed-per-tooth) PLUS
  // drill-specific plunge/retract feedrates and the feed-per-revolution flag —
  // but no ramp angle/spindle, no stepdown/stepover, and no f_n. This matches
  // how Fusion 360 itself shapes a spot drill preset.
  const isSpotDrill = toolType === 'spot drill';
  const isDrillFamily = !isTap && !isSpotDrill && HOLE_MAKING_TYPES.has(toolType);
  const isHoleMaking = isTap || isDrillFamily;
  const isTurning = TURNING_TYPES.has(toolType);
  const isMilling = !isHoleMaking && !isTurning && !isSpotDrill;

  // operation_type is an app-only field encoded in the preset name + metadata.
  // It must never be written into the Fusion JSON (Fusion validates strictly).
  // stepdown/stepover are pulled out of `rest` so a disabled flag leaves NO
  // leftover numeric key (Fusion omits the key entirely when disabled).
  const { operation_type, stepdown: _sd, stepover: _so, ...rest } = p;

  // Strip milling-specific fields from hole-making, turning, and spot-drill
  // presets so they don't survive as stale keys in the Fusion JSON.
  if (isHoleMaking || isTurning || isSpotDrill) {
    delete rest['use-stepdown'];
    delete rest['use-stepover'];
  }
  if (isHoleMaking || isSpotDrill) {
    delete rest['ramp-angle'];
    delete rest.n_ramp;
  }
  if (isHoleMaking) {
    delete rest.v_f;
    delete rest.f_z;
    delete rest.v_f_leadIn;
    delete rest.v_f_leadOut;
    delete rest.v_f_transition;
    delete rest.v_f_ramp;
  }
  if (isTap) {
    delete rest.v_f_plunge;
    delete rest['v_f_retract'];
    delete rest.f_n;
    delete rest['use-feed-per-revolution'];
  } else if (isSpotDrill) {
    delete rest.f_n;
  }

  // Fusion's "Filter by Type" (material.category) must never be blank and only
  // accepts all/metal/plastic. Heal blanks and the app's old invalid values
  // (milling/turning/drilling) by deriving from the material query.
  const mat = p.material || {};
  const category = ['all', 'metal', 'plastic'].includes(mat.category)
    ? mat.category
    : materialCategory(mat.query);

  // stepdown/stepover live in THREE places that Fusion keeps in sync: the
  // `use-*` boolean, the numeric value, and an expression string
  // (expressions.tool_stepdown / tool_stepover, e.g. ".018 in"). If we write the
  // boolean false but leave a leftover expression OR a numeric value, Fusion
  // re-derives the checkbox from it on reload and flips the flag back to true —
  // the recurring "use stepdown/stepover became true" bug. So treat the boolean
  // as the source of truth, source the numeric value from the field OR the
  // expression (the value sometimes lives only in the expression), and when the
  // flag is disabled strip BOTH the expression and the numeric key (match
  // Fusion's native "off" preset, which omits them entirely).
  const exprNum = (s) => { const m = String(s ?? '').match(/-?\d*\.?\d+/); return m ? Number(m[0]) : null; };
  const sdNum = (p.stepdown != null && Number(p.stepdown) > 0) ? Number(p.stepdown) : exprNum(p.expressions?.tool_stepdown);
  const soNum = (p.stepover != null && Number(p.stepover) > 0) ? Number(p.stepover) : exprNum(p.expressions?.tool_stepover);
  const useStepdown = isMilling && !!p['use-stepdown'] && sdNum != null && sdNum > 0;
  const useStepover = isMilling && !!p['use-stepover'] && soNum != null && soNum > 0;
  const presetExpr = { ...(p.expressions || {}) };
  if (!useStepdown) delete presetExpr.tool_stepdown;
  if (!useStepover) delete presetExpr.tool_stepover;

  // Base fields present for every tool category.
  const out = {
    ...rest,
    guid: p.guid || generateId(),
    description: p.description || '',
    name: p.name || 'Default preset',
    material: { category, query: mat.query || '', 'use-hardness': mat['use-hardness'] || false },
    expressions: presetExpr,
    'tool-coolant': ({ 'flood and through tool': 'flood tool' }[p['tool-coolant']] ?? p['tool-coolant']) || (tscCapable ? 'tool' : 'flood'),
    n: p.n ?? 0,
    v_c: p.v_c ?? 0,
  };

  if (isMilling) {
    // Full milling preset: cutting feeds, ramp, lead-in/out, stepdown/stepover.
    out['ramp-angle'] = p['ramp-angle'] ?? 2;
    out['use-stepdown'] = useStepdown;
    out['use-stepover'] = useStepover;
    out.n_ramp = p.n_ramp ?? 0;
    out.v_f = p.v_f ?? 0;
    out.v_f_leadIn = p.v_f_leadIn ?? 0;
    out.v_f_leadOut = p.v_f_leadOut ?? 0;
    out.v_f_plunge = p.v_f_plunge ?? 0;
    out.v_f_ramp = p.v_f_ramp ?? 0;
    out.v_f_transition = p.v_f_transition ?? 0;
    out.f_z = p.f_z ?? 0;
    out.f_n = p.f_n ?? 0;
    // Only emit the numeric step keys when the flag is enabled — otherwise omit
    // them so a disabled preset matches Fusion's native "off" shape exactly.
    if (useStepdown) out.stepdown = sdNum;
    if (useStepover) out.stepover = soNum;
  } else if (isTurning) {
    // Turning/boring: cutting feed + feed-per-rev + plunge; no step fields or ramp.
    out.n_ramp = p.n_ramp ?? 0;
    out.v_f = p.v_f ?? 0;
    out.f_n = p.f_n ?? 0;
    out.v_f_plunge = p.v_f_plunge ?? 0;
  } else if (isSpotDrill) {
    // Spot drill: full cutting-feed set (cutting, lead-in/out, transition, ramp
    // feed, feed/tooth) plus drill-specific plunge/retract feedrates and the
    // feed-per-revolution flag. No ramp angle/spindle, no f_n, no stepdown/stepover.
    out.v_f = p.v_f ?? 0;
    out.v_f_leadIn = p.v_f_leadIn ?? 0;
    out.v_f_leadOut = p.v_f_leadOut ?? 0;
    out.v_f_ramp = p.v_f_ramp ?? 0;
    out.v_f_transition = p.v_f_transition ?? 0;
    out.f_z = p.f_z ?? 0;
    out.v_f_plunge = p.v_f_plunge ?? 0;
    out['v_f_retract'] = p['v_f_retract'] ?? 0;
    out['use-feed-per-revolution'] = p['use-feed-per-revolution'] ?? false;
  } else if (isDrillFamily) {
    // Drills/reamers: plunge + retract feedrates and optional feed-per-revolution.
    out.v_f_plunge = p.v_f_plunge ?? 0;
    out['v_f_retract'] = p['v_f_retract'] ?? 0;
    out.f_n = p.f_n ?? 0;
    out['use-feed-per-revolution'] = p['use-feed-per-revolution'] ?? false;
  }
  // Tap: only n, v_c, tool-coolant — already set in the base fields above.

  return out;
}

// Tool types that carry a point (included) angle in geometry.SIG — kept in sync
// with the TSV path's tipAngleTypes (fusionExport.js) and tip_angle's
// appliesToTypes (fieldRegistry.js). Chamfer mill is NOT in this set — its
// included angle is geometry.TA × 2 (see INCLUSIVE_ANGLE_TYPES, fieldRegistry.js).
const TIP_ANGLE_TYPES = new Set(['drill', 'center drill', 'spot drill', 'counter sink']);

// Tool types that carry a thread pitch in geometry.TP (numeric, the tool's unit).
// The human-readable thread designation lives separately in `pitch` (metadata).
const THREAD_PITCH_TYPES = new Set(['thread mill', 'tap']);

// Inch / metric thread-size option lists shown in the Tap / Thread Mill thread-size
// combobox, selected by `tap_thread_unit` (independent of the tool's overall unit).
export const INCH_THREAD_SIZES = [
  // Number sizes
  '#0-80 UNF', '#1-64 UNC', '#1-72 UNF', '#2-56 UNC', '#2-64 UNF',
  '#3-48 UNC', '#3-56 UNF', '#4-40 UNC', '#4-48 UNF', '#5-40 UNC', '#5-44 UNF',
  '#6-32 UNC', '#6-40 UNF', '#8-32 UNC', '#8-36 UNF', '#10-24 UNC', '#10-32 UNF',
  '#12-24 UNC', '#12-28 UNF',
  // Fractional
  '1/4-20 UNC', '1/4-28 UNF', '5/16-18 UNC', '5/16-24 UNF', '3/8-16 UNC', '3/8-24 UNF',
  '7/16-14 UNC', '7/16-20 UNF', '1/2-13 UNC', '1/2-20 UNF', '9/16-12 UNC', '9/16-18 UNF',
  '5/8-11 UNC', '5/8-18 UNF', '3/4-10 UNC', '3/4-16 UNF', '7/8-9 UNC', '7/8-14 UNF',
  '1-8 UNC', '1-12 UNF', '1-1/8-7 UNC', '1-1/8-12 UNF', '1-1/4-7 UNC', '1-1/4-12 UNF',
  '1-3/8-6 UNC', '1-3/8-12 UNF', '1-1/2-6 UNC', '1-1/2-12 UNF', '1-3/4-5 UNC', '2-4.5 UNC',
  // Pipe
  '1/8-27 NPT', '1/4-18 NPT', '3/8-18 NPT', '1/2-14 NPT', '3/4-14 NPT', '1-11.5 NPT',
  '1-1/4-11.5 NPT', '1-1/2-11.5 NPT', '2-11.5 NPT',
  '1/8-27 NPTF', '1/4-18 NPTF', '3/8-18 NPTF', '1/2-14 NPTF', '3/4-14 NPTF', '1-11.5 NPTF',
  // Custom
  'Custom...',
];

export const METRIC_THREAD_SIZES = [
  'M1 x 0.25', 'M1.2 x 0.25', 'M1.4 x 0.3', 'M1.6 x 0.35', 'M2 x 0.4', 'M2.5 x 0.45',
  'M3 x 0.5', 'M3.5 x 0.6', 'M4 x 0.7', 'M5 x 0.8', 'M6 x 1.0', 'M6 x 0.75',
  'M8 x 1.25', 'M8 x 1.0', 'M10 x 1.5', 'M10 x 1.25', 'M10 x 1.0', 'M12 x 1.75', 'M12 x 1.25',
  'M14 x 2.0', 'M14 x 1.5', 'M16 x 2.0', 'M16 x 1.5', 'M18 x 2.5', 'M18 x 1.5',
  'M20 x 2.5', 'M20 x 1.5', 'M22 x 2.5', 'M22 x 1.5', 'M24 x 3.0', 'M24 x 2.0',
  'M27 x 3.0', 'M27 x 2.0', 'M30 x 3.5', 'M30 x 2.0', 'M33 x 3.5', 'M33 x 2.0',
  'M36 x 4.0', 'M36 x 3.0', 'M39 x 4.0', 'M39 x 3.0', 'M42 x 4.5', 'M42 x 3.0',
  'M45 x 4.5', 'M45 x 3.0', 'M48 x 5.0', 'M48 x 3.0',
  'M52 x 5.0', 'M56 x 5.5', 'M60 x 5.5', 'M64 x 6.0',
  // Custom
  'Custom...',
];

// Tap LIMIT TOLERANCE ("tap_class") option lists — H1-H6 / 4H-7G are pitch-diameter
// limit tolerances (how loose/tight the thread is cut), set by the tap manufacturer.
// H3 / 6H are the standard/most-common defaults for inch and metric machine taps.
// This is DISTINCT from "class of fit" (1B/2B/3B below) — that's an assembly-level
// spec for how the tapped hole mates with its mating part, not a tap-grinding spec.
export const TAP_LIMIT_TOLERANCE_OPTIONS_INCH = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
export const TAP_LIMIT_TOLERANCE_DEFAULT_INCH = 'H3'; // most common — standard machine tap
export const TAP_LIMIT_TOLERANCE_OPTIONS_METRIC = ['4H', '5H', '6H', '7H', '6G', '7G'];
export const TAP_LIMIT_TOLERANCE_DEFAULT_METRIC = '6H'; // standard

// Class of fit ("class_of_fit") — internal-thread fit grade (1B loosest … 3B tightest).
// Distinct from tap limit tolerance above; tracked nowhere else (not ProShop, not
// Fusion) — purely a manually-entered reference field. 2B is the general-purpose default.
// TODO: no auto-derivation — per spec, the 2B/3B selection formula isn't understood yet.
export const CLASS_OF_FIT_OPTIONS = ['1B', '2B', '3B'];
export const CLASS_OF_FIT_DEFAULT = '2B';


export function internalToFusionTool(tool) {
  const existing = tool._fusionRaw || {};
  const FT_MAP = {
    'flat end mill': 'flat end mill',
    'ball end mill': 'ball end mill',
    'bull nose end mill': 'bull nose end mill',
    'tapered mill': 'tapered mill',
    'radius mill': 'radius mill',
    'form mill': 'form mill',
    'lollipop mill': 'lollipop mill',
    'slot/key cutter': 'slot mill',
    'dovetail': 'dovetail mill',
    'thread mill': 'thread mill',
    'face mill': 'face mill',
    'chamfer mill': 'chamfer mill',
    'circle segment barrel': 'circle segment barrel',
    'circle segment lens': 'circle segment lens',
    'circle segment oval': 'circle segment oval',
    'circle segment taper': 'circle segment taper',
    'drill': 'drill',
    'center drill': 'center drill',
    'spot drill': 'spot drill',
    'reamer': 'reamer',
    'counter bore': 'counter bore',
    'counter sink': 'counter sink',
    // 'tap left hand' is a confirmed Fusion type (Special Cases library verified).
    // The actual value is resolved below based on cutting_direction.
    'tap': 'tap right hand',
    'boring head': 'boring bar',
    'boring bar': 'boring bar',
    'turning general': 'turning general',
  };

  // Taps branch on cutting_direction since Fusion has distinct 'tap left/right hand' types.
  const fusionType = tool.tool_type === 'tap'
    ? (tool.cutting_direction === 'Left Hand' ? 'tap left hand' : 'tap right hand')
    : (FT_MAP[tool.tool_type] || tool.tool_type);

  // Feed-rate unit strings depend on whether the tool is stored in inches or mm.
  const isInch = (tool.unit || existing.unit || 'inches') !== 'millimeters';
  const feedUnit  = isInch ? 'inpm'  : 'mmpm';
  const speedUnit = isInch ? 'fpm'   : 'm/min';
  // Fusion's feed-per-tooth expression unit is just the linear unit ("in" / "mm"),
  // NOT "in/tooth" — using "in/tooth" causes Fusion to fail parsing the expression.
  const fzUnit    = isInch ? 'in'    : 'mm';
  // Linear unit suffix for geometry expression strings (tool_diameter, etc.).
  // Fusion re-derives every numeric geometry field from its paired expression on
  // load, so the suffix MUST match the tool's stored unit — writing " in" on a mm
  // tool makes Fusion parse the value as inches and corrupt the geometry.
  const lenUnit   = isInch ? 'in'    : 'mm';

  // Write the FULL presets array — never collapse a multi-preset tool to one.
  // The flat speed/feed fields (edited by ToolForm) are synced into presets[0]
  // so edits made outside the preset editor are preserved. Falls back to a
  // single synthesized preset only when the tool has no presets array yet.
  const sourcePresets = (tool.presets && tool.presets.length > 0)
    ? tool.presets
    : [existing['start-values']?.presets?.[0] || {}];
  const isHoleMakingTool = HOLE_MAKING_TYPES.has(tool.tool_type);
  const isTapTool = tool.tool_type === 'tap';
  // Spot drills get a milling-like cutting-feed set PLUS drill plunge/retract —
  // see normalizePreset for the full field-shape rationale.
  const isSpotDrillTool = tool.tool_type === 'spot drill';

  const outPresets = sourcePresets.map((p, i) => {
    const np = normalizePreset(p, tool.tsc_capable, tool.tool_type);
    if (i === 0) {
      // Speed fields apply to all tool types.
      np.n   = tool.spindle_speed ?? np.n;
      np.v_c = tool.cutting_speed ?? np.v_c;
      // Milling-only flat fields — not written for hole-making tools (spot
      // drill excepted: it gets the same cutting-feed set as milling tools).
      if (!isHoleMakingTool || isSpotDrillTool) {
        np.v_f        = tool.cutting_feedrate  ?? np.v_f;
        np.f_z        = tool.feed_per_tooth    ?? np.f_z;
        np.v_f_ramp   = tool.ramp_feedrate     ?? np.v_f_ramp;
        np.v_f_leadIn  = tool.lead_in_feedrate  ?? np.v_f_leadIn;
        np.v_f_leadOut = tool.lead_out_feedrate ?? np.v_f_leadOut;
      }
      // Plunge applies to drills/reamers, turning, and spot drills, not taps.
      // Feed-per-rev (f_n) applies to drills/reamers and turning only — spot
      // drill has no f_n (normalizePreset already stripped it; keep it gone).
      if (!isTapTool && !isSpotDrillTool) {
        np.v_f_plunge = tool.plunge_feedrate ?? np.v_f_plunge;
        np.f_n        = tool.feed_per_rev    ?? np.f_n;
      } else if (isSpotDrillTool) {
        np.v_f_plunge = tool.plunge_feedrate ?? np.v_f_plunge;
        delete np.f_n;
      }
    }
    // Classify this tool's category for the preset expression logic below.
    const isDrillFamilyTool = isHoleMakingTool && !isTapTool;
    const isTurningTool = TURNING_TYPES.has(tool.tool_type);
    const isMillingTool = !isHoleMakingTool && !isTurningTool;

    // Detect a blank preset: all numeric speed/feed fields are zero, meaning the
    // tool was just created in the app with no values entered yet. We seed Fusion's
    // standard default values so the library is immediately usable without requiring
    // the user to manually enter speeds and feeds first.
    const origExprs = np.expressions || {};
    const isBlankPreset = !np.n && !np.v_c;
    if (isBlankPreset) {
      np.n = isTapTool ? 500 : 5000;
      if (isMillingTool) np.n_ramp = np.n;
      // Surface speed companion (Fusion formula: diameter × π × n).
      const dia = tool.diameter || 0;
      np.v_c = isInch ? (dia * Math.PI * np.n / 12) : (dia * Math.PI * np.n / 1000);
      if (isMillingTool || isSpotDrillTool) {
        np.v_f           = 40;
        np.v_f_leadIn    = 40;
        np.v_f_leadOut   = 40;
        np.v_f_plunge    = 40 / 3;
        np.v_f_ramp      = 40 / 3;
        np.v_f_transition = 40;
        const nof = Math.max(tool.number_of_flutes || 1, 1);
        np.f_z = np.n > 0 ? np.v_f / (np.n * nof) : 0;
        if (isMillingTool) np.f_n = np.n > 0 ? np.v_f_plunge / np.n : 0;
        if (isSpotDrillTool) np['v_f_retract'] = np.v_f_plunge;
      } else if (isDrillFamilyTool) {
        np.v_f_plunge        = 40;
        np['v_f_retract'] = 40;
      }
    }

    // Regenerate preset-level expression strings to match the final numeric values.
    // Fusion re-derives numeric values from expressions on every load, so a stale
    // expression silently overrides the field we just wrote. Regenerate here so the
    // stored number and its expression string are always in sync.
    // normalizePreset already handled tool_stepdown / tool_stepover (deleted when
    // the flag is off), so spread origExprs first to preserve those.
    //
    // Speed mode: ONE of tool_spindleSpeed or tool_surfaceSpeed is the user input;
    // the other is a companion display formula. Feed mode: tool_feedCutting (IPM)
    // or tool_feedPerTooth is the user input; the companion formula is always written.
    const hasSurfaceSpeed = 'tool_surfaceSpeed' in origExprs;
    const hasSpindleSpeed = 'tool_spindleSpeed'  in origExprs;
    const hasFeedPerTooth = 'tool_feedPerTooth'  in origExprs;
    const hasFeedCutting  = 'tool_feedCutting'   in origExprs;

    // Fusion's universal spindle-speed formula (handles probe/tap/all other types).
    const SPINDLE_FORMULA = "tool_type == 'probe' ? 0 : tool_type == 'tap right hand' || tool_type == 'tap left hand' ? 500rpm : 5000rpm";
    // Surface-speed companion formula (always evaluated by Fusion alongside RPM).
    const SURFACE_FORMULA = 'tool_diameter * Math.PI * tool_spindleSpeed';

    np.expressions = {
      ...origExprs,
      // Speed: Fusion's universal formula for blank presets; literal for user-set values.
      // The formula covers probe (0), tap (500 rpm), and all other tools (5000 rpm).
      ...(hasSpindleSpeed || !hasSurfaceSpeed
        ? { tool_spindleSpeed: isBlankPreset ? SPINDLE_FORMULA : `${np.n ?? 0} rpm` }
        : {}),
      // Surface speed: literal when user is in surface-speed input mode;
      // companion formula otherwise (Fusion displays it alongside the RPM value).
      ...(hasSurfaceSpeed
        ? { tool_surfaceSpeed: `${np.v_c ?? 0} ${speedUnit}` }
        : { tool_surfaceSpeed: SURFACE_FORMULA }),
      // Cutting feed (milling + spot drill) — literal for the primary input mode.
      ...((isMillingTool || isSpotDrillTool) && (hasFeedCutting || !hasFeedPerTooth)
        ? { tool_feedCutting: `${np.v_f ?? 0} ${feedUnit}` } : {}),
      // Feed-per-tooth: literal when user is in fpt input mode; Fusion companion
      // formula otherwise (always written so Fusion can display it next to IPM).
      ...((isMillingTool || isSpotDrillTool)
        ? (hasFeedPerTooth
            ? { tool_feedPerTooth: `${np.f_z ?? 0} ${fzUnit}` }
            : { tool_feedPerTooth: 'tool_spindleSpeed > 0 ? tool_feedCutting/(tool_spindleSpeed * tool_numberOfFlutes) : 0.0' })
        : {}),
      // Plunge: applies to all non-tap tools. Preserved from origExprs on existing
      // presets; Fusion's default ternary injected for new presets.
      ...(!isTapTool && !('tool_feedPlunge' in origExprs)
        ? { tool_feedPlunge: "(tool_type=='drill' || tool_type=='reamer' || tool_isDepositing)?(40inpm):(tool_feedCutting/3)" } : {}),
      // Ramp and transition: milling + spot drill.
      ...((isMillingTool || isSpotDrillTool) && !('tool_feedRamp' in origExprs)
        ? { tool_feedRamp: 'tool_feedPlunge' } : {}),
      ...((isMillingTool || isSpotDrillTool) && !('tool_feedTransition' in origExprs)
        ? { tool_feedTransition: 'tool_feedCutting' } : {}),
      // Drill-specific companion formulas for retract and feed-per-revolution.
      ...(isDrillFamilyTool && !('tool_feedRetract' in origExprs)
        ? { tool_feedRetract: 'tool_feedPlunge' } : {}),
      ...(isDrillFamilyTool && !('tool_feedPerRevolution' in origExprs)
        ? { tool_feedPerRevolution: 'tool_spindleSpeed > 0 ? tool_feedPlunge/tool_spindleSpeed : 0.0' } : {}),
      ...(isDrillFamilyTool && !('tool_feedRetractPerRevolution' in origExprs)
        ? { tool_feedRetractPerRevolution: 'tool_feedPerRevolution' } : {}),
    };
    return np;
  });

  // Machine tool number drives the post-process fields. When present, all three
  // (number / length-offset / diameter-offset) must be written to the same value,
  // and the expression link must be kept intact. When no number is assigned, the
  // post-process number / expression are simply left unwritten.
  const mtn = tool.machine_tool_number;
  const hasMtn = mtn !== null && mtn !== undefined && mtn !== '' && !isNaN(parseInt(mtn));
  const mtnInt = hasMtn ? parseInt(mtn) : null;

  const fusionObj = {
    ...existing,
    BMC: tool.material || existing.BMC || 'carbide',
    // GRADE is absent on ~27% of native Fusion tools (the UI defaults it). Only
    // carry it forward when the original entry had one — never inject a default.
    ...(existing.GRADE ? { GRADE: existing.GRADE } : {}),
    description: tool.description || '',
    type: fusionType,
    // Write the tool's own unit. For existing tools this equals the Fusion entry's
    // unit (read back into tool.unit); for new tools it's the user-selected unit, so
    // the geometry we write raw is interpreted by Fusion in the right unit.
    unit: tool.unit || existing.unit || 'inches',
    guid: tool.id,
    last_modified: Date.now(),
    'product-id': tool.proshot_id || '',
    'product-link': tool.product_link || '',
    expressions: {
      ...(existing.expressions || {}),
      tool_description: `'${tool.description || ''}'`,
      tool_diameter: `${tool.diameter || 0} ${lenUnit}`,
      tool_fluteLength: `${tool.flute_length || 0} ${lenUnit}`,
      tool_overallLength: `${tool.overall_length || 0} ${lenUnit}`,
      tool_material: `'${tool.material || 'carbide'}'`,
      tool_productId: `'${tool.proshot_id || ''}'`,
      tool_productLink: `'${tool.product_link || ''}'`,
      tool_shaftDiameter: `${tool.shank_diameter || tool.diameter || 0} ${lenUnit}`,
      tool_shoulderLength: `${tool.shoulder_length || tool.flute_length || 0} ${lenUnit}`,
      tool_vendor: `'${tool.location || ''}'`,
      ...(tool.tracking_id ? { tool_comment: `'${tool.tracking_id}'` } : {}),
      ...(tool.corner_radius ? { tool_cornerRadius: `${tool.corner_radius} ${lenUnit}` } : {}),
      ...((THREAD_PITCH_TYPES.has(tool.tool_type) && (tool.thread_pitch > 0 || existing.geometry?.TP > 0)) ? { tool_threadPitch: `${tool.thread_pitch || 0} ${lenUnit}` } : {}),
      ...(hasMtn ? { tool_number: String(mtnInt), tool_lengthOffset: 'tool_number' } : {}),
    },
    geometry: {
      ...(existing.geometry || {}),
      CSP: false,
      DC: tool.diameter || 0,
      // HAND from cutting_direction (true = right hand) — never hardcode true, or
      // left-hand tools silently flip to right-hand on every write.
      HAND: tool.cutting_direction !== 'Left Hand',
      LCF: tool.flute_length || 0,
      NOF: tool.number_of_flutes || 0,
      OAL: tool.overall_length || 0,
      SFDM: tool.shank_diameter || tool.diameter || 0,
      'shoulder-diameter': tool.shank_diameter || tool.diameter || 0,
      'shoulder-length': tool.shoulder_length || tool.flute_length || 0,
      // Only write these when non-zero (or when existing had a non-zero value, to support clearing).
      // The ...existing spread above preserves them from the original Fusion entry.
      ...(tool.corner_radius > 0 || (existing.geometry?.RE > 0) ? { RE: tool.corner_radius || 0 } : {}),
      ...(tool.taper_angle > 0 || (existing.geometry?.TA > 0) ? { TA: tool.taper_angle || 0 } : {}),
      // SIG = drill/spot/chamfer point (included) angle. Write only for the types
      // that carry it (matches the TSV path's tipAngleTypes), or when clearing an
      // existing value. Fusion is the source of truth for it (read back into tip_angle).
      ...((TIP_ANGLE_TYPES.has(tool.tool_type) && tool.tip_angle > 0) || (existing.geometry?.SIG > 0) ? { SIG: tool.tip_angle || 0 } : {}),
      // TP = thread pitch (numeric). Written for thread/tap types; kept in sync
      // with expressions.tool_threadPitch below (Fusion re-derives TP from the
      // expression on load, so the two must always agree).
      ...((THREAD_PITCH_TYPES.has(tool.tool_type) && (tool.thread_pitch > 0 || existing.geometry?.TP > 0)) ? { TP: tool.thread_pitch || 0 } : {}),
      ...(tool.tip_diameter > 0 || (existing.geometry?.['tip-diameter'] > 0) ? { 'tip-diameter': tool.tip_diameter || 0 } : {}),
      // NT, TP, thread-profile-angle, tip-length, tip-offset: never written explicitly;
      // preserved from ...existing if the original Fusion entry had them.
    },
    'start-values': {
      presets: outPresets,
    },
    ...(existing.holder ? { holder: existing.holder } : {}),
    'post-process': {
      ...(existing['post-process'] || {}),
      ...(tool.tracking_id ? { comment: tool.tracking_id } : {}),
      ...(hasMtn ? { number: mtnInt, 'length-offset': mtnInt, 'diameter-offset': mtnInt } : {}),
    },
  };
  // tool_inclusiveAngle is a chamfer-mill-only Fusion expression = 2 × geometry.TA
  // (the "Included/Inclusive Tip Angle" shown for chamfer mills — see
  // INCLUSIVE_ANGLE_TYPES in fieldRegistry.js). Write it alongside TA, same
  // condition as the TA write above; absent (not empty) for every other type —
  // same "write native + expression together, delete when not applicable"
  // pattern as the holder expression fields.
  if (tool.tool_type === 'chamfer mill' && (tool.taper_angle > 0 || existing.geometry?.TA > 0)) {
    fusionObj.expressions.tool_inclusiveAngle = `${(tool.taper_angle || 0) * 2} degrees`;
  } else {
    delete fusionObj.expressions.tool_inclusiveAngle;
  }
  // Fusion writes a literal "<NEW TOOL GUID>" placeholder into reference_guid on
  // freshly-created/duplicated tools that haven't been saved into the library yet —
  // it tells Fusion to mint a brand-new guid for the entry on its next save,
  // discarding whatever guid we supply. The ...existing spread carries this stale
  // placeholder forward on every subsequent write, so Fusion keeps minting a fresh
  // guid each sync — breaking the guid join between metadata's instance_guid and
  // the saved Fusion entry (the tool then looks like a stray on the next reconcile).
  // Strip it once the tool has entered our system; a real reference_guid (an actual
  // source/template guid Fusion assigned) is harmless and preserved as-is.
  if (fusionObj.reference_guid === '<NEW TOOL GUID>') {
    delete fusionObj.reference_guid;
  }
  // Guard: delete any metadata-only internal field names that shouldn't appear in Fusion JSON.
  // Fusion uses its own key names (BMC, DC, NOF, etc.) so this only catches accidental direct
  // copies of internal field names (e.g. if someone wrote fusionObj.vendor = tool.vendor).
  Object.keys(fusionObj).forEach(k => { if (isMetadataOnly(k)) delete fusionObj[k]; });
  // Root-level `vendor` is a genuine Fusion-native field (NOT our metadata-only
  // `vendor`/manufacturer — same key name, different meaning, hence set after the
  // guard above so it isn't stripped). It mirrors expressions.tool_vendor — Fusion
  // re-derives one from the other — and Fusion's "Vendor" field is repurposed here
  // as the cabinet location, so the value is tool.location.
  fusionObj.vendor = tool.location || '';
  return fusionObj;
}

// ─── Merge Fusion tool + metadata into single object ──────────────────────
export function mergeFusionAndMetadata(fusionInternal, meta) {
  if (!meta) return fusionInternal;
  return {
    ...fusionInternal,
    vendor: meta.vendor || '',
    coating: meta.coating || '',
    purchasing: meta.purchasing || { manufacturers: [], vendors: [] },
    tsc_capable: Boolean(meta.tsc_capable),
    center_cutting: meta.center_cutting ?? false,
    // cutting_direction is Fusion-native (geometry.HAND); Fusion wins, metadata fallback.
    cutting_direction: fusionInternal.cutting_direction || meta.cutting_direction || 'Right Hand',
    helix_angle: meta.helix_angle ?? fusionInternal.helix_angle ?? null,
    flute_type: meta.flute_type || '',
    flute_design: meta.flute_design || '',
    // tip_angle is now Fusion-native (geometry.SIG); Fusion wins, metadata is a
    // transition-only fallback for tools whose Fusion entry lacks SIG.
    tip_angle: fusionInternal.tip_angle ?? meta.tip_angle ?? null,
    tip_diameter: meta.tip_diameter ?? fusionInternal.tip_diameter ?? null,
    lower_radius: meta.lower_radius ?? null,
    upper_radius: meta.upper_radius ?? null,
    profile_radius: meta.profile_radius ?? null,
    axial_distance: meta.axial_distance ?? null,
    pitch: meta.pitch || '',
    tap_class: meta.tap_class || '',
    // New unified-tap fields — defaulting absent metadata to 'cut'/'' is the migration:
    // pre-unification tap form/cut tools simply pick up these defaults on first load.
    tap_sub_type: meta.tap_sub_type || 'cut',
    is_sti: meta.is_sti || false,
    tap_thread_unit: meta.tap_thread_unit || '',
    // class_of_fit (1B/2B/3B) is distinct from tap_class/tap_class limit tolerance —
    // tracked nowhere else (not ProShop, not Fusion), metadata-only.
    class_of_fit: meta.class_of_fit || '',
    min_thread_pitch: meta.min_thread_pitch ?? null,
    max_thread_pitch: meta.max_thread_pitch ?? null,
    tpi_min: meta.tpi_min ?? null,
    tpi_max: meta.tpi_max ?? null,
    thread_profile_angle: meta.thread_profile_angle ?? null,
    point_type: meta.point_type || '',
    tip_to_first_thread: meta.tip_to_first_thread ?? null,
    stub_jobber: meta.stub_jobber || '',
    double_ended: meta.double_ended || false,
    full_profile: meta.full_profile || false,
    backside_capable: meta.backside_capable || false,
    grouping: meta.grouping || '',
    preset_name: meta.preset_name || '',
    ooh: meta.ooh ?? null,
    min_ooh: meta.min_ooh ?? null,
    // Holder selection + proven assemblies live only in metadata.
    selected_holder_guid: meta.selected_holder_guid || null,
    assemblies: meta.assemblies || [],
    // Metadata-only fields
    // Machine tool number: metadata is the source of truth — it wins over the
    // value mirrored from the Fusion JSON on any conflict.
    machine_tool_number: (meta.machine_tool_number ?? fusionInternal.machine_tool_number ?? null) === null
      ? null
      : Number(meta.machine_tool_number ?? fusionInternal.machine_tool_number),
    no_fusion_link: Boolean(meta.no_fusion_link),
    notes: meta.notes || '',
    last_used_job: meta.last_used_job || '',
    preferred_machine: meta.preferred_machine || '',
    material_suitability: meta.material_suitability || [],
    tags: meta.tags || [],
    updated_by: meta.updated_by || '',
    revision_notes: meta.revision_notes || '',
    merge_history: meta.merge_history || [],
    created_at: meta.created_at || fusionInternal.created_at,
    updated_at: meta.updated_at || fusionInternal.updated_at,
    primary_photo_id: meta.primary_photo_id || null,
    primary_photo_name: meta.primary_photo_name || null,
    attachments: meta.attachments || [],
  };
}

// ─── Build the metadata record for a logical tool ─────────────────────────
// Keyed by tracking_id. Assemblies carry instance_guid (the Fusion entry each
// assembly maps to). preset_meta caches operation_type by preset guid as a
// fallback when a preset name can't be parsed.
export function buildMetadataTool(tool) {
  const preset_meta = {};
  for (const p of (tool.presets || [])) {
    if (p.guid && p.operation_type) preset_meta[p.guid] = { operation_type: p.operation_type };
  }
  return {
    id: tool.tracking_id || tool.id,
    vendor: tool.vendor || '',
    coating: tool.coating || '',
    purchasing: {
      manufacturers: (tool.purchasing?.manufacturers || []).map((m, i) => ({
        id: m.id || generateId(),
        name: m.name || '',
        edp: m.edp || '',
        edp_url: m.edp_url || '',
        mfg_num: m.mfg_num || '',
        mfg_num_url: m.mfg_num_url || '',
        order: m.order ?? i,
      })),
      vendors: (tool.purchasing?.vendors || []).map((v, i) => ({
        id: v.id || generateId(),
        manufacturer_id: v.manufacturer_id || null,
        name: v.name || '',
        vendor_num: v.vendor_num || '',
        vendor_num_url: v.vendor_num_url || '',
        price: v.price ?? null,
        // TODO: per-vendor lead_time field — not needed yet.
        order: v.order ?? i,
      })),
    },
    tsc_capable: tool.tsc_capable ?? false,
    center_cutting: tool.center_cutting || false,
    cutting_direction: tool.cutting_direction || 'Right Hand',
    helix_angle: tool.helix_angle ?? null,
    flute_type: tool.flute_type || '',
    flute_design: tool.flute_design || '',
    tip_angle: tool.tip_angle ?? null,
    tip_diameter: tool.tip_diameter ?? null,
    lower_radius: tool.lower_radius ?? null,
    upper_radius: tool.upper_radius ?? null,
    profile_radius: tool.profile_radius ?? null,
    axial_distance: tool.axial_distance ?? null,
    shoulder_length: tool.shoulder_length ?? null,
    ooh: tool.ooh ?? null,
    min_ooh: tool.min_ooh ?? null,
    pitch: tool.pitch || '',
    tap_class: tool.tap_class || '',
    tap_sub_type: tool.tap_sub_type || 'cut',
    is_sti: tool.is_sti || false,
    tap_thread_unit: tool.tap_thread_unit || '',
    class_of_fit: tool.class_of_fit || '',
    min_thread_pitch: tool.min_thread_pitch ?? null,
    max_thread_pitch: tool.max_thread_pitch ?? null,
    tpi_min: tool.tpi_min ?? null,
    tpi_max: tool.tpi_max ?? null,
    thread_profile_angle: tool.thread_profile_angle ?? null,
    point_type: tool.point_type || '',
    tip_to_first_thread: tool.tip_to_first_thread ?? null,
    stub_jobber: tool.stub_jobber || '',
    double_ended: tool.double_ended || false,
    full_profile: tool.full_profile || false,
    backside_capable: tool.backside_capable || false,
    grouping: tool.grouping || '',
    preset_name: tool.preset_name || '',
    // Machine tool number — persisted here as the source of truth, independent
    // of what gets written to the Fusion JSON.
    machine_tool_number: (tool.machine_tool_number ?? null) === null ? null : Number(tool.machine_tool_number),
    no_fusion_link: tool.no_fusion_link || false,
    // Holder selection + proven assemblies. Each assembly carries instance_guid
    // (the Fusion entry it maps to); supplementary notes live here.
    selected_holder_guid: tool.selected_holder_guid || null,
    assemblies: (tool.assemblies || []).map(a => ({
      assembly_id: a.assembly_id || generateAssemblyId(),
      instance_guid: a.instance_guid || null,
      holder_guid: a.holder_guid || null,
      holder_description: a.holder_description || '',
      ooh: a.ooh ?? null,
      linked_preset_guids: a.linked_preset_guids || [],
      notes: a.notes || '',
      source: a.source || 'manual',
      created_at: a.created_at || new Date().toISOString(),
    })),
    preset_meta,
    notes: tool.notes || '',
    last_used_job: tool.last_used_job || '',
    preferred_machine: tool.preferred_machine || '',
    material_suitability: tool.material_suitability || [],
    tags: tool.tags || [],
    updated_by: tool.updated_by || '',
    revision_notes: tool.revision_notes || '',
    merge_history: tool.merge_history || [],
    created_at: tool.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    primary_photo_id: tool.primary_photo_id || null,
    primary_photo_name: tool.primary_photo_name || null,
    attachments: (tool.attachments || []).map(a => ({
      file_id: a.file_id,
      filename: a.filename,
      type: a.type || 'other',
      uploaded_at: a.uploaded_at || new Date().toISOString(),
    })),
  };
}

// ─── Build a logical tool from a group of raw Fusion instances ─────────────
// rawInstances: all Fusion entries sharing one tracking ID (or a single legacy
// entry). metaByTracking: Map keyed by tracking_id. The first instance sources
// the shared fields; assemblies are derived one-per-instance.
export function buildLogicalTool(rawInstances, metaByTracking = new Map()) {
  const canonical = rawInstances[0];
  const tracking_id = readTrackingId(canonical);
  const meta = (tracking_id && metaByTracking) ? metaByTracking.get(tracking_id) : null;
  const internal = fusionToolToInternal(canonical);
  const merged = mergeFusionAndMetadata(internal, meta);

  const metaAsmByGuid = new Map((meta?.assemblies || [])
    .filter(a => a.instance_guid)
    .map(a => [a.instance_guid, a]));

  const assemblies = rawInstances.map(raw => {
    const m = metaAsmByGuid.get(raw.guid) || {};
    return {
      assembly_id: m.assembly_id || generateAssemblyId(),
      instance_guid: raw.guid,
      holder_guid: raw.holder?.guid || m.holder_guid || null,
      holder_description: raw.holder?.description || m.holder_description || '',
      ooh: readOohFromFusion(raw) ?? (m.ooh ?? null),
      linked_preset_guids: m.linked_preset_guids || [],
      notes: m.notes || '',
      source: m.source || 'fusion',
      created_at: m.created_at || merged.created_at,
    };
  });

  // Overlay operation_type onto each preset: name wins, metadata cache is fallback.
  const presetMeta = meta?.preset_meta || {};
  const presets = (merged.presets || []).map(p => ({
    ...p,
    operation_type: parsePresetName(p.name)?.opType ?? presetMeta[p.guid]?.operation_type ?? null,
  }));

  const mtn = meta?.machine_tool_number ?? canonical['post-process']?.number ?? null;

  return {
    ...merged,
    id: tracking_id || canonical.guid,
    tracking_id: tracking_id || null,
    machine_tool_number: mtn === null ? null : Number(mtn),
    presets,
    assemblies,
    _instancesRaw: rawInstances,
    _fusionRaw: canonical,
    // The metadata-registered assemblies — the instances the app has
    // acknowledged. Used by reconciliation to tell app-known instances from
    // entries dumped straight into the Fusion library.
    _registeredAssemblies: (meta?.assemblies || []).filter(Boolean),
  };
}

// ─── Split a logical tool into N raw Fusion instances + its metadata ───────
// Produces one Fusion entry per assembly. All entries share every field except
// guid, holder, and geometry.LB (per-instance OOH). holders is the holder
// library (for resolving holder_guid → full holder object on new assemblies).
export function splitToFusionInstances(tool, holders = []) {
  const tracking_id = tool.tracking_id || tool.id;
  const isMetric = tool.unit === 'millimeters';

  let assemblies = (tool.assemblies && tool.assemblies.length > 0)
    ? tool.assemblies
    : [{
        assembly_id: generateAssemblyId(),
        instance_guid: tool.id,
        holder_guid: tool.selected_holder_guid || null,
        holder_description: '',
        ooh: tool.ooh ?? null,
        source: 'manual',
      }];

  const rawByGuid = new Map((tool._instancesRaw || []).map(r => [r.guid, r]));

  const fusionInstances = assemblies.map(a => {
    const instanceGuid = a.instance_guid || generateId();
    const raw = rawByGuid.get(instanceGuid) || tool._fusionRaw || {};
    const base = internalToFusionTool({
      ...tool,
      id: instanceGuid,
      tracking_id,
      _fusionRaw: raw,
    });

    // Shared machine tool number across every instance.
    if (tool.machine_tool_number != null && tool.machine_tool_number !== '' &&
        !isNaN(parseInt(tool.machine_tool_number))) {
      applyMachineNumberToFusion(base, tool.machine_tool_number);
    }

    // Per-instance holder.
    // buildHolderObject always uses holderEntry.guid (the original GUID from the
    // holder library entry), never generates a new one — Fusion requires the
    // original GUID to maintain its link back to the holder library.
    // The holder library is the source of truth for gaugeLength — it stores the
    // correct value (total segment height minus the last segment, which Fusion
    // marks "above the gauge line"). Raw Fusion entries may carry a stale/wrong
    // gaugeLength from a previous bad write; always re-read from the library.
    if (a.holder_guid) {
      const holder = holders.find(h => h.guid === a.holder_guid);
      base.holder = holder ? buildHolderObject(holder) : (raw.holder || undefined);
      if (!base.holder) delete base.holder;
    } else if (raw.holder) {
      base.holder = raw.holder;
    } else {
      delete base.holder;
    }

    // Sync expressions.holder_description / holder_vendor to the resolved holder —
    // Fusion re-derives the displayed holder name/vendor from these expressions, not
    // from holder.description/holder.vendor, so stale values (e.g. carried over from
    // the first holder ever attached to this tool) show the wrong holder identity in
    // Fusion even though our holder object is correct. Same "write the native value
    // AND its paired expression together" rule as geometry.LB/tool_bodyLength.
    // Fusion omits each key entirely when the holder has no value for it (not every
    // holder has a vendor), so mirror that rather than writing an empty string.
    base.expressions = { ...(base.expressions || {}) };
    if (base.holder?.description) {
      base.expressions.holder_description = `'${base.holder.description}'`;
    } else {
      delete base.expressions.holder_description;
    }
    if (base.holder?.vendor) {
      base.expressions.holder_vendor = `'${base.holder.vendor}'`;
    } else {
      delete base.expressions.holder_vendor;
    }

    // Per-instance OOH → geometry.LB (the documented OOH source of truth).
    // OOH is stored in the tool's own unit, so it's written raw (no conversion).
    // ALSO update expressions.tool_bodyLength — Fusion re-derives LB from this
    // expression on every library load, silently overriding the numeric field if
    // the two don't match. Both must be updated together.
    // When ooh is null (no assembly yet), fall back to the existing LB (from a
    // prior Fusion entry) or seed with shoulder_length / flute_length so Fusion
    // always receives a valid LB — it requires the field to be present.
    const oohNum = (a.ooh != null && a.ooh !== '' && !isNaN(Number(a.ooh))) ? Number(a.ooh) : null;
    const lb = oohNum ??
      raw.geometry?.LB ??
      tool.shoulder_length ??
      tool.flute_length ??
      0;
    base.geometry = { ...(base.geometry || {}), LB: lb };
    base.expressions = { ...(base.expressions || {}), tool_bodyLength: `${lb} ${isMetric ? 'mm' : 'in'}` };

    // Recompute assemblyGaugeLength (geometry.assemblyGaugeLength) from the
    // holder's gauge length and the per-instance OOH. Previous bad writes may
    // have stored a stale value derived from an incorrect holder gaugeLength —
    // always recompute so it stays consistent with what we just wrote. The value
    // must be in the TOOL's unit to match the sibling geometry.LB: the holder's
    // gaugeLength is in the HOLDER's own unit (a mm holder may sit on an inch
    // tool), so convert it into the tool's unit before adding the OOH (already in
    // the tool's unit). Mirrors the export path in fusionExport.js.
    if (base.holder && typeof base.holder.gaugeLength === 'number' && a.ooh != null && !isNaN(Number(a.ooh))) {
      const holderGaugeNative = convertLength(base.holder.gaugeLength, base.holder.unit, tool.unit);
      base.geometry = { ...(base.geometry || {}), assemblyGaugeLength: holderGaugeNative + Number(a.ooh) };
    }

    return base;
  });

  return { fusionInstances, metadataTool: buildMetadataTool({ ...tool, tracking_id }) };
}

// Legacy single-entry split — retained for any caller that still needs a single
// Fusion object (e.g. JSON file export of one assembly).
export function splitToFusionAndMetadata(tool) {
  const fusionTool = internalToFusionTool(tool);
  const metadataTool = buildMetadataTool(tool);
  return { fusionTool, metadataTool };
}

// ─── Create a new blank tool ───────────────────────────────────────────────
const TAP_TYPES = new Set(['tap']);
function isTapType(t) { return TAP_TYPES.has(t); }

export function newTool(toolType = 'flat end mill') {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    tool_type: toolType,
    unit: getDefaultUnit(),
    description: '',
    diameter: null,
    flute_length: null,
    overall_length: null,
    number_of_flutes: null,
    shank_diameter: null,
    corner_radius: null,
    tip_angle: null,
    taper_angle: null,
    tip_diameter: null,
    lower_radius: null,
    upper_radius: null,
    profile_radius: null,
    axial_distance: null,
    shoulder_length: null,
    ooh: null,
    min_ooh: null,
    material: isTapType(toolType) ? 'hss' : 'carbide',
    coating: '',
    material_suitability: [],
    helix_angle: null,
    center_cutting: false,
    flute_type: '',
    flute_design: '',
    tsc_capable: false,
    cutting_direction: 'Right Hand',
    pitch: '',
    thread_pitch: null,
    tap_class: '',
    tap_sub_type: 'cut',
    is_sti: false,
    tap_thread_unit: '',
    class_of_fit: '',
    min_thread_pitch: null,
    max_thread_pitch: null,
    tpi_min: null,
    tpi_max: null,
    thread_profile_angle: null,
    point_type: '',
    tip_to_first_thread: null,
    stub_jobber: '',
    double_ended: false,
    full_profile: false,
    backside_capable: false,
    vendor: '',
    purchasing: { manufacturers: [], vendors: [] },
    product_link: '',
    preset_name: '',
    grouping: '',
    proshot_id: '',
    location: '',
    machine_tool_number: null,
    no_fusion_link: false,
    spindle_speed: null,
    cutting_feedrate: null,
    plunge_feedrate: null,
    ramp_feedrate: null,
    lead_in_feedrate: null,
    lead_out_feedrate: null,
    feed_per_tooth: null,
    feed_per_rev: null,
    cutting_speed: null,
    depth_of_cut: null,
    width_of_cut: null,
    notes: '',
    last_used_job: '',
    preferred_machine: '',
    tags: [],
    updated_by: '',
    revision_notes: '',
    presets: [],
    selected_holder_guid: null,
    assemblies: [],
    created_at: now,
    updated_at: now,
  };
}

// ─── Validation ────────────────────────────────────────────────────────────
export function validateTool(tool) {
  const errors = [];
  if (!tool.tool_type) errors.push('Tool type is required');
  if (!tool.diameter && tool.diameter !== 0) errors.push('Diameter is required');
  if (tool.diameter !== null && tool.diameter !== undefined && (isNaN(tool.diameter) || tool.diameter < 0)) {
    errors.push('Diameter must be a positive number');
  }
  if (!tool.description?.trim()) errors.push('Description is required');
  return { valid: errors.length === 0, errors };
}

export function validateGeometry(tool) {
  const warnings = [];

  function isValid(v) {
    return v !== null && v !== undefined && typeof v === 'number' && !isNaN(v) && v > 0;
  }

  const suffix = unitAbbr(tool.unit);
  function fmt(n) {
    return n.toFixed(4).replace(/\.?0+$/, '') + ' ' + suffix;
  }

  const { flute_length, shoulder_length, min_ooh, overall_length, corner_radius, diameter, tool_type } = tool;

  // All lengths (flute_length / shoulder_length / overall_length / min_ooh) are
  // stored in the tool's native unit, so the chain compares directly — no conversion.
  if (isValid(flute_length) && isValid(shoulder_length) && flute_length > shoulder_length) {
    warnings.push({
      fields: ['flute_length', 'shoulder_length'],
      message: `Flute Length (${fmt(flute_length)}) must be less than or equal to Shoulder Length (${fmt(shoulder_length)})`,
    });
  }

  if (isValid(shoulder_length) && isValid(min_ooh) && shoulder_length > min_ooh) {
    warnings.push({
      fields: ['shoulder_length', 'min_ooh'],
      message: `Shoulder Length (${fmt(shoulder_length)}) must be less than or equal to MIN OOH (${fmt(min_ooh)})`,
    });
  }

  if (isValid(min_ooh) && isValid(overall_length) && min_ooh > overall_length) {
    warnings.push({
      fields: ['min_ooh', 'overall_length'],
      message: `MIN OOH (${fmt(min_ooh)}) must be less than or equal to Overall Length (${fmt(overall_length)})`,
    });
  }

  if (tool_type === 'ball end mill' && isValid(corner_radius) && isValid(diameter)) {
    if (Math.abs(corner_radius - diameter / 2) > 0.00005) {
      warnings.push({
        fields: ['corner_radius'],
        message: `Ball End Mill corner radius must equal cut diameter ÷ 2 (${fmt(diameter / 2)}) — stored: ${fmt(corner_radius)}`,
      });
    }
  }

  if (tool_type === 'bull nose end mill' && isValid(corner_radius) && isValid(diameter)) {
    if (corner_radius >= diameter / 2) {
      warnings.push({
        fields: ['corner_radius'],
        message: `Bull Nose corner radius (${fmt(corner_radius)}) must be less than cut diameter ÷ 2 (${fmt(diameter / 2)})`,
      });
    }
  }

  return warnings;
}

// ─── Re-export getVisibleFields for components ────────────────────────────
export { getVisibleFields };

// ─── Human-readable field labels ──────────────────────────────────────────
// Generated from the field registry (the single source of truth for labels).
// Linear-unit suffixes are derived centrally by fieldLabel() at the shop default
// unit — to show a record's own unit (e.g. mm), call fieldLabel(field, unit)
// directly instead of reading this static map. Add/rename fields in the registry.
export const FIELD_LABELS = Object.fromEntries(
  Object.keys(FIELD_REGISTRY).map(name => [name, fieldLabel(name)])
);
