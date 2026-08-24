import { describe, it, expect } from 'vitest';
import { newHolderRecord, duplicateHolderRecord, holderRecordToFusion } from './holderRecord.js';
import { matchFusionHolder, holderPushPlan, lastPushedFrom } from './holderIdentity.js';
import { matchBakedHolder, backfillHolderIds } from './holderResolve.js';
import { compareHolders, findHolderDuplicates } from '../utils/holderDuplicates.js';

// ─── The shop's real second use of Duplicate ─────────────────────────────────
// A TAP-COLLET version of a holder: the same body with a tap collet fitted, so
// the geometry is IDENTICAL and only the description differs. It exists because
// the description is the only thing that reaches the operator through Fusion and
// ProShop. Two records, same shape, on purpose, forever — which is exactly what
// every "these must be duplicates" rule in the app would otherwise conclude.

const segs = [
  { height: 0.508, 'upper-diameter': 44.907, 'lower-diameter': 45.923 },
  { height: 64.059, 'upper-diameter': 37.998, 'lower-diameter': 28.296 },
];
const config = { types: [], tapers: [], collet_families: [], collet_sizes: [] };

const original = newHolderRecord({
  holder_ref: 'HLD-000001',
  description: 'NBT30-SK13-90',
  unit: 'millimeters',
  segments: segs.map(s => ({ ...s })),
  taper_id: 'bt30', type_id: 'collet', collet_family_id: 'sk', collet_size_id: 'sk13',
  length: 90,
  fusion_guid: 'fusion-guid-1',
  last_pushed: lastPushedFrom({ segments: segs, unit: 'millimeters' }),
});

// Made the way the shop makes it: duplicate, rename, tick Tap collet.
const twin = {
  ...duplicateHolderRecord(original),
  description: 'NBT30-SK13-90 TAP C',
  is_tap_collet: true,
};

const entry = {
  type: 'holder', guid: 'fusion-guid-1', 'product-id': 'HLD-000001',
  description: 'NBT30-SK13-90', unit: 'millimeters',
  segments: segs.map(s => ({ ...s })),
  gaugeLength: segs.reduce((a, s) => a + s.height, 0),
};

describe('a tap-collet twin is never offered as a duplicate', () => {
  it('is not a merge candidate, however perfectly everything else lines up', () => {
    // Same gauge, same taper/type/collet, similar description — before this it
    // scored as a full `duplicate`, the strongest verdict there is.
    expect(compareHolders(original, twin, config)).toBeNull();
    expect(findHolderDuplicates([original, twin], config)).toHaveLength(0);
  });

  it('still finds a REAL duplicate — the rule narrows, it does not switch off', () => {
    const realDupe = { ...duplicateHolderRecord(original), description: 'NBT30-SK13-90' };
    expect(findHolderDuplicates([original, realDupe], config)).toHaveLength(1);
  });

  it('two tap-collet records of the same holder ARE duplicates of each other', () => {
    const secondTwin = { ...duplicateHolderRecord(twin), description: 'NBT30 SK13 90 tap' };
    expect(compareHolders(twin, secondTwin, config)).not.toBeNull();
  });
});

describe('a tap-collet twin does not disturb the tools on the original', () => {
  const records = [original, twin];
  const baked = { ...entry };   // the holder Fusion baked into a tool

  it('a tool carrying the original\'s ID stays confidently on the original', () => {
    const m = matchBakedHolder(baked, 'fusion-guid-1', records);
    expect(m.record.id).toBe(original.id);
    expect(m.confident).toBe(true);
  });

  it('a tool with NO ref baked in is not thrown into "needs a look" either', () => {
    // The twin has never been in Fusion, so no tool can have come from it —
    // the shape is only ambiguous on paper.
    const m = matchBakedHolder({ ...baked, 'product-id': '' }, 'fusion-guid-1', records);
    expect(m.record.id).toBe(original.id);
    expect(m.confident).toBe(true);
  });

  it('leaves the tool linked with no confirmation flag', () => {
    const tool = {
      id: 'FTL-1',
      assemblies: [{ assembly_id: 'a1', instance_guid: 'inst1', holder_guid: 'fusion-guid-1' }],
      _instancesRaw: [{ guid: 'inst1', holder: baked }],
    };
    const [out] = backfillHolderIds([tool], records);
    expect(out.assemblies[0].holder_id).toBe(original.id);
    expect(out.assemblies[0]._linkGuess).toBeUndefined();
  });

  it('once BOTH are in Fusion, the ref is what tells them apart', () => {
    const pushedTwin = { ...twin, fusion_guid: 'fusion-guid-2', last_pushed: lastPushedFrom({ segments: segs, unit: 'millimeters' }) };
    const twinEntry = { ...entry, guid: 'fusion-guid-2', 'product-id': pushedTwin.holder_ref, description: pushedTwin.description };
    const both = [original, pushedTwin];
    expect(matchBakedHolder(baked, 'fusion-guid-1', both).record.id).toBe(original.id);
    expect(matchBakedHolder(twinEntry, 'fusion-guid-2', both).record.id).toBe(pushedTwin.id);
  });
});

describe('a tap-collet twin reaches Fusion as its own holder', () => {
  const records = [original, twin];

  it('the original stays exact, and the twin is created — neither is flagged', () => {
    const plan = holderPushPlan([entry], records, undefined, holderRecordToFusion);
    expect(matchFusionHolder(entry, records).record.id).toBe(original.id);
    expect(plan.flagged).toHaveLength(0);
    expect(plan.creates.map(r => r.id)).toEqual([twin.id]);
  });

  it('after the push each entry resolves to its own record', () => {
    const pushedTwin = { ...twin, fusion_guid: 'fusion-guid-2', last_pushed: lastPushedFrom({ segments: segs, unit: 'millimeters' }) };
    const twinEntry = { ...entry, guid: 'fusion-guid-2', 'product-id': pushedTwin.holder_ref, description: pushedTwin.description };
    const both = [original, pushedTwin];
    expect(matchFusionHolder(entry, both).record.id).toBe(original.id);
    expect(matchFusionHolder(twinEntry, both).record.id).toBe(pushedTwin.id);
    const plan = holderPushPlan([entry, twinEntry], both, undefined, holderRecordToFusion);
    expect(plan.flagged).toHaveLength(0);
    expect(plan.creates).toHaveLength(0);
  });
});

describe('the other duplicate flow — an extension at a different stickout', () => {
  it('stops being a duplicate as soon as the gauge is adjusted', () => {
    const longer = {
      ...duplicateHolderRecord(original),
      description: 'NBT30-SK13-90 EX OOH2.5',
      segments: [...segs.map(s => ({ ...s })), { height: 25, 'upper-diameter': 20, 'lower-diameter': 20 }],
    };
    expect(compareHolders(original, longer, config)).toBeNull();
  });
});
