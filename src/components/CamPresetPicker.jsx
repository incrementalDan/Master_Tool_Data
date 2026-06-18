import { useState, useMemo } from 'react';
import { X, Search } from 'lucide-react';

// Compact, read-only "mini Materials page" for picking a CAM preset when
// editing a tool's speed/feed preset. Search matches the preset's own fields
// AND its alloy names/aliases — so typing "6061" or "1018" surfaces the right
// CAM preset. Group pills filter by ISO group. Selecting a card returns the
// CAM preset to the caller (which stores its name in material.query).
const tint = (color, alpha) => (color || '#888') + alpha;

function CodeCol({ label, value, color }) {
  return (
    <div className="cam-code-col">
      <div className="cam-code-label">{label}</div>
      <div className="cam-code-val" style={{ color: value ? color : 'var(--text-sub)', fontSize: 12 }}>{value || '—'}</div>
    </div>
  );
}

export default function CamPresetPicker({ materials, currentQuery, onSelect, onClose }) {
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('All');

  const groups = materials?.groups || [];
  const presets = materials?.presets || [];
  const alloys = materials?.materials || [];
  const groupColor = (id) => groups.find(g => g.id === id)?.color || '#888';
  const alloysOf = (pid) => alloys.filter(m => m.preset_id === pid);
  const q = search.toLowerCase().trim();

  // Highlight the currently-selected preset (matched by name).
  const curId = useMemo(() => {
    const cq = String(currentQuery || '').trim().toLowerCase();
    return presets.find(p => (p.name || '').trim().toLowerCase() === cq)?.id || null;
  }, [currentQuery, presets]);

  const hay = (p) => [p.name, p.code, p.description, p.iso_513, p.kennametal, p.vdi_3323,
    ...alloysOf(p.id).flatMap(m => [m.label, ...(m.aliases || [])])].join(' ').toLowerCase();

  const visible = useMemo(
    () => presets.filter(p => (groupFilter === 'All' || p.group_id === groupFilter) && (!q || hay(p).includes(q))),
    [presets, alloys, groupFilter, q]);

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal cam-picker">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <h3 className="modal-title" style={{ flex: 1, margin: 0 }}>Select CAM Preset</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Search — matches CAM presets and their alloy names/aliases */}
        <div className="search-bar mb-12">
          <Search size={14} className="text-sub" />
          <input
            className="field-input"
            autoFocus
            placeholder="Type a material: 6061 · 1018 · 316L · Inconel…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Color-coded group filter pills */}
        <div className="mat-gpills">
          {['All', ...groups.map(g => g.id)].map(tab => {
            const isAll = tab === 'All';
            const g = isAll ? null : groups.find(x => x.id === tab);
            const color = isAll ? 'var(--text-sub)' : (g?.color || '#888');
            const on = groupFilter === tab;
            return (
              <button
                key={tab}
                className="mat-gpill"
                onClick={() => setGroupFilter(tab)}
                style={{ borderColor: color, color: on ? '#fff' : color, background: on ? color : 'transparent' }}
              >
                {isAll ? 'All' : `${g.id} — ${g.label}`}
              </button>
            );
          })}
        </div>

        <div className="cam-picker-list">
          {visible.length === 0 && (
            <div className="text-sub text-sm" style={{ padding: 14, textAlign: 'center' }}>
              {presets.length === 0 ? 'No CAM presets defined — add them on the Materials page.' : 'No CAM presets match.'}
            </div>
          )}
          {visible.map(p => {
            const c = groupColor(p.group_id);
            const warn = (p.kennametal || '').startsWith('P') && p.group_id === 'M';
            const al = alloysOf(p.id);
            const selected = p.id === curId;
            return (
              <button
                key={p.id}
                type="button"
                className={`cam-card cam-card--pick${selected ? ' selected' : ''}`}
                style={{ borderLeftColor: c }}
                onClick={() => { onSelect(p); onClose(); }}
              >
                <div className="cam-card-head">
                  <div className="cam-card-id">
                    <span className="mat-badge" style={{ background: tint(c, '33'), color: c, borderColor: tint(c, '55') }}>{p.group_id}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="cam-name">{p.name}</div>
                      {p.description && <div className="cam-desc">{p.description}</div>}
                    </div>
                  </div>
                  <div className="cam-codes">
                    <CodeCol label="ISO 513" value={p.iso_513} color={c} />
                    <span className="cam-codes-div" />
                    <CodeCol label="Ken" value={warn ? `${p.kennametal} ⚠` : p.kennametal} color={warn ? 'var(--red)' : c} />
                    <span className="cam-codes-div" />
                    <CodeCol label="VDI" value={p.vdi_3323} color={c} />
                  </div>
                </div>
                {al.length > 0 && (
                  <div className="cam-chips">
                    {al.map(a => (
                      <span key={a.id} className="cam-chip" style={{ background: tint(c, '22'), color: c, borderColor: tint(c, '44') }}>{a.label}</span>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
