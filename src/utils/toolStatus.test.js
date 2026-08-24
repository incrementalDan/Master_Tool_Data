import { describe, it, expect } from 'vitest';
import {
  TOOL_STATUSES, DEFAULT_TOOL_STATUS, DEFAULT_VISIBLE_STATUSES, statusOf, statusMeta,
  isBeta, isRetired, exportsToProShop, proShopStatusValue, statusFromProShop,
  hasBetaSuffix, withBetaSuffix, stripBetaSuffix, betaSuffixStale,
  hasRetiredSuffix, withRetiredSuffix, stripRetiredSuffix,
  applyStatusSuffix, stripStatusSuffixes, withRetiredMarker,
  ALL_TOOL_STATUSES, isDefaultStatusSelection,
} from './toolStatus.js';
import { buildProShopRows, buildProShopCSV } from '../../tool-extractor.tsx';
import { toolToExtractor } from '../schema/toolSchema.js';
import { buildMetadataTool, mergeFusionAndMetadata } from '../schema/metadataModel.js';
import { newTool } from '../schema/toolFactory.js';
import { applyFilters } from '../services/searchEngine.js';
import { proShopExportMessage } from './proShopExport.js';
import { buildDesc } from './toolNaming.js';

describe('active is the default AND the absence of an answer', () => {
  it('a new tool is active', () => {
    expect(newTool('flat end mill').tool_status).toBe(DEFAULT_TOOL_STATUS);
  });

  // Nothing to migrate: every record written before this field reads as active.
  it('a record with no status reads as active', () => {
    expect(statusOf({})).toBe('active');
    expect(statusOf({ tool_status: null })).toBe('active');
    expect(statusOf(null)).toBe('active');
  });

  it('an unrecognised status is active, not a fourth state', () => {
    expect(statusOf({ tool_status: 'sold' })).toBe('active');
    expect(statusMeta('sold').id).toBe('active');
  });

  it('round-trips through metadata', () => {
    for (const st of ['active', 'retired', 'beta']) {
      const meta = buildMetadataTool({ id: 'FTL-1', tool_status: st, replaced_by: st === 'retired' ? 'FTL-2' : null });
      expect(meta.tool_status).toBe(st);
      expect(mergeFusionAndMetadata({ tool_type: 'drill' }, meta).tool_status).toBe(st);
    }
  });

  it('carries the replacement as an ID', () => {
    const meta = buildMetadataTool({ id: 'FTL-1', tool_status: 'retired', replaced_by: 'FTL-NEW' });
    expect(meta.replaced_by).toBe('FTL-NEW');
    expect(mergeFusionAndMetadata({}, meta).replaced_by).toBe('FTL-NEW');
  });
});

// ProShop's `Status` column, measured on the shop's real export:
// Active (270) / blank (40) / Archived (1).
describe('ProShop Status', () => {
  it('blank is ACTIVE, not unknown', () => {
    expect(statusFromProShop('')).toBe('active');
    expect(statusFromProShop(null)).toBe('active');
    expect(statusFromProShop(undefined)).toBe('active');
  });

  it('Archived is Retired, whatever the casing', () => {
    for (const v of ['Archived', 'archived', ' ARCHIVED ']) expect(statusFromProShop(v)).toBe('retired');
  });

  it('a word nobody understands is active — not evidence a tool is retired', () => {
    expect(statusFromProShop('On Order')).toBe('active');
  });

  it('exports Active / Archived', () => {
    expect(proShopStatusValue({ tool_status: 'active' })).toBe('Active');
    expect(proShopStatusValue({ tool_status: 'retired' })).toBe('Archived');
  });
});

