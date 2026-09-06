// The NEW-TOOL form. An existing tool is edited in place on its own page (see
// ToolDetail) — this is the one job that page cannot do, because the record
// does not exist yet: the tool-type picker, the unit choice, and a validation
// gate before anything is written.
//
// ⚠️ The editing BRAIN is shared with the page — useToolEditor. This file is
// layout. Callers: AddToolFlow and MergeFlow/NewToolStep.
import {
  Ruler, Layers, Save, X, AlertTriangle,
  StickyNote, Trash2, ScanLine,
} from 'lucide-react';
import {
  INCH_THREAD_SIZES, METRIC_THREAD_SIZES,
  TAP_LIMIT_TOLERANCE_OPTIONS_INCH, TAP_LIMIT_TOLERANCE_OPTIONS_METRIC,
  TAP_LIMIT_TOLERANCE_DEFAULT_INCH, TAP_LIMIT_TOLERANCE_DEFAULT_METRIC,
} from '../schema/toolSchema.js';
import InfoTip from './InfoTip.jsx';
import ToolLinkPicker from './ToolLinkPicker.jsx';
import { useApp } from '../context/AppContext.jsx';
import ToolTypeDropdown from './ToolTypeDropdown.jsx';
import ToolFields from './ToolFields.jsx';
import ExtractUpdateModal from './ExtractUpdateModal.jsx';
import PurchasingSection from './PurchasingSection.jsx';
import Section from './tool/ToolSection.jsx';
import FieldInput from './tool/FieldInput.jsx';
import SpecSummary, { SpecPurchasingPanel } from './tool/SpecScanPanels.jsx';
import ToolIdentitySection from './tool/ToolIdentitySection.jsx';
import InsertStyleBlock from './tool/InsertStyleBlock.jsx';
import useToolEditor from './tool/useToolEditor.js';

