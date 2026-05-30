import { useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { GitMerge } from 'lucide-react';
import { useApp } from '../../context/AppContext.jsx';
import { buildQueue, queueProgress } from '../../services/mergeQueue.js';
import { fusionToolToInternal } from '../../schema/toolSchema.js';
import ImportStep from './ImportStep.jsx';
import MatchStep from './MatchStep.jsx';
import DiffStep from './DiffStep.jsx';
import CommitStep from './CommitStep.jsx';
import NewToolStep from './NewToolStep.jsx';
import SummaryStep from './SummaryStep.jsx';
import QueuePanel from './QueuePanel.jsx';

const STEP_LABELS = { import: 'Import', match: 'Match', diff: 'Review', commit: 'Commit' };

function StepHeader({ phase, subStep, queueLen }) {
  if (phase === 'import') {
    const steps = ['import', 'diff', 'commit'];
    return (
      <div className="import-steps mb-20">
        {steps.map((s, i) => (
          <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span className={`import-step ${s === 'import' ? 'active' : ''}`}>
              <span className="import-step-num">{i + 1}</span>
              {STEP_LABELS[s]}
            </span>
            {i < steps.length - 1 && <span style={{ color: 'var(--border)', fontSize: 16, margin: '0 4px' }}>›</span>}
          </span>
        ))}
      </div>
    );
  }
  return null;
}

export default function MergeFlow() {
  const { id: preselectedId } = useParams();
  const navigate = useNavigate();
  const { tools, fetchRawLibrary, notify } = useApp();

  // Phase: 'import' | 'queue' | 'summary'
  const [phase, setPhase] = useState('import');
  const [queue, setQueue] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  // subStep per queue item: 'match' | 'diff' | 'commit' | 'new'
  const [subStep, setSubStep] = useState('diff');
  const [liveMasterTool, setLiveMasterTool] = useState(null);
  const [masterUpdated, setMasterUpdated] = useState(false);
  const [isFetchingLive, setIsFetchingLive] = useState(false);

  // Cache for live APS fetches (60-second TTL)
  const cacheRef = useRef({ data: null, fetchedAt: 0 });

  const getLiveTool = useCallback(async (masterTool) => {
    if (!fetchRawLibrary || !masterTool) return { tool: masterTool, updated: false };
    const now = Date.now();
    try {
      if (!cacheRef.current.data || now - cacheRef.current.fetchedAt > 60000) {
        const rawList = await fetchRawLibrary();
        cacheRef.current = { data: rawList, fetchedAt: now };
      }
      const rawFresh = cacheRef.current.data.find(t => t.guid === masterTool.id);
      if (!rawFresh) return { tool: masterTool, updated: false };
      const masterMod = masterTool._fusionRaw?.last_modified || 0;
      const freshMod = rawFresh.last_modified || 0;
      if (freshMod <= masterMod) return { tool: masterTool, updated: false };
      // Master changed — merge fresh Fusion data with existing metadata
      const fresh = { ...masterTool, ...fusionToolToInternal(rawFresh), _fusionRaw: rawFresh };
      return { tool: fresh, updated: true };
    } catch {
      return { tool: masterTool, updated: false };
    }
  }, [fetchRawLibrary]);

  const openQueueItem = useCallback(async (idx, q) => {
    const entry = q[idx];
    if (!entry) return;
    setActiveIdx(idx);

    if (entry.isNewTool) {
      setSubStep('new');
      return;
    }
    if (entry.status === 'pending') {
      setSubStep('match');
      return;
    }
    // Exact match → fetch live master
    setIsFetchingLive(true);
    setSubStep('diff');
    const { tool, updated } = await getLiveTool(entry.matchedMasterTool);
    setLiveMasterTool(tool);
    setMasterUpdated(updated);
    setIsFetchingLive(false);
  }, [getLiveTool]);

  const updateEntry = (idx, patch, callback) => {
    setQueue(prev => {
      const next = prev.map((e, i) => i === idx ? { ...e, ...patch } : e);
      callback?.(next);
      return next;
    });
  };

  const advance = useCallback((updatedQueue) => {
    const q = updatedQueue;
    const active = q[0]; // start from beginning to find first incomplete
    const nextIdx = q.findIndex(
      (e, i) => i > activeIdx && e.status !== 'committed' && e.status !== 'skipped'
    );
    if (nextIdx >= 0) {
      openQueueItem(nextIdx, q);
    } else {
      // Wrap around: find any incomplete
      const anyPending = q.findIndex(e => e.status !== 'committed' && e.status !== 'skipped');
      if (anyPending >= 0) {
        openQueueItem(anyPending, q);
      } else {
        setPhase('summary');
      }
    }
  }, [activeIdx, openQueueItem]);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleImported = (parsedTools) => {
    let q;
    if (preselectedId) {
      // Pre-selected from ToolDetail → match is already known
      const master = tools.find(t => t.id === preselectedId);
      q = parsedTools.map(tool => ({
        id: `q-pre-${tool.id}`,
        incomingTool: tool,
        status: master ? 'matched' : 'new',
        matchedMasterTool: master || null,
        matchConfidence: master ? 'exact' : 'none',
        matchMethod: master ? 'manual' : 'none',
        fuzzyCandidates: [],
        selectedFields: new Set(),
        revisionNote: '',
        isNewTool: !master,
      }));
    } else {
      q = buildQueue(parsedTools, tools);
    }
    setQueue(q);
    setPhase('queue');
    openQueueItem(0, q);
  };

  const handleMatchConfirmed = async (masterTool) => {
    const updated = queue.map((e, i) => i === activeIdx ? {
      ...e, status: 'matched', matchedMasterTool: masterTool, matchMethod: 'manual', matchConfidence: 'exact',
    } : e);
    setQueue(updated);
    setIsFetchingLive(true);
    setSubStep('diff');
    const { tool, updated: wasUpdated } = await getLiveTool(masterTool);
    setLiveMasterTool(tool);
    setMasterUpdated(wasUpdated);
    setIsFetchingLive(false);
  };

  const handleDiffConfirmed = (selectedFields) => {
    updateEntry(activeIdx, { selectedFields });
    setSubStep('commit');
  };

  const handleCommitted = () => {
    setQueue(prev => {
      const next = prev.map((e, i) => i === activeIdx ? { ...e, status: 'committed' } : e);
      notify(`"${prev[activeIdx].matchedMasterTool?.description}" committed`, 'success', 3000);
      advance(next);
      return next;
    });
  };

  const handleNewToolAdded = () => {
    setQueue(prev => {
      const next = prev.map((e, i) => i === activeIdx ? { ...e, status: 'committed' } : e);
      advance(next);
      return next;
    });
  };

  const handleSkip = () => {
    setQueue(prev => {
      const next = prev.map((e, i) => i === activeIdx ? { ...e, status: 'skipped' } : e);
      advance(next);
      return next;
    });
  };

  const handleQueueItemSelect = async (idx) => {
    if (idx === activeIdx) return;
    const entry = queue[idx];
    if (entry.status === 'committed' || entry.status === 'skipped') {
      // Allow re-viewing completed items
    }
    openQueueItem(idx, queue);
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  const activeEntry = queue[activeIdx];
  const { remaining } = phase === 'queue' ? queueProgress(queue) : { remaining: 0 };
  const isLastItem = remaining <= 1;

  const masterTool = liveMasterTool || activeEntry?.matchedMasterTool;

  return (
    <div>
      {/* Page header */}
      <div className="detail-header mb-16">
        <span className="detail-header-icon"><GitMerge size={22} /></span>
        <div>
          <div className="detail-header-type">Phase 2</div>
          <h1 className="detail-header-title">Sync from Job</h1>
        </div>
      </div>

      {phase === 'import' && (
        <>
          <StepHeader phase="import" />
          <ImportStep onImported={handleImported} onCancel={() => navigate(-1)} />
        </>
      )}

      {phase === 'queue' && activeEntry && (
        <div className="merge-queue-layout">
          <QueuePanel queue={queue} activeIdx={activeIdx} onSelect={handleQueueItemSelect} />

          <div className="merge-queue-main">
            {/* Tool title above the step content */}
            {activeEntry && (
              <div className="merge-active-tool mb-16">
                <span className="text-xs text-sub" style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Reviewing
                </span>
                <div style={{ fontWeight: 600, fontSize: 14, marginTop: 2 }}>
                  {activeEntry.incomingTool.description || '—'}
                </div>
              </div>
            )}

            {subStep === 'match' && (
              <MatchStep
                importedTool={activeEntry.incomingTool}
                presetCandidates={activeEntry.fuzzyCandidates}
                onSelect={handleMatchConfirmed}
                onBack={() => setPhase('import')}
              />
            )}
            {subStep === 'diff' && masterTool && (
              <DiffStep
                importedTool={activeEntry.incomingTool}
                masterTool={masterTool}
                onConfirm={handleDiffConfirmed}
                onBack={() => setPhase('import')}
                onSkip={handleSkip}
                masterUpdated={masterUpdated}
                isFetchingLive={isFetchingLive}
                isLastItem={isLastItem}
                queuePosition={`${activeIdx + 1} of ${queue.length}`}
              />
            )}
            {subStep === 'commit' && masterTool && (
              <CommitStep
                importedTool={activeEntry.incomingTool}
                masterTool={masterTool}
                selectedFields={activeEntry.selectedFields}
                onCommitted={handleCommitted}
                onBack={() => setSubStep('diff')}
                isLastItem={isLastItem}
              />
            )}
            {subStep === 'new' && (
              <NewToolStep
                incomingTool={activeEntry.incomingTool}
                onAdded={handleNewToolAdded}
                onSkip={handleSkip}
              />
            )}
          </div>
        </div>
      )}

      {phase === 'summary' && (
        <SummaryStep
          queue={queue}
          onDone={() => navigate('/')}
        />
      )}
    </div>
  );
}
