// Centralized unit handling.
//
// Canonical model: every length is stored in its record's OWN unit
// ('inches' | 'millimeters') — a tool's lengths in the tool's unit, a holder's
// in the holder's unit. There is no hidden inches-canonical length anymore
// (OOH/min_ooh included). This module is the single place that converts between
// units, formats lengths for display, supplies the global default unit, and
// provides unit-aware comparison tolerances. Convert only at genuine
// cross-unit boundaries (e.g. a mm holder on an inch tool, or a ProShop file in
// a different unit than the tool).

export const MM_PER_IN = 25.4;
const DEFAULT_UNIT_KEY = 'app_default_unit';

// Coerce any unit-ish value to the canonical 'inches' | 'millimeters'.
export function normalizeUnit(unit) {
  return unit === 'millimeters' || unit === 'mm' ? 'millimeters' : 'inches';
}

// Shop-wide default unit, used for new records and wherever a record has no unit
// of its own. Stored in localStorage (not sensitive). Defaults to inches.
export function getDefaultUnit() {
  try {
    return normalizeUnit(localStorage.getItem(DEFAULT_UNIT_KEY) || 'inches');
  } catch {
    return 'inches';
  }
}

export function setDefaultUnit(unit) {
  try {
    localStorage.setItem(DEFAULT_UNIT_KEY, normalizeUnit(unit));
  } catch {
    /* ignore */
  }
}

// Convert a length between units. Pass-through when the units match or the value
// is empty/non-numeric (returned unchanged so callers can stay null-safe).
export function convertLength(value, fromUnit, toUnit) {
  if (value == null || value === '' || isNaN(Number(value))) return value;
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  const v = Number(value);
  if (from === to) return v;
  return from === 'inches' ? v * MM_PER_IN : v / MM_PER_IN;
}

export const toInches = (v, unit) => convertLength(v, unit, 'inches');
export const fromInches = (v, unit) => convertLength(v, 'inches', unit);

// Short unit suffix: 'in' | 'mm'.
export function unitAbbr(unit) {
  return normalizeUnit(unit) === 'millimeters' ? 'mm' : 'in';
}

// Default display precision for a unit (mm shows fewer decimals than inches).
export function unitPrecision(unit) {
  return normalizeUnit(unit) === 'millimeters' ? 3 : 4;
}

// Unit-aware comparison tolerance for matching lengths (≈0.0005"). Used when
// deciding whether two stick-outs / holder gauges are "the same".
const EPS_IN = 0.0005;
export function lengthEps(unit) {
  return normalizeUnit(unit) === 'millimeters' ? EPS_IN * MM_PER_IN : EPS_IN;
}

// Format a length for display, in its own unit, with the unit suffix appended.
export function formatLength(value, unit, precision) {
  if (value == null || value === '' || isNaN(Number(value))) return '';
  const u = normalizeUnit(unit);
  const p = precision != null ? precision : (u === 'millimeters' ? 2 : 3);
  return `${Number(value).toFixed(p)} ${unitAbbr(u)}`;
}
