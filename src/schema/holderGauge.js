// ─── Holder gauge length (expression-derived) ──────────────────────────────
// Fusion numbers holder segments top→bottom starting at 1, but the JSON
// `segments` array stores them in the OPPOSITE order (bottom/collet face first,
// spindle end last): fusionSegmentNumber = S - jsonArrayIndex. The
// `expressions.tool_holderGaugeLength` string sums the segment heights that are
// BELOW the gauge line — segments absent from it are "above the gauge line"
// (inside the spindle) and excluded. See FUSION_SCHEMA.md §1b.

// Sum the heights of the included (below-gauge-line) segments, in the holder's
// OWN unit. Returns null when there is no usable expression so callers can fall
// back to the stored gaugeLength.
function sumGaugeSegments(holder) {
  const segs = holder?.segments;
  if (!Array.isArray(segs) || segs.length === 0) return null;
  const expr = String(holder?.expressions?.tool_holderGaugeLength ?? '');
  const included = [...expr.matchAll(/segment_(\d+)_height/g)].map(m => parseInt(m[1], 10));
  if (included.length === 0) return null;
  const S = segs.length;
  let total = 0;
  for (const fusionNum of included) {
    const jsonIdx = S - fusionNum;   // Fusion UI number → JSON array index
    if (jsonIdx >= 0 && jsonIdx < S) total += Number(segs[jsonIdx]?.height) || 0;
  }
  return total;
}

// Holder gauge length in INCHES, derived from the expression + segments
// (converts from the holder's unit when metric). Falls back to the stored
// gaugeLength when there is no parseable expression.
export function computeGaugeLength(holder) {
  const native = sumGaugeSegments(holder);
  const value = (native != null && native > 0) ? native : Number(holder?.gaugeLength);
  if (value == null || isNaN(value)) return null;
  return holder?.unit === 'millimeters' ? value / 25.4 : value;
}

// Build a holder's tool_holderGaugeLength expression. `aboveGaugeLineCount` is
// the number of spindle-side segments excluded from the gauge length — almost
// always 1; never hardcode a different value without evidence (parse the
// existing expression when correcting one).
export function buildGaugeLengthExpression(totalSegments, aboveGaugeLineCount = 1) {
  const firstIncluded = aboveGaugeLineCount + 1;
  const terms = [];
  for (let n = firstIncluded; n <= totalSegments; n++) terms.push(`segment_${n}_height`);
  return terms.join(' + ');
}

// Build a Fusion holder object from a holder-library entry.
export function buildHolderObject(holderEntry) {
  if (!holderEntry) return null;
  let gaugeLength = holderEntry.gaugeLength;

  // Prefer the gauge length derived from the holder's own
  // tool_holderGaugeLength expression (sum of the below-gauge-line segment
  // heights, in the holder's native unit). This excludes any "above the gauge
  // line" segment and corrects stale/wrong stored values left by older bad
  // writes. Falls back to the stored value when there is no usable expression.
  const nativeSum = sumGaugeSegments(holderEntry);
  if (nativeSum != null && nativeSum > 0) gaugeLength = nativeSum;

  // A holder's gauge length can never physically exceed the total height of its
  // sections. Some holder-library entries store a gauge length rounded a hair
  // larger than the true section sum (e.g. 4.60626 vs 4.606259842519727), which
  // makes Fusion flag "Gauge length exceeds the total height of sections" once
  // the assembly is recomputed. Clamp to the exact section total — this fixes
  // the rounding artifact without touching gauge lengths that are legitimately
  // shorter than the holder (the common case), since min() keeps the smaller.
  if (Array.isArray(holderEntry.segments) && holderEntry.segments.length > 0 && typeof gaugeLength === 'number') {
    const totalHeight = holderEntry.segments.reduce((sum, seg) => sum + (Number(seg?.height) || 0), 0);
    if (totalHeight > 0 && gaugeLength > totalHeight) gaugeLength = totalHeight;
  }

  // Spread the full Fusion-native holder object so no required fields are
  // dropped (e.g. BMC, expressions, or any future Fusion additions), then
  // override only the fields we need to adjust.
  return {
    ...holderEntry,
    gaugeLength,  // clamped value from above; overrides original if it changed
    type: 'holder',  // discriminator — Fusion uses this to recognize the object
  };
}
