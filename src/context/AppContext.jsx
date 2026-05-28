import { createContext, useContext, useReducer, useCallback } from 'react';
import * as driveService from '../services/driveService.js';
import { validateTool, generateId } from '../schema/toolSchema.js';

const AppContext = createContext(null);

const initialState = {
  user: null,
  tools: [],
  isLoading: false,
  isSaving: false,
  error: null,
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_USER':
      return { ...state, user: action.user };
    case 'LOAD_START':
      return { ...state, isLoading: true, error: null };
    case 'LOAD_SUCCESS':
      return { ...state, isLoading: false, tools: action.tools };
    case 'LOAD_ERROR':
      return { ...state, isLoading: false, error: action.error };
    case 'SAVE_START':
      return { ...state, isSaving: true, error: null };
    case 'SAVE_SUCCESS':
      return { ...state, isSaving: false };
    case 'SAVE_ERROR':
      return { ...state, isSaving: false, error: action.error };
    case 'ADD_TOOL':
      return { ...state, tools: [...state.tools, action.tool] };
    case 'UPDATE_TOOL':
      return {
        ...state,
        tools: state.tools.map(t => t.id === action.tool.id ? action.tool : t),
      };
    case 'DELETE_TOOL':
      return { ...state, tools: state.tools.filter(t => t.id !== action.id) };
    case 'SET_TOOLS':
      return { ...state, tools: action.tools };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    default:
      return state;
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const setUser = useCallback((user) => {
    dispatch({ type: 'SET_USER', user });
    if (user) {
      driveService.setUserInfo(user);
    }
  }, []);

  const loadTools = useCallback(async () => {
    dispatch({ type: 'LOAD_START' });
    try {
      const tools = await driveService.loadLibrary();
      dispatch({ type: 'LOAD_SUCCESS', tools });
    } catch (err) {
      dispatch({ type: 'LOAD_ERROR', error: err.message });
    }
  }, []);

  const saveTool = useCallback(async (tool) => {
    const { valid, errors } = validateTool(tool);
    if (!valid) throw new Error(errors.join(', '));

    dispatch({ type: 'SAVE_START' });
    try {
      const updated = { ...tool, updated_at: new Date().toISOString() };
      await driveService.mergeTool(updated);
      dispatch({ type: 'UPDATE_TOOL', tool: updated });
      dispatch({ type: 'SAVE_SUCCESS' });
      return updated;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      throw err;
    }
  }, []);

  const addTool = useCallback(async (tool) => {
    const { valid, errors } = validateTool(tool);
    if (!valid) throw new Error(errors.join(', '));

    const now = new Date().toISOString();
    const newTool = {
      ...tool,
      id: tool.id || generateId(),
      created_at: tool.created_at || now,
      updated_at: now,
    };

    dispatch({ type: 'SAVE_START' });
    try {
      await driveService.mergeTool(newTool);
      dispatch({ type: 'ADD_TOOL', tool: newTool });
      dispatch({ type: 'SAVE_SUCCESS' });
      return newTool;
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      throw err;
    }
  }, []);

  const deleteTool = useCallback(async (id) => {
    dispatch({ type: 'SAVE_START' });
    try {
      await driveService.deleteToolFromDrive(id);
      dispatch({ type: 'DELETE_TOOL', id });
      dispatch({ type: 'SAVE_SUCCESS' });
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      throw err;
    }
  }, []);

  const saveFullLibrary = useCallback(async (tools) => {
    dispatch({ type: 'SAVE_START' });
    try {
      await driveService.saveFullLibrary(tools);
      dispatch({ type: 'SET_TOOLS', tools });
      dispatch({ type: 'SAVE_SUCCESS' });
    } catch (err) {
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      throw err;
    }
  }, []);

  const clearError = useCallback(() => dispatch({ type: 'CLEAR_ERROR' }), []);

  return (
    <AppContext.Provider value={{
      ...state,
      setUser,
      loadTools,
      saveTool,
      addTool,
      deleteTool,
      saveFullLibrary,
      clearError,
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
