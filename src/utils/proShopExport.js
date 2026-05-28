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
  downloadCSV(csv, `${tool.proshot_id || tool.product_id || tool.id}_proshop.csv`);
}

export function exportFullLibrary(tools) {
  if (tools.length === 0) return;

  const headerCols = [...PS_MAIN_COLS.map(([h]) => h), 'approvedBrand', 'EDP#', 'cost', 'vendor'];
  const rows = [headerCols.map(csvCell).join(',')];

  for (const tool of tools) {
    const extFmt = toolToExtractor(tool);
    const brandRows = buildBrandRows(extFmt);
    const b1 = brandRows[0] || {};
    const b2 = brandRows[1] || {};
    const rowData = [
      ...PS_MAIN_COLS.map(([, fn]) => fn(extFmt)),
      b1.approvedBrand || '', b1.edp || '', b1.cost || '', b1.vendor || '',
    ];
    rows.push(rowData.map(csvCell).join(','));
    if (b2.approvedBrand) {
      const row2 = [
        ...PS_MAIN_COLS.map(([, fn]) => fn(extFmt)),
        b2.approvedBrand, b2.edp || '', b2.cost || '', b2.vendor || '',
      ];
      rows.push(row2.map(csvCell).join(','));
    }
  }

  downloadCSV(rows.join('\n'), 'proshop_library_export.csv');
}
