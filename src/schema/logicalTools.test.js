import { describe, it, expect } from 'vitest';
import { buildLogicalTool, splitToFusionInstances, overlayPresets } from './logicalTools.js';

// Minimal raw Fusion instance. Per-instance: guid, holder, OOH (LB). Shared:
// tracking-id comment, product-id, geometry, presets.
const rawInstance = ({
  guid, tracking = 'FTL-AAAAAA', productId = 'A-1', lb = 2.0,
  holderGuid = 'H1', presets = [],
} = {}) => ({
  guid,
  type: 'flat end mill',
  unit: 'inches',
  description: '1/2 4FL EM',
  'product-id': productId,
  'post-process': { comment: tracking, number: null },
  BMC: 'carbide',
  geometry: { DC: 0.5, LCF: 1, OAL: 3, NOF: 4, LB: lb },
  holder: { guid: holderGuid, description: 'BT30 ER16 2.5' },
  'start-values': { presets },
});

describe('buildLogicalTool — preset union across instances', () => {
  it('collapses identical presets and keeps a same-name-different-value one, indexed up', () => {
    const a = rawInstance({ guid: 'g1', lb: 2.0, holderGuid: 'H1', presets: [{ name: 'Rough', n: 8000, v_f: 40 }] });
    const b = rawInstance({ guid: 'g2', lb: 2.75, holderGuid: 'H2', presets: [{ name: 'Rough', n: 9000, v_f: 40 }] });
    const tool = buildLogicalTool([a, b]);
    // One assembly per instance.
    expect(tool.assemblies).toHaveLength(2);
    // Presets unioned: the two "Rough" differ beyond tolerance → both kept, indexed.
    const names = tool.presets.map(p => p.name).sort();
    expect(names).toEqual(['Rough', 'Rough 2']);
  });

  it('a well-formed tool (identical presets on every instance) is a no-op union', () => {
    const a = rawInstance({ guid: 'g1', holderGuid: 'H1', presets: [{ name: 'Rough', n: 8000 }] });
    const b = rawInstance({ guid: 'g2', holderGuid: 'H2', presets: [{ name: 'Rough', n: 8000 }] });
    const tool = buildLogicalTool([a, b]);
    expect(tool.presets).toHaveLength(1);
    expect(tool._duplicatePresets).toBeUndefined(); // no real duplicates → no banner
  });
});

describe('buildLogicalTool — duplicate-preset banner flag (_duplicatePresets)', () => {
  it('flags differently-named same-value presets folded across assemblies', () => {
    // Each assembly instance carried a preset named for its own OOH but identical
    // values — the real duplicate the load-time merge now collapses.
    const a = rawInstance({ guid: 'g1', lb: 2.25, holderGuid: 'H1', presets: [{ name: 'AL OOH2.25 - Rough', n: 8000, v_f: 40 }] });
    const b = rawInstance({ guid: 'g2', lb: 3.0, holderGuid: 'H2', presets: [{ name: 'AL OOH3.0 - Rough', n: 8000, v_f: 40 }] });
    const tool = buildLogicalTool([a, b]);
    expect(tool.presets).toHaveLength(1);       // collapsed
    expect(tool._duplicatePresets).toBe(1);     // one duplicate flagged
  });

  it('does NOT flag same-name different-value presets (legitimately kept + indexed)', () => {
    const a = rawInstance({ guid: 'g1', holderGuid: 'H1', presets: [{ name: 'Rough', n: 8000 }] });
    const b = rawInstance({ guid: 'g2', holderGuid: 'H2', presets: [{ name: 'Rough', n: 12000 }] });
    const tool = buildLogicalTool([a, b]);
    expect(tool.presets).toHaveLength(2);
    expect(tool._duplicatePresets).toBeUndefined();
  });
});

describe('buildLogicalTool — stale tracking-ID flag', () => {
  it('flags when instances share a tracking ID but have different product IDs', () => {
    const a = rawInstance({ guid: 'g1', productId: 'A-1' });
    const b = rawInstance({ guid: 'g2', productId: 'A-2' });   // copied in Fusion, re-numbered
    const tool = buildLogicalTool([a, b]);
    expect(tool._productIdConflict).toEqual(['A-1', 'A-2']);
  });

  it('no flag when all instances share the same product ID', () => {
    const a = rawInstance({ guid: 'g1', productId: 'A-1' });
    const b = rawInstance({ guid: 'g2', productId: 'A-1' });
    const tool = buildLogicalTool([a, b]);
    expect(tool._productIdConflict).toBeUndefined();
  });
});

