import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, UploadCloud, ClipboardPaste, AlertCircle } from 'lucide-react';
import { parseIncoming } from '../../services/mergeQueue.js';

export default function ImportStep({ onImported, onCancel }) {
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [showPasteArea, setShowPasteArea] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const fileRef = useRef();
  const pasteRef = useRef();

  // Ctrl+V / Cmd+V anywhere on this step triggers parse
  useEffect(() => {
    const handlePaste = (e) => {
      // Ignore if user is typing in a textarea/input
      if (/^(TEXTAREA|INPUT)$/.test(document.activeElement?.tagName)) return;
      const text = e.clipboardData?.getData('text');
      if (!text?.trim()) return;
      processRaw(text);
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []); // eslint-disable-line

  const processRaw = (raw) => {
    setError('');
    try {
      const tools = parseIncoming(raw);
      onImported(tools);
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

  return (
    <div style={{ maxWidth: 520 }}>
      <h3 className="import-section-title">Import Tools from Job</h3>
      <p className="text-sub text-sm mb-20" style={{ lineHeight: 1.7 }}>
        In Fusion 360, select one or more tools in the tool library → right-click → <em>Copy</em>,
        then paste here. Accepts Fusion CSV (right-click copy) or Fusion library JSON.
      </p>

      {/* Primary: paste zone */}
      <div
        className="merge-paste-zone"
        tabIndex={0}
        onClick={() => pasteRef.current?.focus()}
        onFocus={() => setShowPasteArea(true)}
      >
        <ClipboardPaste size={28} style={{ color: 'var(--blue)', marginBottom: 10 }} />
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Paste from Fusion (Ctrl+V / Cmd+V)</div>
        <div className="text-sub text-xs">Copy tool(s) from Fusion, then paste anywhere on this screen</div>
      </div>

      {showPasteArea && (
        <div className="mt-12">
          <textarea
            ref={pasteRef}
            className="field-input"
            style={{ minHeight: 120, fontFamily: 'monospace', fontSize: 11 }}
            placeholder='Paste Fusion tool data here (CSV from right-click copy, or JSON)…'
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            autoFocus
          />
          <div className="flex gap-8 mt-8">
            <button className="btn btn-ghost btn-sm" onClick={() => { setShowPasteArea(false); setPasteText(''); setError(''); }}>
              Cancel
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={!pasteText.trim()}
              onClick={() => processRaw(pasteText)}
            >
              Parse
            </button>
          </div>
        </div>
      )}

      <div className="merge-or-divider mt-16"><span>or upload a file</span></div>

      {/* Secondary: file upload */}
      <div
        className={`upload-zone ${dragging ? 'drag-over' : ''}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        style={{ padding: '18px 24px' }}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".json,.csv,.tsv,.txt"
          style={{ display: 'none' }}
          onChange={e => handleFile(e.target.files[0])}
        />
        <UploadCloud size={22} style={{ color: 'var(--text-sub)', marginBottom: 6 }} />
        <div className="text-sub text-sm">Drop Fusion CSV or JSON file here or click to browse</div>
      </div>

      {error && (
        <div className="error-banner mt-12 flex items-center gap-8">
          <AlertCircle size={15} /> {error}
        </div>
      )}

      <button className="btn btn-ghost btn-sm mt-16" onClick={onCancel}>
        <ArrowLeft size={14} /> Cancel
      </button>
    </div>
  );
}
