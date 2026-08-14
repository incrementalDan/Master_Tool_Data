import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  composeHolderDescription, healHolderDescription, applyHealToRecord,
  suggestExtensionSegments, findHolderOptionByLabel, HOLDER_DESC_LIMIT,
} from './holderDescription.js';
import { holderNameToken } from './holderNaming.js';
import { DEFAULT_HOLDER_CONFIG, holderOptionLabel } from '../schema/holderOptions.js';
import { newHolderRecord, fusionHolderToRecord } from '../schema/holderRecord.js';
import {
  parseForMatch, scoreDescription, scoreGauge, verdictOf,
  auditToolAgainstHolder, groupAuditByHolder, HOLDER_GAUGE_TOL_IN,
} from './holderAudit.js';
import { deriveGaugeLength } from './holderGeometry.js';

const CFG = DEFAULT_HOLDER_CONFIG;
const REAL = JSON.parse(
  readFileSync(new URL('../../FUSION TOOL Library REF/Master-Holder.json', import.meta.url), 'utf8')
).data;
const byDesc = (d) => REAL.find(h => h.description.trim() === d);
const optId = (list, label) => findHolderOptionByLabel(CFG, list, label)?.id;

// A record built from structured fields, the way the composer sees it.
const rec = (over = {}) => newHolderRecord({
  unit: 'millimeters',
  taper_id: optId('tapers', 'NBT30'),
  collet_family_id: optId('collet_families', 'SK'),
  collet_size_id: optId('collet_sizes', 'SK13'),
  length: 60,
  ...over,
});

describe('composeHolderDescription', () => {
  it('reproduces the plain real target', () => {
    expect(composeHolderDescription(rec(), CFG)).toBe('NBT30-SK13C-60');
  });

  it('reproduces the extension real target, printing OOH in inches on an mm holder', () => {
    const h = rec({
      has_extension: true,
      extension: { collet_size_id: optId('collet_sizes', 'ER8') },
      // 30.48mm = exactly 1.2" — the verified real case.
      segments: [{ height: 30.48, 'upper-diameter': 12, 'lower-diameter': 12, ext: true }],
    });
    expect(composeHolderDescription(h, CFG)).toBe('NBT30-SK13C-60 w/ ER8 EXT 1.2OOH');
  });

  it('prints the shank in the HOLDER\'s unit — deliberately not in inches like the OOH', () => {
    const base = {
      has_extension: true,
      extension: { collet_size_id: optId('collet_sizes', 'ER16') },
      collet_size_id: optId('collet_sizes', 'SK20'),
      length: 90,
    };
    const mm = rec({
      ...base,
      segments: [
        { height: 55.88, 'upper-diameter': 12, 'lower-diameter': 12, ext: true, shank_seg: true },
      ],
    });
    expect(composeHolderDescription(mm, CFG)).toContain('Shank 12mm');

    const inch = rec({
      ...base, unit: 'inches',
      segments: [
        { height: 2.2, 'upper-diameter': 0.75, 'lower-diameter': 0.75, ext: true, shank_seg: true },
      ],
    });
    // Inch convention: no suffix, no leading zero.
    expect(composeHolderDescription(inch, CFG)).toContain('Shank .75');
  });

  it('composes incrementally from whatever is filled in', () => {
    expect(composeHolderDescription(newHolderRecord({}), CFG)).toBe('');
    expect(composeHolderDescription(newHolderRecord({ taper_id: optId('tapers', 'BT40') }), CFG)).toBe('BT40');
  });

  it('adds TAP C without an extension', () => {
    expect(composeHolderDescription(rec({ is_tap_collet: true }), CFG)).toBe('NBT30-SK13C-60 TAP C');
  });

  it('keeps the tag limit as one named constant', () => {
    expect(HOLDER_DESC_LIMIT).toBe(64);
  });
});

// ⚠️ THE CASCADE GUARD. A holder's description IS the token embedded in preset
// names and asm_number, and presetMatchesAssembly reads it back out to seed the
// preset→assembly FK. So a composed description that differs from the
// hand-written one it replaces silently changes every name built from that
// holder — and orphans any preset still matched by name. That is what this pins.
describe('cascade guard — the composed description matches the real one', () => {
  it('composes exactly the hand-written description', () => {
    const cases = [
      [rec(), 'NBT30-SK13C-60'],
      [rec({ collet_size_id: optId('collet_sizes', 'SK20'), length: 90 }), 'NBT30-SK20C-90'],
      [rec({ length: 120 }), 'NBT30-SK13C-120'],
      [rec({ length: 150 }), 'NBT30-SK13C-150'],
    ];
    for (const [record, realDesc] of cases) {
      const composed = composeHolderDescription(record, CFG);
      expect(composed).toBe(realDesc);
      expect(holderNameToken(composed)).toBe(holderNameToken(realDesc));
    }
  });

  it('every real holder description is used verbatim as its name token', () => {
    // A holder has ONE name. Nothing abbreviates it any more.
    expect(holderNameToken('NBT30-SK13C-60')).toBe('NBT30-SK13C-60');
    expect(holderNameToken('NBT30-SK20C-90 w/ER16 EXT 2.2OOH')).toBe('NBT30-SK20C-90 w/ER16 EXT 2.2OOH');
    for (const h of REAL) {
      expect(holderNameToken(h.description)).toBe(String(h.description ?? '').trim());
    }
  });
});

