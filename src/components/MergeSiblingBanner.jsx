import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { GitMerge } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { sharedSpecConflicts } from '../schema/toolSchema.js';
import { normProShopId } from '../schema/insertFamilies.js';
import { formatLength } from '../utils/units.js';

// Tool-page merge: two SEPARATE records already exist for one physical tool,
// sharing a ProShop number (e.g. a ProShop-only import later uploaded into Fusion
// and normalized under its own tracking ID before the normalize-time merge
// existed). This surfaces the duplicate on the tool page and folds them into one —
// keeping the Fusion-linked tool, absorbing the other's ProShop data, and flagging
// any spec that disagrees. Routing-safe: never offered when BOTH are linked to a
// real Fusion library (a cross-library pair — writes must stay routable).

const LABELS = {
  tool_type: 'Type', diameter: 'Cut diameter', flute_length: 'Flute length',
  overall_length: 'Overall length', number_of_flutes: 'Flutes',
};

export default function MergeSiblingBanner({ tool }) {
  const { tools, mergeTools, isSaving, googleAuthenticated } = useApp();
  const navigate = useNavigate();

  const siblings = useMemo(() => {
    const pid = normProShopId(tool.tool_id);
    if (!pid) return [];
    return (tools || []).filter(t =>
      t.id !== tool.id &&
      normProShopId(t.tool_id) === pid &&
      // Routing-safe: skip a cross-library pair (both linked to a real library).
      !(t.library_id != null && tool.library_id != null));
  }, [tools, tool]);

  // Job links live in metadata; a merge deletes one record — require Drive.
  if (siblings.length === 0 || !googleAuthenticated) return null;

  const handleMerge = async (sib) => {
    try {
      const { survivorId } = await mergeTools(tool.id, sib.id);
      // If THIS tool was the one absorbed, its page is gone — go to the survivor.
      if (survivorId && survivorId !== tool.id) navigate(`/tool/${survivorId}`, { replace: true });
    } catch { /* notified by the action */ }
  };

  return (
    <div style={{
      border: '1px solid var(--blue)', borderRadius: 'var(--radius)',
      background: 'color-mix(in srgb, var(--blue) 8%, transparent)',
      marginBottom: 16, overflow: 'hidden',
    }}>
      <div className="panel-header" style={{ background: 'transparent' }}>
        <GitMerge size={15} style={{ color: 'var(--blue)', flexShrink: 0 }} />
        <span className="panel-header-title" style={{ color: 'var(--text)' }}>
          {siblings.length === 1 ? 'Another tool shares this ProShop number' : `${siblings.length} other tools share this ProShop number`}
          <span className="text-sub" style={{ fontWeight: 400, marginLeft: 6, fontSize: 12 }}>
            — likely the same physical tool. Merge into one, or fix the number if they're different.
          </span>
        </span>
      </div>

      <div className="panel-body" style={{ display: 'grid', gap: 12, paddingTop: 4 }}>
        {siblings.map(sib => {
          const unit = tool.unit || sib.unit;
          const conflicts = sharedSpecConflicts(tool, sib);
          const sibIsNoFusion = sib.no_fusion_link;
          return (
            <div key={sib.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="text-sm" style={{ fontWeight: 600 }}>
                  {sib.description || 'Untitled tool'}
                  <span className="text-sub text-xs" style={{ fontWeight: 400, marginLeft: 8 }}>
                    {sibIsNoFusion ? 'no Fusion link' : 'in Fusion'}
                  </span>
                </div>
                <div className="text-xs text-sub" style={{ marginTop: 3 }}>
                  <span className="dia">⌀</span> {formatLength(sib.diameter, unit)}
                  {conflicts.length === 0
                    ? <span style={{ color: 'var(--green, #4ade80)', marginLeft: 8 }}>· specs match</span>
                    : (
                      <span style={{ color: 'var(--orange)', marginLeft: 8 }}>
                        · differs: {conflicts.map(c => LABELS[c.field] || c.field).join(', ')}
                      </span>
                    )}
                </div>
              </div>
              <button className="btn btn-primary btn-sm" disabled={isSaving} onClick={() => handleMerge(sib)}>
                Merge
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
