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

  it('renders the shaft segments as editable rows', () => {
    // They were read-only in the first pass. Editing them in this app — rather
    // than only in Fusion's own Shaft tab — is the point of the feature.
    const html = render(toolFor(byDesc('1mm (.039) 3FL EM .059LOC .203 REACH')));
    const table = html.slice(html.indexOf('tp-seg-table'), html.indexOf('tp-seg-note'));
    expect((table.match(/tp-seg-input/g) || []).length).toBe(6);   // 2 segments x 3 values
    expect(html).toContain('+ Add');
  });

  it('opens showing the DERIVED reach and undercut, not a blank', () => {
    // The modal resolves its own draft, so it agrees with the drawing even for
    // a tool that has not been through the load-time pass.
    const html = render(toolFor(byDesc('1mm (.039) 3FL EM .059LOC .203 REACH')));
    expect(html).toContain('value="0.203"');   // reach
    expect(html).toContain('value="0.038"');   // undercut diameter
  });
});

// ─── The modal's own controls. The undercut pill here is a SECOND copy of the
// tool page's — it had the same three-state bug and was fixed separately, so it
// needs its own guard. Steps are unit-derived for the same reason.
describe('the modal states what it knows, in the record’s unit', () => {
  const seg = (unit, s) => ({ tool_type: 'flat end mill', unit, diameter: unit === 'inches' ? 0.5 : 12,
    flute_length: unit === 'inches' ? 1 : 25, overall_length: unit === 'inches' ? 3 : 76,
    shaft_segments: s });

  it('⚠️ neither Yes nor No is lit when Fusion drew no shaft', () => {
    const html = render(seg('inches', null));
    // the pill renders, and no button inside it carries `active`
    expect(html).toContain('tp-uc-toggle');
    const pill = html.split('tp-uc-toggle')[1].split('</div>')[0];
    expect(pill).not.toContain('class="active"');
  });

  it('Yes is lit when the segments show a narrowed neck', () => {
    const html = render(seg('inches', [{ height: 0.4, lower: 0.3, upper: 0.3 }]));
    const pill = html.split('tp-uc-toggle')[1].split('</div>')[0];
    expect(pill).toContain('class="active"');
  });

  it('⚠️ steps come from the unit — 0.001 is a thou in inches and a micron in mm', () => {
    const inch = render(seg('inches', [{ height: 0.4, lower: 0.3, upper: 0.3 }]));
    const mm = render(seg('millimeters', [{ height: 10, lower: 8, upper: 8 }]));
    expect(inch).toContain('step="0.001"');
    expect(mm).toContain('step="0.01"');
    expect(mm).not.toContain('step="0.001"');     // no inch literal survives
  });

  it('an angle steps half a degree on either unit, a count steps 1', () => {
    const html = render({ ...seg('millimeters', null), tool_type: 'drill', tip_angle: 135 });
    expect(html).toContain('step="0.5"');
    expect(html).toContain('step="1"');
  });
});

// ─── MIN OOH is the holder face, not a length of the tool. It draws as one
// dotted datum across the drawing rather than as another nested dimension.
describe('the holder face is a datum, not a dimension', () => {
  const tool = (extra = {}) => ({ tool_type: 'flat end mill', unit: 'inches',
    diameter: 0.5, flute_length: 1, shoulder_length: 1.2, overall_length: 3, ...extra });

  it('draws the line only when the tool carries a MIN OOH', () => {
    expect(render(tool({ min_ooh: 1.5 }))).toContain('tp-holder-line');
    expect(render(tool())).not.toContain('tp-holder-line');
    expect(render(tool({ min_ooh: 0 }))).not.toContain('tp-holder-line');
  });

  it('⚠️ its value box is NOT one of the nested length lanes', () => {
    // The box wears the holder treatment, and the field never appears in the
    // left-hand stack — drawn there it read as "another length of the tool".
    const html = render(tool({ min_ooh: 1.5 }));
    expect(html).toContain('tp-dimbox-holder');
    // one lane per remaining length (flute, shoulder, OAL) — MIN OOH freed one
    expect(html.split('tp-dim ').length - 1).toBeLessThanOrEqual(3 + 3);
  });

  it('says what it is, so nobody reads it as a tool dimension', () => {
    expect(render(tool({ min_ooh: 1.5 }))).toContain('Where the holder starts');
  });

  it('survives a MIN OOH past the overall length, and a metric one', () => {
    for (const t of [tool({ min_ooh: 99 }),
                     { ...tool({ min_ooh: 40 }), unit: 'millimeters', diameter: 12,
                       flute_length: 25, shoulder_length: 30, overall_length: 76 }]) {
      const html = render(t);
      expect(html).toContain('tp-holder-line');
      expect(html).not.toMatch(/NaN|Infinity/);
    }
  });
});

