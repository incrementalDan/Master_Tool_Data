// ─── Google Drive — METADATA ONLY ───────────────────────────────────────────
// The Fusion tool library now lives in Autodesk APS (see apsService.js).
// Google Drive is used solely for tool_metadata.json — the extra fields
// Fusion 360 does not support.

let _accessToken = null;
let _userInfo = null;
let _expiresAt = null;

export function setAccessToken(token, expiresIn) {
  _accessToken = token;
  // Store expiry with a 60-second buffer so we detect expiry before Drive rejects it
  _expiresAt = (token && expiresIn) ? Date.now() + (expiresIn - 60) * 1000 : null;
}
export function setUserInfo(info) { _userInfo = info; }
export function getCurrentUser() { return _userInfo; }
export function getAccessToken() { return _accessToken; }
export function signOut() {
  _accessToken = null;
  _userInfo = null;
  _expiresAt = null;
  localStorage.removeItem(TOOL_FILES_FOLDER_CACHE_KEY);
  localStorage.removeItem(PROGRAM_FILES_FOLDER_CACHE_KEY);
  localStorage.removeItem(CACHED_FILE_ID_KEY);
  for (const f of Object.values(SHARED_FILES)) localStorage.removeItem(f.cacheKey);
}
export function hasToken() { return !!_accessToken; }
export function isTokenExpired() {
  if (!_accessToken) return true;
  if (!_expiresAt) return false; // no expiry info — assume valid
  return Date.now() >= _expiresAt;
}
// Seconds until the current token lapses — 0 when there's no token or it's
// already expired, Infinity when the lifetime is unknown (don't proactively
// refresh). Drives the background silent-refresh keeper (App.jsx).
export function tokenSecondsRemaining() {
  if (!_accessToken) return 0;
  if (!_expiresAt) return Infinity;
  return Math.max(0, Math.round((_expiresAt - Date.now()) / 1000));
}

const CACHED_FILE_ID_KEY = 'drive_metadata_file_id';
const TOOL_FILES_FOLDER_CACHE_KEY = 'drive_tool_files_folder_id';

// Shared-file (same Drive root as tool_metadata.json) cached IDs.
export const SHARED_FILES = {
  materials:       { name: 'materials.json',       cacheKey: 'drive_materials_file_id' },
  vendorRegistry:  { name: 'vendor_registry.json', cacheKey: 'drive_vendor_registry_file_id' },
  shopSettings:    { name: 'shop_settings.json',   cacheKey: 'drive_shop_settings_file_id' },
  parts:           { name: 'parts.json',           cacheKey: 'drive_parts_file_id' },
  components:      { name: 'tool_components.json', cacheKey: 'drive_tool_components_file_id' },
  holderLibrary:   { name: 'holder_library.json',  cacheKey: 'drive_holder_library_file_id' },
  programDetails:  { name: 'program_details.json', cacheKey: 'drive_program_details_file_id' },
};

// [metadata root]/ProgramFiles/ — the per-program folders holding each
// program's raw posted files (the Sequence Detail CSV today, its G-code later).
const PROGRAM_FILES_FOLDER_CACHE_KEY = 'drive_program_files_folder_id';

// Use localStorage-cached ID first (set after auto-create), then env var.
function getMetaFileId() {
  return localStorage.getItem(CACHED_FILE_ID_KEY) || import.meta.env.VITE_METADATA_FILE_ID || '';
}

async function driveGet(fileId) {
  if (!fileId) return null;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${_accessToken}` } }
  );
  if (res.status === 404) return null;
  if (res.status === 401) throw Object.assign(new Error('Google token expired — please reconnect Drive'), { code: 'TOKEN_EXPIRED' });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Drive read failed (${res.status}): ${txt.slice(0, 200)}`);
  }
  const text = await res.text();
  if (!text.trim()) return null;
  try { return JSON.parse(text); }
  catch { throw new Error('Metadata file is not valid JSON'); }
}

