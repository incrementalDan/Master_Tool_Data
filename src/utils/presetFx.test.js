import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { initialPresetFx, computeFormulaDraft } from './presetFx.js';

const here = dirname(fileURLToPath(import.meta.url));
const refAll = resolve(here, '../../FUSION TOOL Library REF/NewPresetREF/NewPresets REF ALL.json');

// Opening a preset in the editor runs: fx = initialPresetFx(...); draft =
// computeFormulaDraft(preset, fx, ...). The clobber-safety invariant is that a
// stored value which DIFFERS from its formula source is marked 'manual' and
// therefore returned EXACTLY unchanged — no independent value is ever
// overwritten to its source on open (the lead-in / transition / ramp-RPM /
// retract bug class, incl. a value edited in Fusion then re-opened).
const MILLING = { isMilling: true, isSpotDrill: false, isTurning: false, isDrillFamily: false };
const DRILL = { isMilling: false, isSpotDrill: false, isTurning: false, isDrillFamily: true };

function openInEditor(preset, flags, diameter, flutes, metric = false) {
  const fx = initialPresetFx(preset, flags);
  return { fx, out: computeFormulaDraft({ ...preset }, fx, diameter, flutes, metric) };
}

describe('presetFx — opening a preset never clobbers an independent stored value', () => {
  it('THE invariant: every field initialPresetFx marks manual is returned exactly unchanged', () => {
    // A preset whose independent followers all DIFFER from their sources — the
    // exact shape that used to be clobbered. Each such field must open manual
    // (preserved) and survive computeFormulaDraft byte-for-byte.
    const preset = {
      n: 5000, v_c: 654.3, n_ramp: 2000,           // n_ramp ≠ n
      f_z: 0.0021, v_f: 41,                          // v_f ≠ f_z×n×flutes (independent-ish)
      v_f_leadIn: 15, v_f_leadOut: 62, v_f_transition: 400,  // all ≠ v_f
      v_f_plunge: 50, f_n: 0.011, v_f_ramp: 6, 'ramp-angle': 2,
    };
    const { fx, out } = openInEditor(preset, MILLING, 0.5, 4);
    for (const k of Object.keys(preset)) {
      if (fx[k] === 'manual') expect(out[k], `${k} (manual) must be unchanged`).toBe(preset[k]);
    }
    // And specifically the independent followers are preserved:
    expect(out.v_f_transition).toBe(400);
    expect(out.n_ramp).toBe(2000);
    expect(out.v_f_leadIn).toBe(15);
    expect(out.v_f_leadOut).toBe(62);
  });

  it('preserves an independent transition feed from a REAL Fusion preset', () => {
    // "ALL MILLING STRATEGIES" stores v_f_transition: 400 while v_f ≈ 29.3.
    const ref = JSON.parse(readFileSync(refAll, 'utf8'));
    const fem = ref.data.find(t => t.type === 'flat end mill');
    const preset = fem['start-values'].presets.find(p => p.name === 'ALL MILLING STRATEGIES');
    expect(preset.v_f_transition).toBe(400);
    const { out } = openInEditor(preset, MILLING, fem.geometry.DC, fem.geometry.NOF);
    expect(out.v_f_transition).toBe(400);   // preserved, not recomputed to v_f
  });

  it('preserves a drill retract that differs from plunge', () => {
    const preset = { n: 1000, v_c: 100, v_f_plunge: 10, v_f_retract: 40, f_n: 0.01 };
    const { fx, out } = openInEditor(preset, DRILL, 0.25, 2);
    expect(fx.v_f_retract).toBe('manual');
    expect(out.v_f_retract).toBe(40);       // not snapped to plunge (10)
  });

  it('does not zero a milling plunge feed on open (f_n has no field for milling)', () => {
    const preset = { n: 5000, v_c: 654, f_z: 0.002, v_f: 40, v_f_plunge: 50, f_n: 0 };
    const { out } = openInEditor(preset, MILLING, 0.5, 4);
    expect(out.v_f_plunge).toBe(50);
  });

  it('followers EQUAL to their source open linked (formula) and stay ~equal', () => {
    // The intended default: lead-in/out/transition = cutting feed, ramp RPM =
    // spindle. These open linked and recompute to (approximately) the same value.
    const preset = {
      n: 5000, v_c: 654, n_ramp: 5000, f_z: 0.002, v_f: 40,
      v_f_leadIn: 40, v_f_leadOut: 40, v_f_transition: 40, v_f_plunge: 13, f_n: 0.0026,
    };
    const { fx, out } = openInEditor(preset, MILLING, 0.5, 4);
    expect(fx.v_f_leadIn).toBe('formula');
    expect(fx.n_ramp).toBe('formula');
    expect(Math.abs(out.v_f_transition - 40)).toBeLessThan(0.01);
    expect(Math.abs(out.n_ramp - 5000)).toBeLessThan(1);
  });

  it('metric: surface speed derives from RPM in m/min (÷1000), not ft/min (÷12)', () => {
    // A 10 mm, 4-flute mill at 5000 rpm: v_c = 5000·π·10 / 1000 ≈ 157.08 m/min.
    // The inch factor (/12) would wrongly give ~13090 — off by ~83×.
    const preset = { n: 5000, v_c: 0, f_z: 0.05, v_f: 0 };
    const { out } = openInEditor(preset, MILLING, 10, 4, true);
    expect(Math.abs(out.v_c - 157.08)).toBeLessThan(0.1);
  });

  it('turning: cutting feed + plunge open manual (not zeroed by the milling f_z formula)', () => {
    const TURNING = { isMilling: false, isSpotDrill: false, isTurning: true, isDrillFamily: false };
    const preset = { n: 800, v_c: 400, v_f: 8, f_n: 0.01, v_f_plunge: 5 };
    const { fx, out } = openInEditor(preset, TURNING, 0.5, 0);
    expect(fx.v_f).toBe('manual');
    expect(out.v_f).toBe(8);          // not zeroed
    expect(out.v_f_plunge).toBe(5);
  });
});

