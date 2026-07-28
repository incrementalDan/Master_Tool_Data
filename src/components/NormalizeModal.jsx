import { useState, useMemo } from 'react';
import { X, AlertTriangle, ChevronDown, GitMerge } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import {
  OP_TYPES, HOLE_MAKING_TYPES, findMaterialInLibrary, presetMaterialColor,
  suggestCamPresetName, camPresetIdFromGrade, bareCodeGroups, MATERIAL_LABELS,
} from '../utils/presetNaming.js';
import { findNoFusionMergeCandidates } from '../schema/toolSchema.js';
import { normProShopId } from '../schema/insertFamilies.js';
import { formatLength } from '../utils/units.js';
import CamPresetPicker from './CamPresetPicker.jsx';

// Human labels for the shared specs shown in the merge-candidate conflict preview.
const PREVIEW_LABELS = {
  tool_type: 'Type', diameter: 'Cut diameter', flute_length: 'Flute length',
  overall_length: 'Overall length', number_of_flutes: 'Flutes',
};

// Review-and-normalize modal. For every preset on a pre-migration (untracked)
// tool it lets the user (a) link the material to a CAM preset from the Materials
// library — via the same searchable picker used in the preset editor — and
// (b) assign an operation type when it couldn't be read from the name. Materials
// are pre-filled with a confident suggestion where one exists (e.g. AL → Al
// Wrought); ambiguous ones (Steel / ST / SS Austenitic 316 …) are left for the
// user to pick. The selections become the `opOverrides` / `matOverrides` maps
// passed to normalizeLibrary.
export default function NormalizeModal({ onClose }) {
  const { tools, materials, normalizeLibrary, isSaving, normalizeCount } = useApp();
  const [overrides, setOverrides] = useState({}); // presetGuid -> op value ('' = leave blank)
  const [matPicks, setMatPicks] = useState({});   // presetGuid -> CAM preset name (undefined = use suggestion)
  const [pickerFor, setPickerFor] = useState(null); // presetGuid whose material picker is open
  // Shop default per bare legacy code ("AL" → "Al Wrought - 6061+"). Bare codes
  // carry no grade, so only the shop knows which CAM preset they mean — one
  // choice here fixes every preset using that code in the whole library.
  const [codeDefaults, setCodeDefaults] = useState({});
  const [codePickerFor, setCodePickerFor] = useState(null); // code whose picker is open

  // New (untracked) Fusion tools that share a ProShop number with an existing
  // no-Fusion tool — the user decides whether to merge each. Default: merge (on).
  const mergeCandidates = useMemo(() => findNoFusionMergeCandidates(tools), [tools]);
  const [mergeChoices, setMergeChoices] = useState({}); // normPid -> false when unchecked (absent = merge)
  const willMerge = (pid) => mergeChoices[normProShopId(pid)] !== false;
  const toggleMerge = (pid) => setMergeChoices(prev => ({ ...prev, [normProShopId(pid)]: prev[normProShopId(pid)] === false }));

  // Every preset on every un-normalized tool.
  const groups = useMemo(() => {
    const out = [];
    for (const t of tools) {
      if (t.tracking_id) continue; // already normalized
      const presets = t.presets || [];
      if (presets.length > 0) out.push({ tool: t, presets });
    }
    return out;
  }, [tools]);

  // Unambiguous suggestion per preset — the alloy GRADE in its string only.
  // Bare codes are deliberately NOT guessed here; they're resolved in bulk by
  // the shop's per-code default below.
  const suggested = useMemo(() => {
    const m = {};
    const nameOf = (id) => (materials?.presets || []).find(x => x.id === id)?.name || '';
    for (const g of groups) {
      for (const p of g.presets) {
        const byGrade = camPresetIdFromGrade(p.material?.query, materials);
        m[p.guid] = byGrade ? nameOf(byGrade)
          : (findMaterialInLibrary(p.material?.query, materials).preset?.name || '');
      }
    }
    return m;
  }, [groups, materials]);

  // Bare codes present across every un-normalized preset, each with its count.
  const codeGroups = useMemo(
    () => bareCodeGroups(groups.flatMap(g => g.presets), materials),
    [groups, materials]);
  // Pre-fill each code with the app's legacy hint (AL → Al Wrought) so the row
  // starts sensible; the shop can change it, and THAT choice is what applies.
  const codeValue = (code) => (codeDefaults[code] !== undefined
    ? codeDefaults[code]
    : (suggestCamPresetName(code, materials) || ''));
  // The bare code a preset falls under, or null.
  const codeOf = useMemo(() => {
    const m = {};
    for (const [code, presets] of codeGroups) for (const p of presets) m[p.guid] = code;
    return m;
  }, [codeGroups]);

  const presetCount = groups.reduce((n, g) => n + g.presets.length, 0);
  // The effective material for a preset: an explicit pick wins, else the suggestion.
  // Explicit per-preset pick wins, then the grade suggestion, then the shop's
  // default for this preset's bare code.
  const matValue = (guid) => (matPicks[guid] !== undefined
    ? matPicks[guid]
    : (suggested[guid] || (codeOf[guid] ? codeValue(codeOf[guid]) : '') || ''));

  const setOp = (guid, value) => setOverrides(prev => ({ ...prev, [guid]: value }));
  const setMat = (guid, value) => setMatPicks(prev => ({ ...prev, [guid]: value }));

  const handleNormalize = async () => {
    // Resolved (non-blank) operation selections.
    const opOverrides = {};
    for (const [guid, value] of Object.entries(overrides)) {
      if (value) opOverrides[guid] = value;
    }
    // Effective material links (suggestion or explicit pick); blank = leave as-is.
    const matOverrides = {};
    for (const g of groups) {
      for (const p of g.presets) {
        const v = matValue(p.guid);
        if (v) matOverrides[p.guid] = v;
      }
    }
    // Explicit merge decisions: normPid -> true for each candidate the user left
    // checked. Only an explicit true merges; unchecked stays separate.
    const mergeDecisions = {};
    for (const c of mergeCandidates) {
      if (willMerge(c.toolId)) mergeDecisions[normProShopId(c.toolId)] = true;
    }
    try {
      await normalizeLibrary(opOverrides, matOverrides, mergeDecisions);
    } finally {
      onClose();
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ width: '100%', maxWidth: 720, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <h3 className="modal-title" style={{ flex: 1, margin: 0 }}>Normalize library</h3>
          <button className="icon-btn" onClick={onClose} disabled={isSaving}><X size={16} /></button>
        </div>

        <div className="banner-warn mb-12">
          <AlertTriangle size={16} />
          <span>
            This assigns tracking IDs, splits each tool into per-assembly instances, and
            renames presets to the standard convention. <strong>Back up your Fusion library
            and metadata file first.</strong>
          </span>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {mergeCandidates.length > 0 && (
            <div style={{
              border: '1px solid var(--blue)', borderRadius: 'var(--radius-sm)',
              padding: '10px 12px', marginBottom: 14,
              background: 'color-mix(in srgb, var(--blue) 8%, transparent)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <GitMerge size={16} style={{ color: 'var(--blue)' }} />
                <strong style={{ fontSize: 13 }}>
                  {mergeCandidates.length} of these already exist without a Fusion link
                </strong>
              </div>
              <div className="text-sub text-xs" style={{ marginBottom: 10 }}>
                A tool with this ProShop number was imported from ProShop but had no Fusion
                entry. Merge keeps that ProShop data (purchasing, location, notes) and adds
                this Fusion tool's geometry &amp; presets — becoming one tool. Anything that
                doesn't match is flagged on the tool page for you to fix.
              </div>
              {mergeCandidates.map(c => {
                const unit = c.fusionTool.unit || c.existingTool.unit;
                const merge = willMerge(c.toolId);
                return (
                  <div key={c.toolId} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: '8px 0', borderTop: '1px solid var(--border)',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>
                        {c.fusionTool.description || 'Untitled tool'}
                        <span className="tool-id-pill" style={{ marginLeft: 8 }}>{c.toolId}</span>
                      </div>
                      <div className="text-sub text-xs" style={{ marginTop: 3 }}>
                        <span className="dia">⌀</span> {formatLength(c.existingTool.diameter, unit)}
                        {c.conflicts.length === 0
                          ? <span style={{ color: 'var(--green, #4ade80)', marginLeft: 8 }}>· specs match</span>
                          : (
                            <span style={{ color: 'var(--orange)', marginLeft: 8 }}>
                              · {c.conflicts.length} difference{c.conflicts.length === 1 ? '' : 's'}: {
                                c.conflicts.map(cf => PREVIEW_LABELS[cf.field] || cf.field).join(', ')
                              }
                            </span>
                          )}
                      </div>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, cursor: 'pointer', fontSize: 12 }}>
                      <input type="checkbox" checked={merge} onChange={() => toggleMerge(c.toolId)} disabled={isSaving} />
                      {merge ? 'Merge' : 'Keep separate'}
                    </label>
                  </div>
                );
              })}
            </div>
          )}
          <div className="text-sub text-sm" style={{ marginBottom: 12 }}>
            This will normalize <strong style={{ color: 'var(--text)' }}>{normalizeCount || 0} tool{(normalizeCount || 0) === 1 ? '' : 's'}</strong>.
            Already-migrated tools won't be touched.
          </div>
          {presetCount === 0 ? (
            <div className="text-sub text-sm" style={{ padding: '4px 0' }}>
              No presets to review. Click <strong style={{ color: 'var(--text)' }}>Normalize now</strong> to proceed.
            </div>
          ) : (
            <>
              {codeGroups.size > 0 && (
                <div style={{
                  border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                  padding: '10px 12px', marginBottom: 14,
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                    Shop default material
                  </div>
                  <div className="text-sub text-xs" style={{ marginBottom: 10 }}>
                    These presets name only a broad material code, with no alloy grade — so only
                    you know which CAM preset the shop means by it. Pick once per code and it
                    applies to every preset using it. Anything with a grade in its name
                    (<code>SS316</code>, <code>6061</code>) is matched automatically and isn't listed here.
                  </div>
                  {[...codeGroups].map(([code, ps]) => {
                    const q = codeValue(code);
                    const found = findMaterialInLibrary(q, materials);
                    const sel = found.preset || found.group;
                    const color = presetMaterialColor(q, materials);
                    return (
                      <div key={code} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '7px 0', borderTop: '1px solid var(--border)',
                      }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                          <strong>{code}</strong>
                          <span className="text-sub text-xs" style={{ marginLeft: 6 }}>
                            {MATERIAL_LABELS[code] || 'Other'} · {ps.length} preset{ps.length === 1 ? '' : 's'}
                          </span>
                        </span>
                        <div
                          className="preset-mat-field"
                          style={{ width: 220, flexShrink: 0 }}
                          role="button"
                          tabIndex={0}
                          onClick={() => setCodePickerFor(code)}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCodePickerFor(code); } }}
                        >
                          {sel ? (
                            <span className="preset-mat-sel">
                              <span className="cam-dot" style={{ background: color || '#888' }} />
                              {found.preset ? found.preset.name : found.group.label}
                            </span>
                          ) : (
                            <span className="text-sub">Choose material…</span>
                          )}
                          <span className="preset-mat-actions">
                            {sel && (
                              <span
                                className="preset-mat-clear"
                                title="Leave these unchanged"
                                onClick={e => { e.stopPropagation(); setCodeDefaults(prev => ({ ...prev, [code]: '' })); }}
                              >
                                <X size={13} />
                              </span>
                            )}
                            <ChevronDown size={14} className="text-sub" />
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="text-sub text-xs" style={{ marginBottom: 10 }}>
                Link each preset's material to a CAM preset (search or browse — just like the
                preset editor) and set its operation type. Confident materials are pre-filled;
                leave anything blank to keep it unchanged.
              </div>
              {groups.map(({ tool, presets }) => {
                const isHoleMaking = HOLE_MAKING_TYPES.has(tool.tool_type);
                return (
                  <div key={tool.id} style={{ marginBottom: 14 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
                      {tool.description || 'Untitled tool'}
                      {tool.tool_id ? <span className="text-sub text-xs" style={{ marginLeft: 6 }}>{tool.tool_id}</span> : null}
                    </div>
                    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                      {presets.map(p => {
                        const q = matValue(p.guid);
                        const found = findMaterialInLibrary(q, materials);
                        const sel = found.preset || found.group;
                        const color = presetMaterialColor(q, materials);
                        return (
                          <div key={p.guid} style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '7px 12px', borderBottom: '1px solid var(--border)',
                          }}>
                            <span style={{ flex: 1, fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {p.name || 'Unnamed'}
                              {p.material?.query ? <span className="text-sub text-xs" style={{ marginLeft: 6 }}>{p.material.query}</span> : null}
                            </span>

                            {/* Material — searchable CAM preset picker (same as preset editor) */}
                            <div
                              className="preset-mat-field"
                              style={{ width: 180, flexShrink: 0 }}
                              role="button"
                              tabIndex={0}
                              onClick={() => setPickerFor(p.guid)}
                              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPickerFor(p.guid); } }}
                            >
                              {sel ? (
                                <span className="preset-mat-sel">
                                  <span className="cam-dot" style={{ background: color || '#888' }} />
                                  {found.preset ? found.preset.name : found.group.label}
                                </span>
                              ) : (
                                <span className="text-sub">Choose material…</span>
                              )}
                              <span className="preset-mat-actions">
                                {sel && (
                                  <span className="preset-mat-clear" title="Clear" onClick={e => { e.stopPropagation(); setMat(p.guid, ''); }}>
                                    <X size={13} />
                                  </span>
                                )}
                                <ChevronDown size={14} className="text-sub" />
                              </span>
                            </div>

                            {/* Operation type — hidden for hole-making tools (no op type) */}
                            {isHoleMaking ? (
                              <span className="text-sub text-xs" style={{ width: 130, flexShrink: 0, textAlign: 'center' }} title="Hole-making tools have no operation type">—</span>
                            ) : (
                              <select
                                className="field-input"
                                style={{ width: 130, flexShrink: 0 }}
                                value={overrides[p.guid] || ''}
                                onChange={e => setOp(p.guid, e.target.value)}
                              >
                                <option value="">Op: leave blank</option>
                                {OP_TYPES.map(o => <option key={o.value} value={o.value}>{o.word}</option>)}
                              </select>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        <div className="modal-actions" style={{ marginTop: 12 }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={isSaving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleNormalize} disabled={isSaving}>
            {isSaving ? 'Normalizing…' : 'Normalize now'}
          </button>
        </div>
      </div>

      {pickerFor && (
        <CamPresetPicker
          materials={materials}
          currentQuery={matValue(pickerFor)}
          onClose={() => setPickerFor(null)}
          onSelect={(cp) => setMat(pickerFor, cp.name)}
        />
      )}

      {codePickerFor && (
        <CamPresetPicker
          materials={materials}
          currentQuery={codeValue(codePickerFor)}
          onClose={() => setCodePickerFor(null)}
          onSelect={(cp) => setCodeDefaults(prev => ({ ...prev, [codePickerFor]: cp.name }))}
        />
      )}
    </div>
  );
}
