// Logical tool ↔ Fusion instances: build a logical tool from a tracking-ID
// group of raw Fusion entries, and split one back into N instances (one per
// assembly) + its metadata record. See CLAUDE.md → Logical Tools & Instances.
import {
  generateId, generateAssemblyId, readTrackingId, readOohFromFusion,
  applyMachineNumberToFusion,
} from './identity.js';
import { fusionToolToInternal, internalToFusionTool } from './fusionConvert.js';
import { mergeFusionAndMetadata, buildMetadataTool } from './metadataModel.js';
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
  const presets = (merged.presets || []).map(p => {
    const inferredMat = !p.material?.query ? matchMaterial(p.name) : null;
    return {
      ...p,
      operation_type: parsePresetName(p.name)?.opType ?? presetMeta[p.guid]?.operation_type ?? null,
      machine_id: presetMeta[p.guid]?.machine_id ?? null,
      job_ids: presetMeta[p.guid]?.job_ids ?? [],
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
