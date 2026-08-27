// ⚠️ THE APP CANNOT KNOW WHICH SHAFT IS RIGHT — so it asks.
//
// Two ways the profile goes out of step, both un-resolvable automatically:
//   • someone edits the shaft in Fusion and it syncs back
//   • someone edits ONE instance in Fusion and not the others
// Both are surfaced through the same drift path every other shared field uses.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { detectFusionDrift, mergeSharedFieldsWithFusion, buildMetadataTool } from './metadataModel.js';
import { fusionToolToInternal } from './fusionConvert.js';
import { groupByTrackingId } from './identity.js';

const LIB = JSON.parse(readFileSync(
  new URL('../../8-10-26 POST CLEAN UP PM FIX/ToolDEX - MASTER 8-10-26PM.json', import.meta.url), 'utf8',
)).data;
const byDesc = (d) => LIB.find(t => t.description === d);
const SEG = byDesc('1mm (.039) 3FL EM .059LOC .203 REACH');
const withShaft = (e, segs) => ({ ...e, shaft: segs ? { type: 'shaft', segments: segs } : undefined });

describe('a shaft edited in Fusion is flagged, never silently taken', () => {
  it('flags the difference and reports both sides', () => {
    const meta = buildMetadataTool(fusionToolToInternal(SEG));       // what the app holds
    const fusionNow = fusionToolToInternal(withShaft(SEG, [          // what Fusion holds now
      { height: 0.9, 'lower-diameter': 0.03, 'upper-diameter': 0.03 }]));
    const drift = detectFusionDrift([fusionNow], meta);
    const row = drift.find(d => d.field === 'shaft_segments');
    expect(row).toBeTruthy();
    expect(row.fusionValue).toHaveLength(1);
    expect(row.appValue).toHaveLength(2);
  });

  it('says nothing when the two agree', () => {
    const meta = buildMetadataTool(fusionToolToInternal(SEG));
    const drift = detectFusionDrift([fusionToolToInternal(SEG)], meta);
    expect(drift.find(d => d.field === 'shaft_segments')).toBeUndefined();
  });

  it('a JSON round trip is not an edit', () => {
    const meta = JSON.parse(JSON.stringify(buildMetadataTool(fusionToolToInternal(SEG))));
    expect(detectFusionDrift([fusionToolToInternal(SEG)], meta)
      .find(d => d.field === 'shaft_segments')).toBeUndefined();
  });
});

describe('ONE instance edited in Fusion and not the others is flagged too', () => {
  it('catches the instance that moved, even though it is not the canonical one', () => {
    // detectFusionDrift compares the app's copy against EVERY instance, so the
    // odd one out is found wherever it sits in the list.
    const meta = buildMetadataTool(fusionToolToInternal(SEG));
    const drifted = fusionToolToInternal(withShaft(SEG, [
      { height: 0.144, 'lower-diameter': 0.038, 'upper-diameter': 0.038 }]));   // blend removed
    const drift = detectFusionDrift([fusionToolToInternal(SEG), drifted], meta);
    expect(drift.find(d => d.field === 'shaft_segments')).toBeTruthy();
  });

  it('the two real tools whose instances disagree are caught', () => {
    for (const desc of ['.062 BULL .01R .093 LOC 3 FL', 'A-37  7/64 Endmill .327LOC 4 Flute']) {
      const raws = LIB.filter(e => e.description === desc);
      expect(raws.length).toBeGreaterThan(1);
      const meta = buildMetadataTool(fusionToolToInternal(raws[0]));
      const drift = detectFusionDrift(raws.map(fusionToolToInternal), meta);
      expect(drift.find(d => d.field === 'shaft_segments'), desc).toBeTruthy();
    }
  });
});

describe('the write-time merge treats it like every other shared field', () => {
  const base = fusionToolToInternal(SEG);

  it('adopts a Fusion-side change the app did not make', () => {
    const remote = fusionToolToInternal(withShaft(SEG, [
      { height: 0.5, 'lower-diameter': 0.03, 'upper-diameter': 0.03 }]));
    const out = mergeSharedFieldsWithFusion({ ...base }, base, remote);
    expect(out.shaft_segments).toHaveLength(1);
  });

  it('⚠️ keeps the app edit and RECORDS the conflict when both moved', () => {
    const remote = fusionToolToInternal(withShaft(SEG, [
      { height: 0.5, 'lower-diameter': 0.03, 'upper-diameter': 0.03 }]));
    const mine = { ...base, shaft_segments: [{ height: 0.8, lower: 0.02, upper: 0.02 }] };
    const conflicts = [];
    const out = mergeSharedFieldsWithFusion(mine, base, remote, conflicts);
    expect(out.shaft_segments[0].height).toBe(0.8);            // the user's edit stands
    expect(conflicts.find(c => c.field === 'shaft_segments')).toBeTruthy();  // never discarded
  });
});

describe('⚠️ an established library raises no false alarms', () => {
  it('no tool drifts on its shaft when metadata has not stored one yet', () => {
    // "Not populated" is not drift — an existing library must stay quiet until
    // each tool is next saved.
    const { groups } = groupByTrackingId(LIB);
    let flagged = 0;
    for (const [tid, raws] of groups) {
      // metadata with no shaft_segments stored — an established library
      const drift = detectFusionDrift(raws.map(fusionToolToInternal), { id: tid });
      if (drift.find(d => d.field === 'shaft_segments')) flagged++;
    }
    expect(flagged).toBe(0);
  });
});

describe('reconcile-on-open sees a changed shaft too', () => {
  it('a stray whose shaft differs is a CONFLICT, not a silent duplicate', async () => {
    const { classifyStrays } = await import('../services/reconcile.js');
    const stray = { ...SEG, guid: 'stray-1', shaft: { type: 'shaft', segments: [
      { height: 0.9, 'lower-diameter': 0.03, 'upper-diameter': 0.03 }] } };
    const out = classifyStrays({
      matchingRaws: [SEG, stray],
      registeredAssemblies: [{ instance_guid: SEG.guid }],
      canonicalRaw: SEG,
    });
    expect(out.conflicts).toHaveLength(1);      // → routed to the Sync Job diff
    expect(out.duplicates).toHaveLength(0);     // never adopted or deleted silently
    expect(out.newAssemblies).toHaveLength(0);
  });

  it('adds no noise — only the two genuinely drifted tools are newly split', async () => {
    const { sharedSignature } = await import('../services/reconcile.js');
    const groups = new Map();
    for (const e of LIB) {
      const tid = (e.expressions || {}).tool_comment;
      if (!tid) continue;
      if (!groups.has(tid)) groups.set(tid, []);
      groups.get(tid).push(e);
    }
    const stripShaft = (sig) => { const o = JSON.parse(sig); delete o.shaft; return JSON.stringify(o); };
    const newlySplit = [...groups.values()].filter(g => g.length > 1
      && new Set(g.map(e => stripShaft(sharedSignature(e)))).size === 1
      && new Set(g.map(sharedSignature)).size > 1);
    expect(newlySplit).toHaveLength(2);
  });
});
