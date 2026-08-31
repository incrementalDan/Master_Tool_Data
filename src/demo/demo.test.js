import { describe, it, expect } from 'vitest';
import { groupByTrackingId, buildLogicalTool, combineToolsByToolId } from '../schema/toolSchema.js';
import { getDemoData } from './index.js';

describe('demo data', () => {
  it('builds 13 logical tools with metadata attached', () => {
    const { fusionList, metaList, holders } = getDemoData();
    const metaByTracking = new Map(metaList.map(m => [m.id, m]));
    const { groups, untracked } = groupByTrackingId(fusionList);
    const built = [];
    for (const [, raws] of groups) built.push(buildLogicalTool(raws, metaByTracking));
    for (const raw of untracked) built.push(buildLogicalTool([raw], metaByTracking));
    const tools = combineToolsByToolId(built);

    expect(untracked.length).toBe(0);          // all demo tools are tracked
    expect(tools.length).toBe(14);
    expect(holders.length).toBeGreaterThan(0);

    for (const t of tools) {
      expect(t.tracking_id).toMatch(/^FTL-/);
      expect(t.tool_id).toBeTruthy();           // every tool has a tool id
      expect(t.assemblies.length).toBeGreaterThanOrEqual(1);
      expect(t.presets.length).toBeGreaterThanOrEqual(1);
      expect(t.purchasing.manufacturers.length).toBe(1);
      expect(t.purchasing.vendors.length).toBeGreaterThanOrEqual(1);
      expect(t.notes).toBeTruthy();
      for (const a of t.assemblies) expect(a.ooh).toBeGreaterThan(0);
    }
    // two tools demonstrate multiple assemblies
    expect(tools.filter(t => t.assemblies.length >= 2).length).toBe(2);
    // ⚠️ One demo tool carries SHAFT SEGMENTS (A-265, the long-reach micro end
    // mill). Without it, reach, undercut and the whole Tool Profile drawing are
    // invisible in demo mode — which is where they get looked at.
    const segged = tools.filter(t => (t._instancesRaw || []).some(r => r?.shaft?.segments?.length));
    expect(segged.length).toBeGreaterThanOrEqual(1);
    // ⚠️ And one of them is METRIC (B-301). The app must be right for an
    // mm-default shop, and until this tool existed there was no metric tool in
    // the demo AT ALL — so every unit-flavoured default, step and display
    // precision in the profile was unreachable where things get looked at.
    const metricSegged = segged.filter(t => t.unit === 'millimeters');
    expect(metricSegged.length).toBeGreaterThanOrEqual(1);
    for (const t of metricSegged) {
      // Nothing converts: the segments stay in the tool's own unit.
      expect(t.shaft_segments.every(s => s.height > 1)).toBe(true);   // mm-sized, not inch numbers
    }

    // ⚠️ A preset guid may repeat across the INSTANCES of one logical tool —
    // presets are replicated onto every instance by design — but never across
    // two different logical tools. `preset_meta` is keyed by guid, so a demo
    // tool built by copying another one silently shared its presets' identity.
    const owner = new Map();
    for (const t of tools) {
      for (const p of t.presets || []) {
        if (p?.guid) {
          expect(owner.get(p.guid) ?? t.id, `preset guid ${p.guid} shared across tools`).toBe(t.id);
          owner.set(p.guid, t.id);
        }
      }
    }

    // covers the requested core types
    const types = new Set(tools.map(t => t.tool_type));
    for (const want of ['flat end mill','ball end mill','drill','tap','boring head','thread mill'])
      expect(types.has(want), `missing ${want}`).toBe(true);
  });
});
