// The app's ONE CSV tokenizer. Shared by every CSV reader (the program-list
// import, the Sequence Detail import) so quoting behavior can't drift between
// them — a second hand-rolled parser is how one importer ends up accepting a
// file the other rejects.
//
// Full-file scan that honors quotes ACROSS newlines. A quoted field may contain
// commas, escaped quotes (""), AND embedded line breaks — real exports do this
// (this shop's program-list export wraps the "Program #" header cell with a
// leading newline: `"\nProgram #"`). Splitting on \n before parsing quotes
// would shatter that cell and lose every column, so we scan char-by-char and
// only treat a \n as a row break when NOT inside quotes.
//
// Returns rows of `{ cells: string[], line }`, where `line` is the 1-based
// physical line the row started on (for error messages).
export function parseCsvRows(text) {
  const s = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let row = [];
  let cur = '';
  let inQ = false;
  let line = 1;
  let rowStartLine = 1;
  const pushCell = () => { row.push(cur); cur = ''; };
  const pushRow = () => {
    pushCell();
    rows.push({ cells: row, line: rowStartLine });
    row = [];
    rowStartLine = line;
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cur += '"'; i++; }   // escaped quote
        else inQ = false;
      } else {
        if (ch === '\n') line++;                      // newline inside a quoted field
        cur += ch;
      }
    } else if (ch === '"' && cur === '') {
      // ⚠️ A quote only opens a quoted field at the START of that field.
      // Mid-field it is DATA — tool descriptions carry inch marks (`.203"
      // REACH`, `7x Reach"`), and treating one as an opening quote makes the
      // parser swallow every comma and line break after it until the next
      // quote anywhere in the file. That silently glues whole rows into one
      // cell: a real posted Sequence Detail came through with one tool's
      // description holding the rest of its row plus the entire next row.
      inQ = true;
    } else if (ch === ',') {
      pushCell();
    } else if (ch === '\n') {
      line++;
      pushRow();
    } else {
      cur += ch;
    }
  }
  if (cur !== '' || row.length > 0) pushRow();   // trailing row (no final newline)
  return rows;
}
