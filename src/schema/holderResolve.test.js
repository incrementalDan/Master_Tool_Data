import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  resolveHolderForWrite, toolHolderIsStale, assemblyGaugeCheck, gaugeToleranceIn,
  ASSEMBLY_GAUGE_WARN_IN, ASSEMBLY_GAUGE_IMPLAUSIBLE_MM, ASSEMBLY_GAUGE_IMPLAUSIBLE_IN,
  backfillHolderIds, assemblyUsesHolder, toolsUsingHolder, assemblyCountUsingHolder,
  staleHolderTools,
} from './holderResolve.js';
import { fusionHolderToRecord } from './holderRecord.js';
import { mergeHolderRecords } from '../utils/holderDuplicates.js';
import { segmentsMatch } from './holderIdentity.js';
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
    expect(c.reason).toMatch(/\+6\.35mm/);   // reported in mm
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
describe('gauge tolerance', () => {
  it('respects an explicit tolerance instead of the default', () => {
    // 5mm move: flagged at the default, fine at a 6mm tolerance.
    const mm5 = 5 / 25.4;
    expect(assemblyGaugeCheck({ before: 4.5, after: 4.5 + mm5, toolUnit: 'inches' }).level).toBe('warn');
    const allowed = assemblyGaugeCheck({ before: 4.5, after: 4.5 + mm5, toolUnit: 'inches', tolIn: 6 / 25.4 });
    expect(allowed.level).toBe('ok');
  });

  // ⚠️ THE CEILING. A tolerance that could be dragged up far enough would
  // silence the exact failure this check was built for.
  it('a tolerance can NEVER wave through a move beyond the plausible ceiling', () => {
    // The real case: the two NBT30-SK20C-60 records differ by 30.155mm.
    const move = { before: 90.424, after: 90.424 - 30.155, toolUnit: 'millimeters' };
    for (const tolIn of [ASSEMBLY_GAUGE_WARN_IN, 1, 2, 99]) {
      const c = assemblyGaugeCheck({ ...move, tolIn });
      expect(c.level).toBe('warn');
      expect(c.implausible).toBe(true);
      expect(c.reason).toMatch(new RegExp(`${ASSEMBLY_GAUGE_IMPLAUSIBLE_MM}mm`));
    }
  });

  it('clamps a supplied tolerance to the ceiling rather than trusting it', () => {
    expect(gaugeToleranceIn(2)).toBeCloseTo(ASSEMBLY_GAUGE_IMPLAUSIBLE_IN, 9);
    expect(gaugeToleranceIn(99)).toBeCloseTo(ASSEMBLY_GAUGE_IMPLAUSIBLE_IN, 9);
    expect(gaugeToleranceIn(-5)).toBe(0);
    // Anything inside the band is kept as-is.
    expect(gaugeToleranceIn(5 / 25.4)).toBeCloseTo(5 / 25.4, 9);
  });

  it('the ceiling is 10mm — the shop\'s own judgement of "very odd"', () => {
    expect(ASSEMBLY_GAUGE_IMPLAUSIBLE_MM).toBe(10);
    const just_under = assemblyGaugeCheck({ before: 100, after: 109.5, toolUnit: 'millimeters', tolIn: 1 });
    expect(just_under.implausible).toBe(false);
    const just_over = assemblyGaugeCheck({ before: 100, after: 110.5, toolUnit: 'millimeters', tolIn: 1 });
    expect(just_over.implausible).toBe(true);
  });

  it('reports the change in mm — holders are published in mm', () => {
    const c = assemblyGaugeCheck({ before: 100, after: 105, toolUnit: 'millimeters' });
    expect(c.deltaMm).toBeCloseTo(5, 6);
    expect(c.reason).toMatch(/\+5\.00mm/);
  });

  it('a tolerance of 0 flags any movement at all', () => {
    expect(assemblyGaugeCheck({ before: 4.5, after: 4.5001, toolUnit: 'inches', tolIn: 0 }).level).toBe('warn');
    expect(assemblyGaugeCheck({ before: 4.5, after: 4.5, toolUnit: 'inches', tolIn: 0 }).level).toBe('ok');
  });

  it('never lets a tolerance excuse arithmetic that did not compute', () => {
    expect(assemblyGaugeCheck({ before: 4.5, after: NaN, toolUnit: 'inches', tolIn: 99 }).level).toBe('error');
  });

  it('the WRITE PATH grades against the tolerance the CALLER passed', () => {
    // Per-call, never off the record: a stored tolerance would outlive the one
    // correction it described and silence the stragglers afterwards.
    const tool = (baked) => ({
      id: 'FTL-CCCCCC', tracking_id: 'FTL-CCCCCC', tool_type: 'flat end mill',
      unit: 'inches', diameter: 0.5, description: 'test',
      assemblies: [{ assembly_id: 'a1', instance_guid: 'inst-1', holder_guid: OLD.guid, ooh: 1.5 }],
      _instancesRaw: [{ guid: 'inst-1', type: 'flat end mill', holder: { ...OLD },
        geometry: { assemblyGaugeLength: baked } }],
    });
    // A holder shortened by 30mm — a 1.19" move on every tool using it.
    const shortened = {
      ...oldRecord(),
      segments: oldRecord().segments.map((s, i) => (i === 0 ? { ...s, height: 5 } : s)),
    };
    const baked = splitToFusionInstances(tool(undefined), REAL, [oldRecord()])
      .fusionInstances[0].geometry.assemblyGaugeLength;

    // Default tolerance: flagged.
    expect(splitToFusionInstances(tool(baked), REAL, [shortened])
      .gaugeChecks[0].level).toBe('warn');
    // This one is a ~30mm move, so even a maxed-out tolerance keeps it flagged.
    const maxed = splitToFusionInstances(tool(baked), REAL, [shortened],
      { gaugeToleranceIn: 99 }).gaugeChecks[0];
    expect(maxed.level).toBe('warn');
    expect(maxed.implausible).toBe(true);
  });

  it('a tolerance is NEVER read off the holder record', () => {
    // The field is gone; a leftover one on an old Drive record must be inert,
    // never quietly re-silencing a tool.
    const tool = {
      id: 'FTL-EEEEEE', tracking_id: 'FTL-EEEEEE', tool_type: 'flat end mill',
      unit: 'inches', diameter: 0.5, description: 'test',
      assemblies: [{ assembly_id: 'a1', instance_guid: 'inst-1', holder_guid: OLD.guid, ooh: 1.5 }],
      _instancesRaw: [{ guid: 'inst-1', type: 'flat end mill', holder: { ...OLD },
        geometry: { assemblyGaugeLength: 0.001 } }],
    };
    const rec = { ...oldRecord(), restamp_tolerance_in: 99 };   // stale, ignored
    expect(splitToFusionInstances(tool, REAL, [rec]).gaugeChecks[0].level).toBe('warn');
  });

  it('treats NO tolerance as the default, not as zero', () => {
    // Number(null) is 0 and Number.isFinite(0) is true, so a coercion-only
    // check reads "no tolerance given" as "tolerate nothing" and flags every
    // tool on every holder over floating-point noise.
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
      const c = splitToFusionInstances(tool(baked), REAL, [oldRecord()],
        { gaugeToleranceIn: unset }).gaugeChecks[0];
      expect(c.level).toBe('ok');
      expect(c.tolIn).toBe(ASSEMBLY_GAUGE_WARN_IN);
    }
  });

  it('gaugeToleranceIn is the ONE place unset-vs-zero is decided', () => {
    // Both traps: Number(null) and Number('') are 0, and Number.isFinite(0) is
    // true. A real zero must still mean zero.
    expect(gaugeToleranceIn(null)).toBe(ASSEMBLY_GAUGE_WARN_IN);
    expect(gaugeToleranceIn(undefined)).toBe(ASSEMBLY_GAUGE_WARN_IN);
    expect(gaugeToleranceIn('')).toBe(ASSEMBLY_GAUGE_WARN_IN);
    expect(gaugeToleranceIn('nonsense')).toBe(ASSEMBLY_GAUGE_WARN_IN);
    expect(gaugeToleranceIn(0)).toBe(0);
    expect(gaugeToleranceIn('0.25')).toBe(0.25);
    // …and an out-of-band value is clamped, not trusted (see the ceiling test).
    expect(gaugeToleranceIn(2)).toBeCloseTo(ASSEMBLY_GAUGE_IMPLAUSIBLE_IN, 9);
  });

  it('always reports the old and new value, flagged or not', () => {
    const c = assemblyGaugeCheck({ before: 4.5, after: 4.75, toolUnit: 'inches', tolIn: 2 });
    expect(c.level).toBe('ok');
    expect(c.before).toBe(4.5);
    expect(c.after).toBe(4.75);
    expect(c.deltaIn).toBeCloseTo(0.25, 6);
  });
});

