// ⚠️ THE APP CANNOT KNOW WHICH SHAFT IS RIGHT — so it asks.
//
// Two ways the profile goes out of step, both un-resolvable automatically:
//   • someone edits the shaft in Fusion and it syncs back
//   • someone edits ONE instance in Fusion and not the others
// Both are surfaced through the same drift path every other shared field uses.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { detectFusionDrift, mergeSharedFieldsWithFusion, buildMetadataTool } from './metadataModel.js';
import { fusionToolToInternal, sameShaftSegments } from './fusionConvert.js';
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

// ─── The shaft is DEFINING GEOMETRY — every path that carries the diameter
// carries it too. Each case below was a real hole: the profile silently
// vanished, or two records that disagreed about it were merged without a word.

describe('every sync path carries the shaft, the same as the diameter', () => {
  const tsv = (cols, vals) => [cols.join('\t'), vals.join('\t')].join('\n');
  const HDR = ['"Type (tool_type)"', '"Description (tool_description)"', '"Diameter (tool_diameter)"'];

  it('the Fusion clipboard/TSV paste path parses the segment column', async () => {
    const { parseIncoming } = await import('../services/mergeQueue.js');
    const [tool] = parseIncoming(tsv(
      [...HDR, '"Shaft Segments (shaft_segments)"'],
      ['flat end mill', '.039 EM', '0.039',
        'H0.144000 U0.038000 L0.038000; H0.075300 U0.125000 L0.038000'],
    ));
    expect(tool.shaft_segments).toEqual([
      { height: 0.144, lower: 0.038, upper: 0.038 },
      { height: 0.0753, lower: 0.038, upper: 0.125 },
    ]);
  });

  it('a tool with no segment column pastes as "no opinion", not as an empty shaft', async () => {
    const { parseIncoming } = await import('../services/mergeQueue.js');
    const [tool] = parseIncoming(tsv(HDR, ['flat end mill', '.5 EM', '0.5']));
    expect(tool.shaft_segments).toBeNull();
  });

  it('the TSV round trip is lossless for every segmented tool in the library', async () => {
    const { parseFusionTsvSegments } = await import('../utils/fusionExport.js');
    const { readShaftSegments, writeShaftSegments } = await import('./fusionConvert.js');
    const segmented = LIB.filter(t => t.shaft?.segments?.length);
    expect(segmented.length).toBeGreaterThan(0);
    for (const entry of segmented) {
      const internal = readShaftSegments(entry.shaft);
      const tsvStr = writeShaftSegments(internal)
        .map(s => `H${s.height.toFixed(6)} U${s['upper-diameter'].toFixed(6)} L${s['lower-diameter'].toFixed(6)}`)
        .join('; ');
      // ⚠️ The TSV writes 6 decimals, so the round trip is lossy BY DESIGN —
      // compared at the same tolerance a JSON round trip gets, not exactly.
      expect(sameShaftSegments(parseFusionTsvSegments(tsvStr), internal, 1e-5)).toBe(true);
    }
  });

  it('the Sync Job diff shows it in Geometry, beside the diameter', async () => {
    const { DIFF_SECTIONS } = await import('../components/MergeFlow/DiffStep.jsx');
    const geo = DIFF_SECTIONS.find(s => /geometry/i.test(s.title));
    expect(geo.fields).toContain('shaft_segments');
    expect(geo.fields).toContain('diameter');
  });

  it('two records sharing a ProShop number that disagree on the shaft are FLAGGED', async () => {
    const { combineToolsByToolId } = await import('./combine.js');
    const a = { id: 'A', tool_id: 'A-1', tool_type: 'flat end mill', diameter: 0.5,
      shaft_segments: [{ height: 0.5, lower: 0.5, upper: 0.5 }], assemblies: [], presets: [] };
    const b = { ...a, id: 'B',
      shaft_segments: [{ height: 0.9, lower: 0.3, upper: 0.5 }] };
    const [merged] = combineToolsByToolId([a, b]);
    expect(merged._combineConflicts.map(c => c.field)).toContain('shaft_segments');
  });

  it('⚠️ two records that AGREE raise nothing — the arrays are compared, not their identity', async () => {
    const { combineToolsByToolId } = await import('./combine.js');
    const segs = () => [{ height: 0.5, lower: 0.5, upper: 0.5 }];
    const a = { id: 'A', tool_id: 'A-1', tool_type: 'flat end mill', diameter: 0.5,
      shaft_segments: segs(), assemblies: [], presets: [] };
    const b = { ...a, id: 'B', shaft_segments: segs() };   // equal, different array
    const [merged] = combineToolsByToolId([a, b]);
    expect(merged._combineConflicts || []).toEqual([]);
  });

  it('⚠️ renders as a readable profile, never "[object Object]"', async () => {
    const { formatShaftSegments } = await import('../utils/toolProfile.js');
    const segs = [{ height: 0.144, lower: 0.038, upper: 0.038 },
                  { height: 0.0753, lower: 0.038, upper: 0.125 }];
    const text = formatShaftSegments(segs);
    expect(text).not.toMatch(/object Object/);
    expect(text).toContain('2 seg');
    expect(text).toContain('0.144');
    expect(text).toContain('0.125');
    expect(formatShaftSegments([])).toBe('none');
    expect(formatShaftSegments(null)).toBe('\u2014');
  });

  it('the Sync Job diff and the drift banner word it identically', async () => {
    const { formatShaftSegments } = await import('../utils/toolProfile.js');
    const { formatValue } = await import('../components/MergeFlow/DiffStep.jsx');
    const segs = [{ height: 0.5, lower: 0.3, upper: 0.5 }];
    expect(formatValue(segs)).toBe(formatShaftSegments(segs));
  });

  it('⚠️ the TSV copy carries the APP\u2019s profile, not the stale raw one', async () => {
    const { buildFusionTsv } = await import('../utils/fusionExport.js');
    const tsvOut = buildFusionTsv([{
      ...fusionToolToInternal(SEG),
      _instancesRaw: [withShaft(SEG, [                       // Fusion still holds the OLD shaft
        { height: 9.99, 'lower-diameter': 0.5, 'upper-diameter': 0.5 }])],
      shaft_segments: [{ height: 0.144, lower: 0.038, upper: 0.038 }],     // edited here
    }]);
    expect(tsvOut).toContain('H0.144000');
    expect(tsvOut).not.toContain('H9.990000');
  });

  it('a tool with NO Fusion entry still exports its shaft', async () => {
    const { buildFusionTsv } = await import('../utils/fusionExport.js');
    const tsvOut = buildFusionTsv([{
      ...fusionToolToInternal(SEG),
      _instancesRaw: [], _fusionRaw: null, no_fusion_link: true,
      shaft_segments: [{ height: 0.25, lower: 0.1, upper: 0.2 }],
    }]);
    expect(tsvOut).toContain('H0.250000');
  });

  it('the drift banner has a label for it, not the raw key', async () => {
    const { fieldLabel } = await import('./fieldRegistry.js');
    expect(fieldLabel('shaft_segments', 'inches')).toBe('Shaft Profile (in)');
  });
});

