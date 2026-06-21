import React from 'react';

// ToolDex — ToolTypeIcon
// SOLID-SILHOUETTE icons for each CNC tool type — the signature ToolDex
// iconography (Teenage-Engineering vibe). 24×24 viewBox, filled `currentColor`
// so it tints to context. Each icon is ONE path with fillRule="evenodd": the
// outer silhouette is filled and the flute/thread gaps are subpaths cut back
// out to the background, so it stays crisp at any size. Identity lives in the
// END/TIP geometry (flat 90°, ball hemisphere, drill point, cone, disc, …);
// the shank is short and the flutes are simple angled cuts at the cutting end.
//
// Exported as BOTH a default and a named export so it can be imported either
// way (the app imports it as a default everywhere).

const SOLID = (d) => <path key="s" d={d} fill="currentColor" stroke="none" fillRule="evenodd" />;
// Angled flute cut whose cutting edge sits at the bottom y `yb`, inset to xl..xr.
const slash  = (yb, xl = 9, xr = 15) => ` M${xl} ${yb} L${xl} ${yb - 1} L${xr} ${yb - 4.4} L${xr} ${yb - 3.4} Z`;
// Tighter flute cut for short/pointed bodies (drills, chamfer, spot).
const slashT = (yb, xl = 9, xr = 15) => ` M${xl} ${yb} L${xl} ${yb - 0.9} L${xr} ${yb - 3.5} L${xr} ${yb - 2.6} Z`;

