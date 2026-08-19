import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseSequenceCsv } from './sequenceDetail.js';
import {
  alignSequenceRows, compareSummary, rowIdentity, rowsMatch, rowsRelated,
  changedFields, valuesEqual, COMPARE_FIELDS, MATCH_WINDOW,
} from './sequenceCompare.js';

// A posted row as parseSequenceCsv produces it — only the fields the compare
// reads. `seq` is present precisely so the tests can prove it is NEVER compared.
const row = (seq, description, tool_id, over = {}) => ({
  seq: String(seq), description, tool_id,
  t: 'T38', t_num: 38, t_description: '1/16 BALL 3FL', holder: 'NBT30-SK13C-150', ooh: '0.70',
  cut_dia: '0.0625', tip: '0.031', lc: 'LC-244', rta: '', gage: 'H38',
  ...over,
});

const statuses = (pairs) => pairs.map(p => p.status);
const names = (pairs) => pairs.map(p => (p.right || p.left).description);

describe('value comparison', () => {
  it('⚠️ compares a number as a NUMBER so a format change does not light up the file', () => {
    // The post writes 0.70 where an older one wrote 0.7. Same stick-out.
    expect(valuesEqual('0.70', '0.7')).toBe(true);
    expect(valuesEqual('0.70', '0.75')).toBe(false);
  });

  it('ignores case and padding on text, but not real edits', () => {
    expect(valuesEqual(' NBT30-SK13C-150 ', 'nbt30-sk13c-150')).toBe(true);
    expect(valuesEqual('NBT30-SK13C-150', 'NBT30-SK13C-120')).toBe(false);
  });

  it('treats blank and missing as the same absence', () => {
    expect(valuesEqual('', undefined)).toBe(true);
    expect(valuesEqual('', '0')).toBe(false);
  });
});

describe('identity — what makes two rows the same operation', () => {
  it('is the toolpath name plus the tool that runs it', () => {
    expect(rowsMatch(row(10, 'Rough Top', 'B-261'), row(15, 'Rough Top', 'B261'))).toBe(true);
    expect(rowsMatch(row(10, 'Rough Top', 'B-261'), row(10, 'Rough Top', 'A-265'))).toBe(false);
  });

  it('⚠️ EXCLUDES holder and OOH — those are the changes worth seeing', () => {
    // If they broke the match, the very thing being looked for would show up as
    // an unrelated remove + add instead of a highlighted cell.
    const a = row(10, 'Rough Top', 'B-261', { holder: 'NBT30-SK13C-150', ooh: '0.70' });
    const b = row(10, 'Rough Top', 'B-261', { holder: 'NBT30-SK13C-120', ooh: '1.10' });
    expect(rowsMatch(a, b)).toBe(true);
    expect(changedFields(a, b)).toEqual(['holder', 'ooh']);
  });

  it('matches an insert pair however the post ordered the halves', () => {
    expect(rowIdentity(row(10, 'Face', 'I-224 / G-223')))
      .toBe(rowIdentity(row(10, 'Face', 'G223/I224')));
  });

  it('is not fooled into relating two unrelated operations', () => {
    expect(rowsRelated(row(10, 'Rough Top', 'B-261'), row(10, 'Drill Holes', 'D-101'))).toBe(false);
    expect(rowsRelated(row(10, 'Rough Top', 'B-261'), row(10, 'Rough Top v2', 'B-261'))).toBe(true);
  });
});

describe('⚠️ Seq# is displayed but never compared', () => {
  it('does not report a changed sequence number as a difference', () => {
    // Inserting an operation renumbers everything after it. That is the symptom
    // of the insertion, not a second finding — the alignment already reports it.
    expect(COMPARE_FIELDS.map(f => f.key)).not.toContain('seq');
    const pairs = alignSequenceRows(
      [row(10, 'Rough Top', 'B-261')],
      [row(25, 'Rough Top', 'B-261')],
    );
    expect(pairs[0].status).toBe('same');
    expect(pairs[0].changes).toEqual([]);
  });
});

describe('the columns the shop asked not to see', () => {
  it('ignores Cut Dia, Tip and Location entirely', () => {
    const a = row(10, 'Rough Top', 'B-261', { cut_dia: '0.0625', tip: '0.031', lc: 'LC-244' });
    const b = row(10, 'Rough Top', 'B-261', { cut_dia: '0.5000', tip: '0.125', lc: 'LC-900' });
    expect(alignSequenceRows([a], [b])[0].status).toBe('same');
  });
});

