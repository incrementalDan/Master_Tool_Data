import { useState } from 'react';
import { Paperclip, Download, X, Image, FileText, Box, Layers, File, Plus, Loader, TrendingUp } from 'lucide-react';
import AttachmentUploadModal from './AttachmentUploadModal.jsx';
import { fetchFileBlob } from '../services/driveService.js';

const TYPE_ORDER = ['photo', 'spec_sheet', 'speeds_feeds', 'model_3d', 'fusion_file', 'other'];
const TYPE_LABELS = {
  photo: 'Photos',
  spec_sheet: 'Spec Sheets',
  speeds_feeds: 'Speeds & Feeds',
  model_3d: '3D Models',
  fusion_file: 'Fusion Files',
  other: 'Other',
};

const MODEL_EXTS = ['.step', '.stp', '.stl', '.iges', '.igs'];

function getExt(name = '') {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function isImageFile(filename) {
  return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'].includes(getExt(filename));
}

function isPdfFile(filename) {
  return getExt(filename) === '.pdf';
}

function AttIcon({ filename, type, size = 14 }) {
  const ext = getExt(filename);
  if (isImageFile(filename)) return <Image size={size} style={{ color: 'var(--blue)', flexShrink: 0 }} />;
  if (ext === '.pdf') return <FileText size={size} style={{ color: 'var(--orange)', flexShrink: 0 }} />;
  if (MODEL_EXTS.includes(ext)) return <Box size={size} style={{ color: '#2dd4bf', flexShrink: 0 }} />;
  if (ext === '.f3d' || ext === '.fusion') return <Layers size={size} style={{ color: 'var(--blue)', flexShrink: 0 }} />;
  if (type === 'speeds_feeds') return <TrendingUp size={size} style={{ color: '#a78bfa', flexShrink: 0 }} />;
  return <File size={size} style={{ color: 'var(--text-sub)', flexShrink: 0 }} />;
}

export default function FilesSection({ tool, googleAuthenticated, onUpload, onDelete }) {
  const [open, setOpen] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [viewingId, setViewingId] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [pendingUploads, setPendingUploads] = useState([]);

  const attachments = tool.attachments || [];
  const count = attachments.length + pendingUploads.length;
  const isUploading = pendingUploads.some(p => !p.error);

  // Group existing + pending items by type, in display order
  const grouped = TYPE_ORDER
    .map(type => ({
      type,
      items: attachments.filter(a => a.type === type),
      pending: pendingUploads.filter(p => p.type === type),
    }))
    .filter(g => g.items.length > 0 || g.pending.length > 0);

  const handleView = async (att) => {
    if (isPdfFile(att.filename)) {
      window.open(`https://drive.google.com/file/d/${att.file_id}/preview`, '_blank', 'noopener');
      return;
    }
    if (isImageFile(att.filename)) {
      setViewingId(att.file_id);
      try {
        const blob = await fetchFileBlob(att.file_id);
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank', 'noopener');
        // Do NOT revoke: browser tab holds its own reference; GC'd when tab closes.
      } catch { /* non-critical — token expiry shows toast elsewhere */ }
      finally { setViewingId(null); }
    }
  };

  const handleDownload = async (att) => {
    setDownloadingId(att.file_id);
    try {
      const blob = await fetchFileBlob(att.file_id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = att.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { /* non-critical */ }
    finally { setDownloadingId(null); }
  };

  const handleOpen = (att) => {
    if (viewingId === att.file_id || downloadingId === att.file_id) return;
    if (isPdfFile(att.filename) || isImageFile(att.filename)) {
      handleView(att);
    } else {
      handleDownload(att);
    }
  };

  const handleDelete = async (fileId) => {
    setDeletingId(fileId);
    setConfirmDeleteId(null);
    try {
      await onDelete(fileId);
    } finally {
      setDeletingId(null);
    }
  };

  const dismissPendingError = (tmpId) => {
    setPendingUploads(prev => prev.filter(p => p.tmpId !== tmpId));
  };

  // Resolves immediately so the modal closes at once; upload continues in background.
  const wrappedOnUpload = (file, filename, type) => {
    const tmpId = String(Date.now());
    setPendingUploads(prev => [...prev, { tmpId, filename, type }]);
    onUpload(file, filename, type)
      .then(() => setPendingUploads(prev => prev.filter(p => p.tmpId !== tmpId)))
      .catch(err => setPendingUploads(prev => prev.map(p =>
        p.tmpId === tmpId ? { ...p, error: err.message || 'Upload failed' } : p
      )));
    return Promise.resolve();
  };

  return (
    <div className={`panel ${open ? 'open' : ''}`}>
      <button className="panel-header" onClick={() => setOpen(o => !o)}>
        <Paperclip size={15} className="panel-header-icon" />
        <span className="panel-header-title">
          Files &amp; Attachments
          {count > 0 && <span className="files-count-badge">{count}</span>}
        </span>
        {isUploading && (
          <span className="files-uploading-pill">
            <Loader size={10} className="files-spin" /> uploading
          </span>
        )}
        <span className="panel-chevron">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="panel-body">
          {!googleAuthenticated && (
            <p className="text-sub text-sm" style={{ marginBottom: 10 }}>
              Connect Google Drive in Settings to upload and manage files.
            </p>
          )}

          {isUploading && (
            <div className="files-upload-notice">
              <Loader size={12} className="files-spin" />
              Uploading… editing is disabled until complete
            </div>
          )}

          {grouped.length === 0 ? (
            <div className="detail-field-empty text-sm" style={{ marginBottom: googleAuthenticated ? 10 : 0 }}>
              No files attached.
            </div>
          ) : (
            <div className="files-groups">
              {grouped.map(({ type, items, pending }) => (
                <div key={type} className={`files-group files-group--${type}`}>
                  <div className="files-group-header">{TYPE_LABELS[type]}</div>
                  <div className="files-grid">
                    {items.map(att => {
                      const isDeleting = deletingId === att.file_id;
                      const isConfirm = confirmDeleteId === att.file_id;
                      const isBusy = viewingId === att.file_id || downloadingId === att.file_id || isDeleting;
                      return (
                        <div
                          key={att.file_id}
                          className={`files-card${isBusy ? ' files-card--busy' : ''}`}
                          onDoubleClick={() => !isConfirm && handleOpen(att)}
                          title={isConfirm ? undefined : `Double-click to open · ${att.filename}`}
                        >
                          {isConfirm ? (
                            <div className="files-card-confirm">
                              <span className="files-card-confirm-label">Delete?</span>
                              <button
                                className="icon-btn"
                                style={{ color: 'var(--red)', fontSize: 11, padding: '1px 5px', width: 'auto' }}
                                onClick={() => handleDelete(att.file_id)}
                              >
                                Yes
                              </button>
                              <button className="icon-btn" title="Cancel" onClick={() => setConfirmDeleteId(null)}>
                                <X size={11} />
                              </button>
                            </div>
                          ) : (
                            <>
                              {isBusy
                                ? <Loader size={13} className="files-spin" style={{ flexShrink: 0, color: 'var(--text-sub)' }} />
                                : <AttIcon filename={att.filename} type={att.type} />}
                              <span className="files-card-name" title={att.filename}>{att.filename}</span>
                              <button
                                className="icon-btn files-card-delete"
                                title="Remove file"
                                onClick={e => { e.stopPropagation(); setConfirmDeleteId(att.file_id); }}
                                disabled={isDeleting}
                              >
                                <X size={12} />
                              </button>
                            </>
                          )}
                        </div>
                      );
                    })}

                    {pending.map(p => (
                      <div key={p.tmpId} className={`files-card files-card--pending${p.error ? ' files-card--error' : ''}`}>
                        {p.error ? (
                          <>
                            <span className="files-card-name" title={p.error} style={{ color: 'var(--red)' }}>
                              ✕ {p.filename}
                            </span>
                            <button
                              className="icon-btn files-card-delete"
                              title="Dismiss"
                              onClick={() => dismissPendingError(p.tmpId)}
                            >
                              <X size={12} />
                            </button>
                          </>
                        ) : (
                          <>
                            <Loader size={13} className="files-spin" style={{ flexShrink: 0, color: 'var(--text-sub)' }} />
                            <span className="files-card-name" style={{ color: 'var(--text-sub)' }}>{p.filename}</span>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {googleAuthenticated && (
            <button
              className="btn btn-secondary btn-sm"
              style={{ marginTop: grouped.length > 0 ? 10 : 0, display: 'flex', alignItems: 'center', gap: 5 }}
              onClick={() => setShowUploadModal(true)}
            >
              <Plus size={13} /> Add File
            </button>
          )}

          {showUploadModal && (
            <AttachmentUploadModal
              open={showUploadModal}
              onClose={() => setShowUploadModal(false)}
              onUpload={wrappedOnUpload}
              photoMode={false}
            />
          )}
        </div>
      )}
    </div>
  );
}
