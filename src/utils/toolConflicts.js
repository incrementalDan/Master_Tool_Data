// "Informed, not blocked" conflict tracking. When a logical tool's Fusion
// instances / same-product-id entries disagree on a shared value (e.g. flute
// length 0.7 vs 0.75) or carry different product IDs under one tracking ID, the
// difference is FLAGGED — never blocked. The tool still comes in fully merged
// (the primary/ProShop value wins); the disagreement rides along as a conflict
// record so the user can power through setup and resolve it later on the tool
// page, when they actually go to use that tool. See CLAUDE.md → "Informed, not
// blocked" conflict workflow.
//
// A conflict is NEVER auto-cleared: a later ProShop import may overwrite the
// value, but the badge stays until the user explicitly clears it on the tool page.
//
// Record shapes (persisted in tool_metadata.json under `conflicts`):
//   field:       { id, type:'field', field, values:[kept, other], detected_at }
//   product_id:  { id, type:'product_id', values:[id, id, …], detected_at }
import { generateId } from '../schema/identity.js';

// Merge freshly-detected runtime conflicts into the tool's already-persisted set.
// Deduped so a conflict isn't re-added on every load (field conflicts by field
// name; the product-id conflict is singular per tool). Existing records — with
// their id, detected_at, and not-yet-resolved state — are preserved untouched;
// only a genuinely new disagreement is appended.
export function mergeToolConflicts(existing = [], { combineConflicts = [], productIdConflict = null } = {}) {
  const out = [...(existing || [])];
  const hasField = (f) => out.some(c => c.type === 'field' && c.field === f);
  for (const c of (combineConflicts || [])) {
    if (!c?.field || hasField(c.field)) continue;
    out.push({
      id: generateId(),
      type: 'field',
      field: c.field,
      values: Array.isArray(c.values) ? c.values : [],
      detected_at: new Date().toISOString(),
    });
  }
  if (productIdConflict?.length && !out.some(c => c.type === 'product_id')) {
    out.push({
      id: generateId(),
      type: 'product_id',
      values: productIdConflict,
      detected_at: new Date().toISOString(),
    });
  }
  return out;
}

// Remove one conflict by id — the tool-page "resolve / clear" action.
export function clearToolConflict(conflicts = [], conflictId) {
  return (conflicts || []).filter(c => c.id !== conflictId);
}

// The conflicts to DISPLAY for a tool: the persisted set unioned with any
// runtime-detected ones not yet persisted (a freshly combined tool at load,
// before its next save writes them through). Deduped via mergeToolConflicts.
export function displayConflicts(tool) {
  if (!tool) return [];
  return mergeToolConflicts(tool.conflicts || [], {
    combineConflicts: tool._combineConflicts || [],
    productIdConflict: tool._productIdConflict || null,
  });
}

// Count of unresolved conflicts on a tool (for the library-card badge).
export function conflictCount(tool) {
  return displayConflicts(tool).length;
}
