import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  newHolderRecord, fusionHolderToRecord, holderRecordToFusion,
  triageProductId, vendorLooksLikeManufacturer,
  HOLDER_APP_ONLY_FIELDS, SEGMENT_APP_ONLY_FIELDS, HOLDER_REF_RE,
} from './holderRecord.js';
import {
  deriveGaugeLength, deriveExtensionOoh, deriveExtensionShankDia,
  convertHolderUnits, buildGaugeExpressionFromFlags, readAboveGaugeFlags,
  nominalLengthCheck, confirmHolderNominal, totalSegmentHeight, formatHolderLen,
} from '../utils/holderGeometry.js';

// The real 20-record holder library — every claim below is checked against it
// rather than against invented data.
const REAL = JSON.parse(
  readFileSync(new URL('../../FUSION TOOL Library REF/Master-Holder.json', import.meta.url), 'utf8')
).data;

const byDesc = (d) => REAL.find(h => h.description.trim() === d);

describe('fusion holder → record', () => {
  it('imports every real holder without losing geometry', () => {
    for (const f of REAL) {
      const r = fusionHolderToRecord(f);
      expect(r.segments).toHaveLength(f.segments.length);
      expect(totalSegmentHeight(r.segments)).toBeCloseTo(
        f.segments.reduce((a, s) => a + s.height, 0), 6);
      expect(r.fusion_guid).toBe(f.guid);
      expect(HOLDER_REF_RE.test(r.holder_ref)).toBe(true);
      // An imported name is hand-written by definition — protect it.
      expect(r.description_manual).toBe(true);
    }
  });

  it('derives the same gauge length Fusion stored', () => {
    for (const f of REAL) {
      const r = fusionHolderToRecord(f);
      // The stored gaugeLength is what Fusion shows; ours is the sum of the
      // below-gauge-line segments. They agree within rounding on real data.
      expect(deriveGaugeLength(r.segments)).toBeCloseTo(f.gaugeLength, 2);
    }
  });

  it('flags exactly the above-gauge segments the expression excludes', () => {
    const f = byDesc('NBT30-SK13C-60');
    const r = fusionHolderToRecord(f);
    // Fusion numbers top-down from 1; the array is bottom-up. segment_1 (the
    // spindle end) is absent from the expression, so the LAST array element is
    // the above-gauge one.
    expect(r.segments.filter(s => s.above_gauge)).toHaveLength(1);
    expect(r.segments[r.segments.length - 1].above_gauge).toBe(true);
  });

  it('preserves what was in product-id: SKU → part number, prose → notes', () => {
    const chuck = fusionHolderToRecord(byDesc('DRILL CHUCK - BT30'));
    expect(triageProductId('BT30-APU13D').kind).toBe('sku');
    expect(chuck.part_number).toBe('BT30-APU13D');
    expect(chuck.legacy_ids).toContain('BT30-APU13D');
    expect(chuck.manufacturer).toBe('Maritool');

    const note = fusionHolderToRecord(byDesc('NBT30-SK13C-120 ER16 12mm Shank-EX OOH2.25'));
    expect(triageProductId('min OOH').kind).toBe('note');
    expect(note.notes).toBe('min OOH');
    expect(note.legacy_ids).toContain('min OOH');

    // Nothing is ever discarded, even when the guess is wrong.
    for (const f of REAL) {
      const raw = String(f['product-id'] || '').trim();
      if (!raw) continue;
      expect(fusionHolderToRecord(f).legacy_ids).toContain(raw);
    }
  });

  it('only treats a company-shaped vendor as a manufacturer', () => {
    expect(vendorLooksLikeManufacturer('Maritool')).toBe(true);
    expect(vendorLooksLikeManufacturer('Nikken ')).toBe(true);
    expect(vendorLooksLikeManufacturer('SK13-ER8')).toBe(false);
    expect(vendorLooksLikeManufacturer('SK13')).toBe(false);
    expect(vendorLooksLikeManufacturer('')).toBe(false);
  });
});

