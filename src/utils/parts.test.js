import { describe, it, expect } from 'vitest';
import {
  partsOf, routingsOf, operationsOf, routingsForPart, operationsForRouting,
  operationsForPart, operationByProgramNumber, partForOperation,
  nextProgramNumber, newPart, newRouting, newOperation,
  operationMaterial, alloyLabel, formatProgramNumber, formatOperation, routingLabel,
  customerColor, customerNames, isPalletMachine, machineOptions, searchPrograms,
  updatePartIn, updateRoutingIn, updateOperationIn,
  deleteOperationIn, deleteRoutingIn, deletePartIn,
  applyPartsFilters, sortParts, sortOperations, recordActivityAt,
  partActivityAt, partNewestProgram,
  addPartWithRoutingIn, addRoutingIn, addOperationIn,
} from './parts.js';

// A part with TWO routings — the case the whole model exists for: same part
// number, different fixturing/machine/process, all on one page.
const file = {
  version: 1,
  parts: [
    { id: 'pt1', part_number: 'HINGE-COVER', customer: 'Val', material_id: 'N_6061', material_custom: '' },
    { id: 'pt2', part_number: 'BRACKET', customer: 'Acme', material_id: null, material_custom: 'Delrin' },
  ],
  routings: [
    { id: 'rt1', part_id: 'pt1', name: 'Vise', rev: 'A', order: 0 },
    { id: 'rt2', part_id: 'pt1', name: 'Fixture plate', rev: 'B', order: 1 },
    { id: 'rt3', part_id: 'pt2', name: '', rev: '', order: 0 },
  ],
  operations: [
    { id: 'op60', routing_id: 'rt1', op_number: '60', program_number: 1218, machine_label: 'Brother R650' },
    { id: 'op50', routing_id: 'rt1', op_number: '50', program_number: 1217 },
    { id: 'op160', routing_id: 'rt1', op_number: '160RB', program_number: 1219 },
    { id: 'op10', routing_id: 'rt2', op_number: '10', program_number: 1300 },
    { id: 'insp', routing_id: 'rt2', op_number: '20', program_number: null },   // a step with no program
    { id: 'opb', routing_id: 'rt3', op_number: '10', program_number: 1400 },
  ],
};

describe('the three tiers', () => {
  it('reads a part\'s routings, and a routing\'s operations in OP order', () => {
    expect(routingsForPart(file, 'pt1').map(r => r.id)).toEqual(['rt1', 'rt2']);
    // OP50 before OP60 before OP160RB — numeric, not lexical ("160" < "50" as text).
    expect(operationsForRouting(file, 'rt1').map(o => o.op_number)).toEqual(['50', '60', '160RB']);
  });

  it('walks every operation on a part across ALL its routings', () => {
    // This is what the part page's all-tools list and label printing run on.
    // ⚠️ Routing by routing, in routing order — NOT interleaved by OP number.
    // Two routings are two different ways of making the part, so OP50 of the
    // vise setup and OP50 of the fixture-plate setup are unrelated steps; a
    // list that alternates between them reads as one impossible sequence.
    expect(operationsForPart(file, 'pt1').map(o => o.id)).toEqual(['op50', 'op60', 'op160', 'op10', 'insp']);
    expect(operationsForPart(file, 'pt2')).toHaveLength(1);
  });

  it('resolves an operation back up through its routing to its part', () => {
    // This is the whole reason a tool linked to a program is also linked to the
    // part: the chain is derivable, so nothing stores it twice.
    const op = operationsOf(file).find(o => o.id === 'op60');
    expect(partForOperation(file, op).part_number).toBe('HINGE-COVER');
    expect(partForOperation(file, { routing_id: 'nope' })).toBeNull();
  });
});

