import { useState } from 'react';
import { ArrowLeft, GitMerge, Plus, Wrench } from 'lucide-react';
import { useApp } from '../../context/AppContext.jsx';
import { FIELD_LABELS, TOOL_TYPE_LABELS, generateAssemblyId } from '../../schema/toolSchema.js';
import ToolTypeIcon from '../icons/ToolTypeIcon.jsx';

function formatValue(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const n = Number(v);
  if (!isNaN(n) && v !== '') return Math.round(n * 10000) / 10000;
  return String(v);
}

const PRESET_FIELD_LABELS = {
  n: 'Spindle Speed (RPM)', v_c: 'Surface Speed', n_ramp: 'Ramp Spindle Speed',
  v_f: 'Cutting Feedrate', f_z: 'Feed per Tooth',
  v_f_plunge: 'Plunge Feedrate', f_n: 'Feed per Rev',
  v_f_leadIn: 'Lead-In Feedrate', v_f_leadOut: 'Lead-Out Feedrate',
  v_f_transition: 'Transition Feedrate', v_f_ramp: 'Ramp Feedrate',
  'ramp-angle': 'Ramp Angle (°)', 'tool-coolant': 'Coolant',
  'use-stepdown': 'Use Stepdown', 'use-stepover': 'Use Stepover',
};