// ─── holder_id: the app foreign key ─────────────────────────────────────────
// holder_guid is what Fusion absorbed into the tool; holder_id is the real
// relationship (SQL: assemblies.holder_id REFERENCES holders(id)). These lock
// the precedence rule, because getting it backwards silently pins a tool to the
// wrong holder.
describe('holder_id FK', () => {
  it('resolves by the FK when the guid answers nothing (app-only holder)', () => {
    const rec = { ...oldRecord(), id: 'rec-app-only', fusion_guid: null };
    const r = resolveHolderForWrite(null, { records: [rec], fusionHolders: REAL, holderId: 'rec-app-only' });
    expect(r.source).toBe('app');
    expect(r.recordId).toBe('rec-app-only');
  });

  it('the FK OUTRANKS the Fusion guid — the guid is not a stable identity', () => {
    // Fusion re-issues holder guids for reasons that aren't ours to model, so
    // a guid pointing somewhere else is noise, not an instruction. Re-linking
    // to Fusion is a separate, strict job (holderIdentity.js).
    const a = { ...oldRecord(), id: 'rec-a' };
    const b = { ...newRecord(), id: 'rec-b' };
    const r = resolveHolderForWrite(b.fusion_guid, { records: [a, b], holderId: 'rec-a' });
    expect(r.recordId).toBe('rec-a');
    expect(r.idChanged).toBe(false);
  });

  it('the guid is still the fallback for an assembly with no FK yet', () => {
    const b = { ...newRecord(), id: 'rec-b' };
    const r = resolveHolderForWrite(b.fusion_guid, { records: [b] });
    expect(r.recordId).toBe('rec-b');
    expect(r.idChanged).toBe(true);      // caller stamps holder_id
  });

  it('backfillHolderIds stamps the FK from the guid, and is idempotent', () => {
    const rec = oldRecord();
    const tools = [{ id: 't1', assemblies: [{ assembly_id: 'as1', holder_guid: OLD.guid }] }];
    const once = backfillHolderIds(tools, [rec]);
    expect(once[0].assemblies[0].holder_id).toBe(rec.id);
    expect(backfillHolderIds(once, [rec])[0]).toBe(once[0]);   // no churn
  });

  it('backfillHolderIds leaves a guid that resolves to nothing alone', () => {
    const tools = [{ id: 't1', assemblies: [{ assembly_id: 'as1', holder_guid: 'gone' }] }];
    expect(backfillHolderIds(tools, [oldRecord()])[0].assemblies[0].holder_id).toBeUndefined();
  });

  it('a write re-stamps a stale holder_id onto the metadata assembly', () => {
    const rec = oldRecord();
    const tool = {
      id: 'FTL-1', tracking_id: 'FTL-1', tool_type: 'flat end mill', unit: 'inches',
      diameter: 0.5, description: 'EM',
      assemblies: [{ assembly_id: 'as1', instance_guid: 'i1', holder_guid: OLD.guid, holder_id: 'wrong', ooh: 2 }],
    };
    const { metadataTool } = splitToFusionInstances(tool, REAL, [rec]);
    expect(metadataTool.assemblies[0].holder_id).toBe(rec.id);
  });
});

