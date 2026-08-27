// Reach and undercut — derived from the shaft segments Fusion already stores.
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
import { lengthEps } from './units.js';
import { fieldAppliesTo } from '../schema/fieldRegistry.js';

// ⚠️ NOTHING HERE DECIDES WHETHER A TOOL HAS AN UNDERCUT. That is a person's
// answer, not a number the app is entitled to infer.
//
// An earlier pass auto-flagged it by comparing the neck to the cutting diameter
// and calling anything within 92% an undercut. That number came from a gap that
// happens to exist in today's 303 tools — real undercuts clustered at 96-97%,
// saw arbors and lollipop stems at 61% and below — and it would be wrong the
// first time a tool landed in between. Worse, it is a judgement about tool
// GEOMETRY, and how the different tool types relate shaft segments, shoulder
// length and Fusion's own collision detection is not something the app
// currently models. Deriving a rule from one dataset and applying it as fact is
// how the app would start disagreeing with Fusion about tools Fusion has right.
//
// So the undercut pill is MANUAL. What the app may do is read a number back:
// once a person says there IS an undercut, the smallest neck diameter in the
// shaft segments is, by definition, its diameter — that is a fact from Fusion,
// not an inference, and it is offered as an editable prefill.

/**
 * Read a Fusion `shaft` (either the `{ type, segments }` object or a bare
 * array) into the neck measurements above the flutes.
 *
 * Returns `{ neckLength, minDiameter }` where `neckLength` is 0 and
 * `minDiameter` is null when the tool has no neck — i.e. its first shaft
 * segment is already wider than the cut (an ordinary shank transition), which
 * is the overwhelming majority of tools.
 *
 * All lengths are in the tool's OWN unit — shaft segments are stored in it, so
 * nothing converts here.
 */
export function readShaftNeck(shaft, diameter, unit) {
  const segs = Array.isArray(shaft) ? shaft : (shaft?.segments || []);
  const dia = Number(diameter);
  if (!Array.isArray(segs) || !segs.length || !(dia > 0)) {
    return { neckLength: 0, minDiameter: null };
  }
  const eps = lengthEps(unit);
  let neckLength = 0;
  let minDiameter = null;

  for (const seg of segs) {
    const lo = Number(seg?.['lower-diameter']);
    const hi = Number(seg?.['upper-diameter']);
    const h = Number(seg?.height);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || !Number.isFinite(h)) break;
    // The first segment that rises above the cutting diameter ends the neck.
    if (Math.max(lo, hi) > dia + eps) break;
    neckLength += h;
    const segMin = Math.min(lo, hi);
    minDiameter = minDiameter === null ? segMin : Math.min(minDiameter, segMin);
  }
  return { neckLength, minDiameter };
}

/**
 * What a tool's shaft segments say about its reach and undercut.
 *
 * `reach` is null when there is no neck — a tool whose cutting diameter stops
 * at the flutes has no extended reach to report, and storing `reach ===
 * flute_length` would put a number on 280 tools that says nothing. Blank stays
 * the honest default, and it is what makes the description rule ("show reach
 * only when it exceeds the flute length") fall out for free.
 */
export function deriveReach(tool) {
  // ⚠️ The type gate lives HERE, not only in the UI. The registry says face
  // mills and boring heads have no reach field; without this the seed would
  // still stamp a number onto their records, and it would reach the metadata
  // file even though nothing renders it.
  if (tool?.tool_type && !fieldAppliesTo('reach', tool.tool_type)) {
    return { reach: null, neckDiameter: null };
  }
  const raw = tool?._instancesRaw?.[0] || null;
  const shaft = raw?.shaft ?? tool?.shaft ?? null;
  const dia = Number(tool?.diameter);
  const flute = Number(tool?.flute_length) || 0;
  const unit = tool?.unit;

  const { neckLength, minDiameter } = readShaftNeck(shaft, dia, unit);
  if (!(neckLength > 0)) return { reach: null, neckDiameter: null };

  // The neck's own diameter, reported only when it is actually narrower than
  // the cut. NOT a claim that the tool is undercut — see the note above.
  const eps = lengthEps(unit);
  const narrower = minDiameter !== null && minDiameter < dia - eps;

  return {
    reach: round4(flute + neckLength),
    neckDiameter: narrower ? round4(minDiameter) : null,
  };
}

/**
 * The diameter to offer when someone turns the undercut pill on — the smallest
 * neck diameter Fusion's shaft segments carry. `null` when the tool has no
 * narrowed neck, in which case the field simply stays empty for them to fill.
 */
export function undercutDiameterHint(tool) {
  return deriveReach(tool).neckDiameter;
}

function round4(v) {
  return Math.round(v * 1e4) / 1e4;
}

/**
 * Load-time seed, mirroring `backfillAsmNumbers` / `backfillMaterialPresetIds`:
 * an in-memory pass that fills REACH from the shaft segments Fusion already
 * carries, persisted lazily on each tool's next save.
 *
 * ⚠️ REACH ONLY. The undercut pill is never seeded — see the note at the top of
 * this file. Reach is a number the shop defined ("add the segments from the tip
 * up to where the diameter goes above the cut"); an undercut is a judgement.
 *
 * ⚠️ IT ONLY EVER FILLS A BLANK. A stored answer is the user's.
 * `undefined`/`null` is "nobody has said"; anything else is an answer.
 *
 * ⚠️ RETURNS THE SAME ARRAY AND THE SAME TOOL REFERENCES when nothing is
 * missing, so callers can use identity to tell there is nothing to persist —
 * the `syncPresetMaterialName` invariant. A fresh object per load would make
 * every tool look dirty forever.
 */
export function backfillReach(tools) {
  if (!Array.isArray(tools) || !tools.length) return tools;
  let changed = false;
  const out = tools.map((tool) => {
    if (!tool || tool.reach != null) return tool;
    const { reach } = deriveReach(tool);
    if (reach == null) return tool;
    changed = true;
    return { ...tool, reach };
  });
  return changed ? out : tools;
}
