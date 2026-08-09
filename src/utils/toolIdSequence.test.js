import { describe, it, expect } from 'vitest';
import { toolIdSequence } from './toolIdSystem.js';

// The library's default sort puts the most recently added tool first. The Tool
// ID's number is what makes that work inside a bulk import, where hundreds of
// tools share one created_at — so this has to survive the messy real ids.

describe('toolIdSequence', () => {
  it('reads the shop-wide counter out of a normal id', () => {
    expect(toolIdSequence('A-270')).toBe(270);
    expect(toolIdSequence('D-46')).toBe(46);
    expect(toolIdSequence('TF-194')).toBe(194);
  });

  it('orders by the NUMBER, not the letter — the prefix is the tool group', () => {
    // Real newest-first run from the shop's library: the groups are unrelated,
    // the number is the sequence.
    const ids = ['A-265', 'R-266', 'L-267', 'J-268', 'D-269', 'A-270'];
    const newestFirst = [...ids].sort((a, b) => toolIdSequence(b) - toolIdSequence(a));
    expect(newestFirst).toEqual(['A-270', 'D-269', 'J-268', 'L-267', 'R-266', 'A-265']);
  });

  it('is numeric, not lexical — "A-9" must not beat "A-100"', () => {
    expect(toolIdSequence('A-100')).toBeGreaterThan(toolIdSequence('A-9'));
  });

  it('takes the holder component of a combined insert-tool id', () => {
    expect(toolIdSequence('I-167/ G-168')).toBe(167);
    expect(toolIdSequence('TF-194/ TO-195')).toBe(194);
  });

  it('ignores a parenthetical suffix rather than swallowing it', () => {
    // "R-70 (CG)" is a real id; "TC52 (142174)" carries a vendor number that
    // would otherwise dwarf every real sequence number.
    expect(toolIdSequence('R-70 (CG)')).toBe(70);
    expect(toolIdSequence('TC52 (142174); TC62 (142892)')).toBe(52);
  });

  it('sorts an unnumbered or missing id LAST, never first', () => {
    expect(toolIdSequence('')).toBe(-1);
    expect(toolIdSequence(null)).toBe(-1);
    expect(toolIdSequence(undefined)).toBe(-1);
    expect(toolIdSequence('min OOH 2.33')).toBeGreaterThan(-1);   // has a number, still parses
    expect(toolIdSequence('no digits here')).toBe(-1);
  });

  it('tolerates whitespace and a bare number', () => {
    expect(toolIdSequence('D-148 ')).toBe(148);
    expect(toolIdSequence('1042')).toBe(1042);
  });
});
