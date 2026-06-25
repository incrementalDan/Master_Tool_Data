import { useState, useCallback, useRef } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { HardDrive, Folder, Home, ChevronRight, Wrench, AlertTriangle, Check } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import {
  setAccessToken, fetchUserInfo,
  listFolders, listSharedDrives,
  findMetadataInFolder, connectToMetadataFile, createMetadataInFolder,
  checkSharedFilesInFolder, previewShopSettingsFromFolder, SHARED_FILES,
} from '../services/driveService.js';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email';

// ShopConnect — onboarding gate that appears after Autodesk login when no
// libraries are configured. Offers two paths:
//   A) Connect to existing shop — pick Drive folder with shop_settings.json,
//      auto-links libraries and metadata in one step.
//   B) Set up new shop — falls through to LibrarySetup wizard (unchanged).
//
// Props:
//   onConnectDone(needsWizard: bool) — called after a successful Drive connect.
//     needsWizard=true  → Drive connected but no libraries in shop_settings;
//                          App.jsx shows LibrarySetup next.
//     needsWizard=false → libraries loaded from shop_settings; go straight to
//                          full app (MetadataConnect is already satisfied too).
//   onSetupNew() — user chose "Set up a new shop"; App.jsx shows LibrarySetup.
export default function ShopConnect({ onConnectDone, onSetupNew }) {
  const { setGoogleUser, persistRegistry } = useApp();

  const [step, setStep] = useState('choose'); // 'choose' | 'google-auth' | 'picker' | 'connecting'
  const [error, setError] = useState('');

  // Folder picker state (same pattern as MetadataConnect)
  const [sharedDrives, setSharedDrives] = useState([]);
  const [stack, setStack] = useState([]);
  const [folders, setFolders] = useState([]);
  const [folderLoading, setFolderLoading] = useState(false);
  const [pickerRoot, setPickerRoot] = useState('myDrive');
  const [foundMeta, setFoundMeta] = useState(null);       // tool_metadata.json found?
  const [shopPreview, setShopPreview] = useState(null);   // { fileId, shopSettings } from shop_settings.json
  const [pendingUser, setPendingUser] = useState(null);

  const loadPickerRootRef = useRef(null);

  // ─── Google OAuth ────────────────────────────────────────────────────────────

  const handleGoogleSuccess = useCallback(async (tokenResponse) => {
    setError('');
    setStep('picker');
    try {
      setAccessToken(tokenResponse.access_token, tokenResponse.expires_in);
      const userInfo = await fetchUserInfo();
      setPendingUser(userInfo);
      loadPickerRootRef.current?.();
    } catch (err) {
      setError(err.message || 'Google sign-in failed.');
      setStep('google-auth');
    }
  }, []);

  const googleLogin = useGoogleLogin({
    scope: DRIVE_SCOPE,
    onSuccess: handleGoogleSuccess,
    onError: () => { setError('Google sign-in was cancelled or failed.'); },
  });

  // ─── Folder picker helpers ──────────────────────────────────────────────────

  // Load folder contents + check for metadata and shop_settings files in parallel.
  async function loadFolderContents(folderId) {
    setFolderLoading(true);
    setFoundMeta(null);
    setShopPreview(null);
    setError('');
    try {
      const checkId = folderId || null; // null = My Drive root for findMetadataInFolder
      const [children, existingMeta, shared] = await Promise.all([
        listFolders(folderId || 'root'),
        findMetadataInFolder(checkId).catch(() => null),
        checkSharedFilesInFolder(checkId).catch(() => null),
      ]);
      setFolders(children);
      setFoundMeta(existingMeta);
      // If shop_settings.json is present, fetch its content for the preview callout.
      if (shared?.['shop_settings.json']) {
        const preview = await previewShopSettingsFromFolder(checkId).catch(() => null);
        setShopPreview(preview);
      } else {
        setShopPreview(null);
      }
      return children;
    } catch (err) {
      setError(err.message);
      return [];
    } finally {
      setFolderLoading(false);
    }
  }

  async function loadPickerRoot() {
    setFolderLoading(true);
    setFoundMeta(null);
    setShopPreview(null);
    setError('');
    try {
      const [drives, rootFolders, existingMeta, shared] = await Promise.all([
        listSharedDrives(),
        listFolders('root'),
        findMetadataInFolder(null).catch(() => null),
        checkSharedFilesInFolder(null).catch(() => null),
      ]);
      setSharedDrives(drives);
      setFolders(rootFolders);
      setStack([]);
      setPickerRoot('myDrive');
      setFoundMeta(existingMeta);
      if (shared?.['shop_settings.json']) {
        const preview = await previewShopSettingsFromFolder(null).catch(() => null);
        setShopPreview(preview);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setFolderLoading(false);
    }
  }
  loadPickerRootRef.current = loadPickerRoot;

  function getCurrentFolderId() {
    if (stack.length) return stack[stack.length - 1].id;
    return pickerRoot === 'myDrive' ? null : pickerRoot;
  }

  async function openFolder(folder) {
    setStack(s => [...s, { id: folder.id, name: folder.name }]);
    await loadFolderContents(folder.id);
  }

  async function navigateToCrumb(index) {
    if (index < 0) {
      const rootId = pickerRoot === 'myDrive' ? null : pickerRoot;
      setStack([]);
      await loadFolderContents(rootId === null ? undefined : rootId);
    } else {
      const target = stack[index];
      setStack(s => s.slice(0, index + 1));
      await loadFolderContents(target.id);
    }
  }

  async function selectSharedDrive(drive) {
    setPickerRoot(drive.id);
    setStack([{ id: drive.id, name: drive.name }]);
    await loadFolderContents(drive.id);
  }

  // ─── Connect logic ──────────────────────────────────────────────────────────

  async function connectToShop() {
    setStep('connecting');
    setError('');
    try {
      const folderId = getCurrentFolderId();

      // 1. Connect tool_metadata.json (find existing or create).
      let metaFileId = foundMeta?.id;
      if (!metaFileId) {
        // Create a new metadata file in this folder.
        await createMetadataInFolder(folderId);
        // connectToMetadataFile is called inside createMetadataInFolder already.
      } else {
        connectToMetadataFile(metaFileId);
      }

      // 2. Cache the shop_settings.json file ID so loadTools can find it directly.
      if (shopPreview?.fileId) {
        localStorage.setItem(SHARED_FILES.shopSettings.cacheKey, shopPreview.fileId);
      }

      // 3. Mark Google Drive connected + store user.
      setGoogleUser(pendingUser);

      // 4. Commit library registry from the loaded shop_settings if libraries exist.
      const ss = shopPreview?.shopSettings;
      const hasLibraries = ss?.tool_libraries?.length > 0;
      if (hasLibraries) {
        persistRegistry(ss);
      }

      // 5. Advance routing — if no libraries were found, App.jsx shows LibrarySetup.
      onConnectDone(!hasLibraries);
    } catch (err) {
      setError(err.message || 'Connect failed — please try again.');
      setStep('picker');
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (step === 'choose') {
    return (
      <div className="login-screen">
        <div className="login-card" style={{ maxWidth: 520 }}>
          <div className="login-logo"><HardDrive size={26} strokeWidth={2.2} /></div>
          <h1 className="login-title">Connect Your Shop</h1>
          <p className="login-subtitle">
            Does your shop already have ToolDex set up on another device?
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
            <button
              className="step-card"
              style={{ textAlign: 'left', cursor: 'pointer', background: 'var(--surface-2)', border: '1.5px solid var(--border)', borderRadius: 10, padding: '16px 20px' }}
              onClick={() => setStep('google-auth')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div className="step-card-icon" style={{ flexShrink: 0 }}>
                  <HardDrive size={22} />
                </div>
                <div>
                  <div className="step-card-title">Connect to existing shop</div>
                  <div className="step-card-desc">
                    Pick the Google Drive folder where your shop settings live. Libraries and metadata will auto-link — no re-picking files.
                  </div>
                </div>
              </div>
            </button>
            <button
              className="step-card"
              style={{ textAlign: 'left', cursor: 'pointer', background: 'var(--surface-2)', border: '1.5px solid var(--border)', borderRadius: 10, padding: '16px 20px' }}
              onClick={onSetupNew}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div className="step-card-icon" style={{ flexShrink: 0 }}>
                  <Wrench size={22} />
                </div>
                <div>
                  <div className="step-card-title">Set up a new shop</div>
                  <div className="step-card-desc">
                    Walk through the setup wizard to link your Fusion libraries and Google Drive folder.
                  </div>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'google-auth') {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-logo"><HardDrive size={26} strokeWidth={2.2} /></div>
          <h1 className="login-title">Sign in with Google</h1>
          <p className="login-subtitle">
            Connect Google Drive to browse for your shop&rsquo;s settings folder.
          </p>
          {error && <div className="error-banner" style={{ marginBottom: 16 }}>{error}</div>}
          <button className="btn btn-primary btn-lg" onClick={() => googleLogin()}>
            Sign in with Google
          </button>
          <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => { setError(''); setStep('choose'); }}>
            ← Back
          </button>
        </div>
      </div>
    );
  }

  if (step === 'connecting') {
    return (
      <div className="loading-screen" style={{ minHeight: '100vh' }}>
        <div className="spinner" />
        <span>Connecting shop…</span>
      </div>
    );
  }

  // ─── 'picker' step ──────────────────────────────────────────────────────────

  const currentFolderId = getCurrentFolderId();

  return (
    <div className="login-screen" style={{ alignItems: 'flex-start', paddingTop: 40 }}>
      <div className="login-card" style={{ maxWidth: 560, width: '100%' }}>
        <div className="login-logo"><HardDrive size={26} strokeWidth={2.2} /></div>
        <h1 className="login-title">Find Your Shop Folder</h1>
        <p className="login-subtitle">
          Navigate to the folder that contains your <code>shop_settings.json</code>.
        </p>

        {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}

        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginBottom: 8, fontSize: 13, color: 'var(--text-2)' }}>
          <button
            className="btn btn-ghost"
            style={{ padding: '2px 6px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={() => navigateToCrumb(-1)}
          >
            <Home size={13} /> {pickerRoot === 'myDrive' ? 'My Drive' : (stack[0]?.name || 'Drive')}
          </button>
          {stack.slice(pickerRoot === 'myDrive' ? 0 : 1).map((crumb, i) => {
            const realIndex = pickerRoot === 'myDrive' ? i : i + 1;
            return (
              <span key={crumb.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <ChevronRight size={12} />
                <button
                  className="btn btn-ghost"
                  style={{ padding: '2px 6px', fontSize: 13 }}
                  onClick={() => navigateToCrumb(realIndex)}
                >
                  {crumb.name}
                </button>
              </span>
            );
          })}
        </div>

        {/* Shared drives */}
        {stack.length === 0 && sharedDrives.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Shared Drives</div>
            {sharedDrives.map(drive => (
              <button
                key={drive.id}
                onClick={() => selectSharedDrive(drive)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 10px', background: 'none', border: 'none', borderRadius: 6, cursor: 'pointer', color: 'var(--text)', fontSize: 13, textAlign: 'left' }}
                onMouseOver={e => e.currentTarget.style.background = 'var(--surface-3)'}
                onMouseOut={e => e.currentTarget.style.background = 'none'}
              >
                <HardDrive size={14} style={{ color: 'var(--text-2)', flexShrink: 0 }} />
                {drive.name}
              </button>
            ))}
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '8px 0 4px' }}>My Drive</div>
          </div>
        )}

        {/* Folder list */}
        <div style={{ minHeight: 120, maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12 }}>
          {folderLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 80, color: 'var(--text-2)', fontSize: 13 }}>
              <div className="spinner" style={{ width: 18, height: 18, marginRight: 8 }} /> Loading…
            </div>
          ) : folders.length === 0 ? (
            <div style={{ padding: '20px 16px', color: 'var(--text-3)', fontSize: 13, textAlign: 'center' }}>
              No subfolders here
            </div>
          ) : (
            folders.map(folder => (
              <button
                key={folder.id}
                onClick={() => openFolder(folder)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 12px', background: 'none', border: 'none', borderBottom: '1px solid var(--border-subtle, var(--border))', cursor: 'pointer', color: 'var(--text)', fontSize: 13, textAlign: 'left' }}
                onMouseOver={e => e.currentTarget.style.background = 'var(--surface-3)'}
                onMouseOut={e => e.currentTarget.style.background = 'none'}
              >
                <Folder size={14} style={{ color: 'var(--blue)', flexShrink: 0 }} />
                {folder.name}
              </button>
            ))
          )}
        </div>

        {/* Shop preview callout — shown when shop_settings.json was found */}
        {shopPreview && <ShopPreviewCallout shopPreview={shopPreview} foundMeta={foundMeta} onConnect={connectToShop} />}

        {/* Back */}
        <button className="btn btn-ghost" style={{ marginTop: 4 }} onClick={() => { setStep('choose'); setError(''); }}>
          ← Back
        </button>
      </div>
    </div>
  );
}

