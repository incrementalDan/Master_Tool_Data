import { useEffect, useRef, useState } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { useGoogleLogin } from '@react-oauth/google';
import { FolderOpen, LogOut, Library, Settings, RefreshCw, AlertTriangle, Download, X, FlaskConical, Building2 } from 'lucide-react';
import { AppProvider, useApp } from './context/AppContext.jsx';
import BrandLogo from './components/BrandLogo.jsx';
import { setAccessToken, fetchUserInfo } from './services/driveService.js';
import { exportFullLibrary } from './utils/proShopExport.js';
import ToastStack from './components/Toast.jsx';
import LoginScreen from './components/LoginScreen.jsx';
import LibrarySetup from './components/LibrarySetup.jsx';
import MetadataConnect from './components/MetadataConnect.jsx';
import ShopConnect from './components/ShopConnect.jsx';
import LandingPage from './components/LandingPage.jsx';
import ToolDetail from './components/ToolDetail.jsx';
import AddToolFlow from './components/AddToolFlow.jsx';
import ImportFlow from './components/ImportFlow.jsx';
import MergeFlow from './components/MergeFlow/index.jsx';
import SettingsPage from './components/Settings.jsx';
import MaterialsEditor from './components/MaterialsEditor.jsx';
import VendorsEditor from './components/VendorsEditor.jsx';
import NormalizeModal from './components/NormalizeModal.jsx';
import { SetupGuideBanner, SetupCompleteModal } from './components/SetupGuide.jsx';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const APS_CLIENT_ID = import.meta.env.VITE_APS_CLIENT_ID || '';
const APS_CALLBACK_URL = import.meta.env.VITE_APS_CALLBACK_URL || '';

export default function App() {
  if (!APS_CLIENT_ID || !APS_CALLBACK_URL) {
    return <ConfigError />;
  }

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <AppProvider>
        <HashRouter>
          <AppShell />
        </HashRouter>
      </AppProvider>
    </GoogleOAuthProvider>
  );
}

function AppShell() {
  const {
    apsAuthenticated, libraryLocation, googleAuthenticated, metadataSkipped,
    processingAuth, user, loadTools, signOutAll,
    changingLibrary, cancelChangeLibrary,
    localMode, exitLocalMode, tools,
    demoMode, exitDemoMode,
    toasts, dismissToast,
  } = useApp();

  const [shopConnectChosen, setShopConnectChosen] = useState(false);

  const ready = !localMode && !demoMode && apsAuthenticated && libraryLocation && (googleAuthenticated || metadataSkipped);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (ready && !loadedRef.current) {
      loadedRef.current = true;
      loadTools();
    }
    if (!ready) loadedRef.current = false;
  }, [ready, loadTools]);

  // ─── Onboarding gates ──────────────────────────────────────────────────────
  let content;
  if (processingAuth) {
    content = (
      <div className="loading-screen" style={{ minHeight: '100vh' }}>
        <div className="spinner" />
        <span>Completing Autodesk sign-in…</span>
      </div>
    );
  } else if (demoMode) {
    // Full app shell on bundled sample data — read-only (see AppContext guards).
    content = (
      <div className="app-shell">
        <TopBar />
        <DemoBanner onExit={exitDemoMode} />
        <main className="page-content">
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/tool/new" element={<AddToolFlow />} />
            <Route path="/tool/:id" element={<ToolDetail />} />
            <Route path="/import" element={<ImportFlow />} />
            <Route path="/merge" element={<MergeFlow />} />
            <Route path="/merge/:id" element={<MergeFlow />} />
            <Route path="/materials" element={<MaterialsEditor />} />
            <Route path="/vendors" element={<VendorsEditor />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    );
  } else if (localMode) {
    content = (
      <div className="app-shell">
        <LocalModeTopBar tools={tools} onExit={exitLocalMode} />
        <main className="page-content">
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/tool/:id" element={<ToolDetail />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    );
  } else if (!apsAuthenticated) {
    content = <LoginScreen />;
  } else if (!libraryLocation && !changingLibrary && !shopConnectChosen) {
    content = (
      <ShopConnect
        onConnectDone={(needsWizard) => { if (needsWizard) setShopConnectChosen(true); }}
        onSetupNew={() => setShopConnectChosen(true)}
      />
    );
  } else if (!libraryLocation || changingLibrary) {
    content = <LibrarySetup canCancel={!!libraryLocation} onCancel={cancelChangeLibrary} />;
  } else if (!googleAuthenticated && !metadataSkipped) {
    content = <MetadataConnect />;
  } else {
    content = (
      <div className="app-shell">
        <TopBar />
        <NormalizeBanner />
        <CombineConflictBanner />
        <GoogleReconnectBanner />
        <MetadataFileBanner />
        <SetupGuideBanner />
        <SetupCompleteModal />
        <main className="page-content">
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/tool/new" element={<AddToolFlow />} />
            <Route path="/tool/:id" element={<ToolDetail />} />
            <Route path="/import" element={<ImportFlow />} />
            <Route path="/merge" element={<MergeFlow />} />
            <Route path="/merge/:id" element={<MergeFlow />} />
            <Route path="/materials" element={<MaterialsEditor />} />
            <Route path="/vendors" element={<VendorsEditor />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    );
  }

  return (
    <>
      {content}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}

// Shown across the top in demo mode (?demo=true): the app is running on bundled
// sample data with no Autodesk/Google connection, and nothing the user does is
// persisted anywhere. "Exit demo" drops the flag and returns to the login screen.
function DemoBanner({ onExit }) {
  return (
    <div role="status" style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: '10px 16px', background: 'rgba(124,58,237,0.12)',
      borderBottom: '1px solid rgba(124,58,237,0.4)', color: '#c4b5fd', fontSize: 13,
    }}>
      <FlaskConical size={16} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 220 }}>
        <strong>Demo Mode</strong> — changes are not saved. You're browsing bundled
        sample data, not a live Autodesk library.
      </span>
      <button className="btn btn-secondary btn-sm" onClick={onExit}>
        <LogOut size={14} /> Exit demo
      </button>
    </div>
  );
}

