// Holder body / insert component record actions (insert-style tools — see
// src/schema/insertFamilies.js). Components are metadata-only records in
// tool_components.json on Drive: saving one is a shared-file write (optimistic
// + debounced via saveComponents), never a Fusion library round-trip. Created
// once by AppProvider via createComponentActions(ctx).
import * as driveService from '../services/driveService.js';

export function createComponentActions(ctx) {
  const { dispatch, notify, googleRef, componentsRef, saveComponents } = ctx;

  // Upsert one component record into the components file. Returns the record
  // as saved (with a fresh updated_at).
  const saveComponent = async (component) => {
    const file = componentsRef.current || { version: 1, components: [] };
    const list = file.components || [];
    const now = new Date().toISOString();
    const next = { ...component, updated_at: now };
    const exists = list.some(c => c.id === component.id);
    const components = exists
      ? list.map(c => (c.id === component.id ? next : c))
      : [...list, { ...next, created_at: component.created_at || now }];
    await saveComponents({ ...file, components });
    return next;
  };

  // Assign (or clear — pass null) a component's structured location. Same
  // Location System data shape as a tool's tool_location; metadata-only, so no
  // Fusion write is involved.
  const assignComponentLocation = async (component, toolLocation, binSizeId = null) => {
    const saved = await saveComponent({
      ...component,
      tool_location: toolLocation,
      bin_size_id: toolLocation ? binSizeId : null,
    });
    notify(toolLocation ? 'Location saved' : 'Location cleared', 'success');
    return saved;
  };

  // Component photos reuse the tool-file storage: tool_files/{component id}/
  // under the metadata root (ensureToolFolder works with any stable id).
  const uploadComponentPhoto = async (component, file, fileName) => {
    if (!googleRef.current) {
      notify('Connect Google Drive to upload photos', 'error');
      throw new Error('Google Drive not connected');
    }
    dispatch({ type: 'SAVE_START' });
    try {
      const folderId = await driveService.ensureToolFolder(component.id);
      const driveFile = await driveService.uploadToolFile(folderId, file, fileName);
      const saved = await saveComponent({
        ...component,
        primary_photo_id: driveFile.id,
        primary_photo_name: fileName,
      });
      dispatch({ type: 'SAVE_SUCCESS' });
      notify('Photo saved', 'success');
      return saved;
    } catch (err) {
      if (err.code === 'TOKEN_EXPIRED') dispatch({ type: 'GOOGLE_EXPIRED' });
      dispatch({ type: 'SAVE_ERROR', error: err.message });
      notify(`Photo upload failed: ${err.message}`, 'error', 7000);
      throw err;
    }
  };

  const deleteComponentPhoto = async (component) => {
    if (!googleRef.current) {
      notify('Connect Google Drive to manage files', 'error');
      throw new Error('Google Drive not connected');
    }
    try {
      await driveService.deleteToolFile(component.primary_photo_id);
    } catch (err) {
      if (err.code === 'TOKEN_EXPIRED') dispatch({ type: 'GOOGLE_EXPIRED' });
      // Same rule as deleteToolAttachment: a real Drive failure must not
      // silently proceed to wipe the record — that would orphan the file.
      notify(`Could not delete photo from Drive: ${err.message}`, 'error', 7000);
      throw err;
    }
    const saved = await saveComponent({
      ...component,
      primary_photo_id: null,
      primary_photo_name: null,
    });
    notify('Photo removed', 'success');
    return saved;
  };

  return { saveComponent, assignComponentLocation, uploadComponentPhoto, deleteComponentPhoto };
}
