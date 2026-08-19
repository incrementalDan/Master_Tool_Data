import { describe, it, expect } from 'vitest';
import { opColor, opKey, OP_PALETTE, fixedOpColors } from './opColors.js';

describe('opKey', () => {
  it('strips the OP prefix however it was typed', () => {
    for (const v of ['OP50', 'op50', 'OP 50', '50', ' op50 ']) expect(opKey(v)).toBe('50');
  });

  it('keeps a suffix — OP50R is its own step, not OP50', () => {
    expect(opKey('OP50R')).toBe('50R');
    expect(opKey('OP160rb')).toBe('160RB');
  });

  it('is empty for a step with no number', () => {
    expect(opKey('')).toBe('');
    expect(opKey(null)).toBe('');
  });
});

describe('the ops the shop actually runs have fixed colours', () => {
  it('gives each of them the same colour every time', () => {
    const fixed = fixedOpColors();
    for (const n of [49, 50, 60, 70, 80]) {
      expect(opColor(`OP${n}`)).toBe(fixed[n]);
      expect(opColor(n)).toBe(fixed[n]);       // a raw number reads the same
    }
  });

  it('⚠️ gives them DISTINCT hues, not shades of one another', () => {
    // Two greens a step apart read as the same thing at this size, which is the
    // confusion the colours exist to prevent.
    const used = Object.values(fixedOpColors());
    expect(new Set(used).size).toBe(used.length);
  });

  it('matches the reference the shop drew for 50 and 60', () => {
    expect(opColor('OP50')).toBe('#3b82f6');   // blue
    expect(opColor('OP60')).toBe('#3fa84f');   // green
  });
});

describe('everything else indexes into the palette', () => {
  it('is deterministic — the same op is the same colour everywhere', () => {
    // The whole cue depends on this: derived per screen, an op would change
    // colour from the parts list to the part page and mean nothing.
    expect(opColor('OP55')).toBe(opColor('op 55'));
    expect(opColor('OP160RB')).toBe(opColor('160rb'));
  });

  it('never reuses a fixed op colour, so an unusual op never impersonates a common one', () => {
    const fixed = new Set(Object.values(fixedOpColors()));
    for (const n of [10, 20, 30, 40, 55, 65, 75, 85, 90, 100, 110, 200]) {
      expect(fixed.has(opColor(`OP${n}`))).toBe(false);
    }
  });

  it('⚠️ keeps a run of ordinary ops apart — ops are numbered in TENS', () => {
    // Indexing on the raw number collapses them: OP10 and OP90 came out
    // identical, which is the one thing this must never do. The realistic worst
    // case is a part carrying more steps than the fixed set covers.
    const colors = [10, 20, 30, 40, 90, 100, 110, 120].map(n => opColor(`OP${n}`));
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('separates two ops inside one decade', () => {
    // A non-round number keeps its full value, so these do not merge.
    expect(opColor('OP55')).not.toBe(opColor('OP59'));
  });

  it('gives a suffixed variant its own colour rather than its parent op\'s', () => {
    expect(opColor('OP50R')).not.toBe(opColor('OP50'));
  });

  it('colours a free-text step stably instead of dropping it', () => {
    expect(opColor('Soft Jaw')).toBe(opColor('soft jaw'));
    expect(OP_PALETTE).toContain(opColor('Soft Jaw'));
  });

  it('has no colour at all for a step with no op number', () => {
    // A default colour would read as a real assignment.
    expect(opColor('')).toBe(null);
    expect(opColor(undefined)).toBe(null);
  });
});

describe('the palette itself', () => {
  it('has no duplicates and no overlap with the fixed set', () => {
    expect(new Set(OP_PALETTE).size).toBe(OP_PALETTE.length);
    const fixed = new Set(Object.values(fixedOpColors()));
    expect(OP_PALETTE.some(c => fixed.has(c))).toBe(false);
  });

  it('covers a shop running well past what it ever would', () => {
    expect(OP_PALETTE.length + Object.keys(fixedOpColors()).length).toBeGreaterThanOrEqual(13);
  });
});
