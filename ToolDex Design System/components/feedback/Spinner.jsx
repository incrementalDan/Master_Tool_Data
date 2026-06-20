import React from 'react';

// ToolDex — Spinner
// The single loading indicator. A blue-topped ring. Compose with a label for
// full-screen loading states.

export function Spinner({ size = 28, borderWidth = 3, className = '', style }) {
  return (
    <span
      className={['spinner', className].filter(Boolean).join(' ')}
      style={{ width: size, height: size, borderWidth, ...style }}
      role="status"
      aria-label="Loading"
    />
  );
}
