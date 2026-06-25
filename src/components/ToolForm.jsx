import { useState, useEffect, useMemo } from 'react';
import { Tag, Ruler, Layers, Save, X, AlertTriangle, Wand2, ChevronDown, ChevronRight, StickyNote, MapPin } from 'lucide-react';
import {
  validateTool, validateGeometry, getNextMachineNumber, toolToExtractor,
  INCH_THREAD_SIZES, METRIC_THREAD_SIZES,
  TAP_LIMIT_TOLERANCE_OPTIONS_INCH, TAP_LIMIT_TOLERANCE_OPTIONS_METRIC,
  TAP_LIMIT_TOLERANCE_DEFAULT_INCH, TAP_LIMIT_TOLERANCE_DEFAULT_METRIC,
} from '../schema/toolSchema.js';
import { fieldLabel } from '../schema/fieldRegistry.js';
import { unitAbbr } from '../utils/units.js';
import { toolIdLabel } from '../utils/toolIdSystem.js';
import { buildToolLocation, composeLocationString, stationsForZone, drawersForStation, binsForDrawer } from '../utils/locationSystem.js';
import InfoTip from './InfoTip.jsx';
import { buildDesc } from '../utils/toolNaming.js';
import { useApp } from '../context/AppContext.jsx';
import ToolTypeDropdown from './ToolTypeDropdown.jsx';
import ToolFields from './ToolFields.jsx';

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

