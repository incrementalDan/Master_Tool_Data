// The holder colour rule: it is the colour PICKED IN THE APP, and nothing
// derives it from the holder's name. A record with none yet gets one assigned
// from its stable id so a fresh library isn't 22 identical teal pills.
//
// This file exists because the two halves disagreed once — the Holders page and
// the tool pages resolved the colour differently for the same holder. There is
// now one function, and both go through it.
import { describe, it, expect } from 'vitest';
import { holderDisplayColor, autoHolderColor, HOLDER_DEFAULT } from '../utils/holderColors.js';
import { holderForDisplay } from './HolderPill.jsx';

describe('holder colour', () => {
  it('is the colour picked in the app', () => {
    expect(holderDisplayColor({ id: 'r1', description: 'NBT30-SK13C-60', color: '#123456' })).toBe('#123456');
    expect(holderDisplayColor({ id: 'r1', description: '', color: '#123456' })).toBe('#123456');
  });

  // ⚠️ The old rule read the description — a table of six names plus a hash of
  // the text — so editing a description re-coloured the holder on every
  // keystroke. Nothing may reintroduce that.
  it('does NOT change when the description changes', () => {
    const rec = { id: 'r1', description: 'NBT30-SK13C-60', color: null };
    const base = holderDisplayColor(rec);
    for (const d of ['NBT30-SK13C-90', 'NBT30-SK20C-60', 'DRILL CHUCK', 'anything at all', '']) {
      expect(holderDisplayColor({ ...rec, description: d })).toBe(base);
    }
  });

  it('assigns a stable colour to a record with none picked', () => {
    const a = holderDisplayColor({ id: 'r1' });
    expect(a).toBe(holderDisplayColor({ id: 'r1' }));
    expect(a).toBe(autoHolderColor('r1'));
    expect(a).not.toBe(HOLDER_DEFAULT);
  });

  it('gives different records different colours', () => {
    const seen = new Set(['r1','r2','r3','r4','r5','r6'].map(id => holderDisplayColor({ id })));
    expect(seen.size).toBeGreaterThan(1);
  });

  // A holder with no record — one Fusion baked into a tool — isn't in the app,
  // so it has no picked colour and takes the default.
  it('is the teal default when there is no record', () => {
    expect(holderDisplayColor({ description: 'NBT30-SK13C-60' })).toBe(HOLDER_DEFAULT);
    expect(holderDisplayColor(null)).toBe(HOLDER_DEFAULT);
    expect(holderDisplayColor({})).toBe(HOLDER_DEFAULT);
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
