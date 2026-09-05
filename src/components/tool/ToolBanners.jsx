// The tool page's banner stack — every "informed, not blocked" notice, in the
// order they appear above the page body. Lifted verbatim out of ToolDetail; see
// docs/TOOL_PAGE_UNIFICATION_PLAN.md, Phase 2.
//
// They are grouped here because they share one job: each one reports something
// the app found and declined to resolve on its own, and each clears itself once
// the user acts. Nothing here decides anything — the handlers are the page's.
import { Wrench, Copy, AlertTriangle, Trash2 } from 'lucide-react';
import DriftBanner from '../DriftBanner.jsx';
import ConflictBanner from '../ConflictBanner.jsx';
import MaterialLinkBanner from '../MaterialLinkBanner.jsx';
import MergeSiblingBanner from '../MergeSiblingBanner.jsx';

export default function ToolBanners({
  tool, noFusion, fusionAuthority, isSaving, notify,
  onApplyDrift, onSave,
  fusionMissing, onKeepMissing, onRemoveMissing,
}) {
  // `saveTool` under its old name, so the lifted JSX below reads unchanged.
  const saveTool = onSave;
  return (
    <>
      {/* D3 — field-level Fusion drift review. Only for linked tools (a no-Fusion
          tool has no Fusion side to differ from). Keyed by tool.id so the
          per-field choices reset when navigating between tools. */}
      {!noFusion && (
        <DriftBanner
          key={`drift-${tool.id}`}
          tool={tool}
          authority={fusionAuthority}
          isSaving={isSaving}
          onApply={onApplyDrift}
        />
      )}

      {/* "Informed, not blocked" conflict review — shared-value disagreements
          flagged during Fusion import / normalize, resolved here on demand. */}
      <ConflictBanner key={`conflicts-${tool.id}`} tool={tool} />

      {/* Another record already exists for this physical tool (same ProShop
          number) — offer to fold them into one. Handles duplicates created
          before the normalize-time merge existed. */}
      <MergeSiblingBanner key={`merge-${tool.id}`} tool={tool} />

      {/* Assembly numbers corrected on load. In Auto mode asm_number is a pure
          product of holder + tool_id + OOH with no edit UI, so a mismatch is
          always stale (OOH edited in Fusion, a Tool ID renumber, …) — it's
          fixed silently and merely reported here. Saving persists it and
          clears the flag. Only ever set in Auto mode (see backfillAsmNumbers). */}
      {tool._asmNumbersFixed?.length > 0 && (
        <div style={{
          border: '1px solid var(--blue)', borderRadius: 'var(--radius)',
          background: 'color-mix(in srgb, var(--blue) 8%, transparent)',
          padding: 14, marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <Wrench size={16} style={{ color: 'var(--blue)', flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 220, lineHeight: 1.5 }}>
            <strong>
              {tool._asmNumbersFixed.length} assembly number{tool._asmNumbersFixed.length > 1 ? 's were' : ' was'} out
              of date and {tool._asmNumbersFixed.length > 1 ? 'have' : 'has'} been corrected.
            </strong>{' '}
            Assembly numbers are built from the holder, tool ID and OOH, so they update automatically when
            those change. Save to store {tool._asmNumbersFixed.length > 1 ? 'them' : 'it'}.
            <span style={{ display: 'block', marginTop: 6 }}>
              {tool._asmNumbersFixed.map((c, i) => (
                <span key={i} style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                  <span className="text-sub" style={{ textDecoration: 'line-through' }}>{c.from}</span>
                  {' → '}{c.to}
                </span>
              ))}
            </span>
          </span>
          <button
            className="btn btn-primary"
            disabled={isSaving}
            onClick={async () => {
              try {
                await saveTool(tool);
                notify('Assembly numbers updated', 'success');
              } catch { /* saveTool surfaces its own error toast */ }
            }}
          >
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}

      {/* Presets whose material link can't self-heal (CAM preset renamed
          before its id was captured, or a legacy imported string) — offers a
          one-click re-link to a suggested CAM preset. Never auto-fixes. */}
      <MaterialLinkBanner
        key={`matlink-${tool.id}`}
        tool={tool}
        isSaving={isSaving}
        onSave={async (updated) => { await saveTool(updated); }}
      />

      {/* Duplicate presets folded on load (identical presets that were repeated
          per assembly). Already shown merged; this persists the cleanup to the
          Fusion library on save. Non-blocking — clears once saved. */}
      {!noFusion && tool._duplicatePresets > 0 && (
        <div style={{
          border: '1px solid var(--blue)', borderRadius: 'var(--radius)',
          background: 'color-mix(in srgb, var(--blue) 8%, transparent)',
          padding: 14, marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <Copy size={16} style={{ color: 'var(--blue)', flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 220, lineHeight: 1.5 }}>
            <strong>{tool._duplicatePresets} duplicate preset{tool._duplicatePresets > 1 ? 's' : ''} merged.</strong>{' '}
            This tool had identical presets repeated across assemblies — they&apos;re already shown merged here.
            Clean up the Fusion library to make it permanent.
          </span>
          <button
            className="btn btn-primary"
            disabled={isSaving}
            onClick={async () => {
              try {
                await saveTool(tool);
                notify('Duplicate presets cleaned up', 'success');
              } catch { /* saveTool surfaces its own error toast */ }
            }}
          >
            {isSaving ? 'Cleaning up…' : 'Clean up library'}
          </button>
        </div>
      )}

      {/* Reverse sync — the tool was deleted directly in Fusion 360, so it's
          gone from the live library. Offer to remove it from the app too, or
          keep it (informed, not blocked — never auto-deleted). */}
      {fusionMissing && (
        <div style={{
          border: '1px solid var(--red, #ef4444)', borderRadius: 'var(--radius)',
          background: 'color-mix(in srgb, var(--red, #ef4444) 8%, transparent)',
          padding: 14, marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <AlertTriangle size={16} style={{ color: 'var(--red, #ef4444)', flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 220, lineHeight: 1.5 }}>
            <strong>Deleted from Fusion.</strong>{' '}
            This tool no longer exists in the Fusion library — it looks like it was deleted in Fusion 360.
            Remove it from ToolDex too?
          </span>
          <button className="btn btn-secondary" onClick={onKeepMissing}>Keep</button>
          <button className="btn btn-danger" onClick={onRemoveMissing}>
            <Trash2 size={15} /> Remove from ToolDex
          </button>
        </div>
      )}
    </>
  );
}
