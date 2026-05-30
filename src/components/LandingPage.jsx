import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, X, Plus, LayoutGrid, List, PackageOpen } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { applyFilters } from '../services/searchEngine.js';
import ToolTypeGrid from './ToolTypeGrid.jsx';
import FacetFilters from './FacetFilters.jsx';
import ToolCard from './ToolCard.jsx';

const DEBOUNCE_MS = 150;
const VIEW_KEY = 'tool_view_mode';
const SORT_KEY = 'tool_sort_mode';

const SORTS = {
  updated: { label: 'Recently updated', fn: (a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0) },
  diameter_asc: { label: 'Diameter ↑', fn: (a, b) => (a.diameter || 0) - (b.diameter || 0) },
  diameter_desc: { label: 'Diameter ↓', fn: (a, b) => (b.diameter || 0) - (a.diameter || 0) },
  vendor: { label: 'Vendor A–Z', fn: (a, b) => (a.vendor || '').localeCompare(b.vendor || '') },
  description: { label: 'Description A–Z', fn: (a, b) => (a.description || '').localeCompare(b.description || '') },
};

export default function LandingPage() {
  const { tools, isLoading, error } = useApp();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchRef = useRef(null);

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
  const [view, setView] = useState(() => localStorage.getItem(VIEW_KEY) || 'grid');
  const [sort, setSort] = useState(() => localStorage.getItem(SORT_KEY) || 'updated');
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

  useEffect(() => { localStorage.setItem(VIEW_KEY, view); }, [view]);
  useEffect(() => { localStorage.setItem(SORT_KEY, sort); }, [sort]);

  // "/" focuses the search bar (unless typing in a field already)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const activeFilters = { toolType: selectedType, textQuery, facets };
  const filtered = useMemo(() => {
    const result = applyFilters(tools, activeFilters);
    return [...result].sort(SORTS[sort]?.fn || SORTS.updated.fn);
  }, [tools, selectedType, textQuery, facets, sort]);

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

  const hasFilters = selectedType || textQuery || Object.keys(facets).length > 0;

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
          <Search size={16} style={{ color: 'var(--text-sub)', flexShrink: 0 }} />
          <input
            ref={searchRef}
            type="text"
            placeholder={`Search ${tools.length} tools…  ( / to focus )`}
            value={displayQuery}
            onChange={e => handleQueryChange(e.target.value)}
            autoFocus
          />
          {displayQuery && (
            <button
              onClick={() => { setDisplayQuery(''); setTextQuery(''); }}
              className="search-clear"
              aria-label="Clear search"
            >
              <X size={15} />
            </button>
          )}
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/tool/new')}>
          <Plus size={16} /> Add Tool
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

      {/* Results toolbar */}
      <div className="results-toolbar mb-12">
        <span className="result-count">
          {filtered.length === tools.length
            ? `${tools.length} tools`
            : `${filtered.length} of ${tools.length} tools match`}
        </span>
        {hasFilters && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setSelectedType(null); setFacets({}); setTextQuery(''); setDisplayQuery(''); }}
          >
            Reset
          </button>
        )}
        <span className="topbar-spacer" />
        <label className="sort-control">
          <span className="text-xs text-sub">Sort</span>
          <select className="facet-input" value={sort} onChange={e => setSort(e.target.value)}>
            {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <div className="view-toggle">
          <button className={`icon-btn ${view === 'grid' ? 'active' : ''}`} onClick={() => setView('grid')} title="Grid view">
            <LayoutGrid size={15} />
          </button>
          <button className={`icon-btn ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')} title="List view">
            <List size={15} />
          </button>
        </div>
      </div>

      {tools.length === 0 ? (
        <EmptyLibrary onImport={() => navigate('/import')} />
      ) : filtered.length === 0 ? (
        <div className="loading-screen" style={{ minHeight: 120 }}>
          <span className="text-sub">No tools match these filters.</span>
        </div>
      ) : view === 'list' ? (
        <div className="tool-list">
          {filtered.map(tool => <ToolCard key={tool.id} tool={tool} variant="list" />)}
        </div>
      ) : (
        <div className="tool-grid">
          {filtered.map(tool => <ToolCard key={tool.id} tool={tool} />)}
        </div>
      )}
    </div>
  );
}

function EmptyLibrary({ onImport }) {
  return (
    <div className="card empty-state">
      <PackageOpen size={48} strokeWidth={1.3} style={{ color: 'var(--text-sub)', marginBottom: 16 }} />
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
