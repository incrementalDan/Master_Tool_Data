// The shared-file repository seam.
//
// The twin of toolStore.js, for the seven shared JSON files (materials, vendor
// registry, shop settings, parts, components, holder library, program details).
// Two payoffs, the same two toolStore has:
//
//   1. ONE swap point for the storage backend. tool_metadata.json is already
//      fully insulated — 37 call sites, all through toolStore. The shared files
//      were not: AppContext called driveService directly, threading the
//      (name, cacheKey) pair by hand at every site. That is the half of the
//      storage layer the planned database migration would otherwise have to
//      unpick one call at a time. See CLOUDFLARE_MIGRATION_PLAN.md §3.
//
//   2. A place to put rules that must hold for EVERY write, where no caller can
//      forget them — the shrink guard below being the first.
//
// Rule: outside this module, do not call driveService.{loadOrCreateSharedJson,
// saveSharedJson} directly — use the seam.
import * as driveService from './driveService.js';
import { assertNotShrinking, recordSizeFromLoad, recordSizeFromWrite } from './writeGuard.js';

// The app's key → the file it lives in. Callers name the KEY ('materials'); the
// filename and its localStorage cache key stay in here.
export const SHARED_KEYS = Object.freeze([
  'materials', 'vendorRegistry', 'shopSettings',
  'parts', 'components', 'holderLibrary', 'programDetails',
]);

export function fileNameFor(key) {
  return driveService.SHARED_FILES[key]?.name || key;
}

function fileFor(key) {
  const f = driveService.SHARED_FILES[key];
  if (!f) throw new Error(`Unknown shared file key: ${key}`);
  return f;
}

// Load one shared file.
//
// Returns { data, status } — 'loaded' (read from the backend) or 'created'
// (genuinely absent, so seeded). A read ERROR throws; it is never quietly turned
// into the seed, because the caller must be able to tell "this is blank" from
// "we could not read it" (DATA_LOSS_AUDIT.md hole 1).
export async function load(key, defaultContent) {
  const f = fileFor(key);
  const res = await driveService.loadOrCreateSharedJson(f.name, f.cacheKey, defaultContent);
  // A successful read is the moment we know how big this file legitimately is.
  if (res.status === 'loaded') recordSizeFromLoad(key, res.data);
  return res;
}

// Save one shared file.
//
// `keepalive` lets the write outlive a page unload (the flush-on-hide path).
// Throws { code: 'WRITE_BLOCKED' } for a file that failed to load this session,
// { code: 'WRITES_LOCKED' } for a dev build against live data, and
// { code: 'WRITE_SHRANK' } if the content collapsed — see writeGuard.js.
export async function save(key, content, { keepalive = false, force = false } = {}) {
  const f = fileFor(key);
  if (!force) assertNotShrinking(key, content);
  await driveService.saveSharedJson(f.name, f.cacheKey, content, { keepalive });
  recordSizeFromWrite(key, content);
}