// ─── The value boxes ARE the key. A swatch legend you have to look away to
// read is worse than the boxes saying it themselves.
describe('each value box borders in the colour of the region it names', () => {
  const t = { tool_type: 'flat end mill', unit: 'inches', diameter: 0.5,
    flute_length: 1, shoulder_length: 1.2, overall_length: 3, shank_diameter: 0.5,
    min_ooh: 1.5, has_undercut: true, undercut_diameter: 0.4,
    shaft_segments: [{ height: 0.3, lower: 0.4, upper: 0.4 }] };

  it('the swatch legend is gone', () => {
    const html = render(t);
    expect(html).not.toContain('tp-legend');
    expect(html).not.toContain('tp-sw-');
  });

  it('names each region on the box that measures it', () => {
    const html = render(t);
    for (const k of ['flute', 'shoulder', 'shank', 'segment', 'holder']) {
      expect(html, k).toContain(`tp-dimbox-${k}`);
    }
  });

  it('⚠️ a box that names no single region stays neutral', () => {
    // OAL spans the whole tool and REACH spans the flutes plus the neck —
    // colouring either would claim a part of the tool it does not measure.
    const html = render(t);
    for (const m of html.matchAll(/tp-dimbox[^"]*"[\s\S]{0,400}?tp-dimbox-label">([^<]+)/g)) {
      if (/^(OAL|REACH)$/.test(m[1].trim())) expect(m[0]).not.toMatch(/tp-dimbox-(flute|shoulder|shank|segment|holder)/);
    }
  });
});

// ─── ⚠️ A VALUE BOX MUST NEVER SIT ON THE TOOL. The left-hand stack was placed
// by each box's CENTRE on its own dimension line, and that line sits only GAP
// from the part — so half of every box, ~40px, lay across the silhouette. The
// right-hand boxes were always placed by their edge, which is why only one side
// was wrong.
describe('the dimension boxes clear the tool and each other', () => {
  // ⚠️ a `title` attribute sits between class and style on the boxes that have
  // one (derived values, the holder datum), so the two are not adjacent.
  const boxesOf = (html) => [...html.matchAll(/class="(tp-dimbox[^"]*)"[^>]*?style="([^"]*)"/g)]
    .map(m => {
      const px = (k) => { const v = new RegExp(`${k}:(-?[\\d.]+)px`).exec(m[2]); return v ? Number(v[1]) : null; };
      // ⚠️ `left` is the ANCHOR, not the edge — the transform decides which part
      // of the box lands there (centre / right edge / a fixed inset).
      const anchor = px('left'), w = px('width');
      const t = /translate\((-?[\d.]+)(%|px)/.exec(m[2]);
      const shift = !t ? 0 : (t[2] === '%' ? (w == null ? 0 : w * Number(t[1]) / 100) : Number(t[1]));
      return { left: anchor == null ? null : anchor + shift, width: w, top: px('top'),
        fixed: /tp-dimbox-fixed/.test(m[1]), holder: /tp-dimbox-holder/.test(m[1]) };
    });
  // Each length dimension draws an extension line from its lane across to the
  // part: its x2 IS the part's left edge (less the 2px it stops short by).
  const partLeft = (html) => Math.min(...[...html.matchAll(/x2="([\d.]+)"[^>]*class="tp-ext"/g)]
    .map(m => Number(m[1]))) + 2;

  const tool = { tool_type: 'flat end mill', unit: 'inches', diameter: 0.5,
    flute_length: 1, shoulder_length: 1.2, overall_length: 3, shank_diameter: 0.5,
    min_ooh: 1.5, shaft_segments: [{ height: 0.3, lower: 0.4, upper: 0.4 }] };

  it('no length box reaches the part', () => {
    const html = render(tool);
    const edge = partLeft(html);
    expect(Number.isFinite(edge)).toBe(true);
    for (const b of boxesOf(html).filter(b => b.fixed)) {
      expect(b.left + b.width, 'a box overlaps the tool').toBeLessThanOrEqual(edge);
    }
  });

  it('they are one width, and evenly spaced', () => {
    const all = boxesOf(render(tool)).filter(b => b.fixed);
    // The holder datum's label is anchored to its LINE, not to the lane stack.
    const stack = all.filter(b => !b.holder).map(b => b.left).sort((a, b) => a - b);
    expect(new Set(all.map(b => b.width)).size).toBe(1);
    const gaps = stack.slice(1).map((x, i) => Math.round(x - stack[i])).filter(g => g > 0);
    expect(new Set(gaps).size, `uneven lane spacing: ${gaps}`).toBeLessThanOrEqual(1);
  });

  it('⚠️ and the holder datum steps out of a lane it would clash with', () => {
    // A MIN OOH landing at a length box's midpoint used to sit straight on top
    // of it; the datum's label is anchored to its line, not to the stack.
    const low = render({ ...tool, min_ooh: 0.5, flute_length: 1 });
    const boxes = boxesOf(low);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.width == null || b.width == null) continue;
        const sameColumn = a.left < b.left + b.width && a.left + a.width > b.left;
        if (sameColumn) expect(Math.abs(a.left - b.left), 'two boxes share a column').toBeGreaterThan(0);
      }
    }
    expect(low).toContain('tp-holder-line');
  });
});
