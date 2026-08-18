import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Executing a component body (which renderToString does) catches the class of
// bug lint and the build both miss: a symbol referenced but not imported, a
// helper renamed on one side of a refactor, a field read off the wrong tier.
// These pages were restructured heavily from Part→Program to
// Part→Routing→Operation, which is exactly when that happens.

const partsFile = {
  version: 1,
  parts: [
    { id: 'pt1', part_number: 'DEMO-BRACKET', customer: 'Val', material_id: 'N_6061', created_at: '2026-01-01' },
    { id: 'pt2', part_number: 'BRACKET', customer: '', material_custom: 'Delrin', created_at: '2026-02-01' },
  ],
  routings: [
    { id: 'rt1', part_id: 'pt1', name: 'Vise', rev: 'A', notes: 'first', order: 0 },
    { id: 'rt2', part_id: 'pt1', name: '', rev: 'B', order: 1 },     // labelled by its rev
    { id: 'rt3', part_id: 'pt2', name: 'Routing 1', rev: '', order: 0 },
  ],
  operations: [
    { id: 'op50', routing_id: 'rt1', op_number: '50', program_number: 1217, machine_label: 'Brother M300X3', is_fixture: false, internal_external: 'External', fixturing: 'Vise', pallet: '', created_at: '2026-01-02' },
    { id: 'op60', routing_id: 'rt1', op_number: '60', program_number: 1218, machine_label: 'Brother R650', is_fixture: false, internal_external: 'External', pallet: '1', created_at: '2026-01-03' },
    // A step with NO program — inspection / deburr / outside process.
    { id: 'opInsp', routing_id: 'rt1', op_number: '70', program_number: null, machine_label: '', is_fixture: false, internal_external: 'Internal', created_at: '2026-01-04' },
    { id: 'opB', routing_id: 'rt2', op_number: '50', program_number: 1300, machine_label: 'Brother M300X3', is_fixture: true, internal_external: 'Internal', material_id: 'P_1018', created_at: '2026-01-05' },
    { id: 'opC', routing_id: 'rt3', op_number: '10', program_number: 1400, machine_label: '', is_fixture: false, internal_external: 'External', created_at: '2026-02-02' },
  ],
};

const programDetails = {
  version: 1,
  details: [{
    id: 'det1', operation_id: 'op60', program_number: 1218, file_name: 'O1218.csv',
    posted: '8-10-2026 10:51', posted_at: '2026-08-10T10:51:00', proven: true, proven_by: 'DY',
    row_count: 4,
    tools: [
      { t: 'T38', t_num: 38, tool_id: 'B-261', description: 'BALL', holder: 'NBT30-SK13C-150', ooh: '0.70', lc: 'LC-244', seqs: ['10'], tool_ref: 'FTL-1', holder_id: 'h1' },
      { t: 'T56', t_num: 56, tool_id: 'A-265', description: 'EM', holder: 'UNKNOWN-HOLDER', ooh: '0.60', lc: '', seqs: ['15'], tool_ref: null, holder_id: null },
    ],
  }],
};

const ctx = {
  parts: partsFile,
  programDetails,
  materials: { groups: [{ id: 'N', label: 'Non-Ferrous', color: '#5BAD6F' }], presets: [], materials: [{ id: 'N_6061', label: '6061-T6', group_id: 'N' }, { id: 'P_1018', label: '1018', group_id: 'P' }] },
  shopSettings: { machines: [{ id: 'm1', model: 'Brother M300X3' }, { id: 'm2', model: 'Brother R650' }] },
  holderLibrary: { holders: [{ id: 'h1', description: 'NBT30-SK13C-150' }] },
  tools: [{ id: 'FTL-1', tool_id: 'B-261', location: 'LC-999' }],
  saveParts: vi.fn(),
  setProgramProven: vi.fn(),
  fetchSequenceCsv: vi.fn(),
  notify: vi.fn(),
  user: { email: 'dy@shop' },
  googleAuthenticated: true,
  demoMode: false,
};

vi.mock('../context/AppContext.jsx', () => ({
  useApp: () => ctx,
  AppProvider: ({ children }) => children,
}));

