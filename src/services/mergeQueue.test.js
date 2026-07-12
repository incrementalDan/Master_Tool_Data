import { describe, it, expect } from 'vitest';
import { parseIncoming, buildQueue, queueProgress } from './mergeQueue.js';

// ─── parseIncoming: JSON path ─────────────────────────────────────────────────

// Minimal raw Fusion library entry (what a JSON paste contains).
const fusionRaw = (over = {}) => ({
  guid: 'fus-guid-1',
  type: 'flat end mill',
  description: '1/2 4FL EM',
  unit: 'inches',
  'product-id': 'A-1',
  BMC: 'carbide',
  geometry: { DC: 0.5, LCF: 1, OAL: 3, NOF: 4, LB: 2.125 },
  holder: { guid: 'H-77', description: 'BT30 SK10 2.5' },
  'start-values': { presets: [] },
  expressions: {},
  ...over,
});

describe('parseIncoming — JSON paste', () => {
  it('accepts a single tool object, an array, and a { data: [...] } library wrapper', () => {
    expect(parseIncoming(JSON.stringify(fusionRaw()))).toHaveLength(1);
    expect(parseIncoming(JSON.stringify([fusionRaw(), fusionRaw({ guid: 'g2' })]))).toHaveLength(2);
    expect(parseIncoming(JSON.stringify({ data: [fusionRaw()], version: 36 }))).toHaveLength(1);
  });

  it('attaches the transient assembly context: OOH from geometry.LB + holder info', () => {
    const [tool] = parseIncoming(JSON.stringify(fusionRaw()));
    expect(tool.incoming_ooh).toBe(2.125);                 // from LB, raw, tool's own unit
    expect(tool.incoming_holder_guid).toBe('H-77');
    expect(tool._incomingHolderDesc).toBe('BT30 SK10 2.5');
  });

  it('rejects invalid JSON and unrecognized shapes with a clear error', () => {
    expect(() => parseIncoming('{ not json')).toThrow(/Invalid JSON/);
    expect(() => parseIncoming('{"foo": 1}')).toThrow(/Unrecognized format/);
    expect(() => parseIncoming('hello world')).toThrow(/Unrecognized format/);
  });
});

// ─── parseIncoming: Fusion TSV path (right-click → Copy in Fusion) ───────────

const TSV_HEADER = [
  'Index (tool_index)', 'Type (tool_type)', 'Description (tool_description)',
  'Diameter (tool_diameter)', 'Flutes (tool_numberOfFlutes)', 'OAL (tool_overallLength)',
  'Unit (tool_unit)', 'Comment (tool_comment)', 'Product ID (tool_productId)',
  'Preset (preset_name)', 'Spindle (tool_spindleSpeed)', 'Feed (tool_feedCutting)',
  'Body Length (tool_bodyLength)', 'Holder (holder_description)', 'Hand (tool_hand)',
].join('\t');

const row = (vals) => vals.join('\t');

describe('parseIncoming — Fusion TSV paste', () => {
  it('groups preset rows by tool_index into one tool with N presets', () => {
    const tsv = [
      TSV_HEADER,
      row(['1', 'flat end mill', '1/2 4FL EM', '0.5', '4', '3', 'inches', 'FTL-000001', 'A-1', 'AL Rough', '8000', '100', '2.125', 'BT30 SK10', 'right hand']),
      row(['1', 'flat end mill', '1/2 4FL EM', '0.5', '4', '3', 'inches', 'FTL-000001', 'A-1', 'SS Finish', '4000', '40', '2.125', 'BT30 SK10', 'right hand']),
    ].join('\n');
    const tools = parseIncoming(tsv);
    expect(tools).toHaveLength(1);
    expect(tools[0].presets).toHaveLength(2);
    expect(tools[0].presets.map(p => p.name)).toEqual(['AL Rough', 'SS Finish']);
  });

  it('reads tracking ID from the comment, maps tap types, carries OOH + holder', () => {
    const tsv = [
      TSV_HEADER,
      row(['1', 'tap right hand', '1/4-20 CUT TAP', '0.25', '', '2.5', 'inches', 'FTL-00000A', 'R-3', 'Default', '500', '', '1.5', 'BT30 ER16', 'right hand']),
      row(['2', 'flat end mill', 'NO TRACKING', '0.5', '4', '3', 'inches', 'copied from master', 'B-2', 'Default', '8000', '100', '2', '', 'right hand']),
    ].join('\n');
    const [tap, em] = parseIncoming(tsv);
    expect(tap.tool_type).toBe('tap');
    expect(tap.tracking_id).toBe('FTL-00000A');
    expect(tap.incoming_ooh).toBe(1.5);
    expect(tap._incomingHolderDesc).toBe('BT30 ER16');
    expect(em.tracking_id).toBeNull();   // non-FTL comment is not a tracking ID
  });
});

// ─── buildQueue ──────────────────────────────────────────────────────────────

const master = (over = {}) => ({
  id: 'guid-m1', tracking_id: 'FTL-000001', tool_id: 'A-1', legacy_ids: [],
  assemblies: [], tool_type: 'flat end mill', diameter: 0.5,
  number_of_flutes: 4, overall_length: 3, vendor: 'Helical', description: '1/2 4FL EM',
  ...over,
});

describe('buildQueue — routes each incoming tool by match confidence', () => {
  it('exact match → status "matched", auto-paired to master', () => {
    const [entry] = buildQueue([{ tool_id: 'A-1' }], [master()]);
    expect(entry.status).toBe('matched');
    expect(entry.matchConfidence).toBe('exact');
    expect(entry.matchedMasterTool.id).toBe('guid-m1');
    expect(entry.isNewTool).toBe(false);
  });

  it('fuzzy match → status "pending" with candidates, NOT auto-paired (user confirms)', () => {
    const incoming = {
      tool_type: 'flat end mill', diameter: 0.5, number_of_flutes: 4,
      overall_length: 3, vendor: 'Helical', description: '1/2 4FL EM',
    };
    const [entry] = buildQueue([incoming], [master({ tool_id: 'Z-9', tracking_id: 'FTL-0000ZZ' })]);
    expect(entry.status).toBe('pending');
    expect(entry.matchConfidence).toBe('fuzzy');
    expect(entry.matchedMasterTool).toBeNull();        // requires MatchStep confirmation
    expect(entry.fuzzyCandidates.length).toBeGreaterThan(0);
  });

  it('no match → status "new" (routes to Add-to-Library)', () => {
    const [entry] = buildQueue([{ tool_type: 'drill', diameter: 0.1 }], [master()]);
    expect(entry.status).toBe('new');
    expect(entry.isNewTool).toBe(true);
  });
});

describe('queueProgress', () => {
  it('counts committed + skipped as done', () => {
    const q = [
      { status: 'committed' }, { status: 'skipped' },
      { status: 'matched' }, { status: 'pending' },
    ];
    expect(queueProgress(q)).toEqual({ total: 4, done: 2, committed: 1, skipped: 1, remaining: 2 });
  });
});
