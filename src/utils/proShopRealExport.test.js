import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { proShopRowsToObjects, isProShopSummaryRow, canonicalProShopHeader } from './proShopHeaders.js';
import { parseCSV, psRowToTool } from '../components/ImportFlow.jsx';
import { buildProShopCSV } from '../../tool-extractor.tsx';
import { toolToExtractor } from '../schema/toolSchema.js';

// Exercised against the shop's REAL ProShop export, not a hand-written fixture.
// Every rule in here was measured off this file — a synthetic row can be made to
// agree with whatever the code currently does, which is how the round-trip
// losses below survived a green suite.
const REAL = 'FUSION TOOL Library REF/ProShop Reference Data/Full Export ProShop - for REF.csv';

const rows = () => proShopRowsToObjects(parseCSV(fs.readFileSync(REAL, 'utf8')));

// Group by Tool # exactly as both importers do.
function groupRows(objs) {
  const map = new Map();
  for (const r of objs) {
    if (isProShopSummaryRow(r)) continue;
    const key = r['Tool #'] || `__row_${map.size}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return [...map.values()];
}

describe('the real ProShop export parses into tools', () => {
  it('every header the importer reads is present in the real file', () => {
    const present = new Set(rows()[0] ? Object.keys(rows()[0]) : []);
    for (const key of ['Tool #', 'Description', 'Tool Group', 'Cut Dia', 'LOC', 'Overall Length',
      'No.ofFlutes', 'Shank Diameter', 'CornerRad', 'Tip Angle', 'HelixAngle', 'Coating',
      'Tool Material', 'Through Coolant', 'Custom Grind', 'Location', 'Approved Brand',
      'Vendor', 'EDP#', 'Cost', 'CenterCut', 'FluteType/Chipbreaker',
      'Length Below Holder - MIN OOH', 'Point Type', 'Tap class', 'Thread']) {
      expect(present, `missing ${key}`).toContain(key);
    }
  });

  // A ProShop export ends with a TOTALS footer — a Tool # of "TOTALS", no
  // description, no group, and every numeric column holding a library-wide sum.
  // Imported as a tool it becomes a phantom record whose "price" is the value of
  // the entire library.
  it('skips the trailing TOTALS footer, and only that', () => {
    const all = rows();
    const summary = all.filter(isProShopSummaryRow);
    expect(summary).toHaveLength(1);
    expect(summary[0]['Tool #']).toBe('TOTALS');
    expect(groupRows(all).some(g => g[0]['Tool #'] === 'TOTALS')).toBe(false);
  });

  // Both are declared in fieldRegistry with a proShopColumn and were already
  // EXPORTED — they were simply never read back, so the values sat in the file
  // being ignored.
  it('recovers Center Cut and Flute Type, which the import used to drop', () => {
    const tools = groupRows(rows()).map(g => psRowToTool(g));
    expect(tools.filter(t => t.center_cutting).length).toBeGreaterThan(50);
    expect(tools.filter(t => t.flute_type).length).toBeGreaterThan(10);
  });

  // ProShop's Thread Type is the app's tap_sub_type — but the column also
  // appears on thread MILLS (N-48, N-78 "Single Profile TM"), where a tap
  // sub-type has no meaning. "Spiral Cut" is a cut tap; the spiral detail has
  // nowhere to live today and is dropped rather than invented as a third value.
  it('reads Thread Type onto taps, and only taps', () => {
    const tools = groupRows(rows()).map(g => psRowToTool(g));
    const taps = tools.filter(t => t.tool_type === 'tap' && t.tap_sub_type);
    expect(taps.length).toBe(23);
    expect(new Set(taps.map(t => t.tap_sub_type))).toEqual(new Set(['form', 'cut']));
    // R-70/R-71/R-72/R-105/R-214 are "Spiral Cut" in ProShop.
    expect(tools.find(t => t.tool_id === 'R-70 (CG)').tap_sub_type).toBe('cut');
    // No non-tap picks one up, even though the column is populated on some.
    expect(tools.filter(t => t.tool_type !== 'tap' && t.tap_sub_type)).toEqual([]);
  });

  // "Threads Per Inch" is a RANGE on a thread mill — the tool's TPI capability,
  // which the app stores as tpi_min/tpi_max. A lone number is the tap case and
  // is already implied by the thread designation, so it is not a one-ended range.
  it('reads a thread mill\'s TPI range, and ignores a tap\'s single TPI', () => {
    const tools = groupRows(rows()).map(g => psRowToTool(g));
    const ranged = tools.filter(t => t.tpi_min != null);
    expect(ranged.map(t => `${t.tool_id} ${t.tpi_min}-${t.tpi_max}`).sort())
      .toEqual(['N-122 18-56', 'N-239 32-64', 'N-78 11-32']);
    expect(ranged.every(t => t.tool_type === 'thread mill')).toBe(true);
    // R-81 carries "11" and R-231 "32" — taps, not ranges.
    expect(tools.find(t => t.tool_id === 'R-81').tpi_min).toBeNull();
  });

  // ProShop's Status: Active (270) / blank (40) / Archived (1). Blank is ACTIVE.
  it('reads Status, with blank meaning active', () => {
    const tools = groupRows(rows()).map(g => psRowToTool(g));
    const retired = tools.filter(t => t.tool_status === 'retired');
    expect(retired.map(t => t.tool_id)).toEqual(['A-6 (Ar)']);
    // Everything else — including the 40 blank rows — is active, not unknown.
    expect(tools.every(t => t.tool_status === 'active' || t.tool_status === 'retired')).toBe(true);
    expect(tools.filter(t => t.tool_status === 'active').length).toBe(tools.length - 1);
  });

  it('reads Through Coolant off the real file', () => {
    const tools = groupRows(rows()).map(g => psRowToTool(g));
    expect(tools.filter(t => t.tsc_capable).length).toBe(11);
  });
});

// import → export → import over every tool in the real file. This is the check
// that actually catches a column the export writes and the import can't read
// back (or writes in a spelling/value format the import doesn't recognize).
describe('every real tool survives a ProShop round-trip', () => {
  const FIELDS = [
    'tool_id', 'grouping', 'description', 'diameter', 'flute_length', 'overall_length',
    'number_of_flutes', 'shank_diameter', 'corner_radius', 'tip_angle', 'tip_diameter',
    'helix_angle', 'coating', 'material', 'min_ooh', 'tip_to_first_thread',
    'tap_class', 'point_type', 'stub_jobber', 'pitch',
    'center_cutting', 'flute_type', 'tsc_capable', 'custom_grind',
    'double_ended', 'full_profile', 'backside_capable', 'material_suitability',
    'tap_sub_type', 'tpi_min', 'tpi_max', 'tool_status',
  ];
  // ⚠️ One column the export still FILLS IN rather than leaves blank: a tool with
  // no corner radius exports `0` (toolToExtractor's `?? '0'`), so re-import
  // stamps corner_radius: 0 on it. Deliberately kept — Fusion writes RE only when
  // non-zero, so 0 and unset behave identically downstream. Pinned so the strict
  // check above still covers everything else, and so it can only ever fill a
  // missing value, never rewrite a real one.
  // (shank_diameter used to be here too, substituting the CUT diameter. It now
  // exports blank when unknown and round-trips exactly.)
  const SUBSTITUTED = ['corner_radius'];

  it('loses nothing on export → re-import', () => {
    const drift = [];
    for (const group of groupRows(rows())) {
      const before = psRowToTool(group);
      const after = psRowToTool(proShopRowsToObjects(parseCSV(buildProShopCSV(toolToExtractor(before)))));
      for (const f of FIELDS) {
        if (SUBSTITUTED.includes(f)) continue;
        if (JSON.stringify(before[f] ?? null) !== JSON.stringify(after[f] ?? null)) {
          drift.push(`${before.tool_id} ${f}: ${JSON.stringify(before[f])} → ${JSON.stringify(after[f])}`);
        }
      }
    }
    expect(drift).toEqual([]);
  });

  // Pins the two known substitutions: they may only ever turn a MISSING value
  // into a filled one, never change a value the app actually held.
  it('only ever fills in the two substituted columns, never rewrites them', () => {
    const changed = [];
    for (const group of groupRows(rows())) {
      const before = psRowToTool(group);
      const after = psRowToTool(proShopRowsToObjects(parseCSV(buildProShopCSV(toolToExtractor(before)))));
      for (const f of SUBSTITUTED) {
        if (before[f] != null && JSON.stringify(before[f]) !== JSON.stringify(after[f])) {
          changed.push(`${before.tool_id} ${f}: ${JSON.stringify(before[f])} → ${JSON.stringify(after[f])}`);
        }
      }
    }
    expect(changed).toEqual([]);
  });

  it('keeps every purchasing row — manufacturers AND vendors', () => {
    const drift = [];
    for (const group of groupRows(rows())) {
      const before = psRowToTool(group);
      const after = psRowToTool(proShopRowsToObjects(parseCSV(buildProShopCSV(toolToExtractor(before)))));
      const n = (p) => `${(p?.manufacturers || []).length}/${(p?.vendors || []).length}`;
      if (n(before.purchasing) !== n(after.purchasing)) {
        drift.push(`${before.tool_id}: ${n(before.purchasing)} → ${n(after.purchasing)}`);
      }
    }
    expect(drift).toEqual([]);
  });
});

// ProShop's boolean-ish columns are not one format — the Boolean-TYPED
// attributes hold true/false, while the untyped Center Cut / Double Ended hold
// Y/N. The export writes each column the way ProShop stores it.
describe('boolean columns are written the way ProShop stores them', () => {
  const tool = {
    id: 'FTL-BOOL', tool_type: 'flat end mill', tool_id: 'A-9', unit: 'inches',
    description: '1/2 EM', diameter: 0.5, assemblies: [],
    center_cutting: true, double_ended: false, tsc_capable: true,
    custom_grind: false, full_profile: false, backside_capable: false,
  };
  const cells = () => {
    const csv = buildProShopCSV(toolToExtractor(tool));
    const [h, r] = csv.split('\n');
    const cols = h.split(','), vals = r.split(',');
    return Object.fromEntries(cols.map((c, i) => [c, vals[i]]));
  };

  it('untyped picklists use Y / N', () => {
    expect(cells().centerCutting).toBe('Y');
    expect(cells().doubleEnded).toBe('N');
  });

  it('typed booleans use true / false — never blank, which means unanswered', () => {
    const c = cells();
    expect(c.throughCoolant).toBe('true');
    expect(c.customgrindtool).toBe('false');
    expect(c.fullProfile).toBe('false');
    expect(c.backsideCapable).toBe('false');
  });

  it('and those columns canonicalize back to the keys the importer reads', () => {
    expect(canonicalProShopHeader('centerCutting')).toBe('CenterCut');
    expect(canonicalProShopHeader('CenterCut')).toBe('CenterCut');
    expect(canonicalProShopHeader('fluteType')).toBe('FluteType/Chipbreaker');
    expect(canonicalProShopHeader('FluteType/Chipbreaker')).toBe('FluteType/Chipbreaker');
  });
});
