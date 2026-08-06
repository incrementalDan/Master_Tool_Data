// Linking the existing cutting tools to the controlled holders. Everything
// here is measured against the shop's real Fusion export, because the whole
// question is what the real mess actually looks like.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  shapeDelta, statedOohIn, descriptionsAgree, proposeHolderLink,
  buildHolderLinkPlan, NEAR_MAX_MM, HOLDER_LINK_SKIP_TYPES,
} from './holderLink.js';
import { fusionHolderToRecord } from '../schema/holderRecord.js';
import { DEFAULT_HOLDER_CONFIG as CFG } from '../schema/holderOptions.js';

const load = (f) => JSON.parse(
  readFileSync(new URL(`../../FUSION TOOL Library REF/${f}`, import.meta.url), 'utf8')).data || [];

const HOLDERS = load('Master-Holder.json');
const RECORDS = HOLDERS.map(fusionHolderToRecord);
const byDesc = (d) => HOLDERS.find(h => h.description.trim() === d);
const recByDesc = (d) => RECORDS.find(r => r.description.trim() === d);

// Every distinct baked holder across the real tool exports, with a tool count.
const BAKED = (() => {
  const seen = new Map();
  for (const f of ['Full_Type_List Examples.json', 'Special Cases.json', 'InsertToolREF.json']) {
    for (const t of load(f)) {
      if (t.type === 'holder' || !t.holder) continue;
      const k = `${t.holder.description || '?'}|${t.holder.gaugeLength}`;
      if (!seen.has(k)) seen.set(k, { holder: t.holder, n: 0 });
      seen.get(k).n++;
    }
  }
  return seen;
})();

const proposeFor = (key) => proposeHolderLink(BAKED.get(key).holder, RECORDS, CFG);

describe('shapeDelta', () => {
  it('reports which dimension differs, not just that something does', () => {
    const rec = recByDesc('NBT30-SK13C-60');
    const d = shapeDelta(byDesc('NBT30-SK13C-60'), rec);
    expect(d.offCount).toBe(0);
    const bent = { ...byDesc('NBT30-SK13C-60') };
    bent.segments = bent.segments.map((s, i) => (i === 3 ? { ...s, 'upper-diameter': s['upper-diameter'] + 2 } : s));
    const d2 = shapeDelta(bent, rec);
    expect(d2.offCount).toBe(1);
    expect(d2.off[0]).toMatchObject({ segment: 3, what: 'upper' });
  });

  it('refuses to compare shapes with different segment counts', () => {
    const rec = recByDesc('NBT30-SK13C-60');
    const short = { ...byDesc('NBT30-SK13C-60'), segments: byDesc('NBT30-SK13C-60').segments.slice(1) };
    expect(shapeDelta(short, rec)).toBeNull();
  });
});

describe('descriptions', () => {
  it('reads a stated stickout in every spelling the shop uses', () => {
    expect(statedOohIn('NBT30-SK13C-60 w/ ER8 EXT 1.2OOH')).toBe(1.2);
    expect(statedOohIn('NBT30-SK20C-90 ER16 EX OOH 2.2 Shank .75')).toBe(2.2);
    expect(statedOohIn('NBT30-SK13C-120')).toBeNull();
  });

  it('a blank on either side is missing information, not a disagreement', () => {
    // Half these names are incomplete; treating a gap as a conflict would
    // reject most of the library.
    expect(descriptionsAgree('NBT30-SK13C-120', '', CFG)).toBe(true);
    expect(descriptionsAgree('', 'anything', CFG)).toBe(true);
  });

  it('DIFFERENT STATED STICKOUT means a different holder', () => {
    // The trap this whole tier exists for.
    expect(descriptionsAgree(
      'NBT30-SK13C-120 ER16 12mm Shank-EX OOH1.60',
      'BT30 SK13-120 ER16 12mmEXOOH1.75', CFG)).toBe(false);
  });

  it('different length in the name means a different holder', () => {
    expect(descriptionsAgree('NBT30-SK13C-120', 'NBT30-SK13C-60', CFG)).toBe(false);
  });
});

