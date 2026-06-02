import {
  TT, TL, BLANK, FIELD_VISIBILITY, _FV_KEYS,
  MA, CO, WM, MANUFACTURER_LIST, VENDOR_LIST,
  PS_GROUPS, AUTO_GROUP, COOLANT_OPTS,
  getVisibleFields,
} from '../../tool-extractor.tsx';

export { TT, TL, MA, CO, WM, MANUFACTURER_LIST, VENDOR_LIST, PS_GROUPS, AUTO_GROUP, COOLANT_OPTS };

// ─── Icons ─────────────────────────────────────────────────────────────────
// Tool-type icons are rendered by the <ToolTypeIcon> component
// (src/components/icons/ToolTypeIcon.jsx) as hand-crafted SVG silhouettes.

export const TOOL_TYPES = TT;
export const TOOL_TYPE_LABELS = TL;

// ─── Facet fields per tool type (search filter order) ─────────────────────
const COMMON_FACETS = ['diameter', 'number_of_flutes', 'flute_length', 'overall_length', 'material', 'coating', 'vendor', 'preferred_machine', 'material_suitability', 'tags'];

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
    coolant: f.coolant || 'flood',
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
    coolant: tool.coolant || 'flood',
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

// Alias for semantic clarity when creating assembly IDs.
export const generateAssemblyId = generateId;

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
    unit: fTool.unit || 'inches',
    tool_type: toolType,
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
    // Full presets array preserved so the preset panel can manage all presets.
    // The flat speed/feed fields above are still read from presets[0] for
    // backwards compat with ToolForm and search facets.
    presets: fTool['start-values']?.presets || [],
    tool_number: fTool['post-process']?.number ? String(fTool['post-process'].number) : '',
    // Machine tool number — output mirror of post-process.number. The metadata
    // file is the source of truth; this is only a fallback when metadata is missing.
    machine_tool_number: (fTool['post-process']?.number ?? null) === null
      ? null
      : Number(fTool['post-process'].number),
    // Holder link — read from Fusion JSON holder.guid as initial default;
    // overridden by metadata.selected_holder_guid when present.
    selected_holder_guid: fTool.holder?.guid || '',
    // Transient — only populated for merge-flow incoming tools (not saved to metadata).
    // OOH comes from geometry.LB (Body Length / Length below Holder). assembly-gauge-length
    // is what we write on export; LB is what Fusion stores as the actual stick-out geometry.
    incoming_holder_guid: fTool.holder?.guid || '',
    incoming_ooh: geo.LB
      ? (fTool.unit === 'millimeters' ? geo.LB / 25.4 : geo.LB)
      : null,
    // Assemblies — metadata only, default empty
    assemblies: [],
    // Metadata fields default empty — filled from metadata file
    vendor: '',
    product_id: '',
    coating: '',
    distributor: '',
    distributor_stock_num: '',
    cost: '',
    coolant: 'flood',
    center_cutting: false,
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
  // When tool.presets is populated (managed by PresetPanel), use presets[0] as
  // the base for the first preset so its name/material/guid are preserved.
  // Flat speed/feed fields always override the numeric values in preset[0] so
  // both ToolForm (flat-field edits) and PresetPanel edits stay in sync.
  const existingPreset0 = existing['start-values']?.presets?.[0] || {};
  const managedPresets = tool.presets?.length > 0 ? tool.presets : null;
  const preset0base = managedPresets ? (managedPresets[0] || {}) : existingPreset0;
  const additionalPresets = managedPresets ? managedPresets.slice(1) : [];

  // Machine tool number drives the post-process fields. When present, all three
  // (number / length-offset / diameter-offset) must be written to the same value,
  // and the expression link must be kept intact. Falls back to the legacy
  // freeform `tool_number` field only when no machine number is assigned.
  const mtn = tool.machine_tool_number;
  const hasMtn = mtn !== null && mtn !== undefined && mtn !== '' && !isNaN(parseInt(mtn));
  const mtnInt = hasMtn ? parseInt(mtn) : null;

  return {
    ...existing,
    BMC: tool.material || existing.BMC || 'carbide',
    GRADE: existing.GRADE || 'Mill Generic',
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
      tool_diameter: `${tool.diameter || 0} in`,
      tool_fluteLength: `${tool.flute_length || 0} in`,
      tool_overallLength: `${tool.overall_length || 0} in`,
      tool_material: `'${tool.material || 'carbide'}'`,
      tool_productId: `'${tool.proshot_id || tool.product_id || ''}'`,
      tool_productLink: `'${tool.product_link || ''}'`,
      tool_shaftDiameter: `${tool.shank_diameter || tool.diameter || 0} in`,
      tool_shoulderLength: `${tool.shoulder_length || tool.flute_length || 0} in`,
      tool_vendor: `'${tool.location || ''}'`,
      ...(tool.corner_radius ? { tool_cornerRadius: `${tool.corner_radius} in` } : {}),
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
      NT: 1,
      OAL: tool.overall_length || 0,
      RE: tool.corner_radius || 0,
      SFDM: tool.shank_diameter || tool.diameter || 0,
      TA: tool.taper_angle || 0,
      TP: 0,
      'shoulder-diameter': tool.shank_diameter || tool.diameter || 0,
      'shoulder-length': tool.shoulder_length || tool.flute_length || 0,
      'thread-profile-angle': 60,
      'tip-diameter': tool.tip_diameter || 0,
      'tip-length': 0,
      'tip-offset': 0,
    },
    'start-values': {
      presets: [
        {
          ...preset0base,
          guid: preset0base.guid || generateId(),
          description: preset0base.description || '',
          name: preset0base.name || 'Default preset',
          material: preset0base.material || { category: 'all', query: '', 'use-hardness': false },
          'ramp-angle': preset0base['ramp-angle'] ?? 2,
          'tool-coolant': tool.coolant || preset0base['tool-coolant'] || 'flood',
          'use-stepdown': preset0base['use-stepdown'] ?? false,
          'use-stepover': preset0base['use-stepover'] ?? false,
          n: tool.spindle_speed ?? preset0base.n ?? 0,
          n_ramp: tool.spindle_speed ?? preset0base.n_ramp ?? 0,
          'ramp-spindle-speed': 'n',
          v_f: tool.cutting_feedrate ?? preset0base.v_f ?? 0,
          v_f_leadIn: tool.lead_in_feedrate ?? preset0base.v_f_leadIn ?? 0,
          v_f_leadOut: tool.lead_out_feedrate ?? preset0base.v_f_leadOut ?? 0,
          v_f_plunge: tool.plunge_feedrate ?? preset0base.v_f_plunge ?? 0,
          v_f_ramp: tool.ramp_feedrate ?? preset0base.v_f_ramp ?? 0,
          v_f_transition: tool.cutting_feedrate ?? preset0base.v_f_transition ?? 0,
          f_z: tool.feed_per_tooth ?? preset0base.f_z ?? 0,
          f_n: tool.feed_per_rev ?? preset0base.f_n ?? 0,
          v_c: tool.cutting_speed ?? preset0base.v_c ?? 0,
        },
        ...additionalPresets,
      ],
    },
    holder: existing.holder || null,
    'post-process': {
      ...(existing['post-process'] || {}),
      ...(hasMtn
        ? { number: mtnInt, 'length-offset': mtnInt, 'diameter-offset': mtnInt }
        : (tool.tool_number ? { number: parseInt(tool.tool_number) || 0 } : {})),
    },
  };
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
    coolant: meta.coolant || fusionInternal.coolant || 'flood',
    center_cutting: meta.center_cutting ?? fusionInternal.center_cutting ?? false,
    cutting_direction: meta.cutting_direction || fusionInternal.cutting_direction || 'Right Hand',
    helix_angle: meta.helix_angle ?? fusionInternal.helix_angle ?? null,
    flute_type: meta.flute_type || '',
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
    // selected_holder_guid: metadata wins; fall back to what fusionToolToInternal
    // seeded from holder.guid in the Fusion JSON. An explicit '' in metadata
    // means the user cleared the holder (distinct from key being absent).
    selected_holder_guid: meta.selected_holder_guid !== undefined
      ? meta.selected_holder_guid
      : fusionInternal.selected_holder_guid,
    assemblies: meta.assemblies || [],
    merge_history: meta.merge_history || [],
    created_at: meta.created_at || fusionInternal.created_at,
    updated_at: meta.updated_at || fusionInternal.updated_at,
  };
}

