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
  { value: 'rough',       word: 'Rough',       aliases: ['ROUGH', 'R'] },
  { value: 'finish',      word: 'Finish',      aliases: ['FINISH', 'FIN', 'F', 'FINSH'] },
  { value: 'rough_fast',  word: 'Rough Fast',  aliases: ['ROUGH FAST', 'RF'] },
  { value: 'fine_finish', word: 'Fine Finish', aliases: ['FINE FINISH', 'FF'] },
  { value: 'small_bore',  word: 'Small Bore',  aliases: ['SMALL BORE', 'SM BORE', 'SMBORE'] },
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
  const opType = matchOpType(opStr) ?? matchOpType(raw);

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
