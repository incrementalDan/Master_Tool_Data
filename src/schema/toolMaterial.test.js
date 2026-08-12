// Cobalt is an app-side material Fusion has no option for. It is written OUT as
// `hss` and read back as Cobalt from metadata — confirmed against the real
// library, whose 303 Fusion tools hold only carbide / hss / unspecified while
// metadata carries 8 cobalt tools.
import { describe, it, expect } from 'vitest';
import { toFusionMaterial, sameFusionMaterial, resolveMaterial } from './fieldRegistry.js';
import { internalToFusionTool, fusionToolToInternal } from './fusionConvert.js';
import { mergeFusionAndMetadata, detectFusionDrift, mergeSharedFieldsWithFusion } from './metadataModel.js';

describe('toFusionMaterial', () => {
  it('sends cobalt to Fusion as hss', () => {
    expect(toFusionMaterial('cobalt')).toBe('hss');
    expect(toFusionMaterial('Cobalt')).toBe('hss');
  });

  it('leaves every other material untouched', () => {
    for (const m of ['carbide', 'hss', 'ceramic', 'unspecified']) {
      expect(toFusionMaterial(m)).toBe(m);
    }
  });

  it('passes through blanks rather than inventing a material', () => {
    expect(toFusionMaterial('')).toBe('');
    expect(toFusionMaterial(null)).toBe(null);
    expect(toFusionMaterial(undefined)).toBe(undefined);
  });
});

describe('the Fusion write', () => {
  const tool = (material) => ({
    id: 'g1', tool_type: 'drill', description: 'D', unit: 'inches',
    diameter: 0.25, material, presets: [],
  });

  it('writes BMC and its expression as hss for a cobalt tool', () => {
    const f = internalToFusionTool(tool('cobalt'));
    expect(f.BMC).toBe('hss');
    // ⚠️ Fusion re-derives BMC from the expression on load — writing the
    // translated native alongside an untranslated expression would put `cobalt`
    // straight back.
    if (f.expressions?.tool_material !== undefined) {
      expect(f.expressions.tool_material).toBe("'hss'");
    }
  });

  // ⚠️ Checks the MATERIAL-carrying fields, not the whole JSON. Three of the
  // shop's eight cobalt tools are legitimately DESCRIBED as cobalt ("9/32 Cobalt
  // drill from Drill index") — a blanket scan calls those a leak, which is a
  // false alarm on data that is exactly right.
  it('puts no cobalt in a material field', () => {
    const t = { ...tool('cobalt'), description: '9/32 Cobalt drill from Drill index' };
    const f = internalToFusionTool(t);
    for (const v of [f.BMC, f.expressions?.tool_material]) {
      expect(String(v ?? '')).not.toMatch(/cobalt/i);
    }
    expect(f.description).toBe('9/32 Cobalt drill from Drill index');
  });
});

describe('the round trip keeps the app saying Cobalt', () => {
  const meta = { material: 'cobalt' };

  it('reads Fusion hss back as cobalt when the app stored cobalt', () => {
    const fromFusion = fusionToolToInternal({ guid: 'g', type: 'drill', BMC: 'hss', geometry: {} });
    expect(fromFusion.material).toBe('hss');
    expect(mergeFusionAndMetadata(fromFusion, meta).material).toBe('cobalt');
  });

  it('still lets a real Fusion change win', () => {
    const fromFusion = fusionToolToInternal({ guid: 'g', type: 'drill', BMC: 'carbide', geometry: {} });
    expect(mergeFusionAndMetadata(fromFusion, meta).material).toBe('carbide');
  });

  it('leaves a plain hss tool as hss', () => {
    expect(resolveMaterial('hss', 'hss')).toBe('hss');
    expect(resolveMaterial('hss', null)).toBe('hss');
  });
});

// ⚠️ THE NAG-LOOP GUARD. Fusion can never hold `cobalt`, so if these compared as
// strings the flags they drive could never be cleared by any user action.
describe('cobalt vs hss is not a difference', () => {
  it('is not drift', () => {
    const fusionSide = { material: 'hss' };
    expect(detectFusionDrift([fusionSide], { material: 'cobalt' })).toEqual([]);
  });

  it('is not a write-time conflict', () => {
    const base = { material: 'hss' }, remote = { material: 'hss' };
    const conflicts = [];
    mergeSharedFieldsWithFusion({ material: 'cobalt' }, base, remote, conflicts);
    expect(conflicts).toEqual([]);
  });

  it('still reports a genuine material change as drift', () => {
    const drift = detectFusionDrift([{ material: 'carbide' }], { material: 'cobalt' });
    expect(drift.map(d => d.field)).toEqual(['material']);
  });

  it('sameFusionMaterial only merges the two it is meant to', () => {
    expect(sameFusionMaterial('cobalt', 'hss')).toBe(true);
    expect(sameFusionMaterial('cobalt', 'carbide')).toBe(false);
    expect(sameFusionMaterial('hss', 'ceramic')).toBe(false);
  });
});
