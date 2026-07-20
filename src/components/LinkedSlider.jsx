import { useState, useEffect, useRef } from 'react';
import { FORMULAS, FIELD_PRECISION, roundForField } from '../utils/speedsAndFeedsCalc.js';

/* ── LinkedSlider — slider + number input over the existing fx calc ──────────
   The CloudNC-style control from the UnifiedPresetEditor mockup. It is a SKIN
   over PresetPanel's existing driving/driven cascade: `fxState` is the app's
   fx entry for the field ('manual' = driving → bright track, 'formula' =
   driven → the TRACK dims to ~55% while label/badge/number stay readable),
   and onChange feeds straight into the real handleNumChange — no calc logic
   lives here.

   Soft max (feedrate + chip-load fields): hold the handle pinned at the right
   edge ~0.5s and the ceiling climbs, taking the value with it — like leaning
   on a feed override. Release and the ceiling snaps back to the default
   unless the value still needs the room, so dragging back down keeps its fine
   resolution. The silent rescale is announced by drifting chevrons (››› / ‹‹‹)
   which must fire ONLY on user-driven stretch (stretchedByUser), never on the
   auto-fit that widens a driven field's track when its partner pushes it past
   the ceiling.

   Wheel: a horizontal wheel (deltaX) or shift+vertical wheel over the track
   nudges one step. Attached as a NON-passive listener (React's onWheel can't
   reliably preventDefault, so the page would scroll). */

// Default slider bounds — PLACEHOLDERS on purpose (real per-tool/material
// limits are a deferred feature). One config object so swapping to computed
// ranges later is one function change. Values are for an inch-unit tool;
// metric tools use the overrides below. softMax marks the stretchy fields.
// RPM's max is overridden by the selected machine's max_rpm (EditCard passes
// `max`), falling back to 16000.
export const SLIDER_RANGES = {
  n:              { min: 0, max: 16000, step: 10 },
  v_c:            { min: 0, max: 1500, step: 5 },
  n_ramp:         { min: 0, max: 16000, step: 10 },
  f_z:            { min: 0, max: 0.012, step: 0.0001, softMax: true },
  f_n:            { min: 0, max: 0.05, step: 0.0001 },
  v_f:            { min: 0, max: 225, step: 0.5, softMax: true },
  v_f_leadIn:     { min: 0, max: 225, step: 0.5, softMax: true },
  v_f_leadOut:    { min: 0, max: 225, step: 0.5, softMax: true },
  v_f_transition: { min: 0, max: 225, step: 0.5, softMax: true },
  v_f_plunge:     { min: 0, max: 225, step: 0.5, softMax: true },
  v_f_retract:    { min: 0, max: 225, step: 0.5, softMax: true },
  v_f_ramp:       { min: 0, max: 225, step: 0.5, softMax: true },
  ramp_angle:     { min: 0, max: 20, step: 0.5 },
};

// Metric-tool bounds for the unit-dependent fields (clean metric steps, not
// a raw ×25.4 of the inch values). RPM/angle fields are unit-independent.
const METRIC_RANGES = {
  v_c:            { min: 0, max: 450, step: 5 },
  f_z:            { min: 0, max: 0.3, step: 0.001, softMax: true },
  f_n:            { min: 0, max: 1.2, step: 0.001 },
  v_f:            { min: 0, max: 5700, step: 10, softMax: true },
  v_f_leadIn:     { min: 0, max: 5700, step: 10, softMax: true },
  v_f_leadOut:    { min: 0, max: 5700, step: 10, softMax: true },
  v_f_transition: { min: 0, max: 5700, step: 10, softMax: true },
  v_f_plunge:     { min: 0, max: 5700, step: 10, softMax: true },
  v_f_retract:    { min: 0, max: 5700, step: 10, softMax: true },
  v_f_ramp:       { min: 0, max: 5700, step: 10, softMax: true },
};

// Fields that always show full decimal places, trailing zeros and all — a chip
// load reading "0.001" instead of "0.0010" makes a machinist re-read it.
const FIXED_DECIMALS = new Set(['f_z', 'f_n']);

// Chip loads display at 4 fixed decimals (mockup spec), falling back to the
// full stored precision when a real 5th decimal would otherwise be hidden
// (0.00085 must never render as 0.0009).
function fixedDecimalDisplay(value, prec) {
  const v = Number(value);
  const s = v.toFixed(4);
  return Math.abs(parseFloat(s) - v) > 1e-9 ? v.toFixed(Math.max(prec, 5)) : s;
}

const SOFT_MAX_DELAY = 500;    // ms holding at the edge before the ceiling moves
const SOFT_MAX_TICK  = 160;    // ms between growth steps
const SOFT_MAX_RATE  = 1.05;   // ceiling multiplier per step
const SCALE_HINT_LINGER = 700; // ms the chevrons stay after the last change

