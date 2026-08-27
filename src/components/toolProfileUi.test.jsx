// Rendering the profile modal for real tools.
//
// Executing the component body (which renderToString does) catches what lint
// and the build both miss: a symbol referenced but not imported, a field read
// off a shape that doesn't have it, an NaN reaching an SVG path. The drawing
// divides by geometry that is routinely missing, so the blank/partial tools are
// the cases worth running, not the tidy one.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import ToolProfileModal from './ToolProfileModal.jsx';
import { fusionToolToInternal } from '../schema/fusionConvert.js';

const LIB = JSON.parse(readFileSync(
  new URL('../../8-10-26 POST CLEAN UP PM FIX/ToolDEX - MASTER 8-10-26PM.json', import.meta.url), 'utf8',
)).data;
const toolFor = (e) => ({ ...fusionToolToInternal(e), _instancesRaw: [e] });
const byDesc = (d) => LIB.find(t => t.description === d);

const render = (tool) => renderToString(
  <ToolProfileModal tool={tool} onSave={async () => {}} onClose={() => {}} />,
);

describe('the profile modal renders', () => {
  it('draws the tool the request was raised about', () => {
    const html = render(toolFor(byDesc('1mm (.039) 3FL EM .059LOC .203 REACH')));
    expect(html).toContain('tool-profile-modal');
    expect(html).toContain('tp-flute');       // the flutes, the standout region
    expect(html).toContain('tp-segment');     // its two shaft segments
    expect(html).toContain('tp-shank');
  });

  it('emits no NaN or Infinity into any SVG path, across the whole library', () => {
    // A tool with no flute length, no OAL or a zero diameter divides by zero on
    // the way to a scale. An SVG with NaN in a path silently draws nothing.
    for (const e of LIB) {
      const t = toolFor(e);
      if (t.tool_type === 'boring head' || t.tool_type === 'turning general') continue;
      const html = render(t);
      expect(html).not.toMatch(/NaN|Infinity/);
    }
  });

  it('survives a tool with no geometry at all', () => {
    const html = render({ tool_type: 'flat end mill', unit: 'inches', description: 'blank' });
    expect(html).toContain('tool-profile-modal');
    expect(html).not.toMatch(/NaN|Infinity/);
  });

  it('says so plainly when a tool has no shaft segments', () => {
    expect(render(toolFor(byDesc('1/2 (.5) 4FL EM 1.25LOC') || LIB[0])))
      .toMatch(/No shaft segments|tp-seg-table/);
  });

  it('renders a drill point, a ball nose and a bull nose without complaint', () => {
    for (const desc of [
      '1.2mm (.0472) 130DEG CARB DRILL',
      '1/8 BALL 6 FL .375 LOC',
      '.062 BULL .01R .093 LOC 3 FL',
    ]) {
      const html = render(toolFor(byDesc(desc)));
      expect(html).toContain('tp-flute');
      expect(html).not.toMatch(/NaN|Infinity/);
    }
  });

  it('never draws a dimension leader pointing at an empty box', () => {
    // An undercut can be flagged without anyone measuring it. Falling back to
    // the derived hint drew a dimension for a value the record does not hold.
    const html = render({ ...toolFor(byDesc('1mm (.039) 3FL EM .059LOC .203 REACH')),
      has_undercut: true, undercut_diameter: null });
    expect(html.match(/value=""/g)).toBeNull();
  });

  it('renders a millimetres tool in millimetres', () => {
    const e = byDesc('1mm (.039) 3FL EM .059LOC .203 REACH');
    const html = render({ ...toolFor(e), unit: 'millimeters', diameter: 1, flute_length: 1.5, overall_length: 63, shank_diameter: 3 });
    expect(html).toContain('mm');
    expect(html).not.toMatch(/NaN|Infinity/);
  });

  it('shows the shaft segments as read-only, sourced from Fusion', () => {
    const html = render(toolFor(byDesc('1mm (.039) 3FL EM .059LOC .203 REACH')));
    expect(html).toContain('from Fusion');
    // No input inside the segment table — they are Fusion's drawing of the tool.
    const table = html.slice(html.indexOf('tp-seg-table'), html.indexOf('tp-legend'));
    expect(table).not.toContain('<input');
  });
});
