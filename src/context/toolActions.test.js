import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Drive layer so the no-Fusion write/delete branches can be exercised
// without a network. vi.hoisted keeps the spies referenceable inside the hoisted
// vi.mock factory.
const { upsertMetadata, deleteMetadata } = vi.hoisted(() => ({
  upsertMetadata: vi.fn(async () => {}),
  deleteMetadata: vi.fn(async () => {}),
}));
vi.mock('../services/driveService.js', () => ({
  upsertMetadata,
  deleteMetadata,
  loadMetadata: vi.fn(async () => []),
  saveAllMetadata: vi.fn(async () => {}),
}));

import { createToolActions } from './toolActions.js';

// A ctx whose Fusion IO THROWS — so any call to it fails the test, proving the
// no-Fusion path never touches the Fusion library.
function makeCtx(overrides = {}) {
  return {
    dispatch: vi.fn(),
    notify: vi.fn(),
    downloadFusionList: vi.fn(() => { throw new Error('downloadFusionList must not be called for a no-Fusion tool'); }),
    uploadFusionList: vi.fn(() => { throw new Error('uploadFusionList must not be called for a no-Fusion tool'); }),
    downloadAllLibraries: vi.fn(),
    fetchRawLibrary: vi.fn(),
    saveLocationConfig: vi.fn(),
    toolsRef: { current: [] },
    holdersRef: { current: [] },
    shopSettingsRef: { current: { assembly_id_system: { mode: 'auto' }, tool_id_system: {}, location_config: { systems: [] } } },
    googleRef: { current: true },
    componentsRef: { current: { components: [] } },
    ...overrides,
  };
}

beforeEach(() => { upsertMetadata.mockClear(); deleteMetadata.mockClear(); });

