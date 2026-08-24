import { describe, it, expect, vi } from 'vitest';

const { upsertMetadata } = vi.hoisted(() => ({ upsertMetadata: vi.fn(async () => {}) }));
vi.mock('../services/driveService.js', () => ({
  upsertMetadata, deleteMetadata: vi.fn(async () => {}),
  loadMetadata: vi.fn(async () => []), saveAllMetadata: vi.fn(async () => {}),
}));

import { createToolActions } from './toolActions.js';
import { internalToFusionTool } from '../schema/toolSchema.js';

// ⚠️ The point of the marker is that FUSION carries it — a programmer picking
// tools for a new job cannot see this app. So the test that matters is not
// "the helper appends a word", it is "the entry uploaded to the Fusion library
// says RETIRED". Applied at the write path, so every save pushes it by itself.
function harness(tool) {
  const rawEntry = internalToFusionTool({ ...tool, guid: 'g1' }, null);
  rawEntry.guid = 'g1';
  const withRaw = { ...tool, _instancesRaw: [rawEntry], _fusionRaw: rawEntry, library_id: 'lib1' };
  let uploaded = null;
  const ctx = {
    dispatch: vi.fn(), notify: vi.fn(),
    // A re-download returns what was last uploaded — a real Fusion library
    // holds what the previous save put there, and the 3-way merge reads it.
    downloadFusionList: vi.fn(async () => uploaded || [rawEntry]),
    uploadFusionList: vi.fn(async (_id, list) => { uploaded = list; }),
    toolsRef: { current: [withRaw] }, holdersRef: { current: [] },
    shopSettingsRef: { current: {
      assembly_id_system: { mode: 'auto' }, tool_id_system: {}, location_config: { systems: [] },
      tool_libraries: [{ id: 'lib1', fileName: 'x.json' }], default_tool_library_id: 'lib1',
    } },
    googleRef: { current: true }, componentsRef: { current: { components: [] } },
    fusionReadyRef: { current: true }, holderLibraryRef: { current: { holders: [] } },
    materialsRef: { current: null },
  };
  return { ctx, withRaw, uploaded: () => uploaded };
}

const BASE = {
  id: 'FTL-RET1', tracking_id: 'FTL-RET1', tool_type: 'flat end mill', unit: 'inches',
  description: '1/2 EM 4FL 1.0LOC', diameter: 0.5, number_of_flutes: 4, tool_id: 'A-3',
  assemblies: [{ assembly_id: 'a1', instance_guid: 'g1', ooh: 1.0 }],
  presets: [],
};

describe('retiring a tool pushes the marker to Fusion', () => {
  it('the uploaded Fusion entry says RETIRED', async () => {
    const h = harness(BASE);
    const { writeLogicalTool } = createToolActions(h.ctx);
    await writeLogicalTool({ ...h.withRaw, tool_status: 'retired' });
    expect(h.uploaded()[0].description).toBe('1/2 EM 4FL 1.0LOC RETIRED');
  });

  it('so does the in-memory tool and the metadata record — all three agree', async () => {
    const h = harness(BASE);
    const { writeLogicalTool } = createToolActions(h.ctx);
    const result = await writeLogicalTool({ ...h.withRaw, tool_status: 'retired' });
    const meta = upsertMetadata.mock.calls.at(-1)[0];
    expect(result.description).toBe('1/2 EM 4FL 1.0LOC RETIRED');
    expect(meta.description).toBe('1/2 EM 4FL 1.0LOC RETIRED');
    expect(meta.tool_status).toBe('retired');
  });

  it('un-retiring takes it back off, in Fusion too', async () => {
    const retired = { ...BASE, description: '1/2 EM 4FL 1.0LOC RETIRED', tool_status: 'retired' };
    const h = harness(retired);
    const { writeLogicalTool } = createToolActions(h.ctx);
    await writeLogicalTool({ ...h.withRaw, tool_status: 'active' });
    expect(h.uploaded()[0].description).toBe('1/2 EM 4FL 1.0LOC');
  });

  it('an active tool is untouched — the marker is never invented', async () => {
    const h = harness(BASE);
    const { writeLogicalTool } = createToolActions(h.ctx);
    await writeLogicalTool({ ...h.withRaw });
    expect(h.uploaded()[0].description).toBe('1/2 EM 4FL 1.0LOC');
  });

  // Saving twice must not stack the marker — the whole rule is that it is a pure
  // function of the status, so the second save has nothing to do. (The harness
  // re-downloads what was uploaded, so this also exercises the 3-way merge.)
  it('a second save adds nothing', async () => {
    const h = harness(BASE);
    const { writeLogicalTool } = createToolActions(h.ctx);
    const once = await writeLogicalTool({ ...h.withRaw, tool_status: 'retired' });
    const twice = await writeLogicalTool(once);
    expect(twice.description).toBe('1/2 EM 4FL 1.0LOC RETIRED');
    expect(h.uploaded()[0].description).toBe('1/2 EM 4FL 1.0LOC RETIRED');
  });

  // The replacement is stored as an ID and never baked into the description —
  // a renumber would otherwise strand a stale ProShop number inside the name.
  it('the replacement is not written into the description', async () => {
    const h = harness(BASE);
    const { writeLogicalTool } = createToolActions(h.ctx);
    const result = await writeLogicalTool({ ...h.withRaw, tool_status: 'retired', replaced_by: 'FTL-NEW9' });
    expect(result.description).toBe('1/2 EM 4FL 1.0LOC RETIRED');
    expect(upsertMetadata.mock.calls.at(-1)[0].replaced_by).toBe('FTL-NEW9');
  });
});

// ⚠️ The merge can ADOPT Fusion's description (someone renamed the tool there
// and the app didn't) — and an adopted value comes back without the marker. The
// invariant is enforced AFTER the merge so it holds anyway; enforcing it only at
// entry would let a Fusion-side rename quietly un-retire the name.
describe('a rename made in Fusion cannot strip the marker', () => {
  it('re-applies it on top of the adopted description', async () => {
    const retired = { ...BASE, description: '1/2 EM 4FL 1.0LOC RETIRED', tool_status: 'retired' };
    const h = harness(retired);
    // Fusion now holds a DIFFERENT, unmarked name for the same entry.
    const renamed = { ...h.withRaw._instancesRaw[0], description: '1/2 EM ROUGHER' };
    h.ctx.downloadFusionList = vi.fn(async () => [renamed]);

    const { writeLogicalTool } = createToolActions(h.ctx);
    const result = await writeLogicalTool({ ...h.withRaw });

    // Fusion's rename is adopted (that is the drift rule) — but it comes back
    // wearing the marker, because the tool is still retired.
    expect(result.description).toBe('1/2 EM ROUGHER RETIRED');
    expect(h.uploaded()[0].description).toBe('1/2 EM ROUGHER RETIRED');
  });
});
