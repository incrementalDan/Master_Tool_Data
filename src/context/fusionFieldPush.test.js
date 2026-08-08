import { describe, it, expect } from 'vitest';
import { FUSION_FIELD_PATCHERS } from './libraryOps.js';

// The field-scoped Fusion push (pushFieldToFusion) patches ONE field in place
// rather than rebuilding the whole entry. What makes that safe is that each
// patcher owns the complete native+expression PAIR — Fusion re-derives the
// native value from its expression on load, so writing half a pair silently
// reverts on the next read.
const loc = FUSION_FIELD_PATCHERS.location;

// A realistic entry: everything here except vendor/tool_vendor must survive.
const entry = () => ({
  guid: 'g1',
  type: 'flat end mill',
  description: '1/2 4FL EM',
  vendor: 'LC-12',
  'product-id': 'A-3',
  geometry: { DC: 0.5, LCF: 1, OAL: 3, NOF: 4 },
  holder: { description: 'NBT30-SK13C-60', segments: [{ height: 10 }] },
  'start-values': { presets: [{ guid: 'p1', n: 8000, v_f: 50 }] },
  expressions: { tool_vendor: "'LC-12'", tool_diameter: '0.5 in', tool_description: "'1/2 4FL EM'" },
});

describe('the location patcher writes the native + expression pair', () => {
  it('moves both halves together', () => {
    const out = loc.apply(entry(), 'LC-140');
    expect(out.vendor).toBe('LC-140');
    expect(out.expressions.tool_vendor).toBe("'LC-140'");
  });

  it('DELETES the expression when the value is cleared — never writes \'\'', () => {
    const out = loc.apply(entry(), '');
    expect(out.vendor).toBe('');
    expect('tool_vendor' in out.expressions).toBe(false);
  });

  it('adds the expression when the entry had none', () => {
    const e = entry();
    delete e.expressions.tool_vendor;
    const out = loc.apply(e, 'LC-9');
    expect(out.expressions.tool_vendor).toBe("'LC-9'");
  });
});

describe('the patch disturbs nothing else in the entry', () => {
  it('leaves geometry, holder, presets and other expressions byte-for-byte', () => {
    const before = entry();
    const out = loc.apply(before, 'LC-140');
    expect(out.geometry).toEqual(before.geometry);
    expect(out.holder).toEqual(before.holder);
    expect(out['start-values']).toEqual(before['start-values']);
    expect(out['product-id']).toBe('A-3');
    expect(out.expressions.tool_diameter).toBe('0.5 in');
    expect(out.expressions.tool_description).toBe("'1/2 4FL EM'");
    // Exactly two keys differ from the original entry.
    const diff = Object.keys(out).filter(k => out[k] !== before[k]);
    expect(diff.sort()).toEqual(['expressions', 'vendor']);
  });

  it('does not mutate the entry it was given', () => {
    const before = entry();
    loc.apply(before, 'LC-999');
    expect(before.vendor).toBe('LC-12');
    expect(before.expressions.tool_vendor).toBe("'LC-12'");
  });
});

describe('read() decides what counts as already-in-sync', () => {
  it('prefers the expression, since Fusion re-derives the native from it', () => {
    const e = entry();
    e.vendor = 'STALE';                  // native disagrees with the expression
    expect(loc.read(e)).toBe('LC-12');   // the expression is what Fusion will use
  });

  it('falls back to the native value when there is no expression', () => {
    const e = entry();
    delete e.expressions.tool_vendor;
    expect(loc.read(e)).toBe('LC-12');
  });

  it('treats a missing value as empty, so a blank tool is not endlessly "changed"', () => {
    expect(loc.read({})).toBe('');
    expect(loc.value({})).toBe('');
  });

  it('a second push has nothing to do (read matches value after apply)', () => {
    const out = loc.apply(entry(), 'LC-140');
    expect(loc.read(out)).toBe(loc.value({ location: 'LC-140' }));
  });
});
