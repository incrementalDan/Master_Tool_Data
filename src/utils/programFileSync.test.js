import { describe, it, expect } from 'vitest';
import {
  SEQUENCE_CSV, fileMatchesProgram, machineFolders, expectedFolderFor, folderSearchOrder,
  pickLatest, evaluateProgramFile, isStale, candidatesFor,
} from './programFileSync.js';

const M300 = { id: 'm-300', model: 'Brother M300X3', program_folder_id: 'fld-300', program_folder_name: 'M300 Posted' };
const R650 = { id: 'm-650', model: 'Brother R650', program_folder_id: 'fld-650', program_folder_name: 'R650 Posted' };
const SHARED = { id: 'm-2nd', model: 'Second M300', program_folder_id: 'fld-300' };
const NOFOLDER = { id: 'm-old', model: 'Old Mill' };

const file = (name, modifiedTime, id = name) => ({ id, name, modifiedTime, mimeType: 'text/csv' });

describe('fileMatchesProgram — the filename is the truth', () => {
  it('matches the forms the post and Drive actually produce', () => {
    for (const n of ['O1218.csv', '1218.csv', 'o1218.csv', 'O1218 (1).csv', 'O1218_20260810-1051_proven.csv']) {
      expect(fileMatchesProgram(file(n, ''), 1218)).toBe(true);
    }
  });

  it('does not match a different program, or a near-miss number', () => {
    expect(fileMatchesProgram(file('O1219.csv', ''), 1218)).toBe(false);
    expect(fileMatchesProgram(file('O12180.csv', ''), 1218)).toBe(false);
  });

  it('ignores a file of another kind in the same folder', () => {
    // The machine folder holds the G-code too — that is not this file.
    expect(fileMatchesProgram(file('O1218.NC', ''), 1218)).toBe(false);
    expect(fileMatchesProgram(file('O1218.pdf', ''), 1218)).toBe(false);
  });

  it('is kind-parameterized so G-code reuses this, not a copy of it', () => {
    const GCODE = { ...SEQUENCE_CSV, id: 'gcode', ext: ['.nc'] };
    expect(fileMatchesProgram(file('O1218.NC', ''), 1218, GCODE)).toBe(true);
    expect(fileMatchesProgram(file('O1218.csv', ''), 1218, GCODE)).toBe(false);
  });

  it('never matches when there is no program number to match on', () => {
    expect(fileMatchesProgram(file('O1218.csv', ''), null)).toBe(false);
  });
});

describe('machineFolders — folder-scoped, not machine-scoped', () => {
  it('collapses two machines sharing one folder into a single search target', () => {
    const folders = machineFolders({ machines: [M300, R650, SHARED] });
    expect(folders.map(f => f.folderId)).toEqual(['fld-300', 'fld-650']);
    expect(folders[0].machines).toEqual(['Brother M300X3', 'Second M300']);
  });

  it('⚠️ remembers EVERY machine on a shared folder, not just the first', () => {
    // Keeping only the first machine's id silently broke the shared-folder case
    // the shop actually has: an operation on the SECOND machine matched no
    // folder, so it was treated as having no expected folder and a file sitting
    // under an unrelated machine could never be flagged as being in the wrong
    // one — the feature quietly doing nothing rather than failing.
    const folders = machineFolders({ machines: [M300, R650, SHARED] });
    expect(folders[0].machineIds).toEqual(['m-300', 'm-2nd']);

    const viaFirst = expectedFolderFor({ machine_id: 'm-300' }, folders);
    const viaSecond = expectedFolderFor({ machine_id: 'm-2nd' }, folders);
    expect(viaSecond).toBe(viaFirst);
    expect(viaSecond.folderId).toBe('fld-300');
  });

  it('still flags the wrong folder for an op on the second machine of a pair', () => {
    const folders = machineFolders({ machines: [M300, SHARED, R650] });
    const listings = new Map([
      ['fld-300', []],
      ['fld-650', [file('O1218.csv', '2026-08-10T10:51:00Z')]],
    ]);
    const r = evaluateProgramFile({
      candidates: candidatesFor(1218, folders, listings),
      expectedFolderId: expectedFolderFor({ machine_id: 'm-2nd' }, folders).folderId,
      foldersConfigured: folders.length,
    });
    expect(r.state).toBe('stale');
    expect(r.wrongFolder).toBe(true);
  });

  it('skips a machine with no folder configured rather than inventing one', () => {
    expect(machineFolders({ machines: [NOFOLDER] })).toEqual([]);
  });
});

