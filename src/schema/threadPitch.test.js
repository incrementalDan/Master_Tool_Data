import { describe, it, expect } from 'vitest';
import { threadPitchValue, resolveThreadPitch } from './threads.js';
import { mergeFusionAndMetadata } from './metadataModel.js';
import { extractorToTool } from './extractorConvert.js';
import { buildMetadataTool, detectFusionDrift } from './metadataModel.js';

describe('threadPitchValue', () => {
  it('reads inch TPI from the designation', () => {
    expect(threadPitchValue('#4-40 UNC', 'inches')).toBeCloseTo(0.025, 8);
    expect(threadPitchValue('1/4-20 UNC', 'inches')).toBeCloseTo(0.05, 8);
  });

  // The bug the old `-(\d+)` regex had: it matched the LEADING number of a
  // fractional size over 1", so a 12-TPI tap read as 1 TPI — 12x wrong.
  it('takes the LAST dash group, so a 1-1/4 size is not read as 1 TPI', () => {
    expect(threadPitchValue('1-1/4-12 UNF', 'inches')).toBeCloseTo(1 / 12, 8);
    expect(threadPitchValue('1-3/8-6 UNC', 'inches')).toBeCloseTo(1 / 6, 8);
  });

  it('keeps a fractional TPI', () => {
    expect(threadPitchValue('1-11.5 NPT', 'inches')).toBeCloseTo(1 / 11.5, 8);
    expect(threadPitchValue('2-4.5 UNC', 'inches')).toBeCloseTo(1 / 4.5, 8);
  });

  it('reads every metric spelling, and never through the inch branch', () => {
    for (const s of ['M6 x 1.0', 'M6x1', 'M6-1.0', 'M6 X 1.00']) {
      expect(threadPitchValue(s, 'millimeters')).toBeCloseTo(1, 8);
    }
    // A bare metric designation means COARSE — resolved from the list.
    expect(threadPitchValue('M6', 'millimeters')).toBeCloseTo(1, 8);
  });

  it('converts into the TOOL\'s unit, not the thread\'s', () => {
    // A metric tap on an inch-unit tool: geometry stays in inches.
    expect(threadPitchValue('M6 x 1.0', 'inches')).toBeCloseTo(1 / 25.4, 8);
    expect(threadPitchValue('1/4-20 UNC', 'millimeters')).toBeCloseTo(25.4 / 20, 8);
  });

  it('resolves an STI tap against its PARENT thread', () => {
    expect(threadPitchValue('#4-40 STI', 'inches')).toBeCloseTo(0.025, 8);
  });

  it('returns null for a designation it cannot parse — no value beats a wrong one', () => {
    expect(threadPitchValue('Custom...', 'inches')).toBeNull();
    expect(threadPitchValue('', 'inches')).toBeNull();
    expect(threadPitchValue(null, 'inches')).toBeNull();
  });
});

describe('resolveThreadPitch', () => {
  it('only applies to threading types', () => {
    expect(resolveThreadPitch({ tool_type: 'drill', pitch: '#4-40 UNC', unit: 'inches', thread_pitch: null })).toBeNull();
    expect(resolveThreadPitch({ tool_type: 'tap', pitch: '#4-40 UNC', unit: 'inches', thread_pitch: null })).toBeCloseTo(0.025, 8);
    expect(resolveThreadPitch({ tool_type: 'thread mill', pitch: '1/4-20 UNC', unit: 'inches', thread_pitch: null })).toBeCloseTo(0.05, 8);
  });

  it('a derivable designation WINS over a stale stored value', () => {
    const t = { tool_type: 'tap', pitch: '#4-40 UNC', unit: 'inches', thread_pitch: 0.05 };
    expect(resolveThreadPitch(t)).toBeCloseTo(0.025, 8);
  });

  it('keeps the stored value when nothing can be derived', () => {
    const t = { tool_type: 'tap', pitch: 'Some custom form', unit: 'inches', thread_pitch: 0.0123 };
    expect(resolveThreadPitch(t)).toBe(0.0123);
  });

  it('is idempotent — a second pass changes nothing', () => {
    const t = { tool_type: 'tap', pitch: '#4-40 UNC', unit: 'inches', thread_pitch: null };
    const once = resolveThreadPitch(t);
    expect(resolveThreadPitch({ ...t, thread_pitch: once })).toBe(once);
  });
});

describe('a tap that never passed through the form still gets a pitch', () => {
  // The reported bug: thread_pitch was derived ONLY by ToolForm's onChange, so a
  // tap that arrived any other way (ProShop import, extraction, an existing
  // library tool) had none at all — and Fusion got a tap with no TP.
  it('mergeFusionAndMetadata derives it at load', () => {
    const fusionInternal = {
      tool_type: 'tap', unit: 'inches', description: '#4-40 CUT TAP H1 STI',
      diameter: 0.112, thread_pitch: null, presets: [],
    };
    const meta = { id: 'FTL-000001', pitch: '#4-40 UNC', is_sti: true, tap_thread_unit: 'inch' };
    const merged = mergeFusionAndMetadata(fusionInternal, meta);
    expect(merged.thread_pitch).toBeCloseTo(0.025, 8);
  });

  it('a non-threading tool is untouched by the merge', () => {
    const merged = mergeFusionAndMetadata(
      { tool_type: 'flat end mill', unit: 'inches', thread_pitch: null, presets: [] },
      { id: 'FTL-000002' },
    );
    expect(merged.thread_pitch).toBeNull();
  });

  it('extractorToTool stamps it, so a scanned tap has it on its first save', () => {
    const t = extractorToTool({ toolType: 'tap', unit: 'inches', pitch: '1/4-20 UNC', diameter: '0.25' });
    expect(t.thread_pitch).toBeCloseTo(0.05, 8);
  });
});

describe('the derived pitch never reads as a Fusion-side edit', () => {
  // ⚠️ Found in the sweep. thread_pitch was in DRIFT_FIELDS, so once a
  // metadata-only write stored the derived value (the record backfill, a
  // location import, a preset relink) while Fusion still had no geometry.TP,
  // EVERY tap reported "Fusion changed this" — and it could not be cleared:
  // "Keep Fusion" adopts the empty value and the next load derives it back.
  const fusionInternal = {
    id: 'guid-1', tracking_id: 'FTL-000001', tool_type: 'tap', unit: 'inches',
    description: '#4-40 CUT TAP', diameter: 0.112, thread_pitch: null, presets: [],
  };

  it('does not raise drift when only the app has derived it', () => {
    const merged = mergeFusionAndMetadata(fusionInternal, { id: 'FTL-000001', pitch: '#4-40 UNC' });
    const stored = buildMetadataTool({ ...merged, tracking_id: 'FTL-000001' });
    expect(stored.thread_pitch).toBeCloseTo(0.025, 8);
    expect(detectFusionDrift([fusionInternal], stored)
      .filter(d => d.field === 'thread_pitch')).toHaveLength(0);
  });

  it('still reports a real Fusion-side edit of a field that ISN\'T derived', () => {
    const stored = buildMetadataTool({
      ...mergeFusionAndMetadata(fusionInternal, { id: 'FTL-000001', pitch: '#4-40 UNC' }),
      tracking_id: 'FTL-000001',
    });
    const edited = { ...fusionInternal, flute_length: 0.9 };
    expect(detectFusionDrift([edited], { ...stored, flute_length: 0.688 })
      .filter(d => d.field === 'flute_length')).toHaveLength(1);
  });
});
