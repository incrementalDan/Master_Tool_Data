import { describe, it, expect } from 'vitest';
import {
  newLocationSystem, newLevelOption,
  systemOutputSignature, systemStructureSignature, findSystemConflicts,
  parseLocationString, analyzeSystem, nextBin,
  newImportRule, routeProShopLocations, parseTriggerList, pruneAcknowledgedGaps,
} from './locationSystem.js';

// Helper: a system with a custom-prefix drawer + auto bin (the default shape).
function lcSystem(name, { ident = 'LC', delim = '-', binStart = 1000 } = {}) {
  const s = newLocationSystem(name);
  s.levels.drawer = { on: true, levelType: 'Drawer', customTypeName: '', identFormat: 'custom', customIdent: ident, options: [] };
  s.levels.bin = { fixed: false, start: binStart, fixedVal: '', skip: [] };
  s.delimiters = { zs: '-', sd: '-', db: delim };
  return s;
}

describe('location system signatures', () => {
  it('two systems with the same composed output have the same output signature', () => {
    const a = lcSystem('Cabinet A');
    const b = lcSystem('Cabinet B'); // different NAME, same output recipe
    expect(systemOutputSignature(a)).toBe(systemOutputSignature(b));
  });

  it('the level TYPE name does not affect the output signature (only what shows)', () => {
    const a = lcSystem('A');
    const b = lcSystem('B');
    // Relabel b's drawer as a "Shelf" with a custom type name — never appears in the string.
    b.levels.drawer.levelType = 'custom';
    b.levels.drawer.customTypeName = 'Shelf';
    expect(systemOutputSignature(a)).toBe(systemOutputSignature(b));
  });

  it('a different delimiter changes the output signature but not the structure signature', () => {
    const a = lcSystem('A', { delim: '-' });
    const b = lcSystem('B', { delim: '.' });
    expect(systemOutputSignature(a)).not.toBe(systemOutputSignature(b));
    expect(systemStructureSignature(a)).toBe(systemStructureSignature(b));
  });

  it('different option label sets do not collide', () => {
    const a = newLocationSystem('A');
    a.levels.drawer = { on: true, levelType: 'Drawer', customTypeName: '', identFormat: 'letter', customIdent: '', options: [newLevelOption('A', 0), newLevelOption('B', 1)] };
    const b = newLocationSystem('B');
    b.levels.drawer = { on: true, levelType: 'Drawer', customTypeName: '', identFormat: 'letter', customIdent: '', options: [newLevelOption('C', 0), newLevelOption('D', 1)] };
    expect(systemStructureSignature(a)).not.toBe(systemStructureSignature(b));
  });
});

describe('findSystemConflicts', () => {
  it('flags two systems that produce identical output as an output clash (both directions)', () => {
    const a = lcSystem('A'); const b = lcSystem('B');
    const conflicts = findSystemConflicts([a, b]);
    expect(conflicts.get(a.id).some(c => c.type === 'output' && c.otherId === b.id)).toBe(true);
    expect(conflicts.get(b.id).some(c => c.type === 'output' && c.otherId === a.id)).toBe(true);
  });

  it('flags a delimiter-only difference as a near-duplicate, not an output clash', () => {
    const a = lcSystem('A', { delim: '-' }); const b = lcSystem('B', { delim: '.' });
    const conflicts = findSystemConflicts([a, b]);
    const ca = conflicts.get(a.id);
    expect(ca.some(c => c.type === 'delimiter')).toBe(true);
    expect(ca.some(c => c.type === 'output')).toBe(false);
  });

  it('flags a duplicate name even when outputs differ', () => {
    const a = lcSystem('Main', { ident: 'LC' });
    const b = lcSystem('main', { ident: 'RC' }); // same name (case-insensitive), different output
    const conflicts = findSystemConflicts([a, b]);
    expect(conflicts.get(a.id).some(c => c.type === 'name')).toBe(true);
    expect(conflicts.get(a.id).some(c => c.type === 'output')).toBe(false);
  });

  it('returns no conflicts for clearly distinct systems', () => {
    const a = lcSystem('A', { ident: 'LC' });
    const b = lcSystem('B', { ident: 'RC' });
    expect(findSystemConflicts([a, b]).size).toBe(0);
  });
});

