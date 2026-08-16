import { describe, it, expect } from 'vitest';
import { parseCsvRows } from './csv.js';

const cells = (text) => parseCsvRows(text).map(r => r.cells);

describe('parseCsvRows — quoted fields', () => {
  it('honors a quoted field containing commas', () => {
    expect(cells('a,"b,c",d')).toEqual([['a', 'b,c', 'd']]);
  });

  it('honors an escaped quote inside a quoted field', () => {
    expect(cells('a,"say ""hi""",b')).toEqual([['a', 'say "hi"', 'b']]);
  });

  it('honors a line break inside a quoted field', () => {
    // The shop's program-list export wraps its header cell this way.
    expect(cells('"\nProgram #",Machine\n1218,R650')).toEqual([
      ['\nProgram #', 'Machine'],
      ['1218', 'R650'],
    ]);
  });

  it('reads an empty quoted field', () => {
    expect(cells('a,"",b')).toEqual([['a', '', 'b']]);
  });
});

describe('parseCsvRows — a quote MID-field is data, not a quote', () => {
  // ⚠️ This is the bug that shipped: tool descriptions carry inch marks, and
  // treating one as an opening quote made the parser swallow every comma and
  // newline after it until the next quote anywhere in the file — gluing whole
  // rows into a single cell. A real posted Sequence Detail came through with
  // one tool's description holding the rest of its row plus the entire next row.
  it('keeps an inch mark and still ends the row', () => {
    const csv = [
      'Seq#,Tool #,T-description,LC',
      '115,B-259,1mm (.039) Ball 3FL EM .059LOC 7x Reach",LC-242',
      '115.1,B-259,1mm (.039) Ball 3FL EM,LC-242',
    ].join('\n');
    expect(cells(csv)).toEqual([
      ['Seq#', 'Tool #', 'T-description', 'LC'],
      ['115', 'B-259', '1mm (.039) Ball 3FL EM .059LOC 7x Reach"', 'LC-242'],
      ['115.1', 'B-259', '1mm (.039) Ball 3FL EM', 'LC-242'],
    ]);
  });

  it('keeps an inch mark in the middle of a value', () => {
    expect(cells('a,1/2" EM 4FL,b')).toEqual([['a', '1/2" EM 4FL', 'b']]);
  });

  it('does not let an odd number of inch marks run past the end of the file', () => {
    const rows = cells('a,.203" REACH,b\nc,d,e');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(['c', 'd', 'e']);
  });
});

describe('parseCsvRows — rows', () => {
  it('handles CRLF and a missing trailing newline', () => {
    expect(cells('a,b\r\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('reports the physical line each row started on', () => {
    const rows = parseCsvRows('a\nb\n"c\nd"\ne');
    expect(rows.map(r => r.line)).toEqual([1, 2, 3, 5]);
  });
});
