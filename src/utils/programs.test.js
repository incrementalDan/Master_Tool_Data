import { describe, it, expect } from 'vitest';
import {
  nextProgramNumber, newPart, newProgram, programMaterial, alloyLabel,
  customerColor, machineOptions, isPalletMachine, PROGRAM_NUMBER_START,
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
