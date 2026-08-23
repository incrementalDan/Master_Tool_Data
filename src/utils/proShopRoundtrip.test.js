import { describe, it, expect } from 'vitest';
import { buildProShopCSV, buildDesc, PS_MAIN_COLS, PURCHASING_COLS } from '../../tool-extractor.tsx';
import { toolToExtractor } from '../schema/toolSchema.js';
import { canonicalProShopHeader, proShopRowsToObjects } from './proShopHeaders.js';
import { parseCSV, psRowToTool } from '../components/ImportFlow.jsx';

// Locks the Location + tap Point Type round-trip through the app's OWN ProShop
// export: the export must emit the `location` / `pointType` API-id columns, and
// the import alias map must canonicalize them back to the keys the importer reads
// (`Location` / `Point Type`). The merge onto an existing tool lives in
// matchProShopToTools (fill-gap); the import-key mapping is what this guards.
describe('ProShop export: Location + Point Type columns', () => {
  const tool = {
    id: 'FTL-AAA111', tool_type: 'tap', tool_id: 'R-42',
    description: '1/4-20 CUT TAP', diameter: 0.25, unit: 'inches',
    location: 'LC-8', point_type: 'Plug', assemblies: [],
  };

  it('exports the location + pointType columns with values', () => {
    const csv = buildProShopCSV(toolToExtractor(tool));
    const [header, firstRow] = csv.split('\n');
    const cols = header.split(',');
    expect(cols).toContain('location');
    expect(cols).toContain('pointType');
    expect(firstRow.split(',')).toContain('LC-8');
    expect(firstRow.split(',')).toContain('Plug');
  });

  it('those export headers canonicalize back to the import keys', () => {
    expect(canonicalProShopHeader('location')).toBe('Location');
    expect(canonicalProShopHeader('pointType')).toBe('Point Type');
  });
});

// A tool has exactly ONE description — the stored one. buildDesc() is a GENERATOR
// (specs → a suggested name) for the extractor/Add flow; the export used to call it
// unconditionally, so ProShop received a regenerated name that didn't match the app.
describe('ProShop export: description is the stored one, not regenerated', () => {
  const base = {
    id: 'FTL-CCC333', tool_type: 'flat end mill', tool_id: 'A-7',
    diameter: 0.5, number_of_flutes: 4, flute_length: 1.0, unit: 'inches', assemblies: [],
  };
  const descCol = (tool) => {
    const csv = buildProShopCSV(toolToExtractor(tool));
    const [header, firstRow] = csv.split('\n');
    return firstRow.split(',')[header.split(',').indexOf('description')];
  };

  it('exports the tool\'s own description verbatim', () => {
    // A hand-typed name buildDesc would never produce.
    expect(descCol({ ...base, description: 'RGH 1/2 EM — Job 1042 proven' }))
      .toBe('RGH 1/2 EM — Job 1042 proven');
  });

  it('tracks the stored description, so it can never drift from the app', () => {
    const generated = buildDesc(toolToExtractor(base));
    const stored = 'ROUGHER 1/2 4FL';
    expect(stored).not.toBe(generated);            // guard: the two really differ
    expect(descCol({ ...base, description: stored })).toBe(stored);
  });

  it('falls back to the generated name only when nothing is stored', () => {
    expect(descCol({ ...base, description: '' })).toBe(buildDesc(toolToExtractor(base)));
  });
});

describe('ProShop export: flutes + EDP# header names', () => {
  const tool = {
    id: 'FTL-BBB222', tool_type: 'flat end mill', tool_id: 'A-3',
    description: '1/2 EM', diameter: 0.5, number_of_flutes: 4, unit: 'inches', assemblies: [],
    purchasing: {
      manufacturers: [{ id: 'm1', name: 'Helical', edp: '12334', order: 0 }],
      vendors: [
        { id: 'v1', manufacturer_id: 'm1', name: 'MSC Industrial', vendor_num: '99377473', price: 34.76, order: 0 },
        { id: 'v2', manufacturer_id: 'm1', name: 'Butler Brothers', price: 30.74, order: 1 },
      ],
    },
  };

  it('uses "No. of Flutes" and "EDP#" (not numberOfFlutes / vendorToolId) and they canonicalize back', () => {
    const csv = buildProShopCSV(toolToExtractor(tool));
    const cols = csv.split('\n')[0].split(',');
    expect(cols).toContain('No. of Flutes');
    expect(cols).toContain('EDP#');
    expect(cols).not.toContain('numberOfFlutes');
    expect(cols).not.toContain('vendorToolId');
    expect(canonicalProShopHeader('No. of Flutes')).toBe('No.ofFlutes');
    expect(canonicalProShopHeader('EDP#')).toBe('EDP#');
  });

  it('still emits one row per vendor (multi-line purchasing)', () => {
    const csv = buildProShopCSV(toolToExtractor(tool));
    const dataRows = csv.split('\n').slice(1);
    expect(dataRows.length).toBe(2); // two vendors → two rows
  });
});