describe('folder search order', () => {
  const folders = machineFolders({ machines: [M300, R650] });

  it("puts the operation's own machine first", () => {
    const order = folderSearchOrder({ machine_id: 'm-650' }, folders);
    expect(order.map(f => f.folderId)).toEqual(['fld-650', 'fld-300']);
  });

  it('searches every folder even when the operation has no machine', () => {
    expect(folderSearchOrder({}, folders)).toHaveLength(2);
    expect(expectedFolderFor({}, folders)).toBe(null);
  });

  it('expects nothing when the operation\'s machine has no folder', () => {
    expect(expectedFolderFor({ machine_id: 'm-old' }, folders)).toBe(null);
  });
});

describe('pickLatest — a reused program number, newest wins', () => {
  const folders = machineFolders({ machines: [M300, R650] });

  it('takes the most recently modified copy, whichever folder it is in', () => {
    const cands = [
      { file: file('O1218.csv', '2026-01-02T10:00:00Z', 'old'), folder: folders[0] },
      { file: file('O1218.csv', '2026-08-10T10:51:00Z', 'new'), folder: folders[1] },
    ];
    expect(pickLatest(cands).file.id).toBe('new');
  });

  it('breaks an exact tie toward the expected machine\'s folder, not listing order', () => {
    const t = '2026-08-10T10:51:00Z';
    const cands = [
      { file: file('O1218.csv', t, 'in-650'), folder: folders[1] },
      { file: file('O1218.csv', t, 'in-300'), folder: folders[0] },
    ];
    expect(pickLatest(cands, 'fld-300').file.id).toBe('in-300');
  });
});

describe('isStale — source_modified is the answer, uploaded_at is only a bound', () => {
  const f = file('O1218.csv', '2026-08-10T10:51:00Z');

  it('is stale when nothing is stored at all', () => {
    expect(isStale(null, f)).toBe(true);
  });

  it('is stale for a record with neither stamp — unknown is not current', () => {
    expect(isStale({ posted: '8-10-2026 10:51' }, f)).toBe(true);
  });

  it('is current once the stamp of the file we took is recorded', () => {
    expect(isStale({ source_modified: '2026-08-10T10:51:00Z' }, f)).toBe(false);
  });

  it('goes stale again when Drive moves on', () => {
    expect(isStale({ source_modified: '2026-08-10T10:51:00Z' }, file('O1218.csv', '2026-08-11T09:00:00Z'))).toBe(true);
  });

  it('⚠️ does not flag a file a person JUST uploaded by hand', () => {
    // No source_modified (a manual upload never sees Drive's metadata), but it
    // was stored AFTER the Drive file last changed — so we cannot be behind it.
    // Without this the indicator goes amber the instant the upload finishes,
    // pointing at the very file that was just uploaded.
    expect(isStale({ uploaded_at: '2026-08-10T14:00:00Z' }, f)).toBe(false);
  });

  it('flips the moment Drive moves past that hand-upload', () => {
    expect(isStale({ uploaded_at: '2026-08-10T14:00:00Z' }, file('O1218.csv', '2026-08-10T15:00:00Z'))).toBe(true);
  });

  it('⚠️ never lets uploaded_at override a real source_modified', () => {
    // Posted 10:51, taken at 10:51, a person then re-saved the record at 14:00,
    // and it was re-posted at 15:00. source_modified is the like-for-like
    // comparison and must win — uploaded_at would call this current and the
    // re-post would never be seen.
    const stored = { uploaded_at: '2026-08-10T14:00:00Z', source_modified: '2026-08-10T10:51:00Z' };
    expect(isStale(stored, file('O1218.csv', '2026-08-10T15:00:00Z'))).toBe(true);
  });
});

