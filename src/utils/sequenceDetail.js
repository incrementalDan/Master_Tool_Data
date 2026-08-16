// Sequence Detail CSV — parsing and condensing. Pure (no React), so the whole
// import can be unit-tested against real posted files.
//
// ⚠️ THE GOVERNING RULE: THE CSV IS A PASS-THROUGH OF PROVEN JOB DATA.
// It comes out of Fusion from the same cascade post as the G-code, so it
// matches what the machine will actually do. ToolDex is standard REFERENCE
// data; the CSV is FACT. A wrong OOH, holder, tool or T offset causes a crash,
// so nothing here "corrects" a CSV value against the library — every printed
// and displayed value is the string the post wrote. A 0.1" OOH difference is a
// different tool assembly, not a data error.
//
// Consequences visible throughout this file: values stay STRINGS (no numeric
// round-tripping that could render 0.70 as 0.7), and the only numbers parsed
// are the ones used for sorting/joining, never for display.
//
// The file is named {programNumber}.csv (O1218.csv) and lists every toolpath
// operation in the program:
//   - Seq# correlates directly to the N## in the G-code. A sequence number is
//     output on a tool change; extra toolpaths under one tool change get
//     .1 / .2 so they stay in order (15, 15.1).
//   - Row 0 is a structured free-text header (program #, file name, POSTED
//     stamp, cycle time, machine, stock). The description is uncontrolled free
//     text in Fusion and the post has a known double-O typo (OO1218), so the
//     program number here is IGNORED — the FILENAME is the truth.
//   - Row 0.5 is the fixture line. Kept raw, not used yet.
import { parseCsvRows } from './csv.js';

// Column headers as the post writes them, with tolerated variants.
const COLUMN_ALIASES = {
  seq:         ['seq#', 'seq #', 'seq', 'sequence #', 'sequence#'],
  description: ['sequence description', 'description'],
  tool_id:     ['tool #', 'tool#', 'proshop tool #', 'proshop tool#'],
  t:           ['g-code tool #', 'g-code tool#', 'gcode tool #', 'g code tool #', 't#', 't #'],
  ooh:         ['ooh'],
  holder:      ['holder'],
  rta:         ['rta #', 'rta#', 'rta'],
  h:           ['length control dim'],
  d:           ['diameter control dim'],
  cut_dia:     ['cut diameter'],
  gage:        ['gage length', 'gauge length'],
  tip:         ['tip (cr or angle)', 'tip'],
  t_description: ['t-description', 'tool description'],
  lc:          ['lc', 'location'],
};

const normHeader = (h) => String(h ?? '').replace(/^﻿/, '').trim().toLowerCase().replace(/\s+/g, ' ');

function headerToField(h) {
  const n = normHeader(h);
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.includes(n)) return field;
  }
  return null;
}

