import { createContext, useContext, useReducer, useCallback, useEffect, useRef } from 'react';
import * as driveService from '../services/driveService.js';
import * as aps from '../services/apsService.js';
import {
  validateTool, generateId, generateAssemblyId, generateTrackingId,
  groupByTrackingId, buildLogicalTool, splitToFusionInstances, readTrackingId,
  getNextMachineNumber, generateMachineNumbers, applyMachineNumberToFusion,
  applyToolIdToFusion, fusionToolToInternal, mergeFusionAndMetadata, readOohFromFusion,
  combineToolsByToolId, buildMetadataTool,
} from '../schema/toolSchema.js';
import { composeToolId, nextSequential, isCounterMode } from '../utils/toolIdSystem.js';
import { composePresetName, opTypeWord, parsePresetName, materialNameCode, HOLE_MAKING_TYPES } from '../utils/presetNaming.js';
import { holderShortName } from '../utils/holderNaming.js';
import { classifyStrays } from '../services/reconcile.js';
import { DEFAULT_MATERIALS, DEFAULT_SHOP_SETTINGS } from '../schema/sharedDefaults.js';
import { DEFAULT_VENDOR_REGISTRY, setActiveVendorRegistry } from '../schema/vendorRegistry.js';
import { setDefaultUnit } from '../utils/units.js';
import { getDemoData, isDemoRequested } from '../demo/index.js';

const AppContext = createContext(null);

const LOCATION_KEY = 'aps_library_location';
const HOLDER_LOCATION_KEY = 'aps_holder_library_location';
// Multi-library registry mirror. The registry (linked tool + holder libraries +
// default-for-new-tools) is shop-wide in shop_settings.json on Drive, but is
// ALSO mirrored to localStorage so an APS-only session (Google Drive optional)
// still knows which libraries to load. The Drive copy wins when present; this
// cache is the fallback + the seed before Drive loads. Mirrors the existing
// default_units localStorage-mirroring pattern.
const REGISTRY_MIRROR_KEY = 'aps_library_registry';
const SETUP_PROGRESS_KEY = 'tms_setup_progress';
const SETUP_CELEBRATED_KEY = 'tms_setup_celebrated';

// The 5 steps of the initial setup/normalization/ProShop workflow, in order.
// Each is toggled on at the moment its triggering action happens — see
// setLibraryLocation, normalizeLibrary, and ImportFlow's merge/export buttons.
export const SETUP_STEPS = [
  { key: 'fusionConnected', label: 'Connect Fusion library' },
  { key: 'metadataConnected', label: 'Connect tool metadata (Google Drive)' },
  { key: 'normalized', label: 'Normalize the library' },
  { key: 'proshopMerged', label: 'Merge ProShop data' },
  { key: 'machineNumbers', label: 'Configure machine numbers' },
  { key: 'proshopExported', label: 'Export to ProShop' },
];

