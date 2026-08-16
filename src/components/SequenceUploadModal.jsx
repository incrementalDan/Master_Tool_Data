import { useEffect, useRef, useState } from 'react';
import { X, UploadCloud, AlertTriangle, CheckCircle2, ListOrdered, HelpCircle } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { buildSequenceImport, detailsOf } from '../utils/sequenceImport.js';
import { formatProgramNumber, formatOperation, routingLabel } from '../utils/parts.js';

// Upload a posted Sequence Detail CSV: file → preview → commit.
//
// Two BLOCKING rules, both shown as a red box with commit disabled:
//   - no matching program record (ToolDex assigns program numbers, so this
//     means something is genuinely wrong)
//   - a ProShop Tool # that resolves to no tool
// Both block the WHOLE upload: a partially-stored program prints a partial set
// of labels, which is worse than printing none.
//
// Everything else is INFORMATION, not an obstacle — an unmatched holder or a
// stale location is shown and the upload proceeds, because the CSV is what the
// program was proven with. (Location is the one field the app's own value wins
// on and gets printed — see resolveRowLocation.)
export default function SequenceUploadModal({ onClose, onImported, presetFile = null }) {
  const {
    parts: partsFile, tools, holderLibrary, programDetails,
    importSequenceDetail, notify, user,
  } = useApp();

  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleFile = async (f) => {
    if (!f) return;
    setFile(f);
    try {
      const csvText = await f.text();
      setResult(buildSequenceImport({
        csvText,
        fileName: f.name,
        partsFile,
        tools,
        holderRecords: holderLibrary?.holders || [],
        existingDetails: detailsOf(programDetails),
        uploadedBy: user?.email || user?.name || '',
      }));
    } catch (err) {
      notify(`Could not read file: ${err.message}`, 'error', 6000);
      setResult(null);
    }
  };

  // A file dropped onto the page opens this dialog already holding it — run it
  // through the identical path rather than a second parse/preview code path.
  const seeded = useRef(false);
  useEffect(() => {
    if (presetFile && !seeded.current) { seeded.current = true; handleFile(presetFile); }
  });

  const blocked = !!result && result.blockers.length > 0;
  const part = result?.part;

  const commit = async () => {
    if (!result || blocked || !file) return;
    setSaving(true);
    try {
      const stored = await importSequenceDetail({
        detail: result.detail, file, prior: result.prior, sameVersion: result.sameVersion,
      });
      notify(
        result.sameVersion
          ? `${formatProgramNumber(stored.program_number)} re-uploaded — same posted version`
          : `${formatProgramNumber(stored.program_number)} updated — ${stored.tools.length} tools`,
        'success',
      );
      onImported?.(stored, result.program, result.routing, part);
    } catch (err) {
      notify(`Import failed: ${err.message}`, 'error', 8000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal pn-modal" style={{ maxWidth: 640 }}>
        <div className="pn-modal-head">
          <ListOrdered size={16} style={{ color: 'var(--blue)' }} />
          <span className="modal-title" style={{ margin: 0 }}>Upload Sequence Detail</span>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose}><X size={16} /></button>
        </div>

        <div className="pn-modal-body">
          <label
            className={`pn-import-drop${dragging ? ' dragging' : ''}${file ? ' has-file' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]); }}
          >
            <UploadCloud size={22} style={{ color: 'var(--blue)' }} />
            <span>{file ? file.name : 'Drop the posted CSV here, or click to choose'}</span>
            <span className="text-xs text-sub">
              The file must be named for its program — O1218.csv. The program number inside the file is ignored.
            </span>
            <input type="file" accept=".csv,text/csv" style={{ display: 'none' }}
              onChange={e => handleFile(e.target.files?.[0])} />
          </label>

          {result && (
            <div className="pn-modal-stack" style={{ marginTop: 14 }}>
              {result.blockers.map((b, i) => (
                <div key={i} className="sd-blocker">
                  <AlertTriangle size={15} style={{ color: 'var(--red)', flexShrink: 0 }} />
                  <div>
                    <div>{b.message}</div>
                    {b.rows && (
                      <ul className="sd-blocker-list">
                        {b.rows.map(r => (
                          <li key={r.t}>
                            <span className="machine-num-badge">{r.t}</span>
                            <span className="tool-id-pill">{r.tool_id || '(blank)'}</span>
                            <span className="text-sub">{r.description}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ))}

              {!blocked && (
                <>
                  <div className="sd-ok">
                    <CheckCircle2 size={15} style={{ color: 'var(--green)', flexShrink: 0 }} />
                    <div>
                      <div>
                        <strong>{formatProgramNumber(result.program.program_number)}</strong>
                        {' · '}{part?.part_number}
                        {result.routing ? ` · ${routingLabel(result.routing)}` : ''}
                        {result.program.op_number ? ` · ${formatOperation(result.program.op_number)}` : ''}
                      </div>
                      <div className="text-xs text-sub">
                        {result.detail.tools.length} tools · {result.detail.row_count} operations
                        {result.detail.posted ? ` · posted ${result.detail.posted}` : ' · no posted stamp in this file'}
                      </div>
                    </div>
                  </div>

                  {result.prior && (
                    <div className="sd-note">
                      {result.sameVersion
                        ? 'Same posted version as the one already stored — the file is replaced, nothing is archived, and the proven state is kept.'
                        : `Replaces the version posted ${result.prior.posted || '(unknown)'}, which will be archived. A new version always starts unproven.`}
                    </div>
                  )}

                  {result.flags.legacy.length > 0 && (
                    <div className="sd-note">
                      {result.flags.legacy.length} tool{result.flags.legacy.length !== 1 ? 's' : ''} matched a retired
                      ProShop number: {result.flags.legacy.map(l => `${l.tool_id} → ${l.current}`).join(', ')}.
                    </div>
                  )}

                  {result.flags.lc.length > 0 && (
                    <div className="sd-note warn">
                      <AlertTriangle size={13} style={{ color: 'var(--amber)', flexShrink: 0 }} />
                      <div>
                        {result.flags.lc.length} location{result.flags.lc.length !== 1 ? 's' : ''} in this file are out of date
                        ({result.flags.lc.map(c => `${c.t} says ${c.csv}, ToolDex has ${c.app}`).join('; ')}).
                        ToolDex owns location, so its value is what's shown and printed — Fusion's copy just hasn't caught up.
                      </div>
                    </div>
                  )}

                  {result.flags.holders.length > 0 && (
                    <div className="sd-note">
                      <HelpCircle size={13} style={{ flexShrink: 0 }} />
                      <div>
                        {result.flags.holders.length} holder{result.flags.holders.length !== 1 ? 's' : ''} aren't in the
                        holder library. Their CSV description is used as-is.
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div className="pn-modal-foot flex items-center gap-8">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" style={{ marginLeft: 'auto' }}
            disabled={!result || blocked || saving} onClick={commit}>
            {saving ? 'Storing…' : 'Store sequence detail'}
          </button>
        </div>
      </div>
    </div>
  );
}
