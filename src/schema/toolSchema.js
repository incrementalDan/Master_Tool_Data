import {
  TT, TL, BLANK, FIELD_VISIBILITY, _FV_KEYS,
  MA, CO, WM, MANUFACTURER_LIST, VENDOR_LIST,
  PS_GROUPS, AUTO_GROUP, COOLANT_OPTS, THROUGH_COOLANT_VALUES,
  getVisibleFields,
} from '../../tool-extractor.tsx';
import { isMetadataOnly } from './fieldRegistry.js';
import { parsePresetName, materialCategory } from '../utils/presetNaming.js';

export { TT, TL, MA, CO, WM, MANUFACTURER_LIST, VENDOR_LIST, PS_GROUPS, AUTO_GROUP, COOLANT_OPTS };

// ─── Icons ─────────────────────────────────────────────────────────────────
// Tool-type icons are rendered by the <ToolTypeIcon> component
// (src/components/icons/ToolTypeIcon.jsx) as hand-crafted SVG silhouettes.

export const TOOL_TYPES = TT;
export const TOOL_TYPE_LABELS = TL;

// ─── Facet fields per tool type (search filter order) ─────────────────────
const COMMON_FACETS = ['diameter', 'number_of_flutes', 'flute_length', 'overall_length', 'material', 'coating', 'vendor', 'tsc_capable', 'flute_design', 'material_suitability', 'tags'];

export function getFacetFields(toolType) {
  if (!toolType) return COMMON_FACETS;
  const extras = [];
  if (toolType === 'bull nose end mill' || toolType === 'radius mill' || toolType === 'lollipop mill') {
    extras.push('corner_radius');
  }
  if (toolType.includes('tap') || toolType === 'thread mill') {
    extras.push('pitch');
  }
  if (toolType === 'drill' || toolType === 'chamfer mill' || toolType === 'spot drill' || toolType === 'center drill') {
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
    edpNumber: 'product_id',
    approvedBrand: 'vendor',
    vendor: 'distributor',
    vendorStockNum: 'distributor_stock_num',
    productLink: 'product_link',
    presetName: 'preset_name',
    toolNumber: 'tool_number',
    helixAngle: 'helix_angle',
    centerCutting: 'center_cutting',
    fluteType: 'flute_type',
    cuttingDirection: 'cutting_direction',
    tapClass: 'tap_class',
    pointType: 'point_type',
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
  };
  return map[k] || k;
}

