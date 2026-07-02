import {
  TT, TL, BLANK, FIELD_VISIBILITY, _FV_KEYS,
  MA, CO, WM,
  PS_GROUPS, AUTO_GROUP, typeFromProShopGroup, COOLANT_OPTS, THROUGH_COOLANT_VALUES,
  getVisibleFields,
} from '../../tool-extractor.tsx';
import { isMetadataOnly, FIELD_REGISTRY, fieldLabel } from './fieldRegistry.js';
import { parsePresetName, materialCategory, matchMaterial, HOLE_MAKING_TYPES, TURNING_TYPES } from '../utils/presetNaming.js';
import { convertLength, unitAbbr, getDefaultUnit } from '../utils/units.js';

export { TT, TL, MA, CO, WM, PS_GROUPS, AUTO_GROUP, typeFromProShopGroup, COOLANT_OPTS };

// ─── Icons ─────────────────────────────────────────────────────────────────
// Tool-type icons are rendered by the <ToolTypeIcon> component
// (src/components/icons/ToolTypeIcon.jsx) as solid-silhouette SVGs.

export const TOOL_TYPES = TT;
export const TOOL_TYPE_LABELS = TL;

// ─── Facet fields per tool type (search filter order) ─────────────────────
const COMMON_FACETS = ['diameter', 'number_of_flutes', 'flute_length', 'overall_length', 'material', 'coating', 'vendor', 'tsc_capable', 'custom_grind', 'flute_design', 'material_suitability', 'tags', 'no_fusion_link'];

// toolTypes: array of selected tool types (0, 1, or many). With multiple types
// selected, the extra per-type facets are unioned so e.g. picking "bull nose
// end mill" + "flat end mill" still surfaces Corner Radius.
export function getFacetFields(toolTypes) {
  const types = Array.isArray(toolTypes) ? toolTypes : (toolTypes ? [toolTypes] : []);
  if (types.length === 0) return COMMON_FACETS;
  const extras = [];
  const addExtra = (f) => { if (!extras.includes(f)) extras.push(f); };
  for (const toolType of types) {
    if (toolType === 'bull nose end mill' || toolType === 'radius mill' || toolType === 'lollipop mill') {
      addExtra('corner_radius');
    }
    if (toolType === 'tap') {
      ['tap_sub_type', 'is_sti', 'pitch', 'tap_thread_unit', 'cutting_direction', 'tap_class', 'class_of_fit'].forEach(addExtra);
    } else if (toolType === 'thread mill') {
      ['pitch', 'tap_thread_unit', 'cutting_direction'].forEach(addExtra);
    }
    if (toolType === 'drill' || toolType === 'spot drill' || toolType === 'center drill') {
      addExtra('tip_angle');
    }
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
    psToolId: 'tool_id',
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
    tap_sub_type: f.tapSubType || '',   // no default — cut/form must be set explicitly (form taps differ)
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
    tool_id: f.psToolId || '',
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
    customGrind: tool.custom_grind || false,
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
    psToolId: tool.tool_id || '',
    // ProShop Location column. A structured-location tool carries a
    // `proshop_location` resolved per its system's export rule (number_only /
    // full / fixed); legacy free-text tools fall back to the raw location.
    location: tool.proshop_location != null ? tool.proshop_location : (tool.location || ''),
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
  const pid = String(tool.tool_id || tool['product-id'] || '').trim();
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
// The ProShop number (Fusion's `product-id`, our `tool_id`) is the
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

  // ── Gap-fill + conflict detect ──────────────────────────────────────────────
  // Start from primary's scalar values. For every other tool in the group:
  //   - If the current (primary or previously gap-filled) value is empty and
  //     the other tool has a non-empty value → take it (gap-fill).
  //   - If both are non-empty primitive values that differ → record a conflict.
  // The unioned arrays and per-instance / transient / audit fields are excluded.
  const SKIP_KEYS = new Set([
    'id', 'tracking_id', 'machine_tool_number', 'no_fusion_link',
    'assemblies', 'presets', 'merge_history',
    '_instancesRaw', '_fusionRaw', '_registeredAssemblies', '_combineConflicts',
    'ooh', 'selected_holder_guid',
    'created_at', 'updated_at', 'updated_by', 'revision_notes',
  ]);
  const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);
  const scalarConflict = (a, b) => {
    if (typeof a === 'number' && typeof b === 'number') return round4(a) !== round4(b);
    if (typeof a === 'string' && typeof b === 'string') return a.trim() !== b.trim();
    return a !== b;
  };

  const merged = { ...primary };
  const combineConflicts = [];
  const allKeys = new Set(group.flatMap(t => Object.keys(t)));

  for (const key of allKeys) {
    if (SKIP_KEYS.has(key) || key.startsWith('_')) continue;
    for (const other of ordered.slice(1)) {
      const curVal = merged[key];
      const otherVal = other[key];
      if (isEmpty(curVal) && !isEmpty(otherVal)) {
        merged[key] = otherVal;                                  // gap-fill
      } else if (
        !isEmpty(curVal) && !isEmpty(otherVal) &&
        (typeof curVal === 'string' || typeof curVal === 'number' || typeof curVal === 'boolean') &&
        (typeof otherVal === 'string' || typeof otherVal === 'number' || typeof otherVal === 'boolean') &&
        scalarConflict(curVal, otherVal) &&
        !combineConflicts.some(c => c.field === key)            // one entry per field
      ) {
        combineConflicts.push({
          field: key,
          values: [curVal, otherVal],
          guids: [
            primary._fusionRaw?.guid || primary.id,
            other._fusionRaw?.guid || other.id,
          ],
        });
      }
    }
  }

  // no_fusion_link: clear the flag if any tool in the group is a real Fusion entry.
  const no_fusion_link = group.every(t => t.no_fusion_link) ? true : false;

  return {
    ...merged,
    no_fusion_link,
    machine_tool_number: machine,
    assemblies,
    presets,
    merge_history: mergeHistory,
    _instancesRaw: raws,
    _fusionRaw: primary._fusionRaw || raws[0] || null,
    _registeredAssemblies: registered,
    ...(combineConflicts.length > 0 ? { _combineConflicts: combineConflicts } : {}),
  };
}

