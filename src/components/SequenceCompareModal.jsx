import { useEffect, useMemo, useState } from 'react';
import { X, GitCompare, AlertTriangle, CheckCircle2, ArrowRight } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { parseSequenceCsv } from '../utils/sequenceDetail.js';
import { formatProgramNumber } from '../utils/parts.js';
import { buildVersionList, versionLabel, defaultPair } from '../utils/programVersions.js';
import { alignSequenceRows, compareSummary, COMPARE_FIELDS } from '../utils/sequenceCompare.js';

// Compare two posted versions of one program's Sequence Detail.
//
// ⚠️ REFERENCE ONLY, AND DELIBERATELY OPT-IN. It is not part of the update
// workflow — pulling an update in stays a single click that asks nothing. This
// is the separate "before I take that, what actually changed?" button, so it
// never blocks, never corrects, and never writes.
//
// One row per aligned operation rather than two files side by side: with the
// columns doubled it would be twenty across, and the thing worth seeing is the
// CELL that moved, not two walls of text. A row the other version doesn't have
// is a blank half — that is the added/removed line, which is what actually
// matters when a sequence number shifts.

const VERSION_KIND_LABEL = { pending: 'In Drive, not yet imported', current: 'Current', archive: 'Archived' };

// ⚠️ A pending file is labelled by its Drive modified time, NOT dressed up as a
// posted stamp — its real POSTED stamp is inside the file and has not been read
// yet. Presenting a modified time as a post time would misdate the version.
function versionOptionLabel(v) {
  const stamp = v.postedIso
    ? versionLabel(v)
    : (v.modifiedTime ? `modified ${v.modifiedTime.slice(0, 16).replace('T', ' ')}` : v.name);
  return `${VERSION_KIND_LABEL[v.kind]} · ${stamp}${v.proven ? ' · proven' : ''}`;
}

// One side of a compared cell. An empty value renders as a real absence rather
// than a blank that reads as a rendering fault.
function Cell({ value, changed }) {
  const text = String(value ?? '').trim();
  return (
    <span className={changed ? 'sc-val changed' : 'sc-val'}>
      {text || <span className="text-sub">—</span>}
    </span>
  );
}

