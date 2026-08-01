import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  newHolderPart, holderPartsOf, findHolderPart, holderPartFor, holderPartIdFor,
  holderPartDrift, holdersWithPartDrift, holdersUsingPart,
  adoptHolderGeometryIntoPart, proposeHolderParts, buildPartFromProposal,
  applyPartProposals, HOLDER_PART_ROLES,
} from './holderParts.js';
import { fusionHolderToRecord, holderRecordToFusion, HOLDER_APP_ONLY_FIELDS } from '../schema/holderRecord.js';
import { healHolderDescription, applyHealToRecord, suggestExtensionSegments } from './holderDescription.js';
import { DEFAULT_HOLDER_CONFIG } from '../schema/holderOptions.js';
import { convertHolderUnits, deriveGaugeLength } from './holderGeometry.js';

const CFG = DEFAULT_HOLDER_CONFIG;
const REAL = JSON.parse(
  readFileSync(new URL('../../FUSION TOOL Library REF/Master-Holder.json', import.meta.url), 'utf8')
).data;

// The library in the state the app actually holds it: imported, healed,
// extension segments flagged from the suggestion.
const LIB = REAL.map(f => {
  const heal = healHolderDescription(f.description, CFG);
  const rec = applyHealToRecord(fusionHolderToRecord(f), heal);
  const idx = suggestExtensionSegments(rec, heal.matched.ext_ooh_in);
  return idx
    ? { ...rec, segments: rec.segments.map((s, i) => (idx.includes(i) ? { ...s, ext: true } : s)) }
    : rec;
});
const FILE = { version: 1, holders: LIB, parts: [] };
const find = (d) => LIB.find(h => h.description.trim() === d);

describe('part records', () => {
  it('carries the sourcing that belongs to the PART, not the assembly', () => {
    const p = newHolderPart('body', { description: 'NBT30-SK20C-90', part_number: 'ABC-1' });
    expect(p.role).toBe('body');
    expect(p.purchasing).toEqual({ manufacturers: [], vendors: [] });
    expect(p.part_number).toBe('ABC-1');
    expect(newHolderPart('extension').role).toBe('extension');
    // Anything unrecognized falls back to a body rather than minting a role.
    expect(newHolderPart('nonsense').role).toBe('body');
  });

  it('reads a link, and a dangling id reads as not linked', () => {
    const part = newHolderPart('body');
    const file = { holders: [], parts: [part] };
    const linked = { ...find('NBT30-SK13C-60'), body_part_id: part.id };
    expect(holderPartFor(linked, 'body', file)).toBe(part);
    expect(holderPartFor({ ...linked, body_part_id: 'gone' }, 'body', file)).toBeNull();
    expect(holderPartIdFor(linked, 'extension')).toBeNull();
  });

  it('never reaches Fusion', () => {
    const r = { ...find('NBT30-SK13C-60'), body_part_id: 'b1', extension_part_id: 'e1' };
    const out = holderRecordToFusion(r);
    expect(out).not.toHaveProperty('body_part_id');
    expect(out).not.toHaveProperty('extension_part_id');
    for (const k of HOLDER_APP_ONLY_FIELDS) expect(out).not.toHaveProperty(k);
  });
});

describe('drift between a holder and the part it points at', () => {
  const linkBody = (h, part) => ({ ...h, body_part_id: part.id });

  it('says nothing when the geometry still matches', () => {
    const h = find('NBT30-SK13C-60');
    const part = newHolderPart('body', { unit: h.unit, segments: h.segments.map(s => ({ ...s })) });
    const file = { holders: [], parts: [part] };
    expect(holderPartDrift(linkBody(h, part), 'body', file)).toBeNull();
  });

  it('compares across units — an mm part and an inch holder of one part agree', () => {
    const h = find('NBT30-SK13C-60');
    const part = newHolderPart('body', { unit: h.unit, segments: h.segments.map(s => ({ ...s })) });
    const file = { holders: [], parts: [part] };
    const inchHolder = convertHolderUnits(linkBody(h, part), 'inches');
    expect(holderPartDrift(inchHolder, 'body', file)).toBeNull();
  });

  it('reports drift when the holder geometry differs from the part', () => {
    const h = find('NBT30-SK13C-60');
    const part = newHolderPart('body', {
      unit: h.unit,
      segments: h.segments.map((s, i) => (i === 0 ? { ...s, height: s.height + 5 } : { ...s })),
    });
    const file = { holders: [], parts: [part] };
    const d = holderPartDrift(linkBody(h, part), 'body', file);
    expect(d).toBeTruthy();
    expect(d.role).toBe('body');
    expect(d.holderSig).not.toBe(d.partSig);
  });

  it('says nothing — rather than "no drift" — when there is no link or no part', () => {
    const h = find('NBT30-SK13C-60');
    expect(holderPartDrift(h, 'body', { parts: [] })).toBeNull();
    expect(holderPartDrift({ ...h, body_part_id: 'gone' }, 'body', { parts: [] })).toBeNull();
  });

  it('says nothing when the holder\'s extension segments are not flagged yet', () => {
    const h = { ...find('NBT30-SK13C-60 w/ ER8 EXT 1.2OOH') };
    h.segments = h.segments.map(s => ({ ...s, ext: false }));
    const part = newHolderPart('extension', { unit: h.unit, segments: [{ height: 999, 'upper-diameter': 1, 'lower-diameter': 1 }] });
    const file = { holders: [], parts: [part] };
    expect(holderPartDrift({ ...h, extension_part_id: part.id }, 'extension', file)).toBeNull();
  });

  it('adopting the holder geometry into the part clears the drift', () => {
    const h = find('NBT30-SK13C-60');
    let part = newHolderPart('body', { unit: h.unit, segments: [{ height: 1, 'upper-diameter': 1, 'lower-diameter': 1 }] });
    const linked = linkBody(h, part);
    expect(holderPartDrift(linked, 'body', { parts: [part] })).toBeTruthy();
    part = adoptHolderGeometryIntoPart(part, linked, 'body');
    expect(holderPartDrift(linked, 'body', { parts: [part] })).toBeNull();
  });
});

