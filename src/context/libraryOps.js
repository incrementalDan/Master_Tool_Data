// Shop-global bulk library operations: full-library save, machine-number
// renumber, tool-ID assign/re-number, and the one-time multi-instance
// normalization. Each downloads ALL linked libraries, operates across the
// union, then writes each library back partitioned. Created once by
// AppProvider via createLibraryOps(ctx).
import * as driveService from '../services/driveService.js';
import {
  generateId, generateAssemblyId, generateTrackingId,
  groupByTrackingId, buildLogicalTool, splitToFusionInstances, readTrackingId,
  generateMachineNumbers, applyMachineNumberToFusion, applyToolIdToFusion,
  fusionToolToInternal, mergeFusionAndMetadata, readOohFromFusion,
  combineToolsByToolId, buildMetadataTool, materializeUnlinkedTools,
} from '../schema/toolSchema.js';
import { composeToolId, nextSequential, isCounterMode } from '../utils/toolIdSystem.js';
import { isExcludedFrom } from '../utils/idSystems.js';
import { resolveLocationString } from '../utils/locationSystem.js';
import { composePresetName, opTypeWord, parsePresetName, materialNameCode, HOLE_MAKING_TYPES } from '../utils/presetNaming.js';
import { holderShortName } from '../utils/holderNaming.js';
import { defaultToolLibraryId, machineNumberArgs } from './appState.js';

