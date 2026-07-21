import { describe, it, expect } from 'vitest';
import { matchProShopToTools } from './ImportFlow.jsx';

// A fill-gap field where the app already has a DIFFERENT value than ProShop is
// flagged (not overwritten, not silently ignored). ProShop-authoritative fields
// still auto-win. See CLAUDE.md → "Informed, not blocked".
const baseTool = (over = {}) => ({
  id: 'FTL-1', tool_type: 'flat end mill', tool_id: 'A-3',
  description: '1/2 EM', diameter: 0.5, unit: 'inches', assemblies: [], ...over,
});
const merge = (row, tool) => {
  const { matched } = matchProShopToTools([[{ 'Tool #': 'A-3', ...row }]], [tool], 'inches', []);
  return matched[0];
};

describe('ProShop merge — fill-gap fields fill / flag / no-op', () => {
  it('fills when the app value is empty', () => {
    const m = merge({ Coating: 'AlTiN' }, baseTool({ coating: '' }));
    expect(m.additions.coating).toBe('AlTiN');
    expect(m.conflicts).toEqual([]);
  });

  it('no-op when values are equal (case/space-insensitive)', () => {
    const m = merge({ Coating: 'altin' }, baseTool({ coating: 'AlTiN' }));
    expect(m.additions.coating).toBeUndefined();
    expect(m.conflicts).toEqual([]);
  });

  it('flags when the app has a different value', () => {
    const m = merge({ Coating: 'AlTiN' }, baseTool({ coating: 'TiCN' }));
    expect(m.additions.coating).toBeUndefined();
    expect(m.conflicts).toContainEqual({ field: 'coating', values: ['TiCN', 'AlTiN'] });
  });

  it('flags a differing point type (tap)', () => {
    const m = merge({ 'Point Type': 'Bottoming' }, baseTool({ tool_type: 'tap', point_type: 'Plug' }));
    expect(m.conflicts).toContainEqual({ field: 'point_type', values: ['Plug', 'Bottoming'] });
  });
});

describe('ProShop merge — tool_id + location nuances', () => {
  it('does not flag a legacy-id match (expected re-number)', () => {
    const { matched } = matchProShopToTools(
      [[{ 'Tool #': 'A-3', Coating: 'AlTiN' }]],
      [baseTool({ tool_id: 'B-9', legacy_ids: ['A-3'], coating: 'AlTiN' })],
      'inches', [],
    );
    expect(matched[0].conflicts).toEqual([]);
    expect(matched[0].additions.tool_id).toBeUndefined();
  });

  it('structured location: same number is a no-op (LC-1405 vs 1405)', () => {
    const m = merge({ Location: '1405' }, baseTool({ tool_location: { system_id: 's', bin: 1405 }, location: 'LC-1405' }));
    expect(m.conflicts).toEqual([]);
    expect(m.additions.location).toBeUndefined();
  });

  it('structured location: a NUMBER mismatch is flagged (not overwritten)', () => {
    const m = merge({ Location: '1405' }, baseTool({ tool_location: { system_id: 's', bin: 1400 }, location: 'LC-1400' }));
    expect(m.conflicts).toContainEqual({ field: 'location', values: ['LC-1400', '1405'] });
    expect(m.additions.location).toBeUndefined();
  });

  it('free-text location: ProShop wins on a number difference (over Fusion)', () => {
    const m = merge({ Location: '1405' }, baseTool({ location: 'LC-8' }));
    expect(m.additions.location).toBe('1405');
    expect(m.conflicts).toEqual([]);
  });

  it('free-text location: same number keeps the app prefixed string (LC-8 vs 8)', () => {
    const m = merge({ Location: '8' }, baseTool({ location: 'LC-8' }));
    expect(m.additions.location).toBeUndefined();
    expect(m.conflicts).toEqual([]);
  });

  it('fills location when the tool has none', () => {
    const m = merge({ Location: '1405' }, baseTool({ location: '' }));
    expect(m.additions.location).toBe('1405');
  });
});

describe('ProShop merge — structured location assignment (app takes over)', () => {
  // A single bin-only Location System with a fixed "LC" drawer prefix.
  const binOnlySystem = {
    id: 'sys-lc',
    levels: {
      zone: { on: false }, station: { on: false },
      drawer: { on: true, levelType: 'Drawer', identFormat: 'custom', customIdent: 'LC', options: [] },
      bin: { fixed: false, start: 1000 },
    },
    delimiters: { zs: '-', sd: '-', db: '-' },
  };
  const mergeSys = (row, tool) => {
    const { matched } = matchProShopToTools([[{ 'Tool #': 'A-3', ...row }]], [tool], 'inches', [], [binOnlySystem]);
    return matched[0];
  };

  it('assigns a structured location (bin) that composes LC-140', () => {
    const m = mergeSys({ Location: '140' }, baseTool({ location: '' }));
    expect(m.additions.tool_location).toEqual({ system_id: 'sys-lc', zone_id: null, station_id: null, drawer_id: null, bin: 140 });
    expect(m.additions.location).toBe('LC-140');
    expect(m.conflicts).toEqual([]);
  });

  it('upgrades a legacy free-text location to structured ownership', () => {
    const m = mergeSys({ Location: '140' }, baseTool({ location: 'LC-140' }));
    expect(m.additions.tool_location.bin).toBe(140);
    expect(m.additions.location).toBe('LC-140');
  });

  it('a no-Fusion tool with no location gets a structured (persistable) location', () => {
    const m = mergeSys({ Location: '77' }, baseTool({ no_fusion_link: true, location: '' }));
    expect(m.additions.tool_location).toEqual({ system_id: 'sys-lc', zone_id: null, station_id: null, drawer_id: null, bin: 77 });
    expect(m.additions.location).toBe('LC-77');
  });

  it('still flags a bin mismatch once the app owns a structured location', () => {
    const m = mergeSys({ Location: '1405' }, baseTool({ tool_location: { system_id: 'sys-lc', bin: 1400 }, location: 'LC-1400' }));
    expect(m.conflicts).toContainEqual({ field: 'location', values: ['LC-1400', '1405'] });
    expect(m.additions.tool_location).toBeUndefined();
  });
});

describe('ProShop merge — authoritative fields still auto-win (no flag)', () => {
  it('MIN OOH overwrites without flagging', () => {
    const m = merge({ 'Length Below Holder - MIN OOH': '1.25' }, baseTool({ min_ooh: 1.0 }));
    expect(m.additions.min_ooh).toBeCloseTo(1.25, 5);
    expect(m.conflicts.some(c => c.field === 'min_ooh')).toBe(false);
  });

  it('through-coolant overwrites without flagging', () => {
    const m = merge({ 'Through Coolant': 'true' }, baseTool({ tsc_capable: false }));
    expect(m.additions.tsc_capable).toBe(true);
    expect(m.conflicts.some(c => c.field === 'tsc_capable')).toBe(false);
  });
});
