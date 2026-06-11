import { useState, useMemo } from 'react';
import { ArrowLeft, Tag, Ruler, Gauge, Settings2, StickyNote, AlertTriangle, RefreshCw, Plus, CheckCircle, Wrench } from 'lucide-react';
import { generateId, generateAssemblyId } from '../../schema/toolSchema.js';
import { fieldLabel } from '../../schema/fieldRegistry.js';
import { composePresetName, parsePresetName, presetMatchesAssembly, HOLE_MAKING_TYPES } from '../../utils/presetNaming.js';
import { lengthEps, unitAbbr } from '../../utils/units.js';
import { useApp } from '../../context/AppContext.jsx';
import InfoTip from '../InfoTip.jsx';

const DIFF_SECTIONS = [
  {
    title: 'Identity',
    key: 'identity',
    icon: Tag,
    fields: ['description', 'vendor', 'proshot_id'],
  },
  {
    title: 'Geometry',
    key: 'geometry',
    icon: Ruler,
    fields: [
      'diameter', 'flute_length', 'overall_length', 'number_of_flutes',
      'shank_diameter', 'corner_radius', 'shoulder_length', 'tip_angle',
      'taper_angle', 'tip_diameter', 'lower_radius', 'upper_radius',
      'profile_radius', 'axial_distance',
    ],
  },
  {
    title: 'Setup',
    key: 'setup',
    icon: Settings2,
    fields: [
      'material', 'coating', 'tsc_capable', 'helix_angle', 'flute_type',
      'cutting_direction', 'center_cutting', 'preferred_machine',
      'material_suitability', 'tags',
    ],
  },
  {
    title: 'Notes',
    key: 'notes',
    icon: StickyNote,
    fields: ['notes', 'last_used_job'],
  },
];

const PRESET_DIFF_FIELDS = [
  'n', 'v_c', 'n_ramp',
  'v_f', 'f_z',
  'v_f_plunge', 'f_n',
  'v_f_leadIn', 'v_f_leadOut', 'v_f_transition',
  'v_f_ramp', 'ramp-angle',
  'use-stepdown', 'stepdown',
  'use-stepover', 'stepover',
  'tool-coolant',
];

const NUMERIC_PRESET_FIELDS = new Set([
  'n', 'v_c', 'n_ramp',
  'v_f', 'f_z',
  'v_f_plunge', 'f_n',
  'v_f_leadIn', 'v_f_leadOut', 'v_f_transition',
  'v_f_ramp', 'ramp-angle',
  'stepdown', 'stepover',
]);

const PRESET_FIELD_LABELS = {
  n: 'Spindle Speed (RPM)',
  v_c: 'Surface Speed',
  n_ramp: 'Ramp Spindle Speed (RPM)',
  v_f: 'Cutting Feedrate',
  f_z: 'Feed per Tooth',
  v_f_plunge: 'Plunge Feedrate',
  f_n: 'Feed per Rev',
  v_f_leadIn: 'Lead-In Feedrate',
  v_f_leadOut: 'Lead-Out Feedrate',
  v_f_transition: 'Transition Feedrate',
  v_f_ramp: 'Ramp Feedrate',
  'ramp-angle': 'Ramp Angle (°)',
  'tool-coolant': 'Coolant',
  'use-stepdown': 'Use Stepdown',
  'stepdown': 'Stepdown',
  'use-stepover': 'Use Stepover',
  'stepover': 'Stepover',
};

const EXCLUDED = new Set([
  'id', 'tool_type', 'created_at', 'updated_at', 'updated_by', 'revision_notes',
  'merge_history', '_fusionRaw', 'location', 'presets',
  'spindle_speed', 'cutting_feedrate', 'feed_per_tooth', 'feed_per_rev',
  'plunge_feedrate', 'ramp_feedrate', 'lead_in_feedrate', 'lead_out_feedrate',
  'cutting_speed', 'depth_of_cut', 'width_of_cut',
]);

function formatValue(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const n = Number(v);
  if (!isNaN(n) && v !== '') return Math.round(n * 10000) / 10000;
  return String(v);
}

function presetTolerance(a, b) {
  const v = Math.max(Math.abs(Number(a)), Math.abs(Number(b)));
  if (v < 1)    return 0.0001;
  if (v < 10)   return 0.5;
  if (v < 1000) return 10;
  return 25;
}

function valuesEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const isEmpty = v => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
  if (isEmpty(a) && isEmpty(b)) return true;
  const na = Number(a), nb = Number(b);
  if (!isNaN(na) && !isNaN(nb) && a !== '' && b !== '') return na === nb;
  return false;
}

function checkDifferentAssembly(masterPreset, incomingOoh, incomingHolderGuid, masterAssemblies, unit = 'inches') {
  if (incomingOoh == null || incomingOoh <= 0) return false;
  const linked = (masterAssemblies || []).filter(a => presetMatchesAssembly(masterPreset, a, unit));
  if (linked.length === 0) return true;
  // OOH (both incoming and stored) is in the tool's own unit; tolerance scales with it.
  const oohTol = lengthEps(unit);
  return !linked.some(a =>
    a.ooh != null && Math.abs(a.ooh - incomingOoh) < oohTol &&
    (!incomingHolderGuid || a.holder_guid === incomingHolderGuid)
  );
}

function matchPresets(incomingPresets, masterPresets, incomingOoh, incomingHolderGuid, masterAssemblies, unit = 'inches') {
  const masterByName = new Map(
    (masterPresets || []).map(p => [p.name?.toLowerCase().trim(), p])
  );
  const matchedMasterGuids = new Set();
  const unchanged = [];
  const blocked = [];
  const conflicts = [];
  const newPresets = [];

  for (const incoming of (incomingPresets || [])) {
    const key = incoming.name?.toLowerCase().trim();
    const master = masterByName.get(key);
    if (master) {
      matchedMasterGuids.add(master.guid);
      const changedFields = PRESET_DIFF_FIELDS.filter(f => {
        if (NUMERIC_PRESET_FIELDS.has(f)) {
          const na = Number(incoming[f]), nb = Number(master[f]);
          if (!isNaN(na) && !isNaN(nb)) return Math.abs(na - nb) > presetTolerance(na, nb);
        }
        return !valuesEqual(incoming[f], master[f]);
      });
      if (changedFields.length === 0) {
        unchanged.push({ incoming, master });
      } else if (checkDifferentAssembly(master, incomingOoh, incomingHolderGuid, masterAssemblies, unit)) {
        conflicts.push({ incoming, master, changedFields });
      } else {
        blocked.push({ incoming, master, changedFields });
      }
    } else {
      newPresets.push(incoming);
    }
  }

  const masterOnly = (masterPresets || []).filter(p => !matchedMasterGuids.has(p.guid));
  return { unchanged, blocked, conflicts, newPresets, masterOnly };
}

