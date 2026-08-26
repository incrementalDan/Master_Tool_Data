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
  syncPurchasingFromRegistry,
  learnUrlPattern,
  applyUrlPattern,
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

  it('syncPurchasingFromRegistry renders the CURRENT name from the id after a rename', () => {
    const purchasing = {
      manufacturers: [{ id: 'm1', registry_id: 'e_hel', name: 'Helical Solutions' }],
      vendors: [{ id: 'v1', manufacturer_id: 'm1', registry_id: 'e_msc', name: 'MSC Industrial' }],
    };
    const out = syncPurchasingFromRegistry(purchasing, RENAMED);
    expect(out.manufacturers[0].name).toBe('Helical (renamed)'); // follows the rename
    expect(out.manufacturers[0].registry_id).toBe('e_hel');      // id is stable
    expect(out.vendors[0].name).toBe('MSC Industrial');          // unchanged entity
  });

  it('adopts the id from a name-matched entry (existing name-only links become rename-proof)', () => {
    const purchasing = { manufacturers: [{ id: 'm1', name: 'Helical' }], vendors: [] }; // alias, no id
    const out = syncPurchasingFromRegistry(purchasing, REG);
    expect(out.manufacturers[0].registry_id).toBe('e_hel');
    expect(out.manufacturers[0].name).toBe('Helical Solutions'); // canonicalized
  });

  it('leaves genuinely free-text names untouched (no id)', () => {
    const purchasing = { manufacturers: [{ id: 'm1', name: 'Bob’s Custom Tools' }], vendors: [] };
    const out = syncPurchasingFromRegistry(purchasing, REG);
    expect(out).toBe(purchasing); // unchanged reference
    expect('registry_id' in out.manufacturers[0]).toBe(false);
  });

  it('tolerates a dangling id — keeps the stored name', () => {
    const purchasing = { manufacturers: [{ id: 'm1', registry_id: 'deleted', name: 'Old Vendor' }], vendors: [] };
    const out = syncPurchasingFromRegistry(purchasing, REG);
    expect(out.manufacturers[0].name).toBe('Old Vendor');
  });

  // ── URLs: the registry's PATTERN is the source of truth ──────────────────
  // The whole reason the pattern lives centrally is that it can be corrected
  // once for every tool. A URL pasted into a record is a static value nothing
  // can mass-update, so it must not be allowed to win where a pattern exists.
  const URLREG = {
    entities: [
      { id: 'e_hel', name: 'Helical Solutions', aliases: ['Helical'], is_manufacturer: true,
        edp_url_pattern: 'https://helical.example/tool-{edp}' },
      { id: 'e_msc', name: 'MSC Industrial', aliases: [], is_vendor: true,
        vendor_num_url_pattern: 'https://msc.example/p/{vendor_num}' },
      { id: 'e_bob', name: 'Bob Tools', aliases: [], is_manufacturer: true },   // no pattern
    ],
  };

  it('OVERWRITES a scanned URL where the entity has a pattern', () => {
    const purchasing = {
      manufacturers: [{ id: 'm1', registry_id: 'e_hel', name: 'Helical Solutions', edp: '12345',
        edp_url: 'https://scanned.example/whatever' }],
      vendors: [{ id: 'v1', registry_id: 'e_msc', name: 'MSC Industrial', vendor_num: '999',
        vendor_num_url: 'https://scanned.example/other' }],
    };
    const out = syncPurchasingFromRegistry(purchasing, URLREG);
    expect(out.manufacturers[0].edp_url).toBe('https://helical.example/tool-12345');
    expect(out.vendors[0].vendor_num_url).toBe('https://msc.example/p/999');
  });

  it('one edit to the pattern moves every tool — that is the point', () => {
    const purchasing = {
      manufacturers: [{ id: 'm1', registry_id: 'e_hel', name: 'Helical Solutions', edp: '12345' }],
      vendors: [],
    };
    const first = syncPurchasingFromRegistry(purchasing, URLREG);
    const MOVED = { entities: URLREG.entities.map(e =>
      e.id === 'e_hel' ? { ...e, edp_url_pattern: 'https://helical.example/catalog/{edp_lower}' } : e) };
    const after = syncPurchasingFromRegistry(first, MOVED);
    expect(after.manufacturers[0].edp_url).toBe('https://helical.example/catalog/12345');
  });

  it('KEEPS a stored URL where the entity has no pattern — nothing to derive', () => {
    const purchasing = {
      manufacturers: [{ id: 'm1', registry_id: 'e_bob', name: 'Bob Tools', edp: 'X-1',
        edp_url: 'https://bob.example/x1' }],
      vendors: [],
    };
    const out = syncPurchasingFromRegistry(purchasing, URLREG);
    expect(out).toBe(purchasing);                                   // unchanged reference
    expect(out.manufacturers[0].edp_url).toBe('https://bob.example/x1');
  });

  it('derives nothing when there is no part number to substitute', () => {
    const purchasing = {
      manufacturers: [{ id: 'm1', registry_id: 'e_hel', name: 'Helical Solutions', edp: '',
        edp_url: 'https://scanned.example/whatever' }],
      vendors: [],
    };
    const out = syncPurchasingFromRegistry(purchasing, URLREG);
    expect(out.manufacturers[0].edp_url).toBe('https://scanned.example/whatever');
  });

  it('is idempotent — a second run has nothing to do', () => {
    const purchasing = {
      manufacturers: [{ id: 'm1', registry_id: 'e_hel', name: 'Helical Solutions', edp: '12345' }],
      vendors: [{ id: 'v1', registry_id: 'e_msc', name: 'MSC Industrial', vendor_num: '999' }],
    };
    const once = syncPurchasingFromRegistry(purchasing, URLREG);
    expect(syncPurchasingFromRegistry(once, URLREG)).toBe(once);    // same reference
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

// ─────────────────────────────────────────────────────────────────────────────
// Learning a pattern from one real product link. The registry can only
// mass-update a URL whose SHAPE it knows, so a manufacturer with no pattern is a
// permanent blind spot — but a scanned sheet usually hands us a link and the
// part number it points at, which is the shape.
describe('learnUrlPattern', () => {
  // Every pattern the app ships, re-derived from one link it would produce.
  const SEEDED = [
    ['https://www.harveytool.com/products/tool-details-xy12', 'XY12', 'edp_lower'],
    ['https://www.helicaltool.com/products/tool-details-H99', 'H99', 'edp'],
    ['https://www.garrtool.com/product-details/?EDP=12345', '12345', 'edp'],
    ['https://osgtool.com/abc/', 'ABC', 'edp_lower'],
    ['https://www.haastooling.com/p/12345', '12345', 'edp'],
  ];

  it('re-derives every pattern the app already ships', () => {
    for (const [url, num, token] of SEEDED) {
      const got = learnUrlPattern(url, num, 'edp');
      expect(got, url).not.toBeNull();
      expect(got.token).toBe(token);
      // The proof that matters: it rebuilds the link it was taught from.
      expect(applyUrlPattern(got.pattern, { edp: num, edp_lower: num.toLowerCase() })).toBe(url);
    }
  });

  it('learns a vendor catalog pattern (exact case only)', () => {
    const got = learnUrlPattern('https://www.mcmaster.com/91290A115/', '91290A115', 'vendor_num');
    expect(got.pattern).toBe('https://www.mcmaster.com/{vendor_num}/');
    // No lowercase vendor token exists, so a case-shifted link is NOT learned.
    expect(learnUrlPattern('https://x.example/91290a115', '91290A115', 'vendor_num')).toBeNull();
  });

  // ⚠️ Each of these would produce a pattern that silently overwrites the right
  // link on every tool of that make. Skipping is the correct answer.
  it('refuses the ambiguous and the un-shaped', () => {
    // The number appears twice — which one is the id?
    expect(learnUrlPattern('https://x.example/12345/p/12345', '12345')).toBeNull();
    // A coincidental substring of a longer id, not the part number.
    expect(learnUrlPattern('https://x.example/p/912345678', '12345')).toBeNull();
    // The number isn't in the link at all.
    expect(learnUrlPattern('https://x.example/p/other', '12345')).toBeNull();
    // "Lots of embedded data" — a session/tracking blob we can't reverse.
    expect(learnUrlPattern('https://x.example/p/12345?sid=A1B2&node=99', '12345')).toBeNull();
    // Not a link.
    expect(learnUrlPattern('call for pricing', '12345')).toBeNull();
    // Too short to be distinctive.
    expect(learnUrlPattern('https://x.example/p/7', '7')).toBeNull();
    expect(learnUrlPattern('', '')).toBeNull();
  });

  it('keeps a query string that carries only the part number', () => {
    const got = learnUrlPattern('https://x.example/details?EDP=12345', '12345');
    expect(got.pattern).toBe('https://x.example/details?EDP={edp}');
  });

  it('round-trips: a learned pattern feeds syncPurchasingFromRegistry', () => {
    const { pattern } = learnUrlPattern('https://bob.example/tool-X1', 'X1');
    const reg = { entities: [{ id: 'e_bob', name: 'Bob Tools', aliases: [], is_manufacturer: true, edp_url_pattern: pattern }] };
    const out = syncPurchasingFromRegistry(
      { manufacturers: [{ id: 'm1', registry_id: 'e_bob', name: 'Bob Tools', edp: 'X2' }], vendors: [] }, reg);
    expect(out.manufacturers[0].edp_url).toBe('https://bob.example/tool-X2');
  });
});
