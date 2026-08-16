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
//   3. ⚠️ NO LINK EVER STORES A HUMAN-FACING IDENTIFIER. Not a ProShop number,
//      not a description, not a machine number, not a location string. This is
//      not a preference to be weighed per feature — it is the invariant the
//      SQLite migration rests on, and every one of those values is deliberately
//      MUTABLE (a ProShop number is re-numberable by design; that is what
//      `legacy_ids` exists for). A link built on one silently severs the moment
//      the shop renumbers, renames or re-files anything.
//
//      Rules 1 and 2 assume the right thing was stored. Rule 3 is what makes
//      that structural instead of remembered — it scans the WHOLE record and
//      fails on any link-shaped field, INCLUDING ONE THAT DOES NOT EXIST YET.
//
// When you add a relationship, add it to the inventory table in CLAUDE.md AND to
// FK_ROUND_TRIP below. If you add a link-shaped field, LINK_SHAPED_KEYS must
// cover it or these tests fail — that is deliberate.
import { describe, it, expect } from 'vitest';
import { DEFAULT_MATERIALS, DEFAULT_PARTS } from './sharedDefaults.js';
import { DEFAULT_VENDOR_REGISTRY } from './vendorRegistry.js';
import { buildMetadataTool } from './metadataModel.js';
import { buildUnlinkedTool } from './logicalTools.js';
import { DEFAULT_HOLDER_CONFIG, HOLDER_OPTION_LISTS, seedHolderConfig } from './holderOptions.js';

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

  it('shop_settings.holder_config: collet sizes point at real families, ids unique', () => {
    const C = DEFAULT_HOLDER_CONFIG;
    const familyIds = ids(C.collet_families);
    expect(C.collet_sizes.filter(s => s.family_id && !familyIds.has(s.family_id)).map(s => s.id)).toEqual([]);
    for (const list of HOLDER_OPTION_LISTS) expect(dupes(C[list])).toBe(0);
  });

  it('shop_settings.holder_config: seed option ids are STABLE, not regenerated', () => {
    // These ids are stored on every holder record. If the seed minted a fresh
    // UUID per load, every reference would dangle after a refresh — which is
    // exactly what happened once. Two independent seeds must agree.
    const a = seedHolderConfig();
    const b = seedHolderConfig();
    for (const list of HOLDER_OPTION_LISTS) {
      expect(a[list].map(x => x.id)).toEqual(b[list].map(x => x.id));
      expect(a[list].every(x => x.id && !/^[0-9a-f-]{36}$/i.test(x.id))).toBe(true);
    }
  });

  it('parts.json: routings point at real parts, operations at real routings', () => {
    const partIds = ids(DEFAULT_PARTS.parts);
    const routingIds = ids(DEFAULT_PARTS.routings);
    expect((DEFAULT_PARTS.routings || []).filter(r => r.part_id && !partIds.has(r.part_id))).toEqual([]);
    expect((DEFAULT_PARTS.operations || []).filter(o => o.routing_id && !routingIds.has(o.routing_id))).toEqual([]);
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
  speed_feed_refs: [{ preset_id: 'pre_N_al_wrought', operation_type: 'rough', sfm: 350, chip_load: 0.002 }],
  pairing: { family: 'milling_insert', holder_component_id: 'cmp_h', insert_component_id: 'cmp_i', rta_number: '' },
  purchasing: {
    manufacturers: [{ id: 'm1', registry_id: 'reg_mfg', name: 'Helical Solutions', edp: '1', order: 0 }],
    vendors: [{ id: 'v1', manufacturer_id: 'm1', registry_id: 'reg_vendor', name: 'MSC Industrial', order: 0 }],
  },
  assemblies: [{
    assembly_id: 'as1', instance_guid: 'inst-guid-1',
    holder_id: 'hold-rec-1', holder_guid: 'hold-guid-1',
    holder_description: 'NBT30-SK13C-60', ooh: 2.125,
    linked_preset_guids: ['p1'], asm_number: '30-SK13-60-1001-2.125',
  }],
  presets: [{
    guid: 'p1', name: 'AL 2.125 30-SK13-60 - Rough', n: 9000, v_f: 50,
    material: { category: 'metal', query: 'Al Wrought', 'use-hardness': false },
    material_preset_id: 'pre_N_al_wrought',
    machine_id: 'mc_m300',
    assembly_id: 'as1',
    operation_ids: ['op_a'],
  }],
};

// path → expected. Each row is one arrow in the CLAUDE.md inventory table.
const FK_ROUND_TRIP = [
  ['assembly → Fusion entry',        t => t.assemblies[0].instance_guid,            'inst-guid-1'],
  ['assembly → holder record (the FK)', t => t.assemblies[0].holder_id,             'hold-rec-1'],
  ['assembly → holder (Fusion mirror)', t => t.assemblies[0].holder_guid,           'hold-guid-1'],
  ['assembly → presets (reverse idx)', t => t.assemblies[0].linked_preset_guids,     ['p1']],
  ['preset → assembly (the FK)',     t => t.presets[0].assembly_id,                 'as1'],
  ['preset → CAM preset',            t => t.presets[0].material_preset_id,          'pre_N_al_wrought'],
  ['preset → machine',               t => t.presets[0].machine_id,                  'mc_m300'],
  // A preset's link to the operation it was proven on. There is deliberately NO
  // tool-level equivalent: "where is this tool used" is derived from the stored
  // Sequence Detail (program_details rows carry tool_ref), so it can't go stale.
  ['preset → operation',             t => t.presets[0].operation_ids,               ['op_a']],
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
    expect(meta.preset_meta.p1.assembly_id).toBe('as1');
  });
});

