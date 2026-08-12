// A linked tool pair (a tap and its drill, a reamer and its drill) is SYMMETRIC
// and stored on both sides. These lock the two rules that make that safe: the
// link is a stable tracking id, and a half-written link heals itself.
import { describe, it, expect } from 'vitest';
import {
  normalizeLinkIds, linkPatch, linkedTools, symmetrizeToolLinks,
  toolsNeedingLinkRepair, isLinked,
} from './toolLinks.js';
import { buildMetadataTool, mergeFusionAndMetadata } from '../schema/metadataModel.js';

const tool = (id, over = {}) => ({
  id, tracking_id: id, tool_type: 'drill', description: id, unit: 'inches',
  assemblies: [], presets: [], linked_tools: [], ...over,
});

describe('normalizeLinkIds', () => {
  it('drops blanks, duplicates and a self-link', () => {
    expect(normalizeLinkIds(['FTL-B', '', 'FTL-B', null, 'FTL-A'], 'FTL-A'))
      .toEqual(['FTL-B']);
  });
});

describe('linking writes both sides', () => {
  const a = tool('FTL-A'), b = tool('FTL-B');

  it('adds each tool to the other', () => {
    expect(linkPatch(a, b, true)).toEqual({ 'FTL-A': ['FTL-B'], 'FTL-B': ['FTL-A'] });
  });

  it('removes from both sides', () => {
    const la = tool('FTL-A', { linked_tools: ['FTL-B'] });
    const lb = tool('FTL-B', { linked_tools: ['FTL-A'] });
    expect(linkPatch(la, lb, false)).toEqual({ 'FTL-A': [], 'FTL-B': [] });
  });

  it('is idempotent — linking twice adds one entry', () => {
    const la = tool('FTL-A', { linked_tools: ['FTL-B'] });
    const lb = tool('FTL-B', { linked_tools: ['FTL-A'] });
    expect(linkPatch(la, lb, true)).toEqual({ 'FTL-A': ['FTL-B'], 'FTL-B': ['FTL-A'] });
  });

  it('refuses to link a tool to itself', () => {
    expect(linkPatch(a, a, true)).toBeNull();
  });

  it('leaves other links alone', () => {
    const la = tool('FTL-A', { linked_tools: ['FTL-C'] });
    expect(linkPatch(la, b, true)['FTL-A']).toEqual(['FTL-C', 'FTL-B']);
  });
});

describe('symmetry repair', () => {
  it('adds the missing reverse half', () => {
    const list = [tool('FTL-A', { linked_tools: ['FTL-B'] }), tool('FTL-B')];
    const out = symmetrizeToolLinks(list);
    expect(isLinked(out.find(t => t.id === 'FTL-B'), 'FTL-A')).toBe(true);
    expect(toolsNeedingLinkRepair(list, out).map(t => t.id)).toEqual(['FTL-B']);
  });

  // ⚠️ Identity when nothing changed — callers use it to decide whether there is
  // anything to persist. A fresh object per load would make every tool look
  // dirty forever. (Same rule as syncPresetMaterialName.)
  it('returns the SAME references when already symmetric', () => {
    const list = [
      tool('FTL-A', { linked_tools: ['FTL-B'] }),
      tool('FTL-B', { linked_tools: ['FTL-A'] }),
    ];
    const out = symmetrizeToolLinks(list);
    expect(out).toBe(list);
    expect(toolsNeedingLinkRepair(list, out)).toEqual([]);
  });

  it('is idempotent — a second pass has nothing to do', () => {
    const once = symmetrizeToolLinks([tool('FTL-A', { linked_tools: ['FTL-B'] }), tool('FTL-B')]);
    expect(symmetrizeToolLinks(once)).toBe(once);
  });

  // ⚠️ "Not in the list I was handed" is not "deleted" — the library may be
  // partly loaded. Dropping it here and persisting would destroy a real link.
  it('KEEPS a link whose target is not loaded', () => {
    const list = [tool('FTL-A', { linked_tools: ['FTL-GONE'] })];
    const out = symmetrizeToolLinks(list);
    expect(out).toBe(list);
    expect(out[0].linked_tools).toEqual(['FTL-GONE']);
  });

  it('hides a dangling link from the DISPLAY list only', () => {
    const list = [tool('FTL-A', { linked_tools: ['FTL-GONE', 'FTL-B'] }), tool('FTL-B')];
    expect(linkedTools(list[0], list).map(t => t.id)).toEqual(['FTL-B']);
  });
});

describe('the link survives a metadata round trip', () => {
  it('persists and reads back', () => {
    const meta = buildMetadataTool(tool('FTL-A', { linked_tools: ['FTL-B'] }));
    expect(meta.linked_tools).toEqual(['FTL-B']);
    expect(mergeFusionAndMetadata({ id: 'FTL-A' }, meta).linked_tools).toEqual(['FTL-B']);
  });

  // The stored value is the partner's TRACKING id, never its ProShop number —
  // ProShop numbers are re-numberable by design (that is what legacy_ids is
  // for), so storing one would sever every link on the next renumber.
  it('stores a tracking id, not a ProShop number', () => {
    const meta = buildMetadataTool(tool('FTL-A', { tool_id: 'D-128', linked_tools: ['FTL-B'] }));
    expect(meta.linked_tools).toEqual(['FTL-B']);
    expect(meta.linked_tools).not.toContain('D-128');
  });

  it('never lets a self-link persist', () => {
    expect(buildMetadataTool(tool('FTL-A', { linked_tools: ['FTL-A', 'FTL-B'] })).linked_tools)
      .toEqual(['FTL-B']);
  });
});
