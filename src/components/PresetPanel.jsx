import React, { useState, useEffect, useRef } from 'react';
import { Plus, X, Check, GripVertical, Trash2, ChevronDown, Cpu, Briefcase } from 'lucide-react';
import { generateId, COOLANT_OPTS } from '../schema/toolSchema.js';
import { useApp } from '../context/AppContext.jsx';
import { jobById, jobLabel } from '../utils/jobs.js';
import { holderColor } from './AssemblyCard.jsx';
import CamPresetPicker from './CamPresetPicker.jsx';
import JobProgramPicker from './JobProgramPicker.jsx';
import {
  composePresetName, parsePresetName, presetMatchesAssembly, OP_TYPES, materialCategory,
  materialNameCode, presetMaterialColor, findMaterialInLibrary, HOLE_MAKING_TYPES, TURNING_TYPES,
} from '../utils/presetNaming.js';
import { holderShortName } from '../utils/holderNaming.js';
import {
  rpmToSFM, sfmToRPM,
  fptToIPM, ipmToFPT,
  iprToIPM, ipmToIPR,
  FORMULAS, FIELD_PRECISION, roundForField,
} from '../utils/speedsAndFeedsCalc.js';

// Default formula states when opening any preset for editing.
// 'manual' = user owns this value; 'formula' = calculated from partner.
const DEFAULT_FX = {
  n:              'manual',
  v_c:            'formula',
  n_ramp:         'formula',
  v_f:            'formula',
  f_z:            'manual',
  v_f_plunge:     'formula',
  v_f_retract:    'formula',
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

// Display label for a preset's material query. The query holds the Materials
// library name directly (CAM preset name or group label), so show it verbatim;
// blank -> "Other" (used for the material grouping/filter in the collapsed list).
const matchMaterial = (query) => (query && String(query).trim()) ? String(query).trim() : 'Other';

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
    machine_id: null,
    job_ids: [],
  };
}

