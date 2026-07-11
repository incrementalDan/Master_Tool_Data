// Program Number Manager — pure helpers (no React). Mirrors jobs.js.
//
// Parts + Programs live in jobs.json (v2) alongside the lightweight jobs[]
// links — one "jobs domain" file, one future SQLite table-set:
//   parts[]    { id, part_number, customer, rev, material_id, material_custom,
//                created_at, created_by }
//   programs[] { id, program_number (int, permanent), part_id, operation,
//                description, machine_id, machine_label, is_fixture,
//                internal_external, fixturing, material_id, material_custom,
//                pallet, created_at, created_by }
//
// Materials are SPECIFIC ALLOYS: material_id references the Materials
// library's materials[] (alloy) tier — not a CAM preset or ISO group.
// material_custom is the free-text escape hatch for one-offs (material_id
// null). NON-FIXTURE programs store NO material at all — they derive it from
// their part at read time (programMaterial), so editing a part's material
// "cascades" everywhere by construction, with zero copies to drift out of
// sync. Only fixture ops (is_fixture) carry their own material fields.
import { generateId } from '../schema/identity.js';

export const INT_EXT = ['External', 'Internal'];

// First program number ever assigned (when programs[] is empty the Add flow
// lets the user seed a different starting number — e.g. continuing from the
// legacy Google Sheet). After that: always max(existing) + 1, computed — never
// a stored counter that can drift out of sync with the data.
export const PROGRAM_NUMBER_START = 1000;

// Standard fixturing options. ToolDex has no first-class fixture list yet
// (the real list lives in ProShop) — until that integration exists this
// constant + the Custom… free-text path stands in, per the feature spec.
export const FIXTURING_OPTIONS = [
  '125mm Lang Vise Forward',
  '77mm Lang Vise with Soft Jaw',
  '125mm Lang Vise Reverse',
  'Standard Machine Vise',
];

// Machine fallback when shop_settings has no machines configured yet.
export const FALLBACK_MACHINES = ['Brother M300X3', 'Brother R650'];

export const partsOf = (jobsFile) => jobsFile?.parts || [];
export const programsOf = (jobsFile) => jobsFile?.programs || [];
export const partById = (jobsFile, id) => partsOf(jobsFile).find(p => p.id === id) || null;
export const programsForPart = (jobsFile, partId) =>
  programsOf(jobsFile).filter(p => p.part_id === partId);

// Global, permanent, gap-tolerant: (highest existing) + 1.
export function nextProgramNumber(jobsFile) {
  const nums = programsOf(jobsFile)
    .map(p => Number(p.program_number))
    .filter(n => !isNaN(n));
  return nums.length ? Math.max(...nums) + 1 : PROGRAM_NUMBER_START;
}

export function newPart({ part_number, customer = '', rev = 'A', material_id = null, material_custom = '' }, createdBy = '') {
  return {
    id: generateId(),
    part_number: String(part_number ?? '').trim(),
    customer: String(customer ?? '').trim(),
    rev: String(rev ?? '').trim() || 'A',
    material_id: material_id || null,
    material_custom: material_id ? '' : String(material_custom ?? '').trim(),
    created_at: new Date().toISOString(),
    created_by: createdBy || '',
  };
}

export function newProgram(fields, createdBy = '') {
  const isFixture = !!fields.is_fixture;
  return {
    id: generateId(),
    program_number: Number(fields.program_number),
    part_id: fields.part_id,
    operation: String(fields.operation ?? '').trim(),
    description: String(fields.description ?? '').trim(),
    machine_id: fields.machine_id || null,
    machine_label: String(fields.machine_label ?? '').trim(),
    is_fixture: isFixture,
    internal_external: isFixture ? 'Internal' : (fields.internal_external || 'External'),
    fixturing: String(fields.fixturing ?? '').trim(),
    // Material only for fixture ops — non-fixture ops derive from the part.
    material_id: isFixture ? (fields.material_id || null) : null,
    material_custom: isFixture && !fields.material_id ? String(fields.material_custom ?? '').trim() : '',
    pallet: isPalletMachine(fields.machine_label) ? (fields.pallet || '') : '',
    created_at: new Date().toISOString(),
    created_by: createdBy || '',
  };
}

// The material a program actually runs in: its own (fixture op) or its part's.
export function programMaterial(program, part) {
  if (program?.is_fixture) {
    return { material_id: program.material_id || null, material_custom: program.material_custom || '' };
  }
  return { material_id: part?.material_id || null, material_custom: part?.material_custom || '' };
}