// Create tool_metadata.json from scratch and cache the new file ID.
async function driveCreate(content, folderId = null) {
  const meta = { name: 'tool_metadata.json', mimeType: 'application/json' };
  if (folderId) meta.parents = [folderId];

  const boundary = 'drive_meta_boundary_314159';
  const body = [
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    JSON.stringify(meta),
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    JSON.stringify(content, null, 2),
    `--${boundary}--`,
  ].join('\r\n');

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${_accessToken}`,
        'Content-Type': `multipart/related; boundary="${boundary}"`,
      },
      body,
    }
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Drive create failed (${res.status}): ${txt.slice(0, 200)}`);
  }
  const file = await res.json();
  localStorage.setItem(CACHED_FILE_ID_KEY, file.id);
  return file;
}

async function driveUpdate(fileId, content) {
  if (!fileId) return driveCreate(content);
  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&supportsAllDrives=true`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${_accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(content, null, 2),
    }
  );
  if (res.status === 401) throw Object.assign(new Error('Google token expired — please reconnect Drive'), { code: 'TOKEN_EXPIRED' });
  if (res.status === 404) {
    // File no longer exists — create a fresh one and cache the new ID
    localStorage.removeItem(CACHED_FILE_ID_KEY);
    return driveCreate(content);
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Drive write failed (${res.status}): ${txt.slice(0, 200)}`);
  }
  return res.json();
}

export async function fetchUserInfo() {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${_accessToken}` },
  });
  if (res.status === 401) throw Object.assign(new Error('Google token expired'), { code: 'TOKEN_EXPIRED' });
  if (!res.ok) throw new Error('Failed to fetch user info');
  const info = await res.json();
  setUserInfo(info);
  return info;
}

// ─── Metadata CRUD ───────────────────────────────────────────────────────────
export async function loadMetadata() {
  const data = await driveGet(getMetaFileId());
  return Array.isArray(data) ? data : [];
}

// Re-read, upsert one metadata record by id, write back (prevents overwrites)
export async function upsertMetadata(metadataTool) {
  const list = await loadMetadata();
  const idx = list.findIndex(m => m.id === metadataTool.id);
  if (idx >= 0) list[idx] = metadataTool;
  else list.push(metadataTool);
  await driveUpdate(getMetaFileId(), list);
}

// Re-read, remove one metadata record by id, write back
export async function deleteMetadata(id) {
  const list = await loadMetadata();
  await driveUpdate(getMetaFileId(), list.filter(m => m.id !== id));
}

// Replace the entire metadata file (used by the import flow)
export async function saveAllMetadata(metaList) {
  await driveUpdate(getMetaFileId(), metaList);
}

// ─── Shared JSON files (same Drive root as tool_metadata.json) ───────────────
// materials.json, vendor_registry.json, shop_settings.json live alongside the
// metadata file. Each is loaded-or-created at startup and saved back on change.
// Content is pretty-printed like tool_metadata.json (see Code Standards).

async function findFileInFolder(parentId, name) {
  const q = `'${parentId}' in parents and name=${JSON.stringify(name)} and trashed=false`;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${_accessToken}` } }
  );
  if (res.status === 401) throw Object.assign(new Error('Google token expired — please reconnect Drive'), { code: 'TOKEN_EXPIRED' });
  if (!res.ok) return null;
  const data = await res.json();
  return data.files?.[0]?.id || null;
}

