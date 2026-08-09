import { describe, it, expect } from 'vitest';
import { applyFilters } from './searchEngine.js';
import { toolNeedsAttention } from '../utils/toolConflicts.js';

// A tool preset whose material is a bare code links to no CAM preset — the
// second thing "needs fixing" covers, alongside import conflicts.
const MATERIALS = {
  groups: [{ id: 'N', label: 'Non-Ferrous', code: 'AL' }],
  presets: [{ id: 'pre_al', group_id: 'N', name: 'Al Wrought - 6061+' }],
  materials: [],
};

// The "needs fixing" filter exists so the library-wide banner can be clicked
// through to the tools it counted. The invariant worth locking is that the two
// never disagree — both go through toolNeedsAttention, so the filter selects
// exactly the set the banner counted.

const tool = (id, over = {}) => ({
  id, tool_id: id, description: `${id} desc`, tool_type: 'flat end mill',
  diameter: 0.5, presets: [], assemblies: [], ...over,
});

const conflicted = (id, over = {}) => tool(id, {
  conflicts: [{ id: 'c1', type: 'field', field: 'flute_length', values: [0.7, 0.75], detected_at: 'x' }],
  ...over,
});

const LIB = [
  conflicted('A-1'),
  tool('A-2'),
  conflicted('A-3', { tool_type: 'drill' }),
  tool('A-4'),
  conflicted('A-5', { preferred_machine_id: 'm2' }),
];

describe('the needs-fixing filter', () => {
  it('selects exactly the tools the banner counts', () => {
    const bannerCount = LIB.filter(t => toolNeedsAttention(t, MATERIALS)).length;
    const out = applyFilters(LIB, { flaggedOnly: true, materials: MATERIALS });
    expect(out).toHaveLength(bannerCount);
    expect(out.map(t => t.id)).toEqual(['A-1', 'A-3', 'A-5']);
  });

  it('is off by default — an absent flag must not filter anything', () => {
    expect(applyFilters(LIB, {})).toHaveLength(5);
    expect(applyFilters(LIB, { flaggedOnly: false })).toHaveLength(5);
  });

  it('also catches a preset material with no CAM-preset link', () => {
    const unlinked = tool('A-7', {
      presets: [{ guid: 'p1', name: 'AL', material: { query: 'AL' } }],   // bare code
    });
    const out = applyFilters([...LIB, unlinked], { flaggedOnly: true, materials: MATERIALS });
    expect(out.map(t => t.id)).toContain('A-7');
  });

  it('does not flag a preset that IS linked', () => {
    const linked = tool('A-8', {
      presets: [{ guid: 'p1', material_preset_id: 'pre_al', material: { query: 'Al Wrought - 6061+' } }],
    });
    expect(applyFilters([linked], { flaggedOnly: true, materials: MATERIALS })).toEqual([]);
  });

  it('degrades to conflicts only while the Materials library is still loading', () => {
    // Without materials the whole library would otherwise flag as unlinked.
    const unlinked = tool('A-7', { presets: [{ guid: 'p1', material: { query: 'AL' } }] });
    const out = applyFilters([...LIB, unlinked], { flaggedOnly: true });
    expect(out.map(t => t.id)).toEqual(['A-1', 'A-3', 'A-5']);
  });

  it('leaves no-Fusion tools out — that is a state, not an error', () => {
    const owned = tool('A-6', { no_fusion_link: true });
    expect(applyFilters([...LIB, owned], { flaggedOnly: true, materials: MATERIALS }).map(t => t.id))
      .not.toContain('A-6');
  });

  it('picks up a conflict that has not been saved yet (runtime-only)', () => {
    // displayConflicts unions persisted conflicts with the freshly-detected
    // _combineConflicts a just-loaded tool carries, so the filter must too.
    const fresh = tool('A-9', { _combineConflicts: [{ field: 'coating', values: ['AlTiN', 'TiCN'] }] });
    expect(applyFilters([...LIB, fresh], { flaggedOnly: true }).map(t => t.id)).toContain('A-9');
  });

  it('still composes with other filters when a URL asks for both', () => {
    // A shared link like ?flagged=1&type=drill is a deliberate combined filter.
    const out = applyFilters(LIB, { flaggedOnly: true, materials: MATERIALS, toolTypes: ['drill'] });
    expect(out.map(t => t.id)).toEqual(['A-3']);
  });

  it('returns nothing rather than everything when the library is clean', () => {
    expect(applyFilters([tool('A-2'), tool('A-4')], { flaggedOnly: true, materials: MATERIALS })).toEqual([]);
  });
});

describe('the not-in-Fusion filter', () => {
  const OWNED = [tool('A-1'), tool('A-2', { no_fusion_link: true }), tool('A-3', { no_fusion_link: false })];

  it('selects only tools with no Fusion entry', () => {
    expect(applyFilters(OWNED, { noFusionOnly: true }).map(t => t.id)).toEqual(['A-2']);
  });

  it('is off by default', () => {
    expect(applyFilters(OWNED, {})).toHaveLength(3);
  });

  it('is INDEPENDENT of needs-fixing — the two can be combined or used alone', () => {
    const both = conflicted('A-4', { no_fusion_link: true });
    const lib = [...OWNED, both];
    expect(applyFilters(lib, { noFusionOnly: true, flaggedOnly: true, materials: MATERIALS }).map(t => t.id))
      .toEqual(['A-4']);
    expect(applyFilters(lib, { noFusionOnly: true }).map(t => t.id)).toEqual(['A-2', 'A-4']);
  });
});