// ⚠️ A FORMULA WITH NO INPUT PRODUCES ZERO, NOT AN ANSWER.
//
// Reported on drill D-258: the collapsed card showed Plunge 6.4 in/min while the
// editor right below it showed 0, slider pinned left. The preset carries a
// plunge feedrate and NO feed-per-rev, so opening it recomputed
// plunge = f_n x n = 0 x 16000 = 0 and wiped a proven feed — and saved the zero.
//
// Measured on the real library: 109 presets carry a plunge no f_n can reproduce
// because there is no f_n at all, plus 1 surface speed with no RPM.
describe('a derived value whose source is missing is never recomputed to zero', () => {
  // The real preset from the screenshot.
  const D258 = { n: 16000, v_c: 288.6076, v_f_plunge: 6.4, v_f_retract: 20, f_n: 0 };
  const DRILL = { isMilling: false, isSpotDrill: false, isTurning: false, isDrillFamily: true };

  it('opens the plunge feed as manual, not formula', () => {
    expect(initialPresetFx(D258, DRILL).v_f_plunge).toBe('manual');
  });

  it('keeps the stored plunge feed byte-for-byte on open', () => {
    const fx = initialPresetFx(D258, DRILL);
    expect(computeFormulaDraft({ ...D258 }, fx, 0.0689, 2).v_f_plunge).toBe(6.4);
  });

  it('does not invent a feed-per-rev to go with it', () => {
    const fx = initialPresetFx(D258, DRILL);
    expect(computeFormulaDraft({ ...D258 }, fx, 0.0689, 2).f_n).toBe(0);
  });

  // The pair still works normally when Fusion stored both sides.
  it('still derives plunge when a feed-per-rev IS present', () => {
    const p = { n: 10000, f_n: 0.001, v_f_plunge: 10 };
    const fx = initialPresetFx(p, DRILL);
    expect(fx.v_f_plunge).toBe('formula');
    expect(computeFormulaDraft({ ...p }, fx, 0.25, 2).v_f_plunge).toBe(10);
  });

  it('protects a cutting feed with no chip load, and a surface speed with no RPM', () => {
    const noFz = initialPresetFx({ v_f: 50, f_z: 0, n: 8000 }, { isMilling: true });
    expect(noFz.v_f).toBe('manual');
    expect(computeFormulaDraft({ v_f: 50, f_z: 0, n: 8000 }, noFz, 0.5, 4).v_f).toBe(50);

    const noN = initialPresetFx({ v_c: 300, n: 0 }, DRILL);
    expect(noN.v_c).toBe('manual');
    expect(computeFormulaDraft({ v_c: 300, n: 0 }, noN, 0.25, 2).v_c).toBe(300);
  });

  // A blank preset must still behave — nothing stored means nothing to protect.
  it('leaves a blank preset fully linked', () => {
    const fx = initialPresetFx({ n: 0, v_f_plunge: 0, f_n: 0, v_f: 0, f_z: 0 }, DRILL);
    expect(fx.v_f_plunge).toBe('formula');
    expect(fx.v_f).toBe('formula');
  });
});
