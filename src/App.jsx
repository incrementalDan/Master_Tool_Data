import { useEffect, useRef } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { Wrench, FolderOpen, LogOut, Library, Upload, Settings, GitMerge } from 'lucide-react';
import { AppProvider, useApp } from './context/AppContext.jsx';
import ToastStack from './components/Toast.jsx';
import LoginScreen from './components/LoginScreen.jsx';
import LibrarySetup from './components/LibrarySetup.jsx';
import MetadataConnect from './components/MetadataConnect.jsx';
import LandingPage from './components/LandingPage.jsx';
import ToolDetail from './components/ToolDetail.jsx';
import AddToolFlow from './components/AddToolFlow.jsx';
import ImportFlow from './components/ImportFlow.jsx';
import MergeFlow from './components/MergeFlow/index.jsx';

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
    toasts, dismissToast,
  } = useApp();

  const ready = apsAuthenticated && libraryLocation && (googleAuthenticated || metadataSkipped);
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
        <main className="page-content">
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/tool/new" element={<AddToolFlow />} />
            <Route path="/tool/:id" element={<ToolDetail />} />
            <Route path="/import" element={<ImportFlow />} />
            <Route path="/merge" element={<MergeFlow />} />
            <Route path="/merge/:id" element={<MergeFlow />} />
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

function TopBar({ user, googleAuthenticated, onSignOut, onChangeLibrary }) {
  const location = useLocation();
  const onLanding = location.pathname === '/';
  return (
    <header className="topbar">
      <span className="topbar-brand">
        <Wrench size={17} strokeWidth={2.2} />
        Tool Library
      </span>
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