// ─── Convert extractor BLANK format → our internal model ───────────────────
export function extractorToTool(f) {
  return {
    tool_type: f.toolType || 'flat end mill',
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
    min_thread_pitch: parseFloat(f.minThreadPitch) || null,
    max_thread_pitch: parseFloat(f.maxThreadPitch) || null,
    point_type: f.pointType || '',
    stub_jobber: f.stubJobber || '',
    double_ended: f.doubleEnded || false,
    full_profile: f.fullProfile || false,
    backside_capable: f.backsideCapable || false,
    vendor: f.approvedBrand || '',
    distributor: f.vendor || '',
    product_id: f.edpNumber || '',
    distributor_stock_num: f.vendorStockNum || '',
    cost: f.cost || '',
    product_link: f.productLink || '',
    preset_name: f.presetName || '',
    tool_number: f.toolNumber || '',
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
    edpNumber: tool.product_id || '',
    productLink: tool.product_link || '',
    presetName: tool.preset_name || '',
    toolNumber: tool.tool_number || '',
    coolant: tool.tsc_capable ? 'flood tool' : 'flood',
    helixAngle: String(tool.helix_angle ?? ''),
    centerCutting: tool.center_cutting || false,
    fluteType: tool.flute_type || '',
    grouping: tool.grouping || AUTO_GROUP[tool.tool_type] || 'M',
    approvedBrand: tool.vendor || '',
    vendor: tool.distributor || '',
    cost: tool.cost || '',
    vendorStockNum: tool.distributor_stock_num || '',
    tapClass: tool.tap_class || '',
    pointType: tool.point_type || '',
    shoulderLen: String(tool.shoulder_length ?? ''),
    ooh: String(tool.ooh ?? ''),
    taperAngle: String(tool.taper_angle ?? ''),
    minThreadPitch: String(tool.min_thread_pitch ?? ''),
    maxThreadPitch: String(tool.max_thread_pitch ?? ''),
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
// geometry.LB (Body Length / "Length below Holder"). Always returned in inches.
export function readOohFromFusion(fTool) {
  const lb = fTool?.geometry?.LB;
  if (lb === null || lb === undefined || lb === '') return null;
  const v = Number(lb);
  if (isNaN(v)) return null;
  return fTool.unit === 'millimeters' ? v / 25.4 : v;
}

// Convert an inches-canonical length (OOH / min_ooh) into a tool's native unit.
// OOH and min_ooh are always stored in inches; the other length geometry
// (DC/LCF/OAL/shoulder-length) is stored in the tool's native unit — so any
// place those two worlds meet must convert. See the "Units" section in CLAUDE.md.
export function inchesToNative(value, unit) {
  if (value == null || value === '' || isNaN(Number(value))) return value;
  return unit === 'millimeters' ? Number(value) * 25.4 : Number(value);
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
  'tap right hand': 'tap form',
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
    tool_number: fTool['post-process']?.number ? String(fTool['post-process'].number) : '',
    // Machine tool number — output mirror of post-process.number. The metadata
    // file is the source of truth; this is only a fallback when metadata is missing.
    machine_tool_number: (fTool['post-process']?.number ?? null) === null
      ? null
      : Number(fTool['post-process'].number),
    // Metadata fields default empty — filled from metadata file
    vendor: '',
    product_id: '',
    coating: '',
    distributor: '',
    distributor_stock_num: '',
    cost: '',
    tsc_capable: false,
    center_cutting: false,
    flute_design: '',
    cutting_direction: 'Right Hand',
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
function normalizePreset(p, tscCapable = false) {
  // operation_type is an app-only field encoded in the preset name + metadata.
  // It must never be written into the Fusion JSON (Fusion validates strictly).
  // stepdown/stepover are pulled out of `rest` so a disabled flag leaves NO
  // leftover numeric key (Fusion omits the key entirely when disabled).
  const { operation_type, stepdown: _sd, stepover: _so, ...rest } = p;
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
  const useStepdown = !!p['use-stepdown'] && sdNum != null && sdNum > 0;
  const useStepover = !!p['use-stepover'] && soNum != null && soNum > 0;
  const presetExpr = { ...(p.expressions || {}) };
  if (!useStepdown) delete presetExpr.tool_stepdown;
  if (!useStepover) delete presetExpr.tool_stepover;
  const out = {
    ...rest,
    guid: p.guid || generateId(),
    description: p.description || '',
    name: p.name || 'Default preset',
    material: { category, query: mat.query || '', 'use-hardness': mat['use-hardness'] || false },
    expressions: presetExpr,
    'ramp-angle': p['ramp-angle'] ?? 2,
    'tool-coolant': ({ 'flood and through tool': 'flood tool' }[p['tool-coolant']] ?? p['tool-coolant']) || (tscCapable ? 'tool' : 'flood'),
    'use-stepdown': useStepdown,
    'use-stepover': useStepover,
    n: p.n ?? 0,
    n_ramp: p.n_ramp ?? 0,
    v_f: p.v_f ?? 0,
    v_f_leadIn: p.v_f_leadIn ?? 0,
    v_f_leadOut: p.v_f_leadOut ?? 0,
    v_f_plunge: p.v_f_plunge ?? 0,
    v_f_ramp: p.v_f_ramp ?? 0,
    v_f_transition: p.v_f_transition ?? 0,
    f_z: p.f_z ?? 0,
    f_n: p.f_n ?? 0,
    v_c: p.v_c ?? 0,
  };
  // Only emit the numeric keys when the flag is enabled — otherwise omit them so
  // a disabled preset matches Fusion's native "off" shape exactly (no value at all).
  if (useStepdown) out.stepdown = sdNum;
  if (useStepover) out.stepover = soNum;
  return out;
}

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
    'tap form': 'tap right hand',
    'tap cut': 'tap right hand',
    'boring head': 'boring bar',
    'boring bar': 'boring bar',
    'turning general': 'turning general',
  };

  const fusionType = FT_MAP[tool.tool_type] || tool.tool_type;

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
  const outPresets = sourcePresets.map((p, i) => {
    const np = normalizePreset(p, tool.tsc_capable);
    if (i === 0) {
      np.n          = tool.spindle_speed     ?? np.n;
      np.v_f        = tool.cutting_feedrate  ?? np.v_f;
      np.f_z        = tool.feed_per_tooth    ?? np.f_z;
      np.f_n        = tool.feed_per_rev      ?? np.f_n;
      np.v_f_plunge = tool.plunge_feedrate   ?? np.v_f_plunge;
      np.v_f_ramp   = tool.ramp_feedrate     ?? np.v_f_ramp;
      np.v_f_leadIn  = tool.lead_in_feedrate  ?? np.v_f_leadIn;
      np.v_f_leadOut = tool.lead_out_feedrate ?? np.v_f_leadOut;
      np.v_c        = tool.cutting_speed     ?? np.v_c;
    }
    // Regenerate preset-level expression strings to match the final numeric values.
    // Fusion re-derives numeric values from expressions on every load, so a stale
    // expression silently overrides the field we just wrote — the root cause of the
    // "edits not sticking after sync" bug. Regenerate unconditionally here so there
    // is never a mismatch between the stored number and its expression string.
    // normalizePreset already handled tool_stepdown / tool_stepover (deleted when
    // the flag is off), so spread np.expressions first to preserve those.
    //
    // Fusion presets use ONE speed input mode (RPM *or* surface speed) and ONE feed
    // input mode (IPM *or* feed-per-tooth). We update whichever key(s) were already
    // present and add tool_spindleSpeed / tool_feedCutting as defaults when neither
    // mode key exists. Never add tool_feedLeadIn / tool_feedLeadOut — Fusion derives
    // those from v_f and does not expect them as expression inputs.
    const origExprs = np.expressions || {};
    const hasSurfaceSpeed = 'tool_surfaceSpeed' in origExprs;
    const hasSpindleSpeed = 'tool_spindleSpeed'  in origExprs;
    const hasFeedPerTooth = 'tool_feedPerTooth'  in origExprs;
    const hasFeedCutting  = 'tool_feedCutting'   in origExprs;
    np.expressions = {
      ...origExprs,
      // Speed — update existing mode or default to RPM
      ...(hasSpindleSpeed || !hasSurfaceSpeed ? { tool_spindleSpeed: `${np.n ?? 0} rpm` } : {}),
      ...(hasSurfaceSpeed                     ? { tool_surfaceSpeed: `${np.v_c ?? 0} ${speedUnit}` } : {}),
      // Feed — update existing mode or default to cutting feed
      ...(hasFeedCutting  || !hasFeedPerTooth ? { tool_feedCutting:  `${np.v_f ?? 0} ${feedUnit}` } : {}),
      ...(hasFeedPerTooth                     ? { tool_feedPerTooth: `${np.f_z ?? 0} ${fzUnit}` } : {}),
      // tool_feedPlunge / tool_feedRamp / tool_feedTransition are NOT regenerated.
      // Fusion's default presets store these as formula expressions that reference
      // other fields (e.g. "tool_feedCutting/3", "tool_feedPlunge", "tool_feedCutting").
      // Overwriting them with literal numeric strings breaks those dynamic links and
      // causes Fusion to write back wrong computed values on the next load, creating a
      // corrupt-values cycle. Preserve whatever origExprs has for these keys instead.
    };
    return np;
  });

  // Machine tool number drives the post-process fields. When present, all three
  // (number / length-offset / diameter-offset) must be written to the same value,
  // and the expression link must be kept intact. Falls back to the legacy
  // freeform `tool_number` field only when no machine number is assigned.
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
    unit: existing.unit || 'inches',
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
      tool_productId: `'${tool.proshot_id || tool.product_id || ''}'`,
      tool_productLink: `'${tool.product_link || ''}'`,
      tool_shaftDiameter: `${tool.shank_diameter || tool.diameter || 0} ${lenUnit}`,
      tool_shoulderLength: `${tool.shoulder_length || tool.flute_length || 0} ${lenUnit}`,
      tool_vendor: `'${tool.location || ''}'`,
      ...(tool.tracking_id ? { tool_comment: `'${tool.tracking_id}'` } : {}),
      ...(tool.corner_radius ? { tool_cornerRadius: `${tool.corner_radius} ${lenUnit}` } : {}),
      ...(hasMtn
        ? { tool_number: String(mtnInt), tool_lengthOffset: 'tool_number' }
        : (tool.tool_number ? { tool_number: tool.tool_number } : {})),
    },
    geometry: {
      ...(existing.geometry || {}),
      CSP: false,
      DC: tool.diameter || 0,
      HAND: true,
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
      ...(tool.tip_diameter > 0 || (existing.geometry?.['tip-diameter'] > 0) ? { 'tip-diameter': tool.tip_diameter || 0 } : {}),
      // NT, TP, thread-profile-angle, tip-length, tip-offset: never written explicitly;
      // preserved from ...existing if the original Fusion entry had them.
    },
    'start-values': {
      presets: outPresets,
    },
    holder: existing.holder || null,
    'post-process': {
      ...(existing['post-process'] || {}),
      ...(tool.tracking_id ? { comment: tool.tracking_id } : {}),
      ...(hasMtn
        ? { number: mtnInt, 'length-offset': mtnInt, 'diameter-offset': mtnInt }
        : (tool.tool_number ? { number: parseInt(tool.tool_number) || 0 } : {})),
    },
  };
  // Guard: delete any metadata-only internal field names that shouldn't appear in Fusion JSON.
  // Fusion uses its own key names (BMC, DC, NOF, etc.) so this only catches accidental direct
  // copies of internal field names (e.g. if someone wrote fusionObj.vendor = tool.vendor).
  Object.keys(fusionObj).forEach(k => { if (isMetadataOnly(k)) delete fusionObj[k]; });
  return fusionObj;
}

