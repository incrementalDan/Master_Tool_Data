// The tool page's Geometry section — the drawing IS the editor.
//
// ⚠️ EVERY FIELD APPEARS EXACTLY ONCE. The drawing carries the dimensions
// (profileDimensions: lengths, diameters, and the Cutter extras beside it), so
// those are subtracted from the grid below it via ToolFields' `hideFields`.
// Nothing is shown in two places, and there is no separate Geometry read-out.
//
// ⚠️ IT IS THE SAME COMPONENT THE POP-UP RENDERS (ToolProfileFields), not a
// second drawing. That is the whole reason the drawing was pulled out of the
// modal: two drawings of one tool would drift, and the print conventions in it
// — the interrupted dimension line, the arrowed leaders, the lane stack — are
// not the sort of thing that survives being reimplemented.
//
// ⚠️ BUFFERED, with its own Save. Geometry is Fusion-native, so it is not an
// autosave section (see docs/TOOL_PAGE_UNIFICATION_PLAN.md §1): edits collect
// in a local draft and reach Fusion only when the user says so.
import { useState, useMemo, useEffect } from 'react';
import { Ruler, AlertTriangle } from 'lucide-react';
import Section from './ToolSection.jsx';
import ToolFields from '../ToolFields.jsx';
import ToolProfileFields from '../ToolProfileFields.jsx';
import { canDrawProfile, profileDimensions } from '../../utils/toolProfile.js';
import { resolveReachFields } from '../../utils/toolReach.js';
import { validateGeometry } from '../../schema/toolSchema.js';
import { coatingOptions } from '../../schema/toolFieldLayout.js';

export default function GeometrySection({ tool, tools, onSave, isSaving, title = 'Geometry' }) {
  // ⚠️ Seeded through the resolver, exactly as the modal seeds it: reach and
  // undercut are derived from the segments, so a tool that has not been through
  // the load-time pass would otherwise open with them blank.
  const [draft, setDraft] = useState(() => ({ ...tool, ...resolveReachFields(tool) }));
  const [saving, setSaving] = useState(false);
  // Re-seed when the record changes underneath (a save landing, or navigating
  // between tools) — but never mid-edit, which would discard what was typed.
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify({ ...tool, ...resolveReachFields(tool) }), [draft, tool]);
  useEffect(() => { setDraft({ ...tool, ...resolveReachFields(tool) }); }, [tool]);

  const drawable = canDrawProfile(tool.tool_type);
  const owned = useMemo(() => {
    if (!drawable) return null;
    const d = profileDimensions(tool.tool_type);
    return new Set([...d.lengths, ...d.diameters, ...d.extras, 'shaft_segments', 'has_undercut']);
  }, [drawable, tool.tool_type]);

  const geoIssues = useMemo(() => validateGeometry(draft), [draft]);
  const datalists = useMemo(() => ({ coating: coatingOptions(tools) }), [tools]);
  const setField = (field, value) => setDraft(d => ({ ...d, [field]: value }));

  const commit = async () => {
    setSaving(true);
    try { await onSave(draft); }
    catch { /* the context toasts; keep the draft on screen */ }
    finally { setSaving(false); }
  };

  return (
    <Section title={title} icon={Ruler}>
      {/* ⚠️ Only for the two types the drawing cannot handle (boring head,
          turning general) — they fall back to the plain grid with nothing
          hidden, so no field disappears for them. */}
      {drawable && <ToolProfileFields draft={draft} setDraft={setDraft} />}

      <ToolFields
        tool={draft}
        mode="edit"
        setField={setField}
        geoIssueFields={new Set(geoIssues.flatMap(i => i.fields || []))}
        listOptions={datalists}
        hideFields={owned}
      />

      {geoIssues.length > 0 && (
        <div className="warn-banner" style={{ marginTop: 12 }}>
          {geoIssues.map((issue, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={12} style={{ flexShrink: 0 }} />
              {issue.message}
            </div>
          ))}
        </div>
      )}

      {/* ⚠️ Geometry reaches Fusion, so it waits for an explicit save — and the
          button says where it is going. Nothing here autosaves. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, marginTop: 14,
        paddingTop: 12, borderTop: '1px solid var(--border)',
      }}>
        <span className="text-sub text-xs" style={{ marginRight: 'auto' }}>
          {dirty ? 'Unsaved changes' : 'No changes'}
        </span>
        {dirty && (
          <button type="button" className="btn btn-secondary btn-sm" disabled={saving}
            onClick={() => setDraft({ ...tool, ...resolveReachFields(tool) })}>Cancel</button>
        )}
        <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || saving || isSaving}
          onClick={commit}>{saving ? 'Saving…' : 'Save to Fusion'}</button>
      </div>
    </Section>
  );
}
