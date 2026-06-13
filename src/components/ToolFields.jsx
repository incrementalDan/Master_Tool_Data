// Shared, mode-aware renderer for the Geometry and Setup/Material sections.
//
// Both ToolDetail (mode="view") and ToolForm (mode="edit") render these two
// sections through this one component, so the field set, order, and positions
// are guaranteed identical between viewing and editing — edit simply swaps the
// read-only value for an input. See src/schema/toolFieldLayout.js for the field
// lists and the visibility rule.
import { AlertTriangle } from 'lucide-react';
import { fieldLabel, FIELD_REGISTRY, INCLUSIVE_ANGLE_TYPES } from '../schema/fieldRegistry.js';
import {
  getToolFieldSections, fieldControl, SELECT_OPTIONS,
  MATERIAL_SUITABILITY_OPTIONS, FLUTE_DESIGN_OPTIONS, VIEW_HIDE_WHEN_EMPTY,
} from '../schema/toolFieldLayout.js';
import {
  INCH_THREAD_SIZES, METRIC_THREAD_SIZES,
  TAP_LIMIT_TOLERANCE_OPTIONS_INCH, TAP_LIMIT_TOLERANCE_DEFAULT_INCH,
  TAP_LIMIT_TOLERANCE_OPTIONS_METRIC, TAP_LIMIT_TOLERANCE_DEFAULT_METRIC,
  CLASS_OF_FIT_OPTIONS, CLASS_OF_FIT_DEFAULT,
} from '../schema/toolSchema.js';
import { unitAbbr } from '../utils/units.js';
import InfoTip from './InfoTip.jsx';

const STEP = {
  diameter: '0.0001', flute_length: '0.001', overall_length: '0.001', shank_diameter: '0.0001',
  corner_radius: '0.0001', tip_diameter: '0.0001', lower_radius: '0.0001', upper_radius: '0.0001',
  profile_radius: '0.0001', axial_distance: '0.001', shoulder_length: '0.001', min_ooh: '0.001',
  number_of_flutes: '1', tip_angle: '0.5', taper_angle: '0.5', helix_angle: '0.5',
  min_thread_pitch: '0.0001', max_thread_pitch: '0.0001', tpi_min: '1', tpi_max: '1',
  thread_profile_angle: '0.5', tip_to_first_thread: '0.001',
};

const fmtNum = (v, precision) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!isFinite(n)) return null;
  const p = precision ?? 4;
  return Number(n.toFixed(p)).toString();
};

// Per-type label override (data/field unchanged — display only).
function labelFor(field, tool) {
  if (field === 'diameter' && tool.tool_type === 'tapered mill') return fieldLabel('tip_diameter', tool.unit);
  if (field === 'taper_angle' && INCLUSIVE_ANGLE_TYPES.has(tool.tool_type)) return 'Included/Inclusive Tip Angle (°)';
  return fieldLabel(field, tool.unit) || field;
}

// taper_angle is shown ×2 (included angle) for chamfer/tapered mills; stored ÷2.
const showsDoubled = (field, tool) => field === 'taper_angle' && INCLUSIVE_ANGLE_TYPES.has(tool.tool_type);

