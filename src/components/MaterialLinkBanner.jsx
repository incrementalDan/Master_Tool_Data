import { useState } from 'react';
import { FlaskConical, Check } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import {
  unresolvedMaterialPresets, findMaterialInLibrary, materialCategory, stockMaterialIssues,
} from '../utils/presetNaming.js';

// "Informed, not blocked" banner for presets whose MATERIAL link is broken —
// the stored material string matches nothing in the Materials library and no
// CAM-preset id was ever captured, so it can't self-heal. The common cause is a
// CAM preset renamed before the app started storing its id (see
// syncPresetMaterialName); legacy imported strings land here too.
//
// Never auto-fixes: each preset is re-linked only when the user clicks. Applying
// stamps the CAM preset's stable id (so it's rename-proof from then on) plus the
// derived name into material.query and Fusion's stock-materials.
export default function MaterialLinkBanner({ tool, onSave, isSaving }) {
  const { materials } = useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const broken = unresolvedMaterialPresets(tool.presets || [], materials);
  // SHOP RULE: Fusion's material library is generated from ours, so a preset's
  // stock-material must be one of our CAM presets. Anything else is a leftover
  // reference to the Fusion material library that was replaced — Fusion resolves
  // it to nothing. Never corrected automatically, but it IS offered as a click:
  // the field has no editor of its own, so without one the flag could only be
  // cleared by re-picking a material that already looks correct.
  const stockStale = stockMaterialIssues(tool.presets || [], materials);
  if (broken.length === 0 && stockStale.length === 0) return null;

  const fixable = broken.filter(b => b.suggestion);
  // A stale stock-material can be corrected in one click WHEN the preset already
  // carries a CAM-preset link (`expected`) — that isn't a guess, it's applying
  // the link the preset already has. Without one there's nothing to apply and
  // the user picks a material in the editor instead.
  const stockFixable = stockStale.filter(s => s.expected);

  // Re-link the given presets to their suggested CAM preset, in one save.
  const applyFixes = async (rows) => {
    const byGuid = new Map(rows.map(r => [r.guid, r.suggestion]));
    const presets = (tool.presets || []).map(p => {
      const name = byGuid.get(p.guid);
      if (!name) return p;
      const cam = findMaterialInLibrary(name, materials).preset;
      if (!cam) return p;
      return {
        ...p,
        material_preset_id: cam.id,                       // stable FK — rename-proof from here
        material: { ...(p.material || {}), query: cam.name, category: materialCategory(cam.name) },
        'stock-materials': [cam.name],                     // Fusion's real material link
      };
    });
    setBusy(true);
    try { await onSave({ ...tool, presets }); }
    finally { setBusy(false); }
  };

  // Point Fusion's own material assignment at the CAM preset this preset is
  // already linked to. Only `stock-materials` changes — the app's material was
  // never wrong here, Fusion's copy was.
  const applyStockFixes = async (rows) => {
    const byGuid = new Map(rows.filter(r => r.expected).map(r => [r.guid, r.expected]));
    const presets = (tool.presets || []).map(p => {
      const name = byGuid.get(p.guid);
      return name ? { ...p, 'stock-materials': [name] } : p;
    });
    setBusy(true);
    try { await onSave({ ...tool, presets }); }
    finally { setBusy(false); }
  };

  const working = busy || isSaving;

  return (
    <div style={{
      border: '1px solid var(--orange, #f59e0b)', borderRadius: 'var(--radius)',
      background: 'color-mix(in srgb, var(--orange, #f59e0b) 8%, transparent)',
      padding: 14, marginBottom: 16,
    }}>
      {broken.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <FlaskConical size={16} style={{ color: 'var(--orange, #f59e0b)', flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 220, lineHeight: 1.5 }}>
            <strong>
              {broken.length} preset{broken.length > 1 ? 's are' : ' is'} not linked to a CAM preset.
            </strong>{' '}
            Fusion resolves a material by its CAM preset name, so {broken.length > 1 ? 'these' : 'this'} won&apos;t
            match anything there. Link {broken.length > 1 ? 'them' : 'it'} and
            {broken.length > 1 ? ' they' : ' it'}&apos;ll follow future renames automatically.
          </span>
          <button className="btn btn-secondary" onClick={() => setOpen(o => !o)}>
            {open ? 'Hide' : 'Review'}
          </button>
          {fixable.length > 0 && (
            <button className="btn btn-primary" disabled={working} onClick={() => applyFixes(fixable)}>
              {working ? 'Linking…' : `Fix ${fixable.length} suggested`}
            </button>
          )}
        </div>
      )}

      {/* Fusion's own material assignment still names a material from the library
          that was replaced. The APP's material is already right here — it is
          Fusion's separate assignment that is stale, and it has no field of its
          own in the editor, so this offers the one click that fixes it. Never
          automatic: the button names the material it will apply. */}
      {stockStale.length > 0 && (
        <div style={{ marginTop: broken.length > 0 ? 12 : 0, paddingTop: broken.length > 0 ? 12 : 0, borderTop: broken.length > 0 ? '1px solid var(--border)' : 'none' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <FlaskConical size={16} style={{ color: 'var(--orange, #f59e0b)', flexShrink: 0, marginTop: 2 }} />
            <span style={{ flex: 1, minWidth: 220, lineHeight: 1.5 }}>
              <strong>
                {stockStale.length} preset{stockStale.length > 1 ? 's still tell' : ' still tells'} Fusion to
                cut a material that no longer exists.
              </strong>{' '}
              The material here is right — but Fusion keeps its own assignment, matched by name, and
              {stockStale.length > 1 ? ' these ' : ' this '}
              still names something from the material library that was replaced, so Fusion resolves it to
              nothing. {stockFixable.length > 0
                ? 'Point it at the material this preset is already linked to:'
                : 'Open the preset and pick the material it should cut.'}
            </span>
            {stockFixable.length > 1 && (
              <button className="btn btn-primary" disabled={working} onClick={() => applyStockFixes(stockFixable)}>
                {working ? 'Fixing…' : `Fix all ${stockFixable.length}`}
              </button>
            )}
          </div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {stockStale.map(s => (
              <div key={s.guid} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingLeft: 28 }}>
                <span className="text-sm" style={{ flex: 1, minWidth: 160 }}>{s.name}</span>
                <span className="text-xs text-sub" style={{ fontFamily: 'var(--font-mono)' }}>
                  Fusion: {s.unknown.join(', ')}
                </span>
                {s.expected ? (
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={working}
                    title={`Tell Fusion this preset cuts "${s.expected}"`}
                    onClick={() => applyStockFixes([s])}
                  >
                    <Check size={13} /> Use {s.expected}
                  </button>
                ) : (
                  <span className="text-xs text-sub">Open the preset and pick a material</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {open && broken.length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {broken.map(b => (
            <div
              key={b.guid}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                padding: '6px 0', borderTop: '1px solid var(--border)',
              }}
            >
              <span className="text-sm" style={{ flex: 1, minWidth: 180 }}>{b.name}</span>
              <span className="text-xs text-sub" style={{ fontFamily: 'var(--font-mono)' }}>
                stored: {b.query}
              </span>
              {/* Say WHY it's unlinked — a group/alloy string looks perfectly
                  fine on screen, so "stored: Steel" alone reads like a non-problem. */}
              <span className="text-xs text-sub">
                {b.reason === 'group' ? '(a material group, not a CAM preset)'
                  : b.reason === 'alloy' ? '(an alloy, not a CAM preset)'
                    : '(not in the Materials library)'}
              </span>
              {b.suggestion ? (
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={working}
                  title={`Link this preset to the "${b.suggestion}" CAM preset`}
                  onClick={() => applyFixes([b])}
                >
                  <Check size={13} /> Use {b.suggestion}
                </button>
              ) : (
                <span className="text-xs text-sub">Open the preset and pick a material</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
