// ExtractUpdateModal — run a spec-sheet extraction against an EXISTING tool.
//
// Upload only. Everything the user decides happens back in the form, inline at
// each field, because that is where the current value already is — a separate
// review list would be a second place to read the same numbers.
//
// ⚠️ This modal never writes a tool. It hands `{ extracted, proposals,
// purchasingRows, typeNotice }` to the form, which applies accepted values into
// its DRAFT. Nothing reaches Fusion or metadata until the user saves the form.
import { useState, useRef, useCallback, useEffect } from 'react';
import { X, ScanLine, Upload, FileText, Image as ImageIcon, AlertTriangle } from 'lucide-react';
import { runExtraction } from '../services/extractionService.js';
import { buildFieldProposals, buildPurchasingProposals } from '../schema/extractionDiff.js';
import { unitAbbr } from '../utils/units.js';

// A pasted screenshot arrives as "image.png" for every scan, which would make a
// tool's Files list unreadable. Name it for what it is and when it was read;
// keep a real uploaded filename as-is, since that is usually the part number.
function sourceFileName(file) {
  const generic = !file.name || /^(image|screenshot|pasted)/i.test(file.name);
  if (!generic) return file.name;
  const ext = file.kind === 'pdf' ? 'pdf' : (file.mediaType?.split('/')[1] || 'png');
  return `spec-sheet-${new Date().toISOString().slice(0, 10)}.${ext}`;
}

export default function ExtractUpdateModal({ open, tool, onClose, onProposals }) {
  const [mode, setMode] = useState('file');       // 'file' | 'text'
  const [file, setFile] = useState(null);         // { kind, data, mediaType, name, preview }
  const [text, setText] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [empty, setEmpty] = useState(false);      // extraction ran, found nothing to change
  const inputRef = useRef(null);

  const reset = useCallback(() => {
    setFile(null); setText(''); setError(''); setEmpty(false); setBusy(false);
  }, []);

  useEffect(() => { if (open) reset(); }, [open, reset]);

  const takeFile = useCallback((f) => {
    if (!f) return;
    setError(''); setEmpty(false);
    const reader = new FileReader();
    // The raw File is kept alongside the base64: the extraction needs the
    // bytes, and the form may then attach the same file to the tool so the
    // values it produced stay traceable to their source.
    if (f.type === 'application/pdf') {
      reader.onload = e => setFile({
        kind: 'pdf', data: e.target.result.split(',')[1], name: f.name, preview: null, blob: f,
      });
      reader.readAsDataURL(f);
    } else if (f.type.startsWith('image/')) {
      reader.onload = e => setFile({
        kind: 'image', data: e.target.result.split(',')[1],
        mediaType: f.type || 'image/png', name: f.name, preview: e.target.result, blob: f,
      });
      reader.readAsDataURL(f);
    } else {
      setError('Upload an image or a PDF.');
    }
  }, []);

  // Paste a screenshot straight in — the common case for a product page.
  useEffect(() => {
    if (!open || mode !== 'file') return;
    const onPaste = (e) => {
      for (const item of (e.clipboardData?.items || [])) {
        if (item.type.startsWith('image/') || item.type === 'application/pdf') {
          takeFile(item.getAsFile());
          break;
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [open, mode, takeFile]);

  if (!open) return null;

  const ready = mode === 'file' ? !!file : text.trim().length > 10;

  const run = async () => {
    setBusy(true); setError(''); setEmpty(false);
    try {
      const { fields: extracted } = mode === 'file'
        ? await runExtraction({ kind: file.kind, data: file.data, mediaType: file.mediaType })
        : await runExtraction({ kind: 'text', data: text });

      const { proposals, typeNotice } = buildFieldProposals(tool, extracted);
      const { rows: purchasingRows, newManufacturer } = buildPurchasingProposals(tool, extracted);

      if (proposals.length === 0 && purchasingRows.length === 0) {
        // Not an error — a sheet that agrees with the tool is a good outcome,
        // and the type notice may still be worth showing.
        setEmpty(true);
        setBusy(false);
        if (!typeNotice) return;
      }
      onProposals({
        extracted, proposals, purchasingRows, typeNotice, newManufacturer,
        // Only a real file can be attached — a pasted-text extraction has no
        // document to keep.
        sourceFile: mode === 'file' && file?.blob
          ? { blob: file.blob, name: sourceFileName(file) }
          : null,
      });
      onClose();
    } catch (e) {
      setError(e.message || 'Extraction failed');
    }
    setBusy(false);
  };

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal extract-update-modal">
        <div className="modal-header">
          <ScanLine size={18} style={{ color: 'var(--blue)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <h3>Scan spec sheet</h3>
            <p className="modal-sub">
              Reads a screenshot, PDF or pasted text and compares it against this tool.
              Nothing is changed until you review each difference and save.
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} disabled={busy} title="Close"><X size={16} /></button>
        </div>

        <div className="modal-body">
          <div className="btn-toggle mb-12">
            <button type="button" className={mode === 'file' ? 'active' : ''} onClick={() => setMode('file')}>
              Image / PDF
            </button>
            <button type="button" className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')}>
              Paste text
            </button>
          </div>

          {mode === 'file' ? (
            <>
              <div
                className={`upload-dropzone${dragOver ? ' dragover' : ''}${file ? ' has-file' : ''}`}
                onClick={() => !file && inputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); takeFile(e.dataTransfer.files?.[0]); }}
                tabIndex={0}
              >
                {file ? (
                  <div className="extract-file-preview">
                    {file.preview
                      ? <img src={file.preview} alt="" />
                      : <FileText size={40} style={{ color: 'var(--orange)' }} />}
                    <div>
                      <div className="text-sm" style={{ wordBreak: 'break-all' }}>{file.name}</div>
                      <button className="btn btn-ghost btn-sm mt-6" onClick={() => setFile(null)} disabled={busy}>
                        Choose a different file
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="upload-dropzone-hint">
                    <Upload size={26} />
                    <span>Drop a screenshot or PDF, click to browse, or press <strong>Ctrl/⌘+V</strong> to paste</span>
                    <span className="text-xs" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <ImageIcon size={12} /> product page · <FileText size={12} /> catalogue PDF
                    </span>
                  </div>
                )}
              </div>
              <input
                ref={inputRef}
                type="file"
                accept="image/*,application/pdf"
                style={{ display: 'none' }}
                onChange={e => takeFile(e.target.files?.[0])}
              />
            </>
          ) : (
            <textarea
              className="field-input"
              rows={7}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Paste the spec table or product description here…"
            />
          )}

          <p className="text-xs text-sub mt-12" style={{ lineHeight: 1.5 }}>
            Values are read in inches and converted into this tool's unit
            (<strong>{unitAbbr(tool?.unit)}</strong>). Fields that don't apply to a{' '}
            <strong>{tool?.tool_type}</strong> are ignored. Presets, assemblies, Tool ID,
            location and machine number are never touched.
          </p>

          {empty && (
            <div className="spec-empty-note mt-12">
              The spec sheet agrees with this tool — nothing to change.
            </div>
          )}
          {error && (
            <div className="error-banner mt-12" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <AlertTriangle size={13} style={{ flexShrink: 0 }} /> {error}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <span className="modal-footer-note" />
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={run} disabled={!ready || busy}>
            {busy
              ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Reading…</>
              : <><ScanLine size={15} /> Compare with this tool</>}
          </button>
        </div>
      </div>
    </div>
  );
}
