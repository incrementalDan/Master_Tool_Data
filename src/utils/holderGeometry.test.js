import { describe, it, expect } from 'vitest';
import {
  insertSegmentAt, displaySegments, realSegmentIndex, deriveGaugeLength, newSegment,
  seedSegmentAt, segUpper, segLower, segHeight,
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

describe('seedSegmentAt', () => {
  // Stored bottom-first: [tip … spindle]. Displayed top-down: [spindle … tip].
  const stored = [
    { height: 10, 'upper-diameter': 20, 'lower-diameter': 18 },   // visual row 3 (tip)
    { height: 20, 'upper-diameter': 30, 'lower-diameter': 20 },   // visual row 2
    { height: 30, 'upper-diameter': 45, 'lower-diameter': 30 },   // visual row 1 (spindle)
  ];

  it('is 2mm tall, not the height of the row next to it', () => {
    // ⚠️ Seeding the height too made the new row identical to its neighbour,
    // and nothing then said which of the two was the one just added.
    const seg = seedSegmentAt(stored, 1, 'millimeters');
    expect(segHeight(seg)).toBe(2);
    expect(segHeight(seg)).not.toBe(30);
  });

  it('uses the inch equivalent on an inch holder', () => {
    expect(segHeight(seedSegmentAt(stored, 1, 'inches'))).toBeCloseTo(2 / 25.4, 4);
  });

  it('meets the face it attaches to, so the profile stays continuous', () => {
    // Inserting above visual row 1 meets that row's UPPER end (45).
    const top = seedSegmentAt(stored, 0, 'millimeters');
    expect(segUpper(top)).toBe(45);
    expect(segLower(top)).toBe(45);
    // Above visual row 2 meets row 2's upper end (30).
    expect(segUpper(seedSegmentAt(stored, 1, 'millimeters'))).toBe(30);
  });

  it('at the TIP it meets the last row\'s lower end', () => {
    const tip = seedSegmentAt(stored, stored.length, 'millimeters');
    expect(segUpper(tip)).toBe(18);
    expect(segLower(tip)).toBe(18);
  });

  it('never seeds the absurd 20-unit default onto a real holder', () => {
    // The old add-at-tip default put a 20-INCH diameter on an inch holder,
    // which rescales the whole profile drawing.
    const inchHolder = [{ height: 1, 'upper-diameter': 0.75, 'lower-diameter': 0.75 }];
    expect(segUpper(seedSegmentAt(inchHolder, 0, 'inches'))).toBe(0.75);
  });

  it('falls back to the plain default on an empty holder', () => {
    expect(segUpper(seedSegmentAt([], 0, 'millimeters'))).toBe(segUpper(newSegment()));
  });

  it('inserts where it was asked to, with the seeded values intact', () => {
    const next = insertSegmentAt(stored, 1, seedSegmentAt(stored, 1, 'millimeters'));
    const shown = displaySegments(next);
    expect(segHeight(shown[1])).toBe(2);
    expect(segUpper(shown[1])).toBe(30);
    expect(shown).toHaveLength(4);
  });
});
