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
import ToolProfileFields from './ToolProfileFields.jsx';
import { resolveReachFields } from '../utils/toolReach.js';
import { fusionToolToInternal } from '../schema/fusionConvert.js';

const LIB = JSON.parse(readFileSync(
  new URL('../../8-10-26 POST CLEAN UP PM FIX/ToolDEX - MASTER 8-10-26PM.json', import.meta.url), 'utf8',
)).data;
const toolFor = (e) => ({ ...fusionToolToInternal(e), _instancesRaw: [e] });
const byDesc = (d) => LIB.find(t => t.description === d);

// ⚠️ Renders the drawing the way THE PAGE does — seeded through the reach
// resolver, in edit mode. It used to go through ToolProfileModal, which is
// retired: the page is the only editor of this geometry now, and a test that
// exercised a second one would be testing something nobody can reach.
const render = (tool, props) => renderToString(
  <ToolProfileFields draft={{ ...tool, ...resolveReachFields(tool) }} setDraft={() => {}} {...props} />,
);

describe('the profile drawing renders', () => {
  it('draws the tool the request was raised about', () => {
    const html = render(toolFor(byDesc('1mm (.039) 3FL EM .059LOC .203 REACH')));
    expect(html).toContain('tp-body');
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
    expect(html).toContain('tp-body');
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
    //
    // ⚠️ Scoped to the DRAWING's boxes. An empty input is only a lie when a
    // leader points at it; the "Not set" list beside the drawing is nothing but
    // empty inputs — that is the whole job of it, and a page-wide match here
    // would forbid the one place a never-set dimension can be typed in.
    const html = render({ ...toolFor(byDesc('1mm (.039) 3FL EM .059LOC .203 REACH')),
      has_undercut: true, undercut_diameter: null });
    const canvas = html.slice(0, html.indexOf('tp-side'));
    expect(canvas, 'the drawing half was found').toContain('tp-dimbox');
    expect(canvas.match(/value=""/g)).toBeNull();
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

// ─── ⚠️ EVERY APPLICABLE DIMENSION HAS SOMEWHERE TO BE TYPED. The drawing can
// only place a box where there is a value to place it at, and the grid below it
// hides everything the drawing owns — so a dimension the tool has never had had
// NO input anywhere on the page, and could never be filled in. Worse, clearing
// a box to retype it made the box unmount under the cursor. Both were silent.
describe('a dimension with no value can still be entered', () => {
  const bare = { tool_type: 'flat end mill', unit: 'inches',
    diameter: 0.5, flute_length: 1, overall_length: 3 };

  it('lists what the drawing cannot draw', () => {
    // No shoulder, no MIN OOH, no shank Ø on this tool — all applicable, none
    // drawable, so all three have to appear beside the drawing.
    const html = render(bare);
    const side = html.slice(html.indexOf('tp-side'));
    expect(side).toContain('Not set');
    // The panel uses the full field label (as the Cutter panel does); the
    // drawing uses the short one, because a lane is narrower than a list.
    for (const label of ['Shoulder', 'Min OOH', 'Shank']) {
      expect(side, `${label} has nowhere to be typed`).toContain(label);
    }
  });

  it('⚠️ says nothing when every applicable dimension is already on the drawing', () => {
    const full = { ...bare, shoulder_length: 1.2, min_ooh: 1.5, shank_diameter: 0.5, reach: 1.4 };
    const html = render(full);
    expect(html.slice(html.indexOf('tp-side'))).not.toContain('Not set');
  });

  // ⚠️ An empty box next to a "No" asks for the diameter of something that is
  // not there — the same rule that keeps it off the tool page's field grid.
  it('⚠️ does not ask for an undercut diameter on a tool with no undercut', () => {
    const html = render(bare);
    const side = html.slice(html.indexOf('tp-side'));
    const notSet = side.slice(side.indexOf('Not set'), side.indexOf('tp-unset-note'));
    expect(notSet).not.toContain('Undercut Diameter');
  });

  it('asks for it as soon as the undercut is turned on', () => {
    const html = render({ ...bare, has_undercut: true });
    const side = html.slice(html.indexOf('tp-side'));
    const notSet = side.slice(side.indexOf('Not set'), side.indexOf('tp-unset-note'));
    expect(notSet).toContain('Undercut Diameter');
  });

  it('⚠️ offers nothing while merely viewing — there is nothing to type into', () => {
    expect(render(bare, { readOnly: true })).not.toContain('Not set');
  });

  it('⚠️ a DERIVED dimension is never offered', () => {
    // Reach comes from the shaft segments. Offering an input for it would ask
    // for a number the next load recomputes away.
    const html = render({ ...bare, shaft_segments: [{ height: 0.3, lower: 0.4, upper: 0.4 }] });
    const side = html.slice(html.indexOf('tp-side'));
    const notSet = side.slice(side.indexOf('Not set'), side.indexOf('tp-unset-note'));
    expect(notSet).not.toContain('Reach');
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
// ─── ⚠️ ORDINATE LENGTHS. Every length is measured from the tip, so each one
// is a single horizontal leader at its own height and they SHARE a lane. That
// is what took the drawing from 634px to ~350 and made room for the Cutter and
// Shaft Segments panels beside it instead of below. A regression here is not
// cosmetic: it puts the drawing back over the width its container has.
// ⚠️ THE PAGE OPENS READ-ONLY, so a box that still looks like a field is a lie
// about what a click will do. Locked boxes lose their fill and dim their border
// — but KEEP the region colour, which is what ties each box to the part of the
// tool it measures and is doing that job in both modes.
describe('the boxes say whether the page is editable', () => {
  const tool = { tool_type: 'flat end mill', unit: 'inches', diameter: 0.5,
    flute_length: 1, shoulder_length: 1.2, overall_length: 3, shank_diameter: 0.5,
    shaft_segments: [{ height: 0.3, lower: 0.4, upper: 0.4 }] };

  it('an unlocked drawing locks nothing', () => {
    expect(render(tool)).not.toContain('tp-dimbox-locked');
  });

  it('⚠️ locked is not the same as derived', () => {
    // Two different claims. `derived` says the app COMPUTES this value (dashed,
    // with a tooltip saying where from) and is true in both modes; `locked` only
    // says the page is not in edit mode. Styling every box as derived while
    // viewing would assert the whole drawing is computed.
    // Seeded through the resolver, exactly as the page and the modal seed it —
    // reach is DERIVED from the segments, so a raw draft has no reach box at all
    // and the derived half of this assertion would fail for the wrong reason.
    const html = render(tool, { readOnly: true });
    // ⚠️ The OUTER box only. `tp-dimbox` is also the prefix of the spans inside
    // it (tp-dimbox-label, -input, -unit), so a bare prefix match sweeps those
    // up and "every box is locked" is false for a reason that is not the code.
    const boxes = [...html.matchAll(/class="(tp-dimbox(?: [^"]*)?)"/g)].map(m => m[1]);
    expect(boxes.length).toBeGreaterThan(2);
    expect(boxes.every(c => /tp-dimbox-locked/.test(c)), 'every box locks').toBe(true);
    // Reach is derived from the segments; the flute length never is.
    expect(boxes.some(c => /tp-dimbox-derived/.test(c))).toBe(true);
    expect(boxes.some(c => !/tp-dimbox-derived/.test(c))).toBe(true);
  });

  it('a locked drawing offers nothing to type in or delete', () => {
    const html = render(tool, { readOnly: true });
    expect(html, 'no segment row can be removed').not.toContain('tp-seg-del');
    expect(html, 'no segment can be added').not.toContain('tp-seg-add');
    expect(html, 'segment cells are read-outs').toContain('tp-seg-readout');
  });
});

describe('length dimensions are ordinate', () => {
  // ⚠️ A kind modifier (tp-dimbox-flute) sits BETWEEN the base class and
  // tp-dimbox-fixed, so the class list has to be matched permissively and
  // filtered — anchoring on "tp-dimbox tp-dimbox-fixed" silently matches only
  // the one box that happens to carry no kind modifier, and every lane
  // assertion below then passes or fails for the wrong reason.
  const boxLefts = (html) => [...html.matchAll(/class="(tp-dimbox[^"]*)"[^>]*?style="([^"]*)"/g)]
    .filter(m => /tp-dimbox-fixed/.test(m[1]))
    .map(m => { const v = /left:(-?[\d.]+)px/.exec(m[2]); return v ? Number(v[1]) : null; })
    .filter(v => v != null);
  const svgWidth = (html) => Number(/<svg width="([\d.]+)"/.exec(html)?.[1]);

  const base = { tool_type: 'flat end mill', unit: 'inches', diameter: 0.5,
    shank_diameter: 0.5, shaft_segments: [{ height: 0.3, lower: 0.4, upper: 0.4 }] };

  // ⚠️ The MIN OOH datum is anchored to its own LINE, not to the lane stack, so
  // it is excluded here — it legitimately sits at an x no length box uses.
  const stackLefts = (html) => [...html.matchAll(/class="(tp-dimbox[^"]*)"[^>]*?style="([^"]*)"/g)]
    .filter(m => /tp-dimbox-fixed/.test(m[1]) && !/tp-dimbox-holder/.test(m[1]))
    .map(m => Number(/left:(-?[\d.]+)px/.exec(m[2])?.[1]))
    .filter(v => Number.isFinite(v));

  it('lengths that do not collide all share ONE lane', () => {
    // ⚠️ No shaft segment here on purpose: a segment gives the tool a REACH,
    // which is a fourth length and lands close enough to the flutes to collide.
    // That collision is correct behaviour — it just isn't what this asserts.
    const html = render({ ...base, shaft_segments: [],
      flute_length: 1, shoulder_length: 1.8, min_ooh: 2.4, overall_length: 3 });
    const lanes = new Set(stackLefts(html).map(x => Math.round(x)));
    expect(lanes.size, `expected one lane, got ${[...lanes]}`).toBe(1);
  });

  it('⚠️ two EQUAL lengths step out, rather than stacking on each other', () => {
    // A tool whose flute length IS its shoulder length is ordinary, not an edge
    // case — both land at the same height and one has to move sideways.
    const html = render({ ...base, flute_length: 1.2, shoulder_length: 1.2, overall_length: 3 });
    const lanes = new Set(stackLefts(html).map(x => Math.round(x)));
    expect(lanes.size, 'equal lengths must not share a lane').toBeGreaterThan(1);
  });

  it('is narrower than the nested stack it replaced', () => {
    // The nested version spent a 94px lane per dimension: 4 lengths -> 634px.
    const html = render({ ...base, flute_length: 1, shoulder_length: 1.2, min_ooh: 1.5, overall_length: 3 });
    expect(svgWidth(html)).toBeLessThan(560);
  });
});

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
  // Each length is an ORDINATE leader running from its value box across to the
  // part: its x2 IS the part's left edge (less the 2px it stops short by).
  // (It read the nested stack's extension lines before the dimensions went
  // ordinate — those spanned two heights each and no longer exist.)
  const partLeft = (html) => Math.min(...[...html.matchAll(/x2="([\d.]+)"[^>]*class="tp-ord"/g)]
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

  it('⚠️ no two value boxes occupy the same space', () => {
    // A MIN OOH landing at a length box used to sit straight on top of it; the
    // datum's label is anchored to its line, not to the stack.
    // ⚠️ Sharing a COLUMN is normal now — the ordinate lengths all sit in one
    // lane, at different heights — so this checks the thing that actually
    // matters (overlap on BOTH axes) rather than horizontal offset alone.
    // ⚠️ The MEASURED height of a rendered box (label + input), not a number
    // picked to make this pass — a value under the real one lets two boxes
    // overlap and still be called clear, which is the failure this test names.
    // It tracks DIMBOX_H in ToolProfileFields; re-measure both if the box is
    // restyled.
    const BOX_H = 40;
    const low = render({ ...tool, min_ooh: 0.5, flute_length: 1 });
    const boxes = boxesOf(low);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.width == null || b.width == null || a.top == null || b.top == null) continue;
        const xOverlap = a.left < b.left + b.width && a.left + a.width > b.left;
        const yOverlap = Math.abs(a.top - b.top) < BOX_H;
        expect(xOverlap && yOverlap, `two boxes overlap: ${JSON.stringify([a, b])}`).toBe(false);
      }
    }
    expect(low).toContain('tp-holder-line');
  });

  // ⚠️ The canvas is sized around the OUTERMOST box, and that is not always a
  // lane box: the MIN OOH datum reaches HOLDER_OVERHANG_L further left than
  // lane 0 and steps out again when it collides with one. With ordinate lengths
  // sharing a single lane there is no longer a wide stack incidentally covering
  // it, so sizing the canvas from the lane count alone put the datum's label
  // off the left edge entirely.
  it('every box stays ON the canvas, the MIN OOH datum included', () => {
    // ⚠️ The page has other SVGs (icons) whose width is smaller — take the
    // widest, or the bound is read off an icon and every box "overflows".
    const width = (html) => Math.max(...[...html.matchAll(/<svg width="([\d.]+)"/g)]
      .map(m => Number(m[1])));
    for (const t of [
      { flute_length: 0.4, shoulder_length: 1.2, min_ooh: 1.8, overall_length: 3 },
      { flute_length: 1, shoulder_length: 1.2, min_ooh: 1.5, overall_length: 3 },
      { flute_length: 1, min_ooh: 1.5, overall_length: 3 },
      { flute_length: 1, overall_length: 3 },
    ]) {
      const html = render({ ...tool, ...t });
      for (const b of boxesOf(html)) {
        const where = `${JSON.stringify(t)} box at left ${b.left}`;
        expect(b.left, `${where} starts off the left edge`).toBeGreaterThanOrEqual(0);
        if (b.width != null) {
          expect(b.left + b.width, `${where} runs off the right edge`)
            .toBeLessThanOrEqual(width(html) + 0.5);
        }
      }
    }
  });

});
