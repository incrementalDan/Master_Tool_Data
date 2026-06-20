import React from 'react';

// ToolDex — Banner
// Full-width inline notice for setup/status conditions (warning, info, error).
// Pair with a leading lucide icon and an optional action button on the right.

export function Banner({ tone = 'info', icon, action, className = '', style, children }) {
  const cls = tone === 'warn' ? 'banner-warn' : tone === 'error' ? 'error-banner' : 'banner-info';
  return (
    <div
      className={[cls, className].filter(Boolean).join(' ')}
      role={tone === 'info' ? 'status' : 'alert'}
      style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', ...style }}
    >
      {icon}
      <span style={{ flex: 1, minWidth: 200 }}>{children}</span>
      {action}
    </div>
  );
}
