import { useState, useEffect, useMemo } from 'react';
import { Tag, Ruler, Layers, Gauge, Settings2, Save, X, Hash, AlertTriangle } from 'lucide-react';
import { TOOL_TYPES, TOOL_TYPE_LABELS, FIELD_LABELS, MA, CO, WM, MANUFACTURER_LIST, COOLANT_OPTS, validateTool, validateGeometry, getVisibleFields, getNextMachineNumber } from '../schema/toolSchema.js';
import { useApp } from '../context/AppContext.jsx';
import ToolTypeIcon from './icons/ToolTypeIcon.jsx';

const NUMERIC_FIELDS = new Set(['diameter', 'flute_length', 'overall_length', 'shank_diameter', 'corner_radius', 'tip_angle', 'taper_angle', 'tip_diameter', 'lower_radius', 'upper_radius', 'profile_radius', 'axial_distance', 'shoulder_length', 'ooh', 'helix_angle', 'number_of_flutes', 'spindle_speed', 'cutting_feedrate', 'plunge_feedrate', 'ramp_feedrate', 'lead_in_feedrate', 'lead_out_feedrate', 'feed_per_tooth', 'feed_per_rev', 'cutting_speed', 'depth_of_cut', 'width_of_cut', 'min_thread_pitch', 'max_thread_pitch']);

const FIELD_STEP = {
  diameter: '0.0001', flute_length: '0.001', overall_length: '0.001', shank_diameter: '0.0001',
  corner_radius: '0.0001', tip_diameter: '0.0001', lower_radius: '0.0001', upper_radius: '0.0001',
  profile_radius: '0.0001', axial_distance: '0.001', shoulder_length: '0.001', ooh: '0.001',
  number_of_flutes: '1', spindle_speed: '1', cutting_feedrate: '0.1', plunge_feedrate: '0.1',
  ramp_feedrate: '0.1', lead_in_feedrate: '0.1', lead_out_feedrate: '0.1',
  feed_per_tooth: '0.0001', feed_per_rev: '0.0001', cutting_speed: '1',
  depth_of_cut: '0.001', width_of_cut: '0.001', tip_angle: '0.5', taper_angle: '0.5',
  helix_angle: '0.5', min_thread_pitch: '0.0001', max_thread_pitch: '0.0001',
};

// Map extractor key names to our field names for getVisibleFields results
const EXTRACTOR_TO_APP_FIELD = {
  toolType: 'tool_type', loc: 'flute_length', oal: 'overall_length', flutes: 'number_of_flutes',
  shankDia: 'shank_diameter', cornerRadius: 'corner_radius', edpNumber: 'product_id',
  approvedBrand: 'vendor', vendor: 'distributor', vendorStockNum: 'distributor_stock_num',
  productLink: 'product_link', presetName: 'preset_name', toolNumber: 'tool_number',
  helixAngle: 'helix_angle', centerCutting: 'center_cutting', fluteType: 'flute_type',
  cuttingDirection: 'cutting_direction', tapClass: 'tap_class', pointType: 'point_type',
  stubJobber: 'stub_jobber', doubleEnded: 'double_ended', fullProfile: 'full_profile',
  backsideCapable: 'backside_capable', tipAngle: 'tip_angle', tipDiameter: 'tip_diameter',
  taperAngle: 'taper_angle', lowerRadius: 'lower_radius', upperRadius: 'upper_radius',
  profileRadius: 'profile_radius', axialDistance: 'axial_distance',
  minThreadPitch: 'min_thread_pitch', maxThreadPitch: 'max_thread_pitch',
  psToolId: 'proshot_id', workpieceMats: 'material_suitability', shoulderLen: 'shoulder_length',
};

