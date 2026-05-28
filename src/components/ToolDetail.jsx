import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { TOOL_TYPE_LABELS, TOOL_TYPE_ICONS, FIELD_LABELS } from '../schema/toolSchema.js';
import ToolForm from './ToolForm.jsx';
import { exportSingleTool as exportFusion } from '../utils/fusionExport.js';
import { exportSingleTool as exportProShop } from '../utils/proShopExport.js';

export default function ToolDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { tools, saveTool, deleteTool, isSaving } = useApp();
  const [editing, setEditing] = useState(false);
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

  const handleSave = async (updated) => {
    await saveTool(updated);
    setEditing(false);
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

  if (editing) {
    return (
      <div>
        <div className="flex items-center gap-8 mb-16">
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>← Back</button>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Edit Tool</h2>
        </div>
        <ToolForm
          tool={tool}
          onSave={handleSave}
          onCancel={() => setEditing(false)}
          isSaving={isSaving}
          isNew={false}
        />
      </div>
    );
  }

  const icon = TOOL_TYPE_ICONS[tool.tool_type] || '🔧';
  const typeLabel = TOOL_TYPE_LABELS[tool.tool_type] || tool.tool_type;

  return (
    <div>
      {/* Header */}
      <div className="action-bar">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>← Back</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: 'var(--text-sub)', marginBottom: 2 }}>
            {icon} {typeLabel}
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.3 }} className="truncate">
            {tool.description || '—'}
          </h1>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-8 mb-16" style={{ flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={() => setEditing(true)}>Edit</button>
        <button className="btn btn-secondary btn-sm" onClick={() => exportFusion(tool)}>↓ Fusion JSON</button>
        <button className="btn btn-secondary btn-sm" style={{ color: 'var(--orange)' }} onClick={() => exportProShop(tool)}>↓ ProShop CSV</button>
        <button className="btn btn-danger btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setShowDeleteModal(true)}>Delete</button>
      </div>

      <div className="detail-layout">
        <div>
          <Section title="Identity">
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
                  <a href={tool.product_link} target="_blank" rel="noopener noreferrer" className="text-sm" style={{ color: 'var(--blue)' }}>
                    Open ↗
                  </a>
                </div>
              )}
            </div>
          </Section>

          <Section title="Geometry">
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

          <Section title="Speeds & Feeds">
            <div className="detail-fields">
              <Field label="Spindle Speed" value={tool.spindle_speed} unit="RPM" />
              <Field label="Cutting Feedrate" value={tool.cutting_feedrate} unit="in/min" />
              <Field label="Feed per Tooth" value={tool.feed_per_tooth} unit="in" />
              <Field label="Feed per Rev" value={tool.feed_per_rev} unit="in" />
              <Field label="Plunge Feedrate" value={tool.plunge_feedrate} unit="in/min" />
              <Field label="Ramp Feedrate" value={tool.ramp_feedrate} unit="in/min" />
              <Field label="Lead-In Feedrate" value={tool.lead_in_feedrate} unit="in/min" />
              <Field label="Lead-Out Feedrate" value={tool.lead_out_feedrate} unit="in/min" />
              <Field label="Surface Speed" value={tool.cutting_speed} unit="SFM" />
              <Field label="Depth of Cut" value={tool.depth_of_cut} unit="in" />
              <Field label="Width of Cut" value={tool.width_of_cut} unit="in" />
            </div>
          </Section>

          <Section title="Setup">
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
              <div style={{ marginTop: 12 }}>
                <div className="detail-field-label">Material Suitability</div>
                <div className="tag-list" style={{ marginTop: 4 }}>
                  {tool.material_suitability.map(m => <span key={m} className="tag">{m}</span>)}
                </div>
              </div>
            )}
          </Section>
        </div>

        {/* Sidebar */}
        <div>
          <Section title="Notes & Tags">
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
          </Section>

          <Section title="History">
            <div className="detail-fields">
              <Field label="Created" value={tool.created_at ? new Date(tool.created_at).toLocaleString() : null} />
              <Field label="Updated" value={tool.updated_at ? new Date(tool.updated_at).toLocaleString() : null} />
              <Field label="Updated By" value={tool.updated_by} />
            </div>
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
  );
}

function Section({ title, children }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="collapsible mb-16">
      <button className="collapsible-toggle" onClick={() => setOpen(o => !o)}>
        <span>{open ? '▾' : '▸'}</span>
        {title}
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
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
