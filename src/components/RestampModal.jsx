// ─── Re-stamp preview: see every gauge change, set the tolerance, choose ────
//
// WHY THIS ISN'T A YES/NO CONFIRM. When a badly-modelled holder is corrected,
// every tool on it moves — sometimes by a lot, and that is exactly what was
// asked for. A fixed threshold would flag all forty of them and the warning
// becomes wallpaper. So the user sets the tolerance for THIS holder's fix, sees
// the old and new assembly gauge length for every affected tool, and decides.
//
// ⚠️ The tolerance is NOT remembered. It describes this one correction. Once
// these tools are re-stamped they match the holder and move by nothing on their
// own, so there is nothing left for a stored tolerance to quiet except the
// stragglers — a tool deselected here, or one that turns up later from Fusion
// still carrying the old holder. Those are exactly the ones worth flagging.

import { useState, useMemo, useEffect } from 'react';
import { X, RefreshCw, AlertTriangle } from 'lucide-react';
import {
  ASSEMBLY_GAUGE_WARN_IN, ASSEMBLY_GAUGE_IMPLAUSIBLE_MM, ASSEMBLY_GAUGE_IMPLAUSIBLE_IN,
} from '../schema/holderResolve.js';
import { formatHolderLen } from '../utils/holderGeometry.js';
import { unitAbbr } from '../utils/units.js';

const MM = 25.4;

