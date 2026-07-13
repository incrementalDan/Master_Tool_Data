import { describe, it, expect } from 'vitest';
import { mergePresetLists, presetValuesEquivalent } from './presetMerge.js';

const p = (over = {}) => ({
  guid: over.guid || 'g',
  name: 'Rough',
  n: 8000, v_c: 300, v_f: 40, f_z: 0.001,
  v_f_plunge: 10, 'tool-coolant': 'flood',
  'use-stepdown': true, stepdown: 0.05,
  'use-stepover': true, stepover: 0.02,
  ...over,
});

describe('presetValuesEquivalent', () => {
  it('true within the significance tolerance (10 RPM is noise on 8000)', () => {
    expect(presetValuesEquivalent(p({ n: 8000 }), p({ n: 8010 }))).toBe(true);
  });
  it('false beyond the tolerance (200 RPM on 8000 is real)', () => {
    expect(presetValuesEquivalent(p({ n: 8000 }), p({ n: 8200 }))).toBe(false);
  });
});

describe('mergePresetLists', () => {
  it('collapses an identical preset (well-formed instances → no-op union)', () => {
    const base = [p({ guid: 'a', name: 'Rough' })];
    const inc = [p({ guid: 'b', name: 'Rough' })];   // same values, copied guid
    const out = mergePresetLists(base, inc, 'inches');
    expect(out).toHaveLength(1);
    expect(out[0].guid).toBe('a');
  });

  it('collapses a same-name preset whose values differ only within tolerance', () => {
    const base = [p({ guid: 'a', name: 'Rough', n: 8000 })];
    const inc = [p({ guid: 'b', name: 'Rough', n: 8010 })];
    expect(mergePresetLists(base, inc, 'inches')).toHaveLength(1);
  });

  it('keeps a same-name preset whose values genuinely differ, indexing the name up', () => {
    const base = [p({ guid: 'a', name: 'Rough', n: 8000 })];
    const inc = [p({ guid: 'b', name: 'Rough', n: 9000 })];
    const out = mergePresetLists(base, inc, 'inches');
    expect(out).toHaveLength(2);
    expect(out.map(x => x.name)).toEqual(['Rough', 'Rough 2']);
  });

  it('numbers a third same-name variant up to 3', () => {
    let out = [p({ guid: 'a', name: 'Rough', n: 8000 })];
    out = mergePresetLists(out, [p({ guid: 'b', name: 'Rough', n: 9000 })], 'inches');
    out = mergePresetLists(out, [p({ guid: 'c', name: 'Rough', n: 10000 })], 'inches');
    expect(out.map(x => x.name)).toEqual(['Rough', 'Rough 2', 'Rough 3']);
  });

  it('keeps differently-named presets as-is', () => {
    const out = mergePresetLists(
      [p({ guid: 'a', name: 'Rough' })],
      [p({ guid: 'b', name: 'Finish' })],
      'inches',
    );
    expect(out.map(x => x.name).sort()).toEqual(['Finish', 'Rough']);
  });

  it('mints a fresh guid for a kept variant whose guid collides with an existing one', () => {
    // A Fusion copy keeps the source guid; a kept variant must not duplicate it.
    const base = [p({ guid: 'dup', name: 'Rough', n: 8000 })];
    const inc = [p({ guid: 'dup', name: 'Rough', n: 9000 })];
    const out = mergePresetLists(base, inc, 'inches');
    expect(out).toHaveLength(2);
    expect(out[1].guid).not.toBe('dup');
    expect(new Set(out.map(x => x.guid)).size).toBe(2);
  });
});