describe('program numbers', () => {
  it('finds an operation by its program number, the way the posted CSV names it', () => {
    expect(operationByProgramNumber(file, 1218).id).toBe('op60');
    expect(operationByProgramNumber(file, '1218').id).toBe('op60');
    expect(operationByProgramNumber(file, 9999)).toBeNull();
  });

  it('never matches a step that has NO program', () => {
    // Number(null) is 0, so a bare numeric compare made every inspection /
    // deburr step answer to program "0" — and to a null or blank query, which
    // is how a caller that forgot to guard gets an unrelated operation back
    // instead of nothing.
    expect(operationByProgramNumber(file, 0)).toBeNull();
    expect(operationByProgramNumber(file, null)).toBeNull();
    expect(operationByProgramNumber(file, '')).toBeNull();
    expect(operationByProgramNumber(file, undefined)).toBeNull();
    // Searching "0" in the picker must not list every program-less step either.
    expect(searchPrograms(file, '0')).toEqual([]);
  });

  it('is global, permanent and computed — max + 1, never a stored counter', () => {
    expect(nextProgramNumber(file)).toBe(1401);
  });

  it('ignores an operation with no program when computing the next number', () => {
    // Inspection / deburr / outside-process steps legitimately have none.
    expect(nextProgramNumber({ operations: [{ program_number: null }, { program_number: 1000 }] })).toBe(1001);
    expect(nextProgramNumber({ operations: [] })).toBe(1000);
  });

  it('deleting a non-max operation leaves the next number alone; deleting the max reclaims it', () => {
    expect(nextProgramNumber(deleteOperationIn(file, 'op50'))).toBe(1401);   // 1217 wasn't the max
    expect(nextProgramNumber(deleteOperationIn(file, 'opb'))).toBe(1301);    // 1400 was
  });
});

describe('rev lives on the routing, not the part', () => {
  it('keeps one part record per part number so everything is on one page', () => {
    // Two routings, two revs, ONE part.
    const revs = routingsForPart(file, 'pt1').map(r => r.rev);
    expect(revs).toEqual(['A', 'B']);
    expect(partsOf(file).filter(p => p.part_number === 'HINGE-COVER')).toHaveLength(1);
  });

  it('names a routing by what the user called it, else its rev, else its position', () => {
    expect(routingLabel({ name: 'Vise', rev: 'A' })).toBe('Vise');
    expect(routingLabel({ name: '', rev: 'B' })).toBe('Rev B');
    expect(routingLabel({ name: '', rev: '' }, 2)).toBe('Routing 3');
  });
});

describe('material', () => {
  it('derives a normal operation\'s material from the part, with no stored copy', () => {
    // Editing the part cascades everywhere by construction.
    const part = partsOf(file)[0];
    expect(operationMaterial({ is_fixture: false }, part)).toEqual({ material_id: 'N_6061', material_custom: '' });
  });

  it('lets a FIXTURE operation carry its own', () => {
    const part = partsOf(file)[0];
    const fix = { is_fixture: true, material_id: 'P_1018', material_custom: '' };
    expect(operationMaterial(fix, part).material_id).toBe('P_1018');
  });

  it('never stores material on a non-fixture operation', () => {
    const op = newOperation({ routing_id: 'r', op_number: '10', is_fixture: false, material_id: 'N_6061' });
    expect(op.material_id).toBeNull();
  });

  it('shows a dangling alloy id as a marker rather than vanishing', () => {
    expect(alloyLabel({ materials: [] }, 'gone', '')).toBe('(unknown alloy)');
    expect(alloyLabel({ materials: [] }, null, 'Delrin')).toBe('Delrin');
  });
});

describe('display forms', () => {
  it('shows a program number the way the control does, idempotently', () => {
    expect(formatProgramNumber(1218)).toBe('O1218');
    expect(formatProgramNumber('O1218')).toBe('O1218');
    expect(formatProgramNumber(null)).toBe('');
  });

  it('prefixes an OP token but leaves free text alone', () => {
    expect(formatOperation('50')).toBe('OP50');
    expect(formatOperation('OP50')).toBe('OP50');
    expect(formatOperation('160RB')).toBe('OP160RB');
    expect(formatOperation('Soft Jaw')).toBe('Soft Jaw');
  });

  it('gives a customer the same color every time', () => {
    expect(customerColor('Cadrex')).toBe(customerColor('cadrex '));
    expect(customerColor('')).toBeNull();
    expect(customerNames(file).sort()).toEqual(['Acme', 'Val']);
  });

  it('offers pallets only on the pallet-changer machine', () => {
    expect(isPalletMachine('Brother R650')).toBe(true);
    expect(isPalletMachine('Brother M300X3')).toBe(false);
    const op = newOperation({ routing_id: 'r', machine_label: 'Brother M300X3', pallet: '2' });
    expect(op.pallet).toBe('');
  });

  it('falls back to the stock machine pair when none are configured', () => {
    expect(machineOptions({}).map(m => m.label)).toEqual(['Brother M300X3', 'Brother R650']);
    expect(machineOptions({ machines: [{ id: 'x', model: 'Haas' }] })[0]).toMatchObject({ id: 'x', label: 'Haas' });
  });
});