// ─── Split unified tool → Fusion part + metadata part ─────────────────────
export function splitToFusionAndMetadata(tool) {
  const fusionTool = internalToFusionTool(tool);
  const metadataTool = {
    id: tool.id,
    vendor: tool.vendor || '',
    product_id: tool.product_id || '',
    coating: tool.coating || '',
    distributor: tool.distributor || '',
    distributor_stock_num: tool.distributor_stock_num || '',
    cost: tool.cost || '',
    coolant: tool.coolant || 'flood',
    center_cutting: tool.center_cutting || false,
    cutting_direction: tool.cutting_direction || 'Right Hand',
    helix_angle: tool.helix_angle ?? null,
    flute_type: tool.flute_type || '',
    tip_angle: tool.tip_angle ?? null,
    tip_diameter: tool.tip_diameter ?? null,
    lower_radius: tool.lower_radius ?? null,
    upper_radius: tool.upper_radius ?? null,
    profile_radius: tool.profile_radius ?? null,
    axial_distance: tool.axial_distance ?? null,
    shoulder_length: tool.shoulder_length ?? null,
    ooh: tool.ooh ?? null,
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
    // Holder selection — metadata only; '' means explicitly cleared.
    selected_holder_guid: tool.selected_holder_guid ?? '',
    // Assemblies — metadata only. incoming_holder_guid and incoming_ooh are transient
    // (merge-flow only) and are never written to metadata.
    assemblies: tool.assemblies || [],
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
  return { fusionTool, metadataTool };
}

// ─── Create a new blank tool ───────────────────────────────────────────────
export function newTool(toolType = 'flat end mill') {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    unit: 'inches',
    tool_type: toolType,
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
    material: 'carbide',
    coating: '',
    material_suitability: [],
    helix_angle: null,
    center_cutting: false,
    flute_type: '',
    coolant: 'flood',
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

// ─── Re-export getVisibleFields for components ────────────────────────────
export { getVisibleFields };

// ─── Human-readable field labels ──────────────────────────────────────────
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
  coolant: 'Coolant',
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
