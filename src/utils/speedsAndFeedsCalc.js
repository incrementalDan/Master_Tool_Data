const PI = Math.PI;

// ── Speed conversions ─────────────────────────────────────────────────────────
// Surface speed ↔ spindle speed is UNIT-DEPENDENT: an inch tool's surface speed
// is ft/min (12 in/ft), a millimeters tool's is m/min (1000 mm/m). Pass
// metric=true for a millimeters tool so the divisor matches the tool's unit —
// otherwise a mm tool's v_c↔n link is off by ~83×. (The feed conversions below
// — v_f = f_z·n·flutes, plunge = f_n·n — are unit-INDEPENDENT and need no flag.)
export function rpmToSFM(rpm, diameter, metric = false) {
  if (!rpm || !diameter) return 0;
  return (rpm * PI * diameter) / (metric ? 1000 : 12);
}

export function sfmToRPM(surfaceSpeed, diameter, metric = false) {
  if (!surfaceSpeed || !diameter) return 0;
  return (surfaceSpeed * (metric ? 1000 : 12)) / (PI * diameter);
}

// ── Cutting feed conversions ──────────────────────────────────────────────────
export function fptToIPM(fpt, rpm, numberOfFlutes) {
  if (!fpt || !rpm || !numberOfFlutes) return 0;
  return fpt * rpm * numberOfFlutes;
}

export function ipmToFPT(ipm, rpm, numberOfFlutes) {
  if (!ipm || !rpm || !numberOfFlutes) return 0;
  return ipm / (rpm * numberOfFlutes);
}

// ── Plunge feed conversions ───────────────────────────────────────────────────
export function iprToIPM(ipr, rpm) {
  if (!ipr || !rpm) return 0;
  return ipr * rpm;
}

export function ipmToIPR(ipm, rpm) {
  if (!ipm || !rpm) return 0;
  return ipm / rpm;
}

// ── Formula metadata for tooltips ────────────────────────────────────────────
export const FORMULAS = {
  v_c:            { expr: '(n × π × Ø) / 12',     vars: ['n'] },
  n:              { expr: '(SFM × 12) / (π × Ø)',  vars: ['v_c'] },
  n_ramp:         { expr: 'n',                       vars: ['n'] },
  v_f:            { expr: 'f_z × n × flutes',        vars: ['f_z', 'n'] },
  f_z:            { expr: 'v_f / (n × flutes)',       vars: ['v_f', 'n'] },
  v_f_plunge:     { expr: 'f_n × n',                  vars: ['f_n', 'n'] },
  v_f_retract:    { expr: 'v_f_plunge',               vars: ['v_f_plunge'] },
  f_n:            { expr: 'v_f_plunge / n',            vars: ['v_f_plunge', 'n'] },
  v_f_leadIn:     { expr: 'v_f',                       vars: ['v_f'] },
  v_f_leadOut:    { expr: 'v_f',                       vars: ['v_f'] },
  v_f_transition: { expr: 'v_f',                       vars: ['v_f'] },
};

// ── Display precision (decimal places) per field ──────────────────────────────
export const FIELD_PRECISION = {
  n: 0, n_ramp: 0,
  v_c: 1,
  v_f: 2, v_f_plunge: 2, v_f_retract: 2, v_f_ramp: 2,
  v_f_leadIn: 2, v_f_leadOut: 2, v_f_transition: 2,
  f_z: 5, f_n: 5,
  ramp_angle: 1,
};

export function roundForField(field, value) {
  if (value === null || value === undefined || isNaN(value)) return 0;
  const decimals = FIELD_PRECISION[field] ?? 4;
  return parseFloat(value.toFixed(decimals));
}

// Round a raw amount to a "nice" increment — 1, 2, or 5 × a power of ten
// (0.00024 → 0.0002, 0.0008 → 0.001, 640 → 500). Used to keep a proportional
// slider nudge on a clean number instead of an ugly float.
export function niceIncrement(target) {
  const t = Math.abs(Number(target) || 0);
  if (!(t > 0)) return 0;
  const base = Math.pow(10, Math.floor(Math.log10(t)));
  const frac = t / base;
  const nice = frac < 1.5 ? 1 : frac < 3.5 ? 2 : frac < 7.5 ? 5 : 10;
  return nice * base;
}

// Fraction of the current value one wheel/scroll notch moves a slider. A fixed
// step is too coarse for a small value and too fine for a large one; this scales
// with the value so a nudge stays proportional (0.010 → 0.001, 0.005 → 0.0005).
export const WHEEL_STEP_PCT = 0.08;

// The dynamic step for one wheel notch: ~WHEEL_STEP_PCT of the current value,
// rounded to a nice increment, floored at the field's base step so you can still
// nudge up from zero (or a tiny value) and never get a sub-precision step.
export function dynamicStep(value, baseStep = 0, pct = WHEEL_STEP_PCT) {
  const dyn = niceIncrement((Math.abs(Number(value) || 0)) * pct);
  return Math.max(dyn, baseStep) || baseStep || 1;
}
