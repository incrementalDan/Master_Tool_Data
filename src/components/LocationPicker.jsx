import { useState, useMemo } from 'react';
import { MapPin, AlertTriangle } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { LivePreview } from './LocationSystemSettings.jsx';
import {
  findSystem, levelOptions, levelTypeName, composeLocationString,
  nextBin, usedBinsForSystem, LEVEL_KEYS,
} from '../utils/locationSystem.js';

// The "Assign Location" picker (prototype tab) bound to a specific tool. Lives
// in the tool detail. Writes a structured location to the tool via
// assignToolLocation (which composes the string into Fusion vendor + metadata).
export default function LocationPicker({ tool }) {
  const { tools, shopSettings, assignToolLocation, isSaving } = useApp();
  const systems = shopSettings?.location_config?.systems || [];

  const current = tool.tool_location || null;
  const [sysId, setSysId] = useState(current?.system_id || systems[0]?.id || '');
  const [picks, setPicks] = useState({
    zone_id: current?.zone_id || null,
    station_id: current?.station_id || null,
    drawer_id: current?.drawer_id || null,
  });
  const [bin, setBin] = useState(current?.bin != null ? String(current.bin) : '');

  const system = findSystem(systems, sysId);

  // Suggested next bin for an auto-increment system (excludes this tool's own bin).
  const suggestedBin = useMemo(() => {
    if (!system || system.levels.bin.fixed) return '';
    const used = usedBinsForSystem(tools.filter(t => t.id !== tool.id), sysId);
    return String(nextBin(system, used));
  }, [system, tools, tool.id, sysId]);

  function selectSystem(id) {
    setSysId(id);
    setPicks({ zone_id: null, station_id: null, drawer_id: null });
    setBin('');
  }

  function draftLocation() {
    if (!system) return null;
    const binVal = system.levels.bin.fixed
      ? system.levels.bin.fixedVal
      : (bin.trim() || suggestedBin);
    return {
      system_id: sysId,
      zone_id: system.levels.zone.on ? picks.zone_id : null,
      station_id: system.levels.station.on ? picks.station_id : null,
      drawer_id: system.levels.drawer.on ? picks.drawer_id : null,
      bin: system.levels.bin.fixed ? binVal : (binVal === '' ? null : Number(binVal)),
    };
  }

  const preview = system ? (composeLocationString(draftLocation(), system) || '—') : '—';

  async function setLocation() {
    const loc = draftLocation();
    try { await assignToolLocation(tool, loc, tool.bin_size_id || null); }
    catch { /* toast handled in context */ }
  }
  async function clearLocation() {
    try { await assignToolLocation(tool, null, null); }
    catch { /* toast handled in context */ }
  }

  if (systems.length === 0) {
    return (
      <div className="text-sub text-sm">
        No location systems configured yet. Set one up in <strong>Settings → Location System</strong> to assign structured locations.
        {tool.location && <div style={{ marginTop: 6 }}>Current location text: <span className="font-mono location-tag">{tool.location}</span></div>}
      </div>
    );
  }

  function levelRow(levelKey) {
    const level = system.levels[levelKey];
    if (!level.on) return null;
    const typeName = levelTypeName(level);
    const opts = levelOptions(system, levelKey);
    return (
      <div key={levelKey} style={{ background: 'color-mix(in srgb, var(--blue) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--blue) 35%, transparent)', borderRadius: 6, padding: '10px 12px' }}>
        <div style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--blue)', marginBottom: 6 }}>{typeName}</div>
        {level.identFormat === 'custom' ? (
          <div className="font-mono" style={{ fontSize: '0.95rem' }}>{level.customIdent || '—'} <span className="text-sub text-xs">fixed</span></div>
        ) : opts.length === 0 ? (
          <div className="text-sub text-xs">No {typeName.toLowerCase()}s configured — add them in Settings.</div>
        ) : (
          <select className="field-input" value={picks[`${levelKey}_id`] || ''} onChange={e => setPicks(p => ({ ...p, [`${levelKey}_id`]: e.target.value || null }))}>
            <option value="">— select —</option>
            {opts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="field-group" style={{ marginBottom: 12 }}>
        <label className="field-label">Location system</label>
        <select className="field-input" value={sysId} onChange={e => selectSystem(e.target.value)}>
          {systems.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {system && (
        <>
          <div style={{ marginBottom: 12 }}><LivePreview value={preview} /></div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {LEVEL_KEYS.map(levelRow)}
            {/* Bin */}
            <div style={{ background: 'color-mix(in srgb, var(--blue) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--blue) 35%, transparent)', borderRadius: 6, padding: '10px 12px' }}>
              <div style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--blue)', marginBottom: 6 }}>Bin</div>
              {system.levels.bin.fixed ? (
                <div className="font-mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{system.levels.bin.fixedVal || '1000'} <span className="text-sub text-xs" style={{ fontWeight: 400 }}>fixed</span></div>
              ) : (
                <>
                  <input className="field-input font-mono" style={{ width: 150, fontSize: '1rem', fontWeight: 700 }} value={bin} onChange={e => setBin(e.target.value)} placeholder={suggestedBin} />
                  <div className="text-sub text-xs" style={{ marginTop: 4 }}>Suggested next: <span className="font-mono">{suggestedBin}</span></div>
                </>
              )}
            </div>
          </div>

          {system.allowDuplicates && (
            <div style={{ background: 'color-mix(in srgb, var(--orange) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--orange) 40%, transparent)', borderRadius: 6, padding: '8px 12px', fontSize: '0.78rem', color: 'var(--orange)', marginTop: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
              <AlertTriangle size={13} style={{ flexShrink: 0 }} /> Duplicate locations allowed for this system.
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn btn-primary btn-sm" onClick={setLocation} disabled={isSaving}>
              <MapPin size={13} /> {isSaving ? 'Saving…' : 'Set location'}
            </button>
            {current && (
              <button className="btn btn-ghost btn-sm" onClick={clearLocation} disabled={isSaving}>Clear</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
