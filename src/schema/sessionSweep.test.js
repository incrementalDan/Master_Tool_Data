// Sweep of this session's work — the paths not already covered by
// shaftDrift / shaftSeen / toolProfile tests.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildDesc } from '../utils/toolNaming.js';
import { toolToExtractor } from './extractorConvert.js';
import { applyFilters, getAvailableOptions } from '../services/searchEngine.js';
import { resolveReachFields, resolveReachForTools } from '../utils/toolReach.js';

const LIB = JSON.parse(readFileSync(
  new URL('../../8-10-26 POST CLEAN UP PM FIX/ToolDEX - MASTER 8-10-26PM.json', import.meta.url), 'utf8',
)).data;

const micro = (extra = {}) => ({
  id: 'FTL-1', tool_type: 'flat end mill', unit: 'inches', diameter: 0.039,
  flute_length: 0.059, number_of_flutes: 3, material: 'carbide',
  presets: [], assemblies: [], ...extra,
});

describe('the REACH marker in the generated description', () => {
  it('appears only when the reach exceeds the flute length', () => {
    expect(buildDesc(toolToExtractor(micro({ reach: 0.203 })))).toContain('.203 REACH');
    expect(buildDesc(toolToExtractor(micro({ reach: null })))).not.toContain('REACH');
    // a reach EQUAL to the flutes says nothing — every tool reaches that far
    expect(buildDesc(toolToExtractor(micro({ reach: 0.059 })))).not.toContain('REACH');
  });

  it('⚠️ is idempotent — regenerating never stacks a second marker', () => {
    const t = micro({ reach: 0.203 });
    const once = buildDesc(toolToExtractor(t));
    const twice = buildDesc(toolToExtractor({ ...t, description: once }));
    expect(twice).toBe(once);
    expect(twice.match(/REACH/g)).toHaveLength(1);
  });

  it('⚠️ a thread mill does not carry REACH twice', () => {
    // The shop recorded a thread mill's reach in the shoulder length before the
    // field existed, so that legacy read fires ONLY while `reach` is blank.
    const tm = { ...micro(), tool_type: 'thread mill', shoulder_length: 0.5, pitch: '1/4-20' };
    const legacy = buildDesc(toolToExtractor(tm));
    const both = buildDesc(toolToExtractor({ ...tm, reach: 0.4 }));
    expect((legacy.match(/REACH/g) || []).length).toBeLessThanOrEqual(1);
    expect((both.match(/REACH/g) || []).length).toBeLessThanOrEqual(1);
  });
});

describe('the search facets', () => {
  const tools = [
    micro({ id: 'a', has_undercut: true, reach: 0.203 }),
    micro({ id: 'b', has_undercut: false, reach: null }),
    micro({ id: 'c', has_undercut: null, reach: null }),   // Fusion drew no shaft
  ];

  it('⚠️ "cannot say" matches NEITHER Yes nor No', () => {
    expect(applyFilters(tools, { facets: { has_undercut: 'Yes' } }).map(t => t.id)).toEqual(['a']);
    expect(applyFilters(tools, { facets: { has_undercut: 'No' } }).map(t => t.id)).toEqual(['b']);
  });

  it('offers only the answers something actually holds', () => {
    const { options } = getAvailableOptions(tools, { facets: {} }, 'has_undercut');
    expect(options.sort()).toEqual(['No', 'Yes']);
  });

  it('reach is a numeric facet that finds the tool that has one', () => {
    expect(applyFilters(tools, { facets: { reach: 0.203 } }).map(t => t.id)).toEqual(['a']);
  });
});

describe('the load-time resolve stays a no-op on a settled library', () => {
  it('⚠️ returns the SAME array and tool references when nothing changed', () => {
    const tools = LIB.slice(0, 60).map(e => ({
      id: e.guid, tool_type: 'flat end mill', unit: e.unit, diameter: e.geometry?.DC,
      flute_length: e.geometry?.LCF, shaft_segments: null,
    }));
    const first = resolveReachForTools(tools);
    const second = resolveReachForTools(first);
    expect(second).toBe(first);                 // identity — nothing to persist
  });

  it('a tool with no shaft keeps a hand-typed reach; a segmented one does not', () => {
    const typed = micro({ reach: 1.5 });                     // no segments drawn
    expect(resolveReachFields(typed).reach).toBe(1.5);
    const segged = micro({ reach: 1.5,                       // segments answer instead
      shaft_segments: [{ height: 0.144, lower: 0.038, upper: 0.038 }] });
    expect(resolveReachFields(segged).reach).toBeCloseTo(0.203, 4);
  });
});

describe('the undercut override', () => {
  const drawn = micro({ shaft_segments: [{ height: 0.144, lower: 0.038, upper: 0.038 }] });
  const bare = micro();

  it('the segments answer when there is no override', () => {
    expect(resolveReachFields(drawn).has_undercut).toBe(true);
    expect(resolveReachFields(bare).has_undercut).toBeNull();
  });

  it('an override wins over the segments, both ways', () => {
    expect(resolveReachFields({ ...drawn, undercut_override: false }).has_undercut).toBe(false);
    expect(resolveReachFields({ ...bare, undercut_override: true }).has_undercut).toBe(true);
  });

  it('⚠️ overriding to No drops the derived diameter — it describes nothing', () => {
    expect(resolveReachFields(drawn).undercut_diameter).toBeCloseTo(0.038, 4);
    expect(resolveReachFields({ ...drawn, undercut_override: false }).undercut_diameter ?? null).toBeNull();
  });

  it('clearing the override hands the answer back to the segments', () => {
    const overridden = { ...drawn, undercut_override: false };
    expect(resolveReachFields(overridden).has_undercut).toBe(false);
    expect(resolveReachFields({ ...overridden, undercut_override: null }).has_undercut).toBe(true);
  });

  it('⚠️ the override never fabricates a reach — that is arithmetic', () => {
    // Saying "yes it is undercut" cannot invent a neck that is not drawn.
    expect(resolveReachFields({ ...bare, undercut_override: true }).reach ?? null).toBeNull();
  });
});

describe('adding the shaft to the reconcile signature added no noise', () => {
  // ⚠️ sharedSignature returns a JSON STRING, not an object — parse it before
  // reading a key, or every comparison silently reads `undefined` and the
  // measurement reports zero difference everywhere.
  it('⚠️ the shaft key differs on exactly the tools that really do disagree', async () => {
    const { sharedSignature } = await import('../services/reconcile.js');
    const { groupByTrackingId } = await import('./identity.js');
    const { groups } = groupByTrackingId(LIB);
    let split = 0, shaftDiffers = 0, newlySplit = 0;
    for (const raws of groups.values()) {
      if (raws.length < 2) continue;
      const sigs = raws.map(r => JSON.parse(sharedSignature(r)));
      const whole = new Set(sigs.map(x => JSON.stringify(x)));
      const shafts = new Set(sigs.map(x => JSON.stringify(x.shaft)));
      const without = new Set(sigs.map(x => { const c = { ...x }; delete c.shaft; return JSON.stringify(c); }));
      if (whole.size > 1) split++;
      if (shafts.size > 1) shaftDiffers++;
      if (without.size === 1 && whole.size > 1) newlySplit++;   // the shaft ALONE splits it
    }
    // Measured on the real library: two tools carry genuinely different
    // profiles across their instances, and the key splits ONLY those two.
    expect(shaftDiffers).toBe(2);
    expect(newlySplit).toBe(2);
    expect(split).toBeGreaterThanOrEqual(2);
  });
});
