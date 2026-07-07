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
});
