import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, SkipForward, Package, Copy, Home, ExternalLink } from 'lucide-react';
import { useApp } from '../../context/AppContext.jsx';
import { copyToolsToClipboard } from '../../utils/fusionExport.js';
import { queueProgress } from '../../services/mergeQueue.js';
import ToolTypeIcon from '../icons/ToolTypeIcon.jsx';

function StatusIcon({ status }) {
  if (status === 'committed') return <CheckCircle2 size={15} style={{ color: 'var(--green)', flexShrink: 0 }} />;
  if (status === 'skipped') return <SkipForward size={15} style={{ color: 'var(--text-sub)', flexShrink: 0 }} />;
  if (status === 'new') return <Package size={15} style={{ color: '#a78bfa', flexShrink: 0 }} />;
  return null;
}

export default function SummaryStep({ queue, onDone }) {
  const { tools, notify } = useApp();
  const navigate = useNavigate();
  const { total, committed, skipped } = queueProgress(queue);
  const [copying, setCopying] = useState(false);

  const handleCopyAll = async () => {
    setCopying(true);
    try {
      // Get the live (updated) master tools for committed entries
      const committedMasterIds = queue
        .filter(e => e.status === 'committed' && e.matchedMasterTool)
        .map(e => e.matchedMasterTool.id);
      const committedTools = tools.filter(t => committedMasterIds.includes(t.id));
      await copyToolsToClipboard(committedTools);
      notify(`Copied ${committedTools.length} tool${committedTools.length !== 1 ? 's' : ''} to clipboard`, 'success');
    } catch (err) {
      notify('Clipboard copy failed: ' + err.message, 'error');
    } finally {
      setCopying(false);
    }
  };

  return (
    <div style={{ maxWidth: 600 }}>
      {/* Hero */}
      <div className="merge-success" style={{ paddingBottom: 24 }}>
        <CheckCircle2 size={44} style={{ color: 'var(--green)', marginBottom: 14 }} />
        <h2 style={{ marginBottom: 6 }}>Review Complete</h2>
        <p className="text-sub text-sm">
          {committed} tool{committed !== 1 ? 's' : ''} committed to master
          {skipped > 0 ? `, ${skipped} skipped` : ''}.
        </p>
      </div>

      {/* Per-tool results */}
      <div className="panel mb-20">
        <div className="panel-header static">
          <span className="panel-header-title">Results — {total} tool{total !== 1 ? 's' : ''}</span>
        </div>
        <div className="panel-body" style={{ padding: 0 }}>
          {queue.map((entry, i) => (
            <div key={entry.id} className={`summary-row ${i < queue.length - 1 ? 'border-bottom' : ''}`}>
              <StatusIcon status={entry.status} />
              <span className="summary-row-icon">
                <ToolTypeIcon type={entry.incomingTool.tool_type} size={15} />
              </span>
              <div className="summary-row-main">
                <span className="summary-row-desc">{entry.incomingTool.description || '—'}</span>
                {entry.matchedMasterTool && entry.status === 'committed' && (() => {
                  const flatCount = [...(entry.selectedFields || [])].length;
                  const presetFieldCount = [...(entry.presetSelections || new Map()).values()]
                    .reduce((s, { selectedFields: f }) => s + f.size, 0);
                  const newPresetCount = (entry.presetsToAdd || []).length;
                  const total = flatCount + presetFieldCount + newPresetCount;
                  return (
                    <span className="text-xs text-sub">
                      {total} change{total !== 1 ? 's' : ''} committed
                      {newPresetCount > 0 ? `, ${newPresetCount} preset${newPresetCount !== 1 ? 's' : ''} added` : ''}
                    </span>
                  );
                })()}
                {entry.isNewTool && entry.status === 'committed' && (
                  <span className="text-xs" style={{ color: '#a78bfa' }}>Added to library</span>
                )}
                {entry.status === 'skipped' && (
                  <span className="text-xs text-sub">Skipped</span>
                )}
              </div>
              {entry.matchedMasterTool && entry.status === 'committed' && (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ padding: '2px 8px', fontSize: 11 }}
                  onClick={() => navigate(`/tool/${entry.matchedMasterTool.id}`)}
                  title="Open tool detail"
                >
                  <ExternalLink size={11} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
        {committed > 0 && (
          <button
            className="btn btn-secondary"
            onClick={handleCopyAll}
            disabled={copying}
            title="Copy all committed tools as Fusion JSON array — paste directly into Fusion 360"
          >
            <Copy size={14} /> {copying ? 'Copying…' : 'Copy Committed Tools to Clipboard'}
          </button>
        )}
        <button className="btn btn-primary" onClick={onDone}>
          <Home size={14} /> Return to Library
        </button>
      </div>
    </div>
  );
}
