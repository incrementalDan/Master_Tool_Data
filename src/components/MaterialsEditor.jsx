import { useState } from 'react';
import { FlaskConical, GripVertical, Plus, X, Trash2 } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { useDragReorder } from './useDragReorder.js';

// Generate a short id for a custom (non-ISO) group or a sub-material.
function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'm-' + Math.random().toString(36).slice(2, 10);
}

export default function MaterialsEditor() {
  const { materials, saveMaterials, googleAuthenticated } = useApp();

  // Local editing copy (seeded from context once). commit() persists + keeps it.
  const [doc, setDoc] = useState(() => ({
    version: materials?.version ?? 1,
    groups: [...(materials?.groups || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    materials: [...(materials?.materials || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  }));
  const [savingMsg, setSavingMsg] = useState('');
  const [groupFilter, setGroupFilter] = useState('All');
  const [adding, setAdding] = useState(null); // { group_id, label, notes } | null

  const commit = async (next) => {
    setDoc(next);
    try {
      setSavingMsg('Saving…');
      await saveMaterials(next);
      setSavingMsg('Saved');
      setTimeout(() => setSavingMsg(''), 1200);
    } catch {
      setSavingMsg('Save failed');
    }
  };

  const groupById = (id) => doc.groups.find(g => g.id === id);

  // ── Groups ──────────────────────────────────────────────────────────────
  const groupDrag = useDragReorder(doc.groups, (groups) => commit({ ...doc, groups }));
  const setGroup = (id, patch) =>
    commit({ ...doc, groups: doc.groups.map(g => g.id === id ? { ...g, ...patch } : g) });
  const addGroup = () => {
    const id = prompt('Short code for the new group (e.g. "X"):')?.trim().toUpperCase();
    if (!id) return;
    if (doc.groups.some(g => g.id === id)) { alert(`Group "${id}" already exists.`); return; }
    commit({ ...doc, groups: [...doc.groups, { id, label: '', code: '', color: '#888888', iso: false, order: doc.groups.length }] });
  };
  const deleteGroup = (id) => {
    if (doc.materials.some(m => m.group_id === id)) { alert('Move or delete this group’s sub-materials first.'); return; }
    commit({ ...doc, groups: doc.groups.filter(g => g.id !== id) });
  };

  // ── Sub-materials ───────────────────────────────────────────────────────
  const visibleMats = groupFilter === 'All' ? doc.materials : doc.materials.filter(m => m.group_id === groupFilter);
  const matDrag = useDragReorder(visibleMats, (reordered) => {
    // Reordered is the visible subset; splice it back into the full list order.
    if (groupFilter === 'All') return commit({ ...doc, materials: reordered });
    const others = doc.materials.filter(m => m.group_id !== groupFilter);
    commit({ ...doc, materials: [...others, ...reordered] });
  });
  const setMat = (id, patch) =>
    commit({ ...doc, materials: doc.materials.map(m => m.id === id ? { ...m, ...patch } : m) });
  const deleteMat = (id) => commit({ ...doc, materials: doc.materials.filter(m => m.id !== id) });
  const addMat = () => {
    if (!adding?.label?.trim() || !adding?.group_id) return;
    commit({
      ...doc,
      materials: [...doc.materials, { id: uid(), group_id: adding.group_id, label: adding.label.trim(), code: (adding.code || '').trim(), notes: adding.notes || '', order: doc.materials.length }],
    });
    setAdding(null);
  };

  const GroupBadge = ({ id }) => {
    const g = groupById(id);
    return (
      <span className="chip" style={{ background: (g?.color || '#888') + '33', color: g?.color || '#888', borderColor: (g?.color || '#888') + '66', fontWeight: 600 }}>
        {id}{g?.label ? ` · ${g.label}` : ''}
      </span>
    );
  };

  return (
    <div>
      <div className="flex items-center gap-8 mb-20">
        <h2 style={{ fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <FlaskConical size={16} /> Materials
        </h2>
        <span className="text-sub text-sm">{savingMsg}</span>
      </div>

      {!googleAuthenticated && (
        <div className="error-banner mb-16">Connect Google Drive to save changes — edits won&apos;t persist.</div>
      )}

      {/* ── ISO Groups ───────────────────────────────────────────────── */}
      <div className="card" style={{ maxWidth: 820, marginBottom: 16 }}>
        <div className="flex items-center gap-8 mb-4">
          <h3 style={{ margin: 0 }}>Material Groups</h3>
        </div>
        <p className="text-sub text-sm mb-12">
          The six ISO turning groups (P/M/K/N/S/H) — editable but not deletable. Group colors tint presets by material. Add custom groups below.
        </p>
        <div>
          {doc.groups.map((g, i) => (
            <div
              key={g.id}
              className="flex items-center gap-10"
              style={{ padding: '8px 4px', borderBottom: '1px solid var(--border)', opacity: groupDrag.draggingIndex === i ? 0.4 : 1 }}
              {...groupDrag.handlers(i)}
            >
              <GripVertical size={14} className="text-sub" style={{ cursor: 'grab', flexShrink: 0 }} />
              <input
                type="color"
                value={g.color || '#888888'}
                onChange={e => setGroup(g.id, { color: e.target.value })}
                style={{ width: 30, height: 26, border: '1px solid var(--border)', borderRadius: 6, background: 'none', cursor: 'pointer', flexShrink: 0 }}
                title="Group color"
              />
              <span className="chip" style={{ fontWeight: 700, minWidth: 34, justifyContent: 'center' }}>{g.id}</span>
              <input
                className="field-input"
                style={{ flex: 1 }}
                value={g.label || ''}
                placeholder={g.iso ? 'ISO group label' : 'Custom group label'}
                onChange={e => setGroup(g.id, { label: e.target.value })}
              />
              <input
                className="field-input"
                style={{ width: 90 }}
                value={g.code || ''}
                placeholder="Code"
                title="Short code used in preset names (e.g. SS, AL)"
                onChange={e => setGroup(g.id, { code: e.target.value })}
              />
              {g.iso
                ? <span className="text-sub text-xs" style={{ width: 70, textAlign: 'right' }}>ISO</span>
                : <button className="icon-btn" title="Delete group" onClick={() => deleteGroup(g.id)}><Trash2 size={15} /></button>}
            </div>
          ))}
        </div>
        <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={addGroup}>
          <Plus size={14} /> Add Group
        </button>
      </div>

      {/* ── Sub-materials ────────────────────────────────────────────── */}
      <div className="card" style={{ maxWidth: 820 }}>
        <h3 style={{ marginBottom: 4 }}>Sub-materials</h3>
        <p className="text-sub text-sm mb-12">
          Specific materials within a group (e.g. &ldquo;316L Stainless&rdquo; under M, &ldquo;6061 Aluminum&rdquo; under N).
        </p>

        {/* Group filter tabs */}
        <div className="flex gap-6 flex-wrap mb-12">
          {['All', ...doc.groups.map(g => g.id)].map(tab => (
            <button
              key={tab}
              className={`chip ${groupFilter === tab ? 'active' : ''}`}
              onClick={() => setGroupFilter(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        {visibleMats.length === 0 && !adding && (
          <p className="text-sub text-sm" style={{ padding: '8px 0' }}>
            No sub-materials yet. Add the first one below.
          </p>
        )}

        {visibleMats.map((m, i) => (
          <div
            key={m.id}
            className="flex items-center gap-10"
            style={{ padding: '8px 4px', borderBottom: '1px solid var(--border)', opacity: matDrag.draggingIndex === i ? 0.4 : 1 }}
            {...matDrag.handlers(i)}
          >
            <GripVertical size={14} className="text-sub" style={{ cursor: 'grab', flexShrink: 0 }} />
            <GroupBadge id={m.group_id} />
            <input className="field-input" style={{ flex: 1 }} value={m.label} onChange={e => setMat(m.id, { label: e.target.value })} placeholder="Material" />
            <input className="field-input" style={{ width: 80 }} value={m.code || ''} title="Preset-name code (optional; falls back to the group code)" onChange={e => setMat(m.id, { code: e.target.value })} placeholder="Code" />
            <input className="field-input" style={{ flex: 1.4 }} value={m.notes || ''} onChange={e => setMat(m.id, { notes: e.target.value })} placeholder="Notes" />
            <button className="icon-btn" title="Delete" onClick={() => deleteMat(m.id)}><X size={15} /></button>
          </div>
        ))}

        {/* Add form */}
        {adding ? (
          <div className="flex items-center gap-10" style={{ padding: '10px 4px' }}>
            <select className="field-input" style={{ width: 90 }} value={adding.group_id} onChange={e => setAdding(a => ({ ...a, group_id: e.target.value }))}>
              {doc.groups.map(g => <option key={g.id} value={g.id}>{g.id}</option>)}
            </select>
            <input className="field-input" style={{ flex: 1 }} autoFocus value={adding.label} placeholder="Material label" onChange={e => setAdding(a => ({ ...a, label: e.target.value }))} onKeyDown={e => e.key === 'Enter' && addMat()} />
            <input className="field-input" style={{ width: 80 }} value={adding.code} placeholder="Code" onChange={e => setAdding(a => ({ ...a, code: e.target.value }))} />
            <input className="field-input" style={{ flex: 1.4 }} value={adding.notes} placeholder="Notes" onChange={e => setAdding(a => ({ ...a, notes: e.target.value }))} />
            <button className="btn btn-primary btn-sm" onClick={addMat}>Add</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setAdding(null)}>Cancel</button>
          </div>
        ) : (
          <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }}
            onClick={() => setAdding({ group_id: groupFilter === 'All' ? doc.groups[0]?.id : groupFilter, label: '', code: '', notes: '' })}>
            <Plus size={14} /> Add Material
          </button>
        )}
      </div>
    </div>
  );
}
