import { useState } from 'react';
import { X, Zap, AlertTriangle, CheckCircle2, Unlink } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { formatProgramNumber } from '../utils/parts.js';

// One pass over every machine's posted-files folder, taking in everything it can.
//
// ⚠️ Deliberately more permissive than a single import, in exactly one way: a
// ProShop number that resolves to no tool does not throw the file away. The row
// is stored unlinked and flagged, because the point of this run is the program ↔
// ProShop-ID links across years of old jobs, and losing a whole program to one
// number mis-typed years ago defeats that. Everything else that blocks still
// blocks — those are structural, not a policy choice.
export default function BulkSequenceImportModal({ onClose }) {
  const { bulkImportPostedFiles, notify } = useApp();
  const [view, setView] = useState('intro');       // intro | running | done
  const [progress, setProgress] = useState({ done: 0, total: 0, current: '' });
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  const run = async () => {
    setView('running');
    setError('');
    try {
      const r = await bulkImportPostedFiles({ onProgress: setProgress });
      setReport(r);
      setView('done');
      notify(`Bulk import finished — ${r.imported.length} program${r.imported.length !== 1 ? 's' : ''} taken in`, 'success');
    } catch (err) {
      setError(err.message);
      setView('intro');
    }
  };

  const totalUnmatched = (report?.imported || []).reduce((n, r) => n + r.unmatched, 0);
  const totalLoose = (report?.imported || []).reduce((n, r) => n + r.loose, 0);

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (view !== 'running' && e.target === e.currentTarget) onClose(); }}>
      <div className="modal pn-modal" style={{ maxWidth: 680 }}>
        <div className="pn-modal-head">
          <Zap size={16} style={{ color: 'var(--amber)' }} />
          <span className="modal-title" style={{ margin: 0 }}>Bulk import posted files</span>
          {view !== 'running' && (
            <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose}><X size={16} /></button>
          )}
        </div>

        <div className="pn-modal-body">
          {error && <div className="sd-blocker" style={{ marginBottom: 12 }}>
            <AlertTriangle size={15} style={{ color: 'var(--red)', flexShrink: 0 }} /><div>{error}</div>
          </div>}

          {view === 'intro' && (
            <div className="pn-modal-stack">
              <p className="text-sub text-sm" style={{ margin: 0 }}>
                Scans every machine&apos;s posted-files folder and takes in each program&apos;s Sequence
                Detail in one pass. A program whose file the app already holds is left alone, so this
                is safe to re-run.
              </p>
              <div className="sd-note warn">
                <AlertTriangle size={14} style={{ color: 'var(--amber)', flexShrink: 0 }} />
                <div>
                  Everything taken in is marked <strong>Bulk import</strong> — nobody reviews these, and the
                  older posted files are often out of date. The point is linking programs to ProShop
                  numbers, not vouching for the values.
                </div>
              </div>
              <div className="sd-note">
                <div>
                  A ProShop number that isn&apos;t in the library <strong>won&apos;t stop the file</strong> — that row is
                  stored unlinked and flagged for you to correct. Old ids also match on the number alone,
                  ignoring the letter prefix. A file whose program number isn&apos;t in ToolDex is skipped
                  and listed, since there&apos;s nothing to attach it to.
                </div>
              </div>
            </div>
          )}

          {view === 'running' && (
            <div style={{ padding: '10px 0' }}>
              <div className="text-sm" style={{ marginBottom: 8 }}>
                Reading {progress.current || '…'} — {progress.done} of {progress.total}
              </div>
              <div className="pn-progress"><div className="pn-progress-bar"
                style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
            </div>
          )}

          {view === 'done' && report && (
            <div className="pn-modal-stack">
              <div className="sd-ok">
                <CheckCircle2 size={15} style={{ color: 'var(--green)', flexShrink: 0 }} />
                <div>
                  <div><strong>{report.imported.length}</strong> taken in · {report.upToDate.length} already
                    current · {report.skipped.length} skipped · {report.scanned} scanned</div>
                  {(totalUnmatched > 0 || totalLoose > 0) && (
                    <div className="text-xs text-sub">
                      {totalUnmatched > 0 && <>{totalUnmatched} tool row{totalUnmatched !== 1 ? 's' : ''} couldn&apos;t be linked. </>}
                      {totalLoose > 0 && <>{totalLoose} matched on the number alone.</>}
                    </div>
                  )}
                </div>
              </div>

              {report.folderErrors.length > 0 && (
                <div className="sd-note warn">
                  <AlertTriangle size={14} style={{ color: 'var(--amber)', flexShrink: 0 }} />
                  <div>
                    {report.folderErrors.length} folder{report.folderErrors.length !== 1 ? 's' : ''} couldn&apos;t be
                    read, so anything in {report.folderErrors.length !== 1 ? 'them' : 'it'} was not seen:
                    {' '}{report.folderErrors.map(e => e.machines?.join('/') || e.folderId).join(', ')}.
                  </div>
                </div>
              )}

              {report.skipped.length > 0 && (
                <div>
                  <div className="section-header mb-8">Skipped</div>
                  <ul className="sd-blocker-list">
                    {report.skipped.map(r => (
                      <li key={r.fileName}>
                        <span className="program-num-badge">{formatProgramNumber(r.programNumber)}</span>
                        <span className="text-sub">{r.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {report.imported.some(r => r.unmatched > 0) && (
                <div>
                  <div className="section-header mb-8">
                    <Unlink size={12} /> Programs with tool numbers to correct
                  </div>
                  <ul className="sd-blocker-list">
                    {report.imported.filter(r => r.unmatched > 0).map(r => (
                      <li key={r.fileName}>
                        <span className="program-num-badge">{formatProgramNumber(r.programNumber)}</span>
                        <span className="text-sub">{r.unmatched} of {r.tools} rows link to no tool</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="pn-modal-foot flex items-center gap-8">
          <button className="btn btn-ghost" onClick={onClose} disabled={view === 'running'}>
            {view === 'done' ? 'Close' : 'Cancel'}
          </button>
          {view !== 'done' && (
            <button className="btn btn-primary" style={{ marginLeft: 'auto' }}
              disabled={view === 'running'} onClick={run}>
              {view === 'running' ? 'Importing…' : 'Start bulk import'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
