import { useState, useEffect } from 'react';
import { Home, Folder, FileJson, ChevronRight } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import * as aps from '../services/apsService.js';

// Reusable hub → project → folder → file picker.
// Calls onSelect({ hubId, projectId, folderId, itemId, fileName }) when a JSON file is chosen.
// onCancel is optional — shown as a "Skip" link when provided.
export function FilePicker({ onSelect, onCancel, cancelLabel = 'Skip for now' }) {
  const [hubs, setHubs] = useState([]);
  const [hubId, setHubId] = useState(null);
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(null);
  const [stack, setStack] = useState([]);
  const [contents, setContents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const h = await aps.getHubs();
        setHubs(h);
        if (h.length === 1) selectHub(h[0].id);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectHub = async (id) => {
    setLoading(true);
    setError('');
    setHubId(id);
    setProjectId(null);
    setStack([]);
    setContents([]);
    try {
      const p = await aps.getProjects(id);
      setProjects(p);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const selectProject = async (id) => {
    setLoading(true);
    setError('');
    setProjectId(id);
    setStack([]);
    try {
      const folders = await aps.getTopFolders(hubId, id);
      setContents(folders);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const openFolder = async (folder) => {
    setLoading(true);
    setError('');
    try {
      const c = await aps.getFolderContents(projectId, folder.id);
      setStack(s => [...s, { id: folder.id, name: displayName(folder) }]);
      setContents(c);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const navigateToCrumb = async (index) => {
    setLoading(true);
    setError('');
    try {
      if (index < 0) {
        const folders = await aps.getTopFolders(hubId, projectId);
        setStack([]);
        setContents(folders);
      } else {
        const target = stack[index];
        const c = await aps.getFolderContents(projectId, target.id);
        setStack(s => s.slice(0, index + 1));
        setContents(c);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const selectFile = (item) => {
    const currentFolderId = stack.length ? stack[stack.length - 1].id : null;
    if (!currentFolderId) {
      setError('Please open a folder before selecting a file.');
      return;
    }
    onSelect({
      hubId,
      projectId,
      folderId: currentFolderId,
      itemId: item.id,
      fileName: displayName(item),
    });
  };

  const folders = contents.filter(c => c.type === 'folders');
  const jsonItems = contents.filter(c => c.type === 'items' && /\.json$/i.test(displayName(c)));

  return (
    <div>
      {error && <div className="error-banner mb-12">{error}</div>}

      {hubs.length > 1 && (
        <div className="field-group mb-12">
          <label className="field-label">Hub</label>
          <select className="field-input" value={hubId || ''} onChange={e => selectHub(e.target.value)}>
            <option value="" disabled>Select a hub…</option>
            {hubs.map(h => <option key={h.id} value={h.id}>{displayName(h)}</option>)}
          </select>
        </div>
      )}

      {hubId && (
        <div className="field-group mb-16">
          <label className="field-label">Project</label>
          <select className="field-input" value={projectId || ''} onChange={e => selectProject(e.target.value)}>
            <option value="" disabled>Select a project…</option>
            {projects.map(p => <option key={p.id} value={p.id}>{displayName(p)}</option>)}
          </select>
        </div>
      )}

      {projectId && (
        <div className="card">
          <div className="flex items-center gap-8 mb-12" style={{ flexWrap: 'wrap', fontSize: 13 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => navigateToCrumb(-1)}><Home size={13} /> Root</button>
            {stack.map((c, i) => (
              <span key={c.id} className="flex items-center gap-8">
                <ChevronRight size={13} className="text-sub" />
                <button className="btn btn-ghost btn-sm" onClick={() => navigateToCrumb(i)}>{c.name}</button>
              </span>
            ))}
          </div>

          {loading ? (
            <div className="loading-screen" style={{ minHeight: 120 }}>
              <div className="spinner" />
            </div>
          ) : (
            <div>
              {folders.length === 0 && jsonItems.length === 0 && (
                <div className="text-sub text-sm" style={{ padding: 12 }}>This folder is empty.</div>
              )}
              {folders.map(f => (
                <div
                  key={f.id}
                  className="flex items-center gap-8"
                  style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                  onClick={() => openFolder(f)}
                >
                  <Folder size={16} style={{ color: 'var(--blue)' }} />
                  <span style={{ flex: 1 }}>{displayName(f)}</span>
                  <span className="text-sub text-xs flex items-center gap-8">open <ChevronRight size={12} /></span>
                </div>
              ))}
              {jsonItems.map(item => (
                <div
                  key={item.id}
                  className="flex items-center gap-8"
                  style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}
                >
                  <FileJson size={16} style={{ color: 'var(--green)' }} />
                  <span style={{ flex: 1 }} className="font-mono text-sm">{displayName(item)}</span>
                  <button className="btn btn-primary btn-sm" onClick={() => selectFile(item)}>
                    Use this file
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {onCancel && (
        <div style={{ marginTop: 16 }}>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>{cancelLabel}</button>
        </div>
      )}
    </div>
  );
}

// Lets the user navigate hub → project → folders → pick the tool library .json file.
// On selection, saves { hubId, projectId, folderId, itemId, fileName } via context.
// Step 2: optionally pick the Master-Holder library before the app loads.
// A compact list of already-picked libraries with a remove (×) on each.
function PickedList({ items, onRemove, emptyLabel }) {
  if (items.length === 0) return <p className="text-sub text-sm" style={{ marginBottom: 12 }}>{emptyLabel}</p>;
  return (
    <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((loc) => (
        <div key={loc.itemId} className="flex items-center gap-8"
          style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface)' }}>
          <FileJson size={14} style={{ color: 'var(--green)', flexShrink: 0 }} />
          <span className="font-mono text-xs" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{loc.fileName}</span>
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)', padding: '0 6px' }} onClick={() => onRemove(loc.itemId)}>×</button>
        </div>
      ))}
    </div>
  );
}

export default function LibrarySetup({ canCancel = false, onCancel }) {
  const { commitInitialLibraries, notify, signOutAll } = useApp();
  const [phase, setPhase] = useState('tool'); // 'tool' | 'holder'
  const [toolLibs, setToolLibs] = useState([]);   // [{ ...location }]
  const [holderLibs, setHolderLibs] = useState([]);
  const [adding, setAdding] = useState(true);     // whether the FilePicker is open

  const allItemIds = new Set([...toolLibs, ...holderLibs].map(l => l.itemId));

  const finish = async () => {
    await commitInitialLibraries(toolLibs, holderLibs);
  };

  if (phase === 'holder') {
    return (
      <div className="page-content" style={{ maxWidth: 760 }}>
        <div className="flex items-center gap-8 mb-16">
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>Select Your Holder Libraries (Optional)</h2>
        </div>
        <p className="text-sub text-sm mb-16">
          Add one or more <code>Master-Holder</code> library <code>.json</code> files. Holders from every library are
          available on every tool (grouped by library in the picker). You can also configure these later in <strong>Settings</strong>.
        </p>

        <PickedList items={holderLibs} onRemove={(id) => setHolderLibs(hs => hs.filter(h => h.itemId !== id))}
          emptyLabel="No holder libraries added yet." />

        {adding ? (
          <FilePicker
            onSelect={(loc) => {
              if (allItemIds.has(loc.itemId)) {
                notify('That file is already linked — pick a different one.', 'error', 6000);
                return;
              }
              setHolderLibs(hs => [...hs, loc]);
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
            cancelLabel="Cancel"
          />
        ) : (
          <div className="flex items-center gap-8">
            <button className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}>+ Add holder library…</button>
            <span className="topbar-spacer" style={{ flex: 1 }} />
            <button className="btn btn-primary" onClick={finish}>
              {holderLibs.length > 0 ? 'Finish' : 'Skip — finish setup'}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="page-content" style={{ maxWidth: 760 }}>
      <div className="flex items-center gap-8 mb-16">
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>{canCancel ? 'Manage Tool Libraries' : 'Select Your Tool Libraries'}</h2>
        <span className="topbar-spacer" style={{ flex: 1 }} />
        {canCancel
          ? <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel — keep current libraries</button>
          : <button className="btn btn-ghost btn-sm" onClick={signOutAll}>Sign out</button>}
      </div>
      <p className="text-sub text-sm mb-16">
        Add one or more Fusion 360 tool library <code>.json</code> files. Every tool from every library is shown together,
        with a library filter on the home page. Each tool reads and writes back to the library it came from.
      </p>

      <PickedList items={toolLibs} onRemove={(id) => setToolLibs(ts => ts.filter(t => t.itemId !== id))}
        emptyLabel="No tool libraries added yet." />

      {adding ? (
        <FilePicker
          onSelect={(loc) => {
            if (allItemIds.has(loc.itemId)) {
              notify('That file is already linked — pick a different one.', 'error', 6000);
              return;
            }
            setToolLibs(ts => [...ts, loc]);
            setAdding(false);
          }}
          onCancel={canCancel || toolLibs.length > 0 ? () => setAdding(false) : undefined}
          cancelLabel="Cancel"
        />
      ) : (
        <div className="flex items-center gap-8">
          <button className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}>+ Add tool library…</button>
          <span className="topbar-spacer" style={{ flex: 1 }} />
          <button className="btn btn-primary" disabled={toolLibs.length === 0} onClick={() => { setPhase('holder'); setAdding(false); }}>
            Continue →
          </button>
        </div>
      )}
    </div>
  );
}

function displayName(resource) {
  return resource?.attributes?.displayName || resource?.attributes?.name || resource?.id || '(unnamed)';
}
