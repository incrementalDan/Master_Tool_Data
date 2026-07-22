import { describe, it, expect } from 'vitest';
import {
  DEFAULT_VENDOR_REGISTRY,
  getManufacturerNames,
  getVendorNames,
  vendorHasOwnCatalogNumber,
  resolveVendorName,
  entityByName,
  entityById,
  registryIdForName,
  syncPurchasingNames,
  backfillPurchasingRegistryIds,
} from './vendorRegistry.js';
import {
  generateManufacturerUrl,
  generateVendorUrl,
  manufacturerHasUrlGenerator,
  vendorHasUrlGenerator,
} from '../utils/urlGenerators.js';

describe('DEFAULT_VENDOR_REGISTRY (migration seed)', () => {
  it('has a unified entity list with both roles represented', () => {
    const e = DEFAULT_VENDOR_REGISTRY.entities;
    expect(Array.isArray(e)).toBe(true);
    expect(e.some(x => x.is_manufacturer)).toBe(true);
    expect(e.some(x => x.is_vendor)).toBe(true);
    // Haas is both a manufacturer and a vendor.
    const haas = entityByName('Haas Automation');
    expect(haas.is_manufacturer && haas.is_vendor).toBe(true);
  });

  it('preserves the migrated manufacturer/vendor names', () => {
    expect(getManufacturerNames()).toEqual(expect.arrayContaining(['Helical Solutions', 'OSG', 'Harvey Tool']));
    expect(getVendorNames()).toEqual(expect.arrayContaining(['MSC Industrial', 'McMaster-Carr', 'Grainger']));
  });

  it('keeps the own-catalog-number flag', () => {
    expect(vendorHasOwnCatalogNumber('MSC Industrial')).toBe(true);
    expect(vendorHasOwnCatalogNumber('Helical Solutions')).toBe(false);
  });

  it('resolves ProShop unique ids back to names (resolveVendorName)', () => {
    expect(resolveVendorName('MSC1')).toBe('MSC Industrial');
    expect(resolveVendorName('msc1')).toBe('MSC Industrial'); // case-insensitive
    expect(resolveVendorName('Some Unknown Co')).toBe('Some Unknown Co'); // passthrough
  });

  it('merges alias variants into one canonical entity', () => {
    // "GARR" and "Helical" are aliases, not separate entities.
    expect(getManufacturerNames()).toContain('GARR Tool');
    expect(getManufacturerNames()).not.toContain('GARR');
    expect(getManufacturerNames()).not.toContain('Helical');
  });

  it('resolves aliases to the preferred name (resolveVendorName / entityByName)', () => {
    expect(resolveVendorName('GARR')).toBe('GARR Tool');
    expect(resolveVendorName('helical')).toBe('Helical Solutions'); // case-insensitive
    expect(entityByName('GARR').name).toBe('GARR Tool');
  });
});

describe('urlGenerators (patterns sourced from the registry)', () => {
  it('substitutes {edp} and {edp_lower}', () => {
    expect(generateManufacturerUrl('OSG', 'ABC')).toBe('https://osgtool.com/abc/');
    expect(generateManufacturerUrl('Harvey Tool', 'XY12')).toBe('https://www.harveytool.com/products/tool-details-xy12');
    expect(generateManufacturerUrl('Helical Solutions', 'H99')).toBe('https://www.helicaltool.com/products/tool-details-H99');
  });

  it('substitutes {vendor_num}', () => {
    expect(generateVendorUrl('MSC Industrial', '999')).toBe('https://www.mscdirect.com/product/details/999');
    expect(generateVendorUrl('McMaster-Carr', '91290A115')).toBe('https://www.mcmaster.com/91290A115/');
  });

  it('returns null when the entity or number is unknown/empty', () => {
    expect(generateManufacturerUrl('OSG', '')).toBe(null);
    expect(generateManufacturerUrl('Nonexistent Co', 'X')).toBe(null);
    expect(generateVendorUrl('Grainger', '123')).toBe(null); // no pattern for Grainger
  });

  it('capability checks reflect whether a pattern exists', () => {
    expect(manufacturerHasUrlGenerator('OSG')).toBe(true);
    expect(manufacturerHasUrlGenerator('Cleveland')).toBe(false);
    expect(vendorHasUrlGenerator('MSC Industrial')).toBe(true);
    expect(vendorHasUrlGenerator('Grainger')).toBe(false);
  });
});

