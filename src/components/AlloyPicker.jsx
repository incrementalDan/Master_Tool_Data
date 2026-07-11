import { useState, useMemo } from 'react';
import { X, Search, Check } from 'lucide-react';

// Compact, read-only "mini Materials page" for picking a SPECIFIC ALLOY — the
// materials[] tier — for a job/part/fixture material. Mirrors CamPresetPicker,
// but here the selection is the exact alloy (not a CAM preset): search matches
// each alloy's label/aliases/code, group pills filter by ISO group, and the
// alloys render as pills tinted by their group color. A "custom material" escape
// hatch covers one-offs not in the library.
const tint = (color, alpha) => (color || '#888') + alpha;

export default function AlloyPicker({ materials, currentId, onSelect, onCustom, onClose }) {
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('All');
  const [customOpen, setCustomOpen] = useState(false);
  const [customVal, setCustomVal] = useState('');

  const groups = materials?.groups || [];
  const alloys = materials?.materials || [];
  const groupColor = (id) => groups.find(g => g.id === id)?.color || '#888';
  const groupName = (id) => groups.find(g => g.id === id)?.label || id;
  const q = search.toLowerCase().trim();

  const hay = (a) => [a.label, a.code, a.condition, a.category, ...(a.aliases || [])]
    .join(' ').toLowerCase();

  const visible = useMemo(
    () => alloys
      .filter(a => (groupFilter === 'All' || a.group_id === groupFilter) && (!q || hay(a).includes(q)))
      .sort((a, b) => String(a.label).localeCompare(String(b.label))),
    [alloys, groupFilter, q]);

  // Group the visible alloys by ISO group, in the groups[] order, for headers.
  const sections = useMemo(() => {
    const order = groups.map(g => g.id);
    const byGroup = new Map();
    for (const a of visible) {
      if (!byGroup.has(a.group_id)) byGroup.set(a.group_id, []);
      byGroup.get(a.group_id).push(a);
    }
    return [...byGroup.entries()].sort(
      (a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  }, [visible, groups]);

  const submitCustom = () => {
    const v = customVal.trim();
    if (v) onCustom(v);
  };

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal cam-picker">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <h3 className="modal-title" style={{ flex: 1, margin: 0 }}>Select Material (Alloy)</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Search — matches an alloy's name, aliases, and code */}
        <div className="search-bar mb-12">
          <Search size={14} className="text-sub" />
          <input
            className="field-input"
            autoFocus
            placeholder="Type an alloy: 6061 · 316L · 4140 · Ti64 · Inconel…"
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
              {alloys.length === 0 ? 'No alloys defined — add them on the Materials page.' : 'No alloys match.'}
            </div>
          )}
          {sections.map(([gid, list]) => {
            const c = groupColor(gid);
            return (
              <div key={gid} className="alloy-section">
                <div className="alloy-section-head">
                  <span className="mat-badge" style={{ background: tint(c, '33'), color: c, borderColor: tint(c, '55') }}>{gid}</span>
                  <span className="text-sub text-xs">{groupName(gid)}</span>
                </div>
                <div className="alloy-pick-wrap">
                  {list.map(a => {
                    const selected = a.id === currentId;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        className={`alloy-pick-chip${selected ? ' selected' : ''}`}
                        title={(a.aliases || []).join(' · ')}
                        style={{ background: tint(c, selected ? '44' : '22'), color: c, borderColor: tint(c, selected ? '99' : '44') }}
                        onClick={() => { onSelect(a); onClose(); }}
                      >
                        {selected && <Check size={12} />}
                        {a.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Custom material escape hatch — one-offs not in the library */}
        <div className="alloy-custom-row">
          {!customOpen ? (
            <button className="btn btn-ghost btn-sm" onClick={() => setCustomOpen(true)}>
              + Use a custom material name…
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 6, width: '100%' }}>
              <input
                className="field-input"
                autoFocus
                style={{ flex: 1 }}
                placeholder="Custom material name"
                value={customVal}
                onChange={e => setCustomVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitCustom(); }}
              />
              <button className="btn btn-primary btn-sm" onClick={submitCustom} disabled={!customVal.trim()}>Use</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