// ─── The third checklist question, applied to the shaft: what happens on the
// SECOND run? An edit has to land on every instance, survive the round trip,
// and then have nothing left to do.

describe('an edited profile lands once and then stops', () => {
  const { groups } = groupByTrackingId(LIB);
  const grp = [...groups.values()].find(raws => raws.some(e => e.guid === SEG.guid));
  const EDIT = [{ height: 0.20, lower: 0.038, upper: 0.038 },
                { height: 0.0753, lower: 0.038, upper: 0.125 }];
  const metaMap = (tool) => new Map([[
    tool.tracking_id, buildMetadataTool({ ...tool, shaft_segments: EDIT })]]);

  it('reaches EVERY instance — a shaft is shared, like the diameter', async () => {
    const { buildLogicalTool, splitToFusionInstances } = await import('./logicalTools.js');
    const tool = buildLogicalTool(grp, new Map());
    const { fusionInstances: out } = splitToFusionInstances({ ...tool, shaft_segments: EDIT }, [], []);
    expect(out.length).toBeGreaterThan(0);
    for (const e of out) expect(e.shaft.segments[0].height).toBe(0.2);
  });

  it('survives the round trip back in', async () => {
    const { buildLogicalTool, splitToFusionInstances } = await import('./logicalTools.js');
    const tool = buildLogicalTool(grp, new Map());
    const { fusionInstances: written } = splitToFusionInstances({ ...tool, shaft_segments: EDIT }, [], []);
    const back = buildLogicalTool(written, metaMap(tool));
    expect(back.shaft_segments).toEqual(EDIT);
  });

  it('⚠️ the SECOND save writes the same bytes — nothing left to do', async () => {
    const { buildLogicalTool, splitToFusionInstances } = await import('./logicalTools.js');
    const tool = buildLogicalTool(grp, new Map());
    const { fusionInstances: w1 } = splitToFusionInstances({ ...tool, shaft_segments: EDIT }, [], []);
    const back = buildLogicalTool(w1, metaMap(tool));
    const { fusionInstances: w2 } = splitToFusionInstances(back, [], []);
    expect(w2.map(e => e.shaft)).toEqual(w1.map(e => e.shaft));
  });

  it('and raises no drift against the entries it just wrote', async () => {
    const { buildLogicalTool, splitToFusionInstances } = await import('./logicalTools.js');
    const tool = buildLogicalTool(grp, new Map());
    const { fusionInstances: written } = splitToFusionInstances({ ...tool, shaft_segments: EDIT }, [], []);
    const back = buildLogicalTool(written, metaMap(tool));
    const drift = detectFusionDrift(written.map(fusionToolToInternal), buildMetadataTool(back));
    expect(drift.filter(d => d.field === 'shaft_segments')).toEqual([]);
  });

  it('emptying the profile removes the shaft object rather than leaving a husk', async () => {
    const { buildLogicalTool, splitToFusionInstances } = await import('./logicalTools.js');
    const tool = buildLogicalTool(grp, new Map());
    const { fusionInstances: out } = splitToFusionInstances({ ...tool, shaft_segments: [] }, [], []);
    for (const e of out) expect(e.shaft).toBeUndefined();
  });
});
