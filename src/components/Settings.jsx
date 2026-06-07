import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Settings as SettingsIcon, AlertTriangle, Hash, Package, Trash2, Wand2, Ruler, HardDrive, ExternalLink, FileJson, ListChecks } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { generateMachineNumbers } from '../schema/toolSchema.js';
import { getDefaultUnit, setDefaultUnit } from '../utils/units.js';
import { FilePicker } from './LibrarySetup.jsx';
import DescRenameModal from './DescRenameModal.jsx';
import InfoTip from './InfoTip.jsx';
import { SetupGuideSummary } from './SetupGuide.jsx';

export default function Settings() {
  const navigate = useNavigate();
  const {
    tools, fetchRawLibrary, renumberLibrary, isSaving,
    libraryLocation, holderLibraryLocation, holderLibrarySetupComplete,
    setHolderLibraryLocation, clearHolderLibraryLocation, notify,
    googleAuthenticated, metadataSkipped, user: googleUser,
    fetchMetadataLocation, reconnectMetadata,
  } = useApp();

  const [showHolderPicker, setShowHolderPicker] = useState(false);
  const [showDescRename, setShowDescRename] = useState(false);
  const [defaultUnit, setDefaultUnitState] = useState(getDefaultUnit());

  // Metadata file location — fetched lazily so Settings doesn't add a Drive
  // round-trip to every page load; only resolved while this page is open.
  const [metaLocation, setMetaLocation] = useState(null);
  const [metaLocLoading, setMetaLocLoading] = useState(false);
  const [metaLocError, setMetaLocError] = useState('');

  useEffect(() => {
    if (!googleAuthenticated) return;
    let cancelled = false;
    setMetaLocLoading(true);
    setMetaLocError('');
    fetchMetadataLocation()
      .then(loc => { if (!cancelled) setMetaLocation(loc); })
      .catch(err => { if (!cancelled) setMetaLocError(err.message); })
      .finally(() => { if (!cancelled) setMetaLocLoading(false); });
    return () => { cancelled = true; };
  }, [googleAuthenticated, fetchMetadataLocation]);

  const changeDefaultUnit = (unit) => {
    setDefaultUnit(unit);
    setDefaultUnitState(unit);
    notify(`Default unit set to ${unit === 'millimeters' ? 'millimeters (mm)' : 'inches (in)'}`, 'success');
  };

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

      {/* Default unit */}
      <div className="card" style={{ maxWidth: 760, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Ruler size={16} style={{ color: 'var(--blue)' }} />
          <h3 style={{ margin: 0 }}>Default Unit</h3>
        </div>
        <p className="text-sub text-sm mb-16">
          The unit used for new tools you create. Existing tools keep their own unit
          (read from Fusion); lengths always display in each record&apos;s own unit.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          {[['inches', 'Inches (in)'], ['millimeters', 'Millimeters (mm)']].map(([val, label]) => (
            <button
              key={val}
              className={`btn btn-sm ${defaultUnit === val ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => changeDefaultUnit(val)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Setup checklist — sanity-check summary of the initial workflow */}
      <div className="card" style={{ maxWidth: 760, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <ListChecks size={16} style={{ color: 'var(--blue)' }} />
          <h3 style={{ margin: 0 }}>Setup Checklist</h3>
          <InfoTip text="Reference for the initial Fusion → normalize → ProShop workflow: connect the Fusion library, normalize it, merge in ProShop data, then export back. Each step checks itself off as you complete it — this is just a sanity check that it ran, not something you manage here." />
        </div>
        <p className="text-sub text-sm mb-16">
          Status of the one-time initial setup and ProShop import workflow.
        </p>
        <SetupGuideSummary />
      </div>

      {/* Tool metadata (Google Drive) connection */}
      <div className="card" style={{ maxWidth: 760, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <HardDrive size={16} style={{ color: 'var(--blue)' }} />
          <h3 style={{ margin: 0 }}>Tool Metadata (Google Drive)</h3>
        </div>
        <p className="text-sub text-sm mb-16">
          Notes, tags, ProShop IDs, assemblies, and other fields Fusion can&apos;t store live in
          one <code>tool_metadata.json</code> file, linked one-to-one with this Fusion tool library.
        </p>

        <div className="text-sm" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="flex items-center gap-8">
            <FileJson size={14} className="text-sub" style={{ flexShrink: 0 }} />
            <span className="text-sub" style={{ minWidth: 100 }}>Fusion library</span>
            <span className="font-mono text-xs">{libraryLocation?.fileName || '—'}</span>
          </div>

          {googleAuthenticated ? (
            <>
              <div className="flex items-center gap-8">
                <HardDrive size={14} className="text-sub" style={{ flexShrink: 0 }} />
                <span className="text-sub" style={{ minWidth: 100 }}>Metadata file</span>
                {metaLocLoading ? (
                  <span className="text-sub text-xs">Loading…</span>
                ) : metaLocation ? (
                  <span className="flex items-center gap-8">
                    <span className="font-mono text-xs">{metaLocation.fileName}</span>
                    {metaLocation.webViewLink && (
                      <a
                        href={metaLocation.webViewLink}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--blue)' }}
                      >
                        <ExternalLink size={11} /> Open in Drive
                      </a>
                    )}
                  </span>
                ) : (
                  <span className="text-sub text-xs">{metaLocError || '✓ Connected'}</span>
                )}
              </div>

              {metaLocation && (
                <div className="flex items-center gap-8">
                  <span style={{ width: 14, flexShrink: 0 }} />
                  <span className="text-sub flex items-center" style={{ minWidth: 100, gap: 4 }}>
                    Location
                    <InfoTip text="The app always re-reads this exact file by its Drive ID, so this isn't an in-app setting — it's just informational. To actually relocate the file, drag it to a new folder in Google Drive's own UI; Drive keeps the file's ID, so the app keeps working with no reconfiguration needed." />
                  </span>
                  <span className="text-xs">
                    {[metaLocation.driveName, metaLocation.folderName].filter(Boolean).join(' / ') || 'My Drive (root)'}
                  </span>
                </div>
              )}

              <div className="flex items-center gap-8">
                <span style={{ width: 14, flexShrink: 0 }} />
                <span className="text-sub" style={{ minWidth: 100 }}>Signed in as</span>
                <span className="text-xs">{googleUser?.email || googleUser?.name || '—'}</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-8">
                <HardDrive size={14} className="text-sub" style={{ flexShrink: 0 }} />
                <span className="text-sub" style={{ minWidth: 100 }}>Metadata file</span>
                <span className="text-sub text-xs">
                  {metadataSkipped ? 'Not connected — metadata is being skipped' : 'Not connected'}
                </span>
              </div>
              <div className="flex items-center gap-8">
                <span style={{ width: 14, flexShrink: 0 }} />
                <button className="btn btn-secondary btn-sm" onClick={reconnectMetadata}>
                  Connect Google Drive…
                </button>
                <InfoTip text="This opens the setup flow, where you pick the Drive folder tool_metadata.json is created in. Choose carefully — once the file exists, the app always re-reads that exact file by its Drive ID, so this isn't something you change in-app afterward (though you can still drag the file to a new folder in Drive's own UI later; Drive keeps the ID, so the app keeps working)." />
              </div>
            </>
          )}
        </div>
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

      {/* Description rename */}
      <div className="card" style={{ maxWidth: 760, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Wand2 size={16} style={{ color: 'var(--blue)' }} />
          <h3 style={{ margin: 0 }}>Rename Tool Descriptions</h3>
        </div>
        <p className="text-sub text-sm mb-16">
          Preview and apply geometry-based description suggestions across the whole library.
          Each tool shows its current description next to the generated suggestion — uncheck
          any you want to skip or edit the text before applying.
        </p>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => setShowDescRename(true)}
          disabled={tools.length === 0}
        >
          <Wand2 size={13} /> Review &amp; rename descriptions…
        </button>
        {showDescRename && <DescRenameModal onClose={() => setShowDescRename(false)} />}
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
