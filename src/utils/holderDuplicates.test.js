import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  holderGuidsOf, holderOwnsGuid, holderForGuid, compareHolders,
  findHolderDuplicates, holdersInDuplicates, mergeHolderRecords,
  applyHolderMerge, toolsFollowingMerge,
} from './holderDuplicates.js';
import { fusionHolderToRecord, findHolderRecord, holderRecordToFusion, HOLDER_APP_ONLY_FIELDS } from '../schema/holderRecord.js';
import { healHolderDescription, applyHealToRecord, suggestExtensionSegments } from './holderDescription.js';
import { DEFAULT_HOLDER_CONFIG } from '../schema/holderOptions.js';
import { convertHolderUnits } from './holderGeometry.js';

const CFG = DEFAULT_HOLDER_CONFIG;
const REAL = JSON.parse(
  readFileSync(new URL('../../FUSION TOOL Library REF/Master-Holder.json', import.meta.url), 'utf8')
).data;

const LIB = REAL.map(f => {
  const heal = healHolderDescription(f.description, CFG);
  const rec = applyHealToRecord(fusionHolderToRecord(f), heal);
  const idx = suggestExtensionSegments(rec, heal.matched.ext_ooh_in);
  return idx
    ? { ...rec, segments: rec.segments.map((s, i) => (idx.includes(i) ? { ...s, ext: true } : s)) }
    : rec;
});
const find = (d) => LIB.find(h => h.description.trim() === d);

// The workflow: build a corrected holder in Fusion beside the old one, import,
// and it should be caught here.
const corrected = (orig, patch = {}) => ({
  ...orig,
  id: 'corrected-' + orig.id,
  holder_ref: 'HLD-CCCCCC',
  fusion_guid: 'guid-corrected',
  description: orig.description + ' (v2)',
  ...patch,
});

describe('detection', () => {
  it('finds NO duplicates in the real library as it stands', () => {
    // Every same-classification group in the shop's library is separated by
    // gauge length — those are legitimately different stickouts of the same
    // parts, NOT duplicates. A rule that flagged them would be useless.
    expect(findHolderDuplicates(LIB, CFG)).toHaveLength(0);
  });

  it('catches a corrected rebuild of an existing holder', () => {
    const orig = find('NBT30-SK13C-60');
    // Same holder, same gauge, segments tidied up — the exact case.
    const v2 = corrected(orig, {
      segments: orig.segments.map((s, i) => (i === 3 ? { ...s, 'upper-diameter': 37.98 } : s)),
    });
    const dupes = findHolderDuplicates([...LIB, v2], CFG);
    expect(dupes).toHaveLength(1);
    expect(dupes[0].verdict).toBe('duplicate');
    expect(dupes[0].reasons.join(' ')).toMatch(/gauge/i);
  });

  it('matches on description + specs + gauge, NOT segment-by-segment', () => {
    const orig = find('NBT30-SK13C-60');
    // Wildly different segment breakdown, same overall gauge and same specs:
    // still the same holder, just modelled differently. That's what you merge.
    const v2 = corrected(orig, {
      segments: [{ height: 54.999, 'upper-diameter': 46, 'lower-diameter': 46 },
        { height: 2, 'upper-diameter': 31.75, 'lower-diameter': 31.75, above_gauge: true }],
    });
    const m = compareHolders(orig, v2, CFG);
    expect(m).toBeTruthy();
    expect(m.verdict).toBe('duplicate');
  });

  it('does NOT match two stickouts of the same parts', () => {
    // The legitimate case: same body, same extension collet, different OOH.
    expect(compareHolders(
      find('NBT30-SK13C-60 w/ ER8 EXT 1.2OOH'),
      find('NBT30-SK13C-60 w/ ER8 EXT 1.65OOH'), CFG)).toBeNull();
  });

  it('compares across units', () => {
    const orig = find('NBT30-SK13C-60');
    const v2 = convertHolderUnits(corrected(orig), 'inches');
    expect(compareHolders(orig, v2, CFG).verdict).toBe('duplicate');
  });

  it('downgrades to "possible" when the classification disagrees', () => {
    const orig = find('NBT30-SK13C-60');
    const other = corrected(orig, { collet_size_id: 'cs-sk20' });
    const m = compareHolders(orig, other, CFG);
    expect(m.verdict).toBe('possible');
    expect(m.conflicts).toContain('Collet');
    expect(m.reasons.join(' ')).toMatch(/Collet differs/);
  });

  it('treats an unclassified field as unknown, not a disagreement', () => {
    // Most of the library starts unclassified — requiring agreement on a blank
    // field would miss every duplicate involving a hastily-entered holder.
    const orig = find('NBT30-SK13C-60');
    const bare = corrected(orig, { collet_size_id: null, taper_id: null, length: null });
    const m = compareHolders(orig, bare, CFG);
    expect(m.verdict).toBe('duplicate');
    expect(m.conflicts).toHaveLength(0);
  });

  it('reports which holders are involved, for the list filter', () => {
    const v2 = corrected(find('NBT30-SK13C-60'));
    const ids = holdersInDuplicates([...LIB, v2], CFG);
    expect(ids.has(v2.id)).toBe(true);
    expect(ids.has(find('NBT30-SK13C-60').id)).toBe(true);
    expect(ids.has(find('NBT30-SK13C-120').id)).toBe(false);
  });
});

