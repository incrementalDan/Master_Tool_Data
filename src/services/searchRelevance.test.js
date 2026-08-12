// Two things the search box could not do, both measured on the real library:
//   1. Find a tool by a purchasing number — 151 EDPs and 156 vendor numbers
//      matched nothing, because textSearch never looked at `tool.purchasing`.
//   2. Put an exact match first — "A-1" matches 33 tools by substring (A-1,
//      A-11, A-101, A-123 …) and textSearch is a FILTER, so the one tool
//      actually called A-1 sat wherever the sort dropdown left it.
import { describe, it, expect } from 'vitest';
import { textSearch, sortResults, relevanceTier, matchedPurchasing, RELEVANCE } from './searchEngine.js';

// Shapes and values from the shop's real records.
const tool = (over = {}) => ({
  id: over.tool_id || 'FTL-x', tool_type: 'flat end mill', description: 'EM',
  assemblies: [], ...over,
});
const A1 = tool({
  tool_id: 'A-1', description: '3/8 Endmill',
  purchasing: {
    manufacturers: [{ id: 'm1', name: 'Helical Solutions', edp: '48261' }],
    vendors: [{ id: 'v1', manufacturer_id: 'm1', name: 'MSC Industrial', vendor_num: '94721453' }],
  },
});
const NEIGHBOURS = ['A-11', 'A-101', 'A-123', 'A-199'].map(id => tool({ tool_id: id }));

describe('search — purchasing numbers', () => {
  it('finds a tool by its manufacturer EDP#', () => {
    expect(textSearch([A1, ...NEIGHBOURS], '48261').map(t => t.tool_id)).toEqual(['A-1']);
  });

  it("finds a tool by its vendor's own catalog number", () => {
    expect(textSearch([A1, ...NEIGHBOURS], '94721453').map(t => t.tool_id)).toEqual(['A-1']);
  });

  it('finds a tool by a purchasing manufacturer/vendor name', () => {
    expect(textSearch([A1, ...NEIGHBOURS], 'helical').map(t => t.tool_id)).toEqual(['A-1']);
    expect(textSearch([A1, ...NEIGHBOURS], 'msc').map(t => t.tool_id)).toEqual(['A-1']);
  });

  // The card shows no purchasing numbers, so a hit on one looks unrelated to
  // what was typed unless the result says why it matched.
  it('reports which number matched, for the card', () => {
    expect(matchedPurchasing(A1, '48261')).toMatchObject({ kind: 'EDP', value: '48261' });
    expect(matchedPurchasing(A1, '48261').label).toBe('Helical Solutions EDP 48261');
    expect(matchedPurchasing(A1, 'nothing')).toBeNull();
  });
});

describe('search — relevance', () => {
  const byAdded = (a, b) => (a.tool_id || '').localeCompare(b.tool_id || '');

  it('puts the exact tool ID first, ahead of every substring match', () => {
    // Deliberately ordered so A-1 is LAST going in — the bug was that filtering
    // preserved input order and nothing ever lifted it out.
    const found = textSearch([...NEIGHBOURS, A1], 'A-1');
    expect(found).toHaveLength(5);
    expect(sortResults(found, 'A-1', byAdded)[0].tool_id).toBe('A-1');
  });

  it('matches an ID with the punctuation left out', () => {
    expect(textSearch([A1, ...NEIGHBOURS], 'a1').map(t => t.tool_id)).toContain('A-1');
    expect(relevanceTier(A1, 'a1')).toBe(RELEVANCE.EXACT_ID);
  });

  it('treats an exact purchasing number as an exact match too', () => {
    expect(relevanceTier(A1, '48261')).toBe(RELEVANCE.EXACT_ID);
    expect(relevanceTier(A1, '94721453')).toBe(RELEVANCE.EXACT_ID);
  });

  it('ranks a prefix match above an unrelated one', () => {
    expect(relevanceTier(tool({ tool_id: 'A-101' }), 'A-1')).toBe(RELEVANCE.ID_PREFIX);
    expect(relevanceTier(tool({ tool_id: 'B-7', description: 'A-1 in the notes' }), 'A-1'))
      .toBe(RELEVANCE.OTHER);
  });

  // ⚠️ Relevance is a TIER that breaks ties with the chosen sort — it must not
  // override a sort the user explicitly picked.
  it('keeps the chosen sort within a tier', () => {
    const byDiaAsc = (a, b) => (a.diameter || 0) - (b.diameter || 0);
    const list = [tool({ tool_id: 'A-11', diameter: 0.5 }), tool({ tool_id: 'A-101', diameter: 0.125 })];
    expect(sortResults(list, 'A-1', byDiaAsc).map(t => t.tool_id)).toEqual(['A-101', 'A-11']);
  });

  it('is exactly the chosen sort when there is no query', () => {
    const list = [tool({ tool_id: 'B-2' }), tool({ tool_id: 'A-1' })];
    expect(sortResults(list, '', byAdded).map(t => t.tool_id)).toEqual(['A-1', 'B-2']);
  });

  // An exact match on a RETIRED id is still unambiguously "I want this tool".
  it('counts a legacy ID as an exact match', () => {
    expect(relevanceTier(tool({ tool_id: 'LC-1405', legacy_ids: ['A-3'] }), 'A-3'))
      .toBe(RELEVANCE.EXACT_ID);
  });

  it('counts the machine number in either form', () => {
    const t = tool({ tool_id: 'A-9', machine_tool_number: 31 });
    expect(relevanceTier(t, '31')).toBe(RELEVANCE.EXACT_ID);
    expect(relevanceTier(t, 'T31')).toBe(RELEVANCE.EXACT_ID);
  });
});
