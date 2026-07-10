import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

// Fixed bottom-right toast stack. Driven by the toasts array + dismiss fn from context.
const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

export default function ToastStack({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack">
      {toasts.map(t => {
        const Icon = ICONS[t.type] || Info;
        return (
          <div key={t.id} className={`toast toast-${t.type}`} role="status">
            <Icon size={16} className="toast-icon" />
            <span className="toast-msg">{t.message}</span>
            <button className="toast-close" onClick={() => onDismiss(t.id)} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