// Shown when the library contains tools that predate the multi-instance model
// (no tracking ID). Runs the one-time normalization: assigns tracking IDs, fans
// tools out into per-assembly instances, and renames presets to the convention.
function NormalizeBanner() {
  const { needsNormalize, normalizeCount } = useApp();
  const [showModal, setShowModal] = useState(false);
  if (!needsNormalize) return null;
  const n = normalizeCount || 0;
  return (
    <div className="normalize-banner" role="alert" style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: '10px 16px', background: 'rgba(234,179,8,0.12)',
      borderBottom: '1px solid rgba(234,179,8,0.4)', color: '#fde047', fontSize: 13,
    }}>
      <AlertTriangle size={16} />
      <span style={{ flex: 1, minWidth: 220 }}>
        <strong>{n} tool{n === 1 ? '' : 's'}</strong> {n === 1 ? 'hasn\'t' : 'haven\'t'} been migrated
        to the multi-instance model. Normalizing only affects un-migrated tools —
        already-migrated tools are left untouched.
      </span>
      <button className="btn btn-secondary btn-sm" onClick={() => setShowModal(true)}>Review &amp; normalize</button>
      {showModal && <NormalizeModal onClose={() => setShowModal(false)} />}
    </div>
  );
}

// Shown when any tool in the library has _combineConflicts — fields that were
// non-empty on both the ProShop placeholder and the real Fusion entry, with
// different values. Open the flagged tool to resolve via the existing reconcile flow.
function CombineConflictBanner() {
  const { tools } = useApp();
  const conflictTools = tools.filter(t => t._combineConflicts?.length);
  if (conflictTools.length === 0) return null;
  const n = conflictTools.length;
  return (
    <div role="alert" style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: '10px 16px', background: 'rgba(234,179,8,0.12)',
      borderBottom: '1px solid rgba(234,179,8,0.4)', color: '#fde047', fontSize: 13,
    }}>
      <AlertTriangle size={16} />
      <span style={{ flex: 1, minWidth: 220 }}>
        <strong>{n} tool{n === 1 ? '' : 's'}</strong> {n === 1 ? 'has' : 'have'} fields that differ
        between the ProShop placeholder and the Fusion entry — open {n === 1 ? 'it' : 'them'} to
        review and resolve the conflict before normalizing.
      </span>
    </div>
  );
}

// Shown when the linked tool_metadata.json file is gone — deleted (404) or sitting
// in the Drive trash. Without this, the app silently treats a missing file as
// "no metadata" (and can keep writing into a trashed file), quietly losing notes,
// tags, and photos. Points the user to Settings to relink or create a new file.
function MetadataFileBanner() {
  const { metadataFileWarning, dismissMetadataWarning } = useApp();
  const navigate = useNavigate();
  if (!metadataFileWarning) return null;
  const msg = metadataFileWarning === 'trashed'
    ? 'Your metadata file (notes, tags, photos) is in the Drive trash — changes are being saved into a trashed file and may be lost. Restore it in Drive, or relink/create a new one in Settings.'
    : "Your metadata file (notes, tags, photos) couldn't be found — it may have been deleted or moved out of reach. Relink it or create a new one in Settings.";
  return (
    <div role="alert" style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: '10px 16px', background: 'rgba(239,68,68,0.1)',
      borderBottom: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5', fontSize: 13,
    }}>
      <AlertTriangle size={15} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 220 }}>{msg}</span>
      <button className="btn btn-secondary btn-sm" onClick={() => navigate('/settings')}>Open Settings</button>
      <button className="icon-btn" onClick={dismissMetadataWarning} title="Dismiss"><X size={15} /></button>
    </div>
  );
}

