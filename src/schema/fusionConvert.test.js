// Stepdown/stepover three-way sync — the recurring Fusion gotcha. The boolean,
// the numeric, and the expression string must always agree: Fusion re-derives
// both the checkbox AND the number from the expression on load, so a stale
// expression silently reverts an edit. These tests lock the invariant through
// internalToFusionTool (normalizePreset is private).
import { describe, it, expect } from 'vitest';
import { internalToFusionTool } from './toolSchema.js';

function makeTool({ preset, rawPreset }) {
  return {
    id: 'g1',
    tool_type: 'flat end mill',
    unit: 'inches',
    description: 'TEST EM',
    diameter: 0.5,
    flute_length: 1,
    overall_length: 3,
    number_of_flutes: 4,
    material: 'carbide',
    tool_id: 'A-1',
    location: '',
    presets: [preset],
    _fusionRaw: {
      guid: 'g1',
      type: 'flat end mill',
      unit: 'inches',
      description: 'TEST EM',
      geometry: { DC: 0.5, LCF: 1, OAL: 3, NOF: 4 },
      'start-values': { presets: [rawPreset] },
    },
  };
}

// A complete milling preset with real (non-blank) values so the blank-preset
// default seeding doesn't kick in.
function makePreset(overrides = {}) {
  return {
    guid: 'p1',
    name: 'AL 2.0 30-SK13-60 - Rough',
    material: { category: 'all', query: 'AL', 'use-hardness': false },
    n: 5000, v_c: 654, n_ramp: 5000,
    v_f: 100, f_z: 0.005, v_f_plunge: 30, f_n: 0.006,
    v_f_leadIn: 100, v_f_leadOut: 100, v_f_transition: 100, v_f_ramp: 30,
    'ramp-angle': 2,
    'tool-coolant': 'flood',
    'use-stepdown': true, stepdown: 0.018,
    'use-stepover': false, stepover: null,
    expressions: { tool_stepdown: '.018 in' },
    ...overrides,
  };
}

const outPreset = (fusionObj) => fusionObj['start-values'].presets[0];

// Insert-style tools push back to Fusion as ONE entry — the pairing/components
// are metadata-only and must never leak, and the combined "holder/insert"
// product-id must round-trip verbatim so the Fusion entry stays recognizable.
describe('insert-style tool → Fusion round-trip', () => {
  it('preserves the combined product-id and never writes the pairing', () => {
    const tool = makeTool({ preset: makePreset(), rawPreset: makePreset() });
    tool.tool_id = 'TF-194/TO-195';
    tool.pairing = { family: 'od_turning', holder_component_id: 'h', insert_component_id: 'i', rta_number: '' };
    const out = internalToFusionTool(tool);
    expect(out['product-id']).toBe('TF-194/TO-195');
    expect(out.expressions.tool_productId).toBe("'TF-194/TO-195'");
    expect('pairing' in out).toBe(false);
  });
});

describe('preset stock-material assignment (Fusion-native, matched by name)', () => {
  it('writes stock-materials the picker set (matches the exported material file by name)', () => {
    // PresetPanel's CamPresetPicker stamps stock-materials = [CAM preset name].
    const preset = makePreset({
      material: { category: 'metal', query: 'Aluminum hard test 2', 'use-hardness': false },
      'stock-materials': ['Aluminum hard test 2'],
    });
    const out = outPreset(internalToFusionTool(makeTool({ preset, rawPreset: makePreset() })));
    expect(out['stock-materials']).toEqual(['Aluminum hard test 2']);
    // No UUID is written — Fusion assigns one on its side, keyed by name.
    expect(JSON.stringify(out)).not.toMatch(/uuid/i);
  });

  it('preserves a real (multi-)assignment untouched — never mirrors material.query into it', () => {
    // A real export carries query "SS" alongside a richer, different assignment.
    const preset = makePreset({
      material: { category: 'metal', query: 'SS', 'use-hardness': false },
      'stock-materials': ['SS Harder', 'Steel, High-Carbon'],
    });
    const rawPreset = makePreset({ 'stock-materials': ['SS Harder', 'Steel, High-Carbon'] });
    const out = outPreset(internalToFusionTool(makeTool({ preset, rawPreset })));
    expect(out['stock-materials']).toEqual(['SS Harder', 'Steel, High-Carbon']);
  });

  it('does NOT seed stock-materials from a legacy material.query (e.g. group code "AL")', () => {
    // Legacy presets encode a short group code in query, not a real CAM preset
    // name — seeding it would push a material name Fusion can't resolve.
    const preset = makePreset({ material: { category: 'metal', query: 'AL', 'use-hardness': false } });
    const out = outPreset(internalToFusionTool(makeTool({ preset, rawPreset: makePreset() })));
    expect('stock-materials' in out).toBe(false);
  });

  it('never writes the app-only CAM-preset FK (material_preset_id) into Fusion JSON', () => {
    const preset = makePreset({ material_preset_id: 'pre_n_al' });
    const out = outPreset(internalToFusionTool(makeTool({ preset, rawPreset: makePreset() })));
    expect('material_preset_id' in out).toBe(false);
  });
});

