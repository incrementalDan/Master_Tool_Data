// ─── Tool Profile — the whole tool, drawn, with its values on the drawing ───
//
// Fusion splits a tool across four tabs (General / Cutter / Shaft / Holder), so
// no screen ever shows the tool. This does: one vertical silhouette, tip down
// as it hangs in the spindle, with the geometry as engineering-print dimensions
// whose value boxes ARE the editable fields.
//
// ⚠️ THIS IS THE DRAWING ITSELF, CONTROLLED — it owns no draft and no Save.
// It was the inside of ToolProfileModal; the tool page renders the SAME
// component in its Geometry section, so there is exactly one drawing in the app
// and the page and the modal can never disagree about it. The caller owns the
// draft and decides when it is written.
//
// NOT TO SCALE, on purpose: X and Y are scaled independently. A real tool runs
// 20:1 to 60:1 long-to-wide, so a true-proportion drawing is a hairline that
// shows nothing. Every CAM tool-library screen distorts this the same way; the
// drawing is labelled NTS rather than pretending otherwise.
import { useState, useMemo } from 'react';
import { Info } from 'lucide-react';
import { buildToolProfile, profileDimensions, shaftRows } from '../utils/toolProfile.js';
import { FIELD_REGISTRY, fieldLabel, INCLUSIVE_ANGLE_TYPES } from '../schema/fieldRegistry.js';
import { unitAbbr, unitPrecision, convertLength } from '../utils/units.js';
import { undercutDiameterHint, resolveReachFields, deriveReach } from '../utils/toolReach.js';

// ── drawing constants (px) ──────────────────────────────────────────────────
// ── drawing constants (px) ──────────────────────────────────────────────────
const BODY_W = 132;   // widest the part itself may draw
const BODY_H = 430;   // tallest the part itself may draw
const LANE = 94;      // one dimension lane
const GAP = 14;       // part edge → first extension line
const TOP_PAD = 26;
const BOT_PAD = 26;
const LABEL_H = 26;
// ⚠️ A LENGTH BOX IS PLACED BY ITS EDGE, NOT BY ITS CENTRE. Centring it on its
// own dimension line put half the box — ~40px — inside the tool, because the
// line sits only GAP away from the body. The diameter boxes on the right never
// had this: they were always placed by their left edge. Fixing the width is
// what makes the left stack predictable: the first box sits exactly GAP from
// the outer diameter and each one after it steps left by a whole LANE, so the
// gutters between them are equal and none of them can reach the part.
const LEN_BOX_W = 82;
const EDGE_PAD = 4;   // keep the outermost box off the canvas edge
// ⚠️ THE SHANK IS BROKEN WHEN IT WOULD SWALLOW THE DRAWING. A shanked tool runs
// 20:1 to 60:1, and nearly all of that is plain shank carrying no information:
// on a Ø.039 × 2.5" micro end mill the flutes are 2% of the length, so a
// linear drawing gives the one thing worth seeing about ten pixels and spends
// the rest on an empty cylinder. An interrupted view is the standard print
// answer to exactly this, and the break symbol is what says so.
// ⚠️ The trigger is what the break is FOR: the part below the shank being
// squeezed. Testing the SHANK's share instead broke tools that needed no
// break — a 2"-flute ball mill on a 4" body is half shank, and its flutes
// already have half the canvas. Set well clear of the ordinary tools (a bull
// mill sits at 38%) so the break marks the genuinely long-reach micro tools —
// the Ø.039 x 2.5" is 11% — rather than flickering on and off between two
// tools that look the same.
const BREAK_BELOW = 0.30; // below-shank portion under this share of the length → break
const BREAK_KEEP = 88;    // px the broken shank is drawn as, at most
// ⚠️ AND THE MAGNIFICATION IS CAPPED. Filling the canvas with whatever sits
// below the shank works until that part is itself tiny: a 1/8" chamfer mill has
// a .058" cutting length on a 1.5" body, and blowing it up to fill the drawing
// made a chamfer tip look like a 1" flute. Six times true scale is enough to
// read a micro tool's neck and still recognisably a tip.
const MAX_MAG = 6;
const RIGHT_PAD = 26;     // the diameter value boxes overhang their lane

// ⚠️ SHORT NAMES, NOT THE REGISTRY LABEL. A dimension label has to fit inside
// one lane; "Shoulder Length (in)" is wider than the lane and overlapped its
// neighbour. The unit already sits in the value box, so the "(in)" is dead
// weight here — this is the one place the registry label is deliberately not
// used, and only for display.
const SHORT = {
  flute_length: 'Flute', shoulder_length: 'Shoulder', reach: 'Reach',
  min_ooh: 'Min OOH', overall_length: 'OAL',
  diameter: 'Cut dia', shank_diameter: 'Shank', undercut_diameter: 'Undercut',
};

