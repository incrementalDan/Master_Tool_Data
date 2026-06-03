// Pure search/filter functions — no React imports

const TEXT_FIELDS = ['description', 'vendor', 'product_id', 'distributor', 'material', 'coating', 'notes', 'location', 'proshot_id', 'preferred_machine'];

export function textSearch(tools, query) {
  if (!query?.trim()) return tools;
  const q = query.toLowerCase().trim();
  return tools.filter(tool => {
    for (const field of TEXT_FIELDS) {
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
    return false;
  });
}

// activeFilters shape:
// { toolType, textQuery, facets: { diameter, number_of_flutes, flute_length, overall_length, material, coating, vendor, preferred_machine, material_suitability, tags, ... } }
export function applyFilters(tools, activeFilters) {
  let result = tools;

  if (activeFilters.textQuery) {
    result = textSearch(result, activeFilters.textQuery);
  }

  if (activeFilters.toolType) {
    result = result.filter(t => t.tool_type === activeFilters.toolType);
  }

  const facets = activeFilters.facets || {};

  for (const [field, value] of Object.entries(facets)) {
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
    } else if (!value && value !== 0) {
      continue;
    }
    result = result.filter(t => matchesFacet(t, field, value));
  }

  return result;
}

function matchesFacet(tool, field, value) {
  if (field === 'tags') {
    return Array.isArray(tool.tags) && tool.tags.includes(value);
  }
  if (field === 'material_suitability') {
    return Array.isArray(tool.material_suitability) && tool.material_suitability.includes(value);
  }
  if (field === 'flute_design') {
    // value is an array of selected designs (OR semantics); tool field is a string
    const filterValues = Array.isArray(value) ? value : [value];
    return filterValues.some(v => String(v).toLowerCase() === String(tool.flute_design || '').toLowerCase());
  }
  if (field === 'tsc_capable') {
    return value === 'Yes' ? !!tool.tsc_capable : !tool.tsc_capable;
  }
  // Numeric exact or close match
  if (['diameter', 'flute_length', 'overall_length', 'number_of_flutes', 'corner_radius'].includes(field)) {
    const tv = parseFloat(tool[field]);
    const fv = parseFloat(value);
    if (isNaN(tv) || isNaN(fv)) return false;
    if (field === 'number_of_flutes') return tv === fv;
    return Math.abs(tv - fv) < 0.00051;
  }
  return String(tool[field] || '').toLowerCase() === String(value).toLowerCase();
}

// Returns available option values for a given facet, given current filters applied to all OTHER facets
export function getAvailableOptions(tools, activeFilters, targetField) {
  // Apply all filters except the target field
  const filtersWithoutTarget = {
    ...activeFilters,
    facets: Object.fromEntries(
      Object.entries(activeFilters.facets || {}).filter(([k]) => k !== targetField)
    ),
  };

  const filtered = applyFilters(tools, filtersWithoutTarget);
  const values = new Set();

  for (const tool of filtered) {
    if (targetField === 'tags') {
      (tool.tags || []).forEach(v => v && values.add(v));
    } else if (targetField === 'material_suitability') {
      (tool.material_suitability || []).forEach(v => v && values.add(v));
    } else if (targetField === 'tsc_capable') {
      values.add(tool.tsc_capable ? 'Yes' : 'No');
    } else {
      const v = tool[targetField];
      if (v !== null && v !== undefined && v !== '') values.add(v);
    }
  }

  const sorted = [...values].sort((a, b) => {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b));
  });

  return {
    options: sorted,
    showAsChips: targetField === 'tsc_capable' || targetField === 'flute_design' || sorted.length <= 5,
  };
}

export function buildIndex(tools) {
  const fieldValues = new Map();
  const allFacetFields = ['tool_type', 'diameter', 'number_of_flutes', 'flute_length', 'overall_length', 'material', 'coating', 'vendor', 'tsc_capable', 'flute_design', 'material_suitability', 'tags', 'corner_radius'];

  for (const field of allFacetFields) {
    const values = new Set();
    for (const tool of tools) {
      if (field === 'tags') {
        (tool.tags || []).forEach(v => v && values.add(v));
      } else if (field === 'material_suitability') {
        (tool.material_suitability || []).forEach(v => v && values.add(v));
      } else if (field === 'tsc_capable') {
        values.add(tool.tsc_capable ? 'Yes' : 'No');
      } else {
        const v = tool[field];
        if (v !== null && v !== undefined && v !== '') values.add(v);
      }
    }
    fieldValues.set(field, values);
  }

  return { fieldValues, tools };
}
