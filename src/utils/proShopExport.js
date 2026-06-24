import { buildProShopCSV, PS_MAIN_COLS, buildBrandRows } from '../../tool-extractor.tsx';
import { toolToExtractor } from '../schema/toolSchema.js';
import { downloadCSV } from '../../tool-extractor.tsx';

function csvCell(v) {
  const s = String(v === null || v === undefined ? '' : v);
  return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportSingleTool(tool) {
  const extFmt = toolToExtractor(tool);
  const csv = buildProShopCSV(extFmt);
  downloadCSV(csv, `${tool.tool_id || tool.id}_proshop.csv`);
}

// Purchasing/Approved-Brand columns — one CSV row per `tool.purchasing[]` entry,
// matching ProShop's real multi-row export. Geometry/spec columns are populated
// only on each tool's first row.
const PURCHASING_COLS = ['approvedBrand', 'vendor', 'vendorToolId', 'cost', 'leadTime'];

export function exportFullLibrary(tools) {
  if (tools.length === 0) return;

  const headerCols = [...PS_MAIN_COLS.map(([h]) => h), ...PURCHASING_COLS];
  const rows = [headerCols.map(csvCell).join(',')];

  for (const tool of tools) {
    const extFmt = toolToExtractor(tool);
    const brandRows = buildBrandRows(extFmt);
    const mainVals = PS_MAIN_COLS.map(([, fn]) => fn(extFmt));
    const blankMain = mainVals.map(() => '');
    const toolRows = brandRows.length ? brandRows : [{}];
    toolRows.forEach((b, i) => {
      const main = i === 0 ? mainVals : blankMain;
      rows.push([...main, b.approvedBrand || '', b.vendor || '', b.edp || '', b.cost || '', b.leadTime || ''].map(csvCell).join(','));
    });
  }

  downloadCSV(rows.join('\n'), 'proshop_library_export.csv');
}
