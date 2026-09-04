// Pure search/filter functions — no React imports
import { toolNeedsAttention } from '../utils/toolConflicts.js';
import { statusOf } from '../utils/toolStatus.js';
import { convertLength, normalizeUnit } from '../utils/units.js';

const TEXT_FIELDS = ['description', 'vendor', 'material', 'coating', 'notes', 'location', 'tool_id', 'preferred_machine'];

// ID normalization — dash/space/case insensitive, matching the `normId` used by
// the ProShop photo import and component matching. So "a1" finds "A-1", and a
// part number typed with or without its punctuation still lands.
const normId = (s) => String(s ?? '').replace(/[\s-]/g, '').toUpperCase();

// ─── Purchasing numbers are searchable ──────────────────────────────────────
// An EDP#, a manufacturer part number and a vendor's own catalog number are all
// things someone types into the search box to find a tool — they are how the
// tool is identified to the people who BUY it, and on the real library that is
// 151 EDPs and 156 vendor numbers that matched nothing at all. Names are
// included too: `TEXT_FIELDS` covers the legacy top-level `vendor` string, but
// the normalized purchasing model that replaced it was never reached.
function purchasingEntries(tool) {
  const p = tool?.purchasing;
  if (!p) return [];
  const out = [];
  for (const m of p.manufacturers || []) {
    if (m?.edp) out.push({ kind: 'EDP', name: m.name || '', value: String(m.edp) });
    if (m?.mfg_num) out.push({ kind: 'MFG', name: m.name || '', value: String(m.mfg_num) });
  }
  for (const v of p.vendors || []) {
    if (v?.vendor_num) out.push({ kind: 'Vendor #', name: v.name || '', value: String(v.vendor_num) });
  }
  return out;
}

function purchasingNames(tool) {
  const p = tool?.purchasing;
  if (!p) return [];
  return [...(p.manufacturers || []), ...(p.vendors || [])].map(e => e?.name).filter(Boolean);
}

function purchasingMatches(tool, q) {
  return purchasingEntries(tool).some(e => e.value.toLowerCase().includes(q))
    || purchasingNames(tool).some(n => String(n).toLowerCase().includes(q));
}

// The purchasing number the query matched, or null — mirrors matchedLegacyId, so
// a card can say WHY it matched. Searching an EDP otherwise surfaces a tool
// whose visible text has nothing to do with what was typed.
export function matchedPurchasing(tool, query) {
  const q = query?.toLowerCase().trim();
  if (!q) return null;
  const hit = purchasingEntries(tool).find(e => e.value.toLowerCase().includes(q));
  if (!hit) return null;
  return { ...hit, label: `${hit.name ? hit.name + ' ' : ''}${hit.kind} ${hit.value}` };
}

// Tool-MATERIAL search groups (what the tool is made of — carbide/hss/cobalt/
// ceramic; see fieldRegistry.material "Tool Material").
//
// HSS and Cobalt are ONE thing to look for. Fusion has no Cobalt option at all
// (a cobalt tool is written out as hss — see toFusionMaterial), and nobody
// searching for a cobalt drill wants the HSS ones hidden, so they share a single
// facet chip labelled "HSS/Cobalt" that pulls up both. Stored values are
// untouched: a tool is still Cobalt or HSS on its own page and in Fusion.
//
// SEARCH-ONLY, and material-only — no other field's matching changes.
const MATERIAL_GROUPS = [
  { label: 'HSS/Cobalt', members: new Set(['cobalt', 'hss']) },
];

function materialSynonymGroup(term) {
  const t = String(term || '').toLowerCase().trim();
  const g = MATERIAL_GROUPS.find(x => x.members.has(t) || x.label.toLowerCase() === t);
  return g ? g.members : null;
}

// The single facet value a stored material belongs under — its group's label, or
// the value itself. Both the option LIST and the match test go through this, so
// a chip can never offer a value that then matches nothing.
export function materialFacetValue(value) {
  const t = String(value ?? '').toLowerCase().trim();
  const g = MATERIAL_GROUPS.find(x => x.members.has(t) || x.label.toLowerCase() === t);
  return g ? g.label : value;
}

