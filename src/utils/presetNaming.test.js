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
  suggestCamPresetName,
  findCamPresetById,
  camPresetIdForQuery,
  camPresetIdForRenamedQuery,
  resolveCamPresetId,
  stockMaterialIssues,
  syncPresetMaterialName,
  backfillMaterialPresetIds,
  isAutoPresetName,
  unresolvedMaterialPresets,
  assemblyForPreset,
  presetsForAssembly,
  backfillPresetAssemblyLinks,
  camPresetIdFromGrade,
  bareMaterialCode,
  bareCodeGroups,
  autoLinkMaterialByGrade,
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
    presets: [
      { id: 'pre_m_316', group_id: 'M', name: 'SS Austenitic 316', code: '' },
      { id: 'pre_n_al', group_id: 'N', name: 'Al Wrought', code: 'ALW' },
    ],
    materials: [
      { id: 's1', group_id: 'M', preset_id: 'pre_m_316', label: '316 / 316L', aliases: ['316L', 'SS316'], code: 'SS316' },
      { id: 'a1', group_id: 'N', preset_id: 'pre_n_al', label: '6061', aliases: ['6061-T6'], code: '' },
    ],
  };

  it('findMaterialInLibrary resolves alloy (by label or alias), CAM preset, and group', () => {
    // Group by label
    expect(findMaterialInLibrary('Stainless Steel', MATS).group.id).toBe('M');
    expect(findMaterialInLibrary('Stainless Steel', MATS).preset).toBe(null);
    expect(findMaterialInLibrary('Stainless Steel', MATS).alloy).toBe(null);
    // CAM preset by name → fills in its group
    const p = findMaterialInLibrary('SS Austenitic 316', MATS);
    expect(p.preset.id).toBe('pre_m_316');
    expect(p.group.id).toBe('M');
    // Alloy by label → fills in preset + group
    const r = findMaterialInLibrary('316 / 316L', MATS);
    expect(r.alloy.id).toBe('s1');
    expect(r.preset.id).toBe('pre_m_316');
    expect(r.group.id).toBe('M');
    // Alloy by alias
    expect(findMaterialInLibrary('SS316', MATS).alloy.id).toBe('s1');
    expect(findMaterialInLibrary('Nope', MATS)).toEqual({});
  });

  it('materialNameCode prefers alloy code, then preset code, then group code, then group id', () => {
    expect(materialNameCode('316 / 316L', MATS)).toBe('SS316');     // alloy code
    expect(materialNameCode('Al Wrought', MATS)).toBe('ALW');       // preset code
    expect(materialNameCode('SS Austenitic 316', MATS)).toBe('SS'); // preset has no code → group code
    expect(materialNameCode('Stainless Steel', MATS)).toBe('SS');   // group code
    expect(materialNameCode('Non-Ferrous', MATS)).toBe('AL');
    expect(materialNameCode('', MATS)).toBe('');
  });

  it('materialNameCode falls back to the legacy keyword code for non-library strings', () => {
    expect(materialNameCode('AL FIN', MATS)).toBe('AL'); // imported name → matchMaterial
  });

  it('presetMaterialColor resolves the group color via the library, then legacy', () => {
    expect(presetMaterialColor('Stainless Steel', MATS)).toBe('#f5c842');
    expect(presetMaterialColor('316 / 316L', MATS)).toBe('#f5c842');     // alloy → its group color
    expect(presetMaterialColor('SS Austenitic 316', MATS)).toBe('#f5c842'); // preset → its group color
    expect(presetMaterialColor('AL FIN', MATS)).toBe('#5bad6f');         // legacy AL → N group color
    expect(presetMaterialColor('Wood', MATS)).toBe(null);
  });
});

