// Searching a tool by its DIAMETER.
//
// Run against the REAL library rather than a fixture: the failure this closes
// was invisible in a fixture, because a hand-written tool's description tends
// to spell its own diameter, which is exactly the accident that made the old
// text-only search look like it worked.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { textSearch, diameterMatches } from './searchEngine.js';
import { fusionToolToInternal } from '../schema/fusionConvert.js';

const TOOLS = JSON.parse(readFileSync(
  new URL('../../8-10-26 POST CLEAN UP PM FIX/ToolDEX - MASTER 8-10-26PM.json', import.meta.url), 'utf8',
)).data.map(fusionToolToInternal);

const find = (q) => textSearch(TOOLS, q);
const descs = (q) => find(q).map(t => t.description);

describe('a typed diameter finds the tool', () => {
  // The report: a metric-sized tool stored in INCHES was findable by its mm
  // name and not by its inch diameter.
  it('finds a mm-named inch tool by its inch diameter', () => {
    const reamer = TOOLS.find(t => t.description === '3MM REAMER ');
    expect(reamer.unit).toBe('inches');
    expect(reamer.diameter).toBeCloseTo(0.1181, 4);
    // Its description carries no inch value at all, so text alone can never hit.
    expect(reamer.description.toLowerCase()).not.toContain('.1181');
    expect(descs('.1181')).toContain('3MM REAMER ');
  });

  it('still finds that tool by its mm name', () => {
    expect(descs('3mm')).toContain('3MM REAMER ');
  });

  // The description rounds to 3dp while the stored value is 4dp, so typing the
  // true value used to miss by one digit.
  it('forgives the last digit when the description rounded it', () => {
    const spot = TOOLS.find(t => t.description === '6mm (.236) SPOT DRILL 90DEG');
    expect(spot.diameter).toBeCloseTo(0.2362, 4);
    expect(descs('.2362')).toContain('6mm (.236) SPOT DRILL 90DEG');
  });

  // A number carries no unit, so it is tried both ways against the tool's own.
  it('finds an inch-stored metric tool by its mm size', () => {
    expect(descs('6')).toContain('6mm (.236) SPOT DRILL 90DEG');
  });

  // The larger hole the report exposed: a description spelling its size as a
  // fraction was unreachable by any decimal.
  it('finds a fraction-named tool by its decimal', () => {
    expect(descs('.5')).toContain('1/2 100DEG Spot Drill');
    expect(descs('.375')).toContain('3/8" 45° Dovetail Cutter');
  });
});

describe('the numeric match is additive, never a narrowing', () => {
  it('keeps every result the text scan already returned', () => {
    for (const q of ['3', '6', '.25', 'drill', 'A-1', '.5']) {
      const textOnly = TOOLS.filter(t =>
        String(t.description || '').toLowerCase().includes(q.toLowerCase()));
      const now = new Set(find(q).map(t => t.id));
      for (const t of textOnly) expect(now.has(t.id)).toBe(true);
    }
  });

  // ⚠️ Reading the whole query with parseFloat would turn "3fl" into 3 and
  // quietly widen every word search into a numeric one.
  it('does not read a number out of a word query', () => {
    const tool = { diameter: 3, unit: 'inches' };
    expect(diameterMatches(tool, '3fl')).toBe(false);
    expect(diameterMatches(tool, '3 flute')).toBe(false);
    expect(diameterMatches(tool, '3')).toBe(true);
  });

  it('ignores a zero, a blank and a non-numeric diameter', () => {
    expect(diameterMatches({ diameter: 0, unit: 'inches' }, '0')).toBe(false);
    expect(diameterMatches({ unit: 'inches' }, '.25')).toBe(false);
    expect(diameterMatches({ diameter: null, unit: 'inches' }, '.25')).toBe(false);
  });
});

describe('both units are tried against the record\'s own', () => {
  it('matches a millimetres record by its inch equivalent and vice versa', () => {
    const metric = { diameter: 6, unit: 'millimeters' };
    expect(diameterMatches(metric, '6')).toBe(true);        // as mm
    expect(diameterMatches(metric, '.2362')).toBe(true);    // as inches
    const inch = { diameter: 0.2362, unit: 'inches' };
    expect(diameterMatches(inch, '.2362')).toBe(true);
    expect(diameterMatches(inch, '6')).toBe(true);
  });

  it('a tool with no unit reads as inches', () => {
    expect(diameterMatches({ diameter: 0.25 }, '.25')).toBe(true);
  });
});
