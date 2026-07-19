// ── CAM toolpath strategies (new-format preset support) ───────────────────────
// Fusion's newer preset format carries a `strategies` object with `roughing[]`
// and `finishing[]` arrays of internal strategy IDs. This module is the single
// source of that vocabulary.
//
// EVERY ID here is VERIFIED against real Fusion exports — the "ALL MILLING
// STRATEGIES" reference preset (46 milling IDs, in internal-ID order) plus the
// chamfer-tool reference (chamfer2d / engrave), cross-checked positionally
// against full-scroll screenshots of Fusion's "Edit strategy association"
// dialog. No guessed IDs. Several display names map to non-obvious internal IDs
// (Trace = path3d, Wall = inclined_walls, Corner = rest_finishing, the Rotary/
// ModuleWorks multi-axis set) — do NOT "correct" a name to match its ID.
//
// Groups mirror Fusion's dialog: 2D, 3D, Drilling, Multi-Axis, Other. The
// "Other" group is Fusion's internal/utility tail (CLD Toolpath, Contact Area,
// Rest Area, Tool, Turning Tool, Replace Tool) — the "odd unneeded strategies"
// the shop doesn't reach for. They're kept so the app can round-trip and
// display a preset that already has them, but hidden from the quick picker.
//
// `chamferOnly: true` marks strategies Fusion offers only for chamfer mills
// (and drill mills, which this app has no type for) — 2D Chamfer + Engrave.

export const STRATEGIES = [
  // ── 2D ──
  { id: 'adaptive2d', name: '2D Adaptive Clearing', group: '2D' },
  { id: 'bore',       name: 'Bore',                 group: '2D' },
  { id: 'circular',   name: 'Circular',             group: '2D' },
  { id: 'contour2d',  name: '2D Contour',           group: '2D' },
  { id: 'face',       name: 'Face',                 group: '2D' },
  { id: 'path3d',     name: 'Trace',                group: '2D' },
  { id: 'pocket2d',   name: '2D Pocket',            group: '2D' },
  { id: 'slot',       name: 'Slot',                 group: '2D' },
  { id: 'thread',     name: 'Thread',               group: '2D' },
  { id: 'chamfer2d',  name: '2D Chamfer',           group: '2D', chamferOnly: true },
  { id: 'engrave',    name: 'Engrave',              group: '2D', chamferOnly: true },

  // ── 3D ──
  { id: 'adaptive',          name: 'Adaptive Clearing', group: '3D' },
  { id: 'contour_new',       name: 'Contour',           group: '3D' },
  { id: 'flat',              name: 'Flat',              group: '3D' },
  { id: 'horizontal_new',    name: 'Horizontal',        group: '3D' },
  { id: 'inclined_walls',    name: 'Wall',              group: '3D' },
  { id: 'morph',             name: 'Morph',             group: '3D' },
  { id: 'morphed_spiral',    name: 'Morphed Spiral',    group: '3D' },
  { id: 'parallel_new',      name: 'Parallel',          group: '3D' },
  { id: 'pencil_new',        name: 'Pencil',            group: '3D' },
  { id: 'pocket_new',        name: 'Pocket Clearing',   group: '3D' },
  { id: 'project',           name: 'Project',           group: '3D' },
  { id: 'radial_new',        name: 'Radial',            group: '3D' },
  { id: 'ramp',              name: 'Ramp',              group: '3D' },
  { id: 'rest_finishing',    name: 'Corner',            group: '3D' },
  { id: 'scallop_new',       name: 'Scallop',           group: '3D' },
  { id: 'spiral_new',        name: 'Spiral',            group: '3D' },
  { id: 'steep_and_shallow', name: 'Steep and Shallow', group: '3D' },
  { id: 'valley',            name: 'Valley',            group: '3D' },

  // ── Drilling ──
  { id: 'drill', name: 'Drill', group: 'Drilling' },

  // ── Multi-Axis ──
  { id: 'blend',                          name: 'Blend',              group: 'Multi-Axis' },
  { id: 'flow2',                          name: 'Flow',               group: 'Multi-Axis' },
  { id: 'moduleworks_4axis_finishing',    name: 'Rotary Contour',     group: 'Multi-Axis' },
  { id: 'moduleworks_4axis_roughing',     name: 'Rotary Pocket',      group: 'Multi-Axis' },
  { id: 'moduleworks_automatic_deburring', name: 'Deburr',            group: 'Multi-Axis' },
  { id: 'moduleworks_multiaxis_roughing', name: 'Multi-Axis Clearing', group: 'Multi-Axis' },
  { id: 'moduleworks_swarf',              name: 'Advanced Swarf',     group: 'Multi-Axis' },
  { id: 'moduleworks_three_plus_two',     name: '3+2 Clearing',       group: 'Multi-Axis' },
  { id: 'multiAxisContour',               name: 'Multi-Axis Contour', group: 'Multi-Axis' },
  { id: 'multiAxisMorph',                 name: 'Multi-Axis Morph',   group: 'Multi-Axis' },
  { id: 'rotary_finishing',               name: 'Rotary Parallel',    group: 'Multi-Axis' },
  { id: 'swarf5d',                        name: 'Swarf',              group: 'Multi-Axis' },

  // ── Other (Fusion internal/utility tail — hidden from quick pick) ──
  { id: 'cldToolpath',                name: 'CLD Toolpath',  group: 'Other', internal: true },
  { id: 'contact',                    name: 'Contact Area',  group: 'Other', internal: true },
  { id: 'rest_area',                  name: 'Rest Area',     group: 'Other', internal: true },
  { id: 'tool',                       name: 'Tool',          group: 'Other', internal: true },
  { id: 'tool_turning',               name: 'Turning Tool',  group: 'Other', internal: true },
  { id: 'toolpath_edit_tool_change',  name: 'Replace Tool',  group: 'Other', internal: true },
];

