// The Identity panel of the tool edit form: lifecycle status, the replacement
// link, machine number, unit, description (+ Suggest), Tool ID and location.
// Lifted verbatim out of ToolForm — see docs/TOOL_PAGE_UNIFICATION_PLAN.md,
// Phase 2. It becomes a panel on the unified page in Phase 3, which is why it
// is a component rather than 170 lines in the middle of a render.
//
// ⚠️ Everything derived is passed IN (descSuggestion, descStale, machineNum,
// locEditable, replacementTool). This file renders; the form still decides.
import { Tag, Wand2, AlertTriangle } from 'lucide-react';
import Section from './ToolSection.jsx';
import FieldInput from './FieldInput.jsx';
import InfoTip from '../InfoTip.jsx';
import StatusBadge from '../StatusBadge.jsx';
import { statusOf, TOOL_STATUSES, betaSuffixStale, stripBetaSuffix } from '../../utils/toolStatus.js';
import { toolIdLabel } from '../../utils/toolIdSystem.js';
import { buildDesc } from '../../utils/toolNaming.js';
import { toolToExtractor } from '../../schema/toolSchema.js';
import { unitAbbr } from '../../utils/units.js';

export default function ToolIdentitySection({
  data, isNew, setField, setStatus, idMode,
  hasMachineNum, machineNum, locEditable,
  descSuggestion, descStale, replacementTool, onPickReplacement,
}) {
  return (
    <Section className="mb-16" title="Identity" icon={Tag}>
      {/* ── Lifecycle ─────────────────────────────────────────────────
          Active is the default and the normal state; the other two are
          what the badge and the header wash exist to make obvious. */}
      <div className="flex items-center gap-8 mb-12 flex-wrap">
        <span className="text-xs text-sub">Status</span>
        <div className="btn-toggle">
          {TOOL_STATUSES.map(st => (
            <button key={st.id} type="button" title={st.tip}
              className={statusOf(data) === st.id ? 'active' : ''}
              onClick={() => setStatus(st.id)}>{st.label}</button>
          ))}
        </div>
        <StatusBadge status={statusOf(data)} showActive />
        <InfoTip alignRight text={'Active is the normal state. Beta = being trialled in CAM, not bought — a beta tool is deliberately NOT exported to ProShop, and its generated description carries a BETA marker. Retired = out of service; name the tool that replaced it and the tool page links straight to it.'} />
      </div>

      {/* Retired → which tool took over. Stored as the replacement's
          tracking id; the name shown is resolved live from it. */}
      {statusOf(data) === 'retired' && (
        <div className="flex items-center gap-8 mb-12 flex-wrap">
          <span className="text-xs text-sub">Replaced by</span>
          {replacementTool ? (
            <>
              <span className="tool-id-pill">{replacementTool.tool_id || '—'}</span>
              <span className="text-sm truncate" style={{ maxWidth: '32ch' }}>{replacementTool.description}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setField('replaced_by', null)}>Clear</button>
            </>
          ) : data.replaced_by ? (
            // A stored id whose tool is gone. Shown, never silently
            // dropped — it is the only remaining record that this tool
            // was replaced by something.
            <>
              <span className="text-sm text-sub" style={{ fontStyle: 'italic' }}>replacement no longer in the library</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setField('replaced_by', null)}>Clear</button>
            </>
          ) : (
            <span className="text-sm text-sub">Not set</span>
          )}
          <button type="button" className="btn btn-secondary btn-sm" onClick={onPickReplacement}>
            {data.replaced_by ? 'Change…' : 'Pick a tool…'}
          </button>
        </div>
      )}

      {/* ⚠️ OFFERED, NEVER APPLIED. The BETA marker rides along with the
          GENERATED description (a tool's first name is generated here), but
          a stored description is never rewritten on the app's say-so — so
          switching to Active surfaces this and waits. */}
      {betaSuffixStale(data) && (
        <p className="spec-desc-hint" style={{ marginBottom: 12 }}>
          <AlertTriangle size={11} /> The description still ends with “BETA”, but this tool is no longer a beta tool.
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }}
            onClick={() => setField('description', stripBetaSuffix(data.description))}>Remove it</button>
        </p>
      )}

      {/* Machine tool number — read-only, managed by the app */}
      {hasMachineNum && (
        <div className="flex items-center gap-8 mb-12 flex-wrap">
          <span className="text-xs text-sub">{isNew ? 'Will be assigned:' : 'Machine #'}</span>
          <span className="machine-num-badge">T{machineNum}</span>
          <span className="machine-num-badge">H{machineNum}</span>
          <span className="machine-num-badge">D{machineNum}</span>
          {!isNew && <span className="text-xs text-sub">— read-only</span>}
        </div>
      )}
      {/* Unit — selectable when creating; pulled from Fusion (read-only) when editing. */}
      <div className="flex items-center gap-8 mb-12 flex-wrap">
        <span className="text-xs text-sub">Unit</span>
        {isNew ? (
          <div className="btn-toggle">
            {[['inches', 'Inches (in)'], ['millimeters', 'Millimeters (mm)']].map(([val, label]) => (
              <button key={val} type="button" className={data.unit === val ? 'active' : ''} onClick={() => setField('unit', val)}>
                {label}
              </button>
            ))}
          </div>
        ) : (
          <>
            <span className="machine-num-badge">{unitAbbr(data.unit)}</span>
            <span className="text-xs text-sub">— from Fusion (read-only)</span>
          </>
        )}
      </div>
      <div className="field-group mb-12">
        <label className="field-label">Description <span className="required">*</span></label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            className="field-input"
            style={{ flex: 1 }}
            value={data.description || ''}
            onChange={e => setField('description', e.target.value)}
            placeholder="e.g. 0.500 4FL EM 1.000LOC"
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            title={!isNew && !descSuggestion
              ? 'The description already matches what the geometry generates'
              : 'Suggest description from geometry'}
            disabled={!isNew && !descSuggestion}
            onClick={() => {
              const suggested = buildDesc(toolToExtractor(data));
              if (suggested) setField('description', suggested);
            }}
            style={{ flexShrink: 0 }}
          >
            <Wand2 size={14} /> Suggest
          </button>
        </div>
        {/* The suggestion itself, readable before it is taken. Clicking
            either it or the button applies it — one action, two targets,
            because the value is the thing the eye lands on. */}
        {descSuggestion && (
          <div className="desc-suggest">
            <span className="desc-suggest-label"><Wand2 size={11} /> Suggested</span>
            <button type="button" className="desc-suggest-value" onClick={() => setField('description', descSuggestion)}
              title="Use this description">
              {descSuggestion}
            </button>
          </div>
        )}
        {descStale && (
          <p className="spec-desc-hint">
            <AlertTriangle size={11} /> The description no longer matches the geometry — “Suggest” rebuilds it.
          </p>
        )}
      </div>
      <div className="form-grid">
        <FieldInput field="tool_id" label={toolIdLabel(idMode)} data={data} setField={setField} placeholder="e.g. A-3" />
        {/* Location is owned by the Location System, not this form — a
            blank editable box here read as "you need to type something"
            and there is nothing useful to type. So the only case that
            still gets an input is a shop with no location system at all
            (free text is then the only route) or a legacy free-text
            value that would otherwise become uneditable. Everything else
            is told where the location actually gets set. */}
        <div className="field-group">
          <label className="field-label">
            Location
            <InfoTip text={locEditable
              ? 'Free-text location (Fusion’s "Vendor" field). Once a Location System is configured, locations are assigned with Assign Location on the tool page instead, and a structured location overrides this text on save.'
              : 'Locations are assigned with Assign Location on the tool page — that’s where you pick the system and get an auto-suggested bin number. It is not edited here.'} />
          </label>
          {locEditable ? (
            <input
              className="field-input"
              value={data.location || ''}
              placeholder="LC-140"
              onChange={e => setField('location', e.target.value)}
            />
          ) : (
            <div className="flex items-center gap-8 flex-wrap" style={{ minHeight: 34 }}>
              {data.location
                ? <span className="location-tag">{data.location}</span>
                : <span className="text-sm text-sub">Not set</span>}
              <span className="text-xs text-sub">
                — {isNew
                  ? 'assign it with Assign Location on the tool page after saving'
                  : 'use Assign Location on the tool page'}
              </span>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}