const { default: PartsPage } = await import('./PartsPage.jsx');
const { default: PartDetailPage } = await import('./PartDetailPage.jsx');
const { default: ProgramUsageSection, toolProgramUsage } = await import('./ProgramUsageSection.jsx');

// renderToString splits adjacent JSX text into separate nodes (`2 routing<!-- -->s`)
// and HTML-encodes quotes, so assert against normalized text rather than raw
// markup — otherwise the test fails on the renderer, not on the component.
const render = (ui, path = '/') => renderToString(
  <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>,
)
  .replace(/<!--[^>]*-->/g, '')
  .replace(/&#x27;|&#39;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&')
  .replace(/&middot;|&#183;/g, '·');

describe('Parts page renders', () => {
  it('renders the grouped view with routings and operations', () => {
    const html = render(<PartsPage />);
    expect(html).toContain('DEMO-BRACKET');
    expect(html).toContain('BRACKET');
    expect(html).toContain('Vise');          // named routing
    expect(html).toContain('Rev B');         // routing labelled by its rev
    expect(html).toContain('O1218');
    expect(html).toContain('OP50');
  });

  it('shows a step with no program as such, rather than an empty badge', () => {
    expect(render(<PartsPage />)).toContain('no program');
  });

  it('counts routings and operations per part', () => {
    const html = render(<PartsPage />);
    expect(html).toContain('2 routings');
    expect(html).toContain('4 operations');   // 3 in Vise + 1 in Rev B
  });

  it('offers the shared search / filter / sort bar', () => {
    const html = render(<PartsPage />);
    expect(html).toContain('Recently updated');
    expect(html).toContain('Newest program #');
    expect(html).toMatch(/Program #, part #, customer/);
  });
});

describe('Part page renders', () => {
  const detail = () => render(
    <Routes><Route path="/parts/:id" element={<PartDetailPage />} /></Routes>,
    '/parts/pt1',
  );

  it('renders the part, its routings and its operations', () => {
    const html = detail();
    expect(html).toContain('DEMO-BRACKET');
    expect(html).toContain('Vise');
    expect(html).toContain('Rev B');
    expect(html).toContain('O1217');
    expect(html).toContain('O1218');
  });

  it('shows the all-tools list across routings, with the OP column', () => {
    const html = detail();
    expect(html).toContain('All tools for this part');
    expect(html).toContain('T38');
    expect(html).toContain('B-261');
  });

  it('prints the APP location, and hides the posted one until asked', () => {
    // FTL-1 lives at LC-999 in the library; the posted file said LC-244.
    // A stale Fusion location is the normal state, so the marker is behind the
    // footer toggle and the table shows only the location the shop should use.
    const html = detail();
    expect(html).toContain('LC-999');
    expect(html).not.toContain('file: LC-244');
    // The toggle offers it, counts what it would reveal, and is not greyed out.
    expect(html).toContain('Show file locations (1)');
    expect(html).not.toContain('No file differences');
  });

  it('shows the proven state of the stored version', () => {
    expect(detail()).toContain('Proven');
  });

  it('says so plainly when the part does not exist', () => {
    const html = render(
      <Routes><Route path="/parts/:id" element={<PartDetailPage />} /></Routes>,
      '/parts/nope',
    );
    expect(html).toContain("isn't in the registry");
  });
});

describe('Where Used is derived from the sequence detail', () => {
  // The bug this replaced: the tool page read a stored job_ids field that the
  // sequence import never wrote, so uploading a CSV linked nothing here.
  it('finds the programs a tool actually runs in, with its pockets', () => {
    const rows = toolProgramUsage('FTL-1', programDetails, partsFile);
    expect(rows).toHaveLength(1);
    expect(rows[0].operation.id).toBe('op60');
    expect(rows[0].routing.name).toBe('Vise');
    expect(rows[0].part.part_number).toBe('DEMO-BRACKET');
    expect(rows[0].pockets).toEqual(['T38']);
    expect(rows[0].proven).toBe(true);
  });

  it('returns nothing for a tool that appears in no uploaded program', () => {
    expect(toolProgramUsage('FTL-NOPE', programDetails, partsFile)).toEqual([]);
  });

  it('renders the panel without a stored link of any kind', () => {
    const html = render(<ProgramUsageSection tool={{ id: 'FTL-1' }} />);
    expect(html).toContain('Where Used');
  });
});
