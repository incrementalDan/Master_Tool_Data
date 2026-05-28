import { useState } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { setAccessToken, fetchUserInfo } from '../services/driveService.js';

export default function LoginScreen() {
  const { setUser, loadTools } = useApp();
  const navigate = useNavigate();
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
        setUser(userInfo);
        await loadTools();
        navigate('/');
      } catch (err) {
        setError(err.message || 'Sign-in failed. Check Drive file IDs in .env and try again.');
      } finally {
        setLoading(false);
      }
    },
    onError: () => {
      setError('Google sign-in was cancelled or failed.');
    },
  });

  return (
    <div className="login-screen">
      <div className="login-card">
        <div style={{ fontSize: 48, marginBottom: 12 }}>🔧</div>
        <h1 className="login-title">Fusion Tool Library</h1>
        <p className="login-subtitle">
          Sign in with a Google account that has access to the shared Drive folder to continue.
        </p>

        {error && <div className="error-banner" style={{ marginBottom: 16 }}>{error}</div>}

        <button
          className="btn btn-primary btn-lg"
          onClick={() => login()}
          disabled={loading}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          {loading ? (
            <>
              <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
              Loading library…
            </>
          ) : (
            <>
              <GoogleIcon />
              Sign in with Google
            </>
          )}
        </button>

        <p className="text-sub text-sm" style={{ marginTop: 20 }}>
          Access is limited to accounts with shared Drive folder permissions.
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
      <path d="M3.964 10.707A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}
