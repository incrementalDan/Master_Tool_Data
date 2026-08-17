// The PARTS module — pure helpers (no React). Replaces the old programs.js /
// jobs.js pair, and `parts.json` replaces `jobs.json`.
//
// THREE TIERS, in the shop's own words:
//
//   Part      the thing being made. ONE record per part number, ONE page.
//    └── Routing   a combination of operations — how we make it. A part can
//                  have more than one: different fixturing, machine, or
//                  process revision. (The shop says "job"; ProShop says
//                  "routing", and so do we — see below.)
//         └── Operation   a sequential step, and its program.
//
// ⚠️ WHY "ROUTING" AND NOT "JOB". The floor says job, but in an ERP a job is a
// WORK ORDER — a production run of a part (the shop's own setup sheet carries
// "WO 26-0027"). That record will be needed, and it is not this one. Spending
// the word "job" on this tier now would recreate the exact collision this
// rename exists to remove. "Routing" is also the standard term for the sequence
// of operations that makes a part, which is precisely what this is.
//
// ⚠️ AN OPERATION CARRIES ITS OWN PROGRAM NUMBER — there is no programs[]
// table. An OP has at most one program (confirmed with the shop), so a separate
// record would be a 1:1 join that buys nothing and gives every link two things
// it could point at. An OP with no program is normal: inspection, deburr, an
// outside process.
//
// The part's REV lives on the routing, not the part. The shop wants everything
// for a part number on one page; if the part were keyed (part_number, rev), a
// new rev would be a second part and a second page. A rev that changes how the
// part is made is a new routing — which is one of the things that distinguishes
// two routings in the first place.
import { generateId } from '../schema/identity.js';
import { machineColor, MACHINE_COLOR_PALETTE } from './machineColors.js';

export const INT_EXT = ['External', 'Internal'];

// First program number ever assigned (when nothing is numbered yet the Add flow
// lets the user seed a different starting number — e.g. continuing from the
// legacy Google Sheet). After that: always max(existing) + 1, computed — never
// a stored counter that can drift out of sync with the data.
export const PROGRAM_NUMBER_START = 1000;

// Standard fixturing options. ToolDex has no first-class fixture list yet (the
// real list lives in ProShop) — until that integration exists this constant +
// the Custom… free-text path stands in.
export const FIXTURING_OPTIONS = [
  '125mm Lang Vise Forward',
  '77mm Lang Vise with Soft Jaw',
  '125mm Lang Vise Reverse',
  'Standard Machine Vise',
];

// Machine fallback when shop_settings has no machines configured yet.
export const FALLBACK_MACHINES = ['Brother M300X3', 'Brother R650'];

// ── Accessors ────────────────────────────────────────────────────────────────

export const partsOf = (file) => file?.parts || [];
export const routingsOf = (file) => file?.routings || [];
export const operationsOf = (file) => file?.operations || [];

export const partById = (file, id) => partsOf(file).find(p => p.id === id) || null;
export const routingById = (file, id) => routingsOf(file).find(r => r.id === id) || null;
export const operationById = (file, id) => operationsOf(file).find(o => o.id === id) || null;

export const routingsForPart = (file, partId) =>
  routingsOf(file).filter(r => r.part_id === partId).sort(byOrder);

export const operationsForRouting = (file, routingId) =>
  operationsOf(file).filter(o => o.routing_id === routingId).sort(byOpOrder);

// Every operation on a part, across all its routings — what the part page's
// all-tools list and label printing walk.
//
// ⚠️ Ordered by ROUTING first, then OP number. Sorting the whole set by OP
// number alone interleaves the routings (two routings that both start at OP50
// alternate), which reads as one confused sequence rather than two ways of
// making the part — and the label stack comes out in that order.
export const operationsForPart = (file, partId) => {
  const routings = routingsForPart(file, partId);
  const rank = new Map(routings.map((r, i) => [r.id, i]));
  return operationsOf(file)
    .filter(o => rank.has(o.routing_id))
    .sort((a, b) => (rank.get(a.routing_id) - rank.get(b.routing_id)) || byOpOrder(a, b));
};

export const routingForOperation = (file, op) => routingById(file, op?.routing_id);
export const partForOperation = (file, op) => {
  const routing = routingForOperation(file, op);
  return routing ? partById(file, routing.part_id) : null;
};

