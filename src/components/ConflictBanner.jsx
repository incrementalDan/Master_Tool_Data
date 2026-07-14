import { AlertTriangle } from 'lucide-react';
import { fieldLabel } from '../schema/fieldRegistry.js';
import { displayConflicts } from '../utils/toolConflicts.js';
import { useApp } from '../context/AppContext.jsx';

// "Informed, not blocked" conflict review, shown on the tool page. A conflict is
// a shared-value disagreement flagged during Fusion import / normalize (e.g. two
// instances with different flute lengths, or different product IDs under one
// tracking ID). The tool came in fully merged (primary/ProShop value kept); this
// lets the user resolve the disagreement when they go to use the tool. A conflict
// is NEVER auto-cleared — a ProShop import may overwrite the value, but the badge
// stays until the user acts here. See src/utils/toolConflicts.js.

function fmt(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const n = Number(v);
  if (!isNaN(n) && v !== '') return String(Math.round(n * 10000) / 10000);
  return String(v);
}

export default function ConflictBanner({ tool }) {
  const { resolveToolConflict, isSaving } = useApp();
  const conflicts = displayConflicts(tool);
  if (conflicts.length === 0) return null;

  return (
    <div className="conflict-banner" style={{
      border: '1px solid var(--orange)', borderRadius: 'var(--radius)',
      background: 'color-mix(in srgb, var(--orange) 8%, transparent)',
      marginBottom: 16, overflow: 'hidden',
    }}>
      <div className="panel-header" style={{ background: 'transparent' }}>
        <AlertTriangle size={15} style={{ color: 'var(--orange)', flexShrink: 0 }} />
        <span className="panel-header-title" style={{ color: 'var(--text)' }}>
          {conflicts.length} unresolved difference{conflicts.length !== 1 ? 's' : ''}
          <span className="text-sub" style={{ fontWeight: 400, marginLeft: 6, fontSize: 12 }}>
            — flagged during import. Pick the correct value, then it clears.
          </span>
        </span>
      </div>

      <div className="panel-body" style={{ display: 'grid', gap: 12, paddingTop: 4 }}>
        {conflicts.map(c => (
          c.type === 'product_id'
            ? <ProductIdRow key={c.id} c={c} disabled={isSaving}
                onClear={() => resolveToolConflict(tool.id, c.id)} />
            : <FieldRow key={c.id} c={c} unit={tool.unit} current={tool[c.field]} disabled={isSaving}
                onKeep={() => resolveToolConflict(tool.id, c.id)}
                onUse={(v) => resolveToolConflict(tool.id, c.id, v)} />
        ))}
      </div>
    </div>
  );
}

function FieldRow({ c, unit, current, onKeep, onUse, disabled }) {
  const [kept, other] = c.values || [];
  return (
    <div>
      <div className="text-sm" style={{ fontWeight: 600 }}>{fieldLabel(c.field, unit) || c.field}</div>
      <div className="text-xs text-sub" style={{ marginBottom: 6 }}>
        Instances disagreed — current value is{' '}
        <span className="font-mono" style={{ color: 'var(--text)' }}>{fmt(current)}</span>.
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost btn-sm" disabled={disabled} onClick={onKeep}>
          Keep <span className="font-mono">{fmt(kept)}</span>
        </button>
        {!Object.is(fmt(kept), fmt(other)) && (
          <button className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => onUse(other)}>
            Use <span className="font-mono">{fmt(other)}</span>
          </button>
        )}
      </div>
    </div>
  );
}

function ProductIdRow({ c, onClear, disabled }) {
  return (
    <div>
      <div className="text-sm" style={{ fontWeight: 600 }}>Different product IDs under one tracking ID</div>
      <div className="text-xs text-sub" style={{ marginBottom: 6 }}>
        Found <span className="font-mono" style={{ color: 'var(--text)' }}>{(c.values || []).join(', ')}</span>
        {' '}— likely a tool copied in Fusion and re-numbered without clearing the app’s tracking ID.
        Fix it in Fusion (give each its own tracking ID), then mark reviewed.
      </div>
      <button className="btn btn-ghost btn-sm" disabled={disabled} onClick={onClear}>Mark reviewed</button>
    </div>
  );
}
