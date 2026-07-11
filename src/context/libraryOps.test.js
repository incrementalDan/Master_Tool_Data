import { describe, it, expect, vi, beforeEach } from 'vitest';

const { loadMetadata, saveAllMetadata } = vi.hoisted(() => ({
  loadMetadata: vi.fn(),
  saveAllMetadata: vi.fn(async () => {}),
}));
vi.mock('../services/driveService.js', () => ({ loadMetadata, saveAllMetadata }));

import { createLibraryOps } from './libraryOps.js';

function makeCtx(overrides = {}) {
  return {
    dispatch: vi.fn(),
    notify: vi.fn(),
    uploadFusionList: vi.fn(async () => {}),
    downloadAllLibraries: vi.fn(async () => []),   // no Fusion libraries
    markSetupStepInSettings: vi.fn(),
    toolsRef: { current: [] },
    holdersRef: { current: [] },
    shopSettingsRef: { current: {
      tool_id_system: { mode: 'sequential', start: 1000, skip: [], digits: 4 },
      machine_number: { start: 30, skip: [98, 99, 100] },
      location_config: { systems: [] },
    } },
    googleRef: { current: true },
    demoModeRef: { current: false },
    materialsRef: { current: {} },
    ...overrides,
  };
}

beforeEach(() => { loadMetadata.mockReset(); saveAllMetadata.mockClear(); });

describe('assignToolIds — includes no-Fusion tools, honors exclusions', () => {
  it('assigns an ID to a no-Fusion (metadata-only) tool', async () => {
    loadMetadata.mockResolvedValue([{ id: 'FTL-NF', no_fusion_link: true, tool_id: '' }]);
    const ctx = makeCtx({
      toolsRef: { current: [{ id: 'FTL-NF', tracking_id: 'FTL-NF', no_fusion_link: true, tool_id: '' }] },
    });
    const { assignToolIds } = createLibraryOps(ctx);
    const n = await assignToolIds();
    expect(n).toBe(1);
    const savedMeta = saveAllMetadata.mock.calls[0][0];
    expect(savedMeta.find(m => m.id === 'FTL-NF').tool_id).toBe('1000');
  });

  it('skips a no-Fusion tool excluded from the Tool ID system', async () => {
    loadMetadata.mockResolvedValue([{ id: 'FTL-NF', no_fusion_link: true, tool_id: '' }]);
    const ctx = makeCtx({
      toolsRef: { current: [{ id: 'FTL-NF', tracking_id: 'FTL-NF', no_fusion_link: true, tool_id: '', id_system_exclusions: { tool_id: true } }] },
    });
    const { assignToolIds } = createLibraryOps(ctx);
    const n = await assignToolIds();
    expect(n).toBe(0);                       // nothing assigned
    expect(saveAllMetadata).not.toHaveBeenCalled();
  });
});

describe('normalizeLibrary preserves conflict tools Fusion entries (G6)', () => {
  const raw = (guid, comment, productId, desc) => ({
    guid, type: 'flat end mill', unit: 'inches', description: desc,
    'product-id': productId, 'post-process': { comment, number: null },
    geometry: { DC: 0.5, LCF: 1, OAL: 3, NOF: 4, LB: 1 },
    'start-values': { presets: [] }, expressions: {},
  });

  it('keeps a conflict pair in the library instead of dropping it on full-replace', async () => {
    // One clean tracked tool + a conflict pair: two tracked entries sharing a
    // product-id but with different descriptions (a same-tool_id duplicate).
    const rawA = raw('gA', 'FTL-CLEAN', 'CLEAN-1', 'Clean A');
    const rawB = raw('gB', 'FTL-B', 'DUP-1', 'Desc B');
    const rawC = raw('gC', 'FTL-C', 'DUP-1', 'Desc C');
    let uploaded = null;
    const ctx = makeCtx({
      downloadAllLibraries: vi.fn(async () => [
        { libraryId: 'lib-1', library: { fileName: 'main.json' }, list: [rawA, rawB, rawC] },
      ]),
      uploadFusionList: vi.fn(async (_id, list) => { uploaded = list; }),
      shopSettingsRef: { current: {
        tool_id_system: { mode: 'sequential', start: 1000, skip: [], digits: 4 },
        machine_number: { start: 30, skip: [] }, location_config: { systems: [] },
        tool_libraries: [{ id: 'lib-1', fileName: 'main.json' }], default_tool_library_id: 'lib-1',
      } },
    });
    loadMetadata.mockResolvedValue([]);
    const { normalizeLibrary } = createLibraryOps(ctx);
    await normalizeLibrary();

    // The conflict pair's raw entries must survive in the uploaded library.
    const guids = new Set(uploaded.map(f => f.guid));
    expect(guids.has('gB')).toBe(true);
    expect(guids.has('gC')).toBe(true);
  });
});

describe('Drive-required guards for no-Fusion tools (G3/G4)', () => {
  it('saveFullLibrary refuses when a no-Fusion tool is present and Drive is off (G3)', async () => {
    const ctx = makeCtx({ googleRef: { current: false } });
    const { saveFullLibrary } = createLibraryOps(ctx);
    await expect(saveFullLibrary([
      { id: 'FTL-NF', tracking_id: 'FTL-NF', no_fusion_link: true, tool_type: 'drill' },
    ])).rejects.toThrow(/Google Drive/i);
    expect(ctx.uploadFusionList).not.toHaveBeenCalled();   // no partial write
  });

  it('assignToolIds refuses when a no-Fusion tool needs an ID and Drive is off (G4)', async () => {
    const ctx = makeCtx({
      googleRef: { current: false },
      toolsRef: { current: [{ id: 'FTL-NF', tracking_id: 'FTL-NF', no_fusion_link: true, tool_id: '' }] },
    });
    const { assignToolIds } = createLibraryOps(ctx);
    await expect(assignToolIds()).rejects.toThrow(/Google Drive/i);
    expect(ctx.uploadFusionList).not.toHaveBeenCalled();
  });
});

describe('saveFullLibrary — merges metadata by id (does not wipe records not passed)', () => {
  it('preserves a no-Fusion tool absent from the passed set (G1)', async () => {
    // The Drive metadata file already holds a no-Fusion tool's record. A bulk
    // save that carries ONLY a Fusion-built tool must not delete it.
    loadMetadata.mockResolvedValue([
      { id: 'FTL-NF', no_fusion_link: true, tool_id: 'NF-1', tool_type: 'drill', description: 'orphaned if wiped' },
    ]);
    const ctx = makeCtx();
    const { saveFullLibrary } = createLibraryOps(ctx);

    await saveFullLibrary([
      { id: 'FTL-LINK', tracking_id: 'FTL-LINK', tool_type: 'flat end mill', unit: 'inches',
        assemblies: [{ assembly_id: 'a1', instance_guid: 'g1', ooh: 1 }] },
    ]);

    // The whole-file write must still contain the untouched no-Fusion record...
    const savedMeta = saveAllMetadata.mock.calls[0][0];
    expect(savedMeta.find(m => m.id === 'FTL-NF')).toBeTruthy();
    expect(savedMeta.find(m => m.id === 'FTL-LINK')).toBeTruthy();

    // ...and it must be re-materialized into the in-memory library so it doesn't
    // vanish from the UI until reload.
    const setTools = ctx.dispatch.mock.calls.find(c => c[0].type === 'SET_TOOLS');
    expect(setTools).toBeTruthy();
    expect(setTools[0].tools.some(t => t.id === 'FTL-NF')).toBe(true);
  });
});
