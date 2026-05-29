import { useEffect, useRef } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { AppProvider, useApp } from './context/AppContext.jsx';
import LoginScreen from './components/LoginScreen.jsx';
import LibrarySetup from './components/LibrarySetup.jsx';
import MetadataConnect from './components/MetadataConnect.jsx';
import LandingPage from './components/LandingPage.jsx';
import ToolDetail from './components/ToolDetail.jsx';
import AddToolFlow from './components/AddToolFlow.jsx';
import ImportFlow from './components/ImportFlow.jsx';

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
  if (processingAuth) {
    return (
      <div className="loading-screen" style={{ minHeight: '100vh' }}>
        <div className="spinner" />
        <span>Completing Autodesk sign-in…</span>
      </div>
    );
  }
  if (!apsAuthenticated) return <LoginScreen />;
  if (!libraryLocation) return <LibrarySetup />;
  if (!googleAuthenticated && !metadataSkipped) return <MetadataConnect />;

  // ─── Authenticated app ──────────────────────────────────────────────────────
  return (
    <div className="app-shell">
      <TopBar user={user} googleAuthenticated={googleAuthenticated} onSignOut={signOutAll} onChangeLibrary={clearLibraryLocation} />
      <main className="page-content">
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/tool/new" element={<AddToolFlow />} />
          <Route path="/tool/:id" element={<ToolDetail />} />
          <Route path="/import" element={<ImportFlow />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function TopBar({ user, googleAuthenticated, onSignOut, onChangeLibrary }) {
  const location = useLocation();
  return (
    <header className="topbar">
      <span className="topbar-brand">🔧 Tool Library</span>
      <span className="topbar-spacer" />
      <a
        href="#/"
        style={{ fontSize: 12, color: 'var(--text-sub)', textDecoration: 'none' }}
        onClick={e => { if (location.pathname === '/') e.preventDefault(); }}
      >
        Library
      </a>
      <a href="#/import" style={{ fontSize: 12, color: 'var(--text-sub)', textDecoration: 'none' }}>
        Import
      </a>
      <button className="btn btn-ghost btn-sm" onClick={onChangeLibrary} title="Pick a different tool library file">
        Change library
      </button>
      <span className="topbar-user">
        {googleAuthenticated ? (user?.email || user?.name || '') : 'Autodesk · metadata off'}
      </span>
      <button className="btn btn-ghost btn-sm" onClick={onSignOut}>Sign out</button>
    </header>
  );
}

function ConfigError() {
  return (
    <div style={{ minHeight: '100vh', background: '#1a1a1a', color: '#e0e0e0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: 480, padding: 32, background: '#242424', border: '1px solid #383838', borderRadius: 8, textAlign: 'center' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>⚙️</div>
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
