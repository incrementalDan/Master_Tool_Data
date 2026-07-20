import { describe, it, expect } from 'vitest';
import { combineToolsByToolId, findNoFusionMergeCandidates, mergeNoFusionIntoFusion, findProShopSiblings, duplicateIdClusters } from './toolSchema.js';

// Minimal logical-tool shape that satisfies mergeLogicalTools' expectations.
function makeTool(overrides = {}) {
  return {
    id: overrides.id || 'some-guid',
    tracking_id: overrides.tracking_id ?? null,
    tool_id: overrides.tool_id || 'A-1',
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

describe('combineToolsByToolId — gap-fill', () => {
  it('fills empty geometry from the non-primary (Fusion) tool', () => {
    const placeholder = makeTool({
      id: 'FTL-000001',
      tracking_id: 'FTL-000001',
      tool_id: 'A-1',
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
      tool_id: 'A-1',
      no_fusion_link: false,
      diameter: 0.5,
      overall_length: 2.5,
      corner_radius: 0.0625,  // real geometry from Fusion
      taper_angle: 0,
      _fusionRaw: { guid: 'guid-fusion' },
    });

    const [result] = combineToolsByToolId([placeholder, fusionEntry]);

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

    const [result] = combineToolsByToolId([placeholder, real]);
    expect(result.no_fusion_link).toBe(false);
  });

  it('keeps no_fusion_link true when all tools are placeholders', () => {
    const a = makeTool({ id: 'FTL-A', tracking_id: 'FTL-A', no_fusion_link: true });
    const b = makeTool({ id: 'guid-B', tracking_id: null, no_fusion_link: true });

    const [result] = combineToolsByToolId([a, b]);
    expect(result.no_fusion_link).toBe(true);
  });
});

describe('combineToolsByToolId — conflict detection', () => {
  it('records _combineConflicts when both tools have different non-empty values', () => {
    const primary = makeTool({
      id: 'FTL-000003',
      tracking_id: 'FTL-000003',
      tool_id: 'B-1',
      diameter: 0.5,
      _fusionRaw: { guid: 'guid-primary' },
    });
    const other = makeTool({
      id: 'guid-other',
      tracking_id: null,
      tool_id: 'B-1',
      diameter: 0.375,
      _fusionRaw: { guid: 'guid-other' },
    });

    const [result] = combineToolsByToolId([primary, other]);

    // Primary value is kept.
    expect(result.diameter).toBe(0.5);
    // Conflict is recorded for the genuinely-shared Fusion-native field.
    expect(result._combineConflicts).toBeDefined();
    const conflict = result._combineConflicts.find(c => c.field === 'diameter');
    expect(conflict).toBeDefined();
    expect(conflict.values).toEqual([0.5, 0.375]);
    expect(conflict.guids).toContain('guid-primary');
    expect(conflict.guids).toContain('guid-other');
  });

  it('does NOT flag loosely-controlled fields — description keeps primary, OAL takes biggest, shoulder takes smallest', () => {
    const primary = makeTool({
      tracking_id: 'FTL-00A001', tool_id: 'BR-1',
      description: 'Original', overall_length: 3.0, shoulder_length: 1.5,
      custom_grind: false,
    });
    const other = makeTool({
      tracking_id: null, tool_id: 'BR-1',
      description: 'Original (copy)', overall_length: 3.5, shoulder_length: 1.2,
      custom_grind: '-',
    });

    const [result] = combineToolsByToolId([primary, other]);

    expect(result.description).toBe('Original');        // keep primary — not a conflict
    expect(result.overall_length).toBe(3.5);            // biggest wins
    expect(result.shoulder_length).toBe(1.2);           // smallest wins
    // None of these — nor the metadata-only custom_grind — record a conflict.
    for (const f of ['description', 'overall_length', 'shoulder_length', 'custom_grind']) {
      expect(result._combineConflicts?.find(c => c.field === f)).toBeUndefined();
    }
  });

  it('does not flag a conflict when numeric values are within round4 tolerance', () => {
    const primary = makeTool({
      tracking_id: 'FTL-000004', tool_id: 'C-1',
      diameter: 0.500049,  // rounds to 0.5 at 4dp
    });
    const other = makeTool({
      tracking_id: null, tool_id: 'C-1',
      diameter: 0.499951,  // also rounds to 0.5 at 4dp
    });

    const [result] = combineToolsByToolId([primary, other]);
    const conflict = result._combineConflicts?.find(c => c.field === 'diameter');
    expect(conflict).toBeUndefined();
  });

  it('does not flag false conflicts when one side is empty', () => {
    const primary = makeTool({ tracking_id: 'FTL-000005', tool_id: 'D-1', coating: null });
    const other = makeTool({ tracking_id: null, tool_id: 'D-1', coating: 'AlTiN' });

    const [result] = combineToolsByToolId([primary, other]);
    // Should gap-fill, not conflict.
    expect(result.coating).toBe('AlTiN');
    expect(result._combineConflicts?.find(c => c.field === 'coating')).toBeUndefined();
  });
});

describe('combineToolsByToolId — no grouping without tool_id', () => {
  it('leaves tools without a tool_id as separate entries', () => {
    const a = makeTool({ id: 'A', tracking_id: 'FTL-A', tool_id: '' });
    const b = makeTool({ id: 'B', tracking_id: 'FTL-B', tool_id: '' });

    const result = combineToolsByToolId([a, b]);
    expect(result).toHaveLength(2);
  });
});

describe('findNoFusionMergeCandidates — new Fusion tool matching a no-Fusion tool', () => {
  const proShopOnly = () => makeTool({
    id: 'FTL-PSONLY', tracking_id: 'FTL-PSONLY', tool_id: 'A-7',
    no_fusion_link: true, tool_type: 'flat end mill',
    diameter: 0.25, flute_length: 0.75,
  });
  // A freshly-uploaded, not-yet-normalized Fusion tool has NO tracking id.
  const fusionUpload = (extra = {}) => makeTool({
    id: 'guid-fusion', tracking_id: null, tool_id: 'A-7',
    no_fusion_link: false, tool_type: 'flat end mill',
    diameter: 0.25, flute_length: 0.75, library_id: 'lib-1',
    ...extra,
  });

  it('pairs an untracked Fusion tool with the no-Fusion tool of the same ProShop #', () => {
    const cands = findNoFusionMergeCandidates([proShopOnly(), fusionUpload()]);
    expect(cands).toHaveLength(1);
    expect(cands[0].toolId).toBe('A-7');
    expect(cands[0].fusionTool.tracking_id).toBeNull();
    expect(cands[0].existingTool.tracking_id).toBe('FTL-PSONLY');
    expect(cands[0].conflicts).toHaveLength(0);   // specs agree
  });

  it('matches ProShop #s case/dash/space-insensitively and reports differing specs', () => {
    const cands = findNoFusionMergeCandidates([
      proShopOnly(),
      fusionUpload({ tool_id: 'a 7', diameter: 0.2505 }),   // "a 7" == "A-7", diameter differs
    ]);
    expect(cands).toHaveLength(1);
    const conflict = cands[0].conflicts.find(c => c.field === 'diameter');
    expect(conflict).toBeDefined();
    expect(conflict.fusion).toBe(0.2505);
    expect(conflict.existing).toBe(0.25);
  });

  it('ignores an already-tracked Fusion tool (only NEW uploads are candidates)', () => {
    const tracked = fusionUpload({ tracking_id: 'FTL-FUSION' });
    expect(findNoFusionMergeCandidates([proShopOnly(), tracked])).toHaveLength(0);
  });

  it('no candidate when there is no matching no-Fusion tool', () => {
    expect(findNoFusionMergeCandidates([fusionUpload()])).toHaveLength(0);
  });
});

// ─── Regression guard for the original bug ─────────────────────────────────────
// Reported bug: a ProShop tool with no Fusion entry was imported (a no-Fusion
// tool), then the same tool was uploaded into the Fusion library and normalized
// under its OWN tracking ID. The app left TWO separate entries with the same
// ProShop number and no way to notice or reconcile them. These assert the two
// detectors that must keep surfacing that situation — a future refactor that
// silently drops either one fails here.
describe('REGRESSION: a no-Fusion and a Fusion tool sharing a ProShop # must never silently coexist', () => {
  // The two records exactly as they exist post-bug: a normalized Fusion tool and a
  // no-Fusion tool, DIFFERENT tracking IDs, SAME ProShop number.
  const fusionTool = (o = {}) => makeTool({
    id: 'FTL-FUSION', tracking_id: 'FTL-FUSION', tool_id: 'A-7',
    no_fusion_link: false, library_id: 'lib-1', tool_type: 'flat end mill', diameter: 0.25, ...o,
  });
  const noFusionTool = (o = {}) => makeTool({
    id: 'FTL-PSONLY', tracking_id: 'FTL-PSONLY', tool_id: 'A-7',
    no_fusion_link: true, library_id: null, tool_type: 'flat end mill', diameter: 0.25, ...o,
  });

  it('the tool page surfaces the duplicate from EITHER tool (findProShopSiblings)', () => {
    const tools = [fusionTool(), noFusionTool()];
    // From the Fusion tool → sees the no-Fusion one.
    expect(findProShopSiblings(tools[0], tools).map(t => t.id)).toEqual(['FTL-PSONLY']);
    // From the no-Fusion tool → sees the Fusion one.
    expect(findProShopSiblings(tools[1], tools).map(t => t.id)).toEqual(['FTL-FUSION']);
  });

  it('a bare ProShop-number difference (dash/space/case) still matches — not a silent miss', () => {
    const tools = [fusionTool(), noFusionTool({ tool_id: 'a 7' })];
    expect(findProShopSiblings(tools[0], tools)).toHaveLength(1);
  });

  it('a NEW (not-yet-normalized) Fusion upload is caught at normalize time too', () => {
    // Same scenario one step earlier: the Fusion tool is still untracked.
    const untracked = makeTool({ id: 'g', tracking_id: null, tool_id: 'A-7', no_fusion_link: false, tool_type: 'flat end mill', diameter: 0.25 });
    const cands = findNoFusionMergeCandidates([noFusionTool(), untracked]);
    expect(cands).toHaveLength(1);
    expect(cands[0].existingTool.id).toBe('FTL-PSONLY');
  });

  it('does NOT flag two ordinary tools with different ProShop numbers', () => {
    const tools = [fusionTool(), noFusionTool({ id: 'FTL-OTHER', tracking_id: 'FTL-OTHER', tool_id: 'B-9' })];
    expect(findProShopSiblings(tools[0], tools)).toHaveLength(0);
  });

  it('does NOT auto-offer when both are linked to different Fusion libraries (routing)', () => {
    const a = fusionTool();
    const b = makeTool({ id: 'FTL-OTHERLIB', tracking_id: 'FTL-OTHERLIB', tool_id: 'A-7', library_id: 'lib-2' });
    expect(findProShopSiblings(a, [a, b])).toHaveLength(0);
  });
});

describe('mergeNoFusionIntoFusion', () => {
  it('keeps the Fusion tool primary, gap-fills ProShop data, flags spec conflicts', () => {
    // Caller has already stamped the Fusion tool with the no-Fusion tracking id.
    const fusionTool = makeTool({
      id: 'FTL-PSONLY', tracking_id: 'FTL-PSONLY', tool_id: 'A-7',
      no_fusion_link: false, library_id: 'lib-1',
      diameter: 0.2505,                 // real Fusion geometry
      vendor: '', min_ooh: null,
      _fusionRaw: { guid: 'guid-fusion' },
    });
    const noFusionTool = makeTool({
      id: 'FTL-PSONLY', tracking_id: 'FTL-PSONLY', tool_id: 'A-7',
      no_fusion_link: true,
      diameter: 0.25,                   // ProShop geometry (slightly off)
      vendor: 'Helical', min_ooh: 0.75,
    });

    const merged = mergeNoFusionIntoFusion(fusionTool, noFusionTool);
    // Fusion tool primary → its geometry + tracking id survive; now linked.
    expect(merged.tracking_id).toBe('FTL-PSONLY');
    expect(merged.diameter).toBe(0.2505);
    expect(merged.no_fusion_link).toBe(false);
    // ProShop-only fields gap-fill.
    expect(merged.vendor).toBe('Helical');
    expect(merged.min_ooh).toBe(0.75);
    // The slight geometry disagreement is flagged for the user to resolve.
    const conflict = merged._combineConflicts?.find(c => c.field === 'diameter');
    expect(conflict).toBeDefined();
    expect(conflict.values).toEqual([0.2505, 0.25]);
  });
});

describe('duplicateIdClusters', () => {
  let n = 0;
  const raw = (comment) => ({ guid: `g-${n++}`, 'post-process': { comment } });

  it('flags a combined tool whose instances span multiple tracking IDs', () => {
    const tools = [
      { tool_id: 'A-3', description: 'dup', _instancesRaw: [raw('FTL-000001'), raw('FTL-000002')] },
      { tool_id: 'B-1', description: 'single', _instancesRaw: [raw('FTL-000003')] },
    ];
    const clusters = duplicateIdClusters(tools);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ tool_id: 'A-3', count: 2 });
  });

  it('does not flag a multi-assembly tool under ONE tracking ID', () => {
    const tools = [
      { tool_id: 'C-1', description: 'multi-asm', _instancesRaw: [raw('FTL-000004'), raw('FTL-000004')] },
    ];
    expect(duplicateIdClusters(tools)).toHaveLength(0);
  });
});