function loadStoredLocation() {
  try {
    const raw = localStorage.getItem(LOCATION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function loadStoredHolderLocation() {
  try {
    const raw = localStorage.getItem(HOLDER_LOCATION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ─── Multi-library registry helpers ─────────────────────────────────────────
// A library entry is an APS file location tagged with a stable `id` === itemId
// (the canonical library_id used to tag a tool's source and route its writes).
function locToLibEntry(loc, order = 0) {
  if (!loc?.itemId) return null;
  return {
    id: loc.itemId,
    hubId: loc.hubId, projectId: loc.projectId, folderId: loc.folderId,
    itemId: loc.itemId, fileName: loc.fileName,
    order,
  };
}

function loadRegistryMirror() {
  try {
    const raw = localStorage.getItem(REGISTRY_MIRROR_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveRegistryMirror(ss) {
  try {
    localStorage.setItem(REGISTRY_MIRROR_KEY, JSON.stringify({
      tool_libraries: ss.tool_libraries || [],
      holder_libraries: ss.holder_libraries || [],
      default_tool_library_id: ss.default_tool_library_id || null,
    }));
  } catch { /* ignore */ }
}

// The tool library a new/untagged tool writes to (default → first linked).
export function defaultToolLibraryId(ss) {
  const tl = ss?.tool_libraries || [];
  if (ss?.default_tool_library_id && tl.some(l => l.id === ss.default_tool_library_id)) {
    return ss.default_tool_library_id;
  }
  return tl[0]?.id || null;
}

// The "primary" tool library location — kept mirrored to state.libraryLocation so
// App.jsx routing (which gates on libraryLocation) is unchanged by multi-library.
function primaryToolLib(ss) {
  const tl = ss?.tool_libraries || [];
  const id = defaultToolLibraryId(ss);
  return tl.find(l => l.id === id) || tl[0] || null;
}

// Fill a shop_settings object's registry from the localStorage mirror, then the
// legacy single-location keys — so an established single-library shop (or an
// APS-only session) keeps working with no Drive write and no data migration.
function seedShopSettingsRegistry(ss) {
  let tool_libraries = ss?.tool_libraries || [];
  let holder_libraries = ss?.holder_libraries || [];
  let default_tool_library_id = ss?.default_tool_library_id || null;

  if (tool_libraries.length === 0) {
    const mirror = loadRegistryMirror();
    if (mirror?.tool_libraries?.length) {
      tool_libraries = mirror.tool_libraries;
      default_tool_library_id = default_tool_library_id || mirror.default_tool_library_id || null;
    }
    if (holder_libraries.length === 0 && mirror?.holder_libraries?.length) {
      holder_libraries = mirror.holder_libraries;
    }
  }
  if (tool_libraries.length === 0) {
    const legacy = locToLibEntry(loadStoredLocation());
    if (legacy) { tool_libraries = [legacy]; default_tool_library_id = default_tool_library_id || legacy.id; }
  }
  if (holder_libraries.length === 0) {
    const legacyH = locToLibEntry(loadStoredHolderLocation());
    if (legacyH) holder_libraries = [legacyH];
  }
  if (!default_tool_library_id && tool_libraries.length) default_tool_library_id = tool_libraries[0].id;

  return { ...ss, tool_libraries, holder_libraries, default_tool_library_id };
}

function loadSetupProgress() {
  try {
    const raw = localStorage.getItem(SETUP_PROGRESS_KEY);
    const progress = raw ? JSON.parse(raw) : null;
    // Migration: a shop that finished the workflow before later steps were added
    // has all its old flags true but is missing the newer keys. Back-fill them on
    // an established library (proshopExported true) so the banner goes away and the
    // celebration modal fires correctly on upgrade. Covers 'machineNumbers' (4→5
    // step upgrade) and 'metadataConnected' (5→6 step upgrade — if they got to
    // export they had a metadata file).
    if (progress && progress.proshopExported) {
      let changed = false;
      if (progress.machineNumbers === undefined) { progress.machineNumbers = true; changed = true; }
      if (progress.metadataConnected === undefined) { progress.metadataConnected = true; changed = true; }
      if (changed) localStorage.setItem(SETUP_PROGRESS_KEY, JSON.stringify(progress));
    }
    return progress;
  } catch { return null; }
}

// Seed the registry (linked tool/holder libraries) from the localStorage mirror /
// legacy single-location keys so the very first render — before any Drive load —
// already knows which libraries exist.
const SEEDED_SHOP_SETTINGS = seedShopSettingsRegistry(DEFAULT_SHOP_SETTINGS);

const initialState = {
  demoMode: false,            // ?demo=true — bundled sample data, no auth, read-only
  localMode: false,           // browsing a locally-uploaded library file — read-only, no APS/Drive
  user: null,                 // Google user (metadata identity) or null
  apsAuthenticated: false,    // Autodesk signed in
  googleAuthenticated: false, // Google signed in (metadata)
  googleExpired: false,       // token expired while in-app (reconnect banner shown)
  metadataSkipped: false,     // user chose to proceed without Drive metadata
  metadataForceNew: false,    // user explicitly disconnected to set up a brand-new file —
                              // skip the "does a file already exist" check and go straight
                              // to the folder picker (e.g. after deleting the old file in Drive)
  // Convenience pointer to the PRIMARY (default) tool library — kept in sync with
  // the multi-library registry (shopSettings.tool_libraries) so App.jsx routing,
  // which gates on libraryLocation, is unchanged. The real source of truth is the
  // registry; this is just "the first/default one".
  libraryLocation: primaryToolLib(SEEDED_SHOP_SETTINGS),
  changingLibrary: false,     // transient: showing the library picker to switch, with Cancel
  holderLibraryLocation: (SEEDED_SHOP_SETTINGS.holder_libraries || [])[0] || null, // pointer to first holder lib
  setupProgress: loadSetupProgress() || {}, // { fusionConnected, normalized, proshopMerged, proshopExported }
  processingAuth: false,      // exchanging APS callback code
  tools: [],
  holders: [],                // loaded from Master-Holder library/libraries (tagged with _libraryId/_libraryName)
  needsNormalize: false,      // true when any tool lacks a tracking ID (pre-migration)
  normalizeCount: 0,          // number of un-migrated tools (for banner/modal copy)
  metadataFileWarning: null,  // null | 'missing' | 'trashed' — linked metadata file is gone
  // Shared Drive files (loaded at startup; default to the seeds until then).
  materials: DEFAULT_MATERIALS,
  vendorRegistry: DEFAULT_VENDOR_REGISTRY,
  shopSettings: SEEDED_SHOP_SETTINGS,
  isLoading: false,
  isSaving: false,
  error: null,
  toasts: [],                 // [{ id, type, message }]
};

function reducer(state, action) {
  switch (action.type) {
    case 'AUTH_START': return { ...state, processingAuth: true, error: null };
    case 'APS_AUTHED': return { ...state, processingAuth: false, apsAuthenticated: true };
    case 'AUTH_ERROR': return { ...state, processingAuth: false, error: action.error };
    case 'SET_GOOGLE_USER':
      return { ...state, user: action.user, googleAuthenticated: true, googleExpired: false, metadataForceNew: false };
    case 'GOOGLE_EXPIRED':
      return { ...state, googleExpired: true };
    case 'SKIP_METADATA': return { ...state, metadataSkipped: true };
    case 'RECONNECT_METADATA': return { ...state, metadataSkipped: false };
    case 'DISCONNECT_METADATA':
      return { ...state, user: null, googleAuthenticated: false, googleExpired: false, metadataSkipped: false, metadataForceNew: true };
    // Multi-library registry write: update shopSettings' library arrays and
    // re-derive the convenience pointers (primary tool lib + first holder lib).
    case 'SET_LIBRARIES': {
      const ss = action.shopSettings;
      const tl = ss.tool_libraries || [];
      const hl = ss.holder_libraries || [];
      return {
        ...state,
        shopSettings: ss,
        libraryLocation: primaryToolLib(ss),
        holderLibraryLocation: hl[0] || null,
        changingLibrary: false,
        ...(tl.length === 0 ? { tools: [] } : {}),
      };
    }
    case 'START_CHANGE_LIBRARY': return { ...state, changingLibrary: true };
    case 'CANCEL_CHANGE_LIBRARY': return { ...state, changingLibrary: false };
    case 'SET_HOLDERS': return { ...state, holders: action.holders };
    case 'SET_SETUP_PROGRESS': return { ...state, setupProgress: action.progress };
    case 'MARK_SETUP_STEP':
      if (state.setupProgress[action.key]) return state; // already done — no-op
      return { ...state, setupProgress: { ...state.setupProgress, [action.key]: true } };
    case 'SIGN_OUT':
      return {
        ...initialState,
        libraryLocation: state.libraryLocation, // keep saved location across sign-out
        holderLibraryLocation: state.holderLibraryLocation,
      };
    case 'ENTER_LOCAL_MODE':
      return { ...state, localMode: true, tools: action.tools, needsNormalize: false, error: null };
    case 'ENTER_DEMO_MODE':
      return {
        ...state,
        demoMode: true,
        tools: action.tools,
        holders: action.holders,
        materials: action.materials,
        vendorRegistry: action.vendorRegistry,
        shopSettings: action.shopSettings,
        needsNormalize: false,
        metadataFileWarning: null,
        isLoading: false,
        error: null,
      };
    case 'EXIT_LOCAL_MODE':
      return {
        ...initialState,
        libraryLocation: state.libraryLocation,
        holderLibraryLocation: state.holderLibraryLocation,
      };
    case 'LOAD_START': return { ...state, isLoading: true, error: null };
    case 'LOAD_SUCCESS': return { ...state, isLoading: false, tools: action.tools, needsNormalize: !!action.needsNormalize, normalizeCount: action.normalizeCount ?? 0 };
    case 'LOAD_ERROR': return { ...state, isLoading: false, error: action.error };
    case 'SAVE_START': return { ...state, isSaving: true, error: null };
    case 'SAVE_SUCCESS': return { ...state, isSaving: false };
    case 'SAVE_ERROR': return { ...state, isSaving: false, error: action.error };
    case 'ADD_TOOL': return { ...state, tools: [...state.tools, action.tool] };
    case 'UPDATE_TOOL':
      return { ...state, tools: state.tools.map(t => t.id === action.tool.id ? action.tool : t) };
    case 'DELETE_TOOL':
      return { ...state, tools: state.tools.filter(t => t.id !== action.id) };
    case 'SET_TOOLS': return { ...state, tools: action.tools, ...(action.needsNormalize !== undefined ? { needsNormalize: action.needsNormalize } : {}), ...(action.normalizeCount !== undefined ? { normalizeCount: action.normalizeCount } : {}) };
    case 'METADATA_FILE_WARNING': return { ...state, metadataFileWarning: action.warning };
    case 'SET_SHARED_FILES':
      return { ...state, materials: action.materials, vendorRegistry: action.vendorRegistry, shopSettings: action.shopSettings };
    case 'SET_MATERIALS': return { ...state, materials: action.materials };
    case 'SET_VENDOR_REGISTRY': return { ...state, vendorRegistry: action.vendorRegistry };
    case 'SET_SHOP_SETTINGS': return { ...state, shopSettings: action.shopSettings };
    case 'CLEAR_ERROR': return { ...state, error: null };
    case 'ADD_TOAST': return { ...state, toasts: [...state.toasts, action.toast] };
    case 'DISMISS_TOAST': return { ...state, toasts: state.toasts.filter(t => t.id !== action.id) };
    default: return state;
  }
}

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

  // Machine-number start/skip come from shop_settings.json (falling back to the
  // built-in defaults baked into the schema functions when unset).
  const machineNumberArgs = () => {
    const mn = shopSettingsRef.current?.machine_number;
    return [mn?.start ?? undefined, mn?.skip ?? undefined];
  };
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
  const saveSharedFile = useCallback(async (key, data, dispatchType, onSaved) => {
    const { SHARED_FILES } = driveService;
    // Demo mode: update in-memory state only (no Drive write, no Google guard) so
    // the sandbox can edit shop settings / materials / vendors — lost on refresh.
    if (demoModeRef.current) {
      onSaved?.(data);
      dispatch({ type: dispatchType, [key === 'shopSettings' ? 'shopSettings' : key === 'vendorRegistry' ? 'vendorRegistry' : 'materials']: data });
      return;
    }
    if (!googleRef.current) { notify('Connect Google Drive to save', 'error'); throw new Error('Google Drive not connected'); }
    try {
      await driveService.saveSharedJson(SHARED_FILES[key].name, SHARED_FILES[key].cacheKey, data);
      onSaved?.(data);
      dispatch({ type: dispatchType, [key === 'shopSettings' ? 'shopSettings' : key === 'vendorRegistry' ? 'vendorRegistry' : 'materials']: data });
    } catch (err) {
      if (err.code === 'TOKEN_EXPIRED') dispatch({ type: 'GOOGLE_EXPIRED' });
      notify(`Save failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  }, [notify]);

  const saveMaterials = useCallback((materials) =>
    saveSharedFile('materials', materials, 'SET_MATERIALS'), [saveSharedFile]);
  const saveVendorRegistry = useCallback((vendorRegistry) =>
    saveSharedFile('vendorRegistry', vendorRegistry, 'SET_VENDOR_REGISTRY', setActiveVendorRegistry), [saveSharedFile]);
  const saveShopSettings = useCallback((shopSettings) =>
    saveSharedFile('shopSettings', shopSettings, 'SET_SHOP_SETTINGS'), [saveSharedFile]);

  // Marks one step of the setup guide as complete (idempotent — see MARK_SETUP_STEP).
  const markSetupStep = useCallback((key) => dispatch({ type: 'MARK_SETUP_STEP', key }), []);

  // Like markSetupStep but also stamps a timestamp in shop_settings.json on Drive
  // (shared across devices). Falls back gracefully if Google Drive is not connected.
  const markSetupStepInSettings = useCallback((key) => {
    dispatch({ type: 'MARK_SETUP_STEP', key });
    if (!googleRef.current) return;
    const current = shopSettingsRef.current || {};
    const updated = {
      ...current,
      setup_steps: { ...(current.setup_steps || {}), [key]: new Date().toISOString() },
    };
    // Optimistic dispatch so shopSettings state is immediately current — prevents
    // a concurrent saveShop() read racing against the in-flight Drive write and
    // overwriting the timestamp with a stale shopSettings value.
    dispatch({ type: 'SET_SHOP_SETTINGS', shopSettings: updated });
    const { SHARED_FILES } = driveService;
    driveService.saveSharedJson(SHARED_FILES.shopSettings.name, SHARED_FILES.shopSettings.cacheKey, updated)
      .catch(() => {}); // silently ignore — localStorage flag + optimistic state already set
  }, []);

  // The metadataConnected setup step completes the moment Google Drive is
  // connected (live sign-in or a restored session). Declarative so it fires
  // for both paths without threading a call through every Google entry point.
  useEffect(() => {
    if (state.googleAuthenticated && !state.setupProgress.metadataConnected) {
      markSetupStepInSettings('metadataConnected');
    }
  }, [state.googleAuthenticated, state.setupProgress.metadataConnected, markSetupStepInSettings]);

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
      const tools = combineToolsByToolId(built)
        .map(t => ({ ...t, library_id: 'local', library_name: file.name || 'Local file' }));

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
    const { fusionList, metaList, holders, materials, vendorRegistry, shopSettings } = getDemoData();
    // Build logical tools through the exact same pipeline as a live load.
    const metaByTracking = new Map(metaList.map(m => [m.id, m]));
    const { groups, untracked } = groupByTrackingId(fusionList);
    const built = [];
    for (const [, raws] of groups) built.push(buildLogicalTool(raws, metaByTracking));
    for (const raw of untracked) built.push(buildLogicalTool([raw], metaByTracking));
    const tools = combineToolsByToolId(built)
      .map(t => ({ ...t, library_id: 'demo', library_name: 'Demo library' }));
    // Tag demo holders with a single synthetic library so the picker grouping works.
    const taggedHolders = (holders || []).map(h => ({ ...h, _libraryId: 'demo', _libraryName: 'Demo holders' }));

    // Make the shared-file-backed helpers (vendor registry, default unit) resolve
    // against the demo data, just like loadTools does after a Drive load.
    setActiveVendorRegistry(vendorRegistry);
    if (shopSettings?.default_units) setDefaultUnit(shopSettings.default_units);

    dispatch({ type: 'ENTER_DEMO_MODE', tools, holders: taggedHolders, materials, vendorRegistry, shopSettings });
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
          const [meta, materials, vendorRegistry, shopSettings] = await Promise.all([
            driveService.loadMetadata(),
            sharedSafe('materials', DEFAULT_MATERIALS),
            sharedSafe('vendorRegistry', DEFAULT_VENDOR_REGISTRY),
            sharedSafe('shopSettings', DEFAULT_SHOP_SETTINGS),
          ]);
          metaList = meta;
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
          dispatch({ type: 'SET_SHARED_FILES', materials, vendorRegistry, shopSettings: ss });
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

      // Download and build EACH linked tool library, tagging every tool with its
      // source library (library_id / library_name) so writes route back to the
      // right file and the landing page can filter/note by library. combine runs
      // WITHIN each library only (cross-library same-tool_id folding is avoided so
      // a tool always belongs to exactly one library).
      const toolLibs = effectiveShop.tool_libraries || [];
      if (toolLibs.length === 0) throw new Error('No tool library linked — add one in Settings');
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
        for (const t of combined) tools.push({ ...t, library_id: lib.id, library_name: lib.fileName });
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
          normalized,
          proshopMerged,
          machineNumbers,
          proshopExported: established,
        }});
        if (established) localStorage.setItem(SETUP_CELEBRATED_KEY, '1');
      }

      dispatch({ type: 'LOAD_SUCCESS', tools, needsNormalize, normalizeCount: untrackedCount });
      // Load every holder library alongside tools (non-critical — failure of one
      // won't block). loadHolders tags each holder with its source library. Pass
      // the resolved registry explicitly — the SET_LIBRARIES dispatch above hasn't
      // updated shopSettingsRef yet this tick.
      try { await loadHolders(effectiveShop.holder_libraries || []); } catch { /* non-critical */ }
    } catch (err) {
      dispatch({ type: 'LOAD_ERROR', error: err.message });
    }
  }, [downloadFusionList, loadHolders, enterDemoMode]);

  // ─── Core write: reconcile a logical tool's instances into the library ────
  // A logical tool maps to N Fusion entries (one per assembly). This drops every
  // current entry carrying the tool's tracking ID and appends the freshly
  // computed instance set, in a single library write. Always re-downloads first
  // (per the re-download-before-write invariant) and refreshes each instance's
  // raw Fusion data so a teammate's untouched fields survive. Returns the
  // normalized tool with stable assembly ids and refreshed _instancesRaw.
  const writeLogicalTool = useCallback(async (tool) => {
    const holders = holdersRef.current || [];
    const tracking_id = tool.tracking_id || generateTrackingId();
    // Route this tool's read+write to the library it belongs to (multi-library).
    // A new/untagged tool goes to the configured default library.
    const library_id = tool.library_id || defaultToolLibraryId(shopSettingsRef.current);
    const library_name = tool.library_name
      || (shopSettingsRef.current?.tool_libraries || []).find(l => l.id === library_id)?.fileName
      || tool.library_name;

    // Ensure at least one assembly, and stable ids on every assembly.
    const baseAssemblies = (tool.assemblies && tool.assemblies.length > 0)
      ? tool.assemblies
      : [{
          holder_guid: tool.selected_holder_guid || null,
          holder_description: '',
          ooh: tool.ooh ?? null,
          source: 'manual',
          created_at: new Date().toISOString(),
        }];
    const assemblies = baseAssemblies.map(a => ({
      ...a,
      assembly_id: a.assembly_id || generateAssemblyId(),
      instance_guid: a.instance_guid || generateId(),
    }));

    const fusionList = await downloadFusionList(library_id);
    const freshByGuid = new Map(fusionList.map(f => [f.guid, f]));
    const refreshedRaws = assemblies.map(a => freshByGuid.get(a.instance_guid)).filter(Boolean);

    const toWrite = {
      ...tool,
      tracking_id,
      library_id,
      library_name,
      assemblies,
      _instancesRaw: refreshedRaws,
      _fusionRaw: refreshedRaws[0] || tool._fusionRaw || null,
    };

    const { fusionInstances, metadataTool } = splitToFusionInstances(toWrite, holders);

    // Drop every entry this logical tool owns before re-appending the fresh set:
    // its tracking ID, plus any guid carried by an assembly or absorbed raw
    // instance. The guid sweep removes leftovers from entries that were combined
    // in (e.g. same-ProShop duplicates that previously had a different/no
    // tracking ID), so no orphans remain in the library.
    const dropGuids = new Set();
    for (const a of assemblies) if (a.instance_guid) dropGuids.add(a.instance_guid);
    for (const r of (tool._instancesRaw || [])) if (r?.guid) dropGuids.add(r.guid);

    const next = fusionList
      .filter(f => readTrackingId(f) !== tracking_id && !dropGuids.has(f.guid))
      .concat(fusionInstances);

    await uploadFusionList(library_id, next);
    if (googleRef.current) {
      try {
        await driveService.upsertMetadata(metadataTool);
      } catch (err) {
        if (err.code === 'TOKEN_EXPIRED') dispatch({ type: 'GOOGLE_EXPIRED' });
        throw err; // Still fail the save so the user knows metadata didn't persist
      }
    }

    return { ...toWrite, _instancesRaw: fusionInstances, _fusionRaw: fusionInstances[0] };
  }, [downloadFusionList, uploadFusionList]);

  const saveTool = useCallback(async (tool) => {
    const { valid, errors } = validateTool(tool);
    if (!valid) throw new Error(errors.join(', '));

    dispatch({ type: 'SAVE_START' });
    try {
      const updated = await writeLogicalTool({ ...tool, updated_at: new Date().toISOString() });
      dispatch({ type: 'UPDATE_TOOL', tool: updated });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify('Saved to Fusion library', 'success');
      return updated;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Save failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  }, [writeLogicalTool, notify]);

  const addTool = useCallback(async (tool) => {
    const { valid, errors } = validateTool(tool);
    if (!valid) throw new Error(errors.join(', '));

    const now = new Date().toISOString();

    dispatch({ type: 'SAVE_START' });
    try {
      // Auto-combine: if a tool with this ProShop number already exists, fold the
      // new entry into it instead of creating a duplicate logical tool. The
      // ProShop number alone decides identity — no other field is checked.
      const pid = String(tool.tool_id || '').trim();
      const existingDup = pid
        ? toolsRef.current.find(t => String(t.tool_id || '').trim() === pid)
        : null;
      if (existingDup) {
        const combined = combineToolsByToolId([
          existingDup,
          { ...tool, tracking_id: null, id: undefined },
        ])[0];
        const written = await writeLogicalTool({ ...combined, updated_at: now });
        dispatch({ type: 'UPDATE_TOOL', tool: written });
        dispatch({ type: 'SAVE_SUCCESS' });
        notify(`Combined with existing tool sharing ProShop ${pid}`, 'success');
        return written;
      }

      // Machine tool numbers are shop-global, so gather used numbers across EVERY
      // linked library (plus the in-memory tools) before picking the next free one.
      const usedNumbers = new Set();
      const allLibs = await downloadAllLibraries();
      for (const { list } of allLibs) {
        for (const f of list) {
          const n = f['post-process']?.number;
          if (n !== null && n !== undefined && n !== '') usedNumbers.add(Number(n));
        }
      }
      for (const t of toolsRef.current) {
        const n = t.machine_tool_number;
        if (n !== null && n !== undefined && n !== '') usedNumbers.add(Number(n));
      }

      const tracking_id = generateTrackingId();
      // Destination library: the picker's choice (tool.library_id) or the default.
      const library_id = tool.library_id || defaultToolLibraryId(shopSettingsRef.current);
      const created = {
        ...tool,
        id: tracking_id,
        tracking_id,
        library_id,
        machine_tool_number: getNextMachineNumber([...usedNumbers], ...machineNumberArgs()),
        created_at: tool.created_at || now,
        updated_at: now,
      };

      const written = await writeLogicalTool(created);
      dispatch({ type: 'ADD_TOOL', tool: written });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify('Tool added to library', 'success');
      return written;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Add failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  }, [downloadAllLibraries, writeLogicalTool, notify]);

  // Duplicate an existing tool as a starting point for a new one.
  const cloneTool = useCallback(async (id) => {
    const source = toolsRef.current.find(t => t.id === id);
    if (!source) throw new Error('Tool not found');
    const now = new Date().toISOString();
    const copy = {
      ...source,
      id: generateId(),
      tracking_id: null,        // addTool assigns a fresh tracking ID
      // Clear the ProShop ID — keeping it would make addTool's auto-combine
      // (combineToolsByToolId) fold this copy straight back into the source,
      // so the "duplicate" would never actually appear as its own tool.
      tool_id: '',
      description: `${source.description || 'Tool'} (copy)`,
      _fusionRaw: undefined,
      _instancesRaw: undefined,
      // Carrying the source's _registeredAssemblies forward would make
      // reconcile-on-open compare the copy's brand-new instances against the
      // SOURCE's registered (holder, OOH) pairs — since the clone keeps the
      // same holder/OOH values, its own fresh instances would match and get
      // flagged as "duplicate" of themselves. Clearing it lets the next load
      // rebuild it correctly from this tool's own metadata.
      _registeredAssemblies: undefined,
      // Keep the holder/OOH of each assembly but force fresh instance + assembly
      // ids so the copy gets its own Fusion entries.
      assemblies: (source.assemblies || []).map(a => ({
        ...a, assembly_id: undefined, instance_guid: undefined,
      })),
      machine_tool_number: null, // assign a fresh number on save — never reuse the source's
      merge_history: [],
      created_at: now,
      updated_at: now,
    };
    return addTool(copy);
  }, [addTool]);

  // Merge selected job-tool fields back into a master tool with history tracking.
  // presetChanges: Array<{ masterPresetGuid, incomingPreset, selectedFields: Set }>
  // presetsToAdd:  Array<presetObject> — new presets to append
  const mergeTool = useCallback(async (masterTool, mergedFields, revisionNote, mergedBy, presetChanges = [], presetsToAdd = [], assemblyUpdate = null) => {
    dispatch({ type: 'SAVE_START' });
    try {
      const previousValues = {};
      for (const field of Object.keys(mergedFields)) {
        previousValues[field] = masterTool[field];
      }
      const historyEntry = {
        merged_at: new Date().toISOString(),
        merged_by: mergedBy || 'unknown',
        fields_changed: Object.keys(mergedFields),
        revision_note: revisionNote,
        previous_values: previousValues,
        ...(presetChanges.length > 0 ? {
          presets_changed: presetChanges.map(c => ({
            preset_name: c.incomingPreset?.name || '?',
            fields: [...c.selectedFields],
          })),
        } : {}),
        ...(presetsToAdd.length > 0 ? {
          presets_added: presetsToAdd.map(p => p.name || 'Unnamed'),
        } : {}),
      };
      let updated = {
        ...masterTool,
        ...mergedFields,
        updated_at: new Date().toISOString(),
        updated_by: mergedBy || '',
        revision_notes: revisionNote,
        merge_history: [...(masterTool.merge_history || []), historyEntry],
      };

      // Apply preset field patches and append new presets
      if (presetChanges.length > 0 || presetsToAdd.length > 0) {
        const updatedPresets = (updated.presets || []).map(p => {
          const change = presetChanges.find(c => c.masterPresetGuid === p.guid);
          if (!change || change.selectedFields.size === 0) return p;
          const patch = {};
          for (const f of change.selectedFields) patch[f] = change.incomingPreset[f];
          return { ...p, ...patch };
        });
        for (const preset of presetsToAdd) {
          updatedPresets.push({ ...preset }); // preserve incoming guid (used for assembly linking)
        }
        updated.presets = updatedPresets;
        // Keep flat speed/feed fields in sync with first preset
        if (updatedPresets.length > 0) {
          const p0 = updatedPresets[0];
          updated.spindle_speed  = p0.n     ?? updated.spindle_speed;
          updated.cutting_feedrate = p0.v_f ?? updated.cutting_feedrate;
          updated.feed_per_tooth = p0.f_z   ?? updated.feed_per_tooth;
          updated.plunge_feedrate = p0.v_f_plunge ?? updated.plunge_feedrate;
          updated.lead_in_feedrate = p0.v_f_leadIn ?? updated.lead_in_feedrate;
          updated.lead_out_feedrate = p0.v_f_leadOut ?? updated.lead_out_feedrate;
          updated.feed_per_rev = p0.f_n     ?? updated.feed_per_rev;
          updated.cutting_speed = p0.v_c    ?? updated.cutting_speed;
        }
      }

      // Apply assembly create/link update (metadata only — included in the same write)
      if (assemblyUpdate) {
        const assemblies = [...(updated.assemblies || [])];
        if (assemblyUpdate.type === 'create') {
          assemblies.push(assemblyUpdate.assembly);
        } else if (assemblyUpdate.type === 'link') {
          const i = assemblies.findIndex(a => a.assembly_id === assemblyUpdate.assembly.assembly_id);
          if (i >= 0) assemblies[i] = assemblyUpdate.assembly;
        }
        updated.assemblies = assemblies;
      }

      const written = await writeLogicalTool(updated);
      dispatch({ type: 'UPDATE_TOOL', tool: written });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify('Merged job values to master library', 'success');
      return written;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Merge failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  }, [writeLogicalTool, notify]);

  const deleteTool = useCallback(async (id) => {
    dispatch({ type: 'SAVE_START' });
    try {
      const tool = toolsRef.current.find(t => t.id === id);
      const tid = tool?.tracking_id || id;
      const library_id = tool?.library_id || defaultToolLibraryId(shopSettingsRef.current);
      const fusionList = await downloadFusionList(library_id);
      let remaining;
      if (tool?.tracking_id) {
        // Delete every instance carrying this tracking ID.
        remaining = fusionList.filter(f => readTrackingId(f) !== tid);
      } else {
        // Legacy untracked tool — delete by its instance guids.
        const guids = new Set((tool?._instancesRaw || []).map(r => r.guid).concat([id]));
        remaining = fusionList.filter(f => !guids.has(f.guid));
      }
      await uploadFusionList(library_id, remaining);
      if (googleRef.current) await driveService.deleteMetadata(tid);
      dispatch({ type: 'DELETE_TOOL', id });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify('Tool deleted', 'success');
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Delete failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  }, [downloadFusionList, uploadFusionList, notify]);

  // ─── Assembly CRUD (each assembly = one Fusion instance) ──────────────────
  const addAssembly = useCallback(async (toolId, assembly) => {
    const tool = toolsRef.current.find(t => t.id === toolId);
    if (!tool) throw new Error('Tool not found');
    dispatch({ type: 'SAVE_START' });
    try {
      const next = {
        ...tool,
        assemblies: [...(tool.assemblies || []), {
          ...assembly,
          assembly_id: generateAssemblyId(),
          instance_guid: generateId(),
          source: assembly.source || 'manual',
          created_at: new Date().toISOString(),
        }],
        updated_at: new Date().toISOString(),
      };
      const written = await writeLogicalTool(next);
      dispatch({ type: 'UPDATE_TOOL', tool: written });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify('Assembly added — new tool instance created', 'success');
      return written;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Add assembly failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  }, [writeLogicalTool, notify]);

  const updateAssembly = useCallback(async (toolId, assemblyId, patch) => {
    const tool = toolsRef.current.find(t => t.id === toolId);
    if (!tool) throw new Error('Tool not found');
    dispatch({ type: 'SAVE_START' });
    try {
      const assemblies = (tool.assemblies || []).map(a =>
        a.assembly_id === assemblyId ? { ...a, ...patch } : a);
      const written = await writeLogicalTool({ ...tool, assemblies, updated_at: new Date().toISOString() });
      dispatch({ type: 'UPDATE_TOOL', tool: written });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify('Assembly updated', 'success');
      return written;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Update assembly failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  }, [writeLogicalTool, notify]);

  const deleteAssembly = useCallback(async (toolId, assemblyId) => {
    const tool = toolsRef.current.find(t => t.id === toolId);
    if (!tool) throw new Error('Tool not found');
    if ((tool.assemblies || []).length <= 1) {
      throw new Error('A tool must keep at least one assembly. Delete the tool instead.');
    }
    dispatch({ type: 'SAVE_START' });
    try {
      const assemblies = tool.assemblies.filter(a => a.assembly_id !== assemblyId);
      const written = await writeLogicalTool({ ...tool, assemblies, updated_at: new Date().toISOString() });
      dispatch({ type: 'UPDATE_TOOL', tool: written });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify('Assembly removed — tool instance deleted', 'success');
      return written;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Delete assembly failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  }, [writeLogicalTool, notify]);

  // ─── Tool file attachments (Google Drive storage) ─────────────────────────

  const uploadToolPhoto = useCallback(async (tool, file, fileName) => {
    if (!googleRef.current) {
      notify('Connect Google Drive to upload photos', 'error');
      throw new Error('Google Drive not connected');
    }
    dispatch({ type: 'SAVE_START' });
    try {
      const trackingId = tool.tracking_id || tool.id;
      const folderId = await driveService.ensureToolFolder(trackingId);
      const driveFile = await driveService.uploadToolFile(folderId, file, fileName);
      const updatedTool = { ...tool, primary_photo_id: driveFile.id, primary_photo_name: fileName };
      const result = await writeLogicalTool({ ...updatedTool, updated_at: new Date().toISOString() });
      dispatch({ type: 'UPDATE_TOOL', tool: result });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify('Photo saved', 'success');
      return result;
    } catch (err) {
      if (err.code === 'TOKEN_EXPIRED') dispatch({ type: 'GOOGLE_EXPIRED' });
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Photo upload failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  }, [writeLogicalTool, notify]);

  const uploadToolAttachment = useCallback(async (tool, file, fileName, fileType) => {
    if (!googleRef.current) {
      notify('Connect Google Drive to upload files', 'error');
      throw new Error('Google Drive not connected');
    }
    dispatch({ type: 'SAVE_START' });
    try {
      const trackingId = tool.tracking_id || tool.id;
      const folderId = await driveService.ensureToolFolder(trackingId);
      const driveFile = await driveService.uploadToolFile(folderId, file, fileName);
      const newAttachment = {
        file_id: driveFile.id,
        filename: fileName,
        type: fileType || 'other',
        uploaded_at: new Date().toISOString(),
      };
      const updatedTool = { ...tool, attachments: [...(tool.attachments || []), newAttachment] };
      const result = await writeLogicalTool({ ...updatedTool, updated_at: new Date().toISOString() });
      dispatch({ type: 'UPDATE_TOOL', tool: result });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify('File saved', 'success');
      return result;
    } catch (err) {
      if (err.code === 'TOKEN_EXPIRED') dispatch({ type: 'GOOGLE_EXPIRED' });
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`File upload failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  }, [writeLogicalTool, notify]);

  const deleteToolAttachment = useCallback(async (tool, fileId, isPrimary = false) => {
    if (!googleRef.current) {
      notify('Connect Google Drive to manage files', 'error');
      throw new Error('Google Drive not connected');
    }
    try {
      await driveService.deleteToolFile(fileId);
    } catch (err) {
      if (err.code === 'TOKEN_EXPIRED') {
        dispatch({ type: 'GOOGLE_EXPIRED' });
        notify('Google Drive session expired — reconnect to remove the file from storage', 'error', 7000);
        throw err;
      }
      // Real Drive error (deleteToolFile already swallows 404 internally, so this
      // is a genuine failure). Abort — do not wipe metadata for a file that still
      // exists in Drive, which would orphan it with no way to recover.
      notify(`Could not delete file from Drive: ${err.message}`, 'error', 7000);
      throw err;
    }
    dispatch({ type: 'SAVE_START' });
    try {
      const updatedTool = isPrimary
        ? { ...tool, primary_photo_id: null, primary_photo_name: null }
        : { ...tool, attachments: (tool.attachments || []).filter(a => a.file_id !== fileId) };
      const result = await writeLogicalTool({ ...updatedTool, updated_at: new Date().toISOString() });
      dispatch({ type: 'UPDATE_TOOL', tool: result });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify('File removed', 'success');
      return result;
    } catch (err) {
      if (err.code === 'TOKEN_EXPIRED') dispatch({ type: 'GOOGLE_EXPIRED' });
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Remove failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  }, [writeLogicalTool, notify]);

  // ─── One-time: import ProShop tool photos from a Drive folder ─────────────
  // The picked folder holds one main photo file PER TOOL at its top level, named
  // "tools_{tool_id}_….{png|jpg|gif|webp|avif}". (Same-named subfolders hold only the
  // 300/600/900w resized variants — ignored; we never descend into them.) Each
  // main photo is copied into the matching tool's tool_files folder and set as
  // its primary photo. Read-only on the source; skips tools with no match or an
  // existing photo; changes only metadata (primary_photo_id/name), so it writes
  // metadata once at the end rather than rewriting the Fusion library per tool.
  const importProShopPhotos = useCallback(async (sourceFolderId, { onProgress } = {}) => {
    if (!googleRef.current) {
      notify('Connect Google Drive to import photos', 'error');
      throw new Error('Google Drive not connected');
    }
    const SKIP_FILES = new Set(['300w.png', '600w.png', '900w.png']);
    const FOLDER_MIME = 'application/vnd.google-apps.folder';
    // Accept any image: match common extensions OR fall back to Drive's mimeType
    // (covers png/jpg/gif/webp/avif and anything else Drive tags as an image).
    const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif)$/i;
    const isImage = (c) => (c.mimeType || '').startsWith('image/') || IMAGE_EXT.test(c.name || '');
    // ProShop ID is the segment between the first and second underscore.
    const extractProshopId = (name) => {
      const parts = String(name).split('_');
      return parts.length >= 2 ? parts[1].trim() : '';
    };
    // Match ProShop IDs interchangeably regardless of dashes/spaces/case:
    // "D241", "D-241" and "d 241" all compare equal.
    const normId = (id) => String(id || '').replace(/[\s-]/g, '').toUpperCase();

    // Top-level photo files only — skip subfolders entirely and the resized variants.
    const children = await driveService.listFolderChildren(sourceFolderId);
    const photos = children.filter(c =>
      c.mimeType !== FOLDER_MIME && !SKIP_FILES.has(c.name) && isImage(c));
    const summary = { total: photos.length, imported: [], skippedHasPhoto: [], noMatch: [], errors: [] };
    if (photos.length === 0) return summary;

    // Load metadata once; modify in place; write once at the end.
    const metaList = await driveService.loadMetadata();
    const metaById = new Map(metaList.map(m => [m.id, m]));
    const updatedTools = [];
    const importedToolIds = new Set(); // guard against two photos for one tool in a run

    let done = 0;
    for (const photo of photos) {
      done += 1;
      onProgress?.({ done, total: photos.length, current: photo.name });
      try {
        const pid = extractProshopId(photo.name);
        if (!pid) { summary.noMatch.push({ folder: photo.name, reason: 'No ProShop ID in file name' }); continue; }
        const wantId = normId(pid);
        const tool = toolsRef.current.find(t => normId(t.tool_id) === wantId);
        if (!tool) { summary.noMatch.push({ folder: photo.name, proshopId: pid, reason: 'No tool with this ProShop ID' }); continue; }
        if (tool.primary_photo_id || importedToolIds.has(tool.id)) {
          summary.skippedHasPhoto.push({ folder: photo.name, proshopId: pid, description: tool.description });
          continue;
        }

        const trackingId = tool.tracking_id || tool.id;
        const toolFolderId = await driveService.ensureToolFolder(trackingId);
        const copied = await driveService.copyDriveFile(photo.id, photo.name, toolFolderId);

        const updatedTool = { ...tool, primary_photo_id: copied.id, primary_photo_name: photo.name };
        updatedTools.push(updatedTool);
        importedToolIds.add(tool.id);
        const metaRec = buildMetadataTool(updatedTool);
        metaById.set(metaRec.id, metaRec);
        summary.imported.push({ folder: photo.name, proshopId: pid, description: tool.description, photo: photo.name });
      } catch (err) {
        if (err.code === 'TOKEN_EXPIRED') { dispatch({ type: 'GOOGLE_EXPIRED' }); throw err; }
        summary.errors.push({ folder: photo.name, error: err.message });
      }
    }

    if (updatedTools.length > 0) {
      onProgress?.({ phase: 'saving', done: photos.length, total: photos.length, current: '' });
      await driveService.saveAllMetadata([...metaById.values()]);
      for (const t of updatedTools) dispatch({ type: 'UPDATE_TOOL', tool: t });
      markSetupStepInSettings('proshopPhotos');
    }
    return summary;
  }, [notify, markSetupStepInSettings]);

  // ─── Reconcile a tool against the live Fusion library ─────────────────────
  // Detects entries that were dumped straight into the Fusion library (sharing
  // this tool's tracking ID or ProShop number) instead of going through Sync
  // Job, and classifies each as a redundant duplicate, a new assembly, or a
  // conflict. Read-only — returns the classification for the UI to act on.
  const reconcileTool = useCallback(async (tool) => {
    const empty = { duplicates: [], newAssemblies: [], conflicts: [] };
    if (!tool) return empty;
    const tid = tool.tracking_id || null;
    const pid = String(tool.tool_id || '').trim();
    if (!tid && !pid) return empty;

    const rawList = await fetchRawLibrary(tool.library_id);
    const matchingRaws = rawList.filter(r => {
      const rtid = readTrackingId(r);
      const rpid = String(r['product-id'] || '').trim();
      return (tid && rtid === tid) || (pid && rpid === pid);
    });
    if (matchingRaws.length <= 1) return empty;

    return classifyStrays({
      matchingRaws,
      registeredAssemblies: tool._registeredAssemblies || [],
      canonicalRaw: tool._fusionRaw || null,
    });
  }, [fetchRawLibrary]);

  // Apply reconciliation decisions in a single library write: adopt selected
  // stray entries as registered assemblies (keyed by their own guid) and drop
  // the rest. writeLogicalTool removes every entry this tool owns (its tracking
  // ID + the supplied stray guids) before re-appending one clean instance per
  // assembly, so adopted entries are normalized to the tool's shared fields.
  const applyReconcile = useCallback(async (tool, { adopt = [], dropRaws = [] } = {}) => {
    if (!tool) throw new Error('Tool not found');
    const now = new Date().toISOString();
    const dropSet = new Set(dropRaws.map(r => r.guid));

    dispatch({ type: 'SAVE_START' });
    try {
      let assemblies = (tool.assemblies || []).filter(a => !dropSet.has(a.instance_guid));
      for (const r of adopt) {
        if (assemblies.some(a => a.instance_guid === r.guid)) continue;
        assemblies.push({
          assembly_id: generateAssemblyId(),
          instance_guid: r.guid,
          holder_guid: r.holder?.guid || null,
          holder_description: r.holder?.description || '',
          ooh: readOohFromFusion(r) ?? null,
          notes: '',
          source: 'fusion',
          created_at: now,
        });
      }
      if (assemblies.length === 0) {
        throw new Error('A tool must keep at least one assembly.');
      }

      // Make sure every stray we acted on is part of _instancesRaw so the write
      // drops it (covers entries with a different tracking ID, matched by ProShop #).
      const rawMap = new Map((tool._instancesRaw || []).map(r => [r.guid, r]));
      for (const r of [...dropRaws, ...adopt]) if (r?.guid) rawMap.set(r.guid, r);

      const written = await writeLogicalTool({
        ...tool,
        assemblies,
        _instancesRaw: [...rawMap.values()],
        updated_at: now,
      });
      dispatch({ type: 'UPDATE_TOOL', tool: written });
      dispatch({ type: 'SAVE_SUCCESS' });
      const added = adopt.length, removed = dropRaws.length;
      const parts = [];
      if (added) parts.push(`added ${added} assembl${added === 1 ? 'y' : 'ies'}`);
      if (removed) parts.push(`removed ${removed} duplicate entr${removed === 1 ? 'y' : 'ies'}`);
      notify(`Reconciled — ${parts.join(', ') || 'no changes'}`, 'success');
      return written;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Reconcile failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  }, [writeLogicalTool, notify]);

  const saveFullLibrary = useCallback(async (tools) => {
    dispatch({ type: 'SAVE_START' });
    try {
      const holders = holdersRef.current || [];
      const defaultLib = defaultToolLibraryId(shopSettingsRef.current);
      const libById = new Map((shopSettingsRef.current?.tool_libraries || []).map(l => [l.id, l]));
      // Auto-combine any same-ProShop-number duplicates before writing the full
      // library (covers bulk import, which routes through here).
      const combinedTools = combineToolsByToolId(tools);

      // Partition tools by their destination library (their own library_id, or the
      // default for new/untagged tools). Each represented library is FULL-REPLACED
      // with its subset, so libraries not represented here are left untouched.
      const byLibrary = new Map();
      const allMeta = [];
      for (const tool of combinedTools) {
        const libId = tool.library_id || defaultLib;
        const tracking_id = tool.tracking_id || generateTrackingId();
        const assemblies = (tool.assemblies && tool.assemblies.length > 0)
          ? tool.assemblies
          : [{
              holder_guid: tool.selected_holder_guid || null,
              holder_description: '',
              ooh: tool.ooh ?? null,
              source: 'manual',
              created_at: new Date().toISOString(),
            }];
        const withIds = assemblies.map(a => ({
          ...a,
          assembly_id: a.assembly_id || generateAssemblyId(),
          instance_guid: a.instance_guid || generateId(),
        }));
        const { fusionInstances, metadataTool } =
          splitToFusionInstances({ ...tool, tracking_id, assemblies: withIds }, holders);
        if (!byLibrary.has(libId)) byLibrary.set(libId, []);
        byLibrary.get(libId).push(...fusionInstances);
        allMeta.push(metadataTool);
      }

      // Write each represented library, then persist all metadata once (global).
      for (const [libId, fusionList] of byLibrary) {
        await uploadFusionList(libId, fusionList);
      }
      if (googleRef.current) await driveService.saveAllMetadata(allMeta);

      // Rebuild logical tools from what we wrote so in-memory state matches,
      // re-tagging each with its source library.
      const metaByTracking = new Map(allMeta.map(m => [m.id, m]));
      const rebuilt = [];
      let untrackedTotal = 0;
      for (const [libId, fusionList] of byLibrary) {
        const lib = libById.get(libId);
        const { groups, untracked } = groupByTrackingId(fusionList);
        untrackedTotal += untracked.length;
        const tag = (t) => ({ ...t, library_id: libId, library_name: lib?.fileName });
        for (const [, raws] of groups) rebuilt.push(tag(buildLogicalTool(raws, metaByTracking)));
        for (const raw of untracked) rebuilt.push(tag(buildLogicalTool([raw], metaByTracking)));
      }

      dispatch({ type: 'SET_TOOLS', tools: rebuilt, needsNormalize: untrackedTotal > 0 });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify(`Saved ${rebuilt.length} tools to library`, 'success');
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Save failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  }, [uploadFusionList, notify]);

  // Reassign machine tool numbers to every tool starting at #30, in current
  // library (array) order, skipping the reserved numbers. Destructive — used
  // only by the Renumber Library action and the initial-import flow. Always
  // re-reads from APS immediately before writing.
  const renumberLibrary = useCallback(async () => {
    dispatch({ type: 'SAVE_START' });
    try {
      // Machine numbers are shop-global: gather entries from EVERY library into one
      // list (remembering each entry's source library), number across the union,
      // then write each library back.
      const perLib = await downloadAllLibraries();
      const entryLib = new Map();
      const fusionList = [];
      const libNameById = new Map();
      for (const { libraryId, library, list } of perLib) {
        libNameById.set(libraryId, library.fileName);
        for (const f of list) { entryLib.set(f, libraryId); fusionList.push(f); }
      }
      const metaList = googleRef.current ? await driveService.loadMetadata() : [];
      const metaByTracking = new Map(metaList.map(m => [m.id, m]));

      // One number per logical tool. Tracking-ID groups (in encounter order)
      // first, then each untracked entry as its own group.
      const { groups, untracked } = groupByTrackingId(fusionList);
      const orderedGroups = [...groups.values(), ...untracked.map(r => [r])];
      const numbers = generateMachineNumbers(orderedGroups.length, ...machineNumberArgs());

      orderedGroups.forEach((raws, i) => {
        const num = numbers[i];
        raws.forEach(r => applyMachineNumberToFusion(r, num));
        const tid = readTrackingId(raws[0]);
        if (tid) {
          const meta = metaByTracking.get(tid) || { id: tid };
          metaByTracking.set(tid, { ...meta, machine_tool_number: num });
        }
      });

      // Write each library back (partition entries by their source library).
      for (const { libraryId } of perLib) {
        await uploadFusionList(libraryId, fusionList.filter(f => entryLib.get(f) === libraryId));
      }
      if (googleRef.current) await driveService.saveAllMetadata([...metaByTracking.values()]);

      // Rebuild the in-memory library so the UI reflects the new numbers.
      const tools = [];
      const tagOf = (raws) => { const lib = entryLib.get(raws[0]); return { library_id: lib, library_name: libNameById.get(lib) }; };
      for (const [, raws] of groups) tools.push({ ...buildLogicalTool(raws, metaByTracking), ...tagOf(raws) });
      for (const raw of untracked) tools.push({ ...buildLogicalTool([raw], metaByTracking), ...tagOf([raw]) });
      dispatch({ type: 'SET_TOOLS', tools });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify(`Renumbered ${orderedGroups.length} tools starting at #30`, 'success');
      return orderedGroups.length;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Renumber failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  }, [downloadAllLibraries, uploadFusionList, notify]);

  // Assign generated tool IDs to logical tools that don't have one yet, per the
  // configured tool_id_system. tool_id is metadata-owned — writes the value to
  // metadata (source of truth) and mirrors it to Fusion's native product-id —
  // and never touches tools that already have an ID. No-op in proshop/other_erp
  // modes (IDs aren't generated). Always re-reads from APS before writing.
  const assignToolIds = useCallback(async () => {
    const config = shopSettingsRef.current?.tool_id_system || {};
    const { mode } = config;
    if (mode === 'proshop' || mode === 'other_erp') {
      notify('IDs are not generated in this mode', 'info');
      return 0;
    }
    // Demo mode: pure in-memory path — no APS/Drive. Reassign ALL tools (not just
    // unassigned ones) so the sandbox is repeatable: flip the scheme, re-run, and
    // watch every tool re-render. Reset by refreshing the page.
    if (demoModeRef.current) {
      let counter = isCounterMode(mode) ? nextSequential(config.start, config.skip) : null;
      let assigned = 0;
      const tools = toolsRef.current.map(t => {
        const value = composeToolId(config, t, counter);
        if (!value) return t;
        assigned++;
        if (counter !== null) counter = nextSequential(counter + 1, config.skip);
        return { ...t, tool_id: value };
      });
      dispatch({ type: 'SET_TOOLS', tools });
      notify(`Assigned IDs to ${assigned} tool${assigned === 1 ? '' : 's'} (demo — not saved)`, 'success');
      return assigned;
    }
    dispatch({ type: 'SAVE_START' });
    try {
      // Shop-global IDs: gather entries across every library, assign across the
      // union, then write each library back.
      const perLib = await downloadAllLibraries();
      const entryLib = new Map();
      const fusionList = [];
      const libNameById = new Map();
      for (const { libraryId, library, list } of perLib) {
        libNameById.set(libraryId, library.fileName);
        for (const f of list) { entryLib.set(f, libraryId); fusionList.push(f); }
      }
      const metaList = googleRef.current ? await driveService.loadMetadata() : [];
      const metaByTracking = new Map(metaList.map(m => [m.id, m]));

      const { groups, untracked } = groupByTrackingId(fusionList);
      const orderedGroups = [...groups.values(), ...untracked.map(r => [r])];

      let counter = isCounterMode(mode) ? nextSequential(config.start, config.skip) : null;
      let assigned = 0;
      for (const raws of orderedGroups) {
        const logical = buildLogicalTool(raws, metaByTracking);
        if (logical.tool_id) continue;          // already has an ID — skip
        const value = composeToolId(config, logical, counter);
        if (!value) continue;                       // mode can't produce one (e.g. no machine #)
        raws.forEach(r => applyToolIdToFusion(r, value));
        // tool_id is metadata-owned — record it in metadata (source of truth) too,
        // mirrored to Fusion's product-id above.
        const tid = readTrackingId(raws[0]);
        if (tid) {
          const meta = metaByTracking.get(tid) || { id: tid };
          metaByTracking.set(tid, { ...meta, tool_id: value });
        }
        assigned++;
        if (counter !== null) counter = nextSequential(counter + 1, config.skip);
      }

      if (assigned === 0) { dispatch({ type: 'SAVE_SUCCESS' }); notify('No unassigned tools to ID', 'info'); return 0; }

      for (const { libraryId } of perLib) {
        await uploadFusionList(libraryId, fusionList.filter(f => entryLib.get(f) === libraryId));
      }
      // tool_id is metadata-owned (mirrored to Fusion's product-id) — persist it.
      if (googleRef.current) await driveService.saveAllMetadata([...metaByTracking.values()]);

      // Rebuild the in-memory library so the new IDs show immediately.
      const tools = [];
      const tagOf = (raws) => { const lib = entryLib.get(raws[0]); return { library_id: lib, library_name: libNameById.get(lib) }; };
      for (const [, raws] of groups) tools.push({ ...buildLogicalTool(raws, metaByTracking), ...tagOf(raws) });
      for (const raw of untracked) tools.push({ ...buildLogicalTool([raw], metaByTracking), ...tagOf([raw]) });
      dispatch({ type: 'SET_TOOLS', tools });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify(`Assigned IDs to ${assigned} tool${assigned === 1 ? '' : 's'}`, 'success');
      return assigned;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Assign IDs failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  }, [downloadAllLibraries, uploadFusionList, notify]);

  // Re-number EVERY tool to the current tool_id_system scheme — the action to run
  // after switching ID schemes. Unlike assignToolIds (which only fills blanks),
  // this overwrites every existing ID and retires the old value into the tool's
  // metadata `legacy_ids[]` so old job files / CSVs still match and search still
  // finds the tool. New IDs skip only an EXACT collision with a retired ID
  // (partial digit overlap with a different prefix is fine). Writes Fusion AND
  // metadata. No-op in proshop/other_erp modes.
  //
  // `consolidateIds`: tool_ids of duplicate clusters (one tool_id shared across
  // multiple Fusion tracking-ID groups — a fold from human-error data) that the
  // user chose to MERGE — all the cluster's groups get ONE shared new ID instead
  // of being split into separate IDs. Clusters not listed are split (default
  // per-tracking-group behavior). See duplicateIdClusters (toolSchema.js).
  const renumberAllToolIds = useCallback(async (consolidateIds = []) => {
    const config = shopSettingsRef.current?.tool_id_system || {};
    const { mode } = config;
    if (mode === 'proshop' || mode === 'other_erp') {
      notify('IDs are not generated in this mode', 'info');
      return 0;
    }
    const uniqPush = (arr, v) => (arr.includes(v) ? arr : [...arr, v]);

    // Demo mode: pure in-memory, reassign all, retire old IDs into legacy_ids.
    if (demoModeRef.current) {
      let counter = isCounterMode(mode) ? nextSequential(config.start, config.skip) : null;
      let assigned = 0;
      const tools = toolsRef.current.map(t => {
        const value = composeToolId(config, t, counter);
        if (!value) return t;
        if (counter !== null) counter = nextSequential(counter + 1, config.skip);
        assigned++;
        const old = t.tool_id;
        const legacy_ids = (old && old !== value)
          ? uniqPush((t.legacy_ids || []).filter(l => l !== value), old)
          : (t.legacy_ids || []);
        return { ...t, tool_id: value, legacy_ids };
      });
      dispatch({ type: 'SET_TOOLS', tools });
      notify(`Re-numbered ${assigned} tool${assigned === 1 ? '' : 's'} (demo — not saved)`, 'success');
      return assigned;
    }

    dispatch({ type: 'SAVE_START' });
    try {
      // Shop-global re-number across every library.
      const perLib = await downloadAllLibraries();
      const entryLib = new Map();
      const fusionList = [];
      const libNameById = new Map();
      for (const { libraryId, library, list } of perLib) {
        libNameById.set(libraryId, library.fileName);
        for (const f of list) { entryLib.set(f, libraryId); fusionList.push(f); }
      }
      const metaList = googleRef.current ? await driveService.loadMetadata() : [];
      const metaByTracking = new Map(metaList.map(m => [m.id, m]));

      const { groups, untracked } = groupByTrackingId(fusionList);
      const orderedGroups = [...groups.values(), ...untracked.map(r => [r])];

      // Avoid re-issuing an ID whose EXACT full value was retired into a tool's
      // legacy_ids. Partial overlap (same trailing digits, different prefix) is
      // fine — only a full-string collision is skipped.
      const retiredExact = new Set();
      for (const m of metaList) {
        for (const lid of (m.legacy_ids || [])) retiredExact.add(String(lid));
      }

      // Duplicate clusters the user chose to MERGE (one shared new ID across all
      // their tracking groups) instead of letting re-number split them. Keyed by
      // the shared current tool_id.
      const mergedIds = new Set(consolidateIds);
      const clusterValue = new Map();   // tool_id -> the one new ID for a merged cluster

      let counter = isCounterMode(mode) ? nextSequential(config.start, config.skip) : null;
      let assigned = 0;
      for (const raws of orderedGroups) {
        const logical = buildLogicalTool(raws, metaByTracking);
        const oldId = logical.tool_id;

        let value;
        if (oldId && mergedIds.has(oldId) && clusterValue.has(oldId)) {
          // A later tracking group of a merged duplicate cluster — reuse its one ID
          // (don't consume a counter value).
          value = clusterValue.get(oldId);
        } else {
          value = composeToolId(config, logical, counter);
          if (!value) continue;                      // mode can't produce one (e.g. no machine #)
          // Skip only an exact collision with a retired ID — bump and recompose.
          while (counter !== null && retiredExact.has(value)) {
            counter = nextSequential(counter + 1, config.skip);
            value = composeToolId(config, logical, counter);
          }
          if (counter !== null) counter = nextSequential(counter + 1, config.skip);
          if (oldId && mergedIds.has(oldId)) clusterValue.set(oldId, value);
        }
        assigned++;

        const tid = readTrackingId(raws[0]);
        if (tid) {
          // tool_id is metadata-owned — write the new value to metadata (source of
          // truth) and mirror it to Fusion's product-id below. Retire the old value.
          const meta = metaByTracking.get(tid) || { id: tid };
          const legacy_ids = (oldId && oldId !== value)
            ? uniqPush((meta.legacy_ids || []).filter(l => l !== value), oldId)
            : (meta.legacy_ids || []);
          metaByTracking.set(tid, { ...meta, tool_id: value, legacy_ids });
        }
        raws.forEach(r => applyToolIdToFusion(r, value));
      }

      if (assigned === 0) { dispatch({ type: 'SAVE_SUCCESS' }); notify('No tools to re-number', 'info'); return 0; }

      for (const { libraryId } of perLib) {
        await uploadFusionList(libraryId, fusionList.filter(f => entryLib.get(f) === libraryId));
      }
      // tool_id (metadata-owned) and legacy_ids both live in metadata — persist them.
      if (googleRef.current) await driveService.saveAllMetadata([...metaByTracking.values()]);

      const tools = [];
      const tagOf = (raws) => { const lib = entryLib.get(raws[0]); return { library_id: lib, library_name: libNameById.get(lib) }; };
      for (const [, raws] of groups) tools.push({ ...buildLogicalTool(raws, metaByTracking), ...tagOf(raws) });
      for (const raw of untracked) tools.push({ ...buildLogicalTool([raw], metaByTracking), ...tagOf([raw]) });
      dispatch({ type: 'SET_TOOLS', tools });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify(`Re-numbered ${assigned} tool${assigned === 1 ? '' : 's'}`, 'success');
      return assigned;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Re-number failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  }, [downloadAllLibraries, uploadFusionList, notify]);

  // ─── One-time normalization (transition to the multi-instance model) ──────
  // Assigns tracking IDs to untracked tools, fans each out into instances per
  // its existing metadata assemblies, renames presets to the naming convention,
  // and extracts operation_type (from the name, or from `opOverrides` keyed by
  // preset guid). Re-keys metadata from guid → tracking_id by overwriting the
  // whole file. Idempotent: already-tracked tools are left as-is.
  const normalizeLibrary = useCallback(async (opOverrides = {}) => {
    dispatch({ type: 'SAVE_START' });
    try {
      const holders = holdersRef.current || [];
      const perLib = await downloadAllLibraries();
      const metaList = googleRef.current ? await driveService.loadMetadata() : [];
      const metaByGuid = new Map(metaList.map(m => [m.id, m]));
      const metaByTracking = new Map(metaList.map(m => [m.id, m]));

      // Normalize each library independently, tagging produced tools with their
      // source library so saveFullLibrary writes each back to the right file.
      const cleanTools = [];
      const conflictTools = [];
      let dupCount = 0;
      let untrackedCount = 0;
      for (const { libraryId, library, list: fusionList } of perLib) {
      const { groups, untracked } = groupByTrackingId(fusionList);
      untrackedCount += untracked.length;
      const logicalTools = [];

      // Already-tracked tools: rebuild unchanged.
      for (const [, raws] of groups) logicalTools.push(buildLogicalTool(raws, metaByTracking));

      // Untracked tools: assign a tracking ID and fan out per metadata assemblies.
      for (const raw of untracked) {
        const meta = metaByGuid.get(raw.guid) || null;
        const internal = fusionToolToInternal(raw);
        const merged = mergeFusionAndMetadata(internal, meta);
        const tracking_id = generateTrackingId();
        const now = new Date().toISOString();

        const oldAssemblies = (meta?.assemblies || []).filter(Boolean);
        const rawAssemblies = oldAssemblies.length
          ? oldAssemblies.map((a, i) => ({
              assembly_id: a.assembly_id || generateAssemblyId(),
              instance_guid: i === 0 ? raw.guid : generateId(),
              holder_guid: a.holder_guid || null,
              holder_description: a.holder_description || '',
              ooh: a.ooh ?? readOohFromFusion(raw) ?? merged.ooh ?? null,
              notes: a.notes || '',
              source: a.source || 'manual',
              created_at: a.created_at || now,
            }))
          : [{
              assembly_id: generateAssemblyId(),
              instance_guid: raw.guid,
              holder_guid: merged.selected_holder_guid || raw.holder?.guid || null,
              holder_description: raw.holder?.description || '',
              ooh: readOohFromFusion(raw) ?? merged.ooh ?? null,
              notes: '',
              source: 'fusion',
              created_at: now,
            }];

        // MIN OOH (from ProShop, `lengthBelowShankDiameter`) is the per-tool
        // stick-out floor. Normalization makes shoulder length equal to it and
        // floors every assembly's OOH at it — no assembly may stick out less than
        // the minimum, though it may stick out more. (shoulder/OOH can be adjusted
        // manually afterward.) When there's no MIN OOH, leave lengths untouched.
        // Units: min_ooh, per-assembly OOH and shoulder_length are all stored in
        // the tool's own unit, so they compare/assign directly — no conversion.
        const minOoh = merged.min_ooh ?? null;
        const shoulder_length = minOoh != null ? minOoh : merged.shoulder_length;
        const assemblies = minOoh != null
          ? rawAssemblies.map(a => ({ ...a, ooh: (a.ooh != null && a.ooh < minOoh) ? minOoh : a.ooh }))
          : rawAssemblies;

        // Rename presets to the convention against the primary assembly, and set
        // operation_type (name wins, else the user-supplied override).
        const primary = assemblies[0];
        const primaryHolderShort = holderShortName(primary.holder_description || '');
        const isHoleMakingTool = HOLE_MAKING_TYPES.has(merged.tool_type);
        const presets = (merged.presets || []).map(p => {
          const opType = isHoleMakingTool
            ? null
            : (parsePresetName(p.name)?.opType ?? opOverrides[p.guid] ?? p.operation_type ?? null);
          const name = (!isHoleMakingTool && opTypeWord(opType))
            ? composePresetName({
                materialQuery: materialNameCode(p.material?.query, materialsRef.current),
                ooh: primary.ooh,
                holderShort: primaryHolderShort,
                opType,
              })
            : p.name;
          return { ...p, name, operation_type: opType };
        });

        logicalTools.push({
          ...merged,
          id: tracking_id,
          tracking_id,
          shoulder_length,
          assemblies,
          presets,
          _instancesRaw: [raw],
          _fusionRaw: raw,
        });
      }

      // Fold tools sharing a ProShop number into one logical tool before saving,
      // so duplicate copies pushed into the library merge into a single tool
      // (with one instance per distinct holder/OOH) instead of staying separate.
      // combine runs WITHIN each library only (cross-library tools stay separate).
      const combined = combineToolsByToolId(logicalTools);
      dupCount += logicalTools.length - combined.length;

      // Skip tools whose fields genuinely conflict (non-empty values differ between
      // the placeholder and the Fusion entry). Leave their raw entries untouched in
      // the library so nothing is destroyed; the user can reconcile on next open.
      for (const t of combined) {
        const tagged = { ...t, library_id: libraryId, library_name: library.fileName };
        if (t._combineConflicts?.length) conflictTools.push(tagged); else cleanTools.push(tagged);
      }
      } // end per-library loop

      await saveFullLibrary(cleanTools);
      markSetupStepInSettings('normalized');
      const base = `Normalized ${untrackedCount} tool${untrackedCount === 1 ? '' : 's'} to the multi-instance model`;
      const conflictSuffix = conflictTools.length > 0
        ? `; ${conflictTools.length} need${conflictTools.length === 1 ? 's' : ''} conflict review — open them to resolve`
        : '';
      const dupSuffix = dupCount > 0
        ? `; combined ${dupCount} ProShop-number duplicate${dupCount === 1 ? '' : 's'}`
        : '';
      notify(`${base}${dupSuffix}${conflictSuffix}`, 'success', 6000);
      return untrackedCount;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Normalize failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  }, [downloadAllLibraries, saveFullLibrary, notify, markSetupStepInSettings]);

  const clearError = useCallback(() => dispatch({ type: 'CLEAR_ERROR' }), []);

  return (
    <AppContext.Provider value={{
      ...state,
      holderLibrarySetupComplete: !!state.holderLibraryLocation,
      setGoogleUser,
      skipMetadata,
      reconnectMetadata,
      disconnectMetadata,
      fetchMetadataLocation,
      dismissMetadataWarning,
      saveMaterials,
      saveVendorRegistry,
      saveShopSettings,
      markSetupStep,
      markSetupStepInSettings,
      setupCelebrated,
      markSetupCelebrated,
      setLibraryLocation,
      clearLibraryLocation,
      beginChangeLibrary,
      cancelChangeLibrary,
      setHolderLibraryLocation,
      clearHolderLibraryLocation,
      // Multi-library registry actions
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
      saveTool,
      addTool,
      cloneTool,
      mergeTool,
      deleteTool,
      addAssembly,
      updateAssembly,
      deleteAssembly,
      uploadToolPhoto,
      uploadToolAttachment,
      deleteToolAttachment,
      importProShopPhotos,
      reconcileTool,
      applyReconcile,
      saveFullLibrary,
      renumberLibrary,
      assignToolIds,
      renumberAllToolIds,
      normalizeLibrary,
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
