// Reach + undercut, checked against the shop's own hand-written numbers.
//
// The whole feature rests on one claim: the reach a programmer wrote into a
// description years ago is recomputable from the shaft segments Fusion stores.
// These tests check that claim against the real library rather than a fixture —
// a fixture would only agree with whatever the code currently does.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readShaftNeck, deriveReach, backfillReach, UNDERCUT_MIN_RATIO } from './toolReach.js';
import { buildDesc } from './toolNaming.js';

const LIB = JSON.parse(readFileSync(
  new URL('../../8-10-26 POST CLEAN UP PM FIX/ToolDEX - MASTER 8-10-26PM.json', import.meta.url), 'utf8',
)).data;

// A minimal app-shaped tool around one raw Fusion entry.
const toolFor = (entry) => ({
  id: entry.guid,
  unit: entry.unit,
  diameter: entry.geometry?.DC,
  flute_length: entry.geometry?.LCF,
  _instancesRaw: [entry],
});
const byDesc = (d) => LIB.find(t => t.description === d);

describe('reach, against the numbers the shop wrote by hand', () => {
  // The tool the request was raised about.
  it('reproduces .203 REACH on the 1mm 3FL end mill', () => {
    const t = toolFor(byDesc('1mm (.039) 3FL EM .059LOC .203 REACH'));
    expect(deriveReach(t).reach).toBe(0.203);        // .059 LOC + .144 neck
  });

  it.each([
    ['3/32 (.0938) 3FL EM .141LOC .5 REACH', 0.5],
    ['1/16 (.0625) 3FL EM .093LOC .312REACH', 0.3118],
    ['.182 Thread mill .4 reach ', 0.396],
  ])('reproduces the reach named in %s', (desc, expected) => {
    expect(deriveReach(toolFor(byDesc(desc))).reach).toBeCloseTo(expected, 4);
  });

  it('reads "12x Reach" as 12.5 x the cutting diameter', () => {
    const e = byDesc('.02 BALL 3FL .03LOC 12x Reach');
    expect(deriveReach(toolFor(e)).reach / e.geometry.DC).toBeCloseTo(12.5, 2);
  });
});

describe('what counts as a neck', () => {
  it('stops at the START of the first oversize segment, never partway through', () => {
    // The transition segment tapers .038 -> .125, crossing the .039 cut
    // diameter in the middle. Interpolating that crossing would push every
    // reach in the library past what the shop wrote.
    const e = byDesc('1mm (.039) 3FL EM .059LOC .203 REACH');
    expect(e.shaft.segments[1]['upper-diameter']).toBeGreaterThan(e.geometry.DC);
    expect(readShaftNeck(e.shaft, e.geometry.DC, e.unit).neckLength).toBe(0.144);
  });

  it('reports no neck for a plain shank transition', () => {
    // One segment, already wider than the cut — an ordinary shank, not a reach.
    const e = byDesc('1/8 BALL 6 FL .375 LOC');
    expect(readShaftNeck(e.shaft, e.geometry.DC, e.unit).neckLength).toBe(0);
    expect(deriveReach(toolFor(e)).reach).toBeNull();
  });

  it('returns a null reach, not flute_length, when there is nothing above the flutes', () => {
    // Storing reach === flute_length would put a number saying nothing on ~280
    // tools, and would break the "name it only when it exceeds the flutes" rule
    // by making every tool eligible.
    expect(deriveReach({ diameter: 0.25, flute_length: 0.75, unit: 'inches' }).reach).toBeNull();
  });

  it('survives a tool with no shaft, no segments, or no diameter', () => {
    for (const t of [{}, { diameter: 0.25 }, { diameter: 0.25, _instancesRaw: [{ shaft: { segments: [] } }] }]) {
      expect(deriveReach(t)).toEqual({ reach: null, has_undercut: null, undercut_diameter: null });
    }
  });
});

