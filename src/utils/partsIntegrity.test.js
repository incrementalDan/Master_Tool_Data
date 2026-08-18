import { describe, it, expect } from 'vitest';
import {
  partsOf, routingsOf, operationsOf, routingsForPart, operationsForPart,
  nextProgramNumber, duplicateProgramNumbers, routingLabel,
  newPart, newRouting, newOperation,
  addPartWithRoutingIn, addRoutingIn, addOperationIn,
  updateOperationIn, deleteRoutingIn, deletePartIn,
} from './parts.js';
import { buildProgramsImport } from './programsImport.js';
import { DEFAULT_PARTS, DEFAULT_PROGRAM_DETAILS } from '../schema/sharedDefaults.js';
import demoParts from '../demo/demo_parts.json';

// STRUCTURAL INTEGRITY of parts.json — every FK resolves and every invariant the
// readers rely on holds, asserted over each shape the app can actually produce:
// the seed, the shipped demo data, a CSV import, a re-import, and a run of
// mutations. Promoted from a throwaway audit script so it runs on every commit.
//
// ⚠️ Deliberately synthetic. The CSV below is written here rather than read from
// a real program list — this repo is public, and a real export carries customer
// part numbers, revs and fixture names. Anything a real file would prove that
// this one doesn't (odd headers, blank rows) belongs in programsImport.test.js
// as its own named case, not as a checked-in customer export.

// Every rule stated once, so a new source of parts.json data can be handed
// straight to it. `label` is only there to name the failure.
function expectStructurallySound(file, label) {
  const parts = partsOf(file), routings = routingsOf(file), operations = operationsOf(file);
  const partIds = new Set(parts.map(p => p.id));
  const routingIds = new Set(routings.map(r => r.id));
  const ctx = (msg) => `${label}: ${msg}`;

  // ── Identity ──────────────────────────────────────────────────────────────
  expect(parts.every(p => p.id), ctx('every part has an id')).toBe(true);
  expect(new Set(parts.map(p => p.id)).size, ctx('part ids unique')).toBe(parts.length);
  expect(new Set(routings.map(r => r.id)).size, ctx('routing ids unique')).toBe(routings.length);
  expect(new Set(operations.map(o => o.id)).size, ctx('operation ids unique')).toBe(operations.length);

  // ── Foreign keys resolve ──────────────────────────────────────────────────
  expect(routings.every(r => partIds.has(r.part_id)), ctx('routing.part_id resolves')).toBe(true);
  expect(operations.every(o => routingIds.has(o.routing_id)), ctx('operation.routing_id resolves')).toBe(true);

  // ── Program numbers ───────────────────────────────────────────────────────
  // Null (a step with no program) or a positive integer — never 0 or '', both of
  // which read as a real number to nextProgramNumber and to the CSV matcher.
  expect(
    operations.every(o => o.program_number === null
      || (Number.isInteger(o.program_number) && o.program_number > 0)),
    ctx('program_number is null or a positive integer'),
  ).toBe(true);
  expect(duplicateProgramNumbers(file), ctx('program numbers unique shop-wide')).toEqual([]);
  const nums = operations.map(o => o.program_number).filter(n => n != null);
  if (nums.length) {
    expect(nextProgramNumber(file), ctx('next # is max + 1')).toBe(Math.max(...nums) + 1);
  }

  // ── Model rules ───────────────────────────────────────────────────────────
  // Rev lives on the ROUTING. A part keyed (number, rev) would be a second part
  // and a second page, which is the whole thing the one-page rule avoids.
  expect(parts.every(p => p.rev === undefined), ctx('no part carries a rev')).toBe(true);
  // A non-fixture operation derives its material from the part — no stored copy
  // to drift.
  expect(
    operations.every(o => o.is_fixture || (!o.material_id && !o.material_custom)),
    ctx('only fixture operations store their own material'),
  ).toBe(true);
  // Nothing can hang an operation off a part with no routing.
  expect(parts.every(p => routingsForPart(file, p.id).length > 0), ctx('every part has >= 1 routing')).toBe(true);
  // A routing label is a stored string, never derived from list position — a
  // positional name renames the survivors when one is deleted.
  expect(routings.every(r => routingLabel(r).trim() !== ''), ctx('every routing labels non-empty')).toBe(true);

  // ── Ordering ──────────────────────────────────────────────────────────────
  // A part's operations run routing by routing, never interleaved by OP number:
  // two routings are two different ways of making the part, so their OP50s are
  // unrelated steps and alternating between them reads as one impossible run.
  for (const p of parts) {
    const rank = new Map(routingsForPart(file, p.id).map((r, i) => [r.id, i]));
    const seen = operationsForPart(file, p.id).map(o => rank.get(o.routing_id));
    expect(seen.every((v, i) => i === 0 || v >= seen[i - 1]), ctx(`${p.part_number}: routings not interleaved`)).toBe(true);
  }
}