// True if a tool's `material` value should match search term `q` — exact
// substring match, or (Cobalt/HSS only) a cross-synonym substring match.
function materialMatchesQuery(toolMaterial, q) {
  const tv = String(toolMaterial || '').toLowerCase();
  if (tv.includes(q)) return true;
  const group = materialSynonymGroup(q);
  return group ? [...group].some(term => term !== q && tv.includes(term)) : false;
}

// The first legacy (retired) ID of `tool` that the search query matched, or null.
// Used to show a "formerly …" line on a result card ONLY when the match was on a
// legacy ID (never otherwise).
export function matchedLegacyId(tool, query) {
  const q = query?.toLowerCase().trim();
  if (!q || !Array.isArray(tool?.legacy_ids)) return null;
  return tool.legacy_ids.find(l => String(l).toLowerCase().includes(q)) || null;
}

// The first legacy (retired) location string of `tool` that the query matched,
// or null. Mirror of matchedLegacyId for the Location System — lets an old
// free-text cabinet string still surface the tool even after normalization.
export function matchedLegacyLocation(tool, query) {
  const q = query?.toLowerCase().trim();
  if (!q || !Array.isArray(tool?.legacy_locations)) return null;
  return tool.legacy_locations.find(l => String(l).toLowerCase().includes(q)) || null;
}

// The first retired assembly number (across any of the tool's assemblies) that
// the query matched, or null. Mirror of matchedLegacyId for the Assembly ID
// System — lets an old ProShop RTA#/ERP id still surface the tool after a renumber.
export function matchedLegacyAsmNumber(tool, query) {
  const q = query?.toLowerCase().trim();
  if (!q || !Array.isArray(tool?.assemblies)) return null;
  for (const a of tool.assemblies) {
    const hit = (a.legacy_asm_numbers || []).find(l => String(l).toLowerCase().includes(q));
    if (hit) return hit;
  }
  return null;
}

// ─── Components are searchable through the tool that pairs them ─────────────
// A component (an insert tool's holder body / insert) is a real object the shop
// buys and looks up by its own ProShop number, so it MUST be findable. It has no
// page of its own by design — its location, photo and purchasing are edited on
// the insert tool that pairs it — so its text is folded into that tool's
// searchable text rather than becoming a separate result that leads nowhere.
//
// Returns Map(toolId -> lowercased blob of its components' searchable text).
export function componentTextIndex(tools, components) {
  const byId = new Map();
  for (const c of components || []) if (c?.id) byId.set(c.id, c);
  const out = new Map();
  for (const t of tools || []) {
    const p = t.pairing;
    if (!p) continue;
    const parts = [];
    for (const cid of [p.holder_component_id, p.insert_component_id]) {
      const c = cid ? byId.get(cid) : null;
      if (!c) continue;
      parts.push(c.tool_id, c.description, c.designation, c.location, c.notes);
    }
    const blob = parts.filter(Boolean).join(' ').toLowerCase();
    if (blob) out.set(t.id, blob);
  }
  return out;
}

// The component of `tool` whose text the query matched, or null — mirrors
// matchedLegacyId, so a result card can say WHY it matched when the hit was on a
// part rather than the tool itself.
export function matchedComponent(tool, query, components) {
  const q = query?.toLowerCase().trim();
  const p = tool?.pairing;
  if (!q || !p) return null;
  const byId = new Map((components || []).filter(c => c?.id).map(c => [c.id, c]));
  for (const cid of [p.holder_component_id, p.insert_component_id]) {
    const c = cid ? byId.get(cid) : null;
    if (!c) continue;
    const blob = [c.tool_id, c.description, c.designation, c.location, c.notes]
      .filter(Boolean).join(' ').toLowerCase();
    if (blob.includes(q)) return c;
  }
  return null;
}

