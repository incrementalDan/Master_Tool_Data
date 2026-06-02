import { useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Pencil, Download, FileDown, Copy, Trash2, GitMerge,
  Tag, Ruler, Settings2, StickyNote, Clock, ExternalLink, Hash, Package, Wrench,
} from 'lucide-react';
import PresetPanel from './PresetPanel.jsx';
import HolderPicker from './HolderPicker.jsx';
import AssemblyCard, { holderColor } from './AssemblyCard.jsx';
import AssemblyForm from './AssemblyForm.jsx';
import { useApp } from '../context/AppContext.jsx';
import { TOOL_TYPE_LABELS } from '../schema/toolSchema.js';
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
  const { tools, saveTool, deleteTool, cloneTool, isSaving, notify, holders, holderLibraryLocation } = useApp();
  const [editing, setEditing] = useState(searchParams.get('edit') === '1');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [copied, setCopied] = useState(false);
  const [selectedExportAssemblyId, setSelectedExportAssemblyId] = useState('');

  const tool = tools.find(t => t.id === id);
  const isMetric = tool?.unit === 'millimeters';
  const lenUnit = isMetric ? 'mm' : 'in';

  if (!tool) {
    return (
      <div className="loading-screen">
        <span className="text-sub">Tool not found.</span>
        <button className="btn btn-secondary" onClick={() => navigate('/')}>Back to Library</button>
      </div>
    );
  }

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
          coolant: p0['tool-coolant'] ?? tool.coolant ?? 'flood',
        }),
      });
    } catch { /* toast handled in context */ }
  };

  const typeLabel = TOOL_TYPE_LABELS[tool.tool_type] || tool.tool_type;
  const assemblies = tool.assemblies || [];
  const selectedExportAssembly = selectedExportAssemblyId
    ? assemblies.find(a => a.assembly_id === selectedExportAssemblyId) || null
    : null;

  if (editing) {
    return (
      <div>
        <div className="flex items-center gap-8 mb-16">
          <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); clearEditParam(); }}>
            <ArrowLeft size={14} /> Back
          </button>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Edit Tool</h2>
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
        <SidebarBtn icon={ArrowLeft} label="Back" tip="Go back" onClick={() => navigate(-1)} />
        <div className="tool-sidebar-divider" />
        <SidebarBtn icon={Pencil} label="Edit" tip="Edit this tool" onClick={() => setEditing(true)} />
        <SidebarBtn icon={Copy} label="Duplicate" tip="Duplicate tool" onClick={handleClone} />
        <SidebarBtn icon={GitMerge} label="Sync Job" tip="Sync proven values from a job file" onClick={() => navigate(`/merge/${tool.id}`)} />
        <div className="tool-sidebar-divider" />
        <SidebarBtn
          icon={Copy}
          label={copied ? 'Copied!' : 'Copy JSON'}
          tip="Copy Fusion JSON to clipboard"
          className={copied ? 'copied' : ''}
          onClick={async () => {
            try {
              await copyToolToClipboard(tool, holders, selectedExportAssembly);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              notify('Clipboard not available — use Download JSON instead', 'error');
            }
          }}
        />
        <SidebarBtn
          icon={Download}
          label="Download"
          tip="Download Fusion JSON"
          onClick={() => { exportFusion(tool, holders, selectedExportAssembly); notify('Exported Fusion JSON', 'success'); }}
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
        {/* Sticky header — shows type icon, ProShop ID (left), description (right) */}
        <div className="tool-sticky-header">
          <span className="tool-sticky-header-icon">
            <ToolTypeIcon type={tool.tool_type} size={24} />
          </span>
          <div className="tool-sticky-header-body">
            <div className="detail-header-type">{typeLabel}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              {tool.proshot_id && (
                <a
                  className="proshot-pill"
                  href={proshotUrl(tool.proshot_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open in ProShop"
                  onClick={e => e.stopPropagation()}
                >{tool.proshot_id}</a>
              )}
              <h1
                className="detail-header-title description-badge"
                style={{
                  fontSize: 'clamp(12px, 1.5vw, 16px)',
                  maxWidth: '50ch',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flexShrink: 1,
                  minWidth: 0,
                }}
              >
                {tool.description || '—'}
              </h1>
            </div>
          </div>
        </div>

        {/* Assembly selector for Fusion JSON export — shown only when assemblies exist */}
        {assemblies.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 12 }}>
            <span className="text-sub" style={{ whiteSpace: 'nowrap' }}>Export assembly:</span>
            <select
              className="field-input"
              style={{ fontSize: 12, height: 28, maxWidth: 300 }}
              value={selectedExportAssemblyId}
              onChange={e => setSelectedExportAssemblyId(e.target.value)}
            >
              <option value="">None</option>
              {assemblies.map(a => (
                <option key={a.assembly_id} value={a.assembly_id}>
                  {a.holder_description || 'Assembly'} — OOH: {a.ooh?.toFixed(3)}"
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="detail-layout">
          <div>
            <Section title="Identity" icon={Tag}>
              {/* Machine tool number inside Identity */}
              {(tool.machine_tool_number !== null && tool.machine_tool_number !== undefined && tool.machine_tool_number !== '') && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', marginBottom: 10, borderBottom: '1px solid var(--border)' }}>
                  <Hash size={14} style={{ color: 'var(--orange)', flexShrink: 0 }} />
                  <span className="text-sub" style={{ fontSize: 12 }}>Machine Tool #</span>
                  <span className="font-mono" style={{ fontSize: 15, fontWeight: 700 }}>
                    T{tool.machine_tool_number} · H{tool.machine_tool_number} · D{tool.machine_tool_number}
                  </span>
                </div>
              )}
              <div className="detail-fields">
                <Field label="Description" value={tool.description} />
                <Field label="Type" value={typeLabel} />
                <Field label="Manufacturer" value={tool.vendor} />
                <Field label="Mfr Part # (EDP)" value={tool.product_id} mono />
                <Field label="ProShop ID" value={tool.proshot_id} mono href={proshotUrl(tool.proshot_id)} />
                <Field label="Distributor" value={tool.distributor} />
                <Field label="Dist Stock #" value={tool.distributor_stock_num} mono />
                <Field label="Cost" value={tool.cost ? `$${tool.cost}` : null} />
                {tool.product_link && (
                  <div className="detail-field">
                    <div className="detail-field-label">Product Link</div>
                    <a href={tool.product_link} target="_blank" rel="noopener noreferrer" className="text-sm inline-link">
                      Open <ExternalLink size={12} />
                    </a>
                  </div>
                )}
              </div>
            </Section>

            <Section title="Geometry" icon={Ruler}>
              <div className="detail-fields">
                <Field label="Diameter" value={round4(tool.diameter)} unit={lenUnit} />
                <Field label="Flute Length" value={round4(tool.flute_length)} unit={lenUnit} />
                <Field label="Overall Length" value={round4(tool.overall_length)} unit={lenUnit} />
                <Field label="# Flutes" value={tool.number_of_flutes} />
                <Field label="Shank Ø" value={round4(tool.shank_diameter)} unit={lenUnit} />
                {(tool.corner_radius !== null && tool.corner_radius !== undefined) && <Field label="Corner Radius" value={round4(tool.corner_radius)} unit={lenUnit} />}
                {tool.shoulder_length && <Field label="Shoulder Length" value={round4(tool.shoulder_length)} unit={lenUnit} />}
                {tool.tip_angle && <Field label="Tip Angle" value={round4(tool.tip_angle)} unit="°" />}
                {tool.taper_angle && <Field label="Taper Angle" value={round4(tool.taper_angle)} unit="°" />}
                {tool.tip_diameter && <Field label="Tip Diameter" value={round4(tool.tip_diameter)} unit={lenUnit} />}
                {tool.lower_radius && <Field label="Lower Radius" value={round4(tool.lower_radius)} unit={lenUnit} />}
                {tool.upper_radius && <Field label="Upper Radius" value={round4(tool.upper_radius)} unit={lenUnit} />}
                {tool.profile_radius && <Field label="Profile Radius" value={round4(tool.profile_radius)} unit={lenUnit} />}
                {tool.axial_distance && <Field label="Axial Distance" value={round4(tool.axial_distance)} unit={lenUnit} />}
              </div>
            </Section>

            <HolderSection
              tool={tool}
              holders={holders}
              holderLibrarySetupComplete={!!holderLibraryLocation}
              onSelectHolder={async (guid) => {
                try {
                  await saveTool({ ...tool, selected_holder_guid: guid });
                  notify('Holder updated', 'success');
                } catch { /* toast handled in context */ }
              }}
            />

            <AssembliesSection
              tool={tool}
              holders={holders}
              onSave={async (updatedTool) => {
                try {
                  await saveTool(updatedTool);
                } catch { /* toast handled in context */ }
              }}
            />

            <PresetPanel tool={tool} onSave={handlePresetsChange} isSaving={isSaving} />

            <Section title="Setup" icon={Settings2}>
              <div className="detail-fields">
                <Field label="Tool Material" value={tool.material} />
                <Field label="Coating" value={tool.coating} />
                <Field label="Coolant" value={tool.coolant} />
                <Field label="Helix Angle" value={round4(tool.helix_angle)} unit="°" />
                <Field label="Flute Type" value={tool.flute_type} />
                <Field label="Cutting Direction" value={tool.cutting_direction} />
                <Field label="Center Cutting" value={tool.center_cutting != null ? (tool.center_cutting ? 'Yes' : 'No') : null} />
                <Field label="Preferred Machine" value={tool.preferred_machine} />
                <Field label="Location" value={tool.location} mono />
                {tool.pitch && <Field label="Thread Pitch" value={tool.pitch} />}
                {tool.tap_class && <Field label="Tap Class" value={tool.tap_class} />}
                {tool.point_type && <Field label="Point Type" value={tool.point_type} />}
              </div>
              {(tool.material_suitability || []).length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div className="detail-field-label">Material Suitability</div>
                  <div className="tag-list" style={{ marginTop: 6 }}>
                    {tool.material_suitability.map(m => <span key={m} className="tag">{m}</span>)}
                  </div>
                </div>
              )}
            </Section>

            <Section title="History" icon={Clock}>
              <div className="detail-fields">
                <Field label="Created" value={tool.created_at ? new Date(tool.created_at).toLocaleString() : null} />
                <Field label="Updated" value={tool.updated_at ? new Date(tool.updated_at).toLocaleString() : null} />
                <Field label="Updated By" value={tool.updated_by} />
              </div>
            </Section>

            {(tool.merge_history || []).length > 0 && (
              <Section title="Merge History" icon={GitMerge}>
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
              </Section>
            )}
          </div>

          {/* Right sidebar — Notes & Tags only */}
          <div>
            <Section title="Notes & Tags" icon={StickyNote}>
              {tool.notes && (
                <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, marginBottom: 10 }}>{tool.notes}</p>
              )}
              {(tool.tags || []).length > 0 && (
                <div className="tag-list mb-12">
                  {tool.tags.map(t => <span key={t} className="tag">{t}</span>)}
                </div>
              )}
              {tool.last_used_job && <Field label="Last Used Job" value={tool.last_used_job} />}
              {tool.revision_notes && <Field label="Revision Notes" value={tool.revision_notes} />}
              {!tool.notes && !(tool.tags || []).length && !tool.last_used_job && !tool.revision_notes && (
                <span className="detail-field-empty text-sm">No notes yet.</span>
              )}
            </Section>
          </div>
        </div>

        {/* Delete confirmation modal */}
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

