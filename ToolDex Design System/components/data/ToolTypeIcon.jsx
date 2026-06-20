import React from 'react';

// ToolDex — ToolTypeIcon
// Clean line-art silhouettes for each CNC tool type — the signature ToolDex
// iconography. 24×24 viewBox, stroke `currentColor` (tints to context), thin
// 0.4 strokes. The identity of each tool lives in its END/TIP geometry and
// flute style:
//   • End mills — helical flutes spiralling up the diameter; the BOTTOM corner
//     distinguishes them (flat = square 90°, bull = small radius, ball = full
//     hemisphere, radius = large corner).
//   • Drills/spot — pointed tip with cutting lips, steep 2-flute helix.
//   • Reamer — STRAIGHT flutes (vertical), chamfered start.
//   • Tap — square drive + angled thread profile.
//   • Turning — lathe holder + diamond insert.
// No fills/shading — pure outline so it stays crisp and tintable at any size.

// element helper (keyed for React arrays). op = stroke opacity for detail lines.
const P = (d, k, op) => <path key={k} d={d} fill="none" strokeOpacity={op == null ? 1 : op} />;
const CIRC = (cx, cy, r, k) => <circle key={k} cx={cx} cy={cy} r={r} fill="none" />;
const ELL = (cx, cy, rx, ry, k) => <ellipse key={k} cx={cx} cy={cy} rx={rx} ry={ry} fill="none" />;

// Shared helical flutes for a full-width (x9→15) milling body, flat-ish bottom.
const MILL_FLUTES = [
  'M9 18.6 C10.6 18.7 12.2 17.4 13 16.2 C13.6 15.3 14.5 14.9 15 14.9',
  'M9 15.6 C10.6 15.7 12.2 14.4 13 13.2 C13.6 12.3 14.5 11.9 15 11.9',
  'M9 12.6 C10.6 12.7 12.2 11.4 13 10.2',
];
const MILL_GASH = [
  'M9.6 18.9 C11 18.8 12.6 17.7 13.5 16.4',
  'M9.6 15.9 C11 15.8 12.6 14.7 13.5 13.4',
];
const millFlutes = (pfx) => [
  ...MILL_FLUTES.map((d, i) => P(d, `${pfx}f${i}`)),
  ...MILL_GASH.map((d, i) => P(d, `${pfx}g${i}`, 0.45)),
];

