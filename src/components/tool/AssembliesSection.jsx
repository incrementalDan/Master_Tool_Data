// The tool's assemblies (holder + OOH), grouped by holder. Lifted verbatim out
// of ToolDetail so the page can be assembled from parts rather than read as one
// 1300-line file — see docs/TOOL_PAGE_UNIFICATION_PLAN.md, Phase 2.
//
// ⚠️ `onSave` must PROPAGATE its failure (ToolDetail's sectionSave does): the
// handlers below keep the optimistic card on screen only while the save is in
// flight, and a swallowed error would leave a pending row that never resolves.
import { useState, useMemo, useEffect, useRef } from 'react';
import { Wrench } from 'lucide-react';
import AssemblyCard from '../AssemblyCard.jsx';
import AssemblyForm from '../AssemblyForm.jsx';
import { HolderTag } from '../HolderPill.jsx';
import { unitAbbr } from '../../utils/units.js';
import Section from './ToolSection.jsx';

export default function AssembliesSection({ tool, holders, onSave }) {
  const [showForm, setShowForm] = useState(false);
  const [editingAssembly, setEditingAssembly] = useState(null);
  const [pendingAssembly, setPendingAssembly] = useState(null);
  const assemblies = tool.assemblies || [];

  // Group by holder description, sort each group short → long OOH
  const groups = useMemo(() => {
    const map = new Map();
    for (const a of assemblies) {
      const key = a.holder_description || '—';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(a);
    }
    for (const [, g] of map) g.sort((a, b) => (a.ooh ?? 0) - (b.ooh ?? 0));
    return [...map.entries()];
  }, [assemblies]);

  const handleEdit = (assembly) => { setEditingAssembly(assembly); setShowForm(true); };
  const handleDelete = async (assemblyId) => {
    // sectionSave propagates now — the context has already toasted the reason.
    try { await onSave({ ...tool, assemblies: assemblies.filter(a => a.assembly_id !== assemblyId) }); }
    catch { /* toast handled in context */ }
  };

  // Clear pendingAssembly once the real data lands in the tool prop
  const prevAssemblyIds = useRef(new Set(assemblies.map(a => a.assembly_id)));
  useEffect(() => {
    if (!pendingAssembly) return;
    const ids = new Set(assemblies.map(a => a.assembly_id));
    if (ids.has(pendingAssembly.assembly_id)) setPendingAssembly(null);
    prevAssemblyIds.current = ids;
  }, [assemblies, pendingAssembly]);

  return (
    <Section title="Assemblies" icon={Wrench}>
      {assemblies.length === 0 && !pendingAssembly && (
        <div className="detail-field-empty text-sm" style={{ marginBottom: 10 }}>
          No assemblies recorded yet.
        </div>
      )}
      {groups.map(([holderDesc, group]) => {
        // The group key is the description; every assembly in it shares the
        // holder, so the first one carries the link to resolve the record.
        const first = group[0] || {};
        return (
          <div key={holderDesc} style={{ marginBottom: 10 }}>
            <div style={{ marginBottom: 4 }}>
              <HolderTag
                holderId={first.holder_id} holderGuid={first.holder_guid}
                description={holderDesc}
              />
            </div>
            <div className="assemblies-grid">
              {group.map(a => (
                <AssemblyCard
                  key={a.assembly_id}
                  assembly={a}
                  tool={tool}
                  holders={holders}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Optimistic placeholder card while save is in flight */}
      {pendingAssembly && (() => {
        return (
          <div style={{ marginBottom: 10 }}>
            <div style={{ marginBottom: 4 }}>
              <HolderTag
                holderId={pendingAssembly.holder_id} holderGuid={pendingAssembly.holder_guid}
                description={pendingAssembly.holder_description}
              />
            </div>
            <div className="assemblies-grid">
              <div style={{
                border: '1px solid rgba(100, 116, 139, 0.30)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--surface-2)',
                padding: '6px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                opacity: 0.7,
              }}>
                <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                    OOH: {pendingAssembly.ooh?.toFixed(3)} {unitAbbr(tool.unit)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-sub)', marginTop: 2 }}>Saving…</div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <button
        className="btn btn-secondary btn-sm"
        style={{ marginTop: (assemblies.length > 0 || pendingAssembly) ? 4 : 0 }}
        onClick={() => { setEditingAssembly(null); setShowForm(true); }}
      >
        + Add Assembly
      </button>
      {showForm && (
        <AssemblyForm
          tool={tool}
          holders={holders}
          assembly={editingAssembly}
          onSave={async (updatedTool) => {
            const isNew = !editingAssembly;
            setShowForm(false);
            setEditingAssembly(null);
            if (isNew) {
              // Show the last assembly in the updated list as pending immediately
              const added = updatedTool.assemblies?.at(-1) ?? null;
              setPendingAssembly(added);
            }
            try { await onSave(updatedTool); }
            catch { setPendingAssembly(null); /* toast handled in context */ }
          }}
          onClose={() => { setShowForm(false); setEditingAssembly(null); }}
        />
      )}
    </Section>
  );
}
