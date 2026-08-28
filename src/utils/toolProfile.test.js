// The profile stack, checked against the real library and against Fusion's own
// Shaft tab (a test tool the shop built with three added segments).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildToolProfile, shaftSegments, shaftRows, canDrawProfile, tipKindFor, profileDimensions } from './toolProfile.js';

const LIB = JSON.parse(readFileSync(
  new URL('../../8-10-26 POST CLEAN UP PM FIX/ToolDEX - MASTER 8-10-26PM.json', import.meta.url), 'utf8',
)).data;
const byDesc = (d) => LIB.find(t => t.description === d);
const toolFor = (e, extra = {}) => ({
  unit: e.unit,
  tool_type: 'flat end mill',
  diameter: e.geometry?.DC,
  flute_length: e.geometry?.LCF,
  shoulder_length: e.geometry?.['shoulder-length'],
  overall_length: e.geometry?.OAL,
  shank_diameter: e.geometry?.SFDM,
  corner_radius: e.geometry?.RE,
  _instancesRaw: [e],
  ...extra,
});

describe('the stack Fusion draws', () => {
  it('runs flutes -> segments -> shank, tip-first, with no gaps', () => {
    const p = buildToolProfile(toolFor(byDesc('1mm (.039) 3FL EM .059LOC .203 REACH')));
    expect(p.regions.map(r => r.kind)).toEqual(['flute', 'segment', 'segment', 'shank']);
    // Contiguous: each region starts exactly where the last ended.
    p.regions.reduce((prev, r) => { expect(r.y0).toBeCloseTo(prev, 6); return r.y1; }, 0);
    expect(p.regions[0].y1).toBe(0.059);                 // flutes = LCF
    expect(p.regions[1].y1).toBeCloseTo(0.203, 6);       // + the .144 neck = the reach
    expect(p.regions.at(-1).y1).toBe(2.5);               // shank ends at OAL
  });

  it('reads segments tip-first, so the neck sits directly above the flutes', () => {
    // Fusion's Shaft TAB numbers them top-down; the JSON array is the reverse.
    const segs = shaftSegments(toolFor(byDesc('1mm (.039) 3FL EM .059LOC .203 REACH')));
    expect(segs[0]).toEqual({ height: 0.144, lower: 0.038, upper: 0.038, index: 0 });
    expect(segs[1].upper).toBe(0.125);                   // blends up to the shank
  });

  // ⚠️ THE EDITOR AND THE DRAWING MUST NOT READ THE SAME LIST TWO WAYS. The
  // drawing drops a zero-height segment (it has no region); the editor keeps
  // every stored row, because a height goes momentarily blank on every retype
  // and dropping the row there deleted the segment. `index` is what keeps the
  // two pointing at the same thing.
  it('the editor keeps every row; only the drawing drops a zero-height one', () => {
    const tool = { tool_type: 'flat end mill', unit: 'inches', diameter: 0.5, flute_length: 1,
      shaft_segments: [
        { height: 0.2, lower: 0.4, upper: 0.4 },
        { height: 0, lower: 0.4, upper: 0.5 },
        { height: 0.3, lower: 0.5, upper: 0.5 }] };
    expect(shaftRows(tool)).toHaveLength(3);
    const drawn = shaftSegments(tool);
    expect(drawn).toHaveLength(2);
    expect(drawn.map(s => s.index)).toEqual([0, 2]);      // stored positions, not 0,1
    expect(buildToolProfile(tool).regions
      .filter(r => r.kind === 'segment').map(r => r.index)).toEqual([0, 2]);
  });

  it('the editor read survives a row the drawing cannot use', () => {
    // Whatever is stored comes back, so an edit writes the whole list back
    // rather than a filtered copy of it.
    const tool = { tool_type: 'flat end mill', unit: 'inches', diameter: 0.5,
      shaft_segments: [{ height: 0, lower: 0, upper: 0 }] };
    expect(shaftRows(tool)).toEqual([{ height: 0, lower: 0, upper: 0 }]);
    expect(shaftSegments(tool)).toEqual([]);
  });

  it('keeps a taper as a trapezoid, not a step', () => {
    const p = buildToolProfile(toolFor(byDesc('1mm (.039) 3FL EM .059LOC .203 REACH')));
    const taper = p.regions.find(r => r.kind === 'segment' && r.dBottom !== r.dTop);
    expect(taper).toMatchObject({ dBottom: 0.038, dTop: 0.125 });
  });

  it('draws a plain shank for a tool with no segments', () => {
    const p = buildToolProfile(toolFor(byDesc('1/8 BALL 6 FL .375 LOC'), { tool_type: 'ball end mill' }));
    expect(p.regions.map(r => r.kind)).toEqual(['flute', 'segment', 'shank']);
    expect(p.regions.at(-1).dTop).toBe(0.25);            // SFDM
  });
});

describe('shoulder length is a dimension, not a solid', () => {
  it('bands only the span past the flutes', () => {
    const p = buildToolProfile(toolFor(byDesc('1/2 BULL .008R 1.85LOC Rougher'), { tool_type: 'bull nose end mill' }));
    expect(p.shoulderBand).toEqual({ y0: 1.85, y1: 2.25 });   // LCF -> SL
  });

  it('bands nothing when shoulder equals the flute length', () => {
    // The normal case — drawing a zero-height band would be a stray line.
    expect(buildToolProfile(toolFor(byDesc('1mm (.039) 3FL EM .059LOC .203 REACH'))).shoulderBand).toBeNull();
  });

  it('never claims a band past the end of the tool', () => {
    const p = buildToolProfile({ diameter: 0.25, flute_length: 0.5, shoulder_length: 99, overall_length: 2 });
    expect(p.shoulderBand.y1).toBe(2);
  });
});

