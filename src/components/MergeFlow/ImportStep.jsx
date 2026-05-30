import { useState, useRef } from 'react';
import { ArrowLeft, UploadCloud, FileJson, ClipboardPaste, AlertCircle } from 'lucide-react';
import { fusionToolToInternal } from '../../schema/toolSchema.js';
import { TOOL_TYPE_LABELS } from '../../schema/toolSchema.js';
import ToolTypeIcon from '../icons/ToolTypeIcon.jsx';

function parseJobJson(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Invalid JSON — check that you copied the full file contents.'); }

  // Fusion library export: { version, data: [...] }
  if (Array.isArray(parsed?.data)) {
    if (parsed.data.length === 0) throw new Error('The library JSON contains no tools.');
    return parsed.data; // may be multiple tools
  }
  // Single tool object with guid
  if (parsed.guid || parsed.type) return [parsed];
  // Array of tools directly
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) throw new Error('No tools found in JSON.');
    return parsed;
  }
  throw new Error('Unrecognized format. Export a single tool or library from Fusion 360.');
}

export default function ImportStep({ onImported, onCancel }) {
  const [mode, setMode] = useState('choose'); // 'choose' | 'paste' | 'file'
  const [pasteValue, setPasteValue] = useState('');
  const [candidates, setCandidates] = useState(null); // multiple tools in file
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef();

  const processRaw = (raw) => {
    setError('');
    try {
      const tools = parseJobJson(raw);
      if (tools.length === 1) {
        onImported(fusionToolToInternal(tools[0]));
      } else {
        setCandidates(tools.map(fusionToolToInternal));
        setMode('pick');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => processRaw(e.target.result);
    reader.onerror = () => setError('Could not read file.');
    reader.readAsText(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  };

  if (mode === 'pick' && candidates) {
    return (
      <div>
        <h3 className="import-section-title">Select Tool to Sync</h3>
        <p className="text-sub text-sm mb-16">
          The file contains {candidates.length} tools. Choose which one to compare against master.
        </p>
        <div className="merge-candidate-list">
          {candidates.map((tool, i) => (
            <button key={i} className="merge-candidate-card" onClick={() => onImported(tool)}>
              <span className="merge-candidate-icon"><ToolTypeIcon type={tool.tool_type} size={20} /></span>
              <div>
                <div className="merge-candidate-name">{tool.description || '—'}</div>
                <div className="text-xs text-sub">{TOOL_TYPE_LABELS[tool.tool_type] || tool.tool_type}
                  {tool.diameter ? ` · ⌀${tool.diameter}"` : ''}
                  {tool.number_of_flutes ? ` · ${tool.number_of_flutes}FL` : ''}
                </div>
              </div>
            </button>
          ))}
        </div>
        <button className="btn btn-ghost btn-sm mt-16" onClick={() => { setCandidates(null); setMode('choose'); }}>
          <ArrowLeft size={14} /> Back
        </button>
      </div>
    );
  }

  if (mode === 'paste') {
    return (
      <div>
        <h3 className="import-section-title">Paste Tool JSON</h3>
        <p className="text-sub text-sm mb-12">
          In Fusion 360: right-click the tool → Export → copy the JSON. Paste it here.
        </p>
        <textarea
          className="field-input"
          style={{ minHeight: 200, fontFamily: 'monospace', fontSize: 12 }}
          placeholder='{ "guid": "...", "type": "flat end mill", ... }'
          value={pasteValue}
          onChange={e => setPasteValue(e.target.value)}
          autoFocus
        />
        {error && <div className="error-banner mt-8">{error}</div>}
        <div className="flex gap-8 mt-12">
          <button className="btn btn-ghost btn-sm" onClick={() => { setMode('choose'); setError(''); }}>
            <ArrowLeft size={14} /> Back
          </button>
          <button
            className="btn btn-primary"
            disabled={!pasteValue.trim()}
            onClick={() => processRaw(pasteValue)}
          >
            Parse JSON
          </button>
        </div>
      </div>
    );
  }

  // Default: choose mode
  return (
    <div>
      <h3 className="import-section-title">Import Tool from Job</h3>
      <p className="text-sub text-sm mb-20" style={{ lineHeight: 1.7 }}>
        Export the modified tool from Fusion 360 as JSON, then upload or paste it here.
        The app will compare it against the master library and let you choose what to commit.
      </p>

      <div className="merge-import-options">
        {/* File upload */}
        <div
          className={`upload-zone ${dragging ? 'drag-over' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={e => handleFile(e.target.files[0])}
          />
          <UploadCloud size={32} style={{ color: 'var(--text-sub)', marginBottom: 12 }} />
          <div style={{ fontWeight: 600 }}>Drop JSON file here</div>
          <div className="text-sub text-xs mt-4">or click to browse</div>
          <div className="text-sub text-xs mt-8">Accepts Fusion 360 tool library or single-tool JSON export</div>
        </div>

        <div className="merge-or-divider"><span>or</span></div>

        <button className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center', padding: '14px' }} onClick={() => setMode('paste')}>
          <ClipboardPaste size={16} /> Paste JSON
        </button>
      </div>

      {error && (
        <div className="error-banner mt-16 flex items-center gap-8">
          <AlertCircle size={15} /> {error}
        </div>
      )}

      <div className="flex gap-8 mt-20">
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>
          <ArrowLeft size={14} /> Cancel
        </button>
      </div>
    </div>
  );
}