describe('search', () => {
  it('puts an exact program number first, then part-number matches', () => {
    const rows = searchPrograms(file, '1218');
    expect(rows[0].operation.id).toBe('op60');
    expect(rows[0].part.part_number).toBe('HINGE-COVER');
    expect(rows[0].routing.name).toBe('Vise');
  });

  it('tolerates the O prefix the number is stamped with', () => {
    expect(searchPrograms(file, 'O1218')[0].operation.id).toBe('op60');
  });

  it('matches on part number', () => {
    expect(searchPrograms(file, 'hinge').length).toBe(5);
    expect(searchPrograms(file, '')).toEqual([]);
  });
});

describe('mutations', () => {
  it('edits each tier without touching the others', () => {
    expect(partsOf(updatePartIn(file, 'pt1', { customer: 'New' }))[0].customer).toBe('New');
    expect(routingsOf(updateRoutingIn(file, 'rt1', { name: 'X' }))[0].name).toBe('X');
    expect(operationsOf(updateOperationIn(file, 'op60', { op_number: '61' }))[0].op_number).toBe('61');
  });

  it('refuses to change a program number — permanent once reserved', () => {
    const next = updateOperationIn(file, 'op60', { program_number: 9999, op_number: '61' });
    const op = operationsOf(next).find(o => o.id === 'op60');
    expect(op.program_number).toBe(1218);   // untouched
    expect(op.op_number).toBe('61');        // the rest of the patch applied
  });

  it('cascades a delete down the tiers', () => {
    const noRouting = deleteRoutingIn(file, 'rt1');
    expect(routingsOf(noRouting).map(r => r.id)).toEqual(['rt2', 'rt3']);
    expect(operationsOf(noRouting).some(o => o.routing_id === 'rt1')).toBe(false);

    const noPart = deletePartIn(file, 'pt1');
    expect(partsOf(noPart).map(p => p.id)).toEqual(['pt2']);
    expect(routingsOf(noPart).map(r => r.id)).toEqual(['rt3']);
    expect(operationsOf(noPart).map(o => o.id)).toEqual(['opb']);
  });

  it('leaves other parts entirely alone on a cascade', () => {
    const noPart = deletePartIn(file, 'pt1');
    expect(operationByProgramNumber(noPart, 1400).id).toBe('opb');
  });
});

describe('factories', () => {
  it('stamps a stable uuid and the creator on every tier', () => {
    const p = newPart({ part_number: 'X' }, 'dy');
    const r = newRouting({ part_id: p.id, rev: 'A' }, 'dy');
    const o = newOperation({ routing_id: r.id, op_number: '10', program_number: 1000 }, 'dy');
    for (const rec of [p, r, o]) {
      expect(rec.id).toBeTruthy();
      expect(rec.created_by).toBe('dy');
      expect(rec.created_at).toBeTruthy();
    }
    expect(o.program_number).toBe(1000);
  });

  it('keeps a program-less operation as null, not zero', () => {
    // Zero would look like a real number to max+1 and to the CSV matcher.
    expect(newOperation({ routing_id: 'r', op_number: '20' }).program_number).toBeNull();
  });
});

describe('a routing is never nameless, and its name never moves', () => {
  it('stamps a stored default name when there is nothing else to call it', () => {
    // `order` is the count at creation, so the number is right at the time.
    expect(newRouting({ part_id: 'p', order: 0 }).name).toBe('Routing 1');
    expect(newRouting({ part_id: 'p', order: 1 }).name).toBe('Routing 2');
  });

  it('leaves the name blank when the rev already identifies it', () => {
    // The label then reads "Rev A", which says more than "Routing 1".
    const r = newRouting({ part_id: 'p', rev: 'A', order: 0 });
    expect(r.name).toBe('');
    expect(routingLabel(r)).toBe('Rev A');
  });

  it('keeps a name the user gave', () => {
    expect(newRouting({ part_id: 'p', name: 'Soft jaw', rev: 'B', order: 3 }).name).toBe('Soft jaw');
  });

  it('does NOT rename the survivors when an earlier routing is deleted', () => {
    // The bug a positional name would cause: delete Routing 1 and Routing 2
    // silently becomes "Routing 1" — a label moving under the user on a record
    // they never touched.
    const file = {
      parts: [{ id: 'p', part_number: 'X' }],
      routings: [newRouting({ part_id: 'p', order: 0 }), newRouting({ part_id: 'p', order: 1 })],
      operations: [],
    };
    expect(routingsForPart(file, 'p').map((r, i) => routingLabel(r, i))).toEqual(['Routing 1', 'Routing 2']);
    const after = deleteRoutingIn(file, file.routings[0].id);
    expect(routingsForPart(after, 'p').map((r, i) => routingLabel(r, i))).toEqual(['Routing 2']);
  });
});

