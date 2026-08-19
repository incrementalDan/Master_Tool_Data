// OP colours — one colour per operation number, the same everywhere it appears.
//
// The point is to tell OP50 from OP60 from OP70 at a GLANCE, across the parts
// list, a part page, a tool list and the Where-Used panel. That only works if
// the colour is a pure function of the op number: derived per screen (by list
// position, say) the same operation would change colour from page to page and
// the whole cue would be noise.
//
// ⚠️ DISTINCT HUES, NOT SHADES. Two greens a step apart read as "the same
// thing" at the size these render, which is exactly the confusion this exists
// to prevent. Every colour below sits in its own region of the wheel, and the
// overflow palette is ordered so the FIRST few are the ones furthest from the
// fixed set — the ones most likely to be needed.
//
// The shop runs 3 ops on a typical part, could reach 10, and would never
// sensibly reach 20; 13 distinct colours covers that with room to spare.

// The ops the shop actually runs. Blue/green match the reference the shop drew.
const OP_FIXED = {
  49: '#0d9488',   // teal
  50: '#3b82f6',   // blue
  60: '#3fa84f',   // green
  70: '#e8912a',   // amber
  80: '#a855f7',   // violet
};

// Everything else, ordered so the first few are the ones furthest from the fixed
// set — a part with one unusual op should get an obviously different colour, not
// the twelfth-best one.
export const OP_PALETTE = [
  '#dc2626',   // red
  '#0891b2',   // cyan
  '#e11d8f',   // pink
  '#65a30d',   // olive
  '#4f46e5',   // indigo
  '#c026d3',   // fuchsia
  '#15803d',   // dark green
  '#0369a1',   // deep blue
  '#f472b6',   // light pink
  '#ca8a04',   // dark gold
  '#059669',   // emerald
  '#9f1239',   // maroon
];

// The op's identity for colouring: the bare token, no "OP" prefix, upper-cased.
// ⚠️ A SUFFIX MAKES A DIFFERENT OP. `OP50R` is not `OP50` — it is its own step
// in the routing, so it gets its own colour rather than inheriting one and
// looking like a duplicate of the op it sits next to.
export function opKey(op) {
  const s = String(op ?? '').trim();
  if (!s) return '';
  return s.replace(/^op\s*/i, '').toUpperCase();
}

// Stable index for a token with no fixed colour.
//
// ⚠️ A ROUND OP NUMBER IS DIVIDED BY TEN FIRST. Ops are numbered in tens, so
// indexing on the raw number collapses them: with a 12-colour palette, 10 / 130
// / 250 all land on the same entry and — worse with a shorter palette — OP10 and
// OP90 come out identical, which is the one thing this must never do. Dividing
// the round ones by ten turns 10, 20, 30, … into 1, 2, 3, … so a part's ops walk
// the palette one step at a time. A number that ISN'T round (OP55, OP59) keeps
// its full value, so two ops inside one decade still separate.
//
// A free-text step ("Soft Jaw") falls back to a character sum — still stable,
// which is what matters.
function paletteIndex(key) {
  const lead = key.match(/^(\d+)/);
  if (lead) {
    const n = Number(lead[1]);
    const base = (n >= 10 && n % 10 === 0) ? n / 10 : n;
    return base % OP_PALETTE.length;
  }
  let sum = 0;
  for (let i = 0; i < key.length; i++) sum = (sum * 31 + key.charCodeAt(i)) % 100000;
  return sum % OP_PALETTE.length;
}

// The colour for an op number. Null for a blank op — a step with no number has
// nothing to colour, and a default colour would read as a real assignment.
export function opColor(op) {
  const key = opKey(op);
  if (!key) return null;
  const fixed = OP_FIXED[key];
  if (fixed) return fixed;
  return OP_PALETTE[paletteIndex(key)];
}

// The fixed assignments, for anywhere that wants to show the legend.
export const fixedOpColors = () => ({ ...OP_FIXED });
