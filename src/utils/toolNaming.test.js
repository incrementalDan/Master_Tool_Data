import { describe, it, expect } from 'vitest';
import { smartDiam, buildDesc } from './toolNaming.js';

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
