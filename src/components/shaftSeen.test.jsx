// ⚠️ HOW A SEGMENT LIST IS SEEN — every surface that shows the shaft as a
// VALUE rather than as a drawing. Each is a screen where someone decides which
// geometry is right, so "[object Object]" there is worse than useless.
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import DriftBanner from './DriftBanner.jsx';
import { formatShaftSegments } from '../utils/toolProfile.js';

const SEGS = [{ height: 0.144, lower: 0.038, upper: 0.038 },
              { height: 0.0753, lower: 0.038, upper: 0.125 }];

describe('the drift banner shows a shaft difference readably', () => {
  const toolWith = (fusionValue) => ({
    id: 'FTL-000001', unit: 'inches', tool_type: 'flat end mill',
    _drift: [{ field: 'shaft_segments', appValue: SEGS, fusionValue }],
  });

  // The banner opens on click, which renderToString cannot do — so the rows
  // themselves are covered through the two functions that build them
  // (`fieldLabel` + `formatShaftSegments`), and the render proves the component
  // body survives an ARRAY value where it has only ever seen scalars.
  it('renders with an array-valued drift row and counts it as a field', () => {
    const html = renderToString(
      <DriftBanner tool={toolWith([SEGS[0]])} onApply={() => {}} />);
    expect(html).not.toMatch(/object Object/);
    expect(html).toContain('Differs from Fusion in 1 field');
  });

  it('the row text names the field and both profiles', async () => {
    const { fieldLabel } = await import('../schema/fieldRegistry.js');
    expect(fieldLabel('shaft_segments', 'inches')).toBe('Shaft Profile (in)');
    expect(formatShaftSegments(SEGS)).toContain('2 seg');
    expect(formatShaftSegments([SEGS[0]])).toContain('1 seg');
  });

  it('says "none" rather than going blank when one side has no shaft', () => {
    expect(formatShaftSegments([])).toBe('none');
  });
});

describe('the Sync Job diff words it identically', () => {
  it('one renderer, so the two screens cannot describe one profile differently', async () => {
    const { formatValue } = await import('./MergeFlow/DiffStep.jsx');
    expect(formatValue(SEGS)).toBe(formatShaftSegments(SEGS));
    expect(formatValue(SEGS)).not.toMatch(/object Object/);
  });

  it('a plain string array still joins, as it always did', async () => {
    const { formatValue } = await import('./MergeFlow/DiffStep.jsx');
    expect(formatValue(['a', 'b'])).toBe('a, b');
  });
});

// ─── The reach/undercut fields on the tool form. Both are DERIVED from the
// shaft, so both must read as read-outs where a shaft exists — and neither may
// assert an answer on a tool where Fusion drew none.
describe('a derived dimension is a read-out, not an input', () => {
  const base = { id: 'FTL-1', tool_type: 'flat end mill', unit: 'inches',
    diameter: 0.039, flute_length: 0.059 };
  const segmented = { ...base,
    shaft_segments: [{ height: 0.144, lower: 0.038, upper: 0.038 },
                     { height: 0.0753, lower: 0.038, upper: 0.125 }] };

  it('reach is derived wherever Fusion drew a shaft, and only there', async () => {
    const { reachIsDerived } = await import('../utils/toolReach.js');
    expect(reachIsDerived(segmented)).toBe(true);
    expect(reachIsDerived(base)).toBe(false);
    // A drawn shaft that yields NO reach still counts — "no reach past the
    // flutes" is an answer, and typing over it would be re-derived away too.
    expect(reachIsDerived({ ...base,
      shaft_segments: [{ height: 0.3, lower: 0.25, upper: 0.25 }] })).toBe(true);
    // A face mill has no reach field at all, so nothing is derived for it.
    expect(reachIsDerived({ ...segmented, tool_type: 'face mill' })).toBe(false);
  });

  it('⚠️ "cannot say" must not render as "No"', async () => {
    const { resolveReachFields } = await import('../utils/toolReach.js');
    // No shaft drawn → null, the third state. `!!null === false` used to light
    // the No button, asserting an answer nobody had gone and got.
    expect(resolveReachFields(base).has_undercut).toBeNull();
    expect(resolveReachFields(segmented).has_undercut).toBe(true);
    // A drawn shaft with nothing narrowed IS a real "No".
    expect(resolveReachFields({ ...base,
      shaft_segments: [{ height: 0.3, lower: 0.25, upper: 0.25 }] }).has_undercut).toBe(false);
  });
});
