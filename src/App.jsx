import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { AppProvider, useApp } from './context/AppContext.jsx';
import LoginScreen from './components/LoginScreen.jsx';
import LandingPage from './components/LandingPage.jsx';
import ToolDetail from './components/ToolDetail.jsx';
import AddToolFlow from './components/AddToolFlow.jsx';
import ImportFlow from './components/ImportFlow.jsx';
import { signOut } from './services/driveService.js';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

export default function App() {
  if (!CLIENT_ID) {
    return (
      <div style={{ minHeight: '100vh', background: '#1a1a1a', color: '#e0e0e0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' }}>
        <div style={{ maxWidth: 480, padding: 32, background: '#242424', border: '1px solid #383838', borderRadius: 8, textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>⚙️</div>
          <h2 style={{ marginBottom: 8, color: '#4a8fff' }}>Configuration Required</h2>
          <p style={{ color: '#999', marginBottom: 16, lineHeight: 1.6 }}>
            <code>VITE_GOOGLE_CLIENT_ID</code> is not set. Create a <code>.env</code> file from <code>.env.example</code>, fill in your values, then run <code>npm run deploy</code> again.
          </p>
          <p style={{ color: '#666', fontSize: 12 }}>See README.md for setup instructions.</p>
        </div>
      </div>
    );
  }

  return (
    <GoogleOAuthProvider clientId={CLIENT_ID}>
      <AppProvider>
        <HashRouter>
          <AppShell />
        </HashRouter>
      </AppProvider>
    </GoogleOAuthProvider>
  );
}

function AppShell() {
  const { user, setUser } = useApp();
  const location = useLocation();

  const handleSignOut = () => {
    signOut();
    setUser(null);
  };

  return (
    <div className="app-shell">
      {user && (
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
          <a
            href="#/import"
            style={{ fontSize: 12, color: 'var(--text-sub)', textDecoration: 'none' }}
          >
            Import
          </a>
          <span className="topbar-user">{user.email || user.name || ''}</span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleSignOut}
          >
            Sign out
          </button>
        </header>
      )}

      <main className="page-content">
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginScreen />} />
          <Route path="/" element={user ? <LandingPage /> : <Navigate to="/login" replace />} />
          <Route path="/tool/new" element={user ? <AddToolFlow /> : <Navigate to="/login" replace />} />
          <Route path="/tool/:id" element={user ? <ToolDetail /> : <Navigate to="/login" replace />} />
          <Route path="/import" element={user ? <ImportFlow /> : <Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
