import { describe, it, expect } from 'vitest';
import { generateMachineNumbers, getNextMachineNumber } from './toolSchema.js';

describe('generateMachineNumbers', () => {
  it('defaults: starts at 30, skips 98/99/100', () => {
    // 30..97 = 68 numbers, then 98/99/100 skipped, then 101 = the 69th.
    const seq = generateMachineNumbers(69);
    expect(seq[0]).toBe(30);
    expect(seq).not.toContain(98);
    expect(seq).not.toContain(99);
    expect(seq).not.toContain(100);
    expect(seq[seq.length - 1]).toBe(101);
    expect(seq).toHaveLength(69);
  });

  it('honors a custom start and skip list (from shop_settings)', () => {
    const seq = generateMachineNumbers(5, 1, [3]);
    expect(seq).toEqual([1, 2, 4, 5, 6]);
  });
});

describe('getNextMachineNumber', () => {
  it('skips used and reserved numbers (defaults)', () => {
    expect(getNextMachineNumber([30, 31, 32])).toBe(33);
    expect(getNextMachineNumber([])).toBe(30);
  });

  it('honors a custom start and skip list', () => {
    expect(getNextMachineNumber([1, 2], 1, [3])).toBe(4); // 3 reserved → 4
  });
});
