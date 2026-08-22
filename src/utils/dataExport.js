// Export everything — one portable file holding every record the app owns.
//
// THREE JOBS, which is why it is worth building even though a database
// migration is planned:
//   1. The interim backup, until point-in-time restore exists.
//   2. Step 2 of the storage cutover (CLOUDFLARE_MIGRATION_PLAN.md §6) — the
//      import script reads this exact bundle, so the thing you verified is
//      provably the thing that landed.
//   3. A permanent escape hatch. Whatever the backend becomes, "give me all my
//      data in a file I can read" should never stop working.
//
// ⚠️ IT READS FRESH FROM STORAGE, NOT FROM APP STATE. In-memory tools have been
// through the load-time backfills (FK stamping, name re-derivation, link
// symmetrising), so they differ from what is stored. A backup has to be what is
// actually in the file, or restoring it silently applies a set of changes nobody
// asked for. The round trip is also the point: an export that succeeds proves
// every file was readable at that moment.
//
// ⚠️ ONE FILE, NOT EIGHT. A restore needs the set to be consistent with itself —
// tools, holders, parts and settings all from the same instant. Eight separate
// downloads is eight chances to end up with a mismatched set, and no way to tell
// afterwards. The manifest records what SHOULD be inside so a truncated or
// hand-edited bundle is detectable rather than merely wrong.
import * as toolStore from '../services/toolStore.js';
import * as sharedStore from '../services/sharedStore.js';
import { sizeOf } from '../services/writeGuard.js';

export const EXPORT_FORMAT = 'tooldex-export/1';

// Assemble the bundle. `defaults` supplies each shared file's seed, matching how
// loadTools reads them.
export async function buildExportBundle(defaults, { shopSettings } = {}) {
  const tools = await toolStore.loadAll();

  const shared = {};
  const failed = [];
  for (const key of sharedStore.SHARED_KEYS) {
    try {
      const { data } = await sharedStore.load(key, defaults[key]);
      shared[key] = data;
    } catch (e) {
      // ⚠️ Recorded, never silently omitted. A bundle missing a file without
      // saying so is worse than no bundle: it restores cleanly and quietly
      // leaves that data behind.
      failed.push({ key, error: e.message });
    }
  }

  const counts = { tool_metadata: sizeOf(tools) };
  for (const [k, v] of Object.entries(shared)) counts[k] = sizeOf(v);

  return {
    format: EXPORT_FORMAT,
    exported_at: new Date().toISOString(),
    shop_name: shopSettings?.shop_name || null,
    counts,
    // What is NOT in here, stated explicitly so a restore does not assume it is.
    excludes: {
      fusion_libraries: 'Versioned in Autodesk ACC — restore a prior version there.',
      blobs: 'Tool photos, attachments and posted CSVs stay in Google Drive.',
    },
    incomplete: failed.length ? failed : undefined,
    data: { tool_metadata: tools, ...shared },
  };
}

export function exportFilename(bundle) {
  const stamp = (bundle.exported_at || new Date().toISOString()).slice(0, 16).replace(/[:T]/g, '-');
  return `tooldex-backup-${stamp}.json`;
}

export function downloadBundle(bundle) {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFilename(bundle);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Verify a bundle before trusting it — used by a restore/import, and worth
// running on a file that has been sitting on a drive for months.
export function verifyBundle(bundle) {
  const problems = [];
  if (bundle?.format !== EXPORT_FORMAT) problems.push(`Not a ToolDex export (format: ${bundle?.format ?? 'missing'})`);
  if (!bundle?.data) problems.push('No data block');
  if (bundle?.incomplete?.length) {
    problems.push(`Incomplete when exported: ${bundle.incomplete.map(f => f.key).join(', ')}`);
  }
  for (const [key, expected] of Object.entries(bundle?.counts || {})) {
    const actual = sizeOf(bundle?.data?.[key]);
    // The manifest is only useful if it is actually checked against the payload.
    if (expected != null && actual !== expected) {
      problems.push(`${key}: manifest says ${expected} entries, file has ${actual ?? 'none'}`);
    }
  }
  return { ok: problems.length === 0, problems };
}
