import { useState } from 'react';
import { X, AlertTriangle, Copy, Layers, GitMerge } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';

// Surfaced when a tool is opened and the Fusion library contains extra entries
// (dumped straight from Fusion, sharing this tool's tracking ID or ProShop #).
// Each stray is one of three kinds — see src/services/reconcile.js:
//   • duplicate   → identical to a registered assembly → delete the redundant entry
//   • newAssembly → only holder/OOH differs → add as a new assembly, or delete
//   • conflict    → differs beyond holder/OOH → review in the Sync Job diff
export default function ReconcileModal({ tool, results, onClose, onResolved, onReviewConflict }) {
  const { applyReconcile, isSaving } = useApp();
  const { duplicates, newAssemblies, conflicts } = results;

  // Per-entry chosen action.
  const [dupAction, setDupAction] = useState(
    () => Object.fromEntries(duplicates.map(d => [d.guid, 'delete']))
  );
  const [newAction, setNewAction] = useState(
    () => Object.fromEntries(newAssemblies.map(n => [n.guid, 'add']))
  );

  const fmtOoh = (ooh) => (ooh == null ? '—' : `${Number(ooh).toFixed(3)} in`);
  const holderLabel = (item) => item.holderDescription || (item.holderGuid ? 'holder set' : 'no holder');

  const handleApply = async () => {
    const adopt = newAssemblies.filter(n => newAction[n.guid] === 'add').map(n => n.raw);
    const dropRaws = [
      ...duplicates.filter(d => dupAction[d.guid] === 'delete').map(d => d.raw),
      ...newAssemblies.filter(n => newAction[n.guid] === 'delete').map(n => n.raw),
    ];
    if (adopt.length === 0 && dropRaws.length === 0) { onClose(); return; }
    try {
      await applyReconcile(tool, { adopt, dropRaws });
      onResolved();
    } catch { /* notified in context */ }
  };

  const Pill = ({ children }) => (
    <span style={{
      fontFamily: 'var(--font-mono, monospace)', fontSize: 11.5, color: 'var(--text-sub)',
      background: 'var(--surface-2, rgba(255,255,255,0.04))', borderRadius: 5, padding: '1px 6px',
    }}>{children}</span>
  );

  const Row = ({ icon: Icon, color, item, children }) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 12px', borderBottom: '1px solid var(--border)',
    }}>
      <Icon size={15} style={{ color, flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
        <span style={{ marginRight: 8 }}>{holderLabel(item)}</span>
        <Pill>OOH {fmtOoh(item.ooh)}</Pill>
      </span>
      {children}
    </div>
  );

  const Sel = ({ value, onChange, options }) => (
    <select className="field-input" style={{ width: 150, flexShrink: 0 }} value={value} onChange={e => onChange(e.target.value)}>
      {options.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
    </select>
  );

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ width: '100%', maxWidth: 620, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <h3 className="modal-title" style={{ flex: 1, margin: 0 }}>Reconcile with Fusion library</h3>
          <button className="icon-btn" onClick={onClose} disabled={isSaving}><X size={16} /></button>
        </div>

        <div className="banner-warn mb-12">
          <AlertTriangle size={16} />
          <span>
            Extra Fusion entries for <strong>{tool.description || 'this tool'}</strong>
            {tool.tool_id ? <> (<Pill>{tool.tool_id}</Pill>)</> : null} were found in the
            library — likely copied in Fusion and saved directly. Choose what to do with each.
          </span>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {duplicates.length > 0 && (
            <Section title="Exact duplicates" hint="Identical to an existing assembly — safe to delete the redundant copy.">
              {duplicates.map(d => (
                <Row key={d.guid} icon={Copy} color="#f87171" item={d}>
                  <Sel value={dupAction[d.guid]} onChange={v => setDupAction(p => ({ ...p, [d.guid]: v }))}
                    options={[{ v: 'delete', label: 'Delete entry' }, { v: 'keep', label: 'Keep' }]} />
                </Row>
              ))}
            </Section>
          )}

          {newAssemblies.length > 0 && (
            <Section title="New assemblies" hint="Same tool, a holder/OOH setup not yet registered. Add it as an assembly, or delete.">
              {newAssemblies.map(n => (
                <Row key={n.guid} icon={Layers} color="#34d399" item={n}>
                  <Sel value={newAction[n.guid]} onChange={v => setNewAction(p => ({ ...p, [n.guid]: v }))}
                    options={[{ v: 'add', label: 'Add assembly' }, { v: 'delete', label: 'Delete entry' }, { v: 'keep', label: 'Keep' }]} />
                </Row>
              ))}
            </Section>
          )}

          {conflicts.length > 0 && (
            <Section title="Conflicts" hint="Differs beyond holder/OOH (speeds, geometry, or presets). Review before merging.">
              {conflicts.map(c => (
                <Row key={c.guid} icon={GitMerge} color="#fbbf24" item={c}>
                  <button className="btn btn-secondary btn-sm" style={{ flexShrink: 0 }}
                    disabled={isSaving} onClick={() => onReviewConflict(c.raw)}>
                    Review…
                  </button>
                </Row>
              ))}
            </Section>
          )}
        </div>

        <div className="modal-actions" style={{ marginTop: 12 }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={isSaving}>Close</button>
          <button className="btn btn-primary" onClick={handleApply} disabled={isSaving}>
            {isSaving ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, hint, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{title}</div>
      <div className="text-sub text-xs" style={{ marginBottom: 6 }}>{hint}</div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}