async function createSharedJson(name, parentId, content) {
  const meta = { name, mimeType: 'application/json', parents: [parentId] };
  const boundary = 'drive_shared_json_boundary';
  const body = [
    `--${boundary}`, 'Content-Type: application/json', '', JSON.stringify(meta),
    `--${boundary}`, 'Content-Type: application/json', '', JSON.stringify(content, null, 2),
    `--${boundary}--`,
  ].join('\r\n');
  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${_accessToken}`, 'Content-Type': `multipart/related; boundary="${boundary}"` },
      body,
    }
  );
  if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`Drive create ${name} failed (${res.status}): ${t.slice(0, 200)}`); }
  return res.json();
}

// Load a shared JSON file by name; create it with `defaultContent` if it doesn't
// exist yet. Caches the file ID under `cacheKey`. Returns the parsed content.
export async function loadOrCreateSharedJson(name, cacheKey, defaultContent) {
  let id = localStorage.getItem(cacheKey);
  if (id) {
    const data = await driveGet(id);
    if (data !== null) return data;
    localStorage.removeItem(cacheKey); // stale/deleted — fall through to find/create
  }
  const parentId = await getMetaParentFolderId();
  id = await findFileInFolder(parentId, name);
  if (id) {
    localStorage.setItem(cacheKey, id);
    const data = await driveGet(id);
    if (data !== null) return data;
  }
  const file = await createSharedJson(name, parentId, defaultContent);
  localStorage.setItem(cacheKey, file.id);
  return defaultContent;
}

// Save a shared JSON file by name (re-find/create if the cached ID is stale).
// `keepalive` lets the PATCH outlive a page unload (used by the flush-on-hide
// path) — safe here because these files are small (well under the 64KB cap).
export async function saveSharedJson(name, cacheKey, content, { keepalive = false } = {}) {
  let id = localStorage.getItem(cacheKey);
  if (!id) {
    const parentId = await getMetaParentFolderId();
    id = await findFileInFolder(parentId, name);
    if (!id) { id = (await createSharedJson(name, parentId, content)).id; localStorage.setItem(cacheKey, id); return; }
    localStorage.setItem(cacheKey, id);
  }
  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media&supportsAllDrives=true`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${_accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(content, null, 2),
      keepalive,
    }
  );
  if (res.status === 401) throw Object.assign(new Error('Google token expired — please reconnect Drive'), { code: 'TOKEN_EXPIRED' });
  if (res.status === 404) { localStorage.removeItem(cacheKey); return saveSharedJson(name, cacheKey, content); }
  if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`Drive save ${name} failed (${res.status}): ${t.slice(0, 200)}`); }
}

// ─── Folder picker helpers ────────────────────────────────────────────────────

// Reports whether the configured metadata file is actually usable. Returns
// { configured, missing, trashed }. This is stricter than checkMetadataFile:
// a TRASHED file still reads and writes through the Drive API (so the app can
// silently save into a file sitting in the trash — the exact failure that loses
// notes/photos), and a deleted file 404s. Both mean the metadata is effectively
// gone and the user should be warned. An inconclusive error (network/permission)
// reports healthy so we never raise a false alarm.
export async function getMetadataFileHealth() {
  const id = getMetaFileId();
  if (!id) return { configured: false, missing: false, trashed: false };
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${id}?fields=id,trashed&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${_accessToken}` } }
  );
  if (res.status === 401) throw Object.assign(new Error('Google token expired — please reconnect Drive'), { code: 'TOKEN_EXPIRED' });
  if (res.status === 404) return { configured: true, missing: true, trashed: false };
  if (!res.ok) return { configured: true, missing: false, trashed: false };
  const file = await res.json();
  return { configured: true, missing: false, trashed: !!file.trashed };
}

// Returns true if the configured metadata file actually exists.
export async function checkMetadataFile() {
  const id = getMetaFileId();
  if (!id) return false;
  const data = await driveGet(id);
  return data !== null;
}

async function fetchFileName(fileId) {
  if (!fileId) return null;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${_accessToken}` } }
  );
  if (!res.ok) return null;
  return (await res.json()).name;
}