describe('alignment — the everyday cases', () => {
  const base = [
    row(10, 'Rough Top', 'B-261'),
    row(15, 'Finish Back', 'A-265'),
    row(20, 'Finish Flat', 'A-264'),
  ];

  it('reports an unchanged file as entirely unchanged', () => {
    const pairs = alignSequenceRows(base, base.map(r => ({ ...r })));
    expect(statuses(pairs)).toEqual(['same', 'same', 'same']);
    expect(compareSummary(pairs).identical).toBe(true);
  });

  it('catches the big one: same toolpath, different stick-out', () => {
    const next = base.map((r, k) => (k === 1 ? { ...r, ooh: '1.25' } : { ...r }));
    const pairs = alignSequenceRows(base, next);
    expect(statuses(pairs)).toEqual(['same', 'changed', 'same']);
    expect(pairs[1].changes).toEqual(['ooh']);
  });

  it('catches the other big one: same toolpath, different tool', () => {
    const next = base.map((r, k) => (k === 1 ? { ...r, tool_id: 'A-999' } : { ...r }));
    const pairs = alignSequenceRows(base, next);
    // A different tool is a different operation identity, but the toolpath name
    // still relates them, so it reads as one changed row rather than two.
    expect(statuses(pairs)).toEqual(['same', 'changed', 'same']);
    expect(pairs[1].changes).toContain('tool_id');
  });

  it('⚠️ resyncs after an inserted operation instead of lighting up the rest', () => {
    const next = [base[0], row(17, 'Chamfer Edge', 'L-124'), base[1], base[2]];
    const pairs = alignSequenceRows(base, next);
    expect(statuses(pairs)).toEqual(['same', 'added', 'same', 'same']);
    expect(names(pairs)[1]).toBe('Chamfer Edge');
  });

  it('resyncs after a removed operation the same way', () => {
    const next = [base[0], base[2]];
    const pairs = alignSequenceRows(base, next);
    expect(statuses(pairs)).toEqual(['same', 'removed', 'same']);
    expect(pairs[1].left.description).toBe('Finish Back');
  });

  it('reads a refined toolpath name as one changed row, not a remove and an add', () => {
    const next = base.map((r, k) => (k === 1 ? { ...r, description: 'Finish Back Contour' } : { ...r }));
    const pairs = alignSequenceRows(base, next);
    expect(statuses(pairs)).toEqual(['same', 'changed', 'same']);
    expect(pairs[1].changes).toEqual(['description']);
  });

  it('handles an empty side without inventing pairs', () => {
    expect(statuses(alignSequenceRows([], base))).toEqual(['added', 'added', 'added']);
    expect(statuses(alignSequenceRows(base, []))).toEqual(['removed', 'removed', 'removed']);
    expect(alignSequenceRows([], [])).toEqual([]);
  });
});

describe('⚠️ order is never rearranged', () => {
  const base = [
    row(10, 'A', 'T-1'), row(15, 'B', 'T-2'), row(20, 'C', 'T-3'), row(25, 'D', 'T-4'),
  ];

  it('emits every row in file order, left and right both', () => {
    const next = [base[0], row(12, 'X', 'T-9'), base[2], base[3]];
    const pairs = alignSequenceRows(base, next);
    // Left side, reading down, is still A B C D — nothing hoisted or sorted.
    expect(pairs.filter(p => p.left).map(p => p.left.description)).toEqual(['A', 'B', 'C', 'D']);
    expect(pairs.filter(p => p.right).map(p => p.right.description)).toEqual(['A', 'X', 'C', 'D']);
  });

  it('⚠️ reports a MOVED operation as removed then added, never as unchanged', () => {
    // B moved to the end. It is the same operation, but the machine now runs it
    // somewhere else — that IS the change, and calling it a match would hide the
    // single most consequential thing a re-post can do.
    const next = [base[0], base[2], base[3], base[1]];
    const pairs = alignSequenceRows(base, next);
    const b = pairs.filter(p => (p.left || p.right).description === 'B');
    expect(b.map(p => p.status).sort()).toEqual(['added', 'removed']);
    expect(pairs.some(p => p.status === 'same' && p.left?.description === 'B')).toBe(false);
  });

  it('never matches beyond the lookahead window', () => {
    // The same operation, but pushed further down than the window reaches: it is
    // reported where it actually is rather than paired across the gap.
    const filler = Array.from({ length: MATCH_WINDOW + 4 }, (_, k) => row(100 + k, `F${k}`, `Z-${k}`));
    const pairs = alignSequenceRows([row(10, 'A', 'T-1')], [...filler, row(99, 'A', 'T-1')]);
    expect(pairs.filter(p => p.status === 'same')).toHaveLength(0);
    expect(pairs.some(p => p.status === 'removed' && p.left.description === 'A')).toBe(true);
    expect(pairs.some(p => p.status === 'added' && p.right.description === 'A')).toBe(true);
  });
});

