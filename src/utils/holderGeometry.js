// ─── Holder geometry — derived values over a holder record's segments ───────
//
// Framework-free. Every length here is in the HOLDER's own unit ('inches' |
// 'millimeters') exactly like the rest of the app (see units.js) — there is no
// hidden inches-canonical value. Convert only when crossing into another
// record's unit, via convertLength.
//
// SEGMENT ORDER — the one thing to get right:
//   Fusion's JSON stores segments BOTTOM-UP: array[0] is the tool-tip end,
//   array[last] is the gauge-line / spindle end. Fusion's own editor UI shows
//   them TOP-DOWN (row 1 = spindle end). The app follows Fusion's UI, so the
//   display layer reverses for rendering only — every edit maps back to the
//   real array index and the STORED order never changes. Same flip the gauge
//   expression already does (fusionSegmentNumber = S - jsonArrayIndex).
//
// SEGMENT FLAGS — `above_gauge` is Fusion's own concept (it lives in the
// tool_holderGaugeLength expression, not as a segment key); `ext` and
// `shank_seg` are what this project adds. All three are stripped from the
// Fusion export — see holderRecord.js.

import { MM_PER_IN, normalizeUnit, unitPrecision, convertLength } from './units.js';

// Segments keep Fusion's own key names so the export is a passthrough.
export const SEG_HEIGHT = 'height';
export const SEG_UPPER = 'upper-diameter';
export const SEG_LOWER = 'lower-diameter';

const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? 0 : Number(v));

export const segHeight = (s) => num(s?.[SEG_HEIGHT]);
export const segUpper = (s) => num(s?.[SEG_UPPER]);
export const segLower = (s) => num(s?.[SEG_LOWER]);

export function newSegment(height = 1, dia = 20) {
  return { [SEG_HEIGHT]: height, [SEG_UPPER]: dia, [SEG_LOWER]: dia };
}

// ─── Display order ──────────────────────────────────────────────────────────
// Visual (top-down) index ⇄ real (bottom-up) array index. A contiguous visual
// range is also contiguous in the real array — realIndex is just a mirror.
export const realSegmentIndex = (visualIndex, count) => count - 1 - visualIndex;
export const visualSegmentIndex = realSegmentIndex; // the mirror is its own inverse

// Segments in display order (spindle end first, tip last).
export function displaySegments(segments) {
  return Array.isArray(segments) ? segments.slice().reverse() : [];
}

// Insert a segment so it becomes VISUAL row `visualIndex` (0 = above the top
// row / spindle end, count = below the bottom row / tool tip).
//
// ⚠️ THE MIRROR MAKES THIS NON-OBVIOUS, AND GETTING IT WRONG PUTS THE SEGMENT
// ON THE WRONG END OF THE HOLDER. The display is the stored array reversed, so
// a new visual index vi in a list of count+1 is stored index
// (count+1-1-vi) = count-vi. Both ends check out: inserting above the TOP row
// (vi 0) appends at `count`, because the top row is the LAST stored element;
// inserting below the BOTTOM row (vi = count) prepends at 0, which is exactly
// what "add at tip" always did. Pure, and locked by holderGeometry.test.js —
// the whole reason a segment could only be added at the tip was that there was
// no mapping for anywhere else, which sent the user to Fusion to do it.
// A new segment's height, fixed at 2mm (or the inch equivalent) rather than
// copied from its neighbour. ⚠️ IT MUST NOT MATCH THE ROW IT CAME FROM: seeding
// the height too made the new row identical to the one next to it, and there
// was then nothing on screen saying which of the two was the one just added.
// A distinct small number is the marker.
export const NEW_SEGMENT_HEIGHT_MM = 2;
export const newSegmentHeight = (unit) => Number(
  convertLength(NEW_SEGMENT_HEIGHT_MM, 'millimeters', unit).toFixed(unitPrecision(unit)));

