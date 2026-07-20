import { describe, it, expect } from 'vitest';
import { generateMachineNumbers, getNextMachineNumber, resolveMachineNumberCollision } from './toolSchema.js';

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

describe('resolveMachineNumberCollision — unique machine numbers on import', () => {
  it('keeps a number that is not already in use', () => {
    expect(resolveMachineNumberCollision(42, new Set([30, 31]))).toEqual({ number: 42, reassignedFrom: null });
  });

  it('reassigns to the next free number on a collision (and reports the original)', () => {
    // 42 is taken; the next available number (lowest free from start 30, given
    // 30/31/42 used) is 32.
    expect(resolveMachineNumberCollision(42, new Set([30, 31, 42]))).toEqual({ number: 32, reassignedFrom: 42 });
  });

  it('skips both used AND reserved numbers when reassigning', () => {
    // 97 taken → next is 98/99/100 (reserved) → 101.
    const used = new Set([97]);
    for (let n = 30; n < 97; n++) used.add(n);
    expect(resolveMachineNumberCollision(97, used)).toEqual({ number: 101, reassignedFrom: 97 });
  });

  it('leaves a null/blank number untouched (a tool need not have one)', () => {
    expect(resolveMachineNumberCollision(null, new Set([30]))).toEqual({ number: null, reassignedFrom: null });
    expect(resolveMachineNumberCollision('', new Set([30]))).toEqual({ number: null, reassignedFrom: null });
  });

  it('accepts an array for the used set and honors custom start/skip', () => {
    expect(resolveMachineNumberCollision(1, [1], 1, [3])).toEqual({ number: 2, reassignedFrom: 1 });
  });
});
