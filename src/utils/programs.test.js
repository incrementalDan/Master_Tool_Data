import { describe, it, expect } from 'vitest';
import {
  nextProgramNumber, newPart, newProgram, programMaterial, alloyLabel,
  customerColor, machineOptions, isPalletMachine, PROGRAM_NUMBER_START,
  searchPrograms, formatProgramNumber, formatOperation,
} from './programs.js';

const file = {
  version: 2,
  jobs: [],
  parts: [
    { id: 'pt1', part_number: 'CAD1-114P4344-1', customer: 'Cadrex', rev: 'A', material_id: 'N_6061', material_custom: '' },
  ],
  programs: [
    { id: 'prg1', program_number: 1108, part_id: 'pt1', operation: 'OP50', is_fixture: false, material_id: null, material_custom: '' },
    { id: 'prg2', program_number: 1110, part_id: 'pt1', operation: 'OP60', is_fixture: true, material_id: null, material_custom: 'Scrap 6061 plate' },
  ],
};

const materials = { materials: [{ id: 'N_6061', label: '6061', group_id: 'N' }] };

describe('program number assignment', () => {
  it('computes next as max + 1 (gaps fine, no stored counter)', () => {
    expect(nextProgramNumber(file)).toBe(1111);
  });
  it('starts at PROGRAM_NUMBER_START when empty', () => {
    expect(nextProgramNumber({ programs: [] })).toBe(PROGRAM_NUMBER_START);
    expect(nextProgramNumber({})).toBe(PROGRAM_NUMBER_START);
  });

  it('deleting a program only changes "next" when the deleted one was the highest', () => {
    // file has 1108 (prg1) and 1110 (prg2, the max) -> next is 1111.
    // Deleting the non-max entry (1108) must leave "next" untouched.
    const afterDeletingNonMax = { ...file, programs: file.programs.filter(p => p.id !== 'prg1') };
    expect(nextProgramNumber(afterDeletingNonMax)).toBe(nextProgramNumber(file));
    // Deleting the max entry (1110) must recompute "next" down.
    const afterDeletingMax = { ...file, programs: file.programs.filter(p => p.id !== 'prg2') };
    expect(nextProgramNumber(afterDeletingMax)).toBe(1109);
    expect(nextProgramNumber(afterDeletingMax)).not.toBe(nextProgramNumber(file));
  });
});

describe('material rules (specific alloy, derive for non-fixture)', () => {
  it('non-fixture programs derive material from the part', () => {
    const part = file.parts[0];
    expect(programMaterial(file.programs[0], part)).toEqual({ material_id: 'N_6061', material_custom: '' });
  });
  it('fixture programs carry their own material', () => {
    expect(programMaterial(file.programs[1], file.parts[0]))
      .toEqual({ material_id: null, material_custom: 'Scrap 6061 plate' });
  });
  it('newProgram strips material from non-fixture ops and forces Internal for fixtures', () => {
    const p = newProgram({
      program_number: 1111, part_id: 'pt1', operation: 'OP70',
      machine_label: 'Brother M300X3', is_fixture: false,
      internal_external: 'External', material_id: 'N_6061', pallet: '2',
    });
    expect(p.material_id).toBeNull();          // derived from part, never stored
    expect(p.pallet).toBe('');                 // not a pallet machine
    const fx = newProgram({
      program_number: 1112, part_id: 'pt1', operation: 'Soft Jaw',
      machine_label: 'Brother R650', is_fixture: true,
      internal_external: 'External', material_id: 'N_6061', pallet: '2',
    });
    expect(fx.internal_external).toBe('Internal');   // fixtures are always Internal
    expect(fx.material_id).toBe('N_6061');
    expect(fx.pallet).toBe('2');               // R650 keeps its pallet
  });
  it('alloyLabel resolves id → alloy label, custom text, and dangling ids', () => {
    expect(alloyLabel(materials, 'N_6061', '')).toBe('6061');
    expect(alloyLabel(materials, null, 'Inconel 718')).toBe('Inconel 718');
    expect(alloyLabel(materials, 'gone', '')).toBe('(unknown alloy)');
  });
});

describe('customers + machines', () => {
  it('customerColor is stable and case/space-insensitive', () => {
    expect(customerColor('Cadrex')).toBe(customerColor(' cadrex '));
    expect(customerColor('')).toBeNull();
  });
  it('machineOptions uses shop machines, falls back to hardcoded pair', () => {
    expect(machineOptions({ machines: [{ id: 'm1', model: 'Speedio M300X3' }] }))
      .toEqual([{ id: 'm1', label: 'Speedio M300X3' }]);
    const fb = machineOptions({ machines: [] });
    expect(fb.map(m => m.label)).toEqual(['Brother M300X3', 'Brother R650']);
    expect(fb[0].id).toBeNull();
  });
  it('isPalletMachine matches R650 anywhere in the model name', () => {
    expect(isPalletMachine('Brother R650')).toBe(true);
    expect(isPalletMachine('Speedio R650X1')).toBe(true);
    expect(isPalletMachine('Brother M300X3')).toBe(false);
  });
  it('newPart trims and defaults rev', () => {
    const pt = newPart({ part_number: ' P1 ', customer: ' ACME ', rev: '' });
    expect(pt.part_number).toBe('P1');
    expect(pt.customer).toBe('ACME');
    expect(pt.rev).toBe('A');
  });
});

