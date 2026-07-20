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

describe('normalizeLibrary — informed, not blocked (conflict tools come in with a record)', () => {
  const raw = (guid, comment, productId, desc, dc = 0.5) => ({
    guid, type: 'flat end mill', unit: 'inches', description: desc,
    'product-id': productId, 'post-process': { comment, number: null },
    geometry: { DC: dc, LCF: 1, OAL: 3, NOF: 4, LB: 1 },
    'start-values': { presets: [] }, expressions: {},
  });

  it('merges a conflict pair into ONE normalized tool carrying a conflict record — never held back', async () => {
    // One clean tool + a conflict pair: two entries sharing a product-id but with a
    // genuinely-conflicting Fusion-native field (different diameter). The pair now
    // comes in fully merged (primary wins) with the disagreement recorded as a
    // conflict, instead of being held back un-normalized (which used to leave the
    // library "needs normalize" until a reload).
    const rawA = raw('gA', 'FTL-CLEAN', 'CLEAN-1', 'Clean A');
    const rawB = raw('gB', 'FTL-B', 'DUP-1', 'Desc B', 0.5);
    const rawC = raw('gC', 'FTL-C', 'DUP-1', 'Desc C', 0.375);
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

    // The conflict tool is present in the library (merged into one entry), not dropped.
    const pids = new Set(uploaded.map(f => f['product-id']));
    expect(pids.has('DUP-1')).toBe(true);
    expect(pids.has('CLEAN-1')).toBe(true);

    // Its diameter disagreement is persisted as a conflict record (informed, not blocked).
    const savedMeta = saveAllMetadata.mock.calls.at(-1)[0];
    const dup = savedMeta.find(m => m.tool_id === 'DUP-1');
    expect(dup).toBeDefined();
    const diaConflict = (dup.conflicts || []).find(c => c.field === 'diameter');
    expect(diaConflict).toBeDefined();
    expect(diaConflict.values).toEqual([0.5, 0.375]);
  });
});

describe('normalizeLibrary — merge a new Fusion tool into an existing no-Fusion tool', () => {
  const raw = (guid, comment, productId, desc, dc = 0.5) => ({
    guid, type: 'flat end mill', unit: 'inches', description: desc,
    'product-id': productId, 'post-process': { comment, number: null },
    geometry: { DC: dc, LCF: 1, OAL: 3, NOF: 4, LB: 1 },
    'start-values': { presets: [] }, expressions: {},
  });
  // A ProShop-only import: a complete metadata record marked no_fusion_link.
  const noFusionMeta = {
    id: 'FTL-PS', no_fusion_link: true, tool_id: 'A-7', tool_type: 'flat end mill',
    unit: 'inches', description: 'ProShop A7', diameter: 0.25, flute_length: 1,
    overall_length: 3, number_of_flutes: 4, vendor: 'Helical', min_ooh: 0.75,
    presets: [], assemblies: [],
  };
  const ctxFor = (list) => makeCtx({
    downloadAllLibraries: vi.fn(async () => [{ libraryId: 'lib-1', library: { fileName: 'main.json' }, list }]),
    uploadFusionList: vi.fn(async () => {}),
    shopSettingsRef: { current: {
      tool_id_system: { mode: 'sequential', start: 1000, skip: [], digits: 4 },
      machine_number: { start: 30, skip: [] }, location_config: { systems: [] },
      tool_libraries: [{ id: 'lib-1', fileName: 'main.json' }], default_tool_library_id: 'lib-1',
    } },
  });

  it('adopts the untracked Fusion tool into the no-Fusion record when merge is chosen', async () => {
    // Untracked (no tracking comment) Fusion tool, same ProShop #, diameter differs.
    const rawNew = raw('gNew', null, 'A-7', 'Fusion A7', 0.2505);
    let uploaded = null;
    const ctx = ctxFor([rawNew]);
    ctx.uploadFusionList = vi.fn(async (_id, l) => { uploaded = l; });
    loadMetadata.mockResolvedValue([noFusionMeta]);

    const { normalizeLibrary } = createLibraryOps(ctx);
    await normalizeLibrary({}, {}, { A7: true });

    // Exactly one Fusion entry for A-7, stamped with the no-Fusion tracking id.
    const a7 = uploaded.filter(f => f['product-id'] === 'A-7');
    expect(a7).toHaveLength(1);
    expect(a7[0]['post-process'].comment).toBe('FTL-PS');

    // No orphan: one record for A-7, now Fusion-linked, ProShop data kept.
    const savedMeta = saveAllMetadata.mock.calls.at(-1)[0];
    const recs = savedMeta.filter(m => m.tool_id === 'A-7');
    expect(recs).toHaveLength(1);
    expect(recs[0].id).toBe('FTL-PS');
    expect(recs[0].no_fusion_link).toBe(false);
    expect(recs[0].vendor).toBe('Helical');
    // The geometry disagreement is flagged for the user (informed, not blocked).
    const dia = (recs[0].conflicts || []).find(c => c.field === 'diameter');
    expect(dia).toBeDefined();
    expect(dia.values).toEqual([0.2505, 0.25]);
  });

  it('keeps them separate (fresh tracking id) when merge is NOT chosen', async () => {
    const rawNew = raw('gNew', null, 'A-7', 'Fusion A7', 0.25);
    let uploaded = null;
    const ctx = ctxFor([rawNew]);
    ctx.uploadFusionList = vi.fn(async (_id, l) => { uploaded = l; });
    loadMetadata.mockResolvedValue([noFusionMeta]);

    const { normalizeLibrary } = createLibraryOps(ctx);
    await normalizeLibrary({}, {}, {});   // no merge decision

    // The uploaded Fusion tool got a FRESH tracking id (not the no-Fusion one).
    const a7 = uploaded.filter(f => f['product-id'] === 'A-7');
    expect(a7).toHaveLength(1);
    expect(a7[0]['post-process'].comment).not.toBe('FTL-PS');

    // The no-Fusion record is preserved untouched (still marked no_fusion_link).
    const savedMeta = saveAllMetadata.mock.calls.at(-1)[0];
    expect(savedMeta.find(m => m.id === 'FTL-PS').no_fusion_link).toBe(true);
  });
});

