import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import {
  SEQUENCE_CSV, machineFolders, candidatesFor, expectedFolderFor, evaluateProgramFile,
} from '../utils/programFileSync.js';

// Watch the machines' posted-file folders and say, per program, whether Drive
// has something newer than what the app holds.
//
// ⚠️ ONE LISTING PER FOLDER, SHARED BY EVERY PROGRAM ON THE PAGE. A part with a
// dozen operations costs one or two Drive calls, not a dozen — which is the
// only reason this is cheap enough to sit on a timer. `statusFor(operation)`
// then matches program numbers against that listing in memory.
//
// The poll is deliberately unobtrusive: it runs on mount, every REFRESH_MS while
// the tab is VISIBLE, and again when the tab is brought back to the front after
// being away. A hidden tab polls nothing — there is nobody to show the result to.
const REFRESH_MS = 5 * 60 * 1000;

export default function useProgramFileSync({ kind = SEQUENCE_CSV, enabled = true } = {}) {
  const { shopSettings, programDetails, googleAuthenticated, listPostedFolders } = useApp();

  const [state, setState] = useState({
    phase: 'idle',          // idle | checking | ready | error
    listings: new Map(),
    errors: [],
    checkedAt: null,
  });

  const folders = machineFolders(shopSettings);
  const configured = folders.length > 0;
  const active = enabled && googleAuthenticated && configured;

  // Guards a refresh triggered while one is already in flight (the interval and
  // a visibility change can land together), and a setState after unmount.
  //
  // ⚠️ `alive` is set back to TRUE on mount, not just false on unmount. React
  // StrictMode mounts, unmounts and remounts every component in development —
  // so a flag only ever cleared stays cleared through the remount, every
  // setState is skipped, and the indicator sits on its spinner forever. That
  // reads as a completely broken feature, and only in dev, which is exactly
  // where it would be seen first.
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (!active || inFlight.current) return;
    inFlight.current = true;
    setState(s => ({ ...s, phase: 'checking' }));
    try {
      const { listings, errors } = await listPostedFolders();
      if (!alive.current) return;
      setState({ phase: 'ready', listings, errors, checkedAt: new Date().toISOString() });
    } catch (err) {
      if (!alive.current) return;
      // A failed check is reported as a check that failed — never as "no posted
      // file", which would read as a missing file rather than a missing answer.
      setState(s => ({ ...s, phase: 'error', errors: [{ message: err.message }] }));
    } finally {
      inFlight.current = false;
    }
  }, [active, listPostedFolders]);

  useEffect(() => {
    if (!active) { setState(s => (s.phase === 'idle' ? s : { ...s, phase: 'idle' })); return; }
    refresh();
    const timer = setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [active, refresh]);

  // The status for one operation, evaluated live against the current listing and
  // the current stored detail — so pulling a file in updates the indicator with
  // no re-poll, and correcting something elsewhere is reflected immediately.
  const statusFor = useCallback((operation) => {
    if (!configured) return { state: 'no_folders' };
    if (!googleAuthenticated) return { state: 'no_drive' };
    if (state.phase === 'idle' || state.phase === 'checking') return { state: 'checking' };
    if (state.phase === 'error') return { state: 'error', message: state.errors[0]?.message || 'Check failed' };

    const detail = (programDetails?.details || []).find(d => d.operation_id === operation.id) || null;
    const expected = expectedFolderFor(operation, folders);
    const result = evaluateProgramFile({
      detail,
      candidates: candidatesFor(operation.program_number, folders, state.listings, kind),
      expectedFolderId: expected?.folderId || null,
      foldersConfigured: folders.length,
    });
    // A folder that failed to list can't say a file isn't there — it can only
    // say it didn't look. Report that rather than "missing".
    if (result.state === 'missing' && state.errors.length > 0) {
      return { ...result, state: 'error', message: `Couldn't read ${state.errors.length} folder${state.errors.length !== 1 ? 's' : ''}: ${state.errors[0].message}` };
    }
    return result;
  }, [configured, googleAuthenticated, state, programDetails, folders, kind]);

  return { ...state, folders, configured, active, refresh, statusFor };
}
