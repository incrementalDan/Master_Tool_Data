// urlGenerators.js
//
// Maps known manufacturer and vendor names to URL generation functions.
// Each function takes a product number (EDP#, MFG#, or Vendor#) and returns
// a URL string, or null if the number is empty/invalid.
//
// Generated URLs are stored in the data (not computed on the fly) so users
// can override them manually. The generator is advisory, not authoritative.
//
// To add a new manufacturer or vendor: add an entry below following the same
// pattern. Keys are matched case-insensitively and trimmed. Names are kept in
// sync with MANUFACTURER_LIST / VENDOR_LIST in vendorRegistry.js, plus a few
// shorthand aliases that are harmless if unused.

export const MANUFACTURER_URL_GENERATORS = {

  // Harvey Tool and Helical Solutions (same parent company, same URL pattern)
  'Harvey Tool': (edp) =>
    edp ? `https://www.harveytool.com/products/tool-details-${edp.toLowerCase()}` : null,

  'Helical Solutions': (edp) =>
    edp ? `https://www.helicaltool.com/products/tool-details-${edp}` : null,
  'Helical': (edp) =>
    edp ? `https://www.helicaltool.com/products/tool-details-${edp}` : null,

  // Micro 100 — same pattern as Harvey/Helical
  'Micro 100': (edp) =>
    edp ? `https://www.micro100.com/products/tool-details-${edp.toLowerCase()}` : null,
  'Micro-100': (edp) =>
    edp ? `https://www.micro100.com/products/tool-details-${edp.toLowerCase()}` : null,
  'Micro100': (edp) =>
    edp ? `https://www.micro100.com/products/tool-details-${edp.toLowerCase()}` : null,

  // GARR Tool — uses query parameter
  'GARR Tool': (edp) =>
    edp ? `https://www.garrtool.com/product-details/?EDP=${edp}` : null,
  'GARR': (edp) =>
    edp ? `https://www.garrtool.com/product-details/?EDP=${edp}` : null,

  // OSG — lowercase slug
  'OSG': (edp) =>
    edp ? `https://osgtool.com/${edp.toLowerCase()}/` : null,

  // Haas Automation — also acts as both manufacturer and vendor for tooling
  'Haas Automation': (edp) =>
    edp ? `https://www.haastooling.com/p/${edp}` : null,
  'Haas Tooling': (edp) =>
    edp ? `https://www.haastooling.com/p/${edp}` : null,

};

export const VENDOR_URL_GENERATORS = {

  // MSC Industrial — vendor number goes directly in path
  'MSC Industrial': (vendorNum) =>
    vendorNum ? `https://www.mscdirect.com/product/details/${vendorNum}` : null,
  'MSC': (vendorNum) =>
    vendorNum ? `https://www.mscdirect.com/product/details/${vendorNum}` : null,

  // McMaster-Carr — vendor number with trailing slash
  'McMaster-Carr': (vendorNum) =>
    vendorNum ? `https://www.mcmaster.com/${vendorNum}/` : null,
  'McMaster': (vendorNum) =>
    vendorNum ? `https://www.mcmaster.com/${vendorNum}/` : null,

  // Haas Tooling / Haas Automation as vendor (same URL as manufacturer)
  'Haas Tooling': (vendorNum) =>
    vendorNum ? `https://www.haastooling.com/p/${vendorNum}` : null,
  'Haas Automation': (vendorNum) =>
    vendorNum ? `https://www.haastooling.com/p/${vendorNum}` : null,

  // Note: Grainger, Zoro, Fastenal, Butler Brothers URLs include product
  // names and cannot be reliably auto-generated from a vendor number alone.
  // Leave blank — user adds manually.

};

/**
 * Generate a URL for a manufacturer's EDP# or MFG#.
 * Returns null if the manufacturer is unknown or number is empty.
 */
export function generateManufacturerUrl(manufacturerName, edp) {
  if (!manufacturerName || !edp) return null;
  const key = Object.keys(MANUFACTURER_URL_GENERATORS).find(
    k => k.toLowerCase() === manufacturerName.toLowerCase().trim()
  );
  if (!key) return null;
  return MANUFACTURER_URL_GENERATORS[key](edp.trim()) || null;
}

/**
 * Generate a URL for a vendor's catalog number.
 * Returns null if the vendor is unknown or number is empty.
 */
export function generateVendorUrl(vendorName, vendorNum) {
  if (!vendorName || !vendorNum) return null;
  const key = Object.keys(VENDOR_URL_GENERATORS).find(
    k => k.toLowerCase() === vendorName.toLowerCase().trim()
  );
  if (!key) return null;
  return VENDOR_URL_GENERATORS[key](vendorNum.trim()) || null;
}

/**
 * Check if a manufacturer has a known URL generator.
 */
export function manufacturerHasUrlGenerator(manufacturerName) {
  return Object.keys(MANUFACTURER_URL_GENERATORS).some(
    k => k.toLowerCase() === manufacturerName?.toLowerCase().trim()
  );
}

/**
 * Check if a vendor has a known URL generator.
 */
export function vendorHasUrlGenerator(vendorName) {
  return Object.keys(VENDOR_URL_GENERATORS).some(
    k => k.toLowerCase() === vendorName?.toLowerCase().trim()
  );
}
