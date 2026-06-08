import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Upload, Image, FileText, Box, Layers, File, Camera } from 'lucide-react';

const FILE_TYPES = [
  { value: 'photo', label: 'Photo' },
  { value: 'spec_sheet', label: 'Spec Sheet' },
  { value: 'model_3d', label: '3D Model' },
  { value: 'fusion_file', label: 'Fusion File' },
  { value: 'other', label: 'Other' },
];

const MODEL_EXTS = ['.step', '.stp', '.stl', '.iges', '.igs'];

function getExt(name = '') {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i) : '';
}

function baseName(name = '') {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(0, i) : name;
}

function autoDetectType(file) {
  if (file.type.startsWith('image/')) return 'photo';
  const ext = getExt(file.name).toLowerCase();
  if (ext === '.pdf') return 'spec_sheet';
  if (MODEL_EXTS.includes(ext)) return 'model_3d';
  if (ext === '.f3d' || ext === '.fusion') return 'fusion_file';
  return 'other';
}

function FileTypeIcon({ file, size = 36 }) {
  const ext = getExt(file?.name || '').toLowerCase();
  if (file?.type?.startsWith('image/')) return <Image size={size} style={{ color: 'var(--blue)' }} />;
  if (ext === '.pdf') return <FileText size={size} style={{ color: 'var(--orange)' }} />;
  if (MODEL_EXTS.includes(ext)) return <Box size={size} style={{ color: '#2dd4bf' }} />;
  if (ext === '.f3d' || ext === '.fusion') return <Layers size={size} style={{ color: 'var(--blue)' }} />;
  return <File size={size} style={{ color: 'var(--text-sub)' }} />;
}

export default function AttachmentUploadModal({ open, onClose, onUpload, photoMode = false }) {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [name, setName] = useState('');
  const [fileType, setFileType] = useState(photoMode ? 'photo' : 'other');
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);
  const prevPreviewRef = useRef(null);

  const isImage = !!file?.type?.startsWith('image/');

  // Build/revoke preview URL when file changes
  useEffect(() => {
    if (prevPreviewRef.current) {
      URL.revokeObjectURL(prevPreviewRef.current);
      prevPreviewRef.current = null;
    }
    if (file && isImage) {
      const url = URL.createObjectURL(file);
      prevPreviewRef.current = url;
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
    return () => {
      if (prevPreviewRef.current) URL.revokeObjectURL(prevPreviewRef.current);
    };
  }, [file, isImage]);

  const selectFile = useCallback((f) => {
    setFile(f);
    setName(baseName(f.name));
    setError('');
    if (!photoMode) setFileType(autoDetectType(f));
  }, [photoMode]);

  // Clipboard paste support while the modal is open
  useEffect(() => {
    if (!open) return;
    const onPaste = (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      const fileItem = items.find(i => i.kind === 'file');
      if (fileItem) {
        const f = fileItem.getAsFile();
        if (f) selectFile(f);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [open, selectFile]);

  // Reset state on close
  useEffect(() => {
    if (!open) {
      setFile(null);
      setName('');
      setError('');
      setUploading(false);
      setDragOver(false);
    }
  }, [open]);

  if (!open) return null;

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) selectFile(f);
  };

  const handleUpload = async () => {
    if (!file) return;
    const ext = getExt(file.name);
    const finalName = (name.trim() || baseName(file.name)) + ext;
    setUploading(true);
    setError('');
    try {
      await onUpload(file, finalName, fileType);
      onClose();
    } catch (err) {
      setError(err.message || 'Upload failed');
      setUploading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 className="modal-title" style={{ marginBottom: 0 }}>
            {photoMode ? 'Add Photo' : 'Add Attachment'}
          </h3>
          <button className="icon-btn" onClick={onClose} title="Close"><X size={16} /></button>
        </div>

        {/* Drop zone */}
        <div
          className={`upload-dropzone${dragOver ? ' dragover' : ''}${file ? ' has-file' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => !file && fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && !file && fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: 'none' }}
            accept={photoMode ? 'image/*' : undefined}
            onChange={e => { const f = e.target.files[0]; if (f) selectFile(f); e.target.value = ''; }}
          />
          {file ? (
            <div className="upload-preview">
              {isImage && previewUrl ? (
                <img src={previewUrl} alt="preview" className="upload-preview-img" />
              ) : (
                <div className="upload-preview-icon">
                  <FileTypeIcon file={file} size={40} />
                  <span className="text-sub" style={{ fontSize: 12, marginTop: 4 }}>{file.name}</span>
                </div>
              )}
              <button
                className="upload-change-btn"
                onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
              >
                Change file
              </button>
            </div>
          ) : (
            <div className="upload-dropzone-hint">
              {photoMode ? <Camera size={28} style={{ color: 'var(--text-sub)' }} /> : <Upload size={28} style={{ color: 'var(--text-sub)' }} />}
              <div>
                Drop here, paste (Ctrl+V), or{' '}
                <span style={{ color: 'var(--blue)', cursor: 'pointer' }}>browse</span>
              </div>
              {photoMode && <div className="text-sub" style={{ fontSize: 11 }}>Images only</div>}
            </div>
          )}
        </div>

        {file && (
          <div style={{ marginTop: 14 }}>
            <label className="field-label">File name</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                className="field-input"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="filename"
                style={{ flex: 1 }}
                autoFocus
              />
              <span className="text-sub" style={{ fontSize: 13, flexShrink: 0 }}>
                {getExt(file.name)}
              </span>
            </div>

            {!photoMode && (
              <div style={{ marginTop: 10 }}>
                <label className="field-label">Type</label>
                <select
                  className="field-input"
                  value={fileType}
                  onChange={e => setFileType(e.target.value)}
                >
                  {FILE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            )}
          </div>
        )}

        {error && <div className="error-banner" style={{ marginTop: 10 }}>{error}</div>}

        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={uploading}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleUpload}
            disabled={!file || uploading}
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}
