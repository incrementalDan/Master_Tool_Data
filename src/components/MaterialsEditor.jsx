import { useState, useMemo } from 'react';
import {
  FlaskConical, Layers, GripVertical, Plus, X, Trash2, ChevronDown, ChevronRight,
  Search, Copy, Check, RotateCcw, ArrowRight, Pencil,
} from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { useDragReorder } from './useDragReorder.js';
import { DEFAULT_MATERIALS } from '../schema/sharedDefaults.js';

// Generate a short id for a custom group, a CAM preset, or an alloy.
function uid(prefix = 'm') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return prefix + '-' + Math.random().toString(36).slice(2, 10);
}

// Tint helpers — a group's color drives every accent on this page.
const tint = (color, alpha) => (color || '#888') + alpha;

export default function MaterialsEditor() {
  const { saveMaterials, googleAuthenticated, materials } = useApp();

  // Local editing copy (seeded from context once). commit() persists + keeps it.
  const [doc, setDoc] = useState(() => ({
    version: materials?.version ?? 2,
    groups: [...(materials?.groups || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    presets: [...(materials?.presets || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    materials: [...(materials?.materials || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  }));
  const [view, setView] = useState('presets');     // 'presets' | 'alloys'
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

  const presetById = (id) => doc.presets.find(p => p.id === id);
  const groupColor = (id) => doc.groups.find(g => g.id === id)?.color || '#888';
  const alloysOfPreset = (pid) => doc.materials.filter(m => m.preset_id === pid);
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
    const used = alloysOfPreset(id).length;
    if (used && !confirm(`${used} alloy(s) link to this CAM preset. Delete anyway? They'll be left unlinked.`)) return;
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
    if (!confirm('Replace ALL groups, CAM presets, and alloys with the bundled reference data? This overwrites your current material library.')) return;
    commit(JSON.parse(JSON.stringify(DEFAULT_MATERIALS)));
    setGroupFilter('All'); setSearch(''); setExpanded(null);
  };

  // ── Filtered views ────────────────────────────────────────────────────────
  const matchGroup = (gid) => groupFilter === 'All' || gid === groupFilter;
  const presetHay = (p) => [p.name, p.code, p.description, p.iso_513, p.kennametal, p.vdi_3323,
    ...alloysOfPreset(p.id).flatMap(m => [m.label, ...(m.aliases || [])])].join(' ').toLowerCase();
  const alloyHay = (m) => [m.label, m.code, m.category, m.condition, m.notes, m.iso_513, m.kennametal, ...(m.aliases || [])].join(' ').toLowerCase();

  const visiblePresets = useMemo(
    () => doc.presets.filter(p => matchGroup(p.group_id) && (!q || presetHay(p).includes(q))),
    [doc.presets, doc.materials, groupFilter, q]);
  const visibleAlloys = useMemo(
    () => doc.materials.filter(m => matchGroup(m.group_id) && (!q || alloyHay(m).includes(q))),
    [doc.materials, groupFilter, q]);

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(doc, null, 2))
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
      .catch(() => alert('Copy failed — try a different browser'));
  };

  const GroupBadge = ({ id, size = 'sm' }) => {
    const c = groupColor(id);
    return (
      <span className={`mat-badge ${size === 'lg' ? 'mat-badge-lg' : ''}`}
        style={{ background: tint(c, '33'), color: c, borderColor: tint(c, '55') }}>{id}</span>
    );
  };

  return (
    <div>
      {/* ── Header ── */}
      <div className="flex items-center gap-8 mb-4" style={{ flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <FlaskConical size={16} /> Materials
        </h2>
        <span className="text-sub text-sm">{savingMsg}</span>
        <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={handleCopy} title="Copy the full material taxonomy as JSON">
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy JSON'}
        </button>
      </div>
      <p className="text-sub text-xs mb-16">
        {doc.presets.length} CAM presets · {doc.materials.length} alloys · 3 code systems: ISO 513 · Kennametal · Haas/VDI 3323
      </p>

      {!googleAuthenticated && (
        <div className="error-banner mb-16">Connect Google Drive to save changes — edits won&apos;t persist.</div>
      )}

      <div className="mat-layout">
        {/* ════ LEFT / MAIN ════ */}
        <div className="mat-main">
          {/* Hierarchy toggle — CAM Presets are made up of Material Alloys */}
          <div className="mat-hier">
            <button className={`mat-hier-node ${view === 'presets' ? 'active' : ''}`} onClick={() => { setView('presets'); setExpanded(null); }}>
              <span className="mat-hier-title">CAM Presets</span>
              <span className="mat-hier-sub">the Fusion preset name · {doc.presets.length}</span>
            </button>
            <div className="mat-hier-arrow">
              <span>made up of</span>
              <ArrowRight size={18} />
            </div>
            <button className={`mat-hier-node ${view === 'alloys' ? 'active' : ''}`} onClick={() => { setView('alloys'); setExpanded(null); }}>
              <span className="mat-hier-title">Material Alloys</span>
              <span className="mat-hier-sub">the names you look up · {doc.materials.length}</span>
            </button>
          </div>

          {/* Color-coded group filter pills (full names) */}
          <div className="mat-gpills">
            {['All', ...doc.groups.map(g => g.id)].map(tab => {
              const isAll = tab === 'All';
              const g = isAll ? null : doc.groups.find(x => x.id === tab);
              const color = isAll ? 'var(--text-sub)' : (g?.color || '#888');
              const on = groupFilter === tab;
              return (
                <button
                  key={tab}
                  className="mat-gpill"
                  onClick={() => setGroupFilter(tab)}
                  style={{
                    borderColor: color,
                    color: on ? '#fff' : color,
                    background: on ? color : 'transparent',
                  }}
                >
                  {isAll ? 'All' : `${g.id} — ${g.label}`}
                </button>
              );
            })}
          </div>

          {/* Search */}
          <div className="vendor-search mb-12" style={{ width: '100%' }}>
            <Search size={14} className="text-sub" />
            <input
              className="field-input"
              placeholder={view === 'presets'
                ? 'Search CAM presets or alloys: Al Wrought · SS 316 · Inconel…'
                : 'Search alloys: 6061 · 316L · 4140 · Ti64 · duplex…'}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {/* ── CAM PRESETS view ── */}
          {view === 'presets' && (
            <>
              {visiblePresets.length === 0 && (
                <p className="text-sub text-sm" style={{ padding: '8px 2px' }}>
                  {q || groupFilter !== 'All'
                    ? 'No CAM presets match.'
                    : (doc.presets.length === 0
                        ? 'No CAM presets yet — “Load reference data” on the right to seed the standards, or add your own.'
                        : 'No CAM presets yet.')}
                </p>
              )}

              {visiblePresets.map((p) => {
                const c = groupColor(p.group_id);
                const open = expanded === `preset:${p.id}`;
                const warn = (p.kennametal || '').startsWith('P') && p.group_id === 'M';
                const alloys = alloysOfPreset(p.id);
                return (
                  <div key={p.id} className="cam-card" style={{ borderLeftColor: c }}>
                    <div className="cam-card-head" onClick={() => setExpanded(open ? null : `preset:${p.id}`)}>
                      <div className="cam-card-id">
                        <GroupBadge id={p.group_id} />
                        <div style={{ minWidth: 0 }}>
                          <div className="cam-name">{p.name || <span className="text-sub">(unnamed)</span>}{p.code ? <span className="text-sub text-xs" style={{ marginLeft: 6 }}>· {p.code}</span> : null}</div>
                          {p.description && <div className="cam-desc">{p.description}</div>}
                        </div>
                      </div>
                      <div className="cam-codes">
                        <CodeCol label="ISO 513" value={p.iso_513} color={c} />
                        <span className="cam-codes-div" />
                        <CodeCol label="Kennametal" value={warn ? `${p.kennametal} ⚠` : p.kennametal} color={warn ? 'var(--red)' : c} />
                        <span className="cam-codes-div" />
                        <CodeCol label="Haas / VDI" value={p.vdi_3323} color={c} />
                      </div>
                      <Pencil size={13} className="cam-edit-hint" />
                    </div>

                    {alloys.length > 0 && (
                      <div className="cam-chips">
                        {alloys.map(a => (
                          <span key={a.id} className="cam-chip" style={{ background: tint(c, '22'), color: c, borderColor: tint(c, '44') }}>
                            {a.label}
                          </span>
                        ))}
                      </div>
                    )}

                    {open && (
                      <div className="cam-edit">
                        <div className="flex gap-10 flex-wrap">
                          <Field label="Name" grow><input className="field-input" style={{ width: '100%' }} value={p.name} placeholder="e.g. SS Austenitic 316" onChange={e => setPreset(p.id, { name: e.target.value })} /></Field>
                          <Field label="Code"><input className="field-input" style={{ width: 80 }} value={p.code || ''} placeholder="opt." onChange={e => setPreset(p.id, { code: e.target.value })} /></Field>
                          <Field label="Group">
                            <select className="field-input" value={p.group_id} onChange={e => setPreset(p.id, { group_id: e.target.value })}>
                              {doc.groups.map(g => <option key={g.id} value={g.id}>{g.id} · {g.label}</option>)}
                            </select>
                          </Field>
                        </div>
                        <Field label="Description"><input className="field-input" style={{ width: '100%' }} value={p.description || ''} onChange={e => setPreset(p.id, { description: e.target.value })} /></Field>
                        <div className="flex gap-10 flex-wrap" style={{ alignItems: 'flex-end' }}>
                          <Field label="ISO 513"><input className="field-input" style={{ width: 90 }} value={p.iso_513 || ''} onChange={e => setPreset(p.id, { iso_513: e.target.value })} /></Field>
                          <Field label="Kennametal"><input className="field-input" style={{ width: 90 }} value={p.kennametal || ''} onChange={e => setPreset(p.id, { kennametal: e.target.value })} /></Field>
                          <Field label="Haas / VDI 3323"><input className="field-input" style={{ width: 110 }} value={p.vdi_3323 || ''} onChange={e => setPreset(p.id, { vdi_3323: e.target.value })} /></Field>
                          <button className="btn btn-ghost btn-sm cam-del" style={{ marginLeft: 'auto' }} onClick={() => deletePreset(p.id)}><Trash2 size={13} /> Delete</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              <button className="btn btn-secondary btn-sm" style={{ marginTop: 6 }} onClick={addPreset}><Plus size={14} /> Add CAM Preset</button>
            </>
          )}

          {/* ── MATERIAL ALLOYS view ── */}
          {view === 'alloys' && (
            <div className="card" style={{ padding: 0 }}>
              {visibleAlloys.length === 0 && (
                <p className="text-sub text-sm" style={{ padding: 14 }}>{q || groupFilter !== 'All' ? 'No alloys match.' : 'No alloys yet.'}</p>
              )}
              {visibleAlloys.map((m) => {
                const open = expanded === `alloy:${m.id}`;
                const preset = presetById(m.preset_id);
                const groupPresets = doc.presets.filter(p => p.group_id === m.group_id);
                return (
                  <div key={m.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <div className="flex items-center gap-10" style={{ padding: '8px 12px', cursor: 'pointer' }} onClick={() => setExpanded(open ? null : `alloy:${m.id}`)}>
                      {open ? <ChevronDown size={15} className="text-sub" /> : <ChevronRight size={15} className="text-sub" />}
                      <GroupBadge id={m.group_id} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{m.label || <span className="text-sub">(unnamed)</span>}</div>
                        {(m.aliases || []).length > 0 && (
                          <div className="text-sub text-xs" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.aliases.slice(0, 4).join(' · ')}</div>
                        )}
                      </div>
                      {preset
                        ? <span className="chip" title="Linked CAM preset" style={{ background: tint(groupColor(m.group_id), '22'), color: groupColor(m.group_id), borderColor: tint(groupColor(m.group_id), '44') }}>{preset.name}</span>
                        : <span className="text-sub text-xs">no preset</span>}
                    </div>
                    {open && (
                      <div style={{ padding: '4px 12px 14px 40px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div className="flex gap-10 flex-wrap">
                          <Field label="Alloy" grow><input className="field-input" style={{ width: '100%' }} value={m.label} placeholder="e.g. 316 / 316L" onChange={e => setAlloy(m.id, { label: e.target.value })} /></Field>
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
                        <div className="flex gap-10 flex-wrap" style={{ alignItems: 'flex-end' }}>
                          <Field label="Condition" grow><input className="field-input" style={{ width: '100%' }} value={m.condition || ''} placeholder="e.g. annealed" onChange={e => setAlloy(m.id, { condition: e.target.value })} /></Field>
                          <Field label="Code"><input className="field-input" style={{ width: 80 }} value={m.code || ''} placeholder="opt." onChange={e => setAlloy(m.id, { code: e.target.value })} /></Field>
                          <Field label="ISO 513"><input className="field-input" style={{ width: 80 }} value={m.iso_513 || ''} onChange={e => setAlloy(m.id, { iso_513: e.target.value })} /></Field>
                          <Field label="Kennametal"><input className="field-input" style={{ width: 90 }} value={m.kennametal || ''} onChange={e => setAlloy(m.id, { kennametal: e.target.value })} /></Field>
                        </div>
                        <Field label="Notes"><input className="field-input" style={{ width: '100%' }} value={m.notes || ''} onChange={e => setAlloy(m.id, { notes: e.target.value })} /></Field>
                        <button className="btn btn-ghost btn-sm cam-del" style={{ alignSelf: 'flex-start' }} onClick={() => deleteAlloy(m.id)}><Trash2 size={13} /> Delete alloy</button>
                      </div>
                    )}
                  </div>
                );
              })}
              <div style={{ padding: 10 }}>
                <button className="btn btn-secondary btn-sm" onClick={addAlloy}><Plus size={14} /> Add Material Alloy</button>
              </div>
            </div>
          )}
        </div>

        {/* ════ RIGHT / REFERENCE ════ */}
        <aside className="mat-side">
          <div className="card">
            <h3 style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 7 }}><Layers size={15} /> Material Groups</h3>
            <p className="text-sub text-xs mb-12">
              The six ISO groups (P/M/K/N/S/H) — reference. Colors tint everything here; the code is the fallback token in preset names.
            </p>
            {doc.groups.map((g, i) => (
              <div
                key={g.id}
                className="flex items-center gap-8"
                style={{ padding: '6px 2px', borderBottom: '1px solid var(--border)', opacity: groupDrag.draggingIndex === i ? 0.4 : 1 }}
                {...groupDrag.handlers(i)}
              >
                <GripVertical size={13} className="text-sub" style={{ cursor: 'grab', flexShrink: 0 }} />
                <input type="color" value={g.color || '#888888'} onChange={e => setGroup(g.id, { color: e.target.value })}
                  style={{ width: 26, height: 24, border: '1px solid var(--border)', borderRadius: 5, background: 'none', cursor: 'pointer', flexShrink: 0 }} title="Group color" />
                <span className="mat-badge" style={{ background: tint(g.color, '33'), color: g.color, borderColor: tint(g.color, '55'), flexShrink: 0 }}>{g.id}</span>
                <input className="field-input" style={{ flex: 1, minWidth: 0 }} value={g.label || ''} placeholder={g.iso ? 'ISO label' : 'Custom label'} onChange={e => setGroup(g.id, { label: e.target.value })} />
                <input className="field-input" style={{ width: 58, flexShrink: 0 }} value={g.code || ''} placeholder="Code" title="Short code used in preset names" onChange={e => setGroup(g.id, { code: e.target.value })} />
                {g.iso
                  ? <span className="text-sub text-xs" style={{ flexShrink: 0 }}>ISO</span>
                  : <button className="icon-btn" title="Delete group" onClick={() => deleteGroup(g.id)} style={{ flexShrink: 0 }}><Trash2 size={14} /></button>}
              </div>
            ))}
            <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={addGroup}><Plus size={14} /> Add Group</button>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <button className="btn btn-ghost btn-sm" onClick={resetToReference} title="Overwrite the library with the bundled reference data">
              <RotateCcw size={14} /> Load reference data
            </button>
            <p className="text-sub text-xs" style={{ marginTop: 8, marginBottom: 0 }}>
              Replaces everything with the bundled standards — use once when migrating an empty/old library.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function CodeCol({ label, value, color }) {
  return (
    <div className="cam-code-col">
      <div className="cam-code-label">{label}</div>
      <div className="cam-code-val" style={{ color: value ? color : 'var(--text-sub)' }}>{value || '—'}</div>
    </div>
  );
}

function Field({ label, hint, grow, children }) {
  return (
    <div style={grow ? { flex: 1, minWidth: 150 } : undefined}>
      <div className="text-sub text-xs" style={{ marginBottom: 3 }}>{label}{hint ? <span style={{ opacity: 0.7 }}> — {hint}</span> : null}</div>
      {children}
    </div>
  );
}
