// ─── The holder's name in a composed string ────────────────────────────────
//
// ⚠️ A HOLDER HAS ONE NAME: ITS DESCRIPTION. There is no short name, no
// abbreviation, and no override table. The app owns the holder library now, so
// the description IS the holder's identity — deriving a second, shorter name
// from it meant the same holder appeared under two spellings depending on where
// you looked, and the derivation encoded shop conventions (Nikken's "NBT"
// prefix, the "C" on an SK collet size) as regexes in code.
//
// `holderNameToken` exists as a named seam rather than inlining
// `holder_description` at each call site, so there is one obvious place to look
// when asking "what does a composed name use for the holder".
export function holderNameToken(description) {
  return String(description ?? '').trim();
}

// ⚠️ MATCHING MUST STILL RECOGNISE THE OLD SHORT FORM.
//
// Names already stored — in preset names inside Fusion, and in assembly numbers
// in metadata — carry the abbreviated form ("30-SK13-60" for
// "NBT30-SK13C-60"). Those are NOT being rewritten; they stay as they are and
// go stale, which is fine because they are a reference, not a link (the
// preset→assembly link is `assembly_id`, the holder link is `holder_id`).
//
// But `presetMatchesAssembly` still reads a name to SEED that FK for a preset
// that hasn't got one yet, so it has to accept both spellings or every
// pre-existing preset would stop matching its assembly the moment composition
// changed. Normalising both sides is how one rule covers both: it is a
// comparison tolerance, never a name generator — nothing composes from it.
//
//   "NBT30-SK13C-60"  ─┐
//                      ├─► "30-SK13-60"  (compared, never displayed or stored)
//   "30-SK13-60"      ─┘
function normalizeHolderToken(s) {
  return String(s ?? '')
    .trim()
    .replace(/^NBT/i, '')                       // Nikken's dual-contact prefix
    .replace(/(SK\d+)C(?=[^A-Za-z]|$)/gi, '$1') // the C on an SK collet size
    .trim()
    .toUpperCase();
}

// Do two holder tokens name the same holder, allowing for the retired short
// form on either side?
export function holderTokensMatch(a, b) {
  const na = normalizeHolderToken(a);
  const nb = normalizeHolderToken(b);
  return !!na && !!nb && na === nb;
}
