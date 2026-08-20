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

  it('⚠️ does not DOWNLOAD a file it already knows it cannot store', async () => {
    // A posted folder holds other CSVs and every one parses to some number —
    // fetching each just to be told there is no such program is a Drive call
    // per stray file.
    drive.listFolderChildren.mockResolvedValue([csv('O9999.csv'), csv('2026 backup.csv')]);
    const { ctx } = makeCtx();
    const report = await createProgramActions(ctx).bulkImportPostedFiles();
    expect(report.skipped).toHaveLength(2);
    expect(drive.fetchFileBlob).not.toHaveBeenCalled();
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

describe('⚠️ a re-stamp is not an import', () => {
  it('counts a same-POSTED-stamp file as already current, not as taken in', async () => {
    // Drive re-saved the file (newer modifiedTime) without it being re-posted.
    // Nothing is stored — counting it as "taken in" overstates the run, and its
    // unmatched count would describe a file that was never imported.
    const prior = {
      id: 'det-1', operation_id: 'op-1', program_number: 1218,
      posted: '8-10-2026 10:51', raw_file_id: 'raw-old', proven: true, tools: [],
      source_modified: '2026-08-10T10:51:00Z',
    };
    drive.listFolderChildren.mockResolvedValue([csv('O1218.csv', '2026-09-01T09:00:00Z')]);
    const { ctx, programDetailsRef } = makeCtx({ programDetails: { version: 1, details: [prior] } });
    const report = await createProgramActions(ctx).bulkImportPostedFiles();

    expect(report.imported).toEqual([]);
    expect(report.upToDate).toHaveLength(1);
    expect(drive.uploadToolFile).not.toHaveBeenCalled();
    // ...and the proven state it already had is untouched.
    expect(programDetailsRef.current.details[0].proven).toBe(true);
  });

  it('a genuinely newer POSTED version is taken in and starts unproven', async () => {
    const prior = {
      id: 'det-1', operation_id: 'op-1', program_number: 1218,
      posted: '8-01-2026 08:00', raw_file_id: 'raw-old', proven: true, tools: [],
      source_modified: '2026-08-01T08:00:00Z',
    };
    drive.listFolderChildren.mockResolvedValue([csv('O1218.csv', '2026-09-01T09:00:00Z')]);
    const { ctx, programDetailsRef } = makeCtx({ programDetails: { version: 1, details: [prior] } });
    const report = await createProgramActions(ctx).bulkImportPostedFiles();

    expect(report.imported).toHaveLength(1);
    expect(drive.renameDriveFile).toHaveBeenCalled();          // the old one archived
    expect(programDetailsRef.current.details[0].proven).toBe(false);
  });

  it('ignores a non-CSV sitting in the posted folder', async () => {
    drive.listFolderChildren.mockResolvedValue([
      csv('O1218.csv'),
      { id: 'nc', name: 'O1218.NC', mimeType: 'text/plain', modifiedTime: '2026-08-10T10:51:00Z' },
      { id: 'sub', name: 'Archive', mimeType: 'application/vnd.google-apps.folder', modifiedTime: '' },
    ]);
    const { ctx } = makeCtx();
    const report = await createProgramActions(ctx).bulkImportPostedFiles();
    expect(report.scanned).toBe(1);
    expect(report.imported).toHaveLength(1);
  });
});

describe('⚠️ correcting a ProShop number can actually clear the flag', () => {
  // The dead end this closes: tool_ref is resolved once at import and stored, so
  // fixing a tool's number afterwards leaves the row unlinked — and re-running
  // wouldn't help, because the file isn't stale so the scan skips it.
  const detailWithOrphan = {
    id: 'det-1', operation_id: 'op-1', program_number: 1218,
    posted: '8-10-2026 10:51', raw_file_id: 'raw-1', proven: false,
    source_modified: '2026-08-10T10:51:00Z',
    import_batch: '2026-08-10T12:00:00Z',
    tools: [
      { t: 'T38', t_num: 38, tool_id: 'B-261', tool_ref: 'FTL-B261' },
      { t: 'T56', t_num: 56, tool_id: 'A-265', tool_ref: null },
    ],
  };

  it('re-links a stored row once the tool exists, without touching Drive', async () => {
    drive.listFolderChildren.mockResolvedValue([csv('O1218.csv')]);
    const { ctx, programDetailsRef } = makeCtx({ programDetails: { version: 1, details: [detailWithOrphan] } });
    const report = await createProgramActions(ctx).bulkImportPostedFiles();

    expect(report.relinked).toHaveLength(1);
    expect(report.relinked[0].tool_id).toBe('A-265');
    expect(programDetailsRef.current.details[0].tools[1].tool_ref).toBe('FTL-A265');
    // The file itself was already current — nothing was downloaded for this.
    expect(report.upToDate).toHaveLength(1);
    expect(drive.fetchFileBlob).not.toHaveBeenCalled();
  });

  it('never overwrites a link that already resolved', async () => {
    drive.listFolderChildren.mockResolvedValue([csv('O1218.csv')]);
    const { ctx, programDetailsRef } = makeCtx({ programDetails: { version: 1, details: [detailWithOrphan] } });
    await createProgramActions(ctx).bulkImportPostedFiles();
    expect(programDetailsRef.current.details[0].tools[0].tool_ref).toBe('FTL-B261');
  });

  it('reports nothing to re-link on a second run — the flag stays cleared', async () => {
    drive.listFolderChildren.mockResolvedValue([csv('O1218.csv')]);
    const { ctx } = makeCtx({ programDetails: { version: 1, details: [detailWithOrphan] } });
    const actions = createProgramActions(ctx);
    await actions.bulkImportPostedFiles();
    const second = await actions.bulkImportPostedFiles();
    expect(second.relinked).toEqual([]);
  });

  it('leaves a genuinely unknown number unlinked rather than guessing', async () => {
    const unknown = { ...detailWithOrphan, tools: [{ t: 'T9', t_num: 9, tool_id: 'Z-777', tool_ref: null }] };
    drive.listFolderChildren.mockResolvedValue([csv('O1218.csv')]);
    const { ctx, programDetailsRef } = makeCtx({ programDetails: { version: 1, details: [unknown] } });
    const report = await createProgramActions(ctx).bulkImportPostedFiles();
    expect(report.relinked).toEqual([]);
    expect(programDetailsRef.current.details[0].tools[0].tool_ref).toBe(null);
  });
});

describe('the Settings log is a convenience, not the run', () => {
  it('⚠️ a failed log write does not discard the report of work that happened', async () => {
    drive.listFolderChildren.mockResolvedValue([csv('O1218.csv')]);
    const { ctx, programDetailsRef } = makeCtx();
    ctx.saveShopSettings = vi.fn(async () => { throw new Error('Drive down'); });

    const report = await createProgramActions(ctx).bulkImportPostedFiles();
    expect(report.imported).toHaveLength(1);
    expect(programDetailsRef.current.details).toHaveLength(1);
    expect(ctx.notify).toHaveBeenCalled();
  });
});