export default function ToolForm({ tool, onSave, onCancel, isSaving, isNew, onDelete }) {
  const { shopSettings, googleAuthenticated } = useApp();
  const idMode = shopSettings?.tool_id_system?.mode || 'proshop';
  const {
    data, setField, setStatus, errors,
    dirty, geoIssues, geoIssueFields,
    machineNum, hasMachineNum, locEditable, hasComponents,
    tagInput, setTagInput,
    pickReplacement, setPickReplacement, replacementTool,
    descSuggestion, descStale, datalistOptions,
    handleSave, handleCancel, scan,
  } = useToolEditor({ tool, isNew, onSave, onCancel, isSaving });

  // Local aliases so the JSX below reads as it did before the extraction.
  const {
    open: scanOpen, setOpen: setScanOpen, receiveProposals, resolveProposal,
    resolvePurchRow, discardProposals, acceptAllPending,
    purchRows, typeNotice, newMfgAck, setNewMfgAck,
    sourceFile, keepSourceFile, setKeepSourceFile,
    homelessProposals, inlineProposalMap,
    pendingCount, acceptedCount, hasProposals,
  } = scan;

  return (
    <div className="tool-form">
      {errors.length > 0 && (
        <div className="error-banner mb-16">
          {errors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}

      {/* Update an existing tool from a manufacturer spec sheet. Not offered
          when creating — the add flow has its own extraction step, and there is
          nothing to compare against yet. */}
      {!isNew && !hasProposals && (
        <div className="spec-scan-bar mb-16">
          <ScanLine size={15} style={{ color: 'var(--blue)', flexShrink: 0 }} />
          <span className="text-sm text-sub" style={{ flex: 1 }}>
            Update this tool from a manufacturer spec sheet or product page.
          </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setScanOpen(true)}>
            <ScanLine size={14} /> Scan spec sheet
          </button>
        </div>
      )}

      {hasProposals && (
        <SpecSummary
          pending={pendingCount}
          accepted={acceptedCount}
          typeNotice={typeNotice}
          sourceFile={sourceFile}
          keepSourceFile={keepSourceFile}
          onKeepSourceFile={setKeepSourceFile}
          canAttach={googleAuthenticated}
          onAcceptAll={acceptAllPending}
          onDiscard={discardProposals}
        />
      )}

      {/* Tool type — a dropdown of grouped icon cards (Milling / Hole Making / …). */}
      <div className="panel open mb-16" style={{ overflow: 'visible' }}>
        <div className="panel-header static">
          <Layers size={15} className="panel-header-icon" />
          <span className="panel-header-title">Tool Type *</span>
        </div>
        <div className="panel-body">
          <ToolTypeDropdown value={data.tool_type} onChange={(t) => setField('tool_type', t)} />
        </div>
      </div>

      {/* Two-column layout mirroring the read-only tool view, so edit feels like
          "view, unlocked": geometry/material on the left, identity/notes on the right. */}
      <div className="detail-layout">
        <div className="detail-layout-left">
          <Section className="mb-16" title="Geometry & Setup" icon={Ruler} forceOpen={inlineProposalMap.size > 0}>
            <ToolFields
              tool={data}
              mode="edit"
              setField={setField}
              geoIssueFields={geoIssueFields}
              proposals={inlineProposalMap}
              onResolveProposal={resolveProposal}
              listOptions={datalistOptions}
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
          </Section>

          <div className="warn-banner" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={13} style={{ flexShrink: 0 }} />
            Speeds &amp; feeds are managed per preset. {isNew ? 'Add presets from the tool page after saving.' : 'Edit them in the Speeds & Feeds section on the tool page.'}
          </div>

          <InsertStyleBlock data={data} setField={setField} />
        </div>

        <div className="detail-layout-right">
          {(purchRows.length > 0 || homelessProposals.length > 0) && (
            <SpecPurchasingPanel
              rows={purchRows}
              homeless={homelessProposals}
              unit={data.unit}
              newMfgAck={newMfgAck}
              onAck={setNewMfgAck}
              onResolveRow={resolvePurchRow}
              onResolveField={resolveProposal}
            />
          )}

          <ToolIdentitySection
            data={data} isNew={isNew} setField={setField} setStatus={setStatus}
            idMode={idMode} hasMachineNum={hasMachineNum} machineNum={machineNum}
            locEditable={locEditable} descSuggestion={descSuggestion} descStale={descStale}
            replacementTool={replacementTool}
            onPickReplacement={() => setPickReplacement(true)}
          />

          {/* Purchasing — edited in place in the draft (controlled mode), so it
              is committed by this form's Save like every other field. Mirrors
              the view page, which hides tool-level purchasing once components
              are linked: on an insert tool the purchasing lives on each
              component, not on the pairing. */}
          {/* ⚠️ Not while a scan's purchasing rows are outstanding. Those rows
              replay against a FROZEN base (see purchasingFor), so a hand-edit
              made alongside them would be silently wiped by the next row
              toggle. For that session SpecPurchasingPanel is the one editor —
              it already shows current → proposed for every purchasing change,
              and Discard scan brings this panel back. */}
          {!hasComponents && purchRows.length === 0 && (
            <PurchasingSection
              tool={data}
              value={data.purchasing}
              onChange={p => setField('purchasing', p)}
            />
          )}

          <Section className="mb-16" title="Notes & Tags" icon={StickyNote}>
            <div className="form-grid">
              {/* No "Last Used Job" free-text field: which programs a tool runs
                  in is DERIVED (ToolDetail's Where Used panel), and a preset's
                  proven-on link is stored per preset. */}
              <FieldInput field="updated_by" label="Updated By" data={data} setField={setField} />
              {/* Preferred Machine — stores the machine's stable id (rename-proof);
                  the name is derived. A legacy free-text value with no matching
                  machine is kept and offered until re-picked. See machines.js. */}
              <div className="field-group">
                <label className="field-label">Preferred Machine</label>
                <select
                  className="field-input"
                  value={data.preferred_machine_id || ''}
                  onChange={e => {
                    const id = e.target.value || null;
                    const m = (shopSettings?.machines || []).find(x => x.id === id);
                    setField('preferred_machine_id', id);
                    setField('preferred_machine', m ? m.model : '');
                  }}
                >
                  <option value="">— none —</option>
                  {(shopSettings?.machines || []).map(m => (
                    <option key={m.id} value={m.id}>{m.model}</option>
                  ))}
                  {/* Legacy free-text value not in the machine list — keep it selectable. */}
                  {!data.preferred_machine_id && data.preferred_machine && (
                    <option value="__legacy__" disabled>{data.preferred_machine} (unlinked)</option>
                  )}
                </select>
              </div>
            </div>

            <div className="field-group mt-12">
              <label className="checkbox-row">
                <input type="checkbox" checked={!!data.no_fusion_link} onChange={e => setField('no_fusion_link', e.target.checked)} />
                <span className="text-sub text-sm">No Fusion Link — needs Fusion setup</span>
                <InfoTip text={'Set automatically when this tool is added from a ProShop row with no Fusion match — its Fusion library entry is a placeholder. Uncheck once its Fusion entry has real geometry, presets, and holder/assembly setup.'} />
              </label>
            </div>

            {/* Tags */}
            <div className="field-group mt-12">
              <label className="field-label">Tags</label>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input
                  className="field-input"
                  style={{ flex: 1 }}
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  placeholder="Add tag and press Enter"
                  onKeyDown={e => {
                    if (e.key === 'Enter' && tagInput.trim()) {
                      const existing = data.tags || [];
                      if (!existing.includes(tagInput.trim())) {
                        setField('tags', [...existing, tagInput.trim()]);
                      }
                      setTagInput('');
                      e.preventDefault();
                    }
                  }}
                />
              </div>
              <div className="tag-list">
                {(data.tags || []).map(tag => (
                  <span key={tag} className="tag removable" onClick={() => setField('tags', (data.tags || []).filter(t => t !== tag))}>
                    {tag} <X size={11} />
                  </span>
                ))}
              </div>
            </div>

            <div className="field-group mt-12">
              <label className="field-label">Notes</label>
              <textarea className="field-input" value={data.notes || ''} onChange={e => setField('notes', e.target.value)} rows={3} />
            </div>
            <div className="field-group mt-12">
              <label className="field-label">Revision Notes</label>
              <input className="field-input" value={data.revision_notes || ''} onChange={e => setField('revision_notes', e.target.value)} placeholder="What changed and why" />
            </div>
          </Section>
        </div>
      </div>

      {/* Sticky save bar */}
      <div className="form-actions-bar">
        {/* Delete lives here — only while editing an existing tool. Kept apart
            from Save/Cancel (pushed left) so it's not fat-fingered. The heavy
            "are you sure" confirmation is handled by the parent (ToolDetail). */}
        {!isNew && onDelete && (
          <button
            className="btn btn-danger"
            onClick={onDelete}
            disabled={isSaving}
            title="Delete this tool permanently"
            style={{ marginRight: 'auto' }}
          >
            <Trash2 size={15} /> Delete
          </button>
        )}
        <span className={`form-dirty ${dirty ? 'show' : ''}`}>{dirty ? 'Unsaved changes' : 'No changes'}</span>
        <span className="form-hint text-xs text-sub">⌘/Ctrl+S to save · Esc to cancel</span>
        <button className="btn btn-secondary" onClick={handleCancel} disabled={isSaving}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSave} disabled={isSaving}>
          {isSaving ? (
            <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Saving…</>
          ) : (
            <><Save size={15} /> {isNew ? 'Add to Library' : 'Save Changes'}</>
          )}
        </button>
      </div>

      <ExtractUpdateModal
        open={scanOpen}
        tool={data}
        onClose={() => setScanOpen(false)}
        onProposals={receiveProposals}
      />

      {/* Reuses the linked-tools picker — the same search the landing page runs,
          so a ProShop #, EDP# or retired ID finds the replacement exactly as it
          would anywhere else. Stores the tool's tracking id, never its name. */}
      {pickReplacement && (
        <ToolLinkPicker
          // ⚠️ Only the tool ITSELF is off-limits. The picker normally also hides
          // anything in `linked_tools` — right for that relationship, wrong for
          // this one: a tool related to this one (you link the old and the new,
          // then retire the old) is exactly the replacement you want to pick.
          tool={{ id: data.id }}
          onPick={(t) => { setField('replaced_by', t.id); setPickReplacement(false); }}
          onClose={() => setPickReplacement(false)}
        />
      )}
    </div>
  );
}
