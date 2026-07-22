// The tool_metadata.json record shape: buildMetadataTool is the authoritative
// source of the full metadata field set (add new metadata fields there first),
// and mergeFusionAndMetadata reads them back onto the internal tool object.
import { generateId, generateAssemblyId } from './identity.js';
import { mergeToolConflicts } from '../utils/toolConflicts.js';

// ─── Fusion drift detection (Fusion-decoupling Phase B — D3) ───────────────
// The shared, Fusion-native fields the app now ALSO stores in metadata. When a
// linked tool's live Fusion value differs from the app's stored copy, someone
// edited the tool directly in Fusion 360 (or the app, in app-authority mode) —
// that difference is surfaced for confirmation, never silently overwritten.
export const DRIFT_FIELDS = [
  'tool_type', 'description', 'unit', 'diameter', 'flute_length', 'overall_length',
  'number_of_flutes', 'shank_diameter', 'corner_radius', 'taper_angle', 'thread_pitch',
  'material', 'tip_angle', 'tip_diameter', 'shoulder_length', 'cutting_direction',
];

function driftEqual(a, b) {
  if (typeof a === 'number' || typeof b === 'number') {
    const na = Number(a), nb = Number(b);
    if (Number.isNaN(na) || Number.isNaN(nb)) return String(a) === String(b);
    return Math.abs(na - nb) < 5e-5;   // absorbs Fusion float round-trip noise
  }
  return String(a ?? '').trim() === String(b ?? '').trim();
}

// Compare the app's stored metadata copy against the live Fusion values for each
// shared field. `internals` is EVERY instance's Fusion-internal object (a logical
// tool = N Fusion instances, one per assembly, sharing all fields except holder
// and OOH). A single object is accepted too (back-compat). Returns
// [{ field, fusionValue, appValue }] for every field where the app has a
// populated value that differs from ANY instance — so an edit made to just one
// assembly in Fusion is caught even when it isn't the canonical (instance 0).
// A field the app hasn't stored yet (pre-complete-record metadata) is skipped —
// that's "not populated", not drift — so an established library raises no false
// alarms until a tool is next saved.
export function detectFusionDrift(internals, meta) {
  if (!meta) return [];
  const list = (Array.isArray(internals) ? internals : [internals]).filter(Boolean);
  if (list.length === 0) return [];
  const drift = [];
  for (const f of DRIFT_FIELDS) {
    const appVal = meta[f];
    if (appVal === null || appVal === undefined || appVal === '') continue;
    let found = false, fusionVal = null;
    for (const inst of list) {
      if (!driftEqual(appVal, inst?.[f])) { found = true; fusionVal = inst?.[f] ?? null; break; }
    }
    if (found) drift.push({ field: f, fusionValue: fusionVal, appValue: appVal });
  }
  return drift;
}

// Write-time 3-way merge for SHARED fields — the general form of the preset-wipe
// fix. Prevents a save from silently overwriting a shared field (geometry,
// identity, material, …) edited directly in Fusion since the app loaded the tool,
// WITHOUT needing a reload (the drift banner is load-time; this is the write-time
// safety net). base = the tool as the app last saw/wrote it (from _instancesRaw),
// remote = the freshly-downloaded Fusion tool, `tool` = the app's in-memory tool.
// For each field: if Fusion changed it and the app did NOT, adopt Fusion's value;
// otherwise keep the app's. Returns a patched tool (or the same reference).
// `conflicts` (optional) collects the both-edited-the-same-field cases so the
// caller can surface them — a conflict keeps the app's value (the user's active
// edit) but is NEVER silently discarded: Fusion's value is recorded so it can be
// shown/restored (see writeLogicalTool + the drift banner).
export function mergeSharedFieldsWithFusion(tool, baseInternal, remoteInternal, conflicts = null, adopted = null) {
  if (!tool || !baseInternal || !remoteInternal) return tool;
  const patch = {};
  for (const f of DRIFT_FIELDS) {
    const baseVal = baseInternal[f];
    if (driftEqual(remoteInternal[f], baseVal)) continue;  // Fusion didn't change it
    if (!driftEqual(tool[f], baseVal)) {                   // app ALSO changed it → conflict
      if (conflicts) conflicts.push({ field: f, appValue: tool[f], fusionValue: remoteInternal[f] ?? null });
      continue;                                            // keep the app's value
    }
    patch[f] = remoteInternal[f];                          // Fusion changed it, app didn't → adopt
    if (adopted) adopted.push({ kind: 'field', label: f });
  }
  return Object.keys(patch).length ? { ...tool, ...patch } : tool;
}

