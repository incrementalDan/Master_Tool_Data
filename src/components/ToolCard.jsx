import { useNavigate } from 'react-router-dom';
import { Pencil, Copy, FileDown } from 'lucide-react';
import { TOOL_TYPE_LABELS } from '../schema/toolSchema.js';
import ToolTypeIcon from './icons/ToolTypeIcon.jsx';
import { useApp } from '../context/AppContext.jsx';
import { exportSingleTool as exportProShop } from '../utils/proShopExport.js';

function formatDim(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n.toFixed(4).replace(/\.?0+$/, '');
}

function proshotUrl(id) {
  if (!id) return null;
  const prefix = id.split('-')[0];
  return `https://americanprecisionworks.adionsystems.com/procnc/tools/${prefix}/${id}$`;
}

export default function ToolCard({ tool, variant = 'grid' }) {
  const navigate = useNavigate();
  const { cloneTool, notify, holders } = useApp();
  const label = TOOL_TYPE_LABELS[tool.tool_type] || tool.tool_type;

  const open = () => navigate(`/tool/${tool.id}`);
  const stop = (e, fn) => { e.stopPropagation(); fn(); };

  const handleClone = async () => {
    try {
      const created = await cloneTool(tool.id);
      navigate(`/tool/${created.id}`);
    } catch { /* error toast handled in context */ }
  };

  const actions = (
    <div className="card-actions" onClick={e => e.stopPropagation()}>
      <button className="icon-btn" title="Edit" onClick={e => stop(e, () => navigate(`/tool/${tool.id}?edit=1`))}>
        <Pencil size={14} />
      </button>
      <button className="icon-btn" title="Duplicate" onClick={e => stop(e, handleClone)}>
        <Copy size={14} />
      </button>
      <button className="icon-btn" title="Export ProShop CSV" onClick={e => stop(e, () => { exportProShop(tool); notify('Exported ProShop CSV', 'success'); })}>
        <FileDown size={14} />
      </button>
    </div>
  );

  const hasMachineNum = tool.machine_tool_number !== null && tool.machine_tool_number !== undefined && tool.machine_tool_number !== '';

  const selectedHolder = tool.selected_holder_guid
    ? holders.find(h => h.guid === tool.selected_holder_guid)
    : null;

  const badges = (
    <div className="tool-card-meta">
      {hasMachineNum && (
        <span className="machine-num-badge" title="Machine Tool #">
          T{tool.machine_tool_number}
        </span>
      )}
      {formatDim(tool.diameter) && <span className="meta-badge">⌀ {formatDim(tool.diameter)}"</span>}
      {tool.number_of_flutes && <span className="meta-badge">{tool.number_of_flutes}FL</span>}
      {tool.vendor && <span className="meta-badge truncate" style={{ maxWidth: 120 }}>{tool.vendor}</span>}
      {tool.coating && <span className="meta-badge">{tool.coating}</span>}
      {tool.preferred_machine && (
        <span className="meta-badge meta-badge-blue">{tool.preferred_machine}</span>
      )}
      {tool.location && (
        <span className="location-tag" title="Location">{tool.location}</span>
      )}
      {tool.proshot_id && (
        <a
          className="proshot-pill font-mono"
          href={proshotUrl(tool.proshot_id)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
        >{tool.proshot_id}</a>
      )}
      {selectedHolder && (
        <span className="holder-pill truncate" style={{ maxWidth: 160 }} title={`Holder: ${selectedHolder.description}`}>
          {selectedHolder.description}
        </span>
      )}
    </div>
  );

  if (variant === 'list') {
    return (
      <div className="tool-row" onClick={open}>
        <span className="tool-row-icon"><ToolTypeIcon type={tool.tool_type} size={24} /></span>
        <div className="tool-row-main">
          <span className="tool-row-title description-badge truncate" style={{ display: 'inline-block', fontSize: 13 }}>{tool.description || '—'}</span>
          <span className="tool-card-type">{label}</span>
        </div>
        {badges}
        {actions}
      </div>
    );
  }

  return (
    <div className="tool-card" onClick={open}>
      <div className="tool-card-header">
        <span className="tool-card-icon"><ToolTypeIcon type={tool.tool_type} size={26} /></span>
        <div className="tool-card-type" style={{ flex: 1, alignSelf: 'center' }}>{label}</div>
        {actions}
      </div>
      <div className="tool-card-desc description-badge">{tool.description || '—'}</div>
      {badges}
    </div>
  );
}