// Resolve a material reference to a display label against the Materials
// library's alloy tier. Custom text wins when there's no id; a dangling id
// (alloy deleted from the library) shows a soft marker instead of vanishing.
export function alloyLabel(materials, material_id, material_custom) {
  if (material_id) {
    const alloy = (materials?.materials || []).find(a => a.id === material_id);
    return alloy ? alloy.label : '(unknown alloy)';
  }
  return material_custom || '';
}

// Machines for the machine dropdown: the shop's configured machines
// (shop_settings.machines[], stable UUIDs) or the hardcoded fallback pair when
// none are configured yet. Programs store machine_id + a machine_label cache
// so rows survive a machine being deleted from settings.
export function machineOptions(shopSettings) {
  const ms = shopSettings?.machines || [];
  if (ms.length > 0) return ms.map(m => ({ id: m.id, label: m.model || 'Machine' }));
  return FALLBACK_MACHINES.map(label => ({ id: null, label }));
}

// Pallet selection only applies to the R650 (pallet-changer machine).
export function isPalletMachine(machineLabel) {
  return /r650/i.test(String(machineLabel || ''));
}

// ── Customer colors ───────────────────────────────────────────────────────────
// Each distinct customer name always renders in the same color: hash the
// normalized name into a fixed palette. Rendered via the shared --badge-color
// CSS pattern (same mechanism as holder pills / preset tags).
export const CUSTOMER_PALETTE = [
  '#38bdf8', // sky
  '#a78bfa', // violet
  '#fb7185', // rose
  '#fbbf24', // amber
  '#2dd4bf', // teal
  '#e879f9', // fuchsia
  '#fb923c', // orange
  '#818cf8', // indigo
  '#34d399', // emerald
  '#22d3ee', // cyan
];

export function customerColor(customer) {
  const key = String(customer || '').trim().toLowerCase();
  if (!key) return null;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return CUSTOMER_PALETTE[hash % CUSTOMER_PALETTE.length];
}

// Distinct existing customer names (for the autocomplete datalist — cuts down
// on "Cadrex" vs "cadrex" duplicates).
export function customerNames(jobsFile) {
  return [...new Set(partsOf(jobsFile).map(p => p.customer).filter(Boolean))];
}

// Program numbers are referenced the same way the machine control and the
// G-code file names do — the classic Fanuc-style "O" prefix (O1108, O2352).
// Storage stays a plain integer everywhere (sort / max+1 / dedupe / CSV);
// this is purely the display/reference form. Idempotent: a value that
// already carries the prefix (e.g. a legacy jobs[] entry typed by hand) is
// normalized, not double-prefixed.
export function formatProgramNumber(n) {
  if (n == null || n === '') return '';
  const s = String(n).trim();
  return /^o/i.test(s) ? `O${s.slice(1)}` : `O${s}`;
}

// Operation values are usually a short numeric identifier (e.g. "50", "60",
// "50R", "51M", "160RB") that the shop always refers to with an "OP" prefix —
// same idea as the program number's "O" prefix. Idempotent (an already-prefixed
// "OP50" is normalized, not double-prefixed). Free-text operations that aren't
// a number+optional-letters token (e.g. a fixture step like "Soft Jaw" or
// "PRE OP") are left exactly as typed — there's nothing to prefix.
export function formatOperation(op) {
  const s = String(op ?? '').trim();
  if (!s) return '';
  const stripped = s.replace(/^op\s*/i, '');
  return /^\d+[a-z]*$/i.test(stripped) ? `OP${stripped.toUpperCase()}` : s;
}

// Quick search for the Sync-Job program picker: match programs by EXACT program
// number (when the query is numeric) or by a CONTAINS match on the part number.
// Returns joined rows { program, part } — exact program-number hits first, then
// part-number matches, each ordered by program number. `limit` caps the list.
// A leading "O" (the primary reference format, e.g. "O1108") is tolerated on
// the numeric side so typing it the way it's stamped on the part still hits.
export function searchPrograms(jobsFile, query, limit = 25) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [];
  const byId = new Map(partsOf(jobsFile).map(p => [p.id, p]));
  const numQuery = q.replace(/^o(?=\d)/, '');
  const isNum = /^\d+$/.test(numQuery);
  const wantNum = isNum ? Number(numQuery) : null;

  const rows = [];
  for (const program of programsOf(jobsFile)) {
    const part = byId.get(program.part_id) || null;
    const exactProgram = wantNum != null && Number(program.program_number) === wantNum;
    const partContains = part && String(part.part_number || '').toLowerCase().includes(q);
    if (exactProgram || partContains) rows.push({ program, part, exactProgram });
  }
  rows.sort((a, b) => {
    if (a.exactProgram !== b.exactProgram) return a.exactProgram ? -1 : 1;   // exact # first
    return Number(a.program_number ?? a.program.program_number) - Number(b.program.program_number);
  });
  return rows.slice(0, limit);
}
