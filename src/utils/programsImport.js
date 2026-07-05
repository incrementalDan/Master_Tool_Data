// One-time CSV import of an existing program-number list into the Program
// Number Manager. Pure (no React) so it's unit-testable; the Settings modal
// (ProgramsImportModal.jsx) drives file → preview → commit around it.
//
// Expected CSV header (order-independent; aliases tolerated):
//   Program #, Machine, Fixturing, Internal or external, internal Part #,
//   Rev, Customer, Description, OP #, Fixture Y/N
//
// Each row is one PROGRAM. Rows are grouped into PARTS by (part_number, rev)
// — a part appearing on many rows becomes one record; a part already in the
// registry is reused by id, never duplicated. program_number is the global
// permanent key: a number already present (in the registry or earlier in the
// file) is skipped as a duplicate. A blank Program # is auto-assigned the next
// available number (max + 1), honoring "the app knows the next number".
import { newPart, newProgram, nextProgramNumber, partsOf, programsOf, machineOptions } from './programs.js';

// ── CSV → row objects ─────────────────────────────────────────────────────────
// Quote-aware parser (same shape as ImportFlow's), returns { headers, rows }
// where each row is an object keyed by the CANONICAL field name.
const HEADER_ALIASES = {
  program_number: ['program #', 'program#', 'program number', 'programnumber', 'prog #', 'prog#', 'program', 'program no', 'program no.'],
  machine: ['machine'],
  fixturing: ['fixturing', 'fixture', 'workholding'],
  internal_external: ['internal or external', 'internal/external', 'int or ext', 'int/ext', 'internalexternal', 'internal external', 'in/ext'],
  part_number: ['internal part #', 'internal part#', 'internal part number', 'part #', 'part#', 'part number', 'partnumber', 'part'],
  rev: ['rev', 'revision'],
  customer: ['customer', 'cust'],
  description: ['description', 'desc'],
  operation: ['op #', 'op#', 'op number', 'op', 'operation', 'op no', 'op no.'],
  is_fixture: ['fixture y/n', 'fixture yn', 'fixture y n', 'is fixture', 'fixture?', 'fixtureyn'],
};

const normHeader = (h) => String(h ?? '').replace(/^﻿/, '').trim().toLowerCase().replace(/\s+/g, ' ');

function headerToField(h) {
  const n = normHeader(h);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(n)) return field;
  }
  return null;
}

