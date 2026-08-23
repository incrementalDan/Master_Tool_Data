import { useState, useMemo, useEffect } from 'react';
import { MapPin, AlertTriangle, Check, RotateCcw } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { LivePreview } from './LocationSystemSettings.jsx';
import {
  findSystem, levelOptions, levelTypeName, composeLocationString,
  resolveLocationString, nextBin, usedBinsForSystem, LEVEL_KEYS, normalizeBin,
} from '../utils/locationSystem.js';

// The "Assign Location" picker (prototype tab) bound to a specific tool. Lives
// in the tool detail. Writes a structured location to the tool via
// assignToolLocation (which composes the string into Fusion vendor + metadata).
//
// Also reusable for holder body / insert component records (insertFamilies.js):
// pass `record` (anything carrying tool_location / bin_size_id /
// legacy_locations) and an `onAssign(toolLocation, binSizeId)` save handler —
// component saves are metadata-only, so they must NOT route through
// assignToolLocation (a full Fusion round-trip).
//
// ⚠️ THE PANEL MUST SAY WHAT IS ALREADY TRUE BEFORE IT ASKS FOR A CHANGE.
// It used to open on a bare set of pickers with an always-identical "Set
// location" button, so an assigned tool and an unassigned one looked the same,
// and pressing Set changed nothing on screen — the save was real but invisible,
// which reads as a broken button. So: the current location is stated at the
// top, the preview is only labelled as a pending change when it actually
// differs, and the button reports the state it is in (Set / Update / already
// set / just saved).
export default function LocationPicker({ tool, record, onAssign }) {
  const { tools, components, shopSettings, assignToolLocation, isSaving } = useApp();
  const rec = record || tool;
  const systems = shopSettings?.location_config?.systems || [];
  // Retired free-text locations are hidden by default (parallel to the Tool ID
  // System's show_legacy toggle, but defaulting OFF for Location/Assembly).
  const showLegacy = shopSettings?.location_config?.show_legacy ?? false;
  const legacyLocations = Array.isArray(rec.legacy_locations) ? rec.legacy_locations : [];

  // Bins are occupied by tools AND component records (both carry tool_location).
  const locRecords = useMemo(
    () => [...tools, ...((components?.components) || [])],
    [tools, components]
  );

  const current = rec.tool_location || null;
  const [sysId, setSysId] = useState(current?.system_id || systems[0]?.id || '');
  const [picks, setPicks] = useState({
    zone_id: current?.zone_id || null,
    station_id: current?.station_id || null,
    drawer_id: current?.drawer_id || null,
  });
  const [bin, setBin] = useState(current?.bin != null ? String(current.bin) : '');
  // A brief "Saved" confirmation. The button also settles into its "already
  // set" state on its own once the record comes back updated, but that
  // transition is easy to miss on a value that didn't visibly move.
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    if (!justSaved) return undefined;
    const t = setTimeout(() => setJustSaved(false), 2200);
    return () => clearTimeout(t);
  }, [justSaved]);

  const system = findSystem(systems, sysId);

  // Suggested next bin for an auto-increment system (excludes this record's own
  // bin). '' when there is nothing sensible to suggest — a system that allows
  // duplicates isn't a sequence, so it gets no suggestion and the bin must be
  // typed in. That matters because a blank field falls back to the suggestion:
  // a wrong pre-filled number would save itself unless the user remembered to
  // overwrite it.
  const suggestedBin = useMemo(() => {
    if (!system || system.levels.bin.fixed) return '';
    const used = usedBinsForSystem(locRecords.filter(t => t.id !== rec.id), sysId);
    const next = nextBin(system, used);
    return next == null ? '' : String(next);
  }, [system, locRecords, rec.id, sysId]);

  // ⚠️ Show the bin that will actually be SAVED, not a grey placeholder over an
  // empty box. A blank field already falls back to the suggestion, so a
  // placeholder was showing one thing and saving another — and an empty box
  // reads as "you must type something" when the app already has the answer.
  // Typing replaces it; clearing the field falls back to the suggestion again,
  // which is exactly what saving would do.
  const binValue = bin.trim() !== '' ? bin : suggestedBin;

  // With no suggestion to fall back on, an empty bin would compose a location
  // with a missing segment — require one instead.
  const binMissing = !!system && !system.levels.bin.fixed && !binValue.trim();

  function selectSystem(id) {
    setSysId(id);
    setPicks({ zone_id: null, station_id: null, drawer_id: null });
    setBin('');
  }

  function draftLocation() {
    if (!system) return null;
    const binVal = system.levels.bin.fixed
      ? system.levels.bin.fixedVal
      : binValue.trim();
    return {
      system_id: sysId,
      zone_id: system.levels.zone.on ? picks.zone_id : null,
      station_id: system.levels.station.on ? picks.station_id : null,
      drawer_id: system.levels.drawer.on ? picks.drawer_id : null,
      // One canonical shape for a stored bin — see normalizeBin.
      bin: normalizeBin(binVal),
    };
  }

  const draft = system ? draftLocation() : null;
  const preview = system ? (composeLocationString(draft, system) || '—') : '—';

  // What the record holds RIGHT NOW: the composed structured location, else the
  // legacy free-text string a tool may still be carrying from Fusion.
  const currentLabel = current ? resolveLocationString(current, systems) : '';
  const legacyText = !current ? (rec.location || '') : '';

  // Is the draft simply what is already saved? Drives the button: pressing
  // "Set" on an unchanged draft is a no-op the user shouldn't be invited into.
  const sameAsCurrent = !!current && !!draft
    && current.system_id === draft.system_id
    && (current.zone_id || null) === (draft.zone_id || null)
    && (current.station_id || null) === (draft.station_id || null)
    && (current.drawer_id || null) === (draft.drawer_id || null)
    && String(current.bin ?? '') === String(draft.bin ?? '');

  // Enforce the system's "no duplicate locations" rule on the bin number.
  const binCollision = useMemo(() => {
    if (!system || system.levels.bin.fixed || system.allowDuplicates) return false;
    const val = binValue.trim();
    if (!val) return false;
    const n = Number(val);
    return locRecords.some(t => t.id !== rec.id
      && t.tool_location?.system_id === sysId
      && Number(t.tool_location?.bin) === n);
  }, [system, binValue, locRecords, rec.id, sysId]);

  async function setLocation() {
    const loc = draftLocation();
    try {
      if (onAssign) await onAssign(loc, rec.bin_size_id || null);
      else await assignToolLocation(rec, loc, rec.bin_size_id || null);
      setJustSaved(true);
    } catch { /* toast handled in context */ }
  }
  async function clearLocation() {
    try {
      if (onAssign) await onAssign(null, null);
      else await assignToolLocation(rec, null, null);
      setJustSaved(false);
    } catch { /* toast handled in context */ }
  }
  // Throw away an in-progress edit and go back to what is saved.
  function revertDraft() {
    setSysId(current?.system_id || systems[0]?.id || '');
    setPicks({
      zone_id: current?.zone_id || null,
      station_id: current?.station_id || null,
      drawer_id: current?.drawer_id || null,
    });
    setBin(current?.bin != null ? String(current.bin) : '');
  }

  if (systems.length === 0) {
    return (
      <div className="text-sub text-sm">
        No location systems configured yet. Set one up in <strong>Settings → Location System</strong> to assign structured locations.
        {rec.location && <div style={{ marginTop: 6 }}>Current location text: <span className="font-mono location-tag">{rec.location}</span></div>}
      </div>
    );
  }

  const boxStyle = {
    background: 'color-mix(in srgb, var(--blue) 7%, transparent)',
    border: '1px solid color-mix(in srgb, var(--blue) 35%, transparent)',
    borderRadius: 6, padding: '10px 12px',
  };
  const capStyle = {
    fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.1em',
    textTransform: 'uppercase', color: 'var(--blue)', marginBottom: 6,
  };

  function levelRow(levelKey) {
    const level = system.levels[levelKey];
    if (!level.on) return null;
    // Fall back to the slot's own name so an unnamed custom level reads
    // "DRAWER" here rather than a meaningless "CUSTOM".
    const typeName = levelTypeName(level, levelKey.charAt(0).toUpperCase() + levelKey.slice(1));
    const opts = levelOptions(system, levelKey);
    return (
      <div key={levelKey} style={boxStyle}>
        <div style={capStyle}>{typeName}</div>
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

  const blocked = binCollision || binMissing;

  return (
    <div>
      {/* ── What this tool's location IS right now ─────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: '8px 12px', marginBottom: 12, borderRadius: 7,
        background: current
          ? 'color-mix(in srgb, var(--green) 10%, transparent)'
          : 'var(--input-bg)',
        border: `1px solid ${current
          ? 'color-mix(in srgb, var(--green) 35%, transparent)'
          : 'var(--border)'}`,
      }}>
        {current ? (
          <>
            <Check size={14} style={{ color: 'var(--green)', flexShrink: 0 }} />
            <span className="text-xs text-sub">Assigned</span>
            <span className="location-tag">{currentLabel || '—'}</span>
            <span className="text-xs text-sub">
              in {findSystem(systems, current.system_id)?.name || 'an unknown system'}
            </span>
          </>
        ) : (
          <>
            <MapPin size={14} className="text-sub" style={{ flexShrink: 0 }} />
            <span className="text-sm text-sub">
              No location assigned yet — pick the system and bin below, then press Set location.
            </span>
            {legacyText && (
              <span className="text-xs text-sub">
                Fusion currently shows <span className="font-mono">{legacyText}</span>
              </span>
            )}
          </>
        )}
      </div>

      <div className="field-group" style={{ marginBottom: 12 }}>
        <label className="field-label">Location system</label>
        {systems.length === 1 ? (
          // One system is not a choice — showing it as a dropdown implied there
          // was something to decide here.
          <div className="text-sm" style={{ fontWeight: 600 }}>{systems[0].name}</div>
        ) : (
          <select className="field-input" value={sysId} onChange={e => selectSystem(e.target.value)}>
            {systems.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>

      {system && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {LEVEL_KEYS.map(levelRow)}
            {/* Bin */}
            <div style={boxStyle}>
              <div style={capStyle}>Bin</div>
              {system.levels.bin.fixed ? (
                <div className="font-mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{system.levels.bin.fixedVal || '1000'} <span className="text-sub text-xs" style={{ fontWeight: 400 }}>fixed</span></div>
              ) : (
                <>
                  <input className="field-input font-mono" style={{ width: 150, fontSize: '1rem', fontWeight: 700 }} value={binValue} onChange={e => setBin(e.target.value)} />
                  {suggestedBin
                    ? (
                      <div className="text-sub text-xs" style={{ marginTop: 4 }}>
                        {binValue === suggestedBin
                          ? <>Next free bin in this system — type over it to use another.</>
                          : <>Next free bin is <span className="font-mono">{suggestedBin}</span>.{' '}
                            <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '1px 6px', fontSize: 11 }} onClick={() => setBin(suggestedBin)}>Use it</button></>}
                      </div>
                    )
                    : <div className="text-sub text-xs" style={{ marginTop: 4 }}>This system allows duplicates, so there's no next number to suggest — enter the bin.</div>}
                </>
              )}
            </div>
          </div>

          {system.allowDuplicates && (
            <div style={{ background: 'color-mix(in srgb, var(--orange) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--orange) 40%, transparent)', borderRadius: 6, padding: '8px 12px', fontSize: '0.78rem', color: 'var(--orange)', marginTop: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
              <AlertTriangle size={13} style={{ flexShrink: 0 }} /> Duplicate locations allowed for this system.
            </div>
          )}

          {binCollision && (
            <div style={{ background: 'color-mix(in srgb, var(--red) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--red) 40%, transparent)', borderRadius: 6, padding: '8px 12px', fontSize: '0.78rem', color: 'var(--red)', marginTop: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
              <AlertTriangle size={13} style={{ flexShrink: 0 }} /> Bin {binValue.trim()} is already used in this system, which doesn't allow duplicates. Pick another bin.
            </div>
          )}

          {binMissing && (
            <div className="text-sub text-xs" style={{ marginTop: 12 }}>Enter a bin number to set the location.</div>
          )}

          {/* ── What pressing the button will do ───────────────────────────── */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)',
          }}>
            <span className="text-xs text-sub" style={{ minWidth: 62 }}>
              {sameAsCurrent ? 'Location' : (current ? 'Will change to' : 'Will be set to')}
            </span>
            <LivePreview value={blocked ? '—' : preview} />
            {!sameAsCurrent && current && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={revertDraft} title="Discard this edit and go back to the saved location">
                <RotateCcw size={12} /> Revert
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={setLocation}
              disabled={isSaving || blocked || sameAsCurrent}
            >
              {justSaved && sameAsCurrent
                ? <><Check size={13} /> Saved</>
                : isSaving
                  ? <><MapPin size={13} /> Saving…</>
                  : sameAsCurrent
                    ? <><Check size={13} /> Location set</>
                    : <><MapPin size={13} /> {current ? 'Update location' : 'Set location'}</>}
            </button>
            {current && (
              <button className="btn btn-ghost btn-sm" onClick={clearLocation} disabled={isSaving}>Clear</button>
            )}
            {sameAsCurrent && !justSaved && (
              <span className="text-xs text-sub">Change the bin or system above to move this tool.</span>
            )}
          </div>
        </>
      )}

      {/* Former (retired) free-text locations — muted, gated on the Location
          System's show_legacy toggle (defaults OFF). A search match still
          surfaces them on the result card regardless. */}
      {showLegacy && legacyLocations.length > 0 && (
        <div className="text-sub text-xs" style={{ marginTop: 12 }}>
          Formerly:{' '}
          <span className="font-mono">{legacyLocations.join(', ')}</span>
        </div>
      )}
    </div>
  );
}
