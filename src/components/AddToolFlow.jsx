import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ScanLine, PencilLine } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { newTool } from '../schema/toolSchema.js';
import ToolForm from './ToolForm.jsx';
import ToolExtractorTab from './ToolExtractorTab.jsx';

export default function AddToolFlow() {
  const navigate = useNavigate();
  const { addTool, isSaving } = useApp();
  const [step, setStep] = useState('choose'); // 'choose' | 'extract' | 'form'
  const [prefill, setPrefill] = useState(null);

  const handleExtracted = (toolData) => {
    setPrefill(toolData);
    setStep('form');
  };

  const handleSave = async (toolData) => {
    const saved = await addTool(toolData);
    navigate(`/tool/${saved.id}`);
  };

  if (step === 'extract') {
    return (
      <div>
        <div className="flex items-center gap-8 mb-16">
          <button className="btn btn-ghost btn-sm" onClick={() => setStep('choose')}><ArrowLeft size={14} /> Back</button>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Scan Tool Label / Drawing</h2>
        </div>
        <p className="text-sub text-sm mb-12">
          Upload a photo, PDF, or paste text from a tool datasheet. Click "Add to Library" after extraction to continue.
        </p>
        <ToolExtractorTab onExtract={handleExtracted} />
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
        </div>
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
            Upload a photo, PDF, or paste spec sheet text. AI extracts tool data automatically.
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
