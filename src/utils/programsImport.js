// One-time CSV import of the shop's existing program-number list into the Parts
// module. Pure (no React) so it's unit-testable; the Settings modal
// (ProgramsImportModal.jsx) drives file → preview → commit around it.
//
// Expected CSV header (order-independent; aliases tolerated):
//   Program #, Machine, Fixturing, Internal or external, internal Part #,
//   Rev, Customer, Description, OP #, Fixture Y/N
//
// Each row is one OPERATION. Rows group upward into the three tiers:
//   - PART by part_number alone (rev is NOT part of a part's identity).
//   - ROUTING by (part, rev) — the CSV can't say what the shop's routings
//     actually are, so one routing per rev is the only honest reading. The user
//     splits or merges them by hand afterward, which is a two-click job on the
//     part page and an unrecoverable guess if we did it for them.
//   - OPERATION per row, carrying its own program number.
// Existing records are reused by id, never duplicated. program_number is the
// global permanent key: a number already present (in the file or earlier in the
// import) is skipped as a duplicate. A blank Program # is auto-assigned the
// next available number (max + 1), honoring "the app knows the next number".
import {
  newPart, newRouting, newOperation, nextProgramNumber,
  partsOf, routingsOf, operationsOf, machineOptions,
} from './parts.js';
import { parseCsvRows } from './csv.js';

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
//   { parts, routings, operations, mergedFile, summary }
// parts/routings/operations are the NEW records to append; mergedFile is the
// ready-to-save parts.json. Existing records are untouched.
export function buildProgramsImport(csvText, { partsFile = {}, shopSettings = {}, createdBy = '' } = {}) {
  const { rows, missingColumns } = parseProgramsCsv(csvText);
  const machines = machineOptions(shopSettings);

  const summary = {
    totalRows: rows.length,
    partsNew: 0, partsReused: 0, routingsNew: 0, operationsNew: 0,
    autoAssigned: [], duplicates: [], errors: [],
    missingColumns,
  };

  if (missingColumns.includes('part_number')) {
    return { parts: [], routings: [], operations: [], mergedFile: partsFile, summary };
  }

  // Existing state we dedupe against.
  const partKeyOf = (n) => String(n ?? '').trim().toLowerCase();
  const routingKeyOf = (partId, rev) => `${partId}|${String(rev ?? '').trim().toLowerCase()}`;

  const existingPartByKey = new Map(partsOf(partsFile).map(p => [partKeyOf(p.part_number), p]));
  const existingRoutingByKey = new Map(routingsOf(partsFile).map(r => [routingKeyOf(r.part_id, r.rev), r]));
  const usedNumbers = new Set(
    operationsOf(partsFile).map(o => Number(o.program_number)).filter(n => !isNaN(n)));
  // An operation is also identified by (routing, OP #) — a row with a BLANK
  // program number has no number to dedupe on, so without this a re-import
  // would silently add a second copy of every such step. Seeded from what's
  // already stored and extended as the import runs.
  const usedOps = new Set(
    operationsOf(partsFile).map(o => `${o.routing_id}|${String(o.op_number ?? '').trim().toLowerCase()}`));

  const newParts = [];
  const newRoutings = [];
  const newOperations = [];
  const newPartByKey = new Map();
  const newRoutingByKey = new Map();


  // Two passes so an auto-assigned blank can never steal a number a later row
  // states explicitly: explicit numbers first, blanks after.
  const explicit = [], blanks = [];
  for (const row of rows) {
    // Strip a leading "O" (the shop's primary reference form, e.g. "O1108") —
    // the value stored and compared is always the plain integer.
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
    const key = partKeyOf(partNumber);
    const existing = existingPartByKey.get(key);
    if (existing) { summary.partsReused++; return existing.id; }
    if (newPartByKey.has(key)) return newPartByKey.get(key).id;
    const part = newPart({
      part_number: partNumber,
      customer: row.customer || '',
      // Material isn't in the CSV — left unset; added later on the part.
      material_id: null, material_custom: '',
    }, createdBy);
    newParts.push(part);
    newPartByKey.set(key, part);
    summary.partsNew++;
    return part.id;
  };

  // One routing per (part, rev). The CSV has no concept of a routing, so this
  // is the most it can honestly say — see the header note.
  const resolveRouting = (partId, rev) => {
    const key = routingKeyOf(partId, rev);
    const existing = existingRoutingByKey.get(key) || newRoutingByKey.get(key);
    if (existing) return existing.id;
    const routing = newRouting({
      part_id: partId,
      rev: String(rev ?? '').trim(),
      name: '',
      order: newRoutingByKey.size,
    }, createdBy);
    newRoutings.push(routing);
    newRoutingByKey.set(key, routing);
    summary.routingsNew++;
    return routing.id;
  };

  const addOperation = (row, number) => {
    const partId = resolvePart(row);
    if (!partId) {
      summary.errors.push({ line: row._line, message: 'Missing Part #' });
      return;
    }
    const routingId = resolveRouting(partId, row.rev || 'A');
    const opKey = `${routingId}|${String(row.operation ?? '').trim().toLowerCase()}`;
    if (usedOps.has(opKey)) {
      summary.duplicates.push({ line: row._line, program_number: number, op_number: row.operation || '' });
      return;
    }
    const isFixture = parseFixture(row.is_fixture);
    newOperations.push(newOperation({
      routing_id: routingId,
      op_number: row.operation || '',
      program_number: number,
      description: row.description || '',
      ...resolveMachine(row.machine, machines),
      is_fixture: isFixture,
      internal_external: parseIntExt(row.internal_external, isFixture),
      fixturing: row.fixturing || '',
      // No material / pallet columns in the import.
      material_id: null, material_custom: '', pallet: '',
      order: newOperations.length,
    }, createdBy));
    usedNumbers.add(number);
    usedOps.add(opKey);
    summary.operationsNew++;
  };

  for (const { row, number } of explicit) {
    if (usedNumbers.has(number)) {
      summary.duplicates.push({ line: row._line, program_number: number });
      continue;
    }
    addOperation(row, number);
  }
  // ⚠️ Auto-assign continues ABOVE everything, including the numbers this same
  // import just claimed. Starting from the pre-import max handed a blank row a
  // LOW free number (1000 in a file whose stated numbers ran 1108+), which is
  // a hole-filler rather than "the next number" — and it contradicts the rule
  // the rest of the app follows (a new bin continues past the highest in use,
  // it never backfills a gap).
  let counter = Math.max(nextProgramNumber(partsFile) - 1, ...usedNumbers, 0);
  for (const row of blanks) {
    const before = summary.operationsNew;
    do { counter++; } while (usedNumbers.has(counter));
    addOperation(row, counter);
    // Only claim the number if the row actually became an operation — a row
    // skipped as a duplicate must not burn a program number.
    if (summary.operationsNew > before) summary.autoAssigned.push(counter);
    else counter--;
  }

  const mergedFile = {
    ...partsFile,
    version: 1,
    parts: [...partsOf(partsFile), ...newParts],
    routings: [...routingsOf(partsFile), ...newRoutings],
    operations: [...operationsOf(partsFile), ...newOperations],
  };

  return { parts: newParts, routings: newRoutings, operations: newOperations, mergedFile, summary };
}
