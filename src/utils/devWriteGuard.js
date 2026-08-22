// Dev-build write guard.
//
// THE PROBLEM: `npm run dev` reads the same VITE_METADATA_FILE_ID and the same
// Autodesk library as the deployed site, so a local dev session writes to the
// shop's real data. That is not a hypothetical — the app writes to Drive with
// NO user action at all: the load-time registry seed and the metadata backfill
// both fire on open. Every dev session was already a live write.
//
// THE RULE: a dev build is READ-ONLY against a live dataset until a person says
// otherwise, out loud, this session.
//
// ⚠️ Locked by DEFAULT, not merely badged. A badge relies on someone noticing
// before an automatic write has already happened, and the two writes above
// happen before anyone has looked at the screen. Refusing the write is the only
// thing that is actually in time.
//
// ⚠️ The unlock lives in sessionStorage, so it dies with the tab. Consent should
// be cheap to give and impossible to forget you gave — a localStorage unlock set
// once in March silently protects nothing in June, which is worse than no guard
// at all because it still LOOKS guarded.

const UNLOCK_KEY = 'dev_write_unlock';

// The build mode is injected rather than read here so this module stays pure and
// testable, and so the policy decision lives in exactly one place (App).
export function isDevBuild(env = import.meta.env) {
  return !!env?.DEV;
}

export function isDevUnlocked() {
  try { return sessionStorage.getItem(UNLOCK_KEY) === 'yes'; }
  catch { return false; } // private mode / storage disabled → stay locked
}

export function unlockDevWrites() {
  try { sessionStorage.setItem(UNLOCK_KEY, 'yes'); } catch { /* stays locked */ }
}

export function lockDevWrites() {
  try { sessionStorage.removeItem(UNLOCK_KEY); } catch { /* already locked */ }
}

export const DEV_LOCK_REASON =
  'This is a development build and writing to the live shop data is turned off. '
  + 'Unlock it in the banner if you meant to.';

// The reason string to hand to the services' setWriteLock, or null for "allow".
// One function, so the Drive and Autodesk locks can never disagree about policy.
export function writeLockReason({ dev = isDevBuild(), unlocked = isDevUnlocked() } = {}) {
  if (!dev) return null;          // a deployed build always writes
  if (unlocked) return null;      // a person explicitly took the safety off
  return DEV_LOCK_REASON;
}

// Short, human label for the dataset currently connected, so "which data am I
// about to touch" is answerable at a glance instead of by reading a file id.
// The id tail is included because two shops can share a name but never an id.
export function datasetLabel(shopName, metadataFileId) {
  const name = (shopName || '').trim() || 'Unnamed shop';
  const tail = (metadataFileId || '').slice(-4);
  return tail ? `${name} · …${tail}` : name;
}

// The localStorage key holding the connected metadata file id. Re-exported here
// so the banner can label the dataset without reaching into driveService's
// internals or, worse, repeating the string.
export const METADATA_FILE_ID_KEY = 'drive_metadata_file_id';