// ─── Through Coolant ─────────────────────────────────────────────────────────
// The export reads the tool's coolant string, but toolToExtractor emits Fusion's
// value ("flood tool") while THROUGH_COOLANT_VALUES only listed the retired
// spellings — so every TSC-capable tool exported Through Coolant = false.
describe('ProShop export: Through Coolant follows tsc_capable', () => {
  const base = {
    id: 'FTL-TSC001', tool_type: 'drill', tool_id: 'D-241',
    description: '.2598 DRILL', diameter: 0.2598, unit: 'inches', assemblies: [],
  };
  const coolantCol = (tool) => {
    const csv = buildProShopCSV(toolToExtractor(tool));
    const [header, firstRow] = csv.split('\n');
    return firstRow.split(',')[header.split(',').indexOf('throughCoolant')];
  };

  it('exports true for a through-spindle-coolant tool', () => {
    expect(coolantCol({ ...base, tsc_capable: true })).toBe('true');
  });

  it('exports false for a tool without it', () => {
    expect(coolantCol({ ...base, tsc_capable: false })).toBe('false');
  });

  it('round-trips back to tsc_capable through the importer', () => {
    const csv = buildProShopCSV(toolToExtractor({ ...base, tsc_capable: true }));
    const [group] = groupRows(csv);
    expect(psRowToTool(group).tsc_capable).toBe(true);
  });

  // An exact `=== 'true'` compare turned any other spelling into a silent false
  // — a wrong answer that reads like a real one.
  it('reads a boolean cell whatever way ProShop spelled it', () => {
    const row = (v) => [{ 'Tool #': 'D-1', 'Tool Group': 'C', 'Through Coolant': v }];
    for (const yes of ['true', 'TRUE', 'True', 'Yes', 'Y', '1']) {
      expect(psRowToTool(row(yes)).tsc_capable).toBe(true);
    }
    for (const no of ['false', 'FALSE', 'No', 'N', '0', '']) {
      expect(psRowToTool(row(no)).tsc_capable).toBe(false);
    }
  });
});

// Export → parse → canonicalize → group by Tool #, exactly as the importer does.
function groupRows(csv) {
  const objs = proShopRowsToObjects(parseCSV(csv));
  const map = new Map();
  for (const row of objs) {
    const key = row['Tool #'] || `__row_${map.size}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return [...map.values()];
}

// ─── Multi-vendor rows ───────────────────────────────────────────────────────
// A continuation row carried a brand, a vendor and a price and NOTHING to attach
// them to: the whole main column block was blanked, Tool # included. ProShop
// can't group such a row, and this app's own importer groups by Tool # — so
// re-importing our export silently dropped every vendor after the first.
describe('ProShop export: continuation rows keep the Tool #', () => {
  const tool = {
    id: 'FTL-MULTI1', tool_type: 'flat end mill', tool_id: 'A-1', unit: 'inches',
    description: '3/8 3FL EM 1.000LOC', diameter: 0.375, number_of_flutes: 3,
    flute_length: 1, overall_length: 3, shank_diameter: 0.375, location: 'LC-8', assemblies: [],
    purchasing: {
      manufacturers: [{ id: 'm1', name: 'Helical', edp: '48261', order: 0 }],
      vendors: [
        { id: 'v1', manufacturer_id: 'm1', name: 'MSC Industrial', vendor_num: '94721453', price: 51.1, order: 0 },
        { id: 'v2', manufacturer_id: 'm1', name: 'Butler Brothers', price: 44, order: 1 },
      ],
    },
  };
  const csv = () => buildProShopCSV(toolToExtractor(tool));

  it('every row carries the Tool #', () => {
    const rows = proShopRowsToObjects(parseCSV(csv()));
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r['Tool #'])).toEqual(['A-1', 'A-1']);
  });

  it('so the whole tool is ONE group, not an orphan row', () => {
    const groups = groupRows(csv());
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it('both vendors survive the round-trip, with their own prices', () => {
    const [group] = groupRows(csv());
    const { purchasing } = psRowToTool(group);
    expect(purchasing.vendors.map(v => v.name)).toEqual(['MSC Industrial', 'Butler Brothers']);
    expect(purchasing.vendors.map(v => v.price)).toEqual([51.1, 44]);
    // Canonicalized against the vendor registry on import — "Helical" is an
    // alias of "Helical Solutions".
    expect(purchasing.manufacturers.map(m => m.name)).toEqual(['Helical Solutions']);
  });

  it('the EDP# split survives: vendor catalog number vs manufacturer part number', () => {
    const [group] = groupRows(csv());
    const { purchasing } = psRowToTool(group);
    // MSC has its own catalog numbers, so its number is the vendor's; the
    // Butler row's number is Helical's part number.
    expect(purchasing.vendors.find(v => v.name === 'MSC Industrial').vendor_num).toBe('94721453');
    expect(purchasing.manufacturers[0].edp).toBe('48261');
  });

  it('a continuation row repeats identity + descriptive fields', () => {
    const [, second] = proShopRowsToObjects(parseCSV(csv()));
    expect(second['Description']).toBe('3/8 3FL EM 1.000LOC');
    expect(second['Location']).toBe('LC-8');
    expect(second['Tool Group']).toBe('A');
  });

  it('but NOT measurements — those stay on the first row only', () => {
    const [first, second] = proShopRowsToObjects(parseCSV(csv()));
    for (const col of ['Cut Dia', 'LOC', 'Overall Length', 'No.ofFlutes', 'Shank Diameter']) {
      expect(first[col]).toBeTruthy();
      expect(second[col]).toBe('');
    }
  });

  it('header row still covers every main + purchasing column', () => {
    const cols = csv().split('\n')[0].split(',');
    expect(cols).toHaveLength(PS_MAIN_COLS.length + PURCHASING_COLS.length);
  });

  it('is unchanged for a single-vendor tool — one row, everything on it', () => {
    const single = { ...tool, purchasing: { manufacturers: [{ id: 'm1', name: 'Helical', edp: '48261', order: 0 }], vendors: [] } };
    const rows = proShopRowsToObjects(parseCSV(buildProShopCSV(toolToExtractor(single))));
    expect(rows).toHaveLength(1);
    expect(rows[0]['Cut Dia']).toBeTruthy();
    expect(rows[0]['Approved Brand']).toBe('Helical');
  });
});