// The segment to insert at VISUAL row `visualIndex`, seeded from the face it
// attaches to so the profile stays continuous instead of jumping to a default
// 20-unit diameter (absurd on an inch holder, and it rescales the whole
// drawing). Inserting ABOVE a row meets that row's upper end, so the new
// segment is a plain cylinder at its upper diameter; inserting at the TIP meets
// the last row's lower end. Diameters are copied — only the height is not.
export function seedSegmentAt(segments, visualIndex, unit) {
  const height = newSegmentHeight(unit);
  const shown = displaySegments(segments);
  if (!shown.length) return newSegment(height);
  const below = shown[visualIndex];                    // the row it sits above
  const dia = below ? segUpper(below) : segLower(shown[shown.length - 1]);
  return newSegment(height, dia);
}

export function insertSegmentAt(segments, visualIndex, segment) {
  const list = Array.isArray(segments) ? segments.slice() : [];
  const at = Math.max(0, Math.min(list.length, list.length - visualIndex));
  list.splice(at, 0, segment);
  return list;
}

// ─── Derived geometry ───────────────────────────────────────────────────────

// Total physical height of every segment, in the holder's unit.
export function totalSegmentHeight(segments) {
  return (segments || []).reduce((a, s) => a + segHeight(s), 0);
}

// Gauge length = sum of every segment NOT above the gauge line, in the
// holder's unit. (Above-gauge segments sit inside the spindle.)
export function deriveGaugeLength(segments) {
  return (segments || []).filter(s => !s?.above_gauge).reduce((a, s) => a + segHeight(s), 0);
}

// Extension OOH = sum of the segments flagged as extension, in the holder's
// unit. DERIVED, never typed. Verified against the real library: the
// "NBT30-SK13C-60 w/ ER8 EXT 1.2OOH" holder's single extra tip segment is
// 30.48mm = exactly 1.2in, which is the "1.2OOH" in its own description.
// Returns null when nothing is flagged, so callers can render "—" rather than
// a misleading 0.
export function deriveExtensionOoh(segments) {
  const ext = (segments || []).filter(s => s?.ext);
  if (!ext.length) return null;
  return ext.reduce((a, s) => a + segHeight(s), 0);
}

// The extension's mating SHANK diameter — the diameter of the ONE segment
// marked `shank_seg`, not of the whole extension. The shop runs the same
// collet with different shank diameters to fit different holders, and that
// diameter is one specific segment inside the extension (the others are the
// collar/head). Verified: the SK20/ER16 holder has two ext segments (Ø22.225
// and Ø19.05); 19.05mm = exactly 0.75", matching its real "Shank .75".
export function deriveExtensionShankDia(segments) {
  const s = (segments || []).find(x => x?.ext && x?.shank_seg);
  if (!s) return null;
  return (segUpper(s) + segLower(s)) / 2;
}

// Does the has_extension flag agree with the flagged segments? Surfaced as a
// warning in the editor — one without the other means the OOH can't derive.
export function extensionFlagMismatch(holder) {
  return !!holder?.has_extension !== (deriveExtensionOoh(holder?.segments) != null);
}

// ─── Unit handling ──────────────────────────────────────────────────────────

// A holder's unit is its OWN — a holder is drawn in whatever unit its
// manufacturer published, independent of the shop default. Toggling it is a
// real value conversion of every stored dimension, not a display relabel.
//
// ⚠️ Rounds to 5 decimals, NOT 4. At 4 decimals of inch precision a single
// mm→in→mm round trip loses real resolution (2mm → 0.0787in → 1.999mm)
// because 0.0001" is coarser than 0.001mm. 5 decimals (0.00001" ≈ 0.000254mm)
// survives the round trip back to 3-decimal mm display. Verified against the
// real library (2.309mm and 2mm both round-trip clean at 5, drift at 4).
export const HOLDER_CONVERT_DECIMALS = 5;

function convRound(value, from, to) {
  if (value == null || value === '' || isNaN(Number(value))) return value;
  return +convertLength(Number(value), from, to).toFixed(HOLDER_CONVERT_DECIMALS);
}

// Convert every length-bearing field on a holder record to another unit.
// `length` (the engraved nominal) is deliberately NOT converted — it is a
// manufacturer's designation printed on the holder, not a measurement.
export function convertHolderUnits(holder, toUnit) {
  const from = normalizeUnit(holder?.unit);
  const to = normalizeUnit(toUnit);
  if (!holder || from === to) return holder;
  return {
    ...holder,
    unit: to,
    segments: (holder.segments || []).map(s => ({
      ...s,
      [SEG_HEIGHT]: convRound(s?.[SEG_HEIGHT], from, to),
      [SEG_UPPER]: convRound(s?.[SEG_UPPER], from, to),
      [SEG_LOWER]: convRound(s?.[SEG_LOWER], from, to),
    })),
  };
}