describe('a record with no geometry is never a write source', () => {
  it('falls through to Fusion rather than blanking the tool’s baked holder', () => {
    // A holder created in the app but not yet drawn. Using it would silently
    // wipe geometry the tool already carries — a data loss the gauge backstop
    // can only warn about after the fact.
    const empty = { ...oldRecord(), segments: [] };
    const r = resolveHolderForWrite(OLD.guid, { records: [empty], fusionHolders: REAL });
    expect(r.source).toBe('fusion');
    expect(r.entry.segments.length).toBeGreaterThan(0);
  });
});

// ─── Linking the existing cutting tools to the controlled holders ───────────
// The FIRST step of the whole exercise: the tools are already out there
// carrying a baked copy of a holder, and the app has to work out which record
// each one is. Fusion's guid can't answer that on its own.
describe('tool → holder linking', () => {
  const REALH = JSON.parse(
    readFileSync(new URL('../../FUSION TOOL Library REF/Master-Holder.json', import.meta.url), 'utf8')
  ).data;

  const toolWith = (baked, guid) => ({
    id: 't1',
    assemblies: [{ assembly_id: 'a1', instance_guid: 'i1', holder_guid: guid ?? baked.guid }],
    _instancesRaw: [{ guid: 'i1', holder: baked }],
  });

  it('links by the baked SEGMENTS when the guid has churned', () => {
    // THE CASE THAT MATTERS. Fusion re-issued the holder's guid after this tool
    // was made, so the guid the tool carries matches nothing. Its shape does.
    const rec = fusionHolderToRecord(OLD);
    const out = backfillHolderIds([toolWith({ ...OLD }, 'a-guid-fusion-has-since-replaced')], [rec]);
    expect(out[0].assemblies[0].holder_id).toBe(rec.id);
  });

  it('refuses to guess when two records share that shape', () => {
    const a = fusionHolderToRecord(OLD);
    const b = { ...fusionHolderToRecord(OLD), id: 'dup' };
    const out = backfillHolderIds([toolWith({ ...OLD }, 'churned')], [a, b]);
    expect(out[0].assemblies[0].holder_id).toBeUndefined();
  });

  it('leaves a holder we simply do not have — that is the loose matcher’s job', () => {
    const rec = fusionHolderToRecord(OLD);
    const alien = { ...OLD, guid: 'x', segments: [{ height: 1, 'upper-diameter': 1, 'lower-diameter': 1 }] };
    expect(backfillHolderIds([toolWith(alien, 'x')], [rec])[0].assemblies[0].holder_id).toBeUndefined();
  });

  it('the guid still wins when it resolves — no needless work', () => {
    const rec = fusionHolderToRecord(OLD);
    const out = backfillHolderIds([toolWith({ ...OLD })], [rec]);
    expect(out[0].assemblies[0].holder_id).toBe(rec.id);
  });

  it('measured on the REAL library: shape links far more tools than the guid', () => {
    // Not a synthetic case. Against the shop's own data the guid connects a
    // minority of tools and the shape connects nearly all of them; this is the
    // reason the segment fallback exists at all.
    const records = REALH.map(fusionHolderToRecord);
    const files = ['Full_Type_List Examples.json', 'Special Cases.json', 'InsertToolREF.json'];
    const tools = [];
    for (const f of files) {
      const data = JSON.parse(readFileSync(
        new URL(`../../FUSION TOOL Library REF/${f}`, import.meta.url), 'utf8')).data || [];
      for (const t of data) {
        if (t.type === 'holder' || !t.holder) continue;
        tools.push(toolWith(t.holder));
      }
    }
    const guidOnly = tools.filter(t =>
      records.some(r => r.fusion_guid === t.assemblies[0].holder_guid)).length;
    const linked = backfillHolderIds(tools, records)
      .filter(t => t.assemblies[0].holder_id).length;

    expect(tools.length).toBeGreaterThan(200);
    expect(linked).toBeGreaterThan(guidOnly * 1.8);       // ~93% vs ~45%
    expect(linked / tools.length).toBeGreaterThan(0.9);
  });
});

