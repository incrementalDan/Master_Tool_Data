import { useState } from 'react';
import { X, UploadCloud, FileText, AlertTriangle, CheckCircle2, Hash } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { buildProgramsImport } from '../utils/programsImport.js';
import { formatProgramNumber } from '../utils/programs.js';

// One-time CSV import of the shop's existing program-number list into the
// Program Number Manager. Reached from Settings. File → preview (counts,
// duplicates, errors) → commit through the shared saveJobs write path.
//
// Expected header: Program #, Machine, Fixturing, Internal or external,
// internal Part #, Rev, Customer, Description, OP #, Fixture Y/N.
export default function ProgramsImportModal({ onClose }) {
  const { jobs: jobsFile, shopSettings, saveJobs, notify, user, googleAuthenticated, demoMode } = useApp();
  const canEdit = googleAuthenticated || demoMode;
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState(null);   // { parts, programs, mergedFile, summary }
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const handleFile = async (file) => {
    if (!file) return;
    setFileName(file.name);
    setDone(false);
    try {
      const text = await file.text();
      setResult(buildProgramsImport(text, {
        jobsFile,
        shopSettings,
        createdBy: user?.email || user?.name || '',
      }));
    } catch (err) {
      notify(`Could not read file: ${err.message}`, 'error', 6000);
      setResult(null);
    }
  };

  const s = result?.summary;
  const hasHeaderProblem = s?.missingColumns?.includes('part_number');
  const nothingToImport = s && s.programsNew === 0;

  const commit = async () => {
    if (!result || hasHeaderProblem || nothingToImport) return;
    setSaving(true);
    try {
      await saveJobs(result.mergedFile);
      notify(`Imported ${s.programsNew} program${s.programsNew !== 1 ? 's' : ''} across ${s.partsNew} new part${s.partsNew !== 1 ? 's' : ''}`, 'success');
      setDone(true);
    } catch (err) {
      notify(`Import failed: ${err.message}`, 'error', 7000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal pn-modal">
        <div className="pn-modal-head">
          <Hash size={16} style={{ color: 'var(--blue)' }} />
          <h3 className="modal-title" style={{ margin: 0, flex: 1 }}>Import program list</h3>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="pn-modal-body">
          {done ? (
            <div className="pn-modal-stack" style={{ alignItems: 'center', textAlign: 'center', padding: '12px 0' }}>
              <CheckCircle2 size={34} style={{ color: 'var(--green)' }} />
              <div>
                Imported <strong>{s.programsNew}</strong> program{s.programsNew !== 1 ? 's' : ''}
                {s.partsNew > 0 && <> across <strong>{s.partsNew}</strong> new part{s.partsNew !== 1 ? 's' : ''}</>}.
              </div>
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          ) : (
            <div className="pn-modal-stack">
              <p className="text-sub text-sm" style={{ margin: 0 }}>
                One-time import of your existing program list. Expected columns:
                {' '}<span className="font-mono text-xs">Program #, Machine, Fixturing, Internal or external, internal Part #, Rev, Customer, Description, OP #, Fixture Y/N</span>.
                Each row is one program; rows sharing a Part # + Rev group into one part. Program numbers already in the app are skipped; blank ones get the next available number.
              </p>

              <label className={`pn-import-drop${fileName ? ' has-file' : ''}`}>
                <input type="file" accept=".csv,text/csv" style={{ display: 'none' }}
                  onChange={e => handleFile(e.target.files[0])} />
                {fileName
                  ? <><FileText size={22} /><span>{fileName}</span><span className="text-xs text-sub">Choose a different file</span></>
                  : <><UploadCloud size={26} /><span>Choose CSV file</span></>}
              </label>

              {hasHeaderProblem && (
                <div className="pn-import-error">
                  <AlertTriangle size={14} /> No <strong>Part #</strong> column found — check the header row matches the expected columns.
                </div>
              )}

              {s && !hasHeaderProblem && (
                <div className="pn-import-summary">
                  <div className="pn-import-stat"><span className="program-num-badge">{s.programsNew}</span> program{s.programsNew !== 1 ? 's' : ''} to import</div>
                  <div className="pn-import-stat"><strong>{s.partsNew}</strong> new part{s.partsNew !== 1 ? 's' : ''}{s.partsReused > 0 && <span className="text-sub"> · {s.partsReused} row{s.partsReused !== 1 ? 's' : ''} matched existing parts</span>}</div>
                  {s.autoAssigned.length > 0 && (
                    <div className="pn-import-stat text-sub">{s.autoAssigned.length} blank number{s.autoAssigned.length !== 1 ? 's' : ''} auto-assigned (from {formatProgramNumber(s.autoAssigned[0])})</div>
                  )}
                  {s.duplicates.length > 0 && (
                    <div className="pn-import-stat" style={{ color: 'var(--amber)' }}>
                      <AlertTriangle size={12} /> {s.duplicates.length} skipped — already in the app: {s.duplicates.slice(0, 8).map(d => formatProgramNumber(d.program_number)).join(', ')}{s.duplicates.length > 8 ? '…' : ''}
                    </div>
                  )}
                  {s.errors.length > 0 && (
                    <div className="pn-import-errlist">
                      <div style={{ color: 'var(--red)', fontWeight: 600, marginBottom: 3 }}>
                        <AlertTriangle size={12} /> {s.errors.length} row{s.errors.length !== 1 ? 's' : ''} skipped:
                      </div>
                      {s.errors.slice(0, 10).map((e, i) => (
                        <div key={i} className="text-xs text-sub">Line {e.line}: {e.message}</div>
                      ))}
                      {s.errors.length > 10 && <div className="text-xs text-sub">…and {s.errors.length - 10} more</div>}
                    </div>
                  )}
                  {nothingToImport && s.errors.length === 0 && s.duplicates.length === 0 && (
                    <div className="text-sub text-sm">No rows found to import.</div>
                  )}
                </div>
              )}

              {!canEdit && (
                <div className="pn-import-error">
                  <AlertTriangle size={14} /> Connect Google Drive to import — the program list is stored in the shop's shared jobs.json.
                </div>
              )}
            </div>
          )}
        </div>

        {!done && (
          <div className="pn-modal-foot" style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={!canEdit || saving || !result || hasHeaderProblem || nothingToImport}
              onClick={commit}
            >
              {saving
                ? <><span className="spinner" style={{ width: 13, height: 13, borderWidth: 2 }} /> Importing…</>
                : `Import${s ? ` ${s.programsNew}` : ''}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
