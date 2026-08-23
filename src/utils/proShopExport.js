import { buildProShopCSV, buildProShopRows, PS_MAIN_COLS, PURCHASING_COLS } from '../../tool-extractor.tsx';
import { toolToExtractor } from '../schema/toolSchema.js';
import { downloadCSV } from '../../tool-extractor.tsx';

// TODO (Assembly ID System — ProShop RTA mode): when assembly_id_system.mode is
// 'proshop_rta', export/import each assembly's RTA# (asm_number) to/from a ProShop
// column. The ProShop CSV column + per-assembly row shape is TBD — wire it here
// and in ImportFlow.matchProShopToTools once the format is confirmed.

function csvCell(v) {
  const s = String(v === null || v === undefined ? '' : v);
  return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportSingleTool(tool) {
  const extFmt = toolToExtractor(tool);
  const csv = buildProShopCSV(extFmt);
  downloadCSV(csv, `${tool.tool_id || tool.id}_proshop.csv`);
}

// One CSV row per purchasing/Approved-Brand entry, matching ProShop's real
// multi-row export — the row SHAPE (which columns a continuation row repeats,
// and that every row carries the Tool #) lives in buildProShopRows so the
// single-tool and full-library exports cannot drift apart.
export function exportFullLibrary(tools) {
  if (tools.length === 0) return;

  const headerCols = [...PS_MAIN_COLS.map(([h]) => h), ...PURCHASING_COLS];
  const rows = [headerCols.map(csvCell).join(',')];

  for (const tool of tools) {
    for (const row of buildProShopRows(toolToExtractor(tool))) {
      rows.push(row.map(csvCell).join(','));
    }
  }

  downloadCSV(rows.join('\n'), 'proshop_library_export.csv');
}
