import { describe, it, expect } from 'vitest';
import { groupByTrackingId, buildLogicalTool, combineToolsByProshopId } from '../schema/toolSchema.js';
import { getDemoData } from './index.js';

describe('demo data', () => {
  it('builds 12 logical tools with metadata attached', () => {
    const { fusionList, metaList, holders } = getDemoData();
    const metaByTracking = new Map(metaList.map(m => [m.id, m]));
    const { groups, untracked } = groupByTrackingId(fusionList);
    const built = [];
    for (const [, raws] of groups) built.push(buildLogicalTool(raws, metaByTracking));
    for (const raw of untracked) built.push(buildLogicalTool([raw], metaByTracking));
    const tools = combineToolsByProshopId(built);

    expect(untracked.length).toBe(0);          // all demo tools are tracked
    expect(tools.length).toBe(12);
    expect(holders.length).toBeGreaterThan(0);

    for (const t of tools) {
      expect(t.tracking_id).toMatch(/^FTL-/);
      expect(t.proshot_id).toBeTruthy();        // every tool has a ProShop id
      expect(t.assemblies.length).toBeGreaterThanOrEqual(1);
      expect(t.presets.length).toBeGreaterThanOrEqual(1);
      expect(t.purchasing.manufacturers.length).toBe(1);
      expect(t.purchasing.vendors.length).toBeGreaterThanOrEqual(1);
      expect(t.notes).toBeTruthy();
      for (const a of t.assemblies) expect(a.ooh).toBeGreaterThan(0);
    }
    // two tools demonstrate multiple assemblies
    expect(tools.filter(t => t.assemblies.length >= 2).length).toBe(2);
    // covers the requested core types
    const types = new Set(tools.map(t => t.tool_type));
    for (const want of ['flat end mill','ball end mill','drill','tap','boring head','thread mill'])
      expect(types.has(want), `missing ${want}`).toBe(true);
  });
});
