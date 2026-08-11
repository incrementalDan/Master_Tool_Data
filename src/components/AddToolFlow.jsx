import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ScanLine, PencilLine, AlertTriangle } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { newTool, extractorToTool } from '../schema/toolSchema.js';
import { BLANK } from '../../tool-extractor.tsx';
import { runExtraction, applyExtractionToBlank } from '../services/extractionService.js';
import ToolForm from './ToolForm.jsx';
import ExtractionInput, {
  emptyExtractionInput, extractionReady, extractionRequest, extractionSourceFile,
} from './ExtractionInput.jsx';

export default function AddToolFlow() {
  const navigate = useNavigate();
  const { addTool, isSaving, shopSettings, googleAuthenticated, uploadToolAttachment } = useApp();
  const [step, setStep] = useState('choose'); // 'choose' | 'extract' | 'form'
  const [prefill, setPrefill] = useState(null);

  // Extraction step state. The scan produces a whole tool here (nothing exists
  // to diff against yet) — the per-field proposal review is the UPDATE path,
  // on an existing tool.
  const [input, setInput] = useState(emptyExtractionInput);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Carried through so the scanned sheet can be attached to the tool once it
  // has been created — same `data_extraction` evidence rule as the update path.
  const [sourceFile, setSourceFile] = useState(null);

  // Destination library for the new tool (multi-library). Default to the
  // configured default, falling back to the first linked library.
  const toolLibraries = shopSettings?.tool_libraries || [];
  const defaultLibId = shopSettings?.default_tool_library_id || toolLibraries[0]?.id || null;
  const [targetLibraryId, setTargetLibraryId] = useState(defaultLibId);

  const runExtract = async () => {
    setBusy(true); setError('');
    try {
      const { fields } = await runExtraction(extractionRequest(input));
      // A new tool wants every field written, so the sparse result is merged
      // onto BLANK (clearing whatever the sheet didn't mention) and converted
      // through the same path the extractor form always used.
      const extractorShape = applyExtractionToBlank({ ...BLANK }, fields);
      setPrefill(extractorToTool(extractorShape));
      setSourceFile(extractionSourceFile(input));
      setStep('form');
    } catch (e) {
      setError(e.message || 'Extraction failed');
    }
    setBusy(false);
  };

  const handleSave = async (toolData) => {
    // Tag the new tool with its destination library so addTool writes it there.
    const saved = await addTool({ ...toolData, library_id: targetLibraryId });
    // ⚠️ Attached AFTER creation, against the tool addTool RETURNED — the record
    // has no id (or Drive folder) before that. A failed attach never fails the
    // add: the tool exists and is correct, and the action has toasted why.
    if (sourceFile && saved && googleAuthenticated) {
      try {
        await uploadToolAttachment(saved, sourceFile.blob, sourceFile.name, 'data_extraction');
      } catch { /* already surfaced by the action */ }
    }
    navigate(`/tool/${saved.id}`);
  };

  if (step === 'extract') {
    return (
      <div className="add-extract-step">
        <div className="flex items-center gap-8 mb-16">
          <button className="btn btn-ghost btn-sm" onClick={() => setStep('choose')}><ArrowLeft size={14} /> Back</button>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Scan Tool Label / Drawing</h2>
        </div>
        <p className="text-sub text-sm mb-12" style={{ maxWidth: 620, lineHeight: 1.5 }}>
          Upload a product page, spec sheet or catalogue PDF. The extracted values open
          straight in the tool form, where you can check and correct everything before saving.
        </p>

        <div style={{ maxWidth: 620 }}>
          <ExtractionInput value={input} onChange={setInput} disabled={busy} />

          {error && (
            <div className="error-banner mt-12" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <AlertTriangle size={13} style={{ flexShrink: 0 }} /> {error}
            </div>
          )}

          <div className="flex items-center gap-8 mt-16">
            <button className="btn btn-primary" onClick={runExtract} disabled={!extractionReady(input) || busy}>
              {busy
                ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Reading…</>
                : <><ScanLine size={15} /> Extract</>}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setPrefill(null); setSourceFile(null); setStep('form'); }} disabled={busy}>
              Skip — fill in by hand
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'form') {
    const initial = prefill
      ? { ...newTool(prefill.tool_type || 'flat end mill'), ...prefill }
      : newTool('flat end mill');

    return (
      <div>
        <div className="flex items-center gap-8 mb-16">
          <button className="btn btn-ghost btn-sm" onClick={() => setStep('choose')}><ArrowLeft size={14} /> Back</button>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Add New Tool</h2>
          <span style={{ flex: 1 }} />
          {toolLibraries.length > 1 && (
            <label className="flex items-center gap-6 text-sm text-sub">
              Library:
              <select
                className="field-input"
                style={{ width: 'auto' }}
                value={targetLibraryId || ''}
                onChange={e => setTargetLibraryId(e.target.value)}
                title="The library this new tool will be written to"
              >
                {toolLibraries.map(lib => <option key={lib.id} value={lib.id}>{lib.fileName}</option>)}
              </select>
            </label>
          )}
        </div>
        {prefill && (
          <div className="spec-scan-bar mb-16">
            <ScanLine size={15} style={{ color: 'var(--blue)', flexShrink: 0 }} />
            <span className="text-sm text-sub" style={{ flex: 1 }}>
              Pre-filled from the scan — check every value before saving.
              {sourceFile && googleAuthenticated && <> The sheet is saved to Files when you add the tool.</>}
            </span>
          </div>
        )}
        <ToolForm
          tool={initial}
          onSave={handleSave}
          onCancel={() => navigate('/')}
          isSaving={isSaving}
          isNew
        />
      </div>
    );
  }

  // Step: choose entry method
  return (
    <div>
      <div className="flex items-center gap-8 mb-20">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}><ArrowLeft size={14} /> Back</button>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Add New Tool</h2>
      </div>

      <div className="flex gap-16" style={{ flexWrap: 'wrap' }}>
        <div className="step-card" onClick={() => setStep('extract')}>
          <div className="step-card-icon"><ScanLine size={34} strokeWidth={1.5} /></div>
          <div className="step-card-title">Scan Tool Label / Drawing</div>
          <div className="step-card-desc">
            Upload a photo, PDF, or paste spec sheet text. AI extracts the tool data, then
            opens it in the tool form to check.
          </div>
        </div>

        <div className="step-card" onClick={() => setStep('form')}>
          <div className="step-card-icon"><PencilLine size={34} strokeWidth={1.5} /></div>
          <div className="step-card-title">Enter Manually</div>
          <div className="step-card-desc">
            Fill in tool details by hand. Choose the tool type first, then fill in the fields.
          </div>
        </div>
      </div>
    </div>
  );
}