describe('parseLocationString — custom prefix is optional (bare numbers)', () => {
  const sys = lcSystem('LC', { ident: 'LC', binStart: 1 });

  it('parses a prefixed location "LC-140" to bin 140', () => {
    expect(parseLocationString('LC-140', sys)?.bin).toBe(140);
  });

  it('parses a BARE number "140" (how ProShop stores it) to bin 140', () => {
    expect(parseLocationString('140', sys)?.bin).toBe(140);
  });

  it('tolerates spacing / missing separator ("LC 84", "LC140")', () => {
    expect(parseLocationString('LC 84', sys)?.bin).toBe(84);
    expect(parseLocationString('LC140', sys)?.bin).toBe(140);
  });
});

describe('analyzeSystem — bare-number free-text locations are matched, next bin is correct', () => {
  it('counts bare-number locations so the next bin reflects the whole library', () => {
    const sys = lcSystem('LC', { ident: 'LC', binStart: 1 });
    const tools = [];
    for (let i = 1; i <= 20; i++) tools.push({ id: 'a' + i, location: `LC-${i}` });   // prefixed
    for (let i = 21; i <= 250; i++) tools.push({ id: 'b' + i, location: `${i}` });     // bare number
    const a = analyzeSystem(tools, sys);
    expect(a.matched.length).toBe(250);
    expect(a.unmatched.length).toBe(0);
    expect(a.nextBin).toBe(251);   // not 21 — every location was recognized
  });
});

// ─── ProShop import matching ─────────────────────────────────────────────────
// Two systems, the shape this was built for: an "LC" cabinet where every bin
// holds one tool, plus a second system that deliberately parks many tools on one
// sentinel number. Neither is hardcoded — both are expressed as config.
function twoSystemShop({ sentinel = 10000 } = {}) {
  const lc = lcSystem('LC Cabinet', { ident: 'LC', binStart: 1 });
  lc.allowDuplicates = false;
  lc.proShopImport = { ...newImportRule(), match: 'any_unique', flagGaps: true };

  const index = lcSystem('Index', { ident: 'DI', binStart: 1 });
  index.allowDuplicates = true;
  index.proShopImport = { ...newImportRule(), match: 'triggers', triggers: [sentinel] };

  return [lc, index];
}

const rows = (pairs) => pairs.map(([key, value]) => ({ key, value }));

