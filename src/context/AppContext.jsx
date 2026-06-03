import { createContext, useContext, useReducer, useCallback, useEffect, useRef } from 'react';
import * as driveService from '../services/driveService.js';
import * as aps from '../services/apsService.js';
import {
  validateTool, generateId, generateAssemblyId, generateTrackingId,
  groupByTrackingId, buildLogicalTool, splitToFusionInstances, readTrackingId,
  getNextMachineNumber, generateMachineNumbers, applyMachineNumberToFusion,
  fusionToolToInternal, mergeFusionAndMetadata, readOohFromFusion,
} from '../schema/toolSchema.js';
import { composePresetName, opTypeWord, parsePresetName } from '../utils/presetNaming.js';
import { holderShortName } from '../utils/holderNaming.js';

const AppContext = createContext(null);

const LOCATION_KEY = 'aps_library_location';
const HOLDER_LOCATION_KEY = 'aps_holder_library_location';

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

const initialState = {
  user: null,                 // Google user (metadata identity) or null
  apsAuthenticated: false,    // Autodesk signed in
  googleAuthenticated: false, // Google signed in (metadata)
  metadataSkipped: false,     // user chose to proceed without Drive metadata
  libraryLocation: loadStoredLocation(), // { hubId, projectId, folderId, itemId, fileName }
  holderLibraryLocation: loadStoredHolderLocation(), // same shape, optional
  processingAuth: false,      // exchanging APS callback code
  tools: [],
  holders: [],                // loaded from Master-Holder library
  needsNormalize: false,      // true when any tool lacks a tracking ID (pre-migration)
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
    case 'SET_HOLDER_LOCATION': return { ...state, holderLibraryLocation: action.location };
    case 'CLEAR_HOLDER_LOCATION': return { ...state, holderLibraryLocation: null, holders: [] };
    case 'SET_HOLDERS': return { ...state, holders: action.holders };
    case 'SIGN_OUT':
      return {
        ...initialState,
        libraryLocation: state.libraryLocation, // keep saved location across sign-out
        holderLibraryLocation: state.holderLibraryLocation,
      };
    case 'LOAD_START': return { ...state, isLoading: true, error: null };
    case 'LOAD_SUCCESS': return { ...state, isLoading: false, tools: action.tools, needsNormalize: !!action.needsNormalize };
    case 'LOAD_ERROR': return { ...state, isLoading: false, error: action.error };
    case 'SAVE_START': return { ...state, isSaving: true, error: null };
    case 'SAVE_SUCCESS': return { ...state, isSaving: false };
    case 'SAVE_ERROR': return { ...state, isSaving: false, error: action.error };
    case 'ADD_TOOL': return { ...state, tools: [...state.tools, action.tool] };
    case 'UPDATE_TOOL':
      return { ...state, tools: state.tools.map(t => t.id === action.tool.id ? action.tool : t) };
    case 'DELETE_TOOL':
      return { ...state, tools: state.tools.filter(t => t.id !== action.id) };
    case 'SET_TOOLS': return { ...state, tools: action.tools, ...(action.needsNormalize !== undefined ? { needsNormalize: action.needsNormalize } : {}) };
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
  const holderLocationRef = useRef(state.holderLibraryLocation);
  const googleRef = useRef(state.googleAuthenticated);
  const toolsRef = useRef(state.tools);
  const holdersRef = useRef(state.holders);
  useEffect(() => { locationRef.current = state.libraryLocation; }, [state.libraryLocation]);
  useEffect(() => { holderLocationRef.current = state.holderLibraryLocation; }, [state.holderLibraryLocation]);
  useEffect(() => { googleRef.current = state.googleAuthenticated; }, [state.googleAuthenticated]);
  useEffect(() => { toolsRef.current = state.tools; }, [state.tools]);
  useEffect(() => { holdersRef.current = state.holders; }, [state.holders]);

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

  // ─── Holder library ───────────────────────────────────────────────────────
  const loadHolders = useCallback(async (location) => {
    const loc = location || holderLocationRef.current;
    if (!loc) return;
    try {
      const holders = await aps.loadHolderLibrary(loc.projectId, loc.itemId);
      dispatch({ type: 'SET_HOLDERS', holders });
    } catch (err) {
      notify(`Holder library load failed: ${err.message}`, 'error');
    }
  }, [notify]);

  const setHolderLibraryLocation = useCallback(async (location) => {
    localStorage.setItem(HOLDER_LOCATION_KEY, JSON.stringify(location));
    dispatch({ type: 'SET_HOLDER_LOCATION', location });
    await loadHolders(location);
  }, [loadHolders]);

  const clearHolderLibraryLocation = useCallback(() => {
    localStorage.removeItem(HOLDER_LOCATION_KEY);
    dispatch({ type: 'CLEAR_HOLDER_LOCATION' });
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
      const metaByTracking = new Map(metaList.map(m => [m.id, m]));

      // Group Fusion entries into logical tools by tracking ID. Entries without
      // a tracking ID are each their own single-instance tool until normalized.
      const { groups, untracked } = groupByTrackingId(fusionList);
      const tools = [];
      for (const [, raws] of groups) tools.push(buildLogicalTool(raws, metaByTracking));
      for (const raw of untracked) tools.push(buildLogicalTool([raw], metaByTracking));
      const needsNormalize = untracked.length > 0;

      dispatch({ type: 'LOAD_SUCCESS', tools, needsNormalize });
      // Load holder library alongside tools (non-critical — failure won't block)
      if (holderLocationRef.current) {
        try {
          const holders = await aps.loadHolderLibrary(
            holderLocationRef.current.projectId,
            holderLocationRef.current.itemId,
          );
          dispatch({ type: 'SET_HOLDERS', holders });
        } catch { /* non-critical */ }
      }
    } catch (err) {
      dispatch({ type: 'LOAD_ERROR', error: err.message });
    }
  }, [downloadFusionList]);

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

    const fusionList = await downloadFusionList();
    const freshByGuid = new Map(fusionList.map(f => [f.guid, f]));
    const refreshedRaws = assemblies.map(a => freshByGuid.get(a.instance_guid)).filter(Boolean);

    const toWrite = {
      ...tool,
      tracking_id,
      assemblies,
      _instancesRaw: refreshedRaws,
      _fusionRaw: refreshedRaws[0] || tool._fusionRaw || null,
    };

    const { fusionInstances, metadataTool } = splitToFusionInstances(toWrite, holders);
    const next = fusionList
      .filter(f => readTrackingId(f) !== tracking_id)
      .concat(fusionInstances);

    await uploadFusionList(next);
    if (googleRef.current) await driveService.upsertMetadata(metadataTool);

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
      const fusionList = await downloadFusionList();

      // Assign the next available machine tool number at save time so concurrent
      // adds don't collide. The number is app-managed (any value carried in is
      // ignored) and shared across every instance of the logical tool. Reading
      // post-process.number from each entry naturally dedupes, since all
      // instances of a tool share one number.
      const usedNumbers = new Set();
      for (const f of fusionList) {
        const n = f['post-process']?.number;
        if (n !== null && n !== undefined && n !== '') usedNumbers.add(Number(n));
      }
      for (const t of toolsRef.current) {
        const n = t.machine_tool_number;
        if (n !== null && n !== undefined && n !== '') usedNumbers.add(Number(n));
      }

      const tracking_id = generateTrackingId();
      const created = {
        ...tool,
        id: tracking_id,
        tracking_id,
        machine_tool_number: getNextMachineNumber([...usedNumbers]),
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
  }, [downloadFusionList, writeLogicalTool, notify]);

  // Duplicate an existing tool as a starting point for a new one.
  const cloneTool = useCallback(async (id) => {
    const source = toolsRef.current.find(t => t.id === id);
    if (!source) throw new Error('Tool not found');
    const now = new Date().toISOString();
    const copy = {
      ...source,
      id: generateId(),
      tracking_id: null,        // addTool assigns a fresh tracking ID
      description: `${source.description || 'Tool'} (copy)`,
      _fusionRaw: undefined,
      _instancesRaw: undefined,
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
      const fusionList = await downloadFusionList();
      let remaining;
      if (tool?.tracking_id) {
        // Delete every instance carrying this tracking ID.
        remaining = fusionList.filter(f => readTrackingId(f) !== tid);
      } else {
        // Legacy untracked tool — delete by its instance guids.
        const guids = new Set((tool?._instancesRaw || []).map(r => r.guid).concat([id]));
        remaining = fusionList.filter(f => !guids.has(f.guid));
      }
      await uploadFusionList(remaining);
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

  const saveFullLibrary = useCallback(async (tools) => {
    dispatch({ type: 'SAVE_START' });
    try {
      const holders = holdersRef.current || [];
      const fusionList = [];
      const metaList = [];
      for (const tool of tools) {
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
        fusionList.push(...fusionInstances);
        metaList.push(metadataTool);
      }
      await uploadFusionList(fusionList);
      if (googleRef.current) await driveService.saveAllMetadata(metaList);

      // Rebuild logical tools from what we wrote so in-memory state matches.
      const metaByTracking = new Map(metaList.map(m => [m.id, m]));
      const { groups, untracked } = groupByTrackingId(fusionList);
      const rebuilt = [];
      for (const [, raws] of groups) rebuilt.push(buildLogicalTool(raws, metaByTracking));
      for (const raw of untracked) rebuilt.push(buildLogicalTool([raw], metaByTracking));

      dispatch({ type: 'SET_TOOLS', tools: rebuilt, needsNormalize: untracked.length > 0 });
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
      const fusionList = await downloadFusionList();
      const metaList = googleRef.current ? await driveService.loadMetadata() : [];
      const metaByTracking = new Map(metaList.map(m => [m.id, m]));

      // One number per logical tool. Tracking-ID groups (in encounter order)
      // first, then each untracked entry as its own group.
      const { groups, untracked } = groupByTrackingId(fusionList);
      const orderedGroups = [...groups.values(), ...untracked.map(r => [r])];
      const numbers = generateMachineNumbers(orderedGroups.length);

      orderedGroups.forEach((raws, i) => {
        const num = numbers[i];
        raws.forEach(r => applyMachineNumberToFusion(r, num));
        const tid = readTrackingId(raws[0]);
        if (tid) {
          const meta = metaByTracking.get(tid) || { id: tid };
          metaByTracking.set(tid, { ...meta, machine_tool_number: num });
        }
      });

      await uploadFusionList(fusionList);
      if (googleRef.current) await driveService.saveAllMetadata([...metaByTracking.values()]);

      // Rebuild the in-memory library so the UI reflects the new numbers.
      const tools = [];
      for (const [, raws] of groups) tools.push(buildLogicalTool(raws, metaByTracking));
      for (const raw of untracked) tools.push(buildLogicalTool([raw], metaByTracking));
      dispatch({ type: 'SET_TOOLS', tools });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify(`Renumbered ${orderedGroups.length} tools starting at #30`, 'success');
      return orderedGroups.length;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Renumber failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  }, [downloadFusionList, uploadFusionList, notify]);

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
      const fusionList = await downloadFusionList();
      const metaList = googleRef.current ? await driveService.loadMetadata() : [];
      const metaByGuid = new Map(metaList.map(m => [m.id, m]));
      const metaByTracking = new Map(metaList.map(m => [m.id, m]));

      const { groups, untracked } = groupByTrackingId(fusionList);
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
        const assemblies = oldAssemblies.length
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

        // Rename presets to the convention against the primary assembly, and set
        // operation_type (name wins, else the user-supplied override).
        const primary = assemblies[0];
        const primaryHolderShort = holderShortName(primary.holder_description || '');
        const presets = (merged.presets || []).map(p => {
          const opType = parsePresetName(p.name)?.opType ?? opOverrides[p.guid] ?? p.operation_type ?? null;
          const name = opTypeWord(opType)
            ? composePresetName({
                materialQuery: p.material?.query,
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
          assemblies,
          presets,
          _instancesRaw: [raw],
          _fusionRaw: raw,
        });
      }

      await saveFullLibrary(logicalTools);
      notify(`Normalized ${untracked.length} tool${untracked.length === 1 ? '' : 's'} to the multi-instance model`, 'success', 6000);
      return untracked.length;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Normalize failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  }, [downloadFusionList, saveFullLibrary, notify]);

  const clearError = useCallback(() => dispatch({ type: 'CLEAR_ERROR' }), []);

  return (
    <AppContext.Provider value={{
      ...state,
      holderLibrarySetupComplete: !!state.holderLibraryLocation,
      setGoogleUser,
      skipMetadata,
      setLibraryLocation,
      clearLibraryLocation,
      setHolderLibraryLocation,
      clearHolderLibraryLocation,
      loadHolders,
      signOutAll,
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
      saveFullLibrary,
      renumberLibrary,
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
