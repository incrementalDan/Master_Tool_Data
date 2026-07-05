// Primary-photo slot (photo display + add/change/remove controls). Extracted
// from ToolDetail so component records (holder body / insert — see
// insertFamilies.js) can reuse it: `record` is anything carrying
// primary_photo_id / primary_photo_name / description.
import { useState, useEffect, useRef } from 'react';
import { Camera, X } from 'lucide-react';
import { fetchFileBlob } from '../services/driveService.js';

export default function PhotoSlot({ record, googleAuthenticated, onChangePhoto, onDeletePhoto }) {
  const [photoUrl, setPhotoUrl] = useState(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const objectUrlRef = useRef(null);

  useEffect(() => {
    setPhotoUrl(null);
    setPhotoLoading(false);
    if (!record.primary_photo_id || !googleAuthenticated) return;
    let cancelled = false;
    setPhotoLoading(true);
    fetchFileBlob(record.primary_photo_id)
      .then(blob => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setPhotoUrl(url);
      })
      .catch(() => { if (!cancelled) setPhotoUrl(null); })
      .finally(() => { if (!cancelled) setPhotoLoading(false); });
    return () => {
      cancelled = true;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [record.primary_photo_id, googleAuthenticated]);

  const hasPhoto = !!photoUrl;

  return (
    <div>
      <div
        className="identity-photo-slot"
        onClick={!hasPhoto && googleAuthenticated ? onChangePhoto : undefined}
        style={{ cursor: !hasPhoto && googleAuthenticated ? 'pointer' : 'default' }}
        title={!hasPhoto && googleAuthenticated ? 'Add photo' : undefined}
      >
        {photoLoading ? (
          <div className="identity-photo-placeholder">
            <Camera size={24} />
            <span style={{ fontSize: 11 }}>Loading…</span>
          </div>
        ) : hasPhoto ? (
          <img src={photoUrl} alt={record.description || 'Tool'} className="identity-photo-img" />
        ) : (
          <div className="identity-photo-placeholder">
            <Camera size={24} />
            {googleAuthenticated && <span style={{ fontSize: 11 }}>Add photo</span>}
          </div>
        )}
      </div>

      {googleAuthenticated && (
        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
          <button
            className="btn btn-ghost btn-sm"
            style={{ flex: 1, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
            onClick={onChangePhoto}
          >
            <Camera size={12} /> {hasPhoto ? 'Change' : 'Add photo'}
          </button>
          {hasPhoto && !confirmRemove && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 11, color: 'var(--text-sub)' }}
              title="Remove photo"
              onClick={() => setConfirmRemove(true)}
            >
              <X size={12} />
            </button>
          )}
          {hasPhoto && confirmRemove && (
            <>
              <button
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 11, color: 'var(--red)' }}
                onClick={async () => { setConfirmRemove(false); await onDeletePhoto(); }}
              >
                Remove
              </button>
              <button
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 11 }}
                onClick={() => setConfirmRemove(false)}
              >
                <X size={12} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
