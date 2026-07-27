// Relational-integrity contract — see "Relational integrity" in CLAUDE.md.
//
// This app is a relational database wearing JSON files, meant to migrate to
// SQLite by schema translation. Two things must therefore stay true, and both
// have been broken before by ordinary-looking edits:
//
//   1. Seed/reference data has no dangling foreign keys and no duplicate ids.
//   2. EVERY foreign key survives the metadata round-trip. This is the one that
//      catches the real failure mode: someone adds a link, or refactors
//      buildMetadataTool, and an id silently stops being persisted — the link is
//      then quietly lost on the next load with nothing failing.
//
// When you add a relationship, add it to the inventory table in CLAUDE.md AND to
// FK_ROUND_TRIP below.
import { describe, it, expect } from 'vitest';
import { DEFAULT_MATERIALS, DEFAULT_JOBS } from './sharedDefaults.js';
import { DEFAULT_VENDOR_REGISTRY } from './vendorRegistry.js';
import { buildMetadataTool } from './metadataModel.js';
import { buildUnlinkedTool } from './logicalTools.js';

const ids = (arr) => new Set((arr || []).map(x => x.id));
const dupes = (arr, key = 'id') => (arr || []).length - new Set((arr || []).map(x => x[key])).size;

describe('seed data — no dangling FKs, no duplicate ids', () => {
  const M = DEFAULT_MATERIALS;
  const groupIds = ids(M.groups);
  const presetIds = ids(M.presets);

  it('materials.json: every CAM preset points at a real group', () => {
    expect(M.presets.filter(p => !groupIds.has(p.group_id)).map(p => p.id)).toEqual([]);
  });

  it('materials.json: every alloy points at a real group AND a real CAM preset', () => {
    expect(M.materials.filter(a => !groupIds.has(a.group_id)).map(a => a.id)).toEqual([]);
    // preset_id may be null (an alloy the user unlinked) — but never a bad id.
    expect(M.materials.filter(a => a.preset_id && !presetIds.has(a.preset_id)).map(a => a.id)).toEqual([]);
  });

  it('materials.json: ids are unique at every tier', () => {
    expect(dupes(M.groups)).toBe(0);
    expect(dupes(M.presets)).toBe(0);
    expect(dupes(M.materials)).toBe(0);
  });

  it('vendor_registry.json: every entity has a unique stable id (never the name)', () => {
    const e = DEFAULT_VENDOR_REGISTRY.entities;
    expect(e.length).toBeGreaterThan(0);
    expect(e.filter(x => !x.id).length).toBe(0);
    expect(dupes(e)).toBe(0);
    // Names must also be unique — they're the human match key on import.
    expect(e.length - new Set(e.map(x => x.name.toLowerCase().trim())).size).toBe(0);
  });

  it('jobs.json: programs point at real parts', () => {
    const partIds = ids(DEFAULT_JOBS.parts);
    expect((DEFAULT_JOBS.programs || []).filter(p => p.part_id && !partIds.has(p.part_id))).toEqual([]);
  });
});

