const PI = Math.PI;

// ── Speed conversions ─────────────────────────────────────────────────────────
export function rpmToSFM(rpm, diameterInches) {
  if (!rpm || !diameterInches) return 0;
  return (rpm * PI * diameterInches) / 12;
}

export function sfmToRPM(sfm, diameterInches) {
  if (!sfm || !diameterInches) return 0;
  return (sfm * 12) / (PI * diameterInches);
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
  v_f: 2, v_f_plunge: 2, v_f_retract: 2,
  v_f_leadIn: 2, v_f_leadOut: 2, v_f_transition: 2,
  f_z: 5, f_n: 5,
};

export function roundForField(field, value) {
  if (value === null || value === undefined || isNaN(value)) return 0;
  const decimals = FIELD_PRECISION[field] ?? 4;
  return parseFloat(value.toFixed(decimals));
}