export default function ToolFields({ tool, mode, setField, geoIssueFields }) {
  const sections = getToolFieldSections(tool.tool_type);
  const edit = mode === 'edit';
  const warn = geoIssueFields || new Set();

  // ── one generic field ──
  const renderField = (field) => {
    const def = FIELD_REGISTRY[field] || {};
    const control = fieldControl(field);
    const label = labelFor(field, tool);
    let raw = tool[field];
    if (showsDoubled(field, tool) && raw != null) raw = raw * 2;

    // VIEW: hide the few opt-out fields when empty/false.
    if (!edit && VIEW_HIDE_WHEN_EMPTY.has(field)) {
      const empty = control === 'bool' ? !raw : (raw === null || raw === undefined || raw === '');
      if (empty) return null;
    }

    if (!edit) {
      let display;
      if (control === 'bool') display = raw ? 'Yes' : 'No';
      else if (control === 'chips') display = (tool[field] || []).length ? null : '—';
      else if (control === 'num') {
        const n = fmtNum(raw, def.precision);
        const unit = def.unit === 'angle' ? '°' : def.unit === 'length' ? unitAbbr(tool.unit) : '';
        display = n == null ? '—' : (unit ? `${n} ${unit}` : n);
      } else display = (raw === null || raw === undefined || raw === '') ? '—' : String(raw);

      if (control === 'chips') {
        return (
          <div className="detail-field" key={field}>
            <div className="detail-field-label">{label}</div>
            {(tool[field] || []).length ? (
              <div className="tag-list" style={{ marginTop: 2 }}>
                {(tool[field] || []).map(m => <span key={m} className="tag">{m}</span>)}
              </div>
            ) : <div className="detail-field-value detail-field-empty">—</div>}
          </div>
        );
      }
      const empty = display === '—';
      return (
        <div className="detail-field" key={field}>
          <div className="detail-field-label">{label}</div>
          <div className={`detail-field-value ${empty ? 'detail-field-empty' : ''}`}>{display}</div>
        </div>
      );
    }

    // EDIT
    const fieldGroup = (children) => (
      <div className="field-group" key={field}>
        <label className="field-label">
          {label}{def.required && <span className="required"> *</span>}
        </label>
        {children}
      </div>
    );

    if (control === 'bool') {
      return fieldGroup(
        <label className="checkbox-row">
          <input type="checkbox" checked={!!tool[field]} onChange={e => setField(field, e.target.checked)} />
          <span className="text-sub text-sm">Yes</span>
        </label>
      );
    }
    if (control === 'select') {
      const opts = SELECT_OPTIONS[field] || [];
      return fieldGroup(
        <select className="field-input" value={tool[field] ?? (field === 'cutting_direction' ? 'Right Hand' : '')}
          onChange={e => setField(field, e.target.value)}>
          {opts.map(o => <option key={o} value={o}>{o === '' ? 'Not specified' : o}</option>)}
        </select>
      );
    }
    if (control === 'chips') {
      const cur = tool[field] || [];
      return (
        <div className="field-group form-grid-wide" key={field}>
          <label className="field-label">{label}</label>
          <div className="chip-group">
            {MATERIAL_SUITABILITY_OPTIONS.map(w => (
              <button key={w} type="button" className={`chip ${cur.includes(w) ? 'active' : ''}`}
                onClick={() => setField(field, cur.includes(w) ? cur.filter(x => x !== w) : [...cur, w])}>
                {w}
              </button>
            ))}
          </div>
        </div>
      );
    }
    if (control === 'datalist') {
      return fieldGroup(
        <>
          <input className="field-input" list={`dl-${field}`} value={tool[field] || ''}
            onChange={e => setField(field, e.target.value)} placeholder="None" />
          <datalist id={`dl-${field}`}>
            {FLUTE_DESIGN_OPTIONS.map(v => <option key={v} value={v} />)}
          </datalist>
        </>
      );
    }
    if (control === 'num') {
      const dbl = showsDoubled(field, tool);
      const val = dbl && tool[field] != null ? tool[field] * 2 : tool[field];
      return fieldGroup(
        <input
          className={`field-input ${warn.has(field) ? 'error' : ''}`}
          type="number" step={STEP[field] || '0.001'}
          value={val ?? ''}
          onChange={e => {
            const v = e.target.value === '' ? null : parseFloat(e.target.value);
            setField(field, (dbl && v != null) ? v / 2 : v);
          }}
          placeholder="—"
        />
      );
    }
    return fieldGroup(
      <input className="field-input" value={tool[field] || ''} onChange={e => setField(field, e.target.value)} placeholder="—" />
    );
  };

  const gridClass = edit ? 'form-grid' : 'detail-fields';

  return (
    <>
      <div className="tool-fields-section">
        <div className="tool-fields-grid-title">Geometry</div>
        <div className={gridClass}>
          {sections.geometry.map(renderField)}
        </div>
      </div>

      {sections.showThreadBlock && (
        <ThreadBlock tool={tool} mode={mode} setField={setField} fields={sections.thread} />
      )}

      <div className="tool-fields-section">
        <div className="tool-fields-grid-title">Material &amp; Cutting</div>
        <div className={gridClass}>
          {sections.setup.map(renderField)}
        </div>
        {/* Material suitability spans full width below the grid. */}
        {renderField('material_suitability')}
      </div>
    </>
  );
}

