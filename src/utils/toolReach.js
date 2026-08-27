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

// How close to the cutting diameter a neck has to be before it counts as an
// UNDERCUT — a neck deliberately ground "a little smaller" so the tool clears
// its own cut.
//
// ⚠️ WITHOUT THIS, EVERY SLITTING SAW IS AN "UNDERCUT". A bare `neck < dia`
// test is true for a saw arbor, a lollipop stem, a dovetail shank and a face
// mill body, none of which are undercuts — they are just what those tools look
// like. Measured across the real 303-tool library, every genuine undercut runs
// 96.0–97.4% of the cutting diameter (.038 of .039, .0605 of .0625, .09 of
// .09375, .0192 of .02) and the nearest thing that is NOT one is a 2" face
// mill's 1.75" body at 87.5%; below that it drops to 61.3% (lollipop) and on
// down to 40% (saw). 92% sits in the middle of the 87.5→96.0 gap.
//
// The reading that makes it a separator rather than a tuned number: an undercut
// is ground A LITTLE under the cut so the tool clears its own walls — single
// digits of a percent. A neck 12% under is a different-diameter part of the
// tool, not a relieved one.
export const UNDERCUT_MIN_RATIO = 0.92;

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
  const raw = tool?._instancesRaw?.[0] || null;
  const shaft = raw?.shaft ?? tool?.shaft ?? null;
  const dia = Number(tool?.diameter);
  const flute = Number(tool?.flute_length) || 0;
  const unit = tool?.unit;

  const { neckLength, minDiameter } = readShaftNeck(shaft, dia, unit);
  if (!(neckLength > 0)) return { reach: null, has_undercut: null, undercut_diameter: null };

  const reach = round4(flute + neckLength);
  const eps = lengthEps(unit);
  const undercut =
    minDiameter !== null &&
    minDiameter < dia - eps &&
    minDiameter >= dia * UNDERCUT_MIN_RATIO;

  return {
    reach,
    has_undercut: undercut ? true : null,
    undercut_diameter: undercut ? round4(minDiameter) : null,
  };
}

function round4(v) {
  return Math.round(v * 1e4) / 1e4;
}

/**
 * Load-time seed, mirroring `backfillAsmNumbers` / `backfillMaterialPresetIds`:
 * an in-memory pass that fills reach/undercut from the shaft segments Fusion
 * already carries, persisted lazily on each tool's next save.
 *
 * ⚠️ IT ONLY EVER FILLS A BLANK. A stored answer is the user's, including a
 * `false` they ticked off a saw the seed would otherwise keep re-flagging — the
 * "can the user make this go away?" rule. `undefined`/`null` is "nobody has
 * said"; anything else is an answer and is left alone.
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
    if (!tool) return tool;
    const wantsReach = tool.reach == null;
    const wantsUndercut = tool.has_undercut == null;
    if (!wantsReach && !wantsUndercut) return tool;

    const d = deriveReach(tool);
    if (d.reach == null) return tool;

    const patch = {};
    if (wantsReach) patch.reach = d.reach;
    if (wantsUndercut && d.has_undercut != null) {
      patch.has_undercut = d.has_undercut;
      // Only ever offered alongside the flag it belongs to; never on its own.
      if (tool.undercut_diameter == null && d.undercut_diameter != null) {
        patch.undercut_diameter = d.undercut_diameter;
      }
    }
    if (!Object.keys(patch).length) return tool;
    changed = true;
    return { ...tool, ...patch };
  });
  return changed ? out : tools;
}
