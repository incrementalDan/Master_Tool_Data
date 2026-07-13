import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Info } from 'lucide-react';
import { fieldLabel } from '../schema/fieldRegistry.js';

const INFO_KIND_LABEL = { preset: 'preset', ooh: 'assembly stick-out', holder: 'assembly holder' };

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
  // Scalar field rows are resolvable per-field (Keep Fusion / Keep app). Info rows
  // (preset / OOH / holder that both sides changed) are non-actionable here —
  // they're surfaced so the both-edited conflict doesn't vanish with the toast, and
  // are resolved in Sync Job (#2).
  const fieldDrift = drift.filter(d => d.field);
  const infoDrift = drift.filter(d => d.kind && !d.field);
  // Stale tracking-ID: this tool's Fusion instances carry different product IDs
  // under one tracking ID — someone copied it in Fusion, re-numbered the product
  // ID, and left the app's tracking ID behind. Surfaced (never silently merged).
  const pidConflict = tool._productIdConflict || null;
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState(
    () => Object.fromEntries(fieldDrift.map(d => [d.field, authority === 'app' ? 'app' : 'fusion'])),
  );

  if (drift.length === 0 && !pidConflict) return null;

  const setAll = (choice) => setRes(Object.fromEntries(fieldDrift.map(d => [d.field, choice])));
  const unit = tool.unit;
  const headerLabel = fieldDrift.length > 0
    ? `Differs from Fusion in ${fieldDrift.length} field${fieldDrift.length !== 1 ? 's' : ''}`
    : `Fusion also changed ${infoDrift.length} value${infoDrift.length !== 1 ? 's' : ''} you edited`;

  return (
    <>
      {pidConflict && (
        <div className="drift-banner" style={{
          border: '1px solid var(--orange)', borderRadius: 'var(--radius)',
          background: 'color-mix(in srgb, var(--orange) 8%, transparent)',
          marginBottom: 16, overflow: 'hidden',
        }}>
          <div className="panel-body" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: 12 }}>
            <AlertTriangle size={15} style={{ color: 'var(--orange)', flexShrink: 0, marginTop: 2 }} />
            <span className="text-sm">
              This tool’s Fusion entries have different product IDs
              {' '}(<span className="font-mono" style={{ color: 'var(--text)' }}>{pidConflict.join(', ')}</span>)
              {' '}under one tracking ID — likely a tool copied in Fusion and given a new product ID
              without clearing the app’s tracking ID in its comment. Two different tools may be
              linked as one. <strong>Review in Fusion</strong> and give each its own tracking ID.
            </span>
          </div>
        </div>
      )}
      {drift.length > 0 && (
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
          {headerLabel}
          <span className="text-sub" style={{ fontWeight: 400, marginLeft: 6, fontSize: 12 }}>
            — someone edited this tool in Fusion. Review before it syncs.
          </span>
        </span>
        <span className="panel-chevron">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </button>

      {open && (
        <div className="panel-body" style={{ paddingTop: 4 }}>
          {fieldDrift.length > 0 && (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setAll('fusion')}>Keep all Fusion</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setAll('app')}>Keep all app</button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '6px 14px', alignItems: 'center' }}>
                <div className="text-xs text-sub" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Field</div>
                <div className="text-xs text-sub" style={{ fontWeight: 600, textAlign: 'center' }}>Keep Fusion</div>
                <div className="text-xs text-sub" style={{ fontWeight: 600, textAlign: 'center' }}>Keep app</div>

                {fieldDrift.map(d => (
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
            </>
          )}

          {infoDrift.length > 0 && (
            <div style={{ marginTop: fieldDrift.length > 0 ? 14 : 0, display: 'grid', gap: 6 }}>
              {infoDrift.map((d, i) => (
                <div key={i} className="text-sm" style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                  <Info size={14} style={{ color: 'var(--orange)', flexShrink: 0, marginTop: 2 }} />
                  <span>
                    Fusion also changed a {INFO_KIND_LABEL[d.kind] || d.kind}
                    {d.label ? <> (<span className="font-mono" style={{ color: 'var(--text)' }}>{d.label}</span>)</> : null}
                    {' '}you had edited — your edit was kept. <strong>Open Sync Job</strong> to review Fusion’s version.
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
      )}
    </>
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
