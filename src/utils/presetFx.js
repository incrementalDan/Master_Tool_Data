// Preset editor formula-link (fx) state — pure logic, extracted so the
// "don't clobber a stored value on open" invariant can be locked by tests.
//
// Each speed/feed field is 'manual' (the user owns it) or 'formula' (derived
// from a source). Two kinds of link exist and they matter for data safety:
//   • Bidirectional PAIRS that are mathematically locked — v_c↔n, v_f↔f_z,
//     v_f_plunge↔f_n. One side is the driver, the other is derived; a
//     Fusion-consistent preset has them already equal, so recomputing the
//     derived side on open is a no-op (never a clobber).
//   • One-directional FOLLOWERS with an independent DEFAULT — v_f_leadIn/
//     leadOut/transition default to v_f, v_f_retract defaults to plunge, n_ramp
//     defaults to n. These can legitimately hold a value that DIFFERS from
//     their source. Recomputing them on open would silently overwrite that
//     stored value (the lead-in/transition bug), so a follower whose stored
//     value already differs opens 'manual' (preserved) instead of 'formula'.
import {
  rpmToSFM, fptToIPM, ipmToFPT, iprToIPM, ipmToIPR, roundForField,
} from './speedsAndFeedsCalc.js';

// Default fx when opening a preset. 'manual' = user owns; 'formula' = derived.
export const DEFAULT_FX = {
  n:              'manual',
  v_c:            'formula',
  n_ramp:         'formula',
  v_f:            'formula',
  f_z:            'manual',
  v_f_plunge:     'formula',
  v_f_retract:    'formula',
  f_n:            'manual',
  v_f_leadIn:     'formula',
  v_f_leadOut:    'formula',
  v_f_transition: 'formula',
};

// A follower "still follows" its source when it's absent or equal to it.
const followsSource = (val, src) =>
  val == null || Math.abs(Number(val) - Number(src ?? 0)) < 1e-6;

// ⚠️ A FORMULA WITH NO INPUT DOES NOT PRODUCE AN ANSWER — IT PRODUCES ZERO.
//
// The pair note above says a Fusion-consistent preset has both sides already
// equal, so recomputing the derived side on open is a no-op. That premise is
// false whenever Fusion stored only ONE side of the pair, which is routine: a
// drill carries a plunge feedrate (`v_f_plunge`) and NO feed-per-rev (`f_n`).
// Opening such a preset recomputed plunge as f_n × n = 0 × 16000 = 0 and wiped
// a proven feed — the collapsed card still showed the real value, so the editor
// silently disagreed with the card right above it.
//
// Measured on the real library: 109 presets carry a plunge their f_n cannot
// reproduce because there is no f_n at all, plus 1 surface speed with no RPM.
// Every one of them was zeroed on open, and saved as 0 on save.
//
// So: a derived side whose SOURCE is missing keeps its stored value (manual).
// This is the same rule `followsSource` already applies to the one-directional
// followers, extended to the locked pairs — "don't overwrite a real stored value
// with something the formula can't actually compute".
const hasValue = (v) => v != null && v !== '' && Number(v) !== 0 && !Number.isNaN(Number(v));
const derivedIsOrphaned = (derived, source) => hasValue(derived) && !hasValue(source);

