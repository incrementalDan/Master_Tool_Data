import { describe, it, expect } from 'vitest';
import { FIELD_REGISTRY } from './fieldRegistry.js';
import { DRIFT_FIELDS } from './metadataModel.js';
import {
  AUTOSAVE_FIELDS, AUTOSAVE_EXTRA_KEYS, NOT_AUTOSAVABLE,
  isAutosavableKey, metadataOnlyPatch,
} from './metadataScope.js';

describe('the metadata-only write scope', () => {
  // ⚠️ THE LOAD-BEARING ASSERTION. DRIFT_FIELDS is exactly the set whose
  // metadata/Fusion disagreement DriftBanner reads as "Fusion moved". Let one
  // through the autosave path and the banner starts offering to discard the
  // user's own unsaved edit.
  it('never lets a drift-checked field through', () => {
    for (const f of DRIFT_FIELDS) {
      expect(isAutosavableKey(f), `${f} is drift-checked and must not autosave`).toBe(false);
    }
  });

  // The wider form of the same rule: anything Fusion holds at all. A field that
  // is mirrored rather than drift-checked (tool_id → product-id,
  // machine_tool_number → post-process, location → the vendor field) would not
  // raise a false banner, but writing it alone leaves Fusion silently stale —
  // which "if Fusion has a place for it, Fusion must have it" forbids.
  it('never lets a Fusion-backed field through', () => {
    for (const [key, def] of Object.entries(FIELD_REGISTRY)) {
      if (def.metadataOnly === true) continue;
      expect(isAutosavableKey(key), `${key} is Fusion-backed and must not autosave`).toBe(false);
    }
  });

  // ⚠️ THE COVERAGE GUARD — this is what makes the module self-maintaining.
  // A metadata-only field ADDED LATER fails here until someone classifies it,
  // so "is this safe to write on its own?" gets answered once, deliberately,
  // instead of being decided by whichever list it happened to land in.
  it('forces every metadata-only field to be classified', () => {
    for (const [key, def] of Object.entries(FIELD_REGISTRY)) {
      if (def.metadataOnly !== true) continue;
      const classified = AUTOSAVE_FIELDS.has(key) || key in NOT_AUTOSAVABLE;
      expect(classified, `${key} is metadata-only and is on neither list — classify it in metadataScope.js`).toBe(true);
    }
  });

  it('gives a reason for every field it blocks', () => {
    for (const [key, reason] of Object.entries(NOT_AUTOSAVABLE)) {
      expect(FIELD_REGISTRY[key], `${key} is blocked but is not a registry field`).toBeTruthy();
      expect(typeof reason === 'string' && reason.length > 10, `${key} needs a real reason`).toBe(true);
    }
  });

  it('keeps the non-registry extras minimal and non-overlapping', () => {
    for (const key of AUTOSAVE_EXTRA_KEYS) {
      expect(FIELD_REGISTRY[key], `${key} is a registry field — it belongs in the derived list`).toBeFalsy();
    }
  });
});

describe('metadataOnlyPatch', () => {
  const saved = {
    id: 'FTL-000001',
    diameter: 0.5,
    description: '1/2 4FL EM',
    notes: 'old note',
    tags: ['a'],
    purchasing: { manufacturers: [], vendors: [] },
    assemblies: [{ assembly_id: 'x', ooh: 2.0 }],
  };

  it('keeps a metadata-only change', () => {
    const { patch, dropped } = metadataOnlyPatch(saved, { ...saved, notes: 'new note' });
    expect(patch).toEqual({ notes: 'new note' });
    expect(dropped).toEqual([]);
  });

  // ⚠️ The §12 trap, caught structurally: a panel inside a buffered form hands
  // over the whole DRAFT. Its uncommitted geometry must be dropped and REPORTED,
  // never written to metadata alone.
  it('drops a Fusion-backed field and says so', () => {
    const { patch, dropped } = metadataOnlyPatch(saved, {
      ...saved, notes: 'new note', diameter: 0.75, description: 'renamed',
    });
    expect(patch).toEqual({ notes: 'new note' });
    expect(dropped.sort()).toEqual(['description', 'diameter']);
  });

  it('drops an assembly edit — the holder and OOH are baked into Fusion', () => {
    const { patch, dropped } = metadataOnlyPatch(saved, {
      ...saved, assemblies: [{ assembly_id: 'x', ooh: 2.5 }],
    });
    expect(patch).toEqual({});
    expect(dropped).toEqual(['assemblies']);
  });

  // Callers use "nothing changed" to skip the write entirely, so a value that
  // merely survived a JSON round-trip must not read as an edit.
  it('reports nothing to do when nothing changed', () => {
    const { patch, dropped } = metadataOnlyPatch(saved, {
      ...saved,
      tags: ['a'],                                    // same array, new reference
      purchasing: { manufacturers: [], vendors: [] }, // same object, new reference
    });
    expect(patch).toEqual({});
    expect(dropped).toEqual([]);
  });

  it('ignores runtime flags rather than reporting them as dropped', () => {
    const { patch, dropped } = metadataOnlyPatch(saved, {
      ...saved, _drift: [{ field: 'diameter' }], _duplicatePresets: 2,
    });
    expect(patch).toEqual({});
    expect(dropped).toEqual([]);
  });

  it('passes a non-registry extra it was told about', () => {
    const refs = [{ preset_id: 'p1', sfm: 350 }];
    const { patch, dropped } = metadataOnlyPatch(saved, { ...saved, speed_feed_refs: refs });
    expect(patch).toEqual({ speed_feed_refs: refs });
    expect(dropped).toEqual([]);
  });

  it('drops an unknown key rather than trusting it', () => {
    const { patch, dropped } = metadataOnlyPatch(saved, { ...saved, some_future_key: 1 });
    expect(patch).toEqual({});
    expect(dropped).toEqual(['some_future_key']);
  });
});
