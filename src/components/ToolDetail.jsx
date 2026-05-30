import { useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Pencil, Download, FileDown, Copy, Trash2, GitMerge,
  Tag, Ruler, Gauge, Settings2, StickyNote, Clock, ExternalLink,
} from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { TOOL_TYPE_LABELS } from '../schema/toolSchema.js';
import ToolTypeIcon from './icons/ToolTypeIcon.jsx';
import ToolForm from './ToolForm.jsx';
import { exportSingleTool as exportFusion } from '../utils/fusionExport.js';
import { exportSingleTool as exportProShop } from '../utils/proShopExport.js';

export default function ToolDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { tools, saveTool, deleteTool, cloneTool, isSaving, notify } = useApp();
  const [editing, setEditing] = useState(searchParams.get('edit') === '1');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const tool = tools.find(t => t.id === id);

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

  const typeLabel = TOOL_TYPE_LABELS[tool.tool_type] || tool.tool_type;

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
    <div>
      {/* Header */}
      <div className="detail-header">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>
          <ArrowLeft size={14} /> Back
        </button>
        <span className="detail-header-icon"><ToolTypeIcon type={tool.tool_type} size={26} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="detail-header-type">{typeLabel}</div>
          <h1 className="detail-header-title truncate">{tool.description || '—'}</h1>
        </div>
      </div>

      {/* Actions */}
      <div className="action-bar">
        <button className="btn btn-primary" onClick={() => setEditing(true)}><Pencil size={15} /> Edit</button>
        <button className="btn btn-secondary btn-sm" onClick={handleClone}><Copy size={14} /> Duplicate</button>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/merge/${tool.id}`)} title="Sync proven values from a job file back to master">
          <GitMerge size={14} /> Sync from Job
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => { exportFusion(tool); notify('Exported Fusion JSON', 'success'); }}>
          <Download size={14} /> Fusion JSON
        </button>
        <button className="btn btn-secondary btn-sm" style={{ color: 'var(--orange)' }} onClick={() => { exportProShop(tool); notify('Exported ProShop CSV', 'success'); }}>
          <FileDown size={14} /> ProShop CSV
        </button>
        <button className="btn btn-danger btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setShowDeleteModal(true)}>
          <Trash2 size={14} /> Delete
        </button>
      </div>

      <div className="detail-layout">
        <div>
          <Section title="Identity" icon={Tag}>
            <div className="detail-fields">
              <Field label="Description" value={tool.description} />
              <Field label="Type" value={typeLabel} />
              <Field label="Manufacturer" value={tool.vendor} />
              <Field label="Mfr Part # (EDP)" value={tool.product_id} mono />
              <Field label="ProShop ID" value={tool.proshot_id} mono />
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
              <Field label="Diameter" value={tool.diameter} unit="in" />
              <Field label="Flute Length" value={tool.flute_length} unit="in" />
              <Field label="Overall Length" value={tool.overall_length} unit="in" />
              <Field label="# Flutes" value={tool.number_of_flutes} />
              <Field label="Shank Ø" value={tool.shank_diameter} unit="in" />
              {(tool.corner_radius !== null && tool.corner_radius !== undefined) && <Field label="Corner Radius" value={tool.corner_radius} unit="in" />}
              {tool.shoulder_length && <Field label="Shoulder Length" value={tool.shoulder_length} unit="in" />}
              {tool.tip_angle && <Field label="Tip Angle" value={tool.tip_angle} unit="°" />}
              {tool.taper_angle && <Field label="Taper Angle" value={tool.taper_angle} unit="°" />}
              {tool.tip_diameter && <Field label="Tip Diameter" value={tool.tip_diameter} unit="in" />}
              {tool.lower_radius && <Field label="Lower Radius" value={tool.lower_radius} unit="in" />}
              {tool.upper_radius && <Field label="Upper Radius" value={tool.upper_radius} unit="in" />}
              {tool.profile_radius && <Field label="Profile Radius" value={tool.profile_radius} unit="in" />}
              {tool.axial_distance && <Field label="Axial Distance" value={tool.axial_distance} unit="in" />}
            </div>
          </Section>

          <Section title="Speeds & Feeds" icon={Gauge}>
            <div className="detail-fields">
              <Field label="Spindle Speed" value={round4(tool.spindle_speed)} unit="RPM" />
              <Field label="Cutting Feedrate" value={round4(tool.cutting_feedrate)} unit="in/min" />
              <Field label="Feed per Tooth" value={round4(tool.feed_per_tooth)} unit="in" />
              <Field label="Feed per Rev" value={round4(tool.feed_per_rev)} unit="in" />
              <Field label="Plunge Feedrate" value={round4(tool.plunge_feedrate)} unit="in/min" />
              <Field label="Ramp Feedrate" value={round4(tool.ramp_feedrate)} unit="in/min" />
              <Field label="Lead-In Feedrate" value={round4(tool.lead_in_feedrate)} unit="in/min" />
              <Field label="Lead-Out Feedrate" value={round4(tool.lead_out_feedrate)} unit="in/min" />
              <Field label="Surface Speed" value={round4(tool.cutting_speed)} unit="SFM" />
              <Field label="Depth of Cut" value={round4(tool.depth_of_cut)} unit="in" />
              <Field label="Width of Cut" value={round4(tool.width_of_cut)} unit="in" />
            </div>
          </Section>

          <Section title="Setup" icon={Settings2}>
            <div className="detail-fields">
              <Field label="Tool Material" value={tool.material} />
              <Field label="Coating" value={tool.coating} />
              <Field label="Coolant" value={tool.coolant} />
              <Field label="Helix Angle" value={tool.helix_angle} unit="°" />
              <Field label="Flute Type" value={tool.flute_type} />
              <Field label="Cutting Direction" value={tool.cutting_direction} />
              <Field label="Center Cutting" value={tool.center_cutting != null ? (tool.center_cutting ? 'Yes' : 'No') : null} />
              <Field label="Preferred Machine" value={tool.preferred_machine} />
              <Field label="Location" value={tool.location} mono />
              <Field label="Tool Number" value={tool.tool_number} />
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
        </div>

        {/* Sidebar */}
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

function Field({ label, value, unit, mono }) {
  const isEmpty = value === null || value === undefined || value === '';
  return (
    <div className="detail-field">
      <div className="detail-field-label">{label}</div>
      <div className={`detail-field-value ${isEmpty ? 'detail-field-empty' : ''} ${mono ? 'font-mono' : ''}`}>
        {isEmpty ? '—' : (unit ? `${value} ${unit}` : String(value))}
      </div>
    </div>
  );
}
