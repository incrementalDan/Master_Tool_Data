import { describe, it, expect } from 'vitest';
import { textSearch, applyFilters } from './searchEngine.js';

const tools = [
  { id: '1', description: 'Cobalt drill', material: 'cobalt' },
  { id: '2', description: 'HSS drill', material: 'hss' },
  { id: '3', description: 'Carbide end mill', material: 'carbide' },
];

describe('tool material search — Cobalt/HSS merge (search only)', () => {
  it('textSearch: "cobalt" also finds hss tools, and vice versa', () => {
    expect(textSearch(tools, 'cobalt').map(t => t.id).sort()).toEqual(['1', '2']);
    expect(textSearch(tools, 'hss').map(t => t.id).sort()).toEqual(['1', '2']);
  });

  it('textSearch: carbide is unaffected', () => {
    expect(textSearch(tools, 'carbide').map(t => t.id)).toEqual(['3']);
  });

  it('material facet: selecting Cobalt also matches HSS tools, and vice versa', () => {
    const byCobalt = applyFilters(tools, { facets: { material: 'cobalt' } });
    expect(byCobalt.map(t => t.id).sort()).toEqual(['1', '2']);
    const byHss = applyFilters(tools, { facets: { material: 'hss' } });
    expect(byHss.map(t => t.id).sort()).toEqual(['1', '2']);
  });

  it('material facet: carbide is unaffected', () => {
    const byCarbide = applyFilters(tools, { facets: { material: 'carbide' } });
    expect(byCarbide.map(t => t.id)).toEqual(['3']);
  });

  it('does not merge synonyms for other text fields (e.g. description)', () => {
    // "cobalt" only appears in tool 1's description; the synonym merge is
    // scoped to the `material` field, not a global text-search behavior.
    const onlyDescMatch = [{ id: '4', description: 'hss reamer', material: 'carbide' }];
    expect(textSearch(onlyDescMatch, 'cobalt')).toEqual([]);
  });

  it('stored material values are untouched by search', () => {
    textSearch(tools, 'cobalt');
    expect(tools.map(t => t.material)).toEqual(['cobalt', 'hss', 'carbide']);
  });
});