export const STRATEGY_GROUPS = ['2D', '3D', 'Drilling', 'Multi-Axis', 'Other'];

// Column layout for the "All strategies…" popout (mirrors Fusion's dialog).
export const STRATEGY_COLUMNS = [['2D'], ['3D'], ['Drilling', 'Multi-Axis', 'Other']];

const STRATEGY_BY_ID = new Map(STRATEGIES.map(s => [s.id, s]));
export const strategyById = (id) => STRATEGY_BY_ID.get(id) || null;
export const strategyName = (id) => STRATEGY_BY_ID.get(id)?.name || id;

// Strategies offered for a given tool type. chamfer2d + engrave are chamfer-mill
// only; every other milling type excludes them. (Turning types have their own
// strategy vocabulary — out of scope this round.)
export function strategiesForToolType(toolType) {
  const isChamfer = toolType === 'chamfer mill';
  return STRATEGIES.filter(s => !s.chamferOnly || isChamfer);
}

// Quick-pick groups — a starting point (Dan will refine later). Members are real
// IDs. `suggestBucket` pre-selects Rough/Finish when the group is turned on.
export const QUICK_GROUPS = [
  { key: 'adaptive', label: 'Adaptive', members: ['adaptive2d', 'adaptive'], suggestBucket: null },
  { key: 'facing',   label: 'Facing',   members: ['face', 'flat', 'horizontal_new'], suggestBucket: null },
  { key: 'rough3d',  label: 'Rough 3D Surfacing',
    members: ['adaptive', 'moduleworks_three_plus_two', 'contour_new', 'parallel_new', 'scallop_new', 'moduleworks_multiaxis_roughing'],
    suggestBucket: 'roughing' },
  { key: 'finish3d', label: 'Finish 3D Surfacing',
    members: ['contour_new', 'parallel_new', 'scallop_new', 'pencil_new', 'spiral_new', 'morphed_spiral', 'morph', 'radial_new', 'blend', 'flow2', 'inclined_walls', 'steep_and_shallow', 'rest_finishing', 'multiAxisContour', 'rotary_finishing', 'moduleworks_swarf'],
    suggestBucket: 'finishing' },
  { key: 'engrave',  label: 'Engrave',  members: ['engrave', 'project'], suggestBucket: null },
];
export const quickGroupsContaining = (id) => QUICK_GROUPS.filter(g => g.members.includes(id));

// 2D↔3D twins that Fusion pairs — selecting one selects both.
export const AUTO_LINK_PAIR = ['adaptive2d', 'adaptive'];

// Common singles pinned beside the quick groups (they belong to no group).
export const PINNED_STRATEGIES = ['contour2d', 'bore'];

// Strategies for which Small Bore compensation applies (bore / 2D + 3D contour).
export const SMALL_BORE_STRATEGIES = ['bore', 'contour2d', 'contour_new'];

// ── Format detection & read/write helpers ─────────────────────────────────────
// A preset is NEW format when it carries a `strategies` object (Fusion's newer
// shape). Old presets have no strategies key — their operation lives in the name
// + operation_type metadata, unchanged.
export function isNewFormatPreset(preset) {
  const s = preset?.strategies;
  return !!s && (Array.isArray(s.roughing) || Array.isArray(s.finishing));
}

// The single populated bucket ('roughing' | 'finishing') and its selected IDs.
// (Per Dan: a preset is one or the other, never both.) Roughing wins if — from
// dirty external data — both somehow carry entries.
export function readStrategyBucket(preset) {
  const s = preset?.strategies || {};
  const roughing = Array.isArray(s.roughing) ? s.roughing : [];
  const finishing = Array.isArray(s.finishing) ? s.finishing : [];
  const bucket = roughing.length && !finishing.length ? 'roughing'
    : finishing.length && !roughing.length ? 'finishing'
      : roughing.length ? 'roughing' : 'finishing';
  return { bucket, ids: bucket === 'roughing' ? roughing : finishing };
}

// Build the Fusion `strategies` object from a bucket + selected IDs. The chosen
// bucket gets the IDs; the other stays an empty array (Fusion's shape).
export function buildStrategies(bucket, ids) {
  const list = [...new Set(ids)];
  return bucket === 'roughing'
    ? { roughing: list, finishing: [] }
    : { roughing: [], finishing: list };
}
