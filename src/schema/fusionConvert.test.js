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

  it('never writes app-only preset fields (operation_type, machine_id, job_ids) to Fusion', () => {
    const rawPreset = makePreset();
    const preset = makePreset({
      operation_type: 'rough',
      machine_id: 'uuid-of-machine',
      job_ids: ['uuid-of-job'],
    });
    const out = outPreset(internalToFusionTool(makeTool({ preset, rawPreset })));
    // These live only in preset_meta (tool_metadata.json) — Fusion validates
    // strictly and must never see them.
    expect('operation_type' in out).toBe(false);
    expect('machine_id' in out).toBe(false);
    expect('job_ids' in out).toBe(false);
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
