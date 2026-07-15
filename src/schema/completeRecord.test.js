// Mode-2 (app-store-primary) fidelity contract — the "preset sync test."
// The app record written by buildMetadataTool must be able to reconstruct the
// SAME tool via buildUnlinkedTool that the Fusion build produced: scalars,
// presets (speeds/feeds + native keys + app-only overlay), assemblies, and the
// flat speed/feed mirror. This is what makes the metadata-first paint
// (loadTools stage 1) and the no-Fusion path trustworthy: if this drifts, the
// provisional library lies. Also locks isCompleteRecord / recordsNeedingBackfill
// (the stage-1 filter + one-time backfill selector).
import { describe, it, expect } from 'vitest';
import {
  buildLogicalTool, buildUnlinkedTool, isCompleteRecord, recordsNeedingBackfill,
} from './logicalTools.js';
import { buildMetadataTool } from './metadataModel.js';

const presetFixture = {
  guid: 'p1',
  name: 'AL 2.125 30-SK13-60 - Rough',
  n: 9200, v_c: 1204, v_f: 55, f_z: 0.0015, v_f_plunge: 12, v_f_retract: 12,
  'tool-coolant': 'flood',
  'use-stepdown': true, stepdown: 0.018,
  'use-stepover': true, stepover: 0.045,
  expressions: { tool_stepdown: '.018 in' },   // un-modeled native pair survives
  material: { query: 'Al Wrought', category: 'metal' },
};

const rawInstance = ({ guid, lb = 2.125, holderGuid = 'H1', presets = [presetFixture] } = {}) => ({
  guid,
  type: 'flat end mill',
  unit: 'inches',
  description: '1/2 4FL EM',
  'product-id': 'A-42',
  'post-process': { comment: 'FTL-ABC123', number: 55 },
  BMC: 'carbide',
  vendor: 'LC-8',
  geometry: { DC: 0.5, LCF: 1.25, OAL: 3, NOF: 4, LB: lb, SFDM: 0.5 },
  holder: { guid: holderGuid, description: 'BT30 SK13 60' },
  'start-values': { presets },
});

// A metadata record carrying the app-only bits Fusion can never hold — the
// overlay (machine link, job links) + tool-level metadata.
const metaFixture = {
  id: 'FTL-ABC123',
  tool_id: 'A-42',
  notes: 'proven on 316L',
  tags: ['roughing'],
  min_ooh: 1.5,
  machine_tool_number: 55,
  preset_meta: { p1: { operation_type: 'rough', machine_id: 'M300', job_ids: ['job-1'] } },
  assemblies: [{
    assembly_id: 'asm-1', instance_guid: 'g1', holder_guid: 'H1',
    holder_description: 'BT30 SK13 60', ooh: 2.125,
    linked_preset_guids: ['p1'], source: 'manual', asm_number: '30-SK13-60-A-42-2.125',
  }],
  purchasing: {
    manufacturers: [{ id: 'm1', name: 'Helical', edp: '12334', edp_url: '', mfg_num: '', mfg_num_url: '', order: 0 }],
    vendors: [{ id: 'v1', manufacturer_id: 'm1', name: 'MSC', vendor_num: '99', vendor_num_url: '', price: 34.76, order: 0 }],
  },
};

const buildLinked = () => {
  const metaByTracking = new Map([[metaFixture.id, metaFixture]]);
  return buildLogicalTool([rawInstance({ guid: 'g1' })], metaByTracking);
};

