import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseSequenceCsv, condenseTools, programNumberFromFileName, toolNumberOf,
  formatToolNumber, offsetOf, proShopIdKey, parsePosted, postedToIso,
} from './sequenceDetail.js';
import {
  buildSequenceImport, buildToolIndex, findToolByProShopId, locationConflict, upsertDetail,
  resolveRowLocation,
} from './sequenceImport.js';
import { archiveFileName } from '../context/programActions.js';
import { labelRows } from './toolLabels.js';

// A posted Sequence Detail for O1218 (B Side OP60) as the cascade post writes
// it — same run that would produce the matching G-code.
//
// ⚠️ SANITIZED. The header's part number, customer and fixture name are
// synthetic; this repo is public and a real posted file names the customer, the
// part and the fixture. Every STRUCTURAL property under test is the real
// article: the OO1218 double-O post typo, the pipe-delimited row 0, the POSTED
// stamp format, the FIXTURE line, the repeated-blank fill, and the pockets that
// recur at non-adjacent sequence numbers. Keep it that way — the value here is
// the SHAPE, never the contents.
const REAL = readFileSync(fileURLToPath(new URL('./__fixtures__/O1218.csv', import.meta.url)), 'utf8');

// Part → Routing → Operation; the program number lives on the operation.
const partsFile = {
  version: 1,
  parts: [{ id: 'part-1', part_number: 'DEMO-BRACKET-LEFT', customer: 'Val' }],
  routings: [{ id: 'rt-1', part_id: 'part-1', name: '', rev: 'B', order: 0 }],
  operations: [{ id: 'prg-1', routing_id: 'rt-1', program_number: 1218, op_number: '60' }],
};

const tools = [
  { id: 'FTL-B261', tool_id: 'B-261', location: 'LC-244', legacy_ids: [] },
  { id: 'FTL-A265', tool_id: 'A-265', location: '', legacy_ids: [] },
  { id: 'FTL-A264', tool_id: 'A-264', location: 'LC-247', legacy_ids: [] },
];

const build = (over = {}) => buildSequenceImport({
  csvText: REAL, fileName: 'O1218.csv', partsFile, tools, ...over,
});

describe('parseSequenceCsv — the real posted file', () => {
  const parsed = parseSequenceCsv(REAL);

  it('reads every toolpath row', () => {
    // 7 operations: 10, 10.1, 15, 15.1, 20, 20.1, 25 — rows 0 and 0.5 are not
    // operations and must never be counted as one.
    expect(parsed.rows.map(r => r.seq)).toEqual(['10', '10.1', '15', '15.1', '20', '20.1', '25']);
  });

  it('keeps rows 0 and 0.5 raw instead of parsing them as toolpaths', () => {
    expect(parsed.headerRaw).toContain('NC PRG: OO1218');
    expect(parsed.fixtureRaw).toBe('FIXTURE = F00 B Side Fixture - DEMO-BRACKET-RIGHT LEFT');
  });

  it('reads the POSTED stamp — the version key that pairs CSV to G-code', () => {
    expect(parsed.posted).toBe('8-10-2026 10:51');
    expect(postedToIso(parsed.posted)).toBe('2026-08-10T10:51:00');
  });

  it('preserves values as written — never re-formats a number', () => {
    const r = parsed.rows[0];
    expect(r.ooh).toBe('0.70');          // not 0.7
    expect(r.cut_dia).toBe('0.0625');    // not 0.063
    expect(r.holder).toBe('NBT30-SK13C-150');
    expect(r.tool_id).toBe('B-261');
  });
});

describe('condenseTools', () => {
  const condensed = condenseTools(parseSequenceCsv(REAL).rows);

  it('gives one row per POCKET, ordered by T#', () => {
    expect(condensed.map(t => t.t)).toEqual(['T38', 'T56', 'T57']);
  });

  it('collapses a tool used at non-adjacent sequence numbers into one entry', () => {
    // A-265 runs at 15, 15.1 and again at 25 — one pocket, one setup, one label.
    const t56 = condensed.find(t => t.t === 'T56');
    expect(t56.seqs).toEqual(['15', '15.1', '25']);
    expect(t56.tool_id).toBe('A-265');
  });

  it('keeps the same tool in two pockets as two separate rows', () => {
    const twoPockets = condenseTools([
      { seq: '10', t: 'T03', t_num: 3, tool_id: 'A-35', holder: 'NBT30-SK13C-60', ooh: '0.61', t_description: '3/16 EM' },
      { seq: '15', t: 'T04', t_num: 4, tool_id: 'A-35', holder: 'NBT30-SK13C-60', ooh: '0.61', t_description: '3/16 EM' },
    ]);
    expect(twoPockets).toHaveLength(2);
    expect(twoPockets.map(t => t.t)).toEqual(['T03', 'T04']);
  });

  it('fills a blank from a later row but never overwrites a value the CSV gave', () => {
    const rows = [
      { seq: '10', t: 'T5', t_num: 5, tool_id: 'A-1', holder: '', ooh: '1.20', t_description: 'EM' },
      { seq: '10.1', t: 'T5', t_num: 5, tool_id: 'A-1', holder: 'NBT30-SK13C-60', ooh: '9.99', t_description: 'EM' },
    ];
    const [t] = condenseTools(rows);
    expect(t.holder).toBe('NBT30-SK13C-60');   // gap filled
    expect(t.ooh).toBe('1.20');                // first value kept, not replaced
  });
});

