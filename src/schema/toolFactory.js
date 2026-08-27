// New-tool factory + validation (hard-block validateTool, non-blocking
// geometry-chain warnings from validateGeometry).
import { generateId } from './identity.js';
import { getDefaultUnit, unitAbbr, lengthEps } from '../utils/units.js';

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
    // Blank by default — most tools have no reach beyond their flutes, and
    // null (not 0/false) is what lets the shaft-segment seed fill it in later.
    reach: null,
    has_undercut: null,
    undercut_diameter: null,
    material: isTapType(toolType) ? 'hss' : 'carbide',
    coating: '',
    material_suitability: [],
    helix_angle: null,
    // A new tool is Active — see utils/toolStatus.js.
    tool_status: 'active',
    replaced_by: null,
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
    preferred_machine_id: null,
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
  //
  // ⚠️ Every link is ≤, so EQUAL is legal at each step — and the chain is
  // compared with the same unit-aware tolerance the assembly check below uses.
  // Without it a bare `>` reports float noise as a violation, and because the
  // message rounds to 4 decimals it comes out self-contradicting: "Flute Length
  // (0.125) must be less than or equal to Shoulder Length (0.125)". A
  // slot/key cutter hits this every time — `normalizeLibrary` sets its shoulder
  // FROM its flute length (the unbroken shoulder is the kerf, not the MIN OOH
  // stick-out), so the two are meant to be identical and a Fusion float
  // round-trip is all it takes to make one a hair larger.
  const eps = lengthEps(tool.unit);

  if (isValid(flute_length) && isValid(shoulder_length) && flute_length > shoulder_length + eps) {
    warnings.push({
      fields: ['flute_length', 'shoulder_length'],
      message: `Flute Length (${fmt(flute_length)}) must be less than or equal to Shoulder Length (${fmt(shoulder_length)})`,
    });
  }

  if (isValid(shoulder_length) && isValid(min_ooh) && shoulder_length > min_ooh + eps) {
    warnings.push({
      fields: ['shoulder_length', 'min_ooh'],
      message: `Shoulder Length (${fmt(shoulder_length)}) must be less than or equal to MIN OOH (${fmt(min_ooh)})`,
    });
  }

  if (isValid(min_ooh) && isValid(overall_length) && min_ooh > overall_length + eps) {
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

  // ⚠️ The chain above is TOOL-level; this is the per-ASSEMBLY end of the same
  // rule, and leaving it out made the rule unenforceable in practice.
  // `AssemblyForm` hard-blocks saving an OOH below the floor and
  // `normalizeLibrary` floors them on import — but normalize only ever touches
  // UNTRACKED tools, so once a library is fully tracked a later ProShop import
  // can lower MIN OOH beneath existing assemblies with nothing anywhere to
  // report it. The app refused to CREATE the state while having no way to SHOW
  // it. Same unit rule as the chain: min_ooh and each assembly's ooh are both in
  // the tool's own unit, compared with the shared unit-aware tolerance so float
  // noise never registers. Cleared by Settings → Library Health, or by editing
  // the assembly.
  if (isValid(min_ooh) && Array.isArray(tool.assemblies)) {
    const below = tool.assemblies.filter(a => isValid(a?.ooh) && a.ooh < min_ooh - eps);
    for (const a of below) {
      warnings.push({
        fields: ['min_ooh'],
        message: `Assembly ${a.asm_number || a.holder_description || ''} sticks out ${fmt(a.ooh)}`
          + `, less than MIN OOH (${fmt(min_ooh)})`.trimStart(),
      });
    }
  }

  return warnings;
}