describe('CAM-preset foreign key (store the id, render the name)', () => {
  const MATS = {
    groups: [{ id: 'N', label: 'Non-Ferrous', code: 'AL', color: '#5bad6f' }],
    presets: [{ id: 'pre_n_al', group_id: 'N', name: 'Al Wrought', code: '' }],
    materials: [],
  };
  // Same library after the user RENAMED the CAM preset (id unchanged).
  const RENAMED = { ...MATS, presets: [{ ...MATS.presets[0], name: 'Aluminum (wrought)' }] };

  it('camPresetIdForQuery resolves an id only from an exact CAM preset NAME', () => {
    expect(camPresetIdForQuery('Al Wrought', MATS)).toBe('pre_n_al');
    expect(camPresetIdForQuery('al wrought', MATS)).toBe('pre_n_al'); // case-insensitive
    expect(camPresetIdForQuery('AL', MATS)).toBe(null);               // group code, not a name
    expect(camPresetIdForQuery('', MATS)).toBe(null);
  });

  it('findCamPresetById returns the live record (or null when dangling)', () => {
    expect(findCamPresetById('pre_n_al', MATS).name).toBe('Al Wrought');
    expect(findCamPresetById('gone', MATS)).toBe(null);
    expect(findCamPresetById(null, MATS)).toBe(null);
  });

  it('renders the CURRENT name from the id after a rename (the whole point)', () => {
    const preset = { guid: 'p1', material_preset_id: 'pre_n_al', material: { query: 'Al Wrought' } };
    const synced = syncPresetMaterialName(preset, RENAMED);
    expect(synced.material.query).toBe('Aluminum (wrought)');      // follows the rename
    expect(synced['stock-materials']).toEqual(['Aluminum (wrought)']); // Fusion link follows too
    expect(synced.material_preset_id).toBe('pre_n_al');            // id is stable
  });

  it('adopts the id from a name-matched query (existing name-only links become rename-proof)', () => {
    const preset = { guid: 'p1', material: { query: 'Al Wrought' } }; // no id yet
    const synced = syncPresetMaterialName(preset, MATS);
    expect(synced.material_preset_id).toBe('pre_n_al');
  });

  it('leaves a legacy group-code query untouched (no id, no stock-materials)', () => {
    const preset = { guid: 'p1', material: { query: 'AL' } };
    const synced = syncPresetMaterialName(preset, MATS);
    expect(synced).toBe(preset);                    // unchanged reference
    expect('material_preset_id' in synced).toBe(false);
  });

  it('tolerates a dangling id — keeps the stored name, does not blank it', () => {
    const preset = { guid: 'p1', material_preset_id: 'deleted', material: { query: 'Old Name' } };
    expect(syncPresetMaterialName(preset, MATS)).toBe(preset);
  });

  // A CAM preset renamed by APPENDING detail is the commonest way a name-only
  // link goes stale ("Al Wrought" → "Al Wrought - 6061+"). Unambiguous cases heal
  // silently; ambiguous ones must stay the user's call.
  describe('camPresetIdForRenamedQuery', () => {
    const LIB = { groups: [], materials: [], presets: [
      { id: 'p_al', name: 'Al Wrought - 6061+' },
      { id: 'p_low', name: 'Steel Low Carbon - 1018' },
      { id: 'p_304', name: 'SS Austenitic - 304' },
      { id: 'p_316', name: 'SS Austenitic - 310, 316' },
      { id: 'p_cu', name: 'Pure Copper' },
    ] };

    it('resolves an old name that was renamed by appending detail', () => {
      expect(camPresetIdForRenamedQuery('Al Wrought', LIB)).toBe('p_al');
      expect(camPresetIdForRenamedQuery('steel low carbon', LIB)).toBe('p_low'); // case-insensitive
    });

    it('refuses when two CAM presets share the prefix', () => {
      expect(camPresetIdForRenamedQuery('SS Austenitic', LIB)).toBe(null);
    });

    it('refuses a match that lands mid-word — "P" is not "Pure Copper"', () => {
      expect(camPresetIdForRenamedQuery('P', LIB)).toBe(null);
      expect(camPresetIdForRenamedQuery('Pure Cop', LIB)).toBe(null);
    });

    it('refuses a single-token bare shop code — that is the user\'s decision', () => {
      expect(camPresetIdForRenamedQuery('AL', LIB)).toBe(null);
      expect(camPresetIdForRenamedQuery('SS', LIB)).toBe(null);
      expect(camPresetIdForRenamedQuery('STEEL', LIB)).toBe(null);
    });
  });

  describe('resolveCamPresetId (the shared cascade)', () => {
    const LIB = {
      groups: [{ id: 'M', label: 'Stainless Steel', code: 'SS' }],
      presets: [{ id: 'p_316', group_id: 'M', name: 'SS Austenitic - 310, 316' }],
      materials: [{ id: 'm316', group_id: 'M', preset_id: 'p_316', label: '316 / 316L', aliases: ['SS316'] }],
    };

    it('an existing FK always wins', () => {
      expect(resolveCamPresetId({ material_preset_id: 'kept', material: { query: 'SS Austenitic 316' } }, LIB)).toBe('kept');
    });

    it('falls through exact name → grade → rename', () => {
      expect(resolveCamPresetId({ material: { query: 'SS Austenitic - 310, 316' } }, LIB)).toBe('p_316'); // exact
      expect(resolveCamPresetId({ material: { query: 'SS316 FIN' } }, LIB)).toBe('p_316');               // grade
    });

    it('never overrides a query that still resolves in the library by name', () => {
      // "Stainless Steel" is a GROUP label — it displays fine, so it is left for
      // the user rather than guessed down to one of the group's CAM presets.
      expect(resolveCamPresetId({ material: { query: 'Stainless Steel' } }, LIB)).toBe(null);
    });

    it('returns null rather than guessing at a bare code', () => {
      expect(resolveCamPresetId({ material: { query: 'SS' } }, LIB)).toBe(null);
      expect(resolveCamPresetId({ material: {} }, LIB)).toBe(null);
    });
  });

  it('syncPresetMaterialName corrects a stale name AND is identity-stable once correct', () => {
    const LIB = { groups: [], materials: [], presets: [{ id: 'p_al', name: 'Al Wrought - 6061+' }] };
    const stale = { guid: 'p1', material: { query: 'Al Wrought' } };
    const fixed = syncPresetMaterialName(stale, LIB);
    expect(fixed.material_preset_id).toBe('p_al');
    expect(fixed.material.query).toBe('Al Wrought - 6061+');   // the name Fusion gets
    expect(fixed['stock-materials']).toEqual(['Al Wrought - 6061+']);
    // Second pass returns the SAME object — otherwise every load would look dirty
    // and a bulk fix could never report "nothing to do".
    expect(syncPresetMaterialName(fixed, LIB)).toBe(fixed);
  });

  it('never overwrites a stock material that is not ours — it must stay flaggable', () => {
    const LIB = { groups: [], materials: [], presets: [{ id: 'pre_316', name: 'SS Austenitic - 310, 316' }] };
    // A dangling reference to the replaced Fusion material library. Clobbering it
    // here would destroy the only evidence and stockMaterialIssues could never
    // report it — and it would disagree with what the Fusion push does.
    const p = {
      guid: 'p1', material_preset_id: 'pre_316',
      material: { query: 'SS Austenitic 316' }, 'stock-materials': ['SS Harder'],
    };
    const out = syncPresetMaterialName(p, LIB);
    expect(out.material.query).toBe('SS Austenitic - 310, 316');   // name still corrected
    expect(out['stock-materials']).toEqual(['SS Harder']);         // reference preserved
    expect(stockMaterialIssues([out], LIB)).toHaveLength(1);       // and still flagged
    expect(syncPresetMaterialName(out, LIB)).toBe(out);            // settles — no churn
  });

  // SHOP RULE: Fusion's material library is generated FROM ours, so a preset's
  // stock-material must be one of our CAM presets. Anything else is a leftover
  // pointing at the replaced Fusion library and resolves to nothing.
  describe('stockMaterialIssues', () => {
    const LIB = { groups: [], materials: [], presets: [
      { id: 'pre_al', name: 'Al Wrought - 6061+' },
      { id: 'pre_316', name: 'SS Austenitic - 310, 316' },
    ] };

    it('flags a stock material that is not a CAM preset in our library', () => {
      const out = stockMaterialIssues([
        { guid: 'p1', name: 'SS Rough', material_preset_id: 'pre_316', 'stock-materials': ['SS Harder'] },
      ], LIB);
      expect(out).toHaveLength(1);
      expect(out[0].unknown).toEqual(['SS Harder']);
      expect(out[0].expected).toBe('SS Austenitic - 310, 316');   // what its own link implies
    });

    it('passes a stock material that IS one of ours', () => {
      expect(stockMaterialIssues([
        { guid: 'p1', 'stock-materials': ['Al Wrought - 6061+'] },
      ], LIB)).toEqual([]);
    });

    it('says nothing about a preset with no stock material at all', () => {
      // Absent is the normal case (307 of the shop's 359) — never inject one,
      // so it must never be flagged either or the banner becomes wallpaper.
      expect(stockMaterialIssues([{ guid: 'p1', material: { query: 'AL' } }], LIB)).toEqual([]);
      expect(stockMaterialIssues([{ guid: 'p2', 'stock-materials': [] }], LIB)).toEqual([]);
    });

    it('reports only the unknown entries of a multi-value assignment', () => {
      const out = stockMaterialIssues([
        { guid: 'p1', 'stock-materials': ['Al Wrought - 6061+', 'Steel, High-Carbon'] },
      ], LIB);
      expect(out[0].unknown).toEqual(['Steel, High-Carbon']);
    });

    it('is silent when the Materials library has not loaded yet', () => {
      expect(stockMaterialIssues([{ guid: 'p1', 'stock-materials': ['x'] }], { presets: [] })).toEqual([]);
    });

    // Checklist rule: a flag the user cannot clear is a nag loop. This one is
    // especially exposed to it — stock-materials has no field in the preset
    // editor, and the material shown there is already CORRECT, so nothing on
    // screen looks wrong. The banner's one-click fix applies `expected`; that
    // has to actually silence the detector.
    it('stops firing once the row\'s own `expected` is applied', () => {
      const stale = {
        guid: 'p1', name: 'SS Rough', material_preset_id: 'pre_316',
        material: { query: 'SS Austenitic - 310, 316' },
        'stock-materials': ['SS Harder'],
      };
      const [row] = stockMaterialIssues([stale], LIB);
      expect(row.expected).toBe('SS Austenitic - 310, 316');

      // Exactly what MaterialLinkBanner.applyStockFixes writes.
      const fixed = { ...stale, 'stock-materials': [row.expected] };
      expect(stockMaterialIssues([fixed], LIB)).toEqual([]);
      // and it doesn't push the preset into the OTHER flag either
      expect(unresolvedMaterialPresets([fixed], LIB)).toEqual([]);
    });

    it('survives the load backfill — the fix is not undone on the next load', () => {
      // syncPresetMaterialName runs on every load; it must leave a corrected
      // stock-material alone, or the flag would come back by itself.
      const fixed = {
        guid: 'p1', material_preset_id: 'pre_316',
        material: { query: 'SS Austenitic - 310, 316', category: 'metal' },
        'stock-materials': ['SS Austenitic - 310, 316'],
      };
      const reloaded = syncPresetMaterialName(fixed, LIB);
      expect(reloaded['stock-materials']).toEqual(['SS Austenitic - 310, 316']);
      expect(stockMaterialIssues([reloaded], LIB)).toEqual([]);
    });
  });

  it('backfillMaterialPresetIds walks every tool preset', () => {
    const tools = [
      { id: 't1', presets: [{ guid: 'p1', material: { query: 'Al Wrought' } }] },
      { id: 't2', presets: [] },
      { id: 't3' },
    ];
    const out = backfillMaterialPresetIds(tools, MATS);
    expect(out[0].presets[0].material_preset_id).toBe('pre_n_al');
    expect(out[0].presets[0].material.query).toBe('Al Wrought'); // resolved name
    expect(out[1]).toBe(tools[1]); // untouched (no presets)
    expect(out[2]).toBe(tools[2]);
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

  it('uses the holder DESCRIPTION when given one', () => {
    expect(composePresetName({
      materialQuery: 'AL', ooh: 1.5, holderDescription: 'NBT30-SK20C-90', opType: 'finish',
    })).toBe('AL 1.500 NBT30-SK20C-90 - Finish');
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

  it('detects the collapsed one-word SMBORE even next to a finish token (longer alias wins)', () => {
    expect(parsePresetName('AL-SMBORE-FIN').opType).toBe('small_bore');
    expect(parsePresetName('SMBORE FIN').opType).toBe('small_bore');
    expect(parsePresetName('ss sm bore fin').opType).toBe('small_bore');
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

describe('suggestCamPresetName', () => {
  // Mirrors the real seed shapes (materials.json): CAM preset "SS Austenitic 316",
  // and a 316 alloy whose label is "316 / 316L" with aliases like "SS316".
  const materials = {
    groups: [
      { id: 'N', label: 'Non-Ferrous', code: 'AL' },
      { id: 'M', label: 'Stainless Steel', code: 'SS' },
      { id: 'P', label: 'Steel', code: 'STEEL' },
    ],
    presets: [
      { id: 'pre_N_al_wrought', group_id: 'N', name: 'Al Wrought' },
      { id: 'pre_N_al_cast', group_id: 'N', name: 'Al Cast' },
      { id: 'pre_M_aus_304', group_id: 'M', name: 'SS Austenitic 304' },
      { id: 'pre_M_aus_316', group_id: 'M', name: 'SS Austenitic 316' },
      { id: 'pre_P_low_c', group_id: 'P', name: 'Steel Low Carbon' },
      { id: 'pre_P_alloy', group_id: 'P', name: 'Steel Alloy' },
    ],
    materials: [
      { id: 'M_304', group_id: 'M', preset_id: 'pre_M_aus_304', label: '304 / 304L', aliases: ['SS304', '18-8'] },
      { id: 'M_316', group_id: 'M', preset_id: 'pre_M_aus_316', label: '316 / 316L', aliases: ['SS316', '316L', '316 L'] },
      { id: 'N_6061', group_id: 'N', preset_id: 'pre_N_al_wrought', label: '6061', aliases: ['6061-T6'] },
    ],
  };

  it('defaults a bare "AL" to the wrought Al CAM preset', () => {
    expect(suggestCamPresetName('AL', materials)).toBe('Al Wrought');
  });

  it('defaults SS / 316 / "316 SS" to SS Austenitic 316', () => {
    expect(suggestCamPresetName('SS', materials)).toBe('SS Austenitic 316');
    expect(suggestCamPresetName('316', materials)).toBe('SS Austenitic 316');
    expect(suggestCamPresetName('316 SS', materials)).toBe('SS Austenitic 316');
    expect(suggestCamPresetName('SS316', materials)).toBe('SS Austenitic 316');
  });

  it('does NOT map "Steel"/"ST" to stainless — leaves them for the user to pick', () => {
    expect(suggestCamPresetName('Steel', materials)).toBe(null);
    expect(suggestCamPresetName('ST', materials)).toBe(null);
  });

  it('resolves a query that is already a CAM preset name or known alloy', () => {
    expect(suggestCamPresetName('Al Cast', materials)).toBe('Al Cast');
    expect(suggestCamPresetName('316L', materials)).toBe('SS Austenitic 316');
    expect(suggestCamPresetName('6061', materials)).toBe('Al Wrought');
  });

  it('returns null for a blank query', () => {
    expect(suggestCamPresetName('', materials)).toBe(null);
  });
});

describe('composePresetName — Small Bore replaces the operation tail', () => {
  const base = { materialQuery: 'SS', ooh: 2.125, holderShort: '30-SK13-60' };
  it('emits "SM Bore" instead of intensity + op word + strategy', () => {
    expect(composePresetName({ ...base, opType: 'finish', intensityWord: 'Fine', strategyLabel: 'Bore', smallBore: true }))
      .toBe('SS 2.125 30-SK13-60 - SM Bore');
  });
  it('normal (non-small-bore) naming is unchanged', () => {
    expect(composePresetName({ ...base, opType: 'finish', intensityWord: 'Fine', strategyLabel: 'Bore' }))
      .toBe('SS 2.125 30-SK13-60 - Fine Finish Bore');
  });
});

describe('isAutoPresetName — ours (refreshable) vs the user\'s (protected)', () => {
  // The composer's own labels; the real call passes ALL_STRATEGY_LABELS.
  const LABELS = ['Adaptive', 'Facing', '3D', 'Engrave', 'Bore', '2D Contour', '2D Contour + Bore'];
  const auto = (n) => isAutoPresetName(n, LABELS);

  it('recognizes every shape the composer emits', () => {
    expect(auto('SS 2.125 30-SK13-60 - Rough')).toBe(true);
    expect(auto('SS 2.125 30-SK13-60 - Fine Finish 3D')).toBe(true);
    expect(auto('SS 2.125 30-SK13-60 - Fast Rough Adaptive')).toBe(true);
    expect(auto('SS 2.125 30-SK13-60 - Finish 2D Contour + Bore')).toBe(true);
    expect(auto('SS 2.125 30-SK13-60 - SM Bore')).toBe(true);
  });

  it('a STALE auto name is still recognized as ours (so it can self-correct)', () => {
    // Composed under an older material/OOH/strategy — structure still ours.
    expect(auto('AL 3.000 30-SK13-120 - Fast Rough Facing')).toBe(true);
  });

  it('protects names the composer could not have produced', () => {
    expect(auto('SS 2.125 30-SK13-60 - Rough Job 1042')).toBe(false); // extra words
    expect(auto('AL FIN')).toBe(false);                               // legacy, no tail
    expect(auto('Roughing pass for the big fixture')).toBe(false);
    expect(auto('')).toBe(false);
  });
});

describe('unresolvedMaterialPresets — broken material links', () => {
  const MATS = {
    groups: [{ id: 'N', label: 'Non-Ferrous', code: 'AL' }, { id: 'M', label: 'Stainless Steel', code: 'SS' }],
    presets: [{ id: 'pre_al', group_id: 'N', name: 'Aluminum (wrought)' }, { id: 'pre_316', group_id: 'M', name: 'SS Austenitic 316' }],
    materials: [{ id: 'a1', group_id: 'M', preset_id: 'pre_316', label: '316 / 316L', aliases: ['316L', 'SS316'] }],
  };

  it('flags a preset whose CAM preset was renamed before its id was captured', () => {
    // "Al Wrought" was the old name; the library now calls it "Aluminum (wrought)".
    const out = unresolvedMaterialPresets([{ guid: 'p1', name: 'R', material: { query: 'Al Wrought' } }], MATS);
    expect(out).toHaveLength(1);
    expect(out[0].query).toBe('Al Wrought');
    expect(out[0].suggestion).toBe('Aluminum (wrought)');   // confident re-link offered
  });

  it('ignores presets that already carry the CAM-preset id (rename-proof)', () => {
    expect(unresolvedMaterialPresets(
      [{ guid: 'p', material_preset_id: 'pre_al', material: { query: 'anything' } }], MATS)).toEqual([]);
  });

  // SHOP RULE (supersedes the earlier "resolves by name → fine" behaviour): the
  // only thing Fusion can resolve as a material is a CAM preset NAME, so a group
  // label or an alloy name is still an unlinked preset — and one that LOOKS fine
  // on screen, which is exactly why it has to be flagged rather than trusted.
  it('flags a group label — it displays fine but is not a CAM preset', () => {
    const out = unresolvedMaterialPresets([{ guid: 'p', material: { query: 'Non-Ferrous' } }], MATS);
    expect(out).toHaveLength(1);
    expect(out[0].reason).toBe('group');
  });

  it('flags an alloy name, and offers its CAM preset as the fix', () => {
    const out = unresolvedMaterialPresets([{ guid: 'p', material: { query: 'SS316' } }], MATS);
    expect(out).toHaveLength(1);
    expect(out[0].reason).toBe('alloy');
    expect(out[0].suggestion).toBe('SS Austenitic 316');   // confident one-click re-link
  });

  it('marks a string that resolves to nothing as unknown', () => {
    expect(unresolvedMaterialPresets([{ guid: 'p', material: { query: 'Al Wrought' } }], MATS)[0].reason)
      .toBe('unknown');
  });

  it('ignores presets with no material set', () => {
    expect(unresolvedMaterialPresets([{ guid: 'p', material: { query: '' } }, { guid: 'q' }], MATS)).toEqual([]);
  });

  it('is a no-op when the Materials library has not loaded', () => {
    expect(unresolvedMaterialPresets([{ guid: 'p', material: { query: 'x' } }], { presets: [] })).toEqual([]);
  });
});

describe('preset↔assembly link — FK first, name only as legacy seed', () => {
  const asmA = { assembly_id: 'as1', holder_description: 'NBT30-SK13C-60', ooh: 2.125 };
  const asmB = { assembly_id: 'as2', holder_description: 'NBT30-SK13C-90', ooh: 3.0 };
  const assemblies = [asmA, asmB];

  it('resolves by the FK, ignoring what the NAME says', () => {
    // Name still encodes assembly A (the Fusion carrier), but the FK says B.
    const p = { guid: 'p1', name: 'AL 2.125 30-SK13-60 - Rough', assembly_id: 'as2' };
    expect(assemblyForPreset(p, assemblies, 'inches').assembly_id).toBe('as2');
    expect(presetsForAssembly(asmB, [p], 'inches')).toHaveLength(1);
    expect(presetsForAssembly(asmA, [p], 'inches')).toHaveLength(0);
  });

  it('the link SURVIVES an OOH change (the bug that started this)', () => {
    const p = { guid: 'p1', name: 'AL 2.125 30-SK13-60 - Rough', assembly_id: 'as1' };
    const moved = { ...asmA, ooh: 4.5 };   // OOH changed; name not yet recomposed
    expect(assemblyForPreset(p, [moved], 'inches').assembly_id).toBe('as1');
    expect(presetsForAssembly(moved, [p], 'inches')).toHaveLength(1);
  });

  it('falls back to the name only while a preset has no FK (legacy data)', () => {
    const legacy = { guid: 'p2', name: 'AL 3.000 30-SK13-90 - Finish' };
    expect(assemblyForPreset(legacy, assemblies, 'inches').assembly_id).toBe('as2');
  });

  it('backfillPresetAssemblyLinks seeds the FK once from the name match', () => {
    const tools = [{
      id: 't1', unit: 'inches', assemblies,
      presets: [
        { guid: 'p1', name: 'AL 2.125 30-SK13-60 - Rough' },
        { guid: 'p2', name: 'AL 3.000 30-SK13-90 - Finish' },
        { guid: 'p3', name: 'no assembly in this name' },
      ],
    }];
    const out = backfillPresetAssemblyLinks(tools);
    expect(out[0].presets[0].assembly_id).toBe('as1');
    expect(out[0].presets[1].assembly_id).toBe('as2');
    expect(out[0].presets[2].assembly_id).toBeUndefined();  // nothing to seed from
    expect(backfillPresetAssemblyLinks(out)).toBe(out);     // idempotent
  });
});

describe('camPresetIdFromGrade — link by the ALLOY GRADE in the string', () => {
  // Mirrors the shop's real rules: the grade in a legacy string decides the CAM
  // preset, via the alloy's preset_id. Matching never reads a CAM preset NAME,
  // so renaming one ("Al Wrought" → "Al Wrought - 6061+") changes nothing.
  const MATS = {
    groups: [{ id: 'N', label: 'Non-Ferrous', code: 'AL' }, { id: 'M', label: 'Stainless', code: 'SS' }, { id: 'P', label: 'Steel', code: 'ST' }],
    presets: [
      { id: 'p_alw', group_id: 'N', name: 'Al Wrought - 6061+' },      // renamed — must not matter
      { id: 'p_free', group_id: 'M', name: 'SS Free Machining - 303, 416' },
      { id: 'p_316', group_id: 'M', name: 'SS Austenitic - 310, 316' },
      { id: 'p_304', group_id: 'M', name: 'SS Austenitic - 304' },
      { id: 'p_ph', group_id: 'M', name: 'SS PH - 17-4, 15-5' },
      { id: 'p_low', group_id: 'P', name: 'Steel Low Carbon - 1018' },
    ],
    materials: [
      { id: 'a1', group_id: 'N', preset_id: 'p_alw', label: '6061', aliases: ['6061-T6'] },
      { id: 'a2', group_id: 'M', preset_id: 'p_free', label: '303', aliases: [] },
      { id: 'a3', group_id: 'M', preset_id: 'p_free', label: '416', aliases: [] },
      { id: 'a4', group_id: 'M', preset_id: 'p_316', label: '316 / 316L', aliases: ['SS316'] },
      { id: 'a5', group_id: 'M', preset_id: 'p_316', label: '310', aliases: [] },
      { id: 'a6', group_id: 'M', preset_id: 'p_304', label: '304', aliases: [] },
      { id: 'a7', group_id: 'M', preset_id: 'p_ph', label: '17-4', aliases: ['15-5'] },
      { id: 'a8', group_id: 'P', preset_id: 'p_low', label: '1018', aliases: [] },
    ],
  };
  const g = (q) => camPresetIdFromGrade(q, MATS);

  it('applies the shop rules regardless of surrounding text or separators', () => {
    expect(g('AL 6061')).toBe('p_alw');
    expect(g('AL6061')).toBe('p_alw');       // no separator
    expect(g('6061-T6 FIN')).toBe('p_alw');
    expect(g('SS 416 FIN')).toBe('p_free');
    expect(g('303/416')).toBe('p_free');
    expect(g('310')).toBe('p_316');
    expect(g('SS316 ROUGH')).toBe('p_316');
    expect(g('304 SS')).toBe('p_304');
    expect(g('17-4 PH')).toBe('p_ph');        // hyphenated grade
    expect(g('15-5')).toBe('p_ph');
    expect(g('1018 STEEL')).toBe('p_low');
  });

  it('refuses to guess when the string carries NO grade', () => {
    for (const q of ['AL FIN', 'SS', 'BRZ ROUGH', 'ST', 'CI', '']) expect(g(q)).toBe(null);
  });

  it('does not match a grade inside a longer number', () => {
    expect(g('3160')).toBe(null);
    expect(g('60610')).toBe(null);
  });

  it('a longer grade is tried first (17-4 is not read as bare 17)', () => {
    // Longest-first ordering matters where a short grade is a prefix of a long
    // one. When two alloys legitimately share a grade token the library itself
    // is ambiguous — that's a Materials-editor question, not a matcher one.
    expect(camPresetIdFromGrade('17-4', MATS)).toBe('p_ph');
    expect(camPresetIdFromGrade('SS 15-5 FIN', MATS)).toBe('p_ph');
  });

  it('autoLinkMaterialByGrade stamps the FK only where a grade is found', () => {
    const tools = [{ id: 't1', presets: [
      { guid: 'p1', material: { query: 'SS316 FIN' } },   // grade → linked
      { guid: 'p2', material: { query: 'AL FIN' } },      // no grade → left for the user
      { guid: 'p3', material: { query: '6061' }, material_preset_id: 'already' }, // untouched
    ] }];
    const out = autoLinkMaterialByGrade(tools, MATS);
    expect(out[0].presets[0].material_preset_id).toBe('p_316');
    expect(out[0].presets[1].material_preset_id).toBeUndefined();
    expect(out[0].presets[2].material_preset_id).toBe('already');
    expect(autoLinkMaterialByGrade(out, MATS)).toBe(out);   // idempotent
  });
});

describe('material auto-link — stability once linked', () => {
  const M = {
    groups: [{ id: 'M', label: 'Stainless', code: 'SS' }],
    presets: [{ id: 'p_316', group_id: 'M', name: 'SS Austenitic - 310, 316' },
              { id: 'p_ph', group_id: 'M', name: 'SS PH - 17-4, 15-5' }],
    materials: [
      { id: 'a4', group_id: 'M', preset_id: 'p_316', label: '316 / 316L', aliases: ['SS316', '316L'] },
      { id: 'a5', group_id: 'M', preset_id: 'p_316', label: '310', aliases: [] },
      { id: 'a7', group_id: 'M', preset_id: 'p_ph', label: '17-4', aliases: ['15-5'] },
    ],
  };

  it('316 and 316L resolve to the SAME CAM preset (they cut the same)', () => {
    const ids = ['316', '316L', 'SS316', 'SS 316L FIN', '316 / 316L']
      .map(q => camPresetIdFromGrade(q, M));
    expect(new Set(ids)).toEqual(new Set(['p_316']));
    expect(camPresetIdFromGrade('310 ROUGH', M)).toBe('p_316');   // 310 groups with 316
  });

  it('a preset already linked to a valid key is NEVER re-matched', () => {
    // The FK wins outright: even a string whose grade points elsewhere must not
    // override a deliberate link (e.g. the user re-picked the material by hand).
    const tools = [{ id: 't', presets: [
      { guid: 'a', material: { query: 'SS316 FIN' }, material_preset_id: 'p_ph' },
    ] }];
    const out = autoLinkMaterialByGrade(tools, M);
    expect(out).toBe(tools);                                   // untouched reference
    expect(out[0].presets[0].material_preset_id).toBe('p_ph'); // deliberate link kept
  });

  it('is stable across repeated loads (no churn once everything is linked)', () => {
    const tools = [{ id: 't', presets: [{ guid: 'a', material: { query: 'SS316 FIN' } }] }];
    const once = autoLinkMaterialByGrade(tools, M);
    expect(once[0].presets[0].material_preset_id).toBe('p_316');
    expect(autoLinkMaterialByGrade(once, M)).toBe(once);        // second pass: no-op
    expect(autoLinkMaterialByGrade(once, M)).toBe(once);        // and again
  });
});

describe('bare material codes — the shop\'s one-per-code default', () => {
  // A string with no grade ("AL FIN", "SS") is a judgement call the matcher
  // deliberately refuses. These helpers surface those in the normalize flow so
  // the shop declares its standard once per code instead of per preset.
  const M = {
    groups: [{ id: 'N', label: 'Non-Ferrous', code: 'AL' }, { id: 'M', label: 'Stainless', code: 'SS' }],
    presets: [{ id: 'p_alw', group_id: 'N', name: 'Al Wrought - 6061+' },
              { id: 'p_316', group_id: 'M', name: 'SS Austenitic - 310, 316' }],
    materials: [{ id: 'a1', group_id: 'N', preset_id: 'p_alw', label: '6061', aliases: [] },
                { id: 'a4', group_id: 'M', preset_id: 'p_316', label: '316 / 316L', aliases: ['SS316'] }],
  };

  it('reads the broad code out of a gradeless legacy string', () => {
    expect(bareMaterialCode('AL FIN', M)).toBe('AL');
    expect(bareMaterialCode('AL', M)).toBe('AL');
    expect(bareMaterialCode('SS', M)).toBe('SS');
    expect(bareMaterialCode('ST', M)).toBe('STEEL');
    expect(bareMaterialCode('BRZ ROUGH', M)).toBe('BRONZE');
  });

  it('returns null when the matcher can already resolve it (nothing to ask)', () => {
    expect(bareMaterialCode('SS316 FIN', M)).toBe(null);      // grade → auto-linked
    expect(bareMaterialCode('6061', M)).toBe(null);           // grade → auto-linked
    expect(bareMaterialCode('Al Wrought - 6061+', M)).toBe(null); // a real CAM preset name
    expect(bareMaterialCode('Non-Ferrous', M)).toBe(null);    // a real group label
    expect(bareMaterialCode('', M)).toBe(null);
  });

  it('groups the presets needing a decision, skipping ones already linked', () => {
    const presets = [
      { guid: 'p1', material: { query: 'AL FIN' } },
      { guid: 'p2', material: { query: 'AL ROUGH' } },
      { guid: 'p3', material: { query: 'SS' } },
      { guid: 'p4', material: { query: 'SS316 FIN' } },                       // grade → not asked
      { guid: 'p5', material: { query: 'AL' }, material_preset_id: 'p_alw' },  // linked → not asked
    ];
    const g = bareCodeGroups(presets, M);
    expect([...g.keys()].sort()).toEqual(['AL', 'SS']);
    expect(g.get('AL').map(p => p.guid)).toEqual(['p1', 'p2']);
    expect(g.get('SS')).toHaveLength(1);
  });
});
