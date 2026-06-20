import React from 'react';

// ToolDex — SegmentedToggle
// A connected group of mutually-exclusive options (unit pickers, mode
// switches, in/mm). The active option gets the blue tint.

export function SegmentedToggle({ options = [], value, onChange, className = '', style }) {
  return (
    <div className={['btn-toggle', className].filter(Boolean).join(' ')} style={style} role="group">
      {options.map(opt => {
        const val = typeof opt === 'string' ? opt : opt.value;
        const label = typeof opt === 'string' ? opt : opt.label;
        return (
          <button
            key={val}
            type="button"
            className={val === value ? 'active' : ''}
            aria-pressed={val === value}
            onClick={() => onChange && onChange(val)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
