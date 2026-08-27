// The tool's silhouette, as a stack of regions from the tip upward.
//
// ORIENTATION: tip at the BOTTOM, shank at the TOP — how the tool actually
// hangs in the spindle, matching ProfileView's convention for holders.
//
// The stack Fusion itself draws (confirmed against a real export and Fusion's
// own Shaft tab):
//
//   0        → LCF          the flutes, at the cutting diameter
//   LCF      → LCF + Σh     the shaft segments, if any (stored TIP-FIRST)
//   LCF + Σh → OAL          plain shank, at the shank diameter
//
// ⚠️ SHOULDER LENGTH IS A DIMENSION, NOT A SOLID. It is the unbroken shoulder
// measured from the tip, so it overlaps whatever the stack already drew there.
// It is reported as its own band ONLY where it extends past the flutes, which
// is the one span that is "shoulder and not flute"; drawing it as a region
// would double-count the flutes and, on a tool whose segments disagree with it,
// would silently assert one of the two is wrong. The app has no opinion on that
// (see "Reach & undercut" in CLAUDE.md).
import { fieldAppliesTo } from '../schema/fieldRegistry.js';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// Tools whose profile this can draw. Everything milling or hole-making — a
// boring head and a turning tool are neither, and their geometry is nothing
// like a shanked round tool (see the same exclusion on `reach`).
export function canDrawProfile(toolType) {
  return !!toolType && toolType !== 'boring head' && toolType !== 'turning general';
}

// How the very tip is shaped. Only the forms the shop actually runs are
// modelled; anything else draws flat, which is honest rather than invented.
export function tipKindFor(tool) {
  const t = tool?.tool_type;
  if (t === 'ball end mill') return 'ball';
  if (t === 'drill' || t === 'center drill' || t === 'spot drill' || t === 'counter sink') return 'point';
  if (t === 'chamfer mill' || t === 'tapered mill') return 'taper';
  if (num(tool?.corner_radius) > 0) return 'radius';
  return 'flat';
}

/**
 * Read the raw Fusion shaft segments off a tool, tip-first, as plain numbers.
 * Returns [] for a tool with none — the overwhelming majority.
 */
export function shaftSegments(tool) {
  const raw = tool?._instancesRaw?.[0]?.shaft ?? tool?.shaft ?? null;
  const segs = Array.isArray(raw) ? raw : (raw?.segments || []);
  if (!Array.isArray(segs)) return [];
  return segs
    .map((s) => ({
      height: num(s?.height),
      lower: num(s?.['lower-diameter']),
      upper: num(s?.['upper-diameter']),
    }))
    .filter((s) => s.height > 0);
}

/**
 * The drawable profile: regions bottom-up, plus the extents the view needs to
 * scale by. Every length is in the tool's OWN unit — nothing converts here.
 *
 * Regions carry `y0`/`y1` measured from the tip, and `dBottom`/`dTop` so a
 * tapered segment draws as a trapezoid (same shape ProfileView uses).
 */
export function buildToolProfile(tool) {
  const dia = num(tool?.diameter);
  const flute = num(tool?.flute_length);
  const shoulder = num(tool?.shoulder_length);
  const oal = num(tool?.overall_length);
  const shank = num(tool?.shank_diameter) || dia;
  const segs = shaftSegments(tool);

  const regions = [];
  if (flute > 0 && dia > 0) {
    regions.push({ kind: 'flute', y0: 0, y1: flute, dBottom: dia, dTop: dia });
  }

  let y = flute;
  segs.forEach((s, i) => {
    regions.push({
      kind: 'segment',
      index: i,
      y0: y,
      y1: y + s.height,
      dBottom: s.lower || dia,
      dTop: s.upper || s.lower || dia,
    });
    y += s.height;
  });

  // Whatever is left up to the overall length is plain shank. A tool with no
  // OAL (or one whose segments already reach past it) simply has none — never
  // a negative-height region.
  if (oal > y) {
    regions.push({ kind: 'shank', y0: y, y1: oal, dBottom: shank, dTop: shank });
  }

  // The shoulder band: only the span past the flutes, and only up to where the
  // drawing actually goes.
  const total = Math.max(oal, y, flute);
  const shoulderBand =
    shoulder > flute ? { y0: flute, y1: Math.min(shoulder, total) } : null;

  const maxDia = regions.reduce(
    (m, r) => Math.max(m, r.dBottom, r.dTop),
    Math.max(dia, shank),
  );

  return {
    regions,
    shoulderBand,
    tipKind: tipKindFor(tool),
    cornerRadius: num(tool?.corner_radius),
    tipAngle: num(tool?.tip_angle),
    diameter: dia,
    // The tip diameter a chamfer/tapered mill narrows to. Fusion-native, and
    // only used when it is actually there — a tool with no tip diameter draws
    // flat rather than being given an invented cone.
    tipDiameter: num(tool?.tip_diameter),
    total,
    maxDia,
    segmentCount: segs.length,
  };
}

// Dimensions the drawing offers, in stack order from the tool outward. Each is
// a real registry field, gated by the same `appliesToTypes` the form uses — so
// a tap is never asked for a corner radius and a drill never for a taper.
const LENGTH_DIMS = ['flute_length', 'shoulder_length', 'reach', 'min_ooh', 'overall_length'];
const DIAMETER_DIMS = ['diameter', 'undercut_diameter', 'shank_diameter'];
const EXTRA_DIMS = ['corner_radius', 'tip_angle', 'taper_angle', 'number_of_flutes'];

const forType = (fields, toolType) => fields.filter((f) => fieldAppliesTo(f, toolType));

export function profileDimensions(toolType) {
  return {
    lengths: forType(LENGTH_DIMS, toolType),
    diameters: forType(DIAMETER_DIMS, toolType),
    extras: forType(EXTRA_DIMS, toolType),
  };
}