// Shown when the Google token expires while the user is already in the app —
// makes the silent sign-out visible and provides a one-click reconnect.
function GoogleReconnectBanner() {
  const { googleAuthenticated, googleExpired, setGoogleUser, loadTools } = useApp();
  const [reconnecting, setReconnecting] = useState(false);

  const login = useGoogleLogin({
    scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
    onSuccess: async (tokenResponse) => {
      setReconnecting(true);
      try {
        setAccessToken(tokenResponse.access_token, tokenResponse.expires_in);
        localStorage.setItem('google_drive_connected', '1');
        const userInfo = await fetchUserInfo();
        setGoogleUser(userInfo);
        await loadTools();
      } catch {
        // stay showing banner — user can try again
      } finally {
        setReconnecting(false);
      }
    },
    onError: () => setReconnecting(false),
  });

  if (!googleAuthenticated || !googleExpired) return null;

  return (
    <div role="alert" style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: '10px 16px', background: 'rgba(239,68,68,0.1)',
      borderBottom: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5', fontSize: 13,
    }}>
      <AlertTriangle size={15} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 220 }}>
        Google Drive disconnected — metadata changes won't be saved until you reconnect.
      </span>
      <button
        className="btn btn-secondary btn-sm"
        onClick={() => { setReconnecting(true); login(); }}
        disabled={reconnecting}
      >
        {reconnecting ? <><span className="spinner" style={{ width: 13, height: 13, borderWidth: 2 }} /> Reconnecting…</> : 'Reconnect Drive'}
      </button>
    </div>
  );
}

function TopBar() {
  const location = useLocation();
  const { loadTools, isLoading } = useApp();
  const onLanding = location.pathname === '/';
  return (
    <header className="topbar">
      <a href="#/" className="topbar-brand" onClick={e => { if (onLanding) e.preventDefault(); }}>
        <BrandLogo markSize={30} />
      </a>
      <nav className="topbar-tabs">
        <a
          href="#/"
          className={`topbar-tab${onLanding ? ' active' : ''}`}
          onClick={e => { if (onLanding) e.preventDefault(); }}
        >
          <Library size={14} /> <span className="tab-wordmark">In<b>Dex</b></span>
        </a>
        <a
          href="#/materials"
          className={`topbar-tab${location.pathname === '/materials' ? ' active' : ''}`}
        >
          <FlaskConical size={14} /> <span className="tab-wordmark">Materials</span>
        </a>
        <a
          href="#/vendors"
          className={`topbar-tab${location.pathname === '/vendors' ? ' active' : ''}`}
        >
          <Building2 size={14} /> <span className="tab-wordmark">Vendors</span>
        </a>
        <a
          href="#/settings"
          className={`topbar-tab${location.pathname === '/settings' ? ' active' : ''}`}
        >
          <Settings size={14} /> <span className="tab-wordmark">Settings</span>
        </a>
      </nav>
      <div className="topbar-actions">
        <button
          className="icon-btn"
          onClick={() => loadTools()}
          disabled={isLoading}
          title="Re-download the library from Autodesk to pick up changes made in Fusion 360"
        >
          <RefreshCw size={15} style={isLoading ? { animation: 'spin 1s linear infinite' } : {}} />
        </button>
      </div>
    </header>
  );
}

// Simplified topbar shown in local (no-Autodesk) browse mode — search/view the
// uploaded library and ProShop-export it; "Exit local mode" returns to LoginScreen.
function LocalModeTopBar({ tools, onExit }) {
  const { notify } = useApp();

  const handleExport = () => {
    exportFullLibrary(tools);
    notify(`Exported ${tools.length} tool${tools.length === 1 ? '' : 's'} to ProShop CSV`, 'success');
  };

  return (
    <header className="topbar">
      <a href="#/" className="topbar-brand">
        <BrandLogo markSize={30} />
      </a>
      <span className="local-mode-badge" title="Browsing an uploaded library file — view-only, not connected to Autodesk">
        <FolderOpen size={13} /> Local mode (read-only)
      </span>
      <a href="#/" className="topbar-link">
        <Library size={14} /> <span className="tab-wordmark">In<b>Dex</b></span>
      </a>
      <span className="topbar-spacer" />
      <span className="topbar-user">{tools.length} tool{tools.length === 1 ? '' : 's'}</span>
      <button className="btn btn-ghost btn-sm" onClick={handleExport} disabled={tools.length === 0} title="Export the loaded library as a ProShop-compatible CSV">
        <Download size={14} /> ProShop CSV
      </button>
      <button className="btn btn-ghost btn-sm" onClick={onExit}>
        <LogOut size={14} /> Exit local mode
      </button>
    </header>
  );
}

function ConfigError() {
  return (
    <div style={{ minHeight: '100vh', background: '#1a1a1a', color: '#e0e0e0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: 480, padding: 32, background: '#242424', border: '1px solid #383838', borderRadius: 8, textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, color: '#4a8fff' }}><Settings size={36} /></div>
        <h2 style={{ marginBottom: 8, color: '#4a8fff' }}>Configuration Required</h2>
        <p style={{ color: '#999', marginBottom: 16, lineHeight: 1.6 }}>
          <code>VITE_APS_CLIENT_ID</code> and <code>VITE_APS_CALLBACK_URL</code> must be set. Create a
          <code> .env</code> from <code>.env.example</code>, fill in your Autodesk app values, then run
          <code> npm run deploy</code> again.
        </p>
        <p style={{ color: '#666', fontSize: 12 }}>See README.md → "Setting Up APS".</p>
      </div>
    </div>
  );
}
