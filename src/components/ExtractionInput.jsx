// ExtractionInput — the screenshot / PDF / pasted-text picker.
//
// Shared by both extraction entry points so the upload behaviour (drag, browse,
// Ctrl+V paste, the accepted file types) can't drift between them:
//
//   • AddToolFlow          → inline, as the first step of adding a NEW tool
//   • ExtractUpdateModal   → inside the modal, scanning onto an EXISTING tool
//
// It owns only the picking. What is DONE with the result differs completely
// between the two callers (a whole new tool vs. a proposal list), so that stays
// with them.
import { useRef, useEffect, useCallback } from 'react';
import { Upload, FileText, Image as ImageIcon } from 'lucide-react';

/** The empty value. Callers hold this in their own state. */
export const emptyExtractionInput = () => ({ mode: 'file', file: null, text: '' });

/** Is there enough here to run an extraction? */
export function extractionReady(input) {
  return input.mode === 'file' ? !!input.file : input.text.trim().length > 10;
}

/** Shape the picked input into a `runExtraction` argument. */
export function extractionRequest(input) {
  if (input.mode === 'file') {
    return { kind: input.file.kind, data: input.file.data, mediaType: input.file.mediaType };
  }
  return { kind: 'text', data: input.text };
}

// A pasted screenshot arrives as "image.png" for every scan, which would make a
// tool's Files list unreadable. Name it for what it is and when it was read;
// keep a real uploaded filename as-is, since that is usually the part number.
function sourceFileName(file) {
  const generic = !file.name || /^(image|screenshot|pasted)/i.test(file.name);
  if (!generic) return file.name;
  const ext = file.kind === 'pdf' ? 'pdf' : (file.mediaType?.split('/')[1] || 'png');
  return `spec-sheet-${new Date().toISOString().slice(0, 10)}.${ext}`;
}

/**
 * The document to keep as evidence, or null. A pasted-text extraction has no
 * file, so there is nothing to attach.
 */
export function extractionSourceFile(input) {
  if (input.mode !== 'file' || !input.file?.blob) return null;
  return { blob: input.file.blob, name: sourceFileName(input.file) };
}

export default function ExtractionInput({ value, onChange, disabled = false, active = true }) {
  const inputRef = useRef(null);
  const { mode, file, text } = value;

  const takeFile = useCallback((f) => {
    if (!f) return;
    const reader = new FileReader();
    // The raw File is kept alongside the base64: the extraction needs the
    // bytes, and the caller may then attach the same file to the tool so the
    // values it produced stay traceable to their source.
    if (f.type === 'application/pdf') {
      reader.onload = e => onChange({
        ...value, file: { kind: 'pdf', data: e.target.result.split(',')[1], name: f.name, preview: null, blob: f },
      });
      reader.readAsDataURL(f);
    } else if (f.type.startsWith('image/')) {
      reader.onload = e => onChange({
        ...value,
        file: {
          kind: 'image', data: e.target.result.split(',')[1],
          mediaType: f.type || 'image/png', name: f.name, preview: e.target.result, blob: f,
        },
      });
      reader.readAsDataURL(f);
    }
  }, [onChange, value]);

  // Paste a screenshot straight in — the common case for a product page.
  // `active` lets a caller disable this while its step isn't on screen.
  useEffect(() => {
    if (!active || mode !== 'file' || disabled) return;
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
  }, [active, mode, disabled, takeFile]);

  const set = (patch) => onChange({ ...value, ...patch });

  return (
    <>
      <div className="btn-toggle mb-12">
        <button type="button" className={mode === 'file' ? 'active' : ''}
          onClick={() => set({ mode: 'file' })} disabled={disabled}>
          Image / PDF
        </button>
        <button type="button" className={mode === 'text' ? 'active' : ''}
          onClick={() => set({ mode: 'text' })} disabled={disabled}>
          Paste text
        </button>
      </div>

      {mode === 'file' ? (
        <>
          <div
            className={`upload-dropzone${file ? ' has-file' : ''}`}
            onClick={() => !file && !disabled && inputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); if (!disabled) takeFile(e.dataTransfer.files?.[0]); }}
            tabIndex={0}
          >
            {file ? (
              <div className="extract-file-preview">
                {file.preview
                  ? <img src={file.preview} alt="" />
                  : <FileText size={40} style={{ color: 'var(--orange)' }} />}
                <div>
                  <div className="text-sm" style={{ wordBreak: 'break-all' }}>{file.name}</div>
                  <button className="btn btn-ghost btn-sm mt-6" onClick={() => set({ file: null })} disabled={disabled}>
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
          disabled={disabled}
          onChange={e => set({ text: e.target.value })}
          placeholder="Paste the spec table or product description here…"
        />
      )}
    </>
  );
}
