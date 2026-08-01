// ─── Holder detail / edit ───────────────────────────────────────────────────
// Ported from docs/HolderManager.tsx (the reviewed design reference) onto the
// app's design tokens. Behaviours that look arbitrary here mostly aren't —
// the comments call out the ones that were deliberate.

import { useState, useMemo, useRef } from 'react';
import { ArrowLeft, Check, Plus, X, RotateCcw, Trash2, AlertTriangle } from 'lucide-react';
import HolderPill from './HolderPill.jsx';
import ProfileView from './ProfileView.jsx';
import {
  holderOptions, holderOption, holderOptionLabel, colletSizesForFamily, newHolderOption,
} from '../schema/holderOptions.js';
import {
  deriveGaugeLength, deriveExtensionOoh, deriveExtensionShankDia, extensionFlagMismatch,
  convertHolderUnits, formatHolderLen, trimHolderLen, holderLenIn, holderLenMm,
  nominalLengthCheck, confirmHolderNominal, newSegment, displaySegments, realSegmentIndex,
  SEG_HEIGHT, SEG_UPPER, SEG_LOWER, segHeight,
} from '../utils/holderGeometry.js';
import { composeHolderDescription, HOLDER_DESC_LIMIT } from '../utils/holderDescription.js';
import { bodyDivergenceFor } from '../utils/holderBody.js';
import { unitAbbr, normalizeUnit } from '../utils/units.js';

const THEME_SWATCHES = [
  'var(--blue)', 'var(--holder-default)', 'var(--accent)', 'var(--amber)',
  'var(--red)', 'var(--green)', 'var(--holder-30-sk13-90)', 'var(--holder-30-sk13-60)',
  'var(--orange)', 'var(--holder-30-sk13-120)',
];

function Section({ label, accent, right, children, className = '' }) {
  return (
    <div className={`holder-section ${className}`}>
      <div className="holder-section-head">
        <span className="holder-section-label" style={accent ? { color: accent } : undefined}>{label}</span>
        <div className="holder-section-rule" />
        {right}
      </div>
      {children}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div className="holder-field">
      <div className="holder-field-label">{label}</div>
      {children}
      {hint && <div className="holder-field-hint">{hint}</div>}
    </div>
  );
}

// A boolean as a pill toggle — it IS the control, so no checkbox.
function BoolPill({ label, active, onChange, accent = 'var(--blue)' }) {
  return (
    <button
      type="button"
      className={`holder-bool-pill${active ? ' active' : ''}`}
      style={active ? { '--pill-accent': accent } : undefined}
      onClick={() => onChange(!active)}
    >
      <span className="holder-bool-dot" />
      {label}
    </button>
  );
}

function ColorPicker({ value, onChange, size = 20 }) {
  const isCustom = !!value && !THEME_SWATCHES.includes(value);
  return (
    <div className="holder-color-picker">
      {THEME_SWATCHES.map(c => (
        <button
          key={c} type="button" title={c} onClick={() => onChange(c)}
          className={`holder-swatch${value === c ? ' active' : ''}`}
          style={{ width: size, height: size, background: c }}
        />
      ))}
      <span className="holder-swatch-divider" />
      <label className={`holder-swatch custom${isCustom ? ' active' : ''}`} style={{ width: size, height: size, background: isCustom ? value : 'var(--surface-3)' }} title="Custom color">
        {!isCustom && <span className="holder-swatch-plus">+</span>}
        <input type="color" value={isCustom ? value : '#4a8fff'} onChange={e => onChange(e.target.value)} />
      </label>
    </div>
  );
}

