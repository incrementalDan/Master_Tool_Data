import { TOOL_TYPES, TOOL_TYPE_LABELS } from '../schema/toolSchema.js';
import { groupedToolTypes } from '../schema/toolFieldLayout.js';
import ToolTypeIcon from './icons/ToolTypeIcon.jsx';

// Tool-type groups (Milling / Hole Making / Turning) live in toolFieldLayout.js so
// the landing-page grid and the edit-form type dropdown stay in sync. "Other"
// catches any newly-added TOOL_TYPES entry so it never silently disappears.
const GROUPS = groupedToolTypes(TOOL_TYPES);

// `selected` is an array of currently-selected tool types. A plain click selects
// just that one type (replacing any previous selection); shift-click is additive,
// keeping the previous selection so multiple types (e.g. "flat end mill" and "bull
// nose end mill") can be searched at once. `onSelect` receives (type, additive).
//
// `allowedTypes` — optional Set of type strings. When provided, only types in the
// set are shown (e.g. types that have at least one tool in the library). Currently
// selected types are always shown even if absent from allowedTypes so the active
// filter tile never disappears mid-session.
export default function ToolTypeGrid({ selected, onSelect, allowedTypes }) {
  return (
    <div>
      {GROUPS.map(group => {
        const visible = allowedTypes
          ? group.types.filter(t => allowedTypes.has(t) || selected.includes(t))
          : group.types;
        if (visible.length === 0) return null;
        return (
          <div key={group.label}>
            <div className="type-group-label">{group.label}</div>
            <div className="type-grid">
              {visible.map(type => (
                <button
                  key={type}
                  className={`type-tile ${selected.includes(type) ? 'selected' : ''}`}
                  onClick={(e) => onSelect(type, e.shiftKey)}
                  title={`${TOOL_TYPE_LABELS[type] || type} — shift-click to select multiple`}
                >
                  <span className="type-tile-icon"><ToolTypeIcon type={type} size={36} /></span>
                  <span className="type-tile-label">{TOOL_TYPE_LABELS[type] || type}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