// ⚠️ The single most important rule here: a beta tool is not in ProShop AT ALL.
// A blank Status cell would NOT do — blank reads back as Active, so exporting
// one would quietly promote every beta tool on the next round-trip.
describe('a beta tool is never exported to ProShop', () => {
  const base = {
    id: 'FTL-B', tool_type: 'flat end mill', tool_id: 'A-9', unit: 'inches',
    description: '1/2 EM', diameter: 0.5, number_of_flutes: 4, assemblies: [],
  };

  it('produces no rows at all', () => {
    expect(buildProShopRows(toolToExtractor({ ...base, tool_status: 'beta' }))).toEqual([]);
    expect(exportsToProShop({ tool_status: 'beta' })).toBe(false);
  });

  it('and the CSV is header-only, so nothing can be mistaken for a row', () => {
    const csv = buildProShopCSV(toolToExtractor({ ...base, tool_status: 'beta' }));
    expect(csv.split('\n')).toHaveLength(1);
  });

  it('while active and retired export normally, with their status', () => {
    const cell = (st) => {
      const csv = buildProShopCSV(toolToExtractor({ ...base, tool_status: st }));
      const [h, r] = csv.split('\n');
      return r.split(',')[h.split(',').indexOf('status')];
    };
    expect(cell('active')).toBe('Active');
    expect(cell('retired')).toBe('Archived');
    expect(exportsToProShop({ tool_status: 'active' })).toBe(true);
    expect(exportsToProShop({ tool_status: 'retired' })).toBe(true);
  });
});

// A tool's FIRST description is generated in this app, so that is where the
// marker has to appear. Nothing rewrites a STORED description on its own.
describe('the BETA description marker', () => {
  const f = { toolType: 'flat end mill', diameter: 0.5, flutes: 4, loc: 1, unit: 'inches' };

  it('rides along with the generated name', () => {
    expect(buildDesc({ ...f, status: 'beta' })).toMatch(/ BETA$/);
    expect(buildDesc({ ...f, status: 'active' })).not.toMatch(/BETA/);
    expect(buildDesc({ ...f, status: 'retired' })).not.toMatch(/BETA/);
  });

  it('is added once, never twice', () => {
    expect(withBetaSuffix('1/2 EM BETA')).toBe('1/2 EM BETA');
    expect(withBetaSuffix(withBetaSuffix('1/2 EM'))).toBe('1/2 EM BETA');
  });

  it('strips cleanly, whatever the spacing or case', () => {
    for (const d of ['1/2 EM BETA', '1/2 EM beta', '1/2 EM   Beta']) {
      expect(stripBetaSuffix(d)).toBe('1/2 EM');
    }
  });

  it('only matches the END, so a tool genuinely named BETA-something survives', () => {
    expect(hasBetaSuffix('BETA GRADE EM')).toBe(false);
    expect(stripBetaSuffix('BETA GRADE EM')).toBe('BETA GRADE EM');
  });

  // The prompt fires when the marker outlives the status — never the reverse.
  // A beta tool with a hand-typed name that omits BETA is the user's business.
  it('flags a leftover marker on a non-beta tool, and nothing else', () => {
    expect(betaSuffixStale({ tool_status: 'active', description: '1/2 EM BETA' })).toBe(true);
    expect(betaSuffixStale({ tool_status: 'retired', description: '1/2 EM BETA' })).toBe(true);
    expect(betaSuffixStale({ tool_status: 'beta', description: '1/2 EM BETA' })).toBe(false);
    expect(betaSuffixStale({ tool_status: 'beta', description: '1/2 EM' })).toBe(false);
    expect(betaSuffixStale({ tool_status: 'active', description: '1/2 EM' })).toBe(false);
  });
});

