// Identity on the unified tool page: lifecycle, tool type, unit, description,
// Tool ID and the replacement link.
//
// ⚠️ THE STICKY HEADER IS THE PAGE TITLE, NOT A FIELD DISPLAY. It carries the
// description, Tool ID, location and machine number so they stay visible while
// scrolling — that is a heading, and it is read-only in both modes. This panel
// is where those values are *edited*, plus the ones the header has no room for.
// In view mode it therefore shows only what the header does NOT ("every field
// in exactly one place"): status, the replacement, type and unit.
import { Tag } from 'lucide-react';
import Section from './ToolSection.jsx';
import ToolIdentitySection from './ToolIdentitySection.jsx';
import ToolTypeDropdown from '../ToolTypeDropdown.jsx';
import StatusBadge from '../StatusBadge.jsx';
import { statusOf } from '../../utils/toolStatus.js';
import { unitAbbr } from '../../utils/units.js';
import { TOOL_TYPE_LABELS } from '../../schema/toolSchema.js';

export default function IdentityPanel({
  data, setField, setStatus, editing, idMode,
  hasMachineNum, machineNum, locEditable,
  descSuggestion, descStale, replacementTool, onPickReplacement,
}) {
  if (editing) {
    return (
      <>
        <Section className="mb-16" title="Tool Type" icon={Tag}>
          <ToolTypeDropdown value={data.tool_type} onChange={(t) => setField('tool_type', t)} />
        </Section>
        <ToolIdentitySection
          data={data} isNew={false} setField={setField} setStatus={setStatus}
          idMode={idMode} hasMachineNum={hasMachineNum} machineNum={machineNum}
          locEditable={locEditable} descSuggestion={descSuggestion} descStale={descStale}
          replacementTool={replacementTool} onPickReplacement={onPickReplacement}
        />
      </>
    );
  }

  const status = statusOf(data);
  return (
    <Section title="Identity" icon={Tag}>
      <div className="detail-fields">
        <div className="detail-field">
          <span className="detail-field-label">Status</span>
          <span className="detail-field-value">
            <StatusBadge status={status} showActive />
          </span>
        </div>
        {status === 'retired' && (
          <div className="detail-field">
            <span className="detail-field-label">Replaced by</span>
            <span className="detail-field-value">
              {replacementTool ? (
                <a href={`#/tool/${replacementTool.id}`} className="tool-id-pill">
                  {replacementTool.tool_id || replacementTool.description}
                </a>
              ) : data.replaced_by ? (
                // Shown, never silently dropped — it is the only remaining
                // record that this tool was replaced by something.
                <span className="detail-field-empty">replacement no longer in the library</span>
              ) : <span className="detail-field-empty">Not set</span>}
            </span>
          </div>
        )}
        <div className="detail-field">
          <span className="detail-field-label">Type</span>
          <span className="detail-field-value">{TOOL_TYPE_LABELS[data.tool_type] || data.tool_type || '—'}</span>
        </div>
        <div className="detail-field">
          <span className="detail-field-label">Unit</span>
          <span className="detail-field-value"><span className="machine-num-badge">{unitAbbr(data.unit)}</span></span>
        </div>
      </div>
    </Section>
  );
}
