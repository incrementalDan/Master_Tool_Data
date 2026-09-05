// The tool page's edit save: what gets written, and to WHICH store.
//
// Both halves are invisible in a rendered snapshot and both are the kind of
// thing that fails silently — one reverts a panel's save, the other breaks the
// invariant every drift banner in the app is built on.
import { describe, it, expect } from 'vitest';
import { editedPatch } from './editPatch.js';
import { metadataOnlyPatch } from '../../schema/metadataScope.js';

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
