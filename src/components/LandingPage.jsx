import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, X, Plus, LayoutGrid, List, PackageOpen, FolderOpen, GitMerge, AlertTriangle, CloudOff } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { applyFilters, matchedLegacyId, matchedComponent, matchedPurchasing, sortResults } from '../services/searchEngine.js';
import { toolNeedsAttention } from '../utils/toolConflicts.js';
import { getDefaultUnit } from '../utils/units.js';
import { machineColor } from '../utils/machineColors.js';
import {
  TOOL_STATUSES, DEFAULT_VISIBLE_STATUSES, ALL_TOOL_STATUSES, isDefaultStatusSelection,
} from '../utils/toolStatus.js';
import { toolIdSequence } from '../utils/toolIdSystem.js';
import { HolderRailIcon } from './icons/ToolTypeIcon.jsx';
import ToolTypeGrid from './ToolTypeGrid.jsx';
import FacetFilters from './FacetFilters.jsx';
import ToolCard from './ToolCard.jsx';

const DEBOUNCE_MS = 150;
const VIEW_KEY = 'tool_view_mode';
// v2: the default moved from 'updated' to 'added'. The old key is written on
// every mount, so every existing session already holds 'updated' — a new key is
// what actually delivers the new default, while still remembering a later choice.
const SORT_KEY = 'tool_sort_mode_v2';

const SORTS = {
  // Default. What you just added, at the top — the thing you most often want to
  // get back to. `created_at` alone isn't enough: a bulk import stamps one
  // timestamp across hundreds of tools (58 share a single updated_at in the real
  // library), and tied tools would fall back to library order, which reads as
  // random. So ties break on the Tool ID's shop-wide sequence number — see
  // toolIdSequence.
  added: {
    label: 'Recently added',
    fn: (a, b) => (new Date(b.created_at || 0) - new Date(a.created_at || 0))
      || (toolIdSequence(b.tool_id) - toolIdSequence(a.tool_id)),
  },
  tool_id_desc: { label: 'Tool ID ↓ (newest)', fn: (a, b) => toolIdSequence(b.tool_id) - toolIdSequence(a.tool_id) },
  updated: { label: 'Recently updated', fn: (a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0) },
  diameter_asc: { label: 'Diameter ↑', fn: (a, b) => (a.diameter || 0) - (b.diameter || 0) },
  diameter_desc: { label: 'Diameter ↓', fn: (a, b) => (b.diameter || 0) - (a.diameter || 0) },
  vendor: { label: 'Vendor A–Z', fn: (a, b) => (a.vendor || '').localeCompare(b.vendor || '') },
  description: { label: 'Description A–Z', fn: (a, b) => (a.description || '').localeCompare(b.description || '') },
};

