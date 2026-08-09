import { describe, it, expect, vi } from 'vitest';
import { createLibraryOps, FUSION_PRESET_PATCHERS } from './libraryOps.js';

// pushPresetFieldToFusion is the per-PRESET sibling of pushFieldToFusion: it
// patches one field inside start-values.presets[] and leaves every other byte of
// the library alone. The two rules worth locking are (1) it only pushes a value
// DERIVED from a CAM-preset id, and (2) it never clobbers a stock-materials
// assignment somebody made in Fusion.

const MATERIALS = {
  groups: [{ id: 'N', label: 'Non-Ferrous', code: 'AL' }],
  presets: [
    { id: 'pre_al', group_id: 'N', name: 'Al Wrought - 6061+' },
    { id: 'pre_316', group_id: 'M', name: 'SS Austenitic - 310, 316' },
  ],
  materials: [],
};

const pat = FUSION_PRESET_PATCHERS.material;

describe('the preset material patcher', () => {
  it('corrects the query, and the stock-materials that came from the old name', () => {
    const fp = { guid: 'p1', material: { query: 'Al Wrought' }, 'stock-materials': ['Al Wrought'] };
    const r = pat.apply(fp, 'Al Wrought - 6061+');
    expect(r.changed).toBe(true);
    expect(r.preset.material.query).toBe('Al Wrought - 6061+');
    expect(r.preset['stock-materials']).toEqual(['Al Wrought - 6061+']);
    expect(r.stockKept).toBe(false);
  });

  it('NEVER injects stock-materials where Fusion has none', () => {
    const fp = { guid: 'p1', material: { query: 'Al Wrought' } };
    const r = pat.apply(fp, 'Al Wrought - 6061+');
    expect(r.preset.material.query).toBe('Al Wrought - 6061+');   // query still corrected
    expect('stock-materials' in r.preset).toBe(false);            // but none invented
  });

  it('never clobbers a DIFFERENT stock material somebody assigned in Fusion', () => {
    // Real shape from the shop's library: query "SS Austenitic 316" alongside
    // stock-materials ["SS Harder"] — an independent Fusion-side assignment.
    const fp = { guid: 'p1', material: { query: 'SS Austenitic 316' }, 'stock-materials': ['SS Harder'] };
    const r = pat.apply(fp, 'SS Austenitic - 310, 316');
    expect(r.preset.material.query).toBe('SS Austenitic - 310, 316');  // query fixed
    expect(r.preset['stock-materials']).toEqual(['SS Harder']);        // assignment untouched
    expect(r.stockKept).toBe(true);                                    // and reported
  });

  it('never collapses a MULTI-value stock-materials assignment', () => {
    const fp = { guid: 'p1', material: { query: 'SS' }, 'stock-materials': ['SS Harder', 'Steel, High-Carbon'] };
    const r = pat.apply(fp, 'SS Austenitic - 310, 316');
    expect(r.preset['stock-materials']).toEqual(['SS Harder', 'Steel, High-Carbon']);
    expect(r.stockKept).toBe(true);
  });

  it('reports no change when Fusion already agrees', () => {
    const fp = { guid: 'p1', material: { query: 'Al Wrought - 6061+' }, 'stock-materials': ['Al Wrought - 6061+'] };
    const r = pat.apply(fp, 'Al Wrought - 6061+');
    expect(r.changed).toBe(false);
    expect(r.preset).toBe(fp);
  });

  it('yields a value only for a preset linked to a CAM preset', () => {
    expect(pat.value({ material_preset_id: 'pre_al' }, MATERIALS)).toBe('Al Wrought - 6061+');
    expect(pat.value({ material: { query: 'AL FIN' } }, MATERIALS)).toBe(null);   // bare code — not ours
    expect(pat.value({ material_preset_id: 'deleted' }, MATERIALS)).toBe(null);   // dangling id
  });
});

// A library entry carrying more than the field under test, so "everything else
// survives" is a real assertion rather than a tautology.
const entry = (guid, presets) => ({
  guid,
  type: 'flat end mill',
  description: '1/2 4FL EM',
  'product-id': 'A-3',
  vendor: 'LC-12',
  geometry: { DC: 0.5, LCF: 1, OAL: 3, NOF: 4, LB: 2.125 },
  holder: { description: 'NBT30-SK13C-60', segments: [{ height: 10 }] },
  expressions: { tool_diameter: '0.5 in', tool_vendor: "'LC-12'" },
  'start-values': { presets },
});

function setup(libraryEntries) {
  let library = libraryEntries;
  let uploaded = null;
  const ops = createLibraryOps({
    dispatch: vi.fn(), notify: vi.fn(),
    googleRef: { current: true }, demoModeRef: { current: false },
    fusionReadyRef: { current: true },
    materialsRef: { current: MATERIALS },
    shopSettingsRef: { current: { tool_libraries: [{ id: 'lib1' }], default_tool_library_id: 'lib1' } },
    toolsRef: { current: [] }, holdersRef: { current: [] }, holderLibraryRef: { current: null },
    downloadFusionList: vi.fn(async () => JSON.parse(JSON.stringify(library))),
    uploadFusionList: vi.fn(async (_id, list) => { uploaded = list; library = list; }),
    downloadAllLibraries: vi.fn(async () => []),
    markSetupStepInSettings: vi.fn(),
  });
  return { ops, get uploaded() { return uploaded; }, get library() { return library; } };
}

