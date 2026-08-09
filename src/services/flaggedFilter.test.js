import { describe, it, expect } from 'vitest';
import { applyFilters } from './searchEngine.js';
import { displayConflicts } from '../utils/toolConflicts.js';

// The "needs fixing" filter exists so the library-wide banner can be clicked
// through to the tools it counted. The invariant worth locking is that the two
// never disagree: the banner counts with displayConflicts, so the filter has to
// select exactly that set.

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
    const bannerCount = LIB.filter(t => displayConflicts(t).length > 0).length;
    const out = applyFilters(LIB, { flaggedOnly: true });
    expect(out).toHaveLength(bannerCount);
    expect(out.map(t => t.id)).toEqual(['A-1', 'A-3', 'A-5']);
  });

  it('is off by default — an absent flag must not filter anything', () => {
    expect(applyFilters(LIB, {})).toHaveLength(5);
    expect(applyFilters(LIB, { flaggedOnly: false })).toHaveLength(5);
  });

  it('picks up a conflict that has not been saved yet (runtime-only)', () => {
    // displayConflicts unions persisted conflicts with the freshly-detected
    // _combineConflicts a just-loaded tool carries, so the filter must too.
    const fresh = tool('A-9', { _combineConflicts: [{ field: 'coating', values: ['AlTiN', 'TiCN'] }] });
    expect(applyFilters([...LIB, fresh], { flaggedOnly: true }).map(t => t.id)).toContain('A-9');
  });

  it('still composes with other filters when a URL asks for both', () => {
    // A shared link like ?flagged=1&type=drill is a deliberate combined filter.
    const out = applyFilters(LIB, { flaggedOnly: true, toolTypes: ['drill'] });
    expect(out.map(t => t.id)).toEqual(['A-3']);
  });

  it('returns nothing rather than everything when the library is clean', () => {
    expect(applyFilters([tool('A-2'), tool('A-4')], { flaggedOnly: true })).toEqual([]);
  });
});
