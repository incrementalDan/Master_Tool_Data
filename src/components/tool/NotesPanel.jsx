// Notes, tags, revision note, who updated it, and the preferred machine.
//
// Everything here is metadata-only, so the page's Save writes it without a
// Fusion round-trip (see saveToolMetadata / metadataScope.js). ⚠️ The preferred
// machine stores the machine's stable ID and derives the name — a rename in
// Settings then reaches every tool. A legacy free-text value with no matching
// machine is kept and offered until it is re-picked, never silently dropped.
import { StickyNote, X } from 'lucide-react';
import Section from './ToolSection.jsx';
import FieldInput from './FieldInput.jsx';
import InfoTip from '../InfoTip.jsx';
import Field from './DetailField.jsx';
import { useApp } from '../../context/AppContext.jsx';

export default function NotesPanel({ data, setField, editing, tagInput, setTagInput }) {
  const { shopSettings } = useApp();

  if (!editing) {
    const tags = data.tags || [];
    return (
      <Section title="Notes & Tags" icon={StickyNote}>
        {data.notes && (
          <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, marginBottom: 10 }}>{data.notes}</p>
        )}
        {tags.length > 0 && (
          <div className="tag-list mb-12">{tags.map(t => <span key={t} className="tag">{t}</span>)}</div>
        )}
        {data.revision_notes && <Field label="Revision Notes" value={data.revision_notes} />}
        {!data.notes && !tags.length && !data.revision_notes && (
          <span className="detail-field-empty text-sm">No notes yet.</span>
        )}
      </Section>
    );
  }

  return (
    <Section title="Notes & Tags" icon={StickyNote}>
      <div className="form-grid">
        {/* No "Last Used Job" free-text field: which programs a tool runs in is
            DERIVED (the Where Used panel), and a preset's proven-on link is
            stored per preset. */}
        <FieldInput field="updated_by" label="Updated By" data={data} setField={setField} />
        <div className="field-group">
          <label className="field-label">Preferred Machine</label>
          <select
            className="field-input"
            value={data.preferred_machine_id || ''}
            onChange={e => {
              const id = e.target.value || null;
              const m = (shopSettings?.machines || []).find(x => x.id === id);
              setField('preferred_machine_id', id);
              setField('preferred_machine', m ? m.model : '');
            }}
          >
            <option value="">— none —</option>
            {(shopSettings?.machines || []).map(m => (
              <option key={m.id} value={m.id}>{m.model}</option>
            ))}
            {!data.preferred_machine_id && data.preferred_machine && (
              <option value="__legacy__" disabled>{data.preferred_machine} (unlinked)</option>
            )}
          </select>
        </div>
      </div>

      <div className="field-group mt-12">
        <label className="checkbox-row">
          <input type="checkbox" checked={!!data.no_fusion_link} onChange={e => setField('no_fusion_link', e.target.checked)} />
          <span className="text-sub text-sm">No Fusion Link — needs Fusion setup</span>
          <InfoTip text={'Set automatically when this tool is added from a ProShop row with no Fusion match — its Fusion library entry is a placeholder. Uncheck once its Fusion entry has real geometry, presets, and holder/assembly setup.'} />
        </label>
      </div>

      <div className="field-group mt-12">
        <label className="field-label">Tags</label>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input
            className="field-input"
            style={{ flex: 1 }}
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            placeholder="Add tag and press Enter"
            onKeyDown={e => {
              if (e.key === 'Enter' && tagInput.trim()) {
                const existing = data.tags || [];
                if (!existing.includes(tagInput.trim())) setField('tags', [...existing, tagInput.trim()]);
                setTagInput('');
                e.preventDefault();
              }
            }}
          />
        </div>
        <div className="tag-list">
          {(data.tags || []).map(tag => (
            <span key={tag} className="tag removable" onClick={() => setField('tags', (data.tags || []).filter(t => t !== tag))}>
              {tag} <X size={11} />
            </span>
          ))}
        </div>
      </div>

      <div className="field-group mt-12">
        <label className="field-label">Notes</label>
        <textarea className="field-input" value={data.notes || ''} onChange={e => setField('notes', e.target.value)} rows={3} />
      </div>
      <div className="field-group mt-12">
        <label className="field-label">Revision Notes</label>
        <input className="field-input" value={data.revision_notes || ''} onChange={e => setField('revision_notes', e.target.value)} placeholder="What changed and why" />
      </div>
    </Section>
  );
}