// A new segment continues from the face it attaches to — the top of the current
// stack, or the cutting diameter when there is nothing there yet. Seeding it
// with an arbitrary size would jump the profile and rescale the whole drawing.
// (Same reasoning as the holder module's `seedSegmentAt`.)
// ⚠️ THE FALLBACKS ARE UNIT-AWARE. Both were inch numbers, so on a metric tool
// with no geometry yet the seed was a 0.1mm segment at 0.25mm — a hair, and the
// drawing rescaled around it. Stated in mm and converted, the way the holder
// module's `newSegmentHeight` does it.
// ⚠️ THE STEP COMES FROM THE FIELD AND THE RECORD'S UNIT, never a literal.
// `0.001` is a thou in inches and a MICRON in mm, so every arrow-key nudge on a
// metric tool was a thousandth of nothing. A length steps one decade coarser
// than its display precision (0.001 in / 0.01 mm), an angle a half degree
// (matching ToolFields' STEP table), a count 1.
const stepFor = (field, unit) => {
  const def = FIELD_REGISTRY[field] || {};
  if (def.precision === 0) return '1';
  if (def.unit === 'angle') return '0.5';
  return String(10 ** -(unitPrecision(unit) - 1));
};

// ⚠️ EACH VALUE BOX BORDERS IN THE COLOUR OF THE REGION IT NAMES, which is
// what retired the swatch legend under the segment table: a key you have to
// look away to read is worse than the boxes saying it themselves. Only fields
// that name ONE region are coloured — OAL spans the whole tool and REACH spans
// the flutes plus the neck, so both stay neutral rather than claiming a part.
const REGION_OF = {
  flute_length: 'flute',
  diameter: 'flute',            // the cutting diameter IS the flute region's
  shoulder_length: 'shoulder',
  shank_diameter: 'shank',
  undercut_diameter: 'segment', // the neck's diameter — a segment's, not the tool's
  // ⚠️ The holder face is not a REGION of the tool — it is where the holder
  // starts. It carries its own colour so that, sharing the ordinate column with
  // the tool's own lengths, it still reads as a different KIND of thing.
  min_ooh: 'holder',
};

// The field that marks the holder face. Named so the drawing reads as what it
// is rather than as one more length in the stack.
const HOLDER_FACE = 'min_ooh';
// How far the datum runs past the tool. ⚠️ ASYMMETRIC ON PURPOSE: it reaches
// left towards the ordinate column its value sits in, and the right
// side has to stop short of `GAP`, where the diameter leaders start — a tool
// whose undercut sits near the holder face otherwise crossed a dashed datum and
// a solid leader at the same height.
const HOLDER_OVERHANG_L = 30;
// The horizontal run of a dog-legged leader on each side of its diagonal.
const JOG = 12;
const HOLDER_OVERHANG_R = 10;
// ⚠️ MEASURED, not guessed — the boxes are HTML overlaid on the SVG, so every
// collision test here is running against a height CSS decides. At 34 it was
// already under the real 36; the bigger field-name text took the real box to
// 39.5, which is a box-and-a-bit of clearance the lane logic thought it had.
// If .tp-dimbox-label / -input / .dia are restyled, re-measure this.
const DIMBOX_H = 40;             // label + input, for flipping the value box

const SEED_HEIGHT_MM = 2.5;      // a visible starting height on either unit
const SEED_DIAMETER_MM = 6;      // ~1/4", the commonest shank either way
function newSegment(segs, profile, unit) {
  const round = (v) => Number(Number(v).toFixed(unitPrecision(unit)));
  const mm = (v) => round(convertLength(v, 'millimeters', unit));
  const top = segs.length ? segs[segs.length - 1] : null;
  const dia = top ? top.upper : (profile.diameter || mm(SEED_DIAMETER_MM));
  // ⚠️ Rounded, or a tenth of a 63mm tool arrives as 6.300000000000001 in the box.
  return { height: round(Math.max(mm(SEED_HEIGHT_MM), (profile.total || 0) * 0.1)), lower: dia, upper: dia };
}

// The undercut pill writes the OVERRIDE and lets the shared resolver work out
// the effective values, so the modal cannot drift from what the load-time pass
// would conclude for the same tool.
const applyUndercut = (d, v) => {
  const next = { ...d, undercut_override: v };
  return { ...next, ...resolveReachFields(next) };
};

// taper_angle displays doubled for chamfer/tapered mills (stored as the half
// angle) — the same transform ToolFields applies.
const doubles = (field, toolType) => field === 'taper_angle' && INCLUSIVE_ANGLE_TYPES.has(toolType);

