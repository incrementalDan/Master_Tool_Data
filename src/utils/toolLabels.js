// Tool tag label rows — turning stored Sequence Detail rows into the field set
// the label renderer prints.
//
// ⚠️ EVERY FIELD IS THE CSV'S OWN VALUE — EXCEPT LOCATION. A label is what the
// operator sets the machine up from: a holder or OOH the program was never
// posted with is a crash, so those are the post's own strings.
//
// Location is the one deliberate exception (see resolveRowLocation): the CSV's
// LC comes from Fusion's vendor field, which the app updates lazily, so a
// posted file routinely names a bin the shop has since changed. The label's
// whole job is to send someone to the right drawer, so it carries the app's
// location when the app has one. The CSV's value is still what's stored.
//
// DEDUPE: never print two labels that are 100% identical, and treat ANY
// difference as a separate label. The consequence that matters is deliberate —
// the same tool in two pockets of one program (T03 and T04 both A-35) prints
// TWO labels, because the T# differs and they are two physical setups. Across a
// part, the same pocket running the same assembly in OP50 and OP60 is ONE
// label, because nothing about it differs.

import { resolveRowLocation } from './sequenceImport.js';

// The label carries the T# only — H and D are on the setup sheet, not the tag.
export function labelKey(f) {
  return [f.TCode, f.ToolNo, f.Holder, f.OOH, f.Description, f.Location, f.PartNumber, f.RTA]
    .map(v => String(v ?? '').trim())
    .join('');
}

// One row → the renderer's field names (kept as the extension named them, so
// the ported markup needs no translation layer).
export function labelFieldsOf(row, part, toolsById) {
  return {
    PartNumber: part?.part_number || '',
    TCode: row.t || '',
    ToolNo: row.tool_id || '',
    Description: row.description || '',
    Holder: row.holder || '',
    OOH: row.ooh || '',
    Location: resolveRowLocation(row, toolsById).value,
    // RTA: the FIELD stays on the label, the value is deliberately dropped —
    // it isn't assigned at this stage and a stale one is worse than a blank.
    RTA: '',
  };
}

// Deduped labels for a set of rows, ordered by OP then pocket so a printed
// stack matches the order the operator loads the machine.
export function labelRows(rows, part, toolsById) {
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const fields = labelFieldsOf(row, part, toolsById);
    const key = labelKey(fields);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fields);
  }
  return out;
}
