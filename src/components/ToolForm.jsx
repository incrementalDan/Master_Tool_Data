import { useState, useEffect, useMemo } from 'react';
import { Tag, Ruler, Layers, Settings2, Save, X, AlertTriangle, Wand2 } from 'lucide-react';
import {
  TOOL_TYPES, TOOL_TYPE_LABELS, MA, CO, WM, MANUFACTURER_LIST, validateTool, validateGeometry, getNextMachineNumber, toolToExtractor,
  INCH_THREAD_SIZES, METRIC_THREAD_SIZES,
  TAP_LIMIT_TOLERANCE_OPTIONS_INCH, TAP_LIMIT_TOLERANCE_DEFAULT_INCH, TAP_LIMIT_TOLERANCE_OPTIONS_METRIC, TAP_LIMIT_TOLERANCE_DEFAULT_METRIC,
  CLASS_OF_FIT_OPTIONS, CLASS_OF_FIT_DEFAULT,
} from '../schema/toolSchema.js';
import { fieldLabel } from '../schema/fieldRegistry.js';
import { unitAbbr } from '../utils/units.js';
import InfoTip from './InfoTip.jsx';
import { buildDesc } from '../utils/toolNaming.js';
import { fieldsForType } from '../schema/fieldRegistry.js';
import { useApp } from '../context/AppContext.jsx';
import ToolTypeIcon from './icons/ToolTypeIcon.jsx';

const FIELD_STEP = {
  diameter: '0.0001', flute_length: '0.001', overall_length: '0.001', shank_diameter: '0.0001',
  corner_radius: '0.0001', tip_diameter: '0.0001', lower_radius: '0.0001', upper_radius: '0.0001',
  profile_radius: '0.0001', axial_distance: '0.001', shoulder_length: '0.001', ooh: '0.001',
  number_of_flutes: '1', spindle_speed: '1', cutting_feedrate: '0.1', plunge_feedrate: '0.1',
  ramp_feedrate: '0.1', lead_in_feedrate: '0.1', lead_out_feedrate: '0.1',
  feed_per_tooth: '0.0001', feed_per_rev: '0.0001', cutting_speed: '1',
  depth_of_cut: '0.001', width_of_cut: '0.001', tip_angle: '0.5', taper_angle: '0.5',
  helix_angle: '0.5', min_thread_pitch: '0.0001', max_thread_pitch: '0.0001',
  tpi_min: '1', tpi_max: '1', thread_profile_angle: '0.5', tip_to_first_thread: '0.001',
};


const FLUTE_DESIGN_OPTS = ['Variable Index', 'Variable Flute', 'Variable Helix', 'Variable Pitch'];

const TAP_SUB_TYPE_OPTS = [
  { value: 'cut', label: 'Cut' },
  { value: 'form', label: 'Form' },
];