const tool = (over = {}) => ({
  id: 'FTL-000001', tool_id: 'A-3', description: '1/2 4FL EM', library_id: 'lib1',
  assemblies: [{ assembly_id: 'a1', instance_guid: 'g1' }],
  _instancesRaw: [{ guid: 'g1' }],
  presets: [{ guid: 'p1', name: 'AL - Rough', material_preset_id: 'pre_al', material: { query: 'Al Wrought - 6061+' } }],
  ...over,
});

describe('pushPresetFieldToFusion', () => {
  it('previews without writing, then writes only the stale preset', async () => {
    const fp = { guid: 'p1', name: 'AL - Rough', n: 8000, v_f: 50, material: { query: 'Al Wrought', category: 'metal' } };
    const s = setup([entry('g1', [fp])]);

    const dry = await s.ops.pushPresetFieldToFusion([tool()], 'material', { dryRun: true });
    expect(s.uploaded).toBe(null);
    expect(dry.presetCount).toBe(1);
    expect(dry.changes[0]).toMatchObject({ from: 'Al Wrought', to: 'Al Wrought - 6061+', preset: 'AL - Rough' });

    const res = await s.ops.pushPresetFieldToFusion([tool()], 'material');
    expect(res.wrote).toBe(true);
    const out = s.uploaded[0]['start-values'].presets[0];
    expect(out.material.query).toBe('Al Wrought - 6061+');
    // the rest of the preset is untouched
    expect(out.n).toBe(8000);
    expect(out.v_f).toBe(50);
    expect(out.material.category).toBe('metal');
  });

  it('leaves every other byte of the entry alone', async () => {
    const before = entry('g1', [{ guid: 'p1', name: 'AL - Rough', material: { query: 'Al Wrought' } }]);
    const s = setup([JSON.parse(JSON.stringify(before))]);
    await s.ops.pushPresetFieldToFusion([tool()], 'material');
    const after = s.uploaded[0];
    for (const k of ['guid', 'type', 'description', 'product-id', 'vendor', 'geometry', 'holder', 'expressions']) {
      expect(after[k]).toEqual(before[k]);
    }
  });

  it('is idempotent — a second push has nothing to do', async () => {
    const s = setup([entry('g1', [{ guid: 'p1', name: 'AL - Rough', material: { query: 'Al Wrought' } }])]);
    const first = await s.ops.pushPresetFieldToFusion([tool()], 'material');
    expect(first.presetCount).toBe(1);
    const second = await s.ops.pushPresetFieldToFusion([tool()], 'material', { dryRun: true });
    expect(second.presetCount).toBe(0);
    expect(second.changes).toEqual([]);
  });

  it('corrects the SAME preset on every instance of a multi-assembly tool', async () => {
    // Presets are replicated identically onto each instance, so all copies must
    // move — otherwise opening the other assembly in Fusion shows the old name.
    const p = () => ({ guid: 'p1', name: 'AL - Rough', material: { query: 'Al Wrought' } });
    const s = setup([entry('g1', [p()]), entry('g2', [p()])]);
    const t = tool({
      assemblies: [{ instance_guid: 'g1' }, { instance_guid: 'g2' }],
      _instancesRaw: [{ guid: 'g1' }, { guid: 'g2' }],
    });
    const res = await s.ops.pushPresetFieldToFusion([t], 'material');
    expect(res.presetCount).toBe(1);   // one preset...
    expect(res.count).toBe(2);         // ...rewritten in two entries
    expect(s.uploaded[0]['start-values'].presets[0].material.query).toBe('Al Wrought - 6061+');
    expect(s.uploaded[1]['start-values'].presets[0].material.query).toBe('Al Wrought - 6061+');
  });

  it('skips a preset with no CAM-preset link — a bare code is never pushed', async () => {
    const s = setup([entry('g1', [{ guid: 'p1', name: 'SS', material: { query: 'SS' } }])]);
    const t = tool({ presets: [{ guid: 'p1', name: 'SS', material: { query: 'SS' } }] });
    const res = await s.ops.pushPresetFieldToFusion([t], 'material', { dryRun: true });
    expect(res.presetCount).toBe(0);
    expect(s.uploaded).toBe(null);
  });

  it('touches no Fusion library for a no-Fusion tool', async () => {
    const s = setup([]);
    const res = await s.ops.pushPresetFieldToFusion([tool({ no_fusion_link: true })], 'material');
    expect(res.count).toBe(0);
    expect(s.uploaded).toBe(null);
  });

  it('refuses while the two-stage load is still syncing', async () => {
    const ops = createLibraryOps({
      dispatch: vi.fn(), notify: vi.fn(),
      googleRef: { current: true }, demoModeRef: { current: false },
      fusionReadyRef: { current: false },                       // provisional paint
      materialsRef: { current: MATERIALS }, shopSettingsRef: { current: {} },
      toolsRef: { current: [] }, holdersRef: { current: [] }, holderLibraryRef: { current: null },
      downloadFusionList: vi.fn(), uploadFusionList: vi.fn(),
      downloadAllLibraries: vi.fn(), markSetupStepInSettings: vi.fn(),
    });
    await expect(ops.pushPresetFieldToFusion([tool()], 'material')).rejects.toThrow(/still syncing/i);
  });
});
