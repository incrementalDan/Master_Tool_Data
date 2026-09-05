// ─── Tool Profile, as a pop-up ──────────────────────────────────────────────
//
// The drawing itself lives in ToolProfileFields — the tool page renders that
// same component inline in its Geometry section. This is only the modal
// wrapper: it owns the draft, decides when the tool is written, and keeps the
// Cancel/Save chrome. Nothing about the drawing is duplicated here, so the
// page and the pop-up can never drift apart.
import { useState, useMemo, useRef } from 'react';
import { X, Ruler } from 'lucide-react';
import { profileDimensions } from '../utils/toolProfile.js';
import { resolveReachFields } from '../utils/toolReach.js';
import ToolTypeIcon from './icons/ToolTypeIcon.jsx';
import ToolProfileFields from './ToolProfileFields.jsx';

export default function ToolProfileModal({ tool, onSave, onClose }) {
  // ⚠️ Seed through the resolver, not from the tool as handed in. Reach and
  // undercut are derived from the segments; a tool that has not been through
  // the load-time pass would otherwise open with them blank — and, once the
  // segments are editable here, the modal has to agree with what it is drawing.
  const [draft, setDraft] = useState(() => ({ ...tool, ...resolveReachFields(tool) }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const baseRef = useRef(tool);

  const dims = useMemo(() => profileDimensions(draft.tool_type), [draft.tool_type]);
  const dirty = useMemo(
    () => [...dims.lengths, ...dims.diameters, ...dims.extras]
      .some(f => (draft[f] ?? null) !== (baseRef.current[f] ?? null)) ||
      (draft.has_undercut ?? null) !== (baseRef.current.has_undercut ?? null) ||
      (draft.undercut_override ?? null) !== (baseRef.current.undercut_override ?? null) ||
      // ⚠️ "no profile" has two spellings — `null` (never had one) and `[]`
      // (added a segment then removed it). Comparing them raw marked the tool
      // dirty for a round trip that changed nothing, and saving then wrote an
      // empty array over a null for no reason.
      JSON.stringify(draft.shaft_segments?.length ? draft.shaft_segments : null)
        !== JSON.stringify(baseRef.current.shaft_segments?.length ? baseRef.current.shaft_segments : null),
    [draft, dims],
  );

  const handleSave = async () => {
    setError('');
    setSaving(true);
    try {
      await onSave(draft);
      onClose();
    } catch (err) {
      // ⚠️ Stay open and keep the draft — a failed save must never look like a
      // successful one, and must never silently discard the user's edit.
      setError(err?.message || 'Could not save — your changes are still here.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div className="modal tool-profile-modal">
        <div className="tp-head">
          <ToolTypeIcon type={draft.tool_type} size={22} />
          <div className="tp-head-text">
            <div className="tp-title">Tool Profile</div>
            <div className="tp-sub">{draft.description || '—'}</div>
          </div>
          <button className="tp-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <ToolProfileFields draft={draft} setDraft={setDraft} />

        {error && <div className="tp-error">{error}</div>}
        <div className="modal-actions tp-actions">
          <span className="tp-hint"><Ruler size={12} /> Values are editable — the drawing follows as you type.</span>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
