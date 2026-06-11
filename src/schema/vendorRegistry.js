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
  "Online Metals","Orange Vise Company LLC","Pierson Workholding","Precision Finishing",
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
