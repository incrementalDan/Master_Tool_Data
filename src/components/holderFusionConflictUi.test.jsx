import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { newHolderRecord, holderRecordToFusion } from '../schema/holderRecord.js';
import { lastPushedFrom } from '../schema/holderIdentity.js';

// Executing the component bodies is what catches the class of bug lint misses —
// a prop threaded to the wrong component, a helper used before it exists.
// The real case: an NBT30-ER16-120 corrected IN FUSION by adding the segment at
// the spindle end that brings the gauge up to the engraved 120 nominal.
const appSegs = [
  { height: 0.508, 'upper-diameter': 44.907, 'lower-diameter': 45.923 },
  { height: 7.366, 'upper-diameter': 45.923, 'lower-diameter': 45.923 },
  { height: 64.059, 'upper-diameter': 37.998, 'lower-diameter': 28.296 },
];
const fusionSegs = [{ height: 1.02, 'upper-diameter': 31.75, 'lower-diameter': 31.75 }, ...appSegs];

const record = newHolderRecord({
  holder_ref: 'HLD-000001',
  description: 'NBT30-ER16-120',
  unit: 'millimeters',
  segments: appSegs.map(s => ({ ...s })),
  last_pushed: lastPushedFrom({ segments: appSegs, unit: 'millimeters' }),
});

const fusionEntry = {
  type: 'holder',
  guid: 'fusion-guid-1',
  'product-id': 'HLD-000001',
  description: 'NBT30-ER16-120',
  unit: 'millimeters',
  segments: fusionSegs.map(s => ({ ...s })),
  gaugeLength: fusionSegs.reduce((a, s) => a + s.height, 0),
};

const ctx = {
  holderLibrary: { version: 1, holders: [record], parts: [] },
  holders: [fusionEntry],
  tools: [],
  shopSettings: { holder_config: {}, holder_libraries: [{ id: 'lib1' }] },
  saveHolderRecord: vi.fn(() => Promise.resolve()),
  deleteHolderRecord: vi.fn(),
  saveHolderLibrary: vi.fn(),
  saveShopSettings: vi.fn(),
  saveHolderPart: vi.fn(),
  importHoldersFromFusion: vi.fn(),
  pushHoldersToFusion: vi.fn(),
  restampHolderTools: vi.fn(),
  linkToolsToHolders: vi.fn(),
  restoreHolderRecord: vi.fn(),
  relinkHolders: vi.fn(),
  googleAuthenticated: true,
  googleUser: { email: 'dy@shop' },
  demoMode: false,
  notify: vi.fn(),
  needsNormalize: false,
};

vi.mock('../context/AppContext.jsx', () => ({
  useApp: () => ctx,
  AppProvider: ({ children }) => children,
}));

const { default: HoldersPage } = await import('./HoldersPage.jsx');
const { default: HolderDetail } = await import('./HolderDetail.jsx');
const { fusionHolderConflicts, adoptFusionHolderGeometry, keepAppHolderGeometry } = await import('../schema/holderIdentity.js');

const render = (ui) => renderToString(<MemoryRouter>{ui}</MemoryRouter>)
  .replace(/<!--[^>]*-->/g, '')
  .replace(/&#x27;|&#39;|&rsquo;|&#8217;/g, "'")
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  .replace(/&middot;|&#183;/g, '·')
  .replace(/&#x2019;|’/g, "'");

describe('a holder edited in Fusion is visible again', () => {
  it('the Holders page names it instead of looking settled', () => {
    const html = render(<HoldersPage />);
    expect(html).toContain('a different shape in Fusion');
    expect(html).toContain('NBT30-ER16-120');
  });

  it('the holder page offers BOTH choices, and neither is pre-applied', () => {
    const conflict = fusionHolderConflicts([fusionEntry], [record])[0];
    const html = render(
      <HolderDetail
        holder={record} config={{}} fusionConflict={conflict}
        onResolveFusion={vi.fn()} onBack={vi.fn()} onSave={vi.fn()}
        holderFile={ctx.holderLibrary}
      />,
    );
    expect(html).toContain("Use Fusion's geometry");
    expect(html).toContain('Keep mine');
    // It states which side moved, and shows the two shapes to judge from.
    expect(html).toContain('This holder was edited in Fusion');
    expect(html).toContain('4 segments');   // Fusion's
    expect(html).toContain('3 segments');   // ours
  });

  it('an archived holder is read-only, so it is never asked to decide', () => {
    const conflict = fusionHolderConflicts([fusionEntry], [record])[0];
    const html = render(
      <HolderDetail
        holder={{ ...record, archived: true }} config={{}} readOnly
        fusionConflict={conflict} onBack={vi.fn()} onSave={vi.fn()}
        holderFile={ctx.holderLibrary}
      />,
    );
    expect(html).not.toContain("Use Fusion's geometry");
  });

  it('reports only what happened — a no-op resolution never toasts', () => {
    // Both resolvers return the SAME reference when there is nothing to do, and
    // the button only calls onResolveFusion when the draft actually changed.
    const already = adoptFusionHolderGeometry(record, fusionEntry);
    expect(adoptFusionHolderGeometry(already, fusionEntry)).toBe(already);
    expect(keepAppHolderGeometry(already, fusionEntry)).toBe(already);
  });

  it('says nothing when the two libraries agree', () => {
    const agreed = { ...record, segments: fusionSegs.map(s => ({ ...s })) };
    expect(fusionHolderConflicts([holderRecordToFusion(agreed, fusionEntry)], [agreed])).toHaveLength(0);
  });
});

describe('editing the segment structure', () => {
  const detail = (props = {}) => render(
    <HolderDetail
      holder={record} config={{}} onBack={vi.fn()} onSave={vi.fn()}
      holderFile={ctx.holderLibrary} {...props}
    />,
  );

  it('is off by default — no insert markers, and the delete buttons are hidden', () => {
    const html = detail();
    expect(html).toContain('Edit segments');
    expect(html).not.toContain('holder-seg-ins');
    // ⚠️ Hidden, not removed: dropping the button would collapse the column and
    // resize the whole table on toggle.
    expect(html).toContain('holder-seg-del');
    expect(html).not.toContain('holder-seg-table editing');
  });

  it('an archived holder is never offered the toggle', () => {
    expect(detail({ holder: { ...record, archived: true }, readOnly: true }))
      .not.toContain('Edit segments');
  });

  it('offers Duplicate on a live holder but not an archived one', () => {
    // ⚠️ Match the button's own title, not the word "Duplicate" — the
    // "Duplicates & cleanup" section heading contains it on every render.
    const btn = 'its own ID, no tools on it';
    expect(detail({ onDuplicate: vi.fn() })).toContain(btn);
    expect(detail({ holder: { ...record, archived: true }, readOnly: true, onDuplicate: vi.fn() }))
      .not.toContain(btn);
  });
});
