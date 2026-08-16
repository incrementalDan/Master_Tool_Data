import { describe, it, expect } from 'vitest';
import {
  partsOf, routingsOf, operationsOf, routingsForPart, operationsForRouting,
  operationsForPart, operationByProgramNumber, partForOperation,
  nextProgramNumber, newPart, newRouting, newOperation,
  operationMaterial, alloyLabel, formatProgramNumber, formatOperation, routingLabel,
  customerColor, customerNames, isPalletMachine, machineOptions, searchPrograms,
  updatePartIn, updateRoutingIn, updateOperationIn,
  deleteOperationIn, deleteRoutingIn, deletePartIn,
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
    expect(operationsForPart(file, 'pt1').map(o => o.id)).toEqual(['op10', 'insp', 'op50', 'op60', 'op160']);
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
