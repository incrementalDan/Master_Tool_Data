// AppContext: the provider wiring only. The pieces live in sibling modules —
//   appState.js          initialState, reducer, SETUP_STEPS, registry helpers
//   toolActions.js       writeLogicalTool + save/add/clone/merge/delete,
//                        assembly CRUD, location assign, reconcile
//   libraryOps.js        saveFullLibrary, renumber, assign/re-number IDs,
//                        normalizeLibrary (shop-global bulk operations)
//   attachmentActions.js photos/attachments + ProShop photo import
// The provider keeps auth, per-library IO, shared-Drive-file plumbing, the
// registry actions, local/demo modes, and loadTools; the factories receive
// dispatch/notify/IO + the render-synced refs and return plain async actions.
import { createContext, useContext, useReducer, useCallback, useEffect, useMemo, useRef } from 'react';
import * as driveService from '../services/driveService.js';
import * as aps from '../services/apsService.js';
import { groupByTrackingId, buildLogicalTool, combineToolsByToolId, materializeUnlinkedTools, buildUnlinkedTool } from '../schema/toolSchema.js';
import { backfillAsmNumbers } from '../utils/assemblyIdSystem.js';
import { derivePairings } from '../schema/insertFamilies.js';
import { resolveLocationString, findSystem, proShopLocationValue } from '../utils/locationSystem.js';
import { DEFAULT_MATERIALS, DEFAULT_SHOP_SETTINGS, DEFAULT_JOBS, DEFAULT_COMPONENTS } from '../schema/sharedDefaults.js';
import { DEFAULT_VENDOR_REGISTRY, setActiveVendorRegistry } from '../schema/vendorRegistry.js';
import { findJob, newJob } from '../utils/jobs.js';
import { setDefaultUnit } from '../utils/units.js';
import { getDemoData, isDemoRequested } from '../demo/index.js';
import {
  SETUP_STEPS, SETUP_PROGRESS_KEY, SETUP_CELEBRATED_KEY,
  locToLibEntry, saveRegistryMirror, defaultToolLibraryId, primaryToolLib,
  seedShopSettingsRegistry, loadSetupProgress,
  initialState, reducer,
} from './appState.js';
import { createToolActions } from './toolActions.js';
import { createLibraryOps } from './libraryOps.js';
import { createAttachmentActions } from './attachmentActions.js';
import { createComponentActions } from './componentActions.js';

