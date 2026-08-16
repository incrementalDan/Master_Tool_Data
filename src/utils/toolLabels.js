// Tool tag label rows — turning stored Sequence Detail rows into the field set
// the label renderer prints.
//
// ⚠️ EVERY FIELD IS THE CSV'S OWN VALUE. A label is what the operator sets the
// machine up from: a holder or OOH the program was never posted with is a
// crash. Nothing here reads the tool library.
//
// DEDUPE: never print two labels that are 100% identical, and treat ANY
// difference as a separate label. The consequence that matters is deliberate —
// the same tool in two pockets of one program (T03 and T04 both A-35) prints
// TWO labels, because the T# differs and they are two physical setups. Across a
// job, the same pocket running the same assembly in OP50 and OP60 is ONE label,
// because nothing about it differs.

// The label carries the T# only — H and D are on the setup sheet, not the tag.
export function labelKey(f) {
  return [f.TCode, f.ToolNo, f.Holder, f.OOH, f.Description, f.Location, f.PartNumber, f.RTA]
    .map(v => String(v ?? '').trim())
    .join('');
}

// One row → the renderer's field names (kept as the extension named them, so
// the ported markup needs no translation layer).
export function labelFieldsOf(row, part) {
  return {
    PartNumber: part?.part_number || '',
    TCode: row.t || '',
    ToolNo: row.tool_id || '',
    Description: row.description || '',
    Holder: row.holder || '',
    OOH: row.ooh || '',
    Location: row.lc || '',
    // RTA: the FIELD stays on the label, the value is deliberately dropped —
    // it isn't assigned at this stage and a stale one is worse than a blank.
    RTA: '',
  };
}

// Deduped labels for a set of rows, ordered by OP then pocket so a printed
// stack matches the order the operator loads the machine.
export function jobLabelRows(rows, part) {
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const fields = labelFieldsOf(row, part);
    const key = labelKey(fields);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fields);
  }
  return out;
}

// A single program's labels (same rule; the rows are already one program's).
export function programLabelRows(detail, part) {
  return jobLabelRows(detail?.tools || [], part);
}