// ─── Preset diff sub-component ────────────────────────────────────────────────
function PresetsDiff({
  presetMatch, incomingOoh, incomingHolderDesc,
  addedPresets, conflictResolutions,
  onToggleAddedPreset, onSetConflictResolution,
  masterAssemblies,
  assemblyAction, onSetAssemblyAction,
  linkTargetId, onSetLinkTargetId,
}) {
  const { unchanged, blocked, conflicts, newPresets, masterOnly } = presetMatch;

  const selectedNewCount = newPresets.filter(p => addedPresets.has(p.guid)).length;
  const conflictCreateCount = [...conflictResolutions.values()].filter(v => v === 'create').length;
  const willAddPresets = selectedNewCount + conflictCreateCount > 0;
  const showAssemblyPrompt = (incomingOoh != null && incomingOoh > 0) && willAddPresets;

  const totalChanged = blocked.length + conflicts.length;
  const totalUnchanged = unchanged.length + masterOnly.length;

  const summaryParts = [];
  if (newPresets.length > 0) summaryParts.push(`${newPresets.length} new`);
  if (conflicts.length > 0) summaryParts.push(`${conflicts.length} conflict${conflicts.length !== 1 ? 's' : ''}`);
  if (totalUnchanged > 0) summaryParts.push(`${totalUnchanged} matched`);

  return (
    <div className="diff-section">
      <div className="diff-section-header">
        <span style={{ width: 20 }} />
        <Gauge size={14} className="panel-header-icon" />
        <span className="panel-header-title">Speeds &amp; Feeds Presets</span>
        <InfoTip
          alignRight
          text="Presets are speed/feed settings for each machining operation. Existing preset values in master are never overwritten — you can only add new ones or create variants for different setups."
        />
        <span className="diff-section-count">{summaryParts.join(', ') || 'none'}</span>
      </div>

      {/* ── Sub-section 1: New Presets ── */}
      <div className="preset-subsection">
        <div className="preset-subsection-header">
          <Plus size={12} style={{ color: '#a78bfa' }} />
          <span style={{ color: '#a78bfa' }}>New Presets</span>
          <InfoTip text="These presets are in the job but not yet in master. Check the ones you want to add." />
          <span className="diff-section-count">
            {newPresets.length > 0
              ? `${newPresets.length} preset${newPresets.length !== 1 ? 's' : ''}`
              : 'none'}
          </span>
        </div>

        {newPresets.length === 0 ? (
          <div className="preset-subsection-empty">No new presets — all job presets already exist in master</div>
        ) : (
          <div className="diff-rows">
            {newPresets.map(preset => (
              <label
                key={preset.guid}
                className={`diff-row ${addedPresets.has(preset.guid) ? 'selected' : ''}`}
                style={{ gridTemplateColumns: '24px 1fr' }}
              >
                <input
                  type="checkbox"
                  className="diff-checkbox"
                  checked={addedPresets.has(preset.guid)}
                  onChange={() => onToggleAddedPreset(preset.guid)}
                />
                <span className="preset-tag">{preset.name || 'Unnamed'}</span>
              </label>
            ))}
          </div>
        )}

        {/* Assembly detection — inline with new presets since they are related */}
        {showAssemblyPrompt && (
          <div className="preset-assembly-detect">
            <div className="preset-assembly-detect-label">
              <Wrench size={12} />
              Record the setup for these presets?
              <InfoTip text="An assembly tracks which holder and stick-out length (OOH) these presets were proven at. Recommended — it lets future users know the exact physical setup that produced these speeds and feeds." />
            </div>
            <div className="preset-assembly-context-line">
              Proven at:
              {incomingHolderDesc ? <strong> {incomingHolderDesc}</strong> : ''}
              {incomingOoh != null ? <> · OOH <strong>{incomingOoh.toFixed(3)} {unitAbbr(masterTool.unit)}</strong></> : ''}
            </div>
            <div className="preset-assembly-options">
              <label>
                <input
                  type="radio"
                  name="assemblyAction"
                  value="create"
                  checked={assemblyAction === 'create'}
                  onChange={() => onSetAssemblyAction('create')}
                />
                Create a new assembly record (recommended)
              </label>
              {(masterAssemblies || []).length > 0 && (
                <>
                  <label>
                    <input
                      type="radio"
                      name="assemblyAction"
                      value="link"
                      checked={assemblyAction === 'link'}
                      onChange={() => onSetAssemblyAction('link')}
                    />
                    Add to an existing assembly
                  </label>
                  {assemblyAction === 'link' && (
                    <select
                      className="field-input"
                      style={{ marginLeft: 22, maxWidth: 300, fontSize: 12, marginTop: 4 }}
                      value={linkTargetId}
                      onChange={e => onSetLinkTargetId(e.target.value)}
                    >
                      <option value="">— select assembly —</option>
                      {(masterAssemblies || []).map(a => (
                        <option key={a.assembly_id} value={a.assembly_id}>
                          {a.holder_description || 'Assembly'} · OOH: {a.ooh?.toFixed(3)}"
                        </option>
                      ))}
                    </select>
                  )}
                </>
              )}
              <label>
                <input
                  type="radio"
                  name="assemblyAction"
                  value="skip"
                  checked={assemblyAction === 'skip'}
                  onChange={() => onSetAssemblyAction('skip')}
                />
                Skip — don't record setup info
              </label>
            </div>
          </div>
        )}
      </div>

      {/* ── Sub-section 2: Existing — Identical ── */}
      <div className="preset-subsection">
        <div className="preset-subsection-header">
          <CheckCircle size={12} style={{ color: 'var(--text-sub)' }} />
          <span>Existing — Identical</span>
          <InfoTip text="These presets exist in both master and this job with the same values. No action needed." />
          <span className="diff-section-count">
            {totalUnchanged > 0
              ? `${totalUnchanged} preset${totalUnchanged !== 1 ? 's' : ''}`
              : 'none'}
          </span>
        </div>
        {totalUnchanged === 0 ? (
          <div className="preset-subsection-empty">None</div>
        ) : (
          <div className="preset-subsection-names">
            {[
              ...unchanged.map(u => u.master.name || 'Unnamed'),
              ...masterOnly.map(p => p.name || 'Unnamed'),
            ].join(', ')}
          </div>
        )}
      </div>

      {/* ── Sub-section 3: Existing — Changed ── */}
      <div className="preset-subsection">
        <div className="preset-subsection-header">
          <AlertTriangle size={12} style={{ color: totalChanged > 0 ? 'var(--amber)' : 'var(--text-sub)' }} />
          <span style={{ color: totalChanged > 0 ? 'var(--amber)' : undefined }}>Existing — Changed</span>
          <InfoTip text="Same preset name, different values from this job. Master values are never overwritten. If the job used a different holder/OOH setup, the job values can be saved as a new preset variant." />
          <span className="diff-section-count">
            {totalChanged > 0
              ? `${totalChanged} preset${totalChanged !== 1 ? 's' : ''}`
              : 'none'}
          </span>
        </div>

        {/* Conflicts: different assembly context — user can create a new variant */}
        {conflicts.map(({ master, incoming, changedFields }) => {
          const resolution = conflictResolutions.get(master.guid) || 'ignore';
          return (
            <div key={master.guid} style={{ borderTop: '1px solid var(--border)' }}>
              <div className="preset-diff-header" style={{ background: 'rgba(251,146,60,0.06)' }}>
                <AlertTriangle size={13} style={{ color: 'var(--orange)', flexShrink: 0, marginLeft: 14 }} />
                <span className="preset-diff-name" style={{ color: 'var(--orange)', marginLeft: 6 }}>
                  {master.name || 'Unnamed'}
                </span>
                <span className="text-xs text-sub" style={{ marginLeft: 'auto', marginRight: 14 }}>
                  Different setup · {changedFields.length} value{changedFields.length !== 1 ? 's' : ''} differ
                </span>
              </div>
              <div className="diff-rows">
                {changedFields.map(field => (
                  <div key={field} className="diff-row" style={{ cursor: 'default' }}>
                    <span style={{ width: 20 }} />
                    <span className="diff-field-label">{PRESET_FIELD_LABELS[field] || field}</span>
                    <span className="diff-val diff-val-master">{formatValue(master[field])}</span>
                    <span className="diff-arrow">→</span>
                    <span className="diff-val diff-val-job">{formatValue(incoming[field])}</span>
                  </div>
                ))}
              </div>
              <div style={{ padding: '10px 16px', display: 'flex', gap: 20, alignItems: 'center', fontSize: 13, borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name={`conflict-${master.guid}`}
                    checked={resolution === 'create'}
                    onChange={() => onSetConflictResolution(master.guid, 'create')}
                  />
                  Save as new preset variant
                  {incomingOoh != null && (
                    <span className="text-sub text-xs" style={{ marginLeft: 5 }}>
                      (at OOH {incomingOoh.toFixed(3)} {unitAbbr(masterTool.unit)})
                    </span>
                  )}
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name={`conflict-${master.guid}`}
                    checked={resolution === 'ignore'}
                    onChange={() => onSetConflictResolution(master.guid, 'ignore')}
                  />
                  Ignore
                </label>
              </div>
            </div>
          );
        })}

        {/* Blocked: same assembly — master values kept, no user action available */}
        {blocked.length > 0 && (
          <div className="preset-subsection-names" style={{ borderTop: conflicts.length > 0 ? '1px solid var(--border)' : 'none' }}>
            <span style={{ color: 'var(--text-sub)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>
              Same setup — master values kept:
            </span>
            {blocked.map(b => b.master.name || 'Unnamed').join(', ')}
          </div>
        )}

        {totalChanged === 0 && (
          <div className="preset-subsection-empty">None</div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function DiffStep({
  importedTool, masterTool, onConfirm, onBack, onSkip,
  masterUpdated = false, isFetchingLive = false,
  queuePosition = null,
}) {
  const { holders } = useApp();

  const incomingOoh = importedTool.incoming_ooh ?? null;
  const incomingHolderGuid = importedTool.incoming_holder_guid || '';
  const incomingHolderDesc = importedTool._incomingHolderDesc
    || holders?.find(h => h.guid === incomingHolderGuid)?.description
    || '';

  const hasPresets = (importedTool.presets?.length > 0) || (masterTool.presets?.length > 0);

  const presetMatch = useMemo(
    () => matchPresets(
      importedTool.presets, masterTool.presets,
      incomingOoh, incomingHolderGuid, masterTool.assemblies, masterTool.unit
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [importedTool.presets, masterTool.presets, incomingOoh, incomingHolderGuid, masterTool.assemblies, masterTool.unit]
  );

  const diffs = useMemo(() => {
    const result = {};
    for (const section of DIFF_SECTIONS) {
      const changed = section.fields.filter(
        f => !EXCLUDED.has(f) && !valuesEqual(importedTool[f], masterTool[f])
      );
      if (changed.length) result[section.key] = changed;
    }
    return result;
  }, [importedTool, masterTool]);

  const [selected, setSelected] = useState(() => {
    const s = new Set();
    for (const fields of Object.values(diffs)) fields.forEach(f => s.add(f));
    return s;
  });

  const [addedPresets, setAddedPresets] = useState(
    () => new Set(presetMatch.newPresets.map(p => p.guid))
  );

  const [conflictResolutions, setConflictResolutions] = useState(() => {
    const m = new Map();
    for (const { master } of presetMatch.conflicts) m.set(master.guid, 'ignore');
    return m;
  });

  // Assembly state — lives here so the decision is made alongside the presets
  const [assemblyAction, setAssemblyAction] = useState('create');
  const [linkTargetId, setLinkTargetId] = useState('');

  const toggleFlat = (field) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(field)) next.delete(field); else next.add(field);
    return next;
  });

  const toggleFlatSection = (sectionKey) => {
    const fields = diffs[sectionKey] || [];
    const allOn = fields.every(f => selected.has(f));
    setSelected(prev => {
      const next = new Set(prev);
      if (allOn) fields.forEach(f => next.delete(f));
      else fields.forEach(f => next.add(f));
      return next;
    });
  };

  const toggleAddedPreset = (guid) => {
    setAddedPresets(prev => {
      const next = new Set(prev);
      if (next.has(guid)) next.delete(guid); else next.add(guid);
      return next;
    });
  };

  const setConflictResolution = (masterGuid, resolution) => {
    setConflictResolutions(prev => new Map(prev).set(masterGuid, resolution));
  };

  const conflictCreates = [...conflictResolutions.values()].filter(v => v === 'create').length;
  const totalSelected = selected.size + addedPresets.size + conflictCreates;

  const hasAnyChange = Object.values(diffs).some(arr => arr.length > 0)
    || presetMatch.conflicts.length > 0
    || presetMatch.newPresets.length > 0
    || presetMatch.blocked.length > 0;

  const handleConfirm = () => {
    const conflictPresetsToAdd = presetMatch.conflicts
      .filter(({ master }) => (conflictResolutions.get(master.guid) || 'ignore') === 'create')
      .map(({ incoming }) => {
        const isHoleMakingTool = HOLE_MAKING_TYPES.has(masterTool.tool_type);
        const opType = isHoleMakingTool
          ? null
          : (incoming.operation_type ?? parsePresetName(incoming.name)?.opType ?? null);
        return {
          ...incoming,
          guid: generateId(),
          operation_type: opType,
          name: composePresetName({
            materialQuery: incoming.material?.query,
            ooh: incomingOoh,
            holderDescription: incomingHolderDesc,
            opType,
          }) || incoming.name,
        };
      });

    const newPresetsToAdd = presetMatch.newPresets
      .filter(p => addedPresets.has(p.guid))
      .map(p => ({
        ...p,
        operation_type: p.operation_type ?? parsePresetName(p.name)?.opType ?? null,
      }));

    const presetsToAdd = [...newPresetsToAdd, ...conflictPresetsToAdd];

    // Build assemblyUpdate here so CommitStep just confirms and writes
    const hasIncomingAssembly = incomingOoh != null && incomingOoh > 0 && presetsToAdd.length > 0;
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
            linked_preset_guids: presetsToAdd.map(p => p.guid),
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
                ...new Set([...(existing.linked_preset_guids || []), ...presetsToAdd.map(p => p.guid)]),
              ],
            },
          };
        }
      }
    }

    onConfirm({ selectedFields: selected, presetSelections: new Map(), presetsToAdd, assemblyUpdate });
  };

  if (isFetchingLive) {
    return (
      <div className="loading-screen" style={{ minHeight: 160 }}>
        <div className="spinner" />
        <span className="text-sub text-sm">Fetching live master from APS…</span>
      </div>
    );
  }

  if (!hasAnyChange) {
    return (
      <div>
        <h3 className="import-section-title">No Differences</h3>
        <p className="text-sub text-sm mb-20">
          The imported tool's values already match the master. Nothing to merge.
        </p>
        <div className="flex gap-8">
          <button className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft size={14} /> Back</button>
          {onSkip && <button className="btn btn-ghost btn-sm" onClick={onSkip}>Skip →</button>}
        </div>
      </div>
    );
  }

  const totalFlatChanged = Object.values(diffs).reduce((s, a) => s + a.length, 0);
  const presetSummaryParts = [];
  if (presetMatch.unchanged.length > 0) presetSummaryParts.push(`${presetMatch.unchanged.length} matched`);
  if (presetMatch.conflicts.length > 0) presetSummaryParts.push(`${presetMatch.conflicts.length} conflict${presetMatch.conflicts.length !== 1 ? 's' : ''}`);
  if (presetMatch.newPresets.length > 0) presetSummaryParts.push(`${presetMatch.newPresets.length} new`);

  return (
    <div>
      {masterUpdated && (
        <div className="diff-updated-notice mb-12">
          <RefreshCw size={13} /> Master was updated since your session started — showing latest version.
        </div>
      )}

      <div className="diff-header mb-16">
        <div>
          <h3 className="import-section-title" style={{ marginBottom: 4 }}>Review Changes</h3>
          <p className="text-sub text-sm">
            {queuePosition && <span style={{ marginRight: 6 }}>({queuePosition})</span>}
            {totalFlatChanged > 0 && `${totalFlatChanged} tool field${totalFlatChanged !== 1 ? 's' : ''}`}
            {totalFlatChanged > 0 && presetSummaryParts.length > 0 && ', '}
            {presetSummaryParts.length > 0 && `presets: ${presetSummaryParts.join(', ')}`}
          </p>
        </div>
        <div className="diff-col-labels">
          <span>Master</span>
          <span>Job (new)</span>
        </div>
      </div>

      {/* Flat tool-level sections */}
      {DIFF_SECTIONS.map(section => {
        const changed = diffs[section.key];
        if (!changed?.length) return null;
        const Icon = section.icon;
        const allOn = changed.every(f => selected.has(f));
        const someOn = changed.some(f => selected.has(f));
        return (
          <div key={section.key} className="diff-section">
            <div className="diff-section-header">
              <label className="diff-section-select">
                <input
                  type="checkbox"
                  checked={allOn}
                  ref={el => { if (el) el.indeterminate = !allOn && someOn; }}
                  onChange={() => toggleFlatSection(section.key)}
                />
              </label>
              <Icon size={14} className="panel-header-icon" />
              <span className="panel-header-title">{section.title}</span>
              <span className="diff-section-count">{changed.length} change{changed.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="diff-rows">
              {changed.map(field => (
                <label key={field} className={`diff-row ${selected.has(field) ? 'selected' : ''}`}>
                  <input
                    type="checkbox"
                    className="diff-checkbox"
                    checked={selected.has(field)}
                    onChange={() => toggleFlat(field)}
                  />
                  <span className="diff-field-label">{fieldLabel(field, masterTool.unit) || field}</span>
                  <span className="diff-val diff-val-master">{formatValue(masterTool[field])}</span>
                  <span className="diff-arrow">→</span>
                  <span className="diff-val diff-val-job">{formatValue(importedTool[field])}</span>
                </label>
              ))}
            </div>
          </div>
        );
      })}

      {/* Preset-level diff — always shown if either side has presets */}
      {hasPresets && (
        <PresetsDiff
          presetMatch={presetMatch}
          incomingOoh={incomingOoh}
          incomingHolderDesc={incomingHolderDesc}
          addedPresets={addedPresets}
          conflictResolutions={conflictResolutions}
          onToggleAddedPreset={toggleAddedPreset}
          onSetConflictResolution={setConflictResolution}
          masterAssemblies={masterTool.assemblies}
          assemblyAction={assemblyAction}
          onSetAssemblyAction={setAssemblyAction}
          linkTargetId={linkTargetId}
          onSetLinkTargetId={setLinkTargetId}
        />
      )}

      {/* Sticky action bar */}
      <div className="diff-summary-bar">
        <div className="flex items-center gap-8">
          <button className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft size={14} /> Back</button>
          {onSkip && <button className="btn btn-ghost btn-sm" onClick={onSkip}>Skip</button>}
          <span className="text-sub text-sm">{totalSelected} change{totalSelected !== 1 ? 's' : ''} selected</span>
        </div>
        <button
          className="btn btn-primary"
          disabled={totalSelected === 0}
          onClick={handleConfirm}
        >
          Review &amp; Commit →
        </button>
      </div>
    </div>
  );
}
