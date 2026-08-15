// ⚠️ A HOLDER'S COLOUR MUST NOT MOVE WHEN ITS NAME DOES.
//
// The hash fallback used to run on the DESCRIPTION, so editing a holder's
// description re-coloured it — live, on every keystroke, in the very screen
// where you edit it. On the real library 21 of 22 holders have no chosen
// colour, so nearly every holder behaved that way.
import { describe, it, expect } from 'vitest';
import { holderColor, holderDisplayColor, HOLDER_DEFAULT } from './holderColors.js';

const REC = { id: 'rec-abc', description: 'NBT30-SK99C-77', color: null };

describe('a record-backed holder keeps its colour while the description is edited', () => {
  it('does not change as the description is typed', () => {
    const base = holderDisplayColor(REC);
    for (const desc of ['NBT30-SK99C-7', 'NBT30-SK99C', 'NBT30-', 'N', '', 'Totally renamed holder']) {
      expect(holderDisplayColor({ ...REC, description: desc })).toBe(base);
    }
  });

  it('gives two holders with the same description different colours', () => {
    // They are different physical holders; identity decides, not the label.
    const a = holderDisplayColor({ id: 'rec-1', description: 'SAME NAME' });
    const b = holderDisplayColor({ id: 'rec-2', description: 'SAME NAME' });
    expect(a).not.toBe(b);
  });

  it('is stable across calls', () => {
    expect(holderDisplayColor(REC)).toBe(holderDisplayColor(REC));
  });
});

describe('the precedence chain is unchanged otherwise', () => {
  it('a chosen colour always wins, even over a named one', () => {
    expect(holderDisplayColor({ ...REC, color: '#123456' })).toBe('#123456');
    expect(holderDisplayColor({ id: 'x', description: 'NBT30-SK13C-60', color: '#123456' }))
      .toBe('#123456');
  });

  // The six hand-assigned colours are already in people's heads.
  it('keeps the shop’s named colours, by description', () => {
    expect(holderDisplayColor({ id: 'rec-z', description: 'NBT30-SK13C-60' })).toBe('#06b6d4');
    expect(holderDisplayColor({ id: 'rec-z', description: 'nbt30-sk20c-90' })).toBe('#ef4444');
  });

  it('falls back to teal when there is nothing to go on', () => {
    expect(holderDisplayColor(null)).toBe(HOLDER_DEFAULT);
    expect(holderDisplayColor({ description: '', color: null })).toBe(HOLDER_DEFAULT);
  });

  // A holder Fusion baked into a tool has no record — the description is the
  // only identity available, and colouring it is what this module is for.
  it('still hashes the description for a holder with no record', () => {
    const a = holderColor('SOME UNKNOWN HOLDER', null, undefined);
    expect(a).toBe(holderColor('SOME UNKNOWN HOLDER', null, undefined));
    expect(a).not.toBe(holderColor('A DIFFERENT HOLDER', null, undefined));
  });
});
