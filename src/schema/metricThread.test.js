import { describe, it, expect } from 'vitest';
import { resolveThreadSize, metricThreadKey, METRIC_THREAD_SIZES, INCH_THREAD_SIZES } from './threads.js';
import { sanitizeExtraction } from '../services/extractionService.js';
import { buildFieldProposals } from './extractionDiff.js';
import { extractorToTool } from './extractorConvert.js';
import { threadUnitOf } from './threads.js';
import { psRowToTool } from '../components/ImportFlow.jsx';
import { applyExtractionToBlank } from '../services/extractionService.js';
import { BLANK } from '../../tool-extractor.tsx';

const LIST = METRIC_THREAD_SIZES.filter(s => s !== 'Custom...');

// A metric tap read correctly off a spec sheet ended up as a hand-typed "custom"
// thread with the INCH size list showing. Two independent causes, both here:
// the spelling never matched the list, and the thread UNIT was never derived.
describe('a metric designation resolves to its list entry, however it is spelled', () => {
  // Every one of these is a real way a manufacturer writes the same thread.
  it.each([
    ['M6 x 1.0', 'M6 x 1.0'],
    ['M6x1.0', 'M6 x 1.0'],
    ['M6x1', 'M6 x 1.0'],        // trailing decimal zero omitted
    ['M6X1.00', 'M6 x 1.0'],     // and added
    ['M6-1.0', 'M6 x 1.0'],      // dash instead of x
    ['M6 × 1', 'M6 x 1.0'],      // typographic multiplication sign
    ['M10 x 1.5 mm', 'M10 x 1.5'],
    ['M3 x .5', 'M3 x 0.5'],     // leading zero omitted — 4 real ProShop rows
    ['M5X.8', 'M5 x 0.8'],
    ['M4x0.7', 'M4 x 0.7'],
  ])('%s → %s', (raw, want) => {
    const r = resolveThreadSize(raw);
    expect(r.pitch).toBe(want);
    expect(r.thread_unit).toBe('metric');
    expect(LIST).toContain(r.pitch);
  });

  // ⚠️ A designation with no pitch means ISO metric COARSE — that is what the
  // omission conveys on a spec sheet, not "unknown".
  it('reads a bare diameter as the coarse thread', () => {
    expect(resolveThreadSize('M6').pitch).toBe('M6 x 1.0');
    expect(resolveThreadSize('M8').pitch).toBe('M8 x 1.25');
    expect(resolveThreadSize('M12').pitch).toBe('M12 x 1.75');
  });

  // The 'x' delimiter in the key is what keeps a diameter from matching a longer
  // one — without it "M1" would match "M12 x 1.75".
  it('never confuses M1 with M12', () => {
    expect(resolveThreadSize('M1').pitch).toBe('M1 x 0.25');
    expect(metricThreadKey('M1')).toBe('m1');
    expect(metricThreadKey('M12 x 1.75')).toBe('m12x1.75');
  });

  it('leaves an unknown metric thread alone rather than snapping it to a wrong one', () => {
    const r = resolveThreadSize('M99 x 9');
    expect(r.pitch).toBe('M99 x 9');
    expect(r.thread_unit).toBe('metric');
  });

  it('does not disturb inch threads', () => {
    for (const [raw, want] of [['1/4-20', '1/4-20 UNC'], ['1/4-20 UNC', '1/4-20 UNC'],
      ['10-32', '#10-32 UNF'], ['1/8-27 NPT', '1/8-27 NPT']]) {
      const r = resolveThreadSize(raw);
      expect(r.pitch).toBe(want);
      expect(r.thread_unit).toBe('inch');
      expect(INCH_THREAD_SIZES).toContain(r.pitch);
    }
  });
});

