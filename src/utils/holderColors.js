// ─── Holder colour ──────────────────────────────────────────────────────────
//
// A holder's colour is the colour PICKED FOR IT IN THE APP. That is the whole
// rule. It lives on the record (`record.color`, set in HolderDetail) and nothing
// derives it from the holder's name.
//
// ⚠️ It used to. Before the app owned a holder library there was no record to
// hang a colour on, so the colour was computed from the DESCRIPTION — a table of
// six hand-assigned names plus a hash of the text for everything else. That is
// obsolete now, and it misbehaved in the obvious way: editing a description
// re-coloured the holder, live, on every keystroke. All of it is gone.
//
// A record with no colour picked yet gets one assigned from its stable id, so a
// fresh library is varied rather than 22 identical teal pills. That is an
// auto-assignment keyed on identity, not a derivation from anything editable —
// it never moves, and the moment someone picks a colour, that wins.
//
// NOT this module's job: the collet tint inside a pill's text ("SK13" in
// "NBT30-SK13C-60"). That colour comes from the collet-size option in
// shop_settings.holder_config, resolved through the holder's `collet_size_id` —
// a real FK, not the description — and is applied in HolderPill.

export const HOLDER_DEFAULT = '#2dd4bf';  // teal — no holder, or no record yet

// Auto-assignment palette. Spread out enough that neighbouring holders in a list
// read as different at a glance.
const PALETTE = [
  '#06b6d4', '#ec4899', '#65a30d', '#8b5cf6', '#eab308', '#ef4444',
  '#10b981', '#a855f7', '#f97316', '#14b8a6', '#3b82f6', '#f43f5e',
];

// A stable colour for a record that hasn't been given one. Keyed on the record's
// id, so it is fixed for the life of the holder and survives every rename.
export function autoHolderColor(id) {
  const key = String(id ?? '');
  if (!key) return HOLDER_DEFAULT;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

// THE way to colour a holder anywhere it is drawn. Call sites hold a record (or
// a synthetic stand-in from holderForDisplay, which has no id) — this keeps them
// from each re-deriving the rule and disagreeing.
export function holderDisplayColor(holder) {
  if (holder?.color) return holder.color;
  return holder?.id ? autoHolderColor(holder.id) : HOLDER_DEFAULT;
}
