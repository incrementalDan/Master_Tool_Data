// Reach and undercut — DERIVED from the shaft segments Fusion already stores.
//
// A "reach" tool holds its cutting diameter (or a hair under it) for some
// distance ABOVE the flutes, so it can drop into a deep pocket without the
// shank rubbing the walls. Fusion draws that as `shaft.segments[]`: an array of
// `{ height, lower-diameter, upper-diameter }` running TIP-FIRST, the same
// bottom-up ordering holder segments use.
//
//   reach = flute_length + every leading shaft segment still at/below the
//           cutting diameter, stopping at the first segment that goes above it
//
// ⚠️ THE STOP IS AT THE START OF THE FIRST OVERSIZE SEGMENT, not partway
// through it. The transition segment is usually a taper (0.038 → 0.125) that
// crosses the cutting diameter somewhere in the middle, and it would be easy to
// "improve" this by interpolating that crossing point. Don't: the shop's own
// hand-written numbers are the whole-segment answer. `1mm (.039) 3FL EM
// .059LOC .203 REACH` = LCF 0.059 + one 0.144 neck segment = exactly 0.203, and
// the same rule reproduces `.5 REACH`, `.312REACH`, `.4 reach` and `12x Reach`
// across the real library. Interpolating would move every one of them.
//
// ⚠️ THESE ARE ARITHMETIC, NOT RECORDED OPINIONS — so they are RE-DERIVED on
// every load, not filled in once. Reach IS flute length plus the neck; change
// either and the reach genuinely changed. Freezing a stored value means the
// number silently stops describing the tool. Same shape as an Auto
// `asm_number`: "a pure product of its fields, so a stored value that differs
// from the composed one is always stale, never custom". The stored copy exists
// only so the value is searchable and so a tool whose shaft Fusion never drew
// can still carry a hand-typed number.
import { fieldAppliesTo } from '../schema/fieldRegistry.js';

// ⚠️ AN UNDERCUT IS A FACT ABOUT THE GEOMETRY: the neck above the flutes is
// narrower than the cutting diameter. That is all. It is NOT a judgement about
// why it is narrower, or by how much.
//
// An earlier pass gated it at 92% of the cutting diameter, so that a saw arbor
// or a lollipop stem would not count. That was wrong twice over: the threshold
// was reverse-engineered from a gap that happens to exist in today's 303 tools,
// and the question it was trying to answer ("was this deliberately relieved?")
// is not the question. A key cutter's arbor genuinely IS narrower than its
// cutter — so it is undercut, and saying so costs nothing. How much of an
// undercut it is does not change what it is.
//
// The only tolerance left is for FLOAT NOISE, which is a different kind of
// thing entirely — it asks "is this actually narrower, or is it the same number
// after a JSON round trip", never "is it narrow enough to count". Set far below
// any real grind (a tenth is 0.0001") and far above the ~1e-15 relative error a
// double actually carries.
const NOISE = 1e-6;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round4 = (v) => Math.round(v * 1e4) / 1e4;

/**
 * Read a Fusion `shaft` (either the `{ type, segments }` object or a bare
 * array) into the neck measurements above the flutes.
 *
 * `present` distinguishes "Fusion drew no shaft at all" (we cannot say
 * anything) from "Fusion drew one and nothing is narrowed" (we can say no).
 *
 * All lengths are in the tool's OWN unit — shaft segments are stored in it, so
 * nothing converts here.
 */
export function readShaftNeck(shaft, diameter) {
  const segs = Array.isArray(shaft) ? shaft : (shaft?.segments || []);
  const dia = num(diameter);
  const usable = Array.isArray(segs) && segs.some(s => num(s?.height) > 0);
  if (!usable || !(dia > 0)) return { present: false, neckLength: 0, minDiameter: null };

  let neckLength = 0;
  let minDiameter = null;
  for (const seg of segs) {
    const lo = num(seg?.['lower-diameter']);
    const hi = num(seg?.['upper-diameter']);
    const h = num(seg?.height);
    if (h <= 0) continue;
    // The first segment that rises above the cutting diameter ends the neck.
    if (Math.max(lo, hi) > dia + NOISE) break;
    neckLength += h;
    const segMin = Math.min(lo, hi);
    minDiameter = minDiameter === null ? segMin : Math.min(minDiameter, segMin);
  }
  return { present: true, neckLength, minDiameter };
}

/**
 * What a tool's shaft segments say. Every field is `null` when the segments
 * cannot answer, which is what lets a hand-typed value survive there.
 *
 * `reach` is null when there is no neck — a tool whose cutting diameter stops
 * at the flutes has no extended reach to report, and storing `reach ===
 * flute_length` would put a number saying nothing on ~280 tools. It is also
 * what makes the description rule ("name reach only when it exceeds the flute
 * length") fall out for free.
 */