// An operation is found by its program number the same way the posted CSV names
// it — the number is unique shop-wide and permanent.
export const operationByProgramNumber = (file, n) => {
  const want = Number(n);
  if (isNaN(want)) return null;
  return operationsOf(file).find(o => Number(o.program_number) === want) || null;
};

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
// Operations sort by their OP number the way the shop reads them (OP50 before
// OP60 before OP160), falling back to insertion order for non-numeric steps.
const byOpOrder = (a, b) => {
  const n = (x) => {
    const m = String(x.op_number ?? '').match(/\d+/);
    return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER;
  };
  const d = n(a) - n(b);
  return d !== 0 ? d : String(a.op_number ?? '').localeCompare(String(b.op_number ?? ''));
};

// ── Program numbers ──────────────────────────────────────────────────────────
// Global, permanent, gap-tolerant: (highest existing) + 1. Computed, never
// stored, so it can't drift — and so deleting a non-max operation leaves it
// untouched while deleting the highest reclaims that number.
export function nextProgramNumber(file) {
  const nums = operationsOf(file)
    .map(o => Number(o.program_number))
    .filter(n => !isNaN(n) && n > 0);
  return nums.length ? Math.max(...nums) + 1 : PROGRAM_NUMBER_START;
}

// ── Factories ────────────────────────────────────────────────────────────────

export function newPart({ part_number, customer = '', material_id = null, material_custom = '' }, createdBy = '') {
  return {
    id: generateId(),
    part_number: String(part_number ?? '').trim(),
    customer: String(customer ?? '').trim(),
    material_id: material_id || null,
    material_custom: material_id ? '' : String(material_custom ?? '').trim(),
    created_at: new Date().toISOString(),
    created_by: createdBy || '',
  };
}

export function newRouting({ part_id, name = '', rev = '', notes = '', order = 0 }, createdBy = '') {
  // ⚠️ A routing that would otherwise be nameless gets a STORED default name
  // ("Routing 1", "Routing 2"), not a name derived from its position in the
  // list. A positional name silently RENAMES the survivors when one is deleted
  // — delete Routing 1 and Routing 2 becomes "Routing 1" — which is a label
  // moving under the user for a record they didn't touch. `order` is the count
  // at creation, so the number is right and then it never moves.
  const trimmedName = String(name ?? '').trim();
  const trimmedRev = String(rev ?? '').trim();
  return {
    id: generateId(),
    part_id,
    name: trimmedName || (trimmedRev ? '' : `Routing ${(order ?? 0) + 1}`),
    rev: String(rev ?? '').trim(),
    notes: String(notes ?? '').trim(),
    order,
    created_at: new Date().toISOString(),
    created_by: createdBy || '',
  };
}

export function newOperation(fields, createdBy = '') {
  const isFixture = !!fields.is_fixture;
  return {
    id: generateId(),
    routing_id: fields.routing_id,
    op_number: String(fields.op_number ?? '').trim(),
    // Null = a step with no program (inspection, deburr, outside process).
    program_number: fields.program_number == null ? null : Number(fields.program_number),
    description: String(fields.description ?? '').trim(),
    machine_id: fields.machine_id || null,
    machine_label: String(fields.machine_label ?? '').trim(),
    is_fixture: isFixture,
    internal_external: isFixture ? 'Internal' : (fields.internal_external || 'External'),
    fixturing: String(fields.fixturing ?? '').trim(),
    // Material only for fixture ops — everything else derives from the part.
    material_id: isFixture ? (fields.material_id || null) : null,
    material_custom: isFixture && !fields.material_id ? String(fields.material_custom ?? '').trim() : '',
    pallet: isPalletMachine(fields.machine_label) ? (fields.pallet || '') : '',
    order: fields.order ?? 0,
    created_at: new Date().toISOString(),
    created_by: createdBy || '',
  };
}

// The material an operation actually runs in: its own (fixture op) or the
// part's. Non-fixture ops store NO material, so editing the part cascades
// everywhere by construction, with no copies to drift.
export function operationMaterial(operation, part) {
  if (operation?.is_fixture) {
    return { material_id: operation.material_id || null, material_custom: operation.material_custom || '' };
  }
  return { material_id: part?.material_id || null, material_custom: part?.material_custom || '' };
}

// Resolve a material reference to a display label against the Materials
// library's alloy tier. A dangling id (alloy deleted) shows a soft marker
// instead of vanishing.
export function alloyLabel(materials, material_id, material_custom) {
  if (material_id) {
    const alloy = (materials?.materials || []).find(a => a.id === material_id);
    return alloy ? alloy.label : '(unknown alloy)';
  }
  return material_custom || '';
}

// ── Machines ─────────────────────────────────────────────────────────────────