describe('mode-2 fidelity: Fusion build → buildMetadataTool → buildUnlinkedTool', () => {
  const linked = buildLinked();
  const record = buildMetadataTool(linked);
  const rebuilt = buildUnlinkedTool(record);

  it('the record written by a save is a COMPLETE record', () => {
    expect(isCompleteRecord(record)).toBe(true);
  });

  it('reconstructs the identity + geometry scalars', () => {
    expect(rebuilt.id).toBe(linked.id);
    expect(rebuilt.tracking_id).toBe(linked.tracking_id);
    expect(rebuilt.tool_type).toBe('flat end mill');
    expect(rebuilt.description).toBe('1/2 4FL EM');
    expect(rebuilt.unit).toBe('inches');
    expect(rebuilt.tool_id).toBe('A-42');
    expect(rebuilt.diameter).toBe(0.5);
    expect(rebuilt.flute_length).toBe(1.25);
    expect(rebuilt.overall_length).toBe(3);
    expect(rebuilt.number_of_flutes).toBe(4);
    expect(rebuilt.material).toBe('carbide');
    expect(rebuilt.machine_tool_number).toBe(55);
    expect(rebuilt.min_ooh).toBe(1.5);
  });

  it('reconstructs the full preset — speeds/feeds, native keys, expressions (the preset sync contract)', () => {
    expect(rebuilt.presets).toHaveLength(1);
    const p = rebuilt.presets[0];
    const src = linked.presets[0];
    expect(p.guid).toBe('p1');                       // stable guid — job/assembly links stay valid
    expect(p.name).toBe(src.name);
    for (const f of ['n', 'v_c', 'v_f', 'f_z', 'v_f_plunge', 'v_f_retract']) {
      expect(p[f]).toBe(src[f]);
    }
    expect(p['tool-coolant']).toBe('flood');
    expect(p['use-stepdown']).toBe(true);
    expect(p.stepdown).toBe(0.018);
    expect(p['use-stepover']).toBe(true);
    expect(p.stepover).toBe(0.045);
    expect(p.expressions).toEqual({ tool_stepdown: '.018 in' }); // un-modeled pair preserved
    expect(p.material?.query).toBe('Al Wrought');
  });

  it('reconstructs the app-only preset overlay (operation type, machine link, job links)', () => {
    const p = rebuilt.presets[0];
    expect(p.operation_type).toBe('rough');
    expect(p.machine_id).toBe('M300');
    expect(p.job_ids).toEqual(['job-1']);
  });

  it('reconstructs assemblies with stable ids and preset links', () => {
    expect(rebuilt.assemblies).toHaveLength(1);
    const a = rebuilt.assemblies[0];
    expect(a.assembly_id).toBe('asm-1');
    expect(a.holder_guid).toBe('H1');
    expect(a.ooh).toBe(2.125);
    expect(a.linked_preset_guids).toEqual(['p1']);
    expect(a.asm_number).toBe('30-SK13-60-A-42-2.125');
  });

  it('derives the flat speed/feed mirror from preset 0 (O1)', () => {
    expect(rebuilt.spindle_speed).toBe(9200);
    expect(rebuilt.cutting_feedrate).toBe(55);
    expect(rebuilt.feed_per_tooth).toBe(0.0015);
    expect(rebuilt.plunge_feedrate).toBe(12);
  });

  it('keeps metadata-only tool fields (notes, tags, purchasing)', () => {
    expect(rebuilt.notes).toBe('proven on 316L');
    expect(rebuilt.tags).toEqual(['roughing']);
    expect(rebuilt.purchasing.manufacturers[0].name).toBe('Helical');
    expect(rebuilt.purchasing.vendors[0].price).toBe(34.76);
  });

  it('a linked tool rebuilt from its record is NOT spuriously marked no-Fusion', () => {
    expect(rebuilt.no_fusion_link).toBe(false);
  });
});

describe('isCompleteRecord — the stage-1 paint / backfill gate', () => {
  it('rejects null and the old overlay-shape records', () => {
    expect(isCompleteRecord(null)).toBe(false);
    expect(isCompleteRecord(undefined)).toBe(false);
    // Pre-increment-1 overlay: extras only, no scalars, no presets key.
    expect(isCompleteRecord({ id: 'FTL-1', notes: 'x', tags: [] })).toBe(false);
    // Increment-1-only record (scalars, but presets never persisted).
    expect(isCompleteRecord({ id: 'FTL-1', tool_type: 'drill' })).toBe(false);
  });

  it('accepts a complete record — an EMPTY presets array is legit (a preset-less tool)', () => {
    expect(isCompleteRecord({ id: 'FTL-1', tool_type: 'drill', presets: [] })).toBe(true);
    expect(isCompleteRecord({ id: 'FTL-1', tool_type: 'drill', presets: [{ guid: 'p' }] })).toBe(true);
  });
});

describe('recordsNeedingBackfill — one-time complete-record backfill selector', () => {
  const tools = [
    { tracking_id: 'FTL-1' },   // complete record → skip
    { tracking_id: 'FTL-2' },   // overlay record → backfill
    { tracking_id: 'FTL-3' },   // no record at all → backfill
    { tracking_id: null },      // untracked → never (no stable key)
  ];
  const metaList = [
    { id: 'FTL-1', tool_type: 'drill', presets: [] },
    { id: 'FTL-2', notes: 'overlay only' },
    // FTL-ORPHAN: metadata for a tool deleted directly in Fusion (no built tool).
    { id: 'FTL-ORPHAN', notes: 'dormant' },
  ];

  it('selects exactly the built tools with a missing/incomplete record', () => {
    const needs = recordsNeedingBackfill(tools, metaList);
    expect(needs.map(t => t.tracking_id)).toEqual(['FTL-2', 'FTL-3']);
  });

  it('never touches orphan metadata (the orphan-ghost guard invariant)', () => {
    const needs = recordsNeedingBackfill(tools, metaList);
    expect(needs.some(t => t.tracking_id === 'FTL-ORPHAN')).toBe(false);
  });

  it('is a no-op once every built tool has a complete record', () => {
    const done = [{ id: 'FTL-1', tool_type: 'drill', presets: [] }];
    expect(recordsNeedingBackfill([{ tracking_id: 'FTL-1' }], done)).toEqual([]);
  });
});
