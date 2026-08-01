// ─── 2D profile preview — the silhouette from a segment list ────────────────
//
// A holder is a solid of revolution, so height + upper/lower diameter per
// segment is everything needed; no extra data.
//
// ORIENTATION: spindle end at TOP, tool tip at BOTTOM — how the holder actually
// hangs in the machine, and matching the segment table's top-down row order.
// The underlying array is bottom-up (array[0] = tip), so this iterates it in
// reverse — the same flip the gauge-length math already does.
//
// Within a segment, `upper-diameter` is the spindle-ward end and
// `lower-diameter` the tip-ward end, so each draws as a trapezoid from ud (top)
// to ld (bottom). Verified against real data: the BT30 retention groove
// (46 → 38 → 46 across three segments) renders as a proper V-groove this way.
//
// TRUE PROPORTIONS: one uniform scale for both axes, never stretched to fill.
// A distorted profile would hide exactly the errors this view exists to catch.
//
// DELIBERATELY GENERIC: it takes a segment list, not a holder, so the same
// component can draw cutting tools and full assemblies later (an assembly is
// holder segments + tool segments concatenated). All type-specific styling
// routes through the single `kindOf` hook — new segment types slot in without
// touching the geometry code.

import { segHeight, segUpper, segLower, formatHolderLen } from '../utils/holderGeometry.js';
import { unitAbbr } from '../utils/units.js';

// The one place segment appearance is decided. Extend HERE for tool/assembly
// segment types (flute, shank, neck) — nothing below branches on type.
const defaultKindOf = (s) => (s?.above_gauge ? 'agl' : s?.ext ? (s?.shank_seg ? 'shank' : 'ext') : 'body');

const KIND_STYLE = {
  body: { fill: 'var(--profile-steel)', stroke: 'var(--profile-steel-edge)' },
  // Above the gauge line: dimmed + dashed, because it isn't counted.
  agl: { fill: 'var(--profile-dim)', stroke: 'var(--profile-dim-edge)', dash: '3 2' },
  // Extension is SEMANTIC, not decorative — the same green everywhere an
  // extension is referred to (profile, segment row, Extension section,
  // derived readouts, filter pill, healer chip).
  ext: { fill: 'var(--green)', stroke: 'var(--profile-ext-edge)' },
  // The mating shank: extension green with a violet edge to mark which one.
  shank: { fill: 'var(--green)', stroke: 'var(--profile-shank-edge)' },
};

const KIND_LABEL = { agl: 'Above gauge', ext: 'Extension', shank: 'Ext shank seg' };

export default function ProfileView({
  segments = [],
  unit,
  selectedIndex = null,
  onSelect,
  hoverIndex = null,
  onHover,
  // The box is sized to the DRAWING, not the other way round. A fixed-width box
  // wastes most of its width on a typical holder (a 180mm × Ø46 holder drawn at
  // a height-limited scale only fills about half of it), and that dead space is
  // width the drawing could have used to be bigger. So: pick the scale from
  // whichever budget binds, then make the SVG exactly as wide as the widest
  // segment needs. maxWidth stops a short, fat holder (a face-mill arbor) from
  // running away with the row.
  maxHeight = 560,
  maxWidth = 320,
  minWidth = 110,
  kindOf = defaultKindOf,
}) {
  const totalH = segments.reduce((a, s) => a + segHeight(s), 0);
  const maxD = segments.reduce((a, s) => Math.max(a, segUpper(s), segLower(s)), 0);

  if (!totalH || !maxD) {
    return (
      <div className="profile-empty" style={{ width: minWidth }}>Add segments to see the profile</div>
    );
  }

  const padY = 14;
  const padX = 12;
  // Still ONE uniform scale for both axes — true proportions, never stretched.
  const scale = Math.min((maxHeight - padY * 2) / totalH, (maxWidth - padX * 2) / maxD);
  const svgH = totalH * scale + padY * 2;
  const width = Math.max(minWidth, Math.min(maxWidth, maxD * scale + padX * 2));
  const cx = width / 2;

  // The gauge line sits below the above-gauge segments (which are at the
  // spindle end); everything below it counts toward the gauge length.
  let aglH = 0;
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i]?.above_gauge) aglH += segHeight(segments[i]);
    else break;
  }

  // Build the top-down draw order while remembering each shape's REAL array
  // index, so a click maps back to the right table row.
  const shapes = [];
  let y = padY;
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    const h = segHeight(s) * scale;
    const rU = (segUpper(s) / 2) * scale;
    const rL = (segLower(s) / 2) * scale;
    shapes.push({
      realIndex: i,
      kind: kindOf(s),
      points: `${cx - rU},${y} ${cx + rU},${y} ${cx + rL},${y + h} ${cx - rL},${y + h}`,
    });
    y += h;
  }

  const legend = ['agl', 'ext', 'shank'].filter(k => shapes.some(s => s.kind === k));

  return (
    <div className="profile-view" style={{ width }}>
      <svg width={width} height={svgH} className="profile-svg">
        <line x1={cx} y1={padY} x2={cx} y2={svgH - padY} className="profile-centerline" />
        {shapes.map(sh => {
          const st = KIND_STYLE[sh.kind] || KIND_STYLE.body;
          const sel = selectedIndex === sh.realIndex;
          const hov = hoverIndex === sh.realIndex;
          return (
            <polygon
              key={sh.realIndex}
              points={sh.points}
              onClick={() => onSelect?.(sel ? null : sh.realIndex)}
              onMouseEnter={() => onHover?.(sh.realIndex)}
              onMouseLeave={() => onHover?.(null)}
              className="profile-seg"
              fill={sel ? 'var(--blue)' : st.fill}
              stroke={sel || hov ? 'var(--text)' : st.stroke}
              strokeWidth={sel ? 2 : hov ? 1.5 : 1}
              strokeDasharray={st.dash || 'none'}
            />
          );
        })}
        {aglH > 0 && (
          <g>
            <line
              x1={2} y1={padY + aglH * scale} x2={width - 2} y2={padY + aglH * scale}
              className="profile-gaugeline"
            />
            <text x={4} y={padY + aglH * scale - 3} className="profile-gaugelabel">GAUGE</text>
          </g>
        )}
      </svg>

      <div className="profile-legend">
        {legend.map(k => (
          <div key={k} className="profile-legend-row">
            <span
              className="profile-legend-swatch"
              style={{
                background: KIND_STYLE[k].fill,
                border: `1px ${KIND_STYLE[k].dash ? 'dashed' : 'solid'} ${KIND_STYLE[k].stroke}`,
              }}
            />
            {KIND_LABEL[k]}
          </div>
        ))}
        <div className="profile-total">{formatHolderLen(totalH, unit)} {unitAbbr(unit)} overall</div>
      </div>
    </div>
  );
}
