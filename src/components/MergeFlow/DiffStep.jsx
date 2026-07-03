import { useState, useMemo } from 'react';
import { ArrowLeft, Tag, Ruler, Gauge, Settings2, StickyNote, AlertTriangle, RefreshCw, Plus, CheckCircle, Wrench } from 'lucide-react';
import { generateId, generateAssemblyId } from '../../schema/toolSchema.js';
import { fieldLabel } from '../../schema/fieldRegistry.js';
import { composePresetName, parsePresetName, presetMatchesAssembly, materialNameCode, presetMaterialColor, HOLE_MAKING_TYPES } from '../../utils/presetNaming.js';
import { lengthEps, unitAbbr } from '../../utils/units.js';
import { useApp } from '../../context/AppContext.jsx';
import InfoTip from '../InfoTip.jsx';

const DIFF_SECTIONS = [
  {
    title: 'Identity',
    key: 'identity',
    icon: Tag,
    fields: ['description', 'vendor', 'tool_id'],
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
      'material', 'coating', 'tsc_capable', 'custom_grind', 'helix_angle', 'flute_type',
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

export const PRESET_FIELD_LABELS = {
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

// ── Significance thresholds ───────────────────────────────────────────────────
// Differences smaller than these are machining noise, not knowledge: 10 RPM
// changes nothing, but 0.0001" of chip load can. A preset value counts as
// "changed" only when |job − master| > max(rel × magnitude, abs). Sub-threshold
// differences are treated as identical (counted, shown as "minor differences
// ignored"). abs floors are in inch units; fields marked `len` scale ×25.4 for
// a millimeters tool.
const PRESET_SIGNIFICANCE = {
  n:              { rel: 0.01, abs: 15 },                   // RPM
  n_ramp:         { rel: 0.01, abs: 15 },
  v_c:            { rel: 0.01, abs: 1 },                    // surface speed
  v_f:            { rel: 0.02, abs: 0.1,     len: true },   // feeds
  v_f_plunge:     { rel: 0.02, abs: 0.1,     len: true },
  v_f_ramp:       { rel: 0.02, abs: 0.1,     len: true },
  v_f_leadIn:     { rel: 0.05, abs: 0.1,     len: true },   // followers of v_f — looser
  v_f_leadOut:    { rel: 0.05, abs: 0.1,     len: true },
  v_f_transition: { rel: 0.05, abs: 0.1,     len: true },
  f_z:            { rel: 0.02, abs: 0.00005, len: true },   // chip load — 0.0001" is real
  f_n:            { rel: 0.02, abs: 0.00005, len: true },
  'ramp-angle':   { rel: 0,    abs: 0.25 },
  stepdown:       { rel: 0.10, abs: 0.005,   len: true },   // DOC reference value — coarse
  stepover:       { rel: 0.02, abs: 0.0005,  len: true },   // WOC — small diffs matter
};

function presetTolerance(field, a, b, unit) {
  const sig = PRESET_SIGNIFICANCE[field];
  if (!sig) return 0.0001;
  const mag = Math.max(Math.abs(Number(a)), Math.abs(Number(b)));
  const scale = (sig.len && unit === 'millimeters') ? 25.4 : 1;
  return Math.max(sig.rel * mag, sig.abs * scale);
}

function valuesEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const isEmpty = v => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
  if (isEmpty(a) && isEmpty(b)) return true;
  const na = Number(a), nb = Number(b);
  // Numbers that round to the same 4-decimal display are equal — formatValue
  // shows 4dp, so anything closer would render as "0.5 → 0.5" (float round-trip
  // noise from Fusion), which is pure confusion in a diff row.
  if (!isNaN(na) && !isNaN(nb) && a !== '' && b !== '') return Math.abs(na - nb) < 5e-5;
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
      const changedFields = [];
      let trivial = 0;   // real-but-insignificant numeric diffs (below threshold, above float dust)
      for (const f of PRESET_DIFF_FIELDS) {
        if (NUMERIC_PRESET_FIELDS.has(f)) {
          const na = Number(incoming[f]), nb = Number(master[f]);
          if (!isNaN(na) && !isNaN(nb)) {
            const diff = Math.abs(na - nb);
            if (diff > presetTolerance(f, na, nb, unit)) changedFields.push(f);
            else if (diff > 5e-6) trivial++;
            continue;
          }
        }
        if (!valuesEqual(incoming[f], master[f])) changedFields.push(f);
      }
      if (changedFields.length === 0) {
        unchanged.push({ incoming, master, trivial });
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
  addedPresets, conflictResolutions, blockedResolutions,
  onToggleAddedPreset, onSetConflictResolution, onSetBlockedResolution,
  masterAssemblies, unit,
  assemblyAction, onSetAssemblyAction,
  linkTargetId, onSetLinkTargetId,
}) {
  const { materials } = useApp();
  const { unchanged, blocked, conflicts, newPresets, masterOnly } = presetMatch;

  const selectedNewCount = newPresets.filter(p => addedPresets.has(p.guid)).length;
  const conflictCreateCount = [...conflictResolutions.values()].filter(v => v === 'create').length;
  const willAddPresets = selectedNewCount + conflictCreateCount > 0;
  const showAssemblyPrompt = (incomingOoh != null && incomingOoh > 0) && willAddPresets;

  const totalChanged = blocked.length + conflicts.length;
  const totalUnchanged = unchanged.length + masterOnly.length;
  const minorIgnoredCount = unchanged.filter(u => u.trivial > 0).length;

  const summaryParts = [];
  if (newPresets.length > 0) summaryParts.push(`${newPresets.length} new`);
  if (totalChanged > 0) summaryParts.push(`${totalChanged} changed`);
  if (totalUnchanged > 0) summaryParts.push(`${totalUnchanged} matched`);

  return (
    <div className="diff-section">
      <div className="diff-section-header">
        <span style={{ width: 20 }} />
        <Gauge size={14} className="panel-header-icon" />
        <span className="panel-header-title">Speeds &amp; Feeds Presets</span>
        <InfoTip
          alignRight
          text="Presets are speed/feed settings for each machining operation. Job values proven on the SAME setup (holder + stick-out) can update master directly; values from a DIFFERENT setup are saved as a new preset variant. Differences too small to matter at the machine (a few RPM, float noise) are ignored automatically."
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
                <span className="preset-tag" style={{ '--badge-color': presetMaterialColor(preset.material?.query, materials) || undefined }}>{preset.name || 'Unnamed'}</span>
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
              {incomingOoh != null ? <> · OOH <strong>{incomingOoh.toFixed(3)} {unitAbbr(unit)}</strong></> : ''}
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
          <InfoTip text="These presets exist in both master and this job with the same values (or differences too small to matter at the machine — a few RPM, float rounding). No action needed." />
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
            {minorIgnoredCount > 0 && (
              <span style={{ display: 'block', marginTop: 4, fontSize: 11, color: 'var(--text-sub)' }}>
                {minorIgnoredCount} of these had only insignificant differences (ignored)
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Sub-section 3: Existing — Changed ── */}
      <div className="preset-subsection">
        <div className="preset-subsection-header">
          <AlertTriangle size={12} style={{ color: totalChanged > 0 ? 'var(--amber)' : 'var(--text-sub)' }} />
          <span style={{ color: totalChanged > 0 ? 'var(--amber)' : undefined }}>Existing — Changed</span>
          <InfoTip text="Same preset name, different values from this job. If the job ran the SAME setup as master (or carried no setup info), you can update master with the proven values, or keep master's. If it ran a DIFFERENT holder/stick-out, the values are only comparable as a new preset variant." />
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
                      (at OOH {incomingOoh.toFixed(3)} {unitAbbr(unit)})
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

        {/* Same setup, different values — the core capture case: the job proved
            better numbers on the exact setup master already knows. User chooses
            update (default keep, conservative). */}
        {blocked.map(({ master, incoming, changedFields }) => {
          const resolution = blockedResolutions.get(master.guid) || 'keep';
          return (
            <div key={master.guid} style={{ borderTop: '1px solid var(--border)' }}>
              <div className="preset-diff-header" style={{ background: 'rgba(96,165,250,0.06)' }}>
                <RefreshCw size={13} style={{ color: 'var(--blue)', flexShrink: 0, marginLeft: 14 }} />
                <span className="preset-diff-name" style={{ color: 'var(--blue)', marginLeft: 6 }}>
                  {master.name || 'Unnamed'}
                </span>
                <span className="text-xs text-sub" style={{ marginLeft: 'auto', marginRight: 14 }}>
                  Same setup · {changedFields.length} value{changedFields.length !== 1 ? 's' : ''} differ
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
                    name={`blocked-${master.guid}`}
                    checked={resolution === 'update'}
                    onChange={() => onSetBlockedResolution(master.guid, 'update')}
                  />
                  Update master with job values
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name={`blocked-${master.guid}`}
                    checked={resolution === 'keep'}
                    onChange={() => onSetBlockedResolution(master.guid, 'keep')}
                  />
                  Keep master values
                </label>
              </div>
            </div>
          );
        })}

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
  const { holders, materials } = useApp();

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

  // Same-setup presets with different values — 'keep' (default) or 'update'.
  const [blockedResolutions, setBlockedResolutions] = useState(() => {
    const m = new Map();
    for (const { master } of presetMatch.blocked) m.set(master.guid, 'keep');
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

  const setBlockedResolution = (masterGuid, resolution) => {
    setBlockedResolutions(prev => new Map(prev).set(masterGuid, resolution));
  };

  const conflictCreates = [...conflictResolutions.values()].filter(v => v === 'create').length;
  const blockedUpdates = [...blockedResolutions.values()].filter(v => v === 'update').length;
  const totalSelected = selected.size + addedPresets.size + conflictCreates + blockedUpdates;

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
            materialQuery: materialNameCode(incoming.material?.query, materials),
            ooh: incomingOoh,
            holderDescription: incomingHolderDesc,
            opType,
          }) || incoming.name,
        };
      });

    // GUID collision guard: a preset RENAMED in the job file doesn't name-match,
    // so it lands in newPresets — but its guid is the MASTER preset's guid (it
    // was copied from master). Appending it as-is would put two presets with the
    // same guid in the master array, corrupting preset_meta (keyed by guid) and
    // making assembly linked_preset_guids ambiguous. Mint a fresh guid for any
    // new preset whose guid already exists in master — done HERE, before the
    // assemblyUpdate below captures the guids, so links stay consistent.
    const masterGuids = new Set((masterTool.presets || []).map(p => p.guid));
    const newPresetsToAdd = presetMatch.newPresets
      .filter(p => addedPresets.has(p.guid))
      .map(p => ({
        ...p,
        ...(masterGuids.has(p.guid) ? { guid: generateId() } : {}),
        operation_type: p.operation_type ?? parsePresetName(p.name)?.opType ?? null,
      }));

    const presetsToAdd = [...newPresetsToAdd, ...conflictPresetsToAdd];

    // Same-setup presets the user chose to update in place — mergeTool patches
    // the selected fields onto the master preset (guid unchanged, so assembly
    // links survive) and records it in merge_history.presets_changed.
    const presetChanges = presetMatch.blocked
      .filter(({ master }) => blockedResolutions.get(master.guid) === 'update')
      .map(({ master, incoming, changedFields }) => ({
        masterPresetGuid: master.guid,
        incomingPreset: incoming,
        selectedFields: new Set(changedFields),
      }));

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

    onConfirm({ selectedFields: selected, presetChanges, presetsToAdd, assemblyUpdate });
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
  const presetChangedCount = presetMatch.blocked.length + presetMatch.conflicts.length;
  const presetSummaryParts = [];
  if (presetMatch.newPresets.length > 0) presetSummaryParts.push(`${presetMatch.newPresets.length} new`);
  if (presetChangedCount > 0) presetSummaryParts.push(`${presetChangedCount} changed`);
  if (presetMatch.unchanged.length > 0) presetSummaryParts.push(`${presetMatch.unchanged.length} matched`);

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
          blockedResolutions={blockedResolutions}
          onToggleAddedPreset={toggleAddedPreset}
          onSetConflictResolution={setConflictResolution}
          onSetBlockedResolution={setBlockedResolution}
          masterAssemblies={masterTool.assemblies}
          unit={masterTool.unit}
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
