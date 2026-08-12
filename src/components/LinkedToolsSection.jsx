import { useState } from 'react';
import { Link2, X, Plus, ExternalLink } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { linkedTools } from '../utils/toolLinks.js';
import { TOOL_TYPE_LABELS } from '../schema/toolSchema.js';
import ToolTypeIcon from './icons/ToolTypeIcon.jsx';
import ToolLinkPicker from './ToolLinkPicker.jsx';

// "Linked Tools" — the tools that go WITH this one: a tap and the drill that
// precedes it, a reamer and its drill. Symmetric and role-free: linking A to B
// links B to A, and neither end is the "parent". Both sides are written in one
// metadata save (see setToolLink), so the pair can never end up half-linked.
//
// Each partner renders as a badge card carrying the three things you need to go
// find it — ID, description, location — and opens in a NEW TAB, because the
// point of following a link here is to compare two tools side by side, not to
// navigate away from the one you were reading.
export default function LinkedToolsSection({ tool }) {
  const { tools, setToolLink, googleAuthenticated, demoMode, notify } = useApp();
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const partners = linkedTools(tool, tools);
  const canEdit = googleAuthenticated || demoMode;

  const change = async (otherId, linked) => {
    setBusy(true);
    try {
      await setToolLink(tool.id, otherId, linked);
    } catch { /* toast handled in context */ }
    finally { setBusy(false); }
  };

  const handlePick = async (other) => {
    setPicking(false);
    await change(other.id, true);
    notify(`Linked to ${other.tool_id || other.description || 'tool'}`, 'success');
  };

  return (
    <div className={`panel ${open ? 'open' : ''}`}>
      <button className="panel-header" onClick={() => setOpen(o => !o)}>
        <Link2 size={15} className="panel-header-icon" />
        <span className="panel-header-title">
          Linked Tools
          <span className="text-sub" style={{ fontWeight: 400, marginLeft: 6 }}>({partners.length})</span>
        </span>
        <span className="panel-chevron">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="panel-body">
          {partners.length === 0 && (
            <div className="detail-field-empty text-sm">
              Nothing linked yet — link a tap to its drill, or a reamer to the drill before it.
            </div>
          )}

          <div className="linked-tool-list">
            {partners.map(p => (
              <div key={p.id} className="linked-tool-card">
                {/* A new tab, deliberately: you follow this link to COMPARE, not
                    to leave. A plain <a> also gives middle-click and "open in
                    new window" for free, which a navigate() handler would not. */}
                <a
                  className="linked-tool-open"
                  href={`#/tool/${p.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Open ${p.description || p.tool_id || 'tool'} in a new tab`}
                >
                  <ToolTypeIcon type={p.tool_type} size={20} />
                  <span className="linked-tool-main">
                    <span className="linked-tool-top">
                      {p.tool_id && <span className="tool-id-pill font-mono">{p.tool_id}</span>}
                      <span className="linked-tool-desc">{p.description || '—'}</span>
                    </span>
                    <span className="linked-tool-meta text-sub">
                      {TOOL_TYPE_LABELS[p.tool_type] || p.tool_type}
                      {p.location && <span className="location-tag">{p.location}</span>}
                    </span>
                  </span>
                  <ExternalLink size={12} className="linked-tool-ext" />
                </a>
                {canEdit && (
                  <button
                    type="button"
                    className="icon-btn linked-tool-unlink"
                    title="Unlink"
                    disabled={busy}
                    onClick={() => change(p.id, false)}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {canEdit ? (
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} disabled={busy} onClick={() => setPicking(true)}>
              <Plus size={13} /> Link a tool
            </button>
          ) : (
            <div className="text-xs text-sub" style={{ marginTop: 8 }}>
              Connect Google Drive to link tools — links are stored in metadata.
            </div>
          )}
        </div>
      )}

      {picking && <ToolLinkPicker tool={tool} onPick={handlePick} onClose={() => setPicking(false)} />}
    </div>
  );
}