// ─── RULE 3: no link ever stores a human-facing identifier ──────────────────
//
// The two tests above both assume the correct value was stored in the first
// place. This one removes the assumption. It builds a tool whose HUMAN
// identifiers are all distinctive sentinels, produces the metadata record, and
// walks every value in it — so it fails on a link-shaped field that does not
// exist yet, which is the whole point. A rule that only holds while someone
// remembers it is not a rule.

// The human-facing identifiers a link must NEVER be built on. Each is mutable
// by design, which is exactly why it is unusable as a key:
//   tool_id        — re-numberable (that is what legacy_ids exists for)
//   description    — renamed constantly (the whole Description Rename workflow)
//   location       — changes when a tool is re-filed
//   machine number — reassigned per job
const HUMAN_IDENTIFIERS = {
  tool_id: 'PS-4242',
  description: 'HUMAN-DESCRIPTION-SENTINEL',
  location: 'HUMAN-LOCATION-SENTINEL',
  machine_tool_number: 987654,
};

// Where a human identifier is legitimately STORED (as data to display or match
// on) rather than used as a link. Anything outside this set is a defect.
const HUMAN_ID_ALLOWED_PATHS = [
  /^tool_id$/,                     // the ProShop number itself
  /^legacy_ids\[\d+\]$/,           // retired ProShop numbers, kept for matching
  /^description$/,
  /^location$/,
  /^machine_tool_number$/,
  /^assemblies\[\d+\]\.holder_description$/,  // cached label, not a link
  /^assemblies\[\d+\]\.asm_number$/,          // composed FROM other fields
  /^preferred_machine$/,                      // display name derived from the FK
];

// Every link-shaped key the metadata record is allowed to contain. A NEW key
// matching the link shape must be added here — that failure is the trap: it
// forces a look at whether the new field stores an id.
const LINK_SHAPED_KEYS = new Set([
  'id', 'tracking_id',                                   // the record's own keys
  'tool_id',                                             // NOT a link — the ProShop display number
  'legacy_ids',
  'assembly_id', 'instance_guid', 'holder_id', 'holder_guid', 'linked_preset_guids',
  // Pre-assemblies legacy field. A Fusion holder guid, so a HINT and never an
  // identity (see "Holder identity" — Fusion re-issues these). Surfaced by the
  // trap below, which is how it got into the inventory at all.
  'selected_holder_guid',
  'legacy_asm_numbers',
  'material_preset_id', 'machine_id', 'operation_ids', 'preset_id',
  'preferred_machine_id', 'bin_size_id', 'system_id', 'zone_id', 'station_id', 'drawer_id',
  'holder_component_id', 'insert_component_id', 'holder_proshop_id', 'insert_proshop_id',
  'registry_id', 'manufacturer_id',
  'linked_tools',
  'file_id', 'primary_photo_id',                         // Google Drive file handles
  'library_id',
]);

