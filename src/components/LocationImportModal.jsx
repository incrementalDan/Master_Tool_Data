import { useState, useMemo, useRef } from 'react';
import { UploadCloud, AlertTriangle, MapPin, X } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { parseCSV } from './ImportFlow.jsx';
import { proShopRowsToObjects, detectProShopFormat, proShopFormatLabel } from '../utils/proShopHeaders.js';
import { normProShopId } from '../schema/insertFamilies.js';
import {
  routeProShopLocations, resolveLocationString, hasConfiguredImportRules, systemImportRule,
} from '../utils/locationSystem.js';

// Location-only ProShop re-import.
//
// Reads a full ProShop export but touches NOTHING except each tool's location —
// no purchasing, no MIN OOH, no descriptions. Matching is on Tool # only.
//
// This is the one place ProShop wins outright over a location the app already
// owns (everywhere else that disagreement is flagged for review — see the
// location rule in ImportFlow). That is the whole point of the action: it exists
// to correct locations the app got wrong, and every tool being corrected is in
// exactly the state that rule would flag, so flagging would turn the cleanup
// into hundreds of one-at-a-time decisions. The dialog states this plainly.

const EXCEPTION_LABEL = {
  no_value: 'No location in ProShop',
  unmatched: 'No system claimed this number',
  duplicate: 'Same number on more than one tool',
  needs_levels: 'System needs a level picked by hand',
  no_tool: 'Nothing in the library with this Tool #',
};

