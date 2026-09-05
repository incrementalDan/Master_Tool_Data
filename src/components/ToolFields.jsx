// Shared, mode-aware renderer for the Geometry and Setup/Material sections.
//
// Both ToolDetail (mode="view") and ToolForm (mode="edit") render these two
// sections through this one component, so the field set, order, and positions
// are guaranteed identical between viewing and editing — edit simply swaps the
// read-only value for an input. See src/schema/toolFieldLayout.js for the field
// lists and the visibility rule.
import { useState } from 'react';
import { AlertTriangle, ScanLine, Check, Undo2, X } from 'lucide-react';
import { fieldLabel, FIELD_REGISTRY, INCLUSIVE_ANGLE_TYPES, showsInclusiveAngle } from '../schema/fieldRegistry.js';
import {
  getToolFieldSections, fieldControl, SELECT_OPTIONS,
  MATERIAL_SUITABILITY_OPTIONS, FLUTE_DESIGN_OPTIONS, COATING_SEED,
  VIEW_HIDE_WHEN_EMPTY,
} from '../schema/toolFieldLayout.js';
import {
  INCH_THREAD_SIZES, METRIC_THREAD_SIZES,
  TAP_LIMIT_TOLERANCE_OPTIONS_INCH, TAP_LIMIT_TOLERANCE_DEFAULT_INCH,
  TAP_LIMIT_TOLERANCE_OPTIONS_METRIC, TAP_LIMIT_TOLERANCE_DEFAULT_METRIC,
  CLASS_OF_FIT_OPTIONS, CLASS_OF_FIT_DEFAULT, threadUnitOf,
} from '../schema/toolSchema.js';
import { unitAbbr } from '../utils/units.js';
import { undercutDiameterHint, reachIsDerived } from '../utils/toolReach.js';
import { shaftRows, formatShaftSegments } from '../utils/toolProfile.js';
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

// Edit-mode numeric input. The stored value keeps full precision (e.g. a metric
// tool whose 1 mm diameter is stored as 0.03937007874015748 in), but the input
// shows it rounded to `precision` (default 4) decimals at rest — clicking in
// reveals the exact stored value so it can be edited precisely. The underlying
// value is never changed unless the user actually edits the field.
function NumInput({ value, step, precision, className, placeholder, onChange }) {
  const [focused, setFocused] = useState(false);
  const display = focused
    ? (value ?? '')
    : (value === null || value === undefined || value === ''
        ? ''
        : Number(Number(value).toFixed(precision ?? 4)));
  return (
    <input
      className={className}
      type="number"
      step={step}
      value={display}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={onChange}
      placeholder={placeholder}
    />
  );
}

// Per-type label override (data/field unchanged — display only).
function labelFor(field, tool) {
  if (field === 'diameter' && tool.tool_type === 'tapered mill') return fieldLabel('tip_diameter', tool.unit);
  if (field === 'taper_angle' && INCLUSIVE_ANGLE_TYPES.has(tool.tool_type)) return 'Included/Inclusive Tip Angle (°)';
  // Slot/key cutters (aka slitting saws): the flute length IS the kerf (cutter width).
  if (field === 'flute_length' && tool.tool_type === 'slot/key cutter') {
    return `${fieldLabel('flute_length', tool.unit)} (Kerf)`;
  }
  return fieldLabel(field, tool.unit) || field;
}

// taper_angle is shown ×2 (included angle) for chamfer/tapered mills; stored ÷2.
// The rule itself lives in fieldRegistry.js so every component shares it.
const showsDoubled = (field, tool) => showsInclusiveAngle(field, tool.tool_type);

// ── Spec-sheet proposals (see src/schema/extractionDiff.js) ─────────────────
// Rendered INLINE, under the field they belong to, because that is where the
// current value already is — a separate review list would be a second place to
// read the same numbers, and would hide which box is about to change.

// Render a proposed/previous value the same way the field itself renders it,
// including the ×2 included-angle display, so the two are directly comparable.
// No unit suffix: the field's own label already carries "(in)"/"(mm)"/"(°)",
// and repeating it here made the strip wrap in a narrow form column.
function proposalValueText(field, value, tool) {
  if (value === null || value === undefined || value === '') return 'empty';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'empty';
  const def = FIELD_REGISTRY[field] || {};
  if (def.type === 'number') {
    const shown = showsDoubled(field, tool) ? Number(value) * 2 : Number(value);
    const n = fmtNum(shown, def.precision);
    return n == null ? 'empty' : n;
  }
  return String(value);
}

