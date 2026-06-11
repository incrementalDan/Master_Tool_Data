import { useRef, useState } from 'react';
import { Wrench, UploadCloud } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import * as aps from '../services/apsService.js';

export default function LoginScreen() {
  const { error, enterLocalMode } = useApp();
  const [redirecting, setRedirecting] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const fileRef = useRef(null);

  const handleSignIn = async () => {
    setRedirecting(true);
    try {
      await aps.signIn(); // full-page redirect to Autodesk
    } catch (err) {
      setRedirecting(false);
    }
  };

  const handleLocalFile = async (file) => {
    if (!file) return;
    setLoadingFile(true);
    try {
      await enterLocalMode(file);
    } finally {
      setLoadingFile(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo"><Wrench size={28} strokeWidth={2.2} /></div>
        <h1 className="login-title">Fusion Tool Library</h1>
        <p className="login-subtitle">
          Sign in with your Autodesk account to read and write the Fusion 360 cloud tool library directly.
        </p>

        {error && <div className="error-banner" style={{ marginBottom: 16 }}>{error}</div>}

        <button
          className="btn btn-primary btn-lg"
          onClick={handleSignIn}
          disabled={redirecting}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          {redirecting ? (
            <>
              <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
              Redirecting to Autodesk…
            </>
          ) : (
            <>
              <AutodeskIcon />
              Sign in with Autodesk
            </>
          )}
        </button>

        <p className="text-sub text-sm" style={{ marginTop: 20 }}>
          Access requires the app to be provisioned in your Fusion hub.
        </p>

        <div className="login-divider"><span>or</span></div>

        <button
          className="btn btn-secondary"
          onClick={() => fileRef.current?.click()}
          disabled={loadingFile}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          {loadingFile ? (
            <>
              <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
              Loading…
            </>
          ) : (
            <>
              <UploadCloud size={16} />
              Browse a local library file
            </>
          )}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={e => handleLocalFile(e.target.files[0])}
        />

        <p className="text-sub text-sm" style={{ marginTop: 12 }}>
          No Autodesk account needed — upload a <code>fusion_tool_library.json</code> file to
          search, filter, and view the library and export it to ProShop. Editing and saving
          requires signing in with Autodesk.
        </p>
      </div>
    </div>
  );
}

function AutodeskIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M2 17.5L13.2 6.5h6.3L8.3 17.5H2z" />
    </svg>
  );
}
