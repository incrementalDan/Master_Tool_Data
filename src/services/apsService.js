// ─── Autodesk Platform Services (APS) ────────────────────────────────────────
// Handles PKCE OAuth + Data Management read/write of the Fusion tool library.
// Tokens are held in memory only (window._apsToken) — never persisted.

const AUTH_BASE = 'https://developer.api.autodesk.com/authentication/v2';
const DM_BASE = 'https://developer.api.autodesk.com';

// ─── PKCE helpers ────────────────────────────────────────────────────────────
export function generateCodeVerifier() {
  const array = new Uint8Array(48);
  crypto.getRandomValues(array);
  return base64Url(array);
}

export async function generateCodeChallenge(verifier) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(hash));
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

const CLIENT_ID = () => import.meta.env.VITE_APS_CLIENT_ID;
const CALLBACK_URL = () => import.meta.env.VITE_APS_CALLBACK_URL;

// ─── Auth flow ───────────────────────────────────────────────────────────────
export async function signIn() {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const nonce = generateCodeVerifier();
  sessionStorage.setItem('aps_code_verifier', verifier);
  sessionStorage.setItem('aps_nonce', nonce);

  const url = new URL(`${AUTH_BASE}/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID());
  url.searchParams.set('redirect_uri', CALLBACK_URL());
  url.searchParams.set('scope', 'data:read data:write');
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  window.location.href = url.toString();
}

export async function handleCallback(code) {
  const verifier = sessionStorage.getItem('aps_code_verifier');
  sessionStorage.removeItem('aps_code_verifier');
  sessionStorage.removeItem('aps_nonce');
  if (!verifier) throw new Error('Missing PKCE verifier — please sign in again');

  const res = await fetch(`${AUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: CLIENT_ID(),
      redirect_uri: CALLBACK_URL(),
      code_verifier: verifier,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Token exchange failed (${res.status}): ${txt.slice(0, 200)}`);
  }
  const token = await res.json();
  token.expires_at = Date.now() + token.expires_in * 1000;
  window._apsToken = token;
  if (token.refresh_token) sessionStorage.setItem('aps_refresh_token', token.refresh_token);
  return token;
}

export async function refreshAccessToken() {
  const token = window._apsToken;
  if (!token?.refresh_token) throw new Error('No refresh token — please sign in again');
  const res = await fetch(`${AUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
      client_id: CLIENT_ID(),
    }),
  });
  if (!res.ok) throw new Error('Token refresh failed — please sign in again');
  const newToken = await res.json();
  newToken.expires_at = Date.now() + newToken.expires_in * 1000;
  window._apsToken = newToken;
  if (newToken.refresh_token) {
    sessionStorage.setItem('aps_refresh_token', newToken.refresh_token);
  }
  return newToken;
}

// Silently restore a session after a page refresh using the stored refresh token.
// Returns true if the session was restored, false if a full sign-in is needed.
export async function tryRestoreSession() {
  if (window._apsToken) return true;
  const storedRefresh = sessionStorage.getItem('aps_refresh_token');
  if (!storedRefresh) return false;
  window._apsToken = { refresh_token: storedRefresh, expires_at: 0 };
  try {
    await refreshAccessToken();
    return true;
  } catch {
    window._apsToken = null;
    sessionStorage.removeItem('aps_refresh_token');
    return false;
  }
}

export async function getValidToken() {
  let token = window._apsToken;
  if (!token) return null;
  if (Date.now() > token.expires_at - 60000) {
    token = await refreshAccessToken();
  }
  return token;
}

export function signOut() {
  window._apsToken = null;
  sessionStorage.removeItem('aps_refresh_token');
}

export function isAuthenticated() {
  return !!window._apsToken;
}

