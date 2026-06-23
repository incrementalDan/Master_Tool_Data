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
  localStorage.removeItem(CACHED_FILE_ID_KEY);
  for (const f of Object.values(SHARED_FILES)) localStorage.removeItem(f.cacheKey);
}
export function hasToken() { return !!_accessToken; }
export function isTokenExpired() {
  if (!_accessToken) return true;
  if (!_expiresAt) return false; // no expiry info — assume valid
  return Date.now() >= _expiresAt;
}

const CACHED_FILE_ID_KEY = 'drive_metadata_file_id';
const TOOL_FILES_FOLDER_CACHE_KEY = 'drive_tool_files_folder_id';

// Shared-file (same Drive root as tool_metadata.json) cached IDs.
export const SHARED_FILES = {
  materials:       { name: 'materials.json',       cacheKey: 'drive_materials_file_id' },
  vendorRegistry:  { name: 'vendor_registry.json', cacheKey: 'drive_vendor_registry_file_id' },
  shopSettings:    { name: 'shop_settings.json',   cacheKey: 'drive_shop_settings_file_id' },
};

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
export async function saveSharedJson(name, cacheKey, content) {
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

// ─── Tool file storage ────────────────────────────────────────────────────────
// Folder layout: [metadata root]/tool_files/{trackingId}/{filename}

async function findOrCreateFolder(parentId, name) {
  const q = `'${parentId}' in parents and name=${JSON.stringify(name)} and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${_accessToken}` } }
  );
  if (res.status === 401) throw Object.assign(new Error('Google token expired — please reconnect Drive'), { code: 'TOKEN_EXPIRED' });
  if (!res.ok) throw new Error(`Folder search failed (${res.status})`);
  const data = await res.json();
  if (data.files?.length > 0) return data.files[0].id;
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

// Ensures [metadata root]/tool_files/{trackingId}/ exists and returns its Drive ID.
export async function ensureToolFolder(trackingId) {
  let toolFilesFolderId = localStorage.getItem(TOOL_FILES_FOLDER_CACHE_KEY);
  if (!toolFilesFolderId) {
    const parentId = await getMetaParentFolderId();
    toolFilesFolderId = await findOrCreateFolder(parentId, 'tool_files');
    localStorage.setItem(TOOL_FILES_FOLDER_CACHE_KEY, toolFilesFolderId);
  }
  return findOrCreateFolder(toolFilesFolderId, trackingId);
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
// Returns [{ id, name, mimeType }]. Used by the one-time ProShop-photo import
// to scan a source folder's per-tool subfolders and their photo files.
export async function listFolderChildren(parentId) {
  const q = `'${parentId}' in parents and trashed=false`;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=name&fields=files(id,name,mimeType)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`,
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
  if (!res.ok) throw new Error(`File fetch failed (${res.status})`);
  return res.blob();
}