export function createLibraryOps(ctx) {
  const {
    dispatch, notify,
    uploadFusionList, downloadAllLibraries, markSetupStepInSettings,
    toolsRef, holdersRef, shopSettingsRef, googleRef, demoModeRef, materialsRef,
  } = ctx;

  const saveFullLibrary = async (tools) => {
    dispatch({ type: 'SAVE_START' });
    try {
      const holders = holdersRef.current || [];
      const defaultLib = defaultToolLibraryId(shopSettingsRef.current);
      const libById = new Map((shopSettingsRef.current?.tool_libraries || []).map(l => [l.id, l]));
      // Auto-combine any same-ProShop-number duplicates before writing the full
      // library (covers bulk import, which routes through here).
      const combinedTools = combineToolsByToolId(tools);

      // Partition tools by their destination library (their own library_id, or the
      // default for new/untagged tools). Each represented library is FULL-REPLACED
      // with its subset, so libraries not represented here are left untouched.
      const byLibrary = new Map();
      const allMeta = [];
      for (const tool of combinedTools) {
        const tracking_id = tool.tracking_id || generateTrackingId();
        // No-Fusion tool (Fusion-decoupling Phase B): metadata only — no Fusion
        // instances minted, so a ProShop-imported no-match row no longer creates a
        // placeholder entry in the Fusion library. It's rebuilt below via
        // materializeUnlinkedTools so it still shows in the library.
        if (tool.no_fusion_link === true) {
          allMeta.push(buildMetadataTool({ ...tool, tracking_id }));
          continue;
        }
        const libId = tool.library_id || defaultLib;
        const assemblies = (tool.assemblies && tool.assemblies.length > 0)
          ? tool.assemblies
          : [{
              holder_guid: tool.selected_holder_guid || null,
              holder_description: '',
              ooh: tool.ooh ?? null,
              source: 'manual',
              created_at: new Date().toISOString(),
            }];
        const withIds = assemblies.map(a => ({
          ...a,
          assembly_id: a.assembly_id || generateAssemblyId(),
          instance_guid: a.instance_guid || generateId(),
        }));
        const { fusionInstances, metadataTool } =
          splitToFusionInstances({ ...tool, tracking_id, assemblies: withIds }, holders);
        if (!byLibrary.has(libId)) byLibrary.set(libId, []);
        byLibrary.get(libId).push(...fusionInstances);
        allMeta.push(metadataTool);
      }

      // Write each represented library, then persist all metadata once (global).
      for (const [libId, fusionList] of byLibrary) {
        await uploadFusionList(libId, fusionList);
      }

      // Merge-by-id into the existing metadata file rather than replacing it.
      // saveAllMetadata rewrites the WHOLE file, but this bulk save only carries
      // the Fusion-built tools it was handed. A blind replace would delete every
      // record NOT in this set: no-Fusion tools (metadata is their ONLY store),
      // conflict tools held back for review, and dormant orphan metadata the
      // orphan-ghost guard (isUnlinkedMeta) relies on persisting. So load the
      // current file and overlay this save's records on top of it. (See G1 in
      // DECOUPLING_FOLLOWUP_FINDINGS.md.) Deletion still happens explicitly via
      // deleteTool's own deleteMetadata call — never as a side effect of a save.
      let effectiveMeta = allMeta;
      if (googleRef.current) {
        const existing = await driveService.loadMetadata();
        const metaById = new Map((existing || []).map(m => [m.id, m]));
        for (const m of allMeta) metaById.set(m.id, m);
        effectiveMeta = [...metaById.values()];
        await driveService.saveAllMetadata(effectiveMeta);
      }

      // Rebuild logical tools from what we wrote so in-memory state matches,
      // re-tagging each with its source library. Uses the full merged set so a
      // Fusion tool's freshly-written metadata wins over any stale copy.
      const metaByTracking = new Map(effectiveMeta.map(m => [m.id, m]));
      const rebuilt = [];
      let untrackedTotal = 0;
      for (const [libId, fusionList] of byLibrary) {
        const lib = libById.get(libId);
        const { groups, untracked } = groupByTrackingId(fusionList);
        untrackedTotal += untracked.length;
        const tag = (t) => ({ ...t, library_id: libId, library_name: lib?.fileName });
        for (const [, raws] of groups) rebuilt.push(tag(buildLogicalTool(raws, metaByTracking)));
        for (const raw of untracked) rebuilt.push(tag(buildLogicalTool([raw], metaByTracking)));
      }

      // Re-materialize the no-Fusion tools from the FULL metadata set — not just
      // this save's records — so no-Fusion tools that weren't part of this save
      // (e.g. during a Fusion-only normalizeLibrary, or when a single-tool bulk
      // save is run) still survive in the in-memory library. Guarded by
      // isUnlinkedMeta inside the helper, deduped against the rebuilt set.
      const finalRebuilt = materializeUnlinkedTools(rebuilt, effectiveMeta);

      dispatch({ type: 'SET_TOOLS', tools: finalRebuilt, needsNormalize: untrackedTotal > 0 });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify(`Saved ${finalRebuilt.length} tools to library`, 'success');
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Save failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  };

  // Reassign machine tool numbers to every tool starting at #30, in current
  // library (array) order, skipping the reserved numbers. Destructive — used
  // only by the Renumber Library action and the initial-import flow. Always
  // re-reads from APS immediately before writing.
  const renumberLibrary = async () => {
    dispatch({ type: 'SAVE_START' });
    try {
      // Machine numbers are shop-global: gather entries from EVERY library into one
      // list (remembering each entry's source library), number across the union,
      // then write each library back.
      const perLib = await downloadAllLibraries();
      const entryLib = new Map();
      const fusionList = [];
      const libNameById = new Map();
      for (const { libraryId, library, list } of perLib) {
        libNameById.set(libraryId, library.fileName);
        for (const f of list) { entryLib.set(f, libraryId); fusionList.push(f); }
      }
      const metaList = googleRef.current ? await driveService.loadMetadata() : [];
      const metaByTracking = new Map(metaList.map(m => [m.id, m]));

      // One number per logical tool. Tracking-ID groups (in encounter order)
      // first, then each untracked entry as its own group.
      const { groups, untracked } = groupByTrackingId(fusionList);
      const orderedGroups = [...groups.values(), ...untracked.map(r => [r])];

      // Build the ordered list of logical tools to renumber = Fusion groups +
      // no-Fusion (metadata-only) tools, MINUS any excluded from the Machine Number
      // system (they keep their current number and don't consume one in the run).
      const fusionItems = orderedGroups
        .map(raws => ({ raws, logical: buildLogicalTool(raws, metaByTracking) }))
        .filter(it => !isExcludedFrom(it.logical, 'machine_number'));
      const noFusionItems = (toolsRef.current || [])
        .filter(t => t.no_fusion_link && !isExcludedFrom(t, 'machine_number'));
      const renumberCount = fusionItems.length + noFusionItems.length;
      const numbers = generateMachineNumbers(renumberCount, ...machineNumberArgs(shopSettingsRef.current));

      let ni = 0;
      for (const it of fusionItems) {
        const num = numbers[ni++];
        it.raws.forEach(r => applyMachineNumberToFusion(r, num));
        const tid = readTrackingId(it.raws[0]);
        if (tid) {
          const meta = metaByTracking.get(tid) || { id: tid };
          metaByTracking.set(tid, { ...meta, machine_tool_number: num });
        }
      }
      for (const t of noFusionItems) {
        const num = numbers[ni++];
        const tid = t.tracking_id || t.id;
        const meta = metaByTracking.get(tid) || { id: tid };
        metaByTracking.set(tid, { ...meta, machine_tool_number: num, no_fusion_link: true });
      }

      // Write each library back (partition entries by their source library).
      for (const { libraryId } of perLib) {
        await uploadFusionList(libraryId, fusionList.filter(f => entryLib.get(f) === libraryId));
      }
      if (googleRef.current) await driveService.saveAllMetadata([...metaByTracking.values()]);

      // Rebuild the in-memory library so the UI reflects the new numbers (incl. the
      // no-Fusion tools, rebuilt from their updated metadata).
      const tools = [];
      const tagOf = (raws) => { const lib = entryLib.get(raws[0]); return { library_id: lib, library_name: libNameById.get(lib) }; };
      for (const [, raws] of groups) tools.push({ ...buildLogicalTool(raws, metaByTracking), ...tagOf(raws) });
      for (const raw of untracked) tools.push({ ...buildLogicalTool([raw], metaByTracking), ...tagOf([raw]) });
      const finalTools = materializeUnlinkedTools(tools, [...metaByTracking.values()]);
      dispatch({ type: 'SET_TOOLS', tools: finalTools });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify(`Renumbered ${renumberCount} tools starting at #30`, 'success');
      return renumberCount;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Renumber failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  };

  // Assign generated tool IDs to logical tools that don't have one yet, per the
  // configured tool_id_system. tool_id is metadata-owned — writes the value to
  // metadata (source of truth) and mirrors it to Fusion's native product-id —
  // and never touches tools that already have an ID. No-op in proshop/other_erp
  // modes (IDs aren't generated). Always re-reads from APS before writing.
  const assignToolIds = async () => {
    const config = shopSettingsRef.current?.tool_id_system || {};
    const { mode } = config;
    if (mode === 'proshop' || mode === 'other_erp') {
      notify('IDs are not generated in this mode', 'info');
      return 0;
    }
    // Demo mode: pure in-memory path — no APS/Drive. Reassign ALL tools (not just
    // unassigned ones) so the sandbox is repeatable: flip the scheme, re-run, and
    // watch every tool re-render. Reset by refreshing the page.
    if (demoModeRef.current) {
      let counter = isCounterMode(mode) ? nextSequential(config.start, config.skip) : null;
      let assigned = 0;
      const tools = toolsRef.current.map(t => {
        if (isExcludedFrom(t, 'tool_id')) return t;   // excluded from the Tool ID system
        const value = composeToolId(config, t, counter);
        if (!value) return t;
        assigned++;
        if (counter !== null) counter = nextSequential(counter + 1, config.skip);
        return { ...t, tool_id: value };
      });
      dispatch({ type: 'SET_TOOLS', tools });
      notify(`Assigned IDs to ${assigned} tool${assigned === 1 ? '' : 's'} (demo — not saved)`, 'success');
      return assigned;
    }
    dispatch({ type: 'SAVE_START' });
    try {
      // Shop-global IDs: gather entries across every library, assign across the
      // union, then write each library back.
      const perLib = await downloadAllLibraries();
      const entryLib = new Map();
      const fusionList = [];
      const libNameById = new Map();
      for (const { libraryId, library, list } of perLib) {
        libNameById.set(libraryId, library.fileName);
        for (const f of list) { entryLib.set(f, libraryId); fusionList.push(f); }
      }
      const metaList = googleRef.current ? await driveService.loadMetadata() : [];
      const metaByTracking = new Map(metaList.map(m => [m.id, m]));

      const { groups, untracked } = groupByTrackingId(fusionList);
      const orderedGroups = [...groups.values(), ...untracked.map(r => [r])];

      let counter = isCounterMode(mode) ? nextSequential(config.start, config.skip) : null;
      let assigned = 0;
      const idLocSystems = shopSettingsRef.current?.location_config?.systems || [];
      for (const raws of orderedGroups) {
        const logical = buildLogicalTool(raws, metaByTracking);
        if (logical.tool_id) continue;          // already has an ID — skip
        if (isExcludedFrom(logical, 'tool_id')) continue;   // excluded from the Tool ID system
        // location mode: derive the ID from the structured location, not the
        // (possibly stale) Fusion vendor string carried on the raw entry.
        if (logical.tool_location) {
          const composed = resolveLocationString(logical.tool_location, idLocSystems);
          if (composed) logical.location = composed;
        }
        const value = composeToolId(config, logical, counter);
        if (!value) continue;                       // mode can't produce one (e.g. no machine #)
        raws.forEach(r => applyToolIdToFusion(r, value));
        // tool_id is metadata-owned — record it in metadata (source of truth) too,
        // mirrored to Fusion's product-id above.
        const tid = readTrackingId(raws[0]);
        if (tid) {
          const meta = metaByTracking.get(tid) || { id: tid };
          metaByTracking.set(tid, { ...meta, tool_id: value });
        }
        assigned++;
        if (counter !== null) counter = nextSequential(counter + 1, config.skip);
      }

      // No-Fusion tools (metadata-only) are real tools — assign IDs to them too,
      // continuing the same counter sequence. Excluded tools are skipped. They
      // have no Fusion entry, so only their metadata is updated.
      for (const t of (toolsRef.current || [])) {
        if (!t.no_fusion_link || t.tool_id) continue;
        if (isExcludedFrom(t, 'tool_id')) continue;
        const logical = { ...t };
        if (logical.tool_location) {
          const composed = resolveLocationString(logical.tool_location, idLocSystems);
          if (composed) logical.location = composed;
        }
        const value = composeToolId(config, logical, counter);
        if (!value) continue;
        const tid = t.tracking_id || t.id;
        const meta = metaByTracking.get(tid) || { id: tid };
        metaByTracking.set(tid, { ...meta, tool_id: value, no_fusion_link: true });
        assigned++;
        if (counter !== null) counter = nextSequential(counter + 1, config.skip);
      }

      if (assigned === 0) { dispatch({ type: 'SAVE_SUCCESS' }); notify('No unassigned tools to ID', 'info'); return 0; }

      for (const { libraryId } of perLib) {
        await uploadFusionList(libraryId, fusionList.filter(f => entryLib.get(f) === libraryId));
      }
      // tool_id is metadata-owned (mirrored to Fusion's product-id) — persist it.
      if (googleRef.current) await driveService.saveAllMetadata([...metaByTracking.values()]);

      // Rebuild the in-memory library so the new IDs show immediately. Include the
      // no-Fusion tools (rebuilt from their updated metadata via the marker guard).
      const tools = [];
      const tagOf = (raws) => { const lib = entryLib.get(raws[0]); return { library_id: lib, library_name: libNameById.get(lib) }; };
      for (const [, raws] of groups) tools.push({ ...buildLogicalTool(raws, metaByTracking), ...tagOf(raws) });
      for (const raw of untracked) tools.push({ ...buildLogicalTool([raw], metaByTracking), ...tagOf([raw]) });
      const finalTools = materializeUnlinkedTools(tools, [...metaByTracking.values()]);
      dispatch({ type: 'SET_TOOLS', tools: finalTools });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify(`Assigned IDs to ${assigned} tool${assigned === 1 ? '' : 's'}`, 'success');
      return assigned;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Assign IDs failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  };

  // Re-number EVERY tool to the current tool_id_system scheme — the action to run
  // after switching ID schemes. Unlike assignToolIds (which only fills blanks),
  // this overwrites every existing ID and retires the old value into the tool's
  // metadata `legacy_ids[]` so old job files / CSVs still match and search still
  // finds the tool. New IDs skip only an EXACT collision with a retired ID
  // (partial digit overlap with a different prefix is fine). Writes Fusion AND
  // metadata. No-op in proshop/other_erp modes.
  //
  // `consolidateIds`: tool_ids of duplicate clusters (one tool_id shared across
  // multiple Fusion tracking-ID groups — a fold from human-error data) that the
  // user chose to MERGE — all the cluster's groups get ONE shared new ID instead
  // of being split into separate IDs. Clusters not listed are split (default
  // per-tracking-group behavior). See duplicateIdClusters (toolSchema.js).
  const renumberAllToolIds = async (consolidateIds = []) => {
    const config = shopSettingsRef.current?.tool_id_system || {};
    const { mode } = config;
    if (mode === 'proshop' || mode === 'other_erp') {
      notify('IDs are not generated in this mode', 'info');
      return 0;
    }
    const uniqPush = (arr, v) => (arr.includes(v) ? arr : [...arr, v]);

    // Demo mode: pure in-memory, reassign all, retire old IDs into legacy_ids.
    if (demoModeRef.current) {
      let counter = isCounterMode(mode) ? nextSequential(config.start, config.skip) : null;
      let assigned = 0;
      const tools = toolsRef.current.map(t => {
        if (isExcludedFrom(t, 'tool_id')) return t;   // excluded from the Tool ID system
        const value = composeToolId(config, t, counter);
        if (!value) return t;
        if (counter !== null) counter = nextSequential(counter + 1, config.skip);
        assigned++;
        const old = t.tool_id;
        const legacy_ids = (old && old !== value)
          ? uniqPush((t.legacy_ids || []).filter(l => l !== value), old)
          : (t.legacy_ids || []);
        return { ...t, tool_id: value, legacy_ids };
      });
      dispatch({ type: 'SET_TOOLS', tools });
      notify(`Re-numbered ${assigned} tool${assigned === 1 ? '' : 's'} (demo — not saved)`, 'success');
      return assigned;
    }

    dispatch({ type: 'SAVE_START' });
    try {
      // Shop-global re-number across every library.
      const perLib = await downloadAllLibraries();
      const entryLib = new Map();
      const fusionList = [];
      const libNameById = new Map();
      for (const { libraryId, library, list } of perLib) {
        libNameById.set(libraryId, library.fileName);
        for (const f of list) { entryLib.set(f, libraryId); fusionList.push(f); }
      }
      const metaList = googleRef.current ? await driveService.loadMetadata() : [];
      const metaByTracking = new Map(metaList.map(m => [m.id, m]));

      const { groups, untracked } = groupByTrackingId(fusionList);
      const orderedGroups = [...groups.values(), ...untracked.map(r => [r])];

      // Avoid re-issuing an ID whose EXACT full value was retired into a tool's
      // legacy_ids. Partial overlap (same trailing digits, different prefix) is
      // fine — only a full-string collision is skipped.
      const retiredExact = new Set();
      for (const m of metaList) {
        for (const lid of (m.legacy_ids || [])) retiredExact.add(String(lid));
      }

      // Duplicate clusters the user chose to MERGE (one shared new ID across all
      // their tracking groups) instead of letting re-number split them. Keyed by
      // the shared current tool_id.
      const mergedIds = new Set(consolidateIds);
      const clusterValue = new Map();   // tool_id -> the one new ID for a merged cluster

      const idLocSystems = shopSettingsRef.current?.location_config?.systems || [];
      let counter = isCounterMode(mode) ? nextSequential(config.start, config.skip) : null;
      let assigned = 0;
      for (const raws of orderedGroups) {
        const logical = buildLogicalTool(raws, metaByTracking);
        if (isExcludedFrom(logical, 'tool_id')) continue;   // excluded from the Tool ID system
        const oldId = logical.tool_id;
        // location mode: derive the ID from the structured location (authoritative),
        // not the raw Fusion vendor string.
        if (logical.tool_location) {
          const composed = resolveLocationString(logical.tool_location, idLocSystems);
          if (composed) logical.location = composed;
        }

        let value;
        if (oldId && mergedIds.has(oldId) && clusterValue.has(oldId)) {
          // A later tracking group of a merged duplicate cluster — reuse its one ID
          // (don't consume a counter value).
          value = clusterValue.get(oldId);
        } else {
          value = composeToolId(config, logical, counter);
          if (!value) continue;                      // mode can't produce one (e.g. no machine #)
          // Skip only an exact collision with a retired ID — bump and recompose.
          while (counter !== null && retiredExact.has(value)) {
            counter = nextSequential(counter + 1, config.skip);
            value = composeToolId(config, logical, counter);
          }
          if (counter !== null) counter = nextSequential(counter + 1, config.skip);
          if (oldId && mergedIds.has(oldId)) clusterValue.set(oldId, value);
        }
        assigned++;

        const tid = readTrackingId(raws[0]);
        if (tid) {
          // tool_id is metadata-owned — write the new value to metadata (source of
          // truth) and mirror it to Fusion's product-id below. Retire the old value.
          const meta = metaByTracking.get(tid) || { id: tid };
          const legacy_ids = (oldId && oldId !== value)
            ? uniqPush((meta.legacy_ids || []).filter(l => l !== value), oldId)
            : (meta.legacy_ids || []);
          metaByTracking.set(tid, { ...meta, tool_id: value, legacy_ids });
        }
        raws.forEach(r => applyToolIdToFusion(r, value));
      }

      // No-Fusion tools (metadata-only) — re-number them too, continuing the same
      // counter, retiring old IDs into legacy_ids. Excluded tools are skipped.
      for (const t of (toolsRef.current || [])) {
        if (!t.no_fusion_link) continue;
        if (isExcludedFrom(t, 'tool_id')) continue;
        const oldId = t.tool_id;
        const logical = { ...t };
        if (logical.tool_location) {
          const composed = resolveLocationString(logical.tool_location, idLocSystems);
          if (composed) logical.location = composed;
        }
        let value = composeToolId(config, logical, counter);
        if (!value) continue;
        while (counter !== null && retiredExact.has(value)) {
          counter = nextSequential(counter + 1, config.skip);
          value = composeToolId(config, logical, counter);
        }
        if (counter !== null) counter = nextSequential(counter + 1, config.skip);
        assigned++;
        const tid = t.tracking_id || t.id;
        const meta = metaByTracking.get(tid) || { id: tid };
        const legacy_ids = (oldId && oldId !== value)
          ? uniqPush((meta.legacy_ids || []).filter(l => l !== value), oldId)
          : (meta.legacy_ids || []);
        metaByTracking.set(tid, { ...meta, tool_id: value, legacy_ids, no_fusion_link: true });
      }

      if (assigned === 0) { dispatch({ type: 'SAVE_SUCCESS' }); notify('No tools to re-number', 'info'); return 0; }

      for (const { libraryId } of perLib) {
        await uploadFusionList(libraryId, fusionList.filter(f => entryLib.get(f) === libraryId));
      }
      // tool_id (metadata-owned) and legacy_ids both live in metadata — persist them.
      if (googleRef.current) await driveService.saveAllMetadata([...metaByTracking.values()]);

      const tools = [];
      const tagOf = (raws) => { const lib = entryLib.get(raws[0]); return { library_id: lib, library_name: libNameById.get(lib) }; };
      for (const [, raws] of groups) tools.push({ ...buildLogicalTool(raws, metaByTracking), ...tagOf(raws) });
      for (const raw of untracked) tools.push({ ...buildLogicalTool([raw], metaByTracking), ...tagOf([raw]) });
      const finalTools = materializeUnlinkedTools(tools, [...metaByTracking.values()]);
      dispatch({ type: 'SET_TOOLS', tools: finalTools });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify(`Re-numbered ${assigned} tool${assigned === 1 ? '' : 's'}`, 'success');
      return assigned;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Re-number failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  };

  // ─── One-time normalization (transition to the multi-instance model) ──────
  // Assigns tracking IDs to untracked tools, fans each out into instances per
  // its existing metadata assemblies, renames presets to the naming convention,
  // and extracts operation_type (from the name, or from `opOverrides` keyed by
  // preset guid). Re-keys metadata from guid → tracking_id by overwriting the
  // whole file. Idempotent: already-tracked tools are left as-is.
  const normalizeLibrary = async (opOverrides = {}) => {
    dispatch({ type: 'SAVE_START' });
    try {
      const holders = holdersRef.current || [];
      const perLib = await downloadAllLibraries();
      const metaList = googleRef.current ? await driveService.loadMetadata() : [];
      const metaByGuid = new Map(metaList.map(m => [m.id, m]));
      const metaByTracking = new Map(metaList.map(m => [m.id, m]));

      // Normalize each library independently, tagging produced tools with their
      // source library so saveFullLibrary writes each back to the right file.
      const cleanTools = [];
      const conflictTools = [];
      let dupCount = 0;
      let untrackedCount = 0;
      for (const { libraryId, library, list: fusionList } of perLib) {
      const { groups, untracked } = groupByTrackingId(fusionList);
      untrackedCount += untracked.length;
      const logicalTools = [];

      // Already-tracked tools: rebuild unchanged.
      for (const [, raws] of groups) logicalTools.push(buildLogicalTool(raws, metaByTracking));

      // Untracked tools: assign a tracking ID and fan out per metadata assemblies.
      for (const raw of untracked) {
        const meta = metaByGuid.get(raw.guid) || null;
        const internal = fusionToolToInternal(raw);
        const merged = mergeFusionAndMetadata(internal, meta);
        const tracking_id = generateTrackingId();
        const now = new Date().toISOString();

        const oldAssemblies = (meta?.assemblies || []).filter(Boolean);
        const rawAssemblies = oldAssemblies.length
          ? oldAssemblies.map((a, i) => ({
              assembly_id: a.assembly_id || generateAssemblyId(),
              instance_guid: i === 0 ? raw.guid : generateId(),
              holder_guid: a.holder_guid || null,
              holder_description: a.holder_description || '',
              ooh: a.ooh ?? readOohFromFusion(raw) ?? merged.ooh ?? null,
              notes: a.notes || '',
              source: a.source || 'manual',
              created_at: a.created_at || now,
            }))
          : [{
              assembly_id: generateAssemblyId(),
              instance_guid: raw.guid,
              holder_guid: merged.selected_holder_guid || raw.holder?.guid || null,
              holder_description: raw.holder?.description || '',
              ooh: readOohFromFusion(raw) ?? merged.ooh ?? null,
              notes: '',
              source: 'fusion',
              created_at: now,
            }];

        // MIN OOH (from ProShop, `lengthBelowShankDiameter`) is the per-tool
        // stick-out floor. Normalization makes shoulder length equal to it and
        // floors every assembly's OOH at it — no assembly may stick out less than
        // the minimum, though it may stick out more. (shoulder/OOH can be adjusted
        // manually afterward.) When there's no MIN OOH, leave lengths untouched.
        // Units: min_ooh, per-assembly OOH and shoulder_length are all stored in
        // the tool's own unit, so they compare/assign directly — no conversion.
        const minOoh = merged.min_ooh ?? null;
        // Slot/key cutters (slitting saws): the unbroken shoulder is the cutter
        // width (flute length / kerf), NOT the MIN OOH stick-out — so don't
        // override it from min_ooh like other tool types.
        const isKeyCutter = merged.tool_type === 'slot/key cutter';
        const shoulder_length = isKeyCutter
          ? (merged.flute_length ?? merged.shoulder_length ?? null)
          : (minOoh != null ? minOoh : merged.shoulder_length);
        const assemblies = minOoh != null
          ? rawAssemblies.map(a => ({ ...a, ooh: (a.ooh != null && a.ooh < minOoh) ? minOoh : a.ooh }))
          : rawAssemblies;

        // Rename presets to the convention against the primary assembly, and set
        // operation_type (name wins, else the user-supplied override).
        const primary = assemblies[0];
        const primaryHolderShort = holderShortName(primary.holder_description || '');
        const isHoleMakingTool = HOLE_MAKING_TYPES.has(merged.tool_type);
        const presets = (merged.presets || []).map(p => {
          const opType = isHoleMakingTool
            ? null
            : (parsePresetName(p.name)?.opType ?? opOverrides[p.guid] ?? p.operation_type ?? null);
          const name = (!isHoleMakingTool && opTypeWord(opType))
            ? composePresetName({
                materialQuery: materialNameCode(p.material?.query, materialsRef.current),
                ooh: primary.ooh,
                holderShort: primaryHolderShort,
                opType,
              })
            : p.name;
          return { ...p, name, operation_type: opType };
        });

        logicalTools.push({
          ...merged,
          id: tracking_id,
          tracking_id,
          shoulder_length,
          assemblies,
          presets,
          _instancesRaw: [raw],
          _fusionRaw: raw,
        });
      }

      // Fold tools sharing a ProShop number into one logical tool before saving,
      // so duplicate copies pushed into the library merge into a single tool
      // (with one instance per distinct holder/OOH) instead of staying separate.
      // combine runs WITHIN each library only (cross-library tools stay separate).
      const combined = combineToolsByToolId(logicalTools);
      dupCount += logicalTools.length - combined.length;

      // Skip tools whose fields genuinely conflict (non-empty values differ between
      // the placeholder and the Fusion entry). Leave their raw entries untouched in
      // the library so nothing is destroyed; the user can reconcile on next open.
      for (const t of combined) {
        const tagged = { ...t, library_id: libraryId, library_name: library.fileName };
        if (t._combineConflicts?.length) conflictTools.push(tagged); else cleanTools.push(tagged);
      }
      } // end per-library loop

      await saveFullLibrary(cleanTools);
      markSetupStepInSettings('normalized');
      const base = `Normalized ${untrackedCount} tool${untrackedCount === 1 ? '' : 's'} to the multi-instance model`;
      const conflictSuffix = conflictTools.length > 0
        ? `; ${conflictTools.length} need${conflictTools.length === 1 ? 's' : ''} conflict review — open them to resolve`
        : '';
      const dupSuffix = dupCount > 0
        ? `; combined ${dupCount} ProShop-number duplicate${dupCount === 1 ? '' : 's'}`
        : '';
      notify(`${base}${dupSuffix}${conflictSuffix}`, 'success', 6000);
      return untrackedCount;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Normalize failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  };

  return { saveFullLibrary, renumberLibrary, assignToolIds, renumberAllToolIds, normalizeLibrary };
}
