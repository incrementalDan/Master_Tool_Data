import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  bodySegments, bodySignature, baseHolderKey, groupByBaseHolder,
  findBodyDivergence, bodyDivergenceFor, recordsWithBodyDivergence,
} from './holderBody.js';
import { fusionHolderToRecord } from '../schema/holderRecord.js';
import { healHolderDescription, applyHealToRecord, suggestExtensionSegments } from './holderDescription.js';
import { DEFAULT_HOLDER_CONFIG } from '../schema/holderOptions.js';
import { convertHolderUnits } from './holderGeometry.js';

const CFG = DEFAULT_HOLDER_CONFIG;
const REAL = JSON.parse(
  readFileSync(new URL('../../FUSION TOOL Library REF/Master-Holder.json', import.meta.url), 'utf8')
).data;

// Build the library the way the app does: import → heal → accept the extension
// segment suggestion. That's the state these checks actually run against.
const LIB = REAL.map(f => {
  const heal = healHolderDescription(f.description, CFG);
  const rec = applyHealToRecord(fusionHolderToRecord(f), heal);
  const idx = suggestExtensionSegments(rec, heal.matched.ext_ooh_in);
  return idx
    ? { ...rec, segments: rec.segments.map((s, i) => (idx.includes(i) ? { ...s, ext: true } : s)) }
    : rec;
});
const find = (d) => LIB.find(h => h.description.trim() === d);

describe('body separation', () => {
  it('is every segment for a holder with no extension', () => {
    const h = find('NBT30-SK13C-60');
    expect(bodySegments(h)).toHaveLength(h.segments.length);
  });

  it('drops the flagged extension segments', () => {
    const h = find('NBT30-SK13C-60 w/ ER8 EXT 1.2OOH');
    expect(h.segments.filter(s => s.ext)).toHaveLength(1);
    expect(bodySegments(h)).toHaveLength(h.segments.length - 1);
  });

  it('is UNRESOLVED (null), not "no extension", when the flags are missing', () => {
    const h = { ...find('NBT30-SK13C-60 w/ ER8 EXT 1.2OOH') };
    h.segments = h.segments.map(s => ({ ...s, ext: false }));
    expect(bodySegments(h)).toBeNull();
    expect(bodySignature(h)).toBeNull();
  });

  it('compares across units — the same part in mm and inches has one signature', () => {
    const mm = find('NBT30-SK13C-60');
    expect(bodySignature(convertHolderUnits(mm, 'inches'))).toBe(bodySignature(mm));
  });
});

describe('base holder grouping', () => {
  it('needs taper + collet + length, and refuses to guess without them', () => {
    const h = find('NBT30-SK13C-60');
    expect(baseHolderKey(h, CFG)).toBe('BT30|SK13|60');
    expect(baseHolderKey({ ...h, length: null }, CFG)).toBeNull();
    expect(baseHolderKey({ ...h, collet_size_id: null }, CFG)).toBeNull();
  });

  it('normalizes taper variants — NBT30 and BBT30 are one BT30 body family', () => {
    const h = find('NBT30-SK13C-60');
    const bbt = { ...h, taper_id: 'tp-bbt30' };
    expect(baseHolderKey(bbt, CFG)).toBe(baseHolderKey(h, CFG));
  });

  it('only groups base holders that actually have siblings', () => {
    for (const g of groupByBaseHolder(LIB, CFG)) expect(g.records.length).toBeGreaterThan(1);
  });
});

// ⚠️ THE REAL FINDING. A holder body and its extension are separate parts
// assembled at several stickouts, so the body is duplicated across records —
// and it has drifted. Three of the four base holders with siblings disagree
// with themselves.
describe('body divergence across the real library', () => {
  const groups = findBodyDivergence(LIB, CFG);
  const byKey = (k) => groups.find(g => g.key === k);

  it('SK13-60 agrees with itself across all three of its records', () => {
    const g = byKey('BT30|SK13|60');
    expect(g.records).toHaveLength(3);
    expect(g.divergent).toBe(false);
    expect(g.variants).toHaveLength(1);
  });

  it('SK20-60 disagrees — the same body, 30mm of it missing in one record', () => {
    const g = byKey('BT30|SK20|60');
    expect(g.divergent).toBe(true);
    expect(g.variants).toHaveLength(2);
    // 40.001 vs 9.846 on the tip-most body segment.
    const heads = g.variants.map(v => v.signature.split(' ')[0]);
    expect(heads.some(h => h.startsWith('40.001'))).toBe(true);
    expect(heads.some(h => h.startsWith('9.846'))).toBe(true);
  });

  it('SK20-90 disagrees on both height AND diameter of its first segment', () => {
    const g = byKey('BT30|SK20|90');
    expect(g.divergent).toBe(true);
    const heads = g.variants.map(v => v.signature.split(' ')[0]);
    expect(heads).toContain('63.000/49.000/49.000');   // the bare holder
    expect(heads).toContain('64.000/46.000/46.000');   // both extension records
  });

  it('reports an unresolvable record separately from a disagreement', () => {
    // "NBT30-SK13C-120 W/er 8 extension OOH1.22" — no tip run sums to 1.22", so
    // its body can't be separated. That is NOT evidence its body differs.
    const g = byKey('BT30|SK13|120');
    expect(g.unresolved.map(h => h.description.trim()))
      .toContain('NBT30-SK13C-120 W/er 8 extension  OOH1.22');
    expect(g.variants).toHaveLength(1);      // everything comparable agrees
    expect(g.divergent).toBe(false);
  });

  it('never picks a winner — it reports every variant with its count', () => {
    const g = byKey('BT30|SK20|90');
    expect(g.variants.reduce((a, v) => a + v.records.length, 0)).toBe(3);
    for (const v of g.variants) expect(v.records.length).toBeGreaterThan(0);
    // No 'correct' / 'canonical' flag anywhere on the result.
    expect(g).not.toHaveProperty('correct');
    expect(g.variants[0]).not.toHaveProperty('canonical');
  });
});

describe('per-record surfacing', () => {
  it('names the siblings a record disagrees with', () => {
    const d = bodyDivergenceFor(find('NBT30-SK20C-60'), LIB, CFG);
    expect(d).toBeTruthy();
    expect(d.others).toHaveLength(1);
    expect(d.others[0].records[0].description).toContain('2.385OOH');
  });

  it('says nothing for a record that agrees with its siblings', () => {
    expect(bodyDivergenceFor(find('NBT30-SK13C-60'), LIB, CFG)).toBeNull();
  });

  it('says nothing for a record whose own body is unresolved', () => {
    expect(bodyDivergenceFor(find('NBT30-SK13C-120 W/er 8 extension  OOH1.22'), LIB, CFG)).toBeNull();
  });

  it('collects exactly the affected records for the list filter', () => {
    const ids = recordsWithBodyDivergence(LIB, CFG);
    expect(ids.has(find('NBT30-SK20C-60').id)).toBe(true);
    expect(ids.has(find('NBT30-SK20C-90').id)).toBe(true);
    expect(ids.has(find('NBT30-SK13C-60').id)).toBe(false);
  });
});
