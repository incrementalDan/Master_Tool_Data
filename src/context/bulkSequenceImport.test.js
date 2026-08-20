import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const drive = vi.hoisted(() => ({
  listFolderChildren: vi.fn(async () => []),
  fetchFileText: vi.fn(async () => ''),
  fetchFileBlob: vi.fn(async () => new Blob([''], { type: 'text/csv' })),
  ensureProgramFolder: vi.fn(async () => 'prog-folder'),
  uploadToolFile: vi.fn(async () => ({ id: 'raw-new' })),
  renameDriveFile: vi.fn(async () => {}),
  deleteToolFile: vi.fn(async () => {}),
  listProgramFolderFiles: vi.fn(async () => []),
}));
vi.mock('../services/driveService.js', () => drive);

import { createProgramActions } from './programActions.js';

const REAL = readFileSync(
  fileURLToPath(new URL('../utils/__fixtures__/O1218.csv', import.meta.url)), 'utf8');
// The same posted file re-headed for a second program number.
const other = (n) => REAL.replace('OO1218', `OO${n}`);

const partsFile = {
  version: 1,
  parts: [{ id: 'part-1', part_number: 'DEMO' }],
  routings: [{ id: 'rt-1', part_id: 'part-1', rev: 'B', order: 0 }],
  operations: [
    { id: 'op-1', routing_id: 'rt-1', program_number: 1218, op_number: '60', machine_id: 'm-300' },
    { id: 'op-2', routing_id: 'rt-1', program_number: 1400, op_number: '70', machine_id: 'm-300' },
  ],
};
const tools = [
  { id: 'FTL-B261', tool_id: 'B-261', legacy_ids: [] },
  { id: 'FTL-A265', tool_id: 'A-265', legacy_ids: [] },
  { id: 'FTL-A264', tool_id: 'A-264', legacy_ids: [] },
];
const shopSettings = {
  machines: [{ id: 'm-300', model: 'M300', program_folder_id: 'fld-300', program_folder_name: 'Posted' }],
};

const csv = (name, modifiedTime = '2026-08-10T10:51:00Z', id = name) =>
  ({ id, name, mimeType: 'text/csv', modifiedTime });

function makeCtx(over = {}) {
  const programDetailsRef = { current: over.programDetails || { version: 1, details: [] } };
  const shopRef = { current: over.shopSettings || shopSettings };
  const saveShopSettings = vi.fn(async (next) => { shopRef.current = next; });
  return {
    ctx: {
      notify: vi.fn(),
      googleRef: { current: true },
      demoModeRef: { current: false },
      programDetailsRef,
      saveProgramDetails: vi.fn(async (f) => { programDetailsRef.current = f; }),
      partsRef: { current: over.partsFile || partsFile },
      toolsRef: { current: over.tools || tools },
      holderLibraryRef: { current: { holders: [] } },
      shopSettingsRef: shopRef,
      userRef: { current: { email: 'op@shop.test' } },
      saveShopSettings,
    },
    programDetailsRef, shopRef, saveShopSettings,
  };
}

beforeEach(() => {
  Object.values(drive).forEach(f => f.mockClear());
  drive.listFolderChildren.mockResolvedValue([]);
  drive.fetchFileBlob.mockResolvedValue(new Blob([REAL], { type: 'text/csv' }));
});