describe('record → fusion (export)', () => {
  it('never leaks an app-only field into the Fusion JSON', () => {
    const r = fusionHolderToRecord(byDesc('NBT30-SK13C-60'));
    r.type_id = 'x'; r.taper_id = 'y'; r.color = '#fff'; r.tags = ['a'];
    r.notes = 'hi'; r.location = 'Cabinet A'; r.length = 60;
    r.segments = r.segments.map(s => ({ ...s, ext: true, shank_seg: true }));

    const out = holderRecordToFusion(r, byDesc('NBT30-SK13C-60'));
    for (const key of HOLDER_APP_ONLY_FIELDS) expect(out).not.toHaveProperty(key);
    for (const seg of out.segments) {
      for (const key of SEGMENT_APP_ONLY_FIELDS) expect(seg).not.toHaveProperty(key);
      expect(Object.keys(seg).sort()).toEqual(['height', 'lower-diameter', 'upper-diameter']);
    }
  });

  it('round-trips a real holder byte-comparable on the fields Fusion reads', () => {
    for (const f of REAL) {
      const out = holderRecordToFusion(fusionHolderToRecord(f), f);
      expect(out.type).toBe('holder');
      expect(out.unit).toBe(f.unit === 'millimeters' ? 'millimeters' : 'inches');
      expect(out.description).toBe(f.description.trim());
      expect(out.segments).toEqual(f.segments.map(s => ({
        height: s.height, 'lower-diameter': s['lower-diameter'], 'upper-diameter': s['upper-diameter'],
      })));
      expect(out.guid).toBe(f.guid);
      // The gauge expression regenerates to what Fusion had.
      expect(out.expressions.tool_holderGaugeLength)
        .toBe(f.expressions.tool_holderGaugeLength);
      // Native + expression are always written together.
      expect(out.expressions.tool_description).toBe(`'${f.description.trim()}'`);
    }
  });

  it('writes the app reference token into product-id', () => {
    const r = fusionHolderToRecord(byDesc('NBT30-SK13C-60'));
    expect(holderRecordToFusion(r)['product-id']).toBe(r.holder_ref);
  });

  it('clamps gauge length to the section total', () => {
    const r = newHolderRecord({
      segments: [{ height: 10, 'upper-diameter': 20, 'lower-diameter': 20 }],
    });
    const out = holderRecordToFusion(r);
    expect(out.gaugeLength).toBeLessThanOrEqual(totalSegmentHeight(r.segments));
  });


});

describe('gauge expression ⇄ above-gauge flags', () => {
  it('is the exact inverse of Fusion\'s expression on every real holder', () => {
    for (const f of REAL) {
      const flags = readAboveGaugeFlags(f);
      const segs = f.segments.map((s, i) => ({ ...s, above_gauge: flags[i] }));
      expect(buildGaugeExpressionFromFlags(segs)).toBe(f.expressions.tool_holderGaugeLength);
    }
  });

  it('falls back to the stored gauge length when there is no expression', () => {
    const f = byDesc('NBT30-SK13C-60');
    const flags = readAboveGaugeFlags({ ...f, expressions: {} });
    expect(flags[flags.length - 1]).toBe(true);
    expect(flags.filter(Boolean)).toHaveLength(1);
  });
});

describe('derived extension geometry', () => {
  it('derives extension OOH from the flagged tip segment — the verified case', () => {
    // NBT30-SK13C-60 gauge 54.999mm; the same holder w/ ER8 EXT 1.2OOH is
    // 85.479mm. The difference is 30.48mm = EXACTLY 1.2 inches, and it is ONE
    // extra segment at the tip.
    const base = byDesc('NBT30-SK13C-60');
    const ext = byDesc('NBT30-SK13C-60 w/ ER8 EXT 1.2OOH');
    expect(ext.gaugeLength - base.gaugeLength).toBeCloseTo(30.48, 3);
    expect(ext.segments.length - base.segments.length).toBe(1);

    const r = fusionHolderToRecord(ext);
    r.segments[0].ext = true;      // array[0] is the tip
    expect(deriveExtensionOoh(r.segments)).toBeCloseTo(30.48, 3);
    expect(deriveExtensionOoh(r.segments) / 25.4).toBeCloseTo(1.2, 4);
  });

  it('takes the shank diameter from the one flagged segment, not the whole extension', () => {
    // The SK20/ER16 holder has TWO extension segments (Ø22.225 collar and
    // Ø19.05 shank). 19.05mm = exactly 0.75", matching its real "Shank .75".
    const r = fusionHolderToRecord(byDesc('NBT30-SK20C-90 w/ER16 EXT 2.2OOH'));
    const shank = r.segments.findIndex(s => Math.abs(s['upper-diameter'] - 19.05) < 0.001);
    expect(shank).toBeGreaterThanOrEqual(0);
    r.segments[shank].ext = true;
    r.segments[shank].shank_seg = true;
    expect(deriveExtensionShankDia(r.segments)).toBeCloseTo(19.05, 3);
    expect(deriveExtensionShankDia(r.segments) / 25.4).toBeCloseTo(0.75, 4);
  });

  it('returns null (not 0) when nothing is flagged', () => {
    expect(deriveExtensionOoh(fusionHolderToRecord(byDesc('NBT30-SK13C-60')).segments)).toBeNull();
    expect(deriveExtensionShankDia([{ height: 1, ext: true }])).toBeNull();
  });
});

