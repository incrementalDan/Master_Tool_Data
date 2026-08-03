// The durable Fusion↔app holder link. Fusion's guid is not a stable identity,
// so the link is the app's own ID (stamped in Fusion's product-id) PLUS a
// segment match — and BOTH must agree before anything acts on it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  segmentsMatch, recordForRef, recordsForGeometry, matchFusionHolder,
  isConfidentMatch, auditFusionHolders, SEGMENT_MATCH_TOL_IN,
  holderPushPlan, applyHolderPushPlan,
} from './holderIdentity.js';
import { fusionHolderToRecord, holderRecordToFusion } from './holderRecord.js';
import { convertHolderUnits } from '../utils/holderGeometry.js';

const REAL = JSON.parse(
  readFileSync(new URL('../../FUSION TOOL Library REF/Master-Holder.json', import.meta.url), 'utf8')
).data;
const F = REAL.find(h => h.description.trim() === 'NBT30-SK13C-60');
const OTHER = REAL.find(h => h.description.trim() !== 'NBT30-SK13C-60'
  && h.segments?.length && h.segments.length !== F.segments.length);

// A record as it exists after import, with its ID pushed back into Fusion's
// product-id — i.e. a holder the app has settled.
const settled = () => fusionHolderToRecord(F);
const pushed = (rec) => holderRecordToFusion(rec);

describe('the guid is not the identity', () => {
  it('a settled holder still matches after Fusion re-issues its guid', () => {
    // THE WHOLE REASON THIS MODULE EXISTS. Fusion's holder guid churns; if it
    // were the link, a settled holder would look like a brand-new one every
    // time that happened, and the library would fill with duplicates.
    const rec = settled();
    const entry = { ...pushed(rec), guid: 'a-completely-different-guid' };
    expect(matchFusionHolder(entry, [rec]).status).toBe('exact');
  });

  it('and matching never reads the guid at all', () => {
    const rec = settled();
    const entry = { ...pushed(rec) };
    delete entry.guid;
    expect(isConfidentMatch(matchFusionHolder(entry, [rec]))).toBe(true);
  });
});

describe('both signals required', () => {
  const rec = settled();

  it('ID + segments agreeing is the only confident match', () => {
    expect(matchFusionHolder(pushed(rec), [rec]).status).toBe('exact');
  });

  it('our ID on a re-shaped holder is FLAGGED, never matched', () => {
    // Someone duplicated the holder in Fusion, edited a segment, and left our
    // product-id on it. Matching it would silently adopt the wrong geometry.
    const entry = pushed(rec);
    entry.segments = entry.segments.map((s, i) => (i === 0 ? { ...s, height: s.height + 5 } : s));
    const m = matchFusionHolder(entry, [rec]);
    expect(m.status).toBe('ref-only');
    expect(m.record).toBeNull();
    expect(m.reason).toMatch(/edited in Fusion/);
  });

  it('the right shape without our ID is FLAGGED, never matched', () => {
    // A Fusion-side duplicate, or the ID was cleared. It may well be the same
    // holder — but "may well be" is a person's call.
    const entry = { ...pushed(rec), 'product-id': '' };
    const m = matchFusionHolder(entry, [rec]);
    expect(m.status).toBe('geometry-only');
    expect(m.record).toBeNull();
  });

  it('ID pointing one way and shape the other is a conflict', () => {
    const a = settled();
    const b = fusionHolderToRecord(OTHER);
    // Carries A's ID but B's shape.
    const entry = { ...pushed(b), 'product-id': a.holder_ref };
    const m = matchFusionHolder(entry, [a, b]);
    expect(m.status).toBe('conflict');
    expect(m.record).toBeNull();
  });

  it('two of our records with the same shape is ambiguous, not a coin flip', () => {
    const a = settled();
    const b = { ...settled(), id: 'dup', holder_ref: 'HLD-DUP' };
    const m = matchFusionHolder({ ...pushed(a), 'product-id': '' }, [a, b]);
    expect(m.status).toBe('ambiguous');
    expect(m.reason).toMatch(/merge them first/);
  });

  it('an unknown Fusion holder is "none" — importable, not a flag', () => {
    expect(matchFusionHolder(pushed(fusionHolderToRecord(OTHER)), [settled()]).status).toBe('none');
  });
});

describe('segment matching', () => {
  it('is unit-agnostic — the same physical holder in mm and inches matches', () => {
    const mmRec = settled();
    const inchRec = convertHolderUnits(mmRec, 'inches');
    expect(segmentsMatch(mmRec.segments, mmRec.unit, inchRec.segments, inchRec.unit)).toBe(true);
  });

  it('absorbs rounding and NOTHING else', () => {
    const rec = settled();
    const tolMm = SEGMENT_MATCH_TOL_IN * 25.4;
    const nudged = (d) => rec.segments.map((s, i) => (i === 0 ? { ...s, height: s.height + d } : s));
    expect(segmentsMatch(rec.segments, rec.unit, nudged(tolMm * 0.5), rec.unit)).toBe(true);
    expect(segmentsMatch(rec.segments, rec.unit, nudged(tolMm * 2), rec.unit)).toBe(false);
  });

  it('a different segment COUNT is a different holder, however close the rest', () => {
    const rec = settled();
    expect(segmentsMatch(rec.segments, rec.unit, rec.segments.slice(1), rec.unit)).toBe(false);
  });

  it('an empty segment list never matches anything', () => {
    expect(segmentsMatch([], 'inches', [], 'inches')).toBe(false);
  });
});