async function fetchDriveName(driveId) {
  if (!driveId) return null;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/drives/${driveId}?fields=name`,
    { headers: { Authorization: `Bearer ${_accessToken}` } }
  );
  if (!res.ok) return null;
  return (await res.json()).name;
}

// Resolves the configured metadata file's name and where it lives (parent folder,
// and shared-drive name if applicable) — used by Settings to show the operator
// which Drive file this Fusion library's metadata is linked to, and its location.
// Returns null if no metadata file is configured.
export async function getMetadataFileLocation() {
  const id = getMetaFileId();
  if (!id) return null;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,parents,driveId,webViewLink&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${_accessToken}` } }
  );
  if (res.status === 401) throw Object.assign(new Error('Google token expired — please reconnect Drive'), { code: 'TOKEN_EXPIRED' });
  if (!res.ok) return null;
  const file = await res.json();

  const [folderName, driveName] = await Promise.all([
    fetchFileName(file.parents?.[0]),
    fetchDriveName(file.driveId),
  ]);

  return {
    fileId: file.id,
    fileName: file.name,
    folderName,
    driveName,
    webViewLink: file.webViewLink,
  };
}

// List folders inside a Drive parent ('root' = My Drive root, or a folder ID).
export async function listFolders(parentId = 'root') {
  const q = `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=name&fields=files(id,name)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${_accessToken}` } }
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Failed to list folders (${res.status}): ${txt.slice(0, 100)}`);
  }
  const data = await res.json();
  return data.files || [];
}

// List shared drives accessible to the user (some accounts may have none).
export async function listSharedDrives() {
  const res = await fetch(
    'https://www.googleapis.com/drive/v3/drives?pageSize=20&fields=drives(id,name)',
    { headers: { Authorization: `Bearer ${_accessToken}` } }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.drives || [];
}

// Create an empty tool_metadata.json in the specified folder and cache its ID.
export async function createMetadataInFolder(folderId) {
  return driveCreate([], folderId);
}

// Check which of the three shared JSON files (materials, vendor registry, shop settings)
// exist in a folder. Pass null for folderId to search My Drive root.
// Returns { [filename]: boolean } for each file in SHARED_FILES.
export async function checkSharedFilesInFolder(folderId) {
  const parent = folderId || 'root';
  const results = await Promise.all(
    Object.values(SHARED_FILES).map(async ({ name }) => {
      const q = `'${parent}' in parents and name=${JSON.stringify(name)} and trashed=false`;
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
        { headers: { Authorization: `Bearer ${_accessToken}` } }
      );
      if (res.status === 401) throw Object.assign(new Error('Google token expired — please reconnect Drive'), { code: 'TOKEN_EXPIRED' });
      if (!res.ok) return [name, false];
      const data = await res.json();
      return [name, (data.files?.length ?? 0) > 0];
    })
  );
  return Object.fromEntries(results);
}

// Search for an existing tool_metadata.json in a folder without reading its content.
// Pass null for folderId to search My Drive root.
// Returns { id, name, modifiedTime } or null.
export async function findMetadataInFolder(folderId) {
  const parent = folderId || 'root';
  const q = `'${parent}' in parents and name='tool_metadata.json' and trashed=false`;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${_accessToken}` } }
  );
  if (res.status === 401) throw Object.assign(new Error('Google token expired — please reconnect Drive'), { code: 'TOKEN_EXPIRED' });
  if (!res.ok) return null;
  const data = await res.json();
  return data.files?.[0] || null;
}

// Store an existing metadata file's ID in localStorage without writing any content.
// Called when the user selects an existing file rather than creating a new one.
export function connectToMetadataFile(fileId) {
  localStorage.setItem(CACHED_FILE_ID_KEY, fileId);
}

