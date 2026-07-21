import { describe, it, expect } from 'vitest';
import {
  newLocationSystem, newLevelOption,
  systemOutputSignature, systemStructureSignature, findSystemConflicts,
  parseLocationString, analyzeSystem, nextBin,
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
