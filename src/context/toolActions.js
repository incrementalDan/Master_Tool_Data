// Per-tool write actions: the core writeLogicalTool reconcile-write plus every
// action built on it (save/add/clone/merge/delete, assembly CRUD, location
// assign/normalize, reconcile-on-open). Created once by AppProvider via
// createToolActions(ctx) — ctx supplies dispatch, notify, the per-library IO
// helpers, and the render-synced refs, so these functions never see stale state.
import * as driveService from '../services/driveService.js';
import {
  validateTool, generateId, generateAssemblyId, generateTrackingId,
  splitToFusionInstances, buildMetadataTool, mergePresetsWithFusion,
  mergeSharedFieldsWithFusion, mergeInstanceFieldsWithFusion, fusionToolToInternal,
  readTrackingId, readOohFromFusion,
  getNextMachineNumber, combineToolsByToolId,
} from '../schema/toolSchema.js';
import { composeAsmNumber, nextAsmSerial, usedAsmSerials } from '../utils/assemblyIdSystem.js';
import { INSERT_FAMILY_BY_ID, pairedAsmIdPart } from '../schema/insertFamilies.js';
import { resolveLocationString, analyzeSystem, findSystem, proShopLocationValue } from '../utils/locationSystem.js';
import { isExcludedFrom, setToolExclusion } from '../utils/idSystems.js';
import { classifyStrays } from '../services/reconcile.js';
import { defaultToolLibraryId, machineNumberArgs } from './appState.js';