// ─── Merge Fusion tool + metadata into single object ──────────────────────
export function mergeFusionAndMetadata(fusionInternal, meta) {
  if (!meta) return fusionInternal;
  return {
    ...fusionInternal,
    // tool_id is metadata-owned (the TMS manages it); metadata wins, falling back
    // to Fusion's product-id only for tools that predate the TMS assigning an ID.
    tool_id: meta.tool_id || fusionInternal.tool_id,
    // ── Complete-record scalars (Fusion-decoupling Phase A) ──────────────────
    // Fusion-native fields, now ALSO persisted in metadata (see buildMetadataTool).
    // For a LINKED tool Fusion still wins — fusionInternal always carries these, so
    // `?? meta` is an inert fallback that only fills a genuine gap (a tool with no
    // Fusion value, i.e. a future no-Fusion tool). Same "Fusion wins, metadata is a
    // transition fallback" pattern already used for tip_angle / tip_diameter below.
    // The D2 authority setting (which side wins on a real conflict) + D3 drift
    // surfacing are Phase B — this stays Fusion-authoritative and behavior-identical.
    tool_type: fusionInternal.tool_type ?? meta.tool_type,
    description: fusionInternal.description ?? meta.description ?? '',
    unit: fusionInternal.unit ?? meta.unit,
    diameter: fusionInternal.diameter ?? meta.diameter ?? null,
    flute_length: fusionInternal.flute_length ?? meta.flute_length ?? null,
    overall_length: fusionInternal.overall_length ?? meta.overall_length ?? null,
    number_of_flutes: fusionInternal.number_of_flutes ?? meta.number_of_flutes ?? null,
    shank_diameter: fusionInternal.shank_diameter ?? meta.shank_diameter ?? null,
    corner_radius: fusionInternal.corner_radius ?? meta.corner_radius ?? null,
    taper_angle: fusionInternal.taper_angle ?? meta.taper_angle ?? null,
    thread_pitch: fusionInternal.thread_pitch ?? meta.thread_pitch ?? null,
    material: fusionInternal.material ?? meta.material ?? 'carbide',
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
    // Metric-size display intent — the diameter shows in mm in the description
    // (e.g. "1.45mm (.0571)"). Metadata-only; regenerates the name metric-aware.
    input_was_mm: Boolean(meta.input_was_mm),
    // Per-system ID membership (Tool ID / Machine Number / Location). A tool is a
    // member of every system by default; `true` = explicitly excluded, so bulk
    // ID/number/normalize actions skip it. Metadata-only, reversible. See
    // src/utils/idSystems.js.
    id_system_exclusions: {
      tool_id: !!meta.id_system_exclusions?.tool_id,
      machine_number: !!meta.id_system_exclusions?.machine_number,
      location: !!meta.id_system_exclusions?.location,
    },
    job_ids: meta.job_ids || [],
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
    // Insert-style tool pairing (holder body + insert) — references component
    // records in tool_components.json by UUID. null for regular tools. See
    // src/schema/insertFamilies.js.
    pairing: meta.pairing || null,
    // "Informed, not blocked" conflicts — Fusion-instance / ProShop disagreements
    // on a shared value, flagged for the user to resolve on the tool page (never
    // block). See src/utils/toolConflicts.js. Cleared only by explicit user action.
    conflicts: meta.conflicts || [],
  };
}