// ── Tool numbers ─────────────────────────────────────────────────────────────
// T5, T05, t5 and 5 are all the same pocket. The numeric form is the join key
// (and the sort key); the display form is always re-composed as T## so the tool
// list reads like the setup sheet regardless of how the post wrote it.
export function toolNumberOf(raw) {
  const m = String(raw ?? '').trim().match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

export function formatToolNumber(n) {
  if (n == null) return '';
  return `T${String(n).padStart(2, '0')}`;
}

// H and D offsets ALWAYS equal T — the post enforces it, and the H column is
// known to carry an (incorrect) gauge-length reference in newer files. So the
// CSV's H/D values are deliberately ignored and both are derived from T.
export function offsetOf(t_num) {
  if (t_num == null) return '';
  return `${String(t_num).padStart(2, '0')}`;
}

// ── ProShop IDs ──────────────────────────────────────────────────────────────
// An insert-style tool is ONE Fusion entity whose ProShop id is the two
// component numbers joined with a slash. Fusion may write them in either order
// and with arbitrary spacing (`I-224 / G-223`, `G223/I224`), so the MATCH key is
// the unordered set of normalized halves. This normalizes for MATCHING ONLY —
// the stored/displayed/printed value stays the CSV's own string.
export function proShopIdKey(raw) {
  const s = String(raw ?? '').trim().toUpperCase();
  if (!s) return '';
  return s.split('/')
    .map(part => part.replace(/[\s-]/g, ''))
    .filter(Boolean)
    .sort()
    .join('/');
}

// ── Header row (Seq# 0) ──────────────────────────────────────────────────────
// "NC PRG: OO1218 | FILE NAME: CAM - … | POSTED: 8-10-2026 10:51 | …"
// The POSTED stamp is the VERSION KEY: it's written by post logic into both the
// CSV and the G-code, so it's what pairs the two and what identifies a version.
export function parsePosted(headerText) {
  const m = String(headerText ?? '').match(/POSTED[:\s]+(\d{1,2}-\d{1,2}-\d{4}\s+\d{1,2}:\d{2})/i);
  return m ? m[1].trim() : '';
}

// Posted stamp → ISO, for sorting and the archive filename. Returns '' when the
// stamp is missing or unparseable — never a guessed date.
export function postedToIso(posted) {
  const m = String(posted ?? '').match(/^(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  const [, mo, d, y, h, min] = m;
  const pad = (n) => String(n).padStart(2, '0');
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(min)}:00`;
}

// ── Filename → program number ────────────────────────────────────────────────
// The filename is the truth (the row-0 program number is uncontrolled free text
// with a known post typo). "O1218.csv" / "1218.csv" / "o1218 (1).csv" → 1218.
export function programNumberFromFileName(name) {
  const base = String(name ?? '').replace(/\.[^.]*$/, '').trim();
  const m = base.match(/^o?\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

// ── Parse ────────────────────────────────────────────────────────────────────
// Returns { headerRaw, fixtureRaw, posted, rows[], missingColumns[] }.
// Every row value is the CSV's own trimmed string.
export function parseSequenceCsv(text) {
  const all = parseCsvRows(text);
  const headerIdx = all.findIndex(r =>
    r.cells.some(c => normHeader(c) === 'seq#') || normHeader(r.cells[1]) === 'sequence description');

  if (headerIdx < 0) {
    return { headerRaw: '', fixtureRaw: '', posted: '', rows: [], missingColumns: ['seq', 'tool_id', 't'] };
  }

  const fieldByCol = all[headerIdx].cells.map(headerToField);
  const present = new Set(fieldByCol.filter(Boolean));
  const missingColumns = ['seq', 'tool_id', 't'].filter(f => !present.has(f));

  let headerRaw = '';
  let fixtureRaw = '';
  const rows = [];

  for (let i = headerIdx + 1; i < all.length; i++) {
    const cells = all[i].cells;
    if (!cells.some(c => String(c).trim() !== '')) continue;

    const row = {};
    fieldByCol.forEach((field, col) => {
      if (field) row[field] = String(cells[col] ?? '').trim();
    });

    const seq = String(row.seq ?? '').trim();
    // Rows 0 and 0.5 are the program header and the fixture line — structured
    // free text, not operations. Kept raw; never treated as a toolpath.
    if (seq === '0') { headerRaw = row.description || ''; continue; }
    if (seq === '0.5') { fixtureRaw = row.description || ''; continue; }
    if (!seq) continue;

    rows.push({
      seq,
      description: row.description || '',
      tool_id: row.tool_id || '',
      t: row.t || '',
      t_num: toolNumberOf(row.t),
      ooh: row.ooh || '',
      holder: row.holder || '',
      rta: row.rta || '',
      cut_dia: row.cut_dia || '',
      gage: row.gage || '',
      tip: row.tip || '',
      t_description: row.t_description || '',
      lc: row.lc || '',
    });
  }

  return { headerRaw, fixtureRaw, posted: parsePosted(headerRaw), rows, missingColumns };
}

// ── Condense ─────────────────────────────────────────────────────────────────
// One row per POCKET (T#), not per tool: the same tool legitimately occupies
// two pockets in one program (T03 and T04 both A-35), and those are two
// separate physical assemblies to set up and label. The same pocket appearing
// at non-adjacent sequence numbers (A-265 at 15 and 25) collapses to one entry
// that remembers both.
//
// The first row for a pocket supplies the values; later rows only add their
// seq. A blank on the first row is filled from a later row (the post repeats
// the assembly data, but a stray blank cell must not blank the tool list) —
// this fills gaps only, it never overwrites a value the CSV already gave.
export function condenseTools(rows) {
  const byPocket = new Map();
  const FILLABLE = ['tool_id', 'holder', 'ooh', 'cut_dia', 'tip', 't_description', 'lc', 'rta', 'gage'];

  for (const r of rows) {
    if (r.t_num == null) continue;   // no pocket — nothing to set up or label
    const key = r.t_num;
    if (!byPocket.has(key)) {
      byPocket.set(key, {
        t: formatToolNumber(r.t_num),
        t_num: r.t_num,
        tool_id: r.tool_id,
        description: r.t_description,
        cut_dia: r.cut_dia,
        tip: r.tip,
        holder: r.holder,
        ooh: r.ooh,
        lc: r.lc,
        rta: r.rta,
        gage: r.gage,
        seqs: [r.seq],
      });
    } else {
      const t = byPocket.get(key);
      if (!t.seqs.includes(r.seq)) t.seqs.push(r.seq);
      for (const f of FILLABLE) {
        const target = f === 't_description' ? 'description' : f;
        if (!t[target] && r[f]) t[target] = r[f];
      }
    }
  }

  return [...byPocket.values()].sort((a, b) => a.t_num - b.t_num);
}