describe('Phase B increment 3 — no-Fusion write path (metadata only)', () => {
  it('writeLogicalTool writes metadata only and never touches the Fusion library', async () => {
    const ctx = makeCtx();
    const { writeLogicalTool } = createToolActions(ctx);
    const result = await writeLogicalTool({
      tracking_id: 'FTL-NOFUS1', tool_type: 'drill', description: 'no-fusion drill',
      no_fusion_link: true, library_id: 'lib-should-be-cleared',
      assemblies: [{ assembly_id: 'a1', ooh: 1.0 }],
    });
    expect(ctx.downloadFusionList).not.toHaveBeenCalled();
    expect(ctx.uploadFusionList).not.toHaveBeenCalled();
    expect(upsertMetadata).toHaveBeenCalledOnce();
    // Returned in-memory tool is unlinked
    expect(result.no_fusion_link).toBe(true);
    expect(result.library_id).toBeNull();
    expect(result._instancesRaw).toEqual([]);
    expect(result._fusionRaw).toBeNull();
    // The metadata actually persisted carries the complete record
    const savedMeta = upsertMetadata.mock.calls[0][0];
    expect(savedMeta.id).toBe('FTL-NOFUS1');
    expect(savedMeta.tool_type).toBe('drill');
    expect(savedMeta.no_fusion_link).toBe(true);
  });

  it('writeLogicalTool recomputes the flat speed/feed mirror from preset 0 (G5, O1)', async () => {
    const ctx = makeCtx();
    const { writeLogicalTool } = createToolActions(ctx);
    const result = await writeLogicalTool({
      tracking_id: 'FTL-MIR', tool_type: 'flat end mill', no_fusion_link: true,
      spindle_speed: 8000, cutting_feedrate: 50,          // STALE flat values
      presets: [{ guid: 'p0', name: 'Rough', n: 12000, v_f: 90 }],
      assemblies: [{ assembly_id: 'a1', ooh: 1 }],
    });
    // Flat mirror follows preset 0, not the stale values passed in.
    expect(result.spindle_speed).toBe(12000);
    expect(result.cutting_feedrate).toBe(90);
  });

  it('writeLogicalTool refuses a no-Fusion save when Drive is not connected', async () => {
    const ctx = makeCtx({ googleRef: { current: false } });
    const { writeLogicalTool } = createToolActions(ctx);
    await expect(writeLogicalTool({
      tracking_id: 'FTL-NOFUS2', tool_type: 'drill', no_fusion_link: true,
      assemblies: [{ assembly_id: 'a1', ooh: 1 }],
    })).rejects.toThrow(/Google Drive/i);
    expect(ctx.uploadFusionList).not.toHaveBeenCalled();
  });

  it('writeLogicalTool writes metadata-only when Fusion is DISABLED, even for a linked tool', async () => {
    const ctx = makeCtx({
      shopSettingsRef: { current: {
        assembly_id_system: { mode: 'auto' }, tool_id_system: {}, location_config: { systems: [] },
        integrations: { fusion: { enabled: false } },
      } },
    });
    const { writeLogicalTool } = createToolActions(ctx);
    const result = await writeLogicalTool({
      tracking_id: 'FTL-DIS1', tool_type: 'drill', no_fusion_link: false,
      assemblies: [{ assembly_id: 'a1', ooh: 1 }],
    });
    expect(ctx.downloadFusionList).not.toHaveBeenCalled();
    expect(ctx.uploadFusionList).not.toHaveBeenCalled();
    expect(upsertMetadata).toHaveBeenCalledOnce();
    // The tool's own flag is preserved (false) — re-enabling Fusion later won't
    // spuriously treat it as detached.
    expect(result.no_fusion_link).toBe(false);
    expect(upsertMetadata.mock.calls[0][0].no_fusion_link).toBe(false);
  });

  it('deleteTool removes metadata only for a no-Fusion tool (no Fusion round-trip)', async () => {
    const ctx = makeCtx({
      toolsRef: { current: [{ id: 'FTL-NOFUS1', tracking_id: 'FTL-NOFUS1', no_fusion_link: true }] },
    });
    const { deleteTool } = createToolActions(ctx);
    await deleteTool('FTL-NOFUS1');
    expect(ctx.downloadFusionList).not.toHaveBeenCalled();
    expect(ctx.uploadFusionList).not.toHaveBeenCalled();
    expect(deleteMetadata).toHaveBeenCalledWith('FTL-NOFUS1');
  });

  it('deleteTool is metadata-only when Fusion is DISABLED, even for a linked tool (G2)', async () => {
    const ctx = makeCtx({
      toolsRef: { current: [{ id: 'FTL-DIS', tracking_id: 'FTL-DIS', no_fusion_link: false, library_id: 'lib-1' }] },
      shopSettingsRef: { current: {
        assembly_id_system: { mode: 'auto' }, tool_id_system: {}, location_config: { systems: [] },
        integrations: { fusion: { enabled: false } },
      } },
    });
    const { deleteTool } = createToolActions(ctx);
    await deleteTool('FTL-DIS');
    // The throwing Fusion IO must never be called while sync is off.
    expect(ctx.downloadFusionList).not.toHaveBeenCalled();
    expect(ctx.uploadFusionList).not.toHaveBeenCalled();
    expect(deleteMetadata).toHaveBeenCalledWith('FTL-DIS');
  });

  it('deleteTool with skipFusion is metadata-only for a linked tool (reverse sync — already gone from Fusion)', async () => {
    // A normally-linked tool, but it was deleted directly in Fusion; the caller
    // passes skipFusion so we don't re-download/re-upload the whole library.
    const ctx = makeCtx({
      toolsRef: { current: [{ id: 'FTL-GONE', tracking_id: 'FTL-GONE', no_fusion_link: false, library_id: 'lib-1' }] },
    });
    const { deleteTool } = createToolActions(ctx);
    await deleteTool('FTL-GONE', { skipFusion: true });
    expect(ctx.downloadFusionList).not.toHaveBeenCalled();
    expect(ctx.uploadFusionList).not.toHaveBeenCalled();
    expect(deleteMetadata).toHaveBeenCalledWith('FTL-GONE');
  });
});