export default function CommitStep({
  importedTool, masterTool, selectedFields,
  presetSelections,   // Map<masterPresetGuid, { name, incoming, selectedFields: Set }>
  presetsToAdd,       // presetObject[]
  onCommitted, onBack,
  isLastItem = false,
}) {
  const { mergeTool, isSaving, user, holders } = useApp();
  const [revisionNote, setRevisionNote] = useState('');
  const [mergedBy, setMergedBy] = useState(user?.email || user?.name || '');
  const [commitError, setCommitError] = useState('');
  const [assemblyAction, setAssemblyAction] = useState('create'); // 'create' | 'link' | 'skip'
  const [linkTargetId, setLinkTargetId] = useState('');

  const incomingOoh = importedTool?.incoming_ooh;
  const incomingHolderGuid = importedTool?.incoming_holder_guid || '';
  const incomingHolderDesc = importedTool?._incomingHolderDesc
    || holders?.find(h => h.guid === incomingHolderGuid)?.description
    || '';
  const hasIncomingAssembly = incomingOoh != null && incomingOoh > 0 && newPresetList.length > 0;

  const fieldList = [...(selectedFields || [])];
  const presetChangeList = [...(presetSelections || new Map()).entries()];
  const newPresetList = presetsToAdd || [];

  const handleCommit = async () => {
    if (!revisionNote.trim()) return;
    setCommitError('');

    const mergedFields = {};
    for (const f of fieldList) mergedFields[f] = importedTool[f];

    // Build presetChanges array for mergeTool
    const presetChanges = presetChangeList.map(([masterPresetGuid, { incoming, selectedFields: fields }]) => ({
      masterPresetGuid,
      incomingPreset: incoming,
      selectedFields: fields,
    }));

    let assemblyUpdate = null;
    if (hasIncomingAssembly && assemblyAction !== 'skip') {
      if (assemblyAction === 'create') {
        assemblyUpdate = {
          type: 'create',
          assembly: {
            assembly_id: generateAssemblyId(),
            holder_guid: incomingHolderGuid,
            holder_description: incomingHolderDesc,
            ooh: incomingOoh,
            linked_preset_guids: newPresetList.map(p => p.guid),
            notes: '',
            created_at: new Date().toISOString(),
            source: 'merge',
          },
        };
      } else if (assemblyAction === 'link' && linkTargetId) {
        const existing = (masterTool.assemblies || []).find(a => a.assembly_id === linkTargetId);
        if (existing) {
          assemblyUpdate = {
            type: 'link',
            assembly: {
              ...existing,
              linked_preset_guids: [
                ...new Set([...(existing.linked_preset_guids || []), ...newPresetList.map(p => p.guid)]),
              ],
            },
          };
        }
      }
    }

    try {
      await mergeTool(masterTool, mergedFields, revisionNote.trim(), mergedBy.trim(), presetChanges, newPresetList, assemblyUpdate);
      onCommitted();
    } catch (err) {
      setCommitError(err.message);
    }
  };

  const totalChanges = fieldList.length
    + presetChangeList.reduce((s, [, { selectedFields: f }]) => s + f.size, 0)
    + newPresetList.length;

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
            {totalChanges} change{totalChanges !== 1 ? 's' : ''} to commit
          </span>
        </div>
        <div className="panel-body">
          {/* Flat tool fields */}
          {fieldList.length > 0 && (
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
          )}

          {/* Preset field changes */}
          {presetChangeList.map(([guid, { name, incoming, selectedFields: fields }]) => (
            <div key={guid} style={{ marginTop: fieldList.length > 0 ? 12 : 0 }}>
              <div className="text-xs text-sub" style={{ padding: '4px 0', fontWeight: 600 }}>
                Preset: {name || 'Unnamed'} — {fields.size} field{fields.size !== 1 ? 's' : ''}
              </div>
              <div className="commit-field-list">
                {[...fields].map(f => {
                  const master = masterTool.presets?.find(p => p.guid === guid);
                  return (
                    <div key={f} className="commit-field-row">
                      <span className="commit-field-name">{PRESET_FIELD_LABELS[f] || f}</span>
                      <span className="commit-field-old">{formatValue(master?.[f])}</span>
                      <span className="diff-arrow">→</span>
                      <span className="commit-field-new">{formatValue(incoming[f])}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* New presets being added */}
          {newPresetList.length > 0 && (
            <div style={{ marginTop: (fieldList.length > 0 || presetChangeList.length > 0) ? 12 : 0 }}>
              <div className="text-xs text-sub" style={{ padding: '4px 0', fontWeight: 600 }}>
                <Plus size={11} style={{ display: 'inline', marginRight: 4 }} />
                Adding {newPresetList.length} new preset{newPresetList.length !== 1 ? 's' : ''}
              </div>
              <div className="commit-field-list">
                {newPresetList.map(p => (
                  <div key={p.guid} className="commit-field-row">
                    <span className="commit-field-name">{p.name || 'Unnamed'}</span>
                    <span className="commit-field-old" style={{ fontStyle: 'italic' }}>— not in master —</span>
                    <span className="diff-arrow">+</span>
                    <span className="commit-field-new" style={{ color: '#a78bfa' }}>New preset</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Assembly detection — shown only when new presets are being added and incoming tool has OOH */}
      {hasIncomingAssembly && (
        <div className="panel mb-20">
          <div className="panel-header static">
            <Wrench size={14} className="panel-header-icon" />
            <span className="panel-header-title">Assembly Detected</span>
          </div>
          <div className="panel-body">
            <div className="text-sm text-sub mb-12">
              This tool came in with holder/OOH data:
              {incomingHolderDesc && <strong> {incomingHolderDesc}</strong>}
              {incomingOoh != null && <> · OOH: <strong>{incomingOoh.toFixed(3)}"</strong></>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                <input
                  type="radio"
                  name="assemblyAction"
                  value="create"
                  checked={assemblyAction === 'create'}
                  onChange={() => setAssemblyAction('create')}
                />
                Create new assembly (holder + OOH + linked presets)
              </label>
              {(masterTool.assemblies || []).length > 0 && (
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                  <input
                    type="radio"
                    name="assemblyAction"
                    value="link"
                    checked={assemblyAction === 'link'}
                    onChange={() => setAssemblyAction('link')}
                    style={{ marginTop: 2 }}
                  />
                  <span>
                    Link new presets to existing assembly
                    {assemblyAction === 'link' && (
                      <select
                        className="field-input"
                        style={{ display: 'block', marginTop: 6, maxWidth: 300, fontSize: 12 }}
                        value={linkTargetId}
                        onChange={e => setLinkTargetId(e.target.value)}
                      >
                        <option value="">— select assembly —</option>
                        {(masterTool.assemblies || []).map(a => (
                          <option key={a.assembly_id} value={a.assembly_id}>
                            {a.holder_description || 'Assembly'} · OOH: {a.ooh?.toFixed(3)}"
                          </option>
                        ))}
                      </select>
                    )}
                  </span>
                </label>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                <input
                  type="radio"
                  name="assemblyAction"
                  value="skip"
                  checked={assemblyAction === 'skip'}
                  onChange={() => setAssemblyAction('skip')}
                />
                Skip — don't record an assembly
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Revision note */}
      <div className="field-group mb-16">
        <label className="field-label">
          Revision Note <span className="required">*</span>
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
          disabled={!revisionNote.trim() || isSaving}
        >
          {isSaving ? 'Saving…' : isLastItem ? 'Commit & Finish' : 'Commit & Next →'}
        </button>
      </div>
    </div>
  );
}
