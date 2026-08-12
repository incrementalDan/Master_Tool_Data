// Pick a tool to link to the one being viewed (a tap and its drill, a reamer and
// its drill). A small overlay over the library, not a second search page:
// `textSearch` + `sortResults` are the SAME functions the landing page runs, so
// what you type here behaves exactly like the main search box — including
// matching a ProShop #, an EDP#, a vendor number or a retired ID, and floating
// an exact ID match to the top.
import { useState, useMemo } from 'react';
import { Search, X } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { textSearch, sortResults } from '../services/searchEngine.js';
import { TOOL_TYPE_LABELS } from '../schema/toolSchema.js';
import ToolTypeIcon from './icons/ToolTypeIcon.jsx';
import { unitAbbr } from '../utils/units.js';

const fmtDia = (v) => {
  const n = parseFloat(v);
  return isNaN(n) ? null : n.toFixed(4).replace(/\.?0+$/, '');
};

// Description A–Z within a relevance tier — a stable order, so the list doesn't
// reshuffle as you type.
const byDescription = (a, b) => String(a.description || '').localeCompare(String(b.description || ''));

export default function ToolLinkPicker({ tool, onPick, onClose }) {
  const { tools } = useApp();
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');

  // The tool itself and anything already linked are removed rather than shown
  // greyed out — every row here is actionable.
  const already = new Set([tool.id, ...(tool.linked_tools || [])]);

  const candidates = useMemo(
    () => (tools || []).filter(t => !already.has(t.id)),
    [tools, tool.id, tool.linked_tools],   // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Only the types actually present, so the dropdown can't offer a dead end.
  const types = useMemo(() => {
    const s = new Set(candidates.map(t => t.tool_type).filter(Boolean));
    return [...s].sort((a, b) =>
      (TOOL_TYPE_LABELS[a] || a).localeCompare(TOOL_TYPE_LABELS[b] || b));
  }, [candidates]);

  const results = useMemo(() => {
    let list = type ? candidates.filter(t => t.tool_type === type) : candidates;
    list = textSearch(list, query);
    return sortResults(list, query, byDescription).slice(0, 60);
  }, [candidates, query, type]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal tool-link-picker" style={{ width: '100%', maxWidth: 640 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <h3 className="modal-title" style={{ flex: 1, margin: 0 }}>Link a tool</h3>
          <button className="icon-btn" onClick={onClose} title="Close"><X size={16} /></button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <div className="tool-link-search">
            <Search size={14} />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="ProShop #, EDP#, description…"
            />
          </div>
          <select className="input" style={{ maxWidth: 180 }} value={type} onChange={e => setType(e.target.value)}>
            <option value="">All types</option>
            {types.map(t => <option key={t} value={t}>{TOOL_TYPE_LABELS[t] || t}</option>)}
          </select>
        </div>

        <div className="tool-link-results">
          {results.length === 0 && (
            <div className="text-sub text-sm" style={{ padding: 16, textAlign: 'center' }}>
              {query || type ? 'No tools match.' : 'Start typing to find a tool.'}
            </div>
          )}
          {results.map(t => (
            <button key={t.id} className="tool-link-result" onClick={() => onPick(t)}>
              <ToolTypeIcon type={t.tool_type} size={20} />
              <span className="tool-link-result-main">
                <span className="tool-link-result-desc">{t.description || '—'}</span>
                <span className="text-sub" style={{ fontSize: 11 }}>
                  {TOOL_TYPE_LABELS[t.tool_type] || t.tool_type}
                  {fmtDia(t.diameter) && <> · <span className="dia">⌀</span> {fmtDia(t.diameter)} {unitAbbr(t.unit)}</>}
                </span>
              </span>
              {t.tool_id && <span className="tool-id-pill font-mono" style={{ fontSize: 10, padding: '1px 7px' }}>{t.tool_id}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