// Display precision for a holder length: 3 decimals metric, 4 inch. The ONE
// place that rule lives, so it can't drift between the table, the readouts and
// the list. Returns a string (no unit suffix — callers place their own).
export function formatHolderLen(value, unit) {
  if (value == null || value === '' || isNaN(Number(value))) return null;
  return Number(value).toFixed(unitPrecision(unit));
}

// Same value with trailing zeros stripped — for prose (a description reads
// "Shank 12mm", not "Shank 12.000mm").
export function trimHolderLen(value, unit) {
  const s = formatHolderLen(value, unit);
  return s == null ? null : String(+s);
}

export const holderLenIn = (value, unit) => convertLength(value, unit, 'inches');
export const holderLenMm = (value, unit) => convertLength(value, unit, 'millimeters');

// ─── Fusion gauge-length expression ─────────────────────────────────────────
// Fusion re-derives the displayed gauge length from this expression on load, so
// it must be regenerated from the record's above_gauge flags on every export —
// never carried forward. Fusion numbers segments top-down from 1, the array is
// bottom-up: fusionNumber = S - jsonIndex.
//
// This generalizes the existing buildGaugeLengthExpression (which assumes the
// above-gauge segments are a contiguous block at the spindle end). Real data
// always has exactly one, but the editor lets any row be flagged, so the
// expression is built from the actual flags.
export function buildGaugeExpressionFromFlags(segments) {
  const S = (segments || []).length;
  if (!S) return '';
  const terms = [];
  for (let jsonIdx = S - 1; jsonIdx >= 0; jsonIdx--) {
    if (segments[jsonIdx]?.above_gauge) continue;
    terms.push(`segment_${S - jsonIdx}_height`);
  }
  return terms.join(' + ');
}

// The inverse: read Fusion's expression back into per-segment above_gauge
// flags on import. A segment absent from the expression is above the gauge
// line. When there is no usable expression, fall back to the stored
// gaugeLength: flag spindle-end segments until the remainder matches it.
export function readAboveGaugeFlags(fusionHolder) {
  const segs = Array.isArray(fusionHolder?.segments) ? fusionHolder.segments : [];
  const S = segs.length;
  if (!S) return [];
  const expr = String(fusionHolder?.expressions?.tool_holderGaugeLength ?? '');
  const included = new Set(
    [...expr.matchAll(/segment_(\d+)_height/g)].map(m => S - parseInt(m[1], 10))
  );
  if (included.size > 0) return segs.map((_, i) => !included.has(i));

  // No expression — infer from the stored gaugeLength, peeling segments off the
  // spindle end (the end of the array) while the running total still exceeds it.
  const stored = Number(fusionHolder?.gaugeLength);
  const flags = segs.map(() => false);
  if (!isFinite(stored) || stored <= 0) return flags;
  let total = segs.reduce((a, s) => a + segHeight(s), 0);
  const eps = normalizeUnit(fusionHolder?.unit) === 'millimeters' ? 0.01 : 0.0005;
  for (let i = S - 1; i >= 0 && total - stored > eps; i--) {
    flags[i] = true;
    total -= segHeight(segs[i]);
  }
  return flags;
}

// ─── Nominal-length soft check ──────────────────────────────────────────────
// The -60 / -90 / -120 in a part number is the manufacturer's NOMINAL gauge
// length, measured with the collet nut backed off, and it's engraved on the
// holder. Fusion's modelled geometry is measured with the nut TIGHT, so the
// computed gauge runs a few mm shorter.
//
// ⚠️ THE DELTA IS COLLET-FAMILY SPECIFIC. It is a property of how that collet
// system seats, so there is no single shop-wide band:
//   · SK collets — the rule holds. Measured across the real library, every
//     well-formed SK holder lands in +4.2 … +7.0mm.
//   · Other collet families (ER, TG) — NOT necessarily, and unverified here.
//   · End mill / side-lock holders and other non-collet types — no nut to back
//     off, so the premise doesn't apply at all.
// A family with no rule returns status 'unknown': the app makes NO claim rather
// than inventing a band. Add a family here only with data behind it.
//
// Nothing here ever auto-fixes. The app's guess is a starting point; the USER
// confirms each holder once (see holderNominalSignature / the nominal_check
// record field), and is asked again if anything the verdict depends on changes.
export const NOMINAL_BANDS_MM = {
  SK: { min: 3, max: 8 },
};

