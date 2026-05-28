import { TOOL_TYPES, TOOL_TYPE_LABELS, TOOL_TYPE_ICONS } from '../schema/toolSchema.js';

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
          <span className="type-tile-icon">{TOOL_TYPE_ICONS[type] || '🔧'}</span>
          <span className="type-tile-label">{TOOL_TYPE_LABELS[type] || type}</span>
        </button>
      ))}
    </div>
  );
}