// ── Jobs dropdown (collapsed + edit modes) ────────────────────────────────────
// Reference data, deliberately low-key: a one-line toggle showing the linked-job
// COUNT without opening (so an empty list is obvious at a glance), expanding to
// the job labels. In edit mode it removes links and adds one via the shared
// JobProgramPicker (search a program # / part # from the Program Number Manager,
// or add a new program) — the same control the Sync-Job flow uses.
function PresetJobsBlock({ jobIds = [], jobsFile, editable = false, canAdd = true, onAddProgram, onRemove }) {
  const [open, setOpen] = useState(false);
  const count = jobIds.length;

  return (
    <div className="preset-card-jobs">
      <button type="button" className="preset-jobs-toggle" onClick={() => setOpen(o => !o)}>
        <Briefcase size={10} />
        <span>Jobs ({count})</span>
        <ChevronDown size={11} className={`preset-jobs-chev${open ? ' open' : ''}`} />
      </button>
      {open && (
        <div className="preset-jobs-list">
          {count === 0 && <div className="text-xs text-sub">No jobs linked yet.</div>}
          {jobIds.map(id => {
            const job = jobById(jobsFile, id);
            return (
              <div key={id} className="preset-jobs-row">
                <span className="font-mono">{job ? jobLabel(job) : '(job removed from registry)'}</span>
                {editable && (
                  <button type="button" className="icon-btn preset-jobs-del" title="Unlink job" onClick={() => onRemove(id)}>
                    <X size={11} />
                  </button>
                )}
              </div>
            );
          })}
          {editable && (canAdd ? (
            <div className="preset-jobs-add-picker">
              <JobProgramPicker onPick={onAddProgram} />
            </div>
          ) : (
            <div className="text-xs text-sub">Connect Google Drive to link jobs.</div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PresetPanel({ tool, onSave, isSaving, onDirtyChange }) {
  const { holders, materials, shopSettings, jobs, findOrCreateJob, user, googleAuthenticated, demoMode } = useApp();
  // Job links persist in metadata (jobs.json + preset_meta on Drive), so adding
  // them needs Drive (or the demo sandbox, which keeps everything in memory).
  const canAddJobs = googleAuthenticated || demoMode;
  // Resolve a preset's material to its group color (from the Materials library).
  const groupColorOf = (query) => presetMaterialColor(query, materials);
  const isMetric = tool.unit === 'millimeters';
  const lenUnit = isMetric ? 'mm' : 'in';
  const feedUnit = isMetric ? 'mm/min' : 'in/min';
  const speedUnit = isMetric ? 'm/min' : 'SFM';
  const toolType = tool.tool_type || 'flat end mill';

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
  const [machineFilter, setMachineFilter] = useState('All');
  const machines = shopSettings?.machines || [];
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  // Add flow: `addOpen` reveals the "copy from" row; `copySrc` is what a new
  // preset will be seeded from — start blank, copy an existing preset, or seed
  // from a Speeds & Feeds reference.
  const [addOpen, setAddOpen] = useState(false);
  const [copySrc, setCopySrc] = useState({ type: 'blank', id: '' });
  const [editorDirty, setEditorDirty] = useState(false);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const dragSrcIdx = useRef(null);
  const panelRef = useRef(null);

  // Speeds & Feeds references (metadata-only) the user can seed a preset from.
  const sfRefs = (tool.speed_feed_refs || []).filter(r => r.preset_id);
  const camPresetById = (id) => (materials?.presets || []).find(p => p.id === id);

  // Report unsaved-editor state up so ToolDetail can warn before navigating away.
  useEffect(() => { onDirtyChange?.(!!editingId && editorDirty); }, [editingId, editorDirty, onDirtyChange]);

  // Confirm discarding unsaved edits before switching presets / adding / etc.
  const guardDiscard = () => {
    if (editingId && editorDirty) {
      return window.confirm('You have unsaved changes to this preset. Discard them?');
    }
    return true;
  };

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

  const afterMaterialFilter = materialFilter === 'All'
    ? presets
    : presets.filter(p => matchMaterial(p.material?.query) === materialFilter);
  const visible = machineFilter === 'All'
    ? afterMaterialFilter
    : afterMaterialFilter.filter(p => p.machine_id === machineFilter);

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
    setEditorDirty(false);
    setEditingId(null);
    onSave(next);
  };

  const handleEditClick = (guid) => {
    if (guid === editingId) return;
    if (!guardDiscard()) return;
    setAddOpen(false);
    setEditorDirty(false);
    setEditingId(guid);
  };

  const handleCancelEdit = () => {
    setEditorDirty(false);
    setEditingId(null);
  };

  const handleDelete = () => {
    const next = presets.filter(p => p.guid !== deleteConfirmId);
    setPresets(next);
    setDeleteConfirmId(null);
    onSave(next);
  };

  // Open the "copy from" row, and scroll the Speeds & Feeds header to the top.
  const handleAddClick = () => {
    if (!guardDiscard()) return;
    setEditorDirty(false);
    setEditingId(null);
    setCopySrc({ type: 'blank', id: '' });
    setAddOpen(true);
    setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40);
  };

  // Label shown in the "copy from" line for the current selection.
  const copyFromLabel = () => {
    if (copySrc.type === 'preset') return presets.find(p => p.guid === copySrc.id)?.name || 'preset';
    if (copySrc.type === 'ref') return camPresetById(copySrc.id)?.name || 'reference';
    return 'Start blank';
  };

  // Build the new preset from the chosen source (blank / preset copy / reference).
  const buildNewPreset = () => {
    let np;
    if (copySrc.type === 'preset') {
      const src = presets.find(p => p.guid === copySrc.id);
      // Clear job_ids on the copy — proven-job provenance belongs to the original
      // preset, not a fresh unproven copy of it (machine_id IS carried, by design).
      if (src) np = { ...src, guid: generateId(), name: `${src.name || 'Preset'} (copy)`, job_ids: [] };
    }
    if (!np && copySrc.type === 'ref') {
      const ref = sfRefs.find(r => r.preset_id === copySrc.id);
      const cam = camPresetById(copySrc.id);
      np = blankPreset();
      if (cam) np.material = { ...np.material, query: cam.name, category: materialCategory(cam.name) };
      // Seed speeds/feeds from the reference using THIS tool's diameter + flutes.
      const factor = isMetric ? 1000 : 12;
      const rpm = (ref?.sfm && diameter) ? (ref.sfm * factor) / (Math.PI * diameter) : 0;
      const flutes = numberOfFlutes || 0;
      np.n   = roundForField('n', rpm);
      np.v_c = ref?.sfm ?? 0;
      np.f_z = ref?.chip_load ?? 0;
      np.v_f = (ref?.chip_load && rpm && flutes) ? roundForField('v_f', ref.chip_load * rpm * flutes) : 0;
      np.name = composePresetName({ materialQuery: materialNameCode(cam?.name, materials) }) || cam?.name || 'New Preset';
    }
    if (!np) np = blankPreset();
    // Pre-populate the default machine for new/ref-seeded presets (not copies —
    // a copy already carries the original preset's machine_id).
    if (copySrc.type !== 'preset' && shopSettings?.default_machine_id) {
      np.machine_id = shopSettings.default_machine_id;
    }
    return np;
  };

  const handleConfirmAdd = () => {
    const np = buildNewPreset();
    setPresets([...presets, np]);
    setAddOpen(false);
    setCopySrc({ type: 'blank', id: '' });
    setEditorDirty(false);
    setEditingId(np.guid);
  };

  return (
    <div className="preset-panel" ref={panelRef}>
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

      {/* Machine filter — only when machines are configured */}
      {presets.length > 0 && machines.length > 0 && (
        <div className="preset-tabs" style={{ paddingTop: 4, borderTop: 'none', gap: 6 }}>
          <Cpu size={12} style={{ color: 'var(--text-sub)', flexShrink: 0 }} />
          <button
            className={`chip ${machineFilter === 'All' ? 'active' : ''}`}
            onClick={() => setMachineFilter('All')}
          >
            All
          </button>
          {machines.map(m => {
            const count = presets.filter(p => p.machine_id === m.id).length;
            return (
              <button
                key={m.id}
                className={`chip ${machineFilter === m.id ? 'active' : ''}`}
                onClick={() => setMachineFilter(f => f === m.id ? 'All' : m.id)}
              >
                {m.model}{count > 0 ? ` (${count})` : ''}
              </button>
            );
          })}
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
                    {groupColorOf(preset.material?.query) && (
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: groupColorOf(preset.material?.query), display: 'inline-block', marginRight: 6 }} />
                    )}
                    <span>{matchMaterial(preset.material?.query)}</span>
                  </div>
                )}
                <CollapsedCard
                  preset={preset}
                  toolType={toolType}
                  accentColor={groupColorOf(preset.material?.query)}
                  lenUnit={lenUnit}
                  feedUnit={feedUnit}
                  speedUnit={speedUnit}
                  isEditing={editingId === preset.guid}
                  pickMode={addOpen}
                  picked={addOpen && copySrc.type === 'preset' && copySrc.id === preset.guid}
                  onPick={() => setCopySrc({ type: 'preset', id: preset.guid })}
                  isDragOver={dragOverIdx === globalIdx}
                  dragEnabled={materialFilter === 'All' && machineFilter === 'All' && !addOpen}
                  linkedAssemblies={(tool.assemblies || []).filter(a =>
                    presetMatchesAssembly(preset, a, tool.unit)
                  )}
                  holders={holders}
                  machines={machines}
                  jobsFile={jobs}
                  onEdit={() => handleEditClick(preset.guid)}
                  onDelete={() => setDeleteConfirmId(preset.guid)}
                  onDragStart={e => handleDragStart(e, globalIdx)}
                  onDragOver={e => handleDragOver(e, globalIdx)}
                  onDrop={e => handleDrop(e, globalIdx)}
                  onDragEnd={handleDragEnd}
                />
              </React.Fragment>
            );
          })}

          {visible.length === 0 && (materialFilter !== 'All' || machineFilter !== 'All') && (
            <div className="preset-empty">
              No presets match{materialFilter !== 'All' ? ` ${materialFilter}` : ''}
              {machineFilter !== 'All' ? ` on ${machines.find(m => m.id === machineFilter)?.model || 'this machine'}` : ''}.
            </div>
          )}

          {presets.length === 0 && materialFilter === 'All' && machineFilter === 'All' && (
            <div className="preset-empty">No presets yet — add one below.</div>
          )}
        </div>
      </div>

      {/* Add control — a small button under the scroll; clicking expands the
          "copy from" row inline (start blank / pick a preset card above / pick a
          reference) before the editor pops out below. */}
      <div className="preset-add-bar">
        {!addOpen ? (
          <button className="preset-add-btn" onClick={handleAddClick} disabled={!!editingId} title="Add preset">
            <Plus size={14} /> Add Preset
          </button>
        ) : (
          <div className="preset-copyfrom">
            <button className="preset-add-btn preset-add-btn--active" onClick={() => { setAddOpen(false); setCopySrc({ type: 'blank', id: '' }); }} title="Close">
              <Plus size={14} /> Add Preset
            </button>
            <span className="preset-copyfrom-label">Copy from:</span>
            <button
              className={`chip ${copySrc.type === 'blank' ? 'active' : ''}`}
              onClick={() => setCopySrc({ type: 'blank', id: '' })}
            >
              Start blank
            </button>
            {presets.length > 0 && (
              <span className="text-xs text-sub">or click a preset above</span>
            )}
            {sfRefs.length > 0 && (
              <>
                <span className="preset-copyfrom-sep">·</span>
                <span className="text-xs text-sub">reference:</span>
                {sfRefs.map(r => {
                  const cam = camPresetById(r.preset_id);
                  const on = copySrc.type === 'ref' && copySrc.id === r.preset_id;
                  return (
                    <button
                      key={r.preset_id}
                      className={`chip ${on ? 'active' : ''}`}
                      style={{ '--badge-color': groupColorOf(cam?.name) || undefined }}
                      onClick={() => setCopySrc({ type: 'ref', id: r.preset_id })}
                      title={`Seed from ${cam?.name || 'reference'} (${r.sfm ?? '—'} SFM, ${r.chip_load ?? '—'} chip load)`}
                    >
                      {cam?.name || 'reference'}
                    </button>
                  );
                })}
              </>
            )}
            <span className="preset-copyfrom-current">{copyFromLabel()}</span>
            <div className="preset-copyfrom-actions">
              <button className="btn btn-primary btn-sm" onClick={handleConfirmAdd}>Add</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setAddOpen(false); setCopySrc({ type: 'blank', id: '' }); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Editor — opens as an overlay (like the CAM Preset picker) on add/edit */}
      {editingId && (() => {
        const editing = presets.find(p => p.guid === editingId);
        if (!editing) return null;
        return (
          <EditCard
            key={editingId}
            preset={editing}
            toolType={toolType}
            accentColor={groupColorOf(editing.material?.query)}
            lenUnit={lenUnit}
            feedUnit={feedUnit}
            speedUnit={speedUnit}
            diameter={diameter}
            fluteLength={tool.flute_length || 0}
            numberOfFlutes={numberOfFlutes}
            assemblies={tool.assemblies || []}
            holders={holders}
            materials={materials}
            shopSettings={shopSettings}
            jobsFile={jobs}
            findOrCreateJob={findOrCreateJob}
            canAddJobs={canAddJobs}
            currentUser={user?.email || user?.name || ''}
            onSave={handlePresetSave}
            onCancel={handleCancelEdit}
            onDirtyChange={setEditorDirty}
            isSaving={isSaving}
          />
        );
      })()}
    </div>
  );
}

