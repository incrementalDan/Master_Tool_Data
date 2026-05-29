import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext.jsx';
import * as aps from '../services/apsService.js';

// Lets the user navigate hub → project → folders → pick the tool library .json file.
// On selection, saves { hubId, projectId, folderId, itemId, fileName } via context.
export default function LibrarySetup() {
  const { setLibraryLocation, signOutAll } = useApp();

  const [hubs, setHubs] = useState([]);
  const [hubId, setHubId] = useState(null);
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(null);
  const [stack, setStack] = useState([]);        // [{ id, name }] folder breadcrumb
  const [contents, setContents] = useState([]);  // current folder contents
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Load hubs on mount
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
    // index -1 == project root
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
    setLibraryLocation({
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
    <div className="page-content" style={{ maxWidth: 760 }}>
      <div className="flex items-center gap-8 mb-16">
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Select Your Tool Library File</h2>
        <span className="topbar-spacer" style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={signOutAll}>Sign out</button>
      </div>
      <p className="text-sub text-sm mb-16">
        Navigate to the Fusion 360 cloud folder containing your tool library and pick the <code>.json</code> file.
        This is saved locally so you won't have to repeat it.
      </p>

      {error && <div className="error-banner mb-16">{error}</div>}

      {/* Hub selector */}
      {hubs.length > 1 && (
        <div className="field-group mb-12">
          <label className="field-label">Hub</label>
          <select className="field-input" value={hubId || ''} onChange={e => selectHub(e.target.value)}>
            <option value="" disabled>Select a hub…</option>
            {hubs.map(h => <option key={h.id} value={h.id}>{displayName(h)}</option>)}
          </select>
        </div>
      )}

      {/* Project selector */}
      {hubId && (
        <div className="field-group mb-16">
          <label className="field-label">Project</label>
          <select className="field-input" value={projectId || ''} onChange={e => selectProject(e.target.value)}>
            <option value="" disabled>Select a project…</option>
            {projects.map(p => <option key={p.id} value={p.id}>{displayName(p)}</option>)}
          </select>
        </div>
      )}

      {/* Folder browser */}
      {projectId && (
        <div className="card">
          {/* Breadcrumb */}
          <div className="flex items-center gap-8 mb-12" style={{ flexWrap: 'wrap', fontSize: 13 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => navigateToCrumb(-1)}>📁 Root</button>
            {stack.map((c, i) => (
              <span key={c.id} className="flex items-center gap-8">
                <span className="text-sub">/</span>
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
                  <span>📁</span>
                  <span style={{ flex: 1 }}>{displayName(f)}</span>
                  <span className="text-sub text-xs">open →</span>
                </div>
              ))}
              {jsonItems.map(item => (
                <div
                  key={item.id}
                  className="flex items-center gap-8"
                  style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}
                >
                  <span>📄</span>
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
    </div>
  );
}

function displayName(resource) {
  return resource?.attributes?.displayName || resource?.attributes?.name || resource?.id || '(unnamed)';
}
