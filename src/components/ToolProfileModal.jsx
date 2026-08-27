// ─── Tool Profile — the whole tool, drawn, with its values on the drawing ───
//
// Fusion splits a tool across four tabs (General / Cutter / Shaft / Holder), so
// no screen ever shows the tool. This does: one vertical silhouette, tip down
// as it hangs in the spindle, with the geometry as engineering-print dimensions
// whose value boxes ARE the editable fields.
//
// ⚠️ DELIBERATELY A SEPARATE POP-UP. It does not replace the Geometry section —
// that keeps working exactly as it did, and this is additive until the two are
// merged on purpose.
//
// ⚠️ SHAFT SEGMENTS ARE READ-ONLY HERE. They are Fusion's drawing of the tool
// and the app has no business rewriting them from a screen that cannot yet
// express what they mean (see "Reach & undercut" in CLAUDE.md — the app must
// not change what is in Fusion). They ARE rendered and dimensioned, because
// seeing them is the whole point; editing them is the next step, and now a
// small one — `shaft.segments` has NO paired `expressions.*` entry (verified
// across the real library), so there is no native+expression pair to keep in
// step when it comes.
//
// NOT TO SCALE, on purpose: X and Y are scaled independently. A real tool runs
// 20:1 to 60:1 long-to-wide, so a true-proportion drawing is a hairline that
// shows nothing. Every CAM tool-library screen distorts this the same way; the
// drawing is labelled NTS rather than pretending otherwise.
import { useState, useMemo, useRef } from 'react';
import { X, Ruler, Info } from 'lucide-react';
import { buildToolProfile, profileDimensions, shaftSegments } from '../utils/toolProfile.js';
import { FIELD_REGISTRY, fieldLabel, INCLUSIVE_ANGLE_TYPES } from '../schema/fieldRegistry.js';
import { unitAbbr } from '../utils/units.js';
import { undercutDiameterHint, resolveReachFields, deriveReach } from '../utils/toolReach.js';
import ToolTypeIcon from './icons/ToolTypeIcon.jsx';