describe('reconcileTool — reverse sync (deleted from Fusion) detection', () => {
  it('reports missing when a linked tool has no matching Fusion entry', async () => {
    const tool = { id: 'FTL-RS', tracking_id: 'FTL-RS', tool_id: 'A-9', library_id: 'lib-1' };
    // The live library has some OTHER tool, but nothing matching this tracking ID / product-id.
    const rawList = [{ guid: 'x', 'post-process': { comment: 'FTL-OTHER' }, 'product-id': 'B-2' }];
    const ctx = makeCtx({
      fetchRawLibrary: vi.fn(async () => rawList),
      fusionReadyRef: { current: true },
    });
    const { reconcileTool } = createToolActions(ctx);
    const res = await reconcileTool(tool);
    expect(res.missing).toBe(true);
  });

  it('does NOT report missing when the tool still exists in Fusion', async () => {
    const tool = { id: 'FTL-OK', tracking_id: 'FTL-OK', tool_id: 'A-9', library_id: 'lib-1' };
    const rawList = [{ guid: 'g1', 'post-process': { comment: 'FTL-OK' }, 'product-id': 'A-9' }];
    const ctx = makeCtx({
      fetchRawLibrary: vi.fn(async () => rawList),
      fusionReadyRef: { current: true },
    });
    const { reconcileTool } = createToolActions(ctx);
    const res = await reconcileTool(tool);
    expect(res.missing).toBeFalsy();
  });
});

describe('writeLogicalTool does not wipe a concurrent Fusion preset edit', () => {
  it('preserves a preset the app never touched but Fusion changed', async () => {
    // Base (what the app loaded): preset p1 with v_f 100.
    const basePreset = { guid: 'p1', name: 'Rough', n: 8000, v_f: 100 };
    // Live Fusion (edited since load): p1 now v_f 130.
    const liveEntry = {
      guid: 'g1', 'post-process': { comment: 'FTL-W' }, type: 'flat end mill', unit: 'inches',
      geometry: { DC: 0.5, LCF: 1, OAL: 3, NOF: 4 },
      'start-values': { presets: [{ guid: 'p1', name: 'Rough', n: 8000, v_f: 130 }] },
    };
    let uploaded = null;
    const ctx = {
      dispatch: vi.fn(), notify: vi.fn(),
      downloadFusionList: vi.fn(async () => [{ ...liveEntry }]),
      uploadFusionList: vi.fn(async (_id, list) => { uploaded = list; }),
      downloadAllLibraries: vi.fn(), fetchRawLibrary: vi.fn(), saveLocationConfig: vi.fn(),
      toolsRef: { current: [] }, holdersRef: { current: [] },
      shopSettingsRef: { current: { assembly_id_system: { mode: 'auto' }, tool_id_system: {}, location_config: { systems: [] }, tool_libraries: [{ id: 'lib-1' }], default_tool_library_id: 'lib-1' } },
      googleRef: { current: true }, componentsRef: { current: { components: [] } },
    };
    const { writeLogicalTool } = createToolActions(ctx);
    // The in-memory tool the app is saving (e.g. a geometry/notes edit): its
    // presets are the STALE loaded copy (v_f 100), and _instancesRaw is the
    // load-time base (also v_f 100).
    const tool = {
      id: 'FTL-W', tracking_id: 'FTL-W', tool_type: 'flat end mill', unit: 'inches',
      diameter: 0.5, flute_length: 1, overall_length: 3, number_of_flutes: 4,
      presets: [{ ...basePreset, operation_type: 'rough' }],
      assemblies: [{ assembly_id: 'a1', instance_guid: 'g1', ooh: 2 }],
      _instancesRaw: [{ guid: 'g1', 'post-process': { comment: 'FTL-W' }, type: 'flat end mill', unit: 'inches', geometry: { DC: 0.5, LCF: 1, OAL: 3, NOF: 4 }, 'start-values': { presets: [{ ...basePreset }] } }],
      _fusionRaw: null,
    };
    const written = await writeLogicalTool(tool);
    const uploadedPreset = uploaded[0]['start-values'].presets[0];
    expect(uploadedPreset.v_f).toBe(130);       // Fusion's edit survived the save
    expect(written.presets[0].v_f).toBe(130);   // and the in-memory tool reflects it
    expect(written.presets[0].operation_type).toBe('rough'); // app overlay kept
  });
});

