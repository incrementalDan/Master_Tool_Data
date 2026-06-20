import React from 'react';

// ToolDex — Input
// Labeled text/number field. Inputs are recessed (sit below the surface) with
// an uppercase micro-label. Focus turns the border brand-blue.

export function Input({
  label, required = false, error, hint,
  type = 'text', value, onChange, placeholder, disabled = false,
  className = '', style, ...rest
}) {
  const inputCls = ['field-input', error ? 'error' : '', className].filter(Boolean).join(' ');
  const input = (
    <input
      type={type} className={inputCls} value={value} onChange={onChange}
      placeholder={placeholder} disabled={disabled} style={label ? undefined : style} {...rest}
    />
  );
  if (!label) return input;
  return (
    <label className="field-group" style={style}>
      <span className="field-label">{label}{required && <span className="required">*</span>}</span>
      {input}
      {error && <span className="field-error">{error}</span>}
      {hint && !error && <span className="text-xs text-sub">{hint}</span>}
    </label>
  );
}
