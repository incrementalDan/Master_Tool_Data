import { TOOL_TYPES, TOOL_TYPE_LABELS } from '../schema/toolSchema.js';
import ToolTypeIcon from './icons/ToolTypeIcon.jsx';

export default function ToolTypeGrid({ selected, onSelect }) {
  return (
    <div className="type-grid">
      {TOOL_TYPES.map(type => (
        <button
          key={type}
          className={`type-tile ${selected === type ? 'selected' : ''}`}
          onClick={() => onSelect(selected === type ? null : type)}
          title={TOOL_TYPE_LABELS[type] || type}
        >
          <span className="type-tile-icon"><ToolTypeIcon type={type} size={36} /></span>
          <span className="type-tile-label">{TOOL_TYPE_LABELS[type] || type}</span>
        </button>
      ))}
    </div>
  );
}
