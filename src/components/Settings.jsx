import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Settings as SettingsIcon, AlertTriangle, Hash, Package, Trash2 } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { generateMachineNumbers } from '../schema/toolSchema.js';
import { FilePicker } from './LibrarySetup.jsx';

export default function Settings() {
  const navigate = useNavigate();
  const {
    tools, fetchRawLibrary, renumberLibrary, isSaving,
    holderLibraryLocation, holderLibrarySetupComplete,
    setHolderLibraryLocation, clearHolderLibraryLocation, notify,
  } = useApp();

  const [showHolderPicker, setShowHolderPicker] = useState(false);

  // 'idle' → warning, 'preview' → table + confirm input, 'done' → success
  const [stage, setStage] = useState('idle');
  const [previewRows, setPreviewRows] = useState([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState('');
  const [resultCount, setResultCount] = useState(0);

  // Build the before/after preview from a FRESH read of the library, in the
  // exact array order the commit will use, so what's shown matches what's done.
  const startPreview = async () => {
    setError('');
    setLoadingPreview(true);
    try {
      const list = await fetchRawLibrary();
      const numbers = generateMachineNumbers(list.length);
      setPreviewRows(list.map((f, i) => ({
        id: f.guid,
        description: f.description || '—',
        tool_type: f.type || '—',
        current: f['post-process']?.number ?? null,
        next: numbers[i],
      })));
      setStage('preview');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleRenumber = async () => {
    setError('');
    try {
      const count = await renumberLibrary();
      setResultCount(count);
      setStage('done');
    } catch (err) {
      setError(err.message);
    }
  };

  const cancelPreview = () => {
    setStage('idle');
    setConfirmText('');
    setError('');
  };

  return (
    <div>
      <div className="flex items-center gap-8 mb-20">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}><ArrowLeft size={14} /> Back</button>
        <h2 style={{ fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <SettingsIcon size={16} /> Settings
        </h2>
      </div>

      {/* Holder library setup */}
      <div className="card" style={{ maxWidth: 760, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Package size={16} style={{ color: 'var(--blue)' }} />
          <h3 style={{ margin: 0 }}>Master-Holder Library</h3>
        </div>
        <p className="text-sub text-sm mb-16">
          Link the Fusion 360 holder library so you can browse and assign holders to tools.
        </p>

        {holderLibrarySetupComplete ? (
          <div>
            <div className="flex items-center gap-8 mb-12">
              <span className="text-sm" style={{ color: 'var(--green)' }}>✓ Configured</span>
              <span className="text-sub text-xs font-mono">{holderLibraryLocation?.fileName}</span>
            </div>
            <div className="flex gap-8">
              <button className="btn btn-secondary btn-sm" onClick={() => setShowHolderPicker(p => !p)}>
                {showHolderPicker ? 'Cancel' : 'Change Holder Library'}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--red)' }}
                onClick={() => { clearHolderLibraryLocation(); setShowHolderPicker(false); notify('Holder library removed', 'info'); }}
              >
                <Trash2 size={13} /> Remove
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="text-sub text-sm mb-12">No holder library configured.</div>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowHolderPicker(p => !p)}>
              {showHolderPicker ? 'Cancel' : 'Set Up Holder Library'}
            </button>
          </div>
        )}

        {showHolderPicker && (
          <div style={{ marginTop: 16 }}>
            <FilePicker
              onSelect={async (loc) => {
                await setHolderLibraryLocation(loc);
                setShowHolderPicker(false);
                notify(`Holder library set to ${loc.fileName}`, 'success');
              }}
            />
          </div>
        )}
      </div>

      <div className="card" style={{ maxWidth: 760 }}>
        <h3 style={{ marginBottom: 4 }}>Advanced</h3>
        <p className="text-sub text-sm mb-16">Destructive maintenance actions. Use with care.</p>

        <div
          style={{
            padding: 16, borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)', borderLeft: '3px solid var(--red)',
            background: 'var(--surface-2)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Hash size={16} style={{ color: 'var(--orange)' }} />
            <strong>Renumber Tool Library</strong>
          </div>

          {stage === 'idle' && (
            <>
              <div className="error-banner mb-12" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>
                  This will reassign machine tool numbers to all tools in the library starting at
                  <strong> #30</strong>, in their current import order. Tools currently referenced in saved
                  programs will have stale tool numbers after this. This should only be done once during
                  initial setup.
                </span>
              </div>
              {error && <div className="error-banner mb-12">{error}</div>}
              <button className="btn btn-danger" onClick={startPreview} disabled={tools.length === 0 || loadingPreview}>
                {loadingPreview ? 'Loading library…' : `Renumber ${tools.length} Tools…`}
              </button>
            </>
          )}

          {stage === 'preview' && (
            <>
              <p className="text-sub text-sm mb-12">
                Review the change below ({previewRows.length} tools, fresh from the library). Numbers
                <strong> 98, 99, and 100</strong> are skipped (reserved).
              </p>
              <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', marginBottom: 14 }}>
                <table className="match-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Description</th>
                      <th>Type</th>
                      <th>Current</th>
                      <th>New</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={`${row.id}-${i}`}>
                        <td className="text-sub text-xs">{i + 1}</td>
                        <td className="truncate" style={{ maxWidth: 240 }}>{row.description}</td>
                        <td className="text-xs text-sub">{row.tool_type}</td>
                        <td className="text-xs text-sub">
                          {(row.current ?? null) === null ? '—' : `T${row.current}`}
                        </td>
                        <td className="font-mono" style={{ color: 'var(--green)' }}>T{row.next}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {error && <div className="error-banner mb-12">{error}</div>}

              <label className="field-label">Type <code>RENUMBER</code> to confirm</label>
              <input
                className="field-input"
                style={{ maxWidth: 240, marginTop: 4, marginBottom: 12 }}
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder="RENUMBER"
                autoFocus
              />
              <div className="flex gap-8">
                <button
                  className="btn btn-danger"
                  onClick={handleRenumber}
                  disabled={confirmText !== 'RENUMBER' || isSaving}
                >
                  {isSaving ? 'Renumbering…' : 'Renumber Library'}
                </button>
                <button className="btn btn-secondary" onClick={cancelPreview} disabled={isSaving}>
                  Cancel
                </button>
              </div>
            </>
          )}

          {stage === 'done' && (
            <div style={{ color: 'var(--green)' }}>
              ✓ Renumbered {resultCount} tools starting at #30. Both the Fusion library and metadata have been updated.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