describe('search, filter and sort — one result for both views', () => {
  const materials = { materials: [{ id: 'N_6061', label: '6061-T6', group_id: 'N' }] };
  const f = {
    parts: [
      { id: 'p1', part_number: 'HINGE-COVER', customer: 'Val', material_id: 'N_6061', created_at: '2026-01-01' },
      { id: 'p2', part_number: 'BRACKET', customer: 'Acme', material_custom: 'Delrin', created_at: '2026-02-01' },
    ],
    routings: [
      { id: 'r1', part_id: 'p1', name: 'Vise', rev: 'A', order: 0 },
      { id: 'r2', part_id: 'p2', name: '', rev: 'A', order: 0 },
    ],
    operations: [
      { id: 'o1', routing_id: 'r1', op_number: '50', program_number: 1217, machine_label: 'Brother M300X3', is_fixture: false, internal_external: 'External', created_at: '2026-01-02' },
      { id: 'o2', routing_id: 'r1', op_number: '60', program_number: 1218, machine_label: 'Brother R650', is_fixture: false, internal_external: 'External', created_at: '2026-01-03', updated_at: '2026-08-16' },
      { id: 'o3', routing_id: 'r2', op_number: '10', program_number: 1400, machine_label: 'Brother M300X3', is_fixture: true, internal_external: 'Internal', created_at: '2026-02-02' },
    ],
  };
  const filter = (opts) => applyPartsFilters(f, materials, opts);

  it('finds an operation by its program number, with or without the O', () => {
    expect([...filter({ text: '1218' }).operationIds]).toEqual(['o2']);
    expect([...filter({ text: 'O1218' }).operationIds]).toEqual(['o2']);
  });

  it('finds by part number, customer and material — and keeps the WHOLE part', () => {
    // Searching a part number shows everything under it, not just rows that
    // happen to repeat the number.
    expect([...filter({ text: 'hinge' }).operationIds].sort()).toEqual(['o1', 'o2']);
    expect([...filter({ text: 'acme' }).operationIds]).toEqual(['o3']);
    expect([...filter({ text: '6061' }).operationIds].sort()).toEqual(['o1', 'o2']);
    expect([...filter({ text: 'delrin' }).operationIds]).toEqual(['o3']);
  });

  it('finds by OP number, routing name and machine', () => {
    expect([...filter({ text: 'OP60' }).operationIds]).toEqual(['o2']);
    expect([...filter({ text: 'vise' }).operationIds].sort()).toEqual(['o1', 'o2']);
    expect([...filter({ text: 'r650' }).operationIds]).toEqual(['o2']);
  });

  it('narrows by machine and by type', () => {
    expect([...filter({ machine: 'Brother R650' }).operationIds]).toEqual(['o2']);
    expect([...filter({ type: 'Fixture' }).operationIds]).toEqual(['o3']);
    expect([...filter({ type: 'External' }).operationIds].sort()).toEqual(['o1', 'o2']);
  });

  it('drops a part entirely when nothing under it survives the filter', () => {
    expect([...filter({ machine: 'Brother R650' }).partIds]).toEqual(['p1']);
  });

  it('shows every part when nothing is filtered', () => {
    expect(filter({}).partIds.size).toBe(2);
    expect(filter({}).operationIds.size).toBe(3);
  });

  it('still finds a part that has no operations yet', () => {
    const bare = { ...f, parts: [...f.parts, { id: 'p3', part_number: 'NEW-PART', customer: '' }] };
    expect(applyPartsFilters(bare, materials, { text: 'new-part' }).partIds.has('p3')).toBe(true);
  });
});

