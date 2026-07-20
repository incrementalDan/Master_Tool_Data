import React, { useState, useEffect, useRef } from 'react';
import { Plus, X, Check, GripVertical, Trash2, ChevronDown, Cpu, Briefcase, Clipboard, AlertTriangle } from 'lucide-react';
import { generateId, COOLANT_OPTS } from '../schema/toolSchema.js';
import { copyPresetToClipboard } from '../utils/fusionExport.js';
import { useApp } from '../context/AppContext.jsx';
import { jobById, jobLabel } from '../utils/jobs.js';
import { holderColor } from './AssemblyCard.jsx';
import { machineColor } from '../utils/machineColors.js';
import MachinePill from './MachinePill.jsx';
import CamPresetPicker from './CamPresetPicker.jsx';
import JobProgramPicker from './JobProgramPicker.jsx';
import LinkedSlider from './LinkedSlider.jsx';
import InfoTip from './InfoTip.jsx';
import { boreCompensation, SmallBoreIcon } from '../utils/boreCompensation.jsx';
import {
  STRATEGIES, STRATEGY_COLUMNS, strategyById, strategiesForToolType,
  QUICK_GROUPS, quickGroupsContaining, AUTO_LINK_PAIR, PINNED_STRATEGIES,
  SMALL_BORE_STRATEGIES, isNewFormatPreset, readStrategyBucket, buildStrategies, writeBucketStrategies,
} from '../schema/camStrategies.js';
import {
  composePresetName, parsePresetName, presetMatchesAssembly, OP_TYPES, materialCategory,
  materialNameCode, presetMaterialColor, findMaterialInLibrary, HOLE_MAKING_TYPES, TURNING_TYPES,
} from '../utils/presetNaming.js';
import { holderShortName } from '../utils/holderNaming.js';
import {
  rpmToSFM, sfmToRPM,
  fptToIPM, ipmToFPT,
  iprToIPM, ipmToIPR,
  roundForField,
} from '../utils/speedsAndFeedsCalc.js';
import { initialPresetFx, computeFormulaDraft } from '../utils/presetFx.js';

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
    // Small-bore comp (app-only, metadata-owned) — off by default.
    small_bore: false, small_bore_diameter: '', f_z_base: null,
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
  // Milling tools are the ones that carry toolpath strategies (hole-making has
  // none; turning has its own vocabulary the app doesn't edit yet). New milling
  // presets default to the new (strategy) format.
  const isMillingType = !HOLE_MAKING_TYPES.has(toolType) && !TURNING_TYPES.has(toolType);

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
  // Transient "Copied ✓" feedback, keyed by preset guid (or '__editor__').
  const [copiedKey, setCopiedKey] = useState(null);
  const dragSrcIdx = useRef(null);

  // Copy one preset as Fusion-paste JSON (see fusionExport). `key` drives the
  // transient "Copied" feedback; the preset object is normalized through the
  // real Fusion path so it pastes straight into Fusion.
  const copyForFusion = async (preset, key) => {
    try {
      await copyPresetToClipboard(tool, preset);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(k => (k === key ? null : k)), 1600);
    } catch { /* clipboard blocked — no-op */ }
  };
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
    // New milling presets default to the NEW (strategy) format: give them a
    // Fusion `strategies` object so the editor opens on the strategy picker, not
    // the legacy Operation dropdown. A copy of a preset that was ALREADY new
    // format keeps its selected strategies; a copy of an old-format preset (or a
    // blank/ref one) starts new-format with an empty selection, its bucket seeded
    // from the operation. Hole-making/turning are untouched (no strategy UI).
    if (isMillingType && !isNewFormatPreset(np)) {
      // A fresh preset with no operation defaults to the Rough bucket (the usual
      // first operation); a copy keeps whatever operation its source carried.
      if (!np.operation_type) np.operation_type = 'rough';
      np.strategies = buildStrategies(opTypeToBucket(np.operation_type), []);
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
                className={`chip machine-chip ${machineFilter === m.id ? 'active' : ''}`}
                style={{ '--badge-color': machineColor(m, machines) }}
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
                  onCopyFusion={() => copyForFusion(preset, preset.guid)}
                  copied={copiedKey === preset.guid}
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
            onCopyFusion={(draftPreset) => copyForFusion(draftPreset, '__editor__')}
            copied={copiedKey === '__editor__'}
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
  onEdit, onDelete, onCopyFusion, copied,
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
            <MachinePill label={linkedMachine.model} color={machineColor(linkedMachine, machines)} />
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
            <button
              className="btn btn-ghost btn-sm preset-card-copy"
              onClick={onCopyFusion}
              title="Copy this preset as Fusion JSON (paste into Fusion)"
            >
              {copied ? <Check size={12} /> : <Clipboard size={12} />}
            </button>
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
  onSave, onCancel, onDirtyChange, onCopyFusion, copied, isSaving,
}) {
  const isTap = toolType === 'tap';
  const isSpotDrill = toolType === 'spot drill';
  const isDrillFamily = !isTap && !isSpotDrill && HOLE_MAKING_TYPES.has(toolType);
  const isHoleMaking = isTap || isDrillFamily || isSpotDrill;
  const isTurning = TURNING_TYPES.has(toolType);
  const isMilling = !isHoleMaking && !isTurning;
  // Surface speed ↔ spindle speed is unit-dependent (ft/min vs m/min); the
  // v_c↔n formula needs the tool's unit or a mm tool's link is off by ~83×.
  const isMetricTool = lenUnit === 'mm';

  // Open-time fx state — which fields are linked (recomputed from a source) vs.
  // preserved. The clobber-safety rules (mathematically-locked pairs recompute;
  // independent followers whose stored value differs stay preserved) live in
  // initialPresetFx (src/utils/presetFx.js), locked by presetFx.test.js.
  const initialFx = initialPresetFx(preset, { isMilling, isSpotDrill, isTurning, isDrillFamily });
  const configMachines = shopSettings?.machines || [];
  const [fx, setFx] = useState(initialFx);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState(() => {
    const d = computeFormulaDraft({ ...preset }, initialFx, diameter, numberOfFlutes, isMetricTool);
    d.operation_type = preset.operation_type ?? parsePresetName(preset.name)?.opType ?? null;
    d.machine_id = preset.machine_id ?? null;
    d.job_ids = preset.job_ids ?? [];
    return d;
  });

  // ── Strategy state (new-format presets) ──────────────────────────────────────
  // Only milling tools carry toolpath strategies (turning/hole-making have their
  // own vocabularies, out of scope). `strategyFormat` distinguishes OLD presets
  // (operation lives in the name + operation_type; no strategies key) from NEW
  // ones (a Fusion `strategies` object). Convert flips old → new.
  const availableStrategies = strategiesForToolType(toolType);
  const [strategyFormat, setStrategyFormat] = useState(() => (isMilling && isNewFormatPreset(preset) ? 'new' : 'old'));
  // Initial bucket + selection. For a new-format preset read the populated
  // bucket; but when the selection is empty, readStrategyBucket can't tell which
  // bucket was intended (both arrays are empty), so fall back to operation_type
  // (a fresh preset seeds operation_type = 'rough' → Rough bucket).
  const initBucket = (() => {
    if (isNewFormatPreset(preset)) {
      const rb = readStrategyBucket(preset);
      if (rb.ids.length === 0 && preset.operation_type) {
        return { bucket: opTypeToBucket(preset.operation_type), ids: [] };
      }
      return rb;
    }
    return { bucket: opTypeToBucket(preset.operation_type), ids: [] };
  })();
  const [bucket, setBucket] = useState(initBucket.bucket);
  const [selected, setSelected] = useState(() => new Set(initBucket.ids));
  // Provenance: which selected strategies were chosen INDIVIDUALLY (the
  // "All strategies…" popout, a pinned single, or a Fusion import) vs. pulled in
  // by a quick group. Switching quick groups replaces the previous group's
  // members but NEVER touches individual/Fusion picks. Strategies loaded from a
  // preset are all treated as individual (they weren't chosen via a group here).
  const [individualIds, setIndividualIds] = useState(() => new Set(initBucket.ids));
  const [intensity, setIntensity] = useState(preset.intensity || 'normal');
  const [listOpen, setListOpen] = useState(false);
  // Fusion can put strategies in BOTH buckets (its picker is a Rough/Finish
  // matrix); this app models one bucket per preset. When a preset loads that
  // way, we DON'T silently collapse it: each bucket is shown/edited on its own
  // tab and the inactive bucket is preserved on save, with a warning shown.
  // Normal single-bucket presets keep the simple "switch moves the selection"
  // behavior (see changeBucket / syncStrategies below).
  const loadedDualBucket = isMilling && isNewFormatPreset(preset)
    && (preset.strategies?.roughing?.length > 0)
    && (preset.strategies?.finishing?.length > 0);

  // Small bore requires a Bore/Contour strategy (new format) and locks the bucket
  // to Finishing while active — the cross-section lock the mockup shows.
  const smallBoreAvailable = strategyFormat === 'new' && SMALL_BORE_STRATEGIES.some(id => selected.has(id));
  const smallBoreOn = !!draft.small_bore && smallBoreAvailable;
  const effectiveBucket = smallBoreOn ? 'finishing' : bucket;
  const modifier = nameModifier(effectiveBucket, intensity, smallBoreOn);
  const selectedList = availableStrategies.filter(s => selected.has(s.id));

  // Persist bucket + selection into the draft's Fusion-native strategies object
  // (new format only) and keep operation_type/name in sync with the bucket.
  // For a dual-bucket preset, the OTHER bucket's strategies are carried through
  // unchanged (never wiped); for a normal single-bucket preset only the active
  // bucket is written.
  const syncStrategies = (nextBucket, nextSet) => {
    touch();
    setDraft(d => {
      const op = bucketToOpType(nextBucket);
      const nd = { ...d, operation_type: op, name: composeName(d, assemblyId, op) };
      if (strategyFormat === 'new') {
        nd.strategies = writeBucketStrategies(nextBucket, [...nextSet], d.strategies, loadedDualBucket);
      }
      return nd;
    });
  };
  // Switching Rough/Finish: a normal one-bucket preset MOVES the selection to
  // the new bucket (its strategies aren't inherently rough or finish). A
  // dual-bucket Fusion preset instead shows each bucket's OWN strategies, so
  // switching reveals the other set rather than moving the current one.
  const changeBucket = (b) => {
    setBucket(b);
    if (loadedDualBucket) {
      const forB = new Set(draft.strategies?.[b] || []);
      setSelected(forB);
      setIndividualIds(new Set(forB));   // a bucket's loaded strategies are individual/Fusion
      syncStrategies(b, forB);
    } else {
      syncStrategies(b, selected);       // carry the current selection to the new bucket
    }
  };
  // Individual pick (popout / pinned single). Toggles the strategy AND records
  // it as individual, so a later group switch won't drop it.
  const toggleStrategy = (id) => {
    setIndividualIds(prevInd => {
      const nextInd = new Set(prevInd);
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(id)) { next.delete(id); nextInd.delete(id); }
        else {
          next.add(id); nextInd.add(id);
          if (AUTO_LINK_PAIR.includes(id)) AUTO_LINK_PAIR.forEach(m => { next.add(m); nextInd.add(m); });
        }
        syncStrategies(bucket, next);
        return next;
      });
      return nextInd;
    });
  };
  // Quick group click. PLAIN click switches groups — the previous group's
  // members are replaced by this one's — but INDIVIDUAL / Fusion picks are kept.
  // SHIFT-click combines groups (toggle this group on/off, keep others). Neither
  // switches the Rough/Finish bucket (a deliberate, user-controlled choice).
  const toggleQuickGroup = (group, additive) => {
    const wasFull = group.members.every(id => selected.has(id));
    setSelected(prev => {
      let next;
      if (additive) {
        // Combine: toggle only this group's members; keep everything else. When
        // toggling off, individual members stay (they weren't the group's to remove).
        next = new Set(prev);
        if (wasFull) group.members.forEach(id => { if (!individualIds.has(id)) next.delete(id); });
        else group.members.forEach(id => next.add(id));
      } else {
        // Switch: keep individual/Fusion picks, drop the previous group's
        // members, add this group's. Clicking the active group again clears it.
        next = new Set(individualIds);
        if (!wasFull) group.members.forEach(id => next.add(id));
      }
      syncStrategies(bucket, next);
      return next;
    });
  };
  const setIntensityVal = (v) => { setIntensity(v); touch(); setDraft(d => ({ ...d, intensity: v })); };
  const convertToNew = () => {
    setStrategyFormat('new');
    touch();
    setDraft(d => ({ ...d, strategies: buildStrategies(bucket, [...selected]) }));
  };

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
    setDraft(d => computeFormulaDraft(d, fxRef.current, diameter, numberOfFlutes, isMetricTool));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diameter, numberOfFlutes]);

  // Plain setter for non-formula fields (name, material, checkboxes, coolant,
  // and the independent feedrate fields that have no formula linkage).
  const set = (k, v) => { touch(); setDraft(d => ({ ...d, [k]: v })); };
  // Plunge for milling / spot drill is a plain value (no f_n field), but retract
  // still follows it unless overridden — so cascade retract here too.
  const setPlunge = (v) => { touch(); setDraft(d => {
    const nd = { ...d, v_f_plunge: v };
    if (fx.v_f_retract !== 'manual') nd.v_f_retract = v;
    return nd;
  }); };

  // Re-link a one-directional follower to its source (lead-in/out + transition →
  // cutting feed; n_ramp → spindle). Sets it back to formula and snaps its value
  // to the source. Only the re-linked field is touched.
  const relinkField = (field) => {
    touch();
    setFx(f => ({ ...f, [field]: 'formula' }));
    setDraft(d => ({
      ...d,
      [field]: field === 'n_ramp'
        ? roundForField('n_ramp', d.n ?? 0)
        : roundForField(field, d.v_f ?? 0),
    }));
  };

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
      newDraft.v_c   = roundForField('v_c',   rpmToSFM(n, diameter, isMetricTool));
      newFx.v_c      = 'formula';
      if (fx.n_ramp !== 'manual') {
        newDraft.n_ramp = roundForField('n_ramp', n);
        newFx.n_ramp    = 'formula';
      }
    } else if (field === 'v_c') {
      n = roundForField('n', sfmToRPM(value ?? 0, diameter, isMetricTool));
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
  // The RPM sliders' default ceiling maps to a machine's max spindle speed:
  // the preset's linked machine if it has one, else the shop's default machine
  // (so an unlinked preset still gets a sane ceiling), else the 16000 fallback
  // in SLIDER_RANGES. Only a real positive number counts — a machine with no
  // max_rpm set doesn't override the fallback. Soft max can still stretch past.
  const linkedMachineRpm = configMachines.find(m => m.id === draft.machine_id)?.max_rpm;
  const defaultMachineRpm = configMachines.find(m => m.id === shopSettings?.default_machine_id)?.max_rpm;
  const machineMaxRpm = (Number(linkedMachineRpm) > 0 ? Number(linkedMachineRpm)
    : Number(defaultMachineRpm) > 0 ? Number(defaultMachineRpm)
    : undefined);

  return (
    <div
      ref={containerRef}
      className="preset-editor-inline"
      style={accentColor ? { borderTop: `3px solid ${accentColor}` } : undefined}
    >
      {/* Header — name + tool readout + Save/✕ */}
      <div className="pe-header">
        <input
          className="field-input preset-name-input"
          value={draft.name || ''}
          onChange={e => set('name', e.target.value)}
          placeholder="Preset name"
          autoFocus
        />
        {isMilling && strategyFormat === 'new' && <ModifierBadge modifier={modifier} bucket={effectiveBucket} />}
        <span className="pe-tool-readout" title="Tool diameter · flute count">
          <span className="dia">⌀</span>{diameter ?? '—'}{numberOfFlutes ? ` · ${numberOfFlutes}FL` : ''}
        </span>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => onCopyFusion?.(draft)}
          disabled={isSaving}
          title="Copy this preset as Fusion JSON (paste into Fusion)"
        >
          {copied ? <Check size={13} /> : <Clipboard size={13} />} Copy for Fusion
        </button>
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

      {/* Builder body (left) + calculated-results rail (right). The rail is a
          distinct, connected area for computed badges (MRR now, physics later)
          — it also pulls MRR out of the Passes column, killing its dead space. */}
      <div className="pe-layout">
      <div className="pe-body">
      {/* Setup row — what this preset IS (material, operation, assembly) */}
      <div className="pe-row">
      {/* Material — picked from the Materials library via the CAM Preset picker
          (search "6061"/"1018" → its CAM preset, or browse the group pills).
          Stored as material.query = CAM preset name, else group label. The CAM
          preset name is the Fusion speed/feed preset group this maps to. */}
      <EditorSection label="Material" accent={PE_VIOLET}>
        <div>
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
        </div>
        {/* No "Filter by type" select — material.category is still written to
            the draft (Fusion needs it), derived from the picked CAM preset via
            materialCategory(query) in the picker's onSelect / clearMat. */}
      </EditorSection>

      {/* Operation & Assembly — drive the convention preset name */}
      {/* Assembly & Machine — the Operation control moved to the Strategy
          section below (old format keeps the dropdown; new format uses the
          Rough/Finish bucket toggle). */}
      <EditorSection label="Assembly & Machine" accent={PE_VIOLET}>
        <div className="pe-grid pe-grid--3">
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
      </EditorSection>
      </div>

      {/* Strategy / Operation — milling + turning (hole-making has no operation).
          Milling old-format presets keep the Operation dropdown + a Convert
          button; new-format milling gets the full strategy picker. Turning keeps
          the Operation dropdown only (its strategy vocabulary is out of scope).
          The bucket / operation drives operation_type + the preset name. */}
      {!isHoleMaking && (
        <EditorSection
          label={isMilling ? 'Strategy' : 'Operation'}
          accent={isMilling && strategyFormat === 'new' ? bucketColor(effectiveBucket) : PE_VIOLET}
          right={isMilling && (strategyFormat === 'old'
            ? <button type="button" className="btn btn-ghost btn-sm" onClick={convertToNew} title="Add Fusion toolpath strategies to this preset">Convert to new</button>
            : <button type="button" className="btn btn-ghost btn-sm" onClick={() => setListOpen(true)}>All strategies…</button>)}
        >
          {(!isMilling || strategyFormat === 'old') ? (
            <div className="pe-grid pe-grid--3">
              <FGroup label="Operation">
                <select
                  className="field-input"
                  value={draft.operation_type || ''}
                  onChange={e => {
                    const op = e.target.value || null;
                    touch();
                    if (op === 'rough' || op === 'finish') setBucket(opTypeToBucket(op));
                    setDraft(d => ({ ...d, operation_type: op, name: composeName(d, assemblyId, op) }));
                  }}
                >
                  <option value="">—</option>
                  {OP_TYPES.map(o => <option key={o.value} value={o.value}>{o.word}</option>)}
                </select>
              </FGroup>
              {isMilling && (
                <div className="pe-strat-oldhint text-xs text-sub">
                  Newer Fusion presets carry a toolpath strategy (2D Adaptive, Bore, …).
                  &nbsp;<b>Convert to new</b> to pick strategies here — Fusion reads both formats.
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="pe-strat-top">
                <FGroup label="Operation">
                  <BucketToggle value={effectiveBucket} onChange={changeBucket} locked={smallBoreOn} />
                  <div className={`pe-strat-lock${smallBoreOn ? '' : ' pe-strat-lock--hidden'}`}>
                    Locked to Finish by Small bore (in Feedrates)
                  </div>
                </FGroup>
                <FGroup label="Intensity">
                  <IntensityMeter value={intensity} bucket={effectiveBucket} onChange={setIntensityVal} />
                </FGroup>
              </div>

              <FGroup label="Quick groups — click switches group, shift-click combines; individual picks stay">
                <div className="pe-strat-quick">
                  {QUICK_GROUPS.map(g => (
                    <QuickGroupButton key={g.key} group={g} selected={selected} onClick={e => toggleQuickGroup(g, e.shiftKey)} />
                  ))}
                  <span className="pe-strat-divider" />
                  {PINNED_STRATEGIES.map(id => {
                    const s = strategyById(id);
                    return s && <PinnedStrategyButton key={id} strategy={s} selected={selected} bucket={effectiveBucket} onClick={() => toggleStrategy(id)} />;
                  })}
                </div>
              </FGroup>

              <div className="pe-strat-selected">
                {selectedList.length === 0
                  ? <span className="text-xs text-sub">No strategies selected — Fusion may reject this preset</span>
                  : selectedList.map(s => <StrategyPill key={s.id} strategy={s} bucket={effectiveBucket} onRemove={() => toggleStrategy(s.id)} />)}
              </div>

              {/* Dual-bucket Fusion preset: this app uses one bucket per preset,
                  but never wipes the other — surface it (informed, not blocked). */}
              {loadedDualBucket && (
                <div className="pe-strat-dual">
                  <AlertTriangle size={13} />
                  <span>
                    This preset has both <b>Rough</b> and <b>Finish</b> strategies (from Fusion).
                    This app edits one bucket at a time — switch the Rough/Finish toggle to see each set.
                    Both are kept on save; neither is wiped.
                  </span>
                </div>
              )}
            </>
          )}
        </EditorSection>
      )}

      {/* Speed + Passes row */}
      <div className="pe-row">
      <EditorSection label="Speed" accent="var(--blue)">
        <LinkedSlider
          field="n" label="Spindle speed" unit="RPM"
          value={draft.n} fxState={fx.n} max={machineMaxRpm}
          onChange={v => handleNumChange('n', v)}
        />
        <LinkedSlider
          field="v_c" label="Surface speed" unit={speedUnit}
          value={draft.v_c} fxState={fx.v_c} metric={isMetricTool}
          onChange={v => handleNumChange('v_c', v)}
        />
        {!isHoleMaking && (
          <LinkedSlider
            field="n_ramp" label="Ramp spindle" unit="RPM"
            value={draft.n_ramp} fxState={fx.n_ramp} max={machineMaxRpm}
            onChange={v => handleNumChange('n_ramp', v)}
            onRelink={() => relinkField('n_ramp')} relinkLabel="spindle speed"
          />
        )}
      </EditorSection>

      {/* Passes & Linking — milling only */}
      {isMilling && (
      <EditorSection label="Passes & Linking" accent="var(--blue)">
        <div className="pe-stack" style={{ gap: 14 }}>
          <FactorSlider
            label="Stepdown"
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
            accent="var(--blue)"
          />
          <FactorSlider
            label="Stepover"
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
            accent="var(--blue)"
          />
          {/* MRR moved to the Results rail on the right (a calculated-result
              badge). It reads stepover × stepdown × cutting feed live. */}
        </div>
      </EditorSection>
      )}
      </div>

      {/* Feedrates — full-width section (the tallest, so it gets the whole row) */}
      {/* Feedrates — milling: two clusters, CUTTING and PLUNGE & RAMP. Plunge
          routes through handleNumChange (not setPlunge) because milling now
          shows the Feed-per-rev slider as its paired entry point (mockup) —
          the fx cascade keeps whichever of the two was touched last. */}
      {isMilling && (
        <EditorSection label="Feedrates" accent="var(--blue)">
          <div className="pe-feed-grid">
            <div>
              <div className="pe-cluster-label">CUTTING</div>
              <LinkedSlider
                field="f_z" label="Feed per tooth" unit={lenUnit}
                value={draft.f_z} fxState={fx.f_z} metric={isMetricTool}
                warning={noSpeed ? 'Set spindle speed first' : undefined}
                onChange={v => handleNumChange('f_z', v)}
              />
              <LinkedSlider
                field="v_f" label="Cutting feedrate" unit={feedUnit}
                value={draft.v_f} fxState={fx.v_f} metric={isMetricTool}
                warning={noSpeed ? 'Set spindle speed first' : undefined}
                onChange={v => handleNumChange('v_f', v)}
              />
              <LinkedSlider
                field="v_f_leadIn" label="Lead-in" unit={feedUnit}
                value={draft.v_f_leadIn} fxState={fx.v_f_leadIn} metric={isMetricTool} compact
                onChange={v => handleNumChange('v_f_leadIn', v)}
                onRelink={() => relinkField('v_f_leadIn')} relinkLabel="cutting feedrate"
              />
              <LinkedSlider
                field="v_f_leadOut" label="Lead-out" unit={feedUnit}
                value={draft.v_f_leadOut} fxState={fx.v_f_leadOut} metric={isMetricTool} compact
                onChange={v => handleNumChange('v_f_leadOut', v)}
                onRelink={() => relinkField('v_f_leadOut')} relinkLabel="cutting feedrate"
              />
              <LinkedSlider
                field="v_f_transition" label="Transition" unit={feedUnit}
                value={draft.v_f_transition} fxState={fx.v_f_transition} metric={isMetricTool} compact
                onChange={v => handleNumChange('v_f_transition', v)}
                onRelink={() => relinkField('v_f_transition')} relinkLabel="cutting feedrate"
              />
            </div>
            <div>
              <div className="pe-cluster-label">PLUNGE &amp; RAMP</div>
              <LinkedSlider
                field="v_f_plunge" label="Plunge feedrate" unit={feedUnit}
                value={draft.v_f_plunge} fxState={fx.v_f_plunge} metric={isMetricTool}
                onChange={v => handleNumChange('v_f_plunge', v)}
              />
              <LinkedSlider
                field="f_n" label="Feed per rev" unit={`${lenUnit}/rev`}
                value={draft.f_n} fxState={fx.f_n} metric={isMetricTool}
                onChange={v => handleNumChange('f_n', v)}
              />
              <LinkedSlider
                field="v_f_ramp" label="Ramp feedrate" unit={feedUnit}
                value={draft.v_f_ramp} metric={isMetricTool} compact
                onChange={v => set('v_f_ramp', v)}
              />
              <LinkedSlider
                field="ramp_angle" label="Ramp angle" unit="°"
                value={draft['ramp-angle']} compact
                onChange={v => set('ramp-angle', v)}
              />
            </div>
          </div>
          {/* Small bore lives HERE — it compensates the chip load above, and
              applies live through the cascade. Available only when a Bore/Contour
              strategy is selected (new format); turning it on locks the Strategy
              bucket to Finishing (handled via smallBoreOn / effectiveBucket). */}
          <SmallBoreRow
            diameter={diameter} flutes={numberOfFlutes} rpm={draft.n ?? 0}
            active={smallBoreOn} available={smallBoreAvailable}
            onToggle={(on) => {
              touch();
              setDraft(d => {
                const nd = { ...d, small_bore: on };
                // Seed the uncompensated base from the current f_z the first
                // time comp is turned on, so it has something to compensate.
                if (on && (nd.f_z_base == null || nd.f_z_base === '')) nd.f_z_base = d.f_z ?? 0;
                // Turning comp off restores the uncompensated feed.
                if (!on && nd.f_z_base != null) return { ...nd, f_z: nd.f_z_base };
                return nd;
              });
            }}
            boreDia={draft.small_bore_diameter ?? ''} setBoreDia={v => set('small_bore_diameter', v)}
            baseFz={draft.f_z_base} setBaseFz={v => set('f_z_base', v === '' ? null : parseFloat(v))}
            actualFz={draft.f_z}
            onCompute={v => handleNumChange('f_z', v)}
            accent={accentColor || 'var(--blue)'} lenUnit={lenUnit}
          />
        </EditorSection>
      )}

      {/* Feedrates — spot drill: milling-style cutting feed + plunge/retract,
          no feed/rev or ramp angle (see normalizePreset's isSpotDrill branch) */}
      {isSpotDrill && (
        <EditorSection label="Feedrates" accent="var(--blue)">
          <div className="pe-feed-grid">
            <div>
              <div className="pe-cluster-label">CUTTING</div>
              <LinkedSlider
                field="f_z" label="Feed per tooth" unit={lenUnit}
                value={draft.f_z} fxState={fx.f_z} metric={isMetricTool}
                warning={noSpeed ? 'Set spindle speed first' : undefined}
                onChange={v => handleNumChange('f_z', v)}
              />
              <LinkedSlider
                field="v_f" label="Cutting feedrate" unit={feedUnit}
                value={draft.v_f} fxState={fx.v_f} metric={isMetricTool}
                warning={noSpeed ? 'Set spindle speed first' : undefined}
                onChange={v => handleNumChange('v_f', v)}
              />
              <LinkedSlider
                field="v_f_leadIn" label="Lead-in" unit={feedUnit}
                value={draft.v_f_leadIn} fxState={fx.v_f_leadIn} metric={isMetricTool} compact
                onChange={v => handleNumChange('v_f_leadIn', v)}
                onRelink={() => relinkField('v_f_leadIn')} relinkLabel="cutting feedrate"
              />
              <LinkedSlider
                field="v_f_leadOut" label="Lead-out" unit={feedUnit}
                value={draft.v_f_leadOut} fxState={fx.v_f_leadOut} metric={isMetricTool} compact
                onChange={v => handleNumChange('v_f_leadOut', v)}
                onRelink={() => relinkField('v_f_leadOut')} relinkLabel="cutting feedrate"
              />
              <LinkedSlider
                field="v_f_transition" label="Transition" unit={feedUnit}
                value={draft.v_f_transition} fxState={fx.v_f_transition} metric={isMetricTool} compact
                onChange={v => handleNumChange('v_f_transition', v)}
                onRelink={() => relinkField('v_f_transition')} relinkLabel="cutting feedrate"
              />
            </div>
            <div>
              <div className="pe-cluster-label">PLUNGE &amp; RAMP</div>
              {/* Plunge stays on setPlunge — spot drill has no feed-per-rev
                  field, and setPlunge cascades the retract follower. */}
              <LinkedSlider
                field="v_f_plunge" label="Plunge feedrate" unit={feedUnit}
                value={draft.v_f_plunge} metric={isMetricTool}
                warning={noSpeed ? 'Set spindle speed first' : undefined}
                onChange={v => setPlunge(v)}
              />
              <LinkedSlider
                field="v_f_retract" label="Retract feedrate" unit={feedUnit}
                value={draft['v_f_retract']} fxState={fx.v_f_retract} metric={isMetricTool}
                onChange={v => handleNumChange('v_f_retract', v)}
              />
              <LinkedSlider
                field="v_f_ramp" label="Ramp feedrate" unit={feedUnit}
                value={draft.v_f_ramp} metric={isMetricTool} compact
                onChange={v => set('v_f_ramp', v)}
              />
            </div>
          </div>
        </EditorSection>
      )}

      {/* Feedrates — turning/boring */}
      {isTurning && (
        <EditorSection label="Feedrates" accent="var(--blue)">
          <div className="pe-feed-grid">
            <LinkedSlider
              field="v_f" label="Cutting feedrate" unit={feedUnit}
              value={draft.v_f} fxState={fx.v_f} metric={isMetricTool}
              warning={noSpeed ? 'Set spindle speed first' : undefined}
              onChange={v => handleNumChange('v_f', v)}
            />
            <LinkedSlider
              field="f_n" label="Feed per rev" unit={`${lenUnit}/rev`}
              value={draft.f_n} fxState={fx.f_n} metric={isMetricTool}
              onChange={v => handleNumChange('f_n', v)}
            />
            <LinkedSlider
              field="v_f_plunge" label="Plunge feedrate" unit={feedUnit}
              value={draft.v_f_plunge} fxState={fx.v_f_plunge} metric={isMetricTool}
              onChange={v => handleNumChange('v_f_plunge', v)}
            />
          </div>
        </EditorSection>
      )}

      {/* Feedrates — drill family: plunge + retract + feed/rev */}
      {isDrillFamily && (
        <EditorSection label="Feedrates" accent="var(--blue)">
          <div className="pe-feed-grid">
            <LinkedSlider
              field="v_f_plunge" label="Plunge feedrate" unit={feedUnit}
              value={draft.v_f_plunge} fxState={fx.v_f_plunge} metric={isMetricTool}
              warning={noSpeed ? 'Set spindle speed first' : undefined}
              onChange={v => handleNumChange('v_f_plunge', v)}
            />
            <LinkedSlider
              field="v_f_retract" label="Retract feedrate" unit={feedUnit}
              value={draft['v_f_retract']} fxState={fx.v_f_retract} metric={isMetricTool}
              onChange={v => handleNumChange('v_f_retract', v)}
            />
            <LinkedSlider
              field="f_n" label="Feed per rev" unit={`${lenUnit}/rev`}
              value={draft.f_n} fxState={fx.f_n} metric={isMetricTool}
              onChange={v => handleNumChange('f_n', v)}
            />
          </div>
        </EditorSection>
      )}

      {/* Footer row — Coolant + Jobs, compact */}
      <div className="pe-row">
      <EditorSection label="Coolant" accent="var(--text-sub)">
        <select
          className="field-input"
          value={draft['tool-coolant'] || 'flood'}
          onChange={e => set('tool-coolant', e.target.value)}
        >
          {COOLANT_OPTS.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </EditorSection>

      {/* Jobs — reference links to the jobs this preset was proven on. Adding
          resolves against the shop-wide jobs.json registry (same job entered
          twice = one record); saved with the preset via preset_meta. */}
      <EditorSection label="Jobs" accent="var(--text-sub)">
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
      </EditorSection>
      </div>
      </div>

      {/* ── Results rail — calculated-result badges ─────────────────────────── */}
      <div className="pe-results">
        <div className="pe-results-label">Results</div>
        {isMilling ? (
          <MRRIndicator
            ae={draft['use-stepover'] ? draft.stepover : 0}
            ap={draft['use-stepdown'] ? draft.stepdown : 0}
            vf={draft.v_f}
            lenUnit={lenUnit}
            accent="var(--blue)"
          />
        ) : (
          <div className="pe-results-empty">No calculated results for this tool type yet.</div>
        )}
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

      {listOpen && (
        <StrategyListPopout
          available={availableStrategies}
          selected={selected}
          onToggle={toggleStrategy}
          bucket={effectiveBucket}
          onClose={() => setListOpen(false)}
        />
      )}
    </div>
  );
}

// ── FactorSlider — stepdown / stepover as a percentage of a reference dim ─────
// Stepdown/stepover are decided as a PERCENTAGE of a reference dimension
// (stepdown of flute length, stepover of diameter), so the slider drives the
// percent and reads out as one (86%, not 0.86); never above 100%. Two entry
// points as a driving/driven pair, exactly like LinkedSlider: drag/type the %
// (1% steps) and the inch value follows (fx badge on it); type the inch value
// and the % follows. Whichever was touched last drives.
//
// The DATA MODEL stays absolute — `value`/`onChange` are the raw inch value
// (draft.stepdown / draft.stepover); percent is a UI convenience only and never
// leaks into the preset. The triple-sync invariant (use-* boolean + numeric +
// expression) is handled downstream by normalizePreset on save, unchanged.
function FactorSlider({ label, value, onChange, refDim, refLabel, lenUnit, enabled, onToggle, accent }) {
  const trackRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [inchDraft, setInchDraft] = useState(null);
  // Which side the user last drove. Percent leads by default — it's the
  // decision a machinist actually makes; inches are what falls out.
  const [driver, setDriver] = useState('pct');

  const factor = (refDim > 0 && value > 0) ? Math.min(1, value / refDim) : 0;
  const pct = Math.round(factor * 100);
  const abs = refDim > 0 ? factor * refDim : 0;

  const setPct = (p) => {
    setDriver('pct');
    const f = Math.min(1, Math.max(0, (Number(p) || 0) / 100));
    onChange(parseFloat((f * refDim).toFixed(6)));
  };
  const setInch = (v) => {
    setDriver('inch');
    onChange(Math.max(0, Number(v) || 0));
  };
  const pctFromPointer = (clientX) => {
    const rect = trackRef.current.getBoundingClientRect();
    const r = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(r * 100);
  };

  // Non-passive wheel listener (same rationale as LinkedSlider) — one notch = 1%.
  const wheelState = useRef({});
  wheelState.current = { pct, enabled };
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (!wheelState.current.enabled) return;
      const axis = Math.abs(e.deltaX) >= Math.abs(e.shiftKey ? e.deltaY : 0) ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
      if (!axis || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      setPct(Math.max(0, Math.min(100, wheelState.current.pct + (axis > 0 ? 1 : -1))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`pe-factor${enabled ? '' : ' pe-factor--off'}${driver === 'inch' ? ' pe-factor--inchdrv' : ''}`}
      style={accent ? { '--ls-accent': accent } : undefined}
    >
      {/* Row 1 — checkbox + label | % track | percent input */}
      <label className="pe-factor-label">
        <input type="checkbox" checked={enabled} onChange={e => onToggle(e.target.checked)} />
        <span className="lslider-name">{label}</span>
        <span className="nfield-fx"><span className={`fx-badge${driver === 'inch' ? '' : ' fx-badge--hidden'}`}>fx</span></span>
      </label>
      <div
        ref={trackRef}
        className={`lslider-track pe-factor-track${dragging ? ' lslider-track--dragging' : ''}`}
        onPointerDown={e => { if (!enabled) return; e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); setPct(pctFromPointer(e.clientX)); }}
        onPointerMove={e => { if (dragging) setPct(pctFromPointer(e.clientX)); }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        <div className="lslider-rail" />
        <div className="lslider-fill" style={{ width: `${pct}%`, ...(dragging ? { transition: 'none' } : {}) }} />
        <div className={`lslider-handle${dragging ? ' lslider-handle--drag' : ''}`} style={{ left: `calc(${pct}% - 7px)`, ...(dragging ? { transition: 'none' } : {}) }} />
      </div>
      <div className="lslider-num">
        <input
          className="field-input td-noSpin" type="number" step="1" min="0" max="100"
          value={pct} disabled={!enabled}
          onChange={e => setPct(e.target.value)}
        />
        <span className="lslider-unit">%</span>
      </div>

      {/* Row 2 — "of {refLabel}" | ref-dim readout | inch input */}
      <span className="pe-factor-of">
        <span>of {refLabel}</span>
        <span className="nfield-fx"><span className={`fx-badge${driver === 'pct' ? '' : ' fx-badge--hidden'}`}>fx</span></span>
      </span>
      <span className="pe-factor-ref">{refDim > 0 ? `${refDim.toFixed(4)} ${lenUnit}` : '—'}</span>
      <div className="lslider-num">
        <input
          className="field-input td-noSpin" type="number" step="0.001" min="0" max={refDim || undefined}
          value={inchDraft !== null ? inchDraft : abs.toFixed(4)}
          disabled={!enabled}
          onFocus={() => setInchDraft(abs.toFixed(4))}
          onBlur={() => setInchDraft(null)}
          onChange={e => { setInchDraft(e.target.value); setInch(e.target.value); }}
        />
        <span className="lslider-unit">{lenUnit}</span>
      </div>
    </div>
  );
}

// ── Result badge (Results rail) — a periodic-table-style calculated result ────
// A rounded tile: small label top-left, big value centred, unit at the bottom.
// The reusable shape every rail badge (MRR now, physics later) uses.
function ResultBadge({ label, value, unit, live, accent, hint }) {
  return (
    <div
      className={`pe-result${live ? ' pe-result--live' : ''}`}
      style={accent ? { '--ls-accent': accent } : undefined}
      title={hint}
    >
      <span className="pe-result-label">{label}</span>
      <span className="pe-result-value">{value}</span>
      <span className="pe-result-unit">{unit}</span>
    </div>
  );
}

// ── MRR — material removal rate ───────────────────────────────────────────────
// The volume of metal coming off per minute: radial width × axial depth × feed.
// Uses the ABSOLUTE step values (0 when a step is toggled off) and the live
// cutting feedrate; math shown on hover. Rendered as a Results-rail badge.
//   ae = stepover (radial width, len)  ap = stepdown (axial depth, len)
//   vf = cutting feed (len/min)  →  MRR = ae × ap × vf  (len³/min)
function MRRIndicator({ ae, ap, vf, lenUnit, accent }) {
  const a = Number(ae) || 0, p = Number(ap) || 0, f = Number(vf) || 0;
  const mrr = a * p * f;
  const live = mrr > 0;
  return (
    <ResultBadge
      label="MRR" live={live} accent={accent}
      value={live ? mrr.toFixed(3) : '—'} unit={`${lenUnit}³/min`}
      hint={`Material removal rate = radial width ${a.toFixed(4)} ${lenUnit} × axial depth ${p.toFixed(4)} ${lenUnit} × feed ${f.toFixed(1)} ${lenUnit}/min`}
    />
  );
}

// ── Small Bore — chip-load compensation, lives INSIDE Feedrates ───────────────
// It compensates the chip load, so it sits under the cutting-feed cluster as two
// FIXED-height rows (never pops open downward as you type). Compensation applies
// LIVE through the normal cascade: change the bore Ø or the base fz and the
// compensated fz is pushed straight into f_z (via onCompute → handleNumChange),
// so cutting feed follows and dims like any other edit — no Apply button.
//
// baseFz (persisted as f_z_base) is the UNCOMPENSATED chip load the comp works
// from; using it (not the already-compensated f_z) is what keeps reopening a
// saved small-bore preset from shrinking the feed a little more each time.
const SB_OVERRIDE_EPS = 5e-6;   // half a 5-decimal f_z step
function SmallBoreRow({
  diameter, flutes, rpm, active, available, onToggle,
  boreDia, setBoreDia, baseFz, setBaseFz, actualFz, onCompute, accent, lenUnit,
}) {
  const comp = boreCompensation(diameter, boreDia);
  const z = flutes || 1;
  const baseFzNum = parseFloat(baseFz) || 0;
  const currentVf = rpm * z * baseFzNum;
  const compFz = comp && !comp.error ? baseFzNum * comp.factor : null;
  const compVf = compFz !== null ? rpm * z * compFz : null;
  const minorEffect = comp && !comp.error && comp.factor > 0.8;
  const live = active && comp && !comp.error;

  // Override detection — the user moved the feed/fz slider after comp landed.
  // Small bore doesn't fight them, it just stops claiming credit: the computed
  // value is struck through and the value in effect is flagged amber.
  const suggested = live ? roundForField('f_z', compFz) : null;
  const inEffect = actualFz == null ? null : roundForField('f_z', actualFz);
  const overridden = live && inEffect !== null && Math.abs(inEffect - suggested) > SB_OVERRIDE_EPS;
  const effVf = overridden ? rpm * z * inEffect : compVf;

  // Live apply — push compensated fz through the cascade when the bore or the
  // base fz changes. SKIP the first render: a reopened preset's saved f_z is
  // already compensated (== f_z_base × factor), so re-firing on mount would be a
  // no-op at best and would mark the editor dirty at worst. Only user changes to
  // active / baseFz / boreDia recompute. draft.f_z is deliberately NOT a dep, or
  // dragging the fz slider would fight the effect.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (live) onCompute(roundForField('f_z', compFz));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, baseFz, boreDia]);

  return (
    <div className="pe-sb" style={accent ? { '--ls-accent': accent } : undefined}>
      {/* Row 1 — toggle, geometry, comp %, status */}
      <div className="pe-sb-row1">
        <button
          type="button"
          className={`pe-sb-toggle${active ? ' pe-sb-toggle--on' : ''}`}
          onClick={() => available && onToggle(!active)}
          disabled={!available}
        >
          <SmallBoreIcon size={18} />
          Small bore
        </button>

        <div className={`pe-sb-geo${active ? '' : ' pe-sb-geo--off'}`}>
          <span className="pe-sb-cell"><span className="pe-sb-tag">TOOL</span><span className="font-mono"><span className="dia">⌀</span>{diameter}</span></span>
          <span className="pe-sb-cell">
            <span className="pe-sb-tag">BORE</span><span className="font-mono text-sub"><span className="dia">⌀</span></span>
            <input
              className="field-input td-noSpin pe-sb-bore" type="number" step="0.001"
              value={boreDia} onChange={e => setBoreDia(e.target.value)}
              disabled={!active} placeholder="0.485"
            />
            <span className="pe-sb-unit">{lenUnit}</span>
          </span>
          <span className="pe-sb-cell">
            <span className="pe-sb-tag">COMP</span>
            <span className="pe-sb-comp" style={{ color: live ? 'var(--ls-accent)' : 'var(--text-sub)' }}>
              {live ? `${(comp.factor * 100).toFixed(1)}%` : '—'}
            </span>
            {live && (
              <InfoTip text={`Tool centre orbits ⌀${comp.centerCircle.toFixed(3)} while the edge sweeps ⌀${parseFloat(boreDia).toFixed(3)} — the edge travels ${comp.ratio.toFixed(2)}× farther per rev, so it sees ${comp.ratio.toFixed(2)}× the programmed chip load. Arc compensation only; radial chip thinning partially offsets it and is left to your judgment.`} />
            )}
          </span>
        </div>

        <span className="pe-sb-status">
          {!available
            ? 'Requires Bore or Contour strategy'
            : active && comp?.error
              ? <span className="text-danger">{comp.error}</span>
              : minorEffect
                ? 'Minor at this ratio — may not be needed'
                : ' '}
        </span>
      </div>

      {/* Row 2 — before → after readout; amber when overridden */}
      <div className={`pe-sb-row2${overridden ? ' pe-sb-row2--override' : ''}${live ? '' : ' pe-sb-row2--idle'}`}>
        <span className="pe-sb-cell">
          <span className="pe-sb-tag">FZ START</span>
          <input
            className="field-input td-noSpin pe-sb-basefz" type="number" step="0.0001"
            value={baseFz ?? ''} onChange={e => setBaseFz(e.target.value)}
            disabled={!active} placeholder="0.0008"
          />
          <span className="text-sub">→</span>
          <span className="font-mono pe-sb-compfz" style={overridden ? { textDecoration: 'line-through', color: 'var(--text-sub)' } : {}}>
            {live ? compFz.toFixed(4) : '—'}
          </span>
          {overridden && <span className="font-mono pe-sb-override-val">{inEffect.toFixed(4)}</span>}
          <span className="pe-sb-unit">{lenUnit}</span>
        </span>

        <span className="pe-sb-cell">
          <span className="pe-sb-tag">FEED</span>
          <span className="font-mono text-sub">{currentVf.toFixed(2)}</span>
          <span className="text-sub">→</span>
          <span className="font-mono pe-sb-feed" style={overridden ? { color: 'var(--orange)' } : {}}>
            {live ? effVf.toFixed(2) : '—'}
          </span>
          <span className="pe-sb-unit">{lenUnit}/min</span>
        </span>

        <span className="pe-sb-row2-tail">
          {overridden ? (
            <>
              <span className="pe-sb-badge">OVERRIDDEN</span>
              <button type="button" className="btn btn-ghost btn-sm pe-sb-restore" onClick={() => onCompute(suggested)}>
                Restore {suggested.toFixed(4)}
              </button>
            </>
          ) : (
            <span className="text-sub pe-sb-applied">Applied live to feed per tooth</span>
          )}
        </span>
      </div>
    </div>
  );
}

// ── Strategy section (new-format presets) ─────────────────────────────────────
// Rough / Finish are the only two buckets (a preset is one or the other), each
// with its own accent color. bucket ↔ operation_type: roughing='rough',
// finishing='finish' — so the bucket drives the preset name's operation suffix
// exactly like the old Operation dropdown does.
const bucketColor = (b) => (b === 'roughing' ? 'var(--pe-rough)' : 'var(--pe-finish)');
const bucketToOpType = (b) => (b === 'roughing' ? 'rough' : 'finish');
const opTypeToBucket = (op) => (op === 'rough' ? 'roughing' : 'finishing');
const INTENSITIES = [
  { key: 'light', label: 'Light', dot: 4 },
  { key: 'normal', label: 'Normal', dot: 6 },
  { key: 'aggressive', label: 'Aggressive', dot: 9 },
];
// The name-modifier HINT (intensity is metadata-only this round — not folded
// into the composed name; shown as a live badge only).
function nameModifier(bucket, intensity, smallBore) {
  if (smallBore) return 'Small Bore';
  if (intensity === 'normal') return null;
  if (bucket === 'roughing') return intensity === 'aggressive' ? 'Fast' : 'Light';
  return intensity === 'light' ? 'Fine' : 'Fast';
}

function BucketToggle({ value, onChange, locked }) {
  return (
    <div className={`pe-bucket${locked ? ' pe-bucket--locked' : ''}`}>
      {[{ key: 'roughing', label: 'Rough' }, { key: 'finishing', label: 'Finish' }].map(o => (
        <button
          key={o.key} type="button"
          className={`pe-bucket-btn${value === o.key ? ' pe-bucket-btn--on' : ''}`}
          style={value === o.key ? { '--pe-b': bucketColor(o.key) } : undefined}
          onClick={() => !locked && onChange(o.key)}
        >{o.label}</button>
      ))}
    </div>
  );
}

function IntensityMeter({ value, bucket, onChange }) {
  const c = bucketColor(bucket);
  const idx = INTENSITIES.findIndex(i => i.key === value);
  const trackRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const zoneFrom = (clientX) => {
    const rect = trackRef.current.getBoundingClientRect();
    const r = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return r < 1 / 3 ? 'light' : r < 2 / 3 ? 'normal' : 'aggressive';
  };
  const handle = (e) => { const z = zoneFrom(e.clientX); if (z !== value) onChange(z); };
  // Dots AND labels are positioned by the same ratio math off a fixed edge
  // inset (--pe-inset, big enough that the end labels don't clip), so the fill
  // end, the dot, and the word all share one x per step and stay aligned at any
  // meter width. This mirrors the reference mockup's intent (fixed-width
  // centered labels) but pins each label's centre to its dot exactly.
  const last = INTENSITIES.length - 1;
  const posAt = (n) => `calc(var(--pe-inset) + (100% - 2 * var(--pe-inset)) * ${n / last})`;
  return (
    <div className="pe-intensity" style={{ '--pe-b': c }}>
      <div
        ref={trackRef} className="pe-intensity-track"
        onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); handle(e); }}
        onPointerMove={e => { if (dragging) handle(e); }}
        onPointerUp={() => setDragging(false)}
      >
        <div className="pe-intensity-rail" />
        <div className="pe-intensity-fill" style={{ width: `calc((100% - 2 * var(--pe-inset)) * ${idx / last})` }} />
        {INTENSITIES.map((i, n) => (
          <span
            key={i.key}
            className={`pe-intensity-dot${i.key === value ? ' pe-intensity-dot--on' : ''}${n <= idx ? ' pe-intensity-dot--passed' : ''}`}
            style={{
              left: posAt(n),
              width: i.key === value ? i.dot + 6 : i.dot,
              height: i.key === value ? i.dot + 6 : i.dot,
            }}
          />
        ))}
      </div>
      <div className="pe-intensity-labels">
        {INTENSITIES.map((i, n) => (
          <button
            type="button" key={i.key}
            className={i.key === value ? 'on' : ''}
            style={{ left: posAt(n) }}
            onClick={() => onChange(i.key)}
          >{i.label}</button>
        ))}
      </div>
    </div>
  );
}

