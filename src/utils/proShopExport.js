import { buildProShopCSV, buildProShopRows, PS_MAIN_COLS, PURCHASING_COLS } from '../../tool-extractor.tsx';
import { toolToExtractor } from '../schema/toolSchema.js';
import { exportsToProShop } from './toolStatus.js';
import { downloadCSV } from '../../tool-extractor.tsx';

// TODO (Assembly ID System — ProShop RTA mode): when assembly_id_system.mode is
// 'proshop_rta', export/import each assembly's RTA# (asm_number) to/from a ProShop
// column. The ProShop CSV column + per-assembly row shape is TBD — wire it here
// and in ImportFlow.matchProShopToTools once the format is confirmed.

function csvCell(v) {
  const s = String(v === null || v === undefined ? '' : v);
  return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Returns false when there is nothing to export — a BETA tool is deliberately
// kept out of ProShop entirely (see utils/toolStatus.js), so downloading a
// header-only file would claim a job was done that wasn't. The caller says so.
export function exportSingleTool(tool) {
  if (!exportsToProShop(tool)) return false;
  const extFmt = toolToExtractor(tool);
  const csv = buildProShopCSV(extFmt);
  downloadCSV(csv, `${tool.tool_id || tool.id}_proshop.csv`);
  return true;
}

// One CSV row per purchasing/Approved-Brand entry, matching ProShop's real
// multi-row export — the row SHAPE (which columns a continuation row repeats,
// and that every row carries the Tool #) lives in buildProShopRows so the
// single-tool and full-library exports cannot drift apart.
export function exportFullLibrary(tools) {
  if (tools.length === 0) return;

  const headerCols = [...PS_MAIN_COLS.map(([h]) => h), ...PURCHASING_COLS];
  const rows = [headerCols.map(csvCell).join(',')];

  // buildProShopRows returns NO rows for a beta tool — it is skipped by
  // construction rather than by a filter here, so the single-tool and
  // full-library exports cannot disagree about who is exported.
  let skipped = 0;
  for (const tool of tools) {
    const toolRows = buildProShopRows(toolToExtractor(tool));
    if (toolRows.length === 0) { skipped += 1; continue; }
    for (const row of toolRows) rows.push(row.map(csvCell).join(','));
  }

  downloadCSV(rows.join('\n'), 'proshop_library_export.csv');
  return { skipped };
}

// ⚠️ A bulk export must never quietly do LESS than it claims. Beta tools are
// skipped by design, so the count that gets reported has to say so — "Exported
// 245 tools" when 3 were left out is a true-sounding number that isn't true.
export function proShopExportMessage(total, skipped) {
  const n = total - skipped;
  const base = `Exported ${n} tool${n === 1 ? '' : 's'} to ProShop CSV`;
  return skipped
    ? `${base} — ${skipped} beta tool${skipped === 1 ? '' : 's'} skipped (not exported to ProShop)`
    : base;
}