describe('writeLogicalTool does not wipe a concurrent Fusion geometry edit', () => {
  it('preserves a geometry field the app never touched but Fusion changed', async () => {
    // Live Fusion (edited since load): flute length LCF 1.0 -> 1.25.
    const liveEntry = {
      guid: 'g1', 'post-process': { comment: 'FTL-G' }, type: 'flat end mill', unit: 'inches',
      geometry: { DC: 0.5, LCF: 1.25, OAL: 3, NOF: 4 },
      'start-values': { presets: [] },
    };
    let uploaded = null;
    const ctx = {
      dispatch: vi.fn(), notify: vi.fn(),
      downloadFusionList: vi.fn(async () => [{ ...liveEntry }]),
      uploadFusionList: vi.fn(async (_id, list) => { uploaded = list; }),
      downloadAllLibraries: vi.fn(), fetchRawLibrary: vi.fn(), saveLocationConfig: vi.fn(),
      toolsRef: { current: [] }, holdersRef: { current: [] },
      shopSettingsRef: { current: { assembly_id_system: { mode: 'auto' }, tool_id_system: {}, location_config: { systems: [] }, tool_libraries: [{ id: 'lib-1' }], default_tool_library_id: 'lib-1' } },
      googleRef: { current: true }, componentsRef: { current: { components: [] } },
    };
    const { writeLogicalTool } = createToolActions(ctx);
    // The app's in-memory tool has the STALE flute length (1.0) and a load-time
    // base (also 1.0). It's saving an unrelated change (e.g. a note).
    const tool = {
      id: 'FTL-G', tracking_id: 'FTL-G', tool_type: 'flat end mill', unit: 'inches',
      diameter: 0.5, flute_length: 1.0, overall_length: 3, number_of_flutes: 4, presets: [],
      assemblies: [{ assembly_id: 'a1', instance_guid: 'g1', ooh: 2 }],
      _instancesRaw: [{ guid: 'g1', 'post-process': { comment: 'FTL-G' }, type: 'flat end mill', unit: 'inches', geometry: { DC: 0.5, LCF: 1.0, OAL: 3, NOF: 4 }, 'start-values': { presets: [] } }],
      _fusionRaw: null,
    };
    const written = await writeLogicalTool(tool);
    expect(uploaded[0].geometry.LCF).toBe(1.25);   // Fusion's edit survived the save
    expect(written.flute_length).toBe(1.25);       // and the in-memory tool reflects it
    // The adopt is no longer silent — the user is told a Fusion change was pulled in.
    expect(ctx.notify).toHaveBeenCalledWith(
      expect.stringMatching(/pulled in 1 change/i), 'info', expect.anything(),
    );
  });
});