function ModifierBadge({ modifier, bucket }) {
  return (
    <span
      className={`pe-modifier${modifier ? ' pe-modifier--on' : ''}`}
      style={modifier ? { '--pe-b': bucketColor(bucket) } : undefined}
    >{modifier || '—'}</span>
  );
}

function StrategyPill({ strategy, bucket, onRemove }) {
  return (
    <span className="pe-strat-pill" style={{ '--pe-b': bucketColor(bucket) }}>
      <span className="pe-strat-pill-dot" />
      {strategy.name}
      {onRemove && <button type="button" className="pe-strat-pill-x" onClick={onRemove}>×</button>}
    </span>
  );
}

function QuickGroupButton({ group, selected, onClick }) {
  const total = group.members.length;
  const on = group.members.filter(id => selected.has(id)).length;
  const full = on === total;
  const partial = on > 0 && !full;
  const tint = group.suggestBucket ? bucketColor(group.suggestBucket) : 'rgb(var(--tok-description))';
  return (
    <button
      type="button"
      className={`pe-qgroup${full ? ' pe-qgroup--full' : partial ? ' pe-qgroup--partial' : ''}`}
      style={{ '--pe-b': tint }}
      onClick={onClick}
    >
      <span className="pe-qgroup-glyph" />
      <span className="pe-qgroup-label">{group.label}</span>
      <span className="pe-qgroup-count">{on}/{total}</span>
    </button>
  );
}