describe('a wholesale replacement does not claim edits that never happened', () => {
  it('reports unrelated replacing operations as removed and added', () => {
    const before = [row(10, 'A', 'T-1'), row(15, 'B', 'T-2')];
    const after = [row(10, 'X', 'Z-9'), row(15, 'Y', 'Z-8')];
    const pairs = alignSequenceRows(before, after);
    expect(statuses(pairs)).toEqual(['removed', 'removed', 'added', 'added']);
  });

  it('still pairs a run where each row is plainly the same operation edited', () => {
    const before = [row(10, 'A', 'T-1'), row(15, 'B', 'T-2')];
    const after = [row(10, 'A rev2', 'T-1'), row(15, 'B rev2', 'T-2')];
    const pairs = alignSequenceRows(before, after);
    expect(statuses(pairs)).toEqual(['changed', 'changed']);
  });
});

describe('idempotence and the summary', () => {
  it('running the compare twice gives the same answer', () => {
    const a = [row(10, 'A', 'T-1'), row(15, 'B', 'T-2')];
    const b = [row(10, 'A', 'T-1'), row(12, 'N', 'T-9'), row(15, 'B', 'T-2', { ooh: '2.0' })];
    expect(alignSequenceRows(a, b)).toEqual(alignSequenceRows(a, b));
  });

  it('counts what moved', () => {
    const a = [row(10, 'A', 'T-1'), row(15, 'B', 'T-2'), row(20, 'C', 'T-3')];
    const b = [row(10, 'A', 'T-1'), row(12, 'N', 'T-9'), row(20, 'C', 'T-3', { ooh: '9' })];
    const s = compareSummary(alignSequenceRows(a, b));
    expect(s).toMatchObject({ same: 1, added: 1, removed: 1, changed: 1, total: 4, identical: false });
  });
});

// ── Against the real posted file ─────────────────────────────────────────────
// The synthetic rows above pin the rules; this pins the rules against a file
// the cascade post actually wrote — repeated pockets, .1 sub-sequences, blank
// cells and all.
describe('the real posted O1218', () => {
  const REAL = readFileSync(fileURLToPath(new URL('./__fixtures__/O1218.csv', import.meta.url)), 'utf8');
  const rows = parseSequenceCsv(REAL).rows;

  it('reads a file against itself as entirely unchanged', () => {
    expect(rows.length).toBeGreaterThan(0);
    const pairs = alignSequenceRows(rows, parseSequenceCsv(REAL).rows);
    expect(compareSummary(pairs)).toMatchObject({ same: rows.length, changed: 0, added: 0, removed: 0 });
  });

  it('⚠️ a re-post that renumbers every sequence is still entirely unchanged', () => {
    // The commonest real re-post: nothing about the machining moved, but the
    // post emitted different sequence numbers. If Seq# were the key this would
    // report every row as different — the whole file lighting up for nothing.
    const renumbered = rows.map((r, k) => ({ ...r, seq: String(1000 + k * 5) }));
    expect(compareSummary(alignSequenceRows(rows, renumbered)).identical).toBe(true);
  });

  it('surfaces a stick-out change on one toolpath and nothing else', () => {
    const next = rows.map(r => (r.seq === '20' ? { ...r, ooh: '1.35' } : { ...r }));
    const pairs = alignSequenceRows(rows, next);
    const s = compareSummary(pairs);
    expect(s).toMatchObject({ changed: 1, added: 0, removed: 0 });
    expect(pairs.find(p => p.status === 'changed').changes).toEqual(['ooh']);
  });

  it('surfaces one inserted toolpath without disturbing the rest', () => {
    const extra = { ...rows[0], seq: '12', description: 'B Side OP60 | Extra Chamfer', tool_id: 'L-124' };
    const next = [rows[0], extra, ...rows.slice(1)].map((r, k) => ({ ...r, seq: String(10 + k * 5) }));
    const s = compareSummary(alignSequenceRows(rows, next));
    expect(s).toMatchObject({ added: 1, removed: 0, changed: 0, same: rows.length });
  });

  it('keeps a pocket that recurs at non-adjacent sequence numbers aligned', () => {
    // A-265 appears at 15 and again at 25 in this file. Two separate rows that
    // must stay two separate rows — collapsing or cross-matching them would
    // misreport the program order.
    const a265 = rows.filter(r => r.tool_id === 'A-265');
    expect(a265.length).toBeGreaterThan(1);
    const pairs = alignSequenceRows(rows, rows.map(r => ({ ...r })));
    expect(pairs.filter(p => p.right?.tool_id === 'A-265')).toHaveLength(a265.length);
  });
});