describe('Phase B increment 4 — promote / detach', () => {
  // A ctx whose Fusion IO works (returns/records), for the linked-path transitions.
  function makeIoCtx(overrides = {}) {
    return {
      dispatch: vi.fn(),
      notify: vi.fn(),
      downloadFusionList: vi.fn(async () => []),
      uploadFusionList: vi.fn(async () => {}),
      downloadAllLibraries: vi.fn(),
      fetchRawLibrary: vi.fn(),
      saveLocationConfig: vi.fn(),
      toolsRef: { current: [] },
      holdersRef: { current: [] },
      shopSettingsRef: { current: {
        assembly_id_system: { mode: 'auto' }, tool_id_system: {}, location_config: { systems: [] },
        tool_libraries: [{ id: 'lib-1', fileName: 'main.json' }], default_tool_library_id: 'lib-1',
      } },
      googleRef: { current: true },
      componentsRef: { current: { components: [] } },
      ...overrides,
    };
  }

  it('promoteToolToFusion mints Fusion instances and clears the no-Fusion flag', async () => {
    const tool = { id: 'FTL-P1', tracking_id: 'FTL-P1', tool_type: 'drill', no_fusion_link: true,
      unit: 'inches', assemblies: [{ assembly_id: 'a1', ooh: 1.0 }] };
    const ctx = makeIoCtx({ toolsRef: { current: [tool] } });
    const { promoteToolToFusion } = createToolActions(ctx);
    const result = await promoteToolToFusion('FTL-P1');
    expect(ctx.uploadFusionList).toHaveBeenCalledOnce();
    const [, uploadedList] = ctx.uploadFusionList.mock.calls[0];
    expect(uploadedList.length).toBeGreaterThanOrEqual(1);   // a real Fusion entry was created
    expect(result.no_fusion_link).toBe(false);
    expect(result.library_id).toBe('lib-1');
  });

  it('promoteToolToFusion routes to the chosen target library (#5)', async () => {
    const tool = { id: 'FTL-P3', tracking_id: 'FTL-P3', tool_type: 'drill', no_fusion_link: true,
      unit: 'inches', assemblies: [{ assembly_id: 'a1', ooh: 1.0 }] };
    const ctx = makeIoCtx({
      toolsRef: { current: [tool] },
      shopSettingsRef: { current: {
        assembly_id_system: { mode: 'auto' }, tool_id_system: {}, location_config: { systems: [] },
        tool_libraries: [{ id: 'lib-1', fileName: 'a.json' }, { id: 'lib-2', fileName: 'b.json' }],
        default_tool_library_id: 'lib-1',
      } },
    });
    const { promoteToolToFusion } = createToolActions(ctx);
    const result = await promoteToolToFusion('FTL-P3', 'lib-2');   // pick the non-default library
    const [libId] = ctx.uploadFusionList.mock.calls[0];
    expect(libId).toBe('lib-2');
    expect(result.library_id).toBe('lib-2');
  });

  it('promoteToolToFusion refuses when no Fusion library is linked', async () => {
    const tool = { id: 'FTL-P2', tracking_id: 'FTL-P2', no_fusion_link: true, assemblies: [{ assembly_id: 'a', ooh: 1 }] };
    const ctx = makeIoCtx({
      toolsRef: { current: [tool] },
      shopSettingsRef: { current: { assembly_id_system: { mode: 'auto' }, tool_id_system: {}, location_config: { systems: [] }, tool_libraries: [] } },
    });
    const { promoteToolToFusion } = createToolActions(ctx);
    await expect(promoteToolToFusion('FTL-P2')).rejects.toThrow(/Fusion library/i);
    expect(ctx.uploadFusionList).not.toHaveBeenCalled();
  });

  it('detachToolFromFusion removes the tool from the library, then writes metadata-only', async () => {
    const tool = {
      id: 'FTL-D1', tracking_id: 'FTL-D1', tool_type: 'drill', no_fusion_link: false,
      library_id: 'lib-1', unit: 'inches',
      assemblies: [{ assembly_id: 'a1', instance_guid: 'inst-1', ooh: 1.0 }],
      _instancesRaw: [{ guid: 'inst-1', 'post-process': { comment: 'FTL-D1' } }],
    };
    const otherEntry = { guid: 'other', 'post-process': { comment: 'FTL-OTHER' } };
    const ctx = makeIoCtx({
      toolsRef: { current: [tool] },
      downloadFusionList: vi.fn(async () => [
        { guid: 'inst-1', 'post-process': { comment: 'FTL-D1' } },
        otherEntry,
      ]),
    });
    const { detachToolFromFusion } = createToolActions(ctx);
    const result = await detachToolFromFusion('FTL-D1');
    // Uploaded library has this tool's entry removed, others kept
    const [, uploadedList] = ctx.uploadFusionList.mock.calls[0];
    expect(uploadedList).toEqual([otherEntry]);
    // Metadata written; tool is now unlinked with cleared instance guids
    expect(upsertMetadata).toHaveBeenCalledOnce();
    expect(result.no_fusion_link).toBe(true);
    expect(result.library_id).toBeNull();
    expect(result.assemblies[0].instance_guid).toBeNull();
  });

  it('detachToolFromFusion with no library skips Fusion IO but still detaches (G7.2)', async () => {
    const tool = {
      id: 'FTL-D2', tracking_id: 'FTL-D2', tool_type: 'drill', no_fusion_link: false,
      library_id: null, unit: 'inches', assemblies: [{ assembly_id: 'a1', instance_guid: null, ooh: 1 }],
      _instancesRaw: [],
    };
    const ctx = makeIoCtx({
      toolsRef: { current: [tool] },
      // No default library either — nothing to target.
      shopSettingsRef: { current: { assembly_id_system: { mode: 'auto' }, tool_id_system: {}, location_config: { systems: [] }, tool_libraries: [] } },
      downloadFusionList: vi.fn(() => { throw new Error('must not download when there is no library'); }),
      uploadFusionList: vi.fn(() => { throw new Error('must not upload when there is no library'); }),
    });
    const { detachToolFromFusion } = createToolActions(ctx);
    const result = await detachToolFromFusion('FTL-D2');
    expect(ctx.downloadFusionList).not.toHaveBeenCalled();
    expect(ctx.uploadFusionList).not.toHaveBeenCalled();
    expect(upsertMetadata).toHaveBeenCalledOnce();   // metadata mark still written
    expect(result.no_fusion_link).toBe(true);
  });
});

