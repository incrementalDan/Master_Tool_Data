import { useState } from 'react';
import { Paperclip, Eye, Download, X, Image, FileText, Box, Layers, File, Plus } from 'lucide-react';
import AttachmentUploadModal from './AttachmentUploadModal.jsx';
import { fetchFileBlob } from '../services/driveService.js';

const TYPE_LABELS = {
  photo: 'Photo',
  spec_sheet: 'Spec Sheet',
  model_3d: '3D Model',
  fusion_file: 'Fusion File',
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

function AttIcon({ filename, size = 15 }) {
  const ext = getExt(filename);
  if (isImageFile(filename)) return <Image size={size} style={{ color: 'var(--blue)', flexShrink: 0 }} />;
  if (ext === '.pdf') return <FileText size={size} style={{ color: 'var(--orange)', flexShrink: 0 }} />;
  if (MODEL_EXTS.includes(ext)) return <Box size={size} style={{ color: '#2dd4bf', flexShrink: 0 }} />;
  if (ext === '.f3d' || ext === '.fusion') return <Layers size={size} style={{ color: 'var(--blue)', flexShrink: 0 }} />;
  return <File size={size} style={{ color: 'var(--text-sub)', flexShrink: 0 }} />;
}

export default function FilesSection({ tool, googleAuthenticated, onUpload, onDelete }) {
  const [open, setOpen] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [viewingId, setViewingId] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const attachments = tool.attachments || [];
  const count = attachments.length;

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
        // Do NOT revoke: the browser tab holds its own reference and may still
        // be loading a large image. The URL is GC'd when the tab closes.
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

  const handleDelete = async (fileId) => {
    setDeletingId(fileId);
    setConfirmDeleteId(null);
    try {
      await onDelete(fileId);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className={`panel ${open ? 'open' : ''}`}>
      <button className="panel-header" onClick={() => setOpen(o => !o)}>
        <Paperclip size={15} className="panel-header-icon" />
        <span className="panel-header-title">
          Files &amp; Attachments
          {count > 0 && <span className="files-count-badge">{count}</span>}
        </span>
        <span className="panel-chevron">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="panel-body">
          {!googleAuthenticated && (
            <p className="text-sub text-sm" style={{ marginBottom: 10 }}>
              Connect Google Drive in Settings to upload and manage files.
            </p>
          )}

          {count === 0 ? (
            <div className="detail-field-empty text-sm" style={{ marginBottom: googleAuthenticated ? 10 : 0 }}>
              No files attached.
            </div>
          ) : (
            <div className="files-list">
              {attachments.map(att => {
                const canView = isImageFile(att.filename) || isPdfFile(att.filename);
                const isDeleting = deletingId === att.file_id;
                const isConfirm = confirmDeleteId === att.file_id;
                return (
                  <div key={att.file_id} className="files-list-item">
                    <AttIcon filename={att.filename} />
                    <span className="files-list-name" title={att.filename}>{att.filename}</span>
                    <span className="files-list-type text-sub">{TYPE_LABELS[att.type] || att.type}</span>
                    <div className="files-list-actions">
                      {canView ? (
                        <button
                          className="icon-btn"
                          title="View"
                          onClick={() => handleView(att)}
                          disabled={viewingId === att.file_id}
                        >
                          {viewingId === att.file_id ? <span style={{ fontSize: 10 }}>…</span> : <Eye size={14} />}
                        </button>
                      ) : (
                        <button
                          className="icon-btn"
                          title="Download"
                          onClick={() => handleDownload(att)}
                          disabled={downloadingId === att.file_id}
                        >
                          {downloadingId === att.file_id ? <span style={{ fontSize: 10 }}>…</span> : <Download size={14} />}
                        </button>
                      )}
                      {isConfirm ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <button
                            className="icon-btn"
                            style={{ color: 'var(--red)', fontSize: 11, padding: '2px 6px', width: 'auto' }}
                            onClick={() => handleDelete(att.file_id)}
                            disabled={isDeleting}
                          >
                            {isDeleting ? '…' : 'Delete?'}
                          </button>
                          <button className="icon-btn" title="Cancel" onClick={() => setConfirmDeleteId(null)}>
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        <button
                          className="icon-btn"
                          title="Remove file"
                          onClick={() => setConfirmDeleteId(att.file_id)}
                          disabled={isDeleting}
                        >
                          {isDeleting ? <span style={{ fontSize: 10 }}>…</span> : <X size={14} />}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {googleAuthenticated && (
            <button
              className="btn btn-secondary btn-sm"
              style={{ marginTop: count > 0 ? 10 : 0, display: 'flex', alignItems: 'center', gap: 5 }}
              onClick={() => setShowUploadModal(true)}
            >
              <Plus size={13} /> Add File
            </button>
          )}

          {showUploadModal && (
            <AttachmentUploadModal
              open={showUploadModal}
              onClose={() => setShowUploadModal(false)}
              onUpload={onUpload}
              photoMode={false}
            />
          )}
        </div>
      )}
    </div>
  );
}
