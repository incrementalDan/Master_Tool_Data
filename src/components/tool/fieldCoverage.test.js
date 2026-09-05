// ⚠️ EVERY APPLICABLE FIELD HAS EXACTLY ONE HOME, FOR EVERY TOOL TYPE.
//
// The tool page splits the geometry between two lists that are maintained
// independently: profileDimensions says what the DRAWING owns, and
// getToolFieldSections says what the GRID renders. GeometrySection subtracts the
// first from the second (ToolFields' `hideFields`), so the two lists disagreeing
// is silent in both directions — a field shown twice, or a field shown nowhere
// and therefore uneditable. Neither shows up in a screenshot of the one tool
// somebody happened to look at.
//
// This is the guard the plan called for. It runs over every type, from the pure
// functions, so a new field or a new type fails here rather than in the shop.
import { describe, it, expect } from 'vitest';
import { TOOL_TYPES } from '../../schema/toolSchema.js';
import { fieldsForType } from '../../schema/fieldRegistry.js';
import { getToolFieldSections } from '../../schema/toolFieldLayout.js';
import { canDrawProfile, profileDimensions } from '../../utils/toolProfile.js';

// What GeometrySection hides from the grid, kept identical to the component.
const ownedByDrawing = (t) => {
  if (!canDrawProfile(t)) return new Set();
  const d = profileDimensions(t);
  return new Set([...d.lengths, ...d.diameters, ...d.extras, 'shaft_segments', 'has_undercut']);
};

describe('the drawing and the grid agree, for every tool type', () => {
  it('the drawing never claims a field the type does not have', () => {
    // A dimension offered for a type that has no such field asks for a value
    // nothing reads — and, in the "Not set" list, asks for it in words.
    for (const t of TOOL_TYPES) {
      if (!canDrawProfile(t)) continue;
      const applies = new Set(fieldsForType(t));
      const d = profileDimensions(t);
      for (const f of [...d.lengths, ...d.diameters, ...d.extras]) {
        expect(applies.has(f), `${t}: the drawing offers ${f}, which does not apply to it`).toBe(true);
      }
    }
  });

  it('⚠️ no applicable geometry field is hidden with nowhere to go', () => {
    // The grid hides everything the drawing owns. Anything the drawing owns but
    // cannot place — a dimension with no value — is listed beside it instead;
    // this asserts the two lists between them still cover the type.
    for (const t of TOOL_TYPES) {
      const owned = ownedByDrawing(t);
      const s = getToolFieldSections(t);
      const shown = new Set([
        ...s.geometry.filter(f => !owned.has(f)),
        ...s.setup.filter(f => !owned.has(f)),
        ...(s.showThreadBlock ? s.thread : []),
        ...owned,
      ]);
      for (const f of [...s.geometry, ...s.setup]) {
        expect(shown.has(f), `${t}: ${f} is rendered nowhere`).toBe(true);
      }
    }
  });

  it('⚠️ nothing is rendered twice', () => {
    for (const t of TOOL_TYPES) {
      const owned = ownedByDrawing(t);
      const s = getToolFieldSections(t);
      const grid = [...s.geometry, ...s.setup].filter(f => !owned.has(f));
      const dup = grid.filter(f => owned.has(f));
      expect(dup, `${t}: shown on the drawing AND in the grid`).toEqual([]);
    }
  });

  it('the two undrawable types keep their whole grid', () => {
    // boring head and turning general have no drawing, so nothing is subtracted
    // and every field they apply stays in the grid. Deferred by the owner —
    // the fallback only has to EXIST, and this is what says it still does.
    for (const t of ['boring head', 'turning general']) {
      expect(canDrawProfile(t), `${t} is expected to be undrawable`).toBe(false);
      expect(ownedByDrawing(t).size).toBe(0);
      expect(getToolFieldSections(t).geometry.length).toBeGreaterThan(0);
    }
  });
});
