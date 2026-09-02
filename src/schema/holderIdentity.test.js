// The durable Fusion↔app holder link. Fusion's guid is not a stable identity,
// so the link is the app's own ID (stamped in Fusion's product-id) PLUS a
// segment match — and BOTH must agree before anything acts on it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  segmentsMatch, recordForRef, recordsForGeometry, matchFusionHolder,
  isConfidentMatch, auditFusionHolders, SEGMENT_MATCH_TOL_IN,
  holderPushPlan, applyHolderPushPlan, holdersOutOfSync,
  holderPushDiff, fusionEntryIsStale, pushChangeGroup, PUSH_GROUPS,
  lastPushedFrom, matchesLastPush, retiredHolderFor, isFusionSideCopy,
  conflictResolvableToShape,
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

// ─── "If Fusion has a place for it, Fusion must have it" ────────────────────
// See the CLAUDE.md section of that name. The failure this locks: work done in
// the app on a Fusion-native field looks settled because the IDENTITY still
// matches, while Fusion quietly holds the old value. If this app went away,
// that work would be gone from a system that had a field for it.
describe('out-of-sync detection', () => {
  const rec = settled();
  const inFusion = () => pushed(rec);

  it('a settled holder reports nothing to push', () => {
    expect(holdersOutOfSync([inFusion()], [rec], holderRecordToFusion)).toBe(0);
  });

  it('RENAMING in the app is out of sync, even though identity still matches', () => {
    // The description is Fusion-native. Editing it doesn't move the segments,
    // so matchFusionHolder still says 'exact' — which is why counting only
    // unmatched records let a rename sit unpushed forever.
    const renamed = { ...rec, description: 'NBT30-SK13C-60 (re-measured)' };
    expect(matchFusionHolder(inFusion(), [renamed]).status).toBe('exact');
    expect(holdersOutOfSync([inFusion()], [renamed], holderRecordToFusion)).toBe(1);
  });

  it('a vendor or part-number edit counts too', () => {
    const edited = { ...rec, vendor: 'Maritool' };
    expect(holdersOutOfSync([inFusion()], [edited], holderRecordToFusion)).toBe(1);
  });

  it('a record Fusion has never seen counts', () => {
    expect(holdersOutOfSync([], [rec], holderRecordToFusion)).toBe(1);
  });

  it('the push then clears it — the count is actionable, not decorative', () => {
    const renamed = { ...rec, description: 'NBT30-SK13C-60 (re-measured)' };
    const list = [inFusion()];
    const plan = holderPushPlan(list, [renamed], undefined, holderRecordToFusion);
    const after = applyHolderPushPlan(list, plan, holderRecordToFusion);
    expect(holdersOutOfSync(after, [renamed], holderRecordToFusion)).toBe(0);
  });

  it('the plan applies to an EQUAL list, not only the identical one', () => {
    // The plan and the write are handed the same array in practice, but keying
    // on object identity meant a rebuilt array silently applied nothing — the
    // write appeared to run and changed nothing.
    const renamed = { ...rec, description: 'NBT30-SK13C-60 (re-measured)' };
    const plan = holderPushPlan([inFusion()], [renamed], undefined, holderRecordToFusion);
    const after = applyHolderPushPlan([inFusion()], plan, holderRecordToFusion);
    expect(after[0].description).toBe('NBT30-SK13C-60 (re-measured)');
  });

  it('an app-only field never makes a record look out of sync', () => {
    // Fusion has nowhere to put these, so editing them is not a sync problem —
    // flagging them would make the badge permanent noise.
    const noted = { ...rec, notes: 'lives in the top drawer', location: 'A-4', type_id: 'ht-collet' };
    expect(holdersOutOfSync([inFusion()], [noted], holderRecordToFusion)).toBe(0);
  });
});

// "N refreshed" has to be true and has to be explainable. Both were broken:
// float noise made it overcount, and a bare count couldn't say which or why.
describe('what a push would change', () => {
  const rec = settled();

  it('float round-trip noise is NOT a change', () => {
    // 54.999 comes back from JSON as 54.998999999999995. String comparison
    // called that stale, so holders were listed as needing a push when nothing
    // meaningful differed — and the words "Fusion is holding older values"
    // were untrue for them.
    const entry = pushed(rec);
    const noisy = { ...entry, gaugeLength: entry.gaugeLength + 1e-12 };
    expect(holderPushDiff(noisy, entry)).toEqual([]);
    expect(fusionEntryIsStale(noisy, rec, holderRecordToFusion)).toBe(false);
  });

  it('a real change IS reported, in readable terms', () => {
    const entry = { ...pushed(rec), 'product-id': '' };
    const diff = holderPushDiff(entry, holderRecordToFusion(rec, entry));
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({ key: 'product-id', label: 'App ID', from: '(blank)' });
    expect(diff[0].to).toBe(rec.holder_ref);
  });

  it('a trim says what happened — a trailing space is invisible in a diff', () => {
    const entry = { ...pushed(rec), description: `${rec.description} ` };
    const diff = holderPushDiff(entry, holderRecordToFusion(rec, entry));
    const name = diff.find(d => d.key === 'description');
    expect(name.note).toBe('extra spaces removed');
  });

  it('expressions are not double-reported alongside the field they mirror', () => {
    // Fusion re-derives tool_description from description; listing both would
    // report one rename twice.
    const entry = { ...pushed(rec), description: 'Renamed in the app' };
    const diff = holderPushDiff(entry, holderRecordToFusion(rec, entry));
    expect(diff.filter(d => d.key.startsWith('expressions'))).toHaveLength(0);
    expect(diff.some(d => d.key === 'description')).toBe(true);
  });

  it('on the REAL library, every flagged holder has a stated reason', () => {
    const records = REAL.map(fusionHolderToRecord);
    const plan = holderPushPlan(REAL, records, undefined, holderRecordToFusion);
    const stale = plan.updates.filter(u => u.stale);
    expect(stale.length).toBeGreaterThan(0);
    for (const u of stale) expect(u.diff.length).toBeGreaterThan(0);
    // And most of them are a pure ID stamp — the reassuring case.
    const idOnly = stale.filter(u => u.diff.length === 1 && u.diff[0].key === 'product-id');
    expect(idOnly.length).toBeGreaterThan(stale.length / 2);
  });
});

