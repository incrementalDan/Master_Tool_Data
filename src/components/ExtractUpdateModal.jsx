// ExtractUpdateModal — run a spec-sheet extraction against an EXISTING tool.
//
// Upload only. Everything the user decides happens back in the form, inline at
// each field, because that is where the current value already is — a separate
// review list would be a second place to read the same numbers.
//
// ⚠️ This modal never writes a tool. It hands `{ extracted, proposals,
// purchasingRows, typeNotice, sourceFile }` to the form, which applies accepted
// values into its DRAFT. Nothing reaches Fusion or metadata until the user
// saves the form.
import { useState, useEffect } from 'react';
import { X, ScanLine, AlertTriangle } from 'lucide-react';
import { runExtraction } from '../services/extractionService.js';
import { buildFieldProposals, buildPurchasingProposals } from '../schema/extractionDiff.js';
import { unitAbbr } from '../utils/units.js';
import ExtractionInput, {
  emptyExtractionInput, extractionReady, extractionRequest, extractionSourceFile,
} from './ExtractionInput.jsx';

export default function ExtractUpdateModal({ open, tool, onClose, onProposals }) {
  const [input, setInput] = useState(emptyExtractionInput);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [empty, setEmpty] = useState(false);   // extraction ran, found nothing to change

  useEffect(() => {
    if (open) { setInput(emptyExtractionInput()); setError(''); setEmpty(false); setBusy(false); }
  }, [open]);

  if (!open) return null;

  const run = async () => {
    setBusy(true); setError(''); setEmpty(false);
    try {
      const { fields: extracted } = await runExtraction(extractionRequest(input));

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
        sourceFile: extractionSourceFile(input),
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
          <ExtractionInput value={input} onChange={setInput} disabled={busy} />

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
          <button className="btn btn-primary" onClick={run} disabled={!extractionReady(input) || busy}>
            {busy
              ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Reading…</>
              : <><ScanLine size={15} /> Compare with this tool</>}
          </button>
        </div>
      </div>
    </div>
  );
}
