import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { fieldLabel } from '../schema/fieldRegistry.js';

// D3 — Fusion drift review. When a linked tool's live Fusion values differ from
// the app's stored copy (someone edited the tool directly in Fusion 360), this
// surfaces the difference field-by-field for confirmation — nothing is ever
// silently overwritten. The shop `authority` ('fusion' | 'app') pre-selects the
// default winner per field; the user can change any of them, then Apply.
//   Keep Fusion → adopt Fusion's value into the app record.
//   Keep app    → push the app's value back to Fusion.
// See tool._drift (buildLogicalTool / detectFusionDrift) and
// PHASE_A_TOOL_RECORD_SCHEMA.md §10.

function fmt(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const n = Number(v);
  if (!isNaN(n) && v !== '') return String(Math.round(n * 10000) / 10000);
  return String(v);
}

export default function DriftBanner({ tool, authority = 'fusion', isSaving, onApply }) {
  const drift = tool._drift || [];
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState(
    () => Object.fromEntries(drift.map(d => [d.field, authority === 'app' ? 'app' : 'fusion'])),
  );

  if (drift.length === 0) return null;

  const setAll = (choice) => setRes(Object.fromEntries(drift.map(d => [d.field, choice])));
  const unit = tool.unit;

  return (
    <div className="drift-banner" style={{
      border: '1px solid var(--orange)', borderRadius: 'var(--radius)',
      background: 'color-mix(in srgb, var(--orange) 8%, transparent)',
      marginBottom: 16, overflow: 'hidden',
    }}>
      <button
        className="panel-header"
        style={{ width: '100%', background: 'transparent', border: 'none' }}
        onClick={() => setOpen(o => !o)}
      >
        <AlertTriangle size={15} style={{ color: 'var(--orange)', flexShrink: 0 }} />
        <span className="panel-header-title" style={{ color: 'var(--text)' }}>
          Differs from Fusion in {drift.length} field{drift.length !== 1 ? 's' : ''}
          <span className="text-sub" style={{ fontWeight: 400, marginLeft: 6, fontSize: 12 }}>
            — someone edited this tool in Fusion. Review before it syncs.
          </span>
        </span>
        <span className="panel-chevron">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </button>

      {open && (
        <div className="panel-body" style={{ paddingTop: 4 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setAll('fusion')}>Keep all Fusion</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setAll('app')}>Keep all app</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '6px 14px', alignItems: 'center' }}>
            <div className="text-xs text-sub" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Field</div>
            <div className="text-xs text-sub" style={{ fontWeight: 600, textAlign: 'center' }}>Keep Fusion</div>
            <div className="text-xs text-sub" style={{ fontWeight: 600, textAlign: 'center' }}>Keep app</div>

            {drift.map(d => (
              <DriftRow key={d.field} d={d} unit={unit}
                choice={res[d.field]}
                onChoose={(c) => setRes(r => ({ ...r, [d.field]: c }))} />
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
            <button className="btn btn-primary btn-sm" disabled={isSaving}
              onClick={() => onApply(res)}>
              {isSaving ? 'Applying…' : 'Apply & sync'}
            </button>
            <span className="text-xs text-sub">
              Writes the chosen value to both Fusion and the app for each field.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function DriftRow({ d, unit, choice, onChoose }) {
  return (
    <>
      <div style={{ minWidth: 0 }}>
        <div className="text-sm" style={{ fontWeight: 600 }}>{fieldLabel(d.field, unit) || d.field}</div>
        <div className="text-xs text-sub">
          Fusion <span className="font-mono" style={{ color: 'var(--text)' }}>{fmt(d.fusionValue)}</span>
          {' · '}app <span className="font-mono" style={{ color: 'var(--text)' }}>{fmt(d.appValue)}</span>
        </div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <input type="radio" name={`drift-${d.field}`} checked={choice === 'fusion'} onChange={() => onChoose('fusion')} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <input type="radio" name={`drift-${d.field}`} checked={choice === 'app'} onChange={() => onChoose('app')} />
      </div>
    </>
  );
}
