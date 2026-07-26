import { useState } from 'react';
import { FlaskConical, Check } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import {
  unresolvedMaterialPresets, findMaterialInLibrary, materialCategory,
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
  if (broken.length === 0) return null;

  const fixable = broken.filter(b => b.suggestion);

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

  const working = busy || isSaving;

  return (
    <div style={{
      border: '1px solid var(--orange, #f59e0b)', borderRadius: 'var(--radius)',
      background: 'color-mix(in srgb, var(--orange, #f59e0b) 8%, transparent)',
      padding: 14, marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <FlaskConical size={16} style={{ color: 'var(--orange, #f59e0b)', flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 220, lineHeight: 1.5 }}>
          <strong>{broken.length} preset{broken.length > 1 ? 's have' : ' has'} an out-of-date material.</strong>{' '}
          The stored material isn&apos;t in the Materials library — usually because the CAM preset was
          renamed before the app started tracking it by ID. Re-link {broken.length > 1 ? 'them' : 'it'} and
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

      {open && (
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
