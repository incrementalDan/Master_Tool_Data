import { CircleCheck, Archive, FlaskConical } from 'lucide-react';
import { statusOf, statusMeta } from '../utils/toolStatus.js';

// THE tool-status badge, everywhere a tool's lifecycle is shown. Follows the
// `--badge-color` data-field token pattern (see CLAUDE.md → Data-field visual
// tokens): the class derives its fill/border/text from one custom property the
// host sets, so a status can never render two different ways on two screens.
//
// ⚠️ ACTIVE RENDERS NOTHING by default. Active is the normal state and the great
// majority of the library — a badge on every card would be wallpaper by day two,
// and the whole point is that a tool which ISN'T active stands out. Pass
// `showActive` where the state has to be explicit anyway (the edit form).
const ICONS = { active: CircleCheck, retired: Archive, beta: FlaskConical };

export default function StatusBadge({ tool, status, showActive = false, size = 12, className = '' }) {
  const id = status || statusOf(tool);
  if (id === 'active' && !showActive) return null;
  const meta = statusMeta(id);
  const Icon = ICONS[id] || CircleCheck;
  return (
    <span
      className={`status-badge ${className}`}
      style={{ '--badge-color': meta.color }}
      title={`${meta.label} — ${meta.tip}`}
    >
      <Icon size={size} /> {meta.label}
    </span>
  );
}