describe('splitToFusionInstances — shoulder never exceeds an instance OOH', () => {
  it('clamps shoulder length DOWN to a short instance OOH, leaves a long one alone', () => {
    const tool = {
      id: 'FTL-AAAAAA', tracking_id: 'FTL-AAAAAA',
      tool_type: 'flat end mill', unit: 'inches',
      diameter: 0.5, flute_length: 1, overall_length: 3, number_of_flutes: 4,
      shoulder_length: 3.0,   // deliberately longer than the short assembly's OOH
      presets: [],
      assemblies: [
        { assembly_id: 'as1', instance_guid: 'g1', holder_guid: null, ooh: 1.0, source: 'manual' },
        { assembly_id: 'as2', instance_guid: 'g2', holder_guid: null, ooh: 5.0, source: 'manual' },
      ],
      _instancesRaw: [],
    };
    const { fusionInstances } = splitToFusionInstances(tool, []);
    const short = fusionInstances.find(f => f.guid === 'g1');
    const long = fusionInstances.find(f => f.guid === 'g2');
    // Short instance: shoulder clamped down to its OOH (1.0), never exceeds LB.
    expect(short.geometry['shoulder-length']).toBeLessThanOrEqual(short.geometry.LB);
    expect(short.geometry['shoulder-length']).toBe(1.0);
    // Long instance: shoulder (3.0) fits under its OOH (5.0), left as-is.
    expect(long.geometry['shoulder-length']).toBe(3.0);
    expect(long.geometry.LB).toBe(5.0);
  });
});

describe('overlayPresets — operation_type source depends on format', () => {
  it('new-format reads the bucket, not the name (intensity prefix never corrupts op_type)', () => {
    // "Fine Finish" in the name would parse to the old fine_finish op-type, but a
    // new-format preset's operation is its strategy bucket → plain finish.
    const p = { guid: 'g1', name: 'SS 2.0 SK13 - Fine Finish 3D', strategies: { roughing: [], finishing: ['contour_new'] } };
    const [out] = overlayPresets([p], { g1: { intensity: 'light' } });
    expect(out.operation_type).toBe('finish');
    expect(out.intensity).toBe('light');
  });

  it('new-format roughing bucket → rough', () => {
    const p = { guid: 'g1', name: 'AL 1.0 SK13 - Fast Rough Adaptive', strategies: { roughing: ['adaptive2d', 'adaptive'], finishing: [] } };
    expect(overlayPresets([p], {})[0].operation_type).toBe('rough');
  });

  it('old-format (no strategies) still parses the op-type from the name — unchanged', () => {
    expect(overlayPresets([{ guid: 'g2', name: 'SS 2.0 SK13 - Fine Finish' }], {})[0].operation_type).toBe('fine_finish');
    expect(overlayPresets([{ guid: 'g3', name: 'SS 2.0 SK13 - Rough' }], {})[0].operation_type).toBe('rough');
  });

  // A probe has no material (Fusion's probe editor has no material selector).
  // overlayPresets is the one place a material could be inferred from the name,
  // and doing so for a probe would inject a material that leaks to Fusion on
  // write (probe normalizePreset passes `rest` through). Gate it on toolType.
  it('never infers a material for a probe preset, even when the name contains a material keyword', () => {
    // "AL" in the name would normally infer an aluminium material for a milling
    // preset — but for a probe it must be left with no material at all.
    const probePreset = { guid: 'pr1', name: 'AL calibration probe', v_f_leadIn: 1000, v_f_link: 3000, v_f_measure: 102 };
    const [asProbe] = overlayPresets([probePreset], {}, { toolType: 'probe' });
    expect(asProbe.material).toBeUndefined();
    // The same preset on a milling tool WOULD get the material inferred — proving
    // the gate is what suppresses it, not that the name simply doesn't match.
    const [asMill] = overlayPresets([{ ...probePreset }], {}, { toolType: 'flat end mill' });
    expect(asMill.material?.query).toBe('AL');
  });

  it('preserves a probe preset\'s real feedrate fields and adds no milling fields', () => {
    const probePreset = { guid: 'pr2', name: 'Default preset', v_f_leadIn: 1000, v_f_link: 3000, v_f_measure: 102 };
    const [out] = overlayPresets([probePreset], {}, { toolType: 'probe' });
    expect(out.v_f_leadIn).toBe(1000);
    expect(out.v_f_link).toBe(3000);
    expect(out.v_f_measure).toBe(102);
    for (const k of ['n', 'v_c', 'v_f', 'f_z', 'use-stepdown', 'use-stepover']) {
      expect(k in out).toBe(false);
    }
  });
});