function PinnedStrategyButton({ strategy, selected, bucket, onClick }) {
  const on = selected.has(strategy.id);
  return (
    <button
      type="button"
      className={`pe-pinned${on ? ' pe-pinned--on' : ''}`}
      style={{ '--pe-b': bucketColor(bucket) }}
      onClick={onClick}
    >
      <span className="pe-pinned-dot" />
      {strategy.name}
    </button>
  );
}

function StrategyListPopout({ available, selected, onToggle, bucket, onClose }) {
  const [query, setQuery] = useState('');
  const c = bucketColor(bucket);
  const q = query.trim().toLowerCase();
  const filtered = q ? available.filter(s => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)) : available;
  const byGroup = {};
  filtered.forEach(s => { (byGroup[s.group] = byGroup[s.group] || []).push(s); });
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal pe-strat-popout" style={{ '--pe-b': c }}>
        <div className="pe-strat-popout-head">
          <span className="pe-strat-popout-title">All Strategies</span>
          <div style={{ flex: 1 }} />
          <button type="button" className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="pe-strat-popout-search">
          <input autoFocus className="field-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search strategies…" />
        </div>
        <div className="pe-strat-popout-body">
          <div className="pe-strat-popout-cols">
            {STRATEGY_COLUMNS.map((col, i) => (
              <div key={i}>
                {col.map(g => byGroup[g] && (
                  <div key={g} className="pe-strat-popout-group">
                    <div className="pe-strat-popout-glabel">
                      <span>{g}</span>
                      <div className="pe-strat-popout-rule" />
                    </div>
                    <div className="pe-strat-popout-list">
                      {byGroup[g].map(s => {
                        const on = selected.has(s.id);
                        const isAuto = AUTO_LINK_PAIR.includes(s.id);
                        const memberOf = quickGroupsContaining(s.id);
                        return (
                          <button
                            key={s.id} type="button"
                            className={`pe-strat-opt${on ? ' pe-strat-opt--on' : ''}`}
                            onClick={() => onToggle(s.id)}
                          >
                            <span className="pe-strat-opt-name">{s.name}</span>
                            {isAuto && <span className="pe-strat-opt-link" title="Auto-links with its 2D/3D twin">⇄</span>}
                            {!isAuto && memberOf.length > 0 && (
                              <span className="pe-strat-opt-member" title={`Part of: ${memberOf.map(g2 => g2.label).join(', ')}`} />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          {filtered.length === 0 && <div className="pe-strat-popout-empty">No strategies match &quot;{query}&quot;</div>}
        </div>
        <div className="pe-strat-popout-foot">
          <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

// ── Small helpers ────────────────────────────────────────────────────────────
// Section-label accents for the unified editor. Violet (the description-badge
// token) marks the "what is this preset" setup sections; blue marks speeds/
// feeds; muted marks the footer reference sections.
const PE_VIOLET = 'rgb(var(--tok-description))';

// Section card — the unified editor's visual grouping shell: raised surface,
// real border, colored uppercase label with a hairline rule. This is the
// UnifiedPresetEditor mockup's `Section`, mapped onto the app's tokens
// (.pe-section in index.css).
function EditorSection({ label, accent, right, children }) {
  return (
    <div className="pe-section" style={accent ? { '--pe-accent': accent } : undefined}>
      <div className="pe-section-head">
        <span className="pe-section-label">{label}</span>
        <span className="pe-section-rule" />
        {right}
      </div>
      {children}
    </div>
  );
}

function FGroup({ label, children }) {
  return (
    <div className="field-group">
      <label className="field-label">{label}</label>
      {children}
    </div>
  );
}

// (NField was replaced by LinkedSlider — src/components/LinkedSlider.jsx —
// which carries over its fx badge, shift-hover formula tooltip, and precision
// handling on top of the slider control.)