describe('tool numbers and offsets', () => {
  it('treats T5, T05 and 5 as the same pocket', () => {
    expect([toolNumberOf('T5'), toolNumberOf('T05'), toolNumberOf('5'), toolNumberOf('t05')])
      .toEqual([5, 5, 5, 5]);
  });

  it('derives H and D from T rather than reading the CSV columns', () => {
    // The post enforces H = D = T, and the H column is known to carry an
    // incorrect gauge-length reference in newer files.
    expect(formatToolNumber(38)).toBe('T38');
    expect(offsetOf(38)).toBe('38');
    expect(offsetOf(3)).toBe('03');
  });
});

describe('programNumberFromFileName — the filename is the truth', () => {
  it('reads the number from the filename in its usual forms', () => {
    expect(programNumberFromFileName('O1218.csv')).toBe(1218);
    expect(programNumberFromFileName('1218.csv')).toBe(1218);
    expect(programNumberFromFileName('o1218 (1).csv')).toBe(1218);
  });

  it('ignores the row-0 program number, which carries a known post typo', () => {
    // Row 0 of the real file says "OO1218" (double-O). Matching on it would
    // fail; matching on the filename succeeds.
    expect(parsePosted(parseSequenceCsv(REAL).headerRaw)).toBe('8-10-2026 10:51');
    expect(build().program.id).toBe('prg-1');
  });
});

describe('proShopIdKey — combined insert ids', () => {
  it('matches an insert pair regardless of order or spacing', () => {
    const a = proShopIdKey('I-224 / G-223');
    expect(proShopIdKey('G-223/I-224')).toBe(a);
    expect(proShopIdKey('g223 / i224')).toBe(a);
    expect(proShopIdKey('I-224/G-223')).toBe(a);
  });

  it('still tells two different pairs apart', () => {
    expect(proShopIdKey('I-224/G-223')).not.toBe(proShopIdKey('I-224/G-999'));
  });

  it('normalizes an ordinary id without confusing it with another', () => {
    expect(proShopIdKey('a-35')).toBe(proShopIdKey('A35'));
    expect(proShopIdKey('A-35')).not.toBe(proShopIdKey('A-36'));
  });
});

describe('buildSequenceImport — linking', () => {
  it('links every tool by ProShop id and stores the FK, not the number', () => {
    const { blockers, detail } = build();
    expect(blockers).toEqual([]);
    expect(detail.tools.map(t => t.tool_ref)).toEqual(['FTL-B261', 'FTL-A265', 'FTL-A264']);
  });

  it('stores the CSV value for every printed field', () => {
    const t38 = build().detail.tools[0];
    expect(t38).toMatchObject({
      t: 'T38', tool_id: 'B-261', holder: 'NBT30-SK13C-150', ooh: '0.70', lc: 'LC-244',
      description: '1/16 (.0625) BALL 3FL .093LOC',
    });
  });

  it('matches a legacy id, and says it did', () => {
    // A CSV posted before an ID-scheme renumber names the OLD number for a tool
    // that is still in the library. Blocking there would be the app failing on
    // a change the app itself made.
    const renumbered = [
      { id: 'FTL-B261', tool_id: 'NEW-1', location: '', legacy_ids: ['B-261'] },
      ...tools.slice(1),
    ];
    const { blockers, detail, flags } = build({ tools: renumbered });
    expect(blockers).toEqual([]);
    expect(detail.tools[0].tool_ref).toBe('FTL-B261');
    expect(detail.tools[0].matched_via).toBe('legacy_id');
    expect(flags.legacy).toHaveLength(1);
  });

  it('prefers the current id when a number is both current and legacy elsewhere', () => {
    const index = buildToolIndex([
      { id: 'FTL-OLD', tool_id: 'X-9', legacy_ids: ['A-35'] },
      { id: 'FTL-NOW', tool_id: 'A-35', legacy_ids: [] },
    ]);
    expect(findToolByProShopId(index, 'A-35')).toMatchObject({ tool: { id: 'FTL-NOW' }, via: 'tool_id' });
  });
});