describe('undercut — a neck ground A LITTLE under the cut, not any neck at all', () => {
  it('flags the 1mm end mill and reports the ground diameter', () => {
    const d = deriveReach(toolFor(byDesc('1mm (.039) 3FL EM .059LOC .203 REACH')));
    expect(d.has_undercut).toBe(true);
    expect(d.undercut_diameter).toBe(0.038);          // .038 of a .039 cut
  });

  it('does NOT flag a saw, lollipop, dovetail or face-mill body as undercut', () => {
    // Their necks are structural — that is simply what the tool looks like.
    // A bare `neck < diameter` test called all of these undercut. The face mill
    // is the close one: a 1.75" body under a 2" cut is 87.5%, nearer the real
    // undercuts than anything else that isn't one.
    for (const desc of [
      '1.406Ø saw 3mm kerf LONG ',   // note: trailing space in the real library
      '3/16 Lollipop',
      '3/8" 45° Dovetail Cutter',
      '5/16Ø Key Cutter 5/64 Kerf',
      '2in Face Mill KENN. ST',
    ]) {
      const d = deriveReach(toolFor(byDesc(desc)));
      expect(d.reach).toBeGreaterThan(0);             // they DO have reach
      expect(d.has_undercut).toBeNull();              // but are not undercut
    }
  });

  it('separates the two populations with a wide margin, not a tuned threshold', () => {
    const ratios = { real: [], structural: [] };
    for (const e of LIB) {
      const { neckLength, minDiameter } = readShaftNeck(e.shaft, e.geometry?.DC, e.unit);
      if (!neckLength || minDiameter == null) continue;
      const r = minDiameter / e.geometry.DC;
      if (r >= 0.9999) continue;                      // neck at full diameter
      (r >= UNDERCUT_MIN_RATIO ? ratios.real : ratios.structural).push(r);
    }
    expect(ratios.real.length).toBeGreaterThan(0);
    expect(ratios.structural.length).toBeGreaterThan(0);
    // Measured: real undercuts 96.0-97.4%; the closest non-undercut is a face
    // mill body at 87.5%. The threshold must sit inside that gap, with room.
    expect(Math.min(...ratios.real)).toBeGreaterThan(0.95);
    expect(Math.max(...ratios.structural)).toBeLessThan(0.88);
  });
});

describe('backfillReach — seeds a blank, never overrules an answer', () => {
  const seeded = () => backfillReach(LIB.map(toolFor));

  it('fills reach on every tool that has a neck, and no others', () => {
    const withReach = seeded().filter(t => t.reach != null);
    expect(withReach.length).toBeGreaterThan(0);
    for (const t of withReach) expect(t.reach).toBeGreaterThan(t.flute_length);
  });

  it('is idempotent — a second pass has nothing to do', () => {
    const once = seeded();
    expect(backfillReach(once)).toBe(once);           // same array reference
  });

  it('returns the SAME tool references when nothing is missing', () => {
    // Callers use identity to decide whether there is anything to persist; a
    // fresh object per load would make every tool look dirty forever.
    const once = seeded();
    const twice = backfillReach(once);
    once.forEach((t, i) => expect(twice[i]).toBe(t));
  });

  it('leaves an explicit "no undercut" alone so the pill can be turned off', () => {
    // The user unticking a mis-flagged saw must stick — otherwise the seed
    // re-flags it on the next load and the flag can never be cleared.
    const e = byDesc('1mm (.039) 3FL EM .059LOC .203 REACH');
    const [out] = backfillReach([{ ...toolFor(e), has_undercut: false }]);
    expect(out.has_undercut).toBe(false);
    expect(out.undercut_diameter).toBeUndefined();
  });

  it('leaves a hand-typed reach alone', () => {
    const e = byDesc('1mm (.039) 3FL EM .059LOC .203 REACH');
    const [out] = backfillReach([{ ...toolFor(e), reach: 0.25 }]);
    expect(out.reach).toBe(0.25);
  });
});

describe('the description names reach only when it beats the flute length', () => {
  const em = { toolType: 'flat end mill', diameter: 0.039, loc: '0.059', flutes: 3, unit: 'inches', inputWasMm: true };

  it('adds the suffix in the shop\'s own format', () => {
    expect(buildDesc({ ...em, reach: '0.203' })).toBe(`${buildDesc(em)} .203 REACH`);
    expect(buildDesc({ ...em, reach: '0.203' })).toMatch(/ \.059LOC \.203 REACH$/);
  });

  it('says nothing when reach equals or trails the flute length', () => {
    const plain = buildDesc(em);
    expect(buildDesc({ ...em, reach: '0.059' })).toBe(plain);
    expect(buildDesc({ ...em, reach: '0.03' })).toBe(plain);
    expect(buildDesc({ ...em, reach: '' })).toBe(plain);
    expect(plain).not.toMatch(/REACH/);
  });

  it('reaches hole-making tools too', () => {
    const d = buildDesc({ toolType: 'drill', diameter: 0.125, loc: '0.5', material: 'carbide', unit: 'inches', reach: '1.2' });
    expect(d).toContain('1.2 REACH');
  });

  it('never prints REACH twice on a thread mill', () => {
    // A thread mill's reach used to live in its shoulder length. The legacy
    // read must stand down once the real field carries a value.
    const tm = { toolType: 'thread mill', diameter: 0.182, loc: '0.056', unit: 'inches', shoulderLen: '0.33' };
    expect(buildDesc({ ...tm, reach: '0.396' }).match(/REACH/g)).toHaveLength(1);
    expect(buildDesc({ ...tm, reach: '0.396' })).toContain('.396 REACH');
    expect(buildDesc(tm)).toContain('.33 REACH');     // legacy path still works
  });

  it('keeps the status marker last', () => {
    expect(buildDesc({ ...em, reach: '0.203', status: 'retired' }))
      .toBe(`${buildDesc(em)} .203 REACH RETIRED`);
  });
});