export function combineToolsByToolId(tools) {
  const groups = new Map();   // key -> [tool, ...]
  const order = [];           // preserve first-seen order
  let anon = 0;
  for (const tool of (tools || [])) {
    const pid = String(tool.tool_id || '').trim();
    const key = pid ? `pid:${pid}` : `anon:${anon++}`;
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key).push(tool);
  }
  return order.map(key => {
    const group = groups.get(key);
    return group.length === 1 ? group[0] : mergeLogicalTools(group);
  });
}

// Combined tools that are actually MORE THAN ONE Fusion tracking-ID group folded
// together because they share a tool_id (usually a duplicate from human error in
// the legacy/Fusion data). These are the tools a bulk re-number would split into
// separate IDs (it works per tracking group), so the UI surfaces them for an
// explicit merge-to-one-ID vs split decision. Each cluster's tool_id is unique
// (the combine already folded same-id tools into one). Returns
// [{ tool_id, description, count }] where count = distinct tracking IDs folded.
export function duplicateIdClusters(tools) {
  const out = [];
  for (const t of (tools || [])) {
    const tids = new Set();
    for (const r of (t._instancesRaw || [])) {
      const tid = readTrackingId(r);
      if (tid) tids.add(tid);
    }
    if (tids.size > 1) out.push({ tool_id: t.tool_id, description: t.description, count: tids.size });
  }
  return out;
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
// `start`/`skip` default to these but can be overridden from shop_settings.json.
export const RESERVED_MACHINE_NUMBERS = [98, 99, 100];
const DEFAULT_MACHINE_START = 30;

// Generate a full sequence of machine tool numbers for a renumber/import.
// Starts at `start`, increments by 1, skips the `skip` numbers entirely.
// e.g. 250 tools → [30, 31, ..., 97, 101, 102, ...]
export function generateMachineNumbers(toolCount, start = DEFAULT_MACHINE_START, skip = RESERVED_MACHINE_NUMBERS) {
  const skipSet = new Set(skip);
  const numbers = [];
  let next = start;
  while (numbers.length < toolCount) {
    if (!skipSet.has(next)) numbers.push(next);
    next++;
  }
  return numbers;
}

// Find the next available machine tool number given the numbers already in use.
// Skips both used numbers and the `skip` set.
export function getNextMachineNumber(existingNumbers, start = DEFAULT_MACHINE_START, skip = RESERVED_MACHINE_NUMBERS) {
  const used = new Set((existingNumbers || []).map(Number).filter(n => !isNaN(n)));
  const skipSet = new Set(skip);
  let next = start;
  while (used.has(next) || skipSet.has(next)) next++;
  return next;
}

// Write a machine tool number into a raw Fusion tool object. Always writes all
// three post-process fields (number / length-offset / diameter-offset) to the
// same value, and always writes the linked expression so Fusion's UI keeps the
// length offset tied to the tool number. Mutates and returns the object.
// Write a tool ID (ProShop number / generated shop ID) directly into a raw
// Fusion entry — the native `product-id` plus its paired expression. Mirrors
// the native+expression pairing internalToFusionTool uses for tool_productId.
// Used by the bulk "Assign IDs" action, which mutates raws in place.
export function applyToolIdToFusion(fTool, value) {
  const v = String(value ?? '');
  fTool['product-id'] = v;
  fTool.expressions = { ...(fTool.expressions || {}), tool_productId: `'${v}'` };
  return fTool;
}

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

// Loose numeric equality for "did this value actually change" checks when syncing
// expression strings. The tolerance absorbs Fusion's float noise (it stores e.g.
// v_c = 650.0000208 with the expression "650 fpm") without masking real edits.
function approxEqual(a, b) {
  return Math.abs(a - b) <= Math.max(1e-9, 1e-6 * Math.max(Math.abs(a), Math.abs(b)));
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
    tip_diameter: geo['tip-diameter'] || null,
    thread_pitch: geo.TP || null,
    shoulder_length: geo['shoulder-length'] || null,
    material: fTool.BMC || 'carbide',
    tool_id: fTool['product-id'] || stripQuotes(expr.tool_productId) || '',
    product_link: fTool['product-link'] || stripQuotes(expr.tool_productLink) || '',
    // Fusion re-derives the root `vendor` from expressions.tool_vendor, but some
    // entries carry the cabinet location only in the root field — fall back to it
    // so the location isn't silently erased on the next write.
    location: stripQuotes(expr.tool_vendor) || fTool.vendor || '',
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

  // Strip step flags from non-milling presets (native Fusion never writes them
  // there, and a flag with no numeric/expression triggers the three-way-sync
  // bug), and ramp fields from hole-making/spot-drill presets (no ramp moves).
  // Everything else an incoming Fusion preset carries is PRESERVED — real
  // Fusion exports for taps/drills frequently include the full milling-style
  // feed set (v_f, f_z, lead-in/out, plunge, retract, use-feed-per-revolution)
  // whenever values were entered, and deleting them discards proven data.
  // The per-category branches below only govern which fields the app *seeds*.
  if (isHoleMaking || isTurning || isSpotDrill) {
    delete rest['use-stepdown'];
    delete rest['use-stepover'];
  }
  if (isHoleMaking || isSpotDrill) {
    delete rest['ramp-angle'];
    delete rest.n_ramp;
  }
  if (isTap || isSpotDrill) {
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

  // Base fields present for every tool category. `description` is only written
  // when the source preset has one — Fusion omits it on many native presets.
  const out = {
    ...rest,
    guid: p.guid || generateId(),
    ...(p.description != null ? { description: p.description } : {}),
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
    // Turning/boring: cutting feed + feed-per-rev + plunge; no step fields.
    // Each only when the source has it — native turning presets vary (turning
    // general omits v_f/v_f_plunge and n_ramp; boring bar omits n_ramp).
    if (p.n_ramp != null) out.n_ramp = p.n_ramp;
    if (p.v_f != null) out.v_f = p.v_f;
    if (p.f_n != null) out.f_n = p.f_n;
    if (p.v_f_plunge != null) out.v_f_plunge = p.v_f_plunge;
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
    // Drills/reamers: plunge + retract feedrates and the feed-per-revolution
    // flag. f_n (and plunge/retract) only when the source carries them — native
    // drill presets almost never store f_n, so injecting f_n: 0 adds a field
    // Fusion never wrote for the type.
    if (p.v_f_plunge != null) out.v_f_plunge = p.v_f_plunge;
    if (p['v_f_retract'] != null) out['v_f_retract'] = p['v_f_retract'];
    if (p.f_n != null) out.f_n = p.f_n;
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

// Fusion types that natively carry geometry['shoulder-diameter'] (FUSION_SCHEMA
// §1d). Used only to seed the field on NEW tools — for existing entries the
// original value is preserved untouched (it is real data: reduced-shank tools
// and thread mills store a shoulder diameter that differs from the shank).
const SHOULDER_DIAMETER_TYPES = new Set([
  'flat end mill', 'ball end mill', 'bull nose end mill', 'chamfer mill',
  'radius mill', 'tapered mill', 'dovetail mill', 'lollipop mill', 'slot mill',
  'thread mill', 'face mill',
  'circle segment barrel', 'circle segment lens', 'circle segment taper',
]);

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

// Normalize a thread designation to a comparison key so ProShop's bare strings
// match our canonical list. Lowercases, drops the UN-series suffix (UNC/UNF/UNEF/
// UNS/UN — implied for inch threads, which is why ProShop omits it), and strips
// '#' and spaces. NPT/NPTF are intentionally NOT stripped (pipe threads change
// the form and are always spelled out). E.g. "5/16-24 UNF", "5/16-24", and
// "#10-32 UNF" vs "10-32" all collapse to a stable key.
export function threadKey(s) {
  return (s || '')
    .toLowerCase()
    .trim()
    .replace(/\bun[cfse]*\b/g, '')   // unc / unf / unef / uns / un
    .replace(/[#\s]/g, '');
}

// Resolve a raw ProShop "Thread" value to our internal thread fields. ProShop
// stores the bare designation ("5/16-24") with no UN-series suffix, and encodes
// STI/Helicoil taps by appending "STI" to the same field ("5/16-24 STI"). This
// maps that to our canonical "5/16-24 UNF", flags STI, and detects inch vs metric.
//   → { pitch, is_sti, thread_unit }   (thread_unit: 'inch' | 'metric' | '')
export function resolveThreadSize(raw) {
  const s0 = (raw || '').trim();
  if (!s0) return { pitch: '', is_sti: false, thread_unit: '' };

  // STI / Helicoil is carried as a token in the same field — pull it out and
  // resolve against the PARENT thread (the oversized tap size is not stored).
  const is_sti = /\bsti\b/i.test(s0) || /\bhelicoil\b/i.test(s0);
  const cleaned = s0.replace(/\bsti\b/ig, '').replace(/\bhelicoil\b/ig, '').replace(/\s+/g, ' ').trim();

  const metric = /^m\s*\d/i.test(cleaned);
  const thread_unit = metric ? 'metric' : 'inch';
  const list = (metric ? METRIC_THREAD_SIZES : INCH_THREAD_SIZES).filter(x => x !== 'Custom...');

  const key = threadKey(cleaned);
  const canonical = list.find(x => threadKey(x) === key);
  return { pitch: canonical || cleaned, is_sti, thread_unit };
}

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

  // Original raw presets by guid — lets the expression sync below detect whether
  // a numeric actually changed (vs. just round-tripping) so unchanged expression
  // strings (including formulas and native formats) are preserved byte-for-byte.
  const existingPresetByGuid = new Map(
    (existing['start-values']?.presets || []).map(rp => [rp.guid, rp])
  );

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

    // Preset expression strings. Fusion re-derives every numeric from its paired
    // expression on load, so a stale expression silently overrides the number —
    // and an *injected* expression overrides a real stored value just the same.
    // Native Fusion presets frequently store numerics with NO expression at all
    // (the numeric stands alone), so the rules are:
    //   • BLANK presets (app-created, no values yet): seed Fusion's default
    //     formula set so a new tool is immediately usable.
    //   • Existing presets: never ADD an expression key. For keys that exist,
    //     keep the original string byte-for-byte when the paired numeric is
    //     unchanged (preserves formulas like "tool_feedCutting/3" and native
    //     formats), and rewrite a literal only when the value actually changed.
    if (isBlankPreset) {
      // Fusion's universal spindle-speed formula (handles probe/tap/all other types).
      const SPINDLE_FORMULA = "tool_type == 'probe' ? 0 : tool_type == 'tap right hand' || tool_type == 'tap left hand' ? 500rpm : 5000rpm";
      // Surface-speed companion formula (always evaluated by Fusion alongside RPM).
      const SURFACE_FORMULA = 'tool_diameter * Math.PI * tool_spindleSpeed';
      np.expressions = {
        ...origExprs,
        tool_spindleSpeed: SPINDLE_FORMULA,
        tool_surfaceSpeed: SURFACE_FORMULA,
        ...((isMillingTool || isSpotDrillTool) ? {
          tool_feedCutting: `${np.v_f ?? 0} ${feedUnit}`,
          tool_feedPerTooth: 'tool_spindleSpeed > 0 ? tool_feedCutting/(tool_spindleSpeed * tool_numberOfFlutes) : 0.0',
          tool_feedRamp: 'tool_feedPlunge',
          tool_feedTransition: 'tool_feedCutting',
        } : {}),
        ...(!isTapTool
          ? { tool_feedPlunge: "(tool_type=='drill' || tool_type=='reamer' || tool_isDepositing)?(40inpm):(tool_feedCutting/3)" } : {}),
        ...(isDrillFamilyTool ? {
          tool_feedRetract: 'tool_feedPlunge',
          tool_feedPerRevolution: 'tool_spindleSpeed > 0 ? tool_feedPlunge/tool_spindleSpeed : 0.0',
          tool_feedRetractPerRevolution: 'tool_feedPerRevolution',
        } : {}),
      };
    } else {
      // Original raw preset (pre-edit values) — the reference for "did it change".
      const rawP = existingPresetByGuid.get(np.guid);
      const ex = { ...origExprs };
      // [expression key, preset numeric field, unit suffix]
      const PRESET_EXPR_PAIRS = [
        ['tool_spindleSpeed', 'n', 'rpm'],
        ['tool_rampSpindleSpeed', 'n_ramp', 'rpm'],
        ['tool_surfaceSpeed', 'v_c', speedUnit],
        ['tool_feedCutting', 'v_f', feedUnit],
        ['tool_feedPerTooth', 'f_z', fzUnit],
        ['tool_feedPlunge', 'v_f_plunge', feedUnit],
        ['tool_feedRamp', 'v_f_ramp', feedUnit],
        ['tool_feedTransition', 'v_f_transition', feedUnit],
        ['tool_feedRetract', 'v_f_retract', feedUnit],
        ['tool_feedEntry', 'v_f_leadIn', feedUnit],
        ['tool_feedExit', 'v_f_leadOut', feedUnit],
        ['tool_feedPerRevolution', 'f_n', fzUnit],
      ];
      for (const [key, field, unit] of PRESET_EXPR_PAIRS) {
        if (!(key in ex)) continue;                 // never add keys to an existing preset
        const oldVal = rawP ? rawP[field] : undefined;
        const newVal = np[field];
        // Unchanged → keep the original string. "Both absent" is also unchanged:
        // some native presets carry ONLY the expression (Fusion derives the
        // numeric from it) — e.g. drill feed-per-rev — and rewriting it from a
        // missing numeric would zero out the real value.
        if (oldVal == null && newVal == null) continue;
        if (oldVal != null && newVal != null && approxEqual(newVal, oldVal)) continue;
        ex[key] = `${newVal ?? 0} ${unit}`;
      }
      np.expressions = ex;
      // Native presets without an expressions object stay that way — an empty
      // object we created ourselves carries no information.
      if (Object.keys(ex).length === 0 && !(rawP && rawP.expressions)) delete np.expressions;
    }
    return np;
  });

  // Machine tool number drives the post-process fields. When present, all three
  // (number / length-offset / diameter-offset) must be written to the same value,
  // and the expression link must be kept intact. When no number is assigned, the
  // post-process number / expression are simply left unwritten.
  const mtn = tool.machine_tool_number;
  const hasMtn = mtn !== null && mtn !== undefined && mtn !== '' && !isNaN(parseInt(mtn));
  const mtnInt = hasMtn ? parseInt(mtn) : null;

  const hasExisting = Object.keys(existing).length > 0;
  const isTurningGeneralTool = fusionType === 'turning general';

  // ── Tool-level expression sync ──
  // Fusion re-derives every numeric/string field from its paired expression on
  // load, so present keys must always agree with the natives we write. But many
  // native entries simply OMIT an expression (the field stands alone) — adding
  // one (especially "''" or "0 in") changes the entry's shape and, for fields
  // the type doesn't use, invites Fusion's per-type validation flags. Rules:
  //   • existing tools: sync keys that are present (keeping the original string
  //     byte-for-byte when the value is unchanged — preserves formulas like
  //     "(.8/25.4) in" and native formats); ADD a key only when the value
  //     actually changed in the app (so the new pair is written together).
  //   • new tools (no existing entry): write the standard set, as before.
  const exTool = { ...(existing.expressions || {}) };
  const syncStrExpr = (key, val, oldVal) => {
    const v = val || '';
    if (!(key in exTool)) {
      if (!hasExisting || v !== (oldVal || '')) exTool[key] = `'${v}'`;
      return;
    }
    if (stripQuotes(exTool[key]) !== v) exTool[key] = `'${v}'`;
  };
  // addNew: 'always' | 'ifSet' | 'never' — what to do for a NEW tool (no existing
  // entry). For existing tools the key is added only when the value changed.
  const syncNumExpr = (key, val, oldVal, unit, addNew = 'always') => {
    const unchanged = (oldVal != null && val != null && approxEqual(val, oldVal))
      || ((oldVal == null || oldVal === 0) && (val == null || val === 0));
    const literal = `${val || 0}${unit ? ` ${unit}` : ''}`;
    if (!(key in exTool)) {
      if (!hasExisting) {
        if (addNew === 'always' || (addNew === 'ifSet' && val > 0)) exTool[key] = literal;
      } else if (!unchanged && addNew !== 'never') {
        exTool[key] = literal;
      }
      return;
    }
    if (!unchanged) exTool[key] = literal;
  };
  const exGeo = existing.geometry || {};
  syncStrExpr('tool_description', tool.description, existing.description);
  syncStrExpr('tool_material', tool.material || 'carbide', existing.BMC);
  syncStrExpr('tool_productId', tool.tool_id, existing['product-id']);
  syncStrExpr('tool_productLink', tool.product_link, existing['product-link']);
  syncStrExpr('tool_vendor', tool.location,
    existing.expressions?.tool_vendor != null ? stripQuotes(existing.expressions.tool_vendor) : existing.vendor);
  syncNumExpr('tool_diameter', tool.diameter, exGeo.DC, lenUnit);
  syncNumExpr('tool_fluteLength', tool.flute_length, exGeo.LCF, lenUnit);
  syncNumExpr('tool_overallLength', tool.overall_length, exGeo.OAL, lenUnit);
  // Shaft diameter / shoulder length expressions mirror what the geometry block
  // below actually writes: nothing when the tool has no SFDM/shoulder-length
  // (circle segments, most form mills) — so no expression is added either.
  syncNumExpr('tool_shaftDiameter',
    (tool.shank_diameter != null || !hasExisting) ? (tool.shank_diameter ?? tool.diameter) : null,
    exGeo.SFDM, lenUnit);
  syncNumExpr('tool_shoulderLength',
    (tool.shoulder_length != null || !hasExisting) ? (tool.shoulder_length ?? tool.flute_length) : null,
    exGeo['shoulder-length'], lenUnit);
  syncNumExpr('tool_cornerRadius', tool.corner_radius, exGeo.RE, lenUnit, 'ifSet');
  if (THREAD_PITCH_TYPES.has(tool.tool_type)) {
    syncNumExpr('tool_threadPitch', tool.thread_pitch, exGeo.TP, lenUnit, 'ifSet');
  }
  // Expression-only pairs the app never seeds (sync when present so an edited
  // value can't be reverted by a stale string; never added otherwise).
  syncNumExpr('tool_tipAngle', tool.tip_angle, exGeo.SIG, 'degrees', 'never');
  syncNumExpr('tool_taperAngle', tool.taper_angle, exGeo.TA, 'degrees', 'never');
  syncNumExpr('tool_tipDiameter', tool.tip_diameter, exGeo['tip-diameter'], lenUnit, 'never');
  syncNumExpr('tool_numberOfFlutes', tool.number_of_flutes, exGeo.NOF, '', 'never');
  if (tool.tracking_id) exTool.tool_comment = `'${tool.tracking_id}'`;
  if (hasMtn) {
    // Offsets follow the machine tool number (app policy). Preserve the existing
    // strings when the number is unchanged; rewrite the linked pair otherwise.
    const numChanged = parseInt(existing['post-process']?.number) !== mtnInt;
    const exprStale = 'tool_number' in exTool && stripQuotes(exTool.tool_number) !== String(mtnInt);
    if (!hasExisting || numChanged || exprStale) {
      exTool.tool_number = String(mtnInt);
      exTool.tool_lengthOffset = 'tool_number';
    }
  }

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
    'product-id': tool.tool_id || '',
    'product-link': tool.product_link || '',
    expressions: exTool,
    geometry: {
      ...(existing.geometry || {}),
      // Turning tools use an entirely different (insert) geometry set — never
      // force the mill core fields onto them; Fusion flags fields a type doesn't
      // use. Their native geometry survives via the spread above.
      ...(isTurningGeneralTool ? {} : {
      CSP: false,
      DC: tool.diameter || 0,
      // HAND from cutting_direction (true = right hand) — never hardcode true, or
      // left-hand tools silently flip to right-hand on every write. Taps carry
      // handedness in the type string (tap left/right hand) and most native tap
      // entries omit HAND entirely — only sync it when the entry already has it.
      ...(fusionType.startsWith('tap ') && existing.geometry?.HAND === undefined
        ? {} : { HAND: tool.cutting_direction !== 'Left Hand' }),
      LCF: tool.flute_length || 0,
      NOF: tool.number_of_flutes || 0,
      OAL: tool.overall_length || 0,
      // SFDM / shoulder-length only when the tool actually has them — several
      // types (circle segments, most form mills) natively omit them, and writing
      // a defaulted value adds a field Fusion never wrote for that entry.
      ...(tool.shank_diameter != null || !hasExisting
        ? { SFDM: tool.shank_diameter ?? tool.diameter ?? 0 } : {}),
      ...(tool.shoulder_length != null || !hasExisting
        ? { 'shoulder-length': tool.shoulder_length ?? tool.flute_length ?? 0 } : {}),
      // shoulder-diameter is real data (reduced-shank tools, thread-mill minor
      // diameters differ from the shank) — preserved from ...existing, never
      // overwritten. Seeded from the shank only for NEW tools of the mill
      // types that natively carry it (per the FUSION_SCHEMA §1d matrix).
      ...(!hasExisting && SHOULDER_DIAMETER_TYPES.has(fusionType)
        ? { 'shoulder-diameter': tool.shank_diameter ?? tool.diameter ?? 0 } : {}),
      }),
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
      ...(existing['start-values'] || {}),
      presets: outPresets,
    },
    ...(existing.holder ? { holder: existing.holder } : {}),
    'post-process': {
      ...(existing['post-process'] || {}),
      ...(tool.tracking_id ? { comment: tool.tracking_id } : {}),
      // Offsets follow the machine tool number (app policy) — but only touch the
      // offset keys the entry actually uses (one native variant stores
      // compensation-offset instead of diameter-offset; don't add the others).
      ...(hasMtn ? {
        number: mtnInt,
        ...(existing['post-process']?.['length-offset'] != null || !hasExisting
          ? { 'length-offset': mtnInt } : {}),
        ...(existing['post-process']?.['diameter-offset'] != null || !hasExisting
          ? { 'diameter-offset': mtnInt } : {}),
      } : {}),
    },
  };
  // tool_inclusiveAngle is a chamfer-mill-only Fusion expression = 2 × geometry.TA
  // (the "Included/Inclusive Tip Angle" shown for chamfer mills — see
  // INCLUSIVE_ANGLE_TYPES in fieldRegistry.js). Write it alongside TA, same
  // condition as the TA write above; absent (not empty) for every other type —
  // same "write native + expression together, delete when not applicable"
  // pattern as the holder expression fields.
  // Most native chamfer-mill exports do NOT carry the key, so it is only added
  // when the included angle is new/changed (or the entry already has it) —
  // never injected onto an unchanged tool.
  if (tool.tool_type === 'chamfer mill' && (tool.taper_angle > 0 || existing.geometry?.TA > 0)) {
    const taUnchanged = existing.geometry?.TA != null && tool.taper_angle != null
      && approxEqual(tool.taper_angle, existing.geometry.TA);
    if ('tool_inclusiveAngle' in fusionObj.expressions || !taUnchanged || !hasExisting) {
      fusionObj.expressions.tool_inclusiveAngle = `${(tool.taper_angle || 0) * 2} degrees`;
    }
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
    // tool_id is metadata-owned (the TMS manages it); metadata wins, falling back
    // to Fusion's product-id only for tools that predate the TMS assigning an ID.
    tool_id: meta.tool_id || fusionInternal.tool_id,
    vendor: meta.vendor || '',
    coating: meta.coating || '',
    purchasing: meta.purchasing || { manufacturers: [], vendors: [] },
    tsc_capable: Boolean(meta.tsc_capable),
    custom_grind: Boolean(meta.custom_grind),
    center_cutting: meta.center_cutting ?? false,
    // cutting_direction is Fusion-native (geometry.HAND); Fusion wins, metadata fallback.
    cutting_direction: fusionInternal.cutting_direction || meta.cutting_direction || 'Right Hand',
    helix_angle: meta.helix_angle ?? fusionInternal.helix_angle ?? null,
    flute_type: meta.flute_type || '',
    flute_design: meta.flute_design || '',
    // tip_angle is now Fusion-native (geometry.SIG); Fusion wins, metadata is a
    // transition-only fallback for tools whose Fusion entry lacks SIG.
    tip_angle: fusionInternal.tip_angle ?? meta.tip_angle ?? null,
    // tip_diameter is Fusion-native (geometry.tip-diameter); Fusion wins, metadata
    // is a transition-only fallback — same pattern as tip_angle above.
    tip_diameter: fusionInternal.tip_diameter ?? meta.tip_diameter ?? null,
    lower_radius: meta.lower_radius ?? null,
    upper_radius: meta.upper_radius ?? null,
    profile_radius: meta.profile_radius ?? null,
    axial_distance: meta.axial_distance ?? null,
    pitch: meta.pitch || '',
    tap_class: meta.tap_class || '',
    // Unified-tap fields — sub-type has NO default (cut vs form must be set
    // explicitly; assuming 'cut' would mis-spec a form tap).
    tap_sub_type: meta.tap_sub_type || '',
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
    // Structured physical location (Location System). References a system + level
    // option ids by UUID; the composed display string (internal `location`) is
    // derived in AppContext from this + location_config, never stored here.
    // null = no structured location (legacy free-text location only).
    tool_location: meta.location || null,
    bin_size_id: meta.bin_size_id || null,
    // Prior free-text location strings retired by normalization (metadata-only).
    legacy_locations: meta.legacy_locations || [],
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
    speed_feed_refs: meta.speed_feed_refs || [],
    tags: meta.tags || [],
    updated_by: meta.updated_by || '',
    revision_notes: meta.revision_notes || '',
    merge_history: meta.merge_history || [],
    created_at: meta.created_at || fusionInternal.created_at,
    updated_at: meta.updated_at || fusionInternal.updated_at,
    primary_photo_id: meta.primary_photo_id || null,
    primary_photo_name: meta.primary_photo_name || null,
    attachments: meta.attachments || [],
    // Previously-assigned tool IDs retired by a bulk re-number (metadata-only).
    legacy_ids: meta.legacy_ids || [],
  };
}

// ─── Build the metadata record for a logical tool ─────────────────────────
// Keyed by tracking_id. Assemblies carry instance_guid (the Fusion entry each
// assembly maps to). preset_meta caches operation_type by preset guid as a
// fallback when a preset name can't be parsed.
export function buildMetadataTool(tool) {
  const preset_meta = {};
  for (const p of (tool.presets || [])) {
    if (p.guid && (p.operation_type || p.machine_id)) {
      preset_meta[p.guid] = {
        ...(p.operation_type ? { operation_type: p.operation_type } : {}),
        ...(p.machine_id    ? { machine_id: p.machine_id }         : {}),
      };
    }
  }
  return {
    id: tool.tracking_id || tool.id,
    // tool_id is metadata-owned (mirrored to Fusion's product-id on write).
    tool_id: tool.tool_id || '',
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
    custom_grind: tool.custom_grind ?? false,
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
    tap_sub_type: tool.tap_sub_type || '',
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
    // Structured physical location (Location System) — { system_id, zone_id,
    // station_id, drawer_id, bin } referencing level option UUIDs. The composed
    // display string is derived on read (never stored). null when the tool has
    // no structured location yet (legacy free-text only).
    location: tool.tool_location || null,
    bin_size_id: tool.bin_size_id || null,
    legacy_locations: tool.legacy_locations || [],
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
      // Assembly ID System: the assembly's human-readable DIGITAL reference
      // (metadata-only). Mutable — it can be reassigned/renumbered (ProShop RTA#,
      // ERP, switching to Auto), so retired values live in legacy_asm_numbers[]
      // (like tool_id → legacy_ids). Auto values are a product of other fields
      // (holder + tool_id + OOH) and are re-derivable, so they are NOT retired —
      // only non-derived external values are (see shouldRetireAsmNumber).
      // (The IMMUTABLE serialized ID is the physical measured_* layer below.)
      asm_number: a.asm_number || null,
      legacy_asm_numbers: a.legacy_asm_numbers || [],
      // Gauge-length tiers (metadata-only; see THREE SYSTEM CONTEXT PROMPT.md).
      // Distinct from Fusion's geometry.assemblyGaugeLength (holder gauge + OOH,
      // never overridden). target = calculated collet correction (formula TBD);
      // measured_* = pre-setter reading (immutable once set) + provenance.
      target_gauge_length: a.target_gauge_length ?? null,
      measured_gauge_length: a.measured_gauge_length ?? null,
      measured_at: a.measured_at || null,
      measured_by: a.measured_by || null,
      measured_serial: a.measured_serial || null,
    })),
    preset_meta,
    notes: tool.notes || '',
    last_used_job: tool.last_used_job || '',
    preferred_machine: tool.preferred_machine || '',
    material_suitability: tool.material_suitability || [],
    // Per-CAM-preset SFM + chip-load starting-point reference (metadata-only).
    // Each entry: { preset_id (→ materials.presets), operation_type, sfm,
    // chip_load }. A manual lookup table the programmer seeds speeds/feeds from
    // per material + operation (rough/finish/…).
    speed_feed_refs: (tool.speed_feed_refs || []).map(r => ({
      preset_id: r.preset_id || null,
      operation_type: r.operation_type || null,
      sfm: r.sfm ?? null,
      chip_load: r.chip_load ?? null,
    })),
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
    // Previously-assigned tool IDs retired by a bulk re-number. Kept so old job
    // files / CSVs that still reference an old ID can match, and so search finds
    // the tool by it. Never written to Fusion (no native field).
    legacy_ids: Array.isArray(tool.legacy_ids) ? tool.legacy_ids : [],
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
      // Assembly ID System + gauge tiers (metadata-only). asm_number is the
      // mutable DIGITAL reference (retired values → legacy_asm_numbers[]); the
      // measured_* block below is the IMMUTABLE physical serialized layer.
      // Auto asm_number is backfilled in-memory at load (backfillAsmNumbers).
      asm_number: m.asm_number || null,
      legacy_asm_numbers: m.legacy_asm_numbers || [],
      target_gauge_length: m.target_gauge_length ?? null,
      measured_gauge_length: m.measured_gauge_length ?? null,
      measured_at: m.measured_at || null,
      measured_by: m.measured_by || null,
      measured_serial: m.measured_serial || null,
    };
  });

  // Overlay operation_type onto each preset (name wins, metadata cache is
  // fallback), and infer the material from the name when Fusion left material.query
  // blank — the shop's presets encode the material only in the name ("AL FIN",
  // "SS316 SM HOLE FIN"), so without this the material would be lost on rename.
  const presetMeta = meta?.preset_meta || {};
  const presets = (merged.presets || []).map(p => {
    const inferredMat = !p.material?.query ? matchMaterial(p.name) : null;
    return {
      ...p,
      operation_type: parsePresetName(p.name)?.opType ?? presetMeta[p.guid]?.operation_type ?? null,
      machine_id: presetMeta[p.guid]?.machine_id ?? null,
      material: inferredMat
        ? { ...(p.material || {}), query: inferredMat, category: materialCategory(inferredMat) }
        : p.material,
    };
  });

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
    custom_grind: false,
    cutting_direction: 'Right Hand',
    pitch: '',
    thread_pitch: null,
    tap_class: '',
    tap_sub_type: '',
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
    tool_id: '',
    location: '',
    tool_location: null,
    bin_size_id: null,
    legacy_locations: [],
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
