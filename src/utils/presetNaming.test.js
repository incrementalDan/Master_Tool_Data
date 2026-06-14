import { describe, it, expect } from 'vitest';
import {
  materialToCode,
  materialCategory,
  matchOpType,
  opTypeWord,
  formatOoh,
  composePresetName,
  parsePresetName,
  presetMatchesAssembly,
} from './presetNaming.js';

describe('materialToCode', () => {
  it('uppercases the query', () => {
    expect(materialToCode('al')).toBe('AL');
    expect(materialToCode('ss')).toBe('SS');
  });

  it('falls back to GEN for blank/unknown', () => {
    expect(materialToCode('')).toBe('GEN');
    expect(materialToCode(null)).toBe('GEN');
  });
});

describe('materialCategory', () => {
  it('classifies plastic, metal, and blank', () => {
    expect(materialCategory('PLASTIC')).toBe('plastic');
    expect(materialCategory('PL')).toBe('plastic');
    expect(materialCategory('SS')).toBe('metal');
    expect(materialCategory('')).toBe('all');
  });
});

describe('matchOpType', () => {
  it('matches canonical words case-insensitively', () => {
    expect(matchOpType('Rough')).toBe('rough');
    expect(matchOpType('finish')).toBe('finish');
    expect(matchOpType('Small Bore')).toBe('small_bore');
  });

  it('matches aliases, including the FINSH misspelling', () => {
    expect(matchOpType('R')).toBe('rough');
    expect(matchOpType('FIN')).toBe('finish');
    expect(matchOpType('FINSH')).toBe('finish');
    expect(matchOpType('SM BORE')).toBe('small_bore');
  });

  it('returns null for no match or empty input', () => {
    expect(matchOpType('chamfer')).toBe(null);
    expect(matchOpType('')).toBe(null);
    expect(matchOpType(null)).toBe(null);
  });
});

describe('formatOoh', () => {
  it('formats to fixed 3 decimals, no inch mark', () => {
    expect(formatOoh(2.125)).toBe('2.125');
    expect(formatOoh(1.5)).toBe('1.500');
  });

  it('returns empty for non-numeric', () => {
    expect(formatOoh(null)).toBe('');
    expect(formatOoh('')).toBe('');
  });
});

describe('composePresetName', () => {
  it('builds the full convention name', () => {
    expect(composePresetName({
      materialQuery: 'SS', ooh: 2.125, holderShort: '30-SK13-60', opType: 'rough',
    })).toBe('SS 2.125 30-SK13-60 - Rough');
  });

  it('derives the holder short name from a description', () => {
    expect(composePresetName({
      materialQuery: 'AL', ooh: 1.5, holderDescription: 'NBT30-SK20C-90', opType: 'finish',
    })).toBe('AL 1.500 30-SK20-90 - Finish');
  });

  it('builds incrementally, omitting missing pieces', () => {
    // no opType -> no " - Operation" suffix
    expect(composePresetName({ materialQuery: 'SS', ooh: 2.125, holderShort: '30-SK13-60' }))
      .toBe('SS 2.125 30-SK13-60');
    // only a material -> GEN-free single token
    expect(composePresetName({ materialQuery: 'TI' })).toBe('TI');
    // nothing filled -> GEN fallback
    expect(composePresetName({})).toBe('GEN');
  });
});

describe('parsePresetName', () => {
  it('round-trips a composed name', () => {
    const parsed = parsePresetName('SS 2.125 30-SK13-60 - Rough');
    expect(parsed.materialCode).toBe('SS');
    expect(parsed.ooh).toBe(2.125);
    expect(parsed.holderShortName).toBe('30-SK13-60');
    expect(parsed.opType).toBe('rough');
  });

  it('falls back to whole-name op match for legacy bare names', () => {
    expect(parsePresetName('Rough').opType).toBe('rough');
    expect(parsePresetName('Finsh').opType).toBe('finish');
    expect(parsePresetName('SM Bore').opType).toBe('small_bore');
  });

  it('returns null only for empty names', () => {
    expect(parsePresetName('')).toBe(null);
    expect(parsePresetName('   ')).toBe(null);
  });
});

describe('presetMatchesAssembly', () => {
  const preset = { name: 'SS 2.125 30-SK13-60 - Rough' };

  it('matches when holder short name and OOH agree (within tolerance)', () => {
    const assembly = { holder_description: 'NBT30-SK13C-60', ooh: 2.1252 };
    expect(presetMatchesAssembly(preset, assembly, 'inches')).toBe(true);
  });

  it('does not match a different OOH', () => {
    const assembly = { holder_description: 'NBT30-SK13C-60', ooh: 2.5 };
    expect(presetMatchesAssembly(preset, assembly, 'inches')).toBe(false);
  });

  it('does not match a different holder', () => {
    const assembly = { holder_description: 'NBT30-SK20C-90', ooh: 2.125 };
    expect(presetMatchesAssembly(preset, assembly, 'inches')).toBe(false);
  });
});

describe('opTypeWord', () => {
  it('maps a stored value back to its display word', () => {
    expect(opTypeWord('rough')).toBe('Rough');
    expect(opTypeWord('small_bore')).toBe('Small Bore');
    expect(opTypeWord('nope')).toBe('');
  });
});