// A list of twenty holders reads as twenty decisions unless it's grouped by
// what KIND of change each one is — which is what tells you whether to look.
describe('grouping a change by kind', () => {
  const g = (...keys) => pushChangeGroup(keys.map(key => ({ key })));

  it('geometry outranks everything — it is the one worth reading', () => {
    expect(g('segments')).toBe('geometry');
    expect(g('gaugeLength')).toBe('geometry');
    expect(g('segments', 'description', 'product-id')).toBe('geometry');
  });

  it('text beats a bare ID stamp', () => {
    expect(g('description')).toBe('text');
    expect(g('vendor', 'product-id')).toBe('text');
  });

  it('an ID stamp on its own is the quiet group', () => {
    expect(g('product-id')).toBe('id');
  });

  it('every holder lands in exactly one group', () => {
    const records = REAL.map(fusionHolderToRecord);
    const plan = holderPushPlan(REAL, records, undefined, holderRecordToFusion);
    const stale = plan.updates.filter(u => u.stale);
    const groups = stale.map(u => pushChangeGroup(u.diff));
    expect(groups.every(x => x in PUSH_GROUPS)).toBe(true);
    expect(groups).toHaveLength(stale.length);
    // On a first push nothing's geometry moves — it was read from Fusion.
    expect(groups.filter(x => x === 'geometry')).toHaveLength(0);
  });
});

// ─── The push must SETTLE ───────────────────────────────────────────────────
// A holder ping-ponged between two GUIDs forever: the push wrote the record's
// remembered guid over the entry's, then stamped the record's fusion_guid back
// from the PRE-write entry, so the next push wanted to swap them again. The
// page never reached zero to write.
describe('a push settles', () => {
  const rec = settled();

  it('NEVER rewrites an existing entry’s Fusion GUID', () => {
    // Identity deliberately ignores the guid, so a record can match an entry
    // whose guid differs from the one it remembers. That is not a licence to
    // change the entry's identity in Fusion — every tool has that guid baked in.
    const stale = { ...rec, fusion_guid: 'a-guid-the-record-remembers' };
    const entry = { ...pushed(rec), guid: 'the-guid-fusion-actually-has' };
    const next = holderRecordToFusion(stale, entry);
    expect(next.guid).toBe('the-guid-fusion-actually-has');
    expect(holderPushDiff(entry, next).some(d => d.key === 'guid')).toBe(false);
  });

  it('a record with no entry yet still gets a deterministic guid', () => {
    expect(holderRecordToFusion(rec, null).guid).toBe(rec.fusion_guid);
    const noGuid = { ...rec, fusion_guid: null };
    expect(holderRecordToFusion(noGuid, null).guid).toBe(noGuid.id);
  });

  it('the whole real library reaches zero and STAYS there', () => {
    const records = REAL.map(fusionHolderToRecord);
    let list = REAL;
    for (let round = 0; round < 3; round++) {
      const plan = holderPushPlan(list, records, undefined, holderRecordToFusion);
      list = applyHolderPushPlan(list, plan, holderRecordToFusion);
      if (round === 0) expect(plan.updates.filter(u => u.stale).length).toBeGreaterThan(0);
      else expect(plan.updates.filter(u => u.stale)).toHaveLength(0);   // settled
    }
    expect(holdersOutOfSync(list, records, holderRecordToFusion)).toBe(0);
  });

  it('an unexpected field is never filed under "ID only"', () => {
    // That group's header says "nothing but the app's ID" — putting anything
    // else there makes the sentence a lie and hides exactly this class of bug.
    expect(pushChangeGroup([{ key: 'guid' }])).toBe('other');
    expect(pushChangeGroup([{ key: 'product-id' }, { key: 'guid' }])).toBe('other');
    expect(pushChangeGroup([{ key: 'product-id' }])).toBe('id');
  });
});