// Find shop_settings.json in a folder and return its parsed content without creating it.
// Used by ShopConnect to preview what libraries are registered before connecting.
// Returns { fileId, shopSettings } or null if not found.
export async function previewShopSettingsFromFolder(folderId) {
  const parent = folderId || 'root';
  const q = `'${parent}' in parents and name='shop_settings.json' and trashed=false`;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${_accessToken}` } }
  );
  if (res.status === 401) throw Object.assign(new Error('Google token expired — please reconnect Drive'), { code: 'TOKEN_EXPIRED' });
  if (!res.ok) return null;
  const data = await res.json();
  const fileId = data.files?.[0]?.id;
  if (!fileId) return null;
  const shopSettings = await driveGet(fileId);
  return shopSettings ? { fileId, shopSettings } : null;
}

// ─── Tool file storage ────────────────────────────────────────────────────────
// Folder layout: [metadata root]/tool_files/{trackingId}/{filename}

// Look up a folder by name without creating one — null when absent. Split out
// so a caller can distinguish "not there" from "made a new one", which is what
// lets ensureProgramFolder adopt a legacy folder instead of duplicating it.
async function findFolder(parentId, name) {
  const q = `'${parentId}' in parents and name=${JSON.stringify(name)} and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${_accessToken}` } }
  );
  if (res.status === 401) throw Object.assign(new Error('Google token expired — please reconnect Drive'), { code: 'TOKEN_EXPIRED' });
  if (!res.ok) throw new Error(`Folder search failed (${res.status})`);
  const data = await res.json();
  return data.files?.[0]?.id || null;
}

async function findOrCreateFolder(parentId, name) {
  const existing = await findFolder(parentId, name);
  if (existing) return existing;
  const cr = await fetch(
    'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${_accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
    }
  );
  if (!cr.ok) throw new Error(`Folder create failed (${cr.status})`);
  return (await cr.json()).id;
}

// True only when `id` resolves to a real, non-trashed item. A 404 means it was
// permanently deleted (not just trashed — Drive still resolves a trashed item);
// treated the same as gone either way, since a cached pointer to a trashed
// folder is exactly as useless as one to a deleted one.
async function folderIsUsable(id) {
  if (!id) return false;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${id}?fields=id,trashed&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${_accessToken}` } }
  );
  if (res.status === 401) throw Object.assign(new Error('Google token expired — please reconnect Drive'), { code: 'TOKEN_EXPIRED' });
  if (!res.ok) return false;
  const file = await res.json();
  return !file.trashed;
}