// ─── Data Management fetch helper ────────────────────────────────────────────
async function apiFetch(url, options = {}) {
  const token = await getValidToken();
  if (!token) throw new Error('Not authenticated with Autodesk');
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`APS API error ${res.status} (${url.split('?')[0]}): ${txt.slice(0, 200)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ─── Hub / project / folder navigation ───────────────────────────────────────
export async function getHubs() {
  const data = await apiFetch(`${DM_BASE}/project/v1/hubs`);
  return data.data;
}

export async function getProjects(hubId) {
  const data = await apiFetch(`${DM_BASE}/project/v1/hubs/${hubId}/projects`);
  return data.data;
}

export async function getTopFolders(hubId, projectId) {
  const data = await apiFetch(`${DM_BASE}/project/v1/hubs/${hubId}/projects/${projectId}/topFolders`);
  return data.data;
}

export async function getFolderContents(projectId, folderId) {
  const data = await apiFetch(`${DM_BASE}/data/v1/projects/${projectId}/folders/${folderId}/contents`);
  return data.data;
}

// ─── Storage URN helper ──────────────────────────────────────────────────────
// urn:adsk.objects:os.object:bucketKey/objectKey
function parseObjectUrn(urn) {
  const m = urn.match(/^urn:adsk\.objects:os\.object:([^/]+)\/(.+)$/);
  if (!m) throw new Error(`Unrecognized storage URN: ${urn}`);
  return { bucketKey: m[1], objectKey: m[2] };
}

// ─── Load tool library JSON (latest version) ────────────────────────────────
export async function loadToolLibrary(projectId, itemId) {
  const versions = await apiFetch(
    `${DM_BASE}/data/v1/projects/${projectId}/items/${itemId}/versions`
  );
  const version = versions.data?.[0];
  if (!version) throw new Error('No versions found for the tool library file');

  const storageId = version.relationships?.storage?.data?.id;
  if (!storageId) throw new Error('Tool library version has no storage reference');

  const { bucketKey, objectKey } = parseObjectUrn(storageId);

  // Current Autodesk method: request a signed S3 download URL
  const signed = await apiFetch(
    `${DM_BASE}/oss/v2/buckets/${bucketKey}/objects/${encodeURIComponent(objectKey)}/signeds3download`
  );
  const downloadUrl = signed.url || signed.urls?.[0];
  if (!downloadUrl) throw new Error('Could not obtain signed download URL');

  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`Failed to download tool library (${res.status})`);
  return res.json();
}

// ─── Save tool library JSON as a new version ─────────────────────────────────
export async function saveToolLibrary(projectId, folderId, itemId, fileName, toolsJson) {
  const jsonString = JSON.stringify(toolsJson, null, 2);

  // Step 1: request a storage location for the new file content
  const storageRes = await apiFetch(`${DM_BASE}/data/v1/projects/${projectId}/storage`, {
    method: 'POST',
    body: JSON.stringify({
      jsonapi: { version: '1.0' },
      data: {
        type: 'objects',
        attributes: { name: fileName },
        relationships: {
          target: { data: { type: 'folders', id: folderId } },
        },
      },
    }),
  });
  const objectId = storageRes.data.id;
  const { bucketKey, objectKey } = parseObjectUrn(objectId);

  // Step 2: get a signed S3 upload URL
  const signedUp = await apiFetch(
    `${DM_BASE}/oss/v2/buckets/${bucketKey}/objects/${encodeURIComponent(objectKey)}/signeds3upload`
  );
  const uploadUrl = signedUp.urls?.[0] || signedUp.url;
  const uploadKey = signedUp.uploadKey;
  if (!uploadUrl) throw new Error('Could not obtain signed upload URL');

  // Step 3: upload the bytes directly to S3 (no APS auth header on the presigned URL)
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: new Blob([jsonString], { type: 'application/json' }),
  });
  if (!putRes.ok) throw new Error(`Upload to storage failed (${putRes.status})`);

  // Step 4: finalize the upload
  await apiFetch(
    `${DM_BASE}/oss/v2/buckets/${bucketKey}/objects/${encodeURIComponent(objectKey)}/signeds3upload`,
    { method: 'POST', body: JSON.stringify({ uploadKey }) }
  );

  // Step 5: create a new item version pointing at the uploaded object
  await apiFetch(`${DM_BASE}/data/v1/projects/${projectId}/versions`, {
    method: 'POST',
    body: JSON.stringify({
      jsonapi: { version: '1.0' },
      data: {
        type: 'versions',
        attributes: {
          name: fileName,
          extension: { type: 'versions:autodesk.core:File', version: '1.0' },
        },
        relationships: {
          item: { data: { type: 'items', id: itemId } },
          storage: { data: { type: 'objects', id: objectId } },
        },
      },
    }),
  });
}

// ─── Optional: current user profile (for display) ────────────────────────────
export async function getUserProfile() {
  try {
    const data = await apiFetch('https://api.userprofile.autodesk.com/userinfo');
    return data;
  } catch {
    return null;
  }
}
