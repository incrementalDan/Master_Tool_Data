import React from 'react';

// ToolDex — Chip
// Pill-shaped filter/selection control. `filter` is the round facet chip;
// `type` is the larger tool-type chip that takes a leading icon. Active state
// is the brand blue tint.

export function Chip({ variant = 'filter', active = false, onClick, className = '', style, children }) {
  const base = variant === 'type' ? 'type-chip' : 'chip';
  const cls = [base, active ? 'active' : '', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} onClick={onClick} style={style} aria-pressed={active}>
      {children}
    </button>
  );
}