describe('registry foreign key (store the id, render the name)', () => {
  // A tiny registry with a canonical name + alias and a renamed variant.
  const REG = {
    entities: [
      { id: 'e_hel', name: 'Helical Solutions', aliases: ['Helical'], is_manufacturer: true, is_vendor: false },
      { id: 'e_msc', name: 'MSC Industrial', aliases: [], proshop_id: 'MSC1', is_manufacturer: false, is_vendor: true },
    ],
  };
  const RENAMED = { entities: [{ ...REG.entities[0], name: 'Helical (renamed)' }, REG.entities[1]] };

  it('registryIdForName resolves canonical, alias, and ProShop id — null for free text', () => {
    expect(registryIdForName('Helical Solutions', REG)).toBe('e_hel');
    expect(registryIdForName('Helical', REG)).toBe('e_hel');        // alias
    expect(registryIdForName('MSC1', REG)).toBe('e_msc');           // ProShop id
    expect(registryIdForName('Some Random Shop', REG)).toBe(null);  // free text
    expect(registryIdForName('', REG)).toBe(null);
  });

  it('entityById returns the live record (null when dangling)', () => {
    expect(entityById('e_hel', REG).name).toBe('Helical Solutions');
    expect(entityById('gone', REG)).toBe(null);
  });

  it('syncPurchasingNames renders the CURRENT name from the id after a rename', () => {
    const purchasing = {
      manufacturers: [{ id: 'm1', registry_id: 'e_hel', name: 'Helical Solutions' }],
      vendors: [{ id: 'v1', manufacturer_id: 'm1', registry_id: 'e_msc', name: 'MSC Industrial' }],
    };
    const out = syncPurchasingNames(purchasing, RENAMED);
    expect(out.manufacturers[0].name).toBe('Helical (renamed)'); // follows the rename
    expect(out.manufacturers[0].registry_id).toBe('e_hel');      // id is stable
    expect(out.vendors[0].name).toBe('MSC Industrial');          // unchanged entity
  });

  it('adopts the id from a name-matched entry (existing name-only links become rename-proof)', () => {
    const purchasing = { manufacturers: [{ id: 'm1', name: 'Helical' }], vendors: [] }; // alias, no id
    const out = syncPurchasingNames(purchasing, REG);
    expect(out.manufacturers[0].registry_id).toBe('e_hel');
    expect(out.manufacturers[0].name).toBe('Helical Solutions'); // canonicalized
  });

  it('leaves genuinely free-text names untouched (no id)', () => {
    const purchasing = { manufacturers: [{ id: 'm1', name: 'Bob’s Custom Tools' }], vendors: [] };
    const out = syncPurchasingNames(purchasing, REG);
    expect(out).toBe(purchasing); // unchanged reference
    expect('registry_id' in out.manufacturers[0]).toBe(false);
  });

  it('tolerates a dangling id — keeps the stored name', () => {
    const purchasing = { manufacturers: [{ id: 'm1', registry_id: 'deleted', name: 'Old Vendor' }], vendors: [] };
    const out = syncPurchasingNames(purchasing, REG);
    expect(out.manufacturers[0].name).toBe('Old Vendor');
  });

  it('backfillPurchasingRegistryIds walks tools, skips those without purchasing', () => {
    const tools = [
      { id: 't1', purchasing: { manufacturers: [{ id: 'm1', name: 'Helical' }], vendors: [] } },
      { id: 't2' },
    ];
    const out = backfillPurchasingRegistryIds(tools, REG);
    expect(out[0].purchasing.manufacturers[0].registry_id).toBe('e_hel');
    expect(out[1]).toBe(tools[1]); // untouched
  });
});