describe('bulkImportPostedFiles', () => {
  it('takes in every program it finds, one pass', async () => {
    drive.listFolderChildren.mockResolvedValue([csv('O1218.csv'), csv('O1400.csv')]);
    drive.fetchFileBlob.mockImplementation(async (id) =>
      new Blob([id === 'O1400.csv' ? other(1400) : REAL], { type: 'text/csv' }));

    const { ctx, programDetailsRef } = makeCtx();
    const report = await createProgramActions(ctx).bulkImportPostedFiles();

    expect(report.imported.map(r => r.programNumber).sort()).toEqual([1218, 1400]);
    expect(programDetailsRef.current.details).toHaveLength(2);
  });

  it('⚠️ stamps the batch ON each record, so nothing is inferred from timing', async () => {
    // A timestamp window gets this wrong both ways: a manual upload made during
    // the run would be falsely marked, and a long run outlasts any window.
    drive.listFolderChildren.mockResolvedValue([csv('O1218.csv')]);
    const { ctx, programDetailsRef } = makeCtx();
    const report = await createProgramActions(ctx).bulkImportPostedFiles();

    const stored = programDetailsRef.current.details[0];
    expect(stored.import_batch).toBe(report.batch);
    expect(stored.auto_imported).toBe(true);
  });

  it('⚠️ does NOT block on a ProShop number that resolves to no tool', async () => {
    drive.listFolderChildren.mockResolvedValue([csv('O1218.csv')]);
    const { ctx, programDetailsRef } = makeCtx({ tools: [tools[0]] });
    const report = await createProgramActions(ctx).bulkImportPostedFiles();

    expect(report.skipped).toEqual([]);
    expect(report.imported[0].unmatched).toBeGreaterThan(0);
    const stored = programDetailsRef.current.details[0];
    expect(stored.tools.some(t => !t.tool_ref)).toBe(true);
    // ...and it still linked everything it could.
    expect(stored.tools.some(t => t.tool_ref)).toBe(true);
  });

  it('still skips a file whose program number ToolDex does not have', async () => {
    // Structural, not policy: a detail is keyed on operation_id.
    drive.listFolderChildren.mockResolvedValue([csv('O9999.csv')]);
    const { ctx, programDetailsRef } = makeCtx();
    const report = await createProgramActions(ctx).bulkImportPostedFiles();

    expect(report.imported).toEqual([]);
    expect(report.skipped[0].reason).toBe('no_program');
    expect(programDetailsRef.current.details).toHaveLength(0);
  });

  it('⚠️ leaves a program it already holds alone, so a re-run is cheap', async () => {
    drive.listFolderChildren.mockResolvedValue([csv('O1218.csv')]);
    const { ctx, programDetailsRef } = makeCtx();
    const actions = createProgramActions(ctx);

    await actions.bulkImportPostedFiles();
    drive.uploadToolFile.mockClear();
    const second = await actions.bulkImportPostedFiles();

    expect(second.imported).toEqual([]);
    expect(second.upToDate).toHaveLength(1);
    expect(drive.uploadToolFile).not.toHaveBeenCalled();
    expect(programDetailsRef.current.details).toHaveLength(1);
  });

  it('records the run shop-wide for Settings to show', async () => {
    drive.listFolderChildren.mockResolvedValue([csv('O1218.csv')]);
    const { ctx, shopRef } = makeCtx();
    const report = await createProgramActions(ctx).bulkImportPostedFiles();

    const log = shopRef.current.sequence_bulk_import;
    expect(log.batch).toBe(report.batch);
    expect(log.imported).toBe(1);
    expect(log.by).toBe('op@shop.test');
    // ⚠️ The log never gains a record's identity — the badge reads the record's
    // own import_batch, so the two can't disagree.
    expect(log).not.toHaveProperty('details');
  });

  it('refuses when no machine has a folder configured, rather than reporting nothing found', async () => {
    const { ctx } = makeCtx({ shopSettings: { machines: [{ id: 'm', model: 'No folder' }] } });
    await expect(createProgramActions(ctx).bulkImportPostedFiles()).rejects.toThrow(/folder/i);
  });

  it('carries a folder it could not read into the report rather than calling it empty', async () => {
    drive.listFolderChildren.mockRejectedValue(new Error('403'));
    const { ctx } = makeCtx();
    const report = await createProgramActions(ctx).bulkImportPostedFiles();
    expect(report.folderErrors).toHaveLength(1);
    expect(report.scanned).toBe(0);
  });

  it('reports progress so a long run is not a frozen dialog', async () => {
    drive.listFolderChildren.mockResolvedValue([csv('O1218.csv'), csv('O1400.csv')]);
    drive.fetchFileBlob.mockImplementation(async (id) =>
      new Blob([id === 'O1400.csv' ? other(1400) : REAL], { type: 'text/csv' }));
    const seen = [];
    const { ctx } = makeCtx();
    await createProgramActions(ctx).bulkImportPostedFiles({ onProgress: p => seen.push(p.done) });
    expect(seen[0]).toBe(0);
    expect(seen[seen.length - 1]).toBe(2);
  });
});