// ─── A typed DIAMETER matches the NUMBER, not the description text ──────────
// Searching by size is the most natural thing to type, and it used to work only
// by accident — `TEXT_FIELDS` is a substring scan, so a diameter was found only
// when the description happened to spell it that way. Measured on the real
// 302-tool library: 86% of tools could not be found by their exact stored
// diameter, and 55% by ANY plausible decimal spelling, because their
// description says "1/2" or "5/16" rather than a decimal. Typing ".2362"
// returned nothing at all.
//
// ⚠️ This is ADDITIVE — a numeric hit is one more way to match, never a filter
// on top of the text scan. Typing "3" still finds everything it always did.
//
// The tolerance mirrors the landing page's own diameter facet (0.002in), which
// is what makes a typed value forgive the last digit: the spot drill stored at
// .2362 is described as ".236", and both now find it.
const DIA_TOL = { inches: 0.002, millimeters: 0.05 };

// Only a query that is ENTIRELY a number is read as a diameter. A parseFloat of
// the whole query would read "3fl" as 3 and "1218" as a size, quietly widening
// every word search into a numeric one.
const NUMERIC_QUERY = /^\d*\.?\d+$/;

// A number the user typed carries no unit, so it is tried BOTH ways against the
// tool's own unit — the app has no hidden inches canonical, every length is in
// its record's unit, and conversion happens only here at the boundary (see
// "Units"). So ".2362" and "6" both find a 6mm tool, whichever unit it is
// stored in, which is the case that raised this: a metric-sized tool stored in
// inches could be found by its mm name and not by its inch diameter.
export function diameterMatches(tool, query) {
  const q = String(query ?? '').trim();
  if (!NUMERIC_QUERY.test(q)) return false;
  const typed = parseFloat(q);
  if (!Number.isFinite(typed) || typed <= 0) return false;

  const dia = tool?.diameter;
  if (typeof dia !== 'number' || !Number.isFinite(dia)) return false;

  // normalizeUnit always answers 'inches' or 'millimeters', so a tool with no
  // unit of its own reads as inches — the same fallback every length uses.
  const unit = normalizeUnit(tool?.unit);
  const tol = DIA_TOL[unit];
  // As inches, and as millimetres — each converted into the tool's own unit.
  return ['inches', 'millimeters'].some(from =>
    Math.abs(dia - convertLength(typed, from, unit)) <= tol);
}

export function textSearch(tools, query, componentText = null) {
  if (!query?.trim()) return tools;
  const q = query.toLowerCase().trim();
  return tools.filter(tool => {
    // A hit on one of this tool's components counts as a hit on the tool.
    if (componentText?.get(tool.id)?.includes(q)) return true;
    for (const field of TEXT_FIELDS) {
      if (field === 'material') {
        if (materialMatchesQuery(tool.material, q)) return true;
        continue;
      }
      if (String(tool[field] || '').toLowerCase().includes(q)) return true;
    }
    // Machine tool number — match the bare number ("31") or the "T31" form.
    const mtn = tool.machine_tool_number;
    if (mtn !== null && mtn !== undefined && mtn !== '') {
      const s = String(mtn).toLowerCase();
      if (s.includes(q) || `t${s}`.includes(q)) return true;
    }
    if (Array.isArray(tool.tags) && tool.tags.some(t => t.toLowerCase().includes(q))) return true;
    if (Array.isArray(tool.material_suitability) && tool.material_suitability.some(m => m.toLowerCase().includes(q))) return true;
    // Legacy (retired) tool IDs — so an old job number still finds the tool.
    if (Array.isArray(tool.legacy_ids) && tool.legacy_ids.some(l => String(l).toLowerCase().includes(q))) return true;
    // Legacy (retired) free-text locations — so an old cabinet string still finds it.
    if (Array.isArray(tool.legacy_locations) && tool.legacy_locations.some(l => String(l).toLowerCase().includes(q))) return true;
    // Assembly numbers (current + retired) — so an assembly ID / old RTA# finds the tool.
    if (Array.isArray(tool.assemblies) && tool.assemblies.some(a =>
      String(a.asm_number || '').toLowerCase().includes(q)
      || (a.legacy_asm_numbers || []).some(l => String(l).toLowerCase().includes(q)))) return true;
    // Purchasing numbers + manufacturer/vendor names (EDP#, MFG#, Vendor #).
    if (purchasingMatches(tool, q)) return true;
    // Tool ID with punctuation normalized away, so "a1" finds "A-1".
    if (tool.tool_id && normId(tool.tool_id).includes(normId(q))) return true;
    // A bare number is also tried as a diameter, in inches and in mm.
    if (diameterMatches(tool, q)) return true;
    return false;
  });
}