describe('buildSequenceImport — blocking', () => {
  it('blocks when no program record matches the filename', () => {
    const { blockers, detail } = build({ fileName: 'O9999.csv' });
    expect(blockers.map(b => b.type)).toContain('no_program');
    expect(detail).toBeNull();
  });

  it('blocks the WHOLE upload when any ProShop Tool # is not in the library', () => {
    // A partially-stored program prints a partial set of labels, which is worse
    // than printing none.
    const { blockers } = build({ tools: tools.slice(0, 2) });
    const b = blockers.find(x => x.type === 'no_tool');
    expect(b.rows).toEqual([{ t: 'T57', tool_id: 'A-264', description: '1/16 (.0625) 3FL EM .093LOC .312REACH' }]);
  });

  it('blocks a file that is not a Sequence Detail export', () => {
    const { blockers } = buildSequenceImport({
      csvText: 'Program #,Machine\n1218,R650\n', fileName: 'O1218.csv', partsFile, tools,
    });
    expect(blockers.map(b => b.type)).toContain('columns');
  });
});

describe('buildSequenceImport — flags (surfaced, never resolved)', () => {
  it('flags a location disagreement and still stores the CSV value', () => {
    const moved = [{ ...tools[0], location: 'LC-999' }, ...tools.slice(1)];
    const { flags, detail } = build({ tools: moved });
    expect(flags.lc).toEqual([{ t: 'T38', tool_id: 'B-261', csv: 'LC-244', app: 'LC-999' }]);
    expect(detail.tools[0].lc).toBe('LC-244');   // CSV wins
  });

  it('compares location on the bin number only', () => {
    expect(locationConflict('244', { location: 'LC-244' })).toBeNull();
    expect(locationConflict('LC-244', { location: 'LC-244' })).toBeNull();
    expect(locationConflict('', { location: 'LC-244' })).toBeNull();   // nothing to disagree about
    expect(locationConflict('LC-1', { location: 'LC-2' })).not.toBeNull();
  });

  it('flags an unmatched holder without substituting a library value', () => {
    const { flags, detail } = build({ holderRecords: [{ id: 'h1', description: 'NBT30-SK13C-150' }] });
    expect(detail.tools[0].holder_id).toBe('h1');
    expect(detail.tools[1].holder_id).toBeNull();
    expect(flags.holders.map(h => h.t)).toEqual(['T56', 'T57']);
    expect(detail.tools[1].holder).toBe('NBT30-SK13-120 OOH2.33 ER16EX 12mm');  // still the CSV's
  });

  it('never matches an archived holder', () => {
    const { detail } = build({ holderRecords: [{ id: 'h1', description: 'NBT30-SK13C-150', archived: true }] });
    expect(detail.tools[0].holder_id).toBeNull();
  });
});

describe('versions', () => {
  it('lands a new version unproven — uploading a CSV never means it ran', () => {
    expect(build().detail.proven).toBe(false);
  });

  it('treats the same POSTED stamp as the same version and keeps its proven state', () => {
    const prior = {
      id: 'det-1', operation_id: 'prg-1', posted: '8-10-2026 10:51',
      proven: true, proven_at: '2026-08-11T00:00:00', proven_by: 'DY', raw_file_id: 'drive-1',
    };
    const { detail, sameVersion } = build({ existingDetails: [prior] });
    expect(sameVersion).toBe(true);
    expect(detail).toMatchObject({ id: 'det-1', proven: true, proven_by: 'DY' });
  });

  it('drops proven when a NEW version is posted', () => {
    const prior = { id: 'det-1', operation_id: 'prg-1', posted: '8-01-2026 09:00', proven: true, proven_by: 'DY' };
    const { detail, sameVersion } = build({ existingDetails: [prior] });
    expect(sameVersion).toBe(false);
    expect(detail).toMatchObject({ id: 'det-1', proven: false, proven_by: '' });
  });

  it('stores only the latest parsed data per program', () => {
    const file = { version: 1, details: [{ id: 'a', operation_id: 'prg-1', posted: 'old' }, { id: 'b', operation_id: 'prg-2' }] };
    const next = upsertDetail(file, { id: 'a', operation_id: 'prg-1', posted: 'new' });
    expect(next.details).toHaveLength(2);
    expect(next.details.find(d => d.operation_id === 'prg-1').posted).toBe('new');
    expect(next.details.find(d => d.operation_id === 'prg-2')).toBeTruthy();
  });
});

