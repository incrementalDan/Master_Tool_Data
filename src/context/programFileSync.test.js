import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Drive is mocked so the whole "found a file → take it into the app" path can be
// exercised without a network. The spies are what the assertions are about: the
// point of most of these tests is which Drive calls DON'T happen.
const drive = vi.hoisted(() => ({
  listFolderChildren: vi.fn(async () => []),
  fetchFileText: vi.fn(async () => ''),
  ensureProgramFolder: vi.fn(async () => 'prog-folder'),
  uploadToolFile: vi.fn(async () => ({ id: 'raw-1' })),
  renameDriveFile: vi.fn(async () => {}),
  deleteToolFile: vi.fn(async () => {}),
}));
vi.mock('../services/driveService.js', () => drive);

import { createProgramActions } from './programActions.js';

const REAL = readFileSync(
  fileURLToPath(new URL('../utils/__fixtures__/O1218.csv', import.meta.url)), 'utf8');

const partsFile = {
  version: 1,
  parts: [{ id: 'part-1', part_number: 'DEMO-BRACKET-LEFT' }],
  routings: [{ id: 'rt-1', part_id: 'part-1', rev: 'B', order: 0 }],
  operations: [{ id: 'op-1', routing_id: 'rt-1', program_number: 1218, op_number: '60', machine_id: 'm-300' }],
};
const tools = [
  { id: 'FTL-B261', tool_id: 'B-261', legacy_ids: [] },
  { id: 'FTL-A265', tool_id: 'A-265', legacy_ids: [] },
  { id: 'FTL-A264', tool_id: 'A-264', legacy_ids: [] },
];
const shopSettings = {
  machines: [
    { id: 'm-300', model: 'Brother M300X3', program_folder_id: 'fld-300', program_folder_name: 'M300 Posted' },
    { id: 'm-650', model: 'Brother R650', program_folder_id: 'fld-650' },
  ],
};

function makeCtx(over = {}) {
  const programDetailsRef = { current: over.programDetails || { version: 1, details: [] } };
  const saved = [];
  return {
    ctx: {
      notify: vi.fn(),
      googleRef: { current: true },
      demoModeRef: { current: false },
      programDetailsRef,
      saveProgramDetails: vi.fn(async (file) => { programDetailsRef.current = file; saved.push(file); }),
      partsRef: { current: partsFile },
      toolsRef: { current: over.tools || tools },
      holderLibraryRef: { current: { holders: [] } },
      shopSettingsRef: { current: over.shopSettings || shopSettings },
      userRef: { current: { email: 'op@shop.test' } },
    },
    saved,
    programDetailsRef,
  };
}

const csvFile = (over = {}) => ({
  id: 'drive-1', name: 'O1218.csv', mimeType: 'text/csv',
  modifiedTime: '2026-08-10T10:51:00Z', ...over,
});

beforeEach(() => { Object.values(drive).forEach(f => f.mockClear()); });

describe('listPostedFolders — one call per folder, failures reported not thrown', () => {
  it('lists each configured folder once and drops subfolders', async () => {
    drive.listFolderChildren.mockImplementation(async (id) => ([
      csvFile({ id: `${id}-csv` }),
      { id: `${id}-sub`, name: 'Archive', mimeType: 'application/vnd.google-apps.folder' },
    ]));
    const { ctx } = makeCtx();
    const { folders, listings, errors } = await createProgramActions(ctx).listPostedFolders();

    expect(drive.listFolderChildren).toHaveBeenCalledTimes(2);
    expect(folders.map(f => f.folderId)).toEqual(['fld-300', 'fld-650']);
    expect(listings.get('fld-300').map(f => f.id)).toEqual(['fld-300-csv']);
    expect(errors).toEqual([]);
  });

  it('⚠️ one unreachable folder does not blank out the others', async () => {
    // Renamed folder, permissions changed — the other machine's folder is still
    // perfectly readable and must still answer.
    drive.listFolderChildren.mockImplementation(async (id) => {
      if (id === 'fld-650') throw new Error('404');
      return [csvFile()];
    });
    const { ctx } = makeCtx();
    const { listings, errors } = await createProgramActions(ctx).listPostedFolders();
    expect(listings.get('fld-300')).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0].machines).toEqual(['Brother R650']);
  });

  it('does not call Drive at all when nothing is configured', async () => {
    const { ctx } = makeCtx({ shopSettings: { machines: [{ id: 'm', model: 'No folder' }] } });
    const { folders } = await createProgramActions(ctx).listPostedFolders();
    expect(folders).toEqual([]);
    expect(drive.listFolderChildren).not.toHaveBeenCalled();
  });
});

