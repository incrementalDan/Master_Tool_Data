import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import {
  STRATEGIES, strategyById, strategiesForToolType,
  isNewFormatPreset, readStrategyBucket, buildStrategies, writeBucketStrategies, SMALL_BORE_STRATEGIES,
  individualStrategyIds, presetStrategyLabel, QUICK_GROUPS,
} from './camStrategies.js';

const here = dirname(fileURLToPath(import.meta.url));
const refPath = resolve(here, '../../FUSION TOOL Library REF/NewPresetREF/ALL MILLING STRATEGIES Preset only.json');

describe('camStrategies — IDs verified against real Fusion export', () => {
  it('every ID in the ALL MILLING STRATEGIES reference exists in STRATEGIES', () => {
    const ref = JSON.parse(readFileSync(refPath, 'utf8'));
    const ids = ref.presets[0].strategies.roughing;
    expect(ids.length).toBe(46);
    const known = new Set(STRATEGIES.map(s => s.id));
    const missing = ids.filter(id => !known.has(id));
    expect(missing).toEqual([]);
  });

  it('reference roughing and finishing arrays are identical (ALL preset)', () => {
    const ref = JSON.parse(readFileSync(refPath, 'utf8'));
    const { roughing, finishing } = ref.presets[0].strategies;
    expect(finishing).toEqual(roughing);
  });

  it('has no duplicate IDs', () => {
    const seen = new Set();
    for (const s of STRATEGIES) {
      expect(seen.has(s.id), `dup ${s.id}`).toBe(false);
      seen.add(s.id);
    }
  });

  it('chamfer-only strategies show only for chamfer mills', () => {
    const forEndMill = strategiesForToolType('flat end mill').map(s => s.id);
    const forChamfer = strategiesForToolType('chamfer mill').map(s => s.id);
    expect(forEndMill).not.toContain('chamfer2d');
    expect(forEndMill).not.toContain('engrave');
    expect(forChamfer).toContain('chamfer2d');
    expect(forChamfer).toContain('engrave');
  });

  it('non-obvious name↔ID mappings hold (regression guard)', () => {
    expect(strategyById('path3d').name).toBe('Trace');
    expect(strategyById('inclined_walls').name).toBe('Wall');
    expect(strategyById('rest_finishing').name).toBe('Corner');
    expect(strategyById('rotary_finishing').name).toBe('Rotary Parallel');
    expect(strategyById('moduleworks_4axis_finishing').name).toBe('Rotary Contour');
    expect(strategyById('swarf5d').name).toBe('Swarf');
  });

  it('SMALL_BORE_STRATEGIES are all real IDs', () => {
    for (const id of SMALL_BORE_STRATEGIES) expect(strategyById(id)).toBeTruthy();
  });
});

describe('camStrategies — format detection and read/write', () => {
  it('detects new vs old format', () => {
    expect(isNewFormatPreset({ strategies: { roughing: ['adaptive'], finishing: [] } })).toBe(true);
    expect(isNewFormatPreset({ strategies: { finishing: ['bore'] } })).toBe(true);
    expect(isNewFormatPreset({ name: 'SS Rough' })).toBe(false);
    expect(isNewFormatPreset({})).toBe(false);
  });

  it('reads the single populated bucket', () => {
    expect(readStrategyBucket({ strategies: { roughing: ['adaptive2d', 'adaptive'], finishing: [] } }))
      .toEqual({ bucket: 'roughing', ids: ['adaptive2d', 'adaptive'] });
    expect(readStrategyBucket({ strategies: { roughing: [], finishing: ['bore'] } }))
      .toEqual({ bucket: 'finishing', ids: ['bore'] });
  });

  it('builds a Fusion strategies object with the other bucket empty', () => {
    expect(buildStrategies('roughing', ['adaptive2d', 'adaptive', 'adaptive2d']))
      .toEqual({ roughing: ['adaptive2d', 'adaptive'], finishing: [] });
    expect(buildStrategies('finishing', ['bore']))
      .toEqual({ roughing: [], finishing: ['bore'] });
  });
});

