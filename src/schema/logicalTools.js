// Logical tool ↔ Fusion instances: build a logical tool from a tracking-ID
// group of raw Fusion entries, and split one back into N instances (one per
// assembly) + its metadata record. See CLAUDE.md → Logical Tools & Instances.
import {
  generateId, generateAssemblyId, readTrackingId, readOohFromFusion,
  applyMachineNumberToFusion,
} from './identity.js';
import { fusionToolToInternal, internalToFusionTool } from './fusionConvert.js';
import { mergeFusionAndMetadata, buildMetadataTool, detectFusionDrift } from './metadataModel.js';
import { buildHolderObject } from './holderGauge.js';
import { parsePresetName, materialCategory, matchMaterial } from '../utils/presetNaming.js';
import { convertLength } from '../utils/units.js';

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
  // Presets come from Fusion for a LINKED tool (the only case today). When the
  // Fusion side has none — a no-Fusion tool (Phase B) — fall back to the complete
  // presets persisted in metadata (see buildMetadataTool). Inert for linked tools:
  // Fusion presets are present, so this is exactly today's source.
  const fusionPresets = merged.presets || [];
  const sourcePresets = fusionPresets.length > 0 ? fusionPresets : (meta?.presets || []);
  const presets = overlayPresets(sourcePresets, presetMeta);

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
    // Field-level drift (D3): shared fields where the live Fusion value differs
    // from the app's stored copy — someone edited this tool directly in Fusion.
    // Scans EVERY instance (a shared-field edit to any one assembly counts), not
    // just the canonical. Runtime-only (never persisted); surfaced on the tool
    // page for confirmation, and the chosen value is pushed to ALL instances.
    _drift: detectFusionDrift(
      rawInstances.map(r => (r === canonical ? internal : fusionToolToInternal(r))),
      meta,
    ),
  };
}

// Overlay the app-only per-preset fields (operation_type / machine_id / job_ids)
// and infer a blank material from the name. Shared by buildLogicalTool (source =
// Fusion presets, overlay from preset_meta by guid) and buildUnlinkedTool (source
// = the complete metadata presets, which already carry these — the `?? p.<field>`
// tails preserve them when preset_meta has no entry). Name-parsed operation_type
// wins; then preset_meta; then the preset's own value.
export function overlayPresets(sourcePresets, presetMeta = {}) {
  return (sourcePresets || []).map(p => {
    const inferredMat = !p.material?.query ? matchMaterial(p.name) : null;
    return {
      ...p,
      operation_type: parsePresetName(p.name)?.opType ?? presetMeta[p.guid]?.operation_type ?? p.operation_type ?? null,
      machine_id: presetMeta[p.guid]?.machine_id ?? p.machine_id ?? null,
      job_ids: presetMeta[p.guid]?.job_ids ?? p.job_ids ?? [],
      material: inferredMat
        ? { ...(p.material || {}), query: inferredMat, category: materialCategory(inferredMat) }
        : p.material,
    };
  });
}

// ─── Preserve concurrent Fusion preset edits on write (3-way merge) ─────────
// A save writes the tool's IN-MEMORY presets to Fusion. If someone edited a
// preset directly in Fusion after the app loaded the tool, the app's stale copy
// would silently overwrite (WIPE) that edit. This merges: for each preset,
//   base   = presets the app last saw/wrote as Fusion state (tool._instancesRaw),
//   remote = the freshly-downloaded Fusion presets (may carry a new edit),
//   local  = the app's in-memory presets (may carry an intentional app edit).
// If Fusion changed a preset the app did NOT change → adopt Fusion's version
// (its values + expressions), keeping only the app-only overlay
// (operation_type / machine_id / job_ids). Otherwise keep the app's version.
// The rare both-edited conflict keeps the app's version (matches the pre-fix
// behavior for that case); the common "only Fusion changed it" case no longer
// wipes. Speed/feed fields are compared raw-vs-raw so the material-name inference
// overlayPresets adds never trips a false "app changed it".
const PRESET_CMP_FIELDS = [
  'name', 'n', 'v_c', 'n_ramp', 'v_f', 'f_z', 'v_f_leadIn', 'v_f_leadOut',
  'v_f_transition', 'v_f_ramp', 'v_f_plunge', 'f_n', 'v_f_retract',
  'tool-coolant', 'use-stepdown', 'stepdown', 'use-stepover', 'stepover', 'ramp-angle',
];

