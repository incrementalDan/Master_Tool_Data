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