// ─── Relevance ──────────────────────────────────────────────────────────────
// ⚠️ `textSearch` is a FILTER — it answers "does this match" and preserves the
// incoming order, which is whatever the sort dropdown says. So an exact hit had
// no way to reach the top: typing "A-1" matched 33 tools on the real library
// (A-1, A-11, A-101, A-123 …) and the one tool actually called A-1 sat wherever
// "Recently added" happened to put it. Substring matching is right for finding
// things; it just can't rank them.
//
// Deliberately a TIER, not a score. It composes with the user's chosen sort
// rather than replacing it — pick "Diameter ↑" and you still get diameter
// order, with the exact match lifted out to the top. A score would silently
// override a sort the user explicitly selected.
export const RELEVANCE = { EXACT_ID: 0, ID_PREFIX: 1, OTHER: 2 };

// Every identifier an exact match could land on. A tool has several and any of
// them being typed in full is an unambiguous "I want THIS tool".
function exactIdentifiers(tool) {
  const ids = [tool?.tool_id, ...(tool?.legacy_ids || [])];
  for (const a of tool?.assemblies || []) {
    ids.push(a?.asm_number, ...(a?.legacy_asm_numbers || []));
  }
  for (const e of purchasingEntries(tool)) ids.push(e.value);
  const mtn = tool?.machine_tool_number;
  if (mtn !== null && mtn !== undefined && mtn !== '') ids.push(String(mtn), `T${mtn}`);
  return ids.filter(v => v !== null && v !== undefined && v !== '');
}

export function relevanceTier(tool, query) {
  const q = normId(query);
  if (!q) return RELEVANCE.OTHER;
  if (exactIdentifiers(tool).some(v => normId(v) === q)) return RELEVANCE.EXACT_ID;
  if (tool?.tool_id && normId(tool.tool_id).startsWith(q)) return RELEVANCE.ID_PREFIX;
  return RELEVANCE.OTHER;
}

// Sort `tools` by relevance to `query`, breaking ties with `sortFn` (the user's
// chosen sort). With no query this is exactly `sortFn` — relevance never
// reorders an unsearched library.
export function sortResults(tools, query, sortFn) {
  const list = [...(tools || [])];
  if (!query?.trim()) return list.sort(sortFn);
  // Tiers are computed ONCE per tool, not inside the comparator — a comparator
  // is called O(n log n) times and each tier walks the tool's assemblies and
  // purchasing rows.
  const tier = new Map(list.map(t => [t, relevanceTier(t, query)]));
  return list.sort((a, b) => (tier.get(a) - tier.get(b)) || sortFn(a, b));
}

// A numeric facet's filter value (diameter, flute length, OAL, …) — set via the
// ≤ = ≥ operator dial in FacetFilters — is shaped { value, op } rather than a
// bare string. Detected structurally (not by importing the field registry) to
// keep this module schema-independent, per the header note above.
function isOperatorFilter(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && 'op' in value;
}

function matchesNumericFacet(toolValue, filter, tol = null) {
  const tv = parseFloat(toolValue);
  const fv = parseFloat(filter.value);
  if (isNaN(tv) || isNaN(fv)) return false;
  if (filter.op === '>=') return tv >= fv;
  if (filter.op === '<=') return tv <= fv;
  const epsilon = tol != null ? tol : 0.00051; // '=' with configurable tolerance
  return Math.abs(tv - fv) <= epsilon;
}

