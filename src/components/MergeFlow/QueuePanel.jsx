import ToolTypeIcon from '../icons/ToolTypeIcon.jsx';
import { queueProgress } from '../../services/mergeQueue.js';

const STATUS_BADGE = {
  pending:   { label: '~Match', color: 'var(--amber)', bg: 'rgba(212,146,42,0.12)', tip: 'Needs match confirmation' },
  matched:   { label: null,     color: '#f59e0b',      bg: null,                    tip: 'Needs review — click to open' },
  new:       { label: 'New',    color: '#a78bfa',      bg: 'rgba(167,139,250,0.12)', tip: 'No match found — add to library?' },
  committed: { label: '✓',      color: 'var(--green)', bg: 'rgba(69,179,107,0.12)', tip: 'Committed to master' },
  skipped:   { label: 'Skip',   color: 'var(--text-sub)', bg: 'var(--surface-2)',   tip: 'Skipped' },
};

function StatusBadge({ status }) {
  const cfg = STATUS_BADGE[status] || STATUS_BADGE.matched;
  // 'matched' = awaiting review — show a yellow dot instead of a text label
  if (status === 'matched') {
    return (
      <span
        className="queue-status-dot"
        style={{ background: cfg.color }}
        title={cfg.tip}
      />
    );
  }
  return (
    <span className="queue-status-badge" style={{ color: cfg.color, background: cfg.bg }} title={cfg.tip}>
      {cfg.label}
    </span>
  );
}

export default function QueuePanel({ queue, activeIdx, onSelect }) {
  const { total, done, committed, skipped } = queueProgress(queue);
  return (
    <div className="queue-panel">
      <div className="queue-panel-header">
        <span style={{ fontWeight: 600 }}>Batch Review</span>
        <span className="text-xs text-sub">{done}/{total} done</span>
      </div>
      {done > 0 && (
        <div className="queue-progress-bar">
          <div
            className="queue-progress-fill"
            style={{ width: `${(done / total) * 100}%` }}
          />
        </div>
      )}
      <div className="queue-items">
        {queue.map((entry, i) => (
          <button
            key={entry.id}
            className={`queue-item ${i === activeIdx ? 'active' : ''} ${entry.status === 'committed' || entry.status === 'skipped' ? 'done' : ''}`}
            onClick={() => onSelect(i)}
            title={entry.incomingTool.description}
          >
            <span className="queue-item-icon">
              <ToolTypeIcon type={entry.incomingTool.tool_type} size={15} />
            </span>
            <div className="queue-item-main">
              <span className="queue-item-desc truncate">{entry.incomingTool.description || '—'}</span>
              {entry.incomingTool.diameter != null && (
                <span className="text-xs text-sub">⌀{entry.incomingTool.diameter}"</span>
              )}
            </div>
            <StatusBadge status={entry.status} />
          </button>
        ))}
      </div>
      {committed > 0 && (
        <div className="queue-footer">
          {committed} committed{skipped ? `, ${skipped} skipped` : ''}
        </div>
      )}
    </div>
  );
}
