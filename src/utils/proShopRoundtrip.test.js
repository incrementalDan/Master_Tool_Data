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
