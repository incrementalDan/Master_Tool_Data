import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings as SettingsIcon, AlertTriangle, Hash, Package, Trash2, Wand2, Ruler, HardDrive, ExternalLink, FileJson, Download, X, FolderOpen, LogOut, User, CheckCircle2, Circle, AlertCircle, Image as ImageIcon } from 'lucide-react';
import { useApp, SETUP_STEPS } from '../context/AppContext.jsx';
import { generateMachineNumbers } from '../schema/toolSchema.js';
import { getDefaultUnit, setDefaultUnit } from '../utils/units.js';
import { FilePicker } from './LibrarySetup.jsx';
import DescRenameModal from './DescRenameModal.jsx';
import InfoTip from './InfoTip.jsx';
import ImportPhotosModal from './ImportPhotosModal.jsx';
import { exportFullLibrary } from '../utils/proShopExport.js';

export default function Settings() {
  const navigate = useNavigate();
  const {
    tools, needsNormalize, fetchRawLibrary, renumberLibrary, isSaving,
    markSetupStepInSettings,
    libraryLocation, holderLibraryLocation, holderLibrarySetupComplete,
    setLibraryLocation, setHolderLibraryLocation, clearHolderLibraryLocation, notify,
    googleAuthenticated, metadataSkipped, user: googleUser,
    fetchMetadataLocation, reconnectMetadata, disconnectMetadata,
    shopSettings, saveShopSettings, signOutAll,
    setupProgress,
  } = useApp();

  const [showToolPicker, setShowToolPicker] = useState(false);
  const [showHolderPicker, setShowHolderPicker] = useState(false);
  const [showDescRename, setShowDescRename] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);
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
  };

  // ── Shop settings (shop_settings.json) ─────────────────────────────────────
  const [shopName, setShopName] = useState(shopSettings?.shop_name || '');
  const [machineStart, setMachineStart] = useState(shopSettings?.machine_number?.start ?? 30);
  const [skipList, setSkipList] = useState(shopSettings?.machine_number?.skip ?? [98, 99, 100]);
  const [skipInput, setSkipInput] = useState('');
  const [savingShop, setSavingShop] = useState(false);

  useEffect(() => {
    setShopName(shopSettings?.shop_name || '');
    setMachineStart(shopSettings?.machine_number?.start ?? 30);
    setSkipList(shopSettings?.machine_number?.skip ?? [98, 99, 100]);
  }, [shopSettings]);

  const addSkip = () => {
    const n = parseInt(skipInput, 10);
    if (!isNaN(n) && !skipList.includes(n)) setSkipList([...skipList, n].sort((a, b) => a - b));
    setSkipInput('');
  };
  const removeSkip = (n) => setSkipList(skipList.filter(x => x !== n));

  const saveShop = async () => {
    setSavingShop(true);
    try {
      await saveShopSettings({
        ...(shopSettings || {}),
        shop_name: shopName,
        default_units: defaultUnit,
        machine_number: { start: Number(machineStart) || 30, skip: skipList },
      });
      setDefaultUnit(defaultUnit);
      notify('Shop settings saved', 'success');
    } catch { /* notify handled in saveShopSettings */ }
    finally { setSavingShop(false); }
  };

  const fmtDate = (v) => {
    if (!v) return null;
    try { return new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch { return null; }
  };

  // ── Renumber ───────────────────────────────────────────────────────────────
  const [stage, setStage] = useState('idle');
  const [previewRows, setPreviewRows] = useState([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState('');
  const [resultCount, setResultCount] = useState(0);

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

  const handleDisconnectMetadata = () => {
    if (!window.confirm(
      "Disconnect this metadata file and set up a new one?\n\n" +
      "This only changes which Drive file the app links to — nothing in Drive gets deleted. " +
      "You'll be sent back through the connect screen to sign in and pick a folder for a " +
      "brand-new tool_metadata.json. None of the old file's notes, tags, or assemblies carry over."
    )) return;
    disconnectMetadata();
  };

  const handleRenumber = async () => {
    setError('');
    try {
      const count = await renumberLibrary();
      setResultCount(count);
      setStage('done');
      markSetupStepInSettings('machineNumbers');
    } catch (err) {
      setError(err.message);
    }
  };

  const cancelPreview = () => {
    setStage('idle');
    setConfirmText('');
    setError('');
  };

  const handleExportProShop = () => {
    exportFullLibrary(tools);
    markSetupStepInSettings('proshopExported');
    notify(`Exported ${tools.length} tools to ProShop CSV`, 'success');
  };

  // ── Setup step derivation (live-data warnings) ─────────────────────────────
  // Returns a warning string if the step's stored flag says "done" but the
  // current live data suggests it may not actually be complete.
  const stepWarning = (key) => {
    if (!setupProgress[key]) return null; // not done — no warning
    switch (key) {
      case 'fusionConnected': return tools.length === 0 ? 'Library appears empty — re-check the connected file.' : null;
      case 'normalized': return needsNormalize ? 'Some tools are not yet normalized.' : null;
      case 'proshopMerged': return !tools.some(t => t.min_ooh != null && t.min_ooh > 0) ? 'No tools have MIN OOH data — ProShop CSV may not have merged.' : null;
      default: return null;
    }
  };

  // Drive timestamps for each step (ISO string or null)
  const stepTimestamp = (key) => shopSettings?.setup_steps?.[key] ?? null;

  return (
    <div>
      <div className="flex items-center gap-8 mb-20">
        <h2 style={{ fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <SettingsIcon size={16} /> Settings
        </h2>
      </div>

      {/* Account */}
      <div className="card" style={{ maxWidth: 760, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <User size={16} style={{ color: 'var(--blue)' }} />
          <h3 style={{ margin: 0 }}>Account</h3>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="text-sm" style={{ fontWeight: 500 }}>Autodesk authentication active</div>
            {googleAuthenticated && googleUser?.email && (
              <div className="text-sub text-sm" style={{ marginTop: 2 }}>Google: {googleUser.email}</div>
            )}
            {!googleAuthenticated && (
              <div className="text-sub text-sm" style={{ marginTop: 2 }}>Google Drive not connected (metadata off)</div>
            )}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={signOutAll}>
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </div>

      {/* Setup & Import — unified initial-workflow tracker */}
      <div className="card" style={{ maxWidth: 760, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <CheckCircle2 size={16} style={{ color: 'var(--blue)' }} />
          <h3 style={{ margin: 0 }}>Setup &amp; Import</h3>
          <InfoTip text="The one-time initial workflow: connect the Fusion library, normalize it, merge in ProShop data, configure machine numbers, then export back. Each step checks off automatically when you complete it. Warnings appear here if the stored flag says 'done' but the live library suggests otherwise — you can re-run a step or ignore the warning." />
        </div>
        <p className="text-sub text-sm" style={{ marginBottom: 16 }}>
          One-time setup checklist. Use the action buttons to run or re-run each step.
        </p>

        {SETUP_STEPS.map((step, i) => {
          const done = !!setupProgress[step.key];
          const warn = stepWarning(step.key);
          const ts = fmtDate(stepTimestamp(step.key));
          return (
            <div key={step.key} style={{
              display: 'flex', alignItems: 'flex-start', gap: 12,
              padding: '10px 0',
              borderBottom: i < SETUP_STEPS.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              <div style={{ paddingTop: 1, flexShrink: 0 }}>
                {warn
                  ? <AlertCircle size={16} style={{ color: 'var(--orange)' }} />
                  : done
                    ? <CheckCircle2 size={16} style={{ color: 'var(--green)' }} />
                    : <Circle size={16} style={{ color: 'var(--text-sub)' }} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{step.label}</div>
                {done && ts && <div className="text-sub" style={{ fontSize: 11, marginTop: 2 }}>Done {ts}</div>}
                {warn && (
                  <div style={{ color: 'var(--orange)', fontSize: 12, marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <AlertTriangle size={12} /> {warn}
                  </div>
                )}
                {/* ProShop photos sub-step under proshopMerged */}
                {step.key === 'proshopMerged' && (
                  <div style={{ marginTop: 8, paddingLeft: 12, borderLeft: '2px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                    {setupProgress.proshopPhotos
                      ? <CheckCircle2 size={13} style={{ color: 'var(--green)', flexShrink: 0 }} />
                      : <Circle size={13} style={{ color: 'var(--text-sub)', flexShrink: 0 }} />}
                    <span className="text-sub" style={{ fontSize: 12 }}>
                      Import ProShop photos
                      {setupProgress.proshopPhotos && fmtDate(stepTimestamp('proshopPhotos'))
                        ? ` — done ${fmtDate(stepTimestamp('proshopPhotos'))}`
                        : ''}
                    </span>
                    <button className="btn btn-ghost btn-sm" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setShowPhotos(true)}>
                      <ImageIcon size={11} /> {setupProgress.proshopPhotos ? 'Re-import' : 'Import photos…'}
                    </button>
                  </div>
                )}
              </div>
              <div style={{ flexShrink: 0 }}>
                <StepAction stepKey={step.key} done={done} warn={warn}
                  onExport={handleExportProShop}
                  onImport={() => navigate('/import')}
                  onChangeLibrary={() => { setShowToolPicker(true); setTimeout(() => document.getElementById('fusion-libraries-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }}
                  onGoToLanding={() => navigate('/')}
                  tools={tools}
                />
              </div>
            </div>
          );
        })}
      </div>

      {showPhotos && <ImportPhotosModal onClose={() => setShowPhotos(false)} />}

      {/* Fusion Libraries (APS) — tool + holder, the two distinct Autodesk cloud files */}
      <div id="fusion-libraries-card" className="card" style={{ maxWidth: 760, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <HardDrive size={16} style={{ color: 'var(--blue)' }} />
          <h3 style={{ margin: 0 }}>Fusion Libraries (Autodesk)</h3>
          <InfoTip text="Two separate Fusion 360 cloud .json files. The tool library is the one this app reads and writes; the holder library is read-only and only enables holder selection. They must be two different files — never point both at the same one, or saving tools will overwrite the holder file." />
        </div>
        <p className="text-sub text-sm mb-16">
          The Autodesk cloud files this app links to. These are <strong>two distinct files</strong> — pick the right one for each.
        </p>

        {/* Tool library */}
        <div style={{ paddingBottom: 14, marginBottom: 14, borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-8" style={{ marginBottom: 6 }}>
            <FileJson size={14} style={{ color: 'var(--green)', flexShrink: 0 }} />
            <span className="text-sm" style={{ fontWeight: 600, minWidth: 96 }}>Tool library</span>
            {libraryLocation?.fileName
              ? <span className="font-mono text-xs">{libraryLocation.fileName}</span>
              : <span className="text-sub text-xs">Not linked</span>}
          </div>
          <div className="text-sub text-xs" style={{ marginBottom: 8, paddingLeft: 22 }}>
            Read &amp; written by the app. This must be the tool library, not the holder library.
          </div>
          <div style={{ paddingLeft: 22 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowToolPicker(p => !p)}>
              <FolderOpen size={14} /> {showToolPicker ? 'Cancel' : libraryLocation ? 'Change Tool Library…' : 'Link Tool Library…'}
            </button>
          </div>
          {showToolPicker && (
            <div style={{ marginTop: 16, paddingLeft: 22 }}>
              <FilePicker
                onSelect={(loc) => {
                  if (holderLibraryLocation && loc.itemId === holderLibraryLocation.itemId) {
                    notify('That is the holder library file — pick the separate tool library file instead.', 'error', 7000);
                    return;
                  }
                  setLibraryLocation(loc);
                  setShowToolPicker(false);
                  notify(`Tool library set to ${loc.fileName}`, 'success');
                }}
              />
            </div>
          )}
        </div>

        {/* Holder library */}
        <div>
          <div className="flex items-center gap-8" style={{ marginBottom: 6 }}>
            <Package size={14} style={{ color: 'var(--blue)', flexShrink: 0 }} />
            <span className="text-sm" style={{ fontWeight: 600, minWidth: 96 }}>Holder library</span>
            {holderLibrarySetupComplete
              ? <span className="font-mono text-xs">{holderLibraryLocation?.fileName}</span>
              : <span className="text-sub text-xs">Not linked (optional)</span>}
          </div>
          <div className="text-sub text-xs" style={{ marginBottom: 8, paddingLeft: 22 }}>
            Read-only. Enables browsing and assigning holders to each tool.
          </div>
          <div className="flex gap-8" style={{ paddingLeft: 22 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowHolderPicker(p => !p)}>
              {showHolderPicker ? 'Cancel' : holderLibrarySetupComplete ? 'Change Holder Library…' : 'Set Up Holder Library…'}
            </button>
            {holderLibrarySetupComplete && (
              <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }}
                onClick={() => { clearHolderLibraryLocation(); setShowHolderPicker(false); notify('Holder library removed', 'info'); }}>
                <Trash2 size={13} /> Remove
              </button>
            )}
          </div>
          {showHolderPicker && (
            <div style={{ marginTop: 16, paddingLeft: 22 }}>
              <FilePicker
                onSelect={async (loc) => {
                  // Guard: the holder library must be a different file than the tool
                  // library. Pointing both at the same item makes tool saves overwrite
                  // the holder file (the "holders disappear in Fusion" symptom).
                  if (libraryLocation && loc.itemId === libraryLocation.itemId) {
                    notify('That is the tool library file — pick the separate holder library file instead.', 'error', 7000);
                    return;
                  }
                  await setHolderLibraryLocation(loc);
                  setShowHolderPicker(false);
                  notify(`Holder library set to ${loc.fileName}`, 'success');
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Shop (name + default unit) — saved to shop_settings.json */}
      <div className="card" style={{ maxWidth: 760, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Ruler size={16} style={{ color: 'var(--blue)' }} />
          <h3 style={{ margin: 0 }}>Shop</h3>
          {!googleAuthenticated && <InfoTip text="Connect Google Drive to persist these shop-wide settings." alignRight />}
        </div>
        <p className="text-sub text-sm mb-16">Shop-wide settings shared by everyone (stored in <code>shop_settings.json</code> on Drive).</p>

        <label className="text-sub text-sm" style={{ display: 'block', marginBottom: 4 }}>Shop name</label>
        <input className="field-input" style={{ maxWidth: 360, marginBottom: 16 }} value={shopName} placeholder="e.g. Acme Machining" onChange={e => setShopName(e.target.value)} />

        <label className="text-sub text-sm" style={{ display: 'block', marginBottom: 6 }}>
          Default unit <span style={{ opacity: 0.7 }}>— for new tools; existing tools keep their own unit</span>
        </label>
        <div className="btn-toggle" style={{ marginBottom: 16 }}>
          {[['inches', 'Inch (in)'], ['millimeters', 'Metric (mm)']].map(([val, label]) => (
            <button key={val} className={defaultUnit === val ? 'active' : ''} onClick={() => changeDefaultUnit(val)}>{label}</button>
          ))}
        </div>

        <button className="btn btn-primary" onClick={saveShop} disabled={savingShop || !googleAuthenticated}>
          {savingShop ? 'Saving…' : 'Save Shop Settings'}
        </button>
      </div>

      {/* Machine numbers — saved to shop_settings.json, drives renumber/add */}
      <div className="card" style={{ maxWidth: 760, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Hash size={16} style={{ color: 'var(--blue)' }} />
          <h3 style={{ margin: 0 }}>Machine Numbers</h3>
          <InfoTip text="Machine tool numbers are assigned starting at this number, skipping the reserved list. Used by Renumber Library and when adding a new tool." alignRight />
        </div>
        <label className="text-sub text-sm" style={{ display: 'block', marginBottom: 4 }}>Start number</label>
        <input className="field-input" type="number" style={{ maxWidth: 140, marginBottom: 16 }} value={machineStart} onChange={e => setMachineStart(e.target.value)} />

        <label className="text-sub text-sm" style={{ display: 'block', marginBottom: 6 }}>Skip / reserved numbers</label>
        <div className="flex items-center gap-6 flex-wrap" style={{ marginBottom: 8 }}>
          {skipList.map(n => (
            <span key={n} className="chip" style={{ gap: 6 }}>
              {n}
              <button className="icon-btn" style={{ width: 16, height: 16 }} title="Remove" onClick={() => removeSkip(n)}><X size={12} /></button>
            </span>
          ))}
          {skipList.length === 0 && <span className="text-sub text-sm">None</span>}
        </div>
        <div className="flex items-center gap-6">
          <input className="field-input" type="number" style={{ maxWidth: 110 }} placeholder="Add #" value={skipInput}
            onChange={e => setSkipInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addSkip()} />
          <button className="btn btn-secondary btn-sm" onClick={addSkip}>Add</button>
        </div>
      </div>

      {/* ProShop export */}
      <div className="card" style={{ maxWidth: 760, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Download size={16} style={{ color: 'var(--blue)' }} />
          <h3 style={{ margin: 0 }}>ProShop Export</h3>
        </div>
        <p className="text-sub text-sm mb-16">
          Export the full tool library as a ProShop-compatible CSV — for the initial bulk
          import, or anytime afterward to re-sync ProShop with the current library.
        </p>
        <button className="btn btn-secondary btn-sm" onClick={handleExportProShop} disabled={tools.length === 0}>
          ↓ Export Full ProShop CSV ({tools.length} tools)
        </button>
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
                      <a href={metaLocation.webViewLink} target="_blank" rel="noreferrer"
                        className="text-xs" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--blue)' }}>
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

              <div className="flex items-center gap-8">
                <span style={{ width: 14, flexShrink: 0 }} />
                <button className="btn btn-secondary btn-sm" onClick={handleDisconnectMetadata}>
                  Disconnect &amp; set up a new file…
                </button>
                <InfoTip text="Use this if the linked file was deleted in Drive (or you just want a fresh start). It only changes which file the app links to — nothing in Drive is deleted by this. You'll go back through the connect screen, sign in, and pick a folder for a brand-new tool_metadata.json; none of the old file's notes, tags, or assemblies carry over." />
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
        <button className="btn btn-secondary btn-sm" onClick={() => setShowDescRename(true)} disabled={tools.length === 0}>
          <Wand2 size={13} /> Review &amp; rename descriptions…
        </button>
        {showDescRename && <DescRenameModal onClose={() => setShowDescRename(false)} />}
      </div>

      <div className="card" style={{ maxWidth: 760 }}>
        <h3 style={{ marginBottom: 4 }}>Advanced</h3>
        <p className="text-sub text-sm mb-16">Destructive maintenance actions. Use with care.</p>

        <div style={{
          padding: 16, borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border)', borderLeft: '3px solid var(--red)',
          background: 'var(--surface-2)',
        }}>
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
                <button className="btn btn-danger" onClick={handleRenumber} disabled={confirmText !== 'RENUMBER' || isSaving}>
                  {isSaving ? 'Renumbering…' : 'Renumber Library'}
                </button>
                <button className="btn btn-secondary" onClick={cancelPreview} disabled={isSaving}>Cancel</button>
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

// Action button for each setup step — shows the right CTA depending on step state.
function StepAction({ stepKey, done, warn, onExport, onImport, onChangeLibrary, onGoToLanding, tools }) {
  switch (stepKey) {
    case 'fusionConnected':
      return (
        <button className="btn btn-secondary btn-sm" onClick={onChangeLibrary}>
          {done && !warn ? 'Change Library' : 'Connect Library'}
        </button>
      );
    case 'normalized':
      return (
        <button className="btn btn-secondary btn-sm" onClick={onGoToLanding}>
          {warn ? 'Go to Library' : done ? 'View Library' : 'Open Library'}
        </button>
      );
    case 'proshopMerged':
      return (
        <button className="btn btn-secondary btn-sm" onClick={onImport}>
          {done && !warn ? 'Re-run Import' : 'Open Import'}
        </button>
      );
    case 'machineNumbers':
      return (
        <span className="text-sub" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
          See Machine Numbers ↓
        </span>
      );
    case 'proshopExported':
      return (
        <button className="btn btn-secondary btn-sm" onClick={onExport} disabled={tools.length === 0}>
          ↓ Export CSV
        </button>
      );
    default:
      return null;
  }
}
