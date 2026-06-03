// ─── Holder short-name derivation ──────────────────────────────────────────
//
// Fusion holder descriptions follow a pattern like "NBT30-SK13C-60". The shop
// refers to holders by a shortened form ("30-SK13-60") that we embed in preset
// names and assembly tags. Derivation rules:
//   1. If an exact override exists, use it.
//   2. Strip a leading "NBT" taper prefix.
//   3. Drop the trailing "C" on an SK collet-size token (SK13C -> SK13).
//   4. Keep everything else verbatim, including any " w/ER.. EXT ..OOH"
//      extension suffix.
//
// Examples:
//   NBT30-SK13C-60                       -> 30-SK13-60
//   NBT30-SK20C-90                       -> 30-SK20-90
//   NBT30-SK13C-60 w/ER16 EXT 2.2OOH     -> 30-SK13-60 w/ER16 EXT 2.2OOH

// Manual overrides for irregular holders whose description does not follow the
// NBT/SK convention. Key is the exact Fusion holder description.
export const HOLDER_SHORTNAME_OVERRIDES = {
  // 'SOME-WEIRD-HOLDER-DESC': '30-W',
};

export function holderShortName(description) {
  if (!description) return '';
  const desc = String(description).trim();
  if (HOLDER_SHORTNAME_OVERRIDES[desc]) return HOLDER_SHORTNAME_OVERRIDES[desc];

  let s = desc;
  // 2. Strip a leading "NBT" taper prefix (case-insensitive).
  s = s.replace(/^NBT/i, '');
  // 3. Drop the "C" immediately after an SK collet-size token: SK13C -> SK13.
  //    Only matches when the C is followed by a non-letter (dash, space, end).
  s = s.replace(/(SK\d+)C(?=[^A-Za-z]|$)/gi, '$1');
  return s.trim();
}
