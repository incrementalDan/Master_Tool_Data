// Pure (non-React) state layer for AppContext: localStorage keys and readers,
// the multi-library registry helpers, the setup-steps list, initialState, and
// the reducer. No side effects beyond localStorage.
import { DEFAULT_MATERIALS, DEFAULT_SHOP_SETTINGS, DEFAULT_JOBS, DEFAULT_COMPONENTS } from '../schema/sharedDefaults.js';
import { DEFAULT_VENDOR_REGISTRY } from '../schema/vendorRegistry.js';

const LOCATION_KEY = 'aps_library_location';
const HOLDER_LOCATION_KEY = 'aps_holder_library_location';
// Multi-library registry mirror. The registry (linked tool + holder libraries +
// default-for-new-tools) is shop-wide in shop_settings.json on Drive, but is
// ALSO mirrored to localStorage so an APS-only session (Google Drive optional)
// still knows which libraries to load. The Drive copy wins when present; this
// cache is the fallback + the seed before Drive loads. Mirrors the existing
// default_units localStorage-mirroring pattern.
const REGISTRY_MIRROR_KEY = 'aps_library_registry';
// Whether THIS device has already shown the one-time completion fireworks. This
// is a per-device UI acknowledgment (has this user seen the party?), NOT shop
// configuration — setup COMPLETION itself is shop-wide, in shop_settings.setup_steps.
export const SETUP_CELEBRATED_KEY = 'tms_setup_celebrated';

// The one-time setup/normalization/ProShop workflow, in order. Each step is
// toggled on at the moment its triggering action happens — see setLibraryLocation,
// normalizeLibrary, the Settings Save, and ImportFlow's merge/export buttons. The
// three identification systems (Tool ID, Location, Assembly) are configured as a
// related group right after the data sources are connected — see THREE SYSTEM
// CONTEXT PROMPT.md. (A step may carry `disabled: true` to render as a
// placeholder excluded from the completion/progress math — none currently do.)
export const SETUP_STEPS = [
  { key: 'fusionConnected', label: 'Connect Fusion library' },
  { key: 'metadataConnected', label: 'Connect tool metadata (Google Drive)' },
  { key: 'toolIdConfigured', label: 'Choose your Tool ID format' },
  { key: 'locationConfigured', label: 'Configure your Location System' },
  { key: 'assemblyIdConfigured', label: 'Configure your Assembly ID format' },
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
export function locToLibEntry(loc, order = 0) {
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

export function saveRegistryMirror(ss) {
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
export function primaryToolLib(ss) {
  const tl = ss?.tool_libraries || [];
  const id = defaultToolLibraryId(ss);
  return tl.find(l => l.id === id) || tl[0] || null;
}

// Fill a shop_settings object's registry from the localStorage mirror, then the
// legacy single-location keys — so an established single-library shop (or an
// APS-only session) keeps working with no Drive write and no data migration.
export function seedShopSettingsRegistry(ss) {
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

// Derive the boolean "is this step done?" map the UI reads from the shop-wide
// setup_steps timestamps (shop_settings.json on Drive). setup_steps is the SINGLE
// SOURCE OF TRUTH for setup completion — shared across every device via Drive — so
// a step is "done" exactly when it carries a timestamp. (Previously the booleans
// lived per-device in localStorage, which is why deleting the Drive settings file
// didn't reset the checklist; that store is gone.)
export function setupProgressFromSteps(setupSteps) {
  const out = {};
  for (const [k, v] of Object.entries(setupSteps || {})) out[k] = !!v;
  return out;
}

// Machine-number start/skip come from shop_settings.json (falling back to the
// built-in defaults baked into the schema functions when unset).
export function machineNumberArgs(shopSettings) {
  const mn = shopSettings?.machine_number;
  return [mn?.start ?? undefined, mn?.skip ?? undefined];
}

// Seed the registry (linked tool/holder libraries) from the localStorage mirror /
// legacy single-location keys so the very first render — before any Drive load —
// already knows which libraries exist.
const SEEDED_SHOP_SETTINGS = seedShopSettingsRegistry(DEFAULT_SHOP_SETTINGS);

export const initialState = {
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
  // NOTE: setup completion is NOT stored here — it's derived from the shop-wide
  // shopSettings.setup_steps timestamps (see setupProgressFromSteps). The provider
  // exposes the derived `setupProgress` map in the context value.
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
  jobs: DEFAULT_JOBS,         // jobs.json — shop-wide job registry (program # + part #)
  components: DEFAULT_COMPONENTS, // tool_components.json — holder body / insert records (insert-style tools)
  isLoading: false,
  isSaving: false,
  error: null,
  toasts: [],                 // [{ id, type, message }]
};

export function reducer(state, action) {
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
        jobs: action.jobs || DEFAULT_JOBS,
        components: action.components || DEFAULT_COMPONENTS,
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
      return { ...state, materials: action.materials, vendorRegistry: action.vendorRegistry, shopSettings: action.shopSettings, jobs: action.jobs, components: action.components || state.components };
    case 'SET_MATERIALS': return { ...state, materials: action.materials };
    case 'SET_JOBS': return { ...state, jobs: action.jobs };
    case 'SET_COMPONENTS': return { ...state, components: action.components };
    case 'SET_VENDOR_REGISTRY': return { ...state, vendorRegistry: action.vendorRegistry };
    case 'SET_SHOP_SETTINGS': return { ...state, shopSettings: action.shopSettings };
    // Merge a single sub-object/timestamp into shopSettings off the CURRENT state
    // (never rebuild-and-replace from a possibly-stale ref) so concurrent edits in
    // the same tick — a location_config keystroke + a setup-step stamp — compose
    // instead of clobbering each other.
    case 'SET_LOCATION_CONFIG':
      return { ...state, shopSettings: { ...state.shopSettings, location_config: action.locationConfig } };
    case 'MARK_SETUP_TIMESTAMP':
      return { ...state, shopSettings: { ...state.shopSettings, setup_steps: { ...(state.shopSettings?.setup_steps || {}), [action.key]: action.ts } } };
    // Merge several step timestamps at once (used to seed an established shop's
    // completion). Merged over the current setup_steps off fresh state.
    case 'MERGE_SETUP_TIMESTAMPS':
      return { ...state, shopSettings: { ...state.shopSettings, setup_steps: { ...(state.shopSettings?.setup_steps || {}), ...action.steps } } };
    case 'RESET_SETUP_TIMESTAMPS':
      return { ...state, shopSettings: { ...state.shopSettings, setup_steps: {} } };
    case 'CLEAR_ERROR': return { ...state, error: null };
    case 'ADD_TOAST': return { ...state, toasts: [...state.toasts, action.toast] };
    case 'DISMISS_TOAST': return { ...state, toasts: state.toasts.filter(t => t.id !== action.id) };
    default: return state;
  }
}
