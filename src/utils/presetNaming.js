// ─── Preset naming convention ──────────────────────────────────────────────
//
// A preset's name is the durable, app-independent source of truth for which
// assembly + operation it was proven on. The convention is:
//
//     <MaterialCode> <OOH> <HolderShortName> - <Operation>
//     e.g.  "SS 2.125 30-SK13-60 - Rough"
//           "AL 1.500 30-SK20-90 - Finish"
//           "TI 0.875 30-SK13-60 w/ER16 EXT 2.2OOH - Small Bore"
//
//   - Material code: AL / SS / STEEL / MILD / BRONZE / BRASS / TI / CI / PLASTIC
//     (Fusion's preset material.query). Unknown/blank -> "GEN".
//   - OOH: stick-out in inches, fixed 3 decimals, no inch mark.
//   - Holder short name: from holderNaming.holderShortName().
//   - Operation: spelled-out word, separated by " - ".
//
// The name is authoritative on import: operation_type is parsed from it; if it
// cannot be parsed, the UI prompts the user.

import { holderShortName } from './holderNaming.js';
import { lengthEps } from './units.js';

// Material query code -> the token used in preset names. The query value Fusion
// stores already matches these codes, so the code IS the query (uppercased).
export const MATERIAL_CODES = ['AL', 'SS', 'STEEL', 'MILD', 'BRONZE', 'BRASS', 'TI', 'CI', 'PLASTIC'];

export function materialToCode(query) {
  const q = String(query || '').toUpperCase().trim();
  if (!q) return 'GEN';
  return q;
}

// Human-readable label per canonical material code.
export const MATERIAL_LABELS = {
  AL: 'Aluminum', SS: 'Stainless Steel', STEEL: 'Alloy Steel', MILD: 'Mild Steel',
  BRONZE: 'Bronze', BRASS: 'Brass', TI: 'Titanium', CI: 'Cast Iron', PLASTIC: 'Plastic',
};

// Best-effort: recognize the material from any string (a preset name or a bare
// code) and return a canonical MATERIAL_CODES value, or null if nothing matches.
// Handles the real shop codes seen in preset names — "AL", "SS316", "SS-316",
// "ST", "STEEL", "BRZ", "GF Nylon", "low carbon steel", etc. — via keyword
// substrings first, then token-level code matches (so "SS316"/"AL-150" work).
// NOTE: "BZN" is deliberately NOT mapped — it's ambiguous (brass vs a bronze
// alloy); confirm the intended material before adding it here.
export function matchMaterial(str) {
  if (!str) return null;
  const s = String(str).toUpperCase();
  // Keyword substrings (strongest signal).
  if (s.includes('STAINLESS')) return 'SS';
  if (s.includes('ALUM')) return 'AL';
  if (s.includes('TITAN')) return 'TI';
  if (s.includes('BRONZE')) return 'BRONZE';
  if (s.includes('BRASS')) return 'BRASS';
  if (/NYLON|PLASTIC|PEEK|DELRIN|ACETAL|UHMW|\bPVC\b|\bABS\b/.test(s)) return 'PLASTIC';
  if (s.includes('CAST') || (s.includes('IRON') && !s.includes('STEEL'))) return 'CI';
  if (s.includes('MILD') || s.includes('LOW CARBON')) return 'MILD';
  // Token-level codes (split on spaces/dashes). "SS316" → SS, "AL-150" → AL.
  const tokens = s.split(/[\s-]+/).filter(Boolean);
  for (const t of tokens) {
    if (t === 'SS' || /^SS\d/.test(t)) return 'SS';
    if (t === 'AL' || /^AL\d/.test(t)) return 'AL';
    if (t === 'TI' || /^TI\d/.test(t)) return 'TI';
    if (t === 'CI') return 'CI';
    if (t === 'BRZ') return 'BRONZE';
    if (t === 'BRS') return 'BRASS';
    if (t === 'ST' || t === 'STEEL') return 'STEEL';
  }
  return null;
}

// Display label for a material query/name ('Other' when unrecognized).
export function materialLabel(query) {
  const code = matchMaterial(query);
  return code ? MATERIAL_LABELS[code] : 'Other';
}

// Fusion's `tool_presetMaterialCategory` ("Filter by Type") must never be blank.
// Derive it from the preset material: a plastic material -> "plastic", any other
// (metal) material -> "metal", and no/blank material -> "all".
export const PRESET_CATEGORIES = ['all', 'metal', 'plastic'];

export function materialCategory(query) {
  const q = String(query || '').toUpperCase().trim();
  if (!q) return 'all';
  if (q.includes('PLASTIC') || q === 'PL') return 'plastic';
  return 'metal';
}

// Operation types. `value` is the canonical stored value; `word` is what goes in
// the preset name; `aliases` are accepted spellings when parsing a name.
export const OP_TYPES = [
  { value: 'rough',       word: 'Rough',       aliases: ['ROUGH', 'ROUGHING', 'R'] },
  { value: 'finish',      word: 'Finish',      aliases: ['FINISH', 'FINISHING', 'FIN', 'F', 'FINSH'] },
  { value: 'rough_fast',  word: 'Rough Fast',  aliases: ['ROUGH FAST', 'RF'] },
  { value: 'fine_finish', word: 'Fine Finish', aliases: ['FINE FINISH', 'FF'] },
  { value: 'small_bore',  word: 'Small Bore',  aliases: ['SMALL BORE', 'SM BORE', 'SMBORE', 'SMALL HOLE', 'SM HOLE', 'SMHOLE'] },
];

export function opTypeWord(value) {
  return OP_TYPES.find(o => o.value === value)?.word || '';
}

