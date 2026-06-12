import { TOOL_TYPES, TOOL_TYPE_LABELS } from '../schema/toolSchema.js';
import ToolTypeIcon from './icons/ToolTypeIcon.jsx';

// Grouped the way Fusion's tool-type picker groups (Milling / Hole Making / Turning),
// but ordered within each group by how often the shop actually reaches for them —
// not Fusion's internal order. Tap is a single tile (left/right hand is a metadata
// field on the unified `tap` type, not a separate tool type — see toolSchema.js).
// Anything missing from a group below falls into "Other" so a newly-added TOOL_TYPES
// entry never silently disappears from the grid.
const TYPE_GROUPS = [
  {
    label: 'Milling',
    types: [
      'flat end mill', 'ball end mill', 'bull nose end mill', 'chamfer mill', 'face mill',
      'radius mill', 'tapered mill', 'thread mill', 'slot/key cutter', 'lollipop mill',
      'dovetail', 'form mill',
      'circle segment barrel', 'circle segment lens', 'circle segment oval', 'circle segment taper',
    ],
  },
  {
    label: 'Hole Making',
    // boring head is a milling-machine hole-making tool (bores an existing hole on
    // the mill) — distinct from a turning boring bar (a lathe tool, not in TOOL_TYPES).
    types: ['drill', 'tap', 'spot drill', 'center drill', 'counter sink', 'counter bore', 'reamer', 'boring head'],
  },
  {
    label: 'Turning',
    types: ['turning general'],
  },
];

const GROUPED_TYPES = new Set(TYPE_GROUPS.flatMap(g => g.types));
const LEFTOVER_TYPES = TOOL_TYPES.filter(t => !GROUPED_TYPES.has(t));
const GROUPS = LEFTOVER_TYPES.length ? [...TYPE_GROUPS, { label: 'Other', types: LEFTOVER_TYPES }] : TYPE_GROUPS;

// `selected` is an array of currently-selected tool types — clicking a tile
// toggles its membership, so multiple types (e.g. "flat end mill" and "bull
// nose end mill") can be searched at once.
export default function ToolTypeGrid({ selected, onSelect }) {
  return (
    <div>
      {GROUPS.map(group => (
        <div key={group.label}>
          <div className="type-group-label">{group.label}</div>
          <div className="type-grid">
            {group.types.map(type => (
              <button
                key={type}
                className={`type-tile ${selected.includes(type) ? 'selected' : ''}`}
                onClick={() => onSelect(type)}
                title={TOOL_TYPE_LABELS[type] || type}
              >
                <span className="type-tile-icon"><ToolTypeIcon type={type} size={36} /></span>
                <span className="type-tile-label">{TOOL_TYPE_LABELS[type] || type}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