// activeFilters shape:
// { toolTypes, textQuery, facets: { diameter, number_of_flutes, flute_length, overall_length, material, coating, vendor, preferred_machine, material_suitability, tags, ... } }
// toolTypes is an array — empty/absent means "any type". Numeric facets are { value, op }
// objects (see isOperatorFilter); everything else is a bare string/array.
// tolerances: optional { diameter: number, flute_length: number } — per-field tolerance
// applied when op is '='. Null/absent = tiny float epsilon (effectively exact).
// libraryFilter: optional { libraryId } — when set, keep only tools from that
// source library (multi-library support; tools are tagged with library_id on load).
export function applyFilters(tools, activeFilters, machineFilter = null, tolerances = null, libraryFilter = null) {
  let result = tools;

  if (libraryFilter?.libraryId) {
    result = result.filter(t => t.library_id === libraryFilter.libraryId);
  }

  // "Needs fixing" — the tools counted by the library-wide banner: unresolved
  // import differences, plus preset materials that aren't linked to a CAM preset.
  // Uses the SAME predicate the banner counts with, so clicking through can
  // never land on a different number than the one advertised.
  if (activeFilters.flaggedOnly) {
    result = result.filter(t => toolNeedsAttention(t, activeFilters.materials));
  }

  // Tools the app owns outright, with no entry in any Fusion library. A distinct
  // STATE, not an error — hence its own filter rather than a share of the one
  // above (see toolAttentionCount).
  if (activeFilters.noFusionOnly) {
    result = result.filter(t => t.no_fusion_link === true);
  }

  // Lifecycle. ⚠️ An ABSENT `statuses` means no filtering at all — every caller
  // that doesn't know about status (the link picker, the merge flow, anything
  // that searches to FIND a specific tool) must keep seeing the whole library.
  // Hiding a retired tool from a lookup would read as the tool being gone.
  if (Array.isArray(activeFilters.statuses) && activeFilters.statuses.length) {
    const want = new Set(activeFilters.statuses);
    result = result.filter(t => want.has(statusOf(t)));
  }

  if (activeFilters.textQuery) {
    result = textSearch(result, activeFilters.textQuery, componentTextIndex(tools, activeFilters.components));
  }

  if (activeFilters.toolTypes?.length) {
    result = result.filter(t => activeFilters.toolTypes.includes(t.tool_type));
  }

  const facets = activeFilters.facets || {};

  for (const [field, value] of Object.entries(facets)) {
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
    } else if (isOperatorFilter(value)) {
      if (!value.value && value.value !== 0) continue;
    } else if (!value && value !== 0) {
      continue;
    }
    result = result.filter(t => matchesFacet(t, field, value, tolerances));
  }

  if (machineFilter?.machineId) {
    const { machineId, strict } = machineFilter;
    result = result.filter(t => {
      const presets = t.presets || [];
      const hasLinked = presets.some(p => p.machine_id === machineId);
      if (strict) return hasLinked;
      // Default: show linked + tools with no machine-linked presets at all.
      const hasAnyMachineLink = presets.some(p => p.machine_id);
      return hasLinked || !hasAnyMachineLink;
    });
  }

  return result;
}

function matchesFacet(tool, field, value, tolerances = null) {
  // Operator filters ({ value, op }) are always single-valued (the numeric dial).
  if (isOperatorFilter(value)) {
    return matchesNumericFacet(tool[field], value, tolerances?.[field] ?? null);
  }
  // Any facet may hold an array of selected values (multi-select chips) — OR them.
  if (Array.isArray(value)) {
    return value.some(v => matchesFacetSingle(tool, field, v, tolerances));
  }
  return matchesFacetSingle(tool, field, value, tolerances);
}

