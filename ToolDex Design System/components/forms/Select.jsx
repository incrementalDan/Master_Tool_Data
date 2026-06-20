import React from 'react';

// ToolDex — Select
// Native select restyled with a theme chevron. Labeled like Input.

export function Select({ label, required = false, value, onChange, options = [], disabled = false, className = '', style, children }) {
  const sel = (
    <select className={['field-input', className].filter(Boolean).join(' ')} value={value} onChange={onChange} disabled={disabled} style={label ? undefined : style}>
      {children || options.map(opt => {
        const val = typeof opt === 'string' ? opt : opt.value;
        const lbl = typeof opt === 'string' ? opt : opt.label;
        return <option key={val} value={val}>{lbl}</option>;
      })}
    </select>
  );
  if (!label) return sel;
  return (
    <label className="field-group" style={style}>
      <span className="field-label">{label}{required && <span className="required">*</span>}</span>
      {sel}
    </label>
  );
}
