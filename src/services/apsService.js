// ─── Autodesk Platform Services (APS) ────────────────────────────────────────
// Handles PKCE OAuth + Data Management read/write of the Fusion tool library.
// Tokens are held in memory only (a module-scoped variable) — never persisted.

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

// ─── The in-memory token ─────────────────────────────────────────────────────
// Module scope, deliberately NOT `window`. A global is readable by anything
// running on the page — a compromised dependency, an injected script, or anyone
// with the console open. Nothing outside this module ever read it, so scoping it
// costs nothing and makes the "memory only" rule literally true.
// ⚠️ Never reintroduce a window/global mirror of this for debugging convenience.
let _token = null;

const CLIENT_ID = () => import.meta.env.VITE_APS_CLIENT_ID;
const CALLBACK_URL = () => import.meta.env.VITE_APS_CALLBACK_URL;

// ─── Auth flow ───────────────────────────────────────────────────────────────
export async function signIn() {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  // `state` ties the callback to the sign-in THIS tab started. PKCE does not
  // cover this: it stops a stolen code being redeemed, not an attacker's code
  // being PLANTED — which would silently sign the user into the attacker's
  // Autodesk account and send this shop's library writes into their hub.
  // (This replaces a `nonce` that was generated, stored and deleted but never
  // sent or compared. `nonce` is an OpenID Connect field bound to an id_token;
  // we request no `openid` scope and parse no id_token, so it did nothing.)
  const state = generateCodeVerifier();
  sessionStorage.setItem('aps_code_verifier', verifier);
  sessionStorage.setItem('aps_state', state);

  const url = new URL(`${AUTH_BASE}/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID());
  url.searchParams.set('redirect_uri', CALLBACK_URL());
  // data:create is REQUIRED by POST .../versions and POST .../storage — the two
  // creation steps of saveToolLibrary. Confirmed against the Create Version
  // reference, which lists data:create as its only required scope. Read paths
  // only need data:read; without data:create a save can fail outright.
  url.searchParams.set('scope', 'data:read data:write data:create');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  window.location.href = url.toString();
}

export async function handleCallback(code, returnedState) {
  const verifier = sessionStorage.getItem('aps_code_verifier');
  const expectedState = sessionStorage.getItem('aps_state');
  // Clear BOTH before any early return — a verifier or state left behind is a
  // one-shot value sitting around for a later, unrelated callback to reuse.
  sessionStorage.removeItem('aps_code_verifier');
  sessionStorage.removeItem('aps_state');
  if (!verifier) throw new Error('Missing PKCE verifier — please sign in again');
  // Reject anything this tab did not start. Both halves matter: a missing
  // expectedState means no sign-in was begun here, and a mismatch means the
  // callback belongs to someone else's.
  if (!expectedState || returnedState !== expectedState) {
    throw new Error('Sign-in could not be verified — please sign in again');
  }

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
  _token = token;
  if (token.refresh_token) sessionStorage.setItem('aps_refresh_token', token.refresh_token);
  return token;
}

export async function refreshAccessToken() {
  const token = _token;
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
  _token = newToken;
  if (newToken.refresh_token) {
    sessionStorage.setItem('aps_refresh_token', newToken.refresh_token);
  }
  return newToken;
}

// Silently restore a session after a page refresh using the stored refresh token.
// Returns true if the session was restored, false if a full sign-in is needed.
export async function tryRestoreSession() {
  if (_token) return true;
  const storedRefresh = sessionStorage.getItem('aps_refresh_token');
  if (!storedRefresh) return false;
  _token = { refresh_token: storedRefresh, expires_at: 0 };
  try {
    await refreshAccessToken();
    return true;
  } catch {
    _token = null;
    sessionStorage.removeItem('aps_refresh_token');
    return false;
  }
}

export async function getValidToken() {
  let token = _token;
  if (!token) return null;
  if (Date.now() > token.expires_at - 60000) {
    token = await refreshAccessToken();
  }
  return token;
}

export function signOut() {
  _token = null;
  sessionStorage.removeItem('aps_refresh_token');
}

export function isAuthenticated() {
  return !!_token;
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

// ─── Which version is CURRENT? ───────────────────────────────────────────────
//
// Reading the wrong version is the most expensive mistake this module can make.
// The app would load an OLD library, treat it as current, and write it straight
// back as the newest version — reverting the whole shop's library, with a
// success message and nothing on screen to say otherwise.
//
// ⚠️ `versions.data[0]` is an ASSUMPTION, not a fact. The Get Item Versions
// reference lists everything that endpoint accepts — three `filter[…]` options
// plus `page[number]`/`page[limit]` — and there is **no sort or order parameter
// at all**. The page never states the array's ordering either, so there is
// nothing to rely on and no way to ask for newest-first.
//
// Get Item answers it directly instead: the item carries a `tip` relationship
// (Autodesk's word for the current version) and the tip's full version object
// comes back in the payload's `included` array. Same `data:read` scope, and it
// REPLACES the versions call rather than adding one.

/** The storage URN a version's bytes live at, or null. */
export function storageIdOfVersion(version) {
  return version?.relationships?.storage?.data?.id || null;
}

/**
 * Pick the tip (current) version object out of a GET item payload.
 *
 * ⚠️ Matched against the item's OWN tip id — never `included[0]`. The id is the
 * link; a position in an array is not (the same rule the rest of the app follows
 * for every other relationship). Returns null whenever the payload cannot answer,
 * so the caller can fall back rather than guess.
 */
export function tipVersionFromItem(itemPayload) {
  const tipId = itemPayload?.data?.relationships?.tip?.data?.id;
  if (!tipId) return null;
  const included = Array.isArray(itemPayload?.included) ? itemPayload.included : [];
  return included.find(e => e?.id === tipId && e?.type === 'versions') || null;
}

/**
 * Pick the highest-numbered version out of a GET versions payload.
 *
 * The fallback path — and correct on its own, which is the point: it sorts on
 * `attributes.versionNumber` instead of trusting the array order, so landing
 * here still cannot read an old version. A payload carrying no version numbers
 * at all degrades to the first entry (the previous behaviour) rather than
 * throwing, because a load that works is better than a load that dies on a
 * shape we have not seen.
 */
export function latestFromVersionList(versionsPayload) {
  const list = Array.isArray(versionsPayload?.data) ? versionsPayload.data : [];
  if (list.length === 0) return null;
  const numbered = list.filter(v => Number.isFinite(Number(v?.attributes?.versionNumber)));
  if (numbered.length === 0) return list[0];
  return numbered.reduce((a, b) =>
    Number(b.attributes.versionNumber) > Number(a.attributes.versionNumber) ? b : a
  );
}

/**
 * The current version of an item, by the documented route, with a correct
 * fallback. Silence on the fallback is deliberate: BOTH paths return the
 * current version, so taking the second one is not a degraded result — it is
 * the same answer by a longer road.
 */
async function fetchCurrentVersion(projectId, itemId) {
  try {
    const item = await apiFetch(`${DM_BASE}/data/v1/projects/${projectId}/items/${itemId}`);
    const tip = tipVersionFromItem(item);
    if (storageIdOfVersion(tip)) return tip;
  } catch {
    // Fall through. If this failed for a real reason (auth, network, a missing
    // item) the versions call below fails the same way and reports it.
  }
  const versions = await apiFetch(
    `${DM_BASE}/data/v1/projects/${projectId}/items/${itemId}/versions`
  );
  const latest = latestFromVersionList(versions);
  if (!latest) throw new Error('No versions found for the tool library file');
  return latest;
}

// ─── Load tool library JSON (current version) ───────────────────────────────
export async function loadToolLibrary(projectId, itemId) {
  const version = await fetchCurrentVersion(projectId, itemId);

  const storageId = storageIdOfVersion(version);
  if (!storageId) throw new Error('Tool library version has no storage reference');

  const { bucketKey, objectKey } = parseObjectUrn(storageId);

  // Current Autodesk method: request a signed S3 download URL.
  // ⚠️ public-resource-fallback=true is what keeps this to ONE url. Without it, an
  // object still assembling from chunks comes back as `status: 'chunked'` with
  // `urls` — a MAP keyed by byte range, NOT an array — so `urls[0]` is undefined
  // and there is nothing single to download. With the flag, OSS returns one signed
  // URL (`status: 'fallback'`) while assembly is still in progress. Confirmed
  // against the Generate Signed S3 Download URL reference.
  const signed = await apiFetch(
    `${DM_BASE}/oss/v2/buckets/${bucketKey}/objects/${encodeURIComponent(objectKey)}/signeds3download?public-resource-fallback=true`
  );
  const downloadUrl = signed.url;
  if (!downloadUrl) {
    throw new Error(`Could not obtain signed download URL (status: ${signed.status || 'unknown'})`);
  }

  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`Failed to download tool library (${res.status})`);
  return res.json();
}

// ─── The global write lock ───────────────────────────────────────────────────
//
// The Autodesk-side twin of driveService's lock. Set from outside (App decides);
// this module only enforces it. Covers the dev-build-pointed-at-live-data case —
// a Fusion library write is the single most expensive thing to get wrong here,
// because it replaces the whole file for the whole shop.
let _writeLock = null;

export function setWriteLock(reason) { _writeLock = reason || null; }

function assertWritable() {
  if (_writeLock) throw Object.assign(new Error(_writeLock), { code: 'WRITES_LOCKED' });
}

// ─── Save tool library JSON as a new version ─────────────────────────────────
export async function saveToolLibrary(projectId, folderId, itemId, fileName, toolsJson) {
  assertWritable();
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

// ─── Load holder library JSON (same format as tool library, holder entries only) ─
export async function loadHolderLibrary(projectId, itemId) {
  const json = await loadToolLibrary(projectId, itemId);
  const data = Array.isArray(json?.data) ? json.data : (Array.isArray(json) ? json : []);
  return data.filter(e => e.type === 'holder');
}

// ─── Holder library, RAW (the whole file, wrapper included) ──────────────────
// The write path needs the wrapper, not just the holder entries: the file is
// { data: [...], version: N } and the version must survive a save untouched —
// same rule as the tool library.
export async function loadHolderLibraryRaw(projectId, itemId) {
  return loadToolLibrary(projectId, itemId);
}

// Save the holder library. Identical mechanics to the tool library (same file
// shape, same versioned-item write), so it reuses that path rather than
// duplicating five APS steps.
export async function saveHolderLibrary(projectId, folderId, itemId, fileName, json) {
  return saveToolLibrary(projectId, folderId, itemId, fileName, json);
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