function derivePitchFromThreadSize(pitchStr, toolUnit = 'inches') {
  const str = (pitchStr || '').trim();
  // Metric: "M5 x 0.8", "M6 x 1.0"
  const mm = str.match(/^M[\d.]+\s*[xX×]\s*([\d.]+)/i);
  if (mm) {
    const p = parseFloat(mm[1]);
    if (isNaN(p)) return null;
    return toolUnit === 'millimeters' ? p : p / 25.4;
  }
  // Inch: "1/4-20 UNC", "#10-32"  — TPI is after the dash
  const tpi = str.match(/-(\d+)/);
  if (tpi) {
    const n = parseFloat(tpi[1]);
    if (!n) return null;
    const pitchIn = 1 / n;
    return toolUnit === 'millimeters' ? pitchIn * 25.4 : pitchIn;
  }
  return null;
}

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

  const setField = (field, value) => setData(d => {
    const next = { ...d, [field]: value };
    // Auto-derive thread_pitch from thread size string for tap/thread mill.
    if (field === 'pitch' && (d.tool_type === 'tap' || d.tool_type === 'thread mill') && typeof value === 'string') {
      const tp = derivePitchFromThreadSize(value, d.unit);
      if (tp !== null) next.thread_pitch = Number(tp.toFixed(8));
    }
    return next;
  });

  const dirty = useMemo(() => JSON.stringify(data) !== JSON.stringify(tool), [data, tool]);

  // New taps default to HSS — taps are rarely carbide.
  useEffect(() => {
    if (isNew && data.tool_type === 'tap' && (!data.material || data.material === 'carbide')) {
      setData(d => ({ ...d, material: 'hss' }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.tool_type]);

  // Thread-size / tolerance option lists for Tap & Thread Mill — driven by
  // tap_thread_unit (independent of the tool's overall unit). The combobox input
  // is already freeform (datalist), so the verbatim 'Custom...' sentinel is dropped
  // from the suggestion list — typing any size already works without selecting it.
  const isMetricThread = data.tap_thread_unit === 'metric';
  const threadSizeOptions = (isMetricThread ? METRIC_THREAD_SIZES : INCH_THREAD_SIZES).filter(s => s !== 'Custom...');
  const tapLimitToleranceOptions = isMetricThread ? TAP_LIMIT_TOLERANCE_OPTIONS_METRIC : TAP_LIMIT_TOLERANCE_OPTIONS_INCH;
  const tapLimitToleranceDefault = isMetricThread ? TAP_LIMIT_TOLERANCE_DEFAULT_METRIC : TAP_LIMIT_TOLERANCE_DEFAULT_INCH;

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

  const visibleFields = new Set(fieldsForType(data.tool_type));

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
        {/* Machine tool number — read-only, managed by the app */}
        {isNew ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <span className="text-xs text-sub">Will be assigned:</span>
            <span className="machine-num-badge">T{previewMachineNumber}</span>
            <span className="machine-num-badge">H{previewMachineNumber}</span>
            <span className="machine-num-badge">D{previewMachineNumber}</span>
          </div>
        ) : (data.machine_tool_number !== null && data.machine_tool_number !== undefined && data.machine_tool_number !== '') ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <span className="text-xs text-sub">Machine #</span>
            <span className="machine-num-badge">T{data.machine_tool_number}</span>
            <span className="machine-num-badge">H{data.machine_tool_number}</span>
            <span className="machine-num-badge">D{data.machine_tool_number}</span>
            <span className="text-xs text-sub">— read-only</span>
          </div>
        ) : null}
        {/* Unit — selectable when creating a tool; pulled from Fusion (read-only) when editing. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <span className="text-xs text-sub">Unit</span>
          {isNew ? (
            [['inches', 'Inches (in)'], ['millimeters', 'Millimeters (mm)']].map(([val, label]) => (
              <button
                key={val}
                type="button"
                className={`btn btn-sm ${data.unit === val ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setField('unit', val)}
              >
                {label}
              </button>
            ))
          ) : (
            <>
              <span className="machine-num-badge">{unitAbbr(data.unit)}</span>
              <span className="text-xs text-sub">— from Fusion (read-only)</span>
            </>
          )}
        </div>
        <div className="form-grid">
          <div className="field-group form-grid-wide">
            <label className="field-label">Description <span className="required">*</span></label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="field-input"
                style={{ flex: 1 }}
                value={data.description || ''}
                onChange={e => setField('description', e.target.value)}
                placeholder="e.g. 0.500 4FL EM 1.000LOC"
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                title="Suggest description from geometry"
                onClick={() => {
                  const suggested = buildDesc(toolToExtractor(data));
                  if (suggested) setField('description', suggested);
                }}
                style={{ flexShrink: 0 }}
              >
                <Wand2 size={14} /> Suggest
              </button>
            </div>
          </div>
          <FieldInput field="vendor" label="Manufacturer" data={data} setField={setField} list={MANUFACTURER_LIST} />
          <FieldInput field="proshot_id" label="ProShop ID" data={data} setField={setField} placeholder="e.g. A-3" />
          <FieldInput field="location" label="Location (Cabinet)" data={data} setField={setField} placeholder="LC-140" />
        </div>
      </Section>

      <Section title="Geometry" icon={Ruler}>
        {data.tool_type === 'tap' && (
          <div style={{ marginBottom: 16 }}>
            <div className="field-group" style={{ marginBottom: 12 }}>
              <label className="field-label">Tap Sub-Type</label>
              <div className="chip-group">
                {TAP_SUB_TYPE_OPTS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`btn btn-sm ${(data.tap_sub_type || 'cut') === opt.value ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setField('tap_sub_type', opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="form-grid">
              {visibleFields.has('tap_thread_unit') && (
                <div className="field-group">
                  <label className="field-label">Thread Unit</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[['inch', 'Inch'], ['metric', 'Metric']].map(([val, label]) => (
                      <button
                        key={val}
                        type="button"
                        className={`btn btn-sm ${(data.tap_thread_unit || 'inch') === val ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setField('tap_thread_unit', val)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {visibleFields.has('pitch') && (
                <div className="field-group">
                  <label className="field-label">Thread Size</label>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <select
                      className="field-input"
                      style={{ flex: 1 }}
                      value={threadSizeOptions.includes(data.pitch) ? data.pitch : '__custom__'}
                      onChange={e => {
                        const v = e.target.value;
                        if (v !== '__custom__') setField('pitch', v);
                      }}
                    >
                      <option value="__custom__">{data.pitch && !threadSizeOptions.includes(data.pitch) ? data.pitch : 'Select…'}</option>
                      {threadSizeOptions.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  {!threadSizeOptions.includes(data.pitch) && (
                    <input
                      className="field-input"
                      style={{ marginTop: 4 }}
                      value={data.pitch || ''}
                      onChange={e => setField('pitch', e.target.value)}
                      placeholder="e.g. 1/4-20 UNC or M6 x 1.0"
                    />
                  )}
                  {visibleFields.has('is_sti') && (
                    <>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, cursor: 'pointer' }}>
                        <input type="checkbox" checked={!!data.is_sti} onChange={e => setField('is_sti', e.target.checked)} />
                        <span className="text-sub text-sm">STI / Helicoil</span>
                      </label>
                      {data.is_sti && (
                        <p className="text-sub text-sm" style={{ marginTop: 4 }}>
                          STI / Helicoil — thread size above is the <strong>parent</strong> thread, not the oversized tap size.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
              {visibleFields.has('pitch') && data.thread_pitch > 0 && (
                <div className="field-group">
                  <label className="field-label">Thread Pitch</label>
                  <div className="field-input" style={{ background: 'var(--bg-2)', cursor: 'default', color: 'var(--text-sub)' }}>
                    {Number(data.thread_pitch).toFixed(6)} {unitAbbr(data.unit)}
                  </div>
                </div>
              )}
              {visibleFields.has('point_type') && (
                <div className="field-group">
                  <label className="field-label">Point Type</label>
                  <select
                    className="field-input"
                    value={data.point_type || ''}
                    onChange={e => setField('point_type', e.target.value)}
                  >
                    {['', 'Bottoming', 'Modified Bottoming', 'Plug', 'Taper', 'Spiral Point', 'Spiral Flute'].map(p => (
                      <option key={p} value={p}>{p || 'Not specified'}</option>
                    ))}
                  </select>
                </div>
              )}
              {visibleFields.has('tip_to_first_thread') && (
                <NumField field="tip_to_first_thread" data={data} setField={setField} />
              )}
              {visibleFields.has('tap_class') && (
                <div className="field-group">
                  <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    {fieldLabel('tap_class', data?.unit)}
                    <InfoTip text={`The tap's pitch-diameter limit tolerance (e.g. "${tapLimitToleranceDefault}") — set by the tap's grind. NOT "class of fit" which describes how the tapped hole mates with its mating part.`} />
                  </label>
                  <select className="field-input" value={data.tap_class || ''} onChange={e => setField('tap_class', e.target.value)}>
                    <option value="">Not specified</option>
                    {tapLimitToleranceOptions.map(t => (
                      <option key={t} value={t}>{t}{t === tapLimitToleranceDefault ? ' — standard' : ''}</option>
                    ))}
                  </select>
                </div>
              )}
              {visibleFields.has('class_of_fit') && (
                <div className="field-group">
                  <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    {fieldLabel('class_of_fit', data?.unit)}
                    <InfoTip text="How the tapped hole fits its mating part — a thread-fit grade (1B loosest … 3B tightest). Reference only — not a property of the tap itself." />
                  </label>
                  <select className="field-input" value={data.class_of_fit || ''} onChange={e => setField('class_of_fit', e.target.value)}>
                    <option value="">Not specified</option>
                    {CLASS_OF_FIT_OPTIONS.map(c => (
                      <option key={c} value={c}>{c}{c === CLASS_OF_FIT_DEFAULT ? ' — general purpose' : ''}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
        )}
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
        {visibleFields.has('cutting_direction') && (
          <div className="form-grid" style={{ marginTop: 10 }}>
            <div className="field-group">
              <label className="field-label">Cutting Direction</label>
              <select className="field-input" value={data.cutting_direction || 'Right Hand'} onChange={e => setField('cutting_direction', e.target.value)}>
                <option value="Right Hand">Right Hand</option>
                <option value="Left Hand">Left Hand</option>
              </select>
            </div>
          </div>
        )}
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
            <label className="field-label">TSC Capable</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!data.tsc_capable} onChange={e => setField('tsc_capable', e.target.checked)} />
              <span className="text-sub text-sm">Through Spindle Coolant supported</span>
            </label>
          </div>
          {visibleFields.has('helix_angle') && <NumField field="helix_angle" data={data} setField={setField} />}
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
          {data.tool_type !== 'tap' && (
            <div className="field-group">
              <label className="field-label">Flute Design</label>
              <input
                className="field-input"
                list="flute-design-list"
                value={data.flute_design || ''}
                onChange={e => setField('flute_design', e.target.value)}
                placeholder="None"
              />
              <datalist id="flute-design-list">
                {FLUTE_DESIGN_OPTS.map(v => <option key={v} value={v} />)}
              </datalist>
            </div>
          )}
        </div>
        {(visibleFields.has('min_thread_pitch') || visibleFields.has('tpi_min') || visibleFields.has('thread_profile_angle')) && (
          <div className="form-grid" style={{ marginTop: 14 }}>
            {visibleFields.has('min_thread_pitch') && <NumField field="min_thread_pitch" data={data} setField={setField} />}
            {visibleFields.has('max_thread_pitch') && <NumField field="max_thread_pitch" data={data} setField={setField} />}
            {visibleFields.has('tpi_min') && <NumField field="tpi_min" data={data} setField={setField} />}
            {visibleFields.has('tpi_max') && <NumField field="tpi_max" data={data} setField={setField} />}
            {visibleFields.has('thread_profile_angle') && <NumField field="thread_profile_angle" data={data} setField={setField} />}
          </div>
        )}
      </Section>

      <div className="warn-banner" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <AlertTriangle size={13} style={{ flexShrink: 0 }} />
        Speeds &amp; feeds are managed per preset. {isNew ? 'Add presets from the tool page after saving.' : 'Edit them in the Speeds & Feeds section on the tool page.'}
      </div>

      <Section title="Setup & Notes" icon={Settings2}>
        <div className="form-grid">
          <FieldInput field="last_used_job" label="Last Used Job" data={data} setField={setField} />
          <FieldInput field="updated_by" label="Updated By" data={data} setField={setField} />
        </div>

        <div className="field-group mt-12">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!data.no_fusion_link} onChange={e => setField('no_fusion_link', e.target.checked)} />
            <span className="text-sub text-sm">No Fusion Link — needs Fusion setup</span>
            <InfoTip text={'Set automatically when this tool is added from a ProShop row with no Fusion match — its Fusion library entry is a placeholder. Uncheck once its Fusion entry has real geometry, presets, and holder/assembly setup.'} />
          </label>
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
        {fieldLabel(field, data?.unit) || field}
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
      <label className="field-label">{label || fieldLabel(field, data?.unit) || field}</label>
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
