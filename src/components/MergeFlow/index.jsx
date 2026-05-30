import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { GitMerge } from 'lucide-react';
import { useApp } from '../../context/AppContext.jsx';
import ImportStep from './ImportStep.jsx';
import MatchStep from './MatchStep.jsx';
import DiffStep from './DiffStep.jsx';
import CommitStep from './CommitStep.jsx';

const STEP_LABELS = {
  import: 'Import',
  match: 'Match',
  diff: 'Review',
  commit: 'Commit',
};

function StepHeader({ steps, currentStep }) {
  const currentIdx = steps.indexOf(currentStep);
  return (
    <div className="import-steps mb-20">
      {steps.map((s, i) => {
        const done = i < currentIdx;
        const active = s === currentStep;
        return (
          <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span className={`import-step ${active ? 'active' : done ? 'done' : ''}`}>
              <span className="import-step-num">{done ? '✓' : i + 1}</span>
              {STEP_LABELS[s]}
            </span>
            {i < steps.length - 1 && (
              <span style={{ color: 'var(--border)', fontSize: 16, margin: '0 4px' }}>›</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

export default function MergeFlow() {
  const { id: preselectedId } = useParams();
  const navigate = useNavigate();
  const { tools } = useApp();

  const preselectedTool = preselectedId ? tools.find(t => t.id === preselectedId) || null : null;

  const [step, setStep] = useState('import');
  const [importedTool, setImportedTool] = useState(null);
  const [masterTool, setMasterTool] = useState(preselectedTool);
  const [selectedFields, setSelectedFields] = useState(new Set());
  const [directMatch, setDirectMatch] = useState(false);

  const handleImported = (tool) => {
    setImportedTool(tool);
    // GUID match: found the same tool in master — skip match step
    const guidMatch = tools.find(t => t.id === tool.id);
    if (guidMatch) {
      setMasterTool(guidMatch);
      setDirectMatch(true);
      setStep('diff');
    } else if (preselectedTool) {
      // Launched from ToolDetail — master pre-selected
      setMasterTool(preselectedTool);
      setStep('diff');
    } else {
      setDirectMatch(false);
      setStep('match');
    }
  };

  const handleMatchSelected = (tool) => {
    setMasterTool(tool);
    setStep('diff');
  };

  const handleDiffConfirmed = (fields) => {
    setSelectedFields(fields);
    setStep('commit');
  };

  // Which steps to show in header
  const steps = directMatch || preselectedTool
    ? ['import', 'diff', 'commit']
    : ['import', 'match', 'diff', 'commit'];

  return (
    <div style={{ maxWidth: 760 }}>
      {/* Page header */}
      <div className="detail-header mb-16">
        <span className="detail-header-icon"><GitMerge size={22} /></span>
        <div>
          <div className="detail-header-type">Phase 2</div>
          <h1 className="detail-header-title">Sync from Job</h1>
        </div>
      </div>

      <StepHeader steps={steps} currentStep={step} />

      {step === 'import' && (
        <ImportStep onImported={handleImported} onCancel={() => navigate(-1)} />
      )}
      {step === 'match' && importedTool && (
        <MatchStep
          importedTool={importedTool}
          onSelect={handleMatchSelected}
          onBack={() => setStep('import')}
        />
      )}
      {step === 'diff' && importedTool && masterTool && (
        <DiffStep
          importedTool={importedTool}
          masterTool={masterTool}
          onConfirm={handleDiffConfirmed}
          onBack={() => (directMatch || preselectedTool) ? setStep('import') : setStep('match')}
        />
      )}
      {step === 'commit' && importedTool && masterTool && (
        <CommitStep
          importedTool={importedTool}
          masterTool={masterTool}
          selectedFields={selectedFields}
          onDone={() => navigate(`/tool/${masterTool.id}`)}
          onBack={() => setStep('diff')}
        />
      )}
    </div>
  );
}
