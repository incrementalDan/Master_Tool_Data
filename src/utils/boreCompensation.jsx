// Small-bore chip-load compensation — the SINGLE source for both the math and
// the icon. When a tool bores a hole barely larger than itself, its centre
// orbits a tiny circle (Ø = bore − tool) while the cutting edge sweeps the full
// bore, so the edge travels bore/(bore−tool) times farther per rev than the
// programmed centre feed — and sees that many times the programmed chip load.
// Multiplying the base chip load by `factor` (< 1) compensates: the edge then
// sees the intended load. Arc compensation only — radial chip thinning
// partially offsets it and is left to the machinist's judgment.
export function boreCompensation(toolDia, boreDia) {
  const D = parseFloat(boreDia);
  const d = parseFloat(toolDia);
  if (!D || !d) return null;
  if (D <= d) return { error: 'Bore must be larger than the tool' };
  const centerCircle = D - d;
  return { centerCircle, ratio: D / centerCircle, factor: centerCircle / D };
}

// Bore glyph — a circle (the bore) with a smaller filled disc (the tool)
// offset toward one edge, the way the tool rides the wall.
export function SmallBoreIcon({ size = 19 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: 'block' }}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="15.2" cy="12" r="4.5" fill="currentColor" />
    </svg>
  );
}
