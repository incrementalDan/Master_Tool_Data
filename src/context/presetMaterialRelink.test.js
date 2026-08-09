import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DRIVE layer, not toolStore — so the real repository seam runs and the
// "upsertMany MERGES by id, it never replaces the file" invariant is genuinely
// exercised rather than assumed.
const { loadMetadata, saveAllMetadata } = vi.hoisted(() => ({
  loadMetadata: vi.fn(),
  saveAllMetadata: vi.fn(async () => {}),
}));
vi.mock('../services/driveService.js', () => ({ loadMetadata, saveAllMetadata }));

import { createLibraryOps } from './libraryOps.js';

// relinkPresetMaterials persists what the load-time backfill already works out in
// memory: each preset's CAM-preset FK plus the NAME derived from it. The
// invariants that matter are (a) it reads the STORED records, not in-memory
// tools, (b) it merges rather than replaces, and (c) a second run does nothing.

const MATERIALS = {
  groups: [
    { id: 'N', label: 'Non-Ferrous', code: 'AL' },
    { id: 'M', label: 'Stainless Steel', code: 'SS' },
  ],
  presets: [
    { id: 'pre_al', group_id: 'N', name: 'Al Wrought - 6061+' },
    { id: 'pre_316', group_id: 'M', name: 'SS Austenitic - 310, 316' },
  ],
  materials: [
    { id: 'm316', group_id: 'M', preset_id: 'pre_316', label: '316 / 316L', aliases: ['SS316'] },
  ],
};

// Mirrors the real shapes: a preset gone stale from a CAM-preset rename, one
// linkable only by grade, one already correct, one bare code that must stay the
// user's decision, and a record with no presets at all.
const records = () => ([
  {
    id: 'FTL-000001', tool_id: 'A-1', notes: 'keep me',
    preset_meta: { p1: { operation_type: 'rough', assembly_id: 'asm-1' } },
    presets: [{ guid: 'p1', name: 'AL', material: { query: 'Al Wrought', category: 'metal' } }],
  },
  {
    id: 'FTL-000002', tool_id: 'A-2',
    presets: [{ guid: 'p2', name: 'SS316 FIN', material: { query: 'SS316 FIN' } }],
  },
  {
    id: 'FTL-000003', tool_id: 'A-3',
    preset_meta: { p3: { material_preset_id: 'pre_al' } },
    presets: [{
      guid: 'p3', name: 'AL RGH', material_preset_id: 'pre_al',
      material: { query: 'Al Wrought - 6061+', category: 'metal' },
      'stock-materials': ['Al Wrought - 6061+'],
    }],
  },
  { id: 'FTL-000004', tool_id: 'A-4', presets: [{ guid: 'p4', name: 'SS', material: { query: 'SS' } }] },
  { id: 'FTL-000005', tool_id: 'A-5' },
]);

function makeOps(overrides = {}) {
  return createLibraryOps({
    dispatch: vi.fn(), notify: vi.fn(),
    googleRef: { current: true },
    materialsRef: { current: MATERIALS },
    // In-memory tools are ALREADY healed by the load backfill. If the action read
    // these instead of the stored records it would always find nothing to do
    // while the file stayed wrong — the bug this whole pass exists to fix.
    toolsRef: { current: [] },
    shopSettingsRef: { current: {} }, holdersRef: { current: [] },
    demoModeRef: { current: false }, fusionReadyRef: { current: true },
    holderLibraryRef: { current: null },
    // Any Fusion call would be a bug — this pass is metadata-only.
    uploadFusionList: vi.fn(async () => { throw new Error('must not touch Fusion'); }),
    downloadFusionList: vi.fn(async () => { throw new Error('must not touch Fusion'); }),
    downloadAllLibraries: vi.fn(async () => { throw new Error('must not touch Fusion'); }),
    markSetupStepInSettings: vi.fn(),
    ...overrides,
  });
}

describe('relinkPresetMaterials', () => {
  let stored;
  beforeEach(() => {
    vi.clearAllMocks();
    stored = records();
    loadMetadata.mockImplementation(async () => JSON.parse(JSON.stringify(stored)));
    saveAllMetadata.mockImplementation(async (recs) => { stored = recs; });
  });
  const written = () => (saveAllMetadata.mock.calls.at(-1)?.[0] || []);

  it('reports the renames and the new links without writing on a dry run', async () => {
    const res = await makeOps().relinkPresetMaterials({ dryRun: true });
    expect(saveAllMetadata).not.toHaveBeenCalled();
    expect(res.toolCount).toBe(2);        // the rename + the grade match
    expect(res.presetCount).toBe(2);
    expect(res.linkCount).toBe(2);
    expect(res.renames).toContainEqual({ label: 'Al Wrought → Al Wrought - 6061+', count: 1 });
  });

  it('stamps the FK and derives the name in BOTH presets[] and preset_meta', async () => {
    await makeOps().relinkPresetMaterials();
    const rec = written().find(r => r.id === 'FTL-000001');
    const p = rec.presets[0];
    expect(p.material_preset_id).toBe('pre_al');
    expect(p.material.query).toBe('Al Wrought - 6061+');          // the name Fusion will get
    expect(p['stock-materials']).toEqual(['Al Wrought - 6061+']);
    expect(rec.preset_meta.p1.material_preset_id).toBe('pre_al');
    // the FK's neighbours in preset_meta survive, and so does the rest of the record
    expect(rec.preset_meta.p1.operation_type).toBe('rough');
    expect(rec.preset_meta.p1.assembly_id).toBe('asm-1');
    expect(rec.notes).toBe('keep me');
  });

  it('links a preset whose material string only carries a GRADE', async () => {
    await makeOps().relinkPresetMaterials();
    const p = written().find(r => r.id === 'FTL-000002').presets[0];
    expect(p.material_preset_id).toBe('pre_316');
    expect(p.material.query).toBe('SS Austenitic - 310, 316');
  });

  it("leaves a bare code alone — that stays the user's decision", async () => {
    await makeOps().relinkPresetMaterials();
    const rec = written().find(r => r.id === 'FTL-000004');
    expect(rec.presets[0].material_preset_id).toBeUndefined();
    expect(rec.presets[0].material.query).toBe('SS');
  });

  it('never drops records it was not handed', async () => {
    await makeOps().relinkPresetMaterials();
    // upsertMany merges into the whole file — all five survive, incl. the
    // already-correct one and the one with no presets.
    expect(written()).toHaveLength(5);
    expect(written().find(r => r.id === 'FTL-000005')).toBeTruthy();
    expect(written().find(r => r.id === 'FTL-000003').presets[0].material.query)
      .toBe('Al Wrought - 6061+');
  });

  it('is idempotent — the SECOND run has nothing to do', async () => {
    const first = await makeOps().relinkPresetMaterials();
    expect(first.toolCount).toBe(2);
    const second = await makeOps().relinkPresetMaterials({ dryRun: true });
    expect(second.toolCount).toBe(0);
    expect(second.presetCount).toBe(0);
    expect(second.renames).toEqual([]);
  });

  it('refuses rather than half-working when Drive is not connected', async () => {
    const ops = makeOps({ googleRef: { current: false } });
    await expect(ops.relinkPresetMaterials({ dryRun: true })).rejects.toThrow(/Google Drive/);
    expect(saveAllMetadata).not.toHaveBeenCalled();
  });
});