export function deriveReach(tool) {
  // ⚠️ The type gate lives HERE, not only in the UI. The registry says face
  // mills and boring heads have no reach field; without this the derivation
  // would still reach the metadata file even though nothing renders it.
  if (tool?.tool_type && !fieldAppliesTo('reach', tool.tool_type)) {
    return { reach: null, neckDiameter: null, hasUndercut: null };
  }
  const dia = num(tool?.diameter);
  const flute = num(tool?.flute_length);
  // The app's own field first (what the editor writes), raw entry as fallback.
  const shaft = Array.isArray(tool?.shaft_segments)
    ? tool.shaft_segments.map(s => ({
        height: s?.height, 'lower-diameter': s?.lower, 'upper-diameter': s?.upper }))
    : (tool?._instancesRaw?.[0]?.shaft ?? tool?.shaft ?? null);

  const { present, neckLength, minDiameter } = readShaftNeck(shaft, dia);
  if (!present) return { reach: null, neckDiameter: null, hasUndercut: null };

  const narrowed = minDiameter !== null && minDiameter < dia - NOISE;
  return {
    reach: neckLength > 0 ? round4(flute + neckLength) : null,
    neckDiameter: narrowed ? round4(minDiameter) : null,
    // Fusion drew the shaft, so we CAN answer — either way.
    hasUndercut: narrowed,
  };
}

/**
 * Did Fusion draw a shaft this tool's reach can be derived FROM?
 *
 * ⚠️ The question is whether there are segments to read, NOT whether a reach
 * came out of them: a drawn shaft whose first segment is already wider than the
 * cut has an answer, and the answer is "no reach past the flutes". Either way
 * the number is arithmetic and re-derived on every load, so the field must be a
 * READ-OUT — an input there accepts a value the next load silently discards.
 * It becomes editable only where Fusion drew no shaft at all.
 */
export function reachIsDerived(tool) {
  if (tool?.tool_type && !fieldAppliesTo('reach', tool.tool_type)) return false;
  const shaft = Array.isArray(tool?.shaft_segments)
    ? tool.shaft_segments.map(s => ({
        height: s?.height, 'lower-diameter': s?.lower, 'upper-diameter': s?.upper }))
    : (tool?._instancesRaw?.[0]?.shaft ?? tool?.shaft ?? null);
  return readShaftNeck(shaft, tool?.diameter).present;
}

/**
 * The diameter to offer when someone turns the undercut on for a tool whose
 * segments do not show one. `null` when there is nothing to read back.
 */
export function undercutDiameterHint(tool) {
  return deriveReach(tool).neckDiameter;
}

/**
 * The effective values for one tool: what the segments say, with the shop's
 * override on top.
 *
 * ⚠️ THE SEGMENTS WIN WHEREVER THEY CAN ANSWER. A typed reach survives only on
 * a tool whose shaft Fusion never drew — otherwise editing the flute length
 * would leave a reach that no longer describes the tool.
 *
 * ⚠️ `undercut_override` IS A SEPARATE FIELD ON PURPOSE. Comparing a stored
 * boolean against the derived one cannot tell "the shop said so" from "this is
 * ours and went stale" — the same reason preset names check their SHAPE rather
 * than equality. With only two possible values a stored-vs-derived compare is
 * pure guesswork.
 */
export function resolveReachFields(tool) {
  const d = deriveReach(tool);
  const override = tool?.undercut_override;

  const reach = d.reach ?? (tool?.reach ?? null);
  const hasUndercut = override ?? d.hasUndercut ?? (tool?.has_undercut ?? null);
  // The derived diameter belongs to the derived answer; a typed one stands
  // where the segments show no narrowing (including an override to Yes).
  const undercutDiameter = hasUndercut
    ? (d.neckDiameter ?? (tool?.undercut_diameter ?? null))
    : null;

  return { reach, has_undercut: hasUndercut, undercut_diameter: undercutDiameter };
}

/**
 * Load-time pass over the library, mirroring `backfillAsmNumbers`: in memory,
 * persisted lazily on each tool's next save.
 *
 * ⚠️ RETURNS THE SAME ARRAY AND THE SAME TOOL REFERENCES when every tool
 * already agrees, so callers can use identity to tell there is nothing to
 * persist — the `syncPresetMaterialName` invariant. A fresh object per load
 * would make every tool look dirty forever. Idempotent.
 */
export function resolveReachForTools(tools) {
  if (!Array.isArray(tools) || !tools.length) return tools;
  let changed = false;
  const out = tools.map((tool) => {
    if (!tool) return tool;
    const next = resolveReachFields(tool);
    const same = (tool.reach ?? null) === next.reach
      && (tool.has_undercut ?? null) === next.has_undercut
      && (tool.undercut_diameter ?? null) === next.undercut_diameter;
    if (same) return tool;
    changed = true;
    return { ...tool, ...next };
  });
  return changed ? out : tools;
}
