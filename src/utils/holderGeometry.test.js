import { describe, it, expect } from 'vitest';
import {
  insertSegmentAt, displaySegments, realSegmentIndex, deriveGaugeLength, newSegment,
} from './holderGeometry.js';

// The display is the STORED array reversed, so every visual index is a mirror
// of a stored one. Getting the insert mapping wrong doesn't throw — it silently
// puts the segment on the opposite end of the holder, which is a real physical
// difference (spindle end vs cutting end) that only shows up in the gauge
// length or, worse, in Fusion.
const seg = (h) => ({ ...newSegment(h, 20), height: h });
const heights = (list) => list.map(s => s.height);

describe('insertSegmentAt', () => {
  // Stored bottom-first: [tip … spindle]. Displayed top-down: [spindle … tip].
  const stored = [seg(1), seg(2), seg(3)];
  const NEW = seg(99);

  it('shows the row where the user clicked', () => {
    for (let vi = 0; vi <= stored.length; vi++) {
      const next = insertSegmentAt(stored, vi, NEW);
      expect(heights(displaySegments(next))[vi]).toBe(99);
    }
  });

  it('inserting above the TOP row lands at the spindle end — the case that sent the user to Fusion', () => {
    const next = insertSegmentAt(stored, 0, NEW);
    expect(heights(displaySegments(next))).toEqual([99, 3, 2, 1]);
    expect(heights(next)).toEqual([1, 2, 3, 99]);   // appended, because the top row is stored LAST
  });

  it('inserting below the BOTTOM row is exactly the old add-at-tip prepend', () => {
    const next = insertSegmentAt(stored, stored.length, NEW);
    expect(heights(displaySegments(next))).toEqual([3, 2, 1, 99]);
    expect(heights(next)).toEqual([99, 1, 2, 3]);
  });

  it('inserts in the middle without disturbing the order around it', () => {
    expect(heights(displaySegments(insertSegmentAt(stored, 1, NEW)))).toEqual([3, 99, 2, 1]);
    expect(heights(displaySegments(insertSegmentAt(stored, 2, NEW)))).toEqual([3, 2, 99, 1]);
  });

  it('never drops or reorders the existing segments', () => {
    for (let vi = 0; vi <= stored.length; vi++) {
      const next = insertSegmentAt(stored, vi, NEW);
      expect(next).toHaveLength(stored.length + 1);
      expect(heights(next).filter(x => x !== 99)).toEqual(heights(stored));
    }
  });

  it('agrees with realSegmentIndex — one mirror, not two', () => {
    const next = insertSegmentAt(stored, 1, NEW);
    expect(next[realSegmentIndex(1, next.length)].height).toBe(99);
  });

  it('clamps an out-of-range index instead of producing holes', () => {
    expect(insertSegmentAt(stored, -5, NEW)).toHaveLength(4);
    expect(insertSegmentAt(stored, 99, NEW)).toHaveLength(4);
    expect(insertSegmentAt([], 0, NEW)).toHaveLength(1);
    expect(insertSegmentAt(null, 0, NEW)).toHaveLength(1);
  });

  it('a segment added at the spindle end lengthens the gauge, like the real fix', () => {
    // The NBT30-ER16-120 case: a 1.02mm step at the spindle end is what brings
    // the modelled gauge up to the engraved 120 nominal.
    const before = deriveGaugeLength(stored);
    const after = deriveGaugeLength(insertSegmentAt(stored, 0, seg(1.02)));
    expect(after - before).toBeCloseTo(1.02, 6);
  });
});
