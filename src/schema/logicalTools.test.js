import { describe, it, expect } from 'vitest';
import { buildLogicalTool, splitToFusionInstances } from './logicalTools.js';

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
