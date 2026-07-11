// Pure search/filter functions — no React imports

const TEXT_FIELDS = ['description', 'vendor', 'material', 'coating', 'notes', 'location', 'tool_id', 'preferred_machine'];

// Tool-MATERIAL search synonyms (what the tool is made of — carbide/hss/cobalt/
// ceramic; see fieldRegistry.material "Tool Material"). SEARCH-ONLY: merges
// Cobalt and HSS so a query for either surfaces both, without touching the
// stored value, the facet option list, or any other field's matching.
const MATERIAL_SEARCH_SYNONYMS = [
  new Set(['cobalt', 'hss']),
];

function materialSynonymGroup(term) {
  const t = String(term || '').toLowerCase().trim();
  return MATERIAL_SEARCH_SYNONYMS.find(group => group.has(t)) || null;
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

export function textSearch(tools, query) {
  if (!query?.trim()) return tools;
  const q = query.toLowerCase().trim();
  return tools.filter(tool => {
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
    return false;
  });
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

  if (activeFilters.textQuery) {
    result = textSearch(result, activeFilters.textQuery);
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
  if (field === 'material') {
    const tv = String(tool.material || '').toLowerCase().trim();
    const v = String(value).toLowerCase().trim();
    if (tv === v) return true;
    const group = materialSynonymGroup(v);
    return group ? group.has(tv) : false;
  }
  // Numeric exact or close match (bare-value path — e.g. chip-selected small option sets)
  if (['diameter', 'flute_length', 'overall_length', 'number_of_flutes', 'corner_radius'].includes(field)) {
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
        values.add(v);
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
  const allFacetFields = ['tool_type', 'diameter', 'number_of_flutes', 'flute_length', 'overall_length', 'material', 'coating', 'vendor', 'tsc_capable', 'custom_grind', 'flute_design', 'material_suitability', 'tags', 'corner_radius'];

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