export default function LandingPage() {
  const { tools, isLoading, error, clearLibraryLocation, shopSettings, demoMode, materials, components } = useApp();
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
  // "Needs fixing" — arrives as ?flagged=1 from the library-wide conflict banner.
  // Read straight off the URL rather than mirrored into state: the banner sits
  // ABOVE the routes, so clicking it while already on this page changes the
  // params without remounting, and a useState seeded once would ignore it.
  const flaggedOnly = searchParams.get('flagged') === '1';
  const noFusionOnly = searchParams.get('nofusion') === '1';
  const [displayQuery, setDisplayQuery] = useState(initQuery);
  const [view, setView] = useState(() => localStorage.getItem(VIEW_KEY) || 'grid');
  const [sort, setSort] = useState(() => localStorage.getItem(SORT_KEY) || 'added');
  const [exactMode, setExactMode] = useState(false);
  const debounceRef = useRef(null);

  // Diameter ±0.002" / LOC ±0.02" in inch mode; ±0.05mm / ±0.5mm in mm mode.
  // Null when exactMode is on (falls back to the tiny float epsilon = effectively exact).
  const isInch = getDefaultUnit() === 'inches';
  const tolerances = exactMode ? null : {
    diameter: isInch ? 0.002 : 0.05,
    flute_length: isInch ? 0.02 : 0.5,
  };

  // Library filter — only shown when more than one tool library is linked.
  // Lets the user narrow the merged tool list to a single source library.
  const toolLibraries = shopSettings?.tool_libraries || [];
  const [libraryFilter, setLibraryFilter] = useState({ libraryId: null });

  // Machine filter — only active when machines are configured in shop settings.
  // Initialised to the default machine (if one is set) on first load, then
  // stays as the user sets it for the session.
  const machines = shopSettings?.machines || [];
  const defaultMachineId = shopSettings?.default_machine_id || null;
  // ⚠️ Retired is OFF by default, Active + Beta ON. A retired tool is still in
  // the library and still findable — it just isn't in the way of everyday work.
  // The chip row says so plainly, and the result count names what is hidden, so
  // a tool you can't see is never mistaken for a tool that isn't there.
  const [statuses, setStatuses] = useState(DEFAULT_VISIBLE_STATUSES);
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

  // Status filters live in the URL so the view is shareable and back-able.
  const setStatusParam = useCallback((key, on) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (on) next.set(key, '1'); else next.delete(key);
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const clearStatusFilters = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('flagged');
      next.delete('nofusion');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // ?reset=1 — "clear everything, then apply". The library-wide banner promises
  // an exact count, so it asks for a clean slate: this page stays mounted when
  // the banner navigates, and any filter still set would narrow the list below
  // the number the user just clicked. The machine filter matters most — it is
  // PRE-SELECTED from the shop's default machine, so it would silently hide
  // flagged tools that don't run on it.
  //
  // The status CHIPS below deliberately do NOT send this: a filter chip should
  // compose with whatever else is selected, like every other filter here.
  const resetRequested = searchParams.get('reset') === '1';
  useEffect(() => {
    if (!resetRequested) return;
    setSelectedTypes([]);
    setFacets({});
    setTextQuery('');
    setDisplayQuery('');
    setMachineFilter({ machineId: null, strict: false });
    setLibraryFilter({ libraryId: null });
    // ⚠️ Statuses go to ALL, not to the default. The banner promises an exact
    // count taken over the WHOLE library, so leaving Retired hidden would show
    // fewer tools than the number that was just clicked — the precise failure
    // the rest of this reset exists to prevent. All three chips light up, so it
    // is visible rather than a silent widening.
    setStatuses(ALL_TOOL_STATUSES);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('reset');
      return next;
    }, { replace: true });
  }, [resetRequested, setSearchParams]);

  // Persist filters to URL
  useEffect(() => {
    // A reset is pending: this effect still sees the pre-clear state, so writing
    // now would put the filters it is about to drop straight back into the URL.
    if (resetRequested) return;
    const params = {};
    if (selectedTypes.length > 0) params.type = selectedTypes.join(',');
    if (textQuery) params.q = textQuery;
    const facetsStr = JSON.stringify(facets);
    if (facetsStr !== '{}') params.f = facetsStr;
    // Carry the status filters through — this effect rebuilds the params from
    // scratch, so omitting them would drop the filter on the next keystroke.
    if (flaggedOnly) params.flagged = '1';
    if (noFusionOnly) params.nofusion = '1';
    setSearchParams(params, { replace: true });
  }, [selectedTypes, textQuery, facets, flaggedOnly, noFusionOnly, resetRequested, setSearchParams]);

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

  // Counts for the status chips — over the WHOLE library, not the filtered set,
  // so a chip's number doesn't shift as other filters are applied.
  const attentionCount = useMemo(
    () => tools.filter(t => toolNeedsAttention(t, materials)).length, [tools, materials]);
  const noFusionCount = useMemo(
    () => tools.filter(t => t.no_fusion_link === true).length, [tools]);

  // `components` rides along so a search can match an insert tool by its parts —
  // see componentTextIndex. Reference data, not a filter (same as `materials`).
  const componentList = components?.components || [];
  const activeFilters = { toolTypes: selectedTypes, textQuery, facets, flaggedOnly, noFusionOnly, materials, components: componentList, statuses };
  const filtered = useMemo(() => {
    const unit = getDefaultUnit();
    const tols = exactMode ? null : {
      diameter: unit === 'inches' ? 0.002 : 0.05,
      flute_length: unit === 'inches' ? 0.02 : 0.5,
    };
    const result = applyFilters(
      tools, activeFilters,
      machines.length > 0 ? machineFilter : null, tols,
      toolLibraries.length > 1 ? libraryFilter : null,
    );
    // Relevance first, the chosen sort within each tier — so an exact ID match
    // reaches the top without overriding the sort the user picked.
    return sortResults(result, textQuery, SORTS[sort]?.fn || SORTS.added.fn);
  }, [tools, selectedTypes, textQuery, facets, flaggedOnly, noFusionOnly, materials, components, sort, machineFilter, machines.length, exactMode, libraryFilter, toolLibraries.length, statuses]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const hasFilters = !isDefaultStatusSelection(statuses) || selectedTypes.length > 0 || textQuery || Object.keys(facets).length > 0 || !!machineFilter.machineId || !!libraryFilter.libraryId || flaggedOnly || noFusionOnly;

  // When hide_unused_tool_types is on (default) and not in demo mode, only show
  // tool type tiles for types that have at least one tool in the library.
  const hideUnused = shopSettings?.hide_unused_tool_types ?? true;
  const allowedTypes = (!demoMode && hideUnused && tools.length > 0)
    ? new Set(tools.map(t => t.tool_type))
    : null;

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
        {/* Holders sits in the RAIL under Sync Job — deliberately not a new top
            tab. A line-art holder silhouette so it reads distinctly from Sync
            Job's chain-link at a glance. */}
        <button
          className="tool-sidebar-btn"
          onClick={() => navigate('/holders')}
          title="The app-owned holder library"
        >
          <HolderRailIcon size={22} />
          <span>Holders</span>
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

      {/* Status filters — always visible when there is something to show, so
          both states are DISCOVERABLE rather than only reachable from a banner
          that can be dismissed. Counts are over the whole library, so they stay
          a stable label rather than shifting with the other filters.

          Toggling a chip composes with everything else selected; only the
          banner's "Show them" clears first (see ?reset=1 above). */}
      {(attentionCount > 0 || noFusionCount > 0) && (
        <div className="mb-16">
          <div className="section-header">Status</div>
          <div className="flex items-center gap-8 flex-wrap">
            {attentionCount > 0 && (
              <button
                className={`chip ${flaggedOnly ? 'active' : ''}`}
                onClick={() => setStatusParam('flagged', !flaggedOnly)}
                title="Unresolved import differences, or preset materials not linked to a CAM preset"
              >
                <AlertTriangle size={13} /> Needs fixing ({attentionCount})
              </button>
            )}
            {noFusionCount > 0 && (
              <button
                className={`chip ${noFusionOnly ? 'active' : ''}`}
                onClick={() => setStatusParam('nofusion', !noFusionOnly)}
                title="Tools the app owns outright — no entry in any Fusion library"
              >
                <CloudOff size={13} /> Not in Fusion ({noFusionCount})
              </button>
            )}
          </div>
        </div>
      )}

      {/* Library filter — only when more than one tool library is linked */}
      {toolLibraries.length > 1 && (
        <div className="mb-16">
          <div className="section-header">Library</div>
          <div className="flex items-center gap-8 flex-wrap">
            <button
              className={`chip ${!libraryFilter.libraryId ? 'active' : ''}`}
              onClick={() => setLibraryFilter({ libraryId: null })}
            >
              All
            </button>
            {toolLibraries.map(lib => (
              <button
                key={lib.id}
                className={`chip ${libraryFilter.libraryId === lib.id ? 'active' : ''}`}
                onClick={() => setLibraryFilter(f => ({ libraryId: f.libraryId === lib.id ? null : lib.id }))}
                title={lib.fileName}
              >
                {lib.fileName}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Lifecycle filter. Always shown — unlike the machine row it needs no
          configuration, and it is the only thing explaining why a retired tool
          isn't in the results. */}
      <div className="mb-16">
        <div className="section-header">Status</div>
        <div className="flex items-center gap-8 flex-wrap">
          {TOOL_STATUSES.map(st => {
            const on = statuses.includes(st.id);
            return (
              <button
                key={st.id}
                className={`chip machine-chip ${on ? 'active' : ''}`}
                style={{ '--badge-color': st.color }}
                title={st.tip}
                onClick={() => setStatuses(cur => (
                  cur.includes(st.id) ? cur.filter(x => x !== st.id) : [...cur, st.id]
                ))}
              >
                {st.label}
              </button>
            );
          })}
          {/* ⚠️ Turning every status off would show NOTHING while looking like
              a filter problem. Say what is hidden instead. */}
          {statuses.length === 0 && (
            <span className="text-xs" style={{ color: 'var(--orange)' }}>
              No statuses selected — nothing can match. Pick at least one.
            </span>
          )}
          {statuses.length > 0 && TOOL_STATUSES.some(st => !statuses.includes(st.id)) && (
            <span className="text-xs text-sub">
              Hiding {TOOL_STATUSES.filter(st => !statuses.includes(st.id)).map(st => st.label).join(' + ')}
            </span>
          )}
        </div>
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
                className={`chip machine-chip ${machineFilter.machineId === m.id ? 'active' : ''}`}
                style={{ '--badge-color': machineColor(m, machines) }}
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
        <ToolTypeGrid selected={selectedTypes} onSelect={handleTypeSelect} allowedTypes={allowedTypes} />
      </div>

      {/* Facet filters (shown when at least one type selected) */}
      {selectedTypes.length > 0 && (
        <div className="mb-16">
          <FacetFilters
            tools={tools}
            activeFilters={activeFilters}
            onFilterChange={handleFilterChange}
            exactMode={exactMode}
            onExactModeChange={() => setExactMode(m => !m)}
            tolerances={tolerances}
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
            onClick={() => { setSelectedTypes([]); setFacets({}); setTextQuery(''); setDisplayQuery(''); setMachineFilter({ machineId: null, strict: false }); setLibraryFilter({ libraryId: null }); setStatuses(DEFAULT_VISIBLE_STATUSES); clearStatusFilters(); }}
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
          {filtered.map(tool => <ToolCard key={tool.id} tool={tool} variant="list" matchedLegacyId={matchedLegacyId(tool, textQuery)} matchedComponent={matchedComponent(tool, textQuery, componentList)} matchedPurchasing={matchedPurchasing(tool, textQuery)} />)}
        </div>
      ) : (
        <div className="tool-grid">
          {filtered.map(tool => <ToolCard key={tool.id} tool={tool} matchedLegacyId={matchedLegacyId(tool, textQuery)} matchedComponent={matchedComponent(tool, textQuery, componentList)} matchedPurchasing={matchedPurchasing(tool, textQuery)} />)}
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
