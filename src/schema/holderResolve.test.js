import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveHolderForWrite, toolHolderIsStale, assemblyGaugeCheck, holderToleranceIn, ASSEMBLY_GAUGE_WARN_IN } from './holderResolve.js';
import { fusionHolderToRecord } from './holderRecord.js';
import { mergeHolderRecords } from '../utils/holderDuplicates.js';
import { splitToFusionInstances } from './logicalTools.js';

const REAL = JSON.parse(
  readFileSync(new URL('../../FUSION TOOL Library REF/Master-Holder.json', import.meta.url), 'utf8')
).data;
const fusionHolder = (d) => REAL.find(h => h.description.trim() === d);

const OLD = fusionHolder('NBT30-SK13C-60');
const oldRecord = () => ({ ...fusionHolderToRecord(OLD), fusion_guid: OLD.guid });

// The corrected rebuild: same holder, one segment fixed, its own Fusion entry.
const newRecord = () => ({
  ...fusionHolderToRecord(OLD),
  id: 'rec-new',
  fusion_guid: 'guid-new',
  description: 'NBT30-SK13C-60 (corrected)',
  segments: OLD.segments.map((s, i) => (i === 0 ? { ...s, height: 36 } : { ...s })),
});

describe('resolution order', () => {
  it('prefers the app-owned record over the Fusion holder library', () => {
    const r = resolveHolderForWrite(OLD.guid, { records: [oldRecord()], fusionHolders: REAL });
    expect(r.source).toBe('app');
    expect(r.guidChanged).toBe(false);
  });

  it('FALLS BACK to the Fusion library for a holder not yet imported', () => {
    // Not optional: without this a holder with no app record would vanish from
    // the tool on its next save.
    const r = resolveHolderForWrite(OLD.guid, { records: [], fusionHolders: REAL });
    expect(r.source).toBe('fusion');
    expect(r.entry).toBe(OLD);
  });

  it('follows a merge alias to the surviving record', () => {
    const merged = mergeHolderRecords(newRecord(), oldRecord()).record;
    const r = resolveHolderForWrite(OLD.guid, { records: [merged], fusionHolders: REAL });
    expect(r.source).toBe('app');
    expect(r.record.id).toBe('rec-new');
    expect(r.guidChanged).toBe(true);       // the tool is pointing at a merged-away holder
    expect(r.entry.guid).toBe('guid-new');
  });

  it('returns null for a guid nothing knows about', () => {
    expect(resolveHolderForWrite('nope', { records: [], fusionHolders: REAL })).toBeNull();
    expect(resolveHolderForWrite(null, { records: [], fusionHolders: REAL })).toBeNull();
  });

  it('is DETERMINISTIC for a record never pushed to Fusion', () => {
    // This runs on every tool write — a fresh guid each call would re-point the
    // tool's holder link every single save.
    const local = { ...fusionHolderToRecord(OLD), id: 'rec-local', fusion_guid: null };
    const a = resolveHolderForWrite('rec-local', { records: [{ ...local, fusion_guid: 'rec-local' }] });
    const b = resolveHolderForWrite('rec-local', { records: [{ ...local, fusion_guid: 'rec-local' }] });
    expect(a.entry.guid).toBe(b.entry.guid);
  });
});

