import { useEffect, useRef, useState } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { useGoogleLogin } from '@react-oauth/google';
import { Wrench, FolderOpen, LogOut, Library, Upload, Settings, GitMerge, RefreshCw, AlertTriangle, Download } from 'lucide-react';
import { AppProvider, useApp } from './context/AppContext.jsx';
import { setAccessToken, fetchUserInfo } from './services/driveService.js';
import { exportFullLibrary } from './utils/proShopExport.js';
import ToastStack from './components/Toast.jsx';
import LoginScreen from './components/LoginScreen.jsx';
import LibrarySetup from './components/LibrarySetup.jsx';
import MetadataConnect from './components/MetadataConnect.jsx';
import LandingPage from './components/LandingPage.jsx';
import ToolDetail from './components/ToolDetail.jsx';
import AddToolFlow from './components/AddToolFlow.jsx';
import ImportFlow from './components/ImportFlow.jsx';
import MergeFlow from './components/MergeFlow/index.jsx';
import SettingsPage from './components/Settings.jsx';
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
    processingAuth, user, loadTools, signOutAll, clearLibraryLocation,
    localMode, exitLocalMode, tools,
    toasts, dismissToast,
  } = useApp();

  const ready = !localMode && apsAuthenticated && libraryLocation && (googleAuthenticated || metadataSkipped);
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
  } else if (!libraryLocation) {
    content = <LibrarySetup />;
  } else if (!googleAuthenticated && !metadataSkipped) {
    content = <MetadataConnect />;
  } else {
    content = (
      <div className="app-shell">
        <TopBar user={user} googleAuthenticated={googleAuthenticated} onSignOut={signOutAll} onChangeLibrary={clearLibraryLocation} />
        <NormalizeBanner />
        <GoogleReconnectBanner />
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

// Shown when the library contains tools that predate the multi-instance model
// (no tracking ID). Runs the one-time normalization: assigns tracking IDs, fans
// tools out into per-assembly instances, and renames presets to the convention.
function NormalizeBanner() {
  const { needsNormalize } = useApp();
  const [showModal, setShowModal] = useState(false);
  if (!needsNormalize) return null;
  return (
    <div className="normalize-banner" role="alert" style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: '10px 16px', background: 'rgba(234,179,8,0.12)',
      borderBottom: '1px solid rgba(234,179,8,0.4)', color: '#fde047', fontSize: 13,
    }}>
      <AlertTriangle size={16} />
      <span style={{ flex: 1, minWidth: 220 }}>
        Some tools haven't been migrated to the multi-instance model yet. Normalizing
        assigns tracking IDs, splits each tool into per-assembly instances, and renames
        presets to the standard convention.
      </span>
      <button className="btn btn-secondary btn-sm" onClick={() => setShowModal(true)}>Review &amp; normalize</button>
      {showModal && <NormalizeModal onClose={() => setShowModal(false)} />}
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

function TopBar({ user, googleAuthenticated, onSignOut, onChangeLibrary }) {
  const location = useLocation();
  const { loadTools, isLoading } = useApp();
  const onLanding = location.pathname === '/';
  return (
    <header className="topbar">
      <a href="#/" className="topbar-brand" onClick={e => { if (onLanding) e.preventDefault(); }}>
        <Wrench size={17} strokeWidth={2.2} />
        Tool Library
      </a>
      <span className="topbar-spacer" />
      <a
        href="#/"
        className={`topbar-link ${onLanding ? 'active' : ''}`}
        onClick={e => { if (onLanding) e.preventDefault(); }}
      >
        <Library size={14} /> Library
      </a>
      <a href="#/import" className={`topbar-link ${location.pathname === '/import' ? 'active' : ''}`}>
        <Upload size={14} /> Import
      </a>
      <a href="#/merge" className={`topbar-link ${location.pathname.startsWith('/merge') ? 'active' : ''}`}>
        <GitMerge size={14} /> Sync Job
      </a>
      <a href="#/settings" className={`topbar-link ${location.pathname === '/settings' ? 'active' : ''}`}>
        <Settings size={14} /> Settings
      </a>
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => loadTools()}
        disabled={isLoading}
        title="Re-download the library from Autodesk to pick up changes made in Fusion 360"
      >
        <RefreshCw size={14} style={isLoading ? { animation: 'spin 1s linear infinite' } : {}} />
        {isLoading ? 'Refreshing…' : 'Refresh'}
      </button>
      <button className="btn btn-ghost btn-sm" onClick={onChangeLibrary} title="Pick a different tool library file">
        <FolderOpen size={14} /> Change library
      </button>
      <span className="topbar-user">
        {googleAuthenticated ? (user?.email || user?.name || '') : 'Autodesk · metadata off'}
      </span>
      <button className="btn btn-ghost btn-sm" onClick={onSignOut}>
        <LogOut size={14} /> Sign out
      </button>
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
        <Wrench size={17} strokeWidth={2.2} />
        Tool Library
      </a>
      <span className="local-mode-badge" title="Browsing an uploaded library file — view-only, not connected to Autodesk">
        <FolderOpen size={13} /> Local mode (read-only)
      </span>
      <a href="#/" className="topbar-link">
        <Library size={14} /> Library
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
