import React, { useState, useEffect, useRef } from 'react';
import { Plus, X, Check, GripVertical, Trash2 } from 'lucide-react';
import { generateId } from '../schema/toolSchema.js';

const MATERIALS = [
  'Aluminum', 'Stainless Steel', 'Alloy Steel', 'Mild Steel',
  'Bronze', 'Brass', 'Titanium', 'Cast Iron', 'Plastic', 'Other',
];

const MATERIAL_QUERY_MAP = {
  Aluminum: 'AL', 'Stainless Steel': 'SS', 'Alloy Steel': 'STEEL',
  'Mild Steel': 'MILD', Bronze: 'BRONZE', Brass: 'BRASS',
  Titanium: 'TI', 'Cast Iron': 'CI', Plastic: 'PLASTIC', Other: '',
};

const COOLANT_OPTS = ['flood', 'mist', 'air', 'none'];

function r4(v) {
  if (v === null || v === undefined || v === '') return v;
  const n = Number(v);
  return isNaN(n) ? v : parseFloat(n.toFixed(4));
}

function matchMaterial(query) {
  if (!query) return 'Other';
  const q = query.toUpperCase();
  if (q === 'SS' || q.includes('STAINLESS')) return 'Stainless Steel';
  if (q === 'AL' || q.includes('ALUM')) return 'Aluminum';
  if (q === 'TI' || q.includes('TITAN')) return 'Titanium';
  if (q.includes('MILD')) return 'Mild Steel';
  if (q.includes('BRONZE')) return 'Bronze';
  if (q.includes('BRASS')) return 'Brass';
  if (q === 'CI' || q.includes('CAST') || (q.includes('IRON') && !q.includes('STEEL'))) return 'Cast Iron';
  if (q.includes('PLASTIC')) return 'Plastic';
  if (q.includes('STEEL') || q.includes('ALLOY')) return 'Alloy Steel';
  return 'Other';
}

function blankPreset() {
  return {
    guid: generateId(),
    name: 'New Preset',
    material: { category: 'all', query: '', 'use-hardness': false },
    n: 0, v_c: 0, n_ramp: 0,
    v_f: 0, f_z: 0, v_f_leadIn: 0, v_f_leadOut: 0,
    v_f_transition: 0, v_f_ramp: 0, 'ramp-angle': 2,
    v_f_plunge: 0, f_n: 0, 'v_f_retract': 0,
    'tool-coolant': 'flood', 'use-stepdown': false, 'use-stepover': false,
    'ramp-spindle-speed': 0,
  };
}