describe('stepdown/stepover three-way sync (normalizePreset via internalToFusionTool)', () => {
  it('rewrites the stepdown expression literal when the numeric value changed', () => {
    const rawPreset = makePreset();                       // stored: 0.018 + ".018 in"
    const preset = makePreset({ stepdown: 0.025 });       // edited in app: 0.025
    const out = outPreset(internalToFusionTool(makeTool({ preset, rawPreset })));
    expect(out.stepdown).toBe(0.025);
    expect(out['use-stepdown']).toBe(true);
    // Stale ".018 in" would make Fusion revert the edit on next load.
    expect(out.expressions.tool_stepdown).toBe('0.025 in');
  });

  it('keeps the expression byte-for-byte when the value is unchanged', () => {
    const rawPreset = makePreset();
    const preset = makePreset();                          // no edit
    const out = outPreset(internalToFusionTool(makeTool({ preset, rawPreset })));
    expect(out.expressions.tool_stepdown).toBe('.018 in'); // native format preserved
  });

  it('never rewrites a formula expression (literals only)', () => {
    const formula = 'tool_diameter * 0.1';
    const rawPreset = makePreset({ expressions: { tool_stepdown: formula } });
    const preset = makePreset({ stepdown: 0.025, expressions: { tool_stepdown: formula } });
    const out = outPreset(internalToFusionTool(makeTool({ preset, rawPreset })));
    expect(out.expressions.tool_stepdown).toBe(formula);
  });

  it('strips numeric + expression entirely when the flag is disabled', () => {
    const rawPreset = makePreset();
    const preset = makePreset({ 'use-stepdown': false });
    const out = outPreset(internalToFusionTool(makeTool({ preset, rawPreset })));
    expect(out['use-stepdown']).toBe(false);
    expect('stepdown' in out).toBe(false);
    expect('tool_stepdown' in (out.expressions || {})).toBe(false);
  });

  it('rewrites a present tool_coolant expression when the coolant changes', () => {
    const rawPreset = makePreset({ expressions: { tool_coolant: "'flood'" } });
    const preset = makePreset({ 'tool-coolant': 'tool', expressions: { tool_coolant: "'flood'" } });
    const out = outPreset(internalToFusionTool(makeTool({ preset, rawPreset })));
    expect(out['tool-coolant']).toBe('tool');
    expect(out.expressions.tool_coolant).toBe("'tool'");
  });

  it('keeps tool_coolant expression byte-for-byte when unchanged, never adds one', () => {
    const rawPreset = makePreset({ expressions: { tool_coolant: "'flood'" } });
    const preset = makePreset({ expressions: { tool_coolant: "'flood'" } });
    const out = outPreset(internalToFusionTool(makeTool({ preset, rawPreset })));
    expect(out.expressions.tool_coolant).toBe("'flood'");
    // And a preset with no coolant expression must not gain one.
    const out2 = outPreset(internalToFusionTool(makeTool({
      preset: makePreset({ 'tool-coolant': 'tool', expressions: {} }),
      rawPreset: makePreset({ expressions: {} }),
    })));
    expect('tool_coolant' in (out2.expressions || {})).toBe(false);
  });

  it('never writes app-only preset fields (operation_type, machine_id, operation_ids) to Fusion', () => {
    const rawPreset = makePreset();
    const preset = makePreset({
      operation_type: 'rough',
      machine_id: 'uuid-of-machine',
      operation_ids: ['uuid-of-job'],
    });
    const out = outPreset(internalToFusionTool(makeTool({ preset, rawPreset })));
    // These live only in preset_meta (tool_metadata.json) — Fusion validates
    // strictly and must never see them.
    expect('operation_type' in out).toBe(false);
    expect('machine_id' in out).toBe(false);
    expect('operation_ids' in out).toBe(false);
  });

  it('syncs stepover the same way', () => {
    const rawPreset = makePreset({
      'use-stepover': true, stepover: 0.05,
      expressions: { tool_stepdown: '.018 in', tool_stepover: '.05 in' },
    });
    const preset = makePreset({
      'use-stepover': true, stepover: 0.06,
      expressions: { tool_stepdown: '.018 in', tool_stepover: '.05 in' },
    });
    const out = outPreset(internalToFusionTool(makeTool({ preset, rawPreset })));
    expect(out.stepover).toBe(0.06);
    expect(out.expressions.tool_stepover).toBe('0.06 in');
    expect(out.expressions.tool_stepdown).toBe('.018 in'); // unchanged sibling untouched
  });
});

