import { describe, it, expect } from 'vitest';
import { DEFAULT_MATERIALS } from './sharedDefaults.js';

// ⚠️ A material name code becomes ONE POSITIONAL TOKEN in a composed preset name
// ("SS 2.125 NBT30-SK13C-60 - Rough"), which parsePresetName reads back by
// position. A code containing a space would shift the OOH and holder fields and
// silently break the preset→assembly seed, so the seed must never ship one.
describe('materials seed — name codes are single tokens', () => {
  it('no group or CAM preset code contains whitespace', () => {
    const codes = [
      ...DEFAULT_MATERIALS.groups.map(g => g.code),
      ...DEFAULT_MATERIALS.presets.map(p => p.code),
      ...DEFAULT_MATERIALS.materials.map(m => m.code),
    ].filter(Boolean);
    expect(codes.length).toBeGreaterThan(0);
    for (const c of codes) expect(c).toBe(c.trim());
    expect(codes.filter(c => /\s/.test(c))).toEqual([]);
  });

  it('every CAM preset has a code, and every group_id resolves', () => {
    const groupIds = new Set(DEFAULT_MATERIALS.groups.map(g => g.id));
    for (const p of DEFAULT_MATERIALS.presets) {
      expect(p.code, `CAM preset "${p.name}" has no name code`).toBeTruthy();
      expect(groupIds.has(p.group_id)).toBe(true);
    }
  });
});