// ─── One record, one Fusion entry ───────────────────────────────────────────
// Merging duplicates HERE retires the loser's ref into legacy_ids, so both of
// Fusion's copies then resolve to the surviving record. Writing that record to
// both would stamp one app ID onto two holders — a duplicate the library could
// never tell apart again.
describe('a record is never written to two Fusion entries', () => {
  it('flags the second copy instead of stamping the same ID twice', () => {
    const record = fusionHolderToRecord(REAL[0]);
    // Two Fusion entries of the identical holder — the shape of a library
    // straight after an in-app merge.
    const a = { ...holderRecordToFusion(record, REAL[0]) };
    const b = { ...a, guid: 'the-duplicate-fusion-entry' };

    const plan = holderPushPlan([a, b], [record], undefined, holderRecordToFusion);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].index).toBe(0);
    expect(plan.creates).toHaveLength(0);          // never ALSO appended
    expect(plan.flagged).toHaveLength(1);
    expect(plan.flagged[0].status).toBe('duplicate-entry');

    // And the untouched copy is returned byte-for-byte.
    const next = applyHolderPushPlan([a, b], plan, holderRecordToFusion);
    expect(next[1]).toBe(b);
  });

  it('covers the adopt path too, where the match has no record', () => {
    const record = fusionHolderToRecord(REAL[0]);
    // Both carry our shape and NEITHER carries our id — the bootstrap case.
    const a = { ...REAL[0], 'product-id': '' };
    const b = { ...a, guid: 'second-copy' };

    const plan = holderPushPlan([a, b], [record], undefined, holderRecordToFusion);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].kind).toBe('adopt');
    expect(plan.flagged.map(f => f.status)).toEqual(['duplicate-entry']);
  });
});

// ─── Redrawing a holder HERE must reach Fusion ──────────────────────────────
// THE PRIMARY ONGOING WORKFLOW, and it was blocked. Identity is our ref + the
// segments, so redrawing a holder makes the shapes disagree and the entry reads
// `ref-only` — which the plan treated as "someone edited this in Fusion",
// refused to write, and left the badge at 0. The holder library silently went
// stale and stayed stale, which is the exact thing the whole feature exists to
// prevent. What we LAST PUSHED settles it without guessing.
describe('an app-side redraw pushes out', () => {
  const pushed = () => {
    const r = fusionHolderToRecord(REAL[0]);
    return { ...r, last_pushed: lastPushedFrom(r) };
  };
  const redraw = (r) => ({
    ...r,
    segments: r.segments.map((s, i) => (i === 0 ? { ...s, height: s.height + 2 } : s)),
  });

  it('writes the redraw instead of blaming Fusion for it', () => {
    const rec = pushed();
    const entry = holderRecordToFusion(rec, REAL[0]);      // what Fusion holds
    const edited = redraw(rec);

    expect(matchFusionHolder(entry, [edited]).status).toBe('ref-only');

    const plan = holderPushPlan([entry], [edited], undefined, holderRecordToFusion);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].stale).toBe(true);
    expect(plan.flagged).toHaveLength(0);
    expect(plan.creates).toHaveLength(0);                   // NOT a second copy
    // and the badge says so, rather than 0
    expect(holdersOutOfSync([entry], [edited], holderRecordToFusion)).toBe(1);

    // The write lands, and a second push has nothing to do.
    const next = applyHolderPushPlan([entry], plan, holderRecordToFusion);
    const settledRec = { ...edited, last_pushed: lastPushedFrom(edited) };
    expect(holdersOutOfSync(next, [settledRec], holderRecordToFusion)).toBe(0);
  });

  it('still FLAGS a genuine Fusion-side edit', () => {
    const rec = pushed();
    // Fusion's copy no longer matches what we last handed it → they moved it.
    const entry = holderRecordToFusion(rec, REAL[0]);
    const movedInFusion = {
      ...entry,
      segments: entry.segments.map((s, i) => (i === 0 ? { ...s, height: s.height + 3 } : s)),
    };
    const plan = holderPushPlan([movedInFusion], [rec], undefined, holderRecordToFusion);
    expect(plan.updates).toHaveLength(0);
    expect(plan.flagged.map(f => f.status)).toEqual(['ref-only']);
  });

  it('a record that has never been pushed is unchanged in behaviour', () => {
    const rec = fusionHolderToRecord(REAL[0]);              // no last_pushed
    const entry = holderRecordToFusion(rec, REAL[0]);
    const plan = holderPushPlan([entry], [redraw(rec)], undefined, holderRecordToFusion);
    expect(plan.updates).toHaveLength(0);
    expect(plan.flagged.map(f => f.status)).toEqual(['ref-only']);
  });
});

// ─── The archive ────────────────────────────────────────────────────────────
describe('archived holders', () => {
  it('are invisible to every matcher', () => {
    const rec = { ...fusionHolderToRecord(REAL[0]), archived: true };
    const entry = holderRecordToFusion(rec, REAL[0]);
    // Neither its ref nor its shape may resolve it.
    expect(recordForRef([rec], rec.holder_ref)).toBeNull();
    expect(recordsForGeometry([rec], entry)).toHaveLength(0);
    expect(matchFusionHolder(entry, [rec]).status).toBe('none');
  });

  it('are never appended to Fusion as a create', () => {
    const rec = { ...fusionHolderToRecord(REAL[0]), archived: true };
    expect(holderPushPlan([], [rec], undefined, holderRecordToFusion).creates).toHaveLength(0);
  });
});