// The one predicate every "which tools use this holder" question goes through.
describe('assemblyUsesHolder', () => {
  const rec = { id: 'r1', fusion_guid: 'g1', legacy_fusion_guids: ['g-merged'] };

  it('reads the FK first', () => {
    expect(assemblyUsesHolder({ holder_id: 'r1', holder_guid: 'anything' }, rec)).toBe(true);
    expect(assemblyUsesHolder({ holder_id: 'other', holder_guid: 'g1' }, rec)).toBe(false);
  });

  it('falls back to the guid, following merges, when there is no FK', () => {
    expect(assemblyUsesHolder({ holder_guid: 'g1' }, rec)).toBe(true);
    expect(assemblyUsesHolder({ holder_guid: 'g-merged' }, rec)).toBe(true);
    expect(assemblyUsesHolder({ holder_guid: 'nope' }, rec)).toBe(false);
  });

  it('counts every assembly, not every tool — a tool can use one holder twice', () => {
    const tools = [{ assemblies: [{ holder_id: 'r1' }, { holder_id: 'r1' }, { holder_id: 'x' }] }];
    expect(assemblyCountUsingHolder(tools, rec)).toBe(2);
    expect(toolsUsingHolder(tools, rec)).toHaveLength(1);
  });
});

// ─── Archived holders are invisible ─────────────────────────────────────────
// A merged-away or removed holder is one the shop decided nothing should be
// on. Every path that could put a tool back on it has to refuse, or the archive
// is just a label.
describe('an archived holder is never matched or written', () => {
  const archived = () => ({ ...oldRecord(), archived: true });

  it('is not a geometry source, even via a stored holder_id', () => {
    const r = resolveHolderForWrite(OLD.guid,
      { records: [archived()], fusionHolders: [], holderId: archived().id });
    expect(r).toBeNull();
  });

  it('falls through to the Fusion entry rather than resurrecting the record', () => {
    const r = resolveHolderForWrite(OLD.guid, { records: [archived()], fusionHolders: [OLD] });
    expect(r.source).toBe('fusion');
  });

  // A merge moves the loser's guid onto the survivor. The archived loser still
  // has that guid in its OWN fusion_guid and would match first if the archive
  // were searched — re-attaching the tool to the geometry the merge retired.
  it('a tool on a merged-away guid lands on the SURVIVOR, not the archived loser', () => {
    const { record: survivor } = mergeHolderRecords(newRecord(), oldRecord());
    const retired = { ...oldRecord(), archived: true, merged_into: survivor.id };
    const r = resolveHolderForWrite(OLD.guid,
      { records: [retired, survivor], fusionHolders: [OLD] });
    expect(r.source).toBe('app');
    expect(r.recordId).toBe(survivor.id);
  });

  it('is never picked up by the backfill', () => {
    const tool = {
      id: 't1',
      assemblies: [{ assembly_id: 'a1', instance_guid: 'i1', holder_guid: OLD.guid }],
      _instancesRaw: [{ guid: 'i1', holder: { ...OLD } }],
    };
    expect(backfillHolderIds([tool], [archived()])[0].assemblies[0].holder_id).toBeUndefined();
  });
});

