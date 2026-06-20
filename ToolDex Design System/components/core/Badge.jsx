import React from 'react';

// ToolDex — Badge
// Neutral meta badge for inline facts on cards (diameter, flute count, vendor).
// Variants add a blue or orange accent. For TYPED data (descriptions, IDs,
// machine #s) use DataBadge instead.

export function Badge({ variant = 'neutral', className = '', style, children }) {
  const cls = [
    'meta-badge',
    variant === 'blue' ? 'meta-badge-blue' : variant === 'orange' ? 'meta-badge-orange' : '',
    className,
  ].filter(Boolean).join(' ');
  return <span className={cls} style={style}>{children}</span>;
}
