// Searchable picker for a holder body / insert component record, with inline
// create — the ONLY way components are browsed (no standalone manage page, per
// the insert-tool architecture spec). Same reusable-entity pattern as the
// manufacturer pickers in the purchasing section: components are referenced by
// stable UUID, never duplicated onto the pairing.
import { useState, useMemo } from 'react';
import { Search, Plus } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import {
  newComponent, COMPONENT_ROLE_LABELS, INSERT_FAMILY_BY_ID,
} from '../schema/insertFamilies.js';

export default function ComponentPicker({ role, family, currentId, onSelect, onClose }) {
  const { components, saveComponent, isSaving, googleAuthenticated, demoMode } = useApp();
  const roleLabel = COMPONENT_ROLE_LABELS[role] || role;
  const rolePlural = role === 'holder_body' ? 'holder bodies' : `${roleLabel.toLowerCase()}s`;
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ description: '', tool_id: '', designation: '' });
  const [error, setError] = useState('');

  const all = (components?.components || []).filter(c => c.role === role);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    const hit = (c) => !q
      || String(c.tool_id || '').toLowerCase().includes(q)
      || String(c.description || '').toLowerCase().includes(q)
      || String(c.designation || '').toLowerCase().includes(q);
    return all.filter(hit);
  }, [all, q]);

  // Same-family components first — a holder body usually pairs within its own
  // family — but everything stays selectable (suggestion, not enforcement).
  const sameFamily = matches.filter(c => c.family === family);
  const otherFamily = matches.filter(c => c.family !== family);

  const canWrite = googleAuthenticated || demoMode;

  const handleCreate = async () => {
    if (!draft.description.trim() && !draft.designation.trim()) {
      setError('Give the new component a description or designation.');
      return;
    }
    setError('');
    try {
      const comp = await saveComponent(newComponent(role, family, {
        description: draft.description.trim(),
        tool_id: draft.tool_id.trim(),
        designation: draft.designation.trim(),
      }));
      onSelect(comp);
    } catch (err) {
      setError(err.message);
    }
  };

  const Row = ({ comp }) => (
    <div
      className={`assembly-picker-option${comp.id === currentId ? ' selected' : ''}`}
      onClick={() => onSelect(comp)}
    >
      {comp.tool_id && <span className="tool-id-pill">{comp.tool_id}</span>}
      <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {comp.description || comp.designation || '—'}
      </span>
      {comp.description && comp.designation && (
        <span className="text-sub font-mono" style={{ fontSize: 11 }}>{comp.designation}</span>
      )}
      <span className="text-sub" style={{ fontSize: 11, marginLeft: 'auto', flexShrink: 0 }}>
        {INSERT_FAMILY_BY_ID[comp.family]?.label || ''}
      </span>
    </div>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">Select {roleLabel}</h3>

        <div style={{ position: 'relative', marginBottom: 10 }}>
          <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--blue)' }} />
          <input
            className="field-input"
            style={{ paddingLeft: 30 }}
            autoFocus
            placeholder={`Search ${rolePlural} by ID, description, designation…`}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>

        <div style={{ maxHeight: 320, overflowY: 'auto', marginBottom: 10 }}>
          {sameFamily.length === 0 && otherFamily.length === 0 && (
            <div className="detail-field-empty text-sm" style={{ padding: '10px 2px' }}>
              {all.length === 0
                ? `No ${roleLabel.toLowerCase()} records yet — create the first one below.`
                : 'No matches.'}
            </div>
          )}
          {sameFamily.map(c => <Row key={c.id} comp={c} />)}
          {otherFamily.length > 0 && (
            <>
              <div className="text-sub" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '10px 0 6px' }}>
                Other families
              </div>
              {otherFamily.map(c => <Row key={c.id} comp={c} />)}
            </>
          )}
        </div>

        {!creating ? (
          <button
            className="btn btn-secondary btn-sm"
            disabled={!canWrite}
            title={canWrite ? undefined : 'Connect Google Drive to create components'}
            onClick={() => setCreating(true)}
          >
            <Plus size={13} /> New {roleLabel.toLowerCase()}
          </button>
        ) : (
          <div style={{ padding: 12, background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)' }}>
            <div className="field-group" style={{ marginBottom: 8 }}>
              <label className="field-label">Description</label>
              <input className="field-input" value={draft.description} autoFocus
                placeholder={role === 'insert' ? 'e.g. CNMG 432 KC5010 steel insert' : 'e.g. 3/4 boring bar body'}
                onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div className="field-group" style={{ flex: 1 }}>
                <label className="field-label">Tool ID</label>
                <input className="field-input" value={draft.tool_id} placeholder="e.g. TO-195"
                  onChange={e => setDraft(d => ({ ...d, tool_id: e.target.value }))} />
              </div>
              <div className="field-group" style={{ flex: 1 }}>
                <label className="field-label">Designation</label>
                <input className="field-input" value={draft.designation}
                  placeholder={role === 'insert' ? 'e.g. CNMG 432' : 'e.g. MCLNR 16-4D'}
                  onChange={e => setDraft(d => ({ ...d, designation: e.target.value }))} />
              </div>
            </div>
            {error && <div className="error-banner" style={{ marginTop: 8 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => { setCreating(false); setError(''); }}>Cancel</button>
              <button className="btn btn-primary btn-sm" disabled={isSaving} onClick={handleCreate}>
                {isSaving ? 'Creating…' : 'Create & select'}
              </button>
            </div>
          </div>
        )}

        <div className="modal-actions" style={{ marginTop: 12 }}>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
