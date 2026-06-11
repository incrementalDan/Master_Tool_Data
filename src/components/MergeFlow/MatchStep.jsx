import { useState } from 'react';
import { ArrowLeft, Search, X } from 'lucide-react';
import { useApp } from '../../context/AppContext.jsx';
import { TOOL_TYPE_LABELS } from '../../schema/toolSchema.js';
import { unitAbbr } from '../../utils/units.js';
import { findTopMatches, MATCH_THRESHOLD_LIKELY, MATCH_THRESHOLD_POSSIBLE, scoreSimilarity } from '../../services/duplicateDetector.js';
import ToolTypeIcon from '../icons/ToolTypeIcon.jsx';

function ScoreBadge({ score }) {
  const color = score >= MATCH_THRESHOLD_LIKELY
    ? 'var(--green)' : score >= MATCH_THRESHOLD_POSSIBLE
    ? 'var(--amber)' : 'var(--text-sub)';
  const bg = score >= MATCH_THRESHOLD_LIKELY
    ? 'rgba(69,179,107,0.12)' : score >= MATCH_THRESHOLD_POSSIBLE
    ? 'rgba(212,146,42,0.12)' : 'var(--surface-2)';
  return (
    <span className="match-score-badge" style={{ color, background: bg, borderColor: color }}>
      {score}% match
    </span>
  );
}

function CandidateCard({ tool, score, onSelect }) {
  return (
    <div className="merge-candidate-card" onClick={() => onSelect(tool)}>
      <span className="merge-candidate-icon"><ToolTypeIcon type={tool.tool_type} size={20} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="merge-candidate-name truncate">{tool.description || '—'}</div>
        <div className="text-xs text-sub">
          {TOOL_TYPE_LABELS[tool.tool_type] || tool.tool_type}
          {tool.diameter != null ? ` · ⌀${tool.diameter} ${unitAbbr(tool.unit)}` : ''}
          {tool.number_of_flutes ? ` · ${tool.number_of_flutes}FL` : ''}
          {tool.vendor ? ` · ${tool.vendor}` : ''}
        </div>
      </div>
      <ScoreBadge score={score} />
    </div>
  );
}

export default function MatchStep({ importedTool, presetCandidates, onSelect, onBack }) {
  const { tools } = useApp();
  const [query, setQuery] = useState('');

  // Use preset candidates (from auto-match) if provided, else run match now
  const topCandidates = presetCandidates?.length
    ? presetCandidates
    : findTopMatches(importedTool, tools, 5);

  const searchResults = query.trim()
    ? tools.filter(t => {
        const q = query.toLowerCase();
        return (
          (t.description || '').toLowerCase().includes(q) ||
          (t.vendor || '').toLowerCase().includes(q) ||
          (t.proshot_id || '').toLowerCase().includes(q) ||
          (TOOL_TYPE_LABELS[t.tool_type] || '').toLowerCase().includes(q)
        );
      }).slice(0, 10)
    : null;

  return (
    <div>
      <h3 className="import-section-title">Confirm Match</h3>
      <p className="text-sub text-sm mb-20" style={{ lineHeight: 1.7 }}>
        No exact match was found by product ID or GUID. Select the master tool you want to compare against,
        or search for it below.
      </p>

      {/* Incoming tool summary */}
      <div className="merge-imported-summary mb-20">
        <div className="text-xs text-sub mb-6" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
          Incoming Tool
        </div>
        <div className="flex items-center gap-10">
          <span style={{ color: 'var(--blue)' }}><ToolTypeIcon type={importedTool.tool_type} size={22} /></span>
          <div>
            <div style={{ fontWeight: 600 }}>{importedTool.description || '—'}</div>
            <div className="text-xs text-sub">
              {TOOL_TYPE_LABELS[importedTool.tool_type] || importedTool.tool_type}
              {importedTool.diameter != null ? ` · ⌀${importedTool.diameter} ${unitAbbr(importedTool.unit)}` : ''}
              {importedTool.number_of_flutes ? ` · ${importedTool.number_of_flutes}FL` : ''}
            </div>
          </div>
        </div>
      </div>

      {topCandidates.length > 0 && !query && (
        <div className="mb-20">
          <div className="section-header mb-10">Best Matches</div>
          <div className="merge-candidate-list">
            {topCandidates.map(({ tool, score }) => (
              <CandidateCard key={tool.id} tool={tool} score={score} onSelect={onSelect} />
            ))}
          </div>
        </div>
      )}

      {topCandidates.length === 0 && !query && (
        <div className="text-sub text-sm mb-16" style={{ padding: '12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
          No similar tools found automatically. Search below to find the master tool.
        </div>
      )}

      <div className="section-header mb-10">Search All Tools</div>
      <div className="search-bar mb-12" style={{ maxWidth: 460 }}>
        <Search size={14} style={{ color: 'var(--text-sub)' }} />
        <input
          type="text"
          placeholder="Search by description, vendor, part number, ProShop ID…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoFocus={topCandidates.length === 0}
        />
        {query && <button className="search-clear" onClick={() => setQuery('')}><X size={13} /></button>}
      </div>

      {searchResults && (
        <div className="merge-candidate-list">
          {searchResults.length === 0 && (
            <div className="text-sub text-sm" style={{ padding: '12px' }}>No tools match "{query}"</div>
          )}
          {searchResults.map(tool => (
            <CandidateCard
              key={tool.id}
              tool={tool}
              score={scoreSimilarity(importedTool, tool)}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}

      <div className="flex gap-8 mt-20">
        <button className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft size={14} /> Back</button>
      </div>
    </div>
  );
}
