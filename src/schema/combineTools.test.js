import { describe, it, expect } from 'vitest';
import { combineToolsByProshopId } from './toolSchema.js';

// Minimal logical-tool shape that satisfies mergeLogicalTools' expectations.
function makeTool(overrides = {}) {
  return {
    id: overrides.id || 'some-guid',
    tracking_id: overrides.tracking_id ?? null,
    proshot_id: overrides.proshot_id || 'A-1',
    no_fusion_link: overrides.no_fusion_link ?? false,
    assemblies: overrides.assemblies || [],
    presets: overrides.presets || [],
    merge_history: [],
    _instancesRaw: overrides._instancesRaw || [],
    _fusionRaw: overrides._fusionRaw || null,
    _registeredAssemblies: [],
    ...overrides,
  };
}

describe('combineToolsByProshopId — gap-fill', () => {
  it('fills empty geometry from the non-primary (Fusion) tool', () => {
    const placeholder = makeTool({
      id: 'FTL-000001',
      tracking_id: 'FTL-000001',
      proshot_id: 'A-1',
      no_fusion_link: true,
      diameter: 0.5,
      overall_length: 2.5,
      corner_radius: null,   // placeholder has no corner radius
      taper_angle: null,
      _fusionRaw: { guid: 'guid-placeholder' },
    });
    const fusionEntry = makeTool({
      id: 'guid-fusion',
      tracking_id: null,
      proshot_id: 'A-1',
      no_fusion_link: false,
      diameter: 0.5,
      overall_length: 2.5,
      corner_radius: 0.0625,  // real geometry from Fusion
      taper_angle: 0,
      _fusionRaw: { guid: 'guid-fusion' },
    });

    const [result] = combineToolsByProshopId([placeholder, fusionEntry]);

    // Tracking ID (and metadata) from the primary (placeholder) survive.
    expect(result.tracking_id).toBe('FTL-000001');
    // Gap-filled from Fusion entry.
    expect(result.corner_radius).toBe(0.0625);
    // No genuine conflicts.
    expect(result._combineConflicts).toBeUndefined();
  });

  it('clears no_fusion_link when any tool in the group is a real Fusion entry', () => {
    const placeholder = makeTool({ tracking_id: 'FTL-000002', no_fusion_link: true });
    const real = makeTool({ tracking_id: null, no_fusion_link: false });

    const [result] = combineToolsByProshopId([placeholder, real]);
    expect(result.no_fusion_link).toBe(false);
  });

  it('keeps no_fusion_link true when all tools are placeholders', () => {
    const a = makeTool({ id: 'FTL-A', tracking_id: 'FTL-A', no_fusion_link: true });
    const b = makeTool({ id: 'guid-B', tracking_id: null, no_fusion_link: true });

    const [result] = combineToolsByProshopId([a, b]);
    expect(result.no_fusion_link).toBe(true);
  });
});

describe('combineToolsByProshopId — conflict detection', () => {
  it('records _combineConflicts when both tools have different non-empty values', () => {
    const primary = makeTool({
      id: 'FTL-000003',
      tracking_id: 'FTL-000003',
      proshot_id: 'B-1',
      description: 'Original Description',
      _fusionRaw: { guid: 'guid-primary' },
    });
    const other = makeTool({
      id: 'guid-other',
      tracking_id: null,
      proshot_id: 'B-1',
      description: 'Different Description',
      _fusionRaw: { guid: 'guid-other' },
    });

    const [result] = combineToolsByProshopId([primary, other]);

    // Primary value is kept.
    expect(result.description).toBe('Original Description');
    // Conflict is recorded.
    expect(result._combineConflicts).toBeDefined();
    const conflict = result._combineConflicts.find(c => c.field === 'description');
    expect(conflict).toBeDefined();
    expect(conflict.values).toEqual(['Original Description', 'Different Description']);
    expect(conflict.guids).toContain('guid-primary');
    expect(conflict.guids).toContain('guid-other');
  });

  it('does not flag a conflict when numeric values are within round4 tolerance', () => {
    const primary = makeTool({
      tracking_id: 'FTL-000004', proshot_id: 'C-1',
      diameter: 0.500049,  // rounds to 0.5 at 4dp
    });
    const other = makeTool({
      tracking_id: null, proshot_id: 'C-1',
      diameter: 0.499951,  // also rounds to 0.5 at 4dp
    });

    const [result] = combineToolsByProshopId([primary, other]);
    const conflict = result._combineConflicts?.find(c => c.field === 'diameter');
    expect(conflict).toBeUndefined();
  });

  it('does not flag false conflicts when one side is empty', () => {
    const primary = makeTool({ tracking_id: 'FTL-000005', proshot_id: 'D-1', coating: null });
    const other = makeTool({ tracking_id: null, proshot_id: 'D-1', coating: 'AlTiN' });

    const [result] = combineToolsByProshopId([primary, other]);
    // Should gap-fill, not conflict.
    expect(result.coating).toBe('AlTiN');
    expect(result._combineConflicts?.find(c => c.field === 'coating')).toBeUndefined();
  });
});

describe('combineToolsByProshopId — no grouping without proshot_id', () => {
  it('leaves tools without a proshot_id as separate entries', () => {
    const a = makeTool({ id: 'A', tracking_id: 'FTL-A', proshot_id: '' });
    const b = makeTool({ id: 'B', tracking_id: 'FTL-B', proshot_id: '' });

    const result = combineToolsByProshopId([a, b]);
    expect(result).toHaveLength(2);
  });
});