// ⚠️ The unit is DERIVED from the designation, not taken from the model. The
// prompt does ask for `threadUnit`, but the model routinely omits it and the
// sanitizer dropped it even when it came back — so the form showed the inch list
// for a metric tap and a correctly-read thread became "custom".
describe('extraction derives the thread unit from the designation', () => {
  const extract = (pitch, extra = {}) => sanitizeExtraction({ toolType: 'tap', pitch, ...extra }).fields;

  it('sets threadUnit metric with no help from the model', () => {
    const f = extract('M6x1');
    expect(f.threadUnit).toBe('metric');
    expect(f.pitch).toBe('M6 x 1.0');
  });

  it('sets it inch for an inch designation', () => {
    expect(extract('1/4-20').threadUnit).toBe('inch');
  });

  it('reaches the tool through the add flow', () => {
    const tool = extractorToTool(applyExtractionToBlank({ ...BLANK, toolType: 'tap' }, extract('M6x1')));
    expect(tool.tap_thread_unit).toBe('metric');
    expect(tool.pitch).toBe('M6 x 1.0');
  });

  it('picks STI out of the designation itself', () => {
    const f = extract('M12x1.75 STI');
    expect(f.pitch).toBe('M12 x 1.75');
    expect(f.isSTI).toBe(true);
  });

  // SPARSE IN — a key nobody answered must not be invented.
  it('emits nothing when no thread was read', () => {
    const f = sanitizeExtraction({ toolType: 'flat end mill' }).fields;
    expect('pitch' in f).toBe(false);
    expect('threadUnit' in f).toBe(false);
  });

  // The update path has its own key→field map; threadUnit was missing from it
  // too, so scanning a sheet onto an EXISTING tap could not correct the unit.
  it('is proposable onto an existing tap', () => {
    const tool = { tool_type: 'tap', pitch: '', tap_thread_unit: '', unit: 'inches' };
    const { proposals } = buildFieldProposals(tool, extract('M6x1'));
    const byField = Object.fromEntries(proposals.map(p => [p.field, p]));
    expect(byField.tap_thread_unit?.proposed).toBe('metric');
    expect(byField.pitch?.proposed).toBe('M6 x 1.0');
  });
});


// The same failure had a second entry point. resolveThreadSize returns
// `thread_unit`; the tool field is `tap_thread_unit`. psRowToTool spread the
// result raw, so a NEW tool built from a ProShop metric tap row got the right
// designation with no unit — and a stray `thread_unit` key that is not a field.
describe('a ProShop metric tap row builds a tool with its unit set', () => {
  const row = (thread) => [{ 'Tool #': 'R-55', 'Tool Group': 'R', 'Description': 'M6 form tap', 'Thread': thread }];

  it('maps thread_unit onto tap_thread_unit', () => {
    const t = psRowToTool(row('M6 x 1'));
    expect(t.pitch).toBe('M6 x 1.0');
    expect(t.tap_thread_unit).toBe('metric');
    expect('thread_unit' in t).toBe(false);
  });

  it('and inch for an inch tap', () => {
    expect(psRowToTool(row('1/4-28')).tap_thread_unit).toBe('inch');
  });

  // All four metric taps in the shop's real ProShop export are spelled in ways
  // that previously matched nothing.
  it.each([['M3 x .5', 'M3 x 0.5'], ['M6 x 1', 'M6 x 1.0'], ['M5 x .8', 'M5 x 0.8'], ['M4 x .7', 'M4 x 0.7']])(
    'resolves the real export\'s %s', (raw, want) => {
      const t = psRowToTool(row(raw));
      expect(t.pitch).toBe(want);
      expect(t.tap_thread_unit).toBe('metric');
    });
});

// ⚠️ A record can legitimately carry a metric pitch with no stored unit — an
// import that only filled the pitch, a hand-entered tool, anything from before
// the unit was wired. Defaulting those to inch showed the INCH size list, so the
// designation wasn't in it and read as a hand-typed custom thread.
describe('the thread list falls back to the designation when no unit is stored', () => {
  it('derives metric from the pitch', () => {
    expect(threadUnitOf({ pitch: 'M6 x 1.0', tap_thread_unit: '' })).toBe('metric');
    expect(threadUnitOf({ pitch: 'M6x1' })).toBe('metric');
  });

  it('derives inch for an inch designation, and for none at all', () => {
    expect(threadUnitOf({ pitch: '1/4-20 UNC' })).toBe('inch');
    expect(threadUnitOf({ pitch: '' })).toBe('inch');
    expect(threadUnitOf({})).toBe('inch');
  });

  // An explicit stored value is the user's answer and always wins — this is a
  // read-time fallback, not a correction.
  it('never overrides a stored unit', () => {
    expect(threadUnitOf({ pitch: 'M6 x 1.0', tap_thread_unit: 'inch' })).toBe('inch');
    expect(threadUnitOf({ pitch: '1/4-20 UNC', tap_thread_unit: 'metric' })).toBe('metric');
  });
});