// ─── Merge Fusion tool + metadata into single object ──────────────────────
export function mergeFusionAndMetadata(fusionInternal, meta) {
  if (!meta) return fusionInternal;
  return {
    ...fusionInternal,
    vendor: meta.vendor || fusionInternal.vendor || '',
    product_id: meta.product_id || fusionInternal.product_id || '',
    coating: meta.coating || fusionInternal.coating || '',
    distributor: meta.distributor || '',
    distributor_stock_num: meta.distributor_stock_num || '',
    cost: meta.cost || '',
    tsc_capable: Boolean(meta.tsc_capable),
    center_cutting: meta.center_cutting ?? fusionInternal.center_cutting ?? false,
    cutting_direction: meta.cutting_direction || fusionInternal.cutting_direction || 'Right Hand',
    helix_angle: meta.helix_angle ?? fusionInternal.helix_angle ?? null,
    flute_type: meta.flute_type || '',
    flute_design: meta.flute_design || '',
    tip_angle: meta.tip_angle ?? fusionInternal.tip_angle ?? null,
    tip_diameter: meta.tip_diameter ?? fusionInternal.tip_diameter ?? null,
    lower_radius: meta.lower_radius ?? null,
    upper_radius: meta.upper_radius ?? null,
    profile_radius: meta.profile_radius ?? null,
    axial_distance: meta.axial_distance ?? null,
    pitch: meta.pitch || '',
    tap_class: meta.tap_class || '',
    min_thread_pitch: meta.min_thread_pitch ?? null,
    max_thread_pitch: meta.max_thread_pitch ?? null,
    point_type: meta.point_type || '',
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
    notes: meta.notes || '',
    last_used_job: meta.last_used_job || '',
    preferred_machine: meta.preferred_machine || '',
    material_suitability: meta.material_suitability || fusionInternal.material_suitability || [],
    tags: meta.tags || [],
    updated_by: meta.updated_by || '',
    revision_notes: meta.revision_notes || '',
    merge_history: meta.merge_history || [],
    created_at: meta.created_at || fusionInternal.created_at,
    updated_at: meta.updated_at || fusionInternal.updated_at,
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
    product_id: tool.product_id || '',
    coating: tool.coating || '',
    distributor: tool.distributor || '',
    distributor_stock_num: tool.distributor_stock_num || '',
    cost: tool.cost || '',
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
    min_thread_pitch: tool.min_thread_pitch ?? null,
    max_thread_pitch: tool.max_thread_pitch ?? null,
    point_type: tool.point_type || '',
    stub_jobber: tool.stub_jobber || '',
    double_ended: tool.double_ended || false,
    full_profile: tool.full_profile || false,
    backside_capable: tool.backside_capable || false,
    grouping: tool.grouping || '',
    preset_name: tool.preset_name || '',
    // Machine tool number — persisted here as the source of truth, independent
    // of what gets written to the Fusion JSON.
    machine_tool_number: (tool.machine_tool_number ?? null) === null ? null : Number(tool.machine_tool_number),
    // Holder selection + proven assemblies. Each assembly carries instance_guid
    // (the Fusion entry it maps to); supplementary notes live here.
    selected_holder_guid: tool.selected_holder_guid || null,
    assemblies: (tool.assemblies || []).map(a => ({
      assembly_id: a.assembly_id || generateAssemblyId(),
      instance_guid: a.instance_guid || null,
      holder_guid: a.holder_guid || null,
      holder_description: a.holder_description || '',
      ooh: a.ooh ?? null,
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
      base.holder = holder ? buildHolderObject(holder) : (raw.holder || null);
    } else {
      base.holder = raw.holder || null;
    }

    // Per-instance OOH → geometry.LB (the documented OOH source of truth).
    // ALSO update expressions.tool_bodyLength — Fusion re-derives LB from this
    // expression on every library load, silently overriding the numeric field if
    // the two don't match. Both must be updated together.
    if (a.ooh != null && a.ooh !== '' && !isNaN(Number(a.ooh))) {
      const lb = isMetric ? Number(a.ooh) * 25.4 : Number(a.ooh);
      base.geometry = { ...(base.geometry || {}), LB: lb };
      base.expressions = { ...(base.expressions || {}), tool_bodyLength: `${lb} ${isMetric ? 'mm' : 'in'}` };
    }

    // Recompute assemblyGaugeLength (geometry.assemblyGaugeLength) from the
    // holder's gauge length and the per-instance OOH. Previous bad writes may
    // have stored a stale value derived from an incorrect holder gaugeLength —
    // always recompute so it stays consistent with what we just wrote.
    if (base.holder && typeof base.holder.gaugeLength === 'number' && a.ooh != null && !isNaN(Number(a.ooh))) {
      const holderGaugeLengthIn = (base.holder.unit === 'millimeters')
        ? base.holder.gaugeLength / 25.4
        : base.holder.gaugeLength;
      const assemblyGaugeLength = holderGaugeLengthIn + Number(a.ooh);
      base.geometry = { ...(base.geometry || {}), assemblyGaugeLength };
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
export function newTool(toolType = 'flat end mill') {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    tool_type: toolType,
    unit: 'inches',
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
    material: 'carbide',
    coating: '',
    material_suitability: [],
    helix_angle: null,
    center_cutting: false,
    flute_type: '',
    flute_design: '',
    tsc_capable: false,
    cutting_direction: 'Right Hand',
    pitch: '',
    tap_class: '',
    min_thread_pitch: null,
    max_thread_pitch: null,
    point_type: '',
    stub_jobber: '',
    double_ended: false,
    full_profile: false,
    backside_capable: false,
    vendor: '',
    distributor: '',
    product_id: '',
    distributor_stock_num: '',
    cost: '',
    product_link: '',
    preset_name: '',
    tool_number: '',
    grouping: '',
    proshot_id: '',
    location: '',
    machine_tool_number: null,
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

  function fmt(n) {
    return n.toFixed(4).replace(/\.?0+$/, '') + '"';
  }

  const { flute_length, shoulder_length, min_ooh, overall_length, corner_radius, diameter, tool_type } = tool;

  // flute_length / shoulder_length / overall_length are in the tool's native unit;
  // min_ooh is inches-canonical — convert it to native so the chain compares in one unit.
  const minOohNative = isValid(min_ooh) ? inchesToNative(min_ooh, tool.unit) : min_ooh;

  if (isValid(flute_length) && isValid(shoulder_length) && flute_length > shoulder_length) {
    warnings.push({
      fields: ['flute_length', 'shoulder_length'],
      message: `Flute Length (${fmt(flute_length)}) must be less than or equal to Shoulder Length (${fmt(shoulder_length)})`,
    });
  }

  if (isValid(shoulder_length) && isValid(minOohNative) && shoulder_length > minOohNative) {
    warnings.push({
      fields: ['shoulder_length', 'min_ooh'],
      message: `Shoulder Length (${fmt(shoulder_length)}) must be less than or equal to MIN OOH (${fmt(minOohNative)})`,
    });
  }

  if (isValid(minOohNative) && isValid(overall_length) && minOohNative > overall_length) {
    warnings.push({
      fields: ['min_ooh', 'overall_length'],
      message: `MIN OOH (${fmt(minOohNative)}) must be less than or equal to Overall Length (${fmt(overall_length)})`,
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
// Source of truth for labels has moved to src/schema/fieldRegistry.js (FIELD_REGISTRY[field].label).
// Keep this map in sync when adding or renaming fields, but add new fields to the registry first.
export const FIELD_LABELS = {
  tool_type: 'Tool Type',
  description: 'Description',
  vendor: 'Manufacturer',
  product_id: 'Mfr Part # (EDP)',
  proshot_id: 'ProShop ID',
  distributor: 'Distributor',
  distributor_stock_num: 'Distributor Stock #',
  diameter: 'Diameter (in)',
  flute_length: 'Flute Length (in)',
  overall_length: 'Overall Length (in)',
  number_of_flutes: '# Flutes',
  shank_diameter: 'Shank Diameter (in)',
  corner_radius: 'Corner Radius (in)',
  shoulder_length: 'Shoulder Length (in)',
  tip_angle: 'Tip Angle (°)',
  taper_angle: 'Taper Angle (°)',
  tip_diameter: 'Tip Diameter (in)',
  material: 'Tool Material',
  coating: 'Coating',
  material_suitability: 'Material Suitability',
  tsc_capable: 'TSC Capable',
  flute_design: 'Flute Design',
  helix_angle: 'Helix Angle (°)',
  flute_type: 'Flute Type',
  center_cutting: 'Center Cutting',
  cutting_direction: 'Cutting Direction',
  spindle_speed: 'Spindle Speed (RPM)',
  cutting_feedrate: 'Cutting Feedrate (in/min)',
  feed_per_tooth: 'Feed per Tooth (in)',
  feed_per_rev: 'Feed per Rev (in)',
  plunge_feedrate: 'Plunge Feedrate (in/min)',
  ramp_feedrate: 'Ramp Feedrate (in/min)',
  lead_in_feedrate: 'Lead-In Feedrate (in/min)',
  lead_out_feedrate: 'Lead-Out Feedrate (in/min)',
  cutting_speed: 'Surface Speed (SFM)',
  depth_of_cut: 'Depth of Cut (in)',
  width_of_cut: 'Width of Cut (in)',
  preferred_machine: 'Preferred Machine',
  cost: 'Cost ($)',
  product_link: 'Product Link',
  location: 'Location (Cabinet)',
  notes: 'Notes',
  tags: 'Tags',
  last_used_job: 'Last Used Job',
  revision_notes: 'Revision Notes',
  updated_by: 'Updated By',
  created_at: 'Created',
  updated_at: 'Last Updated',
  pitch: 'Thread Pitch',
  tap_class: 'Tap Class',
  min_thread_pitch: 'Min Thread Pitch',
  max_thread_pitch: 'Max Thread Pitch',
  point_type: 'Point Type',
  stub_jobber: 'Stub/Jobber',
  double_ended: 'Double Ended',
  full_profile: 'Full Profile',
  backside_capable: 'Backside Capable',
  lower_radius: 'Lower Radius (in)',
  upper_radius: 'Upper Radius (in)',
  profile_radius: 'Profile Radius (in)',
  axial_distance: 'Axial Distance (in)',
  grouping: 'ProShop Group',
  tool_number: 'Tool Number',
  machine_tool_number: 'Machine Tool #',
  preset_name: 'Preset Name',
};
