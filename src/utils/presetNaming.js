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

// Map a canonical material code to its ISO turning group (P/M/K/N/S/H), used to
// color-code presets from materials.json group colors. Plastics have no ISO
// group (null → no group color). Hardened steel (H) isn't produced by
// matchMaterial, so it's never auto-assigned here.
export const MATERIAL_CODE_TO_ISO_GROUP = {
  AL: 'N', BRONZE: 'N', BRASS: 'N',   // Non-ferrous
  SS: 'M',                            // Stainless
  STEEL: 'P', MILD: 'P',              // Steel
  CI: 'K',                            // Cast iron
  TI: 'S',                            // High-temp alloys
  PLASTIC: null,
};

// Resolve any material query/name to its ISO group id, or null.
export function materialIsoGroup(query) {
  const code = matchMaterial(query);
  return code ? (MATERIAL_CODE_TO_ISO_GROUP[code] ?? null) : null;
}

// Resolve a material query/name directly to its ISO-group color from a
// materials.json `groups` array, or null (unknown material / no color set).
// Single source for preset color coding across PresetPanel, AssemblyCard, and
// the Sync Job preset chips.
export function isoGroupColor(query, groups) {
  const iso = materialIsoGroup(query);
  if (!iso) return null;
  return (groups || []).find(g => g.id === iso)?.color || null;
}

// ─── Materials library resolution (the single source of material) ────────────
// materials.json is a 3-tier taxonomy:
//   groups[]    — { id, label, code, color }  (P/M/K/N/S/H + custom)
//   presets[]   — CAM presets: { id, group_id, name, code }  (the Fusion name layer)
//   materials[] — alloys: { id, group_id, preset_id, label, aliases[], code }
// A tool preset stores its material as `material.query` — normally the CAM
// preset name, but it may also be a group label or a known alloy name/alias.
// These helpers resolve that stored value back to the records it refers to.

// Find the { group, preset, alloy } a stored query refers to, most-specific
// first: alloy (label or alias) → CAM preset name → group label/id. Each level
// fills in the levels above it (an alloy yields its preset + group). Returns {}
// if nothing matches.
export function findMaterialInLibrary(query, materials) {
  const q = String(query || '').trim().toLowerCase();
  if (!q || !materials) return {};
  const groups = materials.groups || [];
  const presets = materials.presets || [];
  const alloys = materials.materials || [];
  const groupById = (id) => groups.find(g => g.id === id) || null;
  const presetById = (id) => presets.find(p => p.id === id) || null;

  // 1. Alloy by label or alias (most specific).
  const alloy = alloys.find(m =>
    String(m.label || '').trim().toLowerCase() === q ||
    (m.aliases || []).some(a => String(a).trim().toLowerCase() === q));
  if (alloy) {
    const preset = presetById(alloy.preset_id);
    const group = groupById(alloy.group_id) || (preset ? groupById(preset.group_id) : null);
    return { group, preset, alloy };
  }
  // 2. CAM preset by name.
  const preset = presets.find(p => String(p.name || '').trim().toLowerCase() === q);
  if (preset) return { group: groupById(preset.group_id), preset, alloy: null };
  // 3. Group by label or id.
  const group = groups.find(g =>
    String(g.label || '').trim().toLowerCase() === q || String(g.id || '').toLowerCase() === q) || null;
  return group ? { group, preset: null, alloy: null } : {};
}

// Short code for a preset name token, most-specific first: alloy code → CAM
// preset code → group code → group id. Falls back to the legacy keyword code
// (matchMaterial) for material strings not in the library (e.g. imported
// "AL FIN"). '' when blank.
export function materialNameCode(query, materials) {
  const { group, preset, alloy } = findMaterialInLibrary(query, materials);
  if (alloy?.code) return alloy.code;
  if (preset?.code) return preset.code;
  if (group?.code) return group.code;
  if (group?.id) return group.id;
  return matchMaterial(query) || '';
}

// Legacy material code -> a name hint identifying the shop's single default CAM
// preset for a bare code. Only unambiguous codes live here: "AL" means the
// wrought Al preset, and a bare "SS" means austenitic 316 (the shop's default
// stainless). Steel (P) is deliberately omitted — many presets, no one obvious
// default — so "Steel"/"ST" fall through to null and the user picks.
const CODE_DEFAULT_HINT = { AL: /wrought/i, SS: /austenitic 316/i };

// Suggest a CAM preset NAME to link a legacy material string to, resolved within
// the CURRENT materials library (so shop edits are respected). Confident matches
// only, tried in order:
//   1. the query already resolves to a CAM preset or a known alloy → its preset
//      (e.g. "SS316", "316L")
//   2. a grade number in the query matches an alloy's grade → its preset
//      (e.g. "316" or "316 SS" → the 316 alloy → SS Austenitic 316)
//   3. a bare legacy code with a single default (AL → Al Wrought, SS → 316)
// Returns null for everything else (e.g. "Steel", "ST") so the normalize flow
// surfaces a searchable picker for the user to choose.
export function suggestCamPresetName(query, materials) {
  const exact = findMaterialInLibrary(query, materials);
  if (exact.preset) return exact.preset.name;

  const raw = String(query || '').trim();
  if (!raw) return null;
  const presets = materials?.presets || [];
  const alloys = materials?.materials || [];
  const presetName = (id) => presets.find(p => p.id === id)?.name || null;
  const toTokens = (s) => String(s || '').toUpperCase().split(/[\s/-]+/).filter(Boolean);

  // Grade-number match: a numeric token in the query (e.g. "316", "6061")
  // matching an alloy's label/alias grade token → that alloy's CAM preset. Lets
  // a bare grade like "316" (not itself an alias) still resolve to its preset.
  const gradeTokens = toTokens(raw).filter(t => /\d/.test(t));
  for (const gt of gradeTokens) {
    const alloy = alloys.find(a =>
      [a.label, ...(a.aliases || [])].some(f => toTokens(f).includes(gt)));
    const name = alloy && presetName(alloy.preset_id);
    if (name) return name;
  }

  // Bare legacy code with a single obvious default.
  const code = matchMaterial(query);
  const hint = code ? CODE_DEFAULT_HINT[code] : null;
  if (!hint) return null;
  const iso = MATERIAL_CODE_TO_ISO_GROUP[code];
  return presets.find(p => p.group_id === iso && hint.test(p.name || ''))?.name || null;
}

// ISO-group color for a preset's stored material, resolved via the library
// first, then the legacy keyword map. null when unknown / no color.
export function presetMaterialColor(query, materials) {
  const { group } = findMaterialInLibrary(query, materials);
  if (group?.color) return group.color;
  return isoGroupColor(query, materials?.groups);
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
  // Most tokens first (so "SM BORE" beats a trailing "FIN"); then, at equal token
  // count, the longer alias string wins — the more specific token. This makes the
  // collapsed one-word form win too: "AL SMBORE FIN" → small bore, not finish
  // (SMBORE is 6 chars vs FIN 3), matching how the shop writes these.
  candidates.sort((x, y) => (y.len - x.len) || (y.alias.length - x.alias.length));
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
// 'turning boring' and 'turning threading' are newer Fusion types the app has
// no editor UI for yet — they're recognized here so a save never mangles their
// presets by treating them as milling (data-safety guard; full support later).
export const TURNING_TYPES = new Set(['turning general', 'boring head', 'turning boring', 'turning threading']);

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
