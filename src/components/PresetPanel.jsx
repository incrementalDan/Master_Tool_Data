import React, { useState, useEffect, useRef } from 'react';
import { Plus, X, Check, GripVertical, Trash2 } from 'lucide-react';
import { generateId, COOLANT_OPTS } from '../schema/toolSchema.js';
import { useApp } from '../context/AppContext.jsx';
import { holderColor } from './AssemblyCard.jsx';
import {
  composePresetName, parsePresetName, presetMatchesAssembly, OP_TYPES, materialCategory,
} from '../utils/presetNaming.js';
import { holderShortName } from '../utils/holderNaming.js';
import {
  rpmToSFM, sfmToRPM,
  fptToIPM, ipmToFPT,
  iprToIPM, ipmToIPR,
  FORMULAS, FIELD_PRECISION, roundForField,
} from '../utils/speedsAndFeedsCalc.js';

const MATERIALS = [
  'Aluminum', 'Stainless Steel', 'Alloy Steel', 'Mild Steel',
  'Bronze', 'Brass', 'Titanium', 'Cast Iron', 'Plastic', 'Other',
];

const MATERIAL_QUERY_MAP = {
  Aluminum: 'AL', 'Stainless Steel': 'SS', 'Alloy Steel': 'STEEL',
  'Mild Steel': 'MILD', Bronze: 'BRONZE', Brass: 'BRASS',
  Titanium: 'TI', 'Cast Iron': 'CI', Plastic: 'PLASTIC', Other: '',
};

// Default formula states when opening any preset for editing.
// 'manual' = user owns this value; 'formula' = calculated from partner.
const DEFAULT_FX = {
  n:              'manual',
  v_c:            'formula',
  n_ramp:         'formula',
  v_f:            'formula',
  f_z:            'manual',
  v_f_plunge:     'formula',
  f_n:            'manual',
  v_f_leadIn:     'formula',
  v_f_leadOut:    'formula',
  v_f_transition: 'formula',
};

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
    stepdown: null, stepover: null,
    'ramp-spindle-speed': 'n',
  };
}

export default function PresetPanel({ tool, onSave, isSaving }) {
  const { holders } = useApp();
  const isMetric = tool.unit === 'millimeters';
  const lenUnit = isMetric ? 'mm' : 'in';
  const feedUnit = isMetric ? 'mm/min' : 'in/min';
  const speedUnit = isMetric ? 'm/min' : 'SFM';

  const diameter = tool.diameter;
  const numberOfFlutes = tool.number_of_flutes;

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

      {/* Inline add prompt */}
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
                    diameter={diameter}
                    fluteLength={tool.flute_length || 0}
                    numberOfFlutes={numberOfFlutes}
                    assemblies={tool.assemblies || []}
                    holders={holders}
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
                    linkedAssemblies={(tool.assemblies || []).filter(a =>
                      presetMatchesAssembly(preset, a, tool.unit)
                    )}
                    holders={holders}
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
  linkedAssemblies, holders,
  onEdit, onDelete,
  onDragStart, onDragOver, onDrop, onDragEnd,
}) {
  const mat = matchMaterial(preset.material?.query);
  const coolantRaw = preset['tool-coolant'];
  const coolantLabel = coolantRaw
    ? (COOLANT_OPTS.find(([v]) => v === coolantRaw)?.[1] ?? (coolantRaw.charAt(0).toUpperCase() + coolantRaw.slice(1)))
    : '—';
  const sfcLabel = lenUnit === 'mm' ? speedUnit : 'ft/min';

  const singleAssembly = linkedAssemblies?.length === 1 ? linkedAssemblies[0] : null;
  const assemblyHolderDesc = singleAssembly
    ? (singleAssembly.holder_description || holders?.find(h => h.guid === singleAssembly.holder_guid)?.description || '')
    : null;
  const assemblyHolderColor = assemblyHolderDesc ? holderColor(assemblyHolderDesc) : null;

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
        <div className="preset-card-name">
          <span className="preset-tag" title={preset.name}>{preset.name || 'Unnamed'}</span>
        </div>
        <div className="preset-card-mat">{mat}</div>
        <div className="preset-card-stats">
          <StatRow label="Spindle" value={r4(preset.n)} unit="rpm" />
          <StatRow label="Surface" value={r4(preset.v_c)} unit={sfcLabel} />
          <StatRow label="Cutting" value={r4(preset.v_f)} unit={feedUnit} />
          <StatRow label="Feed/Tooth" value={r4(preset.f_z)} unit={lenUnit} />
          <StatRow label="Plunge" value={r4(preset.v_f_plunge)} unit={feedUnit} />
          <StatRow label="Coolant" value={coolantLabel} />
        </div>
        {linkedAssemblies?.length > 0 && (
          <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
            {singleAssembly ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                {assemblyHolderDesc && (
                  <span
                    className="holder-pill"
                    style={assemblyHolderColor ? { background: assemblyHolderColor.bg, borderColor: assemblyHolderColor.border, color: assemblyHolderColor.text } : {}}
                  >{assemblyHolderDesc}</span>
                )}
                <span className="text-xs text-sub">OOH: {singleAssembly.ooh != null ? `${singleAssembly.ooh.toFixed(3)} ${lenUnit}` : '—'}</span>
              </div>
            ) : (
              <span className="text-xs text-sub">{linkedAssemblies.length} assemblies</span>
            )}
          </div>
        )}
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