// ─── Removing a merged-away holder from Fusion ──────────────────────────────
// A merge means the two holders are ONE holder. Retiring the loser here and
// leaving its copy in Fusion is half the job: the bad geometry stays pickable,
// so new tools keep arriving on it.
describe('the push removes retired holders from Fusion', () => {
  it('deletes the entry whose ref an active record retired in a merge', () => {
    const survivor = fusionHolderToRecord(REAL[0]);
    const loser = fusionHolderToRecord(REAL[1]);
    const merged = { ...survivor, legacy_ids: [loser.holder_ref] };

    const keep = holderRecordToFusion(merged, REAL[0]);
    const drop = holderRecordToFusion(loser, REAL[1]);      // carries the retired ref

    const plan = holderPushPlan([keep, drop], [merged], undefined, holderRecordToFusion);
    expect(plan.deletes).toHaveLength(1);
    expect(plan.deletes[0].index).toBe(1);
    expect(applyHolderPushPlan([keep, drop], plan, holderRecordToFusion)).toHaveLength(1);
  });

  it('deletes an archived record’s own entry', () => {
    const rec = fusionHolderToRecord(REAL[0]);
    const entry = holderRecordToFusion(rec, REAL[0]);
    const archived = { ...rec, archived: true, archived_reason: 'removed' };
    const plan = holderPushPlan([entry], [archived], undefined, holderRecordToFusion);
    expect(plan.deletes).toHaveLength(1);
    expect(plan.creates).toHaveLength(0);
  });

  // ⚠️ THE ONE THAT WOULD DELETE A LIVE HOLDER. legacy_ids holds two different
  // things: refs WE retired in a merge, and the raw product-id the entry came
  // in with — a vendor SKU, or prose like "min OOH". The second belongs to the
  // holder itself. Only the HLD- shape may ever trigger a removal.
  it('NEVER deletes on an imported vendor SKU or note kept in legacy_ids', () => {
    const withSku = REAL.find(f => /^BT30-/.test(String(f['product-id'] ?? '')));
    expect(withSku).toBeTruthy();
    const rec = fusionHolderToRecord(withSku);
    expect(rec.legacy_ids).toContain(withSku['product-id']);   // it IS retained
    const entry = { ...withSku };                              // still carrying the SKU
    const plan = holderPushPlan([entry], [rec], undefined, holderRecordToFusion);
    expect(plan.deletes).toHaveLength(0);
  });

  it('a delete does not misaddress the guid stamped on a later holder', () => {
    // Deletes shift every later entry, so reading the written entry back by
    // INDEX addresses the wrong holder. Keyed by ref instead.
    const a = fusionHolderToRecord(REAL[0]);
    const b = fusionHolderToRecord(REAL[1]);
    const withRetired = { ...a, legacy_ids: ['HLD-DEAD01'] };
    const dead = { ...holderRecordToFusion(a, REAL[0]), 'product-id': 'HLD-DEAD01', guid: 'dead' };
    const keepA = holderRecordToFusion(withRetired, REAL[0]);
    const keepB = holderRecordToFusion(b, REAL[1]);

    const list = [dead, keepA, keepB];
    const plan = holderPushPlan(list, [withRetired, b], undefined, holderRecordToFusion);
    const next = applyHolderPushPlan(list, plan, holderRecordToFusion);
    const byRef = new Map(next.filter(e => e['product-id']).map(e => [e['product-id'], e]));
    expect(byRef.get(b.holder_ref).guid).toBe(REAL[1].guid);
    expect(next).toHaveLength(2);
  });
});

// ⚠️ Found in the browser, not by a test: retire a holder BEFORE its first
// push and its Fusion entry carries no ref of ours, so the ref-based rule
// couldn't see it. The entry sat orphaned in Fusion while the app showed the
// holder as retired — the exact state the removal exists to prevent.
describe('retiring a holder that was never pushed', () => {
  it('still removes its Fusion entry, identified by shape', () => {
    const rec = fusionHolderToRecord(REAL[0]);
    const entry = { ...REAL[0], 'product-id': '' };        // never carried our ref
    const retired = { ...rec, archived: true, archived_reason: 'removed' };

    const plan = holderPushPlan([entry], [retired], undefined, holderRecordToFusion);
    expect(plan.deletes).toHaveLength(1);
    expect(plan.deletes[0].why).toMatch(/before it was pushed/);
    expect(applyHolderPushPlan([entry], plan, holderRecordToFusion)).toHaveLength(0);
  });

  // A LIVE record always wins the entry first, so a merge survivor that shares
  // the loser's shape can never be mistaken for the thing being deleted.
  it('never deletes an entry a live record still claims', () => {
    const live = fusionHolderToRecord(REAL[0]);
    const entry = holderRecordToFusion(live, REAL[0]);
    const sameShapeArchived = { ...fusionHolderToRecord(REAL[0]), id: 'other', archived: true };

    const plan = holderPushPlan([entry], [live, sameShapeArchived], undefined, holderRecordToFusion);
    expect(plan.deletes).toHaveLength(0);
    expect(plan.updates).toHaveLength(1);
  });

  it('leaves it alone when two archived records share the shape', () => {
    const a = { ...fusionHolderToRecord(REAL[0]), id: 'a', archived: true };
    const b = { ...fusionHolderToRecord(REAL[0]), id: 'b', archived: true };
    const entry = { ...REAL[0], 'product-id': '' };
    expect(holderPushPlan([entry], [a, b], undefined, holderRecordToFusion).deletes)
      .toHaveLength(0);
  });
});