export default function RestampModal({ preview, onPreview, onCommit, onClose }) {
  // Set in MILLIMETRES: holders are published in mm and the shop reasons about
  // this in mm ("more than 10mm would be very odd"). Held in inches to match the
  // cross-unit delta, converted at this boundary only. Starts at the standing
  // default every time — this is a per-correction judgement, not a setting.
  const [tolMm, setTolMm] = useState(() => ASSEMBLY_GAUGE_WARN_IN * MM);
  const tol = Math.min(tolMm / MM, ASSEMBLY_GAUGE_IMPLAUSIBLE_IN);
  const [excluded, setExcluded] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  // Re-grade against the live tolerance. Pure computation on the app's side —
  // nothing is written until Commit.
  useEffect(() => { onPreview?.(tol); }, [tol, onPreview]);

  const rows = useMemo(() => {
    const byTool = new Map();
    for (const c of preview?.checks || []) {
      if (!byTool.has(c.toolId)) byTool.set(c.toolId, { tool: c.tool, checks: [] });
      byTool.get(c.toolId).checks.push(c);
    }
    return [...byTool.values()].map(r => ({
      ...r,
      worst: r.checks.some(c => c.level === 'error') ? 'error'
        : r.checks.some(c => c.level === 'warn') ? 'warn' : 'ok',
      maxDelta: r.checks.reduce((m, c) => Math.max(m, Math.abs(c.deltaIn ?? 0)), 0),
    })).sort((a, b) => b.maxDelta - a.maxDelta);   // biggest movers first
  }, [preview]);

  const errorRows = rows.filter(r => r.worst === 'error');
  const unconfirmedRows = rows.filter(r => (preview?.unconfirmed || []).includes(r.tool.id));
  const oddRows = rows.filter(r => r.checks.some(c => c.implausible));
  const warnRows = rows.filter(r => r.worst === 'warn' && !r.checks.some(c => c.implausible));
  // A tool whose gauge couldn't be computed is never writable — excluded
  // structurally, not by choice, so it can't be selected back in.
  const selectable = rows.filter(r => r.worst !== 'error');
  // An implausible move starts UNTICKED. It can still be written — the data may
  // genuinely have been that wrong — but only by someone deliberately choosing
  // that one tool, never by dragging a tolerance up until the warnings stop.
  const isOdd = (r) => r.checks.some(c => c.implausible);
  // ⚠️ AND a tool whose link to this holder is an unconfirmed GUESS. Re-stamp
  // writes this holder's geometry INTO the tool, which would make the guess
  // permanent in Fusion — so it opts in per tool, exactly like an implausible
  // move. Confirm it in "Link tools to holders" and it ticks normally.
  const unconfirmed = new Set(preview?.unconfirmed || []);
  const startsOff = (r) => isOdd(r) || unconfirmed.has(r.tool.id);
  const off = (r) => r.worst === 'error' || (startsOff(r) ? !excluded.has(`on:${r.tool.id}`) : excluded.has(r.tool.id));
  const selectedIds = selectable.filter(r => !off(r)).map(r => r.tool.id);

  const toggleRow = (r) => setExcluded(prev => {
    const next = new Set(prev);
    const key = startsOff(r) ? `on:${r.tool.id}` : r.tool.id;
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // "Select all" never silently opts in the implausible ones.
  const setAll = (on) => setExcluded(on
    ? new Set(oddRows.map(r => `on:${r.tool.id}`).filter(k => excluded.has(k)))
    : new Set(selectable.filter(r => !isOdd(r)).map(r => r.tool.id)));

  const gauge = (v, unit) => (v == null ? '—' : `${formatHolderLen(v, unit)} ${unitAbbr(unit)}`);

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal holder-restamp-modal">
        <div className="modal-header">
          <div>
            <h3>Re-stamp tools with this holder</h3>
            <p className="modal-sub">
              Each tool carries its own frozen copy of the holder geometry — Fusion bakes it in.
              This rebuilds that copy and recomputes the assembly gauge length, which is where
              the cutting edge sits.
            </p>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="restamp-toolbar">
          <div className="restamp-tol">
            <label htmlFor="restamp-tol">Allowed gauge change</label>
            <div className="restamp-tol-input">
              <input
                id="restamp-tol" className="field-input" type="number" step="0.5" min="0"
                max={ASSEMBLY_GAUGE_IMPLAUSIBLE_MM}
                value={Number(tolMm.toFixed(2))}
                onChange={e => setTolMm(Math.max(0, Math.min(ASSEMBLY_GAUGE_IMPLAUSIBLE_MM, Number(e.target.value) || 0)))}
              />
              <span className="unit">mm</span>
              <span className="alt">({(tolMm / MM).toFixed(4)}")</span>
            </div>
            <div className="restamp-tol-presets">
              {[+(ASSEMBLY_GAUGE_WARN_IN * MM).toFixed(1), 2, 5, ASSEMBLY_GAUGE_IMPLAUSIBLE_MM].map(v => (
                <button
                  key={v} className={`chip${Math.abs(tolMm - v) < 0.01 ? ' active' : ''}`}
                  onClick={() => setTolMm(v)}
                >{v}mm</button>
              ))}
            </div>
            <div className="restamp-tol-hint">
              {/* The ceiling is the point. A tolerance that could be dragged to
                  "make the warnings stop" would silence exactly the case this
                  check exists for. */}
              Raise this when you already know this holder’s old data was bad — those tools will
              all move and that’s expected. It applies to this fix only and isn’t saved: anything
              still on the old geometry afterwards should keep flagging. Capped at
              {ASSEMBLY_GAUGE_IMPLAUSIBLE_MM}mm: a bigger jump than that isn’t a correction, it’s a
              mistake, and stays flagged either way.
            </div>
          </div>

          <div className="restamp-counts">
            {/* The three flagged buckets are mutually exclusive, so "within"
                is what's left after ALL of them — an implausible row is not
                also a quiet one. */}
            <div className="restamp-stat ok"><b>{rows.length - warnRows.length - oddRows.length - errorRows.length}</b><span>within tolerance</span></div>
            <div className="restamp-stat warn"><b>{warnRows.length}</b><span>over tolerance</span></div>
            {oddRows.length > 0 && (
              <div className="restamp-stat err"><b>{oddRows.length}</b><span>over {ASSEMBLY_GAUGE_IMPLAUSIBLE_MM}mm</span></div>
            )}
            {errorRows.length > 0 && (
              <div className="restamp-stat err"><b>{errorRows.length}</b><span>can’t compute</span></div>
            )}
          </div>
        </div>

        <div className="modal-body">
          {errorRows.length > 0 && (
            <div className="holder-warn" style={{ marginBottom: 10 }}>
              <AlertTriangle size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />
              {errorRows.length} tool{errorRows.length === 1 ? '' : 's'} can’t be re-stamped — the
              assembly gauge length doesn’t compute. They’re excluded and can’t be selected.
            </div>
          )}

          {unconfirmedRows.length > 0 && (
            <div className="holder-warn" style={{ marginBottom: 10 }}>
              <AlertTriangle size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />
              {unconfirmedRows.length} tool{unconfirmedRows.length === 1 ? ' was' : 's were'} matched
              to this holder on one signal only, not confirmed. Re-stamping writes this holder’s
              geometry into them, which would make that guess permanent — so they start unticked.
              Confirm them in <b>Link tools to holders</b>, or tick one here to write it anyway.
            </div>
          )}

          <table className="restamp-table">
            <thead>
              <tr>
                <th className="sel">
                  <input
                    type="checkbox"
                    checked={selectedIds.length === selectable.length && selectable.length > 0}
                    onChange={e => setAll(e.target.checked)}
                    title="Select all / none"
                  />
                </th>
                <th>Tool</th>
                <th className="num">Gauge now</th>
                <th className="num">After</th>
                <th className="num">Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const unit = r.tool.unit;
                const c = r.checks.reduce((a, x) =>
                  (Math.abs(x.deltaIn ?? 0) > Math.abs(a?.deltaIn ?? 0) ? x : a), r.checks[0]);
                const odd = isOdd(r);
                const rowOff = off(r);
                return (
                  <tr key={r.tool.id} className={`${odd ? 'error' : r.worst}${rowOff ? ' off' : ''}`}>
                    <td className="sel">
                      <input
                        type="checkbox"
                        disabled={r.worst === 'error'}
                        checked={r.worst !== 'error' && !rowOff}
                        onChange={() => toggleRow(r)}
                      />
                    </td>
                    <td>
                      <div className="restamp-tool-name">{r.tool.description || r.tool.tool_id || r.tool.id}</div>
                      {r.checks.length > 1 && <div className="restamp-sub">{r.checks.length} assemblies</div>}
                      {odd && (
                        <div className="restamp-odd">
                          over {ASSEMBLY_GAUGE_IMPLAUSIBLE_MM}mm — tick it yourself if this is really right
                        </div>
                      )}
                    </td>
                    <td className="num mono">{gauge(c?.before, unit)}</td>
                    <td className="num mono">{gauge(c?.after, unit)}</td>
                    <td className={`num mono delta ${odd ? 'error' : r.worst}`}>
                      {c?.deltaMm == null ? '—'
                        : `${c.deltaMm > 0 ? '+' : ''}${c.deltaMm.toFixed(2)} mm`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length && <div className="holder-empty">No tools use this holder.</div>}
        </div>

        <div className="modal-footer">
          <span className="modal-footer-note">
            Only the holder geometry and assembly gauge length change. Nothing else about these
            tools is touched.
          </span>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary btn-sm"
            disabled={!selectedIds.length || busy}
            onClick={async () => { setBusy(true); try { await onCommit(selectedIds, tol); } finally { setBusy(false); } }}
          >
            <RefreshCw size={13} /> Re-stamp {selectedIds.length} tool{selectedIds.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}
