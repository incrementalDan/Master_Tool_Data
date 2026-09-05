// The tool page's edit save: what gets written, and to WHICH store.
//
// Both halves are invisible in a rendered snapshot and both are the kind of
// thing that fails silently — one reverts a panel's save, the other breaks the
// invariant every drift banner in the app is built on.
import { describe, it, expect } from 'vitest';
import { editedPatch } from './editPatch.js';
import { metadataOnlyPatch } from '../../schema/metadataScope.js';
import { readFile } from 'node:fs/promises';

const tool = {
  id: 'FTL-000001',
  tool_type: 'flat end mill',
  description: '1/2 4FL EM',
  diameter: 0.5,
  flute_length: 1,
  notes: 'old note',
  tags: ['a'],
  presets: [{ guid: 'p1', n: 8000 }],
  purchasing: { manufacturers: [], vendors: [] },
  _drift: [{ field: 'diameter' }],
};

describe('editedPatch', () => {
  it('carries only what the user changed', () => {
    const draft = { ...tool, diameter: 0.625 };
    expect(editedPatch(tool, draft)).toEqual({ diameter: 0.625 });
  });

  it('never carries a runtime flag into a save', () => {
    const draft = { ...tool, _drift: [], notes: 'new' };
    expect(editedPatch(tool, draft)).toEqual({ notes: 'new' });
  });

  it('treats an unchanged array or object as unchanged', () => {
    // A fresh reference with the same contents is not an edit — otherwise every
    // save would rewrite presets, tags and purchasing for nothing.
    const draft = { ...tool, tags: ['a'], purchasing: { manufacturers: [], vendors: [] } };
    expect(editedPatch(tool, draft)).toEqual({});
  });

  // ⚠️ THE REASON THIS IS A THREE-WAY MERGE AT ALL. The panels that save on
  // their own stay live during edit mode, so the record can move under the
  // draft. Saving the draft wholesale would revert them.
  it('a preset saved DURING the edit survives the page save', () => {
    const base = { ...tool };                                  // snapshot at Edit
    const draft = { ...tool, diameter: 0.625 };                // user's edit
    const current = { ...tool, presets: [{ guid: 'p1', n: 12000 }] };  // panel saved meanwhile

    const next = { ...current, ...editedPatch(base, draft) };
    expect(next.diameter).toBe(0.625);                          // the edit lands
    expect(next.presets[0].n).toBe(12000);                      // the panel's save stands
  });
});

describe('which store the page save goes to', () => {
  // The routing the page uses: anything Fusion also holds forces the full write,
  // so metadata and Fusion stay in step and "metadata ≠ Fusion" keeps meaning
  // "Fusion moved" (see metadataScope.js). The user is never asked.
  const routeOf = (patch) => {
    const next = { ...tool, ...patch };
    return metadataOnlyPatch(tool, next).dropped.length > 0 ? 'fusion' : 'metadata';
  };

  it('sends an app-only edit down the metadata-only path', () => {
    expect(routeOf({ notes: 'new note' })).toBe('metadata');
    expect(routeOf({ tags: ['a', 'b'] })).toBe('metadata');
  });

  it('sends anything Fusion holds through the full write', () => {
    expect(routeOf({ diameter: 0.625 })).toBe('fusion');
    expect(routeOf({ description: 'renamed' })).toBe('fusion');
  });

  it('⚠️ a mixed edit takes the FULL write, not the fast one', () => {
    // The fast path would store the note and drop the diameter on the floor.
    expect(routeOf({ notes: 'new note', diameter: 0.625 })).toBe('fusion');
  });

  it('⚠️ status takes the full write — it rewrites the Fusion description', () => {
    expect(routeOf({ tool_status: 'retired' })).toBe('fusion');
  });
});


// ⚠️ A SAVE THAT DID NOT LAND MUST SAY SO. useToolEditor.handleSave swallows the
// error on purpose — the message belongs in the banner and the draft has to stay
// on screen — so its RETURN VALUE is the only signal a caller has. The tool
// page's "Save & leave" reads it; awaiting it in a try/catch instead navigated
// away on a failed write and took the edit with it.
//
// Tested against the real module rather than a copy of the shape, so a future
// `return;` in that function fails here rather than silently re-breaking it.
describe('handleSave reports whether it worked', () => {
  it('is not a fire-and-forget — the source returns a boolean on every path', async () => {
    const src = await readFile(
      new URL('./useToolEditor.js', import.meta.url), 'utf8',
    );
    const body = src.slice(src.indexOf('const handleSave = async () => {'));
    const fn = body.slice(0, body.indexOf('\n  };'));
    // Validation failure, save failure, and success each have to answer.
    expect(fn).toMatch(/return false;[\s\S]*return true;[\s\S]*return false;/);
    expect(fn, 'a bare return would read as "it worked"').not.toMatch(/\n\s*return;\s*\n/);
  });
});


// ⚠️ EDIT MODE BELONGS TO ONE TOOL. /tool/:id does not unmount the page when the
// id changes, and the draft is deliberately FROZEN while editing — so without an
// explicit reset the page kept the previous tool's draft while the header named
// the new one, and a save would have written the first tool's geometry onto the
// second. Reachable by browser Back/Forward and by the replacement link.
//
// Asserted against the source: the reset has to be keyed on the id, and it has
// to honour ?edit=1 (Duplicate lands there deliberately).
describe('the page drops edit mode when the tool changes', () => {
  it('resets on the id, honouring ?edit=1', async () => {
    const src = await readFile(new URL('../ToolDetail.jsx', import.meta.url), 'utf8');
    const i = src.indexOf('EDIT MODE BELONGS TO ONE TOOL');
    expect(i, 'the guard is gone').toBeGreaterThan(-1);
    const block = src.slice(i, i + 900);
    expect(block).toContain("setEditing(searchParams.get('edit') === '1')");
    expect(block, 'must be keyed on the tool id').toMatch(/\}, \[id\]\)/);
  });
});