// A lookup-backed select. "+ Add custom…" appends a REAL option to the shared
// list (the bin_sizes pattern), so it becomes available everywhere — it is not
// a per-holder free-text escape.
function OptionSelect({ config, list, value, onChange, onAddOption, placeholder = '—', options }) {
  const opts = options || holderOptions(config, list);
  return (
    <div className="holder-select-wrap">
      <select
        className="field-input holder-select"
        value={value || ''}
        onChange={e => {
          if (e.target.value === '__custom__') {
            const label = window.prompt('New option name');
            if (label?.trim()) onAddOption?.(list, label.trim());
            return;
          }
          onChange(e.target.value || null);
        }}
      >
        <option value="">{placeholder}</option>
        {opts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        {onAddOption && <option value="__custom__">+ Add custom…</option>}
      </select>
    </div>
  );
}

// ─── Segment table — top-down display, bottom-up storage ────────────────────
// Fusion's JSON stores segments bottom-up (array[0] = tip); Fusion's own editor
// shows them top-down (row 1 = gauge line / spindle end), because that reads the
// way a machinist looks at the holder. The app follows Fusion's UI. Every edit
// maps back to the real index, so the STORED array order never changes.
//
// New rows are added at the TIP (visually the bottom row) — that's where an
// extension actually attaches — which makes "add" a prepend, not an append.
function SegmentTable({ segments, unit, onChange, hasExtension, activeSeg, setActiveSeg }) {
  const n = segments.length;
  const [focusedCell, setFocusedCell] = useState(null);
  const [hoverSeg, setHoverSeg] = useState(null);
  const [selAnchor, setSelAnchor] = useState(null);
  const [selEnd, setSelEnd] = useState(null);
  const rowRefs = useRef({});

  const ri = (vi) => realSegmentIndex(vi, n);
  const clearSelection = () => { setSelAnchor(null); setSelEnd(null); };

  const set = (vi, key, val) => {
    const i = ri(vi);
    onChange(segments.map((s, k) => (k === i ? { ...s, [key]: val } : s)));
  };
  // The shank is single-select across the whole holder — a diameter can only be
  // "the" mating shank once. Clicking the checked row clears it; clicking any
  // other row moves the flag and clears it everywhere else.
  const setShank = (vi) => {
    const i = ri(vi);
    const already = !!segments[i].shank_seg;
    onChange(segments.map((s, k) => ({ ...s, shank_seg: !already && k === i })));
  };
  // Both of these change the row COUNT, so any live selection's indices would
  // point at the wrong rows afterwards — clear rather than let it go stale.
  const addRow = () => { onChange([newSegment(), ...segments]); clearSelection(); setActiveSeg(null); };
  const delRow = (vi) => { onChange(segments.filter((_, k) => k !== ri(vi))); clearSelection(); setActiveSeg(null); };

  // Cells show the rounded value at rest but the raw stored number while that
  // exact cell has focus, so rounding-on-every-keystroke doesn't fight typing.
  // One state var keyed by "realIndex-field", not a hook per cell.
  const cellValue = (i, key, raw) => (focusedCell === `${i}-${key}` ? raw : formatHolderLen(raw, unit));

  // Shift-click range select — the "what do these add up to" tool. Standard
  // file-manager convention: shift-click sets an anchor or extends from it, a
  // plain click clears. Indices are VISUAL (what the user is looking at); a
  // contiguous visual range is contiguous in the real array too.
  const selRange = selAnchor != null ? [Math.min(selAnchor, selEnd), Math.max(selAnchor, selEnd)] : null;
  const isSelected = (vi) => !!selRange && vi >= selRange[0] && vi <= selRange[1];
  const onRowNumberClick = (vi, shift) => {
    if (!shift) { clearSelection(); return; }
    if (selAnchor == null) { setSelAnchor(vi); setSelEnd(vi); } else setSelEnd(vi);
  };

  const display = displaySegments(segments);
  const selectedSum = selRange
    ? display.slice(selRange[0], selRange[1] + 1).reduce((a, s) => a + segHeight(s), 0)
    : 0;
  const selectedCount = selRange ? selRange[1] - selRange[0] + 1 : 0;

  const gauge = deriveGaugeLength(segments);
  const extOoh = deriveExtensionOoh(segments);
  const abbr = unitAbbr(unit);

  return (
    <div>
      {/* nowrap keeps the profile pinned beside the table at any width — with
          wrap on, the profile jumped above the table on narrow screens; now the
          table scrolls horizontally inside its own box instead. */}
      <div className="holder-geo-row">
        <ProfileView
          segments={segments} unit={unit}
          selectedIndex={activeSeg} onSelect={setActiveSeg}
          hoverIndex={hoverSeg} onHover={setHoverSeg}
        />
        <div className="holder-geo-tablecol">
          <div className="holder-seg-scroll">
            <table className="holder-seg-table">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Height ({abbr})</th>
                  <th>Upper Ø ({abbr})</th>
                  <th>Lower Ø ({abbr})</th>
                  <th className="ctr">Above<br />gauge</th>
                  <th className="ctr ext">Extension</th>
                  {hasExtension && <th className="ctr shank">Ext shank<br />Ø</th>}
                  <th className="num" />
                </tr>
              </thead>
              <tbody>
                {display.map((s, vi) => {
                  const i = ri(vi);
                  const sel = isSelected(vi);
                  const cls = [
                    activeSeg === i ? 'active' : '',
                    hoverSeg === i ? 'hover' : '',
                    sel ? 'selected' : '',
                    s.ext ? 'is-ext' : '',
                  ].filter(Boolean).join(' ');
                  return (
                    <tr
                      key={i} className={cls}
                      ref={el => { rowRefs.current[vi] = el; }}
                      onMouseEnter={() => setHoverSeg(i)}
                      onMouseLeave={() => setHoverSeg(null)}
                    >
                      <td
                        className="holder-seg-num"
                        onClick={e => onRowNumberClick(vi, e.shiftKey)}
                        title="Click to clear · shift-click to select a range and see the total"
                      >{vi + 1}</td>
                      {[SEG_HEIGHT, SEG_UPPER, SEG_LOWER].map(key => (
                        <td key={key}>
                          <input
                            className="field-input holder-seg-input" type="number" step="0.001"
                            value={cellValue(i, key, s[key]) ?? ''}
                            onFocus={() => { setFocusedCell(`${i}-${key}`); clearSelection(); }}
                            onBlur={() => setFocusedCell(null)}
                            onChange={e => set(vi, key, parseFloat(e.target.value) || 0)}
                          />
                        </td>
                      ))}
                      <td className="ctr">
                        <input type="checkbox" checked={!!s.above_gauge}
                          onChange={e => set(vi, 'above_gauge', e.target.checked)} />
                      </td>
                      <td className="ctr">
                        {/* THE NEW FLAG. The checked heights sum to the extension OOH. */}
                        <input type="checkbox" checked={!!s.ext}
                          onChange={e => set(vi, 'ext', e.target.checked)} />
                      </td>
                      {hasExtension && (
                        <td className="ctr">
                          {/* Only meaningful inside an extension segment: marks
                              WHICH diameter is the mating shank. Single-select. */}
                          <input
                            type="checkbox" checked={!!s.shank_seg} disabled={!s.ext}
                            onChange={() => setShank(vi)}
                            style={{ opacity: s.ext ? 1 : 0.3, cursor: s.ext ? 'pointer' : 'not-allowed' }}
                          />
                        </td>
                      )}
                      <td className="ctr">
                        <button className="icon-btn danger" title="Delete segment" onClick={() => delRow(vi)}>
                          <X size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Floating range total, positioned against the ACTIVE end of the
                selection (selEnd) so it tracks the most recent shift-click.
                Measured from the real row, not from hardcoded row heights. */}
            {selRange && rowRefs.current[selEnd] && (
              <div
                className="holder-seg-total"
                style={{ top: `${rowRefs.current[selEnd].offsetTop + rowRefs.current[selEnd].offsetHeight / 2 - 15}px` }}
              >
                <span className="count">{selectedCount} seg{selectedCount === 1 ? '' : 's'}</span>
                <span className="sum">{formatHolderLen(selectedSum, unit)} {abbr}</span>
              </div>
            )}
          </div>

          <div className="holder-seg-note">
            Row 1 = gauge line / spindle end · last row = tool tip — matches Fusion's own editor.
            New segments are added at the tip. Shift-click row numbers to total a range · click a number to clear.
          </div>
          <button className="btn btn-secondary btn-sm holder-add-seg" onClick={addRow}>
            <Plus size={13} /> Add segment at tip
          </button>
        </div>
      </div>

      {/* Derived readouts — both computed from the table, neither typeable. */}
      <div className="holder-derived-row">
        <div className="holder-derived">
          <div className="holder-derived-label">GAUGE LENGTH</div>
          <div className="holder-derived-value">
            <span className="big">{formatHolderLen(gauge, unit)}</span>
            <span className="unit">{abbr}</span>
            <span className="alt">
              ({normalizeUnit(unit) === 'millimeters'
                ? `${formatHolderLen(holderLenIn(gauge, unit), 'inches')} in`
                : `${formatHolderLen(holderLenMm(gauge, unit), 'millimeters')} mm`})
            </span>
          </div>
          <div className="holder-derived-hint">sum of segments below the gauge line</div>
        </div>

        {/* Only takes space on holders that actually have an extension. */}
        {hasExtension && (
          <div className={`holder-derived${extOoh != null ? ' ext' : ''}`}>
            <div className="holder-derived-label">EXTENSION OOH</div>
            <div className="holder-derived-value">
              <span className="big">{extOoh != null ? formatHolderLen(holderLenIn(extOoh, unit), 'inches') : '—'}</span>
              <span className="unit">in</span>
              {extOoh != null && (
                <span className="alt">({formatHolderLen(holderLenMm(extOoh, unit), 'millimeters')} mm)</span>
              )}
            </div>
            <div className="holder-derived-hint">sum of flagged extension segments — derived, not editable</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function HolderDetail({
  holder, config, usage = 0, allLocations = [], readOnly, updatedBy = '', siblings = [],
  onBack, onSave, onDelete, onAddOption, onViewTools,
}) {
  const [h, setH] = useState(holder);
  const [activeSeg, setActiveSeg] = useState(null);
  const [saving, setSaving] = useState('');
  const set = (k, v) => setH(p => ({ ...p, [k]: v }));
  const setExt = (k, v) => setH(p => ({ ...p, extension: { ...(p.extension || {}), [k]: v } }));

  const suggested = useMemo(() => composeHolderDescription(h, config), [h, config]);
  const overLimit = (h.description || '').length > HOLDER_DESC_LIMIT;
  const taperOpt = holderOption(config, 'tapers', h.taper_id);
  const extOoh = deriveExtensionOoh(h.segments);
  const shankDia = deriveExtensionShankDia(h.segments);
  const mismatch = extensionFlagMismatch(h);
  // The band is scoped to the COLLET FAMILY, so the check needs its label.
  const familyLabel = holderOptionLabel(config, 'collet_families', h.collet_family_id);
  const nominal = useMemo(() => nominalLengthCheck(h, familyLabel), [h, familyLabel]);
  // A holder body and its extension are separate parts assembled at several
  // stickouts, so the same body is duplicated across records — and duplicated
  // data drifts. When two records of one physical holder disagree, at least one
  // is wrong and nothing here can tell which, so it names the siblings and
  // stops there.
  const bodyClash = useMemo(() => bodyDivergenceFor(h, siblings, config), [h, siblings, config]);

  const save = async () => {
    setSaving('Saving…');
    try {
      await onSave(h);
      setSaving('Saved');
      setTimeout(() => setSaving(''), 1200);
    } catch (e) {
      setSaving(e?.message || 'Save failed');
    }
  };

  return (
    <div className="holder-detail">
      <div className="holder-detail-head">
        <button className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft size={14} /> Holders</button>
        <div className="holder-detail-title">
          <HolderPill holder={h} config={config} />
          <div className="holder-detail-id">{h.holder_ref}</div>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          disabled={!usage}
          onClick={() => usage && onViewTools?.(h)}
          title={usage ? `Show the ${usage} tools using this holder` : 'No tools are linked to this holder yet'}
        >
          used by {usage} tool{usage === 1 ? '' : 's'}{usage > 0 ? ' →' : ''}
        </button>
        {saving && <span className="holder-save-msg">{saving}</span>}
        {!readOnly && <button className="btn btn-primary btn-sm" onClick={save}><Check size={14} /> Save</button>}
      </div>

      {/* ⚠️ Propagation to tools is NOT wired yet — the re-stamp push and the
          lazy "next tool save pulls current geometry" both depend on the
          tool→holder FK, which is the next phase. Stated plainly rather than
          shown as a button that does nothing. */}
      <div className="holder-note-banner">
        <AlertTriangle size={14} />
        <span>
          Holder records are app-owned and saved here only. Pushing geometry to the Fusion
          holder library, and re-stamping the tools that use a holder, are separate steps
          that aren't wired up yet.
        </span>
      </div>

      {bodyClash && (
        <div className="holder-clash-banner">
          <AlertTriangle size={14} />
          <div>
            <strong>This holder body doesn’t match its other records.</strong>{' '}
            The taper holder and the extension are separate parts, so the same body
            appears on every record built from it — these disagree, which means at
            least one is wrong.
            <ul>
              {bodyClash.others.map((v, i) => (
                <li key={i}>
                  {v.records.map(r => r.description || r.holder_ref).join(' · ')}
                  {' '}— different body geometry
                </li>
              ))}
            </ul>
            <span className="holder-clash-note">
              Compare the segment tables and correct whichever is wrong. Nothing is changed for you.
            </span>
          </div>
        </div>
      )}

      <div className="holder-detail-grid">
        <Section label="Identity" accent="var(--accent)">
          <Field label="Description" hint={`Physical tool tags fit about ${HOLDER_DESC_LIMIT} characters — shorten by hand when needed`}>
            <input
              className={`field-input${overLimit ? ' over-limit' : ''}`}
              value={h.description || ''}
              onChange={e => { set('description', e.target.value); set('description_manual', true); }}
            />
            <div className="holder-desc-meta">
              <span className={`count${overLimit ? ' over' : ''}`}>
                {(h.description || '').length}/{HOLDER_DESC_LIMIT}
              </span>
              {/* Suggestion only — an explicit click puts it in the draft, and
                  the draft still has to be saved. A description is never
                  rewritten automatically: holderShortName() parses it into
                  preset names and asm_number, so a silent rewrite can orphan
                  presets. */}
              {suggested && suggested !== h.description && (
                <>
                  <span className="suggested">suggested: {suggested}</span>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => { set('description', suggested); set('description_manual', false); }}
                  ><RotateCcw size={12} /> Use auto</button>
                </>
              )}
            </div>
          </Field>

          <Field label="Color" hint="Shows as this holder's pill wherever it appears">
            <div className="holder-color-row">
              <ColorPicker value={h.color} onChange={v => set('color', v)} />
              <HolderPill holder={h} config={config} compact />
            </div>
          </Field>

          <div className="holder-field-pair">
            <Field label="Manufacturer">
              <input className="field-input" value={h.manufacturer || ''} onChange={e => set('manufacturer', e.target.value)} />
            </Field>
            <Field label="Part number">
              <input className="field-input" value={h.part_number || ''} onChange={e => set('part_number', e.target.value)} />
            </Field>
          </div>

          <Field label="Location" hint="Free text — suggestions come from other holders">
            <input className="field-input" list="holder-locations" value={h.location || ''} onChange={e => set('location', e.target.value)} />
            <datalist id="holder-locations">
              {allLocations.map(l => <option key={l} value={l} />)}
            </datalist>
          </Field>

          {!!(h.legacy_ids || []).length && (
            <div className="holder-legacy">
              Formerly: {h.legacy_ids.join(' · ')}
            </div>
          )}
        </Section>

        <Section label="Classification" accent="var(--accent)">
          <div className="holder-field-pair">
            <Field label="Type">
              <OptionSelect config={config} list="types" value={h.type_id} onChange={v => set('type_id', v)} onAddOption={onAddOption} />
            </Field>
            <Field label="Taper">
              <OptionSelect config={config} list="tapers" value={h.taper_id} onChange={v => set('taper_id', v)} onAddOption={onAddOption} />
            </Field>
          </div>

          {taperOpt?.dual_contact && (
            <div className="holder-dc-pill">
              <span className="tag">DUAL CONTACT</span>
              <span className="text">
                {taperOpt.nikken
                  ? 'NBT is Nikken’s designation for a dual-contact BT taper'
                  : 'Simultaneous taper + flange face contact'}
              </span>
            </div>
          )}

          <div className="holder-field-triple">
            <Field label="Collet family">
              <OptionSelect config={config} list="collet_families" value={h.collet_family_id} onChange={v => set('collet_family_id', v)} onAddOption={onAddOption} />
            </Field>
            <Field label="Collet size">
              <OptionSelect
                config={config} list="collet_sizes" value={h.collet_size_id}
                options={colletSizesForFamily(config, h.collet_family_id)}
                onChange={v => set('collet_size_id', v)} onAddOption={onAddOption}
              />
            </Field>
            <Field label="Length" hint="The engraved nominal">
              <input
                className="field-input" type="number" value={h.length ?? ''}
                onChange={e => set('length', e.target.value ? parseFloat(e.target.value) : null)}
              />
            </Field>
          </div>

          {/* Length check — the app's BEST GUESS, confirmed once by the user.
              The engraved nominal is measured with the collet nut backed off,
              so the modelled gauge runs a few mm shorter. That delta is a
              property of the collet system, so there's a verified band for SK
              and none for the rest (see NOMINAL_BANDS_MM) — where there's no
              rule the app reports the number and claims nothing.

              Either way this is never a fix and never auto-resolves: the user
              accepts each holder once, and the confirmation expires by itself
              if the nominal, the geometry, the unit or the collet family
              changes (holderNominalSignature). */}
          {nominal && (
            <div className={`holder-nominal ${nominal.confirmed ? 'confirmed' : nominal.status}`}>
              <div className="holder-nominal-text">
                <strong>
                  Nominal {nominal.nominalMm} vs base gauge {nominal.baseGaugeMm.toFixed(2)}mm
                  {' '}— Δ {nominal.deltaMm.toFixed(2)}mm
                </strong>
                {nominal.status === 'ok' && ` — within the usual ${nominal.band.min}–${nominal.band.max}mm for ${nominal.familyLabel} collets.`}
                {nominal.status === 'flag' && ` — outside the usual ${nominal.band.min}–${nominal.band.max}mm for ${nominal.familyLabel} collets. Worth reviewing.`}
                {nominal.status === 'unknown' && (
                  nominal.familyLabel
                    ? ` — no verified range for ${nominal.familyLabel} yet, so this is unchecked.`
                    : ' — the nut-tight offset only applies to collet holders, so this is unchecked.'
                )}
              </div>
              {nominal.confirmed ? (
                <div className="holder-nominal-actions">
                  <span className="holder-nominal-confirmed">
                    ✓ Confirmed{h.nominal_check?.confirmed_at ? ` ${new Date(h.nominal_check.confirmed_at).toLocaleDateString()}` : ''}
                  </span>
                  <button className="btn btn-ghost btn-sm" onClick={() => set('nominal_check', null)}>Re-check</button>
                </div>
              ) : (
                <div className="holder-nominal-actions">
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setH(p => confirmHolderNominal(p, nominal.familyLabel, updatedBy))}
                  >Confirm this length</button>
                </div>
              )}
            </div>
          )}

          <div className="holder-bool-row">
            <BoolPill label="Tap collet" active={!!h.is_tap_collet} onChange={v => set('is_tap_collet', v)} accent="var(--amber)" />
          </div>
        </Section>
      </div>

      <Section
        label="Extension" accent="var(--green)" className="holder-ext-section"
        right={extOoh != null && (
          <span className="holder-ext-readout">{formatHolderLen(holderLenIn(extOoh, h.unit), 'inches')} in OOH</span>
        )}
      >
        <div className="holder-bool-row">
          <BoolPill
            label="This holder uses an extension" active={!!h.has_extension}
            onChange={v => set('has_extension', v)} accent="var(--green)"
          />
        </div>

        {mismatch && (
          <div className="holder-warn">
            {h.has_extension
              ? 'Extension is on, but no segments are flagged as Extension in the geometry below. The OOH can’t be derived until they are.'
              : 'Segments are flagged as Extension in the geometry below, but the Extension toggle is off.'}
          </div>
        )}

        {h.has_extension && (
          <div className="holder-ext-grid">
            <Field label="Extension collet">
              <OptionSelect
                config={config} list="collet_sizes" value={h.extension?.collet_size_id}
                onChange={v => setExt('collet_size_id', v)} onAddOption={onAddOption}
              />
            </Field>
            <Field label="Manufacturer">
              <input className="field-input" value={h.extension?.manufacturer || ''} onChange={e => setExt('manufacturer', e.target.value)} />
            </Field>
            <Field label="Part number">
              <input className="field-input" value={h.extension?.part_number || ''} onChange={e => setExt('part_number', e.target.value)} />
            </Field>
            <Field label="Vendor / source">
              <input className="field-input" value={h.extension?.vendor || ''} onChange={e => setExt('vendor', e.target.value)} />
            </Field>
            <Field label="OOH (derived)" hint="Set by flagging segments below">
              <input className="field-input holder-readonly ext" readOnly
                value={extOoh != null ? `${formatHolderLen(holderLenIn(extOoh, h.unit), 'inches')} in` : '—'} />
            </Field>
            <Field label="Extension shank diameter (derived)" hint="Mark one segment as the shank below">
              <input className={`field-input holder-readonly${shankDia != null ? ' ext' : ''}`} readOnly
                value={shankDia != null ? `${trimHolderLen(shankDia, h.unit)} ${unitAbbr(h.unit)}` : '—'} />
            </Field>
          </div>
        )}
      </Section>

      <Section
        label="Holder Geometry" accent="var(--blue)" className="holder-geo-section"
        right={
          /* The holder's OWN unit — independent of every other unit setting in
             the app, because a holder is drawn in whatever unit its
             manufacturer published. Toggling REWRITES every stored dimension
             (a real conversion), so a correction can be typed in whichever
             unit the source spec used. */
          <div className="btn-toggle holder-unit-toggle">
            {['millimeters', 'inches'].map(u => (
              <button
                key={u} className={normalizeUnit(h.unit) === u ? 'active' : ''}
                onClick={() => normalizeUnit(h.unit) !== u && setH(p => convertHolderUnits(p, u))}
              >{u === 'millimeters' ? 'Millimeters' : 'Inches'}</button>
            ))}
          </div>
        }
      >
        <SegmentTable
          segments={h.segments || []} unit={h.unit}
          onChange={v => set('segments', v)}
          hasExtension={!!h.has_extension}
          activeSeg={activeSeg} setActiveSeg={setActiveSeg}
        />
      </Section>

      <div className="holder-detail-grid">
        <Section label="Notes" accent="var(--text-sub)">
          <textarea
            className="field-input holder-notes" value={h.notes || ''}
            onChange={e => set('notes', e.target.value)}
            placeholder="Setup notes, quirks, min OOH…"
          />
        </Section>
        <Section label="Danger zone" accent="var(--text-sub)">
          <button className="btn btn-ghost btn-sm" onClick={() => onDelete?.(h)}>
            <Trash2 size={13} /> Delete this holder record
          </button>
          <div className="holder-field-hint" style={{ marginTop: 6 }}>
            Removes the app record only. The Fusion holder library is untouched.
          </div>
        </Section>
      </div>
    </div>
  );
}

export { SegmentTable, Section as HolderSection, Field as HolderField, BoolPill, ColorPicker, OptionSelect, newHolderOption, holderOptionLabel };