export default function PresetPanel({ tool, onSave, isSaving }) {
  const isMetric = tool.unit === 'millimeters';
  const lenUnit = isMetric ? 'mm' : 'in';
  const feedUnit = isMetric ? 'mm/min' : 'in/min';
  const speedUnit = isMetric ? 'm/min' : 'SFM';

  // Prefer managed presets array; fall back to raw Fusion JSON for tools loaded
  // before this feature was deployed.
  const initialPresets = () =>
    tool.presets?.length > 0 ? tool.presets
      : (tool._fusionRaw?.['start-values']?.presets || []);

  const [presets, setPresets] = useState(initialPresets);
  const [editingId, setEditingId] = useState(null);
  const [materialFilter, setMaterialFilter] = useState('All');
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [addPromptOpen, setAddPromptOpen] = useState(false);
  const [copyFromId, setCopyFromId] = useState('');
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const dragSrcIdx = useRef(null);

  // Re-sync local state when the global tool updates (e.g. after a save).
  // Only run when no edit is in progress to avoid clobbering unsaved drafts.
  useEffect(() => {
    if (!editingId) setPresets(initialPresets());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool.presets, tool._fusionRaw]);

  // ── Material counts for filter tabs ───────────────────────────────────────
  const materialCounts = {};
  presets.forEach(p => {
    const m = matchMaterial(p.material?.query);
    materialCounts[m] = (materialCounts[m] || 0) + 1;
  });
  const tabs = ['All', ...Object.keys(materialCounts).sort()];

  const visible = materialFilter === 'All'
    ? presets
    : presets.filter(p => matchMaterial(p.material?.query) === materialFilter);

  // ── Drag-to-reorder (only when showing All so indices map to presets[]) ──
  const handleDragStart = (e, idx) => {
    dragSrcIdx.current = idx;
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e, idx) => {
    e.preventDefault();
    setDragOverIdx(idx);
  };
  const handleDrop = (e, idx) => {
    e.preventDefault();
    const src = dragSrcIdx.current;
    if (src === null || src === idx) { setDragOverIdx(null); return; }
    const next = [...presets];
    const [moved] = next.splice(src, 1);
    next.splice(idx, 0, moved);
    dragSrcIdx.current = null;
    setDragOverIdx(null);
    setPresets(next);
    onSave(next);
  };
  const handleDragEnd = () => { dragSrcIdx.current = null; setDragOverIdx(null); };

  // ── Preset CRUD ────────────────────────────────────────────────────────────
  const handlePresetSave = (updated) => {
    const next = presets.map(p => p.guid === updated.guid ? updated : p);
    setPresets(next);
    setEditingId(null);
    onSave(next);
  };

  const handleDelete = () => {
    const next = presets.filter(p => p.guid !== deleteConfirmId);
    setPresets(next);
    setDeleteConfirmId(null);
    onSave(next);
  };

  const handleAddClick = () => {
    if (editingId) {
      // Duplicate the preset currently open in edit mode
      const src = presets.find(p => p.guid === editingId) || blankPreset();
      const np = { ...src, guid: generateId(), name: `${src.name || 'Preset'} (copy)` };
      const next = [...presets, np];
      setPresets(next);
      setEditingId(np.guid);
    } else {
      setAddPromptOpen(true);
    }
  };

  const handleConfirmAdd = () => {
    const src = copyFromId ? presets.find(p => p.guid === copyFromId) : null;
    const np = src
      ? { ...src, guid: generateId(), name: `${src.name || 'Preset'} (copy)` }
      : blankPreset();
    const next = [...presets, np];
    setPresets(next);
    setEditingId(np.guid);
    setAddPromptOpen(false);
    setCopyFromId('');
  };

  return (
    <div className="preset-panel">
      {/* Header */}
      <div className="preset-panel-header">
        <span className="preset-panel-title">Speeds &amp; Feeds</span>
        <span className="text-xs text-sub">
          {presets.length} preset{presets.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Material filter tabs */}
      {presets.length > 0 && (
        <div className="preset-tabs">
          {tabs.map(tab => (
            <button
              key={tab}
              className={`chip ${materialFilter === tab ? 'active' : ''}`}
              onClick={() => setMaterialFilter(tab)}
            >
              {tab}{tab !== 'All' && materialCounts[tab] ? ` (${materialCounts[tab]})` : ''}
            </button>
          ))}
        </div>
      )}

      {/* Inline delete confirmation */}
      {deleteConfirmId && (
        <div className="preset-inline-prompt">
          <span className="text-sm">
            Delete &quot;{presets.find(p => p.guid === deleteConfirmId)?.name}&quot;?
          </span>
          <button className="btn btn-danger btn-sm" onClick={handleDelete}>Delete</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setDeleteConfirmId(null)}>Cancel</button>
        </div>
      )}

      {/* Inline add prompt (shown when no preset is in edit mode) */}
      {addPromptOpen && (
        <div className="preset-inline-prompt">
          <span className="text-sm text-sub">Copy from:</span>
          <select
            className="field-input"
            value={copyFromId}
            onChange={e => setCopyFromId(e.target.value)}
            style={{ minWidth: 140 }}
          >
            <option value="">Start blank</option>
            {presets.map(p => (
              <option key={p.guid} value={p.guid}>{p.name || 'Unnamed'}</option>
            ))}
          </select>
          <button className="btn btn-primary btn-sm" onClick={handleConfirmAdd}>Add</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setAddPromptOpen(false)}>
            Cancel
          </button>
        </div>
      )}

      {/* Horizontal scroll row */}
      <div className="preset-scroll">
        <div className="preset-row">
          {visible.map((preset, visIdx) => {
            const globalIdx = presets.indexOf(preset);
            const prevVisible = visIdx > 0 ? visible[visIdx - 1] : null;
            const showDivider =
              materialFilter === 'All' && prevVisible &&
              matchMaterial(prevVisible.material?.query) !== matchMaterial(preset.material?.query);

            return (
              <React.Fragment key={preset.guid}>
                {showDivider && (
                  <div className="preset-group-sep">
                    <span>{matchMaterial(preset.material?.query)}</span>
                  </div>
                )}
                {editingId === preset.guid ? (
                  <EditCard
                    preset={preset}
                    lenUnit={lenUnit}
                    feedUnit={feedUnit}
                    speedUnit={speedUnit}
                    onSave={handlePresetSave}
                    onCancel={() => setEditingId(null)}
                    isSaving={isSaving}
                  />
                ) : (
                  <CollapsedCard
                    preset={preset}
                    lenUnit={lenUnit}
                    feedUnit={feedUnit}
                    speedUnit={speedUnit}
                    isDragOver={dragOverIdx === globalIdx}
                    dragEnabled={materialFilter === 'All'}
                    onEdit={() => setEditingId(preset.guid)}
                    onDelete={() => setDeleteConfirmId(preset.guid)}
                    onDragStart={e => handleDragStart(e, globalIdx)}
                    onDragOver={e => handleDragOver(e, globalIdx)}
                    onDrop={e => handleDrop(e, globalIdx)}
                    onDragEnd={handleDragEnd}
                  />
                )}
              </React.Fragment>
            );
          })}

          {visible.length === 0 && materialFilter !== 'All' && (
            <div className="preset-empty">No presets for {materialFilter}</div>
          )}

          <button className="preset-add-card" onClick={handleAddClick} title="Add preset">
            <Plus size={22} />
            <span>Add Preset</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Collapsed card ───────────────────────────────────────────────────────────
