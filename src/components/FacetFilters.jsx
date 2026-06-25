import { useState, useRef, useEffect } from 'react';
import { getAvailableOptions } from '../services/searchEngine.js';
import { getFacetFields, FIELD_LABELS } from '../schema/toolSchema.js';
import { FIELD_REGISTRY } from '../schema/fieldRegistry.js';
import OperatorDial, { OP_SYMBOLS } from './OperatorDial.jsx';

// Short facet-specific overrides only. Fields not listed fall through to the
// central FIELD_LABELS (registry-derived, incl. the unit suffix). corner_radius
// is kept here intentionally so the compact facet omits the unit.
const FACET_LABEL = {
  number_of_flutes: 'Flutes',
  material: 'Material',
  tsc_capable: 'TSC',
  material_suitability: 'Cuts',
  corner_radius: 'Corner Radius',
  tap_sub_type: 'Sub-Type',
  is_sti: 'STI',
  tap_thread_unit: 'Thread Unit',
  cutting_direction: 'Hand',
  pitch: 'Thread Size',
  tap_class: 'Limit Tolerance',
  class_of_fit: 'Class of Fit',
};

const MULTI_SELECT_FIELDS = new Set(['flute_design']);

// Numeric facets (diameter, flute length, OAL, …) get the ≤ = ≥ operator dial —
// their filter value is { value, op } rather than a bare string. Driven by the
// field registry so any field typed `number` picks it up automatically.
function isNumericFacet(field) {
  return FIELD_REGISTRY[field]?.type === 'number';
}

function isFacetEmpty(value) {
  if (Array.isArray(value)) return value.length === 0;
  if (value !== null && typeof value === 'object') return isFacetEmpty(value.value);
  return value === '' || value === null || value === undefined;
}

export default function FacetFilters({ tools, activeFilters, onFilterChange, exactMode, onExactModeChange, tolerances }) {
  const { toolTypes, facets = {} } = activeFilters;
  const facetFields = getFacetFields(toolTypes);

  const setFacet = (field, value) => {
    const newFacets = { ...facets };
    if (isFacetEmpty(value)) {
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

  const tolTip = exactMode
    ? 'Exact match only — click to enable tolerance mode'
    : tolerances
      ? `Tolerance: ±${tolerances.diameter} dia · ±${tolerances.flute_length} LOC — click for exact match`
      : 'Tolerance mode active';

  return (
    <div className="facet-panel" style={{ position: 'relative' }}>
      <button
        className={`chip${exactMode ? ' active' : ''}`}
        onClick={onExactModeChange}
        title={tolTip}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          fontSize: 11,
          padding: '2px 8px',
          lineHeight: '1.4',
          fontFamily: 'var(--font-mono)',
          zIndex: 1,
        }}
      >
        {exactMode ? '= Exact' : '± Tol'}
      </button>
      <div className="facet-row">
        {facetFields.map(field => (
          <FacetControl
            key={field}
            field={field}
            label={FACET_LABEL[field] || FIELD_LABELS[field] || field}
            tools={tools}
            activeFilters={activeFilters}
            value={MULTI_SELECT_FIELDS.has(field) ? (facets[field] ?? []) : (facets[field] ?? '')}
            onChange={val => setFacet(field, val)}
            isMulti={MULTI_SELECT_FIELDS.has(field)}
            tolerances={tolerances}
          />
        ))}
      </div>

      {activeCount > 0 && (
        <div className="active-filters" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <span className="text-sub text-xs">Active:</span>
          {Object.entries(facets).map(([field, value]) => {
            const isOperatorValue = isNumericFacet(field) && value !== null && typeof value === 'object';
            const displayVal = isOperatorValue
              ? `${OP_SYMBOLS[value.op] || '='} ${value.value}`
              : Array.isArray(value) ? value.join(', ') : String(value);
            return (
              <span key={field} className="active-filter-tag">
                <span className="text-xs">{FACET_LABEL[field] || field}:</span>
                <strong style={{ fontSize: 12 }}>{displayVal}</strong>
                <button onClick={() => setFacet(field, Array.isArray(value) ? [] : '')} aria-label={`Remove ${field} filter`}>×</button>
              </span>
            );
          })}
          <button className="btn btn-ghost btn-sm" onClick={clearAll}>Clear all</button>
        </div>
      )}
    </div>
  );
}

