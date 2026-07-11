import { describe, it, expect, vi, beforeEach } from 'vitest';

const { loadMetadata, saveAllMetadata, upsertMetadata, deleteMetadata } = vi.hoisted(() => ({
  loadMetadata: vi.fn(),
  saveAllMetadata: vi.fn(async () => {}),
  upsertMetadata: vi.fn(async () => {}),
  deleteMetadata: vi.fn(async () => {}),
}));
vi.mock('./driveService.js', () => ({ loadMetadata, saveAllMetadata, upsertMetadata, deleteMetadata }));

import * as toolStore from './toolStore.js';

beforeEach(() => {
  loadMetadata.mockReset();
  saveAllMetadata.mockClear();
  upsertMetadata.mockClear();
  deleteMetadata.mockClear();
});

describe('toolStore.upsertMany — merge by id (the G1 invariant)', () => {
  it('preserves records not in the passed set, overwrites those that are, adds new ones', async () => {
    loadMetadata.mockResolvedValue([
      { id: 'A', tool_id: 'old-A' },
      { id: 'B', no_fusion_link: true },   // must survive — not in the passed set
    ]);
    const merged = await toolStore.upsertMany([
      { id: 'A', tool_id: 'new-A' },       // overwrite
      { id: 'C', tool_id: 'new-C' },       // add
    ]);
    const byId = Object.fromEntries(merged.map(m => [m.id, m]));
    expect(byId.A.tool_id).toBe('new-A');
    expect(byId.B).toBeTruthy();
    expect(byId.C.tool_id).toBe('new-C');
    // The whole-file write equals the returned merged list — never a bare replace.
    expect(saveAllMetadata).toHaveBeenCalledWith(merged);
  });

  it('skips records without an id', async () => {
    loadMetadata.mockResolvedValue([]);
    const merged = await toolStore.upsertMany([{ tool_id: 'no-id' }, { id: 'X' }]);
    expect(merged.map(m => m.id)).toEqual(['X']);
  });
});

describe('toolStore — single-record ops delegate to the backend', () => {
  it('loadAll / upsertOne / deleteById pass through', async () => {
    loadMetadata.mockResolvedValue([{ id: 'Z' }]);
    expect(await toolStore.loadAll()).toEqual([{ id: 'Z' }]);
    await toolStore.upsertOne({ id: 'Z' });
    expect(upsertMetadata).toHaveBeenCalledWith({ id: 'Z' });
    await toolStore.deleteById('Z');
    expect(deleteMetadata).toHaveBeenCalledWith('Z');
  });
});