// ─── Which tools are carrying an older copy? ────────────────────────────────
// THE LEAK THE LINK LIST CANNOT SEE: an already-linked assembly is skipped
// there, and a tool arriving on a merged-away guid is auto-linked to the
// survivor — correctly pointed, wrongly shaped, and nothing said so.
describe('staleHolderTools', () => {
  const toolOn = (holder, id = 't1') => ({
    id,
    assemblies: [{ assembly_id: 'a1', instance_guid: 'i1', holder_guid: holder.guid }],
    _instancesRaw: [{ guid: 'i1', holder: { ...holder } }],
  });

  it('is quiet when the baked copy already matches the record', () => {
    const found = staleHolderTools([toolOn(OLD)],
      { records: [oldRecord()], fusionHolders: [OLD] });
    expect(found).toHaveLength(0);
  });

  it('finds a tool whose holder was corrected here after it was made', () => {
    const corrected = { ...oldRecord(), segments: newRecord().segments };
    const found = staleHolderTools([toolOn(OLD)],
      { records: [corrected], fusionHolders: [OLD] });
    expect(found.map(t => t.id)).toEqual(['t1']);
  });

  it('finds the AUTO-LINKED tool that arrives on a merged-away holder', () => {
    const { record: survivor } = mergeHolderRecords(newRecord(), oldRecord());
    // Auto-linked by the backfill, so the link list will never show it.
    const [tool] = backfillHolderIds([toolOn(OLD)], [survivor]);
    expect(tool.assemblies[0].holder_id).toBe(survivor.id);
    expect(staleHolderTools([tool], { records: [survivor], fusionHolders: [OLD] }))
      .toHaveLength(1);
  });

  it('scopes to one holder, and skips no-Fusion tools', () => {
    const corrected = { ...oldRecord(), segments: newRecord().segments };
    const other = { ...newRecord(), id: 'rec-other' };
    expect(staleHolderTools([toolOn(OLD)],
      { records: [corrected], fusionHolders: [OLD], record: other })).toHaveLength(0);
    expect(staleHolderTools([{ ...toolOn(OLD), no_fusion_link: true }],
      { records: [corrected], fusionHolders: [OLD] })).toHaveLength(0);
  });
});