// ⚠️ A REGRESSION THE ARCHIVE INTRODUCED. Archived records are invisible to
// matching by design — so the IMPORTER read a retired holder's Fusion entry as
// one it had never seen and re-created it, undoing the retirement the moment
// you clicked Import before pushing. One shared rule now answers "does this
// entry belong to a holder we retired" for both the push and the import.
describe('retiredHolderFor', () => {
  it('recognises a retired holder’s own entry (so import can’t resurrect it)', () => {
    const rec = fusionHolderToRecord(REAL[0]);
    const entry = holderRecordToFusion(rec, REAL[0]);
    const retired = { ...rec, archived: true, archived_reason: 'removed' };
    expect(matchFusionHolder(entry, [retired]).status).toBe('none');   // invisible, as designed
    expect(retiredHolderFor(entry, [retired])?.record.id).toBe(rec.id);
  });

  it('recognises a ref retired by a merge', () => {
    const survivor = fusionHolderToRecord(REAL[0]);
    const loser = fusionHolderToRecord(REAL[1]);
    const merged = { ...survivor, legacy_ids: [loser.holder_ref] };
    const entry = holderRecordToFusion(loser, REAL[1]);
    expect(retiredHolderFor(entry, [merged])?.record.id).toBe(merged.id);
  });

  it('says nothing about a live holder', () => {
    const rec = fusionHolderToRecord(REAL[0]);
    expect(retiredHolderFor(holderRecordToFusion(rec, REAL[0]), [rec])).toBeNull();
    expect(retiredHolderFor(REAL[1], [rec])).toBeNull();          // simply unknown
  });
});

// ─── The scoped push (what makes the auto-push-on-import safe) ──────────────
// Importing leaves every record one signal short of linked, so the first push
// now runs itself. That is only defensible because it is SCOPED to the records
// the import just created: each came FROM a Fusion entry a moment earlier, so
// the plan can only ADOPT — stamp our ID onto an entry whose exact shape we
// just read. Nothing is created, nothing is removed, no geometry moves.
describe('a push scoped to freshly imported records', () => {
  it('only adopts — it creates nothing and removes nothing', () => {
    const records = REAL.map(f => fusionHolderToRecord(f));
    const plan = holderPushPlan(REAL, records, undefined, holderRecordToFusion);

    expect(plan.creates).toHaveLength(0);
    expect(plan.deletes).toHaveLength(0);
    expect(plan.updates.length).toBe(REAL.length);
    // No geometry moves: every diff is the ID, the name, or the vendor.
    for (const u of plan.updates) {
      for (const d of u.diff) expect(['segments', 'gaugeLength', 'unit']).not.toContain(d.key);
    }
    // And the app's ID lands on every entry.
    const next = applyHolderPushPlan(REAL, plan, holderRecordToFusion);
    expect(next).toHaveLength(REAL.length);
    expect(next.every(e => /^HLD-[0-9A-F]{6}$/.test(e['product-id']))).toBe(true);
  });

  it('leaves records OUTSIDE the scope completely alone', () => {
    // The library already holds a record whose geometry was edited here and
    // never pushed. An unscoped push would write it; the scoped one must not,
    // because the user never asked for that edit to go out.
    const fresh = fusionHolderToRecord(REAL[0]);
    const edited = {
      ...fusionHolderToRecord(REAL[1]),
      segments: REAL[1].segments.map((s, i) => (i === 0 ? { ...s, height: s.height + 9 } : { ...s })),
    };
    const scopedPlan = holderPushPlan(REAL, [fresh], undefined, holderRecordToFusion);
    expect(scopedPlan.updates.map(u => u.index)).toEqual([0]);
    expect(scopedPlan.creates).toHaveLength(0);        // `edited` is not in scope
    expect(scopedPlan.flagged).toHaveLength(0);        // nor flagged

    const next = applyHolderPushPlan(REAL, scopedPlan, holderRecordToFusion);
    expect(next[1]).toBe(REAL[1]);                     // byte-for-byte untouched

    // Unscoped, that same edit WOULD go out — which is exactly why the
    // auto-push is scoped.
    const wide = holderPushPlan(REAL, [fresh, edited], undefined, holderRecordToFusion);
    expect(wide.creates.length + wide.flagged.length).toBeGreaterThan(0);
  });
});

// ─── An expression-only change is the MOST important one to explain ─────────
// Reported from a real library: 22 holders every one of which read "Derived
// expressions · older → rebuilt", filed under "Names & text — the holder itself
// is unchanged". Uninformative and misleading. What was actually happening is
// the repair that matters most: Fusion's VISIBLE product-id already said
// HLD-CE3310 while its hidden paired copy still said 'min OOH', and Fusion
// re-reads the hidden one on load — so without the write it throws the app's ID
// away again.
describe('a change only Fusion’s hidden copy can see', () => {
  const stale = () => {
    const rec = fusionHolderToRecord(REAL[0]);
    const entry = holderRecordToFusion(rec, REAL[0]);
    // The state an older writer left: native stamped, expression not.
    return { rec, entry: { ...entry, expressions: { ...entry.expressions, tool_productId: "'min OOH'" } } };
  };

  it('names the FIELD and shows the stale value, not "derived expressions"', () => {
    const { rec, entry } = stale();
    const diff = holderPushDiff(entry, holderRecordToFusion(rec, entry));
    expect(diff).toHaveLength(1);
    expect(diff[0].key).toBe('tool_productId');
    expect(diff[0].label).toBe('App ID');
    expect(diff[0].from).toBe('min OOH');            // unquoted, readable
    expect(diff[0].to).toBe(rec.holder_ref);
    expect(diff[0].note).toMatch(/re-reads this on load/);
  });

  it('gets its OWN group — not "the holder itself is unchanged"', () => {
    const { rec, entry } = stale();
    const diff = holderPushDiff(entry, holderRecordToFusion(rec, entry));
    expect(pushChangeGroup(diff)).toBe('pairing');
    expect(PUSH_GROUPS.pairing).toBeTruthy();
  });

  it('still reports a native+expression pair ONCE, not twice', () => {
    const rec = fusionHolderToRecord(REAL[0]);
    const entry = holderRecordToFusion(rec, REAL[0]);
    const renamed = { ...rec, description: 'A totally different name' };
    const diff = holderPushDiff(entry, holderRecordToFusion(renamed, entry));
    expect(diff.filter(d => d.key === 'description')).toHaveLength(1);
    expect(diff.filter(d => d.key === 'tool_description')).toHaveLength(0);
  });

  it('and the repair settles after one push', () => {
    const { rec, entry } = stale();
    const p1 = holderPushPlan([entry], [rec], undefined, holderRecordToFusion);
    expect(p1.updates.filter(u => u.stale)).toHaveLength(1);
    const next = applyHolderPushPlan([entry], p1, holderRecordToFusion);
    const pushed = { ...rec, last_pushed: lastPushedFrom(rec) };
    expect(holdersOutOfSync(next, [pushed], holderRecordToFusion)).toBe(0);
  });
});