export function createToolActions(ctx) {
  const {
    dispatch, notify,
    downloadFusionList, uploadFusionList, downloadAllLibraries, fetchRawLibrary,
    saveLocationConfig,
    toolsRef, holdersRef, shopSettingsRef, googleRef, componentsRef,
  } = ctx;

  // ─── Core write: reconcile a logical tool's instances into the library ────
  // A logical tool maps to N Fusion entries (one per assembly). This drops every
  // current entry carrying the tool's tracking ID and appends the freshly
  // computed instance set, in a single library write. Always re-downloads first
  // (per the re-download-before-write invariant) and refreshes each instance's
  // raw Fusion data so a teammate's untouched fields survive. Returns the
  // normalized tool with stable assembly ids and refreshed _instancesRaw.
  const writeLogicalTool = async (tool) => {
    const holders = holdersRef.current || [];
    const tracking_id = tool.tracking_id || generateTrackingId();
    // A tool is written metadata-only when it's a per-tool no-Fusion tool OR the
    // whole Fusion integration is disabled (shop-wide). Either way its assemblies
    // keep a null instance_guid (the Fusion-entry link) — only a linked tool with
    // Fusion enabled mints one.
    const fusionDisabled = shopSettingsRef.current?.integrations?.fusion?.enabled === false;
    const isUnlinked = tool.no_fusion_link === true || fusionDisabled;
    // Route this tool's read+write to the library it belongs to (multi-library).
    // A new/untagged tool goes to the configured default library.
    const library_id = tool.library_id || defaultToolLibraryId(shopSettingsRef.current);
    const library_name = tool.library_name
      || (shopSettingsRef.current?.tool_libraries || []).find(l => l.id === library_id)?.fileName
      || tool.library_name;

    // Ensure at least one assembly, and stable ids on every assembly.
    const baseAssemblies = (tool.assemblies && tool.assemblies.length > 0)
      ? tool.assemblies
      : [{
          holder_guid: tool.selected_holder_guid || null,
          holder_description: '',
          ooh: tool.ooh ?? null,
          source: 'manual',
          created_at: new Date().toISOString(),
        }];
    // Assembly ID System: stamp a human-readable asm_number on any assembly that
    // doesn't have one yet (generated once, immutable). Auto = composed string;
    // sequential = next free serial; proshop_rta/erp = left for the user/UI.
    const asmCfg = shopSettingsRef.current?.assembly_id_system || {};
    const idCfg = shopSettingsRef.current?.tool_id_system || {};
    const usedSerials = usedAsmSerials(toolsRef.current || []);
    let nextSerial = nextAsmSerial(asmCfg.serial_start ?? 10000, usedSerials);
    // Insert-style pairings (insertFamilies.js): turning families have no tier-3
    // assembly — their number is the pairing-level "{holder_id}/{insert_id}",
    // derived at render — so their instance never gets an asm_number stamped.
    // Tier-3 (milling) families keep per-assembly numbers, with the id token
    // carrying BOTH component ids ("1001+1042").
    const pairingFamily = tool.pairing ? INSERT_FAMILY_BY_ID[tool.pairing.family] : null;
    // Tier-3 (milling) paired tool: the asm-number id token is BOTH component ids
    // ("1001+1042"). When the components aren't linked yet, pairedAsmIdPart is ''
    // — do NOT fall back to the combined tool_id, which would bake the raw
    // "1001/1042" slash form into an immutable Auto number that never re-derives.
    // Skip stamping until the components link (see F2 in the decoupling audit).
    const pairedIdPart = tool.pairing ? pairedAsmIdPart(tool.pairing, componentsRef?.current) : null;
    const skipAsmStamp = !!(pairingFamily && !pairingFamily.hasTier3Assembly)
      || !!(tool.pairing && !pairedIdPart);
    const asmIdToken = tool.pairing ? pairedIdPart : tool.tool_id;
    const assemblies = baseAssemblies.map(a => {
      const withIds = {
        ...a,
        assembly_id: a.assembly_id || generateAssemblyId(),
        instance_guid: isUnlinked ? (a.instance_guid ?? null) : (a.instance_guid || generateId()),
      };
      if (!withIds.asm_number && !skipAsmStamp && asmCfg.mode !== 'proshop_rta' && asmCfg.mode !== 'erp_external') {
        const holderDescription = withIds.holder_description
          || holders.find(h => h.guid === withIds.holder_guid)?.description || '';
        const n = composeAsmNumber(asmCfg, idCfg,
          { holderDescription, tool_id: asmIdToken, ooh: withIds.ooh, assembly_id: withIds.assembly_id },
          asmCfg.mode === 'sequential' ? nextSerial : null);
        if (n) {
          withIds.asm_number = n;
          if (asmCfg.mode === 'sequential') { usedSerials.add(nextSerial); nextSerial = nextAsmSerial(nextSerial + 1, usedSerials); }
        }
      }
      return withIds;
    });

    // A structured location is the single source of truth for the derived
    // DISPLAY values only — the composed string (Fusion vendor) and the ProShop
    // Location value. It deliberately does NOT write tool_id: ID generation stays
    // the explicit job of the Tool ID System's Assign/Re-number actions (which, in
    // location mode, read this same structured location). This keeps "where a tool
    // lives" (Location System) cleanly separate from "what it's called" (Tool ID).
    // Needs no Fusion download, so it's computed before the linked/no-Fusion split.
    const locSystems = shopSettingsRef.current?.location_config?.systems || [];
    const locSys = tool.tool_location ? findSystem(locSystems, tool.tool_location.system_id) : null;
    const composedLoc = locSys ? resolveLocationString(tool.tool_location, locSystems) : '';
    const locExtra = composedLoc
      ? { location: composedLoc, proshop_location: proShopLocationValue(locSys, composedLoc) }
      : {};

    // No-Fusion tool (Fusion-decoupling Phase B): write metadata ONLY — no Fusion
    // library round-trip, no placeholder minted. The tool intentionally has no
    // Fusion entry (no_fusion_link — set by ProShop import for unmatched rows, or
    // by a future create/demote action), so it belongs to no library (library_id
    // null). Metadata is its sole store, so Drive is required.
    if (isUnlinked) {
      const toWrite = {
        ...tool, tracking_id, library_id: null, library_name: null,
        assemblies, ...locExtra,
        // Preserve the tool's own intent: a per-tool no-Fusion tool stays marked;
        // a formerly-linked tool saved only because Fusion is disabled keeps its
        // flag (false), so re-enabling Fusion doesn't spuriously detach it.
        no_fusion_link: !!tool.no_fusion_link,
        _instancesRaw: [], _fusionRaw: null,
      };
      if (!googleRef.current) {
        throw new Error('Connect Google Drive to save (metadata is the tool\'s store when it is not in Fusion)');
      }
      try {
        await driveService.upsertMetadata(buildMetadataTool({ ...toWrite, tracking_id }));
      } catch (err) {
        if (err.code === 'TOKEN_EXPIRED') dispatch({ type: 'GOOGLE_EXPIRED' });
        throw err;
      }
      return toWrite;
    }

    // Base = what the app last saw/wrote as this tool's Fusion state (its shared
    // presets are identical across instances, so instance 0 is representative).
    const basePresets = tool._instancesRaw?.[0]?.['start-values']?.presets || [];

    const fusionList = await downloadFusionList(library_id);
    const freshByGuid = new Map(fusionList.map(f => [f.guid, f]));
    const refreshedRaws = assemblies.map(a => freshByGuid.get(a.instance_guid)).filter(Boolean);

    // Preserve any edit made directly in Fusion since the app loaded this tool —
    // never let a stale in-memory value silently overwrite it (the write-time net
    // for the "app didn't reload" case). remote = the freshly-downloaded Fusion
    // state; base = what the app last saw/wrote (tool._instancesRaw). For each
    // preset / shared field / per-instance OOH+holder: if Fusion changed it and
    // the app did NOT, adopt Fusion's value; otherwise keep the app's.
    // Collect every "both edited the same thing" conflict across all three merges.
    // On a conflict we keep the app's active edit (it's what the user is saving),
    // but we NEVER take Fusion's change silently — the conflicts are surfaced as a
    // toast and, for shared scalar fields, attached to the tool's _drift so the
    // DriftBanner offers a one-click restore of Fusion's value (D3).
    const conflicts = [];
    const remotePresets = refreshedRaws?.[0]?.['start-values']?.presets || [];
    const mergedPresets = mergePresetsWithFusion(tool.presets, basePresets, remotePresets, conflicts);
    const baseRaw = tool._instancesRaw?.[0];
    const remoteRaw = refreshedRaws?.[0];
    const sharedMerged = (baseRaw && remoteRaw)
      ? mergeSharedFieldsWithFusion(tool, fusionToolToInternal(baseRaw), fusionToolToInternal(remoteRaw), conflicts)
      : tool;
    const mergedAssemblies = mergeInstanceFieldsWithFusion(assemblies, tool._instancesRaw, refreshedRaws, conflicts);

    // Shared scalar-field conflicts (from mergeSharedFieldsWithFusion) carry a
    // `field` — surface them via the DriftBanner so Fusion's value stays one click
    // away. Preset/OOH/holder conflicts have no scalar drift row; the toast is
    // their surfacing.
    const fieldConflicts = conflicts
      .filter(c => c.field)
      .map(c => ({ field: c.field, appValue: c.appValue, fusionValue: c.fusionValue }));

    const toWrite = {
      ...sharedMerged,
      tracking_id,
      library_id,
      library_name,
      assemblies: mergedAssemblies,
      presets: mergedPresets,
      _instancesRaw: refreshedRaws,
      _fusionRaw: refreshedRaws[0] || tool._fusionRaw || null,
      _drift: fieldConflicts,
      ...locExtra,
    };

    const { fusionInstances, metadataTool } = splitToFusionInstances(toWrite, holders);

    // Drop every entry this logical tool owns before re-appending the fresh set:
    // its tracking ID, plus any guid carried by an assembly or absorbed raw
    // instance. The guid sweep removes leftovers from entries that were combined
    // in (e.g. same-ProShop duplicates that previously had a different/no
    // tracking ID), so no orphans remain in the library.
    const dropGuids = new Set();
    for (const a of assemblies) if (a.instance_guid) dropGuids.add(a.instance_guid);
    for (const r of (tool._instancesRaw || [])) if (r?.guid) dropGuids.add(r.guid);

    const next = fusionList
      .filter(f => readTrackingId(f) !== tracking_id && !dropGuids.has(f.guid))
      .concat(fusionInstances);

    await uploadFusionList(library_id, next);
    if (googleRef.current) {
      try {
        await driveService.upsertMetadata(metadataTool);
      } catch (err) {
        if (err.code === 'TOKEN_EXPIRED') dispatch({ type: 'GOOGLE_EXPIRED' });
        throw err; // Still fail the save so the user knows metadata didn't persist
      }
    }

    if (conflicts.length) {
      const parts = [];
      const nField = conflicts.filter(c => c.field).length;
      const nPreset = conflicts.filter(c => c.kind === 'preset').length;
      const nInst = conflicts.filter(c => c.kind === 'ooh' || c.kind === 'holder').length;
      if (nField) parts.push(`${nField} field${nField === 1 ? '' : 's'}`);
      if (nPreset) parts.push(`${nPreset} preset${nPreset === 1 ? '' : 's'}`);
      if (nInst) parts.push(`${nInst} assembly value${nInst === 1 ? '' : 's'}`);
      notify(
        `Kept your edits — Fusion also changed ${parts.join(', ')} since you loaded this tool. Review flagged above.`,
        'warning', 8000,
      );
    }

    return { ...toWrite, _instancesRaw: fusionInstances, _fusionRaw: fusionInstances[0] };
  };

  const saveTool = async (tool) => {
    const { valid, errors } = validateTool(tool);
    if (!valid) throw new Error(errors.join(', '));

    dispatch({ type: 'SAVE_START' });
    try {
      const updated = await writeLogicalTool({ ...tool, updated_at: new Date().toISOString() });
      dispatch({ type: 'UPDATE_TOOL', tool: updated });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify('Saved to Fusion library', 'success');
      return updated;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Save failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  };

  // Assign (or clear) a single tool's structured location. Routes through
  // writeLogicalTool so the composed string syncs to Fusion's vendor field +
  // metadata in one save. `toolLocation` null clears it.
  const assignToolLocation = async (tool, toolLocation, binSizeId = null) => {
    dispatch({ type: 'SAVE_START' });
    try {
      // Setting a location: writeLogicalTool composes the display string + ProShop
      // value. Clearing it: explicitly wipe those derived fields too — otherwise the
      // old composed string lingers in Fusion's vendor field. tool_id is left alone
      // either way (only the Tool ID System's explicit actions write it).
      const patch = toolLocation
        ? { tool_location: toolLocation, bin_size_id: binSizeId }
        : { tool_location: null, bin_size_id: null, location: '', proshop_location: '' };
      const updated = await writeLogicalTool({
        ...tool,
        ...patch,
        updated_at: new Date().toISOString(),
      });
      dispatch({ type: 'UPDATE_TOOL', tool: updated });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify('Location saved', 'success');
      return updated;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Save failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  };

  // Normalization commit: assign the structured location to every tool that
  // matched `systemId` during analysis, mark the system normalized, and persist.
  // Metadata-only batch write (one saveAllMetadata) + optimistic in-memory update
  // — a full Fusion round-trip per tool would re-upload the whole library for
  // each of potentially hundreds of matches. The composed string re-syncs to the
  // Fusion vendor field the next time each tool is individually saved.
  const normalizeLocationSystem = async (systemId) => {
    const ss = shopSettingsRef.current || {};
    const systems = ss.location_config?.systems || [];
    const system = systems.find(s => s.id === systemId);
    if (!system) throw new Error('Location system not found');

    const { matched: matchedAll } = analyzeSystem(toolsRef.current || [], system);
    // Skip tools explicitly excluded from the Location system — they keep their
    // current location and aren't assigned/normalized into this system.
    const matched = matchedAll.filter(m => !isExcludedFrom(m.tool, 'location'));
    const uniqPush = (arr, v) => (arr.includes(v) ? arr : [...arr, v]);

    // Normalization assigns LOCATION data only — it never writes tool_id. In
    // location-based Tool ID mode the user generates IDs separately via the Tool
    // ID System's Assign/Re-number action (which reads this structured location).
    // Optimistic in-memory update: set tool_location + recompose derived fields.
    // The prior free-text location (Fusion's vendor field) is retired into
    // legacy_locations[] — mirroring how renumberAllToolIds retires legacy_ids —
    // so it stays searchable and matchable on a later ProShop import.
    const byId = new Map(matched.map(m => [m.tool.id, m.location]));
    const updatedTools = (toolsRef.current || []).map(t => {
      const loc = byId.get(t.id);
      if (!loc) return t;
      const composed = resolveLocationString(loc, systems);
      const prior = (t.location || '').trim();
      const legacy_locations = (prior && prior !== composed)
        ? uniqPush((t.legacy_locations || []).filter(l => l !== composed), prior)
        : (t.legacy_locations || []);
      return {
        ...t,
        tool_location: loc,
        location: composed,
        proshop_location: proShopLocationValue(system, composed),
        legacy_locations,
      };
    });
    dispatch({ type: 'SET_TOOLS', tools: updatedTools });

    // Mark the system normalized + persist shop settings.
    const nextSystems = systems.map(s => s.id === systemId ? { ...s, normalized: true } : s);
    await saveLocationConfig({ ...(ss.location_config || {}), systems: nextSystems });

    // Batch metadata write (Drive only — skipped when Google not connected).
    if (googleRef.current && matched.length) {
      try {
        const metaList = await driveService.loadMetadata();
        const metaById = new Map(metaList.map(m => [m.id, m]));
        for (const { tool, location } of matched) {
          const key = tool.tracking_id || tool.id;
          const existing = metaById.get(key) || { id: key };
          const composed = resolveLocationString(location, systems);
          const prior = (tool.location || '').trim();
          const legacy_locations = (prior && prior !== composed)
            ? uniqPush((existing.legacy_locations || []).filter(l => l !== composed), prior)
            : (existing.legacy_locations || []);
          metaById.set(key, { ...existing, location, legacy_locations });
        }
        await driveService.saveAllMetadata([...metaById.values()]);
      } catch (err) {
        notify(`Saved system but metadata write failed: ${err.message}`, 'error', 7000);
        throw err;
      }
    }
    return matched.length;
  };

  const addTool = async (tool) => {
    const { valid, errors } = validateTool(tool);
    if (!valid) throw new Error(errors.join(', '));

    const now = new Date().toISOString();

    dispatch({ type: 'SAVE_START' });
    try {
      // Auto-combine: if a tool with this ProShop number already exists, fold the
      // new entry into it instead of creating a duplicate logical tool. The
      // ProShop number alone decides identity — no other field is checked.
      const pid = String(tool.tool_id || '').trim();
      const existingDup = pid
        ? toolsRef.current.find(t => String(t.tool_id || '').trim() === pid)
        : null;
      if (existingDup) {
        const combined = combineToolsByToolId([
          existingDup,
          { ...tool, tracking_id: null, id: undefined },
        ])[0];
        const written = await writeLogicalTool({ ...combined, updated_at: now });
        dispatch({ type: 'UPDATE_TOOL', tool: written });
        dispatch({ type: 'SAVE_SUCCESS' });
        notify(`Combined with existing tool sharing ProShop ${pid}`, 'success');
        return written;
      }

      // Machine tool numbers are shop-global, so gather used numbers across EVERY
      // linked library (plus the in-memory tools) before picking the next free one.
      const usedNumbers = new Set();
      const allLibs = await downloadAllLibraries();
      for (const { list } of allLibs) {
        for (const f of list) {
          const n = f['post-process']?.number;
          if (n !== null && n !== undefined && n !== '') usedNumbers.add(Number(n));
        }
      }
      for (const t of toolsRef.current) {
        const n = t.machine_tool_number;
        if (n !== null && n !== undefined && n !== '') usedNumbers.add(Number(n));
      }

      const tracking_id = generateTrackingId();
      // Destination library: the picker's choice (tool.library_id) or the default.
      const library_id = tool.library_id || defaultToolLibraryId(shopSettingsRef.current);
      const created = {
        ...tool,
        id: tracking_id,
        tracking_id,
        library_id,
        machine_tool_number: getNextMachineNumber([...usedNumbers], ...machineNumberArgs(shopSettingsRef.current)),
        created_at: tool.created_at || now,
        updated_at: now,
      };

      const written = await writeLogicalTool(created);
      dispatch({ type: 'ADD_TOOL', tool: written });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify('Tool added to library', 'success');
      return written;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Add failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  };

  // Duplicate an existing tool as a starting point for a new one.
  const cloneTool = async (id) => {
    const source = toolsRef.current.find(t => t.id === id);
    if (!source) throw new Error('Tool not found');
    const now = new Date().toISOString();
    const copy = {
      ...source,
      id: generateId(),
      tracking_id: null,        // addTool assigns a fresh tracking ID
      // Clear the ProShop ID — keeping it would make addTool's auto-combine
      // (combineToolsByToolId) fold this copy straight back into the source,
      // so the "duplicate" would never actually appear as its own tool.
      tool_id: '',
      description: `${source.description || 'Tool'} (copy)`,
      _fusionRaw: undefined,
      _instancesRaw: undefined,
      // Carrying the source's _registeredAssemblies forward would make
      // reconcile-on-open compare the copy's brand-new instances against the
      // SOURCE's registered (holder, OOH) pairs — since the clone keeps the
      // same holder/OOH values, its own fresh instances would match and get
      // flagged as "duplicate" of themselves. Clearing it lets the next load
      // rebuild it correctly from this tool's own metadata.
      _registeredAssemblies: undefined,
      // Keep the holder/OOH of each assembly but force fresh instance + assembly
      // ids so the copy gets its own Fusion entries.
      assemblies: (source.assemblies || []).map(a => ({
        ...a, assembly_id: undefined, instance_guid: undefined,
      })),
      machine_tool_number: null, // assign a fresh number on save — never reuse the source's
      merge_history: [],
      created_at: now,
      updated_at: now,
    };
    return addTool(copy);
  };

  // Merge selected job-tool fields back into a master tool with history tracking.
  // presetChanges: Array<{ masterPresetGuid, incomingPreset, selectedFields: Set }>
  // presetsToAdd:  Array<presetObject> — new presets to append
  // jobLink: { job_id, label } | null — the job (program # + part #, resolved
  //   to a jobs.json registry id by CommitStep) this sync came from. Linked to
  //   every preset touched by this commit (updated in place or added); when the
  //   commit touches NO presets, linked at tool level instead so it isn't lost.
  const mergeTool = async (masterTool, mergedFields, revisionNote, mergedBy, presetChanges = [], presetsToAdd = [], assemblyUpdate = null, jobLink = null) => {
    dispatch({ type: 'SAVE_START' });
    try {
      const previousValues = {};
      for (const field of Object.keys(mergedFields)) {
        previousValues[field] = masterTool[field];
      }
      const historyEntry = {
        merged_at: new Date().toISOString(),
        merged_by: mergedBy || 'unknown',
        fields_changed: Object.keys(mergedFields),
        revision_note: revisionNote,
        previous_values: previousValues,
        ...(presetChanges.length > 0 ? {
          presets_changed: presetChanges.map(c => ({
            preset_name: c.incomingPreset?.name || '?',
            fields: [...c.selectedFields],
          })),
        } : {}),
        ...(presetsToAdd.length > 0 ? {
          presets_added: presetsToAdd.map(p => p.name || 'Unnamed'),
        } : {}),
        ...(jobLink ? { job_linked: jobLink.label || jobLink.job_id } : {}),
      };
      let updated = {
        ...masterTool,
        ...mergedFields,
        updated_at: new Date().toISOString(),
        updated_by: mergedBy || '',
        revision_notes: revisionNote,
        merge_history: [...(masterTool.merge_history || []), historyEntry],
      };

      // Apply preset field patches and append new presets
      if (presetChanges.length > 0 || presetsToAdd.length > 0) {
        // Presets touched by this commit — the ones a job link attaches to.
        const touchedGuids = new Set([
          ...presetChanges.filter(c => c.selectedFields.size > 0).map(c => c.masterPresetGuid),
          ...presetsToAdd.map(p => p.guid),
        ]);
        const withJob = (p) => {
          if (!jobLink || !touchedGuids.has(p.guid)) return p;
          const ids = p.job_ids || [];
          return ids.includes(jobLink.job_id) ? p : { ...p, job_ids: [...ids, jobLink.job_id] };
        };
        const updatedPresets = (updated.presets || []).map(p => {
          const change = presetChanges.find(c => c.masterPresetGuid === p.guid);
          if (!change || change.selectedFields.size === 0) return withJob(p);
          const patch = {};
          for (const f of change.selectedFields) patch[f] = change.incomingPreset[f];
          return withJob({ ...p, ...patch });
        });
        for (const preset of presetsToAdd) {
          updatedPresets.push(withJob({ ...preset })); // preserve incoming guid (used for assembly linking)
        }
        updated.presets = updatedPresets;
        // Keep flat speed/feed fields in sync with first preset
        if (updatedPresets.length > 0) {
          const p0 = updatedPresets[0];
          updated.spindle_speed  = p0.n     ?? updated.spindle_speed;
          updated.cutting_feedrate = p0.v_f ?? updated.cutting_feedrate;
          updated.feed_per_tooth = p0.f_z   ?? updated.feed_per_tooth;
          updated.plunge_feedrate = p0.v_f_plunge ?? updated.plunge_feedrate;
          updated.lead_in_feedrate = p0.v_f_leadIn ?? updated.lead_in_feedrate;
          updated.lead_out_feedrate = p0.v_f_leadOut ?? updated.lead_out_feedrate;
          updated.feed_per_rev = p0.f_n     ?? updated.feed_per_rev;
          updated.cutting_speed = p0.v_c    ?? updated.cutting_speed;
        }
      }

      // A job link with no presets touched attaches at tool level — "this tool
      // was used on job X" is still worth keeping when only flat fields synced.
      if (jobLink && presetChanges.length === 0 && presetsToAdd.length === 0) {
        const ids = updated.job_ids || [];
        if (!ids.includes(jobLink.job_id)) updated.job_ids = [...ids, jobLink.job_id];
      }

      // Apply assembly create/link update (metadata only — included in the same write)
      if (assemblyUpdate) {
        const assemblies = [...(updated.assemblies || [])];
        if (assemblyUpdate.type === 'create') {
          assemblies.push(assemblyUpdate.assembly);
        } else if (assemblyUpdate.type === 'link') {
          const i = assemblies.findIndex(a => a.assembly_id === assemblyUpdate.assembly.assembly_id);
          if (i >= 0) assemblies[i] = assemblyUpdate.assembly;
        }
        updated.assemblies = assemblies;
      }

      const written = await writeLogicalTool(updated);
      dispatch({ type: 'UPDATE_TOOL', tool: written });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify('Merged job values to master library', 'success');
      return written;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Merge failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  };

  const deleteTool = async (id) => {
    dispatch({ type: 'SAVE_START' });
    try {
      const tool = toolsRef.current.find(t => t.id === id);
      const tid = tool?.tracking_id || id;

      // Metadata-only delete when the tool has no Fusion entry (a per-tool
      // no-Fusion tool) OR the whole Fusion integration is disabled shop-wide.
      // In disabled mode every write is metadata-only — writeLogicalTool routes
      // that way and loadTools builds from metadata — so delete follows the same
      // contract and never round-trips APS while "Fusion sync is off". A
      // formerly-linked tool's stale Fusion entry is intentionally left untouched:
      // re-enabling Fusion is the point at which it resurfaces and can be
      // reconciled, rather than mutating the Fusion library while sync is off.
      const fusionDisabled = shopSettingsRef.current?.integrations?.fusion?.enabled === false;
      if (tool?.no_fusion_link === true || fusionDisabled) {
        if (googleRef.current) await driveService.deleteMetadata(tid);
        dispatch({ type: 'DELETE_TOOL', id });
        dispatch({ type: 'SAVE_SUCCESS' });
        notify('Tool deleted', 'success');
        return;
      }

      const library_id = tool?.library_id || defaultToolLibraryId(shopSettingsRef.current);
      const fusionList = await downloadFusionList(library_id);
      let remaining;
      if (tool?.tracking_id) {
        // Delete every instance carrying this tracking ID.
        remaining = fusionList.filter(f => readTrackingId(f) !== tid);
      } else {
        // Legacy untracked tool — delete by its instance guids.
        const guids = new Set((tool?._instancesRaw || []).map(r => r.guid).concat([id]));
        remaining = fusionList.filter(f => !guids.has(f.guid));
      }
      await uploadFusionList(library_id, remaining);
      if (googleRef.current) await driveService.deleteMetadata(tid);
      dispatch({ type: 'DELETE_TOOL', id });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify('Tool deleted', 'success');
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Delete failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  };

  // ─── Assembly CRUD (each assembly = one Fusion instance) ──────────────────
  const addAssembly = async (toolId, assembly) => {
    const tool = toolsRef.current.find(t => t.id === toolId);
    if (!tool) throw new Error('Tool not found');
    dispatch({ type: 'SAVE_START' });
    try {
      const next = {
        ...tool,
        assemblies: [...(tool.assemblies || []), {
          ...assembly,
          assembly_id: generateAssemblyId(),
          instance_guid: generateId(),
          source: assembly.source || 'manual',
          created_at: new Date().toISOString(),
        }],
        updated_at: new Date().toISOString(),
      };
      const written = await writeLogicalTool(next);
      dispatch({ type: 'UPDATE_TOOL', tool: written });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify('Assembly added — new tool instance created', 'success');
      return written;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Add assembly failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  };

  const updateAssembly = async (toolId, assemblyId, patch) => {
    const tool = toolsRef.current.find(t => t.id === toolId);
    if (!tool) throw new Error('Tool not found');
    dispatch({ type: 'SAVE_START' });
    try {
      const assemblies = (tool.assemblies || []).map(a =>
        a.assembly_id === assemblyId ? { ...a, ...patch } : a);
      const written = await writeLogicalTool({ ...tool, assemblies, updated_at: new Date().toISOString() });
      dispatch({ type: 'UPDATE_TOOL', tool: written });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify('Assembly updated', 'success');
      return written;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Update assembly failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  };

  const deleteAssembly = async (toolId, assemblyId) => {
    const tool = toolsRef.current.find(t => t.id === toolId);
    if (!tool) throw new Error('Tool not found');
    if ((tool.assemblies || []).length <= 1) {
      throw new Error('A tool must keep at least one assembly. Delete the tool instead.');
    }
    dispatch({ type: 'SAVE_START' });
    try {
      const assemblies = tool.assemblies.filter(a => a.assembly_id !== assemblyId);
      const written = await writeLogicalTool({ ...tool, assemblies, updated_at: new Date().toISOString() });
      dispatch({ type: 'UPDATE_TOOL', tool: written });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify('Assembly removed — tool instance deleted', 'success');
      return written;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Delete assembly failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  };

  // ─── Reconcile a tool against the live Fusion library ─────────────────────
  // Detects entries that were dumped straight into the Fusion library (sharing
  // this tool's tracking ID or ProShop number) instead of going through Sync
  // Job, and classifies each as a redundant duplicate, a new assembly, or a
  // conflict. Read-only — returns the classification for the UI to act on.
  const reconcileTool = async (tool) => {
    const empty = { duplicates: [], newAssemblies: [], conflicts: [] };
    if (!tool) return empty;
    const tid = tool.tracking_id || null;
    const pid = String(tool.tool_id || '').trim();
    if (!tid && !pid) return empty;

    const rawList = await fetchRawLibrary(tool.library_id);
    const matchingRaws = rawList.filter(r => {
      const rtid = readTrackingId(r);
      const rpid = String(r['product-id'] || '').trim();
      return (tid && rtid === tid) || (pid && rpid === pid);
    });
    if (matchingRaws.length <= 1) return empty;

    return classifyStrays({
      matchingRaws,
      registeredAssemblies: tool._registeredAssemblies || [],
      canonicalRaw: tool._fusionRaw || null,
    });
  };

  // Apply reconciliation decisions in a single library write: adopt selected
  // stray entries as registered assemblies (keyed by their own guid) and drop
  // the rest. writeLogicalTool removes every entry this tool owns (its tracking
  // ID + the supplied stray guids) before re-appending one clean instance per
  // assembly, so adopted entries are normalized to the tool's shared fields.
  const applyReconcile = async (tool, { adopt = [], dropRaws = [] } = {}) => {
    if (!tool) throw new Error('Tool not found');
    const now = new Date().toISOString();
    const dropSet = new Set(dropRaws.map(r => r.guid));

    dispatch({ type: 'SAVE_START' });
    try {
      let assemblies = (tool.assemblies || []).filter(a => !dropSet.has(a.instance_guid));
      for (const r of adopt) {
        if (assemblies.some(a => a.instance_guid === r.guid)) continue;
        assemblies.push({
          assembly_id: generateAssemblyId(),
          instance_guid: r.guid,
          holder_guid: r.holder?.guid || null,
          holder_description: r.holder?.description || '',
          ooh: readOohFromFusion(r) ?? null,
          notes: '',
          source: 'fusion',
          created_at: now,
        });
      }
      if (assemblies.length === 0) {
        throw new Error('A tool must keep at least one assembly.');
      }

      // Make sure every stray we acted on is part of _instancesRaw so the write
      // drops it (covers entries with a different tracking ID, matched by ProShop #).
      const rawMap = new Map((tool._instancesRaw || []).map(r => [r.guid, r]));
      for (const r of [...dropRaws, ...adopt]) if (r?.guid) rawMap.set(r.guid, r);

      const written = await writeLogicalTool({
        ...tool,
        assemblies,
        _instancesRaw: [...rawMap.values()],
        updated_at: now,
      });
      dispatch({ type: 'UPDATE_TOOL', tool: written });
      dispatch({ type: 'SAVE_SUCCESS' });
      const added = adopt.length, removed = dropRaws.length;
      const parts = [];
      if (added) parts.push(`added ${added} assembl${added === 1 ? 'y' : 'ies'}`);
      if (removed) parts.push(`removed ${removed} duplicate entr${removed === 1 ? 'y' : 'ies'}`);
      notify(`Reconciled — ${parts.join(', ') || 'no changes'}`, 'success');
      return written;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Reconcile failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  };

  // ─── Promote / detach (no-Fusion ↔ Fusion) — Fusion-decoupling Phase B ─────
  // Promote: a no-Fusion tool becomes Fusion-linked. Flip the flag and save — the
  // LINKED writeLogicalTool path mints the Fusion instances and stores their guids.
  const promoteToolToFusion = async (toolId) => {
    const tool = toolsRef.current.find(t => t.id === toolId);
    if (!tool) throw new Error('Tool not found');
    if (!tool.no_fusion_link) return tool; // already linked
    if (shopSettingsRef.current?.integrations?.fusion?.enabled === false) {
      throw new Error('Fusion sync is off — re-enable it in Settings → Fusion Libraries to create this tool in Fusion');
    }
    const library_id = tool.library_id || defaultToolLibraryId(shopSettingsRef.current);
    if (!library_id) throw new Error('Link a Fusion library first (Settings → Fusion Libraries)');
    dispatch({ type: 'SAVE_START' });
    try {
      const written = await writeLogicalTool({
        ...tool, no_fusion_link: false, library_id, updated_at: new Date().toISOString(),
      });
      dispatch({ type: 'UPDATE_TOOL', tool: written });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify('Created in the Fusion library', 'success');
      return written;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Create in Fusion failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  };

  // Detach: a Fusion-linked tool becomes no-Fusion. Remove its Fusion instances
  // from the library, then write it metadata-only (instance guids cleared so a
  // later promote mints fresh entries). All app/metadata data is untouched.
  const detachToolFromFusion = async (toolId) => {
    const tool = toolsRef.current.find(t => t.id === toolId);
    if (!tool) throw new Error('Tool not found');
    if (tool.no_fusion_link) return tool; // already detached
    if (shopSettingsRef.current?.integrations?.fusion?.enabled === false) {
      throw new Error('Fusion sync is off — re-enable it to detach this tool from Fusion');
    }
    if (!googleRef.current) throw new Error('Connect Google Drive to detach (the tool becomes metadata-only)');
    dispatch({ type: 'SAVE_START' });
    try {
      // Remove this tool's entries from its Fusion library (by tracking ID + the
      // guids of the instances it currently owns).
      const library_id = tool.library_id || defaultToolLibraryId(shopSettingsRef.current);
      const fusionList = await downloadFusionList(library_id);
      const tid = tool.tracking_id || null;
      const dropGuids = new Set((tool._instancesRaw || []).map(r => r.guid));
      const remaining = fusionList.filter(f =>
        !(tid && readTrackingId(f) === tid) && !dropGuids.has(f.guid));
      await uploadFusionList(library_id, remaining);
      // Now write metadata-only (writeLogicalTool takes the no_fusion_link branch).
      const written = await writeLogicalTool({
        ...tool,
        no_fusion_link: true,
        library_id: null,
        assemblies: (tool.assemblies || []).map(a => ({ ...a, instance_guid: null })),
        updated_at: new Date().toISOString(),
      });
      dispatch({ type: 'UPDATE_TOOL', tool: written });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify('Detached from Fusion — now a no-Fusion tool', 'success');
      return written;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Detach failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  };

  // Include/exclude a tool from one of the three ID systems (Tool ID / Machine
  // Number / Location). Membership is a metadata-only field — this NEVER touches
  // the Fusion library, just patches the tool's metadata record and updates memory.
  const setIdSystemExclusion = async (toolId, system, excluded) => {
    const tool = toolsRef.current.find(t => t.id === toolId);
    if (!tool) throw new Error('Tool not found');
    const id_system_exclusions = setToolExclusion(tool, system, excluded);
    if (googleRef.current) {
      try {
        const metaList = await driveService.loadMetadata();
        const tid = tool.tracking_id || tool.id;
        const idx = metaList.findIndex(m => m.id === tid);
        if (idx >= 0) metaList[idx] = { ...metaList[idx], id_system_exclusions };
        else metaList.push(buildMetadataTool({ ...tool, id_system_exclusions }));
        await driveService.saveAllMetadata(metaList);
      } catch (err) {
        if (err.code === 'TOKEN_EXPIRED') dispatch({ type: 'GOOGLE_EXPIRED' });
        notify(`Could not update membership: ${err.message}`, 'error', 7000);
        throw err;
      }
    }
    dispatch({ type: 'UPDATE_TOOL', tool: { ...tool, id_system_exclusions } });
    return { ...tool, id_system_exclusions };
  };

  return {
    writeLogicalTool,
    saveTool, assignToolLocation, normalizeLocationSystem,
    addTool, cloneTool, mergeTool, deleteTool,
    addAssembly, updateAssembly, deleteAssembly,
    reconcileTool, applyReconcile,
    promoteToolToFusion, detachToolFromFusion,
    setIdSystemExclusion,
  };
}
