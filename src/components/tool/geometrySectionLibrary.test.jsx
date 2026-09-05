// The Geometry section — the drawing AND the grid together — over the whole real
// library, in both modes.
//
// ⚠️ The existing drawing suite renders ToolProfileFields alone. That misses
// everything about the PARTITION: the grid is handed a hide-list built from the
// drawing's field list, so a type where the two disagree only shows up when both
// are rendered together. It also misses the two undrawable types entirely, which
// take a different branch here.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import GeometrySection from './GeometrySection.jsx';
import { fusionToolToInternal } from '../../schema/fusionConvert.js';
import { resolveReachFields } from '../../utils/toolReach.js';

const LIB = JSON.parse(readFileSync(
  new URL('../../../8-10-26 POST CLEAN UP PM FIX/ToolDEX - MASTER 8-10-26PM.json', import.meta.url), 'utf8',
)).data;

const render = (tool, editing) => renderToString(
  <GeometrySection
    data={{ ...tool, ...resolveReachFields(tool) }}
    setData={() => {}} setField={() => {}} editing={editing} />,
);

describe('every tool in the library renders its Geometry section', () => {
  it('in view mode and in edit mode, with no NaN reaching an SVG path', () => {
    const types = new Set();
    for (const e of LIB) {
      const t = fusionToolToInternal(e);
      types.add(t.tool_type);
      for (const editing of [false, true]) {
        const html = render(t, editing);
        expect(html, `${t.description} (${editing ? 'edit' : 'view'})`).not.toMatch(/NaN|Infinity/);
        expect(html).toContain('panel');
      }
    }
    // Proof the sweep actually covered the awkward ones rather than 300 end mills.
    expect(types.size, 'the library should span many types').toBeGreaterThan(10);
    for (const t of ['boring head', 'turning general']) {
      expect(types.has(t), `${t} is in the library and must be covered`).toBe(true);
    }
  });

  it('⚠️ never renders an empty Geometry section', () => {
    // The grid hides what the drawing owns. A type where that leaves nothing
    // would show a titled panel with no content — a section that looks broken
    // rather than one that says it has nothing.
    for (const e of LIB) {
      const t = fusionToolToInternal(e);
      const html = render(t, true);
      const body = html.slice(html.indexOf('panel-body'));
      expect(body.length, `${t.tool_type}: the Geometry section rendered nothing`).toBeGreaterThan(80);
    }
  });
});