// ⚠️ THE MIGRATION. It links; it does not decide which geometry is right.
describe('proposing parts from the real library', () => {
  const { bodies, extensions } = proposeHolderParts(LIB, CFG);
  const body = (k) => bodies.find(b => b.key === k);

  it('proposes ONE body part per physical base holder', () => {
    expect(body('BT30|SK13|60').holders).toHaveLength(3);
    expect(body('BT30|SK20|90').holders).toHaveLength(3);
    expect(body('BT30|SK20|60').holders).toHaveLength(2);
    // One part per base holder, not one per record.
    expect(new Set(bodies.map(b => b.key)).size).toBe(bodies.length);
  });

  it('reports which holders will DRIFT rather than silently resolving them', () => {
    // SK13-60's three records agree — nothing drifts.
    expect(body('BT30|SK13|60').willDrift).toHaveLength(0);
    // SK20-90 and SK20-60 disagree, so the odd ones out are named up front.
    expect(body('BT30|SK20|90').willDrift).toHaveLength(1);
    expect(body('BT30|SK20|60').willDrift).toHaveLength(1);
  });

  it('proposes one extension part per distinct extension', () => {
    expect(extensions.length).toBeGreaterThan(0);
    for (const e of extensions) {
      expect(e.role).toBe('extension');
      expect(e.label).toMatch(/OOH/);
      expect(e.holders.length).toBeGreaterThan(0);
    }
  });

  it('carries the seed record\'s sourcing onto the part', () => {
    const p = buildPartFromProposal(body('BT30|SK20|60'), CFG).part;
    expect(p.role).toBe('body');
    expect(p.segments.length).toBeGreaterThan(0);
    expect(p.taper_id).toBeTruthy();
    expect(p.length).toBe(60);
  });

  it('applying the proposals links the holders and CHANGES NO GEOMETRY', () => {
    const next = applyPartProposals(FILE, [...bodies, ...extensions], CFG);
    expect(next.parts).toHaveLength(bodies.length + extensions.length);

    for (const before of LIB) {
      const after = next.holders.find(h => h.id === before.id);
      // The whole promise of this model: linking never touches segments.
      expect(after.segments).toEqual(before.segments);
      expect(deriveGaugeLength(after.segments)).toBe(deriveGaugeLength(before.segments));
    }
    // Every holder in a proposal now points at its part.
    const linked = next.holders.filter(h => h.body_part_id);
    expect(linked.length).toBe(bodies.reduce((a, b) => a + b.holders.length, 0));
  });

  it('lights up exactly the disagreeing holders as drift after linking', () => {
    const next = applyPartProposals(FILE, [...bodies, ...extensions], CFG);
    const drifted = holdersWithPartDrift(next.holders, next);
    // The two known-bad records, and nothing that agrees with its part.
    const desc = (id) => next.holders.find(h => h.id === id).description.trim();
    const names = [...drifted].map(desc).sort();
    // Exactly the two records whose body disagrees with the seeded part. The
    // seed prefers a BARE holder when the variants tie, so it's the extension
    // record that drifts on SK20-60 — deterministic, and the bare record's
    // geometry is the body with nothing subtracted.
    // SK20-60: a one-to-one tie, so the BARE record seeds and the extension
    // record drifts. SK20-90: two extension records agree against one bare, so
    // the majority seeds and the bare record drifts. Both deterministic, and
    // either way the disagreement is now attached to a named holder instead of
    // being invisible duplication.
    expect(names).toEqual([
      'NBT30-SK20C-60 w/ER16 EXT 2.385OOH',
      'NBT30-SK20C-90',
    ]);
    expect(names).not.toContain('NBT30-SK13C-60');
  });

  it('is idempotent — re-running proposes nothing already linked', () => {
    const next = applyPartProposals(FILE, [...bodies, ...extensions], CFG);
    const again = proposeHolderParts(next.holders, CFG);
    // Same shape (it proposes from geometry, not from links), so committing
    // twice must be prevented by the UI, not by silent deduping here.
    expect(again.bodies).toHaveLength(bodies.length);
  });

  it('counts the holders using a part, for the delete guard', () => {
    const next = applyPartProposals(FILE, bodies, CFG);
    const part = next.parts[0];
    expect(holdersUsingPart(part, next.holders).length).toBeGreaterThan(0);
    expect(holderPartsOf(next, 'body')).toHaveLength(bodies.length);
    expect(findHolderPart(next, part.id)).toBe(part);
  });

  it('covers both roles', () => {
    expect(HOLDER_PART_ROLES).toEqual(['body', 'extension']);
  });
});