describe('healHolderDescription', () => {
  it('resolves the regular names to option ids with high confidence', () => {
    const h = healHolderDescription('NBT30-SK13C-60', CFG);
    expect(h.confidence).toBe('high');
    expect(holderOptionLabel(CFG, 'tapers', h.matched.taper_id)).toBe('NBT30');
    expect(holderOptionLabel(CFG, 'collet_sizes', h.matched.collet_size_id)).toBe('SK13');
    expect(holderOptionLabel(CFG, 'types', h.matched.type_id)).toBe('Collet');
    expect(h.matched.length).toBe(60);
    expect(h.matched.has_extension).toBeUndefined();
  });

  it('reads an OOH written in any of the real orders', () => {
    const oohOf = (d) => healHolderDescription(d, CFG).matched.ext_ooh_in;
    expect(oohOf('NBT30-SK13C-60 w/ ER8 EXT 1.2OOH')).toBe(1.2);
    expect(oohOf('NBT30-SK13C-120 W/er 8 extension  OOH1.22')).toBe(1.22);
    expect(oohOf('NBT30-SK20C-90 ER16 EX OOH 2.2 Shank .75')).toBe(2.2);
    expect(oohOf('NBT30SK13-90 -ER16 TAP C EX2.33OOH')).toBe(2.33);
    expect(oohOf('BT30 SK13-120 ER16 12mmEXOOH1.75')).toBe(1.75);
  });

  it('treats the shank as a HINT, never a committed field', () => {
    const h = healHolderDescription('NBT30-SK20C-90 ER16 EX OOH 2.2 Shank .75', CFG);
    expect(h.matched).not.toHaveProperty('shank');
    expect(h.flags.join(' ')).toMatch(/mark the matching segment/i);
    expect(h.confidence).toBe('medium');
  });

  it('flags free-text prose as low confidence rather than guessing', () => {
    const h = healHolderDescription('NBT30 Holder for hass 2.5" shell mill', CFG);
    expect(h.confidence).toBe('low');
    expect(h.flags.join(' ')).toMatch(/prose/i);
  });

  it('recognizes the non-collet types', () => {
    const chuck = healHolderDescription('DRILL CHUCK - BT30', CFG);
    expect(holderOptionLabel(CFG, 'types', chuck.matched.type_id)).toBe('Drill Chuck');
    const boring = healHolderDescription('BBT30-CKB3-79 (For  EWN Boring Heads)', CFG);
    expect(holderOptionLabel(CFG, 'types', boring.matched.type_id)).toBe('Boring Head');
    expect(holderOptionLabel(CFG, 'tapers', boring.matched.taper_id)).toBe('BBT30');
  });

  it('parses every real description without throwing, and resolves most of them', () => {
    const graded = REAL.map(h => healHolderDescription(h.description, CFG).confidence);
    expect(graded).toHaveLength(REAL.length);
    // The names are regular enough that the great majority resolve.
    expect(graded.filter(c => c !== 'low').length).toBeGreaterThanOrEqual(REAL.length - 4);
  });

  it('NEVER writes the description when committed — structured fields only', () => {
    const before = fusionHolderToRecord(byDesc('NBT30-SK13C-60'));
    const after = applyHealToRecord(before, healHolderDescription(before.description, CFG));
    expect(after.description).toBe(before.description);
    expect(after.segments).toBe(before.segments);
    expect(after.taper_id).toBeTruthy();
    expect(after.length).toBe(60);
  });
});

describe('suggestExtensionSegments', () => {
  it('proposes the tip run whose heights sum to the OOH in the name', () => {
    const r = fusionHolderToRecord(byDesc('NBT30-SK13C-60 w/ ER8 EXT 1.2OOH'));
    expect(suggestExtensionSegments(r, 1.2)).toEqual([0]);
  });

  it('tolerates a hand-rounded OOH in the name', () => {
    // The name says 2.5; the three tip segments actually sum to 63.8mm = 2.512".
    // A tight tolerance would propose nothing on exactly the holder that needs
    // the help most.
    const r = fusionHolderToRecord(byDesc('NBT30-SK13C-120 er16 12mm shank ext OOH2.5'));
    expect(suggestExtensionSegments(r, 2.5)).toEqual([0, 1, 2]);
  });

  it('returns null rather than guessing when nothing adds up', () => {
    const r = fusionHolderToRecord(byDesc('NBT30-SK13C-60'));
    expect(suggestExtensionSegments(r, 1.2)).toBeNull();
    expect(suggestExtensionSegments(r, null)).toBeNull();
  });
});