describe('unit conversion', () => {
  it('survives a mm→in→mm round trip at 5 decimals (4 would drift)', () => {
    // The real bug: 2mm → 0.0787in → 1.999mm, because 0.0001" is coarser than
    // 0.001mm. Both real values below round-trip clean at 5 decimals.
    const r = newHolderRecord({
      unit: 'millimeters',
      segments: [
        { height: 2.309, 'upper-diameter': 38, 'lower-diameter': 46 },
        { height: 2, 'upper-diameter': 31.75, 'lower-diameter': 31.75 },
      ],
    });
    const back = convertHolderUnits(convertHolderUnits(r, 'inches'), 'millimeters');
    expect(back.segments[0].height).toBeCloseTo(2.309, 3);
    expect(back.segments[1].height).toBeCloseTo(2, 3);
    expect(formatHolderLen(back.segments[1].height, 'millimeters')).toBe('2.000');
  });

  it('converts values, not just the label, and keeps the flags', () => {
    const r = newHolderRecord({
      unit: 'millimeters',
      segments: [{ height: 25.4, 'upper-diameter': 50.8, 'lower-diameter': 50.8, ext: true, above_gauge: true }],
    });
    const inches = convertHolderUnits(r, 'inches');
    expect(inches.unit).toBe('inches');
    expect(inches.segments[0].height).toBeCloseTo(1, 5);
    expect(inches.segments[0]['upper-diameter']).toBeCloseTo(2, 5);
    expect(inches.segments[0].ext).toBe(true);
    expect(inches.segments[0].above_gauge).toBe(true);
  });

  it('is a no-op when the unit is unchanged', () => {
    const r = newHolderRecord({ unit: 'inches' });
    expect(convertHolderUnits(r, 'inches')).toBe(r);
  });

  it('formats metric to 3 decimals and inch to 4', () => {
    expect(formatHolderLen(2.30912, 'millimeters')).toBe('2.309');
    expect(formatHolderLen(2.30912, 'inches')).toBe('2.3091');
  });
});

