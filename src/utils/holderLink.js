// ─── Linking the existing cutting tools to the controlled holders ───────────
//
// THE FIRST JOB OF THE WHOLE EXERCISE. The tools are already out there, each
// carrying a frozen copy of a holder that Fusion absorbed at copy time. Fusion
// keeps no link back, and its holder guid churns — so working out which record
// each tool is actually on has to be done from what the tool carries.
//
// Three tiers, and the split between the first two is the interesting part:
//
//   EXACT   Segments match within the rounding tolerance, one record. Linked
//           automatically — this is the same strict rule used at the Fusion
//           boundary, and against the shop's real data it covers ~93%.
//
//   NEAR    ONE dimension outside tolerance, everything else identical, AND the
//           two descriptions agree about which holder this is. Measured on real
//           data these are never noise: they are one segment height off by a
//           round number (1.00mm, 2.00mm) — the same physical holder drawn to a
//           slightly different gauge datum. Offered pre-ticked, still confirmed.
//
//   ⚠️ WHY "NEAR" MUST CHECK THE DESCRIPTION, NOT JUST THE NUMBERS. The real
//   library contains a trap: a tool baking "…ER16 12mm Shank-EX OOH1.60"
//   differs from the record "…ER16 12mmEXOOH1.75" by ONE height, 0.150" —
//   which is EXACTLY the difference between 1.60 and 1.75 of stickout. By the
//   numbers alone it looks like the same near-miss as the 2mm case. It is not:
//   it's the same body and extension assembled at a different length, i.e. a
//   genuinely different holder we don't have a record for. Auto-linking it
//   would silently give the tool the wrong stickout. The descriptions are what
//   separate the two cases, so both must agree.
//
//   CANDIDATE  Plausible by description + gauge (the loose migration matcher,
//           holderAudit.js), or a near-shape whose description disagrees.
//           Listed for a person, never pre-ticked.
//
// Nothing here writes. It proposes; the caller commits what the user accepted.

import { segHeight, segUpper, segLower, deriveGaugeLength, holderLenIn } from './holderGeometry.js';
import { convertLength } from './units.js';
import { parseForMatch, HOLDER_GAUGE_TOL_IN } from './holderAudit.js';
import { SEGMENT_MATCH_TOL_IN } from '../schema/holderIdentity.js';

const inches = (v, unit) => convertLength(Number(v) || 0, unit, 'inches');

// How far one dimension may be out and still read as "the same holder drawn
// differently". Sized from the real data at both ends: observed drawing
// differences are 1.00mm and 2.00mm, while the smallest REAL step in a length
// family (SK13C-60 → -90 → -120 → -150) is 30mm. 5mm sits well clear of both.
export const NEAR_MAX_MM = 5;
export const NEAR_MAX_IN = NEAR_MAX_MM / 25.4;

// Dimension-by-dimension difference between a baked holder and a record, in
// inches. null when the shapes aren't comparable at all (different segment
// count = a different holder, however close the rest lines up).
export function shapeDelta(baked, record) {
  const a = baked?.segments;
  const b = record?.segments;
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return null;
  const off = [];
  let worst = 0;
  for (let i = 0; i < a.length; i++) {
    const pairs = [
      ['height', segHeight(a[i]), segHeight(b[i])],
      ['upper', segUpper(a[i]), segUpper(b[i])],
      ['lower', segLower(a[i]), segLower(b[i])],
    ];
    for (const [what, x, y] of pairs) {
      const d = inches(x, baked.unit) - inches(y, record.unit);
      if (Math.abs(d) > worst) worst = Math.abs(d);
      if (Math.abs(d) > SEGMENT_MATCH_TOL_IN) off.push({ segment: i, what, deltaIn: d });
    }
  }
  return { offCount: off.length, off, worstIn: worst, dimensions: a.length * 3 };
}

// Extension stickout stated in a description ("…EX OOH1.60", "1.2OOH", "OOH 2.2").
// Same patterns the description healer reads.
export function statedOohIn(description) {
  const U = String(description || '').toUpperCase();
  const m = U.match(/OOH\s*([\d.]+)/) || U.match(/([\d.]+)\s*OOH/);
  return m ? parseFloat(m[1]) : null;
}

// Do these two descriptions claim to be the same holder? Only compares what
// BOTH state — a blank on either side is "no information", not a disagreement,
// because half this library's names are incomplete.
export function descriptionsAgree(a, b, config) {
  const pa = parseForMatch(a, config);
  const pb = parseForMatch(b, config);
  const both = (x, y) => x != null && y != null && x !== false && y !== false;
  if (both(pa.taper, pb.taper) && pa.taper !== pb.taper) return false;
  if (both(pa.collet, pb.collet) && pa.collet !== pb.collet) return false;
  if (both(pa.length, pb.length) && pa.length !== pb.length) return false;
  if (pa.hasExt !== pb.hasExt) return false;
  if (both(pa.extCollet, pb.extCollet) && pa.extCollet !== pb.extCollet) return false;
  // ⚠️ The trap above: same body, same extension, DIFFERENT stickout. Two
  // descriptions that both state an OOH and disagree are different holders.
  const oa = statedOohIn(a);
  const ob = statedOohIn(b);
  if (oa != null && ob != null && Math.abs(oa - ob) > 0.005) return false;
  return true;
}

