// Hand-crafted SVG silhouettes for each CNC tool type.
// All icons share a 24×24 viewBox, stroke `currentColor`, so they inherit the
// surrounding text color and tint via CSS (e.g. selected tiles turn blue).
// Grouped by family — end mills share a shank+flute body and differ at the tip;
// drills share a pointed tip; taps share a thread profile, etc.

// ─── Shared primitives ───────────────────────────────────────────────────────
// A vertical tool shank (the smooth top portion held by the holder).
const Shank = ({ y1 = 2.5, y2 = 8 }) => (
  <>
    <line x1="9.7" y1={y1} x2="9.7" y2={y2} />
    <line x1="14.3" y1={y1} x2="14.3" y2={y2} />
    <line x1="9.7" y1={y1} x2="14.3" y2={y1} />
  </>
);

// Flute hint lines across a cutting body between yTop and yBot.
const Flutes = ({ yTop = 9, yBot = 19, x1 = 9, x2 = 15 }) => (
  <>
    <line x1={x1} y1={yTop + 2.5} x2={x2} y2={yTop} />
    <line x1={x1} y1={yTop + 5.5} x2={x2} y2={yTop + 3} />
    <line x1={x1} y1={yTop + 8.5} x2={x2} y2={yTop + 6} />
  </>
);