// A tool carrying EVERY foreign key the inventory lists. Each entry is
// [human label, path in the rebuilt tool, expected value].
const FK_TOOL = {
  id: 'FTL-REL01', tracking_id: 'FTL-REL01', tool_id: '1001',
  tool_type: 'flat end mill', unit: 'inches', description: 'FK round-trip',
  diameter: 0.5, no_fusion_link: true,
  preferred_machine_id: 'mc_m300', preferred_machine: 'Brother M300',
  bin_size_id: 'bin_std',
  tool_location: { system_id: 'sys1', zone_id: 'z1', station_id: 'st1', drawer_id: 'dr1', bin: 1405 },
  job_ids: ['job_a'],
  speed_feed_refs: [{ preset_id: 'pre_N_al_wrought', operation_type: 'rough', sfm: 350, chip_load: 0.002 }],
  pairing: { family: 'milling_insert', holder_component_id: 'cmp_h', insert_component_id: 'cmp_i', rta_number: '' },
  purchasing: {
    manufacturers: [{ id: 'm1', registry_id: 'reg_mfg', name: 'Helical Solutions', edp: '1', order: 0 }],
    vendors: [{ id: 'v1', manufacturer_id: 'm1', registry_id: 'reg_vendor', name: 'MSC Industrial', order: 0 }],
  },
  assemblies: [{
    assembly_id: 'as1', instance_guid: 'inst-guid-1', holder_guid: 'hold-guid-1',
    holder_description: 'NBT30-SK13C-60', ooh: 2.125,
    linked_preset_guids: ['p1'], asm_number: '30-SK13-60-1001-2.125',
  }],
  presets: [{
    guid: 'p1', name: 'AL 2.125 30-SK13-60 - Rough', n: 9000, v_f: 50,
    material: { category: 'metal', query: 'Al Wrought', 'use-hardness': false },
    material_preset_id: 'pre_N_al_wrought',
    machine_id: 'mc_m300',
    job_ids: ['job_a'],
  }],
};

// path → expected. Each row is one arrow in the CLAUDE.md inventory table.
const FK_ROUND_TRIP = [
  ['assembly → Fusion entry',        t => t.assemblies[0].instance_guid,            'inst-guid-1'],
  ['assembly → holder',              t => t.assemblies[0].holder_guid,              'hold-guid-1'],
  ['assembly → presets',             t => t.assemblies[0].linked_preset_guids,      ['p1']],
  ['preset → CAM preset',            t => t.presets[0].material_preset_id,          'pre_N_al_wrought'],
  ['preset → machine',               t => t.presets[0].machine_id,                  'mc_m300'],
  ['preset → jobs',                  t => t.presets[0].job_ids,                     ['job_a']],
  ['tool → jobs',                    t => t.job_ids,                                ['job_a']],
  ['tool → preferred machine',       t => t.preferred_machine_id,                   'mc_m300'],
  ['tool → location system',         t => t.tool_location.system_id,                'sys1'],
  ['tool → location drawer',         t => t.tool_location.drawer_id,                'dr1'],
  ['tool → bin size',                t => t.bin_size_id,                            'bin_std'],
  ['tool → speed/feed CAM preset',   t => t.speed_feed_refs[0].preset_id,           'pre_N_al_wrought'],
  ['pairing → holder component',     t => t.pairing.holder_component_id,            'cmp_h'],
  ['pairing → insert component',     t => t.pairing.insert_component_id,            'cmp_i'],
  ['purchasing mfg → registry',      t => t.purchasing.manufacturers[0].registry_id, 'reg_mfg'],
  ['purchasing vendor → registry',   t => t.purchasing.vendors[0].registry_id,      'reg_vendor'],
  ['purchasing vendor → its mfg',    t => t.purchasing.vendors[0].manufacturer_id,  'm1'],
];

describe('every foreign key survives the metadata round-trip', () => {
  // tool → buildMetadataTool (what lands in tool_metadata.json) →
  // buildUnlinkedTool (what the app rebuilds from it).
  const rebuilt = buildUnlinkedTool(buildMetadataTool(FK_TOOL));

  for (const [label, get, expected] of FK_ROUND_TRIP) {
    it(`preserves ${label}`, () => {
      expect(get(rebuilt)).toEqual(expected);
    });
  }

  it('the metadata record itself stores ids, not display names, for linked entities', () => {
    const meta = buildMetadataTool(FK_TOOL);
    expect(meta.preset_meta.p1.material_preset_id).toBe('pre_N_al_wrought');
    expect(meta.preset_meta.p1.machine_id).toBe('mc_m300');
    expect(meta.preferred_machine_id).toBe('mc_m300');
    expect(meta.purchasing.manufacturers[0].registry_id).toBe('reg_mfg');
    expect(meta.assemblies[0].linked_preset_guids).toEqual(['p1']);
  });
});
