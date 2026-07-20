import { describe, it, expect } from 'vitest';
import { mergeToolConflicts, clearToolConflict, displayConflicts, conflictCount } from './toolConflicts.js';

describe('mergeToolConflicts', () => {
  it('adds a new field conflict with its two values', () => {
    const out = mergeToolConflicts([], { combineConflicts: [{ field: 'flute_length', values: [0.7, 0.75] }] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'field', field: 'flute_length', values: [0.7, 0.75] });
    expect(out[0].id).toBeTruthy();
  });

  it('does not re-add a field conflict already recorded (dedup by field)', () => {
    const existing = [{ id: 'x', type: 'field', field: 'flute_length', values: [0.7, 0.75] }];
    const out = mergeToolConflicts(existing, { combineConflicts: [{ field: 'flute_length', values: [0.7, 0.9] }] });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('x');   // original preserved, not replaced
  });

  it('adds a product-id conflict, singular per tool', () => {
    const out = mergeToolConflicts([], { productIdConflict: ['A-1', 'A-2'] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'product_id', values: ['A-1', 'A-2'] });
    const again = mergeToolConflicts(out, { productIdConflict: ['A-1', 'A-3'] });
    expect(again).toHaveLength(1);   // not re-added
  });

  it('keeps unrelated existing conflicts and appends a new different-field one', () => {
    const existing = [{ id: 'x', type: 'field', field: 'flute_length', values: [0.7, 0.75] }];
    const out = mergeToolConflicts(existing, { combineConflicts: [{ field: 'diameter', values: [0.5, 0.375] }] });
    expect(out.map(c => c.field).sort()).toEqual(['diameter', 'flute_length']);
  });

  it('adds a machine-number collision conflict, singular per tool', () => {
    const out = mergeToolConflicts([], { machineNumberConflict: { from: 42, to: 43 } });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'machine_number', from: 42, to: 43 });
    const again = mergeToolConflicts(out, { machineNumberConflict: { from: 42, to: 44 } });
    expect(again).toHaveLength(1);   // not re-added
  });

  it('ignores an incomplete machine-number conflict', () => {
    expect(mergeToolConflicts([], { machineNumberConflict: { from: 42 } })).toHaveLength(0);
    expect(mergeToolConflicts([], { machineNumberConflict: null })).toHaveLength(0);
  });
});

describe('clearToolConflict', () => {
  it('removes one conflict by id', () => {
    const list = [{ id: 'a' }, { id: 'b' }];
    expect(clearToolConflict(list, 'a')).toEqual([{ id: 'b' }]);
  });
});

describe('displayConflicts / conflictCount', () => {
  it('unions persisted + runtime-detected, deduped', () => {
    const tool = {
      conflicts: [{ id: 'p', type: 'field', field: 'diameter', values: [0.5, 0.375] }],
      _combineConflicts: [
        { field: 'diameter', values: [0.5, 0.9] },   // already persisted → not re-added
        { field: 'flute_length', values: [0.7, 0.75] }, // new → added
      ],
      _productIdConflict: ['A-1', 'A-2'],
    };
    const shown = displayConflicts(tool);
    expect(shown.filter(c => c.type === 'field').map(c => c.field).sort()).toEqual(['diameter', 'flute_length']);
    expect(shown.some(c => c.type === 'product_id')).toBe(true);
    expect(conflictCount(tool)).toBe(3);
  });

  it('is empty for a clean tool', () => {
    expect(conflictCount({})).toBe(0);
  });
});
