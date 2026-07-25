import { describe, it, expect } from 'vitest';
import { niceIncrement, dynamicStep } from './speedsAndFeedsCalc.js';

describe('niceIncrement — 1/2/5 × 10^n rounding', () => {
  it('rounds to a clean increment', () => {
    expect(niceIncrement(0.0008)).toBeCloseTo(0.001, 6);
    expect(niceIncrement(0.0004)).toBeCloseTo(0.0005, 6);
    expect(niceIncrement(0.00024)).toBeCloseTo(0.0002, 6);
    expect(niceIncrement(640)).toBe(500);
    expect(niceIncrement(0)).toBe(0);
  });
});

describe('dynamicStep — proportional wheel nudge (~8%), floored at base', () => {
  it('scales with the value (chip load)', () => {
    expect(dynamicStep(0.010, 0.0001)).toBeCloseTo(0.001, 6);   // user example
    expect(dynamicStep(0.005, 0.0001)).toBeCloseTo(0.0005, 6);  // user example
  });

  it('never drops below the field base step (still nudgeable near/at zero)', () => {
    expect(dynamicStep(0.0008, 0.0001)).toBeCloseTo(0.0001, 6);
    expect(dynamicStep(0, 0.0001)).toBe(0.0001);
  });

  it('is proportional for large fields too (RPM, feed)', () => {
    expect(dynamicStep(8000, 10)).toBe(500);
    expect(dynamicStep(40, 0.5)).toBe(2);
  });
});
