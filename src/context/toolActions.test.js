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
