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
import {
  isNewFormatPreset, readStrategyBucket, presetStrategyLabel,
} from '../schema/camStrategies.js';
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

// ─── CAM-preset foreign key (store the id, render the name) ──────────────────
// A tool preset links to its CAM preset by a STABLE id (`material_preset_id`),
// not by the mutable display name — so renaming a CAM preset in the Materials
// editor doesn't orphan the presets pointing at it. The name shown (and the name
// pushed to Fusion via material.query / stock-materials) is always DERIVED from
// the id against the live library. Mirrors how locations/jobs/machines store ids
// and compose their label at read time.

// Find a CAM preset record by its stable id (null when absent/dangling).
export function findCamPresetById(id, materials) {
  if (!id) return null;
  return (materials?.presets || []).find(p => p.id === id) || null;
}

// The CAM-preset id a stored `material.query` refers to, ONLY when the query is
// exactly a CAM preset NAME (not an alloy/group/legacy code). Used to backfill
// the foreign key onto presets that still hold only the name, so they become
// rename-proof going forward.
export function camPresetIdForQuery(query, materials) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return null;
  const p = (materials?.presets || []).find(x => String(x.name || '').trim().toLowerCase() === q);
  return p ? p.id : null;
}

// The CAM-preset id for a query that is an OLD name of a CAM preset that has
// since been RENAMED BY APPENDING detail — "Al Wrought" → "Al Wrought - 6061+",
// "Steel Low Carbon" → "Steel Low Carbon - 1018". This is the single most common
// way a name-only link goes stale, and unlike a bare code it is not a judgement
// call, so it self-heals rather than being surfaced.
//
// Three guards, each of which a looser rule gets wrong:
//   • EXACTLY ONE candidate — "SS Austenitic" prefixes both the 304 and the
//     310/316 preset, so it is ambiguous and must never be guessed at.
//   • The match must end on a WORD BOUNDARY in the target — otherwise "P" would
//     "uniquely" resolve to "Pure Copper".
//   • At least TWO tokens — a CAM preset name is a phrase; a bare shop code
//     ("AL", "SS", "STEEL") is one token and is deliberately the user's call
//     (see bareMaterialCode). Without this, "AL" would swallow "Al Wrought …".
export function camPresetIdForRenamedQuery(query, materials) {
  const q = String(query || '').trim().toLowerCase();
  if (!q || q.split(/\s+/).length < 2) return null;
  const hits = (materials?.presets || []).filter(p => {
    const name = String(p.name || '').trim().toLowerCase();
    if (!name.startsWith(q) || name === q) return false;
    return /[\s\-,/(]/.test(name.charAt(q.length));   // appended detail, not a longer word
  });
  return hits.length === 1 ? hits[0].id : null;
}

// THE resolver: which CAM preset a tool preset points at, most-authoritative
// first. Shared by the load-time backfill and normalizeLibrary so the two can
// never disagree about what a preset links to (the "checker must compose exactly
// like the stamper" rule). Returns null when nothing is confident enough — those
// stay surfaced for the user rather than guessed at.
export function resolveCamPresetId(preset, materials) {
  if (preset?.material_preset_id) return preset.material_preset_id;
  const query = preset?.material?.query;
  const exact = camPresetIdForQuery(query, materials);
  if (exact) return exact;
  // A query that still resolves to something in the library by NAME (a group
  // label like "Stainless Steel", an alloy like "316L") displays correctly today
  // — never override it on a guess. Only genuinely dangling names heal below.
  const hit = findMaterialInLibrary(query, materials);
  if (hit.group || hit.preset || hit.alloy) return null;
  return camPresetIdFromGrade(query, materials)
    ?? camPresetIdForRenamedQuery(query, materials)
    ?? null;
}

// Refresh a preset's Fusion-facing material NAME fields (material.query +
// stock-materials) from its `material_preset_id` — the id is the source of truth,
// the name is derived live. Also adopts the id via `resolveCamPresetId` (so
// existing name-only links, including ones left stale by a CAM-preset rename,
// become rename-proof). Returns the preset unchanged when nothing resolves, or
// when the id is dangling (tolerated — the stored name is left as-is, same as any
// dangling-id reference elsewhere in the app).
export function syncPresetMaterialName(preset, materials) {
  if (!preset) return preset;
  const id = resolveCamPresetId(preset, materials);
  if (!id) return preset;
  const cam = findCamPresetById(id, materials);
  if (!cam) return preset;
  const query = cam.name;
  const category = materialCategory(query);
  const prevQuery = preset.material?.query;

  // ⚠️ `stock-materials` is only rewritten when it plainly belongs to us — the
  // SAME rule the Fusion push applies (FUSION_PRESET_PATCHERS.material), or the
  // two drift on the one field they both touch. A value that is neither the new
  // name nor the old one is a dangling reference to the replaced Fusion material
  // library: overwriting it would destroy the only evidence of it, and
  // stockMaterialIssues could never flag it.
  const stock = Array.isArray(preset['stock-materials']) ? preset['stock-materials'] : null;
  const stockIsOurs = !stock || stock.length === 0
    || (stock.length === 1 && (stock[0] === query || stock[0] === prevQuery));
  const nextStock = stockIsOurs ? [query] : stock;

  // Return the SAME reference when everything already agrees. Callers use
  // identity to decide whether there is anything to persist, so a new object per
  // load would make every tool look dirty forever and a "fix" pass could never
  // report nothing to do on its second run.
  const stockAgrees = stock && stock.length === nextStock.length
    && stock.every((s, i) => s === nextStock[i]);
  if (preset.material_preset_id === id
    && prevQuery === query
    && preset.material?.category === category
    && stockAgrees) return preset;

  return {
    ...preset,
    material_preset_id: id,
    material: { ...(preset.material || {}), query, category },
    'stock-materials': nextStock,
  };
}

// Compose the convention name for a preset against a given assembly, deriving
// every piece from the preset itself (format, operation/bucket, intensity,
// strategy label, small bore). This is the SAME composition the preset editor
// shows live — shared so a name rebuilt elsewhere (e.g. when an assembly's OOH
// or holder changes) can't drift from what the editor would produce.
export function autoPresetName(preset, assembly, materials, { isHoleMaking = false } = {}) {
  if (!preset) return '';
  const newFmt = isNewFormatPreset(preset);
  let opType = preset.operation_type ?? parsePresetName(preset.name)?.opType ?? null;
  let intensityWord = null;
  let strategyLabel = null;
  if (newFmt) {
    const rb = readStrategyBucket(preset);
    // A new-format preset's operation is its BUCKET (never the name); with an
    // empty selection the bucket is ambiguous, so keep the stored value.
    if (rb.ids.length > 0) opType = rb.bucket === 'roughing' ? 'rough' : 'finish';
    const intens = preset.intensity || 'normal';
    intensityWord = intens === 'light' ? 'Fine' : intens === 'aggressive' ? 'Fast' : null;
    strategyLabel = presetStrategyLabel(rb.ids);
  }
  return composePresetName({
    materialQuery: materialNameCode(preset.material?.query, materials),
    ooh: assembly?.ooh,
    holderShort: assembly ? holderShortName(assembly.holder_description || '') : null,
    opType: isHoleMaking ? null : opType,
    intensityWord,
    strategyLabel,
    smallBore: newFmt && !!preset.small_bore,
  });
}

// ─── The preset↔assembly link (relational integrity) ─────────────────────────
// `preset.assembly_id` is the FOREIGN KEY (metadata-only, in preset_meta —
// many presets → one assembly, so the key belongs on the preset). It is the
// authoritative link. `presetMatchesAssembly` — which parses the holder short
// name and OOH out of the preset's display NAME — is ONLY an import/legacy seed:
// Fusion has nowhere to store our FK, so the name carries the link across that
// boundary, but a formatted string is a transport format, never a join key.
// Read the FK first; fall back to the name only while a preset has no FK yet.

export function assemblyForPreset(preset, assemblies, unit = 'inches') {
  if (!preset) return null;
  const list = assemblies || [];
  if (preset.assembly_id) return list.find(a => a.assembly_id === preset.assembly_id) || null;
  return list.find(a => presetMatchesAssembly(preset, a, unit)) || null;   // legacy seed
}

export function presetsForAssembly(assembly, presets, unit = 'inches') {
  if (!assembly) return [];
  return (presets || []).filter(p => (p.assembly_id
    ? p.assembly_id === assembly.assembly_id
    : presetMatchesAssembly(p, assembly, unit)));
}

// Load-time backfill: give every preset an explicit assembly_id derived ONCE
// from the name match, so the FK becomes complete and the name stops being the
// link. Mirrors the other FK backfills — in memory at load, persisted on the
// tool's next save. Idempotent.
export function backfillPresetAssemblyLinks(tools) {
  let any = false;
  const next = (tools || []).map(t => {
    if (!t.presets?.length || !t.assemblies?.length) return t;
    let changed = false;
    const presets = t.presets.map(p => {
      if (p.assembly_id) return p;
      const a = t.assemblies.find(x => presetMatchesAssembly(p, x, t.unit));
      if (!a) return p;
      changed = true;
      return { ...p, assembly_id: a.assembly_id };
    });
    if (!changed) return t;
    any = true;
    return { ...t, presets };
  });
  // Same reference when nothing changed — keeps the load pass free of needless
  // re-renders and makes idempotency observable (mirrors the other backfills).
  return any ? next : tools;
}

// ─── Grade-based material auto-linking ───────────────────────────────────────
// The shop's legacy material strings carry the ALLOY GRADE ("AL 6061", "SS316
// FIN", "17-4 PH", "303/416"). Every grade already lives in the Materials
// library as an alloy with a `preset_id`, so a grade found in the string
// resolves to a CAM preset with high confidence — no guessing. This is
// deliberately narrower than suggestCamPresetName, which ALSO falls back to a
// bare-code default ("AL" → the wrought preset); that fallback is a judgement
// call and stays user-confirmed. Grade matches are unambiguous, so they
// self-heal silently.
//
// Because the link is the alloy's `preset_id`, renaming a CAM preset to carry
// its grades ("Al Wrought" → "Al Wrought - 6061+") changes nothing here —
// matching never reads the CAM preset's name. Adding a grade is just adding an
// alias to the alloy in the Materials editor.

// Grade-ish tokens for an alloy: anything containing a digit, from its label
// and aliases ("316 / 316L" → 316, 316L; "17-4 PH" → 17-4).
function alloyGradeTokens(alloy) {
  const out = [];
  for (const field of [alloy.label, ...(alloy.aliases || [])]) {
    for (const tok of String(field || '').split(/[\s/,]+/).filter(Boolean)) {
      if (/\d/.test(tok)) out.push(tok);
    }
  }
  return out;
}

// Does `q` contain `tok` as a grade — letters may abut it ("SS316", "AL6061"),
// but another DIGIT may not ("316" must not match inside "3160").
function containsGrade(q, tok) {
  const esc = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try { return new RegExp(`(?<!\\d)${esc}(?!\\d)`, 'i').test(q); }
  catch { return q.toLowerCase().includes(tok.toLowerCase()); }
}

// The CAM preset id a material string implies via an alloy GRADE it contains,
// or null. Longest grade wins so "316L" beats "316" and "17-4" beats "17".
// The grade index is derived purely from the Materials library, so cache it per
// library object — the load-time pass calls this once per unlinked preset and
// would otherwise rebuild + re-sort ~200 candidates every time.
const gradeIndexCache = new WeakMap();
function gradeIndex(materials) {
  const hit = gradeIndexCache.get(materials);
  if (hit) return hit;
  const presetIds = new Set((materials.presets || []).map(p => p.id));
  const candidates = [];
  for (const alloy of materials.materials || []) {
    if (!alloy.preset_id || !presetIds.has(alloy.preset_id)) continue;   // skip dangling
    for (const tok of alloyGradeTokens(alloy)) candidates.push({ tok, preset_id: alloy.preset_id });
  }
  // Longest grade first, so a short grade that prefixes a longer one can't win.
  candidates.sort((a, b) => b.tok.length - a.tok.length);
  gradeIndexCache.set(materials, candidates);
  return candidates;
}

export function camPresetIdFromGrade(query, materials) {
  const q = String(query || '').trim();
  if (!q || !materials?.materials?.length) return null;
  for (const c of gradeIndex(materials)) {
    if (containsGrade(q, c.tok)) return c.preset_id;
  }
  return null;
}

// Load-time self-heal: stamp the CAM-preset FK on any preset whose material
// string contains a recognizable alloy grade but carries no link yet. In memory
// at load, persisted on the tool's next save (mirrors the other backfills).
// Presets with no grade in their string are left alone — those stay surfaced in
// MaterialLinkBanner for the user to decide.
export function autoLinkMaterialByGrade(tools, materials) {
  if (!materials?.presets?.length) return tools;
  let any = false;
  const next = (tools || []).map(t => {
    if (!t.presets?.length) return t;
    let changed = false;
    const presets = t.presets.map(p => {
      if (p.material_preset_id) return p;
      const q = p.material?.query;
      if (!q) return p;
      const hit = findMaterialInLibrary(q, materials);
      if (hit.group || hit.preset || hit.alloy) return p;   // already resolves by name
      const id = camPresetIdFromGrade(q, materials);
      if (!id) return p;
      changed = true;
      return { ...p, material_preset_id: id };
    });
    if (!changed) return t;
    any = true;
    return { ...t, presets };
  });
  return any ? next : tools;
}

// The legacy CODE a material string reduces to when it carries NO alloy grade
// and doesn't resolve in the library — "AL FIN" → AL, "SS" → SS, "BRZ" → BRONZE.
// These are the genuinely ambiguous ones the app must never guess at: the
// library has several aluminium CAM presets (wrought / cast / high-Si), so only
// the shop knows which one a bare "AL" means. normalizeLibrary surfaces one
// picker per distinct code so the whole backlog is fixed in one decision.
// Returns null when the string has a grade, resolves already, or is unknown.
export function bareMaterialCode(query, materials) {
  const q = String(query || '').trim();
  if (!q) return null;
  const hit = findMaterialInLibrary(q, materials);
  if (hit.group || hit.preset || hit.alloy) return null;   // resolves by name
  if (camPresetIdFromGrade(q, materials)) return null;      // has a grade — unambiguous
  return matchMaterial(q);                                  // e.g. AL / SS / STEEL / null
}

// Distinct bare codes across a set of presets, each with the presets that use
// it — what the normalize modal turns into "pick your default for AL" rows.
export function bareCodeGroups(presets, materials) {
  const out = new Map();
  for (const p of presets || []) {
    if (p?.material_preset_id) continue;                    // already linked
    const code = bareMaterialCode(p?.material?.query, materials);
    if (!code) continue;
    if (!out.has(code)) out.set(code, []);
    out.get(code).push(p);
  }
  return out;
}

// Presets whose material link is BROKEN: they hold a material string that
// resolves to nothing in the Materials library and carry no CAM-preset FK id.
// The main cause is a CAM preset renamed BEFORE the id was captured (the stored
// old name can no longer be matched, so it can't self-heal — see
// syncPresetMaterialName); legacy imported strings ("AL FIN") land here too, and
// want the same fix. `suggestion` is a confident CAM-preset name to re-link to,
// or null when the user must pick. Runtime-only — nothing is auto-changed.
export function unresolvedMaterialPresets(presets, materials) {
  if (!materials?.presets?.length) return [];
  return (presets || []).reduce((out, p) => {
    const query = String(p?.material?.query || '').trim();
    if (!query || p?.material_preset_id) return out;
    // ⚠️ A preset with a material but NO CAM-preset link is flagged, full stop —
    // including one whose string resolves to a GROUP ("Steel") or an ALLOY
    // ("316L"). Those display and colour correctly, which is precisely why they
    // would otherwise stay invisible forever: they are still unlinked (not
    // rename-proof), and per the shop rule the only thing Fusion can resolve as a
    // material is a CAM preset NAME, so a group/alloy string reaches Fusion as a
    // dangling reference. `reason` lets the banner say which case it is.
    const hit = findMaterialInLibrary(query, materials);
    out.push({
      guid: p.guid,
      name: p.name || 'Unnamed preset',
      query,
      reason: hit.alloy ? 'alloy' : hit.group ? 'group' : 'unknown',
      suggestion: suggestCamPresetName(query, materials),
    });
    return out;
  }, []);
}

// ─── Fusion stock-material references that don't match our library ──────────
// SHOP RULE: the app's Materials library is the single source of material, and
// Fusion's material library is generated FROM it — one stock-material file per
// CAM preset, whose name is the CAM preset's name (see materialExport.js). The
// shop's original Fusion material library was replaced wholesale with that
// generated set, so the two are meant to match name-for-name.
//
// Fusion resolves a preset's material through `stock-materials`, BY NAME. A name
// that isn't a current CAM preset name is therefore a DANGLING reference to the
// old, deleted Fusion library — Fusion resolves it to nothing. ("SS Harder",
// "AL 6061" are the real examples.)
//
// FLAGGED, never auto-corrected — a stale assignment is a real editorial
// decision about what that preset should now cut, and the same "informed, not
// blocked" rule applies as to the material link itself. Automating a fix is
// deliberately deferred; the flag is the feature.
export function stockMaterialIssues(presets, materials) {
  const names = new Set((materials?.presets || []).map(p => String(p.name || '').trim().toLowerCase()));
  if (!names.size) return [];
  return (presets || []).reduce((out, p) => {
    const stock = Array.isArray(p?.['stock-materials']) ? p['stock-materials'] : null;
    if (!stock?.length) return out;
    const unknown = stock.filter(s => !names.has(String(s || '').trim().toLowerCase()));
    if (!unknown.length) return out;
    const cam = findCamPresetById(p.material_preset_id, materials);
    out.push({
      guid: p.guid,
      name: p.name || 'Unnamed preset',
      stock,
      unknown,
      expected: cam ? cam.name : null,   // what the preset's own CAM-preset link implies
    });
    return out;
  }, []);
}

// Walk a tool list and sync every preset's material name from its FK id — the
// load-time backfill (mirrors backfillAsmNumbers; persisted lazily on next save).
export function backfillMaterialPresetIds(tools, materials) {
  if (!materials?.presets?.length) return tools;
  return (tools || []).map(t => {
    if (!t.presets?.length) return t;
    let changed = false;
    const presets = t.presets.map(p => {
      const np = syncPresetMaterialName(p, materials);
      if (np !== p) changed = true;
      return np;
    });
    return changed ? { ...t, presets } : t;
  });
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
// The operation tail is `[<intensityWord>] <opWord> [<strategyLabel>]` —
// intensityWord ("Fine"/"Fast") goes in FRONT of Rough/Finish when the strategy
// intensity isn't normal, strategyLabel (a short group/strategy token) goes at
// the END. Both are optional; when absent the name is just the op word, exactly
// as before. Callers without strategy context (normalizeLibrary, DiffStep) omit
// them. No op word (hole-making) → no tail, so intensity/strategy are dropped.
// Small bore is its own operation in the name and REPLACES the whole tail: it
// already implies a fine finish, so "SM Bore" stands in for the intensity word,
// the Rough/Finish word, and the (necessarily Bore/Contour) strategy label —
// which would otherwise read "Fine Finish Bore". Matches the SM BORE alias in
// OP_TYPES, so it still parses back to small_bore for old-format presets.
export const SMALL_BORE_NAME_WORD = 'SM Bore';

// Is this name one WE generated (so it may be safely refreshed), or one a human
// typed (so it must be preserved)? Comparing against the currently-composed name
// can't answer that: an auto name goes STALE the moment anything it's built from
// changes (a Fusion edit, a renamed CAM preset, a different OOH), and a stale
// auto name looks exactly like a custom one. So check the name's STRUCTURE
// instead — a tail built only from tokens the composer emits (optional Fine/Fast,
// an operation word, an optional known strategy label; or the standalone
// "SM Bore") is ours. Anything else ("… - Rough Job 1042") is the user's.
export function isAutoPresetName(name, strategyLabels = []) {
  const raw = String(name || '').trim();
  if (!raw) return false;
  const sep = raw.lastIndexOf(' - ');
  if (sep < 0) return false;                       // no convention tail → custom/legacy
  let tail = raw.slice(sep + 3).trim();
  if (!tail) return false;
  if (tail.toLowerCase() === SMALL_BORE_NAME_WORD.toLowerCase()) return true;
  // Optional intensity prefix.
  const m = /^(fine|fast)\s+/i.exec(tail);
  if (m) tail = tail.slice(m[0].length);
  // Operation word (longest first so "Fine Finish" beats "Finish").
  const words = OP_TYPES.map(o => o.word).sort((a, b) => b.length - a.length);
  const word = words.find(w => tail.toLowerCase() === w.toLowerCase()
    || tail.toLowerCase().startsWith(`${w.toLowerCase()} `));
  if (!word) return false;
  const rest = tail.slice(word.length).trim();
  if (!rest) return true;                          // op word only
  // Whatever follows must be a strategy label the composer could have produced.
  return strategyLabels.some(l => l && rest.toLowerCase() === String(l).toLowerCase());
}

export function composePresetName({ materialQuery, ooh, holderShort, holderDescription, opType, intensityWord, strategyLabel, smallBore }) {
  const short = holderShort != null ? holderShort : holderShortName(holderDescription || '');
  const head = [materialToCode(materialQuery), formatOoh(ooh), short]
    .filter(s => s != null && String(s).trim() !== '')
    .join(' ');
  const word = opTypeWord(opType);
  if (!word) return head;
  if (smallBore) return `${head} - ${SMALL_BORE_NAME_WORD}`;
  const tail = [intensityWord, word, strategyLabel]
    .filter(s => s != null && String(s).trim() !== '')
    .join(' ');
  return `${head} - ${tail}`;
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