async function getMetaParentFolderId() {
  const metaId = getMetaFileId();
  if (!metaId) throw new Error('No metadata file configured — connect Google Drive first');
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${metaId}?fields=parents&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${_accessToken}` } }
  );
  if (res.status === 401) throw Object.assign(new Error('Google token expired — please reconnect Drive'), { code: 'TOKEN_EXPIRED' });
  if (!res.ok) throw new Error('Failed to read metadata file location');
  const file = await res.json();
  const parentId = file.parents?.[0];
  if (!parentId) throw new Error('Metadata file has no parent folder');
  return parentId;
}

// Ensures [metadata root]/tool_files/{trackingId}/ exists and returns its Drive
// ID.
//
// ⚠️ A cached ID is VERIFIED before trust, not just trusted because it's there.
// The cache exists to skip the parent-folder lookup on every call, but if the
// folder was deleted (or trashed) directly in Drive since it was cached, using
// the dead ID blindly means every subsequent call fails outright — the app
// then needs a manual "disconnect and reconnect" to recover, which throws away
// the whole linked-library setup to fix one stale folder pointer. Checking
// costs one extra request only when the cache is populated, and self-heals by
// clearing the cache and re-running the normal find-or-create path.
export async function ensureToolFolder(trackingId) {
  let toolFilesFolderId = localStorage.getItem(TOOL_FILES_FOLDER_CACHE_KEY);
  if (toolFilesFolderId && !(await folderIsUsable(toolFilesFolderId))) {
    toolFilesFolderId = null;
    localStorage.removeItem(TOOL_FILES_FOLDER_CACHE_KEY);
  }
  if (!toolFilesFolderId) {
    const parentId = await getMetaParentFolderId();
    toolFilesFolderId = await findOrCreateFolder(parentId, 'tool_files');
    localStorage.setItem(TOOL_FILES_FOLDER_CACHE_KEY, toolFilesFolderId);
  }
  return findOrCreateFolder(toolFilesFolderId, trackingId);
}

// Ensures [metadata root]/ProgramFiles/{folderName}/ exists and returns its
// Drive ID. One folder per program (e.g. "O1218") holding that program's raw
// posted files exactly as they came out of the post — never rewritten by the app.
//
// ⚠️ This folder was called JobFiles. An existing one is ADOPTED by renaming it
// in place rather than left behind: a Drive rename keeps the folder's ID, so
// every already-uploaded raw CSV (and the detail records pointing at them by
// file id) survives untouched. Creating a second folder instead would strand
// them somewhere the app no longer looks, which is indistinguishable from
// having lost them.
//
// ⚠️ The cached root ID is VERIFIED, not just trusted — same reasoning as
// ensureToolFolder above (a deleted/trashed folder would otherwise hard-fail
// every future upload until someone manually clears the cache or reconnects
// Drive). Self-heals by clearing the cache and re-running the normal
// adopt-legacy-or-create path.
export async function ensureProgramFolder(folderName) {
  let rootId = localStorage.getItem(PROGRAM_FILES_FOLDER_CACHE_KEY);
  if (rootId && !(await folderIsUsable(rootId))) {
    rootId = null;
    localStorage.removeItem(PROGRAM_FILES_FOLDER_CACHE_KEY);
  }
  if (!rootId) {
    const parentId = await getMetaParentFolderId();
    rootId = await findFolder(parentId, 'ProgramFiles');
    if (!rootId) {
      const legacyId = await findFolder(parentId, 'JobFiles');
      if (legacyId) {
        await renameDriveFile(legacyId, 'ProgramFiles');
        rootId = legacyId;
      }
    }
    rootId = rootId || await findOrCreateFolder(parentId, 'ProgramFiles');
    localStorage.setItem(PROGRAM_FILES_FOLDER_CACHE_KEY, rootId);
  }
  return findOrCreateFolder(rootId, folderName);
}

// List the files already in a program's folder, WITHOUT creating anything.
//
// ⚠️ Read-only on purpose — this backs the version compare, which must be able
// to answer "there is nothing to compare" without leaving an empty folder behind
// for every program anyone happened to look at. Returns [] when the program (or
// the ProgramFiles root) has no folder yet: that is the honest answer, not an
// error. `ensureProgramFolder` stays the write path.
export async function listProgramFolderFiles(folderName) {
  const rootId = localStorage.getItem(PROGRAM_FILES_FOLDER_CACHE_KEY);
  if (!rootId || !(await folderIsUsable(rootId))) {
    const parentId = await getMetaParentFolderId();
    const found = await findFolder(parentId, 'ProgramFiles');
    if (!found) return [];
    localStorage.setItem(PROGRAM_FILES_FOLDER_CACHE_KEY, found);
    const sub = await findFolder(found, folderName);
    return sub ? listFolderChildren(sub) : [];
  }
  const sub = await findFolder(rootId, folderName);
  return sub ? listFolderChildren(sub) : [];
}

// Rename a Drive file in place — the file ID, and so every reference to it,
// survives. Used to archive the previous version of a posted file (the current
// version always keeps its original name, so "download the current file" is
// unambiguous).
export async function renameDriveFile(fileId, name) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true&fields=id,name`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${_accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }
  );
  if (res.status === 401) throw Object.assign(new Error('Google token expired — please reconnect Drive'), { code: 'TOKEN_EXPIRED' });
  // Same rule as fetchFileBlob: 404 is a KNOWN state (the file was deleted in
  // Drive since we stored its id), not a fault — tagged so a caller with a
  // sensible answer for "it's already gone" can act on it.
  if (res.status === 404) {
    throw Object.assign(new Error('That file is no longer in Drive'), { code: 'NOT_FOUND' });
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`File rename failed (${res.status}): ${txt.slice(0, 200)}`);
  }
  return res.json();
}

// Fetch a Drive file as text. The raw posted files are stored untouched, so
// this returns exactly the bytes the post wrote.
export async function fetchFileText(fileId) {
  return (await fetchFileBlob(fileId)).text();
}

