// ToolDex UI kit — interactive screens. Composes the design-system bundle
// components. One file, well-factored; mounted by index.html.
const DS = window.ToolDexDesignSystem_d6b872;
const { Button, IconButton, SearchBar, ToolCard, ToolTypeIcon, DataBadge, Toast, Banner } = DS;
const Ic = window.KitIcons;
const TOOLS = window.TOOLDEX_TOOLS;

const fmt = (v) => v == null || v === '' ? null : (isNaN(parseFloat(v)) ? v : parseFloat(v).toFixed(4).replace(/\.?0+$/, ''));
const TYPES = ['flat end mill','ball end mill','bull nose end mill','drill','spot drill','tap','reamer','chamfer mill','counter sink','face mill','thread mill'];
const SORTS = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'diameter_asc', label: 'Diameter ↑' },
  { value: 'vendor', label: 'Vendor A–Z' },
  { value: 'description', label: 'Description A–Z' },
];

// ─── Top bar ─────────────────────────────────────────────────────────────────
function TopBar({ tab, onTab, onRefresh, spinning }) {
  const tabs = [['library','Library',Ic.Library],['materials','Materials',Ic.Flask],['vendors','Vendors',Ic.Building],['settings','Settings',Ic.Settings]];
  return (
    <header className="topbar">
      <a className="topbar-brand" onClick={() => onTab('library')}>
        <img src="../../assets/tooldex-mark.svg" alt="" />
        <span>Tool<b>Dex</b></span>
      </a>
      <nav className="topbar-tabs">
        {tabs.map(([id, label, Icon]) => (
          <a key={id} className={`topbar-tab${tab === id ? ' active' : ''}`} onClick={() => onTab(id)}>
            <Icon size={14} /> {label}
          </a>
        ))}
      </nav>
      <div className="topbar-actions">
        <IconButton title="Re-download library from Autodesk" onClick={onRefresh}>
          <Ic.Refresh size={15} style={spinning ? { animation: 'spin 1s linear infinite' } : undefined} />
        </IconButton>
      </div>
    </header>
  );
}