// Parse a free-text operation token into a canonical operation value, or null.
export function matchOpType(str) {
  if (!str) return null;
  const s = String(str).toUpperCase().trim();
  for (const o of OP_TYPES) {
    if (o.word.toUpperCase() === s) return o.value;
    if (o.aliases.includes(s)) return o.value;
  }
  return null;
}

// Scan a FULL preset name for an operation word appearing anywhere in it as a
// token — not just as the whole name or the " - " tail. Real Fusion presets
// embed the op among other tokens: "AL FIN", "BRZ ROUGH", "AL SM BORE",
// "GF Nylon Fine Finish", "AL-150-FIN". Tokens are split on spaces AND dashes;
// multi-word ops (e.g. "Fine Finish", "SM Bore") are checked before single-word
// ones so the more specific one wins. Single-letter aliases (R/F) match only as
// a standalone token, never inside another word (so "BRZ" never reads as "R").
export function scanOpTypeInName(name) {
  if (!name) return null;
  const norm = String(name).toUpperCase().split(/[\s-]+/).filter(Boolean).join(' ');
  if (!norm) return null;
  const candidates = [];
  for (const o of OP_TYPES) {
    for (const a of [o.word.toUpperCase(), ...o.aliases]) {
      candidates.push({ value: o.value, alias: a, len: a.trim().split(/\s+/).length });
    }
  }
  candidates.sort((x, y) => y.len - x.len); // longest (most tokens) first
  for (const c of candidates) {
    const esc = c.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:^| )${esc}(?: |$)`).test(norm)) return c.value;
  }
  return null;
}

// Format an OOH (inches) into the name token: fixed 3 decimals, no inch mark.
export function formatOoh(ooh) {
  if (ooh === null || ooh === undefined || ooh === '' || isNaN(Number(ooh))) return '';
  return Number(ooh).toFixed(3);
}

// Compose a preset name from its parts. `holderShort` is already-derived
// (call holderNaming.holderShortName on the holder description first), or pass
// `holderDescription` and it will be derived here.
export function composePresetName({ materialQuery, ooh, holderShort, holderDescription, opType }) {
  const short = holderShort != null ? holderShort : holderShortName(holderDescription || '');
  const head = [materialToCode(materialQuery), formatOoh(ooh), short]
    .filter(s => s != null && String(s).trim() !== '')
    .join(' ');
  const word = opTypeWord(opType);
  return word ? `${head} - ${word}` : head;
}

// Parse a preset name back into its parts. Tolerant: returns null only for an
// empty name; otherwise returns best-effort fields (any of which may be null).
//
// Legacy presets (pre-migration, not yet renamed to the convention above) are
// often just the bare operation word/abbreviation with no " - " separator at
// all, e.g. "Rough", "R", "Finsh", "SM Bore". If the " - " tail doesn't yield an
// operation type (or there's no separator), fall back to matching the whole
// name — this is what lets normalization auto-assign operation_type for those
// without prompting the user.
export function parsePresetName(name) {
  if (!name || !String(name).trim()) return null;
  const raw = String(name).trim();

  // Split off the operation tail on the last " - ".
  const sepIdx = raw.lastIndexOf(' - ');
  const head = sepIdx >= 0 ? raw.slice(0, sepIdx).trim() : raw;
  const opStr = sepIdx >= 0 ? raw.slice(sepIdx + 3).trim() : '';
  // Operation type: the " - " tail (the convention), then the whole name (legacy
  // bare names like "Rough"/"R"), then a token scan of the whole name (op word
  // embedded among others, e.g. "AL FIN", "BRZ ROUGH").
  const opType = matchOpType(opStr) ?? matchOpType(raw) ?? scanOpTypeInName(raw);

  const tokens = head.split(/\s+/).filter(Boolean);
  let materialCode = null;
  let ooh = null;
  let holderShort = '';

  let i = 0;
  // First token is a material code only if it is non-numeric.
  if (tokens.length && isNaN(Number(tokens[0]))) {
    materialCode = tokens[0].toUpperCase();
    i = 1;
  }
  // Next token is the OOH if numeric.
  if (tokens[i] !== undefined && !isNaN(Number(tokens[i]))) {
    ooh = Number(tokens[i]);
    i += 1;
  }
  holderShort = tokens.slice(i).join(' ');

  return { materialCode, ooh, holderShortName: holderShort, opType };
}

// Tool type sets for preset field conditioning.
// Hole-making tools don't use operation types (Rough/Finish) and have
// a different preset field set: plunge/retract feedrates instead of
// cutting feedrate/feed-per-tooth/stepdown/stepover.
export const HOLE_MAKING_TYPES = new Set([
  'drill', 'center drill', 'spot drill', 'reamer', 'counter bore', 'counter sink', 'tap',
]);

// Turning/boring tools share speed + feed-per-rev fields but no step fields.
export const TURNING_TYPES = new Set(['turning general', 'boring head']);

// Does a preset's name encode the given assembly (holder + OOH)?
// Compares the parsed holder short name (case-insensitive) and OOH. The OOH in
// the name and the assembly OOH are both in the tool's own unit; the match
// tolerance scales with that unit (≈0.0005"), so pass the tool's unit.
export function presetMatchesAssembly(preset, assembly, unit = 'inches') {
  if (!preset || !assembly) return false;
  const parsed = parsePresetName(preset.name);
  if (!parsed) return false;
  const aShort = holderShortName(assembly.holder_description || '');
  const holderOk = !!parsed.holderShortName && !!aShort &&
    parsed.holderShortName.toUpperCase() === aShort.toUpperCase();
  const oohOk = parsed.ooh != null && assembly.ooh != null &&
    Math.abs(parsed.ooh - assembly.ooh) <= lengthEps(unit);
  return holderOk && oohOk;
}