function ProposalStrip({ proposal, tool, onResolve }) {
  if (!proposal) return null;
  const { field, status, kind, current, proposed, converted } = proposal;
  const was = proposalValueText(field, current, tool);
  const now = proposalValueText(field, proposed, tool);

  return (
    <div className={`spec-proposal spec-proposal-${status}`}>
      <ScanLine size={11} className="spec-proposal-icon" />
      <span className="spec-proposal-text">
        {status === 'pending' && (
          <>Spec sheet: <s>{was}</s> → <strong>{now}</strong></>
        )}
        {status === 'accepted' && (
          kind === 'fill'
            ? <>Filled from spec sheet</>
            : <>From spec sheet — was <s>{was}</s></>
        )}
        {status === 'rejected' && <>Ignored: <s>{now}</s></>}
        {converted && status !== 'rejected' && (
          <span className="spec-proposal-note"> · converted from in</span>
        )}
      </span>
      <span className="spec-proposal-actions">
        {status === 'pending' ? (
          <>
            <button type="button" className="spec-proposal-btn accept"
              onClick={() => onResolve(field, 'accept')} title="Update to the spec-sheet value">
              <Check size={11} /> Update
            </button>
            <button type="button" className="spec-proposal-btn"
              onClick={() => onResolve(field, 'reject')} title="Keep the current value">
              <X size={11} /> Keep
            </button>
          </>
        ) : (
          <button type="button" className="spec-proposal-btn"
            onClick={() => onResolve(field, status === 'accepted' ? 'reject' : 'accept')}
            title={status === 'accepted' ? 'Put the previous value back' : 'Update to the spec-sheet value after all'}>
            <Undo2 size={11} /> {status === 'accepted' ? 'Undo' : 'Update'}
          </button>
        )}
      </span>
    </div>
  );
}

// Fallback suggestions per datalist field. `listOptions` overrides these — the
// coating list is library-derived, so it can only be supplied by the caller.
const DATALIST_FALLBACK = {
  flute_design: FLUTE_DESIGN_OPTIONS,
  coating: COATING_SEED,
};