// ─── A holder DUPLICATED inside Fusion ──────────────────────────────────────
// Fusion's duplicate copies everything the user can see, including the
// product-id we stamp our ID into. So a copy carries the SAME holder_ref, and
// once the user edits it (the usual reason to duplicate) its shape differs too.
// That reads as `ref-only` — "it was edited in Fusion" — which is true of the
// entry but badly misleading: it's a NEW holder wearing the old one's ID.
describe('a holder duplicated in Fusion', () => {
  const setup = () => {
    const rec = fusionHolderToRecord(REAL[0]);
    const original = holderRecordToFusion(rec, REAL[0]);
    const copy = {
      ...original,
      guid: 'whatever-fusion-does-with-the-guid',
      description: `${original.description} (copy)`,
      segments: original.segments.map((s, i) => (i === 0 ? { ...s, height: s.height + 40 } : s)),
    };
    return { rec, original, copy };
  };

  it('is recognised as a COPY, not as the known holder having moved', () => {
    const { rec, original, copy } = setup();
    expect(matchFusionHolder(copy, [rec]).status).toBe('ref-only');   // on its own, ambiguous
    expect(isFusionSideCopy(copy, [original, copy], [rec])).toBe(true);
    expect(isFusionSideCopy(original, [original, copy], [rec])).toBe(false);
  });

  it('is order-independent — the copy may sit before the original', () => {
    const { rec, original, copy } = setup();
    expect(isFusionSideCopy(copy, [copy, original], [rec])).toBe(true);
  });

  it('the plan flags it with an accurate reason and writes NOTHING to it', () => {
    const { rec, original, copy } = setup();
    const plan = holderPushPlan([original, copy], [rec], undefined, holderRecordToFusion);
    expect(plan.updates.map(u => u.index)).toEqual([0]);        // only the original
    expect(plan.flagged).toHaveLength(1);
    expect(plan.flagged[0].status).toBe('fusion-copy');
    expect(plan.flagged[0].reason).toMatch(/COPY/);
    expect(applyHolderPushPlan([original, copy], plan, holderRecordToFusion)[1]).toBe(copy);
  });

  // ⚠️ A genuine Fusion-side EDIT of the only entry must still read as
  // `ref-only` — there is no other entry accounting for the record, so it is
  // that holder, moved.
  it('a real Fusion-side edit is still ref-only, not a copy', () => {
    const { rec, copy } = setup();
    expect(isFusionSideCopy(copy, [copy], [rec])).toBe(false);
    expect(holderPushPlan([copy], [rec], undefined, holderRecordToFusion).flagged[0].status)
      .toBe('ref-only');
  });
});