describe('importProgramFileFromDrive', () => {
  it('stores the file and stamps the Drive modifiedTime it was taken from', async () => {
    drive.fetchFileText.mockResolvedValue(REAL);
    const { ctx, programDetailsRef } = makeCtx();
    const res = await createProgramActions(ctx).importProgramFileFromDrive(csvFile());

    expect(res.ok).toBe(true);
    const stored = programDetailsRef.current.details[0];
    expect(stored.operation_id).toBe('op-1');
    expect(stored.tools).toHaveLength(3);
    // The comparison key for every future poll. Without it the indicator has
    // nothing to settle against.
    expect(stored.source_modified).toBe('2026-08-10T10:51:00Z');
    expect(stored.source_file_id).toBe('drive-1');
  });

  it('marks an automatic pull so it is never mistaken for a reviewed upload', async () => {
    drive.fetchFileText.mockResolvedValue(REAL);
    const { ctx, programDetailsRef } = makeCtx();
    await createProgramActions(ctx).importProgramFileFromDrive(csvFile(), { auto: true });
    expect(programDetailsRef.current.details[0].auto_imported).toBe(true);
  });

  it('leaves a hand-picked pull unmarked', async () => {
    drive.fetchFileText.mockResolvedValue(REAL);
    const { ctx, programDetailsRef } = makeCtx();
    await createProgramActions(ctx).importProgramFileFromDrive(csvFile());
    expect(programDetailsRef.current.details[0].auto_imported).toBe(false);
  });

  it('⚠️ honours the SAME blockers as the manual upload — nothing half-stores', async () => {
    // A ProShop Tool # the library doesn't have blocks the whole file. An
    // automatic path that relaxed this would store exactly the half-populated
    // tool lists the rule exists to keep out, with nobody watching.
    drive.fetchFileText.mockResolvedValue(REAL);
    const { ctx, programDetailsRef } = makeCtx({ tools: [tools[0]] });
    const res = await createProgramActions(ctx).importProgramFileFromDrive(csvFile());

    expect(res.ok).toBe(false);
    expect(res.blockers[0].type).toBe('no_tool');
    expect(programDetailsRef.current.details).toHaveLength(0);
    expect(drive.uploadToolFile).not.toHaveBeenCalled();
  });

  it('blocks a file whose program number is not in ToolDex', async () => {
    drive.fetchFileText.mockResolvedValue(REAL);
    const { ctx } = makeCtx();
    const res = await createProgramActions(ctx).importProgramFileFromDrive(csvFile({ name: 'O9999.csv' }));
    expect(res.ok).toBe(false);
    expect(res.blockers[0].type).toBe('no_program');
  });
});

describe('⚠️ the nag-loop guard — a same-version pull stamps and stops', () => {
  const prior = {
    id: 'det-1', operation_id: 'op-1', program_number: 1218,
    posted: '8-10-2026 10:51', raw_file_id: 'raw-old',
    proven: true, proven_by: 'someone', tools: [], auto_imported: false,
  };

  it('re-stamps without re-uploading when the POSTED stamp is unchanged', async () => {
    // A file re-saved (or merely re-synced) in Drive gets a NEWER modifiedTime
    // with the SAME posted stamp. Re-uploading identical bytes to answer that
    // would churn Drive for every such file — and there is a lot of them.
    drive.fetchFileText.mockResolvedValue(REAL);
    const { ctx, programDetailsRef } = makeCtx({ programDetails: { version: 1, details: [prior] } });
    const res = await createProgramActions(ctx)
      .importProgramFileFromDrive(csvFile({ modifiedTime: '2026-09-01T09:00:00Z' }));

    expect(res.ok).toBe(true);
    expect(res.unchanged).toBe(true);
    expect(drive.uploadToolFile).not.toHaveBeenCalled();
    expect(drive.renameDriveFile).not.toHaveBeenCalled();
    expect(drive.deleteToolFile).not.toHaveBeenCalled();
    expect(programDetailsRef.current.details[0].source_modified).toBe('2026-09-01T09:00:00Z');
  });

  it('keeps the proven state and the stored version untouched', async () => {
    drive.fetchFileText.mockResolvedValue(REAL);
    const { ctx, programDetailsRef } = makeCtx({ programDetails: { version: 1, details: [prior] } });
    await createProgramActions(ctx).importProgramFileFromDrive(csvFile({ modifiedTime: '2026-09-01T09:00:00Z' }));
    const stored = programDetailsRef.current.details[0];
    expect(stored.proven).toBe(true);
    expect(stored.raw_file_id).toBe('raw-old');
    expect(stored.id).toBe('det-1');
  });

  it('a same-version pull does not relabel a reviewed upload as automatic', async () => {
    drive.fetchFileText.mockResolvedValue(REAL);
    const { ctx, programDetailsRef } = makeCtx({ programDetails: { version: 1, details: [prior] } });
    await createProgramActions(ctx)
      .importProgramFileFromDrive(csvFile({ modifiedTime: '2026-09-01T09:00:00Z' }), { auto: true });
    expect(programDetailsRef.current.details[0].auto_imported).toBe(false);
  });

  it('a genuinely NEW posted version does archive and re-upload', async () => {
    drive.fetchFileText.mockResolvedValue(REAL);
    const older = { ...prior, posted: '8-01-2026 08:00' };
    const { ctx, programDetailsRef } = makeCtx({ programDetails: { version: 1, details: [older] } });
    const res = await createProgramActions(ctx).importProgramFileFromDrive(csvFile());

    expect(res.unchanged).toBeUndefined();
    expect(drive.renameDriveFile).toHaveBeenCalledWith('raw-old', 'O1218_20260801-0800_proven.csv');
    expect(drive.uploadToolFile).toHaveBeenCalled();
    // A new version always lands unproven — a pull never means it ran.
    expect(programDetailsRef.current.details[0].proven).toBe(false);
  });
});
