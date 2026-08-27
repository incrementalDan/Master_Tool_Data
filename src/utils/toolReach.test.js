// Reach + undercut, checked against the shop's own hand-written numbers.
//
// The whole feature rests on one claim: the reach a programmer wrote into a
// description years ago is recomputable from the shaft segments Fusion stores.
// These tests check that claim against the real library rather than a fixture —
// a fixture would only agree with whatever the code currently does.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readShaftNeck, deriveReach, resolveReachForTools, resolveReachFields, undercutDiameterHint } from './toolReach.js';
import { internalToFusionTool, fusionToolToInternal } from '../schema/fusionConvert.js';
import { buildDesc } from './toolNaming.js';
import { applyFilters, getAvailableOptions } from '../services/searchEngine.js';

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
    expect(readShaftNeck(e.shaft, e.geometry.DC).neckLength).toBe(0.144);
  });

  it('reports no neck for a plain shank transition', () => {
    // One segment, already wider than the cut — an ordinary shank, not a reach.
    const e = byDesc('1/8 BALL 6 FL .375 LOC');
    expect(readShaftNeck(e.shaft, e.geometry.DC).neckLength).toBe(0);
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
      expect(deriveReach(t)).toEqual({ reach: null, neckDiameter: null, hasUndercut: null });
    }
  });
});

describe('an undercut is a FACT: the neck is narrower than the cut', () => {
  it('flags the 1mm end mill and reports the ground diameter', () => {
    const d = deriveReach(toolFor(byDesc('1mm (.039) 3FL EM .059LOC .203 REACH')));
    expect(d.hasUndercut).toBe(true);
    expect(d.neckDiameter).toBe(0.038);            // .038 of a .039 cut
  });

  it('flags a saw, key cutter, lollipop and dovetail too — narrower IS narrower', () => {
    // ⚠️ An earlier pass gated this at 92% of the cutting diameter so these
    // would not count. That answered the wrong question: how MUCH of an
    // undercut it is does not change what it is, and the threshold was
    // reverse-engineered from today's data.
    for (const desc of [
      '1.406Ø saw 3mm kerf LONG ',
      '5/16Ø Key Cutter 5/64 Kerf',
      '3/16 Lollipop',
      '3/8" 45° Dovetail Cutter',
    ]) expect(deriveReach(toolFor(byDesc(desc))).hasUndercut).toBe(true);
  });

  it('says NO — not "unknown" — when Fusion drew a shaft and nothing is narrowed', () => {
    const d = deriveReach(toolFor(byDesc('1/8 BALL 6 FL .375 LOC')));
    expect(d.hasUndercut).toBe(false);
    expect(d.neckDiameter).toBeNull();
  });

  it('says UNKNOWN when Fusion drew no shaft at all', () => {
    // Not the same as "no": the shank could be reduced and simply undrawn.
    expect(deriveReach({ tool_type: 'flat end mill', diameter: 0.25, flute_length: 1 }).hasUndercut).toBeNull();
  });

  it('tolerates float noise only, never a degree of narrowness', () => {
    const base = { tool_type: 'flat end mill', diameter: 0.0625, flute_length: 0.1 };
    const withNeck = (d) => ({ ...base, _instancesRaw: [{ shaft: { segments: [
      { height: 0.2, 'lower-diameter': d, 'upper-diameter': d }] } }] });
    expect(deriveReach(withNeck(0.062)).hasUndercut).toBe(true);       // half a thou IS narrower
    expect(deriveReach(withNeck(0.0625)).hasUndercut).toBe(false);     // equal is not
    expect(deriveReach(withNeck(0.06249999999)).hasUndercut).toBe(false); // round-trip noise
  });
});

describe('the shop can override, and take it back', () => {
  const t = () => toolFor(byDesc('1mm (.039) 3FL EM .059LOC .203 REACH'));

  it('an override wins over the derived answer, both ways', () => {
    expect(resolveReachFields({ ...t(), undercut_override: false }).has_undercut).toBe(false);
    const noNeck = toolFor(byDesc('1/8 BALL 6 FL .375 LOC'));
    expect(resolveReachFields({ ...noNeck, undercut_override: true }).has_undercut).toBe(true);
  });

  it('clearing the override hands the answer back to the segments', () => {
    expect(resolveReachFields({ ...t(), undercut_override: null }).has_undercut).toBe(true);
  });

  it('⚠️ an override to NO drops the derived diameter — it describes nothing', () => {
    expect(resolveReachFields({ ...t(), undercut_override: false }).undercut_diameter).toBeNull();
  });

  it('a typed diameter stands where the segments show no narrowing', () => {
    const noNeck = toolFor(byDesc('1/8 BALL 6 FL .375 LOC'));
    expect(resolveReachFields({ ...noNeck, undercut_override: true, undercut_diameter: 0.11 })
      .undercut_diameter).toBe(0.11);
  });
});