const LINK_SHAPE = /(_id|_ids|_guid|_guids)$/;
const isLinkShaped = (key) => LINK_SHAPE.test(key) || key.startsWith('linked_') || key === 'id';

// Walk every leaf, remembering the path we reached it by.
function walk(node, path, visit) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, `${path}[${i}]`, visit));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      visit(k, v, path ? `${path}.${k}` : k);
      walk(v, path ? `${path}.${k}` : k, visit);
    }
  }
}

describe('no link ever stores a human-facing identifier', () => {
  // A tool carrying BOTH a stable tracking id and a distinct ProShop number,
  // linked to a partner that also has both — so storing the wrong one is
  // detectable rather than coincidentally identical.
  const LINKED_TOOL = {
    ...FK_TOOL,
    ...HUMAN_IDENTIFIERS,
    legacy_ids: ['PS-OLD-1'],
    linked_tools: ['FTL-PARTNER'],
  };
  const meta = buildMetadataTool(LINKED_TOOL);

  it('the ProShop number appears ONLY where it is the displayed value', () => {
    const offenders = [];
    walk(meta, '', (_k, v, path) => {
      if (v !== HUMAN_IDENTIFIERS.tool_id) return;
      if (HUMAN_ID_ALLOWED_PATHS.some(re => re.test(path))) return;
      offenders.push(path);
    });
    expect(offenders, `ProShop number stored at: ${offenders.join(', ')}`).toEqual([]);
  });

  it('no description, location or machine number is used as a key', () => {
    const offenders = [];
    const humans = new Set(Object.values(HUMAN_IDENTIFIERS));
    walk(meta, '', (_k, v, path) => {
      if (!humans.has(v)) return;
      if (HUMAN_ID_ALLOWED_PATHS.some(re => re.test(path))) return;
      offenders.push(`${path} = ${v}`);
    });
    expect(offenders, `human identifier used as a link at: ${offenders.join(', ')}`).toEqual([]);
  });

  it('the tool↔tool link stores the partner’s tracking id', () => {
    expect(meta.linked_tools).toEqual(['FTL-PARTNER']);
  });

  // ⚠️ THE TRAP THAT CLOSES ON FIELDS THAT DO NOT EXIST YET. Add a link-shaped
  // field and this fails until it is registered above — which is the moment to
  // check that it holds an id and not a ProShop number.
  it('every link-shaped field in the record is a known relationship', () => {
    const unknown = new Set();
    walk(meta, '', (k) => { if (isLinkShaped(k) && !LINK_SHAPED_KEYS.has(k)) unknown.add(k); });
    expect(
      [...unknown],
      `Unregistered link-shaped field(s): ${[...unknown].join(', ')}. `
      + 'A link stores a STABLE ID — never a ProShop number, description or location. '
      + 'Add it to LINK_SHAPED_KEYS and to the inventory table in CLAUDE.md.',
    ).toEqual([]);
  });

  // Every registered link that carries a value must carry an ID-shaped one: a
  // uuid, a tracking id, or a slug — never `A-1` / `D-128`, the ProShop shape.
  it('no link value has the shape of a ProShop number', () => {
    const PROSHOP_SHAPE = /^[A-Za-z]{1,3}-\d+$/;
    const offenders = [];
    walk(meta, '', (k, v, path) => {
      if (!isLinkShaped(k) || k === 'tool_id' || k === 'legacy_ids') return;
      for (const val of Array.isArray(v) ? v : [v]) {
        if (typeof val === 'string' && PROSHOP_SHAPE.test(val)) offenders.push(`${path} = ${val}`);
      }
    });
    expect(offenders, `ProShop-shaped value in a link field: ${offenders.join(', ')}`).toEqual([]);
  });
});