// ─── Audit ──────────────────────────────────────────────────────────────────
describe('holder audit', () => {
  const holder = () => {
    const r = fusionHolderToRecord(byDesc('NBT30-SK13C-60'));
    r.taper_id = optId('tapers', 'NBT30');
    r.collet_size_id = optId('collet_sizes', 'SK13');
    r.length = 60;
    return r;
  };
  const gaugeIn = (h) => deriveGaugeLength(h.segments) / 25.4;

  it('normalizes taper variants so naming alone is not a mismatch', () => {
    const h = holder();
    h.taper_id = optId('tapers', 'BBT30');
    // BBT30 record vs an NBT30-worded snapshot: same physical BT30 taper.
    expect(scoreDescription('NBT30-SK13C-60', h, CFG, true).parts[0].ok).toBe(true);
    // …and the toggle really turns it off.
    expect(scoreDescription('NBT30-SK13C-60', h, CFG, false).parts[0].ok).toBe(false);
  });

  it('reports WHICH component failed, not just a percentage', () => {
    const s = scoreDescription('NBT30-SK13C-120', holder(), CFG);
    expect(s.pct).toBeLessThan(100);
    expect(s.failing.map(f => f.name)).toEqual(['Length']);
    expect(s.failing[0]).toMatchObject({ got: 120, want: 60 });
  });

  it('compares gauge in inches across mixed-unit records', () => {
    const h = holder();
    const same = scoreGauge(deriveGaugeLength(h.segments), 'millimeters', h);
    expect(same.within).toBe(true);
    expect(same.delta).toBeCloseTo(0, 6);
    // An inch-native snapshot of the same holder still matches.
    expect(scoreGauge(gaugeIn(h), 'inches', h).within).toBe(true);
    // Past tolerance is real drift.
    expect(scoreGauge(gaugeIn(h) + HOLDER_GAUGE_TOL_IN * 2, 'inches', h).within).toBe(false);
  });

  it('ranks by RISK, not by size of difference', () => {
    const h = holder();
    const ok = auditToolAgainstHolder({ description: 'NBT30-SK13C-60', gauge: gaugeIn(h), unit: 'inches' }, h, CFG);
    expect(ok.verdict.key).toBe('ok');

    // Description agrees, geometry drifted → safe to bulk-fix.
    const stale = auditToolAgainstHolder(
      { description: 'NBT30-SK13C-60', gauge: gaugeIn(h) + 0.04, unit: 'inches' }, h, CFG);
    expect(stale.verdict.key).toBe('stale');
    expect(stale.verdict.bulkFixable).toBe(true);

    // Geometry matches but the LABEL says -120: the dangerous one. Note the
    // geometry difference here is ZERO and it still outranks the stale case.
    const conflict = auditToolAgainstHolder(
      { description: 'NBT30-SK13C-120', gauge: gaugeIn(h), unit: 'inches' }, h, CFG);
    expect(conflict.verdict.key).toBe('conflict');
    expect(conflict.verdict.bulkFixable).toBe(false);
    expect(conflict.verdict.rank).toBeLessThan(stale.verdict.rank);

    // Neither agrees → a different holder entirely.
    const unmatched = auditToolAgainstHolder(
      { description: 'NBT30-SK20C-90', gauge: gaugeIn(h) + 1, unit: 'inches' }, h, CFG);
    expect(unmatched.verdict.key).toBe('unmatched');
  });

  it('groups by holder worst-first and never offers a conflict for re-stamp', () => {
    const h = holder();
    const rows = [
      { holder: h, ...auditToolAgainstHolder({ description: 'NBT30-SK13C-60', gauge: gaugeIn(h), unit: 'inches' }, h, CFG) },
      { holder: h, ...auditToolAgainstHolder({ description: 'NBT30-SK13C-60', gauge: gaugeIn(h) + 0.04, unit: 'inches' }, h, CFG) },
      { holder: h, ...auditToolAgainstHolder({ description: 'NBT30-SK13C-120', gauge: gaugeIn(h), unit: 'inches' }, h, CFG) },
    ];
    const [g] = groupAuditByHolder(rows);
    expect(g.tools[0].verdict.key).toBe('conflict');   // worst first
    expect(g.counts).toEqual({ conflict: 1, stale: 1, ok: 1 });
    expect(g.restampable).toHaveLength(1);
    expect(g.restampable[0].verdict.key).toBe('stale');
  });

  it('parseForMatch stays narrow — only what identifies the holder', () => {
    expect(parseForMatch('NBT30-SK20C-90 ER16 EX OOH 2.2 Shank .75', CFG)).toEqual({
      taper: 'BT30', collet: 'SK20', length: 90, hasExt: true, extCollet: 'ER16',
    });
  });

  it('verdictOf is a pure function of the two scores', () => {
    expect(verdictOf({ pct: 100 }, { within: true }).key).toBe('ok');
    expect(verdictOf({ pct: 100 }, { within: false }).key).toBe('stale');
    expect(verdictOf({ pct: 80 }, { within: true }).key).toBe('conflict');
    expect(verdictOf({ pct: 80 }, { within: false }).key).toBe('unmatched');
  });
});