// ── Tap / thread-mill cluster ──
// Bespoke controls (thread-size combobox, derived pitch, limit-tolerance and
// class-of-fit selects with info tips). Rendered identically in both modes.
function ThreadBlock({ tool, mode, setField, fields }) {
  const edit = mode === 'edit';
  const isTap = tool.tool_type === 'tap';
  const isMetricThread = tool.tap_thread_unit === 'metric';
  const threadSizes = (isMetricThread ? METRIC_THREAD_SIZES : INCH_THREAD_SIZES).filter(s => s !== 'Custom...');
  const tolOptions = isMetricThread ? TAP_LIMIT_TOLERANCE_OPTIONS_METRIC : TAP_LIMIT_TOLERANCE_OPTIONS_INCH;
  const tolDefault = isMetricThread ? TAP_LIMIT_TOLERANCE_DEFAULT_METRIC : TAP_LIMIT_TOLERANCE_DEFAULT_INCH;
  const has = (f) => fields.includes(f);

  const Num = (field, label) => {
    const def = FIELD_REGISTRY[field] || {};
    if (!edit) {
      const v = fmtNum(tool[field], def.precision);
      const unit = def.unit === 'angle' ? '°' : def.unit === 'length' ? unitAbbr(tool.unit) : '';
      return (
        <div className="detail-field" key={field}>
          <div className="detail-field-label">{label || fieldLabel(field, tool.unit)}</div>
          <div className={`detail-field-value ${v == null ? 'detail-field-empty' : ''}`}>{v == null ? '—' : (unit ? `${v} ${unit}` : v)}</div>
        </div>
      );
    }
    return (
      <div className="field-group" key={field}>
        <label className="field-label">{label || fieldLabel(field, tool.unit)}</label>
        <input className="field-input" type="number" step={STEP[field] || '0.001'} value={tool[field] ?? ''}
          onChange={e => setField(field, e.target.value === '' ? null : parseFloat(e.target.value))} placeholder="—" />
      </div>
    );
  };

  return (
    <div className="tool-fields-section">
      <div className="tool-fields-grid-title">Threading</div>

      {/* Tap-only: sub-type + STI */}
      {isTap && (
        <div className="flex items-center gap-12 flex-wrap" style={{ marginBottom: 12 }}>
          <div className="field-group" style={{ flex: '0 0 auto' }}>
            <label className="field-label">Tap Sub-Type</label>
            {edit ? (
              <div className="btn-toggle">
                {[['cut', 'Cut'], ['form', 'Form']].map(([v, l]) => (
                  <button key={v} type="button" className={(tool.tap_sub_type || 'cut') === v ? 'active' : ''}
                    onClick={() => setField('tap_sub_type', v)}>{l}</button>
                ))}
              </div>
            ) : (
              <span className="machine-num-badge" style={{ textTransform: 'capitalize' }}>{tool.tap_sub_type === 'form' ? 'Form' : 'Cut'}</span>
            )}
          </div>
          <div className="field-group" style={{ flex: '0 0 auto' }}>
            <label className="field-label">STI / Helicoil</label>
            {edit ? (
              <label className="checkbox-row" style={{ paddingTop: 4 }}>
                <input type="checkbox" checked={!!tool.is_sti} onChange={e => setField('is_sti', e.target.checked)} />
                <span className="text-sub text-sm">STI / Helicoil tap</span>
              </label>
            ) : (
              <span className={tool.is_sti ? 'sti-pill' : 'detail-field-value detail-field-empty'}>{tool.is_sti ? 'STI / Helicoil' : 'No'}</span>
            )}
          </div>
          {has('tap_thread_unit') && (
            <div className="field-group" style={{ flex: '0 0 auto' }}>
              <label className="field-label">Thread Unit</label>
              {edit ? (
                <div className="btn-toggle">
                  {[['inch', 'Inch'], ['metric', 'Metric']].map(([v, l]) => (
                    <button key={v} type="button" className={(tool.tap_thread_unit || 'inch') === v ? 'active' : ''}
                      onClick={() => setField('tap_thread_unit', v)}>{l}</button>
                  ))}
                </div>
              ) : (
                <span className="machine-num-badge">{isMetricThread ? 'Metric' : 'Inch'}</span>
              )}
            </div>
          )}
        </div>
      )}

      <div className={edit ? 'form-grid' : 'detail-fields'}>
        {/* Thread size (designation) */}
        {has('pitch') && (
          edit ? (
            <div className="field-group">
              <label className="field-label">Thread Size</label>
              <select className="field-input" value={threadSizes.includes(tool.pitch) ? tool.pitch : '__custom__'}
                onChange={e => { if (e.target.value !== '__custom__') setField('pitch', e.target.value); }}>
                <option value="__custom__">{tool.pitch && !threadSizes.includes(tool.pitch) ? tool.pitch : 'Select…'}</option>
                {threadSizes.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {!threadSizes.includes(tool.pitch) && (
                <input className="field-input" style={{ marginTop: 4 }} value={tool.pitch || ''}
                  onChange={e => setField('pitch', e.target.value)} placeholder="e.g. 1/4-20 UNC or M6 x 1.0" />
              )}
              {isTap && tool.is_sti && (
                <p className="text-sub text-sm" style={{ marginTop: 4 }}>
                  STI / Helicoil — thread size is the <strong>parent</strong> thread, not the oversized tap size.
                </p>
              )}
            </div>
          ) : (
            <div className="detail-field">
              <div className="detail-field-label">Thread Size</div>
              <div className={`detail-field-value ${tool.pitch ? '' : 'detail-field-empty'}`}>{tool.pitch || '—'}</div>
            </div>
          )
        )}

        {/* Derived numeric pitch — read-only in both modes */}
        {has('thread_pitch') && (
          <div className={edit ? 'field-group' : 'detail-field'}>
            <div className={edit ? 'field-label' : 'detail-field-label'}>Thread Pitch</div>
            <div className={edit ? 'field-input' : `detail-field-value ${tool.thread_pitch > 0 ? '' : 'detail-field-empty'}`}
              style={edit ? { background: 'var(--bg)', color: 'var(--text-sub)', cursor: 'default' } : undefined}>
              {tool.thread_pitch > 0 ? `${Number(tool.thread_pitch).toFixed(6)} ${unitAbbr(tool.unit)}` : '—'}
            </div>
          </div>
        )}

        {has('point_type') && (
          edit ? (
            <div className="field-group">
              <label className="field-label">Point Type</label>
              <select className="field-input" value={tool.point_type || ''} onChange={e => setField('point_type', e.target.value)}>
                {SELECT_OPTIONS.point_type.map(p => <option key={p} value={p}>{p || 'Not specified'}</option>)}
              </select>
            </div>
          ) : (
            <div className="detail-field">
              <div className="detail-field-label">Point Type</div>
              <div className={`detail-field-value ${tool.point_type ? '' : 'detail-field-empty'}`}>{tool.point_type || '—'}</div>
            </div>
          )
        )}

        {has('tap_class') && (
          edit ? (
            <div className="field-group">
              <label className="field-label flex items-center gap-6">
                Tap Limit Tolerance
                <InfoTip text={`The tap's pitch-diameter limit tolerance (e.g. "${tolDefault}") — set by the tap's grind. NOT "class of fit", which describes how the tapped hole mates with its part.`} />
              </label>
              <select className="field-input" value={tool.tap_class || ''} onChange={e => setField('tap_class', e.target.value)}>
                <option value="">Not specified</option>
                {tolOptions.map(t => <option key={t} value={t}>{t}{t === tolDefault ? ' — standard' : ''}</option>)}
              </select>
            </div>
          ) : (
            <div className="detail-field">
              <div className="detail-field-label">Tap Limit Tolerance</div>
              <div className={`detail-field-value ${tool.tap_class ? '' : 'detail-field-empty'}`}>{tool.tap_class || '—'}</div>
            </div>
          )
        )}

        {has('class_of_fit') && (
          edit ? (
            <div className="field-group">
              <label className="field-label flex items-center gap-6">
                Class of Fit
                <InfoTip text="How the tapped hole fits its mating part — a thread-fit grade (1B loosest … 3B tightest). Reference only — not a property of the tap itself." />
              </label>
              <select className="field-input" value={tool.class_of_fit || ''} onChange={e => setField('class_of_fit', e.target.value)}>
                <option value="">Not specified</option>
                {CLASS_OF_FIT_OPTIONS.map(c => <option key={c} value={c}>{c}{c === CLASS_OF_FIT_DEFAULT ? ' — general purpose' : ''}</option>)}
              </select>
            </div>
          ) : (
            <div className="detail-field">
              <div className="detail-field-label">Class of Fit</div>
              <div className={`detail-field-value ${tool.class_of_fit ? '' : 'detail-field-empty'}`}>{tool.class_of_fit || '—'}</div>
            </div>
          )
        )}

        {has('tip_to_first_thread') && Num('tip_to_first_thread')}
        {has('min_thread_pitch') && Num('min_thread_pitch')}
        {has('max_thread_pitch') && Num('max_thread_pitch')}
        {has('tpi_min') && Num('tpi_min')}
        {has('tpi_max') && Num('tpi_max')}
        {has('thread_profile_angle') && Num('thread_profile_angle')}
      </div>
    </div>
  );
}
