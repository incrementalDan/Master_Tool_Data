import { useState, useEffect } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { HardDrive, Folder, Home, ChevronRight } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import {
  setAccessToken, fetchUserInfo,
  checkMetadataFile, listFolders, listSharedDrives, createMetadataInFolder,
} from '../services/driveService.js';

// Steps: 'connect' → (auth) → 'checking' → 'picker' (if no file) → 'creating' → done
//                                         → done (if file exists)
export default function MetadataConnect() {
  const { setGoogleUser, skipMetadata, signOutAll } = useApp();
  const [view, setView] = useState('connect'); // 'connect' | 'checking' | 'picker' | 'creating'
  const [error, setError] = useState('');

  // Folder picker state
  const [sharedDrives, setSharedDrives] = useState([]);
  const [stack, setStack] = useState([]); // [{ id, name }] — breadcrumb
  const [folders, setFolders] = useState([]);
  const [folderLoading, setFolderLoading] = useState(false);
  const [pickerRoot, setPickerRoot] = useState('myDrive'); // 'myDrive' | drive-id

  // Stored user info so we can call setGoogleUser after file is created
  const [pendingUser, setPendingUser] = useState(null);

  const login = useGoogleLogin({
    scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
    onSuccess: async (tokenResponse) => {
      setError('');
      setView('checking');
      try {
        setAccessToken(tokenResponse.access_token);
        const userInfo = await fetchUserInfo();
        const fileExists = await checkMetadataFile();
        if (fileExists) {
          setGoogleUser(userInfo);
        } else {
          setPendingUser(userInfo);
          setView('picker');
          loadPickerRoot();
        }
      } catch (err) {
        setError(err.message || 'Google sign-in failed.');
        setView('connect');
      }
    },
    onError: () => { setError('Google sign-in was cancelled or failed.'); setView('connect'); },
  });

  async function loadPickerRoot() {
    setFolderLoading(true);
    setError('');
    try {
      const [drives, rootFolders] = await Promise.all([listSharedDrives(), listFolders('root')]);
      setSharedDrives(drives);
      setFolders(rootFolders);
      setStack([]);
      setPickerRoot('myDrive');
    } catch (err) {
      setError(err.message);
    } finally {
      setFolderLoading(false);
    }
  }

  async function openFolder(folder) {
    setFolderLoading(true);
    setError('');
    try {
      const children = await listFolders(folder.id);
      setStack(s => [...s, { id: folder.id, name: folder.name }]);
      setFolders(children);
    } catch (err) {
      setError(err.message);
    } finally {
      setFolderLoading(false);
    }
  }

  async function navigateToCrumb(index) {
    setFolderLoading(true);
    setError('');
    try {
      if (index < 0) {
        // Back to the root of whichever drive is active
        const parentId = pickerRoot === 'myDrive' ? 'root' : pickerRoot;
        const children = await listFolders(parentId);
        setStack([]);
        setFolders(children);
      } else {
        const target = stack[index];
        const children = await listFolders(target.id);
        setStack(s => s.slice(0, index + 1));
        setFolders(children);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setFolderLoading(false);
    }
  }

  async function selectSharedDrive(drive) {
    setFolderLoading(true);
    setError('');
    setPickerRoot(drive.id);
    try {
      const children = await listFolders(drive.id);
      setStack([{ id: drive.id, name: drive.name }]);
      setFolders(children);
    } catch (err) {
      setError(err.message);
    } finally {
      setFolderLoading(false);
    }
  }

  async function createHere() {
    const folderId = stack.length ? stack[stack.length - 1].id
      : pickerRoot === 'myDrive' ? null : pickerRoot;
    setView('creating');
    setError('');
    try {
      await createMetadataInFolder(folderId);
      setGoogleUser(pendingUser);
    } catch (err) {
      setError(err.message);
      setView('picker');
    }
  }

  // ─── Views ────────────────────────────────────────────────────────────────

  if (view === 'connect' || view === 'checking') {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-logo"><HardDrive size={26} strokeWidth={2.2} /></div>
          <h1 className="login-title">Connect Google Drive</h1>
          <p className="login-subtitle">
            Extra fields Fusion doesn't support (tags, notes, ProShop IDs, material suitability) are stored in
            <code> tool_metadata.json</code> on Google Drive. Connect now to load and save them.
          </p>
          {error && <div className="error-banner" style={{ marginBottom: 16 }}>{error}</div>}
          <button
            className="btn btn-primary btn-lg"
            onClick={() => login()}
            disabled={view === 'checking'}
            style={{ width: '100%', justifyContent: 'center', marginBottom: 10 }}
          >
            {view === 'checking' ? (
              <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Checking…</>
            ) : 'Connect Google Drive'}
          </button>
          <button className="btn btn-ghost" onClick={skipMetadata} style={{ width: '100%', justifyContent: 'center' }}>
            Skip — use Fusion data only
          </button>
          <p className="text-sub text-sm" style={{ marginTop: 20 }}>
            <button className="btn btn-ghost btn-sm" onClick={signOutAll}>← Sign out of Autodesk</button>
          </p>
        </div>
      </div>
    );
  }

  if (view === 'creating') {
    return (
      <div className="login-screen">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <span className="spinner" style={{ margin: '0 auto 16px' }} />
          <p>Creating tool_metadata.json…</p>
        </div>
      </div>
    );
  }

  // ─── Folder picker ────────────────────────────────────────────────────────
  const currentFolderName = stack.length ? stack[stack.length - 1].name
    : pickerRoot === 'myDrive' ? 'My Drive' : (sharedDrives.find(d => d.id === pickerRoot)?.name || 'Drive');

  return (
    <div className="page-content" style={{ maxWidth: 680 }}>
      <div className="flex items-center gap-8 mb-8">
        <HardDrive size={18} style={{ color: 'var(--blue)' }} />
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Choose a folder for tool_metadata.json</h2>
      </div>
      <p className="text-sub text-sm mb-16">
        No existing metadata file was found. Pick any shared folder your teammates already have access to —
        the file will be created there and reused on every sign-in.
      </p>

      {error && <div className="error-banner mb-12">{error}</div>}

      {/* Shared drives */}
      {sharedDrives.length > 0 && (
        <div className="mb-12">
          <div className="section-header mb-8">Shared Drives</div>
          <div className="card" style={{ padding: 0 }}>
            {sharedDrives.map(d => (
              <div
                key={d.id}
                className="flex items-center gap-8"
                style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                onClick={() => selectSharedDrive(d)}
              >
                <Folder size={15} style={{ color: 'var(--blue)', flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{d.name}</span>
                <ChevronRight size={13} className="text-sub" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Folder browser */}
      <div className="section-header mb-8">
        {pickerRoot === 'myDrive' ? 'My Drive' : (sharedDrives.find(d => d.id === pickerRoot)?.name || 'Shared Drive')}
      </div>
      <div className="card" style={{ padding: 0 }}>
        {/* Breadcrumb */}
        <div className="flex items-center gap-6 flex-wrap" style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => navigateToCrumb(-1)}>
            <Home size={13} /> {pickerRoot === 'myDrive' ? 'My Drive' : sharedDrives.find(d => d.id === pickerRoot)?.name || 'Drive'}
          </button>
          {stack.slice(pickerRoot === 'myDrive' ? 0 : 1).map((c, i) => (
            <span key={c.id} className="flex items-center gap-6">
              <ChevronRight size={13} className="text-sub" />
              <button className="btn btn-ghost btn-sm" onClick={() => navigateToCrumb(pickerRoot === 'myDrive' ? i : i + 1)}>{c.name}</button>
            </span>
          ))}
        </div>

        {folderLoading ? (
          <div className="flex items-center justify-center" style={{ padding: 24 }}>
            <span className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
          </div>
        ) : (
          <>
            {folders.length === 0 && (
              <div className="text-sub text-sm" style={{ padding: '12px 14px' }}>No subfolders here.</div>
            )}
            {folders.map(f => (
              <div
                key={f.id}
                className="flex items-center gap-8"
                style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                onClick={() => openFolder(f)}
              >
                <Folder size={15} style={{ color: 'var(--blue)', flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{f.name}</span>
                <ChevronRight size={13} className="text-sub" />
              </div>
            ))}
          </>
        )}

        {/* Create here footer */}
        <div className="flex items-center gap-10" style={{ padding: '10px 12px', background: 'var(--surface)' }}>
          <span className="text-sub text-sm" style={{ flex: 1 }}>Create in: <strong>{currentFolderName}</strong></span>
          <button className="btn btn-primary btn-sm" onClick={createHere} disabled={folderLoading}>
            Create tool_metadata.json here
          </button>
        </div>
      </div>

      <p className="text-sub text-sm" style={{ marginTop: 16 }}>
        <button className="btn btn-ghost btn-sm" onClick={skipMetadata}>Skip — use Fusion data only</button>
        {' · '}
        <button className="btn btn-ghost btn-sm" onClick={signOutAll}>Sign out of Autodesk</button>
      </p>
    </div>
  );
}