// ─── The stale sweep, measured on the real library ──────────────────────────
// ⚠️ THE BUG THIS LOCKS. toolHolderIsStale compared toFixed(4) strings with no
// tolerance and no unit conversion, and treated a changed baked GUID as
// staleness. Run over the shop's real data that reported 190 of 212 linked
// tools as "carrying an older copy of their holder" — while the strict identity
// matcher said 187 of them were the SAME holder and Fusion re-issues guids
// constantly. A flag that fires on 90% of the library is wallpaper, and the
// number it showed was untrue. One comparison rule, and it asks about GEOMETRY.
describe('staleHolderTools over the real reference library', () => {
  const REAL_TOOLS = JSON.parse(
    readFileSync(new URL('../../FUSION TOOL Library REF/Full_Type_List Examples.json', import.meta.url), 'utf8')
  ).data.filter(t => t.holder);

  const setup = () => {
    const records = REAL.map(f => fusionHolderToRecord(f));
    const tools = REAL_TOOLS.map((t, i) => ({
      id: `t${i}`,
      assemblies: [{ assembly_id: `a${i}`, instance_guid: t.guid, holder_guid: t.holder.guid }],
      _instancesRaw: [t],
    }));
    return { records, tools: backfillHolderIds(tools, records) };
  };

  it('never contradicts the identity matcher', () => {
    const { records, tools } = setup();
    const stale = staleHolderTools(tools, { records, fusionHolders: REAL });
    for (const t of stale) {
      const a = t.assemblies[0];
      const rec = records.find(r => r.id === a.holder_id);
      if (!rec) continue;                       // resolved through Fusion, not a record
      const baked = t._instancesRaw[0].holder;
      // If identity says these are the same holder, staleness must not disagree.
      expect(segmentsMatch(baked.segments, baked.unit, rec.segments, rec.unit)).toBe(false);
    }
  });

  it('flags a handful, not the whole library', () => {
    const { records, tools } = setup();
    const stale = staleHolderTools(tools, { records, fusionHolders: REAL });
    const linked = tools.filter(t => t.assemblies[0].holder_id).length;
    expect(linked).toBeGreaterThan(200);        // the data still looks how we think
    // The real answer is a few genuinely-moved holders — nowhere near all of them.
    expect(stale.length).toBeLessThan(linked * 0.1);
  });

  it('a genuinely corrected holder DOES flag its tools', () => {
    const { records, tools } = setup();
    const target = records.find(r => tools.some(t => t.assemblies[0].holder_id === r.id));
    const corrected = records.map(r => (r.id === target.id
      ? { ...r, segments: r.segments.map((s, i) => (i === 0 ? { ...s, height: s.height + 5 } : s)) }
      : r));
    const before = staleHolderTools(tools, { records, fusionHolders: REAL }).length;
    const after = staleHolderTools(tools, { records: corrected, fusionHolders: REAL }).length;
    expect(after).toBeGreaterThan(before);
  });
});