function paths(type) {
  switch (type) {

    // ── End mills (square / small-radius / hemisphere / large-radius bottom) ──
    case 'flat end mill':
      return [SOLID('M8.5 5 H15.5 V21 H8.5 Z' + slash(19.8) + slash(16.4))];

    case 'bull nose end mill':
      return [SOLID('M8.5 5 H15.5 V18.8 Q15.5 21 13.3 21 H10.7 Q8.5 21 8.5 18.8 Z' + slash(19.4) + slash(16))];

    case 'ball end mill':
      return [SOLID(
        'M8.5 5 H15.5 V15.8 A3.5 3.5 0 0 1 8.5 15.8 Z' +
        ' M9 13.6 L9 12.6 L15 9 L15 10 Z' +                                              // angled shank flute
        ' M9.3 14.3 C10.1 17.1 13.9 17.1 14.7 14.3 L14.7 13.4 C13.9 16.2 10.1 16.2 9.3 13.4 Z'  // ball-nose flute
      )];

    case 'radius mill':
      return [SOLID('M8.5 5 H15.5 V17.5 Q15.5 21 12.5 21 H11.5 Q8.5 21 8.5 17.5 Z' + slash(19) + slash(15.6))];

    case 'tapered mill':
      return [SOLID('M8.5 5 H15.5 V11.5 L13.6 21 H10.4 L8.5 11.5 Z' + slash(19.4, 10.2, 13.6) + slash(16, 9.7, 14.3))];

    case 'chamfer mill':   // conical point
      return [SOLID('M8.5 5 H15.5 V12.5 L12 20.5 L8.5 12.5 Z' + slashT(11.8) + slashT(9.2))];

    case 'lollipop mill':  // undercutting — thin neck + spherical cutter
      return [SOLID(
        'M9.6 5 H14.4 V9 H9.6 Z M11.3 9 H12.7 V12 H11.3 Z' +
        ' M8.5 15 A3.5 3.5 0 1 0 15.5 15 A3.5 3.5 0 1 0 8.5 15 Z' +
        ' M10 14.4 C11 16.8 13 16.8 14 14.4 L14 13.6 C13 16 11 16 10 13.6 Z'
      )];

    case 'dovetail':
      return [SOLID('M9.6 5 H14.4 V10 H9.6 Z M11.2 10 H12.8 V12 H11.2 Z M10 12 L7.7 19.6 H16.3 L14 12 Z M8.9 15.9 H15.1 V16.6 H8.7 Z')];

    case 'slot/key cutter':   // woodruff / keyseat — thin neck + wide toothed disc
      return [SOLID(
        'M10.6 5 H13.4 V12.6 H10.6 Z M6 12.6 H18 V16.4 H6 Z' +
        [7, 9, 11, 13, 15, 17].map((x) => ` M${x} 16.4 H${x + 0.6} V15.2 H${x} Z`).join('')
      )];

    case 'form mill':   // profiled / radius-form bottom
      return [SOLID('M8.5 5 H15.5 V12.5 C14.5 12.5 14 16 12 13.5 C10 16 9.5 12.5 8.5 12.5 Z' + slashT(11.4) + slashT(8.8))];

    case 'thread mill':
      return [SOLID('M8.5 5 H15.5 V21 H8.5 Z' + [9.6, 12, 14.4, 16.8, 19.2].map((y) => ` M9 ${y} H15 V${y + 0.6} H9 Z`).join(''))];

    // ── Circle-segment family ───────────────────────────────────────────────
    case 'circle segment barrel':
      return [SOLID(
        'M9 5 H15 V8 C18 12 18 16 15 21 H9 C6 16 6 12 9 8 Z' +
        ' M8 12 C10.5 11.2 13.5 11.2 16 12 L16 12.6 C13.5 11.8 10.5 11.8 8 12.6 Z' +
        ' M8.4 16 C10.6 15.3 13.4 15.3 15.6 16 L15.6 16.6 C13.4 15.9 10.6 15.9 8.4 16.6 Z'
      )];

    case 'circle segment lens':   // labelled "High Feed" in our UI
      return [SOLID('M10.6 5 H13.4 V8.5 H10.6 Z M12 8.5 C6.5 13 6.5 16 12 21 C17.5 16 17.5 13 12 8.5 Z M11.7 9.4 H12.3 V20 H11.7 Z')];

    case 'circle segment oval':
      return [SOLID(
        'M10.6 5 H13.4 V8.5 H10.6 Z M12 9.2 A3.6 5.6 0 1 0 12 20.4 A3.6 5.6 0 1 0 12 9.2 Z' +
        ' M8.6 13 C10 12.3 14 12.3 15.4 13 L15.4 13.6 C14 12.9 10 12.9 8.6 13.6 Z' +
        ' M8.6 16.6 C10 17.3 14 17.3 15.4 16.6 L15.4 17.2 C14 17.9 10 17.9 8.6 17.2 Z'
      )];

    case 'circle segment taper':
      return [SOLID(
        'M10.6 5 H13.4 V8.5 H10.6 Z M9.4 8.5 Q8.6 15 11 21 H13 Q15.4 15 14.6 8.5 Z' +
        ' M9.7 12.5 C11 12 13 12 14.3 12.5 L14.3 13.1 C13 12.6 11 12.6 9.7 13.1 Z' +
        ' M10 16.5 C11.1 16.1 12.9 16.1 14 16.5 L14 17.1 C12.9 16.7 11.1 16.7 10 17.1 Z'
      )];

    // ── Hole making ─────────────────────────────────────────────────────────
    case 'drill':   // pointed tip, 2-flute
      return [SOLID('M8.5 5 H15.5 V14.8 L12 20.6 L8.5 14.8 Z' + slashT(13.6) + slashT(11))];

    case 'center drill':   // thick body steps to a thin pilot point
      return [SOLID('M8 5 H16 V11 H8 Z M10.4 11 H13.6 V14.6 L12 18 L10.4 14.6 Z' + slashT(10.2, 8.6, 15.4) + slashT(7.8, 8.6, 15.4))];

    case 'spot drill':   // short, wide-angle point
      return [SOLID('M8.5 5 H15.5 V12.5 L12 19.5 L8.5 12.5 Z' + slashT(11.5) + slashT(8.9))];

    case 'reamer':   // STRAIGHT flutes, chamfered start
      return [SOLID('M8.5 5 H15.5 V18.4 L13.8 21 H10.2 L8.5 18.4 Z M10 8 H10.5 V20 H10 Z M11.75 8 H12.25 V20.2 H11.75 Z M13.5 8 H14 V20 H13.5 Z')];

    case 'counter bore':   // flat body + central pilot pin
      return [SOLID('M8.5 5 H15.5 V16 H8.5 Z M11 16 H13 V20.5 H11 Z' + slash(14.6) + slash(11.2))];

    case 'counter sink':   // conical countersink
      return [SOLID('M10.5 5 H13.5 V9 H10.5 Z M7.4 9 H16.6 L12 19.6 Z M9.8 9.3 H10.2 L11.85 18.6 H11.55 Z M13.8 9.3 H14.2 L12.45 18.6 H12.15 Z')];

    // ── Tap ───────────────────────────────────────────────────────────────
    case 'tap':
      return [SOLID(
        'M10.3 4 H13.7 V6.5 H10.3 Z M9.5 6.5 H14.5 V16.5 L12.7 21 H11.3 L9.5 16.5 Z' +
        ' M9.5 8 L14.5 9 V9.5 L9.5 8.5 Z M9.5 10.3 L14.5 11.3 V11.8 L9.5 10.8 Z' +
        ' M9.5 12.6 L14.5 13.6 V14.1 L9.5 13.1 Z M9.5 14.9 L14.5 15.9 V16.4 L9.5 15.4 Z'
      )];

    // ── Boring (bar + offset cutting bit) ─────────────────────────────────────
    case 'boring head':
      return [SOLID('M10.6 5 H12.6 V9 H10.6 Z M7.5 9 H16.5 V13 H7.5 Z M9.5 13 H11 V18 H9.5 Z M6.3 16.8 L9 17.9 L7 19.8 Z')];

    // ── Turning (lathe holder + diamond insert) ──────────────────────────────
    case 'turning general':
      return [SOLID('M6.5 12 H20 V18 H6.5 Z M6.5 9.6 H11.5 V12 H6.5 Z M4.6 10.6 L8.5 8.3 L11 11.1 L7.1 13.4 Z')];

    default:
      return [SOLID('M8.5 5 H15.5 V21 H8.5 Z' + slash(19.8) + slash(16.4))];
  }
}

export function ToolTypeIcon({ type, size = 24, className = '', style }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="currentColor" stroke="none"
      className={className} style={style} aria-hidden="true"
    >
      {paths(type)}
    </svg>
  );
}

export default ToolTypeIcon;