function FacetControl({ field, label, tools, activeFilters, value, onChange, isMulti, tolerances }) {
  const { options, showAsChips } = getAvailableOptions(tools, activeFilters, field, tolerances);
  const numeric = isNumericFacet(field);
  // Numeric facets carry { value, op }; everything below works against the bare
  // value, with the chosen operator handled separately (see `op` below).
  const isOperatorValue = numeric && value !== null && typeof value === 'object';
  const rawValue = isOperatorValue ? (value.value ?? '') : value;

  const [inputVal, setInputVal] = useState(!isMulti && rawValue !== undefined && rawValue !== null ? String(rawValue) : '');
  const [open, setOpen] = useState(false);
  // The operator is "sticky" — it lives in local state so a chosen comparison
  // (e.g. ≥) survives the user clearing the value, rather than resetting to =.
  const [op, setOp] = useState((isOperatorValue && value.op) || '=');
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!isMulti) setInputVal(rawValue !== undefined && rawValue !== null ? String(rawValue) : '');
  }, [rawValue, isMulti]);

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const commitValue = (val) => (numeric ? { value: val, op } : val);

  const handleCommit = (val) => {
    const trimmed = val.trim();
    onChange(commitValue(trimmed === '' ? '' : trimmed));
    setOpen(false);
  };

  const handleOpChange = (newOp) => {
    setOp(newOp);
    onChange({ value: rawValue, op: newOp });
  };

  // Multi-select chip group (e.g. flute_design)
  if (isMulti && showAsChips && options.length > 0) {
    const selected = Array.isArray(value) ? value : [];
    const toggle = (opt) => {
      const next = selected.includes(opt) ? selected.filter(v => v !== opt) : [...selected, opt];
      onChange(next);
    };
    return (
      <div className="facet-item">
        <div className="facet-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {label}
          {selected.length > 0 && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 10, padding: '0 5px', lineHeight: '16px', height: 16 }}
              onClick={() => onChange([])}
            >All</button>
          )}
        </div>
        <div className="chip-group">
          {options.map(opt => (
            <button
              key={opt}
              className={`chip ${selected.includes(String(opt)) ? 'active' : ''}`}
              onClick={() => toggle(String(opt))}
            >
              {String(opt)}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Single-select chip group (e.g. tsc_capable, small option sets)
  if (!isMulti && showAsChips && options.length > 0) {
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
    String(o).toLowerCase().includes(inputVal.toLowerCase()) && String(o) !== String(rawValue)
  );

  const input = (
    <input
      className="facet-input"
      style={{
        borderColor: rawValue ? 'var(--blue)' : undefined,
        ...(numeric ? { borderLeft: 'none', borderRadius: '0 var(--radius-sm) var(--radius-sm) 0' } : {}),
      }}
      placeholder={`${options.length} available`}
      value={inputVal}
      onChange={e => { setInputVal(e.target.value); setOpen(true); }}
      onFocus={() => setOpen(true)}
      onKeyDown={e => {
        if (e.key === 'Enter') handleCommit(inputVal);
        if (e.key === 'Escape') { setOpen(false); setInputVal(String(rawValue ?? '')); }
      }}
      onBlur={() => setTimeout(() => { if (!wrapRef.current?.querySelector(':focus')) setOpen(false); }, 150)}
    />
  );

  return (
    <div className="facet-item autocomplete-wrap" ref={wrapRef}>
      <div className="facet-label">{label}</div>
      {numeric ? (
        <div style={{ display: 'flex', alignItems: 'stretch' }}>
          <OperatorDial value={op} onChange={handleOpChange} />
          {input}
        </div>
      ) : input}
      {open && filtered.length > 0 && (
        <div className="autocomplete-list">
          {filtered.slice(0, 30).map(opt => (
            <div
              key={opt}
              className="autocomplete-item"
              onMouseDown={e => { e.preventDefault(); onChange(commitValue(opt)); setInputVal(String(opt)); setOpen(false); }}
            >
              {String(opt)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
