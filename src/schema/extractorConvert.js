// Extractor (AI extraction / AddToolFlow / ProShop export shape) ↔ internal
// model conversion, plus the per-type facet/required-field derivations that
// read the extractor's FIELD_VISIBILITY matrix.
import {
  FIELD_VISIBILITY, _FV_KEYS, AUTO_GROUP, THROUGH_COOLANT_VALUES,
} from '../../tool-extractor.tsx';
import { generateId } from './identity.js';
import { getDefaultUnit } from '../utils/units.js';
import { buildDesc } from '../utils/toolNaming.js';

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
    if (toolType === 'bull nose end mill' || toolType === 'radius mill' || toolType === 'lollipop mill' || toolType === 'slot/key cutter') {
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
    // Pre-fill the generated description so the Add form opens with the same name
    // the extractor previewed (metric-aware via inputWasMm) — the user shouldn't
    // have to re-click "Suggest" after extraction. It stays editable in the form.
    description: buildDesc(f) || '',
    // Whether this tool is conceptually a metric size (its diameter is shown in mm
    // in the description, e.g. "1.45mm (.0571)"). Metadata-only; kept so the name
    // regenerates metric-aware everywhere (re-Suggest, ProShop/Fusion export).
    input_was_mm: !!f.inputWasMm,
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
    unit: tool.unit,
    inputWasMm: !!tool.input_was_mm,
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