// Match a tool against a single bare facet value for `field`.
function matchesFacetSingle(tool, field, value, tolerances = null) {
  if (field === 'tags') {
    return Array.isArray(tool.tags) && tool.tags.includes(value);
  }
  if (field === 'material_suitability') {
    return Array.isArray(tool.material_suitability) && tool.material_suitability.includes(value);
  }
  if (field === 'flute_design') {
    return String(value).toLowerCase() === String(tool.flute_design || '').toLowerCase();
  }
  // Compared as GROUPS, so the "HSS/Cobalt" chip matches both stored values —
  // and so does picking plain "hss" or "cobalt" from a URL or a saved filter.
  if (field === 'material') {
    return String(materialFacetValue(tool.material) ?? '').toLowerCase().trim()
      === String(materialFacetValue(value) ?? '').toLowerCase().trim();
  }
  // Numeric exact or close match (bare-value path — e.g. chip-selected small option sets)
  if (['diameter', 'flute_length', 'overall_length', 'number_of_flutes', 'corner_radius', 'reach'].includes(field)) {
    const tv = parseFloat(tool[field]);
    const fv = parseFloat(value);
    if (isNaN(tv) || isNaN(fv)) return false;
    if (field === 'number_of_flutes') return tv === fv;
    const tol = tolerances?.[field] ?? 0.00051;
    return Math.abs(tv - fv) <= tol;
  }
  // Boolean fields (e.g. tsc_capable, is_sti) are surfaced as Yes/No options.
  if (typeof tool[field] === 'boolean') {
    return value === 'Yes' ? tool[field] === true : tool[field] !== true;
  }
  return String(tool[field] || '').toLowerCase() === String(value).toLowerCase();
}

// Returns available option values for a given facet, given current filters applied to all OTHER facets
export function getAvailableOptions(tools, activeFilters, targetField, tolerances = null) {
  // Apply all filters except the target field
  const filtersWithoutTarget = {
    ...activeFilters,
    facets: Object.fromEntries(
      Object.entries(activeFilters.facets || {}).filter(([k]) => k !== targetField)
    ),
  };

  const filtered = applyFilters(tools, filtersWithoutTarget, null, tolerances);
  const values = new Set();

  for (const tool of filtered) {
    if (targetField === 'tags') {
      (tool.tags || []).forEach(v => v && values.add(v));
    } else if (targetField === 'material_suitability') {
      (tool.material_suitability || []).forEach(v => v && values.add(v));
    } else {
      const v = tool[targetField];
      if (typeof v === 'boolean') {
        values.add(v ? 'Yes' : 'No');
      } else if (v !== null && v !== undefined && v !== '') {
        // Grouped materials collapse to ONE option ("HSS/Cobalt") rather than
        // two chips that each pull up the same set of tools.
        values.add(targetField === 'material' ? materialFacetValue(v) : v);
      }
    }
  }

  const sorted = [...values].sort((a, b) => {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b));
  });

  return {
    options: sorted,
    showAsChips: targetField === 'flute_design' || sorted.length <= 5,
  };
}

export function buildIndex(tools) {
  const fieldValues = new Map();
  const allFacetFields = ['tool_type', 'diameter', 'number_of_flutes', 'flute_length', 'overall_length', 'reach', 'has_undercut', 'material', 'coating', 'vendor', 'tsc_capable', 'custom_grind', 'flute_design', 'material_suitability', 'tags', 'corner_radius'];

  for (const field of allFacetFields) {
    const values = new Set();
    for (const tool of tools) {
      if (field === 'tags') {
        (tool.tags || []).forEach(v => v && values.add(v));
      } else if (field === 'material_suitability') {
        (tool.material_suitability || []).forEach(v => v && values.add(v));
      } else if (typeof tool[field] === 'boolean') {
        values.add(tool[field] ? 'Yes' : 'No');
      } else {
        const v = tool[field];
        if (v !== null && v !== undefined && v !== '') values.add(v);
      }
    }
    fieldValues.set(field, values);
  }

  return { fieldValues, tools };
}
