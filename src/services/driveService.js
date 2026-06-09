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
}
export function hasToken() { return !!_accessToken; }
export function isTokenExpired() {
  if (!_accessToken) return true;
  if (!_expiresAt) return false; // no expiry info — assume valid
  return Date.now() >= _expiresAt;
}

const CACHED_FILE_ID_KEY = 'drive_metadata_file_id';
const TOOL_FILES_FOLDER_CACHE_KEY = 'drive_tool_files_folder_id';

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
    JSON.stringify(content),
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
      body: JSON.stringify(content),
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

// ─── Folder picker helpers ────────────────────────────────────────────────────

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
