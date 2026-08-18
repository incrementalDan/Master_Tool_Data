import { describe, it, expect } from 'vitest';
import {
  ID_SYSTEMS, ID_SYSTEM_KEYS, idSystemLabel, emptyExclusions,
  isExcludedFrom, excludedTools, setToolExclusion, MACHINE_NUMBER_LOCKED_TYPES,
} from './idSystems.js';

describe('idSystems helpers', () => {
  it('exposes the three systems', () => {
    expect(ID_SYSTEM_KEYS).toEqual(['tool_id', 'machine_number', 'location']);
    expect(idSystemLabel('machine_number')).toBe('Machine Number');
    expect(emptyExclusions()).toEqual({ tool_id: false, machine_number: false, location: false });
  });

  it('defaults to member (not excluded) when no flag is set', () => {
    expect(isExcludedFrom({}, 'tool_id')).toBe(false);
    expect(isExcludedFrom(null, 'location')).toBe(false);
  });

  it('reports an explicit per-system exclusion', () => {
    const tool = { id_system_exclusions: { tool_id: true, machine_number: false, location: true } };
    expect(isExcludedFrom(tool, 'tool_id')).toBe(true);
    expect(isExcludedFrom(tool, 'machine_number')).toBe(false);
    expect(isExcludedFrom(tool, 'location')).toBe(true);
  });

  it('lists excluded tools per system', () => {
    const tools = [
      { id: 'a' },
      { id: 'b', id_system_exclusions: { machine_number: true } },
      { id: 'c', id_system_exclusions: { tool_id: true } },
    ];
    expect(excludedTools(tools, 'machine_number').map(t => t.id)).toEqual(['b']);
    expect(excludedTools(tools, 'tool_id').map(t => t.id)).toEqual(['c']);
    expect(excludedTools(tools, 'location')).toEqual([]);
  });

  it('flips one system while preserving the others', () => {
    const tool = { id_system_exclusions: { tool_id: true, machine_number: false, location: false } };
    expect(setToolExclusion(tool, 'location', true)).toEqual({ tool_id: true, machine_number: false, location: true });
    expect(setToolExclusion(tool, 'tool_id', false)).toEqual({ tool_id: false, machine_number: false, location: false });
    expect(setToolExclusion({}, 'machine_number', true)).toEqual({ tool_id: false, machine_number: true, location: false });
  });
});

// A probe's machine tool number is LOCKED (T99) — renumber / fix-duplicates /
// import-assign must all leave it alone. The lock is by TYPE, so it holds even
// with no explicit exclusion flag; it applies ONLY to the machine-number system
// (a probe still has a real Tool ID and location).
describe('machine-number lock by type (probe)', () => {
  it('auto-excludes a probe from the machine-number system with no flag set', () => {
    const probe = { tool_type: 'probe' };
    expect(isExcludedFrom(probe, 'machine_number')).toBe(true);
    // But NOT from Tool ID or Location — a probe has both.
    expect(isExcludedFrom(probe, 'tool_id')).toBe(false);
    expect(isExcludedFrom(probe, 'location')).toBe(false);
  });

  it('does not auto-exclude any non-locked type from the machine-number system', () => {
    expect(isExcludedFrom({ tool_type: 'flat end mill' }, 'machine_number')).toBe(false);
    expect(isExcludedFrom({ tool_type: 'drill' }, 'machine_number')).toBe(false);
  });

  it('the explicit flag still works and is independent of the type lock', () => {
    // An explicitly-excluded mill is excluded; a probe stays excluded even if a
    // flag says otherwise (the type lock wins).
    expect(isExcludedFrom({ tool_type: 'flat end mill', id_system_exclusions: { machine_number: true } }, 'machine_number')).toBe(true);
    expect(isExcludedFrom({ tool_type: 'probe', id_system_exclusions: { machine_number: false } }, 'machine_number')).toBe(true);
  });

  it('a probe shows up in excludedTools for machine_number', () => {
    const tools = [{ id: 'm', tool_type: 'flat end mill' }, { id: 'p', tool_type: 'probe' }];
    expect(excludedTools(tools, 'machine_number').map(t => t.id)).toEqual(['p']);
    expect(excludedTools(tools, 'tool_id')).toEqual([]);
  });

  it('probe is in the locked-types set', () => {
    expect(MACHINE_NUMBER_LOCKED_TYPES.has('probe')).toBe(true);
  });
});
