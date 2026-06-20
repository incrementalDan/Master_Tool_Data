import React from 'react';

// ToolDex — Toast
// Bottom-right transient notification. Colored left border + icon by type.
// Render <ToastStack> with an array; the host owns timing/dismissal.
// Icons are inline SVG (lucide silhouettes) — dependency-free.

const Check = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.8 10A10 10 0 1 1 17 3.3" /><path d="m9 11 3 3L22 4" />
  </svg>
);
const Alert = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);
const Info = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
  </svg>
);
const X = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

const ICONS = { success: Check, error: Alert, info: Info };

export function Toast({ type = 'info', message, onDismiss }) {
  const Icon = ICONS[type] || Info;
  return (
    <div className={`toast toast-${type}`} role="status">
      <span className="toast-icon" style={{ display: 'inline-flex' }}><Icon /></span>
      <span className="toast-msg">{message}</span>
      {onDismiss && (
        <button type="button" className="icon-btn" style={{ width: 22, height: 22 }} onClick={onDismiss} aria-label="Dismiss">
          <X />
        </button>
      )}
    </div>
  );
}

export function ToastStack({ toasts = [], onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div style={{ position: 'fixed', bottom: 20, right: 20, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 2000, maxWidth: 360 }}>
      {toasts.map(t => (
        <Toast key={t.id} type={t.type} message={t.message} onDismiss={onDismiss ? () => onDismiss(t.id) : undefined} />
      ))}
    </div>
  );
}