// Probe (CMM stylus) — a real Fusion tool type with its own preset vocabulary
// (Lead-In/Link/Measure feedrate, no spindle speed, no stepdown/stepover).
// Fixture below mirrors a real Blum stylus export (FUSION TOOL Library REF/
// Probe REF/Probe Only.json). Every save path (renumber, tool-ID assign,
// location assign) round-trips a probe tool through internalToFusionTool even
// though nobody ever opens its preset editor, so this has to be safe with zero
// user interaction — see fusionConvert.js's isProbe/isProbeTool branches.
describe('probe (CMM stylus) round-trip', () => {
  const probeRaw = {
    guid: 'probe-1',
    type: 'probe',
    unit: 'millimeters',
    description: 'Blum TC52/TC62 Styli 3mm x 50mm',
    BMC: 'hss',
    vendor: 'Blum',
    'product-id': '',
    'product-link': 'https://example.com/probe',
    expressions: {
      tool_bodyLength: '(50+1.5) mm',
      tool_description: "'Blum TC52/TC62 Styli 3mm x 50mm'",
      tool_diameter: '3. mm',
      tool_shaftDiameter: '2. mm',
    },
    geometry: {
      CSP: false, DC: 3, HAND: true, LB: 51.5, LCF: 6, NOF: 0, NT: 1, OAL: 51.5,
      RE: 1.5, SFDM: 2, TA: 0, assemblyGaugeLength: 136.63,
      'shoulder-length': 6, 'thread-profile-angle': 60,
      'tip-diameter': 0, 'tip-length': 0, 'tip-offset': 0,
    },
    holder: {
      description: 'Blum TC52/TC62 with BT30 - BTH 25',
      gaugeLength: 85.13,
      guid: 'holder-guid-1',
      'product-id': 'TC52 (142174); TC62 (142892)',
      'product-link': '',
      segments: [{ height: 1, 'lower-diameter': 30, 'upper-diameter': 30 }],
      type: 'holder',
      unit: 'millimeters',
      vendor: 'Blum',
    },
    'post-process': { number: 99, 'length-offset': 99, 'diameter-offset': 99 },
    'start-values': {
      presets: [{
        guid: 'probe-preset-1',
        name: 'Default preset',
        v_f_leadIn: 1000,
        v_f_link: 3000,
        v_f_measure: 102,
      }],
    },
  };

  function probeInternal(overrides = {}) {
    return {
      id: 'probe-1',
      tool_type: 'probe',
      unit: 'millimeters',
      description: probeRaw.description,
      diameter: 3,
      flute_length: 6,
      overall_length: 51.5,
      number_of_flutes: 0,
      shank_diameter: 2,
      material: 'hss',
      tool_id: 'S-1',
      location: '',
      cutting_direction: 'Right Hand',
      presets: probeRaw['start-values'].presets,
      machine_tool_number: 99,
      _fusionRaw: probeRaw,
      ...overrides,
    };
  }

  it('never injects a milling/spindle-speed shape into the probe preset', () => {
    const out = internalToFusionTool(probeInternal());
    const p = out['start-values'].presets[0];
    // None of the milling default-seeding fields may appear.
    for (const key of ['n', 'v_c', 'v_f', 'f_z', 'f_n', 'v_f_plunge', 'v_f_ramp',
      'v_f_transition', 'n_ramp', 'ramp-angle', 'use-stepdown', 'use-stepover',
      'stepdown', 'stepover', 'tool-coolant']) {
      expect(key in p).toBe(false);
    }
    // The tool's real values survive untouched.
    expect(p.v_f_leadIn).toBe(1000);
    expect(p.v_f_link).toBe(3000);
    expect(p.v_f_measure).toBe(102);
    expect(p.name).toBe('Default preset');
    // No spurious expressions object either.
    expect('expressions' in p).toBe(false);
  });

  it('is still "safe" (no milling injection) on a second write — idempotent', () => {
    const first = internalToFusionTool(probeInternal());
    const secondRaw = { ...probeRaw, 'start-values': { presets: [first['start-values'].presets[0]] } };
    const second = internalToFusionTool(probeInternal({ _fusionRaw: secondRaw }));
    expect(second['start-values'].presets[0]).toEqual(first['start-values'].presets[0]);
  });

  it('preserves the probe holder byte-for-byte when no app holder record resolves', () => {
    // splitToFusionInstances is what actually decides the holder (falls back to
    // raw.holder when resolveHolderForWrite finds no app record) — this test
    // locks internalToFusionTool's half of the contract: it must never invent
    // or drop the holder key that logicalTools.js hands it via ...existing.
    const out = internalToFusionTool(probeInternal());
    expect(out.holder).toEqual(probeRaw.holder);
  });

  it('round-trips core geometry unchanged (diameter, shaft diameter, body length)', () => {
    const out = internalToFusionTool(probeInternal());
    expect(out.geometry.DC).toBe(3);
    expect(out.geometry.SFDM).toBe(2);
    expect(out.geometry.LCF).toBe(6);
    expect(out.geometry.OAL).toBe(51.5);
    expect(out.type).toBe('probe');
  });

  it('mirrors the Tool ID into product-id like any other tool type', () => {
    const out = internalToFusionTool(probeInternal({ tool_id: 'S-42' }));
    expect(out['product-id']).toBe('S-42');
    expect(out.expressions.tool_productId).toBe("'S-42'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A LITERAL preset expression that disagrees with its paired numeric is STALE,
// and Fusion re-derives the numeric from it on load — so the stored value
// silently reverts. Before this rule, the sync only rewrote an expression when
// THIS write changed the value, which made the bad state self-perpetuating: a
// re-save saw an unchanged number and preserved the stale string forever.
//
// The numbers below are from a real drill (D-43, "7.3mm (.2874) 135DEG DRILL")
// whose Fusion entry carried f_n 0.0056 next to ".002 in" and, on a copied
// preset, v_c 200 next to "250 fpm" — the app showed the right values, Fusion
// would have run the wrong ones.
// ─────────────────────────────────────────────────────────────────────────────
describe('stale literal preset expressions self-heal', () => {
  const drillPreset = (o = {}) => ({
    guid: 'p1',
    name: 'AL',
    material: { category: 'metal', query: 'Al Wrought - 6061+', 'use-hardness': false },
    n: 3322.6501689330976, v_c: 250,
    v_f_plunge: 18.61, v_f_retract: 40, f_n: 0.0056,
    'tool-coolant': 'flood', 'use-feed-per-revolution': false,
    expressions: { tool_feedPerRevolution: '.002 in', tool_surfaceSpeed: '250 fpm' },
    ...o,
  });
  const drillTool = (preset, rawPreset) => ({
    id: 'g1', tool_type: 'drill', unit: 'inches',
    description: '7.3mm (.2874) 135DEG DRILL',
    diameter: 0.2874, flute_length: 2.3, overall_length: 4.1, number_of_flutes: 2,
    material: 'cobalt', tool_id: 'D-43', location: 'LC-36',
    presets: [preset],
    _fusionRaw: {
      guid: 'g1', type: 'drill', unit: 'inches',
      description: '7.3mm (.2874) 135DEG DRILL',
      geometry: { DC: 0.2874, LCF: 2.3, OAL: 4.1, NOF: 2, SIG: 135 },
      'start-values': { presets: [rawPreset] },
    },
  });

  it('rewrites a stale literal even when this write changed nothing', () => {
    // Value unchanged vs. the stored entry — the old rule would keep ".002 in".
    const p = drillPreset();
    const out = outPreset(internalToFusionTool(drillTool(p, drillPreset())));
    expect(out.f_n).toBe(0.0056);
    expect(out.expressions.tool_feedPerRevolution).toBe('0.0056 in');
  });

  it('heals a copied preset that inherited the source preset speed', () => {
    // v_c 200 next to the source's "250 fpm": on load Fusion would run 250.
    const p = drillPreset({ guid: 'p2', name: 'AL (copy) test', n: 2658, v_c: 200, v_f_plunge: 25, f_n: 0.00941 });
    const out = outPreset(internalToFusionTool(drillTool(p, { ...p })));
    expect(out.expressions.tool_surfaceSpeed).toBe('200 fpm');
    expect(out.expressions.tool_feedPerRevolution).toBe('0.00941 in');
  });

  it('is idempotent — a healed preset is not rewritten again', () => {
    const healed = drillPreset({ expressions: { tool_feedPerRevolution: '0.0056 in', tool_surfaceSpeed: '250 fpm' } });
    const out = outPreset(internalToFusionTool(drillTool(healed, { ...healed })));
    expect(out.expressions).toEqual({ tool_feedPerRevolution: '0.0056 in', tool_surfaceSpeed: '250 fpm' });
  });

  it('leaves an agreeing literal byte-for-byte (float noise is not a change)', () => {
    // Fusion stores v_c = 250.0000208 alongside the expression "250 fpm".
    const p = drillPreset({ v_c: 250.0000208, expressions: { tool_surfaceSpeed: '250 fpm' } });
    const out = outPreset(internalToFusionTool(drillTool(p, { ...p })));
    expect(out.expressions.tool_surfaceSpeed).toBe('250 fpm');
  });

  it('never ADDS an expression key to an existing preset', () => {
    // A native preset carrying no expressions at all stays that way — the
    // healing rule only ever corrects a key that is already there.
    const { expressions, ...noExprs } = drillPreset();
    const out = outPreset(internalToFusionTool(drillTool(noExprs, { ...noExprs })));
    expect(out.expressions).toBeUndefined();
  });

  it('keeps an expression-ONLY native preset (no numeric to compare against)', () => {
    // Native drill presets often carry tool_feedPerRevolution with no f_n at
    // all — Fusion derives the number from it. Rewriting would zero a real value.
    const { f_n, ...noFn } = drillPreset();
    const out = outPreset(internalToFusionTool(drillTool(noFn, { ...noFn })));
    expect(out.f_n).toBeUndefined();
    expect(out.expressions.tool_feedPerRevolution).toBe('.002 in');
  });

  it('never rewrites a FORMULA whose value did not change', () => {
    const formula = "tool_type=='drill' ? 40inpm : tool_feedCutting/3";
    const p = drillPreset({ expressions: { tool_feedPlunge: formula } });
    const out = outPreset(internalToFusionTool(drillTool(p, { ...p })));
    expect(out.expressions.tool_feedPlunge).toBe(formula);
  });

  it('rewrites a formula only when the value actually changed', () => {
    const formula = "tool_type=='drill' ? 40inpm : tool_feedCutting/3";
    const raw = drillPreset({ expressions: { tool_feedPlunge: formula } });
    const p = drillPreset({ v_f_plunge: 18.61, expressions: { tool_feedPlunge: formula } });
    const out = outPreset(internalToFusionTool(drillTool(p, { ...raw, v_f_plunge: 40 })));
    expect(out.expressions.tool_feedPlunge).toBe('18.61 inpm');
  });

  it('heals a METRIC surface speed, whose unit suffix carries a slash', () => {
    const p = {
      ...drillPreset({ v_c: 200, expressions: { tool_surfaceSpeed: '250 m/min' } }),
    };
    const tool = { ...drillTool(p, { ...p }), unit: 'millimeters' };
    tool._fusionRaw = { ...tool._fusionRaw, unit: 'millimeters' };
    const out = outPreset(internalToFusionTool(tool));
    expect(out.expressions.tool_surfaceSpeed).toBe('200 m/min');
  });
});
