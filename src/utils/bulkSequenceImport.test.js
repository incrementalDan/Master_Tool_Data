import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bareProShopNumber, PROSHOP_MAX, parseSequenceCsv } from './sequenceDetail.js';
import { buildToolIndex, findToolByProShopId, buildSequenceImport } from './sequenceImport.js';

const REAL = readFileSync(fileURLToPath(new URL('./__fixtures__/O1218.csv', import.meta.url)), 'utf8');

const partsFile = {
  version: 1,
  parts: [{ id: 'part-1', part_number: 'DEMO-BRACKET-LEFT' }],
  routings: [{ id: 'rt-1', part_id: 'part-1', rev: 'B', order: 0 }],
  operations: [{ id: 'op-1', routing_id: 'rt-1', program_number: 1218, op_number: '60' }],
};
const tools = [
  { id: 'FTL-B261', tool_id: 'B-261', legacy_ids: [] },
  { id: 'FTL-A265', tool_id: 'A-265', legacy_ids: [] },
  { id: 'FTL-A264', tool_id: 'A-264', legacy_ids: [] },
];

describe('bareProShopNumber — the loose match key', () => {
  it('reads the number out however the id was written', () => {
    for (const v of ['A-265', 'a 265', 'A265', '265', 'A-0265']) {
      expect(bareProShopNumber(v)).toBe('265');
    }
  });

  it('⚠️ refuses anything above 999 — that is not a ProShop number', () => {
    // ProShop's counter has not reached four digits, so a bigger value is
    // almost certainly a manufacturer part number in the wrong column. Matching
    // it on digits would attach a real program to the wrong tool.
    expect(bareProShopNumber('12345')).toBe(null);
    expect(bareProShopNumber(`A-${PROSHOP_MAX}`)).toBe(String(PROSHOP_MAX));
    expect(bareProShopNumber(`A-${PROSHOP_MAX + 1}`)).toBe(null);
  });

  it('⚠️ refuses a combined insert id — it holds two numbers, not one', () => {
    expect(bareProShopNumber('I-224 / G-223')).toBe(null);
    expect(bareProShopNumber('G223/I224')).toBe(null);
  });

  it('has nothing to offer for a blank or letters-only value', () => {
    expect(bareProShopNumber('')).toBe(null);
    expect(bareProShopNumber('SPARE')).toBe(null);
    expect(bareProShopNumber(null)).toBe(null);
  });
});

describe('findToolByProShopId — loose is OFF unless asked for', () => {
  const index = buildToolIndex(tools);

  it('matches an exact id either way', () => {
    expect(findToolByProShopId(index, 'A-265').tool.id).toBe('FTL-A265');
    expect(findToolByProShopId(index, 'A-265', { loose: true }).tool.id).toBe('FTL-A265');
  });

  it('⚠️ a deliberate upload does NOT fall back to the bare number', () => {
    // There, a miss means something is wrong and the person is right there to
    // fix it — guessing would hide that.
    expect(findToolByProShopId(index, 'X-265').tool).toBe(null);
  });

  it('the bulk pass resolves a mis-lettered id on its number, and says it did', () => {
    const r = findToolByProShopId(index, 'X-265', { loose: true });
    expect(r.tool.id).toBe('FTL-A265');
    expect(r.via).toBe('number');
  });

  it('resolves a retired number loosely too', () => {
    const idx = buildToolIndex([{ id: 'FTL-1', tool_id: 'B-900', legacy_ids: ['A-42'] }]);
    expect(findToolByProShopId(idx, 'Z-42', { loose: true }).via).toBe('legacy_number');
  });

  it('⚠️ refuses to guess when two tools claim the same number', () => {
    // Shop-wide numbering means this shouldn't happen — but a loose match that
    // picked one would attach a program to the wrong tool, silently, in bulk.
    const idx = buildToolIndex([
      { id: 'FTL-1', tool_id: 'A-265', legacy_ids: [] },
      { id: 'FTL-2', tool_id: 'G-265', legacy_ids: [] },
    ]);
    expect(idx.ambiguous.has('265')).toBe(true);
    expect(findToolByProShopId(idx, 'X-265', { loose: true }).tool).toBe(null);
    // An EXACT id is still unambiguous and still matches.
    expect(findToolByProShopId(idx, 'G-265', { loose: true }).tool.id).toBe('FTL-2');
  });

  it('never loose-matches a manufacturer part number onto a real tool', () => {
    expect(findToolByProShopId(index, '2650000', { loose: true }).tool).toBe(null);
  });
});