// ─── Build the metadata record for a logical tool ─────────────────────────
// Keyed by tracking_id. Assemblies carry instance_guid (the Fusion entry each
// assembly maps to). preset_meta caches operation_type by preset guid as a
// fallback when a preset name can't be parsed.
export function buildMetadataTool(tool) {
  const preset_meta = {};
  for (const p of (tool.presets || [])) {
    // Small-bore comp is app-only: f_z_base is the UNCOMPENSATED chip load the
    // comp works from — persisting it is what stops a saved small-bore preset
    // from re-compensating its already-compensated f_z on every reopen.
    const hasSmallBore = p.small_bore || p.small_bore_diameter || p.f_z_base != null;
    // intensity is the new-format strategy "aggressiveness" (light/normal/
    // aggressive) — app-only, a name-modifier hint; 'normal' is the default so
    // it's only stored when it differs.
    const hasIntensity = p.intensity && p.intensity !== 'normal';
    if (p.guid && (p.operation_type || p.machine_id || p.material_preset_id || p.job_ids?.length || hasSmallBore || hasIntensity)) {
      preset_meta[p.guid] = {
        ...(p.operation_type ? { operation_type: p.operation_type } : {}),
        ...(p.machine_id    ? { machine_id: p.machine_id }         : {}),
        // CAM-preset foreign key (materials.json presets[].id) — the stable link
        // to the picked material; the name is derived from it. See presetNaming.js.
        ...(p.material_preset_id ? { material_preset_id: p.material_preset_id } : {}),
        // Job links (jobs.json registry ids) proven on this preset — see
        // src/utils/jobs.js. Metadata-only, never written to Fusion.
        ...(p.job_ids?.length ? { job_ids: p.job_ids } : {}),
        ...(p.small_bore ? { small_bore: true } : {}),
        ...(p.small_bore_diameter ? { small_bore_diameter: p.small_bore_diameter } : {}),
        ...(p.f_z_base != null ? { f_z_base: p.f_z_base } : {}),
        ...(hasIntensity ? { intensity: p.intensity } : {}),
      };
    }
  }
  return {
    id: tool.tracking_id || tool.id,
    // tool_id is metadata-owned (mirrored to Fusion's product-id on write).
    tool_id: tool.tool_id || '',
    // ── Complete-record scalars (Fusion-decoupling Phase A) ──────────────────
    // These are Fusion-native fields (they live in the Fusion JSON and, for a
    // linked tool, Fusion still wins on read — see mergeFusionAndMetadata). They
    // are ALSO persisted here so the app record is complete and standalone: it
    // can reconstruct a tool with no Fusion entry (Phase B) and can diff app-vs-
    // Fusion to surface drift (D3). Writing them changes nothing for a linked
    // tool today — the metadata copy is kept in sync with Fusion on every save.
    // Presets are persisted too (increment 2 — see `presets:` below), so the
    // record is COMPLETE: scalars + presets. See PHASE_A_TOOL_RECORD_SCHEMA.md.
    // isCompleteRecord (logicalTools.js) keys off tool_type + the presets key to
    // tell these complete records apart from pre-increment overlay records.
    tool_type: tool.tool_type || null,
    description: tool.description || '',
    unit: tool.unit || null,
    diameter: tool.diameter ?? null,
    flute_length: tool.flute_length ?? null,
    overall_length: tool.overall_length ?? null,
    number_of_flutes: tool.number_of_flutes ?? null,
    shank_diameter: tool.shank_diameter ?? null,
    corner_radius: tool.corner_radius ?? null,
    taper_angle: tool.taper_angle ?? null,
    thread_pitch: tool.thread_pitch ?? null,
    material: tool.material || null,
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
    input_was_mm: tool.input_was_mm || false,
    // Per-system ID membership (see src/utils/idSystems.js). Default = member
    // (all false); a bulk action or Settings can exclude a tool from a system.
    id_system_exclusions: {
      tool_id: !!tool.id_system_exclusions?.tool_id,
      machine_number: !!tool.id_system_exclusions?.machine_number,
      location: !!tool.id_system_exclusions?.location,
    },
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
    // ── Complete-record presets (Fusion-decoupling Phase A, increment 2) ──────
    // The FULL preset set, persisted so the app record is standalone: a no-Fusion
    // tool carries its own presets (Fusion has none to read from). Each entry is
    // the whole preset object — the modeled speeds/feeds AND the un-modeled
    // Fusion-native keys ('use-stepdown', 'ramp-angle', 'tool-coolant', …) — the
    // JSON-storage equivalent of the tool_presets row + its raw_json blob.
    // For a LINKED tool presets still come from Fusion on read (buildLogicalTool),
    // so this copy is written-but-not-read today; it's the source for the no-Fusion
    // path (Phase B) and app-vs-Fusion drift diffing (D3). preset_meta above is the
    // per-guid app-only overlay the linked read still uses — a subset of these,
    // redundant-but-retained until the SQLite migration folds both into columns.
    // Both are written from the same tool.presets here, so they can't drift.
    presets: (tool.presets || []).map(p => ({ ...p })),
    // Tool-level job links (jobs.json registry ids) — "this tool was used on
    // job X" without preset context. Preset-proven links live in preset_meta.
    job_ids: tool.job_ids || [],
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
    // Insert-style tool pairing — { family, holder_component_id,
    // insert_component_id, rta_number }. Metadata-only; the components
    // themselves live in tool_components.json. null for regular tools.
    pairing: tool.pairing
      ? {
          family: tool.pairing.family || null,
          holder_component_id: tool.pairing.holder_component_id || null,
          insert_component_id: tool.pairing.insert_component_id || null,
          rta_number: tool.pairing.rta_number || '',
        }
      : null,
    // "Informed, not blocked" conflicts. Persist the existing set, folding in any
    // freshly-detected runtime disagreement (the combine's _combineConflicts / the
    // stale-tracking-ID _productIdConflict). Deduped so a conflict isn't re-added
    // each save; never auto-cleared (only the user clears one on the tool page).
    conflicts: mergeToolConflicts(tool.conflicts, {
      combineConflicts: tool._combineConflicts,
      productIdConflict: tool._productIdConflict,
      machineNumberConflict: tool._machineNumberConflict,
    }),
  };
}
