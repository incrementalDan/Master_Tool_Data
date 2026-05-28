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
