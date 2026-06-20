import React from 'react';

// ToolDex — IconButton
// 28×28 square icon-only control. Used in toolbars, card hover-actions, and
// view toggles. `active` gives the blue-tint selected treatment.

export function IconButton({ active = false, disabled = false, title, onClick, className = '', style, children }) {
  const cls = ['icon-btn', active ? 'active' : '', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} disabled={disabled} title={title} onClick={onClick} style={style} aria-label={title}>
      {children}
    </button>
  );
}