describe('routeProShopLocations — the per-system import cascade', () => {
  it('routes unique numbers to the any_unique system and the sentinel to its own', () => {
    const [lc, index] = twoSystemShop();
    const r = routeProShopLocations(
      rows([['A-1', '140'], ['A-2', '141'], ['D-1', '10000'], ['D-2', '10000'], ['D-3', '10000']]),
      [lc, index],
    );
    const by = Object.fromEntries(r.assignments.map(a => [a.key, a.systemId]));
    expect(by['A-1']).toBe(lc.id);
    expect(by['A-2']).toBe(lc.id);
    expect(by['D-1']).toBe(index.id);
    expect(by['D-3']).toBe(index.id);
  });

  it('an explicit trigger wins even when that value appears only ONCE', () => {
    // The failure this guards: with one drill in the export, its sentinel is
    // "unique", so an ordered cascade alone would let the LC system swallow it.
    const [lc, index] = twoSystemShop();
    const r = routeProShopLocations(rows([['A-1', '140'], ['D-1', '10000']]), [lc, index]);
    const drill = r.assignments.find(a => a.key === 'D-1');
    expect(drill.systemId).toBe(index.id);
  });

  it('uniqueness is judged across the WHOLE file, not row by row', () => {
    // Streaming would call the FIRST 777 unique and hand it to the LC system.
    const lc = lcSystem('LC', { ident: 'LC', binStart: 1 });
    lc.proShopImport = { ...newImportRule(), match: 'any_unique' };
    const r = routeProShopLocations(rows([['A-1', '777'], ['A-2', '777']]), [lc]);
    expect(r.assignments.length).toBe(0);
    expect(r.exceptions.filter(e => e.type === 'unmatched').length).toBe(2);
  });

  it('flags a repeated number in a system that does not allow duplicates', () => {
    const [lc, index] = twoSystemShop();
    // A range system claims both copies so the duplicate check can see them.
    lc.proShopImport = { ...newImportRule(), match: 'range', range: { min: 1, max: 9999 } };
    const r = routeProShopLocations(rows([['A-1', '140'], ['A-2', '140']]), [lc, index]);
    const dup = r.exceptions.find(e => e.type === 'duplicate');
    expect(dup.bin).toBe(140);
    expect(dup.keys.sort()).toEqual(['A-1', 'A-2']);
  });

  it('does NOT flag duplicates in a system that expects them', () => {
    const [lc, index] = twoSystemShop();
    const r = routeProShopLocations(rows([['D-1', '10000'], ['D-2', '10000']]), [lc, index]);
    expect(r.exceptions.filter(e => e.type === 'duplicate')).toEqual([]);
  });

  it('reports a blank location cell rather than silently skipping it', () => {
    const [lc, index] = twoSystemShop();
    const r = routeProShopLocations(rows([['A-9', ''], ['A-8', '  ']]), [lc, index]);
    expect(r.exceptions.filter(e => e.type === 'no_value').length).toBe(2);
  });

  it('reports a number no system claimed', () => {
    const [lc, index] = twoSystemShop();
    lc.proShopImport = { ...newImportRule(), match: 'range', range: { min: 1, max: 500 } };
    const r = routeProShopLocations(rows([['A-1', '900']]), [lc, index]);
    expect(r.exceptions.find(e => e.type === 'unmatched').bin).toBe(900);
  });

  it('flags — never half-assigns — a system a bare number cannot determine', () => {
    const sys = lcSystem('Multi', { ident: 'MC', binStart: 1 });
    sys.levels.station = {
      on: true, levelType: 'Cabinet', customTypeName: '', identFormat: 'number',
      customIdent: '', options: [newLevelOption('1', 0), newLevelOption('2', 1)],
    };
    sys.proShopImport = { ...newImportRule(), match: 'any_unique' };
    const r = routeProShopLocations(rows([['A-1', '140']]), [sys]);
    expect(r.assignments).toEqual([]);
    expect(r.exceptions[0].type).toBe('needs_levels');
  });

  it('an established shop with NO rules configured keeps the old behaviour', () => {
    // Rules default to 'off'; without the legacy fallback an existing shop's
    // import would silently stop assigning locations.
    const sys = lcSystem('LC', { ident: 'LC', binStart: 1 });
    delete sys.proShopImport;
    const r = routeProShopLocations(rows([['A-1', '140'], ['A-2', '141']]), [sys]);
    expect(r.assignments.length).toBe(2);
    expect(r.assignments[0].location.system_id).toBe(sys.id);
  });
});

describe('bin gaps are informational, never a reservation', () => {
  const sys = () => {
    const s = lcSystem('LC', { ident: 'LC', binStart: 1 });
    s.proShopImport = { ...newImportRule(), match: 'any_unique', flagGaps: true };
    return s;
  };

  it('reports the missing numbers inside the occupied range', () => {
    const r = routeProShopLocations(rows([['A', '1'], ['B', '2'], ['C', '5']]), [sys()]);
    expect(r.perSystem[0].gaps).toEqual([3, 4]);
  });

  it('an acknowledged gap stops being reported but stays assignable', () => {
    const s = sys();
    s.acknowledged_gaps = [3];
    const r = routeProShopLocations(rows([['A', '1'], ['B', '2'], ['C', '5']]), [s]);
    expect(r.perSystem[0].gaps).toEqual([4]);
    // Crucially NOT added to skip[] — nextBin can still hand out 3.
    expect(nextBin(s, new Set([1, 2, 5]))).toBe(3);
  });

  it('acknowledging a gap is undone the moment a tool fills it', () => {
    const s = { ...sys(), acknowledged_gaps: [3, 4] };
    const pruned = pruneAcknowledgedGaps(s, new Set([1, 2, 3, 5]));
    expect(pruned.acknowledged_gaps).toEqual([4]);
  });

  it('no gaps are reported when the system does not ask for them', () => {
    const s = sys();
    s.proShopImport = { ...newImportRule(), match: 'any_unique', flagGaps: false };
    const r = routeProShopLocations(rows([['A', '1'], ['C', '5']]), [s]);
    expect(r.perSystem[0].gaps).toEqual([]);
  });
});

describe('parseTriggerList', () => {
  it('parses a comma-separated box, ignoring blanks and junk', () => {
    expect(parseTriggerList('10000, 20000 ,, abc, 30')).toEqual([10000, 20000, 30]);
  });
});
