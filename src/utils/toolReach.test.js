// Reach + undercut, checked against the shop's own hand-written numbers.
//
// The whole feature rests on one claim: the reach a programmer wrote into a
// description years ago is recomputable from the shaft segments Fusion stores.
// These tests check that claim against the real library rather than a fixture —
// a fixture would only agree with whatever the code currently does.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readShaftNeck, deriveReach, backfillReach, undercutDiameterHint } from './toolReach.js';
import { internalToFusionTool, fusionToolToInternal } from '../schema/fusionConvert.js';
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
      expect(deriveReach(t)).toEqual({ reach: null, neckDiameter: null });
    }
  });
});

describe('the app decides NOTHING about undercut', () => {
  it('never reports an undercut from geometry, however narrow the neck', () => {
    // The pill is a person's answer. An earlier pass inferred it from a
    // neck-to-diameter ratio measured on today's library; that rule would be
    // wrong the first time a tool landed between the clusters it was drawn
    // around, and it is a claim about geometry the app does not model.
    for (const e of LIB) {
      expect(deriveReach(toolFor(e))).not.toHaveProperty('has_undercut');
    }
  });

  it('offers the neck diameter as a prefill once a person says there is one', () => {
    // Reading the number back is a fact from Fusion; the judgement was the
    // answer just given.
    expect(undercutDiameterHint(toolFor(byDesc('1mm (.039) 3FL EM .059LOC .203 REACH')))).toBe(0.038);
  });

  it('offers nothing when the neck is not narrower than the cut', () => {
    // A neck at full cutting diameter is reach, not relief.
    expect(undercutDiameterHint(toolFor(byDesc('RTA 12  3/16 Bull mill .01 R .285 LOC')))).toBeNull();
    expect(undercutDiameterHint({ diameter: 0.25, flute_length: 0.5, unit: 'inches' })).toBeNull();
  });
});

describe('types the app must keep its hands off', () => {
  it('gives a face mill no reach — its body steps down because that is its shape', () => {
    const e = byDesc('2in Face Mill KENN. ST');
    // The segments are there and would compute to 1.16 by the arithmetic...
    expect(readShaftNeck(e.shaft, e.geometry.DC, e.unit).neckLength).toBeGreaterThan(0);
    // ...but a face mill does not reach the way a shanked tool does.
    expect(deriveReach({ ...toolFor(e), tool_type: 'face mill' }).reach).toBeNull();
    expect(backfillReach([{ ...toolFor(e), tool_type: 'face mill' }])[0].reach).toBeUndefined();
  });

  it('gives a boring head or a turning tool no reach either', () => {
    const e = byDesc('1mm (.039) 3FL EM .059LOC .203 REACH');
    for (const tool_type of ['boring head', 'turning general']) {
      expect(deriveReach({ ...toolFor(e), tool_type }).reach).toBeNull();
    }
  });

  it('still reaches an ordinary end mill', () => {
    const e = byDesc('1mm (.039) 3FL EM .059LOC .203 REACH');
    expect(deriveReach({ ...toolFor(e), tool_type: 'flat end mill' }).reach).toBe(0.203);
  });
});

describe('backfillReach — seeds a blank, never overrules an answer', () => {
  const seeded = () => backfillReach(LIB.map(toolFor));

  it('fills reach on every tool that has a neck, and no others', () => {
    const withReach = seeded().filter(t => t.reach != null);
    expect(withReach.length).toBeGreaterThan(0);
    for (const t of withReach) expect(t.reach).toBeGreaterThan(t.flute_length);
  });

  it('seeds nothing at all for a face mill', () => {
    const faceMills = LIB.filter(e => e.type === 'face mill');
    expect(faceMills.length).toBeGreaterThan(0);
    for (const out of backfillReach(faceMills.map(e => ({ ...toolFor(e), tool_type: 'face mill' })))) {
      expect(out.reach).toBeUndefined();
    }
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

  it('never touches the undercut fields', () => {
    const e = byDesc('1mm (.039) 3FL EM .059LOC .203 REACH');
    const [out] = backfillReach([toolFor(e)]);
    expect(out.has_undercut).toBeUndefined();
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

describe('⚠️ THE APP MUST NOT CHANGE WHAT IS IN FUSION', () => {
  // Fusion is the more correct source for shaft geometry — the app has no
  // segment UI and does not model how each tool type relates segments,
  // shoulder length and collision detection. Reach and undercut are read FROM
  // Fusion and stored beside it; nothing here may write back.
  it('alters no shaft segments and leaks no app-only key, across the whole library', () => {
    const appOnly = new Set(['reach', 'has_undercut', 'undercut_diameter']);
    const walk = (o) => {
      const hits = [];
      if (o && typeof o === 'object') {
        for (const [k, v] of Object.entries(o)) {
          if (appOnly.has(k)) hits.push(k);
          hits.push(...walk(v));
        }
      }
      return hits;
    };
    let checked = 0;
    for (const e of LIB) {
      const [tool] = backfillReach([{ ...fusionToolToInternal(e), _instancesRaw: [e] }]);
      // Answer the undercut by hand, the way a person would, and write it out.
      const withAnswers = { ...tool, has_undercut: true, undercut_diameter: 0.037 };
      const out = internalToFusionTool(withAnswers, e);
      expect(walk(out)).toEqual([]);
      expect(out.shaft).toEqual(e.shaft);
      checked++;
    }
    expect(checked).toBe(LIB.length);
  });
});