describe('it never invents geometry it does not have', () => {
  it('emits no region for a tool with nothing filled in', () => {
    expect(buildToolProfile({}).regions).toEqual([]);
    expect(buildToolProfile(null).regions).toEqual([]);
  });

  it('never produces a negative-height shank when the segments overrun the OAL', () => {
    const p = buildToolProfile({
      diameter: 0.25, flute_length: 1, overall_length: 1.2,
      _instancesRaw: [{ shaft: { segments: [{ height: 5, 'lower-diameter': 0.25, 'upper-diameter': 0.25 }] } }],
    });
    expect(p.regions.some(r => r.kind === 'shank')).toBe(false);
    for (const r of p.regions) expect(r.y1).toBeGreaterThan(r.y0);
  });

  it('drops a zero-height segment rather than drawing a line', () => {
    const p = buildToolProfile({
      diameter: 0.25, flute_length: 1, overall_length: 3,
      _instancesRaw: [{ shaft: { segments: [{ height: 0, 'lower-diameter': 0.2, 'upper-diameter': 0.2 }] } }],
    });
    expect(p.regions.filter(r => r.kind === 'segment')).toHaveLength(0);
  });

  it('falls back to the cut diameter when there is no shank diameter', () => {
    const p = buildToolProfile({ diameter: 0.25, flute_length: 1, overall_length: 3 });
    expect(p.regions.at(-1).dTop).toBe(0.25);
  });

  it('builds every real tool in the library without throwing', () => {
    for (const e of LIB) {
      const p = buildToolProfile(toolFor(e));
      expect(p.total).toBeGreaterThanOrEqual(0);
      for (const r of p.regions) expect(r.y1).toBeGreaterThan(r.y0);
    }
  });
});

describe('the tip narrows only when the tool says it does', () => {
  it('carries the tip diameter through for a chamfer mill', () => {
    const p = buildToolProfile({ tool_type: 'chamfer mill', diameter: 0.125, tip_diameter: 0.01, flute_length: 0.058, overall_length: 1.5 });
    expect(p.tipDiameter).toBe(0.01);
  });
  it('reports no tip diameter rather than inventing a cone', () => {
    // Drawn flat when the tool does not say — never a guessed taper.
    expect(buildToolProfile({ tool_type: 'chamfer mill', diameter: 0.125, flute_length: 0.058 }).tipDiameter).toBe(0);
  });
});

describe('which tools it will draw, and how the tip is shaped', () => {
  it('draws milling and hole-making, never a boring head or a turning tool', () => {
    expect(canDrawProfile('flat end mill')).toBe(true);
    expect(canDrawProfile('drill')).toBe(true);
    expect(canDrawProfile('face mill')).toBe(true);
    expect(canDrawProfile('boring head')).toBe(false);
    expect(canDrawProfile('turning general')).toBe(false);
    expect(canDrawProfile(undefined)).toBe(false);
  });

  it('shapes the tip from the type, falling back to flat rather than guessing', () => {
    expect(tipKindFor({ tool_type: 'ball end mill' })).toBe('ball');
    expect(tipKindFor({ tool_type: 'drill' })).toBe('point');
    expect(tipKindFor({ tool_type: 'chamfer mill' })).toBe('taper');
    expect(tipKindFor({ tool_type: 'bull nose end mill', corner_radius: 0.03 })).toBe('radius');
    expect(tipKindFor({ tool_type: 'flat end mill' })).toBe('flat');
    expect(tipKindFor({ tool_type: 'form mill' })).toBe('flat');
  });
});

describe('dimensions are gated by the SAME registry rule the form uses', () => {
  it('offers a corner radius to a bull nose but not to a tap', () => {
    expect(profileDimensions('bull nose end mill').extras).toContain('corner_radius');
    expect(profileDimensions('tap').extras).not.toContain('corner_radius');
  });

  it('offers a tip angle to a drill but not to a chamfer mill', () => {
    // Chamfer mills carry the included angle in taper_angle — see CLAUDE.md.
    expect(profileDimensions('drill').extras).toContain('tip_angle');
    expect(profileDimensions('chamfer mill').extras).not.toContain('tip_angle');
    expect(profileDimensions('chamfer mill').extras).toContain('taper_angle');
  });

  it('offers reach and undercut everywhere they apply, and not to a face mill', () => {
    expect(profileDimensions('flat end mill').lengths).toContain('reach');
    expect(profileDimensions('flat end mill').diameters).toContain('undercut_diameter');
    expect(profileDimensions('face mill').lengths).not.toContain('reach');
  });

  it('always offers the diameter and the overall length', () => {
    for (const t of ['flat end mill', 'drill', 'tap', 'thread mill', 'reamer', 'slot/key cutter']) {
      expect(profileDimensions(t).diameters).toContain('diameter');
      expect(profileDimensions(t).lengths).toContain('overall_length');
    }
  });
});