// ─── Library view ────────────────────────────────────────────────────────────
function LibraryView({ onOpen, notify }) {
  const [q, setQ] = React.useState('');
  const [types, setTypes] = React.useState([]);
  const [view, setView] = React.useState('grid');
  const [sort, setSort] = React.useState('updated');

  const toggleType = (t, additive) => {
    setTypes(prev => {
      if (additive) return prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t];
      return prev.length === 1 && prev[0] === t ? [] : [t];
    });
  };

  let filtered = TOOLS.filter(t => {
    if (types.length && !types.includes(t.tool_type)) return false;
    if (q) {
      const hay = `${t.description} ${t.proshop_id} ${t.vendor} ${t.tool_type}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });
  filtered = [...filtered].sort((a, b) => {
    if (sort === 'diameter_asc') return (a.diameter || 0) - (b.diameter || 0);
    if (sort === 'vendor') return (a.vendor || '').localeCompare(b.vendor || '');
    if (sort === 'description') return (a.description || '').localeCompare(b.description || '');
    return 0;
  });
  const hasFilters = types.length || q;

  return (
    <div className="landing-layout">
      <aside className="landing-sidebar">
        <button className="tool-sidebar-btn" onClick={() => notify('Opening Sync Job flow…', 'info')} title="Sync proven speeds & feeds from a job back to the master library">
          <Ic.GitMerge size={22} /><span>Sync Job</span>
        </button>
      </aside>
      <div className="landing-main">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <SearchBar value={q} onChange={setQ} placeholder={`Search ${TOOLS.length} tools…  ( / to focus )`} style={{ flex: 1 }} />
          <Button variant="primary" onClick={() => notify('Add Tool flow…', 'info')}><Ic.Plus size={16} /> Add Tool</Button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div className="section-header" style={{ marginBottom: 8 }}>
            Tool Type <span style={{ textTransform: 'none', letterSpacing: 'normal', color: 'var(--text-faint)', fontWeight: 400 }}>· {types.length > 1 ? `${types.length} selected` : 'shift-click to select multiple'}</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {TYPES.map(t => (
              <button key={t} className={`type-chip${types.includes(t) ? ' active' : ''}`} onClick={e => toggleType(t, e.shiftKey)}>
                <ToolTypeIcon type={t} size={16} /> {t.replace(/\b\w/g, c => c.toUpperCase())}
              </button>
            ))}
          </div>
        </div>

        <div className="results-toolbar" style={{ marginBottom: 12 }}>
          <span className="result-count">{filtered.length === TOOLS.length ? `${TOOLS.length} tools` : `${filtered.length} of ${TOOLS.length} tools match`}</span>
          {hasFilters ? <Button variant="ghost" size="sm" onClick={() => { setTypes([]); setQ(''); }}>Reset</Button> : null}
          <span className="topbar-spacer" />
          <label className="sort-control">
            <span style={{ fontSize: 11, color: 'var(--text-sub)' }}>Sort</span>
            <select className="field-input" value={sort} onChange={e => setSort(e.target.value)}>
              {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <div className="view-toggle">
            <IconButton title="Grid view" active={view === 'grid'} onClick={() => setView('grid')}><Ic.Grid size={15} /></IconButton>
            <IconButton title="List view" active={view === 'list'} onClick={() => setView('list')}><Ic.List size={15} /></IconButton>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state"><span style={{ color: 'var(--text-sub)' }}>No tools match these filters.</span></div>
        ) : view === 'list' ? (
          <div className="tool-list">
            {filtered.map(t => <ToolCard key={t.id} tool={t} variant="list" onOpen={() => onOpen(t.id)}
              actions={<RowActions notify={notify} />} />)}
          </div>
        ) : (
          <div className="tool-grid">
            {filtered.map(t => <ToolCard key={t.id} tool={t} onOpen={() => onOpen(t.id)}
              actions={<RowActions notify={notify} />} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function RowActions({ notify }) {
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  return (
    <div className="card-actions">
      <IconButton title="Edit" onClick={stop(() => notify('Edit tool…', 'info'))}><Ic.Pencil size={13} /></IconButton>
      <IconButton title="Duplicate" onClick={stop(() => notify('Duplicated tool', 'success'))}><Ic.Copy size={13} /></IconButton>
    </div>
  );
}

// ─── Tool detail view ──────────────────────────────────────────────────────
function ToolDetail({ tool, onBack, notify }) {
  const spec = (label, val) => val == null || val === '' ? null : (
    <div className="detail-field" key={label}>
      <span className="detail-field-label">{label}</span>
      <span className="detail-field-value">{val}</span>
    </div>
  );
  return (
    <div style={{ paddingBottom: 32 }}>
      <button className="back-link" onClick={onBack}><Ic.ChevronLeft size={16} /> Back to library</button>

      <div className="detail-header">
        <span className="detail-header-icon"><ToolTypeIcon type={tool.tool_type} size={36} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="description-badge" style={{ fontSize: 16 }}>{tool.description}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--text-sub)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{tool.tool_type}</span>
            {tool.proshop_id && <DataBadge kind="proshop" href="#">{tool.proshop_id}</DataBadge>}
            {tool.machine_tool_number != null && <DataBadge kind="machine">{String(tool.machine_tool_number)}</DataBadge>}
            {tool.location && <DataBadge kind="location">{tool.location}</DataBadge>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button variant="secondary" size="sm" onClick={() => notify('Edit tool…', 'info')}><Ic.Pencil size={13} /> Edit</Button>
          <Button variant="secondary" size="sm" onClick={() => notify('Exported to ProShop CSV', 'success')}><Ic.Download size={13} /> ProShop</Button>
        </div>
      </div>

      <div className="detail-layout">
        <div>
          <div className="panel open">
            <div className="panel-header"><span className="panel-header-icon"><Ic.Settings size={14} /></span><span className="panel-header-title">Dimensions</span></div>
            <div className="panel-body">
              <div className="detail-fields">
                {spec('Diameter', fmt(tool.diameter) && <><span className="dia">⌀</span> {fmt(tool.diameter)} {tool.unit}</>)}
                {spec('Flutes', tool.number_of_flutes)}
                {spec('LOC', fmt(tool.flute_length) && `${fmt(tool.flute_length)} ${tool.unit}`)}
                {spec('OAL', fmt(tool.overall_length) && `${fmt(tool.overall_length)} ${tool.unit}`)}
                {spec('Shank', fmt(tool.shank) && `${fmt(tool.shank)} ${tool.unit}`)}
                {spec('Corner R', fmt(tool.corner_radius))}
                {spec('Point ∠', tool.point_angle && `${tool.point_angle}°`)}
                {spec('Coating', tool.coating)}
                {spec('Vendor', tool.vendor)}
              </div>
            </div>
          </div>

          <div className="panel open">
            <div className="panel-header"><span className="panel-header-icon"><Ic.GitMerge size={14} /></span><span className="panel-header-title">Presets · Speeds &amp; Feeds</span></div>
            <div className="panel-body">
              <div className="preset-list">
                {tool.presets.map((p, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <DataBadge kind="preset" material={p.material}>{p.name}</DataBadge>
                    <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{p.material}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="panel open">
            <div className="panel-header"><span className="panel-header-icon"><Ic.Wrench size={14} /></span><span className="panel-header-title">Assemblies</span></div>
            <div className="panel-body">
              {tool.assemblies.map((a, i) => (
                <div className="assembly-row" key={i}>
                  <DataBadge kind="holder">{a.holder_description}</DataBadge>
                  <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>OOH {a.ooh.toFixed(3)} {tool.unit}</span>
                </div>
              ))}
              <Button variant="ghost" size="sm" style={{ marginTop: 4 }} onClick={() => notify('Add assembly…', 'info')}><Ic.Plus size={13} /> Add assembly</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Login view ──────────────────────────────────────────────────────────────
function LoginView({ onSignIn }) {
  return (
    <div className="login-wrap">
      <div className="login-card">
        <img className="login-mark" src="../../assets/tooldex-mark.svg" alt="ToolDex" />
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>Tool<span style={{ color: 'var(--blue)' }}>Dex</span></div>
        <p style={{ color: 'var(--text-sub)', fontSize: 14, margin: '8px 0 24px', lineHeight: 1.6 }}>Your master cutting-tool library — every tool, holder, and proven speed &amp; feed in one place.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Button variant="primary" size="lg" onClick={onSignIn} style={{ justifyContent: 'center' }}>Sign in with Autodesk</Button>
          <Button variant="secondary" onClick={onSignIn} style={{ justifyContent: 'center' }}><Ic.Upload size={15} /> Browse a local library</Button>
          <Button variant="ghost" onClick={onSignIn} style={{ justifyContent: 'center' }}><Ic.Flask size={14} /> Explore demo data</Button>
        </div>
      </div>
    </div>
  );
}

// ─── App orchestrator ──────────────────────────────────────────────────────
function App() {
  const [authed, setAuthed] = React.useState(false);
  const [tab, setTab] = React.useState('library');
  const [openId, setOpenId] = React.useState(null);
  const [spinning, setSpinning] = React.useState(false);
  const [toasts, setToasts] = React.useState([]);

  const notify = (message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2600);
  };
  const refresh = () => { setSpinning(true); setTimeout(() => { setSpinning(false); notify('Library up to date', 'success'); }, 900); };

  const openTool = TOOLS.find(t => t.id === openId);

  let body;
  if (!authed) {
    body = <LoginView onSignIn={() => setAuthed(true)} />;
  } else {
    let inner;
    if (tab !== 'library') {
      inner = <div className="page-content"><div className="card empty-state"><div style={{ color: 'var(--text-sub)' }}>The <b style={{ color: 'var(--text)' }}>{tab}</b> screen lives in the full product. This kit demonstrates the Library and Tool Detail flows.</div></div></div>;
    } else if (openTool) {
      inner = <div className="page-content"><ToolDetail tool={openTool} onBack={() => setOpenId(null)} notify={notify} /></div>;
    } else {
      inner = <LibraryView onOpen={setOpenId} notify={notify} />;
    }
    body = (
      <div className="app-shell">
        <TopBar tab={tab} onTab={(t) => { setTab(t); setOpenId(null); }} onRefresh={refresh} spinning={spinning} />
        {inner}
      </div>
    );
  }

  return (
    <>
      {body}
      <div style={{ position: 'fixed', bottom: 20, right: 20, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 2000 }}>
        {toasts.map(t => <Toast key={t.id} type={t.type} message={t.message} onDismiss={() => setToasts(x => x.filter(y => y.id !== t.id))} />)}
      </div>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
