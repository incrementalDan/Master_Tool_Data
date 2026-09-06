// The tool page's collapsible panel — ONE component, shared by the view and the
// edit form.
//
// It was two: ToolDetail's took `defaultOpen`, ToolForm's was always open with a
// `forceOpen` escape hatch and an extra `mb-16`. Two components rendering the
// same markup is how the two screens drift, which is the whole reason for the
// unification (see docs/TOOL_PAGE_UNIFICATION_PLAN.md) — so this is the superset
// of both, and each caller passes what it used to have.
import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export default function ToolSection({
  title, icon: Icon, children,
  defaultOpen = true,
  // A collapsed section must not be able to hide a pending decision — a scan
  // proposal in this section forces it open.
  forceOpen = false,
  // ⚠️ Carries the form's `mb-16`. `.panel` is 8px; the edit form overrides it
  // to 16px, and dropping that on the way through here would quietly reflow
  // every section on that screen.
  className = '',
}) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { if (forceOpen) setOpen(true); }, [forceOpen]);
  return (
    <div className={`panel ${open ? 'open' : ''} ${className}`}>
      <button className="panel-header" onClick={() => setOpen(o => !o)}>
        {Icon && <Icon size={15} className="panel-header-icon" />}
        <span className="panel-header-title">{title}</span>
        <span className="panel-chevron">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </button>
      {open && <div className="panel-body">{children}</div>}
    </div>
  );
}
