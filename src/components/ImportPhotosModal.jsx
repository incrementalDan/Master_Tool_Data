import { useState, useEffect } from 'react';
import { X, Folder, Home, ChevronRight, Image as ImageIcon, CheckCircle, AlertTriangle } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { listFolders, listSharedDrives } from '../services/driveService.js';

// One-time importer: copy existing ProShop tool photos out of a Drive folder
// into each tool's attachment storage as its primary photo. The source folder
// is browsed fresh each run (nothing is saved). Matching + copying lives in
// AppContext.importProShopPhotos; this modal is the folder picker + progress.
export default function ImportPhotosModal({ onClose }) {
  const { importProShopPhotos, googleAuthenticated } = useApp();

  const [view, setView] = useState('picker'); // 'picker' | 'running' | 'done'
  const [error, setError] = useState('');

  // Folder browser state (mirrors MetadataConnect's picker).
  const [sharedDrives, setSharedDrives] = useState([]);
  const [stack, setStack] = useState([]); // breadcrumb of { id, name }
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pickerRoot, setPickerRoot] = useState('myDrive'); // 'myDrive' | drive-id

  const [progress, setProgress] = useState({ done: 0, total: 0, current: '' });
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    if (googleAuthenticated) loadRoot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadRoot() {
    setLoading(true);
    setError('');
    try {
      const [drives, rootFolders] = await Promise.all([listSharedDrives(), listFolders('root')]);
      setSharedDrives(drives);
      setFolders(rootFolders);
      setStack([]);
      setPickerRoot('myDrive');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function openFolder(folder) {
    setLoading(true);
    setError('');
    try {
      const children = await listFolders(folder.id);
      setStack(s => [...s, { id: folder.id, name: folder.name }]);
      setFolders(children);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function navigateToCrumb(index) {
    setLoading(true);
    setError('');
    try {
      if (index < 0) {
        const parentId = pickerRoot === 'myDrive' ? 'root' : pickerRoot;
        setFolders(await listFolders(parentId));
        setStack([]);
      } else {
        const target = stack[index];
        setFolders(await listFolders(target.id));
        setStack(s => s.slice(0, index + 1));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function selectSharedDrive(drive) {
    setLoading(true);
    setError('');
    setPickerRoot(drive.id);
    try {
      setFolders(await listFolders(drive.id));
      setStack([{ id: drive.id, name: drive.name }]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // The folder we're currently inside — this is what gets imported.
  const currentFolderId = stack.length ? stack[stack.length - 1].id
    : pickerRoot === 'myDrive' ? 'root' : pickerRoot;
  const currentFolderName = stack.length ? stack[stack.length - 1].name
    : pickerRoot === 'myDrive' ? 'My Drive' : (sharedDrives.find(d => d.id === pickerRoot)?.name || 'Drive');
  const atRoot = !stack.length;

  async function runImport() {
    setView('running');
    setError('');
    setProgress({ done: 0, total: 0, current: '' });
    try {
      const result = await importProShopPhotos(currentFolderId, {
        onProgress: p => setProgress(p),
      });
      setSummary(result);
      setView('done');
    } catch (err) {
      setError(err.message || 'Import failed');
      setView('picker');
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="modal-backdrop" onClick={view === 'running' ? undefined : onClose}>
      <div className="modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 className="modal-title" style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ImageIcon size={17} /> Import ProShop Photos
          </h3>
          {view !== 'running' && (
            <button className="icon-btn" onClick={onClose} title="Close"><X size={16} /></button>
          )}
        </div>

        {error && <div className="error-banner mb-12">{error}</div>}

        {!googleAuthenticated && (
          <p className="text-sub text-sm">Connect Google Drive first to import photos.</p>
        )}

        {/* ── Folder picker ─────────────────────────────────────────────── */}
        {googleAuthenticated && view === 'picker' && (
          <>
            <p className="text-sub text-sm mb-12">
              Browse to the folder that holds the ProShop photo subfolders (named
              <code> tools_&#123;ProShop ID&#125;_…</code>). The main photo in each is copied to the
              matching tool as its primary photo. Tools that already have a photo are skipped.
            </p>

            {sharedDrives.length > 0 && (
              <div className="mb-12">
                <div className="section-header mb-8">Shared Drives</div>
                <div className="card" style={{ padding: 0 }}>
                  {sharedDrives.map(d => (
                    <div
                      key={d.id}
                      className="flex items-center gap-8"
                      style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                      onClick={() => selectSharedDrive(d)}
                    >
                      <Folder size={15} style={{ color: 'var(--blue)', flexShrink: 0 }} />
                      <span style={{ flex: 1 }}>{d.name}</span>
                      <ChevronRight size={13} className="text-sub" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="card" style={{ padding: 0 }}>
              {/* Breadcrumb */}
              <div className="flex items-center gap-6 flex-wrap" style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => navigateToCrumb(-1)}>
                  <Home size={13} /> {pickerRoot === 'myDrive' ? 'My Drive' : sharedDrives.find(d => d.id === pickerRoot)?.name || 'Drive'}
                </button>
                {stack.slice(pickerRoot === 'myDrive' ? 0 : 1).map((c, i) => (
                  <span key={c.id} className="flex items-center gap-6">
                    <ChevronRight size={13} className="text-sub" />
                    <button className="btn btn-ghost btn-sm" onClick={() => navigateToCrumb(pickerRoot === 'myDrive' ? i : i + 1)}>{c.name}</button>
                  </span>
                ))}
              </div>

              {loading ? (
                <div className="flex items-center justify-center" style={{ padding: 24 }}>
                  <span className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
                </div>
              ) : (
                <>
                  {folders.length === 0 && (
                    <div className="text-sub text-sm" style={{ padding: '12px 14px' }}>No subfolders here.</div>
                  )}
                  {folders.map(f => (
                    <div
                      key={f.id}
                      className="flex items-center gap-8"
                      style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                      onClick={() => openFolder(f)}
                    >
                      <Folder size={15} style={{ color: 'var(--blue)', flexShrink: 0 }} />
                      <span style={{ flex: 1 }}>{f.name}</span>
                      <ChevronRight size={13} className="text-sub" />
                    </div>
                  ))}
                </>
              )}

              {/* Import-here footer */}
              <div className="flex items-center gap-10" style={{ padding: '10px 12px', background: 'var(--surface-2)' }}>
                <span className="text-sub text-sm" style={{ flex: 1 }}>
                  Import from: <strong>{currentFolderName}</strong>
                </span>
                <button className="btn btn-primary btn-sm" onClick={runImport} disabled={loading || atRoot}>
                  Import photos from this folder
                </button>
              </div>
            </div>
            {atRoot && (
              <p className="text-sub text-sm" style={{ marginTop: 10 }}>
                Open the photos folder above — you can't import the whole drive root.
              </p>
            )}
          </>
        )}

        {/* ── Running ───────────────────────────────────────────────────── */}
        {view === 'running' && (
          <div style={{ padding: '8px 0' }}>
            <div className="flex items-center gap-10 mb-12">
              <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
              <span>
                Matched {progress.done} of {progress.total} folders…
              </span>
            </div>
            {progress.total > 0 && (
              <div style={{ height: 8, background: 'var(--surface-2)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${Math.round((progress.done / progress.total) * 100)}%`,
                  background: 'var(--blue)',
                  transition: 'width 0.2s ease',
                }} />
              </div>
            )}
            {progress.current && (
              <div className="text-sub text-sm" style={{ marginTop: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {progress.current}
              </div>
            )}
          </div>
        )}

        {/* ── Done / summary ────────────────────────────────────────────── */}
        {view === 'done' && summary && (
          <SummaryView summary={summary} onClose={onClose} onAgain={() => { setSummary(null); setView('picker'); }} />
        )}
      </div>
    </div>
  );
}

function SummaryView({ summary, onClose, onAgain }) {
  const { total, imported, skippedHasPhoto, noMatch, errors } = summary;
  return (
    <div>
      <div className="flex items-center gap-8 mb-12">
        <CheckCircle size={18} style={{ color: 'var(--green)' }} />
        <strong>Done — scanned {total} folder{total === 1 ? '' : 's'}</strong>
      </div>

      <div className="flex gap-8 flex-wrap mb-14">
        <span className="chip" style={{ background: 'rgba(74,222,128,0.15)', color: 'var(--green)' }}>
          {imported.length} imported
        </span>
        <span className="chip" style={{ background: 'var(--surface-2)' }}>
          {skippedHasPhoto.length} already had a photo
        </span>
        <span className="chip" style={{ background: 'var(--surface-2)' }}>
          {noMatch.length} no match
        </span>
        {errors.length > 0 && (
          <span className="chip" style={{ background: 'rgba(248,113,113,0.15)', color: 'var(--red)' }}>
            {errors.length} error{errors.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div style={{ maxHeight: 260, overflowY: 'auto' }}>
        <ResultList title="Imported" items={imported}
          render={r => `${r.proshopId} — ${r.description || '(no description)'} (${r.photo})`} />
        <ResultList title="No matching tool / photo" items={noMatch}
          render={r => `${r.folder}${r.proshopId ? ` (ID ${r.proshopId})` : ''} — ${r.reason}`} icon="warn" />
        <ResultList title="Skipped — already had a photo" items={skippedHasPhoto}
          render={r => `${r.proshopId} — ${r.description || r.folder}`} muted />
        <ResultList title="Errors" items={errors}
          render={r => `${r.folder} — ${r.error}`} icon="warn" />
      </div>

      <div className="flex gap-8" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
        <button className="btn btn-secondary" onClick={onAgain}>Import another folder</button>
        <button className="btn btn-primary" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

function ResultList({ title, items, render, icon, muted }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mb-12">
      <div className="section-header mb-6">{title} ({items.length})</div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13 }}>
        {items.map((r, i) => (
          <li key={i} className={`flex items-center gap-6 ${muted ? 'text-sub' : ''}`} style={{ padding: '3px 0' }}>
            {icon === 'warn' && <AlertTriangle size={12} style={{ color: 'var(--amber)', flexShrink: 0 }} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{render(r)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