// ⚠️ THE CREATE PATH WAS THE LAST PLACE STILL TRUSTING A FUSION GUID.
//
// From the real library: a holder was duplicated in Fusion, one copy edited into
// a test holder with a long stickout, and the original lost. The app's
// NBT30-SK13C-120 record still remembered the guid it was pushed on — which
// Fusion had by then given to that test holder. Because a create falls back to
// `record.fusion_guid`, pushing wrote a library with TWO entries carrying one
// guid. Fusion re-issued one, the app stopped recognising the holder, and the
// next push offered to create it again — a loop with no way out from the app.
describe('creating a holder whose remembered guid was taken over', () => {
  const SHARED = '31014ded-f74e-4e7b-a82b-7ecc5a94476e';
  // The impostor: sitting in Fusion on the guid, correctly matched to its own
  // record, and nothing to do with the holder being created.
  const impostor = { ...holderRecordToFusion(fusionHolderToRecord(OTHER), null), guid: SHARED, 'product-id': 'HLD-FAKE' };
  const impostorRec = { ...fusionHolderToRecord(OTHER), id: 'rec-fake', holder_ref: 'HLD-FAKE', fusion_guid: SHARED };
  // The holder that went missing from Fusion, still remembering that guid.
  const missing = { ...fusionHolderToRecord(F), id: 'rec-missing', holder_ref: 'HLD-MISSING', fusion_guid: SHARED };

  const push = () => {
    const list = [impostor];
    const plan = holderPushPlan(list, [impostorRec, missing], undefined, holderRecordToFusion);
    return { plan, next: applyHolderPushPlan(list, plan, holderRecordToFusion) };
  };

  it('creates it without duplicating the guid', () => {
    const { plan, next } = push();
    expect(plan.creates.map(r => r.holder_ref)).toEqual(['HLD-MISSING']);
    const guids = next.map(e => e.guid);
    expect(new Set(guids).size).toBe(guids.length);
  });

  it('leaves the entry that legitimately owns the guid alone', () => {
    const { next } = push();
    expect(next.find(e => e['product-id'] === 'HLD-FAKE').guid).toBe(SHARED);
    expect(next.find(e => e['product-id'] === 'HLD-MISSING').guid).not.toBe(SHARED);
  });

  // The loop this closes: the created holder must be recognised next time.
  it('settles — the second push has nothing to create', () => {
    const { next } = push();
    const again = holderPushPlan(next, [impostorRec, missing], undefined, holderRecordToFusion);
    expect(again.creates).toHaveLength(0);
    expect(matchFusionHolder(next.find(e => e['product-id'] === 'HLD-MISSING'), [missing]).status)
      .toBe('exact');
  });

  // Determinism matters: a preview and the commit that follows it must agree,
  // and holderRecordToFusion also runs on every tool write.
  it('picks the same guid every time', () => {
    expect(push().next.map(e => e.guid)).toEqual(push().next.map(e => e.guid));
  });

  // The remembered guid is still preferred when it is genuinely free — this
  // narrows the create path, it doesn't abandon the hint.
  it('still reuses the remembered guid when nothing else holds it', () => {
    const plan = holderPushPlan([], [missing], undefined, holderRecordToFusion);
    expect(applyHolderPushPlan([], plan, holderRecordToFusion)[0].guid).toBe(SHARED);
  });

  // A guid freed by a removal in the same push is available again.
  it('reuses a guid the same push is removing', () => {
    const retired = { ...impostorRec, archived: true };
    const list = [impostor];
    const plan = holderPushPlan(list, [retired, missing], undefined, holderRecordToFusion);
    expect(plan.deletes).toHaveLength(1);
    const next = applyHolderPushPlan(list, plan, holderRecordToFusion);
    expect(next).toHaveLength(1);
    expect(next[0]['product-id']).toBe('HLD-MISSING');
    expect(next[0].guid).toBe(SHARED);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A HOLDER DUPLICATED INSIDE FUSION — the full resolution.
//
// Fusion's duplicate copies the product-id, so the copy arrives wearing the
// ORIGINAL's ref. Detection already worked (`fusion-copy`); nothing could act
// on it, so the holder could never enter the app. These lock the three rules
// that let it finish, each of which a looser version gets destructively wrong.
//
// Measured against the shop's real holder library: 26 Fusion entries, 27 app
// records, ONE such copy (`HLD-604953` on both a 2.35OOH and a 2.8OOH holder).
// ─────────────────────────────────────────────────────────────────────────────
describe('a holder duplicated inside Fusion', () => {
  // The original: settled, pushed, matching on both signals.
  const original = () => settled();
  // The copy: same ref, different shape (its extension was lengthened).
  const copyEntry = (rec) => {
    const e = pushed(rec);
    return {
      ...e,
      guid: 'copy-guid',
      description: `${e.description} LONGER`,
      segments: e.segments.map((sg, i) => (i === 0 ? { ...sg, height: sg.height + 5 } : sg)),
    };
  };

  it('is detected as a copy, not as "edited in Fusion"', () => {
    const rec = original();
    const list = [pushed(rec), copyEntry(rec)];
    expect(matchFusionHolder(list[1], [rec]).status).toBe('ref-only');
    expect(isFusionSideCopy(list[1], list, [rec])).toBe(true);
    const plan = holderPushPlan(list, [rec], undefined, holderRecordToFusion);
    expect(plan.flagged.map(f => f.status)).toEqual(['fusion-copy']);
    expect(plan.deletes).toHaveLength(0);
    expect(plan.creates).toHaveLength(0);
  });

  // ⚠️ THE DESTRUCTIVE ONE. `fusionHolderToRecord` migrates whatever was in
  // product-id into legacy_ids — right for a vendor SKU, catastrophic for a ref
  // that a LIVE record still owns: the push read BOTH entries as merged away
  // and planned to delete the original holder AND the copy from Fusion, then
  // re-add them with fresh guids, severing the baked holder link on every tool
  // using them. Guarded twice over — the ref is never migrated, and a live
  // record's own ref is never a deletion reason.
  it('never plans to DELETE the original when the copy is imported', () => {
    const rec = original();
    const list = [pushed(rec), copyEntry(rec)];
    const copyRec = fusionHolderToRecord(list[1]);
    expect(copyRec.legacy_ids).toEqual([]);        // the borrowed ref is not migrated
    expect(copyRec.part_number).toBe('');
    // and even if a record DID carry it, it is not a deletion reason
    const withBorrowed = { ...copyRec, legacy_ids: [rec.holder_ref] };
    expect(retiredHolderFor(list[0], [rec, withBorrowed])).toBeNull();
    const plan = holderPushPlan(list, [rec, withBorrowed], undefined, holderRecordToFusion);
    expect(plan.deletes).toHaveLength(0);
  });

  it('a genuine merge still deletes the retired holder', () => {
    // The loser is ARCHIVED, so its ref is nobody's live holder_ref — the guard
    // above costs this case nothing.
    const survivor = original();
    const loser = { ...fusionHolderToRecord(OTHER), holder_ref: 'HLD-AAAAAA', archived: true, merged_into: survivor.id };
    const winner = { ...survivor, legacy_ids: ['HLD-AAAAAA'] };
    const entry = { ...pushed(survivor), 'product-id': 'HLD-AAAAAA' };
    expect(retiredHolderFor(entry, [winner, loser])).toBeTruthy();
  });

  it('once the copy has its own record, the push RECLAIMS its Fusion id', () => {
    const rec = original();
    const list = [pushed(rec), copyEntry(rec)];
    const copyRec = fusionHolderToRecord(list[1]);
    const plan = holderPushPlan(list, [rec, copyRec], undefined, holderRecordToFusion);
    expect(plan.flagged).toHaveLength(0);
    expect(plan.deletes).toHaveLength(0);
    expect(plan.creates).toHaveLength(0);
    const reclaim = plan.updates.find(u => u.kind === 'reclaim');
    expect(reclaim.record.id).toBe(copyRec.id);
    // and the write actually re-stamps the borrowed ref
    const applied = applyHolderPushPlan(list, plan, holderRecordToFusion);
    expect(applied[1]['product-id']).toBe(copyRec.holder_ref);
    expect(applied[0]['product-id']).toBe(rec.holder_ref);
  });

  it('is idempotent — a second push has nothing to reclaim', () => {
    const rec = original();
    const list = [pushed(rec), copyEntry(rec)];
    const copyRec = fusionHolderToRecord(list[1]);
    const p1 = holderPushPlan(list, [rec, copyRec], undefined, holderRecordToFusion);
    const applied = applyHolderPushPlan(list, p1, holderRecordToFusion);
    const p2 = holderPushPlan(applied, [rec, copyRec], undefined, holderRecordToFusion);
    expect(p2.updates.filter(u => u.kind === 'reclaim')).toHaveLength(0);
    expect(p2.updates.filter(u => u.stale)).toHaveLength(0);
    expect(p2.flagged).toHaveLength(0);
  });
});

// ⚠️ A conflict is normally UNANSWERABLE and must stay flagged — either signal
// could be the wrong one, and a wrong answer renames a real holder in Fusion.
describe('conflictResolvableToShape refuses everything it cannot prove', () => {
  const rec = () => settled();

  it('needs the ref to be claimed by another entry', () => {
    // A lone entry whose ref and shape disagree: nothing says which is right.
    const a = fusionHolderToRecord(F);
    const b = fusionHolderToRecord(OTHER);
    const entry = { ...holderRecordToFusion(b), 'product-id': a.holder_ref };
    expect(matchFusionHolder(entry, [a, b]).status).toBe('conflict');
    expect(conflictResolvableToShape(entry, [entry], [a, b])).toBeNull();
  });

  it('needs the shape to match exactly one record', () => {
    const a = rec();
    const twin1 = { ...fusionHolderToRecord(OTHER), id: 't1', holder_ref: 'HLD-000001' };
    const twin2 = { ...fusionHolderToRecord(OTHER), id: 't2', holder_ref: 'HLD-000002' };
    const entry = { ...holderRecordToFusion(twin1), 'product-id': a.holder_ref };
    const list = [holderRecordToFusion(a), entry];
    // two records share the shape → ambiguous, never guessed
    expect(conflictResolvableToShape(entry, list, [a, twin1, twin2])).toBeNull();
  });

  it('resolves only when BOTH hold', () => {
    const a = rec();
    const b = fusionHolderToRecord(OTHER);
    const entry = { ...holderRecordToFusion(b), 'product-id': a.holder_ref };
    const list = [holderRecordToFusion(a), entry];
    expect(conflictResolvableToShape(entry, list, [a, b]).id).toBe(b.id);
  });
});

// ⚠️ A RECLAIM MUST BE `stale`. Two things count what a push will touch —
// `holdersOutOfSync` (the badge) and the per-library "N to write" — and both
// derive from `updates.filter(u => u.stale)`. The header used to sum the
// per-KIND counts instead, so a library whose only change was a reclaim read
// "0 to write" while the total said 1 and the row was listed underneath it. Any
// new update kind has to satisfy this or it goes missing from the preview.
describe('every update a push will write is marked stale', () => {
  it('including a reclaim', () => {
    const rec = fusionHolderToRecord(F);
    const e = holderRecordToFusion(rec);
    const copyEntry = {
      ...e, guid: 'copy-guid', description: `${e.description} LONGER`,
      segments: e.segments.map((sg, i) => (i === 0 ? { ...sg, height: sg.height + 5 } : sg)),
    };
    const copyRec = fusionHolderToRecord(copyEntry);
    const plan = holderPushPlan([e, copyEntry], [rec, copyRec], undefined, holderRecordToFusion);
    const reclaim = plan.updates.find(u => u.kind === 'reclaim');
    expect(reclaim.stale).toBe(true);
    // and the badge sees it
    expect(holdersOutOfSync([e, copyEntry], [rec, copyRec], holderRecordToFusion)).toBeGreaterThan(0);
  });

  it('no update escapes the stale filter that the plan intends to write', () => {
    const rec = fusionHolderToRecord(F);
    const entry = { ...holderRecordToFusion(rec), 'product-id': '' };   // adopt path
    const plan = holderPushPlan([entry], [rec], undefined, holderRecordToFusion);
    for (const u of plan.updates) {
      if (u.kind !== 'update') expect(u.stale).toBe(true);   // adopt / reclaim always write
    }
  });
});
