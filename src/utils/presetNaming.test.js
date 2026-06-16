import { describe, it, expect } from 'vitest';
import {
  materialToCode,
  materialCategory,
  matchMaterial,
  materialLabel,
  materialIsoGroup,
  findMaterialInLibrary,
  materialNameCode,
  presetMaterialColor,
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

describe('matchMaterial', () => {
  it('maps real shop codes to canonical materials', () => {
    expect(matchMaterial('AL')).toBe('AL');
    expect(matchMaterial('AL FIN')).toBe('AL');
    expect(matchMaterial('SS')).toBe('SS');
    expect(matchMaterial('SS316')).toBe('SS');
    expect(matchMaterial('SS-316 FIN')).toBe('SS');
    expect(matchMaterial('SS316 SM HOLE FIN')).toBe('SS');
    expect(matchMaterial('ST')).toBe('STEEL');
    expect(matchMaterial('STEEL')).toBe('STEEL');
    expect(matchMaterial('BRZ ROUGH')).toBe('BRONZE');
    expect(matchMaterial('GF Nylon Finish')).toBe('PLASTIC');
    expect(matchMaterial('low carbon steel')).toBe('MILD');
  });

  it('returns null when no material is recognizable', () => {
    expect(matchMaterial('Default preset')).toBe(null);
    expect(matchMaterial('')).toBe(null);
    expect(matchMaterial('Engrave')).toBe(null);
    expect(matchMaterial('BZN ROUGH')).toBe(null); // ambiguous — intentionally unmapped
  });

  it('materialLabel gives a human label or Other', () => {
    expect(materialLabel('SS316')).toBe('Stainless Steel');
    expect(materialLabel('AL')).toBe('Aluminum');
    expect(materialLabel('Default preset')).toBe('Other');
  });

  it('materialIsoGroup maps materials to ISO turning groups for preset coloring', () => {
    expect(materialIsoGroup('AL FIN')).toBe('N');     // aluminum → non-ferrous
    expect(materialIsoGroup('SS316')).toBe('M');      // stainless
    expect(materialIsoGroup('STEEL')).toBe('P');      // steel
    expect(materialIsoGroup('BRZ ROUGH')).toBe('N');  // bronze → non-ferrous
    expect(materialIsoGroup('GF Nylon')).toBe(null);  // plastic → no ISO group
    expect(materialIsoGroup('Default preset')).toBe(null); // unknown
  });
});

describe('Materials library resolution', () => {
  const MATS = {
    groups: [
      { id: 'M', label: 'Stainless Steel', code: 'SS', color: '#f5c842' },
      { id: 'N', label: 'Non-Ferrous', code: 'AL', color: '#5bad6f' },
    ],
    materials: [
      { id: 's1', group_id: 'M', label: '316L Stainless', code: 'SS316' },
    ],
  };

  it('findMaterialInLibrary resolves group and sub-material by label', () => {
    expect(findMaterialInLibrary('Stainless Steel', MATS).group.id).toBe('M');
    expect(findMaterialInLibrary('Stainless Steel', MATS).sub).toBe(null);
    const r = findMaterialInLibrary('316L Stainless', MATS);
    expect(r.sub.id).toBe('s1');
    expect(r.group.id).toBe('M');
    expect(findMaterialInLibrary('Nope', MATS)).toEqual({});
  });

  it('materialNameCode prefers sub code, then group code, then group id', () => {
    expect(materialNameCode('316L Stainless', MATS)).toBe('SS316'); // sub code
    expect(materialNameCode('Stainless Steel', MATS)).toBe('SS');   // group code
    expect(materialNameCode('Non-Ferrous', MATS)).toBe('AL');
    expect(materialNameCode('', MATS)).toBe('');
  });

  it('materialNameCode falls back to the legacy keyword code for non-library strings', () => {
    expect(materialNameCode('AL FIN', MATS)).toBe('AL'); // imported name → matchMaterial
  });

  it('presetMaterialColor resolves the group color via the library, then legacy', () => {
    expect(presetMaterialColor('Stainless Steel', MATS)).toBe('#f5c842');
    expect(presetMaterialColor('316L Stainless', MATS)).toBe('#f5c842'); // sub → its group color
    expect(presetMaterialColor('AL FIN', MATS)).toBe('#5bad6f');         // legacy AL → N group color
    expect(presetMaterialColor('Wood', MATS)).toBe(null);
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

  it('detects an op word embedded among other tokens (real Fusion names)', () => {
    expect(parsePresetName('AL FIN').opType).toBe('finish');
    expect(parsePresetName('BRZ ROUGH').opType).toBe('rough');
    expect(parsePresetName('AL SM BORE').opType).toBe('small_bore');
    expect(parsePresetName('GF Nylon Fine Finish').opType).toBe('fine_finish');
    expect(parsePresetName('AL-150-FIN').opType).toBe('finish');      // dash-separated
    expect(parsePresetName('SS Rough 150-316').opType).toBe('rough');
    expect(parsePresetName('GF Nylon Finish').opType).toBe('finish');
  });

  it('treats SM HOLE the same as SM BORE (small bore), winning over a plain FIN', () => {
    expect(parsePresetName('AL SM HOLE').opType).toBe('small_bore');
    expect(parsePresetName('SS316 SM HOLE FIN').opType).toBe('small_bore');
  });

  it('prefers the more specific multi-word op (Fine Finish over Finish)', () => {
    expect(parsePresetName('GF Nylon Fine Finish').opType).toBe('fine_finish');
  });

  it('does not false-match a single letter inside another word', () => {
    // "BRZ" must not read as "R"; material-only names have no op.
    expect(parsePresetName('BRZ').opType).toBe(null);
    expect(parsePresetName('AL').opType).toBe(null);
    expect(parsePresetName('AL RAMP').opType).toBe(null); // RAMP is not an op
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
