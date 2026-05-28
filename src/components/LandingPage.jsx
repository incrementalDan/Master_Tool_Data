import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { applyFilters } from '../services/searchEngine.js';
import ToolTypeGrid from './ToolTypeGrid.jsx';
import FacetFilters from './FacetFilters.jsx';
import ToolCard from './ToolCard.jsx';

const DEBOUNCE_MS = 150;

export default function LandingPage() {
  const { tools, user, loadTools, isLoading, error } = useApp();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Restore filters from URL hash params
  const initType = searchParams.get('type') || null;
  const initQuery = searchParams.get('q') || '';
  const initFacets = (() => {
    try { return JSON.parse(searchParams.get('f') || '{}'); } catch { return {}; }
  })();

  const [textQuery, setTextQuery] = useState(initQuery);
  const [selectedType, setSelectedType] = useState(initType);
  const [facets, setFacets] = useState(initFacets);
  const [displayQuery, setDisplayQuery] = useState(initQuery);
  const debounceRef = useRef(null);

  // Persist filters to URL
  useEffect(() => {
    const params = {};
    if (selectedType) params.type = selectedType;
    if (textQuery) params.q = textQuery;
    const facetsStr = JSON.stringify(facets);
    if (facetsStr !== '{}') params.f = facetsStr;
    setSearchParams(params, { replace: true });
  }, [selectedType, textQuery, facets, setSearchParams]);

  const activeFilters = { toolType: selectedType, textQuery, facets };
  const filtered = applyFilters(tools, activeFilters);

  const handleQueryChange = useCallback((val) => {
    setDisplayQuery(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setTextQuery(val), DEBOUNCE_MS);
  }, []);

  const handleTypeSelect = (type) => {
    setSelectedType(type);
    if (!type) setFacets({});
  };

  const handleFilterChange = (newFilters) => {
    setSelectedType(newFilters.toolType);
    setFacets(newFilters.facets || {});
  };

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <span>Loading tool library…</span>
      </div>
    );
  }

  return (
    <div>
      {error && <div className="error-banner">{error}</div>}

      {/* Search bar + Add button */}
      <div className="flex items-center gap-12 mb-16">
        <div className="search-bar" style={{ flex: 1 }}>
          <SearchIcon />
          <input
            type="text"
            placeholder={`Search ${tools.length} tools…`}
            value={displayQuery}
            onChange={e => handleQueryChange(e.target.value)}
            autoFocus
          />
          {displayQuery && (
            <button
              onClick={() => { setDisplayQuery(''); setTextQuery(''); }}
              style={{ background: 'none', border: 'none', color: 'var(--text-sub)', cursor: 'pointer', fontSize: 16, padding: 0 }}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/tool/new')}>
          + Add Tool
        </button>
      </div>

      {/* Tool type grid */}
      <div className="mb-16">
        <div className="section-header">Tool Type</div>
        <ToolTypeGrid selected={selectedType} onSelect={handleTypeSelect} />
      </div>

      {/* Facet filters (shown when type selected) */}
      {selectedType && (
        <div className="mb-16">
          <FacetFilters
            tools={tools}
            activeFilters={activeFilters}
            onFilterChange={handleFilterChange}
          />
        </div>
      )}

      {/* Results */}
      <div className="flex items-center gap-8 mb-12">
        <span className="result-count">
          {filtered.length === tools.length
            ? `${tools.length} tools`
            : `${filtered.length} of ${tools.length} tools match`}
        </span>
        {(selectedType || textQuery || Object.keys(facets).length > 0) && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setSelectedType(null); setFacets({}); setTextQuery(''); setDisplayQuery(''); }}
          >
            Reset
          </button>
        )}
      </div>

      {tools.length === 0 ? (
        <EmptyLibrary onImport={() => navigate('/import')} />
      ) : filtered.length === 0 ? (
        <div className="loading-screen" style={{ minHeight: 120 }}>
          <span className="text-sub">No tools match these filters.</span>
        </div>
      ) : (
        <div className="tool-grid">
          {filtered.map(tool => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyLibrary({ onImport }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: 48 }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>📭</div>
      <h2 style={{ marginBottom: 8 }}>Library is Empty</h2>
      <p className="text-sub" style={{ marginBottom: 20 }}>
        No tools yet. Import your Fusion library or add tools manually.
      </p>
      <button className="btn btn-primary btn-lg" onClick={onImport}>
        Import Library
      </button>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--text-sub)', flexShrink: 0 }}>
      <circle cx="6.5" cy="6.5" r="4.5" />
      <path d="M10 10l3 3" />
    </svg>
  );
}