describe('⚠️ the bulk pass does not block on an unmatched tool', () => {
  const build = (over) => buildSequenceImport({
    csvText: REAL, fileName: 'O1218.csv', partsFile, tools: [tools[0]], ...over,
  });

  it('a deliberate upload still blocks the WHOLE file', () => {
    const r = build({});
    expect(r.blockers.map(b => b.type)).toContain('no_tool');
  });

  it('the bulk pass stores the file, with the unmatched rows flagged', () => {
    const r = build({ allowUnmatchedTools: true });
    expect(r.blockers).toEqual([]);
    expect(r.detail).not.toBe(null);
    expect(r.flags.unmatched.length).toBeGreaterThan(0);
    // The row is stored with the CSV's own number and no link — that IS the flag.
    const orphan = r.detail.tools.find(t => !t.tool_ref);
    expect(orphan.tool_id).toBeTruthy();
    expect(orphan.tool_ref).toBe(null);
  });

  it('still links every row it CAN link', () => {
    const r = build({ allowUnmatchedTools: true });
    expect(r.detail.tools.filter(t => t.tool_ref).length).toBeGreaterThan(0);
  });

  it('⚠️ never relaxes the blockers that are structural, not policy', () => {
    // No program record: a detail is keyed on operation_id, so there is nothing
    // to attach it to. Not a choice.
    const noProgram = buildSequenceImport({
      csvText: REAL, fileName: 'O9999.csv', partsFile, tools,
      allowUnmatchedTools: true, looseToolMatch: true,
    });
    expect(noProgram.blockers.map(b => b.type)).toContain('no_program');
    expect(noProgram.detail).toBe(null);

    // Not a Sequence Detail export at all.
    const notASequence = buildSequenceImport({
      csvText: 'a,b,c\n1,2,3', fileName: 'O1218.csv', partsFile, tools,
      allowUnmatchedTools: true, looseToolMatch: true,
    });
    expect(notASequence.blockers.length).toBeGreaterThan(0);
  });

  it('reports a loose match separately from an exact one', () => {
    const relettered = [{ id: 'FTL-A265', tool_id: 'Q-265', legacy_ids: [] }, tools[0], tools[2]];
    const r = buildSequenceImport({
      csvText: REAL, fileName: 'O1218.csv', partsFile, tools: relettered,
      allowUnmatchedTools: true, looseToolMatch: true,
    });
    expect(r.flags.loose.length).toBeGreaterThan(0);
    expect(r.flags.unmatched).toEqual([]);
  });
});

describe('an older export with fewer columns', () => {
  // Drop the fixture line, Cut Diameter, Gage Length and Tip — the columns the
  // shop says old posted files lack.
  const OLD = [
    'Seq,Sequence Description,Tool #,G-Code Tool #,OOH,Holder,T-description,LC',
    '0,NC PRG: OO1218 | POSTED: 8-10-2026 10:51,,,,,,',
    '10,Rough Top,B-261,T38,0.70,NBT30-SK13C-150,1/16 BALL,LC-244',
    '15,Finish Back,A-265,T56,0.60,NBT30-SK13-120,1mm EM,',
  ].join('\n');

  it('⚠️ finds the header row when it says "Seq" rather than "Seq#"', () => {
    // Failing here reports "this isn't a Sequence Detail export" about the
    // shop's own posted file, which is the wrong thing to say.
    const parsed = parseSequenceCsv(OLD);
    expect(parsed.missingColumns).toEqual([]);
    expect(parsed.rows.map(r => r.seq)).toEqual(['10', '15']);
    expect(parsed.posted).toBe('8-10-2026 10:51');
  });

  it('imports it, leaving the absent columns blank rather than failing', () => {
    const r = buildSequenceImport({
      csvText: OLD, fileName: 'O1218.csv', partsFile, tools,
      allowUnmatchedTools: true, looseToolMatch: true,
    });
    expect(r.blockers).toEqual([]);
    expect(r.detail.tools).toHaveLength(2);
    expect(r.detail.tools[0].cut_dia).toBe('');
    expect(r.detail.tools[0].holder).toBe('NBT30-SK13C-150');
  });
});
