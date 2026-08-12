// The plunge slider's ceiling, checked against the shop's real library.
//
// A range is only useful if the real values land in the middle of it. Plunge
// shared the cutting-feed ceiling (225 in/min), which is right for milling and
// useless for a drill — every drill sat in the leftmost few percent of the
// track, which is what made D-258's 6.4 in/min look pinned at zero even after
// the value itself was fixed.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SLIDER_RANGES, drillPlungeMax, DRILL_PLUNGE_MAX } from './LinkedSlider.jsx';

const LIB = JSON.parse(readFileSync(
  new URL('../../8-10-26 POST CLEAN UP PM FIX/ToolDEX - MASTER 8-10-26PM.json', import.meta.url), 'utf8',
)).data;

const DRILL_TYPES = new Set(['drill', 'reamer', 'counter bore', 'counter sink', 'center drill']);
const plunges = (pred) => {
  const out = [];
  for (const t of LIB) {
    if (!pred(t.type)) continue;
    for (const p of (t['start-values']?.presets || [])) if (p.v_f_plunge > 0) out.push(p.v_f_plunge);
  }
  return out.sort((a, b) => a - b);
};
const drill = plunges(ty => DRILL_TYPES.has(ty));
const milling = plunges(ty => !DRILL_TYPES.has(ty) && !String(ty).includes('tap'));
const median = (a) => a[Math.floor(a.length / 2)];

describe('drill plunge ceiling', () => {
  it('covers every drill plunge in the real library', () => {
    expect(drill.length).toBeGreaterThan(50);      // 81 in the real library
    expect(Math.max(...drill)).toBeLessThanOrEqual(DRILL_PLUNGE_MAX.inch);
  });

  // Measured, not guessed: 81 drill plunge presets, min 2, median 6.4 (exactly
  // the D-258 value that started this), max 40.
  it('puts the real values in the usable part of the track', () => {
    const reaching = (max, pct) => drill.filter(v => (v / max) * 100 >= pct).length;
    const OLD = SLIDER_RANGES.v_f_plunge.max, NEW = DRILL_PLUNGE_MAX.inch;

    // Before, almost everything was crushed into the first tenth of the slider:
    // 13 of 81 reached 10% of the track. After: 55 of 81.
    expect(reaching(OLD, 10)).toBeLessThan(20);
    expect(reaching(NEW, 10)).toBeGreaterThan(50);
    // And nearly all of them clear 5%, i.e. are visibly off the left stop.
    expect(reaching(NEW, 5)).toBeGreaterThan(drill.length * 0.9);

    // The median drill moves from 2.8% of the track to 16%.
    expect((median(drill) / OLD) * 100).toBeLessThan(5);
    expect((median(drill) / NEW) * 100).toBeGreaterThan(15);
  });

  // ⚠️ Why this is per-type and not a new global default: milling plunge is a
  // different animal, and a 40 ceiling would put most milling presets into
  // permanently-stretched softMax territory.
  it('would be wrong for milling', () => {
    expect(milling.filter(v => v > DRILL_PLUNGE_MAX.inch).length).toBeGreaterThan(milling.length / 2);
    expect(SLIDER_RANGES.v_f_plunge.max).toBe(225);   // milling default untouched
  });

  it('is unit-aware', () => {
    expect(drillPlungeMax(false)).toBe(40);
    expect(drillPlungeMax(true)).toBe(1000);          // ≈ 40 in/min, clean metric
  });

  // The ceiling is a default, not a limit — softMax stretches for anything above.
  it('stays a soft ceiling', () => {
    expect(SLIDER_RANGES.v_f_plunge.softMax).toBe(true);
  });
});
