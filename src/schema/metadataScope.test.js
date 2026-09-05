import { describe, it, expect } from 'vitest';
import { FIELD_REGISTRY } from './fieldRegistry.js';
import { buildLogicalTool, buildUnlinkedTool } from './logicalTools.js';
import { buildMetadataTool } from './metadataModel.js';
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

// ⚠️ WHY THIS IS HERE. saveToolMetadata has no assertFusionReady guard, unlike
// the linked write. The question that raises is whether a metadata-only save
// made during the two-stage load window — when the tool on screen was painted
// from its own record rather than built from Fusion — writes back something
// LESS than a normal save would. It does not, and this is the proof; without it
// the missing guard reads like an oversight rather than a decision.
describe('a save during the two-stage load window', () => {
  const preset = {
    guid: 'p1', name: 'AL 2.125 30-SK13-60 - Rough',
    n: 9200, v_c: 1204, v_f: 55, f_z: 0.0015, v_f_plunge: 12, v_f_retract: 12,
    'tool-coolant': 'flood', 'use-stepdown': true, stepdown: 0.018,
    'use-stepover': true, stepover: 0.045,
    expressions: { tool_stepdown: '.018 in' },
    material: { query: 'Al Wrought', category: 'metal' },
  };
  const raw = {
    guid: 'g1', type: 'flat end mill', unit: 'inches', description: '1/2 4FL EM',
    'product-id': 'A-42', 'post-process': { comment: 'FTL-ABC123', number: 55 },
    BMC: 'carbide', vendor: 'LC-8',
    geometry: { DC: 0.5, LCF: 1.25, OAL: 3, NOF: 4, LB: 2.125, SFDM: 0.5 },
    holder: { guid: 'H1', description: 'BT30 SK13 60' },
    'start-values': { presets: [preset] },
  };
  const meta = {
    id: 'FTL-ABC123', tool_id: 'A-42', notes: 'proven on 316L', tags: ['roughing'],
    min_ooh: 1.5, machine_tool_number: 55,
    preset_meta: { p1: { operation_type: 'rough', machine_id: 'M300', operation_ids: ['job-1'] } },
    assemblies: [{
      assembly_id: 'asm-1', instance_guid: 'g1', holder_guid: 'H1',
      holder_description: 'BT30 SK13 60', ooh: 2.125, linked_preset_guids: ['p1'],
      source: 'manual', asm_number: '30-SK13-60-A-42-2.125',
    }],
    purchasing: {
      manufacturers: [{ id: 'm1', name: 'Helical', edp: '12334', edp_url: '', mfg_num: '', mfg_num_url: '', order: 0 }],
      vendors: [{ id: 'v1', manufacturer_id: 'm1', name: 'MSC', vendor_num: '99', vendor_num_url: '', price: 34.76, order: 0 }],
    },
  };

  it('stores exactly what a normal save would', () => {
    const fromFusion = buildMetadataTool(buildLogicalTool([raw], new Map([[meta.id, meta]])));
    // Stage 1 paints from the record itself; a metadata save then writes THAT back.
    const provisional = buildUnlinkedTool(fromFusion);
    const midSync = buildMetadataTool({ ...provisional, notes: 'edited during sync' });

    const skip = new Set(['notes', 'updated_at', 'created_at']);
    const keys = [...new Set([...Object.keys(fromFusion), ...Object.keys(midSync)])].filter(k => !skip.has(k));
    for (const k of keys) {
      expect(JSON.stringify(midSync[k] ?? null), `${k} differs mid-sync`)
        .toBe(JSON.stringify(fromFusion[k] ?? null));
    }
    expect(midSync.notes).toBe('edited during sync');
  });
});