describe('the library filter', () => {
  const tools = [
    { id: 'a', tool_status: 'active', description: 'act' },
    { id: 'b', tool_status: 'beta', description: 'bet' },
    { id: 'r', tool_status: 'retired', description: 'ret' },
    { id: 'u', description: 'no status at all' },
  ];
  const ids = (statuses) => applyFilters(tools, { statuses }).map(t => t.id).sort();

  it('shows Active + Beta by default, and hides Retired', () => {
    expect(DEFAULT_VISIBLE_STATUSES).toEqual(['active', 'beta']);
    expect(ids(DEFAULT_VISIBLE_STATUSES)).toEqual(['a', 'b', 'u']);   // 'u' has no status → active
  });

  it('shows retired when asked', () => {
    expect(ids(['retired'])).toEqual(['r']);
  });

  // ⚠️ Every caller that doesn't know about status must keep seeing the whole
  // library — the link picker, the merge flow, anything searching to FIND a
  // specific tool. Hiding a retired tool from a lookup reads as it being gone.
  it('does NOT filter when no statuses are given', () => {
    expect(applyFilters(tools, {}).map(t => t.id).sort()).toEqual(['a', 'b', 'r', 'u']);
    expect(applyFilters(tools, { statuses: [] }).map(t => t.id).sort()).toEqual(['a', 'b', 'r', 'u']);
  });
});

describe('the status list itself', () => {
  it('has exactly the three states, each with a distinct ProShop value', () => {
    expect(TOOL_STATUSES.map(s => s.id)).toEqual(['active', 'beta', 'retired']);
    expect(TOOL_STATUSES.map(s => s.proShopValue)).toEqual(['Active', null, 'Archived']);
  });

  it('predicates agree with statusOf', () => {
    expect(isBeta({ tool_status: 'beta' })).toBe(true);
    expect(isRetired({ tool_status: 'retired' })).toBe(true);
    expect(isBeta({})).toBe(false);
    expect(isRetired({})).toBe(false);
  });
});

// A bulk export must never quietly do less than it claims.
describe('the bulk-export message', () => {
  it('reports the real count and names what was left out', () => {
    expect(proShopExportMessage(245, 3))
      .toBe('Exported 242 tools to ProShop CSV — 3 beta tools skipped (not exported to ProShop)');
  });

  it('says nothing extra when nothing was skipped', () => {
    expect(proShopExportMessage(245, 0)).toBe('Exported 245 tools to ProShop CSV');
  });

  it('gets the singulars right', () => {
    expect(proShopExportMessage(2, 1)).toBe('Exported 1 tool to ProShop CSV — 1 beta tool skipped (not exported to ProShop)');
  });
});

// ⚠️ The RETIRED marker is a DELIBERATE, granted exception to "descriptions are
// never silently renamed". Fusion has nowhere to store a status, and the
// description is the one field a programmer reads when picking tools for a new
// job — the shop keeps running retired tools on already-programmed jobs, so the
// marker is what stops one being picked for a NEW one. It only ever appends to
// the END, and it is a pure function of tool_status, so it can never go stale.
describe('the RETIRED description marker', () => {
  const f = { toolType: 'flat end mill', diameter: 0.5, flutes: 4, loc: 1, unit: 'inches' };

  it('rides along with the generated name', () => {
    expect(buildDesc({ ...f, status: 'retired' })).toMatch(/ RETIRED$/);
    expect(buildDesc({ ...f, status: 'active' })).not.toMatch(/RETIRED/);
  });

  it('appends once, and to the end', () => {
    expect(withRetiredSuffix('1/2 EM')).toBe('1/2 EM RETIRED');
    expect(withRetiredSuffix('1/2 EM RETIRED')).toBe('1/2 EM RETIRED');
    expect(withRetiredSuffix(withRetiredSuffix('1/2 EM'))).toBe('1/2 EM RETIRED');
  });

  it('strips cleanly, whatever the spacing or case', () => {
    for (const d of ['1/2 EM RETIRED', '1/2 EM retired', '1/2 EM   Retired']) {
      expect(stripRetiredSuffix(d)).toBe('1/2 EM');
    }
  });

  it('only matches the END — a tool named "RETIRED SERIES ROUGHER" survives', () => {
    expect(hasRetiredSuffix('RETIRED SERIES ROUGHER')).toBe(false);
    expect(stripRetiredSuffix('RETIRED SERIES ROUGHER')).toBe('RETIRED SERIES ROUGHER');
  });

  // A tool is in exactly one state, so at most one marker is ever right.
  it('a status change swaps the marker rather than stacking them', () => {
    expect(applyStatusSuffix('1/2 EM BETA', 'retired')).toBe('1/2 EM RETIRED');
    expect(applyStatusSuffix('1/2 EM RETIRED', 'beta')).toBe('1/2 EM BETA');
    expect(applyStatusSuffix('1/2 EM RETIRED', 'active')).toBe('1/2 EM');
    expect(stripStatusSuffixes('1/2 EM BETA RETIRED')).toBe('1/2 EM');
  });
});