describe('types the app must keep its hands off', () => {
  it('gives a face mill no reach — its body steps down because that is its shape', () => {
    const e = byDesc('2in Face Mill KENN. ST');
    // The segments are there and would compute to 1.16 by the arithmetic...
    expect(readShaftNeck(e.shaft, e.geometry.DC).neckLength).toBeGreaterThan(0);
    // ...but a face mill does not reach the way a shanked tool does.
    expect(deriveReach({ ...toolFor(e), tool_type: 'face mill' }).reach).toBeNull();
    expect(resolveReachForTools([{ ...toolFor(e), tool_type: 'face mill' }])[0].reach).toBeUndefined();
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

describe('resolveReachForTools — the segments win, every load', () => {
  const seeded = () => resolveReachForTools(LIB.map(e => toolFor(e)));

  it('fills reach on every tool that has a neck, and no others', () => {
    const withReach = seeded().filter(t => t.reach != null);
    expect(withReach.length).toBeGreaterThan(0);
    for (const t of withReach) expect(t.reach).toBeGreaterThan(t.flute_length);
  });

  it('seeds nothing at all for a face mill', () => {
    const faceMills = LIB.filter(e => e.type === 'face mill');
    expect(faceMills.length).toBeGreaterThan(0);
    for (const out of resolveReachForTools(faceMills.map(e => ({ ...toolFor(e), tool_type: 'face mill' })))) {
      expect(out.reach ?? null).toBeNull();
      expect(out.has_undercut ?? null).toBeNull();
    }
  });

  it('is idempotent — a second pass has nothing to do', () => {
    const once = seeded();
    expect(resolveReachForTools(once)).toBe(once);        // same array reference
  });

  it('returns the SAME tool references when nothing changes', () => {
    const once = seeded();
    const twice = resolveReachForTools(once);
    once.forEach((t, i) => expect(twice[i]).toBe(t));
  });

  it('⚠️ RE-DERIVES a stale reach rather than keeping it', () => {
    // Reach is arithmetic, not a recorded opinion. A stored value that no
    // longer matches flute length + neck is stale, never custom.
    const e = byDesc('1mm (.039) 3FL EM .059LOC .203 REACH');
    const [out] = resolveReachForTools([{ ...toolFor(e), reach: 99 }]);
    expect(out.reach).toBe(0.203);
  });

  it('keeps a hand-typed reach where Fusion drew no shaft', () => {
    const [out] = resolveReachForTools([
      { tool_type: 'flat end mill', diameter: 0.25, flute_length: 1, reach: 2.4 }]);
    expect(out.reach).toBe(2.4);
  });

  it('editing the flute length moves the reach with it', () => {
    const e = byDesc('1mm (.039) 3FL EM .059LOC .203 REACH');
    const [out] = resolveReachForTools([{ ...toolFor(e), flute_length: 0.5 }]);
    expect(out.reach).toBe(0.644);                        // .5 + the .144 neck
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
      const [tool] = resolveReachForTools([{ ...fusionToolToInternal(e), _instancesRaw: [e] }]);
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

describe('reach and undercut as search facets', () => {
  const T = (o) => ({ tool_type: 'flat end mill', unit: 'inches', diameter: 0.25, assemblies: [], presets: [], ...o });
  const tools = [
    T({ id: 'a', reach: 0.203, has_undercut: true }),
    T({ id: 'b', reach: 0.5 }),
    T({ id: 'c' }),                        // nobody has said
    T({ id: 'd', has_undercut: false }),   // answered: no
  ];
  const F = (facets) => applyFilters(tools, { facets }).map(t => t.id);

  it('matches a reach within tolerance', () => {
    expect(F({ reach: '0.203' })).toEqual(['a']);
    expect(F({ reach: '0.2030004' })).toEqual(['a']);   // float noise absorbed
    expect(F({ reach: '0.25' })).toEqual([]);
  });

  it('⚠️ leaves the UNANSWERED out of both Yes and No', () => {
    // `null` is "nobody has looked at this tool", which is not a No — the same
    // distinction flute_design draws between blank and None.
    expect(F({ has_undercut: 'Yes' })).toEqual(['a']);
    expect(F({ has_undercut: 'No' })).toEqual(['d']);
  });

  it('offers no options at all when nobody has answered', () => {
    // This is what lets the facet hide itself instead of drawing a dead
    // "0 available" box on every landing page — see FacetControl.
    const none = [T({ id: 'x' }), T({ id: 'y' })];
    expect(getAvailableOptions(none, { facets: {} }, 'has_undercut').options).toEqual([]);
    expect(getAvailableOptions(tools, { facets: {} }, 'has_undercut').options).toEqual(['No', 'Yes']);
  });
});
