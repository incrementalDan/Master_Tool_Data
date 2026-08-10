import { describe, it, expect } from 'vitest';
import {
  newLocationSystem, newLevelOption, systemOutputSignature, systemStructureSignature, findSystemConflicts, parseLocationString, analyzeSystem, nextBin, newImportRule, routeProShopLocations, parseTriggerList, pruneAcknowledgedGaps, libraryLocationIssues, analyzeBinSequence, findBinGaps, usedBinsForSystem, normalizeBin, composeLocationString, libraryLocationStatus,
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
    // Crucially NOT reserved: acknowledging never writes to skip[], so bin 3 can
    // still be assigned by hand in the location picker. Auto-assignment is a
    // separate question — nextBin always moves forward past a hole.
    expect(s.levels.bin.skip).toEqual([]);
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

describe('libraryLocationIssues — the durable, derived worklist', () => {
  const lc = () => {
    const s = lcSystem('LC', { ident: 'LC', binStart: 1 });
    s.allowDuplicates = false;
    s.proShopImport = { ...newImportRule(), match: 'any_unique', flagGaps: true };
    return s;
  };
  const at = (id, sysId, bin) => ({ id, tool_id: id, tool_location: { system_id: sysId, bin } });

  it('finds two tools sharing a bin', () => {
    const s = lc();
    const issues = libraryLocationIssues([at('A', s.id, 5), at('B', s.id, 5), at('C', s.id, 6)], [s]);
    const dup = issues.find(i => i.type === 'duplicate');
    expect(dup.bin).toBe(5);
    expect(dup.tools.map(t => t.id).sort()).toEqual(['A', 'B']);
  });

  it('does not flag a shared bin in a system that allows duplicates', () => {
    const s = lc();
    s.allowDuplicates = true;
    const issues = libraryLocationIssues([at('A', s.id, 5), at('B', s.id, 5)], [s]);
    expect(issues.filter(i => i.type === 'duplicate')).toEqual([]);
  });

  it('reports gaps and clears them once the hole is filled', () => {
    const s = lc();
    const before = libraryLocationIssues([at('A', s.id, 1), at('B', s.id, 4)], [s]);
    // Reported as ONE run (2–3), not one row per empty number.
    expect(before.filter(i => i.type === 'gap').map(i => [i.from, i.to])).toEqual([[2, 3]]);
    const after = libraryLocationIssues(
      [at('A', s.id, 1), at('X', s.id, 2), at('Y', s.id, 3), at('B', s.id, 4)], [s],
    );
    expect(after.filter(i => i.type === 'gap')).toEqual([]);
  });

  it('is a no-op for a clean system (the list empties as things are fixed)', () => {
    const s = lc();
    expect(libraryLocationIssues([at('A', s.id, 1), at('B', s.id, 2)], [s])).toEqual([]);
  });
});

describe('nextBin skips holes but never blocks them', () => {
  const sys = (over = {}) => {
    const s = lcSystem('LC', { ident: 'LC', binStart: 1 });
    s.levels.bin = { fixed: false, start: 1, fixedVal: '', skip: [], ...over };
    return s;
  };

  it('continues ABOVE the highest bin, it does not fill the lowest hole', () => {
    // 25 is missing. Handing it to the next new tool would double-book a drawer
    // that very likely still has something in it.
    const used = new Set();
    for (let i = 1; i <= 233; i++) if (i !== 25) used.add(i);
    expect(nextBin(sys(), used)).toBe(234);
  });

  it('a gap stays freely assignable — it is never added to skip[]', () => {
    const s = sys();
    const used = new Set([1, 2, 5]);
    s.acknowledged_gaps = [3, 4];        // both reported and dismissed
    expect(s.levels.bin.skip).toEqual([]); // acknowledging never reserves
    expect(nextBin(s, used)).toBe(6);      // auto-assignment still moves forward
  });

  it('still honours reserved numbers at the top of the range', () => {
    expect(nextBin(sys({ skip: [6, 7] }), new Set([1, 2, 5]))).toBe(8);
  });

  it('starts at the configured start when nothing is used', () => {
    expect(nextBin(sys({ start: 1000 }), new Set())).toBe(1000);
  });

  it('ignores bins below the configured start', () => {
    expect(nextBin(sys({ start: 1000 }), new Set([3, 9]))).toBe(1000);
  });
});

describe('a duplicates-allowed system gets no bin suggestion', () => {
  it('returns null rather than inventing sentinel+1', () => {
    const s = lcSystem('Index', { ident: 'DI', binStart: 1 });
    s.allowDuplicates = true;
    // Every tool parked on one sentinel — "next" is meaningless here.
    expect(nextBin(s, new Set([10000]))).toBe(null);
  });

  it('a normal system is unaffected', () => {
    const s = lcSystem('LC', { ident: 'LC', binStart: 1 });
    expect(nextBin(s, new Set([1, 2, 3]))).toBe(4);
  });

  it('a fixed bin still returns its fixed value', () => {
    const s = lcSystem('Index', { ident: 'DI' });
    s.allowDuplicates = true;
    s.levels.bin = { fixed: true, start: 1, fixedVal: '10000', skip: [] };
    expect(nextBin(s, new Set())).toBe('10000');
  });
});

describe('setup mistakes must not silently swallow the file', () => {
  const sys = (name, patch) => {
    const s = lcSystem(name, { ident: name, binStart: 1 });
    s.proShopImport = { ...newImportRule(), ...patch };
    return s;
  };

  it('a range with BOTH bounds empty claims nothing', () => {
    // Half-finished setting, not "every number" — as a generic rule it would
    // otherwise outrank every later system and swallow the whole file.
    const r = routeProShopLocations(rows([['T1', '5'], ['T2', '99999']]), [sys('A', { match: 'range' })]);
    expect(r.assignments).toEqual([]);
    expect(r.exceptions.every(e => e.type === 'unmatched')).toBe(true);
  });

  it('a one-sided range still works', () => {
    const r = routeProShopLocations(
      rows([['T1', '5'], ['T2', '99999']]),
      [sys('A', { match: 'range', range: { min: null, max: 100 } })],
    );
    expect(r.assignments.map(a => a.bin)).toEqual([5]);
  });

  it('triggers mode with an empty list claims nothing (inert, not greedy)', () => {
    const r = routeProShopLocations(rows([['T1', '5']]), [sys('A', { match: 'triggers', triggers: [] })]);
    expect(r.assignments).toEqual([]);
  });
});

describe('one out-of-range bin must not invent hundreds of gaps', () => {
  // Straight from a real ProShop run: an LC cabinet whose bins really stop at
  // 253, plus one tool left on 1000. Reporting every empty number between them
  // produced 768 "skipped number" rows — wallpaper, and untrue: nothing is
  // skipped up there, the sequence simply ended.
  const sys = () => {
    const s = lcSystem('LC', { ident: 'LC', binStart: 1 });
    s.proShopImport = { ...newImportRule(), match: 'any_unique', flagGaps: true };
    return s;
  };
  const used = () => {
    const u = new Set();
    for (let i = 1; i <= 253; i++) if (i !== 40) u.add(i);  // one genuine hole
    u.add(1000);                                            // the outlier
    return u;
  };

  it('reports the far bin as an outlier, not as a wall of gaps', () => {
    const { gaps, outliers } = analyzeBinSequence(sys(), used());
    expect(outliers).toEqual([1000]);
    expect(gaps).toEqual([{ from: 40, to: 40, count: 1 }]);
  });

  it('the flat gap list stays small too', () => {
    expect(findBinGaps(sys(), used())).toEqual([40]);
  });

  it('groups consecutive holes into ONE run', () => {
    const u = new Set([1, 2, 10, 11, 12]);
    const { gaps } = analyzeBinSequence(sys(), u);
    expect(gaps).toEqual([{ from: 3, to: 9, count: 7 }]);
  });

  it('a dense sequence with no outlier behaves exactly as before', () => {
    const u = new Set([1, 2, 3, 5, 6]);
    const { gaps, outliers } = analyzeBinSequence(sys(), u);
    expect(outliers).toEqual([]);
    expect(gaps).toEqual([{ from: 4, to: 4, count: 1 }]);
  });

  it('the worklist counts facts, not empty numbers', () => {
    const s = sys();
    const tools = [];
    for (let i = 1; i <= 253; i++) if (i !== 40) tools.push({ id: 't' + i, tool_id: 'A-' + i, tool_location: { system_id: s.id, bin: i } });
    tools.push({ id: 'far', tool_id: 'D-235', tool_location: { system_id: s.id, bin: 1000 } });
    const issues = libraryLocationIssues(tools, [s]);
    expect(issues.filter(i => i.type === 'gap').length).toBe(1);
    const out = issues.filter(i => i.type === 'outlier');
    expect(out.length).toBe(1);
    expect(out[0].bin).toBe(1000);
    expect(out[0].tools[0].tool_id).toBe('D-235');   // names the tool to go fix
  });
});

describe('components occupy bins exactly like tools', () => {
  // A holder body / insert is a real object in a real drawer. It only lives in
  // a different FILE (tool_components.json, so it can never reach Fusion) —
  // never a different kind of thing for locations. Counting only tools reported
  // every component's bin as a skipped number, and hid tool↔component clashes.
  const sys = () => {
    const s = lcSystem('LC', { ident: 'LC', binStart: 1 });
    s.proShopImport = { ...newImportRule(), match: 'any_unique', flagGaps: true };
    return s;
  };
  const rec = (id, sysId, bin) => ({ id, tool_id: id, tool_location: { system_id: sysId, bin } });

  it('a component bin is NOT reported as a skipped number', () => {
    const s = sys();
    const tools = [rec('A-1', s.id, 1), rec('A-3', s.id, 3)];
    const comps = [rec('G-223', s.id, 2)];
    expect(libraryLocationIssues(tools, [s]).filter(i => i.type === 'gap').length).toBe(1);
    expect(libraryLocationIssues([...tools, ...comps], [s]).filter(i => i.type === 'gap')).toEqual([]);
  });

  it('a tool and a component on the same bin is a duplicate', () => {
    const s = sys();
    const issues = libraryLocationIssues([rec('A-1', s.id, 5), rec('G-223', s.id, 5)], [s]);
    const dup = issues.find(i => i.type === 'duplicate');
    expect(dup.bin).toBe(5);
    expect(dup.tools.map(t => t.tool_id).sort()).toEqual(['A-1', 'G-223']);
  });

  it('a component counts toward the next free bin', () => {
    const s = sys();
    expect(nextBin(s, usedBinsForSystem([rec('A-1', s.id, 1), rec('G-223', s.id, 2)], s.id))).toBe(3);
  });
});

describe('analyzeSystem sees components too', () => {
  it('a component bin counts toward the next free bin in the normalize preview', () => {
    const s = lcSystem('LC', { ident: 'LC', binStart: 1 });
    const tools = [{ id: 't1', location: 'LC-1' }, { id: 't2', location: 'LC-2' }];
    const comps = [{ id: 'c1', tool_location: { system_id: s.id, bin: 3 } }];
    // Tools alone: bin 3 looks free and the component would be double-booked.
    expect(analyzeSystem(tools, s).nextBin).toBe(3);
    expect(analyzeSystem([...tools, ...comps], s).nextBin).toBe(4);
  });

  it('a component with free-text location is matched for normalization', () => {
    const s = lcSystem('LC', { ident: 'LC', binStart: 1 });
    const matched = analyzeSystem([{ id: 'c1', location: 'LC-212' }], s).matched;
    expect(matched.length).toBe(1);
    expect(matched[0].location.bin).toBe(212);
  });
});

describe('nextBin ignores out-of-range outliers', () => {
  // Straight from a real run: the LC cabinet ends at 253, one tool sits on the
  // drill-index sentinel 10000, and "Next available bin" read 10001 — so every
  // new tool would have been filed above the sentinel.
  it('continues above the highest IN-RANGE bin, not the outlier', () => {
    const s = lcSystem('LC', { ident: 'LC', binStart: 1 });
    const used = new Set();
    for (let i = 1; i <= 253; i++) used.add(i);
    used.add(10000);
    expect(nextBin(s, used)).toBe(254);
  });

  it('a bin just past the end is still the next bin, not an outlier', () => {
    const s = lcSystem('LC', { ident: 'LC', binStart: 1 });
    expect(nextBin(s, new Set([1, 2, 3]))).toBe(4);
  });

  it('still skips a reserved number at the top of the in-range run', () => {
    const s = lcSystem('LC', { ident: 'LC', binStart: 1 });
    s.levels.bin.skip = [4];
    expect(nextBin(s, new Set([1, 2, 3, 9999]))).toBe(5);
  });
});

describe('normalize must not steal records from another system', () => {
  // Straight from the real library: 236 tools in an "LC" cabinet whose custom
  // prefix is OPTIONAL when parsing, and 19 in a fixed-bin drill index that
  // composes its location as the bare "10000". LC's lenient pattern parsed that
  // as LC bin 10000, so Analyze offered to move all 19 out of the system they
  // correctly belong to — and its "next available bin" read 10001.
  const shop = () => {
    const [lc, di] = twoSystemShop();
    di.levels.bin = { fixed: true, start: 1000, fixedVal: '10000', skip: [] };
    di.levels.drawer = { on: false, levelType: 'Drawer', customTypeName: '', identFormat: 'letter', customIdent: '', options: [] };
    return [lc, di];
  };
  it('leaves records that already belong to another system alone', () => {
    const [lc, di] = shop();
    const records = [
      { id: 'a1', tool_location: { system_id: lc.id, bin: 1 }, location: 'LC-1' },
      // 19 drill-index records, composed as the bare sentinel
      ...Array.from({ length: 19 }, (_, i) => ({
        id: 'd' + i, tool_location: { system_id: di.id, bin: '10000' }, location: '10000',
      })),
    ];
    const a = analyzeSystem(records, lc, [lc, di]);
    expect(a.matched).toEqual([]);              // was 19 — every drill tool
    expect(a.nextBin).toBe(2);                  // was 10001
  });

  it('an UNASSIGNED bare sentinel goes to the system whose rule claims it', () => {
    const [lc, di] = shop();
    const records = [
      { id: 'a1', tool_location: { system_id: lc.id, bin: 1 }, location: 'LC-1' },
      { id: 'new', location: '10000' },         // no structured location yet
      { id: 'new2', location: '42' },
    ];
    // LC's any_unique rule must not swallow the sentinel — DI's trigger owns it.
    expect(analyzeSystem(records, lc, [lc, di]).matched.map(m => m.tool.id)).toEqual(['new2']);
    expect(analyzeSystem(records, di, [lc, di]).matched.map(m => m.tool.id)).toEqual(['new']);
  });

  it('with no rules configured it still assigns unassigned records', () => {
    const lc = lcSystem('LC', { ident: 'LC', binStart: 1 });
    const records = [{ id: 'x', location: 'LC-7' }, { id: 'y', location: '8' }];
    expect(analyzeSystem(records, lc, [lc]).matched.length).toBe(2);
  });
});

describe('one canonical shape for a stored bin', () => {
  it('numbers stay numbers; a non-numeric fixed label stays a string', () => {
    expect(normalizeBin(140)).toBe(140);
    expect(normalizeBin('140')).toBe(140);
    expect(normalizeBin(' 10000 ')).toBe(10000);
    expect(normalizeBin('SHELF')).toBe('SHELF');
    expect(normalizeBin('')).toBe(null);
    expect(normalizeBin(null)).toBe(null);
  });

  it('a fixed-bin system writes the SAME shape from import and from normalize', () => {
    // These disagreed: the import wrote the config string "10000", the picker
    // wrote the string too, and normalize wrote null (the parser never captures
    // a fixed bin) — the same drawer in three shapes.
    const [lc, di] = twoSystemShop();
    di.levels.bin = { fixed: true, start: 1000, fixedVal: '10000', skip: [] };
    di.levels.drawer = { on: false, levelType: 'Drawer', customTypeName: '', identFormat: 'letter', customIdent: '', options: [] };

    const fromImport = routeProShopLocations(rows([['D-1', '10000']]), [lc, di]).assignments[0].location;
    const fromNormalize = parseLocationString('10000', di);
    expect(fromImport.bin).toBe(10000);
    expect(fromNormalize.bin).toBe(10000);
    expect(fromImport.bin).toBe(fromNormalize.bin);
  });

  it('the composed string is unchanged either way', () => {
    const [, di] = twoSystemShop();
    di.levels.bin = { fixed: true, start: 1000, fixedVal: '10000', skip: [] };
    di.levels.drawer = { on: false, levelType: 'Drawer', customTypeName: '', identFormat: 'letter', customIdent: '', options: [] };
    expect(composeLocationString({ system_id: di.id, bin: 10000 }, di)).toBe('10000');
    expect(composeLocationString({ system_id: di.id, bin: '10000' }, di)).toBe('10000');
  });
});

describe('an insert pairing has no location of its own', () => {
  // Real library: 8 of the 21 "unassigned" tools were face mills / turning tools
  // whose two halves ARE located (LC-212, LC-213, …). The pairing itself is not
  // a thing in a drawer, so demanding a location for it is a row that can never
  // be cleared — and it made every count on the screen look wrong.
  const sys = () => lcSystem('LC', { ident: 'LC', binStart: 1 });
  const paired = { id: 'p1', tool_id: 'I-224/ G-223', pairing: { family: 'milling_insert', holder_component_id: 'c1', insert_component_id: 'c2' } };
  const plain = { id: 't1', tool_id: 'A-9' };

  it('is not counted as unassigned', () => {
    const s = sys();
    s.normalized = true;
    const st = libraryLocationStatus([paired, plain], [s]);
    expect(st.total).toBe(1);          // the pairing isn't in the population at all
    expect(st.unassigned).toBe(1);     // only the real tool
    expect(st.unassignedTools.map(t => t.id)).toEqual(['t1']);
  });

  it('is not offered for normalization', () => {
    const withText = { ...paired, location: 'LC-77' };
    const a = analyzeSystem([withText], sys(), [sys()]);
    expect(a.matched).toEqual([]);
    expect(a.noLocation).toBe(0);
  });

  it('a pairing with NO components linked still counts — nothing holds its location', () => {
    const orphan = { id: 'p2', tool_id: 'A-1/B-2', pairing: { family: 'generic_insert', holder_component_id: null, insert_component_id: null } };
    const s = sys(); s.normalized = true;
    expect(libraryLocationStatus([orphan], [s]).unassigned).toBe(1);
  });
});

describe('the status panel reflects reality, not whether normalize was run', () => {
  // `normalized` marks the one-time migration. A shop whose locations all
  // arrived via the ProShop import never sets it — and gating on it hid the one
  // panel that says how many records are placed, so a library with 235 tools
  // correctly filed looked completely unconnected.
  it('reports placed records even when no system is marked normalized', () => {
    const s = lcSystem('LC', { ident: 'LC', binStart: 1 });
    expect(s.normalized).toBe(false);
    const st = libraryLocationStatus(
      [{ id: 'a', tool_location: { system_id: s.id, bin: 1 } }, { id: 'b' }],
      [s],
    );
    expect(st).not.toBe(null);
    expect(st.assigned).toBe(1);
    expect(st.unassigned).toBe(1);
    expect(st.total).toBe(2);       // assigned + unassigned always add up
  });

  it('still returns null for a shop with nothing placed and nothing normalized', () => {
    const s = lcSystem('LC', { ident: 'LC', binStart: 1 });
    expect(libraryLocationStatus([{ id: 'a' }], [s])).toBe(null);
  });
});
