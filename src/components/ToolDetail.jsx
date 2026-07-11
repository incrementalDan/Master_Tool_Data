import { useState, useMemo, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Pencil, Download, FileDown, Copy, Trash2, GitMerge,
  Ruler, StickyNote, Clock, Wrench, AlertTriangle, Camera,
  ChevronDown, ChevronRight, FileJson, MapPin, Link2, Unlink, CloudOff,
} from 'lucide-react';
import PresetPanel from './PresetPanel.jsx';
import LocationPicker from './LocationPicker.jsx';
import AssemblyCard, { holderColor } from './AssemblyCard.jsx';
import AssemblyForm from './AssemblyForm.jsx';
import ReconcileModal from './ReconcileModal.jsx';
import FilesSection from './FilesSection.jsx';
import PurchasingSection from './PurchasingSection.jsx';
import SpeedFeedSection from './SpeedFeedSection.jsx';
import JobsSection from './JobsSection.jsx';
import AttachmentUploadModal from './AttachmentUploadModal.jsx';
import PhotoSlot from './PhotoSlot.jsx';
import PairingSections from './PairingSections.jsx';
import DriftBanner from './DriftBanner.jsx';
import {
  INSERT_FAMILY_BY_ID, ALWAYS_INSERT_TYPES, autoInsertFamily, newPairing,
} from '../schema/insertFamilies.js';
import InfoTip from './InfoTip.jsx';
import { useApp } from '../context/AppContext.jsx';
import { TOOL_TYPE_LABELS, validateGeometry, fusionToolToInternal, readOohFromFusion } from '../schema/toolSchema.js';
import { convertLength, unitAbbr } from '../utils/units.js';
import { showsProShopUrl, toolIdLabel } from '../utils/toolIdSystem.js';
import ToolFields from './ToolFields.jsx';
import { hasReconcileWork } from '../services/reconcile.js';
import ToolTypeIcon from './icons/ToolTypeIcon.jsx';
import ToolForm from './ToolForm.jsx';
import { exportSingleTool as exportFusion, copyToolToClipboard } from '../utils/fusionExport.js';
import { exportSingleTool as exportProShop } from '../utils/proShopExport.js';

function proshotUrl(id) {
  if (!id) return null;
  const prefix = id.split('-')[0];
  return `https://americanprecisionworks.adionsystems.com/procnc/tools/${prefix}/${id}$`;
}

