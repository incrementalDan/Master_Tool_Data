import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import SequenceBlockedModal, { BlockerList } from './SequenceBlockers.jsx';

// The point of this component is that a blocked AUTOMATIC pull says exactly as
// much as a blocked manual upload. The old auto path reduced the whole result
// to `blockers[0].message` in a toast, which dropped every ProShop number the
// library was missing — the only actionable part — and any second blocker with
// it. So what is asserted here is presence of the ROWS and of EVERY blocker,
// not the wording around them.
const blockers = [
  {
    type: 'no_tool',
    message: '2 ProShop Tool #s are not in the tool library.',
    rows: [
      { t: 'T04', tool_id: 'A-9001', description: '1/4 4FL EM' },
      { t: 'T07', tool_id: '', description: 'SPOT DRILL' },
    ],
  },
  { type: 'columns', message: "This doesn't look like a Sequence Detail export — missing columns: Seq#." },
];

describe('the blocked-pull report', () => {
  it('lists every blocker and every unmatched tool row', () => {
    const html = renderToString(<BlockerList blockers={blockers} />);
    expect(html).toContain('not in the tool library');
    expect(html).toContain('missing columns');
    expect(html).toContain('A-9001');
    expect(html).toContain('1/4 4FL EM');
    expect(html).toContain('T07');
    // A row whose ProShop number is blank still says so rather than rendering
    // an empty pill that reads as a rendering fault.
    expect(html).toContain('(blank)');
  });

  it('names each blocked program and its file', () => {
    const html = renderToString(
      <SequenceBlockedModal
        context="sync"
        items={[{ key: 'op1', programNumber: 1218, fileName: 'O1218.csv', blockers }]}
        onClose={() => {}}
      />,
    );
    expect(html).toContain('O1218');
    expect(html).toContain('O1218.csv');
    expect(html).toContain('A-9001');
    // The sync context must not claim anything was stored.
    expect(html).toContain('nothing was changed');
  });

  it('reports EVERY blocked program from one print, and owns up to what printed', () => {
    const html = renderToString(
      <SequenceBlockedModal
        context="print"
        items={[
          { key: 'op1', programNumber: 1218, fileName: 'O1218.csv', blockers },
          { key: 'op2', programNumber: 1219, fileName: 'O1219.csv', blockers: [blockers[1]] },
        ]}
        onClose={() => {}}
      />,
    );
    expect(html).toContain('O1218');
    expect(html).toContain('O1219');
    expect(html).toContain('2 programs');
    // The print context has to say the labels came from the stored version —
    // a blocked pull mid-print is not "nothing happened".
    expect(html).toContain('printed from the version already stored');
  });

  it('renders nothing when there is nothing blocked', () => {
    expect(renderToString(<SequenceBlockedModal items={[]} onClose={() => {}} />)).toBe('');
  });
});
