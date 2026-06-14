import { describe, it, expect } from 'vitest';
import {
  MM_PER_IN,
  normalizeUnit,
  convertLength,
  toInches,
  fromInches,
  unitAbbr,
  lengthEps,
  formatLength,
} from './units.js';

describe('normalizeUnit', () => {
  it('coerces mm aliases to millimeters', () => {
    expect(normalizeUnit('millimeters')).toBe('millimeters');
    expect(normalizeUnit('mm')).toBe('millimeters');
  });

  it('treats anything else (incl. inches/undefined) as inches', () => {
    expect(normalizeUnit('inches')).toBe('inches');
    expect(normalizeUnit('in')).toBe('inches');
    expect(normalizeUnit(undefined)).toBe('inches');
  });
});

describe('convertLength', () => {
  it('converts inches → millimeters', () => {
    expect(convertLength(1, 'inches', 'millimeters')).toBeCloseTo(MM_PER_IN, 6);
  });

  it('converts millimeters → inches', () => {
    expect(convertLength(25.4, 'millimeters', 'inches')).toBeCloseTo(1, 6);
  });

  it('is a pass-through when units match', () => {
    expect(convertLength(0.5, 'inches', 'inches')).toBe(0.5);
  });

  it('round-trips a value back to itself', () => {
    const start = 0.751;
    const mm = convertLength(start, 'inches', 'millimeters');
    expect(convertLength(mm, 'millimeters', 'inches')).toBeCloseTo(start, 6);
  });

  it('returns empty/non-numeric values unchanged (null-safe)', () => {
    expect(convertLength(null, 'inches', 'millimeters')).toBe(null);
    expect(convertLength('', 'inches', 'millimeters')).toBe('');
    expect(convertLength('abc', 'inches', 'millimeters')).toBe('abc');
  });

  it('toInches / fromInches are inverses', () => {
    expect(toInches(25.4, 'millimeters')).toBeCloseTo(1, 6);
    expect(fromInches(1, 'millimeters')).toBeCloseTo(25.4, 6);
  });
});

describe('unitAbbr', () => {
  it('returns the short suffix', () => {
    expect(unitAbbr('millimeters')).toBe('mm');
    expect(unitAbbr('inches')).toBe('in');
  });
});

describe('lengthEps', () => {
  it('scales the inch tolerance up for millimeters', () => {
    expect(lengthEps('inches')).toBeCloseTo(0.0005, 6);
    expect(lengthEps('millimeters')).toBeCloseTo(0.0005 * MM_PER_IN, 6);
  });
});

describe('formatLength', () => {
  it('appends the unit suffix at the unit default precision', () => {
    expect(formatLength(0.5, 'inches')).toBe('0.500 in');
    expect(formatLength(12, 'millimeters')).toBe('12.00 mm');
  });

  it('honors an explicit precision', () => {
    expect(formatLength(0.5, 'inches', 4)).toBe('0.5000 in');
  });

  it('returns empty string for non-numeric input', () => {
    expect(formatLength(null, 'inches')).toBe('');
    expect(formatLength('', 'inches')).toBe('');
  });
});
