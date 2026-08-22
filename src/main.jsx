import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { writeLockReason } from './utils/devWriteGuard.js';
import * as driveService from './services/driveService.js';
import * as apsService from './services/apsService.js';

// ⚠️ Armed HERE, before React mounts — not in a component effect.
// The app writes to Drive with no user action at all (the load-time registry
// seed and the metadata backfill both fire during the initial load), so a lock
// applied when some banner mounts is a lock applied after the writes it was
// meant to stop. This runs first, or it does not work.
const _lock = writeLockReason();
driveService.setWriteLock(_lock);
apsService.setWriteLock(_lock);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
