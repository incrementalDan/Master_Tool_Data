import { describe, it, expect } from 'vitest';
import {
  DEFAULT_VENDOR_REGISTRY,
  getManufacturerNames,
  getVendorNames,
  vendorHasOwnCatalogNumber,
  resolveVendorName,
  entityByName,
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