const CSV = [
  'Program #,Machine,Fixturing,Internal or external,internal Part #,Rev,Customer,Description,OP #,Fixture Y/N',
  'O1108,Brother M300X3,Vise,External,DEMO-1,A,Sample Co,Full part,50,N',
  'O1109,Brother M300X3,Vise,External,DEMO-1,A,Sample Co,Back side,60,N',
  // A BLANK program # — auto-assigned, and must land ABOVE every stated number.
  ',Brother R650,Soft jaw,External,DEMO-1,B,Sample Co,Rework,50,N',
  // A step on a different part, flagged as a fixture (carries its own material).
  'O1110,Brother M300X3,,Internal,FIX-9,,Sample Co,Fixture plate,10,Y',
].join('\n');

describe('parts.json is structurally sound in every shape the app produces', () => {
  it('the empty seed', () => {
    expectStructurallySound(DEFAULT_PARTS, 'seed');
    expect(DEFAULT_PROGRAM_DETAILS.details).toEqual([]);
  });

  it('the shipped demo data', () => {
    // This one ships to users in ?demo=true, so a broken FK here is visible.
    expectStructurallySound(demoParts, 'demo');
    expect(partsOf(demoParts).length).toBeGreaterThan(0);
  });

  it('a CSV import, and the same import run twice', () => {
    const first = buildProgramsImport(CSV, { partsFile: DEFAULT_PARTS, createdBy: 'test' });
    expectStructurallySound(first.mergedFile, 'imported once');
    expect(first.summary.errors).toEqual([]);

    // ⚠️ An auto-assigned number continues ABOVE everything, including the
    // numbers this same import just claimed. Starting from the pre-import max
    // handed a blank row a LOW free number (1000 in a file whose stated numbers
    // ran 1108+) — a hole-filler, and the opposite of the rule the rest of the
    // app follows.
    const stated = [1108, 1109, 1110];
    expect(first.summary.autoAssigned.every(n => n > Math.max(...stated))).toBe(true);

    // ⚠️ Re-importing must be a no-op. A blank-numbered row has no number to
    // dedupe on, so without the (routing, OP #) key a second run silently added
    // another copy of every such step.
    const second = buildProgramsImport(CSV, { partsFile: first.mergedFile, createdBy: 'test' });
    expectStructurallySound(second.mergedFile, 're-imported');
    expect(second.summary.operationsNew).toBe(0);
    expect(second.summary.autoAssigned).toEqual([]);
    expect(operationsOf(second.mergedFile).length).toBe(operationsOf(first.mergedFile).length);
  });

  it('a run of adds, edits and cascading deletes', () => {
    // ⚠️ A part is created WITH its first routing in ONE pure mutation. Two
    // saveParts calls in one handler both build off the same stale closure, so
    // the second discards the first — which stored the routing and threw the
    // part away.
    let f = DEFAULT_PARTS;
    const a = addPartWithRoutingIn(f, { part_number: 'DEMO-NEW' }, { rev: 'A' }, 'test');
    f = a.file;
    expect(partsOf(f)).toHaveLength(1);
    expect(routingsOf(f)).toHaveLength(1);

    const r2 = addRoutingIn(f, a.part.id, { rev: 'B' }, 'test'); f = r2.file;
    const o1 = addOperationIn(f, a.routing.id, { op_number: '50', program_number: 5000 }, 'test'); f = o1.file;
    const o2 = addOperationIn(f, r2.routing.id, { op_number: '50', program_number: 5001 }, 'test'); f = o2.file;
    expectStructurallySound(f, 'after adds');

    // A program number is permanent once reserved — a patch can never move it.
    const patched = updateOperationIn(f, o1.operation.id, { program_number: 9999, op_number: '55' });
    const moved = operationsOf(patched).find(o => o.id === o1.operation.id);
    expect(moved.program_number).toBe(5000);
    expect(moved.op_number).toBe('55');          // the rest of the patch still applies
    expectStructurallySound(patched, 'after a patch');

    // Deleting the highest reclaims its number; deleting a routing cascades.
    expect(nextProgramNumber(f)).toBe(5002);
    const afterRouting = deleteRoutingIn(f, r2.routing.id);
    expect(operationsOf(afterRouting)).toHaveLength(1);
    expect(nextProgramNumber(afterRouting)).toBe(5001);
    expectStructurallySound(afterRouting, 'after deleting a routing');

    const afterPart = deletePartIn(f, a.part.id);
    expect(partsOf(afterPart)).toEqual([]);
    expect(routingsOf(afterPart)).toEqual([]);
    expect(operationsOf(afterPart)).toEqual([]);
  });

  it('the factories alone produce sound records', () => {
    const part = newPart({ part_number: 'DEMO-F' }, 'test');
    const routing = newRouting({ part_id: part.id, rev: 'A', order: 0 }, 'test');
    const op = newOperation({ routing_id: routing.id, op_number: '10', program_number: 7000 }, 'test');
    expectStructurallySound({ version: 1, parts: [part], routings: [routing], operations: [op] }, 'factories');
  });
});
