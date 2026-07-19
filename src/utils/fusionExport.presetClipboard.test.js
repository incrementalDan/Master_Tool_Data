import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { fusionToolToInternal } from '../schema/fusionConvert.js';
import { presetToFusionClipboardJson, presetToFusionClipboardObject } from './fusionExport.js';

const here = dirname(fileURLToPath(import.meta.url));
const refDir = resolve(here, '../../FUSION TOOL Library REF/NewPresetREF');

describe('Copy preset for Fusion — clipboard shape', () => {
  it('matches the real Fusion clipboard sample byte-for-byte', () => {
    const ref = JSON.parse(readFileSync(resolve(refDir, 'NewPresets REF ALL.json'), 'utf8'));
    const fem = ref.data.find(t => t.type === 'flat end mill');
    const internal = fusionToolToInternal(fem);
    const allPreset = internal.presets.find(p => p.name === 'ALL MILLING STRATEGIES');

    const mine = presetToFusionClipboardJson(internal, allPreset);
    const sample = readFileSync(resolve(refDir, 'ALL MILLING STRATEGIES Preset only.json'), 'utf8').trim();
    expect(mine).toBe(sample);
  });

  it('strips app-only fields and preset expressions for milling', () => {
    const ref = JSON.parse(readFileSync(resolve(refDir, 'NewPresets REF ALL.json'), 'utf8'));
    const internal = fusionToolToInternal(ref.data.find(t => t.type === 'flat end mill'));
    const p = internal.presets[0];
    // simulate app-only fields riding on the in-memory preset
    const obj = presetToFusionClipboardObject(internal, {
      ...p, operation_type: 'rough', machine_id: 'm1', job_ids: ['j1'],
      small_bore: true, small_bore_diameter: 0.4, f_z_base: 0.001, intensity: 'aggressive',
    });
    const out = obj.presets[0];
    for (const k of ['operation_type', 'machine_id', 'job_ids', 'small_bore', 'small_bore_diameter', 'f_z_base', 'intensity']) {
      expect(k in out).toBe(false);
    }
    expect('expressions' in out).toBe(false);     // milling preset: no preset-level expressions
    expect(obj.toolType).toBe('flat end mill');
    expect(obj.unit).toBe('inches');
  });

  it('old-format preset (no strategies) copies without a strategy block', () => {
    const preset = {
      guid: 'g', name: 'SS 1.0 30-SK13 - Rough', material: { category: 'metal', query: 'SS' },
      n: 5000, v_c: 650, v_f: 40, f_z: 0.002, v_f_plunge: 13, f_n: 0.0026,
      'tool-coolant': 'flood', operation_type: 'rough',
    };
    const tool = { tool_type: 'flat end mill', unit: 'inches', diameter: 0.5, number_of_flutes: 4, tsc_capable: false };
    const obj = presetToFusionClipboardObject(tool, preset);
    expect('strategies' in obj.presets[0]).toBe(false);
  });
});
