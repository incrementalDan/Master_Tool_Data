import { describe, it, expect } from 'vitest';
import {
  parseArchiveFileName, buildVersionList, canCompare, defaultPair, versionLabel,
} from './programVersions.js';
import { archiveFileName } from '../context/programActions.js';

const f = (id, name, over = {}) => ({ id, name, mimeType: 'text/csv', modifiedTime: '', ...over });

describe('⚠️ the archive name parser is the inverse of the composer', () => {
  it('round-trips every name archiveFileName can produce', () => {
    // The two live in different modules and are a PAIR — a change to either
    // silently breaks the version list, which would then just look empty
    // rather than fail, so the round trip is asserted directly.
    const cases = [
      ['8-10-2026 10:51', true,  '2026-08-10T10:51:00'],
      ['12-1-2026 07:05', false, '2026-12-01T07:05:00'],
      ['1-9-2027 23:00',  true,  '2027-01-09T23:00:00'],
    ];
    for (const [posted, proven, iso] of cases) {
      const parsed = parseArchiveFileName(archiveFileName(1218, posted, proven));
      expect(parsed).toEqual({ postedIso: iso, proven });
    }
  });

  it('⚠️ skips an archive whose stamp was unreadable when it was retired', () => {
    // archiveFileName writes `unknown` rather than guessing a date, so the
    // parser must not accept it as a real version — a made-up date would sort
    // the picker wrongly and label the file with a time it never had.
    const name = archiveFileName(1218, 'not a stamp', false);
    expect(name).toContain('unknown');
    expect(parseArchiveFileName(name)).toBe(null);
  });

  it('ignores a file that is not one of ours', () => {
    expect(parseArchiveFileName('O1218.csv')).toBe(null);
    expect(parseArchiveFileName('notes.txt')).toBe(null);
    expect(parseArchiveFileName('O1218_unknown_proven.csv')).toBe(null);
  });
});

describe('buildVersionList', () => {
  const detail = {
    raw_file_id: 'raw-current', file_name: 'O1218.csv',
    posted: '8-10-2026 10:51', posted_at: '2026-08-10T10:51:00', proven: true,
  };
  const folder = [
    f('raw-current', 'O1218.csv'),
    f('a1', 'O1218_20260801-0800_proven.csv'),
    f('a2', 'O1218_20260715-1330_unproven.csv'),
    f('junk', 'scratch notes.txt'),
    f('sub', 'Old', { mimeType: 'application/vnd.google-apps.folder' }),
  ];

  it('lists current then archives, newest archive first', () => {
    const v = buildVersionList({ detail, folderFiles: folder });
    expect(v.map(x => x.kind)).toEqual(['current', 'archive', 'archive']);
    expect(v.map(x => x.fileId)).toEqual(['raw-current', 'a1', 'a2']);
  });

  it('⚠️ identifies the current file by its stored id, not by its name', () => {
    // The current version keeps its ORIGINAL filename, so name-matching would
    // pick whichever O1218* file the listing happened to return first.
    const v = buildVersionList({ detail, folderFiles: folder });
    expect(v.filter(x => x.kind === 'current')).toHaveLength(1);
    expect(v.some(x => x.kind === 'archive' && x.fileId === 'raw-current')).toBe(false);
  });

  it('leaves files it does not recognise alone', () => {
    const v = buildVersionList({ detail, folderFiles: folder });
    expect(v.some(x => x.fileId === 'junk' || x.fileId === 'sub')).toBe(false);
  });

  it('puts a not-yet-imported Drive file at the top, labelled as such', () => {
    const v = buildVersionList({
      detail, folderFiles: folder,
      pendingFile: f('drv', 'O1218.csv', { modifiedTime: '2026-09-01T09:00:00Z' }),
    });
    expect(v[0].kind).toBe('pending');
    // Its POSTED stamp is inside the file and has not been read — never
    // presented as if it had been.
    expect(v[0].postedIso).toBe('');
    expect(v[0].modifiedTime).toBe('2026-09-01T09:00:00Z');
  });

  it('handles a program with nothing stored at all', () => {
    expect(buildVersionList({})).toEqual([]);
    expect(buildVersionList({ detail: { file_name: 'x.csv' } })).toEqual([]);
  });
});

describe('when the compare is offered', () => {
  const one = [{ id: 'current:1' }];
  const two = [{ id: 'pending:2' }, { id: 'current:1' }];

  it('needs two versions — one is a dead end, not a compare', () => {
    expect(canCompare(one)).toBe(false);
    expect(canCompare(two)).toBe(true);
    expect(canCompare([])).toBe(false);
    expect(canCompare(undefined)).toBe(false);
  });

  it('opens on the newest pair — the question actually being asked', () => {
    expect(defaultPair(two)).toEqual({ left: 'current:1', right: 'pending:2' });
    expect(defaultPair(one)).toEqual({ left: null, right: null });
  });
});

describe('labels', () => {
  it('reads a posted stamp, and never invents one', () => {
    expect(versionLabel({ postedIso: '2026-08-10T10:51:00' })).toBe('2026-08-10 10:51');
    expect(versionLabel({ postedIso: '', name: 'O1218.csv' })).toBe('O1218.csv');
  });
});