describe('proposing a link — the real library', () => {
  it('an exact shape match is automatic', () => {
    const p = proposeHolderLink(byDesc('NBT30-SK13C-60'), RECORDS, CFG);
    expect(p.status).toBe('exact');
    expect(p.record.description.trim()).toBe('NBT30-SK13C-60');
  });

  it('NBT30-SK13C-120 — 2.00mm out, one dimension, name agrees → NEAR', () => {
    // The one the shop uses a lot. Its record IS in the library; the tools
    // carry a copy drawn 2mm shorter on the tip segment, so it never
    // shape-matched and looked "missing".
    const p = proposeFor('NBT30-SK13C-120|4.44878');
    expect(p.status).toBe('near');
    expect(p.record.description.trim()).toBe('NBT30-SK13C-120');
    expect(p.delta.offCount).toBe(1);
    expect(Math.abs(p.delta.worstIn * 25.4)).toBeCloseTo(2.0, 2);
  });

  it('“one dimension out” alone is NOT evidence — a length family is all one dimension apart', () => {
    // A baked SK13C-120 is exactly one dimension from -60, -90, -120 AND -150,
    // because they are the same holder in four lengths. Only the name (and the
    // size of the gap) picks the right one; matching on shape-nearness alone
    // would be a coin flip between four records.
    const baked = BAKED.get('NBT30-SK13C-120|4.44878').holder;
    const oneOff = RECORDS
      .map(r => ({ r, d: shapeDelta(baked, r) }))
      .filter(x => x.d && x.d.offCount === 1);
    expect(oneOff.length).toBeGreaterThan(1);
    expect(oneOff.filter(x => descriptionsAgree(baked.description, x.r.description, CFG))).toHaveLength(1);
  });

  it('the OOH trap is NOT auto-linked, however close the numbers', () => {
    // One dimension, 3.81mm — well inside the near threshold. But 3.81mm is
    // 0.150", which is exactly 1.75 − 1.60 of stickout: the same parts built
    // to a different length, not the same holder drawn differently.
    const p = proposeFor('NBT30-SK13C-120 ER16 12mm Shank-EX OOH1.60|6.127913');
    expect(p.status).toBe('candidate');
    expect(p.record).toBeNull();
    expect(Math.abs(p.delta.worstIn * 25.4)).toBeLessThan(NEAR_MAX_MM);   // close enough to tempt
  });

  it('a gap too large to be a drawing difference stays a candidate', () => {
    const p = proposeFor('NBT30 -SK 20C-90|91.999');
    expect(p.status).toBe('candidate');
    expect(p.alternatives.length).toBeGreaterThan(0);   // still offers somewhere to start
  });

  it('a holder with no geometry says so rather than guessing', () => {
    const p = proposeHolderLink({ description: '', segments: [] }, RECORDS, CFG);
    expect(p.status).toBe('none');
    expect(p.why).toMatch(/no geometry/);
  });

  it('two records of the same shape are a merge job, not a pick', () => {
    const dupes = [...RECORDS, { ...recByDesc('NBT30-SK13C-60'), id: 'dup' }];
    const p = proposeHolderLink(byDesc('NBT30-SK13C-60'), dupes, CFG);
    expect(p.status).toBe('candidate');
    expect(p.why).toMatch(/merge them first/);
  });

  it('the whole real library: 93% exact, the rest tiny and explained', () => {
    const tally = {};
    for (const { holder, n } of BAKED.values()) {
      const s = proposeHolderLink(holder, RECORDS, CFG).status;
      tally[s] = (tally[s] || 0) + n;
    }
    const total = Object.values(tally).reduce((a, b) => a + b, 0);
    expect(tally.exact / total).toBeGreaterThan(0.9);
    // Everything that isn't exact or near is a handful — the point is that the
    // manual worklist is short enough to actually do.
    expect((tally.candidate || 0) + (tally.none || 0)).toBeLessThan(10);
  });
});

describe('the plan', () => {
  const rec = recByDesc('NBT30-SK13C-60');
  const tool = (over = {}) => ({
    id: 't1', unit: 'inches',
    assemblies: [{ assembly_id: 'a1', instance_guid: 'i1', ...over }],
    _instancesRaw: [{ guid: 'i1', holder: byDesc('NBT30-SK13C-60') }],
  });

  it('skips assemblies that are already linked — this is a migration, not an audit', () => {
    expect(buildHolderLinkPlan([tool({ holder_id: rec.id })], RECORDS, CFG).rows).toHaveLength(0);
  });

  it('re-proposes a link whose holder record no longer exists', () => {
    const plan = buildHolderLinkPlan([tool({ holder_id: 'deleted-record' })], RECORDS, CFG);
    expect(plan.rows).toHaveLength(1);
    expect(plan.auto).toHaveLength(1);
  });

  it('splits into auto / near / review and keeps the assembly key on every row', () => {
    const plan = buildHolderLinkPlan([tool()], RECORDS, CFG);
    expect(plan.auto).toHaveLength(1);
    expect(plan.auto[0]).toMatchObject({ toolId: 't1', assemblyId: 'a1' });
    expect(plan.auto[0].record.id).toBe(rec.id);
    expect(plan.rows.length).toBe(plan.auto.length + plan.near.length + plan.review.length);
  });

  // A turning tool carries NO holder in Fusion, so it can only ever land in
  // "need a look" with "nothing to match on" — a row that cannot be cleared.
  // Verified against the real export, so this can't drift into an assumption.
  it('leaves turning tools out, and says so', () => {
    const turning = load('Full_Type_List Examples.json').find(t => t.type === 'turning general');
    expect((turning.holder?.segments || []).length).toBe(0);   // the reason

    const t = { id: 'lathe1', unit: 'inches', tool_type: 'turning general',
      assemblies: [{ assembly_id: 'a1', instance_guid: 'i1' }],
      _instancesRaw: [{ guid: 'i1', holder: turning.holder }] };
    const plan = buildHolderLinkPlan([t, tool()], RECORDS, CFG);
    expect(plan.rows.map(r => r.toolId)).toEqual(['t1']);
    expect(plan.skipped).toHaveLength(1);
  });

  // Grouped with turning for PRESET purposes, but it mounts in an ordinary
  // taper holder — excluding it would strand a holder that links fine.
  it('still links a boring head, which does carry a holder', () => {
    const bar = load('Full_Type_List Examples.json').find(t => t.type === 'boring bar');
    expect(bar.holder.segments.length).toBeGreaterThan(0);
    expect(HOLDER_LINK_SKIP_TYPES.has('boring head')).toBe(false);
  });
});