// Collet families the check knows nothing about return null → 'unknown'.
export function nominalBandFor(familyLabel) {
  const key = String(familyLabel || '').trim().toUpperCase();
  return NOMINAL_BANDS_MM[key] || null;
}

// The verdict depends on exactly these inputs, so a confirmation is only valid
// while they hold. Change the nominal, the geometry, the unit or the collet
// family and the stored confirmation goes stale and the user is asked again.
export function holderNominalSignature(holder, familyLabel) {
  const gauge = deriveGaugeLength(holder?.segments);
  const ext = deriveExtensionOoh(holder?.segments) || 0;
  const baseMm = convertLength(gauge - ext, holder?.unit, 'millimeters');
  return [
    holder?.length ?? '',
    Number.isFinite(baseMm) ? baseMm.toFixed(3) : '',
    normalizeUnit(holder?.unit),
    String(familyLabel || '').toUpperCase(),
  ].join('|');
}

// Best-guess length check. Returns:
//   { status, deltaMm, baseGaugeMm, nominalMm, band, signature, confirmed }
//
//   'na'        — doesn't apply (no engraved nominal, no geometry, or an
//                 extension whose segments aren't flagged yet so the base gauge
//                 isn't knowable)
//   'unknown'   — applies, but there is no verified band for this collet family
//                 (or it isn't a collet holder). The app reports the delta and
//                 says nothing about whether it's right.
//   'ok'/'flag' — inside / outside this family's band
//
// `confirmed` is true when the record carries a confirmation whose signature
// still matches — i.e. a human has looked at THIS combination and accepted it.
// The status is reported alongside it either way, so a confirmed-but-flagged
// holder still reads as flagged; it just stops asking.
export function nominalLengthCheck(holder, familyLabel, band) {
  const nominal = Number(holder?.length);
  const segs = holder?.segments;
  if (!isFinite(nominal) || nominal <= 0 || !Array.isArray(segs) || !segs.length) return null;
  const gauge = deriveGaugeLength(segs);
  if (!gauge) return null;
  const ext = deriveExtensionOoh(segs);
  // The check compares the nominal against the BASE gauge, so it needs the
  // extension subtracted. On a holder that has an extension whose segments
  // aren't flagged yet, that subtraction can't be made — reporting the whole
  // assembled length against the base nominal would flag every un-flagged
  // extension holder with a large bogus delta. Stay silent until it's knowable.
  if (holder?.has_extension && ext == null) return null;

  const baseMm = convertLength(gauge - (ext || 0), holder.unit, 'millimeters');
  const deltaMm = nominal - baseMm;
  const useBand = band !== undefined ? band : nominalBandFor(familyLabel);
  const signature = holderNominalSignature(holder, familyLabel);
  const confirmed = !!holder?.nominal_check?.signature
    && holder.nominal_check.signature === signature;

  const status = !useBand ? 'unknown'
    : (deltaMm >= useBand.min && deltaMm <= useBand.max) ? 'ok' : 'flag';

  return {
    status,
    confirmed,
    needsConfirmation: !confirmed,
    deltaMm,
    baseGaugeMm: baseMm,
    nominalMm: nominal,
    band: useBand,
    familyLabel: familyLabel || null,
    signature,
  };
}

// Stamp a confirmation onto a record. The signature is what makes it expire.
export function confirmHolderNominal(holder, familyLabel, by) {
  return {
    ...holder,
    nominal_check: {
      signature: holderNominalSignature(holder, familyLabel),
      confirmed_at: new Date().toISOString(),
      confirmed_by: by || '',
    },
  };
}

export { MM_PER_IN };