export function machineOptions(shopSettings) {
  const ms = shopSettings?.machines || [];
  if (ms.length > 0) return ms.map(m => ({ id: m.id, label: m.model || 'Machine', color: machineColor(m, ms) }));
  return FALLBACK_MACHINES.map((label, i) => ({ id: null, label, color: MACHINE_COLOR_PALETTE[i % MACHINE_COLOR_PALETTE.length] }));
}

// Pallet selection only applies to the R650 (pallet-changer machine).
export function isPalletMachine(machineLabel) {
  return /r650/i.test(String(machineLabel || ''));
}

// ── Customer colors ──────────────────────────────────────────────────────────
// Each distinct customer name always renders in the same color: hash the
// normalized name into a fixed palette, rendered via the shared --badge-color
// pattern (same mechanism as holder pills / preset tags).
export const CUSTOMER_PALETTE = [
  '#38bdf8', '#a78bfa', '#fb7185', '#fbbf24', '#2dd4bf',
  '#e879f9', '#fb923c', '#818cf8', '#34d399', '#22d3ee',
];

export function customerColor(customer) {
  const key = String(customer || '').trim().toLowerCase();
  if (!key) return null;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return CUSTOMER_PALETTE[hash % CUSTOMER_PALETTE.length];
}

export function customerNames(file) {
  return [...new Set(partsOf(file).map(p => p.customer).filter(Boolean))];
}

// ── Display forms ────────────────────────────────────────────────────────────

// Program numbers are referenced the way the machine control and the G-code
// file names do — the classic Fanuc-style "O" prefix (O1108, O2352). Storage
// stays a plain integer everywhere; this is purely the display form and is
// idempotent.
export function formatProgramNumber(n) {
  if (n == null || n === '') return '';
  const s = String(n).trim();
  return /^o/i.test(s) ? `O${s.slice(1)}` : `O${s}`;
}

// OP numbers are a short token the shop always says with an "OP" prefix (OP50,
// OP50R, OP160RB). Idempotent; free text that isn't that shape (a fixture step
// like "Soft Jaw") is left exactly as typed — there's nothing to prefix.
export function formatOperation(op) {
  const s = String(op ?? '').trim();
  if (!s) return '';
  const stripped = s.replace(/^op\s*/i, '');
  return /^\d+[a-z]*$/i.test(stripped) ? `OP${stripped.toUpperCase()}` : s;
}

// A routing's display name: what the user called it, else its rev. The
// positional fallback is a last resort for a record that predates the stored
// default (newRouting stamps one) — see the warning there about names shifting.
export function routingLabel(routing, index = 0) {
  if (!routing) return '';
  if (routing.name) return routing.name;
  if (routing.rev) return `Rev ${routing.rev}`;
  return `Routing ${index + 1}`;
}

// ── Search ───────────────────────────────────────────────────────────────────
// Match operations by EXACT program number (when the query is numeric) or by a
// CONTAINS match on the part number. Returns joined rows { operation, routing,
// part } — exact program-number hits first. A leading "O" is tolerated so
// typing the number the way it's stamped on the part still hits.
export function searchPrograms(file, query, limit = 25) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [];
  const partsById = new Map(partsOf(file).map(p => [p.id, p]));
  const routingsById = new Map(routingsOf(file).map(r => [r.id, r]));
  const numQuery = q.replace(/^o(?=\d)/, '');
  const wantNum = /^\d+$/.test(numQuery) ? Number(numQuery) : null;

  const rows = [];
  for (const operation of operationsOf(file)) {
    const routing = routingsById.get(operation.routing_id) || null;
    const part = routing ? partsById.get(routing.part_id) || null : null;
    const exact = wantNum != null && Number(operation.program_number) === wantNum;
    const partContains = part && String(part.part_number || '').toLowerCase().includes(q);
    if (exact || partContains) rows.push({ operation, routing, part, exact });
  }
  rows.sort((a, b) => {
    if (a.exact !== b.exact) return a.exact ? -1 : 1;
    return Number(a.operation.program_number ?? 0) - Number(b.operation.program_number ?? 0);
  });
  return rows.slice(0, limit);
}

// ── Mutations ────────────────────────────────────────────────────────────────
// Pure file → file. Every screen that edits goes through these, so the rules
// are stated once instead of being re-implemented per page. Each caller hands
// the result to saveParts (optimistic + debounced Drive write).

// Every edit stamps `updated_at`, which is what "Recently updated" sorts on.
// It goes here rather than at each call site so no screen can edit a record
// without the sort noticing — the whole point is to find what you touched last.
const touch = (rec, patch) => ({ ...rec, ...patch, updated_at: new Date().toISOString() });

