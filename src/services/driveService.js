import { fusionToolToInternal, mergeFusionAndMetadata, splitToFusionAndMetadata, generateId } from '../schema/toolSchema.js';

let _accessToken = null;
let _userInfo = null;

export function setAccessToken(token) { _accessToken = token; }
export function setUserInfo(info) { _userInfo = info; }
export function getCurrentUser() { return _userInfo; }
export function signOut() { _accessToken = null; _userInfo = null; }
export function hasToken() { return !!_accessToken; }

const FUSION_FILE_ID = () => import.meta.env.VITE_FUSION_LIBRARY_FILE_ID;
const META_FILE_ID = () => import.meta.env.VITE_METADATA_FILE_ID;

async function driveGet(fileId) {
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
  catch { throw new Error('Drive file is not valid JSON'); }
}

async function driveUpdate(fileId, content) {
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

// Read both Drive files, merge into unified tool array
export async function loadLibrary() {
  const [fusionData, metaData] = await Promise.all([
    driveGet(FUSION_FILE_ID()),
    driveGet(META_FILE_ID()),
  ]);

  const fusionList = (fusionData && Array.isArray(fusionData.data))
    ? fusionData.data
    : (Array.isArray(fusionData) ? fusionData : []);

  const metaList = Array.isArray(metaData) ? metaData : [];
  const metaById = new Map(metaList.map(m => [m.id, m]));

  const tools = fusionList.map(fTool => {
    const internal = fusionToolToInternal(fTool);
    const meta = metaById.get(internal.id);
    return mergeFusionAndMetadata(internal, meta || null);
  });

  return tools;
}

// Re-read, upsert a single tool, write both files back
export async function mergeTool(tool) {
  const [fusionData, metaData] = await Promise.all([
    driveGet(FUSION_FILE_ID()),
    driveGet(META_FILE_ID()),
  ]);

  const fusionList = (fusionData && Array.isArray(fusionData.data))
    ? fusionData.data
    : (Array.isArray(fusionData) ? fusionData : []);

  const metaList = Array.isArray(metaData) ? metaData : [];

  const { fusionTool, metadataTool } = splitToFusionAndMetadata(tool);

  const fusionIdx = fusionList.findIndex(t => t.guid === tool.id);
  if (fusionIdx >= 0) fusionList[fusionIdx] = fusionTool;
  else fusionList.push(fusionTool);

  const metaIdx = metaList.findIndex(m => m.id === tool.id);
  if (metaIdx >= 0) metaList[metaIdx] = metadataTool;
  else metaList.push(metadataTool);

  await Promise.all([
    driveUpdate(FUSION_FILE_ID(), { data: fusionList }),
    driveUpdate(META_FILE_ID(), metaList),
  ]);
}

// Re-read, remove tool by id, write both files back
export async function deleteToolFromDrive(id) {
  const [fusionData, metaData] = await Promise.all([
    driveGet(FUSION_FILE_ID()),
    driveGet(META_FILE_ID()),
  ]);

  const fusionList = ((fusionData?.data) || []).filter(t => t.guid !== id);
  const metaList = (Array.isArray(metaData) ? metaData : []).filter(m => m.id !== id);

  await Promise.all([
    driveUpdate(FUSION_FILE_ID(), { data: fusionList }),
    driveUpdate(META_FILE_ID(), metaList),
  ]);
}

// Write the entire library in one shot (used by import flow)
export async function saveFullLibrary(tools) {
  const fusionList = [];
  const metaList = [];

  for (const tool of tools) {
    const { fusionTool, metadataTool } = splitToFusionAndMetadata(tool);
    fusionList.push(fusionTool);
    metaList.push(metadataTool);
  }

  await Promise.all([
    driveUpdate(FUSION_FILE_ID(), { data: fusionList }),
    driveUpdate(META_FILE_ID(), metaList),
  ]);
}