// Always-visible core fields (regardless of tool type visibility)
const ALWAYS_FIELDS = ['description', 'vendor', 'product_id', 'proshot_id', 'coating'];
const SPEEDS_FIELDS = ['spindle_speed', 'cutting_feedrate', 'feed_per_tooth', 'feed_per_rev', 'plunge_feedrate', 'ramp_feedrate', 'lead_in_feedrate', 'lead_out_feedrate', 'cutting_speed', 'depth_of_cut', 'width_of_cut'];
const META_FIELDS = ['notes', 'tags', 'preferred_machine', 'last_used_job', 'revision_notes', 'distributor', 'distributor_stock_num', 'cost', 'location'];

export default function ToolForm({ tool, onSave, onCancel, isSaving, isNew }) {
  const { tools } = useApp();
  const [data, setData] = useState({ ...tool });
  const [errors, setErrors] = useState([]);
  const [tagInput, setTagInput] = useState('');

  // Machine tool number is read-only here. For a new tool, preview the number
  // that will be assigned at save time (the real assignment happens on save —
  // another user could add a tool in between). For an existing tool, show the
  // number it already holds.
  const previewMachineNumber = useMemo(() => {
    if (!isNew) return null;
    const existing = tools
      .map(t => t.machine_tool_number)
      .filter(n => n !== null && n !== undefined && n !== '')
      .map(Number);
    return getNextMachineNumber(existing);
  }, [isNew, tools]);

  const setField = (field, value) => setData(d => ({ ...d, [field]: value }));

  const dirty = useMemo(() => JSON.stringify(data) !== JSON.stringify(tool), [data, tool]);

  const getVisibleAppFields = () => {
    const extFields = getVisibleFields(data.tool_type);
    return extFields
      .map(({ key, optional }) => ({ field: EXTRACTOR_TO_APP_FIELD[key] || key, optional }))
      .filter(({ field }) => field !== 'tool_type' && field !== 'grouping');
  };

  const handleSave = async () => {
    const { valid, errors: errs } = validateTool(data);
    if (!valid) { setErrors(errs); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    setErrors([]);
    try {
      await onSave(data);
    } catch (err) {
      setErrors([err.message]);
    }
  };

  const handleCancel = () => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    onCancel();
  };

  // Keyboard: Ctrl/Cmd+S saves, Esc cancels
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!isSaving) handleSave();
      } else if (e.key === 'Escape') {
        handleCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Warn on browser/tab close while dirty
  useEffect(() => {
    const onBeforeUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const visibleFields = new Set(getVisibleAppFields().map(f => f.field));

  const geoIssues = useMemo(
    () => validateGeometry(data),
    [data.tool_type, data.diameter, data.flute_length, data.shoulder_length, data.min_ooh, data.overall_length, data.corner_radius]
  );
  const geoIssueFields = useMemo(() => new Set(geoIssues.flatMap(i => i.fields)), [geoIssues]);

  return (
    <div className="tool-form">
      {errors.length > 0 && (
        <div className="error-banner mb-16">
          {errors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}

      {/* Machine tool number — read-only. Managed entirely by the app. */}
      <div
        className="mb-16"
        style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          padding: '10px 14px', background: 'var(--surface-2)',
          border: '1px solid var(--border)', borderLeft: '3px solid var(--orange)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        <Hash size={15} style={{ color: 'var(--orange)' }} />
        {isNew ? (
          <span className="text-sm">
            This tool will be assigned machine tool number{' '}
            <strong className="font-mono" style={{ color: 'var(--orange)' }}>{previewMachineNumber}</strong>.
          </span>
        ) : (data.machine_tool_number !== null && data.machine_tool_number !== undefined && data.machine_tool_number !== '') ? (
          <span className="text-sm">
            Machine Tool #{' '}
            <strong className="font-mono" style={{ color: 'var(--orange)' }}>
              T{data.machine_tool_number} · H{data.machine_tool_number} · D{data.machine_tool_number}
            </strong>{' '}
            <span className="text-sub text-xs">— read-only, managed by the app</span>
          </span>
        ) : (
          <span className="text-sm text-sub">No machine tool number assigned.</span>
        )}
      </div>

      {/* Tool type selector */}
      <div className="panel open mb-16">
        <div className="panel-header static">
          <Layers size={15} className="panel-header-icon" />
          <span className="panel-header-title">Tool Type *</span>
        </div>
        <div className="panel-body">
          <div className="type-chip-row">
            {TOOL_TYPES.map(type => (
              <button
                key={type}
                onClick={() => setField('tool_type', type)}
                className={`type-chip ${data.tool_type === type ? 'active' : ''}`}
              >
                <ToolTypeIcon type={type} size={16} />
                {TOOL_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <Section title="Identity" icon={Tag}>
        <div className="form-grid">
          <div className="field-group form-grid-wide">
            <label className="field-label">Description <span className="required">*</span></label>
            <input className="field-input" value={data.description || ''} onChange={e => setField('description', e.target.value)} placeholder="Auto-generated if left blank" />
          </div>
          <FieldInput field="vendor" label="Manufacturer" data={data} setField={setField} list={MANUFACTURER_LIST} />
          <FieldInput field="product_id" label="Mfr Part # (EDP)" data={data} setField={setField} />
          <FieldInput field="proshot_id" label="ProShop ID" data={data} setField={setField} placeholder="e.g. A-3" />
          <FieldInput field="distributor" label="Distributor" data={data} setField={setField} />
          <FieldInput field="distributor_stock_num" label="Distributor Stock #" data={data} setField={setField} />
          <FieldInput field="cost" label="Cost ($)" data={data} setField={setField} type="number" step="0.01" />
          <FieldInput field="product_link" label="Product Link" data={data} setField={setField} type="url" />
        </div>
      </Section>

      <Section title="Geometry" icon={Ruler}>
        <div className="form-grid">
          <NumField field="diameter" data={data} setField={setField} required warn={geoIssueFields.has('diameter')} />
          {visibleFields.has('number_of_flutes') && <NumField field="number_of_flutes" data={data} setField={setField} />}
          {visibleFields.has('flute_length') && <NumField field="flute_length" data={data} setField={setField} warn={geoIssueFields.has('flute_length')} />}
          {visibleFields.has('overall_length') && <NumField field="overall_length" data={data} setField={setField} warn={geoIssueFields.has('overall_length')} />}
          {visibleFields.has('shank_diameter') && <NumField field="shank_diameter" data={data} setField={setField} />}
          {visibleFields.has('corner_radius') && <NumField field="corner_radius" data={data} setField={setField} warn={geoIssueFields.has('corner_radius')} />}
          {visibleFields.has('shoulder_length') && <NumField field="shoulder_length" data={data} setField={setField} warn={geoIssueFields.has('shoulder_length')} />}
          {visibleFields.has('tip_angle') && <NumField field="tip_angle" data={data} setField={setField} />}
          {visibleFields.has('taper_angle') && <NumField field="taper_angle" data={data} setField={setField} />}
          {visibleFields.has('tip_diameter') && <NumField field="tip_diameter" data={data} setField={setField} />}
          {visibleFields.has('lower_radius') && <NumField field="lower_radius" data={data} setField={setField} />}
          {visibleFields.has('upper_radius') && <NumField field="upper_radius" data={data} setField={setField} />}
          {visibleFields.has('profile_radius') && <NumField field="profile_radius" data={data} setField={setField} />}
          {visibleFields.has('axial_distance') && <NumField field="axial_distance" data={data} setField={setField} />}
          <NumField field="min_ooh" data={data} setField={setField} warn={geoIssueFields.has('min_ooh')} />
        </div>
        {geoIssues.length > 0 && (
          <div className="warn-banner" style={{ marginTop: 12 }}>
            {geoIssues.map((issue, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={12} style={{ flexShrink: 0 }} />
                {issue.message}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Material & Coating" icon={Layers}>
        <div className="form-grid">
          <div className="field-group">
            <label className="field-label">Tool Material</label>
            <select className="field-input" value={data.material || 'carbide'} onChange={e => setField('material', e.target.value)}>
              {MA.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="field-group">
            <label className="field-label">Coating</label>
            <select className="field-input" value={data.coating || ''} onChange={e => setField('coating', e.target.value)}>
              {CO.map(c => <option key={c} value={c}>{c || 'None'}</option>)}
            </select>
          </div>
          <div className="field-group">
            <label className="field-label">Material Suitability (ISO)</label>
            <div className="chip-group" style={{ marginBottom: 6 }}>
              {WM.filter(w => w).map(w => (
                <button
                  key={w}
                  className={`chip ${(data.material_suitability || []).includes(w) ? 'active' : ''}`}
                  onClick={() => {
                    const current = data.material_suitability || [];
                    setField('material_suitability', current.includes(w) ? current.filter(x => x !== w) : [...current, w]);
                  }}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
          <div className="field-group">
            <label className="field-label">Coolant</label>
            <select className="field-input" value={data.coolant || 'flood'} onChange={e => setField('coolant', e.target.value)}>
              {COOLANT_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          {visibleFields.has('helix_angle') && <NumField field="helix_angle" data={data} setField={setField} />}
          {visibleFields.has('cutting_direction') && (
            <div className="field-group">
              <label className="field-label">Cutting Direction</label>
              <select className="field-input" value={data.cutting_direction || 'Right Hand'} onChange={e => setField('cutting_direction', e.target.value)}>
                <option value="Right Hand">Right Hand</option>
                <option value="Left Hand">Left Hand</option>
              </select>
            </div>
          )}
          {visibleFields.has('center_cutting') && (
            <div className="field-group">
              <label className="field-label">Center Cutting</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!data.center_cutting} onChange={e => setField('center_cutting', e.target.checked)} />
                <span className="text-sub text-sm">Yes</span>
              </label>
            </div>
          )}
          {visibleFields.has('flute_type') && (
            <div className="field-group">
              <label className="field-label">Flute Type</label>
              <select className="field-input" value={data.flute_type || ''} onChange={e => setField('flute_type', e.target.value)}>
                {['', 'Roughing', 'Semi-Finishing', 'Finishing', 'Yes', 'No'].map(f => <option key={f} value={f}>{f || 'Not specified'}</option>)}
              </select>
            </div>
          )}
        </div>
        {visibleFields.has('pitch') && (
          <div className="form-grid" style={{ marginTop: 14 }}>
            <FieldInput field="pitch" label="Thread Pitch" data={data} setField={setField} placeholder="e.g. 1/4-20 or M6x1.0" />
            {visibleFields.has('tap_class') && <FieldInput field="tap_class" label="Tap Class" data={data} setField={setField} placeholder="H2-H6, D2-D6" />}
            {visibleFields.has('point_type') && (
              <div className="field-group">
                <label className="field-label">Point Type</label>
                <select className="field-input" value={data.point_type || ''} onChange={e => setField('point_type', e.target.value)}>
                  {['', 'Bottoming', 'Modified Bottoming', 'Plug', 'Taper', 'Spiral Point', 'Spiral Flute', 'Forming'].map(p => <option key={p} value={p}>{p || 'Not specified'}</option>)}
                </select>
              </div>
            )}
            {visibleFields.has('min_thread_pitch') && <NumField field="min_thread_pitch" data={data} setField={setField} />}
            {visibleFields.has('max_thread_pitch') && <NumField field="max_thread_pitch" data={data} setField={setField} />}
          </div>
        )}
      </Section>

      <Section title="Speeds & Feeds" icon={Gauge}>
        <div className="form-grid">
          {SPEEDS_FIELDS.map(f => <NumField key={f} field={f} data={data} setField={setField} />)}
        </div>
      </Section>

      <Section title="Setup & Notes" icon={Settings2}>
        <div className="form-grid">
          <FieldInput field="preferred_machine" label="Preferred Machine" data={data} setField={setField} placeholder="M300, R650, etc." />
          <FieldInput field="location" label="Location (Cabinet)" data={data} setField={setField} placeholder="LC-140" />
          <FieldInput field="last_used_job" label="Last Used Job" data={data} setField={setField} />
          <FieldInput field="updated_by" label="Updated By" data={data} setField={setField} />
        </div>

        {/* Tags */}
        <div className="field-group mt-12">
          <label className="field-label">Tags</label>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <input
              className="field-input"
              style={{ flex: 1 }}
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              placeholder="Add tag and press Enter"
              onKeyDown={e => {
                if (e.key === 'Enter' && tagInput.trim()) {
                  const existing = data.tags || [];
                  if (!existing.includes(tagInput.trim())) {
                    setField('tags', [...existing, tagInput.trim()]);
                  }
                  setTagInput('');
                  e.preventDefault();
                }
              }}
            />
          </div>
          <div className="tag-list">
            {(data.tags || []).map(tag => (
              <span key={tag} className="tag removable" onClick={() => setField('tags', (data.tags || []).filter(t => t !== tag))}>
                {tag} <X size={11} />
              </span>
            ))}
          </div>
        </div>

        <div className="field-group mt-12">
          <label className="field-label">Notes</label>
          <textarea className="field-input" value={data.notes || ''} onChange={e => setField('notes', e.target.value)} rows={3} />
        </div>
        <div className="field-group mt-12">
          <label className="field-label">Revision Notes</label>
          <input className="field-input" value={data.revision_notes || ''} onChange={e => setField('revision_notes', e.target.value)} placeholder="What changed and why" />
        </div>
      </Section>

      {/* Sticky save bar */}
      <div className="form-actions-bar">
        <span className={`form-dirty ${dirty ? 'show' : ''}`}>{dirty ? 'Unsaved changes' : 'No changes'}</span>
        <span className="form-hint text-xs text-sub">⌘/Ctrl+S to save · Esc to cancel</span>
        <button className="btn btn-secondary" onClick={handleCancel} disabled={isSaving}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSave} disabled={isSaving}>
          {isSaving ? (
            <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Saving…</>
          ) : (
            <><Save size={15} /> {isNew ? 'Add to Library' : 'Save Changes'}</>
          )}
        </button>
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, children }) {
  const [open, setOpen] = useState(true);
  return (
    <div className={`panel ${open ? 'open' : ''} mb-16`}>
      <button className="panel-header" onClick={() => setOpen(o => !o)}>
        {Icon && <Icon size={15} className="panel-header-icon" />}
        <span className="panel-header-title">{title}</span>
        <span className="panel-chevron">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="panel-body">{children}</div>}
    </div>
  );
}

function NumField({ field, data, setField, required }) {
  return (
    <div className="field-group">
      <label className="field-label">
        {FIELD_LABELS[field] || field}
        {required && <span className="required"> *</span>}
      </label>
      <input
        className="field-input"
        type="number"
        step={FIELD_STEP[field] || '0.001'}
        value={data[field] ?? ''}
        onChange={e => setField(field, e.target.value === '' ? null : parseFloat(e.target.value))}
        placeholder="—"
      />
    </div>
  );
}

function FieldInput({ field, label, data, setField, type = 'text', step, list, placeholder }) {
  return (
    <div className="field-group">
      <label className="field-label">{label || FIELD_LABELS[field] || field}</label>
      {list ? (
        <>
          <input
            className="field-input"
            list={`list-${field}`}
            value={data[field] || ''}
            onChange={e => setField(field, e.target.value)}
            placeholder={placeholder}
          />
          <datalist id={`list-${field}`}>
            {list.map(v => <option key={v} value={v} />)}
          </datalist>
        </>
      ) : (
        <input
          className="field-input"
          type={type}
          step={step}
          value={data[field] || ''}
          onChange={e => setField(field, e.target.value)}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}
