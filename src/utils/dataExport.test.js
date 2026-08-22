// The full backup bundle.
//
// The failure that matters here is not "export threw" — it is an export that
// LOOKS fine, sits on a drive for months, and turns out to be short at the only
// moment anyone opens it. So the manifest, and the check of the manifest against
// the payload, are the parts worth locking down.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildExportBundle, verifyBundle, exportFilename, EXPORT_FORMAT } from './dataExport.js';
import * as toolStore from '../services/toolStore.js';
import * as sharedStore from '../services/sharedStore.js';

const rows = (n, p = 'r') => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}` }));
const DEFAULTS = {
  materials: { groups: [] }, vendorRegistry: { entities: [] }, shopSettings: {},
  parts: { parts: [] }, components: { components: [] },
  holderLibrary: { holders: [] }, programDetails: { programs: [] },
};

beforeEach(() => vi.restoreAllMocks());

describe('buildExportBundle', () => {
  it('reads from STORAGE, not app state, and manifests what it got', async () => {
    // Reading state instead would bake in the load-time backfills, so restoring
    // the backup would silently apply changes nobody asked for.
    vi.spyOn(toolStore, 'loadAll').mockResolvedValue(rows(268, 't'));
    vi.spyOn(sharedStore, 'load').mockImplementation(async (key) => ({
      data: key === 'holderLibrary' ? { holders: rows(22, 'h') } : DEFAULTS[key],
      status: 'loaded',
    }));

    const b = await buildExportBundle(DEFAULTS, { shopSettings: { shop_name: 'Acme' } });

    expect(b.format).toBe(EXPORT_FORMAT);
    expect(b.shop_name).toBe('Acme');
    expect(b.data.tool_metadata).toHaveLength(268);
    expect(b.counts.tool_metadata).toBe(268);
    expect(b.counts.holderLibrary).toBe(22);
    expect(b.incomplete).toBeUndefined();
    expect(verifyBundle(b).ok).toBe(true);
  });

  it('states what it does NOT contain, rather than leaving it to be assumed', async () => {
    vi.spyOn(toolStore, 'loadAll').mockResolvedValue([]);
    vi.spyOn(sharedStore, 'load').mockImplementation(async (key) => ({ data: DEFAULTS[key], status: 'loaded' }));
    const b = await buildExportBundle(DEFAULTS);
    expect(b.excludes.fusion_libraries).toMatch(/ACC/);
    expect(b.excludes.blobs).toMatch(/Drive/);
  });

  it('RECORDS a file it could not read instead of silently omitting it', async () => {
    // A bundle quietly missing a file restores cleanly and leaves that data
    // behind — the worst possible outcome for a backup.
    vi.spyOn(toolStore, 'loadAll').mockResolvedValue(rows(10, 't'));
    vi.spyOn(sharedStore, 'load').mockImplementation(async (key) => {
      if (key === 'materials') throw new Error('Drive read failed (500)');
      return { data: DEFAULTS[key], status: 'loaded' };
    });

    const b = await buildExportBundle(DEFAULTS);
    expect(b.incomplete).toEqual([{ key: 'materials', error: 'Drive read failed (500)' }]);
    expect(b.data.materials).toBeUndefined();

    const check = verifyBundle(b);
    expect(check.ok).toBe(false);
    expect(check.problems.join(' ')).toMatch(/materials/);
  });
});

describe('verifyBundle', () => {
  const good = {
    format: EXPORT_FORMAT,
    counts: { tool_metadata: 3 },
    data: { tool_metadata: rows(3, 't') },
  };

  it('passes a bundle whose manifest matches its payload', () => {
    expect(verifyBundle(good)).toEqual({ ok: true, problems: [] });
  });

  it('catches a TRUNCATED payload — the whole reason the manifest exists', () => {
    const bad = { ...good, data: { tool_metadata: rows(1, 't') } };
    const r = verifyBundle(bad);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toContain('manifest says 3');
  });

  it('rejects a file that is not an export at all', () => {
    expect(verifyBundle({ hello: 'world' }).ok).toBe(false);
    expect(verifyBundle(null).ok).toBe(false);
  });
});

describe('exportFilename', () => {
  it('sorts chronologically and carries no colons (Windows-safe)', () => {
    const name = exportFilename({ exported_at: '2026-08-22T14:35:09.123Z' });
    expect(name).toBe('tooldex-backup-2026-08-22-14-35.json');
    expect(name).not.toContain(':');
  });
});
