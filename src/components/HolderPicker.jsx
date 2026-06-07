import { useState, useMemo } from 'react';
import { Search, X } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { unitAbbr } from '../utils/units.js';

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
            filtered.map(h => {
              const gl = h.gaugeLength ?? 0;
              const selected = pendingGuid === h.guid;
              return (
                <div
                  key={h.guid}
                  onClick={() => setPendingGuid(h.guid)}
                  style={{
                    padding: '10px 12px',
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer',
                    background: selected ? 'var(--surface-2)' : 'transparent',
                    borderLeft: selected ? '3px solid var(--blue)' : '3px solid transparent',
                  }}
                >
                  <div style={{ fontWeight: selected ? 600 : 400, fontSize: 13 }}>
                    {h.description || '—'}
                  </div>
                  <div className="text-sub text-xs" style={{ marginTop: 2 }}>
                    Gauge: {gl.toFixed(3)} {unitAbbr(h.unit)}
                    {h.vendor ? ` · ${h.vendor}` : ''}
                  </div>
                </div>
              );
            })
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