describe('sorting', () => {
  const f = {
    parts: [
      { id: 'p1', part_number: 'ZULU', customer: 'Val', created_at: '2026-01-01' },
      { id: 'p2', part_number: 'ALPHA', customer: 'Acme', created_at: '2026-02-01' },
    ],
    routings: [
      { id: 'r1', part_id: 'p1', order: 0 },
      { id: 'r2', part_id: 'p2', order: 0 },
    ],
    operations: [
      { id: 'o1', routing_id: 'r1', op_number: '50', program_number: 1500, created_at: '2026-01-02' },
      { id: 'o2', routing_id: 'r2', op_number: '10', program_number: 1100, created_at: '2026-02-02', updated_at: '2026-08-16' },
    ],
  };

  it('defaults to the most recently touched part first', () => {
    // Editing an OPERATION is activity on its part — that's how you find what
    // you were last working on.
    expect(sortParts(f, f.parts).map(p => p.part_number)).toEqual(['ALPHA', 'ZULU']);
  });

  it('sorts by newest program number', () => {
    expect(sortParts(f, f.parts, 'program').map(p => p.part_number)).toEqual(['ZULU', 'ALPHA']);
  });

  it('falls back to the program number when timestamps tie', () => {
    // Straight after a CSV import every record shares one timestamp, so the
    // number is the only thing left that means anything.
    const flat = {
      ...f,
      operations: [
        { id: 'o1', routing_id: 'r1', program_number: 1500, created_at: '2026-01-01' },
        { id: 'o2', routing_id: 'r2', program_number: 1100, created_at: '2026-01-01' },
      ],
      parts: f.parts.map(p => ({ ...p, created_at: '2026-01-01' })),
    };
    expect(sortParts(flat, flat.parts).map(p => p.part_number)).toEqual(['ZULU', 'ALPHA']);
  });

  it('sorts by part number and customer, both directions', () => {
    expect(sortParts(f, f.parts, 'part', 'asc').map(p => p.part_number)).toEqual(['ALPHA', 'ZULU']);
    expect(sortParts(f, f.parts, 'part', 'desc').map(p => p.part_number)).toEqual(['ZULU', 'ALPHA']);
    expect(sortParts(f, f.parts, 'customer', 'asc').map(p => p.customer)).toEqual(['Acme', 'Val']);
  });

  it('sorts on keys computed once per part, matching the per-part helpers', () => {
    // ⚠️ sortParts precomputes both keys in ONE pass over the file, because
    // calling the helpers from inside the comparator re-walked every operation
    // O(n log n) times — 147ms at 400 parts, on every keystroke in the search
    // box. The fast path must not drift from the documented helpers.
    for (const p of f.parts) {
      const keyed = sortParts(f, [p]);          // exercises the indexed path
      expect(keyed).toEqual([p]);
    }
    expect(partActivityAt(f, f.parts[1])).toBe('2026-08-16');   // newest OP wins
    expect(partNewestProgram(f, f.parts[0])).toBe(1500);
    // A part with no operations falls back to its own timestamp, and to -1 for
    // the program tiebreak — it must not sort as if it had program 0.
    const lone = { ...f, parts: [...f.parts, { id: 'p3', part_number: 'MMM', created_at: '2026-03-01' }] };
    expect(partNewestProgram(lone, lone.parts[2])).toBe(-1);
    expect(sortParts(lone, lone.parts).map(x => x.part_number)).toEqual(['ALPHA', 'MMM', 'ZULU']);
  });

  it('sorts operation rows by the same vocabulary', () => {
    const rows = [
      { id: 'a', program_number: 1100, created_at: '2026-01-01', part: { part_number: 'B' } },
      { id: 'b', program_number: 1500, created_at: '2026-05-01', part: { part_number: 'A' } },
    ];
    expect(sortOperations(rows, 'program').map(r => r.id)).toEqual(['b', 'a']);
    expect(sortOperations(rows, 'activity').map(r => r.id)).toEqual(['b', 'a']);
    expect(sortOperations(rows, 'part', 'asc').map(r => r.id)).toEqual(['b', 'a']);
  });
});