// Full-file CSV tokenizer that honors quotes ACROSS newlines. A quoted field
// may contain commas, escaped quotes (""), AND embedded line breaks — real
// exports do this (this shop's export wraps the "Program #" header cell with a
// leading newline: `"\nProgram #"`). Splitting on \n before parsing quotes
// would shatter that cell and lose every column, so we scan char-by-char and
// only treat a \n as a row break when we're NOT inside quotes. Returns rows of
// `{ cells: string[], line }`, where `line` is the 1-based physical line the
// row started on (for error messages).
function parseCsvRows(text) {
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
    } else if (ch === '"') {
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

export function parseProgramsCsv(text) {
  const allRows = parseCsvRows(text);
  // First row with any non-empty cell is the header.
  const headerIdx = allRows.findIndex(r => r.cells.some(c => String(c).trim() !== ''));
  if (headerIdx < 0) return { fields: [], rows: [], missingColumns: ['part_number', 'program_number'] };
  const fields = allRows[headerIdx].cells.map(headerToField);   // canonical field per column (null = ignored)

  const rows = [];
  for (let i = headerIdx + 1; i < allRows.length; i++) {
    const { cells, line } = allRows[i];
    if (cells.every(c => String(c).trim() === '')) continue;
    const row = {};
    fields.forEach((f, idx) => { if (f) row[f] = (cells[idx] ?? '').trim(); });
    row._line = line;
    rows.push(row);
  }
  // part_number is the only hard-required column; program_number is nice but
  // can be auto-assigned. Report either if missing so the modal can warn.
  const present = new Set(fields.filter(Boolean));
  const missingColumns = ['part_number'].filter(c => !present.has(c));
  return { fields, rows, missingColumns };
}

// ── Value parsing ─────────────────────────────────────────────────────────────
const partKey = (partNumber, rev) =>
  `${String(partNumber ?? '').trim().toLowerCase()}|${String(rev ?? '').trim().toLowerCase()}`;

function parseFixture(v) {
  return /^(y|yes|true|t|1|fixture|fix)$/i.test(String(v ?? '').trim());
}

function parseIntExt(v, isFixture) {
  if (isFixture) return 'Internal';           // fixtures are always Internal (model rule)
  const s = String(v ?? '').trim().toLowerCase();
  if (s.startsWith('i')) return 'Internal';
  if (s.startsWith('e')) return 'External';
  return 'External';
}

// Match a CSV machine string to a configured machine (canonical id + label);
// falls back to the raw label with a null id (mirrors how a manually-added
// program stores machine_label as a cache that survives machine deletion).
function resolveMachine(raw, machines) {
  const s = String(raw ?? '').trim();
  if (!s) return { machine_id: machines[0]?.id ?? null, machine_label: machines[0]?.label ?? '' };
  const low = s.toLowerCase();
  const exact = machines.find(m => m.label.toLowerCase() === low);
  if (exact) return { machine_id: exact.id, machine_label: exact.label };
  const contains = machines.find(m => m.label.toLowerCase().includes(low) || low.includes(m.label.toLowerCase()));
  if (contains) return { machine_id: contains.id, machine_label: contains.label };
  return { machine_id: null, machine_label: s };
}

// ── Build the import ──────────────────────────────────────────────────────────
// Returns everything the modal needs to preview and commit:
//   { parts, programs, mergedFile, summary: { partsNew, partsReused,
//     programsNew, autoAssigned, duplicates[], errors[] } }
// parts/programs are the NEW records to append; mergedFile is the ready-to-save
// jobs.json (v2). Existing records are untouched (reused parts share their id).
export function buildProgramsImport(csvText, { jobsFile = {}, shopSettings = {}, createdBy = '' } = {}) {
  const { rows, missingColumns } = parseProgramsCsv(csvText);
  const machines = machineOptions(shopSettings);

  const summary = {
    totalRows: rows.length,
    partsNew: 0, partsReused: 0, programsNew: 0,
    autoAssigned: [], duplicates: [], errors: [],
    missingColumns,
  };

  if (missingColumns.includes('part_number')) {
    return { parts: [], programs: [], mergedFile: jobsFile, summary };
  }

  // Existing state we dedupe against.
  const existingPartByKey = new Map(partsOf(jobsFile).map(p => [partKey(p.part_number, p.rev), p]));
  const usedNumbers = new Set(programsOf(jobsFile).map(p => Number(p.program_number)).filter(n => !isNaN(n)));
  let counter = nextProgramNumber(jobsFile) - 1;   // running max; ++ before use

  const newParts = [];
  const newPartByKey = new Map();
  const newPrograms = [];

  // Two passes so an auto-assigned blank can never steal a number that a later
  // row states explicitly: explicit numbers first, blanks after.
  const explicit = [], blanks = [];
  for (const row of rows) {
    // Strip a leading "O" (the shop's primary program-number reference form,
    // e.g. "O1108") — the underlying value stored/compared is always the
    // plain integer.
    const rawNum = String(row.program_number ?? '').trim().replace(/^o(?=\d)/i, '');
    if (rawNum === '') { blanks.push(row); continue; }
    const n = Number(rawNum);
    if (!Number.isInteger(n)) {
      summary.errors.push({ line: row._line, message: `Program # "${rawNum}" is not a whole number` });
      continue;
    }
    explicit.push({ row, number: n });
  }

  const resolvePart = (row) => {
    const partNumber = String(row.part_number ?? '').trim();
    if (!partNumber) return null;
    const key = partKey(partNumber, row.rev);
    const existing = existingPartByKey.get(key);
    if (existing) { summary.partsReused++; existingPartByKey.set(key, existing); return existing.id; }
    if (newPartByKey.has(key)) return newPartByKey.get(key).id;
    const part = newPart({
      part_number: partNumber,
      customer: row.customer || '',
      rev: row.rev || 'A',
      // Material isn't in the CSV — left unset; add it later on the part.
      material_id: null,
      material_custom: '',
    }, createdBy);
    newParts.push(part);
    newPartByKey.set(key, part);
    summary.partsNew++;
    return part.id;
  };

  const addProgram = (row, number) => {
    const partId = resolvePart(row);
    if (!partId) {
      summary.errors.push({ line: row._line, message: 'Missing Part #' });
      return;
    }
    const isFixture = parseFixture(row.is_fixture);
    const program = newProgram({
      program_number: number,
      part_id: partId,
      operation: row.operation || '',
      description: row.description || '',
      ...resolveMachine(row.machine, machines),
      is_fixture: isFixture,
      internal_external: parseIntExt(row.internal_external, isFixture),
      fixturing: row.fixturing || '',
      // No material / pallet columns in the import.
      material_id: null, material_custom: '', pallet: '',
    }, createdBy);
    newPrograms.push(program);
    usedNumbers.add(number);
    summary.programsNew++;
  };

  for (const { row, number } of explicit) {
    if (usedNumbers.has(number)) {
      summary.duplicates.push({ line: row._line, program_number: number });
      continue;
    }
    addProgram(row, number);
  }
  for (const row of blanks) {
    do { counter++; } while (usedNumbers.has(counter));
    addProgram(row, counter);
    summary.autoAssigned.push(counter);
  }

  const mergedFile = {
    ...jobsFile,
    version: 2,
    jobs: jobsFile.jobs || [],
    parts: [...partsOf(jobsFile), ...newParts],
    programs: [...programsOf(jobsFile), ...newPrograms],
  };

  return { parts: newParts, programs: newPrograms, mergedFile, summary };
}
