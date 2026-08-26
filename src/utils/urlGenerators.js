// urlGenerators.js
//
// Builds product URLs for a manufacturer's EDP#/MFG# or a vendor's catalog
// number. The URL *patterns* now live in the vendor registry
// (vendor_registry.json on Drive, with DEFAULT_VENDOR_REGISTRY as the seed) —
// this module only resolves the entity and substitutes the tokens.
//
// Supported tokens: {edp}, {edp_lower}, {vendor_num}.
//
// ⚠️ A generated URL is AUTHORITATIVE, not advisory: where an entity has a
// pattern, the composed URL wins over whatever is stored on the tool — so
// editing the one pattern in /vendors corrects every tool at once. A URL pasted
// into a record is static and can never be mass-updated, so it only stands where
// the registry has no pattern to compose from. The FK resolver that applies this
// on read and on save is syncPurchasingFromRegistry (schema/vendorRegistry.js);
// these helpers are the same composition for a single name + number.

import { entityByName, applyUrlPattern as applyPattern } from '../schema/vendorRegistry.js';

/**
 * Generate a URL for a manufacturer's EDP#/MFG#.
 * Returns null if the manufacturer (or its pattern) is unknown or the number is empty.
 */
export function generateManufacturerUrl(manufacturerName, edp) {
  if (!manufacturerName || !edp) return null;
  const pattern = entityByName(manufacturerName)?.edp_url_pattern;
  if (!pattern) return null;
  const e = edp.trim();
  return applyPattern(pattern, { edp: e, edp_lower: e.toLowerCase() }) || null;
}

/**
 * Generate a URL for a vendor's catalog number.
 * Returns null if the vendor (or its pattern) is unknown or the number is empty.
 */
export function generateVendorUrl(vendorName, vendorNum) {
  if (!vendorName || !vendorNum) return null;
  const pattern = entityByName(vendorName)?.vendor_num_url_pattern;
  if (!pattern) return null;
  return applyPattern(pattern, { vendor_num: vendorNum.trim() }) || null;
}

/** True if the manufacturer has a known EDP URL pattern. */
export function manufacturerHasUrlGenerator(manufacturerName) {
  return !!entityByName(manufacturerName)?.edp_url_pattern;
}

/** True if the vendor has a known vendor-number URL pattern. */
export function vendorHasUrlGenerator(vendorName) {
  return !!entityByName(vendorName)?.vendor_num_url_pattern;
}
