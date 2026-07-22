// Fusion JSON ↔ internal model conversion: fusionToolToInternal /
// internalToFusionTool and normalizePreset. This is the round-trip seam the
// audit (scripts/roundtrip-audit.mjs) exercises — every rule here (expression/
// numeric sync, sync-never-inject, geometry field minimalism) is documented in
// CLAUDE.md and FUSION_SCHEMA.md. Known field-registry exceptions live here
// (SCHEMA_AUDIT.md FR1–FR4) — don't add new hardcoded paths elsewhere.
import { isMetadataOnly } from './fieldRegistry.js';
import { generateId, stripQuotes, readTrackingId } from './identity.js';
import { parsePresetName, materialCategory, HOLE_MAKING_TYPES, TURNING_TYPES } from '../utils/presetNaming.js';

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
  // Newer Fusion turning types — no app UI yet, but mapped explicitly so they
  // classify as turning (TURNING_TYPES) instead of falling through to milling.
  'turning boring': 'turning boring',
  'turning threading': 'turning threading',
};

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
    preferred_machine_id: null,
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

  // operation_type, machine_id, material_preset_id, job_ids, and the small-bore
  // comp fields (small_bore / small_bore_diameter / f_z_base) are app-only
  // per-preset fields (stored in preset_meta in tool_metadata.json, overlaid by
  // buildLogicalTool). material_preset_id is the CAM-preset FK; only its derived
  // NAME reaches Fusion (material.query / stock-materials), never the id itself.
  // They must never be written into the Fusion JSON (Fusion validates strictly)
  // — every app-only field stamped onto in-memory presets MUST be pulled out of
  // `rest` here, since the top-level isMetadataOnly guard only sweeps tool-level
  // keys, not preset keys. stepdown/stepover are pulled out so a disabled flag
  // leaves NO leftover numeric key (Fusion omits the key entirely when disabled).
  // Note: `strategies` is Fusion-NATIVE (stays in `rest`, written to the JSON) —
  // only the app-only intensity is pulled out here alongside the others.
  const {
    operation_type, machine_id, material_preset_id, job_ids,
    small_bore, small_bore_diameter, f_z_base, intensity,
    stepdown: _sd, stepover: _so, ...rest
  } = p;

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
  // When the flag is ON and the numeric value changed, the kept expression must
  // change with it — otherwise Fusion re-derives the OLD number from the stale
  // expression on next load and the edit silently reverts (same bug class as the
  // flag flip above, from the value side). Rewrite only pure literal expressions
  // (".018 in") by substituting the number and keeping the original unit suffix;
  // a formula expression is left untouched (never guess at rewriting formulas),
  // and an unchanged value keeps its expression byte-for-byte (round-trip audit).
  const syncStepExpr = (key, num) => {
    const s = presetExpr[key];
    if (s == null || num == null) return;
    if (!/^\s*-?\d*\.?\d+\s*[a-zA-Z]*\s*$/.test(String(s))) return;   // literal only
    const cur = exprNum(s);
    if (cur != null && Math.abs(cur - num) > 1e-9) {
      presetExpr[key] = String(s).replace(/-?\d*\.?\d+/, String(num));
    }
  };
  if (useStepdown) syncStepExpr('tool_stepdown', sdNum);
  if (useStepover) syncStepExpr('tool_stepover', soNum);

  // Coolant is a native+expression pair too: some native presets carry
  // expressions.tool_coolant ("'flood tool'") mirroring the tool-coolant string.
  // When the app changes the coolant (editor, merge update, or the
  // 'flood and through tool' remap below), a present expression must follow —
  // otherwise Fusion re-derives the old coolant on next load. Never added when
  // absent; kept byte-for-byte when the value is unchanged.
  const coolant = ({ 'flood and through tool': 'flood tool' }[p['tool-coolant']] ?? p['tool-coolant']) || (tscCapable ? 'tool' : 'flood');
  if (presetExpr.tool_coolant != null) {
    const curCoolant = String(presetExpr.tool_coolant).replace(/^'(.*)'$/, '$1');
    if (curCoolant !== coolant) presetExpr.tool_coolant = `'${coolant}'`;
  }

  // Base fields present for every tool category. `description` is only written
  // when the source preset has one — Fusion omits it on many native presets.
  const out = {
    ...rest,
    guid: p.guid || generateId(),
    ...(p.description != null ? { description: p.description } : {}),
    name: p.name || 'Default preset',
    material: { category, query: mat.query || '', 'use-hardness': mat['use-hardness'] || false },
    expressions: presetExpr,
    'tool-coolant': coolant,
    n: p.n ?? 0,
    v_c: p.v_c ?? 0,
  };

  // Stock material — the preset↔material link Fusion actually reads. Fusion
  // assigns a preset's material via the `stock-materials` array, matched BY NAME
  // (no UUID — confirmed from a real export: the assigned material's uuid appears
  // nowhere in the tool). It is Fusion-NATIVE and rides through untouched in
  // `...rest`, so this converter neither injects nor clobbers it — the value is
  // written where a real CAM preset is genuinely picked (PresetPanel's
  // CamPresetPicker), so its name matches the exported stock-material file (whose
  // description/filename is the CAM preset name too — see materialExport.js). It
  // is INDEPENDENT of `material.query` (Fusion's free-text "Filter by Search"
  // box): a real export carries query "SS" alongside stock-materials
  // ["SS Harder","Steel, High-Carbon"], so query must never be mirrored into it.

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
    // Native turning presets often omit n (constant-surface-speed presets carry
    // only v_c) or v_c (threading presets carry only n). The base fields above
    // default both to 0 — strip a default we'd be injecting so the preset keeps
    // Fusion's native shape (sync-never-inject).
    if (p.n == null) delete out.n;
    if (p.v_c == null) delete out.v_c;
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
      // Speed fields apply to all tool types — but never (re)create a key both
      // sides lack: native turning presets omit n (CSS presets) or v_c
      // (threading), and normalizePreset just stripped those defaults.
      if (tool.spindle_speed != null || 'n' in np)   np.n   = tool.spindle_speed ?? np.n;
      if (tool.cutting_speed != null || 'v_c' in np) np.v_c = tool.cutting_speed ?? np.v_c;
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
      // Fusion stores exactly ONE speed mode (RPM tool_spindleSpeed OR surface speed
      // tool_surfaceSpeed) and ONE feed mode (tool_feedCutting OR tool_feedPerTooth OR
      // tool_feedPerRevolution) per preset — never both. Confirmed across 345 real
      // reference presets: tool_surfaceSpeed/tool_spindleSpeed and
      // tool_feedPerTooth/tool_feedCutting have ZERO co-occurrences. Seeding both makes
      // Fusion flag the tool on load and strip the redundant expressions (the recurring
      // "warning, then fixes itself when opened" bug). The paired NUMERICS (v_c, f_z) are
      // still seeded above and stored by Fusion — only the redundant EXPRESSIONS are
      // omitted. So seed the RPM + cutting-feed mode only.
      np.expressions = {
        ...origExprs,
        tool_spindleSpeed: SPINDLE_FORMULA,
        ...((isMillingTool || isSpotDrillTool) ? {
          tool_feedCutting: `${np.v_f ?? 0} ${feedUnit}`,
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
  // All turning Fusion types use insert geometry (EPSR/INSD/RE/SC/…), not the
  // mill core fields — the geometry block below must skip the mill set for
  // every one of them, not just 'turning general'.
  const isTurningFusionType = ['turning general', 'turning boring', 'turning threading'].includes(fusionType);

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
      ...(isTurningFusionType ? {} : {
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
