import { useState, useMemo } from 'react';
import { ArrowLeft, Tag, Ruler, Gauge, Settings2, StickyNote, AlertTriangle, RefreshCw, Plus, CheckCircle } from 'lucide-react';
import { FIELD_LABELS, generateId } from '../../schema/toolSchema.js';
import { composePresetName, parsePresetName, presetMatchesAssembly } from '../../utils/presetNaming.js';
import { useApp } from '../../context/AppContext.jsx';

const DIFF_SECTIONS = [
  {
    title: 'Identity',
    key: 'identity',
    icon: Tag,
    fields: ['description', 'vendor', 'product_id', 'proshot_id', 'distributor', 'distributor_stock_num', 'cost'],
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
      'material', 'coating', 'coolant', 'helix_angle', 'flute_type',
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

// Preset speed/feed fields eligible for diffing
const PRESET_DIFF_FIELDS = [
  'n', 'v_c', 'n_ramp',
  'v_f', 'f_z',
  'v_f_plunge', 'f_n',
  'v_f_leadIn', 'v_f_leadOut', 'v_f_transition',
  'v_f_ramp', 'ramp-angle',
  'tool-coolant', 'use-stepdown', 'use-stepover',
];

const NUMERIC_PRESET_FIELDS = new Set([
  'n', 'v_c', 'n_ramp',
  'v_f', 'f_z',
  'v_f_plunge', 'f_n',
  'v_f_leadIn', 'v_f_leadOut', 'v_f_transition',
  'v_f_ramp', 'ramp-angle',
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
  'use-stepover': 'Use Stepover',
};

const EXCLUDED = new Set([
  'id', 'tool_type', 'created_at', 'updated_at', 'updated_by', 'revision_notes',
  'merge_history', '_fusionRaw', 'location', 'presets',
  // Flat speed/feed fields — handled by the Presets section
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

// Returns true when the incoming OOH + holder combo doesn't match any existing
// assembly that the master preset's name encodes — meaning these speeds were
// proven in a different physical setup. The assembly↔preset link now lives in
// the preset naming convention (presetMatchesAssembly), not linked_preset_guids.
function checkDifferentAssembly(masterPreset, incomingOoh, incomingHolderGuid, masterAssemblies) {
  if (incomingOoh == null || incomingOoh <= 0) return false;
  const linked = (masterAssemblies || []).filter(a => presetMatchesAssembly(masterPreset, a));
  // Preset name doesn't encode any known assembly but incoming has OOH → new context
  if (linked.length === 0) return true;
  const OOH_TOLERANCE = 0.0005;
  return !linked.some(a =>
    a.ooh != null && Math.abs(a.ooh - incomingOoh) < OOH_TOLERANCE &&
    (!incomingHolderGuid || a.holder_guid === incomingHolderGuid)
  );
}

// Categorize incoming presets against master by name (case-insensitive):
//   unchanged  — name matches, values identical
//   blocked    — name matches, values differ, same assembly context → no update
//   conflicts  — name matches, values differ, different assembly → ask user
//   newPresets — no name match in master → add
//   masterOnly — in master but not in the job (informational)
function matchPresets(incomingPresets, masterPresets, incomingOoh, incomingHolderGuid, masterAssemblies) {
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
      } else if (checkDifferentAssembly(master, incomingOoh, incomingHolderGuid, masterAssemblies)) {
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
}) {
  const { unchanged, blocked, conflicts, newPresets, masterOnly } = presetMatch;
  const totalNew = newPresets.length;
  const totalConflicts = conflicts.length;

  const countParts = [];
  if (unchanged.length > 0) countParts.push(`${unchanged.length} matched`);
  if (totalConflicts > 0) countParts.push(`${totalConflicts} conflict${totalConflicts !== 1 ? 's' : ''}`);
  if (totalNew > 0) countParts.push(`${totalNew} new`);

  return (
    <div className="diff-section">
      <div className="diff-section-header">
        <span style={{ width: 20 }} />
        <Gauge size={14} className="panel-header-icon" />
        <span className="panel-header-title">Speeds &amp; Feeds Presets</span>
        <span className="diff-section-count">{countParts.join(', ') || 'none'}</span>
      </div>

      <div className="diff-advisory">
        <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
        Existing preset values are never overwritten. New presets from the job can be added; conflicting values in a different assembly context can become a new preset.
      </div>

      {/* Conflicts: same name, different values, different assembly context */}
      {conflicts.map(({ master, incoming, changedFields }) => {
        const resolution = conflictResolutions.get(master.guid) || 'ignore';
        return (
          <div key={master.guid} className="preset-diff-block" style={{ borderLeft: '2px solid var(--orange)' }}>
            <div className="preset-diff-header" style={{ background: 'rgba(251,146,60,0.06)' }}>
              <span style={{ width: 20 }} />
              <AlertTriangle size={13} style={{ color: 'var(--orange)', flexShrink: 0 }} />
              <span className="preset-diff-name" style={{ color: 'var(--orange)' }}>
                {master.name || 'Unnamed'} — different assembly context
              </span>
              <span className="text-xs text-sub">
                {changedFields.length} value{changedFields.length !== 1 ? 's' : ''} differ
              </span>
            </div>

            {/* Show what changed (read-only) */}
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

            {/* Resolution choice */}
            <div style={{ padding: '10px 16px', display: 'flex', gap: 20, alignItems: 'center', fontSize: 13, borderTop: '1px solid var(--border)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name={`conflict-${master.guid}`}
                  checked={resolution === 'create'}
                  onChange={() => onSetConflictResolution(master.guid, 'create')}
                />
                <span>
                  Create new preset
                  {incomingOoh != null && (
                    <span className="text-sub text-xs" style={{ marginLeft: 5 }}>
                      (OOH: {incomingOoh.toFixed(3)}")
                    </span>
                  )}
                </span>
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

      {/* New presets: not in master — show with assembly context */}
      {newPresets.length > 0 && (
        <div className="preset-diff-block">
          <div className="preset-diff-header" style={{ background: 'rgba(167,139,250,0.06)' }}>
            <span style={{ width: 20 }} />
            <Plus size={13} style={{ color: '#a78bfa', flexShrink: 0 }} />
            <span className="preset-diff-name" style={{ color: '#a78bfa' }}>New Presets — not in master</span>
            <span className="text-xs text-sub">{newPresets.length} preset{newPresets.length !== 1 ? 's' : ''}</span>
          </div>

          {/* Assembly context annotation */}
          {(incomingOoh != null || incomingHolderDesc) && (
            <div style={{ padding: '5px 16px 3px', fontSize: 11, color: 'var(--text-sub)', borderBottom: '1px solid var(--border)' }}>
              Proven at:{incomingHolderDesc ? <> <strong>{incomingHolderDesc}</strong></> : ''}
              {incomingOoh != null ? <> · OOH <strong>{incomingOoh.toFixed(3)}"</strong></> : ''}
            </div>
          )}

          {newPresets.map(preset => (
            <label key={preset.guid} className={`diff-row ${addedPresets.has(preset.guid) ? 'selected' : ''}`}>
              <input
                type="checkbox"
                className="diff-checkbox"
                checked={addedPresets.has(preset.guid)}
                onChange={() => onToggleAddedPreset(preset.guid)}
              />
              <span className="preset-tag">{preset.name || 'Unnamed'}</span>
              <span className="diff-val diff-val-master" style={{ fontStyle: 'italic' }}>— not in master —</span>
              <span className="diff-arrow">+</span>
              <span className="diff-val diff-val-job" style={{ color: '#a78bfa' }}>Add to master</span>
            </label>
          ))}
        </div>
      )}

      {/* Blocked: same name, values differ, same assembly context → no-op */}
      {blocked.length > 0 && (
        <div className="preset-diff-block" style={{ opacity: 0.6 }}>
          <div className="preset-diff-header">
            <span style={{ width: 20 }} />
            <span className="preset-diff-name" style={{ color: 'var(--text-sub)', fontSize: 12 }}>
              Not updating — same assembly, different values (keep master):
            </span>
            <span className="text-xs text-sub">{blocked.map(b => b.master.name || 'Unnamed').join(', ')}</span>
          </div>
        </div>
      )}

      {/* Unchanged: identical values */}
      {unchanged.length > 0 && (
        <div className="preset-diff-block" style={{ opacity: 0.5 }}>
          <div className="preset-diff-header">
            <span style={{ width: 20 }} />
            <CheckCircle size={12} style={{ color: 'var(--text-sub)', flexShrink: 0 }} />
            <span className="preset-diff-name" style={{ color: 'var(--text-sub)', fontSize: 12 }}>
              Identical — no changes:
            </span>
            <span className="text-xs text-sub">{unchanged.map(u => u.master.name || 'Unnamed').join(', ')}</span>
          </div>
        </div>
      )}

      {/* Master-only presets (informational) */}
      {masterOnly.length > 0 && (
        <div className="preset-diff-block" style={{ opacity: 0.55 }}>
          <div className="preset-diff-header">
            <span style={{ width: 20 }} />
            <span className="preset-diff-name" style={{ color: 'var(--text-sub)' }}>
              Master-only — not in this job:
            </span>
            <span className="text-xs text-sub">{masterOnly.map(p => p.name || 'Unnamed').join(', ')}</span>
          </div>
        </div>
      )}
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
      incomingOoh, incomingHolderGuid, masterTool.assemblies
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [importedTool.presets, masterTool.presets, incomingOoh, incomingHolderGuid, masterTool.assemblies]
  );

  // Flat tool-level diffs
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

  // Flat field selections
  const [selected, setSelected] = useState(() => {
    const s = new Set();
    for (const fields of Object.values(diffs)) fields.forEach(f => s.add(f));
    return s;
  });

  // New presets selected for addition — all selected by default
  const [addedPresets, setAddedPresets] = useState(
    () => new Set(presetMatch.newPresets.map(p => p.guid))
  );

  // Conflict resolutions: Map<masterPresetGuid, 'create' | 'ignore'>
  // Default to 'ignore' (safe — don't pollute master without explicit intent)
  const [conflictResolutions, setConflictResolutions] = useState(() => {
    const m = new Map();
    for (const { master } of presetMatch.conflicts) m.set(master.guid, 'ignore');
    return m;
  });

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

  // Show the diff screen whenever there is anything to review, including
  // blocked presets (values differ but won't be updated — still informational).
  const hasAnyChange = Object.values(diffs).some(arr => arr.length > 0)
    || presetMatch.conflicts.length > 0
    || presetMatch.newPresets.length > 0
    || presetMatch.blocked.length > 0;

  const handleConfirm = () => {
    // Conflict presets chosen as 'create' become new presets with a fresh GUID
    // (the incoming preset's GUID matches the master preset's GUID, so we must
    // generate a new one) and a convention name encoding the incoming assembly.
    const conflictPresetsToAdd = presetMatch.conflicts
      .filter(({ master }) => (conflictResolutions.get(master.guid) || 'ignore') === 'create')
      .map(({ incoming }) => {
        const opType = incoming.operation_type ?? parsePresetName(incoming.name)?.opType ?? null;
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

    // New presets keep their incoming GUID; ensure each carries operation_type.
    const newPresetsToAdd = presetMatch.newPresets
      .filter(p => addedPresets.has(p.guid))
      .map(p => ({
        ...p,
        operation_type: p.operation_type ?? parsePresetName(p.name)?.opType ?? null,
      }));

    const presetsToAdd = [
      ...newPresetsToAdd,
      ...conflictPresetsToAdd,
    ];

    // Existing preset values are never updated, so presetSelections is always empty.
    onConfirm({ selectedFields: selected, presetSelections: new Map(), presetsToAdd });
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
                  <span className="diff-field-label">{FIELD_LABELS[field] || field}</span>
                  <span className="diff-val diff-val-master">{formatValue(masterTool[field])}</span>
                  <span className="diff-arrow">→</span>
                  <span className="diff-val diff-val-job">{formatValue(importedTool[field])}</span>
                </label>
              ))}
            </div>
          </div>
        );
      })}

      {/* Preset-level diff */}
      {hasPresets && (
        <PresetsDiff
          presetMatch={presetMatch}
          incomingOoh={incomingOoh}
          incomingHolderDesc={incomingHolderDesc}
          addedPresets={addedPresets}
          conflictResolutions={conflictResolutions}
          onToggleAddedPreset={toggleAddedPreset}
          onSetConflictResolution={setConflictResolution}
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
