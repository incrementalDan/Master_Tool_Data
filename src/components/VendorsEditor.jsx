import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, GripVertical, Plus, X, ChevronDown, ChevronRight } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { useDragReorder } from './useDragReorder.js';

function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'v-' + Math.random().toString(36).slice(2, 10);
}

// Preview a URL pattern with placeholder numbers, so the user sees the shape.
function previewUrl(pattern) {
  if (!pattern) return '';
  return pattern.replace(/\{edp\}/g, '12345').replace(/\{edp_lower\}/g, 'abc12').replace(/\{vendor_num\}/g, '99887766');
}

function RolePill({ active, label, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className="chip"
      style={{
        fontWeight: 600,
        background: active ? 'rgba(74,143,255,0.18)' : 'var(--surface-2)',
        color: active ? 'var(--blue)' : 'var(--text-sub)',
        borderColor: active ? 'var(--blue)' : 'var(--border)',
      }}
      title={`Toggle ${label}`}
    >
      {label}
    </button>
  );
}

export default function VendorsEditor() {
  const navigate = useNavigate();
  const { vendorRegistry, saveVendorRegistry, googleAuthenticated } = useApp();

  const [doc, setDoc] = useState(() => ({
    version: vendorRegistry?.version ?? 1,
    entities: [...(vendorRegistry?.entities || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  }));
  const [savingMsg, setSavingMsg] = useState('');
  const [expanded, setExpanded] = useState(null);

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

  const drag = useDragReorder(doc.entities, (entities) => commit({ ...doc, entities }));
  const setEntity = (id, patch) =>
    commit({ ...doc, entities: doc.entities.map(e => e.id === id ? { ...e, ...patch } : e) });
  const deleteEntity = (id, name) => {
    if (!confirm(`Delete "${name}"? Tools referencing it keep the stored name.`)) return;
    commit({ ...doc, entities: doc.entities.filter(e => e.id !== id) });
  };
  const addEntity = () => {
    const e = { id: uid(), name: '', is_manufacturer: true, is_vendor: false, has_own_catalog_number: false, edp_url_pattern: null, vendor_num_url_pattern: null, proshop_id: null, order: doc.entities.length };
    commit({ ...doc, entities: [...doc.entities, e] });
    setExpanded(e.id);
  };

  return (
    <div>
      <div className="flex items-center gap-8 mb-20">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>← Back</button>
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
          One list — each entity can be a <strong>manufacturer</strong>, a <strong>vendor</strong>, or both. Click a row to edit its URL patterns.
        </p>

        {doc.entities.length === 0 && (
          <p className="text-sub text-sm" style={{ padding: '8px 0' }}>No entities yet. Add the first one below.</p>
        )}

        {doc.entities.map((e, i) => {
          const open = expanded === e.id;
          return (
            <div key={e.id} style={{ borderBottom: '1px solid var(--border)', opacity: drag.draggingIndex === i ? 0.4 : 1 }} {...drag.handlers(i)}>
              {/* Row */}
              <div className="flex items-center gap-10" style={{ padding: '8px 4px' }}>
                <GripVertical size={14} className="text-sub" style={{ cursor: 'grab', flexShrink: 0 }} />
                <button className="icon-btn" onClick={() => setExpanded(open ? null : e.id)} title={open ? 'Collapse' : 'Edit'}>
                  {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                </button>
                <span style={{ flex: 1, fontWeight: 500 }}>{e.name || <span className="text-sub">(unnamed)</span>}</span>
                <RolePill active={e.is_manufacturer} label="MFG" onToggle={() => setEntity(e.id, { is_manufacturer: !e.is_manufacturer })} />
                <RolePill active={e.is_vendor} label="VENDOR" onToggle={() => setEntity(e.id, { is_vendor: !e.is_vendor })} />
                {e.is_vendor && (
                  <label className="text-sub text-xs flex items-center gap-4" style={{ cursor: 'pointer' }} title="Vendor assigns its own catalog number">
                    <input type="checkbox" checked={!!e.has_own_catalog_number} onChange={ev => setEntity(e.id, { has_own_catalog_number: ev.target.checked })} />
                    Has Own #
                  </label>
                )}
                <button className="icon-btn" title="Delete" onClick={() => deleteEntity(e.id, e.name)}><X size={15} /></button>
              </div>

              {/* Expanded edit */}
              {open && (
                <div style={{ padding: '4px 4px 14px 40px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <Field label="Name">
                    <input className="field-input" style={{ width: '100%' }} value={e.name} onChange={ev => setEntity(e.id, { name: ev.target.value })} placeholder="Company name" />
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