// ── Collapsed card ───────────────────────────────────────────────────────────
function CollapsedCard({
  preset, toolType, accentColor, lenUnit, feedUnit, speedUnit,
  isEditing, pickMode, picked, onPick, isDragOver, dragEnabled,
  linkedAssemblies, holders, machines, jobsFile,
  onEdit, onDelete,
  onDragStart, onDragOver, onDrop, onDragEnd,
}) {
  const isTap = toolType === 'tap';
  const isSpotDrill = toolType === 'spot drill';
  const isDrillFamily = !isTap && !isSpotDrill && HOLE_MAKING_TYPES.has(toolType);
  const isTurning = TURNING_TYPES.has(toolType);

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
  const linkedMachine = preset.machine_id && machines?.length
    ? machines.find(m => m.id === preset.machine_id)
    : null;

  return (
    <div
      className={`preset-card${isDragOver ? ' preset-card--drop' : ''}${isEditing ? ' preset-card--editing' : ''}${pickMode ? ' preset-card--pick' : ''}${picked ? ' preset-card--picked' : ''}`}
      style={accentColor ? { borderLeft: `3px solid ${accentColor}` } : undefined}
      draggable={dragEnabled}
      onClick={pickMode ? onPick : undefined}
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
          <span className="preset-tag" title={preset.name} style={{ '--badge-color': accentColor || undefined }}>{preset.name || 'Unnamed'}</span>
        </div>
        <div className="preset-card-mat" style={accentColor ? { color: accentColor } : undefined}>{mat}</div>
        <div className="preset-card-stats">
          <StatRow label="Spindle" value={r4(preset.n)} unit="rpm" />
          <StatRow label="Surface" value={r4(preset.v_c)} unit={sfcLabel} />
          {isTap ? null : isSpotDrill ? (
            <>
              <StatRow label="Cutting" value={r4(preset.v_f)} unit={feedUnit} />
              <StatRow label="Feed/Tooth" value={r4(preset.f_z)} unit={lenUnit} />
              <StatRow label="Plunge" value={r4(preset.v_f_plunge)} unit={feedUnit} />
              <StatRow label="Retract" value={r4(preset['v_f_retract'])} unit={feedUnit} />
            </>
          ) : isDrillFamily ? (
            <>
              <StatRow label="Plunge" value={r4(preset.v_f_plunge)} unit={feedUnit} />
              <StatRow label="Retract" value={r4(preset['v_f_retract'])} unit={feedUnit} />
              <StatRow label="Feed/Rev" value={r4(preset.f_n)} unit={`${lenUnit}/rev`} />
            </>
          ) : isTurning ? (
            <>
              <StatRow label="Cutting" value={r4(preset.v_f)} unit={feedUnit} />
              <StatRow label="Feed/Rev" value={r4(preset.f_n)} unit={`${lenUnit}/rev`} />
              <StatRow label="Plunge" value={r4(preset.v_f_plunge)} unit={feedUnit} />
            </>
          ) : (
            <>
              <StatRow label="Cutting" value={r4(preset.v_f)} unit={feedUnit} />
              <StatRow label="Feed/Tooth" value={r4(preset.f_z)} unit={lenUnit} />
              <StatRow label="Plunge" value={r4(preset.v_f_plunge)} unit={feedUnit} />
            </>
          )}
          <StatRow label="Coolant" value={coolantLabel} />
        </div>
        {linkedAssemblies?.length > 0 && (
          <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
            {singleAssembly ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                {assemblyHolderDesc && (
                  <span
                    className="holder-pill"
                    style={assemblyHolderColor ? { '--badge-color': assemblyHolderColor } : {}}
                  >{assemblyHolderDesc}</span>
                )}
                <span className="text-xs text-sub">OOH: {singleAssembly.ooh != null ? `${singleAssembly.ooh.toFixed(3)} ${lenUnit}` : '—'}</span>
              </div>
            ) : (
              <span className="text-xs text-sub">{linkedAssemblies.length} assemblies</span>
            )}
          </div>
        )}
        {linkedMachine && (
          <div style={{ marginTop: linkedAssemblies?.length > 0 ? 4 : 6, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Cpu size={10} style={{ color: 'var(--text-sub)', flexShrink: 0 }} />
            <span className="text-xs text-sub">{linkedMachine.model}</span>
          </div>
        )}
      </div>
      {!pickMode && (
        <PresetJobsBlock jobIds={preset.job_ids || []} jobsFile={jobsFile} />
      )}
      <div className="preset-card-footer">
        {pickMode ? (
          <span className="preset-pick-hint">{picked ? 'Selected to copy' : 'Click to copy'}</span>
        ) : (
          <>
            <button className="btn btn-secondary btn-sm" onClick={onEdit}>{isEditing ? 'Editing…' : 'Edit'}</button>
            <button className="btn btn-ghost btn-sm preset-card-del" onClick={onDelete}>
              <Trash2 size={12} />
            </button>
          </>
        )}
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

  // Retract follows plunge (one-directional) unless overridden.
  if (fx.v_f_retract === 'formula')
    d.v_f_retract = roundForField('v_f_retract', d.v_f_plunge ?? 0);

  const vf = d.v_f ?? 0;
  if (fx.v_f_leadIn     === 'formula') d.v_f_leadIn     = roundForField('v_f_leadIn',     vf);
  if (fx.v_f_leadOut    === 'formula') d.v_f_leadOut    = roundForField('v_f_leadOut',    vf);
  if (fx.v_f_transition === 'formula') d.v_f_transition = roundForField('v_f_transition', vf);

  return d;
}

// Returns true when the machine's taper is found in the holder description.
// Used for the informational taper compatibility hint — non-blocking.
function taperMatches(machTaper, holderDesc) {
  if (!machTaper || !holderDesc || machTaper === 'Other') return true;
  return holderDesc.toUpperCase().includes(machTaper.toUpperCase());
}

// ── Edit card ────────────────────────────────────────────────────────────────
function EditCard({
  preset, toolType, accentColor, lenUnit, feedUnit, speedUnit,
  diameter, fluteLength, numberOfFlutes,
  assemblies = [], holders = [], materials, shopSettings,
  jobsFile, findOrCreateJob, canAddJobs = false, currentUser = '',
  onSave, onCancel, onDirtyChange, isSaving,
}) {
  const isTap = toolType === 'tap';
  const isSpotDrill = toolType === 'spot drill';
  const isDrillFamily = !isTap && !isSpotDrill && HOLE_MAKING_TYPES.has(toolType);
  const isHoleMaking = isTap || isDrillFamily || isSpotDrill;
  const isTurning = TURNING_TYPES.has(toolType);
  const isMilling = !isHoleMaking && !isTurning;

  // Milling and spot drill enter plunge feed as an independent value: neither
  // shows a feed-per-rev (f_n) field, so v_f_plunge is the source of truth and
  // f_n is derived from it. Without this, DEFAULT_FX (v_f_plunge:'formula',
  // f_n:'manual') would recompute plunge from the (nonexistent, zero) f_n — on
  // mount AND whenever spindle speed changes — silently zeroing a proven plunge
  // feed. Drill-family tools keep the drilling convention (f_n manual, plunge
  // derived). The draft init must use this same fx, not DEFAULT_FX.
  const initialFx = { ...DEFAULT_FX };
  if (isMilling || isSpotDrill) { initialFx.v_f_plunge = 'manual'; initialFx.f_n = 'formula'; }
  // Turning/boring enter cutting feed and plunge directly — feed-per-tooth (f_z)
  // doesn't apply — so keep them manual. Otherwise the milling formula (v_f =
  // f_z × n × flutes, with f_z = 0) would zero the cutting feed on open and on
  // every spindle-speed change. The n/v_c cascades below are also skipped for it.
  if (isTurning) { initialFx.v_f = 'manual'; initialFx.v_f_plunge = 'manual'; }
  // Retract feedrate defaults to the plunge feedrate (Fusion's native
  // tool_feedRetract = tool_feedPlunge) and follows it as plunge changes — but
  // only on the tools that have a retract field (drill family + spot drill), and
  // only until the user overrides it. A stored value that already differs from
  // plunge is treated as an override (manual) so it's preserved on open. For
  // every other tool type retract isn't shown, so keep it manual (not computed).
  if (isDrillFamily || isSpotDrill) {
    const r = preset['v_f_retract'], pl = preset.v_f_plunge ?? 0;
    initialFx.v_f_retract = (r == null || Math.abs(Number(r) - Number(pl)) < 1e-6) ? 'formula' : 'manual';
  } else {
    initialFx.v_f_retract = 'manual';
  }
  const configMachines = shopSettings?.machines || [];
  const [fx, setFx] = useState(initialFx);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState(() => {
    const d = computeFormulaDraft({ ...preset }, initialFx, diameter, numberOfFlutes);
    d.operation_type = preset.operation_type ?? parsePresetName(preset.name)?.opType ?? null;
    d.machine_id = preset.machine_id ?? null;
    d.job_ids = preset.job_ids ?? [];
    return d;
  });

  // Which assembly (holder + OOH) this preset is named for. Initialised by
  // matching the current name; user can switch it to retarget the preset.
  const [assemblyId, setAssemblyId] = useState(() =>
    assemblies.find(a => presetMatchesAssembly(preset, a, lenUnit))?.assembly_id || ''
  );

  const holderDescOf = (a) =>
    a ? (a.holder_description || holders.find(h => h.guid === a.holder_guid)?.description || '') : '';

  // Compose the convention name from material + the selected assembly + op type.
  // For hole-making tools, op type is omitted — the name is material + OOH + holder.
  // Falls back to the current draft name when no assembly is selected, or when a
  // milling tool has no op type selected yet.
  const composeName = (d, asmId, opType) => {
    const a = assemblies.find(x => x.assembly_id === asmId);
    return composePresetName({
      // Material token comes from the Materials library code for the stored query.
      materialQuery: materialNameCode(d.material?.query, materials),
      ooh: a?.ooh,
      holderShort: a ? holderShortName(holderDescOf(a)) : null,
      opType: isHoleMaking ? null : opType,
    });
  };

  // ── Unsaved-changes tracking ───────────────────────────────────────────────
  // `dirty` flips true on the first user edit; the parent uses it to warn before
  // switching presets / adding / leaving. Cancel + Save both clear it (handled
  // by the parent when the editor unmounts). A browser-level beforeunload guard
  // covers refresh/close while dirty.
  const [dirty, setDirty] = useState(false);
  const touch = () => setDirty(true);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    const warn = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // ── Esc cancels; scroll the editor to center on open (it "pops out" inline) ──
  const containerRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const t = setTimeout(() => containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
    return () => clearTimeout(t);
  }, []);

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
  const set = (k, v) => { touch(); setDraft(d => ({ ...d, [k]: v })); };
  const setMat = (k, v) => { touch(); setDraft(d => ({ ...d, material: { ...(d.material || {}), [k]: v } })); };
  // Plunge for milling / spot drill is a plain value (no f_n field), but retract
  // still follows it unless overridden — so cascade retract here too.
  const setPlunge = (v) => { touch(); setDraft(d => {
    const nd = { ...d, v_f_plunge: v };
    if (fx.v_f_retract !== 'manual') nd.v_f_retract = v;
    return nd;
  }); };

  // ── Bidirectional calculation ──────────────────────────────────────────────
  // Called for every formula-linked field on each keystroke.
  // The typed field becomes 'manual'; its partner becomes 'formula' and is
  // immediately recomputed. When n/v_c change, the cutting and plunge feed
  // groups cascade too.
  const handleNumChange = (field, value) => {
    touch();
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
    } else if ((field === 'n' || field === 'v_c') && !isTurning) {
      // n changed — cascade whichever side is manual (turning's v_f is manual)
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
    } else if ((field === 'n' || field === 'v_c') && !isTurning) {
      if (fx.f_n === 'manual') {
        newDraft.v_f_plunge = roundForField('v_f_plunge', iprToIPM(draft.f_n ?? 0, n));
        newFx.v_f_plunge    = 'formula';
      } else {
        newDraft.f_n = roundForField('f_n', ipmToIPR(draft.v_f_plunge ?? 0, n));
        newFx.f_n    = 'formula';
      }
    }

    // ── Retract follows plunge (one-directional) unless overridden ───────────
    if (newFx.v_f_retract !== 'manual') newDraft.v_f_retract = newDraft.v_f_plunge ?? 0;

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
    <div
      ref={containerRef}
      className="preset-editor-inline"
      style={accentColor ? { borderTop: `3px solid ${accentColor}` } : undefined}
    >
      {/* Header */}
      <div className="preset-edit-modal-header">
        <input
          className="field-input preset-name-input"
          value={draft.name || ''}
          onChange={e => set('name', e.target.value)}
          placeholder="Preset name"
          autoFocus
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

      <div className="preset-edit-modal-body">
      <div className="preset-edit-modal-top">
      {/* Material — picked from the Materials library via the CAM Preset picker
          (search "6061"/"1018" → its CAM preset, or browse the group pills).
          Stored as material.query = CAM preset name, else group label. The CAM
          preset name is the Fusion speed/feed preset group this maps to. */}
      <div className="preset-edit-section">
        <div className="preset-edit-section-label">MATERIAL</div>
        <div className="preset-edit-grid">
          <FGroup label="CAM Preset">
            {(() => {
              const cur = findMaterialInLibrary(draft.material?.query, materials);
              const sel = cur.preset || cur.group;
              const color = presetMaterialColor(draft.material?.query, materials);
              const clearMat = () => { touch(); setDraft(d => {
                const nd = { ...d, material: { ...(d.material || {}), query: '', category: 'all' } };
                nd.name = composeName(nd, assemblyId, nd.operation_type);
                return nd;
              }); };
              return (
                <div
                  className="preset-mat-field"
                  role="button"
                  tabIndex={0}
                  onClick={() => setPickerOpen(true)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPickerOpen(true); } }}
                >
                  {sel ? (
                    <span className="preset-mat-sel">
                      <span className="cam-dot" style={{ background: color || '#888' }} />
                      {cur.preset ? cur.preset.name : cur.group.label}
                    </span>
                  ) : (
                    <span className="text-sub">Choose material…</span>
                  )}
                  <span className="preset-mat-actions">
                    {sel && (
                      <span className="preset-mat-clear" title="Clear" onClick={e => { e.stopPropagation(); clearMat(); }}>
                        <X size={13} />
                      </span>
                    )}
                    <ChevronDown size={14} className="text-sub" />
                  </span>
                </div>
              );
            })()}
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
        <div className="preset-edit-section-label">{isHoleMaking ? 'ASSEMBLY' : 'OPERATION & ASSEMBLY'}</div>
        <div className="preset-edit-grid">
          {!isHoleMaking && (
            <FGroup label="Operation">
              <select
                className="field-input"
                value={draft.operation_type || ''}
                onChange={e => {
                  const op = e.target.value || null;
                  touch();
                  setDraft(d => ({ ...d, operation_type: op, name: composeName(d, assemblyId, op) }));
                }}
              >
                <option value="">—</option>
                {OP_TYPES.map(o => <option key={o.value} value={o.value}>{o.word}</option>)}
              </select>
            </FGroup>
          )}
          <FGroup label="Assembly (holder + OOH)">
            <select
              className="field-input"
              value={assemblyId}
              disabled={assemblies.length === 0}
              onChange={e => {
                const aid = e.target.value;
                touch();
                setAssemblyId(aid);
                setDraft(d => ({ ...d, name: composeName(d, aid, d.operation_type) }));
              }}
            >
              {assemblies.length === 0 && <option value="">No assemblies</option>}
              {assemblies.length > 0 && <option value="">— None —</option>}
              {assemblies.map(a => (
                <option key={a.assembly_id} value={a.assembly_id}>
                  {holderShortName(holderDescOf(a)) || 'holder'} · {a.ooh != null ? `${Number(a.ooh).toFixed(3)} ${lenUnit}` : 'no OOH'}
                </option>
              ))}
            </select>
          </FGroup>
          {configMachines.length > 0 && (() => {
            const selMachine = configMachines.find(m => m.id === draft.machine_id);
            const selAsm = assemblies.find(a => a.assembly_id === assemblyId);
            const holderDesc = selAsm ? holderDescOf(selAsm) : '';
            const taperOk = !selMachine || !holderDesc || taperMatches(selMachine.taper, holderDesc);
            return (
              <FGroup label={
                <span className="flex items-center gap-6">
                  Machine
                  {!taperOk && (
                    <span
                      title={`Taper mismatch: machine is ${selMachine.taper} but holder may not match`}
                      style={{ color: 'var(--orange)', cursor: 'help', lineHeight: 1 }}
                    >⚠</span>
                  )}
                </span>
              }>
                <select
                  className="field-input"
                  value={draft.machine_id || ''}
                  onChange={e => { touch(); setDraft(d => ({ ...d, machine_id: e.target.value || null })); }}
                >
                  <option value="">— None —</option>
                  {configMachines.map(m => (
                    <option key={m.id} value={m.id}>{m.model}</option>
                  ))}
                </select>
              </FGroup>
            );
          })()}
        </div>
      </div>
      </div>

      <div className="preset-edit-modal-rest">
      <div className="preset-edit-col">
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
          {!isHoleMaking && (
            <NField
              label="Ramp spindle speed" value={draft.n_ramp} unit="RPM"
              formulaField="n_ramp" formulaState={fx.n_ramp}
              onChange={v => handleNumChange('n_ramp', v)}
            />
          )}
        </div>
      </div>
      </div>

      <div className="preset-edit-col">
      {/* Passes & Linking — milling only */}
      {isMilling && (
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
      )}

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
      </div>

      {/* Feedrates — full-width row at the bottom (the tallest section, so it
          gets its own wide grid instead of squeezing into a column) */}
      {/* Feedrates — milling only */}
      {isMilling && (
        <div className="preset-edit-section preset-edit-section--wide">
          <div className="preset-edit-section-label">FEEDRATES</div>
          <div className="preset-edit-grid preset-edit-grid--wide">
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
            <NField label="Plunge feedrate" value={draft.v_f_plunge}   unit={feedUnit} onChange={v => setPlunge(v)} />
            <NField label="Ramp feedrate" value={draft.v_f_ramp}      unit={feedUnit} onChange={v => set('v_f_ramp', v)} />
            <NField label="Ramp angle"    value={draft['ramp-angle']} unit="°"        onChange={v => set('ramp-angle', v)} />
          </div>
        </div>
      )}

      {/* Feedrates — spot drill: milling-style cutting feed + plunge/retract,
          no feed/rev or ramp angle (see normalizePreset's isSpotDrill branch) */}
      {isSpotDrill && (
        <div className="preset-edit-section preset-edit-section--wide">
          <div className="preset-edit-section-label">FEEDRATES</div>
          <div className="preset-edit-grid preset-edit-grid--wide">
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
            <NField label="Ramp feedrate" value={draft.v_f_ramp} unit={feedUnit} onChange={v => set('v_f_ramp', v)} />
            <NField
              label="Plunge feedrate" value={draft.v_f_plunge} unit={feedUnit}
              warning={noSpeed ? 'Set spindle speed first' : undefined}
              onChange={v => setPlunge(v)}
            />
            <NField
              label="Retract feedrate" value={draft['v_f_retract']} unit={feedUnit}
              formulaField="v_f_retract" formulaState={fx.v_f_retract}
              onChange={v => handleNumChange('v_f_retract', v)}
            />
          </div>
        </div>
      )}

      {/* Feedrates — turning/boring */}
      {isTurning && (
        <div className="preset-edit-section preset-edit-section--wide">
          <div className="preset-edit-section-label">FEEDRATES</div>
          <div className="preset-edit-grid preset-edit-grid--wide">
            <NField
              label="Cutting feedrate" value={draft.v_f} unit={feedUnit}
              formulaField="v_f" formulaState={fx.v_f}
              warning={noSpeed ? 'Set spindle speed first' : undefined}
              onChange={v => handleNumChange('v_f', v)}
            />
            <NField
              label="Feed per rev" value={draft.f_n} unit={`${lenUnit}/rev`}
              formulaField="f_n" formulaState={fx.f_n}
              onChange={v => handleNumChange('f_n', v)}
            />
            <NField
              label="Plunge feedrate" value={draft.v_f_plunge} unit={feedUnit}
              formulaField="v_f_plunge" formulaState={fx.v_f_plunge}
              onChange={v => handleNumChange('v_f_plunge', v)}
            />
          </div>
        </div>
      )}

      {/* Feedrates — drill family: plunge + retract + feed/rev */}
      {isDrillFamily && (
        <div className="preset-edit-section preset-edit-section--wide">
          <div className="preset-edit-section-label">FEEDRATES</div>
          <div className="preset-edit-grid preset-edit-grid--wide">
            <NField
              label="Plunge feedrate" value={draft.v_f_plunge} unit={feedUnit}
              formulaField="v_f_plunge" formulaState={fx.v_f_plunge}
              warning={noSpeed ? 'Set spindle speed first' : undefined}
              onChange={v => handleNumChange('v_f_plunge', v)}
            />
            <NField
              label="Retract feedrate" value={draft['v_f_retract']} unit={feedUnit}
              formulaField="v_f_retract" formulaState={fx.v_f_retract}
              onChange={v => handleNumChange('v_f_retract', v)}
            />
            <NField
              label="Feed per rev" value={draft.f_n} unit={`${lenUnit}/rev`}
              formulaField="f_n" formulaState={fx.f_n}
              onChange={v => handleNumChange('f_n', v)}
            />
          </div>
        </div>
      )}

      {/* Jobs — reference links to the jobs this preset was proven on. Adding
          resolves against the shop-wide jobs.json registry (same job entered
          twice = one record); saved with the preset via preset_meta. */}
      <div className="preset-edit-section preset-edit-section--wide">
        <PresetJobsBlock
          jobIds={draft.job_ids || []}
          jobsFile={jobsFile}
          editable
          canAdd={canAddJobs}
          onAddProgram={(sel) => {
            const job = findOrCreateJob(sel.program_number, sel.part_number, currentUser, sel.program_id);
            touch();
            setDraft(d => (d.job_ids || []).includes(job.id)
              ? d
              : { ...d, job_ids: [...(d.job_ids || []), job.id] });
          }}
          onRemove={(id) => {
            touch();
            setDraft(d => ({ ...d, job_ids: (d.job_ids || []).filter(j => j !== id) }));
          }}
        />
      </div>
      </div>

      {pickerOpen && (
        <CamPresetPicker
          materials={materials}
          currentQuery={draft.material?.query}
          onClose={() => setPickerOpen(false)}
          onSelect={(cp) => { touch(); setDraft(d => {
            const query = cp.name;
            const nd = { ...d, material: { ...(d.material || {}), query, category: materialCategory(query) } };
            nd.name = composeName(nd, assemblyId, nd.operation_type);
            return nd;
          }); }}
        />
      )}
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
      <div className="nfield-row">
        <input
          className="field-input"
          type="number"
          step="0.0001"
          value={displayed}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={e => onChange(e.target.value === '' ? null : parseFloat(e.target.value))}
          placeholder="0"
        />
        <span className="nfield-unit">{unit || ''}</span>
        {/* Always reserve the badge slot so every input is the same width */}
        <span className="nfield-fx">
          {formulaInfo && (
            <span className={`fx-badge${isFormula ? '' : ' fx-badge--hidden'}`}>fx</span>
          )}
        </span>
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
