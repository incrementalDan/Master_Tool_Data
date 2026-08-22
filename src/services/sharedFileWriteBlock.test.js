// The shared-file write block.
//
// The bug this locks out: a shared file whose READ failed was replaced in memory
// by its seed, and the app then happily saved that seed back over the real file.
// The distinction between "loaded", "created" and "failed" is the whole fix, so
// each one is asserted separately — collapsing any two of them is the defect.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as drive from './driveService.js';

const OK = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

// The service reads/writes localStorage for its file-id cache; these tests run
// in the node environment, so give it a minimal in-memory one.
const store = new Map();
vi.stubGlobal('localStorage', {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
});

describe('loadOrCreateSharedJson reports HOW the data was obtained', () => {
  beforeEach(() => {
    localStorage.clear();
    drive.setAccessToken('test-token', 3600);
    drive.setBlockedSharedFiles([]);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('a file read from Drive reports "loaded"', async () => {
    localStorage.setItem('ck', 'file-1');
    vi.stubGlobal('fetch', vi.fn(async () => OK({ real: 'data' })));
    const res = await drive.loadOrCreateSharedJson('materials.json', 'ck', { seed: true });
    expect(res).toEqual({ data: { real: 'data' }, status: 'loaded' });
  });

  it('a read ERROR throws — it is NEVER silently turned into the seed', async () => {
    // This is the core invariant. If this function ever returns the seed on an
    // error, the caller cannot tell a blank file from an unreadable one, and the
    // blank gets saved back over the real data.
    localStorage.setItem('ck', 'file-1');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => 'boom' })));
    await expect(drive.loadOrCreateSharedJson('materials.json', 'ck', { seed: true })).rejects.toThrow();
  });

  it('malformed JSON throws rather than reading as empty', async () => {
    localStorage.setItem('ck', 'file-1');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => '{ truncated' })));
    await expect(drive.loadOrCreateSharedJson('materials.json', 'ck', { seed: true })).rejects.toThrow();
  });
});

describe('the write block at the choke point', () => {
  beforeEach(() => {
    localStorage.clear();
    drive.setAccessToken('test-token', 3600);
    drive.setBlockedSharedFiles([]);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('refuses to save a blocked file, and never reaches the network', async () => {
    const fetchSpy = vi.fn(async () => OK({}));
    vi.stubGlobal('fetch', fetchSpy);
    drive.setBlockedSharedFiles(['shop_settings.json']);
    localStorage.setItem('ss', 'file-9');

    await expect(
      drive.saveSharedJson('shop_settings.json', 'ss', { anything: 1 })
    ).rejects.toMatchObject({ code: 'WRITE_BLOCKED' });

    // Not just rejected — no request was made. A blocked write must be inert.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('blocks ONLY the named file — one bad file must not lock the others', async () => {
    const fetchSpy = vi.fn(async () => OK({}));
    vi.stubGlobal('fetch', fetchSpy);
    drive.setBlockedSharedFiles(['shop_settings.json']);
    localStorage.setItem('mk', 'file-2');

    await expect(drive.saveSharedJson('materials.json', 'mk', { ok: 1 })).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('lifting the block re-enables saving', async () => {
    // A block the user cannot clear is a bricked app. The retry path depends on
    // this being genuinely reversible.
    const fetchSpy = vi.fn(async () => OK({}));
    vi.stubGlobal('fetch', fetchSpy);
    localStorage.setItem('ss', 'file-9');

    drive.setBlockedSharedFiles(['shop_settings.json']);
    expect(drive.isSharedFileBlocked('shop_settings.json')).toBe(true);

    drive.setBlockedSharedFiles([]);
    expect(drive.isSharedFileBlocked('shop_settings.json')).toBe(false);
    await expect(drive.saveSharedJson('shop_settings.json', 'ss', { ok: 1 })).resolves.toBeUndefined();
  });
});
