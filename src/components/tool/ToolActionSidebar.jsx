// The tool page's frozen left action sidebar. Lifted verbatim out of ToolDetail
// — see docs/TOOL_PAGE_UNIFICATION_PLAN.md, Phase 2.
//
// ⚠️ Every button is a PROP, not a handler of its own. Several of them are
// guarded (guardLeave — leaving with unsaved preset edits prompts first) and
// several open a modal the page owns, so the decisions stay on the page and
// this file is only the layout. Delete is deliberately absent: it lives on the
// page's edit bar, so it can't be hit by accident while merely viewing.
import {
  ArrowLeft, Pencil, Copy, Shapes, GitMerge, Link2, Unlink,
  Download, FileDown, FileUp,
} from 'lucide-react';
import SidebarBtn from './SidebarBtn.jsx';

export default function ToolActionSidebar({
  noFusion, toolIsNoFusion, fusionEnabled, canDrawProfile, copied,
  onBack, onEdit, onDuplicate, onOpenProfile, onSyncJob,
  onPromote, onDetach, onCopyToFusion, onDownload, onExportProShop, onImportProShop,
}) {
  return (
  <aside className="tool-action-sidebar">
    <SidebarBtn icon={ArrowLeft} label="Back" tip="Go back" onClick={onBack} />
    <div className="tool-sidebar-divider" />
    <SidebarBtn icon={Pencil} label="Edit" tip="Edit this tool" onClick={onEdit} />
    <SidebarBtn icon={Copy} label="Duplicate" tip="Duplicate tool" onClick={onDuplicate} />
    {/* The whole tool on one drawing. Additive — the Geometry section is
        untouched. Hidden for the types whose shape this cannot draw. */}
    {canDrawProfile && (
      <SidebarBtn icon={Shapes} label="Profile" tip="See and edit the whole tool as a dimensioned drawing"
        onClick={onOpenProfile} />
    )}
    {/* Sync Job is a Fusion-library workflow — hidden for a no-Fusion tool. */}
    {!noFusion && (
      <SidebarBtn icon={GitMerge} label="Sync Job" tip="Sync proven values from a job file" onClick={onSyncJob} />
    )}
    <div className="tool-sidebar-divider" />
    {/* Promote a no-Fusion tool into the Fusion library, or detach a linked one.
        Only when the Fusion integration is on (both are no-ops when it's off). */}
    {fusionEnabled && (
      toolIsNoFusion ? (
        <SidebarBtn icon={Link2} label="Create in Fusion" tip="Create this tool in the Fusion library (promote from no-Fusion)" onClick={onPromote} />
      ) : (
        <SidebarBtn icon={Unlink} label="Detach" tip="Remove from the Fusion library (keeps all app data)" onClick={onDetach} />
      )
    )}
    {!noFusion && (
      <SidebarBtn
        icon={Copy}
        label={copied ? 'Copied!' : 'Copy to Fusion'}
        tip="Copy Fusion JSON to clipboard (Ctrl+V into Fusion library)"
        className={copied ? 'copied' : ''}
        onClick={onCopyToFusion}
      />
    )}
    <SidebarBtn
      icon={Download}
      label="Download"
      tip="Download Fusion JSON file"
      onClick={onDownload}
    />
    <SidebarBtn
      icon={FileDown}
      label="ProShop"
      tip="Export ProShop CSV"
      style={{ color: 'var(--orange)' }}
      onClick={onExportProShop}
    />
    <SidebarBtn
      icon={FileUp}
      label="Import PS"
      tip="Import ProShop data for this tool from a CSV export"
      style={{ color: 'var(--orange)' }}
      onClick={onImportProShop}
    />
    {/* Delete lives on the page's edit bar, so it can't be hit by accident
        while merely viewing. */}
  </aside>
  );
}
