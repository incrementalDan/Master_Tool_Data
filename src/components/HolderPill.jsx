// ─── HolderPill — the reusable "what holder is this" bubble ─────────────────
//
// Meant to appear wherever a holder is referenced, not just on the Holders
// page. Two INDEPENDENT color concepts share this component without ever
// competing for the same surface:
//
//  1. HOLDER color — one per holder record, custom. It renders as thick end
//     CAPS plus a thin border. It NEVER fills the background: the middle stays
//     one neutral surface for every holder, everywhere.
//  2. COLLET-SIZE color — one per shared collet-size OPTION (not per holder).
//     It tints the matching substring inside the description ("SK13" in
//     "NBT30-SK13C-60").
//
// They can't clash precisely because (1) never touches the background, so the
// collet text always sits on the same surface regardless of holder color.
//
// This REPLACED the app's older flat `.holder-pill` tint everywhere. The thing
// that used to block the swap — a tool's holder comes from the snapshot Fusion
// baked in, with no link to a record and so no color to read — is gone now that
// assemblies carry `holder_id`. Where a record still can't be resolved (an
// unlinked tool, an empty holder library), `holderForDisplay` synthesizes one
// from the description + the legacy color list, so the TREATMENT is identical
// everywhere even when the data behind it isn't.
//
// Use <HolderTag> at call sites. <HolderPill> stays pure (no context) for the
// Holders page, which already has the record in hand.

import { holderOption, holderConfigOf } from '../schema/holderOptions.js';
import { holderForGuid } from '../utils/holderDuplicates.js';
import { holderColor } from '../utils/holderColors.js';
import { useApp } from '../context/AppContext.jsx';

export const DEFAULT_HOLDER_COLOR = 'var(--holder-default)';

// ─── Scoop cap geometry ─────────────────────────────────────────────────────
// The caps need a curved inner wall whose radius is LARGER than the pill's own
// corner radius, while still meeting the pill's top and bottom edges without a
// visible kink.
//
// This needs a Bezier, not a circular arc: a single circular arc can only be
// tangent-to-horizontal at both y=0 and y=H if its radius is exactly H/2 —
// which is the pill's OWN outer radius. Any larger circular radius can't hit
// both tangent points. A cubic Bezier sidesteps it: placing each control point
// at the SAME y as its adjacent endpoint forces that endpoint's tangent to be
// horizontal no matter how far the curve bows sideways in between.
//
// The straight outer edge isn't rounded in the path — the parent's
// border-radius + overflow:hidden clips it to shape for free.
export function scoopCapPath(capW, scoop, H) {
  const xC = capW - scoop;   // control points sit INSIDE capW, so the wall bows
  return `M 0,0 L 0,${H} L ${capW},${H} C ${xC},${H} ${xC},0 ${capW},0 Z`;
}

// Find the collet-size label inside a description and split around it.
// Tolerant of the real variants: a trailing C ("SK13C"), extra spaces, case.
export function findColletSpan(description, colletLabel) {
  if (!colletLabel || !description) return null;
  const label = String(colletLabel).replace(/[^A-Za-z0-9]/g, '');
  if (!label) return null;
  let re;
  try {
    re = new RegExp(label.replace(/([A-Za-z]+)(\d+)/, '$1\\s*$2') + 'C?', 'i');
  } catch {
    return null;
  }
  const m = String(description).match(re);
  if (!m) return null;
  return {
    before: description.slice(0, m.index),
    match: m[0],
    after: description.slice(m.index + m[0].length),
  };
}

export default function HolderPill({ holder, config, compact = false, title, style }) {
  if (!holder) return null;
  const color = holder.color || DEFAULT_HOLDER_COLOR;
  const colletOpt = holderOption(config, 'collet_sizes', holder.collet_size_id);
  const span = colletOpt ? findColletSpan(holder.description, colletOpt.label) : null;

  // Fixed height so the SVG coordinate space matches the rendered pill exactly —
  // the scoop math depends on knowing H, not guessing it from padding.
  const H = compact ? 24 : 30;
  const capW = compact ? 13 : 17;
  const scoop = compact ? 6 : 8;
  const d = scoopCapPath(capW, scoop, H);

  return (
    <span
      className={`holder-scoop-pill${compact ? ' compact' : ''}`}
      style={{ height: `${H}px`, borderRadius: `${H / 2}px`, borderColor: color, ...style }}
      title={title || holder.description || undefined}
    >
      <svg className="holder-scoop-cap left" width={capW} height={H} viewBox={`0 0 ${capW} ${H}`} aria-hidden="true">
        <path d={d} fill={color} />
      </svg>
      <svg className="holder-scoop-cap right" width={capW} height={H} viewBox={`0 0 ${capW} ${H}`} aria-hidden="true">
        <path d={d} fill={color} />
      </svg>
      <span className="holder-scoop-label" style={{ padding: `0 ${capW + 5}px` }}>
        {span ? (
          <>
            {span.before}
            <span className="holder-scoop-collet" style={{ color: colletOpt.color || 'inherit' }}>{span.match}</span>
            {span.after}
          </>
        ) : (holder.description || 'Untitled holder')}
      </span>
    </span>
  );
}

// ─── Resolving "which holder is this" from what a call site actually has ────
// Call sites hold an assembly (holder_id + the guid Fusion baked in) or just a
// description. Record first — that's the one with a chosen color and a collet
// classification — then the guid (following merges), then a synthetic stand-in
// so an unlinked holder still renders as the same pill rather than a different
// kind of chip.
export function holderForDisplay({ records, holderId, holderGuid, description }) {
  const list = records || [];
  const rec = (holderId ? list.find(r => r?.id === holderId) : null)
    || (holderGuid ? holderForGuid(list, holderGuid) : null);
  // ⚠️ A record's own `color` is null until someone picks one, so linking a
  // tool must NOT cost it the color it already had. Fall back to the by-size
  // list — the colors already in people's heads — and let a chosen color
  // override it.
  if (rec) return rec.color ? rec : { ...rec, color: holderColor(rec.description) };
  const desc = (description || '').trim();
  if (!desc || desc === '—') return null;
  return { description: desc, color: holderColor(desc), collet_size_id: null, _synthetic: true };
}

// The connected form — THE way a holder is shown outside the Holders page.
// `holder` (a record) short-circuits the lookup for callers that already have
// one. Renders nothing when there's no holder to show, so call sites don't each
// need their own em-dash branch.
export function HolderTag({
  holder, holderId, holderGuid, description, compact = true, title, style,
}) {
  const { holderLibrary, shopSettings } = useApp();
  const resolved = holder || holderForDisplay({
    records: holderLibrary?.holders, holderId, holderGuid, description,
  });
  if (!resolved) return null;
  return (
    <HolderPill
      holder={resolved} config={holderConfigOf(shopSettings)}
      compact={compact} title={title} style={style}
    />
  );
}
