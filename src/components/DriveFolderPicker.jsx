import { useState, useEffect } from 'react';
import { X, Folder, Home, ChevronRight } from 'lucide-react';
import { listFolders, listSharedDrives } from '../services/driveService.js';

// Pick a Google Drive folder. The browse behaviour (My Drive + shared drives,
// breadcrumb, nothing cached) is the same pattern MetadataConnect and
// ImportPhotosModal use; this is that pattern as one component so a third
// caller doesn't mean a third copy.
//
// Returns { id, name } via onPick. Selecting nothing is a real answer — a
// machine whose posted files aren't in Drive yet should be able to clear the
// folder, so `onPick(null)` is offered whenever one is already set.
export default function DriveFolderPicker({
  title = 'Choose a Drive folder',
  hint = '',
  current = null,          // { id, name } already chosen, if any
  onPick,
  onClose,
}) {
  const [sharedDrives, setSharedDrives] = useState([]);
  const [stack, setStack] = useState([]);          // breadcrumb of { id, name }
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pickerRoot, setPickerRoot] = useState('myDrive');

  useEffect(() => { loadRoot(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const run = async (fn) => {
    setLoading(true);
    setError('');
    try { await fn(); } catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  const loadRoot = () => run(async () => {
    const [drives, rootFolders] = await Promise.all([listSharedDrives(), listFolders('root')]);
    setSharedDrives(drives);
    setFolders(rootFolders);
    setStack([]);
    setPickerRoot('myDrive');
  });

  const openFolder = (folder) => run(async () => {
    const children = await listFolders(folder.id);
    setStack(s => [...s, { id: folder.id, name: folder.name }]);
    setFolders(children);
  });

  const navigateToCrumb = (index) => run(async () => {
    if (index < 0) {
      setFolders(await listFolders(pickerRoot === 'myDrive' ? 'root' : pickerRoot));
      setStack([]);
    } else {
      setFolders(await listFolders(stack[index].id));
      setStack(s => s.slice(0, index + 1));
    }
  });

  const selectSharedDrive = (drive) => run(async () => {
    setPickerRoot(drive.id);
    setFolders(await listFolders(drive.id));
    setStack([{ id: drive.id, name: drive.name }]);
  });

  const rootName = pickerRoot === 'myDrive'
    ? 'My Drive'
    : (sharedDrives.find(d => d.id === pickerRoot)?.name || 'Drive');
  const here = stack.length ? stack[stack.length - 1] : null;

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 className="modal-title" style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Folder size={17} style={{ color: 'var(--blue)' }} /> {title}
          </h3>
          <button className="icon-btn" onClick={onClose} title="Close"><X size={16} /></button>
        </div>

        {hint && <p className="text-sub text-sm mb-12">{hint}</p>}
        {error && <div className="error-banner mb-12">{error}</div>}

        {sharedDrives.length > 0 && (
          <div className="mb-12">
            <div className="section-header mb-8">Shared Drives</div>
            <div className="card" style={{ padding: 0 }}>
              {sharedDrives.map(d => (
                <div key={d.id} className="flex items-center gap-8"
                  style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                  onClick={() => selectSharedDrive(d)}>
                  <Folder size={15} style={{ color: 'var(--blue)', flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{d.name}</span>
                  <ChevronRight size={13} className="text-sub" />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="card" style={{ padding: 0 }}>
          <div className="flex items-center gap-6 flex-wrap"
            style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => navigateToCrumb(-1)}>
              <Home size={13} /> {rootName}
            </button>
            {stack.slice(pickerRoot === 'myDrive' ? 0 : 1).map((c, i) => (
              <span key={c.id} className="flex items-center gap-6">
                <ChevronRight size={13} className="text-sub" />
                <button className="btn btn-ghost btn-sm"
                  onClick={() => navigateToCrumb(pickerRoot === 'myDrive' ? i : i + 1)}>{c.name}</button>
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
                <div key={f.id} className="flex items-center gap-8"
                  style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                  onClick={() => openFolder(f)}>
                  <Folder size={15} style={{ color: 'var(--blue)', flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{f.name}</span>
                  <ChevronRight size={13} className="text-sub" />
                </div>
              ))}
            </>
          )}

          <div className="flex items-center gap-10" style={{ padding: '10px 12px', background: 'var(--surface-2)' }}>
            <span className="text-sub text-sm" style={{ flex: 1 }}>
              {here ? <>Use: <strong>{here.name}</strong></> : 'Open a folder to choose it'}
            </span>
            {current?.id && (
              <button className="btn btn-ghost btn-sm" onClick={() => { onPick(null); onClose(); }}>
                Clear
              </button>
            )}
            <button className="btn btn-primary btn-sm" disabled={loading || !here}
              onClick={() => { onPick({ id: here.id, name: here.name }); onClose(); }}>
              Use this folder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