// ─── Per-type artwork ────────────────────────────────────────────────────────
function paths(type) {
  switch (type) {
    // ── End mills ──────────────────────────────────────────────────────────
    case 'flat end mill':
      return (
        <>
          <Shank />
          <path d="M9 8.5 L9 20 L15 20 L15 8.5" />
          <Flutes yTop={9.5} yBot={19} />
        </>
      );
    case 'ball end mill':
      return (
        <>
          <Shank />
          <path d="M9 8.5 L9 17 A3 3 0 0 0 15 17 L15 8.5" />
          <Flutes yTop={9.5} yBot={16} />
        </>
      );
    case 'bull nose end mill':
      return (
        <>
          <Shank />
          <path d="M9 8.5 L9 18 A1.6 1.6 0 0 0 10.6 19.6 L13.4 19.6 A1.6 1.6 0 0 0 15 18 L15 8.5" />
          <Flutes yTop={9.5} yBot={18} />
        </>
      );
    case 'radius mill':
      return (
        <>
          <Shank />
          <path d="M9 8.5 L9 17.5 A1.1 1.1 0 0 0 10.1 18.6 L13.9 18.6 A1.1 1.1 0 0 0 15 17.5 L15 8.5" />
          <Flutes yTop={9.5} yBot={17.5} />
        </>
      );
    case 'tapered mill':
      return (
        <>
          <Shank />
          <path d="M9 8.5 L10.4 20 L13.6 20 L15 8.5" />
          <line x1="9.4" y1="11" x2="14.6" y2="11" />
          <line x1="9.8" y1="14.5" x2="14.2" y2="14.5" />
        </>
      );
    case 'chamfer mill':
      return (
        <>
          <Shank />
          <path d="M9 8.5 L9 13 L12 20 L15 13 L15 8.5" />
          <line x1="9" y1="13" x2="15" y2="13" />
          <Flutes yTop={9.2} yBot={12} x1={9.4} x2={14.6} />
        </>
      );
    case 'lollipop mill':
      return (
        <>
          <Shank y2={11} />
          <line x1="11.4" y1="11" x2="11.4" y2="15" />
          <line x1="12.6" y1="11" x2="12.6" y2="15" />
          <circle cx="12" cy="17.5" r="3" />
        </>
      );
    case 'dovetail':
      return (
        <>
          <Shank y2={11} />
          <line x1="11.2" y1="11" x2="11.2" y2="14" />
          <line x1="12.8" y1="11" x2="12.8" y2="14" />
          <path d="M8.5 20 L10 14 L14 14 L15.5 20 Z" />
        </>
      );
    case 'slot/key cutter':
      return (
        <>
          <Shank y2={11} />
          <line x1="11.2" y1="11" x2="11.2" y2="14" />
          <line x1="12.8" y1="11" x2="12.8" y2="14" />
          <rect x="6.5" y="14" width="11" height="4" rx="0.6" />
          <line x1="9.5" y1="14" x2="9.5" y2="18" />
          <line x1="14.5" y1="14" x2="14.5" y2="18" />
        </>
      );
    case 'form mill':
      return (
        <>
          <Shank />
          <path d="M9 8.5 L9 13 Q12 11 15 13 L15 8.5" />
          <path d="M9 13 L9 16 Q12 22 15 16 L15 13" />
        </>
      );
    case 'thread mill':
      return (
        <>
          <Shank />
          <path d="M9.2 9 L9.2 20 M14.8 9 L14.8 20" />
          <path d="M9.2 10.5 L14.8 11.5 M9.2 13 L14.8 14 M9.2 15.5 L14.8 16.5 M9.2 18 L14.8 19" />
        </>
      );

    // ── Circle-segment family (barrel-style profiles) ──────────────────────
    case 'circle segment barrel':
      return (
        <>
          <Shank y2={9} />
          <path d="M9.5 9 Q6.5 14 9.5 20 L14.5 20 Q17.5 14 14.5 9" />
          <line x1="8" y1="14.5" x2="16" y2="14.5" />
        </>
      );
    case 'circle segment lens':
      return (
        <>
          <Shank y2={10} />
          <path d="M12 10 Q6 14 12 20 Q18 14 12 10 Z" />
        </>
      );
    case 'circle segment oval':
      return (
        <>
          <Shank y2={9.5} />
          <ellipse cx="12" cy="15" rx="3.4" ry="5" />
        </>
      );
    case 'circle segment taper':
      return (
        <>
          <Shank y2={9} />
          <path d="M9.5 9 Q9 15 11 20 L13 20 Q15 15 14.5 9" />
          <line x1="9.3" y1="13" x2="14.7" y2="13" />
        </>
      );

    // ── Drills ─────────────────────────────────────────────────────────────
    case 'drill':
      return (
        <>
          <Shank />
          <path d="M9 8.5 L9 17 L12 21 L15 17 L15 8.5" />
          <path d="M9.5 9.5 Q12 12 14.5 9.5 M9.3 13 Q12 15.5 14.7 13" />
        </>
      );
    case 'center drill':
      return (
        <>
          <path d="M9 3 L9 11 L15 11 L15 3" />
          <line x1="9" y1="11" x2="15" y2="11" />
          <path d="M10.5 11 L10.5 17 L12 20 L13.5 17 L13.5 11" />
        </>
      );
    case 'spot drill':
      return (
        <>
          <Shank y2={12} />
          <path d="M9 11.5 L9 14 L12 20 L15 14 L15 11.5" />
          <line x1="9" y1="14" x2="15" y2="14" />
        </>
      );
    case 'reamer':
      return (
        <>
          <Shank />
          <path d="M9 8.5 L9 19.5 L15 19.5 L15 8.5" />
          <line x1="10" y1="9" x2="10" y2="19.5" />
          <line x1="12" y1="9" x2="12" y2="19.5" />
          <line x1="14" y1="9" x2="14" y2="19.5" />
        </>
      );

    // ── Hole finishing ─────────────────────────────────────────────────────
    case 'counter bore':
      return (
        <>
          <Shank y2={9} />
          <path d="M9 8.5 L9 16 L15 16 L15 8.5" />
          <Flutes yTop={9.2} yBot={15} />
          <path d="M11 16 L11 20 L13 20 L13 16" />
        </>
      );
    case 'counter sink':
      return (
        <>
          <Shank y2={9} />
          <path d="M8 9 L8 11 L12 20 L16 11 L16 9" />
          <line x1="8" y1="11" x2="16" y2="11" />
          <line x1="9.4" y1="12.5" x2="14.6" y2="12.5" />
        </>
      );

    // ── Taps ───────────────────────────────────────────────────────────────
    case 'tap':
      return (
        <>
          <path d="M9.5 2.5 L9.5 6 L8.7 6 L8.7 4 L15.3 4 L15.3 6 L14.5 6 L14.5 2.5" />
          <path d="M9.5 6 L9.5 20 L14.5 20 L14.5 6" />
          <path d="M9.5 8 L14.5 9 M9.5 11 L14.5 12 M9.5 14 L14.5 15 M9.5 17 L14.5 18" />
        </>
      );

    // ── Boring ─────────────────────────────────────────────────────────────
    case 'boring head':
      return (
        <>
          <line x1="12" y1="2.5" x2="12" y2="9" />
          <rect x="6" y="9" width="12" height="4" rx="0.6" />
          <path d="M7 13 L7 17 L9 17 L9 13" />
          <path d="M6.5 17 L9.5 17 L9.5 19 L7.5 20 L6.5 19 Z" />
        </>
      );

    // ── Turning ────────────────────────────────────────────────────────────
    case 'turning general':
      return (
        <>
          <path d="M3 6 L16 6 L20 8 L20 11 L3 11 Z" />
          <path d="M14 11 L18 16 L13 16 Z" />
          <line x1="6" y1="8.5" x2="13" y2="8.5" />
        </>
      );

    // ── Fallback (generic mill) ────────────────────────────────────────────
    default:
      return (
        <>
          <Shank />
          <path d="M9 8.5 L9 20 L15 20 L15 8.5" />
          <Flutes yTop={9.5} yBot={19} />
        </>
      );
  }
}

export default function ToolTypeIcon({ type, size = 22, className = '', style }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {paths(type)}
    </svg>
  );
}