describe('evaluateProgramFile', () => {
  const folders = machineFolders({ machines: [M300, R650] });
  const listings = new Map([
    ['fld-300', [file('O1218.csv', '2026-08-10T10:51:00Z'), file('O1400.NC', '2026-08-10T10:51:00Z'), file('notes.txt', '')]],
    ['fld-650', [file('O1400.csv', '2026-08-01T08:00:00Z')]],
  ]);
  const ev = (programNumber, over = {}) => evaluateProgramFile({
    candidates: candidatesFor(programNumber, folders, listings),
    foldersConfigured: folders.length,
    ...over,
  });

  it('says there is nothing to check when no folders are configured', () => {
    expect(evaluateProgramFile({ foldersConfigured: 0 }).state).toBe('no_folders');
  });

  it('reports a program with no posted file as missing', () => {
    expect(ev(9999).state).toBe('missing');
  });

  it('reports a file we have never taken as stale', () => {
    const r = ev(1218, { expectedFolderId: 'fld-300' });
    expect(r.state).toBe('stale');
    expect(r.stored).toBe(null);
    expect(r.wrongFolder).toBe(false);
  });

  it('reports current once we hold that exact version', () => {
    const r = ev(1218, { detail: { source_modified: '2026-08-10T10:51:00Z' }, expectedFolderId: 'fld-300' });
    expect(r.state).toBe('current');
  });

  it('flags the wrong folder ALONGSIDE the state, not instead of it', () => {
    // The file is in the M300 folder; this operation runs on the R650. There is
    // still something to do, and folding this into a "wrong folder" state would
    // hide that.
    const r = ev(1218, { expectedFolderId: 'fld-650' });
    expect(r.state).toBe('stale');
    expect(r.wrongFolder).toBe(true);
    expect(r.folder.folderId).toBe('fld-300');
  });

  it('never flags the wrong folder when nothing is expected', () => {
    expect(ev(1218, { expectedFolderId: null }).wrongFolder).toBe(false);
  });

  it('ignores the G-code sitting next to it in the same folder', () => {
    // O1400.NC is in fld-300 and O1400.csv is in fld-650 — the CSV must win.
    const r = ev(1400);
    expect(r.folder.folderId).toBe('fld-650');
    expect(r.duplicates).toBe(0);
  });
});

describe('candidatesFor — one listing per FOLDER, reused across every program', () => {
  it('scans a folder listing once for each program rather than re-fetching', () => {
    const folders = machineFolders({ machines: [M300] });
    const listings = new Map([['fld-300', [file('O1.csv', 'a'), file('O2.csv', 'b')]]]);
    expect(candidatesFor(1, folders, listings)).toHaveLength(1);
    expect(candidatesFor(2, folders, listings)).toHaveLength(1);
    expect(candidatesFor(3, folders, listings)).toHaveLength(0);
  });

  it('finds the same number in two folders and reports both', () => {
    const folders = machineFolders({ machines: [M300, R650] });
    const listings = new Map([
      ['fld-300', [file('O1218.csv', '2026-01-01T00:00:00Z', 'a')]],
      ['fld-650', [file('O1218.csv', '2026-02-01T00:00:00Z', 'b')]],
    ]);
    const r = evaluateProgramFile({
      candidates: candidatesFor(1218, folders, listings), foldersConfigured: 2,
    });
    expect(r.duplicates).toBe(1);
    expect(r.file.id).toBe('b');   // newest wins — an older copy of a reused number is out of date
  });
});
