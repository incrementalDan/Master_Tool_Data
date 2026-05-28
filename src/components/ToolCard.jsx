import { useNavigate } from 'react-router-dom';
import { TOOL_TYPE_ICONS, TOOL_TYPE_LABELS } from '../schema/toolSchema.js';

export default function ToolCard({ tool }) {
  const navigate = useNavigate();

  const icon = TOOL_TYPE_ICONS[tool.tool_type] || '🔧';
  const label = TOOL_TYPE_LABELS[tool.tool_type] || tool.tool_type;

  const formatDim = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : n.toFixed(4).replace(/\.?0+$/, '');
  };

  return (
    <div className="tool-card" onClick={() => navigate(`/tool/${tool.id}`)}>
      <div className="tool-card-header">
        <span className="tool-card-icon">{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="tool-card-type">{label}</div>
          <div className="tool-card-title truncate">{tool.description || '—'}</div>
        </div>
      </div>

      <div className="tool-card-meta">
        {formatDim(tool.diameter) && (
          <span className="meta-badge">⌀ {formatDim(tool.diameter)}"</span>
        )}
        {tool.number_of_flutes && (
          <span className="meta-badge">{tool.number_of_flutes}FL</span>
        )}
        {tool.vendor && (
          <span className="meta-badge truncate" style={{ maxWidth: 120 }}>{tool.vendor}</span>
        )}
        {tool.coating && (
          <span className="meta-badge">{tool.coating}</span>
        )}
        {tool.preferred_machine && (
          <span className="meta-badge" style={{ color: 'var(--blue)', borderColor: 'var(--blue)' }}>
            {tool.preferred_machine}
          </span>
        )}
        {tool.proshot_id && (
          <span className="meta-badge" style={{ color: 'var(--orange)', borderColor: 'var(--orange)', fontFamily: 'monospace', fontSize: 10 }}>
            {tool.proshot_id}
          </span>
        )}
      </div>
    </div>
  );
}