function presetSpeedFeedChanged(a, b) {
  for (const k of PRESET_CMP_FIELDS) {
    const av = a?.[k], bv = b?.[k];
    if (typeof av === 'number' || typeof bv === 'number') {
      if (Math.abs(Number(av || 0) - Number(bv || 0)) > 5e-6) return true;
    } else if (String(av ?? '') !== String(bv ?? '')) return true;
  }
  return false;
}

export function mergePresetsWithFusion(localPresets, basePresets, remotePresets) {
  if (!localPresets?.length) return localPresets;
  const baseByGuid = new Map((basePresets || []).map(p => [p.guid, p]));
  const remoteByGuid = new Map((remotePresets || []).map(p => [p.guid, p]));
  return localPresets.map(local => {
    const base = baseByGuid.get(local.guid);
    const remote = remoteByGuid.get(local.guid);
    if (!base || !remote) return local;   // app-added, or gone from Fusion → keep app's
    const appChanged = presetSpeedFeedChanged(local, base);
    const fusionChanged = presetSpeedFeedChanged(remote, base);
    if (fusionChanged && !appChanged) {
      // Fusion edited this preset, the app didn't → adopt Fusion's values +
      // expressions (no wipe); keep the app-only overlay fields.
      return {
        ...remote,
        operation_type: local.operation_type ?? null,
        machine_id: local.machine_id ?? null,
        job_ids: local.job_ids ?? [],
      };
    }
    return local;
  });
}

// Write-time 3-way merge for PER-INSTANCE fields (OOH / holder) — same principle
// as the shared-field and preset merges. If Fusion changed an assembly's stick-out
// (geometry.LB) or holder since the app loaded, and the app did NOT change it,
// adopt Fusion's value so a save never wipes it. base/remote are the load-time and
// freshly-downloaded raw instances, matched by instance guid.
function oohEqual(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) < 5e-6;
}

export function mergeInstanceFieldsWithFusion(assemblies, baseRaws, remoteRaws) {
  const baseByGuid = new Map((baseRaws || []).map(r => [r.guid, r]));
  const remoteByGuid = new Map((remoteRaws || []).map(r => [r.guid, r]));
  let changed = false;
  const next = (assemblies || []).map(a => {
    const base = baseByGuid.get(a.instance_guid);
    const remote = remoteByGuid.get(a.instance_guid);
    if (!base || !remote) return a;   // new assembly / not in Fusion yet → keep app's
    const patch = {};
    const baseOoh = readOohFromFusion(base);
    const remoteOoh = readOohFromFusion(remote);
    if (!oohEqual(remoteOoh, baseOoh) && oohEqual(a.ooh, baseOoh)) patch.ooh = remoteOoh;
    const baseHolder = base.holder?.guid || null;
    const remoteHolder = remote.holder?.guid || null;
    if (remoteHolder !== baseHolder && (a.holder_guid || null) === baseHolder) {
      patch.holder_guid = remoteHolder;
      patch.holder_description = remote.holder?.description || '';
    }
    if (Object.keys(patch).length) { changed = true; return { ...a, ...patch }; }
    return a;
  });
  return changed ? next : assemblies;
}

// ─── No-Fusion (unlinked) tools — Fusion-decoupling Phase B ─────────────────
// A metadata record is an INTENTIONAL no-Fusion tool only when it's explicitly
// marked (no_fusion_link). This is the guard against resurrecting orphaned
// metadata: a tool deleted directly in Fusion 360 leaves an UNMARKED metadata
// record behind (it was Fusion-linked), which must stay dormant — never
// materialized as a ghost tool. Only marked records are built as unlinked tools.
export function isUnlinkedMeta(meta) {
  return !!meta?.no_fusion_link;
}

// The Fusion-native fields as an all-null internal object, so
// mergeFusionAndMetadata's `?? meta` fallbacks resolve every field to the
// metadata value (there is no Fusion side to win). Deliberately NOT built via
// fusionToolToInternal — that fills defaults (unit 'inches', material 'carbide',
// tool_type 'flat end mill') which would mask the real metadata values.
function emptyFusionInternal() {
  return {
    id: null, tracking_id: null,
    tool_type: null, unit: null, description: null,
    diameter: null, flute_length: null, overall_length: null, number_of_flutes: null,
    corner_radius: null, shank_diameter: null, taper_angle: null, tip_angle: null,
    tip_diameter: null, thread_pitch: null, shoulder_length: null,
    material: null, tool_id: '', product_link: '', location: '',
    spindle_speed: null, cutting_feedrate: null, plunge_feedrate: null, ramp_feedrate: null,
    lead_in_feedrate: null, lead_out_feedrate: null, feed_per_tooth: null, feed_per_rev: null,
    cutting_speed: null, presets: [],
    machine_tool_number: null, cutting_direction: null,
    created_at: null, updated_at: null, _fusionRaw: null,
  };
}