// Propose the record a baked holder belongs to.
// `baked` is the holder object Fusion absorbed into the tool.
// → { status: 'exact'|'near'|'candidate'|'none', record, alternatives[], delta, why }
export function proposeHolderLink(baked, records, config) {
  const list = records || [];
  if (!baked || !Array.isArray(baked.segments) || !baked.segments.length) {
    return { status: 'none', record: null, alternatives: [], delta: null,
      why: 'This tool’s holder has no geometry at all — there is nothing to match on.' };
  }

  const scored = list
    .map(r => ({ r, delta: shapeDelta(baked, r) }))
    .filter(x => x.delta)
    .sort((x, y) => x.delta.offCount - y.delta.offCount || x.delta.worstIn - y.delta.worstIn);

  const exact = scored.filter(x => x.delta.offCount === 0);
  if (exact.length === 1) {
    return { status: 'exact', record: exact[0].r, alternatives: [], delta: exact[0].delta, why: null };
  }
  if (exact.length > 1) {
    return {
      status: 'candidate', record: null, alternatives: exact.map(x => x.r), delta: null,
      why: `${exact.length} holder records have this exact shape — merge them first, then link.`,
    };
  }

  // ⚠️ "ONE DIMENSION OUT" IS NOT RARE — IT IS THE NORMAL SHAPE OF A LENGTH
  // FAMILY. NBT30-SK13C-60/90/120/150 are the identical holder apart from one
  // body-length segment, so a baked SK13C-120 sits one dimension away from ALL
  // FOUR of them (by 2mm, 28mm, 30mm, 58mm). Requiring "exactly one record is
  // one dimension out" therefore matches nothing useful.
  //
  // What actually separates them is the NAME plus the SIZE of the difference:
  // the right one is 2mm out and called SK13C-120; the wrong ones are tens of
  // millimetres out and called something else. So: among the one-dimension
  // candidates, keep those whose description agrees, and accept only if
  // exactly one survives AND the difference is small enough to be a drawing
  // difference rather than a different part.
  const one = scored.filter(x => x.delta.offCount === 1
    && descriptionsAgree(baked.description, x.r.description, config)
    && x.delta.worstIn <= NEAR_MAX_IN);
  if (one.length === 1) {
    const d = one[0].delta.off[0];
    return {
      status: 'near', record: one[0].r, alternatives: [], delta: one[0].delta,
      why: `Same holder drawn slightly differently — segment ${d.segment + 1} ${d.what} is `
        + `${(d.deltaIn * 25.4).toFixed(2)}mm out, everything else matches exactly.`,
    };
  }

  // Everything else: offer the closest by shape, plus anything the loose
  // description + gauge match turns up. Never pre-ticked.
  const gaugeIn = holderLenIn(deriveGaugeLength(baked.segments), baked.unit);
  const byName = list.filter(r =>
    descriptionsAgree(baked.description, r.description, config)
    && String(baked.description || '').trim() !== '');
  const byGauge = list.filter(r => {
    const g = holderLenIn(deriveGaugeLength(r.segments), r.unit);
    return gaugeIn != null && g != null && Math.abs(g - gaugeIn) <= HOLDER_GAUGE_TOL_IN;
  });
  const alternatives = [...new Set([
    ...scored.slice(0, 3).map(x => x.r), ...byName, ...byGauge,
  ])];

  const closest = scored.find(x => x.delta.offCount === 1);
  if (closest) {
    const d = closest.delta.off[0];
    return {
      status: 'candidate', record: null, alternatives, delta: closest.delta,
      why: `Closest is "${closest.r.description}" — one dimension out by `
        + `${(d.deltaIn * 25.4).toFixed(2)}mm. Not linked automatically: either the names disagree `
        + `or the gap is too big to be a drawing difference, which usually means a different `
        + `length or a different stickout rather than the same holder.`,
    };
  }
  return {
    status: alternatives.length ? 'candidate' : 'none',
    record: null, alternatives, delta: scored[0]?.delta || null,
    why: alternatives.length
      ? 'No shape match. These are the nearest by name or gauge length.'
      : 'Nothing in the holder library resembles this — it probably needs its own record.',
  };
}

// One row per ASSEMBLY that isn't linked yet, since that's what carries the
// link. Already-linked assemblies are skipped: this is a migration pass, not a
// re-audit of settled data.
export function buildHolderLinkPlan(tools, records, config) {
  const rows = [];
  for (const t of tools || []) {
    const bakedByGuid = new Map((t._instancesRaw || [])
      .filter(r => r?.guid && r.holder).map(r => [r.guid, r.holder]));
    for (const a of t.assemblies || []) {
      if (a.holder_id && (records || []).some(r => r.id === a.holder_id)) continue;
      const baked = bakedByGuid.get(a.instance_guid)
        || (a.holder_description ? { description: a.holder_description, segments: [], unit: t.unit } : null);
      const proposal = proposeHolderLink(baked, records, config);
      rows.push({
        toolId: t.id, tool: t, assemblyId: a.assembly_id, assembly: a,
        baked, ...proposal,
      });
    }
  }
  const auto = rows.filter(r => r.status === 'exact');
  const near = rows.filter(r => r.status === 'near');
  const review = rows.filter(r => r.status === 'candidate' || r.status === 'none');
  return { rows, auto, near, review };
}