describe('archive naming', () => {
  it('names a retired version by its posted stamp and proven state', () => {
    // Chronologically sortable in Drive, and the proven state travels with the
    // version rather than the program.
    expect(archiveFileName(1218, '8-10-2026 10:51', false)).toBe('O1218_20260810-1051_unproven.csv');
    expect(archiveFileName(1218, '8-10-2026 10:51', true)).toBe('O1218_20260810-1051_proven.csv');
  });

  it('never invents a date when the stamp is unreadable', () => {
    expect(archiveFileName(1218, '', false)).toBe('O1218_unknown_unproven.csv');
  });
});

describe('idempotence', () => {
  it('re-importing the same file produces the same rows', () => {
    const a = build().detail.tools;
    const b = build().detail.tools;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe('location — the app wins, and the file is left alone', () => {
  // ⚠️ The one deliberate exception to "the CSV wins". The CSV's LC comes from
  // Fusion's vendor field, which the app updates lazily, so a posted file
  // routinely names a bin the shop has since changed — and ToolDex owns
  // location. This changes display and print only.
  const byId = (loc) => new Map([['FTL-B261', { id: 'FTL-B261', location: loc }]]);

  it('resolves to the app value when the tool has one', () => {
    const row = { tool_ref: 'FTL-B261', lc: 'LC-244' };
    expect(resolveRowLocation(row, byId('LC-99')))
      .toEqual({ value: 'LC-99', source: 'app', csv: 'LC-244', app: 'LC-99' });
  });

  it('keeps the posted value when the app has none', () => {
    expect(resolveRowLocation({ tool_ref: 'FTL-B261', lc: 'LC-244' }, byId('')))
      .toMatchObject({ value: 'LC-244', source: 'csv' });
    expect(resolveRowLocation({ tool_ref: null, lc: 'LC-244' }, byId('LC-99')))
      .toMatchObject({ value: 'LC-244', source: 'csv' });
  });

  it('still STORES the posted value verbatim — nothing rewrites the import', () => {
    const { detail } = build();
    expect(detail.tools[0].lc).toBe('LC-244');
  });
});

// The seam between the two halves of the feature: the rows buildSequenceImport
// stores are the rows labelRows prints. Each half is well covered on its own,
// and nothing crossed the join — so a change to the stored row shape could pass
// every test and still print blank tags.
describe('a stored detail prints labels end to end', () => {
  const part = partsFile.parts[0];
  const toolsById = new Map(tools.map(t => [t.id, t]));

  it('turns the stored rows straight into labels, no reshaping', () => {
    const { detail } = build();
    const labels = labelRows(detail.tools, part, toolsById);

    // Three pockets in this file, all distinct assemblies → three tags.
    expect(labels).toHaveLength(3);
    expect(labels.every(l => l.TCode && l.ToolNo && l.Description)).toBe(true);
    expect(labels.map(l => l.TCode)).toEqual(['T38', 'T56', 'T57']);
    // The part travels onto every tag from the app's record, not the CSV header.
    expect(labels.every(l => l.PartNumber === 'DEMO-BRACKET-LEFT')).toBe(true);
  });

  it('prints the app location and the posted one where they differ', () => {
    // B-261 is on LC-244 in the file; the library agrees. A-264 is the drift
    // case — move it in the library and the tag follows, with no re-upload.
    const moved = new Map(toolsById);
    moved.set('FTL-A264', { ...toolsById.get('FTL-A264'), location: 'LC-900' });
    const { detail } = build();
    const byTool = Object.fromEntries(
      labelRows(detail.tools, part, moved).map(l => [l.ToolNo, l.Location]));
    expect(byTool['A-264']).toBe('LC-900');       // app wins
    expect(byTool['B-261']).toBe('LC-244');       // agrees either way
    // ...and the file's own value is untouched in storage.
    expect(detail.tools.find(t => t.tool_id === 'A-264').lc).toBe('LC-247');
  });

  it('survives the round trip through storage', () => {
    // What is printed comes off the STORED record, not the in-memory build —
    // so anything upsertDetail drops would show up here.
    const { detail } = build();
    const stored = upsertDetail({ version: 1, details: [] }, detail).details[0];
    expect(labelRows(stored.tools, part, toolsById))
      .toEqual(labelRows(detail.tools, part, toolsById));
  });
});