export default function SequenceCompareModal({ operation, detail, pendingFile = null, onClose }) {
  const { listProgramVersions, fetchVersionText } = useApp();

  const [versions, setVersions] = useState(null);      // null = still listing
  const [leftId, setLeftId] = useState(null);
  const [rightId, setRightId] = useState(null);
  const [rows, setRows] = useState({ left: null, right: null });
  const [phase, setPhase] = useState('listing');        // listing | ready | loading | error
  const [error, setError] = useState('');

  // 1. What is there to compare.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listProgramVersions(detail, pendingFile);
        if (cancelled) return;
        setVersions(list);
        const pair = defaultPair(list);
        setLeftId(pair.left);
        setRightId(pair.right);
        setPhase(list.length >= 2 ? 'ready' : 'error');
        if (list.length < 2) setError('There is only one version of this program stored, so there is nothing to compare it against yet.');
      } catch (err) {
        if (!cancelled) { setPhase('error'); setError(err.message); }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Fetch and parse the chosen pair. Re-runs on either pick.
  useEffect(() => {
    if (!versions || !leftId || !rightId) return;
    let cancelled = false;
    const find = (id) => versions.find(v => v.id === id) || null;
    setPhase('loading');
    (async () => {
      try {
        const [l, r] = await Promise.all([
          fetchVersionText(find(leftId), detail),
          fetchVersionText(find(rightId), detail),
        ]);
        if (cancelled) return;
        // A file deleted from Drive since we recorded it is a known state, not a
        // fault — say which side is missing rather than showing an empty table.
        if (l == null || r == null) {
          setPhase('error');
          setError(`The ${l == null ? 'older' : 'newer'} version's file is no longer in Drive, so it can't be compared.`);
          return;
        }
        setRows({ left: parseSequenceCsv(l).rows, right: parseSequenceCsv(r).rows });
        setPhase('ready');
      } catch (err) {
        if (!cancelled) { setPhase('error'); setError(err.message); }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versions, leftId, rightId]);

  const pairs = useMemo(
    () => (rows.left && rows.right ? alignSequenceRows(rows.left, rows.right) : []),
    [rows],
  );
  const summary = useMemo(() => compareSummary(pairs), [pairs]);

  const swap = () => { setLeftId(rightId); setRightId(leftId); };

  const picker = (value, onChange, exclude) => (
    <select className="field-input" style={{ maxWidth: 300 }} value={value || ''}
      onChange={e => onChange(e.target.value)}>
      {(versions || []).map(v => (
        <option key={v.id} value={v.id} disabled={v.id === exclude}>{versionOptionLabel(v)}</option>
      ))}
    </select>
  );

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal sc-modal">
        <div className="pn-modal-head">
          <GitCompare size={16} style={{ color: 'var(--blue)' }} />
          <span className="modal-title" style={{ margin: 0 }}>
            Compare {formatProgramNumber(operation?.program_number)}
          </span>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose}><X size={16} /></button>
        </div>

        <div className="pn-modal-body">
          {versions && versions.length >= 2 && (
            <div className="sc-pickers">
              <div>
                <label className="field-label">Older</label>
                {picker(leftId, setLeftId, rightId)}
              </div>
              <button className="icon-btn" title="Swap sides" onClick={swap} style={{ marginTop: 18 }}>
                <ArrowRight size={15} />
              </button>
              <div>
                <label className="field-label">Newer</label>
                {picker(rightId, setRightId, leftId)}
              </div>
              {phase === 'ready' && (
                <div className="sc-summary">
                  {summary.identical ? (
                    <span className="sc-chip ok"><CheckCircle2 size={13} /> No differences</span>
                  ) : (
                    <>
                      {summary.changed > 0 && <span className="sc-chip changed">{summary.changed} changed</span>}
                      {summary.added > 0 && <span className="sc-chip added">{summary.added} added</span>}
                      {summary.removed > 0 && <span className="sc-chip removed">{summary.removed} removed</span>}
                      {summary.same > 0 && <span className="sc-chip">{summary.same} unchanged</span>}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {phase === 'listing' && <div className="pn-empty">Looking for other versions…</div>}
          {phase === 'loading' && <div className="pn-empty">Reading both posted files…</div>}
          {phase === 'error' && (
            <div className="sd-note warn" style={{ marginTop: 12 }}>
              <AlertTriangle size={14} style={{ color: 'var(--amber)', flexShrink: 0 }} />
              <div>{error}</div>
            </div>
          )}

          {phase === 'ready' && pairs.length > 0 && (
            <>
              <div className="pn-table-wrap sc-table-wrap">
                <table className="pn-table sd-table sc-table">
                  <thead>
                    <tr>
                      <th style={{ cursor: 'default' }}>Seq#</th>
                      {COMPARE_FIELDS.map(f => <th key={f.key} style={{ cursor: 'default' }}>{f.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {pairs.map((p, i) => {
                      const changed = new Set(p.changes);
                      // The row shown is the newer side where there is one; a
                      // removed operation shows its old values, greyed.
                      const shown = p.right || p.left;
                      return (
                        <tr key={i} className={`sc-row sc-${p.status}`}>
                          <td>
                            <span className="sd-seq">{shown.seq}</span>
                            {/* Seq# is shown but never compared — when it moved,
                                the reason is the added/removed row, not the
                                number, so the OLD number rides along quietly. */}
                            {p.status === 'changed' && p.left && p.left.seq !== p.right.seq && (
                              <span className="sc-was">was {p.left.seq}</span>
                            )}
                          </td>
                          {COMPARE_FIELDS.map(f => (
                            <td key={f.key}>
                              {p.status === 'changed' && changed.has(f.key) ? (
                                <span className="sc-pair">
                                  <Cell value={p.left[f.key]} />
                                  <ArrowRight size={11} className="sc-arrow" />
                                  <Cell value={p.right[f.key]} changed />
                                </span>
                              ) : (
                                <Cell value={shown[f.key]} />
                              )}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="text-sub text-xs" style={{ marginTop: 10 }}>
                Reference only — nothing here changes what&apos;s stored. Sequence numbers shift whenever an
                operation is added or removed, so they aren&apos;t treated as a difference. Cut Dia, Tip and
                Location aren&apos;t compared.
              </div>
            </>
          )}
        </div>

        <div className="pn-modal-foot flex items-center gap-8">
          <button className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
