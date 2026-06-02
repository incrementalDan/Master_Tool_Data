import { useState, useRef, useEffect } from 'react';
import { getAvailableOptions } from '../services/searchEngine.js';
import { getFacetFields, FIELD_LABELS } from '../schema/toolSchema.js';

const FACET_LABEL = {
  diameter: 'Diameter (in)',
  number_of_flutes: 'Flutes',
  flute_length: 'Flute Length (in)',
  overall_length: 'Overall Length (in)',
  material: 'Material',
  coating: 'Coating',
  vendor: 'Manufacturer',
  tsc_capable: 'TSC',
  material_suitability: 'Cuts',
  tags: 'Tags',
  corner_radius: 'Corner Radius',
  tip_angle: 'Tip Angle (°)',
  pitch: 'Thread Pitch',
};

export default function FacetFilters({ tools, activeFilters, onFilterChange }) {
  const { toolType, facets = {} } = activeFilters;
  const facetFields = getFacetFields(toolType);

  const setFacet = (field, value) => {
    const newFacets = { ...facets };
    if (value === '' || value === null || value === undefined) {
      delete newFacets[field];
    } else {
      newFacets[field] = value;
    }
    onFilterChange({ ...activeFilters, facets: newFacets });
  };

  const clearAll = () => {
    onFilterChange({ ...activeFilters, facets: {} });
  };

  const activeCount = Object.keys(facets).length;

  return (
    <div className="facet-panel">
      <div className="facet-row">
        {facetFields.map(field => (
          <FacetControl
            key={field}
            field={field}
            label={FACET_LABEL[field] || FIELD_LABELS[field] || field}
            tools={tools}
            activeFilters={activeFilters}
            value={facets[field] ?? ''}
            onChange={val => setFacet(field, val)}
          />
        ))}
      </div>

      {activeCount > 0 && (
        <div className="active-filters" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <span className="text-sub text-xs">Active:</span>
          {Object.entries(facets).map(([field, value]) => (
            <span key={field} className="active-filter-tag">
              <span className="text-xs">{FACET_LABEL[field] || field}:</span>
              <strong style={{ fontSize: 12 }}>{String(value)}</strong>
              <button onClick={() => setFacet(field, '')} aria-label={`Remove ${field} filter`}>×</button>
            </span>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={clearAll}>Clear all</button>
        </div>
      )}
    </div>
  );
}

function FacetControl({ field, label, tools, activeFilters, value, onChange }) {
  const { options, showAsChips } = getAvailableOptions(tools, activeFilters, field);
  const [inputVal, setInputVal] = useState(value !== undefined && value !== null ? String(value) : '');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    setInputVal(value !== undefined && value !== null ? String(value) : '');
  }, [value]);

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleCommit = (val) => {
    const trimmed = val.trim();
    onChange(trimmed === '' ? '' : trimmed);
    setOpen(false);
  };

  if (showAsChips && options.length > 0) {
    return (
      <div className="facet-item">
        <div className="facet-label">{label}</div>
        <div className="chip-group">
          {options.map(opt => (
            <button
              key={opt}
              className={`chip ${String(value) === String(opt) ? 'active' : ''}`}
              onClick={() => onChange(String(value) === String(opt) ? '' : opt)}
            >
              {String(opt)}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const filtered = options.filter(o =>
    String(o).toLowerCase().includes(inputVal.toLowerCase()) && String(o) !== String(value)
  );

  return (
    <div className="facet-item autocomplete-wrap" ref={wrapRef}>
      <div className="facet-label">{label}</div>
      <input
        className="facet-input"
        style={{ borderColor: value ? 'var(--blue)' : undefined }}
        placeholder={`${options.length} available`}
        value={inputVal}
        onChange={e => { setInputVal(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'Enter') handleCommit(inputVal);
          if (e.key === 'Escape') { setOpen(false); setInputVal(String(value ?? '')); }
        }}
        onBlur={() => setTimeout(() => { if (!wrapRef.current?.querySelector(':focus')) setOpen(false); }, 150)}
      />
      {open && filtered.length > 0 && (
        <div className="autocomplete-list">
          {filtered.slice(0, 30).map(opt => (
            <div
              key={opt}
              className="autocomplete-item"
              onMouseDown={e => { e.preventDefault(); onChange(opt); setInputVal(String(opt)); setOpen(false); }}
            >
              {String(opt)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