describe('normalizeLibrary — machine tool numbers stay unique', () => {
  const raw = (guid, comment, productId, number) => ({
    guid, type: 'flat end mill', unit: 'inches', description: `T${number}`,
    'product-id': productId, 'post-process': { comment, number },
    geometry: { DC: 0.5, LCF: 1, OAL: 3, NOF: 4, LB: 1 },
    'start-values': { presets: [] }, expressions: {},
  });

  it('reassigns a NEW tool whose machine number collides with an existing tool, and flags it', async () => {
    const existing = raw('gEx', 'FTL-A00001', 'EX-1', 30);   // already tracked, machine T30
    const incoming = raw('gNew', null, 'NEW-1', 30);         // untracked upload, ALSO T30
    let uploaded = null;
    const ctx = makeCtx({
      downloadAllLibraries: vi.fn(async () => [
        { libraryId: 'lib-1', library: { fileName: 'main.json' }, list: [existing, incoming] },
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

    const byPid = Object.fromEntries(uploaded.map(f => [f['product-id'], f]));
    // The existing tool keeps T30; the new tool was reassigned to the next free (T31).
    expect(byPid['EX-1']['post-process'].number).toBe(30);
    expect(byPid['NEW-1']['post-process'].number).toBe(31);

    // The collision is flagged on the reassigned tool (informed, not silent).
    const savedMeta = saveAllMetadata.mock.calls.at(-1)[0];
    const newMeta = savedMeta.find(m => m.tool_id === 'NEW-1');
    const mnConflict = (newMeta.conflicts || []).find(c => c.type === 'machine_number');
    expect(mnConflict).toMatchObject({ from: 30, to: 31 });
    // The tool that kept its number is NOT flagged.
    const exMeta = savedMeta.find(m => m.tool_id === 'EX-1');
    expect((exMeta.conflicts || []).some(c => c.type === 'machine_number')).toBe(false);
  });

  it('leaves a non-colliding machine number untouched (no flag)', async () => {
    const a = raw('gA', null, 'A-1', 30);
    const b = raw('gB', null, 'B-1', 31);   // distinct numbers — no collision
    let uploaded = null;
    const ctx = makeCtx({
      downloadAllLibraries: vi.fn(async () => [
        { libraryId: 'lib-1', library: { fileName: 'main.json' }, list: [a, b] },
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

    const byPid = Object.fromEntries(uploaded.map(f => [f['product-id'], f]));
    expect(byPid['A-1']['post-process'].number).toBe(30);
    expect(byPid['B-1']['post-process'].number).toBe(31);
    const savedMeta = saveAllMetadata.mock.calls.at(-1)[0];
    expect(savedMeta.every(m => !(m.conflicts || []).some(c => c.type === 'machine_number'))).toBe(true);
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
