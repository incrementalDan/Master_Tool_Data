import { useState, useMemo, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  GitMerge, Ruler, StickyNote, Clock, AlertTriangle, Camera,
  FileJson, MapPin, CloudOff,
} from 'lucide-react';
import PresetPanel from './PresetPanel.jsx';
import ToolProfileModal from './ToolProfileModal.jsx';
import { canDrawProfile } from '../utils/toolProfile.js';
import LocationPicker from './LocationPicker.jsx';
import ReconcileModal from './ReconcileModal.jsx';
import FilesSection from './FilesSection.jsx';
import PurchasingSection from './PurchasingSection.jsx';
import LinkedToolsSection from './LinkedToolsSection.jsx';
import SpeedFeedSection from './SpeedFeedSection.jsx';
import ProgramUsageSection from './ProgramUsageSection.jsx';
import AttachmentUploadModal from './AttachmentUploadModal.jsx';
import PhotoSlot from './PhotoSlot.jsx';
import PairingSections from './PairingSections.jsx';
import ProShopImportModal from './ProShopImportModal.jsx';
import {
  INSERT_FAMILY_BY_ID, ALWAYS_INSERT_TYPES, autoInsertFamily, newPairing,
} from '../schema/insertFamilies.js';
import InfoTip from './InfoTip.jsx';
import { useApp } from '../context/AppContext.jsx';
import { TOOL_TYPE_LABELS, validateGeometry, fusionToolToInternal, readOohFromFusion } from '../schema/toolSchema.js';
import ToolFields from './ToolFields.jsx';
import ToolStickyHeader from './tool/ToolStickyHeader.jsx';
import ToolBanners from './tool/ToolBanners.jsx';
import ToolActionSidebar from './tool/ToolActionSidebar.jsx';
import Section from './tool/ToolSection.jsx';
import Field from './tool/DetailField.jsx';
import SidebarBtn from './tool/SidebarBtn.jsx';
import AssembliesSection from './tool/AssembliesSection.jsx';
import AssemblyExportPicker from './tool/AssemblyExportPicker.jsx';
import { hasReconcileWork } from '../services/reconcile.js';
import ToolForm from './ToolForm.jsx';
import { exportSingleTool as exportFusion, copyToolToClipboard } from '../utils/fusionExport.js';
import { exportSingleTool as exportProShop } from '../utils/proShopExport.js';