describe('nominal-length check (family-scoped best guess + one-time confirmation)', () => {
  // The delta is a property of how the COLLET SYSTEM seats, so the band is
  // scoped per family. SK is the only one measured against real data.
  const check = (desc, length, family = 'SK', patch = {}) => {
    const r = { ...fusionHolderToRecord(byDesc(desc)), length, ...patch };
    return nominalLengthCheck(r, family);
  };

  it('passes every well-formed SK holder in the real library', () => {
    expect(check('NBT30-SK13C-60', 60).status).toBe('ok');
    expect(check('NBT30-SK13C-90 (85mm)', 90).status).toBe('ok');
    expect(check('NBT30-SK13C-120', 120).status).toBe('ok');
    expect(check('NBT30-SK13C-150', 150).status).toBe('ok');
    expect(check('NBT30-SK20C-90', 90).status).toBe('ok');
  });

  it('flags NBT30-SK20C-60 — its gauge equals the nominal exactly, which is backwards', () => {
    const n = check('NBT30-SK20C-60', 60);
    expect(n.deltaMm).toBeCloseTo(0, 1);
    expect(n.status).toBe('flag');
  });

  it('flags the other SK20C-60 record too — same body, 30mm of it missing', () => {
    // The two records are the same holder body except the tip-most segment
    // (40.001 vs 9.846). Its EXTENSION is correct — the two flagged tip
    // segments sum to 60.579mm = exactly the 2.385" in its own name — so this
    // is a body problem, not an extension problem.
    const r = fusionHolderToRecord(byDesc('NBT30-SK20C-60 w/ER16 EXT 2.385OOH'));
    r.length = 60;
    r.has_extension = true;
    r.segments = r.segments.map((s, i) => (i < 2 ? { ...s, ext: true } : s));
    expect(deriveExtensionOoh(r.segments) / 25.4).toBeCloseTo(2.385, 4);
    const n = nominalLengthCheck(r, 'SK');
    expect(n.baseGaugeMm).toBeCloseTo(29.845, 2);
    expect(n.status).toBe('flag');
  });

  it('claims NOTHING for a family with no verified band', () => {
    // ER / TG are unverified, and an end-mill / side-lock holder has no nut to
    // back off at all — the premise doesn't apply. Report the number, no verdict.
    for (const family of ['ER', 'TG', null, '']) {
      const n = check('NBT30-SK13C-60', 60, family);
      expect(n.status).toBe('unknown');
      expect(n.band).toBeNull();
      expect(n.deltaMm).toBeCloseTo(5.001, 2);   // still reported
    }
  });

  it('does not apply without an engraved nominal', () => {
    expect(nominalLengthCheck(fusionHolderToRecord(byDesc('NBT30-SK13C-60')), 'SK')).toBeNull();
  });

  it('stays silent on an extension holder whose segments are not flagged yet', () => {
    // The base gauge isn't knowable until the extension segments are flagged, so
    // reporting the whole assembled length against the base nominal would flag
    // every un-flagged extension holder with a large bogus delta.
    const r = fusionHolderToRecord(byDesc('NBT30-SK13C-120 er16 12mm shank ext OOH2.5'));
    r.length = 120;
    r.has_extension = true;
    expect(nominalLengthCheck(r, 'SK')).toBeNull();
    r.segments = r.segments.map((s, i) => (i < 3 ? { ...s, ext: true } : s));
    expect(nominalLengthCheck(r, 'SK').status).toBe('ok');
  });

  it('needs confirmation until the user gives it — even when the app says ok', () => {
    let r = { ...fusionHolderToRecord(byDesc('NBT30-SK13C-60')), length: 60 };
    expect(nominalLengthCheck(r, 'SK').needsConfirmation).toBe(true);
    r = confirmHolderNominal(r, 'SK', 'dan@example.com');
    const n = nominalLengthCheck(r, 'SK');
    expect(n.confirmed).toBe(true);
    expect(n.needsConfirmation).toBe(false);
    // A confirmed-but-flagged holder still READS as flagged; it just stops asking.
    let bad = confirmHolderNominal({ ...fusionHolderToRecord(byDesc('NBT30-SK20C-60')), length: 60 }, 'SK');
    expect(nominalLengthCheck(bad, 'SK')).toMatchObject({ status: 'flag', confirmed: true });
  });

  it('EXPIRES the confirmation when anything the verdict depends on changes', () => {
    const base = { ...fusionHolderToRecord(byDesc('NBT30-SK13C-60')), length: 60 };
    const confirmed = confirmHolderNominal(base, 'SK');
    expect(nominalLengthCheck(confirmed, 'SK').confirmed).toBe(true);

    // the engraved nominal
    expect(nominalLengthCheck({ ...confirmed, length: 90 }, 'SK').confirmed).toBe(false);
    // the geometry
    const moved = {
      ...confirmed,
      segments: confirmed.segments.map((s, i) => (i === 0 ? { ...s, height: s.height + 3 } : s)),
    };
    expect(nominalLengthCheck(moved, 'SK').confirmed).toBe(false);
    // the collet family
    expect(nominalLengthCheck(confirmed, 'ER').confirmed).toBe(false);
    // the unit (a real conversion rewrites every dimension)
    expect(nominalLengthCheck(convertHolderUnits(confirmed, 'inches'), 'SK').confirmed).toBe(false);
  });

  it('is a per-holder record field, and never reaches Fusion', () => {
    const r = confirmHolderNominal({ ...fusionHolderToRecord(byDesc('NBT30-SK13C-60')), length: 60 }, 'SK');
    expect(r.nominal_check.signature).toBeTruthy();
    expect(holderRecordToFusion(r)).not.toHaveProperty('nominal_check');
  });
});