// The write-time invariant: every save enforces it, which is what makes the
// marker reach Fusion by itself rather than when someone remembers.
describe('withRetiredMarker — the write-time invariant', () => {
  it('adds the marker to a retired tool', () => {
    expect(withRetiredMarker({ tool_status: 'retired', description: '1/2 EM' }).description)
      .toBe('1/2 EM RETIRED');
  });

  it('takes it away again when the tool is no longer retired', () => {
    expect(withRetiredMarker({ tool_status: 'active', description: '1/2 EM RETIRED' }).description)
      .toBe('1/2 EM');
  });

  it('leaves the BETA marker alone — that one is offered, not enforced', () => {
    expect(withRetiredMarker({ tool_status: 'beta', description: '1/2 EM BETA' }).description)
      .toBe('1/2 EM BETA');
  });

  // ⚠️ Same reference when nothing changes — callers use identity to decide
  // whether there is anything to persist (the syncPresetMaterialName rule).
  it('returns the SAME object when the description already agrees', () => {
    const ok = { tool_status: 'retired', description: '1/2 EM RETIRED' };
    expect(withRetiredMarker(ok)).toBe(ok);
    const active = { tool_status: 'active', description: '1/2 EM' };
    expect(withRetiredMarker(active)).toBe(active);
  });

  it('is idempotent — a second save changes nothing', () => {
    const once = withRetiredMarker({ tool_status: 'retired', description: '1/2 EM' });
    expect(withRetiredMarker(once)).toBe(once);
  });

  it('tolerates a tool with no description', () => {
    expect(withRetiredMarker({ tool_status: 'retired' })).toEqual({ tool_status: 'retired' });
    expect(withRetiredMarker(null)).toBeNull();
  });
});

// ⚠️ Compared as a SET, never by length. Turning Beta off and Retired on leaves
// the length at 2 while being a completely different filter — a length check
// called that "no filters set", so the Reset button never appeared.
describe('isDefaultStatusSelection', () => {
  it('recognises the default, in any order', () => {
    expect(isDefaultStatusSelection(['active', 'beta'])).toBe(true);
    expect(isDefaultStatusSelection(['beta', 'active'])).toBe(true);
  });

  it('is false for a DIFFERENT selection of the same size', () => {
    expect(isDefaultStatusSelection(['active', 'retired'])).toBe(false);
    expect(isDefaultStatusSelection(['beta', 'retired'])).toBe(false);
  });

  it('is false for more, fewer, or none', () => {
    expect(isDefaultStatusSelection(ALL_TOOL_STATUSES)).toBe(false);
    expect(isDefaultStatusSelection(['active'])).toBe(false);
    expect(isDefaultStatusSelection([])).toBe(false);
    expect(isDefaultStatusSelection(undefined)).toBe(false);
  });

  it('ALL_TOOL_STATUSES covers every status, so it filters nothing', () => {
    expect(new Set(ALL_TOOL_STATUSES)).toEqual(new Set(TOOL_STATUSES.map(s => s.id)));
    const all = [{ id: 'a' }, { id: 'b', tool_status: 'beta' }, { id: 'r', tool_status: 'retired' }];
    expect(applyFilters(all, { statuses: ALL_TOOL_STATUSES })).toHaveLength(3);
  });
});
