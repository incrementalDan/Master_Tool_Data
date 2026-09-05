import { useState, useMemo, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  GitMerge, Clock, Camera,
  FileJson, MapPin, CloudOff, ScanLine, Save, Trash2,
} from 'lucide-react';
import PresetPanel from './PresetPanel.jsx';
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
import { TOOL_TYPE_LABELS, fusionToolToInternal, readOohFromFusion } from '../schema/toolSchema.js';
import ToolStickyHeader from './tool/ToolStickyHeader.jsx';
import GeometrySection from './tool/GeometrySection.jsx';
import ToolBanners from './tool/ToolBanners.jsx';
import ToolActionSidebar from './tool/ToolActionSidebar.jsx';
import Section from './tool/ToolSection.jsx';
import Field from './tool/DetailField.jsx';
import SidebarBtn from './tool/SidebarBtn.jsx';
import AssembliesSection from './tool/AssembliesSection.jsx';
import AssemblyExportPicker from './tool/AssemblyExportPicker.jsx';
import { hasReconcileWork } from '../services/reconcile.js';
import useToolEditor from './tool/useToolEditor.js';
import IdentityPanel from './tool/IdentityPanel.jsx';
import NotesPanel from './tool/NotesPanel.jsx';
import InsertStyleBlock from './tool/InsertStyleBlock.jsx';
import SpecSummary, { SpecPurchasingPanel } from './tool/SpecScanPanels.jsx';
import ExtractUpdateModal from './ExtractUpdateModal.jsx';
import ToolLinkPicker from './ToolLinkPicker.jsx';
import { metadataOnlyPatch } from '../schema/metadataScope.js';
import { editedPatch } from './tool/editPatch.js';
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
    isLoading, fusionSyncing, registerNavGuard,
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
  const [promoteLibId, setPromoteLibId] = useState(null); // non-null = target-library picker open

  // True while the inline preset editor has unsaved changes — used to warn
  // before navigating away or switching into the tool edit form.
  const presetDirtyRef = useRef(false);
  const editBaseRef = useRef(null);
  // ⚠️ Covers BOTH drafts. It used to ask about presets only, because the tool's
  // own edits lived on a separate screen with its own guard. Now that editing
  // happens in place, leaving the page with the edit bar open would throw the
  // whole draft away without a word.
  const editDirtyRef = useRef(false);
  const guardLeave = (fn) => () => {
    if (editDirtyRef.current &&
        !window.confirm('You have unsaved changes to this tool. Leave without saving them?')) return;
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
  // once per opened tool; skipped while editing — a modal proposing to rewrite
  // the record on top of a live draft is a fight nobody wins.
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

  useEffect(() => {
    if (!tool) return;
    const parts = [tool.tool_id, tool.description].filter(Boolean);
    document.title = parts.length ? `${parts.join(' · ')} · ToolDex` : 'ToolDex';
    return () => { document.title = 'ToolDex'; };
  }, [tool?.tool_id, tool?.description]);

  // ⚠️ ABOVE THE EARLY RETURN. Hooks run in the same order on every render, so
  // the editor cannot sit after the "tool not found" branch — a full refresh
  // straight onto this URL renders that branch first, and mounting the hook
  // only on the second render is the classic hook-order crash.
  // ⚠️ THE SAME EDITOR THE NEW-TOOL FORM USES. Editing an existing tool used to
  // navigate to ToolForm; now the page unlocks in place. The draft, the
  // spec-sheet scan, the description suggestion and the validation are all in
  // the shared hook, so the two screens cannot drift apart again.
  const editor = useToolEditor({
    tool: tool || {}, isNew: false, isSaving, frozen: editing,
    // ⚠️ Wrapped, not passed directly: both are defined further down, and the
    // hook sits above the "tool not found" early return (hook order). A bare
    // reference here would read them in the temporal dead zone and throw.
    onSave: (...a) => handleSave(...a),
    onCancel: () => exitEdit(),
  });
  const { data: draft, scan } = editor;
  editDirtyRef.current = editing && editor.dirty;

  // ⚠️ IN-APP NAVIGATION IS NOT COVERED BY beforeunload. A top-bar tab
  // (Materials, Parts, Settings) is a hash change, not a page load, so leaving
  // mid-edit threw the whole draft away without a word — the one exit that had
  // no guard on it. `<HashRouter>` is not a data router, so there is no
  // useBlocker; the app's own seam is this. Settings does the same thing.
  const [leaveTo, setLeaveTo] = useState(null);
  useEffect(() => {
    const dirtyNow = editing && editor.dirty;
    registerNavGuard?.({ shouldBlock: () => dirtyNow, onBlocked: (proceed) => setLeaveTo(() => proceed) });
    return () => registerNavGuard?.(null);
  }, [registerNavGuard, editing, editor.dirty]);

  // ⚠️ Leaving edit mode ends the scan session. The draft is re-seeded from the
  // record on the way out, so proposals left behind would reappear on the next
  // Edit — pointing at values that are no longer there, with an Undo that
  // restores a "current" nobody is looking at any more.
  useEffect(() => {
    if (!editing && scan.hasProposals) scan.discardProposals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const startEdit = () => {
    editBaseRef.current = { ...tool };
    setEditing(true);
  };


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
  const exitEdit = () => { setEditing(false); clearEditParam(); };

  // ⚠️ SAVES THE EDIT, NOT THE DRAFT. The draft is a snapshot of the tool taken
  // when Edit was pressed; every other panel on this page (presets, assemblies,
  // purchasing, location, photos) still saves on its own while it is open. So
  // writing the whole draft would push a stale copy of THOSE over whatever they
  // wrote in the meantime. Instead: diff the draft against the snapshot to get
  // what the user actually changed, and apply that patch to the CURRENT record.
  // A three-way merge, the same shape the Fusion merge uses.
  // `sourceFile` is the screenshot/PDF a "Scan spec sheet" run read its values
  // from. ⚠️ It is attached to the tool the save RETURNED, never to the draft or
  // to the pre-edit record — uploadToolAttachment writes the whole record it is
  // given, so either of those would undo the save. A failed attach must not fail
  // the save: the tool data is already committed, and the action has toasted.
  const handleSave = async (updated, sourceFile = null) => {
    const patch = editedPatch(editBaseRef.current || tool, updated);
    const next = { ...tool, ...patch };
    let saved = tool;
    if (Object.keys(patch).length > 0) {
      // ⚠️ ROUTED, never asked. Everything Fusion also holds goes through the
      // full write so the two stores stay in step (metadata ≠ Fusion has to keep
      // meaning "Fusion moved" — see metadataScope.js). A change that touches
      // only app-owned fields skips the library round-trip entirely. The user is
      // never told which kind their edit was; that is the whole point.
      const { dropped } = metadataOnlyPatch(tool, next);
      saved = dropped.length > 0 ? await saveTool(next) : await saveToolMetadata(next);
    }
    if (sourceFile && saved) {
      try {
        await uploadToolAttachment(saved, sourceFile.blob, sourceFile.name, 'data_extraction');
      } catch { /* already surfaced by the action */ }
    }
    exitEdit();
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

  // Delete confirmation modal — shared by the edit bar's Delete button
  // ('normal') and the reverse-sync banner ('missing').
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

  return (
    <div className={`tool-detail-wrap${editing ? ' tool-detail-editing' : ''}`}>
      {/* Frozen left action sidebar */}
      <ToolActionSidebar
        noFusion={noFusion}
        toolIsNoFusion={toolIsNoFusion}
        fusionEnabled={fusionEnabled}
        copied={copied}
        onBack={guardLeave(() => navigate(-1))}
        onEdit={guardLeave(startEdit)}
        onDuplicate={handleClone}
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
          idMode={idMode} replacement={replacement} mode={editing ? 'edit' : 'view'}
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

        {editor.errors.length > 0 && (
          <div className="error-banner mb-16">
            {editor.errors.map((e, i) => <div key={i}>{e}</div>)}
          </div>
        )}

        {/* Update this tool from a manufacturer spec sheet. Edit-mode only —
            every proposal it makes lands in the draft, so there has to be a
            draft to land in and a Save to commit it. */}
        {editing && !scan.hasProposals && (
          <div className="spec-scan-bar mb-16">
            <ScanLine size={15} style={{ color: 'var(--blue)', flexShrink: 0 }} />
            <span className="text-sm text-sub" style={{ flex: 1 }}>
              Update this tool from a manufacturer spec sheet or product page.
            </span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => scan.setOpen(true)}>
              <ScanLine size={14} /> Scan spec sheet
            </button>
          </div>
        )}

        {editing && scan.hasProposals && (
          <SpecSummary
            pending={scan.pendingCount}
            accepted={scan.acceptedCount}
            typeNotice={scan.typeNotice}
            sourceFile={scan.sourceFile}
            keepSourceFile={scan.keepSourceFile}
            onKeepSourceFile={scan.setKeepSourceFile}
            canAttach={googleAuthenticated}
            onAcceptAll={scan.acceptAllPending}
            onDiscard={scan.discardProposals}
          />
        )}

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
            {/* The drawing IS the geometry editor — see GeometrySection. The
                separate read-out grid it replaced showed the same dimensions a
                second time, which is what Phase 4 exists to remove. */}
            <GeometrySection
              data={draft}
              setData={editor.setData}
              setField={editor.setField}
              editing={editing}
              geoIssueFields={editor.geoIssueFields}
              listOptions={editor.datalistOptions}
              proposals={scan.inlineProposalMap}
              onResolveProposal={scan.resolveProposal}
              title={pairing ? 'Combined Geometry (Fusion)' : 'Geometry'}
            />

            {editing && <InsertStyleBlock data={draft} setField={editor.setField} afterSaveHint={false} />}

            {showAssemblies && (
              <AssembliesSection
                tool={tool}
                holders={holders}
                onSave={sectionSave}
              />
            )}

            <PresetPanel tool={tool} onSave={handlePresetsChange} isSaving={isSaving}
              onDirtyChange={(d) => { presetDirtyRef.current = d; }} />

            <SpeedFeedSection tool={tool} onSave={metaSave} />

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
            {/* Identity — the editable home of status, type, unit, description
                and Tool ID. In view mode it shows only what the sticky header
                does not, so nothing is displayed twice. */}
            <IdentityPanel
              data={draft} setField={editor.setField} setStatus={editor.setStatus}
              editing={editing} idMode={idMode}
              hasMachineNum={editor.hasMachineNum} machineNum={editor.machineNum}
              locEditable={editor.locEditable}
              descSuggestion={editor.descSuggestion} descStale={editor.descStale}
              replacementTool={replacement}
              onPickReplacement={() => editor.setPickReplacement(true)}
            />

            {/* A scan's purchasing rows replay against a FROZEN base, so the
                ordinary panel is stood down for that session — it would be a
                second, competing editor of the same object. */}
            {editing && (scan.purchRows.length > 0 || scan.homelessProposals.length > 0) && (
              <SpecPurchasingPanel
                rows={scan.purchRows}
                homeless={scan.homelessProposals}
                unit={draft.unit}
                newMfgAck={scan.newMfgAck}
                onAck={scan.setNewMfgAck}
                onResolveRow={scan.resolvePurchRow}
                onResolveField={scan.resolveProposal}
              />
            )}

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

                {/* ⚠️ Controlled while the page is in edit mode — the
                    uncontrolled panel writes `{...tool, purchasing}` from the
                    SAVED record, which would revert every unsaved edit beside
                    it. Outside edit mode it keeps its own pencil and quick
                    save: purchasing is metadata-only, so that costs no Fusion
                    round-trip and is the fastest way to fix a price. */}
                {editing ? (
                  scan.purchRows.length === 0 && (
                    <PurchasingSection
                      tool={draft}
                      value={draft.purchasing}
                      onChange={p => editor.setField('purchasing', p)}
                    />
                  )
                ) : (
                  <PurchasingSection
                    tool={tool}
                    isSaving={isSaving}
                    onSave={metaSave}
                  />
                )}
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

            <NotesPanel
              data={draft} setField={editor.setField} editing={editing}
              tagInput={editor.tagInput} setTagInput={editor.setTagInput}
            />

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

        {/* ⚠️ ONE SAVE, ONE PLACE. The page has a single Edit button and this
            single bar — the owner's call: "a mode that lets you edit
            intentionally, not a separate page". Nothing here says whether the
            edit is going to Fusion or only to the metadata file; that is routed
            in handleSave and is deliberately not the user's problem. */}
        {editing && (
          <div className="form-actions-bar">
            {/* Delete stays edit-only, and pushed away from Save/Cancel so it
                is not fat-fingered. The heavy confirmation is the page's. */}
            <button
              className="btn btn-danger"
              onClick={() => { setDeleteError(''); setDeleteMode('normal'); }}
              disabled={isSaving}
              title="Delete this tool permanently"
              style={{ marginRight: 'auto' }}
            >
              <Trash2 size={15} /> Delete
            </button>
            <span className={`form-dirty ${editor.dirty ? 'show' : ''}`}>
              {editor.dirty ? 'Unsaved changes' : 'No changes'}
            </span>
            <span className="form-hint text-xs text-sub">⌘/Ctrl+S to save · Esc to cancel</span>
            <button className="btn btn-secondary" onClick={editor.handleCancel} disabled={isSaving}>Cancel</button>
            <button className="btn btn-primary" onClick={editor.handleSave} disabled={isSaving}>
              {isSaving
                ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Saving…</>
                : <><Save size={15} /> Save Changes</>}
            </button>
          </div>
        )}

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
        <ExtractUpdateModal
          open={scan.open}
          tool={draft}
          onClose={() => scan.setOpen(false)}
          onProposals={scan.receiveProposals}
        />

        {/* Reuses the linked-tools picker — the same search the landing page
            runs, so a ProShop #, EDP# or retired ID finds the replacement
            exactly as it would anywhere else. Stores the tracking id. */}
        {editor.pickReplacement && (
          <ToolLinkPicker
            tool={{ id: draft.id }}
            onPick={(t) => { editor.setField('replaced_by', t.id); editor.setPickReplacement(false); }}
            onClose={() => editor.setPickReplacement(false)}
          />
        )}

        {/* Save / Discard / Stay — the same three answers Settings gives, because
            it is the same question. Discard leaves edit mode, which re-seeds the
            draft from the record. */}
        {leaveTo && (
          <div className="modal-backdrop">
            <div className="modal">
              <h3 className="modal-title">Unsaved changes</h3>
              <p className="modal-body">
                You have unsaved changes to this tool. Save them before leaving?
              </p>
              <div className="modal-actions">
                <button className="btn btn-ghost" onClick={() => setLeaveTo(null)}>Stay</button>
                <button className="btn btn-secondary" onClick={() => { const go = leaveTo; setLeaveTo(null); exitEdit(); go(); }}>
                  Discard
                </button>
                <button className="btn btn-primary" disabled={isSaving} onClick={async () => {
                  const go = leaveTo;
                  setLeaveTo(null);
                  // ⚠️ Only leave if the save actually landed — a failed write
                  // that navigated away would take the edit with it.
                  try { await editor.handleSave(); go(); }
                  catch { /* the context toasts; the draft stays on screen */ }
                }}>Save &amp; leave</button>
              </div>
            </div>
          </div>
        )}

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
