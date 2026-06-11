// ─── MANUFACTURER / APPROVED BRAND LIST ──────────────────────────────────────
export const MANUFACTURER_LIST = [
  // Tool manufacturers — from MSC approved brand list + existing suppliers
  "Accupro","Cleveland","Emuge","HAIMER","Harvey Tool","Helical Solutions",
  "Hertel","Ingersoll Cutting Tools","Internal Tool","Iscar","Kennametal",
  "Keo","LMT","M.A. Ford","Melin Tool","Micro 100","Mitsubishi","OSG",
  "RobbJack","SGS","Sandvik Coromant","Seco","Titan USA","Tungaloy",
  "Value Collection","Widia","YG-1","Guhring",
  // Additional house brands / specialty
  "Fraisa USA","Haas Automation","Lakeshore Carbide","Liberty Tool Co",
].sort();

// ─── VENDOR / DISTRIBUTOR LIST ────────────────────────────────────────────────
export const VENDOR_LIST = [
  "Adion Systems","ALMCO","B&B Dynamic Machining","Boedeker Plastics, Inc.",
  "Butler Bros Supply Division","Camden Tool Inc","Castle Metals","CMW Tech",
  "Copper and Brass Sales","Evans Heat Treating","Finishing Innovations LLC",
  "Hadco Metal Trading","Hard Chrome Specialists, Inc.",
  "Hillock Anodizing","Industraplate","Jones Kinden","K&L Plating Company",
  "Laser Source","Liberty Manufacturing",
  "McMaster-Carr","Metropolitan Flag & Banner Co","MSC Industrial","NexGenSolutions",
  "Online Metals","Orange Vise Company LLC","Penn Stainless Products",
  "Pennsylvania Steel Company","Pierson Workholding","Precision Finishing",
  "PTSolutions","SK Industrial","Vibrant Finish LLC","Yamazen Inc","Yarde Metals",
];

// Vendors that assign their own catalog/stock numbers (distinct from the
// manufacturer's part number / EDP#). For these, the Purchasing UI shows a
// "Vendor #" field by default.
export const VENDORS_WITH_OWN_NUMBERS = new Set([
  'MSC Industrial', 'Grainger', 'McMaster-Carr', 'Zoro Tools', 'Travers Tool', 'Fastenal',
]);

export function vendorHasOwnCatalogNumber(name) {
  return VENDORS_WITH_OWN_NUMBERS.has(name);
}

// ─── PROSHOP CONTACT UNIQUE ID MAP ────────────────────────────────────────────
// ProShop's CSV export writes "Approved Brand" and "Vendor" as the contact's
// "Unique Id" (e.g. "MSC1"), not the company name — from ProShop's own
// "Show All Contacts" export. resolveVendorName() maps those IDs back to the
// names in MANUFACTURER_LIST / VENDOR_LIST above. Keyed uppercase.
export const VENDOR_ID_MAP = {
  ADI1: 'Adion Systems',
  ALM1: 'ALMCO',
  BBD1: 'B&B Dynamic Machining',
  BOE1: 'Boedeker Plastics, Inc.',
  BUT1: 'Butler Bros Supply Division',
  CAM1: 'Camden Tool Inc',
  CAS1: 'Castle Metals',
  CMW1: 'CMW Tech',
  COP1: 'Copper and Brass Sales',
  EVA1: 'Evans Heat Treating',
  FIN1: 'Finishing Innovations LLC',
  FRA1: 'Fraisa USA',
  HAA1: 'Haas Automation',
  HAD2: 'Hadco Metal Trading',
  HAR1: 'Hard Chrome Specialists, Inc.',
  HIL1: 'Hillock Anodizing',
  IND1: 'Industraplate',
  JON1: 'Jones Kinden',
  KLP1: 'K&L Plating Company',
  LAK1: 'Lakeshore Carbide',
  LAS1: 'Laser Source',
  LIB1: 'Liberty Tool Co',
  LIB2: 'Liberty Manufacturing',
  MCM1: 'McMaster-Carr',
  MET1: 'Metropolitan Flag & Banner Co',
  MSC1: 'MSC Industrial',
  NEX1: 'NexGenSolutions',
  ONL1: 'Online Metals',
  ORA1: 'Orange Vise Company LLC',
  PEN2: 'Penn Stainless Products',
  PEN3: 'Pennsylvania Steel Company',
  PIE1: 'Pierson Workholding',
  PRE1: 'Precision Finishing',
  PTS1: 'PTSolutions',
  SKI1: 'SK Industrial',
  VIB1: 'Vibrant Finish LLC',
  YAM1: 'Yamazen Inc',
  YAR1: 'Yarde Metals',
};

// Resolves a ProShop "Approved Brand" / "Vendor" cell to a company name —
// the cell may hold either the contact's Unique Id (e.g. "MSC1") or the
// company name itself, depending on the ProShop export. Unknown values
// (including blank) pass through unchanged.
export function resolveVendorName(value) {
  if (!value) return value;
  const trimmed = value.trim();
  return VENDOR_ID_MAP[trimmed.toUpperCase()] || trimmed;
}