export default function LocationImportModal({ onClose }) {
  const { tools, shopSettings, components, importLocationsFromProShop } = useApp();
  const systems = shopSettings?.location_config?.systems || [];
  const [rows, setRows] = useState(null);
  const [format, setFormat] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);

  // Tool # → tool, tolerant of dash/space/case, including retired IDs.
  const toolByNum = useMemo(() => {
    const m = new Map();
    for (const t of tools || []) {
      const pid = normProShopId(t.tool_id || '');
      if (pid && !m.has(pid)) m.set(pid, t);
      for (const legacy of t.legacy_ids || []) {
        const k = normProShopId(legacy);
        if (k && !m.has(k)) m.set(k, t);
      }
    }
    return m;
  }, [tools]);

  // Component records (holder bodies / inserts) carry their own ProShop numbers.
  // Indexed so a row that hits one is reported accurately instead of as a tool
  // the library is missing.
  const componentByNum = useMemo(() => {
    const m = new Map();
    for (const c of components?.components || []) {
      const k = normProShopId(c.tool_id || '');
      if (k && !m.has(k)) m.set(k, c);
    }
    return m;
  }, [components]);

  const handleFile = (file) => {
    if (!file) return;
    setError(''); setDone(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const raw = parseCSV(e.target.result);
        if (raw.length < 2) throw new Error('CSV must have a header row and at least one data row');
        setFormat(detectProShopFormat(raw[0]));
        const data = proShopRowsToObjects(raw);
        // One entry per Tool # — a tool with several Approved-Brand rows repeats,
        // and its location is the same on each.
        const seen = new Map();
        for (const r of data) {
          const key = (r['Tool #'] || '').trim();
          if (!key || seen.has(key)) continue;
          // ProShop exports end with a TOTALS summary row — no description, no
          // group, not a tool. Left in, it shows up in the worklist as a tool
          // the library is missing.
          if (!(r['Description'] || '').trim() && !(r['Tool Group'] || '').trim()) continue;
          seen.set(key, { key, value: (r['Location'] || '').trim() });
        }
        setRows([...seen.values()]);
      } catch (err) {
        setError(`ProShop CSV parse error: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  // Route every row through the per-system cascade, then match to tools.
  const plan = useMemo(() => {
    if (!rows) return null;
    const { assignments, exceptions } = routeProShopLocations(rows, systems);
    const changes = [];
    const unchanged = [];
    const extra = [];
    for (const a of assignments) {
      const num = normProShopId(a.key);
      // A component (an insert tool's holder body / insert) is a real physical
      // object in a real drawer, so it gets a location exactly like a tool. It
      // only lives in a different file — never a user-facing distinction.
      const tool = toolByNum.get(num) || componentByNum.get(num);
      if (!tool) { extra.push({ type: 'no_tool', key: a.key, bin: a.bin }); continue; }
      const isComponent = !toolByNum.has(num);
      const to = resolveLocationString(a.location, systems);
      const from = (tool.location || '').trim();
      // A tool whose legacy free text already READS right (Fusion vendor "LC-140")
      // still has no structured tool_location, so the app doesn't own it and it
      // can't persist for a no-Fusion tool. Comparing strings alone would skip it
      // forever — take it over as well, and only call it unchanged when the app
      // already owns the same bin in the same system.
      const owned = tool.tool_location?.system_id === a.location.system_id
        && String(tool.tool_location?.bin ?? '') === String(a.location.bin ?? '');
      const row = { id: tool.id, isComponent, key: a.key, description: tool.description, from, to, location: a.location };
      (owned && from === to ? unchanged : changes).push(row);
    }
    return { changes, unchanged, exceptions: [...exceptions, ...extra] };
  }, [rows, systems, toolByNum, componentByNum]);

  const commit = async () => {
    if (!plan?.changes.length) return;
    setBusy(true);
    try {
      const res = await importLocationsFromProShop(
        plan.changes.map(c => ({ id: c.id, isComponent: c.isComponent, location: c.location })),
      );
      setDone(res);
    } catch {
      /* importLocationsFromProShop already surfaced a toast */
    } finally {
      setBusy(false);
    }
  };

  // Two setup traps, both of which silently produce no assignments:
  //  • nothing configured at all with >1 system (no legacy fallback applies)
  //  • SOME systems configured — which switches the legacy fallback off for
  //    ALL of them, so the ones still on "Never" quietly stop claiming anything.
  //    That second case is the likelier one and used to go unmentioned.
  const configured = hasConfiguredImportRules(systems);
  const idleSystems = systems.filter(s => systemImportRule(s).match === 'off');
  const noRules = systems.length > 1 && !configured;
  const partialRules = configured && idleSystems.length > 0;

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal" style={{ maxWidth: 760 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 className="modal-title" style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <MapPin size={17} style={{ color: 'var(--blue)' }} /> Import Locations from ProShop
          </h3>
          {!busy && <button className="icon-btn" onClick={onClose} title="Close"><X size={16} /></button>}
        </div>

        {!done && (
          <div className="warn-banner mb-12">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                <strong>ProShop wins outright here.</strong> The normal ProShop merge flags a
                location that disagrees with one this app already owns; this import overwrites it
                instead. Only locations are read — nothing else in the file is touched. The
                previous location is kept and stays searchable.
              </span>
            </div>
          </div>
        )}

        {noRules && (
          <div className="warn-banner mb-12">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                You have more than one location system but no import rules configured. Set
                <strong> ProShop location import</strong> on each system first — a bare number
                can't be routed to the right system without it.
              </span>
            </div>
          </div>
        )}

        {partialRules && (
          <div className="warn-banner mb-12">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                {idleSystems.map(s => s.name).join(', ')}{' '}
                {idleSystems.length === 1 ? 'has' : 'have'} no import rule set, so{' '}
                {idleSystems.length === 1 ? 'it claims' : 'they claim'} nothing. Once any system
                has a rule, every other system needs one too — set{' '}
                <strong>ProShop location import</strong> on {idleSystems.length === 1 ? 'it' : 'them'} as well.
              </span>
            </div>
          </div>
        )}

        {error && <div className="error-banner mb-12">{error}</div>}

        {done && (
          <div className="text-sm mb-12">
            <div style={{ marginBottom: 8 }}>
              Updated <strong>{done.updated}</strong> {done.updated === 1 ? 'location' : 'locations'}.
              Remaining problems are listed under <strong>Location Issues</strong> in
              Settings → Location System, and clear themselves as you fix each tool.
            </div>
            {/* Location IS a Fusion-native field (its vendor box), so say plainly
                that Fusion is still holding the old value rather than leaving it
                to be discovered. Same lazy re-sync as normalization. */}
            <div className="text-sub text-xs">
              This was a metadata-only write, so Fusion still shows the previous location for
              these tools. Each one re-syncs to Fusion's vendor field the next time that tool is
              saved.
            </div>
          </div>
        )}

        {!rows && !done && (
          <div
            className={`upload-zone ${drag ? 'drag-over' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
          >
            <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }}
              onChange={e => handleFile(e.target.files[0])} />
            <UploadCloud size={22} style={{ color: 'var(--text-sub)' }} />
            <div className="text-sm mt-8">Drop ProShop CSV here or click to browse</div>
            <div className="text-sub text-xs mt-8">
              A full-library export is fine — every column except Tool # and Location is ignored.
            </div>
          </div>
        )}

        {plan && !done && (
          <>
            {format && (
              <div className="text-sub text-xs mb-8">
                Detected: {proShopFormatLabel(format)} · {rows.length} tool rows
              </div>
            )}

            <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginBottom: 14 }}>
              <Stat n={plan.changes.length} label="to update" color="var(--blue)" />
              <Stat n={plan.unchanged.length} label="already correct" color="var(--text-sub)" />
              <Stat n={plan.exceptions.length} label="needs a look" color="var(--orange)" />
            </div>

            {plan.changes.length > 0 && (
              <>
                <div className="section-header mb-8">
                  {plan.changes.length} location{plan.changes.length === 1 ? '' : 's'} to change
                </div>
                <TableBox>
                  <table className="match-table">
                    <thead><tr><th>Tool #</th><th>Description</th><th>Now</th><th>ProShop</th></tr></thead>
                    <tbody>
                      {plan.changes.slice(0, 200).map(c => (
                        <tr key={c.id}>
                          <td className="text-sm font-mono">
                            {c.key}
                            {/* Marked, not separated — a component is the same
                                kind of thing here, just stored elsewhere. */}
                            {c.isComponent && <span className="text-sub" style={{ fontSize: '0.65rem' }}> · part</span>}
                          </td>
                          <td className="text-sm" style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.description}</td>
                          <td className="text-sm font-mono text-sub">{c.from || '—'}</td>
                          <td className="text-sm font-mono" style={{ color: 'var(--blue)' }}>{c.to}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableBox>
                {plan.changes.length > 200 && (
                  <div className="text-sub text-xs mt-8">…and {plan.changes.length - 200} more.</div>
                )}
              </>
            )}

            {plan.exceptions.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div className="section-header mb-8" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertTriangle size={13} style={{ color: 'var(--orange)' }} />
                  {plan.exceptions.length} need{plan.exceptions.length === 1 ? 's' : ''} a look
                </div>
                <div className="text-sub text-xs mb-8">
                  These are left alone. Fix them in ProShop and re-run, or set them by hand on
                  each tool page.
                </div>
                <TableBox>
                  <table className="match-table">
                    <thead><tr><th>Tool #</th><th>Value</th><th>Why</th></tr></thead>
                    <tbody>
                      {plan.exceptions.slice(0, 200).map((x, i) => (
                        <tr key={i}>
                          <td className="text-sm font-mono">{x.keys ? x.keys.join(', ') : (x.key || '—')}</td>
                          <td className="text-sm font-mono">{x.bin ?? x.value ?? '—'}</td>
                          <td className="text-sm text-sub">{EXCEPTION_LABEL[x.type] || x.type}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableBox>
              </div>
            )}
          </>
        )}

        <div className="modal-actions" style={{ marginTop: 18 }}>
          <button className="btn" onClick={onClose} disabled={busy}>{done ? 'Close' : 'Cancel'}</button>
          {plan && !done && (
            <button className="btn btn-primary" disabled={busy || !plan.changes.length} onClick={commit}>
              {busy ? 'Saving…' : `Update ${plan.changes.length} location${plan.changes.length === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ n, label, color }) {
  return (
    <div>
      <div className="font-mono" style={{ fontSize: '1.35rem', fontWeight: 700, color }}>{n}</div>
      <div className="text-sub text-xs">{label}</div>
    </div>
  );
}

function TableBox({ children }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', maxHeight: 260, overflowY: 'auto' }}>
      {children}
    </div>
  );
}
