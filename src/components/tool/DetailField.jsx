// A read-only label/value row in the tool page's detail grids. An empty value
// renders as "—" rather than collapsing, so a field's position never moves
// between two tools of the same type (the rule toolFieldLayout.js exists for).
export default function DetailField({ label, value, unit, mono, href }) {
  const isEmpty = value === null || value === undefined || value === '';
  const display = isEmpty ? '—' : (unit ? `${value} ${unit}` : String(value));
  return (
    <div className="detail-field">
      <div className="detail-field-label">{label}</div>
      {href && !isEmpty ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={`detail-field-value inline-link ${mono ? 'font-mono' : ''}`}
        >{display}</a>
      ) : (
        <div className={`detail-field-value ${isEmpty ? 'detail-field-empty' : ''} ${mono ? 'font-mono' : ''}`}>
          {display}
        </div>
      )}
    </div>
  );
}
