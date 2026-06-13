// Tool-type picker styled as a dropdown of grouped icon cards (Milling / Hole
// Making / Turning) — the same grouping as the landing-page search grid, instead
// of a plain <select>. Used by ToolForm.
import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { TOOL_TYPES, TOOL_TYPE_LABELS } from '../schema/toolSchema.js';
import { groupedToolTypes } from '../schema/toolFieldLayout.js';
import ToolTypeIcon from './icons/ToolTypeIcon.jsx';

const GROUPS = groupedToolTypes(TOOL_TYPES);

export default function ToolTypeDropdown({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDocClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="type-dropdown" ref={ref}>
      <button type="button" className="type-dropdown-trigger" disabled={disabled} onClick={() => setOpen(o => !o)}>
        <ToolTypeIcon type={value} size={20} />
        <span className="type-dropdown-current">{TOOL_TYPE_LABELS[value] || value}</span>
        <ChevronDown size={16} style={{ marginLeft: 'auto', flexShrink: 0 }} />
      </button>
      {open && (
        <div className="type-dropdown-panel">
          {GROUPS.map(group => (
            <div key={group.label}>
              <div className="type-group-label">{group.label}</div>
              <div className="type-grid">
                {group.types.map(type => (
                  <button
                    key={type}
                    type="button"
                    className={`type-tile ${value === type ? 'selected' : ''}`}
                    title={TOOL_TYPE_LABELS[type] || type}
                    onClick={() => { onChange(type); setOpen(false); }}
                  >
                    <span className="type-tile-icon"><ToolTypeIcon type={type} size={36} /></span>
                    <span className="type-tile-label">{TOOL_TYPE_LABELS[type] || type}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