// ── drawing constants (px) ──────────────────────────────────────────────────
const BODY_W = 132;   // widest the part itself may draw
const BODY_H = 430;   // tallest the part itself may draw
const LANE = 94;      // one dimension lane
const GAP = 14;       // part edge → first extension line
const TOP_PAD = 26;
const BOT_PAD = 26;
const LABEL_H = 26;
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
function newSegment(segs, profile) {
  const top = segs.length ? segs[segs.length - 1] : null;
  const dia = top ? top.upper : (profile.diameter || 0.25);
  return { height: Math.max(0.05, (profile.total || 1) * 0.1), lower: dia, upper: dia };
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

export default function ToolProfileModal({ tool, onSave, onClose }) {
  // ⚠️ Seed through the resolver, not from the tool as handed in. Reach and
  // undercut are derived from the segments; a tool that has not been through
  // the load-time pass would otherwise open with them blank — and, once the
  // segments are editable here, the modal has to agree with what it is drawing.
  const [draft, setDraft] = useState(() => ({ ...tool, ...resolveReachFields(tool) }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [hoverSeg, setHoverSeg] = useState(null);
  const baseRef = useRef(tool);

  const unit = unitAbbr(draft.unit);
  const profile = useMemo(() => buildToolProfile(draft), [draft]);
  const dims = useMemo(() => profileDimensions(draft.tool_type), [draft.tool_type]);
  const segs = useMemo(() => shaftSegments(draft), [draft]);

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

  const dirty = useMemo(
    () => [...dims.lengths, ...dims.diameters, ...dims.extras]
      .some(f => (draft[f] ?? null) !== (baseRef.current[f] ?? null)) ||
      (draft.has_undercut ?? null) !== (baseRef.current.has_undercut ?? null) ||
      (draft.undercut_override ?? null) !== (baseRef.current.undercut_override ?? null) ||
      JSON.stringify(draft.shaft_segments ?? null) !== JSON.stringify(baseRef.current.shaft_segments ?? null),
    [draft, dims],
  );

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
  const lengthDims = dims.lengths
    .map(field => ({ field, value: Number(draft[field]) || 0 }))
    .filter(d => d.value > 0)
    .sort((a, b) => a.value - b.value)
    .map((d, i) => ({ ...d, lane: i }));

  const nLeft = Math.max(1, lengthDims.length);
  const svgH = BODY_H + TOP_PAD + BOT_PAD;
  const cx = nLeft * LANE + BODY_W / 2;
  const sx = maxDia > 0 ? BODY_W / maxDia : 0;
  const halfAt = (d) => (d * sx) / 2;

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
    if (!(Number(value) > 0)) return;
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
  const svgW = nLeft * LANE + BODY_W + nRight * LANE + RIGHT_PAD;

  const handleSave = async () => {
    setError('');
    setSaving(true);
    try {
      await onSave(draft);
      onClose();
    } catch (err) {
      // ⚠️ Stay open and keep the draft — a failed save must never look like a
      // successful one, and must never silently discard the user's edit.
      setError(err?.message || 'Could not save — your changes are still here.');
    } finally {
      setSaving(false);
    }
  };

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

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div className="modal tool-profile-modal">
        <div className="tp-head">
          <ToolTypeIcon type={draft.tool_type} size={22} />
          <div className="tp-head-text">
            <div className="tp-title">Tool Profile</div>
            <div className="tp-sub">{draft.description || '—'}</div>
          </div>
          <button className="tp-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

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

              {/* ── length dimensions, nesting leftward from the tip ─────── */}
              {lengthDims.map(({ field, value, lane }) => {
                const x = cx - BODY_W / 2 - GAP - lane * LANE;
                const yTip = yAt(0), yEnd = yAt(Math.min(value, total));
                const yMid = (yTip + yEnd) / 2;
                const active = hoverSeg == null;
                return (
                  <g key={field} className="tp-dim" data-muted={active ? undefined : 'y'}>
                    <line x1={x - 6} y1={yTip} x2={cx - BODY_W / 2 - 2} y2={yTip} className="tp-ext" />
                    <line x1={x - 6} y1={yEnd} x2={cx - BODY_W / 2 - 2} y2={yEnd} className="tp-ext" />
                    {/* broken dimension line — the label sits in the gap */}
                    <line x1={x} y1={yEnd} x2={x} y2={yMid - LABEL_H / 2 - 2}
                      className="tp-dimline" markerStart="url(#tp-arrow)" />
                    <line x1={x} y1={yMid + LABEL_H / 2 + 2} x2={x} y2={yTip}
                      className="tp-dimline" markerEnd="url(#tp-arrow)" />
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
            {lengthDims.map(({ field, lane }) => {
              const x = cx - BODY_W / 2 - GAP - lane * LANE;
              const value = Number(draft[field]) || 0;
              const yMid = (yAt(0) + yAt(Math.min(value, total))) / 2;
              return (
                <DimBox key={field} x={x} y={yMid} align="center"
                  label={dimLabelOf(field)} unit={unit} precision={fieldOf(field).precision ?? 4}
                  value={shown(field)} onChange={v => set(field, v)} readOnly={isDerived(field)} />
              );
            })}
            {diaTargets.map(({ field, y, lane }) => (
              <DimBox key={field} x={cx + BODY_W / 2 + GAP + lane * LANE + 34} y={y} align="left"
                label={dimLabelOf(field)} unit={unit} precision={fieldOf(field).precision ?? 4}
                value={shown(field)} onChange={v => set(field, v)} dia readOnly={isDerived(field)} />
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
                      <input type="number" className="field-input" value={shown(f) ?? ''}
                        step={fieldOf(f).precision === 0 ? '1' : '0.001'}
                        onChange={e => set(f, e.target.value)} placeholder="—" />
                    </label>
                  ))}
                  <label className="tp-extra">
                    <span>
                      Undercut
                      {draft.undercut_override != null && (
                        <button type="button" className="btn btn-ghost btn-sm undercut-auto"
                          title="Clear the override and take the answer from the shaft segments again"
                          onClick={() => setDraft(d => applyUndercut(d, null))}>↺ Auto</button>
                      )}
                    </span>
                    <div className="btn-toggle tp-uc-toggle">
                      {[[true, 'Yes'], [false, 'No']].map(([v, l]) => (
                        <button key={l} type="button" className={!!draft.has_undercut === v ? 'active' : ''}
                          onClick={() => setDraft(d => applyUndercut(d, v))}>{l}</button>
                      ))}
                    </div>
                  </label>
                </div>
              </section>
            )}

            <section className="tp-panel">
              <h4 className="tp-panel-title">
                Shaft segments
                <button type="button" className="btn btn-ghost btn-sm tp-seg-add"
                  onClick={() => setSegs([...segs, newSegment(segs, profile)], true)}>+ Add</button>
              </h4>
              {segs.length === 0 ? (
                <p className="tp-empty">
                  No shaft segments — the shank runs straight from the flutes.
                  Add one when the tool arrives and gets measured.
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
                          {['height', 'lower', 'upper'].map(k => (
                            <td key={k}>
                              <input type="number" step="0.001" className="tp-seg-input"
                                value={sg[k] ?? ''}
                                onChange={e => setSegs(segs.map((x, j) => j === idx
                                  ? { ...x, [k]: e.target.value === '' ? 0 : Number(e.target.value) } : x))} />
                            </td>
                          ))}
                          <td>
                            <button type="button" className="tp-seg-del" title="Remove this segment"
                              onClick={() => setSegs(segs.filter((_, j) => j !== idx))}>×</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              <p className="tp-seg-note">{unit} · measured from the flutes upward</p>
            </section>

            <div className="tp-legend">
              {[['flute', 'Flutes'], ['shoulder', 'Shoulder'], ['segment', 'Shaft segment'], ['shank', 'Shank']]
                .map(([k, l]) => (
                  <span key={k} className="tp-legend-item"><i className={`tp-sw tp-sw-${k}`} />{l}</span>
                ))}
            </div>
          </div>
        </div>

        {error && <div className="tp-error">{error}</div>}
        <div className="modal-actions tp-actions">
          <span className="tp-hint"><Ruler size={12} /> Values are editable — the drawing follows as you type.</span>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// One dimension's value box, sitting on its dimension line.
function DimBox({ x, y, align, label, unit, value, precision, onChange, dia = false, readOnly = false }) {
  const [focused, setFocused] = useState(false);
  const display = focused
    ? (value ?? '')
    : (value === null || value === undefined || value === ''
      ? '' : Number(Number(value).toFixed(precision ?? 4)));
  return (
    <div className={`tp-dimbox${readOnly ? ' tp-dimbox-derived' : ''}`}
      title={readOnly ? 'From the shaft segments' : undefined}
      style={{
      left: x, top: y,
      transform: align === 'center' ? 'translate(-50%, -50%)' : 'translate(-34px, -50%)',
    }}>
      <span className="tp-dimbox-label">{label}</span>
      <span className="tp-dimbox-input">
        {dia && <span className="dia">⌀</span>}
        <input type="number" step="0.001" value={display} readOnly={readOnly}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          onChange={e => onChange(e.target.value)} placeholder="—" />
        <span className="tp-dimbox-unit">{unit}</span>
      </span>
    </div>
  );
}