// Upload a File object into the given Drive folder. Returns { id, name }.
export async function uploadToolFile(folderId, file, fileName) {
  const meta = { name: fileName, parents: [folderId] };
  const boundary = 'tms_file_upload_boundary';
  const fileBuffer = await file.arrayBuffer();
  const enc = new TextEncoder();
  const header = enc.encode(
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`
  );
  const tail = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(header.byteLength + fileBuffer.byteLength + tail.byteLength);
  body.set(header);
  body.set(new Uint8Array(fileBuffer), header.byteLength);
  body.set(tail, header.byteLength + fileBuffer.byteLength);
  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${_accessToken}`,
        'Content-Type': `multipart/related; boundary="${boundary}"`,
      },
      body,
    }
  );
  if (res.status === 401) throw Object.assign(new Error('Google token expired — please reconnect Drive'), { code: 'TOKEN_EXPIRED' });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`File upload failed (${res.status}): ${txt.slice(0, 200)}`);
  }
  return res.json();
}

// Delete a file from Drive. 404 is treated as success (already gone).
export async function deleteToolFile(fileId) {
  if (!fileId) return;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${_accessToken}` } }
  );
  if (res.status === 401) throw Object.assign(new Error('Google token expired — please reconnect Drive'), { code: 'TOKEN_EXPIRED' });
  if (res.status === 404) return;
  if (!res.ok) throw new Error(`File delete failed (${res.status})`);
}

// List all non-trashed children (files AND folders) of a Drive folder.
// Returns [{ id, name, mimeType, modifiedTime }]. Used by the one-time
// ProShop-photo import to scan a source folder's per-tool subfolders, and by
// the posted-program sync to find a program's CSV.
//
// ⚠️ `modifiedTime` comes free with the listing and is what makes the posted-file
// poll cheap — one call per FOLDER answers "has anything changed?" for every
// program on the page, where reading each file's own POSTED stamp would cost a
// download per program. See utils/programFileSync.js.
export async function listFolderChildren(parentId) {
  const q = `'${parentId}' in parents and trashed=false`;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=name&fields=files(id,name,mimeType,modifiedTime)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${_accessToken}` } }
  );
  if (res.status === 401) throw Object.assign(new Error('Google token expired — please reconnect Drive'), { code: 'TOKEN_EXPIRED' });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Failed to list folder contents (${res.status}): ${txt.slice(0, 100)}`);
  }
  const data = await res.json();
  return data.files || [];
}

// Server-side copy a Drive file into a target folder (no byte transfer through
// the browser). Returns { id, name }. The source file is never modified.
export async function copyDriveFile(fileId, name, parentFolderId) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/copy?supportsAllDrives=true&fields=id,name`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${_accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parents: [parentFolderId] }),
    }
  );
  if (res.status === 401) throw Object.assign(new Error('Google token expired — please reconnect Drive'), { code: 'TOKEN_EXPIRED' });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`File copy failed (${res.status}): ${txt.slice(0, 200)}`);
  }
  return res.json();
}

// Fetch a Drive file as a Blob (authenticated, works for team/shared files).
export async function fetchFileBlob(fileId) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${_accessToken}` } }
  );
  if (res.status === 401) throw Object.assign(new Error('Google token expired — please reconnect Drive'), { code: 'TOKEN_EXPIRED' });
  // ⚠️ 404 is a KNOWN state, not a fault: the file was deleted in Drive since
  // we stored its id. Tagged so a caller that has a sensible answer for "it's
  // gone" (re-upload to restore it) can act on that, instead of surfacing a raw
  // "File fetch failed (404)" — which reads as a bug in the app rather than a
  // thing the user can fix.
  if (res.status === 404) {
    throw Object.assign(new Error('That file is no longer in Drive'), { code: 'NOT_FOUND' });
  }
  if (!res.ok) throw new Error(`File fetch failed (${res.status})`);
  return res.blob();
}
