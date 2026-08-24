import { describe, it, expect } from 'vitest';
import {
  fusionHolderConflicts, fusionConflictFor, adoptFusionHolderGeometry,
  keepAppHolderGeometry, matchFusionHolder, holderPushPlan, lastPushedFrom,
  holdersOutOfSync,
} from './holderIdentity.js';
import { newHolderRecord, holderRecordToFusion } from './holderRecord.js';

// The real case: an NBT30-ER16-120 the user drew in the app, pushed, then
// corrected IN FUSION by adding the 1.02mm segment at the spindle end that
// makes the gauge come out at the engraved 120 nominal.
const appSegs = [
  { height: 0.508, 'upper-diameter': 44.907, 'lower-diameter': 45.923 },
  { height: 7.366, 'upper-diameter': 45.923, 'lower-diameter': 45.923 },
  { height: 64.059, 'upper-diameter': 37.998, 'lower-diameter': 28.296 },
  { height: 1.600, 'upper-diameter': 27.965, 'lower-diameter': 24.765 },
];
const fusionSegs = [{ height: 1.02, 'upper-diameter': 31.75, 'lower-diameter': 31.75 }, ...appSegs];

const record = (over = {}) => newHolderRecord({
  holder_ref: 'HLD-000001',
  description: 'NBT30-ER16-120',
  unit: 'millimeters',
  segments: appSegs.map(s => ({ ...s })),
  ...over,
});

// A Fusion entry carrying our ref. No gauge expression, and a gaugeLength equal
// to the full stack, so every segment reads as below the gauge line.
const entry = (segs, over = {}) => ({
  type: 'holder',
  guid: 'fusion-guid-1',
  'product-id': 'HLD-000001',
  description: 'NBT30-ER16-120',
  unit: 'millimeters',
  segments: segs.map(s => ({ ...s })),
  gaugeLength: segs.reduce((a, s) => a + s.height, 0),
  ...over,
});

describe('a holder edited in Fusion', () => {
  const pushed = record({ last_pushed: lastPushedFrom({ segments: appSegs, unit: 'millimeters' }) });

  it('is ref-only — the app cannot write it, which is why it needs a decision', () => {
    const m = matchFusionHolder(entry(fusionSegs), [pushed]);
    expect(m.status).toBe('ref-only');
    const plan = holderPushPlan([entry(fusionSegs)], [pushed], undefined, holderRecordToFusion);
    expect(plan.updates).toHaveLength(0);
    expect(plan.flagged).toHaveLength(1);
  });

  it('is offered as a resolvable conflict, and names FUSION as the side that moved', () => {
    const rows = fusionHolderConflicts([entry(fusionSegs)], [pushed]);
    expect(rows).toHaveLength(1);
    expect(rows[0].record.id).toBe(pushed.id);
    expect(rows[0].direction).toBe('fusion');
    expect(fusionConflictFor(rows, pushed)).toBe(rows[0]);
  });

  it("says it cannot tell which side moved when the record was never pushed", () => {
    const rows = fusionHolderConflicts([entry(fusionSegs)], [record()]);
    expect(rows[0].direction).toBe('unknown');
  });

  it('an app-side redraw is NOT a conflict — the push writes that', () => {
    // Fusion still holds what we last gave it; the app is the side that moved.
    const redrawn = record({
      segments: fusionSegs.map(s => ({ ...s })),
      last_pushed: lastPushedFrom({ segments: appSegs, unit: 'millimeters' }),
    });
    expect(fusionHolderConflicts([entry(appSegs)], [redrawn])).toHaveLength(0);
    const plan = holderPushPlan([entry(appSegs)], [redrawn], undefined, holderRecordToFusion);
    expect(plan.updates).toHaveLength(1);
  });

  it('a holder the two libraries agree on raises nothing', () => {
    expect(fusionHolderConflicts([entry(appSegs)], [pushed])).toHaveLength(0);
  });
});

describe('accepting Fusion\'s geometry', () => {
  const pushed = record({ last_pushed: lastPushedFrom({ segments: appSegs, unit: 'millimeters' }) });
  const e = entry(fusionSegs);

  it('takes the shape across', () => {
    const next = adoptFusionHolderGeometry(pushed, e);
    expect(next.segments).toHaveLength(5);
    expect(next.segments[0].height).toBeCloseTo(1.02, 6);
  });

  it('derives above_gauge rather than copying raw segments — Fusion has no such field', () => {
    // Gauge expression naming only the two segments nearest the tip: everything
    // else sits inside the spindle. Fusion numbers segments top-down, the array
    // is stored bottom-first — the import's conversion is what knows that.
    const withExpr = entry(fusionSegs, {
      expressions: { tool_holderGaugeLength: 'segment_1_height+segment_2_height' },
    });
    const next = adoptFusionHolderGeometry(pushed, withExpr);
    expect(next.segments.map(s => s.above_gauge)).toEqual([true, true, true, false, false]);
  });

  it('leaves the app-owned description alone — geometry only', () => {
    const next = adoptFusionHolderGeometry(pushed, entry(fusionSegs, { description: 'RENAMED IN FUSION' }));
    expect(next.description).toBe('NBT30-ER16-120');
  });

  it('CLEARS the flag — the two now match, and a second pass has nothing to do', () => {
    const next = adoptFusionHolderGeometry(pushed, e);
    expect(matchFusionHolder(e, [next]).status).toBe('exact');
    expect(fusionHolderConflicts([e], [next])).toHaveLength(0);
    expect(adoptFusionHolderGeometry(next, e).segments).toEqual(next.segments);
  });

  it('does not then ask to push our old geometry straight back', () => {
    const next = adoptFusionHolderGeometry(pushed, e);
    const plan = holderPushPlan([e], [next], undefined, holderRecordToFusion);
    // It is an ordinary update now, not a flag — and what it would write to
    // Fusion carries Fusion's OWN geometry, not the shape we just replaced.
    // (A push may still have text/expression fields to settle; the geometry is
    // the thing that must not bounce back.)
    expect(plan.flagged).toHaveLength(0);
    expect(plan.creates).toHaveLength(0);
    expect(holderRecordToFusion(next, e).segments).toEqual(e.segments);
  });

  it('returns the same reference when the shapes already agree', () => {
    expect(adoptFusionHolderGeometry(pushed, entry(appSegs))).toBe(pushed);
  });
});

describe('overruling Fusion', () => {
  const pushed = record({ last_pushed: lastPushedFrom({ segments: appSegs, unit: 'millimeters' }) });
  const e = entry(fusionSegs);

  it('keeps the record untouched but makes the push write it', () => {
    const next = keepAppHolderGeometry(pushed, e);
    expect(next.segments).toEqual(pushed.segments);
    const plan = holderPushPlan([e], [next], undefined, holderRecordToFusion);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].stale).toBe(true);
    expect(plan.flagged).toHaveLength(0);
  });

  it('clears the flag, and is idempotent', () => {
    const next = keepAppHolderGeometry(pushed, e);
    expect(fusionHolderConflicts([e], [next])).toHaveLength(0);
    expect(keepAppHolderGeometry(next, e)).toBe(next);
  });

  it('counts as out of sync once decided — the push now has real work', () => {
    const next = keepAppHolderGeometry(pushed, e);
    expect(holdersOutOfSync([e], [next], holderRecordToFusion)).toBe(1);
  });
});