// ⚠️ THE POINT OF THE MERGE: everything that used the old holder follows the
// new one, without rewriting anything.
describe('merge', () => {
  const orig = () => ({ ...find('NBT30-SK13C-60'), fusion_guid: 'guid-old', manufacturer: '', location: '' });
  const v2 = () => corrected(orig(), { manufacturer: 'Nikken', location: 'Cabinet A', fusion_guid: 'guid-new' });

  it('the survivor adopts the loser\'s Fusion guid, so tools follow it', () => {
    const { record } = mergeHolderRecords(v2(), orig());
    expect(record.fusion_guid).toBe('guid-new');
    expect(record.legacy_fusion_guids).toContain('guid-old');
    expect(holderOwnsGuid(record, 'guid-old')).toBe(true);
    expect(holderOwnsGuid(record, 'guid-new')).toBe(true);
    expect(holderGuidsOf(record).sort()).toEqual(['guid-new', 'guid-old']);
  });

  it('resolves a tool\'s absorbed guid to the survivor — with NO tool writes', () => {
    const merged = mergeHolderRecords(v2(), orig()).record;
    const records = [merged];
    // A tool still carrying the OLD guid, untouched.
    const tool = { assemblies: [{ holder_guid: 'guid-old' }, { holder_guid: 'guid-old' }] };
    expect(holderForGuid(records, 'guid-old')).toBe(merged);
    expect(findHolderRecord(records, { fusion_guid: 'guid-old' })).toBe(merged);
    expect(toolsFollowingMerge(orig(), [tool])).toBe(2);
  });

  it('fills only the survivor\'s BLANK fields — never overwrites it', () => {
    const survivor = { ...v2(), manufacturer: 'Kept', location: '' };
    const loser = { ...orig(), manufacturer: 'Other', location: 'Cabinet A', notes: 'from old' };
    const { record, filled } = mergeHolderRecords(survivor, loser);
    expect(record.manufacturer).toBe('Kept');       // survivor wins
    expect(record.location).toBe('Cabinet A');      // gap filled
    expect(record.notes).toBe('from old');
    expect(filled).toContain('location');
    expect(filled).not.toContain('manufacturer');
  });

  it('NEVER takes the loser\'s geometry — picking a survivor is picking geometry', () => {
    const survivor = v2();
    const loser = { ...orig(), segments: [{ height: 999, 'upper-diameter': 1, 'lower-diameter': 1 }] };
    const { record } = mergeHolderRecords(survivor, loser);
    expect(record.segments).toEqual(survivor.segments);
    expect(record.unit).toBe(survivor.unit);
  });

  it('keeps the loser\'s reference searchable', () => {
    const loser = { ...orig(), holder_ref: 'HLD-OLD001', legacy_ids: ['min OOH'] };
    const { record } = mergeHolderRecords(v2(), loser);
    expect(record.legacy_ids).toContain('HLD-OLD001');
    expect(record.legacy_ids).toContain('min OOH');
    expect(findHolderRecord([record], { holder_ref: 'HLD-OLD001' })).toBe(record);
  });

  it('carries guids through a chain of merges', () => {
    const a = { ...orig(), fusion_guid: 'g1' };
    const b = { ...corrected(orig()), fusion_guid: 'g2' };
    const c = { ...corrected(orig()), id: 'c3', fusion_guid: 'g3' };
    const first = mergeHolderRecords(b, a).record;          // a → b
    const second = mergeHolderRecords(c, first).record;     // b → c
    expect(holderGuidsOf(second).sort()).toEqual(['g1', 'g2', 'g3']);
  });

  it('removes the loser from the file and leaves everything else alone', () => {
    const file = { version: 1, holders: [orig(), v2()], parts: [{ id: 'p1', role: 'body' }] };
    const next = applyHolderMerge(file, v2().id, orig().id);
    expect(next.holders).toHaveLength(1);
    expect(next.holders[0].id).toBe(v2().id);
    expect(next.holders[0].legacy_fusion_guids).toContain('guid-old');
    expect(next.parts).toEqual(file.parts);
  });

  it('is a no-op when either side is missing', () => {
    const file = { holders: [orig()] };
    expect(applyHolderMerge(file, 'nope', orig().id)).toBe(file);
    expect(mergeHolderRecords(null, orig())).toBeNull();
  });

  it('the adopted guids never reach Fusion', () => {
    const { record } = mergeHolderRecords(v2(), orig());
    const out = holderRecordToFusion(record);
    expect(out).not.toHaveProperty('legacy_fusion_guids');
    for (const k of HOLDER_APP_ONLY_FIELDS) expect(out).not.toHaveProperty(k);
    // The survivor's own guid is what Fusion sees.
    expect(out.guid).toBe('guid-new');
  });
});

// The import guard. A merge is only durable if the merged-away holder stays
// merged away — otherwise re-running the Fusion import resurrects it and TWO
// records claim the same guid, which makes holderForGuid order-dependent.
describe('re-importing after a merge', () => {
  const a = { ...LIB[0], id: 'rec-a', fusion_guid: 'guid-a' };
  const b = { ...LIB[1], id: 'rec-b', fusion_guid: 'guid-b' };
  const survivor = mergeHolderRecords(a, b).record;

  it('an adopted guid is one the library already answers for', () => {
    // This is the set importHoldersFromFusion skips on. Matching on
    // fusion_guid alone would miss the adopted one.
    const known = new Set([survivor].flatMap(holderGuidsOf));
    expect(known.has('guid-b')).toBe(true);
    expect(new Set([survivor].map(h => h.fusion_guid)).has('guid-b')).toBe(false);
  });

  it('and only one record resolves for it', () => {
    expect(holderForGuid([survivor], 'guid-b')).toBe(survivor);
  });
});
