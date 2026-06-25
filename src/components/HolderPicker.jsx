import { useState, useMemo } from 'react';
import { Search, X } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { unitAbbr } from '../utils/units.js';
import { holderColor } from './AssemblyCard.jsx';

export default function HolderPicker({ currentGuid, onSelect, onClose }) {
  const { holders } = useApp();
  const [query, setQuery] = useState('');
  const [pendingGuid, setPendingGuid] = useState(currentGuid || null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return holders;
    return holders.filter(h =>
      (h.description || '').toLowerCase().includes(q) ||
      (h.vendor || '').toLowerCase().includes(q)
    );
  }, [holders, query]);

  // Group the matches by their source holder library (multi-library). Section
  // headers are shown only when holders span more than one library.
  const groups = useMemo(() => {
    const byLib = new Map();
    for (const h of filtered) {
      const key = h._libraryName || 'Holders';
      if (!byLib.has(key)) byLib.set(key, []);
      byLib.get(key).push(h);
    }
    return [...byLib.entries()]; // [ [libraryName, holders[]], ... ]
  }, [filtered]);
  const showLibHeaders = groups.length > 1;

  const renderRow = (h) => {
    const gl = h.gaugeLength ?? 0;
    const selected = pendingGuid === h.guid;
    return (
      <div
        key={h.guid}
        onClick={() => setPendingGuid(h.guid)}
        className={`picker-row${selected ? ' selected' : ''}`}
      >
        <span className="holder-pill" style={{ '--badge-color': holderColor(h.description) }}>
          {h.description || '—'}
        </span>
        <div className="text-sub text-xs" style={{ marginTop: 4 }}>
          Gauge: {gl.toFixed(3)} {unitAbbr(h.unit)}
          {h.vendor ? ` · ${h.vendor}` : ''}
        </div>
      </div>
    );
  };

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ width: '100%', maxWidth: 560 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <h3 className="modal-title" style={{ flex: 1, margin: 0 }}>Select Holder</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div style={{ position: 'relative', marginBottom: 12 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-sub)' }} />
          <input
            className="field-input"
            style={{ paddingLeft: 32 }}
            placeholder="Search by description or vendor…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
        </div>

        <div style={{ maxHeight: 340, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
          {holders.length === 0 ? (
            <div className="text-sub text-sm" style={{ padding: 16 }}>No holders in library.</div>
          ) : filtered.length === 0 ? (
            <div className="text-sub text-sm" style={{ padding: 16 }}>No matches.</div>
          ) : (
            groups.map(([libName, libHolders]) => (
              <div key={libName}>
                {showLibHeaders && (
                  <div className="text-sub text-xs" style={{ padding: '6px 12px', position: 'sticky', top: 0, background: 'var(--surface-2, var(--surface))', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>
                    {libName}
                  </div>
                )}
                {libHolders.map(renderRow)}
              </div>
            ))
          )}
        </div>

        {pendingGuid && (
          <div style={{ marginTop: 8 }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setPendingGuid(null)}
              style={{ fontSize: 12, color: 'var(--text-sub)' }}
            >
              Clear selection (no holder)
            </button>
          </div>
        )}

        <div className="modal-actions" style={{ marginTop: 12 }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSelect(pendingGuid || '')}>
            Select
          </button>
        </div>
      </div>
    </div>
  );
}