describe('mergeTools — fold two records sharing a ProShop number (tool-page merge)', () => {
  const ioCtx = (overrides = {}) => ({
    dispatch: vi.fn(), notify: vi.fn(),
    downloadFusionList: vi.fn(async () => []),
    uploadFusionList: vi.fn(async () => {}),
    downloadAllLibraries: vi.fn(), fetchRawLibrary: vi.fn(), saveLocationConfig: vi.fn(),
    toolsRef: { current: [] }, holdersRef: { current: [] },
    shopSettingsRef: { current: {
      assembly_id_system: { mode: 'auto' }, tool_id_system: {}, location_config: { systems: [] },
      tool_libraries: [{ id: 'lib-1', fileName: 'main.json' }], default_tool_library_id: 'lib-1',
    } },
    googleRef: { current: true }, componentsRef: { current: { components: [] } },
    ...overrides,
  });
  const baseTool = (o) => ({
    tool_type: 'flat end mill', unit: 'inches', diameter: 0.5, flute_length: 1,
    overall_length: 3, number_of_flutes: 4, presets: [], assemblies: [], _instancesRaw: [], ...o,
  });

  it('throws when the two tools do not share a ProShop number', async () => {
    const ctx = ioCtx({ toolsRef: { current: [
      baseTool({ id: 'FTL-A', tracking_id: 'FTL-A', tool_id: 'A-1', no_fusion_link: true }),
      baseTool({ id: 'FTL-B', tracking_id: 'FTL-B', tool_id: 'B-2', no_fusion_link: true }),
    ] } });
    const { mergeTools } = createToolActions(ctx);
    await expect(mergeTools('FTL-A', 'FTL-B')).rejects.toThrow(/ProShop number/i);
  });

  it('refuses when both tools are linked to a Fusion library (routing)', async () => {
    const ctx = ioCtx({ toolsRef: { current: [
      baseTool({ id: 'FTL-A', tracking_id: 'FTL-A', tool_id: 'A-7', library_id: 'lib-1' }),
      baseTool({ id: 'FTL-B', tracking_id: 'FTL-B', tool_id: 'A-7', library_id: 'lib-2' }),
    ] } });
    const { mergeTools } = createToolActions(ctx);
    await expect(mergeTools('FTL-A', 'FTL-B')).rejects.toThrow(/both.*linked/i);
  });

  it('merges a no-Fusion pair into one, gap-fills ProShop data, deletes the absorbed record', async () => {
    const a = baseTool({ id: 'FTL-A', tracking_id: 'FTL-A', tool_id: 'A-7', no_fusion_link: true,
      library_id: null, diameter: 0.2505, vendor: '', assemblies: [{ assembly_id: 'a1', ooh: 1 }] });
    const b = baseTool({ id: 'FTL-B', tracking_id: 'FTL-B', tool_id: 'A-7', no_fusion_link: true,
      library_id: null, diameter: 0.25, vendor: 'Helical' });
    const ctx = ioCtx({ toolsRef: { current: [a, b] } });
    const { mergeTools } = createToolActions(ctx);

    const res = await mergeTools('FTL-A', 'FTL-B');
    expect(res).toEqual({ survivorId: 'FTL-A', absorbedId: 'FTL-B' });
    expect(deleteMetadata).toHaveBeenCalledWith('FTL-B');
    expect(ctx.dispatch.mock.calls.find(c => c[0].type === 'DELETE_TOOL')[0].id).toBe('FTL-B');
    const savedMeta = upsertMetadata.mock.calls.at(-1)[0];
    expect(savedMeta.id).toBe('FTL-A');
    expect(savedMeta.vendor).toBe('Helical');                 // gap-filled
    expect((savedMeta.conflicts || []).some(c => c.field === 'diameter')).toBe(true);
  });

  it('keeps the LINKED tool as survivor even when called from the no-Fusion tool', async () => {
    const rawG1 = { guid: 'g1', type: 'flat end mill', unit: 'inches', 'product-id': 'A-7',
      'post-process': { comment: 'FTL-LINK', number: null },
      geometry: { DC: 0.2505, LCF: 1, OAL: 3, NOF: 4, LB: 1 }, 'start-values': { presets: [] }, expressions: {} };
    const linked = baseTool({ id: 'FTL-LINK', tracking_id: 'FTL-LINK', tool_id: 'A-7', no_fusion_link: false,
      library_id: 'lib-1', library_name: 'main.json', diameter: 0.2505, vendor: '',
      assemblies: [{ assembly_id: 'a1', instance_guid: 'g1', ooh: 1, holder_guid: null }],
      _instancesRaw: [rawG1], _fusionRaw: rawG1 });
    const noFus = baseTool({ id: 'FTL-PS', tracking_id: 'FTL-PS', tool_id: 'A-7', no_fusion_link: true,
      library_id: null, diameter: 0.25, vendor: 'Helical', min_ooh: 0.75 });
    let uploaded = null;
    const ctx = ioCtx({
      toolsRef: { current: [noFus, linked] },
      downloadFusionList: vi.fn(async () => [rawG1]),
      uploadFusionList: vi.fn(async (_id, list) => { uploaded = list; }),
    });
    const { mergeTools } = createToolActions(ctx);

    // Called from the no-Fusion tool's page — survivor must still be the linked one.
    const res = await mergeTools('FTL-PS', 'FTL-LINK');
    expect(res.survivorId).toBe('FTL-LINK');
    expect(res.absorbedId).toBe('FTL-PS');
    expect(deleteMetadata).toHaveBeenCalledWith('FTL-PS');
    expect(ctx.uploadFusionList).toHaveBeenCalled();
    // One A-7 entry remains, under the survivor's tracking id (no orphan).
    const a7 = uploaded.filter(f => f['product-id'] === 'A-7');
    expect(a7).toHaveLength(1);
    expect(a7[0]['post-process'].comment).toBe('FTL-LINK');
  });
});