// Cascading Zone → Station → Drawer → Bin location picker.
// When the shop has no location_system configured, falls back to a plain Location text field.
function LocationPicker({ locationSystem, value, onChange, locationMode }) {
  const ls = locationSystem || { zones: [], stations: [], drawers: [], bins: [] };
  const hasHierarchy = ls.zones.length > 0 || ls.stations.length > 0;

  if (!hasHierarchy) {
    // No hierarchy configured — free-text fallback (legacy behavior).
    const displayVal = value?.legacy_text || '';
    return (
      <div className="field-group">
        <label className="field-label">
          Location (Cabinet)
          {locationMode && <InfoTip text="In location-mode the cabinet prefix is used in the tool ID. Configure the Location System in Settings to use a structured picker." />}
        </label>
        <input
          className="field-input"
          value={displayVal}
          placeholder="LC-140"
          onChange={e => onChange({ legacy_text: e.target.value })}
        />
      </div>
    );
  }

  const tl = value || {};
  const selectedZoneId    = tl.zone_id    || '';
  const selectedStationId = tl.station_id || '';
  const selectedDrawerId  = tl.drawer_id  || '';
  const selectedBinId     = tl.bin_id     || '';

  const stations = stationsForZone(ls, selectedZoneId || null);
  const drawers  = drawersForStation(ls, selectedStationId || null);
  const bins     = binsForDrawer(ls, selectedDrawerId || null);

  const pick = (level, id) => {
    const next = buildToolLocation(ls, id ? level : null, id || null);
    onChange(next);
  };

  const displayStr = composeLocationString(tl, ls);

  return (
    <div className="field-group">
      <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <MapPin size={13} style={{ color: 'var(--blue)' }} />
        Location
        {locationMode && <InfoTip text="In location-mode, the Station + Drawer labels form the ID prefix. Assign a location in the Location System (Settings) first." />}
      </label>
      {displayStr && <div className="font-mono text-xs" style={{ color: 'var(--blue)', marginBottom: 4 }}>{displayStr}</div>}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {/* Location Group */}
        <select className="field-input" style={{ flex: 1, minWidth: 90 }} value={selectedZoneId}
          onChange={e => pick('zone', e.target.value)}>
          <option value="">Location Group…</option>
          {ls.zones.map(z => <option key={z.id} value={z.id}>{z.label}{z.name ? ` — ${z.name}` : ''}</option>)}
        </select>
        {/* Cabinet */}
        {selectedZoneId && (
          <select className="field-input" style={{ flex: 1, minWidth: 90 }} value={selectedStationId}
            onChange={e => pick('station', e.target.value)}>
            <option value="">Cabinet…</option>
            {stations.map(s => <option key={s.id} value={s.id}>{s.label}{s.name ? ` — ${s.name}` : ''}</option>)}
          </select>
        )}
        {/* Drawer */}
        {selectedStationId && (
          <select className="field-input" style={{ flex: 1, minWidth: 90 }} value={selectedDrawerId}
            onChange={e => pick('drawer', e.target.value)}>
            <option value="">Drawer…</option>
            {drawers.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        )}
        {/* Bin */}
        {selectedDrawerId && bins.length > 0 && (
          <select className="field-input" style={{ flex: 1, minWidth: 90 }} value={selectedBinId}
            onChange={e => pick('bin', e.target.value)}>
            <option value="">Bin…</option>
            {bins.map(b => <option key={b.id} value={b.id}>Bin {b.slot_number != null ? `#${b.slot_number}` : b.id.slice(0, 6)}</option>)}
          </select>
        )}
        {displayStr && (
          <button className="btn btn-ghost btn-sm" title="Clear location" onClick={() => onChange(null)}>
            <X size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

export default function ToolForm({ tool, onSave, onCancel, isSaving, isNew }) {
  const { tools, shopSettings } = useApp();
  const idMode = shopSettings?.tool_id_system?.mode || 'proshop';
  const locationMode = idMode === 'location';
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

  // For new tools, auto-select the Location Group and Cabinet when there's only one of each.
  useEffect(() => {
    if (!isNew) return;
    if (data.tool_location?.zone_id || data.tool_location?.station_id) return;
    const ls = shopSettings?.location_system || { zones: [], stations: [], drawers: [], bins: [] };
    if (ls.zones.length !== 1) return;
    const zone = ls.zones[0];
    const cabs = (ls.stations || []).filter(s => s.zone_id === zone.id);
    if (cabs.length === 1) {
      setData(d => ({ ...d, tool_location: buildToolLocation(ls, 'station', cabs[0].id) }));
    } else {
      setData(d => ({ ...d, tool_location: buildToolLocation(ls, 'zone', zone.id) }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const geoIssues = useMemo(
    () => validateGeometry(data),
    [data.tool_type, data.diameter, data.flute_length, data.shoulder_length, data.min_ooh, data.overall_length, data.corner_radius]
  );
  const geoIssueFields = useMemo(() => new Set(geoIssues.flatMap(i => i.fields)), [geoIssues]);

  const machineNum = isNew ? previewMachineNumber : data.machine_tool_number;
  const hasMachineNum = machineNum !== null && machineNum !== undefined && machineNum !== '';

  return (
    <div className="tool-form">
      {errors.length > 0 && (
        <div className="error-banner mb-16">
          {errors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}

      {/* Tool type — a dropdown of grouped icon cards (Milling / Hole Making / …). */}
      <div className="panel open mb-16" style={{ overflow: 'visible' }}>
        <div className="panel-header static">
          <Layers size={15} className="panel-header-icon" />
          <span className="panel-header-title">Tool Type *</span>
        </div>
        <div className="panel-body">
          <ToolTypeDropdown value={data.tool_type} onChange={(t) => setField('tool_type', t)} />
        </div>
      </div>

      {/* Two-column layout mirroring the read-only tool view, so edit feels like
          "view, unlocked": geometry/material on the left, identity/notes on the right. */}
      <div className="detail-layout">
        <div className="detail-layout-left">
          <Section title="Geometry & Setup" icon={Ruler}>
            <ToolFields tool={data} mode="edit" setField={setField} geoIssueFields={geoIssueFields} />
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

          <div className="warn-banner" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={13} style={{ flexShrink: 0 }} />
            Speeds &amp; feeds are managed per preset. {isNew ? 'Add presets from the tool page after saving.' : 'Edit them in the Speeds & Feeds section on the tool page.'}
          </div>
        </div>

        <div className="detail-layout-right">
          <Section title="Identity" icon={Tag}>
            {/* Machine tool number — read-only, managed by the app */}
            {hasMachineNum && (
              <div className="flex items-center gap-8 mb-12 flex-wrap">
                <span className="text-xs text-sub">{isNew ? 'Will be assigned:' : 'Machine #'}</span>
                <span className="machine-num-badge">T{machineNum}</span>
                <span className="machine-num-badge">H{machineNum}</span>
                <span className="machine-num-badge">D{machineNum}</span>
                {!isNew && <span className="text-xs text-sub">— read-only</span>}
              </div>
            )}
            {/* Unit — selectable when creating; pulled from Fusion (read-only) when editing. */}
            <div className="flex items-center gap-8 mb-12 flex-wrap">
              <span className="text-xs text-sub">Unit</span>
              {isNew ? (
                <div className="btn-toggle">
                  {[['inches', 'Inches (in)'], ['millimeters', 'Millimeters (mm)']].map(([val, label]) => (
                    <button key={val} type="button" className={data.unit === val ? 'active' : ''} onClick={() => setField('unit', val)}>
                      {label}
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  <span className="machine-num-badge">{unitAbbr(data.unit)}</span>
                  <span className="text-xs text-sub">— from Fusion (read-only)</span>
                </>
              )}
            </div>
            <div className="field-group mb-12">
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
            <div className="form-grid">
              <FieldInput field="tool_id" label={toolIdLabel(idMode)} data={data} setField={setField} placeholder="e.g. A-3" />
              <LocationPicker
                locationSystem={shopSettings?.location_system}
                value={data.tool_location || null}
                onChange={tl => setData(d => ({ ...d, tool_location: tl }))}
                locationMode={locationMode}
              />
            </div>
          </Section>

          <Section title="Notes & Tags" icon={StickyNote}>
            <div className="form-grid">
              <FieldInput field="last_used_job" label="Last Used Job" data={data} setField={setField} />
              <FieldInput field="updated_by" label="Updated By" data={data} setField={setField} />
            </div>

            <div className="field-group mt-12">
              <label className="checkbox-row">
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
        </div>
      </div>

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
        <span className="panel-chevron">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </button>
      {open && <div className="panel-body">{children}</div>}
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
