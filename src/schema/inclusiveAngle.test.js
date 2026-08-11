// `taper_angle` is the one field whose STORED number differs from the SHOWN
// number: a chamfer/tapered mill stores Fusion's half angle and shows the
// included angle. Locked here because the drift is invisible — a component that
// renders the raw value looks fine until it sits next to one that doesn't, and
// then the app appears to disagree with itself about correct data.
//
// Numbers are from the shop's real L-250 ".25 CHAMFER 60DEG": Fusion holds
// geometry.TA = 30, every screen shows 60.
import { describe, it, expect } from 'vitest';
import { showsInclusiveAngle, toDisplayValue, INCLUSIVE_ANGLE_TYPES } from './fieldRegistry.js';

describe('inclusive-angle display rule', () => {
  it('doubles taper_angle for the inclusive-angle types', () => {
    for (const type of INCLUSIVE_ANGLE_TYPES) {
      expect(showsInclusiveAngle('taper_angle', type)).toBe(true);
      expect(toDisplayValue('taper_angle', 30, type)).toBe(60);
      expect(toDisplayValue('taper_angle', 45, type)).toBe(90);
    }
  });

  // A face mill and a dovetail both carry a real taper_angle, and theirs is the
  // angle itself — doubling those would be as wrong as not doubling a chamfer.
  it('leaves taper_angle alone on every other type', () => {
    for (const type of ['face mill', 'dovetail', 'flat end mill']) {
      expect(showsInclusiveAngle('taper_angle', type)).toBe(false);
      expect(toDisplayValue('taper_angle', 45, type)).toBe(45);
    }
  });

  it('never touches another field on an inclusive-angle type', () => {
    expect(showsInclusiveAngle('tip_angle', 'chamfer mill')).toBe(false);
    expect(toDisplayValue('diameter', 0.25, 'chamfer mill')).toBe(0.25);
  });

  // An empty angle must stay empty — 0 × 2 rendered as "0" would claim the tool
  // has a zero included angle rather than no value.
  it('passes empty values through untouched', () => {
    for (const v of [null, undefined, '']) {
      expect(toDisplayValue('taper_angle', v, 'chamfer mill')).toBe(v);
    }
  });
});