describe('ref lookup', () => {
  it('follows a ref retired by a merge', () => {
    const rec = { ...settled(), legacy_ids: ['HLD-OLD'] };
    expect(recordForRef([rec], 'HLD-OLD')).toBe(rec);
  });

  it('a blank product-id matches nothing', () => {
    expect(recordForRef([settled()], '')).toBeNull();
    expect(recordForRef([settled()], null)).toBeNull();
  });
});

describe('library sweep', () => {
  it('splits the real library into matched / flagged / unknown / unpushed', () => {
    const records = REAL.map(fusionHolderToRecord);
    // Before our IDs are pushed out, most entries have the right shape but
    // carry no ID of ours — so they are flagged, not matched. (A few settle
    // immediately: import keeps whatever was already in Fusion's product-id as
    // a legacy id, so a holder that already had a part number there matches on
    // both signals straight away.) Every entry lands in exactly one bucket.
    const before = auditFusionHolders(REAL, records);
    expect(before.flagged.length).toBeGreaterThan(before.matched.length);
    expect(before.matched.length + before.flagged.length + before.unknown.length)
      .toBe(REAL.length);

    // After pushing our IDs out, everything settles and nothing is flagged.
    const after = auditFusionHolders(records.map(r => holderRecordToFusion(r)), records);
    expect(after.flagged).toHaveLength(0);
    expect(after.unknown).toHaveLength(0);
    expect(after.unpushed).toHaveLength(0);
    expect(after.matched).toHaveLength(records.length);
  });

  it('recordsForGeometry finds every same-shape record, never just the first', () => {
    const a = settled();
    const b = { ...settled(), id: 'dup' };
    expect(recordsForGeometry([a, b], pushed(a))).toHaveLength(2);
  });
});

// ─── Pushing OUT ────────────────────────────────────────────────────────────
// The one holder action that writes to Autodesk. What it refuses to touch
// matters as much as what it writes.
describe('push plan', () => {
  const rec = settled();

  it('bootstraps: our shape + a blank product-id is ADOPTED, so a first push lands', () => {
    // Before any push every settled holder is geometry-only. If that were
    // treated as a flag the push could never get started.
    const entry = { ...pushed(rec), 'product-id': '' };
    const plan = holderPushPlan([entry], [rec]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].kind).toBe('adopt');
    expect(plan.creates).toHaveLength(0);
    expect(plan.flagged).toHaveLength(0);
  });

  it('an already-linked holder is refreshed, not duplicated', () => {
    const plan = holderPushPlan([pushed(rec)], [rec]);
    expect(plan.updates[0].kind).toBe('update');
    expect(plan.creates).toHaveLength(0);
  });

  it('REFUSES to overwrite a half-match, and does not re-add it either', () => {
    // Someone edited this holder's segments in Fusion but left our ID on it.
    // Writing over it would destroy the only evidence of what they changed —
    // and appending the record as a new holder would leave two.
    const entry = pushed(rec);
    entry.segments = entry.segments.map((s, i) => (i === 0 ? { ...s, height: s.height + 5 } : s));
    const plan = holderPushPlan([entry], [rec]);
    expect(plan.updates).toHaveLength(0);
    expect(plan.creates).toHaveLength(0);      // claimed by the flag
    expect(plan.flagged[0].status).toBe('ref-only');
  });

  it('will not adopt a shape whose product-id holds something we do not know', () => {
    // A non-empty product-id is somebody's data. Stamping over it is a write,
    // not a bootstrap.
    const entry = { ...pushed(rec), 'product-id': 'SOMEONE-ELSES-SKU' };
    const plan = holderPushPlan([entry], [rec]);
    expect(plan.updates).toHaveLength(0);
    expect(plan.flagged[0].status).toBe('geometry-only');
  });

  it('a record Fusion has never seen is created', () => {
    const plan = holderPushPlan([], [rec]);
    expect(plan.creates).toEqual([rec]);
  });

  it('leaves non-holder entries and untouched holders byte-for-byte alone', () => {
    // The holder library file may hold other entry types; a write must never
    // drop or reshape them.
    const other = { type: 'tool', guid: 'not-a-holder', description: 'keep me' };
    const strange = { ...pushed(fusionHolderToRecord(OTHER)) };
    const list = [other, strange, { ...pushed(rec), 'product-id': '' }];
    const plan = holderPushPlan(list, [rec]);
    const out = applyHolderPushPlan(list, plan, holderRecordToFusion);
    expect(out[0]).toBe(other);        // same object, untouched
    expect(out[1]).toBe(strange);      // unknown holder, left alone
    expect(out[2]['product-id']).toBe(rec.holder_ref);
  });

  it('one push settles the whole real library, and a second changes nothing', () => {
    const records = REAL.map(fusionHolderToRecord);
    const plan1 = holderPushPlan(REAL, records);
    const after = applyHolderPushPlan(REAL, plan1, holderRecordToFusion);
    expect(auditFusionHolders(after, records).flagged).toHaveLength(0);
    expect(auditFusionHolders(after, records).matched).toHaveLength(records.length);

    // Idempotent: nothing new to create the second time round.
    const plan2 = holderPushPlan(after, records);
    expect(plan2.creates).toHaveLength(0);
    expect(plan2.flagged).toHaveLength(0);
    expect(plan2.updates.every(u => u.kind === 'update')).toBe(true);
  });
});