// ⚠️ A NEW PART AND ITS FIRST ROUTING ARE CREATED IN ONE WRITE.
//
// A part with no routing has nowhere to put an operation, so the two are always
// made together — and they must be ONE file→file step. Two sequential saves in
// the same handler both build from the same pre-update file (React state does
// not change mid-handler), so the second silently discards the first: the part
// vanished and its routing was left orphaned, pointing at nothing.
export function addPartWithRoutingIn(file, partFields, routingFields = {}, createdBy = '') {
  const part = newPart(partFields, createdBy);
  const routing = newRouting({ ...routingFields, part_id: part.id, order: 0 }, createdBy);
  return {
    file: {
      ...file,
      parts: [...partsOf(file), part],
      routings: [...routingsOf(file), routing],
    },
    part,
    routing,
  };
}

export function addRoutingIn(file, partId, routingFields = {}, createdBy = '') {
  const routing = newRouting({
    ...routingFields, part_id: partId, order: routingsForPart(file, partId).length,
  }, createdBy);
  return { file: { ...file, routings: [...routingsOf(file), routing] }, routing };
}

export function addOperationIn(file, routingId, opFields = {}, createdBy = '') {
  const operation = newOperation({
    ...opFields, routing_id: routingId,
    order: operationsOf(file).filter(o => o.routing_id === routingId).length,
  }, createdBy);
  return { file: { ...file, operations: [...operationsOf(file), operation] }, operation };
}

export function updatePartIn(file, id, patch) {
  return { ...file, parts: partsOf(file).map(p => (p.id === id ? touch(p, patch) : p)) };
}

export function updateRoutingIn(file, id, patch) {
  return { ...file, routings: routingsOf(file).map(r => (r.id === id ? touch(r, patch) : r)) };
}

// ⚠️ program_number is deliberately NOT patchable — permanent once reserved.
// Stripped here rather than trusted to every caller.
export function updateOperationIn(file, id, patch) {
  const { program_number, ...rest } = patch;
  return { ...file, operations: operationsOf(file).map(o => (o.id === id ? touch(o, rest) : o)) };
}

export function deleteOperationIn(file, id) {
  return { ...file, operations: operationsOf(file).filter(o => o.id !== id) };
}

// Deleting a routing takes its operations with it.
export function deleteRoutingIn(file, id) {
  const ops = operationsOf(file).filter(o => o.routing_id !== id);
  return { ...file, routings: routingsOf(file).filter(r => r.id !== id), operations: ops };
}

// Deleting a part takes every routing and operation under it.
export function deletePartIn(file, id) {
  const gone = new Set(routingsOf(file).filter(r => r.part_id === id).map(r => r.id));
  return {
    ...file,
    parts: partsOf(file).filter(p => p.id !== id),
    routings: routingsOf(file).filter(r => r.part_id !== id),
    operations: operationsOf(file).filter(o => !gone.has(o.routing_id)),
  };
}

// ── Search, filter, sort ─────────────────────────────────────────────────────
// The Parts page offers the same controls in BOTH views — the grouped list and
// the table are two renderings of one filtered, sorted set, not two features.

// Everything one operation can be found by, including the part and routing it
// belongs to: searching "6061" or a customer name has to reach the operations
// under that part, not just the part row.
export function operationHaystack(file, materials, op, part, routing) {
  const mat = operationMaterial(op, part);
  return [
    formatProgramNumber(op.program_number),
    op.program_number,
    formatOperation(op.op_number),
    op.description,
    op.machine_label,
    op.fixturing,
    op.is_fixture ? 'fixture' : op.internal_external,
    op.pallet ? `pallet ${op.pallet}` : '',
    routing ? routingLabel(routing) : '',
    routing?.rev ? `rev ${routing.rev}` : '',
    routing?.notes,
    part?.part_number,
    part?.customer,
    alloyLabel(materials, mat.material_id, mat.material_custom),
  ].filter(Boolean).join(' \u0000 ').toLowerCase();
}

// What a PART alone can be found by. A hit here keeps the whole part — searching
// a part number should show everything under it, not just rows that repeat it.
export function partHaystack(materials, part) {
  return [
    part.part_number,
    part.customer,
    alloyLabel(materials, part.material_id, part.material_custom),
  ].filter(Boolean).join(' \u0000 ').toLowerCase();
}