describe('camStrategies — writeBucketStrategies preserves the non-active bucket', () => {
  it('normal single-bucket preset empties the other bucket', () => {
    expect(writeBucketStrategies('roughing', ['adaptive'], { roughing: [], finishing: [] }, false))
      .toEqual({ roughing: ['adaptive'], finishing: [] });
  });

  it('dual-bucket preset keeps the OTHER bucket when editing one', () => {
    // Editing the roughing bucket must not wipe the finishing strategies Fusion had.
    const current = { roughing: ['adaptive', 'bore'], finishing: ['contour_new', 'scallop_new'] };
    expect(writeBucketStrategies('roughing', ['adaptive', 'bore', 'flat'], current, true))
      .toEqual({ roughing: ['adaptive', 'bore', 'flat'], finishing: ['contour_new', 'scallop_new'] });
    // …and vice versa.
    expect(writeBucketStrategies('finishing', ['contour_new'], current, true))
      .toEqual({ roughing: ['adaptive', 'bore'], finishing: ['contour_new'] });
  });

  it('dual-bucket write dedupes the active selection', () => {
    expect(writeBucketStrategies('roughing', ['adaptive', 'adaptive'], { roughing: [], finishing: ['bore'] }, true))
      .toEqual({ roughing: ['adaptive'], finishing: ['bore'] });
  });
});

describe('individualStrategyIds — a copied group stays group-switchable', () => {
  const adaptive = QUICK_GROUPS.find(g => g.key === 'adaptive').members; // ['adaptive2d','adaptive']

  it('returns nothing when the selection is exactly a quick group (group-derived, not sticky)', () => {
    expect(individualStrategyIds(adaptive)).toEqual([]);
  });

  it('keeps only the off-group picks as individual', () => {
    const out = individualStrategyIds([...adaptive, 'engrave']); // engrave alone isn't a full group
    expect(out).toEqual(['engrave']);
  });

  it('treats a selection that matches no full group as all-individual (Fusion off-group picks preserved)', () => {
    expect(individualStrategyIds(['engrave']).sort()).toEqual(['engrave']); // Engrave needs engrave+project
    expect(individualStrategyIds(['bore', 'contour2d']).sort()).toEqual(['bore', 'contour2d']);
  });

  it('handles empty / nullish input', () => {
    expect(individualStrategyIds([])).toEqual([]);
    expect(individualStrategyIds(null)).toEqual([]);
  });
});

describe('presetStrategyLabel — short, sensible name suffix', () => {
  it('names an exact quick group by its short token', () => {
    expect(presetStrategyLabel(['adaptive2d', 'adaptive'])).toBe('Adaptive');
    // finish3d group → "3D" (the bucket word disambiguates Rough/Finish)
    const finish3d = QUICK_GROUPS.find(g => g.key === 'finish3d').members;
    expect(presetStrategyLabel(finish3d)).toBe('3D');
  });

  it('names a single strategy', () => {
    expect(presetStrategyLabel(['bore'])).toBe('Bore');
    expect(presetStrategyLabel(['contour2d'])).toBe('2D Contour');
  });

  it('names the two pinned picks together, in stable order', () => {
    expect(presetStrategyLabel(['bore', 'contour2d'])).toBe('2D Contour + Bore');
    expect(presetStrategyLabel(['contour2d', 'bore'])).toBe('2D Contour + Bore');
  });

  it('adds nothing for 2+ arbitrary strategies (avoid a mega name)', () => {
    expect(presetStrategyLabel(['bore', 'contour2d', 'pocket2d'])).toBe(null); // 3
    expect(presetStrategyLabel(['pocket2d', 'slot'])).toBe(null);              // 2 non-pinned
    expect(presetStrategyLabel([])).toBe(null);
    expect(presetStrategyLabel(null)).toBe(null);
  });
});
