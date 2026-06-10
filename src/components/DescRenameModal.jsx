import { useState, useMemo } from 'react';
import { X, Wand2 } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { buildDesc } from '../utils/toolNaming.js';
import { toolToExtractor } from '../schema/toolSchema.js';

export default function DescRenameModal({ onClose }) {
  const { tools, saveFullLibrary, isSaving } = useApp();

  // Tools where the geometry-based suggestion differs from the current description.
  const candidates = useMemo(() => {
    return tools
      .map(t => {
        const suggested = (buildDesc(toolToExtractor(t)) || '').trim();
        return suggested && suggested !== (t.description || '').trim()
          ? { tool: t, suggested }
          : null;
      })
      .filter(Boolean);
  }, [tools]);

  // accepted: Set of tool IDs to rename. Starts with all candidates checked.
  const [accepted, setAccepted] = useState(() => new Set(candidates.map(c => c.tool.id)));
  // edits: { [toolId]: string } — what each accepted description will become.
  const [edits, setEdits] = useState(() =>
    Object.fromEntries(candidates.map(c => [c.tool.id, c.suggested]))
  );
  const [applyError, setApplyError] = useState('');

  const toggleAll = (on) =>
    setAccepted(on ? new Set(candidates.map(c => c.tool.id)) : new Set());

  const toggle = (id) =>
    setAccepted(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const acceptedCount = accepted.size;

  const handleApply = async () => {
    if (acceptedCount === 0) { onClose(); return; }
    setApplyError('');
    try {
      const updatedTools = tools.map(t =>
        accepted.has(t.id)
          ? { ...t, description: (edits[t.id] ?? t.description).trim() || t.description }
          : t
      );
      await saveFullLibrary(updatedTools);
      onClose();
    } catch (err) {
      setApplyError(err.message);
    }
  };

  return (
    <div className="modal-backdrop">
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', padding: 24,
        width: '100%', maxWidth: 780, maxHeight: '90vh',
        display: 'flex', flexDirection: 'column', gap: 16,
        boxShadow: 'var(--shadow-lg)',
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Wand2 size={16} style={{ color: 'var(--blue)' }} />
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Rename Tool Descriptions</h2>
            </div>
            {candidates.length > 0 ? (
              <p className="text-sub text-sm">
                {candidates.length} tool{candidates.length !== 1 ? 's' : ''} have a geometry-based
                suggestion that differs from the current description. Uncheck any you want to skip,
                or edit the suggested text before applying.
              </p>
            ) : (
              <p className="text-sub text-sm">
                All tool descriptions already match the geometry-based suggestion.
              </p>
            )}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ flexShrink: 0 }}>
            <X size={16} />
          </button>
        </div>

        {candidates.length === 0 ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={onClose}>Close</button>
          </div>
        ) : (
          <>
            {/* Bulk controls */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => toggleAll(true)}>Select all</button>
              <button className="btn btn-ghost btn-sm" onClick={() => toggleAll(false)}>Clear all</button>
              <span className="text-sub text-xs" style={{ marginLeft: 4 }}>
                {acceptedCount} of {candidates.length} selected
              </span>
            </div>

            {/* Candidate list */}
            <div style={{
              flex: 1, overflowY: 'auto', minHeight: 0,
              border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
            }}>
              {candidates.map((c, i) => {
                const isOn = accepted.has(c.tool.id);
                return (
                  <div key={c.tool.id} style={{
                    padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'flex-start',
                    borderBottom: i < candidates.length - 1 ? '1px solid var(--border)' : 'none',
                    opacity: isOn ? 1 : 0.45,
                    background: isOn ? 'var(--surface)' : 'transparent',
                  }}>
                    <input
                      type="checkbox" checked={isOn}
                      onChange={() => toggle(c.tool.id)}
                      style={{ marginTop: 4, flexShrink: 0, cursor: 'pointer' }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="text-sub" style={{ fontSize: 11, marginBottom: 4 }}>
                        {c.tool.tool_type}
                        {c.tool.proshot_id ? <> · <span style={{ color: 'var(--amber, #f59e0b)' }}>{c.tool.proshot_id}</span></> : ''}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 10, rowGap: 4, alignItems: 'center' }}>
                        <span className="text-sub" style={{ fontSize: 11 }}>Current</span>
                        <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-sub)', wordBreak: 'break-all' }}>
                          {c.tool.description || <em style={{ opacity: 0.5 }}>(empty)</em>}
                        </span>
                        <span className="text-sub" style={{ fontSize: 11 }}>New</span>
                        <input
                          className="field-input"
                          style={{ fontFamily: 'monospace', fontSize: 12, padding: '3px 7px' }}
                          value={edits[c.tool.id] ?? c.suggested}
                          onChange={e => setEdits(prev => ({ ...prev, [c.tool.id]: e.target.value }))}
                          disabled={!isOn}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            {applyError && <div className="error-banner">{applyError}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
              <button className="btn btn-ghost" onClick={onClose} disabled={isSaving}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleApply}
                disabled={isSaving || acceptedCount === 0}
              >
                {isSaving
                  ? <><span className="spinner" style={{ width: 13, height: 13, borderWidth: 2 }} /> Saving…</>
                  : `Apply ${acceptedCount} rename${acceptedCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
