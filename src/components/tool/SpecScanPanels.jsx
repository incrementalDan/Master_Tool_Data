// The "Scan spec sheet" review UI for an EXISTING tool: the summary bar and the
// purchasing sub-diff. Lifted verbatim out of ToolForm — see
// docs/TOOL_PAGE_UNIFICATION_PLAN.md, Phase 2.
//
// ⚠️ Purchasing is a sub-DIFF, not a field row: it is {manufacturers[],
// vendors[]} with FK links, so it gets entity-level row matching rather than a
// single accept/reject. See src/schema/extractionDiff.js.
import { ScanLine, Check, X, AlertTriangle, Undo2, ShoppingCart } from 'lucide-react';
import { unitAbbr } from '../../utils/units.js';

// ── Spec-sheet summary bar ───────────────────────────────────────────────────
// The count is the whole point: it says how many decisions are outstanding, so
// a pending row can never be lost simply by not scrolling to it.
export default function SpecSummary({
  pending, accepted, typeNotice, onAcceptAll, onDiscard,
  sourceFile, keepSourceFile, onKeepSourceFile, canAttach,
}) {
  return (
    <div className={`spec-summary ${pending > 0 ? 'has-pending' : ''} mb-16`}>
      <div className="spec-summary-row">
        <ScanLine size={15} style={{ color: 'var(--blue)', flexShrink: 0 }} />
        <span className="spec-summary-counts">
          {pending > 0
            ? <><strong>{pending}</strong> difference{pending !== 1 ? 's' : ''} to review</>
            : <>All spec-sheet differences reviewed</>}
          {accepted > 0 && <span className="text-sub"> · {accepted} applied</span>}
        </span>
        <span style={{ flex: 1 }} />
        {pending > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onAcceptAll}>
            <Check size={13} /> Update all
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDiscard} title="Put every value back and drop the scan">
          <Undo2 size={13} /> Discard scan
        </button>
      </div>
      <p className="spec-summary-note">
        Nothing is saved until you press Save. Presets, assemblies, Tool ID, location
        and machine number are not touched by a scan.
      </p>
      {/* The sheet is kept as evidence for the values it produced. The choice
          lives here rather than in the upload modal so it is next to Save —
          the point at which it actually happens. */}
      {sourceFile && canAttach && (
        <label className="checkbox-row spec-summary-keep">
          <input type="checkbox" checked={keepSourceFile} onChange={e => onKeepSourceFile(e.target.checked)} />
          <span className="text-xs text-sub">
            Save <strong>{sourceFile.name}</strong> to this tool's Files, under
            {' '}<strong>Data Extraction</strong>
          </span>
        </label>
      )}
      {sourceFile && !canAttach && (
        <p className="spec-summary-note">
          Connect Google Drive to keep the spec sheet with this tool.
        </p>
      )}
      {typeNotice && (
        <p className="spec-summary-type">
          <AlertTriangle size={12} />
          The sheet looks like a <strong>{typeNotice.extractedType}</strong>, but this tool is a{' '}
          <strong>{typeNotice.currentType}</strong>. The type is not changed by a scan — use the Tool
          Type picker above if it is genuinely wrong.
        </p>
      )}
    </div>
  );
}

// ── Purchasing + homeless-field proposals ────────────────────────────────────
// Purchasing is {manufacturers[], vendors[]} with FK links, so it has no single
// input to sit under; the same is true of any proposal whose field this tool
// type doesn't render. Both land here so every difference has a visible home.
export function SpecPurchasingPanel({ rows, homeless, unit, newMfgAck, onAck, onResolveRow, onResolveField }) {
  const ackRow = rows.find(r => r.requiresAck);
  const fmt = (v) => (v === null || v === undefined || v === '' ? 'empty' : String(v));

  const Row = ({ label, current, proposed, status, note, disabled, onAccept, onReject }) => (
    <div className={`spec-row spec-proposal-${status}`}>
      <div className="spec-row-label">{label}</div>
      <div className="spec-row-values">
        {status === 'rejected'
          ? <><s>{fmt(proposed)}</s> <span className="text-sub">— ignored</span></>
          : <><s>{fmt(current)}</s> → <strong>{fmt(proposed)}</strong></>}
        {note && <span className="spec-proposal-note"> · {note}</span>}
      </div>
      <div className="spec-row-actions">
        {status === 'pending' ? (
          <>
            <button type="button" className="spec-proposal-btn accept" onClick={onAccept} disabled={disabled}>
              <Check size={11} /> Update
            </button>
            <button type="button" className="spec-proposal-btn" onClick={onReject}>
              <X size={11} /> Keep
            </button>
          </>
        ) : (
          <button type="button" className="spec-proposal-btn"
            onClick={status === 'accepted' ? onReject : onAccept} disabled={status !== 'accepted' && disabled}>
            <Undo2 size={11} /> {status === 'accepted' ? 'Undo' : 'Update'}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="panel open mb-16 spec-panel">
      <div className="panel-header static">
        <ShoppingCart size={15} className="panel-header-icon" />
        <span className="panel-header-title">From the spec sheet</span>
      </div>
      <div className="panel-body">
        {ackRow && (
          <div className="warn-banner spec-ack">
            <label className="checkbox-row">
              <input type="checkbox" checked={newMfgAck} onChange={e => onAck(e.target.checked)} />
              <span className="text-sm">
                This sheet is for <strong>{ackRow.proposed}</strong>, not{' '}
                <strong>{ackRow.current}</strong>. I know the manufacturer is different —
                add it as an additional maker.
              </span>
            </label>
            <p className="text-xs text-sub" style={{ margin: '6px 0 0 24px' }}>
              The existing manufacturer is kept either way; nothing is replaced.
            </p>
          </div>
        )}

        {homeless.map(p => (
          <Row
            key={p.field}
            label={p.label}
            current={p.current}
            proposed={p.proposed}
            status={p.status}
            note={p.converted ? `converted from in to ${unitAbbr(unit)}` : null}
            onAccept={() => onResolveField(p.field, 'accept')}
            onReject={() => onResolveField(p.field, 'reject')}
          />
        ))}

        {rows.map(r => (
          <Row
            key={r.key}
            label={r.label}
            current={r.current}
            proposed={r.proposed}
            status={r.status}
            note={r.note || (r.generated ? 'auto-generated link' : null)}
            disabled={r.requiresAck && !newMfgAck}
            onAccept={() => onResolveRow(r.key, 'accept')}
            onReject={() => onResolveRow(r.key, 'reject')}
          />
        ))}
      </div>
    </div>
  );
}
