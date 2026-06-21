import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, X, Plus, LayoutGrid, List, PackageOpen, FolderOpen, GitMerge } from 'lucide-react';
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
  const { tools, isLoading, error, clearLibraryLocation, shopSettings } = useApp();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchRef = useRef(null);

  // Restore filters from URL hash params
  const initTypes = (searchParams.get('type') || '').split(',').filter(Boolean);
  const initQuery = searchParams.get('q') || '';
  const initFacets = (() => {
    try { return JSON.parse(searchParams.get('f') || '{}'); } catch { return {}; }
  })();

  const [textQuery, setTextQuery] = useState(initQuery);
  const [selectedTypes, setSelectedTypes] = useState(initTypes);
  const [facets, setFacets] = useState(initFacets);
  const [displayQuery, setDisplayQuery] = useState(initQuery);
  const [view, setView] = useState(() => localStorage.getItem(VIEW_KEY) || 'grid');
  const [sort, setSort] = useState(() => localStorage.getItem(SORT_KEY) || 'updated');
  const debounceRef = useRef(null);

  // Machine filter — only active when machines are configured in shop settings.
  // Initialised to the default machine (if one is set) on first load, then
  // stays as the user sets it for the session.
  const machines = shopSettings?.machines || [];
  const defaultMachineId = shopSettings?.default_machine_id || null;
  const [machineFilter, setMachineFilter] = useState({ machineId: null, strict: false });
  const machineInitialised = useRef(false);
  useEffect(() => {
    if (machineInitialised.current) return;
    if (defaultMachineId && machines.length > 0) {
      // Only pre-select if the default machine actually exists in the list.
      const exists = machines.some(m => m.id === defaultMachineId);
      if (exists) setMachineFilter({ machineId: defaultMachineId, strict: false });
    }
    machineInitialised.current = true;
  }, [defaultMachineId, machines]);

  // Persist filters to URL
  useEffect(() => {
    const params = {};
    if (selectedTypes.length > 0) params.type = selectedTypes.join(',');
    if (textQuery) params.q = textQuery;
    const facetsStr = JSON.stringify(facets);
    if (facetsStr !== '{}') params.f = facetsStr;
    setSearchParams(params, { replace: true });
  }, [selectedTypes, textQuery, facets, setSearchParams]);

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

  const activeFilters = { toolTypes: selectedTypes, textQuery, facets };
  const filtered = useMemo(() => {
    const result = applyFilters(tools, activeFilters, machines.length > 0 ? machineFilter : null);
    return [...result].sort(SORTS[sort]?.fn || SORTS.updated.fn);
  }, [tools, selectedTypes, textQuery, facets, sort, machineFilter, machines.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleQueryChange = useCallback((val) => {
    setDisplayQuery(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setTextQuery(val), DEBOUNCE_MS);
  }, []);

  // Single-select by default: clicking a type replaces the current selection
  // (clicking the already-selected sole type clears it). Shift-click is additive —
  // toggles membership in a multi-select so several types that could do the same
  // job (e.g. "flat end mill" + "bull nose end mill") can be searched at once.
  const handleTypeSelect = (type, additive = false) => {
    let next;
    if (additive) {
      next = selectedTypes.includes(type)
        ? selectedTypes.filter(t => t !== type)
        : [...selectedTypes, type];
    } else {
      // Plain click: select just this type, or clear if it's already the only one.
      next = selectedTypes.length === 1 && selectedTypes[0] === type ? [] : [type];
    }
    setSelectedTypes(next);
    if (next.length === 0) setFacets({});
  };

  const handleFilterChange = (newFilters) => {
    setSelectedTypes(newFilters.toolTypes || []);
    setFacets(newFilters.facets || {});
  };

  const hasFilters = selectedTypes.length > 0 || textQuery || Object.keys(facets).length > 0 || !!machineFilter.machineId;

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <span>Loading tool library…</span>
      </div>
    );
  }

  return (
    <div className="landing-layout">
      <aside className="landing-sidebar">
        <button
          className="tool-sidebar-btn"
          onClick={() => navigate('/merge')}
          title="Sync proven speeds & feeds from a job back to the master library"
        >
          <GitMerge size={22} />
          <span>Sync Job</span>
        </button>
      </aside>
      <div className="landing-main">
      {error && (
        <div className="error-banner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span>{error}</span>
          {/* No tools loaded + an error almost always means the library itself failed
              to load (missing/moved/permissions) — point straight at the fix rather
              than leaving the operator to guess what a raw error string means. */}
          {tools.length === 0 && (
            <button className="btn btn-secondary btn-sm" onClick={clearLibraryLocation} style={{ flexShrink: 0 }}>
              <FolderOpen size={14} /> Change library…
            </button>
          )}
        </div>
      )}

      {/* Search bar + Add button */}
      <div className="flex items-center gap-12 mb-16">
        <div className="search-bar search-bar--lg" style={{ flex: '0 1 480px' }}>
          <Search size={18} style={{ color: 'var(--text-sub)', flexShrink: 0 }} />
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
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => navigate('/tool/new')}>
          <Plus size={20} /> Add Tool
        </button>
      </div>

      {/* Machine filter — only when machines are configured in shop settings */}
      {machines.length > 0 && (
        <div className="mb-16">
          <div className="section-header">Machine</div>
          <div className="flex items-center gap-8 flex-wrap">
            <button
              className={`chip ${!machineFilter.machineId ? 'active' : ''}`}
              onClick={() => setMachineFilter({ machineId: null, strict: false })}
            >
              All
            </button>
            {machines.map(m => (
              <button
                key={m.id}
                className={`chip ${machineFilter.machineId === m.id ? 'active' : ''}`}
                onClick={() => setMachineFilter(f => ({
                  machineId: f.machineId === m.id ? null : m.id,
                  strict: f.machineId === m.id ? false : f.strict,
                }))}
              >
                {m.model}
              </button>
            ))}
            {machineFilter.machineId && (
              <label className="flex items-center gap-6 text-xs text-sub" style={{ marginLeft: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={machineFilter.strict}
                  onChange={e => setMachineFilter(f => ({ ...f, strict: e.target.checked }))}
                />
                Strict (linked only)
              </label>
            )}
          </div>
        </div>
      )}

      {/* Tool type grid — single-select by default; shift-click adds more types
          that could do the same job (e.g. flat end mill + bull nose end mill) */}
      <div className="mb-16">
        <div className="section-header">
          Tool Type
          {selectedTypes.length > 1 ? (
            <span className="text-sub text-xs" style={{ textTransform: 'none', letterSpacing: 'normal' }}>
              {' '}· {selectedTypes.length} selected
            </span>
          ) : (
            <span className="text-sub text-xs" style={{ textTransform: 'none', letterSpacing: 'normal' }}>
              {' '}· shift-click to select multiple
            </span>
          )}
        </div>
        <ToolTypeGrid selected={selectedTypes} onSelect={handleTypeSelect} />
      </div>

      {/* Facet filters (shown when at least one type selected) */}
      {selectedTypes.length > 0 && (
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
            onClick={() => { setSelectedTypes([]); setFacets({}); setTextQuery(''); setDisplayQuery(''); setMachineFilter({ machineId: null, strict: false }); }}
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
        <div className="empty-state" style={{ padding: 32 }}>
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
