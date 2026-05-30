import { useState } from 'react';
import { Wrench } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import * as aps from '../services/apsService.js';

export default function LoginScreen() {
  const { error } = useApp();
  const [redirecting, setRedirecting] = useState(false);

  const handleSignIn = async () => {
    setRedirecting(true);
    try {
      await aps.signIn(); // full-page redirect to Autodesk
    } catch (err) {
      setRedirecting(false);
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