// ⚠️ THE ACTUAL DELIVERY. Fusion bakes holder geometry into each tool, so a
// tool write is the only channel a corrected holder ever reaches it by.
describe('a tool write carries the corrected geometry', () => {
  const tool = (holderGuid) => ({
    id: 'FTL-AAAAAA', tracking_id: 'FTL-AAAAAA', tool_type: 'flat end mill',
    unit: 'inches', diameter: 0.5, description: 'test',
    assemblies: [{ assembly_id: 'a1', instance_guid: 'inst-1', holder_guid: holderGuid, ooh: 1.5 }],
    _instancesRaw: [{ guid: 'inst-1', type: 'flat end mill', holder: { ...OLD } }],
  });

  it('rebuilds the tool\'s holder from the APP record, not the Fusion library', () => {
    const { fusionInstances } = splitToFusionInstances(tool(OLD.guid), REAL, [
      { ...oldRecord(), segments: OLD.segments.map((s, i) => (i === 0 ? { ...s, height: 36 } : s)) },
    ]);
    // 35 in the Fusion library, 36 in the app record — the app record wins.
    expect(fusionInstances[0].holder.segments[0].height).toBe(36);
  });

  it('uses the Fusion library when the holder has no app record', () => {
    const { fusionInstances } = splitToFusionInstances(tool(OLD.guid), REAL, []);
    expect(fusionInstances[0].holder.segments[0].height).toBe(35);
    expect(fusionInstances[0].holder.guid).toBe(OLD.guid);
  });

  it('carries a MERGED holder onto a tool that still points at the old one', () => {
    const merged = mergeHolderRecords(newRecord(), oldRecord()).record;
    const { fusionInstances, metadataTool } = splitToFusionInstances(tool(OLD.guid), REAL, [merged]);
    const written = fusionInstances[0];
    // The tool now carries the survivor's geometry AND its guid…
    expect(written.holder.segments[0].height).toBe(36);
    expect(written.holder.guid).toBe('guid-new');
    // …and the metadata assembly is migrated in the SAME write, so the two
    // stores don't end up disagreeing about which holder this assembly uses.
    expect(metadataTool.assemblies[0].holder_guid).toBe('guid-new');
  });

  it('recomputes assemblyGaugeLength from the resolved holder, never carries it forward', () => {
    const merged = mergeHolderRecords(newRecord(), oldRecord()).record;
    const { fusionInstances } = splitToFusionInstances(tool(OLD.guid), REAL, [merged]);
    const holderGaugeMm = fusionInstances[0].holder.gaugeLength;
    const expected = holderGaugeMm / 25.4 + 1.5;   // holder gauge (mm→in) + OOH
    expect(fusionInstances[0].geometry.assemblyGaugeLength).toBeCloseTo(expected, 6);
  });

  it('leaves the metadata assembly alone when nothing was merged', () => {
    const { metadataTool } = splitToFusionInstances(tool(OLD.guid), REAL, [oldRecord()]);
    expect(metadataTool.assemblies[0].holder_guid).toBe(OLD.guid);
  });

  it('behaves exactly as before when no app records are supplied', () => {
    const before = splitToFusionInstances(tool(OLD.guid), REAL);
    const after = splitToFusionInstances(tool(OLD.guid), REAL, null);
    expect(after.fusionInstances[0].holder).toEqual(before.fusionInstances[0].holder);
  });
});

describe('staleness (what the re-stamp preview counts)', () => {
  const ctx = (records) => ({ records, fusionHolders: REAL });

  it('is not stale when the baked-in holder already matches', () => {
    const raw = { holder: { ...OLD } };
    expect(toolHolderIsStale({ holder_guid: OLD.guid }, raw, ctx([oldRecord()]))).toBe(false);
  });

  it('is stale when the app record has been corrected since', () => {
    const raw = { holder: { ...OLD } };
    const corrected = { ...oldRecord(), segments: OLD.segments.map((s, i) => (i === 0 ? { ...s, height: 36 } : s)) };
    expect(toolHolderIsStale({ holder_guid: OLD.guid }, raw, ctx([corrected]))).toBe(true);
  });

  it('is stale when it points at a holder that was merged away', () => {
    const merged = mergeHolderRecords(newRecord(), oldRecord()).record;
    const raw = { holder: { ...OLD } };
    expect(toolHolderIsStale({ holder_guid: OLD.guid }, raw, ctx([merged]))).toBe(true);
  });

  it('is not stale for a holder nothing knows about — there is nothing to say', () => {
    expect(toolHolderIsStale({ holder_guid: 'nope' }, { holder: {} }, ctx([]))).toBe(false);
  });
});

