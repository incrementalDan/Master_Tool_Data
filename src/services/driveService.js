// ─── Google Drive — METADATA ONLY ───────────────────────────────────────────
// The Fusion tool library now lives in Autodesk APS (see apsService.js).
// Google Drive is used solely for tool_metadata.json — the extra fields
// Fusion 360 does not support.

let _accessToken = null;
let _userInfo = null;

export function setAccessToken(token) { _accessToken = token; }
export function setUserInfo(info) { _userInfo = info; }
export function getCurrentUser() { return _userInfo; }
export function signOut() { _accessToken = null; _userInfo = null; }
export function hasToken() { return !!_accessToken; }

const CACHED_FILE_ID_KEY = 'drive_metadata_file_id';

// Use localStorage-cached ID first (set after auto-create), then env var.
function getMetaFileId() {
  return localStorage.getItem(CACHED_FILE_ID_KEY) || import.meta.env.VITE_METADATA_FILE_ID || '';
}

async function driveGet(fileId) {
  if (!fileId) return null;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${_accessToken}` } }
  );
  if (res.status === 404) return null;
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
async function driveCreate(content) {
  const boundary = 'drive_meta_boundary_314159';
  const body = [
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    JSON.stringify({ name: 'tool_metadata.json', mimeType: 'application/json' }),
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    JSON.stringify(content),
    `--${boundary}--`,
  ].join('\r\n');

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
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
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${_accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(content),
    }
  );
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
