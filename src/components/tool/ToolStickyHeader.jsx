// The tool page's sticky header — ONE component for both modes.
//
// It existed twice, near-identically: the view's carries the full identity line
// (status badge, STI pill, the replacement link, the no-Fusion pill, the Tool ID
// pill), the edit form's a trimmed "Editing · type" version. The identity rail on
// the right — location + T/H/D — was duplicated verbatim in both, which is the
// kind of drift Phase 2 exists to remove. `mode` picks the body; the shell, the
// status wash and the rail are shared. See docs/TOOL_PAGE_UNIFICATION_PLAN.md.
//
// ⚠️ The status WASH is on both modes deliberately — a retired tool must not
// look active just because someone opened the editor.
import { AlertTriangle } from 'lucide-react';
import ToolTypeIcon from '../icons/ToolTypeIcon.jsx';
import StatusBadge from '../StatusBadge.jsx';
import { statusOf, statusMeta } from '../../utils/toolStatus.js';
import { showsProShopUrl, toolIdLabel } from '../../utils/toolIdSystem.js';
import { proShopToolUrl as proshotUrl } from '../../utils/proShopUrl.js';

// Location + machine number. Rendered only when there is something to show, so
// an unlocated tool doesn't carry an empty rail.
function IdentityRail({ tool, hasMachineNum }) {
  if (!tool.location && !hasMachineNum) return null;
  return (
    <div className="tool-sticky-identity">
      {tool.location && (
        <div className="sticky-identity-group">
          <span className="sticky-identity-label">Location</span>
          <span className="location-tag">{tool.location}</span>
        </div>
      )}
      {hasMachineNum && (
        <div className="sticky-identity-group">
          <span className="sticky-identity-label">Machine&nbsp;#</span>
          <span className="machine-num-badge">T{tool.machine_tool_number}</span>
          <span className="machine-num-badge">H{tool.machine_tool_number}</span>
          <span className="machine-num-badge">D{tool.machine_tool_number}</span>
        </div>
      )}
    </div>
  );
}

export default function ToolStickyHeader({
  tool, typeLabel, hasMachineNum, idMode, replacement, mode = 'view',
}) {
  const edit = mode === 'edit';
  return (
    <div className="tool-sticky-header"
      data-status={statusOf(tool)}
      style={{ '--status-wash': statusMeta(statusOf(tool)).color }}>
      <span className="tool-sticky-header-icon">
        <ToolTypeIcon type={tool.tool_type} size={30} />
      </span>
      <div className="tool-sticky-header-body">
        {edit ? (
          <div className="flex items-center gap-10" style={{ minWidth: 0 }}>
            <div className="detail-header-type" style={{ fontSize: 12, flexShrink: 0 }}>Editing · {typeLabel}</div>
            <span
              className="description-badge"
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
            >
              {tool.description || '—'}
            </span>
            {tool.tool_id && <span className="tool-id-pill">{tool.tool_id}</span>}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <div className="detail-header-type" style={{ fontSize: 12, flexShrink: 0 }}>{typeLabel}</div>
              <h1
                className="detail-header-title description-badge"
                style={{
                  fontSize: 'clamp(15px, 2vw, 20px)',
                  padding: '4px 12px 5px',
                  maxWidth: '60ch',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flexShrink: 1,
                  minWidth: 0,
                }}
              >
                {tool.description || '—'}
              </h1>
              {tool.tool_type === 'tap' && tool.is_sti && (
                <span className="sti-pill" title="STI / Helicoil — thread insert tap">STI / Helicoil</span>
              )}
              <StatusBadge tool={tool} />
              {/* The replacement, resolved LIVE from the stored tracking id —
                  never a stored name, so renaming or re-numbering the new tool
                  can't leave a stale label behind. A dangling id is SHOWN as
                  such rather than hidden: silently dropping it would erase the
                  fact that this tool was replaced at all. */}
              {statusOf(tool) === 'retired' && tool.replaced_by && (
                replacement
                  ? (
                    <a className="status-replaced" href={`#/tool/${replacement.id}`}
                      title={`Replaced by ${replacement.description || replacement.tool_id}`}>
                      → {replacement.tool_id || replacement.description}
                    </a>
                  )
                  : <span className="status-replaced is-missing" title="The replacement tool is no longer in the library">→ (replacement removed)</span>
              )}
              {tool.no_fusion_link && (
                <span className="no-fusion-pill">
                  <AlertTriangle size={12} /> No Fusion Link
                </span>
              )}
            </div>
            {tool.tool_id && (
              showsProShopUrl(idMode) ? (
                <a
                  className="tool-id-pill"
                  href={proshotUrl(tool.tool_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open in ProShop"
                  onClick={e => e.stopPropagation()}
                  style={{ fontSize: 15, padding: '4px 16px', alignSelf: 'flex-start' }}
                >{tool.tool_id}</a>
              ) : (
                <span
                  className="tool-id-pill"
                  title={toolIdLabel(idMode)}
                  style={{ fontSize: 15, padding: '4px 16px', alignSelf: 'flex-start' }}
                >{tool.tool_id}</span>
              )
            )}
          </>
        )}
      </div>
      <IdentityRail tool={tool} hasMachineNum={hasMachineNum} />
    </div>
  );
}