function gaugeToInches(gaugeLength, unit) {
  return unit === 'millimeters' ? gaugeLength / 25.4 : gaugeLength;
}

function HolderSection({ tool, holders, holderLibrarySetupComplete, onSelectHolder }) {
  const navigate = useNavigate();
  const [showPicker, setShowPicker] = useState(false);

  const selectedHolder = tool.selected_holder_guid
    ? holders.find(h => h.guid === tool.selected_holder_guid)
    : null;

  if (!holderLibrarySetupComplete) {
    return (
      <Section title="Holder" icon={Package}>
        <span className="text-sub text-sm">
          Holder library not configured —{' '}
          <button
            className="btn btn-ghost btn-sm"
            style={{ padding: 0, textDecoration: 'underline', fontWeight: 400, fontSize: 13 }}
            onClick={() => navigate('/settings')}
          >
            set up in Settings
          </button>
        </span>
      </Section>
    );
  }

  const hColor = selectedHolder ? holderColor(selectedHolder.description) : null;

  return (
    <Section title="Holder" icon={Package}>
      {selectedHolder ? (
        <div style={{ marginBottom: 10 }}>
          <span className="holder-pill" style={hColor ? { background: hColor.bg, borderColor: hColor.border, color: hColor.text } : {}}>
            {selectedHolder.description}
          </span>
          <div className="text-sub text-sm" style={{ marginTop: 6 }}>
            Gauge Length: {gaugeToInches(selectedHolder.gaugeLength ?? 0, selectedHolder.unit).toFixed(3)} in
            {selectedHolder.vendor ? ` · ${selectedHolder.vendor}` : ''}
          </div>
        </div>
      ) : (
        <div className="detail-field-empty text-sm" style={{ marginBottom: 10 }}>
          No holder selected
        </div>
      )}
      <button className="btn btn-secondary btn-sm" onClick={() => setShowPicker(true)}>
        {selectedHolder ? 'Change Holder' : 'Select Holder'}
      </button>

      {showPicker && (
        <HolderPicker
          currentGuid={tool.selected_holder_guid || null}
          onSelect={async (guid) => {
            setShowPicker(false);
            await onSelectHolder(guid);
          }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </Section>
  );
}

function AssembliesSection({ tool, holders, onSave }) {
  const [showForm, setShowForm] = useState(false);
  const [editingAssembly, setEditingAssembly] = useState(null);
  const assemblies = tool.assemblies || [];

  const handleEdit = (assembly) => {
    setEditingAssembly(assembly);
    setShowForm(true);
  };

  const handleDelete = async (assemblyId) => {
    await onSave({ ...tool, assemblies: assemblies.filter(a => a.assembly_id !== assemblyId) });
  };

  return (
    <Section title="Assemblies" icon={Wrench}>
      {assemblies.length === 0 && (
        <div className="detail-field-empty text-sm" style={{ marginBottom: 10 }}>
          No assemblies recorded yet.
        </div>
      )}
      <div className="assemblies-grid">
        {assemblies.map(a => (
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
      <button
        className="btn btn-secondary btn-sm"
        style={{ marginTop: assemblies.length > 0 ? 4 : 0 }}
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
            setShowForm(false);
            setEditingAssembly(null);
            await onSave(updatedTool);
          }}
          onClose={() => { setShowForm(false); setEditingAssembly(null); }}
        />
      )}
    </Section>
  );
}

function Section({ title, icon: Icon, children }) {
  const [open, setOpen] = useState(true);
  return (
    <div className={`panel ${open ? 'open' : ''}`}>
      <button className="panel-header" onClick={() => setOpen(o => !o)}>
        {Icon && <Icon size={15} className="panel-header-icon" />}
        <span className="panel-header-title">{title}</span>
        <span className="panel-chevron">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="panel-body">{children}</div>}
    </div>
  );
}

// Round a numeric value to at most 4 decimal places (trailing zeros dropped).
// Non-numeric / empty values pass through unchanged.
function round4(v) {
  if (v === null || v === undefined || v === '') return v;
  const n = Number(v);
  if (isNaN(n)) return v;
  return Math.round(n * 10000) / 10000;
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