export default function ToolFields({
  tool, mode, setField, geoIssueFields,
  proposals = null, onResolveProposal = null, listOptions = null,
  // ⚠️ EVERY FIELD APPEARS EXACTLY ONCE. When the tool page renders the profile
  // drawing, the drawing IS the editor for the dimensions it carries — so those
  // fields must not also appear in this grid. The caller passes the set the
  // drawing owns (profileDimensions), and geometryFieldsShown() below is the
  // one place that subtraction happens.
  hideFields = null,
}) {
  const sections = getToolFieldSections(tool.tool_type);
  const geometryFields = hideFields
    ? sections.geometry.filter(f => !hideFields.has(f))
    : sections.geometry;
  const edit = mode === 'edit';
  const warn = geoIssueFields || new Set();
  const propFor = (field) => (edit && proposals ? proposals.get(field) : null) || null;
  const strip = (field) => {
    const p = propFor(field);
    return p ? <ProposalStrip proposal={p} tool={tool} onResolve={onResolveProposal} /> : null;
  };

  // ── one generic field ──
  const renderField = (field) => {
    const def = FIELD_REGISTRY[field] || {};
    const control = fieldControl(field);
    const label = labelFor(field, tool);
    let raw = tool[field];
    if (showsDoubled(field, tool) && raw != null) raw = raw * 2;

    // ⚠️ THE UNDERCUT DIAMETER ONLY EXISTS WHILE THERE IS AN UNDERCUT. It is
    // optional even then (the shop often knows the neck is ground back without
    // having measured it), so an empty box next to a "No" pill would be asking
    // for the diameter of something that isn't there. Hidden in BOTH modes, so
    // turning the pill on is what makes the box appear.
    // ⚠️ REACH IS ARITHMETIC — flute length plus the neck — so wherever Fusion
    // drew a shaft it is a read-out, exactly like the undercut diameter below.
    // It was an input here while the field beside it was not: typing a reach on
    // a segmented tool looked like it worked and the next load re-derived it
    // away. Editable only where there are no segments to derive it from.
    if (field === 'reach' && edit && reachIsDerived(tool)) {
      return (
        <div className="field-group" key={field}>
          <label className="field-label">{label}</label>
          <div className="field-readout">
            {tool.reach != null
              ? <>{fmtNum(tool.reach, def.precision)} {unitAbbr(tool.unit)}</>
              : <span className="text-sub">no reach past the flutes</span>}
            <span className="field-hint"> · from the shaft segments</span>
          </div>
        </div>
      );
    }
    if (field === 'undercut_diameter' && !tool.has_undercut) return null;
    // ⚠️ Where the segments show the neck, the diameter IS that number — a fact
    // from Fusion, like the segments themselves. Rendering it as an input would
    // let someone type a value that the next load silently re-derives away.
    if (field === 'undercut_diameter' && edit && undercutDiameterHint(tool) != null) {
      return (
        <div className="field-group" key={field}>
          <label className="field-label">{label}</label>
          <div className="field-readout">
            {fmtNum(tool.undercut_diameter, def.precision)} {unitAbbr(tool.unit)}
            <span className="field-hint"> · from the shaft segments</span>
          </div>
        </div>
      );
    }

    // The undercut pill — Yes/No, not a checkbox, because it reads at a glance
    // on the tool page next to the other geometry badges.
    //
    // ⚠️ IT WRITES `undercut_override`, NOT `has_undercut`. The effective value
    // is DERIVED from the shaft segments on every load (a neck narrower than
    // the cut IS an undercut); this is the shop overriding that answer, and the
    // two have to stay distinguishable or a re-derive would look like a manual
    // choice. `↺ Auto` clears the override and hands the field back to Fusion.
    if (field === 'has_undercut') {
      if (!edit) {
        if (!tool.has_undercut) return null;   // see VIEW_HIDE_WHEN_EMPTY
        return (
          <div className="detail-field" key={field}>
            <div className="detail-field-label">{label}</div>
            <div><span className="undercut-pill">Undercut</span></div>
          </div>
        );
      }
      const prop0 = propFor(field);
      const overridden = tool.undercut_override != null;
      const derived = reachIsDerived(tool);
      return (
        <div className={`field-group ${prop0 ? `has-proposal proposal-${prop0.status}` : ''}`} key={field}>
          <label className="field-label">
            {label}
            {overridden && (
              <button type="button" className="btn btn-ghost btn-sm undercut-auto"
                title="Clear the override and take the answer from the shaft segments again"
                onClick={() => setField('undercut_override', null)}>↺ Auto</button>
            )}
          </label>
          {/* ⚠️ THREE STATES, NOT TWO. `null` means Fusion drew no shaft, so
              the app genuinely cannot say — and `!!null === false` lit the "No"
              button, asserting an answer nobody had gone and got. A strict
              compare leaves both unlit until someone (or the segments) answers. */}
          <div className="btn-toggle">
            {[[true, 'Yes'], [false, 'No']].map(([v, l]) => (
              <button key={l} type="button" className={tool.has_undercut === v ? 'active' : ''}
                onClick={() => setField('undercut_override', v)}>{l}</button>
            ))}
          </div>
          {!overridden && (
            // ⚠️ Only true where there ARE segments. Saying it on a tool with no
            // drawn shaft points at data that does not exist, and hides the fact
            // that the question is genuinely open.
            <span className="field-hint">
              {derived ? 'From the shaft segments' : 'Fusion drew no shaft — nothing to derive it from'}
            </span>
          )}
          {strip(field)}
        </div>
      );
    }

    // ⚠️ THE SHAFT PROFILE IS A LIST, EDITED IN THE TOOL PROFILE — so it is a
    // read-out here in BOTH modes, never a field. It is on this page at all
    // because outside that modal there was nothing saying a tool had a profile:
    // its neck is defining geometry, and it was invisible beside the diameter
    // and the OAL it belongs with. Hidden when there is none (most tools) —
    // a "no profile" row on the whole library is wallpaper.
    if (field === 'shaft_segments') {
      const rows = shaftRows(tool);
      if (!rows.length) return null;
      const summary = formatShaftSegments(rows, tool.unit);
      // ⚠️ On a tool the drawing CAN draw this row never renders — GeometrySection
      // hides it, because the drawing itself is the editor. It survives for the
      // two types with no drawing (boring head, turning general), where the
      // profile has nowhere else to be shown at all.
      const hint = <div className="field-hint">edited on the tool drawing</div>;
      return edit ? (
        <div className="field-group" key={field}>
          <label className="field-label">{label}</label>
          <div className="field-readout">{summary}</div>
          {hint}
        </div>
      ) : (
        <div className="detail-field" key={field}>
          <div className="detail-field-label">{label}</div>
          <div className="detail-field-value">
            {summary}
          </div>
          {hint}
        </div>
      );
    }

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
    const prop = propFor(field);
    const fieldGroup = (children) => (
      <div className={`field-group ${prop ? `has-proposal proposal-${prop.status}` : ''}`} key={field}>
        <label className="field-label">
          {label}{def.required && <span className="required"> *</span>}
        </label>
        {children}
        {strip(field)}
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
        <div className={`field-group form-grid-wide ${prop ? `has-proposal proposal-${prop.status}` : ''}`} key={field}>
          <label className="field-label">{label}</label>
          <div className="chip-group">
            {MATERIAL_SUITABILITY_OPTIONS.map(w => (
              <button key={w} type="button" className={`chip ${cur.includes(w) ? 'active' : ''}`}
                onClick={() => setField(field, cur.includes(w) ? cur.filter(x => x !== w) : [...cur, w])}>
                {w}
              </button>
            ))}
          </div>
          {strip(field)}
        </div>
      );
    }
    if (control === 'datalist') {
      const opts = listOptions?.[field] || DATALIST_FALLBACK[field] || [];
      return fieldGroup(
        <>
          <input className="field-input" list={`dl-${field}`} value={tool[field] || ''}
            onChange={e => setField(field, e.target.value)} placeholder="None" />
          <datalist id={`dl-${field}`}>
            {opts.map(v => <option key={v} value={v} />)}
          </datalist>
        </>
      );
    }
    if (control === 'num') {
      const dbl = showsDoubled(field, tool);
      const val = dbl && tool[field] != null ? tool[field] * 2 : tool[field];
      return fieldGroup(
        <NumInput
          className={`field-input ${warn.has(field) ? 'error' : ''}`}
          step={STEP[field] || '0.001'}
          precision={def.precision}
          value={val}
          placeholder="—"
          onChange={e => {
            const v = e.target.value === '' ? null : parseFloat(e.target.value);
            setField(field, (dbl && v != null) ? v / 2 : v);
          }}
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
      {geometryFields.length > 0 && (
      <div className="tool-fields-section">
        <div className="tool-fields-grid-title">Geometry</div>
        <div className={gridClass}>
          {geometryFields.map(renderField)}
        </div>
      </div>
      )}

      {sections.showThreadBlock && (
        <ThreadBlock tool={tool} mode={mode} setField={setField} fields={sections.thread} strip={strip} />
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
function ThreadBlock({ tool, mode, setField, fields, strip = () => null }) {
  const edit = mode === 'edit';
  const isTap = tool.tool_type === 'tap';
  const threadUnit = threadUnitOf(tool);
  const isMetricThread = threadUnit === 'metric';
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
        <NumInput className="field-input" step={STEP[field] || '0.001'} precision={def.precision} value={tool[field]}
          onChange={e => setField(field, e.target.value === '' ? null : parseFloat(e.target.value))} placeholder="—" />
        {strip(field)}
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
                  <button key={v} type="button" className={tool.tap_sub_type === v ? 'active' : ''}
                    onClick={() => setField('tap_sub_type', v)}>{l}</button>
                ))}
              </div>
            ) : (
              <span className={tool.tap_sub_type ? 'machine-num-badge' : 'detail-field-value detail-field-empty'} style={tool.tap_sub_type ? { textTransform: 'capitalize' } : {}}>
                {tool.tap_sub_type ? (tool.tap_sub_type === 'form' ? 'Form' : 'Cut') : '—'}
              </span>
            )}
            {edit && strip('tap_sub_type')}
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
            {edit && strip('is_sti')}
          </div>
          {has('tap_thread_unit') && (
            <div className="field-group" style={{ flex: '0 0 auto' }}>
              <label className="field-label">Thread Unit</label>
              {edit ? (
                <div className="btn-toggle">
                  {[['inch', 'Inch'], ['metric', 'Metric']].map(([v, l]) => (
                    <button key={v} type="button" className={threadUnit === v ? 'active' : ''}
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
              {strip('pitch')}
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
              {strip('point_type')}
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
              {strip('tap_class')}
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