// Preview callout shown when shop_settings.json is found in the current folder.
function ShopPreviewCallout({ shopPreview, foundMeta, onConnect }) {
  const ss = shopPreview.shopSettings;
  const shopName = ss.shop_name || 'Unnamed Shop';
  const toolLibs = ss.tool_libraries || [];
  const holderLibs = ss.holder_libraries || [];
  const hasLibraries = toolLibs.length > 0;
  const hasMeta = !!foundMeta;

  return (
    <div style={{
      background: hasLibraries ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)',
      border: `1px solid ${hasLibraries ? 'rgba(34,197,94,0.35)' : 'rgba(245,158,11,0.35)'}`,
      borderRadius: 8, padding: '14px 16px', marginBottom: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        {hasLibraries
          ? <Check size={16} style={{ color: '#22c55e', flexShrink: 0 }} />
          : <AlertTriangle size={16} style={{ color: '#f59e0b', flexShrink: 0 }} />}
        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>
          {shopName}
        </span>
      </div>

      {hasLibraries ? (
        <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 10 }}>
          <div style={{ marginBottom: 4 }}>
            <strong>{toolLibs.length}</strong> tool {toolLibs.length === 1 ? 'library' : 'libraries'}
            {holderLibs.length > 0 && <span> · <strong>{holderLibs.length}</strong> holder {holderLibs.length === 1 ? 'library' : 'libraries'}</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            <StatusBadge ok={hasMeta} label="tool_metadata.json" />
            <StatusBadge ok={!!ss.materials} label="materials.json" />
            <StatusBadge ok={!!ss.vendor_registry} label="vendor_registry.json" />
          </div>
        </div>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '0 0 10px' }}>
          No Fusion libraries found in this shop&rsquo;s settings. Drive will be connected, then you&rsquo;ll be asked to link your libraries.
        </p>
      )}

      <button className="btn btn-primary" onClick={onConnect} style={{ width: '100%' }}>
        {hasLibraries ? 'Connect to this shop' : 'Connect Drive & continue setup'}
      </button>
    </div>
  );
}

function StatusBadge({ ok, label }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 11, padding: '2px 7px', borderRadius: 4,
      background: ok ? 'rgba(34,197,94,0.12)' : 'rgba(100,116,139,0.12)',
      color: ok ? '#22c55e' : 'var(--text-3)',
      border: `1px solid ${ok ? 'rgba(34,197,94,0.3)' : 'rgba(100,116,139,0.2)'}`,
    }}>
      {ok ? '✓' : '—'} {label}
    </span>
  );
}
