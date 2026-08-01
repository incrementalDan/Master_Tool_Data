// ─── Re-stamp preview: see every gauge change, set the tolerance, choose ────
//
// WHY THIS ISN'T A YES/NO CONFIRM. When a badly-modelled holder is corrected,
// every tool on it moves — sometimes by a lot, and that is exactly what was
// asked for. A fixed threshold would flag all forty of them and the warning
// becomes wallpaper. So the user sets the tolerance for THIS holder's fix, sees
// the old and new assembly gauge length for every affected tool, and decides.
//
// The tolerance is remembered on the holder record, which is also what the
// single-tool save path reads — so raising it here stops the ordinary
// save-a-tool warning nagging about the same holder too.

import { useState, useMemo, useEffect } from 'react';
import { X, RefreshCw, AlertTriangle } from 'lucide-react';
import { ASSEMBLY_GAUGE_WARN_IN, holderToleranceIn } from '../schema/holderResolve.js';
import { formatHolderLen } from '../utils/holderGeometry.js';
import { unitAbbr } from '../utils/units.js';

const MM = 25.4;

export default function RestampModal({ holder, preview, onPreview, onCommit, onClose }) {
  // Same unset-vs-zero rule the write path uses — see holderToleranceIn.
  const [tol, setTol] = useState(() => holderToleranceIn(holder?.restamp_tolerance_in));
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
  const warnRows = rows.filter(r => r.worst === 'warn');
  // A tool whose gauge couldn't be computed is never writable — excluded
  // structurally, not by choice, so it can't be selected back in.
  const selectable = rows.filter(r => r.worst !== 'error');
  const selectedIds = selectable.filter(r => !excluded.has(r.tool.id)).map(r => r.tool.id);

  const toggle = (id) => setExcluded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const setAll = (on) => setExcluded(on ? new Set() : new Set(selectable.map(r => r.tool.id)));

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
                id="restamp-tol" className="field-input" type="number" step="0.005" min="0"
                value={tol}
                onChange={e => setTol(Math.max(0, Number(e.target.value) || 0))}
              />
              <span className="unit">in</span>
              <span className="alt">({(tol * MM).toFixed(2)} mm)</span>
            </div>
            <div className="restamp-tol-presets">
              {[ASSEMBLY_GAUGE_WARN_IN, 0.1, 0.25, 1, 2].map(v => (
                <button
                  key={v} className={`chip${Math.abs(tol - v) < 1e-9 ? ' active' : ''}`}
                  onClick={() => setTol(v)}
                >{v}"</button>
              ))}
            </div>
            <div className="restamp-tol-hint">
              {/* The whole point: a holder that was wrong moves everything on it,
                  and once that's understood it shouldn't keep asking. */}
              Raise this when you already know this holder’s old data was bad — the tools will
              all move and that’s expected. Saved on the holder, so ordinary tool saves stop
              warning about it too.
            </div>
          </div>

          <div className="restamp-counts">
            <div className="restamp-stat ok"><b>{rows.length - warnRows.length - errorRows.length}</b><span>within tolerance</span></div>
            <div className="restamp-stat warn"><b>{warnRows.length}</b><span>over tolerance</span></div>
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
                const off = r.worst === 'error' || excluded.has(r.tool.id);
                return (
                  <tr key={r.tool.id} className={`${r.worst}${off ? ' off' : ''}`}>
                    <td className="sel">
                      <input
                        type="checkbox"
                        disabled={r.worst === 'error'}
                        checked={r.worst !== 'error' && !excluded.has(r.tool.id)}
                        onChange={() => toggle(r.tool.id)}
                      />
                    </td>
                    <td>
                      <div className="restamp-tool-name">{r.tool.description || r.tool.tool_id || r.tool.id}</div>
                      {r.checks.length > 1 && <div className="restamp-sub">{r.checks.length} assemblies</div>}
                    </td>
                    <td className="num mono">{gauge(c?.before, unit)}</td>
                    <td className="num mono">{gauge(c?.after, unit)}</td>
                    <td className={`num mono delta ${r.worst}`}>
                      {c?.deltaIn == null ? '—'
                        : `${c.deltaIn > 0 ? '+' : ''}${c.deltaIn.toFixed(4)}"`}
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
