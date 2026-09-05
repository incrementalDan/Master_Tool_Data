// ⚠️ A SPEC-SHEET PROPOSAL MUST BE REACHABLE. Geometry is most of what a
// manufacturer's sheet proposes, and the drawing owns geometry on the tool page
// — so the moment the grid started hiding what the drawing owns, those
// proposals rendered NOWHERE. The summary bar still counted them ("3 pending"),
// which is the worst version: the page says a decision is waiting and there is
// no decision on screen.
//
// The accept/reject strip lives on the grid row and the drawing has no such
// control, so the rule is: a field with a live proposal stays in the grid.
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import GeometrySection from './GeometrySection.jsx';

const tool = {
  tool_type: 'flat end mill', unit: 'inches',
  diameter: 0.5, flute_length: 1, overall_length: 3, shank_diameter: 0.5,
};
const render = (props) => renderToString(
  <GeometrySection data={tool} setData={() => {}} setField={() => {}} editing
    onResolveProposal={() => {}} {...props} />,
);

describe('a proposal on a drawing-owned field', () => {
  const diaProposal = new Map([
    ['diameter', { field: 'diameter', current: 0.5, proposed: 0.625, kind: 'change', status: 'pending' }],
  ]);

  it('⚠️ is on screen, even though the drawing owns the field', () => {
    const html = render({ proposals: diaProposal });
    expect(html, 'the proposed value is nowhere on the page').toContain('0.625');
  });

  it('and the field goes back to living only on the drawing once there is no proposal', () => {
    // The duplication is temporary by design — it lasts exactly as long as the
    // decision does.
    const html = render({ proposals: new Map() });
    const grid = html.slice(html.indexOf('detail-fields') >= 0 ? html.indexOf('detail-fields') : 0);
    expect(html).toContain('tp-dimbox');            // still drawn
    expect(grid).not.toContain('Cut Dia');          // not also in the grid
  });

  it('a grid-only field keeps working as before', () => {
    const html = render({
      proposals: new Map([
        ['coating', { field: 'coating', current: '', proposed: 'AlTiN', kind: 'fill', status: 'accepted' }],
      ]),
    });
    expect(html).toContain('AlTiN');
  });
});
