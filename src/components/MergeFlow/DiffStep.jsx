import { useState, useMemo } from 'react';
import { ArrowLeft, Tag, Ruler, Gauge, Settings2, StickyNote, AlertTriangle, RefreshCw, Plus } from 'lucide-react';
import { FIELD_LABELS } from '../../schema/toolSchema.js';

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

function valuesEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const isEmpty = v => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
  if (isEmpty(a) && isEmpty(b)) return true;
  const na = Number(a), nb = Number(b);
  if (!isNaN(na) && !isNaN(nb) && a !== '' && b !== '') return na === nb;
  return false;
}

// Match incoming presets to master presets by name (case-insensitive trim).
function matchPresets(incomingPresets, masterPresets) {
  const masterByName = new Map(
    (masterPresets || []).map(p => [p.name?.toLowerCase().trim(), p])
  );
  const matchedMasterGuids = new Set();
  const matched = [];
  const newPresets = [];

  for (const incoming of (incomingPresets || [])) {
    const key = incoming.name?.toLowerCase().trim();
    const master = masterByName.get(key);
    if (master) {
      matched.push({ incoming, master });
      matchedMasterGuids.add(master.guid);
    } else {
      newPresets.push(incoming);
    }
  }

  const masterOnly = (masterPresets || []).filter(p => !matchedMasterGuids.has(p.guid));
  return { matched, newPresets, masterOnly };
}

