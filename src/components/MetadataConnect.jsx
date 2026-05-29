import { useState } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { useApp } from '../context/AppContext.jsx';
import { setAccessToken, fetchUserInfo } from '../services/driveService.js';

// Second step of setup: connect Google Drive for tool_metadata.json.
// Optional — the user can skip and use APS-only (no extra metadata fields).
export default function MetadataConnect() {
  const { setGoogleUser, skipMetadata, signOutAll } = useApp();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const login = useGoogleLogin({
    scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
    onSuccess: async (tokenResponse) => {
      setLoading(true);
      setError('');
      try {
        setAccessToken(tokenResponse.access_token);
        const userInfo = await fetchUserInfo();
        setGoogleUser(userInfo);
      } catch (err) {
        setError(err.message || 'Google sign-in failed.');
      } finally {
        setLoading(false);
      }
    },
    onError: () => setError('Google sign-in was cancelled or failed.'),
  });

  return (
    <div className="login-screen">
      <div className="login-card">
        <div style={{ fontSize: 40, marginBottom: 12 }}>🗂️</div>
        <h1 className="login-title">Connect Google Drive</h1>
        <p className="login-subtitle">
          Extra fields Fusion doesn't support (tags, notes, ProShop IDs, material suitability) are stored in
          <code> tool_metadata.json</code> on Google Drive. Connect now to load and save them.
        </p>

        {error && <div className="error-banner" style={{ marginBottom: 16 }}>{error}</div>}

        <button
          className="btn btn-primary btn-lg"
          onClick={() => login()}
          disabled={loading}
          style={{ width: '100%', justifyContent: 'center', marginBottom: 10 }}
        >
          {loading ? (
            <>
              <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
              Connecting…
            </>
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
