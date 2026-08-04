// ─── Holder color, for holders the app doesn't own a record for ─────────────
//
// Every holder SIZE carries its own color so the same physical holder reads the
// same wherever it appears. Once a holder has an app RECORD that color is a
// real, chosen field (`record.color`, picked in HolderDetail). This file is the
// fallback for everything else: a tool carrying a holder Fusion baked in, with
// no record behind it yet.
//
// The named list is the shop's original hand-assigned set — kept because those
// colors are already in people's heads. Anything else gets a stable
// hash-assigned color so it is at least consistent between screens, and the
// teal default when there's no holder at all.
//
// ⚠️ Once a holder is imported and given a color on the Holders page, THAT wins
// — see holderForDisplay in HolderPill.jsx. This list is a starting point, not
// a source of truth.

const NAMED_COLORS = {
  'NBT30-SK13C-60':  '#06b6d4',  /* 30-SK13-60 · cyan */
  'NBT30-SK13C-90':  '#ec4899',  /* 30-SK13-90 · pink */
  'NBT30-SK13C-120': '#65a30d',  /* 30-SK13-120 · lime */
  'NBT30-SK13C-150': '#8b5cf6',  /* 30-SK13-150 · violet */
  'NBT30-SK20C-60':  '#eab308',  /* 30-SK20-60 · yellow */
  'NBT30-SK20C-90':  '#ef4444',  /* 30-SK20-90 · red */
  'DRILL CHUCK':     '#10b981',  /* drill chuck · green */
};

export const HOLDER_DEFAULT = '#2dd4bf';  // teal — unknown / no holder
const FALLBACK = ['#ec4899', '#a855f7', '#14b8a6', '#fbbf24', '#ef4444', '#10b981'];

export function holderColor(description) {
  if (!description) return HOLDER_DEFAULT;
  const norm = description.trim().toUpperCase();
  if (NAMED_COLORS[norm]) return NAMED_COLORS[norm];
  let hash = 0;
  for (let i = 0; i < norm.length; i++) {
    hash = (hash * 31 + norm.charCodeAt(i)) | 0;
  }
  return FALLBACK[Math.abs(hash) % FALLBACK.length];
}