function CollapsedCard({
  preset, lenUnit, feedUnit, speedUnit,
  isDragOver, dragEnabled,
  onEdit, onDelete,
  onDragStart, onDragOver, onDrop, onDragEnd,
}) {
  const mat = matchMaterial(preset.material?.query);
  const coolantRaw = preset['tool-coolant'];
  const coolantLabel = coolantRaw
    ? coolantRaw.charAt(0).toUpperCase() + coolantRaw.slice(1)
    : '—';
  const sfcLabel = lenUnit === 'mm' ? speedUnit : 'ft/min';

  return (
    <div
      className={`preset-card${isDragOver ? ' preset-card--drop' : ''}`}
      draggable={dragEnabled}
      onDragStart={dragEnabled ? onDragStart : undefined}
      onDragOver={dragEnabled ? onDragOver : undefined}
      onDrop={dragEnabled ? onDrop : undefined}
      onDragEnd={dragEnabled ? onDragEnd : undefined}
    >
      {dragEnabled && (
        <div className="preset-card-grip" title="Drag to reorder">
          <GripVertical size={13} />
        </div>
      )}
      <div className="preset-card-body">
        <div className="preset-card-name" title={preset.name}>{preset.name || 'Unnamed'}</div>
        <div className="preset-card-mat">{mat}</div>
        <div className="preset-card-stats">
          <StatRow label="Spindle" value={r4(preset.n)} unit="rpm" />
          <StatRow label="Surface" value={r4(preset.v_c)} unit={sfcLabel} />
          <StatRow label="Cutting" value={r4(preset.v_f)} unit={feedUnit} />
          <StatRow label="Feed/Tooth" value={r4(preset.f_z)} unit={lenUnit} />
          <StatRow label="Plunge" value={r4(preset.v_f_plunge)} unit={feedUnit} />
          <StatRow label="Coolant" value={coolantLabel} />
        </div>
      </div>
      <div className="preset-card-footer">
        <button className="btn btn-secondary btn-sm" onClick={onEdit}>Edit</button>
        <button className="btn btn-ghost btn-sm preset-card-del" onClick={onDelete}>
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

function StatRow({ label, value, unit }) {
  const empty = value === null || value === undefined || value === '' || value === 0;
  return (
    <div className="preset-stat-row">
      <span className="preset-stat-label">{label}</span>
      <span className="preset-stat-value">
        {empty ? '—' : `${value}${unit ? ' ' + unit : ''}`}
      </span>
    </div>
  );
}

// ── Edit card ────────────────────────────────────────────────────────────────
function EditCard({ preset, lenUnit, feedUnit, speedUnit, onSave, onCancel, isSaving }) {
  const [draft, setDraft] = useState({ ...preset });
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const setMat = (k, v) => setDraft(d => ({ ...d, material: { ...(d.material || {}), [k]: v } }));

  const selectedMat = matchMaterial(draft.material?.query);

  return (
    <div className="preset-card preset-card--edit">
      {/* Header: name input + Save / Cancel */}
      <div className="preset-edit-header">
        <input
          className="field-input preset-name-input"
          value={draft.name || ''}
          onChange={e => set('name', e.target.value)}
          placeholder="Preset name"
        />
        <button
          className="btn btn-primary btn-sm"
          onClick={() => onSave(draft)}
          disabled={isSaving}
        >
          <Check size={13} /> Save
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={isSaving}>
          <X size={13} />
        </button>
      </div>

      {/* Material */}
      <div className="preset-edit-section">
        <div className="preset-edit-section-label">MATERIAL</div>
        <div className="preset-edit-grid">
          <FGroup label="Material">
            <select
              className="field-input"
              value={selectedMat}
              onChange={e => setMat('query', MATERIAL_QUERY_MAP[e.target.value] ?? '')}
            >
              {MATERIALS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </FGroup>
          <FGroup label="Filter by type">
            <select
              className="field-input"
              value={draft.material?.category || 'all'}
              onChange={e => setMat('category', e.target.value)}
            >
              {['all', 'milling', 'turning', 'drilling'].map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </FGroup>
        </div>
      </div>

      {/* Speed */}
      <div className="preset-edit-section">
        <div className="preset-edit-section-label">SPEED</div>
        <div className="preset-edit-grid">
          <NField label="Spindle speed" value={draft.n} unit="RPM" onChange={v => set('n', v)} />
          <NField label="Surface speed" value={draft.v_c} unit={speedUnit} onChange={v => set('v_c', v)} />
          <NField label="Ramp spindle speed" value={draft.n_ramp} unit="RPM" onChange={v => set('n_ramp', v)} />
        </div>
      </div>

      {/* Feedrates */}
      <div className="preset-edit-section">
        <div className="preset-edit-section-label">FEEDRATES</div>
        <div className="preset-edit-grid">
          <NField label="Cutting feedrate" value={draft.v_f} unit={feedUnit} onChange={v => set('v_f', v)} />
          <NField label="Feed per tooth" value={draft.f_z} unit={lenUnit} onChange={v => set('f_z', v)} />
          <NField label="Lead-in feedrate" value={draft.v_f_leadIn} unit={feedUnit} onChange={v => set('v_f_leadIn', v)} />
          <NField label="Lead-out feedrate" value={draft.v_f_leadOut} unit={feedUnit} onChange={v => set('v_f_leadOut', v)} />
          <NField label="Transition feedrate" value={draft.v_f_transition} unit={feedUnit} onChange={v => set('v_f_transition', v)} />
          <NField label="Ramp feedrate" value={draft.v_f_ramp} unit={feedUnit} onChange={v => set('v_f_ramp', v)} />
          <NField label="Ramp angle" value={draft['ramp-angle']} unit="°" onChange={v => set('ramp-angle', v)} />
        </div>
      </div>

      {/* Vertical Feedrates */}
      <div className="preset-edit-section">
        <div className="preset-edit-section-label">VERTICAL FEEDRATES</div>
        <div className="preset-edit-grid">
          <NField label="Plunge feedrate" value={draft.v_f_plunge} unit={feedUnit} onChange={v => set('v_f_plunge', v)} />
          <NField label="Plunge feed per rev" value={draft.f_n} unit={`${lenUnit}/rev`} onChange={v => set('f_n', v)} />
        </div>
      </div>

      {/* Passes & Linking */}
      <div className="preset-edit-section">
        <div className="preset-edit-section-label">PASSES &amp; LINKING</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label className="preset-check-label">
            <input
              type="checkbox"
              checked={!!draft['use-stepdown']}
              onChange={e => set('use-stepdown', e.target.checked)}
            />
            Use stepdown
          </label>
          <label className="preset-check-label">
            <input
              type="checkbox"
              checked={!!draft['use-stepover']}
              onChange={e => set('use-stepover', e.target.checked)}
            />
            Use stepover
          </label>
        </div>
      </div>

      {/* Coolant */}
      <div className="preset-edit-section">
        <div className="preset-edit-section-label">COOLANT</div>
        <select
          className="field-input"
          value={draft['tool-coolant'] || 'flood'}
          onChange={e => set('tool-coolant', e.target.value)}
        >
          {COOLANT_OPTS.map(c => (
            <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ── Small helpers ────────────────────────────────────────────────────────────
function FGroup({ label, children }) {
  return (
    <div className="field-group">
      <label className="field-label">{label}</label>
      {children}
    </div>
  );
}

function NField({ label, value, unit, onChange }) {
  const [focused, setFocused] = useState(false);
  const displayed = focused ? (value ?? '') : (r4(value) ?? '');
  return (
    <div className="field-group">
      <label className="field-label">{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <input
          className="field-input"
          type="number"
          step="0.0001"
          style={{ flex: 1 }}
          value={displayed}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={e => onChange(e.target.value === '' ? null : parseFloat(e.target.value))}
          placeholder="0"
        />
        {unit && <span className="text-xs text-sub" style={{ whiteSpace: 'nowrap' }}>{unit}</span>}
      </div>
    </div>
  );
}
