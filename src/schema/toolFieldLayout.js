// Shared tool-field layout — the SINGLE source of truth for which scalar fields
// appear in the Geometry and Setup sections, in what order, for a given tool type.
//
// Both the read-only tool view (ToolDetail) and the edit form (ToolForm) render
// from this via <ToolFields>. That is what keeps the two modes identical: a field
// added here shows up in both, in the same place, so they can never drift and the
// field positions never shift between two tools of the same type.
//
// Visibility rule (the fix for "fields jump around"):
//   • A field is shown whenever it applies to the tool type (registry
//     appliesToTypes) — REGARDLESS of whether it has a value. Empty renders as
//     "—" in view and an empty input in edit, so positions stay put.
//   • The only exceptions are VIEW_HIDE_WHEN_EMPTY: a small, explicit set that
//     collapses in the VIEW when empty/false (e.g. Custom Grind = No). Edit mode
//     always reveals every box so you can fill it in.
import { FIELD_REGISTRY, fieldsForType } from './fieldRegistry.js';
import { MA, CO, WM } from './toolSchema.js';

// ── Tool-type groups (shared with the landing-page grid and the type dropdown) ──
// Grouped the way Fusion's tool-type picker groups them. Anything not listed
// falls into "Other" so a newly-added TOOL_TYPES entry never silently vanishes.
export const TOOL_TYPE_GROUPS = [
  {
    label: 'Milling',
    types: [
      'flat end mill', 'ball end mill', 'bull nose end mill', 'chamfer mill', 'face mill',
      'radius mill', 'tapered mill', 'thread mill', 'slot/key cutter', 'lollipop mill',
      'dovetail', 'form mill',
      'circle segment barrel', 'circle segment lens', 'circle segment oval', 'circle segment taper',
    ],
  },
  {
    label: 'Hole Making',
    types: ['drill', 'tap', 'spot drill', 'center drill', 'counter sink', 'counter bore', 'reamer', 'boring head'],
  },
  {
    label: 'Turning',
    types: ['turning general'],
  },
];

// Returns the groups with any ungrouped tool types appended under "Other".
export function groupedToolTypes(allTypes) {
  const grouped = new Set(TOOL_TYPE_GROUPS.flatMap(g => g.types));
  const leftover = allTypes.filter(t => !grouped.has(t));
  return leftover.length ? [...TOOL_TYPE_GROUPS, { label: 'Other', types: leftover }] : TOOL_TYPE_GROUPS;
}

// ── Section field order ──
// Fixed order; per-type visibility comes from the registry's appliesToTypes.
// The thread/tap cluster is rendered separately by ToolFields' ThreadBlock (it
// has bespoke controls), so it is NOT listed in these generic grids.
export const GEOMETRY_FIELDS = [
  'diameter', 'number_of_flutes', 'flute_length', 'overall_length', 'shank_diameter',
  'corner_radius', 'shoulder_length', 'tip_angle', 'taper_angle', 'tip_diameter',
  'lower_radius', 'upper_radius', 'profile_radius', 'axial_distance',
  'min_ooh', 'cutting_direction', 'custom_grind',
];

export const SETUP_FIELDS = [
  'material', 'coating', 'tsc_capable', 'helix_angle', 'flute_type', 'flute_design', 'center_cutting',
];

// The tap / thread-mill cluster — rendered by ThreadBlock (see ToolFields.jsx).
export const THREAD_FIELDS = [
  'pitch', 'thread_pitch', 'tap_class', 'class_of_fit', 'point_type', 'tip_to_first_thread',
  'min_thread_pitch', 'max_thread_pitch', 'tpi_min', 'tpi_max', 'thread_profile_angle',
];

// Select-control option lists (UI enums that the registry doesn't carry).
export const SELECT_OPTIONS = {
  material: MA,
  coating: CO,                      // '' = None
  cutting_direction: ['Right Hand', 'Left Hand'],
  flute_type: ['', 'Roughing', 'Semi-Finishing', 'Finishing', 'Yes', 'No'],
  point_type: ['', 'Bottoming', 'Modified Bottoming', 'Plug', 'Taper', 'Spiral Point', 'Spiral Flute'],
};
export const MATERIAL_SUITABILITY_OPTIONS = WM.filter(w => w);  // drop the blank
export const FLUTE_DESIGN_OPTIONS = ['Variable Index', 'Variable Flute', 'Variable Helix', 'Variable Pitch'];

// Fields that collapse in the VIEW when empty/false (edit always shows them).
// Refine this set as needed — it is the one knob for "what may disappear".
export const VIEW_HIDE_WHEN_EMPTY = new Set([
  'custom_grind',   // a "No" custom grind is the default and just noise
]);

// Render-control kind for a generic field (the thread cluster is handled apart).
// 'select' | 'chips' | 'bool' | 'datalist' | 'num' | 'text'
export function fieldControl(field) {
  if (field === 'material_suitability') return 'chips';
  if (field === 'flute_design') return 'datalist';
  if (SELECT_OPTIONS[field]) return 'select';
  const def = FIELD_REGISTRY[field] || {};
  if (def.type === 'boolean') return 'bool';
  if (def.type === 'number') return 'num';
  return 'text';
}

// Resolve the ordered, type-applicable field list for a section.
function pickForType(fields, applies) {
  return fields.filter(f => applies.has(f));
}

// The Geometry + Setup section field lists for a tool type. ThreadBlock decides
// its own visibility (tap / thread mill) from the same registry data.
export function getToolFieldSections(toolType) {
  const applies = new Set(fieldsForType(toolType));
  return {
    geometry: pickForType(GEOMETRY_FIELDS, applies),
    setup: pickForType(SETUP_FIELDS, applies),
    thread: pickForType(THREAD_FIELDS, applies),
    showThreadBlock: toolType === 'tap' || toolType === 'thread mill',
  };
}
