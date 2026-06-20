import React from 'react';

// ToolDex — Button
// The action primitive. Variants map to intent; brand blue is "primary".
// Hover brightens, active nudges down 1px (functional, not bouncy).

export function Button({
  variant = 'secondary',
  size = 'md',
  disabled = false,
  type = 'button',
  onClick,
  className = '',
  style,
  children,
}) {
  const cls = [
    'btn',
    `btn-${variant}`,
    size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button type={type} className={cls} disabled={disabled} onClick={onClick} style={style}>
      {children}
    </button>
  );
}