describe('searchPrograms (Sync-Job picker)', () => {
  const jf = {
    parts: [
      { id: 'pt1', part_number: 'CAD1-114P4344-1', customer: 'Cadrex', rev: 'A' },
      { id: 'pt2', part_number: 'GSE1-08D1404', customer: 'GS', rev: 'A' },
    ],
    programs: [
      { id: 'g1', program_number: 1108, part_id: 'pt1', operation: 'OP50' },
      { id: 'g2', program_number: 1109, part_id: 'pt1', operation: 'OP60' },
      { id: 'g3', program_number: 1110, part_id: 'pt2', operation: 'OP10' },
    ],
  };

  it('matches a program number exactly (not as a substring)', () => {
    const r = searchPrograms(jf, '1108');
    expect(r).toHaveLength(1);
    expect(r[0].program.id).toBe('g1');
    // 110 must NOT match 1108/1109/1110 as a contains — program # is exact only
    expect(searchPrograms(jf, '110').filter(x => x.exactProgram)).toHaveLength(0);
  });

  it('matches part numbers loosely (contains) and returns all their programs', () => {
    const r = searchPrograms(jf, 'cad1');
    expect(r.map(x => x.program.program_number).sort()).toEqual([1108, 1109]);
    expect(r.every(x => x.part.id === 'pt1')).toBe(true);
  });

  it('ranks an exact program hit ahead of part matches, empty query → []', () => {
    // '1108' is exact for g1 AND part 'GSE1-08D1404' doesn't contain it; add a
    // part-number query that also numerically hits nothing to keep it simple.
    expect(searchPrograms(jf, '')).toEqual([]);
    const r = searchPrograms(jf, '1110');   // exact program g3
    expect(r[0].program.id).toBe('g3');
    expect(r[0].exactProgram).toBe(true);
  });

  it('tolerates the primary "O" reference form for an exact number search', () => {
    const r = searchPrograms(jf, 'O1108');
    expect(r).toHaveLength(1);
    expect(r[0].program.id).toBe('g1');
    expect(r[0].exactProgram).toBe(true);
    expect(searchPrograms(jf, 'o1110')[0].program.id).toBe('g3');
  });
});

describe('formatProgramNumber (primary "O" reference form)', () => {
  it('prefixes a plain number', () => {
    expect(formatProgramNumber(1108)).toBe('O1108');
    expect(formatProgramNumber('2352')).toBe('O2352');
  });
  it('is idempotent on an already-prefixed legacy value, normalizing case', () => {
    expect(formatProgramNumber('O1042')).toBe('O1042');
    expect(formatProgramNumber('o1042')).toBe('O1042');
  });
  it('returns empty string for nullish/blank input', () => {
    expect(formatProgramNumber(null)).toBe('');
    expect(formatProgramNumber(undefined)).toBe('');
    expect(formatProgramNumber('')).toBe('');
  });
});

describe('formatOperation ("OP" prefix)', () => {
  it('prefixes a plain numeric operation', () => {
    expect(formatOperation('50')).toBe('OP50');
    expect(formatOperation(60)).toBe('OP60');
  });
  it('is idempotent / normalizes case+spacing on an already-prefixed value', () => {
    expect(formatOperation('OP50')).toBe('OP50');
    expect(formatOperation('op 50')).toBe('OP50');
    expect(formatOperation('Op50')).toBe('OP50');
  });
  it('handles a numeric operation with letter suffix(es)', () => {
    expect(formatOperation('50A')).toBe('OP50A');
    expect(formatOperation('OP50A')).toBe('OP50A');
    expect(formatOperation('50R')).toBe('OP50R');
    expect(formatOperation('51M')).toBe('OP51M');
    expect(formatOperation('160RB')).toBe('OP160RB');
  });
  it('leaves non-numeric free text alone (nothing to prefix)', () => {
    expect(formatOperation('Soft Jaw')).toBe('Soft Jaw');
  });
  it('returns empty string for nullish/blank input', () => {
    expect(formatOperation(null)).toBe('');
    expect(formatOperation(undefined)).toBe('');
    expect(formatOperation('')).toBe('');
  });
});
