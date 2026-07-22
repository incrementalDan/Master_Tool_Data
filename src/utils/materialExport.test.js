import { describe, it, expect } from 'vitest';
import { buildFusionStockMaterial, buildDesignators, stockMaterialFilename } from './materialExport.js';

const groups = [{ id: 'N', label: 'Non-Ferrous', code: 'AL' }];
const preset = {
  id: 'pre_N_al_wrought', group_id: 'N', name: 'Al Wrought', code: '',
  description: 'Wrought Al alloys — 1100 through 7075',
  iso_513: 'N1.2', kennametal: 'N2', vdi_3323: '22',
};
const materials = [
  { id: 'N_1100', preset_id: 'pre_N_al_wrought', label: '1100', aliases: ['1100-H14', 'pure aluminum'] },
  { id: 'N_7075', preset_id: 'pre_N_al_wrought', label: '7075', aliases: ['7075-T6'] },
  { id: 'N_356', preset_id: 'pre_N_al_cast_low', label: '356', aliases: [] }, // different preset — excluded
];

describe('buildFusionStockMaterial', () => {
  it('matches the Fusion stock-material shape with blank uuid + physicalMaterials', () => {
    const out = buildFusionStockMaterial(preset, materials, groups);
    expect(out.description).toBe('Al Wrought');
    expect(out.category).toBe('Metal');
    expect(out.uuid).toBe('');
    expect(out.physicalMaterials).toEqual([]);
    expect(out.version).toBe(1);
    expect(Object.keys(out)).toEqual(['description', 'category', 'uuid', 'designators', 'physicalMaterials', 'version']);
  });

  it('category is overridable', () => {
    expect(buildFusionStockMaterial(preset, materials, groups, { category: 'Plastic' }).category).toBe('Plastic');
  });
});

describe('buildDesignators', () => {
  const des = buildDesignators(preset, materials, groups);

  it('includes this preset alloys + aliases, excludes other presets', () => {
    expect(des).toContain('1100');
    expect(des).toContain('1100-H14');
    expect(des).toContain('7075-T6');
    expect(des).not.toContain('356');
  });

  it('includes standard codes and group name/id', () => {
    expect(des).toEqual(expect.arrayContaining(['N1.2', 'N2', '22', 'Non-Ferrous', 'N', 'AL']));
  });

  it('strips listed alloys from the prose description ("minus the alloys listed again")', () => {
    const joined = des.join('|');
    // 1100 and 7075 appear as their own tokens, not repeated inside a description entry
    expect(des.filter((d) => d === '1100').length).toBe(1);
    expect(joined).not.toMatch(/Wrought Al alloys .*1100/);
  });

  it('dedupes case-insensitively and drops blanks', () => {
    const lower = des.map((d) => d.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
    expect(des).not.toContain('');
  });
});

describe('stockMaterialFilename', () => {
  it('uses the preset name and keeps spaces', () => {
    expect(stockMaterialFilename({ name: 'SS Austenitic 316' })).toBe('SS Austenitic 316.json');
  });
  it('sanitizes path-illegal characters', () => {
    expect(stockMaterialFilename({ name: 'Al/Cu 2024' })).toBe('Al-Cu 2024.json');
  });
});