// ⚠️ `readOnly` is the PAGE'S edit mode, not a property of any field. The tool
// page shows this drawing all the time and unlocks it only when the user asks
// to edit (see ToolDetail) — a page whose numbers are typeable the moment it
// opens invites an edit nobody meant to make. It is distinct from a field being
// DERIVED (reach, undercut Ø), which is read-only in both modes.
export default function ToolProfileFields({ draft, setDraft, readOnly = false }) {
  const [hoverSeg, setHoverSeg] = useState(null);
  const unit = unitAbbr(draft.unit);
  const profile = useMemo(() => buildToolProfile(draft), [draft]);
  const dims = useMemo(() => profileDimensions(draft.tool_type), [draft.tool_type]);
  // ⚠️ THE EDITOR READS EVERY STORED ROW (`shaftRows`), never the drawing's
  // filtered list. See shaftRows — editing off the filtered read deleted a
  // segment the instant its height went momentarily blank.
  const segs = useMemo(() => shaftRows(draft), [draft]);
  // The text being typed into one cell, keyed "storedIndex-field". A number
  // input reports `''` for partial text (".", "-", "1e"), so the raw string has
  // to be held somewhere or the field fights every retype.
  const [cell, setCell] = useState(null);
  // ⚠️ A 0.001 step is a thou in inches and a NANOMETRE-ish nothing in mm, so
  // the arrows would be useless on a metric tool. One decade coarser than the
  // record's display precision.
  const segStep = stepFor('flute_length', draft.unit);   // a plain length step

  // Editing the shaft writes `shaft_segments` on the draft; the derived reach
  // and undercut follow from it through the shared resolver, so the drawing and
  // the dimensions move together as you type.
  const setSegs = (next, append = false) => {
    setDraft(d => {
      const withSegs = { ...d, shaft_segments: next };
      return { ...withSegs, ...resolveReachFields(withSegs) };
    });
    if (append) setHoverSeg(next.length - 1);
  };
  // ⚠️ THE BOX BEING TYPED IN STAYS ON THE DRAWING. A dimension is drawn only
  // where it has a value, and a number input reports '' the instant its text is
  // cleared — so clearing a box to retype it made the box UNMOUNT under the
  // cursor. Exactly the "a blank cell is mid-edit, not a zero" rule the segment
  // table already carries, in the one place it had not been applied.
  const [activeDim, setActiveDim] = useState(null);

  const set = (field, raw) => {
    const v = raw === '' || raw === null ? null : Number(raw);
    const stored = v == null || Number.isNaN(v) ? null : (doubles(field, draft.tool_type) ? v / 2 : v);
    setDraft(d => ({ ...d, [field]: stored }));
  };
  const shown = (field) => {
    const v = draft[field];
    if (v === null || v === undefined || v === '') return '';
    return doubles(field, draft.tool_type) ? Number(v) * 2 : v;
  };

  // ── layout ────────────────────────────────────────────────────────────────
  const { total, maxDia } = profile;
  // ⚠️ Lengths nest leftward SHORTEST-FIRST, the way a print stacks dimensions
  // that share a datum. Laying them out in registry order put MIN OOH (2.5")
  // outside Shoulder (4.0") — lines crossing for no reason — and bunched the
  // labels, since a label sits at its own midpoint and similar lengths have
  // similar midpoints.
  // ⚠️ MIN OOH IS NOT A LENGTH DIMENSION — it is WHERE THE HOLDER STARTS, the
  // face of the collet nut. Drawn as a nested dimension it read as "another
  // length of the tool", stacked in among the flutes and the shoulder. It is a
  // datum: one dotted line across the drawing, wider than the tool, with its
  // value sitting on it. (Some tool types could be calculated from the holder;
  // nothing here tries — the number is the shop's.)
  // The plain shank is compressed to a fixed height and marked with a break, so
  // the flutes, the neck and the segments get the canvas instead.
  const shankReg = profile.regions.find(r => r.kind === 'shank');
  const shankSpan = shankReg ? shankReg.y1 - shankReg.y0 : 0;
  const broken = !!shankReg && total > 0 && shankReg.y0 > 0
    && shankSpan > 0 && shankReg.y0 / total < BREAK_BELOW;
  const brk = broken ? shankReg.y0 : total;            // where the break begins
  const linearSy = total > 0 ? BODY_H / total : 0;
  const sy = broken && brk > 0
    ? Math.min((BODY_H - BREAK_KEEP) / brk, linearSy * MAX_MAG)
    : linearSy;
  // Whatever height the magnified lower part leaves is the shank's.
  const shankDrawH = broken ? Math.max(12, BODY_H - brk * sy) : 0;
  const yBase = TOP_PAD + BODY_H;                       // the tip, at the bottom
  const yAt = (v) => {
    if (!broken || v <= brk) return yBase - v * sy;
    const past = total > brk ? (v - brk) / (total - brk) : 0;
    return yBase - brk * sy - past * shankDrawH;
  };

  // ⚠️ ORDINATE, not nested. Every length is measured from the TIP, so each one
  // is a single horizontal leader out to its value at its own height, with the
  // zero datum assumed — the way a CNC print dimensions from one origin. It
  // replaced a nested stack where each dimension owned a lane 94px wide, which
  // made the drawing 634px and left no room beside it for anything else.
  const svgH = BODY_H + TOP_PAD + BOT_PAD;

  // ⚠️ ONE COLUMN, AND A LEADER THAT DOG-LEGS TO REACH IT. Two lengths that are
  // EQUAL — a drill whose shoulder IS its MIN OOH is ordinary, not a corner
  // case — land at the same height. They used to fan sideways into extra lanes,
  // which is not what an ordinate dimension does and cost 94px of canvas each:
  // three of them took the drawing past the width its container has, and the
  // Cutter and Shaft Segments panels wrapped underneath.
  //
  // A print instead keeps every value in ONE column and jogs the leader. So the
  // box moves UP or DOWN until it clears its neighbour, and the leader runs out
  // from the part at the TRUE height, doglegs across, and comes into the box at
  // its displaced height. The number stays readable, the drawing stays narrow,
  // and nothing about which height a dimension actually names is lost.
  //
  // ⚠️ MIN OOH IS IN THIS COLUMN TOO. It is measured from the same assumed
  // datum as the rest, so a print puts it in the same run of values — and
  // leaving it outside was what forced a second lane here. What makes it a
  // DATUM rather than another tool length is its dotted line across the whole
  // tool and its own colour, both of which it keeps.
  const MIN_GAP = DIMBOX_H + 4;
  const lengthDims = (() => {
    const rows = dims.lengths
      .map(field => ({ field, value: Number(draft[field]) || 0 }))
      .filter(d => d.value > 0 || d.field === activeDim)
      .sort((a, b) => a.value - b.value)
      .map(d => ({ ...d, y: yAt(Math.min(Math.max(d.value, 0), total)) }));

    // Bottom-up: the smallest value sits lowest, and each one above it has to
    // clear the last by a whole box.
    const topLimit = TOP_PAD + DIMBOX_H / 2;
    const bottomLimit = svgH - BOT_PAD - DIMBOX_H / 2;
    let prev = null;
    for (const r of rows) {
      let by = Math.min(r.y, bottomLimit);
      if (prev != null) by = Math.min(by, prev - MIN_GAP);
      r.boxY = by;
      prev = by;
    }
    // ⚠️ Then clamp the TOP box into the canvas and push only what it collides
    // with. Shifting the whole run instead moved every box on the drawing —
    // OAL's box always clamps (its true height IS the top edge, and a centred
    // box needs half its height above that), so every leader on every tool
    // doglegged for a reason that had nothing to do with crowding.
    for (let i = rows.length - 1; i >= 0; i--) {
      if (i === rows.length - 1) rows[i].boxY = Math.max(rows[i].boxY, topLimit);
      else rows[i].boxY = Math.max(rows[i].boxY, rows[i + 1].boxY + MIN_GAP);
    }
    return rows;
  })();

  // The datum still draws its line at its own height, whatever its box does.
  const yHolder = lengthDims.find(d => d.field === HOLDER_FACE)?.y ?? null;

  // One lane, always — which is the whole point of the dogleg above.
  const cx = BODY_W / 2 + GAP + LEN_BOX_W + EDGE_PAD;
  const sx = maxDia > 0 ? BODY_W / maxDia : 0;
  const halfAt = (d) => (d * sx) / 2;
  const lenBoxCx = cx - BODY_W / 2 - GAP - LEN_BOX_W / 2;

  // ── the silhouette ────────────────────────────────────────────────────────
  const fluteRegion = profile.regions.find(r => r.kind === 'flute');
  const fluteTipPath = () => {
    if (!fluteRegion) return null;
    const r = halfAt(fluteRegion.dBottom);
    const yTop = yAt(fluteRegion.y1);
    const yBase = yAt(0);
    const { tipKind, cornerRadius, tipAngle, diameter, tipDiameter } = profile;

    if (tipKind === 'taper' && tipDiameter > 0 && tipDiameter < diameter) {
      // A chamfer/tapered mill narrows to its tip diameter over the flutes.
      const rt = halfAt(tipDiameter);
      return `M ${cx - r} ${yTop} L ${cx - rt} ${yBase} L ${cx + rt} ${yBase} L ${cx + r} ${yTop} Z`;
    }

    if (tipKind === 'point' && tipAngle > 0 && diameter > 0) {
      // The point is INSIDE the flute length, so it is carved into the bottom.
      const depth = (diameter / 2) / Math.tan((tipAngle / 2) * Math.PI / 180);
      const yShoulder = yAt(Math.min(depth, fluteRegion.y1));
      return `M ${cx - r} ${yTop} L ${cx - r} ${yShoulder} L ${cx} ${yBase} L ${cx + r} ${yShoulder} L ${cx + r} ${yTop} Z`;
    }
    if (tipKind === 'ball') {
      const ry = Math.min((diameter / 2) * sy, (fluteRegion.y1) * sy);
      return `M ${cx - r} ${yTop} L ${cx - r} ${yBase - ry} A ${r} ${ry} 0 0 0 ${cx + r} ${yBase - ry} L ${cx + r} ${yTop} Z`;
    }
    if (tipKind === 'radius' && cornerRadius > 0) {
      const rx = Math.min(cornerRadius * sx, r);
      const ry = Math.min(cornerRadius * sy, (fluteRegion.y1) * sy);
      return `M ${cx - r} ${yTop} L ${cx - r} ${yBase - ry} A ${rx} ${ry} 0 0 0 ${cx - r + rx} ${yBase} `
        + `L ${cx + r - rx} ${yBase} A ${rx} ${ry} 0 0 0 ${cx + r} ${yBase - ry} L ${cx + r} ${yTop} Z`;
    }
    return `M ${cx - r} ${yTop} L ${cx - r} ${yBase} L ${cx + r} ${yBase} L ${cx + r} ${yTop} Z`;
  };

  const regionPath = (rg) => {
    const hb = halfAt(rg.dBottom), ht = halfAt(rg.dTop);
    const y0 = yAt(rg.y0), y1 = yAt(rg.y1);
    return `M ${cx - hb} ${y0} L ${cx + hb} ${y0} L ${cx + ht} ${y1} L ${cx - ht} ${y1} Z`;
  };

  // ── dimension placement ───────────────────────────────────────────────────
  // Diameters go right, each at its own region's mid-height, bumped to the next
  // lane when two would overlap.
  const diaTargets = [];
  const pushDia = (field, value, yVal, halfPx) => {
    if (!(Number(value) > 0) && field !== activeDim) return;
    const y = yAt(yVal);
    const lane = diaTargets.some(d => Math.abs(d.y - y) < LABEL_H + 6 && d.lane === 0) ? 1 : 0;
    diaTargets.push({ field, value, y, halfPx, lane });
  };
  if (fluteRegion) pushDia('diameter', draft.diameter, (fluteRegion.y0 + fluteRegion.y1) / 2, halfAt(fluteRegion.dBottom));
  const narrowest = profile.regions
    .filter(r => r.kind === 'segment')
    .reduce((m, r) => (m == null || Math.min(r.dBottom, r.dTop) < Math.min(m.dBottom, m.dTop) ? r : m), null);
  if (draft.has_undercut && narrowest && dims.diameters.includes('undercut_diameter')) {
    // ⚠️ The STORED value only — never the hint. An undercut can be flagged
    // without anyone measuring it, and falling back to the hint drew a
    // dimension leader pointing at an empty box: the drawing asserting a
    // number the record does not hold. No dimension beats a wrong one; the
    // Cutter panel still says Undercut: Yes.
    pushDia('undercut_diameter', draft.undercut_diameter,
      (narrowest.y0 + narrowest.y1) / 2, halfAt(Math.min(narrowest.dBottom, narrowest.dTop)));
  }
  const shankRegion = profile.regions.find(r => r.kind === 'shank');
  if (shankRegion && dims.diameters.includes('shank_diameter')) {
    // ⚠️ Not mid-shank — that is exactly where the break symbol goes, and the
    // dimension arrow drew straight through the zigzag.
    pushDia('shank_diameter', draft.shank_diameter,
      shankRegion.y0 + 0.78 * (shankRegion.y1 - shankRegion.y0), halfAt(shankRegion.dTop));
  }

  // The canvas is exactly as wide as the dimensions need. A fixed two-lane
  // right gutter left a lane of dead space on every tool that only dimensions
  // a cut diameter and a shank.
  const nRight = diaTargets.reduce((m, d) => Math.max(m, d.lane + 1), 1);
  const svgW = cx + BODY_W / 2 + nRight * LANE + RIGHT_PAD;
  const fieldOf = (f) => FIELD_REGISTRY[f] || {};
  // ⚠️ A dimension the SEGMENTS answer is read-only, for the same reason the
  // segment table is: it is Fusion's number. Rendering it as an input invites
  // a value that the next load silently re-derives away — the failure this
  // whole change was made to remove.
  const derived = deriveReach(draft);
  const isDerived = (f) =>
    (f === 'reach' && derived.reach != null) ||
    (f === 'undercut_diameter' && derived.neckDiameter != null);
  const labelOf = (f) => (doubles(f, draft.tool_type)
    ? 'Incl. Tip Angle (°)'
    : (fieldLabel(f, draft.unit) || f));
  // On the drawing only — see SHORT.
  const dimLabelOf = (f) => SHORT[f] || labelOf(f);

  // ⚠️ A DIMENSION THE TOOL HAS NEVER HAD STILL NEEDS SOMEWHERE TO BE TYPED.
  // The drawing can only place a box where there is a value to place it at, and
  // the grid below hides everything the drawing owns — so a blank MIN OOH (or
  // shoulder, or shank Ø) had NO input anywhere on the page and could never be
  // filled in. "Every field in exactly one place" has to mean at least one.
  //
  // They are listed rather than drawn on purpose: a leader pointing at nothing
  // is the drawing asserting a number the record does not hold, which is the
  // same rule that keeps the undercut hint off the drawing.
  const drawnDims = new Set([
    ...lengthDims.map(d => d.field),
    ...diaTargets.map(d => d.field),
    ...(yHolder != null ? [HOLDER_FACE] : []),
  ]);
  const unsetDims = readOnly ? [] : [...dims.lengths, ...dims.diameters]
    .filter(f => !drawnDims.has(f) && !isDerived(f))
    // ⚠️ NOT the undercut diameter while the pill says otherwise. An empty box
    // next to a "No" asks for the diameter of something that is not there —
    // the same rule that keeps it off the tool page's field grid. It appears
    // here the moment the undercut is turned on.
    .filter(f => f !== 'undercut_diameter' || draft.has_undercut === true);

  return (
        <div className="tp-body">
          {/* ── drawing ─────────────────────────────────────────────────── */}
          <div className="tp-canvas" style={{ width: svgW, height: svgH }}>
            <svg width={svgW} height={svgH} className="tp-svg" role="img"
              aria-label={`Profile of ${draft.description || 'tool'}`}>
              <defs>
                <marker id="tp-arrow" viewBox="0 0 8 8" refX="7" refY="4"
                  markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 1 L 8 4 L 0 7 z" fill="var(--tp-dim-line)" />
                </marker>
              </defs>

              {/* centreline — the axis the tool spins about */}
              <line x1={cx} y1={TOP_PAD - 14} x2={cx} y2={yAt(0) + 14}
                className="tp-centreline" />

              {profile.regions.map((rg, i) => (
                <path
                  key={i}
                  d={rg.kind === 'flute' ? fluteTipPath() : regionPath(rg)}
                  className={`tp-region tp-${rg.kind}`}
                  data-active={rg.kind === 'segment' && hoverSeg === rg.index ? 'y' : undefined}
                  onMouseEnter={rg.kind === 'segment' ? () => setHoverSeg(rg.index) : undefined}
                  onMouseLeave={rg.kind === 'segment' ? () => setHoverSeg(null) : undefined}
                />
              ))}

              {/* The break symbol — two zigzags with the page showing between
                  them, the standard notation for an interrupted view. */}
              {broken && (() => {
                const w = Math.max(8, halfAt(shankReg.dTop) * 2) + 10;
                const yMid = (yAt(shankReg.y0) + yAt(shankReg.y1)) / 2;
                const zig = (y) => {
                  const steps = 8, x0 = cx - w / 2, dx = w / steps;
                  return Array.from({ length: steps + 1 },
                    (_, i) => `${x0 + i * dx},${y + (i % 2 ? 4 : -4)}`).join(' ');
                };
                return (
                  <g className="tp-break">
                    <rect x={cx - w / 2} y={yMid - 9} width={w} height={18} className="tp-break-gap" />
                    <polyline points={zig(yMid - 8)} className="tp-break-line" />
                    <polyline points={zig(yMid + 8)} className="tp-break-line" />
                  </g>
                );
              })()}

              {/* ⚠️ The shoulder band sits ON TOP of the solid, tinting the span
                  it measures rather than replacing it — the shoulder overlaps
                  whatever the stack already drew there, and the app has no
                  opinion on which is right when they disagree. Drawn under the
                  solid it was simply hidden, and only its overhang showed,
                  which read as a second block of a different colour. */}
              {profile.shoulderBand && (() => {
                const yTop = yAt(profile.shoulderBand.y1);
                const yBot = yAt(profile.shoulderBand.y0);
                const w = Math.max(2, profile.maxDia * sx);
                return (
                  <g>
                    <rect x={cx - w / 2} width={w} y={yTop} height={Math.max(1, yBot - yTop)}
                      className="tp-shoulder-band" />
                    <line x1={cx - w / 2} y1={yTop} x2={cx + w / 2} y2={yTop}
                      className="tp-shoulder-edge" />
                  </g>
                );
              })()}

              {/* ── the holder face: a datum across the drawing, not a
                     dimension. Wider than the tool so it reads as a plane the
                     tool passes through rather than as part of its outline. ── */}
              {yHolder != null && (
                <line x1={cx - BODY_W / 2 - HOLDER_OVERHANG_L} y1={yHolder}
                  x2={cx + BODY_W / 2 + HOLDER_OVERHANG_R} y2={yHolder}
                  className="tp-holder-line" />
              )}

              {/* ── length dimensions: ordinate from the tip ─────────────
                  One horizontal leader per length, at its own height, running
                  from the part out to its value. No arrows and no vertical run:
                  the origin is the tip and is assumed, which is what lets every
                  length share a single lane. */}
              {lengthDims.map(({ field, y, boxY }) => {
                const partX = cx - BODY_W / 2 - 2;
                const active = hoverSeg == null;
                // Straight while the box sits at its own height; a dogleg when
                // it had to move to clear a neighbour. The jog is kept close to
                // the PART so the run beside the boxes stays a clean column.
                // ⚠️ Straight while the true height still falls INSIDE the box.
                // OAL always clamps down by half a box, so a hair-trigger here
                // put a jog on the one dimension that never needed one.
                const d = Math.abs(boxY - y) <= DIMBOX_H / 2
                  ? `M ${lenBoxCx} ${y} L ${partX} ${y}`
                  : `M ${lenBoxCx} ${boxY} L ${partX - 2 * JOG} ${boxY}`
                    + ` L ${partX - JOG} ${y} L ${partX} ${y}`;
                return (
                  <g key={field} className="tp-dim" data-muted={active ? undefined : 'y'}>
                    <path d={d} className="tp-ord" fill="none" />
                  </g>
                );
              })}

              {/* ── diameter dimensions, across the part then out right ──── */}
              {diaTargets.map(({ field, y, halfPx, lane }) => {
                const xOut = cx + BODY_W / 2 + GAP + lane * LANE;
                return (
                  <g key={field} className="tp-dim">
                    <line x1={cx - halfPx} y1={y} x2={cx + halfPx} y2={y}
                      className="tp-dimline" markerStart="url(#tp-arrow)" markerEnd="url(#tp-arrow)" />
                    <line x1={cx + halfPx} y1={y} x2={xOut - 4} y2={y} className="tp-leader" />
                  </g>
                );
              })}
            </svg>

            {/* Editable value boxes, overlaid on the dimension lines. HTML, not
                foreignObject — real inputs that focus, tab and style normally. */}
            {lengthDims.map(({ field, boxY }) => (
              <DimBox key={field} x={lenBoxCx} y={boxY} align="center"
                label={dimLabelOf(field)} unit={unit} precision={fieldOf(field).precision ?? 4}
                step={stepFor(field, draft.unit)} kind={REGION_OF[field]} width={LEN_BOX_W}
                value={shown(field)} onChange={v => set(field, v)}
                readOnly={readOnly} derived={isDerived(field)}
                onFocus={() => setActiveDim(field)} onBlur={() => setActiveDim(null)}
                title={field === HOLDER_FACE
                  ? 'Where the holder starts — usually the face of the collet nut'
                  : undefined} />
            ))}
            {diaTargets.map(({ field, y, lane }) => (
              <DimBox key={field} x={cx + BODY_W / 2 + GAP + lane * LANE + 34} y={y} align="left"
                label={dimLabelOf(field)} unit={unit} precision={fieldOf(field).precision ?? 4}
                step={stepFor(field, draft.unit)} kind={REGION_OF[field]}
                value={shown(field)} onChange={v => set(field, v)} dia
                readOnly={readOnly} derived={isDerived(field)}
                onFocus={() => setActiveDim(field)} onBlur={() => setActiveDim(null)} />
            ))}

            <div className="tp-nts" title="X and Y are scaled independently so the tool is legible — a real tool is far longer than it is wide.">NTS</div>
          </div>

          {/* ── side panel ──────────────────────────────────────────────── */}
          <div className="tp-side">
            {dims.extras.length > 0 && (
              <section className="tp-panel">
                <h4 className="tp-panel-title">Cutter</h4>
                <div className="tp-extras">
                  {dims.extras.map(f => (
                    <label key={f} className="tp-extra">
                      <span>{labelOf(f)}</span>
                      {readOnly
                        ? <span className="tp-readout">{shown(f) ?? '—'}</span>
                        : (
                          <input type="number" className="field-input" value={shown(f) ?? ''}
                            step={stepFor(f, draft.unit)}
                            onChange={e => set(f, e.target.value)} placeholder="—" />
                        )}
                    </label>
                  ))}
                  <label className="tp-extra">
                    <span>
                      Undercut
                      {!readOnly && draft.undercut_override != null && (
                        <button type="button" className="btn btn-ghost btn-sm undercut-auto"
                          title="Clear the override and take the answer from the shaft segments again"
                          onClick={() => setDraft(d => applyUndercut(d, null))}>↺ Auto</button>
                      )}
                    </span>
                    <div className="btn-toggle tp-uc-toggle">
                      {/* ⚠️ THREE STATES. `null` is "Fusion drew no shaft, so the
                          app cannot say" — `!!null === false` lit No, asserting an
                          answer nobody had. Same rule as the tool page's pill. */}
                      {[[true, 'Yes'], [false, 'No']].map(([v, l]) => (
                        <button key={l} type="button" disabled={readOnly}
                          className={draft.has_undercut === v ? 'active' : ''}
                          onClick={() => setDraft(d => applyUndercut(d, v))}>{l}</button>
                      ))}
                    </div>
                  </label>
                </div>
              </section>
            )}

            {unsetDims.length > 0 && (
              <section className="tp-panel">
                <h4 className="tp-panel-title">Not set</h4>
                <div className="tp-extras">
                  {unsetDims.map(f => (
                    <label key={f} className="tp-extra">
                      <span>{labelOf(f)}</span>
                      <input type="number" className="field-input" value={shown(f) ?? ''}
                        step={stepFor(f, draft.unit)}
                        onFocus={() => setActiveDim(f)} onBlur={() => setActiveDim(null)}
                        onChange={e => set(f, e.target.value)} placeholder="—" />
                    </label>
                  ))}
                </div>
                <p className="tp-unset-note">these move onto the drawing once they have a value</p>
              </section>
            )}

            <section className="tp-panel">
              <h4 className="tp-panel-title">
                Shaft segments
                {!readOnly && (
                  <button type="button" className="btn btn-ghost btn-sm tp-seg-add"
                    onClick={() => setSegs([...segs, newSegment(segs, profile, draft.unit)], true)}>+ Add</button>
                )}
              </h4>
              {segs.length === 0 ? (
                <p className="tp-empty">
                  No shaft segments — the shank runs straight from the flutes.
                  {!readOnly && ' Add one when the tool arrives and gets measured.'}
                </p>
              ) : (
                <table className="tp-seg-table">
                  <thead>
                    <tr><th>#</th><th>Height</th><th>Ø lower</th><th>Ø upper</th><th /></tr>
                  </thead>
                  <tbody>
                    {/* ⚠️ Listed TOP-DOWN, the way Fusion's own Shaft tab numbers
                        them — the stored array is the reverse (tip-first). Every
                        edit maps back through `storedIndex`; getting that wrong
                        silently puts the segment on the other end of the tool. */}
                    {segs.map((_, i) => segs.length - 1 - i).map((idx, row) => {
                      const sg = segs[idx];
                      return (
                        <tr key={idx} data-active={hoverSeg === idx ? 'y' : undefined}
                          onMouseEnter={() => setHoverSeg(idx)} onMouseLeave={() => setHoverSeg(null)}>
                          <td className="tp-seg-idx">{row + 1}</td>
                          {['height', 'lower', 'upper'].map(k => {
                            const id = `${idx}-${k}`;
                            return (
                              <td key={k}>
                                {/* ⚠️ A BLANK CELL IS MID-EDIT, NOT A ZERO. The
                                    field shows what is being typed; the stored
                                    number only moves when the text is a real
                                    one, so "." on the way to ".2" no longer
                                    writes 0 (which used to delete the row).
                                    Leaving a cell blank snaps it back to its
                                    last good value — removing a segment is what
                                    the × is for. */}
                                {readOnly ? (
                                  <span className="tp-seg-readout">{sg[k] ?? '—'}</span>
                                ) : (
                                <input type="number" step={segStep} className="tp-seg-input"
                                  value={cell?.id === id ? cell.text : (sg[k] ?? '')}
                                  onFocus={() => setCell({ id, text: String(sg[k] ?? '') })}
                                  onBlur={() => setCell(null)}
                                  onChange={e => {
                                    const text = e.target.value;
                                    setCell({ id, text });
                                    const n = Number(text);
                                    if (text !== '' && Number.isFinite(n)) {
                                      setSegs(segs.map((x, j) => (j === idx ? { ...x, [k]: n } : x)));
                                    }
                                  }} />
                                )}
                              </td>
                            );
                          })}
                          <td>
                            {!readOnly && (
                            <button type="button" className="tp-seg-del" title="Remove this segment"
                              onClick={() => { setCell(null); setHoverSeg(null); setSegs(segs.filter((_, j) => j !== idx)); }}>×</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              <p className="tp-seg-note">{unit} · measured from the flutes upward</p>
            </section>

          </div>
        </div>
  );
}

// One dimension's value box, sitting on its dimension line.
// ⚠️ `derived` AND `readOnly` ARE DIFFERENT THINGS, and collapsing them says
// something untrue. `derived` means the app computes this from the shaft
// segments — a permanent fact about the field, worth the dashed border and the
// tooltip that explains it. `readOnly` only means the page is not in edit mode
// right now. Styling every box as derived while merely viewing would claim the
// whole drawing is computed, and hand every box a tooltip saying so.
function DimBox({ x, y, align, label, unit, value, precision, step, onChange,
  dia = false, readOnly = false, derived = false, title, kind, width,
  onFocus, onBlur }) {
  const [focused, setFocused] = useState(false);
  const display = focused
    ? (value ?? '')
    : (value === null || value === undefined || value === ''
      ? '' : Number(Number(value).toFixed(precision ?? 4)));
  return (
    <div className={`tp-dimbox${derived ? ' tp-dimbox-derived' : ''}${readOnly ? ' tp-dimbox-locked' : ''}${kind ? ` tp-dimbox-${kind}` : ''}${width ? ' tp-dimbox-fixed' : ''}`}
      title={title || (derived ? 'From the shaft segments' : undefined)}
      style={{
      left: x, top: y, width: width || undefined,
      transform: align === 'center' ? 'translate(-50%, -50%)'
        : align === 'right' ? 'translate(-100%, -50%)'    // right edge meets x
        : 'translate(-34px, -50%)',
    }}>
      <span className="tp-dimbox-label">{label}</span>
      <span className="tp-dimbox-input">
        {dia && <span className="dia">⌀</span>}
        <input type="number" step={step} value={display} readOnly={readOnly || derived}
          onFocus={() => { setFocused(true); onFocus?.(); }}
          onBlur={() => { setFocused(false); onBlur?.(); }}
          onChange={e => onChange(e.target.value)} placeholder="—" />
        <span className="tp-dimbox-unit">{unit}</span>
      </span>
    </div>
  );
}
