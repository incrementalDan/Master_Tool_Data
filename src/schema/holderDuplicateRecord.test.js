import { describe, it, expect } from 'vitest';
import { newHolderRecord, duplicateHolderRecord, holderRecordToFusion } from './holderRecord.js';
import { matchFusionHolder, holderPushPlan, lastPushedFrom } from './holderIdentity.js';
import { assemblyUsesHolder } from './holderResolve.js';

const segs = [
  { height: 0.508, 'upper-diameter': 44.907, 'lower-diameter': 45.923 },
  { height: 64.059, 'upper-diameter': 37.998, 'lower-diameter': 28.296 },
];

const source = newHolderRecord({
  holder_ref: 'HLD-000001',
  description: 'NBT30-ER16-120',
  unit: 'millimeters',
  segments: segs.map(s => ({ ...s })),
  manufacturer: 'MARITOOL',
  part_number: 'BT30-ER16-120',
  location: 'Shelf B',
  notes: 'nut backed off',
  fusion_guid: 'fusion-guid-1',
  legacy_ids: ['OLD-REF'],
  legacy_fusion_guids: ['merged-guid'],
  last_pushed: lastPushedFrom({ segments: segs, unit: 'millimeters' }),
  nominal_check: { signature: 'x', at: '2026-01-01' },
  primary_photo_id: 'drive-file-1',
  primary_photo_name: 'holder.jpg',
  attachments: [{ file_id: 'drive-file-2', filename: 'spec.pdf' }],
});

const entry = {
  type: 'holder', guid: 'fusion-guid-1', 'product-id': 'HLD-000001',
  description: 'NBT30-ER16-120', unit: 'millimeters',
  segments: segs.map(s => ({ ...s })),
  gaugeLength: segs.reduce((a, s) => a + s.height, 0),
};

describe('duplicateHolderRecord', () => {
  const copy = duplicateHolderRecord(source);

  it('gets a brand-new identity, and drops every id-shaped link to the original', () => {
    expect(copy.id).not.toBe(source.id);
    expect(copy.holder_ref).not.toBe(source.holder_ref);
    expect(copy.holder_ref).toMatch(/^HLD-/);
    expect(copy.fusion_guid).toBeNull();
    expect(copy.legacy_fusion_guids).toEqual([]);
    expect(copy.legacy_ids).toEqual([]);
    expect(copy.last_pushed).toBeNull();
  });

  it('carries NO tool with it — nothing resolves an assembly to the copy', () => {
    // A tool points at a holder by holder_id or the baked Fusion guid. Both of
    // the original's are on the original, so no assembly can follow the copy.
    const asm = { holder_id: source.id, holder_guid: 'fusion-guid-1' };
    expect(assemblyUsesHolder(asm, source)).toBe(true);
    expect(assemblyUsesHolder(asm, copy)).toBe(false);
  });

  it('keeps what the copy is FOR — geometry, specs, purchasing', () => {
    expect(copy.segments).toEqual(source.segments);
    expect(copy.unit).toBe('millimeters');
    expect(copy.manufacturer).toBe('MARITOOL');
    expect(copy.location).toBe('Shelf B');
    expect(copy.notes).toBe('nut backed off');
  });

  it('never shares a description — the name goes into preset names verbatim', () => {
    expect(copy.description).toBe('NBT30-ER16-120 (copy)');
    expect(copy.description).not.toBe(source.description);
  });

  it('drops the photo and attachments rather than sharing Drive file ids', () => {
    expect(copy.primary_photo_id).toBeNull();
    expect(copy.attachments).toEqual([]);
  });

  it('drops the nominal-length verdict, which was about the other record', () => {
    expect(copy.nominal_check).toBeNull();
  });

  it('is a new object every time — two duplicates are two holders', () => {
    const second = duplicateHolderRecord(source);
    expect(second.id).not.toBe(copy.id);
    expect(second.holder_ref).not.toBe(copy.holder_ref);
  });
});

describe('pushing straight after a duplicate', () => {
  const copy = duplicateHolderRecord(source);
  const records = [source, copy];

  // ⚠️ The copy starts as the SAME SHAPE, so the original's Fusion entry now
  // matches two records by geometry. Before the ref was allowed to settle that,
  // this read as `ambiguous` and the push wrote NEITHER holder.
  it('still matches the original exactly — the ref settles the shared shape', () => {
    const m = matchFusionHolder(entry, records);
    expect(m.status).toBe('exact');
    expect(m.record.id).toBe(source.id);
  });

  it('adds the copy to Fusion as a new holder, and leaves the original alone', () => {
    const plan = holderPushPlan([entry], records, undefined, holderRecordToFusion);
    expect(plan.flagged).toHaveLength(0);
    expect(plan.deletes).toHaveLength(0);
    expect(plan.creates.map(r => r.id)).toEqual([copy.id]);
  });

  it('a shared shape with NO ref on the entry is still ambiguous', () => {
    const m = matchFusionHolder({ ...entry, 'product-id': '' }, records);
    expect(m.status).toBe('ambiguous');
  });
});
