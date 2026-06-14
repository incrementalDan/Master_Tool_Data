import { describe, it, expect } from 'vitest';
import { holderShortName } from './holderNaming.js';

describe('holderShortName', () => {
  it('strips the NBT prefix and the SK collet C', () => {
    expect(holderShortName('NBT30-SK13C-60')).toBe('30-SK13-60');
    expect(holderShortName('NBT30-SK20C-90')).toBe('30-SK20-90');
  });

  it('keeps an extension suffix verbatim', () => {
    expect(holderShortName('NBT30-SK13C-60 w/ER16 EXT 2.2OOH'))
      .toBe('30-SK13-60 w/ER16 EXT 2.2OOH');
  });

  it('is case-insensitive on the NBT prefix', () => {
    expect(holderShortName('nbt30-SK13C-60')).toBe('30-SK13-60');
  });

  it('returns empty string for a blank description', () => {
    expect(holderShortName('')).toBe('');
    expect(holderShortName(null)).toBe('');
  });
});
