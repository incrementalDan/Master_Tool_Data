import { useState } from 'react';
import { Briefcase, Plus, X, Pencil } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { collectToolJobs, jobLabel } from '../utils/jobs.js';

// "Jobs / Where Used" — every job (program # + part #) this tool is linked to:
// preset-proven links (managed on each preset; shown read-only here with the
// preset name(s)) plus tool-level links (added/removed here, for "used this
// tool on job X" without preset context). The count sits in the header so an
// empty panel is obvious without opening it. Reference data — the future jobs
// page will manage the registry itself; this panel just links to it.
export default function JobsSection({ tool, onSave }) {
  const { jobs, findOrCreateJob, user, googleAuthenticated, demoMode, notify } = useApp();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prog, setProg] = useState('');
  const [part, setPart] = useState('');

  const canAdd = googleAuthenticated || demoMode;
  const rows = collectToolJobs(tool, jobs);
  const toolLevelIds = new Set(tool.job_ids || []);

  const handleAdd = async () => {
    const p = prog.trim(), pn = part.trim();
    if (!p || !pn) return;
    const job = findOrCreateJob(p, pn, user?.email || user?.name || '');
    if ((tool.job_ids || []).includes(job.id) ||
        (tool.presets || []).some(pr => (pr.job_ids || []).includes(job.id))) {
      notify('This job is already linked to the tool', 'info');
      setProg(''); setPart('');
      return;
    }
    setSaving(true);
    try {
      await onSave({ ...tool, job_ids: [...(tool.job_ids || []), job.id] });
      setProg(''); setPart('');
    } catch { /* toast handled in context */ }
    finally { setSaving(false); }
  };

  const handleRemove = async (jobId) => {
    setSaving(true);
    try {
      await onSave({ ...tool, job_ids: (tool.job_ids || []).filter(id => id !== jobId) });
    } catch { /* toast handled in context */ }
    finally { setSaving(false); }
  };

  return (
    <div className={`panel ${open ? 'open' : ''}`}>
      <button className="panel-header" onClick={() => setOpen(o => !o)}>
        <Briefcase size={15} className="panel-header-icon" />
        <span className="panel-header-title">
          Jobs / Where Used
          <span className="text-sub" style={{ fontWeight: 400, marginLeft: 6 }}>({rows.length})</span>
        </span>
        {open && !editing && (
          <span className="icon-btn" title="Add or remove tool-level job links" onClick={e => { e.stopPropagation(); setEditing(true); }}>
            <Pencil size={12} />
          </span>
        )}
        <span className="panel-chevron">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="panel-body">
          {rows.length === 0 && (
            <div className="detail-field-empty text-sm">
              No jobs linked yet — link one here, or via Sync Job / a preset.
            </div>
          )}

          {rows.map(({ job, presetNames }) => (
            <div key={job.id} className="job-row">
              <span className="font-mono text-sm">{jobLabel(job)}</span>
              <span className="job-row-scope">
                {presetNames.length > 0
                  ? presetNames.map(n => (
                      <span key={n} className="preset-tag" title={`Proven on preset ${n}`}>{n}</span>
                    ))
                  : <span className="text-xs text-sub">tool</span>}
              </span>
              {editing && toolLevelIds.has(job.id) && (
                <button type="button" className="icon-btn" title="Unlink from tool" disabled={saving} onClick={() => handleRemove(job.id)}>
                  <X size={13} />
                </button>
              )}
            </div>
          ))}

          {editing && (
            canAdd ? (
              <div className="job-add-row">
                <input
                  className="field-input font-mono" placeholder="Program #"
                  value={prog} onChange={e => setProg(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
                />
                <input
                  className="field-input font-mono" placeholder="Part #"
                  value={part} onChange={e => setPart(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
                />
                <button type="button" className="btn btn-secondary btn-sm" disabled={saving || !prog.trim() || !part.trim()} onClick={handleAdd}>
                  {saving ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> : <Plus size={13} />} Add
                </button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={() => setEditing(false)}>Done</button>
              </div>
            ) : (
              <div className="text-xs text-sub" style={{ marginTop: 8 }}>Connect Google Drive to link jobs.</div>
            )
          )}
        </div>
      )}
    </div>
  );
}