// Build a complete logical tool from metadata ALONE — no Fusion instance.
// Metadata is authoritative for every field. Mirrors buildLogicalTool's output
// shape so the rest of the app treats it identically, except _instancesRaw is
// empty, _fusionRaw is null, and library_id is null. asm-number backfill /
// pairing-derive still run at load (loadTools), as for linked tools.
export function buildUnlinkedTool(meta) {
  const merged = mergeFusionAndMetadata(emptyFusionInternal(), meta);
  const presets = overlayPresets(meta?.presets || [], meta?.preset_meta || {});
  const p0 = presets[0] || {};

  const assemblies = (meta?.assemblies || []).map(a => ({
    assembly_id: a.assembly_id || generateAssemblyId(),
    instance_guid: a.instance_guid || null,   // null = no Fusion entry for this assembly
    holder_guid: a.holder_guid || null,
    holder_description: a.holder_description || '',
    ooh: a.ooh ?? null,
    linked_preset_guids: a.linked_preset_guids || [],
    notes: a.notes || '',
    source: a.source || 'manual',
    created_at: a.created_at || merged.created_at,
    asm_number: a.asm_number || null,
    legacy_asm_numbers: a.legacy_asm_numbers || [],
    target_gauge_length: a.target_gauge_length ?? null,
    measured_gauge_length: a.measured_gauge_length ?? null,
    measured_at: a.measured_at || null,
    measured_by: a.measured_by || null,
    measured_serial: a.measured_serial || null,
  }));

  return {
    ...merged,
    id: meta.id,
    tracking_id: meta.id,
    // Flat speed/feed mirror = derived cache of preset 0 (O1). No Fusion side to
    // read them from, so recompute from the primary preset.
    spindle_speed: p0.n ?? null,
    cutting_feedrate: p0.v_f ?? null,
    plunge_feedrate: p0.v_f_plunge ?? null,
    ramp_feedrate: p0.v_f_ramp ?? null,
    lead_in_feedrate: p0.v_f_leadIn ?? null,
    lead_out_feedrate: p0.v_f_leadOut ?? null,
    feed_per_tooth: p0.f_z ?? null,
    feed_per_rev: p0.f_n ?? null,
    cutting_speed: p0.v_c ?? null,
    presets,
    assemblies,
    machine_tool_number: (meta?.machine_tool_number ?? null) === null ? null : Number(meta.machine_tool_number),
    // Preserve the stored intent. In the ENABLED-mode materialize path the meta is
    // always marked (isUnlinkedMeta gates it), so this is true. In DISABLED mode
    // buildUnlinkedTool runs for EVERY record, including formerly-linked ones — they
    // keep no_fusion_link:false so re-enabling Fusion doesn't spuriously detach them.
    no_fusion_link: !!meta?.no_fusion_link,
    library_id: null,
    library_name: null,
    _instancesRaw: [],
    _fusionRaw: null,
    _registeredAssemblies: (meta?.assemblies || []).filter(Boolean),
  };
}

// Materialize intentional no-Fusion tools alongside the Fusion-built ones
// (Fusion-decoupling Phase B). For each metadata record that is EXPLICITLY marked
// unlinked (isUnlinkedMeta) and is NOT already represented by a Fusion-built tool
// (its tracking id wasn't produced from a Fusion instance), append a
// buildUnlinkedTool. Guarded three ways so it can never resurrect a ghost:
//   1. only marked (no_fusion_link) records — a deleted-in-Fusion tool's orphan
//      metadata is UNMARKED and stays dormant;
//   2. skip any record whose id already backs a built (linked) tool;
//   3. a malformed record is skipped, never blocks the load.
// A no-op on today's data (every no_fusion_link tool still has a Fusion
// placeholder, so none are orphaned) — it activates once placeholder-minting is
// retired (Phase C) or a tool is created/demoted as no-Fusion (Phase B4).
export function materializeUnlinkedTools(builtTools, metaList) {
  const built = new Set((builtTools || []).map(t => t.tracking_id).filter(Boolean));
  const seen = new Set();
  const extra = [];
  for (const meta of (metaList || [])) {
    if (!isUnlinkedMeta(meta)) continue;
    if (!meta.id || built.has(meta.id) || seen.has(meta.id)) continue;
    seen.add(meta.id);
    try { extra.push(buildUnlinkedTool(meta)); } catch { /* skip a malformed record */ }
  }
  return extra.length ? [...(builtTools || []), ...extra] : builtTools;
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
