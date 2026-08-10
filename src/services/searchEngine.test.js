import { describe, it, expect } from 'vitest';
import { textSearch, applyFilters, componentTextIndex, matchedComponent } from './searchEngine.js';

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

describe('components are findable through the tool that pairs them', () => {
  // A holder body / insert is a real object the shop buys and looks up by its
  // own ProShop number, so it must be findable. It has no page of its own by
  // design, so its text folds into the insert tool that pairs it rather than
  // becoming a result that leads nowhere.
  const components = [
    { id: 'c1', tool_id: 'I-224', description: '2.5" Dodeka Kenn Face Mill' },
    { id: 'c2', tool_id: 'G-223', description: 'Kenn. 45 ST Mill Insert' },
  ];
  const faceMill = {
    id: 't1', description: '2.5 FACE MILL', tool_id: 'A-9',
    pairing: { holder_component_id: 'c1', insert_component_id: 'c2' },
  };
  const endMill = { id: 't2', description: '1/2 4FL EM', tool_id: 'A-10' };
  const tools = [faceMill, endMill];
  const idx = () => componentTextIndex(tools, components);

  it('finds the insert tool by its INSERT number', () => {
    expect(textSearch(tools, 'G-223', idx()).map(t => t.id)).toEqual(['t1']);
  });

  it('finds it by the holder body number too', () => {
    expect(textSearch(tools, 'I-224', idx()).map(t => t.id)).toEqual(['t1']);
  });

  it('finds it by a word from the component description', () => {
    expect(textSearch(tools, 'dodeka', idx()).map(t => t.id)).toEqual(['t1']);
  });

  it('does not drag in unrelated tools', () => {
    expect(textSearch(tools, 'G-223', idx()).map(t => t.id)).not.toContain('t2');
  });

  it('says WHICH part matched, so the result does not look unrelated', () => {
    expect(matchedComponent(faceMill, 'G-223', components).tool_id).toBe('G-223');
    expect(matchedComponent(faceMill, '2.5 FACE MILL', components)).toBe(null); // matched the tool itself
    expect(matchedComponent(endMill, 'G-223', components)).toBe(null);
  });

  it('a tool with no pairing is unaffected', () => {
    expect(componentTextIndex([endMill], components).size).toBe(0);
    expect(textSearch(tools, '1/2 4FL', idx()).map(t => t.id)).toEqual(['t2']);
  });
});
