import { useState, useMemo } from 'react';
import { ArrowLeft, Tag, Ruler, Gauge, Settings2, StickyNote, AlertTriangle } from 'lucide-react';
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
    title: 'Speeds & Feeds',
    key: 'speeds',
    icon: Gauge,
    advisory: true,
    fields: [
      'spindle_speed', 'cutting_feedrate', 'feed_per_tooth', 'feed_per_rev',
      'plunge_feedrate', 'ramp_feedrate', 'lead_in_feedrate', 'lead_out_feedrate',
      'cutting_speed', 'depth_of_cut', 'width_of_cut',
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

// Fields to never show in the diff (structural / managed internally)
const EXCLUDED = new Set([
  'id', 'tool_type', 'created_at', 'updated_at', 'updated_by', 'revision_notes',
  'merge_history', '_fusionRaw', 'location',
]);

function formatValue(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const n = Number(v);
  if (!isNaN(n) && v !== '') {
    return Math.round(n * 10000) / 10000;
  }
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

export default function DiffStep({ importedTool, masterTool, onConfirm, onBack }) {
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

  const totalChanged = Object.values(diffs).reduce((s, arr) => s + arr.length, 0);

  const [selected, setSelected] = useState(() => {
    const s = new Set();
    for (const fields of Object.values(diffs)) fields.forEach(f => s.add(f));
    return s;
  });

  const toggle = (field) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(field)) next.delete(field); else next.add(field);
    return next;
  });

  const toggleSection = (sectionKey, fields) => {
    const sectionFields = diffs[sectionKey] || [];
    const allOn = sectionFields.every(f => selected.has(f));
    setSelected(prev => {
      const next = new Set(prev);
      if (allOn) sectionFields.forEach(f => next.delete(f));
      else sectionFields.forEach(f => next.add(f));
      return next;
    });
  };

  if (totalChanged === 0) {
    return (
      <div>
        <h3 className="import-section-title">No Differences Found</h3>
        <p className="text-sub text-sm mb-20">
          The imported tool's values match the master library. There is nothing to merge.
        </p>
        <button className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft size={14} /> Back</button>
      </div>
    );
  }

  return (
    <div>
      <div className="diff-header mb-16">
        <div>
          <h3 className="import-section-title" style={{ marginBottom: 4 }}>Review Changes</h3>
          <p className="text-sub text-sm">
            {totalChanged} field{totalChanged !== 1 ? 's' : ''} differ. Select which ones to apply to master.
          </p>
        </div>
        <div className="diff-col-labels">
          <span>Master</span>
          <span>Job (new)</span>
        </div>
      </div>

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
                  onChange={() => toggleSection(section.key, changed)}
                />
              </label>
              <Icon size={14} className="panel-header-icon" />
              <span className="panel-header-title">{section.title}</span>
              <span className="diff-section-count">{changed.length} change{changed.length !== 1 ? 's' : ''}</span>
            </div>
            {section.advisory && (
              <div className="diff-advisory">
                <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                Speeds & feeds are job-specific. Verify these values are appropriate for all uses of this tool before committing.
              </div>
            )}
            <div className="diff-rows">
              {changed.map(field => (
                <label key={field} className={`diff-row ${selected.has(field) ? 'selected' : ''}`}>
                  <input
                    type="checkbox"
                    className="diff-checkbox"
                    checked={selected.has(field)}
                    onChange={() => toggle(field)}
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

      {/* Sticky summary bar */}
      <div className="diff-summary-bar">
        <div className="flex items-center gap-8">
          <button className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft size={14} /> Back</button>
          <span className="text-sub text-sm">
            {selected.size} of {totalChanged} changes selected
          </span>
        </div>
        <button
          className="btn btn-primary"
          disabled={selected.size === 0}
          onClick={() => onConfirm(selected)}
        >
          Continue to Commit →
        </button>
      </div>
    </div>
  );
}