export { SETUP_STEPS, defaultToolLibraryId };

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Keep latest values accessible inside async callbacks without stale closures.
  // Assigned directly during render (NOT via useEffect): an effect that reads one
  // of these refs (e.g. AppShell's "ready → loadTools" trigger below) can run in
  // the same flush as — and before — a useEffect-based sync would have updated it,
  // which raced a stale `locationRef.current = null` into "No tool library location
  // selected" right after picking a new library while already Google-connected
  // (both `libraryLocation` and `ready` flip true on the same render in that case).
  // Render-time assignment is always current before any effect can run.
  const locationRef = useRef(state.libraryLocation);
  const holderLocationRef = useRef(state.holderLibraryLocation);
  const googleRef = useRef(state.googleAuthenticated);
  const toolsRef = useRef(state.tools);
  const holdersRef = useRef(state.holders);
  const localModeRef = useRef(state.localMode);
  const demoModeRef = useRef(state.demoMode);
  const shopSettingsRef = useRef(state.shopSettings);
  const materialsRef = useRef(state.materials);
  const jobsRef = useRef(state.jobs);
  const componentsRef = useRef(state.components);
  // Pending debounced shared-Drive-file writes, keyed by file key →
  // { timer, write(keepalive) }. Lets typing coalesce into one write and lets
  // flushSharedWrites fire the latest pending write early on page hide/close.
  const sharedSaveTimersRef = useRef({});
  // In-app navigation guard. A page (e.g. Settings, while editing) registers
  // { shouldBlock(), onBlocked(proceed) }; nav sources call maybeBlockNav(proceed)
  // and skip their own navigation when it returns true (blocked). HashRouter isn't
  // a data router, so React Router's useBlocker isn't available — this is the seam.
  const navGuardRef = useRef(null);
  // Caches each library's wrapper-level fields (e.g. `version`), keyed by
  // library id (itemId), from the last download of that library — so a save
  // writes the file back with the same wrapper shape. One entry per linked
  // library. See downloadFusionList/uploadFusionList.
  const libraryWrappersRef = useRef(new Map());
  locationRef.current = state.libraryLocation;
  holderLocationRef.current = state.holderLibraryLocation;
  googleRef.current = state.googleAuthenticated;
  toolsRef.current = state.tools;
  holdersRef.current = state.holders;
  localModeRef.current = state.localMode;
  demoModeRef.current = state.demoMode;
  shopSettingsRef.current = state.shopSettings;
  materialsRef.current = state.materials;
  jobsRef.current = state.jobs;
  componentsRef.current = state.components;

  // Tracks whether we've already seeded setup-progress flags for an established
  // library this session — seeding should run at most once, and only when no
  // progress has been stored yet (a brand-new install).
  const setupSeededRef = useRef(loadSetupProgress() !== null);

  // Persist setup-progress flags whenever they change (seeding or step marks).
  useEffect(() => {
    localStorage.setItem(SETUP_PROGRESS_KEY, JSON.stringify(state.setupProgress));
  }, [state.setupProgress]);

  // ─── Handle APS OAuth callback on mount ───────────────────────────────────
  useEffect(() => {
    if (isDemoRequested()) return; // demo mode skips Autodesk entirely
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const authErr = params.get('error');

    if (authErr) {
      dispatch({ type: 'AUTH_ERROR', error: `Autodesk sign-in error: ${authErr}` });
      window.history.replaceState({}, '', window.location.pathname + window.location.hash);
      return;
    }
    if (code) {
      dispatch({ type: 'AUTH_START' });
      // Strip the code from the URL immediately, keep the hash route
      window.history.replaceState({}, '', window.location.pathname + window.location.hash);
      aps.handleCallback(code)
        .then(() => dispatch({ type: 'APS_AUTHED' }))
        .catch(err => dispatch({ type: 'AUTH_ERROR', error: err.message }));
      return;
    }
    // No callback code — try to silently restore from a stored refresh token
    aps.tryRestoreSession().then(restored => {
      if (restored) dispatch({ type: 'APS_AUTHED' });
    });
  }, []);

  // ─── Toasts ───────────────────────────────────────────────────────────────
  const dismissToast = useCallback((id) => dispatch({ type: 'DISMISS_TOAST', id }), []);

  const notify = useCallback((message, type = 'info', timeout = 4000) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    dispatch({ type: 'ADD_TOAST', toast: { id, type, message } });
    if (timeout) setTimeout(() => dispatch({ type: 'DISMISS_TOAST', id }), timeout);
    return id;
  }, []);

  // ─── Holder libraries (multi) ─────────────────────────────────────────────
  // Load every linked holder library, tag each holder with its source library
  // (_libraryId / _libraryName) so the holder picker can group by library, and
  // merge into one list. Holders are cross-library — any holder usable anywhere.
  // Pass an explicit holderLibs list when the registry was just changed in the
  // same tick (refs lag a dispatch until the next render); otherwise it reads the
  // current registry.
  const loadHolders = useCallback(async (holderLibsArg) => {
    const holderLibs = holderLibsArg || shopSettingsRef.current?.holder_libraries || [];
    if (holderLibs.length === 0) { dispatch({ type: 'SET_HOLDERS', holders: [] }); return; }
    const all = [];
    for (const lib of holderLibs) {
      try {
        const hs = await aps.loadHolderLibrary(lib.projectId, lib.itemId);
        for (const h of hs) all.push({ ...h, _libraryId: lib.id, _libraryName: lib.fileName });
      } catch (err) {
        notify(`Holder library "${lib.fileName}" failed to load: ${err.message}`, 'error');
      }
    }
    dispatch({ type: 'SET_HOLDERS', holders: all });
  }, [notify]);

  // ─── Per-library registry helpers ─────────────────────────────────────────
  // Resolve a tool library's APS location by its id (itemId). Falls back to the
  // primary pointer when no id is given (single-library / legacy callers).
  const toolLibById = (libraryId) => {
    const tl = shopSettingsRef.current?.tool_libraries || [];
    if (libraryId) return tl.find(l => l.id === libraryId) || null;
    return primaryToolLib(shopSettingsRef.current) || locationRef.current || null;
  };

  // ─── Drive-backed Fusion list helpers (per library) ───────────────────────
  const downloadFusionList = useCallback(async (libraryId) => {
    if (demoModeRef.current) throw new Error('Demo mode is read-only — changes are not saved');
    if (localModeRef.current) throw new Error('Local mode is read-only — connect to Autodesk to load or save the live library');
    const loc = toolLibById(libraryId);
    if (!loc) throw new Error('No tool library location selected');
    const json = await aps.loadToolLibrary(loc.projectId, loc.itemId);
    // Remember every wrapper-level field besides `data` (e.g. `version: 36`),
    // keyed per library, so uploadFusionList writes the file back with the same
    // wrapper shape — Fusion's library file is `{ data: [...], version: 36 }`,
    // and silently dropping `version` on save makes Fusion treat the round-
    // tripped file as a different/unversioned library (reassigned guids, etc).
    if (json && typeof json === 'object' && !Array.isArray(json)) {
      const { data, ...wrapperRest } = json;
      libraryWrappersRef.current.set(loc.id, wrapperRest);
    }
    return Array.isArray(json?.data) ? json.data : (Array.isArray(json) ? json : []);
  }, []);

  const uploadFusionList = useCallback(async (libraryId, list) => {
    if (demoModeRef.current) throw new Error('Demo mode is read-only — changes are not saved');
    if (localModeRef.current) throw new Error('Local mode is read-only — connect to Autodesk to save changes');
    const loc = toolLibById(libraryId);
    if (!loc) throw new Error('No tool library location selected');
    const wrapper = libraryWrappersRef.current.get(loc.id) || {};
    await aps.saveToolLibrary(loc.projectId, loc.folderId, loc.itemId, loc.fileName, { ...wrapper, data: list });
  }, []);

  // Download every linked tool library: returns [{ libraryId, library, list }].
  // Used by the shop-global bulk operations (renumber / assign IDs) that need to
  // operate across all libraries then write each one back.
  const downloadAllLibraries = useCallback(async () => {
    const tl = shopSettingsRef.current?.tool_libraries || [];
    const out = [];
    for (const lib of tl) {
      const list = await downloadFusionList(lib.id);
      out.push({ libraryId: lib.id, library: lib, list });
    }
    return out;
  }, [downloadFusionList]);

  // Expose raw Fusion list download for the merge flow / reconcile live-fetch.
  const fetchRawLibrary = useCallback(async (libraryId) => {
    return await downloadFusionList(libraryId);
  }, [downloadFusionList]);

  // ─── Auth / setup actions ─────────────────────────────────────────────────
  const setGoogleUser = useCallback((user) => {
    driveService.setUserInfo(user);
    dispatch({ type: 'SET_GOOGLE_USER', user });
  }, []);

  const skipMetadata = useCallback(() => dispatch({ type: 'SKIP_METADATA' }), []);

  // Lets a user who skipped metadata setup return to the connect screen from Settings.
  const reconnectMetadata = useCallback(() => dispatch({ type: 'RECONNECT_METADATA' }), []);

  // Fully disconnects the linked metadata file (e.g. it was deleted in Drive and the
  // user wants a fresh one in a new location). Drops the cached file ID so the old
  // (possibly trashed-but-still-readable) file can't be silently picked back up, and
  // sets metadataForceNew so MetadataConnect skips straight to the folder picker —
  // re-running "does a file already exist?" would otherwise re-find a trashed file.
  const disconnectMetadata = useCallback(() => {
    driveService.signOut();
    localStorage.removeItem('google_drive_connected');
    localStorage.removeItem('drive_metadata_file_id');
    dispatch({ type: 'DISCONNECT_METADATA' });
  }, []);

  // Resolves the linked metadata file's name + folder/drive location for display in Settings.
  const fetchMetadataLocation = useCallback(() => driveService.getMetadataFileLocation(), []);
  const dismissMetadataWarning = useCallback(() => dispatch({ type: 'METADATA_FILE_WARNING', warning: null }), []);

  // ─── Shared Drive files (materials / vendor registry / shop settings) ─────
  // Save back to Drive and update in-memory state. Foundation: no UI yet, but
  // any component can read state.{materials,vendorRegistry,shopSettings} and
  // call these to persist edits.
  // Debounced Drive write for a shared file. Flushes the LATEST settled state at
  // timer time (the refs are render-synced, so by flush all same-tick optimistic
  // dispatches have committed) — robust when several writers touch shop_settings
  // in one tick. Falls back to the captured payload for files without a ref.
  const scheduleSharedWrite = useCallback((key, fallbackData) => {
    // Demo mode is an in-memory sandbox — never write shared files to Drive.
    if (demoModeRef.current) return;
    const { SHARED_FILES } = driveService;
    const pending = sharedSaveTimersRef.current;
    // The write closure reads the latest settled state at call time (refs are
    // render-synced), so flushing early still writes the newest value.
    const write = (keepalive = false) => {
      const payload = key === 'shopSettings' ? shopSettingsRef.current
        : key === 'materials' ? materialsRef.current
        : key === 'jobs' ? jobsRef.current
        : key === 'components' ? componentsRef.current
        : fallbackData;
      return driveService.saveSharedJson(SHARED_FILES[key].name, SHARED_FILES[key].cacheKey, payload, { keepalive })
        .catch(err => {
          if (err.code === 'TOKEN_EXPIRED') dispatch({ type: 'GOOGLE_EXPIRED' });
          notify(`Save failed: ${err.message}`, 'error', 7000);
        });
    };
    if (pending[key]?.timer) clearTimeout(pending[key].timer);
    pending[key] = {
      write,
      timer: setTimeout(() => { delete pending[key]; write(false); }, 600),
    };
  }, [notify]);

  // Fire any pending debounced shared-file writes immediately. Called when the
  // page is about to be hidden/closed (pagehide / visibilitychange) so an edit
  // made in the last debounce window isn't lost. Uses fetch keepalive so the
  // request can complete even as the page unloads. (In-app route changes keep
  // the provider mounted, so their timers fire normally — this is only for
  // tab close / refresh / navigate-away.)
  const flushSharedWrites = useCallback(() => {
    const pending = sharedSaveTimersRef.current;
    for (const key of Object.keys(pending)) {
      const entry = pending[key];
      if (!entry) continue;
      if (entry.timer) clearTimeout(entry.timer);
      delete pending[key];
      entry.write?.(true); // keepalive
    }
  }, []);

  const saveSharedFile = useCallback((key, data, dispatchType, onSaved) => {
    const stateKey = key === 'shopSettings' ? 'shopSettings'
      : key === 'vendorRegistry' ? 'vendorRegistry'
      : key === 'jobs' ? 'jobs'
      : key === 'components' ? 'components'
      : 'materials';
    // Demo mode: update in-memory state only (no Drive write, no Google guard) so
    // the sandbox can edit shop settings / materials / vendors — lost on refresh.
    if (demoModeRef.current) {
      onSaved?.(data);
      dispatch({ type: dispatchType, [stateKey]: data });
      return Promise.resolve();
    }
    if (!googleRef.current) { notify('Connect Google Drive to save', 'error'); return Promise.reject(new Error('Google Drive not connected')); }
    // Optimistic, synchronous state update — controlled inputs in the editors
    // (Location / Materials / Vendors) read their value from this state, so they
    // must NOT wait on the Drive round-trip or every keystroke lags by the network
    // latency. Update state now; persist to Drive on a per-file debounce so rapid
    // typing coalesces into a single write instead of one-per-keystroke.
    onSaved?.(data);
    dispatch({ type: dispatchType, [stateKey]: data });
    scheduleSharedWrite(key, data);
    return Promise.resolve();
  }, [notify, scheduleSharedWrite]);

  const saveMaterials = useCallback((materials) =>
    saveSharedFile('materials', materials, 'SET_MATERIALS'), [saveSharedFile]);
  const saveVendorRegistry = useCallback((vendorRegistry) =>
    saveSharedFile('vendorRegistry', vendorRegistry, 'SET_VENDOR_REGISTRY', setActiveVendorRegistry), [saveSharedFile]);
  const saveShopSettings = useCallback((shopSettings) =>
    saveSharedFile('shopSettings', shopSettings, 'SET_SHOP_SETTINGS'), [saveSharedFile]);
  const saveJobs = useCallback((jobs) =>
    saveSharedFile('jobs', jobs, 'SET_JOBS'), [saveSharedFile]);
  const saveComponents = useCallback((components) =>
    saveSharedFile('components', components, 'SET_COMPONENTS'), [saveSharedFile]);

  // Persist the jobs registry to Drive IMMEDIATELY (not on the shared-file 600ms
  // debounce). Used when a job is CREATED/enriched and its id is about to be
  // written into a tool/preset metadata record in the SAME user action: the
  // debounced path could leave that reference durable on Drive while the
  // jobs.json write is still pending, so a crash in the window would orphan the
  // reference (and dangling job ids are hidden silently by collectToolJobs).
  // Writes the explicit `nextFile` rather than reading jobsRef — the ref lags
  // this tick's optimistic dispatch, so a ref-based write would drop the new job.
  // Supersedes any pending debounced jobs write. Demo / no-Drive: state only.
  const persistJobsNow = useCallback((nextFile) => {
    dispatch({ type: 'SET_JOBS', jobs: nextFile });
    if (demoModeRef.current || !googleRef.current) return;
    const pending = sharedSaveTimersRef.current['jobs'];
    if (pending?.timer) { clearTimeout(pending.timer); delete sharedSaveTimersRef.current['jobs']; }
    const { SHARED_FILES } = driveService;
    driveService.saveSharedJson(SHARED_FILES.jobs.name, SHARED_FILES.jobs.cacheKey, nextFile)
      .catch(err => {
        if (err.code === 'TOKEN_EXPIRED') dispatch({ type: 'GOOGLE_EXPIRED' });
        notify(`Job save failed: ${err.message}`, 'error', 7000);
      });
  }, [notify]);

  // Resolve a (program #, part #) pair to its job record, creating it in the
  // registry if new. Identity is the case-insensitive trimmed pair (jobKey) —
  // the same job entered on five tools stays ONE record; references are by id.
  // `programId` (optional) joins the job to a Program Number Manager record; an
  // existing loose link is enriched with it the first time we learn it.
  // A created/enriched record is written to Drive IMMEDIATELY (persistJobsNow) so
  // it's durable before its id is referenced; an unchanged existing record needs
  // no write. Demo mode stays in-memory.
  const findOrCreateJob = useCallback((programNumber, partNumber, createdBy = '', programId = null) => {
    const file = jobsRef.current || DEFAULT_JOBS;
    const existing = findJob(file, programNumber, partNumber);
    if (existing) {
      if (programId && !existing.program_id) {
        const enriched = { ...existing, program_id: programId };
        persistJobsNow({ ...file, jobs: file.jobs.map(j => j.id === existing.id ? enriched : j) });
        return enriched;
      }
      return existing;
    }
    const job = newJob(programNumber, partNumber, createdBy, programId);
    persistJobsNow({ ...file, jobs: [...(file.jobs || []), job] });
    return job;
  }, [persistJobsNow]);

  // Persist only the location_config sub-object (the Settings Location System
  // editor calls this after each add/edit/delete/normalize change). Merges via the
  // reducer (fresh state) + debounced write so per-keystroke edits don't lag on the
  // network and don't clobber a concurrent setup-step stamp in the same tick.
  const saveLocationConfig = useCallback((locationConfig) => {
    dispatch({ type: 'SET_LOCATION_CONFIG', locationConfig });
    scheduleSharedWrite('shopSettings');
    return Promise.resolve();
  }, [scheduleSharedWrite]);

  // Nav guard plumbing (see navGuardRef). registerNavGuard(null) clears it.
  const registerNavGuard = useCallback((guard) => { navGuardRef.current = guard; }, []);
  const maybeBlockNav = useCallback((proceed) => {
    const g = navGuardRef.current;
    if (g && g.shouldBlock()) { g.onBlocked(proceed); return true; }
    return false;
  }, []);

  // Marks one step of the setup guide as complete (idempotent — see MARK_SETUP_STEP).
  const markSetupStep = useCallback((key) => dispatch({ type: 'MARK_SETUP_STEP', key }), []);

  // Like markSetupStep but also stamps a timestamp in shop_settings.json on Drive
  // (shared across devices). Falls back gracefully if Google Drive is not connected.
  const markSetupStepInSettings = useCallback((key) => {
    dispatch({ type: 'MARK_SETUP_STEP', key });
    if (!googleRef.current) return;
    // Merge the timestamp into shopSettings via the reducer (fresh state — never
    // rebuild-and-replace from a stale ref, which would clobber a concurrent
    // location_config / id-system edit in the same tick), then debounce-write the
    // latest settled state.
    dispatch({ type: 'MARK_SETUP_TIMESTAMP', key, ts: new Date().toISOString() });
    scheduleSharedWrite('shopSettings');
  }, [scheduleSharedWrite]);

  // The metadataConnected setup step completes the moment Google Drive is
  // connected (live sign-in or a restored session). Declarative so it fires
  // for both paths without threading a call through every Google entry point.
  useEffect(() => {
    if (state.googleAuthenticated && !state.setupProgress.metadataConnected) {
      markSetupStepInSettings('metadataConnected');
    }
  }, [state.googleAuthenticated, state.setupProgress.metadataConnected, markSetupStepInSettings]);

  // Flush any pending debounced shared-file writes when the page is hidden or
  // closed, so an edit made inside the 600ms debounce window isn't lost on a tab
  // close / refresh / navigate-away. `visibilitychange → hidden` and `pagehide`
  // are the reliable "page is going away" signals (more so than `beforeunload`,
  // esp. on mobile); the write uses fetch keepalive to finish during unload.
  // In-app (HashRouter) navigation keeps the provider mounted, so those timers
  // fire normally and don't need this.
  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushSharedWrites(); };
    window.addEventListener('pagehide', flushSharedWrites);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flushSharedWrites);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [flushSharedWrites]);

  // One-time-ever flag so the congratulations popup doesn't fire again after dismissal.
  const setupCelebrated = useCallback(() => localStorage.getItem(SETUP_CELEBRATED_KEY) === '1', []);
  const markSetupCelebrated = useCallback(() => localStorage.setItem(SETUP_CELEBRATED_KEY, '1'), []);

  // ─── Library registry actions ─────────────────────────────────────────────
  // Single point that commits a registry change: updates state + pointers (via
  // SET_LIBRARIES), mirrors to localStorage (so APS-only sessions keep working),
  // and persists shop-wide to shop_settings.json when Drive is connected.
  const persistRegistry = useCallback((nextSS) => {
    dispatch({ type: 'SET_LIBRARIES', shopSettings: nextSS });
    saveRegistryMirror(nextSS);
    if (googleRef.current) {
      const { SHARED_FILES } = driveService;
      driveService.saveSharedJson(SHARED_FILES.shopSettings.name, SHARED_FILES.shopSettings.cacheKey, nextSS)
        .catch(() => { /* mirror + in-memory already set; Drive is best-effort */ });
    }
  }, []);

  const addToolLibrary = useCallback((location) => {
    const ss = shopSettingsRef.current || {};
    const existing = ss.tool_libraries || [];
    if (existing.some(l => l.id === location.itemId)) return; // already linked
    const entry = locToLibEntry(location, existing.length);
    const tool_libraries = [...existing, entry];
    const next = {
      ...ss,
      tool_libraries,
      default_tool_library_id: ss.default_tool_library_id || entry.id,
    };
    persistRegistry(next);
    markSetupStepInSettings('fusionConnected');
  }, [persistRegistry, markSetupStepInSettings]);

  const removeToolLibrary = useCallback((libraryId) => {
    const ss = shopSettingsRef.current || {};
    const tool_libraries = (ss.tool_libraries || []).filter(l => l.id !== libraryId)
      .map((l, i) => ({ ...l, order: i }));
    const default_tool_library_id = ss.default_tool_library_id === libraryId
      ? (tool_libraries[0]?.id || null)
      : ss.default_tool_library_id;
    persistRegistry({ ...ss, tool_libraries, default_tool_library_id });
  }, [persistRegistry]);

  const setDefaultToolLibrary = useCallback((libraryId) => {
    const ss = shopSettingsRef.current || {};
    persistRegistry({ ...ss, default_tool_library_id: libraryId });
  }, [persistRegistry]);

  const addHolderLibrary = useCallback(async (location) => {
    const ss = shopSettingsRef.current || {};
    const existing = ss.holder_libraries || [];
    if (existing.some(l => l.id === location.itemId)) return;
    const entry = locToLibEntry(location, existing.length);
    const holder_libraries = [...existing, entry];
    persistRegistry({ ...ss, holder_libraries });
    await loadHolders(holder_libraries);
  }, [persistRegistry, loadHolders]);

  const removeHolderLibrary = useCallback(async (libraryId) => {
    const ss = shopSettingsRef.current || {};
    const holder_libraries = (ss.holder_libraries || []).filter(l => l.id !== libraryId)
      .map((l, i) => ({ ...l, order: i }));
    persistRegistry({ ...ss, holder_libraries });
    await loadHolders(holder_libraries);
  }, [persistRegistry, loadHolders]);

  // First-run wizard commit: set the whole registry (multiple tool + holder
  // libraries) in ONE write, avoiding the stale-ref problem of calling the
  // single-add actions in a loop.
  const commitInitialLibraries = useCallback(async (toolLocs, holderLocs) => {
    const ss = shopSettingsRef.current || {};
    const tool_libraries = (toolLocs || []).map((loc, i) => locToLibEntry(loc, i)).filter(Boolean);
    const holder_libraries = (holderLocs || []).map((loc, i) => locToLibEntry(loc, i)).filter(Boolean);
    persistRegistry({
      ...ss,
      tool_libraries,
      holder_libraries,
      default_tool_library_id: tool_libraries[0]?.id || null,
    });
    markSetupStepInSettings('fusionConnected');
    await loadHolders(holder_libraries);
  }, [persistRegistry, markSetupStepInSettings, loadHolders]);

  // Back-compat shims used by the first-run wizard / Settings single-pick paths.
  // setLibraryLocation = "add this tool library"; clearLibraryLocation = "unlink
  // everything" (sends the user back to the setup wizard).
  const setLibraryLocation = useCallback((location) => {
    addToolLibrary(location);
  }, [addToolLibrary]);

  const setHolderLibraryLocation = useCallback(async (location) => {
    await addHolderLibrary(location);
  }, [addHolderLibrary]);

  const clearHolderLibraryLocation = useCallback(() => {
    const ss = shopSettingsRef.current || {};
    persistRegistry({ ...ss, holder_libraries: [] });
    dispatch({ type: 'SET_HOLDERS', holders: [] });
  }, [persistRegistry]);

  const clearLibraryLocation = useCallback(() => {
    const ss = shopSettingsRef.current || {};
    persistRegistry({ ...ss, tool_libraries: [], default_tool_library_id: null });
  }, [persistRegistry]);

  // Switch libraries without losing the current one until a new pick is made:
  // beginChangeLibrary shows the picker (Cancel returns to the current library);
  // setLibraryLocation clears the flag automatically on a successful pick.
  const beginChangeLibrary = useCallback(() => dispatch({ type: 'START_CHANGE_LIBRARY' }), []);
  const cancelChangeLibrary = useCallback(() => dispatch({ type: 'CANCEL_CHANGE_LIBRARY' }), []);

  const signOutAll = useCallback(() => {
    aps.signOut();
    driveService.signOut();
    localStorage.removeItem('google_drive_connected');
    dispatch({ type: 'SIGN_OUT' });
  }, []);

  // ─── Local (no-Autodesk) browse mode ──────────────────────────────────────
  // Lets someone open a fusion_tool_library.json file directly — no APS/Google
  // sign-in — to search, filter, view, and ProShop-export the library. Read-only:
  // downloadFusionList/uploadFusionList both refuse while localModeRef is set, so
  // every save path (writeLogicalTool, saveFullLibrary, reconcileTool, etc.) fails
  // with a clear toast instead of attempting a network call.
  const enterLocalMode = useCallback(async (file) => {
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const fusionList = Array.isArray(json?.data) ? json.data : (Array.isArray(json) ? json : []);
      if (fusionList.length === 0) throw new Error('No tools found in this file');

      const metaByTracking = new Map();
      const { groups, untracked } = groupByTrackingId(fusionList);
      const built = [];
      for (const [, raws] of groups) built.push(buildLogicalTool(raws, metaByTracking));
      for (const raw of untracked) built.push(buildLogicalTool([raw], metaByTracking));
      const tools = derivePairings(
        combineToolsByToolId(built)
          .map(t => ({ ...t, library_id: 'local', library_name: file.name || 'Local file' })),
        [], // local mode has no component records — pairings derive with empty slots
      );

      dispatch({ type: 'ENTER_LOCAL_MODE', tools });
      notify(`Loaded ${tools.length} tool${tools.length === 1 ? '' : 's'} (local mode — read-only)`, 'success');
    } catch (err) {
      notify(`Could not load file: ${err.message}`, 'error', 7000);
    }
  }, [notify]);

  const exitLocalMode = useCallback(() => dispatch({ type: 'EXIT_LOCAL_MODE' }), []);

  // ─── Demo mode (?demo=true) ───────────────────────────────────────────────
  // Loads bundled sample data with no Autodesk/Google sign-in so the full app UI
  // can be browsed and demoed. Read-only: the demoModeRef guards in
  // downloadFusionList/uploadFusionList make every save path fail gracefully
  // (the "Demo Mode — changes are not saved" banner sets the expectation).
  const enterDemoMode = useCallback(() => {
    const { fusionList, metaList, holders, materials, vendorRegistry, shopSettings, jobs, components } = getDemoData();
    // Build logical tools through the exact same pipeline as a live load.
    const metaByTracking = new Map(metaList.map(m => [m.id, m]));
    const { groups, untracked } = groupByTrackingId(fusionList);
    const built = [];
    for (const [, raws] of groups) built.push(buildLogicalTool(raws, metaByTracking));
    for (const raw of untracked) built.push(buildLogicalTool([raw], metaByTracking));
    const tools = derivePairings(
      combineToolsByToolId(built)
        .map(t => ({ ...t, library_id: 'demo', library_name: 'Demo library' })),
      components?.components || [],
    );
    // Tag demo holders with a single synthetic library so the picker grouping works.
    const taggedHolders = (holders || []).map(h => ({ ...h, _libraryId: 'demo', _libraryName: 'Demo holders' }));

    // Make the shared-file-backed helpers (vendor registry, default unit) resolve
    // against the demo data, just like loadTools does after a Drive load.
    setActiveVendorRegistry(vendorRegistry);
    if (shopSettings?.default_units) setDefaultUnit(shopSettings.default_units);

    dispatch({ type: 'ENTER_DEMO_MODE', tools, holders: taggedHolders, materials, vendorRegistry, shopSettings, jobs, components });
  }, []);

  const exitDemoMode = useCallback(() => {
    // Drop the ?demo=true query param so a reload returns to the normal app.
    try {
      window.history.replaceState({}, '', window.location.pathname + window.location.hash);
    } catch { /* ignore */ }
    dispatch({ type: 'EXIT_LOCAL_MODE' }); // resets to initialState (same as local mode)
  }, []);

  // Demo mode bootstrap: on mount, if ?demo=true, load bundled sample data.
  // Declared after enterDemoMode so its dependency isn't read before init (a
  // temporal-dead-zone ReferenceError here blanks the whole app on every load).
  useEffect(() => {
    if (isDemoRequested()) enterDemoMode();
  }, [enterDemoMode]);

  // ─── Tool data actions ────────────────────────────────────────────────────
  const loadTools = useCallback(async () => {
    // In demo mode there's nothing to fetch — re-seed the bundled sample data so
    // the TopBar refresh button is a harmless reload rather than a network error.
    if (demoModeRef.current) { enterDemoMode(); return; }
    dispatch({ type: 'LOAD_START' });
    try {
      let metaList = [];
      // Component records (holder body / insert) — refreshed from Drive below;
      // falls back to whatever is already in state (APS-only sessions).
      let componentsFile = componentsRef.current;
      // Resolve the registry FIRST (multi-library needs to know which libraries to
      // download before downloading). When Drive is connected, shop_settings.json
      // is the shared source of truth; otherwise we fall back to the registry
      // already seeded into state from the localStorage mirror / legacy keys.
      let effectiveShop = shopSettingsRef.current || DEFAULT_SHOP_SETTINGS;
      if (googleRef.current) {
        // Load metadata + the three shared Drive files (materials, vendor
        // registry, shop settings) in parallel. Each shared file is created with
        // its default content if it doesn't exist yet. A shared-file error never
        // blocks the library load — it falls back to the default.
        const { SHARED_FILES } = driveService;
        const sharedSafe = (key, def) =>
          driveService.loadOrCreateSharedJson(SHARED_FILES[key].name, SHARED_FILES[key].cacheKey, def)
            .catch(e => { if (e.code === 'TOKEN_EXPIRED') throw e; return def; });
        try {
          const [meta, materials, vendorRegistry, shopSettings, jobs, components] = await Promise.all([
            driveService.loadMetadata(),
            sharedSafe('materials', DEFAULT_MATERIALS),
            sharedSafe('vendorRegistry', DEFAULT_VENDOR_REGISTRY),
            sharedSafe('shopSettings', DEFAULT_SHOP_SETTINGS),
            sharedSafe('jobs', DEFAULT_JOBS),
            sharedSafe('components', DEFAULT_COMPONENTS),
          ]);
          metaList = meta;
          componentsFile = components;
          setActiveVendorRegistry(vendorRegistry);
          // shop_settings.json is the source of truth for the default unit —
          // mirror it into the localStorage cache the pure units helper reads.
          if (shopSettings?.default_units) setDefaultUnit(shopSettings.default_units);
          // Adopt the Drive registry. If Drive has no libraries yet but this device
          // does (legacy single-location / mirror), keep the local set and migrate
          // it up to Drive once, so an existing shop isn't emptied by the upgrade.
          let ss = shopSettings;
          if (!(ss.tool_libraries || []).length) {
            const seeded = seedShopSettingsRegistry(ss);
            if ((seeded.tool_libraries || []).length) {
              ss = seeded;
              driveService.saveSharedJson(SHARED_FILES.shopSettings.name, SHARED_FILES.shopSettings.cacheKey, ss).catch(() => {});
            }
          }
          effectiveShop = ss;
          saveRegistryMirror(ss);
          dispatch({ type: 'SET_SHARED_FILES', materials, vendorRegistry, shopSettings: ss, jobs, components });
          dispatch({ type: 'SET_LIBRARIES', shopSettings: ss }); // sync pointers
        } catch (err) {
          if (err.code === 'TOKEN_EXPIRED') {
            dispatch({ type: 'GOOGLE_EXPIRED' });
            // Continue — tools load without metadata; banner prompts reconnect
          } else {
            throw err;
          }
        }
      }
      const metaByTracking = new Map(metaList.map(m => [m.id, m]));

      // Warn if the linked metadata file is gone. A deleted file 404s; a TRASHED
      // file still reads/writes via the API, so without this check the app would
      // silently keep saving notes/photos into a file sitting in the trash. The
      // check is best-effort — never block the library load on it.
      if (googleRef.current) {
        try {
          const health = await driveService.getMetadataFileHealth();
          dispatch({
            type: 'METADATA_FILE_WARNING',
            warning: health.configured && health.missing ? 'missing'
              : health.configured && health.trashed ? 'trashed' : null,
          });
        } catch { /* inconclusive — leave any existing warning as-is */ }
      }

      // Fusion sync disabled (Fusion-decoupling Phase B): metadata is the whole
      // library. Build every tool from its metadata record — no Fusion download,
      // no library requirement, no holder load (holders are an APS/Fusion concept).
      // buildUnlinkedTool preserves each record's own no_fusion_link flag.
      const fusionEnabled = effectiveShop.integrations?.fusion?.enabled !== false;
      if (!fusionEnabled) {
        const built = metaList.map(m => buildUnlinkedTool(m));
        const paired = derivePairings(built, componentsFile?.components || []);
        const finalTools = backfillAsmNumbers(paired, effectiveShop, componentsFile);
        dispatch({ type: 'LOAD_SUCCESS', tools: finalTools, needsNormalize: false, normalizeCount: 0 });
        return;
      }

      // Download and build EACH linked tool library, tagging every tool with its
      // source library (library_id / library_name) so writes route back to the
      // right file and the landing page can filter/note by library. combine runs
      // WITHIN each library only (cross-library same-tool_id folding is avoided so
      // a tool always belongs to exactly one library).
      const toolLibs = effectiveShop.tool_libraries || [];
      if (toolLibs.length === 0) throw new Error('No tool library linked — add one in Settings');
      // Location systems drive the derived `location` display string: when a tool
      // has a structured tool_location, its display location is composed here (so
      // ToolDetail / search / Fusion-write all see a ready string); otherwise the
      // legacy free-text Fusion vendor string is left untouched.
      const locSystems = effectiveShop.location_config?.systems || [];
      const tools = [];
      let untrackedCount = 0;
      for (const lib of toolLibs) {
        const fusionList = await downloadFusionList(lib.id);
        const { groups, untracked } = groupByTrackingId(fusionList);
        const built = [];
        for (const [, raws] of groups) built.push(buildLogicalTool(raws, metaByTracking));
        for (const raw of untracked) built.push(buildLogicalTool([raw], metaByTracking));
        untrackedCount += untracked.length;
        const combined = combineToolsByToolId(built);
        for (const t of combined) {
          let extra = {};
          if (t.tool_location) {
            const sys = findSystem(locSystems, t.tool_location.system_id);
            const composed = sys ? resolveLocationString(t.tool_location, locSystems) : '';
            if (composed) extra = { location: composed, proshop_location: proShopLocationValue(sys, composed) };
          }
          tools.push({ ...t, library_id: lib.id, library_name: lib.fileName, ...extra });
        }
      }
      const needsNormalize = untrackedCount > 0;

      // Seed setup-progress flags once for libraries that already completed this
      // workflow before the setup guide existed — otherwise an established shop
      // would be told "you haven't done this yet" the first time they open the app.
      if (!setupSeededRef.current) {
        setupSeededRef.current = true;
        const normalized = !needsNormalize && tools.length > 0;
        const proshopMerged = tools.some(t => t.min_ooh != null && t.min_ooh > 0);
        const machineNumbers = tools.some(t => t.machine_tool_number != null && t.machine_tool_number > 0);
        const metadataConnected = googleRef.current;
        const established = normalized && proshopMerged;
        dispatch({ type: 'SET_SETUP_PROGRESS', progress: {
          fusionConnected: true,
          metadataConnected,
          // The three ID systems: an established shop already has Tool ID / Location
          // / Assembly schemes (all default to a working mode) — mark done so the
          // banner stays gone for an already-set-up library.
          toolIdConfigured: established,
          locationConfigured: established,
          assemblyIdConfigured: established,
          normalized,
          proshopMerged,
          machineNumbers,
          proshopExported: established,
        }});
        if (established) localStorage.setItem(SETUP_CELEBRATED_KEY, '1');
      }

      // No-Fusion tools (Fusion-decoupling Phase B): materialize any metadata
      // record EXPLICITLY marked unlinked (no_fusion_link) that no Fusion instance
      // represents. Orphan-ghost-guarded (see materializeUnlinkedTools) — a
      // tool deleted directly in Fusion leaves UNMARKED orphan metadata that stays
      // dormant. A no-op on today's data (marked tools still carry a Fusion
      // placeholder); activates once placeholder-minting retires / a tool is
      // created as no-Fusion. Runs before pairing/backfill so unlinked tools get
      // the same in-memory treatment as linked ones.
      const withUnlinked = materializeUnlinkedTools(tools, metaList);
      const pairedTools = derivePairings(withUnlinked, componentsFile?.components || []);
      // Assembly ID System: fill auto-mode asm_number in-memory for any assembly
      // missing one (deterministic; persisted lazily on the tool's next save).
      const finalTools = backfillAsmNumbers(pairedTools, effectiveShop, componentsFile);

      dispatch({ type: 'LOAD_SUCCESS', tools: finalTools, needsNormalize, normalizeCount: untrackedCount });
      // Load every holder library alongside tools (non-critical — failure of one
      // won't block). loadHolders tags each holder with its source library. Pass
      // the resolved registry explicitly — the SET_LIBRARIES dispatch above hasn't
      // updated shopSettingsRef yet this tick.
      try { await loadHolders(effectiveShop.holder_libraries || []); } catch { /* non-critical */ }
    } catch (err) {
      dispatch({ type: 'LOAD_ERROR', error: err.message });
    }
  }, [downloadFusionList, loadHolders, enterDemoMode]);

  // ─── Action factories ──────────────────────────────────────────────────────
  // The per-tool writes, bulk library operations, and attachment actions live in
  // sibling modules. Each factory gets dispatch/notify/IO + the render-synced
  // refs and returns plain async functions. Every injected value is stable
  // across renders (dispatch, refs, []-dep useCallbacks), so the memoized
  // action objects keep stable identities — consumers' effect deps stay quiet.
  const toolActions = useMemo(() => createToolActions({
    dispatch, notify,
    downloadFusionList, uploadFusionList, downloadAllLibraries, fetchRawLibrary,
    saveLocationConfig,
    toolsRef, holdersRef, shopSettingsRef, googleRef, componentsRef,
  }), [notify, downloadFusionList, uploadFusionList, downloadAllLibraries, fetchRawLibrary, saveLocationConfig]);

  const libraryOps = useMemo(() => createLibraryOps({
    dispatch, notify,
    uploadFusionList, downloadAllLibraries, markSetupStepInSettings,
    toolsRef, holdersRef, shopSettingsRef, googleRef, demoModeRef, materialsRef,
  }), [notify, uploadFusionList, downloadAllLibraries, markSetupStepInSettings]);

  const attachmentActions = useMemo(() => createAttachmentActions({
    dispatch, notify, markSetupStepInSettings,
    writeLogicalTool: toolActions.writeLogicalTool,
    toolsRef, googleRef,
  }), [notify, markSetupStepInSettings, toolActions]);

  const componentActions = useMemo(() => createComponentActions({
    dispatch, notify, googleRef, componentsRef, saveComponents,
  }), [notify, saveComponents]);

  const clearError = useCallback(() => dispatch({ type: 'CLEAR_ERROR' }), []);

  return (
    <AppContext.Provider value={{
      ...state,
      holderLibrarySetupComplete: !!state.holderLibraryLocation,
      // Whether the Fusion sync adapter is active (shop-wide). Off = tools live in
      // metadata only; writes are metadata-only and the load reads from metadata.
      fusionEnabled: state.shopSettings?.integrations?.fusion?.enabled !== false,
      // Default winner (D2) when a tool's app record and live Fusion differ. Only
      // pre-selects the drift-review choice (D3) — never a silent overwrite.
      fusionAuthority: state.shopSettings?.integrations?.fusion?.authority || 'fusion',
      setGoogleUser,
      skipMetadata,
      reconnectMetadata,
      disconnectMetadata,
      fetchMetadataLocation,
      dismissMetadataWarning,
      saveMaterials,
      saveVendorRegistry,
      saveShopSettings,
      saveJobs,
      saveComponents,
      findOrCreateJob,
      saveLocationConfig,
      markSetupStep,
      markSetupStepInSettings,
      registerNavGuard,
      maybeBlockNav,
      setupCelebrated,
      markSetupCelebrated,
      setLibraryLocation,
      clearLibraryLocation,
      beginChangeLibrary,
      cancelChangeLibrary,
      setHolderLibraryLocation,
      clearHolderLibraryLocation,
      // Multi-library registry actions
      persistRegistry,
      addToolLibrary,
      removeToolLibrary,
      setDefaultToolLibrary,
      addHolderLibrary,
      removeHolderLibrary,
      commitInitialLibraries,
      loadHolders,
      signOutAll,
      enterLocalMode,
      exitLocalMode,
      enterDemoMode,
      exitDemoMode,
      loadTools,
      fetchRawLibrary,
      // Per-tool writes, reconcile, assembly CRUD (toolActions.js)
      ...toolActions,
      // Bulk library operations (libraryOps.js)
      ...libraryOps,
      // Photos / attachments / ProShop photo import (attachmentActions.js)
      ...attachmentActions,
      // Holder body / insert component records (componentActions.js)
      ...componentActions,
      clearError,
      notify,
      dismissToast,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
