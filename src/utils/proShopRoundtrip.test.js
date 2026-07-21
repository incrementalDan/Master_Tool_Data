import { describe, it, expect } from 'vitest';
import { buildProShopCSV } from '../../tool-extractor.tsx';
import { toolToExtractor } from '../schema/toolSchema.js';
import { canonicalProShopHeader } from './proShopHeaders.js';

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

