// Tool file attachments (Google Drive storage): primary photo + attachment
// upload/delete, and the one-time ProShop photo bulk import. Created once by
// AppProvider via createAttachmentActions(ctx); writeLogicalTool is injected
// from the tool-actions factory.
import * as driveService from '../services/driveService.js';
import { buildMetadataTool } from '../schema/toolSchema.js';

export function createAttachmentActions(ctx) {
  const {
    dispatch, notify, markSetupStepInSettings, writeLogicalTool,
    toolsRef, googleRef,
  } = ctx;

  const uploadToolPhoto = async (tool, file, fileName) => {
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
  };

  const uploadToolAttachment = async (tool, file, fileName, fileType) => {
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
  };

  const deleteToolAttachment = async (tool, fileId, isPrimary = false) => {
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
  };

  // ─── One-time: import ProShop tool photos from a Drive folder ─────────────
  // The picked folder holds one main photo file PER TOOL at its top level, named
  // "tools_{tool_id}_….{png|jpg|gif|webp|avif}". (Same-named subfolders hold only the
  // 300/600/900w resized variants — ignored; we never descend into them.) Each
  // main photo is copied into the matching tool's tool_files folder and set as
  // its primary photo. Read-only on the source; skips tools with no match or an
  // existing photo; changes only metadata (primary_photo_id/name), so it writes
  // metadata once at the end rather than rewriting the Fusion library per tool.
  const importProShopPhotos = async (sourceFolderId, { onProgress } = {}) => {
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
  };

  return { uploadToolPhoto, uploadToolAttachment, deleteToolAttachment, importProShopPhotos };
}