// → { operationIds: Set, partIds: Set }. Both views read this one result, so a
// part shown in the grouped list and a row shown in the table can never
// disagree about what matches.
export function applyPartsFilters(file, materials, { text = '', machine = 'All', type = 'All' } = {}) {
  const q = String(text ?? '').trim().toLowerCase();
  const routings = new Map(routingsOf(file).map(r => [r.id, r]));
  const parts = new Map(partsOf(file).map(p => [p.id, p]));
  const partMatchesText = new Map(
    partsOf(file).map(p => [p.id, !q || partHaystack(materials, p).includes(q)]));

  const operationIds = new Set();
  const partIds = new Set();

  for (const op of operationsOf(file)) {
    const routing = routings.get(op.routing_id) || null;
    const part = routing ? parts.get(routing.part_id) || null : null;

    if (machine !== 'All' && op.machine_label !== machine) continue;
    if (type !== 'All') {
      const isType = type === 'Fixture' ? op.is_fixture : (!op.is_fixture && op.internal_external === type);
      if (!isType) continue;
    }
    const hit = !q
      || (part && partMatchesText.get(part.id))
      || operationHaystack(file, materials, op, part, routing).includes(q);
    if (!hit) continue;

    operationIds.add(op.id);
    if (part) partIds.add(part.id);
  }

  // A part that matches on its own fields stays visible even with no operations
  // (or none that survived a machine/type filter) — otherwise searching a part
  // number you just created would come back empty.
  if (q && machine === 'All' && type === 'All') {
    for (const p of partsOf(file)) if (partMatchesText.get(p.id)) partIds.add(p.id);
  } else if (!q && machine === 'All' && type === 'All') {
    for (const p of partsOf(file)) partIds.add(p.id);
  }

  return { operationIds, partIds };
}

// The most recent activity on a record: when it was last edited, else created.
export const recordActivityAt = (rec) => rec?.updated_at || rec?.created_at || '';

// A part's activity is the newest across the part itself and everything under
// it — editing an operation is activity on its part, which is how you find the
// thing you were last working on.
export function partActivityAt(file, part) {
  let newest = recordActivityAt(part);
  for (const r of routingsForPart(file, part.id)) {
    if (recordActivityAt(r) > newest) newest = recordActivityAt(r);
  }
  for (const o of operationsForPart(file, part.id)) {
    if (recordActivityAt(o) > newest) newest = recordActivityAt(o);
  }
  return newest;
}

// A part's highest program number — the tiebreak that makes "recently updated"
// useful straight after a CSV import, where every record shares one timestamp.
export function partNewestProgram(file, part) {
  const nums = operationsForPart(file, part.id)
    .map(o => Number(o.program_number))
    .filter(n => !isNaN(n) && n > 0);
  return nums.length ? Math.max(...nums) : -1;
}

export const PART_SORTS = [
  { key: 'activity', label: 'Recently updated' },
  { key: 'program', label: 'Newest program #' },
  { key: 'part', label: 'Part number' },
  { key: 'customer', label: 'Customer' },
];

const dirMul = (dir) => (dir === 'asc' ? 1 : -1);
const cmpStr = (a, b) => String(a ?? '').toLowerCase().localeCompare(String(b ?? '').toLowerCase());

export function sortParts(file, parts, key = 'activity', dir = 'desc') {
  const m = dirMul(dir);
  return [...parts].sort((a, b) => {
    switch (key) {
      case 'program': return m * (partNewestProgram(file, a) - partNewestProgram(file, b));
      case 'part': return m * cmpStr(a.part_number, b.part_number);
      case 'customer': return m * cmpStr(a.customer, b.customer) || cmpStr(a.part_number, b.part_number);
      default: {
        const d = m * cmpStr(partActivityAt(file, a), partActivityAt(file, b));
        // Same timestamp (a freshly imported batch) — fall back to the program
        // number so the order still means something.
        return d !== 0 ? d : m * (partNewestProgram(file, a) - partNewestProgram(file, b));
      }
    }
  });
}

// The table view sorts OPERATIONS by the same vocabulary, so switching views
// keeps the ordering you chose.
export function sortOperations(rows, key = 'activity', dir = 'desc') {
  const m = dirMul(dir);
  return [...rows].sort((a, b) => {
    switch (key) {
      case 'program': return m * ((Number(a.program_number) || -1) - (Number(b.program_number) || -1));
      case 'part': return m * cmpStr(a.part?.part_number, b.part?.part_number);
      case 'customer': return m * cmpStr(a.part?.customer, b.part?.customer);
      default: {
        const d = m * cmpStr(recordActivityAt(a), recordActivityAt(b));
        return d !== 0 ? d : m * ((Number(a.program_number) || -1) - (Number(b.program_number) || -1));
      }
    }
  });
}