function paths(type) {
  switch (type) {

    // ── End mills (distinguished by bottom corner) ───────────────────────────
    case 'flat end mill':
      return [P('M9 3 H15 V20.3 H9 Z', 'b'), ...millFlutes('flat')];

    case 'bull nose end mill':
      return [P('M9 3 V18.6 Q9 20.3 10.7 20.3 H13.3 Q15 20.3 15 18.6 V3 Z', 'b'), ...millFlutes('bull')];

    case 'radius mill':
      return [P('M9 3 V17.6 Q9 20.3 11.7 20.3 H12.3 Q15 20.3 15 17.6 V3 Z', 'b'), ...millFlutes('rad')];

    case 'ball end mill':
      return [
        P('M9 3 V15.5 A3 3 0 0 0 15 15.5 V3 Z', 'b'),
        P('M9 14 C10.6 13.9 12.2 12.6 13 11.4 C13.6 10.5 14.5 10.1 15 10.1', 'f0'),
        P('M9 11 C10.6 10.9 12.2 9.6 13 8.4', 'f1'),
        P('M9.6 14.3 C11 14.2 12.6 13.1 13.5 11.8', 'g0', 0.45),
        P('M9.5 16.6 Q12 13.9 14.5 16.6', 'tip', 0.5),
      ];

    case 'tapered mill':
      return [
        P('M9 3 H15 V11 L13.4 20.3 H10.6 L9 11 Z', 'b'),
        P('M9 11 H15', 'd', 0.5),
        P('M9.5 18.6 C10.6 18.4 11.6 17.5 12.2 16.6', 'f0'),
        P('M9.6 15.3 C10.8 15.1 12 14.1 12.7 13.1', 'f1'),
        P('M9.7 12 C11 11.8 12.4 10.8 13.2 9.9', 'f2'),
      ];

    case 'chamfer mill':   // engrave/chamfer — conical point
      return [
        P('M9 3 H15 V12.5 L12 20.2 L9 12.5 Z', 'b'),
        P('M9 12.5 H15', 'd'),
        P('M9 11 C10.6 11.1 12.2 9.8 13 8.6', 'f0'),
        P('M9 8 C10.6 8.1 12.2 6.8 13 5.6', 'f1'),
        P('M10 14.4 L12 19.2 M14 14.4 L12 19.2', 'edge', 0.55),
      ];

    case 'lollipop mill':  // undercutting — thin neck + spherical cutter
      return [
        P('M9.6 3 H14.4 V8 H9.6 Z', 's'),
        P('M11.3 8 V11.4 M12.7 8 V11.4', 'neck'),
        CIRC(12, 15, 3.5, 'ball'),
        P('M9.7 13.9 C11 16.6 13 16.6 14.3 13.9', 'f0', 0.6),
        P('M10.2 12.4 C11.2 14.6 12.8 14.6 13.8 12.4', 'f1', 0.45),
      ];

    case 'dovetail':
      return [
        P('M9.6 3 H14.4 V10 H9.6 Z', 's'),
        P('M11.2 10 V12 M12.8 10 V12', 'neck'),
        P('M10 12 L7.7 19.6 H16.3 L14 12 Z', 'h'),
        P('M8.7 16 H15.3', 't', 0.55),
      ];

    case 'slot/key cutter':   // woodruff / keyseat — thin neck + wide disc
      return [
        P('M10.6 3 H13.4 V12.6 H10.6 Z', 's'),
        P('M6 12.6 H18 V16.4 H6 Z', 'disc'),
        P('M7.7 16.4 V17.7 M9.7 16.4 V17.7 M11.7 16.4 V17.7 M13.7 16.4 V17.7 M15.7 16.4 V17.7', 't', 0.6),
      ];

    case 'form mill':   // profiled / radius-form bottom
      return [
        P('M9 3 H15 V12.5 H9 Z', 'b'),
        P('M9 12.5 C9.8 12.5 10 16.4 12 13.4 C14 16.4 14.2 12.5 15 12.5', 'form'),
        P('M9 11 C10.6 11.1 12.2 9.8 13 8.6', 'f0', 0.6),
      ];

    case 'thread mill':
      return [
        P('M9 3 H15 V20.2 H9 Z', 'b'),
        P('M9 9.6 H15 M9 12.2 H15 M9 14.8 H15 M9 17.4 H15 M9 20 H15', 'th', 0.7),
        P('M12 8 V20.2', 'c', 0.4),
      ];

    // ── Circle-segment family ───────────────────────────────────────────────
    case 'circle segment barrel':
      return [
        P('M9 3 V8 Q6.4 14 9.2 20.3 H14.8 Q17.6 14 15 8 V3 Z', 'b'),
        P('M7.3 12 C10 11 14 11 16.7 12', 'f0', 0.6),
        P('M8 16 C10.2 15.2 13.8 15.2 16 16', 'f1', 0.45),
      ];

    case 'circle segment lens':
      return [
        P('M10.6 3 H13.4 V8.5 H10.6 Z', 's'),
        P('M12 8.5 Q6.5 14 12 20.3 Q17.5 14 12 8.5 Z', 'l'),
        P('M12 9 V20', 'c', 0.5),
      ];

    case 'circle segment oval':
      return [
        P('M10.6 3 H13.4 V8.5 H10.6 Z', 's'),
        ELL(12, 14.8, 3.4, 5.4, 'o'),
        P('M9.4 13 C10.8 12.3 13.2 12.3 14.6 13', 'f0', 0.5),
        P('M9.4 16.6 C10.8 17.3 13.2 17.3 14.6 16.6', 'f1', 0.45),
      ];

    case 'circle segment taper':
      return [
        P('M10.6 3 H13.4 V8.5 H10.6 Z', 's'),
        P('M9.4 8.5 Q8.6 15 11 20.3 H13 Q15.4 15 14.6 8.5 Z', 'b'),
        P('M9.7 12.5 C11 12 13 12 14.3 12.5', 'f0', 0.5),
        P('M10 16.5 C11.1 16.1 12.9 16.1 14 16.5', 'f1', 0.45),
      ];

    // ── Hole making ─────────────────────────────────────────────────────────
    case 'drill':   // pointed tip, 2-flute steep helix
      return [
        P('M9 3 H15 V14.8 L12 20.4 L9 14.8 Z', 'b'),
        P('M9.2 13.8 C11 12.8 13 11.6 14.8 10.6', 'f0'),
        P('M9.2 10.2 C11 9.2 13 8 14.8 7', 'f1'),
        P('M9.6 13.9 C11 13 12.6 12 13.6 10.8', 'g0', 0.45),
        P('M10.1 16 L12 18.6 L13.9 16', 'lip', 0.6),
      ];

    case 'center drill':   // thick body steps to a thin pilot point
      return [
        P('M8.3 3 H15.7 V11 H8.3 Z', 'b'),
        P('M8.3 8 H15.7', 'd', 0.45),
        P('M10.4 11 V14.6 L12 18 L13.6 14.6 V11', 'p'),
        P('M10.8 15.3 L12 16.9 L13.2 15.3', 'lip', 0.6),
      ];

    case 'spot drill':   // short, wide-angle point
      return [
        P('M9 3 H15 V12.5 L12 19.5 L9 12.5 Z', 'b'),
        P('M9 12.5 H15', 'd', 0.5),
        P('M9 11 C10.6 11.1 12.2 9.8 13 8.6', 'f0'),
        P('M10.2 14.6 L12 18.3 L13.8 14.6', 'lip', 0.6),
      ];

    case 'reamer':   // STRAIGHT flutes, chamfered start
      return [
        P('M9 3 H15 V18.4 L13.8 20.3 H10.2 L9 18.4 Z', 'b'),
        P('M9 8 H15', 'd', 0.45),
        P('M10.2 8 V19.6 M11.4 8 V20 M12.6 8 V20 M13.8 8 V19.6', 'fl', 0.85),
      ];

    case 'counter bore':   // flat body + central pilot pin
      return [
        P('M9 3 H15 V16 H9 Z', 'b'),
        ...millFlutes('cb').slice(0, 2),
        P('M11 16 V20.3 H13 V16', 'pilot'),
      ];

    case 'counter sink':   // conical countersink
      return [
        P('M10.5 3 H13.5 V9 H10.5 Z', 's'),
        P('M7.4 9 H16.6 L12 19.6 Z', 'cone'),
        P('M9.7 9 L12 19.6 M14.3 9 L12 19.6 M12 9 V19.6', 'f', 0.55),
      ];

    // ── Tap ───────────────────────────────────────────────────────────────
    case 'tap':
      return [
        P('M10.3 2.5 H13.7 V5 H10.3 Z', 'sq'),
        P('M9.5 5.5 H14.5 V16.5 L12.7 20.3 H11.3 L9.5 16.5 Z', 'b'),
        P('M9.5 7.8 L14.5 9 M9.5 10.1 L14.5 11.3 M9.5 12.4 L14.5 13.6 M9.5 14.7 L14.5 15.9', 'th', 0.8),
      ];

    // ── Boring ──────────────────────────────────────────────────────────────
    case 'boring head':   // bar + offset cutting bit
      return [
        P('M10.6 3 V14', 'bar'),
        P('M7.5 9 H16.5 V13 H7.5 Z', 'head'),
        P('M9.5 13 V18 L7.6 18', 'arm'),
        P('M6.3 16.8 L8.4 17.9 L6.7 19.6 Z', 'bit'),
      ];

    // ── Turning (lathe holder + diamond insert) ──────────────────────────────
    case 'turning general':
      return [
        P('M6.5 12 H20 V18 H6.5 Z', 'shank'),
        P('M6.5 9.6 H11.5 V12', 'head'),
        P('M4.6 10.6 L8.5 8.3 L11 11.1 L7.1 13.4 Z', 'insert'),
      ];

    default:
      return [P('M9 3 H15 V20.3 H9 Z', 'b'), ...millFlutes('def')];
  }
}

export function ToolTypeIcon({ type, size = 24, strokeWidth = 0.4, className = '', style }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round"
      className={className} style={style} aria-hidden="true"
    >
      {paths(type)}
    </svg>
  );
}
