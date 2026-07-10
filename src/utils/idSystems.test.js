import { describe, it, expect } from 'vitest';
import {
  ID_SYSTEMS, ID_SYSTEM_KEYS, idSystemLabel, emptyExclusions,
  isExcludedFrom, excludedTools, setToolExclusion,
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
