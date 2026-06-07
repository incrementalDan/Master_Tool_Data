import { useState } from 'react';
import { ArrowLeft, GitMerge, Plus, Wrench } from 'lucide-react';
import { useApp } from '../../context/AppContext.jsx';
import { TOOL_TYPE_LABELS } from '../../schema/toolSchema.js';
import { fieldLabel } from '../../schema/fieldRegistry.js';
import { unitAbbr } from '../../utils/units.js';
import ToolTypeIcon from '../icons/ToolTypeIcon.jsx';

function formatValue(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const n = Number(v);
  if (!isNaN(n) && v !== '') return Math.round(n * 10000) / 10000;
  return String(v);
}

export default function CommitStep({
  importedTool, masterTool, selectedFields,
  presetSelections,   // kept for interface compatibility — always empty Map from DiffStep
  presetsToAdd,       // presetObject[] — new presets + conflict-created presets
  assemblyUpdate,     // { type: 'create'|'link', assembly: {...} } or null — decided in DiffStep
  onCommitted, onBack,
  isLastItem = false,
}) {
  const { mergeTool, isSaving, user } = useApp();
  const [revisionNote, setRevisionNote] = useState('');
  const [mergedBy, setMergedBy] = useState(user?.email || user?.name || '');
  const [commitError, setCommitError] = useState('');

  const fieldList = [...(selectedFields || [])];
  const newPresetList = presetsToAdd || [];

  // Revision note is only required when committing tool field changes.
  // Adding presets or an assembly record doesn't need a written justification.
  const revisionRequired = fieldList.length > 0;

  const handleCommit = async () => {
    if (revisionRequired && !revisionNote.trim()) return;
    setCommitError('');

    const mergedFields = {};
    for (const f of fieldList) mergedFields[f] = importedTool[f];

    try {
      await mergeTool(masterTool, mergedFields, revisionNote.trim(), mergedBy.trim(), [], newPresetList, assemblyUpdate);
      onCommitted();
    } catch (err) {
      setCommitError(err.message);
    }
  };

  const totalChanges = fieldList.length + newPresetList.length;

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

      {/* Change summary */}
      <div className="panel mb-20">
        <div className="panel-header static">
          <GitMerge size={14} className="panel-header-icon" />
          <span className="panel-header-title">
            {totalChanges} change{totalChanges !== 1 ? 's' : ''} to commit
          </span>
        </div>
        <div className="panel-body">
          {/* Flat tool fields */}
          {fieldList.length > 0 && (
            <div className="commit-field-list">
              {fieldList.map(f => (
                <div key={f} className="commit-field-row">
                  <span className="commit-field-name">{fieldLabel(f, masterTool.unit) || f}</span>
                  <span className="commit-field-old">{formatValue(masterTool[f])}</span>
                  <span className="diff-arrow">→</span>
                  <span className="commit-field-new">{formatValue(importedTool[f])}</span>
                </div>
              ))}
            </div>
          )}

          {/* New presets being added */}
          {newPresetList.length > 0 && (
            <div style={{ marginTop: fieldList.length > 0 ? 12 : 0 }}>
              <div className="text-xs text-sub" style={{ padding: '4px 0 8px', fontWeight: 600 }}>
                <Plus size={11} style={{ display: 'inline', marginRight: 4 }} />
                Adding {newPresetList.length} new preset{newPresetList.length !== 1 ? 's' : ''} to master
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {newPresetList.map(p => (
                  <span key={p.guid} className="preset-tag">{p.name || 'Unnamed'}</span>
                ))}
              </div>
            </div>
          )}

          {/* Assembly record summary */}
          {assemblyUpdate && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-sub)' }}>
              <Wrench size={11} />
              {assemblyUpdate.type === 'create' ? 'Creating new assembly record' : 'Linking presets to existing assembly'}
              {assemblyUpdate.assembly?.ooh != null && (
                <> · OOH <strong style={{ color: 'var(--text)' }}>{assemblyUpdate.assembly.ooh.toFixed(3)} {unitAbbr(masterTool.unit)}</strong></>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Revision note */}
      <div className="field-group mb-16">
        <label className="field-label">
          Revision Note{revisionRequired && <span className="required"> *</span>}
          {!revisionRequired && <span className="text-sub text-xs" style={{ fontWeight: 400, marginLeft: 6 }}>(optional — no tool fields are changing)</span>}
        </label>
        <textarea
          className="field-input"
          rows={3}
          placeholder="e.g. Job 1042 — these speeds proved great on 316L. Increased feed to match observed tool life."
          value={revisionNote}
          onChange={e => setRevisionNote(e.target.value)}
          autoFocus
        />
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
          disabled={(revisionRequired && !revisionNote.trim()) || isSaving}
        >
          {isSaving ? 'Saving…' : isLastItem ? 'Commit & Finish' : 'Commit & Next →'}
        </button>
      </div>
    </div>
  );
}