// Recomputes all formula-driven fields in a draft given current geometry.
// Safe to call on mount and whenever diameter / numberOfFlutes change.
function computeFormulaDraft(draft, fx, diameter, numberOfFlutes) {
  const d = { ...draft };
  const n = d.n ?? 0;

  if (fx.v_c    === 'formula') d.v_c    = roundForField('v_c',    rpmToSFM(n, diameter));
  if (fx.n_ramp === 'formula') d.n_ramp = roundForField('n_ramp', n);

  if (fx.v_f === 'formula')
    d.v_f = roundForField('v_f', fptToIPM(d.f_z ?? 0, n, numberOfFlutes));
  else if (fx.f_z === 'formula')
    d.f_z = roundForField('f_z', ipmToFPT(d.v_f ?? 0, n, numberOfFlutes));

  if (fx.v_f_plunge === 'formula')
    d.v_f_plunge = roundForField('v_f_plunge', iprToIPM(d.f_n ?? 0, n));
  else if (fx.f_n === 'formula')
    d.f_n = roundForField('f_n', ipmToIPR(d.v_f_plunge ?? 0, n));

  const vf = d.v_f ?? 0;
  if (fx.v_f_leadIn     === 'formula') d.v_f_leadIn     = roundForField('v_f_leadIn',     vf);
  if (fx.v_f_leadOut    === 'formula') d.v_f_leadOut    = roundForField('v_f_leadOut',    vf);
  if (fx.v_f_transition === 'formula') d.v_f_transition = roundForField('v_f_transition', vf);

  return d;
}

