import { useState, useMemo } from 'react';
import { Search, X, Plus, ChevronDown, ChevronRight, ShieldOff } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { ID_SYSTEMS, excludedTools, isExcludedFrom } from '../utils/idSystems.js';

// Settings → ID System Membership. Every tool is a member of the three ID systems
// (Tool ID / Machine Number / Location) by default, so bulk actions (Assign IDs /
// Re-number / Renumber machine #s / normalize a Location system) process it. Here
// you can review which tools have been EXCLUDED from each system and add them back,
// or exclude a tool. Excluded tools are skipped by that system's bulk action.
export default function IdSystemMembership() {
  const { tools, setIdSystemExclusion, googleAuthenticated, demoMode } = useApp();
  const canEdit = googleAuthenticated || demoMode;

  return (
    <div className="card">
      <div className="flex items-center gap-8" style={{ marginBottom: 6 }}>
        <ShieldOff size={16} style={{ color: 'var(--blue)' }} />
        <h3 style={{ margin: 0 }}>ID System Membership</h3>
      </div>
      <p className="text-sub text-sm" style={{ marginBottom: 14 }}>
        Every tool belongs to all three ID systems by default, so re-numbering / assigning IDs / normalizing
        locations includes it — even tools that aren&apos;t in Fusion. Exclude a tool from a system to have that
        system&apos;s bulk action skip it. Excluded tools stay listed here so nothing is skipped without you knowing.
      </p>
      {!canEdit && (
        <div className="text-xs text-sub" style={{ marginBottom: 10 }}>Connect Google Drive to change membership.</div>
      )}
      {ID_SYSTEMS.map(sys => (
        <SystemBlock key={sys.key} system={sys} tools={tools} canEdit={canEdit}
          onSet={setIdSystemExclusion} />
      ))}
    </div>
  );
}

function SystemBlock({ system, tools, canEdit, onSet }) {
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const excluded = useMemo(() => excludedTools(tools, system.key), [tools, system.key]);

  const set = async (toolId, excludedVal) => {
    setBusyId(toolId);
    try { await onSet(toolId, system.key, excludedVal); }
    catch { /* toast handled in context */ }
    finally { setBusyId(null); }
  };

  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '12px 0' }}>
      <button className="flex items-center gap-8" style={{ background: 'none', border: 'none', width: '100%', cursor: 'pointer', padding: 0 }}
        onClick={() => setOpen(o => !o)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="text-sm" style={{ fontWeight: 600 }}>{system.label}</span>
        <span className={`text-xs ${excluded.length ? '' : 'text-sub'}`}
          style={{ marginLeft: 'auto', color: excluded.length ? 'var(--orange)' : undefined }}>
          {excluded.length ? `${excluded.length} excluded` : 'all included'}
        </span>
      </button>

      {open && (
        <div style={{ paddingLeft: 22, marginTop: 10 }}>
          {excluded.length === 0
            ? <div className="text-xs text-sub" style={{ marginBottom: 10 }}>No tools excluded — every tool is in this system.</div>
            : excluded.map(t => (
              <div key={t.id} className="flex items-center gap-8" style={{ marginBottom: 6 }}>
                <span className="description-badge" style={{ fontSize: 12 }}>{t.description || '—'}</span>
                {t.tool_id && <span className="tool-id-pill" style={{ fontSize: 11 }}>{t.tool_id}</span>}
                <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} disabled={!canEdit || busyId === t.id}
                  onClick={() => set(t.id, false)}>
                  {busyId === t.id ? '…' : 'Add back'}
                </button>
              </div>
            ))}

          {canEdit && <ExcludePicker system={system} tools={tools} busyId={busyId} onExclude={id => set(id, true)} />}
        </div>
      )}
    </div>
  );
}

// Search a tool by description / Tool ID and exclude it from this system.
function ExcludePicker({ system, tools, busyId, onExclude }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return [];
    return (tools || [])
      .filter(t => !isExcludedFrom(t, system.key))
      .filter(t => String(t.description || '').toLowerCase().includes(q) || String(t.tool_id || '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [tools, q, system.key]);

  return (
    <div style={{ marginTop: 10 }}>
      <div className="pn-search" style={{ maxWidth: 360 }}>
        <Search size={13} />
        <input className="field-input" value={query} placeholder={`Exclude a tool from ${system.label}…`}
          onChange={e => setQuery(e.target.value)} />
        {query && <button className="icon-btn" title="Clear" onClick={() => setQuery('')}><X size={13} /></button>}
      </div>
      {q && (
        <div className="job-pick-results" style={{ maxWidth: 360 }}>
          {matches.length === 0 && <div className="text-xs text-sub" style={{ padding: '6px 2px' }}>No matching tool.</div>}
          {matches.map(t => (
            <button key={t.id} type="button" className="job-pick-row" disabled={busyId === t.id}
              onClick={() => { onExclude(t.id); setQuery(''); }}>
              <Plus size={12} style={{ color: 'var(--orange)' }} />
              <span className="pn-part-number">{t.description || '—'}</span>
              {t.tool_id && <span className="text-xs text-sub">{t.tool_id}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
