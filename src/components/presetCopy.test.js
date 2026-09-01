// A copied preset must not inherit the SOURCE preset's Fusion expressions.
// Fusion re-derives every numeric from its expression on load, so an inherited
// expression leaves the copy silently governed by the original's values — the
// same bug class as a stale expression, arriving through the copy button.
// Real case: copying drill D-43's "AL" preset produced "AL (copy) test" showing
// 200 ft/min in the app while carrying the source's tool_surfaceSpeed "250 fpm".
import { describe, it, expect } from 'vitest';
import { copyOfPreset } from './PresetPanel.jsx';

const src = {
  guid: 'p1',
  name: 'AL',
  n: 3322.65, v_c: 250, v_f_plunge: 18.61, f_n: 0.0056,
  machine_id: 'm-1',
  operation_ids: ['op-1218'],
  material_preset_id: 'cam-al',
  expressions: { tool_feedPerRevolution: '.002 in', tool_surfaceSpeed: '250 fpm' },
};

describe('copyOfPreset', () => {
  it('drops the source expressions', () => {
    expect(copyOfPreset(src, 'p2').expressions).toBeUndefined();
  });

  it('does not mutate the source preset', () => {
    copyOfPreset(src, 'p2');
    expect(src.expressions).toEqual({ tool_feedPerRevolution: '.002 in', tool_surfaceSpeed: '250 fpm' });
  });

  it('clears the proven-program links but keeps the machine and material links', () => {
    const c = copyOfPreset(src, 'p2');
    expect(c.operation_ids).toEqual([]);
    expect(c.machine_id).toBe('m-1');
    expect(c.material_preset_id).toBe('cam-al');
  });

  it('takes the new guid and a "(copy)" name, and keeps every speed/feed value', () => {
    const c = copyOfPreset(src, 'p2');
    expect(c.guid).toBe('p2');
    expect(c.name).toBe('AL (copy)');
    expect([c.n, c.v_c, c.v_f_plunge, c.f_n]).toEqual([3322.65, 250, 18.61, 0.0056]);
  });
});
