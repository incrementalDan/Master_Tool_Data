import { useState } from 'react';
import { PackagePlus, SkipForward, Tag, Ruler, Gauge } from 'lucide-react';
import { TOOL_TYPE_LABELS, FIELD_LABELS } from '../../schema/toolSchema.js';
import { fieldLabel } from '../../schema/fieldRegistry.js';
import { unitAbbr } from '../../utils/units.js';
import { useApp } from '../../context/AppContext.jsx';
import ToolTypeIcon from '../icons/ToolTypeIcon.jsx';
import ToolForm from '../ToolForm.jsx';

function FieldRow({ label, value }) {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return null;
  return (
    <div className="detail-field">
      <div className="detail-field-label">{label}</div>
      <div className="detail-field-value">{Array.isArray(value) ? value.join(', ') : String(value)}</div>
    </div>
  );
}

export default function NewToolStep({ incomingTool, onAdded, onSkip }) {
  const { addTool, isSaving, notify } = useApp();
  const [adding, setAdding] = useState(false);
  const u = unitAbbr(incomingTool.unit);

  const handleSave = async (tool) => {
    try {
      await addTool(tool);
      notify(`"${tool.description}" added to library`, 'success');
      onAdded();
    } catch { /* toast handled in context */ }
  };

  if (adding) {
    return (
      <div>
        <div className="flex items-center gap-8 mb-16">
          <button className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>← Back</button>
          <h3 style={{ fontSize: 15, fontWeight: 600 }}>Add to Library</h3>
        </div>
        <ToolForm
          tool={incomingTool}
          onSave={handleSave}
          onCancel={() => setAdding(false)}
          isSaving={isSaving}
          isNew
        />
      </div>
    );
  }

  const typeLabel = TOOL_TYPE_LABELS[incomingTool.tool_type] || incomingTool.tool_type;

  return (
    <div>
      <div className="new-tool-banner mb-20">
        <PackagePlus size={20} style={{ flexShrink: 0 }} />
        <div>
          <div style={{ fontWeight: 600 }}>This tool isn't in the master library yet</div>
          <div className="text-xs text-sub mt-4">
            No product-ID, GUID, or geometry match was found. You can add it or skip it.
          </div>
        </div>
      </div>

      {/* Incoming tool preview */}
      <div className="merge-imported-summary mb-20">
        <div className="flex items-center gap-10 mb-12">
          <span style={{ color: 'var(--blue)' }}><ToolTypeIcon type={incomingTool.tool_type} size={26} /></span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{incomingTool.description || '—'}</div>
            <div className="text-xs text-sub">{typeLabel}</div>
          </div>
        </div>
        <div className="detail-fields">
          <FieldRow label={fieldLabel('diameter', incomingTool.unit)} value={incomingTool.diameter != null ? `${incomingTool.diameter} ${u}` : null} />
          <FieldRow label={fieldLabel('flute_length', incomingTool.unit)} value={incomingTool.flute_length != null ? `${incomingTool.flute_length} ${u}` : null} />
          <FieldRow label={fieldLabel('overall_length', incomingTool.unit)} value={incomingTool.overall_length != null ? `${incomingTool.overall_length} ${u}` : null} />
          <FieldRow label={FIELD_LABELS.number_of_flutes} value={incomingTool.number_of_flutes} />
          <FieldRow label={FIELD_LABELS.vendor} value={incomingTool.vendor} />
          <FieldRow label={FIELD_LABELS.proshot_id} value={incomingTool.proshot_id} />
          <FieldRow label={FIELD_LABELS.spindle_speed} value={incomingTool.spindle_speed} />
          <FieldRow label={FIELD_LABELS.cutting_feedrate} value={incomingTool.cutting_feedrate} />
        </div>
      </div>

      <div className="flex gap-8">
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          <PackagePlus size={15} /> Add to Library
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onSkip}>
          <SkipForward size={14} /> Skip
        </button>
      </div>
    </div>
  );
}