// Chevrons shown over the track while its scale is changing — drifting in the
// direction of the change. White with a dark halo (NOT the accent): while the
// ceiling grows the handle is pinned right and the bar is fully accent-filled,
// so accent-colored chevrons would vanish exactly when needed. lastDir keeps
// the glyphs mounted through the fade-out instead of blinking off.
function ScaleHint({ dir }) {
  const [lastDir, setLastDir] = useState(null);
  useEffect(() => { if (dir) setLastDir(dir); }, [dir]);
  const d = dir || lastDir;
  if (!d) return null;
  const grow = d === 'grow';
  return (
    <div className={`lslider-hint${dir ? '' : ' lslider-hint--fading'}`}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{ animation: `td-drift-${grow ? 'r' : 'l'} 0.7s ease-out ${i * 0.08}s infinite` }}>
          {grow ? '›' : '‹'}
        </span>
      ))}
    </div>
  );
}

export default function LinkedSlider({
  field, label, value, unit, fxState, onChange,
  accent, compact = false, metric = false, max, warning,
  // One-directional followers (lead-in/out, transition, ramp RPM) pass onRelink
  // + relinkLabel: the fx badge stays visible even when unlinked (greyed) and,
  // clicked, re-links the field to its source (relinkLabel names it).
  onRelink, relinkLabel,
}) {
  const base = (metric && METRIC_RANGES[field]) || SLIDER_RANGES[field] || { min: 0, max: 100, step: 1 };
  // `max` overrides the default ceiling (machine max RPM). Soft-max growth
  // still stretches past it — it's a default, not a hard limit.
  const range = max > 0 ? { ...base, max } : base;

  const trackRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dynMax, setDynMax] = useState(range.max);
  const [atEdge, setAtEdge] = useState(false);
  // 'grow' | 'shrink' | null — drives the chevron overlay. Self-clearing.
  const [hint, setHint] = useState(null);

  const driven = fxState === 'formula';
  let formulaInfo = FORMULAS[field] || null;
  // The surface-speed ↔ RPM conversion factor is unit-dependent (ft/min = 12
  // in/ft, m/min = 1000 mm/m), so the tooltip formula must match the tool's
  // unit — otherwise a mm tool would show the inch "/ 12" constant.
  if (formulaInfo && metric && (field === 'v_c' || field === 'n')) {
    formulaInfo = { ...formulaInfo, expr: formulaInfo.expr.replaceAll('12', '1000') };
  }
  const prec = FIELD_PRECISION[field] ?? 4;
  const [shiftHover, setShiftHover] = useState(false);

  const num = Number(value) || 0;
  const ratio = Math.min(1, Math.max(0, (num - range.min) / (dynMax - range.min)));

  // If the default ceiling itself changes (machine picked/unpicked, unit
  // switch), re-baseline the dynamic ceiling.
  useEffect(() => { setDynMax(m => (m < range.max || num <= range.max ? range.max : m));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.max]);

  // Chevrons clear themselves a beat after the last scale change, so holding
  // at the edge keeps them lit and letting go fades them out.
  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), SCALE_HINT_LINGER);
    return () => clearTimeout(t);
  }, [hint, dynMax]);

  /* The ceiling follows the value in both directions:
     - grow to fit any value above it (a driven field can be pushed past the
       default by its partner — better to widen than to pin the handle at the
       end and lie about where the value sits)
     - shrink back to the default once the value fits under it again.
     Shrinking mid-drag is only dangerous when the handle is near the edge
     being rescaled (it would jump under the cursor), so shrink live once the
     value sits comfortably below the default, otherwise wait for release. */
  const stretchedByUser = useRef(false);
  const belowDefault = num <= range.max * 0.85;
  useEffect(() => {
    if (num > dynMax) { setDynMax(Math.ceil(num / range.step) * range.step); return; }
    const canShrink = dynMax > range.max && num <= range.max && (!dragging || belowDefault);
    if (canShrink) {
      setDynMax(range.max);
      // Only announce the snap-back if the user is the one who stretched it.
      if (stretchedByUser.current) setHint('shrink');
      stretchedByUser.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [num, dragging]);

  // Soft-max growth while held at the edge. onChangeRef avoids a stale
  // closure inside the interval.
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => {
    if (!(range.softMax && dragging && atEdge)) return;
    let iv;
    const start = setTimeout(() => {
      iv = setInterval(() => {
        setDynMax(m => {
          const nm = roundForField(field, m * SOFT_MAX_RATE);
          onChangeRef.current(nm);
          return nm;
        });
        stretchedByUser.current = true;
        setHint('grow');
      }, SOFT_MAX_TICK);
    }, SOFT_MAX_DELAY);
    return () => { clearTimeout(start); if (iv) clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.softMax, dragging, atEdge, field]);

  function pointerRatio(clientX) {
    const rect = trackRef.current.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }
  function handlePointer(clientX) {
    const r = pointerRatio(clientX);
    setAtEdge(r >= 0.999);
    const raw = range.min + r * (dynMax - range.min);
    onChange(roundForField(field, Math.round(raw / range.step) * range.step));
  }

  /* Wheel nudging — two gestures, both meaning "move this slider sideways":
     a horizontal wheel (deltaX), or shift+vertical (the OS "scroll sideways"
     convention). One notch = one step; ctrl/cmd left alone so browser zoom
     works. Attached NON-passive so preventDefault actually stops the page
     from scrolling — React's onWheel can't guarantee that. Refs feed the
     handler so it attaches once. (Horizontal-wheel direction varies by
     OS/mouse; if it feels backwards for someone, make the sign a setting
     rather than guessing.) */
  const wheelState = useRef({});
  wheelState.current = { value, step: range.step, min: range.min, dynMax };
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const onWheel = (e) => {
      const horizontal = e.deltaX;
      const shifted = e.shiftKey ? e.deltaY : 0;
      const axis = Math.abs(horizontal) >= Math.abs(shifted) ? horizontal : shifted;
      if (!axis || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      const { value: v, step, min, dynMax: dm } = wheelState.current;
      const dir = axis > 0 ? 1 : -1;
      const next = roundForField(field, (Number(v) || 0) + dir * step);
      // Respect the current ceiling; wheel doesn't trigger soft-max growth.
      onChangeRef.current(Math.max(min, Math.min(dm, next)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field]);

  // Focused: raw stored value so it can be edited exactly. Blurred: field
  // display precision — chip loads keep trailing zeros (0.0010, not 0.001).
  const displayed = focused
    ? (value ?? '')
    : value == null || value === ''
      ? ''
      : FIXED_DECIMALS.has(field)
        ? fixedDecimalDisplay(value, prec)
        : parseFloat(Number(value).toFixed(prec));

  const noMotion = { transition: 'none' };

  return (
    <div
      className={`lslider${compact ? ' lslider--compact' : ''}${driven ? ' lslider--driven' : ''}`}
      style={accent ? { '--ls-accent': accent } : undefined}
      onMouseMove={e => { if (formulaInfo) setShiftHover(e.shiftKey); }}
      onMouseLeave={() => setShiftHover(false)}
    >
      {/* Label + fx badge — NEVER dimmed (a driven value is still one you read).
          For re-linkable followers the badge is a button: lit blue while linked,
          greyed + clickable once unlinked (click re-links to the source). */}
      <div className="lslider-label">
        <span className="lslider-name">{label}</span>
        <span className="nfield-fx">
          {onRelink ? (
            <button
              type="button"
              className={`fx-badge fx-badge--btn${driven ? '' : ' fx-badge--unlinked'}`}
              title={driven
                ? `Linked to ${relinkLabel} — change this field to unlink it`
                : `Unlinked from ${relinkLabel}. Click to re-link (back to default)`}
              onClick={() => { if (!driven) onRelink(); }}
            >fx</button>
          ) : formulaInfo ? (
            <span className={`fx-badge${driven ? '' : ' fx-badge--hidden'}`}>fx</span>
          ) : null}
        </span>
      </div>

      {/* Track — the only thing that dims when driven */}
      <div
        ref={trackRef}
        className={`lslider-track${dragging ? ' lslider-track--dragging' : ''}`}
        onPointerDown={e => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
          handlePointer(e.clientX);
        }}
        onPointerMove={e => { if (dragging) handlePointer(e.clientX); }}
        onPointerUp={() => { setDragging(false); setAtEdge(false); }}
        onPointerCancel={() => { setDragging(false); setAtEdge(false); }}
      >
        <div className="lslider-rail" />
        <div className="lslider-fill" style={{ width: `${ratio * 100}%`, ...(dragging ? noMotion : {}) }} />
        <div
          className={`lslider-handle${dragging ? (atEdge && range.softMax ? ' lslider-handle--edge' : ' lslider-handle--drag') : ''}`}
          style={{ left: `calc(${ratio * 100}% - ${compact ? 6 : 7}px)`, ...(dragging ? noMotion : {}) }}
        />
        {/* Announces the silent track rescale — see soft-max notes above */}
        <ScaleHint dir={hint} />
      </div>

      {/* Number input + unit — left-justified so the decimal point sits in the
          same place whether the value reads 7.82 or 0.0008. The slider is the
          increment control, so native spinners are suppressed (.td-noSpin). */}
      <div className="lslider-numcol">
        <div className="lslider-num">
          <input
            className="field-input td-noSpin"
            type="number"
            step={range.step}
            value={displayed}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={e => onChange(e.target.value === '' ? null : parseFloat(e.target.value))}
            placeholder="0"
          />
          <span className="lslider-unit">{unit || ''}</span>
        </div>
        {warning && <div className="fx-warning">{warning}</div>}
      </div>

      {shiftHover && formulaInfo && (
        <div className="formula-tooltip">
          <div><span className="formula-tooltip-key">Variable</span> {field}</div>
          <div><span className="formula-tooltip-key">State</span> {driven ? 'Calculated' : 'Manual'}</div>
          <div>
            <span className="formula-tooltip-key">
              {driven ? 'Formula' : 'Formula available'}
            </span>
            {formulaInfo.expr}
          </div>
        </div>
      )}
    </div>
  );
}