// The fx state a preset opens with, given the tool-type flags. This is the
// single source of the open-time linkage decisions — the piece that decides
// which stored values are preserved vs. recomputed. See computeFormulaDraft.
export function initialPresetFx(preset, { isMilling, isSpotDrill, isTurning, isDrillFamily } = {}) {
  const fx = { ...DEFAULT_FX };

  // Milling & spot drill enter plunge as an independent value (no f_n field),
  // so plunge is the source of truth and f_n is derived from it. Otherwise
  // DEFAULT_FX would recompute plunge from a nonexistent (zero) f_n on open and
  // on every spindle change, zeroing a proven plunge feed.
  if (isMilling || isSpotDrill) { fx.v_f_plunge = 'manual'; fx.f_n = 'formula'; }
  // Turning/boring enter cutting feed + plunge directly (no feed-per-tooth), so
  // keep them manual, or the milling v_f = f_z×n×flutes formula (with f_z = 0)
  // would zero the cutting feed on open.
  if (isTurning) { fx.v_f = 'manual'; fx.v_f_plunge = 'manual'; }

  // Retract follows plunge only on the types that show it (drill family + spot
  // drill); a stored value that already differs is preserved (manual).
  if (isDrillFamily || isSpotDrill) {
    fx.v_f_retract = followsSource(preset['v_f_retract'], preset.v_f_plunge) ? 'formula' : 'manual';
  } else {
    fx.v_f_retract = 'manual';
  }

  // One-directional followers: lead-in/out + transition follow cutting feed;
  // ramp RPM follows spindle. A stored value that already differs opens
  // UNLINKED (manual) so it's preserved, not clobbered to the source on open.
  fx.v_f_leadIn     = followsSource(preset.v_f_leadIn, preset.v_f)     ? 'formula' : 'manual';
  fx.v_f_leadOut    = followsSource(preset.v_f_leadOut, preset.v_f)    ? 'formula' : 'manual';
  fx.v_f_transition = followsSource(preset.v_f_transition, preset.v_f) ? 'formula' : 'manual';
  fx.n_ramp         = followsSource(preset.n_ramp, preset.n)           ? 'formula' : 'manual';

  // LAST, so it overrides every rule above: a derived value whose source is
  // missing is the only value there is — never recompute it to zero. Applies to
  // all three locked pairs; on the real library it is plunge (109) and surface
  // speed (1) that actually hit this.
  if (derivedIsOrphaned(preset.v_f_plunge, preset.f_n)) fx.v_f_plunge = 'manual';
  if (derivedIsOrphaned(preset.v_f, preset.f_z))        fx.v_f        = 'manual';
  if (derivedIsOrphaned(preset.v_c, preset.n))          fx.v_c        = 'manual';

  return fx;
}

// Recompute all 'formula' fields in a draft from their sources. Safe on mount
// and whenever diameter / flute count change — only fields marked 'formula' are
// touched, so 'manual' (user-owned or preserved) values are never overwritten.
// `metric` selects the surface-speed unit (m/min vs ft/min) for the v_c↔n link.
export function computeFormulaDraft(draft, fx, diameter, numberOfFlutes, metric = false) {
  const d = { ...draft };
  const n = d.n ?? 0;

  if (fx.v_c    === 'formula') d.v_c    = roundForField('v_c',    rpmToSFM(n, diameter, metric));
  if (fx.n_ramp === 'formula') d.n_ramp = roundForField('n_ramp', n);

  if (fx.v_f === 'formula')
    d.v_f = roundForField('v_f', fptToIPM(d.f_z ?? 0, n, numberOfFlutes));
  else if (fx.f_z === 'formula')
    d.f_z = roundForField('f_z', ipmToFPT(d.v_f ?? 0, n, numberOfFlutes));

  if (fx.v_f_plunge === 'formula')
    d.v_f_plunge = roundForField('v_f_plunge', iprToIPM(d.f_n ?? 0, n));
  else if (fx.f_n === 'formula')
    d.f_n = roundForField('f_n', ipmToIPR(d.v_f_plunge ?? 0, n));

  // Retract follows plunge (one-directional) unless overridden.
  if (fx.v_f_retract === 'formula')
    d.v_f_retract = roundForField('v_f_retract', d.v_f_plunge ?? 0);

  const vf = d.v_f ?? 0;
  if (fx.v_f_leadIn     === 'formula') d.v_f_leadIn     = roundForField('v_f_leadIn',     vf);
  if (fx.v_f_leadOut    === 'formula') d.v_f_leadOut    = roundForField('v_f_leadOut',    vf);
  if (fx.v_f_transition === 'formula') d.v_f_transition = roundForField('v_f_transition', vf);

  return d;
}
