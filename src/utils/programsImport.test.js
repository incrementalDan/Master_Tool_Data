import { describe, it, expect } from 'vitest';
import { parseProgramsCsv, buildProgramsImport } from './programsImport.js';

const HEADER = 'Program #,Machine,Fixturing,Internal or external,internal Part #,Rev,Customer,Description,OP #,Fixture Y/N';

const csv = [
  HEADER,
  '1108,Brother M300X3,125mm Lang Vise Forward,External,CAD1-114P4344-1,A,Cadrex,Full part - tabbed,OP50,N',
  '1109,Brother M300X3,77mm Lang Vise,External,CAD1-114P4344-1,A,Cadrex,,OP60,N',
  '1115,Brother M300X3,77mm Lang Vise,Internal,GSE1-08D1404,A,GS Enterprises,Soft jaw stock,Soft Jaw,Y',
].join('\n');

describe('parseProgramsCsv', () => {
  it('maps aliased headers to canonical fields and reads rows', () => {
    const { rows, missingColumns } = parseProgramsCsv(csv);
    expect(missingColumns).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      program_number: '1108', machine: 'Brother M300X3', part_number: 'CAD1-114P4344-1',
      rev: 'A', customer: 'Cadrex', operation: 'OP50', is_fixture: 'N',
    });
  });

  it('handles quoted fields with commas and a BOM', () => {
    const t = '﻿Program #,internal Part #,Rev,Description,OP #\n1200,PN-1,A,"Face, then bore",OP10';
    const { rows, missingColumns } = parseProgramsCsv(t);
    expect(missingColumns).toEqual([]);
    expect(rows[0].description).toBe('Face, then bore');
    expect(rows[0].program_number).toBe('1200');
  });

  it('flags a missing Part # column', () => {
    const { missingColumns } = parseProgramsCsv('Program #,Machine\n1,Brother M300X3');
    expect(missingColumns).toContain('part_number');
  });
});

describe('buildProgramsImport', () => {
  const shopSettings = { machines: [{ id: 'm-1', model: 'Brother M300X3' }] };

  it('groups rows into parts and maps every field', () => {
    const { parts, programs, summary } = buildProgramsImport(csv, { jobsFile: { version: 2, jobs: [], parts: [], programs: [] }, shopSettings });
    expect(summary.partsNew).toBe(2);         // one part shared by OP50 + OP60, one for the fixture row
    expect(summary.programsNew).toBe(3);
    expect(parts.map(p => p.part_number).sort()).toEqual(['CAD1-114P4344-1', 'GSE1-08D1404']);

    const op50 = programs.find(p => p.program_number === 1108);
    expect(op50.machine_id).toBe('m-1');       // matched to configured machine
    expect(op50.machine_label).toBe('Brother M300X3');
    expect(op50.is_fixture).toBe(false);
    expect(op50.internal_external).toBe('External');

    const fix = programs.find(p => p.program_number === 1115);
    expect(fix.is_fixture).toBe(true);
    expect(fix.internal_external).toBe('Internal');   // forced for fixtures
  });

  it('reuses an existing part and skips a duplicate program number', () => {
    const existing = {
      version: 2, jobs: [],
      parts: [{ id: 'pt-x', part_number: 'CAD1-114P4344-1', rev: 'A', customer: 'Cadrex', material_id: 'N_6061', material_custom: '' }],
      programs: [{ id: 'pr-x', program_number: 1108, part_id: 'pt-x', is_fixture: false }],
    };
    const { summary, programs, parts } = buildProgramsImport(csv, { jobsFile: existing, shopSettings });
    expect(summary.duplicates.map(d => d.program_number)).toContain(1108);   // 1108 already exists
    expect(summary.programsNew).toBe(2);          // 1109 + 1115
    expect(parts.find(p => p.part_number === 'CAD1-114P4344-1')).toBeUndefined();  // reused, not re-created
    expect(summary.partsReused).toBeGreaterThan(0);
    // reused part id flows onto the new 1109 program
    expect(programs.find(p => p.program_number === 1109).part_id).toBe('pt-x');
  });

  it('auto-assigns a blank Program # from the running max', () => {
    const t = `${HEADER}\n,Brother M300X3,,Internal,PN-NEW,B,ACME,New one,OP10,N`;
    const jobsFile = { version: 2, jobs: [], parts: [], programs: [{ id: 'p', program_number: 2000, part_id: 'x' }] };
    const { summary, programs } = buildProgramsImport(t, { jobsFile, shopSettings });
    expect(summary.autoAssigned).toEqual([2001]);
    expect(programs[0].program_number).toBe(2001);
  });

  it('reports a non-integer Program # as an error, keeps the rest', () => {
    const t = `${HEADER}\n11AB,Brother M300X3,,External,PN-1,A,ACME,,OP10,N\n1300,Brother M300X3,,External,PN-1,A,ACME,,OP20,N`;
    const { summary } = buildProgramsImport(t, { jobsFile: { version: 2, jobs: [], parts: [], programs: [] }, shopSettings });
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0].message).toMatch(/not a whole number/);
    expect(summary.programsNew).toBe(1);
  });

  it('falls back to the raw machine label when unmatched', () => {
    const t = `${HEADER}\n1400,Haas VF2,,External,PN-1,A,ACME,,OP10,N`;
    const { programs } = buildProgramsImport(t, { jobsFile: { version: 2, jobs: [], parts: [], programs: [] }, shopSettings });
    expect(programs[0].machine_id).toBeNull();
    expect(programs[0].machine_label).toBe('Haas VF2');
  });
});
