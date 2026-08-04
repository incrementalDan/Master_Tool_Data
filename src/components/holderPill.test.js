// The holder color precedence. This exists because the two halves disagreed
// once: the Holders page fell straight to teal when a record had no color of
// its own, while tool pages fell back to the by-size list — the same holder,
// two colors, depending on where you looked at it.
import { describe, it, expect } from 'vitest';
import { holderColor, HOLDER_DEFAULT } from '../utils/holderColors.js';
import { holderForDisplay } from './HolderPill.jsx';

describe('holder color precedence', () => {
  it('a chosen color always wins', () => {
    expect(holderColor('NBT30-SK13C-60', '#123456')).toBe('#123456');
    expect(holderColor('', '#123456')).toBe('#123456');
  });

  it('falls back to the by-size list, not to the default', () => {
    // The regression: a record with color: null must NOT go teal.
    expect(holderColor('NBT30-SK13C-60', null)).toBe('#06b6d4');
    expect(holderColor('NBT30-SK13C-60', null)).not.toBe(HOLDER_DEFAULT);
  });

  it('an unnamed holder is stable, not random', () => {
    const a = holderColor('SOME UNLISTED HOLDER');
    expect(holderColor('SOME UNLISTED HOLDER')).toBe(a);
    expect(holderColor('some unlisted holder')).toBe(a);   // case-insensitive
  });

  it('no holder at all is the teal default', () => {
    expect(holderColor('')).toBe(HOLDER_DEFAULT);
    expect(holderColor(null)).toBe(HOLDER_DEFAULT);
  });
});

describe('holderForDisplay', () => {
  const rec = { id: 'r1', fusion_guid: 'g1', description: 'NBT30-SK13C-60', color: '#abcdef' };

  it('prefers the record — the FK first, then the baked guid', () => {
    expect(holderForDisplay({ records: [rec], holderId: 'r1' })).toBe(rec);
    expect(holderForDisplay({ records: [rec], holderGuid: 'g1' })).toBe(rec);
  });

  it('synthesizes one from the description when nothing resolves', () => {
    // An unlinked tool still gets the same pill, not a different kind of chip.
    const out = holderForDisplay({ records: [], description: 'NBT30-SK13C-90' });
    expect(out).toMatchObject({ description: 'NBT30-SK13C-90', _synthetic: true });
    // No color of its own — HolderPill derives it, same as for a record
    // that hasn't been given one. One code path, one answer.
    expect(out.color).toBeUndefined();
  });

  it('renders nothing when there is no holder to show', () => {
    expect(holderForDisplay({ records: [], description: '—' })).toBeNull();
    expect(holderForDisplay({ records: [], description: '' })).toBeNull();
  });
});