// ── Edit card ────────────────────────────────────────────────────────────────
function EditCard({
  preset, lenUnit, feedUnit, speedUnit,
  diameter, fluteLength, numberOfFlutes,
  assemblies = [], holders = [],
  onSave, onCancel, isSaving,
}) {
  const [fx, setFx] = useState(DEFAULT_FX);
  const [draft, setDraft] = useState(() => {
    const d = computeFormulaDraft({ ...preset }, DEFAULT_FX, diameter, numberOfFlutes);
    d.operation_type = preset.operation_type ?? parsePresetName(preset.name)?.opType ?? null;
    return d;
  });

  // Which assembly (holder + OOH) this preset is named for. Initialised by
  // matching the current name; user can switch it to retarget the preset.
  const [assemblyId, setAssemblyId] = useState(() =>
    assemblies.find(a => presetMatchesAssembly(preset, a, lenUnit))?.assembly_id || assemblies[0]?.assembly_id || ''
  );

  const holderDescOf = (a) =>
    a ? (a.holder_description || holders.find(h => h.guid === a.holder_guid)?.description || '') : '';

  // Compose the convention name from material + the selected assembly + op type.
  // Falls back to the current draft name when there's nothing to compose from.
  const composeName = (d, asmId, opType) => {
    const a = assemblies.find(x => x.assembly_id === asmId);
    if (!a || !opType) return d.name;
    return composePresetName({
      materialQuery: d.material?.query,
      ooh: a.ooh,
      holderShort: holderShortName(holderDescOf(a)),
      opType,
    });
  };

  // Recalculate formula fields whenever geometry changes (e.g. user edits
  // number of flutes or diameter in the tool form while a preset is open).
  const fxRef = useRef(fx);
  useEffect(() => { fxRef.current = fx; }, [fx]);
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    setDraft(d => computeFormulaDraft(d, fxRef.current, diameter, numberOfFlutes));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diameter, numberOfFlutes]);

  // Plain setter for non-formula fields (name, material, checkboxes, coolant,
  // and the independent feedrate fields that have no formula linkage).
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const setMat = (k, v) => setDraft(d => ({ ...d, material: { ...(d.material || {}), [k]: v } }));

  const selectedMat = matchMaterial(draft.material?.query);

  // ── Bidirectional calculation ──────────────────────────────────────────────
  // Called for every formula-linked field on each keystroke.
  // The typed field becomes 'manual'; its partner becomes 'formula' and is
  // immediately recomputed. When n/v_c change, the cutting and plunge feed
  // groups cascade too.
  const handleNumChange = (field, value) => {
    const newDraft = { ...draft, [field]: value };
    const newFx   = { ...fx,    [field]: 'manual' };

    // Effective spindle speed after this change (used for feed cascades).
    let n = draft.n ?? 0;

    // ── Speed group ──────────────────────────────────────────────────────────
    if (field === 'n') {
      n = value ?? 0;
      newDraft.v_c   = roundForField('v_c',   rpmToSFM(n, diameter));
      newFx.v_c      = 'formula';
      if (fx.n_ramp !== 'manual') {
        newDraft.n_ramp = roundForField('n_ramp', n);
        newFx.n_ramp    = 'formula';
      }
    } else if (field === 'v_c') {
      n = roundForField('n', sfmToRPM(value ?? 0, diameter));
      newDraft.n   = n;
      newFx.n      = 'formula';
      if (fx.n_ramp !== 'manual') {
        newDraft.n_ramp = n;
        newFx.n_ramp    = 'formula';
      }
    }
    // n_ramp typed directly: just goes manual, no cascade.

    // ── Cutting feed group ───────────────────────────────────────────────────
    if (field === 'f_z') {
      newDraft.v_f = roundForField('v_f', fptToIPM(value ?? 0, n, numberOfFlutes));
      newFx.v_f    = 'formula';
    } else if (field === 'v_f') {
      newDraft.f_z = roundForField('f_z', ipmToFPT(value ?? 0, n, numberOfFlutes));
      newFx.f_z    = 'formula';
    } else if (field === 'n' || field === 'v_c') {
      // n changed — cascade whichever side is manual
      if (fx.f_z === 'manual') {
        newDraft.v_f = roundForField('v_f', fptToIPM(draft.f_z ?? 0, n, numberOfFlutes));
        newFx.v_f    = 'formula';
      } else {
        newDraft.f_z = roundForField('f_z', ipmToFPT(draft.v_f ?? 0, n, numberOfFlutes));
        newFx.f_z    = 'formula';
      }
    }

    // ── Plunge feed group ────────────────────────────────────────────────────
    if (field === 'f_n') {
      newDraft.v_f_plunge = roundForField('v_f_plunge', iprToIPM(value ?? 0, n));
      newFx.v_f_plunge    = 'formula';
    } else if (field === 'v_f_plunge') {
      newDraft.f_n = roundForField('f_n', ipmToIPR(value ?? 0, n));
      newFx.f_n    = 'formula';
    } else if (field === 'n' || field === 'v_c') {
      if (fx.f_n === 'manual') {
        newDraft.v_f_plunge = roundForField('v_f_plunge', iprToIPM(draft.f_n ?? 0, n));
        newFx.v_f_plunge    = 'formula';
      } else {
        newDraft.f_n = roundForField('f_n', ipmToIPR(draft.v_f_plunge ?? 0, n));
        newFx.f_n    = 'formula';
      }
    }

    // ── Lead-in / lead-out / transition linkage ─────────────────────────────
    // One-directional: v_f drives them; they never drive v_f back.
    // When the user types directly into one (field === that key), newFx already
    // set it to 'manual' above, so the check below will skip it correctly.
    const vf = newDraft.v_f ?? draft.v_f ?? 0;
    if (newFx.v_f_leadIn     !== 'manual') newDraft.v_f_leadIn     = roundForField('v_f_leadIn',     vf);
    if (newFx.v_f_leadOut    !== 'manual') newDraft.v_f_leadOut    = roundForField('v_f_leadOut',    vf);
    if (newFx.v_f_transition !== 'manual') newDraft.v_f_transition = roundForField('v_f_transition', vf);

    setDraft(newDraft);
    setFx(newFx);
  };

  const noSpeed = !(draft.n);

  return (
    <div className="preset-card preset-card--edit">
      {/* Header */}
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
              onChange={e => {
                const q = MATERIAL_QUERY_MAP[e.target.value] ?? '';
                setDraft(d => {
                  // Derive Fusion's "Filter by Type" from the material so it's
                  // never blank (all/metal/plastic).
                  const nd = { ...d, material: { ...(d.material || {}), query: q, category: materialCategory(q) } };
                  nd.name = composeName(nd, assemblyId, nd.operation_type);
                  return nd;
                });
              }}
            >
              {MATERIALS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </FGroup>
          <FGroup label="Filter by type">
            <select
              className="field-input"
              value={['all', 'metal', 'plastic'].includes(draft.material?.category) ? draft.material.category : 'all'}
              onChange={e => setMat('category', e.target.value)}
            >
              {['all', 'metal', 'plastic'].map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </FGroup>
        </div>
      </div>

      {/* Operation & Assembly — drive the convention preset name */}
      <div className="preset-edit-section">
        <div className="preset-edit-section-label">OPERATION &amp; ASSEMBLY</div>
        <div className="preset-edit-grid">
          <FGroup label="Operation">
            <select
              className="field-input"
              value={draft.operation_type || ''}
              onChange={e => {
                const op = e.target.value || null;
                setDraft(d => ({ ...d, operation_type: op, name: composeName(d, assemblyId, op) }));
              }}
            >
              <option value="">—</option>
              {OP_TYPES.map(o => <option key={o.value} value={o.value}>{o.word}</option>)}
            </select>
          </FGroup>
          <FGroup label="Assembly (holder + OOH)">
            <select
              className="field-input"
              value={assemblyId}
              disabled={assemblies.length === 0}
              onChange={e => {
                const aid = e.target.value;
                setAssemblyId(aid);
                setDraft(d => ({ ...d, name: composeName(d, aid, d.operation_type) }));
              }}
            >
              {assemblies.length === 0 && <option value="">No assemblies</option>}
              {assemblies.map(a => (
                <option key={a.assembly_id} value={a.assembly_id}>
                  {holderShortName(holderDescOf(a)) || 'holder'} · {a.ooh != null ? `${Number(a.ooh).toFixed(3)} ${lenUnit}` : 'no OOH'}
                </option>
              ))}
            </select>
          </FGroup>
        </div>
      </div>

      {/* Speed */}
      <div className="preset-edit-section">
        <div className="preset-edit-section-label">SPEED</div>
        <div className="preset-edit-grid">
          <NField
            label="Spindle speed" value={draft.n} unit="RPM"
            formulaField="n" formulaState={fx.n}
            onChange={v => handleNumChange('n', v)}
          />
          <NField
            label="Surface speed" value={draft.v_c} unit={speedUnit}
            formulaField="v_c" formulaState={fx.v_c}
            onChange={v => handleNumChange('v_c', v)}
          />
          <NField
            label="Ramp spindle speed" value={draft.n_ramp} unit="RPM"
            formulaField="n_ramp" formulaState={fx.n_ramp}
            onChange={v => handleNumChange('n_ramp', v)}
          />
        </div>
      </div>

      {/* Feedrates */}
      <div className="preset-edit-section">
        <div className="preset-edit-section-label">FEEDRATES</div>
        <div className="preset-edit-grid">
          <NField
            label="Cutting feedrate" value={draft.v_f} unit={feedUnit}
            formulaField="v_f" formulaState={fx.v_f}
            warning={noSpeed ? 'Set spindle speed first' : undefined}
            onChange={v => handleNumChange('v_f', v)}
          />
          <NField
            label="Feed per tooth" value={draft.f_z} unit={lenUnit}
            formulaField="f_z" formulaState={fx.f_z}
            warning={noSpeed ? 'Set spindle speed first' : undefined}
            onChange={v => handleNumChange('f_z', v)}
          />
          <NField
            label="Lead-in feedrate" value={draft.v_f_leadIn} unit={feedUnit}
            formulaField="v_f_leadIn" formulaState={fx.v_f_leadIn}
            onChange={v => handleNumChange('v_f_leadIn', v)}
          />
          <NField
            label="Lead-out feedrate" value={draft.v_f_leadOut} unit={feedUnit}
            formulaField="v_f_leadOut" formulaState={fx.v_f_leadOut}
            onChange={v => handleNumChange('v_f_leadOut', v)}
          />
          <NField
            label="Transition feedrate" value={draft.v_f_transition} unit={feedUnit}
            formulaField="v_f_transition" formulaState={fx.v_f_transition}
            onChange={v => handleNumChange('v_f_transition', v)}
          />
          <NField label="Ramp feedrate"       value={draft.v_f_ramp}      unit={feedUnit} onChange={v => set('v_f_ramp', v)} />
          <NField label="Ramp angle"          value={draft['ramp-angle']} unit="°"        onChange={v => set('ramp-angle', v)} />
        </div>
      </div>

      {/* Vertical Feedrates */}
      <div className="preset-edit-section">
        <div className="preset-edit-section-label">VERTICAL FEEDRATES</div>
        <div className="preset-edit-grid">
          <NField
            label="Plunge feedrate" value={draft.v_f_plunge} unit={feedUnit}
            formulaField="v_f_plunge" formulaState={fx.v_f_plunge}
            onChange={v => handleNumChange('v_f_plunge', v)}
          />
          <NField
            label="Plunge feed per rev" value={draft.f_n} unit={`${lenUnit}/rev`}
            formulaField="f_n" formulaState={fx.f_n}
            onChange={v => handleNumChange('f_n', v)}
          />
        </div>
      </div>

      {/* Passes & Linking */}
      <div className="preset-edit-section">
        <div className="preset-edit-section-label">PASSES &amp; LINKING</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <StepField
            label="Use stepdown"
            value={draft.stepdown}
            enabled={!!draft['use-stepdown']}
            onToggle={checked => {
              if (checked && (!draft.stepdown || draft.stepdown === 0)) {
                set('stepdown', parseFloat((fluteLength * 0.4).toFixed(6)));
              }
              set('use-stepdown', checked);
            }}
            onChange={v => set('stepdown', v)}
            refDim={fluteLength}
            refLabel="flute length"
            lenUnit={lenUnit}
            defaultFactor={0.4}
          />
          <StepField
            label="Use stepover"
            value={draft.stepover}
            enabled={!!draft['use-stepover']}
            onToggle={checked => {
              if (checked && (!draft.stepover || draft.stepover === 0)) {
                set('stepover', parseFloat((diameter * 0.3).toFixed(6)));
              }
              set('use-stepover', checked);
            }}
            onChange={v => set('stepover', v)}
            refDim={diameter}
            refLabel="diameter"
            lenUnit={lenUnit}
            defaultFactor={0.3}
          />
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
          {COOLANT_OPTS.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ── StepField — stepdown/stepover toggle + factor-based editing ───────────────
// Displays the absolute value with a computed factor badge.
// Double-click enters factor-edit mode; on commit, saves the new absolute value.
function StepField({ label, value, onChange, refDim, refLabel, lenUnit, enabled, onToggle, defaultFactor }) {
  const [editing, setEditing] = useState(false);
  const [draftFactor, setDraftFactor] = useState('');
  const inputRef = useRef(null);

  const factor = (refDim && refDim > 0 && value != null && value > 0)
    ? parseFloat((value / refDim).toFixed(4))
    : null;

  const computedAbs = () => {
    const f = parseFloat(draftFactor);
    if (isNaN(f) || f <= 0 || !refDim || refDim <= 0) return null;
    return parseFloat((f * refDim).toFixed(6));
  };

  const startEditing = () => {
    if (!enabled) return;
    setDraftFactor(String(factor ?? defaultFactor));
    setEditing(true);
  };

  const commitEdit = () => {
    const abs = computedAbs();
    if (abs !== null) onChange(abs);
    setEditing(false);
  };

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  return (
    <div className="step-field">
      <label className="preset-check-label">
        <input type="checkbox" checked={enabled} onChange={e => onToggle(e.target.checked)} />
        {label}
      </label>
      {enabled && (
        editing ? (
          <div className="step-field-edit-row">
            <input
              ref={inputRef}
              type="number"
              className="step-factor-input field-input"
              value={draftFactor}
              onChange={e => setDraftFactor(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={e => {
                if (e.key === 'Enter') commitEdit();
                if (e.key === 'Escape') setEditing(false);
              }}
              step="0.05"
              min="0.01"
            />
            <span className="step-factor-ref">
              × {refDim?.toFixed(3)}{lenUnit} {refLabel}
            </span>
            <span className="step-factor-result">
              = {computedAbs() != null ? `${computedAbs().toFixed(4)}${lenUnit}` : '—'}
            </span>
          </div>
        ) : (
          <div className="step-field-display-row" onDoubleClick={startEditing} title="Double-click to edit factor">
            <span className="step-abs-val">
              {value != null && value > 0 ? `${parseFloat(value.toFixed(4))}${lenUnit}` : <span style={{ color: 'var(--text-sub)', fontStyle: 'italic' }}>no value set</span>}
            </span>
            {factor != null && (
              <span className="step-factor-badge">×{factor.toFixed(3)} {refLabel}</span>
            )}
            <span className="step-edit-hint">double-click to edit</span>
          </div>
        )
      )}
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

// NField — numeric input with optional formula badge and shift+hover tooltip.
// formulaField: key in FORMULAS (enables badge + tooltip + field-specific precision)
// formulaState: 'formula' | 'manual' — 'formula' shows the fx badge
// warning: string shown below the input when present (e.g. "Set spindle speed first")
function NField({ label, value, unit, onChange, formulaField, formulaState, warning }) {
  const [focused, setFocused] = useState(false);
  const [shiftHover, setShiftHover] = useState(false);

  const formulaInfo = formulaField ? FORMULAS[formulaField] : null;
  const prec = formulaField ? (FIELD_PRECISION[formulaField] ?? 4) : 4;
  const isFormula = formulaState === 'formula';

  // Focused: full precision so the user can see/edit the stored value exactly.
  // Blurred: field-specific display precision.
  const displayed = focused
    ? (value ?? '')
    : (value !== null && value !== undefined && value !== ''
        ? parseFloat(Number(value).toFixed(prec))
        : '');

  return (
    <div
      className="field-group"
      style={{ position: 'relative' }}
      onMouseMove={e => { if (formulaInfo) setShiftHover(e.shiftKey); }}
      onMouseLeave={() => setShiftHover(false)}
    >
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
        {/* Reserve space for badge whether shown or not, to keep grid aligned */}
        {formulaInfo && (
          <span className={`fx-badge${isFormula ? '' : ' fx-badge--hidden'}`}>fx</span>
        )}
      </div>
      {warning && <div className="fx-warning">{warning}</div>}
      {shiftHover && formulaInfo && (
        <div className="formula-tooltip">
          <div><span className="formula-tooltip-key">Variable</span> {formulaField}</div>
          <div><span className="formula-tooltip-key">State</span> {isFormula ? 'Calculated' : 'Manual'}</div>
          <div>
            <span className="formula-tooltip-key">
              {isFormula ? 'Formula' : 'Formula available'}
            </span>
            {formulaInfo.expr}
          </div>
        </div>
      )}
    </div>
  );
}
