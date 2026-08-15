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

// `chosen` is a holder record's own color when it has one — it always wins.
// Passing it here (rather than `chosen || holderColor(...)` at each call site)
// keeps the whole precedence chain in one place: chosen → by-size → teal.
//
// ⚠️ `stableKey` — A HOLDER'S COLOR MUST NOT MOVE WHEN ITS NAME DOES.
// The hash fallback used to run on the DESCRIPTION, so editing a holder's
// description re-coloured it — live, on every keystroke, in the very screen
// where you edit it. On the real library 21 of 22 holders have no chosen colour,
// so almost every holder behaved that way. A description is a name; the colour
// belongs to the physical holder, so when the caller has a record its stable
// `id` is what gets hashed. A holder with NO record (one Fusion baked into a
// tool) still hashes the description — there is no identity to key on, and that
// is exactly what this module exists to colour.
//
// NAMED_COLORS still matches on the description first: those six are the shop's
// hand-assigned colours and are already in people's heads.
export function holderColor(description, chosen, stableKey) {
  if (chosen) return chosen;
  const desc = description ? description.trim().toUpperCase() : '';
  if (desc && NAMED_COLORS[desc]) return NAMED_COLORS[desc];
  const key = stableKey || desc;
  if (!key) return HOLDER_DEFAULT;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return FALLBACK[Math.abs(hash) % FALLBACK.length];
}

// THE way to colour a holder anywhere it is drawn. Call sites hold a record (or
// a synthetic stand-in from holderForDisplay); this keeps them from each
// re-deriving the chain and disagreeing — the "same holder, two colours" bug.
export function holderDisplayColor(holder) {
  return holderColor(holder?.description, holder?.color, holder?.id);
}
