import { describe, it, expect } from 'vitest';
import { smartDiam, buildDesc, SNAP_TOL_IN } from './toolNaming.js';

describe('smartDiam — drill numbers only for drill-type tools', () => {
  // .0938" is a 3/32" tool that also sits within tolerance of a #42 drill (.0935").
  it('names a non-drill by its fraction, never a drill number', () => {
    expect(smartDiam(0.0938, false, false)).toBe('3/32 (.0938)');
  });

  it('a real drill of the same size uses the drill number', () => {
    expect(smartDiam(0.0938, false, true)).toBe('#42 (.0938)');
  });

  it('always shows the ACTUAL diameter in parentheses, not the chart value', () => {
    // Exactly on the #42 chart value → ".0935"; a hair off → the actual value.
    expect(smartDiam(0.0935, false, true)).toBe('#42 (.0935)');
    expect(smartDiam(0.0938, false, true)).toBe('#42 (.0938)'); // NOT (.0935)
  });

  it('a near-fraction metric size falls through to metric, not a wrong fraction', () => {
    // .0571" is 1.45mm and only ~0.0054" from 1/16" — it must NOT become "1/16".
    expect(smartDiam(0.0571, false, false)).toBe('1.45mm (.0571)');
  });

  it('a genuine fraction is still recognized', () => {
    expect(smartDiam(0.125, false, false)).toBe('1/8 (.125)');
    expect(smartDiam(0.09375, false, false)).toBe('3/32 (.0938)');
  });

  it('a plain non-fraction, non-drill, non-metric inch value stays a decimal', () => {
    // .3376" isn't a fraction, drill, or clean metric size → raw decimal.
    expect(smartDiam(0.3376, false, false)).toBe('.3376');
  });
});

describe('snap tolerance — ±0.0003", always inches', () => {
  it('has no metric variant, because a metric record never reaches the charts', () => {
    // ⚠️ ONE tolerance, and it is in inches — the thing it compares against
    // (FRACS / NUM_DRILLS / LETTER_DRILLS) is an inch chart. The retired
    // snapTol('millimeters') scaled it up, which kept a MILLIMETRE value
    // pointed at those inch numbers and merely widened the window.
    expect(SNAP_TOL_IN).toBe(0.0003);
    expect(smartDiam(0.0938, false, true, 'inches')).toBe('#42 (.0938)');
    expect(smartDiam(0.0938, false, true, 'millimeters')).toBe('0.094mm');
  });

  it('snaps a drill within 0.0003" but not one just outside it', () => {
    // #42 = .0935". +0.0003" still snaps; +0.0004" does not.
    expect(smartDiam(0.0938, false, true)).toBe('#42 (.0938)');
    expect(smartDiam(0.0939, false, true)).not.toContain('#42');
  });

  it('snaps a fraction within 0.0003" but not one just outside it', () => {
    // 1/8 = .125". .1252" snaps; .1254" does not.
    expect(smartDiam(0.1252, false, false)).toBe('1/8 (.1252)');
    expect(smartDiam(0.1254, false, false)).not.toContain('1/8');
  });
});

describe('buildDesc — tool-type drives drill-number naming', () => {
  it('end mill at .0938" is a 3/32, not a #42', () => {
    const desc = buildDesc({ toolType: 'flat end mill', diameter: '0.0938', flutes: '3', loc: '0.141' });
    expect(desc).toBe('3/32 (.0938) 3FL EM .141LOC');
  });

  it('drill at .0938" is a #42', () => {
    const desc = buildDesc({ toolType: 'drill', diameter: '0.0938', material: 'carbide' });
    expect(desc).toBe('#42 (.0938) CARB DRILL');
  });

  it('metric size names consistently whether or not inputWasMm is set (export = preview)', () => {
    // The export path used to pass inputWasMm=false and drop the "1.45mm" prefix.
    // Now .0571" resolves to 1.45mm both ways — export matches the preview.
    const f = { toolType: 'drill', diameter: '0.0571', material: 'carbide' };
    expect(buildDesc({ ...f, inputWasMm: true })).toBe('1.45mm (.0571) CARB DRILL');
    expect(buildDesc(f)).toBe('1.45mm (.0571) CARB DRILL');
  });

  it('inputWasMm is read off the field object when no explicit flag is passed', () => {
    // A clean metric value that is NOT auto-detected (isLikelyMetric) needs the
    // stored flag to show mm. 0.25" = 6.35mm; without the flag it stays "1/4".
    const f = { toolType: 'flat end mill', diameter: '0.25', flutes: '4', loc: '0.75' };
    expect(buildDesc(f)).toBe('1/4 (.25) 4FL EM .75LOC');
    expect(buildDesc({ ...f, inputWasMm: true })).toBe('6.35mm (.25) 4FL EM .75LOC');
  });
});

// ⚠️ A MILLIMETRES RECORD'S DIAMETER IS ALREADY IN MILLIMETRES. Every length in
// this app is stored in its own record's unit — there is no hidden inches
// canonical — so smartDiam receives 6 for a 6mm tool. Treating that as inches
// is not a rounding error, it is a different tool, and it named the demo
// library's 6mm ball mill "152.4mm (6) BALL 4FL 12LOC" (6 × 25.4). It stayed
// invisible because you had to press Suggest to see the generated name at all.
describe('buildDesc on a MILLIMETRES tool', () => {
  const mm = { unit: 'millimeters' };

  it('says the size the shop says — never the inch conversion', () => {
    const desc = buildDesc({ ...mm, toolType: 'ball end mill', diameter: '6', flutes: '4', loc: '12' });
    expect(desc).toBe('6mm BALL 4FL 12LOC');
    expect(desc).not.toContain('152.4');
  });

  it('never snaps to an inch fraction', () => {
    // The retired snapTol('millimeters') WIDENED the inch tolerance for a
    // metric tool, so these matched FRACS outright: 1 → "1", 2.5 → "2-1/2".
    expect(smartDiam(1, false, false, 'millimeters')).toBe('1mm');
    expect(smartDiam(2.5, false, false, 'millimeters')).toBe('2.5mm');
    expect(smartDiam(12.7, false, false, 'millimeters')).toBe('12.7mm');
  });

  it('never snaps to a drill number or letter', () => {
    // .0935" is a #42 and .234" is an "A" — inch charts, so a 0.0935mm or
    // 0.234mm value must not borrow their names.
    expect(smartDiam(0.0935, false, true, 'millimeters')).toBe('0.093mm');
    expect(smartDiam(0.234, false, true, 'millimeters')).toBe('0.234mm');
  });

  it('ignores inputWasMm, which is only meaningful on an INCH record', () => {
    // "stored in inches, named in mm" says nothing about a record already in
    // mm — and doubling the conversion is exactly the bug being fixed.
    expect(smartDiam(6, true, false, 'millimeters')).toBe('6mm');
  });

  it('leaves an INCH tool exactly as it was', () => {
    expect(buildDesc({ toolType: 'flat end mill', diameter: '0.5', flutes: '4', loc: '1' }))
      .toBe('1/2 (.5) 4FL EM 1LOC');
    expect(buildDesc({ unit: 'inches', toolType: 'drill', diameter: '0.0938', material: 'carbide' }))
      .toBe('#42 (.0938) CARB DRILL');
  });
});