// ─── The flag has to be CLEARABLE ───────────────────────────────────────────
// ⚠️ REPORTED AS A LOOP. Re-stamp corrected Fusion, but the in-memory tool kept
// its PRE-write `_instancesRaw`, so the sweep re-read the old baked holder and
// reported the same tools as stale. Re-stamp again, same answer — no way out
// short of reloading the page. CLAUDE.md's checklist asks exactly this: "if I
// added a flag, can the user make it go away?"
describe('re-stamping clears the stale flag', () => {
  const ctx = (records) => ({ records, fusionHolders: [OLD] });

  const toolOn = (holder) => ({
    id: 'FTL-BBBBBB', tracking_id: 'FTL-BBBBBB', tool_type: 'flat end mill',
    unit: 'inches', diameter: 0.5, description: 'test',
    assemblies: [{ assembly_id: 'a1', instance_guid: 'i1', holder_guid: holder.guid, ooh: 1.5 }],
    _instancesRaw: [{ guid: 'i1', type: 'flat end mill', holder: { ...holder } }],
  });

  it('is stale before the write and NOT stale after it', () => {
    // The holder was redrawn here: the record moved, the tool still carries the
    // shape Fusion baked in.
    const corrected = { ...oldRecord(), segments: newRecord().segments };
    const tool = toolOn(OLD);
    expect(staleHolderTools([tool], ctx([corrected]))).toHaveLength(1);

    // What the write produces: splitToFusionInstances rebuilds the tool's
    // holder from the record, and writeToolsToFusion now stamps that back onto
    // _instancesRaw. Simulate exactly that hand-off.
    const { fusionInstances } = splitToFusionInstances(tool, [OLD], [corrected]);
    const after = { ...tool, _instancesRaw: fusionInstances };

    expect(after._instancesRaw[0].holder).toBeTruthy();
    expect(staleHolderTools([after], ctx([corrected]))).toHaveLength(0);
  });

  it('keeping the pre-write copy is what made it loop', () => {
    // The old behaviour, asserted so the regression is unmistakable.
    const corrected = { ...oldRecord(), segments: newRecord().segments };
    const tool = toolOn(OLD);
    const staleAgain = { ...tool };            // _instancesRaw carried forward
    expect(staleHolderTools([staleAgain], ctx([corrected]))).toHaveLength(1);
  });
});

// ─── A stale remembered guid must not mislink ───────────────────────────────
// ⚠️ OBSERVED LIVE. A record keeps a `fusion_guid` as a hint, and Fusion can
// hand that guid to a DIFFERENT holder — in the shop's own library a -120
// record still remembered a guid that now belongs to a 145mm test holder.
// Measured over the real 304-tool library the SHAPE resolves every case the
// guid does plus 163 more, with zero disagreements and zero cases only the
// guid could answer — so the guid contributes nothing and can only be wrong.
describe('backfillHolderIds prefers the shape over the guid', () => {
  it('links by the baked SHAPE even when a record remembers that guid', () => {
    // `wrong` remembers the tool's baked guid but is a different holder;
    // `right` has the shape the tool actually carries.
    const right = { ...oldRecord(), id: 'rec-right', fusion_guid: 'some-other-guid' };
    const wrong = { ...newRecord(), id: 'rec-wrong', fusion_guid: OLD.guid };
    const tool = {
      id: 't1',
      assemblies: [{ assembly_id: 'a1', instance_guid: 'i1', holder_guid: OLD.guid }],
      _instancesRaw: [{ guid: 'i1', holder: { ...OLD } }],
    };
    expect(backfillHolderIds([tool], [wrong, right])[0].assemblies[0].holder_id).toBe('rec-right');
  });

  it('still falls back to the guid when there is no usable geometry', () => {
    const rec = { ...oldRecord(), id: 'rec-1', fusion_guid: OLD.guid };
    const tool = {
      id: 't1',
      assemblies: [{ assembly_id: 'a1', instance_guid: 'i1', holder_guid: OLD.guid }],
      _instancesRaw: [{ guid: 'i1', holder: { guid: OLD.guid, segments: [] } }],
    };
    expect(backfillHolderIds([tool], [rec])[0].assemblies[0].holder_id).toBe('rec-1');
  });

  it('leaves an AMBIGUOUS shape to the guid rather than guessing', () => {
    const a = { ...oldRecord(), id: 'rec-a', fusion_guid: 'x' };
    const b = { ...oldRecord(), id: 'rec-b', fusion_guid: OLD.guid };
    const tool = {
      id: 't1',
      assemblies: [{ assembly_id: 'a1', instance_guid: 'i1', holder_guid: OLD.guid }],
      _instancesRaw: [{ guid: 'i1', holder: { ...OLD } }],
    };
    expect(backfillHolderIds([tool], [a, b])[0].assemblies[0].holder_id).toBe('rec-b');
  });
});
