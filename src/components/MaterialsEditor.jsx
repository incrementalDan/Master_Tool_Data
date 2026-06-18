import { useState, useMemo } from 'react';
import { FlaskConical, GripVertical, Plus, X, Trash2, ChevronDown, ChevronRight, Search, Copy, Check, RotateCcw } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { useDragReorder } from './useDragReorder.js';
import { DEFAULT_MATERIALS } from '../schema/sharedDefaults.js';

// Generate a short id for a custom group, a CAM preset, or an alloy.
function uid(prefix = 'm') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return prefix + '-' + Math.random().toString(36).slice(2, 10);
}

export default function MaterialsEditor() {
  const { materials, saveMaterials, googleAuthenticated } = useApp();

  // Local editing copy (seeded from context once). commit() persists + keeps it.
  const [doc, setDoc] = useState(() => ({
    version: materials?.version ?? 2,
    groups: [...(materials?.groups || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    presets: [...(materials?.presets || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    materials: [...(materials?.materials || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  }));
  const [savingMsg, setSavingMsg] = useState('');
  const [groupFilter, setGroupFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null);   // `${kind}:${id}` of the open row
  const [aliasDraft, setAliasDraft] = useState({});  // alloy id → raw comma string while editing
  const [copied, setCopied] = useState(false);

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
  const presetById = (id) => doc.presets.find(p => p.id === id);
  const q = search.toLowerCase().trim();

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
    if (doc.presets.some(p => p.group_id === id) || doc.materials.some(m => m.group_id === id)) {
      alert('Move or delete this group’s CAM presets and materials first.'); return;
    }
    commit({ ...doc, groups: doc.groups.filter(g => g.id !== id) });
  };

  // ── CAM presets ─────────────────────────────────────────────────────────
  const setPreset = (id, patch) =>
    commit({ ...doc, presets: doc.presets.map(p => p.id === id ? { ...p, ...patch } : p) });
  const deletePreset = (id) => {
    const used = doc.materials.filter(m => m.preset_id === id).length;
    if (used && !confirm(`${used} material(s) link to this CAM preset. Delete anyway? They'll be left unlinked.`)) return;
    commit({
      ...doc,
      presets: doc.presets.filter(p => p.id !== id),
      materials: doc.materials.map(m => m.preset_id === id ? { ...m, preset_id: null } : m),
    });
  };
  const addPreset = () => {
    const group_id = groupFilter === 'All' ? doc.groups[0]?.id : groupFilter;
    const id = uid('pre');
    commit({ ...doc, presets: [...doc.presets, { id, group_id, name: '', code: '', description: '', iso_513: '', kennametal: '', vdi_3323: '', order: doc.presets.length }] });
    setExpanded(`preset:${id}`);
  };

  // ── Alloys ──────────────────────────────────────────────────────────────
  const setAlloy = (id, patch) =>
    commit({ ...doc, materials: doc.materials.map(m => m.id === id ? { ...m, ...patch } : m) });
  const deleteAlloy = (id) => commit({ ...doc, materials: doc.materials.filter(m => m.id !== id) });
  const addAlloy = () => {
    const group_id = groupFilter === 'All' ? doc.groups[0]?.id : groupFilter;
    const id = uid('mat');
    commit({ ...doc, materials: [...doc.materials, { id, group_id, preset_id: null, label: '', aliases: [], category: '', condition: '', code: '', iso_513: '', kennametal: '', notes: '', order: doc.materials.length }] });
    setExpanded(`alloy:${id}`);
  };

  // ── Reset to bundled reference data (one-off; e.g. migrating a v1 file) ───
  const resetToReference = () => {
    if (!confirm('Replace ALL groups, CAM presets, and materials with the bundled reference data? This overwrites your current material library.')) return;
    commit(JSON.parse(JSON.stringify(DEFAULT_MATERIALS)));
    setGroupFilter('All'); setSearch(''); setExpanded(null);
  };

  // ── Filtered views ────────────────────────────────────────────────────────
  const matchGroup = (gid) => groupFilter === 'All' || gid === groupFilter;
  const presetHay = (p) => [p.name, p.code, p.description, p.iso_513, p.kennametal, p.vdi_3323].join(' ').toLowerCase();
  const alloyHay = (m) => [m.label, m.code, m.category, m.condition, m.notes, m.iso_513, m.kennametal, ...(m.aliases || [])].join(' ').toLowerCase();

  const visiblePresets = useMemo(
    () => doc.presets.filter(p => matchGroup(p.group_id) && (!q || presetHay(p).includes(q))),
    [doc.presets, groupFilter, q]);
  const visibleAlloys = useMemo(
    () => doc.materials.filter(m => matchGroup(m.group_id) && (!q || alloyHay(m).includes(q))),
    [doc.materials, groupFilter, q]);

  // ── Copy JSON (the structured taxonomy — handy for pushing to Fusion) ──────
  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(doc, null, 2))
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
      .catch(() => alert('Copy failed — try a different browser'));
  };

  const GroupBadge = ({ id }) => {
    const g = groupById(id);
    return (
      <span className="chip" style={{ background: (g?.color || '#888') + '33', color: g?.color || '#888', borderColor: (g?.color || '#888') + '66', fontWeight: 600 }}>
        {id}{g?.label ? ` · ${g.label}` : ''}
      </span>
    );
  };
  const CodeCell = ({ label, value }) => (
    <div style={{ textAlign: 'center', minWidth: 56 }}>
      <div className="text-sub" style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 12 }}>{value || '—'}</div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center gap-8 mb-20">
        <h2 style={{ fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <FlaskConical size={16} /> Materials
        </h2>
        <span className="text-sub text-sm">{savingMsg}</span>
        <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={handleCopy} title="Copy the full material taxonomy as JSON">
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy JSON'}
        </button>
      </div>

      {!googleAuthenticated && (
        <div className="error-banner mb-16">Connect Google Drive to save changes — edits won&apos;t persist.</div>
      )}

      <p className="text-sub text-sm mb-16" style={{ maxWidth: 820 }}>
        Three tiers: <strong>Groups</strong> (ISO P/M/K/N/S/H) → <strong>CAM Presets</strong> (the speed/feed preset name pushed to Fusion, with each standard&apos;s code) → <strong>Materials</strong> (alloys, with the names &amp; aliases you look them up by). Search hits any of them.
      </p>

      {/* ── Search + group filter (drive both CAM Presets and Materials below) ── */}
      <div className="card" style={{ maxWidth: 860, marginBottom: 16 }}>
        <div className="flex items-center gap-8 mb-12 flex-wrap">
          <div className="vendor-search">
            <Search size={14} className="text-sub" />
            <input className="field-input" placeholder="Look up a material, alias, or code: 6061 · 316L · Inconel · P3.1 · Stressproof…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <span className="text-sub text-xs" style={{ marginLeft: 'auto' }}>
            {visiblePresets.length} presets · {visibleAlloys.length} materials
          </span>
        </div>
        <div className="flex gap-6 flex-wrap">
          {['All', ...doc.groups.map(g => g.id)].map(tab => (
            <button key={tab} className={`chip ${groupFilter === tab ? 'active' : ''}`} onClick={() => setGroupFilter(tab)}>{tab}</button>
          ))}
        </div>
      </div>

      {/* ── Material Groups ──────────────────────────────────────────────── */}
      <div className="card" style={{ maxWidth: 860, marginBottom: 16 }}>
        <h3 style={{ marginBottom: 4 }}>Material Groups</h3>
        <p className="text-sub text-sm mb-12">
          The six ISO turning groups (P/M/K/N/S/H) — editable but not deletable. Group colors tint presets; the code is the fallback token in preset names. Add custom groups below.
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
              <input type="color" value={g.color || '#888888'} onChange={e => setGroup(g.id, { color: e.target.value })}
                style={{ width: 30, height: 26, border: '1px solid var(--border)', borderRadius: 6, background: 'none', cursor: 'pointer', flexShrink: 0 }} title="Group color" />
              <span className="chip" style={{ fontWeight: 700, minWidth: 34, justifyContent: 'center' }}>{g.id}</span>
              <input className="field-input" style={{ flex: 1 }} value={g.label || ''} placeholder={g.iso ? 'ISO group label' : 'Custom group label'} onChange={e => setGroup(g.id, { label: e.target.value })} />
              <input className="field-input" style={{ width: 90 }} value={g.code || ''} placeholder="Code" title="Short code used in preset names (e.g. SS, AL)" onChange={e => setGroup(g.id, { code: e.target.value })} />
              {g.iso
                ? <span className="text-sub text-xs" style={{ width: 70, textAlign: 'right' }}>ISO</span>
                : <button className="icon-btn" title="Delete group" onClick={() => deleteGroup(g.id)}><Trash2 size={15} /></button>}
            </div>
          ))}
        </div>
        <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={addGroup}><Plus size={14} /> Add Group</button>
      </div>

      {/* ── CAM Presets ──────────────────────────────────────────────────── */}
      <div className="card" style={{ maxWidth: 860, marginBottom: 16 }}>
        <h3 style={{ marginBottom: 4 }}>CAM Presets</h3>
        <p className="text-sub text-sm mb-12">
          The Fusion speed/feed preset groups. Each carries the equivalent code in ISO 513, Kennametal, and Haas/VDI 3323 so manufacturer charts cross-reference. Optional short code overrides the group code in preset names.
        </p>

        {visiblePresets.length === 0 && (
          <p className="text-sub text-sm" style={{ padding: '8px 0' }}>{q || groupFilter !== 'All' ? 'No CAM presets match.' : 'No CAM presets yet.'}</p>
        )}

        {visiblePresets.map((p) => {
          const open = expanded === `preset:${p.id}`;
          return (
            <div key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="flex items-center gap-10" style={{ padding: '8px 4px' }}>
                <button className="icon-btn" onClick={() => setExpanded(open ? null : `preset:${p.id}`)} title={open ? 'Collapse' : 'Edit'}>
                  {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                </button>
                <GroupBadge id={p.group_id} />
                <span style={{ fontWeight: 600, flex: 1 }}>{p.name || <span className="text-sub">(unnamed)</span>}{p.code ? <span className="text-sub text-xs" style={{ marginLeft: 6 }}>· {p.code}</span> : null}</span>
                <CodeCell label="ISO 513" value={p.iso_513} />
                <CodeCell label="Ken" value={p.kennametal} />
                <CodeCell label="VDI" value={p.vdi_3323} />
                <button className="icon-btn" title="Delete" onClick={() => deletePreset(p.id)}><X size={15} /></button>
              </div>
              {open && (
                <div style={{ padding: '4px 4px 14px 40px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="flex gap-10 flex-wrap">
                    <Field label="Name" grow><input className="field-input" style={{ width: '100%' }} value={p.name} placeholder="e.g. SS Austenitic 316" onChange={e => setPreset(p.id, { name: e.target.value })} /></Field>
                    <Field label="Code"><input className="field-input" style={{ width: 90 }} value={p.code || ''} placeholder="opt." onChange={e => setPreset(p.id, { code: e.target.value })} /></Field>
                    <Field label="Group">
                      <select className="field-input" value={p.group_id} onChange={e => setPreset(p.id, { group_id: e.target.value })}>
                        {doc.groups.map(g => <option key={g.id} value={g.id}>{g.id} · {g.label}</option>)}
                      </select>
                    </Field>
                  </div>
                  <Field label="Description"><input className="field-input" style={{ width: '100%' }} value={p.description || ''} onChange={e => setPreset(p.id, { description: e.target.value })} /></Field>
                  <div className="flex gap-10 flex-wrap">
                    <Field label="ISO 513"><input className="field-input" style={{ width: 90 }} value={p.iso_513 || ''} onChange={e => setPreset(p.id, { iso_513: e.target.value })} /></Field>
                    <Field label="Kennametal"><input className="field-input" style={{ width: 90 }} value={p.kennametal || ''} onChange={e => setPreset(p.id, { kennametal: e.target.value })} /></Field>
                    <Field label="Haas / VDI 3323"><input className="field-input" style={{ width: 110 }} value={p.vdi_3323 || ''} onChange={e => setPreset(p.id, { vdi_3323: e.target.value })} /></Field>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={addPreset}><Plus size={14} /> Add CAM Preset</button>
      </div>

      {/* ── Materials (alloys) ───────────────────────────────────────────── */}
      <div className="card" style={{ maxWidth: 860 }}>
        <h3 style={{ marginBottom: 4 }}>Materials</h3>
        <p className="text-sub text-sm mb-12">
          Individual alloys (6061, 316L, Inconel 718…). Aliases are the alternate names you look them up by. Each links up to a CAM preset.
        </p>

        {visibleAlloys.length === 0 && (
          <p className="text-sub text-sm" style={{ padding: '8px 0' }}>{q || groupFilter !== 'All' ? 'No materials match.' : 'No materials yet.'}</p>
        )}

        {visibleAlloys.map((m) => {
          const open = expanded === `alloy:${m.id}`;
          const preset = presetById(m.preset_id);
          const groupPresets = doc.presets.filter(p => p.group_id === m.group_id);
          return (
            <div key={m.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="flex items-center gap-10" style={{ padding: '8px 4px' }}>
                <button className="icon-btn" onClick={() => setExpanded(open ? null : `alloy:${m.id}`)} title={open ? 'Collapse' : 'Edit'}>
                  {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                </button>
                <GroupBadge id={m.group_id} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{m.label || <span className="text-sub">(unnamed)</span>}</div>
                  {(m.aliases || []).length > 0 && (
                    <div className="text-sub text-xs" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.aliases.slice(0, 4).join(' · ')}</div>
                  )}
                </div>
                {preset
                  ? <span className="chip" title="Linked CAM preset">{preset.name}</span>
                  : <span className="text-sub text-xs">no preset</span>}
                <button className="icon-btn" title="Delete" onClick={() => deleteAlloy(m.id)}><X size={15} /></button>
              </div>
              {open && (
                <div style={{ padding: '4px 4px 14px 40px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="flex gap-10 flex-wrap">
                    <Field label="Material" grow><input className="field-input" style={{ width: '100%' }} value={m.label} placeholder="e.g. 316 / 316L" onChange={e => setAlloy(m.id, { label: e.target.value })} /></Field>
                    <Field label="Group">
                      <select className="field-input" value={m.group_id} onChange={e => setAlloy(m.id, { group_id: e.target.value, preset_id: null })}>
                        {doc.groups.map(g => <option key={g.id} value={g.id}>{g.id} · {g.label}</option>)}
                      </select>
                    </Field>
                    <Field label="CAM Preset">
                      <select className="field-input" value={m.preset_id || ''} onChange={e => setAlloy(m.id, { preset_id: e.target.value || null })}>
                        <option value="">— none —</option>
                        {groupPresets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </Field>
                  </div>
                  <Field label="Aliases" hint="comma-separated — the alternate names you look it up by">
                    <input
                      className="field-input"
                      style={{ width: '100%' }}
                      value={aliasDraft[m.id] ?? (m.aliases || []).join(', ')}
                      placeholder="e.g. SS316, 316L, 18-8"
                      onChange={e => setAliasDraft(d => ({ ...d, [m.id]: e.target.value }))}
                      onBlur={() => {
                        const raw = aliasDraft[m.id];
                        if (raw == null) return;
                        setAlloy(m.id, { aliases: raw.split(',').map(s => s.trim()).filter(Boolean) });
                        setAliasDraft(d => { const n = { ...d }; delete n[m.id]; return n; });
                      }}
                    />
                  </Field>
                  <div className="flex gap-10 flex-wrap">
                    <Field label="Condition" grow><input className="field-input" style={{ width: '100%' }} value={m.condition || ''} placeholder="e.g. annealed" onChange={e => setAlloy(m.id, { condition: e.target.value })} /></Field>
                    <Field label="Code"><input className="field-input" style={{ width: 90 }} value={m.code || ''} placeholder="opt." onChange={e => setAlloy(m.id, { code: e.target.value })} /></Field>
                    <Field label="ISO 513"><input className="field-input" style={{ width: 80 }} value={m.iso_513 || ''} onChange={e => setAlloy(m.id, { iso_513: e.target.value })} /></Field>
                    <Field label="Kennametal"><input className="field-input" style={{ width: 90 }} value={m.kennametal || ''} onChange={e => setAlloy(m.id, { kennametal: e.target.value })} /></Field>
                  </div>
                  <Field label="Notes"><input className="field-input" style={{ width: '100%' }} value={m.notes || ''} onChange={e => setAlloy(m.id, { notes: e.target.value })} /></Field>
                </div>
              )}
            </div>
          );
        })}
        <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={addAlloy}><Plus size={14} /> Add Material</button>
      </div>

      {/* ── Reset to reference data ──────────────────────────────────────── */}
      <div style={{ maxWidth: 860, marginTop: 16 }}>
        <button className="btn btn-ghost btn-sm" onClick={resetToReference} title="Overwrite the library with the bundled reference data">
          <RotateCcw size={14} /> Load reference data
        </button>
        <span className="text-sub text-xs" style={{ marginLeft: 8 }}>Replaces everything with the bundled standards — use once when migrating an empty/old library.</span>
      </div>
    </div>
  );
}

function Field({ label, hint, grow, children }) {
  return (
    <div style={grow ? { flex: 1, minWidth: 160 } : undefined}>
      <div className="text-sub text-xs" style={{ marginBottom: 3 }}>{label}{hint ? <span style={{ opacity: 0.7 }}> — {hint}</span> : null}</div>
      {children}
    </div>
  );
}
