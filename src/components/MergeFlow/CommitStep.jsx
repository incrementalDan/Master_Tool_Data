import { useState } from 'react';
import { ArrowLeft, CheckCircle2, GitMerge } from 'lucide-react';
import { useApp } from '../../context/AppContext.jsx';
import { FIELD_LABELS, TOOL_TYPE_LABELS } from '../../schema/toolSchema.js';
import ToolTypeIcon from '../icons/ToolTypeIcon.jsx';

function formatValue(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const n = Number(v);
  if (!isNaN(n) && v !== '') return Math.round(n * 10000) / 10000;
  return String(v);
}

export default function CommitStep({ importedTool, masterTool, selectedFields, onDone, onBack }) {
  const { mergeTool, isSaving, user } = useApp();
  const [revisionNote, setRevisionNote] = useState('');
  const [mergedBy, setMergedBy] = useState(user?.email || user?.name || '');
  const [done, setDone] = useState(false);
  const [commitError, setCommitError] = useState('');

  const fieldList = [...selectedFields];

  const handleCommit = async () => {
    if (!revisionNote.trim()) return;
    setCommitError('');
    const mergedFields = {};
    for (const f of fieldList) mergedFields[f] = importedTool[f];
    try {
      await mergeTool(masterTool, mergedFields, revisionNote.trim(), mergedBy.trim());
      setDone(true);
    } catch (err) {
      setCommitError(err.message);
    }
  };

  if (done) {
    return (
      <div className="merge-success">
        <CheckCircle2 size={48} style={{ color: 'var(--green)', marginBottom: 16 }} />
        <h3 style={{ marginBottom: 8 }}>Merge Complete</h3>
        <p className="text-sub text-sm mb-8">
          {fieldList.length} field{fieldList.length !== 1 ? 's' : ''} committed to master.
        </p>
        <p className="text-sub text-sm mb-20">
          <strong style={{ color: 'var(--text)' }}>{masterTool.description}</strong> has been updated.
        </p>
        <button className="btn btn-primary" onClick={onDone}>Return to Library</button>
      </div>
    );
  }

  return (
    <div>
      <h3 className="import-section-title">Commit to Master</h3>

      {/* Tool being updated */}
      <div className="merge-imported-summary mb-20">
        <div className="text-xs text-sub mb-6" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
          Updating Master Tool
        </div>
        <div className="flex items-center gap-10">
          <span style={{ color: 'var(--blue)' }}>
            <ToolTypeIcon type={masterTool.tool_type} size={22} />
          </span>
          <div>
            <div style={{ fontWeight: 600 }}>{masterTool.description || '—'}</div>
            <div className="text-xs text-sub">{TOOL_TYPE_LABELS[masterTool.tool_type] || masterTool.tool_type}</div>
          </div>
        </div>
      </div>

      {/* Field summary */}
      <div className="panel mb-20">
        <div className="panel-header static">
          <GitMerge size={14} className="panel-header-icon" />
          <span className="panel-header-title">
            {fieldList.length} field{fieldList.length !== 1 ? 's' : ''} to commit
          </span>
        </div>
        <div className="panel-body">
          <div className="commit-field-list">
            {fieldList.map(f => (
              <div key={f} className="commit-field-row">
                <span className="commit-field-name">{FIELD_LABELS[f] || f}</span>
                <span className="commit-field-old">{formatValue(masterTool[f])}</span>
                <span className="diff-arrow">→</span>
                <span className="commit-field-new">{formatValue(importedTool[f])}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Revision note */}
      <div className="field-group mb-16">
        <label className="field-label">
          Revision Note <span className="required">*</span>
        </label>
        <textarea
          className="field-input"
          rows={3}
          placeholder="e.g. Job 1042 proved these speeds work great for 316L. Increased feedrate to match observed tool life."
          value={revisionNote}
          onChange={e => setRevisionNote(e.target.value)}
          autoFocus
        />
        <span className="field-error" style={{ opacity: revisionNote.trim() ? 0 : 1 }}>
          Required — describe why this change is being committed.
        </span>
      </div>

      <div className="field-group mb-20">
        <label className="field-label">Committed by</label>
        <input
          className="field-input"
          style={{ maxWidth: 280 }}
          placeholder="Your name or email"
          value={mergedBy}
          onChange={e => setMergedBy(e.target.value)}
        />
      </div>

      {commitError && <div className="error-banner mb-12">{commitError}</div>}

      <div className="flex gap-8">
        <button className="btn btn-ghost btn-sm" onClick={onBack} disabled={isSaving}>
          <ArrowLeft size={14} /> Back
        </button>
        <button
          className="btn btn-primary"
          onClick={handleCommit}
          disabled={!revisionNote.trim() || isSaving}
        >
          {isSaving ? 'Saving…' : 'Commit to Master'}
        </button>
      </div>
    </div>
  );
}