// ─── Preset diff sub-component ────────────────────────────────────────────────
function PresetsDiff({
  presetMatch, presetFieldSelections, addedPresets,
  onTogglePresetField, onTogglePresetAllFields, onToggleAddedPreset,
}) {
  const { matched, newPresets, masterOnly } = presetMatch;

  return (
    <div className="diff-section">
      <div className="diff-section-header">
        <span style={{ width: 20 }} />
        <Gauge size={14} className="panel-header-icon" />
        <span className="panel-header-title">Speeds &amp; Feeds Presets</span>
        <span className="diff-section-count">
          {matched.length} matched{newPresets.length > 0 ? `, ${newPresets.length} new` : ''}
        </span>
      </div>

      <div className="diff-advisory">
        <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
        Speeds &amp; feeds are job-specific. Verify these values work for all uses of this tool before committing.
      </div>

      {/* Matched preset pairs */}
      {matched.map(({ master, incoming }) => {
        const changedFields = PRESET_DIFF_FIELDS.filter(f => !valuesEqual(incoming[f], master[f]));
        const selections = presetFieldSelections.get(master.guid) || new Set();
        const allOn = changedFields.length > 0 && changedFields.every(f => selections.has(f));
        const someOn = changedFields.some(f => selections.has(f));

        return (
          <div key={master.guid} className="preset-diff-block">
            <div className="preset-diff-header">
              <label className="diff-section-select">
                <input
                  type="checkbox"
                  checked={allOn}
                  disabled={changedFields.length === 0}
                  ref={el => { if (el) el.indeterminate = !allOn && someOn; }}
                  onChange={() => onTogglePresetAllFields(master.guid, changedFields)}
                />
              </label>
              <span className="preset-diff-name">{master.name || 'Unnamed'}</span>
              <span className="text-xs text-sub">
                {changedFields.length === 0 ? 'No changes' : `${changedFields.length} field${changedFields.length !== 1 ? 's' : ''} differ`}
              </span>
            </div>
            {changedFields.length > 0 && (
              <div className="diff-rows">
                {changedFields.map(field => (
                  <label key={field} className={`diff-row ${selections.has(field) ? 'selected' : ''}`}>
                    <input
                      type="checkbox"
                      className="diff-checkbox"
                      checked={selections.has(field)}
                      onChange={() => onTogglePresetField(master.guid, field)}
                    />
                    <span className="diff-field-label">{PRESET_FIELD_LABELS[field] || field}</span>
                    <span className="diff-val diff-val-master">{formatValue(master[field])}</span>
                    <span className="diff-arrow">→</span>
                    <span className="diff-val diff-val-job">{formatValue(incoming[field])}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* New presets (in job but not in master) */}
      {newPresets.length > 0 && (
        <div className="preset-diff-block">
          <div className="preset-diff-header" style={{ background: 'rgba(167,139,250,0.06)' }}>
            <span style={{ width: 20 }} />
            <Plus size={13} style={{ color: '#a78bfa', flexShrink: 0 }} />
            <span className="preset-diff-name" style={{ color: '#a78bfa' }}>New Presets — not in master</span>
            <span className="text-xs text-sub">{newPresets.length} preset{newPresets.length !== 1 ? 's' : ''}</span>
          </div>
          {newPresets.map(preset => (
            <label key={preset.guid} className={`diff-row ${addedPresets.has(preset.guid) ? 'selected' : ''}`}>
              <input
                type="checkbox"
                className="diff-checkbox"
                checked={addedPresets.has(preset.guid)}
                onChange={() => onToggleAddedPreset(preset.guid)}
              />
              <span className="diff-field-label">{preset.name || 'Unnamed'}</span>
              <span className="diff-val diff-val-master" style={{ fontStyle: 'italic' }}>— not in master —</span>
              <span className="diff-arrow">+</span>
              <span className="diff-val diff-val-job" style={{ color: '#a78bfa' }}>Add to master</span>
            </label>
          ))}
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
  const hasPresets = (importedTool.presets?.length > 0) || (masterTool.presets?.length > 0);

  const presetMatch = useMemo(
    () => matchPresets(importedTool.presets, masterTool.presets),
    [importedTool.presets, masterTool.presets]
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

  // Preset field selections: Map<masterPresetGuid, Set<fieldName>>
  const [presetFieldSelections, setPresetFieldSelections] = useState(() => {
    const m = new Map();
    for (const { master, incoming } of presetMatch.matched) {
      const changed = PRESET_DIFF_FIELDS.filter(f => !valuesEqual(incoming[f], master[f]));
      m.set(master.guid, new Set(changed)); // all changed fields selected by default
    }
    return m;
  });

  // New presets selected for addition — all selected by default
  const [addedPresets, setAddedPresets] = useState(
    () => new Set(presetMatch.newPresets.map(p => p.guid))
  );

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

  const togglePresetField = (masterGuid, field) => {
    setPresetFieldSelections(prev => {
      const next = new Map(prev);
      const fields = new Set(next.get(masterGuid) || []);
      if (fields.has(field)) fields.delete(field); else fields.add(field);
      next.set(masterGuid, fields);
      return next;
    });
  };

  const togglePresetAllFields = (masterGuid, changedFields) => {
    setPresetFieldSelections(prev => {
      const next = new Map(prev);
      const current = next.get(masterGuid) || new Set();
      const allOn = changedFields.every(f => current.has(f));
      const newSet = new Set(current);
      if (allOn) changedFields.forEach(f => newSet.delete(f));
      else changedFields.forEach(f => newSet.add(f));
      next.set(masterGuid, newSet);
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

  const hasAnyChange = Object.values(diffs).some(arr => arr.length > 0)
    || presetMatch.matched.some(({ master, incoming }) =>
        PRESET_DIFF_FIELDS.some(f => !valuesEqual(incoming[f], master[f])))
    || presetMatch.newPresets.length > 0;

  const presetFieldChangeCount = [...presetFieldSelections.values()].reduce((s, set) => s + set.size, 0);
  const totalSelected = selected.size + presetFieldChangeCount + addedPresets.size;

  const handleConfirm = () => {
    // Build presetSelections with full data needed by CommitStep / mergeTool
    const presetSelections = new Map();
    for (const { master, incoming } of presetMatch.matched) {
      const fields = presetFieldSelections.get(master.guid) || new Set();
      if (fields.size > 0) {
        presetSelections.set(master.guid, { name: master.name, incoming, selectedFields: fields });
      }
    }
    const presetsToAdd = presetMatch.newPresets.filter(p => addedPresets.has(p.guid));
    onConfirm({ selectedFields: selected, presetSelections, presetsToAdd });
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
            {totalFlatChanged > 0 && hasPresets && ', '}
            {hasPresets && `${presetMatch.matched.length} preset${presetMatch.matched.length !== 1 ? 's' : ''} matched`}
            {presetMatch.newPresets.length > 0 && `, ${presetMatch.newPresets.length} new`}
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
          presetFieldSelections={presetFieldSelections}
          addedPresets={addedPresets}
          onTogglePresetField={togglePresetField}
          onTogglePresetAllFields={togglePresetAllFields}
          onToggleAddedPreset={toggleAddedPreset}
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
