import { createContext, useContext, useReducer, useCallback, useEffect, useRef } from 'react';
import * as driveService from '../services/driveService.js';
import * as aps from '../services/apsService.js';
import {
  validateTool, generateId,
  fusionToolToInternal, mergeFusionAndMetadata, splitToFusionAndMetadata,
  getNextMachineNumber, generateMachineNumbers, applyMachineNumberToFusion,
} from '../schema/toolSchema.js';

const AppContext = createContext(null);

const LOCATION_KEY = 'aps_library_location';

function loadStoredLocation() {
  try {
    const raw = localStorage.getItem(LOCATION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

const initialState = {
  user: null,                 // Google user (metadata identity) or null
  apsAuthenticated: false,    // Autodesk signed in
  googleAuthenticated: false, // Google signed in (metadata)
  metadataSkipped: false,     // user chose to proceed without Drive metadata
  libraryLocation: loadStoredLocation(), // { hubId, projectId, folderId, itemId, fileName }
  processingAuth: false,      // exchanging APS callback code
  tools: [],
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
      return { ...state, user: action.user, googleAuthenticated: true };
    case 'SKIP_METADATA': return { ...state, metadataSkipped: true };
    case 'SET_LIBRARY_LOCATION': return { ...state, libraryLocation: action.location };
    case 'CLEAR_LIBRARY_LOCATION': return { ...state, libraryLocation: null, tools: [] };
    case 'SIGN_OUT':
      return {
        ...initialState,
        libraryLocation: state.libraryLocation, // keep saved location across sign-out
      };
    case 'LOAD_START': return { ...state, isLoading: true, error: null };
    case 'LOAD_SUCCESS': return { ...state, isLoading: false, tools: action.tools };
    case 'LOAD_ERROR': return { ...state, isLoading: false, error: action.error };
    case 'SAVE_START': return { ...state, isSaving: true, error: null };
    case 'SAVE_SUCCESS': return { ...state, isSaving: false };
    case 'SAVE_ERROR': return { ...state, isSaving: false, error: action.error };
    case 'ADD_TOOL': return { ...state, tools: [...state.tools, action.tool] };
    case 'UPDATE_TOOL':
      return { ...state, tools: state.tools.map(t => t.id === action.tool.id ? action.tool : t) };
    case 'DELETE_TOOL':
      return { ...state, tools: state.tools.filter(t => t.id !== action.id) };
    case 'SET_TOOLS': return { ...state, tools: action.tools };
    case 'CLEAR_ERROR': return { ...state, error: null };
    case 'ADD_TOAST': return { ...state, toasts: [...state.toasts, action.toast] };
    case 'DISMISS_TOAST': return { ...state, toasts: state.toasts.filter(t => t.id !== action.id) };
    default: return state;
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Keep latest values accessible inside async callbacks without stale closures
  const locationRef = useRef(state.libraryLocation);
  const googleRef = useRef(state.googleAuthenticated);
  const toolsRef = useRef(state.tools);
  useEffect(() => { locationRef.current = state.libraryLocation; }, [state.libraryLocation]);
  useEffect(() => { googleRef.current = state.googleAuthenticated; }, [state.googleAuthenticated]);
  useEffect(() => { toolsRef.current = state.tools; }, [state.tools]);

  // ─── Handle APS OAuth callback on mount ───────────────────────────────────
  useEffect(() => {
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

  // ─── Drive-backed Fusion list helpers ─────────────────────────────────────
  const downloadFusionList = useCallback(async () => {
    const loc = locationRef.current;
    if (!loc) throw new Error('No tool library location selected');
    const json = await aps.loadToolLibrary(loc.projectId, loc.itemId);
    return Array.isArray(json?.data) ? json.data : (Array.isArray(json) ? json : []);
  }, []);

  const uploadFusionList = useCallback(async (list) => {
    const loc = locationRef.current;
    await aps.saveToolLibrary(loc.projectId, loc.folderId, loc.itemId, loc.fileName, { data: list });
  }, []);

  // Expose raw Fusion list download for the merge flow live-fetch feature.
  const fetchRawLibrary = useCallback(async () => {
    return await downloadFusionList();
  }, [downloadFusionList]);

  // ─── Auth / setup actions ─────────────────────────────────────────────────
  const setGoogleUser = useCallback((user) => {
    driveService.setUserInfo(user);
    dispatch({ type: 'SET_GOOGLE_USER', user });
  }, []);

  const skipMetadata = useCallback(() => dispatch({ type: 'SKIP_METADATA' }), []);

  const setLibraryLocation = useCallback((location) => {
    localStorage.setItem(LOCATION_KEY, JSON.stringify(location));
    dispatch({ type: 'SET_LIBRARY_LOCATION', location });
  }, []);

  const clearLibraryLocation = useCallback(() => {
    localStorage.removeItem(LOCATION_KEY);
    dispatch({ type: 'CLEAR_LIBRARY_LOCATION' });
  }, []);

  const signOutAll = useCallback(() => {
    aps.signOut();
    driveService.signOut();
    dispatch({ type: 'SIGN_OUT' });
  }, []);

  // ─── Tool data actions ────────────────────────────────────────────────────
  const loadTools = useCallback(async () => {
    dispatch({ type: 'LOAD_START' });
    try {
      const fusionList = await downloadFusionList();
      const metaList = googleRef.current ? await driveService.loadMetadata() : [];
      const metaById = new Map(metaList.map(m => [m.id, m]));
      const tools = fusionList.map(fTool => {
        const internal = fusionToolToInternal(fTool);
        return mergeFusionAndMetadata(internal, metaById.get(internal.id) || null);
      });
      dispatch({ type: 'LOAD_SUCCESS', tools });
    } catch (err) {
      dispatch({ type: 'LOAD_ERROR', error: err.message });
    }
  }, [downloadFusionList]);

  const saveTool = useCallback(async (tool) => {
    const { valid, errors } = validateTool(tool);
    if (!valid) throw new Error(errors.join(', '));

    dispatch({ type: 'SAVE_START' });
    try {
      const updated = { ...tool, updated_at: new Date().toISOString() };
      // Always re-download the current library before writing
      const fusionList = await downloadFusionList();
      const idx = fusionList.findIndex(t => t.guid === updated.id);
      // Preserve any Fusion-specific data on the freshest copy
      if (idx >= 0) updated._fusionRaw = fusionList[idx];
      const { fusionTool, metadataTool } = splitToFusionAndMetadata(updated);
      if (idx >= 0) fusionList[idx] = fusionTool;
      else fusionList.push(fusionTool);

      await uploadFusionList(fusionList);
      if (googleRef.current) await driveService.upsertMetadata(metadataTool);

      dispatch({ type: 'UPDATE_TOOL', tool: updated });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify('Saved to Fusion library', 'success');
      return updated;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Save failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  }, [downloadFusionList, uploadFusionList, notify]);

  const addTool = useCallback(async (tool) => {
    const { valid, errors } = validateTool(tool);
    if (!valid) throw new Error(errors.join(', '));

    const now = new Date().toISOString();
    const created = {
      ...tool,
      id: tool.id || generateId(),
      created_at: tool.created_at || now,
      updated_at: now,
    };

    dispatch({ type: 'SAVE_START' });
    try {
      const fusionList = await downloadFusionList();

      // Assign a machine tool number at the moment of save (not when the form
      // opened) so concurrent adds don't collide. Numbers already in use come
      // from the in-memory library, which is the merged source of truth.
      if (created.machine_tool_number === null || created.machine_tool_number === undefined || created.machine_tool_number === '') {
        const existingNumbers = toolsRef.current
          .map(t => t.machine_tool_number)
          .filter(n => n !== null && n !== undefined && n !== '')
          .map(Number);
        const next = getNextMachineNumber(existingNumbers);
        // Collision guard — getNextMachineNumber should never return a used
        // number, but surface it as an error rather than silently overwrite.
        if (existingNumbers.includes(next)) {
          throw new Error(`Machine tool number collision detected at #${next}. Resolve in Settings → Renumber.`);
        }
        created.machine_tool_number = next;
      }

      const { fusionTool, metadataTool } = splitToFusionAndMetadata(created);
      const idx = fusionList.findIndex(t => t.guid === created.id);
      if (idx >= 0) fusionList[idx] = fusionTool;
      else fusionList.push(fusionTool);

      await uploadFusionList(fusionList);
      if (googleRef.current) await driveService.upsertMetadata(metadataTool);

      dispatch({ type: 'ADD_TOOL', tool: created });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify('Tool added to library', 'success');
      return created;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Add failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  }, [downloadFusionList, uploadFusionList, notify]);

  // Duplicate an existing tool as a starting point for a new one.
  const cloneTool = useCallback(async (id) => {
    const source = toolsRef.current.find(t => t.id === id);
    if (!source) throw new Error('Tool not found');
    const now = new Date().toISOString();
    const copy = {
      ...source,
      id: generateId(),
      description: `${source.description || 'Tool'} (copy)`,
      _fusionRaw: undefined,
      machine_tool_number: null, // assign a fresh number on save — never reuse the source's
      merge_history: [],
      created_at: now,
      updated_at: now,
    };
    return addTool(copy);
  }, [addTool]);

  // Merge selected job-tool fields back into a master tool with history tracking.
  const mergeTool = useCallback(async (masterTool, mergedFields, revisionNote, mergedBy) => {
    dispatch({ type: 'SAVE_START' });
    try {
      const previousValues = {};
      for (const field of Object.keys(mergedFields)) {
        previousValues[field] = masterTool[field];
      }
      const entry = {
        merged_at: new Date().toISOString(),
        merged_by: mergedBy || 'unknown',
        fields_changed: Object.keys(mergedFields),
        revision_note: revisionNote,
        previous_values: previousValues,
      };
      const updated = {
        ...masterTool,
        ...mergedFields,
        updated_at: new Date().toISOString(),
        updated_by: mergedBy || '',
        revision_notes: revisionNote,
        merge_history: [...(masterTool.merge_history || []), entry],
      };

      const fusionList = await downloadFusionList();
      const idx = fusionList.findIndex(t => t.guid === masterTool.id);
      if (idx >= 0) updated._fusionRaw = fusionList[idx];
      const { fusionTool, metadataTool } = splitToFusionAndMetadata(updated);
      if (idx >= 0) fusionList[idx] = fusionTool;
      else fusionList.push(fusionTool);

      await uploadFusionList(fusionList);
      if (googleRef.current) await driveService.upsertMetadata(metadataTool);

      dispatch({ type: 'UPDATE_TOOL', tool: updated });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify('Merged job values to master library', 'success');
      return updated;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Merge failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  }, [downloadFusionList, uploadFusionList, notify]);

  const deleteTool = useCallback(async (id) => {
    dispatch({ type: 'SAVE_START' });
    try {
      const fusionList = await downloadFusionList();
      await uploadFusionList(fusionList.filter(t => t.guid !== id));
      if (googleRef.current) await driveService.deleteMetadata(id);
      dispatch({ type: 'DELETE_TOOL', id });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify('Tool deleted', 'success');
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Delete failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  }, [downloadFusionList, uploadFusionList, notify]);

  const saveFullLibrary = useCallback(async (tools) => {
    dispatch({ type: 'SAVE_START' });
    try {
      const fusionList = [];
      const metaList = [];
      for (const tool of tools) {
        const { fusionTool, metadataTool } = splitToFusionAndMetadata(tool);
        fusionList.push(fusionTool);
        metaList.push(metadataTool);
      }
      await uploadFusionList(fusionList);
      if (googleRef.current) await driveService.saveAllMetadata(metaList);
      dispatch({ type: 'SET_TOOLS', tools });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify(`Saved ${tools.length} tools to library`, 'success');
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
      const fusionList = await downloadFusionList();
      const metaList = googleRef.current ? await driveService.loadMetadata() : [];
      const metaById = new Map(metaList.map(m => [m.id, m]));
      const numbers = generateMachineNumbers(fusionList.length);

      fusionList.forEach((fTool, i) => {
        const num = numbers[i];
        applyMachineNumberToFusion(fTool, num);
        const id = fTool.guid;
        const meta = metaById.get(id) || { id };
        metaById.set(id, { ...meta, machine_tool_number: num });
      });

      await uploadFusionList(fusionList);
      if (googleRef.current) await driveService.saveAllMetadata([...metaById.values()]);

      // Rebuild the in-memory library so the UI reflects the new numbers.
      const tools = fusionList.map(fTool => {
        const internal = fusionToolToInternal(fTool);
        return mergeFusionAndMetadata(internal, metaById.get(internal.id) || null);
      });
      dispatch({ type: 'SET_TOOLS', tools });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify(`Renumbered ${fusionList.length} tools starting at #30`, 'success');
      return fusionList.length;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Renumber failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  }, [downloadFusionList, uploadFusionList, notify]);

  const clearError = useCallback(() => dispatch({ type: 'CLEAR_ERROR' }), []);

  return (
    <AppContext.Provider value={{
      ...state,
      setGoogleUser,
      skipMetadata,
      setLibraryLocation,
      clearLibraryLocation,
      signOutAll,
      loadTools,
      fetchRawLibrary,
      saveTool,
      addTool,
      cloneTool,
      mergeTool,
      deleteTool,
      saveFullLibrary,
      renumberLibrary,
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