// ⚠️ THE BACKSTOP. The assembly gauge length (holder gauge + the tool's OOH) is
// where the cutting edge actually sits, so it's the number that catches a
// holder swap going wrong before it lands on N tools.
describe('assembly gauge-length check', () => {
  const chk = (before, after, toolUnit = 'inches') =>
    assemblyGaugeCheck({ before, after, toolUnit, assemblyId: 'a1', holderDescription: 'H' });

  it('passes an unchanged assembly', () => {
    expect(chk(4.5, 4.5).level).toBe('ok');
    expect(chk(4.5, 4.5).deltaIn).toBeCloseTo(0, 9);
  });

  it('passes a small move — a corrected holder is SUPPOSED to move it', () => {
    expect(chk(4.5, 4.5 + ASSEMBLY_GAUGE_WARN_IN / 2).level).toBe('ok');
  });

  it('flags a big move, with the direction and size', () => {
    const c = chk(4.5, 4.5 + 0.25);
    expect(c.level).toBe('warn');
    expect(c.deltaIn).toBeCloseTo(0.25, 6);
    expect(c.reason).toMatch(/\+0\.2500"/);
  });

  it('would have caught the real 30mm body disagreement', () => {
    // The two NBT30-SK20C-60 records differ by 30.155mm = 1.187". Re-stamping
    // onto the wrong one moves every tool using it by that much.
    const c = assemblyGaugeCheck({ before: 90.424, after: 90.424 - 30.155, toolUnit: 'millimeters' });
    expect(c.level).toBe('warn');
    expect(c.deltaIn).toBeCloseTo(-1.1872, 3);
  });

  it('compares in inches so one threshold covers a millimetre tool', () => {
    // 0.5mm ≈ 0.0197" — under the threshold, so not a flag on an mm tool.
    expect(assemblyGaugeCheck({ before: 100, after: 100.5, toolUnit: 'millimeters' }).level).toBe('ok');
    // 2mm ≈ 0.0787" — over it.
    expect(assemblyGaugeCheck({ before: 100, after: 102, toolUnit: 'millimeters' }).level).toBe('warn');
  });

  it('ERRORS only on arithmetic that did not compute — that is unambiguously broken', () => {
    expect(chk(4.5, NaN).level).toBe('error');
    expect(chk(4.5, undefined).level).toBe('error');
    // A zero/negative result is suspicious but not nonsense — warn, don't block.
    expect(chk(4.5, 0).level).toBe('warn');
  });

  it('still reports the new value when there is no previous one to compare', () => {
    const c = chk(undefined, 4.5);
    expect(c.level).toBe('ok');
    expect(c.before).toBeNull();
    expect(c.deltaIn).toBeNull();
    expect(c.after).toBe(4.5);
  });
});

describe('the write path emits the check', () => {
  const toolWith = (bakedAssemblyGauge) => ({
    id: 'FTL-BBBBBB', tracking_id: 'FTL-BBBBBB', tool_type: 'flat end mill',
    unit: 'inches', diameter: 0.5, description: 'test',
    assemblies: [{ assembly_id: 'a1', instance_guid: 'inst-1', holder_guid: OLD.guid, ooh: 1.5 }],
    _instancesRaw: [{
      guid: 'inst-1', type: 'flat end mill', holder: { ...OLD },
      geometry: { assemblyGaugeLength: bakedAssemblyGauge },
    }],
  });

  it('reports ok when the holder did not change', () => {
    const before = splitToFusionInstances(toolWith(undefined), REAL, [oldRecord()]);
    const baked = before.fusionInstances[0].geometry.assemblyGaugeLength;
    const { gaugeChecks } = splitToFusionInstances(toolWith(baked), REAL, [oldRecord()]);
    expect(gaugeChecks).toHaveLength(1);
    expect(gaugeChecks[0].level).toBe('ok');
  });

  it('warns when a corrected holder moves the assembly gauge', () => {
    const first = splitToFusionInstances(toolWith(undefined), REAL, [oldRecord()]);
    const baked = first.fusionInstances[0].geometry.assemblyGaugeLength;
    // Same holder record, body shortened by 30mm — the real failure mode.
    const shortened = {
      ...oldRecord(),
      segments: oldRecord().segments.map((s, i) => (i === 0 ? { ...s, height: 5 } : s)),
    };
    const { gaugeChecks } = splitToFusionInstances(toolWith(baked), REAL, [shortened]);
    expect(gaugeChecks[0].level).toBe('warn');
    expect(Math.abs(gaugeChecks[0].deltaIn)).toBeGreaterThan(ASSEMBLY_GAUGE_WARN_IN);
  });

  it('carries the holder name so the warning can say WHICH holder', () => {
    const { gaugeChecks } = splitToFusionInstances(toolWith(4.0), REAL, [oldRecord()]);
    expect(gaugeChecks[0].holderDescription).toBe('NBT30-SK13C-60');
    expect(gaugeChecks[0].assemblyId).toBe('a1');
  });
});

// The tolerance is PER HOLDER — a holder that was badly modelled moves every
// tool on it, and once the user has seen that it shouldn't keep asking.
describe('per-holder tolerance', () => {
  it('respects an explicit tolerance instead of the default', () => {
    const big = assemblyGaugeCheck({ before: 4.5, after: 5.5, toolUnit: 'inches' });
    expect(big.level).toBe('warn');
    // The same 1" move is fine once the user says so for this holder.
    const allowed = assemblyGaugeCheck({ before: 4.5, after: 5.5, toolUnit: 'inches', tolIn: 2 });
    expect(allowed.level).toBe('ok');
    expect(allowed.tolIn).toBe(2);
  });

  it('a tolerance of 0 flags any movement at all', () => {
    expect(assemblyGaugeCheck({ before: 4.5, after: 4.5001, toolUnit: 'inches', tolIn: 0 }).level).toBe('warn');
    expect(assemblyGaugeCheck({ before: 4.5, after: 4.5, toolUnit: 'inches', tolIn: 0 }).level).toBe('ok');
  });

  it('never lets a tolerance excuse arithmetic that did not compute', () => {
    // The one thing a tolerance can't wave through.
    expect(assemblyGaugeCheck({ before: 4.5, after: NaN, toolUnit: 'inches', tolIn: 99 }).level).toBe('error');
  });

  it('the WRITE PATH reads the tolerance off the resolved holder record', () => {
    const tool = (baked) => ({
      id: 'FTL-CCCCCC', tracking_id: 'FTL-CCCCCC', tool_type: 'flat end mill',
      unit: 'inches', diameter: 0.5, description: 'test',
      assemblies: [{ assembly_id: 'a1', instance_guid: 'inst-1', holder_guid: OLD.guid, ooh: 1.5 }],
      _instancesRaw: [{ guid: 'inst-1', type: 'flat end mill', holder: { ...OLD },
        geometry: { assemblyGaugeLength: baked } }],
    });
    // A holder shortened by 30mm — a 1.19" move on every tool using it.
    const shortened = (tolIn) => ({
      ...oldRecord(),
      restamp_tolerance_in: tolIn,
      segments: oldRecord().segments.map((s, i) => (i === 0 ? { ...s, height: 5 } : s)),
    });
    const baked = splitToFusionInstances(tool(undefined), REAL, [oldRecord()])
      .fusionInstances[0].geometry.assemblyGaugeLength;

    // Default tolerance: flagged.
    expect(splitToFusionInstances(tool(baked), REAL, [shortened(null)])
      .gaugeChecks[0].level).toBe('warn');
    // The user accepted a 2" tolerance for this holder's fix: no longer flagged.
    expect(splitToFusionInstances(tool(baked), REAL, [shortened(2)])
      .gaugeChecks[0].level).toBe('ok');
  });

  it('treats an UNSET tolerance as the default, not as zero', () => {
    // Number(null) is 0 and Number.isFinite(0) is true, so a coercion-only
    // check reads "no tolerance set" as "tolerate nothing" and flags every tool
    // on every holder over floating-point noise.
    const tool = (baked) => ({
      id: 'FTL-DDDDDD', tracking_id: 'FTL-DDDDDD', tool_type: 'flat end mill',
      unit: 'inches', diameter: 0.5, description: 'test',
      assemblies: [{ assembly_id: 'a1', instance_guid: 'inst-1', holder_guid: OLD.guid, ooh: 1.5 }],
      _instancesRaw: [{ guid: 'inst-1', type: 'flat end mill', holder: { ...OLD },
        geometry: { assemblyGaugeLength: baked } }],
    });
    const baked = splitToFusionInstances(tool(undefined), REAL, [oldRecord()])
      .fusionInstances[0].geometry.assemblyGaugeLength;
    for (const unset of [null, undefined, '']) {
      const rec = { ...oldRecord(), restamp_tolerance_in: unset };
      const c = splitToFusionInstances(tool(baked), REAL, [rec]).gaugeChecks[0];
      expect(c.level).toBe('ok');
      expect(c.tolIn).toBe(ASSEMBLY_GAUGE_WARN_IN);
    }
  });

  it('holderToleranceIn is the ONE place unset-vs-zero is decided', () => {
    // Both traps: Number(null) and Number('') are 0, and Number.isFinite(0) is
    // true. A real zero must still mean zero.
    expect(holderToleranceIn(null)).toBe(ASSEMBLY_GAUGE_WARN_IN);
    expect(holderToleranceIn(undefined)).toBe(ASSEMBLY_GAUGE_WARN_IN);
    expect(holderToleranceIn('')).toBe(ASSEMBLY_GAUGE_WARN_IN);
    expect(holderToleranceIn('nonsense')).toBe(ASSEMBLY_GAUGE_WARN_IN);
    expect(holderToleranceIn(0)).toBe(0);
    expect(holderToleranceIn(2)).toBe(2);
    expect(holderToleranceIn('0.25')).toBe(0.25);
  });

  it('always reports the old and new value, flagged or not', () => {
    const c = assemblyGaugeCheck({ before: 4.5, after: 4.75, toolUnit: 'inches', tolIn: 2 });
    expect(c.level).toBe('ok');
    expect(c.before).toBe(4.5);
    expect(c.after).toBe(4.75);
    expect(c.deltaIn).toBeCloseTo(0.25, 6);
  });
});