export default function ToolDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    tools, saveTool, deleteTool, cloneTool, isSaving, notify, holders, holderLibraryLocation,
    reconcileTool, googleAuthenticated, uploadToolPhoto, uploadToolAttachment, deleteToolAttachment,
    shopSettings, promoteToolToFusion, detachToolFromFusion, fusionEnabled, fusionAuthority,
  } = useApp();
  const idMode = shopSettings?.tool_id_system?.mode || 'proshop';
  const [editing, setEditing] = useState(searchParams.get('edit') === '1');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [copied, setCopied] = useState(false);
  const [showExportPicker, setShowExportPicker] = useState(null); // null | 'copy' | 'download'
  const [reconcileResults, setReconcileResults] = useState(null);
  const [showPhotoUpload, setShowPhotoUpload] = useState(false);

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
    let cancelled = false;
    (async () => {
      try {
        const results = await reconcileTool(tool);
        if (!cancelled && hasReconcileWork(results)) setReconcileResults(results);
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

  const handlePromote = async () => {
    try { await promoteToolToFusion(tool.id); }
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

  const handleSave = async (updated) => {
    await saveTool(updated);
    setEditing(false);
    clearEditParam();
  };

  const handleDelete = async () => {
    setDeleteError('');
    try {
      await deleteTool(id);
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
  const sectionSave = async (updatedTool) => {
    try { await saveTool(updatedTool); }
    catch { /* toast handled in context */ }
  };

  if (editing) {
    return (
      <div>
        {/* Same sticky identity header as view mode, so the tool you're editing
            stays visible while scrolling a long form. */}
        <div className="tool-sticky-header">
          <span className="tool-sticky-header-icon">
            <ToolTypeIcon type={tool.tool_type} size={30} />
          </span>
          <div className="tool-sticky-header-body">
            <div className="flex items-center gap-10" style={{ minWidth: 0 }}>
              <div className="detail-header-type" style={{ fontSize: 12, flexShrink: 0 }}>Editing · {typeLabel}</div>
              <span
                className="description-badge"
                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
              >
                {tool.description || '—'}
              </span>
              {tool.tool_id && <span className="tool-id-pill">{tool.tool_id}</span>}
            </div>
          </div>
          {(tool.location || hasMachineNum) && (
            <div className="tool-sticky-identity">
              {tool.location && (
                <div className="sticky-identity-group">
                  <span className="sticky-identity-label">Location</span>
                  <span className="location-tag">{tool.location}</span>
                </div>
              )}
              {hasMachineNum && (
                <div className="sticky-identity-group">
                  <span className="sticky-identity-label">Machine&nbsp;#</span>
                  <span className="machine-num-badge">T{tool.machine_tool_number}</span>
                  <span className="machine-num-badge">H{tool.machine_tool_number}</span>
                  <span className="machine-num-badge">D{tool.machine_tool_number}</span>
                </div>
              )}
            </div>
          )}
        </div>
        <ToolForm
          tool={tool}
          onSave={handleSave}
          onCancel={() => { setEditing(false); clearEditParam(); }}
          isSaving={isSaving}
          isNew={false}
        />
      </div>
    );
  }

  return (
    <div className="tool-detail-wrap">
      {/* Frozen left action sidebar */}
      <aside className="tool-action-sidebar">
        <SidebarBtn icon={ArrowLeft} label="Back" tip="Go back" onClick={guardLeave(() => navigate(-1))} />
        <div className="tool-sidebar-divider" />
        <SidebarBtn icon={Pencil} label="Edit" tip="Edit this tool" onClick={guardLeave(() => setEditing(true))} />
        <SidebarBtn icon={Copy} label="Duplicate" tip="Duplicate tool" onClick={handleClone} />
        {/* Sync Job is a Fusion-library workflow — hidden for a no-Fusion tool. */}
        {!noFusion && (
          <SidebarBtn icon={GitMerge} label="Sync Job" tip="Sync proven values from a job file" onClick={() => navigate(`/merge/${tool.id}`)} />
        )}
        <div className="tool-sidebar-divider" />
        {/* Promote a no-Fusion tool into the Fusion library, or detach a linked one.
            Only when the Fusion integration is on (both are no-ops when it's off). */}
        {fusionEnabled && (
          toolIsNoFusion ? (
            <SidebarBtn icon={Link2} label="Create in Fusion" tip="Create this tool in the Fusion library (promote from no-Fusion)" onClick={handlePromote} />
          ) : (
            <SidebarBtn icon={Unlink} label="Detach" tip="Remove from the Fusion library (keeps all app data)" onClick={handleDetach} />
          )
        )}
        {!noFusion && (
          <SidebarBtn
            icon={Copy}
            label={copied ? 'Copied!' : 'Copy to Fusion'}
            tip="Copy Fusion JSON to clipboard (Ctrl+V into Fusion library)"
            className={copied ? 'copied' : ''}
            onClick={() => setShowExportPicker('copy')}
          />
        )}
        <SidebarBtn
          icon={Download}
          label="Download"
          tip="Download Fusion JSON file"
          onClick={() => setShowExportPicker('download')}
        />
        <SidebarBtn
          icon={FileDown}
          label="ProShop"
          tip="Export ProShop CSV"
          style={{ color: 'var(--orange)' }}
          onClick={() => { exportProShop(tool); notify('Exported ProShop CSV', 'success'); }}
        />
        <div style={{ flex: 1 }} />
        <SidebarBtn
          icon={Trash2}
          label="Delete"
          tip="Delete tool permanently"
          className="danger"
          onClick={() => setShowDeleteModal(true)}
        />
      </aside>

      {/* Main content */}
      <div className="tool-detail-main">
        {/* Sticky header — type icon + description left, identity (cabinet/machine#) right */}
        <div className="tool-sticky-header">
          <span className="tool-sticky-header-icon">
            <ToolTypeIcon type={tool.tool_type} size={30} />
          </span>
          <div className="tool-sticky-header-body">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <div className="detail-header-type" style={{ fontSize: 12, flexShrink: 0 }}>{typeLabel}</div>
              <h1
                className="detail-header-title description-badge"
                style={{
                  fontSize: 'clamp(15px, 2vw, 20px)',
                  padding: '4px 12px 5px',
                  maxWidth: '60ch',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flexShrink: 1,
                  minWidth: 0,
                }}
              >
                {tool.description || '—'}
              </h1>
              {tool.tool_type === 'tap' && tool.is_sti && (
                <span className="sti-pill" title="STI / Helicoil — thread insert tap">STI / Helicoil</span>
              )}
              {tool.no_fusion_link && (
                <span className="no-fusion-pill">
                  <AlertTriangle size={12} /> No Fusion Link
                </span>
              )}
            </div>
            {tool.tool_id && (
              showsProShopUrl(idMode) ? (
                <a
                  className="tool-id-pill"
                  href={proshotUrl(tool.tool_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open in ProShop"
                  onClick={e => e.stopPropagation()}
                  style={{ fontSize: 15, padding: '4px 16px', alignSelf: 'flex-start' }}
                >{tool.tool_id}</a>
              ) : (
                <span
                  className="tool-id-pill"
                  title={toolIdLabel(idMode)}
                  style={{ fontSize: 15, padding: '4px 16px', alignSelf: 'flex-start' }}
                >{tool.tool_id}</span>
              )
            )}
          </div>
          {(tool.location || hasMachineNum) && (
            <div className="tool-sticky-identity">
              {tool.location && (
                <div className="sticky-identity-group">
                  <span className="sticky-identity-label">Location</span>
                  <span className="location-tag">{tool.location}</span>
                </div>
              )}
              {hasMachineNum && (
                <div className="sticky-identity-group">
                  <span className="sticky-identity-label">Machine&nbsp;#</span>
                  <span className="machine-num-badge">T{tool.machine_tool_number}</span>
                  <span className="machine-num-badge">H{tool.machine_tool_number}</span>
                  <span className="machine-num-badge">D{tool.machine_tool_number}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* D3 — field-level Fusion drift review. Only for linked tools (a no-Fusion
            tool has no Fusion side to differ from). Keyed by tool.id so the
            per-field choices reset when navigating between tools. */}
        {!noFusion && (
          <DriftBanner
            key={tool.id}
            tool={tool}
            authority={fusionAuthority}
            isSaving={isSaving}
            onApply={handleApplyDrift}
          />
        )}

        {/* Insert-style tool: pairing bar + the Holder Body / Insert component
            groups (each with its own Geometry & setup, Photo, Location and
            Purchasing). Everything below stays shared. */}
        {pairing && (
          <PairingSections
            key={tool.id}
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
              <ToolFields tool={tool} mode="view" />
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
                  await saveTool(updatedTool);
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

                <Section title="Location" icon={MapPin} defaultOpen={false}>
                  <LocationPicker tool={tool} />
                </Section>

                <PurchasingSection
                  tool={tool}
                  isSaving={isSaving}
                  onSave={sectionSave}
                />
              </>
            )}

            {/* Structured job links (program # + part #) — supersedes the old
                free-text "Last Used Job" display (data kept, no longer shown). */}
            <JobsSection
              tool={tool}
              onSave={async (updatedTool) => {
                await saveTool(updatedTool);
              }}
            />

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

        {/* Delete confirmation modal */}
        {reconcileResults && (
          <ReconcileModal
            tool={tool}
            results={reconcileResults}
            onClose={() => setReconcileResults(null)}
            onResolved={refreshReconcile}
            onReviewConflict={reviewConflict}
          />
        )}

        {showDeleteModal && (
          <div className="modal-backdrop">
            <div className="modal">
              <h3 className="modal-title">Delete Tool?</h3>
              <p className="modal-body">
                <strong>{tool.description || 'This tool'}</strong> will be permanently removed from the library. This cannot be undone.
              </p>
              {deleteError && <div className="error-banner mb-12">{deleteError}</div>}
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => setShowDeleteModal(false)}>Cancel</button>
                <button className="btn btn-danger" onClick={handleDelete} disabled={isSaving}>
                  {isSaving ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SidebarBtn({ icon: Icon, label, tip, onClick, style, className = '' }) {
  return (
    <button
      className={`tool-sidebar-btn ${className}`}
      title={tip}
      onClick={onClick}
      style={style}
    >
      <Icon size={22} />
      <span>{label}</span>
    </button>
  );
}


function AssembliesSection({ tool, holders, onSave }) {
  const [showForm, setShowForm] = useState(false);
  const [editingAssembly, setEditingAssembly] = useState(null);
  const [pendingAssembly, setPendingAssembly] = useState(null);
  const assemblies = tool.assemblies || [];

  // Group by holder description, sort each group short → long OOH
  const groups = useMemo(() => {
    const map = new Map();
    for (const a of assemblies) {
      const key = a.holder_description || '—';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(a);
    }
    for (const [, g] of map) g.sort((a, b) => (a.ooh ?? 0) - (b.ooh ?? 0));
    return [...map.entries()];
  }, [assemblies]);

  const handleEdit = (assembly) => { setEditingAssembly(assembly); setShowForm(true); };
  const handleDelete = async (assemblyId) => {
    await onSave({ ...tool, assemblies: assemblies.filter(a => a.assembly_id !== assemblyId) });
  };

  // Clear pendingAssembly once the real data lands in the tool prop
  const prevAssemblyIds = useRef(new Set(assemblies.map(a => a.assembly_id)));
  useEffect(() => {
    if (!pendingAssembly) return;
    const ids = new Set(assemblies.map(a => a.assembly_id));
    if (ids.has(pendingAssembly.assembly_id)) setPendingAssembly(null);
    prevAssemblyIds.current = ids;
  }, [assemblies, pendingAssembly]);

  return (
    <Section title="Assemblies" icon={Wrench}>
      {assemblies.length === 0 && !pendingAssembly && (
        <div className="detail-field-empty text-sm" style={{ marginBottom: 10 }}>
          No assemblies recorded yet.
        </div>
      )}
      {groups.map(([holderDesc, group]) => {
        const c = holderColor(holderDesc === '—' ? null : holderDesc);
        return (
          <div key={holderDesc} style={{ marginBottom: 10 }}>
            <div style={{ marginBottom: 4 }}>
              <span className="holder-pill" style={{ '--badge-color': c }}>
                {holderDesc}
              </span>
            </div>
            <div className="assemblies-grid">
              {group.map(a => (
                <AssemblyCard
                  key={a.assembly_id}
                  assembly={a}
                  tool={tool}
                  holders={holders}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Optimistic placeholder card while save is in flight */}
      {pendingAssembly && (() => {
        const c = holderColor(pendingAssembly.holder_description || null);
        return (
          <div style={{ marginBottom: 10 }}>
            <div style={{ marginBottom: 4 }}>
              <span className="holder-pill" style={{ '--badge-color': c }}>
                {pendingAssembly.holder_description || '—'}
              </span>
            </div>
            <div className="assemblies-grid">
              <div style={{
                border: '1px solid rgba(100, 116, 139, 0.30)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--surface-2)',
                padding: '6px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                opacity: 0.7,
              }}>
                <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                    OOH: {pendingAssembly.ooh?.toFixed(3)} {unitAbbr(tool.unit)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-sub)', marginTop: 2 }}>Saving…</div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <button
        className="btn btn-secondary btn-sm"
        style={{ marginTop: (assemblies.length > 0 || pendingAssembly) ? 4 : 0 }}
        onClick={() => { setEditingAssembly(null); setShowForm(true); }}
      >
        + Add Assembly
      </button>
      {showForm && (
        <AssemblyForm
          tool={tool}
          holders={holders}
          assembly={editingAssembly}
          onSave={async (updatedTool) => {
            const isNew = !editingAssembly;
            setShowForm(false);
            setEditingAssembly(null);
            if (isNew) {
              // Show the last assembly in the updated list as pending immediately
              const added = updatedTool.assemblies?.at(-1) ?? null;
              setPendingAssembly(added);
            }
            await onSave(updatedTool);
          }}
          onClose={() => { setShowForm(false); setEditingAssembly(null); }}
        />
      )}
    </Section>
  );
}

function Section({ title, icon: Icon, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`panel ${open ? 'open' : ''}`}>
      <button className="panel-header" onClick={() => setOpen(o => !o)}>
        {Icon && <Icon size={15} className="panel-header-icon" />}
        <span className="panel-header-title">{title}</span>
        <span className="panel-chevron">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </button>
      {open && <div className="panel-body">{children}</div>}
    </div>
  );
}

function AssemblyExportPicker({ tool, holders, onConfirm, onCancel }) {
  const assemblies = tool.assemblies || [];
  const [selected, setSelected] = useState('none'); // 'none' | assembly_id | 'new'
  const [newHolderGuid, setNewHolderGuid] = useState('');
  const [newOoh, setNewOoh] = useState('');

  const canConfirm = selected !== 'new' || (newHolderGuid && newOoh && parseFloat(newOoh) > 0);

  const handleConfirm = () => {
    if (selected === 'none') { onConfirm(null); return; }
    if (selected === 'new') {
      const holder = holders.find(h => h.guid === newHolderGuid);
      onConfirm({
        assembly_id: 'temp',
        holder_guid: newHolderGuid,
        holder_description: holder?.description || '',
        ooh: parseFloat(newOoh),
        linked_preset_guids: [],
        notes: '',
      });
      return;
    }
    onConfirm(assemblies.find(a => a.assembly_id === selected) || null);
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">Select Assembly for Export</h3>
        <p style={{ fontSize: 13, color: 'var(--text-sub)', marginBottom: 14 }}>
          Embed a holder and OOH (out-of-holder length) in the Fusion JSON. One-time assemblies are not saved.
        </p>

        <div
          className={`assembly-picker-option${selected === 'none' ? ' selected' : ''}`}
          onClick={() => setSelected('none')}
        >
          <span style={{ fontWeight: 600 }}>No assembly</span>
          <span className="text-sub" style={{ fontSize: 12 }}> — geometry only</span>
        </div>

        {assemblies.length > 0 && (
          <>
            <div className="text-sub" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '12px 0 6px' }}>Saved assemblies</div>
            {assemblies.map(a => {
              const c = holderColor(a.holder_description || null);
              const isSel = selected === a.assembly_id;
              return (
                <div
                  key={a.assembly_id}
                  className={`assembly-picker-option${isSel ? ' selected' : ''}`}
                  style={isSel ? { borderColor: c, background: `color-mix(in srgb, ${c} 12%, var(--input-bg))` } : {}}
                  onClick={() => setSelected(a.assembly_id)}
                >
                  <span className="holder-pill" style={{ '--badge-color': c }}>
                    {a.holder_description || '—'}
                  </span>
                  <span style={{ fontSize: 13 }}>OOH: {a.ooh?.toFixed(3)} {unitAbbr(tool.unit)}</span>
                  {(a.linked_preset_guids?.length > 0) && (
                    <span className="text-sub" style={{ fontSize: 11, marginLeft: 'auto' }}>
                      {a.linked_preset_guids.length} preset{a.linked_preset_guids.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              );
            })}
          </>
        )}

        <div className="text-sub" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '12px 0 6px' }}>One-time (not saved)</div>
        <div
          className={`assembly-picker-option${selected === 'new' ? ' selected' : ''}`}
          onClick={() => setSelected('new')}
        >
          <span style={{ fontWeight: 600 }}>Custom assembly</span>
          <span className="text-sub" style={{ fontSize: 12 }}> — specify holder + OOH</span>
        </div>

        {selected === 'new' && (
          <div style={{ padding: '12px', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', marginBottom: 6 }}>
            <div style={{ marginBottom: 10 }}>
              <label className="field-label">Holder</label>
              <select className="field-input" value={newHolderGuid} onChange={e => setNewHolderGuid(e.target.value)}>
                <option value="">— select holder —</option>
                {holders.map(h => <option key={h.guid} value={h.guid}>{h.description}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">OOH ({unitAbbr(tool.unit)})</label>
              <input
                className="field-input"
                type="number"
                step="0.001"
                min="0"
                placeholder="e.g. 2.300"
                value={newOoh}
                onChange={e => setNewOoh(e.target.value)}
                style={{ maxWidth: 130 }}
              />
            </div>
          </div>
        )}

        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className={`btn ${canConfirm ? 'btn-primary' : 'btn-secondary'}`} disabled={!canConfirm} onClick={handleConfirm}>
            Confirm &amp; Export
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, unit, mono, href }) {
  const isEmpty = value === null || value === undefined || value === '';
  const display = isEmpty ? '—' : (unit ? `${value} ${unit}` : String(value));
  return (
    <div className="detail-field">
      <div className="detail-field-label">{label}</div>
      {href && !isEmpty ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={`detail-field-value inline-link ${mono ? 'font-mono' : ''}`}
        >{display}</a>
      ) : (
        <div className={`detail-field-value ${isEmpty ? 'detail-field-empty' : ''} ${mono ? 'font-mono' : ''}`}>
          {display}
        </div>
      )}
    </div>
  );
}

