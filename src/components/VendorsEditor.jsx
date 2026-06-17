import { useState, useMemo } from 'react';
import { Building2, Plus, X, ChevronDown, ChevronRight, Search, ArrowDownAZ, ArrowUpAZ } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';

function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'v-' + Math.random().toString(36).slice(2, 10);
}

// Preview a URL pattern with placeholder numbers, so the user sees the shape.
function previewUrl(pattern) {
  if (!pattern) return '';
  return pattern.replace(/\{edp\}/g, '12345').replace(/\{edp_lower\}/g, 'abc12').replace(/\{vendor_num\}/g, '99887766');
}

// Role toggle pill. `role` ('mfg' | 'vendor') drives the active background color
// (scoped to this page via the .vendor-role-pill classes in index.css).
function RolePill({ active, label, role, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className={`chip vendor-role-pill ${role}${active ? ' active' : ''}`}
      title={`Toggle ${label}`}
    >
      {label}
    </button>
  );
}

export default function VendorsEditor() {
  const { vendorRegistry, saveVendorRegistry, googleAuthenticated } = useApp();

  const [doc, setDoc] = useState(() => ({
    version: vendorRegistry?.version ?? 1,
    entities: [...(vendorRegistry?.entities || [])],
  }));
  const [savingMsg, setSavingMsg] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');   // all | mfg | vendor
  const [sortDir, setSortDir] = useState('asc');         // asc | desc (alphabetical)
  const [aliasDraft, setAliasDraft] = useState({});      // id → raw comma string while editing

  const commit = async (next) => {
    setDoc(next);
    try {
      setSavingMsg('Saving…');
      await saveVendorRegistry(next);
      setSavingMsg('Saved');
      setTimeout(() => setSavingMsg(''), 1200);
    } catch {
      setSavingMsg('Save failed');
    }
  };

  const setEntity = (id, patch) =>
    commit({ ...doc, entities: doc.entities.map(e => e.id === id ? { ...e, ...patch } : e) });
  const deleteEntity = (id, name) => {
    if (!confirm(`Delete "${name}"? Tools referencing it keep the stored name.`)) return;
    commit({ ...doc, entities: doc.entities.filter(e => e.id !== id) });
  };
  const addEntity = () => {
    const e = { id: uid(), name: '', aliases: [], is_manufacturer: true, is_vendor: false, has_own_catalog_number: false, edp_url_pattern: null, vendor_num_url_pattern: null, proshop_id: null, order: doc.entities.length };
    commit({ ...doc, entities: [...doc.entities, e] });
    setExpanded(e.id);
    setSearch('');
  };

  // Filtered + sorted view. Edits still target doc.entities by id, so filtering
  // never affects what gets saved.
  const view = useMemo(() => {
    const q = search.toLowerCase().trim();
    const list = doc.entities.filter(e => {
      if (roleFilter === 'mfg' && !e.is_manufacturer) return false;
      if (roleFilter === 'vendor' && !e.is_vendor) return false;
      if (q) {
        const hay = [e.name, ...(e.aliases || [])].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    list.sort((a, b) => {
      const c = (a.name || '').localeCompare(b.name || '');
      return sortDir === 'asc' ? c : -c;
    });
    return list;
  }, [doc.entities, search, roleFilter, sortDir]);

  return (
    <div>
      <div className="flex items-center gap-8 mb-20">
        <h2 style={{ fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Building2 size={16} /> Vendors &amp; Manufacturers
        </h2>
        <span className="text-sub text-sm">{savingMsg}</span>
      </div>

      {!googleAuthenticated && (
        <div className="error-banner mb-16">Connect Google Drive to save changes — edits won&apos;t persist.</div>
      )}

      <div className="card" style={{ maxWidth: 860 }}>
        <p className="text-sub text-sm mb-12">
          One list — each entity can be a <strong>manufacturer</strong>, a <strong>vendor</strong>, or both. Click a row to edit aliases and URL patterns.
        </p>

        {/* Filter + sort toolbar */}
        <div className="flex items-center gap-8 mb-12 flex-wrap">
          <div className="vendor-search">
            <Search size={14} className="text-sub" />
            <input
              className="field-input"
              placeholder="Filter by name or alias…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="btn-toggle">
            {[['all', 'All'], ['mfg', 'MFG'], ['vendor', 'Vendor']].map(([v, l]) => (
              <button key={v} type="button" className={roleFilter === v ? 'active' : ''} onClick={() => setRoleFilter(v)}>{l}</button>
            ))}
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            title={`Sort ${sortDir === 'asc' ? 'Z–A' : 'A–Z'}`}
          >
            {sortDir === 'asc' ? <ArrowDownAZ size={14} /> : <ArrowUpAZ size={14} />} Name
          </button>
          <span className="text-sub text-xs" style={{ marginLeft: 'auto' }}>{view.length} of {doc.entities.length}</span>
        </div>

        {view.length === 0 && (
          <p className="text-sub text-sm" style={{ padding: '8px 0' }}>
            {doc.entities.length === 0 ? 'No entities yet. Add the first one below.' : 'No matches.'}
          </p>
        )}

        {view.map((e) => {
          const open = expanded === e.id;
          return (
            <div key={e.id} style={{ borderBottom: '1px solid var(--border)' }}>
              {/* Row — grid keeps MFG / VENDOR / Has Own # columns aligned across rows */}
              <div className="vendor-row">
                <button className="icon-btn" onClick={() => setExpanded(open ? null : e.id)} title={open ? 'Collapse' : 'Edit'}>
                  {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                </button>
                <span className="vendor-name">{e.name || <span className="text-sub">(unnamed)</span>}</span>
                <RolePill active={e.is_manufacturer} label="MFG" role="mfg" onToggle={() => setEntity(e.id, { is_manufacturer: !e.is_manufacturer })} />
                <RolePill active={e.is_vendor} label="VENDOR" role="vendor" onToggle={() => setEntity(e.id, { is_vendor: !e.is_vendor })} />
                <label className={`vendor-ownnum text-sub text-xs ${e.is_vendor ? '' : 'is-hidden'}`} title="Vendor assigns its own catalog number">
                  <input type="checkbox" checked={!!e.has_own_catalog_number} onChange={ev => setEntity(e.id, { has_own_catalog_number: ev.target.checked })} />
                  Has Own #
                </label>
                <button className="icon-btn" title="Delete" onClick={() => deleteEntity(e.id, e.name)}><X size={15} /></button>
              </div>

              {/* Expanded edit */}
              {open && (
                <div style={{ padding: '4px 4px 14px 40px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <Field label="Name">
                    <input className="field-input" style={{ width: '100%' }} value={e.name} onChange={ev => setEntity(e.id, { name: ev.target.value })} placeholder="Company name" />
                  </Field>
                  <Field label="Also known as" hint="comma-separated — used for import & matching only, never shown or exported">
                    <input
                      className="field-input"
                      style={{ width: '100%' }}
                      value={aliasDraft[e.id] ?? (e.aliases || []).join(', ')}
                      placeholder="e.g. GARR, Garr Tooling"
                      onChange={ev => setAliasDraft(d => ({ ...d, [e.id]: ev.target.value }))}
                      onBlur={() => {
                        const raw = aliasDraft[e.id];
                        if (raw == null) return;
                        setEntity(e.id, { aliases: raw.split(',').map(s => s.trim()).filter(Boolean) });
                        setAliasDraft(d => { const n = { ...d }; delete n[e.id]; return n; });
                      }}
                    />
                  </Field>
                  {e.is_manufacturer && (
                    <Field label="EDP URL Pattern" hint="Tokens: {edp}, {edp_lower}">
                      <input className="field-input" style={{ width: '100%' }} value={e.edp_url_pattern || ''} placeholder="https://example.com/tool-{edp_lower}" onChange={ev => setEntity(e.id, { edp_url_pattern: ev.target.value || null })} />
                      {e.edp_url_pattern && <Preview url={previewUrl(e.edp_url_pattern)} />}
                    </Field>
                  )}
                  {e.is_vendor && e.has_own_catalog_number && (
                    <Field label="Vendor # URL Pattern" hint="Token: {vendor_num}">
                      <input className="field-input" style={{ width: '100%' }} value={e.vendor_num_url_pattern || ''} placeholder="https://example.com/p/{vendor_num}" onChange={ev => setEntity(e.id, { vendor_num_url_pattern: ev.target.value || null })} />
                      {e.vendor_num_url_pattern && <Preview url={previewUrl(e.vendor_num_url_pattern)} />}
                    </Field>
                  )}
                </div>
              )}
            </div>
          );
        })}

        <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={addEntity}>
          <Plus size={14} /> Add
        </button>
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <div className="text-sub text-xs" style={{ marginBottom: 3 }}>{label}{hint ? <span style={{ opacity: 0.7 }}> — {hint}</span> : null}</div>
      {children}
    </div>
  );
}

function Preview({ url }) {
  return <div className="text-sub text-xs" style={{ marginTop: 4, wordBreak: 'break-all' }}>Preview: <span style={{ color: 'var(--blue)' }}>{url}</span></div>;
}