export default function ToolDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    tools, saveTool, saveToolMetadata, deleteTool, cloneTool, isSaving, notify, holders, holderLibraryLocation,
    reconcileTool, googleAuthenticated, uploadToolPhoto, uploadToolAttachment, deleteToolAttachment,
    shopSettings, promoteToolToFusion, detachToolFromFusion, fusionEnabled, fusionAuthority,
    isLoading, fusionSyncing,
  } = useApp();
  const idMode = shopSettings?.tool_id_system?.mode || 'proshop';
  const [editing, setEditing] = useState(searchParams.get('edit') === '1');
  // Delete confirmation. null = closed; 'normal' = user-initiated from edit mode
  // (deletes the Fusion entry too); 'missing' = reverse sync, the tool was
  // already deleted in Fusion and we're only clearing it from the app.
  const [deleteMode, setDeleteMode] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  // Reverse sync: reconcile-on-open found no matching Fusion entry — the tool
  // was deleted directly in Fusion 360. Surfaced as a banner (informed, not
  // blocked); the user chooses to remove it from the app or keep it.
  const [fusionMissing, setFusionMissing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showExportPicker, setShowExportPicker] = useState(null); // null | 'copy' | 'download'
  const [reconcileResults, setReconcileResults] = useState(null);
  const [showPhotoUpload, setShowPhotoUpload] = useState(false);
  const [showProShopImport, setShowProShopImport] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [promoteLibId, setPromoteLibId] = useState(null); // non-null = target-library picker open

  // True while the inline preset editor has unsaved changes — used to warn
  // before navigating away or switching into the tool edit form.
  const presetDirtyRef = useRef(false);
  const guardLeave = (fn) => () => {
    if (presetDirtyRef.current &&
        !window.confirm('You have unsaved changes to a preset. Leave without saving them?')) return;
    presetDirtyRef.current = false;
    fn();
  };

  const tool = tools.find(t => t.id === id);
  // Store the id, render the name — see "Relational integrity".
  const replacement = tool?.replaced_by ? tools.find(t => t.id === tool.replaced_by) : null;

  // Land at the top of the page when opening a tool (navigating in keeps the
  // window's previous scroll position otherwise).
  useEffect(() => { window.scrollTo(0, 0); }, [id]);

  // Reconcile against the Fusion library on open: detect entries dumped straight
  // from Fusion (sharing this tool's tracking ID or ProShop #) and prompt. Runs
  // once per opened tool; skip while editing.
  const reconciledRef = useRef(null);
  useEffect(() => {
    if (!tool || editing) return;
    if (tool.no_fusion_link) return; // no Fusion entry — nothing to reconcile against
    if (reconciledRef.current === tool.id) return;
    reconciledRef.current = tool.id;
    setFusionMissing(false); // clear stale state when moving to a different tool
    let cancelled = false;
    (async () => {
      try {
        const results = await reconcileTool(tool);
        if (cancelled) return;
        // Reverse sync takes precedence — if the tool is gone from Fusion there
        // are no strays to reconcile, only the "removed from Fusion" prompt.
        if (results.missing) setFusionMissing(true);
        else if (hasReconcileWork(results)) setReconcileResults(results);
      } catch { /* non-critical */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool?.id, editing]);

  // Re-check after a reconcile action; close the modal once nothing's left.
  const refreshReconcile = async () => {
    try {
      const current = tools.find(t => t.id === id);
      const results = await reconcileTool(current);
      if (hasReconcileWork(results)) setReconcileResults(results);
      else setReconcileResults(null);
    } catch { setReconcileResults(null); }
  };

  // Send a conflicting stray entry to the Sync Job diff, prefilled.
  const reviewConflict = (strayRaw) => {
    const incoming = fusionToolToInternal(strayRaw);
    incoming.incoming_ooh = readOohFromFusion(strayRaw);
    incoming.incoming_holder_guid = strayRaw.holder?.guid || '';
    incoming._incomingHolderDesc = strayRaw.holder?.description || '';
    setReconcileResults(null);
    navigate(`/merge/${tool.id}`, { state: { reconcileIncoming: incoming } });
  };
  const geoIssues = useMemo(
    () => tool ? validateGeometry(tool) : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tool?.tool_type, tool?.diameter, tool?.flute_length, tool?.shoulder_length, tool?.min_ooh, tool?.overall_length, tool?.corner_radius]
  );

  useEffect(() => {
    if (!tool) return;
    const parts = [tool.tool_id, tool.description].filter(Boolean);
    document.title = parts.length ? `${parts.join(' · ')} · ToolDex` : 'ToolDex';
    return () => { document.title = 'ToolDex'; };
  }, [tool?.tool_id, tool?.description]);

  if (!tool) {
    // The library may still be loading — on a full refresh straight onto this
    // page, `tools` is empty until the load lands (metadata-first paint, then
    // Fusion). Show a spinner then, not a misleading "not found" flash; only
    // declare the tool missing once the load has actually settled.
    if (isLoading || fusionSyncing) {
      return (
        <div className="loading-screen">
          <div className="spinner" />
          <span>Loading tool…</span>
        </div>
      );
    }
    return (
      <div className="loading-screen">
        <span className="text-sub">Tool not found.</span>
        <button className="btn btn-secondary" onClick={() => navigate('/')}>Back to Library</button>
      </div>
    );
  }

  // No-Fusion tool (Fusion-decoupling Phase B): lives in the app/metadata only,
  // with no Fusion library entry. Fusion-workflow actions (Sync Job, reconcile,
  // Copy to Fusion) are hidden. `toolIsNoFusion` is this tool's own flag; `noFusion`
  // ALSO covers the shop-wide Fusion-sync-off mode (every tool is metadata-only
  // then). Promote/Detach only make sense when Fusion is on, so they gate on
  // `fusionEnabled` and pick by the per-tool flag.
  const toolIsNoFusion = !!tool.no_fusion_link;
  const noFusion = toolIsNoFusion || !fusionEnabled;

  // Multi-library shops choose which Fusion library to create the tool in;
  // single-library shops promote straight into it (no picker).
  const toolLibraries = shopSettings?.tool_libraries || [];
  const defaultLibId = shopSettings?.default_tool_library_id || toolLibraries[0]?.id || null;
  const handlePromote = async () => {
    if (toolLibraries.length > 1) { setPromoteLibId(defaultLibId); return; }
    try { await promoteToolToFusion(tool.id); }
    catch { /* toast handled in context */ }
  };
  const confirmPromote = async () => {
    const libId = promoteLibId;
    setPromoteLibId(null);
    try { await promoteToolToFusion(tool.id, libId); }
    catch { /* toast handled in context */ }
  };
  const handleDetach = async () => {
    if (!window.confirm('Detach this tool from Fusion? Its Fusion library entry is removed; all app data (specs, presets, purchasing, location, photos) is kept. You can re-create it in Fusion later.')) return;
    try { await detachToolFromFusion(tool.id); }
    catch { /* toast handled in context */ }
  };

  // D3 — resolve field-level drift. Set the chosen value EXPLICITLY for every
  // resolved field (both directions), so saving pushes it to ALL Fusion instances
  // of this logical tool — not just the canonical one. Critical for multi-assembly
  // tools: a logical tool maps to N Fusion instances, and when the app value wins
  // it must overwrite every instance (a normal save already does this; a drift
  // resolution must too). Keep app → app value; Keep Fusion → the diverged Fusion
  // value (adopts the Fusion edit onto all instances).
  const handleApplyDrift = async (resolutions) => {
    const patch = {};
    for (const d of (tool._drift || [])) {
      if (!d.field) continue;   // non-scalar info rows (preset/OOH/holder) aren't resolved here
      patch[d.field] = resolutions[d.field] === 'app' ? d.appValue : d.fusionValue;
    }
    try { await saveTool({ ...tool, ...patch, _drift: [] }); }
    catch { /* toast handled in context */ }
  };

  const clearEditParam = () => {
    if (searchParams.get('edit')) {
      searchParams.delete('edit');
      setSearchParams(searchParams, { replace: true });
    }
  };

  // `sourceFile` is the screenshot/PDF a "Scan spec sheet" run read its values
  // from, handed up by ToolForm. ⚠️ It is attached to the tool the save RETURNED,
  // never to the draft or to the pre-edit `tool` — uploadToolAttachment writes
  // the whole record it is given, so either of those would undo the save.
  // A failed attach must not fail the save: the tool data is already committed
  // and correct, and uploadToolAttachment has toasted the reason.
  const handleSave = async (updated, sourceFile = null) => {
    const saved = await saveTool(updated);
    if (sourceFile && saved) {
      try {
        await uploadToolAttachment(saved, sourceFile.blob, sourceFile.name, 'data_extraction');
      } catch { /* already surfaced by the action */ }
    }
    setEditing(false);
    clearEditParam();
  };

  const handleDelete = async () => {
    setDeleteError('');
    try {
      // 'missing' = already gone from Fusion → metadata-only removal (skipFusion),
      // no wasteful re-upload of the whole library. 'normal' = also delete the
      // Fusion entry.
      await deleteTool(id, { skipFusion: deleteMode === 'missing' });
      navigate('/');
    } catch (err) {
      setDeleteError(err.message);
    }
  };

  const handleClone = async () => {
    try {
      const created = await cloneTool(id);
      navigate(`/tool/${created.id}?edit=1`);
    } catch { /* toast handled in context */ }
  };

  // Called by PresetPanel when any preset is saved, deleted, or reordered.
  // Syncs flat speed/feed fields from preset[0] so ToolForm stays consistent.
  const handlePresetsChange = async (newPresets) => {
    const p0 = newPresets[0] ?? null;
    try {
      await saveTool({
        ...tool,
        presets: newPresets,
        ...(p0 && {
          spindle_speed: p0.n ?? tool.spindle_speed ?? null,
          cutting_feedrate: p0.v_f ?? tool.cutting_feedrate ?? null,
          plunge_feedrate: p0.v_f_plunge ?? tool.plunge_feedrate ?? null,
          ramp_feedrate: p0.v_f_ramp ?? tool.ramp_feedrate ?? null,
          lead_in_feedrate: p0.v_f_leadIn ?? tool.lead_in_feedrate ?? null,
          lead_out_feedrate: p0.v_f_leadOut ?? tool.lead_out_feedrate ?? null,
          feed_per_tooth: p0.f_z ?? tool.feed_per_tooth ?? null,
          feed_per_rev: p0.f_n ?? tool.feed_per_rev ?? null,
          cutting_speed: p0.v_c ?? tool.cutting_speed ?? null,
        }),
      });
    } catch { /* toast handled in context */ }
  };

  const typeLabel = TOOL_TYPE_LABELS[tool.tool_type] || tool.tool_type;
  const assemblies = tool.assemblies || [];
  const hasMachineNum = tool.machine_tool_number !== null && tool.machine_tool_number !== undefined && tool.machine_tool_number !== '';

  // Insert-style pairing (holder body + insert — see insertFamilies.js). When
  // paired, the component groups own Geometry/Photo/Location/Purchasing per
  // component; the Assemblies section only shows for tier-3 (milling) families.
  //
  // Always-insert tool types (face mill / turning general / boring head) open
  // the paired view by DEFAULT with a derived family, before any pairing is
  // stored — so the operator doesn't have to hunt for a setup panel. That
  // default (`autoInsert`) pairing isn't written until they link a component.
  const storedPairing = tool.pairing || null;
  const autoInsert = !storedPairing && ALWAYS_INSERT_TYPES.has(tool.tool_type);
  const pairing = storedPairing || (autoInsert ? newPairing(autoInsertFamily(tool.tool_type)) : null);
  const pairingFamily = pairing ? INSERT_FAMILY_BY_ID[pairing.family] : null;
  const showAssemblies = !pairing || !!pairingFamily?.hasTier3Assembly;
  // The tool-level Photo/Location/Purchasing panels hide only once data has
  // actually started moving onto a component — so an existing insert tool's
  // tool-level data stays visible during setup, not the instant the paired
  // view appears.
  const hasComponents = !!(pairing && (pairing.holder_component_id || pairing.insert_component_id));
  // ⚠️ PROPAGATES the failure. It used to swallow it, which meant a section
  // could not tell a save that worked from one that didn't — so a panel that
  // closes its editor "when the save finishes" closed it on failure too and
  // silently threw the edit away. The context already toasts the reason; this
  // just lets the caller keep the user's data on screen.
  const sectionSave = async (updatedTool) => saveTool(updatedTool);

  // For panels holding nothing Fusion has a place for. Skips the Fusion library
  // round-trip entirely — a purchasing edit used to download and re-upload the
  // whole library to store a field Fusion never sees. The patch is filtered in
  // saveToolMetadata, so a Fusion-backed field can never reach metadata alone
  // (see metadataScope.js for why that matters).
  const metaSave = async (updatedTool) => saveToolMetadata(updatedTool);

  // Delete confirmation modal — shared by the edit-mode Delete button ('normal')
  // and the reverse-sync banner ('missing'). Rendered in both the edit and view
  // returns so it works from wherever it was opened.
  const deleteModalEl = deleteMode && (
    <div className="modal-backdrop">
      <div className="modal">
        <h3 className="modal-title">
          {deleteMode === 'missing' ? 'Remove from ToolDex?' : 'Delete tool?'}
        </h3>
        <p className="modal-body">
          {deleteMode === 'missing' ? (
            <>
              <strong>{tool.description || 'This tool'}</strong> no longer exists in the
              Fusion library — it was deleted in Fusion 360. Removing it here deletes
              the app's record (presets, assemblies, purchasing, location, photos and
              notes). This cannot be undone.
            </>
          ) : (
            <>
              <strong>{tool.description || 'This tool'}</strong> will be permanently deleted.
              {!noFusion && <> This also removes its entry (all assemblies/instances) from the <strong>Fusion library</strong>.</>}
              {' '}The app record — presets, purchasing, location, photos and notes — is deleted too. This cannot be undone.
            </>
          )}
        </p>
        {deleteError && <div className="error-banner mb-12">{deleteError}</div>}
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={() => { setDeleteMode(null); setDeleteError(''); }} disabled={isSaving}>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={handleDelete} disabled={isSaving}>
            {isSaving ? 'Deleting…' : (deleteMode === 'missing' ? 'Remove from app' : 'Delete permanently')}
          </button>
        </div>
      </div>
    </div>
  );

  if (editing) {
    return (
      <div>
        {/* Same sticky identity header as view mode, so the tool you're editing
            stays visible while scrolling a long form. */}
        <ToolStickyHeader
          tool={tool} typeLabel={typeLabel} hasMachineNum={hasMachineNum}
          idMode={idMode} replacement={replacement} mode="edit"
        />
        <ToolForm
          tool={tool}
          onSave={handleSave}
          onCancel={() => { setEditing(false); clearEditParam(); }}
          isSaving={isSaving}
          isNew={false}
          onDelete={() => { setDeleteError(''); setDeleteMode('normal'); }}
        />
        {deleteModalEl}
      </div>
    );
  }

  return (
    <div className="tool-detail-wrap">
      {/* Frozen left action sidebar */}
      <ToolActionSidebar
        noFusion={noFusion}
        toolIsNoFusion={toolIsNoFusion}
        fusionEnabled={fusionEnabled}
        canDrawProfile={canDrawProfile(tool.tool_type)}
        copied={copied}
        onBack={guardLeave(() => navigate(-1))}
        onEdit={guardLeave(() => setEditing(true))}
        onDuplicate={handleClone}
        onOpenProfile={guardLeave(() => setShowProfile(true))}
        onSyncJob={() => navigate(`/merge/${tool.id}`)}
        onPromote={handlePromote}
        onDetach={handleDetach}
        onCopyToFusion={() => setShowExportPicker('copy')}
        onDownload={() => setShowExportPicker('download')}
        onImportProShop={() => setShowProShopImport(true)}
        onExportProShop={() => {
          // A beta tool is deliberately kept out of ProShop — say so rather
          // than reporting an export that didn't happen.
          const ok = exportProShop(tool);
          notify(ok ? 'Exported ProShop CSV'
            : 'Beta tool — deliberately not exported to ProShop.', ok ? 'success' : 'info');
        }}
      />

      {/* Main content */}
      <div className="tool-detail-main">
        {/* Sticky header — type icon + description left, identity (cabinet/machine#) right */}
        <ToolStickyHeader
          tool={tool} typeLabel={typeLabel} hasMachineNum={hasMachineNum}
          idMode={idMode} replacement={replacement} mode="view"
        />

        <ToolBanners
          tool={tool}
          noFusion={noFusion}
          fusionAuthority={fusionAuthority}
          isSaving={isSaving}
          notify={notify}
          onApplyDrift={handleApplyDrift}
          onSave={saveTool}
          fusionMissing={fusionMissing}
          onKeepMissing={() => setFusionMissing(false)}
          onRemoveMissing={() => { setDeleteError(''); setDeleteMode('missing'); }}
        />

        {/* Insert-style tool: pairing bar + the Holder Body / Insert component
            groups (each with its own Geometry & setup, Photo, Location and
            Purchasing). Everything below stays shared. */}
        {pairing && (
          <PairingSections
            key={`pairing-${tool.id}`}
            tool={tool}
            pairing={pairing}
            stored={!!storedPairing}
            onSaveTool={async (updatedTool) => { await saveTool(updatedTool); }}
          />
        )}

        <div className="detail-layout">
          <div className="detail-layout-left">
            <Section
              title={pairing ? 'Combined Geometry (Fusion)' : 'Geometry & Setup'}
              icon={Ruler}
            >
              {pairing && (
                <div className="text-sub text-xs" style={{ marginBottom: 10, lineHeight: 1.5 }}>
                  The Fusion entry's cutting geometry for the combined holder&nbsp;body&nbsp;+&nbsp;insert
                  unit — what CAM programs against. Component-specific specs live in the
                  Holder Body / Insert sections above.
                </div>
              )}
              <ToolFields tool={tool} mode="view" onOpenProfile={() => setShowProfile(true)} />
              {geoIssues.length > 0 && (
                <div className="warn-banner" style={{ marginTop: 8 }}>
                  {geoIssues.map((issue, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <AlertTriangle size={12} style={{ flexShrink: 0 }} />
                      {issue.message}
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {showAssemblies && (
              <AssembliesSection
                tool={tool}
                holders={holders}
                onSave={sectionSave}
              />
            )}

            <PresetPanel tool={tool} onSave={handlePresetsChange} isSaving={isSaving}
              onDirtyChange={(d) => { presetDirtyRef.current = d; }} />

            <SpeedFeedSection
              tool={tool}
              onSave={async (updatedTool) => {
                try {
                  await metaSave(updatedTool);
                } catch { /* toast handled in context */ }
              }}
            />

            <Section title="History" icon={Clock} defaultOpen={false}>
              <div className="detail-fields" style={{ marginBottom: (tool.merge_history || []).length > 0 ? 12 : 0 }}>
                <Field label="Created" value={tool.created_at ? new Date(tool.created_at).toLocaleString() : null} />
                <Field label="Updated" value={tool.updated_at ? new Date(tool.updated_at).toLocaleString() : null} />
                <Field label="Updated By" value={tool.updated_by} />
              </div>
              {(tool.merge_history || []).length > 0 && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                    <GitMerge size={12} style={{ color: 'var(--text-sub)' }} />
                    <span className="text-xs text-sub" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Merge History
                    </span>
                  </div>
                  <div className="merge-history-list">
                    {[...(tool.merge_history)].reverse().map((entry, i) => (
                      <div key={i} className="merge-history-entry">
                        <div className="merge-history-meta">
                          <span style={{ fontWeight: 600 }}>{entry.merged_by || 'Unknown'}</span>
                          <span className="text-sub text-xs">
                            {entry.merged_at ? new Date(entry.merged_at).toLocaleDateString() : ''}
                          </span>
                        </div>
                        {entry.revision_note && (
                          <div className="merge-history-note">{entry.revision_note}</div>
                        )}
                        <div className="merge-history-fields text-xs text-sub">
                          Changed: {(entry.fields_changed || []).join(', ')}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Section>
          </div>

          <div className="detail-layout-right">
            {/* Once a component is linked, the Photo / Location / Purchasing
                panels live per-component in the groups above — the pairing is a
                relationship, not a physical object with its own drawer. Until
                then (including an always-insert tool's default paired view) the
                tool-level panels stay so existing data isn't hidden mid-setup. */}
            {!hasComponents && (
              <>
                <Section title="Photo" icon={Camera}>
                  <PhotoSlot
                    record={tool}
                    googleAuthenticated={googleAuthenticated}
                    onChangePhoto={() => setShowPhotoUpload(true)}
                    onDeletePhoto={async () => {
                      try { await deleteToolAttachment(tool, tool.primary_photo_id, true); }
                      catch { /* toast handled in context */ }
                    }}
                  />
                  {/* Former (retired) IDs — shown only when present, directly below the
                      photo. Muted, one line. Gated on the Tool ID System's show_legacy
                      toggle (defaults ON). A search match still reveals them on the
                      result card regardless. Never shown anywhere else. */}
                  {(shopSettings?.tool_id_system?.show_legacy ?? true)
                    && Array.isArray(tool.legacy_ids) && tool.legacy_ids.length > 0 && (
                    <div className="text-sub text-xs" style={{ marginTop: 8 }}>
                      Formerly:{' '}
                      <span className="font-mono">{tool.legacy_ids.join(', ')}</span>
                    </div>
                  )}
                </Section>

                {/* Open by default when the tool has no structured location:
                    the panel IS the only place a location gets assigned, and
                    collapsing it hid the one action a new tool still needs.
                    Already located → stays collapsed, since the composed value
                    is already on the identity row above. */}
                <Section title="Location" icon={MapPin} defaultOpen={!tool.tool_location}>
                  <LocationPicker tool={tool} />
                </Section>

                <PurchasingSection
                  tool={tool}
                  isSaving={isSaving}
                  onSave={metaSave}
                />
              </>
            )}

            {/* Sits directly under Purchasing, but OUTSIDE the pairing guard
                above: an insert tool hides its tool-level photo/location/
                purchasing once components are linked, yet it can still be
                related to another tool. */}
            <LinkedToolsSection tool={tool} />

            {/* Where this tool actually runs — derived from the uploaded
                Sequence Details, so there is nothing to link by hand. */}
            <ProgramUsageSection tool={tool} />

            <Section title="Notes & Tags" icon={StickyNote}>
              {tool.notes && (
                <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, marginBottom: 10 }}>{tool.notes}</p>
              )}
              {(tool.tags || []).length > 0 && (
                <div className="tag-list mb-12">
                  {tool.tags.map(t => <span key={t} className="tag">{t}</span>)}
                </div>
              )}
              {tool.revision_notes && <Field label="Revision Notes" value={tool.revision_notes} />}
              {!tool.notes && !(tool.tags || []).length && !tool.revision_notes && (
                <span className="detail-field-empty text-sm">No notes yet.</span>
              )}
            </Section>

            <FilesSection
              tool={tool}
              googleAuthenticated={googleAuthenticated}
              onUpload={async (file, fileName, fileType) => {
                try { await uploadToolAttachment(tool, file, fileName, fileType); }
                catch { throw new Error('Upload failed — check your Google Drive connection'); }
              }}
              onDelete={async (fileId) => {
                try { await deleteToolAttachment(tool, fileId, false); }
                catch { /* toast handled in context */ }
              }}
            />
          </div>
        </div>

        {/* Which library this tool lives in (multi-library). Reads and writes go
            back to this library. Muted one-liner at the bottom of the page. */}
        {!fusionEnabled ? (
          <div className="text-sub text-xs" style={{ marginTop: 20, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <CloudOff size={13} style={{ flexShrink: 0, color: 'var(--orange)' }} />
            Fusion sync is off — tools live in the app &amp; metadata only. Turn it back on in Settings → Fusion Libraries.
          </div>
        ) : toolIsNoFusion ? (
          <div className="text-sub text-xs" style={{ marginTop: 20, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <CloudOff size={13} style={{ flexShrink: 0, color: 'var(--orange)' }} />
            Not in Fusion — this tool lives in the app &amp; metadata only. Use <strong>Create in Fusion</strong> to add it to the library.
          </div>
        ) : tool.library_name && (
          <div className="text-sub text-xs" style={{ marginTop: 20, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <FileJson size={13} style={{ flexShrink: 0 }} />
            In library: <span className="font-mono">{tool.library_name}</span>
          </div>
        )}

        {/* Primary photo upload modal */}
        {showPhotoUpload && (
          <AttachmentUploadModal
            open={showPhotoUpload}
            onClose={() => setShowPhotoUpload(false)}
            onUpload={async (file, fileName) => {
              await uploadToolPhoto(tool, file, fileName);
            }}
            photoMode
          />
        )}

        {/* Fusion export picker modal */}
        {showExportPicker && (
          <AssemblyExportPicker
            tool={tool}
            holders={holders}
            onConfirm={async (assembly) => {
              setShowExportPicker(null);
              if (showExportPicker === 'copy') {
                try {
                  await copyToolToClipboard(tool, holders, assembly);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                  notify('Copied to clipboard', 'success', 2000);
                } catch {
                  notify('Clipboard not available — use Download instead', 'error');
                }
              } else {
                exportFusion(tool, holders, assembly);
                notify('Fusion JSON downloaded', 'success');
              }
            }}
            onCancel={() => setShowExportPicker(null)}
          />
        )}

        {showProfile && (
          <ToolProfileModal
            tool={tool}
            onClose={() => setShowProfile(false)}
            onSave={async (updated) => {
              await saveTool(updated);
              notify('Geometry saved', 'success');
            }}
          />
        )}

        {showProShopImport && (
          <ProShopImportModal
            tool={tool}
            onClose={() => setShowProShopImport(false)}
            onApply={async (additions, conflicts) => {
              const patch = { ...tool, ...additions };
              // Differing values are flagged (not overwritten) — persisted via
              // buildMetadataTool → mergeToolConflicts, shown in the ConflictBanner.
              if (conflicts && conflicts.length) {
                patch._combineConflicts = [...(tool._combineConflicts || []), ...conflicts];
              }
              await saveTool(patch);
              notify(conflicts && conflicts.length
                ? `ProShop data imported — ${conflicts.length} difference${conflicts.length === 1 ? '' : 's'} flagged`
                : 'ProShop data imported', 'success');
            }}
          />
        )}

        {reconcileResults && (
          <ReconcileModal
            tool={tool}
            results={reconcileResults}
            onClose={() => setReconcileResults(null)}
            onResolved={refreshReconcile}
            onReviewConflict={reviewConflict}
          />
        )}

        {/* Delete confirmation modal (shared with edit mode) */}
        {deleteModalEl}

        {promoteLibId !== null && (
          <div className="modal-backdrop" onClick={() => setPromoteLibId(null)}>
            <div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
              <h3 className="modal-title">Create in which Fusion library?</h3>
              <p className="modal-body">
                <strong>{tool.description || 'This tool'}</strong> will be created as a real entry in the library you pick.
              </p>
              <div style={{ display: 'grid', gap: 8, marginBottom: 8 }}>
                {toolLibraries.map(lib => (
                  <label key={lib.id} className="radio-row" style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', padding: 8, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                    <input type="radio" name="promote-lib" checked={promoteLibId === lib.id} onChange={() => setPromoteLibId(lib.id)} />
                    <span>{lib.fileName || lib.id}{lib.id === defaultLibId ? <span className="text-sub text-sm"> (default)</span> : null}</span>
                  </label>
                ))}
              </div>
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => setPromoteLibId(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={confirmPromote} disabled={isSaving || !promoteLibId}>
                  {isSaving ? 'Creating…' : 'Create in Fusion'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