describe('every edit stamps updated_at', () => {
  // "Recently updated" is only trustworthy if no screen can edit without it.
  const f = {
    parts: [{ id: 'p', part_number: 'X', created_at: '2026-01-01' }],
    routings: [{ id: 'r', part_id: 'p', order: 0, created_at: '2026-01-01' }],
    operations: [{ id: 'o', routing_id: 'r', program_number: 1000, created_at: '2026-01-01' }],
  };

  it('stamps it on a part, routing and operation edit alike', () => {
    expect(partsOf(updatePartIn(f, 'p', { customer: 'New' }))[0].updated_at).toBeTruthy();
    expect(routingsOf(updateRoutingIn(f, 'r', { name: 'N' }))[0].updated_at).toBeTruthy();
    expect(operationsOf(updateOperationIn(f, 'o', { op_number: '20' }))[0].updated_at).toBeTruthy();
  });

  it('reads created_at until the record has ever been edited', () => {
    expect(recordActivityAt({ created_at: '2026-01-01' })).toBe('2026-01-01');
    expect(recordActivityAt({ created_at: '2026-01-01', updated_at: '2026-05-01' })).toBe('2026-05-01');
  });
});

describe('creating records — one file→file step, never two writes', () => {
  // ⚠️ The bug this exists to prevent: a handler that called saveParts twice
  // built BOTH writes from the same pre-update file (React state doesn't change
  // mid-handler), so the second silently discarded the first — the new part
  // vanished and its routing was left pointing at nothing.
  const empty = { version: 1, parts: [], routings: [], operations: [] };

  it('creates a part and its first routing in ONE result', () => {
    const { file, part, routing } = addPartWithRoutingIn(empty, { part_number: 'NEW' }, { rev: 'A' }, 'dy');
    expect(file.parts).toHaveLength(1);
    expect(file.routings).toHaveLength(1);
    expect(routing.part_id).toBe(part.id);
    // The routing points at a part that is actually in the same file.
    expect(file.parts.some(p => p.id === routing.part_id)).toBe(true);
  });

  it('never leaves an orphan behind whichever record you look at', () => {
    const { file } = addPartWithRoutingIn(empty, { part_number: 'NEW' }, { rev: 'A' });
    const partIds = new Set(file.parts.map(p => p.id));
    expect(file.routings.every(r => partIds.has(r.part_id))).toBe(true);
  });

  it('adds a routing with the right order, and an operation into it', () => {
    let { file } = addPartWithRoutingIn(empty, { part_number: 'X' }, { rev: 'A' });
    const partId = file.parts[0].id;
    const second = addRoutingIn(file, partId, { name: 'Soft jaw' });
    expect(second.routing.order).toBe(1);          // after the first
    file = second.file;

    const withOp = addOperationIn(file, second.routing.id, { op_number: '50', program_number: 1000 });
    expect(withOp.operation.routing_id).toBe(second.routing.id);
    expect(withOp.file.operations).toHaveLength(1);
    // And the earlier records all survived.
    expect(withOp.file.parts).toHaveLength(1);
    expect(withOp.file.routings).toHaveLength(2);
  });

  it('orders operations within their own routing, not globally', () => {
    let file = { version: 1, parts: [], routings: [], operations: [] };
    file = addOperationIn(file, 'rA', { op_number: '10' }).file;
    file = addOperationIn(file, 'rA', { op_number: '20' }).file;
    const { operation } = addOperationIn(file, 'rB', { op_number: '10' });
    expect(operation.order).toBe(0);   // first in rB, not third overall
  });
});

describe('a part\'s operations run routing by routing, not interleaved', () => {
  // Sorting the whole set by OP number alone alternates between routings when
  // both start at OP50 — which reads as one confused sequence, and comes out of
  // the printer in that order.
  const f = {
    parts: [{ id: 'pt' }],
    routings: [
      { id: 'rA', part_id: 'pt', name: 'Vise', order: 0 },
      { id: 'rB', part_id: 'pt', name: 'Soft jaw', order: 1 },
    ],
    operations: [
      { id: 'b50', routing_id: 'rB', op_number: '50' },
      { id: 'a60', routing_id: 'rA', op_number: '60' },
      { id: 'a50', routing_id: 'rA', op_number: '50' },
      { id: 'b60', routing_id: 'rB', op_number: '60' },
    ],
  };

  it('groups by routing order, then by OP number within it', () => {
    expect(operationsForPart(f, 'pt').map(o => o.id)).toEqual(['a50', 'a60', 'b50', 'b60']);
  });

  it('still orders OP numbers numerically inside a routing', () => {
    const g = {
      ...f,
      operations: [
        { id: 'x160', routing_id: 'rA', op_number: '160RB' },
        { id: 'x50', routing_id: 'rA', op_number: '50' },
      ],
    };
    expect(operationsForPart(g, 'pt').map(o => o.id)).toEqual(['x50', 'x160']);
  });
});
